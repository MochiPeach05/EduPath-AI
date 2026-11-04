// Báo cáo của cổng quản trị: the Excel files of AD-REPORT-03/05/07. Each has the data ("Dữ liệu"), the same numbers per
// cohort ("Theo khóa"), and a "Ghi chú" sheet with the filters, the export time (Vietnam time) and the scope, because
// the transcripts are uploaded by the students and not verified by the school. Numbers stay numbers (GPA with two
// decimals); Excel shows the decimal comma of the reader's locale.
import ExcelJS from "exceljs";
import type { ReportRow } from "./rows.js";
import { cohortSplit, progressCountsOf, RISK_LABELS, scopeOf, SKILL_STATUS_LABELS, skillGapRows } from "./aggregate.js";
import type { ProgressStatus, ReportScope } from "./types.js";

export const STATUS_LABELS: Record<ProgressStatus, string> = {
  on_track: "Đúng tiến độ", late: "Trễ kế hoạch", unknown: "Chưa đủ dữ liệu", no_transcript: "Chưa có bảng điểm",
};
const LEVEL_LABELS = { risk: "Nguy cơ", warn: "Cần chú ý" } as const;

/**
 * "09:15 31/10/2026" in Vietnam time: the time, then the day, the one way the portals write a moment (web display-format.ts
 * formatVnDateTime; QA 2026-11-04: dates were written several ways).
 */
export function vietnamTime(now: Date): string {
  const local = new Date(now.getTime() + 7 * 3600 * 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(local.getUTCHours())}:${two(local.getUTCMinutes())} ${two(local.getUTCDate())}/${two(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
}
/** "2026-10-31" in Vietnam time, for file names. */
export const vietnamDate = (now: Date) => new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** The scope as the pages write it; a transcript without data (no printed cumulative GPA read) is named apart. */
export const scopeLine = (scope: ReportScope) =>
  `Dựa trên ${scope.withTranscript}/${scope.students} sinh viên đã tải bảng điểm, ${scope.withData}/${scope.withTranscript} bảng điểm có dữ liệu; `
  + "bảng điểm do sinh viên tự tải, chưa xác minh. Bảng điểm chưa đọc được GPA tích lũy không được tính vào điểm, tín chỉ và tiến độ (Chưa đủ dữ liệu).";

type Column = { header: string; width: number; format?: string };

function sheet(workbook: ExcelJS.Workbook, name: string, columns: readonly Column[], rows: readonly (string | number | null)[][]) {
  const worksheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = columns.map((column) => ({ header: column.header, width: column.width, style: column.format ? { numFmt: column.format } : {} }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  for (const row of rows) worksheet.addRow(row.map((value) => (value === null ? "" : value)));
  return worksheet;
}

function notes(workbook: ExcelJS.Workbook, title: string, filters: readonly string[], scope: ReportScope, now: Date, extra: readonly string[]) {
  const worksheet = workbook.addWorksheet("Ghi chú");
  worksheet.columns = [{ width: 26 }, { width: 100 }];
  const lines: [string, string][] = [
    ["Báo cáo", title],
    ["Thời điểm xuất", `${vietnamTime(now)} (giờ Việt Nam)`],
    ["Bộ lọc", filters.length ? filters.join("; ") : "Tất cả sinh viên"],
    ["Phạm vi", scopeLine(scope)],
    ...extra.map((line, index): [string, string] => [index === 0 ? "Cách tính" : "", line]),
    ["Nguồn", "EduPath AI, cổng quản trị (Báo cáo)."],
  ];
  for (const [label, value] of lines) {
    const row = worksheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
}

const buffer = async (workbook: ExcelJS.Workbook) => Buffer.from(await workbook.xlsx.writeBuffer());
const newWorkbook = () => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EduPath AI";
  return workbook;
};

/** AD-REPORT-03: students by progress, every row the report lists in its order. */
export async function progressWorkbook(rows: readonly ReportRow[], scoped: readonly ReportRow[], filters: readonly string[], now: Date): Promise<Buffer> {
  const workbook = newWorkbook();
  sheet(workbook, "Dữ liệu", [
    { header: "STT", width: 6 }, { header: "MSSV", width: 16 }, { header: "Họ và tên", width: 28 }, { header: "Khóa", width: 8 },
    { header: "Ngành", width: 30 }, { header: "Chuyên ngành", width: 26 }, { header: "Tình trạng", width: 18 },
    { header: "Tín chỉ đã đạt", width: 14, format: "0" }, { header: "Tín chỉ của CTĐT", width: 15, format: "0" },
    { header: "Tín chỉ theo kế hoạch đến nay", width: 18, format: "0" }, { header: "GPA tích lũy (hệ 4)", width: 16, format: "0.00" },
    { header: "Cần chú ý", width: 12 },
  ], rows.map((row, index) => [
    index + 1, row.studentCode, row.name, row.cohort, row.majorName, row.specialtyName, STATUS_LABELS[row.status],
    row.passedCredits, row.totalCredits, row.expectedCredits, row.gpa, row.risk.level ? LEVEL_LABELS[row.risk.level] : null,
  ]));
  const split = cohortSplit(scoped, progressCountsOf);
  sheet(workbook, "Theo khóa", [
    { header: "Khóa", width: 12 }, { header: "Sinh viên", width: 11, format: "0" }, { header: "Đúng tiến độ", width: 13, format: "0" },
    { header: "Trễ kế hoạch", width: 13, format: "0" }, { header: "Chưa đủ dữ liệu", width: 15, format: "0" }, { header: "Chưa có bảng điểm", width: 17, format: "0" },
  ], [...split.byCohort.map((entry) => [entry.cohort, entry.total, entry.onTrack, entry.late, entry.unknown, entry.noTranscript]),
    ["Toàn khóa", split.all.total, split.all.onTrack, split.all.late, split.all.unknown, split.all.noTranscript]]);
  notes(workbook, "Thống kê sinh viên theo tiến độ học tập (AD-REPORT-03)", filters, scopeOf(scoped), now, [
    "Tiến độ tính như trang Tổng quan của sinh viên: tín chỉ đã đạt (in trên bảng điểm) so với kế hoạch đào tạo của khóa đến hết học kỳ trước học kỳ đang học.",
    "Trễ kế hoạch: có môn của học kỳ đã qua chưa đạt hoặc không kịp tín chỉ. Chưa đủ dữ liệu: chưa so được với kế hoạch đào tạo (thiếu kế hoạch hoặc chuyên ngành, hoặc bảng điểm chưa có dữ liệu).",
  ]);
  return buffer(workbook);
}

/** AD-REPORT-05: students who need attention, with every reason. */
export async function riskWorkbook(rows: readonly ReportRow[], scoped: readonly ReportRow[], filters: readonly string[], now: Date): Promise<Buffer> {
  const workbook = newWorkbook();
  sheet(workbook, "Dữ liệu", [
    { header: "STT", width: 6 }, { header: "MSSV", width: 16 }, { header: "Họ và tên", width: 28 }, { header: "Khóa", width: 8 },
    { header: "Chuyên ngành", width: 26 }, { header: "Mức", width: 12 }, { header: "Lý do", width: 90 }, { header: "GPA tích lũy (hệ 4)", width: 16, format: "0.00" },
  ], rows.map((row, index) => [
    index + 1, row.studentCode, row.name, row.cohort, row.specialtyName, row.risk.level ? LEVEL_LABELS[row.risk.level] : null,
    row.risk.items.map((item) => item.text).join("\n"), row.gpa,
  ])).getColumn(7).alignment = { wrapText: true, vertical: "top" };
  const flagged = scoped.filter((row) => row.risk.level !== null);
  const kinds = Object.keys(RISK_LABELS) as (keyof typeof RISK_LABELS)[];
  const split = cohortSplit(flagged, (part) => ({ total: part.length, risk: part.filter((row) => row.risk.level === "risk").length, kinds: kinds.map((kind) => part.filter((row) => row.risk.items.some((item) => item.kind === kind)).length) }));
  sheet(workbook, "Theo khóa", [
    { header: "Khóa", width: 12 }, { header: "Cần chú ý", width: 11, format: "0" }, { header: "Trong đó nguy cơ", width: 16, format: "0" },
    ...kinds.map((kind) => ({ header: RISK_LABELS[kind], width: 18, format: "0" })),
  ], [...split.byCohort.map((entry) => [entry.cohort, entry.total, entry.risk, ...entry.kinds]), ["Toàn khóa", split.all.total, split.all.risk, ...split.all.kinds]]);
  notes(workbook, "Thống kê sinh viên có nguy cơ chậm tiến độ (AD-REPORT-05)", filters, scopeOf(scoped), now, [
    "Đúng các mục \"Cần chú ý\" sinh viên thấy trên trang Tổng quan của mình; hệ thống tự tính, không dùng AI; chỉ để tham khảo, không thay cảnh báo học vụ.",
    "Nguy cơ: môn bắt buộc chưa đạt (F, VT, CT) chưa xếp học lại, không kịp tín chỉ, GPA tích lũy dưới mức tối thiểu của tiêu chuẩn xét tốt nghiệp. Cần chú ý: môn trễ so với kế hoạch, nhóm tự chọn còn thiếu tín chỉ, môn chưa đạt đã xếp học lại.",
  ]);
  return buffer(workbook);
}

/** AD-REPORT-07: the missing skills, overall, per cohort and per student. */
export async function skillsWorkbook(rows: readonly ReportRow[], scoped: readonly ReportRow[], filters: readonly string[], now: Date): Promise<Buffer> {
  const workbook = newWorkbook();
  const counts = (items: ReturnType<typeof skillGapRows>) => items.map((item) => [item.name, item.below, item.notStudied, item.selfStudy, item.noData, item.total]);
  const countColumns: Column[] = [
    { header: "Dưới ngưỡng", width: 13, format: "0" }, { header: "Chưa học", width: 11, format: "0" },
    { header: "Cần tự học ngoài chương trình", width: 18, format: "0" }, { header: "Chưa có điểm", width: 13, format: "0" }, { header: "Tổng", width: 9, format: "0" },
  ];
  const overall = skillGapRows(rows);
  sheet(workbook, "Dữ liệu", [{ header: "Kỹ năng", width: 36 }, ...countColumns], counts(overall));
  const names = overall.map((item) => item.name);
  const split = cohortSplit(rows, (part) => ({ items: skillGapRows(part, names) }));
  sheet(workbook, "Theo khóa", [{ header: "Khóa", width: 10 }, { header: "Kỹ năng", width: 36 }, ...countColumns],
    split.byCohort.flatMap((entry) => counts(entry.items.filter((item) => item.total > 0)).map((line) => [entry.cohort, ...line])));
  sheet(workbook, "Sinh viên", [
    { header: "MSSV", width: 16 }, { header: "Họ và tên", width: 28 }, { header: "Khóa", width: 8 }, { header: "Vị trí nghề nghiệp mục tiêu", width: 34 },
    { header: "Kỹ năng", width: 36 }, { header: "Tình trạng", width: 28 }, { header: "Điểm phù hợp", width: 13, format: "0.0" },
  ], rows.flatMap((row) => (row.competency?.career?.gaps ?? []).map((gap) => [
    row.studentCode, row.name, row.cohort, row.competency!.career!.name, gap.name, SKILL_STATUS_LABELS[gap.status], row.competency!.career!.fitScore,
  ])));
  notes(workbook, "Thống kê các kỹ năng còn thiếu của sinh viên (AD-REPORT-07)", filters, scopeOf(scoped), now, [
    "Từ lần Đánh giá năng lực mới nhất của mỗi sinh viên, so với vị trí nghề nghiệp mục tiêu (như trang Khoảng trống kỹ năng). Sinh viên đã xóa kết quả đánh giá không được tính.",
    "Dưới ngưỡng: có điểm nhưng thấp hơn ngưỡng của vị trí nghề nghiệp. Chưa học: môn trong chương trình chưa học hoặc sắp học. Cần tự học ngoài chương trình: chỉ học phần của chuyên ngành khác hoặc môn tự chọn chưa chọn dạy kỹ năng này. Chưa có điểm: chưa đủ dữ liệu.",
  ]);
  return buffer(workbook);
}
