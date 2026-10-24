import { describe, expect, it } from "vitest";
import { buildRoadmapFacts } from "./facts.js";
import { presentRoadmap } from "./present.js";
import { buildRoadmapInput, ROADMAP_OPTIONS, ROADMAP_PROMPT_VERSION, ROADMAP_THINK } from "./prompt.js";
import { NONE, ROADMAP_LIMITS } from "./schema.js";
import { ROADMAP_ASSESSMENT, ROADMAP_NOW, syntheticRoadmapFacts, syntheticRoadmapResult } from "./test-fixture.js";
import { cleanCourseCodes, roadmapContextFromAiInput, validateRoadmapOutput } from "./validate.js";
import { dateText, roadmapWindow } from "./window.js";
import type { RoadmapRow } from "./jobs.js";

// Synthetic K29 data only (fixtures/synthetic-k29.json plus invented grades); no real student record.

describe("roadmapWindow", () => {
  it("starts on the Vietnam date and covers three calendar months", () => {
    expect(roadmapWindow(ROADMAP_NOW)).toEqual({
      start: "2026-10-24", end: "2027-01-23",
      months: [
        { index: 1, start: "2026-10-24", end: "2026-11-23" },
        { index: 2, start: "2026-11-24", end: "2026-12-23" },
        { index: 3, start: "2026-12-24", end: "2027-01-23" },
      ],
    });
    // 17:30 UTC is already the next day in Vietnam.
    expect(roadmapWindow(new Date("2026-10-23T17:30:00Z")).start).toBe("2026-10-24");
    expect(dateText("2027-01-23")).toBe("23/01/2027");
  });

  it("clamps to the last day of a shorter month", () => {
    const window = roadmapWindow(new Date("2027-01-31T03:00:00Z"));
    expect(window.months.map((month) => [month.start, month.end])).toEqual([
      ["2027-01-31", "2027-02-27"], ["2027-02-28", "2027-03-30"], ["2027-03-31", "2027-04-29"],
    ]);
    expect(window.end).toBe("2027-04-29");
  });
});

describe("buildRoadmapFacts", () => {
  const facts = syntheticRoadmapFacts();

  it("lists the courses to take: running, late, then the term after the running one", () => {
    expect(facts.study.map((item) => [item.code, item.source, item.termCode])).toEqual([
      ["71ITSE41203", "running", null],
      ["71ITIS30203", "late", "HK243"],
      ["71ITIN40304", "following", "HK252"],
    ]);
    expect(facts.study[0]!.careerSkills).toEqual(["Kiểm thử phần mềm"]);
    expect([facts.currentTerm, facts.nextTerm, facts.followingTerm]).toEqual(["HK243", "HK251", "HK252"]);
    // A choice keeps only the options still open.
    expect(facts.choices).toEqual([{
      label: "Nhóm tự chọn TC309: chọn 6 tín chỉ", source: "late", termCode: "HK243", need: "3 TC",
      options: [
        { code: "71ITSE30803", name: "Lập trình Web nâng cao với framework", credits: 3 },
        { code: "71ITSE30903", name: "Phát triển ứng dụng đa nền tảng", credits: 3 },
      ],
    }]);
  });

  it("adds no term after the next one when nothing is running", () => {
    const result = syntheticRoadmapResult();
    const running = result.courses.find((item) => item.state === "in_progress")!;
    Object.assign(running, { state: "not_taken" });
    result.progress = { ...result.progress!, next: [] };
    const quiet = buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW));
    expect(quiet.followingTerm).toBeNull();
    expect(quiet.study.map((item) => item.source)).toEqual(["late"]);
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
    expect(input.user).toContain("Từ ngày 24/10/2026 đến ngày 23/01/2027.");
    expect(input.user).toContain("Tháng 2: từ 24/11/2026 đến 23/12/2026");
    expect(input.user).toContain("- 71ITBS10203 Cơ sở lập trình (3 TC): điểm 3,2 (F) — học lại; giúp kỹ năng nghề: Lập trình cơ bản");
    expect(input.user).toContain("Theo kế hoạch học kỳ 2 năm học 2025–2026 (học kỳ sau, cần chuẩn bị đăng ký):");
    expect(input.user).toContain("- [S01] C#/C++ (Ưu tiên): CTĐT chưa có học phần đo kỹ năng này — cần tự học");
    for (const section of ["[1. HỒ SƠ]", "[2. THỜI GIAN CỦA LỘ TRÌNH]", "[3. HỌC PHẦN ĐANG HỌC]", "[4. HỌC PHẦN CẦN HỌC THEO KẾ HOẠCH ĐÀO TẠO]",
      "[5. HỌC PHẦN CẦN CẢI THIỆN]", "[6. KỸ NĂNG NGHỀ CẦN BỔ SUNG]", "[7. TIẾN ĐỘ XÉT TỐT NGHIỆP]"]) expect(input.user).toContain(section);
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
    expect(schema.properties.months!.items.properties.month!.enum).toEqual(["1", "2", "3"]);
    expect([schema.properties.months!.minItems, schema.properties.months!.maxItems]).toEqual([3, 3]);
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
    expect(empty.user).toContain("[5. HỌC PHẦN CẦN CẢI THIỆN]\nKhông có.");
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
      study: [{ code: "71ITIN40304", advice: "Đồ án thực tập (4 TC, 71ITIN40304) theo kế hoạch HK252, đăng ký trước 23/01/2027." }],
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
      ["71ITSE41203", "running", null], ["71ITIN40304", "following", null],
    ]);
    expect(view.study[0]!.choiceLabel).toBe("Nhóm tự chọn TC309: chọn 6 tín chỉ");
    expect(view.improve.map((item) => [item.code, item.advice])).toEqual([["71ITAI40103", "Học cải thiện."], ["71ITBS10203", null], ["71ITSE30603", null]]);
    expect(view.skills.map((skill) => [skill.key, skill.picked])).toEqual([["S02", true], ["S01", false], ["S03", false], ["S04", false]]);
    expect(view.skills[0]).not.toHaveProperty("score");
    expect(view.months.map((month) => [month.month, month.start, month.focus, month.tasks])).toEqual([
      [1, "2026-10-24", null, []], [2, "2026-11-24", "Tập trung.", ["Học lại."]], [3, "2026-12-24", null, []],
    ]);
    expect([view.summary, view.ended, view.createdAt]).toEqual(["Tóm tắt.", false, "2026-10-24T03:00:00.000Z"]);
  });

  it("shows only the facts until the AI is done, and marks a window that has ended", () => {
    const view = presentRoadmap(row({ status: "processing", completedAt: null }), "2027-01-24");
    expect(view.summary).toBeNull();
    expect(view.study.every((item) => item.advice === null)).toBe(true);
    expect(view.skills.every((skill) => !skill.picked)).toBe(true);
    expect(view.ended).toBe(true);
  });
});
