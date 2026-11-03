import { describe, expect, it } from "vitest";
import { advisorTemplate, headerField, planImport, readAdvisorGrid, readAdvisorWorkbook, splitClasses, type ImportLookups } from "./import.js";
import { AdvisorError } from "./model.js";

const domains = new Set(["vlu.edu.vn"]);
const lookups = (overrides: Partial<ImportLookups> = {}): ImportLookups => ({
  accounts: new Map(), advisors: new Map(), classOwners: new Map(), classesWithStudents: new Set(["71K29CNTT01", "71K29CNTT02"]),
  staffDomains: domains, ...overrides,
});
const header = ["STT", "Họ và tên", "Email", "Mã giảng viên", "Đơn vị", "Lớp phụ trách"];

describe("advisor workbook headers and classes", () => {
  it.each([
    ["Họ và tên", "name"], ["HỌ TÊN CVHT", "name"], ["Cố vấn học tập", "name"], ["Giảng viên", "name"],
    ["Email", "email"], ["E-mail", "email"], ["Email cố vấn", "email"], ["Mã GV", "staffCode"], ["Mã giảng viên", "staffCode"],
    ["Đơn vị", "unit"], ["Bộ môn", "unit"], ["Lớp phụ trách (cách nhau bằng dấu phẩy)", "classes"], ["Lớp", "classes"], ["Lớp CVHT", "classes"],
    ["STT", null], ["Khóa", null], ["Khoa", null], ["Ghi chú", null], ["", null],
  ])("reads %j as %s", (text, field) => {
    expect(headerField(text)).toBe(field);
  });

  it("splits class cells on commas, semicolons, slashes and new lines, normalizes and keeps each once", () => {
    expect(splitClasses("71k29cntt01, 71K29CNTT02;71K29 CNTT03\n71K29CNTT01 / 71K30CNTT01")).toEqual({
      classes: ["71K29CNTT01", "71K29CNTT02", "71K29CNTT03", "71K30CNTT01"], invalid: [],
    });
    expect(splitClasses("71K29CNTT01, Lớp A+, ,")).toEqual({ classes: ["71K29CNTT01"], invalid: ["Lớp A+"] });
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
  ] as const)("refuses %s", (_name, row, extra, problem) => {
    const { preview } = planImport("f.xlsx", sheet([row]), lookups(extra as Partial<ImportLookups>));
    expect(preview.items[0]).toMatchObject({ status: "error", changes: [], emptyClasses: [] });
    expect(preview.items[0]!.problems).toContain(problem);
    expect(preview.summary).toMatchObject({ error: 1, classes: 0 });
  });
});

describe("advisor workbook file", () => {
  it("reads its own template back: one advisor, two classes", { timeout: 30_000 }, async () => {
    const sheet = await readAdvisorWorkbook(await advisorTemplate());
    expect(sheet.fileProblems).toEqual([]);
    expect(sheet.items).toEqual([{ rows: [2], name: "Nguyễn Văn A", email: "nguyenvana@vlu.edu.vn", staffCode: "GV0001",
      unit: "Khoa Công nghệ Thông tin", classes: ["71K29CNTT01", "71K29CNTT02"], problems: [] }]);
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
