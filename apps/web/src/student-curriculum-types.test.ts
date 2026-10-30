import { describe, expect, it } from "vitest";
import {
  courseKind,
  courseTypeLabel,
  plannedTermText,
  programTitle,
  searchableCourse,
  searchTerm,
  studyYearText,
  termLabel,
  type StudentCourse,
} from "./student-curriculum-types";

describe("student curriculum display helpers", () => {
  it("keeps required and elective course filters aligned with curriculum type codes", () => {
    expect(courseKind("BB")).toBe("required");
    expect(courseKind("BBKTL")).toBe("required");
    expect(courseKind("TC309 (9 TC)")).toBe("elective");
    expect(courseTypeLabel("TC309")).toContain("TC309");
    expect(courseTypeLabel("unrecognised")).toBe("unrecognised");
  });

  it("spells out the planned year and semester, skipping a missing part", () => {
    expect(termLabel(1, 2)).toBe("Năm 1 · HK 2");
    expect(termLabel(null, 3)).toBe("HK 3");
    expect(termLabel(4, null)).toBe("Năm 4");
    expect(termLabel(null, null)).toBe("—");
  });

  it("writes a planned position as the cohort's calendar term (one term style for students)", () => {
    expect(plannedTermText(1, 1, 2023)).toBe("HK1 2023–2024");
    expect(plannedTermText(4, 2, 2023)).toBe("HK2 2026–2027");
    expect(plannedTermText(null, 3, 2023)).toBe("HK3");
    expect(plannedTermText(2, null, 2023)).toBe("2024–2025");
    expect(plannedTermText(2, 1, 0)).toBe("HK1, năm thứ 2");
    expect(plannedTermText(null, null, 2023)).toBe("—");
    expect(studyYearText(3, 2024)).toBe("2026–2027");
    expect(studyYearText(3, null)).toBe("Năm 3");
  });

  it("writes capital CTĐT and KHĐT names in sentence case, the major with its capital", () => {
    expect(programTitle("KHUNG CHƯƠNG TRÌNH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN KHÓA 29", "CÔNG NGHỆ THÔNG TIN"))
      .toBe("Khung chương trình đào tạo ngành Công nghệ thông tin khóa 29");
    expect(programTitle("KẾ HOẠCH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN - KHÓA 29", "CÔNG NGHỆ THÔNG TIN"))
      .toBe("Kế hoạch đào tạo ngành Công nghệ thông tin – khóa 29");
    expect(programTitle("KẾ HOẠCH ĐÀO TẠO NGÀNH MẠNG MÁY TÍNH VÀ TRUYỀN THÔNG DỮ LIỆU - KHÓA 31", "MẠNG MÁY TÍNH VÀ TRUYỀN THÔNG DỮ LIỆU"))
      .toBe("Kế hoạch đào tạo ngành Mạng máy tính và truyền thông dữ liệu – khóa 31");
    expect(programTitle("Kế hoạch đào tạo K30", "Công nghệ thông tin")).toBe("Kế hoạch đào tạo K30");
    expect(programTitle("KHUNG CHƯƠNG TRÌNH ĐÀO TẠO KHÓA 27")).toBe("Khung chương trình đào tạo khóa 27");
  });

  it("builds a stable search index from the public course fields", () => {
    const course = {
      code: "71IT000001",
      name: "Advanced Databases",
      englishName: "Database Systems",
    } as StudentCourse;
    expect(searchableCourse(course)).toBe(
      "71it000001 advanced databases database systems",
    );
    expect(searchTerm("  Advanced Databases ")).toBe("advanced databases");
  });

  it("removes accents so a plain-text search finds an accented course name", () => {
    const course = {
      code: "71IT000002",
      name: "Café dữ liệu",
      englishName: "Data Cafe",
    } as StudentCourse;
    expect(searchableCourse(course)).toContain("cafe du lieu");
    expect(searchTerm("  CAFÉ DỮ LIỆU ")).toBe("cafe du lieu");
  });
});
