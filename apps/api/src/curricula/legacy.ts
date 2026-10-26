import type { Cell, Workbook, Worksheet } from "exceljs";
import { fullMajorName } from "./majors.js";
import {
  CurriculumError,
  courseSchema,
  type CurriculumCourse,
  type CurriculumData,
} from "./model.js";

/**
 * Older Faculty templates (K26–K28; user, 2026-10-23: "những khóa cũ thì code hiện tại nó chưa có
 * định dạng đó"). A curriculum is a "PHÂN BỐ KIẾN THỨC TRONG CTĐT KHÓA 28 - NGÀNH …" sheet and a plan a
 * "KẾ HOẠCH ĐÀO TẠO (THỰC TẾ) - KHÓA 26 IT" sheet. Their columns move from cohort to cohort, the header
 * spans one or two rows (LT/TH/ĐA/TT under "Số tiết/giờ"), blocks and specialties are heading rows
 * instead of columns, and a term is a YYS code ("221" = school year 2022–2023, semester 1). Columns
 * are therefore found by their header text. The 2025 template (K29–K31) keeps its own reader.
 */
export type CellText = (cell: Cell) => string;
/** Oldest cohort accepted by both importers (K26–K28 are in use; the 2025 template started at K27). */
export const MIN_COHORT = 20;

export const clean = (s: string) => s.normalize("NFC").replace(/ /g, " ").replace(/\s+/g, " ").trim();
export const fold = (s: string) => clean(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
/** Hidden sheets hold older or other-major templates (a K28 workbook hides a Ngôn ngữ Anh framework). */
export const visibleSheets = (workbook: Workbook) => workbook.worksheets.filter((sheet) => (sheet.state ?? "visible") === "visible");
/** A course code of any template ("71ITBS10203", "DCT0080"); headings ("2.3.1 …", "GDQP-GDTC") are not. */
export const isCourseCode = (s: string) => /^[A-Z0-9][A-Z0-9_.-]{3,}$/i.test(s) && /\d/.test(s) && /[A-Z]/i.test(s);
/** "BB/KTL" (bắt buộc không tích lũy) is written "BBKTL" in the 2025 template. */
export const courseType = (s: string) => clean(s).replace(/^BB\s*\/\s*KTL$/i, "BBKTL");
/** A YYS term code ("221") as semester and study year of the cohort; null when it is not one. */
export function yysTerm(value: string, admissionYear: number): { code: string; semester: number; studyYear: number } | null {
  const match = /^(\d{2})([123])$/.exec(clean(value));
  if (!match) return null;
  const studyYear = 2000 + Number(match[1]) - admissionYear + 1;
  return studyYear >= 1 && studyYear <= 10 ? { code: `HK${match[1]}${match[2]}`, semester: Number(match[2]), studyYear } : null;
}

/**
 * A term numbered from the cohort's first one, summer terms included: the "Học kỳ triển khai" of the K29 HTTT, MMT&TTDL
 * and CNTT frameworks (2026-10-26) runs 1–3 for HK1, HK2 and HK3 of year 1, 4–6 for year 2 … (its hidden plan sheet
 * pairs 231 with 1, 233 with 3, 241 with 4 and 261 with 10).
 */
export function indexTerm(value: string): { semester: number; studyYear: number } | null {
  const match = /^(\d{1,2})$/.exec(clean(value));
  if (!match) return null;
  const n = Number(match[1]), studyYear = Math.floor((n - 1) / 3) + 1;
  return n >= 1 && studyYear <= 10 ? { semester: ((n - 1) % 3) + 1, studyYear } : null;
}

export type Role = "code" | "name" | "englishName" | "credits" | "lecture" | "practice" | "project" | "internship"
  | "type" | "prerequisite" | "prior" | "notes" | "term" | "termIndex";
export type LegacyHeader = {
  row: number;
  /** First row after the one or two header rows. */
  dataRow: number;
  columns: Partial<Record<Role, number>>;
  /** "Học kỳ" / "Phân bổ học kỳ" columns left of the code: only a plan has them. */
  termColumns: number[];
};
const CODE_LABELS = ["ma hoc phan moi", "ma hoc phan", "ma mon hoc"];
const HOURS: Record<string, Role> = { lt: "lecture", th: "practice", da: "project", tt: "internship" };

/** The header of an older template: a code column, the name right after it and a credits column. */
export function findLegacyHeader(sheet: Worksheet, text: CellText): LegacyHeader | null {
  const width = Math.min(sheet.columnCount, 40);
  const label = (row: number, column: number) => fold(text(sheet.getCell(row, column)));
  for (let row = 1; row <= Math.min(40, sheet.rowCount); row++) {
    let code = 0;
    for (let column = 1; column <= width && !code; column++) if (CODE_LABELS.includes(label(row, column))) code = column;
    if (!code) continue;
    const name = [1, 2].map((step) => code + step).find((column) => /^ten (hoc phan|mon hoc)/.test(label(row, column)) && !label(row, column).includes("tieng anh"));
    if (!name) continue;
    // A second header row repeats the merged labels and names the hour columns.
    const two = label(row + 1, code) === label(row, code);
    const columns: Partial<Record<Role, number>> = { code, name };
    const termColumns: number[] = [];
    for (let column = 1; column <= width; column++) {
      const top = label(row, column), sub = two ? label(row + 1, column) : top;
      if (column < code) {
        if (/^(phan bo )?hoc ky$/.test(top)) termColumns.push(column);
        continue;
      }
      if (column === code || column === name || (!top && !sub)) continue;
      const hours = HOURS[sub.replace(/\s/g, "")];
      if (!columns.englishName && top.includes("tieng anh")) columns.englishName = column;
      else if (!columns.credits && /^(so tin chi|tc)$/.test(top)) columns.credits = column;
      else if (hours && columns.credits && !columns[hours]) columns[hours] = column;
      else if (!columns.type && (top.includes("bat buoc") || top.replace(/\s/g, "") === "bb/tc")) columns.type = column;
      else if (!columns.prerequisite && top.includes("tien quyet")) columns.prerequisite = column;
      else if (!columns.prior && top.includes("hoc truoc")) columns.prior = column;
      else if (!columns.notes && top.startsWith("ghi chu")) columns.notes = column;
      else if (!columns.term && top.includes("hk to chuc")) columns.term = column;
      // "Học kỳ triển khai" (K29 HTTT), "HK triển khai" (K29 CNTT), "HK GD" (K29 MMT&TTDL).
      else if (!columns.termIndex && /^(hoc ky|hk) (trien khai|gd|giang day)$/.test(top)) columns.termIndex = column;
    }
    if (columns.credits) return { row, dataRow: row + (two ? 2 : 1), columns, termColumns };
  }
  return null;
}

/** The one visible sheet of the kind asked for (a plan has term columns left of the code, a curriculum none). */
export function legacySheet(workbook: Workbook, text: CellText, kind: "curriculum" | "plan") {
  const found = visibleSheets(workbook).flatMap((sheet) => {
    const header = findLegacyHeader(sheet, text);
    return header && (kind === "plan") === header.termColumns.length > 0 ? [{ sheet, header }] : [];
  });
  return found.length === 1 ? found[0]! : null;
}

/**
 * Title, cohort, major and total credits from the rows above the header. The major comes from
 * "NGÀNH …"; titles without it name the program "CNTT" or "IT" in the title or sheet name. The total is
 * the one figure of a whole program (60–400) written above the header.
 */
export function legacyMetadata(sheet: Worksheet, text: CellText, headerRow: number) {
  const texts: string[] = [], numbers: number[] = [];
  for (let row = 1; row < headerRow; row++)
    for (let column = 1; column <= Math.min(sheet.columnCount, 30); column++) {
      const value = clean(text(sheet.getCell(row, column)));
      if (/^\d+(\.\d+)?$/.test(value)) numbers.push(Number(value));
      else if (value && !texts.includes(value)) texts.push(value);
    }
  const cohortOf = (value: string) => fold(value).match(/khoa\s*(\d{2})(?!\d)/)?.[1] ?? fold(value).match(/(?:^|[^a-z0-9])k(\d{2})(?!\d)/)?.[1];
  const title = texts.find((value) => cohortOf(value)) ?? "";
  const cohort = Number(cohortOf(title) ?? cohortOf(sheet.name) ?? NaN);
  const named = title.match(/NG(?:À|A)NH\s+(.+?)(?:\s*[-–]\s*KH(?:Ó|O)(?:A|Á)\b.*|\s+KH(?:Ó|O)(?:A|Á)\b.*)?$/iu)?.[1];
  const major = named ? clean(named).toUpperCase()
    : /(?:^|[^\p{L}])(?:CNTT|IT)(?:[^\p{L}]|$)/u.test(`${title} ${sheet.name}`) ? "CÔNG NGHỆ THÔNG TIN" : "";
  const totals = numbers.filter((value) => value >= 60 && value <= 400);
  if (!title || !Number.isInteger(cohort) || cohort < MIN_COHORT || cohort > 99 || !major) return null;
  return { title, cohort, major, totalCredits: totals.length ? Math.max(...totals) : null };
}

/** Values of columns A… of a row, like the 2025 reader keeps them for review. */
export function rowCells(sheet: Worksheet, text: CellText, row: number) {
  const cells: Record<string, string> = {};
  for (let column = 1; column <= Math.min(Math.max(sheet.columnCount, 19), 26); column++)
    cells[String.fromCharCode(64 + column)] = clean(text(sheet.getCell(row, column)));
  return cells;
}

/** The text of a heading row: its cells before `end`, numbering ("2.3.1", "7.2") and repeats of merged cells left out. */
export function headingText(cells: Record<string, string>, end: number) {
  const parts: string[] = [];
  for (let column = 1; column < end; column++) {
    const value = cells[String.fromCharCode(64 + column)] ?? "";
    if (value && !/^[\d.]+$/.test(value) && !parts.includes(value)) parts.push(value);
  }
  return parts.join(" ");
}

export const BLOCKS = {
  general: "Đại cương",
  physical: "Giáo dục thể chất và giáo dục quốc phòng",
  groupBasis: "Kiến thức cơ sở khối ngành",
  basis: "Kiến thức cơ sở ngành",
  specialty: "Kiến thức chuyên ngành hoặc chuyên sâu",
  thesis: "Khóa luận/đồ án tốt nghiệp; hoặc học phần thay thế KL/ĐA TN",
} as const;

/**
 * Block and specialty after a heading row, with the 2025 template's values so the competency module
 * reads them the same (GDTC/GDQP are condition-only, "Công nghệ Phần mềm" is CNPM …). Notes inside a
 * section ("Kiến thức chuyên ngành bắt buộc: …", "(dành cho …)") change nothing.
 */
export function afterHeading(label: string, state: { block: string; specialty: string }) {
  const f = fold(label).replace(/^[\d.]+\s*/, "");
  const named = label.match(/(?:Chuyên ngành|Định hướng)\s+(.+?)(?:\s*[:(]|\s+dành cho\b|$)/iu)?.[1];
  if (/gdqp|gdtc|giao duc quoc phong|giao duc the chat/.test(f)) return { block: BLOCKS.physical, specialty: "" };
  if (/^nhom cac hoc phan tot nghiep thay the/.test(f)) return { block: BLOCKS.thesis, specialty: "Học phần thay thế Đồ án tốt nghiệp" };
  if (/^(thuc tap tot nghiep|khoa luan|do an tot nghiep|hoc phan tot nghiep)/.test(f)) return { block: BLOCKS.thesis, specialty: "" };
  if (/^(chuyen nganh|dinh huong)\s+(?!bat buoc|hoac\b)/.test(f) && named) return { block: BLOCKS.specialty, specialty: clean(named) };
  if (/^cac (mon|hoc phan|hp) tu chon chuyen nganh/.test(f)) return { block: BLOCKS.specialty, specialty: "Tự chọn Chuyên ngành" };
  // K29 MMT&TTDL (2026-10-26): "Các môn Bắt buộc - Chuyên ngành IoT (Khối kiến thức chuyên ngành)" and the electives of the
  // whole block, "Các môn Tự chọn (Khối kiến thức Chuyên ngành)".
  if (/^cac (mon|hoc phan|hp) bat buoc\b.*\bchuyen nganh\s/.test(f) && named && !/^(bat buoc|tu chon|hoac)\b/.test(fold(named)))
    return { block: BLOCKS.specialty, specialty: clean(named) };
  if (/^cac (mon|hoc phan|hp) tu chon\b.*\bchuyen nganh\b/.test(f)) return { block: BLOCKS.specialty, specialty: "Tự chọn Chuyên ngành" };
  if (/^kien thuc chuyen nganh(?!\s*bat buoc)/.test(f)) return { block: BLOCKS.specialty, specialty: "" };
  if (/^kien thuc co so (nhom|khoi) nganh/.test(f)) return { block: BLOCKS.groupBasis, specialty: "" };
  if (/^kien thuc co so nganh/.test(f)) return { block: BLOCKS.basis, specialty: "" };
  if (/^kien thuc giao duc dai cuong/.test(f)) return { block: BLOCKS.general, specialty: "" };
  if (/^kien thuc giao duc chuyen nghiep/.test(f)) return { block: "", specialty: "" };
  return state;
}

const number = (value: string) => (/^\d+(\.\d+)?$/.test(value) ? Number(value) : null);
const endOfTable = (label: string) => /^ghi chu\b/.test(fold(label)) || /TP\.\s*Hồ Chí Minh|TRƯỞNG KHOA/i.test(label);

/** The fill colour of a cell ("theme:5:0.8", "argb:FFFFFF00"), or "" when it has none. */
function fillColour(cell: Cell): string {
  const fill = cell.fill;
  if (!fill || fill.type !== "pattern" || fill.pattern === "none" || !fill.fgColor) return "";
  const { argb, theme, tint } = fill.fgColor as { argb?: string; theme?: number; tint?: number };
  if (argb) return /^(00000000|FFFFFFFF)$/i.test(argb) ? "" : `argb:${argb.toUpperCase()}`;
  return theme === undefined ? "" : `theme:${theme}:${Math.round((tint ?? 0) * 100) / 100}`;
}

/**
 * The specialty course lists written in a cell, as the K29 frameworks do in the prerequisites of their graduation project
 * ("Chuyên ngành HTTT Chuyển đổi số: ⏎ Hoạch định nguồn lực doanh nghiệp …", "CN IoT: ⏎ - Nhập môn hệ thống nhúng …"):
 * folded course name → specialty.
 */
export function specialtyLists(texts: readonly string[]): Map<string, string> {
  const listed = new Map<string, string>();
  for (const text of texts) {
    let specialty = "";
    for (const raw of text.split(/\r?\n/)) {
      const line = clean(raw).replace(/^[-–•+]\s*/, "");
      const heading = /^(?:chuyên ngành|cn)\s+(.+?)\s*:\s*(.*)$/iu.exec(line);
      if (heading) {
        specialty = clean(heading[1]!);
        if (heading[2]) listed.set(fold(heading[2]), specialty);
      } else if (specialty && line) listed.set(fold(line), specialty);
    }
  }
  return listed;
}

/**
 * The K29 frameworks of the other majors (user, 2026-10-26: "có 2 phong cách ghi môn này thuộc chuyên ngành nào") mark a
 * specialty by a heading row (MMT&TTDL) or only by the colour of its rows (HTTT, CNTT). A colour is named by the specialty of
 * its headed or listed courses: at least two of them, none of another specialty. It names the run of rows of that colour
 * holding such a course, and the specialty electives of that colour (MMT&TTDL colours its IoT and An ninh Mạng electives).
 * The same colour also paints unrelated rows (HTTT: general education and Chuyển đổi số), hence runs, not the whole sheet.
 * Returns the number of courses named per specialty.
 */
function nameSpecialtiesByColour(courses: CurriculumCourse[], colours: readonly string[], listed: ReadonlyMap<string, string>) {
  const specific = (course: CurriculumCourse) => course.block === BLOCKS.specialty && course.specialty && course.specialty !== "Tự chọn Chuyên ngành";
  const vote = (course: CurriculumCourse) => (specific(course) ? course.specialty : listed.get(fold(course.name)) ?? "");
  const votes = new Map<string, Map<string, number>>();
  courses.forEach((course, index) => {
    const specialty = vote(course), colour = colours[index]!;
    if (!specialty || !colour) return;
    const counts = votes.get(colour) ?? new Map<string, number>();
    counts.set(fold(specialty), (counts.get(fold(specialty)) ?? 0) + 1);
    votes.set(colour, counts);
  });
  const names = new Map<string, string>();
  for (const [colour, counts] of votes) {
    const [only] = [...counts];
    if (counts.size !== 1 || only![1] < 2) continue;
    const course = courses.find((item, index) => colours[index] === colour && fold(vote(item)) === only![0])!;
    names.set(colour, vote(course));
  }
  const named = new Map<string, number>();
  const setSpecialty = (course: CurriculumCourse, specialty: string) => {
    if (specific(course)) return;
    course.block = BLOCKS.specialty;
    course.specialty = specialty;
    named.set(specialty, (named.get(specialty) ?? 0) + 1);
  };
  for (let start = 0; start < courses.length;) {
    let end = start;
    while (end + 1 < courses.length && colours[end + 1] === colours[start] && courses[end + 1]!.groupId === courses[start]!.groupId) end++;
    const name = names.get(colours[start]!);
    if (name && courses.slice(start, end + 1).some((course) => fold(vote(course)) === fold(name)))
      for (const course of courses.slice(start, end + 1)) setSpecialty(course, name);
    start = end + 1;
  }
  courses.forEach((course, index) => {
    const name = names.get(colours[index]!);
    if (name && course.block === BLOCKS.specialty && course.specialty === "Tự chọn Chuyên ngành") setSpecialty(course, name);
  });
  return named;
}

/** A curriculum of an older template, or null when the workbook has none (then it is no known template). */
export function readLegacyCurriculum(workbook: Workbook, text: CellText): CurriculumData | null {
  const found = legacySheet(workbook, text, "curriculum");
  if (!found) return null;
  const { sheet, header } = found;
  const meta = legacyMetadata(sheet, text, header.row);
  if (!meta || meta.totalCredits === null) throw new CurriculumError("missing_curriculum_metadata");
  const { columns } = header;
  const admissionYear = 1994 + meta.cohort;
  const major = fullMajorName(meta.major);
  const data: CurriculumData = {
    schemaVersion: 1,
    name: `KHUNG CHƯƠNG TRÌNH ĐÀO TẠO NGÀNH ${major} KHÓA ${meta.cohort}`,
    major,
    cohortCode: `K${meta.cohort}`,
    admissionYear,
    totalCredits: meta.totalCredits,
    notes: `Nhập từ mẫu khung CTĐT cũ, trang "${sheet.name}": ${meta.title}`,
    courses: [],
    groups: [],
    electives: [],
    relations: [],
    warnings: [],
    sourceWarnings: [{
      row: null,
      message: "Mẫu khung CTĐT cũ: khối kiến thức và chuyên ngành lấy theo các dòng tiêu đề nhóm, năm và học kỳ lấy từ cột HK tổ chức; mẫu không có bộ môn phụ trách. Hãy rà soát trước khi lưu.",
    }],
  };
  if (columns.termIndex)
    data.sourceWarnings.push({
      row: null,
      message: "Cột Học kỳ triển khai ghi số thứ tự học kỳ của khóa (1–3: HK1, HK2, HK hè năm thứ nhất; 4–6: năm thứ hai …); năm và học kỳ được tính theo thứ tự đó.",
    });
  let groupId = "", state = { block: "", specialty: "" };
  const colours: string[] = [], texts: string[] = [];
  for (let row = header.dataRow; row <= sheet.rowCount; row++) {
    const cells = rowCells(sheet, text, row);
    const get = (role: Role) => (columns[role] ? cells[String.fromCharCode(64 + columns[role]!)] ?? "" : "");
    for (const [column, value] of Object.entries(cells))
      if (value.startsWith("#"))
        data.sourceWarnings.push({ row, message: `Ô ${column}${row} có lỗi ${value}; giá trị không được sử dụng.` });
    const code = get("code"), name = get("name");
    if (!isCourseCode(code) || !name) {
      const label = headingText(cells, columns.credits!);
      if (!label) continue;
      if (endOfTable(label)) break;
      state = afterHeading(label, state);
      groupId = `row-${row}`;
      data.groups.push({ id: groupId, label, credits: number(get("credits")), sourceRow: row });
      continue;
    }
    const credits = number(get("credits"));
    if (credits === null || credits > 30) throw new CurriculumError("invalid_course_credits", 422, [code]);
    const type = courseType(get("type"));
    if (!/^(|BB(?:KTL)?|TC\d*(?:\s*\(.*\))?)$/.test(type)) throw new CurriculumError("invalid_course_type", 422, [code]);
    const term = yysTerm(get("term"), admissionYear) ?? indexTerm(get("termIndex"));
    // A mandatory course after the electives of a specialty block, without a heading of its own (the internship and the
    // graduation project of K29 MMT&TTDL), is no elective of that block.
    const place = state.specialty === "Tự chọn Chuyên ngành" && type.startsWith("BB")
      ? { block: /^(do an (thuc tap|tot nghiep)|khoa luan|thuc tap tot nghiep)\b/.test(fold(name)) ? BLOCKS.thesis : "", specialty: "" }
      : state;
    const course: CurriculumCourse = {
      position: data.courses.length + 1,
      code: code.toUpperCase(),
      name,
      englishName: get("englishName"),
      credits,
      type,
      block: place.block,
      specialty: place.specialty,
      prerequisite: get("prerequisite"),
      prior: get("prior"),
      notes: get("notes"),
      department: "",
      departmentCode: "",
      semester: term?.semester ?? null,
      studyYear: term?.studyYear ?? null,
      hours: { lecture: number(get("lecture")), practice: number(get("practice")), project: number(get("project")), internship: number(get("internship")) },
      groupId,
      sourceRow: row,
      sourceSheet: sheet.name,
      sourceCells: cells,
    };
    if (!courseSchema.safeParse(course).success) throw new CurriculumError("invalid_course_row", 422, [`${sheet.name}!${row}: ${code}`]);
    data.courses.push(course);
    colours.push(fillColour(sheet.getCell(row, columns.code!)));
    // As written, line breaks kept: the specialty lists put one course on a line.
    for (let column = 1; column <= Math.min(sheet.columnCount, 26); column++) texts.push(text(sheet.getCell(row, column)));
  }
  if (!data.courses.length) throw new CurriculumError("no_courses");
  // The K29 frameworks sent for the other majors (the template with a term number) mark specialties by colour too.
  if (columns.termIndex) {
    const named = nameSpecialtiesByColour(data.courses, colours, specialtyLists(texts));
    if (named.size)
      data.sourceWarnings.push({
        row: null,
        message: `Chuyên ngành của một số môn lấy theo màu tô trong tệp (${[...named].map(([name, count]) => `${name}: ${count} môn`).join(", ")}), đặt tên theo dòng tiêu đề chuyên ngành hoặc danh sách môn từng chuyên ngành ghi trong tệp. Hãy rà soát.`,
      });
  }
  return data;
}
