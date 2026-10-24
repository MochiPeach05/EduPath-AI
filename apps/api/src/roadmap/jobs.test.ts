import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimRoadmap, completeRoadmap, createRoadmap, createRoadmapExpiry, expireRoadmaps, extendRoadmap, RoadmapError, type RoadmapRow } from "./jobs.js";
import { TRANSCRIPT_POLICY_VERSION } from "../student/consent.js";
import { surveyFacts } from "../student/survey.js";
import { buildRoadmapInput, ROADMAP_PROMPT_VERSION } from "./prompt.js";
import { ROADMAP_ASSESSMENT, ROADMAP_NOW, syntheticRoadmapFacts, syntheticRoadmapResult, syntheticSurveyRow } from "./test-fixture.js";

// Synthetic K29 data only (fixtures/synthetic-k29.json plus invented grades); no real student record.
const USER = "11111111-1111-4111-8111-111111111111";
const ROADMAP = "44444444-4444-4444-8444-444444444444";
const LEASE = "55555555-5555-4555-8555-555555555555";
const OTHER_LEASE = "66666666-6666-4666-8666-666666666666";
const OLD_ASSESSMENT = "77777777-7777-4777-8777-777777777777";
const facts = syntheticRoadmapFacts();
const survey = syntheticSurveyRow();
const aiInput = buildRoadmapInput(facts, surveyFacts({ answers: survey.answers, interestTech: survey.interest_tech, interestHobbies: survey.interest_hobbies,
  hasAchievements: survey.has_achievements, achievements: survey.achievements }));

const row = (extra: Partial<RoadmapRow> = {}): RoadmapRow => ({
  id: ROADMAP, assessmentId: ROADMAP_ASSESSMENT, status: "completed", errorCode: null, createdAt: new Date("2026-10-24T02:00:00Z"),
  completedAt: new Date("2026-10-24T02:03:00Z"), model: "gemma4:e4b", facts, output: null, recent: false, ...extra,
});

type State = { rows?: RoadmapRow[]; othersPending?: number; active?: boolean; assessment?: boolean; survey?: boolean; consent?: string | null };

function fakeClient(state: State = {}) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.startsWith("SELECT id FROM users")) return state.active === false ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ id: USER }] };
    if (sql.includes("FROM stu_comp_assessments WHERE user_id=$1 ORDER BY")) {
      return state.assessment === false ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ id: ROADMAP_ASSESSMENT, createdAt: new Date("2026-10-24T01:00:00Z"), computed: syntheticRoadmapResult() }] };
    }
    if (sql.includes("FROM stu_profile_surveys WHERE user_id=$1")) return state.survey === false ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [survey] };
    if (sql.includes("FROM data_consents")) {
      const version = state.consent === undefined ? TRANSCRIPT_POLICY_VERSION : state.consent;
      return version ? { rowCount: 1, rows: [{ policy_version: version }] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM stu_roadmaps WHERE user_id=$1 ORDER BY created_at DESC,id DESC")) return { rowCount: state.rows?.length ?? 0, rows: state.rows ?? [] };
    if (sql.includes("count(*)::int AS count FROM stu_roadmaps")) return { rowCount: 1, rows: [{ count: state.othersPending ?? 0 }] };
    if (sql.startsWith("INSERT INTO stu_roadmaps")) return { rowCount: 1, rows: [{ createdAt: new Date("2026-10-24T03:00:00Z") }] };
    return { rowCount: 0, rows: [] };
  });
  const calls = () => query.mock.calls.map(([sql, params]) => [sql, params ?? []] as const);
  return { client: { query } as unknown as PoolClient, query, calls, sql: () => calls().map(([sql]) => sql) };
}
const writes = (sql: string[]) => sql.filter((text) => /^(INSERT|UPDATE|DELETE)/.test(text.trim()));

afterEach(() => vi.restoreAllMocks());

describe("createRoadmap", () => {
  it("locks the student's row, then the queue, and builds the roadmap from the newest assessment", async () => {
    const { client, sql, calls } = fakeClient();
    const expire = vi.fn(async () => true);
    const outcome = await createRoadmap(client, USER, { expire, now: ROADMAP_NOW });
    expect(sql()[0]).toBe("SELECT id FROM users WHERE id=$1 AND is_active FOR KEY SHARE");
    expect(calls()[1]).toEqual(["SELECT pg_advisory_xact_lock(hashtext($1))", ["edupath:study-roadmap"]]);
    expect(expire).toHaveBeenCalledWith(client);
    expect(outcome.created).toBe(true);
    expect(outcome.row).toMatchObject({ assessmentId: ROADMAP_ASSESSMENT, status: "queued", output: null, recent: true });
    expect(outcome.row.facts.window.start).toBe("2026-10-24");

    const [cancel, insert, prune] = writes(sql());
    expect(cancel).toContain("UPDATE stu_roadmaps SET status='cancelled',ai_input=NULL");
    expect(insert).toContain("INSERT INTO stu_roadmaps");
    expect(prune).toContain("DELETE FROM stu_roadmaps WHERE user_id=$1 AND status NOT IN ('queued','processing')");
    const params = calls().find(([text]) => text.startsWith("INSERT INTO stu_roadmaps"))![1] as unknown[];
    expect(params.slice(1, 5)).toEqual([USER, ROADMAP_ASSESSMENT, "2026-10-24", "2027-01-23"]);
    expect(JSON.parse(params[5] as string)).toEqual(facts);
    expect(JSON.parse(params[6] as string)).toEqual(aiInput);
    expect(params[7]).toBe(ROADMAP_PROMPT_VERSION);
    expect(calls().find(([text]) => text.startsWith("DELETE FROM stu_roadmaps"))![1]).toEqual([USER, 5]);
  });

  it("returns a roadmap still being written for the same assessment unchanged", async () => {
    for (const status of ["queued", "processing"] as const) {
      const pending = row({ status, completedAt: null, recent: true });
      const { client, sql } = fakeClient({ rows: [pending] });
      expect(await createRoadmap(client, USER, { now: ROADMAP_NOW })).toEqual({ row: pending, created: false });
      expect(writes(sql())).toEqual([]);
    }
  });

  it("cancels a pending roadmap of an older assessment and queues a new one", async () => {
    const { client, sql } = fakeClient({ rows: [row({ status: "processing", assessmentId: OLD_ASSESSMENT, completedAt: null })] });
    expect((await createRoadmap(client, USER, { now: ROADMAP_NOW })).created).toBe(true);
    expect(writes(sql())[0]).toContain("status='cancelled'");
  });

  it("creates at most one roadmap per student per 30 seconds, and none while 20 of other students wait", async () => {
    await expect(createRoadmap(fakeClient({ rows: [row({ recent: true })] }).client, USER)).rejects.toEqual(new RoadmapError("roadmap_too_frequent", 429));
    const full = fakeClient({ rows: [row()], othersPending: 20 });
    await expect(createRoadmap(full.client, USER)).rejects.toMatchObject({ code: "queue_full", status: 429 });
    expect(writes(full.sql())).toEqual([]);
    // A completed roadmap of the same assessment may be written again ("Tạo lại").
    expect((await createRoadmap(fakeClient({ rows: [row()], othersPending: 19 }).client, USER, { now: ROADMAP_NOW })).created).toBe(true);
  });

  it("passes the profile survey to the AI only, never into the stored facts", async () => {
    const { client, calls } = fakeClient();
    await createRoadmap(client, USER, { now: ROADMAP_NOW });
    const params = calls().find(([text]) => text.startsWith("INSERT INTO stu_roadmaps"))![1] as unknown[];
    const user = (JSON.parse(params[6] as string) as { user: string }).user;
    expect(user).toContain("[8. HỒ SƠ ĐỊNH HƯỚNG] (sinh viên tự khai)");
    expect(user).toContain("- Mục tiêu sau tốt nghiệp: Đi làm ngay");
    expect(user).toContain("- Thời gian tự học mỗi tuần: 5–10 giờ");
    expect(user).toContain("- Công nghệ bạn thích: Web front-end (HTML, CSS, JavaScript, React); Trí tuệ nhân tạo, học máy");
    expect(user).toContain("- Sở thích khi rảnh: Tự làm dự án, viết code; Thể thao, vận động");
    expect(user).toContain("  + Giải Ba cuộc thi lập trình cấp khoa 2025\n  + Học bổng khuyến khích học tập");
    expect(params[5] as string).not.toContain("Giải Ba");
  });

  it("needs an assessment, the answered profile survey and an active account", async () => {
    await expect(createRoadmap(fakeClient({ assessment: false }).client, USER)).rejects.toMatchObject({ code: "assessment_required", status: 409 });
    const noSurvey = fakeClient({ survey: false });
    await expect(createRoadmap(noSurvey.client, USER)).rejects.toMatchObject({ code: "survey_required", status: 409 });
    expect(writes(noSurvey.sql())).toEqual([]);
    // Answers agreed to under an older policy (before the interests joined) wait for the new consent.
    await expect(createRoadmap(fakeClient({ consent: "2026-10-24" }).client, USER)).rejects.toMatchObject({ code: "survey_required", status: 409 });
    await expect(createRoadmap(fakeClient({ consent: null }).client, USER)).rejects.toMatchObject({ code: "survey_required", status: 409 });
    const inactive = fakeClient({ active: false });
    await expect(createRoadmap(inactive.client, USER)).rejects.toMatchObject({ code: "account_unavailable", status: 403 });
    expect(inactive.sql()).toHaveLength(1);
  });
});

describe("housekeeping", () => {
  it("fails stuck roadmaps and clears their input, at most once per interval", async () => {
    const { client, calls } = fakeClient();
    await expireRoadmaps(client);
    const [sql, params] = calls()[0]!;
    expect(sql).toContain("(status='queued' AND created_at<now()-interval '24 hours')");
    expect(sql).toContain("ai_input=NULL");
    expect(params).toEqual([2, "worker_timeout"]);
    const expire = createRoadmapExpiry(60_000);
    const db = fakeClient();
    expect(await expire(db.client)).toBe(true);
    expect(await expire(db.client)).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe("worker side", () => {
  const locked = (extra: Record<string, unknown> = {}) => ({ status: "processing", lease_token: LEASE, valid: true, ai_input: aiInput, ...extra });
  function workerClient(job: Record<string, unknown> | null) {
    const query = vi.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes("FROM stu_roadmaps WHERE id=$1 FOR UPDATE") ? { rowCount: job ? 1 : 0, rows: job ? [job] : [] } : { rowCount: 1, rows: [] });
    const update = () => query.mock.calls.find(([sql]) => sql.startsWith("UPDATE stu_roadmaps SET status=$2"));
    return { client: { query } as unknown as PoolClient, update };
  }
  const success = (output: unknown) => ({ leaseToken: LEASE, model: "gemma4:e4b", digest: "dc35e8d9c606", ollamaVersion: "0.40.2", metrics: { eval_count: 1500 }, output });
  const output = {
    summary: "Ba tháng tới bạn tập trung học lại Cơ sở lập trình.",
    study: [{ code: "71ITIS30203", advice: "Đăng ký sớm." }], improve: [{ code: "71ITBS10203", advice: "Học lại ngay." }],
    skills: [{ key: "S02", why: "Cần cho nghề.", steps: ["Cài Docker."], outcome: "Chạy được container." }],
    months: [{ month: "1", focus: "Bắt đầu.", tasks: ["Ôn tập."] }, { month: "2", focus: "Học lại.", tasks: ["Đăng ký."] }, { month: "3", focus: "Tự học.", tasks: ["Làm dự án."] }],
  };

  it("claims the oldest runnable roadmap with SKIP LOCKED and a 15 minute lease, and extends only a live lease", async () => {
    const { client, calls } = fakeClient();
    expect(await claimRoadmap(client, LEASE)).toBeNull();
    const [sql, params] = calls()[0]!;
    expect(sql).toContain("FROM stu_roadmaps");
    expect(sql).toContain("ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1");
    expect(params).toEqual([LEASE, 2, 15]);
    expect(await extendRoadmap(client, ROADMAP, LEASE)).toBeNull();
    expect(calls()[1]![0]).toContain("WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now()");
  });

  it("stores the validated output with the model metadata and clears the input", async () => {
    const { client, update } = workerClient(locked());
    expect(await completeRoadmap(client, ROADMAP, success(output))).toBe("ok");
    const [sql, params] = update()!;
    expect(sql).toContain("ai_input=NULL");
    expect((params as unknown[]).slice(0, 3)).toEqual([ROADMAP, "completed", null]);
    expect(JSON.parse((params as unknown[])[3] as string)).toMatchObject({ summary: output.summary, months: [{ month: 1 }, { month: 2 }, { month: 3 }] });
    expect((params as unknown[]).slice(5)).toEqual(["gemma4:e4b", "dc35e8d9c606", "0.40.2", ROADMAP_PROMPT_VERSION]);
  });

  it("fails with invalid_ai_output or the worker's error code", async () => {
    const invalid = workerClient(locked());
    expect(await completeRoadmap(invalid.client, ROADMAP, success({ summary: "x" }))).toBe("ok");
    expect((invalid.update()![1] as unknown[]).slice(0, 4)).toEqual([ROADMAP, "failed", "invalid_ai_output", null]);
    const errored = workerClient(locked());
    expect(await completeRoadmap(errored.client, ROADMAP, { leaseToken: LEASE, error: "ai_output_truncated" })).toBe("ok");
    expect((errored.update()![1] as unknown[]).slice(0, 3)).toEqual([ROADMAP, "failed", "ai_output_truncated"]);
  });

  it("is idempotent for the same lease, expired for another or lost lease or a cancelled row, and missing for an unknown id", async () => {
    const done = workerClient(locked({ status: "completed", valid: null, ai_input: null }));
    expect(await completeRoadmap(done.client, ROADMAP, success(output))).toBe("ok");
    expect(done.update()).toBeUndefined();
    for (const job of [locked({ lease_token: OTHER_LEASE }), locked({ valid: false }), locked({ status: "cancelled", lease_token: null })]) {
      const expired = workerClient(job);
      expect(await completeRoadmap(expired.client, ROADMAP, success(output))).toBe("expired");
      expect(expired.update()).toBeUndefined();
    }
    expect(await completeRoadmap(workerClient(null).client, ROADMAP, success(output))).toBe("missing");
  });
});
