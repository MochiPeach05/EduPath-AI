import { describe, expect, it } from "vitest";
import { answerLabel, draftOf, gapSentence, problemSummary, surveyErrorMessage, surveyGaps, surveyProblems, type SurveyQuestion } from "./profile-survey";
import { policyVersion } from "./public-information";
import { requiredProfileItems, type StudentProfile } from "./StudentOverview";

// Invented questions and answers only.
const questions: SurveyQuestion[] = [
  { id: "goal", label: "Mục tiêu sau tốt nghiệp", options: [{ id: "work", label: "Đi làm ngay" }, { id: "study", label: "Học lên cao" }] },
  { id: "english", label: "Tiếng Anh chuyên ngành", options: [{ id: "basic", label: "Khó khăn trong việc đọc hiểu" }, { id: "reading", label: "Đọc hiểu tốt" }] },
];
const options = { needsConsent: true, consented: false, achievementsMax: 20 };
const survey = { version: "survey-v3", answers: { goal: "work" }, interestTech: ["ai_ml"], strengths: "React, Node.js", interestHobbies: ["reading"], hasAchievements: false,
  achievements: null, updatedAt: "", complete: false };

describe("profile survey form", () => {
  it("asks for every answer, the strengths with their description, the sở trường, Có or Không, the list after Có and the consent, in form order", () => {
    expect(surveyProblems(questions, draftOf(null), options)).toEqual([
      ["q:goal", "Vui lòng chọn một câu trả lời."], ["q:english", "Vui lòng chọn một câu trả lời."],
      ["tech", "Vui lòng chọn ít nhất một công nghệ bạn thành thạo."], ["strengths", "Vui lòng mô tả công nghệ bạn thành thạo."], ["hobbies", "Vui lòng chọn ít nhất một sở trường."],
      ["hasAchievements", "Vui lòng chọn Có hoặc Không."], ["consent", "Vui lòng đánh dấu ô đồng ý trước khi lưu."],
    ]);
    const answered = { answers: { goal: "work", english: "reading" }, interestTech: ["ai_ml"], strengths: "Python, đã làm 1 dự án", interestHobbies: ["reading"], hasAchievements: true, achievements: "   " };
    expect(surveyProblems(questions, answered, { ...options, consented: true })).toEqual([["achievements", "Vui lòng liệt kê thành tích của bạn."]]);
    expect(surveyProblems(questions, { ...answered, achievements: "x".repeat(21) }, { ...options, needsConsent: false })[0]![1]).toBe("Thành tích tối đa 20 ký tự (hiện có 21).");
    expect(surveyProblems(questions, { ...answered, hasAchievements: false }, { ...options, needsConsent: false })).toEqual([]);
    expect(surveyProblems(questions, { ...answered, strengths: "  ", hasAchievements: false }, { ...options, needsConsent: false })).toEqual([["strengths", "Vui lòng mô tả công nghệ bạn thành thạo."]]);
    expect(surveyProblems(questions, { ...answered, strengths: "x".repeat(11), hasAchievements: false }, { ...options, needsConsent: false, strengthsMax: 10 })[0]![1])
      .toBe("Phần mô tả tối đa 10 ký tự (hiện có 11).");
    // An answer that is not one of the options counts as missing.
    expect(surveyProblems(questions, { ...answered, answers: { goal: "travel", english: "reading" }, hasAchievements: false }, { ...options, needsConsent: false }))
      .toEqual([["q:goal", "Vui lòng chọn một câu trả lời."]]);
    expect(problemSummary(2)).toBe("Còn 2 mục chưa hoàn thành. Vui lòng xem các thông báo màu đỏ.");
    expect(problemSummary(0)).toBe("");
  });

  it("starts the interest lists from the survey, else from what the profile held before the move", () => {
    expect(draftOf(survey)).toEqual({ answers: { goal: "work" }, interestTech: ["ai_ml"], strengths: "React, Node.js", interestHobbies: ["reading"], hasAchievements: false, achievements: "" });
    const v1 = { ...survey, version: "survey-v1", interestTech: [], strengths: null, interestHobbies: [] };
    expect(draftOf(v1, { tech: ["game"], hobbies: ["music"], text: null })).toMatchObject({ interestTech: ["game"], interestHobbies: ["music"] });
    expect(draftOf(null)).toMatchObject({ interestTech: [], strengths: "", interestHobbies: [], hasAchievements: null });
  });

  it("shows saved answers by their labels and API refusals in plain words", () => {
    expect(answerLabel(questions[0]!, { goal: "study" })).toBe("Học lên cao");
    expect(answerLabel(questions[0]!, {})).toBeNull();
    expect(surveyErrorMessage("consent_required", 400)).toBe("Vui lòng đánh dấu ô đồng ý trước khi lưu.");
    expect(surveyErrorMessage(undefined, 401)).toBe("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    expect(surveyErrorMessage("unknown", 500)).toBe("Không lưu được khảo sát. Vui lòng thử lại.");
  });

  it("names the failed action when the API gives no known reason or the network fails", () => {
    expect(surveyErrorMessage("unknown", 500, "save")).toBe("Không lưu được khảo sát. Vui lòng thử lại.");
    expect(surveyErrorMessage(undefined, 500, "load")).toBe("Chưa tải được Khảo sát định hướng. Vui lòng thử lại.");
    expect(surveyErrorMessage(undefined, 0, "delete")).toBe("Chưa xóa được câu trả lời. Vui lòng thử lại.");
    expect(surveyErrorMessage("database_required", 503, "load")).toBe("Chưa kết nối được nơi lưu hồ sơ. Vui lòng thử lại sau.");
    expect(surveyErrorMessage(undefined, 401, "delete")).toBe("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  });

  it("lists what stored answers lack under the current questions and policy", () => {
    const answered = { ...survey, answers: { goal: "work", english: "reading" }, complete: true };
    expect(surveyGaps(questions, null, null)).toEqual([]);
    expect(surveyGaps(questions, answered, policyVersion)).toEqual([]);
    // A consent to 2026-10-25 still counts (consentValidSince); an older one asks again.
    expect(surveyGaps(questions, answered, "2026-10-25")).toEqual([]);
    expect(surveyGaps(questions, answered, "2026-10-24")).toEqual(["Xác nhận lại theo chính sách mới"]);
    // survey-v2 (no description of the strengths), agreed to under an older policy.
    const v2 = { ...answered, version: "survey-v2", strengths: null, complete: false };
    expect(surveyGaps(questions, v2, "2026-10-24")).toEqual(["Bổ sung mô tả thế mạnh", "Xác nhận lại theo chính sách mới"]);
    expect(gapSentence(surveyGaps(questions, v2, "2026-10-24"))).toBe("Bổ sung mô tả thế mạnh và xác nhận lại theo chính sách mới");
    // survey-v1 (no interests at all) and a question added since.
    const v1 = { ...v2, version: "survey-v1", answers: { goal: "work" }, interestTech: [], interestHobbies: [] };
    expect(surveyGaps(questions, v1, null)).toEqual([
      "Trả lời 1 câu hỏi còn thiếu", "Chọn công nghệ trong Thế mạnh của bạn", "Bổ sung mô tả thế mạnh", "Chọn sở trường",
      "Đánh dấu ô đồng ý cho EduPath AI dùng câu trả lời",
    ]);
    expect(gapSentence(["Xác nhận lại theo chính sách mới"])).toBe("Xác nhận lại theo chính sách mới");
    expect(gapSentence(["Chọn sở trường", "Bổ sung mô tả thế mạnh", "Xác nhận lại theo chính sách mới"]))
      .toBe("Chọn sở trường, bổ sung mô tả thế mạnh và xác nhận lại theo chính sách mới");
    expect(gapSentence([])).toBe("");
  });
});

describe("required profile", () => {
  const profile = (extra: Partial<StudentProfile> = {}): StudentProfile => ({
    name: "Sinh viên", studentCode: null, cohortCode: "K30", className: null, cohortYear: 2024, currentSemester: null, email: null,
    careerGoal: null, interests: null, profileStatus: "incomplete", specialty: null, careerPositionId: null, surveyUpdatedAt: null, ...extra,
  });

  it("lists the transcript, specialty, career and survey (interests included), the same fields as the API's complete profile", () => {
    expect(requiredProfileItems(profile(), false).map((item) => [item.id, item.done])).toEqual([
      ["transcript", false], ["specialty", false], ["career", false], ["survey", false],
    ]);
    const complete = profile({ specialty: "CNPM", careerPositionId: "c1", surveyUpdatedAt: "2026-10-24T10:00:00.000Z", surveyComplete: true });
    expect(requiredProfileItems(complete, true).every((item) => item.done)).toBe(true);
    // Saved answers that no longer count: what they lack once the survey is read (surveyGaps), a neutral line before.
    const older = profile({ surveyUpdatedAt: "2026-10-24T10:00:00.000Z", surveyComplete: false });
    expect(requiredProfileItems(older, true).find((item) => item.id === "survey")).toMatchObject({ done: false, hint: "Cập nhật các mục còn thiếu" });
    expect(requiredProfileItems(older, true, "Bổ sung mô tả thế mạnh và xác nhận lại theo chính sách mới").find((item) => item.id === "survey"))
      .toMatchObject({ done: false, hint: "Bổ sung mô tả thế mạnh và xác nhận lại theo chính sách mới" });
    expect(requiredProfileItems(profile(), true).find((item) => item.id === "survey")?.hint).toBe("Câu hỏi, thế mạnh, sở trường và thành tích");
    // The specialty and the career are chosen in "Mục tiêu học tập" (was "Thông tin cá nhân").
    expect(requiredProfileItems(profile(), true).find((item) => item.id === "specialty")?.hint).toBe("Chọn trong Mục tiêu học tập");
  });
});
