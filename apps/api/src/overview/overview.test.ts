import { describe, expect, it } from "vitest";
import { assessWithoutHistory, calculateAssessment } from "../competency-assessment/calculate.js";
import { studyTermCode } from "../competency-assessment/course-state.js";
import { syntheticInputs, syntheticStudentTerms, syntheticTranscript, type TranscriptTerm } from "../competency-assessment/fixtures/synthetic-k29.js";
import type { CourseFact } from "../competency-assessment/types.js";
import { evaluateGraduation } from "../graduation/evaluation.js";
import type { PlanItem } from "../plans/model.js";
import type { RoadmapRow } from "../roadmap/jobs.js";
import { ROADMAP_ASSESSMENT, syntheticRoadmapFacts } from "../roadmap/test-fixture.js";
import {
  competencyOverview, graduationOverview, nextTermOverview, planTermsView, progressOverview, roadmapOverview, runningOverview, termLabel, transcriptOverview,
  transcriptRunning,
} from "./overview.js";

// The builders of Tổng quan on the synthetic K29 fixture (synthetic students only).

/** The fixture's student without Kỹ thuật lập trình (planned HK232: late) and with Lập trình ứng dụng Web barred (CT, not retaken). */
const behindTerms = (): TranscriptTerm[] => syntheticStudentTerms().map((term) => ({
  ...term,
  rows: term.rows.filter((row) => row[0] !== "71ITSE30103").map((row) => (row[0] === "71ITSE30503" ? ["71ITSE30503", 3, null, null, "CT", "Không đạt"] : row)),
}));

describe("terms", () => {
  it("labels a term and finds the next one of the calendar with the days left", () => {
    expect(termLabel("HK261")).toBe("Học kỳ 1, năm học 2026–2027");
    expect(nextTermOverview(new Date("2026-10-30T03:00:00Z"))).toEqual({
      code: "HK262", label: "Học kỳ 2, năm học 2026–2027", start: "2026-12-21", end: "2027-04-04", daysUntil: 52,
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
        { term: { code: "HK251", label: "Học kỳ 1, năm học 2025–2026" }, termGpa4: 3.7, cumulativeGpa4: 3.7 },
        { term: { code: "HK252", label: "Học kỳ 2, năm học 2025–2026" }, termGpa4: 2.5, cumulativeGpa4: 3.1 },
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
      status: "completed", createdAt: "2026-10-24T03:00:00.000Z", term: { code: "HK262", label: "Học kỳ 2, năm học 2026–2027" },
      courses: [
        { code: "71ITBS10203", name: "Cơ sở lập trình", credits: 3, reason: "Học lại" },
        { code: "71ITSE30803", name: "Lập trình Web nâng cao với framework", credits: 3, reason: "Tự chọn TC309" },
        { code: "71ITIS30203", name: "Hệ quản trị cơ sở dữ liệu", credits: 3, reason: "Trễ kế hoạch" },
        { code: "71ITAI40103", name: "Trí tuệ nhân tạo", credits: 3, reason: "Học cải thiện" },
        { code: "71ITIN40304", name: "Đồ án thực tập", credits: 4, reason: "Theo kế hoạch" },
      ],
      skills: ["Docker"], firstMonth: { label: "Tháng 1/2027", text: "Tập trung." }, plannedCredits: 6,
    });
  });

  it("shows nothing of a roadmap still being written, and null without one", () => {
    expect(roadmapOverview(row({ status: "processing", completedAt: null }), null, credits, now))
      .toMatchObject({ status: "pending", courses: [], skills: [], firstMonth: null, plannedCredits: null });
    expect(roadmapOverview(row({ status: "failed" }), null, credits, now)!.status).toBe("failed");
    expect(roadmapOverview(null, null, credits, now)).toBeNull();
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
