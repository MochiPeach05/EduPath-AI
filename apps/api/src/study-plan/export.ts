import ExcelJS from "exceljs";
import type { StudyPlanContext } from "./context.js";
import { BLOCKS, DAYS, termLabel, type StudyPlanData } from "./model.js";

const dayLabel = (day: number) => (day === 8 ? "Chủ nhật" : `Thứ ${day}`);
const font = { name: "Arial", size: 10 } as const;

/** STU-PLAN-07: the plan as an Excel workbook, one sheet for the terms and one for the weekly timetables. */
export async function studyPlanWorkbook(context: StudyPlanContext, plan: StudyPlanData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EduPath AI";
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const nameOf = (code: string) => byCode.get(code.toUpperCase())?.name ?? code;

  const terms = workbook.addWorksheet("Lộ trình");
  terms.columns = [{ header: "Học kỳ", width: 20 }, { header: "Mã môn", width: 15 }, { header: "Tên môn học", width: 46 },
    { header: "Tín chỉ", width: 9 }, { header: "Loại", width: 12 }, { header: "Lịch tuần", width: 52 }];
  for (const term of plan.terms) {
    let credits = 0;
    for (const course of term.courses) {
      const info = byCode.get(course.code.toUpperCase());
      credits += info?.credits ?? 0;
      const sessions = course.sessions.map((session) => session.day === null || session.block === null ? `${session.kind}: chưa xếp`
        : `${session.kind}: ${dayLabel(session.day)}, tiết ${BLOCKS[session.block - 1]!.periods}`).join("; ");
      terms.addRow([termLabel(term.code), course.code, nameOf(course.code), info?.credits ?? null,
        info ? (info.kind === "mandatory" ? "Bắt buộc" : `Tự chọn ${info.group ?? ""}`.trim()) : "", sessions]);
    }
    if (term.courses.length) terms.addRow([termLabel(term.code), "", "Tổng", credits, "", ""]).font = { ...font, bold: true };
  }
  terms.getRow(1).font = { ...font, bold: true };
  terms.eachRow((row, index) => { if (index > 1 && !row.font?.bold) row.font = font; });

  const week = workbook.addWorksheet("Lịch tuần");
  week.columns = [{ width: 16 }, ...DAYS.map(() => ({ width: 24 }))];
  for (const term of plan.terms.filter((item) => item.courses.some((course) => course.sessions.some((session) => session.day !== null)))) {
    week.addRow([termLabel(term.code)]).font = { ...font, bold: true, size: 12 };
    week.addRow(["Ca (tiết)", ...DAYS.map(dayLabel)]).font = { ...font, bold: true };
    BLOCKS.forEach((block) => {
      const cells = DAYS.map((day) => term.courses.flatMap((course) => course.sessions
        .filter((session) => session.day === day && session.block === block.block)
        .map((session) => `${nameOf(course.code)} (${session.kind})`)).join("\n"));
      const row = week.addRow([`Ca ${block.block} (${block.periods})\n${block.time}`, ...cells]);
      row.font = font;
      row.alignment = { wrapText: true, vertical: "top" };
    });
    week.addRow([]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
