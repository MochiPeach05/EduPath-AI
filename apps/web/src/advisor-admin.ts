// Cố vấn học tập in the admin portal (AD-ADV-01…05, AD-AST-01…09; 2026-11-03): the requests and the words the pages
// Cố vấn and Quản lý sinh viên share (AdvisorsManagement.tsx, AdvisorPortal.tsx). Shapes: advisor-types.ts.
import { ADVISOR_ERRORS, type AdvisedStudentStatus, type AdvisorAccountStatus, type AdvisorImportItem, type AdvisorImportPreview } from "./advisor-types";
import { searchTerm } from "./student-curriculum-types";
import { ADMIN_ERROR_TEXTS, SESSION_EXPIRED_EVENT, adminErrorText } from "./admin-errors";
import { formatVnDateTime } from "./display-format";
import { IMPORT_MAX_BYTES, importFileProblem } from "./import-file";

/** A failed advisor request: the code the API answered and its message in Vietnamese. */
export class AdvisorRequestError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "AdvisorRequestError"; }
}

type TakenClass = { className?: unknown; advisorName?: unknown };
/**
 * The import's refusals whose answer words the tệp's own problem (QA 2026-11-14, advisors/import.ts): the sheet, the
 * header row, the columns missing or not recognised, the rows; the API sends it as message.
 */
const FILE_MESSAGE_CODES = new Set(["missing_columns", "empty_workbook", "student_list", "too_many_rows"]);
/**
 * The message of an error answer; class_taken names the classes and who advises them now, an import refusal of a tệp
 * says what the API found in it. A code without a text of these pages is worded by its HTTP status (admin-errors.ts; 0:
 * no answer, 500 when unknown).
 */
export function advisorErrorText(code: string, body: { classes?: unknown; message?: unknown } = {}, status = 500): string {
  if (code === "class_taken" && Array.isArray(body.classes)) {
    const taken = (body.classes as TakenClass[])
      .filter((item) => typeof item?.className === "string")
      .map((item) => `${item.className as string}${typeof item.advisorName === "string" && item.advisorName.trim() ? ` (${item.advisorName.trim()})` : ""}`);
    if (taken.length) return `${taken.length > 1 ? "Các lớp" : "Lớp"} ${taken.join(", ")} đang do cố vấn học tập khác phụ trách. Bỏ lớp khỏi cố vấn đó trước, hoặc import danh sách mới để chuyển lớp.`;
  }
  if (FILE_MESSAGE_CODES.has(code) && typeof body.message === "string" && body.message.trim()) return body.message.trim();
  return adminErrorText(status, { error: code }, ADVISOR_ERRORS);
}

/**
 * Why the tệp chosen in the import dialog cannot be read, or "" when it can be sent (QA 2026-11-14): an Excel 97–2003
 * (.xls) or CSV tệp says how to save it as .xlsx; any other type, an empty tệp and one over 5 MB as every admin import
 * says it (import-file.ts).
 */
export function advisorFileProblem(file: Pick<File, "name" | "size">): string {
  const saveAs = "Mở tệp bằng Excel, chọn Lưu thành → Excel Workbook (.xlsx) rồi chọn lại tệp.";
  if (/\.xls$/i.test(file.name)) return `Tệp “${file.name}” là bảng tính Excel 97–2003 (.xls), chưa đọc được. ${saveAs}`;
  if (/\.csv$/i.test(file.name)) return `Tệp “${file.name}” là tệp CSV, chưa đọc được. ${saveAs}`;
  return importFileProblem(file, [".xlsx"], IMPORT_MAX_BYTES);
}

/** fetch with the session cookie; JSON bodies get their Content-Type, a file keeps its own. Throws AdvisorRequestError. */
export async function advisorRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const json = typeof init.body === "string";
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "include", cache: "no-store", ...init,
      headers: json ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    });
  } catch (error) {
    // No answer at all (offline, server down): status 0, the shared network text.
    if ((error as { name?: unknown } | null)?.name === "AbortError") throw error;
    throw new AdvisorRequestError("network", 0, ADMIN_ERROR_TEXTS.network);
  }
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; classes?: unknown; message?: unknown };
    const code = body.error ?? (response.status === 403 ? "insufficient_role" : "request_failed");
    throw new AdvisorRequestError(code, response.status, advisorErrorText(code, body, response.status));
  }
  return await response.json() as T;
}

/**
 * The classes typed in one field or one workbook cell: split on commas, semicolons, slashes and new lines, spaces
 * removed, upper case, each class once ("71k29cntt01; 71K29CNTT02" → ["71K29CNTT01", "71K29CNTT02"]). The API stores
 * each as its canonical code (advisors/class-code.ts: K29CNTT01 → 71K29CNTT01) and refuses a class without its cohort
 * (CNTT01: invalid_class).
 */
export function splitClasses(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[,;/\n\r]+/)) {
    const name = part.replace(/\s+/g, "").toUpperCase();
    if (name) seen.add(name);
  }
  return [...seen];
}

/** The first classes of a list and how many more there are, for a table cell ("71K29CNTT01, 71K29CNTT02 +3"). */
export function classPreview(classes: readonly string[], shown = 3): { shown: string[]; more: number } {
  return { shown: classes.slice(0, shown), more: Math.max(0, classes.length - shown) };
}

/** "K29" from a class name ("71K29CNTT01"); null when the name has no cohort. */
export function cohortOfClass(className: string): string | null {
  return /K\d{2}/i.exec(className)?.[0]?.toUpperCase() ?? null;
}

export const ACCOUNT_TEXT: Record<AdvisorAccountStatus, string> = { pending: "Chưa đăng nhập", active: "Đang hoạt động", locked: "Đã khóa" };

export const IMPORT_STATUS_TEXT: Record<AdvisorImportItem["status"], string> = { add: "Thêm mới", update: "Cập nhật", unchanged: "Không đổi", error: "Lỗi" };

/** "3 thêm mới · 2 cập nhật · 1 lỗi · 14 lớp, 2 lớp chuyển cố vấn" (the parts that are 0 are left out). */
export function importSummaryText(summary: AdvisorImportPreview["summary"]): string {
  const parts = [
    summary.add ? `${summary.add} thêm mới` : "",
    summary.update ? `${summary.update} cập nhật` : "",
    summary.unchanged ? `${summary.unchanged} không đổi` : "",
    summary.error ? `${summary.error} lỗi` : "",
  ].filter(Boolean);
  const classes = summary.classes ? `${summary.classes} lớp${summary.moved ? `, ${summary.moved} lớp chuyển cố vấn` : ""}` : "";
  return [parts.join(" · ") || "Không có cố vấn nào", classes].filter(Boolean).join(" · ");
}

/** How many advisors applying the preview changes (the rows with errors are left out). */
export const importableCount = (preview: Pick<AdvisorImportPreview, "summary">) => preview.summary.add + preview.summary.update;

/** The import dialog's line on importing again (user 2026-11-14: "Phải cho phép import lại file Excel sau khi dữ liệu thay đổi"). */
export const IMPORT_AGAIN_TEXT = "Có thể import lại tệp nhiều lần sau khi sửa: dòng không thay đổi được giữ nguyên, dòng có nội dung thay đổi được cập nhật tương ứng.";

/** Why a preview has nothing to import when its rows all say what the list holds (the same tệp chosen again); null otherwise. */
export function importNothingText(summary: AdvisorImportPreview["summary"]): string | null {
  if (summary.add + summary.update > 0 || summary.unchanged === 0) return null;
  return summary.error
    ? "Các dòng không có lỗi đều giống danh sách hiện tại, không có gì cần cập nhật."
    : "Mọi dòng trong tệp đều giống danh sách hiện tại, không có gì cần cập nhật.";
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** A tệp chosen in the import dialog, read once (readWorkbook). */
export type ChosenWorkbook = { name: string; bytes: ArrayBuffer };

/**
 * Reads the chosen tệp once. The preview and the import send these same bytes: what is imported is what was previewed,
 * even when the tệp is saved again in Excel in between. Chrome refuses to send a File changed on disk after it was chosen
 * (net::ERR_UPLOAD_FILE_CHANGED, which read as a lost connection); an edited tệp is previewed again by choosing it again.
 */
export async function readWorkbook(file: Pick<File, "name" | "arrayBuffer">): Promise<ChosenWorkbook> {
  try { return { name: file.name, bytes: await file.arrayBuffer() }; }
  catch { throw new Error("Không đọc được tệp này. Vui lòng chọn lại tệp."); }
}

/** Sends a chosen tệp to the preview or the import (POST, the raw .xlsx with its name in x-filename: advisors/router.ts). */
export function uploadWorkbook<T>(url: string, workbook: ChosenWorkbook): Promise<T> {
  return advisorRequest<T>(url, {
    method: "POST", headers: { "Content-Type": XLSX_MIME, "x-filename": encodeURIComponent(workbook.name) }, body: workbook.bytes,
  });
}

/**
 * The file input forgets its tệp when clicked, so choosing the same path again (the tệp edited and saved) is a new choice:
 * a browser fires no change event for the file it already holds.
 */
export function forgetChosenFile(event: { currentTarget: { value: string } }): void {
  event.currentTarget.value = "";
}

/** "Đã import: 3 thêm mới, 2 cập nhật, 1 không đổi; bỏ qua 1 cố vấn có lỗi." */
export function importResultText(result: { added: number; updated: number; unchanged: number; skipped: number }): string {
  const done = [result.added ? `${result.added} thêm mới` : "", result.updated ? `${result.updated} cập nhật` : "", result.unchanged ? `${result.unchanged} không đổi` : ""].filter(Boolean);
  return `Đã import danh sách cố vấn học tập${done.length ? `: ${done.join(", ")}` : ""}${result.skipped ? `; bỏ qua ${result.skipped} cố vấn có lỗi` : ""}.`;
}

/** The status filter of the student list, in the order the select shows them. */
export const STUDENT_STATUS_TEXT: Record<AdvisedStudentStatus, string> = {
  all: "Tất cả sinh viên",
  not_signed_in: "Chưa đăng nhập EduPath AI",
  no_transcript: "Chưa có bảng điểm",
  no_assessment: "Chưa đánh giá năng lực",
  no_survey: "Chưa làm Khảo sát nhanh",
  no_roadmap: "Chưa có Lộ trình AI",
  complete: "Đã đủ các bước",
};
export const isStudentStatus = (value: string): value is AdvisedStudentStatus => Object.hasOwn(STUDENT_STATUS_TEXT, value);

/** Whether a row matches the search box, without accents ("nguyen van a" finds "Nguyễn Văn A"). */
export const matchesSearch = (query: string, ...fields: readonly (string | null | undefined)[]) =>
  searchTerm(fields.filter(Boolean).join(" ")).includes(searchTerm(query));

/** "08:30 28/10/2026" in Vietnam time, as the other admin pages print a time; "Chưa đăng nhập" without one. */
export function advisorTime(iso: string | null, empty = "Chưa đăng nhập"): string {
  return formatVnDateTime(iso, empty);
}

/**
 * Opens a student's page for their advisor in a tab of its own (AD-AST-05). The tab is opened at once, while the click
 * still counts as the user's, so the browser does not block it; it goes to the student's page once the API allowed it.
 * Returns the address when the browser refused the tab (the page then shows it as a link), null otherwise.
 */
export async function openStudentPage(open: () => Promise<{ url: string }>, win: Pick<Window, "open"> = window): Promise<string | null> {
  const tab = win.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const { url } = await open();
    if (!tab) return url;
    tab.location.replace(url);
    return null;
  } catch (error) {
    tab?.close();
    throw error;
  }
}
