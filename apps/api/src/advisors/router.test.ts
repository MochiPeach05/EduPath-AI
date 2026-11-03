import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AppRole, AuthenticatedUser } from "../auth/types.js";
import { advisorTemplate } from "./import.js";
import { AdvisorError } from "./model.js";
import { createAdvisorPortalRouter } from "./portal-router.js";
import { PostgresAdvisorRepository, type AdvisorRepository } from "./repository.js";
import { createAdvisorsRouter } from "./router.js";

const origin = "http://localhost:5173";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const id = "12345678-1234-4234-8234-123456789012";
const actor = { userId: "22345678-1234-4234-8234-123456789012", tenantId: "tenant", name: "Admin", role: "admin" } as AuthenticatedUser;
const advisor = { stt: 1, userId: id, name: "Nguyễn Văn A", email: "nva@vlu.edu.vn", classes: ["71K29CNTT01"] };
// Building and reading a workbook takes a while when the whole suite runs at once: one template, longer timeouts.
const template = advisorTemplate();
const WORKBOOK_TIMEOUT = 30_000;

function setup(role: AppRole | null = "admin") {
  const repository = {
    access: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([advisor]), detail: vi.fn().mockResolvedValue(advisor),
    create: vi.fn().mockResolvedValue(advisor), update: vi.fn().mockResolvedValue(advisor), remove: vi.fn().mockResolvedValue({ name: "A", email: null }),
    preview: vi.fn().mockResolvedValue({ fileName: "f.xlsx", rows: 1, items: [], fileProblems: [], summary: {} }),
    apply: vi.fn().mockResolvedValue({ added: 1, updated: 0, unchanged: 0, skipped: 0 }),
    me: vi.fn().mockResolvedValue({ classes: 2, canManageAdvisors: false, scope: "own" }), classes: vi.fn().mockResolvedValue([]),
    students: vi.fn().mockResolvedValue({ items: [], total: 0 }), open: vi.fn().mockResolvedValue({ url: `/dashboard?sv=${id}#overview` }),
  } satisfies Record<keyof AdvisorRepository, unknown>;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: role ? { ...actor, role } : undefined } as typeof req.session; next(); });
  app.use("/advisors", createAdvisorsRouter(undefined, origin, new Set(["vlu.edu.vn"]), repository as unknown as AdvisorRepository));
  app.use("/portal", createAdvisorPortalRouter(undefined, origin, repository as unknown as AdvisorRepository));
  return { app, repository };
}
const body = { name: "  Nguyễn   Văn A ", email: " NVA@VLU.edu.vn ", staffCode: "", unit: "Bộ môn KTPM", classes: ["71k29cntt01", "71K29CNTT01", " 71K29 CNTT02 "] };

describe("advisors router: who may read and change", () => {
  it.each([[null, 401], ["student", 403]] as const)("blocks %s", async (role, status) => {
    const { app, repository } = setup(role);
    await request(app).get("/advisors").expect(status);
    await request(app).get("/portal/classes").expect(status);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it.each(["admin", "faculty_board", "department_head", "lecturer", "advisor"] as const)("lets %s read the list and a detail", async (role) => {
    const { app, repository } = setup(role);
    expect((await request(app).get("/advisors").expect(200)).body).toEqual({ items: [advisor] });
    await request(app).get(`/advisors/${id}`).expect(200);
    expect(repository.access).toHaveBeenCalledWith(expect.objectContaining({ role }), false);
  });

  it.each(["department_head", "lecturer", "advisor"] as const)("refuses changes to %s", async (role) => {
    const { app, repository } = setup(role);
    await request(app).post("/advisors").set("Origin", origin).send(body).expect(403, { error: "insufficient_role" });
    await request(app).delete(`/advisors/${id}`).set("Origin", origin).expect(403);
    expect(repository.create).not.toHaveBeenCalled(); expect(repository.remove).not.toHaveBeenCalled();
  });

  it.each(["admin", "faculty_board"] as const)("lets %s add an advisor, with the form normalized", async (role) => {
    const { app, repository } = setup(role);
    const answer = await request(app).post("/advisors").set("Origin", origin).send(body).expect(201);
    expect(answer.body).toEqual({ advisor });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ role }), {
      name: "Nguyễn Văn A", email: "nva@vlu.edu.vn", staffCode: null, unit: "Bộ môn KTPM", classes: ["71K29CNTT01", "71K29CNTT02"],
    });
    expect(repository.access).toHaveBeenCalledWith(expect.objectContaining({ role }), true);
  });

  it.each([undefined, "https://elsewhere.test"])("refuses a change from Origin %s", async (value) => {
    const { app, repository } = setup(); const call = request(app).post("/advisors"); if (value) call.set("Origin", value);
    await call.send(body).expect(403, { error: "invalid_origin" });
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe("advisors router: forms", () => {
  it.each([
    [{ ...body, name: "  " }, "name_required"], [{ ...body, email: " " }, "email_required"], [{ ...body, email: "nva" }, "invalid_input"],
    [{ ...body, classes: [] }, "classes_required"],
    [{ ...body, classes: ["71K29CNTT01", "lớp+"] }, "invalid_class"], [{ ...body, role: "admin" }, "invalid_input"],
  ])("refuses %j with %s", async (form, code) => {
    const { app, repository } = setup();
    await request(app).post("/advisors").set("Origin", origin).send(form).expect(400, { error: code });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("edits without changing the email and removes an advisor", async () => {
    const { app, repository } = setup();
    await request(app).put(`/advisors/${id}`).set("Origin", origin).send({ ...body, email: "other@vlu.edu.vn" }).expect(200);
    expect(repository.update).toHaveBeenCalledWith(actor, id, { name: "Nguyễn Văn A", staffCode: null, unit: "Bộ môn KTPM", classes: ["71K29CNTT01", "71K29CNTT02"] });
    expect((await request(app).delete(`/advisors/${id}`).set("Origin", origin).expect(200)).body).toEqual({ ok: true });
    expect(repository.remove).toHaveBeenCalledWith(actor, id);
    await request(app).put("/advisors/not-a-uuid").set("Origin", origin).send(body).expect(404, { error: "advisor_not_found" });
  });

  it("answers the repository's errors with their details", async () => {
    const { app, repository } = setup();
    repository.create.mockRejectedValue(new AdvisorError("class_taken", 409, { classes: [{ className: "71K29CNTT01", advisorName: "Trần Thị B" }] }));
    await request(app).post("/advisors").set("Origin", origin).send(body)
      .expect(409, { error: "class_taken", classes: [{ className: "71K29CNTT01", advisorName: "Trần Thị B" }] });
    repository.detail.mockRejectedValue(new AdvisorError("advisor_not_found", 404));
    await request(app).get(`/advisors/${id}`).expect(404, { error: "advisor_not_found" });
  });
});

describe("advisors router: import", () => {
  it("previews and applies a workbook read from the request body, with its file name", { timeout: WORKBOOK_TIMEOUT }, async () => {
    const { app, repository } = setup();
    const file = await template;
    await request(app).post("/advisors/import/preview").set("Origin", origin).set("Content-Type", XLSX)
      .set("x-filename", encodeURIComponent("Danh sách CVHT.xlsx")).send(file).expect(200);
    const [, name, sheet] = repository.preview.mock.calls[0]!;
    expect(name).toBe("Danh sách CVHT.xlsx");
    expect(sheet).toMatchObject({ rows: 1, items: [{ email: "nguyenvana@vlu.edu.vn", classes: ["71K29CNTT01", "71K29CNTT02"] }] });
    await request(app).post("/advisors/import").set("Origin", origin).set("Content-Type", XLSX).send(file).expect(200, { added: 1, updated: 0, unchanged: 0, skipped: 0 });
    expect(repository.apply).toHaveBeenCalledWith(actor, "co-van-hoc-tap.xlsx", expect.objectContaining({ rows: 1 }));
  });

  it("refuses what is not a workbook and a bad file name", { timeout: WORKBOOK_TIMEOUT }, async () => {
    const { app, repository } = setup();
    await request(app).post("/advisors/import/preview").set("Origin", origin).set("Content-Type", "text/plain").send("x").expect(400, { error: "invalid_workbook" });
    await request(app).post("/advisors/import/preview").set("Origin", origin).set("Content-Type", XLSX).send(Buffer.from("not a zip")).expect(400, { error: "invalid_workbook" });
    await request(app).post("/advisors/import").set("Origin", origin).set("Content-Type", XLSX).set("x-filename", "cvht.csv")
      .send(await template).expect(400, { error: "invalid_filename" });
    expect(repository.preview).not.toHaveBeenCalled(); expect(repository.apply).not.toHaveBeenCalled();
  });

  it("serves the template to every admin-portal role", { timeout: WORKBOOK_TIMEOUT }, async () => {
    const answer = await request(setup("advisor").app).get("/advisors/import/template").expect(200);
    expect(answer.headers["content-type"]).toContain(XLSX);
    expect(answer.headers["content-disposition"]).toContain("mau-danh-sach-co-van-hoc-tap.xlsx");
  });
});

describe("advisor portal router", () => {
  it("answers the account's own classes, students and the permission list", async () => {
    const { app, repository } = setup("advisor");
    expect((await request(app).get("/portal/me").expect(200)).body).toEqual({ classes: 2, canManageAdvisors: false, scope: "own" });
    await request(app).get("/portal/classes").expect(200, { items: [] });
    await request(app).get("/portal/students").query({ class: "71k29cntt01", q: " 2374 ", status: "no_transcript", sort: "name", dir: "desc", page: 2 })
      .expect(200, { items: [], total: 0, page: 2, pageSize: 10 });
    expect(repository.students).toHaveBeenCalledWith(expect.objectContaining({ role: "advisor" }), {
      className: "71K29CNTT01", q: "2374", status: "no_transcript", sort: "name", dir: "desc", page: 2, pageSize: 10,
    });
    const permissions = (await request(app).get("/portal/permissions").expect(200)).body;
    expect(Object.keys(permissions)).toEqual(["view", "act", "never", "notes"]);
  });

  it("keeps the list's own order for a sort key it does not know", async () => {
    const { app, repository } = setup("advisor");
    await request(app).get("/portal/students?sort=specialty&dir=asc").expect(200);
    await request(app).get("/portal/students?sort=email").expect(200);
    expect(repository.students.mock.calls.map(([, query]) => query.sort)).toEqual(["specialty", "email"]);
  });

  it.each(["status=done", "pageSize=101", "dir=down", "role=admin"])("refuses the student query %s", async (query) => {
    const { app, repository } = setup("advisor");
    await request(app).get(`/portal/students?${query}`).expect(400, { error: "invalid_query" });
    expect(repository.students).not.toHaveBeenCalled();
  });

  it("opens a student's page only from the web app and only for an advised student", async () => {
    const { app, repository } = setup("advisor");
    await request(app).post(`/portal/students/${id}/open`).expect(403, { error: "invalid_origin" });
    expect((await request(app).post(`/portal/students/${id}/open`).set("Origin", origin).expect(200)).body).toEqual({ url: `/dashboard?sv=${id}#overview` });
    expect(repository.open).toHaveBeenCalledWith(expect.objectContaining({ role: "advisor" }), id, `/portal/students/${id}/open`);
    repository.open.mockRejectedValue(new AdvisorError("student_not_advised", 403));
    await request(app).post(`/portal/students/${id}/open`).set("Origin", origin).expect(403, { error: "student_not_advised" });
    await request(app).post("/portal/students/nope/open").set("Origin", origin).expect(403, { error: "student_not_advised" });
  });

  it.each(["admin", "faculty_board"] as const)("serves %s the same routes, for every student", async (role) => {
    const { app, repository } = setup(role);
    repository.me.mockResolvedValue({ classes: 0, canManageAdvisors: true, scope: "all" });
    expect((await request(app).get("/portal/me").expect(200)).body).toEqual({ classes: 0, canManageAdvisors: true, scope: "all" });
    await request(app).get("/portal/students?status=all").expect(200);
    expect(repository.students).toHaveBeenCalledWith(expect.objectContaining({ role }), expect.objectContaining({ status: "all" }));
    await request(app).post(`/portal/students/${id}/open`).set("Origin", origin).expect(200);
    expect(repository.open).toHaveBeenCalledWith(expect.objectContaining({ role }), id, `/portal/students/${id}/open`);
  });
});

describe("advisor portal repository: whose students an account sees (QTV & CVHT)", () => {
  /** Any active student account, as advisedStudent's second query reads it for an admin. */
  const anyStudent = {
    id, tenant: "tenant", object_id: "o", display_name: "SV", email: null, username: null, auth_version: 1,
    student_code: "2374802010994", full_name: "Sinh viên Thử nghiệm", class_name: "71K29CNTT05", actor_name: "Admin",
  };
  function repository(rows: { advised?: unknown[]; any?: unknown[] } = {}) {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("INSERT INTO ad_audit_log")) return { rowCount: 1, rows: [] };
      if (sql.includes("count(*)::int AS classes")) return { rows: [{ classes: 3 }] };
      if (sql.includes("WITH students AS")) return { rows: [{ items: [], total: 0 }] };
      if (sql.includes("WITH k AS")) return { rows: [] };
      if (sql.includes("JOIN ad_advisor_classes c ON")) return { rows: rows.advised ?? [] };
      if (sql.includes("LEFT JOIN student_profiles p ON p.user_id=u.id")) return { rows: rows.any ?? [] };
      return { rows: [] };
    });
    return { repo: new PostgresAdvisorRepository({ query } as never, new Set(["vlu.edu.vn"])), query };
  }
  const as = (role: AppRole) => ({ ...actor, role });
  const list = { q: "", status: "all" as const, page: 1, pageSize: 10 };

  it("tells the web app the scope of the account", async () => {
    for (const role of ["admin", "faculty_board"] as const) {
      expect(await repository().repo.me(as(role))).toEqual({ classes: 3, canManageAdvisors: true, scope: "all" });
    }
    for (const role of ["advisor", "lecturer", "department_head"] as const) {
      expect(await repository().repo.me(as(role))).toEqual({ classes: 3, canManageAdvisors: false, scope: "own" });
    }
  });

  it("lists every class for an admin and the own classes for an advisor", async () => {
    const all = repository();
    await all.repo.classes(as("admin"));
    expect(String(all.query.mock.calls[0]?.[0])).toContain("UNION SELECT class_name FROM ad_advisor_classes");
    expect(String(all.query.mock.calls[0]?.[0])).toContain('AS "advisorName"');
    expect(all.query.mock.calls[0]?.[1]).toBeUndefined();
    const own = repository();
    await own.repo.classes(as("advisor"));
    expect(String(own.query.mock.calls[0]?.[0])).toContain("WITH k AS (SELECT class_name FROM ad_advisor_classes WHERE advisor_user_id = $1)");
    expect(own.query.mock.calls[0]?.[1]).toEqual([actor.userId]);
  });

  it("lists every student for an admin and the own classes' students for anyone else", async () => {
    const all = repository();
    await all.repo.students(as("faculty_board"), list);
    expect(String(all.query.mock.calls[0]?.[0])).toContain("$1::uuid IS NULL OR");
    expect(all.query.mock.calls[0]?.[1]?.[0]).toBeNull();
    const own = repository();
    await own.repo.students(as("lecturer"), { ...list, className: "71K29CNTT01" });
    expect(own.query.mock.calls[0]?.[1]?.slice(0, 2)).toEqual([actor.userId, "71K29CNTT01"]);
  });

  it("opens any student's page for an admin, logged, and only the own classes for an advisor", async () => {
    const admin = repository({ any: [anyStudent] });
    expect(await admin.repo.open(as("admin"), id, "/api/admin/advisor-portal/students/x/open")).toEqual({ url: `/dashboard?sv=${id}#overview` });
    const audit = admin.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO ad_audit_log"))?.[1];
    expect(audit?.slice(3, 9)).toEqual(["admin", "advisor", "Mở trang sinh viên", "2374802010994 – Sinh viên Thử nghiệm (lớp 71K29CNTT05)", "student", id]);
    const advisorRepo = repository({ any: [anyStudent] });
    await expect(advisorRepo.repo.open(as("advisor"), id, "/x")).rejects.toMatchObject({ code: "student_not_advised", status: 403 });
    expect(advisorRepo.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO ad_audit_log"))).toBe(false);
    const none = repository();
    await expect(none.repo.open(as("admin"), id, "/x")).rejects.toMatchObject({ code: "student_not_advised" });
  });
});
