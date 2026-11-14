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
// Files that differ from the template (QA 2026-11-14, user: "Kiểm thử các trường hợp file Excel sai cấu trúc, thêm cột,
// thừa dữ liệu hoặc khác file mẫu. Cần có cách xử lý và thông báo phù hợp"): a file without the list is refused with a
// message that names the sheet, the header row and the missing or unrecognised columns (missing_columns), a student list
// (MSSV) is never read as advisors (student_list), an old .xls or a password-protected file (legacy_workbook), too many rows
// (too_many_rows) and a header without rows (empty_workbook) say so; harmless extras are read past with a note: columns
// not used, a column given twice, rows below the table without an email or a class (totals, signatures), a header
// repeated below the table, a group title merged across a row, rows hidden in Excel. The template's example row, a date
// or a formula without a value in a cell that is read, an email with accents or invisible characters, two spellings of
// one advisor's name and a class without letters are errors of their row. Name and family name in two columns (Họ đệm |
// Tên) and common English headers are read.
import { CurriculumError } from "../curricula/model.js";
import { checkArchive } from "../curricula/parser.js";
import { foldText } from "../admin/audit/record.js";
import { roleLabel } from "../admin/audit/routes.js";
import { classCode, cohortCode, needsCohort, normalizeClassName } from "./class-code.js";
import { AdvisorError, CLASS_PATTERN, type AdvisorImportItem, type AdvisorImportPreview } from "./model.js";

/**
 * What a header cell names. student: a student code (MSSV), so the sheet is a student list; familyName and givenName: a
 * name written in two columns (Họ đệm | Tên), read together as the name.
 */
type Field = "name" | "email" | "staffCode" | "unit" | "classes" | "cohort" | "student" | "familyName" | "givenName";
// Header names, folded (lower case, no diacritics). A header matches a name exactly or starts with it and a space
// ("Lớp phụ trách (cách nhau bằng dấu phẩy)"). Checked in this order, so "Email cố vấn" is the email, "Mã giảng viên"
// is not a name and "Khoa bộ môn" is the unit. "Khóa" (KHÓA, the cohort) folds as "Khoa" does: a cell that is no cohort
// ("Công nghệ thông tin") is passed over (cohortCode). The English names are the common ones of a list made elsewhere.
const HEADERS: readonly [Field, readonly string[]][] = [
  ["email", ["email", "e-mail", "e mail", "mail", "email vlu", "dia chi email", "thu dien tu"]],
  ["staffCode", ["mgv", "msgv", "ma gv", "ma so gv", "ma giang vien", "ma so giang vien", "ma cb", "ma can bo", "ma nhan vien", "ma cvht",
    "staff id", "staff code", "lecturer id", "lecturer code", "employee id"]],
  ["classes", ["ma lop", "lop phu trach", "cac lop phu trach", "lop cvht", "lop chu nhiem", "lop co van", "lop",
    "class", "classes", "class code", "class name", "class id"]],
  ["unit", ["don vi", "don vi cong tac", "bo mon", "khoa bo mon", "department", "unit", "faculty"]],
  ["name", ["ho va ten", "ho ten", "ho va ten co van", "ho ten co van", "ten co van", "co van hoc tap", "co van", "cvht",
    "giang vien", "ten giang vien", "ho ten giang vien", "ho va ten giang vien", "full name", "name", "advisor", "advisor name",
    "academic advisor", "lecturer", "lecturer name"]],
  ["cohort", ["khoa", "khoa hoc"]],
];
// Matched only as the whole header, before the names above ("Họ và tên đệm" is no "Họ và tên"; "Tên lớp" is no "Tên").
const EXACT: readonly [Field, readonly string[]][] = [
  ["student", ["mssv", "msv", "ma sv", "ma so sv", "ma sinh vien", "ma so sinh vien", "student id", "student code"]],
  ["familyName", ["ho", "ho dem", "ho lot", "ho va ten dem", "ho va chu lot", "ho va dem", "family name", "last name", "surname"]],
  ["givenName", ["ten", "given name", "first name"]],
];
// Columns of the Khoa's file that are never read: "CVHT NỘP KẾ HOẠCH…" would otherwise be the name ("cvht …"); STT, SLSV
// Hiện tại / ban đầu and GHI CHÚ are named so that no alias above ever catches them.
const IGNORED = ["stt", "so tt", "slsv", "si so", "so luong", "so sv", "ghi chu", "cvht nop", "nop ke hoach", "no"];
const MAX_ROWS = 2000;
const MAX_COLUMNS = 40;
const HEADER_SEARCH_ROWS = 50;
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
/** A class written in full as the Khoa does: campus digits, K and the cohort, the program, the number (71K27CNTT01). */
const FULL_CLASS = /^\d*K\d{2,3}[A-Z]+\d+$/;
/** Characters a copy from a web page or Word leaves unseen in a cell (zero-width spaces and joiners, BOM, soft hyphen). */
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;
/** The template's example row (advisorTemplate): it is never imported, even when the file keeps it. */
export const TEMPLATE_EXAMPLE = { name: "Nguyễn Văn A", local: "nguyenvana", classes: "71K29CNTT01, 71K29CNTT02", note: "Dòng ví dụ, xóa trước khi import" };

/** A header cell: its field, "ignored" for a column of the Khoa's file that is not read (STT, SLSV, GHI CHÚ), or null. */
function classify(text: string): Field | "ignored" | null {
  const folded = foldText(text).replace(/[()[\]{}:*.#"“”]/g, " ").replace(/\s+/g, " ").trim();
  if (!folded) return null;
  const starts = (name: string) => folded === name || folded.startsWith(`${name} `);
  if (IGNORED.some(starts) || /(^| )ke hoach( |$)/.test(folded)) return "ignored";
  for (const [field, names] of EXACT) {
    if (names.includes(folded)) return field;
  }
  for (const [field, names] of HEADERS) {
    if (names.some(starts)) return field;
  }
  return null;
}

/** The field of a header cell, or null (STT, Khóa, SLSV, notes). */
export function headerField(text: string): Field | null {
  const field = classify(text);
  return field === "ignored" ? null : field;
}

/**
 * "71k29cntt01, 71K29CNTT02; 71K29CNTT02" → two classes. A number alone continues the class before it in the same cell,
 * as the Khoa's list for Phòng Đào tạo writes them: "71K27CNTT01, 02, 03" → 71K27CNTT01, 71K27CNTT02, 71K27CNTT03.
 * Pieces that are not class names (a number with no class before it, or longer than that class's number, or a piece
 * without a letter such as a date "2029-01-02") come apart.
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
    if (!CLASS_PATTERN.test(name) || !/[A-Z]/.test(name)) { bad(raw); continue; }
    if (!classes.includes(name)) classes.push(name);
  }
  return { classes, invalid };
}

const cleanEmail = (text: string) => text.replace(INVISIBLE, "").trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
// NFC: a name typed with combining accents (some Vietnamese keyboards) is the same text as the precomposed one.
const cleanLine = (text: string) => text.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
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
/**
 * What a cell of the workbook holds besides its text: a date (Excel turned the typed text into one), a formula Excel never
 * computed (the file was written by another program) or a formula's error (#N/A). Only a cell that is read is reported.
 */
export type CellIssue = { kind: "date" | "formula" | "error"; detail?: string };
/**
 * A sheet as cell texts (grid[0] is Excel row 1). issues: the cells with a CellIssue, by "row:column" of the grid (0-based);
 * hiddenRows: the Excel rows hidden in the sheet.
 */
export type SheetGrid = { name: string; grid: readonly (readonly string[])[]; issues?: ReadonlyMap<string, CellIssue>; hiddenRows?: readonly number[] };
/** names of the hidden sheets (never read), for the message of a file whose visible sheets have no list. */
export type ReadOptions = { hiddenSheets?: readonly string[] };

type Column = { field: Field; column: number };
type Header = { row: number; columns: Column[]; texts: readonly string[] };
type Line = { row: number; name: string; email: string; staffCode: string; unit: string; classes: string[]; invalid: string[];
  /** The cells of the row with a CellIssue, worded; blanked: the fields those cells leave empty. */
  cellProblems: string[]; blanked: Field[] };
/** fields: the fields its header has a column for. */
type List = { name: string; lines: Line[]; classes: number; fields: ReadonlySet<Field> };
type Source = { sheet: number; row: number };
type Variant = { text: string; sources: Source[] };

/** The fields of a header row, in its order (one entry per column with a field). */
const fieldsOf = (cells: readonly string[]): Column[] => cells.map((text, column) => ({ field: headerField(text), column }))
  .filter((cell): cell is Column => cell.field !== null);
/** A header row names the advisor: a name column, or a given name (with or without the family name beside it). */
const namesAdvisor = (columns: readonly Column[]) => columns.some((cell) => cell.field === "name" || cell.field === "givenName");

/** The header: the first of the top rows with a name and an email column (the title rows above it are passed over). */
function findHeader(grid: SheetGrid["grid"]): Header | null {
  for (let row = 0; row < Math.min(HEADER_SEARCH_ROWS, grid.length); row++) {
    const columns = fieldsOf(grid[row] ?? []);
    if (namesAdvisor(columns) && columns.some((cell) => cell.field === "email")) return { row, columns, texts: grid[row] ?? [] };
  }
  return null;
}

/** "A", "B" … "Z", "AA" for the 0-based column. */
export function columnLetter(column: number): string {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

const ISSUE_TEXT: Record<CellIssue["kind"], (detail?: string) => string> = {
  date: (detail) => `đang là ngày tháng${detail ? ` (${detail})` : ""}: định dạng ô thành Text (Văn bản) rồi gõ lại`,
  formula: () => "là công thức chưa có kết quả: mở tệp bằng Excel, lưu lại rồi chọn lại tệp",
  error: (detail) => `có lỗi công thức${detail ? ` ${detail}` : ""}: sửa ô này trong Excel rồi chọn lại tệp`,
};

/** Rows read past: below the table without an email or a class, a header written again, a group title across the row. */
type Skipped = { footer: { row: number; text: string }[]; repeated: number[]; groups: { row: number; text: string }[] };

/**
 * The data rows below the header, blank ones left out. A row that repeats the header (a second table below the first) and
 * a group title merged across the row (every cell read holds the same text, no email) are read past; so are the rows
 * below the table's last advisor that have neither an email nor a class (totals, the place and date, signatures).
 */
function readLines(sheet: SheetGrid, header: Header): { lines: Line[]; skipped: Skipped } {
  const { grid, issues } = sheet;
  // The first column of a field wins, except the classes: several class columns are read together.
  const first = (field: Field) => header.columns.find((cell) => cell.field === field)?.column;
  const classColumns = header.columns.filter((cell) => cell.field === "classes").map((cell) => cell.column);
  const read = (cells: readonly string[], column: number | undefined) => (column === undefined ? "" : cells[column] ?? "");
  const nameColumn = first("name");
  const lines: Line[] = [];
  const skipped: Skipped = { footer: [], repeated: [], groups: [] };
  for (let row = header.row + 1; row < grid.length; row++) {
    const cells = grid[row] ?? [];
    const filled = header.columns.map((cell) => ({ ...cell, text: cleanLine(read(cells, cell.column)) })).filter((cell) => cell.text);
    // The header again: its email cell says EMAIL, and another cell names its own column too ("CVHT", "MÃ LỚP").
    const titles = filled.filter((cell) => headerField(cell.text) === cell.field);
    if (titles.some((cell) => cell.field === "email") && titles.length >= 2) { skipped.repeated.push(row + 1); continue; }
    const email = cleanEmail(read(cells, first("email")));
    if (filled.length >= 2 && !email.includes("@") && new Set(filled.map((cell) => cell.text.toLocaleLowerCase("vi"))).size === 1) {
      skipped.groups.push({ row: row + 1, text: filled[0]!.text });
      continue;
    }
    // A cell with a date, a formula without a value or an error is reported and read as empty.
    const cellProblems: string[] = [];
    const blanked: Field[] = [];
    for (const cell of header.columns) {
      const issue = issues?.get(`${row}:${cell.column}`);
      if (!issue) continue;
      const title = cleanLine(header.texts[cell.column] ?? "") || columnLetter(cell.column);
      cellProblems.push(`Ô ${columnLetter(cell.column)}${row + 1} (cột ${title}) ${ISSUE_TEXT[issue.kind](issue.detail)}.`);
      blanked.push(cell.field);
    }
    const value = (column: number | undefined) => (column !== undefined && issues?.has(`${row}:${column}`) ? "" : read(cells, column));
    const name = nameColumn !== undefined ? cleanLine(value(nameColumn))
      : cleanLine(`${value(first("familyName"))} ${value(first("givenName"))}`);
    const staffCode = cleanLine(value(first("staffCode")));
    const unit = cleanLine(value(first("unit")));
    // Each class cell on its own: "02" only continues a class of its own cell. KHÓA completes the short classes of the row.
    const cohort = cohortCode(value(first("cohort")));
    const split = classColumns.map((column) => splitClasses(value(column), cohort));
    const classes = unique(split.flatMap((part) => part.classes));
    const invalid = unique(split.flatMap((part) => part.invalid));
    const mail = issues?.has(`${row}:${first("email")}`) ? "" : email;
    if (!name && !mail && !staffCode && !unit && !classes.length && !invalid.length && !cellProblems.length) continue;
    lines.push({ row: row + 1, name, email: mail, staffCode, unit, classes, invalid, cellProblems, blanked });
  }
  // The table ends at its last row with an email, a class or a cell to fix; rows below it without any are not advisors.
  const real = (line: Line) => line.email.includes("@") || line.classes.length > 0 || line.cellProblems.length > 0;
  const last = lines.findLastIndex(real);
  if (last >= 0) {
    for (const line of lines.splice(last + 1)) {
      const cells = grid[line.row - 1] ?? [];
      const text = header.columns.map((cell) => cleanLine(read(cells, cell.column))).find(Boolean) ?? "";
      skipped.footer.push({ row: line.row, text });
    }
  }
  return { lines, skipped };
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

/** The three columns a list must have, as the template names them. */
const REQUIRED = [["name", "CVHT (họ và tên)"], ["email", "EMAIL"], ["classes", "MÃ LỚP"]] as const;
type Required = (typeof REQUIRED)[number][0];
const COLUMNS_TEXT = "CVHT (họ và tên), EMAIL và MÃ LỚP";
/** What a field is called in a note ("2 cột email"). */
const FIELD_WORDS: Record<Field, string> = { name: "họ và tên", email: "email", staffCode: "mã giảng viên", unit: "đơn vị", classes: "lớp",
  cohort: "khóa", student: "mã sinh viên", familyName: "họ", givenName: "tên" };
const and = (words: readonly string[]) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} và ${words.at(-1)}` : words[0] ?? "");
const quoted = (texts: readonly string[], shown = 6) => few(texts.map((text) => `"${text.length > 40 ? `${text.slice(0, 39)}…` : text}"`), shown);
/** "Trang "CVHT"" or, for a grid without a sheet name, "Trang tính". */
const sheetWords = (name: string) => (name ? `Trang "${name}"` : "Trang tính");

/**
 * The top row of a sheet that names the most of the three columns a list must have (the first of them on a tie), with the
 * headers not recognised in it; student: the row has a student code column (MSSV). Null when no top row names any.
 */
function headerCandidate(grid: SheetGrid["grid"]): { row: number; has: Set<Required>; unknown: string[]; student: boolean } | null {
  let best: { row: number; has: Set<Required>; unknown: string[]; student: boolean } | null = null;
  for (let row = 0; row < Math.min(HEADER_SEARCH_ROWS, grid.length); row++) {
    const cells = (grid[row] ?? []).map((text) => ({ text: cleanLine(text), kind: classify(text) }));
    const has = new Set<Required>();
    for (const { kind } of cells) {
      if (kind === "name" || kind === "givenName") has.add("name");
      else if (kind === "email" || kind === "classes") has.add(kind);
    }
    const student = cells.some((cell) => cell.kind === "student");
    if ((has.size || student) && (!best || has.size > best.has.size)) {
      best = { row, has, unknown: cells.filter((cell) => cell.text && cell.kind === null).map((cell) => cell.text), student };
    }
  }
  return best;
}

/**
 * Why no sheet holds a list, as the message of the refusal: the sheet and header row closest to one with the columns it
 * lacks and the headers not recognised there; a student list (MSSV); or no list at all, with the hidden sheets named.
 */
function noListError(sheets: readonly SheetGrid[], options: ReadOptions): AdvisorError {
  const candidates = sheets.map((sheet) => ({ sheet, found: headerCandidate(sheet.grid) }))
    .filter((one): one is { sheet: SheetGrid; found: NonNullable<ReturnType<typeof headerCandidate>> } => one.found !== null);
  const students = candidates.filter((one) => one.found.student);
  if (students.length) {
    return new AdvisorError("student_list", 400, { message: `${sheetWords(students[0]!.sheet.name)} có cột MSSV: đây là danh sách sinh viên, không phải `
      + `danh sách cố vấn học tập. Hãy chọn tệp phân công cố vấn của Khoa, với các cột ${COLUMNS_TEXT}.` });
  }
  const best = candidates.reduce<(typeof candidates)[number] | null>((top, one) => (!top || one.found.has.size > top.found.has.size ? one : top), null);
  if (best) {
    const missing = REQUIRED.filter(([field]) => !best.found.has.has(field)).map(([, title]) => title);
    return new AdvisorError("missing_columns", 400, { message: `${sheetWords(best.sheet.name)} (dòng tiêu đề ${best.found.row + 1}) thiếu cột ${and(missing)}.`
      + `${best.found.unknown.length ? ` Cột chưa nhận ra: ${quoted(best.found.unknown)}.` : ""}`
      + ` Cần đủ các cột ${COLUMNS_TEXT}: thêm cột còn thiếu hoặc sửa tên cột cho giống tệp mẫu, rồi chọn lại tệp.` });
  }
  const hidden = options.hiddenSheets ?? [];
  return new AdvisorError("missing_columns", 400, { message: "Tệp này không có danh sách cố vấn học tập: không trang tính nào có dòng tiêu đề với các cột "
    + `${COLUMNS_TEXT} trong ${HEADER_SEARCH_ROWS} dòng đầu. Hãy chọn tệp phân công cố vấn của Khoa, hoặc bấm Tải file mẫu rồi điền theo mẫu.`
    + `${hidden.length ? ` Tệp có ${hidden.length} trang tính đang ẩn (${quoted(hidden)}) không được đọc: nếu danh sách nằm ở đó, hiện trang tính (Unhide) rồi chọn lại tệp.` : ""}` });
}

/** The notes on one sheet read: the columns not used or given twice, the rows read past and the hidden rows read. */
function sheetNotes(sheet: SheetGrid, header: Header, lines: readonly Line[], skipped: Skipped, prefix: string): ImportNote[] {
  const notes: ImportNote[] = [];
  const say = (tone: ImportNote["tone"], text: string) => notes.push({ tone, text: `${prefix}${text}` });
  const titled = header.texts.map((text, column) => ({ text: cleanLine(text), column, kind: classify(text) })).filter((cell) => cell.text);
  const unused = titled.filter((cell) => cell.kind === null);
  if (unused.length) say("info", `Bỏ qua các cột không dùng: ${quoted(unused.map((cell) => cell.text), 8)}.`);
  for (const field of unique(header.columns.map((cell) => cell.field))) {
    const columns = header.columns.filter((cell) => cell.field === field);
    if (columns.length < 2 || field === "classes") continue;
    const named = columns.map((cell) => `"${cleanLine(header.texts[cell.column] ?? "")}" (cột ${columnLetter(cell.column)})`);
    say("warn", `Có ${columns.length} cột ${FIELD_WORDS[field]}: ${and(named)}; chỉ đọc cột ${columnLetter(columns[0]!.column)}. `
      + "Nếu cần đọc cột kia, xóa hoặc đổi tên cột thừa rồi chọn lại tệp.");
  }
  if (skipped.repeated.length) say("info", `Bỏ qua dòng ${skipped.repeated.join(", ")}: dòng tiêu đề lặp lại.`);
  if (skipped.groups.length) {
    say("info", `Bỏ qua dòng ${skipped.groups.map((group) => group.row).join(", ")}: dòng tên nhóm (${quoted(skipped.groups.map((group) => group.text), 4)}).`);
  }
  if (skipped.footer.length) {
    say("info", `Bỏ qua ${skipped.footer.length} dòng dưới bảng không có email và mã lớp (dòng ${skipped.footer.map((one) => one.row).join(", ")}: `
      + `${quoted(skipped.footer.map((one) => one.text), 4)}). Nếu có dòng là cố vấn, thêm email và mã lớp cho dòng đó rồi chọn lại tệp.`);
  }
  const hidden = new Set(sheet.hiddenRows ?? []);
  const hiddenRead = lines.filter((line) => hidden.has(line.row)).map((line) => line.row);
  if (hiddenRead.length) {
    say("warn", `${hiddenRead.length} dòng đang ẩn trong Excel vẫn được đọc (dòng ${few(hiddenRead.map(String), 12)}). `
      + "Nếu không muốn import các dòng này, xóa chúng khỏi tệp rồi chọn lại.");
  }
  return notes;
}

/** The template's example row (TEMPLATE_EXAMPLE), whatever the domain of its email. */
const isTemplateExample = (name: string, email: string) =>
  foldText(name) === foldText(TEMPLATE_EXAMPLE.name) && email.slice(0, email.indexOf("@")) === TEMPLATE_EXAMPLE.local;

/**
 * Reads the sheets of a workbook, in its order. Every sheet whose header has a name, an email and a class column is read,
 * and the rows of one email in all of them are one advisor. The sheet with the most classes (the first of them on a tie)
 * comes first: the preview's row numbers follow it and the other sheets are compared with it. A sheet with a student
 * code column (MSSV) is a student list and never read. A workbook without a list is refused (missing_columns, or
 * student_list), and one without data rows in its lists too (empty_workbook), each with a message naming the sheet.
 */
export function readAdvisorSheets(sheets: readonly SheetGrid[], fileProblems: string[] = [], notes: ImportNote[] = [], options: ReadOptions = {}): AdvisorSheet {
  const found: (List & { sheet: SheetGrid; header: Header; skipped: Skipped })[] = [];
  const partial: string[] = [];
  const students: string[] = [];
  for (const sheet of sheets) {
    const header = findHeader(sheet.grid);
    if (!header) continue;
    if (header.columns.some((cell) => cell.field === "student")) { students.push(sheet.name); continue; }
    if (!header.columns.some((cell) => cell.field === "classes")) { partial.push(sheet.name); continue; }
    const { lines, skipped } = readLines(sheet, header);
    found.push({ name: sheet.name, lines, classes: new Set(lines.flatMap((line) => line.classes)).size, fields: new Set(header.columns.map((cell) => cell.field)),
      sheet, header, skipped });
  }
  if (!found.length) throw noListError(sheets, options);
  const main = found.reduce((best, list) => (list.classes > best.classes ? list : best));
  const lists = [main, ...found.filter((list) => list !== main)];
  const lines = lists.flatMap((list, sheet) => list.lines.map((line) => ({ ...line, sheet })));
  if (!lines.length) {
    const where = lists.length > 1
      ? `Các trang ${and(lists.map((list) => `"${list.name}" (dòng ${list.header.row + 1})`))} có dòng tiêu đề`
      : `${sheetWords(main.name)} có dòng tiêu đề (dòng ${main.header.row + 1})`;
    throw new AdvisorError("empty_workbook", 400, { message: `${where} nhưng chưa có cố vấn nào bên dưới. Thêm mỗi cố vấn một dòng với ${COLUMNS_TEXT} rồi chọn lại tệp.` });
  }
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
    classes: Map<string, Source[]>; invalid: string[]; names: Map<string, Variant>; codes: Map<string, Variant>; read: Set<Field>;
    cellProblems: string[]; blanked: Set<Field> };
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
        read: new Set(), cellProblems: [], blanked: new Set() };
      items.push(item);
      if (line.email) byEmail.set(line.email, item);
    }
    item.sources.push(source);
    for (const field of lists[line.sheet]!.fields) item.read.add(field);
    item.name ||= line.name;
    item.staffCode ||= line.staffCode || null;
    item.unit ||= line.unit || null;
    // Two spellings of a name differ when their letters or accents do ("Thử" and "Thứ"), not when only capitals do.
    if (line.name) variant(item.names, line.name.toLocaleLowerCase("vi"), line.name, source);
    if (line.staffCode) variant(item.codes, line.staffCode.toUpperCase(), line.staffCode, source);
    for (const name of line.classes) item.classes.set(name, [...(item.classes.get(name) ?? []), source]);
    for (const raw of line.invalid) if (!item.invalid.includes(raw)) item.invalid.push(raw);
    for (const problem of line.cellProblems) if (!item.cellProblems.includes(problem)) item.cellProblems.push(problem);
    for (const field of line.blanked) item.blanked.add(field);
  }
  // A class under two advisors of the file, in one sheet or two: neither can be imported until the file says which one.
  // So are two names or two staff codes for one email: the file does not say which one is right.
  const owners = new Map<string, Item[]>();
  for (const item of items) for (const name of item.classes.keys()) owners.set(name, [...(owners.get(name) ?? []), item]);
  const variants = (known: Map<string, Variant>) => [...known.values()].map((seen) => `"${seen.text}" (${where(seen.sources)})`).join(", ");
  const advisors = items.map((item): SheetAdvisor => {
    // A cell with a date or a formula without a value is reported as itself, not as a missing name, email or class.
    const blank = (...fields: Field[]) => fields.some((field) => item.blanked.has(field));
    const problems: string[] = [];
    if (isTemplateExample(item.name, item.email)) problems.push("Đây là dòng ví dụ của tệp mẫu: xóa dòng này rồi chọn lại tệp.");
    problems.push(...item.cellProblems);
    if (!item.name) { if (!blank("name", "familyName", "givenName")) problems.push("Thiếu họ và tên."); }
    else if (item.name.length > 200) problems.push("Họ và tên dài quá 200 ký tự.");
    if (item.names.size > 1) problems.push(`Họ và tên ghi khác nhau: ${variants(item.names)}.`);
    if (!item.email) { if (!blank("email")) problems.push("Thiếu email."); }
    else if ((item.email.match(/@/g) ?? []).length > 1 && /[\s,;]/.test(item.email)) problems.push(`Email ghi nhiều địa chỉ trong một ô (${item.email}): mỗi cố vấn chỉ ghi một email.`);
    // A Microsoft account's email has no accents: "nguyễn.thử@…" would make an account that never signs in.
    else if (/[^\x00-\x7f]/.test(item.email)) {
      problems.push(`Email ${item.email} có chữ có dấu hoặc ký tự lạ: email của trường chỉ gồm chữ cái không dấu, chữ số và các dấu chấm, gạch ngang, gạch dưới.`);
    } else if (!EMAIL.test(item.email) || item.email.length > 320) problems.push(`Email ${item.email} không hợp lệ.`);
    if (item.staffCode && item.staffCode.length > 50) problems.push("Mã giảng viên dài quá 50 ký tự.");
    if (item.codes.size > 1) problems.push(`Mã giảng viên ghi khác nhau: ${variants(item.codes)}.`);
    if (item.unit && item.unit.length > 200) problems.push("Đơn vị dài quá 200 ký tự.");
    if (item.invalid.length) problems.push(`Tên lớp không hợp lệ: ${item.invalid.join(", ")}.`);
    const noCohort = [...item.classes.keys()].filter(needsCohort);
    if (noCohort.length) problems.push(`Lớp ${noCohort.join(", ")} chưa ghi khóa: ghi đủ mã lớp (như 71K29CNTT01) hoặc thêm cột KHÓA (như K29).`);
    if (!item.classes.size && !item.invalid.length && !blank("classes", "cohort")) problems.push("Chưa có lớp phụ trách.");
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
  for (const list of lists) said.push(...sheetNotes(list.sheet, list.header, list.lines, list.skipped, several ? `Trang "${list.name}": ` : ""));
  return {
    rows: lines.length, items: advisors,
    fileProblems: [...fileProblems, ...partial.map((name) => `Bỏ qua trang "${name}": không có cột Mã lớp.`),
      ...students.map((name) => `Bỏ qua trang "${name}": có cột MSSV nên là danh sách sinh viên, không phải danh sách cố vấn học tập.`)],
    sheets: lists.map((list) => list.name).filter(Boolean), notes: [...said, ...notes],
  };
}

/** One sheet of cell texts (grid[0] is Excel row 1), as readAdvisorSheets reads it. */
export function readAdvisorGrid(grid: readonly (readonly string[])[], fileProblems: string[] = []): AdvisorSheet {
  return readAdvisorSheets([{ name: "", grid }], fileProblems);
}

/** "03/11/2026" for a date cell (exceljs gives Excel's dates at midnight UTC). */
const dateText = (date: Date) => `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;

/**
 * A cell as the text it shows (rich text, hyperlinks, formula results, a number's leading zeros), like the CTĐT reader,
 * and what makes it unreadable as typed text: a date, a formula Excel never computed, an error (CellIssue).
 */
function readCell(cell: import("exceljs").Cell): { text: string; issue?: CellIssue } {
  const v = cell.value;
  if (v === null || v === undefined) return { text: "" };
  if (typeof v === "number") {
    // MGV is a number cell; a format of zeros ("0000000000") shows its leading zeros.
    const format = typeof cell.numFmt === "string" ? cell.numFmt : "";
    return { text: Number.isInteger(v) && /^0+$/.test(format) ? String(v).padStart(format.length, "0") : String(v) };
  }
  if (typeof v === "object") {
    if (v instanceof Date) return { text: v.toISOString().slice(0, 10), issue: { kind: "date", detail: dateText(v) } };
    if ("error" in v) return { text: "", issue: { kind: "error", detail: String(v.error) } };
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as { result?: unknown }).result;
      if (result === undefined || result === null) return { text: "", issue: { kind: "formula" } };
      if (typeof result === "object" && "error" in (result as object)) return { text: "", issue: { kind: "error", detail: String((result as { error: unknown }).error) } };
      if (result instanceof Date) return { text: result.toISOString().slice(0, 10), issue: { kind: "date", detail: dateText(result) } };
      return { text: String(result) };
    }
    if ("richText" in v) return { text: v.richText.map((part) => part.text).join("") };
    if ("text" in v) return { text: String((v as { text: unknown }).text ?? "") };
  }
  return { text: String(v) };
}

/** The first bytes of an OLE file: an Excel 97–2003 workbook (.xls), or an .xlsx saved with a password (encrypted). */
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Reads the Khoa's workbook (.xlsx): its visible sheets with a list (readAdvisorSheets). Hidden sheets are never read. Only
 * rows with a value are read (borders drawn ahead of time far below the table are no rows), at most MAX_ROWS below the
 * header of a sheet; the hidden rows and the cells holding a date, a formula without a value or an error go with the grid.
 */
export async function readAdvisorWorkbook(buffer: Buffer): Promise<AdvisorSheet> {
  if (buffer.subarray(0, OLE.length).equals(OLE)) throw new AdvisorError("legacy_workbook", 400);
  try { checkArchive(buffer); } catch (error) {
    if (error instanceof CurriculumError) throw new AdvisorError(error.code === "workbook_too_large" ? "workbook_too_large" : "invalid_workbook", 400);
    throw error;
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as never); } catch { throw new AdvisorError("invalid_workbook", 400); }
  // A zip without a sheet (a Word document renamed .xlsx) is no workbook.
  if (!workbook.worksheets.length) throw new AdvisorError("invalid_workbook", 400);
  // Not even the first rows of a hidden sheet are looked at: the Khoa's own file hides one about students there.
  const visible = workbook.worksheets.filter((sheet) => !sheet.state || sheet.state === "visible");
  const hiddenSheets = workbook.worksheets.filter((sheet) => !visible.includes(sheet)).map((sheet) => sheet.name);
  if (!visible.length) {
    throw new AdvisorError("empty_workbook", 400, { message: "Mọi trang tính của tệp đang ẩn nên không đọc được: hiện trang tính có danh sách (Unhide) rồi chọn lại tệp." });
  }
  if (visible.every((sheet) => !sheet.actualRowCount)) {
    throw new AdvisorError("empty_workbook", 400, { message: "Tệp Excel trống: các trang tính đang hiện không có dữ liệu. Hãy điền danh sách theo tệp mẫu (bấm Tải file mẫu) rồi chọn lại tệp." });
  }
  /** The rows with a value, up to the last one (or the first `rows`): their texts, the cells with an issue and the hidden rows. */
  const gridOf = (from: import("exceljs").Worksheet, rows = Infinity): SheetGrid => {
    const width = Math.min(Math.max(from.columnCount, 1), MAX_COLUMNS);
    const grid: string[][] = [];
    const issues = new Map<string, CellIssue>();
    const hiddenRows: number[] = [];
    for (let number = 1; number <= Math.min(from.rowCount, rows); number++) {
      const row = from.findRow(number);
      if (!row?.hasValues) continue;
      const cells: string[] = [];
      for (let column = 1; column <= width; column++) {
        const { text, issue } = readCell(row.getCell(column));
        cells.push(text);
        if (issue) issues.set(`${number - 1}:${column - 1}`, issue);
      }
      grid[number - 1] = cells;
      if (row.hidden) hiddenRows.push(number);
    }
    return { name: from.name, grid: Array.from(grid, (cells) => cells ?? []), issues, hiddenRows };
  };
  // A sheet without a list header (the template's Hướng dẫn) is passed over after its top rows, which still say, when no
  // sheet holds a list, how close one came (readAdvisorSheets).
  const sheets = visible.map((sheet) => {
    const top = gridOf(sheet, HEADER_SEARCH_ROWS);
    const header = findHeader(top.grid);
    if (!header) return top;
    const below = sheet.actualRowCount - top.grid.slice(0, header.row + 1).filter((cells) => cells.some(Boolean)).length;
    if (below > MAX_ROWS) {
      throw new AdvisorError("too_many_rows", 400, { message: `Trang "${sheet.name}" có ${below.toLocaleString("vi-VN")} dòng dữ liệu, nhiều hơn giới hạn `
        + `${MAX_ROWS.toLocaleString("vi-VN")} dòng của một lần import. Xóa các dòng thừa hoặc chia danh sách thành nhiều tệp rồi import lần lượt.` });
    }
    return gridOf(sheet);
  });
  return readAdvisorSheets(sheets, [], hiddenSheets.length ? [{ tone: "info", text: `Không đọc ${hiddenSheets.length} trang tính đang ẩn.` }] : [],
    { hiddenSheets });
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
  sheet.getRow(6).values = [1, 1234567890, TEMPLATE_EXAMPLE.name, `${TEMPLATE_EXAMPLE.local}@${domain}`, TEMPLATE_EXAMPLE.classes, TEMPLATE_EXAMPLE.note];
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
