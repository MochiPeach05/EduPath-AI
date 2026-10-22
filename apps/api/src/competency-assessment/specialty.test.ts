import { describe, expect, it } from "vitest";
import {
  classifyCurriculumSpecialty, isSpecialtyCode, resolveGraduationStandard, SPECIALTIES, specialtyBlocks, specialtyConflict,
  specialtyCounts, specialtyLabel, specialtyOffered, standardSpecialty, suggestSpecialty,
} from "./specialty.js";
import type { SpecialtyCode } from "./types.js";

describe("specialty mapping (spec §4)", () => {
  it("keeps the mapping table: code, label, program code, curriculum name, KHĐT section", () => {
    expect(SPECIALTIES.map((item) => [item.code, item.label, item.programCode, item.curriculumName, item.planSectionLabel])).toEqual([
      ["CNPM", "Công nghệ phần mềm", "7480201-03", "cong nghe phan mem", "Chuyên ngành CNPM"],
      ["CNDL", "Công nghệ dữ liệu", "7480201-02", "cong nghe du lieu", "Chuyên ngành CNDL"],
      ["TTNT", "Trí tuệ nhân tạo", "7480201-04", "tri tue nhan tao", "Chuyên ngành Trí tuệ Nhân tạo"],
      ["ANM", "An ninh Mạng và IoTs", "7480201-01", "an ninh mang va iot", "Chuyên ngành An ninh Mạng và IoT"],
    ]);
    expect(isSpecialtyCode("CNPM")).toBe(true);
    expect(isSpecialtyCode("ANM")).toBe(true);
    expect(isSpecialtyCode("THQT")).toBe(false);
    expect(specialtyLabel(null)).toBeNull();
  });

  it("offers An ninh Mạng và IoTs to K27 only and the other specialties to every cohort", () => {
    expect(specialtyOffered("ANM", "K27")).toBe(true);
    expect(specialtyOffered("ANM", " k27 ")).toBe(true);
    for (const cohort of ["K26", "K28", "K29", "", null, undefined]) expect(specialtyOffered("ANM", cohort)).toBe(false);
    for (const cohort of ["K27", "K29", null]) expect(specialtyOffered("CNPM", cohort)).toBe(true);
  });

  it("classifies 'học phần chung' values as common, including '0' and the thesis replacement", () => {
    for (const value of ["", "  ", "0", "Tự chọn Chuyên ngành", "Học phần thay thế Đồ án tốt nghiệp"]) {
      expect(classifyCurriculumSpecialty(value)).toEqual({ kind: "common", known: true });
    }
  });

  it("maps the curriculum specialty names whatever their accents or casing", () => {
    expect(classifyCurriculumSpecialty("Công nghệ Phần mềm")).toEqual({ kind: "specialty", code: "CNPM" });
    expect(classifyCurriculumSpecialty("Công nghệ Dữ liệu")).toEqual({ kind: "specialty", code: "CNDL" });
    expect(classifyCurriculumSpecialty("Trí tuệ Nhân tạo")).toEqual({ kind: "specialty", code: "TTNT" });
    expect(classifyCurriculumSpecialty("TRI TUE NHAN TAO")).toEqual({ kind: "specialty", code: "TTNT" });
  });

  it("treats unknown values as common but flags them for a warning", () => {
    expect(classifyCurriculumSpecialty("An ninh Mạng và IoTs")).toEqual({ kind: "common", known: false });
    expect(classifyCurriculumSpecialty("Tin học Quản trị", "K27")).toEqual({ kind: "common", known: false });
  });

  it("maps 'An ninh Mạng và IoT' to ANM only in the K27 curriculum", () => {
    expect(classifyCurriculumSpecialty("An ninh Mạng và IoT", "K27")).toEqual({ kind: "specialty", code: "ANM" });
    expect(classifyCurriculumSpecialty("AN NINH MẠNG VÀ IOTS", "k27")).toEqual({ kind: "specialty", code: "ANM" });
    expect(classifyCurriculumSpecialty("An ninh Mạng và IoT", "K26")).toEqual({ kind: "common", known: false });
    expect(classifyCurriculumSpecialty("Công nghệ Phần mềm", "K26")).toEqual({ kind: "specialty", code: "CNPM" });
  });
});

describe("graduation standard resolution", () => {
  const standard = (standardCode: string, classBlock: string, specialty: string) => ({ data: { standardCode, classBlock, specialty } });
  const k29 = [
    standard("71K29CNTT_7480201-02_TN04", "71K29CNTT_7480201-02", "Công nghệ dữ liệu (7480201-02)"),
    standard("71K29CNTT_7480201-03_TN04", "71K29CNTT_7480201-03", "Công nghệ phần mềm (7480201-03)"),
    standard("71K29CNTT_7480201-04_TN04", "71K29CNTT_7480201-04", "Trí tuệ Nhân tạo (7480201-04)"),
  ];
  const general = standard("71K28CNTT_TiendohoctapQC1423", "71K28CNTT", "");
  const pick = (candidates: typeof k29, specialty: SpecialtyCode | null) => {
    const result = resolveGraduationStandard(candidates, specialty, (item) => item.data);
    return { code: result.standard?.data.standardCode ?? null, resolution: result.resolution };
  };

  it("reads the program code from data.specialty/classBlock/standardCode", () => {
    expect(standardSpecialty(k29[1]!.data)).toBe("CNPM");
    expect(standardSpecialty({ standardCode: "71K27CNTT_7480201-01_TN04", classBlock: "71K27CNTT_7480201-01", specialty: "An ninh Mạng và IoTs (7480201-01)" })).toBe("ANM");
    expect(standardSpecialty({ standardCode: "71K27CNTT_7480201-09_TN04", classBlock: "71K27CNTT_7480201-09", specialty: "Chuyên ngành khác (7480201-09)" })).toBe("other");
    expect(standardSpecialty(general.data)).toBeNull();
  });

  it("matches the student's specialty and never guesses one for K29 without a specialty", () => {
    expect(pick(k29, "CNPM")).toEqual({ code: "71K29CNTT_7480201-03_TN04", resolution: "specialty" });
    expect(pick(k29, "TTNT")).toEqual({ code: "71K29CNTT_7480201-04_TN04", resolution: "specialty" });
    expect(pick(k29, null)).toEqual({ code: null, resolution: "specialty_unset" });
  });

  it("uses a single general standard when the specialty is unset or has no own standard", () => {
    expect(pick([general, ...k29], null)).toEqual({ code: "71K28CNTT_TiendohoctapQC1423", resolution: "general" });
    expect(pick([general], "CNDL")).toEqual({ code: "71K28CNTT_TiendohoctapQC1423", resolution: "general" });
    expect(pick([general, general], null)).toEqual({ code: null, resolution: "ambiguous" });
    expect(pick([k29[1]!, k29[1]!], "CNPM")).toEqual({ code: null, resolution: "ambiguous" });
    expect(pick([], "CNPM")).toEqual({ code: null, resolution: "not_found" });
    expect(pick([], null)).toEqual({ code: null, resolution: "not_found" });
  });

  it("gives a K27 student of An ninh Mạng và IoTs the 7480201-01 standard", () => {
    const k27 = [
      standard("71K27CNTT_7480201-01_TN04", "71K27CNTT_7480201-01", "An ninh Mạng và IoTs (7480201-01)"),
      standard("71K27CNTT_7480201-03_TN04", "71K27CNTT_7480201-03", "Công nghệ phần mềm (7480201-03)"),
      standard("71K27CNTT_TN04", "71K27CNTT", ""),
    ];
    expect(pick(k27, "ANM")).toEqual({ code: "71K27CNTT_7480201-01_TN04", resolution: "specialty" });
    expect(pick(k27, "CNPM")).toEqual({ code: "71K27CNTT_7480201-03_TN04", resolution: "specialty" });
    expect(pick(k27, null)).toEqual({ code: "71K27CNTT_TN04", resolution: "general" });
  });
});

describe("'SV chuyên ngành' prerequisite blocks (71ITGR40203/40303)", () => {
  const raw = "SV chuyên ngành CNPM\n[71ITSE41003] Nhập môn Công nghệ phần mềm \n[71ITSE41103] Kỹ thuật lấy yêu cầu \n\nSV chuyên ngành CNDL\n[71ITDS40303] Nhập môn Phân tích Dữ liệu lớn\n\t\nSV chuyên ngành TTNT\n[71ITAI40803] Nhập môn xử lý ảnh số ";

  it("splits the text into one block per specialty", () => {
    const blocks = specialtyBlocks(raw)!;
    expect([...blocks.keys()]).toEqual(["CNPM", "CNDL", "TTNT"]);
    expect(blocks.get("CNPM")).toContain("[71ITSE41103]");
    expect(blocks.get("CNPM")).not.toContain("71ITDS40303");
    expect(blocks.get("TTNT")).toContain("[71ITAI40803]");
  });

  it("returns null for ordinary relation text", () => {
    expect(specialtyBlocks("[71ITSE41003]Nhập môn Công nghệ phần mềm")).toBeNull();
  });
});

describe("specialty suggestion and conflict", () => {
  const course = (type: string, code: SpecialtyCode | null, passed: boolean) =>
    ({ type, passed, specialty: code ? { kind: "specialty" as const, code } : { kind: "common" as const, known: true } });

  it("suggests the only specialty with passed mandatory courses", () => {
    const counts = specialtyCounts([course("BB", "CNPM", true), course("BB", "CNPM", true), course("BB", "CNDL", false), course("TC309", "TTNT", true), course("BB", null, true)]);
    expect(counts).toEqual({ CNPM: 2, CNDL: 0, TTNT: 0, ANM: 0 });
    expect(suggestSpecialty(counts)).toEqual({ code: "CNPM", label: "Công nghệ phần mềm", passedCount: 2, text: "Gợi ý: Công nghệ phần mềm (2 học phần chuyên ngành đã học)" });
  });

  it("does not suggest when courses of two specialties are passed, or none", () => {
    expect(suggestSpecialty({ CNPM: 1, CNDL: 1, TTNT: 0, ANM: 0 })).toBeNull();
    expect(suggestSpecialty({ CNPM: 0, CNDL: 0, TTNT: 0, ANM: 0 })).toBeNull();
  });

  it("suggests An ninh Mạng và IoTs from the K27 ANM courses", () => {
    expect(suggestSpecialty(specialtyCounts([course("BB", "ANM", true), course("BB", null, true)])))
      .toMatchObject({ code: "ANM", passedCount: 1, text: "Gợi ý: An ninh Mạng và IoTs (1 học phần chuyên ngành đã học)" });
  });

  it("flags a declared specialty contradicted by the passed courses", () => {
    expect(specialtyConflict("CNDL", { CNPM: 4, CNDL: 0, TTNT: 0, ANM: 0 })).toEqual({ code: "CNPM", count: 4 });
    expect(specialtyConflict("CNPM", { CNPM: 4, CNDL: 1, TTNT: 0, ANM: 0 })).toBeNull();
    expect(specialtyConflict("CNPM", { CNPM: 0, CNDL: 0, TTNT: 0, ANM: 0 })).toBeNull();
    expect(specialtyConflict("CNPM", { CNPM: 1, CNDL: 0, TTNT: 0, ANM: 3 })).toEqual({ code: "ANM", count: 3 });
  });
});
