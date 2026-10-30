import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TranscriptTables, { printedFigure, sectionTitle, transcriptNotes } from "./TranscriptTables";
import type { Transcript } from "./StudentTranscript";

// The tables the student page and the admin portal's student details share (2026-10-25).
const data = (): Transcript["data"] => ({
  schemaVersion: 1, parserVersion: "vlu-ocr-1.1", pageCount: 2, courseCount: 2,
  warnings: ["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh."],
  sections: [{
    id: "2021-2022-HK02", label: "2021-2022 · HK02", academicYear: "2021-2022", semester: "HK02",
    courses: [
      { ordinal: 1, code: "71ITMA10104", name: "Toán cao cấp và ứng dụng", credits: 4, score10: 7.1, score4: 2.84, letter: "B", result: "Đạt", conditional: false, sourcePage: 1 },
      { ordinal: 2, code: "71ENG510053", name: "Anh văn 5", credits: 3, score10: 3.2, score4: 1.28, letter: "F", result: "Không đạt", conditional: false, sourcePage: 1, review: ["invalid_course_code"] },
    ],
    summaries: [{ label: "Điểm TB học kỳ (Hệ 4)", value: "2.55" }],
  }],
});

describe("TranscriptTables", () => {
  it("draws each term as the student page does: filters, the eight columns, results and the printed summaries", () => {
    const html = renderToStaticMarkup(createElement(TranscriptTables, { data: data() }));
    expect(html).toContain("Tất cả học kỳ");
    expect(html).toContain("2 dòng học phần");
    expect(html).toContain("<h3>HK2 2021–2022</h3>");
    expect(html).toContain('<option value="2021-2022-HK02">HK2 2021–2022</option>');
    for (const head of ["STT", "Mã môn học", "Tên môn học", "Tín chỉ", "Hệ 10", "Hệ 4", "Điểm chữ", "Kết quả"]) expect(html).toContain(`>${head}</th>`);
    expect(html).toContain('class="sr-result-pass">Đạt</td>');
    expect(html).toContain('class="sr-result-fail">Không đạt</td>');
    expect(html).toContain("Cần kiểm tra: mã môn khác dạng thường gặp");
    // Decimal commas, like every other page (user review 2026-10-30): the printed "2.55" and the numbers of each row.
    expect(html).toContain("<dt>Điểm TB học kỳ (Hệ 4)</dt><dd>2,55</dd>");
    expect(html).toContain("<td>7,1</td><td>2,84</td>");
    expect(html).not.toMatch(/<(?:td|dd)>[^<]*\d\.\d/);
  });

  it("name a term section the one way terms are written, other headings as printed", () => {
    expect(sectionTitle({ label: "2023-2024 · HK01", academicYear: "2023-2024", semester: "HK01" })).toBe("HK1 2023–2024");
    expect(sectionTitle({ label: "2025-2026 · HK3", academicYear: "2025-2026", semester: "HK3" })).toBe("HK3 2025–2026");
    expect(sectionTitle({ label: "Điểm bảo lưu", academicYear: null, semester: null })).toBe("Điểm bảo lưu");
    expect(sectionTitle({ label: "2023-2025 · HK01", academicYear: "2023-2025", semester: "HK01" })).toBe("2023-2025 · HK01");
    expect(sectionTitle({ label: "2023-2024 · HK04", academicYear: "2023-2024", semester: "HK04" })).toBe("2023-2024 · HK04");
    expect(printedFigure("2.45")).toBe("2,45");
    expect(printedFigure("3.10 (Khá)")).toBe("3,10 (Khá)");
    expect(printedFigure("120")).toBe("120");
    expect(printedFigure("Khá")).toBe("Khá");
  });

  it("keeps every note of an OCR import, only row notes of a text-layer one", () => {
    expect(transcriptNotes(data())).toEqual(["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh."]);
    expect(transcriptNotes({ ...data(), parserVersion: "vlu-native-1" })).toEqual([]);
  });
});
