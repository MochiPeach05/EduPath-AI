import ExcelJS from "exceljs";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../../db/pool.js";
import * as audit from "../audit/record.js";
import type { ReportRowSource } from "./cache.js";
import { createReportsRouter } from "./router.js";
import { competency, reportRow } from "./test-rows.js";

// The reports API over a stubbed row source and a fake database for the admin check. Synthetic students only.
const ADMIN = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-31T02:00:00Z");
const rows = [
  reportRow({ name: "Nguyễn Văn An", studentCode: "9900000001", cohort: "K29", status: "late", gpa: 2.4,
    risk: { level: "risk", items: [{ kind: "failed_course", level: "risk", text: "Môn bắt buộc chưa đạt: Môn A (F) và chưa có trong Kế hoạch học kỳ." }] },
    competency: competency({ career: { name: "Kỹ sư phần mềm", fitScore: 60, fitLabel: "Ít phù hợp", gaps: [{ name: "React", status: "self_study" }] } }),
    roadmapCourses: [{ code: "COS120", name: "Cấu trúc dữ liệu", how: "retake" }] }),
  reportRow({ name: "Trần Thị Bình", studentCode: "9900000002", cohort: "K30", status: "on_track", gpa: 3.4 }),
  reportRow({ name: "Lê Gia Cường", studentCode: "9900000003", cohort: "K31", hasTranscript: false, status: "no_transcript", gpa: null }),
];

function setup(options: { role?: string; admin?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active")) {
      return options.admin === false ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ id: ADMIN }] };
    }
    if (sql.startsWith("SELECT DISTINCT p.cohort_code AS cohort")) return { rowCount: 3, rows: [{ cohort: "K31" }, { cohort: "K29" }, { cohort: "K30" }] };
    return { rowCount: 0, rows: [] };
  });
  const pool = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as DatabasePool;
  const source: ReportRowSource = { rows: vi.fn(async () => ({ rows, generatedAt: "2026-10-31T01:00:00.000Z" })) };
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { session: { user: { userId: ADMIN, tenantId: "t", role: options.role ?? "lecturer", name: "Giảng Viên Mẫu" } } });
    next();
  });
  app.use("/r", createReportsRouter(pool, { source, now: () => NOW }));
  return { app, source };
}

const binary = (res: NodeJS.ReadableStream & { setEncoding(encoding: string): void }, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};
async function workbookOf(body: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  return workbook;
}

afterEach(() => vi.restoreAllMocks());

describe("reports API", () => {
  it("is for active admins of any admin role", async () => {
    await request(setup({ role: "student" }).app).get("/r/dashboard").expect(403, { error: "insufficient_role" });
    await request(setup({ admin: false }).app).get("/r/dashboard").expect(403, { error: "insufficient_role" });
    const res = await request(setup({ role: "lecturer" }).app).get("/r/dashboard").expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("answers the dashboard for all cohorts and each cohort, with the filters", async () => {
    const { app } = setup();
    const body = (await request(app).get("/r/dashboard").expect(200)).body;
    expect(body.scope).toEqual({ students: 3, withTranscript: 2, withData: 2, assessed: 1 });
    expect(body.studyTerm).toEqual({ code: "HK261", label: "HK1 2026–2027" });
    expect(body.kpis.byCohort.map((entry: { cohort: string }) => entry.cohort)).toEqual(["K29", "K30", "K31"]);
    expect(body.averages.map((table: { by: string }) => table.by)).toEqual(["cohort", "major", "specialty"]);
    const k29 = (await request(app).get("/r/dashboard?cohort=k29&major=&q=an").expect(200)).body;
    expect(k29.scope.students).toBe(1);
  });

  it("refuses unknown or malformed filters", async () => {
    const { app } = setup();
    await request(app).get("/r/dashboard?cohort=29").expect(400, { error: "invalid_query" });
    await request(app).get("/r/dashboard?specialty=XYZ").expect(400, { error: "invalid_query" });
    await request(app).get("/r/dashboard?foo=1").expect(400, { error: "invalid_query" });
    await request(app).get("/r/progress?pageSize=500").expect(400, { error: "invalid_query" });
    await request(app).get("/r/skills/students").expect(400, { error: "invalid_query" });
  });

  it("pages the progress and risk lists", async () => {
    const { app } = setup();
    const progress = (await request(app).get("/r/progress?status=late&page=1&pageSize=10").expect(200)).body;
    expect(progress.page).toMatchObject({ total: 1, page: 1, pageSize: 10, items: [{ name: "Nguyễn Văn An", status: "late", gpa: 2.4 }] });
    expect(progress.counts.all).toEqual({ total: 3, onTrack: 1, late: 1, unknown: 0, noTranscript: 1 });
    const risk = (await request(app).get("/r/risk").expect(200)).body;
    expect(risk.page.items.map((item: { name: string; level: string }) => [item.name, item.level])).toEqual([["Nguyễn Văn An", "risk"]]);
  });

  it("names the students of a skill and of a course", async () => {
    const { app } = setup();
    expect((await request(app).get("/r/skills/students?skill=React").expect(200)).body.items.map((item: { name: string }) => item.name)).toEqual(["Nguyễn Văn An"]);
    expect((await request(app).get("/r/courses/students?code=COS120").expect(200)).body).toMatchObject({ code: "COS120", name: "Cấu trúc dữ liệu", items: [{ how: "retake" }] });
    expect((await request(app).get("/r/careers").expect(200)).body.careers.all.items[0]).toMatchObject({ name: "Kỹ sư phần mềm", students: 1 });
    expect((await request(app).get("/r/courses").expect(200)).body.withRoadmap).toBe(1);
    expect((await request(app).get("/r/options").expect(200)).body.cohorts).toEqual(["K29", "K30", "K31"]);
  });

  it("exports Excel files and writes each export to the log", async () => {
    const record = vi.spyOn(audit, "recordAudit");
    const { app } = setup();
    const res = await request(app).get("/r/progress.xlsx?cohort=K29").buffer(true).parse(binary).expect(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain('filename="Bao-cao-tien-do-2026-10-31.xlsx"');
    const workbook = await workbookOf(res.body as Buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Dữ liệu", "Theo khóa", "Ghi chú"]);
    const data = workbook.getWorksheet("Dữ liệu")!;
    expect(data.getRow(1).getCell(2).value).toBe("MSSV");
    expect(data.getRow(2).getCell(3).value).toBe("Nguyễn Văn An");
    expect(data.getRow(2).getCell(11).value).toBe(2.4);
    expect(data.rowCount).toBe(2);
    const notes = workbook.getWorksheet("Ghi chú")!;
    expect(notes.getRow(3).getCell(2).value).toBe("khóa K29");
    expect(String(notes.getRow(4).getCell(2).value)).toBe("Dựa trên 1/1 sinh viên đã tải bảng điểm, 1/1 bảng điểm có dữ liệu; bảng điểm do sinh viên tự tải, chưa xác minh. "
      + "Bảng điểm chưa đọc được GPA tích lũy không được tính vào điểm, tín chỉ và tiến độ (Chưa đủ dữ liệu).");
    expect(String(notes.getRow(2).getCell(2).value)).toBe("09:00 31/10/2026 (giờ Việt Nam)");
    expect(record).toHaveBeenCalledWith(expect.anything(), { userId: ADMIN, name: "Giảng Viên Mẫu", role: "lecturer" },
      expect.objectContaining({ kind: "report", action: "Xuất Excel", summary: "Sinh viên theo tiến độ (khóa K29, 1 dòng)" }));

    const risk = await request(app).get("/r/risk.xlsx").buffer(true).parse(binary).expect(200);
    expect(risk.headers["content-disposition"]).toContain("Sinh-vien-co-nguy-co-2026-10-31.xlsx");
    expect((await workbookOf(risk.body as Buffer)).getWorksheet("Dữ liệu")!.getRow(2).getCell(6).value).toBe("Nguy cơ");
    const skills = await request(app).get("/r/skills.xlsx").buffer(true).parse(binary).expect(200);
    const skillBook = await workbookOf(skills.body as Buffer);
    expect(skillBook.worksheets.map((sheet) => sheet.name)).toEqual(["Dữ liệu", "Theo khóa", "Sinh viên", "Ghi chú"]);
    expect(skillBook.getWorksheet("Sinh viên")!.getRow(2).getCell(6).value).toBe("Cần tự học ngoài chương trình");
    expect(record.mock.calls.map(([, , entry]) => entry.summary)).toEqual([
      "Sinh viên theo tiến độ (khóa K29, 1 dòng)", "Sinh viên có nguy cơ chậm tiến độ (1 dòng)", "Kỹ năng còn thiếu (1 sinh viên, 1 kỹ năng thiếu)",
    ]);
  });
});
