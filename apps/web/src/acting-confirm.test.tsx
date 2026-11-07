import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActingConfirmDialog, assessmentConfirm, roadmapConfirm } from "./acting-confirm";

// QA 2026-11-07: an advisor's Đánh giá lại and Tạo lộ trình replace the student's results and notify the student.
describe("the confirmation of an action done for a student", () => {
  it("says what is replaced and that the student is told, then asks Hủy first", () => {
    expect(assessmentConfirm(true)).toMatchObject({ title: "Đánh giá lại thay sinh viên", confirm: "Đánh giá lại" });
    expect(assessmentConfirm(true).text).toContain("sẽ được thay bằng kết quả mới");
    expect(assessmentConfirm(false)).toMatchObject({ title: "Đánh giá năng lực thay sinh viên", confirm: "Đánh giá năng lực" });
    expect(roadmapConfirm(true).text).toContain("Lộ trình AI hiện tại của sinh viên sẽ được thay bằng lộ trình mới");
    expect(roadmapConfirm(false).text).toContain("EduPath AI sẽ soạn Lộ trình AI");
    for (const words of [assessmentConfirm(true), assessmentConfirm(false), roadmapConfirm(true), roadmapConfirm(false)]) {
      expect(words.text).toContain("Sinh viên sẽ nhận thông báo trong chuông.");
    }
    const html = renderToStaticMarkup(<ActingConfirmDialog {...assessmentConfirm(true)} onClose={() => {}} onConfirm={() => {}} />);
    expect(html).toContain('<h2 id="acting-confirm-title">Đánh giá lại thay sinh viên</h2>');
    expect(html.indexOf(">Hủy</button>")).toBeLessThan(html.indexOf(">Đánh giá lại</button>"));
  });
});
