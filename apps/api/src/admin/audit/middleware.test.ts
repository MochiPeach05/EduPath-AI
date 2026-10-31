import express, { type Express, type RequestHandler } from "express";
import { readFileSync } from "node:fs";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../auth/types.js";
import { auditAdminMutations, settleAuditWrites } from "./middleware.js";
import { AUDIT_ROUTES, matchAuditRoute, sentenceCase } from "./routes.js";

const admin = { userId: "3f2b8c1e-5d4a-4b6f-9a1e-2c3d4e5f6a7b", tenantId: "tenant", name: "Phạm Thu Trang", role: "faculty_board" } as AuthenticatedUser;
const fieldId = "8b1d6c2a-1f3e-4a5b-9c7d-0e1f2a3b4c5d";

/** An app with the audit middleware and the given routes; lookups answer from `rows` by the table they read. */
function setup(routes: (app: Express) => void, rows: Record<string, Record<string, unknown> | Error> = {}, user: AuthenticatedUser | null = admin) {
  const inserts: unknown[][] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith("INSERT INTO ad_audit_log")) { inserts.push(values); return { rowCount: 1, rows: [] }; }
    const table = Object.keys(rows).find((name) => sql.includes(name));
    const row = table ? rows[table] : undefined;
    if (row instanceof Error) throw row;
    return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
  });
  const app = express();
  app.use(express.json());
  app.use(((req, _res, next) => { req.session = { user: user ?? undefined } as typeof req.session; next(); }) as RequestHandler);
  app.use("/api/admin", auditAdminMutations({ query } as never));
  routes(app);
  const entry = (index = 0) => {
    const values = inserts[index]!;
    return { actorId: values[1], actorName: values[2], role: values[3], kind: values[4], action: values[5], summary: values[6],
      targetType: values[7], targetId: values[8], method: values[9], path: values[10] };
  };
  return { app, query, inserts, entry };
}

describe("audit log of admin changes", () => {
  it("logs a sent announcement with its title and recipients, by the session's admin", async () => {
    const { app, inserts, entry } = setup((a) => a.post("/api/admin/announcements", (_req, res) => {
      res.status(201).json({ announcement: { id: "a1", title: "Đăng ký học lại HK2 2026–2027", recipients: 37 } });
    }));
    await request(app).post("/api/admin/announcements?x=1").send({ title: "Đăng ký học lại HK2 2026–2027", body: "Nội dung" }).expect(201);
    await settleAuditWrites();
    expect(inserts).toHaveLength(1);
    expect(entry()).toEqual({ actorId: admin.userId, actorName: "Phạm Thu Trang", role: "faculty_board", kind: "notify", action: "Gửi thông báo",
      summary: "Gửi thông báo \"Đăng ký học lại HK2 2026–2027\" cho 37 sinh viên", targetType: "announcement", targetId: "a1",
      method: "POST", path: "/api/admin/announcements" });
  });

  it("names an imported CTĐT from the answer, never from the uploaded file", async () => {
    const { app, inserts, entry } = setup((a) => a.post("/api/admin/curricula", express.raw({ type: "*/*" }), (_req, res) => {
      res.status(201).json({ id: "c1", data: { major: "CÔNG NGHỆ THÔNG TIN", cohortCode: "K29", courses: [{ code: "A" }, { code: "B" }] } });
    }));
    await request(app).post("/api/admin/curricula").set("Content-Type", "application/octet-stream").send(Buffer.from("SECRET-FILE-CONTENT")).expect(201);
    await settleAuditWrites();
    expect(entry()).toMatchObject({ kind: "training", action: "Import CTĐT", summary: "Import CTĐT Công nghệ thông tin khóa 29 (2 học phần)", targetId: "c1" });
    expect(JSON.stringify(inserts)).not.toContain("SECRET");
  });

  it("looks up the name of a deleted object", async () => {
    const { app, query, entry } = setup((a) => a.delete("/api/admin/careers/fields/:id", (_req, res) => { res.json({ deleted: true }); }),
      { career_fields: { code: "LV05", name: "Mạng máy tính" } });
    await request(app).delete(`/api/admin/careers/fields/${fieldId}`).send({ confirmed: true }).expect(200);
    await settleAuditWrites();
    expect(entry()).toMatchObject({ kind: "career", action: "Xóa lĩnh vực nghề nghiệp", summary: "Xóa lĩnh vực nghề nghiệp LV05 Mạng máy tính",
      targetType: "career_field", targetId: fieldId });
    expect(query.mock.calls.find(([sql]) => String(sql).includes("career_fields"))?.[1]).toEqual([fieldId]);
  });

  it("names role changes, locks and bulk competency actions", async () => {
    const { app, entry } = setup((a) => {
      a.patch("/api/admin/accounts/:id", (_req, res) => { res.json({ user: { id: "u2", name: "Lê Quốc Bảo", email: "giangvien.test@vlu.edu.vn" } }); });
      a.post("/api/admin/competencies/courses/activate", (_req, res) => { res.json({ activated: 12, skipped: 1 }); });
      a.post("/api/admin/competencies/ai/batches/:id/apply", (_req, res) => { res.json({ activated: 3, drafted: 40, empty: 2, skipped: [{ courseCode: "X" }] }); });
    });
    await request(app).patch("/api/admin/accounts/u2").send({ role: "lecturer", confirmed: true }).expect(200);
    await request(app).patch("/api/admin/accounts/u2").send({ isActive: false, confirmed: true }).expect(200);
    await request(app).post("/api/admin/competencies/courses/activate").send({ cohort: "K29", confirmed: true }).expect(200);
    await request(app).post("/api/admin/competencies/ai/batches/b1/apply").send({ status: "draft" }).expect(200);
    await settleAuditWrites();
    expect(entry(0)).toMatchObject({ kind: "account", action: "Đổi vai trò", summary: "Đổi vai trò của Lê Quốc Bảo (giangvien.test@vlu.edu.vn) thành Giảng viên" });
    expect(entry(1)).toMatchObject({ action: "Khóa tài khoản", summary: "Khóa tài khoản Lê Quốc Bảo (giangvien.test@vlu.edu.vn)" });
    expect(entry(2)).toMatchObject({ kind: "competency", summary: "Áp dụng 12 bản nháp liên kết kỹ năng, bỏ qua 1 (khóa 29)" });
    expect(entry(3)).toMatchObject({ summary: "Lưu kết quả Năng lực AI (lưu bản nháp): 3 môn áp dụng, 40 môn bản nháp, 2 môn không có kỹ năng phù hợp, bỏ qua 1 môn" });
  });

  it("skips reads, previews, failures and requests without a signed-in admin", async () => {
    const handlers = (a: Express) => {
      a.get("/api/admin/curricula", (_req, res) => { res.json({ items: [] }); });
      a.post("/api/admin/curricula/preview", (_req, res) => { res.json({ data: {} }); });
      a.post("/api/admin/careers", (_req, res) => { res.status(409).json({ error: "career_changed" }); });
    };
    const { app, inserts } = setup(handlers);
    await request(app).get("/api/admin/curricula").expect(200);
    await request(app).post("/api/admin/curricula/preview").expect(200);
    await request(app).post("/api/admin/careers").send({}).expect(409);
    const anonymous = setup((a) => a.post("/api/admin/announcements", (_req, res) => { res.json({}); }), {}, null);
    await request(anonymous.app).post("/api/admin/announcements").send({}).expect(200);
    await settleAuditWrites();
    expect(inserts).toHaveLength(0);
    expect(anonymous.inserts).toHaveLength(0);
  });

  it("still logs a route without a rule, and a change whose lookup fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app, entry } = setup((a) => {
      a.post("/api/admin/something/new", (_req, res) => { res.json({ ok: true }); });
      a.delete("/api/admin/careers/:id", (_req, res) => { res.json({ deleted: true }); });
    }, { career_positions: new Error("connection lost") });
    await request(app).post("/api/admin/something/new").send({}).expect(200);
    await request(app).delete(`/api/admin/careers/${fieldId}`).send({ confirmed: true }).expect(200);
    await settleAuditWrites();
    expect(entry(0)).toMatchObject({ kind: "other", action: "Thay đổi dữ liệu", summary: "Yêu cầu POST /api/admin/something/new" });
    expect(entry(1)).toMatchObject({ kind: "career", action: "Xóa nghề", summary: `Xóa nghề ${fieldId}` });
    error.mockRestore();
  });
});

// Every mutating route of the admin routers mounted in app.ts has a rule, so a new route fails here until it is named.
describe("audit route map coverage", () => {
  const routers: [file: string, prefix: string][] = [
    ["../accounts.ts", "/accounts"], ["../student-profiles.ts", "/students"],
    ["../../curricula/router.ts", "/curricula"], ["../../plans/router.ts", "/plans"], ["../../graduation/router.ts", "/graduation"],
    ["../../careers/router.ts", "/careers"], ["../../careers/ai-suggestions/router.ts", "/careers/requirements/ai-suggestions"],
    ["../../careers/requirements.ts", "/careers/requirements"], ["../../careers/skills.ts", "/careers/skills"],
    ["../../competencies/router.ts", "/competencies"], ["../../competencies/ai/router.ts", "/competencies/ai"],
    ["../../notifications/admin-router.ts", "/announcements"],
  ];
  const found = routers.flatMap(([file, prefix]) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    return [...source.matchAll(/router\.(post|put|patch|delete)\(\s*"([^"]*)"/g)].map((match) => ({
      method: match[1]!.toUpperCase(), path: `${prefix}${match[2] === "/" ? "" : match[2]}`,
    }));
  });

  it("finds the admin routes it checks", () => {
    expect(found.length).toBeGreaterThanOrEqual(45);
  });

  it.each(found.map((route) => [route.method, route.path]))("%s %s has a rule", (method, path) => {
    const sample = path.replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000001");
    const matched = matchAuditRoute(method, sample);
    expect(matched, `${method} ${path}`).not.toBeNull();
    expect(matched!.route.path).toBe(path);
  });

  it("has no rule twice and no rule for a route that does not exist", () => {
    const keys = AUDIT_ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    const existing = new Set(found.map((route) => `${route.method} ${route.path}`));
    expect(keys.filter((key) => !existing.has(key))).toEqual([]);
  });

  it("turns capitals from the workbooks into sentence case and keeps acronyms", () => {
    expect(sentenceCase("HỆ THỐNG THÔNG TIN")).toBe("Hệ thống thông tin");
    expect(sentenceCase("CNTT ỨNG DỤNG")).toBe("CNTT ứng dụng");
    expect(sentenceCase("Kỹ thuật phần mềm")).toBe("Kỹ thuật phần mềm");
  });
});
