import { describe, expect, it } from "vitest";
import { courseKey, deriveElectiveGroups, electiveCodeOf } from "./course-state.js";
import { syntheticCurriculum, syntheticPlan, syntheticStandards } from "./fixtures/synthetic-k29.js";
import { electiveQuotas } from "./graduation.js";
import {
  choiceCreditRange, choiceLabel, choiceRule, physicalEducationCourseSlot, physicalEducationGroupsFor, physicalEducationSlot, planProgress, shortfallText,
  type PlanCourseInfo,
} from "./plan-progress.js";
import { classifyCurriculumSpecialty } from "./specialty.js";
import type { CourseState, LateEntry, SpecialtyCode } from "./types.js";

const curriculum = syntheticCurriculum();
const plan = syntheticPlan();
const standards = syntheticStandards();

/** Course map as calculate.ts builds it: applicability from the CTĐT specialty, never the section label. */
function courses(states: Record<string, CourseState>, specialty: SpecialtyCode | null = "CNPM") {
  return new Map<string, PlanCourseInfo>(curriculum.courses.map((course) => {
    const code = courseKey(course.code);
    const state = states[code] ?? "not_taken";
    const kind = classifyCurriculumSpecialty(course.specialty);
    const applicable = kind.kind === "common" || kind.code === specialty || state !== "not_taken";
    return [code, { code, name: course.name, credits: course.credits, state, applicable, electiveCode: electiveCodeOf(course.type) }];
  }));
}

const quotas = electiveQuotas(deriveElectiveGroups(curriculum.courses), standards[0]!.data);
const run = (currentTerm: string | null, states: Record<string, CourseState>, specialty: SpecialtyCode | null = "CNPM", data = plan.data) =>
  planProgress({ plan: data, physicalEducationGroups: plan.physicalEducationGroups, currentTerm, courses: courses(states, specialty), quotas });

const passedThroughHK243: Record<string, CourseState> = {
  "71ITBS10103": "passed", "71ITBS10203": "passed", "71NAD110013": "passed", "71ITSE30103": "passed", "71PEKC10062": "passed",
  "71ITIS30103": "exempt", "71PETT10012": "passed", "71ITSE30503": "passed", "71ITSE30603": "passed", "71ITSE41003": "passed",
  "71ITAI40103": "passed", "71ITIS30303": "passed",
};

describe("section labels (real K29 strings)", () => {
  it("reads k from the folded label, with or without a space", () => {
    expect(choiceRule("Chọn1 trong 3 môn sau")).toEqual({ k: 1, stated: 3, choice: true, informational: false });
    expect(choiceRule("Chọn 1 trong 2 môn sau")).toMatchObject({ k: 1, stated: 2, informational: false });
    expect(choiceRule("Chọn 2 trong 6 HP tự chọn Cơ sở ngành")).toMatchObject({ k: 2, stated: 6, choice: true });
  });

  it("treats sections without k or '(Không tính vào tích lũy)' as reference only", () => {
    expect(choiceRule("Chọn  các môn sau (Không tính vào tích lũy)")).toMatchObject({ k: null, choice: true, informational: true });
    expect(choiceRule("Chọn 1 môn sau (Không tính vào tích lũy)")).toMatchObject({ k: 1, informational: true });
    expect(choiceRule("Chuyên ngành CNPM")).toMatchObject({ choice: false, informational: false });
    expect(choiceRule("Chuyên ngành Trí tuệ Nhân tạo")).toMatchObject({ choice: false });
  });

  it("recognises GDTC placeholders (DGT0010/DGT0020 are not real codes)", () => {
    expect(physicalEducationSlot("GDTC 1")).toBe(1);
    expect(physicalEducationSlot("GDTC2")).toBe(2);
    expect(physicalEducationSlot("Giáo dục thể chất 1")).toBe(1);
    expect(physicalEducationSlot("GDQP1: Đường lối QP và AN của ĐCSVN")).toBeNull();
    expect(physicalEducationGroupsFor(curriculum.courses)).toEqual({ TC002: ["71PEKC10062", "71PESW10042"], TC102: ["71PEBA10052", "71PETT10012"] });
  });

  it("spaces choice labels and says the real number of options (v17)", () => {
    expect(choiceLabel("Chọn1 trong 3 môn sau")).toBe("Chọn 1 trong 3 môn sau");
    expect(choiceLabel("Chọn1 trong 3 môn sau", 1, 3)).toBe("Chọn 1 trong 3 môn sau");
    expect(choiceLabel("Chọn  các môn sau (Không tính vào tích lũy)")).toBe("Chọn các môn sau (Không tính vào tích lũy)");
    // "Chọn 1 trong 4 môn sau" over 3 courses the student can take; k never above the options.
    expect(choiceLabel("Chọn 1 trong 4 môn sau", 1, 3)).toBe("Chọn 1 trong 3 môn sau");
    expect(choiceLabel("Chọn 2 trong 6 HP tự chọn Cơ sở ngành", 2, 5)).toBe("Chọn 2 trong 5 HP tự chọn Cơ sở ngành");
    expect(choiceLabel("Chọn 3 trong 4 môn sau", 2, 2)).toBe("Chọn 2 trong 2 môn sau");
    expect(choiceLabel("Chuyên ngành CNPM", 1, 2)).toBe("Chuyên ngành CNPM");
  });
});

describe("GDTC courses named for their slot (K26–K28, v17)", () => {
  // K26–K28: "Giáo dục thể chất (1)" DGT0010 and "(2)" DGT0020 are mandatory BBKTL courses, not TC002/TC102 electives.
  const k26 = [
    { code: "DGT0010", name: "Giáo dục thể chất (1)", type: "BBKTL", credits: 1 },
    { code: "DGT0020", name: "Giáo dục thể chất (2) (*)", type: "BBKTL", credits: 1 },
  ];
  const groups = physicalEducationGroupsFor(k26);
  const physical = (states: Record<string, CourseState>) => {
    const map = courses(passedThroughHK243);
    for (const course of k26) map.set(course.code, { code: course.code, name: course.name, credits: course.credits, state: states[course.code] ?? "not_taken", applicable: true, electiveCode: null });
    const result = planProgress({ plan: plan.data, physicalEducationGroups: groups, currentTerm: "HK243", courses: map, quotas });
    return result.late.filter((entry) => entry.kind === "physical_education").map((entry) => entry.kind === "physical_education" && [entry.label, entry.required, entry.passed]);
  };

  it("maps the courses to slots 1 and 2", () => {
    expect(groups).toEqual({ TC002: [], TC102: [], GDTC1: ["DGT0010"], GDTC2: ["DGT0020"] });
    expect(["Giáo dục thể chất (1)", "Giáo dục thể chất 2 (*)", "GDTC 1", "Giáo dục quốc phòng 1", "Giáo dục thể chất 12"].map(physicalEducationCourseSlot)).toEqual([1, 2, 1, null, null]);
  });

  it("is no longer late once the course of the slot is passed (K26: DGT0010 passed read 'Đã đạt 0/1')", () => {
    expect(physical({ DGT0010: "passed" })).toEqual([["GDTC 2", 2, 1]]);
    // The slot's own course decides, not the count: (2) passed leaves slot 1 open.
    expect(physical({ DGT0020: "passed" })).toEqual([["GDTC 1", 1, 1]]);
    expect(physical({ DGT0010: "passed", DGT0020: "in_progress" })).toEqual([]);
    // Without the named courses (before v17) both slots were late.
    const map = courses(passedThroughHK243);
    for (const course of k26) map.set(course.code, { code: course.code, name: course.name, credits: course.credits, state: "passed", applicable: true, electiveCode: null });
    const before = planProgress({ plan: plan.data, physicalEducationGroups: { TC002: [], TC102: [] }, currentTerm: "HK243", courses: map, quotas });
    expect(before.late.map((entry) => entry.kind)).toEqual(["physical_education", "physical_education"]);
  });
});

describe("training-plan progress (spec §7.8)", () => {
  it("reports nothing late for an on-track student, even with reference-only sections and TC406 alternatives", () => {
    const result = run("HK253", { ...passedThroughHK243, "71ITSE41203": "passed", "71ITIN40304": "passed", "71ITIS30403": "in_progress" });
    expect(result.late).toEqual([]);
    expect(result).toMatchObject({ currentTerm: "HK253", nextTerm: "HK261", lateCount: 0, lateCredits: 0 });
    // Labels are shown with their spaces normalised (v17; the plan writes "Chọn  các môn sau").
    expect(result.informationalSections).toEqual([expect.objectContaining({ label: "Chọn các môn sau (Không tính vào tích lũy)", termCode: "HK252" })]);
    // HK261 alternatives (Đồ án / Chuyên đề) are one quota choice, partly filled by the course in progress.
    expect(result.next).toEqual([expect.objectContaining({ kind: "choice", label: "Nhóm tự chọn TC406: chọn 6 tín chỉ", unit: "credit", remaining: 3 })]);
  });

  it("counts a course that appears in two choice sections once, for the earliest section", () => {
    const states = { ...passedThroughHK243 };
    delete states["71ITIS30303"];
    const result = run("HK251", states);
    // The plan writes "Chọn1 trong 3 môn sau"; the student reads it spaced (v17).
    expect(result.late).toEqual([expect.objectContaining({ kind: "choice", label: "Chọn 1 trong 3 môn sau", termCode: "HK243", missing: 1, missingCredits: 3 })]);
    expect(result).toMatchObject({ lateCount: 1, lateCredits: 3 });
    // While HK243 is the term being studied, the same choice is that term's plan, not late (v19).
    expect(run("HK243", states)).toMatchObject({ late: [], lateCount: 0, lateCredits: 0, currentCount: 1, currentCredits: 3,
      current: [expect.objectContaining({ kind: "choice", label: "Chọn 1 trong 3 môn sau", termCode: "HK243", missing: 1 })] });
  });

  it("lists late courses, GDTC slots and choices of the terms before the one being studied, but never in-progress courses", () => {
    const result = run("HK241", {
      "71ITBS10103": "passed", "71ITBS10203": "failed", "71NAD110013": "passed", "71ITSE30103": "in_progress", "71PEKC10062": "passed",
      "71ITIS30103": "graded_unknown",
    });
    expect(result.late.map((entry) => [entry.kind, "code" in entry ? entry.code : entry.label, entry.termCode])).toEqual([
      ["course", "71ITBS10203", "HK231"],
      ["physical_education", "GDTC 2", "HK233"],
    ]);
    // GDTC is a condition: listed, its 2 credits never counted (v19; lateCredits was 3 + 2 + 3 + 3 with HK241 counted late).
    expect(result.late.find((entry) => entry.kind === "physical_education")).toMatchObject({ required: 2, passed: 1, missingCredits: 2, conditionOnly: true });
    expect(result).toMatchObject({ lateCount: 2, lateCredits: 3 });
    // HK241 is being studied: its course and choice not registered are its plan.
    expect(result.current!.map((entry) => [entry.kind, "code" in entry ? entry.code : entry.label, entry.termCode])).toEqual([
      ["course", "71ITSE30503", "HK241"],
      ["choice", "Chọn 1 trong 2 môn sau", "HK241"],
    ]);
    expect(result).toMatchObject({ currentCount: 2, currentCredits: 6 });
  });

  it("does not count an ongoing PE elective as late", () => {
    const result = run("HK233", { "71ITBS10103": "passed", "71ITBS10203": "passed", "71NAD110013": "passed", "71ITSE30103": "passed", "71ITIS30103": "passed", "71PEKC10062": "passed", "71PEBA10052": "in_progress" });
    expect(result.late).toEqual([]);
  });

  it("decides applicability from the CTĐT specialty, not from the section label", () => {
    const states = { ...passedThroughHK243 };
    delete states["71ITSE41003"];
    delete states["71ITAI40103"];
    const late = (specialty: SpecialtyCode | null) => run("HK251", states, specialty).late.map((entry) => ("code" in entry ? entry.code : entry.label));
    // 71ITAI40103 is a common course listed under the "Chuyên ngành Trí tuệ Nhân tạo" section.
    expect(late("CNPM")).toEqual(["71ITSE41003", "71ITAI40103"]);
    expect(late("CNDL")).toEqual(["71ITDS40303", "71ITAI40103"]);
    expect(late(null)).toEqual(["71ITAI40103"]);
  });

  it("treats the TC406 alternatives as one quota choice in credits, its shortfall in credits (v19)", () => {
    const states: Record<string, CourseState> = { ...passedThroughHK243, "71ITSE41203": "passed", "71ITIN40304": "passed", "71ITGR40206": "failed" };
    // HK262 comes after the group's term: late, 6 TC short. `missing` is in credits like `remaining` (it read 1, "còn thiếu 1 TC").
    const result = run("HK262", states);
    expect(result.late).toEqual([expect.objectContaining({ kind: "choice", unit: "credit", required: 6, missingCredits: 6, missing: 6 })]);
    // One course of the group's largest (Đồ án Tốt nghiệp, 6 TC) fills it: one course late.
    expect(result).toMatchObject({ lateCount: 1, lateCredits: 6 });
    // In HK261, the group's own term, it is that term's plan (v19).
    expect(run("HK261", states)).toMatchObject({ late: [], current: [expect.objectContaining({ unit: "credit", missing: 6, missingCredits: 6 })], currentCredits: 6 });
    const unknown = run("HK262", { ...passedThroughHK243, "71ITSE41203": "passed", "71ITIN40304": "passed", "71ITGR40206": "graded_unknown" });
    expect(unknown.late).toEqual([]);
    const done = run("HK262", { ...passedThroughHK243, "71ITSE41203": "passed", "71ITIN40304": "passed", "71ITGR40203": "passed", "71ITIS30403": "passed" });
    expect(done.late).toEqual([]);
  });

  it("warns when the 'trong n' of a label differs from the real item count", () => {
    const data = structuredClone(plan.data);
    data.sections = data.sections.map((section) => (section.id === "section-36" ? { ...section, label: "Chọn 1 trong 4 môn sau" } : section));
    expect(run("HK241", passedThroughHK243, "CNPM", data).countMismatches).toEqual([{ label: "Chọn 1 trong 4 môn sau", termCode: "HK241", stated: 4, actual: 2 }]);
    expect(run("HK241", passedThroughHK243).countMismatches).toEqual([]);
  });

  it("has nothing late before the first graded term", () => {
    expect(run(null, {})).toMatchObject({ currentTerm: null, nextTerm: "HK231", late: [], current: [] });
  });
});

describe("comp-calc-v20 (user 2026-11-05): a choice of an elective group whose credits are reached is met", () => {
  const item = (position: number, code: string, termCode: string) => ({
    id: `row-${position}`, position, code, name: `Môn ${code}`, credits: 3, type: "TC209", termCode, semester: Number(termCode[4]), studyYear: 2,
    sectionId: `choice-${termCode}`, prerequisite: "", prior: "", notes: "", hours: { lecture: null, practice: null, project: null, internship: null },
    sourceRow: position, sourceSheet: "KHĐT", sourceCells: {},
  });
  const terms = ["HK241", "HK243", "HK251"];
  const choicePlan = {
    terms: terms.map((code) => ({ code, semester: Number(code[4]), studyYear: 2, sourceCredits: 3 })),
    sections: terms.map((termCode, index) => ({ id: `choice-${termCode}`, termCode, label: "Chọn 1 trong 2 môn sau", kind: "choice" as const, sourceRow: index })),
    items: [item(1, "E1", "HK241"), item(2, "E2", "HK241"), item(3, "E3", "HK243"), item(4, "E4", "HK243"), item(5, "E5", "HK251"), item(6, "E6", "HK251")],
  };
  const codes = ["E1", "E2", "E3", "E4", "E5", "E6"];
  const runChoices = (states: Record<string, CourseState>, quota: number) => planProgress({
    plan: choicePlan, physicalEducationGroups: {}, currentTerm: "HK261",
    courses: new Map(codes.map((code) => [code, { code, name: `Môn ${code}`, credits: 3, state: states[code] ?? "not_taken", applicable: true, electiveCode: "TC209" }])),
    quotas: new Map([["TC209", { code: "TC209", courseCodes: codes, quota, source: "curriculum" as const }]]),
  });

  it("fills a later choice with a course of the group taken earlier, and meets the rest once the group's credits are reached", () => {
    // E1 and E2 both passed in HK241: E2 fills the choice of HK243; the group asks 6 credits, reached, so HK251's is met too.
    expect(runChoices({ E1: "passed", E2: "passed" }, 6).late).toEqual([]);
    // A group of 9 credits still needs one: the choice of HK251 is late.
    expect(runChoices({ E1: "passed", E2: "passed" }, 9).late.map((entry) => [entry.kind, entry.termCode])).toEqual([["choice", "HK251"]]);
    // Reached with a course in progress: that choice is running, not late.
    expect(runChoices({ E1: "passed", E2: "passed", E3: "in_progress" }, 9).late).toEqual([]);
  });
});

describe("comp-calc-v19 (user 2026-11-04): late only before the term being studied, no condition-only credits", () => {
  // The flags calculate.ts passes from the engine's conditionCodes (the fixture standard's condition-only courses).
  const conditionCodes = new Set(["71NAD110013", "71PEKC10062", "71PESW10042", "71PEBA10052", "71PETT10012"]);
  const withConditions = (states: Record<string, CourseState>) => {
    const map = courses(states);
    for (const code of conditionCodes) map.set(code, { ...map.get(code)!, conditionOnly: true });
    return map;
  };
  const progress = (currentTerm: string, states: Record<string, CourseState>) =>
    planProgress({ plan: plan.data, physicalEducationGroups: plan.physicalEducationGroups, currentTerm, courses: withConditions(states), quotas });

  it("reproduces the review: earlier courses late, GDQP and GDTC listed without credits, the thesis group of the term being studied not late", () => {
    // A synthetic student studying HK261 (the plan's last term): Kiểm thử phần mềm (HK251) and Đồ án thực tập (HK253) not
    // taken, GDQP1 and the second GDTC not passed, the thesis group TC406 of HK261 not registered. Before v19: 3 + 2 + 3 + 4 + 6.
    const states: Record<string, CourseState> = { ...passedThroughHK243 };
    delete states["71NAD110013"];
    delete states["71PETT10012"];
    const result = progress("HK261", states);
    expect(result.late.map((entry) => [entry.kind, "code" in entry ? entry.code : entry.label, entry.termCode, entry.conditionOnly ?? false])).toEqual([
      ["course", "71NAD110013", "HK231", true],
      ["physical_education", "GDTC 2", "HK233", true],
      ["course", "71ITSE41203", "HK251", false],
      ["course", "71ITIN40304", "HK253", false],
    ]);
    // Listed, but only the two courses count: 3 + 4 TC.
    expect(result).toMatchObject({ lateCount: 4, lateCredits: 7 });
    // The thesis group is the plan of the term being studied, in credits: 6 TC, the figure of Xét tốt nghiệp.
    expect(result.current).toEqual([expect.objectContaining({
      kind: "choice", label: "Nhóm tự chọn TC406: chọn 6 tín chỉ", termCode: "HK261", unit: "credit", missing: 6, missingCredits: 6,
    })]);
    expect(result).toMatchObject({ currentCount: 1, currentCredits: 6, nextTerm: null, next: [], nextCount: 0, nextCredits: 0 });
    expect(shortfallText(result.current![0] as Extract<LateEntry, { kind: "choice" }>)).toBe("6 TC");
  });

  it("leaves condition-only courses and GDTC slots out of the credits of the term being studied and of the next term", () => {
    const result = progress("HK231", {});
    // HK231: two courses of 3 TC and GDQP1 (3 TC, a condition): 3 items, 6 TC.
    expect(result.current!.map((entry) => ("code" in entry ? entry.code : entry.label))).toEqual(["71ITBS10103", "71ITBS10203", "71NAD110013"]);
    expect(result).toMatchObject({ currentCount: 3, currentCredits: 6 });
    // HK232: Kỹ thuật lập trình and the GDTC 1 slot: 2 courses, 3 TC (5 before v19).
    expect(result.next).toEqual([
      expect.objectContaining({ kind: "course", code: "71ITSE30103" }),
      expect.objectContaining({ kind: "physical_education", label: "GDTC 1", conditionOnly: true }),
    ]);
    expect(result).toMatchObject({ nextTerm: "HK232", nextCount: 2, nextCredits: 3 });
  });

  it("writes every shortfall in the unit of its requirement, the same way for results stored before v19", () => {
    const option = (credits: number | null, state: CourseState = "not_taken") => ({ credits, state });
    expect(shortfallText({ unit: "credit", missing: 6, missingCredits: 6 })).toBe("6 TC");
    // A v18 result counted the courses of a credit group in `missing`: its credits still read right.
    expect(shortfallText({ unit: "credit", missing: 1, missingCredits: 6 })).toBe("6 TC");
    expect(shortfallText({ unit: "course", missing: 1, missingCredits: 3, options: [option(3), option(3), option(3, "passed")] })).toBe("1 học phần (3 TC)");
    // Options of different credits still open: the range, never one wrong figure.
    expect(shortfallText({ unit: "course", missing: 1, missingCredits: 3, options: [option(6), option(3)] })).toBe("1 học phần (3–6 TC)");
    expect(shortfallText({ unit: "course", missing: 2, missingCredits: 6, options: [option(4), option(3), option(3), option(4, "in_progress")] })).toBe("2 học phần (6–7 TC)");
    expect(shortfallText({ unit: "course", missing: 1, missingCredits: 0 })).toBe("1 học phần");
    expect(shortfallText({ unit: "credit", missing: 1.5, missingCredits: 1.5 })).toBe("1,5 TC");
  });

  it("counts a choice's missing credits from its cheapest options still open", () => {
    const option = (credits: number | null, state: CourseState = "not_taken") => ({ credits, state });
    // The 3 TC option is passed (it filled another choice): the open ones are 4 TC (k × the cheapest, 3, before v19).
    expect(choiceCreditRange([option(3, "passed"), option(4), option(4, "failed")], 1)).toEqual({ low: 4, high: 4 });
    expect(choiceCreditRange([option(3, "passed"), option(4)], 2)).toEqual({ low: 7, high: 7 });
    expect(choiceCreditRange([option(3, "passed")], 1)).toEqual({ low: 3, high: 3 });
    expect(choiceCreditRange([], 1)).toEqual({ low: 0, high: 0 });
    expect(choiceCreditRange([option(null)], 1)).toEqual({ low: 0, high: 0 });
  });
});
