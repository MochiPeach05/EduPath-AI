// The worker protocol of "Trợ lý AI" (STU-CHAT-01..05, 2026-10-28), shared by the API (assistant/*, the worker router)
// and the local worker (ai-worker/*). Two job kinds go through /api/worker/competency-assessments next to the others:
//
// assistant_chat: one answer. The claimed job carries the question to embed (or embed: null). The worker embeds it with
//   the embedding model (on the CPU, so Gemma keeps the GPU), POSTs /:id/prepare { leaseToken, vector } (vector null when
//   embedding failed: the server then searches by words only) and receives the prompt { system, user, options, think,
//   promptVersion }. It streams Gemma's answer (plain text, no JSON schema) and POSTs the text so far to /:id/progress
//   { leaseToken, content } about once a second, then completes with output { answer }. Since assistant-v3 a question
//   asked after others also carries rewrite: a short prompt Gemma answers first (no thinking) with the question written
//   out in full ("Còn môn đó thì sao?" → the course it means); the worker embeds that standalone question instead and
//   sends it as /prepare's standalone, which the server then searches with.
// knowledge_embedding: a batch of texts of the shared knowledge index; the worker completes with output { vectors }, one
//   vector per input, in order.
//
// /claim accepts { kinds, wait: true }: with no job, the server waits up to CLAIM_WAIT_MS for a question to answer.
import { z } from "zod";
import { ASSISTANT_CHAT_KIND, KNOWLEDGE_EMBEDDING_KIND } from "../competency-assessment/ai/worker-protocol.js";

/**
 * Google's EmbeddingGemma (308M, 768 dimensions, multilingual), pulled into the worker's Ollama. Gemma 4 itself has no
 * embedding endpoint ("This server does not support embeddings"). Chunks embedded by another model are embedded again.
 */
export const EMBEDDING_MODEL = "embeddinggemma";
export const EMBEDDING_DIMENSIONS = 768;
/** EmbeddingGemma's prompt formats for retrieval: the question and a document of the index. */
export const queryEmbeddingText = (query: string) => `task: search result | query: ${query}`;
export const documentEmbeddingText = (title: string, text: string) => `title: ${title.trim() || "none"} | text: ${text}`;

/**
 * v2 (2026-10-29): Gemma thinks before it answers (prompt.ts ASSISTANT_THINK); skill keys no longer in the data.
 * v3 (2026-10-29, user: the assistant forgot the conversation after 2–3 vague questions): a follow-up is rewritten into a
 * standalone question before retrieval, the sources the previous answers cited and the topics of the last turns carry
 * over, and the history is longer with its lines kept.
 * v4 (2026-10-29, user: the assistant answered "Mình không có thông tin về điểm tổng (GPA)"; "giữ nguyên json bảng điểm luôn
 * và lấy thêm thông tin từ nó nữa để sinh viên có thể tra cứu"): the stored transcript is a source, "Bảng điểm của bạn"
 * (transcript.ts): always the printed cumulative GPA and credits and the courses not passed, the rows of the courses and
 * terms a question names, every row for a grade question (intent "transcript"); grades are quoted, never recomputed.
 * v5 (2026-10-29, user: "nên trả lời một cách rõ ràng hơn bạn chưa thực hiện đánh giá năng lực nên chúng tôi chưa có cơ sở
 * để tư vấn"): a question needing results the student does not have yet is answered by saying so first, with the steps;
 * the clear cases never reach the AI (readiness.ts answers them at once, prompt_version assistant-readiness-v1).
 * v6 (2026-10-29, user: "Tôi thấy hiện tại nó trả lời không có human lắm"): the voice of an anh/chị khóa trên (prompt.ts):
 * the answer first, prose rather than lists, no stock phrases, each source cited once per paragraph (validate.ts compacts
 * repeated and stacked citations), a follow-up question only when useful, contrast examples with invented names.
 * v7 (user review 2026-10-30: "Trợ lý AI trả lời 2.45", "Học kỳ đang được gọi theo 4 kiểu"): the sources write decimals
 * with a comma (printed transcript values too) and terms "HK1 2026–2027" like the pages, and the check of an answer turns
 * a score-like "2.45" into "2,45" (validate.ts decimalComma). The system prompt is unchanged.
 * v8 (user 2026-10-31: "hãy xem cách tính của bảng điểm thật và học theo"): the transcript source also carries the printed
 * "Điểm TB học tập" and "Tổng số tín chỉ đăng ký" (every registered credit, failed courses included) next to the "tích lũy"
 * lines (passed courses only), with one sentence on the difference. The system prompt is unchanged.
 */
export const ASSISTANT_PROMPT_VERSION = "assistant-v8";
export const KNOWLEDGE_PROMPT_VERSION = "knowledge-v1";
/** An answer takes well under a minute; a lost worker frees the job after this lease (the worker extends every 3 min). */
export const ASSISTANT_LEASE_MINUTES = 5;
/** Texts per knowledge_embedding job (about 32 × 768 numbers stay under the worker router's 512 kB body limit). */
export const KNOWLEDGE_BATCH = 32;
/** How long /claim with wait: true holds an empty claim for a question to arrive. */
export const CLAIM_WAIT_MS = 12_000;
/** Longest question (characters); the web page checks the same (ASSISTANT_MAX_QUESTION). */
export const MAX_QUESTION_CHARS = 1000;
/** Longest answer the server stores, and the longest text /progress accepts. */
export const MAX_ANSWER_CHARS = 12_000;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
/** A local Ollama model name (the worker refuses cloud models). */
export const localModelName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/).refine((name) => !/cloud/i.test(name), "cloud_model");
export const embedSpecSchema = z.object({
  model: localModelName,
  inputs: z.array(z.string().min(1).max(8000)).min(1).max(64),
});
export type EmbedSpec = z.infer<typeof embedSpecSchema>;

/** The prompt that writes a follow-up out in full (prompt.ts buildRewritePrompt); null for the first question. */
export const rewriteSpecSchema = z.object({
  system: z.string().min(1),
  user: z.string().min(1),
  options: z.record(z.string(), z.unknown()),
});
export type RewriteSpec = z.infer<typeof rewriteSpecSchema>;
export const assistantClaimSchema = z.object({
  kind: z.literal(ASSISTANT_CHAT_KIND),
  id: uuid,
  leaseToken: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(64),
  embed: embedSpecSchema.nullable(),
  rewrite: rewriteSpecSchema.nullable().optional(),
});
export const knowledgeClaimSchema = z.object({
  kind: z.literal(KNOWLEDGE_EMBEDDING_KIND),
  id: uuid,
  leaseToken: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(64),
  embed: embedSpecSchema,
});
export type AssistantClaim = z.infer<typeof assistantClaimSchema>;
export type KnowledgeClaim = z.infer<typeof knowledgeClaimSchema>;

export const prepareBodySchema = z.object({
  leaseToken: z.uuid(),
  vector: z.array(z.number().finite()).min(1).max(4096).nullable(),
  /** The follow-up written out in full by Gemma (rewrite); absent or null: search with the question itself. */
  standalone: z.string().max(2000).nullable().optional(),
}).strict();

/**
 * The standalone question in Gemma's rewrite: its first line without a label or quotes, 3–500 characters, or null (the
 * server then searches with its own text). Used by the worker and checked again by the server.
 */
export function standaloneQuestion(text: string | null | undefined): string | null {
  const line = (text ?? "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? "";
  const question = line.replace(/^(?:câu hỏi(?: độc lập| viết lại)?|standalone(?: question)?)\s*:\s*/i, "").replace(/^["'“”«»]+|["'“”«»]+$/g, "").trim();
  return question.length >= 3 && question.length <= 500 && !question.includes("===") ? question : null;
}
export const preparedPromptSchema = z.object({
  system: z.string().min(1),
  user: z.string().min(1),
  options: z.record(z.string(), z.unknown()),
  think: z.boolean(),
  promptVersion: z.string().min(1).max(64),
});
export type PreparedPrompt = z.infer<typeof preparedPromptSchema>;
export const progressBodySchema = z.object({ leaseToken: z.uuid(), content: z.string().max(MAX_ANSWER_CHARS) }).strict();

export const assistantOutputSchema = z.object({ answer: z.string().trim().min(1).max(MAX_ANSWER_CHARS) });
export const knowledgeOutputSchema = z.object({ vectors: z.array(z.array(z.number().finite()).min(1).max(4096)).min(1).max(64) });
