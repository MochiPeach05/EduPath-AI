import { describe, expect, it } from "vitest";
import {
  answerLabel, draftOf, gapSentence, problemSummary, surveyBody, surveyErrorMessage, surveyGaps, surveyItems, surveyProblems, type SurveyQuestion,
} from "./profile-survey";
import { policyVersion } from "./public-information";

// Invented questions and answers only, in the order of survey-v5 (field, goal, …).
const questions: SurveyQuestion[] = [
  { id: "field", label: "Lĩnh vực quan tâm nhất", options: [{ id: "web", label: "Web" }, { id: "data", label: "AI, dữ liệu" }] },
  { id: "goal", label: "Mục tiêu sau tốt nghiệp", options: [{ id: "work", label: "Đi làm ngay" }, { id: "study", label: "Học lên cao" }] },
  { id: "english", label: "Tiếng Anh chuyên ngành", options: [{ id: "basic", label: "Khó khăn trong việc đọc hiểu" }, { id: "reading", label: "Đọc hiểu tốt" }] },
];
const options = { needsConsent: true, consented: false };
const survey = { version: "survey-v4", answers: { field: "web", goal: "work" }, interestTech: ["ai_ml"], updatedAt: "", complete: false };

describe("Khảo sát nhanh (survey-v5, 2026-11-14)", () => {
  it("puts Thế mạnh right after Lĩnh vực quan tâm nhất and numbers the five items", () => {
    expect(surveyItems(questions).map((item) => [item.number, item.kind === "tech" ? "tech" : item.question.id])).toEqual([
      [1, "field"], [2, "tech"], [3, "goal"], [4, "english"],
    ]);
    // Without the field question (an older API) Thế mạnh comes last.
    expect(surveyItems(questions.slice(1)).map((item) => item.kind === "tech" ? "tech" : item.question.id)).toEqual(["goal", "english", "tech"]);
  });

  it("asks for every answer, the strengths and the consent, in form order; no Sở trường or Thành tích any more", () => {
    expect(surveyProblems(questions, draftOf(null), options)).toEqual([
      ["q:field", "Vui lòng chọn một câu trả lời."], ["tech", "Vui lòng chọn ít nhất một công nghệ bạn thành thạo."],
      ["q:goal", "Vui lòng chọn một câu trả lời."], ["q:english", "Vui lòng chọn một câu trả lời."],
      ["consent", "Vui lòng đánh dấu ô đồng ý trước khi lưu."],
    ]);
    const answered = { answers: { field: "data", goal: "work", english: "reading" }, interestTech: ["ai_ml"] };
    expect(surveyProblems(questions, answered, { ...options, consented: true })).toEqual([]);
    expect(surveyProblems(questions, answered, { needsConsent: false, consented: false })).toEqual([]);
    // An answer that is not one of the options counts as missing.
    expect(surveyProblems(questions, { ...answered, answers: { ...answered.answers, goal: "travel" } }, { needsConsent: false, consented: false }))
      .toEqual([["q:goal", "Vui lòng chọn một câu trả lời."]]);
    expect(problemSummary(2)).toBe("Còn 2 mục chưa hoàn thành. Vui lòng xem các thông báo màu đỏ.");
    expect(problemSummary(0)).toBe("");
  });

  it("sends only the answers of the current questions, so answers of an older survey are not refused", () => {
    // A survey-v4 draft still holds answers of questions no longer asked.
    const draft = { answers: { field: "data", goal: "work", english: "reading", environment: "team", internship: "none" }, interestTech: ["ai_ml", "database"] };
    expect(surveyBody(questions, draft)).toEqual({ answers: { field: "data", goal: "work", english: "reading" }, interestTech: ["ai_ml", "database"] });
    expect(surveyBody(questions, { answers: { goal: "work" }, interestTech: [] })).toEqual({ answers: { goal: "work" }, interestTech: [] });
  });

  it("starts the technologies from the survey, else from what the profile held before the move", () => {
    expect(draftOf(survey)).toEqual({ answers: { field: "web", goal: "work" }, interestTech: ["ai_ml"] });
    const v1 = { ...survey, version: "survey-v1", interestTech: [] };
    expect(draftOf(v1, { tech: ["game"], hobbies: ["music"], text: null })).toEqual({ answers: { field: "web", goal: "work" }, interestTech: ["game"] });
    expect(draftOf(null)).toEqual({ answers: {}, interestTech: [] });
  });

  it("shows saved answers by their labels and API refusals in plain words", () => {
    expect(answerLabel(questions[1]!, { goal: "study" })).toBe("Học lên cao");
    expect(answerLabel(questions[1]!, {})).toBeNull();
    expect(surveyErrorMessage("consent_required", 400)).toBe("Vui lòng đánh dấu ô đồng ý trước khi lưu.");
    expect(surveyErrorMessage(undefined, 401)).toBe("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    expect(surveyErrorMessage("unknown", 500)).toBe("Không lưu được khảo sát. Vui lòng thử lại.");
  });

  it("names the failed action when the API gives no known reason or the network fails", () => {
    expect(surveyErrorMessage("unknown", 500, "save")).toBe("Không lưu được khảo sát. Vui lòng thử lại.");
    expect(surveyErrorMessage(undefined, 500, "load")).toBe("Chưa tải được Khảo sát nhanh. Vui lòng thử lại.");
    expect(surveyErrorMessage(undefined, 0, "delete")).toBe("Chưa xóa được câu trả lời. Vui lòng thử lại.");
    expect(surveyErrorMessage("database_required", 503, "load")).toBe("Chưa kết nối được nơi lưu hồ sơ. Vui lòng thử lại sau.");
    expect(surveyErrorMessage(undefined, 401, "delete")).toBe("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  });

  it("lists what stored answers lack under the current questions and policy", () => {
    const answered = { ...survey, answers: { field: "web", goal: "work", english: "reading" }, complete: true };
    expect(surveyGaps(questions, null, null)).toEqual([]);
    expect(surveyGaps(questions, answered, policyVersion)).toEqual([]);
    // A consent to 2026-10-25 still counts (consentValidSince); an older one asks again.
    expect(surveyGaps(questions, answered, "2026-10-25")).toEqual([]);
    expect(surveyGaps(questions, answered, "2026-10-24")).toEqual(["Xác nhận lại theo chính sách mới"]);
    // survey-v2: its list meant "Công nghệ bạn thích", so the technologies are chosen again; Sở trường is no longer asked.
    const v2 = { ...answered, version: "survey-v2", complete: false };
    expect(surveyGaps(questions, v2, "2026-10-24")).toEqual(["Chọn công nghệ trong Thế mạnh của bạn", "Xác nhận lại theo chính sách mới"]);
    expect(gapSentence(surveyGaps(questions, v2, "2026-10-24"))).toBe("Chọn công nghệ trong Thế mạnh của bạn và xác nhận lại theo chính sách mới");
    // survey-v3 and survey-v4 answers count: the five items are among them.
    expect(surveyGaps(questions, { ...answered, version: "survey-v3" }, policyVersion)).toEqual([]);
    // survey-v1 (no technologies) and a question added since.
    const v1 = { ...v2, version: "survey-v1", answers: { goal: "work" }, interestTech: [] };
    expect(surveyGaps(questions, v1, null)).toEqual([
      "Trả lời 2 câu hỏi còn thiếu", "Chọn công nghệ trong Thế mạnh của bạn", "Đánh dấu ô đồng ý cho EduPath AI dùng câu trả lời",
    ]);
    // Answers a cố vấn học tập or the Khoa filled in need no consent (policy 2026-11-10), and staff never give one.
    expect(surveyGaps(questions, { ...answered, savedBy: "advisor" }, null)).toEqual([]);
    expect(surveyGaps(questions, answered, "2026-10-24", false)).toEqual([]);
    expect(surveyGaps(questions, { ...v1, savedBy: "admin" }, null)).toEqual(["Trả lời 2 câu hỏi còn thiếu", "Chọn công nghệ trong Thế mạnh của bạn"]);
    expect(gapSentence(["Xác nhận lại theo chính sách mới"])).toBe("Xác nhận lại theo chính sách mới");
    expect(gapSentence([])).toBe("");
  });
});
