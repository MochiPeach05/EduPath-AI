import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TranscriptTables, {
  currentTerms, defaultOpenTerms, foldTerms, initialTermFolds, printedFigure, sectionTitle, shownTerms, termFacts, transcriptNotes,
} from "./TranscriptTables";
import type { Transcript } from "./StudentTranscript";

type Section = Transcript["data"]["sections"][number];
type Course = Section["courses"][number];

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

// An invented history (2026-11-04, terms folded): an exemption kept apart, two graded terms and a term being studied.
const row = (ordinal: number, course: Partial<Course> & Pick<Course, "code" | "name">): Course =>
  ({ ordinal, credits: 3, score10: 8, score4: 3.5, letter: "B+", result: "Đạt", conditional: false, sourcePage: 1, ...course });
const registered = { score10: null, score4: null, letter: null, result: null };
const term = (year: string, semester: string, courses: Course[], average?: string): Section => ({
  id: `${year}-${semester}`, label: `${year} · ${semester}`, academicYear: year, semester, courses,
  summaries: average ? [{ label: "Số tín chỉ đạt học kỳ", value: "3" }, { label: "Điểm TB học kỳ (Hệ 4)", value: average }] : [],
});
const history = (): Transcript["data"] => ({
  schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: 2, courseCount: 8, warnings: [],
  sections: [
    { id: "transfer", label: "Điểm bảo lưu", academicYear: null, semester: null, summaries: [],
      courses: [row(1, { code: "71ENG010012", name: "Anh văn 1", credits: 2, score10: null, score4: null, letter: "MT", result: null })] },
    term("2021-2022", "HK01", [
      row(1, { code: "71ITBS10103", name: "Nhập môn lập trình", letter: "A", score4: 4 }),
      row(2, { code: "71ITMA10104", name: "Toán cao cấp", credits: 4, score10: 3.1, score4: 0.8, letter: "F", result: "Không đạt" }),
    ], "2.10"),
    term("2021-2022", "HK02", [
      // VT and CT without a printed result are not passed; an older cohort's "Đạt" with F stays a pass (the result decides).
      row(1, { code: "71ITBS10203", name: "Lập trình hướng đối tượng", score10: null, score4: null, letter: "VT", result: null }),
      row(2, { code: "71ITMA10104", name: "Toán cao cấp", credits: 4, score10: 4.2, score4: 1, letter: "F", result: "Đạt" }),
      row(3, { code: "71POLI10102", name: "Triết học Mác - Lênin", credits: 2, score10: null, score4: null, letter: "CT", result: null, review: ["unrecognized_letter_grade"] }),
    ], "1.85"),
    term("2022-2023", "HK01", [
      row(1, { code: "71ITSE20103", name: "Cấu trúc dữ liệu và giải thuật", ...registered }),
      row(2, { code: "71ITSE20203", name: "Lập trình web", ...registered }),
    ]),
  ],
});

/** Each term of the markup: its name, header text, whether the header says open, and whether its panel is hidden. */
const termsOf = (html: string) => html.split('<section class="sr-term').slice(1).map(chunk => ({
  name: /class="tt-term-name">([^<]*)</.exec(chunk)?.[1],
  header: (/<h3[^>]*>(.*?)<\/h3>/.exec(chunk)?.[1] ?? "").replace(/<[^>]+>/g, "").trim(),
  expanded: /aria-expanded="true"/.test(chunk),
  hidden: /<div class="tt-term-panel"[^>]*hidden=""/.test(chunk),
  controls: /aria-controls="([^"]+)"/.exec(chunk)?.[1],
  panel: /<div class="tt-term-panel" id="([^"]+)"/.exec(chunk)?.[1],
}));
const render = (transcript: Transcript["data"]) => renderToStaticMarkup(createElement(TranscriptTables, { data: transcript }));
const open = (transcript: Transcript["data"], filters: { term?: string; search?: string } = {}, folds = initialTermFolds(transcript)) =>
  shownTerms(transcript, { term: filters.term ?? "all", search: filters.search ?? "" }, folds).map(view => [view.title, view.open]);

describe("TranscriptTables", () => {
  it("marks a passed mandatory course of another specialty and says how to have it converted, on the student's page only (2026-11-08)", () => {
    const transcript = history();
    transcript.sections[1]!.courses.push(row(3, { code: "71ITSE41003", name: "Nhập môn công nghệ phần mềm" }));
    const convertible = { courses: [{ code: "71ITSE41003", name: "Nhập môn công nghệ phần mềm", credits: 3, specialty: "Công nghệ phần mềm" }], groupCode: "TC309" };
    const html = renderToStaticMarkup(createElement(TranscriptTables, { data: transcript, convertible }));
    expect(html).toContain('<p class="sr-convertible" role="note">Môn Nhập môn công nghệ phần mềm (3 TC, chuyên ngành Công nghệ phần mềm) thuộc chuyên ngành khác');
    expect(html).toContain("liên hệ nhà trường để chuyển môn này thành môn tự chọn chuyên ngành (TC309).</p>");
    // The mark sits on that row alone.
    expect(html.match(/class="sr-other-specialty"/g)).toHaveLength(1);
    expect(html).toContain('<td>Nhập môn công nghệ phần mềm<small class="sr-other-specialty">Môn của chuyên ngành khác: liên hệ nhà trường để chuyển thành môn tự chọn</small></td>');
    // The admin portal's student details pass the transcript alone: no note, no mark.
    const plain = render(transcript);
    expect(plain).not.toContain("sr-convertible");
    expect(plain).not.toContain("sr-other-specialty");
  });

  it("draws each term as the student page does: filters, the eight columns, results and the printed summaries", () => {
    const html = render(data());
    expect(html).toContain("Tất cả học kỳ");
    expect(html).toContain("2 dòng học phần");
    expect(html).toContain('<span class="tt-term-name">HK2 2021–2022</span>');
    expect(html).toContain('<caption class="sr-only">Bảng điểm HK2 2021–2022</caption>');
    expect(html).toContain('<option value="2021-2022-HK02">HK2 2021–2022</option>');
    for (const head of ["STT", "Mã môn học", "Tên môn học", "Tín chỉ", "Hệ 10", "Hệ 4", "Điểm chữ", "Kết quả"]) expect(html).toContain(`>${head}</th>`);
    expect(html).toContain('class="sr-result-pass">Đạt</td>');
    expect(html).toContain('class="sr-result-fail">Không đạt</td>');
    expect(html).toContain("Cần kiểm tra: mã môn khác dạng thường gặp");
    // Decimal commas, like every other page (user review 2026-10-30): the printed "2.55" and the numbers of each row.
    expect(html).toContain("<dt>Điểm TB học kỳ (Hệ 4)</dt><dd>2,55</dd>");
    expect(html).toContain("<td>7,1</td><td>2,84</td>");
    expect(html).not.toMatch(/<(?:td|dd)>[^<]*\d\.\d/);
    // A single term is open, without the fold buttons.
    expect(termsOf(html)).toMatchObject([{ name: "HK2 2021–2022", expanded: true, hidden: false }]);
    expect(html).not.toContain("Mở tất cả");
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

describe("terms folded (2026-11-04)", () => {
  it("opens the newest term with results and the term being studied; older terms and Điểm bảo lưu start folded", () => {
    const html = render(history());
    expect(termsOf(html).map(({ name, expanded, hidden }) => [name, expanded, hidden])).toEqual([
      ["Điểm bảo lưu", false, true],
      ["HK1 2021–2022", false, true],
      ["HK2 2021–2022", true, false],
      ["HK1 2022–2023", true, false],
    ]);
    // Each header names the panel it opens; a folded term keeps its rows in the page (hidden), so printing can show them.
    for (const view of termsOf(html)) expect(view.controls).toBe(view.panel);
    expect(html).toContain("Nhập môn lập trình");
    expect(defaultOpenTerms(history())).toEqual(new Set(["2021-2022-HK02", "2022-2023-HK01"]));
  });

  it("finds the newest term with results and the term being studied in time order, as the competency engine does", () => {
    const [transfer, hk211, hk212, hk221] = history().sections as [Section, Section, Section, Section];
    // Printed out of order: time decides. Two terms registered ahead: the first one is being studied.
    const hk222 = term("2022-2023", "HK02", [row(1, { code: "71ITSE30103", name: "Kiểm thử phần mềm", ...registered })]);
    const ahead = currentTerms({ ...history(), sections: [hk222, hk221, transfer, hk212, hk211] });
    expect([ahead.latest?.id, ahead.studying?.id]).toEqual(["2021-2022-HK02", "2022-2023-HK01"]);
    // A term of VT/CT only has results; no term registered ahead: only the newest term opens.
    expect(defaultOpenTerms({ ...history(), sections: [transfer, hk211, hk212] })).toEqual(new Set(["2021-2022-HK02"]));
    // Grades still missing in the newest term: it is the term being studied too.
    const partly = term("2021-2022", "HK02", [row(1, { code: "71ITBS10203", name: "Lập trình hướng đối tượng" }), row(2, { code: "71ITSE20103", name: "Cấu trúc dữ liệu", ...registered })]);
    expect(currentTerms({ ...history(), sections: [hk211, partly] }).studying?.id).toBe("2021-2022-HK02");
    // Only registrations (a first term): that term opens. No usual term at all: every section opens.
    expect(defaultOpenTerms({ ...history(), sections: [transfer, hk221] })).toEqual(new Set(["2022-2023-HK01"]));
    expect(defaultOpenTerms({ ...history(), sections: [transfer, { ...hk211, id: "unknown", label: "Chưa rõ học kỳ", academicYear: null, semester: null }] }))
      .toEqual(new Set(["transfer", "unknown"]));
  });

  it("says in each header the courses, credits, printed average and, in red only, the courses not passed", () => {
    const html = render(history());
    expect(termsOf(html).map(view => view.header)).toEqual([
      "Điểm bảo lưu 1 môn · 2 TC",
      "HK1 2021–2022 2 môn · 7 TC · Điểm TB học kỳ 2,10 1 môn chưa đạt",
      "HK2 2021–2022 3 môn · 9 TC · Điểm TB học kỳ 1,85 2 môn chưa đạt 1 dòng cần kiểm tra",
      "HK1 2022–2023 2 môn · 6 TC Đang học",
    ]);
    expect(html).toContain('<span class="tt-flag meaning-bad">1 môn chưa đạt</span>');
    expect(html).toContain('<span class="tt-flag meaning-bad">2 môn chưa đạt</span>');
    expect(html).toContain('<span class="tt-flag meaning-warn">1 dòng cần kiểm tra</span>');
    expect(html).toContain('<span class="tt-flag meaning-none">Đang học</span>');
    expect(html.match(/meaning-bad/g)).toHaveLength(2);
    const [transfer, , hk212] = history().sections as [Section, Section, Section];
    expect(termFacts(hk212)).toEqual({ courses: 3, credits: 9, average: "1,85", notPassed: 2, review: 1 });
    expect(termFacts(transfer)).toEqual({ courses: 1, credits: 2, average: null, notPassed: 0, review: 0 });
  });

  it("opens or folds every term with Mở tất cả / Thu gọn tất cả, searching or not", () => {
    const transcript = history();
    expect(render(transcript)).toContain('<button type="button" class="tt-text-button">Mở tất cả</button><button type="button" class="tt-text-button">Thu gọn tất cả</button>');
    const ids = transcript.sections.map(section => section.id);
    const all = foldTerms(initialTermFolds(transcript), { type: "all", ids, open: true });
    expect(open(transcript, {}, all)).toEqual([["Điểm bảo lưu", true], ["HK1 2021–2022", true], ["HK2 2021–2022", true], ["HK1 2022–2023", true]]);
    const none = foldTerms(all, { type: "all", ids, open: false });
    expect(open(transcript, {}, none).every(([, isOpen]) => !isOpen)).toBe(true);
    expect(open(transcript, { search: "lap trinh" }, none).every(([, isOpen]) => !isOpen)).toBe(true);
    // One header opens one term.
    expect(open(transcript, {}, foldTerms(none, { type: "toggle", id: "transfer", filtered: false }))[0]).toEqual(["Điểm bảo lưu", true]);
  });

  it("opens every term a search or a chosen term shows, then gives back the reader's own folds", () => {
    const transcript = history();
    // "lap trinh" finds a course in three terms, one of them folded before: all three open, Điểm bảo lưu is not drawn.
    expect(open(transcript, { search: "lap trinh" })).toEqual([["HK1 2021–2022", true], ["HK2 2021–2022", true], ["HK1 2022–2023", true]]);
    expect(open(transcript, { term: "transfer" })).toEqual([["Điểm bảo lưu", true]]);
    // Folding a found term holds until the search changes; clearing the search brings back the folds from before.
    const folded = foldTerms(initialTermFolds(transcript), { type: "toggle", id: "2021-2022-HK01", filtered: true });
    expect(open(transcript, { search: "lap trinh" }, folded)[0]).toEqual(["HK1 2021–2022", false]);
    expect(open(transcript, { search: "lap trinh w" }, foldTerms(folded, { type: "filter-changed" }))).toEqual([["HK1 2022–2023", true]]);
    expect(open(transcript, { search: "lap trinh" }, foldTerms(folded, { type: "filter-changed" }))[0]).toEqual(["HK1 2021–2022", true]);
    expect(open(transcript, {}, folded)).toEqual([["Điểm bảo lưu", false], ["HK1 2021–2022", false], ["HK2 2021–2022", true], ["HK1 2022–2023", true]]);
  });
});
