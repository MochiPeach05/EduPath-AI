import { describe, expect, it } from "vitest";
import { ADVISOR_STUDENTS_PATH, REPORT_PATHS, adminGroupOf, adminNavigation, adminPageName, adminSidebar, adminSidebarFor, advisorRefusedText, canSeeAdminPage, homeAdminPath, isReportPath, profileIdOf, refusedAdminPage, reportViewOf, resolveAdminPage, studentProfileLink, withoutProfileId, type AdminAccess } from "./admin-navigation";
describe("admin section navigation", () => {
  it("has account, student-profile, curriculum, graduation, training-plan, career, career-field, skill and competency sections", () => {
    expect(adminNavigation.map(item => item.path)).toEqual(["/quantri/tong-quan", "/quantri/bao-cao-tien-do", "/quantri/bao-cao-nguy-co", "/quantri/bao-cao-ky-nang", "/quantri/bao-cao-nghe-nghiep", "/quantri/bao-cao-mon-hoc", "/quantri/nhat-ky", "/quantri/tai-khoan", "/quantri/sinh-vien", "/quantri/co-van-hoc-tap", "/quantri/quan-ly-sinh-vien", "/quantri/chuong-trinh", "/quantri/ke-hoach", "/quantri/tieu-chuan-tot-nghiep", "/quantri/linh-vuc-nghe-nghiep", "/quantri/ky-nang", "/quantri/vi-tri-nghe-nghiep", "/quantri/nhom-nang-luc", "/quantri/cau-hinh-nang-luc", "/quantri/cau-hinh-mon-hoc", "/quantri/gui-thong-bao", "/quantri/thong-bao-da-gui"]);
  });
  it("uses short sidebar names, which are also the page title and breadcrumb", () => {
    expect(adminNavigation.map(item => item.label)).toEqual(["Tổng quan", "Tiến độ", "Nguy cơ", "Kỹ năng thiếu", "Vị trí mục tiêu", "Môn đề xuất", "Nhật ký", "Tài khoản", "Sinh viên", "Cố vấn", "Quản lý sinh viên", "Chương trình đào tạo", "Kế hoạch đào tạo", "Xét tốt nghiệp", "Lĩnh vực", "Kỹ năng", "Vị trí nghề nghiệp", "Nhóm năng lực", "Cấu hình năng lực", "Cấu hình môn học", "Gửi thông báo", "Đã gửi"]);
  });
  it("groups the career pages under Quản lý nghề nghiệp, the competency pages under Quản lý năng lực and the announcements under Quản lý thông báo", () => {
    expect(adminSidebar.map(entry => entry.kind === "page" ? entry.page.label : `${entry.label}: ${entry.pages.map(page => page.label).join(", ")}`))
      .toEqual(["Thống kê: Tổng quan, Tiến độ, Nguy cơ, Kỹ năng thiếu, Vị trí mục tiêu, Môn đề xuất, Nhật ký", "Tài khoản", "Sinh viên", "Cố vấn học tập: Cố vấn, Quản lý sinh viên", "Chương trình đào tạo", "Kế hoạch đào tạo", "Xét tốt nghiệp", "Quản lý nghề nghiệp: Lĩnh vực, Kỹ năng, Vị trí nghề nghiệp",
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
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/tong-quan", label: "Tổng quan", eyebrow: "THỐNG KÊ" });
    expect(adminGroupOf(path)).toBe("reports");
  });
  it("knows which pages are reports and which report each one shows", () => {
    expect(Object.values(REPORT_PATHS).every((path) => adminNavigation.some((item) => item.path === path && item.eyebrow === "THỐNG KÊ"))).toBe(true);
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

  it("gives an advisor Thống kê (2026-11-07) but not Tài khoản or Quản lý thông báo, the rows left to the Quản trị viên", () => {
    expect(sidebarText(advisor)).toEqual(["Thống kê: Tổng quan, Tiến độ, Nguy cơ, Kỹ năng thiếu, Vị trí mục tiêu, Môn đề xuất, Nhật ký",
      "Sinh viên", "Cố vấn học tập: Cố vấn, Quản lý sinh viên", "Chương trình đào tạo", "Kế hoạch đào tạo", "Xét tốt nghiệp",
      "Quản lý nghề nghiệp: Lĩnh vực, Kỹ năng, Vị trí nghề nghiệp", "Quản lý năng lực: Nhóm năng lực, Cấu hình năng lực, Cấu hình môn học"]);
    for (const path of Object.values(REPORT_PATHS)) {
      expect(canSeeAdminPage(path, advisor)).toBe(true);
      expect(resolveAdminPage(path, advisor).path).toBe(path);
    }
    for (const path of ["/quantri/tai-khoan", "/quantri/gui-thong-bao", "/quantri/thong-bao-da-gui"]) {
      expect(canSeeAdminPage(path, advisor)).toBe(false);
      expect(resolveAdminPage(path, advisor).path).toBe(ADVISOR_STUDENTS_PATH);
    }
  });

  it("opens exactly the pages of the rows whose Tác nhân includes CVHT (function list ver0.3, 2026-11-04)", () => {
    const cvhtPages = {
      // Thống kê over the own classes and Nhật ký with the own actions (user 2026-11-07: "cho CVHT xem nữa").
      "/quantri/tong-quan": "AD-REPORT", "/quantri/bao-cao-tien-do": "AD-REPORT", "/quantri/bao-cao-nguy-co": "AD-REPORT",
      "/quantri/bao-cao-ky-nang": "AD-REPORT", "/quantri/bao-cao-nghe-nghiep": "AD-REPORT", "/quantri/bao-cao-mon-hoc": "AD-REPORT",
      "/quantri/nhat-ky": "AD-REPORT-11",
      "/quantri/sinh-vien": "AD-PROF-01…04", "/quantri/co-van-hoc-tap": "AD-ADV-04, 05", "/quantri/quan-ly-sinh-vien": "AD-AST-01…09",
      "/quantri/chuong-trinh": "AD-CURR-03…06, AD-SUB-01, 02", "/quantri/ke-hoach": "AD-PLAN-03…09, 13", "/quantri/tieu-chuan-tot-nghiep": "AD-GRAD-03…07, 12",
      "/quantri/linh-vuc-nghe-nghiep": "AD-FIELD-01…03", "/quantri/ky-nang": "AD-SKILL-01…03", "/quantri/vi-tri-nghe-nghiep": "AD-CAREER-01, 02, 06, 07, AD-REQ-07…10",
      "/quantri/nhom-nang-luc": "AD-COMP-01…04", "/quantri/cau-hinh-nang-luc": "AD-CMP-01…04", "/quantri/cau-hinh-mon-hoc": "AD-CRS-01…04",
    } as Record<string, string>;
    expect(adminNavigation.filter((page) => canSeeAdminPage(page.path, advisor)).map((page) => page.path)).toEqual(Object.keys(cvhtPages));
    // Every other page is the Quản trị viên's: AD-AUTH-03…10 (Tài khoản), AD-NOTI (Thông báo).
    expect(adminNavigation.filter((page) => !canSeeAdminPage(page.path, advisor)).map((page) => adminPageName(page))).toEqual(["Tài khoản",
      "Quản lý thông báo / Gửi thông báo", "Quản lý thông báo / Đã gửi"]);
    // A page that is not listed stays closed to an advisor, whatever it is.
    expect(canSeeAdminPage("/quantri/trang-moi", advisor)).toBe(false);
  });

  it("names the page of the Quản trị viên an advisor asked for, and only for an advisor", () => {
    expect(refusedAdminPage("/quantri/tai-khoan", advisor)?.label).toBe("Tài khoản");
    // Old links to a closed page are refused as the page they open.
    expect(refusedAdminPage("/quantri/tao-tai-khoan", advisor)?.path).toBe("/quantri/tai-khoan");
    // The advisor's own pages (Thống kê and Nhật ký since 2026-11-07, also by an old link), the portal's address and
    // unknown addresses are not refusals.
    for (const path of ["/quantri", "/quantri/", "/quantri/ky-nang", "/quantri/lop-phu-trach", ADVISOR_STUDENTS_PATH, "/quantri/unknown",
      "/quantri/nhat-ky/", "/quantri/bao-cao"]) {
      expect(refusedAdminPage(path, advisor)).toBeNull();
    }
    for (const role of ["admin", "faculty_board", "department_head", "lecturer"] as const) {
      expect(refusedAdminPage("/quantri/tai-khoan", { role, advisesClasses: false })).toBeNull();
    }
    expect(advisorRefusedText(refusedAdminPage("/quantri/gui-thong-bao", advisor)!))
      .toBe("Bạn không có quyền mở trang “Quản lý thông báo / Gửi thông báo”. Trang này chỉ dành cho quản trị viên; cố vấn học tập được chuyển về Quản lý sinh viên.");
  });

  it("opens Quản lý sinh viên for an advisor and Tổng quan for everyone else", () => {
    expect(homeAdminPath(advisor)).toBe("/quantri/quan-ly-sinh-vien");
    expect(homeAdminPath(admin(true))).toBe("/quantri/tong-quan");
    for (const path of ["/quantri", "/quantri/", "/quantri/unknown"]) {
      expect(resolveAdminPage(path, advisor)).toMatchObject({ path: "/quantri/quan-ly-sinh-vien", label: "Quản lý sinh viên", eyebrow: "QUẢN LÝ SINH VIÊN CỦA CỐ VẤN HỌC TẬP" });
      expect(adminGroupOf(path, advisor)).toBe("advisors");
    }
    // The old address of the reports opens Tổng quan, which an advisor reads since 2026-11-07.
    expect(resolveAdminPage("/quantri/bao-cao", advisor).path).toBe("/quantri/tong-quan");
    expect(resolveAdminPage("/quantri/ky-nang", advisor).path).toBe("/quantri/ky-nang");
  });

  it.each(["/quantri/lop-phu-trach", "/quantri/quyen-co-van/"])("opens Quản lý sinh viên for the old link %s (2026-11-03)", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: ADVISOR_STUDENTS_PATH, label: "Quản lý sinh viên" });
    expect(resolveAdminPage(path, advisor).path).toBe(ADVISOR_STUDENTS_PATH);
    expect(resolveAdminPage(path, admin(false)).path).toBe(ADVISOR_STUDENTS_PATH);
  });

  it("always shows Quản lý sinh viên to the admins, Ban chủ nhiệm khoa and advisors, to other accounts once they advise classes", () => {
    const other = (advisesClasses: boolean | null): AdminAccess => ({ role: "lecturer", advisesClasses });
    for (const access of [admin(null), admin(false), admin(true), { role: "faculty_board", advisesClasses: false } as AdminAccess, advisor]) {
      expect(sidebarText(access)).toContain("Cố vấn học tập: Cố vấn, Quản lý sinh viên");
      expect(resolveAdminPage(ADVISOR_STUDENTS_PATH, access).path).toBe(ADVISOR_STUDENTS_PATH);
    }
    expect(sidebarText(admin(true))[0]).toBe("Thống kê: Tổng quan, Tiến độ, Nguy cơ, Kỹ năng thiếu, Vị trí mục tiêu, Môn đề xuất, Nhật ký");
    expect(sidebarText(other(null))).toContain("Cố vấn học tập: Cố vấn");
    expect(sidebarText(other(false))).toContain("Cố vấn học tập: Cố vấn");
    expect(sidebarText(other(true))).toContain("Cố vấn học tập: Cố vấn, Quản lý sinh viên");
    // While the answer is unknown a direct link stays open; once it says no classes, the page leads home.
    expect(resolveAdminPage(ADVISOR_STUDENTS_PATH, other(null)).path).toBe(ADVISOR_STUDENTS_PATH);
    expect(resolveAdminPage(ADVISOR_STUDENTS_PATH, other(true)).path).toBe(ADVISOR_STUDENTS_PATH);
    expect(resolveAdminPage(ADVISOR_STUDENTS_PATH, other(false)).path).toBe("/quantri/tong-quan");
    // Without an account (old callers), every page stays reachable.
    expect(resolveAdminPage(ADVISOR_STUDENTS_PATH).path).toBe(ADVISOR_STUDENTS_PATH);
    expect(adminSidebar.filter(entry => entry.kind === "group").map(entry => entry.kind === "group" ? entry.id : "")).toEqual(["reports", "advisors", "careers", "competencies", "announcements"]);
  });
});
