import {
  MAX_ANSWER_CHARS,
  knowledgeOutputSchema,
  prepareBodySchema,
  type AssistantClaim,
  type EmbedSpec,
  type KnowledgeClaim
} from "../assistant/protocol.js";
import { ASSISTANT_CHAT_KIND, COMPETENCY_ASSESSMENT_KIND, KNOWLEDGE_EMBEDDING_KIND } from "../competency-assessment/ai/worker-protocol.js";
import { WorkerApiError, type ClaimedJob, type CompleteBody, type GenerationJob, type JobMetrics, type WorkerClient } from "./client.js";
import {
  AiWorkerError,
  GenerationAbortedError,
  parseJobOutput,
  type ChatJobKind,
  type OllamaChatResult,
  type OllamaJob,
  type OllamaMetrics,
  type OllamaModelInfo
} from "./ollama.js";

export type LogFields = Record<string, string | number | boolean | null | undefined>;
/** Structured logger. Callers only pass ids, codes and numbers — never prompts or outputs. */
export type WorkerLogger = (event: string, fields?: LogFields) => void;

export interface OllamaPort {
  /** One streamed chat call; onContent receives the answer so far whenever it grows (assistant answers). */
  chat(job: OllamaJob, signal: AbortSignal, onContent?: (content: string) => void): Promise<OllamaChatResult>;
  modelInfo(): Promise<OllamaModelInfo>;
  /** One vector per input, in order, from the local embedding model the spec names. */
  embed(spec: EmbedSpec, signal: AbortSignal): Promise<number[][]>;
  /** Ollama version and digest of a local model by name (the embedding model of a job); rejects a missing or remote one. */
  embeddingModelInfo(model: string): Promise<OllamaModelInfo>;
}

export interface WorkerTimings {
  heartbeatMs: number;
  idlePollMs: number;
  errorBackoffMs: number;
  extendEveryMs: number;
  completeRetries: number;
  /** Shortest gap between two /progress posts of an assistant answer. */
  progressEveryMs: number;
}

const DEFAULT_TIMINGS: WorkerTimings = {
  heartbeatMs: 20_000,
  // The server holds an empty claim up to CLAIM_WAIT_MS (12 s), so the worker only pauses briefly between claims.
  idlePollMs: 1_000,
  errorBackoffMs: 15_000,
  extendEveryMs: 180_000,
  completeRetries: 3,
  progressEveryMs: 700
};

export interface WorkerDeps {
  client: WorkerClient;
  ollama: OllamaPort;
  log: WorkerLogger;
  model: string;
  timings?: Partial<WorkerTimings>;
}

/** Resolves after ms, or immediately when the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof AiWorkerError) return { error: error.code, detail: error.detail };
  if (error instanceof WorkerApiError) return { error: "worker_api", status: error.status, code: error.code ?? null };
  if (error instanceof Error) {
    const code = (error as { code?: unknown; cause?: { code?: unknown } }).code ?? (error as { cause?: { code?: unknown } }).cause?.code;
    return { error: error.name, code: typeof code === "string" ? code : null };
  }
  return { error: "unknown" };
}

/** /extend or /prepare answering 409 (lease expired, question cancelled) or 404 (job gone): nothing is left to report. */
const jobGone = (error: unknown) => error instanceof WorkerApiError && (error.status === 409 || error.status === 404);

interface GenerationResult {
  output: Record<string, unknown>;
  metrics: OllamaMetrics;
  attempts: number;
}

/**
 * Runs the chat call and the local output check for the job kind. Retries exactly once when the model
 * returned unparseable or mis-shaped JSON (or an empty answer); never retries truncation (done_reason "length"),
 * timeouts or other errors.
 */
async function generateWithRetry(
  ollama: OllamaPort,
  job: OllamaJob,
  signal: AbortSignal,
  log: WorkerLogger,
  jobId: string,
  kind: ChatJobKind = COMPETENCY_ASSESSMENT_KIND,
  onContent?: (content: string) => void
): Promise<GenerationResult> {
  const maxAttempts = 2;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const result = await ollama.chat(job, signal, onContent);
    log("generation_finished", {
      job: jobId,
      kind,
      attempt,
      ms: Date.now() - started,
      prompt_eval_count: result.metrics.prompt_eval_count,
      eval_count: result.metrics.eval_count
    });
    try {
      return { output: parseJobOutput(kind, result.content), metrics: result.metrics, attempts: attempt };
    } catch (error) {
      if (!(error instanceof AiWorkerError) || error.code !== "invalid_ai_output" || attempt >= maxAttempts || signal.aborted) throw error;
      log("generation_retry", { job: jobId, kind, attempt, reason: error.detail });
    }
  }
}

type JobOutcome = "completed" | "failed" | "abandoned";
type CompletedBody = Extract<CompleteBody, { output: unknown }>;

async function completeWithRetry(deps: WorkerDeps, timings: WorkerTimings, jobId: string, body: CompleteBody, signal: AbortSignal): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      await deps.client.complete(jobId, body);
      return true;
    } catch (error) {
      const retriable = !(error instanceof WorkerApiError) || error.status >= 500 || error.status === 429;
      deps.log("complete_failed", { job: jobId, attempt: attempt + 1, ...errorFields(error) });
      if (!retriable || attempt >= timings.completeRetries || signal.aborted) return false;
      await sleep(timings.errorBackoffMs, signal);
    }
  }
}

/** A generation kind: the prompt came with the claim. */
async function generate(job: GenerationJob, info: OllamaModelInfo, deps: WorkerDeps, signal: AbortSignal): Promise<CompletedBody> {
  // A job object without kind (an older server, or a test double) is a competency assessment.
  const result = await generateWithRetry(deps.ollama, job, signal, deps.log, job.id, job.kind ?? COMPETENCY_ASSESSMENT_KIND);
  return { leaseToken: job.leaseToken, model: deps.model, digest: info.digest, ollamaVersion: info.version, metrics: result.metrics, output: result.output };
}

/** knowledge_embedding: one vector per text of the batch, from the embedding model the job names. */
async function embedKnowledge(job: KnowledgeClaim, deps: WorkerDeps, signal: AbortSignal): Promise<CompletedBody> {
  // The digest reported with the vectors; a missing or remote model fails here, before any text is sent.
  const embedInfo = await deps.ollama.embeddingModelInfo(job.embed.model);
  const started = Date.now();
  const vectors = await deps.ollama.embed(job.embed, signal);
  const ms = Date.now() - started;
  deps.log("embedding_finished", { job: job.id, kind: KNOWLEDGE_EMBEDDING_KIND, ms, count: vectors.length, dimensions: vectors[0]?.length ?? 0 });
  const output = knowledgeOutputSchema.safeParse({ vectors });
  if (!output.success || output.data.vectors.length !== job.embed.inputs.length) throw new AiWorkerError("invalid_ai_output", "vectors");
  return {
    leaseToken: job.leaseToken,
    model: job.embed.model,
    digest: embedInfo.digest,
    ollamaVersion: embedInfo.version,
    metrics: { embed_ms: ms, count: vectors.length },
    output: output.data
  };
}

/** The question's vector, as /prepare accepts it. */
async function embedQuestion(spec: EmbedSpec, deps: WorkerDeps, signal: AbortSignal): Promise<number[]> {
  // A missing or remote embedding model never receives the student's question.
  await deps.ollama.embeddingModelInfo(spec.model);
  const [vector] = await deps.ollama.embed({ model: spec.model, inputs: spec.inputs.slice(0, 1) }, signal);
  const checked = prepareBodySchema.shape.vector.safeParse(vector);
  if (!checked.success || !checked.data) throw new AiWorkerError("ai_failed", "embedding_invalid");
  return checked.data;
}

interface ProgressReporter {
  /** The answer so far: posted at once, then at most once per progressEveryMs, always the newest text. */
  update(content: string): void;
  /** No post after this; resolves once a post still in flight has settled. */
  stop(): Promise<void>;
}

/**
 * Posts an assistant answer to /progress while Gemma writes it, never two posts at once. A failed post never stops
 * the job; only the first failure of a job is logged (the others would repeat it every 700 ms).
 */
function createProgressReporter(deps: WorkerDeps, job: AssistantClaim, everyMs: number): ProgressReporter {
  let latest: string | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  let failureLogged = false;

  const send = () => {
    timer = undefined;
    if (stopped || inFlight || latest === null) return;
    const content = latest;
    latest = null;
    lastSentAt = Date.now();
    inFlight = deps.client
      .progress(job.id, { leaseToken: job.leaseToken, content })
      .catch((error: unknown) => {
        if (!failureLogged) deps.log("progress_failed", { job: job.id, ...errorFields(error) });
        failureLogged = true;
      })
      .finally(() => {
        inFlight = null;
        schedule();
      });
  };
  const schedule = () => {
    if (stopped || inFlight || timer || latest === null) return;
    const wait = lastSentAt + everyMs - Date.now();
    if (wait <= 0) send();
    else timer = setTimeout(send, wait);
  };
  return {
    update(content) {
      // /progress accepts at most MAX_ANSWER_CHARS.
      latest = content.length > MAX_ANSWER_CHARS ? content.slice(0, MAX_ANSWER_CHARS) : content;
      schedule();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      return inFlight ?? Promise.resolve();
    }
  };
}

/**
 * assistant_chat: embeds the question, gets the prompt from /prepare, then streams Gemma's plain-text answer to
 * /progress. A failed embedding only loses the vector: the server then searches by words only.
 */
async function answerQuestion(job: AssistantClaim, info: OllamaModelInfo, deps: WorkerDeps, timings: WorkerTimings, signal: AbortSignal): Promise<CompletedBody> {
  let vector: number[] | null = null;
  const embedMetrics: JobMetrics = {};
  if (job.embed) {
    const started = Date.now();
    try {
      vector = await embedQuestion(job.embed, deps, signal);
      embedMetrics.embed_ms = Date.now() - started;
      deps.log("embedding_finished", { job: job.id, kind: ASSISTANT_CHAT_KIND, ms: embedMetrics.embed_ms, dimensions: vector.length });
    } catch (error) {
      if (error instanceof GenerationAbortedError || signal.aborted) throw error;
      deps.log("embedding_failed", { job: job.id, kind: ASSISTANT_CHAT_KIND, ...errorFields(error) });
    }
  }
  const prompt = await deps.client.prepare(job.id, { leaseToken: job.leaseToken, vector });
  const progress = createProgressReporter(deps, job, timings.progressEveryMs);
  try {
    const chatJob: OllamaJob = { system: prompt.system, user: prompt.user, schema: null, options: prompt.options, think: prompt.think };
    const result = await generateWithRetry(deps.ollama, chatJob, signal, deps.log, job.id, ASSISTANT_CHAT_KIND, progress.update);
    const metrics: JobMetrics = { ...result.metrics, ...embedMetrics };
    return { leaseToken: job.leaseToken, model: deps.model, digest: info.digest, ollamaVersion: info.version, metrics, output: result.output };
  } finally {
    // The final text goes in /complete, which never runs next to a /progress post (an abandoned job does not wait).
    const settled = progress.stop();
    if (!signal.aborted) await settled;
  }
}

/** The /complete body of one job, by kind. */
function runJob(job: ClaimedJob, info: OllamaModelInfo, deps: WorkerDeps, timings: WorkerTimings, signal: AbortSignal): Promise<CompletedBody> {
  if (job.kind === KNOWLEDGE_EMBEDDING_KIND) return embedKnowledge(job, deps, signal);
  if (job.kind === ASSISTANT_CHAT_KIND) return answerQuestion(job, info, deps, timings, signal);
  return generate(job, info, deps, signal);
}

/** Runs one claimed job, extending the lease while it runs, then reports the result. */
export async function processJob(job: ClaimedJob, info: OllamaModelInfo, deps: WorkerDeps, signal: AbortSignal): Promise<JobOutcome> {
  const timings = { ...DEFAULT_TIMINGS, ...deps.timings };
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  signal.addEventListener("abort", onParentAbort, { once: true });
  if (signal.aborted) controller.abort();
  let leaseLost = false;
  let extending = false;
  const extendTimer = setInterval(() => {
    if (extending || controller.signal.aborted) return;
    extending = true;
    deps.client
      .extend(job.id, job.leaseToken)
      .then(() => deps.log("lease_extended", { job: job.id }))
      .catch((error: unknown) => {
        deps.log("lease_extend_failed", { job: job.id, ...errorFields(error) });
        if (jobGone(error)) {
          leaseLost = true;
          controller.abort();
        }
      })
      .finally(() => {
        extending = false;
      });
  }, timings.extendEveryMs);

  // A job object without kind (an older server, or a test double) is a competency assessment.
  const kind = job.kind ?? COMPETENCY_ASSESSMENT_KIND;
  deps.log("job_claimed", { job: job.id, kind, promptVersion: job.promptVersion });
  let body: CompleteBody;
  try {
    body = await runJob(job, info, deps, timings, controller.signal);
  } catch (error) {
    // Shutdown, a lost lease, or /prepare answering 409/404 (the question was cancelled or has expired).
    const gone = jobGone(error);
    if (error instanceof GenerationAbortedError || controller.signal.aborted || gone) {
      deps.log("job_abandoned", { job: job.id, leaseLost: leaseLost || gone });
      return "abandoned";
    }
    deps.log("generation_failed", { job: job.id, ...errorFields(error) });
    body = { leaseToken: job.leaseToken, error: error instanceof AiWorkerError ? error.code : "ai_failed" };
  } finally {
    clearInterval(extendTimer);
    signal.removeEventListener("abort", onParentAbort);
  }

  const reported = await completeWithRetry(deps, timings, job.id, body, signal);
  const outcome: JobOutcome = !reported ? "abandoned" : "output" in body ? "completed" : "failed";
  deps.log("job_finished", { job: job.id, kind, outcome });
  return outcome;
}

/**
 * Main loop: heartbeat every 20 s while Ollama is reachable, claim (the server holds an empty claim up to 12 s),
 * run the job, complete; idle poll 1 s, error backoff 15 s.
 */
export async function runWorker(deps: WorkerDeps, signal: AbortSignal): Promise<void> {
  const timings = { ...DEFAULT_TIMINGS, ...deps.timings };
  let ollamaHealthy = false;
  let reportedDown = false;
  let beating = false;
  const heartbeatTimer = setInterval(() => {
    if (!ollamaHealthy || beating || signal.aborted) return;
    beating = true;
    deps.client
      .heartbeat()
      .catch((error: unknown) => deps.log("heartbeat_failed", errorFields(error)))
      .finally(() => {
        beating = false;
      });
  }, timings.heartbeatMs);

  try {
    while (!signal.aborted) {
      let info: OllamaModelInfo;
      try {
        info = await deps.ollama.modelInfo();
        if (!ollamaHealthy) deps.log("ollama_ready", { ollamaVersion: info.version });
        ollamaHealthy = true;
        reportedDown = false;
      } catch (error) {
        if (!reportedDown) deps.log("ollama_unavailable", errorFields(error));
        reportedDown = true;
        ollamaHealthy = false;
        await sleep(timings.errorBackoffMs, signal);
        continue;
      }

      let job: ClaimedJob | null;
      try {
        job = await deps.client.claim();
      } catch (error) {
        deps.log("claim_failed", errorFields(error));
        await sleep(timings.errorBackoffMs, signal);
        continue;
      }
      if (!job) {
        await sleep(timings.idlePollMs, signal);
        continue;
      }

      try {
        await processJob(job, info, deps, signal);
      } catch (error) {
        deps.log("job_error", { job: job.id, ...errorFields(error) });
        await sleep(timings.errorBackoffMs, signal);
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
}
