// Conversations of Trợ lý AI (STU-CHAT-01..05, 2026-10-28). A question is stored with an assistant message that is also
// the AI worker job (kind "assistant_chat", handed out by /api/worker/competency-assessments): queued with the text to
// embed, prepared when the worker asks (the student's own data + the knowledge search → the prompt), streamed while
// Gemma writes (/progress), checked and stored on /complete (validate.ts). One answer at a time per student; a
// conversation without a new message for 90 days is deleted.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { AI_HOUSEKEEPING_INTERVAL_MS, AI_JOB_MAX_ATTEMPTS, ASSISTANT_CHAT_KIND, type WorkerCompletion } from "../competency-assessment/ai/worker-protocol.js";
import type { DatabasePool } from "../db/pool.js";
import type { SpecialtyCode } from "../competency-assessment/types.js";
import { resolveStudentStandard } from "../graduation/resolve.js";
import { studentSources, type AssistantSourceKind, type ContextSource } from "./facts.js";
import { detectIntents, isFollowUp, type AssistantIntent } from "./intent.js";
import { buildAssistantPrompt, buildRewritePrompt, HISTORY_MESSAGES, numberSources, type AssistantPrompt, type HistoryMessage } from "./prompt.js";
import { z } from "zod";
import {
  ASSISTANT_LEASE_MINUTES, ASSISTANT_PROMPT_VERSION, EMBEDDING_MODEL, MAX_QUESTION_CHARS, queryEmbeddingText, standaloneQuestion,
  type EmbedSpec, type RewriteSpec,
} from "./protocol.js";
import { resourceKey } from "./knowledge.js";
import { READINESS_ANSWER_VERSION, readinessAnswer, readReadiness } from "./readiness.js";
import { loadKnowledgeIndex } from "./search.js";
import { addressesIn, checkAnswer, codesIn, type AnswerContext } from "./validate.js";
import { classCodeSql } from "../advisors/class-code.js";

type Db = Pick<DatabasePool, "query">;

/** New questions are refused while this many answers of OTHER students are queued or being written. */
const MAX_PENDING_ANSWERS = 30;
/** At most one question per student in this many seconds, and this many per hour. */
const MIN_SECONDS_BETWEEN_QUESTIONS = 3;
const MAX_QUESTIONS_PER_HOUR = 60;
const RETENTION_DAYS = 90;
const THREAD_TITLE_MAX = 80;
const MAX_THREADS_LISTED = 50;
/** Knowledge chunks per answer, and self-study resource chunks added for the skills still to build. */
const KNOWLEDGE_RESULTS = 6;
const RESOURCE_RESULTS = 2;
/** Self-study resource lists the general search may bring: they share their common words ("tài liệu", "tự học"). */
const GENERAL_RESOURCE_RESULTS = 2;
const OWN_STANDARD_RESULTS = 2;
/**
 * The conversation carries over (assistant-v3): the intents of the answers of the last CARRIED_TURNS questions join the
 * new ones, and up to CARRIED_SOURCES knowledge chunks those answers cited come back, so a vague follow-up keeps its data.
 */
const CARRIED_TURNS = 2;
const CARRIED_SOURCES = 3;

export class AssistantError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "AssistantError";
  }
}

/** ref (server only): the knowledge chunk of a cited source, brought back by the next questions of the conversation. */
export type AssistantSource = { n: number; kind: AssistantSourceKind; title: string; link: string | null; ref?: { kind: string; key: string } };
/**
 * createdBy: the admin-portal account that started it in the student's account (migration 058), null for the student;
 * createdByRole: "advisor" when that account advises the student's class, "admin" for a quản trị viên of the Khoa.
 */
export type ThreadRow = {
  id: string; title: string; createdAt: Date | string; updatedAt: Date | string; createdBy?: string | null; createdByRole?: "advisor" | "admin" | null;
};
export type MessageRow = {
  id: string; threadId: string; role: "user" | "assistant"; content: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled"; errorCode: string | null;
  sources: AssistantSource[]; feedback: 1 | -1 | null; createdAt: Date | string; completedAt: Date | string | null;
};
/** What ai_input holds: the question and the text to embed when queued, plus the prompt's sources once prepared. */
type AnswerInput = {
  promptVersion: string;
  questionId: string;
  retrievalText: string;
  embed: EmbedSpec | null;
  /** The prompt that writes a follow-up out in full (assistant-v3); null for the first question of a conversation. */
  rewrite?: RewriteSpec | null;
  prepared?: { sources: AssistantSource[]; allowedUrls: string[]; knownCodes: string[] };
};

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
export const presentThread = (row: ThreadRow) => ({
  id: row.id, title: row.title, createdAt: iso(row.createdAt)!, updatedAt: iso(row.updatedAt)!, byAdvisor: Boolean(row.createdBy),
  createdByRole: row.createdBy ? row.createdByRole ?? "advisor" : null,
});
export const presentMessage = (row: MessageRow) => ({
  id: row.id, threadId: row.threadId, role: row.role, content: row.content, status: row.status, errorCode: row.errorCode,
  sources: row.status === "completed" ? (row.sources ?? []).map(({ n, kind, title, link }) => ({ n, kind, title, link })) : [],
  feedback: row.feedback ?? null,
  createdAt: iso(row.createdAt)!, completedAt: iso(row.completedAt),
});

// Who started a thread: the advisor of the student's class, else a quản trị viên (the table is named, never aliased, in
// every statement that uses these columns: SELECT … FROM, INSERT/UPDATE … RETURNING).
const threadColumns = `id,title,created_at AS "createdAt",updated_at AS "updatedAt",created_by AS "createdBy",
  CASE WHEN stu_chat_threads.created_by IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM ad_advisor_classes ac JOIN student_profiles sp ON sp.user_id=stu_chat_threads.user_id JOIN users su ON su.id=sp.user_id
      WHERE ac.advisor_user_id=stu_chat_threads.created_by AND ac.class_name=${classCodeSql("sp", "su")}) THEN 'advisor'
    ELSE 'admin' END AS "createdByRole"`;
const messageColumns = `id,thread_id AS "threadId",role,content,status,error_code AS "errorCode",sources,feedback,
  created_at AS "createdAt",completed_at AS "completedAt"`;
/** Messages of a thread in order; a question and its answer are written in one statement each, the question first. */
const messageOrder = `created_at,CASE role WHEN 'user' THEN 0 ELSE 1 END,id`;

/* ------------------------------------------------------------------------ */
/* Student side. advisorId: a cố vấn học tập working in the student's page (advisors/access.ts) sees and continues only
   the conversations they started (created_by); null for the student, who sees them all. */

/** The thread condition of advisorId ($n): none for the student. */
const ownThread = (n: number) => `($${n}::uuid IS NULL OR created_by=$${n})`;
/** The message condition of advisorId ($n): its thread was started by that advisor. */
const ownMessage = (n: number) => `($${n}::uuid IS NULL OR thread_id IN (SELECT id FROM stu_chat_threads WHERE created_by=$${n}))`;

export async function listThreads(db: Db, userId: string, advisorId: string | null = null): Promise<ThreadRow[]> {
  const result = await db.query<ThreadRow>(
    `SELECT ${threadColumns} FROM stu_chat_threads WHERE user_id=$1 AND ${ownThread(3)} ORDER BY updated_at DESC,id DESC LIMIT $2`,
    [userId, MAX_THREADS_LISTED, advisorId]);
  return result.rows;
}

export async function readThread(db: Db, userId: string, threadId: string, advisorId: string | null = null): Promise<{ thread: ThreadRow; messages: MessageRow[] }> {
  const thread = (await db.query<ThreadRow>(`SELECT ${threadColumns} FROM stu_chat_threads WHERE id=$1 AND user_id=$2 AND ${ownThread(3)}`,
    [threadId, userId, advisorId])).rows[0];
  if (!thread) throw new AssistantError("thread_not_found", 404);
  const messages = await db.query<MessageRow>(`SELECT ${messageColumns} FROM stu_chat_messages WHERE thread_id=$1 ORDER BY ${messageOrder}`, [threadId]);
  return { thread, messages: messages.rows };
}

export async function readMessage(db: Db, userId: string, messageId: string, advisorId: string | null = null): Promise<MessageRow> {
  const row = (await db.query<MessageRow>(`SELECT ${messageColumns} FROM stu_chat_messages WHERE id=$1 AND user_id=$2 AND ${ownMessage(3)}`,
    [messageId, userId, advisorId])).rows[0];
  if (!row) throw new AssistantError("message_not_found", 404);
  return row;
}

export async function deleteThread(db: Db, userId: string, threadId: string): Promise<void> {
  const result = await db.query("DELETE FROM stu_chat_threads WHERE id=$1 AND user_id=$2", [threadId, userId]);
  if (!result.rowCount) throw new AssistantError("thread_not_found", 404);
}

export async function setFeedback(db: Db, userId: string, messageId: string, value: 1 | -1 | null, advisorId: string | null = null): Promise<MessageRow> {
  const result = await db.query<MessageRow>(
    `UPDATE stu_chat_messages SET feedback=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND role='assistant' AND status='completed'
      AND ${ownMessage(4)} RETURNING ${messageColumns}`, [messageId, userId, value, advisorId]);
  if (!result.rows[0]) throw new AssistantError("message_not_found", 404);
  return result.rows[0];
}

/** The text searched for a question: a short follow-up goes with the previous question of the conversation. */
function retrievalText(question: string, previousQuestion: string | null): string {
  return previousQuestion && isFollowUp(question) ? `${previousQuestion}\n${question}` : question;
}

/** The messages of a conversation a prompt repeats: questions, and answers that were written (oldest first). */
async function conversation(db: Pick<PoolClient, "query">, threadId: string): Promise<(HistoryMessage & { id: string })[]> {
  const rows = (await db.query<{ id: string; role: "user" | "assistant"; content: string; status: string }>(
    `SELECT id,role,content,status FROM stu_chat_messages WHERE thread_id=$1 ORDER BY ${messageOrder}`, [threadId])).rows;
  return rows.filter((message) => message.content.trim() && (message.role === "user" || message.status === "completed"))
    .map((message) => ({ id: message.id, role: message.role, content: message.content }));
}

/** history: the conversation before the question; a question after others is written out in full first (rewrite). */
function answerInput(questionId: string, question: string, history: readonly HistoryMessage[]): AnswerInput {
  const previousQuestion = [...history].reverse().find((message) => message.role === "user")?.content ?? null;
  const text = retrievalText(question, previousQuestion);
  return {
    promptVersion: ASSISTANT_PROMPT_VERSION, questionId, retrievalText: text,
    embed: { model: EMBEDDING_MODEL, inputs: [queryEmbeddingText(text.slice(0, 2000))] },
    rewrite: history.length ? buildRewritePrompt(history, question) : null,
  };
}

/**
 * A question (POST /threads, POST /threads/:id/messages), inside the caller's transaction: the student's row first
 * (FOR KEY SHARE), then a per-student lock. Refused: an empty or long question (400), a thread of someone else (404), an
 * answer still pending for the student (409 answer_pending), questions too close or too many (429 too_frequent), a full
 * queue (429 queue_full). The caller wakes the worker after COMMIT (notifyAssistantWork). A question about the student's
 * own results that their data cannot answer yet (readiness.ts) gets its answer at once, "completed", without a job.
 * createdBy: the cố vấn học tập asking in the student's account; a new thread records them, an existing one must be theirs.
 */
export async function askQuestion(client: PoolClient, userId: string, input: { threadId: string | null; content: string; createdBy?: string | null }):
  Promise<{ thread: ThreadRow; messages: MessageRow[] }> {
  const question = input.content.replace(/\r\n?/g, "\n").trim();
  if (!question) throw new AssistantError("empty_message", 400);
  if (Array.from(question).length > MAX_QUESTION_CHARS) throw new AssistantError("message_too_long", 400);
  const user = await client.query("SELECT id FROM users WHERE id=$1 AND is_active FOR KEY SHARE", [userId]);
  if (!user.rowCount) throw new AssistantError("account_unavailable", 403);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`edupath:assistant:${userId}`]);

  let thread: ThreadRow | undefined;
  if (input.threadId) {
    thread = (await client.query<ThreadRow>(`SELECT ${threadColumns} FROM stu_chat_threads WHERE id=$1 AND user_id=$2 AND ${ownThread(3)} FOR UPDATE`,
      [input.threadId, userId, input.createdBy ?? null])).rows[0];
    if (!thread) throw new AssistantError("thread_not_found", 404);
  }
  const pending = await client.query("SELECT 1 FROM stu_chat_messages WHERE user_id=$1 AND status IN ('queued','processing') LIMIT 1", [userId]);
  if (pending.rowCount) throw new AssistantError("answer_pending", 409);
  const pace = await client.query<{ recent: boolean; hour: number }>(
    `SELECT coalesce(bool_or(created_at>now()-make_interval(secs => $2)),false) AS recent,count(*)::int AS hour
      FROM stu_chat_messages WHERE user_id=$1 AND role='user' AND created_at>now()-interval '1 hour'`, [userId, MIN_SECONDS_BETWEEN_QUESTIONS]);
  if (pace.rows[0]?.recent || (pace.rows[0]?.hour ?? 0) >= MAX_QUESTIONS_PER_HOUR) throw new AssistantError("too_frequent", 429);
  const others = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM stu_chat_messages WHERE status IN ('queued','processing') AND user_id<>$1", [userId]);
  if ((others.rows[0]?.count ?? 0) >= MAX_PENDING_ANSWERS) throw new AssistantError("queue_full", 429);

  if (!thread) {
    const title = question.replace(/\s+/g, " ");
    const short = Array.from(title).length > THREAD_TITLE_MAX ? `${Array.from(title).slice(0, THREAD_TITLE_MAX - 1).join("").trimEnd()}…` : title;
    thread = (await client.query<ThreadRow>(`INSERT INTO stu_chat_threads(id,user_id,title,created_by) VALUES($1,$2,$3,$4) RETURNING ${threadColumns}`,
      [randomUUID(), userId, short, input.createdBy ?? null])).rows[0]!;
  } else {
    thread = (await client.query<ThreadRow>(`UPDATE stu_chat_threads SET updated_at=now() WHERE id=$1 RETURNING ${threadColumns}`, [thread.id])).rows[0]!;
  }
  const history = await conversation(client, thread.id);
  const questionId = randomUUID();
  const asked = (await client.query<MessageRow>(
    `INSERT INTO stu_chat_messages(id,thread_id,user_id,role,content,status,created_at) VALUES($1,$2,$3,'user',$4,'completed',clock_timestamp())
      RETURNING ${messageColumns}`, [questionId, thread.id, userId, question])).rows[0]!;
  const intents = detectIntents(question);
  const fixed = readinessAnswer(await readReadiness(client, userId), intents, question);
  if (fixed) {
    const answer = (await client.query<MessageRow>(
      `INSERT INTO stu_chat_messages(id,thread_id,user_id,role,content,status,intents,sources,prompt_version,created_at,completed_at)
        VALUES($1,$2,$3,'assistant',$4,'completed',$5::text[],$6::jsonb,$7,clock_timestamp(),clock_timestamp()) RETURNING ${messageColumns}`,
      [randomUUID(), thread.id, userId, fixed.content, intents, JSON.stringify(fixed.sources), READINESS_ANSWER_VERSION])).rows[0]!;
    return { thread, messages: [asked, answer] };
  }
  const aiInput = answerInput(questionId, question, history);
  const answer = (await client.query<MessageRow>(
    `INSERT INTO stu_chat_messages(id,thread_id,user_id,role,status,ai_input,prompt_version,created_at)
      VALUES($1,$2,$3,'assistant','queued',$4::jsonb,$5,clock_timestamp()) RETURNING ${messageColumns}`,
    [randomUUID(), thread.id, userId, JSON.stringify(aiInput), aiInput.promptVersion])).rows[0]!;
  return { thread, messages: [asked, answer] };
}

/** "Thử lại" on a failed or cancelled answer that is still the last message of its conversation. */
export async function retryAnswer(client: PoolClient, userId: string, messageId: string, advisorId: string | null = null): Promise<MessageRow> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`edupath:assistant:${userId}`]);
  const row = (await client.query<{ threadId: string; status: string; last: boolean }>(
    `SELECT m.thread_id AS "threadId",m.status,NOT EXISTS (SELECT 1 FROM stu_chat_messages n WHERE n.thread_id=m.thread_id AND n.created_at>m.created_at) AS last
      FROM stu_chat_messages m WHERE m.id=$1 AND m.user_id=$2 AND m.role='assistant'
        AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM stu_chat_threads t WHERE t.id=m.thread_id AND t.created_by=$3)) FOR UPDATE`,
    [messageId, userId, advisorId])).rows[0];
  if (!row) throw new AssistantError("message_not_found", 404);
  if (!["failed", "cancelled"].includes(row.status) || !row.last) throw new AssistantError("not_failed", 409);
  const pending = await client.query("SELECT 1 FROM stu_chat_messages WHERE user_id=$1 AND status IN ('queued','processing') LIMIT 1", [userId]);
  if (pending.rowCount) throw new AssistantError("answer_pending", 409);
  const messages = await conversation(client, row.threadId);
  const at = messages.map((message) => message.role).lastIndexOf("user");
  const question = messages[at];
  if (!question) throw new AssistantError("not_failed", 409);
  const aiInput = answerInput(question.id, question.content, messages.slice(0, at));
  const updated = (await client.query<MessageRow>(
    `UPDATE stu_chat_messages SET status='queued',content='',error_code=NULL,sources='[]'::jsonb,warnings=NULL,feedback=NULL,attempts=0,
      lease_token=NULL,lease_until=NULL,ai_input=$2::jsonb,prompt_version=$3,completed_at=NULL,updated_at=now() WHERE id=$1 RETURNING ${messageColumns}`,
    [messageId, JSON.stringify(aiInput), aiInput.promptVersion])).rows[0]!;
  await client.query("UPDATE stu_chat_threads SET updated_at=now() WHERE id=$1", [row.threadId]);
  return updated;
}

/* ------------------------------------------------------------------------ */
/* Housekeeping */

/**
 * Fails stuck answers (queued for more than 24 hours, or processing with an expired lease after the last attempt) and
 * deletes conversations without a new message for RETENTION_DAYS.
 */
export async function expireAssistant(db: Db): Promise<void> {
  await db.query(`UPDATE stu_chat_messages SET status='failed',error_code='worker_timeout',ai_input=NULL,lease_token=NULL,lease_until=NULL,
      completed_at=now(),updated_at=now()
    WHERE (status='queued' AND created_at<now()-interval '24 hours')
      OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))`, [AI_JOB_MAX_ATTEMPTS]);
  await db.query("DELETE FROM stu_chat_threads WHERE updated_at<now()-make_interval(days => $1)", [RETENTION_DAYS]);
}

export function createAssistantExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Db): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireAssistant(db);
    return true;
  };
}

/* ------------------------------------------------------------------------ */
/* Worker side (called by competency-assessment/ai/worker-router.ts) */

type Claimed = { id: string; leaseToken: string; aiInput: AnswerInput };

/** Claims the oldest answer to write (SKIP LOCKED, ASSISTANT_LEASE_MINUTES lease, at most 2 attempts); a retry starts over. */
export async function claimAssistantAnswer(db: Db, leaseToken: string): Promise<Claimed | null> {
  const result = await db.query<Claimed>(`WITH candidate AS (
      SELECT id FROM stu_chat_messages
      WHERE role='assistant' AND ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE stu_chat_messages m SET status='processing',content='',lease_token=$1,lease_until=now()+make_interval(mins => $3),
      attempts=m.attempts+1,updated_at=now()
      FROM candidate c WHERE m.id=c.id RETURNING m.id,m.lease_token AS "leaseToken",m.ai_input AS "aiInput"`,
  [leaseToken, AI_JOB_MAX_ATTEMPTS, ASSISTANT_LEASE_MINUTES]);
  return result.rows[0] ?? null;
}

/** The claimed job as the worker reads it (assistantClaimSchema). */
export const assistantWorkerJob = (claimed: Claimed) => ({
  kind: ASSISTANT_CHAT_KIND, id: claimed.id, leaseToken: claimed.leaseToken,
  promptVersion: claimed.aiInput.promptVersion, embed: claimed.aiInput.embed ?? null, rewrite: claimed.aiInput.rewrite ?? null,
});

export async function extendAssistantAnswer(db: Db, id: string, leaseToken: string): Promise<Date | null> {
  const result = await db.query<{ leaseUntil: Date }>(
    `UPDATE stu_chat_messages SET lease_until=now()+make_interval(mins => $3),updated_at=now()
      WHERE id=$1 AND role='assistant' AND status='processing' AND lease_token=$2 AND lease_until>now() RETURNING lease_until AS "leaseUntil"`,
    [id, leaseToken, ASSISTANT_LEASE_MINUTES]);
  return result.rows[0]?.leaseUntil ?? null;
}

type LiveAnswer = { userId: string; threadId: string; aiInput: AnswerInput; status: string; valid: boolean; leaseToken: string | null };

async function liveAnswer(db: Db, id: string): Promise<LiveAnswer | null> {
  const row = (await db.query<LiveAnswer>(
    `SELECT user_id AS "userId",thread_id AS "threadId",ai_input AS "aiInput",status,lease_until>now() AS valid,lease_token AS "leaseToken"
      FROM stu_chat_messages WHERE id=$1 AND role='assistant'`, [id])).rows[0];
  return row ?? null;
}

/** The id of the graduation standard of the student's cohort, specialty and major (graduation/resolve.ts), or null. */
async function studentStandardId(db: Db, userId: string): Promise<string | null> {
  const profile = (await db.query<{ cohortCode: string | null; specialty: SpecialtyCode | null; majorCode: string | null }>(
    `SELECT cohort_code AS "cohortCode",specialty,major_code AS "majorCode" FROM student_profiles WHERE user_id=$1`, [userId])).rows[0];
  if (!profile) return null;
  return (await resolveStudentStandard(db, profile)).standard?.id ?? null;
}

const knowledgeKind = (kind: string): AssistantSourceKind =>
  (["course", "skill", "career", "curriculum", "plan", "graduation", "resource", "guide"] as const).find((item) => item === kind)
  ?? (kind === "field" ? "career" : "guide");

/**
 * /prepare: the prompt of a claimed answer. Reads the question and the conversation before it, the student's own data
 * (facts.ts) and the knowledge chunks the search finds with the worker's vector (null: by words only), numbers the
 * sources, keeps what the check needs in ai_input and returns the prompt. 'expired' for another or lost lease.
 */
export async function prepareAssistantAnswer(db: Db, id: string, leaseToken: string, vector: number[] | null, standaloneText: string | null = null,
  now: Date = new Date()): Promise<AssistantPrompt | "expired" | "missing"> {
  const answer = await liveAnswer(db, id);
  if (!answer) return "missing";
  if (answer.status !== "processing" || answer.leaseToken !== leaseToken || !answer.valid || !answer.aiInput) return "expired";
  const input = answer.aiInput;
  const thread = await db.query<{ id: string; role: "user" | "assistant"; content: string; status: string; intents: string[] | null; sources: AssistantSource[] | null }>(
    `SELECT id,role,content,status,intents,sources FROM stu_chat_messages WHERE thread_id=$1 ORDER BY ${messageOrder}`, [answer.threadId]);
  const at = thread.rows.findIndex((message) => message.id === input.questionId);
  const question = at >= 0 ? thread.rows[at]!.content : input.retrievalText;
  const before = thread.rows.slice(0, Math.max(0, at));
  const history: HistoryMessage[] = before
    .filter((message) => message.content.trim() && (message.role === "user" || message.status === "completed"))
    .slice(-HISTORY_MESSAGES).map((message) => ({ role: message.role, content: message.content }));
  // v3: the follow-up written out in full by the worker's rewrite searches instead of the question itself.
  const standalone = standaloneQuestion(standaloneText);
  const searched = standalone ?? input.retrievalText;
  const earlier = before.filter((message) => message.role === "assistant" && message.status === "completed").slice(-CARRIED_TURNS);

  const intents = [...new Set([...detectIntents(searched), ...earlier.flatMap((message) => message.intents ?? [])])] as AssistantIntent[];
  const student = await studentSources(db, answer.userId, standalone ? `${question}\n${standalone}` : question, intents, now);
  const index = await loadKnowledgeIndex(db, EMBEDDING_MODEL);
  // Graduation standards: only the student's own, as on the Điều kiện xét tốt nghiệp page (the index holds every one),
  // searched apart so other cohorts' standards never crowd out the rest; its parts come first for a graduation question.
  const ownStandard = await studentStandardId(db, answer.userId);
  const own = ownStandard === null ? [] : index.search({ text: searched, vector, k: 60, kinds: ["graduation"] })
    .filter((chunk) => chunk.sourceKey === ownStandard || chunk.sourceKey.startsWith(`${ownStandard}#`)).slice(0, OWN_STANDARD_RESULTS);
  let generalResources = 0;
  const general = index.search({ text: searched, vector, k: KNOWLEDGE_RESULTS, excludeKinds: ["graduation"] })
    .filter((chunk) => chunk.sourceKind !== "resource" || generalResources++ < GENERAL_RESOURCE_RESULTS);
  const found = intents.includes("graduation") ? [...own, ...general] : [...general, ...own];
  // The self-study resources of the skills still to build, looked up by the skill's own name and listed first (the
  // evaluation of 2026-10-29: a search mixing the question's common words brought other skills' lists).
  if (intents.includes("resources") || intents.includes("gaps")) {
    for (const skill of [...student.gapSkills.slice(0, RESOURCE_RESULTS)].reverse()) {
      const chunk = index.byKey("resource", resourceKey(skill));
      if (chunk && !found.some((item) => item.id === chunk.id)) found.unshift({ ...chunk, score: 0, via: [] });
    }
  }
  // The chunks the last answers cited come back (still in the index), after the new results.
  let carried = 0;
  for (const source of earlier.flatMap((message) => message.sources ?? []).reverse()) {
    if (carried >= CARRIED_SOURCES || !source.ref) continue;
    const chunk = index.byKey(source.ref.kind, source.ref.key);
    if (chunk && !found.some((item) => item.id === chunk.id)) { found.push({ ...chunk, score: 0, via: [] }); carried += 1; }
  }
  const knowledge: ContextSource[] = found.map((chunk) => ({
    kind: knowledgeKind(chunk.sourceKind), title: chunk.title, link: chunk.link, text: chunk.content, ref: { kind: chunk.sourceKind, key: chunk.sourceKey },
  }));
  const sources = numberSources([...student.sources, ...knowledge]);
  const prompt = buildAssistantPrompt({ sources, history, question, standalone });

  const texts = sources.map((source) => source.text).join("\n");
  const prepared = {
    sources: sources.map(({ n, kind, title, link, ref }) => ({ n, kind, title, link, ...(ref ? { ref } : {}) })),
    allowedUrls: addressesIn(texts),
    knownCodes: codesIn([texts, question, ...history.map((message) => message.content)].join("\n")),
  };
  const stored = await db.query(
    `UPDATE stu_chat_messages SET ai_input=ai_input||$3::jsonb,intents=$4::text[],updated_at=now()
      WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now()`,
    [id, leaseToken, JSON.stringify({ prepared }), intents]);
  return stored.rowCount ? prompt : "expired";
}

const answerContext = (input: AnswerInput | null): AnswerContext => ({
  sourceCount: input?.prepared?.sources.length ?? 0,
  allowedUrls: input?.prepared?.allowedUrls ?? [],
  knownCodes: input?.prepared?.knownCodes ?? [],
});

/** /progress: the answer so far, cleaned like the final one (links and citations), shown while Gemma writes. */
export async function progressAssistantAnswer(db: Db, id: string, leaseToken: string, content: string): Promise<"ok" | "expired" | "missing"> {
  const answer = await liveAnswer(db, id);
  if (!answer) return "missing";
  if (answer.status !== "processing" || answer.leaseToken !== leaseToken || !answer.valid) return "expired";
  const checked = checkAnswer(content, answerContext(answer.aiInput));
  const updated = await db.query(
    `UPDATE stu_chat_messages SET content=$3,updated_at=now() WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now()`,
    [id, leaseToken, checked.content]);
  return updated.rowCount ? "ok" : "expired";
}

type LockedAnswer = { status: string; lease_token: string | null; valid: boolean | null; ai_input: AnswerInput | null; thread_id: string };

/**
 * /complete inside the worker router's transaction: 'missing' when no answer has this id, 'expired' for another or lost
 * lease, 'ok' when stored (or already stored under the same lease). The answer is checked (validate.ts) and keeps the
 * sources it cites; a failure keeps the error code and no text. ai_input is cleared either way.
 */
export async function completeAssistantAnswer(client: PoolClient, id: string, input: WorkerCompletion): Promise<"ok" | "expired" | "missing"> {
  const locked = await client.query<LockedAnswer>(
    `SELECT status,lease_token,lease_until>now() AS valid,ai_input,thread_id FROM stu_chat_messages WHERE id=$1 AND role='assistant' FOR UPDATE`, [id]);
  const job = locked.rows[0];
  if (!job) return "missing";
  if ((job.status === "completed" || job.status === "failed") && job.lease_token === input.leaseToken) return "ok";
  if (job.status !== "processing" || job.lease_token !== input.leaseToken || job.valid !== true) return "expired";

  let errorCode: string | null = "error" in input ? input.error : null;
  let content = "";
  let sources: AssistantSource[] = [];
  let warnings: string[] | null = null;
  if (!("error" in input)) {
    // Any text: an answer longer than MAX_ANSWER_CHARS is shortened by the check, not refused.
    const parsed = z.object({ answer: z.string() }).safeParse(input.output);
    const prepared = job.ai_input?.prepared;
    if (parsed.success && prepared) {
      const checked = checkAnswer(parsed.data.answer, answerContext(job.ai_input));
      if (checked.content) {
        content = checked.content;
        sources = prepared.sources.filter((source) => checked.cited.includes(source.n));
        warnings = checked.warnings.length ? checked.warnings : null;
      } else errorCode = "invalid_ai_output";
    } else errorCode = "invalid_ai_output";
  }
  const model = "error" in input ? null : input;
  await client.query(
    `UPDATE stu_chat_messages SET status=$2,error_code=$3,content=$4,sources=$5::jsonb,warnings=$6::jsonb,metrics=$7::jsonb,ai_model=$8,
      ai_model_digest=$9,ollama_version=$10,ai_input=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1`,
    [id, errorCode ? "failed" : "completed", errorCode, errorCode ? "" : content, JSON.stringify(errorCode ? [] : sources),
      warnings ? JSON.stringify(warnings) : null, model ? JSON.stringify(model.metrics) : null, model?.model ?? null,
      model?.digest || null, model?.ollamaVersion || null]);
  await client.query("UPDATE stu_chat_threads SET updated_at=now() WHERE id=$1", [job.thread_id]);
  return "ok";
}
