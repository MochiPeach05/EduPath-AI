import { describe, expect, it } from "vitest";
import { surveyFacts } from "../student/survey.js";
import { roadmapBasis } from "./basis.js";
import { buildRoadmapFacts } from "./facts.js";
import { presentRoadmap } from "./present.js";
import { buildRoadmapInput, roadmapTerms, ROADMAP_OPTIONS, ROADMAP_PROMPT_VERSION, ROADMAP_THINK } from "./prompt.js";
import { NONE, ROADMAP_LIMITS } from "./schema.js";
import { ROADMAP_ASSESSMENT, ROADMAP_NOW, syntheticRoadmapFacts, syntheticRoadmapResult, syntheticSurveyRow } from "./test-fixture.js";
import { cleanCourseCodes, normalizeTermNames, roadmapContextFromAiInput, unattributedClaim, validateRoadmapOutput } from "./validate.js";
import { dateText, roadmapWindow, vietnamToday } from "./window.js";
import type { RoadmapRow } from "./jobs.js";

// Synthetic K29 data only (fixtures/synthetic-k29.json plus invented grades); no real student record.

describe("roadmapWindow", () => {
  it("covers the next term of the school calendar, split into months (user, 2026-10-25)", () => {
    // HK1 2026–2027 is under way on 24/10/2026, so the roadmap prepares HK2: 21/12/2026 to 04/04/2027.
    expect(roadmapWindow(ROADMAP_NOW)).toEqual({
      start: "2026-12-21", end: "2027-04-04", term: "HK262",
      months: [
        { index: 1, start: "2026-12-21", end: "2027-01-20" },
        { index: 2, start: "2027-01-21", end: "2027-02-20" },
        { index: 3, start: "2027-02-21", end: "2027-03-20" },
        { index: 4, start: "2027-03-21", end: "2027-04-04" },
      ],
    });
    // 17:30 UTC is already the next day in Vietnam.
    expect(vietnamToday(new Date("2026-10-23T17:30:00Z"))).toBe("2026-10-24");
    expect(dateText("2027-01-23")).toBe("23/01/2027");
  });

  it("moves on once a term has started, merges a short last month and repeats the calendar in later years", () => {
    // HK2 under way: HK3, 03/05 to 15/08/2027, its last 13 days joined to July.
    const summer = roadmapWindow(new Date("2027-01-31T03:00:00Z"));
    expect([summer.term, summer.start, summer.end]).toEqual(["HK263", "2027-05-03", "2027-08-15"]);
    expect(summer.months.map((month) => [month.start, month.end])).toEqual([
      ["2027-05-03", "2027-06-02"], ["2027-06-03", "2027-07-02"], ["2027-07-03", "2027-08-15"],
    ]);
    // HK1 2027–2028: 05/09/2027 to 22/01/2028, five months.
    const autumn = roadmapWindow(new Date("2027-06-01T03:00:00Z"));
    expect([autumn.term, autumn.start, autumn.end, autumn.months.length]).toEqual(["HK271", "2027-09-05", "2028-01-22", 5]);
    // After the table: HK272 is HK262 a year later; a term starting today is the one prepared.
    expect(roadmapWindow(new Date("2027-10-01T03:00:00Z"))).toMatchObject({ term: "HK272", start: "2027-12-21", end: "2028-04-04" });
    expect(roadmapWindow(new Date("2026-12-21T03:00:00Z")).term).toBe("HK262");
  });
});

describe("buildRoadmapFacts", () => {
  const facts = syntheticRoadmapFacts();

  it("lists the courses to take: running in the term being studied, late, then the next term", () => {
    expect(facts.study.map((item) => [item.code, item.source, item.termCode])).toEqual([
      ["71ITSE41203", "running", "HK251"],
      ["71ITIS30203", "late", "HK243"],
      ["71ITIN40304", "next", "HK252"],
    ]);
    expect(facts.study[0]!.careerSkills).toEqual(["Kiểm thử phần mềm"]);
    expect([facts.currentTerm, facts.runningTerm, facts.nextTerm]).toEqual(["HK243", "HK251", "HK252"]);
    // A choice keeps only the options still open.
    expect(facts.choices).toEqual([{
      label: "Nhóm tự chọn TC309: chọn 6 tín chỉ", source: "late", termCode: "HK243", need: "3 TC", thesis: null,
      options: [
        { code: "71ITSE30803", name: "Lập trình Web nâng cao với framework", credits: 3 },
        { code: "71ITSE30903", name: "Phát triển ứng dụng đa nền tảng", credits: 3 },
      ],
    }]);
  });

  it("offers the thesis group one way: the thesis alone, or both chuyên đề courses", () => {
    const result = syntheticRoadmapResult();
    const option = (code: string, name: string, credits: number, state: "not_taken" | "passed" | "in_progress" = "not_taken") => ({ code, name, credits, state });
    const group = (topicState: "not_taken" | "passed") => ({ kind: "choice" as const, label: "Nhóm tự chọn TC406: chọn 6 tín chỉ", required: 6, unit: "credit" as const, remaining: 6, options: [
      option("71ITGR40206", "Đồ án Tốt nghiệp", 6), option("71ITGR40203", "Chuyên đề Tốt nghiệp 1", 3, topicState),
      option("71ITGR40303", "Chuyên đề Tốt nghiệp 2", 3), option("71ITIS30403", "Quản lý và phát triển các hệ thống thông tin", 3),
    ] });
    result.progress = { ...result.progress!, next: [group("not_taken")] };
    const thesisChoice = (facts: ReturnType<typeof buildRoadmapFacts>) => facts.choices.find((item) => item.label.includes("TC406"));
    const built = () => buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW));
    const gpa = (actual: number | null) => { result.graduation = { ...result.graduation!, gpa: { ...result.graduation!.gpa!, actual, scale: 4 } }; };
    // Without a GPA the model chooses one way of two.
    gpa(null);
    const choice = thesisChoice(built());
    expect(choice!.options.map((item) => item.code)).toEqual(["71ITGR40206", "71ITGR40203", "71ITGR40303"]);
    expect(choice!.thesis).toMatchObject({ thesis: { code: "71ITGR40206" }, topics: [{ code: "71ITGR40203" }, { code: "71ITGR40303" }], way: null });
    expect(buildRoadmapInput(built()).user).toContain("chỉ chọn MỘT cách: (1) 71ITGR40206 Đồ án Tốt nghiệp (6 TC); (2) cả 71ITGR40203 Chuyên đề Tốt nghiệp 1 (3 TC) và 71ITGR40303 Chuyên đề Tốt nghiệp 2 (3 TC)");
    // roadmap-v13 (user 2026-11-03, "TB tích lũy từ 2,80"): from 2,80 the thesis alone, below it the two chuyên đề.
    gpa(2.8);
    expect(thesisChoice(built())).toMatchObject({ options: [{ code: "71ITGR40206" }], thesis: { thesis: { code: "71ITGR40206" }, topics: [], way: "thesis", reason: "điểm TB tích lũy 2,80, từ 2,80 trở lên" } });
    expect(buildRoadmapInput(built()).user).toContain("hệ thống đề xuất làm 71ITGR40206 Đồ án Tốt nghiệp (6 TC) vì điểm TB tích lũy 2,80, từ 2,80 trở lên; không đề xuất Chuyên đề tốt nghiệp");
    gpa(2.45);
    expect(thesisChoice(built())).toMatchObject({ options: [{ code: "71ITGR40203" }, { code: "71ITGR40303" }], thesis: { thesis: null, way: "replacement" } });
    expect(buildRoadmapInput(built()).user).toContain("hệ thống đề xuất học cả 71ITGR40203 Chuyên đề Tốt nghiệp 1 (3 TC) và 71ITGR40303 Chuyên đề Tốt nghiệp 2 (3 TC) thay cho Đồ án tốt nghiệp vì điểm TB tích lũy 2,45, dưới 2,80");
    gpa(3.4);
    // With Chuyên đề 1 passed, only Chuyên đề 2 is left, whatever the GPA.
    result.progress = { ...result.progress!, next: [group("passed")] };
    const started = thesisChoice(buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW)));
    expect(started!.options.map((item) => item.code)).toEqual(["71ITGR40303"]);
    expect(started!.thesis).toMatchObject({ thesis: null, topics: [{ code: "71ITGR40303" }] });
  });

  it("never proposes another specialty's course, not even one the student took (roadmap-v12, user 2026-11-03)", () => {
    const result = syntheticRoadmapResult();
    const own = result.student.specialty;
    const other = own === "CNDL" ? "CNPM" : "CNDL";
    // A late course, a choice option and a failed course of another specialty (the engine counts the attempted one as applicable).
    result.courses.push({ ...result.courses[0]!, code: "71ITDS30103", name: "Các nền tảng phát triển phần mềm", specialty: other, state: "not_taken", letter: null, score10: null, applicable: false, conditionOnly: false },
      { ...result.courses[0]!, code: "71ITDS30203", name: "Môn khác chuyên ngành đã rớt", specialty: other, state: "failed", letter: "F", score10: 2.5, applicable: true, conditionOnly: false },
      { ...result.courses[0]!, code: "71ITDS30303", name: "Môn tự chọn khác chuyên ngành", specialty: other, state: "not_taken", letter: null, score10: null, applicable: false, conditionOnly: false });
    result.progress = { ...result.progress!,
      late: [...result.progress!.late, { kind: "course", code: "71ITDS30103", name: "Các nền tảng phát triển phần mềm", credits: 3, termCode: "HK243", state: "not_taken" }],
      next: [...result.progress!.next, { kind: "choice", label: "Nhóm tự chọn TC310: chọn 3 tín chỉ", required: 3, unit: "credit", remaining: 3,
        options: [{ code: "71ITDS30303", name: "Môn tự chọn khác chuyên ngành", credits: 3, state: "not_taken" }, { code: "71ITSE30903", name: "Phát triển ứng dụng đa nền tảng", credits: 3, state: "not_taken" }] }] };
    const built = buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW));
    const codes = [...built.study.map((item) => item.code), ...built.improve.map((item) => item.code), ...built.choices.flatMap((choice) => choice.options.map((item) => item.code))];
    expect(codes).not.toContain("71ITDS30103");
    expect(codes).not.toContain("71ITDS30203");
    expect(codes).not.toContain("71ITDS30303");
    expect(built.choices.find((choice) => choice.label.includes("TC310"))!.options.map((item) => item.code)).toEqual(["71ITSE30903"]);
  });

  it("never offers an English course for improvement, but still a failed one for a retake", () => {
    const result = syntheticRoadmapResult();
    result.courses.push({ ...result.courses[0]!, code: "71ENG310033", name: "Anh văn 3 (AV3)", state: "passed", letter: "D", score10: 5.4, applicable: true, conditionOnly: false },
      { ...result.courses[0]!, code: "71ENG510053", name: "Anh văn 5 (AV5)", state: "failed", letter: "F", score10: 3.1, applicable: true, conditionOnly: false });
    const improve = buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW)).improve;
    expect(improve.map((item) => item.code)).toContain("71ENG510053");
    expect(improve.map((item) => item.code)).not.toContain("71ENG310033");
  });

  it("offers every met career skill one level up when no gap is left", () => {
    const result = syntheticRoadmapResult();
    result.career = { ...result.career!, requirements: result.career!.requirements.map((item) => ({ ...item, status: "met" as const, levelLabel: "Giỏi" })) };
    result.selfStudy = [];
    result.skillPlans = [];
    const skills = buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW)).skills;
    expect(skills.length).toBe(result.career!.requirements.length);
    expect(skills.every((skill) => skill.kind === "deepen" && skill.statusLabel === "Đã đạt mức Giỏi: nâng lên mức Xuất sắc")).toBe(true);
  });

  it("takes the term being studied from the transcript, not from the failed attempt of a course being retaken", () => {
    // Stress test 2026-10-30: a retake keeps the term of its failed attempt (here HK232) in result.courses.
    const result = syntheticRoadmapResult();
    result.courses.push({ ...result.courses[0]!, code: "71ITSE30103", name: "Kỹ thuật lập trình", state: "in_progress", term: "HK232", applicable: true, conditionOnly: false });
    result.transcript = { ...result.transcript!, studyTerm: "HK251" };
    expect(buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW)).runningTerm).toBe("HK251");
    // A result stored before comp-calc-v13 has no studyTerm: the latest term of the courses being studied.
    result.transcript = { ...result.transcript!, studyTerm: undefined };
    expect(buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW)).runningTerm).toBe("HK251");
  });

  it("reads an assessment before comp-calc-v13, whose next term was the term being studied", () => {
    const result = syntheticRoadmapResult();
    result.progress = { ...result.progress!, currentTerm: "HK243", nextTerm: "HK251", next: [
      { kind: "course", code: "71ITSE41203", name: "Kiểm thử phần mềm", credits: 3, state: "in_progress" },
      { kind: "course", code: "71ITSE30803", name: "Lập trình Web nâng cao với framework", credits: 3, state: "not_taken" },
    ] };
    const old = buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW));
    // Planned for HK251, not registered: late. The plan's mandatory course of HK252 is next.
    expect(old.study.map((item) => [item.code, item.source, item.termCode])).toEqual([
      ["71ITSE41203", "running", "HK251"], ["71ITIS30203", "late", "HK243"], ["71ITSE30803", "late", "HK251"], ["71ITIN40304", "next", "HK252"],
    ]);
    expect([old.runningTerm, old.nextTerm]).toEqual(["HK251", "HK252"]);
  });

  it("lists F/VT as học lại and D, D+ as học cải thiện, retakes first, then the lowest grade", () => {
    expect(facts.improve.map((item) => [item.code, item.letter, item.action])).toEqual([
      ["71ITBS10203", "F", "retake"], ["71ITSE30603", "D", "improve"], ["71ITAI40103", "D+", "improve"],
    ]);
    // GDTC/GDQP never count, and a course to improve is never listed again as a course to take.
    const codes = new Set(facts.study.map((item) => item.code));
    expect(facts.improve.some((item) => codes.has(item.code))).toBe(false);
  });

  it("keys the career skills S01…: gaps and self-study first, met skills to deepen last", () => {
    expect(facts.skills.map((skill) => [skill.key, skill.name, skill.kind])).toEqual([
      ["S01", "C#/C++", "self_study"], ["S02", "Docker", "self_study"], ["S03", "Phát triển web", "deepen"], ["S04", "Lập trình cơ bản", "deepen"],
    ]);
    expect(facts.skills[0]!.statusLabel).toBe("CTĐT chưa có học phần đo kỹ năng này");
    expect(facts.skills[2]!.statusLabel).toBe("Đã đạt, mức Khá: có thể nâng cao");
  });

  it("reads a stored result of an older calc version that lacks lists", () => {
    const result = syntheticRoadmapResult() as unknown as Record<string, unknown>;
    for (const key of ["selfStudy", "skillPlans", "courseSuggestions", "progress"]) delete result[key];
    const old = buildRoadmapFacts(ROADMAP_ASSESSMENT, result as never, roadmapWindow(ROADMAP_NOW));
    expect(old.study.map((item) => item.source)).toEqual(["running"]);
    expect(old.skills.map((skill) => skill.kind)).toEqual(["gap", "gap"]);
  });
});

describe("buildRoadmapInput", () => {
  const facts = syntheticRoadmapFacts();
  const input = buildRoadmapInput(facts);

  it("asks Gemma with thinking and sends only course, grade, cohort, specialty, career and computed facts", () => {
    expect(input.promptVersion).toBe(ROADMAP_PROMPT_VERSION);
    expect(input.think).toBe(ROADMAP_THINK);
    expect(input.options).toEqual(ROADMAP_OPTIONS);
    expect(input.options.num_ctx).toBe(16384);
    expect(input.user).toContain("Học kỳ của lộ trình: HK2 2026–2027 (ngày dự kiến theo lịch của trường).");
    expect(input.user).toContain("Từ ngày 21/12/2026 đến ngày 04/04/2027.");
    expect(input.user).toContain("Tháng 2: từ 21/01/2027 đến 20/02/2027");
    expect(input.user).toContain("- 71ITBS10203 Cơ sở lập trình (3 TC): điểm 3,2 (F) — học lại; giúp kỹ năng nghề: Lập trình cơ bản");
    expect(input.user).toContain("Theo kế hoạch HK2 2025–2026 (học kỳ tiếp theo, cần chuẩn bị đăng ký):");
    expect(input.user).toContain("[3. HỌC PHẦN ĐANG HỌC] (HK1 2025–2026, chưa có kết quả)");
    expect(input.user).toContain("Học kỳ đang học: HK1 2025–2026; học kỳ tiếp theo theo kế hoạch đào tạo: HK2 2025–2026.");
    // roadmap-v9: the terms it may name, and no term already past (a late course says when to register instead).
    expect(input.user).toContain("Học kỳ được nhắc tới (chỉ dùng các học kỳ này): HK1 2025–2026 (đang học), HK2 2025–2026, HK3 2025–2026, HK1 2026–2027, HK2 2026–2027 (học kỳ của lộ trình).");
    expect(input.user).toContain("Trễ so với kế hoạch (đăng ký sớm nhất ở HK2 2026–2027):\n- 71ITIS30203 Hệ quản trị cơ sở dữ liệu (3 TC)\n");
    expect(input.user).toContain("(trễ so với kế hoạch; đăng ký sớm nhất ở HK2 2026–2027): còn thiếu 3 TC");
    expect(input.user).toContain("[5. HỌC PHẦN CẦN HỌC LẠI VÀ HỌC CẢI THIỆN] (đăng ký học lại, học cải thiện sớm nhất ở HK2 2026–2027)");
    expect(input.user).not.toContain("HK3 2024–2025");
    expect(input.user).not.toMatch(/học kỳ \d năm học|HK\d{3}/);
    expect(input.keys).toMatchObject({ terms: ["HK251", "HK252", "HK253", "HK261", "HK262"], internshipDone: false, windowTerm: "HK262" });
    expect(input.keys.unproven).toEqual(["C#/C++", "Docker", "thực tập"]);
    // The pace to graduate on time, with the numbers the advice may repeat.
    expect(input.user).toMatch(/Tín chỉ tích lũy: [\d,]+\/126 \(còn thiếu [\d,]+ TC\)/);
    expect(input.user).toContain("Học kỳ còn lại theo chương trình sau học kỳ đang học:");
    expect(input.user).toMatch(/Để tốt nghiệp đúng hạn cần trung bình khoảng \d+ TC mỗi học kỳ còn lại\./);
    expect(input.user).toContain("- [S01] C#/C++ (Ưu tiên): CTĐT chưa có học phần đo kỹ năng này — cần tự học");
    for (const section of ["[1. HỒ SƠ]", "[2. THỜI GIAN CỦA LỘ TRÌNH]", "[3. HỌC PHẦN ĐANG HỌC]", "[4. HỌC PHẦN CẦN HỌC THEO KẾ HOẠCH ĐÀO TẠO]",
      "[5. HỌC PHẦN CẦN HỌC LẠI VÀ HỌC CẢI THIỆN]", "[6. KỸ NĂNG NGHỀ CẦN BỔ SUNG]", "[7. TIẾN ĐỘ XÉT TỐT NGHIỆP]"]) expect(input.user).toContain(section);
    // No identity, interest or file field ever reaches the model.
    expect(`${input.system}\n${input.user}`).not.toMatch(/@|mã số sinh viên:|Họ tên|Lớp:|sở thích:|\.pdf/i);
    expect(input.user.length).toBeLessThan(8000);
  });

  it("offers exactly the codes and keys of the facts in the schema, in the grammar-safe subset", () => {
    const schema = input.schema as { properties: Record<string, { minItems: number; maxItems: number; items: { properties: Record<string, { enum?: string[] }> } }> };
    expect(schema.properties.study!.items.properties.code!.enum).toEqual(["71ITSE41203", "71ITIS30203", "71ITIN40304", "71ITSE30803", "71ITSE30903"]);
    expect(schema.properties.improve!.items.properties.code!.enum).toEqual(["71ITBS10203", "71ITSE30603", "71ITAI40103"]);
    expect(schema.properties.skills!.items.properties.key!.enum).toEqual(["S01", "S02", "S03", "S04"]);
    expect(schema.properties.skills!.maxItems).toBe(ROADMAP_LIMITS.skillsMax);
    expect(schema.properties.months!.items.properties.month!.enum).toEqual(["1", "2", "3", "4"]);
    expect([schema.properties.months!.minItems, schema.properties.months!.maxItems]).toEqual([4, 4]);
    const text = JSON.stringify(input.schema);
    expect(text).not.toMatch(/"(pattern|format|minimum|maximum|uniqueItems|\$ref)"/);
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.type === "object") {
        expect(record.additionalProperties).toBe(false);
        expect(record.required).toEqual(Object.keys(record.properties as object));
      }
      for (const value of Object.values(record)) walk(value);
    };
    walk(input.schema);
  });

  it("gives an empty list the NONE placeholder and no room", () => {
    const empty = buildRoadmapInput({ ...facts, improve: [], skills: [] });
    const schema = empty.schema as { properties: Record<string, { minItems: number; maxItems: number; items: { properties: Record<string, { enum?: string[] }> } }> };
    expect(schema.properties.improve!.items.properties.code!.enum).toEqual([NONE]);
    expect([schema.properties.improve!.maxItems, schema.properties.skills!.minItems, schema.properties.skills!.maxItems]).toEqual([0, 0, 0]);
    expect(empty.user).toContain("[5. HỌC PHẦN CẦN HỌC LẠI VÀ HỌC CẢI THIỆN]\nKhông có.");
  });
});

describe("roadmapTerms", () => {
  it("names the terms from the one being studied to the plan's last, never one already past", () => {
    const facts = syntheticRoadmapFacts();
    expect(roadmapTerms(facts)).toEqual(["HK251", "HK252", "HK253", "HK261", "HK262"]);
    // Nothing being studied: from the roadmap's own term.
    expect(roadmapTerms({ ...facts, runningTerm: null, nextTerm: "HK243", pace: { ...facts.pace, termsLeft: ["HK243", "HK263"] } })).toEqual(["HK262", "HK263"]);
    expect(roadmapTerms({ ...facts, runningTerm: null, window: { ...facts.window, term: undefined } })).toEqual([]);
  });
});

describe("roadmapBasis", () => {
  const row = syntheticSurveyRow();
  const survey = surveyFacts({ answers: row.answers, interestTech: row.interest_tech,
    interestHobbies: row.interest_hobbies, hasAchievements: row.has_achievements, achievements: row.achievements });

  it("keeps what the student says apart from what the system has on record", () => {
    const basis = roadmapBasis(syntheticRoadmapFacts(), survey);
    expect(basis.selfReported).toEqual([
      "Công nghệ bạn chọn là thế mạnh: Web front-end (HTML, CSS, JavaScript, React); Trí tuệ nhân tạo, học máy",
      "Đi làm thêm: Có, liên quan CNTT", "Kinh nghiệm dẫn dắt nhóm: 1 dự án", "Dự án ngoài môn học: 1–2 dự án", "Tiếng Anh chuyên ngành: Đọc hiểu tốt",
      "Thành tích bạn liệt kê: 2 mục",
    ]);
    expect(basis.recorded).toEqual([
      "Chưa có minh chứng (chưa có điểm từ học phần nào): Web front-end, HTML, CSS, JavaScript, React, Trí tuệ nhân tạo, học máy",
      "Học phần thực tập trong chương trình: Đồ án thực tập (chưa học)",
      "Dự án ngoài môn học, dẫn dắt nhóm, đi làm thêm, tiếng Anh và thành tích: hệ thống không có dữ liệu để kiểm chứng.",
    ]);
    expect(basis.unproven).toEqual(expect.arrayContaining(["C#/C++", "Docker", "thực tập", "React", "JavaScript"]));
    expect(basis.internshipDone).toBe(false);
  });

  it("counts a technology as shown from the Khá threshold up, and a passed internship as on record", () => {
    const facts = syntheticRoadmapFacts();
    const recorded = {
      skills: [{ name: "JavaScript", score: 70, levelLabel: "Khá" }, { name: "React", score: 55.4, levelLabel: "Trung bình" }, { name: "HTML/CSS", score: 81, levelLabel: "Giỏi" }],
      internship: [{ name: "Đồ án thực tập", state: "passed" as const }],
    };
    const basis = roadmapBasis({ ...facts, recorded }, survey);
    expect(basis.recorded.slice(0, 4)).toEqual([
      "Có điểm từ bảng điểm: HTML (mức Giỏi, 81 điểm); CSS (mức Giỏi, 81 điểm); JavaScript (mức Khá, 70 điểm)",
      "Điểm còn dưới mức Khá: React (mức Trung bình, 55 điểm)",
      "Chưa có minh chứng (chưa có điểm từ học phần nào): Web front-end, Trí tuệ nhân tạo, học máy",
      "Học phần thực tập trong chương trình: Đồ án thực tập (đã đạt)",
    ]);
    expect(basis.unproven).toContain("React");
    expect(basis.unproven).not.toContain("JavaScript");
    expect(basis.unproven).not.toContain("thực tập");
    expect(basis.internshipDone).toBe(true);
  });
});

describe("holding the output to the data (roadmap-v9)", () => {
  it("writes every term the way the pages do", () => {
    expect(normalizeTermNames("Đăng ký ở HK262 hoặc học kỳ 3 năm học 2026-2027, rồi HK1 · 2027–2028; học kì 2 năm học 2025 – 2026."))
      .toBe("Đăng ký ở HK2 2026–2027 hoặc HK3 2026–2027, rồi HK1 2027–2028; HK2 2025–2026.");
    expect(normalizeTermNames("Học kỳ 2 của năm 2026 và HK2 2026–2028.")).toBe("Học kỳ 2 của năm 2026 và HK2 2026–2028.");
  });

  it("finds praise and experience stated as fact for what only the student said", () => {
    const context = { unproven: ["React", "C#/C++", "thực tập"], internshipDone: false };
    // The user's example (2026-10-30).
    expect(unattributedClaim("Bạn có nền tảng vững chắc về React, có kinh nghiệm thực tập.", context)).toBe("React");
    expect(unattributedClaim("Với kinh nghiệm thực tập, bạn nên ứng tuyển sớm.", context)).toBe("thực tập");
    expect(unattributedClaim("React là thế mạnh của bạn.", context)).toBe("React");
    expect(unattributedClaim("Bạn đã thành thạo C++ nên hãy làm dự án.", context)).toBe("C#/C++");
    expect(unattributedClaim("Bạn đã làm dự án web bán hàng.", context)).toBe("đã làm dự án");
    // Given as the student's word, a goal, advice, a negation or a skill on record: fine.
    for (const sentence of [
      "Bạn tự đánh giá thành thạo React, hãy làm một sản phẩm nhỏ để chứng minh.",
      "Bạn cho biết đang thực tập, hãy ghi lại việc đã làm.",
      "Hãy làm một dự án React để có nền tảng vững chắc.",
      "Nắm vững React giúp bạn làm giao diện nhanh hơn.",
      "Bạn chưa có kinh nghiệm thực tập nên hãy học tốt Đồ án thực tập.",
      "Bạn có nền tảng vững về Phát triển web.",
      "Mục tiêu cuối học kỳ là thành thạo React.",
    ]) expect(unattributedClaim(sentence, context)).toBeNull();
    expect(unattributedClaim("Bạn đã thực tập tại một công ty phần mềm.", { ...context, internshipDone: true })).toBeNull();
  });

  const row = syntheticSurveyRow();
  const survey = surveyFacts({ answers: row.answers, interestTech: row.interest_tech,
    interestHobbies: row.interest_hobbies, hasAchievements: row.has_achievements, achievements: row.achievements });
  const context = roadmapContextFromAiInput(buildRoadmapInput(syntheticRoadmapFacts(), survey))!;
  const output = (extra: Record<string, unknown> = {}) => ({
    summary: "Học kỳ tới bạn nên hoàn thành tốt Kiểm thử phần mềm và học lại Cơ sở lập trình.",
    study: [{ code: "71ITIS30203", advice: "Đăng ký ở HK262 vì môn này đã trễ so với kế hoạch." }],
    improve: [{ code: "71ITBS10203", advice: "Học lại ngay để không ảnh hưởng các môn sau." }],
    skills: [{ key: "S02", why: "Docker giúp bạn triển khai ứng dụng.", steps: ["Cài Docker và chạy thử một container."], outcome: "Thành thạo Docker cuối học kỳ." }],
    months: [{ month: "1", focus: "Hoàn thành tốt các môn đang học.", tasks: ["Ôn tập Kiểm thử phần mềm mỗi tuần."] }],
    ...extra,
  });

  it("keeps what holds to the data, its terms written one way", () => {
    const checked = validateRoadmapOutput(output(), context);
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.issues).toEqual([]);
    expect(checked.output.study).toEqual([{ code: "71ITIS30203", advice: "Đăng ký ở HK2 2026–2027 vì môn này đã trễ so với kế hoạch." }]);
    expect(checked.output.skills[0]!.outcome).toBe("Thành thạo Docker cuối học kỳ.");
  });

  it("drops each sentence naming a past term or praising what only the student said, and reports it", () => {
    const checked = validateRoadmapOutput(output({
      summary: "Bạn có nền tảng vững chắc về React, có kinh nghiệm thực tập. Học kỳ tới hãy học lại Cơ sở lập trình.",
      improve: [{ code: "71ITBS10203", advice: "Học lại ở HK3 2024–2025." }, { code: "71ITSE30603", advice: "Học cải thiện ở HK2 2026–2027." }],
      skills: [{ key: "S02", why: "Bạn đã thành thạo Docker nên chỉ cần ôn lại.", steps: ["Ôn lại Docker."], outcome: "Dùng Docker." }],
    }), context);
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.output.summary).toBe("Học kỳ tới hãy học lại Cơ sở lập trình.");
    expect(checked.output.improve).toEqual([{ code: "71ITSE30603", advice: "Học cải thiện ở HK2 2026–2027." }]);
    expect(checked.output.skills).toEqual([]);
    expect(checked.issues).toHaveLength(3);
    expect(checked.issues[0]).toContain("(React)");
    expect(checked.issues[1]).toContain("HK3 2024–2025");
    expect(checked.issues[2]).toContain("(Docker)");
  });

  it("drops a sentence that calls a course not passed 'cải thiện' without 'học lại' (roadmap-v11, user 2026-10-31)", () => {
    expect([...context.retakes]).toEqual([["71ITBS10203", "Cơ sở lập trình"]]);
    const checked = validateRoadmapOutput(output({
      advice: ["Hãy cải thiện môn Cơ sở lập trình ngay trong HK2 2026–2027.", "Đăng ký học lại Cơ sở lập trình để cải thiện điểm trung bình."],
      improve: [{ code: "71ITBS10203", advice: "Cần cải thiện môn này sớm. Ôn lại kiến thức nền." }, { code: "71ITSE30603", advice: "Học cải thiện để nâng điểm." }],
    }), context);
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.output.advice).toEqual(["Đăng ký học lại Cơ sở lập trình để cải thiện điểm trung bình."]);
    expect(checked.output.improve).toEqual([{ code: "71ITBS10203", advice: "Ôn lại kiến thức nền." }, { code: "71ITSE30603", advice: "Học cải thiện để nâng điểm." }]);
    expect(checked.issues).toHaveLength(2);
    for (const issue of checked.issues) expect(issue).toMatch(/^Gọi học phần chưa đạt Cơ sở lập trình là "cải thiện"; học phần chưa đạt phải gọi là "học lại"/);
  });

  it("writes a plain summary when every sentence of the model's had to go", () => {
    const checked = validateRoadmapOutput(output({ summary: "Bạn có nền tảng vững chắc về React. Hãy học lại ở HK1 2024–2025." }), context);
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.output.summary).toBe("Lộ trình HK2 2026–2027 gồm các học phần cần học, học phần cần học lại hoặc học cải thiện và kỹ năng nên bổ sung bên dưới. Hãy trao đổi với cố vấn học tập trước khi đăng ký học phần.");
    expect(checked.issues).toHaveLength(2);
  });

  it("leaves an input made before roadmap-v9 as it was checked", () => {
    const old = { ...context, terms: null };
    const checked = validateRoadmapOutput(output({ summary: "Bạn có nền tảng vững chắc về React." }), old);
    if (!checked.ok) throw new Error("expected ok");
    expect([checked.output.summary, checked.issues]).toEqual(["Bạn có nền tảng vững chắc về React.", []]);
  });
});

describe("validateRoadmapOutput", () => {
  const facts = syntheticRoadmapFacts();
  const context = roadmapContextFromAiInput(buildRoadmapInput(facts))!;
  const output = (extra: Record<string, unknown> = {}) => ({
    summary: "Ba tháng tới bạn nên hoàn thành tốt Kiểm thử phần mềm và học lại Cơ sở lập trình.",
    study: [{ code: "71ITIS30203", advice: "Đăng ký sớm vì môn này đã trễ so với kế hoạch." }, { code: "71ITSE30803", advice: "Chọn môn này để nâng kỹ năng web." }],
    improve: [{ code: "71ITBS10203", advice: "Học lại ngay để không ảnh hưởng các môn sau." }],
    skills: [{ key: "S02", why: "Docker giúp bạn triển khai ứng dụng.", steps: ["Cài Docker và chạy thử một container.", "Đóng gói ứng dụng web của bạn."], outcome: "Tự đóng gói và chạy được một ứng dụng." }],
    months: [
      { month: "1", focus: "Hoàn thành tốt các môn đang học.", tasks: ["Ôn tập Kiểm thử phần mềm mỗi tuần."] },
      { month: "2", focus: "Học lại và cải thiện điểm.", tasks: ["Đăng ký học lại Cơ sở lập trình."] },
      { month: "3", focus: "Tự học Docker.", tasks: ["Làm một dự án nhỏ với Docker."] },
    ],
    ...extra,
  });

  it("stores a clean roadmap as it is", () => {
    const checked = validateRoadmapOutput(output(), context);
    expect(checked).toMatchObject({ ok: true, dropped: 0 });
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.output.months.map((month) => month.month)).toEqual([1, 2, 3]);
    expect(checked.output.skills[0]).toEqual({ key: "S02", why: "Docker giúp bạn triển khai ứng dụng.", steps: ["Cài Docker và chạy thử một container.", "Đóng gói ứng dụng web của bạn."], outcome: "Tự đóng gói và chạy được một ứng dụng." });
  });

  it("drops items with an unknown code, a link, an invented number, a section number or an unknown key, and repeats", () => {
    const checked = validateRoadmapOutput(output({
      study: [
        { code: "71ITIS30203", advice: "Đăng ký sớm." }, { code: "71ITIS30203", advice: "Lặp lại." }, { code: "71XXXX99999", advice: "Không có." },
        { code: "71ITIN40304", advice: "Xem https://example.com để biết thêm." }, { code: "71ITSE41203", advice: "Học 17 giờ mỗi tuần." },
        { code: "71ITSE30903", advice: "Như mục [4] đã nêu." },
      ],
      skills: [
        { key: "S09", why: "Không có.", steps: ["x"], outcome: "x" },
        { key: "S01", why: "S01 cần cho nghề, cùng S07.", steps: ["Ôn lại cú pháp."], outcome: "Viết được chương trình nhỏ." },
        { key: "S03", why: "S03 giúp bạn làm web.", steps: ["Làm trang web cá nhân.", "Đọc tại www.example.com"], outcome: "Có một trang web." },
      ],
    }), context);
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.output.study).toEqual([{ code: "71ITIS30203", advice: "Đăng ký sớm." }]);
    expect(checked.output.skills).toEqual([{ key: "S03", why: "Phát triển web giúp bạn làm web.", steps: ["Làm trang web cá nhân."], outcome: "Có một trang web." }]);
    expect(checked.dropped).toBe(7);
  });

  it("keeps numbers and course codes of the data block, and the term codes it writes in words", () => {
    const checked = validateRoadmapOutput(output({
      study: [{ code: "71ITIN40304", advice: "Đồ án thực tập (4 TC, 71ITIN40304) theo kế hoạch HK252, đăng ký trước 21/12/2026." }],
    }), context);
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.output.study).toHaveLength(1);
  });

  it("writes course codes of the data block as names, and still drops an unknown code", () => {
    const names = new Map([["71ITIN40304", "Đồ án thực tập"], ["71ITBS10203", "Cơ sở lập trình"]]);
    expect(cleanCourseCodes("Hoàn thành Đồ án thực tập (71ITIN40304) sớm.", names)).toBe("Hoàn thành Đồ án thực tập sớm.");
    expect(cleanCourseCodes("Đăng ký đồ án thực tập (71ITIN40304, 4 TC).", names)).toBe("Đăng ký đồ án thực tập (4 TC).");
    expect(cleanCourseCodes("Môn Đồ án thực tập (4 TC, 71ITIN40304) và 71ITBS10203.", names)).toBe("Môn Đồ án thực tập (4 TC) và Cơ sở lập trình.");
    expect(cleanCourseCodes("71ITBS10203 - Cơ sở lập trình: học lại (71ITBS10203).", names)).toBe("Cơ sở lập trình: học lại.");
    expect(cleanCourseCodes("Ưu tiên học lại 71ITBS10203 Cơ sở lập trình, rồi Đồ án thực tập 71ITIN40304.", names))
      .toBe("Ưu tiên học lại Cơ sở lập trình, rồi Đồ án thực tập.");
    expect(cleanCourseCodes("Học 71XXXX99999.", names)).toBe("Học 71XXXX99999.");
    const checked = validateRoadmapOutput(output({
      summary: "Hãy học lại Cơ sở lập trình (71ITBS10203) và đăng ký 71ITIN40304.",
      study: [{ code: "71ITIN40304", advice: "Đăng ký 71XXXX99999 trước." }, { code: "71ITIS30203", advice: "Học cùng Cơ sở lập trình (71ITBS10203)." }],
    }), context);
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.output.summary).toBe("Hãy học lại Cơ sở lập trình và đăng ký Đồ án thực tập.");
    expect(checked.output.study).toEqual([{ code: "71ITIS30203", advice: "Học cùng Cơ sở lập trình." }]);
  });

  it("keeps a month once, drops one without a usable task and keeps the outcome-less skill", () => {
    const checked = validateRoadmapOutput(output({
      months: [{ month: "2", focus: "Tập trung.", tasks: ["Học lại Cơ sở lập trình."] }, { month: "2", focus: "Lặp.", tasks: ["Lặp."] },
        { month: "1", focus: "Bắt đầu.", tasks: ["Xem http://x.vn"] }, { month: "3", focus: "Liên hệ a@b.vn", tasks: ["Tự học Docker."] }],
      skills: [{ key: "S02", why: "Cần cho nghề.", steps: ["Cài Docker."], outcome: "Xem www.docker.com" }],
    }), context);
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.output.months).toEqual([{ month: 2, focus: "Tập trung.", tasks: ["Học lại Cơ sở lập trình."] }, { month: 3, focus: null, tasks: ["Tự học Docker."] }]);
    expect(checked.output.skills).toEqual([{ key: "S02", why: "Cần cho nghề.", steps: ["Cài Docker."], outcome: null }]);
  });

  it("keeps the key advice points it can check and the first way of the thesis group", () => {
    const thesisContext = { ...context, courses: new Set([...context.courses, "71ITGR40206", "71ITGR40203", "71ITGR40303"]),
      thesis: [{ thesis: "71ITGR40206", topics: ["71ITGR40203", "71ITGR40303"] }] };
    const checked = validateRoadmapOutput(output({
      advice: ["Bạn còn thiếu tín chỉ, hãy đăng ký đủ mỗi học kỳ.", "Xem https://example.com", "Ôn tập Cơ sở lập trình (71ITBS10203) để học lại."],
      study: [{ code: "71ITGR40203", advice: "Học Chuyên đề Tốt nghiệp 1." }, { code: "71ITGR40206", advice: "Làm đồ án." }, { code: "71ITGR40303", advice: "Học Chuyên đề Tốt nghiệp 2." }],
    }), thesisContext);
    if (!checked.ok) throw new Error("expected ok");
    expect(checked.output.advice).toEqual(["Bạn còn thiếu tín chỉ, hãy đăng ký đủ mỗi học kỳ.", "Ôn tập Cơ sở lập trình để học lại."]);
    expect(checked.output.study.map((item) => item.code)).toEqual(["71ITGR40203", "71ITGR40303"]);
  });

  it("fails on a wrong shape, an unusable summary or when nothing is left", () => {
    expect(validateRoadmapOutput({ summary: "x" }, context)).toMatchObject({ ok: false, reason: "schema" });
    expect(validateRoadmapOutput(output({ extra: 1 }), context)).toMatchObject({ ok: false, reason: "schema" });
    expect(validateRoadmapOutput(output({ summary: "Xem tại https://example.com" }), context)).toMatchObject({ ok: false, reason: "summary" });
    expect(validateRoadmapOutput(output({ study: [], improve: [], skills: [], months: [] }), context)).toMatchObject({ ok: false, reason: "empty" });
    expect(roadmapContextFromAiInput({ user: "x", keys: { courses: [], improve: [], skills: [] } })).toBeNull();
    expect(roadmapContextFromAiInput(null)).toBeNull();
  });
});

describe("presentRoadmap", () => {
  const facts = syntheticRoadmapFacts();
  const row = (extra: Partial<RoadmapRow> = {}): RoadmapRow => ({
    id: "44444444-4444-4444-8444-444444444444", assessmentId: ROADMAP_ASSESSMENT, status: "completed", errorCode: null,
    createdAt: new Date("2026-10-24T03:00:00Z"), completedAt: new Date("2026-10-24T03:02:00Z"), model: "gemma4:e4b", facts, recent: false,
    output: {
      summary: "Tóm tắt.",
      study: [{ code: "71ITSE30803", advice: "Chọn môn này." }, { code: "71ITIS30203", advice: "Đăng ký sớm." }],
      improve: [{ code: "71ITAI40103", advice: "Học cải thiện." }],
      skills: [{ key: "S02", why: "Cần cho nghề.", steps: ["Cài Docker."], outcome: null }],
      months: [{ month: 2, focus: "Tập trung.", tasks: ["Học lại."] }],
    },
    ...extra,
  });

  it("puts what the AI picked first, in its order, with its advice, then the other facts", () => {
    const view = presentRoadmap(row(), "2026-10-25");
    expect(view.study.map((item) => [item.code, item.source, item.advice])).toEqual([
      ["71ITSE30803", "choice", "Chọn môn này."], ["71ITIS30203", "late", "Đăng ký sớm."],
      ["71ITSE41203", "running", null], ["71ITIN40304", "next", null],
    ]);
    expect(view.study[0]!.choiceLabel).toBe("Nhóm tự chọn TC309: chọn 6 tín chỉ");
    expect(view.improve.map((item) => [item.code, item.advice])).toEqual([["71ITAI40103", "Học cải thiện."], ["71ITBS10203", null], ["71ITSE30603", null]]);
    expect(view.skills.map((skill) => [skill.key, skill.picked])).toEqual([["S02", true], ["S01", false], ["S03", false], ["S04", false]]);
    expect(view.skills[0]).not.toHaveProperty("score");
    expect(view.months.map((month) => [month.month, month.start, month.focus, month.tasks])).toEqual([
      [1, "2026-12-21", null, []], [2, "2027-01-21", "Tập trung.", ["Học lại."]], [3, "2027-02-21", null, []], [4, "2027-03-21", null, []],
    ]);
    expect([view.summary, view.ended, view.createdAt]).toEqual(["Tóm tắt.", false, "2026-10-24T03:00:00.000Z"]);
  });

  it("shows only the facts until the AI is done, and marks a window that has ended", () => {
    const view = presentRoadmap(row({ status: "processing", completedAt: null }), "2027-04-05");
    expect(view.summary).toBeNull();
    expect(view.study.every((item) => item.advice === null)).toBe(true);
    expect(view.skills.every((skill) => !skill.picked)).toBe(true);
    expect(view.ended).toBe(true);
  });
});
