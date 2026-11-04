import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { shownAddress } from "./NotFoundPage";

function render(pathname: string, hash = "") {
  vi.stubGlobal("window", { location: { pathname, search: "", hash } });
  return renderToStaticMarkup(createElement(App));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("public pages", () => {
  it("links the login page to the sections of the landing page", () => {
    const html = render("/login");
    for (const id of ["gioi-thieu", "tinh-nang", "huong-dan"]) expect(html).toContain(`href="/#${id}"`);
    expect(html).not.toContain('href="/#/');
  });

  it("opens #dieu-khoan and #bao-mat on the policy text: the side menu groups carry no such id", () => {
    const html = render("/dieu-khoan-su-dung");
    expect(html).not.toContain('id="dieu-khoan"');
    expect(html).not.toContain('id="bao-mat"');
    // The first terms category is the one shown, and the one scrolled to.
    expect(html).toContain('<section id="dieu-khoan-gioi-thieu"');
  });

  it("says Không tìm thấy trang for an unknown address, with the way home and to sign in (2026-11-04)", () => {
    const html = render("/trang-khong-ton-tai-123");
    expect(html).toContain('<h1 id="not-found-title">Không tìm thấy trang</h1>');
    expect(html).toContain("/trang-khong-ton-tai-123");
    expect(html).toContain('<a class="lp-button" href="/">Về trang chủ');
    expect(html).toContain('<a class="lp-button lp-button-white" href="/login">Đăng nhập</a>');
    // Not the student portal under the wrong address.
    expect(html).not.toContain("Đang kiểm tra phiên đăng nhập");
    expect(html).not.toContain("Chào mừng đến với EduPath AI");
  });

  it("offers the admin portal for an unknown address under /quantri and shows Vietnamese letters as typed", () => {
    const admin = render("/quantri/khong-co");
    expect(admin).toContain("Không tìm thấy trang");
    expect(admin).toContain('<a class="lp-button lp-button-white" href="/quantri">Mở trang quản trị</a>');
    expect(render("/trang-kh%C3%B4ng-c%C3%B3")).toContain("/trang-không-có");
    expect(shownAddress("/%E0%A4%A")).toBe("/%E0%A4%A");
    expect(shownAddress(`/${"a".repeat(80)}`)).toHaveLength(60);
  });

  it("offers Đăng nhập on the policy and FAQ pages until the session check finds a signed-in visitor", () => {
    for (const path of ["/chinh-sach-va-dieu-khoan", "/cau-hoi-thuong-gap"]) {
      const html = render(path);
      expect(html).toContain('<a class="lp-button lp-button-small pi-login" href="/login">Đăng nhập');
      expect(html).toContain("Đăng nhập hệ thống");
    }
  });
});
