// Import danh sách cố vấn học tập (AD-ADV-01, 03; 2026-11-03). The Khoa's workbook is read here without the database:
// the first visible sheet, its header row found by its names (Họ và tên, Email, Lớp phụ trách; Mã giảng viên and Đơn vị
// when present), class cells split into classes, rows of the same email merged into one advisor. planImport then says,
// from what the database holds (looked up by repository.ts), what applying would change: a new advisor, an update, nothing,
// or why the advisor cannot be imported. The file is authoritative for the advisors it lists; the others are untouched.
import { CurriculumError } from "../curricula/model.js";
import { checkArchive } from "../curricula/parser.js";
import { foldText } from "../admin/audit/record.js";
import { roleLabel } from "../admin/audit/routes.js";
import { normalizeClassName } from "./access.js";
import { AdvisorError, CLASS_PATTERN, type AdvisorImportItem, type AdvisorImportPreview } from "./model.js";

type Field = "name" | "email" | "staffCode" | "unit" | "classes";
// Header names, folded (lower case, no diacritics). A header matches a name exactly or starts with it and a space
// ("Lớp phụ trách (cách nhau bằng dấu phẩy)"). Checked in this order, so "Email cố vấn" is the email and "Mã giảng viên"
// is not a name. "Khoa" is left out: folded, it is also "Khóa", the cohort.
const HEADERS: readonly [Field, readonly string[]][] = [
  ["email", ["email", "e-mail", "e mail", "mail", "email vlu", "dia chi email", "thu dien tu"]],
  ["staffCode", ["ma giang vien", "ma gv", "ma cb", "ma can bo", "ma so giang vien", "ma nhan vien", "ma cvht"]],
  ["classes", ["lop phu trach", "cac lop phu trach", "lop cvht", "lop chu nhiem", "lop co van", "lop"]],
  ["unit", ["don vi", "don vi cong tac", "bo mon", "khoa bo mon"]],
  ["name", ["ho va ten", "ho ten", "ho va ten co van", "ho ten co van", "ten co van", "co van hoc tap", "co van", "cvht",
    "giang vien", "ten giang vien", "ho ten giang vien", "ho va ten giang vien"]],
];
const MAX_ROWS = 2000;
const MAX_COLUMNS = 40;
const HEADER_SEARCH_ROWS = 20;
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** The field of a header cell, or null (STT, Khóa, notes). */
export function headerField(text: string): Field | null {
  const folded = foldText(text).replace(/[()[\]{}:*.#"“”]/g, " ").replace(/\s+/g, " ").trim();
  if (!folded) return null;
  for (const [field, names] of HEADERS) {
    if (names.some((name) => folded === name || folded.startsWith(`${name} `))) return field;
  }
  return null;
}

/** "71k29cntt01, 71K29CNTT02; 71K29CNTT02" → two classes; pieces that are not class names are returned apart. */
export function splitClasses(text: string): { classes: string[]; invalid: string[] } {
  const classes: string[] = [];
  const invalid: string[] = [];
  for (const piece of text.split(/[,;/|\n\r\t]+/)) {
    const raw = piece.trim();
    if (!raw) continue;
    const name = normalizeClassName(raw);
    if (!CLASS_PATTERN.test(name)) { if (!invalid.includes(raw)) invalid.push(raw); continue; }
    if (!classes.includes(name)) classes.push(name);
  }
  return { classes, invalid };
}

const cleanEmail = (text: string) => text.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
const cleanLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** One advisor of the workbook before the database is asked (its problems are the file's own). */
export type SheetAdvisor = Omit<AdvisorImportItem, "status" | "changes" | "emptyClasses">;
export type AdvisorSheet = { rows: number; items: SheetAdvisor[]; fileProblems: string[] };

/**
 * Reads a grid of cell texts (grid[0] is Excel row 1). The header is the first of the top rows with a name and an email
 * column; a workbook without one, or without a class column, is refused (missing_columns), and one without data rows too
 * (empty_workbook).
 */
export function readAdvisorGrid(grid: readonly (readonly string[])[], fileProblems: string[] = []): AdvisorSheet {
  let header = -1;
  let columns: { field: Field; column: number }[] = [];
  for (let row = 0; row < Math.min(HEADER_SEARCH_ROWS, grid.length); row++) {
    const found = (grid[row] ?? []).map((text, column) => ({ field: headerField(text), column }))
      .filter((cell): cell is { field: Field; column: number } => cell.field !== null);
    if (found.some((cell) => cell.field === "name") && found.some((cell) => cell.field === "email")) { header = row; columns = found; break; }
  }
  if (header < 0 || !columns.some((cell) => cell.field === "classes")) throw new AdvisorError("missing_columns", 400);
  // The first column of a field wins, except the classes: several class columns are read together.
  const first = (field: Field) => columns.find((cell) => cell.field === field)?.column;
  const classColumns = columns.filter((cell) => cell.field === "classes").map((cell) => cell.column);
  const read = (cells: readonly string[], column: number | undefined) => (column === undefined ? "" : cells[column] ?? "");

  type Line = { row: number; name: string; email: string; staffCode: string; unit: string; classes: string[]; invalid: string[] };
  const lines: Line[] = [];
  for (let row = header + 1; row < grid.length; row++) {
    const cells = grid[row] ?? [];
    const name = cleanLine(read(cells, first("name")));
    const email = cleanEmail(read(cells, first("email")));
    const staffCode = cleanLine(read(cells, first("staffCode")));
    const unit = cleanLine(read(cells, first("unit")));
    const split = splitClasses(classColumns.map((column) => read(cells, column)).join(","));
    if (!name && !email && !staffCode && !unit && !split.classes.length && !split.invalid.length) continue;
    lines.push({ row: row + 1, name, email, staffCode, unit, ...split });
  }
  if (!lines.length) throw new AdvisorError("empty_workbook", 400);

  // The same email on several rows is one advisor with every class of those rows.
  const items: (SheetAdvisor & { invalid: string[] })[] = [];
  const byEmail = new Map<string, SheetAdvisor & { invalid: string[] }>();
  for (const line of lines) {
    const known = line.email ? byEmail.get(line.email) : undefined;
    if (known) {
      known.rows.push(line.row);
      known.name ||= line.name;
      known.staffCode ||= line.staffCode || null;
      known.unit ||= line.unit || null;
      for (const name of line.classes) if (!known.classes.includes(name)) known.classes.push(name);
      for (const raw of line.invalid) if (!known.invalid.includes(raw)) known.invalid.push(raw);
      continue;
    }
    const item = { rows: [line.row], name: line.name, email: line.email, staffCode: line.staffCode || null, unit: line.unit || null,
      classes: [...line.classes], problems: [], invalid: [...line.invalid] };
    items.push(item);
    if (line.email) byEmail.set(line.email, item);
  }
  // A class under two advisors of the file: neither can be imported until the file says which one.
  const owners = new Map<string, number[]>();
  items.forEach((item, index) => item.classes.forEach((name) => owners.set(name, [...(owners.get(name) ?? []), index])));
  for (const item of items) {
    const problems: string[] = [];
    if (!item.name) problems.push("Thiếu họ và tên.");
    else if (item.name.length > 200) problems.push("Họ và tên dài quá 200 ký tự.");
    if (!item.email) problems.push("Thiếu email.");
    else if (!EMAIL.test(item.email) || item.email.length > 320) problems.push(`Email ${item.email} không hợp lệ.`);
    if (item.staffCode && item.staffCode.length > 50) problems.push("Mã giảng viên dài quá 50 ký tự.");
    if (item.unit && item.unit.length > 200) problems.push("Đơn vị dài quá 200 ký tự.");
    if (item.invalid.length) problems.push(`Tên lớp không hợp lệ: ${item.invalid.join(", ")}.`);
    if (!item.classes.length && !item.invalid.length) problems.push("Chưa có lớp phụ trách.");
    for (const name of item.classes) {
      const others = (owners.get(name) ?? []).filter((index) => items[index] !== item);
      if (others.length) {
        const rows = [item, ...others.map((index) => items[index]!)].flatMap((owner) => owner.rows).sort((a, b) => a - b);
        problems.push(`Lớp ${name} có ở nhiều cố vấn trong tệp (dòng ${rows.join(", ")}).`);
      }
    }
    item.problems = problems;
  }
  return { rows: lines.length, items: items.map(({ invalid: _invalid, ...item }) => item), fileProblems };
}

/** A cell as the text it shows (rich text, hyperlinks, formula results), like the CTĐT reader. */
function cellText(cell: import("exceljs").Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("error" in v) return "";
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as { result?: unknown }).result;
      return result === undefined || result === null || (typeof result === "object" && "error" in (result as object)) ? "" : String(result);
    }
    if ("richText" in v) return v.richText.map((part) => part.text).join("");
    if ("text" in v) return String((v as { text: unknown }).text ?? "");
  }
  return String(v);
}

/** Reads the Khoa's workbook (.xlsx): the first visible sheet only. */
export async function readAdvisorWorkbook(buffer: Buffer): Promise<AdvisorSheet> {
  try { checkArchive(buffer); } catch (error) {
    if (error instanceof CurriculumError) throw new AdvisorError(error.code === "workbook_too_large" ? "workbook_too_large" : "invalid_workbook", 400);
    throw error;
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as never); } catch { throw new AdvisorError("invalid_workbook", 400); }
  const sheets = workbook.worksheets.filter((sheet) => sheet.state !== "hidden" && sheet.state !== "veryHidden");
  const sheet = sheets[0];
  if (!sheet) throw new AdvisorError("empty_workbook", 400);
  if (sheet.rowCount > MAX_ROWS) throw new AdvisorError("workbook_too_large", 400);
  const gridOf = (from: import("exceljs").Worksheet, rows: number) => {
    const width = Math.min(Math.max(from.columnCount, 1), MAX_COLUMNS);
    const grid: string[][] = [];
    for (let row = 1; row <= Math.min(from.rowCount, rows); row++) {
      const cells: string[] = [];
      for (let column = 1; column <= width; column++) cells.push(cellText(from.getCell(row, column)));
      grid.push(cells);
    }
    return grid;
  };
  // Another sheet with a list of its own (not the template's instructions) is not read: say so.
  const others = sheets.slice(1).filter((other) => gridOf(other, HEADER_SEARCH_ROWS).some((cells) => {
    const fields = cells.map(headerField);
    return fields.includes("name") && fields.includes("email");
  }));
  const fileProblems = others.length ? [`Chỉ đọc trang tính đầu tiên (${sheet.name}); bỏ qua ${others.map((other) => other.name).join(", ")}.`] : [];
  return readAdvisorGrid(gridOf(sheet, sheet.rowCount), fileProblems);
}

/** The template "Tải file mẫu": the header the reader knows, one example row and a sheet of instructions. */
export async function advisorTemplate(domain = "vlu.edu.vn"): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cố vấn học tập");
  sheet.columns = [
    { header: "STT", key: "stt", width: 6 }, { header: "Họ và tên", key: "name", width: 28 }, { header: "Email", key: "email", width: 32 },
    { header: "Mã giảng viên", key: "staffCode", width: 16 }, { header: "Đơn vị", key: "unit", width: 32 },
    { header: "Lớp phụ trách", key: "classes", width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({ stt: 1, name: "Nguyễn Văn A", email: `nguyenvana@${domain}`, staffCode: "GV0001", unit: "Khoa Công nghệ Thông tin",
    classes: "71K29CNTT01, 71K29CNTT02" });
  const help = workbook.addWorksheet("Hướng dẫn");
  help.getColumn(1).width = 110;
  for (const line of [
    "Mỗi dòng là một cố vấn học tập; cột Họ và tên, Email và Lớp phụ trách là bắt buộc, Mã giảng viên và Đơn vị có thể để trống.",
    `Email là email cán bộ của trường (@${domain}); cố vấn đăng nhập EduPath AI bằng tài khoản Microsoft của email này.`,
    "Lớp phụ trách ghi đúng mã lớp như trong hồ sơ sinh viên (ví dụ 71K29CNTT01); nhiều lớp cách nhau bằng dấu phẩy, chấm phẩy hoặc xuống dòng.",
    "Một cố vấn có thể ghi trên nhiều dòng với cùng email; các lớp của những dòng đó được gộp lại.",
    "Mỗi lớp chỉ có một cố vấn. Cố vấn đã có trong danh sách được cập nhật theo tệp; lớp ghi cho cố vấn khác sẽ chuyển sang người đó.",
    "Chỉ trang tính đầu tiên được đọc. Trước khi lưu, trang Cố vấn học tập cho xem trước từng dòng và lỗi nếu có.",
  ]) help.addRow([line]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** What the database holds for the workbook's emails and classes (repository.ts reads it). */
export type ImportLookups = {
  /** Accounts by lower-case email or username; more than one is ambiguous. */
  accounts: ReadonlyMap<string, readonly { id: string; role: string; isActive: boolean }[]>;
  /** Current advisors by account id. */
  advisors: ReadonlyMap<string, { name: string; staffCode: string | null; unit: string | null; classes: readonly string[] }>;
  /** Who advises each class now. */
  classOwners: ReadonlyMap<string, { userId: string; name: string }>;
  /** Classes that have at least one student account. */
  classesWithStudents: ReadonlySet<string>;
  staffDomains: ReadonlySet<string>;
};
/** An item of the preview with what applying needs: the account (null: to create) and whether its role becomes advisor. */
export type PlannedAdvisor = AdvisorImportItem & { userId: string | null; roleChange: boolean };

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1);
const words = (list: readonly string[]) => list.join(", ");
// Roles an import leaves as they are: the advisor keeps the rights of the role and advises the classes too.
const KEPT_ROLES = new Set(["admin", "faculty_board", "department_head", "advisor"]);

/** The preview of a workbook against the database (AD-ADV-03), and the plan applying it follows. */
export function planImport(fileName: string, sheet: AdvisorSheet, lookups: ImportLookups): { preview: AdvisorImportPreview; plan: PlannedAdvisor[] } {
  const domains = [...lookups.staffDomains];
  const plan: PlannedAdvisor[] = sheet.items.map((item) => {
    const problems = [...item.problems];
    if (item.email && !problems.some((problem) => problem.startsWith("Email")) && domains.length && !lookups.staffDomains.has(domainOf(item.email))) {
      problems.push(`Email không phải email cán bộ của trường (${domains.map((domain) => `@${domain}`).join(", ")}).`);
    }
    const matches = item.email ? lookups.accounts.get(item.email) ?? [] : [];
    if (matches.length > 1) problems.push("Email này trùng với nhiều tài khoản trong EduPath AI.");
    const account = matches.length === 1 ? matches[0]! : null;
    if (account?.role === "student") problems.push("Email này là tài khoản sinh viên, không làm cố vấn học tập được.");
    if (account && !account.isActive) problems.push("Tài khoản của email này đang bị khóa; mở khóa ở trang Tài khoản trước.");
    if (problems.length) {
      return { ...item, problems, status: "error", changes: [], emptyClasses: [], userId: account?.id ?? null, roleChange: false };
    }
    const roleChange = Boolean(account && !KEPT_ROLES.has(account.role));
    const moves = item.classes.flatMap((name) => {
      const owner = lookups.classOwners.get(name);
      return owner && owner.userId !== account?.id ? [`Lớp ${name} chuyển từ ${owner.name}`] : [];
    });
    const emptyClasses = item.classes.filter((name) => !lookups.classesWithStudents.has(name));
    const existing = account ? lookups.advisors.get(account.id) : undefined;
    const roleWords = !account ? ["Tạo tài khoản, chờ đăng nhập Microsoft lần đầu"]
      : roleChange ? [`Đổi vai trò ${roleLabel(account.role)} thành Cố vấn học tập`]
        : account.role !== "advisor" ? [`Giữ vai trò ${roleLabel(account.role)}`] : [];
    if (!existing) {
      return { ...item, problems, status: "add", emptyClasses, userId: account?.id ?? null, roleChange,
        changes: ["Thêm cố vấn học tập mới", ...roleWords, `Phụ trách ${item.classes.length} lớp: ${words(item.classes)}`, ...moves] };
    }
    const changes: string[] = [];
    if (existing.name !== item.name) changes.push(`Đổi họ và tên: ${existing.name} → ${item.name}`);
    if ((existing.staffCode ?? null) !== item.staffCode) changes.push(`Đổi mã giảng viên: ${existing.staffCode ?? "trống"} → ${item.staffCode ?? "trống"}`);
    if ((existing.unit ?? null) !== item.unit) changes.push(`Đổi đơn vị: ${existing.unit ?? "trống"} → ${item.unit ?? "trống"}`);
    if (roleChange) changes.push(...roleWords);
    const added = item.classes.filter((name) => !existing.classes.includes(name));
    const removed = existing.classes.filter((name) => !item.classes.includes(name));
    if (added.length) changes.push(`Thêm lớp ${words(added)}`);
    if (removed.length) changes.push(`Bỏ lớp ${words(removed)}`);
    changes.push(...moves);
    return { ...item, problems, status: changes.length ? "update" : "unchanged", changes, emptyClasses, userId: account!.id, roleChange };
  });
  const valid = plan.filter((item) => item.status !== "error");
  const count = (status: PlannedAdvisor["status"]) => plan.filter((item) => item.status === status).length;
  const preview: AdvisorImportPreview = {
    fileName, rows: sheet.rows, fileProblems: sheet.fileProblems,
    items: plan.map(({ userId: _userId, roleChange: _roleChange, ...item }) => item),
    summary: {
      add: count("add"), update: count("update"), unchanged: count("unchanged"), error: count("error"),
      classes: new Set(valid.flatMap((item) => item.classes)).size,
      moved: valid.reduce((total, item) => total + item.changes.filter((change) => change.startsWith("Lớp ") && change.includes(" chuyển từ ")).length, 0),
    },
  };
  return { preview, plan };
}
