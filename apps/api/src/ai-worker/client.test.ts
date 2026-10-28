import { describe, expect, it } from "vitest";
import { WorkerApiError, createWorkerClient } from "./client.js";
import type { FetchLike } from "./ollama.js";

const key = "w".repeat(48);
const claimed = {
  id: "11111111-1111-4111-8111-111111111111",
  leaseToken: "22222222-2222-4222-8222-222222222222",
  promptVersion: "comp-v1",
  system: "s",
  user: "u",
  schema: { type: "object" },
  options: { num_ctx: 16384, num_predict: 4096 }
};

function recorder(response: () => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, fetch };
}

describe("createWorkerClient", () => {
  it("posts with the bearer key, refuses redirects and parses a claimed job", async () => {
    const { calls, fetch } = recorder(() => Response.json({ job: claimed }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch });
    // A server released before career suggestions sends no kind: the job is a competency assessment.
    expect(await client.claim()).toEqual({ ...claimed, kind: "competency_assessment" });
    expect(calls[0]?.url).toBe("http://localhost:4000/api/worker/competency-assessments/claim");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${key}`);
  });

  it("keeps the thinking flag of a course proposal", async () => {
    const course = { ...claimed, kind: "competency_course_suggestion_v2", think: true };
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => Response.json({ job: course })).fetch });
    expect(await client.claim()).toEqual(course);
    const bad = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => Response.json({ job: { ...course, think: "yes" } })).fetch });
    await expect(bad.claim()).rejects.toMatchObject({ code: "invalid_claim_response" });
  });

  it("returns null when no job is queued and sends complete/extend to the job path", async () => {
    const { calls, fetch } = recorder(() => Response.json({ job: null, leaseUntil: "2026-10-11T10:00:00Z", ok: true }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch });
    expect(await client.claim()).toBeNull();
    expect(await client.extend(claimed.id, claimed.leaseToken)).toEqual({ leaseUntil: "2026-10-11T10:00:00Z" });
    await client.complete(claimed.id, { leaseToken: claimed.leaseToken, error: "ai_timeout" });
    expect(calls[1]?.url).toContain(`/${claimed.id}/extend`);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ leaseToken: claimed.leaseToken, error: "ai_timeout" });
  });

  it("rejects redirects, oversized responses, malformed jobs and surfaces API error codes", async () => {
    const redirect = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => new Response(null, { status: 302, headers: { location: "https://evil.example" } })).fetch });
    await expect(redirect.heartbeat()).rejects.toMatchObject({ code: "redirect_refused" });

    const big = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, maxResponseBytes: 100, fetch: recorder(() => new Response("x".repeat(500))).fetch });
    await expect(big.claim()).rejects.toMatchObject({ code: "response_too_large" });

    const malformed = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => Response.json({ job: { ...claimed, id: "../admin" } })).fetch });
    await expect(malformed.claim()).rejects.toMatchObject({ code: "invalid_claim_response" });

    const expired = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => Response.json({ error: "job_expired" }, { status: 409 })).fetch });
    const error = await expired.extend(claimed.id, "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkerApiError);
    expect(error).toMatchObject({ status: 409, code: "job_expired" });
  });
});

describe("job kinds", () => {
  const allKinds = [
    "competency_assessment", "career_skill_suggestion", "graduation_advice", "competency_course_suggestion_v2", "study_roadmap",
    "assistant_chat", "knowledge_embedding"
  ];

  it("advertises every supported kind on heartbeat and claim, asks the server to wait on claim and reads the job kind", async () => {
    const { calls, fetch } = recorder(() => Response.json({ job: { ...claimed, kind: "career_skill_suggestion" } }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch });
    await client.heartbeat();
    expect((await client.claim())?.kind).toBe("career_skill_suggestion");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ kinds: allKinds });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ kinds: allKinds, wait: true });
  });

  it("reads a graduation advice job", async () => {
    const { fetch } = recorder(() => Response.json({ job: { ...claimed, kind: "graduation_advice", promptVersion: "grad-advice-v1" } }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch });
    expect(await client.claim()).toEqual({ ...claimed, kind: "graduation_advice", promptVersion: "grad-advice-v1" });
  });

  it("can advertise fewer kinds and rejects a kind it does not know", async () => {
    const { calls, fetch } = recorder(() => Response.json({ job: { ...claimed, kind: "something_new" } }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch, kinds: ["competency_assessment"] });
    await expect(client.claim()).rejects.toMatchObject({ code: "invalid_claim_response" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ kinds: ["competency_assessment"], wait: true });
  });
});

describe("Trợ lý AI jobs", () => {
  const question = {
    kind: "assistant_chat",
    id: "33333333-3333-4333-8333-333333333333",
    leaseToken: "44444444-4444-4444-8444-444444444444",
    promptVersion: "assistant-v1",
    embed: { model: "embeddinggemma", inputs: ["task: search result | query: Học phần nào cần học trước?"] }
  };
  const batch = {
    kind: "knowledge_embedding",
    id: "55555555-5555-4555-8555-555555555555",
    leaseToken: "66666666-6666-4666-8666-666666666666",
    promptVersion: "knowledge-v1",
    embed: { model: "embeddinggemma", inputs: ["title: A | text: x", "title: B | text: y"] }
  };
  const prompt = { system: "s", user: "u", options: { num_ctx: 8192, temperature: 0.3 }, think: false, promptVersion: "assistant-v1" };
  const claimOf = (job: unknown) => createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => Response.json({ job })).fetch });

  it("reads a claimed question (with or without an embedding to make) and a knowledge batch, which carry no prompt", async () => {
    expect(await claimOf(question).claim()).toEqual(question);
    expect(await claimOf({ ...question, embed: null }).claim()).toEqual({ ...question, embed: null });
    expect(await claimOf(batch).claim()).toEqual(batch);
  });

  it.each<[string, unknown]>([
    ["a generation job without its prompt", { ...claimed, kind: "graduation_advice", system: undefined }],
    ["a question with a cloud embedding model", { ...question, embed: { model: "embeddinggemma-cloud", inputs: ["x"] } }],
    ["a question without the embed field", { ...question, embed: undefined }],
    ["a knowledge batch without texts", { ...batch, embed: null }],
    ["a knowledge batch with an empty text", { ...batch, embed: { model: "embeddinggemma", inputs: [""] } }],
    ["a question with a bad id", { ...question, id: "../admin" }]
  ])("rejects %s", async (_name, job) => {
    await expect(claimOf(job).claim()).rejects.toMatchObject({ status: 200, code: "invalid_claim_response" });
  });

  it("prepare posts the lease and the vector (or null) and returns the prompt", async () => {
    const { calls, fetch } = recorder(() => Response.json({ ...prompt, extra: "dropped" }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch });
    expect(await client.prepare(question.id, { leaseToken: question.leaseToken, vector: [0.1, -0.2] })).toEqual(prompt);
    await client.prepare(question.id, { leaseToken: question.leaseToken, vector: null });
    expect(calls[0]?.url).toBe(`http://localhost:4000/api/worker/competency-assessments/${question.id}/prepare`);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ leaseToken: question.leaseToken, vector: [0.1, -0.2] });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ leaseToken: question.leaseToken, vector: null });
  });

  it("prepare rejects a malformed prompt and surfaces 409 job_expired", async () => {
    for (const body of [{ ...prompt, system: "" }, { ...prompt, think: "no" }, { job: prompt }]) {
      const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => Response.json(body)).fetch });
      const error = await client.prepare(question.id, { leaseToken: question.leaseToken, vector: null }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorkerApiError);
      expect(error).toMatchObject({ status: 200, code: "invalid_prepare_response" });
    }
    const expired = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => Response.json({ error: "job_expired" }, { status: 409 })).fetch });
    await expect(expired.prepare(question.id, { leaseToken: question.leaseToken, vector: null })).rejects.toMatchObject({ status: 409, code: "job_expired" });
  });

  it("progress posts the lease and the answer so far to the job path", async () => {
    const { calls, fetch } = recorder(() => Response.json({ ok: true }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch });
    await client.progress(question.id, { leaseToken: question.leaseToken, content: "Bạn nên học" });
    expect(calls[0]?.url).toBe(`http://localhost:4000/api/worker/competency-assessments/${question.id}/progress`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ leaseToken: question.leaseToken, content: "Bạn nên học" });
  });
});
