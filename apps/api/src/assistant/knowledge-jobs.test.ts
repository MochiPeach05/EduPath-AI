import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_JOB_LEASE_MINUTES, AI_JOB_MAX_ATTEMPTS, KNOWLEDGE_EMBEDDING_KIND } from "../competency-assessment/ai/worker-protocol.js";
import {
  claimKnowledgeEmbedding, completeKnowledgeEmbedding, createKnowledgeExpiry, enqueueKnowledgeEmbeddings, expireKnowledgeJobs, extendKnowledgeEmbedding,
  knowledgeWorkerJob, type KnowledgeJobInput,
} from "./knowledge-jobs.js";
import { documentEmbeddingText, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, KNOWLEDGE_BATCH, KNOWLEDGE_PROMPT_VERSION, knowledgeClaimSchema } from "./protocol.js";

// Catalog-like chunk texts only; the index never holds student data.
const JOB = "44444444-4444-4444-8444-444444444444";
const LEASE = "55555555-5555-4555-8555-555555555555";
const OTHER_LEASE = "66666666-6666-4666-8666-666666666666";
const CHUNK_A = "aaaaaaaa-1111-4111-8111-111111111111";
const CHUNK_B = "bbbbbbbb-2222-4222-8222-222222222222";

const rows = (list: readonly unknown[]) => ({ rowCount: list.length, rows: [...list] });
const chunk = (index: number) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, hash: `hash-${index}`, title: `Học phần ${index}`, content: `Nội dung học phần ${index}.`,
});

afterEach(() => vi.restoreAllMocks());

describe("enqueueKnowledgeEmbeddings", () => {
  function queueDb(state: { pending?: boolean; failed?: boolean; chunks?: ReturnType<typeof chunk>[] } = {}) {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) return rows([{}]);
      if (sql.includes("AS pending")) return rows([{ pending: state.pending ?? false, failed: state.failed ?? false }]);
      if (sql.includes("FROM ai_knowledge_chunks")) return rows(state.chunks ?? []);
      if (sql.startsWith("INSERT INTO ai_knowledge_jobs")) return { rowCount: 1, rows: [] };
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    });
    const calls = () => query.mock.calls.map(([sql, params]) => [sql, params ?? []] as const);
    return { db: { query } as unknown as Parameters<typeof enqueueKnowledgeEmbeddings>[0], calls };
  }

  it("queues the chunks without a vector of the model in jobs of KNOWLEDGE_BATCH, in order", async () => {
    const chunks = Array.from({ length: 2 * KNOWLEDGE_BATCH + 6 }, (_, index) => chunk(index));
    const { db, calls } = queueDb({ chunks });
    expect(await enqueueKnowledgeEmbeddings(db)).toBe(3);
    expect(calls()[0]).toEqual(["SELECT pg_advisory_xact_lock(hashtext($1))", ["edupath:knowledge-embedding"]]);
    const [select, selectParams] = calls().find(([sql]) => sql.includes("FROM ai_knowledge_chunks"))!;
    expect(select).toContain("WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1");
    expect(selectParams).toEqual([EMBEDDING_MODEL]);
    const [insert, params] = calls().find(([sql]) => sql.startsWith("INSERT INTO ai_knowledge_jobs"))!;
    expect(insert).toContain("now()+make_interval(secs => x.n/1000.0)");
    const jobs = JSON.parse(params[0] as string) as { id: string; n: number; input: KnowledgeJobInput }[];
    expect(jobs.map((job) => [job.n, job.input.items.length])).toEqual([[0, KNOWLEDGE_BATCH], [1, KNOWLEDGE_BATCH], [2, 6]]);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(3);
    expect(jobs[0]!.input).toMatchObject({ promptVersion: KNOWLEDGE_PROMPT_VERSION, model: EMBEDDING_MODEL });
    expect(jobs[2]!.input.items[5]).toEqual({ id: chunks[69]!.id, hash: "hash-69", text: documentEmbeddingText("Học phần 69", "Nội dung học phần 69.") });
  });

  it("queues for another model when asked, and refuses a cloud model", async () => {
    const { db, calls } = queueDb({ chunks: [chunk(1)] });
    expect(await enqueueKnowledgeEmbeddings(db, "embeddinggemma:300m")).toBe(1);
    expect(JSON.parse(calls().find(([sql]) => sql.startsWith("INSERT"))![1][0] as string)[0].input.model).toBe("embeddinggemma:300m");
    await expect(enqueueKnowledgeEmbeddings(queueDb().db, "gpt-oss:120b-cloud")).rejects.toThrow();
  });

  it("does nothing while a job is pending, soon after a failed one, or when every chunk has its vector", async () => {
    for (const state of [{ pending: true, chunks: [chunk(1)] }, { failed: true, chunks: [chunk(1)] }, { chunks: [] }]) {
      const { db, calls } = queueDb(state);
      expect(await enqueueKnowledgeEmbeddings(db)).toBe(0);
      expect(calls().some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
    }
  });
});

describe("worker side", () => {
  const aiInput: KnowledgeJobInput = {
    promptVersion: KNOWLEDGE_PROMPT_VERSION, model: EMBEDDING_MODEL,
    items: [{ id: CHUNK_A, hash: "hash-a", text: documentEmbeddingText("A", "Văn bản A") }, { id: CHUNK_B, hash: "hash-b", text: documentEmbeddingText("B", "Văn bản B") }],
  };
  const vector = (seed: number, length = EMBEDDING_DIMENSIONS) => Array.from({ length }, (_, index) => ((index + seed) % 7) / 10);
  const success = (output: unknown) => ({
    leaseToken: LEASE, model: "embeddinggemma:latest", digest: "85462619ee72", ollamaVersion: "0.40.2", metrics: { total_duration: 1200 }, output,
  });
  const locked = (extra: Record<string, unknown> = {}) => ({ status: "processing", lease_token: LEASE, valid: true, ai_input: aiInput, ...extra });

  /** `current`: the content_hash each chunk has now; the UPDATE writes only where the item's hash still matches, as in SQL. */
  function workerClient(job: Record<string, unknown> | null, current: Record<string, string> = { [CHUNK_A]: "hash-a", [CHUNK_B]: "hash-b" }) {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM ai_knowledge_jobs WHERE id=$1 FOR UPDATE")) return rows(job ? [job] : []);
      if (sql.startsWith("UPDATE ai_knowledge_chunks")) {
        const items = JSON.parse(params![0] as string) as { id: string; hash: string }[];
        return { rowCount: items.filter((item) => current[item.id] === item.hash).length, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    const find = (start: string) => query.mock.calls.find(([sql]) => sql.startsWith(start));
    return { client: { query } as unknown as PoolClient, query, chunkUpdate: () => find("UPDATE ai_knowledge_chunks"), jobUpdate: () => find("UPDATE ai_knowledge_jobs SET status=$2") };
  }

  it("claims the oldest runnable job with SKIP LOCKED and the shared lease, and extends only a live lease", async () => {
    const { client, query } = workerClient(null);
    query.mockResolvedValueOnce(rows([]));
    expect(await claimKnowledgeEmbedding(client, LEASE)).toBeNull();
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("FROM ai_knowledge_jobs");
    expect(sql).toContain("WHERE ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))");
    expect(sql).toContain("ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1");
    expect(params).toEqual([LEASE, AI_JOB_MAX_ATTEMPTS, AI_JOB_LEASE_MINUTES]);
    query.mockResolvedValueOnce(rows([{ id: JOB, leaseToken: LEASE, aiInput }]));
    expect(await claimKnowledgeEmbedding(client, LEASE)).toEqual({ id: JOB, leaseToken: LEASE, aiInput });

    query.mockResolvedValueOnce(rows([]));
    expect(await extendKnowledgeEmbedding(client, JOB, LEASE)).toBeNull();
    expect(query.mock.calls[2]![0]).toContain("WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now()");
    const until = new Date("2026-10-28T10:15:00Z");
    query.mockResolvedValueOnce(rows([{ leaseUntil: until }]));
    expect(await extendKnowledgeEmbedding(client, JOB, LEASE)).toBe(until);
  });

  it("hands the worker the texts and the model only, in the claimed-job shape", () => {
    const job = knowledgeWorkerJob({ id: JOB, leaseToken: LEASE, aiInput });
    expect(knowledgeClaimSchema.parse(job)).toEqual(job);
    expect(job).toEqual({
      kind: KNOWLEDGE_EMBEDDING_KIND, id: JOB, leaseToken: LEASE, promptVersion: KNOWLEDGE_PROMPT_VERSION,
      embed: { model: EMBEDDING_MODEL, inputs: aiInput.items.map((item) => item.text) },
    });
    expect(JSON.stringify(job)).not.toContain(CHUNK_A);
    expect(JSON.stringify(job)).not.toContain("hash-a");
    expect(() => knowledgeWorkerJob({ id: JOB, leaseToken: LEASE, aiInput: { promptVersion: KNOWLEDGE_PROMPT_VERSION, model: EMBEDDING_MODEL, items: [] } })).toThrow();
  });

  it("stores a vector only on a chunk whose text is unchanged, under the job's model, and completes the job", async () => {
    // Chunk B was rewritten by a refresh while the worker embedded it: its old vector must not be stored.
    const worker = workerClient(locked(), { [CHUNK_A]: "hash-a", [CHUNK_B]: "hash-b-new" });
    expect(await completeKnowledgeEmbedding(worker.client, JOB, success({ vectors: [vector(1), vector(2)] }))).toBe("ok");
    const [update, params] = worker.chunkUpdate()!;
    expect(update).toContain("WHERE c.id=v.id AND c.content_hash=v.hash");
    expect(update).toContain("array_agg(e.value::real ORDER BY e.n)");
    // The model the job asked for, not the name the worker reports: enqueue compares embedding_model with it.
    expect(params![1]).toBe(EMBEDDING_MODEL);
    const items = JSON.parse(params![0] as string) as { id: string; hash: string; vector: number[] }[];
    expect(items.map((item) => [item.id, item.hash, item.vector.length])).toEqual([[CHUNK_A, "hash-a", EMBEDDING_DIMENSIONS], [CHUNK_B, "hash-b", EMBEDDING_DIMENSIONS]]);
    expect(items[1]!.vector).toEqual(vector(2));
    const [jobSql, jobParams] = worker.jobUpdate()!;
    expect(jobSql).toContain("ai_input=NULL");
    expect((jobParams as unknown[]).slice(0, 3)).toEqual([JOB, "completed", null]);
    expect(JSON.parse((jobParams as unknown[])[3] as string)).toEqual({
      total_duration: 1200, model: "embeddinggemma:latest", digest: "85462619ee72", ollamaVersion: "0.40.2", items: 2, stored: 1, stale: 1,
    });
  });

  it("fails with invalid_ai_output for vectors of another size or count, without storing any", async () => {
    for (const output of [{ vectors: [vector(1), vector(2, EMBEDDING_DIMENSIONS - 1)] }, { vectors: [vector(1)] }, { vectors: [] }, { answer: "x" }, null]) {
      const worker = workerClient(locked());
      expect(await completeKnowledgeEmbedding(worker.client, JOB, success(output))).toBe("ok");
      expect(worker.chunkUpdate()).toBeUndefined();
      expect((worker.jobUpdate()![1] as unknown[]).slice(0, 3)).toEqual([JOB, "failed", "invalid_ai_output"]);
    }
    const broken = workerClient(locked({ ai_input: { promptVersion: KNOWLEDGE_PROMPT_VERSION } }));
    expect(await completeKnowledgeEmbedding(broken.client, JOB, success({ vectors: [vector(1)] }))).toBe("ok");
    expect((broken.jobUpdate()![1] as unknown[]).slice(0, 3)).toEqual([JOB, "failed", "invalid_ai_output"]);
  });

  it("fails with the worker's error code", async () => {
    const worker = workerClient(locked());
    expect(await completeKnowledgeEmbedding(worker.client, JOB, { leaseToken: LEASE, error: "ollama_unavailable" })).toBe("ok");
    expect(worker.chunkUpdate()).toBeUndefined();
    expect(worker.jobUpdate()![1]).toEqual([JOB, "failed", "ollama_unavailable", null]);
  });

  it("is idempotent for the same lease, expired for another or lost lease or a cancelled job, and missing for an unknown id", async () => {
    const done = workerClient(locked({ status: "completed", valid: null, ai_input: null }));
    expect(await completeKnowledgeEmbedding(done.client, JOB, success({ vectors: [vector(1), vector(2)] }))).toBe("ok");
    expect(done.jobUpdate()).toBeUndefined();
    for (const job of [locked({ lease_token: OTHER_LEASE }), locked({ valid: false }), locked({ status: "cancelled", lease_token: null }), locked({ status: "queued" })]) {
      const expired = workerClient(job);
      expect(await completeKnowledgeEmbedding(expired.client, JOB, success({ vectors: [vector(1), vector(2)] }))).toBe("expired");
      expect(expired.chunkUpdate()).toBeUndefined();
      expect(expired.jobUpdate()).toBeUndefined();
    }
    expect(await completeKnowledgeEmbedding(workerClient(null).client, JOB, success({ vectors: [] }))).toBe("missing");
  });
});

describe("housekeeping", () => {
  it("fails stuck jobs, deletes finished jobs after 7 days, at most once per interval", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 0, rows: [] }));
    const db = { query } as unknown as Parameters<typeof expireKnowledgeJobs>[0];
    await expireKnowledgeJobs(db);
    const [fail, params] = query.mock.calls[0]!;
    expect(fail).toContain("UPDATE ai_knowledge_jobs SET status='failed',error_code=$2,ai_input=NULL,lease_token=NULL,lease_until=NULL");
    expect(fail).toContain("(status='queued' AND created_at<now()-interval '24 hours')");
    expect(fail).toContain("(status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))");
    expect(params).toEqual([AI_JOB_MAX_ATTEMPTS, "worker_timeout"]);
    expect(query.mock.calls[1]![0]).toBe("DELETE FROM ai_knowledge_jobs WHERE status IN ('completed','failed','cancelled') AND updated_at<now()-interval '7 days'");
    const expire = createKnowledgeExpiry(60_000);
    expect(await expire(db)).toBe(true);
    expect(await expire(db)).toBe(false);
    expect(query).toHaveBeenCalledTimes(4);
  });
});
