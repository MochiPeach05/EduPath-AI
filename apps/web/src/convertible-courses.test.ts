import { describe, expect, it } from "vitest";
import { CONVERTIBLE_ROW_NOTE, convertibleCodes, convertibleText, countedRowNote, countedText, isConvertible, otherSpecialtyNotes, type ConvertibleCourses } from "./convertible-courses";

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

describe("courses of another specialty the specialty electives group counts (user 2026-11-14)", () => {
  const xla = { code: "71ITAI40803", name: "Nhập môn xử lý ảnh số", credits: 3, specialty: "Trí tuệ nhân tạo" };

  it("says in which group they count", () => {
    expect(countedText({ courses: [xla], group: "Nhóm tự chọn TC209" })).toBe(
      "Môn Nhập môn xử lý ảnh số (3 TC, chuyên ngành Trí tuệ nhân tạo) thuộc chuyên ngành khác và được tính vào Nhóm tự chọn TC209, "
      + "nhóm tự chọn chuyên ngành của bạn.");
    expect(countedText({ courses: [xla, ai], group: "" })).toMatch(/^Các môn .* được tính vào nhóm tự chọn chuyên ngành, nhóm tự chọn chuyên ngành của bạn\.$/);
    for (const value of [{ courses: [], group: "Nhóm tự chọn TC209" }, null, undefined]) expect(countedText(value)).toBeNull();
  });

  it("marks a counted row with its group and an uncounted one with the reminder", () => {
    const notes = otherSpecialtyNotes({ courses: [se], groupCode: "TC309" }, { courses: [xla], group: "Nhóm tự chọn TC209" });
    expect(notes.get("71ITAI40803")).toBe(countedRowNote("Nhóm tự chọn TC209"));
    expect(notes.get("71ITAI40803")).toBe("Môn của chuyên ngành khác: được tính vào Nhóm tự chọn TC209");
    expect(notes.get("71ITSE41003")).toBe(CONVERTIBLE_ROW_NOTE);
    expect(otherSpecialtyNotes(null, null).size).toBe(0);
  });
});
