import { describe, expect, it } from "vitest";
import { classCodeSql } from "./class-code.js";
import { AdvisorError } from "./model.js";
import {
  EXAMPLE_STUDENT_CODE, cohortOfStudentCode, nameCase, planRoster, readRosterSheets, readRosterWorkbook, rosterHeaderField, rosterTemplate,
  type RosterGrid, type RosterLookups, type RosterSheet,
} from "./roster.js";

// Made-up students only: fake names, fake MSSV (…99x), fake @vanlanguni.vn mailboxes.
const titles = (width: number) => [["TRƯỜNG ĐẠI HỌC VĂN LANG"], ["KHOA CÔNG NGHỆ THÔNG TIN"], Array<string>(width).fill("DANH SÁCH SINH VIÊN LỚP 71K29CNTT99"), []];
const sheet = (grid: string[][], name = "Danh sách lớp"): RosterGrid => ({ name, grid });
const read = (grid: string[][], defaultClass: string | null = "71K29CNTT99") => readRosterSheets([sheet(grid)], defaultClass);
const lookups = (over: Partial<RosterLookups> = {}): RosterLookups => ({
  allowedClasses: new Set(["71K29CNTT99", "71K31CNTT99"]), listed: new Map(), accounts: new Map(), emailOwners: new Map(),
  advisors: new Map([["71K29CNTT98", "Trần Thử Một"]]), ...over,
});
const HEADER = ["STT", "MSSV", "Họ và tên", "Ngày sinh", "Giới tính", "Lớp", "Email", "Số điện thoại", "Ghi chú"];
const an = ["1", "2374802010991", "Nguyễn Văn An", "01/02/2005", "Nam", "71K29CNTT99", "an.2374802010991@vanlanguni.vn", "0900000001", ""];
const binh = ["2", "2374802010992", "TRẦN THỊ BÌNH", "03/04/2005", "Nữ", "71K29CNTT99", "", "0900000002", ""];

describe("class list headers", () => {
  it.each([
    ["MSSV", "studentCode"], ["Mã SV", "studentCode"], ["Mã số sinh viên", "studentCode"], ["MSSV/Mã HV", "studentCode"],
    ["Họ và tên", "name"], ["HỌ TÊN SINH VIÊN", "name"], ["Họ lót", "lastName"], ["Họ đệm", "lastName"], ["Họ", "lastName"], ["Tên", "firstName"],
    ["Lớp", "className"], ["Mã lớp", "className"], ["Tên lớp", "className"], ["Lớp sinh hoạt", "className"], ["Khóa", "cohort"],
    ["Email", "email"], ["E-mail trường", "email"], ["Ghi chú", "note"],
  ])("reads %s as %s", (text, field) => expect(rosterHeaderField(text)).toBe(field));

  it.each(["STT", "Ngày sinh", "Giới tính", "Số điện thoại", "Địa chỉ", "Lớp học phần", "Email phụ huynh", "Email cá nhân", "Nhóm", ""])(
    "never reads %s", (text) => expect(rosterHeaderField(text)).toBeNull());
});

describe("reading a class list", () => {
  it("reads the rows under the header, past the title rows, and keeps only MSSV, name, class and a school email", () => {
    const result = read([...titles(9), HEADER, an, binh]);
    expect(result.rows).toBe(2);
    expect(result.items).toEqual([
      { rows: [6], studentCode: "2374802010991", name: "Nguyễn Văn An", className: "71K29CNTT99", email: "an.2374802010991@vanlanguni.vn", problems: [], warnings: [] },
      // A name typed in capitals is written as a name.
      { rows: [7], studentCode: "2374802010992", name: "Trần Thị Bình", className: "71K29CNTT99", email: null, problems: [], warnings: [] },
    ]);
    // Nothing of the other columns is anywhere in what was read.
    expect(JSON.stringify(result)).not.toMatch(/0900000001|01\/02\/2005|Nam"|Nữ/);
    expect(result.notes).toEqual([{ tone: "info", text: 'Đọc trang tính "Danh sách lớp".' }]);
  });

  it("joins Họ lót and Tên, also under a merged Họ và tên on two header rows", () => {
    const merged = read([["DANH SÁCH LỚP"], ["STT", "Mã SV", "Họ và tên", "Họ và tên", "Lớp"], ["", "", "Họ lót", "Tên", ""],
      ["1", "2374802010991", "Nguyễn Văn", "An", "71K29CNTT99"]]);
    expect(merged.items.map((item) => [item.rows, item.name])).toEqual([[[4], "Nguyễn Văn An"]]);
    const split = read([["STT", "MSSV", "Họ lót", "Tên"], ["1", "2374802010991", "Lê Thị", "Cúc"]]);
    expect(split.items[0]).toMatchObject({ name: "Lê Thị Cúc", className: "71K29CNTT99" });
  });

  it("puts the rows without a class in the class the import is for, and completes a short class with Khóa", () => {
    const result = read([["MSSV", "Họ và tên", "Lớp", "Khóa"], ["2374802010991", "Nguyễn Văn An", "", ""], ["2574802010996", "Phạm Văn Năm", "CNTT99", "K31"]]);
    expect(result.items.map((item) => item.className)).toEqual(["71K29CNTT99", "71K31CNTT99"]);
    const noColumn = read([["MSSV", "Họ và tên"], ["2374802010991", "Nguyễn Văn An"]]);
    expect(noColumn.notes.map((note) => note.text)).toContain("Tệp không có cột Lớp: sinh viên được nhập vào lớp 71K29CNTT99.");
  });

  it("names the row and the column of each problem", () => {
    const result = read([HEADER,
      ["1", "", "Không Có Mã", "", "", "", "", "", ""],
      ["2", "23748O2010993", "Sai Mã", "", "", "", "", "", ""],
      ["3", "2374802010994", "", "", "", "", "", "", ""],
      ["4", "2374802010995", "Lớp Thiếu Khóa", "", "", "CNTT99", "", "", ""],
      ["5", "2374802010996", "Lớp Sai", "", "", "lớp chín", "", "", ""],
      ["6", EXAMPLE_STUDENT_CODE, "Nguyễn Văn A", "", "", "71K29CNTT99", "", "", "Dòng ví dụ, xóa trước khi import"],
      ["7", "2374802010997", "Người Cuối", "", "", "71K29CNTT99", "", "", ""],
    ]);
    expect(result.items.map((item) => item.problems)).toEqual([
      ["Dòng 2, cột MSSV: thiếu MSSV."],
      ["Dòng 3, cột MSSV: “23748O2010993” không phải MSSV hợp lệ."],
      ["Dòng 4, cột Họ và tên: thiếu họ và tên."],
      ["Dòng 5, cột Lớp: lớp CNTT99 chưa ghi khóa; ghi đủ mã lớp (như 71K29CNTT01) hoặc thêm cột Khóa (như K29)."],
      ["Dòng 6, cột Lớp: “lớp chín” không phải mã lớp hợp lệ (ví dụ 71K29CNTT01)."],
      ["Dòng 7: dòng ví dụ của tệp mẫu; xóa dòng này trước khi import."],
      [],
    ]);
  });

  it("needs a class for each row when the import is for no class, and takes the MSSV forms of the sign-in only", () => {
    const result = read([["MSSV", "Họ và tên", "Lớp"], ["2374802010991", "Nguyễn Văn An", ""], ["SV-001", "Mã Lạ", "71K29CNTT99"],
      ["207CT00991", "Sinh Viên K26", "71K26CNTT99"]], null);
    expect(result.items.map((item) => item.problems)).toEqual([["Dòng 2, cột Lớp: thiếu lớp."], ["Dòng 3, cột MSSV: “SV-001” không phải MSSV hợp lệ."], []]);
  });

  it("passes over the footer after the last student (a total, the signatures) and says so", () => {
    const result = read([HEADER, an, ["Tổng cộng: 1 sinh viên", "Tổng cộng: 1 sinh viên", "", "", "", "", "", "", ""], ["", "", "Người lập bảng", "", "", "", "", "", ""]]);
    expect(result.items).toHaveLength(1);
    expect(result.notes).toContainEqual({ tone: "warn",
      text: "Bỏ qua 2 dòng cuối danh sách không có MSSV (dòng 3, 4): dòng tổng, chữ ký, ngày tháng. Nếu có sinh viên ở đó, ghi MSSV rồi chọn lại tệp." });
  });

  it("keeps an email only when it is the student's school mailbox, and says why one is not kept", () => {
    const result = read([["MSSV", "Họ và tên", "Email"],
      ["2374802010991", "Nguyễn Văn An", "an.thu@gmail.com"],
      ["2374802010992", "Trần Thị Bình", "binh.2374802010999@vanlanguni.vn"],
      ["2374802010993", "Lê Văn Cường", "khong co"],
      ["2374802010994", "Phạm Thị Dung", "chung@vanlanguni.vn"],
      ["2374802010995", "Hồ Văn Em", "chung@vanlanguni.vn"],
      ["2374802010996", "Đỗ Thị Giang", "Giang.2374802010996@VANLANGUNI.VN"]]);
    expect(result.items.map((item) => item.email)).toEqual([null, null, null, null, null, "giang.2374802010996@vanlanguni.vn"]);
    expect(result.items.map((item) => item.warnings)).toEqual([
      ["Dòng 2, cột Email: an.thu@gmail.com không phải email sinh viên của trường (@vanlanguni.vn) nên không được lưu."],
      ["Dòng 3, cột Email: binh.2374802010999@vanlanguni.vn ghi MSSV 2374802010999, khác MSSV 2374802010992, nên không được lưu."],
      ["Dòng 4, cột Email: “khong co” không phải email hợp lệ nên không được lưu."],
      ["Dòng 5, cột Email: chung@vanlanguni.vn có ở nhiều sinh viên trong tệp (dòng 5, 6) nên không được lưu."],
      ["Dòng 6, cột Email: chung@vanlanguni.vn có ở nhiều sinh viên trong tệp (dòng 5, 6) nên không được lưu."],
      [],
    ]);
  });

  it("reads one MSSV on two rows once, and refuses it when the rows disagree", () => {
    const same = read([["MSSV", "Họ và tên"], ["2374802010991", "Nguyễn Văn An"], ["2374802010991", "NGUYỄN VĂN AN"]]);
    expect(same.items).toHaveLength(1);
    expect(same.items[0]).toMatchObject({ rows: [2, 3], problems: [], warnings: ["MSSV 2374802010991 lặp lại ở dòng 2, 3; sinh viên chỉ được nhập một lần."] });
    const differ = read([["MSSV", "Họ và tên"], ["2374802010991", "Nguyễn Văn An"], ["2374802010991", "Nguyễn Văn Ân"]]);
    expect(differ.items[0]!.problems).toEqual(["MSSV 2374802010991 có ở nhiều dòng với thông tin khác nhau (dòng 2, 3); giữ lại một dòng đúng."]);
  });

  it("warns when the MSSV is of another cohort than the class", () => {
    expect(cohortOfStudentCode("2374802010991")).toBe("K29");
    expect(cohortOfStudentCode("207CT00991")).toBe("K26");
    const result = read([["MSSV", "Họ và tên", "Lớp"], ["2274802010993", "Khóa Trước", "71K29CNTT99"]]);
    expect(result.items[0]!.warnings).toEqual(["Dòng 2: MSSV 2274802010993 là của khóa K28, còn lớp 71K29CNTT99 thuộc khóa K29; kiểm tra lại lớp của sinh viên."]);
    expect(result.items[0]!.problems).toEqual([]);
  });

  it("refuses a workbook without an MSSV and a name column, and one without rows", () => {
    expect(() => read([["STT", "Họ và tên", "Lớp"], ["1", "A", "71K29CNTT99"]])).toThrow(AdvisorError);
    expect(() => read([["MSSV", "Họ và tên"]])).toThrow(expect.objectContaining({ code: "empty_workbook" }));
    expect(() => readRosterSheets([], null)).toThrow(expect.objectContaining({ code: "missing_roster_columns" }));
  });

  it("writes names typed in capitals as names and leaves the others alone", () => {
    expect(nameCase("NGUYỄN VĂN AN")).toBe("Nguyễn Văn An");
    expect(nameCase("Nguyễn văn An")).toBe("Nguyễn văn An");
  });
});

describe("the sample tệp and the .xlsx reader", () => {
  it("reads its own template (the example row refused) and never the other columns of a real workbook", async () => {
    const template = await readRosterWorkbook(await rosterTemplate("71K29CNTT99"), "71K29CNTT99");
    expect(template.items).toHaveLength(1);
    expect(template.items[0]).toMatchObject({ studentCode: EXAMPLE_STUDENT_CODE, className: "71K29CNTT99" });
    expect(template.items[0]!.problems).toEqual(["Dòng 6: dòng ví dụ của tệp mẫu; xóa dòng này trước khi import."]);

    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const list = workbook.addWorksheet("DS lớp");
    list.addRow(["DANH SÁCH SINH VIÊN"]);
    list.addRow(["STT", "Mã SV", "Họ lót", "Tên", "Ngày sinh", "Điện thoại", "Lớp"]);
    list.addRow([1, 2374802010991, "Nguyễn Văn", "An", new Date("2005-02-01"), "0900000001", "71K29CNTT99"]);
    const hidden = workbook.addWorksheet("Ẩn");
    hidden.state = "hidden";
    hidden.addRow(["MSSV", "Họ và tên"]);
    hidden.addRow(["2374802010998", "Không Đọc"]);
    const result = await readRosterWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), null);
    expect(result.items).toEqual([{ rows: [3], studentCode: "2374802010991", name: "Nguyễn Văn An", className: "71K29CNTT99", email: null, problems: [], warnings: [] }]);
    expect(JSON.stringify(result)).not.toMatch(/0900000001|2005-02-01|Không Đọc/);
    expect(result.notes.map((note) => note.text)).toEqual(['Đọc trang tính "DS lớp".', "Không đọc 1 trang tính đang ẩn."]);
  }, 30_000);

  it("refuses a file that is no .xlsx, an .xls and a tệp with nothing to read, saying why", async () => {
    await expect(readRosterWorkbook(Buffer.from("MSSV,Họ và tên\n"), null)).rejects.toMatchObject({ code: "invalid_workbook" });
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
    await expect(readRosterWorkbook(ole, null)).rejects.toMatchObject({ code: "legacy_workbook" });
    const { default: ExcelJS } = await import("exceljs");
    const hidden = new ExcelJS.Workbook();
    const only = hidden.addWorksheet("DS");
    only.state = "hidden";
    only.addRow(["MSSV", "Họ và tên"]);
    await expect(readRosterWorkbook(Buffer.from(await hidden.xlsx.writeBuffer()), null)).rejects.toMatchObject({ code: "empty_workbook",
      details: { message: "Mọi trang tính của tệp đang ẩn nên không đọc được: hiện trang tính có danh sách (Unhide) rồi chọn lại tệp." } });
    const headerOnly = new ExcelJS.Workbook();
    headerOnly.addWorksheet("DS").addRow(["MSSV", "Họ và tên"]);
    await expect(readRosterWorkbook(Buffer.from(await headerOnly.xlsx.writeBuffer()), null)).rejects.toMatchObject({ code: "empty_workbook",
      details: { message: "Tệp Excel chưa có sinh viên nào dưới dòng tiêu đề (MSSV, Họ và tên). Điền danh sách theo tệp mẫu rồi chọn lại tệp." } });
  }, 30_000);

  it("reads hidden rows with a note and counts rows by their values, not by borders drawn far below", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("DS");
    sheet.addRow(["MSSV", "Họ và tên", "Lớp"]);
    sheet.addRow(["2374802010991", "Nguyễn Văn An", "71K29CNTT99"]);
    sheet.addRow(["2374802010992", "Trần Thị Bình", "71K29CNTT99"]).hidden = true;
    sheet.getCell("A6000").border = { top: { style: "thin" } };
    const result = await readRosterWorkbook(Buffer.from(await book.xlsx.writeBuffer()), null);
    expect(result.items.map((item) => item.studentCode)).toEqual(["2374802010991", "2374802010992"]);
    expect(result.notes).toContainEqual({ tone: "warn", text: 'Trang "DS" có 1 dòng đang ẩn (dòng 3) vẫn được đọc; xóa các dòng đó nếu không phải sinh viên của lớp.' });
  }, 30_000);
});

describe("planning an import", () => {
  const sheetOf = (items: Partial<RosterSheet["items"][number]>[]): RosterSheet => ({
    rows: items.length, fileProblems: [], notes: [], sheets: ["Danh sách lớp"],
    items: items.map((item, index) => ({ rows: [index + 2], studentCode: `237480201099${index}`, name: `Sinh Viên ${index}`, className: "71K29CNTT99", email: null,
      problems: [], warnings: [], ...item })),
  });

  it("adds a student nobody knows, keeps the same details unchanged and updates what changed", () => {
    const { preview, plan } = planRoster("ds.xlsx", sheetOf([
      { studentCode: "2374802010990" },
      { studentCode: "2374802010991", name: "Sinh Viên 1" },
      { studentCode: "2374802010992", name: "Tên Mới", email: "moi.2374802010992@vanlanguni.vn" },
    ]), lookups({ listed: new Map([
      ["2374802010991", { name: "Sinh Viên 1", className: "71K29CNTT99", email: null }],
      ["2374802010992", { name: "Tên Cũ", className: "71K29CNTT99", email: "cu.2374802010992@vanlanguni.vn" }],
    ]) }));
    expect(preview.items.map((item) => [item.status, item.changes])).toEqual([
      ["add", ["Thêm vào danh sách lớp 71K29CNTT99"]],
      ["unchanged", []],
      ["update", ["Đổi họ và tên: Tên Cũ → Tên Mới", "Đổi email: cu.2374802010992@vanlanguni.vn → moi.2374802010992@vanlanguni.vn"]],
    ]);
    expect(plan.map((item) => item.write?.studentCode ?? null)).toEqual(["2374802010990", null, "2374802010992"]);
    expect(preview.summary).toEqual({ add: 1, update: 1, unchanged: 1, error: 0, classes: 1, moved: 0, signedIn: 0 });
    expect(preview.items[0]).toMatchObject({ cohort: "K29", signedIn: false });
  });

  it("refuses the students of a class the advisor does not advise; admins and Ban chủ nhiệm khoa import any class", () => {
    const file = sheetOf([{ className: "71K29CNTT05" }, { className: "71K31CNTT99" }]);
    const own = planRoster("ds.xlsx", file, lookups());
    expect(own.preview.items.map((item) => [item.status, item.problems])).toEqual([
      ["error", ["Lớp 71K29CNTT05 không thuộc các lớp bạn phụ trách nên không import được sinh viên này."]],
      ["add", []],
    ]);
    expect(own.plan[0]!.write).toBeNull();
    expect(planRoster("ds.xlsx", file, lookups({ allowedClasses: null })).preview.items.map((item) => item.status)).toEqual(["add", "add"]);
    // An account that advises no class imports nothing.
    expect(planRoster("ds.xlsx", file, lookups({ allowedClasses: new Set() })).preview.summary.error).toBe(2);
  });

  it("shows a student of another class as a change, naming that class's advisor, and moves them", () => {
    const { preview, plan } = planRoster("ds.xlsx", sheetOf([{ studentCode: "2374802010990" }, { studentCode: "2374802010991" }, { studentCode: "2374802010992" }]), lookups({
      listed: new Map([["2374802010990", { name: "Sinh Viên 0", className: "71K29CNTT98", email: null }]]),
      accounts: new Map([["2374802010991", { className: "71K29CNTT98" }], ["2374802010992", { className: "71K29CNTT99" }]]),
    }));
    expect(preview.items.map((item) => [item.status, item.signedIn, item.changes])).toEqual([
      ["update", false, ["Chuyển từ lớp 71K29CNTT98 (cố vấn Trần Thử Một) sang lớp 71K29CNTT99"]],
      ["update", true, ["Chuyển từ lớp 71K29CNTT98 (cố vấn Trần Thử Một) sang lớp 71K29CNTT99"]],
      // Signed in and in this class already: the account is the class's entry, nothing to store.
      ["unchanged", true, []],
    ]);
    expect(plan.map((item) => item.write?.className ?? null)).toEqual(["71K29CNTT99", "71K29CNTT99", null]);
    expect(preview.summary).toMatchObject({ update: 2, unchanged: 1, moved: 2, signedIn: 2 });
  });

  it("keeps the stored email when the file has none and never stores another student's email", () => {
    const { preview, plan } = planRoster("ds.xlsx", sheetOf([
      { studentCode: "2374802010990", email: null },
      { studentCode: "2374802010991", email: "x.2374802010991@vanlanguni.vn" },
    ]), lookups({
      listed: new Map([["2374802010990", { name: "Sinh Viên 0", className: "71K29CNTT99", email: "cu.2374802010990@vanlanguni.vn" }]]),
      emailOwners: new Map([["x.2374802010991@vanlanguni.vn", "2374802010888"]]),
    }));
    expect(preview.items[0]).toMatchObject({ status: "unchanged", email: "cu.2374802010990@vanlanguni.vn" });
    expect(preview.items[1]).toMatchObject({ status: "add", email: null,
      warnings: ["Email x.2374802010991@vanlanguni.vn đang là email của sinh viên MSSV 2374802010888 nên không được lưu cho sinh viên này."] });
    expect(plan[1]!.write).toMatchObject({ email: null });
  });

  it("re-importing the same file changes nothing", () => {
    const file = sheetOf([{ studentCode: "2374802010990", email: "a.2374802010990@vanlanguni.vn" }]);
    const first = planRoster("ds.xlsx", file, lookups());
    const stored = first.plan[0]!.write!;
    const again = planRoster("ds.xlsx", file, lookups({ listed: new Map([[stored.studentCode, { name: stored.name, className: stored.className, email: stored.email }]]),
      emailOwners: new Map([[stored.email!, stored.studentCode]]) }));
    expect(again.preview.items.map((item) => item.status)).toEqual(["unchanged"]);
    expect(again.plan[0]!.write).toBeNull();
  });
});

describe("the class of a student in SQL", () => {
  it("takes the class of the student's class list row first, by the MSSV", () => {
    const sql = classCodeSql("sp", "su");
    expect(sql.startsWith("COALESCE((SELECT class_list.class_name FROM ad_class_students class_list WHERE class_list.student_code = sp.student_code),")).toBe(true);
    expect(sql).not.toMatch(/(^|[^a-z_])[pu]\./);
  });
});
