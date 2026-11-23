import { useEffect, useState, type ReactNode } from "react";
import { ActionMenu, Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { CheckedForm } from "./CheckedForm";
import { majorOptions } from "./majors";
import { sortRows, useTableSort, type SortRule } from "./table-sort";
import {
  ANNOUNCEMENTS_API, ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, type Announcement, type AnnouncementEmail, type AnnouncementTarget, type AutoMailState,
  type EmailProblem, type EmailStats, type MailSender, type NotificationSetting,
} from "./notification-types";
import { SESSION_EXPIRED_EVENT, adminErrorText } from "./admin-errors";
import { formatVnDateTime } from "./display-format";
import "./curricula.css";
import "./careers.css";
import "./announcements.css";

// Quản lý thông báo (AD-NOTI-01…06): the faculty writes an announcement to cohorts and majors (none chosen: every student)
// and it shows at once in the bell of those students; "Đã gửi" counts who has read each one and withdraws one from every
// bell. Since 2026-11-23 an announcement may also go by email (AD-NOTI-04; user: "Làm cả 04, 05, 06", "Chỉ sinh viên đã có
// tài khoản", "Dùng mặc định"): from the sender's own school mailbox, once they allowed EduPath AI on Microsoft's page, one
// message per student and about 25 a minute; "Đã gửi" shows how many went out and sends the failed ones again (AD-NOTI-05),
// and "Cài đặt thông báo" turns the kinds of automatic notifications off and on (AD-NOTI-06). Contract: notification-types.ts.

export const COMPOSE_PATH = "/quantri/gui-thong-bao";
export const SENT_PATH = "/quantri/thong-bao-da-gui";
export const SETTINGS_PATH = "/quantri/cai-dat-thong-bao";

/** The choices of "Gửi đến": cohorts and the faculty's majors (programme codes of the MSSV, as student profiles hold them). */
export type AnnouncementOptions = { cohorts: string[]; majors: { code: string; name: string }[] };
/** Used until GET /options answers (or when it does not exist). */
export const FALLBACK_OPTIONS: AnnouncementOptions = {
  cohorts: ["K26", "K27", "K28", "K29", "K30", "K31", "K32"],
  majors: majorOptions.map((major) => ({ ...major })),
};
/** The student pages a notification can open, named as the student portal names them. */
export const PORTAL_PAGES: readonly { link: string; label: string }[] = [
  { link: "#overview", label: "Tổng quan" }, { link: "#profile", label: "Hồ sơ và bảng điểm" },
  { link: "#competency", label: "Đánh giá năng lực" }, { link: "#skill-gap", label: "Khoảng trống kỹ năng" },
  { link: "#career", label: "Định hướng nghề nghiệp" }, { link: "#roadmap", label: "Lộ trình học tập" },
  { link: "#curriculum", label: "Chương trình đào tạo" }, { link: "#plans", label: "Kế hoạch đào tạo" },
  { link: "#graduation", label: "Xét tốt nghiệp" }, { link: "#assistant", label: "Trợ lý AI" },
];
/** The server sends 6 messages every 15 seconds (apps/api/src/mail/worker.ts); the pages say "khoảng 25 thư mỗi phút". */
export const EMAILS_PER_MINUTE = 24;

/* ------------------------------------------------------------------ requests */

const failures: Record<string, string> = {
  invalid_input: "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.",
  title_required: "Vui lòng nhập tiêu đề.",
  body_required: "Vui lòng nhập nội dung.",
  no_recipients: "Không có sinh viên nào thuộc nhóm đã chọn.",
  not_found: "Thông báo này không còn nữa.",
  already_withdrawn: "Thông báo này đã được thu hồi trước đó.",
  database_required: "Hệ thống chưa kết nối cơ sở dữ liệu. Vui lòng thử lại sau.",
  forbidden: "Bạn không có quyền thực hiện thao tác này.",
  insufficient_role: "Bạn không còn quyền thực hiện thao tác này.",
  invalid_origin: "Yêu cầu không hợp lệ. Vui lòng tải lại trang.",
  mail_unavailable: "Máy chủ chưa bật chức năng gửi email.",
  mail_grant_required: "Bạn cần cho phép EduPath AI gửi thư từ hộp thư trường của mình trước (nút “Cho phép gửi từ hộp thư của tôi” ở trang Gửi thông báo).",
  send_failed: "Microsoft không gửi được thư. Vui lòng thử lại sau.",
  bell_off: "Hãy bật thông báo này trước khi bật email.",
  bell_locked: "Thông báo việc làm thay sinh viên luôn hiện trong chuông của sinh viên.",
};
/** Microsoft's own code when it is a plain one, shown so the team can look it up; null otherwise. */
export const plainCode = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null);
const withCode = (text: string, code: string | null) => (code ? `${text} Mã lỗi: ${code}.` : text);
export class AnnouncementRequestError extends Error {
  // A code without a text of this page is worded by its status (admin-errors.ts; status 0: no answer).
  constructor(readonly code: string, readonly status: number, readonly detail: string | null = null) {
    super(withCode(adminErrorText(status, { error: code }, failures), detail));
    this.name = "AnnouncementRequestError";
  }
}
async function announcementRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ANNOUNCEMENTS_API}${path}`, {
      credentials: "include", cache: "no-store", ...init,
      headers: init.body === undefined ? init.headers : { "Content-Type": "application/json", ...init.headers },
    });
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === "AbortError") throw error;
    throw new AnnouncementRequestError("network", 0);
  }
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: unknown };
    throw new AnnouncementRequestError(body.error ?? (response.status === 403 ? "forbidden" : "request_failed"), response.status, plainCode(body.code));
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

/* ------------------------------------------------------------------ text */

/** The query of GET /reach: the chosen cohorts and majors, comma-separated; empty for every student. */
export function reachQuery(target: AnnouncementTarget): string {
  const params = new URLSearchParams();
  if (target.cohorts.length) params.set("cohorts", target.cohorts.join(","));
  if (target.majors.length) params.set("majors", target.majors.join(","));
  return params.toString();
}
/** The list with the value added, or without it when it was there. */
export const toggleValue = (list: readonly string[], value: string): string[] => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
/**
 * A major as "Gửi đến" names it: by the name GET /options gives it, else the faculty's own name for it, else
 * "Ngành khác (mã 7340201)" as the API names a programme outside the faculty's catalog — never the bare code (2026-11-04 QA).
 */
export function majorText(code: string, options: AnnouncementOptions): string {
  const named = (list: readonly { code: string; name: string }[]) => list.find((major) => major.code === code)?.name.trim();
  return named(options.majors) || named(majorOptions) || `Ngành khác (mã ${code})`;
}
/** Who receives it: "Tất cả sinh viên", "K29, K30", "Công nghệ thông tin" or "K29 · Công nghệ thông tin". */
export function targetText(target: AnnouncementTarget, options: AnnouncementOptions): string {
  const majors = target.majors.map((code) => majorText(code, options));
  const parts = [target.cohorts.join(", "), majors.join(", ")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Tất cả sinh viên";
}
const number = (value: number) => value.toLocaleString("vi-VN");
/** "204/312": students who read it out of those who received it. */
export const readText = (announcement: Pick<Announcement, "read" | "recipients">) => `${number(announcement.read)}/${number(announcement.recipients)}`;
/** The share read, 0–100, for the small bar beside it. */
export const readShare = (announcement: Pick<Announcement, "read" | "recipients">) =>
  (announcement.recipients > 0 ? Math.min(100, Math.round((announcement.read / announcement.recipients) * 100)) : 0);
/** "08:30 28/10/2026" in Vietnam time, as the other admin pages print a time. */
export function sentTime(iso: string): string {
  return formatVnDateTime(iso, "");
}
/** The name of the page a link opens ("Lộ trình học tập"); null for none or an unknown one. */
export const pageLabel = (link: string | null) => PORTAL_PAGES.find((page) => page.link === link)?.label ?? null;
/** The button the student sees for a page: "Mở Lộ trình học tập"; null without one. */
export const openLabel = (link: string | null) => (link ? `Mở ${pageLabel(link) ?? "trang liên quan"}` : null);
/** "Khoảng 312 sinh viên nhận được thông báo này." and its state. */
export function reachText(count: number | null, failed: boolean): { text: string; tone: "muted" | "warn" | "ok" } {
  if (failed) return { text: "Chưa tính được số sinh viên nhận. Bạn vẫn gửi được; hệ thống sẽ đếm lại khi gửi.", tone: "muted" };
  if (count === null) return { text: "Đang đếm số sinh viên nhận…", tone: "muted" };
  if (count === 0) return { text: "Không có sinh viên nào thuộc nhóm đã chọn. Hãy chọn khóa hoặc ngành khác.", tone: "warn" };
  return { text: `Khoảng ${number(count)} sinh viên nhận được thông báo này.`, tone: "ok" };
}
/** How many of them also get the email: "300 sinh viên nhận thêm email; 12 sinh viên chưa có địa chỉ email nên chỉ nhận ở chuông." */
export function emailReachText(count: number | null, withEmail: number | null): string | null {
  if (count === null || withEmail === null || count === 0) return null;
  const missing = Math.max(0, count - withEmail);
  const head = `${number(withEmail)} sinh viên nhận thêm email`;
  return missing ? `${head}; ${number(missing)} sinh viên chưa có địa chỉ email nên chỉ nhận ở chuông.` : `${head}.`;
}
/** Minutes the server needs for n messages. */
export const emailMinutes = (n: number) => Math.max(1, Math.ceil(n / EMAILS_PER_MINUTE));
/** The students an email can reach: every message except those of accounts without an address. */
const deliverable = (email: AnnouncementEmail) => Math.max(0, email.total - email.noAddress);
/** "298/300" sent of those with an address, the share for the bar, and what else to say ("Đang gửi 2", "1 lỗi"…). */
export function emailSummary(email: AnnouncementEmail): { sent: string; share: number; notes: string[]; trouble: boolean } {
  const total = deliverable(email);
  const notes = [
    email.pending ? `Đang gửi ${number(email.pending)}` : "",
    email.failed ? `${number(email.failed)} lỗi` : "",
    email.noAddress ? `${number(email.noAddress)} chưa có email` : "",
    email.cancelled ? `${number(email.cancelled)} đã hủy` : "",
  ].filter(Boolean);
  return { sent: `${number(email.sent)}/${number(total)}`, share: total ? Math.min(100, Math.round((email.sent / total) * 100)) : 0, notes, trouble: email.failed > 0 };
}
/** Why a message did not go out, in words; Microsoft's own code when there is no better text. */
export function emailErrorText(status: EmailProblem["status"], code: string | null): string {
  if (status === "no_address") return "Tài khoản chưa có địa chỉ email";
  switch (code) {
    case "grant_required": return "Quyền gửi thư từ hộp thư của người gửi đã hết hạn hoặc bị thu hồi";
    case "sender_missing": return "Tài khoản người gửi không còn";
    case "ErrorInvalidRecipients": case "ErrorInvalidRecipient": case "ErrorRecipientNotFound": return "Địa chỉ email không nhận được thư";
    case "ErrorTooManyRequests": case "ApplicationThrottled": case "MailboxConcurrency": case "http_429": return "Microsoft giới hạn số thư gửi; đã thử lại nhiều lần";
    case "network_error": return "Không kết nối được Microsoft; đã thử lại nhiều lần";
    case "token_failed": return "Không lấy được quyền gửi thư từ Microsoft";
    default: {
      const safe = plainCode(code);
      if (safe && /^http_5\d\d$/.test(safe)) return "Máy chủ Microsoft gặp lỗi; đã thử lại nhiều lần";
      return safe ? `Microsoft không gửi được thư (mã ${safe})` : "Microsoft không gửi được thư";
    }
  }
}

/* ------------------------------------------------------------------ pages */

export default function AnnouncementsManagement({ canManage, section, navigate }: {
  canManage: boolean; section: "compose" | "sent" | "settings"; navigate?: (path: string) => void;
}) {
  if (section === "compose") return <ComposeAnnouncement canManage={canManage} navigate={navigate} />;
  if (section === "sent") return <SentAnnouncements canManage={canManage} navigate={navigate} />;
  return <NotificationSettings canManage={canManage} />;
}

/** The choices of "Gửi đến": GET /options, else FALLBACK_OPTIONS. */
function useAnnouncementOptions(): AnnouncementOptions {
  const [options, setOptions] = useState<AnnouncementOptions>(FALLBACK_OPTIONS);
  useEffect(() => {
    const controller = new AbortController();
    announcementRequest<Partial<AnnouncementOptions>>("/options", { signal: controller.signal }).then((data) => {
      const cohorts = Array.isArray(data.cohorts) ? data.cohorts.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
      const majors = Array.isArray(data.majors) ? data.majors.filter((item) => typeof item?.code === "string" && typeof item?.name === "string")
        // A name that is empty or only the code is shown as majorText names it.
        .map((item) => (item.name.trim() && item.name.trim() !== item.code.trim() ? item : { code: item.code, name: majorText(item.code, FALLBACK_OPTIONS) })) : [];
      if (!controller.signal.aborted && (cohorts.length || majors.length)) setOptions({ cohorts: cohorts.length ? cohorts : FALLBACK_OPTIONS.cohorts, majors: majors.length ? majors : FALLBACK_OPTIONS.majors });
    }, () => undefined);
    return () => controller.abort();
  }, []);
  return options;
}

/** The student's view of the announcement while it is written. */
export function AnnouncementPreview({ title, body, link, email = false }: { title: string; body: string; link: string | null; email?: boolean }) {
  const button = openLabel(link);
  return <aside className="cm-panel an-preview" aria-labelledby="an-preview-title">
    <h2 id="an-preview-title">Sinh viên sẽ thấy</h2>
    <div className="an-note-row">
      <span className="an-note-icon" aria-hidden="true">K</span>
      <span className="an-note-text"><strong>{title.trim() || "Tiêu đề thông báo"}</strong><small>Từ Khoa · Vừa xong · chưa đọc</small></span>
      <span className="an-note-dot" aria-hidden="true" />
    </div>
    <p className="an-preview-body">{body.trim() || "Nội dung sẽ hiện ở đây khi sinh viên mở thông báo."}</p>
    {button && <span className="an-preview-button">{button}</span>}
    <p className="an-preview-note">Sinh viên thấy thông báo ở chuông trên thanh đầu trang, lọc được theo "Từ Khoa", đánh dấu đã đọc hoặc xóa. Thông báo tự xóa sau 90 ngày.</p>
    {email && <p className="an-preview-note an-preview-email"><Icon name="mail" /><span>Email gửi kèm có tiêu đề “[EduPath AI] {title.trim() || "Tiêu đề thông báo"}”, cùng nội dung và nút mở EduPath AI.</span></p>}
  </aside>;
}

/** Where the member allows EduPath AI to send from their mailbox (auth/router.ts): the address of Microsoft's consent page. */
export const MAIL_CONSENT_API = "/api/auth/microsoft/mail-consent";

/**
 * What Microsoft's page came back with (?emailTest=…&code=…), as the page says it; null for any other address. The code is
 * Microsoft's or Graph's own, shown so the team can look it up. "sent": the permission is kept and a test message went to
 * the member's own mailbox.
 */
export function emailTestOutcome(search: string): { ok: boolean; text: string } | null {
  const params = new URLSearchParams(search);
  const raw = plainCode(params.get("code"));
  const code = raw ? ` (mã ${raw})` : "";
  switch (params.get("emailTest")) {
    case "sent": return { ok: true, text: "Đã cho phép EduPath AI gửi thư từ hộp thư trường của bạn và đã gửi một thư thử đến chính bạn. Mở Outlook để kiểm tra; thư có thể đến sau 1–2 phút, nếu chưa thấy hãy xem cả mục Email rác. Giờ bạn có thể chọn gửi thông báo qua email." };
    case "denied": return { ok: false, text: `Microsoft chưa cấp quyền gửi thư${code}. Nếu trang Microsoft báo cần quản trị viên phê duyệt thì trường đang chặn quyền này và cần bộ phận IT của trường cấp quyền. Nếu bạn chỉ bấm Hủy, hãy thử lại và chọn Chấp nhận.` };
    case "other_account": return { ok: false, text: "Bạn đã chọn một tài khoản Microsoft khác tài khoản đang đăng nhập EduPath AI nên chưa có thư nào được gửi. Hãy thử lại và chọn đúng tài khoản trường của bạn." };
    case "send_failed": return { ok: false, text: `Microsoft đã cấp quyền nhưng không gửi được thư thử${code}. Tài khoản này có thể chưa có hộp thư Outlook của trường.` };
    case "expired": return { ok: false, text: "Yêu cầu bị hủy vì để quá 10 phút ở trang Microsoft. Hãy bấm cho phép một lần nữa." };
    case "signed_out": return { ok: false, text: "Phiên đăng nhập EduPath AI đã hết trong lúc ở trang Microsoft nên chưa gửi thư. Hãy đăng nhập lại rồi thử lại." };
    case "failed": return raw === "grant_not_saved"
      ? { ok: false, text: "Microsoft đã cấp quyền nhưng EduPath AI chưa lưu được quyền này. Hãy thử lại." }
      : { ok: false, text: `Chưa xin được quyền gửi thư của Microsoft${code}. Hãy thử lại.` };
    default: return null;
  }
}

/** What Microsoft's page came back with, once (?emailTest=…), taken out of the address so a reload does not repeat it. */
function useEmailTestOutcome() {
  const [outcome] = useState(() => (typeof window === "undefined" ? null : emailTestOutcome(window.location.search)));
  useEffect(() => {
    if (!outcome) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("emailTest");
    url.searchParams.delete("code");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [outcome]);
  return outcome;
}
function EmailTestBanner({ outcome }: { outcome: { ok: boolean; text: string } | null }) {
  if (!outcome) return null;
  return outcome.ok
    ? <div className="an-success" role="status"><Icon name="check" /><p>{outcome.text}</p></div>
    : <p className="admin-error" role="alert">{outcome.text}</p>;
}

const MAIL_CONSENT_ERRORS: Readonly<Record<string, string>> = {
  insufficient_role: "Tài khoản của bạn không gửi được thông báo.",
  mail_unavailable: "Máy chủ chưa bật chức năng gửi email.",
};

/**
 * Opens Microsoft's page where the member allows EduPath AI to send from their mailbox, coming back to `page` (Gửi thông
 * báo or Cài đặt thông báo); the error's text when it cannot.
 */
async function openMailConsent(page: "compose" | "settings" = "compose"): Promise<string> {
  try {
    const response = await fetch(MAIL_CONSENT_API, {
      method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page }),
    });
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const body = await response.json().catch(() => ({})) as { url?: unknown };
    if (!response.ok || typeof body.url !== "string") return adminErrorText(response.status, body, MAIL_CONSENT_ERRORS);
    window.location.assign(body.url);
    return "";
  } catch {
    return "Không mở được trang Microsoft. Vui lòng thử lại.";
  }
}

/** The member's permission to send email, as GET /mail-sender says it. */
export type MailSenderView = { loading: boolean; failed: boolean; available: boolean; sender: MailSender | null; reload: () => void };
function useMailSender(): MailSenderView {
  const [state, setState] = useState<Omit<MailSenderView, "reload">>({ loading: true, failed: false, available: false, sender: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, failed: false }));
    announcementRequest<{ available?: unknown; sender?: MailSender | null }>("/mail-sender", { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      const sender = data.sender && typeof data.sender.address === "string" ? data.sender : null;
      setState({ loading: false, failed: false, available: data.available === true, sender });
    }, () => { if (!controller.signal.aborted) setState({ loading: false, failed: true, available: false, sender: null }); });
    return () => controller.abort();
  }, [revision]);
  return { ...state, reload: () => setRevision((n) => n + 1) };
}

/**
 * Kênh gửi: email trường của sinh viên (AD-NOTI-04). Usable once the member allowed EduPath AI on Microsoft's page; the
 * test message goes to the member's own mailbox only (the draft, when it has a title and a text).
 */
export function EmailChannel({ mail, checked, onCheck, draft, reach }: {
  mail: MailSenderView; checked: boolean; onCheck: (on: boolean) => void; draft: { title: string; body: string; link: string | null }; reach: string | null;
}) {
  const [busy, setBusy] = useState<"consent" | "test" | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const sender = mail.sender;
  const usable = Boolean(sender && !sender.lastError);
  const consent = async () => {
    setBusy("consent"); setNotice(null);
    const failure = await openMailConsent();
    // Without a failure the browser is on its way to Microsoft's page: the button stays busy.
    if (failure) { setNotice({ ok: false, text: failure }); setBusy(null); }
  };
  const test = async () => {
    setBusy("test"); setNotice(null);
    try {
      const sent = await announcementRequest<{ to: string; preview: boolean }>("/mail-sender/test", {
        method: "POST", body: JSON.stringify({ title: draft.title.trim(), body: draft.body.trim(), link: draft.link }),
      });
      setNotice({ ok: true, text: `Đã gửi ${sent.preview ? "bản thông báo đang soạn" : "thư thử"} đến ${sent.to}. Thư có thể đến sau 1–2 phút; nếu chưa thấy, hãy xem cả mục Email rác.` });
    } catch (failure) {
      if (failure instanceof AnnouncementRequestError && failure.code === "mail_grant_required") mail.reload();
      setNotice({ ok: false, text: (failure as Error).message });
    } finally { setBusy(null); }
  };
  let text: ReactNode;
  if (mail.loading) text = "Đang kiểm tra quyền gửi email…";
  else if (mail.failed) text = "Chưa kiểm tra được quyền gửi email.";
  else if (!mail.available) text = "Máy chủ chưa bật chức năng gửi email.";
  else if (!sender) text = "Email được gửi từ hộp thư trường của chính bạn. Bấm nút bên dưới, Microsoft sẽ hỏi bạn cho phép EduPath AI gửi thư; EduPath AI gửi kèm một thư thử đến chính bạn.";
  else if (sender.lastError) text = `Microsoft cần bạn cho phép lại để gửi thư từ hộp thư ${sender.address}. Email chưa gửi của bạn đã chuyển thành lỗi; sau khi cho phép lại, bạn gửi lại được ở trang Đã gửi.`;
  else text = <>Gửi từ hộp thư <strong>{sender.address}</strong>. Mỗi sinh viên nhận một email riêng, gửi dần khoảng 25 thư mỗi phút; email đã gửi không thu hồi được.</>;
  return <div className="an-email">
    <label className="cm-check"><input type="checkbox" checked={checked && usable} disabled={!usable} onChange={(event) => onCheck(event.target.checked)} /> Email trường của sinh viên</label>
    <p className={`an-email-text${sender?.lastError ? " an-email-warn" : ""}`}>{text}</p>
    {checked && usable && reach && <p className="an-reach an-reach-ok">{reach}</p>}
    <div className="an-email-actions">
      {mail.failed && <button type="button" className="am-outline" onClick={mail.reload}><Icon name="refresh" /> Thử lại</button>}
      {!mail.loading && mail.available && !usable && <button type="button" className="am-outline" disabled={busy !== null} onClick={() => void consent()}>
        <Icon name="mail" /> {busy === "consent" ? "Đang mở trang Microsoft…" : sender ? "Cho phép lại" : "Cho phép gửi từ hộp thư của tôi"}</button>}
      {usable && <>
        <button type="button" className="am-outline" disabled={busy !== null} onClick={() => void test()}><Icon name="mail" /> {busy === "test" ? "Đang gửi thư thử…" : "Gửi email thử cho chính tôi"}</button>
        <button type="button" className="am-outline" disabled={busy !== null} onClick={() => setRevoking(true)}><Icon name="lock" /> Thu hồi quyền</button>
      </>}
    </div>
    {usable && <small className="an-email-hint">Thư thử chỉ đến hộp thư của bạn; khi đã có tiêu đề và nội dung, thư thử chính là thông báo đang soạn.</small>}
    {notice && <p className={notice.ok ? "an-email-ok" : "admin-error"} role={notice.ok ? "status" : "alert"}>{notice.text}</p>}
    {revoking && sender && <RevokeMailDialog address={sender.address} close={() => setRevoking(false)} done={() => {
      setRevoking(false); onCheck(false); mail.reload();
      setNotice({ ok: true, text: "Đã thu hồi quyền gửi email từ hộp thư của bạn." });
    }} />}
  </div>;
}

function RevokeMailDialog({ address, close, done }: { address: string; close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="Thu hồi quyền gửi email" size="sm" busy={busy} onClose={close}>
    <div className="cm-dialog-body cm-form">
      <strong>{address}</strong>
      <p>EduPath AI sẽ xóa ngay quyền gửi thư từ hộp thư này. Email chưa gửi của các thông báo bạn đã gửi sẽ chuyển thành lỗi; bạn gửi lại được ở trang Đã gửi sau khi cho phép lại.</p>
      <p>Quyền bạn đã đồng ý ở trang Microsoft vẫn hiện trong mục ứng dụng của tài khoản Microsoft; bạn có thể gỡ ở đó nếu muốn.</p>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button type="button" className="am-primary am-delete" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await announcementRequest("/mail-sender", { method: "DELETE" }); done(); }
          catch (failure) { setError((failure as Error).message); setBusy(false); }
        }}><Icon name="lock" /> {busy ? "Đang thu hồi…" : "Thu hồi quyền"}</button>
      </div>
    </div>
  </Modal>;
}

function ComposeAnnouncement({ canManage, navigate }: { canManage: boolean; navigate?: (path: string) => void }) {
  const options = useAnnouncementOptions();
  const mail = useMailSender();
  const [target, setTarget] = useState<AnnouncementTarget>({ cohorts: [], majors: [] });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [wantEmail, setWantEmail] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [withEmail, setWithEmail] = useState<number | null>(null);
  const [countFailed, setCountFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Announcement | null>(null);
  const emailTest = useEmailTestOutcome();
  // Picks made on the fallback list keep only what GET /options offers once it answers.
  useEffect(() => {
    setTarget((current) => {
      const cohorts = current.cohorts.filter((item) => options.cohorts.includes(item));
      const majors = current.majors.filter((code) => options.majors.some((major) => major.code === code));
      return cohorts.length === current.cohorts.length && majors.length === current.majors.length ? current : { cohorts, majors };
    });
  }, [options]);
  const query = reachQuery(target);
  // The number of students is counted again a moment after the choice changes.
  useEffect(() => {
    const controller = new AbortController();
    setCount(null); setWithEmail(null); setCountFailed(false);
    const timer = setTimeout(() => {
      announcementRequest<{ count: number; withEmail?: number }>(`/reach${query ? `?${query}` : ""}`, { signal: controller.signal })
        .then(({ count: next, withEmail: reachable }) => {
          if (controller.signal.aborted) return;
          setCount(next); setWithEmail(typeof reachable === "number" ? reachable : null);
        }, () => { if (!controller.signal.aborted) setCountFailed(true); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const everyone = !target.cohorts.length && !target.majors.length;
  const reach = reachText(count, countFailed);
  const emailOn = wantEmail && Boolean(mail.sender && !mail.sender.lastError);
  const reset = () => { setTitle(""); setBody(""); setLink(""); setError(""); };
  const send = async () => {
    setBusy(true); setError("");
    try {
      const { announcement } = await announcementRequest<{ announcement: Announcement }>("", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), body: body.trim(), link: link || null, cohorts: target.cohorts, majors: target.majors, email: emailOn }),
      });
      // Email is chosen again for each announcement: a sent email cannot be withdrawn.
      setSent(announcement); setConfirming(false); setWantEmail(false); reset();
    } catch (failure) {
      if (failure instanceof AnnouncementRequestError && failure.code === "mail_grant_required") mail.reload();
      setError((failure as Error).message); setConfirming(false);
    } finally { setBusy(false); }
  };
  return <section className="cm-workspace an-workspace">
    <EmailTestBanner outcome={emailTest} />
    {sent && <div className="an-success" role="status">
      <Icon name="check" />
      <p>Đã gửi <strong>“{sent.title}”</strong> tới {number(sent.recipients)} sinh viên ({sent.targetLabel}).
        {sent.email ? ` Email đang được gửi dần từ hộp thư ${sent.email.from ?? "của bạn"}, khoảng 25 thư mỗi phút; xem tiến độ ở trang Đã gửi.` : ""}</p>
      {navigate && <button type="button" className="am-outline" onClick={() => navigate(SENT_PATH)}>Xem thông báo đã gửi</button>}
    </div>}
    <div className="an-compose">
      <section className="cm-panel an-form-panel" aria-labelledby="an-compose-title">
        <div className="an-panel-head">
          <h2 id="an-compose-title">Soạn thông báo</h2>
          <p>Thông báo hiện ngay ở chuông thông báo của các sinh viên được chọn, và đến email trường của họ nếu bạn chọn kênh email.</p>
        </div>
        {!canManage && <p className="an-readonly" role="note">Bạn chỉ có quyền xem. Quản trị viên mới gửi được thông báo.</p>}
        <CheckedForm className="cm-form an-form" onSubmit={(event) => {
          event.preventDefault();
          setSent(null);
          if (count === 0) { setError(failures.no_recipients!); return; }
          setError(""); setConfirming(true);
        }}>
          <fieldset className="cm-fields" disabled={!canManage || busy}>
            <fieldset className="an-targets">
              <legend>Gửi đến</legend>
              <div className="an-chip-row" role="group" aria-label="Khóa">
                <button type="button" aria-pressed={everyone} onClick={() => setTarget({ cohorts: [], majors: [] })}>Tất cả sinh viên</button>
                {options.cohorts.map((cohort) => <button key={cohort} type="button" aria-pressed={target.cohorts.includes(cohort)}
                  onClick={() => setTarget((current) => ({ ...current, cohorts: options.cohorts.filter((item) => toggleValue(current.cohorts, cohort).includes(item)) }))}>{cohort}</button>)}
              </div>
              <div className="an-chip-row" role="group" aria-label="Ngành">
                {options.majors.map((major) => <button key={major.code} type="button" aria-pressed={target.majors.includes(major.code)}
                  onClick={() => setTarget((current) => ({ ...current, majors: options.majors.map((item) => item.code).filter((code) => toggleValue(current.majors, major.code).includes(code)) }))}>{major.name}</button>)}
              </div>
              <p className="an-hint">Chọn khóa, ngành hoặc cả hai; không chọn gì là gửi cho tất cả sinh viên.</p>
              <p className={`an-reach an-reach-${reach.tone}`} aria-live="polite">{reach.text}</p>
            </fieldset>
            <label><RequiredLabel>Tiêu đề</RequiredLabel>
              <input required maxLength={ANNOUNCEMENT_TITLE_MAX} value={title} placeholder="Ví dụ: Lịch đăng ký học phần học kỳ 2 năm học 2026–2027" onChange={(event) => setTitle(event.target.value)} />
              <small className="an-counter">{number(title.length)}/{number(ANNOUNCEMENT_TITLE_MAX)} ký tự</small>
            </label>
            <label><RequiredLabel>Nội dung</RequiredLabel>
              <textarea required maxLength={ANNOUNCEMENT_BODY_MAX} rows={6} value={body} placeholder="Nội dung sinh viên đọc khi mở thông báo" onChange={(event) => setBody(event.target.value)} />
              <small className="an-counter">{number(body.length)}/{number(ANNOUNCEMENT_BODY_MAX)} ký tự</small>
            </label>
            <label>Trang liên quan (không bắt buộc)
              <select value={link} onChange={(event) => setLink(event.target.value)}>
                <option value="">Không có</option>
                {PORTAL_PAGES.map((page) => <option key={page.link} value={page.link}>{page.label}</option>)}
              </select>
            </label>
            <fieldset className="an-channels">
              <legend>Kênh gửi</legend>
              <label className="cm-check"><input type="checkbox" checked disabled readOnly /> Trong EduPath AI (chuông thông báo của sinh viên)</label>
              <EmailChannel mail={mail} checked={emailOn} onCheck={setWantEmail} draft={{ title, body, link: link || null }} reach={emailReachText(count, withEmail)} />
            </fieldset>
          </fieldset>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="cm-actions">
            <button className="am-primary" disabled={!canManage || busy || count === 0}><Icon name="bell" /> Gửi thông báo</button>
            <button type="button" className="am-outline" disabled={!canManage || busy || (!title && !body && !link)} onClick={reset}><Icon name="close" /> Xóa nội dung</button>
          </div>
        </CheckedForm>
      </section>
      <AnnouncementPreview title={title} body={body} link={link || null} email={emailOn} />
    </div>
    {confirming && <Modal title="Gửi thông báo" size="sm" busy={busy} onClose={() => setConfirming(false)}>
      <div className="cm-dialog-body cm-form">
        <strong>{count === null ? "Gửi tới các sinh viên được chọn?" : `Gửi tới ${number(count)} sinh viên?`}</strong>
        <p>“{title.trim()}” sẽ hiện ngay ở chuông thông báo của {everyone ? "tất cả sinh viên" : `sinh viên ${targetText(target, options)}`}. Bạn có thể thu hồi ở trang Đã gửi.</p>
        {emailOn && <p className="an-confirm-email"><Icon name="mail" /><span>
          Kèm email từ hộp thư <strong>{mail.sender?.address}</strong>{withEmail !== null ? ` tới ${number(withEmail)} sinh viên có địa chỉ email` : ""}, gửi dần khoảng 25 thư mỗi phút
          {withEmail ? ` (xong sau khoảng ${number(emailMinutes(withEmail))} phút)` : ""}. Email đã gửi không thu hồi được.</span></p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy} onClick={() => setConfirming(false)}><Icon name="close" /> Hủy</button>
          <button type="button" className="am-primary" disabled={busy} onClick={() => void send()}><Icon name="bell" /> {busy ? "Đang gửi…" : "Gửi thông báo"}</button>
        </div>
      </div>
    </Modal>}
  </section>;
}

// The columns the sent list sorts by (table-sort.tsx); STT keeps the newest-first order of the server.
const sentSort: Record<string, SortRule<Announcement>> = {
  title: { value: (row) => row.title },
  target: { value: (row) => row.targetLabel },
  createdAt: { value: (row) => row.createdAt, by: "date" },
  read: { value: (row) => (row.recipients > 0 ? row.read / row.recipients : 0), by: "number" },
  // Announcements without email after those with, whatever went out.
  email: { value: (row) => (row.email ? row.email.sent / Math.max(1, deliverable(row.email)) : -1), by: "number" },
};

/** The email column: "298/300" sent, a bar, and what else happened ("Đang gửi 2 · 1 lỗi"). */
function EmailCell({ email }: { email: AnnouncementEmail | null | undefined }) {
  if (!email) return <span className="an-muted">Không gửi</span>;
  const summary = emailSummary(email);
  return <span className="an-read">
    <span>{summary.sent}</span>
    <span className="an-meter" aria-hidden="true"><i style={{ width: `${summary.share}%` }} /></span>
    {summary.notes.length > 0 && <small className={`an-email-note${summary.trouble ? " an-email-note-bad" : ""}`}>{summary.notes.join(" · ")}</small>}
  </span>;
}

/** The sent announcements: the table, its detail and the withdrawal. */
export function SentTable({ items, canManage, sortHeader, sort, page, onDetail, onWithdraw }: {
  items: Announcement[]; canManage: boolean; sortHeader: ReturnType<typeof useTableSort>["sortHeader"]; sort: ReturnType<typeof useTableSort>["sort"];
  page: number; onDetail: (row: Announcement) => void; onWithdraw: (row: Announcement) => void;
}) {
  return <div className="cm-table-scroll"><table className="cm-table an-table">
    <thead><tr>{sortHeader("STT", "stt", "cm-stt")}{sortHeader("Tiêu đề", "title")}{sortHeader("Gửi đến", "target")}{sortHeader("Thời gian", "createdAt")}{sortHeader("Đã đọc", "read")}{sortHeader("Email", "email")}<th scope="col">Thao tác</th></tr></thead>
    <tbody>{sortRows(items, sentSort, sort).slice((page - 1) * 10, page * 10).map(({ row, stt }) => <tr key={row.id} className={row.withdrawnAt ? "an-withdrawn" : undefined}>
      <td className="cm-stt">{stt}</td>
      <td><strong>{row.title}</strong>{row.withdrawnAt && <span className="an-tag">Đã thu hồi</span>}</td>
      <td>{row.targetLabel}</td>
      <td className="an-num">{sentTime(row.createdAt)}</td>
      <td className="an-num"><span className="an-read"><span>{readText(row)}</span><span className="an-meter" aria-hidden="true"><i style={{ width: `${readShare(row)}%` }} /></span></span></td>
      <td className="an-num"><EmailCell email={row.email} /></td>
      <td><ActionMenu label={`Thao tác với thông báo ${row.title}`} items={[
        { key: "detail", icon: "eye", label: "Xem chi tiết", onSelect: () => onDetail(row) },
        ...(canManage ? [{ key: "withdraw", icon: "trash", label: "Thu hồi thông báo", danger: true, disabled: Boolean(row.withdrawnAt), onSelect: () => onWithdraw(row) }] : []),
      ]} /></td>
    </tr>)}</tbody>
  </table></div>;
}

function SentAnnouncements({ canManage, navigate }: { canManage: boolean; navigate?: (path: string) => void }) {
  const [revision, setRevision] = useState(0);
  const remote = useData<{ items: Announcement[] }>(ANNOUNCEMENTS_API, revision);
  const [page, setPage] = useState(1);
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [mode, setMode] = useState<"detail" | "withdraw" | null>(null);
  const close = () => { setMode(null); setSelected(null); };
  const items = remote.data?.items ?? [];
  // The open announcement as the list last read it (the list refreshes every 30 seconds while emails go out).
  const current = selected ? items.find((row) => row.id === selected.id) ?? selected : null;
  return <section className="cm-workspace career-workspace an-workspace">
    <section className="cm-panel">
      <div className="career-list-heading">
        <div>
          <h2>Thông báo đã gửi{remote.data && <span className="am-count">{items.length}</span>}</h2>
          <p>Những thông báo Khoa đã gửi tới chuông và email của sinh viên, số sinh viên đã đọc, số email đã gửi, và thu hồi khi cần.</p>
        </div>
        {canManage && navigate && <button className="am-primary" onClick={() => navigate(COMPOSE_PATH)}><Icon name="plus" /> Gửi thông báo</button>}
      </div>
      <Status {...remote} />
      {remote.data && <>
        <SentTable items={items} canManage={canManage} sortHeader={sortHeader} sort={sort} page={page}
          onDetail={(row) => { setSelected(row); setMode("detail"); }} onWithdraw={(row) => { setSelected(row); setMode("withdraw"); }} />
        {!items.length && <p className="am-empty">Chưa gửi thông báo nào.</p>}
        <Pagination total={items.length} page={page} setPage={setPage} />
      </>}
    </section>
    {mode === "detail" && current && <AnnouncementDetail announcement={current} canManage={canManage} close={close} onWithdraw={() => setMode("withdraw")}
      onChanged={(next) => { setSelected(next); setRevision((n) => n + 1); }} />}
    {canManage && mode === "withdraw" && current && <WithdrawDialog announcement={current} close={close} done={() => { close(); setRevision((n) => n + 1); }} />}
  </section>;
}

function AnnouncementDetail({ announcement, canManage, close, onWithdraw, onChanged }: {
  announcement: Announcement; canManage: boolean; close: () => void; onWithdraw: () => void; onChanged: (next: Announcement) => void;
}) {
  return <Modal title="Chi tiết thông báo" onClose={close}>
    <div className="cm-dialog-body cm-form an-detail">
      <dl>
        <div><dt>Tiêu đề</dt><dd>{announcement.title}</dd></div>
        <div><dt>Nội dung</dt><dd className="an-detail-body">{announcement.body}</dd></div>
        <div><dt>Trang liên quan</dt><dd>{announcement.link ? pageLabel(announcement.link) ?? announcement.link : "Không có"}</dd></div>
        <div><dt>Gửi đến</dt><dd>{announcement.targetLabel}</dd></div>
        <div><dt>Đã đọc</dt><dd>{readText(announcement)} sinh viên ({readShare(announcement)}%)</dd></div>
        <div><dt>Thời gian gửi</dt><dd>{sentTime(announcement.createdAt)}{announcement.createdBy ? ` · ${announcement.createdBy}` : ""}</dd></div>
        {announcement.withdrawnAt && <div><dt>Thu hồi lúc</dt><dd>{sentTime(announcement.withdrawnAt)}</dd></div>}
        <div><dt>Email</dt><dd>{announcement.email
          ? <EmailDetail announcement={announcement} email={announcement.email} canManage={canManage} onChanged={onChanged} />
          : "Không gửi email"}</dd></div>
      </dl>
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button>
        {canManage && !announcement.withdrawnAt && <button className="am-primary am-delete" onClick={onWithdraw}><Icon name="trash" /> Thu hồi thông báo</button>}
      </div>
    </div>
  </Modal>;
}

/** AD-NOTI-05: how the emails went, the ones that did not go out and why, and "Gửi lại thư lỗi". */
function EmailDetail({ announcement, email, canManage, onChanged }: {
  announcement: Announcement; email: AnnouncementEmail; canManage: boolean; onChanged: (next: Announcement) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const summary = emailSummary(email);
  const retry = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await announcementRequest<{ announcement: Announcement; requeued: number }>(`/${encodeURIComponent(announcement.id)}/emails/retry`, { method: "POST", body: "{}" });
      setMessage(result.requeued
        ? { ok: true, text: `Đã xếp ${number(result.requeued)} email để gửi lại từ hộp thư ${result.announcement.email?.from ?? "của bạn"}.` }
        : { ok: true, text: "Không còn email lỗi nào để gửi lại." });
      onChanged(result.announcement);
      setRevision((n) => n + 1);
    } catch (failure) { setMessage({ ok: false, text: (failure as Error).message }); }
    finally { setBusy(false); }
  };
  return <div className="an-email-detail">
    <p>Gửi từ {email.from ?? "hộp thư của cán bộ Khoa"} · đã gửi {summary.sent} sinh viên{summary.notes.length ? ` · ${summary.notes.join(" · ")}` : ""}.</p>
    {email.failed + email.noAddress > 0 && <EmailProblems id={announcement.id} revision={revision} />}
    {canManage && email.failed > 0 && !announcement.withdrawnAt && <button type="button" className="am-outline" disabled={busy} onClick={() => void retry()}>
      <Icon name="refresh" /> {busy ? "Đang xếp lại…" : "Gửi lại thư lỗi"}</button>}
    {message && <p className={message.ok ? "an-email-ok" : "admin-error"} role={message.ok ? "status" : "alert"}>{message.text}</p>}
  </div>;
}

/** The messages of an announcement that did not go out (GET /:id/emails). */
export function EmailProblemList({ items }: { items: EmailProblem[] }) {
  if (!items.length) return <p className="an-muted">Không có email lỗi.</p>;
  return <div className="an-problems"><table>
    <thead><tr><th scope="col">Sinh viên</th><th scope="col">MSSV</th><th scope="col">Lý do</th></tr></thead>
    <tbody>{items.map((item, index) => <tr key={`${item.studentCode ?? item.name}-${index}`}>
      <td>{item.name || "Không rõ tên"}{item.address && <small>{item.address}</small>}</td>
      <td className="an-num">{item.studentCode ?? "—"}</td>
      <td>{emailErrorText(item.status, item.error)}</td>
    </tr>)}</tbody>
  </table></div>;
}
function EmailProblems({ id, revision }: { id: string; revision: number }) {
  const remote = useData<{ items: EmailProblem[] }>(`${ANNOUNCEMENTS_API}/${encodeURIComponent(id)}/emails`, revision);
  return <>
    <Status {...remote} />
    {remote.data && <EmailProblemList items={remote.data.items} />}
  </>;
}

/** What withdrawing does to the emails: "2 email chưa gửi sẽ bị hủy; 298 email đã gửi không thu hồi được." or null. */
export function withdrawEmailText(email: AnnouncementEmail | null | undefined): string | null {
  if (!email) return null;
  const parts = [
    email.pending ? `${number(email.pending)} email chưa gửi sẽ bị hủy` : "",
    email.sent ? `${number(email.sent)} email đã gửi không thu hồi được` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}.` : null;
}

function WithdrawDialog({ announcement, close, done }: { announcement: Announcement; close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const email = withdrawEmailText(announcement.email);
  return <Modal title="Thu hồi thông báo" onClose={close} busy={busy} size="sm">
    <div className="cm-dialog-body cm-form">
      <strong>{announcement.title}</strong>
      <p>Thông báo sẽ biến mất khỏi chuông của {number(announcement.recipients)} sinh viên ({announcement.targetLabel}). Việc thu hồi không hoàn tác được.</p>
      {email && <p className="an-confirm-email"><Icon name="mail" /><span>{email}</span></p>}
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary am-delete" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await announcementRequest(`/${encodeURIComponent(announcement.id)}/withdraw`, { method: "POST", body: "{}" }); done(); }
          catch (failure) { setError((failure as Error).message); }
          finally { setBusy(false); }
        }}><Icon name="trash" /> {busy ? "Đang thu hồi…" : "Thu hồi thông báo"}</button>
      </div>
    </div>
  </Modal>;
}

/* ------------------------------------------------------------------ Cài đặt thông báo (AD-NOTI-06) */

/** The faculty's announcements: always in the bell, their email chosen when each is sent (the API has no setting for them). */
export const ANNOUNCEMENT_ROW = {
  label: "Thông báo của Khoa",
  detail: "Thông báo gửi từ trang Gửi thông báo; email được chọn khi gửi từng thông báo. Muốn ngừng một thông báo, hãy thu hồi nó ở trang Đã gửi.",
};

/** "Đang bật cả 7 loại thông báo tự động." or "Đang tắt 1 trong 7 loại thông báo tự động; 2 loại gửi kèm email." */
export const settingsSummary = (items: readonly Pick<NotificationSetting, "enabled" | "email">[]) => {
  const off = items.filter((item) => !item.enabled).length;
  const emailed = items.filter((item) => item.email).length;
  const head = off ? `Đang tắt ${number(off)} trong ${number(items.length)} loại thông báo tự động` : `Đang bật cả ${number(items.length)} loại thông báo tự động`;
  return `${head}${emailed ? `; ${number(emailed)} loại gửi kèm email` : ""}.`;
};

/** "12 đã gửi · 1 lỗi": a kind's emails of the last 30 days; null when there were none. */
export function emailStatsText(stats: EmailStats): string | null {
  const parts = [
    stats.sent ? `${number(stats.sent)} đã gửi` : "", stats.pending ? `${number(stats.pending)} đang gửi` : "",
    stats.failed ? `${number(stats.failed)} lỗi` : "", stats.noAddress ? `${number(stats.noAddress)} chưa có email` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
const sumStats = (items: readonly NotificationSetting[]): EmailStats => items.reduce((total, item) => ({
  sent: total.sent + item.emails.sent, pending: total.pending + item.emails.pending, failed: total.failed + item.emails.failed,
  noAddress: total.noAddress + item.emails.noAddress,
}), { sent: 0, pending: 0, failed: 0, noAddress: 0 });

/** The automatic emails can leave now: a named sender whose permission works. */
export const autoSenderReady = (mail: AutoMailState) => Boolean(mail.sender?.address && !mail.sender.lastError);
/** The caller's own permission works (they can become the sender). */
export const ownGrantReady = (mail: AutoMailState) => Boolean(mail.me && !mail.me.lastError);
/** The mailbox an email turned on now would leave from: the sender's, else the caller's (who then becomes the sender). */
export const nextSenderAddress = (mail: AutoMailState) => (autoSenderReady(mail) ? mail.sender!.address : ownGrantReady(mail) ? mail.me!.address : null);

function Switch({ on, label, busy, disabled, onClick }: { on: boolean; label: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" role="switch" className="an-switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}>
    <span className="an-switch-track" aria-hidden="true" /><span className="an-switch-label">{busy ? "Đang lưu…" : on ? "Bật" : "Tắt"}</span>
  </button>;
}

/**
 * The kinds of automatic notifications: a switch for the bell and one for the email of each (Việc làm thay sinh viên is
 * always in the bell), then the faculty's announcements, always on with their email chosen when sent.
 */
export function SettingsList({ items, canManage, saving, emailReady, onBell, onEmail }: {
  items: NotificationSetting[]; canManage: boolean; saving: string | null; emailReady: boolean;
  onBell: (item: NotificationSetting) => void; onEmail: (item: NotificationSetting) => void;
}) {
  return <>
    <div className="an-settings-head" aria-hidden="true"><span>Loại thông báo</span><span>Trong EduPath AI</span><span>Email</span></div>
    <ul className="an-settings-list">
      {items.map((item) => {
        const stats = emailStatsText(item.emails);
        // Off can always be pressed; on needs the bell on and a mailbox that can send.
        const emailOff = !canManage || saving !== null || (!item.email && (!item.enabled || !emailReady));
        return <li key={item.key}>
          <div className="an-setting-text">
            <strong>{item.label}</strong>
            <p>{item.detail}</p>
            {item.updatedAt && <small>Cập nhật lúc {sentTime(item.updatedAt)}{item.updatedBy ? ` · ${item.updatedBy}` : ""}</small>}
            {stats && <small className="an-setting-stats">Email 30 ngày qua: {stats}</small>}
          </div>
          <div className="an-setting-control" data-label="Trong EduPath AI">{item.bellLocked
            ? <span className="an-always">Luôn bật</span>
            : <Switch on={item.enabled} label={`${item.label}: thông báo trong EduPath AI`} busy={saving === `${item.key}:bell`}
              disabled={!canManage || saving !== null} onClick={() => onBell(item)} />}</div>
          <div className="an-setting-control" data-label="Email">
            <Switch on={item.email} label={`${item.label}: gửi kèm email`} busy={saving === `${item.key}:email`} disabled={emailOff} onClick={() => onEmail(item)} />
          </div>
        </li>;
      })}
      <li className="an-setting-fixed">
        <div className="an-setting-text"><strong>{ANNOUNCEMENT_ROW.label}</strong><p>{ANNOUNCEMENT_ROW.detail}</p></div>
        <div className="an-setting-control" data-label="Trong EduPath AI"><span className="an-always">Luôn bật</span></div>
        <div className="an-setting-control" data-label="Email"><span className="an-always">Chọn khi gửi</span></div>
      </li>
    </ul>
  </>;
}

/**
 * Whose school mailbox sends the automatic emails, what to do when there is none or it needs Microsoft's permission
 * again, and how the emails of the last 30 days went.
 */
export function AutoMailPanel({ mail, stats, canManage, busy, onConsent, onUseMine, onRetry }: {
  mail: AutoMailState; stats: EmailStats; canManage: boolean; busy: "consent" | "mine" | "retry" | null;
  onConsent: () => void; onUseMine: () => void; onRetry: () => void;
}) {
  if (!mail.available) return <div className="an-automail"><p className="an-email-text">Máy chủ chưa bật chức năng gửi email.</p></div>;
  const sender = mail.sender;
  const ready = autoSenderReady(mail);
  const mine = ownGrantReady(mail);
  let text: ReactNode;
  if (!sender) {
    text = mine
      ? <>Chưa chọn hộp thư gửi. Khi bạn bật Email ở một loại thông báo, email sẽ gửi từ hộp thư <strong>{mail.me!.address}</strong> của bạn.</>
      : "Chưa chọn hộp thư gửi. Hãy cho phép EduPath AI gửi thư từ hộp thư trường của bạn, rồi bật Email ở những loại thông báo muốn gửi.";
  } else if (!ready) {
    text = `Hộp thư ${sender.address ?? "gửi email"}${sender.mine ? " của bạn" : sender.name ? ` (${sender.name})` : ""} cần được cho phép lại nên email tự động đang chưa gửi được.`;
  } else {
    text = <>Gửi từ hộp thư <strong>{sender.address}</strong>{sender.mine ? " của bạn" : sender.name ? ` (${sender.name})` : ""}. Mỗi sinh viên nhận một email riêng, gửi dần khoảng 25 thư mỗi phút; email đã gửi không thu hồi được.</>;
  }
  const totals = emailStatsText(stats);
  const consentLabel = sender?.mine ? "Cho phép lại" : "Cho phép gửi từ hộp thư của tôi";
  return <div className={`an-automail${sender && !ready ? " an-automail-warn" : ""}`}>
    <div className="an-automail-text">
      <strong>Email thông báo tự động</strong>
      <p className={`an-email-text${sender && !ready ? " an-email-warn" : ""}`}>{text}</p>
      <small className="an-email-hint">{totals ? `30 ngày qua: ${totals}.` : "30 ngày qua chưa gửi email tự động nào."}</small>
    </div>
    <div className="an-email-actions">
      {!mine && (!ready || !sender?.mine) && <button type="button" className="am-outline" disabled={!canManage || busy !== null} onClick={onConsent}>
        <Icon name="mail" /> {busy === "consent" ? "Đang mở trang Microsoft…" : consentLabel}</button>}
      {mine && (!sender || !sender.mine) && <button type="button" className="am-outline" disabled={!canManage || busy !== null} onClick={onUseMine}>
        <Icon name="user" /> {busy === "mine" ? "Đang đổi…" : "Dùng hộp thư của tôi"}</button>}
      {ready && stats.failed > 0 && <button type="button" className="am-outline" disabled={!canManage || busy !== null} onClick={onRetry}>
        <Icon name="refresh" /> {busy === "retry" ? "Đang xếp lại…" : `Gửi lại email lỗi (${number(stats.failed)})`}</button>}
    </div>
  </div>;
}

function NotificationSettings({ canManage }: { canManage: boolean }) {
  const remote = useData<{ items: NotificationSetting[]; mail?: AutoMailState }>(`${ANNOUNCEMENTS_API}/settings`);
  const [saved, setSaved] = useState<Record<string, NotificationSetting>>({});
  const [mailState, setMailState] = useState<AutoMailState | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [busy, setBusy] = useState<"consent" | "mine" | "retry" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<NotificationSetting | null>(null);
  const emailTest = useEmailTestOutcome();
  const items = (remote.data?.items ?? []).map((item) => saved[item.key] ?? item);
  const mail: AutoMailState = mailState ?? remote.data?.mail ?? { available: false, sender: null, me: null };
  const save = async (item: NotificationSetting, change: { enabled?: boolean; email?: boolean }, slot: string) => {
    setSaving(slot); setError(""); setNotice("");
    try {
      const result = await announcementRequest<{ setting: NotificationSetting; mail?: AutoMailState }>(`/settings/${encodeURIComponent(item.key)}`, {
        method: "PUT", body: JSON.stringify(change),
      });
      setSaved((current) => ({ ...current, [result.setting.key]: result.setting }));
      if (result.mail) setMailState(result.mail);
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(null); }
  };
  const run = async (kind: "mine" | "retry") => {
    setBusy(kind); setError(""); setNotice("");
    try {
      if (kind === "mine") {
        const result = await announcementRequest<{ mail: AutoMailState }>("/settings/mail-sender", { method: "POST", body: "{}" });
        setMailState(result.mail);
        setNotice("Từ giờ email thông báo tự động gửi từ hộp thư của bạn, kể cả những email đang chờ gửi.");
      } else {
        const result = await announcementRequest<{ requeued: number; items: NotificationSetting[] }>("/settings/retry-emails", { method: "POST", body: "{}" });
        setSaved(Object.fromEntries(result.items.map((item) => [item.key, item])));
        setNotice(result.requeued ? `Đã xếp ${number(result.requeued)} email để gửi lại.` : "Không còn email lỗi nào để gửi lại.");
      }
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  const consent = async () => {
    setBusy("consent"); setError(""); setNotice("");
    const failure = await openMailConsent("settings");
    // Without a failure the browser is on its way to Microsoft's page: the button stays busy.
    if (failure) { setError(failure); setBusy(null); }
  };
  const from = nextSenderAddress(mail);
  return <section className="cm-workspace an-workspace">
    <EmailTestBanner outcome={emailTest} />
    <section className="cm-panel an-settings" aria-labelledby="an-settings-title">
      <div className="an-panel-head">
        <h2 id="an-settings-title">Thông báo tự động gửi sinh viên</h2>
        <p>Bật hoặc tắt từng loại thông báo EduPath AI tự gửi vào chuông thông báo của sinh viên, và chọn loại nào gửi kèm email trường của sinh viên. Tắt chỉ dừng thông báo mới; thông báo sinh viên đã nhận vẫn giữ nguyên.</p>
      </div>
      {!canManage && <p className="an-readonly" role="note">Bạn chỉ có quyền xem. Quản trị viên mới thay đổi được cài đặt.</p>}
      <Status {...remote} />
      {remote.data && <>
        <AutoMailPanel mail={mail} stats={sumStats(items)} canManage={canManage} busy={busy}
          onConsent={() => void consent()} onUseMine={() => void run("mine")} onRetry={() => void run("retry")} />
        <p className="an-settings-count" role="status">{settingsSummary(items)}</p>
        <SettingsList items={items} canManage={canManage} saving={saving} emailReady={mail.available && Boolean(from)}
          onBell={(item) => void save(item, { enabled: !item.enabled }, `${item.key}:bell`)}
          onEmail={(item) => (item.email ? void save(item, { email: false }, `${item.key}:email`) : setConfirming(item))} />
        {notice && <p className="an-email-ok" role="status">{notice}</p>}
      </>}
      {error && <p className="admin-error" role="alert">{error}</p>}
    </section>
    {confirming && <Modal title="Gửi kèm email" size="sm" busy={saving !== null} onClose={() => setConfirming(null)}>
      <div className="cm-dialog-body cm-form">
        <strong>{confirming.label}</strong>
        <p>Từ giờ, mỗi thông báo “{confirming.label}” mới cũng được gửi đến email trường của sinh viên{from ? `, từ hộp thư ${from}` : ""}.</p>
        <p className="an-confirm-email"><Icon name="mail" /><span>Mỗi sinh viên nhận một email riêng, gửi dần khoảng 25 thư mỗi phút. Email đã gửi không thu hồi được; tắt Email chỉ hủy những email chưa gửi.</span></p>
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={saving !== null} onClick={() => setConfirming(null)}><Icon name="close" /> Hủy</button>
          <button type="button" className="am-primary" disabled={saving !== null} onClick={async () => {
            await save(confirming, { email: true }, `${confirming.key}:email`);
            setConfirming(null);
          }}><Icon name="mail" /> {saving ? "Đang bật…" : "Bật email"}</button>
        </div>
      </div>
    </Modal>}
  </section>;
}
