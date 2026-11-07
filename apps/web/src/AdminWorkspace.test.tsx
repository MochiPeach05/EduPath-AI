import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminWorkspace from "./AdminWorkspace";
import { adminGroupOf, adminNavigation, toggleAdminGroup } from "./admin-navigation";
import type { AuthenticatedUser } from "./types";

const user: AuthenticatedUser = { userId: "u1", identityKey: "k", tenantId: "t", objectId: "o", name: "Quản trị", email: null, username: null, role: "admin", signedInAt: "2026-10-13T00:00:00Z" };

function render(pathname: string, as: AuthenticatedUser = user) {
  vi.stubGlobal("window", { location: { pathname, hash: "", search: "" } });
  return renderToStaticMarkup(<AdminWorkspace user={as} busy={false} error={null} onLogout={() => undefined} />);
}
const sidebarNames = (html: string) => [...(html.match(/<nav id="admin-navigation".*?<\/nav>/s)?.[0] ?? "").matchAll(/<span>([^<]*)<\/span>/g)].map(match => match[1]);

afterEach(() => vi.unstubAllGlobals());

describe("admin workspace", () => {
  it("names the person in the header, with initials and the MSSV beside the role (QA 2026-11-04)", () => {
    // A synthetic account named as Microsoft names students: "MSSV - Họ tên - Lớp".
    const html = render("/quantri/tai-khoan", { ...user, name: "2374802010145 - Đào Văn Hòa - 71K29CNTT08" });
    expect(html).toContain('<span class="am-avatar" aria-hidden="true">VH</span><div><strong>Đào Văn Hòa</strong><small>Quản trị viên · 2374802010145</small></div>');
    expect(html).not.toContain("71K29CNTT08");
    // A staff account keeps its name; without letters the avatar shows a person icon.
    expect(render("/quantri/tai-khoan", { ...user, name: "Nguyễn Bảo Duy", role: "faculty_board" }))
      .toContain('<span class="am-avatar" aria-hidden="true">BD</span><div><strong>Nguyễn Bảo Duy</strong><small>Ban chủ nhiệm khoa</small></div>');
    expect(render("/quantri/tai-khoan", { ...user, name: "2374802010145" })).toMatch(/<span class="am-avatar" aria-hidden="true"><svg class="ep-icon /);
  });

  it("shows the short names in the sidebar, in order, with the groups and their pages", () => {
    // Quản lý sinh viên is always an admin's page (every student, 2026-11-03), before GET advisor-portal/me answers too.
    expect(sidebarNames(render("/quantri/tai-khoan"))).toEqual(
      ["Thống kê", "Tổng quan", "Tiến độ", "Nguy cơ", "Kỹ năng thiếu", "Vị trí mục tiêu", "Môn đề xuất", "Nhật ký", "Tài khoản", "Sinh viên", "Cố vấn học tập", "Cố vấn", "Quản lý sinh viên", "Chương trình đào tạo", "Kế hoạch đào tạo", "Xét tốt nghiệp", "Quản lý nghề nghiệp", "Lĩnh vực", "Kỹ năng", "Vị trí nghề nghiệp",
        "Quản lý năng lực", "Nhóm năng lực", "Cấu hình năng lực", "Cấu hình môn học", "Quản lý thông báo", "Gửi thông báo", "Đã gửi"]);
  });

  it("keeps Quản lý năng lực closed elsewhere and open on its pages", () => {
    expect(render("/quantri/vi-tri-nghe-nghiep")).toContain('<button type="button" class="am-nav-group-toggle" aria-expanded="false" aria-controls="admin-navigation-competencies">');
    for (const path of ["/quantri/nhom-nang-luc", "/quantri/cau-hinh-nang-luc", "/quantri/cau-hinh-mon-hoc"]) {
      const open = render(path);
      expect(open).toContain('<button type="button" class="am-nav-group-toggle am-nav-group-current" aria-expanded="true" aria-controls="admin-navigation-competencies">');
      expect(open).toContain('<div id="admin-navigation-competencies" class="am-nav-sub">');
      expect(open).toContain(`<a href="${path}" aria-current="page">`);
      expect(open).toContain(">QUẢN LÝ NĂNG LỰC</p>");
    }
  });

  it("keeps Quản lý nghề nghiệp closed elsewhere and open on its pages", () => {
    const closed = render("/quantri/tai-khoan");
    expect(closed).toContain('<button type="button" class="am-nav-group-toggle" aria-expanded="false" aria-controls="admin-navigation-careers">');
    expect(closed).toContain('<div id="admin-navigation-careers" class="am-nav-sub" hidden="">');
    for (const path of ["/quantri/vi-tri-nghe-nghiep", "/quantri/linh-vuc-nghe-nghiep", "/quantri/ky-nang"]) {
      const open = render(path);
      expect(open).toContain('<button type="button" class="am-nav-group-toggle am-nav-group-current" aria-expanded="true" aria-controls="admin-navigation-careers">');
      expect(open).toContain('<div id="admin-navigation-careers" class="am-nav-sub">');
      expect(open).toContain(`<a href="${path}" aria-current="page">`);
      // The "Gợi ý quản lý nghề nghiệp" box was removed at the user's request (2026-10-17).
      expect(open).not.toContain("Gợi ý quản lý nghề nghiệp");
    }
  });

  it("opens one group at a time: opening one group closes the other (user, 2026-10-28)", () => {
    // On Kỹ năng, Quản lý nghề nghiệp is open. Opening Quản lý năng lực closes it, and the reverse;
    // a click on the open group closes it, so both can be closed.
    let open = adminGroupOf("/quantri/ky-nang");
    expect(open).toBe("careers");
    open = toggleAdminGroup(open, "competencies");
    expect(open).toBe("competencies");
    open = toggleAdminGroup(open, "careers");
    expect(open).toBe("careers");
    open = toggleAdminGroup(open, "careers");
    expect(open).toBeNull();
    expect(toggleAdminGroup(open, "competencies")).toBe("competencies");
  });

  it("opens the group of the page shown and closes the other one (user, 2026-10-28)", () => {
    const openGroups = (html: string) => [...html.matchAll(/aria-expanded="true" aria-controls="admin-navigation-(\w+)"/g)].map(match => match[1]);
    const careerPages = ["/quantri/linh-vuc-nghe-nghiep", "/quantri/ky-nang", "/quantri/vi-tri-nghe-nghiep"];
    const competencyPages = ["/quantri/nhom-nang-luc", "/quantri/cau-hinh-nang-luc", "/quantri/cau-hinh-mon-hoc"];
    const announcementPages = ["/quantri/gui-thong-bao", "/quantri/thong-bao-da-gui"];
    const advisorPages = ["/quantri/co-van-hoc-tap", "/quantri/quan-ly-sinh-vien"];
    const reportPages = adminNavigation.filter(item => item.eyebrow === "THỐNG KÊ").map(item => item.path as string);
    for (const { path } of adminNavigation) {
      expect(openGroups(render(path))).toEqual(careerPages.includes(path) ? ["careers"] : competencyPages.includes(path) ? ["competencies"]
        : announcementPages.includes(path) ? ["announcements"] : reportPages.includes(path) ? ["reports"] : advisorPages.includes(path) ? ["advisors"] : []);
    }
    // An old link or a trailing slash opens the group of the page it shows.
    expect(openGroups(render("/quantri/danh-gia-nang-luc"))).toEqual(["competencies"]);
    expect(openGroups(render("/quantri/quyen-co-van"))).toEqual(["advisors"]);
    expect(openGroups(render("/quantri/ky-nang/"))).toEqual(["careers"]);
  });

  it.each(adminNavigation.map(item => [item.label, item.path] as const))("uses %s as the page title and the breadcrumb", (label, path) => {
    const html = render(path);
    expect(html).toContain(`>${label}</h1>`);
    expect(html).toContain(`Quản trị / <strong>${label}</strong>`);
  });

  it("opens on Tổng quan of the reports, with the shared filter bar (2026-10-31)", () => {
    const html = render("/quantri");
    expect(html).toContain(">Tổng quan</h1>");
    expect(html).toContain(">THỐNG KÊ</p>");
    expect(html).toContain('aria-label="Tìm kiếm và lọc dữ liệu thống kê"');
    expect(html).toContain('<a href="/quantri/tong-quan" aria-current="page">');
    expect(render("/quantri/nhat-ky")).toContain("Tìm trong nhật ký");
  });

  it("gives a cố vấn học tập the pages of the CVHT rows and opens Quản lý sinh viên (2026-11-03)", () => {
    const advisor: AuthenticatedUser = { ...user, userId: "a1", name: "Cố vấn", role: "advisor" };
    const home = render("/quantri", advisor);
    expect(sidebarNames(home)).toEqual(["Thống kê", "Tổng quan", "Tiến độ", "Nguy cơ", "Kỹ năng thiếu", "Vị trí mục tiêu", "Môn đề xuất", "Nhật ký",
      "Sinh viên", "Cố vấn học tập", "Cố vấn", "Quản lý sinh viên", "Chương trình đào tạo", "Kế hoạch đào tạo", "Xét tốt nghiệp",
      "Quản lý nghề nghiệp", "Lĩnh vực", "Kỹ năng", "Vị trí nghề nghiệp", "Quản lý năng lực", "Nhóm năng lực", "Cấu hình năng lực", "Cấu hình môn học"]);
    expect(home).toContain(">Quản lý sinh viên</h1>");
    expect(home).toContain(">QUẢN LÝ SINH VIÊN CỦA CỐ VẤN HỌC TẬP</p>");
    expect(home).toContain('<a href="/quantri/quan-ly-sinh-vien" aria-current="page">');
    expect(home).toContain("<small>Cố vấn học tập</small>");
    // The advisor's students only; the old pages' links open the same page.
    expect(home).toContain("Bạn xem được sinh viên của các lớp Khoa phân công cho bạn.");
    expect(home).toContain(">Lớp phụ trách<");
    for (const path of ["/quantri/lop-phu-trach", "/quantri/quyen-co-van"]) expect(render(path, advisor)).toContain(">Quản lý sinh viên</h1>");
    // Thống kê and Nhật ký open (user 2026-11-07), over the own classes and actions (the API scopes them).
    for (const path of ["/quantri/tong-quan", "/quantri/bao-cao-nguy-co", "/quantri/nhat-ky"]) {
      const html = render(path, advisor);
      expect(html).not.toContain("am-refused");
      expect(html).not.toContain(">Quản lý sinh viên</h1>");
    }
    // Tài khoản or an announcement page leads an advisor back to Quản lý sinh viên, and says why (2026-11-04).
    for (const [path, name] of [["/quantri/tai-khoan", "Tài khoản"],
      ["/quantri/gui-thong-bao", "Quản lý thông báo / Gửi thông báo"], ["/quantri/lich-su-dang-nhap", "Tài khoản"]]) {
      const html = render(path, advisor);
      expect(html).toContain(">Quản lý sinh viên</h1>");
      expect(html).toContain(`<p class="admin-error am-refused" role="alert">Bạn không có quyền mở trang “${name}”. Trang này chỉ dành cho quản trị viên; cố vấn học tập được chuyển về Quản lý sinh viên.</p>`);
    }
    // Its own pages, and the portal's address, open without a refusal; an admin is never refused.
    for (const path of ["/quantri", "/quantri/quan-ly-sinh-vien", "/quantri/ke-hoach"]) expect(render(path, advisor)).not.toContain("am-refused");
    expect(render("/quantri/tai-khoan")).not.toContain("am-refused");
    // The catalog pages open read only: no add button.
    const fields = render("/quantri/linh-vuc-nghe-nghiep", advisor);
    expect(fields).toContain(">Lĩnh vực</h1>");
    expect(fields).not.toContain("Thêm lĩnh vực");
    expect(render("/quantri/linh-vuc-nghe-nghiep")).toContain("Thêm lĩnh vực");
  });

  it("shows an admin every student on Quản lý sinh viên, with the permissions folded at the end (2026-11-03)", () => {
    const html = render("/quantri/quan-ly-sinh-vien");
    expect(html).toContain("Bạn xem được mọi sinh viên của Khoa; cố vấn học tập chỉ xem sinh viên các lớp mình phụ trách.");
    expect(html).not.toContain(">Lớp phụ trách<");
    expect(html).toContain('<details class="av-perm-section"><summary>');
    expect(html).toContain("<span>Quyền khi làm việc với trang sinh viên</span>");
    expect(html.indexOf('id="av-students-title"')).toBeLessThan(html.indexOf("av-perm-section"));
    for (const role of ["faculty_board", "advisor"] as const) expect(render("/quantri/quan-ly-sinh-vien", { ...user, role })).toContain(">Quản lý sinh viên</h1>");
  });
});
