import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { syntheticSurveyRow } from "../roadmap/test-fixture.js";
import { detectIntents } from "./intent.js";
import { READINESS_ANSWER_VERSION, readinessAnswer, readReadiness, suggestedQuestions, type Readiness } from "./readiness.js";

// What Trợ lý AI answers at once when the student's results are missing, and the questions it suggests. Synthetic data only.
const userId = "11111111-1111-4111-8111-111111111111";
const none: Readiness = { transcript: false, specialty: false, career: false, survey: false, assessment: false, roadmap: false };
const all: Readiness = { transcript: true, specialty: true, career: true, survey: true, assessment: true, roadmap: true };
const ask = (readiness: Readiness, question: string) => readinessAnswer(readiness, detectIntents(question), question);
const links = (answer: { sources: { link: string }[] } | null) => answer?.sources.map((source) => source.link);
const ROADMAP_QUESTION = "Vì sao lộ trình đề xuất các môn này cho mình?";
const MEANWHILE = "Trong lúc chờ, bạn vẫn có thể hỏi mình về chương trình đào tạo, điều kiện tốt nghiệp hay cách dùng EduPath AI.";
const KEYS = Object.keys(none) as (keyof Readiness)[];
/** Every combination of the six items. */
const everyReadiness = () => Array.from({ length: 2 ** KEYS.length }, (_, mask) =>
  Object.fromEntries(KEYS.map((key, bit) => [key, (mask & (1 << bit)) !== 0])) as Readiness);

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

  it("counts a complete survey a cố vấn học tập or the Khoa filled in, unless the student withdrew the consent (policy 2026-11-10)", async () => {
    const state = { withdrawn: false, savedBy: "advisor" as string | null };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("AS withdrawn")) return { rows: [{ withdrawn: state.withdrawn }] };
      if (sql.includes("FROM stu_profile_surveys")) return { rows: [{ ...syntheticSurveyRow(), saved_by_role: state.savedBy }] };
      if (sql.includes("FROM data_consents")) return { rows: [] };
      return { rows: [{ transcript: true, specialty: true, career: true, assessment: false, roadmap: false }] };
    });
    const db = { query } as unknown as DatabasePool;
    expect((await readReadiness(db, userId)).survey).toBe(true);
    state.withdrawn = true;
    expect((await readReadiness(db, userId)).survey).toBe(false);
    state.withdrawn = false;
    state.savedBy = null;
    expect((await readReadiness(db, userId)).survey).toBe(false);
  });
});

describe("readinessAnswer", () => {
  it("says the assessment is missing and lists every step left for the question of the screenshot", () => {
    expect(READINESS_ANSWER_VERSION).toBe("assistant-readiness-v3");
    const answer = ask(none, ROADMAP_QUESTION)!;
    // v3 (2026-11-14): the specialty and the transcript come first, together; the target career and the survey are no step.
    expect(answer.content.split("\n")).toEqual([
      "Hiện bạn chưa import bảng điểm và chưa làm Đánh giá năng lực, nên mình chưa có cơ sở để tư vấn câu này. Bạn hoàn thành giúp mình mấy bước sau nhé:",
      "1. Chọn chuyên ngành và import bảng điểm PDF ở trang Hồ sơ và bảng điểm.",
      "2. Bấm Đánh giá năng lực ở trang Đánh giá năng lực.",
      "3. Bấm Tạo lộ trình ở trang Lộ trình học tập.",
      `Xong rồi bạn hỏi lại, mình sẽ giải thích vì sao từng môn được đề xuất. ${MEANWHILE}`,
    ]);
    // The pages the steps mention, in their order; the page shows them under the answer.
    expect(answer.sources).toEqual([
      { n: 1, kind: "guide", title: "Hồ sơ và bảng điểm", link: "#profile" },
      { n: 2, kind: "guide", title: "Đánh giá năng lực", link: "#competency" },
      { n: 3, kind: "guide", title: "Lộ trình học tập", link: "#roadmap" },
    ]);
  });

  it("names only the steps still to do", () => {
    const onlyAssessment = ask({ ...all, assessment: false, roadmap: false }, "Mình còn thiếu kỹ năng nào cho nghề mục tiêu?")!;
    expect(onlyAssessment.content).toBe("Bạn chỉ còn thiếu bước Đánh giá năng lực nên mình chưa có cơ sở để tư vấn câu này. Bạn bấm Đánh giá năng lực ở trang Đánh giá năng lực nhé, xong rồi hỏi lại mình.");
    expect(links(onlyAssessment)).toEqual(["#competency"]);
    // v3: no target career and no survey leave only the assessment to do.
    const noCareer = ask({ ...all, career: false, survey: false, assessment: false, roadmap: false }, "Học kỳ tới em nên học những môn nào?")!;
    expect(noCareer.content).toBe(onlyAssessment.content);
    expect(links(noCareer)).toEqual(["#competency"]);
    const noSpecialty = ask({ ...all, specialty: false, survey: false, assessment: false, roadmap: false }, "Mình còn thiếu kỹ năng nào?")!;
    expect(noSpecialty.content).toContain("1. Chọn chuyên ngành ở trang Hồ sơ và bảng điểm.\n2. Bấm Đánh giá năng lực");
    expect(links(noSpecialty)).toEqual(["#profile", "#competency"]);
    const noTranscript = ask({ ...all, transcript: false, assessment: false, roadmap: false }, "Mình còn thiếu kỹ năng nào?")!;
    expect(noTranscript.content).toContain("1. Import bảng điểm PDF ở trang Hồ sơ và bảng điểm.\n2. Bấm Đánh giá năng lực");
    // With the assessment done but the roadmap asked about, its step follows.
    expect(ask({ ...all, assessment: false, roadmap: false }, ROADMAP_QUESTION)!.content)
      .toContain("1. Bấm Đánh giá năng lực ở trang Đánh giá năng lực.\n2. Bấm Tạo lộ trình ở trang Lộ trình học tập.\nXong rồi bạn hỏi lại, mình sẽ giải thích vì sao từng môn được đề xuất.");
  });

  it("asks for the AI roadmap when only that is missing, and lets the AI answer once it exists", () => {
    const answer = ask({ ...all, roadmap: false }, ROADMAP_QUESTION)!;
    expect(answer.content).toBe("Bạn chưa tạo Lộ trình AI nên chưa có môn nào được đề xuất để mình giải thích. Bạn bấm Tạo lộ trình ở tab Lộ trình AI đề xuất (trang Lộ trình học tập) nhé, "
      + "có lộ trình rồi mình sẽ giải thích lý do của từng môn.");
    expect(links(answer)).toEqual(["#roadmap"]);
    // v3: Lộ trình AI no longer waits for the survey.
    const noSurvey = ask({ ...all, roadmap: false, survey: false }, ROADMAP_QUESTION)!;
    expect(noSurvey.content).toBe(answer.content);
    expect(links(noSurvey)).toEqual(["#roadmap"]);
    expect(ask(all, ROADMAP_QUESTION)).toBeNull();
    // Another "vì sao" with an assessment is the AI's (the courses of Khoảng trống kỹ năng need no roadmap).
    expect(ask({ ...all, roadmap: false }, "Vì sao mình nên học môn Kiểm thử phần mềm?")).toBeNull();
  });

  it("answers grade questions from the transcript once there, with or without an assessment", () => {
    const answer = ask(none, "Điểm trung bình tích lũy của mình là bao nhiêu?")!;
    expect(answer.content).toBe("Bạn chưa import bảng điểm nên mình chưa xem được điểm của bạn. Bạn import bảng điểm PDF ở trang Hồ sơ và bảng điểm (phần Bảng điểm của tôi) nhé. "
      + "Có bảng điểm rồi, bạn hỏi mình điểm trung bình tích lũy, điểm từng môn, môn còn nợ hay số tín chỉ đã tích lũy đều được.");
    expect(links(answer)).toEqual(["#profile"]);
    const transcriptOnly = { ...none, transcript: true };
    expect(ask(transcriptOnly, "Điểm trung bình tích lũy của mình là bao nhiêu?")).toBeNull();
    expect(ask(transcriptOnly, "Mình còn nợ môn nào không?")).toBeNull();
    expect(ask(transcriptOnly, "Mình cần học lại môn nào?")).toBeNull();
    expect(ask(none, "Mình cần học lại môn nào?")!.content).toMatch(/^Hiện bạn chưa import bảng điểm và chưa làm Đánh giá năng lực, nên mình chưa có cơ sở để tư vấn/);
  });

  it("checks the student's own graduation standing against the transcript only", () => {
    const answer = ask(none, "Mình đủ điều kiện tốt nghiệp chưa?")!;
    expect(answer.content).toBe("Bạn chưa import bảng điểm nên mình chưa có cơ sở để đối chiếu kết quả học tập của bạn với tiêu chuẩn xét tốt nghiệp. "
      + "Bạn import bảng điểm PDF ở trang Hồ sơ và bảng điểm trước nhé, sau đó xem trang Xét tốt nghiệp hoặc hỏi lại mình.");
    expect(links(answer)).toEqual(["#profile", "#graduation"]);
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
    expect(ask(none, "vi sao lo trinh de xuat mon nay cho minh")?.content).toMatch(/^Hiện bạn chưa import bảng điểm và chưa làm Đánh giá năng lực/);
    expect(ask(none, "toi con thieu ky nang gi")).not.toBeNull();
    expect(ask(none, "Kỹ năng nào còn thiếu cho nghề mục tiêu?")).not.toBeNull();
    expect(ask(none, "Tôi phù hợp với nghề nào?")).not.toBeNull();
  });

  it("writes every fixed answer in the warm voice: no [n] in the text, the pages numbered from 1", () => {
    const questions = [
      ROADMAP_QUESTION, "Mình còn thiếu kỹ năng nào cho nghề mục tiêu?", "Học kỳ tới em nên học những môn nào?", "Điểm trung bình tích lũy của mình là bao nhiêu?",
      "Mình đủ điều kiện tốt nghiệp chưa?", "Mình cần học lại môn nào?", "Tôi phù hợp với nghề nào?",
    ];
    let answered = 0;
    for (const readiness of everyReadiness()) {
      for (const question of questions) {
        const answer = ask(readiness, question);
        if (!answer) continue;
        answered += 1;
        const label = `${question} ${JSON.stringify(readiness)}`;
        expect(answer.content, label).not.toMatch(/\[\d+\]|\{[a-z]+\}|vui lòng|EduPath AI chưa|thực hiện Đánh giá/i);
        expect(answer.sources.map((source) => source.n), label).toEqual(answer.sources.map((_, index) => index + 1));
        expect(new Set(links(answer)).size, label).toBe(answer.sources.length);
        expect(answer.sources.length, label).toBeGreaterThan(0);
      }
    }
    expect(answered).toBeGreaterThan(100);
  });
});

describe("suggestedQuestions", () => {
  it("offers the setup questions first, then questions about the student's own results", () => {
    // v3: only the specialty and the transcript to set up first; the target career and the survey once there is an assessment.
    expect(suggestedQuestions(none)).toEqual([
      "Làm sao để chọn chuyên ngành và import bảng điểm PDF?", "Làm sao để chạy Đánh giá năng lực?",
      "Điều kiện xét tốt nghiệp của khóa mình là gì?", "EduPath AI dùng dữ liệu của mình như thế nào?",
    ]);
    expect(suggestedQuestions({ ...none, transcript: true })[0]).toBe("Làm sao để chọn chuyên ngành?");
    expect(suggestedQuestions({ ...all, career: false, survey: false })).toEqual([
      "Điểm trung bình tích lũy của mình là bao nhiêu?", "Mình còn nợ môn nào không?", "Làm sao để chọn vị trí nghề nghiệp mục tiêu?",
      "Học kỳ tới mình nên học những môn nào?", "Khảo sát nhanh dùng để làm gì?", "Vì sao lộ trình đề xuất các môn này cho mình?",
    ]);
    expect(suggestedQuestions({ ...all, roadmap: false })).toEqual([
      "Làm sao để tạo Lộ trình AI?", "Điểm trung bình tích lũy của mình là bao nhiêu?", "Mình còn nợ môn nào không?",
      "Mình còn thiếu những kỹ năng nào cho vị trí nghề nghiệp mục tiêu?", "Học kỳ tới mình nên học những môn nào?", "Điều kiện xét tốt nghiệp của khóa mình là gì?",
    ]);
    expect(suggestedQuestions(all)).toEqual([
      "Điểm trung bình tích lũy của mình là bao nhiêu?", "Mình còn nợ môn nào không?", "Mình còn thiếu những kỹ năng nào cho vị trí nghề nghiệp mục tiêu?",
      "Học kỳ tới mình nên học những môn nào?", "Vì sao lộ trình đề xuất các môn này cho mình?", "Điều kiện xét tốt nghiệp của khóa mình là gì?",
    ]);
  });

  it("never suggests a question the student would get the missing-results answer for", () => {
    for (const readiness of everyReadiness()) {
      const suggestions = suggestedQuestions(readiness);
      expect(suggestions.length).toBeGreaterThanOrEqual(4);
      expect(suggestions.length).toBeLessThanOrEqual(6);
      for (const question of suggestions) expect(ask(readiness, question), `${question} ${JSON.stringify(readiness)}`).toBeNull();
    }
  });
});
