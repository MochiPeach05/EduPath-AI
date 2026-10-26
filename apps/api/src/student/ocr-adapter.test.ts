import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { mapOcrTranscript } from "./ocr-adapter.js";
import { createTranscriptWorkerRouter } from "./transcript-jobs.js";
import type { DatabasePool } from "../db/pool.js";
const fixture = () => ({
  schema_version: "1.1", adapter: "vlu_8_columns", course_count: 1, needs_review: true,
  pages: [{ page: 1, method: "ppocr", warnings: ["ocr_requires_visual_review"] }],
  courses: [{
    ordinal: 1, course_code: "71ENG01000", course_name: "Tiếng Anh", credits: 3, score_10: 6, score_4: 2.4, letter_grade: "C", result: "passed", source_page: 1,
    academic_year: "2023-2024", semester: "HK01", section: "semester", needs_review: true, issues: [] as string[]
  }],
  summaries: [{ academic_year: "2023-2024", semester: "HK01", raw_cells: [null, "- Điểm TB học kỳ (Hệ 4): 2.4"] }], semesters: [{ semester_gpa_4: 2.4 }], unparsed_rows: []
});
describe("OCR result boundary", () => {
  it("maps grades and icons, keeps review provenance and printed totals", () => {
    const result = mapOcrTranscript(fixture());
    expect(result.sections[0]?.courses[0]).toMatchObject({ code: "71ENG01000", score10: 6, score4: 2.4, result: "Đạt" });
    expect(result.sections[0]?.summaries).toEqual([{ label: "Điểm TB học kỳ (Hệ 4)", value: "2.4" }]);
    expect(result.ocr?.needsReview).toBe(true);
  });
  it("accepts VT (vắng thi): a failed attempt printed without a score", () => {
    const f = fixture();
    Object.assign(f.courses[0]!, { score_10: null, score_4: null, letter_grade: "VT", result: "failed" });
    expect(mapOcrTranscript(f).sections[0]?.courses[0]).toMatchObject({ score10: null, score4: null, letter: "VT", result: "Không đạt" });
  });
  it("accepts CT (cấm thi, 2026-10-26) the same way, with nothing to check", () => {
    const f = fixture();
    Object.assign(f.courses[0]!, { score_10: null, score_4: null, letter_grade: "CT", result: "failed", issues: [] });
    const [barred] = mapOcrTranscript(f).sections[0]!.courses;
    expect(barred).toMatchObject({ score10: null, score4: null, letter: "CT", result: "Không đạt" });
    expect(barred).not.toHaveProperty("review");
  });
  it.each(["count", "score", "page", "type"])("rejects a result that breaks the worker contract (%s)", kind => {
    const f = fixture();
    if (kind === 'count') f.course_count = 2;
    if (kind === 'score') f.courses[0]!.score_10 = 11;
    if (kind === 'page') f.courses[0]!.source_page = 2;
    if (kind === 'type') (f.courses[0] as Record<string, unknown>).ordinal = "1";
    expect(() => mapOcrTranscript(f)).toThrow("invalid_ocr_result");
  });
  it("refuses a result without any course row: the frame was not found", () => {
    const f = fixture();
    f.courses = []; f.course_count = 0;
    expect(() => mapOcrTranscript(f)).toThrow("unsupported_layout");
  });
  // 2026-10-25 (user): "4.1 điểm F nhưng vẫn đạt là do khóa trước chỉ có 4đ thôi là đạt rồi nên đây không phải lỗi".
  it("does not mark Đạt with 4,0 or more as conflicting with an F letter (older cohorts passed from 4,0)", () => {
    const f = fixture();
    const row = (ordinal: number, changes: Record<string, unknown>) => ({ ...f.courses[0]!, ordinal, issues: [] as string[], ...changes }) as typeof f.courses[number];
    f.courses = [
      row(1, { course_code: "71ITNW30103", score_10: 4.1, score_4: 1.64, letter_grade: "F", result: "passed", issues: ["result_conflicts_with_grade"] }),
      row(2, { course_code: "71ITIS30103", score_10: 3.5, score_4: 1.4, letter_grade: "F", result: "passed", issues: ["result_conflicts_with_grade"] }),
      row(3, { course_code: "71ITSE30103", score_10: 5, score_4: 2, letter_grade: "D", result: "failed", issues: ["result_conflicts_with_grade"] }),
    ];
    f.course_count = 3;
    const data = mapOcrTranscript(f);
    const courses = data.sections[0]!.courses;
    // The printed result stays (Đạt counts as passed everywhere); only the 4,1 row loses its mark.
    expect(courses.map((c) => [c.code, c.result, c.review ?? null])).toEqual([
      ["71ITNW30103", "Đạt", null], ["71ITIS30103", "Đạt", ["result_conflicts_with_grade"]], ["71ITSE30103", "Không đạt", ["result_conflicts_with_grade"]]]);
    expect(data.warnings.some((w) => w.startsWith("Có 2 dòng có mã môn, ký hiệu"))).toBe(true);
  });
  // 2026-10-23 (user): same frame, new codes, names or marks → save everything, mark it for review.
  it("keeps rows that do not fit a known form and marks them for review", () => {
    const f = fixture();
    const row = (ordinal: number, changes: Record<string, unknown>) => ({ ...f.courses[0]!, ordinal, issues: [] as string[], ...changes }) as typeof f.courses[number];
    f.courses = [
      row(1, { course_code: "DIT00701", issues: ["invalid_course_code"] }),
      row(2, { letter_grade: "P", result: null, result_raw: "Miễn", score_10: null, score_4: null, issues: ["unrecognized_letter_grade", "unrecognized_result"] }),
      row(3, { credits: null, score_10: null, issues: ["missing_credits", "invalid_score_10", "incomplete_scores"], raw_cells: ["3", "71ENG01001", "Tiếng Anh 2", "", "8,5x", "3.2", "B", "✓"] }),
      row(3, {}),
    ];
    f.course_count = 4;
    const data = mapOcrTranscript(f);
    const courses = data.sections[0]!.courses;
    expect(courses.map(c => [c.code, c.letter, c.result, c.credits, c.score10])).toEqual([
      ["DIT00701", "C", "Đạt", 3, 6], ["71ENG01000", "P", "Miễn", 3, null], ["71ENG01000", "C", "Đạt", 0, null], ["71ENG01000", "C", "Đạt", 3, 6]]);
    expect(courses.map(c => c.review)).toEqual([["invalid_course_code"], ["unrecognized_letter_grade", "unrecognized_result"],
      ["missing_credits", "invalid_score_10", "incomplete_scores"], ["duplicate_row"]]);
    expect(courses[2]!.printed).toEqual({ credits: "", score10: "8,5x" });
    expect(courses[0]!.printed).toBeUndefined();
    expect(data.warnings.some(w => w.startsWith("Có 4 dòng có mã môn, ký hiệu"))).toBe(true);
  });
  it("keeps rows of an unknown or unusual term and reports rows it could not read", () => {
    const f = fixture();
    f.courses.push({ ...f.courses[0]!, ordinal: 2, academic_year: null as unknown as string, semester: null as unknown as string, section: "unknown" },
      { ...f.courses[0]!, ordinal: 1, semester: "HK04" });
    f.course_count = 3;
    (f.unparsed_rows as unknown[]).push({ source_page: 1, raw_cells: ["", "", "Ghi chú"] });
    const data = mapOcrTranscript(f);
    expect(data.sections.map(s => [s.id, s.label, s.courses.length])).toEqual([["2023-2024-HK01", "2023-2024 · HK01", 1], ["unknown", "Chưa rõ học kỳ", 1], ["2023-2024-HK04", "2023-2024 · HK04", 1]]);
    expect(data.sections[1]!.courses[0]!.review).toEqual(["missing_semester_context"]);
    expect(data.sections[2]!.courses[0]!.review).toEqual(["unusual_term"]);
    expect(data.warnings.at(-1)).toBe("Có 1 dòng trong PDF không đọc được thành dòng môn học (không có số thứ tự) nên chưa được lưu; hãy đối chiếu với PDF gốc. (trang 1)");
  });
  it("leaves a row it read normally without a review mark", () => {
    expect(mapOcrTranscript(fixture()).sections[0]!.courses[0]!.review).toBeUndefined();
  });
  it("does not require a school email or student identity in the PDF", () => expect(mapOcrTranscript(fixture()).courseCount).toBe(1));
  it("rejects missing/wrong worker keys before parsing JSON or touching DB", async () => {
    const app = express(); app.use(createTranscriptWorkerRouter({} as DatabasePool, "k".repeat(32)));
    await request(app).post('/claim').expect(401);
    await request(app).post('/claim').set('Authorization', 'Bearer wrong').send({}).expect(401);
  });
});
