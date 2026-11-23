import { describe, expect, it } from "vitest";
import { announcementMailMessage, announcementSubject } from "./messages.js";

// A made-up announcement and student.
describe("the email a student receives for an announcement (AD-NOTI-04, 2026-11-23)", () => {
  it("greets the student, keeps the text's paragraphs and opens the related page", () => {
    const message = announcementMailMessage({
      to: "sinh.vien@example.edu", name: "Trần Minh An", title: "  Lịch đăng ký  học phần HK2 ",
      body: "Đăng ký mở từ 01/12.\nHạn chót 05/12.\n\nXem kế hoạch <trước> khi đăng ký.", link: "#plans",
    }, "https://edupath.example");
    expect(message.to).toBe("sinh.vien@example.edu");
    expect(message.subject).toBe("[EduPath AI] Lịch đăng ký học phần HK2");
    expect(message.html).toContain("Chào Trần Minh An,");
    expect(message.html).toContain("Đăng ký mở từ 01/12.<br>Hạn chót 05/12.</p>");
    expect(message.html).toContain("Xem kế hoạch &#60;trước&#62; khi đăng ký.");
    expect(message.html).toContain('href="https://edupath.example/dashboard#plans"');
    expect(message.html).toContain(">Mở Kế hoạch đào tạo trên EduPath AI</a>");
    expect(message.html).toContain("Bạn cũng xem được thông báo này ở chuông thông báo trên EduPath AI.");
  });

  it("opens EduPath AI when there is no related page, and leaves the greeting out without a name", () => {
    const message = announcementMailMessage({ to: "a@example.edu", name: null, title: "T", body: "B", link: "javascript:alert(1)" }, "https://edupath.example");
    expect(message.html).not.toContain("Chào");
    expect(message.html).toContain('href="https://edupath.example/dashboard"');
    expect(message.html).toContain(">Mở EduPath AI</a>");
    expect(announcementSubject("Tiêu đề\nhai dòng")).toBe("[EduPath AI] Tiêu đề hai dòng");
  });
});
