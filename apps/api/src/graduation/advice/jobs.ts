// Graduation advice jobs (design §5.3). A stu_grad_advice row is both the AI worker job (kind
// "graduation_advice", handed out by /api/worker/competency-assessments, whose router calls the
// claim/extend/complete functions below) and the stored advice. Advice is queued automatically:
// when the student opens the graduation page (POST /ensure) and, best-effort, right after a
// transcript import commits. One pending row per student; the newest MAX_ADVICE_PER_USER rows
// are kept, and every row goes with a transcript replace or delete (deleteGraduationAdvice).
// Rows are keyed by the page's fingerprint (student-graduation.ts graduationFingerprint), which
// also carries GRADUATION_ADVICE_PROMPT_VERSION: advice written by an older prompt is not current,
// so the next page open queues fresh advice.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  AI_HOUSEKEEPING_INTERVAL_MS,
  AI_JOB_LEASE_MINUTES,
  AI_JOB_MAX_ATTEMPTS,
  type WorkerCompletion,
} from "../../competency-assessment/ai/worker-protocol.js";
import type { GraduationStandardInput } from "../../competency-assessment/types.js";
import type { DatabasePool } from "../../db/pool.js";
import type { GraduationEvaluation } from "../evaluation.js";
import { readStudentGraduation, type StudentGraduation } from "../student-graduation.js";
import { buildGraduationAdviceInput } from "./prompt.js";
import { graduationAdviceContextFromAiInput, validateGraduationAdviceOutput, type GraduationAdviceOutput } from "./validate.js";
import { graduationAdvice, notifyInTransaction } from "../../notifications/notify.js";

/** Serializes the pending checks, the queue-size check and the inserts of concurrent requests. */
const GRADUATION_ADVICE_QUEUE_LOCK = "edupath:graduation-ai-advice";
/** New work is deferred while this many jobs of OTHER students are queued or processing. */
const MAX_PENDING_GRADUATION_ADVICE = 20;
/** Rows kept per student (newest first); older finished rows are pruned on every insert. */
const MAX_ADVICE_PER_USER = 5;
/** At most one insert per student within this many seconds. */
const ADVICE_INSERT_INTERVAL_SECONDS = 30;
/** ensure re-queues failed/cancelled advice by itself only this long after it finished… */
const ADVICE_AUTO_RETRY_SECONDS = 60;
/** …and only while fewer rows than this exist for the same facts (manual retry ignores the cap). */
const MAX_AUTO_ADVICE_PER_FINGERPRINT = 2;

type Db = Pick<DatabasePool, "query">;
const PENDING = "('queued','processing')";
/** A student's advice still to be written: queued, being written, or deferred (asked for while the queue was full). */
const OWN_PENDING = "('deferred','queued','processing')";

/** "deferred" (2026-11-10): asked for while the queue was full, without AI input; promoteDeferredGraduationAdvice queues it. */
export type GraduationAdviceStatus = "deferred" | "queued" | "processing" | "completed" | "failed" | "cancelled";

/** A stored row as the student routes read it. */
export type GraduationAdviceRow = {
  id: string;
  fingerprint: string;
  status: GraduationAdviceStatus;
  errorCode: string | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
  model: string | null;
  standardVersion: number;
  output: GraduationAdviceOutput | null;
  /** The prompt the advice was written with (null: unknown); router.ts shows older ones without their GPA reasons. */
  promptVersion?: string | null;
  /** Created within ADVICE_INSERT_INTERVAL_SECONDS (database clock). */
  recent: boolean;
  /** Finished (or last changed) at least ADVICE_AUTO_RETRY_SECONDS ago (database clock). */
  retryDue: boolean;
};

/** A graduation page with an evaluation: the only kind advice is written for. */
export type EvaluatedGraduation = StudentGraduation & { standard: GraduationStandardInput; evaluation: GraduationEvaluation; fingerprint: string };

const isEvaluated = (graduation: StudentGraduation | null): graduation is EvaluatedGraduation =>
  Boolean(graduation?.standard && graduation.evaluation && graduation.fingerprint);

export class GraduationAdviceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "GraduationAdviceError";
  }
}

export type GraduationAdviceReader = (db: Pick<PoolClient, "query">, userId: string) => Promise<StudentGraduation>;
type AdviceJobOptions = {
  /** Rate-limited housekeeping run inside the transaction (createGraduationAdviceExpiry). */
  expire?: (db: Db) => Promise<unknown>;
  /** Test seam; readStudentGraduation by default. */
  read?: GraduationAdviceReader;
};

export type AdviceOutcome =
  /** No transcript, no resolved standard (or no profile cohort): nothing to advise on. */
  | { kind: "unavailable"; graduation: StudentGraduation }
  /** The row for these facts; one asked for while the queue was full is stored deferred (2026-11-10). */
  | { kind: "stored"; row: GraduationAdviceRow; created: boolean; graduation: EvaluatedGraduation };

const rowColumns = `id,fingerprint,status,error_code AS "errorCode",created_at AS "createdAt",completed_at AS "completedAt",
  ai_model AS model,standard_version AS "standardVersion",ai_output AS output,prompt_version AS "promptVersion",
  created_at>now()-make_interval(secs => $2) AS recent,
  COALESCE(completed_at,updated_at)<=now()-make_interval(secs => $3) AS "retryDue"`;

/** Every advice row of the student, newest first (at most a handful: they are pruned on insert). */
export async function readGraduationAdviceRows(db: Db, userId: string): Promise<GraduationAdviceRow[]> {
  const result = await db.query<GraduationAdviceRow>(
    `SELECT ${rowColumns} FROM stu_grad_advice WHERE user_id=$1 ORDER BY created_at DESC,id DESC`,
    [userId, ADVICE_INSERT_INTERVAL_SECONDS, ADVICE_AUTO_RETRY_SECONDS]);
  return result.rows;
}

/** The newest row written for these facts, or null. */
export const currentAdvice = (rows: readonly GraduationAdviceRow[], fingerprint: string | null): GraduationAdviceRow | null =>
  fingerprint === null ? null : rows.find((row) => row.fingerprint === fingerprint) ?? null;

/**
 * ensure queues these facts again by itself when their newest row failed or was cancelled,
 * fewer than MAX_AUTO_ADVICE_PER_FINGERPRINT rows exist for them and it finished at least
 * ADVICE_AUTO_RETRY_SECONDS ago.
 */
export function autoRetryDue(rows: readonly GraduationAdviceRow[], fingerprint: string): boolean {
  const same = rows.filter((row) => row.fingerprint === fingerprint);
  const newest = same[0];
  return Boolean(newest && (newest.status === "failed" || newest.status === "cancelled") &&
    same.length < MAX_AUTO_ADVICE_PER_FINGERPRINT && newest.retryDue);
}

/** No row for the current facts yet, or only one that ensure would re-queue by itself. */
export const adviceNeeded = (rows: readonly GraduationAdviceRow[], fingerprint: string | null): boolean =>
  fingerprint !== null && (!currentAdvice(rows, fingerprint) || autoRetryDue(rows, fingerprint));

/* ------------------------------------------------------------------------ */
/* Housekeeping */

/**
 * Fails stuck advice: queued for more than 24 hours, or processing with an expired lease after
 * the last attempt (or older than 24 hours). ai_input is cleared with the failure.
 */
export async function expireGraduationAdvice(db: Db): Promise<void> {
  await db.query(`UPDATE stu_grad_advice SET status='failed',error_code=$2,ai_input=NULL,lease_token=NULL,lease_until=NULL,
      completed_at=now(),updated_at=now()
    WHERE (status='queued' AND created_at<now()-interval '24 hours')
      OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))`,
  [AI_JOB_MAX_ATTEMPTS, "worker_timeout"]);
}

/** Rate-limited expiry (at most once per interval per returned function), run from the worker and student routers. */
export function createGraduationAdviceExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Db): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireGraduationAdvice(db);
    return true;
  };
}

/** Removes every advice row of the student. Called with the transcript replace/delete, inside its transaction. */
export async function deleteGraduationAdvice(db: Db, userId: string): Promise<void> {
  await db.query("DELETE FROM stu_grad_advice WHERE user_id=$1", [userId]);
}

/** Keeps the newest MAX_ADVICE_PER_USER rows of the student (a pending or deferred row is never pruned). */
export async function pruneGraduationAdvice(db: Db, userId: string): Promise<void> {
  await db.query(`DELETE FROM stu_grad_advice WHERE user_id=$1 AND status NOT IN ${OWN_PENDING} AND id NOT IN (
    SELECT id FROM stu_grad_advice WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2)`, [userId, MAX_ADVICE_PER_USER]);
}

/** Cancels the student's pending or deferred advice written for other facts; returns how many rows changed. */
async function cancelPendingGraduationAdvice(db: Db, userId: string, keepFingerprint: string): Promise<number> {
  const result = await db.query(`UPDATE stu_grad_advice SET status='cancelled',ai_input=NULL,lease_token=NULL,lease_until=NULL,
      completed_at=now(),updated_at=now() WHERE user_id=$1 AND status IN ${OWN_PENDING} AND fingerprint<>$2`, [userId, keepFingerprint]);
  return result.rowCount ?? 0;
}

/* ------------------------------------------------------------------------ */
/* Queueing (student routes and the post-import hook) */

/**
 * Locks, then reads the graduation page. The student's row comes first (FOR KEY SHARE, the lock
 * the insert's foreign key takes anyway), as in every transcript write (users FOR UPDATE): an
 * import either committed before this read or waits for this transaction, and the lock order
 * user row → queue lock → advice rows never deadlocks with it.
 */
async function lockAndRead(client: PoolClient, userId: string, options: AdviceJobOptions): Promise<StudentGraduation> {
  const user = await client.query("SELECT id FROM users WHERE id=$1 AND is_active FOR KEY SHARE", [userId]);
  if (!user.rowCount) throw new GraduationAdviceError("account_unavailable", 403);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [GRADUATION_ADVICE_QUEUE_LOCK]);
  if (options.expire) await options.expire(client);
  return (options.read ?? readStudentGraduation)(client, userId);
}

/** Advice of other students queued or being written (all of them for null): the queue a new one joins. */
async function othersPending(db: Db, userId: string | null): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM stu_grad_advice WHERE status IN ${PENDING} AND user_id IS DISTINCT FROM $1`, [userId]);
  return result.rows[0]?.count ?? 0;
}

/**
 * Cancels pending or deferred advice for other facts, queues a job for these facts (or, while the queue is full, stores
 * it deferred, without AI input: promoteDeferredGraduationAdvice queues it once there is room) and prunes old rows.
 */
async function insertAdvice(client: PoolClient, userId: string, graduation: EvaluatedGraduation, status: "queued" | "deferred" = "queued"): Promise<GraduationAdviceRow> {
  const { standard, evaluation, fingerprint } = graduation;
  await cancelPendingGraduationAdvice(client, userId, fingerprint);
  const id = randomUUID();
  const aiInput = buildGraduationAdviceInput(graduation);
  const inserted = await client.query<{ createdAt: Date | string }>(
    `INSERT INTO stu_grad_advice(id,user_id,transcript_version,standard_id,standard_revision_id,standard_version,calc_version,fingerprint,
      status,ai_input,prompt_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING created_at AS "createdAt"`,
    [id, userId, evaluation.asOf.transcriptVersion, standard.id, standard.revisionId, standard.version, evaluation.calcVersion, fingerprint,
      status, status === "queued" ? JSON.stringify(aiInput) : null, aiInput.promptVersion]);
  await pruneGraduationAdvice(client, userId);
  return {
    id, fingerprint, status, errorCode: null, createdAt: inserted.rows[0]?.createdAt ?? new Date(), completedAt: null,
    model: null, standardVersion: standard.version, output: null, recent: true, retryDue: false,
  };
}

/**
 * Idempotent per evaluation fingerprint (POST /ensure and the post-import hook), inside the
 * caller's transaction: the newest row for the current facts is returned unchanged while it is
 * deferred, queued, processing or completed, or when it failed and may not be re-queued automatically
 * (the page then offers "Thử lại"). Otherwise a job is queued, unless the student queued one in
 * the last 30 seconds (the row for these facts, else the newest row, is returned); while the queue is
 * full it is stored deferred instead (2026-11-10: before, nothing was stored until the page opened again).
 */
export async function ensureGraduationAdvice(client: PoolClient, userId: string, options: AdviceJobOptions = {}): Promise<AdviceOutcome> {
  const graduation = await lockAndRead(client, userId, options);
  if (!isEvaluated(graduation)) return { kind: "unavailable", graduation };
  const rows = await readGraduationAdviceRows(client, userId);
  const current = currentAdvice(rows, graduation.fingerprint);
  if (current && !autoRetryDue(rows, graduation.fingerprint)) return { kind: "stored", row: current, created: false, graduation };
  const newest = rows[0];
  // Within 30 seconds of the last insert: the failed row for these facts, else the newest row.
  if (newest?.recent) return { kind: "stored", row: current ?? newest, created: false, graduation };
  const status = await othersPending(client, userId) >= MAX_PENDING_GRADUATION_ADVICE ? "deferred" : "queued";
  return { kind: "stored", row: await insertAdvice(client, userId, graduation, status), created: true, graduation };
}

/**
 * Manual "Thử lại" (POST /retry), inside the caller's transaction: only when the newest row for
 * the current facts failed or was cancelled. Ignores the per-fingerprint cap but keeps the
 * 30-second guard (429 advice_too_frequent); while the queue is full the advice is stored deferred.
 */
export async function retryGraduationAdvice(client: PoolClient, userId: string, options: AdviceJobOptions = {}): Promise<Extract<AdviceOutcome, { kind: "stored" }>> {
  const graduation = await lockAndRead(client, userId, options);
  if (!isEvaluated(graduation)) throw new GraduationAdviceError("advice_not_retryable", 409);
  const rows = await readGraduationAdviceRows(client, userId);
  const current = currentAdvice(rows, graduation.fingerprint);
  if (!current || (current.status !== "failed" && current.status !== "cancelled")) throw new GraduationAdviceError("advice_not_retryable", 409);
  if (rows[0]?.recent) throw new GraduationAdviceError("advice_too_frequent", 429);
  const status = await othersPending(client, userId) >= MAX_PENDING_GRADUATION_ADVICE ? "deferred" : "queued";
  return { kind: "stored", row: await insertAdvice(client, userId, graduation, status), created: true, graduation };
}

/**
 * One deferred advice into the queue, in the lock order of lockAndRead (the student's row, then the queue lock). A
 * student whose row a write holds is skipped until the next run; "full" stops the run. Written for the facts as they are
 * now: the same facts keep their row (queued in place, its 24 hours in the queue start now); other facts cancel it and
 * queue a new row unless those facts have their advice already, as POST /ensure would; nothing left to advise on (no
 * transcript or standard) cancels it.
 */
async function promoteAdvice(client: PoolClient, candidate: { id: string; userId: string }, read: GraduationAdviceReader): Promise<"queued" | "full" | "skipped"> {
  const user = await client.query("SELECT id FROM users WHERE id=$1 AND is_active FOR KEY SHARE SKIP LOCKED", [candidate.userId]);
  if (!user.rowCount) return "skipped";
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [GRADUATION_ADVICE_QUEUE_LOCK]);
  if (await othersPending(client, null) >= MAX_PENDING_GRADUATION_ADVICE) return "full";
  const row = await client.query<{ fingerprint: string }>(
    "SELECT fingerprint FROM stu_grad_advice WHERE id=$1 AND user_id=$2 AND status='deferred' FOR UPDATE", [candidate.id, candidate.userId]);
  const deferred = row.rows[0];
  if (!deferred) return "skipped";
  const cancel = () => client.query("UPDATE stu_grad_advice SET status='cancelled',completed_at=now(),updated_at=now() WHERE id=$1", [candidate.id]);
  const graduation = await read(client, candidate.userId);
  if (!isEvaluated(graduation)) {
    await cancel();
    return "skipped";
  }
  if (graduation.fingerprint !== deferred.fingerprint) {
    const rows = await readGraduationAdviceRows(client, candidate.userId);
    if (currentAdvice(rows, graduation.fingerprint) && !autoRetryDue(rows, graduation.fingerprint)) {
      await cancel();
      return "skipped";
    }
    await insertAdvice(client, candidate.userId, graduation);
    return "queued";
  }
  const { standard, evaluation } = graduation;
  const aiInput = buildGraduationAdviceInput(graduation);
  await client.query(`UPDATE stu_grad_advice SET status='queued',transcript_version=$2,standard_id=$3,standard_revision_id=$4,standard_version=$5,
      calc_version=$6,ai_input=$7::jsonb,prompt_version=$8,error_code=NULL,created_at=now(),updated_at=now() WHERE id=$1`,
  [candidate.id, evaluation.asOf.transcriptVersion, standard.id, standard.revisionId, standard.version, evaluation.calcVersion,
    JSON.stringify(aiInput), aiInput.promptVersion]);
  return "queued";
}

/**
 * Queues the deferred advice again while the queue has room (QA 2026-11-10), oldest first, each in a transaction of its
 * own; run from the AI worker's claims (competency-assessment/ai/deferred.ts). Returns how many were queued.
 */
export async function promoteDeferredGraduationAdvice(pool: Pick<DatabasePool, "query" | "connect">, options: Pick<AdviceJobOptions, "read"> = {}): Promise<number> {
  const read = options.read ?? readStudentGraduation;
  const candidates = await pool.query<{ id: string; userId: string }>(
    `SELECT a.id,a.user_id AS "userId" FROM stu_grad_advice a JOIN users u ON u.id=a.user_id AND u.is_active
      WHERE a.status='deferred' ORDER BY a.created_at,a.id LIMIT $1`, [MAX_PENDING_GRADUATION_ADVICE]);
  let queued = 0;
  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    let outcome: Awaited<ReturnType<typeof promoteAdvice>>;
    try {
      await client.query("BEGIN");
      outcome = await promoteAdvice(client, candidate, read);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (outcome === "full") break;
    if (outcome === "queued") queued += 1;
  }
  return queued;
}

/** A loggable code without data: the advice error code, the PostgreSQL SQLSTATE or the error class. */
export function adviceErrorCode(error: unknown): string {
  if (error instanceof GraduationAdviceError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Post-import hook (design §5.7): once a transcript import or replacement has COMMITTED, queue
 * advice for the new facts in a short transaction of its own. Best-effort: never throws, and
 * logs only an error code (never data).
 */
export async function ensureGraduationAdviceAfterImport(pool: DatabasePool, userId: string, options: AdviceJobOptions = {}): Promise<void> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await ensureGraduationAdvice(client, userId, options);
    await client.query("COMMIT");
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    console.error(`[graduation-advice] post-import ensure failed (${adviceErrorCode(error)})`);
  } finally {
    client?.release();
  }
}

/* ------------------------------------------------------------------------ */
/* Worker side (called by competency-assessment/ai/worker-router.ts) */

/** Claims the oldest runnable advice (SKIP LOCKED, 15 minute lease, at most 2 attempts). */
export async function claimGraduationAdvice(db: Db, leaseToken: string): Promise<{ id: string; leaseToken: string; aiInput: Record<string, unknown> } | null> {
  const result = await db.query<{ id: string; leaseToken: string; aiInput: Record<string, unknown> }>(`WITH candidate AS (
      SELECT id FROM stu_grad_advice
      WHERE ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE stu_grad_advice j SET status='processing',lease_token=$1,lease_until=now()+make_interval(mins => $3),attempts=j.attempts+1,updated_at=now()
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.lease_token AS "leaseToken",j.ai_input AS "aiInput"`,
  [leaseToken, AI_JOB_MAX_ATTEMPTS, AI_JOB_LEASE_MINUTES]);
  return result.rows[0] ?? null;
}

/** Extends a live lease; null when the advice is not processing under this lease. */
export async function extendGraduationAdvice(db: Db, id: string, leaseToken: string): Promise<Date | null> {
  const result = await db.query<{ leaseUntil: Date }>(
    `UPDATE stu_grad_advice SET lease_until=now()+make_interval(mins => $3),updated_at=now()
      WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now() RETURNING lease_until AS "leaseUntil"`,
    [id, leaseToken, AI_JOB_LEASE_MINUTES]);
  return result.rows[0]?.leaseUntil ?? null;
}

type LockedAdvice = { status: string; lease_token: string | null; valid: boolean | null; ai_input: Record<string, unknown> | null };

/**
 * Stores the worker's result inside the worker router's transaction. Returns 'missing' when no
 * advice has this id, 'expired' for another or lost lease (a cancelled advice stays cancelled),
 * and 'ok' when stored or already stored under the same lease. The output is validated and
 * cleaned (validate.ts); ai_input is cleared either way.
 */
export async function completeGraduationAdvice(client: PoolClient, id: string, input: WorkerCompletion): Promise<"ok" | "expired" | "missing"> {
  const locked = await client.query<LockedAdvice>(
    "SELECT status,lease_token,lease_until>now() AS valid,ai_input FROM stu_grad_advice WHERE id=$1 FOR UPDATE", [id]);
  const job = locked.rows[0];
  if (!job) return "missing";
  if ((job.status === "completed" || job.status === "failed") && job.lease_token === input.leaseToken) return "ok";
  if (job.status !== "processing" || job.lease_token !== input.leaseToken || job.valid !== true) return "expired";

  let errorCode: string | null = "error" in input ? input.error : null;
  let output: GraduationAdviceOutput | null = null;
  if (!("error" in input)) {
    const context = graduationAdviceContextFromAiInput(job.ai_input);
    const checked = context ? validateGraduationAdviceOutput(input.output, context) : null;
    if (checked?.ok) output = checked.output;
    else errorCode = "invalid_ai_output";
  }
  const model = "error" in input ? null : input;
  const promptVersion = typeof job.ai_input?.promptVersion === "string" ? job.ai_input.promptVersion : null;
  const updated = await client.query<{ user_id: string }>(
    `UPDATE stu_grad_advice SET status=$2,error_code=$3,ai_output=$4::jsonb,metrics=$5::jsonb,ai_model=$6,ai_model_digest=$7,
      ollama_version=$8,prompt_version=COALESCE($9,prompt_version),ai_input=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1
      RETURNING user_id`,
    [id, errorCode ? "failed" : "completed", errorCode, output ? JSON.stringify(output) : null,
      model ? JSON.stringify(model.metrics) : null, model?.model ?? null, model?.digest || null, model?.ollamaVersion || null, promptVersion]);
  // The advice is written in the background after a transcript import: the bell tells the student (2026-10-30, STU-PROG-04).
  const userId = updated?.rows[0]?.user_id;
  if (userId && !errorCode) await notifyInTransaction(client, userId, { ...graduationAdvice(), sourceKey: `graduation-advice:${id}` });
  return "ok";
}
