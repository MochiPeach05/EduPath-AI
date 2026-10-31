import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { createOverviewRouter } from "./router.js";

// GET /api/student/overview for a synthetic student with nothing done yet: every read answers no rows.
const NOW = new Date("2026-10-30T03:00:00Z");

function setup(options: { pool?: boolean; user?: boolean } = {}) {
  const client = { query: vi.fn(async (_sql: string) => ({ rowCount: 0, rows: [] as unknown[] })), release: vi.fn() };
  const query = vi.fn(async (sql: string) => (sql.startsWith("SELECT id FROM users") ? { rowCount: 1, rows: [{ id: "student-id" }] } : { rowCount: 0, rows: [] }));
  const pool = { query, connect: vi.fn(async () => client) } as unknown as DatabasePool;
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { session: options.user === false ? {} : { user: { userId: "student-id", tenantId: "tenant-id", role: "student" } } });
    next();
  });
  app.use("/overview", createOverviewRouter(options.pool === false ? undefined : pool, { now: () => NOW }));
  return { app, client };
}

describe("GET /api/student/overview", () => {
  it("needs a signed-in student and a database, and takes no query", async () => {
    await request(setup({ user: false }).app).get("/overview").expect(401);
    await request(setup({ pool: false }).app).get("/overview").expect(503, { error: "database_required" });
    await request(setup().app).get("/overview?x=1").expect(400, { error: "invalid_input" });
  });

  it("answers a student without data with empty sections, the missing-data warning and the setup questions", async () => {
    const { app, client } = setup();
    const response = await request(app).get("/overview").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      generatedAt: NOW.toISOString(),
      profile: { cohortCode: null, majorName: null, specialtyName: null, careerName: null },
      readiness: { transcript: false, specialty: false, career: false, survey: false, assessment: false, roadmap: false },
      terms: { studying: null, next: { code: "HK262", label: "HK2 2026–2027", start: "2026-12-21", end: "2027-04-04", daysUntil: 52 } },
      transcript: null, progress: null, graduation: null, competency: null, roadmap: null, running: [],
      warnings: { level: "none", items: [expect.objectContaining({ kind: "missing_data", key: "missing:transcript" })] },
      suggestions: [
        "Làm sao để import bảng điểm PDF?", "Làm sao để chọn chuyên ngành và vị trí nghề nghiệp mục tiêu?", "Khảo sát định hướng dùng để làm gì?",
        "Làm sao để chạy Đánh giá năng lực?", "Điều kiện xét tốt nghiệp của khóa mình là gì?", "EduPath AI dùng dữ liệu của mình như thế nào?",
      ],
    });
    // One read-only snapshot.
    expect(client.query.mock.calls[0]?.[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
