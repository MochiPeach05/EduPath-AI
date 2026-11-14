// Import danh sách sinh viên (reviewer note 2026-11-14, user: "Cố vấn có thể import trước danh sách sinh viên đầy đủ của lớp,
// kể cả sinh viên chưa tạo tài khoản hoặc chưa đăng nhập"; migration 065): what /api/admin/advisor-portal/roster answers and
// the words of its dialog (AdvisorRosterImport.tsx). The API side is apps/api/src/advisors/roster.ts (reading and planning
// the tệp), roster-repository.ts and roster-router.ts.
import { ADVISOR_PORTAL_API } from "./advisor-types";

export const ROSTER_API = `${ADVISOR_PORTAL_API}/roster`;
/** POST …/import/preview (step 2) or …/import (step 3); className: the class the import is for (rows without a class). */
export const rosterImportUrl = (className: string, preview: boolean) =>
  `${ROSTER_API}/import${preview ? "/preview" : ""}?class=${encodeURIComponent(className)}`;
/** "Tải tệp mẫu" of a class: the school's layout with the class in its example row. */
export const rosterTemplateUrl = (className: string) => `${ROSTER_API}/template?class=${encodeURIComponent(className)}`;
/** DELETE: "Xóa khỏi danh sách lớp" of a student who never signed in (user 2026-11-14: "Có, làm luôn"). */
export const rosterStudentUrl = (studentCode: string) => `${ROSTER_API}/students/${encodeURIComponent(studentCode)}`;

export type RosterImportStatus = "add" | "update" | "unchanged" | "error";
/** A line about the whole tệp: the sheets read, the rows passed over (warn: worth a look before importing). */
export type RosterNote = { text: string; tone: "info" | "warn" };
/** One student of the preview. */
export type RosterImportItem = {
  /** Excel rows it was read from (of sheet, when several sheets were read and it is not the first). */
  rows: number[];
  sheet?: string;
  studentCode: string;
  name: string;
  /** "K29", from the class; null without one. */
  cohort: string | null;
  className: string;
  /** The school email the class list keeps, null without one (warnings say why one of the tệp is not kept). */
  email: string | null;
  /** add: not in the class list yet; update: in it, something changes (another class, name, email); unchanged; error. */
  status: RosterImportStatus;
  /** The student has signed in to EduPath AI already. */
  signedIn: boolean;
  changes: string[];
  /** Why the student cannot be imported (status error), naming the row and the column. */
  problems: string[];
  /** Imported all the same; what was left out and why (an email that is not the student's school mailbox). */
  warnings: string[];
};
export type RosterImportPreview = {
  fileName: string;
  rows: number;
  items: RosterImportItem[];
  fileProblems: string[];
  notes: RosterNote[];
  sheets: string[];
  summary: { add: number; update: number; unchanged: number; error: number; classes: number; moved: number; signedIn: number };
};
export type RosterImportResult = { added: number; updated: number; unchanged: number; skipped: number; preview: RosterImportPreview };

/** How many students importing the preview stores (the rows with errors are skipped, the unchanged ones kept). */
export const rosterImportableCount = (preview: Pick<RosterImportPreview, "summary">) => preview.summary.add + preview.summary.update;

/** "40 thêm mới · 2 cập nhật · 1 lỗi · 1 lớp · 3 sinh viên đã đăng nhập EduPath AI" (the parts that are 0 left out). */
export function rosterSummaryText(summary: RosterImportPreview["summary"]): string {
  const parts = [
    summary.add ? `${summary.add} thêm mới` : "",
    summary.update ? `${summary.update} cập nhật` : "",
    summary.unchanged ? `${summary.unchanged} không đổi` : "",
    summary.error ? `${summary.error} lỗi` : "",
  ].filter(Boolean);
  return [parts.join(" · ") || "Không có sinh viên nào", summary.classes ? `${summary.classes} lớp` : "",
    summary.moved ? `${summary.moved} sinh viên chuyển lớp` : "", summary.signedIn ? `${summary.signedIn} sinh viên đã đăng nhập EduPath AI` : ""]
    .filter(Boolean).join(" · ");
}

/** "Đã xóa Nguyễn Văn An (MSSV 2374802010991) khỏi danh sách lớp 71K29CNTT99." */
export const rosterRemovedText = (student: { name: string; studentCode: string | null; className: string }) =>
  `Đã xóa ${student.name}${student.studentCode ? ` (MSSV ${student.studentCode})` : ""} khỏi danh sách lớp ${student.className}.`;

/** "Đã import danh sách sinh viên lớp 71K29CNTT99: 40 thêm mới, 2 cập nhật, 3 không đổi; bỏ qua 1 sinh viên có lỗi." */
export function rosterResultText(className: string, result: Pick<RosterImportResult, "added" | "updated" | "unchanged" | "skipped">): string {
  const done = [result.added ? `${result.added} thêm mới` : "", result.updated ? `${result.updated} cập nhật` : "", result.unchanged ? `${result.unchanged} không đổi` : ""]
    .filter(Boolean);
  return `Đã import danh sách sinh viên lớp ${className}${done.length ? `: ${done.join(", ")}` : ""}${result.skipped ? `; bỏ qua ${result.skipped} sinh viên có lỗi` : ""}.`;
}
