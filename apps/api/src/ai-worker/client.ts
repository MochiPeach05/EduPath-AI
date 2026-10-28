import { z } from "zod";
import {
  assistantClaimSchema,
  knowledgeClaimSchema,
  preparedPromptSchema,
  type PreparedPrompt,
  type prepareBodySchema,
  type progressBodySchema
} from "../assistant/protocol.js";
import { AI_JOB_KINDS, COMPETENCY_ASSESSMENT_KIND, GENERATION_JOB_KINDS, type AiJobKind } from "../competency-assessment/ai/worker-protocol.js";
import type { AiErrorCode, FetchLike, OllamaMetrics } from "./ollama.js";

const WORKER_API_PATH = "/api/worker/competency-assessments";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Claimed jobs carry the prompt and schema; anything far above this is not a real response. */
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class WorkerApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, code?: string) {
    super(`worker_api_${status}${code ? `_${code}` : ""}`);
    this.name = "WorkerApiError";
    this.status = status;
    this.code = code;
  }
}

/** A job that carries its prompt: one Ollama chat call with system, user, schema and options. */
const generationJobSchema = z.object({
  /** Servers released before career suggestions send no kind; their jobs are competency assessments. */
  kind: z.enum(GENERATION_JOB_KINDS).default(COMPETENCY_ASSESSMENT_KIND),
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  leaseToken: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(64),
  system: z.string().min(1),
  user: z.string().min(1),
  schema: z.record(z.string(), z.unknown()),
  options: z.record(z.string(), z.unknown()),
  /** Gemma's thinking mode; course proposals and student comments ask for it. Absent means off. */
  think: z.boolean().optional()
});
/** Or a "Trợ lý AI" job without a prompt (assistant/protocol.ts): a student's question, or knowledge texts to embed. */
const claimedJobSchema = z.union([generationJobSchema, assistantClaimSchema, knowledgeClaimSchema]);
const claimResponseSchema = z.object({ job: claimedJobSchema.nullable() });
const extendResponseSchema = z.object({ leaseUntil: z.string().min(1) });

export type GenerationJob = z.infer<typeof generationJobSchema>;
export type ClaimedJob = z.infer<typeof claimedJobSchema>;

/** Ollama's chat metrics, plus the embedding time (embed_ms) and the number of vectors (count) of embedding work. */
export type JobMetrics = OllamaMetrics & { embed_ms?: number; count?: number };

export type CompleteBody =
  | { leaseToken: string; model: string; digest: string; ollamaVersion: string; metrics: JobMetrics; output: Record<string, unknown> }
  | { leaseToken: string; error: AiErrorCode };

export interface WorkerClient {
  heartbeat(): Promise<void>;
  /** The server may hold an empty claim up to CLAIM_WAIT_MS (12 s) for a question to arrive. */
  claim(): Promise<ClaimedJob | null>;
  extend(jobId: string, leaseToken: string): Promise<{ leaseUntil: string }>;
  /** assistant_chat: the question's vector (null when embedding failed) in, the prompt to run out. */
  prepare(jobId: string, body: z.infer<typeof prepareBodySchema>): Promise<PreparedPrompt>;
  /** assistant_chat: the answer so far, shown to the student while Gemma writes. */
  progress(jobId: string, body: z.infer<typeof progressBodySchema>): Promise<void>;
  complete(jobId: string, body: CompleteBody): Promise<void>;
}

interface WorkerClientOptions {
  apiUrl: string;
  workerKey: string;
  fetch?: FetchLike;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  /** Job kinds advertised on /heartbeat and /claim; default: every kind this worker can run. */
  kinds?: readonly AiJobKind[];
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new WorkerApiError(response.status, "response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new WorkerApiError(response.status, "response_too_large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** HTTP client for the worker protocol (contract C3). Never follows redirects; caps response size. */
export function createWorkerClient(options: WorkerClientOptions): WorkerClient {
  const fetchImpl: FetchLike = options.fetch ?? fetch;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const kinds = [...(options.kinds ?? AI_JOB_KINDS)];
  const base = `${new URL(options.apiUrl).origin}${WORKER_API_PATH}`;

  async function post(path: string, body: unknown): Promise<unknown> {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.workerKey}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body ?? {}),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw new WorkerApiError(response.status, "redirect_refused");
    }
    const text = await readCapped(response, maxBytes);
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new WorkerApiError(response.status, "response_not_json");
      }
    }
    if (!response.ok) {
      const code = (data as { error?: unknown } | null)?.error;
      throw new WorkerApiError(response.status, typeof code === "string" ? code.slice(0, 64) : undefined);
    }
    return data;
  }

  return {
    async heartbeat() {
      await post("/heartbeat", { kinds });
    },
    async claim() {
      const parsed = claimResponseSchema.safeParse(await post("/claim", { kinds, wait: true }));
      if (!parsed.success) throw new WorkerApiError(200, "invalid_claim_response");
      return parsed.data.job;
    },
    async extend(jobId, leaseToken) {
      const parsed = extendResponseSchema.safeParse(await post(`/${encodeURIComponent(jobId)}/extend`, { leaseToken }));
      if (!parsed.success) throw new WorkerApiError(200, "invalid_extend_response");
      return parsed.data;
    },
    async prepare(jobId, body) {
      const parsed = preparedPromptSchema.safeParse(await post(`/${encodeURIComponent(jobId)}/prepare`, { leaseToken: body.leaseToken, vector: body.vector }));
      if (!parsed.success) throw new WorkerApiError(200, "invalid_prepare_response");
      return parsed.data;
    },
    async progress(jobId, body) {
      await post(`/${encodeURIComponent(jobId)}/progress`, { leaseToken: body.leaseToken, content: body.content });
    },
    async complete(jobId, body) {
      await post(`/${encodeURIComponent(jobId)}/complete`, body);
    }
  };
}
