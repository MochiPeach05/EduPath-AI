import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";

// The HTTP layer of /api/student/assistant; the conversation storage (chat.ts) is mocked. Synthetic ids only.
vi.mock("./chat.js", async (importActual) => {
  const actual = await importActual<typeof import("./chat.js")>();
  return {
    ...actual,
    askQuestion: vi.fn(), listThreads: vi.fn(), readThread: vi.fn(), readMessage: vi.fn(), setFeedback: vi.fn(),
    deleteThread: vi.fn(), retryAnswer: vi.fn(), createAssistantExpiry: () => async () => false,
  };
});
vi.mock("./wakeup.js", () => ({ notifyAssistantWork: vi.fn() }));
const chat = await import("./chat.js");
const { notifyAssistantWork } = await import("./wakeup.js");
const { createAssistantRouter } = await import("./router.js");

const studentId = "11111111-1111-4111-8111-111111111111";
const threadId = "55555555-5555-4555-8555-555555555555";
const answerId = "66666666-6666-4666-8666-666666666666";
const origin = "https://edupath.example";
const student = {
  userId: studentId, identityKey: `t:${studentId}`, tenantId: "t", objectId: studentId, name: "Student", email: null, username: null,
  role: "student", signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;
const thread = { id: threadId, title: "Mình còn thiếu kỹ năng nào?", createdAt: new Date("2026-10-28T01:00:00Z"), updatedAt: new Date("2026-10-28T01:00:00Z") };
const message = (extra: Partial<import("./chat.js").MessageRow> = {}): import("./chat.js").MessageRow => ({
  id: answerId, threadId, role: "assistant", content: "", status: "queued", errorCode: null, sources: [], feedback: null,
  createdAt: new Date("2026-10-28T01:00:00Z"), completedAt: null, ...extra,
});

function setup(options: { enabled?: boolean; worker?: { online: boolean; kinds: string[] } | null; user?: AuthenticatedUser | null } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: studentId }] };
    if (sql.includes("stu_comp_ai_worker_status")) return { rowCount: 1, rows: options.worker === null ? [] : [options.worker ?? { online: true, kinds: ["assistant_chat"] }] };
    return { rowCount: 0, rows: [] };
  });
  const client = { query: vi.fn(async () => ({ rowCount: 0, rows: [] })), release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: options.user === null ? undefined : options.user ?? student } as typeof req.session; next(); });
  app.use("/assistant", createAssistantRouter(pool, origin, { enabled: options.enabled ?? true }));
  return { app, client };
}

afterEach(() => vi.clearAllMocks());

describe("assistant student API", () => {
  it("needs a signed-in student and the web origin for writes", async () => {
    await request(setup({ user: null }).app).get("/assistant/threads").expect(401);
    await request(setup().app).post("/assistant/threads").send({ content: "Xin chào" }).expect(403);
  });

  it("lists conversations with the worker state of the assistant kind", async () => {
    vi.mocked(chat.listThreads).mockResolvedValue([thread]);
    const online = await request(setup().app).get("/assistant/threads").expect(200);
    expect(online.body).toEqual({ threads: [{ id: threadId, title: thread.title, createdAt: "2026-10-28T01:00:00.000Z", updatedAt: "2026-10-28T01:00:00.000Z" }], workerOnline: true });
    const old = await request(setup({ worker: { online: true, kinds: ["study_roadmap"] } }).app).get("/assistant/threads").expect(200);
    expect(old.body.workerOnline).toBe(false);
  });

  it("queues a question, then wakes the worker", async () => {
    vi.mocked(chat.askQuestion).mockResolvedValue({ thread, messages: [message({ id: "77777777-7777-4777-8777-777777777777", role: "user", content: "Hỏi", status: "completed" }), message()] });
    const { app, client } = setup();
    const response = await request(app).post("/assistant/threads").set("origin", origin).send({ content: "Hỏi" }).expect(201);
    expect(response.body.messages.map((item: { role: string; status: string }) => `${item.role}:${item.status}`)).toEqual(["user:completed", "assistant:queued"]);
    expect(vi.mocked(chat.askQuestion).mock.calls[0]?.[2]).toEqual({ threadId: null, content: "Hỏi" });
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(notifyAssistantWork).toHaveBeenCalledOnce();
  });

  it("maps refusals to their status codes and never queues without the AI worker key", async () => {
    vi.mocked(chat.askQuestion).mockRejectedValue(new chat.AssistantError("answer_pending", 409));
    const refused = await request(setup().app).post(`/assistant/threads/${threadId}/messages`).set("origin", origin).send({ content: "Hỏi" }).expect(409);
    expect(refused.body).toEqual({ error: "answer_pending" });
    expect(notifyAssistantWork).not.toHaveBeenCalled();
    const disabled = await request(setup({ enabled: false }).app).post("/assistant/threads").set("origin", origin).send({ content: "Hỏi" }).expect(409);
    expect(disabled.body).toEqual({ error: "ai_disabled" });
    await request(setup().app).get("/assistant/threads/not-a-uuid").expect(400);
    await request(setup().app).post("/assistant/threads").set("origin", origin).send({ content: "Hỏi", extra: 1 }).expect(400);
  });

  it("shows sources only on completed answers and records feedback", async () => {
    const sources = [{ n: 2, kind: "course" as const, title: "Học phần 71ITSE30103 Lập trình Web", link: "#curriculum" }];
    vi.mocked(chat.readMessage).mockResolvedValue(message({ status: "processing", content: "Bạn nên", sources }));
    const writing = await request(setup().app).get(`/assistant/messages/${answerId}`).expect(200);
    expect(writing.body.message).toMatchObject({ status: "processing", content: "Bạn nên", sources: [] });
    vi.mocked(chat.setFeedback).mockResolvedValue(message({ status: "completed", content: "Xong [2]", sources, feedback: 1 }));
    const rated = await request(setup().app).post(`/assistant/messages/${answerId}/feedback`).set("origin", origin).send({ value: 1 }).expect(200);
    expect(rated.body.message).toMatchObject({ feedback: 1, sources });
    await request(setup().app).post(`/assistant/messages/${answerId}/feedback`).set("origin", origin).send({ value: 2 }).expect(400);
  });

  it("deletes a conversation and retries a failed answer", async () => {
    await request(setup().app).delete(`/assistant/threads/${threadId}`).set("origin", origin).expect(204);
    expect(chat.deleteThread).toHaveBeenCalledWith(expect.anything(), studentId, threadId);
    vi.mocked(chat.retryAnswer).mockResolvedValue(message());
    const retried = await request(setup().app).post(`/assistant/messages/${answerId}/retry`).set("origin", origin).send({}).expect(200);
    expect(retried.body.message.status).toBe("queued");
    expect(notifyAssistantWork).toHaveBeenCalledOnce();
  });
});
