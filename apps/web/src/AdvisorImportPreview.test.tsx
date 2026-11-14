import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdvisorImport, ImportPreview, rowsText } from "./AdvisorsManagement";
import { IMPORT_AGAIN_TEXT } from "./advisor-admin";
import { ownCancel } from "./admin-ui";
import type { AdvisorImportItem } from "./advisor-types";

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

// User 2026-11-14: "Phải cho phép import lại file Excel sau khi dữ liệu thay đổi. Không chỉ import một lần. Dòng không thay đổi
// giữ nguyên, dòng có nội dung thay đổi phải được cập nhật tương ứng." Names and emails are made up.
describe("Import danh sách cố vấn học tập: importing a tệp again", () => {
  const row = (over: Partial<AdvisorImportItem>): AdvisorImportItem => ({ rows: [4], name: "Nguyễn Văn An", email: "an.nv@vlu.edu.vn", staffCode: "GV01",
    unit: "Bộ môn KTPM", classes: ["71K29CNTT01"], status: "unchanged", changes: [], problems: [], emptyClasses: [], ...over });

  it("shows the changed rows as Cập nhật with what changes, the others as Không đổi", () => {
    const html = renderToStaticMarkup(<ImportPreview preview={{ fileName: "CVHT 2026-2027.xlsx", rows: 3, fileProblems: [],
      summary: { add: 0, update: 2, unchanged: 1, error: 0, classes: 4, moved: 1 },
      items: [
        row({ rows: [4], status: "update", name: "Nguyễn Văn Anh", changes: ["Đổi họ và tên: Nguyễn Văn An → Nguyễn Văn Anh", "Bỏ lớp 71K29CNTT02"] }),
        row({ rows: [5], email: "binh.tt@vlu.edu.vn", name: "Trần Thị Bình", classes: ["71K29CNTT03"] }),
        row({ rows: [6], email: "em.vv@vlu.edu.vn", name: "Võ Văn Em", classes: ["71K29CNTT02", "71K29CNTT07"], status: "update",
          changes: ["Thêm lớp 71K29CNTT02", "Lớp 71K29CNTT02 chuyển từ Nguyễn Văn An"] }),
      ] }} />);
    expect(html).toContain("Đọc 3 dòng · 2 cập nhật · 1 không đổi · 4 lớp, 1 lớp chuyển cố vấn");
    expect(html.match(/<span class="av-status av-status-update">Cập nhật<\/span>/g)).toHaveLength(2);
    expect(html.match(/<span class="av-status av-status-unchanged">Không đổi<\/span>/g)).toHaveLength(1);
    expect(html).toContain('<li class="av-note-change">Đổi họ và tên: Nguyễn Văn An → Nguyễn Văn Anh</li><li class="av-note-change">Bỏ lớp 71K29CNTT02</li>');
    expect(html).toContain('<li class="av-note-change">Lớp 71K29CNTT02 chuyển từ Nguyễn Văn An</li>');
    expect(html).not.toContain("av-nothing");
  });

  it("says there is nothing to import when the same tệp is chosen again", () => {
    const html = renderToStaticMarkup(<ImportPreview preview={{ fileName: "CVHT 2026-2027.xlsx", rows: 2, fileProblems: [],
      summary: { add: 0, update: 0, unchanged: 2, error: 0, classes: 2, moved: 0 },
      items: [row({}), row({ rows: [5], email: "binh.tt@vlu.edu.vn", name: "Trần Thị Bình", classes: ["71K29CNTT03"] })] }} />);
    expect(html).toContain("Đọc 2 dòng · 2 không đổi · 2 lớp");
    expect(html).toContain('<p class="cm-help av-nothing" role="status">Mọi dòng trong tệp đều giống danh sách hiện tại, không có gì cần cập nhật.</p>');
  });

  it("tells the admin in the dialog that a tệp can be imported again after an edit", () => {
    const html = renderToStaticMarkup(<AdvisorImport close={() => undefined} imported={() => undefined} />);
    expect(IMPORT_AGAIN_TEXT).toBe("Có thể import lại tệp nhiều lần sau khi sửa: dòng không thay đổi được giữ nguyên, dòng có nội dung thay đổi được cập nhật tương ứng.");
    expect(html).toContain(`<p class="cm-help">${IMPORT_AGAIN_TEXT}</p>`);
    expect(html).toContain('<input type="file" accept=".xlsx"/>');
    expect(html).toContain("Tải file mẫu");
  });

  it("keeps a dialog open when its file chooser closes without a new choice: only the dialog's own cancel (Esc) closes it", () => {
    const dialog = { id: "dialog" } as unknown as EventTarget;
    const input = { id: "input" } as unknown as EventTarget;
    // Chrome fires a bubbling cancel event at a file input whose chooser was cancelled or given the same file again.
    expect(ownCancel({ target: input, currentTarget: dialog })).toBe(false);
    expect(ownCancel({ target: dialog, currentTarget: dialog })).toBe(true);
  });
});
