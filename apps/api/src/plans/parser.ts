import { Worker } from "node:worker_threads";
import { MIN_COHORT, isCourseCode, visibleSheets } from "../curricula/legacy.js";
import { fullMajorName } from "../curricula/majors.js";
import { checkArchive } from "../curricula/parser.js";
import { readLegacyPlan } from "./legacy.js";
import { PlanError, fold, reviewPlan, type PlanData } from "./model.js";

type Column = "semester" | "year" | "code" | "name" | "credits" | "lecture" | "practice" | "project" | "internship"
  | "type" | "prerequisite" | "prior" | "termCredits" | "notes";
const HOURS: Record<string, Column> = { lt: "lecture", th: "practice", da: "project", tt: "internship" };
/** A GDTC slot ("GDTC1", "GDTC 1"): the student picks the course, so it has no code of its own. */
const GDTC_SLOT = /^GDTC\s*\d$/i;
type CellText = (cell: import("exceljs").Cell) => string;

/**
 * The header of a 2025-template plan and its columns, found by their names (2026-10-26: the K31 HTTT plan has no
 * "Năm Thứ" column, so the code is in C instead of D). The template labels each term in column A ("HK251" and its
 * number); the older templates have YYS codes instead and keep their own reader.
 */
function planHeader(sheet: import("exceljs").Worksheet, value: CellText) {
  const width = Math.min(sheet.columnCount, 30);
  const label = (row: number, column: number) => fold(value(sheet.getCell(row, column)));
  for (let row = 1; row <= Math.min(40, sheet.rowCount); row++) {
    let code = 0;
    for (let column = 1; column < width && !code; column++)
      if (label(row, column) === "ma hoc phan" && label(row, column + 1).includes("ten hoc phan")) code = column;
    if (!code) continue;
    if (!Array.from({ length: 10 }, (_, n) => value(sheet.getCell(row + 1 + n, 1)).trim()).some((text) => /^HK\d{3}/i.test(text))) continue;
    const columns: Partial<Record<Column, number>> = { code, name: code + 1 };
    for (let column = 1; column <= width; column++) {
      if (column === code || column === code + 1) continue;
      // "LT", "TH", "ĐA", "TT" under "Số tiết/giờ"; the "TT" (số thứ tự) header merged over both rows is no hour column.
      const top = label(row, column), sub = label(row + 1, column), hours = sub !== top ? HOURS[sub.replace(/\s/g, "")] : undefined;
      if (hours && !columns[hours]) columns[hours] = column;
      else if (!top) continue;
      else if (top === "phan bo hoc ky") columns.semester = column;
      else if (top === "nam thu") columns.year = column;
      else if (!columns.credits && top === "so tin chi") columns.credits = column;
      else if (!columns.type && top.includes("bat buoc")) columns.type = column;
      else if (!columns.prerequisite && top.includes("tien quyet")) columns.prerequisite = column;
      else if (!columns.prior && top.includes("hoc truoc")) columns.prior = column;
      else if (!columns.termCredits && /^so tc\b/.test(top)) columns.termCredits = column;
      else if (!columns.notes && top.startsWith("ghi chu")) columns.notes = column;
    }
    return { row, columns };
  }
  return null;
}

/** Choice counts ("chọn 1 trong 3") are kept as written: a different number of rows is only a warning. */
function finish(data: PlanData) {
  for (const s of data.sections) {
    const count = s.label.match(/trong\s*(\d+)/i)?.[1];
    const actual = data.items.filter((i) => i.sectionId === s.id).length;
    if (count && actual !== Number(count))
      data.sourceWarnings.push({
        row: s.sourceRow,
        message: `Nhóm “${s.label}” có ${actual} dòng môn, khác số ${count} ghi trong tiêu đề.`,
      });
  }
  return reviewPlan(data);
}

export async function readWorkbook(buffer: Buffer): Promise<PlanData> {
  checkArchive(buffer);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const value = (cell: import("exceljs").Cell): string => {
    const v = cell.value;
    if (v == null) return "";
    if (typeof v === "object") {
      if ("error" in v) return String(v.error);
      if ("formula" in v || "sharedFormula" in v)
        return v.result == null
          ? ""
          : typeof v.result === "object" && "error" in v.result
            ? String(v.result.error)
            : String(v.result);
      if ("richText" in v) return v.richText.map((x) => x.text).join("");
      if ("text" in v) return v.text;
    }
    return String(v);
  };
  if (workbook.worksheets.length > 20)
    throw new PlanError("workbook_too_large");
  const candidates: { sheet: import("exceljs").Worksheet; header: number; columns: Partial<Record<Column, number>> }[] = [];
  const visible = visibleSheets(workbook);
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 2000 || sheet.columnCount > 150)
      throw new PlanError("workbook_too_large");
    // Hidden sheets hold other templates (a K28 curriculum workbook hides a K27 plan).
    if (!visible.includes(sheet)) continue;
    const found = planHeader(sheet, value);
    if (found) candidates.push({ sheet, header: found.row, columns: found.columns });
  }
  // No 2025-template sheet: an older template (K26–K28), read by its header names.
  if (!candidates.length) {
    const legacy = readLegacyPlan(workbook, value);
    if (legacy) return finish(legacy);
  }
  if (candidates.length !== 1) throw new PlanError("unsupported_plan_template");
  const { sheet, header, columns } = candidates[0]!;
  const above = Array.from({ length: header - 1 }, (_, r) => r + 1);
  const title = above.flatMap((r) => Array.from({ length: Math.min(sheet.columnCount, 20) }, (_, c) => value(sheet.getCell(r, c + 1)).trim()))
    .find((t) => /KẾ HOẠCH.*KHÓA\s*\d+/i.test(t)) ?? "";
  // "… NGÀNH CÔNG NGHỆ THÔNG TIN - KHÓA 31", or the major after the cohort ("… THỰC TẾ - KHÓA 31 - MMT & TTDL", 2026-10-26).
  const before = title.match(/KẾ HOẠCH.*?NGÀNH\s+(.+?)\s*[-–]?\s*KHÓA\s*(\d+)/i);
  const after = before ? null : title.match(/KẾ HOẠCH.*?KHÓA\s*(\d+)\s*[-–]\s*(?:NGÀNH\s+)?(.+?)\s*$/i);
  const cohort = Number(before?.[2] ?? after?.[1]);
  const major = (before?.[1] ?? after?.[2] ?? "").replace(/[-–]\s*$/, "").trim();
  if (!major || !(cohort >= MIN_COHORT && cohort <= 99))
    throw new PlanError("missing_plan_metadata");
  const data: PlanData = {
    schemaVersion: 1,
    name: title,
    major: fullMajorName(major),
    cohortCode: `K${cohort}`,
    admissionYear: cohort + 1994,
    totalCredits: null,
    notes: "",
    items: [],
    terms: [],
    sections: [],
    sourceWarnings: [],
    warnings: [],
    curriculum: null,
  };
  const warn = (row: number | null, message: string) =>
    data.sourceWarnings.push({ row, message });
  const number = (v: string, row: number, label: string): number | null => {
    if (!v) return null;
    if (!/^\d+(?:[.,]\d+)?$/.test(v)) {
      warn(row, `${label}: giá trị chưa xác định (${v}).`);
      return null;
    }
    return Number(v.replace(",", "."));
  };
  // The program total sits above the header in the term-credit column ("Số TC/ HK"): on the title row (CNTT) or on
  // the row below it (MMT & TTDL).
  const totalColumn = columns.termCredits ?? 14;
  const total = above.map((r) => ({ r, text: value(sheet.getCell(r, totalColumn)).trim() })).find(({ text }) => /^\d+(?:[.,]\d+)?$/.test(text));
  data.totalCredits = total ? number(total.text, total.r, "Tổng tín chỉ") : null;
  if (data.totalCredits !== null && data.totalCredits > 400)
    throw new PlanError("invalid_plan_row");
  const lastColumn = Math.max(15, ...Object.values(columns));
  const letter = (column: number) => String.fromCharCode(64 + column);
  let termCode = "",
    sectionId = "";
  let external = false;
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const cells: Record<string, string> = Object.fromEntries(
      Array.from({ length: lastColumn }, (_, c) => [
        letter(c + 1),
        value(sheet.getCell(r, c + 1))
          .replace(/\u00a0/g, " ")
          .trim(),
      ]),
    );
    const get = (column: Column) => (columns[column] ? cells[letter(columns[column]!)]! : "");
    const joined = Object.values(cells).join(" ");
    if (/TP\.\s*Hồ Chí Minh|TRƯỞNG KHOA/i.test(joined)) {
      if (get("code"))
        warn(r, "Bỏ qua mã ghi ngoài vùng kế hoạch tại phần ký tên.");
      break;
    }
    if (fold(get("code")) === "ma hoc phan") continue;
    for (let c = columns.name!; c <= lastColumn; c++) {
      const v = sheet.getCell(r, c).value;
      if (
        v &&
        typeof v === "object" &&
        "formula" in v &&
        /\[\d+\]/.test(v.formula)
      )
        external = true;
    }
    if (/HK\d/i.test(cells.A!) && !/^HK\d{2}[123](?:\s|$)/i.test(cells.A!))
      throw new PlanError("invalid_plan_row", 422, [
        `${sheet.name}!${r}: mã học kỳ không hợp lệ.`,
      ]);
    let code = get("code"), name = get("name");
    // A GDTC slot written in the code column ("GDTC1", K32 HTTT) is the slot "GDTC1" of the name column (K31 CNTT).
    if (GDTC_SLOT.test(code) && !name) [code, name] = ["", code];
    const semesterText = get("semester"), yearText = get("year");
    if (
      (code || name) &&
      ((semesterText && (!/^\d{1,2}$/.test(semesterText) || Number(semesterText) < 1)) ||
        (yearText && (!/^\d{1,2}$/.test(yearText) || Number(yearText) < 1)))
    )
      throw new PlanError("invalid_plan_row", 422, [
        `${sheet.name}!${r}: học kỳ và năm học phải là số.`,
      ]);
    const explicit = cells.A!.match(/HK\d{2}[123]/i)?.[0]?.toUpperCase();
    // "Phân bổ học kỳ" is the semester of the year (1–3, CNTT and K31 HTTT) or the term's number in the cohort (K32 HTTT:
    // HK271 is 4); only the first gives a term on its own.
    const allocated = /^\d{1,2}$/.test(semesterText) ? Number(semesterText) : null;
    const b = allocated !== null && allocated <= 3 ? allocated : null;
    const y = /^\d{1,2}$/.test(yearText) ? Number(yearText) : null;
    // A small number of source rows have an unmerged/blank term label. B/C
    // explicitly identify their year and semester, so retain that provenance.
    const derived =
      !explicit && b && y
        ? `HK${String((data.admissionYear + y - 1) % 100).padStart(2, "0")}${b}`
        : null;
    const next = explicit ?? derived ?? termCode;
    if (next !== termCode) {
      termCode = next;
      sectionId = "";
    }
    if (!termCode) {
      if (code || name)
        throw new PlanError("invalid_plan_row", 422, [
          `${sheet.name}!${r}: chưa xác định được học kỳ của môn.`,
        ]);
      continue;
    }
    const semester = Number(termCode.at(-1)),
      studyYear = 2000 + Number(termCode.slice(2, 4)) - data.admissionYear + 1;
    if (studyYear < 1 || studyYear > 10)
      throw new PlanError("invalid_plan_row", 422, [
        `${sheet.name}!${r}: học kỳ không thuộc khóa.`,
      ]);
    // The term label of column A decides; a contradicting allocation (K31 MMT&TTDL prints HK273 with year 4) is kept
    // for review.
    if ((allocated !== null && allocated !== semester && allocated !== (studyYear - 1) * 3 + semester) || (y && y !== studyYear))
      warn(r, `${name || code}: năm/học kỳ ghi ở cột phân bổ khác ${termCode}; giữ theo ${termCode}.`);
    let term = data.terms.find((t) => t.code === termCode);
    if (!term) {
      term = { code: termCode, semester, studyYear, sourceCredits: null };
      data.terms.push(term);
    }
    const termCredits = columns.termCredits ? cells[letter(columns.termCredits)]! : "";
    const termCell = columns.termCredits ? sheet.getCell(r, columns.termCredits) : null;
    if (termCredits && !termCell!.isMerged) {
      const credits = number(termCredits, r, "Tín chỉ học kỳ");
      if (credits !== null) term.sourceCredits = credits;
    } else if (termCredits && termCell!.master.address === termCell!.address)
      term.sourceCredits = number(termCredits, r, "Tín chỉ học kỳ");
    const credits = get("credits");
    // A row without a course code and credits names the courses below it ("Chọn 1 trong 4 môn sau", "Chuyên ngành IoT"):
    // in the year column (K29–K31 CNTT), or in the code or name column (2026-10-26 workbooks).
    const label = yearText && !/^\d+$/.test(yearText) && !code && !name ? yearText
      : !credits && !isCourseCode(code) && !GDTC_SLOT.test(name) && (code || name) ? [code, name].filter(Boolean).join(" ") : "";
    if (label) {
      const folded = fold(label);
      sectionId = `section-${r}`;
      data.sections.push({
        id: sectionId,
        termCode,
        label,
        // "Nhóm tự chọn Chuyên ngành IoTs: Chọn 1 trong các HP sau" is a choice inside a specialty.
        kind: /chon\s*\d*\s*trong/.test(folded)
          ? "choice"
          : /chuyen nganh/.test(folded)
            ? "specialty"
            : /chon/.test(folded)
              ? "choice"
              : "note",
        sourceRow: r,
      });
      continue;
    }
    if (!code && !name) continue;
    if (!name || /^#/.test(name))
      throw new PlanError("invalid_plan_row", 422, [
        `${sheet.name}!${r}: thiếu tên môn hoặc công thức chưa tính.`,
      ]);
    // A plan without a "Năm Thứ" column (K31 HTTT) takes the year from the term label.
    if (!explicit || allocated === null || (columns.year && !y))
      warn(
        r,
        `${name}: xác định năm ${studyYear}, học kỳ ${semester} từ vùng ${termCode}; có ô phân bổ gốc để trống.`,
      );
    const item = {
      id: `row-${r}`,
      position: data.items.length + 1,
      code,
      name,
      credits: number(credits, r, "Tín chỉ"),
      type: get("type"),
      termCode,
      semester,
      studyYear,
      sectionId,
      prerequisite: get("prerequisite"),
      prior: get("prior"),
      notes: get("notes"),
      hours: {
        lecture: number(get("lecture"), r, "LT"),
        practice: number(get("practice"), r, "TH"),
        project: number(get("project"), r, "ĐA"),
        internship: number(get("internship"), r, "TT"),
      },
      sourceRow: r,
      sourceSheet: sheet.name,
      sourceCells: cells,
    };
    data.items.push(item);
  }
  if (!data.items.length) throw new PlanError("no_courses");
  if (external)
    warn(
      null,
      "Tệp có công thức tham chiếu workbook ngoài. Dùng kết quả đã lưu trong Excel; không tự tải hoặc tính lại nguồn ngoài. Ô trống giữ là chưa xác định.",
    );
  // Preserve rule text; do not silently interpret inconsistent choice counts.
  return finish(data);
}
let busy = false;
export async function parsePlan(buffer: Buffer): Promise<PlanData> {
  checkArchive(buffer);
  if (busy) throw new PlanError("import_busy", 429);
  busy = true;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("../../workers/curriculum.mjs", import.meta.url),
        {
          workerData: { buffer, moduleUrl: import.meta.url },
          resourceLimits: { maxOldGenerationSizeMb: 192 },
          execArgv: [],
        },
      );
      let done = false;
      const finish = (error: unknown, data?: PlanData) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error);
        else resolve(data!);
      };
      const timer = setTimeout(
        () => finish(new PlanError("import_timeout")),
        25000,
      );
      worker.once("message", (m) =>
        finish(m.error ? new PlanError(m.error, 422, m.details) : null, m.data),
      );
      worker.once("error", () => finish(new PlanError("invalid_workbook")));
      worker.once("exit", () => {
        if (!done) finish(new PlanError("invalid_workbook"));
      });
    });
  } finally {
    busy = false;
  }
}
