import { Worker } from "node:worker_threads";
import {
  GraduationError,
  fold,
  validateData,
  type GraduationData,
} from "./model.js";
type Sheet = { workbook: string; sheet: string; rows: unknown[][] };
const clean = (v: unknown) =>
  String(v ?? "")
    .normalize("NFC")
    .trim();
function number(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(clean(v).replace(",", "."));
  if (!Number.isFinite(n))
    throw new GraduationError("invalid_numeric_value", 422, [clean(v)]);
  return n;
}
export function parseSheet(sheet: Sheet): GraduationData | null {
  const rows = sheet.rows.map((r) => r.map(clean));
  if (
    !rows
      .slice(0, 8)
      .some((r) => r.some((c) => /tieu chuan\s+xet tot nghiep/.test(fold(c))))
  )
    return null;
  const value = (label: string) => {
    const row = rows.find((r) => fold(r[1] ?? "").replace(/:$/, "") === label);
    return row?.[4] ?? "";
  };
  const threshold = (label: string) => {
    const row = rows.find((r) => fold(r[1] ?? "").startsWith(label));
    return number(row?.[8]);
  };
  const gpaLabel = rows.find((r) => fold(r[1] ?? "").startsWith("diem trung binh tich luy toi thieu"))?.[1] ?? "";
  const gpaScale = fold(gpaLabel).match(/(?:he|thang(?: diem)?)\s*(4|10)\b/)?.[1];
  const name = value("tieu chuan"),
    classBlock = value("khoi lop"),
    field = value("nganh dao tao");
  const cohortCode = classBlock.match(/K\d{2}/i)?.[0].toUpperCase();
  if (!name || !cohortCode || !field)
    throw new GraduationError("invalid_graduation_metadata", 422, [
      sheet.workbook,
      sheet.sheet,
    ]);
  const header = rows.findIndex(
    (r) => fold(r[2] ?? "") === "ma mh" && fold(r[4] ?? "").includes("ten mon"),
  );
  if (header < 0)
    throw new GraduationError("invalid_graduation_columns", 422, [sheet.sheet]);
  const data: GraduationData = {
    schemaVersion: 1,
    name,
    standardCode: name.split(/\s+-\s+/)[0]!,
    cohortCode,
    classBlock,
    major: field.split(/\s+-\s+Chuyên ngành:/i)[0]!,
    specialty: field.split(/Chuyên ngành:\s*/i)[1] ?? "",
    educationSystem: value("he dao tao"),
    faculty: value("khoa dao tao"),
    minimumCredits: threshold("so tin chi tich luy toi thieu"),
    mandatoryCredits: threshold("tong tin chi bat buoc"),
    electiveCredits: threshold("tong tin chi toi thieu nhom bat buoc tu chon"),
    freeElectiveCredits: threshold("tong so tin chi tu chon tu do"),
    minimumGpa: threshold("diem trung binh tich luy toi thieu"),
    gpaScale: gpaScale === "10" ? 10 : 4,
    notes: rows
      .slice(0, header)
      .flat()
      .filter((c) => fold(c).startsWith("ghi chu:"))
      .join("\n"),
    groups: [],
    courses: [],
    sourceWorkbook: sheet.workbook,
    sourceSheet: sheet.sheet,
    sourceNotes: [],
  };
  let groupId = "";
  const strayLabels: number[] = [],
    repeated: string[] = [];
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i]!,
      label = r
        .slice(0, 2)
        .find((c) => /^nhom (bat buoc|tu chon)/.test(fold(c)));
    // K26 exports keep stale group names and numbers in a 1-pixel-wide column A, one row above the
    // visible group row: a row with a course code and name is always a course.
    const isCourse = Boolean(r[2] && r[4]);
    if (label && !isCourse) {
      groupId = `row-${i + 1}`;
      data.groups.push({
        id: groupId,
        name: label,
        kind: fold(label).startsWith("nhom bat buoc")
          ? "mandatory"
          : "elective",
        minimumCredits: number(r[10]),
        sourceRow: i + 1,
      });
    } else if (isCourse) {
      if (!groupId)
        throw new GraduationError("course_without_group", 422, [
          sheet.sheet,
          `${i + 1}`,
        ]);
      if (label) strayLabels.push(i + 1);
      const [code, ...alternativeCodes] = courseCodes(r[2]!);
      const course = {
        id: `row-${i + 1}`,
        groupId,
        code: code!,
        ...(alternativeCodes.length ? { alternativeCodes } : {}),
        name: r[4]!,
        credits: number(r[10]),
        conditionOnly: /\(\s*\*\s*\)/.test(r[4]!),
        sourceRow: i + 1,
      };
      // One code twice in a group (K26: DIT0210 with two new codes) is one course with every code.
      const same = data.courses.find(
        (c) =>
          c.groupId === groupId &&
          c.code.toUpperCase() === course.code.toUpperCase() &&
          c.credits === course.credits &&
          c.conditionOnly === course.conditionOnly,
      );
      if (same) {
        const codes = uniqueCodes([...(same.alternativeCodes ?? []), ...alternativeCodes]);
        if (codes.length) same.alternativeCodes = codes;
        repeated.push(`${course.code} (dòng ${same.sourceRow} và ${i + 1})`);
      } else data.courses.push(course);
    } else if (r[2] || (/^\d+$/.test(r[0] ?? "") && r[4]))
      throw new GraduationError("invalid_graduation_row", 422, [
        sheet.sheet,
        `${i + 1}`,
      ]);
  }
  // A code that is another course's code, or that an earlier course already lists, is not an alternative.
  const primaries = new Set(data.courses.map((c) => c.code.toUpperCase()));
  const owners = new Map<string, string>(),
    dropped: string[] = [];
  for (const course of data.courses) {
    if (!course.alternativeCodes) continue;
    const kept = course.alternativeCodes.filter((code) => {
      const key = code.toUpperCase(),
        owner = owners.get(key);
      if (primaries.has(key) || owner) {
        dropped.push(`${code} ở ${course.code} (${owner ? `đã ghi cho ${owner}` : "là mã chính của học phần khác"})`);
        return false;
      }
      owners.set(key, course.code);
      return true;
    });
    if (kept.length) course.alternativeCodes = kept;
    else delete course.alternativeCodes;
  }
  if (rows.some((r) => r.slice(11).some((c) => c)))
    data.sourceNotes.push(
      "Các cột đánh dấu đã đạt và kết quả cá nhân không được dùng làm tiêu chuẩn xét tốt nghiệp.",
    );
  const withAlternatives = data.courses.filter((c) => c.alternativeCodes).length;
  if (withAlternatives)
    data.sourceNotes.push(
      `${withAlternatives} học phần ghi nhiều mã (mã cũ / mã mới): mã đầu là mã chính, các mã sau cũng được dùng khi đối chiếu bảng điểm.`,
    );
  if (strayLabels.length)
    data.sourceNotes.push(
      `Dòng ${strayLabels.join(", ")} vừa có tên nhóm vừa có học phần: đã đọc là học phần của nhóm trước, nhóm mới bắt đầu từ dòng chỉ có tên nhóm.`,
    );
  if (repeated.length)
    data.sourceNotes.push(
      `Mã ghi hai lần trong cùng nhóm được gộp thành một học phần: ${repeated.join("; ")}.`,
    );
  if (dropped.length)
    data.sourceNotes.push(
      `Đã bỏ mã thay thế trùng với học phần khác, hãy kiểm tra biểu mẫu: ${dropped.join("; ")}.`,
    );
  if (!data.courses.length) throw new GraduationError("no_courses");
  return validateData(data);
}

/** Codes without repeats (case ignored), each in its first spelling. */
const uniqueCodes = (codes: string[]) =>
  codes.filter(
    (code, index) =>
      codes.findIndex((other) => other.toUpperCase() === code.toUpperCase()) === index,
  );

/**
 * The codes of a "Mã MH" cell. K26 standards write a course's old and new codes ("DIT0091 / 71ITDS30103",
 * "DIT0160 71ITSE41003"); digits after a code that ends in letters finish that code ("71ITSE 30403").
 */
export function courseCodes(cell: string): string[] {
  const codes: string[] = [];
  for (const token of cell.split(/[\s/,;]+/).filter(Boolean)) {
    const last = codes[codes.length - 1];
    if (last !== undefined && /^\d+$/.test(token) && /[A-Z]$/i.test(last))
      codes[codes.length - 1] = last + token;
    else codes.push(token);
  }
  return uniqueCodes(codes);
}
let busy = false;
export async function parseGraduation(
  buffer: Buffer,
  filename: string,
): Promise<GraduationData[]> {
  if (buffer.length > 5 * 1024 * 1024 || buffer.length < 8)
    throw new GraduationError("invalid_workbook");
  if (busy) throw new GraduationError("import_busy", 429);
  busy = true;
  try {
    const sheets = await new Promise<Sheet[]>((resolve, reject) => {
      const worker = new Worker(
        new URL("../../workers/graduation.mjs", import.meta.url),
        {
          workerData: { buffer, filename },
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 192 },
        },
      );
      let settled = false;
      const finish = (error: unknown, data?: Sheet[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error);
        else resolve(data!);
      };
      const timer = setTimeout(
        () => finish(new GraduationError("import_timeout")),
        25000,
      );
      worker.once("message", (m) =>
        finish(m.error ? new GraduationError(m.error) : null, m.sheets),
      );
      worker.once("error", () =>
        finish(new GraduationError("invalid_workbook")),
      );
      worker.once("exit", () => {
        if (!settled) finish(new GraduationError("invalid_workbook"));
      });
    });
    const result = sheets
      .map(parseSheet)
      .filter((d): d is GraduationData => d !== null);
    if (!result.length || result.length > 50)
      throw new GraduationError("invalid_workbook");
    return result;
  } finally {
    busy = false;
  }
}
