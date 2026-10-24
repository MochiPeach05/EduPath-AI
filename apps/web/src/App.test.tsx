import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

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

  it("offers Đăng nhập on the policy and FAQ pages until the session check finds a signed-in visitor", () => {
    for (const path of ["/chinh-sach-va-dieu-khoan", "/cau-hoi-thuong-gap"]) {
      const html = render(path);
      expect(html).toContain('<a class="lp-button lp-button-small pi-login" href="/login">Đăng nhập');
      expect(html).toContain("Đăng nhập hệ thống");
    }
  });
});
