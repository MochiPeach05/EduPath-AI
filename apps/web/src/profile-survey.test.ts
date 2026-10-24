import { describe, expect, it } from "vitest";
import { answerLabel, draftOf, problemSummary, surveyErrorMessage, surveyProblems, type SurveyQuestion } from "./profile-survey";
import { requiredProfileItems, type StudentProfile } from "./StudentOverview";

// Invented questions and answers only.
const questions: SurveyQuestion[] = [
  { id: "goal", label: "Mục tiêu sau tốt nghiệp", options: [{ id: "work", label: "Đi làm ngay" }, { id: "study", label: "Học lên cao" }] },
  { id: "english", label: "Tiếng Anh chuyên ngành", options: [{ id: "basic", label: "Đọc tài liệu còn khó" }, { id: "reading", label: "Đọc hiểu tốt" }] },
];
const options = { needsConsent: true, consented: false, achievementsMax: 20 };

describe("profile survey form", () => {
  it("asks for every answer, Có or Không, the list after Có and the consent, in form order", () => {
    expect(surveyProblems(questions, draftOf(null), options)).toEqual([
      ["q:goal", "Vui lòng chọn một câu trả lời."], ["q:english", "Vui lòng chọn một câu trả lời."],
      ["hasAchievements", "Vui lòng chọn Có hoặc Không."], ["consent", "Vui lòng đánh dấu ô đồng ý trước khi lưu."],
    ]);
    const answered = { answers: { goal: "work", english: "reading" }, hasAchievements: true, achievements: "   " };
    expect(surveyProblems(questions, answered, { ...options, consented: true })).toEqual([["achievements", "Vui lòng liệt kê thành tích của bạn."]]);
    expect(surveyProblems(questions, { ...answered, achievements: "x".repeat(21) }, { ...options, needsConsent: false })[0]![1]).toBe("Thành tích tối đa 20 ký tự (hiện có 21).");
    expect(surveyProblems(questions, { ...answered, hasAchievements: false }, { ...options, needsConsent: false })).toEqual([]);
    // An answer that is not one of the options counts as missing.
    expect(surveyProblems(questions, { ...answered, answers: { goal: "travel", english: "reading" }, hasAchievements: false }, { ...options, needsConsent: false }))
      .toEqual([["q:goal", "Vui lòng chọn một câu trả lời."]]);
    expect(problemSummary(2)).toBe("Còn 2 mục chưa hoàn thành. Vui lòng xem các thông báo màu đỏ.");
    expect(problemSummary(0)).toBe("");
  });

  it("shows saved answers by their labels and API refusals in plain words", () => {
    expect(answerLabel(questions[0]!, { goal: "study" })).toBe("Học lên cao");
    expect(answerLabel(questions[0]!, {})).toBeNull();
    expect(draftOf({ version: "survey-v1", answers: { goal: "work" }, hasAchievements: false, achievements: null, updatedAt: "", complete: false }))
      .toEqual({ answers: { goal: "work" }, hasAchievements: false, achievements: "" });
    expect(surveyErrorMessage("consent_required", 400)).toBe("Vui lòng đánh dấu ô đồng ý trước khi lưu.");
    expect(surveyErrorMessage(undefined, 401)).toBe("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    expect(surveyErrorMessage("unknown", 500)).toBe("Không lưu được khảo sát. Vui lòng thử lại.");
  });
});

describe("required profile", () => {
  const profile = (extra: Partial<StudentProfile> = {}): StudentProfile => ({
    name: "Sinh viên", studentCode: null, cohortCode: "K30", className: null, cohortYear: 2024, currentSemester: null, email: null,
    careerGoal: null, interests: null, profileStatus: "incomplete", specialty: null, careerPositionId: null, surveyUpdatedAt: null, ...extra,
  });

  it("lists the transcript, specialty, career, interests and survey, the same fields as the API's complete profile", () => {
    expect(requiredProfileItems(profile(), false).map((item) => [item.id, item.done])).toEqual([
      ["transcript", false], ["specialty", false], ["career", false], ["interests", false], ["survey", false],
    ]);
    const complete = profile({ specialty: "CNPM", careerPositionId: "c1", interestTech: ["ai_ml"], interestHobbies: ["reading"], surveyUpdatedAt: "2026-10-24T10:00:00.000Z" });
    expect(requiredProfileItems(complete, true).every((item) => item.done)).toBe(true);
    // Free text written before the choices no longer counts.
    expect(requiredProfileItems(profile({ interests: "Web" }), true).find((item) => item.id === "interests")?.done).toBe(false);
  });
});
