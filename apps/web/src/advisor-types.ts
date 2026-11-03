// Cố vấn học tập (AD-ADV-01…05, AD-AST-01…09; user 2026-11-03, migration 058): what the advisor endpoints answer. The API
// side is apps/api/src/advisors (router.ts: /api/admin/advisors, portal-router.ts: /api/admin/advisor-portal, access.ts:
// the advisor working in a student's page, permissions.ts: the list of AD-AST-09).

export const ADVISORS_API = "/api/admin/advisors";
export const ADVISOR_PORTAL_API = "/api/admin/advisor-portal";
/** Sent by the student portal tab of an advisor with every /api/student request (advisor-view.ts). */
export const ADVISOR_STUDENT_HEADER = "X-Advisor-Student";
/** The query parameter of the link that opens a student's page for their advisor ("/dashboard?sv=<id>#overview"). */
export const ADVISOR_STUDENT_PARAM = "sv";

/** pending: created by the Khoa, never signed in yet; active; locked: the account is locked. */
export type AdvisorAccountStatus = "pending" | "active" | "locked";

/** One advisor of the list (GET /api/admin/advisors). */
export type AdvisorRow = {
  /** The row's number in the list's own order (by name), kept when the list is sorted by a column. */
  stt: number;
  userId: string;
  name: string;
  email: string;
  staffCode: string | null;
  unit: string | null;
  /** The classes the advisor advises, in order ("71K29CNTT01"). */
  classes: string[];
  /** Students of those classes with an account in EduPath AI. */
  students: number;
  account: AdvisorAccountStatus;
  /** The account's role: "advisor", or an admin-portal role kept by an account that also advises classes. */
  role: string;
  lastLoginAt: string | null;
};

export type AdvisorClassDetail = {
  className: string;
  /** "K29", from the class name; null when it has none. */
  cohort: string | null;
  students: number;
  withTranscript: number;
  assessed: number;
};

/** GET /api/admin/advisors/:id → { advisor }. */
export type AdvisorDetail = AdvisorRow & { createdAt: string; updatedAt: string; classDetails: AdvisorClassDetail[] };

/** POST /api/admin/advisors (AD-ADV-02) and PUT /api/admin/advisors/:id (the email cannot change). */
export type AdvisorInput = { name: string; email: string; staffCode?: string | null; unit?: string | null; classes: string[] };

/** One advisor read from the workbook (POST /api/admin/advisors/import/preview, AD-ADV-03). */
export type AdvisorImportItem = {
  /** Workbook rows it was read from (1-based, as Excel numbers them). */
  rows: number[];
  name: string;
  email: string;
  staffCode: string | null;
  unit: string | null;
  /** The classes after splitting the cell(s) ("71K29CNTT01, 71K29CNTT02" → two classes). */
  classes: string[];
  /** add: a new advisor; update: an advisor already in the list whose details or classes change; unchanged; error. */
  status: "add" | "update" | "unchanged" | "error";
  /** What applying changes, in words ("Thêm lớp 71K29CNTT02", "Lớp 71K29CNTT01 chuyển từ Nguyễn Văn A"). */
  changes: string[];
  /** Why the row cannot be imported (status "error"), in words. */
  problems: string[];
  /** Classes without any student in EduPath AI yet (a warning, not an error). */
  emptyClasses: string[];
};
export type AdvisorImportPreview = {
  fileName: string;
  /** Data rows read from the workbook. */
  rows: number;
  items: AdvisorImportItem[];
  /** Problems of the whole file (a missing column, an empty sheet). */
  fileProblems: string[];
  summary: { add: number; update: number; unchanged: number; error: number; classes: number; moved: number };
};
/** POST /api/admin/advisors/import (applies the rows without errors) → the result and the preview it applied. */
export type AdvisorImportResult = { added: number; updated: number; unchanged: number; skipped: number; preview: AdvisorImportPreview };

/** One class of the signed-in advisor (GET /api/admin/advisor-portal/classes, AD-AST-01). */
export type AdvisorClass = AdvisorClassDetail & { surveyDone: number; roadmap: number };

/** One student of the advisor's classes (GET /api/admin/advisor-portal/students, AD-AST-02…04). */
export type AdvisedStudentRow = {
  stt: number;
  userId: string;
  studentCode: string | null;
  name: string;
  className: string;
  cohort: string | null;
  /** student_profiles.specialty label ("Công nghệ phần mềm"), null when not chosen. */
  specialty: string | null;
  targetCareer: string | null;
  hasTranscript: boolean;
  assessed: boolean;
  surveyDone: boolean;
  roadmap: boolean;
  lastLoginAt: string | null;
};
/** status filter of the student list: every student, or those still missing one step. */
export type AdvisedStudentStatus = "all" | "no_transcript" | "no_assessment" | "no_survey" | "no_roadmap" | "complete";

/** GET /api/admin/advisor-portal/permissions (AD-AST-09); the same list as apps/api/src/advisors/permissions.ts. */
export type AdvisorPermissionItem = { label: string; detail: string };
export type AdvisorPermissions = { view: AdvisorPermissionItem[]; act: AdvisorPermissionItem[]; never: AdvisorPermissionItem[]; notes: string[] };

/** GET /api/admin/advisor-portal/me: whether the signed-in account advises classes (the Lớp phụ trách menu item). */
export type AdvisorMe = { classes: number; canManageAdvisors: boolean };

/** Error codes of the advisor endpoints and of the student portal opened by an advisor. */
export const ADVISOR_ERRORS: Record<string, string> = {
  invalid_input: "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.",
  name_required: "Vui lòng nhập họ và tên.",
  email_required: "Vui lòng nhập email.",
  email_not_staff: "Email của cố vấn học tập phải là email cán bộ của trường (@vlu.edu.vn).",
  student_account: "Email này là tài khoản sinh viên, không làm cố vấn học tập được.",
  advisor_exists: "Cố vấn học tập này đã có trong danh sách.",
  classes_required: "Vui lòng nhập ít nhất một lớp phụ trách.",
  invalid_class: "Tên lớp chưa hợp lệ (ví dụ: 71K29CNTT01).",
  class_taken: "Có lớp đang do cố vấn học tập khác phụ trách.",
  account_locked: "Tài khoản này đang bị khóa. Mở khóa ở trang Tài khoản trước.",
  ambiguous_account: "Email này khớp với nhiều tài khoản. Vui lòng kiểm tra ở trang Tài khoản.",
  invalid_filename: "Tên tệp chưa hợp lệ. Vui lòng đổi tên tệp rồi thử lại.",
  workbook_too_large: "Tệp Excel quá lớn (tối đa 5 MB).",
  invalid_query: "Bộ lọc chưa hợp lệ. Vui lòng tải lại trang.",
  advisor_not_found: "Cố vấn học tập này không còn trong danh sách.",
  invalid_workbook: "Tệp không phải Excel (.xlsx) hợp lệ.",
  empty_workbook: "Tệp Excel không có dòng dữ liệu nào.",
  missing_columns: "Tệp Excel thiếu cột Họ và tên, Email hoặc Lớp phụ trách.",
  student_not_advised: "Sinh viên này không thuộc lớp bạn phụ trách.",
  insufficient_role: "Bạn không có quyền thực hiện thao tác này.",
  read_only_role: "Cố vấn học tập chỉ có quyền xem ở trang quản trị.",
  invalid_origin: "Yêu cầu không hợp lệ. Vui lòng tải lại trang.",
  database_required: "Hệ thống chưa kết nối cơ sở dữ liệu. Vui lòng thử lại sau.",
  // Student portal of an advisor (advisors/access.ts).
  advisor_student_forbidden: "Bạn không còn phụ trách lớp của sinh viên này.",
  advisor_action_not_allowed: "Cố vấn học tập không làm thay được thao tác này.",
  // The student withdrew the competency consent ("Xóa kết quả đánh giá"): an advisor does not run it again for them.
  assessment_withdrawn: "Sinh viên đã xóa kết quả đánh giá năng lực nên cố vấn học tập không chạy lại thay được.",
};
