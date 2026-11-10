import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { createReferenceCache, type ReferenceCache } from "../db/reference-cache.js";
import { createOverviewRouter } from "./router.js";

// GET /api/student/overview for a synthetic student with nothing done yet: every read answers no rows.
const NOW = new Date("2026-10-30T03:00:00Z");

function setup(options: { pool?: boolean; user?: boolean; checked?: boolean; acting?: boolean; reference?: ReferenceCache } = {}) {
  const client = { query: vi.fn(async (_sql: string) => ({ rowCount: 0, rows: [] as unknown[] })), release: vi.fn() };
  const query = vi.fn(async (sql: string) => (sql.startsWith("SELECT id FROM users") ? { rowCount: 1, rows: [{ id: "student-id" }] } : { rowCount: 0, rows: [] }));
  const pool = { query, connect: vi.fn(async () => client) } as unknown as DatabasePool;
  const app = express();
  app.use((req, res, next) => {
    const user = { userId: "student-id", tenantId: "tenant-id", role: "student" };
    Object.assign(req, { session: options.user === false ? {} : { user } });
    // app.ts: the /api check found the session's account active; an advisor acting for a student is another account.
    if (options.checked) res.locals.checkedAccount = user;
    if (options.acting) Object.assign(req, { advisorActing: { advisor: { userId: "advisor-id" }, student: { user: { userId: "student-2", tenantId: "tenant-id", role: "student" } } } });
    next();
  });
  app.use("/overview", createOverviewRouter(options.pool === false ? undefined : pool, { now: () => NOW, ...(options.reference ? { reference: options.reference } : {}) }));
  return { app, client, query };
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

  // 2026-11-10: one round trip less a request.
  it("asks the database whether the account is active only when the /api check of the request did not", async () => {
    const accountReads = (query: ReturnType<typeof setup>["query"]) => query.mock.calls.filter(([sql]) => String(sql).startsWith("SELECT id FROM users")).length;
    const checked = setup({ checked: true });
    await request(checked.app).get("/overview").expect(200);
    expect(accountReads(checked.query)).toBe(0);
    const unchecked = setup();
    await request(unchecked.app).get("/overview").expect(200);
    expect(accountReads(unchecked.query)).toBe(1);
    // An advisor acting for a student: the student account was not the one checked.
    const acting = setup({ checked: true, acting: true });
    await request(acting.app).get("/overview").expect(200);
    expect(accountReads(acting.query)).toBe(1);
  });

  it("gives the same answer with the reference cache, the student rows read in the snapshot every time", async () => {
    const plain = setup();
    const cached = setup({ reference: createReferenceCache() });
    const expected = (await request(plain.app).get("/overview").expect(200)).body;
    expect((await request(cached.app).get("/overview").expect(200)).body).toEqual(expected);
    expect((await request(cached.app).get("/overview").expect(200)).body).toEqual(expected);
    const studentReads = cached.client.query.mock.calls.filter(([sql]) => String(sql).includes("FROM student_profiles")).length;
    expect(studentReads).toBeGreaterThanOrEqual(2);
  });
});
