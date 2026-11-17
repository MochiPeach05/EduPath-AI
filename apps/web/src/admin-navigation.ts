import { canManageAdvisors, type AppRole } from "./types";

export const adminNavigation = [
  // AD-REPORT-01…11 (2026-10-31): the reports come first and their first page is the one /quantri opens. User 2026-11-17: "Thống kê đổi
  // thành tổng quan và tổng quan đổi thành thống kê": the group is Tổng quan and its first page Thống kê (the address stays /quantri/tong-quan).
  { path: "/quantri/tong-quan", label: "Thống kê", eyebrow: "TỔNG QUAN", icon: "chart" },
  { path: "/quantri/bao-cao-tien-do", label: "Tiến độ", eyebrow: "TỔNG QUAN", icon: "route" },
  { path: "/quantri/bao-cao-nguy-co", label: "Nguy cơ", eyebrow: "TỔNG QUAN", icon: "bell" },
  // "Kỹ năng" and "Vị trí nghề nghiệp" already name the catalog pages of Quản lý nghề nghiệp, so the reports say what they count.
  { path: "/quantri/bao-cao-ky-nang", label: "Kỹ năng thiếu", eyebrow: "TỔNG QUAN", icon: "spark" },
  { path: "/quantri/bao-cao-nghe-nghiep", label: "Vị trí mục tiêu", eyebrow: "TỔNG QUAN", icon: "target" },
  { path: "/quantri/bao-cao-mon-hoc", label: "Môn đề xuất", eyebrow: "TỔNG QUAN", icon: "book" },
  { path: "/quantri/nhat-ky", label: "Nhật ký", eyebrow: "TỔNG QUAN", icon: "clock" },
  { path: "/quantri/tai-khoan", label: "Tài khoản", eyebrow: "QUẢN LÝ TÀI KHOẢN", icon: "users" },
  { path: "/quantri/sinh-vien", label: "Sinh viên", eyebrow: "QUẢN LÝ HỒ SƠ SINH VIÊN", icon: "profile" },
  // AD-ADV-01…05 and AD-AST-01…09 (2026-11-03): the faculty's cố vấn học tập, then Quản lý sinh viên, where an advisor sees
  // the students of their classes and the admins every student, opens a student's page and reads what may be done there
  // (user 2026-11-03: "Cái mục quyền cố vấn sửa lại thành quản lý sinh viên").
  // "Danh sách" in the group, the full name as the page title (user 2026-11-14: "Không dùng tên rút gọn “Cố vấn” gây mơ hồ").
  { path: "/quantri/co-van-hoc-tap", label: "Danh sách", title: "Danh sách cố vấn học tập", eyebrow: "QUẢN LÝ CỐ VẤN HỌC TẬP", icon: "user" },
  { path: "/quantri/quan-ly-sinh-vien", label: "Quản lý sinh viên", eyebrow: "QUẢN LÝ SINH VIÊN CỦA CỐ VẤN HỌC TẬP", icon: "cap" },
  // In the order the Khoa sets them up, under full names (user 2026-11-05: "Chương trình đào tạo → Kế hoạch đào tạo → Xét
  // tốt nghiệp", "Tốt nghiệp" alone is too vague).
  { path: "/quantri/chuong-trinh", label: "Chương trình đào tạo", eyebrow: "QUẢN LÝ ĐÀO TẠO", icon: "book" },
  { path: "/quantri/ke-hoach", label: "Kế hoạch đào tạo", eyebrow: "QUẢN LÝ ĐÀO TẠO", icon: "book" },
  { path: "/quantri/tieu-chuan-tot-nghiep", label: "Xét tốt nghiệp", eyebrow: "QUẢN LÝ ĐÀO TẠO", icon: "shield" },
  { path: "/quantri/linh-vuc-nghe-nghiep", label: "Lĩnh vực", eyebrow: "QUẢN LÝ NGHỀ NGHIỆP", icon: "book" },
  { path: "/quantri/ky-nang", label: "Kỹ năng", eyebrow: "QUẢN LÝ NGHỀ NGHIỆP", icon: "book" },
  { path: "/quantri/vi-tri-nghe-nghiep", label: "Vị trí nghề nghiệp", eyebrow: "QUẢN LÝ NGHỀ NGHIỆP", icon: "users" },
  { path: "/quantri/nhom-nang-luc", label: "Nhóm năng lực", eyebrow: "QUẢN LÝ NĂNG LỰC", icon: "book" },
  { path: "/quantri/cau-hinh-nang-luc", label: "Cấu hình năng lực", eyebrow: "QUẢN LÝ NĂNG LỰC", icon: "profile" },
  { path: "/quantri/cau-hinh-mon-hoc", label: "Cấu hình môn học", eyebrow: "QUẢN LÝ NĂNG LỰC", icon: "chart" },
  // AD-NOTI-01/02 (2026-10-30): the faculty's announcements to the students' bell; email comes later.
  { path: "/quantri/gui-thong-bao", label: "Gửi thông báo", eyebrow: "QUẢN LÝ THÔNG BÁO", icon: "bell" },
  { path: "/quantri/thong-bao-da-gui", label: "Đã gửi", eyebrow: "QUẢN LÝ THÔNG BÁO", icon: "clock" }
] as const;
export type AdminPage = (typeof adminNavigation)[number];

/**
 * Sidebar groups: one entry that opens and closes, with its pages below it. A group sits where its
 * first page is in adminNavigation; its pages keep their own paths, titles and breadcrumbs.
 */
const adminNavigationGroups = [
  { id: "reports", label: "Tổng quan", icon: "home", paths: ["/quantri/tong-quan", "/quantri/bao-cao-tien-do", "/quantri/bao-cao-nguy-co", "/quantri/bao-cao-ky-nang", "/quantri/bao-cao-nghe-nghiep", "/quantri/bao-cao-mon-hoc", "/quantri/nhat-ky"] },
  { id: "advisors", label: "Cố vấn học tập", icon: "compass", paths: ["/quantri/co-van-hoc-tap", "/quantri/quan-ly-sinh-vien"] },
  // In the order they are set up: fields, then the shared skills, then the careers that use both.
  { id: "careers", label: "Quản lý nghề nghiệp", icon: "briefcase", paths: ["/quantri/linh-vuc-nghe-nghiep", "/quantri/ky-nang", "/quantri/vi-tri-nghe-nghiep"] },
  { id: "competencies", label: "Quản lý năng lực", icon: "target", paths: ["/quantri/nhom-nang-luc", "/quantri/cau-hinh-nang-luc", "/quantri/cau-hinh-mon-hoc"] },
  { id: "announcements", label: "Quản lý thông báo", icon: "bell", paths: ["/quantri/gui-thong-bao", "/quantri/thong-bao-da-gui"] }
] as const;

/** Pages that moved: an old link opens the page that replaced it. */
const adminPathAliases: Record<string, string> = {
  // The account pages kept their old links when Tổng quan became the page /quantri opens (2026-10-31).
  "/quantri/tao-tai-khoan": "/quantri/tai-khoan",
  "/quantri/lich-su-dang-nhap": "/quantri/tai-khoan",
  "/quantri/bao-cao": "/quantri/tong-quan",
  // "Năng lực" (one page with three tabs) became the three pages of "Quản lý năng lực" on 2026-10-17.
  "/quantri/danh-gia-nang-luc": "/quantri/nhom-nang-luc",
  // "Cấu hình học phần" (per CTĐT revision) became "Cấu hình môn học" (shared courses) on 2026-10-20.
  "/quantri/cau-hinh-hoc-phan": "/quantri/cau-hinh-mon-hoc",
  // "Lớp phụ trách" and "Quyền cố vấn" became the one page "Quản lý sinh viên" on 2026-11-03.
  "/quantri/lop-phu-trach": "/quantri/quan-ly-sinh-vien",
  "/quantri/quyen-co-van": "/quantri/quan-ly-sinh-vien"
};

type AdminSidebarEntry =
  | { kind: "page"; page: AdminPage }
  | { kind: "group"; id: string; label: string; icon: string; pages: AdminPage[] };

/** What the sidebar shows, in order: single pages and groups (every page; adminSidebarFor keeps an account's own). */
export const adminSidebar: AdminSidebarEntry[] = adminNavigation.flatMap((page): AdminSidebarEntry[] => {
  const group = adminNavigationGroups.find((item) => (item.paths as readonly string[]).includes(page.path));
  if (!group) return [{ kind: "page", page }];
  if (group.paths[0] !== page.path) return [];
  const pages = group.paths.map((path) => adminNavigation.find((item) => item.path === path)!);
  return [{ kind: "group", id: group.id, label: group.label, icon: group.icon, pages }];
});

export const ADVISORS_PATH = "/quantri/co-van-hoc-tap";
/** Quản lý sinh viên (AD-AST-01…09): the students, their page by "Xem chi tiết", and what may be done there. */
export const ADVISOR_STUDENTS_PATH = "/quantri/quan-ly-sinh-vien";

/**
 * Who looks at the admin portal: the role, and whether the account advises classes (GET /api/admin/advisor-portal/me;
 * null until it answers).
 */
export type AdminAccess = { role: AppRole; advisesClasses: boolean | null };

/**
 * The pages of a cố vấn học tập (role advisor): those of the function-list rows whose Tác nhân includes CVHT ("QTV &
 * CVHT" and "Cố vấn học tập"; user, 2026-11-04), read only, and since 2026-11-07 (user: "cho CVHT xem nữa") Thống kê
 * over the students of their own classes and Nhật ký with their own actions (AD-REPORT; the API scopes them). Tài khoản
 * (AD-AUTH-03…10) and Quản lý thông báo (AD-NOTI) belong to the Quản trị viên alone; a page added later stays closed to
 * advisors until it is listed here. The API keeps the same list (apps/api/src/advisors/access.ts, ADVISOR_ADMIN_READS).
 */
const ADVISOR_PAGES: ReadonlySet<string> = new Set<string>([
  // AD-REPORT-01…11: Thống kê over the own classes, Nhật ký with the own actions (REPORT_PATHS, written out: it comes later).
  "/quantri/tong-quan", "/quantri/bao-cao-tien-do", "/quantri/bao-cao-nguy-co", "/quantri/bao-cao-ky-nang", "/quantri/bao-cao-nghe-nghiep",
  "/quantri/bao-cao-mon-hoc", "/quantri/nhat-ky",
  "/quantri/sinh-vien", // AD-PROF-01…04: the students of the advisor's classes
  ADVISORS_PATH, // AD-ADV-04, 05
  ADVISOR_STUDENTS_PATH, // AD-AST-01…09
  "/quantri/chuong-trinh", // AD-CURR-03…06, AD-SUB-01, 02
  "/quantri/ke-hoach", // AD-PLAN-03…09, 13
  "/quantri/tieu-chuan-tot-nghiep", // AD-GRAD-03…07, 12
  "/quantri/linh-vuc-nghe-nghiep", // AD-FIELD-01…03
  "/quantri/ky-nang", // AD-SKILL-01…03
  "/quantri/vi-tri-nghe-nghiep", // AD-CAREER-01, 02, 06, 07, AD-REQ-07…10
  "/quantri/nhom-nang-luc", // AD-COMP-01…04
  "/quantri/cau-hinh-nang-luc", // AD-CMP-01…04
  "/quantri/cau-hinh-mon-hoc", // AD-CRS-01…04
]);

/** Quản lý sinh viên always belongs to the admins and Ban chủ nhiệm khoa (every student) and to the role advisor (its classes). */
const alwaysSeesStudents = (access: AdminAccess) => access.role === "advisor" || canManageAdvisors(access.role);

/**
 * Whether an account may open a page. Quản lý sinh viên is also the page of the other accounts that advise classes;
 * while the answer is unknown it counts as open, so a direct link is not sent away before the answer comes.
 */
export function canSeeAdminPage(path: string, access: AdminAccess): boolean {
  if (access.role === "advisor") return ADVISOR_PAGES.has(path);
  return path !== ADVISOR_STUDENTS_PATH || alwaysSeesStudents(access) || access.advisesClasses !== false;
}

/** The page's heading, breadcrumb and browser tab title: its sidebar name, or the full name of a page that has one. */
export const adminPageTitle = (page: AdminPage): string => ("title" in page ? page.title : page.label);

/** A page as the sidebar shows it: "Thống kê / Nhật ký" inside a group, "Tài khoản" alone. */
export function adminPageName(page: AdminPage): string {
  const group = adminNavigationGroups.find((item) => (item.paths as readonly string[]).includes(page.path));
  return group ? `${group.label} / ${page.label}` : page.label;
}

/**
 * The page of the Quản trị viên an address asks a cố vấn học tập to open (typed, bookmarked, or an old link to it), or
 * null. The portal shows the advisor's home instead, with advisorRefusedText above it.
 */
export function refusedAdminPage(pathname: string, access: AdminAccess): AdminPage | null {
  if (access.role !== "advisor") return null;
  const path = pathname.replace(/\/+$/, "");
  const page = adminNavigation.find((item) => item.path === (adminPathAliases[path] ?? path));
  return page && !canSeeAdminPage(page.path, access) ? page : null;
}

/** What a cố vấn học tập reads after asking for a page of the Quản trị viên. */
export const advisorRefusedText = (page: AdminPage) =>
  `Bạn không có quyền mở trang “${adminPageName(page)}”. Trang này chỉ dành cho quản trị viên; cố vấn học tập được chuyển về Quản lý sinh viên.`;

/** The page /quantri opens, and where a closed page leads: Quản lý sinh viên for an advisor, Tổng quan of the reports otherwise. */
export const homeAdminPath = (access: AdminAccess) => (access.role === "advisor" ? ADVISOR_STUDENTS_PATH : adminNavigation[0].path);

/**
 * The sidebar of one account: the groups and pages it may open; Quản lý sinh viên for the admins, Ban chủ nhiệm khoa and
 * the role advisor, and for another account once it is known to advise classes.
 */
export function adminSidebarFor(access: AdminAccess): AdminSidebarEntry[] {
  const shown = (page: AdminPage) => canSeeAdminPage(page.path, access)
    && (page.path !== ADVISOR_STUDENTS_PATH || alwaysSeesStudents(access) || access.advisesClasses === true);
  return adminSidebar.flatMap((entry): AdminSidebarEntry[] => {
    if (entry.kind === "page") return shown(entry.page) ? [entry] : [];
    const pages = entry.pages.filter(shown);
    return pages.length ? [{ ...entry, pages }] : [];
  });
}

/**
 * Whether an address under /quantri is the admin portal: /quantri itself, one of its pages or an old link to one. Any
 * other address there is Không tìm thấy trang (routing.ts), not Tổng quan under a wrong address.
 */
export function isAdminPortalPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "");
  return path === "/quantri" || adminNavigation.some((item) => item.path === (adminPathAliases[path] ?? path));
}

/** The page an address shows (an old link opens the page that replaced it); with access, a page the account may not open leads home. */
export function resolveAdminPage(pathname: string, access?: AdminAccess): AdminPage {
  const path = pathname.replace(/\/+$/, "");
  const target = adminPathAliases[path] ?? path;
  const page = adminNavigation.find((item) => item.path === target);
  if (!access) return page ?? adminNavigation[0];
  if (page && canSeeAdminPage(page.path, access)) return page;
  const home = homeAdminPath(access);
  return adminNavigation.find((item) => item.path === home)!;
}

/** The group holding a page ("reports", "advisors", "careers", "competencies" or "announcements"), or null for a page outside the groups. */
export function adminGroupOf(pathname: string, access?: AdminAccess) {
  const { path } = resolveAdminPage(pathname, access);
  const group = adminSidebar.find((entry) => entry.kind === "group" && entry.pages.some((page) => page.path === path));
  return group?.kind === "group" ? group.id : null;
}

/**
 * The open group after a click on a group's entry. One group at a time (user, 2026-10-28: "mở tab Quản lý nghề nghiệp
 * thì đóng tab quản lý năng lực và ngược lại"): a closed group opens and the other closes; the open group closes.
 */
export function toggleAdminGroup(openGroup: string | null, clicked: string) {
  return openGroup === clicked ? null : clicked;
}

/** The report pages (AD-REPORT-01…11) and the view each one shows. */
export const REPORT_PATHS = {
  dashboard: "/quantri/tong-quan",
  progress: "/quantri/bao-cao-tien-do",
  risk: "/quantri/bao-cao-nguy-co",
  skills: "/quantri/bao-cao-ky-nang",
  careers: "/quantri/bao-cao-nghe-nghiep",
  courses: "/quantri/bao-cao-mon-hoc",
  audit: "/quantri/nhat-ky",
} as const;
export type ReportView = keyof typeof REPORT_PATHS;

/** The report a path shows ("dashboard" for /quantri/tong-quan), or null for any other page. */
export function reportViewOf(path: string): ReportView | null {
  const clean = path.split("?")[0]!.replace(/\/+$/, "");
  const entry = (Object.entries(REPORT_PATHS) as [ReportView, string][]).find(([, reportPath]) => reportPath === clean);
  return entry ? entry[0] : null;
}
export const isReportPath = (path: string) => reportViewOf(path) !== null;

/**
 * One student's details on the Sinh viên page, by link ("Xem hồ sơ" in the reports, user 2026-10-31): ?id=<users.id>, the
 * id GET /api/admin/students/:id reads. The address opens the details, a reload keeps them, closing drops the parameter.
 */
export const STUDENT_PROFILE_PATH = "/quantri/sinh-vien";
export const studentProfileLink = (userId: string) => `${STUDENT_PROFILE_PATH}?${new URLSearchParams({ id: userId })}`;
/** The student an address opens ("?id=…"), or null. Any id is kept as written, so an unknown one gets the API's not-found message. */
export function profileIdOf(search: string): string | null {
  const id = new URLSearchParams(search).get("id")?.trim();
  return id ? id.slice(0, 100) : null;
}
/** The same query without the student ("?id=…&x=1" → "?x=1"; "" when nothing is left). */
export function withoutProfileId(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("id");
  const text = params.toString();
  return text ? `?${text}` : "";
}
