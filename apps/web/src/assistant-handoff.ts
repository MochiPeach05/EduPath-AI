/**
 * "Hỏi nhanh Trợ lý AI" on Tổng quan (2026-10-30): the overview leaves the question here and opens #assistant, whose page
 * takes it once and sends it in a new conversation. Kept apart from StudentAssistant so the overview does not load the
 * chat page's code. One question, for a minute at most; sessionStorage only (nothing reaches the server until it is sent).
 */
const KEY = "edupath.assistant.pending";
const FRESH_MS = 60_000;

export function queueAssistantQuestion(question: string) {
  const text = question.trim();
  if (!text) return;
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ text, at: Date.now() })); } catch { /* the student then types it again */ }
}

/** The question left by the overview, removed as it is read; null when none or older than a minute. */
export function takeQueuedQuestion(now = Date.now()): string | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { text?: unknown; at?: unknown };
    return typeof value.text === "string" && value.text.trim() && typeof value.at === "number" && now - value.at <= FRESH_MS ? value.text.trim() : null;
  } catch {
    return null;
  }
}
