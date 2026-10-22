import { describe, expect, it } from "vitest";
import { COURSE_CODE_PATTERN, parsePages } from "./transcript-parser.js";

// Synthetic text items laid out like the VLU transcript (612×792 points); no real transcript.
const item = (text: string, x: number, y: number) => ({ text, x, y, width: text.length * 3.5 });
const header = [["STT", 30], ["Mã môn học", 66], ["Tên môn học", 160], ["Tín chỉ", 330], ["Hệ 10", 390], ["Hệ 4", 430], ["Điểm chữ", 470], ["Kết quả", 532]]
  .map(([text, x]) => item(text as string, x as number, 100));
const row = (y: number, ordinal: number, code: string, name: string, credits: number, score10: string, score4: string, letter: string, result: string) =>
  [item(String(ordinal), 36, y), item(code, 66, y), item(name, 160, y), item(String(credits), 345, y), item(score10, 392, y),
    item(score4, 432, y), item(letter, 478, y), item(result, 532, y)];
const term = (label: string, y: number) => item(label, 40, y);

describe("native transcript parser", () => {
  it("reads old course codes (K26, the GDTC courses of K27/K28) next to the current ones (2026-10-23)", () => {
    const items = [...header, term("Năm học 2020-2021 - HK1", 120),
      ...row(140, 1, "DIT0070", "Cơ sở dữ liệu", 3, "7.5", "3.0", "B", "Đạt"),
      ...row(160, 2, "DGT0010", "Giáo dục thể chất (1) (*)", 0, "8.0", "3.5", "B+", "Đạt"),
      ...row(180, 3, "71ITBS10103", "Nhập môn Công nghệ thông tin", 3, "8.6", "3.8", "A", "Đạt"),
      item("- Điểm trung bình tích lũy hệ 4: 3,40", 40, 200)];
    const data = parsePages([{ page: 1, items }]);
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0]!.courses.map((course) => [course.code, course.credits, course.letter, course.conditional]))
      .toEqual([["DIT0070", 3, "B", false], ["DGT0010", 0, "B+", true], ["71ITBS10103", 3, "A", false]]);
    expect(data.sections[0]!.summaries).toEqual([{ label: "Điểm trung bình tích lũy hệ 4", value: "3,40" }]);
  });

  it("still refuses a numbered row without a course code", () => {
    const items = [...header, term("Năm học 2020-2021 - HK1", 120), ...row(140, 1, "AB123", "Môn lạ", 3, "7.5", "3.0", "B", "Đạt")];
    expect(() => parsePages([{ page: 1, items }])).toThrow("unreadable_rows");
  });

  it("knows both code formats and nothing else", () => {
    for (const code of ["71ITBS10103", "71ENG110013", "71PEBA10052", "DIT0070", "DGT0010", "DTA0015"]) expect(COURSE_CODE_PATTERN.test(code), code).toBe(true);
    for (const code of ["DIT007", "dit0070", "DIT00700", "71IT1010", "Đạt", "2023"]) expect(COURSE_CODE_PATTERN.test(code), code).toBe(false);
  });
});
