import { describe, expect, it } from "vitest";
import type { CurriculumCourseInput } from "../competency-assessment/types.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import { convertibleCourses, specialtyElectivesGroup } from "./convertible.js";

// Synthetic CTĐT and transcript only (user 2026-11-08: "Không tính, chỉ nhắc").
const course = (code: string, type: string, specialty: string, name = `Môn ${code}`): CurriculumCourseInput => ({
  code, name, credits: 3, type, block: "", specialty, semester: 1, studyYear: 3,
});
const curriculum = [
  course("71ITBS10103", "BB", ""),
  course("71ITSE41003", "BB", "Công nghệ Phần mềm", "Nhập môn công nghệ phần mềm"),
  course("71ITSE30603", "BB", "Công nghệ Phần mềm"),
  course("71ITAI40103", "BB", "Trí tuệ Nhân tạo"),
  course("71ITSE31003", "TC309", "Tự chọn Chuyên ngành"),
  course("71ITAI41203", "TC309", "Tự chọn Chuyên ngành"),
  course("71ITGR40206", "TC406", ""),
];
function transcript(rows: { code: string; letter: string; result?: string }[]): TranscriptData {
  return {
    schemaVersion: 1, parserVersion: "vlu-ocr-1.1", pageCount: 1, warnings: [], courseCount: rows.length,
    sections: [{ id: "2024-2025-HK03", academicYear: "2024-2025", semester: "HK03", label: "HK3 2024-2025", summaries: [],
      courses: rows.map((row, index) => ({ ordinal: index + 1, code: row.code, name: "Học phần", credits: 3, score10: row.letter === "F" ? 3 : 7.9,
        score4: row.letter === "F" ? 0 : 3.16, letter: row.letter, result: row.result ?? (row.letter === "F" ? "Không đạt" : "Đạt"), conditional: false, sourcePage: 1 })) }],
  };
}

describe("passed mandatory courses of another specialty (convertible into electives)", () => {
  it("finds the specialty electives group of the CTĐT, whatever its code", () => {
    expect(specialtyElectivesGroup(curriculum)).toBe("TC309");
    expect(specialtyElectivesGroup([course("A", "TC209", "Tự chọn Chuyên ngành"), course("B", "TC106", "")])).toBe("TC209");
    expect(specialtyElectivesGroup([course("A", "TC203", "Công nghệ Phần mềm")])).toBeNull();
  });

  it("lists another specialty's mandatory course a student of Trí tuệ nhân tạo passed, with the group the school can convert it into", () => {
    const passed = transcript([{ code: "71ITSE41003", letter: "B" }, { code: "71ITAI40103", letter: "B" }, { code: "71ITSE30603", letter: "F" }]);
    expect(convertibleCourses(curriculum, passed, "K29", "TTNT")).toEqual({
      courses: [{ code: "71ITSE41003", name: "Nhập môn công nghệ phần mềm", credits: 3, specialty: "Công nghệ phần mềm" }],
      groupCode: "TC309",
    });
    // For a student of Công nghệ phần mềm it is the other way round: the passed course of Trí tuệ nhân tạo.
    expect(convertibleCourses(curriculum, passed, "K29", "CNPM").courses.map((item) => item.code)).toEqual(["71ITAI40103"]);
    // An elective, a failed course or no specialty: nothing to convert.
    expect(convertibleCourses(curriculum, transcript([{ code: "71ITSE30603", letter: "F" }, { code: "71ITSE31003", letter: "A" }]), "K29", "TTNT"))
      .toEqual({ courses: [], groupCode: null });
    expect(convertibleCourses(curriculum, passed, "K29", null)).toEqual({ courses: [], groupCode: null });
  });
});
