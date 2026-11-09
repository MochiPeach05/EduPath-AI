import { describe, expect, it } from "vitest";
import { COURSE_CODE_PATTERN, NO_SCORE_LETTERS, parsePages, reviewWarning, withoutSettledReviews, type TranscriptCourse, type TranscriptData } from "./transcript-parser.js";

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

  // 2026-10-23 (user): the frame is the same → keep every numbered row as printed and mark what looks new.
  it("keeps numbered rows with a new code, an unknown mark or a cell that is not a number, marked for review", () => {
    const items = [...header, term("Năm học 2020-2021 - HK1", 120),
      ...row(140, 1, "AB123", "Môn mã mới", 3, "7.5", "3.0", "B", "Đạt"),
      ...row(160, 2, "DIT0070", "Cơ sở dữ liệu", 3, "", "", "P", "Miễn"),
      ...row(180, 3, "DIT0080", "Mạng máy tính", 3, "8,5x", "3.0", "B", "Đạt"),
      ...row(200, 3, "DIT0090", "Hệ điều hành", 3, "7.0", "3.0", "B", "Đạt")];
    const data = parsePages([{ page: 1, items }]);
    const courses = data.sections[0]!.courses;
    expect(courses.map((c) => [c.code, c.letter, c.result, c.score10, c.review ?? null])).toEqual([
      ["AB123", "B", "Đạt", 7.5, ["invalid_course_code"]],
      ["DIT0070", "P", "Miễn", null, ["unrecognized_letter_grade"]],
      ["DIT0080", "B", "Đạt", null, ["invalid_score_10", "incomplete_scores"]],
      ["DIT0090", "B", "Đạt", 7, ["duplicate_row"]]]);
    expect(courses[2]!.printed).toEqual({ score10: "8,5x" });
    expect(data.warnings.at(-1)).toMatch(/^Có 4 dòng có mã môn, ký hiệu/);
  });

  it("reads CT (cấm thi) like VT: a failed attempt printed without a score, nothing to check (2026-10-26)", () => {
    const items = [...header, term("Năm học 2023-2024 - HK1", 120),
      ...row(140, 1, "71ENG310033", "Anh văn 3 (AV3)", 3, "CT", "CT", "CT", "Không đạt"),
      ...row(160, 2, "71ITSE30503", "Lập trình ứng dụng web", 3, "6.8", "2.72", "C+", "Đạt")];
    const [barred] = parsePages([{ page: 1, items }]).sections[0]!.courses;
    expect(barred).toMatchObject({ score10: null, score4: null, letter: "CT", result: "Không đạt" });
    expect(barred).not.toHaveProperty("review");
    expect(barred).not.toHaveProperty("printed");
  });

  it("reads DC the same way, its mark kept as printed (user 2026-11-09)", () => {
    const items = [...header, term("Năm học 2023-2024 - HK1", 120),
      ...row(140, 1, "71ENG210023", "Anh văn 2 (AV2)", 3, "DC", "DC", "DC", "Không đạt")];
    const [mark] = parsePages([{ page: 1, items }]).sections[0]!.courses;
    expect(mark).toMatchObject({ score10: null, score4: null, letter: "DC", result: "Không đạt" });
    expect(mark).not.toHaveProperty("review");
    expect(NO_SCORE_LETTERS).toContain("DC");
  });

  it("keeps rows before any term heading in a section of their own, and refuses a page without course rows", () => {
    const items = [...header, ...row(140, 1, "DIT0070", "Cơ sở dữ liệu", 3, "7.5", "3.0", "B", "Đạt")];
    const data = parsePages([{ page: 1, items }]);
    expect(data.sections.map((s) => [s.id, s.label, s.courses[0]!.review])).toEqual([["unknown", "Chưa rõ học kỳ", ["missing_semester_context"]]]);
    expect(() => parsePages([{ page: 1, items: [...header, term("Năm học 2020-2021 - HK1", 120)] }])).toThrow("unsupported_layout");
  });

  it("refuses the portal's \"Xem điểm theo CTĐT\" table by name, on any page (user 2026-11-05)", () => {
    const ctdt = [["STT", 30], ["Mã học phần", 66], ["Tên học phần", 160], ["Số tín chỉ", 330], ["Môn tương đương", 380], ["Điểm", 440], ["Điểm chữ", 470], ["Kết quả", 532]]
      .map(([text, x]) => item(text as string, x as number, 100));
    const course = row(140, 1, "71ITBS10103", "Nhập môn công nghệ thông tin", 3, "", "3.20", "B+", "");
    expect(() => parsePages([{ page: 1, items: [...ctdt, ...course] }])).toThrow("curriculum_view");
    // A full-page print: the portal menu on page 1, the table on page 2.
    expect(() => parsePages([{ page: 1, items: [item("Kết quả học tập (/Home/Marks)", 30, 100)] }, { page: 2, items: [...ctdt, ...course] }])).toThrow("curriculum_view");
  });

  it("knows both code formats and nothing else", () => {
    for (const code of ["71ITBS10103", "71ENG110013", "71PEBA10052", "DIT0070", "DGT0010", "DTA0015"]) expect(COURSE_CODE_PATTERN.test(code), code).toBe(true);
    for (const code of ["DIT007", "dit0070", "DIT00700", "71IT1010", "Đạt", "2023"]) expect(COURSE_CODE_PATTERN.test(code), code).toBe(false);
  });
});

// 2026-10-25 (user): Đạt with 4,0 or more is right for older cohorts whatever the letter; a stored transcript reads as a new upload.
describe("withoutSettledReviews", () => {
  const course = (ordinal: number, changes: Partial<TranscriptCourse>): TranscriptCourse => ({
    ordinal, code: `71ITNW3010${ordinal}`, name: "Môn", credits: 3, score10: 4.1, score4: 1.64, letter: "F", result: "Đạt", conditional: false, sourcePage: 1, ...changes });
  const data = (courses: TranscriptCourse[], reviewed: number): TranscriptData => ({
    schemaVersion: 1, parserVersion: "vlu-ocr-1.1", pageCount: 1, courseCount: courses.length,
    sections: [{ id: "2021-2022-HK02", academicYear: "2021-2022", semester: "HK02", label: "2021-2022 · HK02", courses, summaries: [] }],
    warnings: ["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh.", reviewWarning(reviewed)],
  });

  it("drops the mark of Đạt with 4,0 or more and recounts the warning", () => {
    const stored = data([course(1, { review: ["result_conflicts_with_grade"] }), course(2, { review: ["result_conflicts_with_grade", "invalid_course_code"] }),
      course(3, { score10: 3.5, review: ["result_conflicts_with_grade"] })], 3);
    const read = withoutSettledReviews(stored);
    expect(read.sections[0]!.courses.map((row) => row.review ?? null)).toEqual([null, ["invalid_course_code"], ["result_conflicts_with_grade"]]);
    expect(read.sections[0]!.courses[0]).not.toHaveProperty("review");
    expect(read.warnings).toEqual(["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh.", reviewWarning(2)]);
  });

  it("removes the warning when no row is left to check, and leaves other transcripts as they are", () => {
    const read = withoutSettledReviews(data([course(1, { review: ["result_conflicts_with_grade"] })], 1));
    expect(read.warnings).toEqual(["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh."]);
    const untouched = data([course(1, { result: "Không đạt", letter: "D", score10: 5, review: ["result_conflicts_with_grade"] })], 1);
    expect(withoutSettledReviews(untouched)).toBe(untouched);
  });

  // 2026-10-26 (user): "CT … là chữ cấm thi cũng là không đạt"; rows stored before were marked as unknown marks.
  it("drops the marks of a stored CT row with its printed mark, and keeps a row whose cells say something else", () => {
    const barred = { score10: null, score4: null, letter: "CT", result: "Không đạt", printed: { score10: "CT", score4: "CT" },
      review: ["invalid_score_10", "invalid_score_4", "unrecognized_letter_grade"] };
    const read = withoutSettledReviews(data([course(1, barred), course(2, { ...barred, printed: { score10: "CT", score4: "2,5x" } })], 2));
    expect(read.sections[0]!.courses[0]).toMatchObject({ letter: "CT", score10: null, score4: null });
    expect(read.sections[0]!.courses[0]).not.toHaveProperty("review");
    expect(read.sections[0]!.courses[0]).not.toHaveProperty("printed");
    expect(read.sections[0]!.courses[1]).toMatchObject({ review: barred.review, printed: { score10: "CT", score4: "2,5x" } });
    expect(read.warnings).toEqual(["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh.", reviewWarning(1)]);
  });

  it("drops the marks of a DC row stored before DC was known (2026-11-09), as for CT", () => {
    const mark = { score10: null, score4: null, letter: "DC", result: "Không đạt", printed: { score10: "DC", score4: "DC" },
      review: ["invalid_score_10", "invalid_score_4", "unrecognized_letter_grade"] };
    const read = withoutSettledReviews(data([course(1, mark)], 1));
    expect(read.sections[0]!.courses[0]).toMatchObject({ letter: "DC", score10: null, score4: null, result: "Không đạt" });
    expect(read.sections[0]!.courses[0]).not.toHaveProperty("review");
    expect(read.warnings).toEqual(["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh."]);
  });
});
