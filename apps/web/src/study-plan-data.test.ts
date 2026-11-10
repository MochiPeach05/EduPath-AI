import { describe, expect, it } from "vitest";
import {
  aiAddedText, aiCleanedText, applyProposal, auditGroups, auditNote, classesText, cleanAiAdded, cleanThesisWay, creditProgress, declineProposal, followedThesisWay, groupCountText,
  moveCourse, neededTone, nextTermOffer, offering, orderAiAdded, ownPlanned, ownRelations, planChoiceText, planIssues, planProposal, poolSections, proposalAddedText,
  proposalSummaryText, searchCourses, termLabel, termLoad, termLoadText, thesisChoice, thesisCleanedText, thesisHint, thesisLeftOut, withTerms, type AiProposal,
  type StudyPlanContext, type StudyPlanCourse, type StudyPlanData, type StudyPlanThesis,
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

  it("asks for a học trước course taken before the term: one being studied counts from the next term (user 2026-11-04)", () => {
    // Cờ vua nâng cao (N) after Cờ vua (K): K is being studied in HK261.
    const chess = context({ courses: [...context().courses, course("K", { state: "in_progress", inProgressTerm: "HK261", group: "TC002", kind: "elective" }),
      course("N", { prior: ["K"], group: "TC102", kind: "elective", everyTerm: true })] });
    const at = (term: string) => planIssues(chess, { schemaVersion: 1, terms: [{ code: term, courses: [{ code: "N" }] }] }).get("N");
    expect(at("HK261")).toEqual({ prerequisites: [], prior: ["K"], notOffered: null });
    expect(at("HK262")).toBeUndefined();
    // Never taken: only after K is planned in an earlier term; failed counts as taken.
    const notTaken = context({ courses: [...context().courses, course("K"), course("N", { prior: ["K"], everyTerm: true })] });
    expect(planIssues(notTaken, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "K" }, { code: "N" }] }] }).get("N")?.prior).toEqual(["K"]);
    expect(planIssues(notTaken, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "K" }] }, { code: "HK263", courses: [{ code: "N" }] }] }).get("N")).toBeUndefined();
    const failed = context({ courses: [...context().courses, course("K", { state: "failed", grade: "F" }), course("N", { prior: ["K"], everyTerm: true })] });
    expect(planIssues(failed, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "N" }] }] }).get("N")).toBeUndefined();
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

  it("counts each term's credits and says them alone, never a minimum or a maximum (user 2026-11-10)", () => {
    expect(termLoad(context(), plan, "HK262")).toEqual({ credits: 6, conditional: 0 });
    expect(termLoad(context(), plan, "HK261")).toEqual({ credits: 3, conditional: 0 });
    expect(termLoad(context(), plan, "HK263")).toEqual({ credits: 0, conditional: 0 });
    // A physical education course (môn điều kiện) raises the term's total too.
    const withSport = context({ courses: [...context().courses, course("PE1", { credits: 2, conditional: true, group: "TC102" })] });
    expect(termLoad(withSport, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "C" }, { code: "D" }, { code: "PE1" }] }] }, "HK262"))
      .toEqual({ credits: 8, conditional: 2 });
    // Over the old maximum (7 TC), below the old minimum (4 TC), an empty term: the credits only.
    expect([termLoadText({ credits: 8 }), termLoadText({ credits: 3 }), termLoadText({ credits: 0 }), termLoadText({ credits: 1.5 })])
      .toEqual(["8 TC", "3 TC", "0 TC", "1,5 TC"]);
  });

  it("lists the AI roadmap's improvements as a suggestion, never another specialty's or a planned one (user 2026-11-03)", () => {
    const withLow = context({ courses: [...context().courses, course("L", { state: "passed", grade: "D+" })] });
    const suggestions = [{ code: "L", term: "HK262" }, { code: "A", term: "HK262" }, { code: "X", term: "HK262" }];
    const improve = poolSections(withLow, { schemaVersion: 1, terms: [] }, suggestions).find((section) => section.id === "improve")!;
    expect([improve.title, improve.note, improve.courses.map((item) => item.code)]).toEqual(["Gợi ý học cải thiện", "Lộ trình AI gợi ý, không bắt buộc", ["L", "A"]]);
    expect(poolSections(withLow, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "L" }] }] }, suggestions).find((section) => section.id === "improve")!.courses
      .map((item) => item.code)).toEqual(["A"]);
  });

  it("says whether next term opens a course and in which semester plans usually do (user 2026-11-03)", () => {
    // Current term HK261: next term is HK262; the plans cover up to HK262.
    expect(nextTermOffer(course("O", { offeredTerms: ["HK252", "HK262"] }), context())).toEqual({ tone: "ok", text: "Kỳ sau (HK2 2026–2027): có mở · thường mở HK2" });
    expect(nextTermOffer(course("N", { offeredTerms: ["HK251", "HK261"] }), context())).toEqual({ tone: "warn", text: "Kỳ sau (HK2 2026–2027): không mở theo kế hoạch đào tạo · thường mở HK1" });
    expect(nextTermOffer(course("U", { offeredTerms: [] }), context()).tone).toBe("unknown");
    // English opens every term whatever the plans list (user 2026-11-04): never "không mở", in no term.
    const english = course("71ENG610063", { name: "Anh văn 6 (AV6)", offeredTerms: ["HK243"], everyTerm: true });
    expect(nextTermOffer(english, context())).toEqual({ tone: "ok", text: "Kỳ sau (HK2 2026–2027): có mở · mở mọi học kỳ" });
    expect(offering(english, "HK262", "HK262")).toBe("ok");
    expect(offering({ offeredTerms: ["HK243"] }, "HK262", "HK262")).toBe("semester");
    // Past the plans' last term, the semester decides.
    expect(nextTermOffer(course("P", { offeredTerms: ["HK252"] }), context({ currentTerm: "HK262", offeringUntil: "HK262" })).text)
      .toBe("Kỳ sau (HK3 2026–2027): không mở theo kế hoạch đào tạo · thường mở HK2");
    expect(nextTermOffer(course("Q", { offeredTerms: ["HK253"] }), context({ currentTerm: "HK262", offeringUntil: "HK262" })).text)
      .toBe("Kỳ sau (HK3 2026–2027): có thể mở · thường mở HK3");
  });

  it("names the other cohorts' class a course off the student's plan is studied in, and where that comes from (user 2026-11-08)", () => {
    const classes = [
      { term: "HK262", cohort: "K30", major: null, source: "plan" as const }, { term: "HK262", cohort: "K31", major: null, source: "plan" as const },
      { term: "HK262", cohort: "K32", major: null, source: "curriculum" as const }, { term: "HK262", cohort: "K30", major: "HTTT", source: "plan" as const },
      { term: "HK263", cohort: "K30", major: "HTTT", source: "plan" as const }, { term: "HK271", cohort: "K30", major: null, source: "plan" as const },
    ];
    const retake = course("R", { state: "failed", grade: "F", offeredTerms: ["HK262", "HK263"], classes });
    expect(classesText(retake, "HK262", "K29")).toBe("lớp khóa K30, K31 (theo kế hoạch đào tạo), K32 (theo CTĐT)");
    // Only another major studies it then: its classes, named with the major.
    expect(classesText(retake, "HK263", "K29")).toBe("lớp khóa K30 HTTT (theo kế hoạch đào tạo)");
    // The student's own cohort studies it then (the student's own class), or nobody does: nothing to name.
    expect(classesText(retake, "HK271", "K30")).toBeNull();
    expect(classesText(retake, "HK272", "K29")).toBeNull();
    expect(classesText(course("Z"), "HK262", "K29")).toBeNull();
    // The next term's line says it; a term card names its own term apart (classes: false).
    const k29 = context({ cohortCode: "K29" });
    expect(nextTermOffer(retake, k29).text).toBe("Kỳ sau (HK2 2026–2027): có mở, học cùng lớp khóa K30, K31 (theo kế hoạch đào tạo), K32 (theo CTĐT) · thường mở HK2, HK3");
    expect(nextTermOffer(retake, k29, { classes: false }).text).toBe("Kỳ sau (HK2 2026–2027): có mở · thường mở HK2, HK3");
    const english = course("71ENG610063", { name: "Anh văn 6 (AV6)", everyTerm: true, classes: [{ term: "HK262", cohort: "K31", major: null, source: "plan" }] });
    expect(nextTermOffer(english, k29).text).toBe("Kỳ sau (HK2 2026–2027): có mở, học cùng lớp khóa K31 (theo kế hoạch đào tạo) · mở mọi học kỳ");
  });

  it("takes out what an older AI roadmap added and the plan must not hold, nothing the student placed (user 2026-11-03)", () => {
    const ctx = context({ courses: [...context().courses, course("L", { state: "passed", grade: "D" })] });
    const added: StudyPlanData = {
      schemaVersion: 1, roadmapId: "r1", aiAdded: { completedAt: "2026-11-03T07:24:00.000Z", term: "HK262", codes: ["C", "X", "L"], addedAt: "2026-11-03T07:30:00.000Z" },
      terms: [{ code: "HK262", courses: [{ code: "C" }, { code: "X" }, { code: "L" }, { code: "E" }] }],
    };
    const { plan: cleaned, removed } = cleanAiAdded(ctx, added);
    expect(removed).toEqual(["X", "L"]);
    expect(cleaned.terms[0]!.courses.map((item) => item.code)).toEqual(["C", "E"]);
    expect(cleaned.aiAdded!.codes).toEqual(["C"]);
    expect(aiCleanedText(ctx, removed)).toBe("Đã bỏ khỏi kế hoạch 2 học phần lộ trình AI thêm trước đây vì không phải môn còn thiếu của chuyên ngành bạn (môn khác chuyên ngành, hoặc môn đã đạt chỉ nên gợi ý học cải thiện): Môn X (X) và Môn L (L).");
    // Nothing to take out: the same plan comes back.
    expect(cleanAiAdded(ctx, cleaned)).toEqual({ plan: cleaned, removed: [] });
    expect(cleanAiAdded(ctx, plan)).toEqual({ plan, removed: [] });
  });

  describe("the thesis group (user 2026-11-03; 2026-11-10: the system recommends a way, never by the GPA, and the student chooses)", () => {
    const thesisCourses = [
      course("G6", { kind: "elective", credits: 6, name: "Đồ án Tốt nghiệp" }),
      course("T1", { kind: "elective", name: "Chuyên đề Tốt nghiệp 1" }),
      course("T2", { kind: "elective", name: "Chuyên đề Tốt nghiệp 2" }),
      course("O1", { kind: "elective", name: "Quản lý dự án" }),
    ];
    const way = (extra: Partial<StudyPlanThesis>): StudyPlanThesis => ({
      group: "Nhóm tự chọn TC307", thesis: "G6", replacements: ["T1", "T2"], others: ["O1"], path: "not_started", way: null, ...extra,
    });
    const withThesis = (thesis: StudyPlanThesis | null) => context({
      courses: [...context().courses, ...thesisCourses], thesis,
      graduation: { ...context().graduation!, groups: [...context().graduation!.groups,
        { label: "Nhóm tự chọn TC307", kind: "elective", unit: "TC", required: 6, passed: 0, status: "fail", courseCodes: ["G6", "T1", "T2", "O1"] }] },
    });
    const high = withThesis(way({ way: "thesis" }));
    const low = withThesis(way({ way: "replacement" }));
    const empty: StudyPlanData = { schemaVersion: 1, terms: [] };
    const planned = (...codes: string[]): StudyPlanData => ({ schemaVersion: 1, terms: [{ code: "HK262", courses: codes.map((code) => ({ code })) }] });
    const added = (plan: StudyPlanData, codes: string[]): StudyPlanData => ({ ...plan, roadmapId: "r1",
      aiAdded: { completedAt: "2026-11-03T07:24:00.000Z", term: "HK262", codes, addedAt: "2026-11-03T07:30:00.000Z" } });
    const group = (ctx: StudyPlanContext, plan = empty) => poolSections(ctx, plan).find((section) => section.title === "Nhóm tự chọn TC307")?.courses.map((item) => item.code);

    it("reads the student's choice from the transcript and their own courses, never the AI's, and follows it over the recommendation", () => {
      expect(thesisChoice(low, empty)).toBeNull();
      expect(followedThesisWay(low, empty)).toBe("replacement");
      expect(thesisChoice(low, planned("g6"))).toBe("thesis");
      expect(followedThesisWay(low, planned("G6"))).toBe("thesis");
      expect(thesisChoice(high, planned("O1"))).toBe("replacement");
      expect(thesisChoice(high, planned("G6", "T2"))).toBe("both");
      expect(followedThesisWay(high, planned("G6", "T2"))).toBeNull();
      // What an AI roadmap added is its suggestion, unless the student kept it (Bỏ qua).
      expect(thesisChoice(low, added(planned("G6"), ["G6"]))).toBeNull();
      expect(thesisChoice(low, { ...added(planned("G6"), ["G6"]), kept: ["G6"] })).toBe("thesis");
      expect([...ownPlanned({ ...added(planned("G6", "T1"), ["T1"]) })]).toEqual(["G6"]);
      expect(thesisChoice(withThesis(way({ path: "replacement", way: "replacement" })), planned("G6"))).toBe("both");
    });

    it("lists both ways in Danh sách chờ until the student chooses, the recommended one first, then only the way chosen", () => {
      expect(group(withThesis(way({})))).toEqual(["G6", "T1", "T2", "O1"]);
      expect(group(high)).toEqual(["G6", "T1", "T2"]);
      expect(group(low)).toEqual(["T1", "T2", "G6"]);
      expect([...thesisLeftOut(high)]).toEqual(["O1"]);
      // Chuyên đề Tốt nghiệp 1 placed: the chuyên đề way, Đồ án tốt nghiệp out of the list (search still finds it).
      expect(group(high, planned("T1"))).toEqual(["T2"]);
      expect([...thesisLeftOut(high, planned("T1"))].sort()).toEqual(["G6", "O1"]);
      expect(searchCourses(high, "do an tot").map((item) => item.code)).toEqual(["G6"]);
      expect(group(low, planned("G6"))).toBeUndefined();
    });

    it("says the recommendation as a suggestion, never the GPA, and never calls a course the student placed unnecessary", () => {
      expect(thesisHint(low, empty, "T1")).toBe("Đề xuất cho nhóm tự chọn TC307: học Chuyên đề Tốt nghiệp 1 và Chuyên đề Tốt nghiệp 2.");
      expect(thesisHint(low, empty, "G6")).toBe("Phương án khác cho nhóm tự chọn TC307, nếu bạn chọn; đề xuất: học Chuyên đề Tốt nghiệp 1 và Chuyên đề Tốt nghiệp 2.");
      expect(thesisHint(high, empty, "T2")).toBe("Phương án khác cho nhóm tự chọn TC307, nếu bạn chọn; đề xuất: làm Đồ án Tốt nghiệp.");
      expect(thesisHint(high, empty, "O1")).toBe("Học phần này không thuộc phương án đề xuất cho nhóm tự chọn TC307 (làm Đồ án Tốt nghiệp).");
      // Đồ án tốt nghiệp placed by a student the system recommends the chuyên đề for: their choice, no line on it.
      expect(thesisHint(low, planned("G6"), "G6")).toBeNull();
      expect(thesisHint(low, planned("G6"), "T1")).toBe("Bạn đã chọn làm Đồ án Tốt nghiệp cho nhóm tự chọn TC307; chỉ cần một phương án.");
      // Both ways planned: kept, and said neutrally that one is enough.
      const both = "Chỉ cần một phương án cho nhóm tự chọn TC307: làm Đồ án Tốt nghiệp, hoặc học Chuyên đề Tốt nghiệp 1 và Chuyên đề Tốt nghiệp 2.";
      expect(thesisHint(high, planned("G6", "T1"), "G6")).toBe(both);
      expect(thesisHint(high, planned("G6", "T1"), "T2")).toBe(both);
      // A path the transcript shows is the student's choice too.
      const started = withThesis(way({ path: "replacement", way: "replacement" }));
      expect(thesisHint(started, empty, "G6")).toBe("Bạn đã chọn học Chuyên đề Tốt nghiệp 1 và Chuyên đề Tốt nghiệp 2 cho nhóm tự chọn TC307; chỉ cần một phương án.");
      expect(thesisHint(withThesis(way({})), empty, "T1")).toBeNull();
      expect(thesisHint(high, empty, "C")).toBeNull();
      // No line names a GPA, a threshold, or calls a course unnecessary.
      for (const ctx of [high, low, started]) for (const plan of [empty, planned("G6"), planned("T1"), planned("G6", "T1")]) for (const code of ["G6", "T1", "T2", "O1"]) {
        expect(thesisHint(ctx, plan, code) ?? "").not.toMatch(/2,8|điểm|Không cần/);
      }
    });

    it("never takes out a course the student placed; only what an AI roadmap added off the way the plan follows", () => {
      // Both ways placed by the student: nothing goes (user 2026-11-10), whatever the recommendation.
      const mixed: StudyPlanData = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "C" }, { code: "T1" }] }, { code: "HK263", courses: [{ code: "G6" }, { code: "T2" }] }] };
      expect(cleanThesisWay(high, mixed)).toEqual({ plan: mixed, removed: [] });
      expect(cleanThesisWay(low, mixed)).toEqual({ plan: mixed, removed: [] });
      // The other way the student placed alone stays.
      expect(cleanThesisWay(low, planned("G6"))).toEqual({ plan: planned("G6"), removed: [] });
      expect(cleanThesisWay(high, planned("T1", "T2"))).toEqual({ plan: planned("T1", "T2"), removed: [] });
      // What the AI roadmap added off the recommended way (a roadmap before roadmap-v13) is proposed out, said without the GPA.
      const byAi = added(planned("T1", "T2"), ["T1", "T2"]);
      const aiClean = cleanThesisWay(high, byAi);
      expect(aiClean.removed).toEqual(["T1", "T2"]);
      expect(aiClean.plan.aiAdded!.codes).toEqual([]);
      expect(thesisCleanedText(high, aiClean.plan, aiClean.removed)).toBe("Đã bỏ khỏi kế hoạch Chuyên đề Tốt nghiệp 1 (T1) và Chuyên đề Tốt nghiệp 2 (T2) do lộ trình AI thêm trước đây: hệ thống đề xuất làm Đồ án Tốt nghiệp cho nhóm tự chọn TC307, chỉ cần một phương án. Bạn vẫn có thể tự thêm lại các học phần này nếu muốn chọn chúng.");
      expect(cleanThesisWay(low, byAi).removed).toEqual([]);
      // The AI's chuyên đề beside the student's own Đồ án tốt nghiệp: proposed out, for the student's choice.
      const chose = added({ schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "T1" }, { code: "T2" }, { code: "G6" }] }] }, ["T1", "T2"]);
      const chosen = cleanThesisWay(low, chose);
      expect(chosen.removed).toEqual(["T1", "T2"]);
      expect(thesisCleanedText(low, chosen.plan, chosen.removed, true)).toBe("Bỏ khỏi kế hoạch Chuyên đề Tốt nghiệp 1 (T1) và Chuyên đề Tốt nghiệp 2 (T2) do lộ trình AI thêm trước đây: bạn đã chọn làm Đồ án Tốt nghiệp cho nhóm tự chọn TC307, chỉ cần một phương án.");
      // Kept by the student (Bỏ qua): theirs now, both ways stay.
      expect(cleanThesisWay(low, { ...chose, kept: ["T1", "T2"] }).removed).toEqual([]);
      // The thesis being written: the AI's chuyên đề go.
      const writing = context({ ...high, courses: high.courses.map((item) => (item.code === "G6" ? { ...item, state: "in_progress" as const, inProgressTerm: "HK261" } : item)),
        thesis: way({ path: "thesis_in_progress", way: "thesis" }) });
      expect(cleanThesisWay(writing, byAi).removed).toEqual(["T1", "T2"]);
      // No recommendation and no choice, or no thesis group: nothing changes.
      expect(cleanThesisWay(withThesis(way({})), byAi)).toEqual({ plan: byAi, removed: [] });
      expect(cleanThesisWay(withThesis(null), mixed)).toEqual({ plan: mixed, removed: [] });
    });
  });

  describe("asking before changing the plan (user 2026-11-04: \"Hỏi trước, bấm mới lưu\")", () => {
    const roadmapId = "99999999-9999-4999-8999-999999999999";
    const proposal: AiProposal = { roadmapId, completedAt: "2026-10-24T10:00:00.000Z", term: "HK262",
      courses: [{ code: "C", term: "HK262" }, { code: "E", term: "HK263" }] };
    const now = new Date("2026-11-04T10:00:00.000Z");
    const ctx = context({ courses: [...context().courses, course("L", { state: "passed", grade: "D" })] });

    it("proposes the AI roadmap's courses with their terms and leaves the plan as it is", () => {
      const current = withTerms(ctx, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "D" }] }] });
      const before = JSON.stringify(current);
      const proposed = planProposal(ctx, current, proposal, now)!;
      expect(JSON.stringify(current)).toBe(before);
      // C waits for D (its tiên quyết, failed), which the plan retakes in HK262: C goes after it, to the next HK2 a plan
      // opens it in (user 2026-11-08: never a course and its tiên quyết in one term).
      expect(proposed.added).toEqual([{ code: "C", term: "HK272" }, { code: "E", term: "HK263" }]);
      expect(proposed.roadmap).toEqual({ id: roadmapId, completedAt: proposal.completedAt, term: "HK262" });
      expect([proposed.aiRemoved, proposed.thesisRemoved, proposed.keepable]).toEqual([[], [], []]);
      // Applied, the plan remembers the roadmap and what it added.
      expect(proposed.plan.roadmapId).toBe(roadmapId);
      expect(proposed.plan.aiAdded).toEqual({ completedAt: proposal.completedAt, term: "HK262", codes: ["C", "E"], addedAt: now.toISOString() });
      expect(proposed.plan.terms.map((term) => [term.code, term.courses.map((item) => item.code)])).toEqual([["HK261", []], ["HK262", ["D"]], ["HK263", ["E"]], ["HK272", ["C"]]]);
      expect(proposed.moved).toEqual([]);
      expect(proposalAddedText(proposed)).toBe("Thêm 2 học phần do lộ trình AI đề xuất (lộ trình soạn lúc 17:00 24/10/2026), vào học kỳ mà kế hoạch đào tạo mở môn đó:");
      expect(proposalSummaryText(proposed)).toBe("thêm 2 học phần do lộ trình AI đề xuất");
    });

    it("proposes moving what an AI roadmap added after the courses it waits for: Anh văn 5, 6, 7 one term after the other (user 2026-11-08)", () => {
      const english = (code: string, prerequisites: string[], state: StudyPlanCourse["state"] = "not_taken") =>
        course(code, { name: `Anh văn ${code.slice(2)}`, prerequisites, state, everyTerm: true, ...(state === "in_progress" ? { inProgressTerm: "HK261" } : {}) });
      const av = context({ courses: [english("AV4", [], "in_progress"), english("AV5", ["AV4"]), english("AV6", ["AV5"]), english("AV7", ["AV6"]), course("OWN", { prerequisites: ["AV7"] })] });
      // An older roadmap put the three in HK262; the student placed OWN there too.
      const old = withTerms(av, {
        schemaVersion: 1, roadmapId: "r1", aiAdded: { completedAt: "2026-11-08T04:58:00.000Z", term: "HK262", codes: ["AV5", "AV6", "AV7"], addedAt: "2026-11-08T05:00:00.000Z" },
        terms: [{ code: "HK262", courses: [{ code: "AV5" }, { code: "AV6" }, { code: "AV7" }, { code: "OWN" }] }],
      });
      const proposed = planProposal(av, old, null, now)!;
      expect(proposed.moved).toEqual([{ code: "AV6", from: "HK262", to: "HK263" }, { code: "AV7", from: "HK262", to: "HK271" }]);
      expect(proposed.plan.terms.map((term) => [term.code, term.courses.map((item) => item.code)]))
        .toEqual([["HK261", []], ["HK262", ["AV5", "OWN"]], ["HK263", ["AV6"]], ["HK271", ["AV7"]]]);
      expect(proposalSummaryText(proposed)).toBe("chuyển 2 học phần ra sau môn tiên quyết");
      expect(proposed.keepable).toEqual(["AV6", "AV7"]);
      // The student's own placement keeps its warning; AV4 being studied counts as done for AV5.
      expect(planIssues(av, proposed.plan).get("OWN")?.prerequisites).toEqual(["AV7"]);
      expect(planIssues(av, proposed.plan).has("AV5")).toBe(false);
      // Applied, nothing is left to move; declined, the same moves never come back.
      expect(orderAiAdded(av, proposed.plan).moved).toEqual([]);
      expect(planProposal(av, declineProposal(old, proposed), null, now)).toBeNull();
    });

    it("proposes nothing once the roadmap is taken in or declined, or when it adds nothing", () => {
      const current = withTerms(ctx, { schemaVersion: 1, terms: [] });
      const applied = planProposal(ctx, current, proposal, now)!.plan;
      expect(planProposal(ctx, applied, proposal, now)).toBeNull();
      expect(planProposal(ctx, current, null, now)).toBeNull();
      const planned = moveCourse(moveCourse(current, "C", "HK262"), "E", "HK263");
      expect(planProposal(ctx, planned, proposal, now)).toBeNull();
      // Bỏ qua: the plan stays as it is, with the roadmap remembered.
      const proposed = planProposal(ctx, current, proposal, now)!;
      const declined = declineProposal(current, proposed);
      expect(declined).toEqual({ ...current, roadmapId });
      expect(planProposal(ctx, declined, proposal, now)).toBeNull();
    });

    it("proposes taking out what an older AI roadmap added, and never again once the student keeps it", () => {
      const old: StudyPlanData = withTerms(ctx, {
        schemaVersion: 1, roadmapId: "r1", aiAdded: { completedAt: "2026-10-20T07:24:00.000Z", term: "HK262", codes: ["C", "X", "L"], addedAt: "2026-10-20T07:30:00.000Z" },
        terms: [{ code: "HK262", courses: [{ code: "C" }, { code: "X" }, { code: "L" }] }],
      });
      const proposed = planProposal(ctx, old, null, now)!;
      expect([proposed.added, proposed.roadmap, proposed.aiRemoved, proposed.keepable]).toEqual([[], null, ["X", "L"], ["X", "L"]]);
      expect(proposed.plan.terms.find((term) => term.code === "HK262")!.courses.map((item) => item.code)).toEqual(["C"]);
      expect(proposalSummaryText(proposed)).toBe("bỏ 2 học phần");
      expect(aiCleanedText(ctx, proposed.aiRemoved, true)).toMatch(/^Bỏ khỏi kế hoạch 2 học phần lộ trình AI thêm trước đây vì/);
      // Bỏ qua keeps them: the plan does not change and the same proposal never comes back.
      const kept = declineProposal(old, proposed);
      expect(kept.kept).toEqual(["X", "L"]);
      expect(kept.terms).toEqual(old.terms);
      expect(kept.roadmapId).toBe("r1");
      expect(planProposal(ctx, kept, null, now)).toBeNull();
      expect(cleanAiAdded(ctx, kept).removed).toEqual([]);
      // Saved and read back, the plan still keeps them; taken out by hand, a course is kept no longer.
      expect(withTerms(ctx, kept).kept).toEqual(["X", "L"]);
      expect(moveCourse(kept, "x", null).kept).toEqual(["L"]);
      expect(moveCourse(kept, "X", "HK263").kept).toEqual(["X", "L"]);
      expect(withTerms(ctx, old)).not.toHaveProperty("kept");
    });

    describe("the thesis group", () => {
      const thesisCourses = [
        course("G6", { kind: "elective", credits: 6, name: "Đồ án Tốt nghiệp" }),
        course("T1", { kind: "elective", name: "Chuyên đề Tốt nghiệp 1" }),
        course("T2", { kind: "elective", name: "Chuyên đề Tốt nghiệp 2" }),
      ];
      const high = context({
        courses: [...context().courses, ...thesisCourses],
        thesis: { group: "Nhóm tự chọn TC307", thesis: "G6", replacements: ["T1", "T2"], others: [], path: "not_started", way: "thesis" },
      });

      it("keeps both ways of a plan the student filled and proposes nothing, saying one is enough (user 2026-11-10)", () => {
        const both = withTerms(high, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "G6" }, { code: "T1" }, { code: "T2" }] }] });
        expect(planProposal(high, both, null, now)).toBeNull();
        expect(thesisHint(high, both, "T1")).toMatch(/^Chỉ cần một phương án cho nhóm tự chọn TC307/);
      });

      it("never adds the AI's thesis beside the chuyên đề the student chose, and proposes the AI's chuyên đề out beside their Đồ án", () => {
        // The student planned the chuyên đề themselves; an AI roadmap proposes Đồ án (the recommended way): the student's way wins.
        const alone = withTerms(high, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "T1" }, { code: "T2" }] }] });
        const thesis: AiProposal = { ...proposal, courses: [{ code: "G6", term: "HK263" }] };
        expect(planProposal(high, alone, thesis, now)).toBeNull();
        // An older roadmap's chuyên đề beside the student's own Đồ án: proposed out (Áp dụng), kept by Bỏ qua.
        const mixed = withTerms(high, { schemaVersion: 1, roadmapId: "r1", aiAdded: { completedAt: "2026-11-03T07:24:00.000Z", term: "HK262", codes: ["T1", "T2"], addedAt: "2026-11-03T07:30:00.000Z" },
          terms: [{ code: "HK262", courses: [{ code: "T1" }, { code: "T2" }] }, { code: "HK263", courses: [{ code: "G6" }] }] });
        const proposed = planProposal(high, mixed, null, now)!;
        expect([proposed.thesisRemoved, proposed.keepable]).toEqual([["T1", "T2"], ["T1", "T2"]]);
        expect(thesisCleanedText(high, proposed.plan, proposed.thesisRemoved, true)).toBe("Bỏ khỏi kế hoạch Chuyên đề Tốt nghiệp 1 (T1) và Chuyên đề Tốt nghiệp 2 (T2) do lộ trình AI thêm trước đây: bạn đã chọn làm Đồ án Tốt nghiệp cho nhóm tự chọn TC307, chỉ cần một phương án.");
        const kept = declineProposal(mixed, proposed);
        expect(planProposal(high, kept, null, now)).toBeNull();
        expect(cleanThesisWay(high, kept).removed).toEqual([]);
      });
    });
  });

  it("names a term with the school year's en dash", () => {
    expect(termLabel("HK262")).toBe("HK2 2026–2027");
  });

  it("lists the courses still needed by requirement, finds courses by name and sums the credits", () => {
    // Another specialty's course (X) is never listed (user 2026-11-03: "không có đề xuất môn khác chuyên ngành nữa"); search finds it.
    expect(poolSections(context(), { schemaVersion: 1, terms: [] }).map((section) => [section.title, section.note, section.courses.map((item) => item.code)])).toEqual([
      ["Bắt buộc", "Còn 2 môn", ["C", "D"]], ["Nhóm tự chọn TC306", "Cần thêm 3 TC", ["E"]],
    ]);
    expect(poolSections(context(), plan).map((section) => section.title)).toEqual(["Nhóm tự chọn TC306"]);
    // E planned: TC306 has its 6 credits (F passed + E planned) and leaves the list.
    expect(poolSections(context(), moveCourse(plan, "E", "HK263")).map((section) => section.title)).toEqual([]);
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

describe("Theo dõi tiến độ counts every group as Xét tốt nghiệp (production report 2026-11-10, K29 HTTT)", () => {
  // A K29 HTTT student saw "Nhóm tự chọn TC209: 6/9 TC" here and 9/9 on Xét tốt nghiệp: the CTĐT file writes Chuyên đề
  // Thương mại điện tử 71ISGR40203 and Đại số tuyến tính và ứng dụng 71ITMA10203, the standard and the transcript
  // 71ITIS30503 and 71MATL10053. The API now sends those courses under the standard's real codes (curricula/real-codes.ts),
  // so each code of a standard group has its row. Synthetic states only.
  const real = context({
    cohortCode: "K29", specialty: null, specialtyLabel: null,
    courses: [
      course("71MATL10053", { name: "Đại số tuyến tính và ứng dụng", state: "passed", grade: "B", takenTerm: "HK231" }),
      course("71ITBS10103", { name: "Nhập môn Công nghệ thông tin", state: "passed", grade: "A", takenTerm: "HK231" }),
      course("71ITIS30403", { kind: "elective", group: "TC209", type: "TC209", state: "passed", grade: "B" }),
      course("71ITIS30503", { name: "Chuyên đề Thương mại điện tử", kind: "elective", group: "TC209", type: "TC209", state: "passed", grade: "B+" }),
      course("71ITIS30603", { kind: "elective", group: "TC209", type: "TC209", state: "passed", grade: "A" }),
      course("71ITIS30703", { kind: "elective", group: "TC209", type: "TC209" }),
    ],
    graduation: {
      standardName: "Tiêu chuẩn K29 HTTT", credits: { completed: 15, required: 120, source: "printed" },
      groups: [
        { label: "Học phần bắt buộc", kind: "mandatory", unit: "môn", required: 2, passed: 2, status: "pass", courseCodes: ["71MATL10053", "71ITBS10103"] },
        { label: "Nhóm tự chọn TC209", kind: "elective", unit: "TC", required: 9, passed: 9, status: "pass",
          courseCodes: ["71ITIS30403", "71ITIS30503", "71ITIS30603", "71ITIS30703"] },
      ],
    },
  });

  it("finds a row for every code of every group, and counts what the graduation evaluation counts", () => {
    const audit = auditGroups(real, plan, "official");
    expect(audit.map((group) => [group.label, group.done, group.required, group.rows.length])).toEqual(
      real.graduation!.groups.map((group) => [group.label, group.passed, group.required, group.courseCodes.length]));
    expect(audit.map(groupCountText)).toEqual(["Đã đủ 2 môn", "Đã đủ 9 TC"]);
  });

  it("was 6/9 TC (and 1/2 môn) while the rows carried the file's codes", () => {
    const filed: Record<string, string> = { "71ITIS30503": "71ISGR40203", "71MATL10053": "71ITMA10203" };
    const before = context({ ...real, courses: real.courses.map((item) => ({ ...item, code: filed[item.code] ?? item.code })) });
    const [mandatory, tc209] = auditGroups(before, plan, "official");
    expect([mandatory!.done, tc209!.done]).toEqual([1, 6]);
    expect(groupCountText(tc209!)).toBe("6/9 TC · còn thiếu 3 TC");
  });
});
