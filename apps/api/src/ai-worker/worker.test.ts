import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreparedPrompt } from "../assistant/protocol.js";
import { WorkerApiError, type ClaimedJob, type CompleteBody, type WorkerClient } from "./client.js";
import { AiWorkerError, GenerationAbortedError, type OllamaChatResult, type OllamaJob } from "./ollama.js";
import { processJob, runWorker, type OllamaPort, type WorkerDeps } from "./worker.js";

const job: ClaimedJob = {
  kind: "competency_assessment",
  id: "11111111-1111-4111-8111-111111111111",
  leaseToken: "lease-1",
  promptVersion: "comp-v1",
  system: "BÍ MẬT HỆ THỐNG",
  user: "BÍ MẬT DỮ LIỆU",
  schema: { type: "object" },
  options: { num_ctx: 16384 }
};
const info = { version: "0.40.2", digest: "dc35e8d9c606" };
const validOutput = {
  summary: "Tóm tắt",
  groupInsights: [],
  strengths: [],
  improvements: [],
  careerFit: { comment: "Nhận xét" },
  gaps: [],
  progress: "Tiến độ",
  nextSteps: ["a", "b", "c"]
};
const ok = (content: string): OllamaChatResult => ({ content, doneReason: "stop", metrics: { prompt_eval_count: 10, eval_count: 20 } });
/** The prompt /prepare returns for a question of Trợ lý AI. */
const prompt: PreparedPrompt = {
  system: "BÍ MẬT HỆ THỐNG",
  user: "BÍ MẬT NGỮ CẢNH",
  options: { num_ctx: 8192, num_predict: 1024, temperature: 0.3 },
  think: false,
  promptVersion: "assistant-v1"
};
const embedInfo = { version: "0.40.2", digest: "85462619ee72" };

function fakeClient(overrides: Partial<WorkerClient> = {}) {
  const completions: { id: string; body: CompleteBody }[] = [];
  const client: WorkerClient = {
    heartbeat: vi.fn(async () => undefined),
    claim: vi.fn(async () => null),
    extend: vi.fn(async () => ({ leaseUntil: "2026-10-11T00:00:00Z" })),
    prepare: vi.fn(async () => prompt),
    progress: vi.fn(async () => undefined),
    complete: vi.fn(async (id: string, body: CompleteBody) => {
      completions.push({ id, body });
    }),
    ...overrides
  };
  return { client, completions };
}

function deps(client: WorkerClient, chat: OllamaPort["chat"], logs: string[] = [], ollama: Partial<OllamaPort> = {}): WorkerDeps {
  return {
    client,
    ollama: { chat, modelInfo: async () => info, embed: vi.fn(async () => [[0.1, -0.2, 0.3]]), embeddingModelInfo: vi.fn(async () => embedInfo), ...ollama },
    log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    model: "gemma4:e4b",
    timings: { errorBackoffMs: 1, idlePollMs: 1, heartbeatMs: 20_000, extendEveryMs: 180_000, completeRetries: 2 }
  };
}

const events = (logs: string[]) => logs.map((line) => JSON.parse(line) as Record<string, unknown>);

afterEach(() => {
  vi.useRealTimers();
});

describe("processJob retry policy", () => {
  it("retries once after unparseable JSON and completes with the output, model, digest and version", async () => {
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValueOnce(ok("{\"summary\":")).mockResolvedValueOnce(ok(JSON.stringify(validOutput)));
    const outcome = await processJob(job, info, deps(client, chat), new AbortController().signal);
    expect(outcome).toBe("completed");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(completions).toEqual([
      {
        id: job.id,
        body: { leaseToken: "lease-1", model: "gemma4:e4b", digest: "dc35e8d9c606", ollamaVersion: "0.40.2", metrics: { prompt_eval_count: 10, eval_count: 20 }, output: validOutput }
      }
    ]);
  });

  it("reports invalid_ai_output after the second bad answer", async () => {
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok("không phải JSON"));
    expect(await processJob(job, info, deps(client, chat), new AbortController().signal)).toBe("failed");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(completions[0]?.body).toEqual({ leaseToken: "lease-1", error: "invalid_ai_output" });
  });

  it.each(["ai_output_truncated", "ai_timeout", "ollama_unavailable", "ai_failed"] as const)("does not retry %s", async (code) => {
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockRejectedValue(new AiWorkerError(code));
    expect(await processJob(job, info, deps(client, chat), new AbortController().signal)).toBe("failed");
    expect(chat).toHaveBeenCalledTimes(1);
    expect(completions[0]?.body).toEqual({ leaseToken: "lease-1", error: code });
  });

  it("maps unexpected errors to ai_failed and never logs the prompt or output", async () => {
    const logs: string[] = [];
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockRejectedValue(new Error("BÍ MẬT DỮ LIỆU"));
    await processJob(job, info, deps(client, chat, logs), new AbortController().signal);
    expect(completions[0]?.body).toEqual({ leaseToken: "lease-1", error: "ai_failed" });
    expect(logs.join("\n")).not.toContain("BÍ MẬT");
  });

  it("retries complete on server errors but gives up on 409 job_expired", async () => {
    const complete = vi.fn<WorkerClient["complete"]>().mockRejectedValueOnce(new WorkerApiError(503, "database_required")).mockResolvedValueOnce(undefined);
    const { client } = fakeClient({ complete });
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(validOutput)));
    expect(await processJob(job, info, deps(client, chat), new AbortController().signal)).toBe("completed");
    expect(complete).toHaveBeenCalledTimes(2);

    const expired = vi.fn<WorkerClient["complete"]>().mockRejectedValue(new WorkerApiError(409, "job_expired"));
    const second = fakeClient({ complete: expired });
    expect(await processJob(job, info, deps(second.client, chat), new AbortController().signal)).toBe("abandoned");
    expect(expired).toHaveBeenCalledTimes(1);
  });
});

describe("processJob lease handling", () => {
  function slowChat(): OllamaPort["chat"] {
    return (_job: OllamaJob, signal: AbortSignal) =>
      new Promise<OllamaChatResult>((resolve, reject) => {
        const timer = setTimeout(() => resolve(ok(JSON.stringify(validOutput))), 400_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new GenerationAbortedError());
        });
      });
  }

  it("extends the lease about every 3 minutes while generating", async () => {
    vi.useFakeTimers();
    const { client, completions } = fakeClient();
    const pending = processJob(job, info, deps(client, slowChat()), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(400_000);
    expect(await pending).toBe("completed");
    expect(client.extend).toHaveBeenCalledTimes(2);
    expect(client.extend).toHaveBeenCalledWith(job.id, "lease-1");
    expect(completions).toHaveLength(1);
  });

  it("abandons the job without completing when the lease is lost", async () => {
    vi.useFakeTimers();
    const { client, completions } = fakeClient({ extend: vi.fn(async () => Promise.reject(new WorkerApiError(409, "job_expired"))) });
    const pending = processJob(job, info, deps(client, slowChat()), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(181_000);
    expect(await pending).toBe("abandoned");
    expect(completions).toHaveLength(0);
  });

  it("abandons the job when the worker shuts down", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client, completions } = fakeClient();
    const pending = processJob(job, info, deps(client, slowChat()), controller.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    expect(await pending).toBe("abandoned");
    expect(completions).toHaveLength(0);
  });
});

describe("runWorker", () => {
  it("claims, processes a job, polls when idle and stops on abort", async () => {
    const controller = new AbortController();
    let claims = 0;
    const { client, completions } = fakeClient({
      claim: vi.fn(async () => {
        claims += 1;
        if (claims === 3) controller.abort();
        return claims === 1 ? job : null;
      })
    });
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(validOutput)));
    await runWorker(deps(client, chat), controller.signal);
    expect(completions).toHaveLength(1);
    expect(claims).toBe(3);
  });

  it("does not claim while Ollama is unavailable", async () => {
    const controller = new AbortController();
    const { client } = fakeClient();
    let checks = 0;
    const d = deps(client, vi.fn());
    d.ollama.modelInfo = async () => {
      checks += 1;
      if (checks === 3) controller.abort();
      throw new AiWorkerError("ollama_unavailable");
    };
    await runWorker(d, controller.signal);
    expect(client.claim).not.toHaveBeenCalled();
  });

  it("sends a heartbeat every 20 s while Ollama is reachable", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client } = fakeClient();
    const d = deps(client, vi.fn());
    d.timings = { ...d.timings, idlePollMs: 5_000 };
    const running = runWorker(d, controller.signal);
    await vi.advanceTimersByTimeAsync(61_000);
    controller.abort();
    await running;
    expect(client.heartbeat).toHaveBeenCalledTimes(3);
    expect((client.claim as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(12);
  });

  it("claims again 1 s after an empty claim by default, since the server already held it", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client } = fakeClient();
    const d = deps(client, vi.fn());
    d.timings = { heartbeatMs: 20_000, errorBackoffMs: 15_000, extendEveryMs: 180_000, completeRetries: 2 };
    const running = runWorker(d, controller.signal);
    await vi.advanceTimersByTimeAsync(10_500);
    controller.abort();
    await running;
    // t = 0, 1, …, 10 s
    expect(client.claim).toHaveBeenCalledTimes(11);
  });
});

describe("processJob job kinds", () => {
  const careerJob: ClaimedJob = { ...job, kind: "career_skill_suggestion", promptVersion: "career-skill-v1" };
  const careerOutput = {
    suggestions: [{ skillKey: "S001", priority: "required", title: "Viết truy vấn SQL", description: "Mô tả", reason: "Lý do" }],
    newSkills: []
  };

  it("checks a career job with the career shape and logs the kind without any prompt or output text", async () => {
    const logs: string[] = [];
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(careerOutput)));
    expect(await processJob(careerJob, info, deps(client, chat, logs), new AbortController().signal)).toBe("completed");
    expect(completions[0]?.body).toMatchObject({ leaseToken: "lease-1", output: careerOutput });
    const events = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const name of ["job_claimed", "generation_finished", "job_finished"]) {
      expect(events.find((event) => event.event === name)).toMatchObject({ kind: "career_skill_suggestion" });
    }
    expect(logs.join("\n")).not.toMatch(/BÍ MẬT|Viết truy vấn/);
  });

  it("retries once and fails a career job that returned the competency shape", async () => {
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(validOutput)));
    expect(await processJob(careerJob, info, deps(client, chat), new AbortController().signal)).toBe("failed");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(completions[0]?.body).toEqual({ leaseToken: "lease-1", error: "invalid_ai_output" });
  });

  it("checks a graduation advice job with its own shape and retries a job that returned another shape", async () => {
    const adviceJob: ClaimedJob = { ...job, kind: "graduation_advice", promptVersion: "grad-advice-v1" };
    const adviceOutput = { summary: "Tóm tắt", advice: [{ focus: "G1", text: "Lời khuyên" }], nextSteps: ["Việc cần làm"] };
    const logs: string[] = [];
    const done = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValueOnce(ok(JSON.stringify(validOutput))).mockResolvedValueOnce(ok(JSON.stringify(adviceOutput)));
    expect(await processJob(adviceJob, info, deps(done.client, chat, logs), new AbortController().signal)).toBe("completed");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(done.completions[0]?.body).toMatchObject({ leaseToken: "lease-1", output: adviceOutput });
    expect(logs.map((line) => JSON.parse(line) as Record<string, unknown>).find((event) => event.event === "job_finished")).toMatchObject({ kind: "graduation_advice" });
    expect(logs.join("\n")).not.toMatch(/BÍ MẬT|Lời khuyên/);
  });

  it("treats a job without kind as a competency assessment", async () => {
    const logs: string[] = [];
    const { client } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(validOutput)));
    // A test double or an older server: no kind at all.
    const { kind: _kind, ...withoutKind } = job;
    expect(await processJob(withoutKind as unknown as ClaimedJob, info, deps(client, chat, logs), new AbortController().signal)).toBe("completed");
    expect(JSON.parse(logs[0]!)).toMatchObject({ event: "job_claimed", kind: "competency_assessment" });
    expect(client.prepare).not.toHaveBeenCalled();
  });
});

describe("processJob assistant_chat", () => {
  const question: ClaimedJob = {
    kind: "assistant_chat",
    id: "33333333-3333-4333-8333-333333333333",
    leaseToken: "lease-2",
    promptVersion: "assistant-v1",
    embed: { model: "embeddinggemma", inputs: ["task: search result | query: BÍ MẬT CÂU HỎI"] }
  };
  const parts = ["Bạn ", "nên ", "học ", "Cơ sở ", "dữ liệu ", "trước."];
  const answer = parts.join("");
  const completed = (metrics: Record<string, unknown>) => ({
    leaseToken: "lease-2", model: "gemma4:e4b", digest: info.digest, ollamaVersion: info.version, metrics, output: { answer }
  });
  /** Gemma writing the answer: one more piece every 300 ms, each reported through onContent. */
  const streamingChat = () =>
    vi.fn<OllamaPort["chat"]>(async (_job, _signal, onContent) => {
      let text = "";
      for (const part of parts) {
        text += part;
        onContent?.(text);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return ok(text);
    });

  it("embeds the question, gets the prompt, streams the answer to /progress at most every 700 ms and completes with it", async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const sent: { at: number; content: string }[] = [];
    const progress = vi.fn<WorkerClient["progress"]>(async (_id, body) => {
      sent.push({ at: Date.now(), content: body.content });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const { client, completions } = fakeClient({ progress });
    const chat = streamingChat();
    const d = deps(client, chat, logs);
    const pending = processJob(question, info, d, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toBe("completed");

    expect(d.ollama.embeddingModelInfo).toHaveBeenCalledWith("embeddinggemma");
    expect(d.ollama.embed).toHaveBeenCalledWith({ model: "embeddinggemma", inputs: ["task: search result | query: BÍ MẬT CÂU HỎI"] }, expect.any(AbortSignal));
    expect(client.prepare).toHaveBeenCalledWith(question.id, { leaseToken: "lease-2", vector: [0.1, -0.2, 0.3], standalone: null });
    // Plain text: no schema, the prompt's own options and thinking flag.
    expect(chat).toHaveBeenCalledWith(
      { system: prompt.system, user: prompt.user, schema: null, options: prompt.options, think: false },
      expect.any(AbortSignal),
      expect.any(Function)
    );
    // The first piece at once, then the newest text at most every 700 ms; the end of the answer only goes in /complete.
    expect(sent.map((item) => item.content)).toEqual(["Bạn ", "Bạn nên học ", "Bạn nên học Cơ sở dữ liệu "]);
    for (let i = 1; i < sent.length; i++) expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(700);
    for (const [id, body] of progress.mock.calls) expect([id, body.leaseToken]).toEqual([question.id, "lease-2"]);
    expect(completions).toEqual([{ id: question.id, body: completed({ prompt_eval_count: 10, eval_count: 20, embed_ms: expect.any(Number) }) }]);
    expect(events(logs).find((event) => event.event === "embedding_finished")).toMatchObject({ job: question.id, kind: "assistant_chat", dimensions: 3 });
    expect(events(logs).find((event) => event.event === "job_finished")).toMatchObject({ kind: "assistant_chat", outcome: "completed" });
    expect(logs.join("\n")).not.toMatch(/BÍ MẬT|Bạn nên|Cơ sở/);
  });

  it("never posts two progress updates at once and sends /complete only once the post in flight has settled", async () => {
    vi.useFakeTimers();
    let open = 0;
    let maxOpen = 0;
    let openAtComplete = -1;
    const progress = vi.fn<WorkerClient["progress"]>(async () => {
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      open -= 1;
    });
    const complete = vi.fn<WorkerClient["complete"]>(async () => {
      openAtComplete = open;
    });
    const { client } = fakeClient({ progress, complete });
    const started = Date.now();
    const pending = processJob(question, info, deps(client, streamingChat()), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toBe("completed");
    expect(maxOpen).toBe(1);
    // t = 0 s, then t = 1 s when the first post settled (newest text); the chat ends at 1.8 s, the second post at 2 s.
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls[1]?.[1].content).toBe("Bạn nên học Cơ sở ");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(openAtComplete).toBe(0);
    expect(complete.mock.invocationCallOrder[0]).toBeGreaterThan(progress.mock.invocationCallOrder[1]!);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_000);
  });

  it("keeps writing when /progress fails, and logs only the first failure", async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const progress = vi.fn<WorkerClient["progress"]>(() => Promise.reject(new WorkerApiError(409, "job_expired")));
    const { client, completions } = fakeClient({ progress });
    const pending = processJob(question, info, deps(client, streamingChat(), logs), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toBe("completed");
    expect(progress.mock.calls.length).toBeGreaterThan(1);
    expect(completions[0]?.body).toMatchObject({ output: { answer } });
    expect(events(logs).filter((event) => event.event === "progress_failed")).toEqual([
      { event: "progress_failed", job: question.id, error: "worker_api", status: 409, code: "job_expired" }
    ]);
  });

  it("goes on without a vector when the embedding model is missing, cannot embed or returns an unusable vector", async () => {
    const cases: Partial<OllamaPort>[] = [
      { embeddingModelInfo: vi.fn(() => Promise.reject(new AiWorkerError("ollama_unavailable", "model_missing"))) },
      { embed: vi.fn(() => Promise.reject(new AiWorkerError("ollama_unavailable", "ollama_http_501"))) },
      { embed: vi.fn(() => Promise.reject(new Error("BÍ MẬT CÂU HỎI"))) },
      { embed: vi.fn(async () => [[]]) }
    ];
    for (const ollama of cases) {
      const logs: string[] = [];
      const { client, completions } = fakeClient();
      const d = deps(client, vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(answer)), logs, ollama);
      expect(await processJob(question, info, d, new AbortController().signal)).toBe("completed");
      // A missing model never receives the question.
      if (ollama.embeddingModelInfo) expect(d.ollama.embed).not.toHaveBeenCalled();
      expect(client.prepare).toHaveBeenCalledWith(question.id, { leaseToken: "lease-2", vector: null, standalone: null });
      expect(completions).toEqual([{ id: question.id, body: completed({ prompt_eval_count: 10, eval_count: 20 }) }]);
      expect(events(logs).filter((event) => event.event === "embedding_failed")).toEqual([expect.objectContaining({ job: question.id, kind: "assistant_chat" })]);
      expect(logs.join("\n")).not.toMatch(/BÍ MẬT|Bạn nên/);
    }
  });

  it("asks for the prompt without a vector when the job brings no embedding", async () => {
    const { client } = fakeClient();
    const d = deps(client, vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(answer)));
    expect(await processJob({ ...question, embed: null }, info, d, new AbortController().signal)).toBe("completed");
    expect(d.ollama.embed).not.toHaveBeenCalled();
    expect(d.ollama.embeddingModelInfo).not.toHaveBeenCalled();
    expect(client.prepare).toHaveBeenCalledWith(question.id, { leaseToken: "lease-2", vector: null, standalone: null });
  });

  it("writes a follow-up out in full first, embeds that and sends it as standalone (assistant-v3)", async () => {
    const logs: string[] = [];
    const { client, completions } = fakeClient();
    const rewrite = { system: "VIẾT LẠI", user: "HỘI THOẠI BÍ MẬT", options: { num_ctx: 16384, num_predict: 160, temperature: 0 } };
    const chat = vi.fn<OllamaPort["chat"]>()
      .mockResolvedValueOnce(ok("Câu hỏi viết lại: Mình nên học Cơ sở dữ liệu hay Kiểm thử trước?\nGiải thích thừa"))
      .mockResolvedValueOnce(ok(answer));
    const d = deps(client, chat, logs);
    expect(await processJob({ ...question, rewrite }, info, d, new AbortController().signal)).toBe("completed");
    expect(chat.mock.calls[0]?.[0]).toEqual({ system: "VIẾT LẠI", user: "HỘI THOẠI BÍ MẬT", schema: null, options: rewrite.options, think: false });
    expect(d.ollama.embed).toHaveBeenCalledWith(
      { model: "embeddinggemma", inputs: ["task: search result | query: Mình nên học Cơ sở dữ liệu hay Kiểm thử trước?"] }, expect.any(AbortSignal));
    expect(client.prepare).toHaveBeenCalledWith(question.id,
      { leaseToken: "lease-2", vector: [0.1, -0.2, 0.3], standalone: "Mình nên học Cơ sở dữ liệu hay Kiểm thử trước?" });
    expect(completions[0]?.body).toMatchObject({ metrics: { rewrite_ms: expect.any(Number) } });
    expect(logs.join("\n")).not.toMatch(/BÍ MẬT|Cơ sở dữ liệu/);
  });

  it("keeps the server's own text when the rewrite fails or says nothing usable", async () => {
    const outcomes = [() => Promise.reject(new AiWorkerError("ai_timeout", "overall_timeout")), () => Promise.resolve(ok("  \n"))];
    for (const outcome of outcomes) {
      const { client } = fakeClient();
      const chat = vi.fn<OllamaPort["chat"]>().mockImplementationOnce(outcome).mockResolvedValueOnce(ok(answer));
      const d = deps(client, chat);
      expect(await processJob({ ...question, rewrite: { system: "s", user: "u", options: {} } }, info, d, new AbortController().signal)).toBe("completed");
      expect(d.ollama.embed).toHaveBeenCalledWith(question.embed, expect.any(AbortSignal));
      expect(client.prepare).toHaveBeenCalledWith(question.id, { leaseToken: "lease-2", vector: [0.1, -0.2, 0.3], standalone: null });
    }
  });

  it.each([409, 404])("abandons the question without answering when /prepare answers %i", async (status) => {
    const logs: string[] = [];
    const { client, completions } = fakeClient({ prepare: vi.fn(() => Promise.reject(new WorkerApiError(status, "job_expired"))) });
    const chat = vi.fn<OllamaPort["chat"]>();
    expect(await processJob(question, info, deps(client, chat, logs), new AbortController().signal)).toBe("abandoned");
    expect(chat).not.toHaveBeenCalled();
    expect(completions).toHaveLength(0);
    expect(events(logs).find((event) => event.event === "job_abandoned")).toEqual({ event: "job_abandoned", job: question.id, leaseLost: true });
  });

  it("fails the question with ai_failed when /prepare fails otherwise", async () => {
    for (const error of [new WorkerApiError(503, "database_required"), new WorkerApiError(200, "invalid_prepare_response"), new TypeError("fetch failed")]) {
      const { client, completions } = fakeClient({ prepare: vi.fn(() => Promise.reject(error)) });
      const chat = vi.fn<OllamaPort["chat"]>();
      expect(await processJob(question, info, deps(client, chat), new AbortController().signal)).toBe("failed");
      expect(chat).not.toHaveBeenCalled();
      expect(completions).toEqual([{ id: question.id, body: { leaseToken: "lease-2", error: "ai_failed" } }]);
    }
  });

  it("retries once after an empty answer, then reports invalid_ai_output", async () => {
    const first = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValueOnce(ok("  \n")).mockResolvedValueOnce(ok(`\n${answer}\n`));
    expect(await processJob(question, info, deps(first.client, chat), new AbortController().signal)).toBe("completed");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(first.client.prepare).toHaveBeenCalledTimes(1);
    expect(first.completions[0]?.body).toMatchObject({ output: { answer } });

    const second = fakeClient();
    const empty = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(""));
    expect(await processJob(question, info, deps(second.client, empty), new AbortController().signal)).toBe("failed");
    expect(empty).toHaveBeenCalledTimes(2);
    expect(second.completions).toEqual([{ id: question.id, body: { leaseToken: "lease-2", error: "invalid_ai_output" } }]);
  });

  it("does not retry a truncated answer", async () => {
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockRejectedValue(new AiWorkerError("ai_output_truncated", "done_reason_length"));
    expect(await processJob(question, info, deps(client, chat), new AbortController().signal)).toBe("failed");
    expect(chat).toHaveBeenCalledTimes(1);
    expect(completions[0]?.body).toEqual({ leaseToken: "lease-2", error: "ai_output_truncated" });
  });

  it("abandons the answer on shutdown without waiting for a /progress post", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client, completions } = fakeClient({ progress: vi.fn(() => new Promise<void>(() => undefined)) });
    const chat: OllamaPort["chat"] = (_job, signal, onContent) =>
      new Promise((_resolve, reject) => {
        onContent?.("Bạn ");
        signal.addEventListener("abort", () => reject(new GenerationAbortedError()));
      });
    const pending = processJob(question, info, deps(client, chat), controller.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    expect(await pending).toBe("abandoned");
    expect(client.progress).toHaveBeenCalledTimes(1);
    expect(completions).toHaveLength(0);
  });
});

describe("processJob knowledge_embedding", () => {
  const batch: ClaimedJob = {
    kind: "knowledge_embedding",
    id: "55555555-5555-4555-8555-555555555555",
    leaseToken: "lease-3",
    promptVersion: "knowledge-v1",
    embed: { model: "embeddinggemma", inputs: ["title: BÍ MẬT A | text: x", "title: BÍ MẬT B | text: y"] }
  };

  it("embeds the batch and completes with the vectors, the embedding model, its digest and the timing", async () => {
    const logs: string[] = [];
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>();
    const embed = vi.fn<OllamaPort["embed"]>(async () => [[0.1, 0.2], [0.3, -0.4]]);
    const d = deps(client, chat, logs, { embed });
    expect(await processJob(batch, info, d, new AbortController().signal)).toBe("completed");
    expect(d.ollama.embeddingModelInfo).toHaveBeenCalledWith("embeddinggemma");
    expect(embed).toHaveBeenCalledWith({ model: "embeddinggemma", inputs: ["title: BÍ MẬT A | text: x", "title: BÍ MẬT B | text: y"] }, expect.any(AbortSignal));
    expect(chat).not.toHaveBeenCalled();
    expect(client.prepare).not.toHaveBeenCalled();
    expect(client.progress).not.toHaveBeenCalled();
    expect(completions).toEqual([{
      id: batch.id,
      body: {
        leaseToken: "lease-3",
        model: "embeddinggemma",
        digest: embedInfo.digest,
        ollamaVersion: embedInfo.version,
        metrics: { embed_ms: expect.any(Number), count: 2 },
        output: { vectors: [[0.1, 0.2], [0.3, -0.4]] }
      }
    }]);
    expect(events(logs).find((event) => event.event === "embedding_finished")).toMatchObject({ job: batch.id, kind: "knowledge_embedding", count: 2, dimensions: 2 });
    expect(events(logs).find((event) => event.event === "job_finished")).toMatchObject({ kind: "knowledge_embedding", outcome: "completed" });
    expect(logs.join("\n")).not.toContain("BÍ MẬT");
  });

  it("reports the error code of a failed embedding, without retrying", async () => {
    const cases: [Partial<OllamaPort>, string][] = [
      [{ embeddingModelInfo: vi.fn(() => Promise.reject(new AiWorkerError("ollama_unavailable", "model_missing"))) }, "ollama_unavailable"],
      [{ embed: vi.fn(() => Promise.reject(new AiWorkerError("ollama_unavailable", "ollama_http_404"))) }, "ollama_unavailable"],
      [{ embed: vi.fn(() => Promise.reject(new AiWorkerError("ai_timeout", "overall_timeout"))) }, "ai_timeout"],
      [{ embed: vi.fn(async () => [[0.1, 0.2]]) }, "invalid_ai_output"],
      [{ embed: vi.fn(() => Promise.reject(new Error("BÍ MẬT A"))) }, "ai_failed"]
    ];
    for (const [ollama, code] of cases) {
      const logs: string[] = [];
      const { client, completions } = fakeClient();
      const d = deps(client, vi.fn(), logs, ollama);
      expect(await processJob(batch, info, d, new AbortController().signal)).toBe("failed");
      expect(completions).toEqual([{ id: batch.id, body: { leaseToken: "lease-3", error: code } }]);
      expect(d.ollama.embed).toHaveBeenCalledTimes(ollama.embeddingModelInfo ? 0 : 1);
      expect(logs.join("\n")).not.toContain("BÍ MẬT");
    }
  });

  it("abandons the batch when the worker shuts down", async () => {
    const controller = new AbortController();
    const { client, completions } = fakeClient();
    const embed: OllamaPort["embed"] = (_spec, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new GenerationAbortedError())));
    const pending = processJob(batch, info, deps(client, vi.fn(), [], { embed }), controller.signal);
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toBe("abandoned");
    expect(completions).toHaveLength(0);
  });
});
