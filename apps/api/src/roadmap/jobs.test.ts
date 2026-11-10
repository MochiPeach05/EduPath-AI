import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimRoadmap, completeRoadmap, createRoadmap, createRoadmapExpiry, expireRoadmaps, extendRoadmap, promoteDeferredRoadmaps, readRoadmapRelations, retryInput, RoadmapError, ROADMAP_RETRY_CODE, type RoadmapRow } from "./jobs.js";
import type { DatabasePool } from "../db/pool.js";
import type { AssessmentResult as RoadmapRelationResult } from "../competency-assessment/types.js";
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
const aiInput = buildRoadmapInput(facts, surveyFacts({ answers: survey.answers, interestTech: survey.interest_tech,
  interestHobbies: survey.interest_hobbies, hasAchievements: survey.has_achievements, achievements: survey.achievements }));

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
    expect(outcome.row.facts.window.start).toBe("2026-12-21");

    const [cancel, insert, prune] = writes(sql());
    expect(cancel).toContain("UPDATE stu_roadmaps SET status='cancelled',ai_input=NULL");
    expect(insert).toContain("INSERT INTO stu_roadmaps");
    expect(cancel).toContain("WHERE user_id=$1 AND status IN ('deferred','queued','processing')");
    expect(prune).toContain("DELETE FROM stu_roadmaps WHERE user_id=$1 AND status NOT IN ('deferred','queued','processing')");
    const params = calls().find(([text]) => text.startsWith("INSERT INTO stu_roadmaps"))![1] as unknown[];
    expect(params.slice(1, 5)).toEqual([USER, ROADMAP_ASSESSMENT, "2026-12-21", "2027-04-04"]);
    expect(JSON.parse(params[5] as string)).toEqual(facts);
    expect(params[6]).toBe("queued");
    expect(JSON.parse(params[7] as string)).toEqual(aiInput);
    expect(params[8]).toBe(ROADMAP_PROMPT_VERSION);
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

  it("creates at most one roadmap per student per 30 seconds, and stores it deferred while 20 of other students wait (2026-11-10)", async () => {
    await expect(createRoadmap(fakeClient({ rows: [row({ recent: true })] }).client, USER)).rejects.toEqual(new RoadmapError("roadmap_too_frequent", 429));
    const full = fakeClient({ rows: [row()], othersPending: 20 });
    const deferred = await createRoadmap(full.client, USER, { now: ROADMAP_NOW });
    expect(deferred).toMatchObject({ created: true, row: { status: "deferred", output: null, facts: { window: { start: "2026-12-21" } } } });
    const params = full.calls().find(([text]) => text.startsWith("INSERT INTO stu_roadmaps"))![1] as unknown[];
    // The facts the page shows at once; no AI input waits with the survey in it.
    expect(JSON.parse(params[5] as string)).toEqual(facts);
    expect(params.slice(6)).toEqual(["deferred", null, ROADMAP_PROMPT_VERSION]);
    expect(full.calls().find(([text]) => text.includes("count(*)"))).toEqual([expect.stringContaining("user_id IS DISTINCT FROM $1"), [USER]]);
    // Asked again while still deferred for the same assessment and the queue is still full: unchanged.
    const waiting = row({ status: "deferred", completedAt: null, model: null });
    const again = fakeClient({ rows: [waiting], othersPending: 20 });
    expect(await createRoadmap(again.client, USER, { now: ROADMAP_NOW })).toEqual({ row: waiting, created: false });
    expect(writes(again.sql())).toEqual([]);
    // With room, "Tạo lại" queues it at once (the deferred row is cancelled).
    const roomy = fakeClient({ rows: [waiting], othersPending: 19 });
    expect(await createRoadmap(roomy.client, USER, { now: ROADMAP_NOW })).toMatchObject({ created: true, row: { status: "queued" } });
    expect(writes(roomy.sql())[0]).toContain("status IN ('deferred','queued','processing')");
    // A completed roadmap of the same assessment may be written again ("Tạo lại").
    expect((await createRoadmap(fakeClient({ rows: [row()], othersPending: 19 }).client, USER, { now: ROADMAP_NOW })).created).toBe(true);
  });

  it("passes the profile survey to the AI only, never into the stored facts", async () => {
    const { client, calls } = fakeClient();
    await createRoadmap(client, USER, { now: ROADMAP_NOW });
    const params = calls().find(([text]) => text.startsWith("INSERT INTO stu_roadmaps"))![1] as unknown[];
    const user = (JSON.parse(params[7] as string) as { user: string }).user;
    expect(user).toContain("[8. BẠN TỰ KHAI TRONG KHẢO SÁT ĐỊNH HƯỚNG] (chưa kiểm chứng)");
    // roadmap-v9: what the system has on record about those claims, next to them.
    expect(user).toContain("[9. HỆ THỐNG GHI NHẬN VỀ CÁC ĐIỀU BẠN TỰ KHAI] (từ bảng điểm và kết quả đánh giá)\n"
      + "- Chưa có minh chứng (chưa có điểm từ học phần nào): Web front-end, HTML, CSS, JavaScript, React, Trí tuệ nhân tạo, học máy\n"
      + "- Học phần thực tập trong chương trình: Đồ án thực tập (chưa học)");
    expect(user).toContain("- Mục tiêu sau tốt nghiệp: Đi làm ngay");
    expect(user).toContain("- Thời gian tự học mỗi tuần: 5–10 giờ");
    expect(user).toContain("- Thế mạnh (công nghệ thành thạo): Web front-end (HTML, CSS, JavaScript, React); Trí tuệ nhân tạo, học máy");
    // survey-v4: no written description of the strengths reaches the AI, even one still stored from survey-v3.
    expect(user).not.toContain("Mô tả thế mạnh");
    expect(user).not.toContain("Thành thạo React");
    expect(user).toContain("- Sở trường: Tự làm dự án, viết code; Thể thao, vận động");
    expect(user).toContain("  + Giải Ba cuộc thi lập trình cấp khoa 2025\n  + Học bổng khuyến khích học tập");
    expect(params[5] as string).not.toContain("Giải Ba");
    expect(params[5] as string).not.toContain("Thành thạo React");
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

describe("promoteDeferredRoadmaps (QA 2026-11-10: deferred roadmaps come back by themselves)", () => {
  const OTHER = "88888888-8888-4888-8888-888888888888";
  const SECOND = "99999999-9999-4999-8999-999999999999";
  type Promote = { candidates: { id: string; userId: string }[]; pending?: number; locked?: string[]; survey?: boolean };
  function promotePool(state: Promote) {
    const base = fakeClient(state.survey === false ? { survey: false } : {});
    const log: [string, unknown[]][] = [];
    let pending = state.pending ?? 0;
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      log.push([sql, params]);
      if (sql.includes("FROM stu_roadmaps r JOIN users u")) return { rowCount: state.candidates.length, rows: state.candidates };
      if (sql.startsWith("SELECT id FROM users")) return state.locked?.includes(params[0] as string) ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ id: params[0] }] };
      if (sql.includes("count(*)::int AS count FROM stu_roadmaps")) return { rowCount: 1, rows: [{ count: pending }] };
      if (sql.startsWith("SELECT id FROM stu_roadmaps WHERE id=$1")) return { rowCount: 1, rows: [{ id: params[0] }] };
      if (sql.startsWith("UPDATE stu_roadmaps SET status='queued'")) { pending += 1; return { rowCount: 1, rows: [] }; }
      return base.query(sql, params);
    });
    const release = vi.fn();
    const pool = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
    return { pool, log, release };
  }
  const queuedIds = (log: [string, unknown[]][]) => log.filter(([sql]) => sql.startsWith("UPDATE stu_roadmaps SET status='queued'")).map(([, params]) => params[0]);

  it("queues the oldest deferred roadmap of an active student in place, built now, in the lock order of createRoadmap", async () => {
    const { pool, log, release } = promotePool({ candidates: [{ id: ROADMAP, userId: USER }] });
    expect(await promoteDeferredRoadmaps(pool, { now: ROADMAP_NOW })).toBe(1);
    expect(log[0]![0]).toContain("JOIN users u ON u.id=r.user_id AND u.is_active");
    expect(log[0]![0]).toContain("WHERE r.status='deferred' ORDER BY r.created_at,r.id LIMIT $1");
    expect(log[0]![1]).toEqual([20]);
    expect(log[1]![0]).toBe("BEGIN");
    expect(log[2]![0]).toBe("SELECT id FROM users WHERE id=$1 AND is_active FOR KEY SHARE SKIP LOCKED");
    expect(log[3]).toEqual(["SELECT pg_advisory_xact_lock(hashtext($1))", ["edupath:study-roadmap"]]);
    expect(log[4]).toEqual([expect.stringContaining("user_id IS DISTINCT FROM $1"), [null]]);
    const update = log.find(([sql]) => sql.startsWith("UPDATE stu_roadmaps SET status='queued'"))!;
    expect(update[0]).toContain("created_at=now()");
    expect(update[1].slice(0, 4)).toEqual([ROADMAP, ROADMAP_ASSESSMENT, "2026-12-21", "2027-04-04"]);
    expect(JSON.parse(update[1][4] as string)).toEqual(facts);
    expect(JSON.parse(update[1][5] as string)).toEqual(aiInput);
    expect(update[1][6]).toBe(ROADMAP_PROMPT_VERSION);
    expect(log.at(-1)![0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fills only the room left, oldest first, skips a student whose row a write holds, and waits while the queue is full", async () => {
    const one = promotePool({ candidates: [{ id: ROADMAP, userId: USER }, { id: SECOND, userId: OTHER }], pending: 19 });
    expect(await promoteDeferredRoadmaps(one.pool, { now: ROADMAP_NOW })).toBe(1);
    expect(queuedIds(one.log)).toEqual([ROADMAP]);
    const locked = promotePool({ candidates: [{ id: ROADMAP, userId: USER }, { id: SECOND, userId: OTHER }], locked: [USER] });
    expect(await promoteDeferredRoadmaps(locked.pool, { now: ROADMAP_NOW })).toBe(1);
    expect(queuedIds(locked.log)).toEqual([SECOND]);
    const full = promotePool({ candidates: [{ id: ROADMAP, userId: USER }], pending: 20 });
    expect(await promoteDeferredRoadmaps(full.pool, { now: ROADMAP_NOW })).toBe(0);
    expect(full.log.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
  });

  it("cancels a deferred roadmap the student can no longer have (no usable survey)", async () => {
    const { pool, log } = promotePool({ candidates: [{ id: ROADMAP, userId: USER }], survey: false });
    expect(await promoteDeferredRoadmaps(pool, { now: ROADMAP_NOW })).toBe(0);
    expect(log.find(([sql]) => sql.startsWith("UPDATE stu_roadmaps SET status='cancelled'"))![1]).toEqual([ROADMAP]);
    expect(queuedIds(log)).toEqual([]);
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

  // roadmap-v9 (user 2026-10-30: "kiểm tra lại đầu ra trước khi hiện"): one more try when the answer does not hold to the data.
  const stray = { ...output, summary: `${output.summary} Bạn có nền tảng vững chắc về React.`, improve: [{ code: "71ITBS10203", advice: "Học lại ở HK3 2024–2025." }] };
  const requeue = (client: ReturnType<typeof workerClient>) => client.client.query as unknown as { mock: { calls: [string, unknown[]][] } };

  it("asks the model once more, with what was wrong, when the answer names a past term or praises what only the student said", async () => {
    const first = workerClient(locked());
    expect(await completeRoadmap(first.client, ROADMAP, success(stray))).toBe("ok");
    expect(first.update()).toBeUndefined();
    const [sql, params] = requeue(first).mock.calls.find(([text]) => text.startsWith("UPDATE stu_roadmaps SET status='queued'"))!;
    expect(sql).toContain("lease_token=NULL,lease_until=NULL");
    expect(params.slice(0, 2)).toEqual([ROADMAP, ROADMAP_RETRY_CODE]);
    const again = JSON.parse(params[2] as string) as { system: string; user: string; retry: { issues: string[]; fallback: { summary: string; improve: unknown[] } } };
    expect(again.user).toBe(aiInput.user);
    expect(again.system).toContain("LƯU Ý CHO LẦN VIẾT NÀY");
    expect(again.retry.issues).toHaveLength(2);
    expect(again.retry.fallback).toMatchObject({ summary: output.summary, improve: [] });

    // The second answer is stored as checked, its stray sentences dropped; never a third try.
    const second = workerClient(locked({ ai_input: again }));
    expect(await completeRoadmap(second.client, ROADMAP, success(stray))).toBe("ok");
    expect((second.update()![1] as unknown[]).slice(0, 3)).toEqual([ROADMAP, "completed", null]);
    expect(JSON.parse((second.update()![1] as unknown[])[3] as string)).toMatchObject({ summary: output.summary, improve: [] });
    expect(retryInput(again, ["x"], again.retry.fallback as never)).toBeNull();
  });

  it("asks again when every item had to go for not holding to the data, and fails if the second answer is no better", async () => {
    const empty = { ...output, study: [{ code: "71ITIS30203", advice: "Đăng ký ở HK1 2024–2025." }], improve: [], skills: [],
      months: output.months.map((month) => ({ ...month, tasks: ["Học bù môn trễ ở HK3 2024–2025."] })) };
    const first = workerClient(locked());
    expect(await completeRoadmap(first.client, ROADMAP, success(empty))).toBe("ok");
    const [, params] = requeue(first).mock.calls.find(([text]) => text.startsWith("UPDATE stu_roadmaps SET status='queued'"))!;
    const again = JSON.parse(params[2] as string) as Record<string, unknown> & { retry: { fallback: unknown } };
    expect(again.retry.fallback).toBeNull();
    const second = workerClient(locked({ ai_input: again }));
    expect(await completeRoadmap(second.client, ROADMAP, success(empty))).toBe("ok");
    expect((second.update()![1] as unknown[]).slice(0, 4)).toEqual([ROADMAP, "failed", "invalid_ai_output", null]);
  });

  it("keeps the first answer, its stray sentences dropped, when the second one is unusable or the model fails", async () => {
    const again = retryInput(aiInput, ["Câu sai."], { ...output, summary: "Bản đầu.", improve: [], months: [] } as never)!;
    for (const answer of [success({ summary: "x" }), { leaseToken: LEASE, error: "ai_output_truncated" }]) {
      const second = workerClient(locked({ ai_input: again }));
      expect(await completeRoadmap(second.client, ROADMAP, answer)).toBe("ok");
      expect((second.update()![1] as unknown[]).slice(0, 3)).toEqual([ROADMAP, "completed", null]);
      expect(JSON.parse((second.update()![1] as unknown[])[3] as string)).toMatchObject({ summary: "Bản đầu." });
    }
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

describe("readRoadmapRelations with the real codes of the graduation standard (comp-calc-v22, user 2026-11-10)", () => {
  // Catalog data only (ngành HTTT K29): the CTĐT file writes Chuyên đề Thương mại điện tử 71ISGR40203 and Đại số tuyến tính
  // và ứng dụng 71ITMA10203, the standard 71ITIS30503 and 71MATL10053.
  const revisionId = "88888888-8888-4888-8888-888888888888";
  const course = (code: string, name: string) => ({ id: code, groupId: "g", code, name, credits: 3, conditionOnly: false, sourceRow: 1 });
  const query = vi.fn(async (sql: string) => {
    const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
    if (sql.includes("FROM curriculum_relations")) return rows([{ courseCode: "71ISGR40203", kind: "prerequisite", targetCodes: ["71ITMA10203"] }]);
    if (sql.includes("FROM curricula c JOIN curriculum_courses cc")) return rows([
      { revision_id: revisionId, cohort_code: "K29", identity_key: "he thong thong tin:K29", code: "71ISGR40203", name: "Chuyên đề Thương mại điện tử", credits: "3" },
      { revision_id: revisionId, cohort_code: "K29", identity_key: "he thong thong tin:K29", code: "71ITMA10203", name: "Đại số tuyến tính và ứng dụng", credits: "3" },
    ]);
    if (sql.includes("FROM graduation_standards g")) return rows([{ cohort_code: "K29", data: {
      specialty: "", classBlock: "71K29HTTT", standardCode: "71K29HTTT_TN04", major: "Hệ thống thông tin (7480104)",
      courses: [course("71ITIS30503", "Chuyên đề Thương Mại điện tử"), course("71MATL10053", "Đại số tuyến tính và ứng dụng")],
    } }]);
    return rows([]);
  });
  const result = (calcVersion: string) => ({ meta: { calcVersion, curriculum: { revisionId } } }) as unknown as Pick<RoadmapRelationResult, "meta">;

  it("reads them so for a result that reads the real codes, and as filed for an older one", async () => {
    expect(await readRoadmapRelations({ query } as never, result("comp-calc-v22"))).toEqual([
      { courseCode: "71ITIS30503", kind: "prerequisite", targetCodes: ["71MATL10053"] },
    ]);
    expect(await readRoadmapRelations({ query } as never, result("comp-calc-v21"))).toEqual([
      { courseCode: "71ISGR40203", kind: "prerequisite", targetCodes: ["71ITMA10203"] },
    ]);
  });
});
