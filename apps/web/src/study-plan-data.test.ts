import { describe, expect, it } from "vitest";
import {
  applyProposal, auditGroups, auditNote, creditProgress, moveCourse, offering, planIssues, poolSections, searchCourses, termLoad, withTerms,
  type StudyPlanContext, type StudyPlanCourse, type StudyPlanData,
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

  it("counts the plan in the planned view", () => {
    const [mandatory, elective] = auditGroups(context(), plan, "planned");
    expect(mandatory!.rows.map((row) => row.mark)).toEqual(["done", "running", "planned", "planned"]);
    expect([mandatory!.remaining, mandatory!.complete]).toEqual([0, true]);
    expect(elective!.remaining).toBe(3);
    expect(auditNote(mandatory!.rows[2]!)).toBe("Kế hoạch · HK2 · 2026-2027");
    expect(auditNote(auditGroups(context(), plan, "official")[0]!.rows[3]!)).toBe("Chưa đạt (F) · kế hoạch HK2 · 2026-2027");
    expect(auditNote(mandatory!.rows[0]!)).toBe("B+ · HK1 · 2024-2025");
  });

  it("without a standard, groups the CTĐT: mandatory courses, then each elective group", () => {
    const plain = context({ graduation: null, electiveGroups: [{ code: "TC306", requiredCredits: 6, courseCodes: ["E", "F", "X"] }] });
    const groups = auditGroups(plain, plan, "official");
    expect(groups.map((group) => [group.label, group.required, group.rows.map((row) => row.course.code)])).toEqual([
      ["Học phần bắt buộc", 4, ["A", "B", "C", "D"]], ["Nhóm tự chọn TC306", 6, ["F", "E"]],
    ]);
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
    const { plan: next, added } = applyProposal(withTerms(context(), { ...plan, terms: [{ code: "HK263", courses: [{ code: "C" }] }] }), proposal);
    expect(added).toBe(1);
    expect(next.roadmapId).toBe(proposal.roadmapId);
    expect(next.terms.map((term) => [term.code, term.courses.map((item) => item.code)])).toEqual([["HK261", []], ["HK262", ["E"]], ["HK263", ["C"]]]);
    // A term the plan does not show yet is added in order; moving a course keeps the roadmap it came from.
    const later = applyProposal(plan, { ...proposal, courses: [{ code: "E", term: "HK271" }] }).plan;
    expect(later.terms.map((term) => term.code)).toEqual(["HK262", "HK271"]);
    expect(moveCourse(later, "E", "HK262").roadmapId).toBe(proposal.roadmapId);
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
    expect(creditProgress(context(), plan)).toEqual({ done: 6, running: 3, planned: 6, total: 30 });
  });
});
