import { describe, expect, it } from "vitest";
import {
  advisorDomainText, advisorTemplate, headerField, isAdvisorEmail, planImport, readAdvisorGrid, readAdvisorSheets, readAdvisorWorkbook, splitClasses, type AdvisorSheet,
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
// The Khoa's layouts have no Đơn vị column: unread says so, and an import keeps the stored unit (planImport).
const anItem = { name: "Nguyễn Văn An", email: "an.nv@vlu.edu.vn", staffCode: "1000000001", unit: null,
  classes: ["71K27CNTT01", "71K27CNTT02", "71K27CNTT03", "71K28CNTT05"], problems: [], unread: ["unit"] };
const binhItem = { name: "Trần Thị Bình", email: "binh.tt@vlu.edu.vn", staffCode: "0000012345", unit: null, classes: ["71K29CNTT01"], problems: [], unread: ["unit"] };

describe("advisor workbook headers and classes", () => {
  it.each([
    ["Họ và tên", "name"], ["HỌ TÊN CVHT", "name"], ["Cố vấn học tập", "name"], ["Giảng viên", "name"], ["CVHT", "name"],
    ["Email", "email"], ["E-mail", "email"], ["Email cố vấn", "email"], ["EMAIL", "email"],
    ["Mã GV", "staffCode"], ["Mã giảng viên", "staffCode"], ["MGV", "staffCode"],
    ["Đơn vị", "unit"], ["Bộ môn", "unit"], ["Lớp phụ trách (cách nhau bằng dấu phẩy)", "classes"], ["Lớp", "classes"], ["Lớp CVHT", "classes"],
    ["MÃ LỚP", "classes"], ["Mã lớp", "classes"],
    // KHÓA completes a class written short (QA 2026-11-04); "Khoa" folds the same, a faculty's name is no cohort.
    ["Khóa", "cohort"], ["KHÓA", "cohort"], ["Khoa", "cohort"], ["Khóa học", "cohort"], ["Khoa bộ môn", "unit"],
    ["STT", null], ["Ghi chú", null], ["GHI CHÚ", null], ["SLSV Hiện tại", null], ["SLSV ban đầu", null],
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

  it("writes every class as its canonical code: short ones with the row's cohort, full ones as they are", () => {
    expect(splitClasses("CNTT08, 09", "K29")).toEqual({ classes: ["71K29CNTT08", "71K29CNTT09"], invalid: [] });
    expect(splitClasses("71K27CNTT01, 72K29CNTT01, k29cntt05", "K29")).toEqual({ classes: ["71K27CNTT01", "72K29CNTT01", "71K29CNTT05"], invalid: [] });
    // Without a cohort a short class stays short; readAdvisorSheets refuses it.
    expect(splitClasses("CNTT08")).toEqual({ classes: ["CNTT08"], invalid: [] });
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

  it("completes the classes written short with the KHÓA of their row (CNTT08 + K29 → 71K29CNTT08)", () => {
    const sheet = readAdvisorGrid([...titles(9), BY_CLASS,
      ["1", ...an, "CNTT01", "K27", "60", "62", ""],
      ["2", ...an, "CNTT02, 03", "27", "60", "61", ""],
      ["3", ...an, "71K28CNTT05", "K28", "2", "60", ""],
      ["4", ...binh, "CNTT01", "K29", "45", "45", ""]]);
    expect(sheet.items).toEqual([
      { rows: [6, 7, 8], ...anItem },
      { rows: [9], ...binhItem },
    ]);
    // The same class name in two cohorts is two classes: no conflict between An (K27) and Bình (K29).
    expect(sheet.items.flatMap((item) => item.problems)).toEqual([]);
  });

  it("refuses a class written short without a cohort, as it would match no student", () => {
    const sheet = readAdvisorGrid([...titles(7), PDT, ["1", ...an, "CNTT08, 09", "120", ""], ["2", ...binh, "71K29CNTT01", "45", ""]]);
    expect(sheet.items.map((item) => [item.classes, item.problems])).toEqual([
      [["CNTT08", "CNTT09"], ["Lớp CNTT08, CNTT09 chưa ghi khóa: ghi đủ mã lớp (như 71K29CNTT01) hoặc thêm cột KHÓA (như K29)."]],
      [["71K29CNTT01"], []],
    ]);
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
      classes: ["71K30CNTT02"], problems: [], unread: ["unit"] });
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
    ["an email outside the school domains", { ...item, email: "nva@gmail.com" }, {}, "Email không phải email của trường (@vlu.edu.vn hoặc @vanlanguni.vn)."],
    ["a student account", item, { accounts: new Map([["nva@vlu.edu.vn", [{ id: "s1", role: "student", isActive: true }]]]) },
      "Email này đang là tài khoản sinh viên; đổi vai trò ở trang Tài khoản trước nếu muốn cho làm cố vấn học tập."],
    ["a locked account", item, { accounts: new Map([["nva@vlu.edu.vn", [{ id: "u1", role: "lecturer", isActive: false }]]]) },
      "Tài khoản của email này đang bị khóa; mở khóa ở trang Tài khoản trước."],
    ["two accounts", item, { accounts: new Map([["nva@vlu.edu.vn", [{ id: "u1", role: "lecturer", isActive: true }, { id: "u2", role: "advisor", isActive: true }]]]) },
      "Email này trùng với nhiều tài khoản trong EduPath AI."],
    ["a staff email when no staff domain is set up", item, { staffDomains: new Set<string>() }, "Email không phải email của trường (@vanlanguni.vn)."],
  ] as const)("refuses %s", (_name, row, extra, problem) => {
    const { preview } = planImport("f.xlsx", sheet([row]), lookups(extra as Partial<ImportLookups>));
    expect(preview.items[0]).toMatchObject({ status: "error", changes: [], emptyClasses: [] });
    expect(preview.items[0]!.problems).toContain(problem);
    expect(preview.summary).toMatchObject({ error: 1, classes: 0 });
  });

  it("takes a student mailbox of the school too (user 2026-11-07), and says which domains are the school's", () => {
    const { preview } = planImport("f.xlsx", sheet([{ ...item, email: "duy.2374802010999@vanlanguni.vn" }]), lookups());
    expect(preview.items[0]!.problems).toEqual([]);
    expect(isAdvisorEmail("A.B@VanLangUni.vn", new Set(["vlu.edu.vn"]))).toBe(true);
    expect(isAdvisorEmail("nva@vlu.edu.vn", new Set(["vlu.edu.vn"]))).toBe(true);
    expect(isAdvisorEmail("nva@gmail.com", new Set(["vlu.edu.vn"]))).toBe(false);
    expect(advisorDomainText(new Set(["vlu.edu.vn", "staff.vlu.edu.vn"]))).toBe("@vlu.edu.vn, @staff.vlu.edu.vn hoặc @vanlanguni.vn");
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

// User 2026-11-14: "Phải cho phép import lại file Excel sau khi dữ liệu thay đổi. Không chỉ import một lần. Dòng không thay đổi
// giữ nguyên, dòng có nội dung thay đổi phải được cập nhật tương ứng." Names and emails are made up.
describe("importing a tệp again", () => {
  const OLD_LAYOUT = ["STT", "Họ và tên", "Email", "Mã giảng viên", "Đơn vị", "Lớp phụ trách"];
  const first = [OLD_LAYOUT,
    ["1", "Nguyễn Văn An", "an.nv@vlu.edu.vn", "GV01", "Bộ môn KTPM", "71K29CNTT01, 71K29CNTT02"],
    ["2", "Trần Thị Bình", "binh.tt@vlu.edu.vn", "GV02", "Bộ môn HTTT", "71K29CNTT03"],
    ["3", "Lê Văn Cường", "cuong.lv@vlu.edu.vn", "GV03", "Bộ môn MMT", "71K29CNTT04, 71K29CNTT05"],
    ["4", "Phạm Thị Dung", "dung.pt@vlu.edu.vn", "GV04", "Bộ môn KHMT", "71K29CNTT06"],
    ["5", "Võ Văn Em", "em.vv@vlu.edu.vn", "GV05", "Bộ môn KTPM", "71K29CNTT07"]];
  /** The list once a sheet was imported: each advisor's account (u1, u2…), details and classes; overrides change a stored advisor. */
  const stored = (read: AdvisorSheet, overrides: Record<string, Partial<{ name: string; staffCode: string | null; unit: string | null; classes: string[] }>> = {}) => {
    const id = (email: string) => `u${read.items.findIndex((item) => item.email === email) + 1}`;
    const advisors = new Map(read.items.map((item) => [id(item.email),
      { name: item.name, staffCode: item.staffCode, unit: item.unit, classes: [...item.classes].sort(), ...overrides[item.email] }]));
    return lookups({
      accounts: new Map(read.items.map((item) => [item.email, [{ id: id(item.email), role: "advisor", isActive: true }]])),
      advisors,
      classOwners: new Map([...advisors].flatMap(([userId, advisor]) => advisor.classes.map((name) => [name, { userId, name: advisor.name }] as const))),
      classesWithStudents: new Set(read.items.flatMap((item) => item.classes)),
    });
  };
  const statuses = (items: readonly { email: string; status: string }[]) => items.map((item) => [item.email.split(".")[0], item.status]);

  it("finds every advisor of the same tệp unchanged: nothing to apply", () => {
    const again = planImport("cvht.xlsx", readAdvisorGrid(first), stored(readAdvisorGrid(first)));
    expect(statuses(again.preview.items)).toEqual([["an", "unchanged"], ["binh", "unchanged"], ["cuong", "unchanged"], ["dung", "unchanged"], ["em", "unchanged"]]);
    expect(again.preview.items.every((item) => item.changes.length === 0)).toBe(true);
    expect(again.preview.summary).toEqual({ add: 0, update: 0, unchanged: 5, error: 0, classes: 7, moved: 0 });
    expect(again.plan.filter((item) => item.status === "add" || item.status === "update")).toEqual([]);
  });

  it("updates only the rows that changed, each with what changed: name, MGV, Đơn vị, a class added, removed or moved", () => {
    const edited = [OLD_LAYOUT,
      ["1", "Nguyễn Văn Anh", "an.nv@vlu.edu.vn", "GV01", "Bộ môn KTPM", "71K29CNTT01"],
      ["2", "Trần Thị Bình", "binh.tt@vlu.edu.vn", "GV20", "Bộ môn HTTT", "71K29CNTT03, 71K29CNTT08"],
      ["3", "Lê Văn Cường", "cuong.lv@vlu.edu.vn", "GV03", "Bộ môn ATTT", "71K29CNTT04"],
      ["4", "Phạm Thị Dung", "dung.pt@vlu.edu.vn", "GV04", "Bộ môn KHMT", "71K29CNTT06"],
      ["5", "Võ Văn Em", "em.vv@vlu.edu.vn", "GV05", "Bộ môn KTPM", "71K29CNTT07, 71K29CNTT02"]];
    const { preview, plan } = planImport("cvht.xlsx", readAdvisorGrid(edited), stored(readAdvisorGrid(first)));
    expect(preview.items.map((item) => [item.email.split(".")[0], item.status, item.changes])).toEqual([
      ["an", "update", ["Đổi họ và tên: Nguyễn Văn An → Nguyễn Văn Anh", "Bỏ lớp 71K29CNTT02"]],
      ["binh", "update", ["Đổi mã giảng viên: GV02 → GV20", "Thêm lớp 71K29CNTT08"]],
      ["cuong", "update", ["Đổi đơn vị: Bộ môn MMT → Bộ môn ATTT", "Bỏ lớp 71K29CNTT05"]],
      ["dung", "unchanged", []],
      ["em", "update", ["Thêm lớp 71K29CNTT02", "Lớp 71K29CNTT02 chuyển từ Nguyễn Văn An"]],
    ]);
    expect(preview.summary).toMatchObject({ add: 0, update: 4, unchanged: 1, error: 0, moved: 1 });
    // What apply writes for an update: the row as the tệp has it, on the advisor's own account.
    expect(plan[2]).toMatchObject({ userId: "u3", name: "Lê Văn Cường", staffCode: "GV03", unit: "Bộ môn ATTT", classes: ["71K29CNTT04"] });
  });

  it("keeps a stored value the tệp has no column for: the Khoa's own file (no Đơn vị) imported again is unchanged", () => {
    const read = readAdvisorGrid(pdtGrid);
    expect(read.items.map((item) => item.unread)).toEqual([["unit"], ["unit"]]);
    // An's unit was typed in the form after the first import.
    const known = stored(read, { "an.nv@vlu.edu.vn": { unit: "Bộ môn CNPM" } });
    const again = planImport("CVHT _Phan cong 2026_2027.xlsx", read, known);
    expect(again.preview.items.map((item) => [item.status, item.unit])).toEqual([["unchanged", "Bộ môn CNPM"], ["unchanged", null]]);
    expect(again.preview.items[0]).not.toHaveProperty("unread");
    // A row that does change keeps the unit too: apply writes it back as it is.
    const changed = readAdvisorGrid([...titles(7), PDT, ["1", "1000000009", "Nguyễn Văn An", "an.nv@vlu.edu.vn", "71K27CNTT01, 02, 03\n71K28CNTT05", "180", ""]]);
    const update = planImport("f.xlsx", changed, known);
    expect(update.preview.items[0]).toMatchObject({ status: "update", changes: ["Đổi mã giảng viên: 1000000001 → 1000000009"], unit: "Bộ môn CNPM" });
    expect(update.plan[0]).toMatchObject({ unit: "Bộ môn CNPM", staffCode: "1000000009" });
    // A Đơn vị column with an empty cell does say "trống".
    const cleared = readAdvisorGrid([OLD_LAYOUT, ["1", "Nguyễn Văn An", "an.nv@vlu.edu.vn", "1000000001", "", "71K27CNTT01, 71K27CNTT02, 71K27CNTT03, 71K28CNTT05"]]);
    expect(planImport("f.xlsx", cleared, known).preview.items[0]).toMatchObject({ status: "update", changes: ["Đổi đơn vị: Bộ môn CNPM → trống"] });
  });

  it("reads a column of any sheet of the advisor's rows: one sheet with Đơn vị is enough", () => {
    const units = [["Họ và tên", "Email", "Đơn vị", "Lớp"], ["Nguyễn Văn An", "an.nv@vlu.edu.vn", "Bộ môn KTPM", "71K27CNTT01"]];
    const read = readAdvisorSheets([{ name: "GUI PDT", grid: pdtGrid }, { name: "Đơn vị", grid: units }]);
    expect(read.items.map((item) => [item.email, item.unit, item.unread])).toEqual([
      ["an.nv@vlu.edu.vn", "Bộ môn KTPM", undefined], ["binh.tt@vlu.edu.vn", null, ["unit"]],
    ]);
  });

  it("takes a name typed with combining accents for the same name", () => {
    const decomposed = [OLD_LAYOUT, ["1", "Nguyễn Văn An".normalize("NFD"), "an.nv@vlu.edu.vn", "GV01", "Bộ môn KTPM", "71K29CNTT01, 71K29CNTT02"]];
    const read = readAdvisorGrid(decomposed);
    expect(read.items[0]!.name).toBe("Nguyễn Văn An".normalize("NFC"));
    expect(planImport("f.xlsx", read, stored(readAdvisorGrid(first))).preview.items[0]).toMatchObject({ status: "unchanged", changes: [] });
    // A name stored in the decomposed form (an earlier import) is no change either.
    const old = stored(readAdvisorGrid(first), { "an.nv@vlu.edu.vn": { name: "Nguyễn Văn An".normalize("NFD") } });
    expect(planImport("f.xlsx", read, old).preview.items[0]).toMatchObject({ status: "unchanged" });
  });
});

describe("advisor workbook file", () => {
  it("serves the Khoa's layout as the template and reads it back: its example row is never imported", { timeout: 30_000 }, async () => {
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
    // The template unchanged (QA 2026-11-14): its made-up row is read, but as an error, so "Xác nhận import" leaves it out.
    expect(sheet.items).toEqual([{ rows: [6], name: "Nguyễn Văn A", email: "nguyenvana@vlu.edu.vn", staffCode: "1234567890",
      unit: null, classes: ["71K29CNTT01", "71K29CNTT02"], problems: ["Đây là dòng ví dụ của tệp mẫu: xóa dòng này rồi chọn lại tệp."], unread: ["unit"] }]);
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

// QA 2026-11-14 (user: "Kiểm thử các trường hợp file Excel sai cấu trúc, thêm cột, thừa dữ liệu hoặc khác file mẫu. Cần
// có cách xử lý và thông báo phù hợp"). Names, emails and classes are made up.
describe("files that differ from the template", () => {
  const head = ["STT", "MGV", "CVHT", "EMAIL", "MÃ LỚP", "GHI CHÚ"];
  const thu = ["1", "1000000001", "Nguyễn Văn Thử", "cvht.thu@vlu.edu.vn", "71K29CNTT91, 92", ""];
  const mau = ["2", "1000000002", "Trần Thị Mẫu", "cvht.mau@vlu.edu.vn", "71K30CNTT91", ""];
  const refusal = (sheets: Parameters<typeof readAdvisorSheets>[0], options = {}) => {
    try { readAdvisorSheets(sheets, [], [], options); } catch (error) { return error as AdvisorError; }
    throw new Error("not refused");
  };
  const book = async (fill: (workbook: import("exceljs").Workbook) => void) => {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    fill(workbook);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  };

  it("names the sheet, the header row, the missing columns and the headers it does not know", () => {
    const without = (column: number) => [...titles(5), head.filter((_, i) => i !== column), thu.filter((_, i) => i !== column)];
    const fix = " Cần đủ các cột CVHT (họ và tên), EMAIL và MÃ LỚP: thêm cột còn thiếu hoặc sửa tên cột cho giống tệp mẫu, rồi chọn lại tệp.";
    expect(refusal([{ name: "CVHT 2026-2027", grid: without(3) }])).toMatchObject({ code: "missing_columns", status: 400,
      details: { message: `Trang "CVHT 2026-2027" (dòng tiêu đề 5) thiếu cột EMAIL.${fix}` } });
    expect(refusal([{ name: "CVHT", grid: without(4) }]).details).toEqual({ message: `Trang "CVHT" (dòng tiêu đề 5) thiếu cột MÃ LỚP.${fix}` });
    expect(refusal([{ name: "CVHT", grid: without(2) }]).details).toEqual({ message: `Trang "CVHT" (dòng tiêu đề 5) thiếu cột CVHT (họ và tên).${fix}` });
    // A typo: the header is found, the column it could not read is named.
    expect(refusal([{ name: "CVHT", grid: [["STT", "CVHT", "Emial", "Mã lớp"], ["1", "Nguyễn Văn Thử", "cvht.thu@vlu.edu.vn", "71K29CNTT91"]] }]).details)
      .toEqual({ message: `Trang "CVHT" (dòng tiêu đề 1) thiếu cột EMAIL. Cột chưa nhận ra: "Emial".${fix}` });
    // The list of the Tài khoản page: names and emails, no classes.
    expect(refusal([{ name: "Tài khoản", grid: [["Họ và tên", "Email", "Vai trò"], ["Nguyễn Văn Thử", "cvht.thu@vlu.edu.vn", "Giảng viên"]] }]).details)
      .toEqual({ message: `Trang "Tài khoản" (dòng tiêu đề 1) thiếu cột MÃ LỚP. Cột chưa nhận ra: "Vai trò".${fix}` });
  });

  it("refuses a workbook that is no advisor list, naming the columns it needs and the hidden sheets, and a student list", () => {
    const plan = [["KẾ HOẠCH ĐÀO TẠO KHÓA 29"], ["STT", "Mã học phần", "Tên học phần", "Số tín chỉ"], ["1", "DIT0101", "Nhập môn", "3"]];
    const none = "Tệp này không có danh sách cố vấn học tập: không trang tính nào có dòng tiêu đề với các cột CVHT (họ và tên), EMAIL và MÃ LỚP "
      + "trong 50 dòng đầu. Hãy chọn tệp phân công cố vấn của Khoa, hoặc bấm Tải file mẫu rồi điền theo mẫu.";
    expect(refusal([{ name: "KHĐT K29", grid: plan }])).toMatchObject({ code: "missing_columns", details: { message: none } });
    expect(refusal([{ name: "Hướng dẫn", grid: [["Danh sách ở trang bên cạnh."]] }], { hiddenSheets: ["CVHT 2026-2027"] }).details).toEqual({ message: `${none} `
      + "Tệp có 1 trang tính đang ẩn (\"CVHT 2026-2027\") không được đọc: nếu danh sách nằm ở đó, hiện trang tính (Unhide) rồi chọn lại tệp." });
    // A student list has every column of an advisor list: its MSSV column says what it is, and no student becomes an advisor.
    const students = [["STT", "MSSV", "Họ và tên", "Email", "Lớp"], ["1", "2374802019901", "Sinh Viên Giả", "sv.gia.2374802019901@vanlanguni.vn", "71K30CNTT98"]];
    expect(refusal([{ name: "DSSV", grid: students }])).toMatchObject({ code: "student_list", details: { message: "Trang \"DSSV\" có cột MSSV: đây là danh sách "
      + "sinh viên, không phải danh sách cố vấn học tập. Hãy chọn tệp phân công cố vấn của Khoa, với các cột CVHT (họ và tên), EMAIL và MÃ LỚP." } });
    const both = readAdvisorSheets([{ name: "DSSV", grid: students }, { name: "CVHT", grid: [head, thu] }]);
    expect(both.items.map((item) => item.email)).toEqual(["cvht.thu@vlu.edu.vn"]);
    expect(both.fileProblems).toEqual(["Bỏ qua trang \"DSSV\": có cột MSSV nên là danh sách sinh viên, không phải danh sách cố vấn học tập."]);
    // A header without rows says where it is.
    expect(refusal([{ name: "CVHT 2026-2027", grid: [...titles(6), head] }])).toMatchObject({ code: "empty_workbook", details: { message: "Trang \"CVHT 2026-2027\" "
      + "có dòng tiêu đề (dòng 5) nhưng chưa có cố vấn nào bên dưới. Thêm mỗi cố vấn một dòng với CVHT (họ và tên), EMAIL và MÃ LỚP rồi chọn lại tệp." } });
  });

  it("reads English headers, a name in two columns (Họ đệm | Tên) and a header below many title rows", () => {
    const english = readAdvisorGrid([["No.", "Staff ID", "Full name", "Email", "Class"], ["1", "GV01", "Nguyễn Văn Thử", "cvht.thu@vlu.edu.vn", "71K29CNTT91"]]);
    expect(english.items).toEqual([{ rows: [2], name: "Nguyễn Văn Thử", email: "cvht.thu@vlu.edu.vn", staffCode: "GV01", unit: null, classes: ["71K29CNTT91"], problems: [],
      unread: ["unit"] }]);
    expect(english.notes).toEqual([]);
    const split = readAdvisorGrid([["STT", "Họ đệm", "Tên", "Email", "Mã lớp"], ["1", "Nguyễn Văn", "Thử", "cvht.thu@vlu.edu.vn", "71K29CNTT91"]]);
    expect(split.items[0]).toMatchObject({ name: "Nguyễn Văn Thử", problems: [] });
    expect(headerField("Tên lớp")).toBe(null);
    expect(headerField("Họ và tên đệm")).toBe("familyName");
    const deep = readAdvisorGrid([...Array.from({ length: 24 }, (_, i) => [`Căn cứ ${i + 1}`]), head, thu]);
    expect(deep.items[0]).toMatchObject({ rows: [26], classes: ["71K29CNTT91", "71K29CNTT92"], problems: [] });
  });

  it("reads past unused columns, a column given twice, a repeated header, group titles and notes below the table, and says so", () => {
    const group = Array<string>(8).fill("BỘ MÔN CÔNG NGHỆ PHẦN MỀM");
    const header = ["STT", "MGV", "CVHT", "Học vị", "EMAIL", "MÃ LỚP", "Email cá nhân", "GHI CHÚ"];
    const sheet = readAdvisorSheets([{ name: "CVHT", grid: [...titles(8), header, group,
      ["1", "1000000001", "Nguyễn Văn Thử", "ThS.", "cvht.thu@vlu.edu.vn", "71K29CNTT91", "thu@gmail.com", ""],
      [],
      ["DANH SÁCH BỔ SUNG"],
      header,
      ["2", "1000000002", "Trần Thị Mẫu", "TS.", "cvht.mau@vlu.edu.vn", "71K30CNTT91", "", ""],
      ["", "", "Tổng cộng: 2 cố vấn, 2 lớp"],
      ["", "", "", "", "TP. Hồ Chí Minh, ngày 03 tháng 11 năm 2026"],
      ["", "", "Người lập bảng", "", "", "", "", "TRƯỞNG KHOA"]] }]);
    expect(sheet.items.map((item) => [item.rows, item.email, item.problems])).toEqual([
      [[7], "cvht.thu@vlu.edu.vn", []], [[11], "cvht.mau@vlu.edu.vn", []],
    ]);
    expect(sheet.rows).toBe(2);
    expect(sheet.notes).toEqual([
      { tone: "info", text: "Đọc trang tính \"CVHT\"." },
      { tone: "info", text: "Bỏ qua các cột không dùng: \"Học vị\"." },
      { tone: "warn", text: "Có 2 cột email: \"EMAIL\" (cột E) và \"Email cá nhân\" (cột G); chỉ đọc cột E. Nếu cần đọc cột kia, xóa hoặc đổi tên cột thừa rồi chọn lại tệp." },
      { tone: "info", text: "Bỏ qua dòng 10: dòng tiêu đề lặp lại." },
      { tone: "info", text: "Bỏ qua dòng 6: dòng tên nhóm (\"BỘ MÔN CÔNG NGHỆ PHẦN MỀM\")." },
      { tone: "info", text: "Bỏ qua 3 dòng dưới bảng không có email và mã lớp (dòng 12, 13, 14: \"Tổng cộng: 2 cố vấn, 2 lớp\", "
        + "\"TP. Hồ Chí Minh, ngày 03 tháng 11 năm 2…\", \"Người lập bảng\"). Nếu có dòng là cố vấn, thêm email và mã lớp cho dòng đó rồi chọn lại tệp." },
    ]);
    // A row in the table without an email or a class is still an advisor to fix, not a note.
    const inside = readAdvisorGrid([head, ["1", "", "Lê Văn Kiểm", "", "", ""], thu]);
    expect(inside.items[0]).toMatchObject({ name: "Lê Văn Kiểm", problems: ["Thiếu email.", "Chưa có lớp phụ trách."] });
  });

  it("never imports the template's example row, two spellings of a name, an email with accents or two emails, or a class without letters", () => {
    const sheet = readAdvisorGrid([head,
      ["1", "1234567890", "Nguyễn Văn A", "nguyenvana@vlu.edu.vn", "71K29CNTT01, 71K29CNTT02", "Dòng ví dụ, xóa trước khi import"],
      ["2", "1000000001", "Nguyễn Văn Thử", "cvht.thu@vlu.edu.vn", "71K29CNTT91", ""],
      ["3", "1000000001", "Nguyễn Văn Thứ", "cvht.thu@vlu.edu.vn", "71K29CNTT92", ""],
      ["4", "1000000003", "Lê Văn Kiểm", "lê.kiểm@vlu.edu.vn", "71K29CNTT93", ""],
      ["5", "1000000004", "Phạm Thị Nghiệm", "a@vlu.edu.vn; b@vlu.edu.vn", "71K29CNTT94", ""],
      ["6", "1000000005", "Võ Văn Dò", "cvht.do@vlu.edu.vn", "2029-01-02", ""],
      // Copied from a web page: a zero-width space and a BOM around the email and the name.
      ["7", "1000000006", "\u200bĐặng Thị Soát", "\ufeffcvht.soat@vlu.edu.vn\u200b", "71K29CNTT96", ""],
    ]);
    expect(sheet.items.map((item) => [item.email, item.problems])).toEqual([
      ["nguyenvana@vlu.edu.vn", ["Đây là dòng ví dụ của tệp mẫu: xóa dòng này rồi chọn lại tệp."]],
      ["cvht.thu@vlu.edu.vn", ["Họ và tên ghi khác nhau: \"Nguyễn Văn Thử\" (dòng 3), \"Nguyễn Văn Thứ\" (dòng 4)."]],
      ["lê.kiểm@vlu.edu.vn", ["Email lê.kiểm@vlu.edu.vn có chữ có dấu hoặc ký tự lạ: email của trường chỉ gồm chữ cái không dấu, chữ số và các dấu chấm, gạch ngang, gạch dưới."]],
      ["a@vlu.edu.vn; b@vlu.edu.vn", ["Email ghi nhiều địa chỉ trong một ô (a@vlu.edu.vn; b@vlu.edu.vn): mỗi cố vấn chỉ ghi một email."]],
      ["cvht.do@vlu.edu.vn", ["Tên lớp không hợp lệ: 2029-01-02."]],
      ["cvht.soat@vlu.edu.vn", []],
    ]);
    expect(sheet.items[5]!.name).toBe("Đặng Thị Soát");
    // Capitals alone are no second spelling.
    expect(readAdvisorGrid([head, thu, ["2", "1000000001", "NGUYỄN VĂN THỬ", "cvht.thu@vlu.edu.vn", "71K29CNTT93", ""]]).items[0]!.problems).toEqual([]);
    const planned = planImport("f.xlsx", sheet, lookups());
    expect(planned.preview.items[0]).toMatchObject({ status: "error" });
    expect(planned.preview.summary).toMatchObject({ add: 1, error: 5 });
  });

  it("reports a date, a formula without its value and a formula error in a cell it reads, and the hidden rows it reads", { timeout: 30_000 }, async () => {
    const file = await book((workbook) => {
      const sheet = workbook.addWorksheet("CVHT");
      for (const row of [...titles(6), head, thu, mau, ["3", "1000000003", "Lê Văn Kiểm", "cvht.kiem@vlu.edu.vn", "71K28CNTT93", ""],
        ["4", "1000000004", "Phạm Thị Nghiệm", "cvht.nghiem@vlu.edu.vn", "71K29CNTT96", ""]]) sheet.addRow(row);
      sheet.getCell("B6").value = new Date(Date.UTC(2026, 10, 3));
      sheet.getCell("D7").value = { formula: "LOWER(\"CVHT.MAU@VLU.EDU.VN\")" } as never;
      sheet.getCell("E8").value = { formula: "DS!#REF!", result: { error: "#REF!" } } as never;
      // A date in a column that is not read (GHI CHÚ) says nothing.
      sheet.getCell("F9").value = new Date(Date.UTC(2026, 8, 1));
      sheet.getRow(9).hidden = true;
      // Borders drawn ahead of time far below the table are no rows.
      for (let row = 10; row <= 2600; row++) sheet.getCell(row, 1).border = { bottom: { style: "thin" } };
    });
    const read = await readAdvisorWorkbook(file);
    expect(read.items.map((item) => [item.rows, item.email, item.problems])).toEqual([
      [[6], "cvht.thu@vlu.edu.vn", ["Ô B6 (cột MGV) đang là ngày tháng (03/11/2026): định dạng ô thành Text (Văn bản) rồi gõ lại."]],
      [[7], "", ["Ô D7 (cột EMAIL) là công thức chưa có kết quả: mở tệp bằng Excel, lưu lại rồi chọn lại tệp."]],
      [[8], "cvht.kiem@vlu.edu.vn", ["Ô E8 (cột MÃ LỚP) có lỗi công thức #REF!: sửa ô này trong Excel rồi chọn lại tệp."]],
      [[9], "cvht.nghiem@vlu.edu.vn", []],
    ]);
    expect(read.notes).toEqual([
      { tone: "info", text: "Đọc trang tính \"CVHT\"." },
      { tone: "warn", text: "1 dòng đang ẩn trong Excel vẫn được đọc (dòng 9). Nếu không muốn import các dòng này, xóa chúng khỏi tệp rồi chọn lại." },
    ]);
  });

  it("refuses an old or protected workbook, a zip without a sheet, an empty workbook, hidden sheets only and too many rows, each in its words",
    { timeout: 30_000 }, async () => {
      const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
      await expect(readAdvisorWorkbook(ole)).rejects.toMatchObject({ code: "legacy_workbook", status: 400 });
      const { default: JSZip } = await import("jszip");
      const word = new JSZip();
      word.file("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>");
      word.file("word/document.xml", "<?xml version=\"1.0\"?><document/>");
      await expect(readAdvisorWorkbook(await word.generateAsync({ type: "nodebuffer" }))).rejects.toMatchObject({ code: "invalid_workbook" });
      await expect(readAdvisorWorkbook(await book((workbook) => { workbook.addWorksheet("Sheet1"); }))).rejects.toMatchObject({ code: "empty_workbook",
        details: { message: "Tệp Excel trống: các trang tính đang hiện không có dữ liệu. Hãy điền danh sách theo tệp mẫu (bấm Tải file mẫu) rồi chọn lại tệp." } });
      await expect(readAdvisorWorkbook(await book((workbook) => {
        workbook.addWorksheet("Hướng dẫn").addRow(["Danh sách ở trang bên cạnh."]);
        const list = workbook.addWorksheet("CVHT 2026-2027", { state: "hidden" });
        list.addRow(head); list.addRow(thu);
      }))).rejects.toMatchObject({ code: "missing_columns", details: { message: expect.stringContaining("Tệp có 1 trang tính đang ẩn (\"CVHT 2026-2027\") không được đọc") } });
      await expect(readAdvisorWorkbook(await book((workbook) => {
        const list = workbook.addWorksheet("CVHT");
        list.addRow(head);
        for (let i = 1; i <= 2001; i++) list.addRow([i, "", `Cố Vấn ${i}`, `cv${i}@vlu.edu.vn`, `71K29CNTT${String(i).padStart(4, "0")}`, ""]);
      }))).rejects.toMatchObject({ code: "too_many_rows", details: { message: "Trang \"CVHT\" có 2.001 dòng dữ liệu, nhiều hơn giới hạn 2.000 dòng của một lần import. "
        + "Xóa các dòng thừa hoặc chia danh sách thành nhiều tệp rồi import lần lượt." } });
    });
});
