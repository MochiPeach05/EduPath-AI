import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { createStudentNotificationsRouter } from "./student-router.js";

// The student API of the bell (STU-PROG-04…09) over a fake database. Synthetic ids only.
const USER = "11111111-1111-4111-8111-111111111111";
const ID = "66666666-6666-4666-8666-666666666666";
const origin = "https://edupath.example";
const row = (extra: Record<string, unknown> = {}) => ({
  id: ID, type: "ai", kind: "roadmap_ready", title: "Lộ trình AI cho học kỳ tới đã soạn xong", body: "Nội dung", link: "#roadmap",
  linkLabel: "Mở Lộ trình AI đề xuất", readAt: null, createdAt: new Date("2026-10-30T02:00:00Z"), ...extra,
});

function setup(options: { user?: boolean; rows?: (sql: string, params: unknown[]) => { rowCount: number; rows: unknown[] } | undefined } = {}) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: USER }] };
    return options.rows?.(sql, params) ?? { rowCount: 0, rows: [] };
  });
  const pool = { query } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { session: { user: options.user === false ? undefined : { userId: USER, tenantId: "t", role: "student" } } });
    next();
  });
  app.use("/n", createStudentNotificationsRouter(pool, origin));
  return { app, query, sql: () => query.mock.calls.map(([text, params]) => [String(text), params] as const) };
}

afterEach(() => vi.restoreAllMocks());

describe("student notifications API", () => {
  it("needs a signed-in student and the web origin for writes", async () => {
    await request(setup({ user: false }).app).get("/n").expect(401);
    await request(setup().app).post("/n/read-all").send({}).expect(403, { error: "invalid_origin" });
  });

  it("lists the student's notifications newest first with the unread count, filtered by type or unread", async () => {
    const { app, sql } = setup({
      rows: (text) => (text.includes("FROM stu_notifications WHERE user_id=$1 AND deleted_at IS NULL") && text.includes("ORDER BY")
        ? { rowCount: 1, rows: [row()] } : text.includes("count(*)::int AS unread") ? { rowCount: 1, rows: [{ unread: 3 }] } : undefined),
    });
    const response = await request(app).get("/n?filter=warn&limit=20").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      items: [{ id: ID, type: "ai", kind: "roadmap_ready", title: "Lộ trình AI cho học kỳ tới đã soạn xong", body: "Nội dung", link: "#roadmap",
        linkLabel: "Mở Lộ trình AI đề xuất", read: false, createdAt: "2026-10-30T02:00:00.000Z" }],
      unread: 3,
    });
    const list = sql().find(([text]) => text.includes("ORDER BY created_at DESC"))!;
    expect(list[0]).toContain("AND type=$3");
    expect(list[1]).toEqual([USER, 20, "warn"]);
    await request(app).get("/n?filter=unread").expect(200);
    expect(sql().filter(([text]) => text.includes("ORDER BY created_at DESC")).at(-1)![0]).toContain("AND read_at IS NULL");
    await request(app).get("/n?filter=bogus").expect(400, { error: "invalid_input" });
  });

  it("answers the bell's poll and runs the housekeeping at most once an hour", async () => {
    const { app, sql } = setup({ rows: (text) => (text.includes("count(*)::int AS unread") ? { rowCount: 1, rows: [{ unread: 2 }] } : undefined) });
    await request(app).get("/n/unread-count").expect(200, { unread: 2 });
    await request(app).get("/n/unread-count").expect(200, { unread: 2 });
    const purges = sql().filter(([text]) => text.startsWith("DELETE FROM stu_notifications WHERE created_at<"));
    expect(purges).toHaveLength(1);
    expect(purges[0]![1]).toEqual([90]);
  });

  it("marks one read or unread, all read, deletes softly and restores within the undo window", async () => {
    const { app, sql } = setup({
      rows: (text) => (text.startsWith("UPDATE stu_notifications SET read_at=COALESCE") ? { rowCount: 1, rows: [row({ readAt: new Date() })] }
        : text.startsWith("UPDATE stu_notifications SET read_at=NULL") ? { rowCount: 0, rows: [] }
        : text.startsWith("UPDATE stu_notifications SET deleted_at=now()") ? { rowCount: 1, rows: [] }
        : text.startsWith("UPDATE stu_notifications SET deleted_at=NULL") ? { rowCount: 1, rows: [row()] } : undefined),
    });
    expect((await request(app).post(`/n/${ID}/read`).set("Origin", origin).send({}).expect(200)).body.notification.read).toBe(true);
    await request(app).post(`/n/${ID}/unread`).set("Origin", origin).send({}).expect(404, { error: "not_found" });
    await request(app).post("/n/read-all").set("Origin", origin).send({}).expect(200, { unread: 0 });
    await request(app).delete(`/n/${ID}`).set("Origin", origin).expect(204);
    expect((await request(app).post(`/n/${ID}/restore`).set("Origin", origin).send({}).expect(200)).body.notification.id).toBe(ID);
    const restore = sql().find(([text]) => text.startsWith("UPDATE stu_notifications SET deleted_at=NULL"))!;
    expect(restore[1]).toEqual([ID, USER, 10]);
    await request(app).post("/n/not-an-id/read").set("Origin", origin).send({}).expect(400, { error: "invalid_input" });
  });
});
