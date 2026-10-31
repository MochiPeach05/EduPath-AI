import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminWorkspace from "./AdminWorkspace";
import { adminGroupOf, adminNavigation, toggleAdminGroup } from "./admin-navigation";
import type { AuthenticatedUser } from "./types";

const user: AuthenticatedUser = { userId: "u1", identityKey: "k", tenantId: "t", objectId: "o", name: "Quản trị", email: null, username: null, role: "admin", signedInAt: "2026-10-13T00:00:00Z" };

function render(pathname: string) {
  vi.stubGlobal("window", { location: { pathname, hash: "", search: "" } });
  return renderToStaticMarkup(<AdminWorkspace user={user} busy={false} error={null} onLogout={() => undefined} />);
}

afterEach(() => vi.unstubAllGlobals());

describe("admin workspace", () => {
  it("shows the short names in the sidebar, in order, with the groups and their pages", () => {
    const nav = render("/quantri/tai-khoan").match(/<nav id="admin-navigation".*?<\/nav>/s)?.[0] ?? "";
    expect([...nav.matchAll(/<span>([^<]*)<\/span>/g)].map(match => match[1])).toEqual(
      ["Báo cáo", "Tổng quan", "Tiến độ", "Nguy cơ", "Kỹ năng thiếu", "Nghề mục tiêu", "Môn đề xuất", "Nhật ký", "Tài khoản", "Sinh viên", "Chương trình", "Tốt nghiệp", "Kế hoạch", "Quản lý nghề nghiệp", "Lĩnh vực", "Kỹ năng", "Nghề nghiệp",
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
    const reportPages = adminNavigation.filter(item => item.eyebrow === "BÁO CÁO").map(item => item.path as string);
    for (const { path } of adminNavigation) {
      expect(openGroups(render(path))).toEqual(careerPages.includes(path) ? ["careers"] : competencyPages.includes(path) ? ["competencies"]
        : announcementPages.includes(path) ? ["announcements"] : reportPages.includes(path) ? ["reports"] : []);
    }
    // An old link or a trailing slash opens the group of the page it shows.
    expect(openGroups(render("/quantri/danh-gia-nang-luc"))).toEqual(["competencies"]);
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
    expect(html).toContain(">BÁO CÁO</p>");
    expect(html).toContain('aria-label="Tìm kiếm và lọc dữ liệu báo cáo"');
    expect(html).toContain('<a href="/quantri/tong-quan" aria-current="page">');
    expect(render("/quantri/nhat-ky")).toContain("Tìm trong nhật ký");
  });
});
