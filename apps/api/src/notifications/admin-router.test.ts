import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { createAnnouncementsRouter } from "./admin-router.js";

// The faculty's announcements (AD-NOTI-01/02) over a fake database. Synthetic ids only.
const ADMIN = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222221";
const B = "22222222-2222-4222-8222-222222222222";
const ANN = "77777777-7777-4777-8777-777777777777";
const origin = "https://edupath.example";
const announcement = (extra: Record<string, unknown> = {}) => ({
  id: ANN, title: "Lịch đăng ký học phần", body: "Mở từ 01/12.", link: "#plans", target: { cohorts: ["K29"], majors: ["7480201"] },
  recipients: 2, read: 1, createdAt: new Date("2026-10-30T02:00:00Z"), createdBy: "Quản trị viên mẫu", withdrawnAt: null, ...extra,
});

type Rows = (sql: string, params: unknown[]) => { rowCount: number; rows: unknown[] } | undefined;
function setup(options: { role?: string; admin?: boolean; rows?: Rows } = {}) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active")) {
      return options.admin === false ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ id: ADMIN }] };
    }
    return options.rows?.(sql, params) ?? { rowCount: 0, rows: [] };
  });
  const release = vi.fn();
  const pool = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { session: { user: { userId: ADMIN, tenantId: "t", role: options.role ?? "admin" } } }); next(); });
  app.use("/a", createAnnouncementsRouter(pool, origin, { staffEmailDomains: new Set(["vlu.edu.vn"]) }));
  return { app, query, release, sql: () => query.mock.calls.map(([text, params]) => [String(text), params] as const) };
}

afterEach(() => vi.restoreAllMocks());

describe("announcements API", () => {
  it("is for active admins only, and writes need the web origin", async () => {
    await request(setup({ role: "student" }).app).get("/a").expect(403, { error: "insufficient_role" });
    await request(setup({ admin: false }).app).get("/a").expect(403, { error: "insufficient_role" });
    await request(setup().app).post("/a").send({ title: "T", body: "B" }).expect(403, { error: "invalid_origin" });
  });

  it("offers the cohorts and majors of the students, and counts who an announcement reaches", async () => {
    const { app, sql } = setup({
      rows: (text) => (text.startsWith("SELECT DISTINCT p.cohort_code") ? { rowCount: 3, rows: [{ cohort: "K30", major: "7480201" }, { cohort: "K9", major: "7480104" }, { cohort: null, major: null }] }
        : text.startsWith("SELECT count(*)::int AS count") ? { rowCount: 1, rows: [{ count: 312 }] } : undefined),
    });
    expect((await request(app).get("/a/options").expect(200)).body).toEqual({
      cohorts: ["K9", "K30"], majors: [{ code: "7480104", name: "Hệ thống thông tin" }, { code: "7480201", name: "Công nghệ thông tin" }],
    });
    await request(app).get("/a/reach?cohorts=K29,K30&majors=7480201").expect(200, { count: 312 });
    const reach = sql().find(([text]) => text.startsWith("SELECT count(*)::int AS count"))!;
    expect(reach[0]).toContain("COALESCE(u.role_override,u.role)='student'");
    expect(reach[1]).toEqual([["K29", "K30"], ["7480201"], ["vlu.edu.vn"]]);
    await request(app).get("/a/reach?cohorts=29").expect(400, { error: "invalid_input" });
  });

  it("refuses an empty title or body, a link outside the portal and an audience of nobody", async () => {
    const { app } = setup();
    const send = (body: Record<string, unknown>) => request(app).post("/a").set("Origin", origin).send(body);
    await send({ title: "  ", body: "Nội dung" }).expect(400, { error: "title_required" });
    await send({ title: "Tiêu đề", body: "\n " }).expect(400, { error: "body_required" });
    await send({ title: "Tiêu đề", body: "Nội dung", link: "https://example.com" }).expect(400, { error: "invalid_input" });
    await send({ title: "T".repeat(121), body: "Nội dung" }).expect(400, { error: "invalid_input" });
    await send({ title: "Tiêu đề", body: "Nội dung", cohorts: ["K99"] }).expect(400, { error: "no_recipients" });
  });

  it("sends one notification per recipient in one transaction", async () => {
    const { app, sql, release } = setup({
      rows: (text) => (text.startsWith("SELECT u.id FROM users u") ? { rowCount: 2, rows: [{ id: A }, { id: B }] }
        : text.includes("FROM ad_announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1") ? { rowCount: 1, rows: [announcement()] } : undefined),
    });
    const response = await request(app).post("/a").set("Origin", origin)
      .send({ title: " Lịch đăng ký học phần ", body: "Mở từ 01/12.", link: "#plans", cohorts: ["K29", "K29"], majors: ["7480201"] }).expect(201);
    expect(response.body.announcement).toMatchObject({ id: ANN, targetLabel: "K29 · Công nghệ thông tin", recipients: 2, read: 1, createdAt: "2026-10-30T02:00:00.000Z" });
    const statements = sql().map(([text]) => text);
    expect(statements[statements.indexOf("BEGIN") + 1]).toContain("FOR SHARE");
    const inserted = sql().find(([text]) => text.startsWith("INSERT INTO ad_announcements"))!;
    expect(inserted[1]).toEqual([expect.any(String), "Lịch đăng ký học phần", "Mở từ 01/12.", "#plans", JSON.stringify({ cohorts: ["K29"], majors: ["7480201"] }), 2, ADMIN]);
    const fanOut = sql().find(([text]) => text.startsWith("INSERT INTO stu_notifications"))!;
    const params = fanOut[1] as unknown[][];
    expect(params[1]).toEqual([A, B]);
    expect(params[2]).toEqual(["khoa", "khoa"]);
    expect(params[3]).toEqual(["announcement", "announcement"]);
    expect(params[7]).toEqual(["Mở Kế hoạch đào tạo", "Mở Kế hoạch đào tạo"]);
    expect(params[8]).toEqual([`announcement:${inserted[1]![0]}`, `announcement:${inserted[1]![0]}`]);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("withdraws an announcement once and takes it out of every bell", async () => {
    let withdrawn = false;
    const { app, sql } = setup({
      rows: (text) => (text.startsWith("UPDATE ad_announcements SET withdrawn_at=now()") ? (withdrawn ? { rowCount: 0, rows: [] } : ((withdrawn = true), { rowCount: 1, rows: [] }))
        : text === "SELECT 1 FROM ad_announcements WHERE id=$1" ? { rowCount: 1, rows: [{}] }
        : text.includes("WHERE a.id=$1") ? { rowCount: 1, rows: [announcement({ withdrawnAt: new Date("2026-10-30T03:00:00Z") })] } : undefined),
    });
    const first = await request(app).post(`/a/${ANN}/withdraw`).set("Origin", origin).send({}).expect(200);
    expect(first.body.announcement.withdrawnAt).toBe("2026-10-30T03:00:00.000Z");
    expect(sql().some(([text, params]) => text.startsWith("UPDATE stu_notifications SET deleted_at=now() WHERE announcement_id=$1") && (params as unknown[])[0] === ANN)).toBe(true);
    await request(app).post(`/a/${ANN}/withdraw`).set("Origin", origin).send({}).expect(409, { error: "already_withdrawn" });
  });

  it("lists the announcements in the order a column asks for", async () => {
    const { app, sql } = setup({ rows: (text) => (text.includes("FROM ad_announcements a LEFT JOIN users u") ? { rowCount: 1, rows: [announcement()] } : undefined) });
    expect((await request(app).get("/a?sort=read&order=desc").expect(200)).body.items[0]).toMatchObject({ id: ANN, targetLabel: "K29 · Công nghệ thông tin" });
    expect(sql().find(([text]) => text.includes("FROM ad_announcements a LEFT JOIN users u"))![0])
      .toContain("(SELECT count(*) FROM stu_notifications n WHERE n.announcement_id=a.id AND n.read_at IS NOT NULL) DESC NULLS LAST");
    await request(app).get("/a?sort=nope").expect(400, { error: "invalid_input" });
  });
});
