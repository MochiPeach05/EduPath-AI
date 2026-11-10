import { describe, expect, it } from "vitest";
import {
  courseResult, courseResultDisplay, filledResult, graduationCourseAliases, physicalEducationFills, physicalEducationNumber, physicalEducationProgress,
  planTermCredits, studentPlanOutcome, transcriptCourseStates, type CourseResultView,
} from "./student-plan-results";
import type { GraduationEvaluation } from "./student-graduation-types";

// Synthetic transcript rows only.
const passed = "Đạt";
const failed = "Không đạt";
type Row = { code: string; result: string | null; letter?: string | null; score10?: number | null; score4?: number | null };
const states = (...terms: Row[][]) => transcriptCourseStates(terms.map((courses) => ({ courses })));
const display = (view: CourseResultView | undefined) => {
  if (!view) return null;
  const shown = courseResultDisplay(view);
  return `${shown.glyph} ${shown.label}${shown.notes.length ? ` | ${shown.notes.join(" | ")}` : ""}`;
};

describe("course states with the graduation page's vocabulary (audit 2026-10-25)", () => {
  it("tells passed, MT, failed, in progress and unclear results apart, like #graduation", () => {
    const map = states([
      { code: "71ITSE30103", result: passed, letter: "B" },
      { code: "71ENG110013", result: null, letter: "MT" },
      { code: "71ITSE30203", result: failed, letter: "F" },
      { code: "71ITGR40206", result: null },
      { code: "71ITSE30303", result: null, letter: null, score10: 6.5, score4: 2.5 },
      { code: "71ITSE30403", result: null, letter: "B+" },
    ]);
    expect(Object.fromEntries(map)).toEqual({
      "71ITSE30103": { state: "passed", inferred: false },
      "71ENG110013": { state: "exempt", inferred: false },
      "71ITSE30203": { state: "failed", inferred: false },
      "71ITGR40206": { state: "in_progress", inferred: false },
      "71ITSE30303": { state: "graded_unknown", inferred: false },
      "71ITSE30403": { state: "passed", inferred: true },
    });
    const shown = (code: string) => display(courseResult(code, map));
    expect(shown("71ITSE30103")).toBe("✓ Đã đạt");
    expect(shown("71ENG110013")).toBe("✓ Miễn thi (MT) | Miễn thi (MT)");
    expect(shown("71ITSE30203")).toBe("✗ Chưa đạt");
    expect(shown("71ITGR40206")).toBe("◐ Đang học | Đang học");
    expect(shown("71ITSE30303")).toBe("? Chưa rõ kết quả | Chưa rõ kết quả");
    expect(shown("71ITSE30403")).toBe("✓ Đã đạt | suy ra từ điểm chữ");
    expect(courseResult("71ITXX00000", map)).toBeUndefined();
  });

  it("reads a course failed then registered again as being studied, and a pass on any attempt as passed", () => {
    const map = states(
      [{ code: "71ITSE30103", result: null, letter: "F" }, { code: "71ITSE30203", result: failed, letter: "F" }],
      [{ code: "71ITSE30103", result: null }, { code: " 71itse30203 ", result: passed, letter: "C" }],
    );
    expect(map.get("71ITSE30103")).toEqual({ state: "in_progress", inferred: false });
    expect(map.get("71ITSE30203")).toEqual({ state: "passed", inferred: false });
    // A failure decided from the letter grade alone says so.
    expect(states([{ code: "A1", result: null, letter: "F" }]).get("A1")).toEqual({ state: "failed", inferred: true });
  });

  it("shows a course passed under another code on #graduation: a retake with a later cohort needs a credit transfer", () => {
    // K26: DIT0070 failed, passed as 71ITIS30103 with a later cohort; DIT0091 passed under its new code 71ITDS30103.
    const map = states([
      { code: "DIT0070", result: failed, letter: "F" }, { code: "71ITIS30103", result: passed, letter: "B" },
      { code: "71ITDS30103", result: null, letter: "B+" },
    ]);
    const evaluation = { codeAliases: [
      { code: "DIT0070", viaCode: "71ITIS30103", transfer: true }, { code: "DIT0091", viaCode: "71ITDS30103", transfer: false },
    ] } as unknown as GraduationEvaluation;
    const aliases = graduationCourseAliases(evaluation);
    expect(courseResult("DIT0070", map, aliases)).toEqual({ state: "passed", inferred: false, via: { code: "71ITIS30103", transfer: true } });
    expect(display(courseResult("DIT0070", map, aliases))).toBe("⇄ Đã học trả nợ | Đã học trả nợ (mã 71ITIS30103) — cần chuyển điểm");
    expect(display(courseResult("dit0091", map, aliases))).toBe("✓ Đã đạt | học với mã 71ITDS30103 | suy ra từ điểm chữ");
    // Without the graduation data the page keeps the transcript's own result.
    expect(display(courseResult("DIT0070", map))).toBe("✗ Chưa đạt");
    // An older server sends only the credit transfers.
    const older = { creditTransfers: [{ code: "DIT0070", name: "Cơ sở dữ liệu", viaCode: "71ITIS30103", viaName: "Cơ sở dữ liệu", credits: 3 }] } as unknown as GraduationEvaluation;
    expect(graduationCourseAliases(older)).toEqual([{ code: "DIT0070", viaCode: "71ITIS30103", transfer: true }]);
    expect(graduationCourseAliases(null)).toEqual([]);
    // A course passed under its own code keeps its own result.
    const own = states([{ code: "DIT0070", result: passed, letter: "A" }, { code: "71ITIS30103", result: passed, letter: "B" }]);
    expect(courseResult("DIT0070", own, aliases)?.via).toBeNull();
  });
});

describe("plan rows", () => {
  it("counts distinct PE electives across TC002 and TC102 for the GDTC placeholder rows", () => {
    const map = states([
      { code: "71PEKC10062", result: passed }, { code: "71PEBA10052", result: null, letter: "B+" }, { code: "71PETT10012", result: null },
    ]);
    const progress = physicalEducationProgress(["71PEKC10062", " 71pekc10062 ", "71PEBA10052", "71PETT10012", ""], map);
    expect(progress).toEqual({ passed: 2, confirmed: 1, inProgress: 1, groups: true });
    expect(studentPlanOutcome({ code: "DGT0010", name: "GDTC 1" }, map, progress)).toEqual({ state: "passed", inferred: false, via: null });
    expect(studentPlanOutcome({ code: "DGT0020", name: "Giáo dục thể chất 2" }, map, progress)).toEqual({ state: "passed", inferred: true, via: null });
    // One passed elective, one being studied: the second slot is being studied.
    const one = physicalEducationProgress(["71PEKC10062", "71PETT10012"], map);
    expect(studentPlanOutcome({ code: "", name: "GDTC 2" }, map, one)).toEqual({ state: "in_progress", inferred: false, via: null });
    expect(studentPlanOutcome({ code: "", name: "GDTC 2" }, map, physicalEducationProgress(["71PEKC10062"], map))).toBeUndefined();
  });

  it("uses the row's own code first: K26 'DGT0010 Giáo dục thể chất 1' was passed and K26 has no PE groups", () => {
    const map = states([{ code: "DGT0010", result: passed, letter: "B" }, { code: "DGT0020", result: null }]);
    const none = physicalEducationProgress([], map);
    expect(none.groups).toBe(false);
    expect(studentPlanOutcome({ code: "DGT0010", name: "Giáo dục thể chất 1" }, map, none)).toEqual({ state: "passed", inferred: false, via: null });
    expect(display(studentPlanOutcome({ code: "DGT0020", name: "Giáo dục thể chất (2)" }, map, none))).toBe("◐ Đang học | Đang học");
    // A placeholder code without a result, and no PE groups: nothing to show.
    expect(studentPlanOutcome({ code: "DGT0030", name: "GDTC 2" }, map, none)).toBeUndefined();
  });

  it("keeps regular rows tied to their normalized code and shows every state", () => {
    const map = states([
      { code: "71ITSE30503", result: null, letter: "F" }, { code: "71ITSE30603", result: passed, letter: "B" },
      { code: "71ITSE30703", result: null, letter: null, score10: 7 }, { code: "71ITSE30803", result: failed, letter: "A" },
      { code: "71ENG110013", result: null, letter: "MT" },
    ]);
    const none = physicalEducationProgress([], map);
    expect(studentPlanOutcome({ code: " 71itse30503 ", name: "A" }, map, none)).toEqual({ state: "failed", inferred: true, via: null });
    expect(studentPlanOutcome({ code: "71ITSE30603", name: "B" }, map, none)).toEqual({ state: "passed", inferred: false, via: null });
    expect(studentPlanOutcome({ code: "71ITSE30703", name: "C" }, map, none)).toEqual({ state: "graded_unknown", inferred: false, via: null });
    expect(studentPlanOutcome({ code: "71ITSE30803", name: "D" }, map, none)).toEqual({ state: "failed", inferred: false, via: null });
    expect(display(studentPlanOutcome({ code: "71ENG110013", name: "Anh văn 1" }, map, none))).toBe("✓ Miễn thi (MT) | Miễn thi (MT)");
    expect(studentPlanOutcome({ code: "", name: "Tự chọn tự do" }, map, none)).toBeUndefined();
    // A transfer on #graduation reaches the plan too.
    const aliases = [{ code: "DIT0070", viaCode: "71ITSE30603", transfer: true }];
    expect(studentPlanOutcome({ code: "DIT0070", name: "Cơ sở dữ liệu" }, map, none, aliases)?.via).toEqual({ code: "71ITSE30603", transfer: true });
  });

  it("adds up a term without a printed total from the rows every student takes, without (*) rows", () => {
    const row = (code: string, credits: number | null, type = "BB", sectionId = "", name = `Môn ${code}`) => ({ code, name, type, credits, sectionId });
    // K26 HK201: no section, GDQP is BBKTL.
    expect(planTermCredits([row("DCT0080", 3), row("DTA0015", 3), row("DQP0021", 0, "BBKTL"), row("DIT0020", 4)], new Set()))
      .toEqual({ credits: 10, partial: false });
    // K26 HK213: specialty and choice sections are not added up.
    const sections = new Set(["section-33", "section-47"]);
    expect(planTermCredits([row("DPL0010", 2), row("DTA0121", 3), row("DTN0073", 3, "BB", "section-33"), row("DIT0110", 3, "TC118", "section-47")], sections))
      .toEqual({ credits: 5, partial: true });
    // GDTC rows are left out by code or by "(*)".
    expect(planTermCredits([row("71PEKC10062", 2, "TC002"), row("X1", 2, "BB", "", "Giáo dục thể chất (*)"), row("DIT0410", 6)], new Set()))
      .toEqual({ credits: 6, partial: false });
    expect(planTermCredits([row("DIT0410", 6, "TC", "section-107")], new Set(["section-107"]))).toBeNull();
    expect(planTermCredits([row("DIT0410", null)], new Set())).toBeNull();
  });
});

describe("PE electives filling the numbered GDTC courses (ngành HTTT K29, 2026-11-10; API physicalEducationFills)", () => {
  // The CTĐT lists "Giáo dục thể chất (1)" and "(2)" (DGT0010, DGT0020) and no PE elective.
  const rows = [{ code: "71ITBS10103", name: "Nhập môn ngành" }, { code: "DGT0010", name: "Giáo dục thể chất (1)" }, { code: "DGT0020", name: "Giáo dục thể chất (2)" }];
  const listed = new Set(rows.map((row) => row.code));
  type Course = Row & { name: string };
  const section = (academicYear: string | null, semester: string | null, courses: Course[]) => ({ academicYear, semester, courses });
  const sections = [
    section("2024-2025", "HK01", [{ code: "71PEKC10062", name: "Cờ vua", result: passed, letter: "B" }, { code: "71PEBB10032", name: "Bóng rổ", result: failed, letter: "F" }]),
    section("2023-2024", "HK03", [{ code: "71PEVB10022", name: "Bóng chuyền", result: passed, letter: "A" }]),
    section("2025-2026", "HK01", [{ code: "71PETT10012", name: "Bóng bàn", result: null, letter: null }]),
  ];
  const shown = (code: string, fills: ReturnType<typeof physicalEducationFills>, map: ReturnType<typeof transcriptCourseStates>) => display(filledResult(code, map, fills));

  it("reads the number of a numbered GDTC course like the API", () => {
    expect(["Giáo dục thể chất (1)", "Giáo dục thể chất 2 (*)", "GDTC 1", "GDTC2"].map(physicalEducationNumber)).toEqual([1, 2, 1, 2]);
    expect(["Giáo dục thể chất", "Bóng chuyền", "Giáo dục quốc phòng (1)"].map(physicalEducationNumber)).toEqual([null, null, null]);
  });

  it("fills GDTC 1 with the earliest passed elective and GDTC 2 with the next, and names the course taken", () => {
    const map = transcriptCourseStates(sections);
    const fills = physicalEducationFills(rows, listed, sections, map);
    expect([...fills].map(([code, fill]) => [code, fill.code])).toEqual([["DGT0010", "71PEVB10022"], ["DGT0020", "71PEKC10062"]]);
    expect(shown("DGT0010", fills, map)).toBe("✓ Đã đạt | Đã học: Bóng chuyền (71PEVB10022)");
    expect(shown("DGT0020", fills, map)).toBe("✓ Đã đạt | Đã học: Cờ vua (71PEKC10062)");
    expect(filledResult("71ITBS10103", map, fills)).toBeUndefined();
  });

  it("makes GDTC 2 'Đang học' with an elective registered; a failed elective fills nothing", () => {
    const one = [sections[1]!, section("2024-2025", "HK01", [{ code: "71PEBB10032", name: "Bóng rổ", result: failed, letter: "F" }]), sections[2]!];
    const map = transcriptCourseStates(one);
    const fills = physicalEducationFills(rows, listed, one, map);
    expect([...fills].map(([code, fill]) => [code, fill.code])).toEqual([["DGT0010", "71PEVB10022"], ["DGT0020", "71PETT10012"]]);
    expect(shown("DGT0020", fills, map)).toBe("◐ Đang học | Đang học: Bóng bàn (71PETT10012)");
  });

  it("keeps a GDTC course passed under its own code, and changes nothing for a CTĐT that lists its PE electives", () => {
    const own = [section("2023-2024", "HK02", [{ code: "DGT0010", name: "Giáo dục thể chất (1)", result: passed, letter: "B+" }]), ...sections];
    const map = transcriptCourseStates(own);
    const fills = physicalEducationFills(rows, listed, own, map);
    expect([...fills].map(([code, fill]) => [code, fill.code])).toEqual([["DGT0020", "71PEVB10022"]]);
    const cntt = [{ code: "71PEVB10022", name: "Bóng chuyền" }, { code: "71PEKC10062", name: "Cờ vua" }];
    expect(physicalEducationFills(cntt, new Set(cntt.map((row) => row.code)), sections, transcriptCourseStates(sections)).size).toBe(0);
  });

  it("shows the plan row of a GDTC course through its elective (Kế hoạch đào tạo read from the CTĐT)", () => {
    const map = transcriptCourseStates(sections);
    const fills = physicalEducationFills(rows, listed, sections, map);
    const none = physicalEducationProgress([], map);
    expect(display(studentPlanOutcome({ code: "DGT0010", name: "Giáo dục thể chất (1)" }, map, none, [], fills))).toBe("✓ Đã đạt | Đã học: Bóng chuyền (71PEVB10022)");
    // Without fills the row has no result, as before.
    expect(studentPlanOutcome({ code: "DGT0010", name: "Giáo dục thể chất (1)" }, map, none)).toBeUndefined();
  });
});
