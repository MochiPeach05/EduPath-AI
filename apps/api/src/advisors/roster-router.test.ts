import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AppRole, AuthenticatedUser } from "../auth/types.js";
import { matchAuditRoute } from "../admin/audit/routes.js";
import { advisorReadOnly } from "./access.js";
import { createAdvisorPortalRouter } from "./portal-router.js";
import type { AdvisorRepository } from "./repository.js";
import type { RosterRepository } from "./roster-repository.js";
import { classParameter } from "./roster-router.js";
import { rosterTemplate, type RosterSheet } from "./roster.js";

const origin = "http://localhost:5173";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const actor = { userId: "22345678-1234-4234-8234-123456789012", tenantId: "tenant", name: "Cố vấn", role: "advisor" } as AuthenticatedUser;
const WORKBOOK_TIMEOUT = 30_000;

// A made-up class list: two students, the second without a class (it goes to the class the import is for).
async function workbook(): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Danh sách lớp");
  sheet.addRow(["STT", "MSSV", "Họ và tên", "Lớp"]);
  sheet.addRow([1, "2374802010991", "Nguyễn Văn An", "71K29CNTT99"]);
  sheet.addRow([2, "2374802010992", "Trần Thị Bình", ""]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

function setup(role: AppRole = "advisor") {
  const repository = { access: vi.fn().mockResolvedValue(undefined) } as unknown as AdvisorRepository;
  const roster = {
    preview: vi.fn(async (_actor: AuthenticatedUser, fileName: string, sheet: RosterSheet) => ({ fileName, sheet })),
    apply: vi.fn(async () => ({ added: 2, updated: 0, unchanged: 0, skipped: 0 })),
    remove: vi.fn(async (_actor: AuthenticatedUser, studentCode: string) => ({ studentCode, className: "71K29CNTT99" })),
  } satisfies Record<keyof RosterRepository, unknown>;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: { ...actor, role } } as typeof req.session; next(); });
  app.use("/api/admin", advisorReadOnly);
  app.use("/api/admin/advisor-portal", createAdvisorPortalRouter(undefined, origin, repository, roster as unknown as RosterRepository));
  return { app, roster, repository };
}

describe("Import danh sách sinh viên: routes", () => {
  it("lets an advisor preview and import a class list (their classes are checked by the repository)", async () => {
    const { app, roster, repository } = setup("advisor");
    const file = await workbook();
    const preview = await request(app).post("/api/admin/advisor-portal/roster/import/preview?class=71k29cntt99").set("Origin", origin)
      .set("Content-Type", XLSX).set("x-filename", encodeURIComponent("Danh sách lớp.xlsx")).send(file).expect(200);
    expect(preview.body.fileName).toBe("Danh sách lớp.xlsx");
    // The row without a class goes to the class of ?class=, as a canonical code.
    expect((preview.body.sheet as RosterSheet).items.map((item) => [item.studentCode, item.className])).toEqual([
      ["2374802010991", "71K29CNTT99"], ["2374802010992", "71K29CNTT99"]]);
    expect(roster.preview).toHaveBeenCalledWith(expect.objectContaining({ role: "advisor" }), "Danh sách lớp.xlsx", expect.anything());
    await request(app).post("/api/admin/advisor-portal/roster/import?class=71K29CNTT99").set("Origin", origin)
      .set("Content-Type", XLSX).send(file).expect(200, { added: 2, updated: 0, unchanged: 0, skipped: 0 });
    expect(roster.apply).toHaveBeenCalledTimes(1);
    expect(repository.access).toHaveBeenCalled();
  }, WORKBOOK_TIMEOUT);

  it("serves the sample tệp to an advisor, with the class in it", async () => {
    const { app } = setup("advisor");
    const answer = await request(app).get("/api/admin/advisor-portal/roster/template?class=71K29CNTT99").buffer(true)
      .parse((res, done) => { const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk)); res.on("end", () => done(null, Buffer.concat(chunks))); })
      .expect(200);
    expect(answer.headers["content-type"]).toContain(XLSX);
    expect(answer.headers["content-disposition"]).toContain("mau-danh-sach-sinh-vien-71K29CNTT99.xlsx");
    expect((answer.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  }, WORKBOOK_TIMEOUT);

  it("refuses a change from another Origin, a class without its cohort and a file that is no .xlsx", async () => {
    const { app, roster } = setup("admin");
    await request(app).post("/api/admin/advisor-portal/roster/import").set("Content-Type", XLSX).send(Buffer.from("PK")).expect(403, { error: "invalid_origin" });
    await request(app).post("/api/admin/advisor-portal/roster/import/preview?class=CNTT99").set("Origin", origin).set("Content-Type", XLSX)
      .send(await workbook()).expect(400, { error: "invalid_class" });
    await request(app).post("/api/admin/advisor-portal/roster/import/preview").set("Origin", origin).set("Content-Type", XLSX)
      .send(Buffer.from("MSSV;Họ và tên")).expect(400, { error: "invalid_workbook" });
    await request(app).post("/api/admin/advisor-portal/roster/import/preview").set("Origin", origin).set("Content-Type", XLSX)
      .set("x-filename", "ds.csv").send(await workbook()).expect(400, { error: "invalid_filename" });
    expect(roster.preview).not.toHaveBeenCalled();
    expect(roster.apply).not.toHaveBeenCalled();
  }, WORKBOOK_TIMEOUT);

  it("keeps every other admin write closed to the role advisor", async () => {
    const { app } = setup("advisor");
    await request(app).delete("/api/admin/advisor-portal/roster/2374802010991").set("Origin", origin).expect(403, { error: "read_only_role" });
    await request(app).post("/api/admin/advisors/import").set("Origin", origin).expect(403, { error: "read_only_role" });
    await request(app).get("/api/admin/advisors/import/template").expect(403, { error: "admin_only" });
  });

  it("lets an advisor remove a student who never signed in from a class list (the repository checks the class and the account)", async () => {
    const { app, roster } = setup("advisor");
    await request(app).delete("/api/admin/advisor-portal/roster/students/2374802019001").set("Origin", origin)
      .expect(200, { removed: { studentCode: "2374802019001", className: "71K29CNTT99" } });
    expect(roster.remove).toHaveBeenCalledWith(expect.objectContaining({ role: "advisor" }), "2374802019001");
    // K26 codes are upper case, whatever the address says.
    await request(app).delete("/api/admin/advisor-portal/roster/students/207ct00991").set("Origin", origin).expect(200);
    expect(roster.remove).toHaveBeenLastCalledWith(expect.anything(), "207CT00991");
    await request(app).delete("/api/admin/advisor-portal/roster/students/SV-001").set("Origin", origin).expect(404, { error: "listed_student_not_found" });
    await request(app).delete("/api/admin/advisor-portal/roster/students/2374802019001").expect(403, { error: "invalid_origin" });
    expect(roster.remove).toHaveBeenCalledTimes(2);
  });

  it("reads ?class= as a canonical class code", () => {
    expect(classParameter(undefined)).toBeNull();
    expect(classParameter(" 71k29 cntt99 ")).toBe("71K29CNTT99");
    expect(classParameter("K29CNTT99")).toBe("71K29CNTT99");
    expect(() => classParameter("CNTT99")).toThrow(expect.objectContaining({ code: "invalid_class" }));
    expect(() => classParameter(["71K29CNTT99"])).toThrow(expect.objectContaining({ code: "invalid_class" }));
  });

  it("logs an import with its classes and counts, never the students, and not a preview", async () => {
    expect(matchAuditRoute("POST", "/advisor-portal/roster/import/preview")?.route.skip).toBeTruthy();
    const matched = matchAuditRoute("POST", "/advisor-portal/roster/import")!;
    const described = await matched.route.describe!({ params: matched.params, body: {}, lookup: async () => null, result: {
      added: 30, updated: 2, unchanged: 5, skipped: 1, preview: { fileName: "ds.xlsx", items: [
        { className: "71K29CNTT99", status: "add", name: "Nguyễn Văn An" }, { className: "71K29CNTT05", status: "error", name: "Lớp Khác" },
        { className: "71K31CNTT99", status: "update", name: "Trần Thị Bình" }] } } });
    expect(described).toEqual({ summary: "Import danh sách sinh viên lớp 71K29CNTT99, 71K31CNTT99 từ tệp ds.xlsx: thêm 30, cập nhật 2, không đổi 5, bỏ qua 1 sinh viên có lỗi" });
    expect(JSON.stringify(described)).not.toContain("Nguyễn Văn An");
    expect(matched.route.kind).toBe("account");
    const removal = matchAuditRoute("DELETE", "/advisor-portal/roster/students/2374802019001")!;
    expect(await removal.route.describe!({ params: removal.params, body: {}, lookup: async () => null,
      result: { removed: { studentCode: "2374802019001", className: "71K29CNTT99" } } })).toEqual({
      summary: "Xóa sinh viên MSSV 2374802019001 (chưa đăng nhập) khỏi danh sách lớp 71K29CNTT99", targetType: "class", targetId: "71K29CNTT99" });
    expect(removal.route.action).toBe("Xóa sinh viên khỏi danh sách lớp");
  });

  it("builds its sample tệp for no class too", async () => {
    expect((await rosterTemplate()).subarray(0, 2).toString()).toBe("PK");
  }, WORKBOOK_TIMEOUT);
});
