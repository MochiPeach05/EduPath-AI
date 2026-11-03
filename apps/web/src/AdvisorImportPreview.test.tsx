import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportPreview, rowsText } from "./AdvisorsManagement";

// The Khoa's own workbook (2026-11-03): the preview names the sheets read and how they compare, and the sheet of an
// advisor's rows when it is not the first one (apps/api/src/advisors/import.ts). Names and emails are made up.
describe("Import danh sách cố vấn học tập: the sheets read", () => {
  it("writes three rows or more in a row as a range", () => {
    expect(rowsText([6, 7, 8, 9, 12])).toBe("6–9, 12");
    expect(rowsText([2, 3])).toBe("2, 3");
    expect(rowsText([4, 6, 7, 8])).toBe("4, 6–8");
    expect(rowsText([])).toBe("");
  });

  it("lists the notes on the sheets and names the sheet of an advisor read from another one", () => {
    const html = renderToStaticMarkup(<ImportPreview preview={{
      fileName: "CVHT _Phan cong 2026_2027.xlsx", rows: 7, fileProblems: [], sheets: ["GUI PDT", "Theo lớp"],
      notes: [
        { tone: "info", text: 'Đọc 2 trang tính, gộp theo email: "GUI PDT" (2 dòng), "Theo lớp" (5 dòng). Cột Dòng theo trang "GUI PDT".' },
        { tone: "warn", text: 'Trang "Theo lớp" ghi khác trang "GUI PDT": 1 lớp chỉ có ở trang "Theo lớp" (71K30CNTT02).' },
      ],
      summary: { add: 2, update: 0, unchanged: 0, error: 0, classes: 5, moved: 0 },
      items: [
        { rows: [6, 7, 8, 9], name: "Nguyễn Văn An", email: "an.nv@vlu.edu.vn", staffCode: "1000000001", unit: null,
          classes: ["71K27CNTT01", "71K27CNTT02", "71K27CNTT03", "71K28CNTT05"], status: "add", changes: ["Thêm cố vấn học tập mới"], problems: [], emptyClasses: [] },
        { rows: [10], sheet: "Theo lớp", name: "Lê Văn Cường", email: "cuong.lv@vlu.edu.vn", staffCode: null, unit: null,
          classes: ["71K30CNTT02"], status: "add", changes: ["Thêm cố vấn học tập mới"], problems: [], emptyClasses: ["71K30CNTT02"] },
      ],
    }} />);
    expect(html).toContain('<ul class="av-notes" aria-label="Trang tính đã đọc"><li class="av-note-change">Đọc 2 trang tính, gộp theo email');
    expect(html).toContain('<li class="av-note-warn">Trang &quot;Theo lớp&quot; ghi khác trang &quot;GUI PDT&quot;');
    expect(html).toContain('<td class="cm-stt">6–9</td>');
    expect(html).toContain('<td class="cm-stt">10<small style="white-space:normal">trang Theo lớp</small></td>');
    expect(html).not.toContain("Tệp chưa đọc được hết");
  });

  it("shows no notes for a preview without them", () => {
    const html = renderToStaticMarkup(<ImportPreview preview={{ fileName: "x.xlsx", rows: 0, items: [], fileProblems: [],
      summary: { add: 0, update: 0, unchanged: 0, error: 0, classes: 0, moved: 0 } }} />);
    expect(html).not.toContain("av-notes");
  });
});
