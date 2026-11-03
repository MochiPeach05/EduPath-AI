import { describe, expect, it } from "vitest";
import { ADVISOR_CLASSES_PATH, REPORT_PATHS, adminGroupOf, adminNavigation, adminSidebar, adminSidebarFor, canSeeAdminPage, homeAdminPath, isReportPath, profileIdOf, reportViewOf, resolveAdminPage, studentProfileLink, withoutProfileId, type AdminAccess } from "./admin-navigation";
describe("admin section navigation", () => {
  it("has account, student-profile, curriculum, graduation, training-plan, career, career-field, skill and competency sections", () => {
    expect(adminNavigation.map(item => item.path)).toEqual(["/quantri/tong-quan", "/quantri/bao-cao-tien-do", "/quantri/bao-cao-nguy-co", "/quantri/bao-cao-ky-nang", "/quantri/bao-cao-nghe-nghiep", "/quantri/bao-cao-mon-hoc", "/quantri/nhat-ky", "/quantri/tai-khoan", "/quantri/sinh-vien", "/quantri/co-van-hoc-tap", "/quantri/lop-phu-trach", "/quantri/quyen-co-van", "/quantri/chuong-trinh", "/quantri/tieu-chuan-tot-nghiep", "/quantri/ke-hoach", "/quantri/linh-vuc-nghe-nghiep", "/quantri/ky-nang", "/quantri/vi-tri-nghe-nghiep", "/quantri/nhom-nang-luc", "/quantri/cau-hinh-nang-luc", "/quantri/cau-hinh-mon-hoc", "/quantri/gui-thong-bao", "/quantri/thong-bao-da-gui"]);
  });
  it("uses short sidebar names, which are also the page title and breadcrumb", () => {
    expect(adminNavigation.map(item => item.label)).toEqual(["Tổng quan", "Tiến độ", "Nguy cơ", "Kỹ năng thiếu", "Vị trí mục tiêu", "Môn đề xuất", "Nhật ký", "Tài khoản", "Sinh viên", "Cố vấn", "Lớp phụ trách", "Quyền cố vấn", "Chương trình", "Tốt nghiệp", "Kế hoạch", "Lĩnh vực", "Kỹ năng", "Vị trí nghề nghiệp", "Nhóm năng lực", "Cấu hình năng lực", "Cấu hình môn học", "Gửi thông báo", "Đã gửi"]);
  });
  it("groups the career pages under Quản lý nghề nghiệp, the competency pages under Quản lý năng lực and the announcements under Quản lý thông báo", () => {
    expect(adminSidebar.map(entry => entry.kind === "page" ? entry.page.label : `${entry.label}: ${entry.pages.map(page => page.label).join(", ")}`))
      .toEqual(["Báo cáo: Tổng quan, Tiến độ, Nguy cơ, Kỹ năng thiếu, Vị trí mục tiêu, Môn đề xuất, Nhật ký", "Tài khoản", "Sinh viên", "Cố vấn học tập: Cố vấn, Lớp phụ trách, Quyền cố vấn", "Chương trình", "Tốt nghiệp", "Kế hoạch", "Quản lý nghề nghiệp: Lĩnh vực, Kỹ năng, Vị trí nghề nghiệp",
        "Quản lý năng lực: Nhóm năng lực, Cấu hình năng lực, Cấu hình môn học", "Quản lý thông báo: Gửi thông báo, Đã gửi"]);
    expect(adminGroupOf("/quantri/thong-bao-da-gui")).toBe("announcements");
    expect(adminNavigation.filter(item => item.eyebrow === "QUẢN LÝ NĂNG LỰC").map(item => item.label)).toEqual(["Nhóm năng lực", "Cấu hình năng lực", "Cấu hình môn học"]);
  });
  it.each(["/quantri/sinh-vien", "/quantri/sinh-vien/"])("resolves direct student link %s", path => {
    expect(resolveAdminPage(path).label).toBe("Sinh viên");
  });
  it.each(["/quantri/ke-hoach", "/quantri/ke-hoach/"])("resolves direct training-plan link %s", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/ke-hoach");
  });
  it.each(["/quantri/tieu-chuan-tot-nghiep", "/quantri/tieu-chuan-tot-nghiep/"])("resolves direct graduation link %s", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/tieu-chuan-tot-nghiep");
  });
  it.each(["/quantri/vi-tri-nghe-nghiep", "/quantri/vi-tri-nghe-nghiep/"])("resolves direct career link %s", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/vi-tri-nghe-nghiep");
  });
  it.each(["/quantri/linh-vuc-nghe-nghiep", "/quantri/linh-vuc-nghe-nghiep/"])("resolves direct career-field link %s", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/linh-vuc-nghe-nghiep", label: "Lĩnh vực" });
  });
  it.each(["/quantri/ky-nang", "/quantri/ky-nang/"])("resolves direct skill link %s", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/ky-nang", label: "Kỹ năng" });
  });
  it.each([["/quantri/nhom-nang-luc", "Nhóm năng lực"], ["/quantri/cau-hinh-nang-luc/", "Cấu hình năng lực"], ["/quantri/cau-hinh-mon-hoc", "Cấu hình môn học"]])("resolves direct competency link %s", (path, label) => {
    expect(resolveAdminPage(path).label).toBe(label);
  });
  it.each(["/quantri/cau-hinh-hoc-phan", "/quantri/cau-hinh-hoc-phan/"])("opens Cấu hình môn học for the old Cấu hình học phần link %s (2026-10-20)", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/cau-hinh-mon-hoc", label: "Cấu hình môn học" });
  });
  it.each(["/quantri/danh-gia-nang-luc", "/quantri/danh-gia-nang-luc/"])("opens Nhóm năng lực for the old Năng lực link %s", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/nhom-nang-luc", label: "Nhóm năng lực" });
  });
  it.each(["/quantri/tao-tai-khoan", "/quantri/lich-su-dang-nhap"])("keeps the old account link %s on Tài khoản", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/tai-khoan");
  });
  it.each(["/quantri", "/quantri/", "/quantri/bao-cao", "/quantri/unknown"])("opens Tổng quan of the reports for %s (2026-10-31)", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/tong-quan", label: "Tổng quan", eyebrow: "BÁO CÁO" });
    expect(adminGroupOf(path)).toBe("reports");
  });
  it("knows which pages are reports and which report each one shows", () => {
    expect(Object.values(REPORT_PATHS).every((path) => adminNavigation.some((item) => item.path === path && item.eyebrow === "BÁO CÁO"))).toBe(true);
    expect(reportViewOf("/quantri/bao-cao-ky-nang/")).toBe("skills");
    expect(reportViewOf("/quantri/nhat-ky?q=xuat")).toBe("audit");
    expect(isReportPath("/quantri/ky-nang")).toBe(false);
    expect(isReportPath("/quantri/tong-quan")).toBe(true);
  });
  it("links one student's details on the Sinh viên page and reads the link back", () => {
    const id = "6f1c2a9e-0b7d-4c1e-9a3f-2d4e5f607182";
    expect(studentProfileLink(id)).toBe(`/quantri/sinh-vien?id=${id}`);
    expect(resolveAdminPage(studentProfileLink(id).split("?")[0]!)).toMatchObject({ path: "/quantri/sinh-vien", label: "Sinh viên" });
    expect(profileIdOf(`?id=${id}`)).toBe(id);
    expect(profileIdOf("?id=%20abc%20")).toBe("abc");
    expect(profileIdOf("?id=")).toBeNull();
    expect(profileIdOf("")).toBeNull();
    expect(withoutProfileId(`?id=${id}&tab=2`)).toBe("?tab=2");
    expect(withoutProfileId(`?id=${id}`)).toBe("");
  });
});

describe("admin navigation by role (cố vấn học tập, 2026-11-03)", () => {
  const advisor: AdminAccess = { role: "advisor", advisesClasses: true };
  const admin = (advisesClasses: boolean | null): AdminAccess => ({ role: "admin", advisesClasses });
  const sidebarText = (access: AdminAccess) => adminSidebarFor(access).map(entry => entry.kind === "page" ? entry.page.label : `${entry.label}: ${entry.pages.map(page => page.label).join(", ")}`);

  it("gives an advisor no reports, Nhật ký, Tài khoản or Quản lý thông báo, the rows the function list leaves to the Quản trị viên", () => {
    expect(sidebarText(advisor)).toEqual(["Sinh viên", "Cố vấn học tập: Cố vấn, Lớp phụ trách, Quyền cố vấn", "Chương trình", "Tốt nghiệp", "Kế hoạch",
      "Quản lý nghề nghiệp: Lĩnh vực, Kỹ năng, Vị trí nghề nghiệp", "Quản lý năng lực: Nhóm năng lực, Cấu hình năng lực, Cấu hình môn học"]);
    for (const path of [...Object.values(REPORT_PATHS), "/quantri/tai-khoan", "/quantri/gui-thong-bao", "/quantri/thong-bao-da-gui"]) {
      expect(canSeeAdminPage(path, advisor)).toBe(false);
      expect(resolveAdminPage(path, advisor).path).toBe(ADVISOR_CLASSES_PATH);
    }
  });

  it("opens Lớp phụ trách for an advisor and Tổng quan for everyone else", () => {
    expect(homeAdminPath(advisor)).toBe("/quantri/lop-phu-trach");
    expect(homeAdminPath(admin(true))).toBe("/quantri/tong-quan");
    for (const path of ["/quantri", "/quantri/", "/quantri/unknown", "/quantri/bao-cao"]) {
      expect(resolveAdminPage(path, advisor)).toMatchObject({ path: "/quantri/lop-phu-trach", label: "Lớp phụ trách", eyebrow: "QUẢN LÝ SINH VIÊN CỦA CỐ VẤN HỌC TẬP" });
      expect(adminGroupOf(path, advisor)).toBe("advisors");
    }
    expect(resolveAdminPage("/quantri/ky-nang", advisor).path).toBe("/quantri/ky-nang");
  });

  it("shows Lớp phụ trách to the accounts that advise classes, and keeps a direct link while the answer is unknown", () => {
    expect(sidebarText(admin(null))).toContain("Cố vấn học tập: Cố vấn, Quyền cố vấn");
    expect(sidebarText(admin(false))).toContain("Cố vấn học tập: Cố vấn, Quyền cố vấn");
    expect(sidebarText(admin(true))).toContain("Cố vấn học tập: Cố vấn, Lớp phụ trách, Quyền cố vấn");
    expect(sidebarText(admin(true))[0]).toBe("Báo cáo: Tổng quan, Tiến độ, Nguy cơ, Kỹ năng thiếu, Vị trí mục tiêu, Môn đề xuất, Nhật ký");
    expect(resolveAdminPage(ADVISOR_CLASSES_PATH, admin(null)).path).toBe(ADVISOR_CLASSES_PATH);
    expect(resolveAdminPage(ADVISOR_CLASSES_PATH, admin(true)).path).toBe(ADVISOR_CLASSES_PATH);
    expect(resolveAdminPage(ADVISOR_CLASSES_PATH, admin(false)).path).toBe("/quantri/tong-quan");
    // Without an account (old callers), every page stays reachable.
    expect(resolveAdminPage(ADVISOR_CLASSES_PATH).path).toBe(ADVISOR_CLASSES_PATH);
    expect(adminSidebar.filter(entry => entry.kind === "group").map(entry => entry.kind === "group" ? entry.id : "")).toEqual(["reports", "advisors", "careers", "competencies", "announcements"]);
  });
});
