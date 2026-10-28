// Embedding jobs of the shared knowledge index of Trợ lý AI (STU-CHAT-01..05, 2026-10-28). An ai_knowledge_jobs row is an
// AI worker job of kind "knowledge_embedding", handed out by /api/worker/competency-assessments, whose router calls the
// claim/extend/complete functions below: a batch of up to KNOWLEDGE_BATCH chunks, each with the content_hash it was read
// with. The worker embeds the texts with the embedding model (EmbeddingGemma, protocol.ts) and completes with one vector
// per text; a vector is stored only on a chunk whose text has not changed since (same content_hash), so a refresh during
// the job never leaves an old vector on a new text. Chunks still without a vector for the model are queued again by the
// next enqueueKnowledgeEmbeddings once no knowledge job is pending.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  AI_HOUSEKEEPING_INTERVAL_MS,
  AI_JOB_LEASE_MINUTES,
  AI_JOB_MAX_ATTEMPTS,
  KNOWLEDGE_EMBEDDING_KIND,
  type WorkerCompletion,
} from "../competency-assessment/ai/worker-protocol.js";
import type { DatabasePool } from "../db/pool.js";
import {
  documentEmbeddingText,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  KNOWLEDGE_BATCH,
  KNOWLEDGE_PROMPT_VERSION,
  knowledgeClaimSchema,
  knowledgeOutputSchema,
  localModelName,
  type KnowledgeClaim,
} from "./protocol.js";

type Db = Pick<DatabasePool, "query">;
const PENDING = "('queued','processing')";
/** Serializes concurrent enqueues when the caller runs them inside a transaction. */
const KNOWLEDGE_QUEUE_LOCK = "edupath:knowledge-embedding";
/**
 * After a failed job, nothing is queued for this long: a worker without the embedding model (ollama_unavailable) or one
 * that answers with vectors of another size would otherwise fail every new batch at once, again and again.
 */
const RETRY_AFTER_FAILURE_MINUTES = 10;
/** Longest text an embedding input may have (embedSpecSchema in protocol.ts); chunks are far shorter (MAX_CHUNK_CHARS). */
const MAX_INPUT_CHARS = 8000;

/** What ai_input holds while the job is pending: the model to embed with and each chunk's id, hash and text. */
export type KnowledgeJobInput = { promptVersion: string; model: string; items: { id: string; hash: string; text: string }[] };
const jobInputSchema = z.object({
  promptVersion: z.string().min(1).max(64),
  model: localModelName,
  items: z.array(z.object({ id: z.string().min(1), hash: z.string().min(1), text: z.string().min(1) })).min(1).max(64),
});
export type ClaimedKnowledgeJob = { id: string; leaseToken: string; aiInput: Record<string, unknown> };

/**
 * Queues the chunks whose embedding is missing or was made by another model, in jobs of up to KNOWLEDGE_BATCH chunks, and
 * returns the number of jobs queued. Does nothing while a knowledge job is queued or processing, or within
 * RETRY_AFTER_FAILURE_MINUTES of a failed one. Inside a transaction (a client after BEGIN) the queue lock keeps two
 * callers from queueing the same chunks; outside one the worst case is one extra embedding of a batch.
 */
export async function enqueueKnowledgeEmbeddings(db: Db, model: string = EMBEDDING_MODEL): Promise<number> {
  const embeddingModel = localModelName.parse(model);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [KNOWLEDGE_QUEUE_LOCK]);
  const state = await db.query<{ pending: boolean; failed: boolean }>(`SELECT
      EXISTS(SELECT 1 FROM ai_knowledge_jobs WHERE status IN ${PENDING}) AS pending,
      EXISTS(SELECT 1 FROM ai_knowledge_jobs WHERE status='failed' AND completed_at>now()-make_interval(mins => $1)) AS failed`,
  [RETRY_AFTER_FAILURE_MINUTES]);
  if (state.rows[0]?.pending || state.rows[0]?.failed) return 0;
  const chunks = await db.query<{ id: string; hash: string; title: string; content: string }>(
    `SELECT id,content_hash AS hash,title,content FROM ai_knowledge_chunks
      WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1 ORDER BY source_kind,source_key,id`, [embeddingModel]);
  if (!chunks.rows.length) return 0;
  const jobs: { id: string; n: number; input: KnowledgeJobInput }[] = [];
  for (let start = 0; start < chunks.rows.length; start += KNOWLEDGE_BATCH) {
    jobs.push({
      id: randomUUID(),
      n: jobs.length,
      input: {
        promptVersion: KNOWLEDGE_PROMPT_VERSION,
        model: embeddingModel,
        items: chunks.rows.slice(start, start + KNOWLEDGE_BATCH).map((chunk) => ({
          id: chunk.id, hash: chunk.hash, text: documentEmbeddingText(chunk.title, chunk.content).slice(0, MAX_INPUT_CHARS),
        })),
      },
    });
  }
  // One statement; each batch a millisecond after the one before, so the worker claims them in order.
  await db.query(`INSERT INTO ai_knowledge_jobs(id,status,ai_input,created_at,updated_at)
    SELECT x.id,'queued',x.input,now()+make_interval(secs => x.n/1000.0),now() FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,input jsonb,n int)`,
  [JSON.stringify(jobs)]);
  return jobs.length;
}

/* ------------------------------------------------------------------------ */
/* Worker side (called by competency-assessment/ai/worker-router.ts) */

/** Claims the oldest runnable knowledge job (SKIP LOCKED, AI_JOB_LEASE_MINUTES lease, at most AI_JOB_MAX_ATTEMPTS attempts). */
export async function claimKnowledgeEmbedding(db: Db, leaseToken: string): Promise<ClaimedKnowledgeJob | null> {
  const result = await db.query<ClaimedKnowledgeJob>(`WITH candidate AS (
      SELECT id FROM ai_knowledge_jobs
      WHERE ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE ai_knowledge_jobs j SET status='processing',lease_token=$1,lease_until=now()+make_interval(mins => $3),attempts=j.attempts+1,updated_at=now()
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.lease_token AS "leaseToken",j.ai_input AS "aiInput"`,
  [leaseToken, AI_JOB_MAX_ATTEMPTS, AI_JOB_LEASE_MINUTES]);
  return result.rows[0] ?? null;
}

/**
 * The claimed job as the worker receives it: the texts to embed and the model, never the chunk ids or hashes, which stay
 * on the server. Throws when the stored input does not make a valid job (enqueueKnowledgeEmbeddings never writes one).
 */
export function knowledgeWorkerJob(claimed: ClaimedKnowledgeJob): KnowledgeClaim {
  const input = jobInputSchema.parse(claimed.aiInput);
  return knowledgeClaimSchema.parse({
    kind: KNOWLEDGE_EMBEDDING_KIND,
    id: claimed.id,
    leaseToken: claimed.leaseToken,
    promptVersion: input.promptVersion,
    embed: { model: input.model, inputs: input.items.map((item) => item.text) },
  });
}

/** Extends a live lease; null when the job is not processing under this lease. */
export async function extendKnowledgeEmbedding(db: Db, id: string, leaseToken: string): Promise<Date | null> {
  const result = await db.query<{ leaseUntil: Date }>(
    `UPDATE ai_knowledge_jobs SET lease_until=now()+make_interval(mins => $3),updated_at=now()
      WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now() RETURNING lease_until AS "leaseUntil"`,
    [id, leaseToken, AI_JOB_LEASE_MINUTES]);
  return result.rows[0]?.leaseUntil ?? null;
}

/** The worker's vectors when there is one per item and each has EMBEDDING_DIMENSIONS numbers; null otherwise. */
function checkedVectors(output: unknown, count: number): number[][] | null {
  const parsed = knowledgeOutputSchema.safeParse(output);
  if (!parsed.success || parsed.data.vectors.length !== count) return null;
  return parsed.data.vectors.every((vector) => vector.length === EMBEDDING_DIMENSIONS) ? parsed.data.vectors : null;
}

type LockedJob = { status: string; lease_token: string | null; valid: boolean | null; ai_input: Record<string, unknown> | null };

/**
 * Stores the worker's vectors inside the worker router's transaction. Returns 'missing' when no knowledge job has this
 * id, 'expired' for another or lost lease, and 'ok' when stored or already stored under the same lease. A vector is
 * written (with the job's model as embedding_model) only on a chunk whose content_hash still equals the one it was
 * queued with; a missing vector, one of another size or another count fails the job with invalid_ai_output. ai_input is
 * cleared either way; metrics keep the worker's figures and how many vectors were stored or found stale.
 */
export async function completeKnowledgeEmbedding(client: PoolClient, id: string, input: WorkerCompletion): Promise<"ok" | "expired" | "missing"> {
  const locked = await client.query<LockedJob>(
    "SELECT status,lease_token,lease_until>now() AS valid,ai_input FROM ai_knowledge_jobs WHERE id=$1 FOR UPDATE", [id]);
  const job = locked.rows[0];
  if (!job) return "missing";
  if ((job.status === "completed" || job.status === "failed") && job.lease_token === input.leaseToken) return "ok";
  if (job.status !== "processing" || job.lease_token !== input.leaseToken || job.valid !== true) return "expired";

  let errorCode: string | null = "error" in input ? input.error : null;
  let metrics: Record<string, unknown> | null = null;
  if (!("error" in input)) {
    const jobInput = jobInputSchema.safeParse(job.ai_input);
    const items = jobInput.success ? jobInput.data.items : [];
    const vectors = jobInput.success ? checkedVectors(input.output, items.length) : null;
    metrics = { ...input.metrics, model: input.model, digest: input.digest || null, ollamaVersion: input.ollamaVersion || null, items: items.length };
    if (!jobInput.success || !vectors) {
      errorCode = "invalid_ai_output";
    } else {
      const stored = await client.query(
        `UPDATE ai_knowledge_chunks c SET embedding=v.embedding,embedding_model=$2,updated_at=now()
          FROM (SELECT x.id,x.hash,(SELECT array_agg(e.value::real ORDER BY e.n) FROM jsonb_array_elements_text(x.vector) WITH ORDINALITY AS e(value,n)) AS embedding
            FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,hash text,vector jsonb)) v
          WHERE c.id=v.id AND c.content_hash=v.hash`,
        [JSON.stringify(items.map((item, index) => ({ id: item.id, hash: item.hash, vector: vectors[index] }))), jobInput.data.model]);
      const count = stored.rowCount ?? 0;
      metrics = { ...metrics, stored: count, stale: items.length - count };
    }
  }
  await client.query(
    `UPDATE ai_knowledge_jobs SET status=$2,error_code=$3,metrics=$4::jsonb,ai_input=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1`,
    [id, errorCode ? "failed" : "completed", errorCode, metrics ? JSON.stringify(metrics) : null]);
  return "ok";
}

/* ------------------------------------------------------------------------ */
/* Housekeeping */

/**
 * Fails stuck jobs (queued for more than 24 hours, or processing with an expired lease after the last attempt or older
 * than 24 hours; their chunks are queued again by the next enqueue) and deletes finished jobs older than 7 days.
 */
export async function expireKnowledgeJobs(db: Db): Promise<void> {
  await db.query(`UPDATE ai_knowledge_jobs SET status='failed',error_code=$2,ai_input=NULL,lease_token=NULL,lease_until=NULL,
      completed_at=now(),updated_at=now()
    WHERE (status='queued' AND created_at<now()-interval '24 hours')
      OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))`,
  [AI_JOB_MAX_ATTEMPTS, "worker_timeout"]);
  await db.query(`DELETE FROM ai_knowledge_jobs WHERE status IN ('completed','failed','cancelled') AND updated_at<now()-interval '7 days'`);
}

/** Rate-limited expiry (at most once per interval per returned function), run from the worker router. */
export function createKnowledgeExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Db): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireKnowledgeJobs(db);
    return true;
  };
}
