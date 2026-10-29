// Student API of Trợ lý AI, mounted at /api/student/assistant (contract: apps/web/src/assistant-types.ts). No consent
// header: an answer reads results the student already agreed to (assessment, roadmap; the survey only under its consent)
// and the conversation is the student's own, deleted with "Xóa cuộc trò chuyện" or after 90 days without a message.
import { Router, type ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { WORKER_ONLINE_SECONDS } from "../competency-assessment/ai/queue.js";
import { ASSISTANT_CHAT_KIND } from "../competency-assessment/ai/worker-protocol.js";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import {
  AssistantError, askQuestion, createAssistantExpiry, deleteThread, listThreads, presentMessage, presentThread, readMessage, readThread,
  retryAnswer, setFeedback,
} from "./chat.js";
import { MAX_QUESTION_CHARS } from "./protocol.js";
import { readReadiness, suggestedQuestions } from "./readiness.js";
import { notifyAssistantWork } from "./wakeup.js";

type AssistantRouterOptions = {
  /** AI_WORKER_KEY is configured; otherwise no question is queued. */
  enabled: boolean;
};

const id = z.guid();
const emptyObject = z.object({}).strict();
/** The page checks the length too; the server counts characters again after trimming (askQuestion). */
const questionBody = z.object({ content: z.string().max(MAX_QUESTION_CHARS * 4) }).strict();
const feedbackBody = z.object({ value: z.union([z.literal(1), z.literal(-1), z.null()]) }).strict();

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
    const user = req.session.user!;
    const active = await pool.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active", [user.userId, user.tenantId]);
    if (!active.rowCount) { res.status(403).json({ error: "account_unavailable" }); return; }
    next();
  });

  router.get("/threads", async (req, res) => {
    emptyObject.parse(req.query);
    await expireQuietly();
    const userId = req.session.user!.userId;
    const threads = await listThreads(pool!, userId);
    // The questions shown above the input: setting up first (import the transcript…), then the student's own results.
    const suggestions = suggestedQuestions(await readReadiness(pool!, userId));
    res.json({ threads: threads.map(presentThread), workerOnline: await workerOnline(), suggestions });
  });

  /** A question answered at once (readiness.ts) leaves nothing for the worker. */
  const wakeWorker = (messages: { status: string }[]) => { if (messages.some((message) => message.status === "queued")) notifyAssistantWork(); };

  router.post("/threads", async (req, res) => {
    const body = questionBody.parse(req.body ?? {});
    if (!enabled) { res.status(409).json({ error: "ai_disabled" }); return; }
    const asked = await inTransaction(pool!, (client) => askQuestion(client, req.session.user!.userId, { threadId: null, content: body.content }));
    wakeWorker(asked.messages);
    res.status(201).json({ thread: presentThread(asked.thread), messages: asked.messages.map(presentMessage) });
  });

  router.get("/threads/:id", async (req, res) => {
    const found = await readThread(pool!, req.session.user!.userId, id.parse(req.params.id));
    res.json({ thread: presentThread(found.thread), messages: found.messages.map(presentMessage) });
  });

  router.post("/threads/:id/messages", async (req, res) => {
    const threadId = id.parse(req.params.id);
    const body = questionBody.parse(req.body ?? {});
    if (!enabled) { res.status(409).json({ error: "ai_disabled" }); return; }
    const asked = await inTransaction(pool!, (client) => askQuestion(client, req.session.user!.userId, { threadId, content: body.content }));
    wakeWorker(asked.messages);
    res.status(201).json({ thread: presentThread(asked.thread), messages: asked.messages.map(presentMessage) });
  });

  router.delete("/threads/:id", async (req, res) => {
    await deleteThread(pool!, req.session.user!.userId, id.parse(req.params.id));
    res.status(204).end();
  });

  // Polled about once a second while an answer is queued or being written.
  router.get("/messages/:id", async (req, res) => {
    await expireQuietly();
    res.json({ message: presentMessage(await readMessage(pool!, req.session.user!.userId, id.parse(req.params.id))) });
  });

  router.post("/messages/:id/feedback", async (req, res) => {
    const body = feedbackBody.parse(req.body ?? {});
    res.json({ message: presentMessage(await setFeedback(pool!, req.session.user!.userId, id.parse(req.params.id), body.value)) });
  });

  router.post("/messages/:id/retry", async (req, res) => {
    emptyObject.parse(req.body ?? {});
    if (!enabled) { res.status(409).json({ error: "ai_disabled" }); return; }
    const message = await inTransaction(pool!, (client) => retryAnswer(client, req.session.user!.userId, id.parse(req.params.id)));
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
