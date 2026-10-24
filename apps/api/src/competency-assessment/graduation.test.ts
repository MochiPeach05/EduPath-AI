import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GraduationData } from "../graduation/model.js";
import { deriveElectiveGroups, transcriptCourses } from "./course-state.js";
import { syntheticCurriculum, syntheticStandards, syntheticTranscript, type TranscriptRow } from "./fixtures/synthetic-k29.js";
import {
  assessGraduation, assessGraduationGpa, courseNameKey, decide, electiveQuotas, graduationCodeAliases, graduationGroupLabels, graduationInputs,
  groupCode, matchStandardElectiveGroup, programCreditMap, readableGroupName, standardCodeAliases, standardCourseCredits,
} from "./graduation.js";
import type { CurriculumCourseInput, GraduationResolution, TriState } from "./types.js";

type Expected = {
  groups: { id: string; lower: number; upper: number; required: number; status: TriState }[];
  groupStatus: TriState;
  credits: { lower: number; upper: number; required: number; source: "printed" | "calculated"; status: TriState };
  gpa: { status: TriState; source: "printed" | "calculated" };
  status: TriState;
};
type SharedFile = {
  term: { academicYear: string; semester: string };
  standard: Pick<GraduationData, "minimumCredits" | "minimumGpa" | "gpaScale" | "groups" | "courses"> & { groups: { id: string; name: string; kind: "mandatory" | "elective"; minimumCredits: number | null }[] };
  cases: { name: string; rows: TranscriptRow[]; summaries: [string, string][]; expected: Expected }[];
};

const shared = JSON.parse(readFileSync(new URL("./fixtures/graduation-cases.json", import.meta.url), "utf8")) as SharedFile;

function sharedStandard(): GraduationData {
  return {
    schemaVersion: 1, name: "Tiêu chuẩn tổng hợp", standardCode: "SYN_TN", cohortCode: "K29", classBlock: "SYN", major: "CNTT", specialty: "",
    educationSystem: "", faculty: "", minimumCredits: shared.standard.minimumCredits, mandatoryCredits: null, electiveCredits: null,
    freeElectiveCredits: null, minimumGpa: shared.standard.minimumGpa, gpaScale: shared.standard.gpaScale, notes: "",
    groups: shared.standard.groups.map((group, index) => ({ ...group, sourceRow: index + 1 })),
    courses: shared.standard.courses.map((course, index) => ({ ...course, sourceRow: index + 10 })),
    sourceWorkbook: "", sourceSheet: "", sourceNotes: [],
  };
}

type GroupSpec = { id: string; name: string; kind: "mandatory" | "elective"; minimumCredits: number | null };
type CourseSpec = { groupId: string; code: string; credits: number | null; conditionOnly?: boolean };

/** A small synthetic standard (minimumCredits null unless given). */
function smallStandard(groups: GroupSpec[], courses: CourseSpec[], extra: Partial<GraduationData> = {}): GraduationData {
  return {
    schemaVersion: 1, name: "Tiêu chuẩn tổng hợp", standardCode: "SYN_TN", cohortCode: "K27", classBlock: "SYN", major: "CNTT", specialty: "",
    educationSystem: "", faculty: "", minimumCredits: null, mandatoryCredits: null, electiveCredits: null, freeElectiveCredits: null,
    minimumGpa: 2, gpaScale: 4, notes: "",
    groups: groups.map((group, index) => ({ ...group, sourceRow: index + 1 })),
    courses: courses.map((course, index) => ({
      id: `c${index + 1}`, groupId: course.groupId, code: course.code, name: `Học phần ${course.code}`, credits: course.credits,
      conditionOnly: course.conditionOnly ?? false, sourceRow: index + 10,
    })),
    sourceWorkbook: "", sourceSheet: "", sourceNotes: [], ...extra,
  };
}

const ctdt = (code: string, credits: number, type = "BB", block = "Kiến thức cơ sở ngành"): CurriculumCourseInput =>
  ({ code, name: `Học phần ${code}`, credits, type, block, specialty: "", semester: 1, studyYear: 1 });

/** One graded term; no CTĐT unless given (the K26–K28 situation). */
function evaluate(data: GraduationData, rows: TranscriptRow[], options: { summaries?: [string, string][]; curriculum?: CurriculumCourseInput[] } = {}) {
  const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows, summaries: options.summaries ?? [] }]);
  return assessGraduation({
    resolution: "specialty", standard: { id: "s", revisionId: "r", version: 1, data }, ...graduationInputs(data, options.curriculum ?? [], transcript),
  });
}

describe("graduation port: shared web/API cases (spec §7.9)", () => {
  const standard = sharedStandard();

  for (const item of shared.cases) {
    it(item.name, () => {
      const transcript = syntheticTranscript([{ year: shared.term.academicYear, semester: shared.term.semester, rows: item.rows, summaries: item.summaries }]);
      // No CTĐT: the program is the standard, whose credits equal the transcript's.
      const summary = assessGraduation({
        resolution: "specialty", standard: { id: "s", revisionId: "r", version: 1, data: standard }, ...graduationInputs(standard, [], transcript),
      });
      expect(summary.groups.map(({ groupId, lower, upper, required, status }) => ({ id: groupId, lower, upper, required, status }))).toEqual(item.expected.groups);
      expect(summary.groupStatus).toBe(item.expected.groupStatus);
      expect(summary.credits).toMatchObject(item.expected.credits);
      expect(summary.gpa).toMatchObject(item.expected.gpa);
      expect(summary.status).toBe(item.expected.status);
    });
  }

  it("counts an absent VT attempt at 0 in the calculated GPA, like the transcript's semester GPA", () => {
    const transcript = syntheticTranscript([{ year: "2023-2024", semester: "HK01", rows: [
      ["71ITBS10103", 3, 8, 3.5, "B+", "Đạt"], ["71ENG110013", 3, null, null, "VT", "Không đạt"],
    ] }]);
    const records = transcriptCourses(transcript);
    expect(records.get("71ENG110013")?.state).toBe("failed");
    expect(assessGraduationGpa({ minimumGpa: 2, gpaScale: 4 }, transcript, records, new Set())).toMatchObject({ actual: 1.75, status: "fail", source: "calculated" });
  });

  it("keeps the GPA scale at 4 when the standard has none (K29)", () => {
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows: [["71ITBS10103", 3, 8, 3.5, "B+", "Đạt"]] }]);
    const gpa = assessGraduationGpa({ minimumGpa: 2, gpaScale: null }, transcript, transcriptCourses(transcript), new Set());
    expect(gpa).toMatchObject({ scale: 4, actual: 3.5, status: "pass", source: "calculated" });
  });
});

describe("standard groups are matched by course codes, never by name", () => {
  const cnpm = syntheticStandards()[0]!.data;
  const electives = deriveElectiveGroups(syntheticCurriculum().courses);

  it("maps TC209 ≡ TC309, TC306 ≡ TC406 and a 'TC102' label that holds the TC002 courses", () => {
    const byCode = Object.fromEntries(electives.map((group) => [group.code, matchStandardElectiveGroup(group.courseCodes, cnpm)?.name ?? null]));
    expect(byCode).toEqual({ TC002: "Nhóm tự chọn TC102", TC102: "Nhóm tự chọn TC102", TC309: "Nhóm tự chọn TC209", TC406: "Nhóm tự chọn TC306" });
    expect(matchStandardElectiveGroup(electives.find((group) => group.code === "TC002")!.courseCodes, cnpm)?.id).toBe("row-60");
  });

  it("takes quotas from the standard, else '(n TC)' in the CTĐT, else unknown", () => {
    const quotas = electiveQuotas(electives, cnpm);
    expect(Object.fromEntries([...quotas].map(([code, quota]) => [code, [quota.quota, quota.source]]))).toEqual({
      TC002: [2, "standard"], TC102: [2, "standard"], TC309: [6, "standard"], TC406: [6, "standard"],
    });
    const withoutStandard = electiveQuotas(electives, null);
    expect(Object.fromEntries([...withoutStandard].map(([code, quota]) => [code, [quota.quota, quota.source]]))).toEqual({
      TC002: [2, "curriculum"], TC102: [2, "curriculum"], TC309: [null, null], TC406: [null, null],
    });
  });
});

describe("E1: group labels and codes", () => {
  it("labels repeated names with their size and first code, keeps unique names, and reads TCxxx codes", () => {
    const cnpm = syntheticStandards()[0]!.data;
    const summary = evaluate(cnpm, []);
    expect(summary.groups.map((group) => [group.label, group.code, group.curriculumElectiveCode])).toEqual([
      ["Học phần bắt buộc", null, null],
      ["Nhóm tự chọn TC102 · 2 học phần, trong đó có 71PEKC10062", "TC102", null],
      ["Nhóm tự chọn TC102 · 2 học phần, trong đó có 71PEBA10052", "TC102", null],
      ["Nhóm tự chọn TC209", "TC209", null],
      ["Nhóm tự chọn TC306", "TC306", null],
    ]);
    // With the CTĐT the CTĐT elective codes are kept next to the standard's codes.
    const withCurriculum = evaluate(cnpm, [], { curriculum: syntheticCurriculum().courses });
    expect(withCurriculum.groups.map((group) => [group.code, group.curriculumElectiveCode])).toEqual([
      [null, null], ["TC102", "TC002"], ["TC102", "TC102"], ["TC209", "TC309"], ["TC306", "TC406"],
    ]);
  });

  it("compares names trimmed, uses normalized codes in standard order and handles an empty repeated group", () => {
    const data = smallStandard(
      [
        { id: "A", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 2 },
        { id: "B", name: " Nhóm tự chọn TC102 ", kind: "elective", minimumCredits: 2 },
        { id: "C", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 2 },
      ],
      [{ groupId: "B", code: " 71pebb10052 ", credits: 2 }, { groupId: "A", code: "71PEKC10062", credits: 2 }, { groupId: "B", code: "71PEBA10052", credits: 2 }],
    );
    expect([...graduationGroupLabels(data).values()]).toEqual([
      "Nhóm tự chọn TC102 · 1 học phần, trong đó có 71PEKC10062",
      "Nhóm tự chọn TC102 · 2 học phần, trong đó có 71PEBB10052",
      "Nhóm tự chọn TC102 · 0 học phần",
    ]);
  });

  it("writes the source files' group names as a student reads them, codes kept (audit 2026-10-25)", () => {
    const names: [raw: string, label: string][] = [
      ["Nhóm tự chọn TC104 (4TC)_Tự chọn giáo dục thể chất", "Nhóm tự chọn TC104 – Tự chọn giáo dục thể chất"],
      ["Nhóm tự chọn TC306_Tự chọn tốt nghiệp", "Nhóm tự chọn TC306 – Tự chọn tốt nghiệp"],
      ["Nhóm tự chọn TC533(27TC)-Tự chọn chuyên ngành", "Nhóm tự chọn TC533 – Tự chọn chuyên ngành"],
      ["Nhóm tự chọn TC509-Tự chọn chuyên ngành", "Nhóm tự chọn TC509 – Tự chọn chuyên ngành"],
      ["Nhóm tự chọn TC106 (6 TC)_Tự chọn cơ sở ngành", "Nhóm tự chọn TC106 – Tự chọn cơ sở ngành"],
      ["Nhóm tự chọn TC124 và nhóm tự chọn TC206", "Nhóm tự chọn TC124 + TC206"],
      ["Nhóm tự chọn TC104 (4TC)", "Nhóm tự chọn TC104"],
      ["Nhóm bắt buộc", "Nhóm bắt buộc"],
      ["  Nhóm tự chọn TC209 ", "Nhóm tự chọn TC209"],
    ];
    for (const [raw, label] of names) expect(readableGroupName(raw), raw).toBe(label);
    // NFD input (as some workbooks store it) reads the same.
    expect(readableGroupName("Nhóm tự chọn TC124 và nhóm tự chọn TC206".normalize("NFD"))).toBe("Nhóm tự chọn TC124 + TC206");
    const data = smallStandard(
      [
        { id: "PE", name: "Nhóm tự chọn TC104 (4TC)_Tự chọn giáo dục thể chất", kind: "elective", minimumCredits: 4 },
        { id: "X", name: "Nhóm tự chọn TC124 và nhóm tự chọn TC206", kind: "elective", minimumCredits: 24 },
      ],
      [{ groupId: "PE", code: "71PEKC10062", credits: 2, conditionOnly: true }, { groupId: "X", code: "DIT0330", credits: 3 }],
    );
    const summary = evaluate(data, []);
    expect(summary.groups.map((group) => [group.label, group.code])).toEqual([
      ["Nhóm tự chọn TC104 – Tự chọn giáo dục thể chất", "TC104"], ["Nhóm tự chọn TC124 + TC206", "TC124"],
    ]);
  });

  it("parses the group code from the name only as a whole TCxxx word", () => {
    expect(groupCode("Nhóm tự chọn TC306")).toBe("TC306");
    expect(groupCode("Nhóm tự chọn tc209 (6 TC)")).toBe("TC209");
    expect(groupCode("Học phần bắt buộc")).toBeNull();
    expect(groupCode("Nhóm TC3061")).toBeNull();
  });
});

describe("E2: pass on the lower bound, fail on the upper bound", () => {
  it("decides with a 1e-9 tolerance and passes a met lower bound even without an upper bound", () => {
    expect(decide(6, null, 6)).toBe("pass");
    expect(decide(5.9999999999, 6, 6)).toBe("pass");
    expect(decide(3, null, 6)).toBe("unknown");
    expect(decide(3, 6, 6)).toBe("unknown");
    expect(decide(3, 5, 6)).toBe("fail");
    expect(decide(null, 5, 6)).toBe("fail");
    expect(decide(null, null, 6)).toBe("unknown");
    expect(decide(6, 6, null)).toBe("unknown");
  });

  it("lets an elective group pass while a graded course's credits are unknown", () => {
    const data = smallStandard([{ id: "E", name: "Nhóm tự chọn TC209", kind: "elective", minimumCredits: 3 }], [
      { groupId: "E", code: "71ITSE30603", credits: 3 }, { groupId: "E", code: "71ITIS30203", credits: null },
    ]);
    // 71ITIS30203 is graded with no readable result and has no credit anywhere (0 on the transcript, none in the standard, no CTĐT).
    expect(evaluate(data, [["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 0, 6, 2]]).groups[0]).toMatchObject({ lower: 3, upper: null, required: 3, status: "pass" });
    expect(evaluate({ ...data, groups: [{ ...data.groups[0]!, minimumCredits: 6 }] }, [["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 0, 6, 2]]).groups[0])
      .toMatchObject({ lower: 3, upper: null, status: "unknown" });
  });
});

describe("E3: course credits fall back standard → CTĐT → transcript", () => {
  const data = smallStandard([{ id: "E", name: "Nhóm tự chọn TC209", kind: "elective", minimumCredits: 4 }], [{ groupId: "E", code: "71ITSE30603", credits: null }]);

  it("uses the CTĐT credit, then the selected attempt's transcript credit, else null", () => {
    const passed: TranscriptRow[] = [["71ITSE30603", 3, 7, 3, "B"]];
    expect(evaluate(data, passed, { curriculum: [ctdt("71ITSE30603", 4, "TC309")] }).groups[0]).toMatchObject({ lower: 4, status: "pass" });
    expect(evaluate(data, passed).groups[0]).toMatchObject({ lower: 3, upper: 3, status: "fail" });
    expect(evaluate(data, [["71ITSE30603", 0, 7, 3, "B"]]).groups[0]).toMatchObject({ lower: null, upper: null, status: "unknown" });
  });

  it("keeps the standard's own credit first", () => {
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows: [["71ITSE30603", 3, 7, 3, "B"]] }]);
    const record = transcriptCourses(transcript).get("71ITSE30603");
    expect(standardCourseCredits({ code: "71itse30603", credits: 2 }, new Map([["71ITSE30603", 4]]), record)).toBe(2);
    expect(standardCourseCredits({ code: "71itse30603", credits: null }, new Map([["71ITSE30603", 4]]), record)).toBe(4);
    expect(standardCourseCredits({ code: "71ITSE30603", credits: null }, new Map([["71ITSE30603", null]]), record)).toBe(3);
    expect(standardCourseCredits({ code: "71ITSE30603", credits: null }, new Map(), undefined)).toBeNull();
  });

  it("builds the program from the standard and the CTĐT (standard credit wins, null stays in the program)", () => {
    const standard = smallStandard([{ id: "E", name: "E", kind: "elective", minimumCredits: 2 }], [
      { groupId: "E", code: "a1", credits: 2 }, { groupId: "E", code: "B1", credits: null }, { groupId: "E", code: "C1", credits: null },
    ]);
    expect(Object.fromEntries(programCreditMap(standard, new Map([["A1", 3], ["B1", 4], ["D1", 0]])))).toEqual({ A1: 2, B1: 4, C1: null, D1: 0 });
  });
});

describe("E4: the credit estimate accumulates the program (standard ∪ CTĐT)", () => {
  const data = smallStandard(
    [{ id: "BB", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: null }, { id: "PE", name: "Nhóm tự chọn TC002", kind: "elective", minimumCredits: 2 }],
    [
      { groupId: "BB", code: "71ITBS10103", credits: 3 }, { groupId: "BB", code: "71ITBS10203", credits: 3 },
      { groupId: "BB", code: "71NAD110013", credits: 3, conditionOnly: true }, { groupId: "PE", code: "71PEKC10062", credits: 2, conditionOnly: true },
    ],
    { minimumCredits: 6 },
  );
  const rows: TranscriptRow[] = [
    ["71ITBS10103", 3, 8, 3.5, "B+"], ["71ITBS10203", 3, 7, 3, "B"], ["71NAD110013", 3, 7, 3, "B"], ["71PEKC10062", 2, 9, 4, "A"],
    ["71ENG010012", 2, null, null, "MT"],
  ];

  it("estimates a cohort without a CTĐT from the standard's courses (K26–K28 no longer estimate 0)", () => {
    expect(evaluate(data, rows).credits).toEqual({ lower: 6, upper: 6, required: 6, status: "pass", source: "calculated" });
  });

  it("adds CTĐT courses outside the standard but never codes outside the program or condition-only courses", () => {
    const curriculum = [ctdt("71ITBS10103", 3), ctdt("71ITBS10203", 3), ctdt("71ITSE30903", 3, "TC309"), ctdt("71NAD110013", 3, "BB", "Giáo dục thể chất và giáo dục quốc phòng")];
    const extra: TranscriptRow[] = [["71ITSE30903", 3, 6, 2, "C"], ["71ITXX99903", 3, 8, 3.5, "B+"]];
    expect(evaluate(data, [...rows, ...extra], { curriculum }).credits).toMatchObject({ lower: 9, upper: 9, status: "pass", source: "calculated" });
  });

  it("adds graded courses with an unreadable result to the upper bound only", () => {
    expect(evaluate(data, [["71ITBS10103", 3, 8, 3.5, "B+"], ["71ITBS10203", 3, 7, 3]]).credits).toMatchObject({ lower: 3, upper: 6, status: "unknown" });
  });
});

describe("E5: the printed cumulative credits", () => {
  const data = smallStandard([{ id: "BB", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: null }], [
    { groupId: "BB", code: "71ITBS10103", credits: 3 }, { groupId: "BB", code: "71ITBS10203", credits: 3 },
  ], { minimumCredits: 6 });
  const rows: TranscriptRow[] = [["71ITBS10103", 3, 8, 3.5, "B+"], ["71ITBS10203", 3, 7, 3, "B"]];

  it("reads 'Số tín chỉ tích lũy' like 'Tổng số tín chỉ tích lũy', never a per-term line", () => {
    expect(evaluate(data, rows, { summaries: [["Số tín chỉ tích lũy", "5"]] }).credits).toEqual({ lower: 5, upper: 5, required: 6, status: "fail", source: "printed" });
    expect(evaluate(data, rows, { summaries: [["Số tín chỉ đạt học kỳ", "5"], ["Tổng số tín chỉ đăng ký", "5"]] }).credits)
      .toMatchObject({ lower: 6, source: "calculated", status: "pass" });
  });

  it("falls back to the estimate when the printed value is unreadable or conflicting", () => {
    expect(evaluate(data, rows, { summaries: [["Tổng số tín chỉ tích lũy", "?"]] }).credits).toEqual({ lower: 6, upper: 6, required: 6, status: "pass", source: "calculated" });
    expect(evaluate(data, rows, { summaries: [["Tổng số tín chỉ tích lũy", "5"], ["Số tín chỉ tích lũy", "7"]] }).credits)
      .toMatchObject({ lower: 6, source: "calculated", status: "pass" });
  });
});

describe("E8: mandatory groups count courses, (*) included", () => {
  it("requires every course of a mandatory group, starred ones too", () => {
    const data = smallStandard([{ id: "BB", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: 120 }], [
      { groupId: "BB", code: "71ITBS10103", credits: 3 }, { groupId: "BB", code: "71NAD110013", credits: 3, conditionOnly: true },
    ]);
    expect(evaluate(data, [["71ITBS10103", 3, 8, 3.5, "B+"]]).groups[0]).toMatchObject({ unit: "môn", lower: 1, upper: 1, required: 2, status: "fail", accumulatedCredits: 3 });
    expect(evaluate(data, [["71ITBS10103", 3, 8, 3.5, "B+"], ["71NAD110013", 3, 7, 3, "B"]]).groups[0])
      .toMatchObject({ unit: "môn", lower: 2, required: 2, status: "pass", accumulatedCredits: 3 });
  });
});

describe("K26: other codes of a standard course (old / new code)", () => {
  const k26 = () => {
    const data = smallStandard([{ id: "BB", name: "Nhóm bắt buộc", kind: "mandatory", minimumCredits: 6 }], [
      { groupId: "BB", code: "DIT0091", credits: 3 }, { groupId: "BB", code: "DIT0110", credits: 3 },
    ]);
    data.courses[0]!.alternativeCodes = ["71ITDS30103"];
    data.courses[1]!.alternativeCodes = ["71itse30403"];
    return data;
  };

  it("counts a course passed under its new code and joins the attempts of both codes", () => {
    const rows: TranscriptRow[] = [["71ITDS30103", 3, 8, 3.5, "B+"], ["DIT0110", 3, 3, 0, "F"], ["71ITSE30403", 3, 7, 3, "B"]];
    expect(evaluate(k26(), rows).groups[0]).toMatchObject({ lower: 2, upper: 2, required: 2, status: "pass", accumulatedCredits: 6 });
    const records = graduationInputs(k26(), [], syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows }])).records;
    expect([...records.keys()].sort()).toEqual(["DIT0091", "DIT0110"]);
    expect(records.get("DIT0110")).toMatchObject({ state: "passed", attempts: [{ code: "DIT0110" }, { code: "DIT0110" }] });
  });

  it("ignores a code two courses list or that is a course of the standard", () => {
    const shared = k26();
    shared.courses[1]!.alternativeCodes = ["71ITDS30103"];
    expect(standardCodeAliases(shared)).toEqual(new Map());
    expect(evaluate(shared, [["71ITDS30103", 3, 8, 3.5, "B+"]]).groups[0]).toMatchObject({ lower: 0, status: "fail" });
    const primary = k26();
    primary.courses[1]!.alternativeCodes = ["DIT0091"];
    expect(standardCodeAliases(primary)).toEqual(new Map([["71ITDS30103", "DIT0091"]]));
  });

  it("keeps a standard without other codes as it was", () => {
    expect(standardCodeAliases(smallStandard([{ id: "BB", name: "Nhóm bắt buộc", kind: "mandatory", minimumCredits: 3 }],
      [{ groupId: "BB", code: "71ITBS10103", credits: 3 }])).size).toBe(0);
    expect(standardCodeAliases(null).size).toBe(0);
  });
});

describe("retakes with a later cohort: same name, another code (2026-10-23)", () => {
  /** One graded term whose courses carry these names (the synthetic transcript names every course alike). */
  const named = (rows: TranscriptRow[], names: Record<string, string>) => {
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows }]);
    for (const section of transcript.sections) for (const course of section.courses) course.name = names[course.code] ?? `Môn ${course.code}`;
    return transcript;
  };
  const standard = (names: [code: string, name: string][]) => {
    const data = smallStandard([{ id: "BB", name: "Nhóm bắt buộc", kind: "mandatory", minimumCredits: 9 }],
      names.map(([code]) => ({ groupId: "BB", code, credits: 3 })));
    names.forEach(([, name], index) => { data.courses[index]!.name = name; });
    return data;
  };
  const k26 = () => standard([["DIT0070", "Cơ sở dữ liệu"], ["DCT0080", "Triết học Mác - Lênin"], ["DTA0015", "Anh văn 1 (AV1)"]]);
  const judge = (data: GraduationData, transcript: ReturnType<typeof named>) =>
    assessGraduation({ resolution: "general", standard: { id: "s", revisionId: "r", version: 1, data }, ...graduationInputs(data, [], transcript) });

  it("counts a passed same-name course under another code and lists it for a credit transfer", () => {
    const transcript = named([["DIT0070", 3, 3, 0, "F"], ["71ITIS30103", 3, 7, 3, "B"], ["71POLP10013", 3, 8, 3.5, "B+"], ["DTA0015", 3, 7, 3, "B"]],
      { DIT0070: "Cơ sở dữ liệu", "71ITIS30103": "Cơ sở dữ liệu", "71POLP10013": "Triết học Mác-Lênin", DTA0015: "Anh văn 1" });
    const inputs = graduationInputs(k26(), [], transcript);
    expect(inputs.transfers).toEqual([
      { code: "DIT0070", name: "Cơ sở dữ liệu", viaCode: "71ITIS30103", viaName: "Cơ sở dữ liệu" },
      { code: "DCT0080", name: "Triết học Mác - Lênin", viaCode: "71POLP10013", viaName: "Triết học Mác-Lênin" },
    ]);
    expect(inputs.records.get("DIT0070")).toMatchObject({ state: "passed", attempts: [{ code: "DIT0070" }, { code: "DIT0070" }] });
    expect(judge(k26(), transcript).groups[0]).toMatchObject({ lower: 3, required: 3, status: "pass" });
  });

  it("needs no transfer for the same code under a slightly different name", () => {
    const data = standard([["71POLP10013", "Triết học Mác Lênin"], ["71ITAI41203", "Học máy và ứng dụng"]]);
    const transcript = named([["71POLP10013", 3, 8, 3.5, "B+"], ["71ITAI41203", 3, 7, 3, "B"]],
      { "71POLP10013": "Triết học Mác-Lênin", "71ITAI41203": "Học máy ứng dụng" });
    expect(graduationInputs(data, [], transcript).transfers).toEqual([]);
    expect(judge(data, transcript).groups[0]).toMatchObject({ lower: 2, required: 2, status: "pass" });
  });

  it("never uses a failed course, a course of the standard, a name the standard lists twice, or one course twice", () => {
    const failed = named([["71ITIS30103", 3, 3, 0, "F"]], { "71ITIS30103": "Cơ sở dữ liệu" });
    expect(graduationInputs(k26(), [], failed).transfers).toEqual([]);
    const own = standard([["DIT0070", "Cơ sở dữ liệu"], ["71ITIS30103", "Cơ sở dữ liệu nâng cao"]]);
    expect(graduationInputs(own, [], named([["71ITIS30103", 3, 7, 3, "B"]], { "71ITIS30103": "Cơ sở dữ liệu" })).transfers).toEqual([]);
    const twice = standard([["DIT0070", "Cơ sở dữ liệu"], ["DIT0071", "Cơ sở dữ liệu"]]);
    expect(graduationInputs(twice, [], named([["71ITIS30103", 3, 7, 3, "B"]], { "71ITIS30103": "Cơ sở dữ liệu" })).transfers).toEqual([]);
    const once = standard([["DIT0070", "Cơ sở dữ liệu"], ["DIT0080", "Cơ sở dữ liệu (Databases)"]]);
    expect(graduationInputs(once, [], named([["71ITIS30103", 3, 7, 3, "B"]], { "71ITIS30103": "Cơ sở dữ liệu" })).transfers).toEqual([]);
  });

  it("counts the CTĐT's own spelling of a standard course without a transfer (K26: standard DQP0061, CTĐT DQP0060)", () => {
    const data = standard([["DQP0061", "Giáo dục quốc phòng 4 (TH) (*)"]]);
    const transcript = named([["DQP0060", 3, 8, 3.5, "B+"]], { DQP0060: "Giáo dục quốc phòng 4 (*)" });
    const own = graduationInputs(data, [ctdt("DQP0060", 0)], transcript);
    expect(own.transfers).toEqual([]);
    expect(own.records.get("DQP0061")).toMatchObject({ state: "passed" });
    expect(graduationInputs(data, [], transcript).transfers).toMatchObject([{ code: "DQP0061", viaCode: "DQP0060" }]);
  });

  it("matches nearly identical names but keeps numbers and modifiers apart", () => {
    const same = [
      ["Học máy và ứng dụng", "Học máy ứng dụng"],
      ["Quản lý Dự án CNTT", "Quản lý dự án Công nghệ Thông tin"],
      ["Lập trình Hệ thống nhúng và IOT", "Lập trình Hệ thống nhúng và Mạng kết nối vạn vật"],
      ["Lập trình Hệ thống nhúng và Internet vạn vật", "Lập trình hệ thống nhúng và mạng kết nối vạn vật"],
      ["Mã hóa dữ liệu và Khối chuỗi (Blockchain)", "Mã hóa dữ liệu và chuỗi khối (Block chain)"],
      ["Khoá luận tốt nghiệp", "Khóa luận Tốt nghiệp"],
      ["Anh văn 1 (AV1)", "Anh Văn 1"],
    ];
    for (const [left, right] of same) expect(courseNameKey(left!), left).toBe(courseNameKey(right!));
    for (const [left, right] of [["Anh văn 1", "Anh văn 2"], ["Lập trình Web", "Lập trình Web nâng cao"], ["Giáo dục thể chất 1", "Giáo dục thể chất 2"]])
      expect(courseNameKey(left!)).not.toBe(courseNameKey(right!));
    expect(courseNameKey("(*)")).toBe("");
  });
});

describe("GDTC (1)/(2) fill the 71PE electives of a K27/K28 standard (audit 2026-10-25)", () => {
  /** One graded term whose courses carry these names; a "(*)" name is conditional, as both transcript parsers read it. */
  const named = (rows: TranscriptRow[], names: Record<string, string>) => {
    const transcript = syntheticTranscript([{ year: "2023-2024", semester: "HK02", rows }]);
    for (const section of transcript.sections) {
      for (const course of section.courses) {
        course.name = names[course.code] ?? `Môn ${course.code}`;
        course.conditional = course.name.includes("*");
      }
    }
    return transcript;
  };
  const pe = (code: string): CourseSpec => ({ groupId: "PE", code, credits: 2, conditionOnly: true });
  /** K27/K28: TC104 lists only 71PE (*) electives, 4 TC; the CTĐT lists DGT0010/DGT0020 (0 TC). */
  const k27 = () => smallStandard(
    [{ id: "BB", name: "Nhóm bắt buộc", kind: "mandatory", minimumCredits: 3 }, { id: "PE", name: "Nhóm tự chọn TC104", kind: "elective", minimumCredits: 4 }],
    [{ groupId: "BB", code: "71ITBS10103", credits: 3 }, pe("71PEBA10052"), pe("71PEBB10032"), pe("71PEDA10102")],
    { minimumCredits: 3 },
  );
  const gdtc = { DGT0010: "Giáo dục thể chất (1) (*)", DGT0020: "Giáo dục thể chất (2) (*)" };
  const both = () => named([["71ITBS10103", 3, 7, 3, "B"], ["DGT0010", 2, 8, 3.5, "B+"], ["DGT0020", 2, 7, 3, "B"]], gdtc);
  const curriculum = [ctdt("71ITBS10103", 3), ctdt("DGT0010", 0), ctdt("DGT0020", 0)];
  const judge = (data: GraduationData, transcript: ReturnType<typeof named>, courses: CurriculumCourseInput[] = curriculum) =>
    assessGraduation({ resolution: "general", standard: { id: "s", revisionId: "r", version: 1, data }, ...graduationInputs(data, courses, transcript) });

  it("counts passed DGT0010 and DGT0020 toward the group whose courses are all 71PE (*) electives, without a transfer", () => {
    const inputs = graduationInputs(k27(), curriculum, both());
    expect(inputs.substitutes).toEqual([
      { code: "71PEBA10052", name: "Học phần 71PEBA10052", viaCode: "DGT0010", viaName: "Giáo dục thể chất (1) (*)" },
      { code: "71PEBB10032", name: "Học phần 71PEBB10032", viaCode: "DGT0020", viaName: "Giáo dục thể chất (2) (*)" },
    ]);
    expect(inputs.transfers).toEqual([]);
    // The GDTC courses keep their own records: the CTĐT, and the study plan read from these inputs, still list them.
    expect(inputs.records.get("DGT0010")).toMatchObject({ code: "DGT0010", state: "passed" });
    expect(inputs.records.get("71PEBA10052")).toMatchObject({ state: "passed", attempts: [{ code: "71PEBA10052" }] });
    const summary = judge(k27(), both());
    // Was 0/4 TC (audit: "đã đạt 0/4 TC" with DGT0010 and DGT0020 passed).
    expect(summary.groups[1]).toMatchObject({ lower: 4, upper: 4, required: 4, status: "pass", accumulatedCredits: 0 });
    expect(summary.groupStatus).toBe("pass");
    // Condition-only: neither the credit estimate nor the GPA changes.
    const without = judge(k27(), named([["71ITBS10103", 3, 7, 3, "B"]], {}));
    expect(summary.credits).toEqual(without.credits);
    expect(summary.gpa).toEqual(without.gpa);
  });

  it("gives calculate.ts the same aliases (it builds its graduation records from graduationCodeAliases)", () => {
    const { aliases, transfers, substitutes } = graduationCodeAliases(k27(), both(), new Set(["71ITBS10103", "DGT0010", "DGT0020"]));
    expect([...aliases]).toEqual([["DGT0010", "71PEBA10052"], ["DGT0020", "71PEBB10032"]]);
    expect(transfers).toEqual([]);
    expect(substitutes.map((item) => item.viaCode)).toEqual(["DGT0010", "DGT0020"]);
  });

  it("needs no CTĐT for DGT0010/DGT0020, and one passed course fills one 2-credit elective", () => {
    const one = named([["DGT0010", 2, 8, 3.5, "B+"], ["DGT0020", 2, 3, 0, "F"]], gdtc);
    expect(judge(k27(), one, []).groups[1]).toMatchObject({ lower: 2, required: 4, status: "fail" });
    expect(graduationInputs(k27(), [], one).substitutes!.map((item) => item.viaCode)).toEqual(["DGT0010"]);
  });

  it("reads a course of the own CTĐT named 'Giáo dục thể chất (n)' under another code", () => {
    const transcript = named([["GDTC0001", 2, 8, 3.5, "B+"]], { GDTC0001: "Giáo dục thể chất 1" });
    const own = [{ ...ctdt("GDTC0001", 0), name: "Giáo dục thể chất (1)" }];
    expect(judge(k27(), transcript, own).groups[1]).toMatchObject({ lower: 2, status: "fail" });
    // Not a course of the CTĐT: no substitute.
    expect(graduationInputs(k27(), [], transcript).substitutes).toEqual([]);
    // A course of the CTĐT with another name: no substitute.
    expect(graduationInputs(k27(), [{ ...ctdt("GDTC0001", 0), name: "Bóng đá" }], named([["GDTC0001", 2, 8, 3.5, "B+"]], { GDTC0001: "Bóng đá" })).substitutes).toEqual([]);
  });

  it("fills an elective nobody took, after the 71PE courses the student passed, and never twice", () => {
    const transcript = named([["71PEBA10052", 2, 9, 4, "A"], ["71PEBB10032", 2, 3, 0, "F"], ["DGT0010", 2, 8, 3.5, "B+"]], gdtc);
    const inputs = graduationInputs(k27(), curriculum, transcript);
    // 71PEBA10052 is passed and 71PEBB10032 was taken (failed): DGT0010 fills 71PEDA10102.
    expect(inputs.substitutes!.map((item) => [item.viaCode, item.code])).toEqual([["DGT0010", "71PEDA10102"]]);
    expect(judge(k27(), transcript).groups[1]).toMatchObject({ lower: 4, status: "pass" });
  });

  it("leaves alone a standard that lists DGT0010/DGT0020 itself (K26), a GDTC course not passed, and a group with other courses", () => {
    const k26 = smallStandard([{ id: "PE", name: "Nhóm tự chọn TC004", kind: "elective", minimumCredits: 4 }], [
      { groupId: "PE", code: "DGT0010", credits: 2, conditionOnly: true }, { groupId: "PE", code: "DGT0020", credits: 2, conditionOnly: true }, pe("71PEBA10052"),
    ]);
    expect(graduationInputs(k26, [], both()).substitutes).toEqual([]);
    expect(judge(k26, both(), []).groups[0]).toMatchObject({ lower: 4, status: "pass" });
    const pending = named([["DGT0010", 2], ["DGT0020", 2, 3, 0, "F"]], gdtc);
    expect(graduationInputs(k27(), curriculum, pending).substitutes).toEqual([]);
    const mixed = smallStandard([{ id: "PE", name: "Nhóm tự chọn TC104", kind: "elective", minimumCredits: 4 }],
      [pe("71PEBA10052"), { groupId: "PE", code: "71ITSE30903", credits: 3 }]);
    expect(graduationInputs(mixed, curriculum, both()).substitutes).toEqual([]);
  });

  it("puts the GDTC courses in the PE group with fewer passed courses when a standard has two (K29 TC002/TC102)", () => {
    const k29 = smallStandard(
      [{ id: "A", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 2 }, { id: "B", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 2 }],
      [{ ...pe("71PEKC10062"), groupId: "A" }, { ...pe("71PESW10042"), groupId: "A" }, { ...pe("71PEBA10052"), groupId: "B" }],
    );
    const transcript = named([["71PEKC10062", 2, 9, 4, "A"], ["DGT0010", 2, 8, 3.5, "B+"]], gdtc);
    expect(graduationInputs(k29, [], transcript).substitutes!.map((item) => [item.viaCode, item.code])).toEqual([["DGT0010", "71PEBA10052"]]);
  });
});

describe("lower and upper bounds", () => {
  const cnpm = syntheticStandards()[0]!;
  const curriculum = syntheticCurriculum();
  const run = (rows: TranscriptRow[], summaries: [string, string][] = []) => {
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows, summaries }]);
    return assessGraduation({ resolution: "specialty", standard: cnpm, ...graduationInputs(cnpm.data, curriculum.courses, transcript) });
  };

  it("passes on the lower bound, fails on the upper bound and stays unknown in between", () => {
    const tc309 = (rows: TranscriptRow[]) => run(rows).groups.find((group) => group.groupId === "row-79")!;
    expect(tc309([["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 3, 7, 3, "B"]])).toMatchObject({ lower: 6, upper: 6, status: "pass", code: "TC209", curriculumElectiveCode: "TC309" });
    expect(tc309([["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 3, 7, 3, null]])).toMatchObject({ lower: 3, upper: 6, status: "unknown" });
    expect(tc309([["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 3, 3, 0, "F"]])).toMatchObject({ lower: 3, upper: 3, status: "fail" });
  });

  it("estimates total credits without condition-only courses when none is printed", () => {
    const summary = run([["71ITBS10103", 3, 8, 3.5, "B+"], ["71NAD110013", 3, 7, 3, "B"], ["71PEKC10062", 2, 9, 4, "A"], ["71ITBS10203", 3, 6, 2, null]]);
    expect(summary.credits).toMatchObject({ lower: 3, upper: 6, source: "calculated", required: 126, status: "fail" });
  });

  it("flags 'Có thể học cải thiện' only when the groups pass and the GPA fails", () => {
    expect(run([["71ITBS10103", 3, 8, 3.5, "B+"]]).needsImprovement).toBe(false);
  });

  it("explains every unresolved standard without blocking", () => {
    const resolutions: GraduationResolution[] = ["specialty_unset", "not_found", "ambiguous"];
    for (const resolution of resolutions) {
      const summary = assessGraduation({ resolution, standard: null, ...graduationInputs(null, [], syntheticTranscript([])) });
      expect(summary).toMatchObject({ status: "unknown", statusLabel: "Chưa xác định", groups: [], gpa: null, credits: null });
      expect(summary.reason).toBeTruthy();
    }
  });
});
