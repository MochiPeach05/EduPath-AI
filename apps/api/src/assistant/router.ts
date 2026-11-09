// Student API of Trợ lý AI, mounted at /api/student/assistant (contract: apps/web/src/assistant-types.ts). No consent
// header: an answer reads results the student already agreed to (assessment, roadmap; the survey only under its consent)
// and the conversation is the student's own, deleted with "Xóa cuộc trò chuyện" or after 90 days without a message.
import { Router, type ErrorRequestHandler, type Request } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { WORKER_ONLINE_SECONDS } from "../competency-assessment/ai/queue.js";
import { ASSISTANT_CHAT_KIND } from "../competency-assessment/ai/worker-protocol.js";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { actingAdvisor, studentUser } from "../advisors/access.js";
import {
  AssistantError, askQuestion, createAssistantExpiry, deleteThread, listThreads, presentMessage, presentThread, readMessage, readThread,
  retryAnswer, setFeedback,
} from "./chat.js";
import { MAX_QUESTION_CHARS } from "./protocol.js";
import { readReadiness, suggestedQuestions } from "./readiness.js";
import { MAX_SEARCH_CHARS, searchThreads } from "./thread-search.js";
import { notifyAssistantWork } from "./wakeup.js";

type AssistantRouterOptions = {
  /** AI_WORKER_KEY is configured; otherwise no question is queued. */
  enabled: boolean;
};

const id = z.guid();
/** The cố vấn học tập asking in the student's account (advisors/access.ts): they see only the conversations they started. */
const advisorOf = (req: Request) => actingAdvisor(req)?.userId ?? null;
const emptyObject = z.object({}).strict();
/** The page checks the length too; the server counts characters again after trimming (askQuestion). */
const questionBody = z.object({ content: z.string().max(MAX_QUESTION_CHARS * 4) }).strict();
const feedbackBody = z.object({ value: z.union([z.literal(1), z.literal(-1), z.null()]) }).strict();
/** GET /search?q=: Tìm cuộc trò chuyện (thread-search.ts); a longer search is cut to MAX_SEARCH_CHARS there. */
const searchQuery = z.object({ q: z.string().max(MAX_SEARCH_CHARS * 4) }).strict();

async function inTransaction<T>(pool: DatabasePool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createAssistantRouter(pool: DatabasePool | undefined, webOrigin: string, options: AssistantRouterOptions) {
  const router = Router();
  const { enabled } = options;
  // Stuck answers also expire while the worker is offline (once per 60 s); a failed expiry never breaks a read.
  const expire = createAssistantExpiry();
  const expireQuietly = () => expire(pool!).catch(() => false);
  const workerOnline = async () => {
    if (!enabled) return false;
    const row = (await pool!.query<{ online: boolean; kinds: string[] | null }>(
      "SELECT seen_at>now()-make_interval(secs => $1) AS online,kinds FROM stu_comp_ai_worker_status WHERE id=1", [WORKER_ONLINE_SECONDS])).rows[0];
    return row?.online === true && (row.kinds ?? []).includes(ASSISTANT_CHAT_KIND);
  };

  router.use(requireAuthentication);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    const user = studentUser(req);
    const active = await pool.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active", [user.userId, user.tenantId]);
    if (!active.rowCount) { res.status(403).json({ error: "account_unavailable" }); return; }
    next();
  });

  router.get("/threads", async (req, res) => {
    emptyObject.parse(req.query);
    await expireQuietly();
    const userId = studentUser(req).userId;
    const threads = await listThreads(pool!, userId, advisorOf(req));
    // The questions shown above the input: setting up first (import the transcript…), then the student's own results.
    const suggestions = suggestedQuestions(await readReadiness(pool!, userId));
    res.json({ threads: threads.map(presentThread), workerOnline: await workerOnline(), suggestions });
  });

  router.get("/search", async (req, res) => {
    const { q } = searchQuery.parse(req.query);
    const found = await searchThreads(pool!, studentUser(req).userId, q.trim(), advisorOf(req));
    res.json({ results: found.map(({ thread, snippet }) => ({ thread: presentThread(thread), snippet })) });
  });

  /** A question answered at once (readiness.ts) leaves nothing for the worker. */
  const wakeWorker = (messages: { status: string }[]) => { if (messages.some((message) => message.status === "queued")) notifyAssistantWork(); };

  router.post("/threads", async (req, res) => {
    const body = questionBody.parse(req.body ?? {});
    if (!enabled) { res.status(409).json({ error: "ai_disabled" }); return; }
    const asked = await inTransaction(pool!, (client) => askQuestion(client, studentUser(req).userId, { threadId: null, content: body.content, createdBy: advisorOf(req) }));
    wakeWorker(asked.messages);
    res.status(201).json({ thread: presentThread(asked.thread), messages: asked.messages.map(presentMessage) });
  });

  router.get("/threads/:id", async (req, res) => {
    const found = await readThread(pool!, studentUser(req).userId, id.parse(req.params.id), advisorOf(req));
    res.json({ thread: presentThread(found.thread), messages: found.messages.map(presentMessage) });
  });

  router.post("/threads/:id/messages", async (req, res) => {
    const threadId = id.parse(req.params.id);
    const body = questionBody.parse(req.body ?? {});
    if (!enabled) { res.status(409).json({ error: "ai_disabled" }); return; }
    const asked = await inTransaction(pool!, (client) => askQuestion(client, studentUser(req).userId, { threadId, content: body.content, createdBy: advisorOf(req) }));
    wakeWorker(asked.messages);
    res.status(201).json({ thread: presentThread(asked.thread), messages: asked.messages.map(presentMessage) });
  });

  router.delete("/threads/:id", async (req, res) => {
    await deleteThread(pool!, studentUser(req).userId, id.parse(req.params.id));
    res.status(204).end();
  });

  // Polled about once a second while an answer is queued or being written.
  router.get("/messages/:id", async (req, res) => {
    await expireQuietly();
    res.json({ message: presentMessage(await readMessage(pool!, studentUser(req).userId, id.parse(req.params.id), advisorOf(req))) });
  });

  router.post("/messages/:id/feedback", async (req, res) => {
    const body = feedbackBody.parse(req.body ?? {});
    res.json({ message: presentMessage(await setFeedback(pool!, studentUser(req).userId, id.parse(req.params.id), body.value, advisorOf(req))) });
  });

  router.post("/messages/:id/retry", async (req, res) => {
    emptyObject.parse(req.body ?? {});
    if (!enabled) { res.status(409).json({ error: "ai_disabled" }); return; }
    const message = await inTransaction(pool!, (client) => retryAnswer(client, studentUser(req).userId, id.parse(req.params.id), advisorOf(req)));
    notifyAssistantWork();
    res.json({ message: presentMessage(message) });
  });

  router.use((_req, res) => { res.status(404).json({ error: "not_found" }); });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AssistantError) { res.status(error.status).json({ error: error.code }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
