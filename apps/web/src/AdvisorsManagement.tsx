import { useRef, useState } from "react";
import { ActionMenu, Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel, SignInTime, roleLabels, signInClass } from "./admin-account-shared";
import { CheckedForm } from "./CheckedForm";
import { sortRows, useTableSort, type SortRule, type TableSort } from "./table-sort";
import {
  ADVISORS_API, type AdvisorAccountStatus, type AdvisorClassDetail, type AdvisorDetail, type AdvisorImportItem, type AdvisorImportPreview,
  type AdvisorImportResult, type AdvisorInput, type AdvisorRow,
} from "./advisor-types";
import {
  ACCOUNT_TEXT, IMPORT_AGAIN_TEXT, IMPORT_STATUS_TEXT, advisorRequest, advisorTime, classPreview, forgetChosenFile, importNothingText, importResultText,
  importSummaryText, importableCount, matchesSearch, readWorkbook, splitClasses, uploadWorkbook, type ChosenWorkbook,
} from "./advisor-admin";
import type { AppRole } from "./types";
import "./curricula.css";
import "./careers.css";
import "./advisors.css";

// Quản lý cố vấn học tập (AD-ADV-01…05; user 2026-11-03): the Khoa's advisors with the classes each one advises. Every
// admin-portal account reads the list (QTV & CVHT); the admins and Ban chủ nhiệm khoa add, edit, delete and import
// (canManage = canManageAdvisors). An advisor's account is created ahead of the first Microsoft sign-in (migration 058).
// Contract: advisor-types.ts.

// The columns the list sorts by (table-sort.tsx); STT keeps the row's number in the list by name (from the server).
const advisorSort: Record<string, SortRule<AdvisorRow>> = {
  stt: { value: (row) => row.stt, by: "number" },
  name: { value: (row) => row.name, by: "name" },
  staffCode: { value: (row) => row.staffCode },
  unit: { value: (row) => row.unit },
  classes: { value: (row) => row.classes.length, by: "number" },
  students: { value: (row) => row.students, by: "number" },
  account: { value: (row) => row.account, order: ["active", "pending", "locked"] satisfies AdvisorAccountStatus[] },
};
const classSort: Record<string, SortRule<AdvisorClassDetail>> = {
  className: { value: (row) => row.className },
  cohort: { value: (row) => row.cohort },
  students: { value: (row) => row.students, by: "number" },
  withTranscript: { value: (row) => row.withTranscript, by: "number" },
  assessed: { value: (row) => row.assessed, by: "number" },
};
// What the preview adds since the Khoa's own workbook is read (apps/api/src/advisors/import.ts, 2026-11-03; not yet in
// advisor-types.ts): notes on the sheets read and how they compare, and per advisor the sheet its rows are in when that
// is not the first sheet read.
type ImportNote = { text: string; tone: "info" | "warn" };
type PreviewItem = AdvisorImportItem & { sheet?: string };
type SheetPreview = AdvisorImportPreview & { items: PreviewItem[]; sheets?: string[]; notes?: ImportNote[] };

/** "6–9, 12" for the rows 6, 7, 8, 9 and 12: three rows or more in a row are written as a range. */
export function rowsText(rows: readonly number[]): string {
  const parts: string[] = [];
  for (let start = 0; start < rows.length;) {
    let end = start;
    while (end + 1 < rows.length && rows[end + 1] === rows[end]! + 1) end++;
    parts.push(end - start >= 2 ? `${rows[start]}–${rows[end]}` : rows.slice(start, end + 1).join(", "));
    start = end + 1;
  }
  return parts.join(", ");
}

// A preview is read for its errors first: Lỗi, then what changes, then what stays.
const importSort: Record<string, SortRule<PreviewItem>> = {
  rows: { value: (row) => row.rows[0], by: "number" },
  name: { value: (row) => row.name, by: "name" },
  classes: { value: (row) => row.classes.length, by: "number" },
  status: { value: (row) => row.status, order: ["error", "add", "update", "unchanged"] satisfies AdvisorImportItem["status"][] },
};

const roleText = (role: string) => roleLabels[role as AppRole] ?? role;

/** The classes of a cell: the first ones, then "+n" (the whole list in the tooltip). */
export function ClassChips({ classes, shown = 3 }: { classes: readonly string[]; shown?: number }) {
  if (!classes.length) return <span className="career-empty">Chưa có lớp</span>;
  const { shown: first, more } = classPreview(classes, shown);
  return <span className="av-classes" title={classes.join(", ")}>
    {first.map((name) => <span key={name} className="av-class">{name}</span>)}
    {more > 0 && <span className="av-more">+{more}</span>}
  </span>;
}

/** The advisor's account: Chưa đăng nhập in red and Đang hoạt động in green (signInClass), Đã khóa in the red of a locked account. */
export function AccountState({ status }: { status: AdvisorAccountStatus }) {
  return <span className={`am-state av-state ${status === "locked" ? "am-state-locked" : signInClass(status === "active")}`}>{ACCOUNT_TEXT[status]}</span>;
}

type RowMode = "detail" | "edit" | "delete";

/** The list's table, one page of 10 rows (exported for its test). */
export function AdvisorTable({ rows, canManage, sort, sortHeader, page, onPick }: {
  rows: readonly AdvisorRow[]; canManage: boolean; sort: TableSort; sortHeader: ReturnType<typeof useTableSort>["sortHeader"]; page: number;
  onPick: (row: AdvisorRow, mode: RowMode) => void;
}) {
  return <div className="cm-table-scroll"><table className="cm-table av-table">
    <thead><tr>{sortHeader("STT", "stt", "cm-stt")}{sortHeader("Cố vấn học tập", "name")}{sortHeader("Mã giảng viên", "staffCode")}{sortHeader("Đơn vị", "unit")}
      {sortHeader("Lớp phụ trách", "classes")}{sortHeader("Sinh viên", "students")}{sortHeader("Tài khoản", "account")}<th scope="col">Thao tác</th></tr></thead>
    <tbody>{sortRows(rows, advisorSort, sort).slice((page - 1) * 10, page * 10).map(({ row }) => <tr key={row.userId}>
      <td className="cm-stt">{row.stt}</td>
      <td><button type="button" className="am-name-link" onClick={() => onPick(row, "detail")}>{row.name}</button><small>{row.email}</small></td>
      <td>{row.staffCode ?? <span className="career-empty">—</span>}</td>
      <td>{row.unit ?? <span className="career-empty">—</span>}</td>
      <td><ClassChips classes={row.classes} /></td>
      <td className="av-num">{row.students.toLocaleString("vi-VN")}</td>
      <td><AccountState status={row.account} /></td>
      <td><ActionMenu label={`Thao tác với cố vấn học tập ${row.name}`} items={[
        { key: "detail", icon: "eye", label: "Xem chi tiết", onSelect: () => onPick(row, "detail") },
        ...(canManage ? [
          { key: "edit", icon: "edit", label: "Chỉnh sửa cố vấn", onSelect: () => onPick(row, "edit") },
          { key: "delete", icon: "trash", label: "Xóa cố vấn", danger: true, onSelect: () => onPick(row, "delete") },
        ] : []),
      ]} /></td>
    </tr>)}</tbody>
  </table></div>;
}

export default function AdvisorsManagement({ canManage }: { canManage: boolean }) {
  const [revision, setRevision] = useState(0);
  const remote = useData<{ items: AdvisorRow[] }>(ADVISORS_API, revision);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  const [selected, setSelected] = useState<AdvisorRow | null>(null);
  const [mode, setMode] = useState<RowMode | "import" | null>(null);
  const [notice, setNotice] = useState("");
  const close = () => { setMode(null); setSelected(null); };
  const done = (message: string) => { close(); setNotice(message); setRevision((value) => value + 1); };
  const start = (next: "edit" | "import") => { setSelected(null); setNotice(""); setMode(next); };
  const items = remote.data?.items.filter((row) => matchesSearch(query, row.name, row.email, row.staffCode, row.unit, row.classes.join(" "))) ?? [];
  return <section className="cm-workspace career-workspace av-workspace">
    {notice && <p className="cm-success av-notice" role="status">{notice}</p>}
    <section className="cm-panel">
      <div className="career-list-heading">
        <div>
          <h2>Cố vấn học tập{remote.data && <span className="am-count">{items.length}</span>}</h2>
          <p>Cố vấn học tập của Khoa và các lớp từng người phụ trách. Cố vấn đăng nhập trang quản trị bằng email Microsoft của trường và chỉ mở được trang của sinh viên thuộc lớp mình.</p>
        </div>
        {canManage && <div className="av-heading-actions">
          <button className="am-outline" onClick={() => start("import")}><Icon name="upload" /> Import danh sách</button>
          <button className="am-primary" onClick={() => start("edit")}><Icon name="plus" /> Thêm cố vấn</button>
        </div>}
      </div>
      <div className="cm-filters career-catalog-filters">
        <label className="cm-search">Tìm cố vấn học tập<input type="search" value={query} maxLength={200} placeholder="Họ tên, email, mã giảng viên, đơn vị hoặc lớp…"
          onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
      </div>
      <Status {...remote} />
      {remote.data && <>
        <AdvisorTable rows={items} canManage={canManage} sort={sort} sortHeader={sortHeader} page={page}
          onPick={(row, next) => { setSelected(row); setNotice(""); setMode(next); }} />
        {!items.length && <p className="am-empty">{query ? "Không có cố vấn học tập phù hợp." : canManage ? "Chưa có cố vấn học tập nào. Import danh sách của Khoa hoặc thêm từng cố vấn." : "Chưa có cố vấn học tập nào."}</p>}
        <Pagination total={items.length} page={page} setPage={setPage} />
      </>}
    </section>
    {mode === "detail" && selected && <AdvisorDetailDialog id={selected.userId} canManage={canManage} close={close} edit={() => setMode("edit")} />}
    {canManage && mode === "edit" && <AdvisorEditor current={selected} close={close}
      saved={(advisor, created) => done(created
        ? `Đã thêm ${advisor.name} (${advisor.classes.length} lớp).${advisor.account === "pending" ? " Tài khoản được tạo sẵn: cố vấn đăng nhập trang quản trị bằng đúng email này." : ""}`
        : `Đã lưu thông tin của ${advisor.name}.`)} />}
    {canManage && mode === "delete" && selected && <AdvisorDelete current={selected} close={close} deleted={() => done(`Đã xóa ${selected.name} khỏi danh sách cố vấn học tập.`)} />}
    {canManage && mode === "import" && <AdvisorImport close={close} imported={(result) => done(importResultText(result))} />}
  </section>;
}

/** The classes of one advisor with their students (in the detail dialog). */
export function ClassDetailTable({ classes }: { classes: readonly AdvisorClassDetail[] }) {
  const { sort, sortHeader } = useTableSort();
  if (!classes.length) return <p className="career-empty">Cố vấn chưa được phân công lớp nào.</p>;
  return <div className="cm-table-scroll"><table className="cm-table av-class-table">
    <thead><tr>{sortHeader("Lớp", "className")}{sortHeader("Khóa", "cohort")}{sortHeader("Sinh viên", "students")}{sortHeader("Có bảng điểm", "withTranscript")}{sortHeader("Đã đánh giá năng lực", "assessed")}</tr></thead>
    <tbody>{sortRows(classes, classSort, sort).map(({ row }) => <tr key={row.className}>
      <td><strong>{row.className}</strong></td><td>{row.cohort ?? "—"}</td>
      <td className="av-num">{row.students}</td><td className="av-num">{row.withTranscript}/{row.students}</td><td className="av-num">{row.assessed}/{row.students}</td>
    </tr>)}</tbody>
  </table></div>;
}

/** One advisor with the classes they advise (exported for its test). */
export function AdvisorDetailDialog({ id, canManage, close, edit }: { id: string; canManage: boolean; close: () => void; edit: () => void }) {
  const state = useData<{ advisor: AdvisorDetail }>(`${ADVISORS_API}/${encodeURIComponent(id)}`);
  const advisor = state.data?.advisor;
  return <Modal title="Chi tiết cố vấn học tập" onClose={close}>
    <div className="cm-dialog-body cm-form career-detail av-detail">
      <Status {...state} />
      {advisor && <>
        <dl className="av-detail-grid">
          <div><dt>Họ và tên</dt><dd>{advisor.name}</dd></div>
          <div><dt>Email</dt><dd>{advisor.email}</dd></div>
          <div><dt>Mã giảng viên</dt><dd>{advisor.staffCode ?? "Chưa bổ sung"}</dd></div>
          <div><dt>Đơn vị</dt><dd>{advisor.unit ?? "Chưa bổ sung"}</dd></div>
          <div><dt>Tài khoản</dt><dd><AccountState status={advisor.account} />{advisor.role !== "advisor" && <small>Vẫn giữ vai trò {roleText(advisor.role)}</small>}</dd></div>
          <div><dt>Đăng nhập gần nhất</dt><dd><SignInTime at={advisor.lastLoginAt} /></dd></div>
          <div><dt>Thêm vào danh sách</dt><dd>{advisorTime(advisor.createdAt, "—")}</dd></div>
          <div><dt>Cập nhật gần nhất</dt><dd>{advisorTime(advisor.updatedAt, "—")}</dd></div>
        </dl>
        <h3>Lớp phụ trách ({advisor.classDetails.length})</h3>
        <ClassDetailTable classes={advisor.classDetails} />
      </>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button>
        {canManage && advisor && <button className="am-primary" onClick={edit}><Icon name="edit" /> Chỉnh sửa cố vấn</button>}
      </div>
    </div>
  </Modal>;
}

function AdvisorEditor({ current, close, saved }: { current: AdvisorRow | null; close: () => void; saved: (advisor: AdvisorRow, created: boolean) => void }) {
  const [form, setForm] = useState({
    name: current?.name ?? "", email: current?.email ?? "", staffCode: current?.staffCode ?? "", unit: current?.unit ?? "", classes: current?.classes.join(", ") ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const classes = splitClasses(form.classes);
  return <Modal title={current ? "Chỉnh sửa cố vấn học tập" : "Thêm cố vấn học tập"} onClose={close} busy={busy}>
    <CheckedForm className="cm-dialog-body cm-form av-editor" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      const body: AdvisorInput = { name: form.name.trim(), email: form.email.trim().toLowerCase(), staffCode: form.staffCode.trim() || null, unit: form.unit.trim() || null, classes };
      try {
        const { advisor } = await advisorRequest<{ advisor: AdvisorRow }>(current ? `${ADVISORS_API}/${encodeURIComponent(current.userId)}` : ADVISORS_API,
          { method: current ? "PUT" : "POST", body: JSON.stringify(body) });
        saved(advisor, !current);
      } catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}>
      <fieldset className="cm-fields" disabled={busy}>
        <label><RequiredLabel>Họ và tên</RequiredLabel><input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label><RequiredLabel>Email</RequiredLabel><input type="email" required maxLength={320} value={form.email} readOnly={Boolean(current)} placeholder="ten@vlu.edu.vn" autoComplete="off"
          onChange={(event) => setForm({ ...form, email: event.target.value })} />
          <span className="cm-help">{current
            ? "Email là tài khoản đăng nhập nên không đổi được; muốn đổi email, xóa cố vấn này rồi thêm lại."
            : "Email của trường (@vlu.edu.vn hoặc @vanlanguni.vn), dùng để đăng nhập Microsoft. Nếu người này chưa từng đăng nhập EduPath AI, tài khoản được tạo sẵn với vai trò Cố vấn học tập."}</span></label>
        <div className="av-form-row">
          <label>Mã giảng viên<input maxLength={50} value={form.staffCode} onChange={(event) => setForm({ ...form, staffCode: event.target.value })} /></label>
          <label>Đơn vị<input maxLength={200} value={form.unit} placeholder="Ví dụ: Bộ môn Công nghệ phần mềm" onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label>
        </div>
        <label><RequiredLabel>Lớp phụ trách</RequiredLabel><textarea required rows={2} maxLength={2000} value={form.classes} placeholder="71K29CNTT01, 71K29CNTT02"
          onChange={(event) => setForm({ ...form, classes: event.target.value })} />
          <span className="cm-help">Ngăn cách các lớp bằng dấu phẩy, chấm phẩy hoặc xuống dòng. Mỗi lớp chỉ do một cố vấn phụ trách.</span></label>
        {classes.length > 0 && <p className="av-split" aria-live="polite"><span>{classes.length} lớp:</span> <ClassChips classes={classes} shown={classes.length} /></p>}
      </fieldset>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : current ? "Lưu thay đổi" : "Thêm cố vấn"}</button>
      </div>
    </CheckedForm>
  </Modal>;
}

function AdvisorDelete({ current, close, deleted }: { current: AdvisorRow; close: () => void; deleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="Xóa cố vấn học tập" onClose={close} busy={busy} size="sm">
    <div className="cm-dialog-body cm-form">
      <strong>{current.name}</strong>
      <p>{current.classes.length ? `Cố vấn sẽ không còn phụ trách ${current.classes.length} lớp: ${current.classes.join(", ")}. ` : ""}Tài khoản của người này vẫn giữ nguyên; khóa tài khoản hoặc đổi vai trò ở trang Tài khoản nếu cần.</p>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary am-delete" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await advisorRequest(`${ADVISORS_API}/${encodeURIComponent(current.userId)}`, { method: "DELETE" }); deleted(); }
          catch (failure) { setError((failure as Error).message); }
          finally { setBusy(false); }
        }}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
      </div>
    </div>
  </Modal>;
}

/** What one row of the preview changes, or why it cannot be imported. */
function ImportNotes({ item }: { item: AdvisorImportItem }) {
  const lines = [
    ...item.problems.map((text) => ({ text, tone: "error" })),
    ...item.changes.map((text) => ({ text, tone: "change" })),
    ...(item.emptyClasses.length ? [{ text: `Chưa có sinh viên trong EduPath AI: ${item.emptyClasses.join(", ")}`, tone: "warn" }] : []),
  ];
  if (!lines.length) return <span className="career-empty">—</span>;
  return <ul className="av-notes">{lines.map((line) => <li key={`${line.tone}-${line.text}`} className={`av-note-${line.tone}`}>{line.text}</li>)}</ul>;
}

/** What the workbook holds, before anything is saved (AD-ADV-03; exported for its test). */
export function ImportPreview({ preview }: { preview: SheetPreview }) {
  const { sort, sortHeader } = useTableSort();
  const notes = preview.notes ?? [];
  const nothing = importNothingText(preview.summary);
  return <section className="av-preview" aria-label="Xem trước danh sách cố vấn học tập">
    <h3>{preview.fileName}</h3>
    <p className="av-summary">Đọc {preview.rows.toLocaleString("vi-VN")} dòng · {importSummaryText(preview.summary)}</p>
    {notes.length > 0 && <ul className="av-notes" aria-label="Trang tính đã đọc">{notes.map((note) =>
      <li key={note.text} className={note.tone === "warn" ? "av-note-warn" : "av-note-change"}>{note.text}</li>)}</ul>}
    {preview.fileProblems.length > 0 && <div className="cm-warning" role="alert"><strong>Tệp chưa đọc được hết</strong><ul>{preview.fileProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}
    {preview.items.length > 0 && <div className="cm-table-scroll"><table className="cm-table av-preview-table">
      <thead><tr>{sortHeader("Dòng", "rows", "cm-stt")}{sortHeader("Cố vấn học tập", "name")}{sortHeader("Lớp sau khi tách", "classes")}{sortHeader("Trạng thái", "status")}<th scope="col">Ghi chú</th></tr></thead>
      <tbody>{sortRows(preview.items, importSort, sort).map(({ row }) => <tr key={`${row.email}-${row.sheet ?? ""}-${row.rows.join(",")}`} className={row.status === "error" ? "av-row-error" : undefined}>
        <td className="cm-stt">{rowsText(row.rows)}{row.sheet && <small style={{ whiteSpace: "normal" }}>trang {row.sheet}</small>}</td>
        <td><strong>{row.name || "(chưa có tên)"}</strong><small>{row.email || "(chưa có email)"}</small>
          {(row.staffCode || row.unit) && <small>{[row.staffCode, row.unit].filter(Boolean).join(" · ")}</small>}</td>
        <td><ClassChips classes={row.classes} shown={row.classes.length} /></td>
        <td><span className={`av-status av-status-${row.status}`}>{IMPORT_STATUS_TEXT[row.status]}</span></td>
        <td><ImportNotes item={row} /></td>
      </tr>)}</tbody>
    </table></div>}
    {nothing && <p className="cm-help av-nothing" role="status">{nothing}</p>}
    {preview.summary.error > 0 && <p className="cm-help">Các cố vấn có Lỗi sẽ được bỏ qua; sửa tệp rồi chọn lại để import cả những dòng đó.</p>}
    <p className="cm-help">Với cố vấn có tên trong tệp, lớp phụ trách theo đúng tệp; cố vấn không có trong tệp giữ nguyên.</p>
  </section>;
}

/**
 * Import danh sách (AD-ADV-01, 03; exported for its test). A tệp can be imported again and again (user 2026-11-14): it is
 * read once when chosen, so the preview and the import send the same bytes (readWorkbook); the input forgets its tệp when
 * clicked, so the same path chosen again after an edit is previewed again; Modal ignores the cancel event of the chooser.
 */
export function AdvisorImport({ close, imported }: { close: () => void; imported: (result: AdvisorImportResult) => void }) {
  const [file, setFile] = useState<ChosenWorkbook | null>(null);
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A file chosen while the previous one is still read wins: the late answer of the older file is dropped.
  const generation = useRef(0);
  async function inspect(chosen: File | null) {
    const own = ++generation.current;
    setFile(null); setPreview(null); setError("");
    if (!chosen) return;
    if (!/\.xlsx$/i.test(chosen.name) || chosen.size > 5 * 1024 * 1024) { setError("Chọn tệp .xlsx không quá 5 MB."); return; }
    setBusy(true);
    try {
      const workbook = await readWorkbook(chosen);
      if (own !== generation.current) return;
      setFile(workbook);
      const result = await uploadWorkbook<SheetPreview>(`${ADVISORS_API}/import/preview`, workbook);
      if (own === generation.current) setPreview(result);
    } catch (failure) { if (own === generation.current) setError((failure as Error).message); }
    finally { if (own === generation.current) setBusy(false); }
  }
  async function apply() {
    if (!file || !preview) return;
    setBusy(true); setError("");
    try { imported(await uploadWorkbook<AdvisorImportResult>(`${ADVISORS_API}/import`, file)); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title="Import danh sách cố vấn học tập" onClose={close} busy={busy}>
    <div className="cm-dialog-body av-import">
      <p>1. Chọn tệp Excel → 2. Xem trước và rà soát → 3. Xác nhận import</p>
      <label className="cm-upload">Danh sách cố vấn học tập (.xlsx · tối đa 5 MB)
        <input type="file" accept=".xlsx" disabled={busy} onClick={forgetChosenFile} onChange={(event) => void inspect(event.target.files?.[0] ?? null)} /></label>
      <p className="cm-help">Dùng file phân công của Khoa: cột CVHT, EMAIL (@vlu.edu.vn hoặc @vanlanguni.vn), MÃ LỚP và MGV nếu có; mỗi dòng là một cố vấn hoặc một lớp, nhiều lớp trong một ô cách nhau bằng dấu phẩy. Trang tính ẩn không được đọc.{" "}
        <a className="av-template" href={`${ADVISORS_API}/import/template`} download><Icon name="download" /> Tải file mẫu</a></p>
      <p className="cm-help">{IMPORT_AGAIN_TEXT}</p>
      {busy && <p role="status">{preview ? "Đang import danh sách…" : "Đang đọc tệp Excel…"}</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}
      {preview && <ImportPreview preview={preview} />}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        {preview && <button type="button" className="am-primary" disabled={busy || importableCount(preview) === 0} onClick={() => void apply()}>
          <Icon name="upload" /> {busy ? "Đang import…" : `Xác nhận import ${importableCount(preview)} cố vấn`}</button>}
      </div>
    </div>
  </Modal>;
}
