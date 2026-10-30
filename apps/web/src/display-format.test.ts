import { describe, expect, it } from "vitest";
import { decimalText, meaningClass, meaningOf, planTermCode, programName, scoreText, termName } from "./display-format";

describe("display format", () => {
  it("write a term one way", () => {
    expect(termName("HK261")).toBe("HK1 2026–2027");
    expect(termName("HK253")).toBe("HK3 2025–2026");
    expect(termName("Học kỳ phụ")).toBe("Học kỳ phụ");
    expect(planTermCode(1, 1, 2023)).toBe("HK231");
    expect(planTermCode(4, 2, 2023)).toBe("HK262");
  });

  it("round scores down to the tenth with a decimal comma", () => {
    expect(scoreText(59.86)).toBe("59,8");
    expect(scoreText(68)).toBe("68");
    expect(scoreText(62.5)).toBe("62,5");
    expect(scoreText(62.49)).toBe("62,4");
    expect(scoreText(89.99)).toBe("89,9");
    expect(decimalText(2.45)).toBe("2,45");
    expect(decimalText(2.4, 2)).toBe("2,40");
  });

  it("turn capital program names into sentence case", () => {
    expect(programName("KỸ THUẬT PHẦN MỀM")).toBe("Kỹ thuật phần mềm");
    expect(programName("CÔNG NGHỆ THÔNG TIN")).toBe("Công nghệ thông tin");
    expect(programName("HỆ THỐNG THÔNG TIN QUẢN LÝ (HTTT)")).toBe("Hệ thống thông tin quản lý (HTTT)");
    expect(programName("CNTT ỨNG DỤNG AI")).toBe("CNTT ứng dụng AI");
    expect(programName("Mạng máy tính và truyền thông dữ liệu")).toBe("Mạng máy tính và truyền thông dữ liệu");
  });

  it("give one colour per word", () => {
    expect(meaningOf("Ít phù hợp")).toBe("warn");
    expect(meaningOf("Trung bình")).toBe("warn");
    expect(meaningOf("Phù hợp")).toBe("good");
    expect(meaningOf("Khá")).toBe("fine");
    expect(meaningOf("Không phù hợp")).toBe("bad");
    expect(meaningOf("Chưa có điểm")).toBe("none");
    expect(meaningOf(null)).toBe("none");
    expect(meaningClass("warn")).toBe("meaning-warn");
  });
});
