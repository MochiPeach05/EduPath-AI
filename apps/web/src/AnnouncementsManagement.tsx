import { useEffect, useState } from "react";
import { ActionMenu, Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { CheckedForm } from "./CheckedForm";
import { majorOptions } from "./majors";
import { sortRows, useTableSort, type SortRule } from "./table-sort";
import { ANNOUNCEMENTS_API, ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, type Announcement, type AnnouncementTarget } from "./notification-types";
import "./curricula.css";
import "./careers.css";
import "./announcements.css";

// Quản lý thông báo (AD-NOTI-01, 02; 2026-10-30): the faculty writes an announcement to cohorts and majors (none chosen:
// every student) and it shows at once in the bell of those students; "Đã gửi" counts who has read each one and withdraws
// one from every bell. Email to the students' school address comes later (user: "tương lai sẽ làm thêm chức năng gửi về
// mail thật của sinh viên luôn nữa cơ mà không phải hiện tại"). Contract: notification-types.ts.

export const COMPOSE_PATH = "/quantri/gui-thong-bao";
export const SENT_PATH = "/quantri/thong-bao-da-gui";

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
};
export class AnnouncementRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(failures[code] ?? "Không thể thực hiện thao tác. Vui lòng thử lại."); this.name = "AnnouncementRequestError"; }
}
async function announcementRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${ANNOUNCEMENTS_API}${path}`, {
    credentials: "include", cache: "no-store", ...init,
    headers: init.body === undefined ? init.headers : { "Content-Type": "application/json", ...init.headers },
  });
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new AnnouncementRequestError(body.error ?? (response.status === 403 ? "forbidden" : "request_failed"), response.status);
  }
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
/** Who receives it: "Tất cả sinh viên", "K29, K30", "Công nghệ thông tin" or "K29 · Công nghệ thông tin". */
export function targetText(target: AnnouncementTarget, options: AnnouncementOptions): string {
  const majors = target.majors.map((code) => options.majors.find((major) => major.code === code)?.name ?? code);
  const parts = [target.cohorts.join(", "), majors.join(", ")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Tất cả sinh viên";
}
/** "204/312": students who read it out of those who received it. */
export const readText = (announcement: Pick<Announcement, "read" | "recipients">) =>
  `${announcement.read.toLocaleString("vi-VN")}/${announcement.recipients.toLocaleString("vi-VN")}`;
/** The share read, 0–100, for the small bar beside it. */
export const readShare = (announcement: Pick<Announcement, "read" | "recipients">) =>
  (announcement.recipients > 0 ? Math.min(100, Math.round((announcement.read / announcement.recipients) * 100)) : 0);
/** "08:30 28/10/2026" in Vietnam time, as the other admin pages print a time. */
export function sentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", ...options }).format(date);
  return `${part({ hour: "2-digit", minute: "2-digit", hour12: false })} ${part({ day: "2-digit", month: "2-digit", year: "numeric" })}`;
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
  return { text: `Khoảng ${count.toLocaleString("vi-VN")} sinh viên nhận được thông báo này.`, tone: "ok" };
}

/* ------------------------------------------------------------------ pages */

export default function AnnouncementsManagement({ canManage, section, navigate }: { canManage: boolean; section: "compose" | "sent"; navigate?: (path: string) => void }) {
  return section === "compose" ? <ComposeAnnouncement canManage={canManage} navigate={navigate} /> : <SentAnnouncements canManage={canManage} navigate={navigate} />;
}

/** The choices of "Gửi đến": GET /options, else FALLBACK_OPTIONS. */
function useAnnouncementOptions(): AnnouncementOptions {
  const [options, setOptions] = useState<AnnouncementOptions>(FALLBACK_OPTIONS);
  useEffect(() => {
    const controller = new AbortController();
    announcementRequest<Partial<AnnouncementOptions>>("/options", { signal: controller.signal }).then((data) => {
      const cohorts = Array.isArray(data.cohorts) ? data.cohorts.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
      const majors = Array.isArray(data.majors) ? data.majors.filter((item) => typeof item?.code === "string" && typeof item?.name === "string") : [];
      if (!controller.signal.aborted && (cohorts.length || majors.length)) setOptions({ cohorts: cohorts.length ? cohorts : FALLBACK_OPTIONS.cohorts, majors: majors.length ? majors : FALLBACK_OPTIONS.majors });
    }, () => undefined);
    return () => controller.abort();
  }, []);
  return options;
}

/** The student's view of the announcement while it is written. */
export function AnnouncementPreview({ title, body, link }: { title: string; body: string; link: string | null }) {
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
  </aside>;
}

function ComposeAnnouncement({ canManage, navigate }: { canManage: boolean; navigate?: (path: string) => void }) {
  const options = useAnnouncementOptions();
  const [target, setTarget] = useState<AnnouncementTarget>({ cohorts: [], majors: [] });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [countFailed, setCountFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Announcement | null>(null);
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
    setCount(null); setCountFailed(false);
    const timer = setTimeout(() => {
      announcementRequest<{ count: number }>(`/reach${query ? `?${query}` : ""}`, { signal: controller.signal })
        .then(({ count: next }) => { if (!controller.signal.aborted) setCount(next); }, () => { if (!controller.signal.aborted) setCountFailed(true); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const everyone = !target.cohorts.length && !target.majors.length;
  const reach = reachText(count, countFailed);
  const reset = () => { setTitle(""); setBody(""); setLink(""); setError(""); };
  const send = async () => {
    setBusy(true); setError("");
    try {
      const { announcement } = await announcementRequest<{ announcement: Announcement }>("", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), body: body.trim(), link: link || null, cohorts: target.cohorts, majors: target.majors }),
      });
      setSent(announcement); setConfirming(false); reset();
    } catch (failure) { setError((failure as Error).message); setConfirming(false); }
    finally { setBusy(false); }
  };
  return <section className="cm-workspace an-workspace">
    {sent && <div className="an-success" role="status">
      <Icon name="check" />
      <p>Đã gửi <strong>“{sent.title}”</strong> tới {sent.recipients.toLocaleString("vi-VN")} sinh viên ({sent.targetLabel}).</p>
      {navigate && <button type="button" className="am-outline" onClick={() => navigate(SENT_PATH)}>Xem thông báo đã gửi</button>}
    </div>}
    <div className="an-compose">
      <section className="cm-panel an-form-panel" aria-labelledby="an-compose-title">
        <div className="an-panel-head">
          <h2 id="an-compose-title">Soạn thông báo</h2>
          <p>Thông báo hiện ngay ở chuông thông báo của các sinh viên được chọn.</p>
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
              <small className="an-counter">{title.length.toLocaleString("vi-VN")}/{ANNOUNCEMENT_TITLE_MAX.toLocaleString("vi-VN")} ký tự</small>
            </label>
            <label><RequiredLabel>Nội dung</RequiredLabel>
              <textarea required maxLength={ANNOUNCEMENT_BODY_MAX} rows={6} value={body} placeholder="Nội dung sinh viên đọc khi mở thông báo" onChange={(event) => setBody(event.target.value)} />
              <small className="an-counter">{body.length.toLocaleString("vi-VN")}/{ANNOUNCEMENT_BODY_MAX.toLocaleString("vi-VN")} ký tự</small>
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
              <label className="cm-check an-off"><input type="checkbox" disabled /> <span>Email sinh viên <span className="an-soon">Sắp có</span></span></label>
            </fieldset>
          </fieldset>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="cm-actions">
            <button className="am-primary" disabled={!canManage || busy || count === 0}><Icon name="bell" /> Gửi thông báo</button>
            <button type="button" className="am-outline" disabled={!canManage || busy || (!title && !body && !link)} onClick={reset}><Icon name="close" /> Xóa nội dung</button>
          </div>
        </CheckedForm>
      </section>
      <AnnouncementPreview title={title} body={body} link={link || null} />
    </div>
    {confirming && <Modal title="Gửi thông báo" size="sm" busy={busy} onClose={() => setConfirming(false)}>
      <div className="cm-dialog-body cm-form">
        <strong>{count === null ? "Gửi tới các sinh viên được chọn?" : `Gửi tới ${count.toLocaleString("vi-VN")} sinh viên?`}</strong>
        <p>“{title.trim()}” sẽ hiện ngay ở chuông thông báo của {everyone ? "tất cả sinh viên" : `sinh viên ${targetText(target, options)}`}. Bạn có thể thu hồi ở trang Đã gửi.</p>
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
};

/** The sent announcements: the table, its detail and the withdrawal. */
export function SentTable({ items, canManage, sortHeader, sort, page, onDetail, onWithdraw }: {
  items: Announcement[]; canManage: boolean; sortHeader: ReturnType<typeof useTableSort>["sortHeader"]; sort: ReturnType<typeof useTableSort>["sort"];
  page: number; onDetail: (row: Announcement) => void; onWithdraw: (row: Announcement) => void;
}) {
  return <div className="cm-table-scroll"><table className="cm-table an-table">
    <thead><tr>{sortHeader("STT", "stt", "cm-stt")}{sortHeader("Tiêu đề", "title")}{sortHeader("Gửi đến", "target")}{sortHeader("Thời gian", "createdAt")}{sortHeader("Đã đọc", "read")}<th scope="col">Thao tác</th></tr></thead>
    <tbody>{sortRows(items, sentSort, sort).slice((page - 1) * 10, page * 10).map(({ row, stt }) => <tr key={row.id} className={row.withdrawnAt ? "an-withdrawn" : undefined}>
      <td className="cm-stt">{stt}</td>
      <td><strong>{row.title}</strong>{row.withdrawnAt && <span className="an-tag">Đã thu hồi</span>}</td>
      <td>{row.targetLabel}</td>
      <td className="an-num">{sentTime(row.createdAt)}</td>
      <td className="an-num"><span className="an-read"><span>{readText(row)}</span><span className="an-meter" aria-hidden="true"><i style={{ width: `${readShare(row)}%` }} /></span></span></td>
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
  return <section className="cm-workspace career-workspace an-workspace">
    <section className="cm-panel">
      <div className="career-list-heading">
        <div>
          <h2>Thông báo đã gửi{remote.data && <span className="am-count">{items.length}</span>}</h2>
          <p>Những thông báo Khoa đã gửi tới chuông của sinh viên, số sinh viên đã đọc, và thu hồi khi cần.</p>
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
    {mode === "detail" && selected && <Modal title="Chi tiết thông báo" onClose={close}>
      <div className="cm-dialog-body cm-form an-detail">
        <dl>
          <div><dt>Tiêu đề</dt><dd>{selected.title}</dd></div>
          <div><dt>Nội dung</dt><dd className="an-detail-body">{selected.body}</dd></div>
          <div><dt>Trang liên quan</dt><dd>{selected.link ? pageLabel(selected.link) ?? selected.link : "Không có"}</dd></div>
          <div><dt>Gửi đến</dt><dd>{selected.targetLabel}</dd></div>
          <div><dt>Đã đọc</dt><dd>{readText(selected)} sinh viên ({readShare(selected)}%)</dd></div>
          <div><dt>Thời gian gửi</dt><dd>{sentTime(selected.createdAt)}{selected.createdBy ? ` · ${selected.createdBy}` : ""}</dd></div>
          {selected.withdrawnAt && <div><dt>Thu hồi lúc</dt><dd>{sentTime(selected.withdrawnAt)}</dd></div>}
        </dl>
        <div className="cm-actions cm-dialog-actions">
          <button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button>
          {canManage && !selected.withdrawnAt && <button className="am-primary am-delete" onClick={() => setMode("withdraw")}><Icon name="trash" /> Thu hồi thông báo</button>}
        </div>
      </div>
    </Modal>}
    {canManage && mode === "withdraw" && selected && <WithdrawDialog announcement={selected} close={close} done={() => { close(); setRevision((n) => n + 1); }} />}
  </section>;
}

function WithdrawDialog({ announcement, close, done }: { announcement: Announcement; close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="Thu hồi thông báo" onClose={close} busy={busy} size="sm">
    <div className="cm-dialog-body cm-form">
      <strong>{announcement.title}</strong>
      <p>Thông báo sẽ biến mất khỏi chuông của {announcement.recipients.toLocaleString("vi-VN")} sinh viên ({announcement.targetLabel}). Việc thu hồi không hoàn tác được.</p>
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
