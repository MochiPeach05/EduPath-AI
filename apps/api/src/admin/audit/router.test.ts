import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AppRole, AuthenticatedUser } from "../../auth/types.js";
import { createAuditLogRouter } from "./router.js";

const actor = { userId: "3f2b8c1e-5d4a-4b6f-9a1e-2c3d4e5f6a7b", tenantId: "tenant", name: "Phạm Thu Trang", role: "faculty_board" } as AuthenticatedUser;
const row = { id: "e1", at: "2026-10-31T02:12:00.000Z", actorName: "Phạm Thu Trang", actorRole: "faculty_board", kind: "report",
  action: "Xuất Excel", summary: "Xuất Excel: Sinh viên có nguy cơ chậm tiến độ (khóa 29, 18 dòng)" };

function setup(role: AppRole | null = "faculty_board", options: { active?: boolean; now?: () => number } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM users")) return { rowCount: options.active === false ? 0 : 1, rows: [] };
    if (sql.startsWith("DELETE FROM ad_audit_log")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ items: [row], total: 1, actors: ["Lê Quốc Bảo", "Phạm Thu Trang"] }] };
  });
  const app = express();
  app.use((req, _res, next) => { req.session = { user: role ? { ...actor, role } : undefined } as typeof req.session; next(); });
  app.use("/audit-log", createAuditLogRouter({ query } as never, options.now ? { now: options.now } : {}));
  const listCalls = () => query.mock.calls.filter(([sql]) => String(sql).includes("WITH filtered"));
  return { app, query, listCalls };
}

describe("audit log API", () => {
  it.each([[null, 401], ["student", 403]] as const)("blocks role %s", async (role, status) => {
    const { app, listCalls } = setup(role);
    await request(app).get("/audit-log").expect(status);
    expect(listCalls()).toHaveLength(0);
  });

  it("blocks an admin whose account lost the role or was locked", async () => {
    const { app, listCalls } = setup("admin", { active: false });
    await request(app).get("/audit-log").expect(403);
    expect(listCalls()).toHaveLength(0);
  });

  it.each(["admin", "faculty_board", "department_head", "lecturer"] as const)("serves %s the newest entries with role labels", async (role) => {
    const { app } = setup(role);
    const response = await request(app).get("/audit-log").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      items: [{ ...row, actorRole: "Ban chủ nhiệm khoa" }], total: 1, page: 1, pageSize: 20, actors: ["Lê Quốc Bảo", "Phạm Thu Trang"],
    });
  });

  it("filters by folded text, kind and actor, pages with bounds", async () => {
    const { app, listCalls } = setup();
    await request(app).get("/audit-log").query({ q: "  Xuất EXCEL ", kind: "report", actor: "Phạm Thu Trang", page: 3, pageSize: 50 }).expect(200);
    const [sql, values] = listCalls()[0]!;
    expect(String(sql)).toContain("ORDER BY at DESC, id DESC");
    expect(values).toEqual(["xuat excel", "report", "Phạm Thu Trang", 50, 100, null]);
    // The actor by name only, also on rows written with "MSSV - Họ tên - Lớp": the profile's name part (QA 2026-11-04).
    expect(String(sql)).toContain("($3::text IS NULL OR COALESCE(NULLIF(btrim(p.full_name), ''), l.actor_name) = $3)");
    expect(String(sql)).toContain("FROM ad_audit_log l LEFT JOIN student_profiles p ON p.user_id = l.actor_user_id");
    expect(String(sql)).toContain('json_agg(name ORDER BY name COLLATE "vi-x-icu" ASC)');
    await request(app).get("/audit-log").query({ pageSize: 101 }).expect(400);
    await request(app).get("/audit-log").query({ kind: "grades" }).expect(400);
    await request(app).get("/audit-log").query({ extra: "1" }).expect(400);
  });

  it("shows a cố vấn học tập their own actions only, and only their own name to filter by (user 2026-11-07)", async () => {
    const { app, listCalls } = setup("advisor");
    await request(app).get("/audit-log").expect(200);
    const [sql, values] = listCalls()[0]!;
    expect(values).toEqual(["", null, null, 20, 0, actor.userId]);
    expect(String(sql).match(/\(\$6::uuid IS NULL OR l\.actor_user_id = \$6\)/g)).toHaveLength(2);
    const admin = setup("admin");
    await request(admin.app).get("/audit-log").expect(200);
    expect(admin.listCalls()[0]![1]).toEqual(["", null, null, 20, 0, null]);
  });

  it("sorts by a whitelisted column, newest first on ties", async () => {
    const { app, listCalls } = setup();
    await request(app).get("/audit-log").query({ sort: "actor", dir: "asc" }).expect(200);
    // Người thực hiện in Vietnamese order (Đ after D, QA 2026-11-04).
    expect(String(listCalls()[0]![0])).toContain('ORDER BY "actorName" COLLATE "vi-x-icu" ASC, at DESC, id DESC');
    await request(app).get("/audit-log").query({ sort: "at", dir: "asc" }).expect(200);
    expect(String(listCalls()[1]![0])).toContain("ORDER BY at ASC, id ASC");
    await request(app).get("/audit-log").query({ sort: "summary" }).expect(400);
  });

  it("deletes entries older than one year at most once an hour", async () => {
    let clock = 0;
    const { app, query } = setup("admin", { now: () => clock });
    const deletes = () => query.mock.calls.filter(([sql]) => String(sql).startsWith("DELETE FROM ad_audit_log")).length;
    await request(app).get("/audit-log").expect(200);
    clock += 30 * 60 * 1000;
    await request(app).get("/audit-log").expect(200);
    expect(deletes()).toBe(1);
    expect(String(query.mock.calls.find(([sql]) => String(sql).startsWith("DELETE"))![0])).toContain("interval '1 year'");
    clock += 31 * 60 * 1000;
    await request(app).get("/audit-log").expect(200);
    expect(deletes()).toBe(2);
  });

  it("answers 503 without a database", async () => {
    const app = express();
    app.use((req, _res, next) => { req.session = { user: actor } as typeof req.session; next(); });
    app.use("/audit-log", createAuditLogRouter(undefined));
    await request(app).get("/audit-log").expect(503);
  });
});
