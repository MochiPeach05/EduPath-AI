import { describe, expect, it } from "vitest";
import { decimalText, formatVnDate, formatVnDateTime, meaningClass, meaningOf, planTermCode, programName, scoreText, termName } from "./display-format";

describe("display format", () => {
  it("write a day and a moment one way, in Vietnam time", () => {
    expect(formatVnDateTime("2026-11-03T07:05:09.000Z")).toBe("14:05 03/11/2026");
    expect(formatVnDateTime("2026-10-23T17:00:05.000Z")).toBe("00:00 24/10/2026");
    expect(formatVnDateTime(Date.UTC(2026, 0, 2, 3, 4))).toBe("10:04 02/01/2026");
    expect(formatVnDate("2026-11-03T18:30:00.000Z")).toBe("04/11/2026");
    expect(formatVnDate("2026-11-03")).toBe("03/11/2026");
    expect(formatVnDate(new Date("2026-03-09T00:00:00+07:00"))).toBe("09/03/2026");
    for (const value of [null, undefined, "", "not a date"]) {
      expect(formatVnDateTime(value)).toBe("—");
      expect(formatVnDate(value, "Chưa có dữ liệu")).toBe("Chưa có dữ liệu");
    }
  });

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
