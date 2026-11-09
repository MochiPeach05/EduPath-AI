// Tìm cuộc trò chuyện of Trợ lý AI (user 2026-11-09: "Thêm một chức năng tìm kiếm cuộc hội thoại nữa"): the student's
// conversations whose title or messages hold every word of the search, with or without accents ("dieu kien" finds "Điều
// kiện"), newest first; each with a short piece of the message that matched when the title alone does not show every
// word. Read-only. A cố vấn học tập searches only the conversations they started, like the list (listThreads).
import type { DatabasePool } from "../db/pool.js";
import { listThreads, type ThreadRow } from "./chat.js";

type Db = Pick<DatabasePool, "query">;
/** The longest search read, in characters (the page sends at most this many). */
export const MAX_SEARCH_CHARS = 100;
/** Messages read per search at most, the newest first: the 50 listed conversations' questions and finished answers. */
const MAX_MESSAGES_SEARCHED = 3000;
/** About how long the piece of a message shown under a title is. */
const SNIPPET_CHARS = 160;

/** One character as the search compares it: lower case, no diacritics, đ → d. */
const foldChar = (ch: string) => ch.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();

/** The text folded (foldChar), and for each folded character where it starts in the text (one more at the end). */
export function foldWithMap(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  let index = 0;
  for (const ch of text) {
    const one = foldChar(ch);
    for (let k = 0; k < one.length; k += 1) at.push(index);
    folded += one;
    index += ch.length;
  }
  at.push(index);
  return { folded, at };
}

/** The folded words of a search, each once; none when it has fewer than two letters or digits in all. */
export function searchWords(query: string): string[] {
  const words = [...new Set(foldWithMap(query.slice(0, MAX_SEARCH_CHARS)).folded.split(/[\s.,;:!?"'“”‘’()[\]{}<>]+/u).filter(Boolean))];
  return words.join("").replace(/[^\p{L}\p{N}]/gu, "").length >= 2 ? words : [];
}

/** A message as one line of plain text: no **bold**, [n] citations, list marks or line breaks. */
export function plainMessage(content: string): string {
  return content.replace(/\*\*/g, "").replace(/\s*\[\d+\]/g, "").replace(/^\s*(?:[-•*]|\d+\.)\s+/gm, "").replace(/\s+/g, " ").trim();
}

/** About `size` characters of `text` from a little before its first match of `words`, cut at spaces, "…" where cut. */
export function searchSnippet(text: string, words: readonly string[], size = SNIPPET_CHARS): string {
  const { folded, at } = foldWithMap(text);
  const hits = words.map((word) => folded.indexOf(word)).filter((index) => index >= 0);
  const first = hits.length ? at[Math.min(...hits)]! : 0;
  let start = Math.max(0, first - Math.floor(size / 4));
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < first) start = space + 1;
  }
  let end = Math.min(text.length, start + size);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > first) end = space;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export type ThreadSearchResult = { thread: ThreadRow; snippet: string | null };

/** The conversations matching `query` (searchWords), in the list's order; [] for a search too short to look for. */
export async function searchThreads(db: Db, userId: string, query: string, advisorId: string | null = null): Promise<ThreadSearchResult[]> {
  const words = searchWords(query);
  if (!words.length) return [];
  const threads = await listThreads(db, userId, advisorId);
  if (!threads.length) return [];
  const rows = (await db.query<{ threadId: string; content: string }>(
    `SELECT thread_id AS "threadId",content FROM stu_chat_messages
      WHERE user_id=$1 AND thread_id=ANY($2::uuid[]) AND content<>'' AND (role='user' OR status='completed')
      ORDER BY created_at DESC,id DESC LIMIT $3`,
    [userId, threads.map((thread) => thread.id), MAX_MESSAGES_SEARCHED])).rows;
  const messages = new Map<string, string[]>();
  // Oldest first within a conversation, so the piece shown is from the first message that matched.
  for (const row of [...rows].reverse()) messages.set(row.threadId, [...(messages.get(row.threadId) ?? []), plainMessage(row.content)]);
  const results: ThreadSearchResult[] = [];
  for (const thread of threads) {
    const title = foldWithMap(thread.title).folded;
    const texts = messages.get(thread.id) ?? [];
    const folded = texts.map((text) => foldWithMap(text).folded);
    if (!words.every((word) => title.includes(word) || folded.some((text) => text.includes(word)))) continue;
    const missing = words.filter((word) => !title.includes(word));
    if (!missing.length) {
      results.push({ thread, snippet: null });
      continue;
    }
    // The message with most of the words the title lacks.
    let best = 0;
    let bestCount = -1;
    folded.forEach((text, index) => {
      const count = missing.filter((word) => text.includes(word)).length;
      if (count > bestCount) { best = index; bestCount = count; }
    });
    results.push({ thread, snippet: searchSnippet(texts[best]!, missing) });
  }
  return results;
}
