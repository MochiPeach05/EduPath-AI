import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionMenu, Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { CheckedForm } from "./CheckedForm";
import { majorOptions } from "./majors";
import { sortRows, useTableSort, type SortRule } from "./table-sort";
import {
  ANNOUNCEMENTS_API, ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_STUDENTS_MAX, ANNOUNCEMENT_TITLE_MAX, type Announcement, type AnnouncementEmail, type AnnouncementSender,
  type AnnouncementTarget,
  type AutoMailState, type EmailProblem, type EmailStats, type MailSender, type NotificationSetting, type RecipientStudent,
} from "./notification-types";
import { nameInitials } from "./person-name";
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
// 2026-11-25 (user: "Sửa lại giao diện gửi thông báo đẹp hơn và thêm tính năng có thể gửi tới từng bạn sinh viên mình chọn
// nữa"): the compose page is three steps (Người nhận, Nội dung, Kênh gửi) beside a rail with the summary, the send button and
// the student's view (bell or email); the recipients are a group (cohorts, majors) or students picked one by one.

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
  mail: MailSenderView; checked: boolean; onCheck: (on: boolean) => void; draft: { title: string; body: string; link: string | null; sender?: AnnouncementSender };
  reach: string | null;
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
        method: "POST", body: JSON.stringify({ title: draft.title.trim(), body: draft.body.trim(), link: draft.link, sender: draft.sender ?? "khoa" }),
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
  const on = checked && usable;
  const state = mail.loading ? "Đang kiểm tra quyền gửi…" : mail.failed ? "Chưa kiểm tra được" : !mail.available ? "Máy chủ chưa bật email"
    : !sender ? "Cần cho phép một lần" : sender.lastError ? "Cần cho phép lại" : on ? "Gửi kèm thông báo này" : "Không gửi email";
  return <div className={`an-channel an-email${on ? " an-channel-on" : ""}`}>
    <div className="an-channel-head">
      <span className="an-channel-icon" aria-hidden="true"><Icon name="mail" /></span>
      <span className="an-channel-title"><strong>Email trường của sinh viên</strong><small>{state}</small></span>
      <Switch on={on} label="Gửi kèm email trường của sinh viên" busy={false} disabled={!usable} onClick={() => onCheck(!on)} />
    </div>
    <p className={`an-email-text${sender?.lastError ? " an-email-warn" : ""}`}>{text}</p>
    {on && reach && <p className="an-reach an-reach-ok">{reach}</p>}
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

/* ------------------------------------------------------------------ Chọn từng sinh viên (2026-11-25) */

/** "MSSV 2374802019901 · 71K29CNTT99": what tells two students of one name apart; "Chưa cập nhật MSSV" without a code. */
export function studentLine(student: Pick<RecipientStudent, "studentCode" | "className">): string {
  return [student.studentCode ? `MSSV ${student.studentCode}` : "Chưa cập nhật MSSV", student.className].filter(Boolean).join(" · ");
}
/** "Lương Khánh Vy, Tạ Minh Đức và 1 sinh viên khác": the picked students as the summary and the confirm dialog name them. */
export function pickedSummary(picked: readonly Pick<RecipientStudent, "name">[], shown = 2): string {
  if (!picked.length) return "Chưa chọn sinh viên nào";
  const names = picked.slice(0, Math.max(1, shown)).map((student) => student.name);
  const rest = picked.length - names.length;
  if (rest > 0) return `${names.join(", ")} và ${number(rest)} sinh viên khác`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}` : names[0]!;
}
/** Who an announcement reached: "3 sinh viên được chọn", or "80 sinh viên (K29 · Công nghệ thông tin)". */
export const reachedText = (announcement: Pick<Announcement, "recipients" | "target" | "targetLabel">) =>
  (announcement.target.students?.length || announcement.target.picked
    ? `${number(announcement.recipients)} sinh viên được chọn` : `${number(announcement.recipients)} sinh viên (${announcement.targetLabel})`);
/** The count line of "Chọn từng sinh viên": exact, never "Khoảng". */
export function pickedReachText(count: number): { text: string; tone: "warn" | "ok" } {
  return count
    ? { text: `${number(count)} sinh viên được chọn nhận được thông báo này.`, tone: "ok" }
    : { text: "Chưa chọn sinh viên nào. Tìm và đánh dấu những sinh viên cần gửi.", tone: "warn" };
}
/** Students listed per search (the API allows up to 50). */
export const STUDENT_RESULTS = 20;
/** The line above the search results: loading (results null), failed, none, the first ones, or how many match. */
export function searchStatus(query: string, results: number | null, failed: boolean): string {
  if (failed) return "Chưa tìm được sinh viên. Vui lòng thử lại.";
  if (results === null) return "Đang tìm sinh viên…";
  if (!results) return query.trim() ? "Không có sinh viên phù hợp. Thử từ khóa khác." : "Chưa có sinh viên nào nhận được thông báo.";
  if (!query.trim()) return `${number(results)} sinh viên đầu tiên theo tên. Gõ họ tên, MSSV hoặc lớp để tìm sinh viên khác.`;
  return results >= STUDENT_RESULTS ? `${number(results)} sinh viên phù hợp đầu tiên; gõ thêm để thu hẹp.` : `${number(results)} sinh viên phù hợp.`;
}

/**
 * "Chọn từng sinh viên": a search over the students an announcement can reach (GET /students: name, MSSV or class, tones
 * ignored), a list to tick, and the picked students kept whole (the results change with every search), at most 200.
 */
export function StudentPicker({ picked, onChange, disabled }: { picked: RecipientStudent[]; onChange: (next: RecipientStudent[]) => void; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecipientStudent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The list is asked again a moment after typing stops; the last answer stays on screen meanwhile.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: String(STUDENT_RESULTS) });
      const words = query.trim().slice(0, 80);
      if (words) params.set("q", words);
      announcementRequest<{ items?: RecipientStudent[] }>(`/students?${params}`, { signal: controller.signal })
        .then((data) => {
          if (controller.signal.aborted) return;
          setResults(Array.isArray(data.items) ? data.items : []); setLoading(false);
        }, () => { if (!controller.signal.aborted) { setResults(null); setFailed(true); setLoading(false); } });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, attempt]);
  const ids = new Set(picked.map((student) => student.id));
  const full = picked.length >= ANNOUNCEMENT_STUDENTS_MAX;
  const toggle = (student: RecipientStudent) => onChange(ids.has(student.id)
    ? picked.filter((item) => item.id !== student.id)
    : full ? picked : [...picked, student]);
  const search = useRef<HTMLInputElement>(null);
  const pickedList = useRef<HTMLUListElement>(null);
  // Keyboard focus after the next render: the button that was pressed is gone by then.
  const focusNext = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => { const target = focusNext.current; focusNext.current = null; target?.()?.focus(); });
  const unpick = (student: RecipientStudent, index: number) => {
    // The next student's ×, else the previous one, else the search box once nobody is left.
    focusNext.current = () => pickedList.current?.querySelectorAll<HTMLElement>(".an-chip-x")[Math.min(index, picked.length - 2)] ?? search.current;
    toggle(student);
  };
  const status = loading ? "Đang tìm sinh viên…" : searchStatus(query, results?.length ?? null, failed);
  // Enter in the search box or on a result's checkbox never sends the announcement (browsers submit the form on Enter in a
  // checkbox; Space ticks it). Buttons keep their Enter.
  return <div className="an-picker" onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <div className="an-picker-find">
      <label className="an-search-label" htmlFor="an-student-search">Tìm sinh viên</label>
      <div className="an-search-box">
        <Icon name="search" />
        <input id="an-student-search" ref={search} type="search" maxLength={80} autoComplete="off" placeholder="Họ tên, MSSV hoặc lớp…" value={query}
          onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="an-find-status">
        <p className="an-hint" role="status" aria-live="polite">{status}</p>
        {failed && <button type="button" className="am-outline an-small-btn" onClick={() => { setAttempt((n) => n + 1); search.current?.focus(); }}><Icon name="refresh" /> Thử lại</button>}
      </div>
      {results && results.length > 0 && <ul className={`an-results${loading ? " an-results-stale" : ""}`} aria-label="Kết quả tìm sinh viên">
        {results.map((student) => {
          const on = ids.has(student.id);
          return <li key={student.id}>
            <label className={`an-pick-row${on ? " an-pick-on" : ""}`}>
              <input type="checkbox" checked={on} disabled={disabled || (!on && full)} onChange={() => toggle(student)} />
              <span className="an-avatar" aria-hidden="true">{nameInitials(student.name) || "SV"}</span>
              <span className="an-pick-text"><strong>{student.name}</strong><small>{studentLine(student)}</small></span>
              {!student.hasEmail && <span className="an-nomail">Chưa có email</span>}
            </label>
          </li>;
        })}
      </ul>}
    </div>
    <div className="an-picked-box">
      <div className="an-picked-head">
        <strong>Đã chọn {number(picked.length)} sinh viên</strong>
        {picked.length > 0 && <button type="button" className="am-outline an-small-btn" disabled={disabled}
          onClick={() => { focusNext.current = () => search.current; onChange([]); }}>Bỏ chọn tất cả</button>}
      </div>
      {picked.length
        ? <ul className="an-picked" ref={pickedList} aria-label="Sinh viên đã chọn">{picked.map((student, index) => <li key={student.id}>
          <span className="an-avatar an-avatar-sm" aria-hidden="true">{nameInitials(student.name) || "SV"}</span>
          <span className="an-pick-text"><strong>{student.name}</strong><small>{studentLine(student)}{student.hasEmail ? "" : " · chưa có email"}</small></span>
          <button type="button" className="an-chip-x" aria-label={`Bỏ chọn ${student.name}`} title="Bỏ chọn" disabled={disabled} onClick={() => unpick(student, index)}><Icon name="close" /></button>
        </li>)}</ul>
        : <p className="an-picked-empty">Chưa chọn sinh viên nào. Đánh dấu sinh viên trong danh sách kết quả để thêm vào đây.</p>}
      {full && <p className="an-hint an-hint-warn">Đã đủ {number(ANNOUNCEMENT_STUDENTS_MAX)} sinh viên, mức tối đa cho một thông báo.</p>}
    </div>
  </div>;
}

/** A section of the compose page: its step number, title, one line of help and, on the right, what it currently says. */
function StepHead({ step, id, title, text, meta }: { step: number; id: string; title: string; text: string; meta?: ReactNode }) {
  return <header className="an-step-head">
    <span className="an-step-no" aria-hidden="true">{step}</span>
    <div className="an-step-title"><h2 id={id}>{title}</h2><p>{text}</p></div>
    {meta ? <span className="an-step-meta">{meta}</span> : null}
  </header>;
}

/** How each sender appears: the bell's icon and label, the page's name for it, and the email's last line (mail/messages.ts). */
export const SENDERS: Readonly<Record<AnnouncementSender, { glyph: string; bell: string; name: string; foot: string }>> = {
  khoa: {
    glyph: "K", bell: "Từ Khoa", name: "Khoa Công nghệ Thông tin",
    foot: "Thông báo của Khoa Công nghệ Thông tin, Trường Đại học Văn Lang, gửi qua EduPath AI. Bạn cũng xem được thông báo này ở chuông thông báo trên EduPath AI.",
  },
  edupath: {
    glyph: "i", bell: "Hệ thống", name: "EduPath AI",
    foot: "Thông báo do EduPath AI gửi. Bạn cũng xem được thông báo này ở chuông thông báo trên EduPath AI.",
  },
};
/** The paragraphs of the email as messages.ts writes them: a blank line starts a new one; a single break stays inside. */
const mailParagraphs = (text: string) => text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);

/** The email a student receives (mail/messages.ts announcementMailMessage), for the preview. */
export function EmailPreview({ title, body, link, from, on, sender = "khoa" }: {
  title: string; body: string; link: string | null; from: string | null; on: boolean; sender?: AnnouncementSender;
}) {
  const heading = title.trim() || "Tiêu đề thông báo";
  const button = openLabel(link);
  const text = body.trim() || "Nội dung sẽ hiện ở đây khi sinh viên mở thư.";
  return <div className="an-mail">
    {!on && <p className="an-preview-off">Chưa bật kênh email: sinh viên chỉ nhận thông báo ở chuông.</p>}
    <div className="an-mail-frame">
      <dl className="an-mail-head">
        <div><dt>Tiêu đề</dt><dd><strong>[EduPath AI] {heading}</strong></dd></div>
        <div><dt>Từ</dt><dd>{from ?? "Hộp thư trường của bạn"}</dd></div>
        <div><dt>Đến</dt><dd>Email trường của từng sinh viên</dd></div>
      </dl>
      <div className="an-mail-body">
        <p>Chào [họ tên sinh viên],</p>
        {mailParagraphs(text).map((part, index) => <p key={index}>{part}</p>)}
        <span className="an-mail-button">{button ? `${button} trên EduPath AI` : "Mở EduPath AI"}</span>
        <p className="an-mail-foot">{SENDERS[sender].foot}</p>
      </div>
    </div>
  </div>;
}

/** The student's view while the announcement is written: the bell (an unread row, then the opened notification) or the email. */
export function AnnouncementPreview({ title, body, link, email = false, from = null, sender = "khoa" }: {
  title: string; body: string; link: string | null; email?: boolean; from?: string | null; sender?: AnnouncementSender;
}) {
  const [view, setView] = useState<"bell" | "email">("bell");
  const who = SENDERS[sender];
  const heading = title.trim() || "Tiêu đề thông báo";
  const text = body.trim() || "Nội dung sẽ hiện ở đây khi sinh viên mở thông báo.";
  const button = openLabel(link);
  return <section className="cm-panel an-preview" aria-labelledby="an-preview-title">
    <div className="an-preview-head">
      <h2 id="an-preview-title">Sinh viên sẽ thấy</h2>
      <div className="an-seg an-seg-sm" role="group" aria-label="Xem trước">
        <button type="button" aria-pressed={view === "bell"} onClick={() => setView("bell")}><Icon name="bell" /> Chuông</button>
        <button type="button" aria-pressed={view === "email"} onClick={() => setView("email")}><Icon name="mail" /> Email</button>
      </div>
    </div>
    {view === "bell" ? <div className="an-bell">
      <div className="an-note-row">
        <span className={`an-note-icon an-note-icon-${sender}`} aria-hidden="true">{who.glyph}</span>
        <span className="an-note-text"><strong>{heading}</strong><small>{who.bell} · Vừa xong · chưa đọc</small></span>
        <span className="an-note-dot" aria-hidden="true" />
      </div>
      <div className="an-bell-detail">
        <span className={`an-bell-chip an-bell-chip-${sender}`}>{who.bell} · Vừa xong</span>
        <h3>{heading}</h3>
        <p className="an-preview-body">{text}</p>
        {button && <span className="an-preview-button">{button}</span>}
      </div>
      <p className="an-preview-note">Sinh viên thấy thông báo ở chuông trên thanh đầu trang, lọc được theo "{who.bell}", đánh dấu đã đọc hoặc xóa. Thông báo tự xóa sau 90 ngày.</p>
    </div> : <EmailPreview title={title} body={body} link={link} from={from} on={email} sender={sender} />}
  </section>;
}

function ComposeAnnouncement({ canManage, navigate }: { canManage: boolean; navigate?: (path: string) => void }) {
  const options = useAnnouncementOptions();
  const mail = useMailSender();
  const [mode, setMode] = useState<"group" | "students">("group");
  const [target, setTarget] = useState<AnnouncementTarget>({ cohorts: [], majors: [] });
  const [picked, setPicked] = useState<RecipientStudent[]>([]);
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
  const [sender, setSender] = useState<AnnouncementSender>("khoa");
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
  const byStudent = mode === "students";
  const everyone = !target.cohorts.length && !target.majors.length;
  const reach = byStudent ? pickedReachText(picked.length) : reachText(count, countFailed);
  // Picked students are counted here; a group is counted by GET /reach.
  const recipients = byStudent ? picked.length : count;
  const reachable = byStudent ? picked.filter((student) => student.hasEmail).length : withEmail;
  const nobody = recipients === 0;
  const recipientsText = byStudent ? pickedSummary(picked) : targetText(target, options);
  const emailOn = wantEmail && Boolean(mail.sender && !mail.sender.lastError);
  const reset = () => { setTitle(""); setBody(""); setLink(""); setError(""); };
  const send = async () => {
    setBusy(true); setError("");
    try {
      const audience = byStudent ? { students: picked.map((student) => student.id) } : { cohorts: target.cohorts, majors: target.majors };
      const { announcement } = await announcementRequest<{ announcement: Announcement }>("", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), body: body.trim(), link: link || null, ...audience, email: emailOn, sender }),
      });
      // Email is chosen again for each announcement: a sent email cannot be withdrawn.
      setSent(announcement); setConfirming(false); setWantEmail(false); reset();
    } catch (failure) {
      if (failure instanceof AnnouncementRequestError && failure.code === "mail_grant_required") mail.reload();
      setError((failure as Error).message); setConfirming(false);
    } finally { setBusy(false); }
  };
  const pendingText = countFailed ? "Chưa đếm được" : "Đang đếm…";
  const countText = recipients === null ? pendingText : `${number(recipients)} sinh viên`;
  return <section className="cm-workspace an-workspace">
    <EmailTestBanner outcome={emailTest} />
    {sent && <div className="an-success" role="status">
      <Icon name="check" />
      <p>Đã gửi <strong>“{sent.title}”</strong> tới {reachedText(sent)}.
        {sent.email ? ` Email đang được gửi dần từ hộp thư ${sent.email.from ?? "của bạn"}, khoảng 25 thư mỗi phút; xem tiến độ ở trang Đã gửi.` : ""}</p>
      {navigate && <button type="button" className="am-outline" onClick={() => navigate(SENT_PATH)}>Xem thông báo đã gửi</button>}
    </div>}
    {!canManage && <p className="an-readonly" role="note">Bạn chỉ có quyền xem. Quản trị viên mới gửi được thông báo.</p>}
    <div className="an-compose">
      <CheckedForm id="an-compose-form" className="cm-form an-form" onSubmit={(event) => {
        event.preventDefault();
        setSent(null);
        if (nobody) { setError(byStudent ? "Hãy chọn ít nhất một sinh viên." : failures.no_recipients!); return; }
        setError(""); setConfirming(true);
      }}>
        <fieldset className="cm-fields an-steps" disabled={!canManage || busy}>
          <section className="cm-panel an-step" aria-labelledby="an-step-recipients">
            <StepHead step={1} id="an-step-recipients" title="Người nhận" text="Gửi cho cả khóa, ngành hoặc chọn từng sinh viên." meta={countText} />
            <div className="an-seg" role="group" aria-label="Cách chọn người nhận">
              <button type="button" aria-pressed={!byStudent} onClick={() => setMode("group")}><Icon name="users" /> Theo khóa, ngành</button>
              <button type="button" aria-pressed={byStudent} onClick={() => setMode("students")}><Icon name="user" /> Chọn từng sinh viên</button>
            </div>
            {byStudent
              ? <StudentPicker picked={picked} onChange={setPicked} disabled={!canManage || busy} />
              : <fieldset className="an-targets">
                <legend className="sr-only">Khóa và ngành</legend>
                <div className="an-chip-group">
                  <span className="an-chip-label">Khóa</span>
                  <div className="an-chip-row" role="group" aria-label="Khóa">
                    <button type="button" aria-pressed={everyone} onClick={() => setTarget({ cohorts: [], majors: [] })}>Tất cả sinh viên</button>
                    {options.cohorts.map((cohort) => <button key={cohort} type="button" aria-pressed={target.cohorts.includes(cohort)}
                      onClick={() => setTarget((current) => ({ ...current, cohorts: options.cohorts.filter((item) => toggleValue(current.cohorts, cohort).includes(item)) }))}>{cohort}</button>)}
                  </div>
                </div>
                <div className="an-chip-group">
                  <span className="an-chip-label">Ngành</span>
                  <div className="an-chip-row" role="group" aria-label="Ngành">
                    {options.majors.map((major) => <button key={major.code} type="button" aria-pressed={target.majors.includes(major.code)}
                      onClick={() => setTarget((current) => ({ ...current, majors: options.majors.map((item) => item.code).filter((code) => toggleValue(current.majors, major.code).includes(code)) }))}>{major.name}</button>)}
                  </div>
                </div>
                <p className="an-hint">Chọn khóa, ngành hoặc cả hai; không chọn gì là gửi cho tất cả sinh viên.</p>
              </fieldset>}
            <p className={`an-reach an-reach-${reach.tone}`} aria-live="polite">{reach.text}</p>
          </section>
          <section className="cm-panel an-step" aria-labelledby="an-step-content">
            <StepHead step={2} id="an-step-content" title="Nội dung" text="Tiêu đề hiện trong chuông và là tiêu đề email; nội dung sinh viên đọc khi mở thông báo." />
            <div className="an-sender">
              <span className="an-search-label" id="an-sender-label">Người gửi</span>
              <div className="an-seg" role="group" aria-labelledby="an-sender-label">
                {(["khoa", "edupath"] as const).map((key) => <button key={key} type="button" aria-pressed={sender === key} onClick={() => setSender(key)}>{SENDERS[key].name}</button>)}
              </div>
              <small className="an-field-hint">{sender === "edupath"
                ? "Sinh viên thấy thông báo là của EduPath AI: chuông ghi “Hệ thống”, email kết thúc bằng dòng của EduPath AI. Nội dung không nên xưng là Khoa."
                : "Sinh viên thấy thông báo là của Khoa: chuông ghi “Từ Khoa”."}</small>
            </div>
            <label><RequiredLabel>Tiêu đề</RequiredLabel>
              <input id="an-title" required maxLength={ANNOUNCEMENT_TITLE_MAX} value={title} placeholder="Ví dụ: Lịch đăng ký học phần học kỳ 2 năm học 2026–2027" onChange={(event) => setTitle(event.target.value)} />
              <small className="an-counter">{number(title.length)}/{number(ANNOUNCEMENT_TITLE_MAX)} ký tự</small>
            </label>
            <label><RequiredLabel>Nội dung</RequiredLabel>
              <textarea id="an-body" required maxLength={ANNOUNCEMENT_BODY_MAX} rows={6} value={body} placeholder="Nội dung sinh viên đọc khi mở thông báo" onChange={(event) => setBody(event.target.value)} />
              <small className="an-counter">{number(body.length)}/{number(ANNOUNCEMENT_BODY_MAX)} ký tự</small>
            </label>
            <label>Trang liên quan (không bắt buộc)
              <select id="an-link" value={link} onChange={(event) => setLink(event.target.value)}>
                <option value="">Không có</option>
                {PORTAL_PAGES.map((page) => <option key={page.link} value={page.link}>{page.label}</option>)}
              </select>
              <small className="an-field-hint">Sinh viên bấm nút trong thông báo để mở trang này.</small>
            </label>
          </section>
          <section className="cm-panel an-step" aria-labelledby="an-step-channels">
            <StepHead step={3} id="an-step-channels" title="Kênh gửi" text="Thông báo luôn hiện trong EduPath AI; email trường là tùy chọn."
              meta={emailOn ? "Chuông và email" : "Chuông"} />
            <div className="an-channels-grid">
              <div className="an-channel an-channel-on">
                <div className="an-channel-head">
                  <span className="an-channel-icon" aria-hidden="true"><Icon name="bell" /></span>
                  <span className="an-channel-title"><strong>Trong EduPath AI</strong><small>Chuông của sinh viên</small></span>
                  <span className="an-always">Luôn bật</span>
                </div>
                <p className="an-email-text">Hiện ngay ở chuông của các sinh viên nhận, lọc được theo "{SENDERS[sender].bell}"; tự xóa sau 90 ngày.</p>
              </div>
              <EmailChannel mail={mail} checked={emailOn} onCheck={setWantEmail} draft={{ title, body, link: link || null, sender }}
                reach={recipients === null ? null : emailReachText(recipients, reachable)} />
            </div>
          </section>
        </fieldset>
      </CheckedForm>
      <aside className="an-rail" aria-label="Tóm tắt và xem trước">
        <section className="cm-panel an-summary" aria-labelledby="an-summary-title">
          <h2 id="an-summary-title">Tóm tắt</h2>
          <dl>
            <div><dt>Người gửi</dt><dd>{SENDERS[sender].name}</dd></div>
            <div><dt>Người nhận</dt><dd>{recipientsText}</dd></div>
            <div><dt>Số sinh viên</dt><dd>{countText}</dd></div>
            <div><dt>Kênh gửi</dt><dd>{emailOn ? "Chuông thông báo và email trường" : "Chuông thông báo"}</dd></div>
            {emailOn && <div><dt>Email</dt><dd>{reachable === null ? pendingText : `${number(reachable)} sinh viên có email`}, từ {mail.sender?.address}</dd></div>}
            <div><dt>Tiêu đề</dt><dd className={title.trim() ? undefined : "an-muted"}>{title.trim() || "Chưa nhập"}</dd></div>
          </dl>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="an-summary-actions">
            <button type="submit" form="an-compose-form" className="am-primary" disabled={!canManage || busy || nobody}><Icon name="bell" /> Gửi thông báo</button>
            <button type="button" className="am-outline" disabled={!canManage || busy || (!title && !body && !link)} onClick={reset}><Icon name="close" /> Xóa nội dung</button>
          </div>
        </section>
        <AnnouncementPreview title={title} body={body} link={link || null} email={emailOn} from={mail.sender?.address ?? null} sender={sender} />
      </aside>
    </div>
    {confirming && <Modal title="Gửi thông báo" size="sm" busy={busy} onClose={() => setConfirming(false)}>
      <div className="cm-dialog-body cm-form">
        <strong>{recipients === null ? "Gửi tới các sinh viên được chọn?" : `Gửi tới ${number(recipients)} sinh viên?`}</strong>
        <p>“{title.trim()}” sẽ hiện ngay ở chuông thông báo của {byStudent ? pickedSummary(picked, 3) : everyone ? "tất cả sinh viên" : `sinh viên ${targetText(target, options)}`}. Bạn có thể thu hồi ở trang Đã gửi.</p>
        {emailOn && <p className="an-confirm-email"><Icon name="mail" /><span>
          Kèm email từ hộp thư <strong>{mail.sender?.address}</strong>{reachable !== null ? ` tới ${number(reachable)} sinh viên có địa chỉ email` : ""}, gửi dần khoảng 25 thư mỗi phút
          {reachable ? ` (xong sau khoảng ${number(emailMinutes(reachable))} phút)` : ""}. Email đã gửi không thu hồi được.</span></p>}
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
      <td><strong>{row.title}</strong>{row.sender === "edupath" && <span className="an-tag an-tag-edupath">EduPath AI</span>}{row.withdrawnAt && <span className="an-tag">Đã thu hồi</span>}</td>
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
        <div><dt>Gửi đến</dt><dd>{announcement.targetLabel}{announcement.target.students?.length ? <PickedRecipients id={announcement.id} />
          : announcement.target.picked ? <small className="an-detail-note">Danh sách sinh viên được chọn đã xóa sau 90 ngày, như thông báo trong chuông.</small> : null}</dd></div>
        <div><dt>Đã đọc</dt><dd>{readText(announcement)} sinh viên ({readShare(announcement)}%)</dd></div>
        <div><dt>Người gửi</dt><dd>{SENDERS[announcement.sender ?? "khoa"].name}</dd></div>
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

/** The students an announcement was sent to by picking them (GET /:id/recipients), as they are now. */
export function RecipientList({ items }: { items: RecipientStudent[] }) {
  if (!items.length) return <p className="an-muted">Không còn tài khoản sinh viên nào trong danh sách này.</p>;
  return <div className="an-problems an-recipients"><table>
    <thead><tr><th scope="col">Sinh viên</th><th scope="col">MSSV</th><th scope="col">Lớp</th></tr></thead>
    <tbody>{items.map((item) => <tr key={item.id}>
      <td>{item.name}{item.hasEmail ? null : <small>Chưa có email</small>}</td>
      <td className="an-num">{item.studentCode ?? "—"}</td>
      <td className="an-num">{item.className ?? "—"}</td>
    </tr>)}</tbody>
  </table></div>;
}
function PickedRecipients({ id }: { id: string }) {
  const remote = useData<{ items: RecipientStudent[] }>(`${ANNOUNCEMENTS_API}/${encodeURIComponent(id)}/recipients`);
  return <div className="an-recipients-box"><Status {...remote} />{remote.data && <RecipientList items={remote.data.items} />}</div>;
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
      <p>Thông báo sẽ biến mất khỏi chuông của {reachedText(announcement)}. Việc thu hồi không hoàn tác được.</p>
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
