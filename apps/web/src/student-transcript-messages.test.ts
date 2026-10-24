import { describe, expect, it } from "vitest";
import { courseMatcher, failedImportMessage } from "./StudentTranscript";

describe("failed transcript imports", () => {
  it("say once that the previous transcript is kept", () => {
    for (const code of ["invalid_ocr_result", "unreadable_rows", "unreadable_grades", "ocr_failed", "unknown_code", null]) {
      expect({ code, kept: failedImportMessage(code).match(/giữ nguyên/g)?.length }).toEqual({ code, kept: 1 });
    }
  });
});

describe("transcript search", () => {
  const course = { code: "71ITSE30103", name: "Đồ án Lập trình Web" };
  it("finds a course by code or name, with or without Vietnamese marks", () => {
    for (const search of ["", "  lap trinh ", "LẬP TRÌNH", "do an", "Đồ án", "71itse301"]) expect({ search, found: courseMatcher(search)(course) }).toEqual({ search, found: true });
    expect(courseMatcher("lập trình di động")(course)).toBe(false);
  });
});
