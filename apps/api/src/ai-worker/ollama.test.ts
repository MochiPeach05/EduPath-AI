import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiWorkerError,
  GenerationAbortedError,
  NdjsonAccumulator,
  buildChatBody,
  getOllamaModelInfo,
  ollamaChat,
  ollamaEmbed,
  parseAiOutput,
  parseAssistantOutput,
  parseCareerSuggestionOutput,
  parseCourseSuggestionOutput,
  parseGraduationAdviceOutput,
  parseJobOutput,
  parseStudyRoadmapOutput,
  type FetchLike,
  type OllamaJob,
  type OllamaRuntime
} from "./ollama.js";

const runtime: OllamaRuntime = { ollamaUrl: "http://127.0.0.1:11434", model: "gemma4:e4b", contextLength: 16384, timeoutMs: 600_000 };
const job: OllamaJob = {
  system: "Hệ thống thử",
  user: "Dữ liệu thử",
  schema: { type: "object" },
  options: { num_ctx: 16384, num_predict: 4096, temperature: 0.4, top_p: 0.95, top_k: 64, shift: true, seed: "x" }
};

const validOutput = {
  summary: "Bạn có nền tảng lập trình ổn.",
  groupInsights: [],
  strengths: [],
  improvements: [],
  careerFit: { comment: "Phù hợp một phần." },
  gaps: [],
  progress: "Đúng tiến độ.",
  nextSteps: ["Ôn SQL", "Làm dự án nhỏ", "Học kiểm thử"]
};

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const doneLine = (reason = "stop") =>
  line({ done: true, done_reason: reason, prompt_eval_count: 5000, eval_count: 2000, eval_duration: 1e9, total_duration: 2e9, load_duration: 3e8, prompt_eval_duration: 5 });

function streamResponse(chunks: string[], init: { status?: number; hang?: boolean } = {}): Response {
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
  return new Response(body, { status: init.status ?? 200 });
}

function fetchReturning(response: Response): { fetch: FetchLike; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response;
    }
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildChatBody", () => {
  it("sends think:false as a boolean, stream, truncate:false, keep_alive and only whitelisted options", () => {
    const body = buildChatBody(runtime, job);
    expect(body.think).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.truncate).toBe(false);
    expect(body.keep_alive).toBe("15m");
    expect(body.format).toEqual({ type: "object" });
    expect(body.options).toEqual({ num_ctx: 16384, num_predict: 4096, temperature: 0.4, top_p: 0.95, top_k: 64 });
    expect(JSON.stringify(body)).not.toContain("shift");
    expect(body.messages).toEqual([
      { role: "system", content: "Hệ thống thử" },
      { role: "user", content: "Dữ liệu thử" }
    ]);
  });

  it("turns Gemma's thinking on only when the job asks for it", () => {
    expect(buildChatBody(runtime, { ...job, think: true }).think).toBe(true);
    expect(buildChatBody(runtime, { ...job, think: false }).think).toBe(false);
    expect(buildChatBody(runtime, { ...job, think: "yes" as unknown as boolean }).think).toBe(false);
  });

  it("adds num_gpu when configured and falls back to the configured context", () => {
    const body = buildChatBody({ ...runtime, numGpu: 34 }, { ...job, options: {} });
    expect(body.options).toEqual({ num_ctx: 16384, num_gpu: 34 });
  });

  it("sends no format at all for a plain-text answer (schema null or undefined)", () => {
    for (const schema of [null, undefined]) {
      const body = buildChatBody(runtime, { ...job, schema });
      expect("format" in body).toBe(false);
      expect(JSON.stringify(body)).not.toContain("format");
      expect(body.stream).toBe(true);
    }
  });
});

describe("NdjsonAccumulator", () => {
  it("joins message.content across lines split at arbitrary chunk boundaries, including CRLF", () => {
    const acc = new NdjsonAccumulator();
    const text = line({ message: { content: "{\"a\":" } }).replace("\n", "\r\n") + line({ message: { content: "\"Tiếng Việt\"}" } }) + doneLine();
    for (let i = 0; i < text.length; i += 7) acc.push(text.slice(i, i + 7));
    acc.end();
    expect(acc.content).toBe("{\"a\":\"Tiếng Việt\"}");
    expect(acc.done?.done_reason).toBe("stop");
  });

  it("accepts a final done line without a trailing newline", () => {
    const acc = new NdjsonAccumulator();
    acc.push(line({ message: { content: "x" } }) + doneLine().trimEnd());
    acc.end();
    expect(acc.content).toBe("x");
  });

  it("fails on an {error} line, on a non-JSON line and on a stream without done", () => {
    expect(() => new NdjsonAccumulator().push(line({ error: "model runner crashed" }))).toThrowError(expect.objectContaining({ code: "ai_failed" }));
    expect(() => new NdjsonAccumulator().push("not json\n")).toThrowError(expect.objectContaining({ code: "ai_failed" }));
    const acc = new NdjsonAccumulator();
    acc.push(line({ message: { content: "x" } }));
    expect(() => acc.end()).toThrowError(expect.objectContaining({ code: "ai_failed", detail: "stream_incomplete" }));
  });

  it("caps the accumulated output", () => {
    const acc = new NdjsonAccumulator(10);
    expect(() => acc.push(line({ message: { content: "x".repeat(11) } }))).toThrowError(expect.objectContaining({ detail: "output_too_large" }));
  });
});

describe("ollamaChat", () => {
  it("streams, posts to /api/chat and returns content plus the five metrics", async () => {
    const { fetch, calls } = fetchReturning(streamResponse([line({ message: { content: "{\"ok\"" } }), line({ message: { content: ":1}" } }), doneLine()]));
    const result = await ollamaChat(runtime, job, { fetch });
    expect(result.content).toBe("{\"ok\":1}");
    expect(result.doneReason).toBe("stop");
    expect(result.metrics).toEqual({ prompt_eval_count: 5000, eval_count: 2000, eval_duration: 1e9, total_duration: 2e9, load_duration: 3e8 });
    expect(calls[0]?.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(calls[0]?.init?.redirect).toBe("error");
    expect(JSON.parse(String(calls[0]?.init?.body)).think).toBe(false);
  });

  it("maps done_reason length to ai_output_truncated", async () => {
    const { fetch } = fetchReturning(streamResponse([line({ message: { content: "{\"summary\":\"cắt" } }), doneLine("length")]));
    await expect(ollamaChat(runtime, job, { fetch })).rejects.toMatchObject({ code: "ai_output_truncated" });
  });

  it("maps an unexpected done_reason and an {error} line to ai_failed", async () => {
    await expect(ollamaChat(runtime, job, fetchReturning(streamResponse([doneLine("load")])))).rejects.toMatchObject({ code: "ai_failed" });
    await expect(ollamaChat(runtime, job, fetchReturning(streamResponse([line({ error: "boom" })])))).rejects.toMatchObject({ code: "ai_failed" });
  });

  it("maps connection refused to ollama_unavailable and HTTP errors to ai_failed / ollama_unavailable", async () => {
    const refused: FetchLike = async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    };
    await expect(ollamaChat(runtime, job, { fetch: refused })).rejects.toMatchObject({ code: "ollama_unavailable" });
    await expect(ollamaChat(runtime, job, fetchReturning(new Response("{\"error\":\"x\"}", { status: 404 })))).rejects.toMatchObject({ code: "ollama_unavailable" });
    await expect(ollamaChat(runtime, job, fetchReturning(new Response("{\"error\":\"x\"}", { status: 500 })))).rejects.toMatchObject({ code: "ai_failed" });
  });

  it("aborts with ai_timeout after 120 s without new data", async () => {
    vi.useFakeTimers();
    const { fetch } = fetchReturning(streamResponse([line({ message: { content: "{" } })], { hang: true }));
    const assertion = expect(ollamaChat(runtime, job, { fetch })).rejects.toMatchObject({ code: "ai_timeout", detail: "inactivity_timeout" });
    await vi.advanceTimersByTimeAsync(119_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it("does not apply the inactivity timer while the model is still loading (before the first chunk)", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(encoder.encode(line({ message: { content: "{}" } }) + doneLine()));
          controller.close();
        }, 150_000);
      }
    });
    const pending = ollamaChat(runtime, job, fetchReturning(new Response(body)));
    await vi.advanceTimersByTimeAsync(151_000);
    await expect(pending).resolves.toMatchObject({ content: "{}" });
  });

  it("aborts with ai_timeout at the overall deadline even while data keeps arriving", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        return new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            controller.enqueue(encoder.encode(line({ message: { content: "x" } })));
            resolve();
          }, 60_000);
        });
      },
      cancel() {
        clearTimeout(timer);
      }
    });
    const { fetch } = fetchReturning(new Response(body));
    const assertion = expect(ollamaChat({ ...runtime, timeoutMs: 300_000 }, job, { fetch })).rejects.toMatchObject({ code: "ai_timeout", detail: "overall_timeout" });
    await vi.advanceTimersByTimeAsync(301_000);
    await assertion;
  });

  it("throws GenerationAbortedError when the caller aborts", async () => {
    const controller = new AbortController();
    const { fetch } = fetchReturning(streamResponse([line({ message: { content: "{" } })], { hang: true }));
    const pending = ollamaChat(runtime, job, { fetch }, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toBeInstanceOf(GenerationAbortedError);
  });

  it("reports the answer so far through onContent whenever it grows, never the thinking", async () => {
    const seen: string[] = [];
    const chunks = [
      line({ message: { role: "assistant", content: "", thinking: "BÍ MẬT SUY NGHĨ" } }),
      line({ message: { content: "", thinking: " vẫn nghĩ" } }),
      line({ message: { content: "Bạn " } }) + line({ message: { content: "nên " } }),
      line({ message: { content: "" } }),
      line({ message: { content: "học SQL." } }).slice(0, 10),
      line({ message: { content: "học SQL." } }).slice(10),
      doneLine()
    ];
    const { fetch } = fetchReturning(streamResponse(chunks));
    const result = await ollamaChat(runtime, { ...job, schema: null, think: true }, { fetch, onContent: (content) => seen.push(content) });
    expect(result.content).toBe("Bạn nên học SQL.");
    expect(seen).toEqual(["Bạn nên ", "Bạn nên học SQL."]);
    expect(seen.join()).not.toContain("BÍ MẬT");
  });

  it("reports content that arrives in a last line without a newline", async () => {
    const seen: string[] = [];
    const { fetch } = fetchReturning(streamResponse([line({ message: { content: "Xin " } }), JSON.stringify({ message: { content: "chào" }, done: true, done_reason: "stop" })]));
    await ollamaChat(runtime, { ...job, schema: null }, { fetch, onContent: (content) => seen.push(content) });
    expect(seen).toEqual(["Xin ", "Xin chào"]);
  });
});

describe("ollamaEmbed", () => {
  const embedRuntime = { ollamaUrl: "http://127.0.0.1:11434", timeoutMs: 600_000 };
  const spec = { model: "embeddinggemma", inputs: ["task: search result | query: SQL", "title: none | text: Cơ sở dữ liệu"] };
  const fetchJson = (body: unknown, status = 200) => fetchReturning(new Response(JSON.stringify(body), { status }));

  it("posts every input to /api/embed on the CPU and returns one rounded vector per input", async () => {
    const { fetch, calls } = fetchJson({ model: "embeddinggemma", embeddings: [[0.12345678, -0.5, 1e-9], [0.000_000_6, 0.25, -0.987_654_321]], total_duration: 1 });
    const vectors = await ollamaEmbed(embedRuntime, spec, { numGpu: 0, fetch });
    expect(vectors).toEqual([[0.123457, -0.5, 0], [0.000001, 0.25, -0.987654]]);
    expect(calls[0]?.url).toBe("http://127.0.0.1:11434/api/embed");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.redirect).toBe("error");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "embeddinggemma",
      input: spec.inputs,
      truncate: true,
      keep_alive: "15m",
      options: { num_gpu: 0 }
    });
  });

  it("passes the configured GPU layers", async () => {
    const { fetch, calls } = fetchJson({ embeddings: [[1], [2]] });
    await ollamaEmbed(embedRuntime, spec, { numGpu: 12, fetch });
    expect(JSON.parse(String(calls[0]?.init?.body)).options).toEqual({ num_gpu: 12 });
  });

  it.each<[string, unknown, string]>([
    ["fewer vectors than inputs", { embeddings: [[0.1, 0.2]] }, "embedding_count"],
    ["no embeddings", { model: "embeddinggemma" }, "embedding_count"],
    ["vectors of different lengths", { embeddings: [[0.1, 0.2], [0.1]] }, "embedding_dimensions"],
    ["a vector that is not an array", { embeddings: [[0.1, 0.2], "x"] }, "embedding_dimensions"],
    ["empty vectors", { embeddings: [[], []] }, "embedding_empty"],
    ["a null value", { embeddings: [[0.1, null], [0.1, 0.2]] }, "embedding_not_finite"],
    ["a string value", { embeddings: [[0.1, 0.2], [0.1, "0.2"]] }, "embedding_not_finite"]
  ])("fails with ai_failed on %s", async (_name, body, detail) => {
    await expect(ollamaEmbed(embedRuntime, spec, { numGpu: 0, ...fetchJson(body) })).rejects.toMatchObject({ code: "ai_failed", detail });
  });

  it("fails with ai_failed on a body that is not JSON", async () => {
    await expect(ollamaEmbed(embedRuntime, spec, { numGpu: 0, ...fetchReturning(new Response("<html>")) })).rejects.toMatchObject({
      code: "ai_failed",
      detail: "response_not_json"
    });
  });

  it("maps a refused connection, a missing model and a model that cannot embed to ollama_unavailable, other HTTP errors to ai_failed", async () => {
    const refused: FetchLike = async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    };
    await expect(ollamaEmbed(embedRuntime, spec, { numGpu: 0, fetch: refused })).rejects.toMatchObject({ code: "ollama_unavailable", detail: "connection_failed" });
    const notPulled = { error: "model \"embeddinggemma\" not found, try pulling it first" };
    await expect(ollamaEmbed(embedRuntime, spec, { numGpu: 0, ...fetchJson(notPulled, 404) })).rejects.toMatchObject({ code: "ollama_unavailable", detail: "ollama_http_404" });
    await expect(ollamaEmbed(embedRuntime, spec, { numGpu: 0, ...fetchJson(notPulled, 400) })).rejects.toMatchObject({ code: "ollama_unavailable", detail: "ollama_http_400" });
    await expect(ollamaEmbed(embedRuntime, spec, { numGpu: 0, ...fetchJson({ error: "This server does not support embeddings" }, 501) })).rejects.toMatchObject({
      code: "ollama_unavailable"
    });
    await expect(ollamaEmbed(embedRuntime, spec, { numGpu: 0, ...fetchJson({ error: "out of memory" }, 500) })).rejects.toMatchObject({ code: "ai_failed", detail: "ollama_http_500" });
    await expect(ollamaEmbed(embedRuntime, spec, { numGpu: 0, ...fetchJson({ error: "bad input" }, 400) })).rejects.toMatchObject({ code: "ai_failed", detail: "ollama_http_400" });
  });

  /** A fetch that answers only when its signal aborts, like a model that never finishes. */
  const hangingFetch: FetchLike = (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), { once: true });
    });

  it("aborts with ai_timeout at the deadline", async () => {
    vi.useFakeTimers();
    const assertion = expect(ollamaEmbed({ ...embedRuntime, timeoutMs: 60_000 }, spec, { numGpu: 0, fetch: hangingFetch })).rejects.toMatchObject({
      code: "ai_timeout",
      detail: "overall_timeout"
    });
    await vi.advanceTimersByTimeAsync(61_000);
    await assertion;
  });

  it("throws GenerationAbortedError when the caller aborts, also before the call", async () => {
    const controller = new AbortController();
    const pending = ollamaEmbed(embedRuntime, spec, { numGpu: 0, fetch: hangingFetch }, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toBeInstanceOf(GenerationAbortedError);
    const unused = fetchJson({ embeddings: [[1], [2]] });
    await expect(ollamaEmbed(embedRuntime, spec, { numGpu: 0, fetch: unused.fetch }, controller.signal)).rejects.toBeInstanceOf(GenerationAbortedError);
    expect(unused.calls).toHaveLength(0);
  });
});

describe("parseAssistantOutput", () => {
  it("returns the trimmed plain-text answer and is the check of the assistant_chat kind", () => {
    expect(parseAssistantOutput("\n  Bạn nên học **SQL** trước.  \n")).toEqual({ answer: "Bạn nên học **SQL** trước." });
    expect(parseJobOutput("assistant_chat", " {\"not\": \"json-checked\"} ")).toEqual({ answer: "{\"not\": \"json-checked\"}" });
  });

  it("rejects an empty or blank answer as invalid_ai_output", () => {
    for (const content of ["", "   ", "\n\t "]) {
      expect(() => parseJobOutput("assistant_chat", content)).toThrowError(expect.objectContaining({ code: "invalid_ai_output", detail: "answer" }));
    }
  });
});

describe("parseAiOutput", () => {
  it("accepts a well-shaped object", () => {
    expect(parseAiOutput(JSON.stringify(validOutput))).toMatchObject({ summary: validOutput.summary });
  });

  it.each([
    ["not json", "{\"summary\":"],
    ["array", "[]"],
    ["missing summary", JSON.stringify({ ...validOutput, summary: "" })],
    ["gaps not array", JSON.stringify({ ...validOutput, gaps: {} })],
    ["careerFit missing", JSON.stringify({ ...validOutput, careerFit: null })],
    ["nextSteps not strings", JSON.stringify({ ...validOutput, nextSteps: [1] })]
  ])("rejects %s as invalid_ai_output", (_name, content) => {
    expect(() => parseAiOutput(content)).toThrowError(AiWorkerError);
    expect(() => parseAiOutput(content)).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
  });
});

describe("parseCareerSuggestionOutput", () => {
  const career = {
    suggestions: [{ skillKey: "S001", priority: "required", title: "Viết truy vấn SQL", description: "Mô tả", reason: "Lý do" }],
    newSkills: []
  };

  it("accepts an object with suggestions and newSkills arrays, also when both are empty", () => {
    expect(parseCareerSuggestionOutput(JSON.stringify(career))).toEqual(career);
    expect(parseCareerSuggestionOutput(JSON.stringify({ suggestions: [], newSkills: [] }))).toEqual({ suggestions: [], newSkills: [] });
  });

  it.each([
    ["not json", "{\"suggestions\":"],
    ["array", "[]"],
    ["missing newSkills", JSON.stringify({ suggestions: [] })],
    ["suggestions not array", JSON.stringify({ suggestions: {}, newSkills: [] })],
    ["item not an object", JSON.stringify({ suggestions: ["SQL"], newSkills: [] })]
  ])("rejects %s as invalid_ai_output", (_name, content) => {
    expect(() => parseCareerSuggestionOutput(content)).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
  });

  it("parseJobOutput runs the check of the job kind", () => {
    expect(parseJobOutput("career_skill_suggestion", JSON.stringify(career))).toEqual(career);
    expect(() => parseJobOutput("competency_assessment", JSON.stringify(career))).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
    expect(() => parseJobOutput("career_skill_suggestion", JSON.stringify(validOutput))).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
  });
});

describe("parseGraduationAdviceOutput", () => {
  const advice = {
    summary: "Bạn còn thiếu một số điều kiện.",
    advice: [{ focus: "G1", text: "Hãy học các học phần bắt buộc còn thiếu." }],
    nextSteps: ["Xem lịch mở lớp."]
  };

  it("accepts a summary, advice objects with a text and next steps (empty lists are left to the API)", () => {
    expect(parseGraduationAdviceOutput(JSON.stringify(advice))).toEqual(advice);
    expect(parseGraduationAdviceOutput(JSON.stringify({ ...advice, advice: [], nextSteps: [] }))).toMatchObject({ advice: [], nextSteps: [] });
  });

  it.each([
    ["not json", "{\"summary\":"],
    ["array", "[]"],
    ["blank summary", JSON.stringify({ ...advice, summary: "  " })],
    ["summary not a string", JSON.stringify({ ...advice, summary: 1 })],
    ["advice missing", JSON.stringify({ summary: advice.summary, nextSteps: advice.nextSteps })],
    ["advice item without text", JSON.stringify({ ...advice, advice: [{ focus: "G1" }] })],
    ["advice item not an object", JSON.stringify({ ...advice, advice: ["Học lại"] })],
    ["nextSteps not strings", JSON.stringify({ ...advice, nextSteps: [{ text: "x" }] })]
  ])("rejects %s as invalid_ai_output", (_name, content) => {
    expect(() => parseGraduationAdviceOutput(content)).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
  });

  it("is the check of the graduation_advice kind", () => {
    expect(parseJobOutput("graduation_advice", JSON.stringify(advice))).toEqual(advice);
    expect(() => parseJobOutput("graduation_advice", JSON.stringify(validOutput))).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
    expect(() => parseJobOutput("competency_assessment", JSON.stringify(advice))).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
  });
});

describe("getOllamaModelInfo", () => {
  const tagsFetch =
    (models: unknown[]): FetchLike =>
    async (url) =>
      url.endsWith("/api/version") ? Response.json({ version: "0.40.2" }) : Response.json({ models });

  it("reads the version and the digest of the configured model", async () => {
    const info = await getOllamaModelInfo(runtime, { fetch: tagsFetch([{ name: "other:1b", digest: "aaa" }, { name: "gemma4:e4b", model: "gemma4:e4b", digest: "dc35e8d9c606" }]) });
    expect(info).toEqual({ version: "0.40.2", digest: "dc35e8d9c606" });
  });

  it("fails when the model is missing or remote", async () => {
    await expect(getOllamaModelInfo(runtime, { fetch: tagsFetch([]) })).rejects.toMatchObject({ code: "ollama_unavailable", detail: "model_missing" });
    await expect(getOllamaModelInfo(runtime, { fetch: tagsFetch([{ name: "gemma4:e4b", digest: "x", remote_host: "https://ollama.com" }]) })).rejects.toMatchObject({
      detail: "model_is_remote"
    });
  });
});

describe("parseCourseSuggestionOutput", () => {
  it("accepts links (with or without newSkills) or weights arrays of objects", () => {
    const links = { links: [{ skillKey: "S001", groupKey: "G1", reason: "x" }], newSkills: [] };
    const full = { links: [{ skillKey: "S001", groupKey: "G1", percent: 100, reason: "x" }] };
    const weights = { weights: [{ skillKey: "S001", percent: 100, reason: "x" }] };
    for (const output of [links, full, weights]) {
      expect(parseCourseSuggestionOutput(JSON.stringify(output))).toEqual(output);
      expect(parseJobOutput("competency_course_suggestion_v2", JSON.stringify(output))).toEqual(output);
    }
  });

  it("rejects anything else with invalid_ai_output", () => {
    for (const content of ["[]", "{}", JSON.stringify({ links: "x" }), JSON.stringify({ links: [1] }), JSON.stringify({ weights: [null] }),
      JSON.stringify({ links: [], newSkills: {} }), "not json"]) {
      expect(() => parseCourseSuggestionOutput(content)).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
    }
  });
});

describe("parseStudyRoadmapOutput", () => {
  const roadmap = { summary: "Tóm tắt.", study: [{ code: "A", advice: "x" }], improve: [], skills: [], months: [{ month: "1", focus: "x", tasks: ["y"] }] };

  it("accepts a summary and four arrays of objects, and is the check of the study_roadmap kind", () => {
    expect(parseStudyRoadmapOutput(JSON.stringify(roadmap))).toEqual(roadmap);
    expect(parseJobOutput("study_roadmap", JSON.stringify(roadmap))).toEqual(roadmap);
    expect(() => parseJobOutput("graduation_advice", JSON.stringify(roadmap))).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
  });

  it("rejects anything else with invalid_ai_output", () => {
    for (const content of ["[]", "{}", JSON.stringify({ ...roadmap, summary: " " }), JSON.stringify({ ...roadmap, months: "x" }),
      JSON.stringify({ ...roadmap, skills: [null] }), JSON.stringify({ ...roadmap, study: undefined }), "not json"]) {
      expect(() => parseStudyRoadmapOutput(content)).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
    }
  });
});
