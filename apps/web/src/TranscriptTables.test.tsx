import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TranscriptTables, { transcriptNotes } from "./TranscriptTables";
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
    expect(html).toContain("<h3>2021-2022 · HK02</h3>");
    for (const head of ["STT", "Mã môn học", "Tên môn học", "Tín chỉ", "Hệ 10", "Hệ 4", "Điểm chữ", "Kết quả"]) expect(html).toContain(`>${head}</th>`);
    expect(html).toContain('class="sr-result-pass">Đạt</td>');
    expect(html).toContain('class="sr-result-fail">Không đạt</td>');
    expect(html).toContain("Cần kiểm tra: mã môn khác dạng thường gặp");
    expect(html).toContain("<dt>Điểm TB học kỳ (Hệ 4)</dt><dd>2.55</dd>");
  });

  it("keeps every note of an OCR import, only row notes of a text-layer one", () => {
    expect(transcriptNotes(data())).toEqual(["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh."]);
    expect(transcriptNotes({ ...data(), parserVersion: "vlu-native-1" })).toEqual([]);
  });
});
