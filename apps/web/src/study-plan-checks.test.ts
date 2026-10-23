import { describe, expect, it } from "vitest";
import {
  PERIODS, addToSlot, changeSessions, clashes, conditionIssues, creditProgress, defaultTerms, issuesIfIn, mergeSuggestion, moveCourse, offering, placeSession, poolSections, termLabel, termLoad,
  type StudyPlanContext, type StudyPlanCourse, type StudyPlanData,
} from "./study-plan-checks";

// Synthetic courses only; no student data.
const course = (code: string, changes: Partial<StudyPlanCourse> = {}): StudyPlanCourse => ({
  code, name: `Môn ${code}`, credits: 3, type: "BB", kind: "mandatory", group: null, conditional: false, applicable: true, specialtyName: null,
  standardTerm: "HK262", sessions: ["LT", "TH"], prerequisites: [], prior: [], state: "not_taken", inProgressTerm: null, onlyInStandard: false, ...changes,
});
const context = (courses: StudyPlanCourse[], changes: Partial<StudyPlanContext> = {}): StudyPlanContext => ({
  cohortCode: "K30", specialty: "CNPM", specialtyLabel: "Công nghệ phần mềm", curriculum: { name: "CTĐT K30", totalCredits: 126 }, hasTranscript: true,
  currentTerm: "HK261", admissionYear: 2024, standardTerms: ["HK241", "HK271"], limits: { average: 12.6, min: 9, max: 18 }, courses,
  electiveGroups: [], graduation: null, ...changes,
});
const plan = (terms: Record<string, string[]>): StudyPlanData => ({ schemaVersion: 1, terms: Object.entries(terms).map(([code, courses]) => ({ code, courses: courses.map((item) => ({ code: item, sessions: [] })) })) });

describe("roadmap terms", () => {
  it("shows the running term to the end of the CTĐT, at least three terms", () => {
    expect(defaultTerms({ currentTerm: "HK261", standardTerms: ["HK241", "HK271"] })).toEqual(["HK261", "HK262", "HK263", "HK271"]);
    expect(defaultTerms({ currentTerm: "HK261", standardTerms: ["HK221", "HK251"] })).toEqual(["HK261", "HK262", "HK263"]);
    expect(termLabel("HK263")).toBe("HK3 · 2026-2027");
  });
});

describe("roadmap checks", () => {
  it("counts the credits of a term without GDTC/GDQP, with the courses being studied, and warns over or under the limits", () => {
    const ctx = context([course("A"), course("B", { credits: 18 }), course("PE", { conditional: true, credits: 2 }), course("R", { state: "in_progress", inProgressTerm: "HK262" })]);
    expect(termLoad(ctx, plan({ HK262: ["A", "PE"], HK263: ["B"] }), "HK262")).toEqual({ credits: 6, conditional: 2, status: "under" });
    expect(termLoad(ctx, plan({ HK262: ["A", "B"] }), "HK262")).toEqual({ credits: 24, conditional: 0, status: "over" });
    // The last term with courses, and a summer term, may be light.
    expect(termLoad(ctx, plan({ HK262: ["A"] }), "HK262").status).toBe("ok");
    expect(termLoad(ctx, plan({ HK263: ["A"], HK271: ["B"] }), "HK263").status).toBe("ok");
    expect(termLoad(ctx, plan({}), "HK271").status).toBe("empty");
  });

  it("flags a course whose prerequisite is neither passed, being studied nor planned earlier", () => {
    const ctx = context([course("A"), course("B", { prerequisites: ["A"] }), course("C", { prior: ["D"] }), course("D", { state: "failed" }),
      course("E", { prerequisites: ["F"] }), course("F", { state: "in_progress", inProgressTerm: "HK261" }), course("G", { prerequisites: ["OUTSIDE"] })]);
    expect([...conditionIssues(ctx, plan({ HK262: ["A", "B", "C", "E", "G"] }))]).toEqual([["B", { prerequisites: ["A"], prior: [] }]]);
    expect(conditionIssues(ctx, plan({ HK262: ["A"], HK263: ["B"] })).size).toBe(0);
  });

  it("finds sessions sharing a day and block", () => {
    const term = { code: "HK262", courses: [
      { code: "A", sessions: [{ kind: "LT" as const, day: 2, block: 3 }, { kind: "TH" as const, day: 5, block: 3 }] },
      { code: "B", sessions: [{ kind: "LT" as const, day: 2, block: 3 }, { kind: "TH" as const, day: null, block: null }] },
    ] };
    expect([...clashes(term)]).toEqual(["A#0", "B#0"]);
  });

  it("sums credits done, being studied and planned against the CTĐT total", () => {
    const ctx = context([course("A", { state: "passed" }), course("B", { state: "in_progress" }), course("C"), course("PE", { conditional: true, state: "passed" })]);
    expect(creditProgress(ctx, plan({ HK262: ["C"] }))).toEqual({ done: 3, running: 3, planned: 3, total: 126 });
  });

  it("lists what is left: mandatory, each graduation group with the credits it still needs, then other specialties", () => {
    const ctx = context([course("A"), course("B", { state: "passed" }), course("E1", { kind: "elective", group: "TC309" }), course("E2", { kind: "elective", group: "TC309", state: "passed" }),
      course("E3", { kind: "elective", group: "TC309" }), course("X", { applicable: false, specialtyName: "Công nghệ Dữ liệu" })], {
      graduation: { standardName: "Tiêu chuẩn", groups: [{ label: "Học phần bắt buộc", kind: "mandatory", unit: "môn", required: 2, passed: 1, courseCodes: ["A", "B"] },
        { label: "Nhóm tự chọn TC306", kind: "elective", unit: "TC", required: 9, passed: 3, courseCodes: ["E1", "E2", "E3"] }] },
    });
    expect(poolSections(ctx, plan({ HK262: ["E1"] })).map((section) => [section.title, section.note, section.courses.map((item) => item.code)])).toEqual([
      ["Bắt buộc", "Còn 1 môn", ["A"]], ["Nhóm tự chọn TC306", "Cần thêm 3 TC", ["E3"]], ["Chuyên ngành khác", "Không tính cho chuyên ngành của bạn", ["X"]]]);
  });
});

describe("roadmap edits", () => {
  const ctx = context([course("A"), course("B", { sessions: ["LT"] })]);
  it("adds a course with its LT/TH sessions, moves it with its sessions unplaced and returns it to the pool", () => {
    let current = moveCourse({ schemaVersion: 1, terms: [] }, ctx, "a", "HK263");
    expect(current.terms).toEqual([{ code: "HK263", courses: [{ code: "A", sessions: [{ kind: "LT", day: null, block: null }, { kind: "TH", day: null, block: null }] }] }]);
    current = placeSession(current, "HK263", "A", 1, { day: 4, block: 2 });
    expect(current.terms[0]!.courses[0]!.sessions[1]).toEqual({ kind: "TH", day: 4, block: 2 });
    expect(moveCourse(current, ctx, "A", "HK263")).toEqual(current);
    current = moveCourse(current, ctx, "A", "HK262");
    expect(current.terms.map((term) => [term.code, term.courses.map((item) => item.sessions.map((session) => session.day))])).toEqual([["HK262", [[null, null]]], ["HK263", []]]);
    expect(moveCourse(current, ctx, "A", null).terms.every((term) => !term.courses.length)).toBe(true);
  });

  it("adds a TH session to a lecture-only course, then LT, and removes one", () => {
    let current = moveCourse({ schemaVersion: 1, terms: [] }, ctx, "B", "HK262");
    current = changeSessions(current, "HK262", "B", { add: true });
    current = changeSessions(current, "HK262", "B", { add: true });
    expect(current.terms[0]!.courses[0]!.sessions.map((session) => session.kind)).toEqual(["LT", "TH", "LT"]);
    expect(changeSessions(current, "HK262", "B", { remove: 0 }).terms[0]!.courses[0]!.sessions.map((session) => session.kind)).toEqual(["TH", "LT"]);
  });

  it("keeps the weekly places of a course the suggestion leaves in the same term", () => {
    const current = placeSession(moveCourse({ schemaVersion: 1, terms: [] }, ctx, "A", "HK262"), "HK262", "A", 0, { day: 2, block: 1 });
    const suggested: StudyPlanData = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "A", sessions: [{ kind: "LT", day: null, block: null }] }, { code: "B", sessions: [] }] }] };
    expect(mergeSuggestion(current, suggested).terms[0]!.courses.map((item) => [item.code, item.sessions[0]?.day ?? null])).toEqual([["A", 2], ["B", null]]);
  });
});

describe("timetable as the main view (2026-10-24)", () => {
  const ctx = context([course("A"), course("B", { sessions: ["LT"], prerequisites: ["A"] }), course("T", { sessions: [] })]);
  it("puts a course dropped on a slot into the term and its first session on the slot, then the next one, then a new one", () => {
    let current = addToSlot({ schemaVersion: 1, terms: [] }, ctx, "HK262", "A", { day: 3, block: 2 });
    expect(current.terms).toEqual([{ code: "HK262", courses: [{ code: "A", sessions: [{ kind: "LT", day: 3, block: 2 }, { kind: "TH", day: null, block: null }] }] }]);
    current = addToSlot(current, ctx, "HK262", "A", { day: 5, block: 4 });
    current = addToSlot(current, ctx, "HK262", "A", { day: 6, block: 1 });
    expect(current.terms[0]!.courses[0]!.sessions).toEqual([{ kind: "LT", day: 3, block: 2 }, { kind: "TH", day: 5, block: 4 }, { kind: "LT", day: 6, block: 1 }]);
    // From another term it moves, and only the dropped session is placed.
    const moved = addToSlot(current, ctx, "HK263", "A", { day: 2, block: 1 });
    expect(moved.terms.map((term) => [term.code, term.courses.map((item) => item.sessions.filter((session) => session.day !== null).length)])).toEqual([["HK262", []], ["HK263", [1]]]);
    // A thesis without sessions only joins the term.
    expect(addToSlot({ schemaVersion: 1, terms: [] }, ctx, "HK262", "T", { day: 2, block: 1 }).terms[0]!.courses).toEqual([{ code: "T", sessions: [] }]);
  });

  it("tells what a course would miss in a term", () => {
    const plan: StudyPlanData = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "A", sessions: [] }] }] };
    expect(issuesIfIn(ctx, plan, "B", "HK262")).toEqual({ prerequisites: ["A"], prior: [] });
    expect(issuesIfIn(ctx, plan, "B", "HK263")).toBeUndefined();
  });

  it("numbers periods 1–15 with their start times, three per block", () => {
    expect([PERIODS.length, PERIODS[0], PERIODS[3], PERIODS[14]]).toEqual([15, { period: 1, start: "07:00", block: 1 }, { period: 4, start: "09:35", block: 2 }, { period: 15, start: "19:35", block: 5 }]);
  });
});

describe("classes by the training plans (2026-10-24)", () => {
  it("tells a term the plans open the course in, a likely one past the plans, one outside them, and no plans", () => {
    const withPlans = { offeringUntil: "HK281" };
    const course = { offeredTerms: ["HK252", "HK262"] };
    expect(["HK262", "HK263", "HK282", "HK283"].map((term) => offering(withPlans, course, term))).toEqual(["plan", "outside", "likely", "outside"]);
    expect(offering({ offeringUntil: null }, course, "HK263")).toBe("unknown");
    expect(offering(withPlans, { offeredTerms: [] }, "HK283")).toBe("unknown");
  });
});
