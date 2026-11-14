import { describe, expect, it } from "vitest";
import { calculateAssessment } from "../competency-assessment/calculate.js";
import { GRADUATION_CALC_VERSION } from "../competency-assessment/constants.js";
import {
  syntheticCurriculum, syntheticInputs, syntheticStandards, syntheticStudentTerms, syntheticTranscript, type TranscriptTerm,
} from "../competency-assessment/fixtures/synthetic-k29.js";
import type { AssessmentInputs, CurriculumCourseInput, GraduationStandardInput } from "../competency-assessment/types.js";
import type { GraduationStudent } from "../competency-assessment/graduation.js";
import { specialtyLabel } from "../competency-assessment/specialty.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import { otherSpecialtyCourses } from "./convertible.js";
import { evaluateGraduation, type GraduationEvaluation, MAX_IMPROVEMENT_CANDIDATES, MAX_LISTED_COURSES } from "./evaluation.js";

// Synthetic K29 data only (fixtures/synthetic-k29.json); no real student record.
const updatedAt = "2026-10-01T00:00:00.000Z";
const cnpm = () => syntheticStandards()[0]!;
const terms = () => syntheticStudentTerms();
type Row = TranscriptTerm["rows"][number];

function run(options: { terms?: TranscriptTerm[]; transcript?: TranscriptData; standard?: GraduationStandardInput; curriculum?: CurriculumCourseInput[] } = {}) {
  return evaluateGraduation({
    standard: options.standard ?? cnpm(),
    transcript: { version: "00000000-0000-4000-8000-0000000000f1", updatedAt, data: options.transcript ?? syntheticTranscript(options.terms ?? terms()) },
    curriculumCourses: options.curriculum ?? syntheticCurriculum().courses,
  });
}

/** Terms with the printed summaries of the last graded term replaced. */
const withSummaries = (summaries: [string, string][]) => terms().map((term) => (term.summaries ? { ...term, summaries } : term));
/** Terms with rows added to the term of that academic year and semester. */
const withRows = (base: TranscriptTerm[], year: string, semester: string, rows: Row[]) =>
  base.map((term) => (term.year === year && term.semester === semester ? { ...term, rows: [...term.rows, ...rows] } : term));
/** The CNPM standard reduced to one mandatory group of these courses, named "Học phần <index>". */
function oneGroup(courses: [code: string, credits: number | null][], data: Partial<GraduationStandardInput["data"]> = {}): GraduationStandardInput {
  const base = cnpm();
  return {
    ...base,
    data: {
      ...base.data, ...data, groups: [{ id: "BB", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: null, sourceRow: 1 }],
      courses: courses.map(([code, credits], index) => ({ id: `c${index}`, groupId: "BB", code, name: `Học phần ${index}`, credits, conditionOnly: false, sourceRow: index + 2 })),
    },
  };
}
/** Every course row of the groups, in group order then standard order. */
const courseRows = (evaluation: GraduationEvaluation) => evaluation.groups.flatMap((group) => group.courses);

describe("evaluation = the competency engine's numbers (D1, D2)", () => {
  const compare = (inputs: AssessmentInputs) => {
    const competency = calculateAssessment(inputs).graduation;
    const evaluation = evaluateGraduation({
      standard: inputs.graduation.standard!, transcript: { version: inputs.transcript.version, updatedAt, data: inputs.transcript.data },
      curriculumCourses: inputs.curriculum.courses,
    });
    expect(evaluation.groups.map((group) => ({
      groupId: group.id, label: group.label, kind: group.kind, code: group.code, unit: group.unit, lower: group.lower, upper: group.upper,
      required: group.required, status: group.status, accumulatedCredits: group.accumulatedCredits, curriculumElectiveCode: group.curriculumElectiveCode,
    }))).toEqual(competency.groups);
    const { remaining: _credits, ...credits } = evaluation.credits!;
    expect(credits).toEqual(competency.credits);
    const { remaining: _gpa, ...gpa } = evaluation.gpa;
    expect(gpa).toEqual(competency.gpa);
    expect({ status: evaluation.status, groupStatus: evaluation.groupStatus, needsImprovement: evaluation.needsImprovement })
      .toEqual({ status: competency.status, groupStatus: competency.groupStatus, needsImprovement: competency.needsImprovement });
    return evaluation;
  };

  it("gives the same groups, printed credits and GPA as calculateAssessment", () => {
    expect(compare(syntheticInputs())).toMatchObject({ calcVersion: GRADUATION_CALC_VERSION, credits: { source: "printed" }, gpa: { source: "printed" } });
  });

  it("gives the same estimates when nothing is printed", () => {
    const evaluation = compare(syntheticInputs({ terms: withSummaries([]) }));
    expect(evaluation).toMatchObject({ credits: { lower: 27, upper: 27, source: "calculated" }, gpa: { source: "calculated" } });
  });

  it("estimates over the program in both engines: the standard's credit first, standard courses outside the CTĐT included", () => {
    const inputs = syntheticInputs({ terms: withSummaries([]) });
    const standard = inputs.graduation.standard!;
    // 71ITSE30503 has 4 credits in the standard (3 in the CTĐT); this CTĐT lacks 71ITSE30103.
    inputs.graduation.standard = {
      ...standard,
      data: { ...standard.data, courses: standard.data.courses.map((course) => (course.code === "71ITSE30503" ? { ...course, credits: 4 } : course)) },
    };
    inputs.curriculum.courses = inputs.curriculum.courses.filter((course) => course.code !== "71ITSE30103");
    // compare() checks that calculateAssessment gives the same credits: 27 − 3 + 4 = 28 over the program
    // (the CTĐT credits alone would give 24).
    expect(compare(inputs).credits).toEqual({ lower: 28, upper: 28, required: 126, status: "fail", source: "calculated", remaining: 98 });
  });
});

describe("evaluateGraduation on the synthetic CNPM student", () => {
  const evaluation = run();
  const course = (code: string) => courseRows(evaluation).find((item) => item.code === code)!;

  it("dates the result and keeps the standard's groups in order with E1 labels and codes", () => {
    expect(evaluation.asOf).toEqual({ transcriptVersion: "00000000-0000-4000-8000-0000000000f1", transcriptUpdatedAt: updatedAt, latestTerm: "HK243" });
    // A repeated name stays as stored in `name`; only `label` tells the two TC102 groups apart.
    expect(evaluation.groups.map((group) => [group.id, group.name, group.label, group.code, group.curriculumElectiveCode])).toEqual([
      ["row-10", "Học phần bắt buộc", "Học phần bắt buộc", null, null],
      ["row-60", "Nhóm tự chọn TC102", "Nhóm tự chọn TC102 · 2 học phần, trong đó có 71PEKC10062", "TC102", "TC002"],
      ["row-64", "Nhóm tự chọn TC102", "Nhóm tự chọn TC102 · 2 học phần, trong đó có 71PEBA10052", "TC102", "TC102"],
      ["row-79", "Nhóm tự chọn TC209", "Nhóm tự chọn TC209", "TC209", "TC309"],
      ["row-92", "Nhóm tự chọn TC306", "Nhóm tự chọn TC306", "TC306", "TC406"],
    ]);
  });

  it("reports bounds, remaining amounts and counts per group", () => {
    expect(evaluation.groups.map((group) => [group.id, group.unit, group.lower, group.upper, group.required, group.remaining, group.status, group.passedCount, group.courseCount]))
      .toEqual([
        ["row-10", "môn", 8, 8, 10, 2, "fail", 8, 10],
        ["row-60", "TC", 2, 2, 2, null, "pass", 1, 2],
        ["row-64", "TC", 2, 2, 2, null, "pass", 1, 2],
        ["row-79", "TC", 6, 6, 6, null, "pass", 2, 6],
        ["row-92", "TC", 0, 0, 6, 6, "fail", 0, 3],
      ]);
    expect(evaluation.groups[4]).toMatchObject({ kind: "elective", minimumCredits: 6, accumulatedCredits: 0 });
    expect(evaluation.groups[0]!.courses.map((item) => item.code)).toEqual(cnpm().data.courses.filter((item) => item.groupId === "row-10").map((item) => item.code));
    expect(evaluation).toMatchObject({ status: "fail", groupStatus: "fail", needsImprovement: false });
  });

  it("describes every standard course with its selected attempt", () => {
    expect(course("71ITBS10203")).toEqual({
      code: "71ITBS10203", name: "Cơ sở lập trình", credits: 3, conditionOnly: false, groupId: "row-10", state: "passed", inferred: true,
      attempts: 2, score10: 6.6, score4: 2.5, letter: "C+", term: "HK232",
    });
    expect(course("71ITIS30103")).toMatchObject({ state: "exempt", inferred: false, attempts: 2, score10: null, score4: null, letter: "MT", term: "HK241" });
    expect(course("71ITSE41203")).toMatchObject({ state: "in_progress", attempts: 1, letter: null, term: "HK251" });
    expect(course("71ITIN40304")).toMatchObject({ state: "not_taken", attempts: 0, credits: 4, score10: null, letter: null, term: null });
    expect(course("71NAD110013")).toMatchObject({ conditionOnly: true, state: "passed" });
    expect(evaluation.inProgress.map((item) => item.code)).toEqual(["71ITSE41203"]);
    expect(evaluation.unknownResults).toEqual([]);
  });

  it("keeps the printed credits and GPA with what is left to reach them", () => {
    expect(evaluation.credits).toEqual({ lower: 27, upper: 27, required: 126, status: "fail", source: "printed", remaining: 99 });
    expect(evaluation.gpa).toEqual({ actual: 2.85, required: 2, scale: 4, status: "pass", source: "printed", reason: "", remaining: null });
    expect(evaluation.creditCheck).toEqual({ status: "match", printed: 27, computedLower: 27, computedUpper: 27 });
    expect(evaluation.improvementCandidates).toEqual([]);
  });

  it("leaves credits.remaining empty unless the credits fail", () => {
    const base = cnpm();
    const minimum = (minimumCredits: number): GraduationStandardInput => ({ ...base, data: { ...base.data, minimumCredits } });
    expect(run({ standard: minimum(27) }).credits).toEqual({ lower: 27, upper: 27, required: 27, status: "pass", source: "printed", remaining: null });
    // Nothing printed and 71ITSE30903 graded without a readable result: 27 certain credits, up to 30.
    const open = withRows(withSummaries([]), "2024-2025", "HK03", [["71ITSE30903", 3, 6.5, 2.5]]);
    expect(run({ standard: minimum(28), terms: open }).credits)
      .toEqual({ lower: 27, upper: 30, required: 28, status: "unknown", source: "calculated", remaining: null });
  });

  it("warns about inferred results on the standard's courses only", () => {
    // 12 transcript courses are inferred; 71ENG010000 is outside the standard.
    expect(evaluation.warnings).toEqual([{ code: "results_inferred", count: 11 }]);
  });
});

describe("lists outside the groups", () => {
  it("keeps at most MAX_LISTED_COURSES in-progress and unknown-result courses each, in standard order", () => {
    const codes = Array.from({ length: 50 }, (_, index) => `71ITXX${String(index).padStart(5, "0")}`);
    // The first 25 are registered without grades, the other 25 graded without a readable result; the transcript lists them backwards.
    const rows = codes.map((code, index): Row => (index < 25 ? [code, 3] : [code, 3, 6, 2])).reverse();
    const evaluation = run({ standard: oneGroup(codes.map((code): [string, number] => [code, 3])), curriculum: [], terms: [{ year: "2025-2026", semester: "HK01", rows }] });
    expect(MAX_LISTED_COURSES).toBe(20);
    expect(evaluation.inProgress.map((item) => item.code)).toEqual(codes.slice(0, 20));
    expect(evaluation.unknownResults.map((item) => item.code)).toEqual(codes.slice(25, 45));
    expect(evaluation.groups[0]!.courses).toHaveLength(50);
  });
});

describe("credit cross-check (E7)", () => {
  it("matches any printed total within the estimate's bounds and flags one below or above them", () => {
    const open = withRows(terms(), "2024-2025", "HK03", [["71ITSE30903", 3, 6.5, 2.5]]);
    for (const printed of ["27", "28.5", "30"]) {
      const withPrinted = open.map((term) => (term.summaries ? { ...term, summaries: [["Tổng số tín chỉ tích lũy", printed]] as [string, string][] } : term));
      expect(run({ terms: withPrinted }).creditCheck).toEqual({ status: "match", printed: Number(printed), computedLower: 27, computedUpper: 30 });
    }
    for (const printed of [26, 31]) {
      const outside = run({ terms: withSummaries([["Tổng số tín chỉ tích lũy", String(printed)]]) });
      expect(outside.creditCheck).toEqual({ status: "mismatch", printed, computedLower: 27, computedUpper: 27 });
      expect(outside.warnings).toEqual([
        { code: "results_inferred", count: 11 }, { code: "credits_mismatch", printed, computedLower: 27, computedUpper: 27 },
      ]);
    }
    expect(run({ terms: open }).unknownResults.map((item) => item.code)).toEqual(["71ITSE30903"]);
  });

  it("is unavailable without a readable printed total and falls back to the estimate (E5)", () => {
    const missing = run({ terms: withSummaries([]) });
    expect(missing.creditCheck).toEqual({ status: "unavailable", printed: null, computedLower: 27, computedUpper: 27 });
    // A term that prints no total is not an unreadable total.
    expect(missing.warnings).toEqual([{ code: "results_inferred", count: 11 }]);
    const unreadable = run({ terms: withSummaries([["Tổng số tín chỉ tích lũy", "27"], ["Số tín chỉ tích lũy", "28"]]) });
    expect(unreadable.creditCheck.status).toBe("unavailable");
    expect(unreadable.credits).toMatchObject({ lower: 27, upper: 27, source: "calculated" });
    expect(unreadable.warnings).toEqual([{ code: "results_inferred", count: 11 }, { code: "printed_credits_unreadable" }]);
  });
});

describe("cohorts without a CTĐT", () => {
  it("evaluates from the standard alone", () => {
    const evaluation = run({ curriculum: [], terms: withSummaries([]) });
    expect(evaluation.groups.map((group) => group.curriculumElectiveCode)).toEqual([null, null, null, null, null]);
    expect(evaluation.credits).toMatchObject({ lower: 27, upper: 27, source: "calculated" });
    expect(evaluation.groups.map((group) => group.status)).toEqual(["fail", "pass", "pass", "pass", "fail"]);
    expect(evaluation.creditCheck).toEqual({ status: "unavailable", printed: null, computedLower: 27, computedUpper: 27 });
    expect(evaluation.warnings).toEqual([{ code: "results_inferred", count: 11 }]);
  });
});

describe("GPA shortfall and improvement candidates", () => {
  const strict = (minimumGpa: number, gpaScale: 4 | 10 = 4): GraduationStandardInput => {
    const standard = cnpm();
    return { ...standard, data: { ...standard.data, minimumGpa, gpaScale } };
  };
  /** Passed GPA courses of the synthetic student below 3.2 on scale 4, in candidate order. */
  const passedBelow = ["71ITAI40103", "71ITSE30603", "71ITBS10203", "71ITIS30303", "71ITSE30503"];

  it("lists passed GPA courses below the required GPA, lowest score first, without MT or (*) courses", () => {
    const evaluation = run({ standard: strict(3.2) });
    expect(evaluation.gpa).toMatchObject({ actual: 2.85, required: 3.2, status: "fail", source: "printed" });
    expect(evaluation.gpa.remaining).toBeCloseTo(0.35, 9);
    expect(evaluation.improvementCandidates).toEqual([
      { code: "71ITAI40103", name: "Trí tuệ nhân tạo", credits: 3, score: 1.5, scale: 4, letter: "D+", state: "passed" },
      { code: "71ITSE30603", name: "Phát triển ứng dụng di động", credits: 3, score: 2, scale: 4, letter: "C", state: "passed" },
      { code: "71ITBS10203", name: "Cơ sở lập trình", credits: 3, score: 2.5, scale: 4, letter: "C+", state: "passed" },
      { code: "71ITIS30303", name: "Phân tích thiết kế hệ thống", credits: 3, score: 3, scale: 4, letter: "B", state: "passed" },
      { code: "71ITSE30503", name: "Lập trình ứng dụng Web", credits: 3, score: 3, scale: 4, letter: "B", state: "passed" },
    ]);
    // A grade equal to the required GPA is not below it.
    expect(run({ standard: strict(3) }).improvementCandidates.map((item) => item.code)).toEqual(["71ITAI40103", "71ITSE30603", "71ITBS10203"]);
  });

  it("adds failed, never passed courses (học lại) but not a course retaken now or graded without a readable result", () => {
    // 71ITIN40304 failed once; 71ITGR40203 failed and is registered again; 71ITGR40206 has no readable result.
    const graded = withRows(
      withRows(terms(), "2024-2025", "HK03", [["71ITIN40304", 4, 3, 0, "F"], ["71ITGR40203", 3, 2.5, 0, "F"], ["71ITGR40206", 6, 4, 1]]),
      "2025-2026", "HK01", [["71ITGR40203", 3]],
    );
    const evaluation = run({ standard: strict(3.2), terms: graded });
    expect(courseRows(evaluation).filter((row) => ["71ITIN40304", "71ITGR40203", "71ITGR40206"].includes(row.code)).map((row) => [row.code, row.state]))
      .toEqual([["71ITIN40304", "failed"], ["71ITGR40206", "graded_unknown"], ["71ITGR40203", "in_progress"]]);
    expect(evaluation.improvementCandidates.map((item) => item.code)).toEqual(["71ITIN40304", ...passedBelow]);
    expect(evaluation.improvementCandidates[0]).toEqual({ code: "71ITIN40304", name: "Đồ án thực tập", credits: 4, score: 0, scale: 4, letter: "F", state: "failed" });
  });

  it("lists a failed course at the F score the GPA estimate counts", () => {
    const rows: Row[] = [["71ITXX00001", 3, 8, 3.5, "B+"], ["71ITXX00002", 3, 3, 0, "F"], ["71ITXX00003", 3, 5.5, 2, "C"]];
    const standard = oneGroup(rows.map((row): [string, number] => [row[0], row[1]]), { minimumGpa: 6, gpaScale: 10 });
    const evaluation = run({ standard, curriculum: [], terms: [{ year: "2024-2025", semester: "HK01", rows }] });
    // (8·3 + 3·3 + 5.5·3) / 9 = 5.5; without the F the estimate would be 6.75.
    expect(evaluation.gpa).toMatchObject({ actual: 5.5, required: 6, scale: 10, status: "fail", source: "calculated", remaining: 0.5 });
    expect(evaluation.improvementCandidates).toEqual([
      { code: "71ITXX00002", name: "Học phần 1", credits: 3, score: 3, scale: 10, letter: "F", state: "failed" },
      { code: "71ITXX00003", name: "Học phần 2", credits: 3, score: 5.5, scale: 10, letter: "C", state: "passed" },
    ]);
  });

  it("uses the GPA's scale, prefers more credits on equal scores and keeps at most eight", () => {
    const rows = Array.from({ length: 10 }, (_, index): Row => [`71ITXX${String(index).padStart(5, "0")}`, index === 3 ? 4 : 3, 5, 1, "D"]);
    const standard = oneGroup(rows.map((row): [string, number] => [row[0], row[1]]), { minimumGpa: 6, gpaScale: 10 });
    const evaluation = run({ standard, curriculum: [], terms: [{ year: "2024-2025", semester: "HK01", rows }] });
    expect(evaluation.gpa).toMatchObject({ actual: 5, status: "fail", scale: 10, source: "calculated", remaining: 1 });
    expect(evaluation.needsImprovement).toBe(true);
    expect(evaluation.improvementCandidates).toHaveLength(MAX_IMPROVEMENT_CANDIDATES);
    expect(evaluation.improvementCandidates[0]).toEqual({ code: "71ITXX00003", name: "Học phần 3", credits: 4, score: 5, scale: 10, letter: "D", state: "passed" });
    expect(evaluation.improvementCandidates.slice(1).map((item) => item.code)).toEqual(["71ITXX00000", "71ITXX00001", "71ITXX00002", "71ITXX00004", "71ITXX00005", "71ITXX00006", "71ITXX00007"]);
  });

  it("treats GDTC/GDQP courses as condition-only by CTĐT block or 71NAD/71PE code when the standard has no flags, and never lists them", () => {
    const base = strict(3.2);
    const gdtc = { code: "GDTC0010", name: "Giáo dục thể chất tổng hợp", credits: 1 };
    const unflagged: GraduationStandardInput = {
      ...base,
      data: {
        ...base.data,
        courses: [
          ...base.data.courses.map((item) => ({ ...item, conditionOnly: false })),
          { id: "c-gdtc", groupId: "row-10", ...gdtc, conditionOnly: false, sourceRow: 99 },
        ],
      },
    };
    const curriculum: CurriculumCourseInput[] = [
      ...syntheticCurriculum().courses,
      { ...gdtc, type: "BB", block: "Giáo dục thể chất và giáo dục quốc phòng", specialty: "", semester: 1, studyYear: 1 },
    ];
    // GDTC0010 (D) and 71NAD110013, 71PETT10012 (B) are below the required 3.2 as well.
    const graded = withRows(terms(), "2023-2024", "HK01", [["GDTC0010", 1, 5, 1, "D"]]);
    const conditionOnly = (evaluation: GraduationEvaluation) => courseRows(evaluation).filter((row) => row.conditionOnly).map((row) => row.code);

    const withCurriculum = run({ standard: unflagged, curriculum, terms: graded });
    expect(conditionOnly(withCurriculum)).toEqual(["71NAD110013", "GDTC0010", "71PEKC10062", "71PESW10042", "71PEBA10052", "71PETT10012"]);
    expect(withCurriculum.improvementCandidates.map((item) => item.code)).toEqual(passedBelow);
    // Without a CTĐT only the 71NAD/71PE codes say so: GDTC0010 then counts like any course.
    const withoutCurriculum = run({ standard: unflagged, curriculum: [], terms: graded });
    expect(conditionOnly(withoutCurriculum)).toEqual(["71NAD110013", "71PEKC10062", "71PESW10042", "71PEBA10052", "71PETT10012"]);
    expect(withoutCurriculum.improvementCandidates.map((item) => item.code)).toEqual(["GDTC0010", ...passedBelow]);
  });

  it("leaves out 0-credit courses: 0 in the standard, or a 0-credit attempt the GPA estimate skips", () => {
    const base = strict(3.2);
    const standard: GraduationStandardInput = {
      ...base,
      data: {
        ...base.data,
        courses: [
          // 71ITAI40103 (D+, 3 credits on the transcript) is listed with 0 credits.
          ...base.data.courses.map((item) => (item.code === "71ITAI40103" ? { ...item, credits: 0 } : item)),
          // 3 credits in the standard, 0 on the transcript.
          { id: "c-zero", groupId: "row-10", code: "71ITXX00100", name: "Học phần tổng hợp", credits: 3, conditionOnly: false, sourceRow: 99 },
        ],
      },
    };
    const evaluation = run({ standard, terms: withRows(terms(), "2023-2024", "HK01", [["71ITXX00100", 0, 4.5, 1, "D"]]) });
    expect(courseRows(evaluation).filter((row) => row.code === "71ITAI40103" || row.code === "71ITXX00100").map((row) => [row.code, row.state, row.credits]))
      .toEqual([["71ITAI40103", "passed", 0], ["71ITXX00100", "passed", 3]]);
    expect(evaluation.improvementCandidates.map((item) => item.code)).toEqual(passedBelow.filter((code) => code !== "71ITAI40103"));
  });
});

describe("data warnings", () => {
  it("flags OCR review and a standard whose course codes repeat", () => {
    const ocr = syntheticTranscript(terms(), "vlu-ocr-1.1");
    ocr.ocr = { needsReview: true, pages: [], semesters: [] };
    expect(run({ transcript: ocr }).warnings.map((warning) => warning.code)).toEqual(["results_inferred", "ocr_needs_review"]);
    const base = cnpm();
    const repeated: GraduationStandardInput = { ...base, data: { ...base.data, courses: [...base.data.courses, { ...base.data.courses[0]!, id: "dup", groupId: "row-92" }] } };
    const evaluation = run({ standard: repeated });
    expect(evaluation.warnings.map((warning) => warning.code)).toContain("standard_ambiguous_codes");
    expect(evaluation.groups.every((group) => group.status === "unknown")).toBe(true);
    expect(evaluation.groupStatus).toBe("unknown");
    // A repeated code is listed once outside the groups.
    expect(evaluation.groups[4]!.courses.map((item) => item.code)).toContain("71ITBS10103");
    expect(evaluation.warnings.find((warning) => warning.code === "results_inferred")).toEqual({ code: "results_inferred", count: 11 });
  });

  it("keeps the remaining amount of a group that is still open", () => {
    const open = terms().map((term) => term.year === "2024-2025" && term.semester === "HK01"
      ? { ...term, rows: term.rows.map((row) => (row[0] === "71ITSE30603" ? [row[0], row[1], row[2], row[3]] as Row : row)) } : term);
    const group = run({ terms: open }).groups.find((item) => item.id === "row-79")!;
    expect(group).toMatchObject({ lower: 3, upper: 6, required: 6, remaining: 3, status: "unknown" });
  });
});

describe("GDTC (1)/(2) filling the 71PE electives of a K27/K28 standard (audit 2026-10-25)", () => {
  const k27 = (): GraduationStandardInput => {
    const base = cnpm();
    return {
      ...base,
      data: {
        ...base.data, minimumCredits: 3,
        groups: [
          { id: "BB", name: "Nhóm bắt buộc", kind: "mandatory", minimumCredits: null, sourceRow: 1 },
          { id: "PE", name: "Nhóm tự chọn TC104 (4TC)_Tự chọn giáo dục thể chất", kind: "elective", minimumCredits: 4, sourceRow: 2 },
        ],
        courses: [
          { id: "c0", groupId: "BB", code: "71ITBS10103", name: "Nhập môn Công nghệ thông tin", credits: 3, conditionOnly: false, sourceRow: 3 },
          ...["71PEBA10052", "71PEBB10032", "71PEDA10102"].map((code, index) => ({
            id: `p${index}`, groupId: "PE", code, name: `Thể thao ${index + 1} (*)`, credits: 2, conditionOnly: true, sourceRow: 4 + index,
          })),
        ],
      },
    };
  };
  const transcript = () => {
    const data = syntheticTranscript([{ year: "2023-2024", semester: "HK02", rows: [
      ["71ITBS10103", 3, 7, 3, "B", "Đạt"], ["DGT0010", 2, 8, 3.5, "B+", "Đạt"], ["DGT0020", 2, 7, 3, "B", "Đạt"],
    ] }]);
    const courses = data.sections[0]!.courses;
    courses[1]!.name = "Giáo dục thể chất (1) (*)";
    courses[2]!.name = "Giáo dục thể chất (2) (*)";
    for (const course of courses.slice(1)) course.conditional = true;
    return data;
  };

  it("passes the PE group (was 0/4 TC) and lists the GDTC rows first; the electives they fill read not taken", () => {
    const evaluation = run({ standard: k27(), transcript: transcript(), curriculum: [] });
    const group = evaluation.groups[1]!;
    expect(group).toMatchObject({ label: "Nhóm tự chọn TC104 – Tự chọn giáo dục thể chất", lower: 4, required: 4, status: "pass", passedCount: 2, courseCount: 5 });
    expect(group.courses.map((row) => [row.code, row.state, row.credits, row.inPlaceOf ?? null])).toEqual([
      ["DGT0010", "passed", 2, "71PEBA10052"], ["DGT0020", "passed", 2, "71PEBB10032"],
      ["71PEBA10052", "not_taken", 2, null], ["71PEBB10032", "not_taken", 2, null], ["71PEDA10102", "not_taken", 2, null],
    ]);
    expect(group.courses[0]).toEqual({
      code: "DGT0010", name: "Giáo dục thể chất (1) (*)", credits: 2, conditionOnly: true, groupId: "PE", state: "passed", inferred: false,
      attempts: 1, score10: 8, score4: 3.5, letter: "B+", term: "HK232", inPlaceOf: "71PEBA10052",
    });
    // Graduation only: no credit transfer, no other code for #curriculum, not outside the standard, no credits or GPA added.
    expect(evaluation).toMatchObject({ status: "pass", groupStatus: "pass", credits: { lower: 3, source: "calculated" }, gpa: { actual: 3, source: "calculated" } });
    expect(evaluation.creditTransfers).toBeUndefined();
    expect(evaluation.codeAliases).toBeUndefined();
    expect(evaluation.outsideStandard).toBeUndefined();
    expect(evaluation.warnings.map((warning) => warning.code)).toEqual([]);
  });
});

describe("what other pages read: other codes and passed courses outside the standard (audit 2026-10-25)", () => {
  it("lists every other code a standard course was counted through, a retake with a later cohort flagged as a transfer", () => {
    const standard = oneGroup([["DIT0070", 3], ["DIT0091", 3], ["DCT0080", 3]]);
    standard.data.courses[0]!.name = "Cơ sở dữ liệu";
    standard.data.courses[1]!.alternativeCodes = ["71ITDS30103", "71ITXX99999"];
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows: [
      ["DIT0070", 3, 3, 0, "F"], ["71ITIS30103", 3, 7, 3, "B"], ["71ITDS30103", 3, 8, 3.5, "B+"], ["DCT0080", 3, 8, 3.5, "B+"],
    ] }]);
    transcript.sections[0]!.courses[1]!.name = "Cơ sở dữ liệu";
    const evaluation = run({ standard, transcript, curriculum: [] });
    // 71ITXX99999 is another code of the standard that the transcript does not print: left out.
    expect(evaluation.codeAliases).toEqual([
      { code: "DIT0070", viaCode: "71ITIS30103", transfer: true },
      { code: "DIT0091", viaCode: "71ITDS30103", transfer: false },
    ]);
    expect(evaluation.outsideStandard).toBeUndefined();
  });

  it("lists the passed courses that map to no standard course, and changes no condition", () => {
    const standard = oneGroup([["71ITBS10103", 3]]);
    const rows: Row[] = [["71ITBS10103", 3, 8, 3.5, "B+"], ["DIT0410", 6, 8.5, 3.7, "A"], ["71ITXX00009", 3, 3, 0, "F"], ["71ITXX00010", 3]];
    const transcript = syntheticTranscript([{ rows: [["71ENG010012", 2, null, null, "MT"]] }, { year: "2024-2025", semester: "HK01", rows }]);
    transcript.sections[1]!.courses[1]!.name = "Khoá luận tốt nghiệp";
    const evaluation = run({ standard, transcript, curriculum: [] });
    expect(evaluation.outsideStandard).toEqual([
      { code: "71ENG010012", name: "Học phần tổng hợp", credits: 2, state: "exempt", score10: null, score4: null, letter: "MT", term: null },
      { code: "DIT0410", name: "Khoá luận tốt nghiệp", credits: 6, state: "passed", score10: 8.5, score4: 3.7, letter: "A", term: "HK241" },
    ]);
    const without = run({ standard, transcript: syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows: [rows[0]!] }]), curriculum: [] });
    expect(evaluation.groups).toEqual(without.groups);
    expect(evaluation.groupStatus).toBe(without.groupStatus);
  });
});

describe("retake with a later cohort under another code (2026-10-23)", () => {
  it("counts it, marks the row and lists it for a credit transfer; other evaluations stay as they were", () => {
    const standard = oneGroup([["DIT0070", 3], ["DCT0080", 3]]);
    standard.data.courses[0]!.name = "Cơ sở dữ liệu";
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows: [["71ITIS30103", 3, 7, 3, "B"], ["DCT0080", 3, 8, 3.5, "B+"]] }]);
    transcript.sections[0]!.courses[0]!.name = "Cơ sở dữ liệu";
    const evaluation = run({ standard, transcript, curriculum: [] });
    expect(evaluation.creditTransfers).toEqual([{ code: "DIT0070", name: "Cơ sở dữ liệu", viaCode: "71ITIS30103", viaName: "Cơ sở dữ liệu", credits: 3 }]);
    expect(evaluation.warnings).toContainEqual({ code: "credit_transfer_needed", count: 1 });
    expect(evaluation.groups[0]!.courses[0]).toMatchObject({ code: "DIT0070", state: "passed", transferFrom: "71ITIS30103" });
    expect(evaluation.groups[0]!.status).toBe("pass");
    const usual = run();
    expect("creditTransfers" in usual).toBe(false);
    expect(usual.groups.flatMap((group) => group.courses).some((course) => "transferFrom" in course)).toBe(false);
  });
});

describe("another specialty's passed courses count as specialty electives (comp-calc-v24, user 2026-11-14)", () => {
  // The synthetic CNPM student without 71ITIS30303: TC209 holds 3 of its 6 credits. 71ITAI40803 (Trí tuệ Nhân tạo) and
  // 71ITDS40303 (Công nghệ Dữ liệu) are mandatory courses of the other specialties, listed by no group of the CNPM standard.
  const base = terms().map((term) => ({ ...term, rows: term.rows.filter((row) => row[0] !== "71ITIS30303") }));
  const data = syntheticTranscript(withRows(base, "2024-2025", "HK03", [["71ITAI40803", 3, 8.5, 3.4, "A"], ["71ITDS40303", 3, 7, 3, "B"]]));
  const evaluate = (standard: GraduationStandardInput = cnpm(), student?: GraduationStudent) => evaluateGraduation({
    standard, transcript: { version: "00000000-0000-4000-8000-0000000000f1", updatedAt, data }, curriculumCourses: syntheticCurriculum().courses,
    ...(student ? { student } : {}),
  });
  const tc209 = (evaluation: GraduationEvaluation) => evaluation.groups.find((group) => group.code === "TC209")!;
  const outside = (evaluation: GraduationEvaluation) => (evaluation.outsideStandard ?? []).map((course) => course.code);

  it("adds their credits to the specialty electives group, lists them after its own courses and no longer outside the standard", () => {
    const before = evaluate();
    expect([tc209(before).lower, tc209(before).status]).toEqual([3, "fail"]);
    expect(outside(before)).toEqual(expect.arrayContaining(["71ITAI40803", "71ITDS40303"]));
    const after = evaluate(cnpm(), { specialty: "CNPM", cohortCode: "K29" });
    expect([tc209(after).lower, tc209(after).upper, tc209(after).status, tc209(after).remaining, tc209(after).accumulatedCredits])
      .toEqual([9, 9, "pass", null, 9]);
    expect(tc209(after).courses.slice(-2).map((row) => [row.code, row.fromSpecialty, row.state, row.credits])).toEqual([
      ["71ITDS40303", specialtyLabel("CNDL"), "passed", 3], ["71ITAI40803", specialtyLabel("TTNT"), "passed", 3]]);
    expect(tc209(after).courses.slice(0, -2).some((row) => "fromSpecialty" in row)).toBe(false);
    expect(outside(after)).not.toContain("71ITAI40803");
    expect(outside(after)).not.toContain("71ITDS40303");
    // Nothing else changes.
    const others = (evaluation: GraduationEvaluation) => evaluation.groups.filter((group) => group.code !== "TC209").map((group) => [group.lower, group.status]);
    expect(others(after)).toEqual(others(before));
  });

  it("counts a course of the student's own standard in its own group, and nothing without a specialty", () => {
    const cndl = evaluate(syntheticStandards()[1]!, { specialty: "CNDL", cohortCode: "K29" });
    // 71ITDS40303 is a mandatory course of the CNDL standard; CNPM's 71ITSE41003 (passed) and TTNT's 71ITAI40803 are the others.
    expect(cndl.groups.find((group) => group.kind === "mandatory")!.courses.find((row) => row.code === "71ITDS40303")?.state).toBe("passed");
    expect(tc209(cndl).courses.filter((row) => row.fromSpecialty).map((row) => row.code)).toEqual(["71ITSE41003", "71ITAI40803"]);
    expect(tc209(evaluate(cnpm(), { specialty: null, cohortCode: "K29" })).lower).toBe(3);
  });

  it("tells the pages which courses count and in which group; only the uncounted ones keep the reminder", () => {
    const counted = otherSpecialtyCourses(cnpm().data, syntheticCurriculum().courses, data, "K29", "CNPM");
    expect(counted.counted?.courses.map((course) => course.code)).toEqual(["71ITDS40303", "71ITAI40803"]);
    expect(counted.counted?.group).toBe(tc209(evaluate(cnpm(), { specialty: "CNPM", cohortCode: "K29" })).label);
    expect(counted.convertible?.courses).toEqual([]);
    // A standard without a group of specialty electives counts none: the mandatory ones keep the reminder (2026-11-08).
    const standard = cnpm();
    const noElectives = { ...standard.data, groups: standard.data.groups.filter((group) => !/TC209/.test(group.name)) };
    const none = otherSpecialtyCourses(noElectives, syntheticCurriculum().courses, data, "K29", "CNPM");
    expect(none.counted).toBeNull();
    expect(none.convertible?.courses.map((course) => course.code)).toEqual(["71ITDS40303", "71ITAI40803"]);
  });
});
