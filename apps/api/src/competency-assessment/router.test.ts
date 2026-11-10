import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { TRANSCRIPT_POLICY_VERSION } from "../student/consent.js";
import { AssessmentError } from "./inputs.js";
import { createCompetencyAssessmentRouter, type CompetencyAiQueueHook } from "./router.js";
import type { AssessmentInputs, AssessmentResult } from "./types.js";

const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const transcriptVersion = "33333333-3333-4333-8333-333333333333";
const latestId = "44444444-4444-4444-8444-444444444444";
const olderId = "55555555-5555-4555-8555-555555555555";
const foreignId = "66666666-6666-4666-8666-666666666666";
const origin = "https://edupath.example";
const student = {
  userId: studentId, identityKey: `${tenantId}:${studentId}`, tenantId, objectId: studentId,
  name: "Student User", email: "student@example.edu", username: "student@example.edu",
  role: "student", signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;

// Synthetic, minimal: the router only stores and returns what the engine produced.
const result = { meta: { calcVersion: "comp-calc-v1", transcriptVersion }, overall: { score: 72 } } as unknown as AssessmentResult;
const inputs = { transcript: { version: transcriptVersion } } as unknown as AssessmentInputs;

/** An assessment's own result; only `previous` reads it (the other routes return `result`). */
type Row = { id: string; user_id: string; ai_status: string; created_at: string; computed?: AssessmentResult };
/** studyPlan: the saved Kế hoạch học kỳ (stu_study_plans.data); none by default. */
type State = { active: boolean; transcript: string | null; recentPrecheck: boolean; recentInTx: boolean; rows: Row[]; consent: string | null; withdrawn: boolean; studyPlan?: unknown };
/** The student's cố vấn học tập working in the student's page (advisors/access.ts sets it on the request). */
const advisor = { ...student, userId: "88888888-8888-4888-8888-888888888888", name: "Cố vấn", email: "co.van@vlu.edu.vn", role: "advisor" } satisfies AuthenticatedUser;

function setup(options: { state?: Partial<State>; aiQueue?: CompetencyAiQueueHook; session?: boolean; noPool?: boolean; loadError?: Error; advisor?: boolean } = {}) {
  const state: State = {
    active: true, transcript: transcriptVersion, recentPrecheck: false, recentInTx: false, consent: null, withdrawn: false,
    rows: [
      { id: latestId, user_id: studentId, ai_status: "failed", created_at: "2026-10-11T02:00:00.000Z" },
      { id: olderId, user_id: studentId, ai_status: "completed", created_at: "2026-10-10T02:00:00.000Z" },
      { id: foreignId, user_id: "77777777-7777-4777-8777-777777777777", ai_status: "failed", created_at: "2026-10-11T03:00:00.000Z" },
    ],
    ...options.state,
  };
  let inserted: string | undefined;
  const stored = (row: Row) => ({
    id: row.id, created_at: row.created_at, meta: result.meta, computed: row.computed ?? result, ai_status: row.ai_status,
    ai_error_code: null, ai_model: null, ai_completed_at: null, ai_output: row.ai_status === "completed" ? { summary: "x" } : null,
  });
  const own = (params: unknown[]) => state.rows.filter((row) => row.user_id === params[1] && row.id === params[0]);
  const respond = (sql: string, params: unknown[] = []) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.startsWith("SELECT id FROM users")) return state.active ? { rowCount: 1, rows: [{ id: studentId }] } : { rowCount: 0, rows: [] };
    if (sql === "tx" || sql.includes("AS recent")) return { rowCount: 1, rows: [{ recent: sql === "tx" ? state.recentInTx : state.recentPrecheck }] };
    if (sql.startsWith("SELECT policy_version FROM data_consents")) return state.consent ? { rowCount: 1, rows: [{ policy_version: state.consent }] } : { rowCount: 0, rows: [] };
    if (sql.includes("AS withdrawn")) return { rowCount: 1, rows: [{ withdrawn: state.withdrawn }] };
    if (sql.startsWith("SELECT version FROM student_transcripts")) return state.transcript ? { rowCount: 1, rows: [{ version: state.transcript }] } : { rowCount: 0, rows: [] };
    if (sql.startsWith("INSERT INTO stu_comp_assessments")) {
      inserted = String(params[0]);
      state.rows.unshift({ id: inserted, user_id: String(params[1]), ai_status: "disabled", created_at: "2026-10-11T04:00:00.000Z" });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("FROM stu_comp_assessments WHERE id=$1 AND user_id=$2") && sql.startsWith("SELECT id,created_at")) {
      const rows = own(params).map(stored); return { rowCount: rows.length, rows };
    }
    if (sql.startsWith("SELECT a.id,a.ai_status")) {
      const mine = state.rows.filter((row) => row.user_id === params[1]);
      const rows = own(params).map((row) => ({ id: row.id, ai_status: row.ai_status, computed: result, latest: mine[0]?.id === row.id }));
      return { rowCount: rows.length, rows };
    }
    if (sql.startsWith("SELECT id FROM stu_comp_assessments WHERE id=$1 AND user_id=$2")) { const rows = own(params); return { rowCount: rows.length, rows }; }
    // The newest completed comment older than the given assessment, with the parts of its OWN result the page reads.
    if (sql.includes("ai_status='completed' AND ai_output IS NOT NULL")) {
      const mine = state.rows.filter((row) => row.user_id === params[0]);
      const at = mine.findIndex((row) => row.id === params[1]);
      const found = at < 0 ? undefined : mine.slice(at + 1).find((row) => row.ai_status === "completed");
      if (!found) return { rowCount: 0, rows: [] };
      const computed = found.computed ?? result;
      return { rowCount: 1, rows: [{
        id: found.id, created_at: found.created_at, ai_model: "gemma4:e4b", ai_completed_at: "2026-10-10T02:04:00.000Z", ai_output: { summary: "x" },
        prompt_version: "comp-v13", skill_directory: computed.skillDirectory ?? null, groups: computed.groups ?? null, requirements: computed.career?.requirements ?? null,
        has_career: Boolean(computed.career), courses: computed.courses ?? null, course_suggestions: computed.courseSuggestions ?? null,
      }] };
    }
    if (sql.startsWith("SELECT id,created_at")) {
      const rows = state.rows.filter((row) => row.user_id === params[0]).slice(0, 1).map(stored); return { rowCount: rows.length, rows };
    }
    if (sql.includes("FROM stu_study_plans")) return { rowCount: state.studyPlan ? 1 : 0, rows: state.studyPlan ? [{ data: state.studyPlan }] : [] };
    if (sql.startsWith("SELECT id,ai_status,ai_error_code")) {
      const rows = state.rows.filter((row) => row.user_id === params[0]).slice(0, 1).map((row) => ({ id: row.id, ai_status: row.ai_status, ai_error_code: null }));
      return { rowCount: rows.length, rows };
    }
    return { rowCount: 1, rows: [] };
  };
  const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => respond(sql.includes("AS recent") ? "tx" : sql, params));
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release });
  const poolQuery = vi.fn(async (sql: string, params?: unknown[]) => respond(sql, params));
  const pool = { connect, query: poolQuery } as unknown as DatabasePool;
  const loadInputs = vi.fn(async () => { if (options.loadError) throw options.loadError; return inputs; });
  const calculate = vi.fn(() => result);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = (options.session === false ? {} : { user: options.advisor ? advisor : student }) as typeof req.session;
    if (options.advisor) req.advisorActing = { advisor, student: { user: student, studentCode: null, name: "Student", className: "71K29CNTT99", advisorName: "Cố vấn" } };
    next();
  });
  app.use("/assessments", createCompetencyAssessmentRouter(options.noPool ? undefined : pool, origin, options.aiQueue, { loadInputs, calculate }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  const sql = () => clientQuery.mock.calls.map(([text]) => String(text));
  return { app, state, clientQuery, poolQuery, connect, release, loadInputs, calculate, sql, inserted: () => inserted };
}

function queue(overrides: Partial<CompetencyAiQueueHook> = {}): CompetencyAiQueueHook {
  return {
    enabled: true,
    enqueue: vi.fn(async (client, input) => { await client.query("UPDATE stu_comp_assessments SET ai_status='queued' WHERE id=$1", [input.assessmentId]); return "queued" as const; }),
    regenerate: vi.fn(async () => "queued" as const),
    cancel: vi.fn(async () => true),
    workerOnline: vi.fn(async () => true),
    ...overrides,
  };
}

const create = (app: express.Express, consent: string | undefined = TRANSCRIPT_POLICY_VERSION) => {
  const call = request(app).post("/assessments").set("Origin", origin);
  return consent ? call.set("X-Consent-Policy-Version", consent) : call;
};

describe("competency assessment access", () => {
  it("requires a session, a database and an active account", async () => {
    await request(setup({ session: false }).app).get("/assessments/latest").expect(401, { error: "authentication_required" });
    await request(setup({ noPool: true }).app).get("/assessments/latest").expect(503, { error: "database_required" });
    const inactive = setup({ state: { active: false } });
    await request(inactive.app).get("/assessments/latest").expect(403, { error: "account_unavailable" });
    expect(inactive.poolQuery.mock.calls[0]?.[1]).toEqual([studentId, tenantId]);
  });

  it("rejects writes from another origin before touching the database", async () => {
    const { app, connect, poolQuery } = setup();
    await request(app).post("/assessments").set("Origin", "https://evil.example").set("X-Consent-Policy-Version", TRANSCRIPT_POLICY_VERSION).expect(403, { error: "invalid_origin" });
    await request(app).delete("/assessments").send({ confirmed: true }).expect(403, { error: "invalid_origin" });
    expect(connect).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("marks every response no-store", async () => {
    const response = await request(setup().app).get("/assessments/latest/status").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("POST /", () => {
  it("requires consent to the current policy", async () => {
    const missing = setup();
    await create(missing.app, "").expect(400, { error: "consent_required" });
    await create(missing.app, "2000-01-01").expect(409, { error: "policy_outdated" });
    expect(missing.loadInputs).not.toHaveBeenCalled();
    expect(missing.connect).not.toHaveBeenCalled();
  });

  it("runs without asking again while the active consent still counts (2026-10-25 or later)", async () => {
    const kept = setup({ state: { consent: "2026-10-25" } });
    await create(kept.app, "").expect(201);
    expect(kept.sql().some((sql) => sql.includes("INSERT INTO data_consents"))).toBe(false);
    await create(setup({ state: { consent: "2026-10-24" } }).app, "").expect(400, { error: "consent_required" });
  });

  it("rejects unexpected body fields", async () => {
    await create(setup().app).send({ userId: "someone" }).expect(400, { error: "invalid_input" });
  });

  it("lets the student's cố vấn học tập run it without the student's consent, and records none (policy 2026-11-03)", async () => {
    for (const header of ["", TRANSCRIPT_POLICY_VERSION, "2000-01-01"]) {
      const t = setup({ advisor: true });
      await create(t.app, header).expect(201);
      expect(t.loadInputs).toHaveBeenCalledWith(expect.anything(), studentId, {});
      expect(t.sql().some((sql) => sql.includes("data_consents") && !sql.includes("AS withdrawn"))).toBe(false);
      expect(t.clientQuery.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO stu_comp_assessments"))?.[1]?.[1]).toBe(studentId);
    }
  });

  it("keeps a student's withdrawal: their advisor cannot run it again for them", async () => {
    const t = setup({ advisor: true, state: { withdrawn: true } });
    await create(t.app, "").expect(409, { error: "assessment_withdrawn" });
    expect(t.loadInputs).not.toHaveBeenCalled();
    expect(t.connect).not.toHaveBeenCalled();
  });

  it("computes from the snapshot, then locks, records consent, stores and prunes in one transaction", async () => {
    const t = setup();
    const response = await create(t.app).expect(201);
    expect(t.loadInputs).toHaveBeenCalledWith(expect.anything(), studentId, {});
    expect(t.calculate).toHaveBeenCalledWith(inputs);
    expect(response.body.assessment).toMatchObject({ id: t.inserted(), result, meta: result.meta, ai: { status: "disabled", output: null } });
    const calls = t.sql();
    const order = ["BEGIN", "FOR UPDATE", "SELECT version FROM student_transcripts", "AS recent", "end_reason='superseded'",
      "INSERT INTO data_consents", "INSERT INTO stu_comp_assessments", "NOT IN (", "COMMIT"].map((part) => calls.findIndex((sql) => sql.includes(part)));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const consent = t.clientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO data_consents"));
    expect(consent?.[1]).toEqual([expect.any(String), studentId, TRANSCRIPT_POLICY_VERSION, "competency_assessment"]);
    const insert = t.clientQuery.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO stu_comp_assessments"));
    expect(insert?.[1]).toEqual([t.inserted(), studentId, transcriptVersion, JSON.stringify(result.meta), JSON.stringify(result)]);
    const prune = t.clientQuery.mock.calls.find(([sql]) => String(sql).includes("NOT IN ("));
    expect(prune?.[1]).toEqual([studentId, 20]);
    expect(t.release).toHaveBeenCalled();
  });

  it("enqueues the AI comment inside the write transaction when AI is enabled", async () => {
    const aiQueue = queue();
    const t = setup({ aiQueue });
    await create(t.app).expect(201);
    expect(aiQueue.enqueue).toHaveBeenCalledWith(expect.anything(), { assessmentId: t.inserted(), userId: studentId, result });
    const calls = t.sql();
    expect(calls.findIndex((sql) => sql.includes("SET ai_status='queued'"))).toBeLessThan(calls.indexOf("COMMIT"));
  });

  it("keeps the computed result when the AI queue is full (deferred)", async () => {
    const aiQueue = queue({ enqueue: vi.fn(async () => "deferred" as const) });
    const t = setup({ aiQueue });
    await create(t.app).expect(201);
    expect(t.sql().at(-1)).toBe("COMMIT");
  });

  it("allows one assessment per 60 seconds", async () => {
    const early = setup({ state: { recentPrecheck: true } });
    await create(early.app).expect(429, { error: "assessment_too_frequent" });
    expect(early.loadInputs).not.toHaveBeenCalled();
    const racing = setup({ state: { recentInTx: true } });
    await create(racing.app).expect(429, { error: "assessment_too_frequent" });
    expect(racing.sql()).toContain("ROLLBACK");
    expect(racing.sql().some((sql) => sql.startsWith("INSERT INTO stu_comp_assessments"))).toBe(false);
  });

  it("refuses to store a result when the transcript changed after the snapshot", async () => {
    for (const transcript of ["88888888-8888-4888-8888-888888888888", null]) {
      const t = setup({ state: { transcript } });
      await create(t.app).expect(409, { error: "transcript_changed" });
      expect(t.sql()).toContain("ROLLBACK");
      expect(t.sql().some((sql) => sql.includes("INSERT INTO data_consents"))).toBe(false);
    }
  });

  it("refuses when the account was deactivated before the write", async () => {
    const t = setup();
    t.clientQuery.mockImplementationOnce(async () => ({ rowCount: 0, rows: [] })); // BEGIN
    t.clientQuery.mockImplementationOnce(async () => ({ rowCount: 0, rows: [] })); // user lock: not active
    await create(t.app).expect(403, { error: "account_unavailable" });
  });

  it.each(["transcript_required", "cohort_unknown", "curriculum_unavailable", "curriculum_ambiguous", "competency_weights_unavailable"])(
    "returns %s from the snapshot reader", async (code) => {
      const t = setup({ loadError: new AssessmentError(code, 409) });
      await create(t.app).expect(409, { error: code });
      expect(t.connect).not.toHaveBeenCalled();
    });
});

describe("GET /latest and /latest/status", () => {
  it("returns only the student's newest assessment with the AI state", async () => {
    const t = setup();
    const response = await request(t.app).get("/assessments/latest").expect(200);
    expect(response.body).toMatchObject({ assessment: { id: latestId, ai: { status: "failed" } }, aiEnabled: false, workerOnline: false, consentVersion: null });
    expect(t.poolQuery.mock.calls.find(([sql]) => String(sql).startsWith("SELECT id,created_at,meta"))?.[1]).toEqual([studentId]);
    const status = await request(t.app).get("/assessments/latest/status").expect(200);
    expect(status.body).toEqual({ id: latestId, aiStatus: "failed", aiErrorCode: null, workerOnline: false });
  });

  it("reports the worker heartbeat when AI is enabled and null when nothing exists", async () => {
    const t = setup({ aiQueue: queue(), state: { rows: [] } });
    await request(t.app).get("/assessments/latest").expect(200, { assessment: null, aiEnabled: true, workerOnline: true, consentVersion: null, previous: null });
    await request(t.app).get("/assessments/latest/status").expect(200, { id: null, aiStatus: null, aiErrorCode: null, workerOnline: true });
  });

  it("returns this student's active competency consent version", async () => {
    const t = setup({ state: { consent: TRANSCRIPT_POLICY_VERSION } });
    const response = await request(t.app).get("/assessments/latest").expect(200);
    expect(response.body.consentVersion).toBe(TRANSCRIPT_POLICY_VERSION);
    const consentQuery = t.poolQuery.mock.calls.find(([sql]) => String(sql).startsWith("SELECT policy_version FROM data_consents"))!;
    expect(consentQuery[0]).toContain("ended_at IS NULL");
    expect(consentQuery[1]).toEqual([studentId, "competency_assessment"]);
  });

  it("returns AI output only for completed comments", async () => {
    const t = setup({ state: { rows: [{ id: olderId, user_id: studentId, ai_status: "completed", created_at: "2026-10-10T02:00:00.000Z" }] } });
    const response = await request(t.app).get("/assessments/latest").expect(200);
    expect(response.body.assessment.ai.output).toEqual({ summary: "x" });
  });
});

describe("GET /latest thesisPlanOutdated (comp-calc-v23, user 2026-11-10)", () => {
  const computed = { ...result, excludedThesisReplacements: ["71ITGR40203", "71ITGR40206"] } as unknown as AssessmentResult;
  const rows = [{ id: latestId, user_id: studentId, ai_status: "failed", created_at: "2026-10-11T02:00:00.000Z", computed }];
  const plan = (...codes: string[]) => ({ schemaVersion: 1, terms: [{ code: "HK262", courses: codes.map((code) => ({ code })) }] });
  it("names the thesis group's courses the student placed that the stored result leaves out, so the page asks for Đánh giá lại", async () => {
    const response = await request(setup({ state: { rows, studyPlan: plan("71ITGR40206", "71ITIN40304") } }).app).get("/assessments/latest").expect(200);
    expect(response.body.thesisPlanOutdated).toEqual(["71ITGR40206"]);
  });
  it("is absent when the plan holds nothing the result leaves out, or there is no plan", async () => {
    for (const studyPlan of [plan("71ITIN40304"), undefined]) {
      const response = await request(setup({ state: { rows, studyPlan } }).app).get("/assessments/latest").expect(200);
      expect(response.body).not.toHaveProperty("thesisPlanOutdated");
    }
  });
});

describe("GET /latest previous (the older comment shown dimmed, like Xét tốt nghiệp)", () => {
  // Synthetic: the older assessment names its keys differently from the newest one (keys are per assessment).
  const older = {
    meta: { calcVersion: "comp-calc-v18", promptVersion: "comp-v12", transcriptVersion },
    skillDirectory: [{ key: "S01", skillId: "skill-a", name: "Lập trình web", measured: true }, { key: "S02", skillId: "skill-b", name: "Docker", measured: false }],
    groups: [{ key: "G1", id: "group-1", name: "Kiến thức chuyên môn", score: 80, level: "good", skillCount: 2 }],
    career: { id: "career-1", nameVi: "Lập trình viên web", requirements: [
      { requirementId: "r1", skillKey: "S01", status: "met", threshold: 70, score: 91 },
      { requirementId: "r2", skillKey: null, status: "no_data", threshold: 60, score: null },
    ] },
    courses: [{ code: "TST104", name: "Lập trình web", credits: 3, state: "passed", score10: 9.1 }],
    courseSuggestions: [{ code: "TST105", name: "Kiểm thử phần mềm", credits: 3, kind: "take", priority: 4 }],
    overall: { score: 80 },
  } as unknown as AssessmentResult;
  const rows = (latest: string) => [
    { id: latestId, user_id: studentId, ai_status: latest, created_at: "2026-10-11T02:00:00.000Z" },
    { id: olderId, user_id: studentId, ai_status: "completed", created_at: "2026-10-10T02:00:00.000Z", computed: older },
    { id: foreignId, user_id: "77777777-7777-4777-8777-777777777777", ai_status: "completed", created_at: "2026-10-09T03:00:00.000Z" },
  ];

  it.each(["queued", "processing", "failed", "cancelled", "deferred", "disabled"])("is the newest older completed comment while the newest is %s", async (status) => {
    const t = setup({ aiQueue: queue(), state: { rows: rows(status) } });
    const response = await request(t.app).get("/assessments/latest").expect(200);
    expect(response.body.assessment).toMatchObject({ id: latestId, ai: { status, output: null } });
    expect(response.body.previous).toEqual({
      assessmentId: olderId, assessmentCreatedAt: "2026-10-10T02:00:00.000Z", model: "gemma4:e4b", completedAt: "2026-10-10T02:04:00.000Z",
      promptVersion: "comp-v13", output: { summary: "x" },
      // Its own names and career, trimmed to what the page reads (no scores, ids or course details).
      context: {
        skillDirectory: [{ key: "S01", name: "Lập trình web" }, { key: "S02", name: "Docker" }],
        groups: [{ key: "G1", name: "Kiến thức chuyên môn" }],
        career: { requirements: [{ skillKey: "S01", status: "met" }, { skillKey: null, status: "no_data" }] },
        courses: [{ code: "TST104", name: "Lập trình web" }],
        courseSuggestions: [{ code: "TST105", name: "Kiểm thử phần mềm" }],
      },
    });
    // The newest assessment keeps its own result; the lookup is the student's, before the newest one.
    expect(response.body.assessment.result).toEqual(result);
    const lookup = t.poolQuery.mock.calls.find(([sql]) => String(sql).includes("ai_status='completed' AND ai_output IS NOT NULL"))!;
    expect(lookup[1]).toEqual([studentId, latestId]);
    expect(String(lookup[0])).toContain("(created_at,id)<(SELECT l.created_at,l.id FROM stu_comp_assessments l WHERE l.id=$2 AND l.user_id=$1)");
  });

  it("is null, and never looked up, once the newest comment is completed", async () => {
    const t = setup({ aiQueue: queue(), state: { rows: rows("completed") } });
    const response = await request(t.app).get("/assessments/latest").expect(200);
    expect(response.body.assessment.ai.status).toBe("completed");
    expect(response.body.previous).toBeNull();
    expect(t.poolQuery.mock.calls.some(([sql]) => String(sql).includes("ai_status='completed' AND ai_output IS NOT NULL"))).toBe(false);
  });

  it("is null without an older completed comment, and leaves out another student's", async () => {
    const t = setup({ aiQueue: queue(), state: { rows: [rows("failed")[0]!, rows("failed")[2]!] } });
    expect((await request(t.app).get("/assessments/latest").expect(200)).body.previous).toBeNull();
  });

  it("goes with an older result without a target career", async () => {
    const t = setup({ aiQueue: queue(), state: { rows: [rows("queued")[0]!, { ...rows("queued")[1]!, computed: { ...older, career: null } }] } });
    expect((await request(t.app).get("/assessments/latest").expect(200)).body.previous.context.career).toBeNull();
  });

  it("is the same for the student's cố vấn học tập working in the student's page", async () => {
    const t = setup({ aiQueue: queue(), advisor: true, state: { rows: rows("processing") } });
    const response = await request(t.app).get("/assessments/latest").expect(200);
    expect(response.body.previous).toMatchObject({ assessmentId: olderId, context: { skillDirectory: [{ key: "S01", name: "Lập trình web" }, { key: "S02", name: "Docker" }] } });
    expect(t.poolQuery.mock.calls.find(([sql]) => String(sql).includes("ai_status='completed' AND ai_output IS NOT NULL"))?.[1]).toEqual([studentId, latestId]);
  });
});

describe("POST /:id/ai", () => {
  it("is unavailable while AI is disabled", async () => {
    await request(setup().app).post(`/assessments/${latestId}/ai`).set("Origin", origin).expect(409, { error: "ai_disabled" });
  });

  it("regenerates the newest failed comment", async () => {
    const aiQueue = queue();
    const t = setup({ aiQueue });
    await request(t.app).post(`/assessments/${latestId}/ai`).set("Origin", origin).expect(202, { aiStatus: "queued" });
    expect(aiQueue.regenerate).toHaveBeenCalledWith(expect.anything(), { assessmentId: latestId, userId: studentId, result });
    expect(t.sql().at(-1)).toBe("COMMIT");
  });

  it("answers 429 queue_full when the queue defers the job", async () => {
    const t = setup({ aiQueue: queue({ regenerate: vi.fn(async () => "deferred" as const) }) });
    await request(t.app).post(`/assessments/${latestId}/ai`).set("Origin", origin).expect(429, { error: "queue_full" });
  });

  it("refuses completed, older and foreign assessments", async () => {
    const t = setup({ aiQueue: queue(), state: { rows: [{ id: latestId, user_id: studentId, ai_status: "completed", created_at: "2026-10-11T02:00:00.000Z" }] } });
    await request(t.app).post(`/assessments/${latestId}/ai`).set("Origin", origin).expect(409, { error: "ai_not_regenerable" });
    const older = setup({ aiQueue: queue() });
    older.state.rows[1]!.ai_status = "failed";
    await request(older.app).post(`/assessments/${olderId}/ai`).set("Origin", origin).expect(409, { error: "ai_not_regenerable" });
    const aiQueue = queue();
    const foreign = setup({ aiQueue });
    await request(foreign.app).post(`/assessments/${foreignId}/ai`).set("Origin", origin).expect(404, { error: "assessment_not_found" });
    await request(foreign.app).post("/assessments/not-a-uuid/ai").set("Origin", origin).expect(404, { error: "assessment_not_found" });
    expect(aiQueue.regenerate).not.toHaveBeenCalled();
    const lookup = foreign.clientQuery.mock.calls.find(([sql]) => String(sql).startsWith("SELECT a.id,a.ai_status"));
    expect(lookup?.[1]).toEqual([foreignId, studentId]);
  });
});

describe("DELETE /:id/ai", () => {
  it("cancels the pending comment of the student's own assessment", async () => {
    const aiQueue = queue();
    const t = setup({ aiQueue });
    await request(t.app).delete(`/assessments/${latestId}/ai`).set("Origin", origin).expect(200, { cancelled: true });
    expect(aiQueue.cancel).toHaveBeenCalledWith(expect.anything(), { assessmentId: latestId, userId: studentId });
    await request(t.app).delete(`/assessments/${foreignId}/ai`).set("Origin", origin).expect(404, { error: "assessment_not_found" });
    expect(aiQueue.cancel).toHaveBeenCalledTimes(1);
  });

  it("reports nothing cancelled without an AI queue", async () => {
    await request(setup().app).delete(`/assessments/${latestId}/ai`).set("Origin", origin).expect(200, { cancelled: false });
  });
});

describe("DELETE / (withdraw consent)", () => {
  it("requires explicit confirmation", async () => {
    const t = setup();
    await request(t.app).delete("/assessments").set("Origin", origin).send({}).expect(400, { error: "invalid_input" });
    await request(t.app).delete("/assessments").set("Origin", origin).send({ confirmed: true, all: true }).expect(400, { error: "invalid_input" });
    expect(t.connect).not.toHaveBeenCalled();
  });

  it("deletes every job and result of the student and withdraws the consent", async () => {
    const t = setup();
    await request(t.app).delete("/assessments").set("Origin", origin).send({ confirmed: true }).expect(200, { deleted: true });
    const calls = t.clientQuery.mock.calls.map(([sql, params]) => [String(sql), params] as const);
    const jobs = calls.findIndex(([sql]) => sql === "DELETE FROM stu_comp_ai_jobs WHERE user_id=$1");
    const results = calls.findIndex(([sql]) => sql === "DELETE FROM stu_comp_assessments WHERE user_id=$1");
    const withdrawn = calls.findIndex(([sql]) => sql.includes("end_reason='withdrawn'"));
    expect(calls[1]?.[0]).toContain("FOR UPDATE");
    expect(jobs).toBeGreaterThan(1);
    expect(results).toBeGreaterThan(jobs);
    expect(calls[results]?.[1]).toEqual([studentId]);
    expect(calls[withdrawn]?.[1]).toEqual([studentId, "competency_assessment"]);
    expect(calls.at(-1)?.[0]).toBe("COMMIT");
  });
});
