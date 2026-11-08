// The AI worker inside the API process (user 2026-11-08: Gemma off the PC, onto Cloudflare Workers AI). The same loop as
// the PC worker (worker.ts runWorker) and the same protocol, over loopback HTTP to this server's worker routes, so jobs,
// leases, retries and output checks stay as they are; only the models are Cloudflare's (cloudflare.ts). server.ts starts it
// when AI_PROVIDER=cloudflare. Logs carry ids, codes and numbers only: never a prompt, an answer or the API token.
import { createWorkerClient } from "./client.js";
import { CLOUDFLARE_CHAT_MODEL, cloudflareChat, cloudflareEmbed, cloudflareEmbeddingInfo, createCloudflareHealth, type CloudflareRuntime } from "./cloudflare.js";
import type { FetchLike } from "./ollama.js";
import { errorFields, runWorker, type LogFields, type OllamaPort, type WorkerLogger } from "./worker.js";

export interface CloudWorkerOptions {
  /** This server's port: the worker calls http://127.0.0.1:<port>/api/worker/…. */
  port: number;
  workerKey: string;
  accountId: string;
  apiToken: string;
  /** Jobs at a time: each loop claims and runs one job. */
  concurrency: number;
  /** Let jobs that ask for thinking think (AI_THINKING=on); off by default (cloudflare.ts CloudflareRuntime.thinking). */
  thinking?: boolean;
  timeoutMs?: number;
  log?: WorkerLogger;
  /** Calls to Workers AI (tests). */
  fetch?: FetchLike;
  /** Calls to this server (tests). */
  apiFetch?: FetchLike;
}

/** The worker's model port on Workers AI: Gemma for chat, BGE-M3 for embeddings, one health check for every loop. */
export function cloudModelPort(runtime: CloudflareRuntime, fetchImpl?: FetchLike): OllamaPort {
  const deps = fetchImpl ? { fetch: fetchImpl } : {};
  const health = createCloudflareHealth(runtime, deps);
  return {
    chat: (job, signal, onContent) => cloudflareChat(runtime, job, { ...deps, onContent }, signal),
    modelInfo: health,
    embed: (spec, signal) => cloudflareEmbed(runtime, spec, deps, signal),
    embeddingModelInfo: async (model) => cloudflareEmbeddingInfo(model)
  };
}

function defaultLog(event: string, fields: LogFields = {}): void {
  process.stdout.write(`[AI] ${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`);
}

/** Starts `concurrency` worker loops; stop() ends them after the job each one is running (its lease then lapses). */
export function startCloudAiWorker(options: CloudWorkerOptions): { stop(): void; done: Promise<void> } {
  const log = options.log ?? defaultLog;
  const runtime: CloudflareRuntime = {
    accountId: options.accountId, apiToken: options.apiToken, model: CLOUDFLARE_CHAT_MODEL, timeoutMs: options.timeoutMs ?? 600_000,
    thinking: options.thinking === true
  };
  const port = cloudModelPort(runtime, options.fetch);
  const controller = new AbortController();
  log("starting", { provider: "cloudflare", model: CLOUDFLARE_CHAT_MODEL, loops: options.concurrency, thinking: runtime.thinking === true });
  const loops = Array.from({ length: options.concurrency }, (_, index) => {
    const client = createWorkerClient({ apiUrl: `http://127.0.0.1:${options.port}`, workerKey: options.workerKey, ...(options.apiFetch ? { fetch: options.apiFetch } : {}) });
    const loopLog: WorkerLogger = (event, fields = {}) => log(event, { loop: index + 1, ...fields });
    return runWorker({ client, ollama: port, log: loopLog, model: CLOUDFLARE_CHAT_MODEL }, controller.signal).catch((error: unknown) => loopLog("fatal", errorFields(error)));
  });
  return { stop: () => controller.abort(), done: Promise.all(loops).then(() => undefined) };
}
