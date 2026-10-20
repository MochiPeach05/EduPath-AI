import { useState } from "react";
import { useLiveData } from "./use-live-data";

export const COMPETENCY_API = "/api/admin/competencies";
export const WEIGHT_TOLERANCE = 0.000001;
export type Group = { id: string; name: string; description: string; isActive: boolean; version: string; skillCount: number };
export type CatalogSkill = { id: string; name: string; description: string; version: string };
export type Skill = CatalogSkill & { scope: string; groupId: string; groupName: string; isActive: boolean; groupActive: boolean; careerCount: number; courseCount: number; legacySkillId: string | null };
/** `scope`: the cohort and CTĐT version of an entry saved before the courses were shared (2026-10-20). */
export type EventEntry = { id: string; note: string; createdAt: string; actorName?: string | null; kind?: string; snapshot: unknown; scope?: string | null };
/** A shared course that the skill is linked to; `cohorts` have it in their current CTĐT. */
export type Contribution = { courseId: string; courseCode: string; courseName: string; cohorts: string[]; weight: number; status: ConfigurationStatus };
export type SkillDetail = Skill & { contributions: Contribution[]; history?: EventEntry[]; events?: EventEntry[] };
type ConfigurationStatus = "draft" | "active" | "archived";
export type CourseStatus = ConfigurationStatus | "missing";
/** A cohort of the filter of "Cấu hình môn học", with the number of courses of its current CTĐT. */
export type Cohort = { cohortCode: string; courseCount: number };
/**
 * A shared course ("môn học", 2026-10-20): one code, name and number of credits, configured once for
 * every cohort. `cohorts` have it in their current CTĐT, `pastCohorts` only in an older version;
 * `mergedFrom` names the cohorts whose own configuration was replaced when the courses were shared.
 */
export type CompetencyCourse = { id: string; code: string; name: string; credits: number; type: string; block: string; specialty: string; cohorts: string[]; pastCohorts: string[];
  status: CourseStatus; configId: string | null; version: string | null; skillCount: number; totalWeight: number; mergedFrom: string[] };
export type CourseLink = { skillId: string; skillName: string; groupId: string; groupName: string; isActive: boolean; weight: number };
export type CourseDetail = { courseId: string; courseCode: string; courseName: string; credits: number; cohorts: string[]; pastCohorts: string[]; configId: string | null;
  status: CourseStatus; version: string | null; note: string; mergedFrom: string[]; links: CourseLink[]; history: EventEntry[] };
export type CompetencySummary = { cohort: string; courseCount: number; activeCount: number; draftCount: number; archivedCount: number; missingCount: number; skillCount: number;
  unlinkedSkillCount: number; warnings: { code: string; message: string; courseCode?: string }[] };

export const statusLabels: Record<CourseStatus, string> = { missing: "Chưa cấu hình", draft: "Bản nháp", active: "Đang áp dụng", archived: "Đã lưu trữ" };
export const percentage = (weight: number) => `${Number((weight * 100).toFixed(6)).toLocaleString("vi-VN", { maximumFractionDigits: 6 })}%`;
export const competencyDate = (date: string) => new Date(date).toLocaleString("vi-VN");

/**
 * A course that no skill of the catalog fits (the AI picked none, or no skill is left to pick):
 * wording from the function list, 2026-10-19.
 */
export const NO_MATCHING_SKILL_MESSAGE = "Danh sách kỹ năng hiện tại trong kho dữ liệu của bạn chưa đủ đáp ứng môn học này. Vui lòng bổ sung thêm kỹ năng.";
/** Where an admin adds skills (the "Cấu hình năng lực" page). */
export const ADD_SKILLS_PATH = "/quantri/cau-hinh-nang-luc";
/** What the admin types to clear the links of every course (no cohort filter); the server folds case and accents. */
export const ALL_COURSES_CONFIRMATION = "TẤT CẢ";
/** "K29, K30" or a sentence when no current CTĐT has the course. */
export const cohortList = (course: Pick<CompetencyCourse, "cohorts" | "pastCohorts">) => course.cohorts.length ? course.cohorts.join(", ")
  : course.pastCohorts.length ? `Chỉ có trong CTĐT cũ của ${course.pastCohorts.join(", ")}` : "Chưa thuộc CTĐT nào";

const failures: Record<string, string> = {
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  insufficient_role: "Bạn không còn quyền thay đổi dữ liệu đánh giá năng lực.",
  invalid_origin: "Không xác nhận được yêu cầu. Hãy tải lại trang rồi thử lại.",
  database_required: "Chức năng đánh giá năng lực cần kết nối cơ sở dữ liệu.",
  not_found: "Không tìm thấy dữ liệu. Hãy tải lại danh sách.",
  invalid_input: "Thông tin chưa hợp lệ. Hãy kiểm tra các trường đã nhập.",
  invalid_competency_input: "Thông tin chưa hợp lệ. Hãy kiểm tra nhóm, kỹ năng và trọng số đã nhập.",
  invalid_competency_query: "Bộ lọc chưa hợp lệ. Hãy chọn lại khóa và trạng thái.",
  invalid_group: "Thông tin nhóm chưa hợp lệ. Kiểm tra tên và mô tả.",
  invalid_skill: "Thông tin kỹ năng chưa hợp lệ. Kiểm tra tên, nhóm và phạm vi.",
  invalid_configuration: "Cấu hình chưa hợp lệ. Kiểm tra kỹ năng và trọng số.",
  group_exists: "Tên nhóm đã tồn tại. Hãy dùng tên khác.",
  group_changed: "Nhóm đã được thay đổi. Đóng hộp thoại và tải lại trước khi lưu.",
  group_in_use: "Nhóm đang được cấu hình môn học áp dụng sử dụng. Hãy điều chỉnh các cấu hình trước.",
  group_not_found: "Không tìm thấy nhóm năng lực.",
  group_inactive: "Nhóm đang ngừng sử dụng. Chọn nhóm hoạt động để áp dụng cấu hình.",
  group_unavailable: "Nhóm đang ngừng sử dụng. Chọn nhóm hoạt động để áp dụng cấu hình.",
  skill_exists: "Tên kỹ năng này đã có trong danh mục Kỹ năng.",
  skill_profile_exists: "Kỹ năng này đã có cấu hình năng lực. Hãy tìm trong danh sách và dùng “Chỉnh sửa cấu hình năng lực”.",
  canonical_skill_mismatch: "Tên và mô tả phải khớp với kỹ năng chung đã chọn. Hãy tải lại danh mục rồi chọn lại.",
  shared_skill_exists: "Tên này đã có trong danh mục Kỹ năng.",
  skill_changed: "Kỹ năng đã được thay đổi. Đóng hộp thoại và tải lại trước khi lưu.",
  skill_in_use: "Kỹ năng đang được cấu hình môn học áp dụng sử dụng. Hãy xóa liên kết hoặc lưu trữ các cấu hình đó trước.",
  skill_not_found: "Kỹ năng không còn trong danh mục. Hãy tải lại và chọn lại.",
  skill_unavailable: "Kỹ năng hoặc nhóm của kỹ năng đang ngừng sử dụng.",
  configuration_changed: "Cấu hình đã được thay đổi. Đóng hộp thoại và tải lại trước khi lưu.",
  course_changed: "Cấu hình đã được thay đổi. Đóng hộp thoại và tải lại trước khi lưu.",
  configuration_not_found: "Không tìm thấy cấu hình môn học.",
  configuration_scope_immutable: "Cấu hình phải giữ đúng môn học. Hãy tải lại dữ liệu.",
  invalid_competency_reference: "Nhóm, kỹ năng hoặc môn học đã thay đổi. Hãy tải lại danh sách và chọn lại.",
  competency_input_too_large: "Cấu hình có quá nhiều dữ liệu. Mỗi môn học hỗ trợ tối đa 200 kỹ năng.",
  configuration_exists: "Môn học vừa được tạo cấu hình. Đóng hộp thoại và tải lại trước khi lưu.",
  invalid_weights: "Trọng số phải nằm trong khoảng 0–100%. Cấu hình áp dụng phải có tổng 100%.",
  invalid_weight: "Trọng số phải là số từ 0 đến 100%.",
  weight_total_invalid: "Cấu hình áp dụng phải có ít nhất một kỹ năng và tổng trọng số bằng 100%.",
  duplicate_skill_link: "Một kỹ năng chỉ được xuất hiện một lần trong cấu hình.",
  invalid_weight_total: "Tổng trọng số của cấu hình áp dụng phải bằng 100%.",
  duplicate_skill: "Một kỹ năng chỉ được xuất hiện một lần trong cấu hình.",
  invalid_version: "Thiếu phiên bản dữ liệu. Hãy đóng hộp thoại và tải lại trước khi lưu.",
  version_conflict: "Dữ liệu đã được người khác thay đổi. Hãy tải lại trước khi lưu.",
  course_not_found: "Không tìm thấy môn học. Hãy tải lại danh sách.",
  confirmation_required: "Cần xác nhận thao tác trước khi tiếp tục.",
  group_not_empty: "Nhóm vẫn còn kỹ năng. Hãy chuyển các kỹ năng sang nhóm khác hoặc xóa chúng trước khi xóa nhóm.",
  ai_disabled: "Máy chủ chưa bật tính năng AI.",
  ai_queue_full: "Hàng đợi AI đang đầy. Vui lòng thử lại sau ít phút.",
  suggestion_not_found: "Không tìm thấy đề xuất này. Hãy tạo đề xuất mới.",
  suggestion_not_active: "Đề xuất đã xử lý xong hoặc đã được hủy.",
  suggestion_not_completed: "Đề xuất chưa hoàn tất nên chưa lưu được.",
  suggestion_already_applied: "Đề xuất này đã được lưu trước đó. Đóng hộp thoại để xem cấu hình môn học.",
  suggestion_pending: "Môn học đang có một đề xuất AI chờ xử lý.",
  suggestion_mode_mismatch: "Đề xuất này thuộc lần chạy AI cho nhiều môn. Hãy lưu từ khung chạy AI cho các môn chưa có liên kết.",
  batch_not_found: "Không tìm thấy lần chạy AI này. Hãy tải lại trang.",
  course_has_no_links: "Môn học chưa liên kết kỹ năng nào. Hãy tạo liên kết kỹ năng trước.",
  course_already_linked: "Môn học đã có liên kết kỹ năng nên không chạy lại AI cho nhiều môn.",
  no_candidate_skills: NO_MATCHING_SKILL_MESSAGE,
  no_active_groups: "Chưa có nhóm năng lực đang sử dụng. Hãy thêm nhóm năng lực trước.",
  links_changed: "Liên kết kỹ năng của môn học vừa thay đổi. Hãy tạo lại đề xuất.",
  skill_already_linked: "Có kỹ năng đã được liên kết với môn học. Hãy kiểm tra lại danh sách.",
  group_required: "Hãy chọn nhóm năng lực cho kỹ năng chưa có cấu hình năng lực.",
  confirmation_mismatch: "Nội dung nhập để xác nhận chưa đúng.",
};

export async function readCompetencyResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    const details = Array.isArray(body.details) ? body.details.filter((detail: unknown) => typeof detail === "string").join("\n") : "";
    const message = failures[body.error] ?? (typeof body.message === "string" ? body.message : response.status === 409 ? "Dữ liệu đã được thay đổi. Hãy tải lại trước khi tiếp tục." : "Chưa thực hiện được thao tác. Vui lòng thử lại.");
    throw new Error(message + (details ? `\n${details}` : ""));
  }
  return body as T;
}
export async function competencyRequest<T>(url: string, init?: RequestInit): Promise<T> {
  try { return await fetch(url, { ...init, credentials: "include", cache: "no-store" }).then(readCompetencyResponse<T>); }
  catch (failure) { if (failure instanceof TypeError) throw new Error("Không thể kết nối hệ thống. Hãy kiểm tra kết nối và thử lại."); throw failure; }
}
export function useCompetencyData<T>(url: string, revision = 0) {
  const [retry, setRetry] = useState(0);
  const remote = useLiveData<T>(url, `${revision}.${retry}`, readCompetencyResponse);
  const error = remote.error && /^(Failed to fetch|NetworkError|Load failed|fetch failed)/iu.test(remote.error) ? "Không thể kết nối hệ thống. Hãy kiểm tra kết nối và thử lại." : remote.error;
  return { ...remote, error, retry: () => setRetry(value => value + 1) };
}
