import { useEffect, useState, type ReactNode } from "react";
import { ActionMenu, Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { CheckedForm } from "./CheckedForm";
import { sortRows, useTableSort, type SortRule } from "./table-sort";
import { ANNOUNCEMENTS_API, type RegistrationKind, type RegistrationWindow } from "./notification-types";
import { announcementRequest, sentTime, SETTINGS_PATH, toggleValue, useAnnouncementOptions } from "./AnnouncementsManagement";
import "./curricula.css";
import "./careers.css";
import "./announcements.css";

// Lịch đăng ký học tập (2026-11-25; the user, with Phòng Đào tạo's notices of HK252, HK253 and HK261: "Hãy dựa vào cái lịch
// này thêm 1 cái nút thông báo nhắc nhở đăng ký kế hoạch học tập khi đến thời gian"): the admin enters each window of the
// notice (đăng ký kế hoạch học tập or đăng ký học phần, its đợt, cohorts and times) and EduPath AI reminds those students
// when its time comes (api notifications/registration.ts). The switch "Nhắc đăng ký học tập" of Cài đặt thông báo turns
// the reminders, and their email, on and off. Contract: notification-types.ts.

const REGISTRATION_API = `${ANNOUNCEMENTS_API}/registration`;
export const REGISTRATION_KIND_LABELS: Readonly<Record<RegistrationKind, string>> = { study_plan: "Đăng ký kế hoạch học tập", course: "Đăng ký học phần" };
export const REMIND_OPTIONS: readonly { value: 0 | 1440 | 2880; label: string }[] = [
  { value: 0, label: "Khi mở đăng ký" }, { value: 1440, label: "Trước 1 ngày" }, { value: 2880, label: "Trước 2 ngày" },
];
/** The đợt names of Phòng Đào tạo's notices, offered while typing. */
export const ROUND_SUGGESTIONS = ["Đợt 1", "Đợt 2 (bổ sung)", "Đợt 1: Đăng ký chính thức", "Đợt 2: Điều chỉnh", "Đợt 3: Đăng ký bổ sung"];
const number = (value: number) => value.toLocaleString("vi-VN");

/** "HK262" → "HK2 2026–2027", as every page writes a term. */
export function termLabel(code: string): string {
  const match = /^HK(\d{2})([1-3])$/.exec(code);
  if (!match) return code;
  const start = 2000 + Number(match[1]);
  return `HK${match[2]} ${start}–${start + 1}`;
}
/**
 * The terms a window may belong to, around `now`: the school year that is running (it starts in August or September), the
 * one before and the one after, and the term whose registration comes next, chosen first: HK2 while HK1 runs (August to
 * December), HK3 while HK2 runs (January to April), HK1 of the next year after that.
 */
export function termChoices(now: Date): { codes: string[]; next: string } {
  const month = now.getMonth() + 1, year = now.getFullYear();
  const running = month >= 8 ? year : year - 1;
  const code = (start: number, term: number) => `HK${String(start % 100).padStart(2, "0")}${term}`;
  const codes = [running - 1, running, running + 1].flatMap((start) => [1, 2, 3].map((term) => code(start, term)));
  const next = month >= 8 ? code(running, 2) : month <= 4 ? code(running, 3) : code(running + 1, 1);
  return { codes, next };
}
/** "2026-11-26T22:00" (a datetime-local field, Vietnam time) → "2026-11-26T22:00:00+07:00"; "" when empty. */
export const toVietnamIso = (local: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00+07:00` : "");
/** An ISO moment → "2026-11-26T22:00" in Vietnam time, for a datetime-local field. */
export function toVietnamLocal(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const shifted = new Date(at.getTime() + 7 * 3_600_000);
  return shifted.toISOString().slice(0, 16);
}
/** "K29, K30" or "Tất cả sinh viên". */
export const cohortsLabel = (cohorts: readonly string[]) => (cohorts.length ? cohorts.join(", ") : "Tất cả sinh viên");
export const remindLabel = (minutes: number) => REMIND_OPTIONS.find((option) => option.value === minutes)?.label ?? "Khi mở đăng ký";

/** Where a window's reminder stands, as the list says it: a short state and one line of detail. */
export function windowState(window: RegistrationWindow, now = Date.now()): { tone: "wait" | "due" | "sent" | "off"; label: string; detail: string } {
  if (window.outcome === "sent") {
    if (window.withdrawnAt) return { tone: "off", label: "Đã thu hồi", detail: `Thu hồi lúc ${sentTime(window.withdrawnAt)}` };
    return { tone: "sent", label: "Đã nhắc", detail: `${sentTime(window.remindedAt!)} · ${number(window.recipients ?? 0)} sinh viên · đã đọc ${number(window.read)}` };
  }
  if (window.outcome === "closed") return { tone: "off", label: "Không nhắc", detail: "Đợt đã kết thúc trước giờ nhắc" };
  if (window.outcome === "turned_off") return { tone: "off", label: "Không nhắc", detail: "Nhắc đăng ký học tập đang tắt ở Cài đặt thông báo" };
  if (window.outcome === "nobody") return { tone: "off", label: "Không nhắc", detail: "Không có sinh viên nào thuộc khóa đã chọn" };
  if (new Date(window.remindAt).getTime() <= now) return { tone: "due", label: "Sắp gửi", detail: "Đến giờ nhắc, EduPath AI gửi trong ít phút" };
  return { tone: "wait", label: "Chờ nhắc", detail: `Nhắc lúc ${sentTime(window.remindAt)}` };
}

const scheduleSort: Record<string, SortRule<RegistrationWindow>> = {
  round: { value: (row) => row.round },
  term: { value: (row) => row.termCode },
  cohorts: { value: (row) => cohortsLabel(row.cohorts) },
  opensAt: { value: (row) => row.opensAt, by: "date" },
  remindAt: { value: (row) => row.remindAt, by: "date" },
  state: { value: (row) => windowState(row).label, order: ["Sắp gửi", "Chờ nhắc", "Đã nhắc", "Đã thu hồi", "Không nhắc"] },
};

/** The list of windows: the đợt, its term, cohorts, times, when it reminds and what happened, with the row's actions. */
export function ScheduleTable({ items, canManage, sortHeader, sort, page, onAction }: {
  items: RegistrationWindow[]; canManage: boolean; sortHeader: ReturnType<typeof useTableSort>["sortHeader"]; sort: ReturnType<typeof useTableSort>["sort"];
  page: number; onAction: (action: "view" | "edit" | "remind" | "withdraw" | "delete", row: RegistrationWindow) => void;
}) {
  return <div className="cm-table-scroll"><table className="cm-table an-table rg-table">
    <thead><tr>{sortHeader("STT", "stt", "cm-stt")}{sortHeader("Đợt", "round")}{sortHeader("Học kỳ", "term")}{sortHeader("Khóa", "cohorts")}
      {sortHeader("Thời gian", "opensAt")}{sortHeader("Nhắc", "remindAt")}{sortHeader("Trạng thái", "state")}<th scope="col">Thao tác</th></tr></thead>
    <tbody>{sortRows(items, scheduleSort, sort).slice((page - 1) * 10, page * 10).map(({ row, stt }) => {
      const state = windowState(row);
      const open = !row.remindedAt && new Date(row.closesAt).getTime() > Date.now();
      return <tr key={row.id} className={state.tone === "off" ? "an-withdrawn" : undefined}>
        <td className="cm-stt">{stt}</td>
        <td><strong>{row.round}</strong><small>{row.kindLabel}</small></td>
        <td className="an-num">{row.termLabel}</td>
        <td>{cohortsLabel(row.cohorts)}</td>
        <td className="an-num"><span className="rg-times"><span>{sentTime(row.opensAt)}</span><span>đến {sentTime(row.closesAt)}</span></span></td>
        <td><span className="rg-times"><span>{remindLabel(row.remindBefore)}</span><small>{sentTime(row.remindAt)}</small></span></td>
        <td><span className={`rg-state rg-state-${state.tone}`}>{state.label}</span><small className="rg-state-detail">{state.detail}</small></td>
        <td><ActionMenu label={`Thao tác với ${row.round} ${row.termLabel}`} items={[
          { key: "view", icon: "eye", label: "Xem lời nhắc", onSelect: () => onAction("view", row) },
          ...(canManage && !row.remindedAt ? [{ key: "edit", icon: "edit", label: "Sửa đợt đăng ký", onSelect: () => onAction("edit", row) }] : []),
          ...(canManage && open ? [{ key: "remind", icon: "bell", label: "Gửi nhắc ngay", onSelect: () => onAction("remind", row) }] : []),
          ...(canManage && row.outcome === "sent" && !row.withdrawnAt ? [{ key: "withdraw", icon: "close", label: "Thu hồi lần nhắc", danger: true, onSelect: () => onAction("withdraw", row) }] : []),
          ...(canManage ? [{ key: "delete", icon: "trash", label: "Xóa đợt đăng ký", danger: true, onSelect: () => onAction("delete", row) }] : []),
        ]} /></td>
      </tr>;
    })}</tbody>
  </table></div>;
}

/** The reminder as a student sees it in the bell, under EduPath AI's name. */
export function ReminderPreview({ reminder }: { reminder: { title: string; body: string } | null }) {
  if (!reminder) return <p className="an-hint">Điền đủ học kỳ, đợt và thời gian để xem lời nhắc sinh viên nhận.</p>;
  return <div className="rg-reminder">
    <div className="an-note-row">
      <span className="an-note-icon an-note-icon-edupath" aria-hidden="true">i</span>
      <span className="an-note-text"><strong>{reminder.title}</strong><small>Hệ thống · lời nhắc của EduPath AI</small></span>
      <span className="an-note-dot" aria-hidden="true" />
    </div>
    <p className="an-preview-body">{reminder.body}</p>
    <span className="an-preview-button">Mở Lộ trình học tập</span>
  </div>;
}

type Draft = { termCode: string; kind: RegistrationKind; round: string; cohorts: string[]; opens: string; closes: string; remindBefore: 0 | 1440 | 2880; note: string };
const draftOf = (window: RegistrationWindow | null, next: string): Draft => (window ? {
  termCode: window.termCode, kind: window.kind, round: window.round, cohorts: window.cohorts, opens: toVietnamLocal(window.opensAt),
  closes: toVietnamLocal(window.closesAt), remindBefore: window.remindBefore, note: window.note ?? "",
} : { termCode: next, kind: "course", round: "Đợt 1", cohorts: [], opens: "", closes: "", remindBefore: 0, note: "" });
/** The request body of a draft, or null while its times are missing or out of order. */
export function windowBody(draft: Draft) {
  const opensAt = toVietnamIso(draft.opens), closesAt = toVietnamIso(draft.closes);
  if (!draft.round.trim() || !opensAt || !closesAt || new Date(closesAt).getTime() <= new Date(opensAt).getTime()) return null;
  return { termCode: draft.termCode, kind: draft.kind, round: draft.round.trim(), cohorts: draft.cohorts, opensAt, closesAt, remindBefore: draft.remindBefore,
    note: draft.note.trim() || null };
}

function WindowDialog({ window, close, saved }: { window: RegistrationWindow | null; close: () => void; saved: (item: RegistrationWindow) => void }) {
  const options = useAnnouncementOptions();
  const terms = termChoices(new Date());
  const [draft, setDraft] = useState<Draft>(() => draftOf(window, terms.next));
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const body = windowBody(draft);
  const key = body ? JSON.stringify(body) : "";
  const timesOutOfOrder = Boolean(toVietnamIso(draft.opens) && toVietnamIso(draft.closes) && !body && draft.round.trim());
  // The reminder students would get, asked again a moment after the fields change.
  useEffect(() => {
    if (!key) { setPreview(null); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      announcementRequest<{ reminder: { title: string; body: string } }>("/registration/preview", { method: "POST", body: key, signal: controller.signal })
        .then((data) => { if (!controller.signal.aborted) setPreview(data.reminder); }, () => { if (!controller.signal.aborted) setPreview(null); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key]);
  const termCodes = terms.codes.includes(draft.termCode) ? terms.codes : [draft.termCode, ...terms.codes];
  return <Modal title={window ? "Sửa đợt đăng ký" : "Thêm đợt đăng ký"} busy={busy} onClose={close}>
    <CheckedForm className="cm-dialog-body cm-form rg-form" onSubmit={async (event) => {
      event.preventDefault();
      if (!body) { setError(timesOutOfOrder ? "Thời gian kết thúc phải sau thời gian bắt đầu." : "Vui lòng điền đủ đợt và thời gian."); return; }
      setBusy(true); setError("");
      try {
        const result = await announcementRequest<{ item: RegistrationWindow }>(window ? `/registration/${encodeURIComponent(window.id)}` : "/registration", {
          method: window ? "PUT" : "POST", body: JSON.stringify(body),
        });
        saved(result.item);
      } catch (failure) { setError((failure as Error).message); setBusy(false); }
    }}>
      <fieldset className="cm-fields" disabled={busy}>
        <div className="rg-row">
          <label>Học kỳ
            <select id="rg-term" value={draft.termCode} onChange={(event) => set("termCode", event.target.value)}>
              {termCodes.map((code) => <option key={code} value={code}>{termLabel(code)}</option>)}
            </select>
          </label>
          <label><RequiredLabel>Đợt</RequiredLabel>
            <input id="rg-round" required maxLength={60} list="rg-rounds" value={draft.round} onChange={(event) => set("round", event.target.value)} placeholder="Ví dụ: Đợt 1" />
            <datalist id="rg-rounds">{ROUND_SUGGESTIONS.map((round) => <option key={round} value={round} />)}</datalist>
          </label>
        </div>
        <div className="rg-field">
          <span className="an-search-label" id="rg-kind-label">Loại đăng ký</span>
          <div className="an-seg" role="group" aria-labelledby="rg-kind-label">
            {(["study_plan", "course"] as const).map((kind) => <button key={kind} type="button" aria-pressed={draft.kind === kind} onClick={() => set("kind", kind)}>{REGISTRATION_KIND_LABELS[kind]}</button>)}
          </div>
        </div>
        <fieldset className="an-targets rg-field">
          <legend className="an-search-label">Khóa</legend>
          <div className="an-chip-row" role="group" aria-label="Khóa">
            <button type="button" aria-pressed={!draft.cohorts.length} onClick={() => set("cohorts", [])}>Tất cả sinh viên</button>
            {options.cohorts.map((cohort) => <button key={cohort} type="button" aria-pressed={draft.cohorts.includes(cohort)}
              onClick={() => set("cohorts", options.cohorts.filter((item) => toggleValue(draft.cohorts, cohort).includes(item)))}>{cohort}</button>)}
          </div>
          <p className="an-hint">Chọn các khóa của đợt như trong thông báo (ví dụ K30 &amp; K31); không chọn là tất cả sinh viên.</p>
        </fieldset>
        <div className="rg-row">
          <label><RequiredLabel>Bắt đầu</RequiredLabel>
            <input id="rg-opens" type="datetime-local" required value={draft.opens} onChange={(event) => set("opens", event.target.value)} />
          </label>
          <label><RequiredLabel>Kết thúc</RequiredLabel>
            <input id="rg-closes" type="datetime-local" required value={draft.closes} onChange={(event) => set("closes", event.target.value)} />
          </label>
        </div>
        <p className="an-hint">Giờ Việt Nam, như trong thông báo của Phòng Đào tạo (ví dụ từ 22:00 ngày 26/11 đến 14:00 ngày 27/11).</p>
        {timesOutOfOrder && <p className="an-hint an-hint-warn" role="alert">Thời gian kết thúc phải sau thời gian bắt đầu.</p>}
        <label>Nhắc sinh viên
          <select id="rg-remind" value={draft.remindBefore} onChange={(event) => set("remindBefore", Number(event.target.value) as Draft["remindBefore"])}>
            {REMIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>Ghi chú (không bắt buộc)
          <textarea id="rg-note" maxLength={300} rows={3} value={draft.note} onChange={(event) => set("note", event.target.value)} placeholder="Thêm vào lời nhắc, ví dụ lưu ý riêng của đợt này" />
          <small className="an-counter">{number(draft.note.length)}/300 ký tự</small>
        </label>
        <section className="rg-preview" aria-labelledby="rg-preview-title">
          <h3 id="rg-preview-title">Sinh viên sẽ nhận</h3>
          <ReminderPreview reminder={preview} />
        </section>
      </fieldset>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu đợt đăng ký"}</button>
      </div>
    </CheckedForm>
  </Modal>;
}

function ConfirmDialog({ title, children, action, icon, danger = false, close, run }: {
  title: string; children: ReactNode; action: string; icon: string; danger?: boolean; close: () => void; run: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title={title} size="sm" busy={busy} onClose={close}>
    <div className="cm-dialog-body cm-form">
      {children}
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button type="button" className={`am-primary${danger ? " am-delete" : ""}`} disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await run(); } catch (failure) { setError((failure as Error).message); setBusy(false); }
        }}><Icon name={icon} /> {busy ? "Đang thực hiện…" : action}</button>
      </div>
    </div>
  </Modal>;
}

export default function RegistrationSchedule({ canManage, navigate }: { canManage: boolean; navigate?: (path: string) => void }) {
  const [revision, setRevision] = useState(0);
  const remote = useData<{ items: RegistrationWindow[]; setting?: { enabled: boolean; email: boolean } }>(`${ANNOUNCEMENTS_API}/registration`, revision);
  const [page, setPage] = useState(1);
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  const [dialog, setDialog] = useState<{ action: "add" | "view" | "edit" | "remind" | "withdraw" | "delete"; row: RegistrationWindow | null } | null>(null);
  const [notice, setNotice] = useState("");
  const items = remote.data?.items ?? [];
  const setting = remote.data?.setting ?? { enabled: true, email: false };
  const close = () => setDialog(null);
  const done = (text: string) => { setDialog(null); setNotice(text); setRevision((n) => n + 1); };
  const row = dialog?.row ?? null;
  return <section className="cm-workspace career-workspace an-workspace">
    <section className="cm-panel">
      <div className="career-list-heading">
        <div>
          <h2>Lịch đăng ký học tập{remote.data && <span className="am-count">{items.length}</span>}</h2>
          <p>Nhập các đợt đăng ký kế hoạch học tập và đăng ký học phần theo thông báo của Phòng Đào tạo. Khi đến thời gian của từng đợt, EduPath AI tự nhắc sinh viên của đợt đó trong chuông thông báo.</p>
        </div>
        {canManage && <button className="am-primary" onClick={() => { setNotice(""); setDialog({ action: "add", row: null }); }}><Icon name="plus" /> Thêm đợt đăng ký</button>}
      </div>
      {remote.data && <div className={`rg-setting${setting.enabled ? "" : " rg-setting-off"}`}>
        <p>{setting.enabled
          ? <>Nhắc đăng ký học tập đang bật: lời nhắc hiện trong chuông thông báo{setting.email ? " và gửi email trường" : ""} của sinh viên, đứng tên EduPath AI.</>
          : <>Nhắc đăng ký học tập đang tắt ở Cài đặt thông báo: đến giờ nhắc, EduPath AI sẽ không gửi gì.</>}</p>
        {navigate && <button type="button" className="am-outline an-small-btn" onClick={() => navigate(SETTINGS_PATH)}><Icon name="settings" /> Mở Cài đặt thông báo</button>}
      </div>}
      {notice && <p className="an-email-ok" role="status">{notice}</p>}
      <Status {...remote} />
      {remote.data && <>
        <ScheduleTable items={items} canManage={canManage} sortHeader={sortHeader} sort={sort} page={page} onAction={(action, item) => { setNotice(""); setDialog({ action, row: item }); }} />
        {!items.length && <p className="am-empty">Chưa có đợt đăng ký nào. Bấm “Thêm đợt đăng ký” và nhập lịch theo thông báo của Phòng Đào tạo.</p>}
        <Pagination total={items.length} page={page} setPage={setPage} />
        <p className="an-hint rg-foot">Lời nhắc gửi trong khoảng một phút sau giờ nhắc. Máy chủ EduPath AI tạm nghỉ khi lâu không có ai truy cập; khi đó lời nhắc gửi lúc có người mở lại EduPath AI, nếu đợt chưa kết thúc.</p>
      </>}
    </section>
    {dialog && (dialog.action === "add" || dialog.action === "edit") && <WindowDialog window={row} close={close}
      saved={(item) => done(`Đã lưu ${item.round} ${item.termLabel}. EduPath AI sẽ nhắc lúc ${sentTime(item.remindAt)}.`)} />}
    {dialog?.action === "view" && row && <Modal title="Lời nhắc của đợt" onClose={close}>
      <div className="cm-dialog-body cm-form">
        <p className="an-hint">{row.round} · {row.kindLabel} {row.termLabel} · {cohortsLabel(row.cohorts)}</p>
        <ReminderPreview reminder={row.reminder} />
        <div className="cm-actions cm-dialog-actions"><button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button></div>
      </div>
    </Modal>}
    {dialog?.action === "remind" && row && <ConfirmDialog title="Gửi nhắc ngay" action="Gửi nhắc ngay" icon="bell" close={close}
      run={async () => {
        const result = await announcementRequest<{ item: RegistrationWindow }>(`/registration/${encodeURIComponent(row.id)}/remind`, { method: "POST", body: "{}" });
        const state = windowState(result.item);
        done(result.item.outcome === "sent" ? `Đã gửi lời nhắc tới ${number(result.item.recipients ?? 0)} sinh viên.` : `Không gửi lời nhắc: ${state.detail.toLowerCase()}.`);
      }}>
      <strong>{row.round} · {row.kindLabel} {row.termLabel}</strong>
      <p>Gửi lời nhắc tới {cohortsLabel(row.cohorts).toLowerCase() === "tất cả sinh viên" ? "tất cả sinh viên" : `sinh viên ${cohortsLabel(row.cohorts)}`} ngay bây giờ, đứng tên EduPath AI{setting.email ? ", kèm email trường" : ""}. Mỗi đợt chỉ nhắc một lần.</p>
    </ConfirmDialog>}
    {dialog?.action === "withdraw" && row && <ConfirmDialog title="Thu hồi lần nhắc" action="Thu hồi lần nhắc" icon="close" danger close={close}
      run={async () => {
        await announcementRequest(`/registration/${encodeURIComponent(row.id)}/withdraw`, { method: "POST", body: "{}" });
        done("Đã thu hồi lời nhắc khỏi chuông của sinh viên.");
      }}>
      <strong>{row.round} · {row.kindLabel} {row.termLabel}</strong>
      <p>Lời nhắc sẽ biến mất khỏi chuông của {number(row.recipients ?? 0)} sinh viên. Email đã gửi không thu hồi được.</p>
    </ConfirmDialog>}
    {dialog?.action === "delete" && row && <ConfirmDialog title="Xóa đợt đăng ký" action="Xóa đợt đăng ký" icon="trash" danger close={close}
      run={async () => {
        await announcementRequest(`/registration/${encodeURIComponent(row.id)}`, { method: "DELETE" });
        done(`Đã xóa ${row.round} ${row.termLabel} khỏi Lịch đăng ký.`);
      }}>
      <strong>{row.round} · {row.kindLabel} {row.termLabel}</strong>
      <p>Đợt này sẽ không còn trong Lịch đăng ký{row.remindedAt ? "" : " và EduPath AI sẽ không nhắc nữa"}.{row.outcome === "sent" && !row.withdrawnAt
        ? " Lời nhắc đã gửi vẫn còn trong chuông của sinh viên; muốn gỡ, hãy Thu hồi lần nhắc trước khi xóa." : ""}</p>
    </ConfirmDialog>}
  </section>;
}
