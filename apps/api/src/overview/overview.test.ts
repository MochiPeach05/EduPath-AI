import { describe, expect, it } from "vitest";
import { assessWithoutHistory, calculateAssessment } from "../competency-assessment/calculate.js";
import { studyTermCode } from "../competency-assessment/course-state.js";
import { syntheticInputs, syntheticStudentTerms, syntheticTranscript, type TranscriptTerm } from "../competency-assessment/fixtures/synthetic-k29.js";
import type { CourseFact } from "../competency-assessment/types.js";
import { evaluateGraduation } from "../graduation/evaluation.js";
import type { PlanItem } from "../plans/model.js";
import type { RoadmapRow } from "../roadmap/jobs.js";
import { ROADMAP_ASSESSMENT, syntheticRoadmapFacts } from "../roadmap/test-fixture.js";
import type { StudyPlanCourse } from "../study-plan/context.js";
import {
  competencyOverview, graduationOverview, nextTermOverview, planTermsView, plannedTermLoad, progressOverview, roadmapOverview, runningOverview, termRef,
  transcriptOverview, transcriptRunning, type PlannerFacts,
} from "./overview.js";

// The builders of Tổng quan on the synthetic K29 fixture (synthetic students only).

/** The fixture's student without Kỹ thuật lập trình (planned HK232: late) and with Lập trình ứng dụng Web barred (CT, not retaken). */
const behindTerms = (): TranscriptTerm[] => syntheticStudentTerms().map((term) => ({
  ...term,
  rows: term.rows.filter((row) => row[0] !== "71ITSE30103").map((row) => (row[0] === "71ITSE30503" ? ["71ITSE30503", 3, null, null, "CT", "Không đạt"] : row)),
}));

describe("terms", () => {
  it("labels a term the one way of the student pages and finds the next one of the calendar", () => {
    expect(termRef("HK261")).toEqual({ code: "HK261", label: "HK1 2026–2027" });
    expect(nextTermOverview(new Date("2026-10-30T03:00:00Z"))).toEqual({
      code: "HK262", label: "HK2 2026–2027", start: "2026-12-21", end: "2027-04-04", daysUntil: 52,
    });
  });
});

describe("transcriptOverview", () => {
  it("copies the printed figures of the latest graded term and the GPA of each graded term", () => {
    const data = syntheticTranscript([
      { rows: [["71ENG010012", 2, null, null, "MT"]] },
      { year: "2025-2026", semester: "HK01", rows: [["71ITBS10103", 3, 8.6, 3.7, "A"]],
        summaries: [["Điểm TB học kỳ (Hệ 4)", "3,70"], ["Điểm TB tích lũy (Hệ 4)", "3,70"], ["Điểm TB tích lũy (Hệ 10)", "8,60"]] },
      { year: "2025-2026", semester: "HK02", rows: [["71ITBS10203", 3, 6.6, 2.5, "C+"]],
        summaries: [["Điểm TB học kỳ (Hệ 4)", "2,50"], ["Điểm TB học tập (Hệ 4)", "9,99"], ["Điểm TB tích lũy (Hệ 4)", "3.10"], ["Điểm TB tích lũy (Hệ 10)", "7,60"],
          ["Tổng số tín chỉ tích lũy", "6"], ["Xếp loại học tập tích lũy", "Khá"]] },
      { year: "2026-2027", semester: "HK01", rows: [["71ITSE30103", 3]] },
    ]);
    expect(transcriptOverview(data, "2026-10-29T02:00:00Z")).toEqual({
      updatedAt: "2026-10-29T02:00:00.000Z", gpa4: 3.1, gpa10: 7.6, rank: "Khá", credits: 6, gpaChange: -0.6,
      series: [
        { term: { code: "HK251", label: "HK1 2025–2026" }, termGpa4: 3.7, cumulativeGpa4: 3.7 },
        { term: { code: "HK252", label: "HK2 2025–2026" }, termGpa4: 2.5, cumulativeGpa4: 3.1 },
      ],
    });
    expect(transcriptRunning(data, "HK261")).toEqual([{ code: "71ITSE30103", name: "Học phần tổng hợp", credits: 3, retake: false, skills: [] }]);
    expect(transcriptRunning(data, null)).toEqual([]);
  });
});

describe("progressOverview", () => {
  it("lays the training plan out term by term with the student's course states and the credits left", () => {
    const inputs = syntheticInputs({ terms: behindTerms() });
    const engine = assessWithoutHistory(inputs);
    const studyTerm = studyTermCode(inputs.transcript.data);
    expect(studyTerm).toBe("HK251");
    const { progress, late } = progressOverview({ engine, plan: inputs.plan.revision!.data, studyTerm, totalCredits: 126, printedCredits: 27 });
    const terms = progress.terms.map((term) => [term.term.code, term.state, term.passedCredits, term.plannedCredits, term.courses.map((course) => `${course.code}|${course.state}|${course.detail}`)]);
    expect(terms.slice(0, 7)).toEqual([
      ["HK231", "done", 6, 6, ["71ITBS10103|passed|A", "71ITBS10203|passed|C+"]],
      ["HK232", "late", 0, 3, ["71ITSE30103|late|chưa học, trễ so với kế hoạch"]],
      ["HK233", "done", 3, 3, ["71ITIS30103|passed|MT (miễn)"]],
      ["HK241", "late", 3, 6, ["71ITSE30503|failed|cần học lại", "71ITSE30603|passed|C"]],
      ["HK242", "done", 0, 0, []],
      ["HK243", "done", 9, 9, ["71ITSE41003|passed|A", "71ITAI40103|passed|D+", "71ITIS30303|passed|B"]],
      ["HK251", "running", 0, 3, ["71ITSE41203|running|đang học"]],
    ]);
    expect(late).toEqual([{ code: "71ITSE30103", name: "Kỹ thuật lập trình", term: "HK232", credits: 3 }]);
    expect(progress).toMatchObject({
      blocked: null, totalCredits: 126, passedCredits: 27, runningCredits: 3, remainingCredits: 96, termsLeft: 1, creditsPerTerm: 96, planMaxPerTerm: 4,
    });
    expect(progress.lateCredits).toBe(engine.progress!.lateCredits);
  });

  it("is blocked as plan_unavailable without a training plan", () => {
    const inputs = syntheticInputs({ plan: false });
    const { progress } = progressOverview({ engine: assessWithoutHistory(inputs), plan: null, studyTerm: "HK251", totalCredits: null, printedCredits: null });
    expect(progress).toMatchObject({ blocked: "plan_unavailable", terms: [], termsLeft: null, creditsPerTerm: null, remainingCredits: null, planMaxPerTerm: null });
  });

  it("lists a failed option of two choices once, in the first choice, without asking for a retake", () => {
    const fact = (code: string, state: CourseFact["state"]): CourseFact => ({
      code, name: `Môn ${code}`, credits: 3, type: "Tự chọn", specialty: null, electiveGroup: null, conditionOnly: false, applicable: true, state,
      outcome: null, inferred: false, score10: null, letter: state === "failed" ? "F" : null, attempts: state === "not_taken" ? 0 : 1,
      term: state === "not_taken" ? null : "HK241", plannedTerm: null, plannedTermSource: null,
    });
    const item = (position: number, code: string, termCode: string): PlanItem => ({
      id: `row-${position}`, position, code, name: `Môn ${code}`, credits: 3, type: "Tự chọn", termCode, semester: Number(termCode[4]), studyYear: 2,
      sectionId: `choice-${termCode}`, prerequisite: "", prior: "", notes: "", hours: { lecture: null, practice: null, project: null, internship: null },
      sourceRow: position, sourceSheet: "KHĐT", sourceCells: {},
    });
    const codes = ["HK241", "HK243"];
    const plan = {
      terms: codes.map((code) => ({ code, semester: Number(code[4]), studyYear: 2, sourceCredits: 3 })),
      sections: codes.map((termCode, index) => ({ id: `choice-${termCode}`, termCode, label: "Chọn 1 trong 2 môn sau", kind: "choice" as const, sourceRow: index })),
      items: [item(1, "X1", "HK241"), item(2, "X2", "HK241"), item(3, "X1", "HK243"), item(4, "X3", "HK243")],
    };
    const rows = (x2: CourseFact["state"]) => planTermsView(plan, [fact("X1", "failed"), fact("X2", x2), fact("X3", "not_taken")], "HK251").terms
      .map((term) => [term.term.code, term.courses.map((course) => `${course.code}|${course.state}|${course.detail}`)]);
    expect(rows("not_taken")).toEqual([
      ["HK241", ["X1|failed|học lại hoặc chọn môn khác", "|late|chưa chọn, trễ so với kế hoạch"]],
      ["HK243", ["|late|chưa chọn, trễ so với kế hoạch"]],
    ]);
    expect(rows("passed")).toEqual([
      ["HK241", ["X2|passed|Đạt", "X1|failed|đã chọn môn khác"]],
      ["HK243", ["|late|chưa chọn, trễ so với kế hoạch"]],
    ]);
  });
});

describe("graduationOverview", () => {
  it("lists every condition of the student's standard, naming the mandatory courses still missing", () => {
    const inputs = syntheticInputs();
    const standard = inputs.graduation.standard!;
    const evaluation = evaluateGraduation({ standard, transcript: { version: inputs.transcript.version, updatedAt: "2026-10-29T00:00:00Z", data: inputs.transcript.data }, curriculumCourses: inputs.curriculum.courses });
    const result = graduationOverview({ standard, evaluation })!;
    expect(result.standardName).toBe(standard.data.name);
    expect(result.eligible).toBe(false);
    expect(result.conditions[0]).toEqual({ label: "Tín chỉ tích lũy", done: 27, need: 126, unit: "TC", met: false, note: null });
    expect(result.conditions[1]).toEqual({ label: "Học phần bắt buộc", done: 8, need: 10, unit: "môn", met: false, note: "Còn: Đồ án thực tập, Kiểm thử phần mềm" });
    // Two GDTC groups share TC102: they keep the labels that tell them apart.
    const labels = result.conditions.map((condition) => condition.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("Nhóm tự chọn TC209");
    expect(result.conditions.at(-1)).toEqual({ label: "GPA tích lũy từ 2,00", done: "2,85", need: null, unit: "", met: true, note: null });
    expect(result.missing).toBe(result.conditions.filter((condition) => !condition.met).length);
    expect(graduationOverview({ standard: null, evaluation: null })).toBeNull();
  });
});

describe("competencyOverview", () => {
  const inputs = syntheticInputs();
  const computed = calculateAssessment(inputs);
  const current = { transcriptVersion: inputs.transcript.version, specialty: "CNPM", careerId: inputs.career!.id };

  it("summarises the latest assessment: level, best skills and the target career's missing skills", () => {
    const result = competencyOverview({ createdAt: "2026-10-28T01:00:00Z", computed }, current)!;
    expect(result).toMatchObject({ assessedAt: "2026-10-28T01:00:00.000Z", overallScore: computed.overall.score, overallLevel: computed.overall.levelLabel, stale: false });
    expect(result.strengths).toHaveLength(3);
    expect(result.strengths[0]!.score).toBeGreaterThanOrEqual(result.strengths[2]!.score);
    expect(result.career).toMatchObject({ name: computed.career!.nameVi, fitLabel: computed.career!.fitLabel, met: computed.career!.counts.met, total: computed.career!.counts.total });
    expect(result.career!.gaps.map((gap) => [gap.name, gap.status, gap.label])).toEqual([["C#/C++", "no_data", "Chưa đủ dữ liệu"], ["Docker", "no_data", "Chưa đủ dữ liệu"]]);
  });

  it("names the courses each strength's score comes from, largest share first, with the letter that counts", () => {
    const result = competencyOverview({ createdAt: "2026-10-28T01:00:00Z", computed }, current)!;
    const byCode = new Map(computed.courses.map((course) => [course.code, course]));
    const scored = computed.skills.filter((item) => item.score !== null && !item.conditionOnly);
    for (const [index, strength] of result.strengths.entries()) {
      const expected = scored[index]!.evidenceCourses.filter((row) => row.role === "score").sort((a, b) => b.contribution - a.contribution)
        .map((row) => ({ name: byCode.get(row.code)!.name, letter: byCode.get(row.code)!.letter }));
      expect(strength.courses).toEqual(expected);
      expect(strength.courses.length).toBeGreaterThan(0);
    }
  });

  it("writes a shortfall that adds up with the score as the pages show it, and reads the fit label from its code", () => {
    const requirement = computed.career!.requirements[0]!;
    const below = {
      ...computed,
      career: {
        ...computed.career!, fitLabel: "Xuất sắc", fitCode: "low_fit" as const,
        requirements: [{ ...requirement, status: "below" as const, isRequired: true, threshold: 62.5, score: 59.86, deficit: 2.64 }],
      },
    };
    const result = competencyOverview({ createdAt: "2026-10-28T01:00:00Z", computed: below }, current)!;
    expect(result.career!.gaps[0]!.label).toBe("Dưới ngưỡng · thiếu 2,7 điểm");
    expect(result.career!.fitLabel).toBe("Ít phù hợp");
    const upcoming = { ...below, career: { ...below.career, requirements: [{ ...requirement, status: "upcoming" as const, upcomingTerm: "HK262" }] } };
    expect(competencyOverview({ createdAt: "2026-10-28T01:00:00Z", computed: upcoming }, current)!.career!.gaps[0]!.label).toBe("Sắp học · HK2 2026–2027");
  });

  it("marks an assessment made from another transcript, specialty or career as stale, and returns null without one", () => {
    expect(competencyOverview({ createdAt: "2026-10-28T01:00:00Z", computed }, { ...current, transcriptVersion: "00000000-0000-4000-8000-0000000000f2" })!.stale).toBe(true);
    expect(competencyOverview({ createdAt: "2026-10-28T01:00:00Z", computed }, { ...current, specialty: "CNDL" })!.stale).toBe(true);
    expect(competencyOverview({ createdAt: "2026-10-28T01:00:00Z", computed }, { ...current, careerId: null })!.stale).toBe(true);
    expect(competencyOverview(null, current)).toBeNull();
  });
});

describe("roadmapOverview", () => {
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
  const credits = new Map([["71ITSE30803", 3], ["71ITIS30203", 3]]);
  const now = new Date("2026-10-25T03:00:00Z");

  it("lists retakes first, then the AI's picks, with the picked skills, the first month with a text and the planned credits", () => {
    const saved = { schemaVersion: 1 as const, terms: [{ code: "HK262", courses: [{ code: "71ITSE30803" }, { code: "71ITIS30203" }] }] };
    expect(roadmapOverview(row(), saved, credits, now)).toEqual({
      status: "completed", createdAt: "2026-10-24T03:00:00.000Z", term: { code: "HK262", label: "HK2 2026–2027" },
      courses: [
        { code: "71ITBS10203", name: "Cơ sở lập trình", credits: 3, reason: "Học lại" },
        { code: "71ITSE30803", name: "Lập trình Web nâng cao với framework", credits: 3, reason: "Tự chọn TC309" },
        { code: "71ITIS30203", name: "Hệ quản trị cơ sở dữ liệu", credits: 3, reason: "Trễ kế hoạch" },
        { code: "71ITAI40103", name: "Trí tuệ nhân tạo", credits: 3, reason: "Học cải thiện" },
        { code: "71ITIN40304", name: "Đồ án thực tập", credits: 4, reason: "Theo kế hoạch" },
      ],
      skills: ["Docker"], firstMonth: { label: "Tháng 1/2027", text: "Tập trung." }, plan: { credits: 6, status: "ok" }, limits: null,
    });
  });

  it("checks the saved term with the planner's limits, as Kế hoạch học kỳ does", () => {
    const saved = { schemaVersion: 1 as const, terms: [{ code: "HK262", courses: [{ code: "71ITSE30803" }, { code: "71ITIS30203" }] }] };
    const planner: PlannerFacts = { courses: [plannerCourse("71ITSE30803", 3), plannerCourse("71ITIS30203", 3)], limits: { average: 4, min: 3, max: 5 } };
    expect(roadmapOverview(row(), saved, credits, now, planner)).toMatchObject({ plan: { credits: 6, status: "over" }, limits: { min: 3, max: 5 } });
    expect(roadmapOverview(row(), null, credits, now, planner)).toMatchObject({ plan: null, limits: { min: 3, max: 5 } });
  });

  it("shows nothing of a roadmap still being written, and null without one", () => {
    expect(roadmapOverview(row({ status: "processing", completedAt: null }), null, credits, now))
      .toMatchObject({ status: "pending", courses: [], skills: [], firstMonth: null, plan: null, limits: null });
    expect(roadmapOverview(row({ status: "failed" }), null, credits, now)!.status).toBe("failed");
    expect(roadmapOverview(null, null, credits, now)).toBeNull();
  });
});

function plannerCourse(code: string, credits: number, extra: Partial<StudyPlanCourse> = {}): StudyPlanCourse {
  return {
    code, name: `Môn ${code}`, credits, type: "BB", kind: "mandatory", group: null, conditional: false, applicable: true, specialtyName: null,
    standardTerm: null, prerequisites: [], prior: [], state: "not_taken", inProgressTerm: null, onlyInStandard: false, planTerm: null,
    offeredTerms: [], grade: null, takenTerm: null, attempts: 0, equivalent: null, ...extra,
  };
}

describe("plannedTermLoad", () => {
  // The planner's limits for 126 credits over 10 terms: 9 to 18 credits per term.
  const limits = { average: 12.6, min: 9, max: 18 };
  const courses = ["A", "B", "C", "D", "E", "F", "G"].map((letter) => plannerCourse(`X${letter}`, 3));
  const plan = (terms: Record<string, string[]>) => ({
    schemaVersion: 1 as const, terms: Object.entries(terms).map(([code, codes]) => ({ code, courses: codes.map((item) => ({ code: item })) })),
  });

  it("flags a term above the maximum or under the minimum like the planner", () => {
    const planner: PlannerFacts = { courses, limits };
    expect(plannedTermLoad(planner, plan({ HK262: ["XA", "XB", "XC", "XD", "XE", "XF", "XG"] }), "HK262")).toEqual({ credits: 21, status: "over" });
    expect(plannedTermLoad(planner, plan({ HK262: ["XA", "XB", "XC", "XD", "XE", "XF"] }), "HK262")).toEqual({ credits: 18, status: "ok" });
    // Under the minimum only in HK1/HK2 and not in the last term with courses.
    expect(plannedTermLoad(planner, plan({ HK262: ["xa", "XB"], HK271: ["XC"] }), "HK262")).toEqual({ credits: 6, status: "under" });
    expect(plannedTermLoad(planner, plan({ HK262: ["XA", "XB"] }), "HK262")).toEqual({ credits: 6, status: "ok" });
    expect(plannedTermLoad(planner, plan({ HK263: ["XA"], HK271: ["XB"] }), "HK263")).toEqual({ credits: 3, status: "ok" });
    expect(plannedTermLoad(planner, plan({ HK262: [] }), "HK262")).toEqual({ credits: 0, status: "empty" });
    expect(plannedTermLoad({ courses, limits: null }, plan({ HK262: ["XA", "XB", "XC", "XD", "XE", "XF", "XG"] }), "HK262")).toEqual({ credits: 21, status: "ok" });
  });

  it("counts a course being studied that term once, and an unknown code not at all", () => {
    const running = plannerCourse("XR", 4, { state: "in_progress", inProgressTerm: "HK262" });
    const planner: PlannerFacts = { courses: [...courses, running], limits };
    expect(plannedTermLoad(planner, plan({ HK262: ["XA", "ZZZ"], HK271: ["XB"] }), "HK262")).toEqual({ credits: 7, status: "under" });
    expect(plannedTermLoad(planner, plan({ HK262: ["XA", "XR"], HK271: ["XB"] }), "HK262")).toEqual({ credits: 7, status: "under" });
  });
});

describe("runningOverview", () => {
  it("lists the courses in progress with the skills the faculty links to them", () => {
    const inputs = syntheticInputs();
    expect(runningOverview(assessWithoutHistory(inputs), inputs)).toEqual([
      { code: "71ITSE41203", name: "Kiểm thử phần mềm", credits: 3, retake: false, skills: ["Kiểm thử phần mềm"] },
    ]);
  });
});
