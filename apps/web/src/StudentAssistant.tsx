import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { formatAnswer, safeHttpsUrl } from "./assistant-format";
import {
  ASSISTANT_API, ASSISTANT_MAX_QUESTION,
  type AssistantMessage, type AssistantMessageStatus, type AssistantSource, type AssistantThread, type AssistantThreadResponse, type AssistantThreadsResponse,
} from "./assistant-types";
import { Icon } from "./student-icons";
import "./student-assistant.css";

// "Trợ lý AI" (STU-CHAT-01..05, 2026-10-28): a chat with EduPath AI about the student's skill gaps, roadmap, recommended
// courses, careers and self-study resources. The conversations are listed on the left (a selector above the chat below
// 900px). A question is queued for the local Gemma worker; while its answer waits or is written the page reads it about
// once a second and shows the text as it grows. A finished answer cites its sources ([n]) and can be rated.

/** How often an answer that waits or is being written is read again. */
export const ANSWER_POLL_MS = 1000;
/** While the AI is offline a queued answer cannot start, so it is read less often. */
export const ANSWER_IDLE_POLL_MS = 10_000;
/** The list (and whether the AI is online) is read again this often while the page is visible. */
const LIST_REFRESH_MS = 30_000;
/** The character counter shows from here on. */
const COUNTER_FROM = Math.floor(ASSISTANT_MAX_QUESTION * 0.8);
/** The open conversation, kept for this tab: a source link leaves the page, and coming back opens it again. */
const OPEN_THREAD_KEY = "edupath.assistant.thread";

/** One starter question per function of the assistant, STU-CHAT-01..05 in order. */
export const STARTER_QUESTIONS = [
  { icon: "target", text: "Mình còn thiếu những kỹ năng nào cho nghề mục tiêu?" },
  { icon: "route", text: "Học kỳ tới mình nên học những môn nào?" },
  { icon: "shield", text: "Điều kiện xét tốt nghiệp của khóa mình là gì?" },
  { icon: "help", text: "Vì sao lộ trình đề xuất các môn này cho mình?" },
  { icon: "book", text: "Mình nên tự học kỹ năng còn thiếu ở đâu?" },
] as const;

export const OFFLINE_NOTICE = "Trợ lý AI đang tạm ngưng. Câu hỏi vẫn được lưu và sẽ được trả lời khi hệ thống AI hoạt động trở lại.";

/* ------------------------------------------------------------------ requests */

const ERROR_MESSAGES: Record<string, string> = {
  empty_message: "Bạn hãy nhập câu hỏi trước khi gửi.",
  message_too_long: `Câu hỏi dài hơn ${ASSISTANT_MAX_QUESTION.toLocaleString("vi-VN")} ký tự. Bạn hãy rút gọn rồi gửi lại.`,
  answer_pending: "Trợ lý đang trả lời câu hỏi trước. Bạn đợi trả lời xong rồi gửi câu tiếp theo nhé.",
  too_frequent: "Bạn gửi hơi nhanh. Vui lòng đợi vài giây rồi gửi lại.",
  queue_full: "Trợ lý đang nhận nhiều câu hỏi cùng lúc. Vui lòng thử lại sau ít phút.",
  network: "Không kết nối được với máy chủ. Bạn hãy kiểm tra kết nối mạng rồi thử lại.",
  thread_not_found: "Cuộc trò chuyện này không còn nữa, có thể đã được xóa ở một cửa sổ khác.",
  message_not_found: "Không tìm thấy câu trả lời này, có thể cuộc trò chuyện đã được xóa.",
  not_failed: "Câu hỏi này đã được gửi lại cho trợ lý.",
  database_required: "Chưa kết nối được nơi lưu cuộc trò chuyện. Vui lòng thử lại sau.",
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  account_unavailable: "Tài khoản hiện không dùng được chức năng này.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
};
export const assistantErrorMessage = (code: string | undefined) => ERROR_MESSAGES[code ?? ""] ?? "Chưa xử lý được yêu cầu. Vui lòng thử lại.";

/** A request that failed: the server's error code ("network" when the server could not be reached). */
export class AssistantRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(assistantErrorMessage(code)); }
}
const errorText = (error: unknown) => (error instanceof AssistantRequestError ? error.message : assistantErrorMessage(undefined));
const codeOf = (error: unknown) => (error instanceof AssistantRequestError ? error.code : "");

/** `valid` checks the body of a successful answer; without it any body (or none) is accepted. */
async function call<T>(path: string, init: RequestInit = {}, valid?: (body: T) => boolean): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ASSISTANT_API}${path}`, { credentials: "include", cache: "no-store", ...init,
      headers: init.body ? { "Content-Type": "application/json" } : undefined });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new AssistantRequestError("network", 0);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    throw new AssistantRequestError(body?.error ?? (response.status === 401 ? "authentication_required" : "unknown"), response.status);
  }
  // A body of another shape is not this API's answer (e.g. an older server): say so instead of breaking the page.
  if (valid && !(body && valid(body))) throw new AssistantRequestError("unknown", response.status);
  return body as T;
}

const json = (value: unknown) => JSON.stringify(value);
const path = (id: string) => encodeURIComponent(id);
const hasThread = (body: AssistantThreadResponse) => Boolean(body.thread?.id) && Array.isArray(body.messages);
const hasMessage = (body: { message: AssistantMessage }) => Boolean(body.message?.id);

/** The API of /api/student/assistant (assistant-types.ts). */
export const assistantApi = {
  threads: (signal?: AbortSignal) => call<AssistantThreadsResponse>("/threads", { signal }, (body) => Array.isArray(body.threads)),
  thread: (id: string, signal?: AbortSignal) => call<AssistantThreadResponse>(`/threads/${path(id)}`, { signal }, hasThread),
  start: (content: string) => call<AssistantThreadResponse>("/threads", { method: "POST", body: json({ content }) }, hasThread),
  ask: (threadId: string, content: string) => call<{ messages: AssistantMessage[] }>(`/threads/${path(threadId)}/messages`,
    { method: "POST", body: json({ content }) }, (body) => Array.isArray(body.messages)),
  remove: (threadId: string) => call<void>(`/threads/${path(threadId)}`, { method: "DELETE" }),
  message: (id: string, signal?: AbortSignal) => call<{ message: AssistantMessage }>(`/messages/${path(id)}`, { signal }, hasMessage),
  feedback: (id: string, value: 1 | -1 | null) => call<{ message: AssistantMessage }>(`/messages/${path(id)}/feedback`,
    { method: "POST", body: json({ value }) }, hasMessage),
  retry: (id: string) => call<{ message: AssistantMessage }>(`/messages/${path(id)}/retry`, { method: "POST", body: json({}) }, hasMessage),
};

export const isAnswerPending = (status: AssistantMessageStatus) => status === "queued" || status === "processing";

/**
 * Reads answer `id` again and again until its status is final or `signal` aborts, waiting `interval(last read)` ms before
 * each read. A failed read keeps the last state and tries again; an answer that no longer exists calls onGone.
 */
export function watchAnswer(id: string, { signal, onUpdate, onGone, interval }: {
  signal: AbortSignal;
  onUpdate: (message: AssistantMessage) => void;
  onGone: () => void;
  interval: (last: AssistantMessage | null) => number;
}): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: AssistantMessage | null = null;
  const read = async () => {
    try {
      const { message } = await assistantApi.message(id, signal);
      if (signal.aborted) return;
      last = message;
      onUpdate(message);
      if (!isAnswerPending(message.status)) return;
    } catch (error) {
      if (signal.aborted) return;
      const code = codeOf(error);
      if (code === "message_not_found" || code === "thread_not_found") { onGone(); return; }
      // The workspace asks the student to sign in again.
      if (code === "authentication_required") return;
    }
    timer = setTimeout(() => void read(), interval(last));
  };
  timer = setTimeout(() => void read(), interval(last));
  signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
}

/* ------------------------------------------------------------------- helpers */

const time = (iso: string) => {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
};
/** Newest conversation first. */
export const newestFirst = (threads: readonly AssistantThread[]) => [...threads].sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
const withThread = (threads: readonly AssistantThread[], thread: AssistantThread) => newestFirst([thread, ...threads.filter((item) => item.id !== thread.id)]);

const ZONE = "Asia/Ho_Chi_Minh";
const dayOf = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: ZONE });
/** When a conversation was last used: "14:05" today, "Hôm qua", "27/10" this year, "27/10/2025" before (Vietnam time). */
export function threadTimeLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = dayOf(date), today = dayOf(now);
  if (day === today) return date.toLocaleTimeString("vi-VN", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" });
  if (day === dayOf(new Date(now.getTime() - 86_400_000))) return "Hôm qua";
  const [year, month, dayOfMonth] = day.split("-");
  return year === today.slice(0, 4) ? `${dayOfMonth}/${month}` : `${dayOfMonth}/${month}/${year}`;
}

/** A page of the portal ("#skill-gap"), opened in place like the nav; anything else is not a portal link. */
const portalLink = (link: string | null) => (link && /^#[a-z][a-z-]*$/.test(link) ? link : null);

function storedThread(): string | null {
  try { return window.sessionStorage.getItem(OPEN_THREAD_KEY); } catch { return null; }
}
function storeThread(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(OPEN_THREAD_KEY, id);
    else window.sessionStorage.removeItem(OPEN_THREAD_KEY);
  } catch { /* only a convenience */ }
}

/* ---------------------------------------------------------------------- data */

type Conversation = { threadId: string; messages: AssistantMessage[] };
type ActionError = { messageId: string; text: string };
export type Announcement = { text: string; n: number };

function useAssistant() {
  // The list is read again every 30 s and when the student comes back to the tab, for workerOnline and other tabs' changes.
  const [list, setList] = useState<AssistantThreadsResponse | null>(null);
  const [listError, setListError] = useState("");
  const [listRevision, setListRevision] = useState(0);
  // Local changes since a list request started: its answer would undo them, so it is read again instead.
  const changes = useRef(0);
  useEffect(() => {
    let controller: AbortController | undefined;
    let requestedAt = 0;
    const load = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const seen = changes.current;
      requestedAt = Date.now();
      assistantApi.threads(request.signal).then((data) => {
        if (request.signal.aborted) return;
        if (seen !== changes.current) { load(); return; }
        const next = { threads: newestFirst(data.threads), workerOnline: data.workerOnline === true };
        setList((current) => (current && json(current) === json(next) ? current : next));
        setListError("");
      }, (error: unknown) => { if (!request.signal.aborted) setListError(errorText(error)); });
    };
    load();
    const refresh = () => {
      if (document.visibilityState === "visible" && Date.now() - requestedAt >= 5000) load();
    };
    const timer = window.setInterval(refresh, LIST_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [listRevision]);
  const workerOnline = list?.workerOnline ?? true;
  const online = useRef(workerOnline);
  useEffect(() => { online.current = workerOnline; }, [workerOnline]);

  const [selectedId, setSelectedId] = useState<string | null>(storedThread);
  const selected = useRef(selectedId);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const loaded = useRef(conversation);
  useEffect(() => { loaded.current = conversation; }, [conversation]);
  const [loadError, setLoadError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const forceLoad = useRef(false);
  const [sending, setSending] = useState(false);
  const sendingNow = useRef(false);
  const [sendError, setSendError] = useState("");
  const [actionError, setActionError] = useState<ActionError | null>(null);

  const select = useCallback((id: string | null) => {
    selected.current = id;
    setSelectedId(id);
    storeThread(id);
    setLoadError(""); setSendError(""); setActionError(null);
  }, []);
  const reloadConversation = useCallback(() => { forceLoad.current = true; setLoadRevision((n) => n + 1); }, []);
  const dropThread = useCallback((id: string) => {
    changes.current += 1;
    setList((current) => current && { ...current, threads: current.threads.filter((thread) => thread.id !== id) });
    setConversation((current) => (current?.threadId === id ? null : current));
    if (selected.current === id) select(null);
  }, [select]);
  const replaceMessage = useCallback((message: AssistantMessage) => {
    setConversation((current) => {
      if (!current || current.threadId !== message.threadId) return current;
      const index = current.messages.findIndex((item) => item.id === message.id);
      if (index < 0 || json(current.messages[index]) === json(message)) return current;
      return { ...current, messages: current.messages.map((item, i) => (i === index ? message : item)) };
    });
  }, []);

  // The open conversation, read when it is opened (not again when it was just started here).
  useEffect(() => {
    if (!selectedId) return;
    if (loaded.current?.threadId === selectedId && !forceLoad.current) return;
    forceLoad.current = false;
    const controller = new AbortController();
    assistantApi.thread(selectedId, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setConversation({ threadId: selectedId, messages: data.messages });
      setList((current) => current && current.threads.some((thread) => thread.id === data.thread.id)
        ? { ...current, threads: withThread(current.threads, data.thread) } : current);
    }, (error: unknown) => {
      if (controller.signal.aborted) return;
      // Deleted meanwhile (or a conversation remembered from earlier that is gone): back to a new conversation.
      if (codeOf(error) === "thread_not_found") dropThread(selectedId);
      else setLoadError(errorText(error));
    });
    return () => controller.abort();
  }, [selectedId, loadRevision, dropThread]);

  const shown = selectedId && conversation?.threadId === selectedId ? conversation : null;
  const pendingId = shown?.messages.find((message) => message.role === "assistant" && isAnswerPending(message.status))?.id ?? null;
  // Read the answer that waits or is being written until it is final; a new thread or leaving the page stops it.
  useEffect(() => {
    if (!pendingId) return;
    const controller = new AbortController();
    watchAnswer(pendingId, {
      signal: controller.signal, onUpdate: replaceMessage, onGone: reloadConversation,
      interval: (last) => (last?.status === "queued" && !online.current ? ANSWER_IDLE_POLL_MS : ANSWER_POLL_MS),
    });
    return () => controller.abort();
  }, [pendingId, replaceMessage, reloadConversation]);

  // Screen readers hear when an answer they waited for is finished, not every piece of it.
  const [announcement, setAnnouncement] = useState<Announcement>({ text: "", n: 0 });
  const statuses = useRef<{ threadId: string | null; byId: Map<string, AssistantMessageStatus> }>({ threadId: null, byId: new Map() });
  useEffect(() => {
    const before = statuses.current;
    if (shown && before.threadId === shown.threadId) {
      for (const message of shown.messages) {
        const was = before.byId.get(message.id);
        if (message.role !== "assistant" || !was || !isAnswerPending(was) || isAnswerPending(message.status)) continue;
        const text = message.status === "completed" ? "Trợ lý đã trả lời xong câu hỏi của bạn."
          : message.status === "failed" ? "Chưa trả lời được câu hỏi này." : "Câu trả lời đã dừng.";
        setAnnouncement((current) => ({ text, n: current.n + 1 }));
      }
    }
    statuses.current = { threadId: shown?.threadId ?? null, byId: new Map(shown?.messages.map((message) => [message.id, message.status] as const)) };
  }, [shown]);

  const send = async (text: string): Promise<boolean> => {
    const content = text.trim();
    const problem = !content ? "empty_message" : content.length > ASSISTANT_MAX_QUESTION ? "message_too_long" : pendingId ? "answer_pending" : null;
    if (problem) { setSendError(assistantErrorMessage(problem)); return false; }
    if (sendingNow.current) return false;
    sendingNow.current = true;
    setSending(true); setSendError(""); setActionError(null);
    const threadId = selectedId;
    changes.current += 1;
    try {
      if (!threadId) {
        const data = await assistantApi.start(content);
        setList((current) => current && { ...current, threads: withThread(current.threads, data.thread) });
        // The new conversation opens, unless the student has meanwhile opened another one.
        if (selected.current === null) {
          const opened = { threadId: data.thread.id, messages: data.messages };
          loaded.current = opened;
          setConversation(opened);
          select(data.thread.id);
        }
      } else {
        const data = await assistantApi.ask(threadId, content);
        setConversation((current) => (current?.threadId === threadId ? { ...current, messages: [...current.messages, ...data.messages] } : current));
        const at = data.messages[0]?.createdAt ?? new Date().toISOString();
        setList((current) => current && { ...current, threads: newestFirst(current.threads.map((thread) => (thread.id === threadId ? { ...thread, updatedAt: at } : thread))) });
      }
      return true;
    } catch (error) {
      const code = codeOf(error);
      if (code === "thread_not_found" && threadId) dropThread(threadId);
      // Another tab asked meanwhile: show that answer and wait for it.
      if (code === "answer_pending") reloadConversation();
      setSendError(errorText(error));
      return false;
    } finally {
      sendingNow.current = false;
      setSending(false);
    }
  };

  const remove = async (id: string): Promise<string | null> => {
    changes.current += 1;
    try { await assistantApi.remove(id); } catch (error) { if (codeOf(error) !== "thread_not_found") return errorText(error); }
    dropThread(id);
    return null;
  };

  const [retrying, setRetrying] = useState<string | null>(null);
  const retry = async (id: string): Promise<boolean> => {
    if (retrying) return false;
    setRetrying(id); setActionError(null);
    try {
      replaceMessage((await assistantApi.retry(id)).message);
      return true;
    } catch (error) {
      if (codeOf(error) !== "not_failed") { setActionError({ messageId: id, text: errorText(error) }); return false; }
      // Already asked again (e.g. in another tab): show where that answer is.
      try { replaceMessage((await assistantApi.message(id)).message); } catch { reloadConversation(); }
      return true;
    } finally {
      setRetrying(null);
    }
  };

  const rating = useRef<string | null>(null);
  const rate = async (message: AssistantMessage, value: 1 | -1) => {
    if (rating.current) return;
    rating.current = message.id;
    const next = message.feedback === value ? null : value;
    setActionError(null);
    replaceMessage({ ...message, feedback: next });
    try { replaceMessage((await assistantApi.feedback(message.id, next)).message); }
    catch { replaceMessage(message); setActionError({ messageId: message.id, text: "Chưa lưu được đánh giá của bạn. Vui lòng thử lại." }); }
    finally { rating.current = null; }
  };

  return {
    threads: list?.threads ?? null, listError: list ? "" : listError, onReloadList: () => setListRevision((n) => n + 1), workerOnline,
    selectedId, messages: shown?.messages ?? null, loadError, onReloadConversation: reloadConversation, onSelect: select,
    onSend: send, sending, sendError, onDelete: remove, onRetry: retry, retrying, onRate: rate, actionError, announcement,
  };
}

/* ---------------------------------------------------------------------- view */

/** The thumbs of the feedback buttons, in the line style of ui-icon.tsx; down is up turned over. */
function Thumb({ down = false }: { down?: boolean }) {
  return <svg className="ep-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path transform={down ? "rotate(180 12 12)" : undefined} d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
  </svg>;
}

function Dots() {
  return <span className="as-dots" aria-hidden="true"><i /><i /><i /></span>;
}

/** "Xóa cuộc trò chuyện này? [Xóa] [Hủy]" under the conversation; Esc cancels. */
export function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => Promise<string | null>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // The safe choice takes focus (the copy that is hidden at this width cannot take it).
  useEffect(() => { cancel.current?.focus(); }, []);
  // A failed delete gives Xóa back its focus (lost while it was disabled), to try again.
  useEffect(() => { if (error) confirmButton.current?.focus(); }, [error]);
  const confirm = async () => {
    setBusy(true); setError("");
    const problem = await onConfirm();
    // On success the conversation and this question are gone.
    if (problem) { setError(problem); setBusy(false); }
  };
  return <div className="as-confirm" role="group" aria-label="Xác nhận xóa cuộc trò chuyện"
    onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onCancel(); } }}>
    <p>Xóa cuộc trò chuyện này?</p>
    <div className="as-confirm-actions">
      <button type="button" ref={confirmButton} className="sw-primary as-small" disabled={busy} onClick={() => void confirm()}>{busy ? "Đang xóa…" : "Xóa"}</button>
      <button type="button" ref={cancel} className="sw-outline as-small" disabled={busy} onClick={onCancel}>Hủy</button>
    </div>
    {error && <p className="as-confirm-error" role="alert">{error}</p>}
  </div>;
}

type ListProps = {
  threads: AssistantThread[] | null;
  listError: string;
  onReloadList: () => void;
  selectedId: string | null;
  confirming: string | null;
  now: Date;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  onAskDelete: (id: string, opener: HTMLElement) => void;
  onCancelDelete: () => void;
  onDelete: (id: string) => Promise<string | null>;
};

function ListState({ threads, listError, onReloadList }: Pick<ListProps, "threads" | "listError" | "onReloadList">) {
  if (threads) return threads.length ? null : <p className="as-list-note">Chưa có cuộc trò chuyện nào. Câu hỏi đầu tiên của bạn sẽ mở một cuộc trò chuyện mới.</p>;
  return listError
    ? <div className="as-list-note as-list-problem" role="alert"><p>Chưa tải được các cuộc trò chuyện. {listError}</p>
      <button type="button" className="sw-outline as-small" onClick={onReloadList}><Icon name="refresh" />Thử lại</button></div>
    : <p className="as-list-note" role="status">Đang tải các cuộc trò chuyện…</p>;
}

/** Wide screens: the conversations, newest first. */
function ThreadList(props: ListProps) {
  const { threads, selectedId, confirming, now } = props;
  return <section className="sw-panel as-threads" aria-labelledby="as-threads-title">
    <h2 id="as-threads-title">Cuộc trò chuyện</h2>
    <button type="button" className="sw-primary as-new" onClick={props.onNew}><Icon name="plus" />Cuộc trò chuyện mới</button>
    <ListState {...props} />
    {threads && threads.length > 0 && <ul className="as-thread-list">
      {threads.map((thread) => {
        const current = thread.id === selectedId;
        // The question goes under the conversation it deletes, which stays in view; Hủy gives focus back to its button.
        return <li key={thread.id} className={`as-thread${current ? " is-current" : ""}`}>
          <div className="as-thread-row">
            <button type="button" className="as-thread-open" aria-current={current ? "true" : undefined} onClick={() => props.onSelect(thread.id)}>
              <span className="as-thread-title">{thread.title}</span>
              <time className="as-thread-time" dateTime={thread.updatedAt}>{threadTimeLabel(thread.updatedAt, now)}</time>
            </button>
            <button type="button" className="as-thread-delete" aria-label={`Xóa cuộc trò chuyện: ${thread.title}`} title="Xóa cuộc trò chuyện"
              aria-expanded={confirming === thread.id} onClick={(event) => props.onAskDelete(thread.id, event.currentTarget)}><Icon name="trash" /></button>
          </div>
          {confirming === thread.id && <DeleteConfirm onConfirm={() => props.onDelete(thread.id)} onCancel={props.onCancelDelete} />}
        </li>;
      })}
    </ul>}
  </section>;
}

/** Below 900px: the conversations as a selector above the chat. */
function ThreadPicker(props: ListProps) {
  const { threads, selectedId, confirming, now } = props;
  const selected = threads?.find((thread) => thread.id === selectedId) ?? null;
  return <div className="as-picker">
    <div className="as-picker-row">
      <label className="as-picker-select">
        <span className="sr-only">Chọn cuộc trò chuyện</span>
        <select value={selectedId ?? ""} onChange={(event) => props.onSelect(event.target.value || null)}>
          <option value="">Cuộc trò chuyện mới</option>
          {selectedId && !selected && <option value={selectedId}>Cuộc trò chuyện đang mở</option>}
          {threads?.map((thread) => <option key={thread.id} value={thread.id}>{thread.title} · {threadTimeLabel(thread.updatedAt, now)}</option>)}
        </select>
      </label>
      {selected && <button type="button" className="sw-outline as-picker-delete" aria-label={`Xóa cuộc trò chuyện: ${selected.title}`} title="Xóa cuộc trò chuyện"
        aria-expanded={confirming === selected.id} onClick={(event) => props.onAskDelete(selected.id, event.currentTarget)}><Icon name="trash" /></button>}
      <button type="button" className="sw-primary as-picker-new" onClick={props.onNew}><Icon name="plus" /><span>Cuộc trò chuyện mới</span></button>
    </div>
    {selected && confirming === selected.id && <DeleteConfirm onConfirm={() => props.onDelete(selected.id)} onCancel={props.onCancelDelete} />}
    {!threads && <ListState {...props} />}
  </div>;
}

function Welcome({ onAsk, busy }: { onAsk: (question: string) => void; busy: boolean }) {
  return <div className="as-welcome">
    <span className="as-welcome-icon" aria-hidden="true"><Icon name="spark" /></span>
    <h2>Chào bạn, hôm nay bạn muốn hỏi gì?</h2>
    <p>Trợ lý AI trả lời dựa trên hồ sơ, kết quả đánh giá năng lực và lộ trình học tập của bạn. Bạn có thể chọn một câu hỏi gợi ý hoặc tự nhập câu hỏi bên dưới.</p>
    <ul className="as-starters" aria-label="Câu hỏi gợi ý">
      {STARTER_QUESTIONS.map((starter) => <li key={starter.text}>
        <button type="button" className="as-starter" disabled={busy} onClick={() => onAsk(starter.text)}>
          <Icon name={starter.icon} /><span>{starter.text}</span>
        </button>
      </li>)}
    </ul>
  </div>;
}

function Sources({ sources, highlighted, chips }: { sources: readonly AssistantSource[]; highlighted: number | null; chips: RefObject<Map<number, HTMLElement>> }) {
  return <div className="as-sources">
    <span className="as-sources-label">Nguồn</span>
    <ul className="as-source-list">
      {sources.map((source) => {
        const keep = (element: HTMLElement | null) => {
          if (element) chips.current.set(source.n, element);
          else chips.current.delete(source.n);
        };
        const className = `as-source${highlighted === source.n ? " is-highlighted" : ""}`;
        const label = <><span className="as-source-n">{source.n}</span><span className="as-source-title">{source.title}</span></>;
        const page = portalLink(source.link);
        const address = page ? null : source.link && safeHttpsUrl(source.link);
        return <li key={source.n}>
          {page ? <a ref={keep} className={className} href={page}>{label}</a>
            : address ? <a ref={keep} className={className} href={address} target="_blank" rel="noopener noreferrer">{label}<Icon name="arrowUpRight" /><span className="sr-only"> (mở trong tab mới)</span></a>
              : <span ref={keep} className={className} tabIndex={-1}>{label}</span>}
        </li>;
      })}
    </ul>
  </div>;
}

type AnswerProps = {
  message: AssistantMessage;
  workerOnline: boolean;
  retrying: boolean;
  error: string | null;
  onRetry: (id: string) => void;
  onRate: (message: AssistantMessage, value: 1 | -1) => void;
};

/** An answer of the assistant, as it waits, is written, is finished or failed. */
export function AnswerItem({ message, workerOnline, retrying, error, onRetry, onRate }: AnswerProps) {
  // [n] in the text points at source chip n: it lights up for a moment and takes focus.
  const [highlight, setHighlight] = useState<{ n: number; at: number } | null>(null);
  const chips = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 2400);
    return () => clearTimeout(timer);
  }, [highlight]);
  const cite = (n: number) => {
    setHighlight({ n, at: Date.now() });
    const chip = chips.current.get(n);
    chip?.scrollIntoView({ block: "nearest" });
    chip?.focus({ preventScroll: true });
  };
  const { status, content } = message;
  const pending = isAnswerPending(status);
  let body: ReactNode;
  if (status === "completed") {
    body = <div className="as-answer-text">{formatAnswer(content, { sources: message.sources, onCite: cite })}</div>;
  } else if (pending && content.trim()) {
    body = <div className="as-answer-text">{formatAnswer(content)}<Dots /></div>;
  } else if (pending) {
    body = status === "queued" && !workerOnline
      ? <p className="as-waiting"><Icon name="clock" />Câu hỏi đã được lưu và đang chờ trả lời.</p>
      : <p className="as-typing"><Dots />Trợ lý đang soạn câu trả lời…</p>;
  } else if (status === "failed") {
    body = <div className="as-failed">
      <p>Chưa trả lời được câu hỏi này.</p>
      <button type="button" className="sw-outline as-small" disabled={retrying} onClick={() => onRetry(message.id)}><Icon name="refresh" />{retrying ? "Đang gửi lại…" : "Thử lại"}</button>
    </div>;
  } else {
    body = <p className="as-stopped">Câu trả lời này đã dừng trước khi hoàn tất.</p>;
  }
  return <li className={`as-answer as-answer-${status}`} aria-busy={pending || undefined}>
    <span className="as-avatar" aria-hidden="true"><Icon name="spark" /></span>
    <div className="as-answer-body">
      <span className="sr-only">Trợ lý trả lời: </span>
      {body}
      {status === "completed" && message.sources.length > 0 && <Sources sources={message.sources} highlighted={highlight?.n ?? null} chips={chips} />}
      {status === "completed" && <div className="as-feedback" role="group" aria-label="Đánh giá câu trả lời">
        <button type="button" className="as-rate as-rate-up" aria-pressed={message.feedback === 1} aria-label="Câu trả lời hữu ích" title="Câu trả lời hữu ích"
          onClick={() => onRate(message, 1)}><Thumb /></button>
        <button type="button" className="as-rate as-rate-down" aria-pressed={message.feedback === -1} aria-label="Câu trả lời chưa hữu ích" title="Câu trả lời chưa hữu ích"
          onClick={() => onRate(message, -1)}><Thumb down /></button>
      </div>}
      {error && <p className="as-action-error" role="alert">{error}</p>}
    </div>
  </li>;
}

/** waiting: the open conversation still loads, so whether it waits for an answer is not known yet. */
function Composer({ input, pending, waiting, sending, error, onSend }: {
  input: RefObject<HTMLTextAreaElement | null>; pending: boolean; waiting: boolean; sending: boolean; error: string; onSend: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  // The box grows with the question (up to its max-height, then it scrolls).
  useLayoutEffect(() => {
    const area = input.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
  }, [draft, input]);
  const blocked = pending || waiting || sending;
  const submit = async () => {
    if (blocked || !draft.trim()) return;
    const text = draft;
    if (await onSend(text)) setDraft((current) => (current === text ? "" : current));
    // The button was disabled while sending, which drops its focus: the box takes it, for the next question or a fix.
    input.current?.focus();
  };
  const length = draft.length;
  const hint = pending ? "Bạn có thể gửi câu hỏi tiếp theo khi trợ lý trả lời xong." : "";
  return <form className="as-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="as-composer-inner">
      {error && <p className="as-send-error" role="alert">{error}</p>}
      <div className="as-input">
        <label htmlFor="as-question" className="sr-only">Câu hỏi của bạn</label>
        <textarea id="as-question" ref={input} rows={1} value={draft} maxLength={ASSISTANT_MAX_QUESTION} placeholder="Nhập câu hỏi của bạn…"
          aria-describedby={hint ? "as-composer-hint as-composer-notes" : "as-composer-notes"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter starts a new line; an input method still composing a word keeps its Enter.
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void submit();
          }} />
        <button type="submit" className="sw-primary as-send" disabled={blocked || !draft.trim()}>
          <Icon name="arrowUp" /><span className="as-send-label">{sending ? "Đang gửi…" : "Gửi câu hỏi"}</span>
        </button>
      </div>
      {(hint || length >= COUNTER_FROM) && <div className="as-composer-meta">
        {hint && <p id="as-composer-hint">{hint}</p>}
        {length >= COUNTER_FROM && <p className={`as-counter${length >= ASSISTANT_MAX_QUESTION ? " is-full" : ""}`}>
          {length.toLocaleString("vi-VN")}/{ASSISTANT_MAX_QUESTION.toLocaleString("vi-VN")} ký tự</p>}
      </div>}
      <div id="as-composer-notes" className="as-notes">
        <p>Trợ lý AI có thể nhầm. Hãy kiểm tra lại với cố vấn học tập trước khi đăng ký học phần.</p>
        <p>Câu hỏi và câu trả lời được lưu trong tài khoản của bạn; bạn có thể xóa cuộc trò chuyện bất cứ lúc nào.</p>
      </div>
    </div>
  </form>;
}

export type AssistantViewProps = {
  threads: AssistantThread[] | null;
  listError: string;
  onReloadList: () => void;
  workerOnline: boolean;
  selectedId: string | null;
  /** The open conversation, oldest first; null while it loads. */
  messages: AssistantMessage[] | null;
  loadError: string;
  onReloadConversation: () => void;
  onSelect: (id: string | null) => void;
  onSend: (text: string) => Promise<boolean>;
  sending: boolean;
  sendError: string;
  onDelete: (id: string) => Promise<string | null>;
  onRetry: (messageId: string) => Promise<boolean>;
  retrying: string | null;
  onRate: (message: AssistantMessage, value: 1 | -1) => void;
  actionError: ActionError | null;
  announcement: Announcement;
  /** The clock of the dates in the list (tests). */
  now?: Date;
};

/** The page from its data: the list, the chat and the question box. */
export function AssistantView(props: AssistantViewProps) {
  const { threads, workerOnline, selectedId, messages, loadError, sending, actionError, announcement } = props;
  const now = props.now ?? new Date();
  const [confirming, setConfirming] = useState<string | null>(null);
  const deleteOpener = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const shownThread = useRef<string | null>(null);
  const shownCount = useRef(0);
  const pending = messages?.some((message) => message.role === "assistant" && isAnswerPending(message.status)) ?? false;

  // A conversation opens at its last question, and a new question scrolls to itself: an answer longer than the chat is
  // read from its start. While the student stays at the end, the answer being written keeps in view.
  const count = messages?.length ?? 0;
  useLayoutEffect(() => {
    const area = scroller.current;
    if (!area) return;
    if (!messages) { area.scrollTop = 0; return; }
    const jump = shownThread.current !== selectedId || count > shownCount.current;
    shownThread.current = selectedId;
    shownCount.current = count;
    if (jump) {
      const questions = area.querySelectorAll<HTMLElement>(".as-question");
      const last = questions[questions.length - 1];
      // Past the end the browser stops at the end, so a short last answer simply shows the end.
      area.scrollTop = last ? last.offsetTop - 16 : area.scrollHeight;
      atEnd.current = area.scrollHeight - area.scrollTop - area.clientHeight < 48;
    } else if (atEnd.current) {
      area.scrollTop = area.scrollHeight;
    }
  }, [messages, count, selectedId]);

  const listProps: ListProps = {
    threads, listError: props.listError, onReloadList: props.onReloadList, selectedId, confirming, now,
    onSelect: (id) => { setConfirming(null); props.onSelect(id); },
    onNew: () => { setConfirming(null); props.onSelect(null); input.current?.focus(); },
    onAskDelete: (id, opener) => { deleteOpener.current = opener; setConfirming(id); },
    onCancelDelete: () => { setConfirming(null); deleteOpener.current?.focus(); },
    onDelete: async (id) => {
      const problem = await props.onDelete(id);
      if (!problem) { setConfirming(null); input.current?.focus(); }
      return problem;
    },
  };
  const retry = (id: string) => { void props.onRetry(id).then((queued) => { if (queued) input.current?.focus(); }); };

  // The starters are disabled while a question is sent, which drops their focus: the question box takes it.
  const ask = (question: string) => { void props.onSend(question).then(() => input.current?.focus()); };

  let chat: ReactNode;
  if (selectedId === null) chat = <Welcome busy={sending} onAsk={ask} />;
  else if (messages) chat = <ol className="as-messages" aria-label="Nội dung cuộc trò chuyện">
    {messages.map((message) => message.role === "user"
      ? <li key={message.id} className="as-question"><span className="sr-only">Bạn hỏi: </span>{message.content}</li>
      : <AnswerItem key={message.id} message={message} workerOnline={workerOnline} retrying={props.retrying === message.id}
        error={actionError?.messageId === message.id ? actionError.text : null} onRetry={retry} onRate={props.onRate} />)}
  </ol>;
  else if (loadError) chat = <div className="as-state" role="alert">
    <strong>Chưa tải được cuộc trò chuyện</strong><p>{loadError}</p>
    <button type="button" className="sw-outline as-small" onClick={props.onReloadConversation}><Icon name="refresh" />Thử lại</button>
  </div>;
  else chat = <div className="as-state" role="status"><p>Đang tải cuộc trò chuyện…</p></div>;

  return <div className="as-page">
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement.text && <span key={announcement.n}>{announcement.text}</span>}</p>
    <ThreadList {...listProps} />
    <ThreadPicker {...listProps} />
    <section className="sw-panel as-chat" aria-label="Trò chuyện với Trợ lý AI">
      {!workerOnline && <div className="as-offline" role="status"><Icon name="info" /><p>{OFFLINE_NOTICE}</p></div>}
      <div ref={scroller} className="as-scroll" onScroll={(event) => {
        const area = event.currentTarget;
        atEnd.current = area.scrollHeight - area.scrollTop - area.clientHeight < 48;
      }}>{chat}</div>
      <Composer input={input} pending={pending} waiting={selectedId !== null && !messages} sending={sending} error={props.sendError} onSend={props.onSend} />
    </section>
  </div>;
}

export default function StudentAssistant() {
  return <AssistantView {...useAssistant()} />;
}
