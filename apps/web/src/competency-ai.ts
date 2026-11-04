// Types and pure helpers for the AI proposals of the shared courses of "Cấu hình môn học" ("Tạo liên
// kết kỹ năng (AI)", which also splits the course's 100% since "Thêm trọng số" was merged into it on
// 2026-10-20, and the run over the courses without a link). The local AI proposes, the admin reviews; only the reviewed rows are saved.
// No DOM here — unit tested.
import { COMPETENCY_API, readCompetencyResponse, WEIGHT_TOLERANCE } from "./competency-types";
import { ADMIN_ERROR_TEXTS } from "./admin-errors";

/** A failed request with the API error code kept (the message is the competency page's own). */
export class CompetencyAiError extends Error {
  constructor(message: string, readonly code: string | null) { super(message); }
}
export async function aiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, credentials: "include", cache: "no-store" }); }
  catch { throw new CompetencyAiError(ADMIN_ERROR_TEXTS.network, null); }
  const copy = response.clone();
  try { return await readCompetencyResponse<T>(response); }
  catch (failure) {
    const body = await copy.json().catch(() => ({})) as { error?: unknown };
    throw new CompetencyAiError((failure as Error).message, typeof body.error === "string" ? body.error : null);
  }
}
export const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const COMPETENCY_AI_API = `${COMPETENCY_API}/ai`;
export const POLL_SUGGESTION_MS = 3_000;
export const POLL_BATCH_MS = 5_000;
export const POLL_STATUS_MS = 15_000;
export const SKILL_NAME_MAX = 100;
/** Shown while the AI works on a run or a proposal (wording from the function list, 2026-10-19). */
export const AI_COMPUTING_MESSAGE = "AI đang trong quá trình tính toán... Bạn có thể thực hiện các thao tác khác trên hệ thống và quay lại nhận kết quả sau ít phút nữa.";

/** "weights" is the former "Thêm trọng số (AI)": no button since 2026-10-20. */
export type CourseAiMode = "links" | "weights";
export type CourseAiStatusCode = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type CourseAiStatus = { enabled: boolean; worker: { online: boolean; supportsSuggestions: boolean; seenAt: string | null } };
export type CourseAiItem = {
  index: number;
  /** null = a new skill that is not in the catalog yet. */
  skillId: string | null;
  skillName: string;
  groupId: string | null;
  groupName: string | null;
  /** false: a career skill that no course measures yet, or a new skill; saving adds it to the competency catalog. */
  hasProfile: boolean;
  isNewSkill: boolean;
  alreadyLinked: boolean;
  /** Whole percent (the items add up to 100); null only in links proposals made before 2026-10-20. */
  percent: number | null;
  reason: string;
};
export type CourseAiSuggestion = {
  id: string;
  courseId: string;
  courseCode: string;
  mode: CourseAiMode | "full";
  batchId: string | null;
  status: CourseAiStatusCode;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  appliedAt: string | null;
  model: string | null;
  promptVersion: string | null;
  items: CourseAiItem[];
  /** The course's links changed since the proposal was made: create it again. */
  stale: boolean;
};
export type CourseAiBatch = {
  id: string;
  createdAt: string;
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** Saved as drafts or applied, with at least one skill. */
  applied: number;
  /** Finished, not yet saved, with at least one proposed skill. */
  ready: number;
  /** Finished with no usable skill: no skill of the catalog fits the course (absent before 2026-10-19). */
  noMatch?: number;
  /** linked: the course has links by now (saved from this run or by hand). */
  items: { id: string; courseId: string; courseCode: string; courseName: string | null; status: CourseAiStatusCode; errorCode: string | null; applied: boolean;
    itemCount: number; noMatch?: boolean; linked: boolean }[];
};
export type BatchApplyResult = { activated: number; drafted: number; empty: number; skipped: { courseCode: string; reason: string }[]; batch: CourseAiBatch };

/** Only these statuses change on their own, so only they are polled. */
export const isPending = (status: CourseAiStatusCode | null | undefined) => status === "queued" || status === "processing";
export const batchPending = (batch: CourseAiBatch | null | undefined) => Boolean(batch && batch.queued + batch.processing > 0);

const FAILURE_MESSAGES: Record<string, string> = {
  ai_timeout: "Máy AI xử lý quá thời gian cho phép.",
  ai_output_truncated: "Kết quả của AI bị cắt giữa chừng nên chưa dùng được.",
  invalid_ai_output: "Kết quả của AI không đúng định dạng hoặc không có kỹ năng hợp lệ nên hệ thống không hiển thị.",
  ollama_unavailable: "Máy AI tạm thời không phản hồi.",
  ai_failed: "Máy AI gặp lỗi khi tạo đề xuất.",
  worker_timeout: "Máy AI chưa xử lý xong trong thời gian cho phép. Có thể máy AI đã tắt giữa chừng.",
};
/** Why a proposal failed, in the admin's words. */
export function failureMessage(code: string | null | undefined): string {
  return FAILURE_MESSAGES[code ?? ""] ?? "Chưa tạo được đề xuất.";
}

/** Why a course was not saved by "Lưu … đề xuất" or "Áp dụng … bản nháp". */
const SKIP_REASONS: Record<string, string> = {
  course_already_linked: "đã có liên kết kỹ năng",
  course_not_found: "không còn trong danh sách môn học",
  skill_unavailable: "kỹ năng đã ngừng sử dụng",
  group_unavailable: "nhóm đã ngừng sử dụng",
  weight_total_invalid: "tổng trọng số chưa đủ 100%",
  course_has_no_links: "chưa có liên kết kỹ năng",
  invalid_competency_reference: "dữ liệu vừa thay đổi",
};
export const skipReason = (code: string) => SKIP_REASONS[code] ?? "không lưu được";

/* ------------------------------------------------------------ link review */

export type LinkRow = {
  key: string;
  index: number;
  /** A linked skill is always kept (the review only changes its percent). */
  checked: boolean;
  skillId: string | null;
  skillName: string;
  groupId: string;
  hasProfile: boolean;
  isNewSkill: boolean;
  alreadyLinked: boolean;
  /** The reviewed percent, as typed. */
  percent: string;
  reason: string;
};
/** Catalog and linked skills start ticked; new skills start unticked (the admin opts in). */
export function linkRows(items: CourseAiItem[]): LinkRow[] {
  return items.map((item) => ({
    key: `row-${item.index}`,
    index: item.index,
    checked: item.alreadyLinked || !item.isNewSkill,
    skillId: item.skillId,
    skillName: item.skillName,
    groupId: item.groupId ?? "",
    hasProfile: item.hasProfile,
    isNewSkill: item.isNewSkill,
    alreadyLinked: item.alreadyLinked,
    percent: String(item.percent ?? 0),
    reason: item.reason,
  }));
}
const foldName = (value: string) => value.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ");

/**
 * Per-row messages, the total of the kept rows and whether they can be saved as a draft (valid) or
 * applied (canActivate: exactly 100%), mirroring the server checks. Linked skills always count.
 */
export function validateLinkRows(rows: LinkRow[]): { valid: boolean; canActivate: boolean; selected: number; added: number; total: number; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const seen = new Set<string>();
  let selected = 0, added = 0, total = 0;
  for (const row of rows) {
    if (!row.checked && !row.alreadyLinked) continue;
    selected += 1;
    if (!row.alreadyLinked) added += 1;
    const messages: string[] = [];
    const percent = Number(row.percent);
    if (!row.percent.trim() || !Number.isFinite(percent) || percent < 0 || percent > 100) messages.push("Nhập trọng số từ 0 đến 100.");
    else total += percent;
    const name = row.skillName.replace(/\s+/g, " ").trim();
    if (row.isNewSkill && !name) messages.push("Nhập tên kỹ năng mới.");
    if (row.isNewSkill && name.length > SKILL_NAME_MAX) messages.push(`Tên kỹ năng tối đa ${SKILL_NAME_MAX} ký tự.`);
    if (!row.hasProfile && !row.groupId) messages.push("Chọn nhóm năng lực.");
    const key = row.skillId ?? `new:${foldName(name)}`;
    if (name && seen.has(key)) messages.push("Kỹ năng này đã có ở dòng khác.");
    seen.add(key);
    if (messages.length) errors[row.key] = messages;
  }
  const valid = selected > 0 && !Object.keys(errors).length;
  return { valid, canActivate: valid && Math.abs(total / 100 - 1) <= WEIGHT_TOLERANCE, selected, added, total, errors };
}
/** The body items of a save: every kept row (linked ones included) with its percent. */
export function applyLinkItems(rows: LinkRow[]) {
  return rows.filter((row) => row.checked || row.alreadyLinked).map((row) => ({
    skillId: row.skillId,
    skillName: row.skillId ? "" : row.skillName.replace(/\s+/g, " ").trim(),
    groupId: row.hasProfile ? null : row.groupId || null,
    percent: Number(row.percent),
  }));
}

/* ------------------------------------------------------------- many courses */

/**
 * The courses of a run that the AI found no fitting skill for and that still have no link, in the
 * run's order (by code and name). Two courses can share a code, so `key` is the course id.
 */
export function noMatchCourses(batch: CourseAiBatch) {
  return batch.items
    .filter((item) => (item.noMatch ?? (item.status === "completed" && item.itemCount === 0)) && !item.linked)
    .map((item) => ({ key: item.courseId ?? item.id, code: item.courseCode, name: item.courseName ?? item.courseCode }));
}

/** Done = finished in any way; the bar counts done out of total. */
export function batchProgress(batch: CourseAiBatch) {
  const done = batch.completed + batch.failed + batch.cancelled;
  return { done, percent: batch.total ? Math.round((done / batch.total) * 100) : 0 };
}
