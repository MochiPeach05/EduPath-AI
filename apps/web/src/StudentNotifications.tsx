import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./student-icons";
import { NOTIFICATIONS_API, NOTIFICATION_POLL_MS, type NotificationType, type StudentNotification } from "./notification-types";
import "./student-notifications.css";

// Thông báo (STU-PROG-04…09, 2026-10-30): the bell of the student header. The badge shows the unread count, read again
// every minute while the tab is visible and whenever the window gets focus; the bell's popover lists the latest
// notifications; "Xem tất cả thông báo" opens the drawer with every notification, filters, the detail of one and its
// actions (open the page it points to, read / unread, delete with "Hoàn tác"). Notifications live only here (user,
// 2026-10-30: "thông báo xóa đi vì mình có cái icon chuông cái đó là thông báo rồi mà"). Contract: notification-types.ts.

export type NotificationFilter = "all" | "unread" | NotificationType;

/** The drawer's filter chips, in the order of the approved preview. */
export const NOTIFICATION_FILTERS: readonly { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "Tất cả" }, { id: "unread", label: "Chưa đọc" }, { id: "warn", label: "Cảnh báo" },
  { id: "ai", label: "Kết quả AI" }, { id: "khoa", label: "Từ Khoa" }, { id: "sys", label: "Hệ thống" },
];
/** The icon letters and the label of each type: AI, ! (warning), K (Khoa), i (system). */
export const NOTIFICATION_TYPES: Record<NotificationType, { glyph: string; label: string }> = {
  ai: { glyph: "AI", label: "Kết quả AI" }, warn: { glyph: "!", label: "Cảnh báo" }, khoa: { glyph: "K", label: "Từ Khoa" }, sys: { glyph: "i", label: "Hệ thống" },
};
/** Notifications in the bell's popover, and in the drawer. */
export const POPOVER_LIMIT = 5;
export const LIST_LIMIT = 50;
/** How long "Hoàn tác" is offered after a delete. */
export const UNDO_MS = 10_000;
/** After the student opens a page, the bell counts again this much later (the page may have written notifications). */
export const NOTIFICATION_RECOUNT_MS = 4_000;

/* ------------------------------------------------------------------ requests */

export class NotificationRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = "NotificationRequestError"; }
}
const failures: Record<string, string> = {
  not_found: "Thông báo này không còn nữa.",
  database_required: "Thông báo đang tạm ngưng. Vui lòng thử lại sau.",
  account_unavailable: "Tài khoản của bạn đang bị tạm khóa.",
};
/** The Vietnamese message of a failed request. */
export function notificationErrorText(error: unknown): string {
  if (error instanceof NotificationRequestError) return failures[error.code] ?? "Chưa thực hiện được. Vui lòng thử lại.";
  return "Không kết nối được máy chủ. Vui lòng thử lại.";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${NOTIFICATIONS_API}${path}`, {
    credentials: "include", cache: "no-store", ...init,
    headers: init.body === undefined ? init.headers : { "Content-Type": "application/json", ...init.headers },
  });
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new NotificationRequestError(body.error ?? "request_failed", response.status);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const one = (id: string) => `/${encodeURIComponent(id)}`;
export const notificationsApi = {
  /** order "unread" lists the unread ones first (the popover), else newest first. */
  list: (filter: NotificationFilter, limit: number, signal?: AbortSignal, order: "newest" | "unread" = "newest") =>
    request<{ items: StudentNotification[]; unread: number }>(`?filter=${filter}&limit=${limit}${order === "unread" ? "&order=unread" : ""}`, { signal }),
  unreadCount: (signal?: AbortSignal) => request<{ unread: number }>("/unread-count", { signal }),
  read: (id: string) => request<{ notification: StudentNotification }>(`${one(id)}/read`, { method: "POST", body: "{}" }),
  unread: (id: string) => request<{ notification: StudentNotification }>(`${one(id)}/unread`, { method: "POST", body: "{}" }),
  readAll: () => request<{ unread: number }>("/read-all", { method: "POST", body: "{}" }),
  remove: (id: string) => request<void>(one(id), { method: "DELETE" }),
  restore: (id: string) => request<{ notification: StudentNotification }>(`${one(id)}/restore`, { method: "POST", body: "{}" }),
};

/* ------------------------------------------------------------------ text */

/** The bell's accessible name: "Thông báo, 3 chưa đọc". */
export const bellLabel = (unread: number) => (unread > 0 ? `Thông báo, ${unread} chưa đọc` : "Thông báo");
/** The badge on the bell: the count, "99+" past 99. */
export const badgeText = (unread: number) => (unread > 99 ? "99+" : String(unread));
/** The first line of a notification's text, shown under its title so two notifications of one kind never look alike. */
export const notificationExcerpt = (body: string) => body.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
/** Under the popover's list when it cannot show every unread notification: "Còn 2 thông báo chưa đọc khác". */
export function moreUnreadText(unread: number, items: readonly StudentNotification[]): string | null {
  const more = unread - items.filter((item) => !item.read).length;
  return more > 0 ? `Còn ${more} thông báo chưa đọc khác` : null;
}
/** A page of the portal ("#roadmap") a notification may open; anything else is not followed. */
export const portalLink = (link: string | null) => (link && /^#[a-z][a-z-]*$/.test(link) ? link : null);

const VIETNAM = "Asia/Ho_Chi_Minh";
const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: VIETNAM, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
/** When a notification came, as people say it: "Vừa xong", "10 phút trước", "3 giờ trước", "Hôm qua", "28/10/2026". */
export function notificationTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  if (minutes < 24 * 60 && dayKey(at) === dayKey(now)) return `${Math.floor(minutes / 60)} giờ trước`;
  if (dayKey(at) === dayKey(new Date(now.getTime() - 86_400_000))) return "Hôm qua";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: VIETNAM, day: "2-digit", month: "2-digit", year: "numeric" }).format(at);
}
/** "7 thông báo · 3 chưa đọc" under the drawer's title, about the list the filter shows (the latest LIST_LIMIT at most). */
export function drawerSummary(items: readonly StudentNotification[]): string {
  const unread = items.filter((item) => !item.read).length;
  const total = items.length >= LIST_LIMIT ? `${LIST_LIMIT} thông báo mới nhất` : `${items.length} thông báo`;
  return `${total}${unread > 0 ? ` · ${unread} chưa đọc` : items.length > 0 ? " · đã đọc hết" : ""}`;
}

/* ------------------------------------------------------------------ unread count */

/**
 * The unread count of the bell: read when the page opens, every NOTIFICATION_POLL_MS while the tab is visible (paused
 * while it is hidden), when the tab comes back and when the window gets focus. setUnread takes a count a list just read.
 */
/** enabled: false in a cố vấn học tập's tab (advisor-view.ts), where the bell is hidden and the API refuses it. */
export function useUnreadNotifications(enabled = true) {
  const [unread, setUnread] = useState(0);
  const latest = useRef(0);
  const refresh = useCallback(() => {
    if (!enabled) return;
    const ticket = ++latest.current;
    notificationsApi.unreadCount().then(({ unread: count }) => { if (ticket === latest.current) setUnread(count); }, () => undefined);
  }, [enabled]);
  const take = useCallback((count: number) => { latest.current += 1; setUnread(count); }, []);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
    const start = () => { stop(); timer = setInterval(refresh, NOTIFICATION_POLL_MS); };
    const visible = () => document.visibilityState !== "hidden";
    const onVisibility = () => { if (visible()) { refresh(); start(); } else stop(); };
    if (visible()) { refresh(); start(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("focus", refresh); };
  }, [refresh, enabled]);
  return { unread, refresh, setUnread: take };
}

/* ------------------------------------------------------------------ views */

/** One notification in a list: its type icon, title, the first line of its text, type and time, and a dot while unread. */
export function NotificationItem({ notification, now, current = false, onSelect }: {
  notification: StudentNotification; now: Date; current?: boolean; onSelect: () => void;
}) {
  const type = NOTIFICATION_TYPES[notification.type];
  const excerpt = notificationExcerpt(notification.body);
  return <button type="button" className={`nt-item nt-${notification.type}${notification.read ? "" : " nt-unread"}`} aria-current={current ? "true" : undefined} onClick={onSelect}>
    <span className="nt-icon" aria-hidden="true">{type.glyph}</span>
    <span className="nt-text">
      <strong>{notification.title}</strong>
      {excerpt && <span className="nt-excerpt">{excerpt}</span>}
      <small>{type.label} · {notificationTime(notification.createdAt, now)}{notification.read ? "" : " · chưa đọc"}</small>
    </span>
    <span className="nt-dot" aria-hidden="true" />
  </button>;
}

/** The detail of one notification and its actions; busy disables them while one runs. */
export function NotificationDetail({ notification, now, busy, error, onBack, onOpenLink, onToggleRead, onDelete }: {
  notification: StudentNotification; now: Date; busy: boolean; error: string;
  onBack: () => void; onOpenLink: (link: string) => void; onToggleRead: () => void; onDelete: () => void;
}) {
  const type = NOTIFICATION_TYPES[notification.type];
  const link = portalLink(notification.link);
  return <article className="nt-detail" aria-labelledby="nt-detail-title">
    <button type="button" className="sw-text-link nt-back" onClick={onBack}>‹ Quay lại danh sách</button>
    <span className={`nt-chip nt-chip-${notification.type}`}>{type.label} · {notificationTime(notification.createdAt, now)}</span>
    <h3 id="nt-detail-title">{notification.title}</h3>
    <p className="nt-body">{notification.body}</p>
    <div className="nt-actions">
      {link && <button type="button" className="sw-primary" onClick={() => onOpenLink(link)}>{notification.linkLabel || "Mở trang liên quan"}</button>}
      <button type="button" className="sw-outline" disabled={busy} onClick={onToggleRead}>{notification.read ? "Đánh dấu chưa đọc" : "Đánh dấu đã đọc"}</button>
      <button type="button" className="sw-outline" disabled={busy} onClick={onDelete}><Icon name="trash" />Xóa</button>
    </div>
    {error && <p className="nt-error" role="alert">{error}</p>}
    <p className="nt-note">Thông báo tự xóa sau 90 ngày.</p>
  </article>;
}

/**
 * The bell's popover: the latest notifications, the unread ones first so it shows what the badge counts (user review
 * 2026-10-30: "huy hiệu báo 5 chưa đọc … chỉ 1 mục được đánh dấu chưa đọc"); when more are unread than it can show, a
 * link opens the drawer on "Chưa đọc". Then "Xem tất cả thông báo" and "Đánh dấu tất cả đã đọc". Its heading keeps the id
 * the header's popover is labelled by. onUnread receives every unread count it learns.
 */
export function NotificationsPanel({ onOpen, onOpenAll, onUnread }: {
  onOpen: (notification: StudentNotification) => void; onOpenAll: (filter?: NotificationFilter) => void; onUnread: (count: number) => void;
}) {
  const [items, setItems] = useState<StudentNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const report = useRef(onUnread);
  report.current = onUnread;
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    notificationsApi.list("all", POPOVER_LIMIT, controller.signal, "unread").then((data) => {
      if (controller.signal.aborted) return;
      setItems(data.items); setUnread(data.unread); report.current(data.unread);
    }, (failure: unknown) => { if (!controller.signal.aborted) setError(notificationErrorText(failure)); });
    return () => controller.abort();
  }, [revision]);
  const readAll = async () => {
    setBusy(true); setError("");
    try {
      await notificationsApi.readAll();
      setItems((current) => current?.map((item) => ({ ...item, read: true })) ?? null);
      setUnread(0); report.current(0);
    } catch (failure) { setError(notificationErrorText(failure)); }
    finally { setBusy(false); }
  };
  const now = new Date();
  const more = items ? moreUnreadText(unread, items) : null;
  return <div className="nt-panel">
    <h3 id="student-notifications-title">Thông báo{unread > 0 && <span className="nt-count">{unread} chưa đọc</span>}</h3>
    {error ? <div className="nt-state" role="alert"><p>{error}</p><button type="button" className="sw-outline" onClick={() => setRevision((n) => n + 1)}><Icon name="refresh" />Thử lại</button></div>
      : items === null ? <p className="nt-state" role="status">Đang tải thông báo…</p>
        : items.length === 0 ? <p className="nt-state">Chưa có thông báo nào. Khi AI làm xong một việc cho bạn hoặc Khoa gửi thông báo, bạn sẽ thấy ở đây.</p>
          : <ul className="nt-list">{items.map((item) => <li key={item.id}><NotificationItem notification={item} now={now} onSelect={() => onOpen(item)} /></li>)}</ul>}
    {more && <button type="button" className="sw-text-link nt-more" onClick={() => onOpenAll("unread")}>{more} <Icon name="arrow" /></button>}
    <div className="nt-panel-actions">
      <button type="button" className="sw-text-link" onClick={() => onOpenAll()}>Xem tất cả thông báo <Icon name="arrow" /></button>
      {unread > 0 && <button type="button" className="sw-text-link nt-quiet" disabled={busy} onClick={() => void readAll()}>Đánh dấu tất cả đã đọc</button>}
    </div>
  </div>;
}

/**
 * Every notification (a modal dialog: focus stays inside, Escape closes): filters, the list, and the detail of the one
 * opened (initial: the one picked in the popover; initialFilter: "unread" from the popover's "Còn … chưa đọc khác"). Opening
 * a notification marks it read. Phones show the list, then the detail with "‹ Quay lại danh sách".
 */
export function NotificationsDrawer({ initial, initialFilter = "all", onClose, onNavigate, onUnread }: {
  initial: StudentNotification | null; initialFilter?: NotificationFilter; onClose: () => void; onNavigate: (link: string) => void; onUnread: (count: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open && typeof element.showModal === "function") element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  const [filter, setFilter] = useState<NotificationFilter>(initialFilter);
  const [items, setItems] = useState<StudentNotification[] | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState<StudentNotification | null>(initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [undo, setUndo] = useState<{ notification: StudentNotification; index: number } | null>(null);
  const report = useRef(onUnread);
  report.current = onUnread;
  const count = (next: number) => { setUnread(next); report.current(next); };
  // After a change the server says how many are unread: a list read meanwhile may already hold the change.
  const sync = () => { notificationsApi.unreadCount().then(({ unread: next }) => count(next), () => undefined); };

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setItems(null);
    notificationsApi.list(filter, LIST_LIMIT, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setItems(data.items); count(data.unread);
    }, (failure: unknown) => { if (!controller.signal.aborted) setError(notificationErrorText(failure)); });
    return () => controller.abort();
  }, [filter, revision]);

  // "Hoàn tác" goes after UNDO_MS.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const replace = (next: StudentNotification) => {
    setItems((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null);
    setOpen((current) => (current?.id === next.id ? next : current));
  };
  const markRead = async (notification: StudentNotification) => {
    if (notification.read) return;
    try {
      const { notification: next } = await notificationsApi.read(notification.id);
      replace(next);
      sync();
    } catch (failure) { setActionError(notificationErrorText(failure)); }
  };
  // The notification picked in the popover is read as soon as the drawer shows it.
  useEffect(() => { if (initial) void markRead(initial); }, []);

  const select = (notification: StudentNotification) => { setActionError(""); setOpen(notification); void markRead(notification); };
  const toggleRead = async () => {
    if (!open) return;
    setBusy(true); setActionError("");
    try {
      const { notification } = open.read ? await notificationsApi.unread(open.id) : await notificationsApi.read(open.id);
      replace(notification);
      sync();
    } catch (failure) { setActionError(notificationErrorText(failure)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!open) return;
    const gone = open;
    setBusy(true); setActionError("");
    try {
      await notificationsApi.remove(gone.id);
      const index = items?.findIndex((item) => item.id === gone.id) ?? -1;
      setItems((current) => current?.filter((item) => item.id !== gone.id) ?? null);
      setOpen(null);
      if (!gone.read) sync();
      setUndo({ notification: gone, index });
    } catch (failure) { setActionError(notificationErrorText(failure)); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!undo) return;
    const { notification: gone, index } = undo;
    setUndo(null);
    try {
      const { notification } = await notificationsApi.restore(gone.id);
      setItems((current) => {
        if (!current || current.some((item) => item.id === notification.id)) return current;
        const next = [...current];
        next.splice(index < 0 ? 0 : Math.min(index, next.length), 0, notification);
        return next;
      });
      if (!notification.read) sync();
    } catch (failure) { setActionError(notificationErrorText(failure)); }
  };
  const readAll = async () => {
    setBusy(true); setActionError("");
    try {
      await notificationsApi.readAll();
      setItems((current) => current?.map((item) => ({ ...item, read: true })) ?? null);
      setOpen((current) => (current ? { ...current, read: true } : current));
      count(0);
      if (filter === "unread") setRevision((n) => n + 1);
    } catch (failure) { setActionError(notificationErrorText(failure)); }
    finally { setBusy(false); }
  };

  const now = new Date();
  const shown = items ?? [];
  // A click on the backdrop (the dialog itself, outside its content) closes it like Escape.
  return <dialog ref={dialog} className="nt-drawer" aria-labelledby="nt-drawer-title" onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="nt-drawer-head">
      <div className="nt-head-text">
        <h2 id="nt-drawer-title">Tất cả thông báo</h2>
        <p className="nt-sub">{items === null ? "Đang tải…" : drawerSummary(shown)}</p>
      </div>
      {(unread ?? 0) > 0 && <button type="button" className="sw-outline nt-read-all" disabled={busy} onClick={() => void readAll()}><Icon name="check" />Đánh dấu tất cả đã đọc</button>}
      <button type="button" className="sw-icon-button nt-close" onClick={onClose} aria-label="Đóng thông báo" title="Đóng"><Icon name="close" /></button>
    </header>
    <div className="nt-filters" role="group" aria-label="Lọc thông báo">
      {NOTIFICATION_FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); }}>{item.label}</button>)}
    </div>
    <div className={`nt-drawer-body${open ? " nt-has-detail" : ""}`}>
      <div className="nt-list-pane">
        {error ? <div className="nt-state" role="alert"><p>{error}</p><button type="button" className="sw-outline" onClick={() => setRevision((n) => n + 1)}><Icon name="refresh" />Thử lại</button></div>
          : items === null ? <p className="nt-state" role="status">Đang tải thông báo…</p>
            : shown.length === 0 ? <p className="nt-state">{filter === "all" ? "Chưa có thông báo nào." : filter === "unread" ? "Bạn đã đọc hết thông báo." : "Không có thông báo nào thuộc loại này."}</p>
              : <ul className="nt-list">{shown.map((item) => <li key={item.id}><NotificationItem notification={item} now={now} current={open?.id === item.id} onSelect={() => select(item)} /></li>)}</ul>}
      </div>
      <div className="nt-detail-pane">
        {open ? <NotificationDetail notification={open} now={now} busy={busy} error={actionError} onBack={() => setOpen(null)}
          onOpenLink={onNavigate} onToggleRead={() => void toggleRead()} onDelete={() => void remove()} />
          : <p className="nt-state">Chọn một thông báo để xem chi tiết.</p>}
      </div>
    </div>
    {undo && <div className="nt-toast" role="status"><span>Đã xóa thông báo.</span><button type="button" onClick={() => void restore()}>Hoàn tác</button></div>}
  </dialog>;
}
