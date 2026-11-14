// Danh sách lớp (reviewer note 2026-11-14, user: "Quản lý sinh viên theo lớp của CVHT: Không được chỉ lấy sinh viên đã đăng
// nhập hệ thống. Cố vấn có thể import trước danh sách sinh viên đầy đủ của lớp, kể cả sinh viên chưa tạo tài khoản hoặc chưa
// đăng nhập."; migration 065). A cố vấn học tập imports the full list of a class they advise, an admin or Ban chủ nhiệm khoa
// the list of any class, before the students sign in; Quản lý sinh viên then lists every student of the class, those who
// never signed in marked "Chưa đăng nhập".
//
// The workbook is read here without the database. Every visible sheet whose header (in its top rows, under the title rows
// of the school's lists) names the MSSV and the name (one column, or Họ lót + Tên, also as a two-row header under a merged
// "Họ và tên") is read; the class comes from its Lớp column (with Khóa for a class written short, as the advisor import) or,
// for a row without one, from the class the import was opened for. Only the MSSV, the name, the class and a school email are
// kept: every other column (ngày sinh, giới tính, điện thoại, địa chỉ…) is never read past its header. planRoster then
// says, from what the database holds (roster-repository.ts), what importing does to each student: add them to the class
// list, update their row (a new name or email, another class), nothing, or why they cannot be imported (a class the account
// does not advise, among others). The file is authoritative for the students it lists; the others stay in their class.
import { CurriculumError } from "../curricula/model.js";
import { checkArchive } from "../curricula/parser.js";
import { foldText } from "../admin/audit/record.js";
import { classCode, cohortCode, needsCohort, normalizeClassName } from "./class-code.js";
import { STUDENT_EMAIL_DOMAIN } from "./import.js";
import { AdvisorError, CLASS_PATTERN } from "./model.js";

type Field = "studentCode" | "name" | "lastName" | "firstName" | "className" | "cohort" | "email" | "note";
// Header names, folded (lower case, no diacritics, punctuation as spaces), checked in this order. "prefix" matches the name
// or the name and more words ("Email sinh viên", "Họ và tên SV"); "exact" only the name itself, for the short ones: "Họ"
// alone is the family name and "Tên" alone the given name (so "Tên lớp" stays the class), "Khóa" the cohort. "Khoa" (the
// faculty) folds as "Khóa" does: a cell that is no cohort ("Công nghệ thông tin") is passed over (cohortCode).
const HEADERS: readonly (readonly [Field, readonly string[], "exact" | "prefix"])[] = [
  ["studentCode", ["mssv", "ma sv", "ma so sv", "ma sinh vien", "ma so sinh vien", "msv", "student id"], "prefix"],
  ["email", ["email", "e mail", "mail", "dia chi email", "thu dien tu", "hop thu"], "prefix"],
  ["className", ["lop", "ma lop", "ten lop", "lop sinh hoat", "lop chu nhiem", "lop quan ly", "lop hanh chinh", "class"], "prefix"],
  ["cohort", ["khoa", "khoa hoc", "nien khoa"], "exact"],
  ["lastName", ["ho lot", "ho dem", "ho va ten lot", "ho va ten dem", "ho va chu lot", "ho va dem", "ho"], "exact"],
  ["name", ["ho va ten", "ho ten", "ten sinh vien", "sinh vien", "full name", "name"], "prefix"],
  ["firstName", ["ten"], "exact"],
  ["note", ["ghi chu"], "prefix"],
];
// Columns that would otherwise pass for one above and are never read: the class of a course (Lớp học phần, Nhóm) and an
// email that is not the student's school mailbox.
const IGNORED = ["stt", "so tt", "lop hoc phan", "ma lop hoc phan", "nhom", "email phu huynh", "email ca nhan", "email rieng", "email khac",
  "mail phu huynh", "mail ca nhan"];
const COLUMN_NAMES: Record<Field, string> = {
  studentCode: "MSSV", name: "Họ và tên", lastName: "Họ lót", firstName: "Tên", className: "Lớp", cohort: "Khóa", email: "Email", note: "Ghi chú",
};
/** Rows of one sheet below its header: a class list has some tens, a list of every class of a cohort a few thousand. */
const MAX_ROWS = 3000;
const MAX_COLUMNS = 40;
const HEADER_SEARCH_ROWS = 20;
/**
 * An MSSV as the sign-in reads it from the Microsoft display name into student_profiles.student_code (migrations 044, 045):
 * 8 to 32 digits (2374802010078), or for K26 three digits, two letters and five digits (207CT12345), upper case. Only
 * such a code can ever meet a student's account.
 */
export const STUDENT_CODE = /^(?:\d{8,32}|\d{3}[A-Z]{2}\d{5})$/;
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
/** The example row of the template ("Tải tệp mẫu"): refused if left in the file. */
export const EXAMPLE_STUDENT_CODE = "2374802019999";
const EXAMPLE_NOTE = "Dòng ví dụ, xóa trước khi import";

const fold = (text: string) => foldText(text).replace(/[^a-z0-9]+/g, " ").trim();
/** The refusal of a tệp that holds no class list to read, with its reason as the dialog shows it (advisor-admin.ts). */
const emptyList = (message: string) => new AdvisorError("empty_workbook", 400, { message });

/** The field of a header cell, or null (STT, ngày sinh, giới tính, điện thoại, any other column). */
export function rosterHeaderField(text: string): Field | null {
  const folded = fold(text);
  if (!folded) return null;
  const starts = (name: string) => folded === name || folded.startsWith(`${name} `);
  if (IGNORED.some(starts)) return null;
  for (const [field, names, match] of HEADERS) {
    if (names.some((name) => (match === "exact" ? folded === name : starts(name)))) return field;
  }
  return null;
}

/** "2374 8020 10078" → "2374802010078": spaces gone, upper case. */
export const cleanStudentCode = (text: string) => text.replace(/\s+/g, "").toUpperCase();
const cleanLine = (text: string) => text.replace(/\s+/g, " ").trim();
const cleanEmail = (text: string) => text.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
const digits = (text: string) => text.replace(/\D/g, "").length;

/** "NGUYỄN VĂN AN" → "Nguyễn Văn An" (lists typed in capitals); a name written in mixed case stays as it is. */
export function nameCase(name: string): string {
  const upper = name.toLocaleUpperCase("vi-VN");
  if (name !== upper || upper === name.toLocaleLowerCase("vi-VN")) return name;
  return name.toLocaleLowerCase("vi-VN").split(" ").map((word) => word.charAt(0).toLocaleUpperCase("vi-VN") + word.slice(1)).join(" ");
}

/** "K29" from a class code ("71K29CNTT01"), null without one. */
export const cohortOfClass = (className: string) => /K\d{2,3}/.exec(className)?.[0] ?? null;

/**
 * The cohort an MSSV belongs to by its first two digits, the year the student started (2374802010078: 2023, K29; K26
 * codes such as 207CT12345: 2020, K26), as the profile's cohort_year is the cohort + 1994; null when it does not start so.
 */
export function cohortOfStudentCode(code: string): string | null {
  const year = /^(\d{2})/.exec(code)?.[1];
  if (!year) return null;
  const cohort = Number(year) + 6;
  return cohort >= 20 && cohort <= 99 ? `K${cohort}` : null;
}

/** The MSSV a school mailbox ends its name with ("an.2374802010078@vanlanguni.vn" → 2374802010078), null otherwise. */
const codeInEmail = (email: string) => /(?:^|[._-])(\d{8,})@/.exec(email)?.[1] ?? null;

/** A line of the preview about the workbook: the sheets read, the rows passed over. */
export type RosterNote = { text: string; tone: "info" | "warn" };
/** One student of the workbook before the database is asked (its problems and warnings are the file's own). */
export type RosterSheetStudent = {
  /** Excel rows it was read from, of the first sheet that lists it; sheet names that sheet when several were read. */
  rows: number[];
  sheet?: string;
  studentCode: string;
  name: string;
  /** The canonical class code (class-code.ts); "" when the row has none. */
  className: string;
  /** The school email to store, null when the row has none that can be kept (the warnings say why). */
  email: string | null;
  problems: string[];
  warnings: string[];
};
export type RosterSheet = { rows: number; items: RosterSheetStudent[]; fileProblems: string[]; notes: RosterNote[]; sheets: string[] };
/** A sheet as cell texts (grid[0] is Excel row 1). */
export type RosterGrid = { name: string; grid: readonly (readonly string[])[] };

type Header = { row: number; dataRow: number; columns: Map<Field, number> };
type Line = {
  sheet: number; row: number; rawCode: string; studentCode: string; name: string; nameColumns: string; rawClass: string; className: string;
  rawEmail: string; example: boolean;
};

const fieldsOf = (cells: readonly string[]) => cells.map((text, column) => ({ field: rosterHeaderField(text), column }))
  .filter((cell): cell is { field: Field; column: number } => cell.field !== null);

/**
 * The header: the first of the top rows with an MSSV column and a name column (Họ và tên, or Tên with or without Họ lót).
 * A row right under it naming Họ lót and Tên (a merged "Họ và tên" above two columns) completes it.
 */
function findHeader(grid: RosterGrid["grid"]): Header | null {
  for (let row = 0; row < Math.min(HEADER_SEARCH_ROWS, grid.length); row++) {
    const cells = fieldsOf(grid[row] ?? []);
    const has = (field: Field) => cells.some((cell) => cell.field === field);
    if (!has("studentCode") || !(has("name") || has("firstName") || has("lastName"))) continue;
    const columns = new Map<Field, number>();
    for (const cell of cells) if (!columns.has(cell.field)) columns.set(cell.field, cell.column);
    let dataRow = row + 1;
    const below = fieldsOf(grid[row + 1] ?? []).filter((cell) => cell.field === "lastName" || cell.field === "firstName");
    const codeBelow = (grid[row + 1] ?? [])[columns.get("studentCode")!] ?? "";
    if (below.length && digits(codeBelow) < 4) {
      for (const cell of below) columns.set(cell.field, cell.column);
      dataRow = row + 2;
    }
    // A name in two columns (Họ lót, Tên) wins over a "Họ và tên" written above them.
    if (columns.has("firstName") && columns.has("lastName")) columns.delete("name");
    return { row, dataRow, columns };
  }
  return null;
}

/**
 * The data rows under the header, blank ones left out, and how many rows of the list's footer were passed over;
 * defaultClass fills a row without a class.
 */
function readLines(grid: RosterGrid["grid"], header: Header, sheet: number, defaultClass: string | null): { lines: Line[]; footer: number[] } {
  const read = (cells: readonly string[], field: Field) => {
    const column = header.columns.get(field);
    return column === undefined ? "" : cells[column] ?? "";
  };
  const nameColumns = header.columns.has("name") ? COLUMN_NAMES.name
    : [header.columns.has("lastName") ? COLUMN_NAMES.lastName : "", COLUMN_NAMES.firstName].filter(Boolean).join(", ");
  const lines: Line[] = [];
  for (let row = header.dataRow; row < grid.length; row++) {
    const cells = grid[row] ?? [];
    const rawCode = cleanLine(read(cells, "studentCode"));
    const name = cleanLine(header.columns.has("name") ? read(cells, "name") : `${read(cells, "lastName")} ${read(cells, "firstName")}`);
    const rawClass = cleanLine(read(cells, "className"));
    const rawEmail = cleanLine(read(cells, "email"));
    if (!rawCode && !name && !rawClass && !rawEmail) continue;
    const studentCode = cleanStudentCode(rawCode);
    const cohort = cohortCode(read(cells, "cohort"));
    const className = rawClass ? classCode(normalizeClassName(rawClass), cohort) : defaultClass ?? "";
    const example = studentCode === EXAMPLE_STUDENT_CODE || fold(read(cells, "note")).includes("dong vi du");
    lines.push({ sheet, row: row + 1, rawCode, studentCode, name: nameCase(name), nameColumns, rawClass, className, rawEmail, example });
  }
  // The rows after the last student that have no MSSV (a total, the signatures, the date) are the list's footer.
  let last = -1;
  lines.forEach((line, index) => { if (STUDENT_CODE.test(line.studentCode)) last = index; });
  const footer = (line: Line, index: number) => index > last && digits(line.rawCode) < 4;
  return { lines: lines.filter((line, index) => !footer(line, index)), footer: lines.filter(footer).map((line) => line.row) };
}

const unique = <T>(values: readonly T[]) => [...new Set(values)];

/**
 * Reads the sheets of a class list, in the workbook's order: every sheet with a header (findHeader), the rows of one MSSV
 * in all of them being one student. defaultClass (a canonical class code) is the class of the rows without one. A
 * workbook without such a sheet is refused (missing_roster_columns), one without data rows in them too (empty_workbook).
 */
export function readRosterSheets(sheets: readonly RosterGrid[], defaultClass: string | null = null, notes: RosterNote[] = []): RosterSheet {
  const read: { name: string; lines: Line[]; header: Header; footer: number[] }[] = [];
  for (const sheet of sheets) {
    const header = findHeader(sheet.grid);
    if (!header) continue;
    read.push({ name: sheet.name, header, ...readLines(sheet.grid, header, read.length, defaultClass) });
  }
  if (!read.length) throw new AdvisorError("missing_roster_columns", 400);
  const lines = read.flatMap((sheet) => sheet.lines);
  if (!lines.length) throw emptyList("Tệp Excel chưa có sinh viên nào dưới dòng tiêu đề (MSSV, Họ và tên). Điền danh sách theo tệp mẫu rồi chọn lại tệp.");
  const several = read.length > 1;
  const where = (sources: readonly { sheet: number; row: number }[]) => {
    const bySheet = new Map<number, number[]>();
    for (const source of [...sources].sort((a, b) => a.sheet - b.sheet || a.row - b.row)) bySheet.set(source.sheet, [...(bySheet.get(source.sheet) ?? []), source.row]);
    return [...bySheet].map(([sheet, rows]) => `${several ? `trang "${read[sheet]!.name}" ` : ""}dòng ${unique(rows).join(", ")}`).join("; ");
  };
  const at = (line: Line) => `${several ? `Trang "${read[line.sheet]!.name}" dòng` : "Dòng"} ${line.row}`;

  // Each line on its own: the file's own problems and warnings.
  type Checked = { line: Line; problems: string[]; warnings: string[]; email: string | null };
  const checked: Checked[] = lines.map((line) => {
    const problems: string[] = [];
    const warnings: string[] = [];
    if (line.example) problems.push(`${at(line)}: dòng ví dụ của tệp mẫu; xóa dòng này trước khi import.`);
    if (!line.rawCode) problems.push(`${at(line)}, cột MSSV: thiếu MSSV.`);
    else if (!STUDENT_CODE.test(line.studentCode)) problems.push(`${at(line)}, cột MSSV: “${line.rawCode}” không phải MSSV hợp lệ.`);
    if (!line.name) problems.push(`${at(line)}, cột ${line.nameColumns}: thiếu họ và tên.`);
    else if (line.name.length > 200) problems.push(`${at(line)}, cột ${line.nameColumns}: họ và tên dài quá 200 ký tự.`);
    if (!line.className) problems.push(`${at(line)}, cột Lớp: thiếu lớp.`);
    else if (!CLASS_PATTERN.test(line.className)) problems.push(`${at(line)}, cột Lớp: “${line.rawClass}” không phải mã lớp hợp lệ (ví dụ 71K29CNTT01).`);
    else if (needsCohort(line.className)) {
      problems.push(`${at(line)}, cột Lớp: lớp ${line.className} chưa ghi khóa; ghi đủ mã lớp (như 71K29CNTT01) hoặc thêm cột Khóa (như K29).`);
    } else if (STUDENT_CODE.test(line.studentCode)) {
      const fromCode = cohortOfStudentCode(line.studentCode);
      const fromClass = cohortOfClass(line.className);
      if (fromCode && fromClass && fromCode !== fromClass) {
        warnings.push(`${at(line)}: MSSV ${line.studentCode} là của khóa ${fromCode}, còn lớp ${line.className} thuộc khóa ${fromClass}; kiểm tra lại lớp của sinh viên.`);
      }
    }
    let email: string | null = null;
    if (line.rawEmail) {
      const value = cleanEmail(line.rawEmail);
      const inEmail = codeInEmail(value);
      if (!EMAIL.test(value) || value.length > 320) warnings.push(`${at(line)}, cột Email: “${line.rawEmail}” không phải email hợp lệ nên không được lưu.`);
      else if (value.slice(value.lastIndexOf("@") + 1) !== STUDENT_EMAIL_DOMAIN) {
        warnings.push(`${at(line)}, cột Email: ${value} không phải email sinh viên của trường (@${STUDENT_EMAIL_DOMAIN}) nên không được lưu.`);
      } else if (inEmail && STUDENT_CODE.test(line.studentCode) && inEmail !== line.studentCode) {
        warnings.push(`${at(line)}, cột Email: ${value} ghi MSSV ${inEmail}, khác MSSV ${line.studentCode}, nên không được lưu.`);
      } else email = value;
    }
    return { line, problems, warnings, email };
  });

  // One email for two MSSVs of the file: kept for neither.
  const emailRows = new Map<string, { codes: Set<string>; sources: { sheet: number; row: number }[] }>();
  for (const item of checked) {
    if (!item.email) continue;
    const seen = emailRows.get(item.email) ?? { codes: new Set<string>(), sources: [] };
    seen.codes.add(item.line.studentCode);
    seen.sources.push({ sheet: item.line.sheet, row: item.line.row });
    emailRows.set(item.email, seen);
  }
  for (const item of checked) {
    const seen = item.email ? emailRows.get(item.email) : undefined;
    if (!seen || seen.codes.size < 2) continue;
    item.warnings.push(`${at(item.line)}, cột Email: ${item.email} có ở nhiều sinh viên trong tệp (${where(seen.sources)}) nên không được lưu.`);
    item.email = null;
  }

  // The rows of one valid MSSV are one student: the same details on each row are one student read twice; different ones
  // leave the file unclear, and that student is not imported until it says which is right.
  const groups: Checked[][] = [];
  const byCode = new Map<string, Checked[]>();
  for (const item of checked) {
    if (!STUDENT_CODE.test(item.line.studentCode)) { groups.push([item]); continue; }
    const group = byCode.get(item.line.studentCode);
    if (group) { group.push(item); continue; }
    const fresh = [item];
    byCode.set(item.line.studentCode, fresh);
    groups.push(fresh);
  }
  const items = groups.map((group): RosterSheetStudent => {
    const first = group[0]!;
    const sheet = Math.min(...group.map((item) => item.line.sheet));
    const problems = unique(group.flatMap((item) => item.problems));
    const warnings = unique(group.flatMap((item) => item.warnings));
    if (group.length > 1) {
      const sources = group.map((item) => ({ sheet: item.line.sheet, row: item.line.row }));
      const differs = (value: (item: Checked) => string) => new Set(group.map(value)).size > 1;
      if (differs((item) => item.line.name) || differs((item) => item.line.className) || differs((item) => item.email ?? "")) {
        problems.push(`MSSV ${first.line.studentCode} có ở nhiều dòng với thông tin khác nhau (${where(sources)}); giữ lại một dòng đúng.`);
      } else {
        warnings.push(`MSSV ${first.line.studentCode} lặp lại ở ${where(sources)}; sinh viên chỉ được nhập một lần.`);
      }
    }
    return {
      rows: unique(group.filter((item) => item.line.sheet === sheet).map((item) => item.line.row)),
      studentCode: first.line.studentCode, name: first.line.name, className: first.line.className, email: first.email, problems, warnings,
      ...(sheet > 0 ? { sheet: read[sheet]!.name } : {}),
    };
  });

  const said: RosterNote[] = [];
  if (read.some((sheet) => sheet.name)) {
    said.push({ tone: "info", text: several
      ? `Đọc ${read.length} trang tính: ${read.map((sheet) => `"${sheet.name}" (${sheet.lines.length} dòng)`).join(", ")}. Cột Dòng theo trang "${read[0]!.name}".`
      : `Đọc trang tính "${read[0]!.name}".` });
  }
  // The rows passed over as the footer are named, so a student left without an MSSV at the end of the list is seen.
  const footer = read.flatMap((sheet, index) => sheet.footer.map((row) => ({ sheet: index, row })));
  if (footer.length) {
    said.push({ tone: "warn", text: `Bỏ qua ${footer.length} dòng cuối danh sách không có MSSV (${where(footer)}): dòng tổng, chữ ký, ngày tháng. Nếu có sinh viên ở đó, ghi MSSV rồi chọn lại tệp.` });
  }
  const noClassColumn = read.filter((sheet) => !sheet.header.columns.has("className"));
  if (noClassColumn.length && defaultClass) {
    said.push({ tone: "info", text: `${several ? `Trang ${noClassColumn.map((sheet) => `"${sheet.name}"`).join(", ")} không` : "Tệp không"} có cột Lớp: sinh viên được nhập vào lớp ${defaultClass}.` });
  }
  return { rows: lines.length, items, fileProblems: [], notes: [...said, ...notes], sheets: read.map((sheet) => sheet.name).filter(Boolean) };
}

/** A cell as the text it shows (rich text, hyperlinks, formula results, a number's leading zeros), as the advisor import. */
function cellText(cell: import("exceljs").Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    // An MSSV typed as a number keeps all its digits (String never writes 2.3748E+12 below 10^21); a format of zeros
    // ("0000000000") shows its leading zeros.
    const format = typeof cell.numFmt === "string" ? cell.numFmt : "";
    return Number.isInteger(v) && /^0+$/.test(format) ? String(v).padStart(format.length, "0") : String(v);
  }
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

/** The first bytes of an OLE file: an Excel 97–2003 workbook (.xls), or an .xlsx saved with a password. */
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Reads a class list workbook (.xlsx): its visible sheets with a list header (readRosterSheets). Hidden sheets are never
 * read, and of the others only the columns the list needs and only the rows with a value (borders drawn far below the
 * list are no rows). The refusals say why, as the advisor import does (advisors/import.ts): an .xls or a tệp with a
 * password, a tệp whose sheets are all hidden or empty, a list without students, too many rows.
 */
export async function readRosterWorkbook(buffer: Buffer, defaultClass: string | null = null): Promise<RosterSheet> {
  if (buffer.subarray(0, OLE.length).equals(OLE)) throw new AdvisorError("legacy_workbook", 400);
  try { checkArchive(buffer); } catch (error) {
    if (error instanceof CurriculumError) throw new AdvisorError(error.code === "workbook_too_large" ? "workbook_too_large" : "invalid_workbook", 400);
    throw error;
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as never); } catch { throw new AdvisorError("invalid_workbook", 400); }
  if (!workbook.worksheets.length) throw new AdvisorError("invalid_workbook", 400);
  const visible = workbook.worksheets.filter((sheet) => !sheet.state || sheet.state === "visible");
  const hidden = workbook.worksheets.length - visible.length;
  if (!visible.length) throw emptyList("Mọi trang tính của tệp đang ẩn nên không đọc được: hiện trang tính có danh sách (Unhide) rồi chọn lại tệp.");
  if (visible.every((sheet) => !sheet.actualRowCount)) {
    throw emptyList("Tệp Excel trống: các trang tính đang hiện không có dữ liệu. Hãy điền danh sách theo tệp mẫu (bấm Tải tệp mẫu) rồi chọn lại tệp.");
  }
  /** The rows with a value up to `rows` (grid[0] is Excel row 1), only the columns of `columns` when given, and the hidden rows. */
  const gridOf = (from: import("exceljs").Worksheet, rows: number, columns?: ReadonlySet<number>) => {
    const width = Math.min(Math.max(from.columnCount, 1), MAX_COLUMNS);
    const grid: string[][] = [];
    const hiddenRows: number[] = [];
    for (let number = 1; number <= Math.min(from.rowCount, rows); number++) {
      const row = from.findRow(number);
      if (!row?.hasValues) continue;
      const cells: string[] = [];
      for (let column = 1; column <= width; column++) cells.push(!columns || columns.has(column - 1) ? cellText(row.getCell(column)) : "");
      grid[number - 1] = cells;
      if (row.hidden) hiddenRows.push(number);
    }
    return { grid: Array.from(grid, (cells) => cells ?? []), hiddenRows };
  };
  const notes: RosterNote[] = [];
  const lists = visible.flatMap((sheet) => {
    const top = gridOf(sheet, HEADER_SEARCH_ROWS).grid;
    const header = findHeader(top);
    if (!header) return [];
    if (sheet.actualRowCount - header.dataRow > MAX_ROWS) {
      throw new AdvisorError("too_many_rows", 400, { message: `Trang "${sheet.name}" có hơn ${MAX_ROWS.toLocaleString("vi-VN")} dòng, nhiều hơn một danh sách lớp. Chia danh sách thành nhiều tệp rồi import lần lượt.` });
    }
    // Below the header, only the columns of the list are read: the others (ngày sinh, điện thoại…) never leave the file.
    const body = gridOf(sheet, Infinity, new Set(header.columns.values()));
    const hiddenRows = body.hiddenRows.filter((row) => row > header.dataRow);
    if (hiddenRows.length) {
      notes.push({ tone: "warn", text: `Trang "${sheet.name}" có ${hiddenRows.length} dòng đang ẩn (dòng ${hiddenRows.slice(0, 8).join(", ")}${hiddenRows.length > 8 ? "…" : ""}) vẫn được đọc; xóa các dòng đó nếu không phải sinh viên của lớp.` });
    }
    return [{ name: sheet.name, grid: [...top.slice(0, header.dataRow), ...body.grid.slice(header.dataRow)] }];
  });
  if (hidden) notes.push({ tone: "info", text: `Không đọc ${hidden} trang tính đang ẩn.` });
  return readRosterSheets(lists, defaultClass, notes);
}

/**
 * The template "Tải tệp mẫu": the school's layout (title rows, then STT | MSSV | HỌ VÀ TÊN | LỚP | EMAIL | GHI CHÚ), one
 * made-up row and a sheet of instructions. className: the class the import is for (the example row and the title).
 */
export async function rosterTemplate(className: string | null = null): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const example = className ?? "71K29CNTT01";
  const sheet = workbook.addWorksheet("Danh sách lớp");
  sheet.columns = [{ width: 6 }, { width: 18 }, { width: 30 }, { width: 16 }, { width: 36 }, { width: 34 }];
  sheet.getColumn(2).numFmt = "@";
  sheet.getCell("A1").value = "TRƯỜNG ĐẠI HỌC VĂN LANG";
  sheet.getCell("A2").value = "KHOA CÔNG NGHỆ THÔNG TIN";
  sheet.mergeCells("A3:F3");
  sheet.getCell("A3").value = className ? `DANH SÁCH SINH VIÊN LỚP ${className}` : "DANH SÁCH SINH VIÊN";
  for (const ref of ["A1", "A2"]) sheet.getCell(ref).font = { bold: true };
  sheet.getCell("A3").font = { bold: true, size: 14 };
  sheet.getCell("A3").alignment = { horizontal: "center" };
  sheet.getRow(5).values = ["STT", "MSSV", "HỌ VÀ TÊN", "LỚP", "EMAIL", "GHI CHÚ"];
  sheet.getRow(5).font = { bold: true };
  sheet.getRow(5).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(6).values = [1, EXAMPLE_STUDENT_CODE, "Nguyễn Văn A", example, `a.${EXAMPLE_STUDENT_CODE}@${STUDENT_EMAIL_DOMAIN}`, EXAMPLE_NOTE];
  for (const row of [5, 6]) {
    for (let column = 1; column <= 6; column++) {
      sheet.getCell(row, column).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    }
  }
  const help = workbook.addWorksheet("Hướng dẫn");
  help.getColumn(1).width = 120;
  for (const line of [
    "Mỗi dòng là một sinh viên. Cột bắt buộc: MSSV và HỌ VÀ TÊN (hoặc hai cột HỌ LÓT và TÊN). Các dòng tiêu đề phía trên dòng STT | MSSV… được bỏ qua.",
    `LỚP ghi đủ mã lớp của trường (ví dụ ${example}); nếu chỉ ghi tên lớp (CNTT01), thêm cột KHÓA (K29). Dòng để trống LỚP được nhập vào lớp bạn chọn khi import.`,
    `EMAIL là email sinh viên của trường (@${STUDENT_EMAIL_DOMAIN}) và có thể để trống; email khác không được lưu.`,
    "EduPath AI chỉ lưu MSSV, họ và tên, lớp và email trường. Các cột khác (ngày sinh, giới tính, số điện thoại, địa chỉ…) không được đọc; tốt nhất không đưa vào tệp.",
    "Cố vấn học tập import được sinh viên của các lớp mình phụ trách; quản trị viên và Ban chủ nhiệm khoa import được mọi lớp.",
    "Sinh viên chưa đăng nhập EduPath AI hiện \"Chưa đăng nhập\" ở trang Quản lý sinh viên. Khi sinh viên đăng nhập lần đầu bằng tài khoản Microsoft của trường, tài khoản được ghép với dòng của danh sách lớp theo MSSV, không thành hai dòng.",
    "Có thể import lại tệp sau khi sửa: dòng không thay đổi được giữ nguyên, dòng có nội dung thay đổi được cập nhật; sinh viên không có trong tệp vẫn ở lớp của mình.",
    "Xóa dòng ví dụ trước khi import. Trước khi lưu, trang Quản lý sinh viên cho xem trước từng sinh viên và lỗi nếu có.",
  ]) help.addRow([line]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------------------------------------- the plan

/** What the database holds for the workbook's students (roster-repository.ts reads it). */
export type RosterLookups = {
  /** The classes the account may import: null for every class (admins, Ban chủ nhiệm khoa), else the classes it advises. */
  allowedClasses: ReadonlySet<string> | null;
  /** The class list rows of the workbook's MSSVs. */
  listed: ReadonlyMap<string, { name: string; className: string; email: string | null }>;
  /** The student accounts of the workbook's MSSVs (signed in at least once) and their class in the admin portal now ("" without one). */
  accounts: ReadonlyMap<string, { className: string }>;
  /** The MSSV each of the workbook's emails belongs to now, in the class lists or a student account. */
  emailOwners: ReadonlyMap<string, string>;
  /** The cố vấn học tập of each class, by its name. */
  advisors: ReadonlyMap<string, string>;
};
export type RosterImportStatus = "add" | "update" | "unchanged" | "error";
/** One student of the preview (POST /api/admin/advisor-portal/roster/import/preview). */
export type RosterImportItem = Omit<RosterSheetStudent, "email"> & {
  /** "K29", from the class; null without one. */
  cohort: string | null;
  /** The email the class list keeps after the import (the file's, else the one stored before), null without one. */
  email: string | null;
  status: RosterImportStatus;
  /** The student has signed in to EduPath AI (has an account). */
  signedIn: boolean;
  /** What importing changes, in words ("Thêm vào danh sách lớp 71K29CNTT01", "Chuyển từ lớp … sang lớp …"). */
  changes: string[];
};
export type RosterImportPreview = {
  fileName: string;
  /** Data rows read. */
  rows: number;
  items: RosterImportItem[];
  fileProblems: string[];
  notes: RosterNote[];
  sheets: string[];
  summary: { add: number; update: number; unchanged: number; error: number; classes: number; moved: number; signedIn: number };
};
export type RosterImportResult = { added: number; updated: number; unchanged: number; skipped: number; preview: RosterImportPreview };
/** A student of the plan with the row applying writes: null when nothing is stored (an error, nothing changes). */
export type PlannedStudent = RosterImportItem & { write: { studentCode: string; name: string; className: string; email: string | null } | null };

/** The text of a class move: "Chuyển từ lớp 71K29CNTT08 (cố vấn Nguyễn Văn An) sang lớp 71K29CNTT99". */
const moveText = (from: string, to: string, advisors: RosterLookups["advisors"]) => {
  const advisor = from ? advisors.get(from) : undefined;
  return `Chuyển từ ${from ? `lớp ${from}${advisor ? ` (cố vấn ${advisor})` : ""}` : "chỗ chưa có lớp"} sang lớp ${to}`;
};

/** The preview of a class list against the database, and the plan applying it follows. */
export function planRoster(fileName: string, sheet: RosterSheet, lookups: RosterLookups): { preview: RosterImportPreview; plan: PlannedStudent[] } {
  const plan = sheet.items.map((item): PlannedStudent => {
    const problems = [...item.problems];
    const warnings = [...item.warnings];
    const cohort = item.className ? cohortOfClass(item.className) : null;
    // An advisor imports the students of their own classes only (the Khoa's admins and Ban chủ nhiệm khoa any class).
    if (item.className && !problems.length && lookups.allowedClasses && !lookups.allowedClasses.has(item.className)) {
      problems.push(`Lớp ${item.className} không thuộc các lớp bạn phụ trách nên không import được sinh viên này.`);
    }
    const listed = lookups.listed.get(item.studentCode);
    const account = lookups.accounts.get(item.studentCode);
    let email = item.email;
    const owner = email ? lookups.emailOwners.get(email) : undefined;
    if (email && owner && owner !== item.studentCode) {
      warnings.push(`Email ${email} đang là email của sinh viên MSSV ${owner} nên không được lưu cho sinh viên này.`);
      email = null;
    }
    const base = { ...item, cohort, warnings, signedIn: Boolean(account) };
    if (problems.length) return { ...base, email: item.email, problems, status: "error", changes: [], write: null };
    const keptEmail = email ?? listed?.email ?? null;
    const write = { studentCode: item.studentCode, name: item.name, className: item.className, email: keptEmail };
    if (listed) {
      const changes: string[] = [];
      if (listed.className !== item.className) changes.push(moveText(listed.className, item.className, lookups.advisors));
      if (listed.name !== item.name) changes.push(`Đổi họ và tên: ${listed.name} → ${item.name}`);
      if (email && email !== listed.email) changes.push(listed.email ? `Đổi email: ${listed.email} → ${email}` : `Thêm email ${email}`);
      return { ...base, email: keptEmail, problems, status: changes.length ? "update" : "unchanged", changes, write: changes.length ? write : null };
    }
    if (account) {
      // Signed in and in this class already: the account is the class list's entry, nothing to store. In another class: the
      // list's row moves them (CLASS_OF reads the list's class first).
      if (account.className === item.className) return { ...base, email: keptEmail, problems, status: "unchanged", changes: [], write: null };
      return { ...base, email: keptEmail, problems, status: "update", changes: [moveText(account.className, item.className, lookups.advisors)], write };
    }
    return { ...base, email: keptEmail, problems, status: "add", changes: [`Thêm vào danh sách lớp ${item.className}`], write };
  });
  const valid = plan.filter((item) => item.status !== "error");
  const count = (status: RosterImportStatus) => plan.filter((item) => item.status === status).length;
  const preview: RosterImportPreview = {
    fileName, rows: sheet.rows, fileProblems: sheet.fileProblems, notes: sheet.notes, sheets: sheet.sheets,
    items: plan.map(({ write: _write, ...item }) => item),
    summary: {
      add: count("add"), update: count("update"), unchanged: count("unchanged"), error: count("error"),
      classes: new Set(valid.map((item) => item.className)).size,
      moved: valid.filter((item) => item.changes.some((change) => change.startsWith("Chuyển từ "))).length,
      signedIn: valid.filter((item) => item.signedIn).length,
    },
  };
  return { preview, plan };
}
