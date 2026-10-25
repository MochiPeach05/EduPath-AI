import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudentWorkspace, { nameInitials, pageFromHash, studentDisplayName } from "./StudentWorkspace";
import type { AuthenticatedUser } from "./types";

// The shell only: every page body is replaced by nothing.
vi.mock("./StudentOverview", async (importOriginal) => ({ ...await importOriginal<typeof import("./StudentOverview")>(), default: () => null }));
vi.mock("./StudentPlans", () => ({ default: () => null }));
vi.mock("./StudentGraduation", () => ({ default: () => null }));
vi.mock("./StudentCurriculum", () => ({ default: () => null }));
vi.mock("./StudentTranscript", () => ({ default: () => null }));
vi.mock("./StudentProfileEditor", () => ({ default: () => null }));
vi.mock("./StudentProfileSurvey", () => ({ default: () => null }));

// A synthetic test account, with the display name Microsoft gives students ("MSSV - Họ tên - Lớp").
const user: AuthenticatedUser = {
  userId: "00000000-0000-4000-8000-000000000001", identityKey: "tenant:object", tenantId: "tenant", objectId: "object",
  name: "2174802010992 - Sinh viên Thử nghiệm K27 - 71K27CNTT99", email: "sv.thunghiem@vanlanguni.vn", username: null,
  role: "student", signedInAt: "2026-10-25T00:00:00Z",
};

function render(hash: string) {
  vi.stubGlobal("window", { location: { hash } });
  return renderToStaticMarkup(createElement(StudentWorkspace, { user }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("student names", () => {
  it("shows only the name part of the Microsoft display name", () => {
    expect(studentDisplayName("2174802010992 - Sinh viên Thử nghiệm K27 - 71K27CNTT99")).toBe("Sinh viên Thử nghiệm K27");
    expect(studentDisplayName("2174802010992 - Nguyễn Văn An")).toBe("Nguyễn Văn An");
    expect(studentDisplayName("Nguyễn Văn An - 71K29CNTT01")).toBe("Nguyễn Văn An");
    expect(studentDisplayName("  Trần Thị Mai-Anh ")).toBe("Trần Thị Mai-Anh");
  });

  it("builds initials from words that start with a letter, never from codes or dashes", () => {
    expect(nameInitials("Sinh viên Thử nghiệm K27")).toBe("TK");
    expect(nameInitials("2174802010992 - Sinh viên Thử nghiệm K27 - 71K27CNTT99")).toBe("TK");
    expect(nameInitials("Nguyễn Văn An")).toBe("VA");
    expect(nameInitials("đặng thị ánh")).toBe("TÁ");
    expect(nameInitials("2174802010992 - 71K27CNTT99")).toBe("");
  });
});

describe("pages in the address", () => {
  it("opens the page the hash names, the overview without a hash, and nothing for an unknown hash", () => {
    expect(pageFromHash("#plans")).toBe("plans");
    expect(pageFromHash("skill-gap")).toBe("skill-gap");
    expect(pageFromHash("")).toBe("overview");
    expect(pageFromHash("#")).toBe("overview");
    expect(pageFromHash("#khong-co-trang")).toBeNull();
  });

  it("shows the overview for an unknown hash", () => {
    expect(render("#khong-co-trang")).toContain('<h1 tabindex="-1">Tổng quan</h1>');
  });
});

describe("student shell", () => {
  it("names the overview like the nav and links to Hồ sơ và bảng điểm by its name", () => {
    const html = render("#overview");
    expect(html).toContain('<h1 tabindex="-1">Tổng quan</h1>');
    expect(html).toContain("Xin chào, Sinh viên Thử nghiệm K27.");
    expect(html).toContain("Xem Hồ sơ và bảng điểm");
    expect(html).not.toContain("Tổng quan học tập");
    expect(html).not.toContain("Xem hồ sơ của tôi");
    expect(html).toContain("CỔNG QUẢN LÝ HỌC TẬP");
  });

  it("shows a neutral avatar while the profile loads and the parsed name in the account label", () => {
    const html = render("#overview");
    expect(html).toMatch(/<button type="button" class="sw-avatar" aria-label="Tài khoản Sinh viên Thử nghiệm K27" aria-expanded="false"><svg/);
    expect(html).not.toContain("2174802010992");
    expect(html).not.toContain(">-7<");
  });

  it("marks the avatar while a page of the account menu is open", () => {
    expect(render("#plans")).toContain('class="sw-avatar sw-avatar-here"');
    expect(render("#curriculum")).toContain('class="sw-avatar sw-avatar-here"');
    expect(render("#competency")).not.toContain("sw-avatar-here");
  });

  it("puts Điều kiện xét tốt nghiệp in the main nav just before Trợ lý AI, not in the account menu", () => {
    const html = render("#graduation");
    const nav = html.slice(html.indexOf('id="student-navigation"'), html.indexOf("</nav>", html.indexOf('id="student-navigation"')));
    expect(nav.indexOf("Lộ trình học tập")).toBeGreaterThan(-1);
    expect(nav.indexOf("Điều kiện xét tốt nghiệp")).toBeGreaterThan(nav.indexOf("Lộ trình học tập"));
    expect(nav.indexOf("Trợ lý AI")).toBeGreaterThan(nav.indexOf("Điều kiện xét tốt nghiệp"));
    expect(nav).toMatch(/href="#graduation" aria-current="page"/);
    expect(html).not.toContain("sw-avatar-here");
  });

  it("points aria-controls only at panels that exist", () => {
    const html = render("#plans");
    expect(html).not.toContain("aria-controls");
    expect(html).toContain('aria-label="Hướng dẫn" aria-haspopup="dialog" aria-expanded="false"');
    expect(html).toContain('aria-label="Hiện menu bên trái" aria-expanded="false"');
  });

  it("keeps the skip link and focusable main", () => {
    const html = render("#plans");
    expect(html).toContain('<a class="sw-skip" href="#student-main">Chuyển đến nội dung chính</a>');
    expect(html).toContain('<main class="sw-main" id="student-main" tabindex="-1">');
  });

  it("links the footer to the policy, the FAQ and the support e-mail", () => {
    const html = render("#plans");
    expect(html).toContain('<a href="/chinh-sach-va-dieu-khoan" target="_blank" rel="noreferrer">Chính sách &amp; Điều khoản<span class="sr-only"> (mở trong tab mới)</span></a>');
    expect(html).toContain('<a href="/cau-hoi-thuong-gap" target="_blank" rel="noreferrer">Câu hỏi thường gặp');
    expect(html).toContain('<a href="mailto:hotrosinhvien@vlu.edu.vn">Hỗ trợ: hotrosinhvien@vlu.edu.vn</a>');
  });

  it("sends the Trợ lý AI placeholder to Hồ sơ và bảng điểm by its name", () => {
    const html = render("#assistant");
    expect(html).toContain('<h1 tabindex="-1">Trợ lý AI</h1>');
    expect(html).toContain("Xem Hồ sơ và bảng điểm");
    expect(html).not.toContain("Xem hồ sơ học tập");
  });
});
