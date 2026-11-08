// Cloudflare Workers AI as the AI worker's models (user 2026-11-08: "Chốt phương án … bắt đầu quá trình đẩy lên worker AI
// của Cloudflare"): the same jobs, prompts and checks as the PC's Ollama (ollama.ts), through Workers AI's REST API, so no
// model runs on the user's PC any more. The chat model is Gemma 4 26B A4B (vision, 256k context, JSON schema output,
// thinking via chat_template_kwargs) and the knowledge index uses BGE-M3 (EmbeddingGemma on Workers AI is shut down on
// 2026-11-20). Cloudflare keeps no input or output after a request and trains no model on them (zero data retention).
// Nothing here logs a prompt, an answer or the API token.
import { AiWorkerError, GenerationAbortedError, type FetchLike, type OllamaChatResult, type OllamaJob, type OllamaMetrics, type OllamaModelInfo } from "./ollama.js";
import type { EmbedSpec } from "../assistant/protocol.js";

export const CLOUDFLARE_CHAT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
/** The embedding models a job may name (assistant/protocol.ts EMBEDDING_PROFILES) and their Workers AI ids. */
export const CLOUDFLARE_EMBEDDING_MODELS: Readonly<Record<string, string>> = { "bge-m3": "@cf/baai/bge-m3" };
/** Reported where Ollama's version went (the jobs' ollama_version column). */
export const CLOUDFLARE_VERSION = "cloudflare-workers-ai";
const API_ORIGIN = "https://api.cloudflare.com";

export interface CloudflareRuntime {
  accountId: string;
  apiToken: string;
  /** The chat model (CLOUDFLARE_CHAT_MODEL). */
  model: string;
  timeoutMs: number;
}

interface CloudflareDeps {
  fetch?: FetchLike;
  /** Abort when no new data arrives for this long once streaming has started. Default 120 s. */
  inactivityMs?: number;
  maxOutputChars?: number;
  /** Called with the visible answer so far whenever it grows (never the thinking). Must not throw. */
  onContent?: ((content: string) => void) | undefined;
  /** Waits before the 2nd and 3rd try of a request Workers AI could not take (busy, 5xx, network). */
  retryDelaysMs?: readonly number[];
}

const DEFAULT_INACTIVITY_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
const DEFAULT_RETRY_DELAYS_MS = [3_000, 10_000] as const;
/** A job without num_predict (none today): room for thinking and a long answer. */
const DEFAULT_MAX_COMPLETION_TOKENS = 16_384;

const base = (runtime: Pick<CloudflareRuntime, "accountId">) => `${API_ORIGIN}/client/v4/accounts/${encodeURIComponent(runtime.accountId)}/ai`;
const headers = (runtime: Pick<CloudflareRuntime, "apiToken">) => ({
  authorization: `Bearer ${runtime.apiToken}`,
  "content-type": "application/json",
  accept: "application/json, text/event-stream"
});

/**
 * The /v1/chat/completions body of a job: Ollama's num_predict becomes max_completion_tokens (it covers thinking and
 * answer on both), temperature and top_p go as they are (num_ctx and top_k have no counterpart), the JSON schema
 * becomes response_format, and thinking is always stated because Workers AI turns it on when nothing is said.
 */
export function buildCloudflareChatBody(runtime: Pick<CloudflareRuntime, "model">, job: OllamaJob, withSchema = true): Record<string, unknown> {
  const numberOption = (key: string) => {
    const value = job.options[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const maxTokens = numberOption("num_predict");
  const body: Record<string, unknown> = {
    model: runtime.model,
    messages: [
      { role: "system", content: job.system },
      { role: "user", content: job.user }
    ],
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: maxTokens !== undefined && maxTokens > 0 ? Math.round(maxTokens) : DEFAULT_MAX_COMPLETION_TOKENS,
    chat_template_kwargs: { enable_thinking: job.think === true }
  };
  const temperature = numberOption("temperature");
  const topP = numberOption("top_p");
  if (temperature !== undefined) body.temperature = temperature;
  if (topP !== undefined) body.top_p = topP;
  if (withSchema && job.schema !== null && job.schema !== undefined && typeof job.schema === "object") {
    body.response_format = { type: "json_schema", json_schema: { name: "answer", schema: job.schema } };
  }
  return body;
}

/**
 * The answer without any thinking that slipped into the text (Gemma's thought channel, or a think block): normally the
 * server keeps thinking apart (reasoning_content), so this only guards against a template change. An unclosed block at
 * the start (thinking still being written) hides everything.
 */
export function visibleContent(text: string): string {
  let visible = text.replace(/<\|channel\|?>thought[\s\S]*?<channel\|>/g, "").replace(/<think>[\s\S]*?<\/think>/g, "");
  const open = visible.search(/<\|channel\|?>thought|<think>/);
  if (open >= 0) visible = visible.slice(0, open);
  return visible.replace(/^\s+/, "");
}

/** Accumulates a Server-Sent Events chat stream (OpenAI chunks: choices[0].delta.content; the thinking is skipped). */
export class SseAccumulator {
  content = "";
  finishReason: string | null = null;
  usage: Record<string, unknown> | null = null;
  done = false;
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
    if (!this.done && this.finishReason === null) throw new AiWorkerError("ai_failed", "stream_incomplete");
  }

  private handleLine(rawLine: string): void {
    const line = rawLine.trim();
    // Comments (": keep-alive") and the event/id/retry fields carry no data.
    if (!line || this.done || !line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      this.done = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new AiWorkerError("ai_failed", "stream_not_json");
    }
    if (!parsed || typeof parsed !== "object") throw new AiWorkerError("ai_failed", "stream_not_object");
    const record = parsed as Record<string, unknown>;
    if (record.error !== undefined && record.error !== null) throw new AiWorkerError("ai_failed", "cloudflare_stream_error");
    const choice = Array.isArray(record.choices) ? (record.choices[0] as Record<string, unknown> | undefined) : undefined;
    const delta = (choice?.delta ?? choice?.message) as { content?: unknown } | undefined;
    // Workers AI's own stream format writes the text in "response".
    const piece = typeof delta?.content === "string" ? delta.content : typeof record.response === "string" ? record.response : "";
    if (piece) {
      this.content += piece;
      if (this.content.length > this.maxChars) throw new AiWorkerError("ai_failed", "output_too_large");
    }
    if (typeof choice?.finish_reason === "string") this.finishReason = choice.finish_reason;
    if (record.usage && typeof record.usage === "object") this.usage = record.usage as Record<string, unknown>;
  }
}

/** Ollama's metric names, so the jobs store the same numbers: prompt tokens, answer tokens (thinking included), time. */
function usageMetrics(usage: Record<string, unknown> | null, ms: number): OllamaMetrics {
  const metrics: OllamaMetrics = { total_duration: Math.round(ms * 1e6) };
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
  const prompt = count(usage?.prompt_tokens);
  const completion = count(usage?.completion_tokens);
  if (prompt !== undefined) metrics.prompt_eval_count = prompt;
  if (completion !== undefined) metrics.eval_count = completion;
  return metrics;
}

/** Workers AI's error codes in the body: 4006 = the free daily neurons are used up; 3040 = model busy. */
async function errorCodes(response: Response): Promise<number[]> {
  try {
    const text = (await response.text()).slice(0, 20_000);
    const body = JSON.parse(text) as { errors?: { code?: unknown }[]; error?: { code?: unknown } };
    const codes = [...(body.errors ?? []).map((item) => item?.code), body.error?.code];
    return codes.map(Number).filter((code) => Number.isFinite(code));
  } catch {
    return [];
  }
}

const UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);
function isConnectionError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  const code = (error as { code?: unknown } | undefined)?.code ?? cause?.code;
  if (typeof code === "string" && UNAVAILABLE_CODES.has(code)) return true;
  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

/** A failed request: whether trying again may help (busy, server error, network), and the error to report otherwise. */
type Failure = { retry: boolean; error: AiWorkerError };

async function responseFailure(response: Response): Promise<Failure> {
  const status = response.status;
  const codes = await errorCodes(response);
  if (codes.includes(4006)) return { retry: false, error: new AiWorkerError("ollama_unavailable", "cloudflare_daily_limit") };
  if (status === 401 || status === 403) return { retry: false, error: new AiWorkerError("ollama_unavailable", `cloudflare_http_${status}`) };
  if (status === 404) return { retry: false, error: new AiWorkerError("ollama_unavailable", "cloudflare_model_missing") };
  if (status === 408 || status === 429 || status >= 500 || codes.includes(3040)) return { retry: true, error: new AiWorkerError("ai_failed", `cloudflare_http_${status}`) };
  return { retry: false, error: new AiWorkerError("ai_failed", `cloudflare_http_${status}`) };
}

type AbortReason = "timeout" | "inactivity" | "external";
function reasonError(reason: AbortReason): Error {
  if (reason === "external") return new GenerationAbortedError();
  return new AiWorkerError("ai_timeout", reason === "timeout" ? "overall_timeout" : "inactivity_timeout");
}

/** Resolves after ms, or at once when the signal aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * One streamed chat completion, like ollamaChat: resolves with the visible content and Ollama-named metrics, or throws
 * an AiWorkerError (ai_timeout, ai_output_truncated, ollama_unavailable = Workers AI unreachable, refused or out of the
 * day's neurons, ai_failed) or GenerationAbortedError. A request Workers AI could not take is sent again up to twice;
 * a JSON schema it refuses (400) is dropped once and the prompt's own description of the JSON is relied on.
 */
export async function cloudflareChat(runtime: CloudflareRuntime, job: OllamaJob, deps: CloudflareDeps = {}, signal?: AbortSignal): Promise<OllamaChatResult> {
  const fetchImpl: FetchLike = deps.fetch ?? fetch;
  const inactivityMs = deps.inactivityMs ?? DEFAULT_INACTIVITY_MS;
  const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const controller = new AbortController();
  let reason: AbortReason | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const abort = (why: AbortReason) => {
    if (reason) return;
    reason = why;
    controller.abort();
    reader?.cancel().catch(() => undefined);
  };
  const overall = setTimeout(() => abort("timeout"), runtime.timeoutMs);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => abort("inactivity"), inactivityMs);
  };
  const onExternalAbort = () => abort("external");
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (signal?.aborted) abort("external");
  const started = Date.now();

  try {
    let withSchema = true;
    let response: Response | null = null;
    for (let attempt = 0; ; attempt++) {
      if (reason) throw reasonError(reason);
      let failure: Failure;
      try {
        response = await fetchImpl(`${base(runtime)}/v1/chat/completions`, {
          method: "POST",
          headers: headers(runtime),
          body: JSON.stringify(buildCloudflareChatBody(runtime, job, withSchema)),
          redirect: "error",
          signal: controller.signal
        });
        if (response.ok) break;
        if (response.status === 400 && withSchema && job.schema) {
          await response.body?.cancel().catch(() => undefined);
          withSchema = false;
          continue;
        }
        failure = await responseFailure(response);
      } catch (error) {
        if (reason) throw reasonError(reason);
        failure = { retry: isConnectionError(error), error: new AiWorkerError(isConnectionError(error) ? "ollama_unavailable" : "ai_failed", "request_failed") };
      }
      const delay = retryDelays[attempt];
      if (!failure.retry || delay === undefined) throw failure.error;
      await pause(delay, controller.signal);
    }
    if (!response?.body) throw new AiWorkerError("ai_failed", "empty_body");

    const accumulator = new SseAccumulator(deps.maxOutputChars);
    let reported = "";
    const reportContent = () => {
      if (!deps.onContent) return;
      const visible = visibleContent(accumulator.content);
      if (visible.length <= reported.length) return;
      reported = visible;
      deps.onContent(visible);
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
    const finish = accumulator.finishReason ?? "stop";
    if (finish === "length") throw new AiWorkerError("ai_output_truncated", "finish_reason_length");
    if (finish !== "stop") throw new AiWorkerError("ai_failed", "unexpected_finish_reason");
    return { content: visibleContent(accumulator.content), doneReason: finish, metrics: usageMetrics(accumulator.usage, Date.now() - started) };
  } finally {
    clearTimeout(overall);
    if (idle) clearTimeout(idle);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** 6 decimals, as ollamaEmbed: a 1024-number vector stays near 9 kB in the /complete body. */
const roundEmbedding = (value: number) => Math.round(value * 1e6) / 1e6;
const MAX_EMBED_RESPONSE_CHARS = 32_000_000;

/**
 * One /v1/embeddings call for every input of the spec, like ollamaEmbed: one vector per input, in order, all of the same
 * length, rounded to 6 decimals. The spec names the model as the knowledge index does ("bge-m3").
 */
export async function cloudflareEmbed(
  runtime: Pick<CloudflareRuntime, "accountId" | "apiToken" | "timeoutMs">,
  spec: EmbedSpec,
  deps: Pick<CloudflareDeps, "fetch" | "retryDelaysMs"> = {},
  signal?: AbortSignal
): Promise<number[][]> {
  const model = CLOUDFLARE_EMBEDDING_MODELS[spec.model];
  if (!model) throw new AiWorkerError("ollama_unavailable", "model_missing");
  const fetchImpl: FetchLike = deps.fetch ?? fetch;
  const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
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
    let text = "";
    for (let attempt = 0; ; attempt++) {
      if (reason) throw reasonError(reason);
      let failure: Failure;
      try {
        const response = await fetchImpl(`${base(runtime)}/v1/embeddings`, {
          method: "POST",
          headers: headers(runtime),
          body: JSON.stringify({ model, input: spec.inputs }),
          redirect: "error",
          signal: controller.signal
        });
        if (response.ok) {
          text = await response.text();
          break;
        }
        failure = await responseFailure(response);
      } catch (error) {
        if (reason) throw reasonError(reason);
        failure = { retry: isConnectionError(error), error: new AiWorkerError(isConnectionError(error) ? "ollama_unavailable" : "ai_failed", "request_failed") };
      }
      const delay = retryDelays[attempt];
      if (!failure.retry || delay === undefined) throw failure.error;
      await pause(delay, controller.signal);
    }
    if (text.length > MAX_EMBED_RESPONSE_CHARS) throw new AiWorkerError("ai_failed", "response_too_large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiWorkerError("ai_failed", "response_not_json");
    }
    const data = (parsed as { data?: unknown } | null)?.data;
    if (!Array.isArray(data) || data.length !== spec.inputs.length) throw new AiWorkerError("ai_failed", "embedding_count");
    const ordered = [...data].sort((a, b) => Number((a as { index?: unknown })?.index ?? 0) - Number((b as { index?: unknown })?.index ?? 0));
    const vectors = ordered.map((item) => (item as { embedding?: unknown } | null)?.embedding);
    const dimensions = Array.isArray(vectors[0]) ? vectors[0].length : 0;
    if (dimensions === 0) throw new AiWorkerError("ai_failed", "embedding_empty");
    return vectors.map((vector) => {
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

/** The version and "digest" a job records: Workers AI and the model id. Throws for an embedding model it does not run. */
export function cloudflareEmbeddingInfo(model: string): OllamaModelInfo {
  const id = CLOUDFLARE_EMBEDDING_MODELS[model];
  if (!id) throw new AiWorkerError("ollama_unavailable", "model_missing");
  return { version: CLOUDFLARE_VERSION, digest: id };
}

/** How long a good check of the token and model is trusted before Workers AI is asked again. */
const HEALTH_TTL_MS = 10 * 60_000;

/**
 * The worker's modelInfo: Workers AI answers for this account and token and lists the chat model. Checked at most every
 * 10 minutes (the worker asks before every claim); a refusal or no answer is ollama_unavailable, so the worker stops its
 * heartbeat and the pages say the AI is not ready.
 */
export function createCloudflareHealth(runtime: Pick<CloudflareRuntime, "accountId" | "apiToken" | "model">, deps: Pick<CloudflareDeps, "fetch"> & { now?: () => number } = {}) {
  const fetchImpl: FetchLike = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let checkedAt = Number.NEGATIVE_INFINITY;
  const info: OllamaModelInfo = { version: CLOUDFLARE_VERSION, digest: runtime.model };
  return async (): Promise<OllamaModelInfo> => {
    if (now() - checkedAt < HEALTH_TTL_MS) return info;
    const name = runtime.model.split("/").at(-1) ?? runtime.model;
    let response: Response;
    try {
      response = await fetchImpl(`${base(runtime)}/models/search?search=${encodeURIComponent(name)}&per_page=5`, {
        method: "GET",
        headers: headers(runtime),
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new AiWorkerError("ollama_unavailable", "connection_failed");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiWorkerError("ollama_unavailable", `cloudflare_http_${response.status}`);
    }
    let body: { success?: unknown; result?: unknown };
    try {
      body = JSON.parse((await response.text()).slice(0, 2_000_000)) as typeof body;
    } catch {
      throw new AiWorkerError("ollama_unavailable", "response_not_json");
    }
    const models = Array.isArray(body.result) ? (body.result as { name?: unknown }[]) : [];
    if (body.success !== true || !models.some((model) => model?.name === runtime.model)) throw new AiWorkerError("ollama_unavailable", "model_missing");
    checkedAt = now();
    return info;
  };
}
