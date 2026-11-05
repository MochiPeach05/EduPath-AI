import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { RoadmapRow } from "./jobs.js";
import { createRoadmapRouter } from "./router.js";
import type { RoadmapOutput } from "./validate.js";
import { ROADMAP_ASSESSMENT, syntheticRoadmapFacts, syntheticRoadmapResult, syntheticSurveyRow } from "./test-fixture.js";
import { TRANSCRIPT_POLICY_VERSION } from "../student/consent.js";

// Synthetic K29 data only (fixtures/synthetic-k29.json plus invented grades); no real student record.
const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const origin = "https://edupath.example";
const ROADMAP = "44444444-4444-4444-8444-444444444444";
const OLD_ASSESSMENT = "77777777-7777-4777-8777-777777777777";
const facts = syntheticRoadmapFacts();

const student = {
  userId: studentId, identityKey: `${tenantId}:${studentId}`, tenantId, objectId: studentId, name: "Student User",
  email: "student@example.edu", username: "student@example.edu", role: "student", signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;

const row = (extra: Partial<RoadmapRow> = {}): RoadmapRow => ({
  id: ROADMAP, assessmentId: ROADMAP_ASSESSMENT, status: "queued", errorCode: null, createdAt: new Date("2026-10-24T03:00:00Z"),
  completedAt: null, model: null, facts, output: null, recent: false, ...extra,
});

type Setup = {
  sessionUser?: AuthenticatedUser | null;
  noPool?: boolean;
  enabled?: boolean;
  rows?: RoadmapRow[];
  assessment?: boolean;
  survey?: boolean;
  worker?: { online: boolean; kinds: string[] | null } | null;
};

function setup(options: Setup = {}) {
  const sessionUser = options.sessionUser === null ? undefined : options.sessionUser ?? student;
  const rows = options.rows ?? [];
  const worker = options.worker === undefined ? { online: true, kinds: ["competency_assessment", "study_roadmap"] } : options.worker;
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    const result = (list: unknown[]) => ({ rowCount: list.length, rows: list });
    if (sql.startsWith("SELECT id FROM users")) return result([{ id: studentId }]);
    if (sql.includes("FROM stu_comp_ai_worker_status")) return result(worker ? [worker] : []);
    if (sql.includes("FROM stu_comp_assessments")) {
      if (options.assessment === false) return result([]);
      const createdAt = new Date("2026-10-24T01:00:00Z");
      // GET / reads the summary only; POST / reads the result it builds from.
      return result([sql.includes('AS "hasCareer"') ? { id: ROADMAP_ASSESSMENT, createdAt, hasCareer: true } : { id: ROADMAP_ASSESSMENT, createdAt, computed: syntheticRoadmapResult() }]);
    }
    if (sql.includes("FROM stu_profile_surveys WHERE user_id=$1")) return result(options.survey === false ? [] : [syntheticSurveyRow()]);
    if (sql.includes("FROM data_consents")) return result(options.survey === false ? [] : [{ policy_version: TRANSCRIPT_POLICY_VERSION }]);
    if (sql.startsWith('SELECT id,status,error_code AS "errorCode" FROM stu_roadmaps')) {
      return result(rows.slice(0, 1).map((item) => ({ id: item.id, status: item.status, errorCode: item.errorCode })));
    }
    if (sql.includes("FROM stu_roadmaps WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1")) return result(rows.slice(0, 1));
    // The newest completed roadmap before the given one (rows are newest first).
    if (sql.includes("FROM stu_roadmaps WHERE user_id=$1 AND status='completed' AND ai_output IS NOT NULL")) {
      const at = rows.findIndex((item) => item.id === _params?.[2]);
      return result(at < 0 ? [] : rows.slice(at + 1).filter((item) => item.status === "completed" && item.output).slice(0, 1));
    }
    if (sql.includes("FROM stu_roadmaps WHERE user_id=$1 ORDER BY created_at DESC,id DESC")) return result(rows);
    if (sql.includes("count(*)::int AS count FROM stu_roadmaps")) return result([{ count: 0 }]);
    if (sql.startsWith("INSERT INTO stu_roadmaps")) return result([{ createdAt: new Date("2026-10-24T03:00:00Z") }]);
    return result([]);
  });
  const release = vi.fn();
  const pool = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: sessionUser } as typeof req.session; next(); });
  app.use("/roadmap", createRoadmapRouter(options.noPool ? undefined : pool, origin, { enabled: options.enabled ?? true }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, query, release, sql: () => query.mock.calls.map(([text]) => text) };
}

afterEach(() => vi.restoreAllMocks());

describe("guards", () => {
  it("requires a session, a database and a matching Origin for writes", async () => {
    await request(setup({ sessionUser: null }).app).get("/roadmap").expect(401, { error: "authentication_required" });
    await request(setup({ noPool: true }).app).get("/roadmap").expect(503, { error: "database_required" });
    await request(setup().app).post("/roadmap").set("Origin", "https://evil.example").send({}).expect(403, { error: "invalid_origin" });
    await request(setup().app).post("/roadmap").set("Origin", origin).send({ months: 6 }).expect(400, { error: "invalid_input" });
    await request(setup().app).get("/roadmap/other").expect(404, { error: "not_found" });
  });
});

describe("GET /", () => {
  it("returns the newest roadmap with the facts, the assessment and the worker state", async () => {
    const { app, sql } = setup({ rows: [row()] });
    const res = await request(app).get("/roadmap").expect(200);
    // The page never loads the whole assessment result.
    expect(sql().filter((text) => text.includes("FROM stu_comp_assessments")).every((text) => !/SELECT id,created_at AS "createdAt",computed /.test(text))).toBe(true);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({
      assessment: { id: ROADMAP_ASSESSMENT, createdAt: "2026-10-24T01:00:00.000Z", hasCareer: true },
      stale: false, surveyDone: true, aiEnabled: true, worker: { online: true, supportsRoadmap: true },
      roadmap: { id: ROADMAP, status: "queued", summary: null, window: { start: "2026-12-21", end: "2027-04-04", term: "HK262" } },
      // The term a new roadmap would cover (from the real clock).
      upcoming: { term: expect.stringMatching(/^HK\d{3}$/), start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });
    expect(res.body.roadmap.study.map((item: { code: string }) => item.code)).toEqual(["71ITSE41203", "71ITIS30203", "71ITIN40304"]);
    // Where the advice comes from (roadmap-v9): the survey as it is now, next to what the system had on record.
    expect(res.body.basis.selfReported[0]).toBe("Công nghệ bạn chọn là thế mạnh: Web front-end (HTML, CSS, JavaScript, React); Trí tuệ nhân tạo, học máy");
    expect(res.body.basis.recorded).toContain("Học phần thực tập trong chương trình: Đồ án thực tập (chưa học)");
    expect(res.body.basis.surveyChanged).toBe(false);
    expect(res.body.basis).not.toHaveProperty("unproven");
    // Nothing server-only leaves: no ai_input, no scores of the skills.
    expect(JSON.stringify(res.body)).not.toMatch(/"aiInput"|"ai_input"|"threshold"/);
  });

  it("marks a roadmap of an older assessment as stale, and answers with nothing to show", async () => {
    expect((await request(setup({ rows: [row({ assessmentId: OLD_ASSESSMENT })] }).app).get("/roadmap")).body.stale).toBe(true);
    expect((await request(setup({ assessment: false }).app).get("/roadmap")).body).toMatchObject({ roadmap: null, assessment: null, stale: false });
  });

  it("says whether the profile survey a new roadmap needs is answered", async () => {
    expect((await request(setup({ survey: false }).app).get("/roadmap")).body.surveyDone).toBe(false);
    // No survey under a valid consent, or a roadmap made before roadmap-v9 (no recorded facts): no basis.
    expect((await request(setup({ survey: false, rows: [row()] }).app).get("/roadmap")).body.basis).toBeNull();
    const { recorded: _recorded, ...older } = row().facts;
    expect((await request(setup({ rows: [row({ facts: older })] }).app).get("/roadmap")).body.basis).toBeNull();
    await request(setup({ survey: false }).app).post("/roadmap").set("Origin", origin).send({}).expect(409, { error: "survey_required" });
  });

  describe("previous (the older roadmap shown dimmed, like Xét tốt nghiệp)", () => {
    const OLDER = "55555555-5555-4555-8555-555555555555";
    const output: RoadmapOutput = {
      summary: "Lộ trình trước: ưu tiên học phần trễ kế hoạch.", advice: ["Đăng ký Hệ quản trị cơ sở dữ liệu ngay đầu học kỳ."],
      study: [{ code: "71ITIS30203", advice: "Học phần trễ kế hoạch, nên đăng ký ngay." }], improve: [], skills: [],
      months: [{ month: 1, focus: "Ổn định lịch học", tasks: ["Đăng ký học phần trễ."] }],
    };
    const older = row({ id: OLDER, assessmentId: OLD_ASSESSMENT, status: "completed", createdAt: new Date("2026-10-20T03:00:00Z"),
      completedAt: new Date("2026-10-20T03:04:00Z"), model: "gemma4:e4b", output });
    const lookups = (sql: string[]) => sql.filter((text) => text.includes("status='completed' AND ai_output IS NOT NULL"));

    it.each(["queued", "processing", "failed", "cancelled"] as const)("is the newest older completed roadmap, presented the same way, while the newest is %s", async (status) => {
      const { app, sql, query } = setup({ rows: [row({ status }), older] });
      const res = await request(app).get("/roadmap").expect(200);
      expect(res.body.roadmap).toMatchObject({ id: ROADMAP, status, summary: null, advice: [] });
      expect(res.body.previous).toMatchObject({
        id: OLDER, assessmentId: OLD_ASSESSMENT, status: "completed", model: "gemma4:e4b", completedAt: "2026-10-20T03:04:00.000Z",
        summary: "Lộ trình trước: ưu tiên học phần trễ kế hoạch.", advice: ["Đăng ký Hệ quản trị cơ sở dữ liệu ngay đầu học kỳ."],
        window: { term: "HK262" },
      });
      // Its own output merged with its own facts: the course the AI picked first, with its advice, then the others.
      expect(res.body.previous.study.map((item: { code: string; advice: string | null }) => [item.code, item.advice])).toEqual([
        ["71ITIS30203", "Học phần trễ kế hoạch, nên đăng ký ngay."], ["71ITSE41203", null], ["71ITIN40304", null]]);
      expect(res.body.previous.months[0]).toMatchObject({ month: 1, focus: "Ổn định lịch học", tasks: ["Đăng ký học phần trễ."] });
      expect(lookups(sql())).toHaveLength(1);
      expect(query.mock.calls.find(([text]) => lookups([text]).length)?.[1]).toEqual([studentId, 30, ROADMAP]);
      expect(JSON.stringify(res.body.previous)).not.toMatch(/"aiInput"|"ai_input"|"threshold"/);
    });

    it("is null, and never looked up, once the newest roadmap is completed", async () => {
      const { app, sql } = setup({ rows: [row({ status: "completed", output, completedAt: new Date("2026-10-24T03:04:00Z") }), older] });
      const res = await request(app).get("/roadmap").expect(200);
      expect(res.body.roadmap.summary).toBe("Lộ trình trước: ưu tiên học phần trễ kế hoạch.");
      expect(res.body.previous).toBeNull();
      expect(lookups(sql())).toHaveLength(0);
    });

    it("is null without an older completed roadmap or without any roadmap", async () => {
      expect((await request(setup({ rows: [row({ status: "failed", errorCode: "ai_timeout" }), { ...older, status: "failed", output: null }] }).app).get("/roadmap")).body.previous).toBeNull();
      expect((await request(setup().app).get("/roadmap")).body.previous).toBeNull();
    });
  });

  it("says when the worker is offline or too old for roadmaps", async () => {
    expect((await request(setup({ worker: { online: true, kinds: ["competency_assessment"] } }).app).get("/roadmap")).body.worker)
      .toEqual({ online: true, supportsRoadmap: false });
    expect((await request(setup({ worker: { online: false, kinds: ["study_roadmap"] } }).app).get("/roadmap")).body.worker)
      .toEqual({ online: false, supportsRoadmap: false });
    expect((await request(setup({ enabled: false }).app).get("/roadmap")).body).toMatchObject({ aiEnabled: false, worker: { online: false } });
  });
});

describe("GET /status", () => {
  it("returns the newest row's status only", async () => {
    const res = await request(setup({ rows: [row({ status: "failed", errorCode: "ai_timeout" })] }).app).get("/roadmap/status").expect(200);
    expect(res.body).toEqual({ id: ROADMAP, status: "failed", errorCode: "ai_timeout", worker: { online: true, supportsRoadmap: true } });
    expect((await request(setup().app).get("/roadmap/status")).body).toMatchObject({ id: null, status: null });
  });
});

describe("POST /", () => {
  it("queues a roadmap in a transaction and answers 201 with it", async () => {
    const { app, sql, release } = setup();
    const res = await request(app).post("/roadmap").set("Origin", origin).send({}).expect(201);
    expect(res.body.roadmap).toMatchObject({ status: "queued", assessmentId: ROADMAP_ASSESSMENT, summary: null });
    expect(sql()).toContain("BEGIN");
    expect(sql().at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalled();
  });

  it("answers 200 with the roadmap still being written, and maps refusals to their codes", async () => {
    await request(setup({ rows: [row({ status: "processing" })] }).app).post("/roadmap").set("Origin", origin).send({}).expect(200);
    const frequent = setup({ rows: [row({ status: "completed", recent: true })] });
    await request(frequent.app).post("/roadmap").set("Origin", origin).send({}).expect(429, { error: "roadmap_too_frequent" });
    expect(frequent.sql()).toContain("ROLLBACK");
    await request(setup({ assessment: false }).app).post("/roadmap").set("Origin", origin).send({}).expect(409, { error: "assessment_required" });
    await request(setup({ enabled: false }).app).post("/roadmap").set("Origin", origin).send({}).expect(409, { error: "ai_disabled" });
  });
});
