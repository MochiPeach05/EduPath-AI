import { describe, expect, it } from "vitest";
import { blockedUntilStudied, opensEveryTerm, studiedFirstCodes } from "./course-rules.js";

// Course codes and names of the catalog only; no student data.
describe("courses opened every term (user 2026-11-04)", () => {
  it("covers English and Giáo dục thể chất by code or name, and nothing else", () => {
    expect(opensEveryTerm("71ENG610063", "Anh văn 6 (AV6)")).toBe(true);
    expect(opensEveryTerm("DTA0015", "Anh văn 1 (AV1)")).toBe(true);
    expect(opensEveryTerm("71PEKC10172", "Cờ vua nâng cao (*)")).toBe(true);
    expect(opensEveryTerm("71PEBA10052", "Cầu lông")).toBe(true);
    expect(opensEveryTerm("DGT0010", "Giáo dục thể chất 1 (*)")).toBe(true);
    expect(opensEveryTerm("X9", "Giáo dục thể chất 2")).toBe(true);
    expect(opensEveryTerm("71NAD110013", "Giáo dục quốc phòng và an ninh 1")).toBe(false);
    expect(opensEveryTerm("71ITSE30103", "Kiểm thử phần mềm")).toBe(false);
  });
});

describe("courses studied first (user 2026-11-04: Cờ vua nâng cao after Cờ vua)", () => {
  const courses = [
    { code: "71PEKC10062", name: "Cờ vua" }, { code: "71PEKC10172", name: "Cờ vua nâng cao" }, { code: "71PEBA10052", name: "Cầu lông" },
  ];
  it("asks Cờ vua nâng cao for Cờ vua, whatever the codes or the standard's (*), and other courses for nothing", () => {
    expect(studiedFirstCodes("Cờ vua nâng cao", courses)).toEqual(["71PEKC10062"]);
    expect(studiedFirstCodes("Cờ vua nâng cao (*)", [{ code: "OLD1", name: "Cờ vua (*)" }])).toEqual(["OLD1"]);
    expect(studiedFirstCodes("Cờ vua", courses)).toEqual([]);
    expect(studiedFirstCodes("Cầu lông", courses)).toEqual([]);
    expect(studiedFirstCodes("Cờ vua nâng cao", [])).toEqual([]);
  });
  it("asks for one code only, the one already taken when a name has two", () => {
    const twice = [{ code: "OLD1", name: "Cờ vua", state: "not_taken" }, { code: "NEW1", name: "Cờ vua", state: "failed" }];
    expect(studiedFirstCodes("Cờ vua nâng cao", twice)).toEqual(["NEW1"]);
    expect(studiedFirstCodes("Cờ vua nâng cao", twice.map((course) => ({ ...course, state: "not_taken" })))).toEqual(["OLD1"]);
  });
  it("blocks Cờ vua nâng cao until Cờ vua was taken", () => {
    expect(blockedUntilStudied("Cờ vua nâng cao", [])).toBe(true);
    expect(blockedUntilStudied("Cờ vua nâng cao (*)", ["Cầu lông", "Cờ vua nâng cao"])).toBe(true);
    expect(blockedUntilStudied("Cờ vua nâng cao", ["Cờ vua (*)"])).toBe(false);
    expect(blockedUntilStudied("Cầu lông", [])).toBe(false);
  });
});
