import { describe, expect, it } from "vitest";
import {
  advisorTemplate, headerField, planImport, readAdvisorGrid, readAdvisorSheets, readAdvisorWorkbook, splitClasses, type AdvisorSheet,
  type ImportLookups,
} from "./import.js";
import { AdvisorError } from "./model.js";

const domains = new Set(["vlu.edu.vn"]);
const lookups = (overrides: Partial<ImportLookups> = {}): ImportLookups => ({
  accounts: new Map(), advisors: new Map(), classOwners: new Map(), classesWithStudents: new Set(["71K29CNTT01", "71K29CNTT02"]),
  staffDomains: domains, ...overrides,
});
const header = ["STT", "Họ và tên", "Email", "Mã giảng viên", "Đơn vị", "Lớp phụ trách"];

// The Khoa's own file (CVHT _Phan cong 2026_2027, user 2026-11-03), made up: four title rows, the header on row 5, one
// sheet with a row per advisor for Phòng Đào tạo (classes written short) and one with a row per class.
const titles = (width: number) => [["TRƯỜNG ĐẠI HỌC VĂN LANG"], ["KHOA CÔNG NGHỆ THÔNG TIN"],
  Array<string>(width).fill("DANH SÁCH CỐ VẤN HỌC TẬP"), Array<string>(width).fill("NĂM HỌC 2026 - 2027")];
const PDT = ["STT", "MGV", "CVHT", "EMAIL", "MÃ LỚP", "SLSV Hiện tại", "GHI CHÚ"];
const BY_CLASS = ["STT", "MGV", "CVHT", "EMAIL", "MÃ LỚP", "KHÓA", "SLSV Hiện tại", "SLSV ban đầu", "GHI CHÚ"];
const an = ["1000000001", "Nguyễn Văn An", "an.nv@vlu.edu.vn"];
const binh = ["0000012345", "Trần Thị Bình", "binh.tt@vlu.edu.vn"];
const cuong = ["1000000003", "Lê Văn Cường", "cuong.lv@vlu.edu.vn"];
const pdtGrid = [...titles(7), PDT,
  ["1", ...an, "71K27CNTT01, 02, 03\n71K28CNTT05", "180", ""],
  ["2", ...binh, "71K29CNTT01", "45", "CVHT mới"]];
const classGrid = [...titles(9), BY_CLASS,
  ["1", ...an, "71K27CNTT01", "K27", "60", "62", ""],
  ["2", ...an, "71K27CNTT02", "K27", "60", "61", ""],
  ["3", ...an, "71K27CNTT03", "K27", "58", "60", ""],
  ["4", ...an, "71K28CNTT05", "K28", "2", "60", "Lớp ghép"],
  ["5", ...binh, "71K29CNTT01", "K29", "45", "45", ""]];
const anItem = { name: "Nguyễn Văn An", email: "an.nv@vlu.edu.vn", staffCode: "1000000001", unit: null,
  classes: ["71K27CNTT01", "71K27CNTT02", "71K27CNTT03", "71K28CNTT05"], problems: [] };
const binhItem = { name: "Trần Thị Bình", email: "binh.tt@vlu.edu.vn", staffCode: "0000012345", unit: null, classes: ["71K29CNTT01"], problems: [] };

describe("advisor workbook headers and classes", () => {
  it.each([
    ["Họ và tên", "name"], ["HỌ TÊN CVHT", "name"], ["Cố vấn học tập", "name"], ["Giảng viên", "name"], ["CVHT", "name"],
    ["Email", "email"], ["E-mail", "email"], ["Email cố vấn", "email"], ["EMAIL", "email"],
    ["Mã GV", "staffCode"], ["Mã giảng viên", "staffCode"], ["MGV", "staffCode"],
    ["Đơn vị", "unit"], ["Bộ môn", "unit"], ["Lớp phụ trách (cách nhau bằng dấu phẩy)", "classes"], ["Lớp", "classes"], ["Lớp CVHT", "classes"],
    ["MÃ LỚP", "classes"], ["Mã lớp", "classes"],
    ["STT", null], ["Khóa", null], ["KHÓA", null], ["Khoa", null], ["Ghi chú", null], ["GHI CHÚ", null], ["SLSV Hiện tại", null], ["SLSV ban đầu", null],
    ["CVHT NỘP KẾ HOẠCH HỌC TẬP", null], ["Kế hoạch học tập", null], ["", null],
  ])("reads %j as %s", (text, field) => {
    expect(headerField(text)).toBe(field);
  });

  it("splits class cells on commas, semicolons, slashes and new lines, normalizes and keeps each once", () => {
    expect(splitClasses("71k29cntt01, 71K29CNTT02;71K29 CNTT03\n71K29CNTT01 / 71K30CNTT01")).toEqual({
      classes: ["71K29CNTT01", "71K29CNTT02", "71K29CNTT03", "71K30CNTT01"], invalid: [],
    });
    expect(splitClasses("71K29CNTT01, Lớp A+, ,")).toEqual({ classes: ["71K29CNTT01"], invalid: ["Lớp A+"] });
  });

  it("reads a number alone as the next class of the one before it, as the Khoa's list for Phòng Đào tạo writes them", () => {
    expect(splitClasses("71K27CNTT01, 02, 03\n71K28CNTT10, 11, 02")).toEqual({
      classes: ["71K27CNTT01", "71K27CNTT02", "71K27CNTT03", "71K28CNTT10", "71K28CNTT11", "71K28CNTT02"], invalid: [],
    });
    expect(splitClasses("71K27CNTT01 02 03")).toEqual({ classes: ["71K27CNTT01", "71K27CNTT02", "71K27CNTT03"], invalid: [] });
    expect(splitClasses("71k27cntt01, 2, 02, 01")).toEqual({ classes: ["71K27CNTT01", "71K27CNTT02"], invalid: [] });
    // No class before it, a longer number than the class's own, or after a piece that is not a class: never guessed.
    expect(splitClasses("02, 71K27CNTT01, 123, Lớp A+, 05")).toEqual({ classes: ["71K27CNTT01"], invalid: ["02", "123", "Lớp A+", "05"] });
  });
});

describe("the Khoa's workbook layouts", () => {
  it("reads the list for Phòng Đào tạo below its title rows: MGV as text, several classes in a cell, the other columns left", () => {
    const sheet = readAdvisorGrid(pdtGrid);
    expect(sheet.rows).toBe(2);
    expect(sheet.fileProblems).toEqual([]);
    expect(sheet.items).toEqual([{ rows: [6], ...anItem }, { rows: [7], ...binhItem }]);
  });

  it("reads the list with one row per class as one advisor per email with all their classes", () => {
    const sheet = readAdvisorGrid(classGrid);
    expect(sheet.rows).toBe(5);
    expect(sheet.items).toEqual([{ rows: [6, 7, 8, 9], ...anItem }, { rows: [10], ...binhItem }]);
  });

  it("names a class under two advisors on both of them, with the rows of that class", () => {
    const sheet = readAdvisorGrid([...classGrid, ["6", ...cuong, "71K29CNTT01", "K29", "45", "45", ""]]);
    const conflict = "Lớp 71K29CNTT01 có ở nhiều cố vấn trong tệp (dòng 10, 11).";
    expect(sheet.items.map((item) => [item.email, item.problems])).toEqual([
      ["an.nv@vlu.edu.vn", []], ["binh.tt@vlu.edu.vn", [conflict]], ["cuong.lv@vlu.edu.vn", [conflict]],
    ]);
  });

  it("refuses one email written with two names or two staff codes, but not with other capitals", () => {
    const sheet = readAdvisorGrid([...titles(9), BY_CLASS,
      ["1", ...an, "71K27CNTT01", "K27", "", "", ""],
      ["2", "1000000009", "Nguyễn Văn Anh", "an.nv@vlu.edu.vn", "71K27CNTT02", "K27", "", "", ""],
      ["3", ...binh, "71K29CNTT01", "K29", "", "", ""],
      ["4", binh[0]!, "TRẦN THỊ BÌNH", binh[2]!, "71K29CNTT02", "K29", "", "", ""]]);
    expect(sheet.items[0]!.problems).toEqual([
      'Họ và tên ghi khác nhau: "Nguyễn Văn An" (dòng 6), "Nguyễn Văn Anh" (dòng 7).',
      'Mã giảng viên ghi khác nhau: "1000000001" (dòng 6), "1000000009" (dòng 7).',
    ]);
    expect(sheet.items[1]).toMatchObject({ name: "Trần Thị Bình", rows: [8, 9], classes: ["71K29CNTT01", "71K29CNTT02"], problems: [] });
  });

  it("merges two sheets with the same assignment, the first one's rows shown, and says they agree", () => {
    const sheet = readAdvisorSheets([{ name: "CVHT 2026-2027 (GUI PDT)", grid: pdtGrid }, { name: "CVHT 2026-2027", grid: classGrid }]);
    expect(sheet.sheets).toEqual(["CVHT 2026-2027 (GUI PDT)", "CVHT 2026-2027"]);
    expect(sheet.rows).toBe(7);
    expect(sheet.items).toEqual([{ rows: [6], ...anItem }, { rows: [7], ...binhItem }]);
    expect(sheet.notes).toEqual([
      { tone: "info", text: 'Đọc 2 trang tính, gộp theo email: "CVHT 2026-2027 (GUI PDT)" (2 dòng), "CVHT 2026-2027" (5 dòng). Cột Dòng theo trang "CVHT 2026-2027 (GUI PDT)".' },
      { tone: "info", text: 'Trang "CVHT 2026-2027" ghi cùng phân công với trang "CVHT 2026-2027 (GUI PDT)" (2 cố vấn, 5 lớp).' },
    ]);
  });

  it("follows the sheet with the most classes, and names an advisor found only in another sheet", () => {
    const short = [...titles(7), PDT, ["1", ...binh, "71K29CNTT01", "45", ""]];
    const sheet = readAdvisorSheets([{ name: "GUI PDT", grid: short }, { name: "Theo lớp", grid: classGrid }]);
    expect(sheet.sheets).toEqual(["Theo lớp", "GUI PDT"]);
    expect(sheet.items).toEqual([{ rows: [6, 7, 8, 9], ...anItem }, { rows: [10], ...binhItem }]);
    const extra = readAdvisorSheets([{ name: "Theo lớp", grid: classGrid }, { name: "Bổ sung", grid: [...titles(7), PDT, ["1", ...cuong, "71K30CNTT02", "40", ""]] }]);
    expect(extra.items[2]).toEqual({ rows: [6], sheet: "Bổ sung", name: "Lê Văn Cường", email: "cuong.lv@vlu.edu.vn", staffCode: "1000000003", unit: null,
      classes: ["71K30CNTT02"], problems: [] });
  });

  it("merges sheets that disagree, says how, and refuses a class each sheet gives to someone else", () => {
    const changed = [...titles(9), BY_CLASS,
      ["1", ...an, "71K27CNTT01", "K27", "", "", ""],
      ["2", ...an, "71K27CNTT02", "K27", "", "", ""],
      ["3", ...binh, "71K28CNTT05", "K28", "", "", ""],
      ["4", ...binh, "71K29CNTT01", "K29", "", "", ""],
      ["5", ...cuong, "71K30CNTT02", "K30", "", "", ""]];
    const sheet = readAdvisorSheets([{ name: "GUI PDT", grid: pdtGrid }, { name: "Theo lớp", grid: changed }]);
    const conflict = 'Lớp 71K28CNTT05 có ở nhiều cố vấn trong tệp (trang "GUI PDT" dòng 6; trang "Theo lớp" dòng 8).';
    expect(sheet.items.map((item) => [item.email, item.rows, item.sheet, item.classes, item.problems])).toEqual([
      ["an.nv@vlu.edu.vn", [6], undefined, ["71K27CNTT01", "71K27CNTT02", "71K27CNTT03", "71K28CNTT05"], [conflict]],
      ["binh.tt@vlu.edu.vn", [7], undefined, ["71K29CNTT01", "71K28CNTT05"], [conflict]],
      ["cuong.lv@vlu.edu.vn", [10], "Theo lớp", ["71K30CNTT02"], []],
    ]);
    expect(sheet.notes?.[1]).toEqual({ tone: "warn", text: 'Trang "Theo lớp" ghi khác trang "GUI PDT": 1 lớp có cố vấn khác nhau (71K28CNTT05); '
      + '1 lớp chỉ có ở trang "Theo lớp" (71K30CNTT02); 1 lớp chỉ có ở trang "GUI PDT" (71K27CNTT03). Lớp của các trang được gộp theo email; lớp có hai cố vấn bị báo lỗi.' });
  });

  it("passes over a sheet without a list and says which list sheet has no class column", () => {
    const people = [["Họ và tên", "Email"], ["Phạm Thu Dung", "dung.pt@vlu.edu.vn"]];
    const sheet = readAdvisorSheets([{ name: "Ghi chú", grid: [["Danh sách gửi Phòng Đào tạo"]] }, { name: "Giảng viên", grid: people }, { name: "CVHT", grid: pdtGrid }]);
    expect(sheet.sheets).toEqual(["CVHT"]);
    expect(sheet.fileProblems).toEqual(['Bỏ qua trang "Giảng viên": không có cột Mã lớp.']);
    expect(sheet.items).toHaveLength(2);
    expect(() => readAdvisorSheets([{ name: "Giảng viên", grid: people }])).toThrow(expect.objectContaining({ code: "missing_columns" }));
  });
});

describe("readAdvisorGrid", () => {
  it("finds the header below a title, merges the rows of one email and keeps Excel row numbers", () => {
    const sheet = readAdvisorGrid([
      ["DANH SÁCH CỐ VẤN HỌC TẬP HỌC KỲ 1"],
      [],
      header,
      ["1", "Nguyễn  Văn A", "mailto:NVA@vlu.edu.vn", "GV01", "Bộ môn KTPM", "71K29CNTT01, 71K29CNTT02"],
      ["2", "", "nva@vlu.edu.vn", "", "", "71K30CNTT05"],
      [],
      ["3", "Trần Thị B", "ttb@vlu.edu.vn", "", "", "71K29CNTT03"],
    ]);
    expect(sheet.rows).toBe(3);
    expect(sheet.items).toEqual([
      { rows: [4, 5], name: "Nguyễn Văn A", email: "nva@vlu.edu.vn", staffCode: "GV01", unit: "Bộ môn KTPM",
        classes: ["71K29CNTT01", "71K29CNTT02", "71K30CNTT05"], problems: [] },
      { rows: [7], name: "Trần Thị B", email: "ttb@vlu.edu.vn", staffCode: null, unit: null, classes: ["71K29CNTT03"], problems: [] },
    ]);
  });

  it("names what each row lacks and refuses a class listed under two advisors of the file", () => {
    const sheet = readAdvisorGrid([
      ["Họ tên", "Email", "Lớp"],
      ["", "a@vlu.edu.vn", "71K29CNTT01"],
      ["Lê C", "", "71K29CNTT09"],
      ["Phạm D", "khong-phai-email", ""],
      ["Võ E", "e@vlu.edu.vn", "71K29CNTT01, ???"],
    ]);
    expect(sheet.items.map((item) => item.problems)).toEqual([
      ["Thiếu họ và tên.", "Lớp 71K29CNTT01 có ở nhiều cố vấn trong tệp (dòng 2, 5)."],
      ["Thiếu email."],
      ["Email khong-phai-email không hợp lệ.", "Chưa có lớp phụ trách."],
      ["Tên lớp không hợp lệ: ???.", "Lớp 71K29CNTT01 có ở nhiều cố vấn trong tệp (dòng 2, 5)."],
    ]);
  });

  it("refuses a sheet without the name, email or class column, and one without data rows", () => {
    expect(() => readAdvisorGrid([["Họ và tên", "Lớp phụ trách"], ["A", "71K29CNTT01"]])).toThrow(AdvisorError);
    expect(() => readAdvisorGrid([["Họ và tên", "Email"], ["A", "a@vlu.edu.vn"]])).toThrow(expect.objectContaining({ code: "missing_columns" }));
    expect(() => readAdvisorGrid([header, [], ["", "", "", "", "", ""]])).toThrow(expect.objectContaining({ code: "empty_workbook" }));
  });
});

describe("planImport", () => {
  const item = { rows: [2], name: "Nguyễn Văn A", email: "nva@vlu.edu.vn", staffCode: "GV01", unit: null, classes: ["71K29CNTT01", "71K29CNTT03"], problems: [] };
  const sheet = (items = [item]) => ({ rows: items.length, items, fileProblems: [] });

  it("adds a new advisor with a new account and warns about classes without students yet", () => {
    const { preview, plan } = planImport("cvht.xlsx", sheet(), lookups());
    expect(preview.items[0]).toEqual({ ...item, status: "add", emptyClasses: ["71K29CNTT03"],
      changes: ["Thêm cố vấn học tập mới", "Tạo tài khoản, chờ đăng nhập Microsoft lần đầu", "Phụ trách 2 lớp: 71K29CNTT01, 71K29CNTT03"] });
    expect(plan[0]).toMatchObject({ userId: null, roleChange: false });
    expect(preview.summary).toEqual({ add: 1, update: 0, unchanged: 0, error: 0, classes: 2, moved: 0 });
    expect(preview.items[0]).not.toHaveProperty("userId");
  });

  it("turns a lecturer's account into an advisor's, keeps the other admin roles and moves a class from another advisor", () => {
    const lecturer = planImport("f.xlsx", sheet(), lookups({
      accounts: new Map([["nva@vlu.edu.vn", [{ id: "u1", role: "lecturer", isActive: true }]]]),
      classOwners: new Map([["71K29CNTT01", { userId: "u9", name: "Trần Thị B" }]]),
    }));
    expect(lecturer.plan[0]).toMatchObject({ userId: "u1", roleChange: true, status: "add" });
    expect(lecturer.preview.items[0]!.changes).toEqual(["Thêm cố vấn học tập mới", "Đổi vai trò Giảng viên thành Cố vấn học tập",
      "Phụ trách 2 lớp: 71K29CNTT01, 71K29CNTT03", "Lớp 71K29CNTT01 chuyển từ Trần Thị B"]);
    expect(lecturer.preview.summary.moved).toBe(1);
    const board = planImport("f.xlsx", sheet(), lookups({ accounts: new Map([["nva@vlu.edu.vn", [{ id: "u1", role: "faculty_board", isActive: true }]]]) }));
    expect(board.plan[0]).toMatchObject({ roleChange: false });
    expect(board.preview.items[0]!.changes[1]).toBe("Giữ vai trò Ban chủ nhiệm khoa");
  });

  it("updates an advisor whose details or classes differ, and leaves an identical one unchanged", () => {
    const account = new Map([["nva@vlu.edu.vn", [{ id: "u1", role: "advisor", isActive: true }]]]);
    const update = planImport("f.xlsx", sheet(), lookups({ accounts: account,
      advisors: new Map([["u1", { name: "Nguyễn Văn Á", staffCode: null, unit: null, classes: ["71K29CNTT01", "71K29CNTT02"] }]]) }));
    expect(update.preview.items[0]).toMatchObject({ status: "update", changes: ["Đổi họ và tên: Nguyễn Văn Á → Nguyễn Văn A",
      "Đổi mã giảng viên: trống → GV01", "Thêm lớp 71K29CNTT03", "Bỏ lớp 71K29CNTT02"] });
    const same = planImport("f.xlsx", sheet(), lookups({ accounts: account,
      advisors: new Map([["u1", { name: "Nguyễn Văn A", staffCode: "GV01", unit: null, classes: ["71K29CNTT01", "71K29CNTT03"] }]]),
      classOwners: new Map([["71K29CNTT01", { userId: "u1", name: "Nguyễn Văn A" }]]) }));
    expect(same.preview.items[0]).toMatchObject({ status: "unchanged", changes: [] });
    expect(same.preview.summary).toMatchObject({ unchanged: 1, moved: 0 });
  });

  it.each([
    ["an email outside the staff domains", { ...item, email: "nva@gmail.com" }, {}, "Email không phải email cán bộ của trường (@vlu.edu.vn)."],
    ["a student account", item, { accounts: new Map([["nva@vlu.edu.vn", [{ id: "s1", role: "student", isActive: true }]]]) },
      "Email này là tài khoản sinh viên, không làm cố vấn học tập được."],
    ["a locked account", item, { accounts: new Map([["nva@vlu.edu.vn", [{ id: "u1", role: "lecturer", isActive: false }]]]) },
      "Tài khoản của email này đang bị khóa; mở khóa ở trang Tài khoản trước."],
    ["two accounts", item, { accounts: new Map([["nva@vlu.edu.vn", [{ id: "u1", role: "lecturer", isActive: true }, { id: "u2", role: "advisor", isActive: true }]]]) },
      "Email này trùng với nhiều tài khoản trong EduPath AI."],
    ["no staff domain set up", item, { staffDomains: new Set<string>() }, "Email không phải email cán bộ của trường."],
  ] as const)("refuses %s", (_name, row, extra, problem) => {
    const { preview } = planImport("f.xlsx", sheet([row]), lookups(extra as Partial<ImportLookups>));
    expect(preview.items[0]).toMatchObject({ status: "error", changes: [], emptyClasses: [] });
    expect(preview.items[0]!.problems).toContain(problem);
    expect(preview.summary).toMatchObject({ error: 1, classes: 0 });
  });

  it("passes on the sheets read, their notes and the sheet of an advisor's rows", () => {
    const read: AdvisorSheet = { rows: 3, items: [{ ...item, sheet: "Theo lớp" }], fileProblems: [], sheets: ["GUI PDT", "Theo lớp"],
      notes: [{ tone: "info", text: "Đọc 2 trang tính." }] };
    const { preview } = planImport("f.xlsx", read, lookups());
    expect(preview).toMatchObject({ sheets: ["GUI PDT", "Theo lớp"], notes: [{ tone: "info", text: "Đọc 2 trang tính." }] });
    expect(preview.items[0]).toMatchObject({ sheet: "Theo lớp", status: "add" });
    expect(planImport("f.xlsx", sheet(), lookups()).preview).toMatchObject({ sheets: [], notes: [] });
  });
});

describe("advisor workbook file", () => {
  it("serves the Khoa's layout as the template and reads it back: one advisor, two classes", { timeout: 30_000 }, async () => {
    const { default: ExcelJS } = await import("exceljs");
    const file = await advisorTemplate("vlu.edu.vn", new Date(2026, 10, 3));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as never);
    expect(workbook.worksheets.map((one) => one.name)).toEqual(["CVHT 2026-2027", "Hướng dẫn"]);
    const list = workbook.worksheets[0]!;
    expect([1, 2, 3, 4].map((row) => list.getCell(row, 1).value)).toEqual(["TRƯỜNG ĐẠI HỌC VĂN LANG", "KHOA CÔNG NGHỆ THÔNG TIN",
      "DANH SÁCH CỐ VẤN HỌC TẬP", "NĂM HỌC 2026 - 2027"]);
    expect((list.getRow(5).values as unknown[]).slice(1)).toEqual(["STT", "MGV", "CVHT", "EMAIL", "MÃ LỚP", "GHI CHÚ"]);
    const sheet = await readAdvisorWorkbook(file);
    expect(sheet.fileProblems).toEqual([]);
    expect(sheet.notes).toEqual([{ tone: "info", text: 'Đọc trang tính "CVHT 2026-2027".' }]);
    expect(sheet.items).toEqual([{ rows: [6], name: "Nguyễn Văn A", email: "nguyenvana@vlu.edu.vn", staffCode: "1234567890",
      unit: null, classes: ["71K29CNTT01", "71K29CNTT02"], problems: [] }]);
    // A school year starts in August: in July the template still names the year that ends.
    const july = new ExcelJS.Workbook();
    await july.xlsx.load(await advisorTemplate("vlu.edu.vn", new Date(2027, 6, 31)) as never);
    expect(july.worksheets[0]!.name).toBe("CVHT 2026-2027");
  });

  it("reads every visible sheet of the Khoa's workbook and never a hidden one", { timeout: 30_000 }, async () => {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    // Hidden sheets first, as in the Khoa's file; their lists (made up) must never reach the import.
    const backup = workbook.addWorksheet("CVHT_bk", { state: "hidden" });
    backup.addRow(["Họ và tên", "Email", "Lớp"]);
    backup.addRow(["Cố vấn Cũ", "an.nv@vlu.edu.vn", "71K99CNTT99"]);
    const pdt = workbook.addWorksheet("CVHT 2026-2027 (GUI PDT)");
    for (const row of pdtGrid) pdt.addRow(row);
    // MGV typed as numbers; one with a format of zeros that shows its leading zeros.
    pdt.getCell("B6").value = 1000000001;
    pdt.getCell("B7").value = 12345;
    pdt.getCell("B7").numFmt = "0000000000";
    const byClass = workbook.addWorksheet("CVHT 2026-2027");
    for (const row of classGrid) byClass.addRow(row);
    // The advisor's name and email written once over the rows of their classes.
    byClass.mergeCells("C6:C9");
    byClass.mergeCells("D6:D9");
    const students = workbook.addWorksheet("SV", { state: "veryHidden" });
    students.addRow(["Họ và tên", "Email", "Lớp"]);
    students.addRow(["Sinh viên Ẩn", "binh.tt@vlu.edu.vn", "71K98CNTT98"]);
    const sheet = await readAdvisorWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(sheet.sheets).toEqual(["CVHT 2026-2027 (GUI PDT)", "CVHT 2026-2027"]);
    expect(sheet.items).toEqual([{ rows: [6], ...anItem }, { rows: [7], ...binhItem }]);
    expect(sheet.notes).toEqual([
      expect.objectContaining({ text: expect.stringContaining("Đọc 2 trang tính") }),
      expect.objectContaining({ tone: "info", text: expect.stringContaining("ghi cùng phân công") }),
      { tone: "info", text: "Không đọc 2 trang tính đang ẩn." },
    ]);
  });

  it("reads hyperlink emails and refuses a file that is not a workbook", { timeout: 30_000 }, async () => {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("CVHT");
    sheet.addRow(["Họ và tên", "Email", "Lớp chủ nhiệm"]);
    sheet.addRow(["Lê Văn C", { text: "LVC@vlu.edu.vn", hyperlink: "mailto:LVC@vlu.edu.vn" }, { richText: [{ text: "71K31CNTT01; " }, { text: "71K31CNTT02" }] }]);
    const read = await readAdvisorWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(read.items[0]).toMatchObject({ email: "lvc@vlu.edu.vn", classes: ["71K31CNTT01", "71K31CNTT02"] });
    await expect(readAdvisorWorkbook(Buffer.from("not a workbook"))).rejects.toMatchObject({ code: "invalid_workbook", status: 400 });
  });
});
