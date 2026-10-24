import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StudentOverview, { type StudentProfile } from "./StudentOverview";

const render = (profile: StudentProfile | null, loading: boolean) =>
  renderToStaticMarkup(createElement(StudentOverview, { profile, loading, navigate: () => {}, identity: null }));
// Invented student.
const student: StudentProfile = {
  name: "Sinh viên", studentCode: null, cohortCode: "K30", className: null, cohortYear: 2024, currentSemester: null, email: null,
  careerGoal: null, interests: null, profileStatus: "incomplete", specialty: null, careerPositionId: null, careerPosition: null, surveyUpdatedAt: null, surveyComplete: false,
};

describe("Tổng quan cards", () => {
  it("say the profile is loading, or not loaded, instead of a definite answer", () => {
    for (const [loading, text] of [[true, "Đang tải hồ sơ…"], [false, "Chưa tải được hồ sơ"]] as const) {
      const html = render(null, loading);
      expect(html.split(text).length - 1).toBe(2);
      for (const definite of ["Chưa làm khảo sát", "Cần hồ sơ đầy đủ", "Bạn muốn phát triển theo hướng nào?", "Chưa chọn nghề mục tiêu"]) expect(html).not.toContain(definite);
    }
  });

  it("name the career Nghề mục tiêu and say what is missing once the profile is there", () => {
    const html = render(student, false);
    expect(html).toContain("<small>Nghề mục tiêu</small><strong>Chưa chọn nghề mục tiêu</strong>");
    expect(html).toContain("<strong>Chưa làm khảo sát</strong>");
    expect(html).not.toContain("Vị trí nghề nghiệp mong muốn");
    const chosen = render({ ...student, careerPositionId: "c1", careerPosition: { id: "c1", nameVi: "Kỹ sư phần mềm", nameEn: "Software Engineer", deletedAt: null } }, false);
    expect(chosen).toContain("<strong>Kỹ sư phần mềm</strong>");
  });
});
