import { describe, expect, it } from "vitest";
import {
  aiAddedText, applyProposal, auditGroups, auditNote, creditProgress, groupCountText, moveCourse, neededTone, offering, ownRelations, planChoiceText, planIssues,
  poolSections, searchCourses, termLabel, termLoad, termLoadText, withTerms, type StudyPlanContext, type StudyPlanCourse, type StudyPlanData,
} from "./study-plan-data";

// Synthetic courses only (no student data).
const course = (code: string, extra: Partial<StudyPlanCourse> = {}): StudyPlanCourse => ({
  code, name: `Môn ${code}`, credits: 3, type: "BB", kind: "mandatory", group: null, conditional: false, applicable: true, specialtyName: null,
  standardTerm: null, prerequisites: [], prior: [], state: "not_taken", inProgressTerm: null, planTerm: null, offeredTerms: [],
  grade: null, takenTerm: null, attempts: 0, equivalent: null, ...extra,
});

const context = (extra: Partial<StudyPlanContext> = {}): StudyPlanContext => ({
  cohortCode: "K30", specialty: "CNPM", specialtyLabel: "Công nghệ phần mềm", curriculum: { name: "CTĐT K30", totalCredits: 30 }, hasTranscript: true,
  currentTerm: "HK261", studyTerm: "HK261", admissionYear: 2024, standardTerms: ["HK241", "HK242", "HK251", "HK252", "HK261", "HK262"],
  limits: { average: 5, min: 4, max: 7 }, offeringUntil: "HK262", electiveGroups: [], unmatched: [], gpa: { actual: 2.45, required: 2, scale: 4 },
  courses: [
    course("A", { state: "passed", grade: "B+", takenTerm: "HK241", attempts: 2 }),
    course("B", { state: "in_progress", inProgressTerm: "HK261" }),
    course("C", { prerequisites: ["D"], offeredTerms: ["HK252"] }),
    course("D", { state: "failed", grade: "F", takenTerm: "HK251", attempts: 1 }),
    course("E", { kind: "elective", group: "TC306", credits: 3 }),
    course("F", { kind: "elective", group: "TC306", credits: 3, state: "passed", grade: "A", takenTerm: "HK252", equivalent: "OLD01" }),
    course("X", { applicable: false, specialtyName: "Khoa học dữ liệu" }),
  ],
  graduation: {
    standardName: "Tiêu chuẩn K30", credits: { completed: 6, required: 30, source: "printed" },
    groups: [
      { label: "Học phần bắt buộc", kind: "mandatory", unit: "môn", required: 4, passed: 1, status: "fail", courseCodes: ["A", "B", "C", "D"] },
      { label: "Nhóm tự chọn TC306", kind: "elective", unit: "TC", required: 6, passed: 3, status: "fail", courseCodes: ["E", "F"] },
    ],
  },
  ...extra,
});
const plan: StudyPlanData = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "C" }, { code: "D" }] }] };

describe("auditGroups", () => {
  it("marks every course in the official view: done, being studied, still needed", () => {
    const [mandatory, elective] = auditGroups(context(), plan, "official");
    expect(mandatory!.rows.map((row) => [row.course.code, row.mark])).toEqual([["A", "done"], ["B", "running"], ["C", "needed"], ["D", "needed"]]);
    expect([mandatory!.done, mandatory!.counted, mandatory!.remaining, mandatory!.complete]).toEqual([1, 2, 2, false]);
    expect([elective!.done, elective!.counted, elective!.remaining]).toEqual([3, 3, 3]);
  });

  it("counts the plan in the planned view, without calling a group complete before its courses are passed", () => {
    const [mandatory, elective] = auditGroups(context(), plan, "planned");
    expect(mandatory!.rows.map((row) => row.mark)).toEqual(["done", "running", "planned", "planned"]);
    // Every course is passed, being studied or planned: nothing is missing, yet only 1 of the 4 is passed.
    expect([mandatory!.remaining, mandatory!.complete, mandatory!.mark]).toEqual([0, false, "planned"]);
    expect(groupCountText(mandatory!)).toBe("Đã đạt 1/4 môn · phần còn lại đã có trong kế hoạch");
    expect(elective!.remaining).toBe(3);
    expect(auditNote(mandatory!.rows[2]!)).toBe("Kế hoạch · HK2 2026–2027");
    expect(auditNote(auditGroups(context(), plan, "official")[0]!.rows[3]!)).toBe("Chưa đạt (F) · kế hoạch HK2 2026–2027");
    expect(auditNote(mandatory!.rows[0]!)).toBe("B+ · HK1 2024–2025");
  });

  it("colours a course still needed by what it is (user 2026-10-30: red only for Chưa đạt)", () => {
    const due = (planTerm: string | null, extra: Partial<StudyPlanCourse> = {}) => course("Z", { planTerm, ...extra });
    expect(neededTone(due("HK251", { state: "failed" }), "HK261")).toBe("failed");
    // Its training-plan term (else the CTĐT one) is the current term or earlier: overdue.
    expect(neededTone(due("HK261"), "HK261")).toBe("overdue");
    expect(neededTone(due(null, { standardTerm: "HK252" }), "HK261")).toBe("overdue");
    // Not due yet, an elective, or no term known: grey.
    expect(neededTone(due("HK262"), "HK261")).toBe("upcoming");
    expect(neededTone(due("HK252", { kind: "elective" }), "HK261")).toBe("upcoming");
    expect(neededTone(due(null), "HK261")).toBe("upcoming");
    const row = (code: string, plannedTerm: string | null = null) => ({ course: course(code, { planTerm: code === "LATE" ? "HK252" : "HK271" }), mark: "needed" as const, plannedTerm });
    expect(auditNote(row("LATE"), "HK261")).toBe("Trễ kế hoạch đào tạo (dự kiến HK2 2025–2026)");
    expect(auditNote(row("LATE", "HK262"), "HK261")).toBe("Trễ kế hoạch đào tạo (dự kiến HK2 2025–2026) · kế hoạch HK2 2026–2027");
    expect(auditNote(row("NEXT"), "HK261")).toBe("Chưa học · dự kiến HK1 2027–2028");
    expect(auditNote(row("NEXT", "HK263"), "HK261")).toBe("Chưa học · kế hoạch HK3 2026–2027");
  });

  it("marks a group done only by results: a course being studied makes it ✓✓ Đang học, not ✓ Đã hoàn thành", () => {
    // K29 TC306 (6 TC): F passed, the rest (E) being studied.
    const studying = context({ courses: context().courses.map((item) => (item.code === "E" ? { ...item, state: "in_progress" as const, inProgressTerm: "HK261" } : item)) });
    for (const view of ["official", "planned"] as const) {
      const elective = auditGroups(studying, plan, view)[1]!;
      expect([elective.done, elective.running, elective.counted, elective.remaining, elective.complete, elective.mark]).toEqual([3, 3, 6, 0, false, "running"]);
      expect(groupCountText(elective)).toBe("Đã đạt 3/6 TC · phần còn lại đang học");
    }
    // A group whose only course is being studied.
    const thesis = context({ graduation: { ...context().graduation!, groups: [
      { label: "Đồ án tốt nghiệp", kind: "mandatory", unit: "môn", required: 1, passed: 0, status: "unknown", courseCodes: ["B"] }] } });
    expect(auditGroups(thesis, plan, "official")[0]).toMatchObject({ complete: false, mark: "running", remaining: 0 });
    // Once passed, it is done.
    const passed = context({ courses: context().courses.map((item) => (item.code === "E" ? { ...item, state: "passed" as const } : item)) });
    const done = auditGroups(passed, plan, "official")[1]!;
    expect([done.complete, done.mark, groupCountText(done)]).toEqual([true, "done", "Đã đủ 6 TC"]);
    // Still short: the red count.
    const open = auditGroups(context(), plan, "official")[1]!;
    expect([open.mark, groupCountText(open)]).toEqual(["open", "3/6 TC · còn thiếu 3 TC"]);
  });

  it("without a standard, groups the CTĐT: mandatory courses, then each elective group", () => {
    const plain = context({ graduation: null, electiveGroups: [{ code: "TC306", requiredCredits: 6, courseCodes: ["E", "F", "X"] }] });
    const groups = auditGroups(plain, plan, "official");
    expect(groups.map((group) => [group.label, group.required, group.rows.map((row) => row.course.code)])).toEqual([
      ["Học phần bắt buộc", 4, ["A", "B", "C", "D"]], ["Nhóm tự chọn TC306", 6, ["F", "E"]],
    ]);
  });

  it("without '(n TC)', takes an elective group's courses from the training plan's 'Chọn k trong n', else says it is not known", () => {
    const choice = { courses: 2, sections: [{ label: "Chọn 2 trong 6 HP tự chọn Cơ sở ngành", termCode: "HK252" }] };
    const plain = context({ graduation: null, electiveGroups: [
      { code: "TC209", requiredCredits: null, courseCodes: ["E", "F"], planChoice: choice },
      { code: "TC406", requiredCredits: null, courseCodes: ["E", "F"], planChoice: null },
    ] });
    const [, chosen, unknown] = auditGroups(plain, plan, "official");
    // As the AI tab counts it ("còn thiếu … môn"): 1 of the 2 courses passed.
    expect([chosen!.unit, chosen!.required, chosen!.done, chosen!.mark, groupCountText(chosen!)]).toEqual(["môn", 2, 1, "open", "1/2 môn · còn thiếu 1 môn"]);
    expect(chosen!.planChoice).toEqual(choice);
    expect(planChoiceText(choice)).toBe("Số môn cần chọn theo kế hoạch đào tạo của khóa: Chọn 2 trong 6 HP tự chọn Cơ sở ngành (HK2 2025–2026).");
    // Nothing says how much TC406 needs: a neutral "?" instead of a group that can never be met.
    expect([unknown!.required, unknown!.remaining, unknown!.complete, unknown!.mark, groupCountText(unknown!)])
      .toEqual([null, null, false, "unknown", "Chưa rõ số tín chỉ yêu cầu · đã có 3 TC"]);
    // The planner's list asks for the same: one more course of TC209.
    expect(poolSections(plain, { schemaVersion: 1, terms: [] }).find((section) => section.id === "group-TC209")?.note).toBe("Cần thêm 1 môn");
  });
});

describe("planning", () => {
  it("adds the usual terms around a saved plan and moves courses between terms", () => {
    expect(withTerms(context(), plan).terms.map((term) => term.code)).toEqual(["HK261", "HK262", "HK263"]);
    const moved = moveCourse(plan, "c", "HK271");
    expect(moved.terms.map((term) => [term.code, term.courses.map((item) => item.code)])).toEqual([["HK262", ["D"]], ["HK271", ["C"]]]);
    expect(moveCourse(moved, "D", null).terms.map((term) => term.courses.length)).toEqual([0, 1]);
  });

  it("takes in the AI roadmap's proposal once: new courses go to its term, planned ones stay where they are", () => {
    const proposal = { roadmapId: "99999999-9999-4999-8999-999999999999", completedAt: "2026-10-24T10:00:00.000Z", term: "HK262",
      courses: [{ code: "c", term: "HK262" }, { code: "E", term: "HK262" }] };
    const now = new Date("2026-10-24T10:05:00.000Z");
    const { plan: next, added } = applyProposal(withTerms(context(), { ...plan, terms: [{ code: "HK263", courses: [{ code: "C" }] }] }), proposal, now);
    expect(added).toBe(1);
    expect(next.roadmapId).toBe(proposal.roadmapId);
    expect(next.terms.map((term) => [term.code, term.courses.map((item) => item.code)])).toEqual([["HK261", []], ["HK262", ["E"]], ["HK263", ["C"]]]);
    // What it added stays in the plan (saved with it), so Kế hoạch học kỳ names the courses on later visits too.
    expect(next.aiAdded).toEqual({ completedAt: proposal.completedAt, term: "HK262", codes: ["E"], addedAt: now.toISOString() });
    expect(withTerms(context(), next).aiAdded).toEqual(next.aiAdded);
    expect(moveCourse(next, "E", "HK263").aiAdded).toEqual(next.aiAdded);
    expect(aiAddedText(context(), next.aiAdded!)).toBe(`Đã thêm 1 học phần do lộ trình AI đề xuất (lộ trình soạn lúc 17:00 24/10/2026): Môn E (E). `
      + "Các học phần được xếp từ HK2 2026–2027 trở đi, vào học kỳ mà kế hoạch đào tạo mở môn đó; bạn điều chỉnh tiếp bên dưới.");
    expect(aiAddedText(context(), { ...next.aiAdded!, codes: [] })).toBe("Các học phần lộ trình AI đề xuất (lộ trình soạn lúc 17:00 24/10/2026) đã có sẵn trong kế hoạch.");
    // A term the plan does not show yet is added in order; moving a course keeps the roadmap it came from.
    const later = applyProposal(plan, { ...proposal, courses: [{ code: "E", term: "HK271" }] }).plan;
    expect(later.terms.map((term) => term.code)).toEqual(["HK262", "HK271"]);
    expect(moveCourse(later, "E", "HK262").roadmapId).toBe(proposal.roadmapId);
  });

  it("never asks a course of the student's program for another specialty's prerequisites", () => {
    // Chuyên đề Tốt nghiệp 1 (G1) lists the prerequisites of every specialty: C of the student's, X of another one.
    const thesis = context({ courses: [...context().courses, course("G1", { prerequisites: ["C", "X"], prior: ["X"] }),
      course("Y", { applicable: false, specialtyName: "Khoa học dữ liệu", prerequisites: ["X"] })] });
    const planned: StudyPlanData = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "G1" }, { code: "Y" }] }] };
    const byCode = new Map(thesis.courses.map((item) => [item.code, item]));
    expect(planIssues(thesis, planned).get("G1")).toEqual({ prerequisites: ["C"], prior: [], notOffered: null });
    expect(ownRelations(byCode.get("G1")!, ["C", "X", "OUTSIDE"], byCode)).toEqual(["C", "OUTSIDE"]);
    // Another specialty's course, planned anyway, keeps its own prerequisites.
    expect(planIssues(thesis, planned).get("Y")?.prerequisites).toEqual(["X"]);
  });

  it("flags a prerequisite planned in the same term and a course no training plan opens in that term", () => {
    const issues = planIssues(context(), plan);
    // D (prerequisite of C) is only planned in the same term; C is opened in HK2 but no plan opens it in HK262 itself.
    expect(issues.get("C")).toEqual({ prerequisites: ["D"], prior: [], notOffered: "term" });
    // D first; C is never opened in an HK3; past the plans' last term an HK2 is fine.
    const later = (term: string) => planIssues(context(), { schemaVersion: 1, terms: [{ code: "HK261", courses: [{ code: "D" }] }, { code: term, courses: [{ code: "C" }] }] }).get("C");
    expect(later("HK263")).toEqual({ prerequisites: [], prior: [], notOffered: "semester" });
    expect(later("HK272")).toBeUndefined();
    expect(offering({ offeredTerms: ["HK252"] }, "HK272", "HK262")).toBe("ok");
    expect(offering({ offeredTerms: ["HK252"] }, "HK271", "HK262")).toBe("semester");
    expect(offering({ offeredTerms: [] }, "HK271", "HK262")).toBe("ok");
  });

  it("weighs each term against the credit limits", () => {
    expect(termLoad(context(), plan, "HK262")).toEqual({ credits: 6, conditional: 0, status: "ok" });
    expect(termLoad(context(), plan, "HK261")).toEqual({ credits: 3, conditional: 0, status: "under" });
    expect(termLoad(context(), plan, "HK263").status).toBe("empty");
    // A physical education course (môn điều kiện) raises the term's total too.
    const withSport = context({ courses: [...context().courses, course("PE1", { credits: 2, conditional: true, group: "TC102" })] });
    expect(termLoad(withSport, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "C" }, { code: "D" }, { code: "PE1" }] }] }, "HK262"))
      .toEqual({ credits: 8, conditional: 2, status: "over" });
    // The label says which limit, in words.
    const limits = context().limits;
    expect([termLoadText({ credits: 8, status: "over" }, limits), termLoadText({ credits: 3, status: "under" }, limits), termLoadText({ credits: 6, status: "ok" }, limits)])
      .toEqual(["8 TC · vượt mức tối đa 7 TC", "3 TC · dưới mức tối thiểu 4 TC", "6 TC"]);
  });

  it("names a term with the school year's en dash", () => {
    expect(termLabel("HK262")).toBe("HK2 2026–2027");
  });

  it("lists the courses still needed by requirement, finds courses by name and sums the credits", () => {
    expect(poolSections(context(), { schemaVersion: 1, terms: [] }).map((section) => [section.title, section.note, section.courses.map((item) => item.code)])).toEqual([
      ["Bắt buộc", "Còn 2 môn", ["C", "D"]], ["Nhóm tự chọn TC306", "Cần thêm 3 TC", ["E"]], ["Chuyên ngành khác", "Không tính cho chuyên ngành của bạn", ["X"]],
    ]);
    expect(poolSections(context(), plan).map((section) => section.title)).toEqual(["Nhóm tự chọn TC306", "Chuyên ngành khác"]);
    // E planned: TC306 has its 6 credits (F passed + E planned) and leaves the list.
    expect(poolSections(context(), moveCourse(plan, "E", "HK263")).map((section) => section.title)).toEqual(["Chuyên ngành khác"]);
    expect(searchCourses(context(), "mon c").map((item) => item.code)).toEqual(["C"]);
    expect(searchCourses(context(), "Môn").map((item) => item.code)).toEqual(["C", "D", "E", "X"]);
    expect(creditProgress(context(), plan)).toEqual({ done: 6, running: 3, planned: 6, plannedOther: 0, total: 30 });
  });

  it("counts in Theo kế hoạch only the planned courses of the student's program, another specialty's apart", () => {
    // X belongs to another specialty: planned, it counts toward nothing of the program.
    const withOther = moveCourse(plan, "X", "HK263");
    expect(creditProgress(context(), withOther)).toEqual({ done: 6, running: 3, planned: 6, plannedOther: 3, total: 30 });
  });
});
