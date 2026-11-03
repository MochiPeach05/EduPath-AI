// Cố vấn học tập in the admin portal (AD-ADV-01…05, AD-AST-01…09; 2026-11-03): the requests and the words the pages
// Cố vấn and Quản lý sinh viên share (AdvisorsManagement.tsx, AdvisorPortal.tsx). Shapes: advisor-types.ts.
import { ADVISOR_ERRORS, type AdvisedStudentStatus, type AdvisorAccountStatus, type AdvisorImportItem, type AdvisorImportPreview } from "./advisor-types";
import { searchTerm } from "./student-curriculum-types";

/** A failed advisor request: the code the API answered and its message in Vietnamese. */
export class AdvisorRequestError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "AdvisorRequestError"; }
}

type TakenClass = { className?: unknown; advisorName?: unknown };
/** The message of an error answer; class_taken names the classes and who advises them now. */
export function advisorErrorText(code: string, body: { classes?: unknown } = {}): string {
  if (code === "class_taken" && Array.isArray(body.classes)) {
    const taken = (body.classes as TakenClass[])
      .filter((item) => typeof item?.className === "string")
      .map((item) => `${item.className as string}${typeof item.advisorName === "string" && item.advisorName.trim() ? ` (${item.advisorName.trim()})` : ""}`);
    if (taken.length) return `${taken.length > 1 ? "Các lớp" : "Lớp"} ${taken.join(", ")} đang do cố vấn học tập khác phụ trách. Bỏ lớp khỏi cố vấn đó trước, hoặc import danh sách mới để chuyển lớp.`;
  }
  return ADVISOR_ERRORS[code] ?? "Không thể thực hiện thao tác. Vui lòng thử lại.";
}

/** fetch with the session cookie; JSON bodies get their Content-Type, a file keeps its own. Throws AdvisorRequestError. */
export async function advisorRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const json = typeof init.body === "string";
  const response = await fetch(url, {
    credentials: "include", cache: "no-store", ...init,
    headers: json ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; classes?: unknown };
    const code = body.error ?? (response.status === 403 ? "insufficient_role" : "request_failed");
    throw new AdvisorRequestError(code, response.status, advisorErrorText(code, body));
  }
  return await response.json() as T;
}

/**
 * The classes typed in one field or one workbook cell: split on commas, semicolons, slashes and new lines, spaces
 * removed, upper case, each class once ("71k29cntt01; 71K29CNTT02" → ["71K29CNTT01", "71K29CNTT02"]), as the API
 * stores them (normalizeClassName, migration 058).
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

/** "Đã import: 3 thêm mới, 2 cập nhật, 1 không đổi; bỏ qua 1 cố vấn có lỗi." */
export function importResultText(result: { added: number; updated: number; unchanged: number; skipped: number }): string {
  const done = [result.added ? `${result.added} thêm mới` : "", result.updated ? `${result.updated} cập nhật` : "", result.unchanged ? `${result.unchanged} không đổi` : ""].filter(Boolean);
  return `Đã import danh sách cố vấn học tập${done.length ? `: ${done.join(", ")}` : ""}${result.skipped ? `; bỏ qua ${result.skipped} cố vấn có lỗi` : ""}.`;
}

/** The status filter of the student list, in the order the select shows them. */
export const STUDENT_STATUS_TEXT: Record<AdvisedStudentStatus, string> = {
  all: "Tất cả sinh viên",
  no_transcript: "Chưa có bảng điểm",
  no_assessment: "Chưa đánh giá năng lực",
  no_survey: "Chưa làm khảo sát định hướng",
  no_roadmap: "Chưa có Lộ trình AI",
  complete: "Đã đủ các bước",
};
export const isStudentStatus = (value: string): value is AdvisedStudentStatus => Object.hasOwn(STUDENT_STATUS_TEXT, value);

/** Whether a row matches the search box, without accents ("nguyen van a" finds "Nguyễn Văn A"). */
export const matchesSearch = (query: string, ...fields: readonly (string | null | undefined)[]) =>
  searchTerm(fields.filter(Boolean).join(" ")).includes(searchTerm(query));

/** "08:30 28/10/2026" in Vietnam time, as the other admin pages print a time; "Chưa đăng nhập" without one. */
export function advisorTime(iso: string | null, empty = "Chưa đăng nhập"): string {
  if (!iso) return empty;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return empty;
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", ...options }).format(date);
  return `${part({ hour: "2-digit", minute: "2-digit", hour12: false })} ${part({ day: "2-digit", month: "2-digit", year: "numeric" })}`;
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
