import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  parsePlan,
  readWorkbook,
} from "./parser.js";
import { itemSchema, reviewPlan, type PlanData } from "./model.js";

let k29: PlanData;
let k30: PlanData;
let k31: PlanData;

beforeAll(async () => {
  [k29, k30, k31] = await Promise.all(
    [29, 30, 31].map(async (cohort) =>
      readWorkbook(
        await readFile(
          new URL(`../../data/plans/K${cohort}.xlsx`, import.meta.url),
        ),
      ),
    ),
  );
}, 30000);

describe("official training-plan workbooks", () => {
  it("preserves source counts, metadata, terms, and row provenance", () => {
    for (const [data, itemCount, totalCredits, admissionYear] of [
      [k29, 73, 126, 2023],
      [k30, 70, 126, 2024],
      [k31, 74, 132, 2025],
    ] as const) {
      expect(data.items).toHaveLength(itemCount);
      expect(data.totalCredits).toBe(totalCredits);
      expect(data.admissionYear).toBe(admissionYear);
      expect(data.major).toBe("CÔNG NGHỆ THÔNG TIN");
      expect(data.cohortCode).toBe(`K${admissionYear - 1994}`);
      expect(data.terms).toHaveLength(10);
      expect(new Set(data.items.map((item) => item.id)).size).toBe(itemCount);
      expect(data.items.map((item) => item.position)).toEqual(
        Array.from({ length: itemCount }, (_, index) => index + 1),
      );
      for (const item of data.items)
        expect(itemSchema.safeParse(item).success, item.id).toBe(true);
      expect(data.items[0]).toMatchObject({
        id: "row-9",
        sourceRow: 9,
        sourceSheet: "Ke hoach giảng dạy CNTT",
        code: "71ENG110013",
        termCode: data.terms[0]!.code,
      });
    }
  });

  it("keeps the supplied GDTC rows, including missing K31 codes, as unresolved data", () => {
    expect(k29.items.filter((item) => /GDTC/i.test(item.name))).toMatchObject([
      { code: "DGT0010", credits: null, type: "", termCode: "HK232" },
      { code: "DGT0020", credits: null, type: "", termCode: "HK233" },
    ]);
    expect(k31.items.filter((item) => /GDTC/i.test(item.name))).toMatchObject([
      { code: "", credits: null, type: "", termCode: "HK261" },
      { code: "", credits: null, type: "", termCode: "HK271" },
    ]);
    expect(k31.items.filter((item) => /GDTC/i.test(item.name)).every((item) =>
      item.sourceCells.D === "",
    )).toBe(true);
    expect(k31.warnings.filter((warning) =>
      /GDTC/i.test(warning.message) && warning.message.includes("chưa có mã"),
    )).toHaveLength(2);
  });

  it("retains repeated allocations instead of merging them by course code", () => {
    const repeated = k29.items.filter((item) => item.code === "71ITSE30603");
    expect(repeated).toHaveLength(2);
    expect(new Set(repeated.map((item) => item.id)).size).toBe(2);
    expect(k29.warnings.some((warning) =>
      warning.row !== null && warning.message.includes("71ITSE30603") &&
      warning.message.includes("nhiều lần"),
    )).toBe(true);
  });

  it("uses cached values for external formulas and records the limitation", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Plan");
    sheet.getCell("A1").value =
      "KẾ HOẠCH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN - KHÓA 29";
    sheet.getCell("N1").value = 3;
    sheet.getCell("D2").value = "Mã học phần";
    sheet.getCell("E2").value = "Tên học phần (Tiếng Việt)";
    sheet.getCell("A3").value = "HK231";
    sheet.getCell("B3").value = 1;
    sheet.getCell("C3").value = 1;
    sheet.getCell("D3").value = "71TEST10003";
    sheet.getCell("E3").value = {
      formula: "VLOOKUP(D3,'[1]source.xlsx'!$A$1:$B$2,2,0)",
      result: "Tên đã lưu trong Excel",
    };
    sheet.getCell("F3").value = 3;
    sheet.getCell("K3").value = "BB";
    const parsed = await readWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    expect(parsed.items[0]!.name).toBe("Tên đã lưu trong Excel");
    expect(parsed.warnings.some((warning) =>
      warning.message.includes("công thức tham chiếu workbook ngoài"),
    )).toBe(true);
  });

  it("runs the bounded worker on a supplied workbook", async () => {
    const data = await parsePlan(
      await readFile(new URL("../../data/plans/K30.xlsx", import.meta.url)),
    );
    expect(data.cohortCode).toBe("K30");
    expect(data.items).toHaveLength(70);
  }, 30000);

  it("reports the K31 source total against a linked CTĐT total without changing it", () => {
    const data = structuredClone(k31);
    data.curriculum = {
      id: "curriculum-id",
      revisionId: "revision-id",
      version: 1,
      name: "CTĐT K31",
    };
    const linked = {
      ...data,
      totalCredits: 126,
      courses: [],
      groups: [],
      electives: [],
      relations: [],
      sourceWarnings: [],
    } as never;
    reviewPlan(data, linked);
    expect(data.totalCredits).toBe(132);
    expect(data.warnings.some((warning) =>
      warning.message.includes("132 tín chỉ") && warning.message.includes("126 tín chỉ"),
    )).toBe(true);
  });
});

describe("older Faculty templates (K26–K28, 2026-10-23)", () => {
  const read = async (file: string) => readWorkbook(await readFile(new URL(`../../data/${file}`, import.meta.url)));
  it("reads YYS term codes and the headings of each term", async () => {
    const [k26, k27, k28] = await Promise.all([
      read("plans/Ke hoach giảng dạy CNTT K26.xlsx"),
      // The K27 framework workbook carries its plan on the visible "KH & TT" sheet.
      read("curricula/Khung CTĐT K27 CNTT (Gởi SV-CVHT).xlsx"),
      read("plans/Ke hoach giảng dạy CNTT K28.xlsx"),
    ]);
    for (const [data, cohort, total, items, sheet] of [
      [k26, 26, 130, 75, "Thực tế ĐT"],
      [k27, 27, 127, 90, "KH & TT"],
      [k28, 28, 126, 71, "KH & TT"],
    ] as const) {
      expect(data).toMatchObject({
        name: `KẾ HOẠCH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN - KHÓA ${cohort}`, major: "CÔNG NGHỆ THÔNG TIN",
        cohortCode: `K${cohort}`, admissionYear: 1994 + cohort, totalCredits: total,
      });
      expect(data.items).toHaveLength(items);
      expect(new Set(data.items.map((item) => item.sourceSheet))).toEqual(new Set([sheet]));
      for (const item of data.items) {
        expect(itemSchema.safeParse(item).success).toBe(true);
        expect(data.terms.find((term) => term.code === item.termCode)).toMatchObject({ semester: item.semester, studyYear: item.studyYear });
      }
    }
    // "221" is the first term of K28 (2022); the K26 plan starts at "201".
    expect(k28.terms.map((term) => term.code)).toEqual(["HK221", "HK222", "HK223", "HK231", "HK232", "HK233", "HK241", "HK242", "HK243", "HK251"]);
    expect(k26.terms[0]).toEqual({ code: "HK201", semester: 1, studyYear: 1, sourceCredits: null });
    expect(k28.items.find((item) => item.code === "71ITSE30503")).toMatchObject({ termCode: "HK231", studyYear: 2, semester: 1, credits: 3, type: "BB" });
    // A heading without a term code belongs to the term of the next course of the same program term (HK4 = HK231).
    expect(k28.sections[0]).toMatchObject({ termCode: "HK231", label: "Các học phần bắt buộc học chung", kind: "note" });
    expect(k28.sections.some((section) => section.label === "Chuyên ngành CNPM" && section.kind === "specialty")).toBe(true);
    expect(k26.items.find((item) => item.code === "DQP0021")?.type).toBe("BBKTL");
  });

  it("does not take a framework for a plan", async () => {
    await expect(read("curricula/Khung CTĐT K28 CNTT (Gởi SV-CVHT).xlsx")).rejects.toThrow("unsupported_plan_template");
  });
});

// 2026-10-26 (user): plans of the other majors, HTTT and MMT&TTDL. Synthetic workbooks laid out like the teacher's files.
describe("plans of the other majors (HTTT, MMT&TTDL)", () => {
  async function workbook(rows: (string | number | null)[][]) {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("KeHoachĐT");
    rows.forEach((row, r) => row.forEach((value, c) => { if (value !== null) sheet.getCell(r + 1, c + 1).value = value; }));
    return Buffer.from(await book.xlsx.writeBuffer());
  }

  it("finds the columns by their names, the title in any column and the major by its short name", async () => {
    // K31 HTTT has no "Năm Thứ" column; the K31 MMT&TTDL title names the major after the cohort, the total a row below.
    const data = await readWorkbook(await workbook([
      [null, null, "KẾ HOẠCH ĐÀO TẠO THỰC TẾ - KHÓA 31 - MMT & TTDL"],
      [null, null, null, null, null, null, null, null, null, null, null, null, 126],
      ["TT", "Phân bổ học kỳ", "Mã học phần", "Tên học phần (Tiếng Việt)", "Số tín chỉ", "Số tiết/giờ", null, null, null,
        "Bắt buộc/Tự chọn", "ĐK tiên quyết", "ĐK học trước", "Số TC/ HK", "Ghi chú"],
      ["TT", null, null, null, null, "LT", "TH", "DA", "TT"],
      ["HK251\n1", 1, "71ENG110013", "Anh văn 1 (AV1)", 3, 30, 30, 0, 0, "BB", "Không", "Không", 12],
      ["HK251\n1", null, "GDTC1"],
      ["HK261\n4", null, "Chọn 1 trong 2 môn sau"],
      ["HK261\n4", 1, "71ITSE30503", "Lập trình ứng dụng Web", 3, 30, 30, 0, 0, "TC201 (3TC)", "Không", "Không", 6],
      ["HK261\n4", 1, "71ITSE30603", "Lập trình ứng dụng di động", 3, 30, 30, 0, 0, "TC201 (3TC)", "Không", "Không"],
      ["HK262\n5", null, "Nhóm tự chọn Chuyên ngành IoTs: Chọn 1 trong các HP sau"],
      ["HK262\n5", 2, "71NWIO40103", "Lập trình IoT", 3, 30, 30, 0, 0, "TC301", "Không", "Không", 3],
    ]));
    expect(data).toMatchObject({ major: "MẠNG MÁY TÍNH VÀ TRUYỀN THÔNG DỮ LIỆU", cohortCode: "K31", admissionYear: 2025, totalCredits: 126 });
    expect(data.items.map((item) => [item.code, item.name, item.termCode, item.credits, item.type, item.hours.internship, item.sectionId])).toEqual([
      ["71ENG110013", "Anh văn 1 (AV1)", "HK251", 3, "BB", 0, ""],
      // A GDTC slot in the code column is the slot of the name column.
      ["", "GDTC1", "HK251", null, "", null, ""],
      ["71ITSE30503", "Lập trình ứng dụng Web", "HK261", 3, "TC201 (3TC)", 0, "section-7"],
      ["71ITSE30603", "Lập trình ứng dụng di động", "HK261", 3, "TC201 (3TC)", 0, "section-7"],
      ["71NWIO40103", "Lập trình IoT", "HK262", 3, "TC301", 0, "section-10"],
    ]);
    expect(data.sections.map((section) => [section.termCode, section.kind, section.label])).toEqual([
      ["HK261", "choice", "Chọn 1 trong 2 môn sau"],
      ["HK262", "choice", "Nhóm tự chọn Chuyên ngành IoTs: Chọn 1 trong các HP sau"],
    ]);
    expect(data.terms.map((term) => [term.code, term.studyYear, term.sourceCredits])).toEqual([["HK251", 1, 12], ["HK261", 2, 6], ["HK262", 2, 3]]);
    for (const item of data.items) expect(itemSchema.safeParse(item).success, item.id).toBe(true);
  });

  it("reads the allocation as the semester or the term's number, and keeps a contradicting year for review", async () => {
    // K32 HTTT numbers its terms in "Phân bổ học kỳ" (HK271 = 4); K31 MMT&TTDL prints HK273 with year 4.
    const data = await readWorkbook(await workbook([
      ["KẾ HOẠCH ĐÀO TẠO NGÀNH HỆ THỐNG THÔNG TIN - KHÓA 32", null, null, null, null, null, null, null, null, null, null, null, null, 126],
      [],
      ["TT", "Phân bổ học kỳ", "Năm Thứ", "Mã học phần", "Tên học phần (Tiếng Việt)", "Số tín chỉ", "Số tiết/giờ", null, null, null,
        "Bắt buộc/Tự chọn", "ĐK tiên quyết", "ĐK học trước", "Số TC/ HK", "Ghi chú"],
      [null, null, null, null, null, null, "LT", "TH", "ĐA", "TT"],
      ["HK271\n4", 4, 2, "71ENG410043", "Anh văn 4 (AV4)", 3, 30, 30, 0, 0, "BB"],
      ["HK273\n6", 3, 4, "71ISIN40104", "Đồ án thực tập", 4, 0, 0, 0, 60, "BB"],
    ]));
    expect(data).toMatchObject({ major: "HỆ THỐNG THÔNG TIN", cohortCode: "K32", totalCredits: 126 });
    expect(data.items.map((item) => [item.code, item.termCode, item.studyYear, item.semester])).toEqual([
      ["71ENG410043", "HK271", 2, 1], ["71ISIN40104", "HK273", 2, 3],
    ]);
    expect(data.warnings.map((warning) => warning.message)).toContain("Đồ án thực tập: năm/học kỳ ghi ở cột phân bổ khác HK273; giữ theo HK273.");
    expect(data.warnings.some((warning) => /Anh văn 4.*để trống/.test(warning.message))).toBe(false);
  });
});
