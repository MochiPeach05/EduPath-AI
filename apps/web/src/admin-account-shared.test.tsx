import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreateAccount, SignInTime, signInClass } from "./admin-account-shared";

describe("sign-in state (user 2026-11-07)", () => {
  it("is red until the first sign-in and green from then on, always with its words", () => {
    expect(signInClass(false)).toBe("am-not-signed-in");
    expect(signInClass(true)).toBe("am-signed-in");
    expect(renderToStaticMarkup(<SignInTime at={null} />)).toBe('<span class="am-not-signed-in">Chưa đăng nhập</span>');
    expect(renderToStaticMarkup(<SignInTime at="2026-11-06T02:15:00.000Z" />)).toBe('<span class="am-signed-in">09:15 06/11/2026</span>');
  });

  it("keeps a page's own words for no sign-in, and a time that cannot be read reads and is coloured as none", () => {
    expect(renderToStaticMarkup(<SignInTime at={undefined} empty="Chưa có dữ liệu" />)).toBe('<span class="am-not-signed-in">Chưa có dữ liệu</span>');
    expect(renderToStaticMarkup(<SignInTime at="không phải thời gian" />)).toBe('<span class="am-not-signed-in">Chưa đăng nhập</span>');
  });
});

describe("create account form", () => {
  const html = renderToStaticMarkup(<CreateAccount onList={() => undefined} />);

  it("uses the same form style as the other admin dialogs", () => {
    expect(html).toContain('<form class="cm-form"');
    expect(html).toContain('<label class="cm-check">');
    expect(html).toContain('<div class="cm-actions cm-dialog-actions">');
    expect(html).not.toMatch(/am-field|am-confirm|am-form-actions|am-quiet/);
  });

  it("marks the required field and names the actions like the other dialogs", () => {
    expect(html).toContain('<span class="am-required" aria-hidden="true">*</span>');
    expect(html).toMatch(/<button class="am-outline" type="button">.*Hủy<\/button>/);
    expect(html).toMatch(/<button class="am-primary" type="submit">.*Tạo tài khoản quản trị<\/button>/);
  });
});
