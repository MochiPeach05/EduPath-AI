import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { detectIntents } from "./intent.js";
import { readinessAnswer, readReadiness, suggestedQuestions, type Readiness } from "./readiness.js";

// What Trợ lý AI answers at once when the student's results are missing, and the questions it suggests. Synthetic data only.
const userId = "11111111-1111-4111-8111-111111111111";
const none: Readiness = { transcript: false, specialty: false, career: false, survey: false, assessment: false, roadmap: false };
const all: Readiness = { transcript: true, specialty: true, career: true, survey: true, assessment: true, roadmap: true };
const ask = (readiness: Readiness, question: string) => readinessAnswer(readiness, detectIntents(question), question);
const ROADMAP_QUESTION = "Vì sao lộ trình đề xuất các môn này cho mình?";

describe("readReadiness", () => {
  it("reads the profile items, the assessment and the roadmap; the survey only under a consent that still counts", async () => {
    const consent = { version: "2026-10-29" as string | null };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("EXISTS")) return { rows: [{ transcript: true, specialty: true, career: false, assessment: false, roadmap: false }] };
      if (sql.includes("FROM stu_profile_surveys")) return { rows: [{ version: "survey-v3", answers: {}, interest_tech: [], strengths: null, interest_hobbies: [], has_achievements: false, achievements: null, updated_at: new Date(0) }] };
      if (sql.includes("FROM data_consents")) return { rows: consent.version ? [{ policy_version: consent.version }] : [] };
      return { rows: [] };
    });
    const db = { query } as unknown as DatabasePool;
    // An unanswered survey (empty answers) is not done, whatever the consent.
    expect(await readReadiness(db, userId)).toEqual({ transcript: true, specialty: true, career: false, survey: false, assessment: false, roadmap: false });
    expect(query.mock.calls[0]?.[1]).toEqual([userId]);
    const empty = { query: vi.fn(async () => ({ rows: [] })) } as unknown as DatabasePool;
    expect(await readReadiness(empty, userId)).toEqual(none);
  });
});

describe("readinessAnswer", () => {
  it("says the assessment is missing and lists every step left for the question of the screenshot", () => {
    const answer = ask(none, ROADMAP_QUESTION)!;
    expect(answer.content.split("\n")).toEqual([
      "Bạn chưa import bảng điểm và chưa thực hiện Đánh giá năng lực nên mình chưa có cơ sở để tư vấn cho câu hỏi này. Bạn vui lòng hoàn thành đầy đủ các bước dưới đây để mình đưa ra lời khuyên phù hợp và hữu ích hơn:",
      "1. Import bảng điểm PDF ở trang Hồ sơ và bảng điểm [1], phần Bảng điểm của tôi.",
      "2. Chọn chuyên ngành (Hồ sơ và bảng điểm [1], mục Mục tiêu học tập) và nghề mục tiêu (trang Định hướng nghề nghiệp [2]).",
      "3. Hoàn thành Khảo sát định hướng ở trang Hồ sơ và bảng điểm [1].",
      "4. Bấm Đánh giá năng lực ở trang Đánh giá năng lực [3].",
      "5. Bấm Tạo lộ trình ở tab Lộ trình AI đề xuất, trang Lộ trình học tập [4].",
      "Sau khi có kết quả, bạn hỏi lại mình câu này nhé. Trong lúc chờ, mình vẫn trả lời được các câu hỏi chung về chương trình đào tạo, điều kiện tốt nghiệp hay cách dùng EduPath AI.",
    ]);
    expect(answer.sources).toEqual([
      { n: 1, kind: "guide", title: "Hồ sơ và bảng điểm", link: "#profile" },
      { n: 2, kind: "guide", title: "Định hướng nghề nghiệp", link: "#career" },
      { n: 3, kind: "guide", title: "Đánh giá năng lực", link: "#competency" },
      { n: 4, kind: "guide", title: "Lộ trình học tập", link: "#roadmap" },
    ]);
  });

  it("names only the steps still to do", () => {
    const onlyAssessment = ask({ ...all, assessment: false, roadmap: false }, "Mình còn thiếu kỹ năng nào cho nghề mục tiêu?")!;
    expect(onlyAssessment.content).toBe("Bạn chưa thực hiện Đánh giá năng lực nên mình chưa có cơ sở để tư vấn cho câu hỏi này. Bạn vui lòng bấm Đánh giá năng lực ở trang Đánh giá năng lực [1] để mình đưa ra lời khuyên phù hợp và hữu ích hơn.\n"
      + "Sau khi có kết quả, bạn hỏi lại mình câu này nhé. Trong lúc chờ, mình vẫn trả lời được các câu hỏi chung về chương trình đào tạo, điều kiện tốt nghiệp hay cách dùng EduPath AI.");
    expect(onlyAssessment.sources.map((source) => source.link)).toEqual(["#competency"]);
    const noCareer = ask({ ...all, career: false, assessment: false, roadmap: false }, "Học kỳ tới em nên học những môn nào?")!;
    expect(noCareer.content).toContain("1. Chọn nghề mục tiêu ở trang Định hướng nghề nghiệp [1].\n2. Bấm Đánh giá năng lực ở trang Đánh giá năng lực [2].");
  });

  it("asks for the AI roadmap when only that is missing, and lets the AI answer once it exists", () => {
    const answer = ask({ ...all, roadmap: false }, ROADMAP_QUESTION)!;
    expect(answer.content).toBe("Bạn chưa tạo Lộ trình AI nên chưa có học phần nào được đề xuất để mình giải thích.\n"
      + "Bạn vui lòng bấm Tạo lộ trình ở tab Lộ trình AI đề xuất, trang Lộ trình học tập [1]. Sau khi có lộ trình, bạn hỏi lại mình lý do của từng đề xuất nhé.");
    expect(ask({ ...all, roadmap: false, survey: false }, ROADMAP_QUESTION)!.content).toContain("Bạn vui lòng hoàn thành Khảo sát định hướng ở trang Hồ sơ và bảng điểm [1] (Lộ trình AI cần khảo sát này), rồi bấm Tạo lộ trình");
    expect(ask(all, ROADMAP_QUESTION)).toBeNull();
    // Another "vì sao" with an assessment is the AI's (the courses of Khoảng trống kỹ năng need no roadmap).
    expect(ask({ ...all, roadmap: false }, "Vì sao mình nên học môn Kiểm thử phần mềm?")).toBeNull();
  });

  it("answers grade questions from the transcript once there, with or without an assessment", () => {
    const answer = ask(none, "Điểm trung bình tích lũy của mình là bao nhiêu?")!;
    expect(answer.content).toBe("Bạn chưa import bảng điểm nên mình chưa có điểm của bạn để tra cứu.\n"
      + "Bạn vui lòng import bảng điểm PDF ở trang Hồ sơ và bảng điểm [1], phần Bảng điểm của tôi. Sau khi bảng điểm được lưu, bạn có thể hỏi mình điểm trung bình tích lũy, điểm từng môn, các môn còn nợ hay số tín chỉ đã tích lũy.");
    const transcriptOnly = { ...none, transcript: true };
    expect(ask(transcriptOnly, "Điểm trung bình tích lũy của mình là bao nhiêu?")).toBeNull();
    expect(ask(transcriptOnly, "Mình còn nợ môn nào không?")).toBeNull();
    expect(ask(transcriptOnly, "Mình cần học lại môn nào?")).toBeNull();
    expect(ask(none, "Mình cần học lại môn nào?")!.content).toMatch(/^Bạn chưa import bảng điểm và chưa thực hiện Đánh giá năng lực/);
  });

  it("checks the student's own graduation standing against the transcript only", () => {
    const answer = ask(none, "Mình đủ điều kiện tốt nghiệp chưa?")!;
    expect(answer.content).toBe("Bạn chưa import bảng điểm nên mình chưa có cơ sở để đối chiếu kết quả học tập của bạn với tiêu chuẩn xét tốt nghiệp.\n"
      + "Bạn vui lòng import bảng điểm PDF ở trang Hồ sơ và bảng điểm [1], rồi xem trang Điều kiện xét tốt nghiệp [2] hoặc hỏi lại mình nhé.");
    expect(answer.sources.map((source) => source.link)).toEqual(["#profile", "#graduation"]);
    expect(ask({ ...none, transcript: true }, "Mình đủ điều kiện tốt nghiệp chưa?")).toBeNull();
    // The standard itself needs no result of the student's.
    expect(ask(none, "Điều kiện xét tốt nghiệp của khóa mình là gì?")).toBeNull();
  });

  it("leaves how-to, catalog and general questions to the AI", () => {
    for (const question of [
      "Làm sao để mình import bảng điểm?", "Làm thế nào để em chạy Đánh giá năng lực?", "Hướng dẫn mình chọn nghề mục tiêu",
      "Kế hoạch đào tạo học kỳ 5 của mình có những môn gì?", "Môn tiên quyết của Kiểm thử phần mềm mà mình cần là gì?",
      "Kỹ năng Docker là gì?", "Kỹ năng tối ưu hóa truy vấn là gì?", "Học kỳ tới nên học gì?", "Em chào anh chị",
      "ky nang tu duy thong minh la gi", "EduPath AI dùng dữ liệu của mình như thế nào?",
    ]) expect(ask(none, question), question).toBeNull();
  });

  it("reads the asker in questions typed without diacritics or without a pronoun", () => {
    expect(ask(none, "vi sao lo trinh de xuat mon nay cho minh")?.content).toMatch(/^Bạn chưa import bảng điểm và chưa thực hiện Đánh giá năng lực/);
    expect(ask(none, "toi con thieu ky nang gi")).not.toBeNull();
    expect(ask(none, "Kỹ năng nào còn thiếu cho nghề mục tiêu?")).not.toBeNull();
    expect(ask(none, "Tôi phù hợp với nghề nào?")).not.toBeNull();
  });
});

describe("suggestedQuestions", () => {
  it("offers the setup questions first, then questions about the student's own results", () => {
    expect(suggestedQuestions(none)).toEqual([
      "Làm sao để import bảng điểm PDF?", "Làm sao để chọn chuyên ngành và nghề mục tiêu?", "Khảo sát định hướng dùng để làm gì?",
      "Làm sao để chạy Đánh giá năng lực?", "Điều kiện xét tốt nghiệp của khóa mình là gì?", "EduPath AI dùng dữ liệu của mình như thế nào?",
    ]);
    expect(suggestedQuestions({ ...all, roadmap: false })).toEqual([
      "Làm sao để tạo Lộ trình AI?", "Điểm trung bình tích lũy của mình là bao nhiêu?", "Mình còn nợ môn nào không?",
      "Mình còn thiếu những kỹ năng nào cho nghề mục tiêu?", "Học kỳ tới mình nên học những môn nào?", "Điều kiện xét tốt nghiệp của khóa mình là gì?",
    ]);
    expect(suggestedQuestions(all)).toEqual([
      "Điểm trung bình tích lũy của mình là bao nhiêu?", "Mình còn nợ môn nào không?", "Mình còn thiếu những kỹ năng nào cho nghề mục tiêu?",
      "Học kỳ tới mình nên học những môn nào?", "Vì sao lộ trình đề xuất các môn này cho mình?", "Điều kiện xét tốt nghiệp của khóa mình là gì?",
    ]);
  });

  it("never suggests a question the student would get the missing-results answer for", () => {
    const keys = Object.keys(none) as (keyof Readiness)[];
    for (let mask = 0; mask < 2 ** keys.length; mask += 1) {
      const readiness = Object.fromEntries(keys.map((key, bit) => [key, (mask & (1 << bit)) !== 0])) as Readiness;
      const suggestions = suggestedQuestions(readiness);
      expect(suggestions.length).toBeGreaterThanOrEqual(4);
      expect(suggestions.length).toBeLessThanOrEqual(6);
      for (const question of suggestions) expect(ask(readiness, question), `${question} ${JSON.stringify(readiness)}`).toBeNull();
    }
  });
});
