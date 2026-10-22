import type { Workbook } from "exceljs";
import {
  clean,
  courseType,
  fold,
  headingText,
  isCourseCode,
  legacyMetadata,
  legacySheet,
  rowCells,
  yysTerm,
  type CellText,
  type Role,
} from "../curricula/legacy.js";
import { PlanError, type PlanData, type PlanItem } from "./model.js";

/**
 * A training plan of an older template (see curricula/legacy.ts): "Học kỳ"/"Phân bổ học kỳ" columns
 * hold the program term ("HK4" or "4") and its YYS code ("231"); headings such as "Các học phần bắt
 * buộc học chung" or "Chuyên ngành CNPM" sit in the code or STT column. A heading without a YYS code
 * belongs to the term of the next course of the same program term. Null when the workbook has none.
 */
export function readLegacyPlan(workbook: Workbook, text: CellText): PlanData | null {
  const found = legacySheet(workbook, text, "plan");
  if (!found) return null;
  const { sheet, header } = found;
  const meta = legacyMetadata(sheet, text, header.row);
  if (!meta) throw new PlanError("missing_plan_metadata");
  const { columns } = header;
  const admissionYear = 1994 + meta.cohort;
  const data: PlanData = {
    schemaVersion: 1,
    name: `KẾ HOẠCH ĐÀO TẠO NGÀNH ${meta.major} - KHÓA ${meta.cohort}`,
    major: meta.major,
    cohortCode: `K${meta.cohort}`,
    admissionYear,
    totalCredits: meta.totalCredits,
    notes: `Nhập từ mẫu kế hoạch cũ, trang "${sheet.name}": ${meta.title}`,
    items: [],
    terms: [],
    sections: [],
    sourceWarnings: [{
      row: null,
      message: "Mẫu kế hoạch cũ: học kỳ lấy từ mã học kỳ (vd. 221 = năm học 2022–2023, học kỳ 1); không đọc số tín chỉ từng học kỳ. Hãy rà soát trước khi lưu.",
    }],
    warnings: [],
    curriculum: null,
  };
  const warn = (row: number | null, message: string) => data.sourceWarnings.push({ row, message });
  const letter = (column: number) => String.fromCharCode(64 + column);
  const rows: { row: number; cells: Record<string, string>; get: (role: Role) => string; yys: string | null; label: string }[] = [];
  for (let row = header.dataRow; row <= sheet.rowCount; row++) {
    const cells = rowCells(sheet, text, row);
    if (/TP\.\s*Hồ Chí Minh|TRƯỞNG KHOA/i.test(Object.values(cells).join(" "))) break;
    const get = (role: Role) => (columns[role] ? cells[letter(columns[role]!)] ?? "" : "");
    rows.push({ row, cells, get, yys: null, label: "" });
  }
  // The YYS column is the term column whose values read as YYS codes; the other one labels the program term.
  const yysColumn = [...header.termColumns].sort((a, b) =>
    rows.filter((item) => yysTerm(item.cells[letter(b)] ?? "", admissionYear)).length
    - rows.filter((item) => yysTerm(item.cells[letter(a)] ?? "", admissionYear)).length)[0]!;
  const labelColumn = header.termColumns.find((column) => column !== yysColumn);
  for (const item of rows) {
    item.yys = yysTerm(item.cells[letter(yysColumn)] ?? "", admissionYear) ? clean(item.cells[letter(yysColumn)]!) : null;
    item.label = labelColumn ? item.cells[letter(labelColumn)] ?? "" : "";
  }
  let termCode = "", sectionId = "";
  rows.forEach((item, index) => {
    const code = item.get("code"), name = item.get("name");
    const course = !!name && isCourseCode(code);
    // A heading is written in the STT, code or name column; the term columns only repeat "HK4", "231".
    const own = { ...item.cells };
    for (const column of header.termColumns) own[letter(column)] = "";
    const heading = course ? "" : headingText(own, columns.credits!);
    if (!course && !heading) return;
    if (!course && /^ghi chu\b/.test(fold(heading))) return;
    // The row's own YYS code, else the next one of the same program term, else the current term.
    const next = item.yys ?? rows.slice(index + 1).find((later) => later.yys && (!item.label || later.label === item.label))?.yys ?? null;
    const term = next ? yysTerm(next, admissionYear) : null;
    if (term && term.code !== termCode) {
      termCode = term.code;
      sectionId = "";
      if (!data.terms.some((known) => known.code === termCode))
        data.terms.push({ code: termCode, semester: term.semester, studyYear: term.studyYear, sourceCredits: null });
    }
    if (!termCode) {
      if (course) throw new PlanError("invalid_plan_row", 422, [`${sheet.name}!${item.row}: chưa xác định được học kỳ của môn.`]);
      return;
    }
    if (!course) {
      sectionId = `section-${item.row}`;
      data.sections.push({
        id: sectionId,
        termCode,
        label: heading,
        kind: /chuyen nganh/.test(fold(heading)) ? "specialty" : /chon/.test(fold(heading)) ? "choice" : "note",
        sourceRow: item.row,
      });
      return;
    }
    const known = data.terms.find((candidate) => candidate.code === termCode)!;
    const number = (value: string, label: string) => {
      if (!value) return null;
      if (!/^\d+(?:[.,]\d+)?$/.test(value)) {
        warn(item.row, `${label}: giá trị chưa xác định (${value}).`);
        return null;
      }
      return Number(value.replace(",", "."));
    };
    const credits = number(item.get("credits"), "Tín chỉ");
    if (credits !== null && credits > 30) throw new PlanError("invalid_plan_row", 422, [`${sheet.name}!${item.row}: tín chỉ không hợp lệ.`]);
    if (!item.yys) warn(item.row, `${name}: xác định năm ${known.studyYear}, học kỳ ${known.semester} từ các dòng cùng học kỳ; ô mã học kỳ để trống.`);
    const planItem: PlanItem = {
      id: `row-${item.row}`,
      position: data.items.length + 1,
      code: code.toUpperCase(),
      name,
      credits,
      type: courseType(item.get("type")),
      termCode,
      semester: known.semester,
      studyYear: known.studyYear,
      sectionId,
      prerequisite: item.get("prerequisite"),
      prior: item.get("prior"),
      notes: item.get("notes"),
      hours: {
        lecture: number(item.get("lecture"), "LT"),
        practice: number(item.get("practice"), "TH"),
        project: number(item.get("project"), "ĐA"),
        internship: number(item.get("internship"), "TT"),
      },
      sourceRow: item.row,
      sourceSheet: sheet.name,
      sourceCells: item.cells,
    };
    data.items.push(planItem);
  });
  if (!data.items.length) throw new PlanError("no_courses");
  return data;
}
