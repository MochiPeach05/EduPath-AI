import { describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_CHAT_MODEL,
  SCHEMA_NOTE,
  SseAccumulator,
  buildCloudflareChatBody,
  cloudflareChat,
  cloudflareEmbed,
  cloudflareEmbeddingInfo,
  createCloudflareHealth,
  jsonOnly,
  visibleContent,
  type CloudflareRuntime
} from "./cloudflare.js";
import { AiWorkerError, GenerationAbortedError, type FetchLike, type OllamaJob } from "./ollama.js";

// Synthetic account, token and texts only.
const runtime: CloudflareRuntime = { accountId: "0123456789abcdef0123456789abcdef", apiToken: "test-token-0123456789abcdef", model: CLOUDFLARE_CHAT_MODEL, timeoutMs: 600_000 };
const job: OllamaJob = {
  system: "Hệ thống thử",
  user: "Dữ liệu thử",
  schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
  options: { num_ctx: 16384, num_predict: 8192, temperature: 0.4, top_p: 0.95, top_k: 64 },
  think: true
};
const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const delta = (content: string, extra: Record<string, unknown> = {}) => chunk({ choices: [{ index: 0, delta: { content, ...extra }, finish_reason: null }] });
const finish = (reason = "stop") => chunk({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const usage = chunk({ choices: [], usage: { prompt_tokens: 5000, completion_tokens: 1200, total_tokens: 6200 } });

function sse(chunks: string[], init: { status?: number; hang?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++] as string));
        return;
      }
      if (init.hang) return new Promise<void>(() => undefined);
      controller.close();
      return;
    }
  });
  return new Response(body, { status: init.status ?? 200, headers: { "content-type": "text/event-stream" } });
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("the chat body Workers AI receives", () => {
  it("turns the job into an OpenAI chat completion: num_predict as max_completion_tokens, the schema at the end of the prompt, thinking stated", () => {
    // Thinking only with AI_THINKING=on, with room for it on top of num_predict. No response_format: under json_schema mode
    // Gemma 26B padded its answer with blank lines up to the token limit (2026-11-08).
    const body = buildCloudflareChatBody({ ...runtime, thinking: true }, job);
    expect(body).toEqual({
      model: "@cf/google/gemma-4-26b-a4b-it",
      messages: [{ role: "system", content: "Hệ thống thử" }, { role: "user", content: `Dữ liệu thử\n\n${SCHEMA_NOTE}\n${JSON.stringify(job.schema)}` }],
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 8192 + 16_384,
      chat_template_kwargs: { enable_thinking: true },
      temperature: 0.4,
      top_p: 0.95,
      response_format: { type: "json_object" }
    });
    expect(buildCloudflareChatBody(runtime, job, "json_schema").response_format).toEqual({ type: "json_schema", json_schema: { name: "answer", schema: job.schema } });
    expect(buildCloudflareChatBody(runtime, job, "none")).not.toHaveProperty("response_format");
    expect(buildCloudflareChatBody(runtime, { ...job, schema: null })).not.toHaveProperty("response_format");
  });

  it("asks in json_schema mode first, and in json_object mode when the answer runs into blank space or the schema is refused", async () => {
    const bodies: Record<string, unknown>[] = [];
    const runaway: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1
        ? sse([delta('{"summary":'), ...Array.from({ length: 40 }, () => delta(" ".repeat(50))), delta("\n"), finish("length"), "data: [DONE]\n\n"])
        : sse([delta('{"summary":"Ổn"}'), finish(), "data: [DONE]\n\n"]);
    };
    expect((await cloudflareChat(runtime, job, { fetch: runaway })).content).toBe('{"summary":"Ổn"}');
    expect((bodies[0]!.response_format as { type: string }).type).toBe("json_schema");
    expect(bodies[1]!.response_format).toEqual({ type: "json_object" });
    bodies.length = 0;
    const refused: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? json({ errors: [{ code: 5006, message: "bad schema" }], success: false }, 400) : sse([delta('{"summary":"Được"}'), finish(), "data: [DONE]\n\n"]);
    };
    expect((await cloudflareChat(runtime, job, { fetch: refused })).content).toBe('{"summary":"Được"}');
    expect(bodies.map((body) => (body.response_format as { type: string }).type)).toEqual(["json_schema", "json_object"]);
    // A plain-text answer (Trợ lý AI) asks for no JSON at all.
    bodies.length = 0;
    await cloudflareChat(runtime, { ...job, schema: null }, { fetch: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return sse([delta("Chào bạn"), finish(), "data: [DONE]\n\n"]); } });
    expect(bodies[0]).not.toHaveProperty("response_format");
  });

  it("drops the empty keys json_object mode sometimes adds", () => {
    expect(JSON.parse(jsonOnly('{"careerFit":{"comment":"Phù hợp.","":" "},"gaps":[{"":"x","key":"S1"}]}'))).toEqual({ careerFit: { comment: "Phù hợp." }, gaps: [{ key: "S1" }] });
  });

  it("keeps thinking off by default even when the job asks for it (Gemma 26B looped in its thoughts, 2026-11-08)", () => {
    const body = buildCloudflareChatBody(runtime, job);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.max_completion_tokens).toBe(8192);
    // A roadmap's 12288 (sized for E4B's thinking) is capped without thinking, so a runaway answer costs less.
    expect(buildCloudflareChatBody(runtime, { ...job, options: { num_predict: 12288 } }).max_completion_tokens).toBe(8192);
  });

  it("says thinking is off when the job does not ask for it (Workers AI turns it on otherwise), and sends no schema for plain text", () => {
    const body = buildCloudflareChatBody(runtime, { system: "s", user: "u", schema: null, options: { num_predict: 160, temperature: 0 } });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body).not.toHaveProperty("response_format");
    expect(body.max_completion_tokens).toBe(160);
    expect(body.temperature).toBe(0);
  });
});

describe("cloudflareChat", () => {
  it("streams the answer, skips the thinking, and reports Ollama-named metrics and the neurons it cost", async () => {
    const fetch = vi.fn<FetchLike>(async () => sse([delta("", { reasoning_content: "nghĩ trước" }), delta('{"summary":'), delta('"Tốt"}'), finish(), usage, "data: [DONE]\n\n"]));
    const seen: string[] = [];
    const spent: number[] = [];
    const result = await cloudflareChat(runtime, job, { fetch, onContent: (text) => seen.push(text), onNeurons: (n) => spent.push(n) });
    // usage: 5000 prompt and 1200 answer tokens at Gemma's prices.
    expect(spent).toHaveLength(1);
    expect(spent[0]).toBeCloseTo(5000 * 0.10 / 11 + 1200 * 0.30 / 11);
    expect(result.content).toBe('{"summary":"Tốt"}');
    expect(result.doneReason).toBe("stop");
    expect(result.metrics).toMatchObject({ prompt_eval_count: 5000, eval_count: 1200 });
    expect(seen.at(-1)).toBe('{"summary":"Tốt"}');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1/chat/completions");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-token-0123456789abcdef");
  });

  it("reports a cut answer as ai_output_truncated", async () => {
    const fetch: FetchLike = async () => sse([delta('{"summary":"Tố'), finish("length"), "data: [DONE]\n\n"]);
    await expect(cloudflareChat(runtime, job, { fetch })).rejects.toMatchObject({ code: "ai_output_truncated" });
  });

  it("takes the JSON object out of an answer in a fence or with words around it, for a job with a schema only", async () => {
    const fenced: FetchLike = async () => sse([delta("Đây là kết quả:\n```json\n"), delta('{"summary":"Ổn"}'), delta("\n```"), finish(), "data: [DONE]\n\n"]);
    expect((await cloudflareChat(runtime, job, { fetch: fenced })).content).toBe('{"summary":"Ổn"}');
    const plain: FetchLike = async () => sse([delta("Câu trả lời {không phải JSON}"), finish(), "data: [DONE]\n\n"]);
    expect((await cloudflareChat(runtime, { ...job, schema: null }, { fetch: plain })).content).toBe("Câu trả lời {không phải JSON}");
    expect(jsonOnly("không có JSON")).toBe("không có JSON");
  });

  it("mends the small slips of JSON written without json_schema mode, and leaves good JSON alone", () => {
    // Seen 2026-11-08 in a competency comment: a stray empty string before a closing brace.
    expect(JSON.parse(jsonOnly('{"careerFit":{"comment":"Phù hợp.",""},"gaps":[]}'))).toEqual({ careerFit: { comment: "Phù hợp." }, gaps: [] });
    expect(JSON.parse(jsonOnly('{"steps":["Ôn SQL","Làm dự án",],"note":"Dòng 1\nDòng 2"}'))).toEqual({ steps: ["Ôn SQL", "Làm dự án"], note: "Dòng 1\nDòng 2" });
    expect(JSON.parse(jsonOnly('{"text":"Có dấu phẩy, và \\"ngoặc\\" trong chuỗi: ,\\"\\"}"}'))).toEqual({ text: 'Có dấu phẩy, và "ngoặc" trong chuỗi: ,""}' });
    expect(jsonOnly('{"a":1}')).toBe('{"a":1}');
    expect(jsonOnly('{"a":')).toBe('{"a":');
  });

  it("asks again when Workers AI is busy or fails, at most twice, then reports ai_failed", async () => {
    let calls = 0;
    const busy: FetchLike = async () => {
      calls += 1;
      return calls < 3 ? json({ errors: [{ code: 3040, message: "Capacity temporarily exceeded" }] }, 429) : sse([delta('{"summary":"Được"}'), finish(), "data: [DONE]\n\n"]);
    };
    await expect(cloudflareChat(runtime, job, { fetch: busy, retryDelaysMs: [1, 1] })).resolves.toMatchObject({ content: '{"summary":"Được"}' });
    expect(calls).toBe(3);
    const down: FetchLike = async () => json({ errors: [{ code: 1000, message: "internal" }] }, 502);
    await expect(cloudflareChat(runtime, job, { fetch: down, retryDelaysMs: [1, 1] })).rejects.toMatchObject({ code: "ai_failed", detail: "cloudflare_http_502" });
  });

  it("never asks again once the day's free neurons are used up, a token is refused or the model is gone: ollama_unavailable", async () => {
    for (const [response, detail] of [
      [json({ errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] }, 429), "cloudflare_daily_limit"],
      [json({ errors: [{ code: 10000, message: "Authentication error" }] }, 401), "cloudflare_http_401"],
      [json({ errors: [{ code: 5007, message: "No such model" }] }, 404), "cloudflare_model_missing"]
    ] as const) {
      const fetch = vi.fn<FetchLike>(async () => response.clone());
      await expect(cloudflareChat(runtime, job, { fetch, retryDelaysMs: [1, 1] })).rejects.toMatchObject({ code: "ollama_unavailable", detail });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("maps a stream that stops without a finish to ai_failed and an outside abort to GenerationAbortedError", async () => {
    await expect(cloudflareChat(runtime, job, { fetch: async () => sse([delta("{")]) })).rejects.toMatchObject({ code: "ai_failed", detail: "stream_incomplete" });
    const controller = new AbortController();
    const pending = cloudflareChat(runtime, job, { fetch: async () => sse([delta("{")], { hang: true }) }, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toBeInstanceOf(GenerationAbortedError);
  });

  it("times out a stream that goes silent", async () => {
    await expect(cloudflareChat(runtime, job, { fetch: async () => sse([delta("{")], { hang: true }), inactivityMs: 20 })).rejects.toMatchObject({ code: "ai_timeout", detail: "inactivity_timeout" });
  });
});

describe("visibleContent and the SSE reader", () => {
  it("keeps thinking that slipped into the text away from the answer, also while it is still being written", () => {
    expect(visibleContent("<|channel>thought\nnghĩ<channel|>{\"a\":1}")).toBe('{"a":1}');
    expect(visibleContent("<think>nghĩ</think>\n Trả lời")).toBe("Trả lời");
    expect(visibleContent("<think>đang nghĩ")).toBe("");
    expect(visibleContent("Câu trả lời bình thường")).toBe("Câu trả lời bình thường");
  });

  it("reads chunks split anywhere, comments and Workers AI's own response field", () => {
    const reader = new SseAccumulator();
    const text = `: keep-alive\n\n${delta("Xin ")}${chunk({ response: "chào" })}${finish()}data: [DONE]\n\n`;
    for (let i = 0; i < text.length; i += 7) reader.push(text.slice(i, i + 7));
    reader.end();
    expect(reader.content).toBe("Xin chào");
    expect(reader.finishReason).toBe("stop");
    expect(() => new SseAccumulator().push(chunk({ error: { message: "x" } }))).toThrow(AiWorkerError);
  });
});

describe("cloudflareEmbed", () => {
  it("embeds with BGE-M3 on Workers AI, vectors in the order of the inputs, rounded to 6 decimals", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ object: "list", data: [{ index: 1, embedding: [0.4, 0.5] }, { index: 0, embedding: [0.1234567891, 0.2] }] }));
    const vectors = await cloudflareEmbed(runtime, { model: "bge-m3", inputs: ["một", "hai"] }, { fetch });
    expect(vectors).toEqual([[0.123457, 0.2], [0.4, 0.5]]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1/embeddings");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "@cf/baai/bge-m3", input: ["một", "hai"] });
  });

  it("refuses a model Workers AI does not run for this index, and answers with the wrong count or length", async () => {
    await expect(cloudflareEmbed(runtime, { model: "embeddinggemma", inputs: ["x"] }, { fetch: async () => json({}) })).rejects.toMatchObject({ code: "ollama_unavailable" });
    await expect(cloudflareEmbed(runtime, { model: "bge-m3", inputs: ["x", "y"] }, { fetch: async () => json({ data: [{ index: 0, embedding: [1] }] }) })).rejects.toMatchObject({ detail: "embedding_count" });
    await expect(cloudflareEmbed(runtime, { model: "bge-m3", inputs: ["x", "y"] }, { fetch: async () => json({ data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1, 2] }] }) })).rejects.toMatchObject({ detail: "embedding_dimensions" });
    expect(cloudflareEmbeddingInfo("bge-m3")).toEqual({ version: "cloudflare-workers-ai", digest: "@cf/baai/bge-m3" });
  });
});

describe("the day's neuron budget in the health check", () => {
  it("says Workers AI is unavailable once the day's budget is spent, so the worker stops taking jobs", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ success: true, result: [{ name: CLOUDFLARE_CHAT_MODEL }] }));
    let left = true;
    const health = createCloudflareHealth(runtime, { fetch, budget: { limit: 9_000, allows: async () => left, spend: async () => undefined } });
    await expect(health()).resolves.toMatchObject({ digest: CLOUDFLARE_CHAT_MODEL });
    left = false;
    await expect(health()).rejects.toMatchObject({ code: "ollama_unavailable", detail: "daily_budget" });
  });
});

describe("createCloudflareHealth", () => {
  it("checks the token and the model at most every 10 minutes, and reports a refusal as ollama_unavailable", async () => {
    let now = 0;
    const fetch = vi.fn<FetchLike>(async () => json({ success: true, result: [{ name: CLOUDFLARE_CHAT_MODEL }] }));
    const health = createCloudflareHealth(runtime, { fetch, now: () => now });
    await expect(health()).resolves.toEqual({ version: "cloudflare-workers-ai", digest: CLOUDFLARE_CHAT_MODEL });
    now = 5 * 60_000;
    await health();
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 11 * 60_000;
    await health();
    expect(fetch).toHaveBeenCalledTimes(2);
    const refused = createCloudflareHealth(runtime, { fetch: async () => json({ success: false, errors: [{ code: 10000 }] }, 403) });
    await expect(refused()).rejects.toMatchObject({ code: "ollama_unavailable", detail: "cloudflare_http_403" });
    const missing = createCloudflareHealth(runtime, { fetch: async () => json({ success: true, result: [] }) });
    await expect(missing()).rejects.toMatchObject({ detail: "model_missing" });
  });
});
