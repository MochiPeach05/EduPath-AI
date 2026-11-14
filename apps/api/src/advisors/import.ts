// Import danh sách cố vấn học tập (AD-ADV-01, 03; 2026-11-03). The Khoa's workbook is read here without the database.
// Its own file (CVHT _Phan cong 2026_2027, user 2026-11-03) has title rows above the header STT | MGV | CVHT | EMAIL |
// MÃ LỚP | …, two visible sheets with the same assignment (one row per advisor for Phòng Đào tạo, classes written
// "71K27CNTT01, 02, 03", and one row per class) and hidden sheets, one of them about students. So every visible sheet whose
// header names the advisor, the email and the classes is read (the older template's headers too), a hidden sheet never;
// class cells are split into classes, the rows of one email in every sheet are one advisor with all their classes, and a
// class under two advisors is an error on both. planImport then says, from what the database holds (looked up by
// repository.ts), what applying would change: a new advisor, an update, nothing, or why the advisor cannot be imported.
// The file is authoritative for the advisors it lists; the others are untouched. Classes are stored as canonical codes
// (class-code.ts, QA 2026-11-04): a class written short (CNTT08) takes the cohort of its row's KHÓA cell (71K29CNTT08);
// one with no cohort at all is refused, as it would match no student.
// A file is imported again as often as it changes (user 2026-11-14: "Phải cho phép import lại file Excel sau khi dữ liệu thay
// đổi … Dòng không thay đổi giữ nguyên, dòng có nội dung thay đổi phải được cập nhật tương ứng"): an advisor whose row says
// what the list holds is "unchanged" and never written, one whose row differs is updated with exactly those changes. A
// column the file does not have (the Khoa's own file has no Đơn vị) says nothing about that field: it keeps what is stored.
import { CurriculumError } from "../curricula/model.js";
import { checkArchive } from "../curricula/parser.js";
import { foldText } from "../admin/audit/record.js";
import { roleLabel } from "../admin/audit/routes.js";
import { classCode, cohortCode, needsCohort, normalizeClassName } from "./class-code.js";
import { AdvisorError, CLASS_PATTERN, type AdvisorImportItem, type AdvisorImportPreview } from "./model.js";

type Field = "name" | "email" | "staffCode" | "unit" | "classes" | "cohort";
// Header names, folded (lower case, no diacritics). A header matches a name exactly or starts with it and a space
// ("Lớp phụ trách (cách nhau bằng dấu phẩy)"). Checked in this order, so "Email cố vấn" is the email, "Mã giảng viên"
// is not a name and "Khoa bộ môn" is the unit. "Khóa" (KHÓA, the cohort) folds as "Khoa" does: a cell that is no cohort
// ("Công nghệ thông tin") is passed over (cohortCode).
const HEADERS: readonly [Field, readonly string[]][] = [
  ["email", ["email", "e-mail", "e mail", "mail", "email vlu", "dia chi email", "thu dien tu"]],
  ["staffCode", ["mgv", "msgv", "ma gv", "ma so gv", "ma giang vien", "ma so giang vien", "ma cb", "ma can bo", "ma nhan vien", "ma cvht"]],
  ["classes", ["ma lop", "lop phu trach", "cac lop phu trach", "lop cvht", "lop chu nhiem", "lop co van", "lop"]],
  ["unit", ["don vi", "don vi cong tac", "bo mon", "khoa bo mon"]],
  ["name", ["ho va ten", "ho ten", "ho va ten co van", "ho ten co van", "ten co van", "co van hoc tap", "co van", "cvht",
    "giang vien", "ten giang vien", "ho ten giang vien", "ho va ten giang vien"]],
  ["cohort", ["khoa", "khoa hoc"]],
];
// Columns of the Khoa's file that are never read: "CVHT NỘP KẾ HOẠCH…" would otherwise be the name ("cvht …"); STT, SLSV
// Hiện tại / ban đầu and GHI CHÚ are named so that no alias above ever catches them.
const IGNORED = ["stt", "so tt", "slsv", "si so", "so luong", "so sv", "ghi chu", "cvht nop", "nop ke hoach"];
const MAX_ROWS = 2000;
const MAX_COLUMNS = 40;
const HEADER_SEARCH_ROWS = 20;
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
/** A class written in full as the Khoa does: campus digits, K and the cohort, the program, the number (71K27CNTT01). */
const FULL_CLASS = /^\d*K\d{2,3}[A-Z]+\d+$/;

/** The field of a header cell, or null (STT, Khóa, SLSV, notes). */
export function headerField(text: string): Field | null {
  const folded = foldText(text).replace(/[()[\]{}:*.#"“”]/g, " ").replace(/\s+/g, " ").trim();
  if (!folded) return null;
  const starts = (name: string) => folded === name || folded.startsWith(`${name} `);
  if (IGNORED.some(starts) || /(^| )ke hoach( |$)/.test(folded)) return null;
  for (const [field, names] of HEADERS) {
    if (names.some(starts)) return field;
  }
  return null;
}

/**
 * "71k29cntt01, 71K29CNTT02; 71K29CNTT02" → two classes. A number alone continues the class before it in the same cell,
 * as the Khoa's list for Phòng Đào tạo writes them: "71K27CNTT01, 02, 03" → 71K27CNTT01, 71K27CNTT02, 71K27CNTT03.
 * Pieces that are not class names (a number with no class before it, or longer than that class's number) come apart.
 * Each class becomes its canonical code (classCode), short ones with the cohort of the row ("CNTT08" + K29 → 71K29CNTT08).
 */
export function splitClasses(text: string, cohort: string | null = null): { classes: string[]; invalid: string[] } {
  const classes: string[] = [];
  const invalid: string[] = [];
  const bad = (raw: string) => { if (!invalid.includes(raw)) invalid.push(raw); };
  // Spaces only ("71K27CNTT01 02 03") split the classes when every word is a whole class or a number after one;
  // "71K29 CNTT03" stays one class.
  const pieces = text.split(/[,;/|\n\r\t]+/).flatMap((piece) => {
    const words = piece.trim().toUpperCase().split(/\s+/);
    return words.length > 1 && FULL_CLASS.test(words[0]!) && words.every((word) => FULL_CLASS.test(word) || /^\d{1,3}$/.test(word)) ? words : [piece];
  });
  let stem: { prefix: string; width: number } | null = null;
  for (const piece of pieces) {
    const raw = piece.trim();
    if (!raw) continue;
    let name = normalizeClassName(raw);
    if (/^\d+$/.test(name)) {
      if (!stem || name.length > stem.width) { bad(raw); continue; }
      name = `${stem.prefix}${name.padStart(stem.width, "0")}`;
    } else {
      const parts = CLASS_PATTERN.test(name) ? /^(.*\D)(\d+)$/.exec(name) : null;
      stem = parts ? { prefix: parts[1]!, width: parts[2]!.length } : null;
    }
    name = classCode(name, cohort);
    if (!CLASS_PATTERN.test(name)) { bad(raw); continue; }
    if (!classes.includes(name)) classes.push(name);
  }
  return { classes, invalid };
}

const cleanEmail = (text: string) => text.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
// NFC: a name typed with combining accents (some Vietnamese keyboards) is the same text as the precomposed one.
const cleanLine = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim();
const unique = <T>(values: readonly T[]) => [...new Set(values)];
/** The fields a file may leave out: without the column, an import keeps what is stored (planImport). */
export type OptionalField = "staffCode" | "unit";
const OPTIONAL_FIELDS: readonly OptionalField[] = ["staffCode", "unit"];

/** A line of the preview about the workbook: the sheets read and how they compare; warn: worth a look before importing. */
export type ImportNote = { text: string; tone: "info" | "warn" };
/**
 * One advisor of the workbook before the database is asked (its problems are the file's own). rows are the Excel rows of
 * the first sheet read that lists the advisor; sheet names that sheet when several were read and it is not the first;
 * unread names the optional fields no sheet of the advisor's rows has a column for (left out when there are none).
 */
export type SheetAdvisor = Omit<AdvisorImportItem, "status" | "changes" | "emptyClasses"> & { sheet?: string; unread?: OptionalField[] };
/** sheets: the sheets read, the one the row numbers follow first; notes: what the preview says about them. */
export type AdvisorSheet = { rows: number; items: SheetAdvisor[]; fileProblems: string[]; sheets?: string[]; notes?: ImportNote[] };
/** A sheet as cell texts (grid[0] is Excel row 1). */
export type SheetGrid = { name: string; grid: readonly (readonly string[])[] };

type Header = { row: number; columns: { field: Field; column: number }[] };
type Line = { row: number; name: string; email: string; staffCode: string; unit: string; classes: string[]; invalid: string[] };
/** fields: the fields its header has a column for. */
type List = { name: string; lines: Line[]; classes: number; fields: ReadonlySet<Field> };
type Source = { sheet: number; row: number };
type Variant = { text: string; sources: Source[] };

/** The header: the first of the top rows with a name and an email column (the title rows above it are passed over). */
function findHeader(grid: SheetGrid["grid"]): Header | null {
  for (let row = 0; row < Math.min(HEADER_SEARCH_ROWS, grid.length); row++) {
    const columns = (grid[row] ?? []).map((text, column) => ({ field: headerField(text), column }))
      .filter((cell): cell is { field: Field; column: number } => cell.field !== null);
    if (columns.some((cell) => cell.field === "name") && columns.some((cell) => cell.field === "email")) return { row, columns };
  }
  return null;
}

/** The data rows below the header, blank ones left out. */
function readLines(grid: SheetGrid["grid"], header: Header): Line[] {
  // The first column of a field wins, except the classes: several class columns are read together.
  const first = (field: Field) => header.columns.find((cell) => cell.field === field)?.column;
  const classColumns = header.columns.filter((cell) => cell.field === "classes").map((cell) => cell.column);
  const read = (cells: readonly string[], column: number | undefined) => (column === undefined ? "" : cells[column] ?? "");
  const lines: Line[] = [];
  for (let row = header.row + 1; row < grid.length; row++) {
    const cells = grid[row] ?? [];
    const name = cleanLine(read(cells, first("name")));
    const email = cleanEmail(read(cells, first("email")));
    const staffCode = cleanLine(read(cells, first("staffCode")));
    const unit = cleanLine(read(cells, first("unit")));
    // Each class cell on its own: "02" only continues a class of its own cell. KHÓA completes the short classes of the row.
    const cohort = cohortCode(read(cells, first("cohort")));
    const split = classColumns.map((column) => splitClasses(read(cells, column), cohort));
    const classes = unique(split.flatMap((part) => part.classes));
    const invalid = unique(split.flatMap((part) => part.invalid));
    if (!name && !email && !staffCode && !unit && !classes.length && !invalid.length) continue;
    lines.push({ row: row + 1, name, email, staffCode, unit, classes, invalid });
  }
  return lines;
}

const few = (names: readonly string[], shown = 6) => (names.length > shown ? `${names.slice(0, shown).join(", ")}…` : names.join(", "));

/** How another sheet's assignment (class → email) compares with the first sheet's. */
function compareSheets(list: List, main: List): ImportNote {
  const assignment = (lines: readonly Line[]) => {
    const owners = new Map<string, Set<string>>();
    for (const line of lines) for (const name of line.classes) owners.set(name, (owners.get(name) ?? new Set<string>()).add(line.email));
    return owners;
  };
  const here = assignment(list.lines);
  const there = assignment(main.lines);
  const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((email) => b.has(email));
  const differ = [...here].filter(([name, emails]) => there.has(name) && !same(emails, there.get(name)!)).map(([name]) => name);
  const onlyHere = [...here.keys()].filter((name) => !there.has(name));
  const onlyThere = [...there.keys()].filter((name) => !here.has(name));
  if (!differ.length && !onlyHere.length && !onlyThere.length) {
    const advisors = new Set(list.lines.map((line) => line.email).filter(Boolean)).size;
    return { tone: "info", text: `Trang "${list.name}" ghi cùng phân công với trang "${main.name}" (${advisors} cố vấn, ${here.size} lớp).` };
  }
  const parts = [
    differ.length ? `${differ.length} lớp có cố vấn khác nhau (${few(differ)})` : "",
    onlyHere.length ? `${onlyHere.length} lớp chỉ có ở trang "${list.name}" (${few(onlyHere)})` : "",
    onlyThere.length ? `${onlyThere.length} lớp chỉ có ở trang "${main.name}" (${few(onlyThere)})` : "",
  ].filter(Boolean);
  return { tone: "warn", text: `Trang "${list.name}" ghi khác trang "${main.name}": ${parts.join("; ")}. Lớp của các trang được gộp theo email; lớp có hai cố vấn bị báo lỗi.` };
}

/**
 * Reads the sheets of a workbook, in its order. Every sheet whose header has a name, an email and a class column is read,
 * and the rows of one email in all of them are one advisor. The sheet with the most classes (the first of them on a tie)
 * comes first: the preview's row numbers follow it and the other sheets are compared with it. A workbook without such a
 * sheet is refused (missing_columns), and one without data rows in them too (empty_workbook).
 */
export function readAdvisorSheets(sheets: readonly SheetGrid[], fileProblems: string[] = [], notes: ImportNote[] = []): AdvisorSheet {
  const found: List[] = [];
  const partial: string[] = [];
  for (const sheet of sheets) {
    const header = findHeader(sheet.grid);
    if (!header) continue;
    if (!header.columns.some((cell) => cell.field === "classes")) { partial.push(sheet.name); continue; }
    const lines = readLines(sheet.grid, header);
    found.push({ name: sheet.name, lines, classes: new Set(lines.flatMap((line) => line.classes)).size, fields: new Set(header.columns.map((cell) => cell.field)) });
  }
  if (!found.length) throw new AdvisorError("missing_columns", 400);
  const main = found.reduce((best, list) => (list.classes > best.classes ? list : best));
  const lists = [main, ...found.filter((list) => list !== main)];
  const lines = lists.flatMap((list, sheet) => list.lines.map((line) => ({ ...line, sheet })));
  if (!lines.length) throw new AdvisorError("empty_workbook", 400);
  const several = lists.length > 1;
  /** "dòng 2, 5", or with several sheets "trang "A" dòng 6; trang "B" dòng 9, 10". */
  const where = (sources: readonly Source[]) => {
    const bySheet = new Map<number, number[]>();
    for (const source of [...sources].sort((a, b) => a.sheet - b.sheet || a.row - b.row)) {
      const rows = bySheet.get(source.sheet) ?? [];
      if (!rows.includes(source.row)) rows.push(source.row);
      bySheet.set(source.sheet, rows);
    }
    return [...bySheet].map(([sheet, rows]) => `${several ? `trang "${lists[sheet]!.name}" ` : ""}dòng ${rows.join(", ")}`).join("; ");
  };

  // The same email on several rows (of one sheet or several) is one advisor with every class of those rows.
  type Item = { sources: Source[]; name: string; email: string; staffCode: string | null; unit: string | null;
    classes: Map<string, Source[]>; invalid: string[]; names: Map<string, Variant>; codes: Map<string, Variant>; read: Set<Field> };
  const variant = (known: Map<string, Variant>, key: string, text: string, source: Source) => {
    const seen = known.get(key);
    if (seen) seen.sources.push(source); else known.set(key, { text, sources: [source] });
  };
  const items: Item[] = [];
  const byEmail = new Map<string, Item>();
  for (const line of lines) {
    const source = { sheet: line.sheet, row: line.row };
    let item = line.email ? byEmail.get(line.email) : undefined;
    if (!item) {
      item = { sources: [], name: "", email: line.email, staffCode: null, unit: null, classes: new Map(), invalid: [], names: new Map(), codes: new Map(),
        read: new Set() };
      items.push(item);
      if (line.email) byEmail.set(line.email, item);
    }
    item.sources.push(source);
    for (const field of lists[line.sheet]!.fields) item.read.add(field);
    item.name ||= line.name;
    item.staffCode ||= line.staffCode || null;
    item.unit ||= line.unit || null;
    if (line.name) variant(item.names, foldText(line.name), line.name, source);
    if (line.staffCode) variant(item.codes, line.staffCode.toUpperCase(), line.staffCode, source);
    for (const name of line.classes) item.classes.set(name, [...(item.classes.get(name) ?? []), source]);
    for (const raw of line.invalid) if (!item.invalid.includes(raw)) item.invalid.push(raw);
  }
  // A class under two advisors of the file, in one sheet or two: neither can be imported until the file says which one.
  // So are two names or two staff codes for one email: the file does not say which one is right.
  const owners = new Map<string, Item[]>();
  for (const item of items) for (const name of item.classes.keys()) owners.set(name, [...(owners.get(name) ?? []), item]);
  const variants = (known: Map<string, Variant>) => [...known.values()].map((seen) => `"${seen.text}" (${where(seen.sources)})`).join(", ");
  const advisors = items.map((item): SheetAdvisor => {
    const problems: string[] = [];
    if (!item.name) problems.push("Thiếu họ và tên.");
    else if (item.name.length > 200) problems.push("Họ và tên dài quá 200 ký tự.");
    if (item.names.size > 1) problems.push(`Họ và tên ghi khác nhau: ${variants(item.names)}.`);
    if (!item.email) problems.push("Thiếu email.");
    else if (!EMAIL.test(item.email) || item.email.length > 320) problems.push(`Email ${item.email} không hợp lệ.`);
    if (item.staffCode && item.staffCode.length > 50) problems.push("Mã giảng viên dài quá 50 ký tự.");
    if (item.codes.size > 1) problems.push(`Mã giảng viên ghi khác nhau: ${variants(item.codes)}.`);
    if (item.unit && item.unit.length > 200) problems.push("Đơn vị dài quá 200 ký tự.");
    if (item.invalid.length) problems.push(`Tên lớp không hợp lệ: ${item.invalid.join(", ")}.`);
    const noCohort = [...item.classes.keys()].filter(needsCohort);
    if (noCohort.length) problems.push(`Lớp ${noCohort.join(", ")} chưa ghi khóa: ghi đủ mã lớp (như 71K29CNTT01) hoặc thêm cột KHÓA (như K29).`);
    if (!item.classes.size && !item.invalid.length) problems.push("Chưa có lớp phụ trách.");
    for (const name of item.classes.keys()) {
      const all = owners.get(name)!;
      if (all.length > 1) problems.push(`Lớp ${name} có ở nhiều cố vấn trong tệp (${where(all.flatMap((owner) => owner.classes.get(name)!))}).`);
    }
    const sheet = Math.min(...item.sources.map((source) => source.sheet));
    const unread = OPTIONAL_FIELDS.filter((field) => !item.read.has(field));
    return {
      rows: unique(item.sources.filter((source) => source.sheet === sheet).map((source) => source.row)),
      name: item.name, email: item.email, staffCode: item.staffCode, unit: item.unit, classes: [...item.classes.keys()], problems,
      ...(sheet > 0 ? { sheet: lists[sheet]!.name } : {}),
      ...(unread.length ? { unread } : {}),
    };
  });

  const said: ImportNote[] = [];
  if (main.name) {
    said.push({ tone: "info", text: several
      ? `Đọc ${lists.length} trang tính, gộp theo email: ${lists.map((list) => `"${list.name}" (${list.lines.length} dòng)`).join(", ")}. Cột Dòng theo trang "${main.name}".`
      : `Đọc trang tính "${main.name}".` });
  }
  for (const list of lists.slice(1)) said.push(compareSheets(list, main));
  return {
    rows: lines.length, items: advisors,
    fileProblems: [...fileProblems, ...partial.map((name) => `Bỏ qua trang "${name}": không có cột Mã lớp.`)],
    sheets: lists.map((list) => list.name).filter(Boolean), notes: [...said, ...notes],
  };
}

/** One sheet of cell texts (grid[0] is Excel row 1), as readAdvisorSheets reads it. */
export function readAdvisorGrid(grid: readonly (readonly string[])[], fileProblems: string[] = []): AdvisorSheet {
  return readAdvisorSheets([{ name: "", grid }], fileProblems);
}

/** A cell as the text it shows (rich text, hyperlinks, formula results, a number's leading zeros), like the CTĐT reader. */
function cellText(cell: import("exceljs").Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    // MGV is a number cell; a format of zeros ("0000000000") shows its leading zeros.
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

/** Reads the Khoa's workbook (.xlsx): its visible sheets with a list (readAdvisorSheets). Hidden sheets are never read. */
export async function readAdvisorWorkbook(buffer: Buffer): Promise<AdvisorSheet> {
  try { checkArchive(buffer); } catch (error) {
    if (error instanceof CurriculumError) throw new AdvisorError(error.code === "workbook_too_large" ? "workbook_too_large" : "invalid_workbook", 400);
    throw error;
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as never); } catch { throw new AdvisorError("invalid_workbook", 400); }
  // Not even the first rows of a hidden sheet are looked at: the Khoa's own file hides one about students there.
  const visible = workbook.worksheets.filter((sheet) => !sheet.state || sheet.state === "visible");
  const hidden = workbook.worksheets.length - visible.length;
  if (!visible.length) throw new AdvisorError("empty_workbook", 400);
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
  // A sheet without a list header (the template's Hướng dẫn) is passed over after its top rows.
  const lists = visible.flatMap((sheet) => {
    if (!findHeader(gridOf(sheet, HEADER_SEARCH_ROWS))) return [];
    if (sheet.rowCount > MAX_ROWS) throw new AdvisorError("workbook_too_large", 400);
    return [{ name: sheet.name, grid: gridOf(sheet, sheet.rowCount) }];
  });
  return readAdvisorSheets(lists, [], hidden ? [{ tone: "info", text: `Không đọc ${hidden} trang tính đang ẩn.` }] : []);
}

/**
 * The template "Tải file mẫu": the Khoa's own layout (the title rows, then STT | MGV | CVHT | EMAIL | MÃ LỚP | GHI CHÚ),
 * one made-up row and a sheet of instructions. today names the school year (from August, the year that starts).
 */
export async function advisorTemplate(domain = "vlu.edu.vn", today = new Date()): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const start = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`CVHT ${start}-${start + 1}`);
  sheet.columns = [{ width: 6 }, { width: 14 }, { width: 28 }, { width: 32 }, { width: 40 }, { width: 34 }];
  sheet.getCell("A1").value = "TRƯỜNG ĐẠI HỌC VĂN LANG";
  sheet.getCell("A2").value = "KHOA CÔNG NGHỆ THÔNG TIN";
  sheet.mergeCells("A3:F3");
  sheet.getCell("A3").value = "DANH SÁCH CỐ VẤN HỌC TẬP";
  sheet.mergeCells("A4:F4");
  sheet.getCell("A4").value = `NĂM HỌC ${start} - ${start + 1}`;
  for (const ref of ["A1", "A2", "A4"]) sheet.getCell(ref).font = { bold: true };
  sheet.getCell("A3").font = { bold: true, size: 14 };
  for (const ref of ["A3", "A4"]) sheet.getCell(ref).alignment = { horizontal: "center" };
  sheet.getRow(5).values = ["STT", "MGV", "CVHT", "EMAIL", "MÃ LỚP", "GHI CHÚ"];
  sheet.getRow(5).font = { bold: true };
  sheet.getRow(5).alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(6).values = [1, 1234567890, "Nguyễn Văn A", `nguyenvana@${domain}`, "71K29CNTT01, 71K29CNTT02", "Dòng ví dụ, xóa trước khi import"];
  for (const row of [5, 6]) {
    for (let column = 1; column <= 6; column++) {
      sheet.getCell(row, column).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    }
  }
  const help = workbook.addWorksheet("Hướng dẫn");
  help.getColumn(1).width = 120;
  for (const line of [
    "Mỗi dòng là một cố vấn học tập, hoặc một lớp của cố vấn: các dòng cùng EMAIL được gộp thành một cố vấn với mọi lớp của những dòng đó.",
    "Cột bắt buộc: CVHT (họ và tên), EMAIL và MÃ LỚP. MGV (mã giảng viên) và GHI CHÚ có thể để trống.",
    `EMAIL là email cán bộ của trường (@${domain}); cố vấn đăng nhập EduPath AI bằng tài khoản Microsoft của email này.`,
    "MÃ LỚP ghi đủ mã lớp của trường (ví dụ 71K29CNTT01; lớp của chương trình khác giữ số đầu của lớp, như 72K29CNTT01). Nhiều lớp trong một ô cách nhau bằng dấu phẩy, chấm phẩy hoặc xuống dòng; viết gọn 71K29CNTT01, 02, 03 cũng được.",
    "Nếu MÃ LỚP chỉ ghi tên lớp (CNTT01), thêm cột KHÓA (K29) trên cùng dòng: lớp được hiểu là 71K29CNTT01.",
    "Mỗi lớp chỉ có một cố vấn. Cố vấn đã có trong danh sách được cập nhật theo tệp; lớp ghi cho cố vấn khác sẽ chuyển sang người đó.",
    "Mọi trang tính đang hiện có dòng tiêu đề này đều được đọc và gộp lại; trang tính ẩn không được đọc. Các cột khác (SLSV, GHI CHÚ…) được bỏ qua.",
    "Tệp theo mẫu cũ (Họ và tên, Email, Mã giảng viên, Đơn vị, Lớp phụ trách) vẫn đọc được.",
    "Xóa dòng ví dụ trước khi import. Trước khi lưu, trang Danh sách cố vấn học tập cho xem trước từng cố vấn và lỗi nếu có.",
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
export type PlannedAdvisor = AdvisorImportItem & { sheet?: string; userId: string | null; roleChange: boolean };
/** The preview with the sheets read and the notes about them (readAdvisorSheets); items may name their sheet. */
export type AdvisorPreview = AdvisorImportPreview & { items: (AdvisorImportItem & { sheet?: string })[]; sheets: string[]; notes: ImportNote[] };

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();
/**
 * The school's student mailbox domain. An advisor may have such an email too (user 2026-11-07: "cho phép cả
 * @vanlanguni.vn"); with the advisor role the account uses the admin portal only, like every admin-portal role.
 * STAFF_EMAIL_DOMAINS stays the staff mailboxes alone: it also decides who never uses the student portal.
 */
export const STUDENT_EMAIL_DOMAIN = "vanlanguni.vn";
/** The domains an advisor's email may have: the staff mailboxes (STAFF_EMAIL_DOMAINS) and the student one. */
export const advisorEmailDomains = (staffDomains: ReadonlySet<string>): ReadonlySet<string> =>
  new Set([...[...staffDomains].map((domain) => domain.toLowerCase()), STUDENT_EMAIL_DOMAIN]);
/** The email has one of the advisor domains. */
export const isAdvisorEmail = (email: string, staffDomains: ReadonlySet<string>) => advisorEmailDomains(staffDomains).has(domainOf(email));
/** "@vlu.edu.vn hoặc @vanlanguni.vn" */
export const advisorDomainText = (staffDomains: ReadonlySet<string>) => {
  const domains = [...advisorEmailDomains(staffDomains)].map((domain) => `@${domain}`);
  return domains.length > 1 ? `${domains.slice(0, -1).join(", ")} hoặc ${domains.at(-1)}` : domains.join("");
};
const words = (list: readonly string[]) => list.join(", ");
/** One account, one role (portal rule): a student account advises only once Tài khoản gives it the advisor role. */
export const STUDENT_ACCOUNT_PROBLEM = "Email này đang là tài khoản sinh viên; đổi vai trò ở trang Tài khoản trước nếu muốn cho làm cố vấn học tập.";
// Roles an import leaves as they are: the advisor keeps the rights of the role and advises the classes too.
const KEPT_ROLES = new Set(["admin", "faculty_board", "department_head", "advisor"]);

/** The same text, whatever Unicode form its accents are written in; null is empty. */
const sameText = (a: string | null, b: string | null) => (a ?? "").normalize("NFC") === (b ?? "").normalize("NFC");

/**
 * The preview of a workbook against the database (AD-ADV-03), and the plan applying it follows. Imported again, a file
 * finds its advisors in the list: those whose rows say what is stored are "unchanged" (apply skips them), the others are
 * "update" with what differs. A field without a column in the file (unread) takes the stored value: it is no change.
 */
export function planImport(fileName: string, sheet: AdvisorSheet, lookups: ImportLookups): { preview: AdvisorPreview; plan: PlannedAdvisor[] } {
  const plan: PlannedAdvisor[] = sheet.items.map(({ unread = [], ...read }) => {
    const problems = [...read.problems];
    // A school account only (staff or student mailbox), as the form's own rule (repository.ts).
    if (read.email && !problems.some((problem) => problem.startsWith("Email")) && !isAdvisorEmail(read.email, lookups.staffDomains)) {
      problems.push(`Email không phải email của trường (${advisorDomainText(lookups.staffDomains)}).`);
    }
    const matches = read.email ? lookups.accounts.get(read.email) ?? [] : [];
    if (matches.length > 1) problems.push("Email này trùng với nhiều tài khoản trong EduPath AI.");
    const account = matches.length === 1 ? matches[0]! : null;
    if (account?.role === "student") problems.push(STUDENT_ACCOUNT_PROBLEM);
    if (account && !account.isActive) problems.push("Tài khoản của email này đang bị khóa; mở khóa ở trang Tài khoản trước.");
    const existing = account ? lookups.advisors.get(account.id) : undefined;
    const item = {
      ...read,
      staffCode: unread.includes("staffCode") ? existing?.staffCode ?? null : read.staffCode,
      unit: unread.includes("unit") ? existing?.unit ?? null : read.unit,
    };
    if (problems.length) {
      return { ...item, problems, status: "error", changes: [], emptyClasses: [], userId: account?.id ?? null, roleChange: false };
    }
    const roleChange = Boolean(account && !KEPT_ROLES.has(account.role));
    const moves = item.classes.flatMap((name) => {
      const owner = lookups.classOwners.get(name);
      return owner && owner.userId !== account?.id ? [`Lớp ${name} chuyển từ ${owner.name}`] : [];
    });
    // A class nobody studies in yet (a new cohort) is imported all the same, with a warning.
    const emptyClasses = item.classes.filter((name) => !lookups.classesWithStudents.has(name));
    const roleWords = !account ? ["Tạo tài khoản, chờ đăng nhập Microsoft lần đầu"]
      : roleChange ? [`Đổi vai trò ${roleLabel(account.role)} thành Cố vấn học tập`]
        : account.role !== "advisor" ? [`Giữ vai trò ${roleLabel(account.role)}`] : [];
    if (!existing) {
      return { ...item, problems, status: "add", emptyClasses, userId: account?.id ?? null, roleChange,
        changes: ["Thêm cố vấn học tập mới", ...roleWords, `Phụ trách ${item.classes.length} lớp: ${words(item.classes)}`, ...moves] };
    }
    const changes: string[] = [];
    if (!sameText(existing.name, item.name)) changes.push(`Đổi họ và tên: ${existing.name} → ${item.name}`);
    if (!sameText(existing.staffCode, item.staffCode)) changes.push(`Đổi mã giảng viên: ${existing.staffCode ?? "trống"} → ${item.staffCode ?? "trống"}`);
    if (!sameText(existing.unit, item.unit)) changes.push(`Đổi đơn vị: ${existing.unit ?? "trống"} → ${item.unit ?? "trống"}`);
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
  const preview: AdvisorPreview = {
    fileName, rows: sheet.rows, fileProblems: sheet.fileProblems, sheets: sheet.sheets ?? [], notes: sheet.notes ?? [],
    items: plan.map(({ userId: _userId, roleChange: _roleChange, ...item }) => item),
    summary: {
      add: count("add"), update: count("update"), unchanged: count("unchanged"), error: count("error"),
      classes: new Set(valid.flatMap((item) => item.classes)).size,
      moved: valid.reduce((total, item) => total + item.changes.filter((change) => change.startsWith("Lớp ") && change.includes(" chuyển từ ")).length, 0),
    },
  };
  return { preview, plan };
}
