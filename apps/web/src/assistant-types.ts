/**
 * Trợ lý AI (STU-CHAT-01..05, 2026-10-28): the API of /api/student/assistant as the student page reads it. The server
 * answers through the local Gemma worker: an answer is queued, then streamed into the message (content grows while
 * status is "processing"), so the page polls GET /messages/:id until the status is final.
 *
 * GET    /threads                    → { threads: AssistantThread[]; workerOnline: boolean }
 * POST   /threads        { content } → { thread: AssistantThread; messages: AssistantMessage[] }  (the question + the answer being written)
 * GET    /threads/:id                → { thread: AssistantThread; messages: AssistantMessage[] }  (oldest first)
 * POST   /threads/:id/messages { content } → { thread: AssistantThread; messages: AssistantMessage[] } (the question + the answer)
 * DELETE /threads/:id                → 204
 * GET    /messages/:id               → { message: AssistantMessage }
 * POST   /messages/:id/feedback { value: 1 | -1 | null } → { message: AssistantMessage }
 * POST   /messages/:id/retry         → { message: AssistantMessage }                           (a failed answer, queued again)
 *
 * Errors: { error } with 400 empty_message | message_too_long, 404 thread_not_found | message_not_found,
 * 409 answer_pending (the thread still waits for an answer) | not_failed (retry), 429 too_frequent | queue_full,
 * 503 database_required.
 */
export const ASSISTANT_API = "/api/student/assistant";
/** Longest question, in characters (the server checks the same). */
export const ASSISTANT_MAX_QUESTION = 1000;

export type AssistantThread = {
  id: string;
  /** The first question, shortened. */
  title: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Where an answer took a fact from, numbered as the answer cites it ([1], [2]…). `link` is a page of the student
 * portal ("#skill-gap", "#roadmap", "#competency", "#career", "#graduation", "#curriculum", "#plans", "#profile") or an
 * https:// address of a self-study resource; null when there is nothing to open.
 */
export type AssistantSourceKind =
  | "profile" | "assessment" | "roadmap" | "graduation" | "course" | "skill" | "career" | "curriculum" | "plan" | "resource" | "guide";
export type AssistantSource = { n: number; kind: AssistantSourceKind; title: string; link: string | null };

export type AssistantMessageStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type AssistantMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  /**
   * The question, or the answer: plain text with "- " bullets, "1. " numbered lines, **bold** and [n] citations; an
   * https:// address only inside a resource line. Grows while the answer is written ("processing").
   */
  content: string;
  status: AssistantMessageStatus;
  /** Why an answer failed: worker_timeout, ai_timeout, ai_output_truncated, invalid_ai_output, ollama_unavailable, ai_failed. */
  errorCode: string | null;
  /** The sources the answer cites, by number; empty for questions and answers still being written. */
  sources: AssistantSource[];
  feedback: 1 | -1 | null;
  createdAt: string;
  completedAt: string | null;
};

export type AssistantThreadsResponse = { threads: AssistantThread[]; workerOnline: boolean };
export type AssistantThreadResponse = { thread: AssistantThread; messages: AssistantMessage[] };
