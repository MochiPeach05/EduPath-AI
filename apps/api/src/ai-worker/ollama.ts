import type { EmbedSpec } from "../assistant/protocol.js";
import {
  ASSISTANT_CHAT_KIND,
  CAREER_SKILL_SUGGESTION_KIND,
  COMPETENCY_COURSE_SUGGESTION_KIND,
  GRADUATION_ADVICE_KIND,
  STUDY_ROADMAP_KIND,
  type GenerationJobKind
} from "../competency-assessment/ai/worker-protocol.js";

/** Kinds whose job is one chat call: the generation kinds and the assistant answer. */
export type ChatJobKind = GenerationJobKind | typeof ASSISTANT_CHAT_KIND;

/** Error codes the worker may report to the API (contract C3). */
export const AI_ERROR_CODES = ["ai_timeout", "ai_output_truncated", "invalid_ai_output", "ollama_unavailable", "ai_failed"] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiWorkerError extends Error {
  readonly code: AiErrorCode;
  /** Short, non-sensitive reason for logs (never prompt or output text). */
  readonly detail: string;
  constructor(code: AiErrorCode, detail: string = code) {
    super(`${code}: ${detail}`);
    this.name = "AiWorkerError";
    this.code = code;
    this.detail = detail;
  }
}

/** Raised when the caller aborted generation (shutdown or lost lease). Not reported to the API. */
export class GenerationAbortedError extends Error {
  constructor() {
    super("generation_aborted");
    this.name = "GenerationAbortedError";
  }
}

export interface OllamaRuntime {
  ollamaUrl: string;
  model: string;
  contextLength: number;
  numGpu?: number;
  timeoutMs: number;
}

export interface OllamaJob {
  system: string;
  user: string;
  /** JSON schema of the answer (Ollama's format); null or undefined for a plain-text answer (Trợ lý AI). */
  schema: unknown;
  options: Record<string, unknown>;
  /**
   * Gemma's thinking mode, sent to Ollama as a boolean: true only when the job asks for it, false
   * otherwise (if omitted Ollama turns thinking on). The thinking text is never kept.
   */
  think?: boolean | undefined;
}

export const METRIC_KEYS = ["prompt_eval_count", "eval_count", "eval_duration", "total_duration", "load_duration"] as const;
export type OllamaMetrics = Partial<Record<(typeof METRIC_KEYS)[number], number>>;

export interface OllamaChatResult {
  content: string;
  doneReason: string | undefined;
  metrics: OllamaMetrics;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface OllamaDeps {
  fetch?: FetchLike;
  /**
   * Abort when no new data arrives for this long once streaming has started. Default 120 s.
   * Before the first chunk only the overall timeout applies, because a cold model load can take > 2 min.
   */
  inactivityMs?: number;
  /** Hard cap on accumulated output characters. */
  maxOutputChars?: number;
  /** Called with the answer so far (message.content, never the thinking) whenever it grows. Must not throw. */
  onContent?: ((content: string) => void) | undefined;
}

const OLLAMA_KEEP_ALIVE = "15m";
const DEFAULT_INACTIVITY_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
/** Generation options the worker forwards from the claimed job. Anything else (e.g. shift) is dropped. */
const FORWARDED_OPTION_KEYS = ["num_ctx", "num_predict", "temperature", "top_p", "top_k"] as const;

export function buildChatBody(runtime: OllamaRuntime, job: OllamaJob): Record<string, unknown> {
  const options: Record<string, number> = {};
  for (const key of FORWARDED_OPTION_KEYS) {
    const value = job.options[key];
    if (typeof value === "number" && Number.isFinite(value)) options[key] = value;
  }
  if (options.num_ctx === undefined) options.num_ctx = runtime.contextLength;
  if (runtime.numGpu !== undefined) options.num_gpu = runtime.numGpu;
  return {
    model: runtime.model,
    messages: [
      { role: "system", content: job.system },
      { role: "user", content: job.user }
    ],
    // No format at all for a plain-text answer.
    ...(job.schema === null || job.schema === undefined ? {} : { format: job.schema }),
    think: job.think === true,
    stream: true,
    truncate: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    options
  };
}

interface DoneLine {
  done_reason?: unknown;
  [key: string]: unknown;
}

/** Accumulates Ollama's NDJSON chat stream (message.content of every line). */
export class NdjsonAccumulator {
  content = "";
  done: DoneLine | null = null;
  private buffer = "";
  constructor(private readonly maxChars: number = DEFAULT_MAX_OUTPUT_CHARS) {}

  push(text: string): void {
    this.buffer += text;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      this.handleLine(line);
    }
  }

  end(): void {
    const rest = this.buffer;
    this.buffer = "";
    this.handleLine(rest);
    if (!this.done) throw new AiWorkerError("ai_failed", "stream_incomplete");
  }

  private handleLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!line || this.done) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new AiWorkerError("ai_failed", "stream_not_json");
    }
    if (!parsed || typeof parsed !== "object") throw new AiWorkerError("ai_failed", "stream_not_object");
    const record = parsed as Record<string, unknown>;
    if (record.error !== undefined) throw new AiWorkerError("ai_failed", "ollama_stream_error");
    const message = record.message as { content?: unknown } | undefined;
    if (message && typeof message.content === "string") {
      this.content += message.content;
      if (this.content.length > this.maxChars) throw new AiWorkerError("ai_failed", "output_too_large");
    }
    if (record.done === true) this.done = record as DoneLine;
  }
}

function pickMetrics(line: Record<string, unknown>): OllamaMetrics {
  const metrics: OllamaMetrics = {};
  for (const key of METRIC_KEYS) {
    const value = line[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) metrics[key] = value;
  }
  return metrics;
}

const UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

function isConnectionError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  const code = (error as { code?: unknown } | undefined)?.code ?? cause?.code;
  if (typeof code === "string" && UNAVAILABLE_CODES.has(code)) return true;
  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

type AbortReason = "timeout" | "inactivity" | "external";

function reasonError(reason: AbortReason): Error {
  if (reason === "external") return new GenerationAbortedError();
  return new AiWorkerError("ai_timeout", reason === "timeout" ? "overall_timeout" : "inactivity_timeout");
}

/**
 * Streams one /api/chat call. Resolves with the accumulated content and metrics, or throws an
 * AiWorkerError (ai_timeout, ai_output_truncated, ollama_unavailable, ai_failed) or GenerationAbortedError.
 */
export async function ollamaChat(runtime: OllamaRuntime, job: OllamaJob, deps: OllamaDeps = {}, signal?: AbortSignal): Promise<OllamaChatResult> {
  const fetchImpl: FetchLike = deps.fetch ?? fetch;
  const inactivityMs = deps.inactivityMs ?? DEFAULT_INACTIVITY_MS;
  const controller = new AbortController();
  let reason: AbortReason | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const abort = (why: AbortReason) => {
    if (reason) return;
    reason = why;
    controller.abort();
    reader?.cancel().catch(() => undefined);
  };
  // setTimeout instead of AbortSignal.timeout so the deadline is testable with fake timers.
  const overall = setTimeout(() => abort("timeout"), runtime.timeoutMs);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => abort("inactivity"), inactivityMs);
  };
  const onExternalAbort = () => abort("external");
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (signal?.aborted) abort("external");

  try {
    if (reason) throw reasonError(reason);
    let response: Response;
    try {
      response = await fetchImpl(`${runtime.ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify(buildChatBody(runtime, job)),
        redirect: "error",
        signal: controller.signal
      });
    } catch (error) {
      if (reason) throw reasonError(reason);
      if (isConnectionError(error)) throw new AiWorkerError("ollama_unavailable", "connection_failed");
      throw new AiWorkerError("ai_failed", "request_failed");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiWorkerError(response.status === 404 ? "ollama_unavailable" : "ai_failed", `ollama_http_${response.status}`);
    }
    if (!response.body) throw new AiWorkerError("ai_failed", "empty_body");

    const accumulator = new NdjsonAccumulator(deps.maxOutputChars);
    let reported = 0;
    const reportContent = () => {
      if (!deps.onContent || accumulator.content.length <= reported) return;
      reported = accumulator.content.length;
      deps.onContent(accumulator.content);
    };
    const decoder = new TextDecoder();
    reader = response.body.getReader();
    if (reason) await reader.cancel().catch(() => undefined);
    for (;;) {
      let chunk: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (reason) throw reasonError(reason);
        if (isConnectionError(error)) throw new AiWorkerError("ollama_unavailable", "stream_interrupted");
        throw new AiWorkerError("ai_failed", "stream_read_failed");
      }
      if (reason) throw reasonError(reason);
      if (chunk.done) break;
      resetIdle();
      accumulator.push(decoder.decode(chunk.value, { stream: true }));
      reportContent();
      if (accumulator.done) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    if (reason) throw reasonError(reason);
    accumulator.push(decoder.decode());
    accumulator.end();
    reportContent();
    const doneLine = accumulator.done as unknown as Record<string, unknown>;
    const doneReason = typeof doneLine.done_reason === "string" ? doneLine.done_reason : undefined;
    if (doneReason === "length") throw new AiWorkerError("ai_output_truncated", "done_reason_length");
    if (doneReason !== undefined && doneReason !== "stop") throw new AiWorkerError("ai_failed", "unexpected_done_reason");
    return { content: accumulator.content, doneReason, metrics: pickMetrics(doneLine) };
  } finally {
    clearTimeout(overall);
    if (idle) clearTimeout(idle);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

export interface EmbedOptions {
  /** GPU layers of the embedding model; 0 keeps it on the CPU so the GPU stays with Gemma. */
  numGpu: number;
  fetch?: FetchLike | undefined;
}

/** Far above 64 vectors of 4096 numbers; anything bigger is not a real answer. */
const MAX_EMBED_RESPONSE_CHARS = 32_000_000;

/** 6 decimals keep a 768-number vector near 7 kB in the /complete body; retrieval does not notice the difference. */
const roundEmbedding = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * One /api/embed call for every input of the spec. Resolves with one vector per input, in order, all of the same
 * length, rounded to 6 decimals; throws an AiWorkerError (ai_timeout, ollama_unavailable, ai_failed) or
 * GenerationAbortedError like ollamaChat.
 */
export async function ollamaEmbed(
  runtime: Pick<OllamaRuntime, "ollamaUrl" | "timeoutMs">,
  spec: EmbedSpec,
  options: EmbedOptions,
  signal?: AbortSignal
): Promise<number[][]> {
  const fetchImpl: FetchLike = options.fetch ?? fetch;
  const controller = new AbortController();
  let reason: AbortReason | null = null;
  const abort = (why: AbortReason) => {
    if (reason) return;
    reason = why;
    controller.abort();
  };
  const overall = setTimeout(() => abort("timeout"), runtime.timeoutMs);
  const onExternalAbort = () => abort("external");
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (signal?.aborted) abort("external");

  try {
    if (reason) throw reasonError(reason);
    let response: Response;
    try {
      response = await fetchImpl(`${runtime.ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ model: spec.model, input: spec.inputs, truncate: true, keep_alive: OLLAMA_KEEP_ALIVE, options: { num_gpu: options.numGpu } }),
        redirect: "error",
        signal: controller.signal
      });
    } catch (error) {
      if (reason) throw reasonError(reason);
      if (isConnectionError(error)) throw new AiWorkerError("ollama_unavailable", "connection_failed");
      throw new AiWorkerError("ai_failed", "request_failed");
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (reason) throw reasonError(reason);
      if (isConnectionError(error)) throw new AiWorkerError("ollama_unavailable", "response_interrupted");
      throw new AiWorkerError("ai_failed", "response_read_failed");
    }
    if (!response.ok) {
      // A model that is not pulled (404, or "model ... not found") or cannot embed (501) is a setup problem of this PC.
      const unavailable = response.status === 404 || response.status === 501 || /model[\s\S]{0,300}not found/i.test(text.slice(0, 2_000));
      throw new AiWorkerError(unavailable ? "ollama_unavailable" : "ai_failed", `ollama_http_${response.status}`);
    }
    if (text.length > MAX_EMBED_RESPONSE_CHARS) throw new AiWorkerError("ai_failed", "response_too_large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiWorkerError("ai_failed", "response_not_json");
    }
    const embeddings = (parsed as { embeddings?: unknown } | null)?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== spec.inputs.length) throw new AiWorkerError("ai_failed", "embedding_count");
    const first: unknown = embeddings[0];
    const dimensions = Array.isArray(first) ? first.length : 0;
    if (dimensions === 0) throw new AiWorkerError("ai_failed", "embedding_empty");
    return embeddings.map((vector: unknown) => {
      if (!Array.isArray(vector) || vector.length !== dimensions) throw new AiWorkerError("ai_failed", "embedding_dimensions");
      return vector.map((value: unknown) => {
        if (typeof value !== "number" || !Number.isFinite(value)) throw new AiWorkerError("ai_failed", "embedding_not_finite");
        return roundEmbedding(value);
      });
    });
  } finally {
    clearTimeout(overall);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

const TOP_LEVEL_ARRAYS = ["groupInsights", "strengths", "improvements", "gaps", "nextSteps"] as const;

function parseJsonObject(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    throw new AiWorkerError("invalid_ai_output", "not_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AiWorkerError("invalid_ai_output", "not_object");
  return parsed as Record<string, unknown>;
}

/**
 * Quick local parse + shape check before posting (the API validates fully).
 * Throws invalid_ai_output when the content is not a plausible AiOutput object.
 */
export function parseAiOutput(content: string): Record<string, unknown> {
  const output = parseJsonObject(content);
  if (typeof output.summary !== "string" || output.summary.trim() === "") throw new AiWorkerError("invalid_ai_output", "summary");
  if (typeof output.progress !== "string") throw new AiWorkerError("invalid_ai_output", "progress");
  for (const key of TOP_LEVEL_ARRAYS) {
    if (!Array.isArray(output[key])) throw new AiWorkerError("invalid_ai_output", key);
  }
  const careerFit = output.careerFit as { comment?: unknown } | null | undefined;
  if (!careerFit || typeof careerFit !== "object" || typeof careerFit.comment !== "string") {
    throw new AiWorkerError("invalid_ai_output", "careerFit");
  }
  const nextSteps = output.nextSteps as unknown[];
  if (nextSteps.length < 1 || nextSteps.some((step) => typeof step !== "string")) throw new AiWorkerError("invalid_ai_output", "nextSteps");
  return output;
}

/**
 * Quick local check of a career skill suggestion: a JSON object with a "suggestions" array and a
 * "newSkills" array of objects. The API drops bad items and validates the rest.
 */
export function parseCareerSuggestionOutput(content: string): Record<string, unknown> {
  const output = parseJsonObject(content);
  for (const key of ["suggestions", "newSkills"] as const) {
    const items = output[key];
    if (!Array.isArray(items) || items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      throw new AiWorkerError("invalid_ai_output", key);
    }
  }
  return output;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Quick local check of a graduation advice: a JSON object with a non-empty "summary" string, an
 * "advice" array of objects with a string "text" and a "nextSteps" array of strings. The API
 * drops bad items and validates the rest.
 */
export function parseGraduationAdviceOutput(content: string): Record<string, unknown> {
  const output = parseJsonObject(content);
  if (typeof output.summary !== "string" || output.summary.trim() === "") throw new AiWorkerError("invalid_ai_output", "summary");
  const advice = output.advice;
  if (!Array.isArray(advice) || advice.some((item) => !isPlainObject(item) || typeof item.text !== "string")) {
    throw new AiWorkerError("invalid_ai_output", "advice");
  }
  const nextSteps = output.nextSteps;
  if (!Array.isArray(nextSteps) || nextSteps.some((step) => typeof step !== "string")) throw new AiWorkerError("invalid_ai_output", "nextSteps");
  return output;
}

/**
 * Quick local check of a course proposal: a JSON object with a "weights" array (weights mode) or a
 * "links" array (links and full modes, plus an optional "newSkills" array), all of objects. The API
 * drops bad items, scales the percentages and validates the rest.
 */
export function parseCourseSuggestionOutput(content: string): Record<string, unknown> {
  const output = parseJsonObject(content);
  const objects = (value: unknown) => Array.isArray(value) && value.every(isPlainObject);
  if ("weights" in output) {
    if (!objects(output.weights)) throw new AiWorkerError("invalid_ai_output", "weights");
    return output;
  }
  if (!objects(output.links)) throw new AiWorkerError("invalid_ai_output", "links");
  if ("newSkills" in output && !objects(output.newSkills)) throw new AiWorkerError("invalid_ai_output", "newSkills");
  return output;
}

/**
 * Quick local check of a study roadmap: a JSON object with a non-empty "summary" string and "study", "improve",
 * "skills" and "months" arrays of objects. The API drops bad items and validates the rest.
 */
export function parseStudyRoadmapOutput(content: string): Record<string, unknown> {
  const output = parseJsonObject(content);
  if (typeof output.summary !== "string" || output.summary.trim() === "") throw new AiWorkerError("invalid_ai_output", "summary");
  for (const key of ["study", "improve", "skills", "months"] as const) {
    const items = output[key];
    if (!Array.isArray(items) || !items.every(isPlainObject)) throw new AiWorkerError("invalid_ai_output", key);
  }
  return output;
}

/** A "Trợ lý AI" answer is plain text: the trimmed content, which must not be empty. The API validates the rest. */
export function parseAssistantOutput(content: string): { answer: string } {
  const answer = content.trim();
  if (!answer) throw new AiWorkerError("invalid_ai_output", "answer");
  return { answer };
}

/** The local output check for a job kind. */
export function parseJobOutput(kind: ChatJobKind, content: string): Record<string, unknown> {
  if (kind === ASSISTANT_CHAT_KIND) return parseAssistantOutput(content);
  if (kind === CAREER_SKILL_SUGGESTION_KIND) return parseCareerSuggestionOutput(content);
  if (kind === GRADUATION_ADVICE_KIND) return parseGraduationAdviceOutput(content);
  if (kind === COMPETENCY_COURSE_SUGGESTION_KIND) return parseCourseSuggestionOutput(content);
  if (kind === STUDY_ROADMAP_KIND) return parseStudyRoadmapOutput(content);
  return parseAiOutput(content);
}

export interface OllamaModelInfo {
  version: string;
  digest: string;
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new AiWorkerError("ollama_unavailable", "connection_failed");
  }
  if (!response.ok) throw new AiWorkerError("ollama_unavailable", `ollama_http_${response.status}`);
  const text = await response.text();
  if (text.length > 1_000_000) throw new AiWorkerError("ollama_unavailable", "response_too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new AiWorkerError("ollama_unavailable", "response_not_json");
  }
}

function sameModel(name: unknown, wanted: string): boolean {
  if (typeof name !== "string") return false;
  const withTag = wanted.includes(":") ? wanted : `${wanted}:latest`;
  return name === wanted || name === withTag;
}

/**
 * Reads the Ollama version (/api/version) and the digest of a local model (/api/tags): the configured chat model, or
 * the embedding model named by a job.
 */
export async function getOllamaModelInfo(runtime: Pick<OllamaRuntime, "ollamaUrl" | "model">, deps: Pick<OllamaDeps, "fetch"> = {}): Promise<OllamaModelInfo> {
  const fetchImpl: FetchLike = deps.fetch ?? fetch;
  const versionBody = (await getJson(fetchImpl, `${runtime.ollamaUrl}/api/version`)) as { version?: unknown };
  const tagsBody = (await getJson(fetchImpl, `${runtime.ollamaUrl}/api/tags`)) as { models?: unknown };
  const models = Array.isArray(tagsBody.models) ? (tagsBody.models as Record<string, unknown>[]) : [];
  const entry = models.find((model) => model && (sameModel(model.name, runtime.model) || sameModel(model.model, runtime.model)));
  if (!entry || typeof entry.digest !== "string") throw new AiWorkerError("ollama_unavailable", "model_missing");
  if (entry.remote_host !== undefined || entry.remote_model !== undefined) throw new AiWorkerError("ollama_unavailable", "model_is_remote");
  return { version: typeof versionBody.version === "string" ? versionBody.version : "unknown", digest: entry.digest };
}

/** Loads the model with the same runner parameters as real jobs (num_ctx, num_gpu) so the first job does not reload it. */
export async function warmUpOllama(runtime: OllamaRuntime, deps: OllamaDeps = {}, signal?: AbortSignal): Promise<void> {
  try {
    await ollamaChat(
      runtime,
      { system: "Trả lời ngắn gọn.", user: "Xin chào", schema: undefined, options: { num_ctx: runtime.contextLength, num_predict: 1 } },
      deps,
      signal
    );
  } catch (error) {
    // num_predict 1 normally ends with done_reason "length"; that still means the model is loaded.
    if (error instanceof AiWorkerError && error.code === "ai_output_truncated") return;
    throw error;
  }
}
