import { describe, expect, it } from "vitest";
import { startCloudAiWorker } from "./cloud.js";
import { CLOUDFLARE_CHAT_MODEL } from "./cloudflare.js";
import type { FetchLike } from "./ollama.js";
import { aiProviderConfig } from "../config.js";
import { activeEmbeddingModel, embeddingProfile } from "../assistant/protocol.js";
import { isLoopbackAddress } from "../competency-assessment/ai/worker-router.js";

// Synthetic ids, keys and texts only.
const JOB_ID = "11111111-2222-4333-8444-555555555555";
const LEASE = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const sse = (text: string) => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });

describe("the AI worker inside the API on Cloudflare Workers AI", () => {
  it("claims a job from this server over loopback, runs it on Gemma 4 26B and completes it with the model id", async () => {
    const posted: { path: string; body: Record<string, unknown> }[] = [];
    let claims = 0;
    let finished!: () => void;
    const completed = new Promise<void>((resolve) => { finished = resolve; });
    const apiFetch: FetchLike = async (url, init) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      posted.push({ path, body });
      expect(url.startsWith("http://127.0.0.1:4321/api/worker/competency-assessments/")).toBe(true);
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${"k".repeat(40)}`);
      if (path.endsWith("/claim")) {
        claims += 1;
        return json({ job: claims === 1 ? {
          kind: "graduation_advice", id: JOB_ID, leaseToken: LEASE, promptVersion: "grad-advice-v4", system: "Hệ thống", user: "Dữ liệu",
          schema: { type: "object" }, options: { num_predict: 2048, temperature: 0.3 }
        } : null });
      }
      if (path.endsWith("/complete")) finished();
      return json({ ok: true });
    };
    const answer = { summary: "Bạn còn 2 điều kiện.", advice: [{ text: "Học lại môn X." }], nextSteps: ["Đăng ký học lại"] };
    const fetch: FetchLike = async (url) => url.includes("/models/search")
      ? json({ success: true, result: [{ name: CLOUDFLARE_CHAT_MODEL }] })
      : sse(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(answer) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    const worker = startCloudAiWorker({ port: 4321, workerKey: "k".repeat(40), accountId: "0".repeat(32), apiToken: "t".repeat(30), concurrency: 1, fetch, apiFetch, log: () => undefined });
    await completed;
    worker.stop();
    await worker.done;
    const complete = posted.find((item) => item.path.endsWith(`/${JOB_ID}/complete`))!;
    expect(complete.body).toMatchObject({ leaseToken: LEASE, model: CLOUDFLARE_CHAT_MODEL, digest: CLOUDFLARE_CHAT_MODEL, ollamaVersion: "cloudflare-workers-ai", output: answer });
  });
});

describe("AI_PROVIDER and the Cloudflare values", () => {
  it("runs on Cloudflare only when asked, and keeps the values only when they look right (a bad paste never stops the site)", () => {
    expect(aiProviderConfig({})).toEqual({ provider: "ollama", cloudflare: null, concurrency: 2, thinking: false });
    const good = aiProviderConfig({ AI_PROVIDER: " Cloudflare ", CLOUDFLARE_ACCOUNT_ID: ` "${"AB".repeat(16)}" `, CLOUDFLARE_API_TOKEN: "tok_".padEnd(40, "x"), AI_CONCURRENCY: "3", AI_THINKING: "on" });
    expect(good).toEqual({ provider: "cloudflare", cloudflare: { accountId: "ab".repeat(16), apiToken: "tok_".padEnd(40, "x") }, concurrency: 3, thinking: true });
    expect(aiProviderConfig({ AI_PROVIDER: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "not-an-id", CLOUDFLARE_API_TOKEN: "x".repeat(40) }).cloudflare).toBeNull();
    expect(aiProviderConfig({ AI_PROVIDER: "cloud", AI_CONCURRENCY: "9" })).toMatchObject({ provider: "ollama", concurrency: 2 });
  });

  it("embeds the knowledge index with BGE-M3 on Cloudflare (no prompt format, 1024 numbers) and EmbeddingGemma otherwise", () => {
    expect(activeEmbeddingModel({})).toBe("embeddinggemma");
    expect(activeEmbeddingModel({ AI_PROVIDER: "cloudflare" })).toBe("bge-m3");
    expect(embeddingProfile("bge-m3")).toMatchObject({ dimensions: 1024 });
    expect(embeddingProfile("bge-m3").query("Mình còn nợ môn nào?")).toBe("Mình còn nợ môn nào?");
    expect(embeddingProfile("bge-m3").document("Tiêu đề", "Nội dung")).toBe("Tiêu đề\nNội dung");
    expect(embeddingProfile("embeddinggemma").query("Câu hỏi")).toBe("task: search result | query: Câu hỏi");
  });

  it("lets only this machine reach the worker routes on Cloudflare", () => {
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(address)).toBe(true);
    for (const address of ["10.0.0.5", "::ffff:10.0.0.5", undefined]) expect(isLoopbackAddress(address)).toBe(false);
  });
});
