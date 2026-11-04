import { describe, expect, it } from "vitest";
import { buildAiInput } from "./prompt.js";
import { syntheticResult, withCompV3Improvements } from "./test-fixture.js";
import {
  hasForbiddenContent, numberFactsOf, numbersIn, repairAiOutput, retryNote, termCodeNumbers, truncatedNumber, validateAiOutput, validationContextFromAiInput,
  type AiOutput
} from "./validate.js";

const input = buildAiInput(syntheticResult());
const context = validationContextFromAiInput(input)!;

// The data block writes the scores as the pages show them (comp-v14): 88,5/100, 80,5/100, 72,5/100, overall 72,2/100.
const valid = (): AiOutput => ({
  summary: "Bạn có nền tảng lập trình hướng đối tượng vững với điểm 88,5, nhưng kiểm thử phần mềm mới đạt 55/100 trên ngưỡng 85.",
  groupInsights: [{ groupKey: "G1", comment: "Nhóm kỹ thuật phần mềm đạt 80,5, mức Khá." }],
  strengths: [{ skillKey: "S01", comment: "Học phần Nhập môn lập trình đạt 8.5 cho thấy bạn nắm chắc nền tảng." }],
  improvements: [
    {
      skillKey: "S03", priority: "high", courses: [{ courseCode: "TST201", reason: "Chưa học, đủ điều kiện đăng ký ở HK261." }],
      comment: "Kiểm thử phần mềm còn thiếu 30 điểm so với ngưỡng của nghề; hãy đăng ký Kiểm thử phần mềm cơ bản."
    },
    {
      skillKey: "S02", priority: "medium", courses: [{ courseCode: "TST130", reason: "Đã đạt 6,8 (C+), có thể học cải thiện." }],
      comment: "Cơ sở dữ liệu đạt 72,5, đã qua ngưỡng của nghề; học cải thiện Nhập môn cơ sở dữ liệu để nâng lên mức Giỏi."
    }
  ],
  careerFit: { comment: "Bạn đạt 2/4 kỹ năng của nghề, mức Phù hợp." },
  gaps: [
    { skillKey: "S03", priority: "high", explanation: "Đây là kỹ năng bắt buộc của nghề.", courses: [{ courseCode: "TST201", reason: "Học ở HK261." }], selfStudy: ["Viết bộ kiểm thử cho một dự án cá nhân."] },
    { skillKey: "S05", priority: "low", explanation: "Chương trình chưa đo kỹ năng này.", courses: [], selfStudy: ["Tự triển khai một ứng dụng nhỏ lên nền tảng đám mây."] }
  ],
  progress: "Bạn đang trễ 1 mục với 3 tín chỉ so với kế hoạch; nên ưu tiên học lại Toán rời rạc.",
  nextSteps: ["Đăng ký Kiểm thử phần mềm cơ bản.", "Hoàn thành một sản phẩm kiểm thử nhỏ.", "Học lại Toán rời rạc."]
});

const reasonOf = (raw: unknown) => {
  const result = validateAiOutput(raw, context);
  return result.ok ? "ok" : `${result.error.reason}@${result.error.path}`;
};

describe("validateAiOutput", () => {
  it("accepts an output that only uses supplied keys, courses and numbers", () => {
    const result = validateAiOutput(valid(), context);
    expect(result).toEqual({ ok: true, output: valid() });
  });

  it("rejects schema violations with a typed error", () => {
    expect(reasonOf({ ...valid(), extra: 1 })).toBe("schema@");
    expect(reasonOf({ ...valid(), summary: "" })).toBe("schema@summary");
    expect(reasonOf({ ...valid(), summary: "a".repeat(601) })).toBe("schema@summary");
    expect(reasonOf({ ...valid(), nextSteps: ["Một", "Hai"] })).toBe("schema@nextSteps");
    expect(reasonOf({ ...valid(), improvements: [{ skillKey: "S03", priority: "urgent", comment: "x" }] })).toBe("schema@improvements.0.priority");
    expect(reasonOf("not json")).toBe("schema@");
  });

  it("rejects unknown skill and group keys", () => {
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S99", comment: "Tốt." }] })).toBe("unknown_skill_key@strengths.0.skillKey");
    expect(reasonOf({ ...valid(), groupInsights: [{ groupKey: "G7", comment: "Tốt." }] })).toBe("unknown_group_key@groupInsights.0.groupKey");
    expect(reasonOf({ ...valid(), gaps: [{ ...valid().gaps[0]!, skillKey: "S01" }] })).toBe("unknown_gap_skill@gaps.0.skillKey");
  });

  it("rejects a course that belongs to another skill or is invented", () => {
    const gaps = valid().gaps;
    gaps[1] = { ...gaps[1]!, courses: [{ courseCode: "TST201", reason: "Học ở HK261." }] };
    expect(reasonOf({ ...valid(), gaps })).toBe("foreign_course@gaps.1.courses.0.courseCode");
    const invented = valid().gaps;
    invented[0] = { ...invented[0]!, courses: [{ courseCode: "XYZ999", reason: "Học thêm." }] };
    expect(reasonOf({ ...valid(), gaps: invented })).toBe("foreign_course@gaps.0.courses.0.courseCode");
  });

  it("keeps strengths to strong skills and away from improvements and gaps", () => {
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S03", comment: "Tốt." }] })).toBe("unknown_skill_key@strengths.0.skillKey");
    expect(reasonOf({ ...valid(), improvements: [{ skillKey: "S01", priority: "low", comment: "Ôn lại." }] })).toBe("unknown_skill_key@improvements.0.skillKey");
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S04", comment: "Tốt." }] })).toBe("unknown_skill_key@strengths.0.skillKey");
    // Cross-list conflict, checked even if a stored schema allowed both (e.g. a comp-v1 job).
    const loose = { ...context, strengthKeys: ["S01", "S03"], improvementKeys: ["S01", "S02", "S03"] };
    expect(validateAiOutput({ ...valid(), strengths: [{ skillKey: "S03", comment: "Tốt." }] }, loose)).toMatchObject({ ok: false, error: { reason: "conflicting_skill", path: "strengths.0.skillKey" } });
    // A met career skill to deepen is no strength (comp-v5).
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S02", comment: "Tốt." }] })).toBe("unknown_skill_key@strengths.0.skillKey");
  });

  it("allows an improvement only the courses listed for exactly that skill (comp-v4)", () => {
    const improvements = (courses: AiOutput["improvements"][number]["courses"], skillKey = "S02") =>
      ({ ...valid(), improvements: [{ skillKey, priority: "high" as const, courses, comment: "Học cải thiện Nhập môn cơ sở dữ liệu." }] });
    // Take and improve courses of the plan; at most 2.
    expect(reasonOf(improvements([{ courseCode: "TST240", reason: "Chưa học, đủ điều kiện đăng ký." }, { courseCode: "TST130", reason: "Đã đạt, học cải thiện." }]))).toBe("ok");
    expect(reasonOf(improvements([{ courseCode: "TST201", reason: "Học mới." }]))).toBe("foreign_course@improvements.0.courses.0.courseCode");
    expect(reasonOf(improvements([{ courseCode: "XYZ999", reason: "Học thêm." }]))).toBe("foreign_course@improvements.0.courses.0.courseCode");
    const repeated = validateAiOutput(improvements([{ courseCode: "TST130", reason: "A." }, { courseCode: "TST130", reason: "B." }]), context);
    expect(repeated.ok && repeated.output.improvements[0]!.courses).toEqual([{ courseCode: "TST130", reason: "A." }]);
    const three = ["TST240", "TST130", "TST201"].map((courseCode) => ({ courseCode, reason: "Học." }));
    expect(reasonOf(improvements(three))).toBe("schema@improvements.0.courses");
    // Reasons are checked like every other text.
    expect(reasonOf(improvements([{ courseCode: "TST130", reason: "Học cải thiện để đạt 9,5." }]))).toBe("invented_number@improvements.0.courses.0.reason");
    expect(reasonOf(improvements([{ courseCode: "TST130", reason: "Xem www.example.org." }]))).toBe("forbidden_content@improvements.0.courses.0.reason");
    expect(reasonOf(improvements([{ courseCode: "TST130", reason: "" }]))).toBe("schema@improvements.0.courses.0.reason");
    // With a career, a weak skill outside it is no improvement at all (comp-v5).
    expect(reasonOf(improvements([], "S06"))).toBe("unknown_skill_key@improvements.0.skillKey");
    // Without one, its plan's courses (take, retake, improve) are allowed, and a plan without courses allows none.
    const noCareer = validationContextFromAiInput(buildAiInput(syntheticResult({ career: false })))!;
    const strengthen = (skillKey: string, courses: AiOutput["improvements"][number]["courses"]) => {
      const result = validateAiOutput({
        ...valid(), summary: "Bạn có nền tảng lập trình hướng đối tượng vững với điểm 88,5.", gaps: [],
        improvements: [{ skillKey, priority: "high", courses, comment: "Học lại Toán rời rạc." }]
      }, noCareer);
      return result.ok ? "ok" : `${result.error.reason}@${result.error.path}`;
    };
    expect(strengthen("S06", [{ courseCode: "TST310", reason: "Cần đạt trước Hệ điều hành." }, { courseCode: "TST150", reason: "Chưa đạt, học lại." }])).toBe("ok");
    expect(strengthen("S07", [{ courseCode: "TST120", reason: "Ôn lại." }])).toBe("foreign_course@improvements.0.courses.0.courseCode");
    expect(strengthen("S07", [])).toBe("ok");
  });

  it("validates the output of a job queued before comp-v4 against its own schema", () => {
    const legacyInput = { ...input, schema: withCompV3Improvements(input.schema, ["S03", "S06"]) };
    const legacy = validationContextFromAiInput(legacyInput)!;
    const old = { ...valid(), improvements: [{ skillKey: "S03", priority: "high", comment: "Kiểm thử phần mềm còn thiếu 30 điểm." }] };
    // No courses in the old schema: stored as an empty list.
    expect(validateAiOutput(old, legacy)).toEqual({ ok: true, output: { ...old, improvements: [{ ...old.improvements[0]!, courses: [] }] } });
    expect(validateAiOutput(valid(), legacy)).toMatchObject({ ok: false, error: { reason: "foreign_course", path: "improvements.0.courses.0.courseCode" } });
    // A current job never lacks courses (its grammar requires them), but a missing list reads as empty.
    expect(validateAiOutput(old, context)).toMatchObject({ ok: true, output: { improvements: [{ skillKey: "S03", courses: [] }] } });
  });

  it("rejects course codes in free text that are not in the data block", () => {
    const real = { ...context, numbers: new Set([...context.numbers, 71, 30103]), courseCodes: new Set(["71ITSE30103"]) };
    const check = (summary: string) => { const r = validateAiOutput({ ...valid(), summary }, real); return r.ok ? "ok" : `${r.error.reason}@${r.error.path}`; };
    expect(check("Bạn nên học Kiểm thử phần mềm (71ITSE30103).")).toBe("ok");
    expect(check("Bạn nên học Cơ sở dữ liệu (ITSE30103).")).toBe("foreign_course@summary");
    expect(check("Bạn nên học thêm 71ITXX30103.")).toBe("foreign_course@summary");
    expect(check("Học kỳ HK253 và kỹ năng S03 không phải mã học phần.")).toBe("ok");
  });

  it("keeps the first of repeated entries instead of rejecting the comment (comp-v7)", () => {
    const strengths = validateAiOutput({ ...valid(), strengths: [{ skillKey: "S01", comment: "A." }, { skillKey: "S01", comment: "B." }] }, context);
    expect(strengths.ok && strengths.output.strengths).toEqual([{ skillKey: "S01", comment: "A." }]);
    const gaps = valid().gaps;
    gaps[0] = { ...gaps[0]!, courses: [{ courseCode: "TST201", reason: "A." }, { courseCode: "TST201", reason: "B." }] };
    const repeated = validateAiOutput({ ...valid(), gaps: [...gaps, gaps[0]!] }, context);
    // The repeated S03 at the end goes; the repeated course inside the first S03 goes too.
    expect(repeated.ok && repeated.output.gaps.map((gap) => [gap.skillKey, gap.courses.map((course) => course.reason)]))
      .toEqual([[gaps[0]!.skillKey, ["A."]], ...gaps.slice(1).map((gap) => [gap.skillKey, gap.courses.map((course) => course.reason)])]);
    const groups = validateAiOutput({ ...valid(), groupInsights: [...valid().groupInsights, valid().groupInsights[0]!] }, context);
    expect(groups.ok && groups.output.groupInsights).toEqual(valid().groupInsights);
  });

  it("rejects numbers that are not in the data block", () => {
    expect(reasonOf({ ...valid(), summary: "Bạn đạt 74 điểm kiểm thử." })).toBe("invented_number@summary");
    expect(reasonOf({ ...valid(), nextSteps: ["Luyện 2 tuần.", "Làm dự án.", "Ôn tập."] })).toBe("ok");
    expect(reasonOf({ ...valid(), nextSteps: ["Luyện 17 tuần.", "Làm dự án.", "Ôn tập."] })).toBe("invented_number@nextSteps.0");
    expect(reasonOf({ ...valid(), progress: "Điểm 72.46 cho thấy..." })).toBe("invented_number@progress");
  });

  it("rejects a score written without its decimals, or with more than the data block gives (comp-v14)", () => {
    // The engine scores 88,5 / 80,5 / 72,25 are sent as the page shows them: 88,5 / 80,5 / 72,2 (review 2026-11-04: "69" for 69,9).
    expect(reasonOf({ ...valid(), summary: "Điểm tổng của bạn là 72,2/100." })).toBe("ok");
    expect(reasonOf({ ...valid(), summary: "Điểm tổng của bạn là 72." })).toBe("truncated_number@summary");
    expect(reasonOf({ ...valid(), summary: "Lập trình hướng đối tượng đạt 88 điểm." })).toBe("truncated_number@summary");
    // Rounded away is cut too.
    expect(reasonOf({ ...valid(), summary: "Lập trình hướng đối tượng đạt 89." })).toBe("truncated_number@summary");
    expect(reasonOf({ ...valid(), groupInsights: [{ groupKey: "G1", comment: "Nhóm đạt 80." }] })).toBe("truncated_number@groupInsights.0.comment");
    // More decimals than the data block gives is still an invented number.
    expect(reasonOf({ ...valid(), summary: "Điểm tổng của bạn là 72,25." })).toBe("invented_number@summary");
    // 88 elsewhere in the data block (a count) does not make "88 điểm" right: written as a score, it must be one of the scores.
    const counted = { ...context, numbers: new Set([...context.numbers, 88]) };
    const check = (summary: string) => { const r = validateAiOutput({ ...valid(), summary }, counted); return r.ok ? "ok" : `${r.error.reason}@${r.error.path}`; };
    expect(check("Lập trình hướng đối tượng đạt 88 điểm.")).toBe("truncated_number@summary");
    expect(check("Lập trình hướng đối tượng: điểm 88.")).toBe("truncated_number@summary");
    expect(check("Bạn đã học 88 học phần.")).toBe("ok");
    // A job queued before comp-v14 (whole scores in its data block) is held to its own numbers.
    const { scores: _scores, ...v13Checks } = input.checks;
    const old = validationContextFromAiInput({ ...input, user: input.user.replaceAll("điểm 88,5/100", "điểm 88/100"), checks: v13Checks })!;
    expect(validateAiOutput({ ...valid(), summary: "Lập trình hướng đối tượng đạt 88 điểm." }, old)).toMatchObject({ ok: true });
  });

  it("catches a skill's or course's own score written cut, also when another skill scores that whole number (comp-v14)", () => {
    // Without a career Sử dụng tiếng Anh is sent too; at 72 it makes "72 điểm" a score of the data block.
    const result = syntheticResult({ career: false });
    result.skills[5] = { ...result.skills[5]!, score: 72 };
    const plain = validationContextFromAiInput(buildAiInput(result))!;
    const check = (summary: string) => { const r = validateAiOutput({ ...valid(), summary, gaps: [], improvements: [] }, plain); return r.ok ? "ok" : `${r.error.reason}@${r.error.path}`; };
    // Only scores the data block shows with decimals are named: Toán rời rạc's 3,5 is not in it, Sử dụng tiếng Anh's 72 is whole.
    expect(plain.checks?.scores).toEqual(expect.arrayContaining([{ name: "Cơ sở dữ liệu", value: "72,5" }, { name: "Mạng máy tính căn bản", value: "6,5" }]));
    expect(plain.checks?.scores?.map((item) => item.name)).not.toContain("Toán rời rạc");
    expect(plain.checks?.scores?.map((item) => item.name)).not.toContain("Sử dụng tiếng Anh");
    expect(check("Sử dụng tiếng Anh đạt 72 điểm.")).toBe("ok");
    expect(check("Cơ sở dữ liệu đạt 72,5 điểm, Sử dụng tiếng Anh đạt 72 điểm.")).toBe("ok");
    expect(check("Cơ sở dữ liệu đạt 72 điểm.")).toBe("truncated_number@summary");
    expect(check("Cơ sở dữ liệu (72/100) đã ở mức Khá.")).toBe("truncated_number@summary");
    // The longer name wins: Mạng máy tính căn bản (6,5) is not Mạng máy tính (65,5).
    expect(check("Bạn có thể học cải thiện Mạng máy tính căn bản vì lần trước được 6 điểm.")).toBe("truncated_number@summary");
    expect(check("Mạng máy tính đạt 65,5/100, Mạng máy tính căn bản đạt 6,5/10.")).toBe("ok");
    // A term, a count or a change after the name is another number.
    expect(check("Bạn nên học cải thiện Mạng máy tính căn bản ở học kỳ 1.")).toBe("ok");
    expect(check("Mạng máy tính căn bản (3 TC) có thể học cải thiện.")).toBe("ok");
    expect(check("Cơ sở dữ liệu cần thêm 1 học phần để lên mức Giỏi.")).toBe("ok");
  });

  it("names the number and the decimals it lost when it asks once more (comp-v14)", () => {
    const result = validateAiOutput({ ...valid(), summary: "Lập trình hướng đối tượng đạt 88 điểm." }, context);
    if (result.ok || !result.problems || !result.output) throw new Error("expected problems");
    expect(result.problems).toEqual([{ reason: "truncated_number", path: "summary", number: "88", given: ["88,5"] }]);
    expect(retryNote(result.problems, result.output, context)).toContain("- summary: viết 88 trong khi dữ liệu ghi 88,5; chép đúng từng chữ số, giữ nguyên phần thập phân, không làm tròn hay bỏ số lẻ.");
    // After the retry the sentence goes and the rest stays.
    const repaired = repairAiOutput({ ...valid(), summary: "Bạn học tốt. Lập trình hướng đối tượng đạt 88 điểm." }, context);
    expect(repaired?.summary).toBe("Bạn học tốt.");
  });

  it("accepts a coming term of the data block however it is written, and rejects a passed or invented one (comp-v13)", () => {
    expect(reasonOf({ ...valid(), progress: "Bạn đang ở HK3 2025–2026, học kỳ tới là HK1 2026–2027." })).toBe("ok");
    expect(reasonOf({ ...valid(), progress: "Bạn đang ở học kỳ 3 năm học 2025–2026, học kỳ tới là học kỳ 1 năm học 2026–2027." })).toBe("ok");
    expect(reasonOf({ ...valid(), progress: "Bạn nên đăng ký Kiểm thử phần mềm cơ bản ở HK261." })).toBe("ok");
    expect(reasonOf({ ...valid(), progress: "Bạn nên đăng ký Kiểm thử phần mềm cơ bản ở HK271." })).toBe("term_not_in_plan@progress");
    // The term Toán rời rạc was planned in (HK2 2025–2026) has passed: never a term to take it in.
    expect(reasonOf({ ...valid(), nextSteps: ["Học lại Toán rời rạc ở HK2 2025–2026.", "Làm dự án.", "Ôn tập."] })).toBe("term_not_in_plan@nextSteps.0");
    // A job queued before comp-v13 has no checks: only the number check applies.
    const { checks: _old, ...before } = context;
    expect(validateAiOutput({ ...valid(), progress: "Bạn nên đăng ký ở HK271." }, before)).toMatchObject({ ok: false, error: { reason: "invented_number" } });
  });

  it("rejects a strength, improvement or gap that talks about another skill, not a text that names none (comp-v13)", () => {
    // Làm việc nhóm (S04) has no evidence, so the check uses the skills of this job: S01 is the strength.
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S01", comment: "Bạn làm tốt Kiểm thử phần mềm qua đồ án." }] })).toBe("off_topic_skill@strengths.0.comment");
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S01", comment: "Bạn vững lập trình hướng đối tượng và cả kiểm thử phần mềm." }] })).toBe("ok");
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S01", comment: "Điểm cao ở học phần nền tảng cho thấy bạn nắm chắc nội dung." }] })).toBe("ok");
    expect(reasonOf({ ...valid(), improvements: [{ ...valid().improvements[0]!, comment: "Hãy học thêm về Cơ sở dữ liệu." }] })).toBe("off_topic_skill@improvements.0.comment");
    expect(reasonOf({ ...valid(), gaps: [{ ...valid().gaps[0]!, explanation: "Điện toán đám mây là kỹ năng bắt buộc." }, valid().gaps[1]!] })).toBe("off_topic_skill@gaps.0.explanation");
  });

  it("rejects URLs, emails and HTML", () => {
    expect(reasonOf({ ...valid(), summary: "Xem https://example.org nhé." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Xem www.example.org nhé." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Học trên example.com nhé." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Liên hệ ai@example.org nhé." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Bạn <b>giỏi</b>." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Bạn giỏi &amp; chăm." })).toBe("forbidden_content@summary");
  });
});

describe("helpers", () => {
  it("reads decimal comma and dot the same way", () => {
    expect(numbersIn("điểm 72,5 và 8.5, HK253, 2/4")).toEqual([72.5, 8.5, 253, 2, 4]);
    // Course scores keep their decimals (8,5); 0–100 scores keep one, floored like the pages (72,5; 72,25 is sent as 72,2).
    expect(context.numbers.has(8.5)).toBe(true);
    expect(context.numbers.has(72.5)).toBe(true);
    expect(context.numbers.has(72.2)).toBe(true);
    expect(context.numbers.has(72.25)).toBe(false);
    expect(context.numbers.has(2026)).toBe(true);
  });
  it("reads the decimals and the scores of a data block, terms and dates left out (comp-v14)", () => {
    const facts = numberFactsOf("Điểm tổng: 69,9/100 | dựa trên 9/10 kỹ năng | điểm 85/100 | thiếu 15,2 điểm | 64 học phần | độ phủ 46% | HK1 2026–2027 | 21/12/2026 | GPA 2,85/4, tối thiểu 2,00/4 | Đạt 3/5 kỹ năng");
    expect(facts.decimals.map((item) => [item.text, item.score])).toEqual([["69,9", true], ["15,2", true], ["2,85", true]]);
    expect([...facts.scores].sort((a, b) => a - b)).toEqual([2, 2.85, 15.2, 69.9, 85]);
    const numbers = new Set(numbersIn("69,9 9 10 85 15,2 64 46 1 2026 2027 21 12 2,85 2,00 4 3 5 100"));
    const cut = (text: string) => truncatedNumber(text, numbers, facts);
    expect(cut("Điểm tổng của bạn là 69.")).toEqual({ number: "69", given: ["69,9"] });
    expect(cut("Điểm tổng 70/100.")).toEqual({ number: "70", given: ["69,9"] });
    expect(cut("Điểm trung bình tích lũy 2,8.")).toEqual({ number: "2,8", given: ["2,85"] });
    expect(cut("Bạn còn thiếu 15 điểm.")).toEqual({ number: "15", given: ["15,2"] });
    // A count, a scale, a term, a date or a number of the data written as it is: fine.
    for (const text of ["Điểm tổng 69,9/100.", "Bạn có 9/10 kỹ năng có điểm.", "Bạn đã học 64 học phần.", "Hãy đăng ký ở HK1 2026–2027.",
      "Bắt đầu từ 21/12/2026.", "Bạn có 2 điểm mạnh.", "Ngưỡng 85 điểm.", "Độ phủ 46%."]) expect(cut(text)).toBeNull();
    // 64 is in the data as a count, so "64 học phần" is right, but as a score it must be one of the scores.
    expect(cut("Kỹ năng này đạt 64 điểm.")).toBeNull();
    const scored = numberFactsOf("điểm 64,8/100 | 64 học phần");
    expect(truncatedNumber("Kỹ năng này đạt 64 điểm.", new Set([64.8, 64, 100]), scored)).toEqual({ number: "64", given: ["64,8"] });
    expect(truncatedNumber("Bạn đã học 64 học phần.", new Set([64.8, 64, 100]), scored)).toBeNull();
  });
  it("derives HKyyS codes from terms written in words", () => {
    expect(termCodeNumbers("học kỳ 3 năm học 2025–2026; học kỳ 1 năm học 2026-2027; học kỳ 2 năm học 2009–2010")).toEqual([253, 261, 92]);
    expect(numbersIn("HK092")).toEqual([92]);
    expect(context.numbers.has(253)).toBe(true);
    expect(context.numbers.has(262)).toBe(true);
    expect(context.numbers.has(271)).toBe(false);
  });
  it("does not flag technology names", () => {
    expect(hasForbiddenContent("ASP.NET, Node.js, C#/C++ và Socket.io")).toBe(false);
  });
  it("needs a well-formed stored input", () => {
    expect(validationContextFromAiInput({ schema: {}, user: "x" })).toBeNull();
    expect(validationContextFromAiInput({ schema: input.schema, user: 1 })).toBeNull();
  });
});
