import { describe, expect, it } from "vitest";
import { IMPORT_MAX_BYTES, extensionText, importFileProblem } from "./import-file";

// Synthetic file names and sizes only.
const graduation = [".xls", ".xlsx", ".zip"] as const;

describe("import file check", () => {
  it("uses the endpoints' limit, 5 MB as express reads \"5mb\"", () => {
    expect(IMPORT_MAX_BYTES).toBe(5_242_880);
  });

  it("names the accepted types", () => {
    expect(extensionText([".xlsx"])).toBe(".xlsx");
    expect(extensionText(graduation)).toBe(".xls, .xlsx hoặc .zip");
  });

  it("accepts the endpoint's types up to the limit, whatever the case of the extension", () => {
    expect(importFileProblem({ name: "tieu-chuan-K29.xlsx", size: 120_000 }, graduation)).toBe("");
    expect(importFileProblem({ name: "TIEU CHUAN.XLS", size: 1 }, graduation)).toBe("");
    expect(importFileProblem({ name: "bieu-mau.zip", size: IMPORT_MAX_BYTES }, graduation)).toBe("");
  });

  it("refuses another type, an empty file and a file over 5 MB before anything is sent", () => {
    expect(importFileProblem({ name: "tieu-chuan.pdf", size: 1000 }, graduation))
      .toBe("Tệp “tieu-chuan.pdf” không đúng định dạng. Hãy chọn tệp .xls, .xlsx hoặc .zip.");
    expect(importFileProblem({ name: "xlsx", size: 1000 }, graduation)).toContain("không đúng định dạng");
    expect(importFileProblem({ name: "rong.xlsx", size: 0 }, graduation))
      .toBe("Tệp “rong.xlsx” không có dữ liệu. Hãy chọn lại tệp .xls, .xlsx hoặc .zip.");
    expect(importFileProblem({ name: "lon.xlsx", size: 6 * 1024 * 1024 }, graduation))
      .toBe("Tệp “lon.xlsx” lớn hơn 5 MB. Hãy chọn tệp .xls, .xlsx hoặc .zip không quá 5 MB.");
    expect(importFileProblem({ name: "lon.xlsx", size: IMPORT_MAX_BYTES + 1 }, graduation)).toContain("lớn hơn 5 MB");
    expect(importFileProblem({ name: "khung.xls", size: 1000 }, [".xlsx"])).toBe("Tệp “khung.xls” không đúng định dạng. Hãy chọn tệp .xlsx.");
  });
});
