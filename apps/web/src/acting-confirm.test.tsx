import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActingConfirmDialog, assessmentConfirm, goalsConfirm, planConfirm, roadmapConfirm, surveyConfirm } from "./acting-confirm";

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

  it("says what the specialty and the target become for the student (user 2026-11-10)", () => {
    expect(goalsConfirm({ specialty: "Công nghệ phần mềm" })).toEqual({
      title: "Đổi chuyên ngành thay sinh viên", confirm: "Lưu thay đổi",
      text: "Chuyên ngành của sinh viên sẽ là Công nghệ phần mềm. Kết quả Đánh giá năng lực đã có chỉ cập nhật theo chuyên ngành mới khi đánh giá lại. Sinh viên sẽ nhận thông báo trong chuông.",
    });
    const career = goalsConfirm({ career: "Kỹ sư phần mềm" }, "Chọn làm mục tiêu");
    expect(career).toMatchObject({ title: "Đổi vị trí nghề nghiệp mục tiêu thay sinh viên", confirm: "Chọn làm mục tiêu" });
    expect(career.text).toMatch(/^Vị trí nghề nghiệp mục tiêu của sinh viên sẽ là Kỹ sư phần mềm\. /);
    // A new target re-assesses a student who has a result (plan "Một bước để bắt đầu", 2026-11-14).
    expect(career.text).toContain("Nếu sinh viên đã có kết quả Đánh giá năng lực, EduPath AI sẽ đánh giá lại theo lựa chọn mới.");
    const both = goalsConfirm({ specialty: null, career: null });
    expect(both.title).toBe("Đổi chuyên ngành và vị trí nghề nghiệp mục tiêu thay sinh viên");
    expect(both.text).toMatch(/^Sinh viên sẽ chưa có chuyên ngành\. Sinh viên sẽ không còn vị trí nghề nghiệp mục tiêu\. /);
  });

  it("asks once before editing Kế hoạch học kỳ and before saving Khảo sát nhanh for the student (user 2026-11-10)", () => {
    expect(planConfirm).toMatchObject({ title: "Sửa Kế hoạch học kỳ thay sinh viên", confirm: "Sửa kế hoạch" });
    expect(planConfirm.text).toContain("được lưu ngay vào Kế hoạch học kỳ của sinh viên, như khi sinh viên tự sửa");
    expect(surveyConfirm(false)).toMatchObject({ title: "Lưu Khảo sát nhanh thay sinh viên", confirm: "Lưu khảo sát" });
    expect(surveyConfirm(false).text).toMatch(/^Các câu trả lời này sẽ được lưu làm Khảo sát nhanh của sinh viên\. /);
    expect(surveyConfirm(true).text).toMatch(/^Câu trả lời khảo sát hiện tại của sinh viên sẽ được thay bằng các câu trả lời này\. /);
    for (const words of [planConfirm, surveyConfirm(true), surveyConfirm(false)]) expect(words.text).toContain("Sinh viên sẽ nhận thông báo trong chuông");
  });
});
