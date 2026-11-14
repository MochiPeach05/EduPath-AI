import { useRef, useState } from "react";
import { Modal } from "./admin-ui";
import { Icon } from "./admin-account-shared";
import { sortRows, useTableSort, type SortRule } from "./table-sort";
import {
  IMPORT_STATUS_TEXT, advisorFileProblem, advisorRequest, forgetChosenFile, importNothingText, readWorkbook, uploadWorkbook, type ChosenWorkbook,
} from "./advisor-admin";
import {
  rosterImportUrl, rosterImportableCount, rosterStudentUrl, rosterSummaryText, rosterTemplateUrl, type RosterImportItem, type RosterImportPreview,
  type RosterImportResult,
} from "./advisor-roster-types";
import type { AdvisedStudentRow } from "./advisor-types";
import "./curricula.css";
import "./advisors.css";

// Import danh sách sinh viên (reviewer note 2026-11-14, user: "Cố vấn có thể import trước danh sách sinh viên đầy đủ của lớp,
// kể cả sinh viên chưa tạo tài khoản hoặc chưa đăng nhập"), opened from the ⋮ menu of a class on Quản lý sinh viên: 1. Chọn
// tệp Excel → 2. Xem trước và rà soát (each student: add, update, unchanged or error, with the row and the column of each
// problem) → 3. Xác nhận import. The tệp is read once and the same bytes are previewed and imported (advisor-admin.ts
// readWorkbook); choosing the edited tệp again previews it again. Contract: advisor-roster-types.ts.

/** "6–9, 12": three rows or more in a row are written as a range. */
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
const previewSort: Record<string, SortRule<RosterImportItem>> = {
  rows: { value: (row) => row.rows[0], by: "number" },
  name: { value: (row) => row.name, by: "name" },
  cohort: { value: (row) => row.cohort },
  className: { value: (row) => row.className },
  status: { value: (row) => row.status, order: ["error", "add", "update", "unchanged"] satisfies RosterImportItem["status"][] },
};

/** What importing one student changes, why it cannot be imported, or what was left out of it. */
function Notes({ item }: { item: RosterImportItem }) {
  const lines = [
    ...item.problems.map((text) => ({ text, tone: "error" })),
    ...item.changes.map((text) => ({ text, tone: "change" })),
    ...item.warnings.map((text) => ({ text, tone: "warn" })),
    ...(item.signedIn && item.status !== "error" ? [{ text: "Đã đăng nhập EduPath AI", tone: "change" }] : []),
  ];
  if (!lines.length) return <span className="career-empty">—</span>;
  return <ul className="av-notes">{lines.map((line) => <li key={`${line.tone}-${line.text}`} className={`av-note-${line.tone}`}>{line.text}</li>)}</ul>;
}

/** What the tệp holds, before anything is saved (step 2; exported for its test). */
export function RosterPreview({ preview }: { preview: RosterImportPreview }) {
  const { sort, sortHeader } = useTableSort();
  const nothing = importNothingText(preview.summary);
  return <section className="av-preview" aria-label="Xem trước danh sách sinh viên">
    <h3>{preview.fileName}</h3>
    <p className="av-summary">Đọc {preview.rows.toLocaleString("vi-VN")} dòng · {rosterSummaryText(preview.summary)}</p>
    {preview.notes.length > 0 && <ul className="av-notes" aria-label="Ghi chú về tệp">{preview.notes.map((note) =>
      <li key={note.text} className={note.tone === "warn" ? "av-note-warn" : "av-note-change"}>{note.text}</li>)}</ul>}
    {preview.fileProblems.length > 0 && <div className="cm-warning" role="alert"><strong>Tệp chưa đọc được hết</strong><ul>{preview.fileProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}
    {preview.items.length > 0 && <div className="cm-table-scroll"><table className="cm-table av-preview-table av-roster-table">
      <thead><tr>{sortHeader("Dòng", "rows", "cm-stt")}{sortHeader("Sinh viên", "name")}{sortHeader("Khóa", "cohort")}{sortHeader("Lớp", "className")}
        {sortHeader("Trạng thái", "status")}<th scope="col">Ghi chú</th></tr></thead>
      <tbody>{sortRows(preview.items, previewSort, sort).map(({ row }) => <tr key={`${row.studentCode}-${row.sheet ?? ""}-${row.rows.join(",")}`} className={row.status === "error" ? "av-row-error" : undefined}>
        <td className="cm-stt">{rowsText(row.rows)}{row.sheet && <small className="av-sheet">trang {row.sheet}</small>}</td>
        <td><strong>{row.name || "(chưa có tên)"}</strong><small>{row.studentCode ? `MSSV ${row.studentCode}` : "(chưa có MSSV)"}</small>
          {row.email && <small>{row.email}</small>}</td>
        <td>{row.cohort ?? "—"}</td>
        <td className="av-class-code">{row.className || <span className="career-empty">—</span>}</td>
        <td><span className={`av-status av-status-${row.status}`}>{IMPORT_STATUS_TEXT[row.status]}</span></td>
        <td><Notes item={row} /></td>
      </tr>)}</tbody>
    </table></div>}
    {nothing && <p className="cm-help" role="status">{nothing}</p>}
    {preview.summary.error > 0 && <p className="cm-help">Các sinh viên có Lỗi sẽ được bỏ qua; sửa tệp rồi chọn lại để import cả những dòng đó.</p>}
    <p className="cm-help">Sinh viên có trong tệp được xếp vào đúng lớp của tệp; sinh viên không có trong tệp vẫn ở lớp của mình.</p>
  </section>;
}

/**
 * "Xóa khỏi danh sách lớp" of a student who never signed in (user 2026-11-14: "Có, làm luôn"), asked first; the API refuses
 * a student with an account and a class the account may not import (exported for its test).
 */
export function RosterRemoveDialog({ student, close, removed }: { student: AdvisedStudentRow; close: () => void; removed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="Xóa khỏi danh sách lớp" onClose={close} busy={busy} size="sm">
    <div className="cm-dialog-body cm-form">
      <strong>{student.name}</strong>
      <p>MSSV {student.studentCode} · lớp {student.className}. Sinh viên chưa đăng nhập EduPath AI nên chỉ có tên trong danh sách lớp; xóa thì sinh viên không còn trong danh sách của lớp {student.className}. Nếu sau này sinh viên đăng nhập, tài khoản vẫn được tạo như thường, theo lớp của tài khoản Microsoft.</p>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button type="button" className="am-primary am-delete" disabled={busy || !student.studentCode} onClick={async () => {
          setBusy(true); setError("");
          try { await advisorRequest(rosterStudentUrl(student.studentCode!), { method: "DELETE" }); removed(); }
          catch (failure) { setError((failure as Error).message); }
          finally { setBusy(false); }
        }}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
      </div>
    </div>
  </Modal>;
}

/** The dialog of one class (className: the class of the ⋮ menu; rows without a class go there). */
export default function AdvisorRosterImport({ className, close, imported }: {
  className: string; close: () => void; imported: (result: RosterImportResult) => void;
}) {
  const [file, setFile] = useState<ChosenWorkbook | null>(null);
  const [preview, setPreview] = useState<RosterImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A tệp chosen while the previous one is still read wins: the late answer of the older one is dropped.
  const generation = useRef(0);
  async function inspect(chosen: File | null) {
    const own = ++generation.current;
    setFile(null); setPreview(null); setError("");
    if (!chosen) return;
    // An .xls, a .csv, an empty tệp or one over 5 MB is refused at once, with how to fix it (as the advisor import).
    const problem = advisorFileProblem(chosen);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      const workbook = await readWorkbook(chosen);
      if (own !== generation.current) return;
      setFile(workbook);
      const result = await uploadWorkbook<RosterImportPreview>(rosterImportUrl(className, true), workbook);
      if (own === generation.current) setPreview(result);
    } catch (failure) { if (own === generation.current) setError((failure as Error).message); }
    finally { if (own === generation.current) setBusy(false); }
  }
  async function apply() {
    if (!file || !preview) return;
    setBusy(true); setSaving(true); setError("");
    try { imported(await uploadWorkbook<RosterImportResult>(rosterImportUrl(className, false), file)); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); setSaving(false); }
  }
  const count = preview ? rosterImportableCount(preview) : 0;
  return <Modal title={`Import danh sách sinh viên lớp ${className}`} onClose={close} busy={busy}>
    <div className="cm-dialog-body av-import">
      <p>1. Chọn tệp Excel → 2. Xem trước và rà soát → 3. Xác nhận import</p>
      <label className="cm-upload">Danh sách sinh viên của lớp (.xlsx · tối đa 5 MB)
        <input type="file" accept=".xlsx" disabled={busy} onClick={forgetChosenFile} onChange={(event) => void inspect(event.target.files?.[0] ?? null)} /></label>
      <p className="cm-help">Tệp có cột MSSV và Họ và tên (hoặc Họ lót và Tên), thêm cột Lớp và Email trường nếu có; các dòng tiêu đề phía trên được bỏ qua.
        Dòng không ghi lớp được nhập vào lớp {className}. EduPath AI chỉ lưu MSSV, họ và tên, lớp và email @vanlanguni.vn; các cột khác như ngày sinh, số điện thoại không được đọc.{" "}
        <a className="av-template" href={rosterTemplateUrl(className)} download><Icon name="download" /> Tải tệp mẫu</a></p>
      <p className="cm-help">Có thể import lại tệp nhiều lần sau khi sửa: dòng không thay đổi được giữ nguyên, dòng có nội dung thay đổi được cập nhật tương ứng.
        Sinh viên chưa đăng nhập hiện “Chưa đăng nhập”; khi đăng nhập lần đầu, tài khoản của sinh viên được ghép với dòng này theo MSSV.</p>
      {busy && <p role="status">{saving ? "Đang lưu danh sách sinh viên…" : "Đang đọc tệp Excel…"}</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}
      {preview && <RosterPreview preview={preview} />}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        {preview && <button type="button" className="am-primary" disabled={busy || count === 0} onClick={() => void apply()}>
          <Icon name="upload" /> {saving ? "Đang lưu…" : `Xác nhận import ${count} sinh viên`}</button>}
      </div>
    </div>
  </Modal>;
}
