// AI commentary queue hook (contract C2). Called inside the student router's write
// transactions; the caller already holds the student's row lock.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../../db/pool.js";
import { readStudentRealCodes } from "../../curricula/real-codes.js";
import type { AssessmentResult } from "../types.js";
import { COMPETENCY_AI_QUEUE_LOCK } from "../repository.js";
import { buildAiInput } from "./prompt.js";
import { createCompetencyAiExpiry } from "./expiry.js";

/**
 * Transaction-level advisory lock serializing the global queue-size check. The key is shared
 * with repository.ts (never 1946032027, used by the OCR queue and the AD-COMP catalog lock).
 */
export const COMPETENCY_AI_QUEUE_LOCK_KEY = COMPETENCY_AI_QUEUE_LOCK;
/** At most this many queued/processing jobs system-wide; beyond it new work is deferred. */
export const MAX_PENDING_AI_JOBS = 25;
/** The worker counts as online when its heartbeat is newer than this. */
export const WORKER_ONLINE_SECONDS = 60;

type QueueInput = { assessmentId: string; userId: string; result: AssessmentResult };

interface CompetencyAiQueue {
  enabled: boolean;
  /**
   * POST /: cancels the user's pending job, then queues, or defers when the queue is full (promoteDeferredCompetencyAi
   * queues a deferred comment by itself once there is room).
   */
  enqueue(client: PoolClient, input: QueueInput): Promise<"queued" | "deferred">;
  /** POST /:id/ai: queues again; when the queue is full the comment is deferred the same way and 'deferred' is returned. */
  regenerate(client: PoolClient, input: QueueInput): Promise<"queued" | "deferred">;
  /** DELETE /:id/ai: cancels the assessment's pending job, or its deferred comment. */
  cancel(client: PoolClient, input: { assessmentId: string; userId: string }): Promise<boolean>;
  workerOnline(db: Pick<DatabasePool, "query">): Promise<boolean>;
}

const PENDING = "('queued','processing')";

async function cancelPending(client: PoolClient, userId: string, assessmentId?: string): Promise<number> {
  const params: unknown[] = [userId];
  let filter = "";
  if (assessmentId) { params.push(assessmentId); filter = " AND assessment_id=$2"; }
  const cancelled = await client.query<{ assessment_id: string }>(
    `UPDATE stu_comp_ai_jobs SET status='cancelled',ai_input=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE user_id=$1 AND status IN ${PENDING}${filter} RETURNING assessment_id`, params);
  const ids = cancelled.rows.map((row) => row.assessment_id);
  if (ids.length) {
    await client.query(
      `UPDATE stu_comp_assessments SET ai_status='cancelled' WHERE user_id=$1 AND id=ANY($2::uuid[]) AND ai_status IN ${PENDING}`,
      [userId, ids]);
  }
  return ids.length;
}

async function othersPending(client: PoolClient, userId: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM stu_comp_ai_jobs WHERE status IN ${PENDING} AND user_id<>$1`, [userId]);
  return result.rows[0]?.count ?? 0;
}

/** Marks the assessment's comment deferred: the housekeeping queues it once the queue has room. */
async function defer(client: PoolClient, input: Pick<QueueInput, "assessmentId" | "userId">): Promise<"deferred"> {
  await client.query("UPDATE stu_comp_assessments SET ai_status='deferred',ai_error_code=NULL WHERE id=$1 AND user_id=$2",
    [input.assessmentId, input.userId]);
  return "deferred";
}

/**
 * The courses of the student's saved Kế hoạch học kỳ (stu_study_plans), by code: the comment names the term the student
 * chose for a course (comp-v13). Empty without a saved plan or with one the page could not have saved. A plan saved before
 * 2026-11-10 may name a course by its CTĐT file's code: it is read as the real one, the engine's (curricula/real-codes.ts).
 */
export async function plannedTermsOf(client: Pick<PoolClient, "query">, userId: string): Promise<Map<string, string>> {
  const result = await client.query<{ data: unknown }>("SELECT data FROM stu_study_plans WHERE user_id=$1", [userId]);
  const terms = (result.rows[0]?.data as { terms?: unknown } | undefined)?.terms;
  const planned = new Map<string, string>();
  if (!Array.isArray(terms)) return planned;
  const realCodes = await readStudentRealCodes(client, userId);
  for (const term of terms as { code?: unknown; courses?: unknown }[]) {
    if (typeof term?.code !== "string" || !Array.isArray(term.courses)) continue;
    for (const course of term.courses as { code?: unknown }[]) {
      if (typeof course?.code !== "string") continue;
      const code = course.code.toUpperCase();
      const real = (realCodes.get(code.trim()) ?? code).toUpperCase();
      if (!planned.has(real)) planned.set(real, term.code);
    }
  }
  return planned;
}

async function insertJob(client: PoolClient, input: QueueInput): Promise<"queued"> {
  const aiInput = buildAiInput(input.result, { planned: await plannedTermsOf(client, input.userId) });
  await client.query(
    "INSERT INTO stu_comp_ai_jobs(id,assessment_id,user_id,status,ai_input) VALUES($1,$2,$3,'queued',$4::jsonb)",
    [randomUUID(), input.assessmentId, input.userId, JSON.stringify(aiInput)]);
  await client.query(
    `UPDATE stu_comp_assessments SET ai_status='queued',ai_error_code=NULL,ai_output=NULL,ai_model=NULL,ai_model_digest=NULL,
      ollama_version=NULL,prompt_version=NULL,ai_completed_at=NULL WHERE id=$1 AND user_id=$2`,
    [input.assessmentId, input.userId]);
  return "queued";
}

/**
 * Queues the deferred comments again once the queue has room (QA 2026-11-10: "Hàng đợi AI đang đầy … bấm “Tạo lại nhận
 * xét” để xếp hàng lại" never came back by itself): the newest assessment of each active student whose comment is
 * deferred, oldest first, while fewer than MAX_PENDING_AI_JOBS jobs are queued or being written, with its input built now
 * (the saved Kế hoạch học kỳ as it is), exactly as "Tạo lại nhận xét" would. One transaction under the queue lock; a
 * student whose row their own write holds (FOR UPDATE) is skipped until the next run, so the lock order of the student
 * routes (row, then queue lock) never deadlocks with it. A deferred comment of an older assessment is never shown and is
 * marked cancelled. Run from the worker's claims only (deferred.ts). Returns how many comments were queued.
 */
export async function promoteDeferredCompetencyAi(pool: Pick<DatabasePool, "connect">): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
    await client.query(`UPDATE stu_comp_assessments a SET ai_status='cancelled' WHERE a.ai_status='deferred'
      AND EXISTS (SELECT 1 FROM stu_comp_assessments n WHERE n.user_id=a.user_id AND (n.created_at,n.id)>(a.created_at,a.id))`);
    const pending = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM stu_comp_ai_jobs WHERE status IN ${PENDING}`);
    let room = MAX_PENDING_AI_JOBS - (pending.rows[0]?.count ?? 0);
    let queued = 0;
    if (room > 0) {
      const candidates = await client.query<{ id: string; user_id: string }>(
        `SELECT a.id,a.user_id FROM stu_comp_assessments a JOIN users u ON u.id=a.user_id AND u.is_active
          WHERE a.ai_status='deferred' AND NOT EXISTS (SELECT 1 FROM stu_comp_ai_jobs j WHERE j.user_id=a.user_id AND j.status IN ${PENDING})
          ORDER BY a.created_at,a.id LIMIT $1`, [MAX_PENDING_AI_JOBS]);
      for (const candidate of candidates.rows) {
        if (room <= 0) break;
        const user = await client.query("SELECT id FROM users WHERE id=$1 AND is_active FOR SHARE SKIP LOCKED", [candidate.user_id]);
        if (!user.rowCount) continue;
        const row = await client.query<{ computed: AssessmentResult }>(
          "SELECT computed FROM stu_comp_assessments WHERE id=$1 AND user_id=$2 AND ai_status='deferred' FOR UPDATE", [candidate.id, candidate.user_id]);
        const result = row.rows[0]?.computed;
        if (!result) continue;
        await insertJob(client, { assessmentId: candidate.id, userId: candidate.user_id, result });
        queued += 1;
        room -= 1;
      }
    }
    await client.query("COMMIT");
    return queued;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createCompetencyAiQueue(options: { enabled: boolean }): CompetencyAiQueue {
  const enabled = options.enabled;
  // Expiry also runs from the student API, so stale jobs do not fill the queue (or keep their
  // ai_input) while the worker is offline. Rate-limited to once per 60 s per queue.
  const expire = createCompetencyAiExpiry();
  const requireEnabled = () => { if (!enabled) throw new Error("competency_ai_disabled"); };
  return {
    enabled,
    async enqueue(client, input) {
      requireEnabled();
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
      await cancelPending(client, input.userId);
      await expire(client);
      if (await othersPending(client, input.userId) >= MAX_PENDING_AI_JOBS) return defer(client, input);
      return insertJob(client, input);
    },
    async regenerate(client, input) {
      requireEnabled();
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
      await expire(client);
      // A full queue keeps the request (2026-11-10): the housekeeping queues it once there is room.
      if (await othersPending(client, input.userId) >= MAX_PENDING_AI_JOBS) return defer(client, input);
      await cancelPending(client, input.userId);
      return insertJob(client, input);
    },
    async cancel(client, input) {
      if (!enabled) return false;
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
      const cancelled = await cancelPending(client, input.userId, input.assessmentId);
      // A comment still waiting for room in the queue is no longer queued by the housekeeping.
      const deferred = await client.query("UPDATE stu_comp_assessments SET ai_status='cancelled' WHERE id=$1 AND user_id=$2 AND ai_status='deferred'",
        [input.assessmentId, input.userId]);
      return cancelled > 0 || (deferred.rowCount ?? 0) > 0;
    },
    async workerOnline(db) {
      if (!enabled) return false;
      const result = await db.query<{ online: boolean }>(
        `SELECT seen_at > now() - make_interval(secs => $1) AS online FROM stu_comp_ai_worker_status WHERE id=1`,
        [WORKER_ONLINE_SECONDS]);
      // Called by GET /latest and /latest/status; a failed expiry must not break the read.
      await expire(db).catch(() => false);
      return result.rows[0]?.online === true;
    }
  };
}
