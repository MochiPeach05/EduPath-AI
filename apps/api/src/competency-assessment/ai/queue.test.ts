import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../../db/pool.js";
import { COMPETENCY_AI_QUEUE_LOCK_KEY, MAX_PENDING_AI_JOBS, createCompetencyAiQueue, promoteDeferredCompetencyAi } from "./queue.js";
import { syntheticResult } from "./test-fixture.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ASSESSMENT = "22222222-2222-4222-8222-222222222222";
const OLD_ASSESSMENT = "33333333-3333-4333-8333-333333333333";

function mockClient(options: { pending?: number; cancelled?: string[]; deferred?: boolean } = {}) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.startsWith("UPDATE stu_comp_ai_jobs SET status='cancelled'")) {
      const rows = (options.cancelled ?? []).map((assessment_id) => ({ assessment_id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("AND ai_status='deferred'") && sql.startsWith("UPDATE")) return { rows: [], rowCount: options.deferred ? 1 : 0 };
    if (sql.includes("count(*)")) return { rows: [{ count: options.pending ?? 0 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  return { client: { query } as unknown as PoolClient, query };
}
const sqlOf = (query: ReturnType<typeof mockClient>["query"]) => query.mock.calls.map(([sql]) => sql);
const input = () => ({ assessmentId: ASSESSMENT, userId: USER, result: syntheticResult() });

describe("createCompetencyAiQueue", () => {
  it("uses a new advisory lock key", () => {
    expect(COMPETENCY_AI_QUEUE_LOCK_KEY).not.toBe(1946032027);
    expect(MAX_PENDING_AI_JOBS).toBe(25);
  });

  it("enqueue cancels the previous pending job, inserts the job and marks the assessment queued", async () => {
    const { client, query } = mockClient({ cancelled: [OLD_ASSESSMENT] });
    await expect(createCompetencyAiQueue({ enabled: true }).enqueue(client, input())).resolves.toBe("queued");
    const sql = sqlOf(query);
    expect(query.mock.calls[0]).toEqual(["SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]]);
    expect(sql[1]).toContain("SET status='cancelled',ai_input=NULL");
    expect(query.mock.calls[1]![1]).toEqual([USER]);
    expect(sql[2]).toContain("SET ai_status='cancelled'");
    expect(query.mock.calls[2]![1]).toEqual([USER, [OLD_ASSESSMENT]]);
    const insert = query.mock.calls.find(([s]) => s.startsWith("INSERT INTO stu_comp_ai_jobs"))!;
    const params = insert[1] as unknown[];
    expect(params.slice(1, 3)).toEqual([ASSESSMENT, USER]);
    const aiInput = JSON.parse(params[3] as string);
    expect(Object.keys(aiInput).sort()).toEqual(["checks", "options", "promptVersion", "schema", "system", "think", "user"]);
    expect(aiInput.think).toBe(true);
    expect(aiInput.promptVersion).toBe("comp-v16");
    // No saved Kế hoạch học kỳ: the comment uses the training plan's terms.
    expect(query.mock.calls.find(([s]) => s.startsWith("SELECT data FROM stu_study_plans"))![1]).toEqual([USER]);
    const last = query.mock.calls.at(-1)!;
    expect(last[0]).toContain("SET ai_status='queued'");
    expect(last[1]).toEqual([ASSESSMENT, USER]);
  });

  it("names the term of the student's saved Kế hoạch học kỳ in the comment's data (comp-v13)", async () => {
    const { client, query } = mockClient();
    const saved = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "tst201" }] }, { code: "bad", courses: "x" }] };
    query.mockImplementation(async (sql: string) => (sql.startsWith("SELECT data FROM stu_study_plans") ? { rows: [{ data: saved }], rowCount: 1 } : { rows: [], rowCount: 1 }));
    await createCompetencyAiQueue({ enabled: true }).enqueue(client, input());
    const insert = query.mock.calls.find(([s]) => s.startsWith("INSERT INTO stu_comp_ai_jobs"))!;
    const aiInput = JSON.parse((insert[1] as unknown[])[3] as string);
    expect(aiInput.user).toContain("  - TST201 | Kiểm thử phần mềm cơ bản | 3 TC | chưa học | đủ điều kiện đăng ký | Kế hoạch học kỳ của bạn: HK2 2026–2027\n");
  });

  it("enqueue defers without a job when 25 jobs are pending", async () => {
    const { client, query } = mockClient({ pending: 25 });
    await expect(createCompetencyAiQueue({ enabled: true }).enqueue(client, input())).resolves.toBe("deferred");
    expect(sqlOf(query).some((s) => s.startsWith("INSERT"))).toBe(false);
    expect(query.mock.calls.at(-1)).toEqual([expect.stringContaining("SET ai_status='deferred'"), [ASSESSMENT, USER]]);
  });

  it("regenerate keeps the request deferred when the queue is full (2026-11-10), without a job", async () => {
    const { client, query } = mockClient({ pending: 30 });
    await expect(createCompetencyAiQueue({ enabled: true }).regenerate(client, input())).resolves.toBe("deferred");
    const writes = query.mock.calls.filter(([s]) => s.startsWith("UPDATE") || s.startsWith("INSERT"));
    expect(writes).toEqual([[expect.stringContaining("SET ai_status='deferred',ai_error_code=NULL WHERE id=$1 AND user_id=$2"), [ASSESSMENT, USER]]]);
  });

  it("regenerate queues a new job", async () => {
    const { client, query } = mockClient({ pending: 3 });
    await expect(createCompetencyAiQueue({ enabled: true }).regenerate(client, input())).resolves.toBe("queued");
    expect(sqlOf(query).some((s) => s.startsWith("INSERT INTO stu_comp_ai_jobs"))).toBe(true);
  });

  it("cancel is scoped by user and assessment and reports whether a job was cancelled", async () => {
    const hit = mockClient({ cancelled: [ASSESSMENT] });
    await expect(createCompetencyAiQueue({ enabled: true }).cancel(hit.client, { assessmentId: ASSESSMENT, userId: USER })).resolves.toBe(true);
    expect(hit.query.mock.calls[1]![0]).toContain("AND assessment_id=$2");
    expect(hit.query.mock.calls[1]![1]).toEqual([USER, ASSESSMENT]);
    const miss = mockClient();
    await expect(createCompetencyAiQueue({ enabled: true }).cancel(miss.client, { assessmentId: ASSESSMENT, userId: USER })).resolves.toBe(false);
    // Only a deferred comment of this assessment is touched (it is no longer queued by the housekeeping).
    expect(sqlOf(miss.query).filter((s) => s.includes("stu_comp_assessments"))).toEqual([
      "UPDATE stu_comp_assessments SET ai_status='cancelled' WHERE id=$1 AND user_id=$2 AND ai_status='deferred'"]);
    const deferred = mockClient({ deferred: true });
    await expect(createCompetencyAiQueue({ enabled: true }).cancel(deferred.client, { assessmentId: ASSESSMENT, userId: USER })).resolves.toBe(true);
    expect(deferred.query.mock.calls.at(-1)![1]).toEqual([ASSESSMENT, USER]);
  });

  it("reports the worker online from a recent heartbeat", async () => {
    const queue = createCompetencyAiQueue({ enabled: true });
    const online = { query: vi.fn(async () => ({ rows: [{ online: true }] })) };
    const stale = { query: vi.fn(async () => ({ rows: [{ online: false }] })) };
    const none = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(queue.workerOnline(online as never)).resolves.toBe(true);
    await expect(queue.workerOnline(stale as never)).resolves.toBe(false);
    await expect(queue.workerOnline(none as never)).resolves.toBe(false);
    expect(online.query.mock.calls[0]).toEqual([expect.stringContaining("stu_comp_ai_worker_status"), [60]]);
  });

  it("expires stale jobs from the student API too, rate-limited, without failing the read", async () => {
    let now = 9_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const queue = createCompetencyAiQueue({ enabled: true });
    const db = { query: vi.fn(async (sql: string) => sql.startsWith("WITH failed") ? Promise.reject(new Error("boom")) : { rows: [{ online: true }] }) };
    const expiries = () => db.query.mock.calls.filter(([sql]) => sql.includes("error_code='worker_timeout'")).length;
    await expect(queue.workerOnline(db as never)).resolves.toBe(true);
    expect(expiries()).toBe(1);
    await expect(queue.workerOnline(db as never)).resolves.toBe(true);
    expect(expiries()).toBe(1);
    now += 61_000;
    const { client, query } = mockClient();
    await expect(queue.enqueue(client, input())).resolves.toBe("queued");
    const sql = sqlOf(query);
    // Expiry runs inside the write transaction before the global queue-size check.
    expect(sql.findIndex((s) => s.includes("error_code='worker_timeout'"))).toBeLessThan(sql.findIndex((s) => s.includes("count(*)")));
    vi.restoreAllMocks();
  });

  it("disabled queue never touches the database for enqueue", async () => {
    const queue = createCompetencyAiQueue({ enabled: false });
    const { client, query } = mockClient();
    expect(queue.enabled).toBe(false);
    await expect(queue.enqueue(client, input())).rejects.toThrow("competency_ai_disabled");
    await expect(queue.cancel(client, { assessmentId: ASSESSMENT, userId: USER })).resolves.toBe(false);
    await expect(queue.workerOnline({ query } as never)).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("promoteDeferredCompetencyAi (QA 2026-11-10: deferred comments come back by themselves)", () => {
  const OTHER = "44444444-4444-4444-8444-444444444444";
  const SECOND = "55555555-5555-4555-8555-555555555555";
  type Promote = { candidates: { id: string; user_id: string }[]; pending?: number; locked?: string[]; gone?: string[] };
  function promotePool(state: Promote) {
    const log: [string, unknown[]][] = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      log.push([sql, params]);
      if (sql.startsWith("SELECT count(*)::int AS count FROM stu_comp_ai_jobs")) return { rows: [{ count: state.pending ?? 0 }], rowCount: 1 };
      if (sql.startsWith("SELECT a.id,a.user_id FROM stu_comp_assessments a")) return { rows: state.candidates, rowCount: state.candidates.length };
      if (sql.startsWith("SELECT id FROM users")) return state.locked?.includes(params[0] as string) ? { rows: [], rowCount: 0 } : { rows: [{ id: params[0] }], rowCount: 1 };
      if (sql.startsWith("SELECT computed FROM stu_comp_assessments")) {
        return state.gone?.includes(params[0] as string) ? { rows: [], rowCount: 0 } : { rows: [{ computed: syntheticResult() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
    return { pool, log, release, inserted: () => log.filter(([sql]) => sql.startsWith("INSERT INTO stu_comp_ai_jobs")).map(([, params]) => params[1]) };
  }

  it("queues the oldest deferred comments of the students' newest results under the queue lock, as Tạo lại nhận xét would", async () => {
    const { pool, log, release, inserted } = promotePool({ candidates: [{ id: ASSESSMENT, user_id: USER }, { id: SECOND, user_id: OTHER }] });
    expect(await promoteDeferredCompetencyAi(pool)).toBe(2);
    expect(log[0]![0]).toBe("BEGIN");
    expect(log[1]).toEqual(["SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]]);
    // A deferred comment of an older result is never shown: cancelled, not queued.
    expect(log[2]![0]).toContain("UPDATE stu_comp_assessments a SET ai_status='cancelled' WHERE a.ai_status='deferred'");
    expect(log[2]![0]).toContain("(n.created_at,n.id)>(a.created_at,a.id)");
    const select = log.find(([sql]) => sql.startsWith("SELECT a.id,a.user_id"))!;
    expect(select[0]).toContain("JOIN users u ON u.id=a.user_id AND u.is_active");
    expect(select[0]).toContain("NOT EXISTS (SELECT 1 FROM stu_comp_ai_jobs j WHERE j.user_id=a.user_id AND j.status IN ('queued','processing'))");
    expect(select[0]).toContain("ORDER BY a.created_at,a.id LIMIT $1");
    expect(select[1]).toEqual([MAX_PENDING_AI_JOBS]);
    expect(log.find(([sql]) => sql.startsWith("SELECT id FROM users"))![0]).toContain("FOR SHARE SKIP LOCKED");
    expect(inserted()).toEqual([ASSESSMENT, SECOND]);
    const aiInput = JSON.parse(log.find(([sql]) => sql.startsWith("INSERT INTO stu_comp_ai_jobs"))![1][3] as string);
    expect(aiInput.promptVersion).toBe("comp-v16");
    expect(log.filter(([sql]) => sql.includes("SET ai_status='queued'")).map(([, params]) => params)).toEqual([[ASSESSMENT, USER], [SECOND, OTHER]]);
    expect(log.at(-1)![0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fills only the room left in the queue and leaves a student whose row a write holds for the next run", async () => {
    const one = promotePool({ candidates: [{ id: ASSESSMENT, user_id: USER }, { id: SECOND, user_id: OTHER }], pending: MAX_PENDING_AI_JOBS - 1 });
    expect(await promoteDeferredCompetencyAi(one.pool)).toBe(1);
    expect(one.inserted()).toEqual([ASSESSMENT]);
    const locked = promotePool({ candidates: [{ id: ASSESSMENT, user_id: USER }, { id: SECOND, user_id: OTHER }], locked: [USER] });
    expect(await promoteDeferredCompetencyAi(locked.pool)).toBe(1);
    expect(locked.inserted()).toEqual([SECOND]);
    const gone = promotePool({ candidates: [{ id: ASSESSMENT, user_id: USER }], gone: [ASSESSMENT] });
    expect(await promoteDeferredCompetencyAi(gone.pool)).toBe(0);
    expect(gone.inserted()).toEqual([]);
  });

  it("queues nothing while the queue is full: the comments keep waiting", async () => {
    const full = promotePool({ candidates: [{ id: ASSESSMENT, user_id: USER }], pending: MAX_PENDING_AI_JOBS });
    expect(await promoteDeferredCompetencyAi(full.pool)).toBe(0);
    expect(full.log.some(([sql]) => sql.startsWith("SELECT a.id,a.user_id") || sql.startsWith("INSERT"))).toBe(false);
    expect(full.log.at(-1)![0]).toBe("COMMIT");
  });

  it("rolls back and releases the connection on an error", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => { if (sql.startsWith("SELECT count")) throw new Error("boom"); return { rows: [], rowCount: 0 }; });
    const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
    await expect(promoteDeferredCompetencyAi(pool)).rejects.toThrow("boom");
    expect(query.mock.calls.at(-1)![0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
