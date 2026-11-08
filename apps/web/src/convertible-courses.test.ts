import { describe, expect, it } from "vitest";
import { convertibleCodes, convertibleText, isConvertible, type ConvertibleCourses } from "./convertible-courses";

// Synthetic courses only (user 2026-11-08: "Không tính, chỉ nhắc").
const se = { code: "71ITSE41003", name: "Nhập môn công nghệ phần mềm", credits: 3, specialty: "Công nghệ phần mềm" };
const ai = { code: "71ITAI40103", name: "Học máy", credits: 2.5, specialty: "Trí tuệ nhân tạo" };

describe("passed mandatory courses of another specialty", () => {
  it("says the course counts nowhere and how to have it converted, with the group when the CTĐT has one", () => {
    expect(convertibleText({ courses: [se], groupCode: "TC309" })).toBe(
      "Môn Nhập môn công nghệ phần mềm (3 TC, chuyên ngành Công nghệ phần mềm) thuộc chuyên ngành khác nên chưa được tính vào nhóm học phần nào của bạn. "
      + "Bạn có thể liên hệ nhà trường để chuyển môn này thành môn tự chọn chuyên ngành (TC309).");
    const both = convertibleText({ courses: [se, ai], groupCode: null });
    expect(both).toContain("Các môn Nhập môn công nghệ phần mềm (3 TC, chuyên ngành Công nghệ phần mềm); Học máy (2,5 TC, chuyên ngành Trí tuệ nhân tạo)");
    expect(both).toMatch(/chuyển các môn này thành môn tự chọn\.$/);
  });

  it("says nothing without such a course, and marks the rows by code whatever the case", () => {
    const none: ConvertibleCourses = { courses: [], groupCode: null };
    for (const value of [none, null, undefined]) expect(convertibleText(value)).toBeNull();
    const codes = convertibleCodes({ courses: [se], groupCode: "TC309" });
    expect(isConvertible(codes, "71itse41003 ")).toBe(true);
    expect(isConvertible(codes, "71ITAI40103")).toBe(false);
    expect(isConvertible(codes, null)).toBe(false);
    expect(convertibleCodes(null).size).toBe(0);
  });
});
