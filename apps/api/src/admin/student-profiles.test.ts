import express from "express";
import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AccountError } from "./accounts.js";
import { createStudentProfilesRouter, PostgresStudentProfileRepository } from "./student-profiles.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import type { AuthenticatedUser, AppRole } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";

const seedBatch = "edupath-demo-2026-10-02";
const seedId = (index: number) => createHash("md5").update(`${seedBatch}:${index}`).digest("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.*)$/, "$1-$2-$3-$4-$5");
const seedStudentIds = Array.from({ length: 45 }, (_, index) => seedId(index + 1));
const id = seedId(1);
const actor = { userId: "admin", tenantId: "tenant", role: "admin" } as AuthenticatedUser;
function setup(role: AppRole | null = "admin", available = true) {
  const repository = { list: vi.fn().mockResolvedValue({ items: [], total: 0, cohortYears: [2023], cohortCodes: ["K29"] }), detail: vi.fn().mockResolvedValue({ id, profileStatus: "missing" }),
    transcript: vi.fn().mockResolvedValue({ transcript: null }) };
  const authorization = { canAccessAdmin: vi.fn().mockResolvedValue(true) };
  const app = express();
  app.use((req, _res, next) => { req.session = { user: role ? { ...actor, role } : undefined } as typeof req.session; next(); });
  app.use("/students", createStudentProfilesRouter(available ? repository : undefined, authorization));
  return { app, repository, authorization };
}
describe("student profile read API", () => {
  it.each([[null, 401], ["student", 403]] as const)("blocks role %s", async (role, status) => {
    const { app, repository } = setup(role);
    await request(app).get("/students").expect(status); await request(app).get(`/students/${id}`).expect(status);
    expect(repository.list).not.toHaveBeenCalled(); expect(repository.detail).not.toHaveBeenCalled();
  });
  it.each(["faculty_board", "department_head", "lecturer"] as const)("allows %s to read student lists and details", async role => {
    const { app } = setup(role);
    await request(app).get("/students").expect(200);
    await request(app).get(`/students/${id}`).expect(200);
  });
  it("rejects stale Admin sessions using current database authorization", async () => {
    const { app, authorization, repository } = setup(); authorization.canAccessAdmin.mockResolvedValue(false);
    await request(app).get("/students").expect(403); await request(app).get(`/students/${id}`).expect(403);
    expect(repository.list).not.toHaveBeenCalled();
  });
  it("returns 503 in preview mode without pretending data was loaded", async () => {
    await request(setup("admin", false).app).get("/students").expect(503);
  });
  it("returns a no-store paginated response", async () => {
    const { app, repository } = setup(); const result = await request(app).get("/students").expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toEqual({ items: [], total: 0, cohortYears: [2023], cohortCodes: ["K29"], page: 1, pageSize: 10 });
    expect(repository.list).toHaveBeenCalledWith(actor, { q: "", page: 1, pageSize: 10 });
  });
  it("combines bounded search and all supported filters", async () => {
    const { app, repository } = setup();
    await request(app).get("/students").query({ q: "  23748  ", page: 2, pageSize: 20, cohortYear: 2023, cohortCode: "K29", active: "false", profileStatus: "incomplete" }).expect(200);
    expect(repository.list).toHaveBeenCalledWith(actor, { q: "23748", page: 2, pageSize: 20, cohortYear: 2023, cohortCode: "K29", active: "false", profileStatus: "incomplete" });
  });
  it.each(["page=0", "pageSize=51", "page=1&page=2", "cohortYear=1999", "cohortYear=2101", "cohortYear=2023.5", "cohortYear=abc", "cohortCode=29", "cohortCode=bad", "cohortCode=K29&cohortCode=K30", "semester=0", "semester=4", "semester=20", "semester=21", "semester=1.5", "active=yes", "profileStatus=all", "tenantId=other", "role=admin", "sort=email", "sort=name%3B", "sort=name&sort=cohortYear", "dir=down"])("rejects invalid filters %s", async (query) => {
    const { app, repository } = setup(); await request(app).get(`/students?${query}`).expect(400); expect(repository.list).not.toHaveBeenCalled();
  });
  it("passes a column sort to the repository", async () => {
    const { app, repository } = setup();
    await request(app).get("/students").query({ sort: "name", dir: "desc", page: 2 }).expect(200);
    expect(repository.list).toHaveBeenCalledWith(actor, { q: "", page: 2, pageSize: 10, sort: "name", dir: "desc" });
  });
  it("rejects oversized keywords and malformed ids", async () => {
    const { app, repository } = setup(); await request(app).get("/students").query({ q: "x".repeat(121) }).expect(400);
    const response = await request(app).get("/students/not-uuid").expect(400);
    expect(response.body).toEqual({ error: "invalid_student_id" });
    expect(repository.detail).not.toHaveBeenCalled();
  });
  it("accepts every deterministic MD5 UUID used by the 45-record demo batch", async () => {
    const { app, repository } = setup("lecturer");
    for (const seedStudentId of seedStudentIds) await request(app).get(`/students/${seedStudentId}`).expect(200);
    expect(repository.detail.mock.calls.map(([, requestedId]) => requestedId)).toEqual(seedStudentIds);
  });
  it("allows a missing profile detail and returns 404 for inaccessible students", async () => {
    const { app, repository } = setup(); const response = await request(app).get(`/students/${id}`).expect(200);
    expect(response.body.student.profileStatus).toBe("missing"); expect(repository.detail).toHaveBeenCalledWith(actor, id);
    repository.detail.mockRejectedValue(new AccountError("student_not_found", 404));
    expect((await request(app).get(`/students/${id}`).expect(404)).body.error).toBe("student_not_found");
  });
  it.each(["post", "patch", "delete"] as const)("exposes no %s write endpoint", async (method) => {
    await request(setup().app)[method](`/students/${id}`).expect(404);
  });
});
describe("student profile SQL safety", () => {
  it("uses a left join and effective Student role across tenants with parameterized filters", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total: 0, cohortYears: [], cohortCodes: [] }] });
    const repo = new PostgresStudentProfileRepository({ query } as unknown as DatabasePool);
    await repo.list(actor, { q: "' OR 1=1 --", page: 2, pageSize: 10, cohortYear: 2023, cohortCode: "K29", active: "false", profileStatus: "incomplete" });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("LEFT JOIN student_profiles"); expect(sql).not.toContain("u.entra_tenant_id =");
    expect(sql).toContain("COALESCE(u.role_override, u.role) = 'student'");
    expect(sql).not.toContain("' OR 1=1 --"); expect(sql).not.toContain("SELECT * FROM users");
    expect(values).toEqual(["' OR 1=1 --", 2023, "K29", "false", "incomplete", 10, 10]);
  });
  it("numbers the rows in the list's own order and sorts the whole list by a known column before paging", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total: 0, cohortYears: [], cohortCodes: [] }] });
    const repo = new PostgresStudentProfileRepository({ query } as unknown as DatabasePool);
    await repo.list(actor, { q: "", page: 3, pageSize: 10, sort: "cohortYear", dir: "desc" });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("row_number() OVER (ORDER BY name ASC, id ASC)::int AS stt FROM filtered");
    expect(sql).toContain('FROM numbered ORDER BY "cohortYear" DESC NULLS LAST, name ASC, id ASC LIMIT $6 OFFSET $7');
    expect(sql).toContain('json_agg(paged ORDER BY "cohortYear" DESC NULLS LAST, name ASC, id ASC)');
    expect(values).toEqual(["", null, null, null, null, 10, 20]);
  });
  it("does not return absent or non-student details", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] }); const repo = new PostgresStudentProfileRepository({ query } as unknown as DatabasePool);
    await expect(repo.detail(actor, id)).rejects.toMatchObject({ code: "student_not_found", status: 404 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("COALESCE(u.role_override, u.role) = 'student'"), [id, null]);
  });
  it("returns the stored specialty with the detail (also used by /api/student/profile)", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id, profileStatus: "incomplete", specialty: "CNDL" }] });
    const repo = new PostgresStudentProfileRepository({ query } as unknown as DatabasePool);
    await expect(repo.detail(actor, id)).resolves.toMatchObject({ specialty: "CNDL" });
    expect(String(query.mock.calls[0]![0])).toContain("p.specialty");
    // The major of the MSSV (migration 052) is shown to the student and the admin.
    expect(String(query.mock.calls[0]![0])).toContain('p.major_code AS "majorCode"');
  });
});

// User, 2026-10-25: admins see a student's transcript like the student page; 2026-10-26: every stored transcript, those
// imported before policy 2026-10-26 included ("Những bảng điểm trước đó auto duyệt hết đi").
describe("student transcript for admins", () => {
  const data = (): TranscriptData => ({
    schemaVersion: 1, parserVersion: "vlu-ocr-1.1", pageCount: 1, courseCount: 1, warnings: [],
    sections: [{ id: "2021-2022-HK02", academicYear: "2021-2022", semester: "HK02", label: "2021-2022 · HK02", summaries: [],
      courses: [{ ordinal: 3, code: "71ITNW30103", name: "Nhập môn mạng", credits: 3, score10: 4.1, score4: 1.64, letter: "F", result: "Đạt", conditional: false, sourcePage: 1, review: ["result_conflicts_with_grade"] }] }],
  });
  it("serves GET /:id/transcript to admins only, by student id", async () => {
    const { app, repository } = setup();
    expect((await request(app).get(`/students/${id}/transcript`).expect(200)).body).toEqual({ transcript: null });
    expect(repository.transcript).toHaveBeenCalledWith(actor, id);
    await request(app).get("/students/not-uuid/transcript").expect(400);
    const student = setup("student");
    await request(student.app).get(`/students/${id}/transcript`).expect(403);
    expect(student.repository.transcript).not.toHaveBeenCalled();
  });
  it("reads every stored transcript whatever policy the student agreed to, without marks that are not errors", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ updatedAt: "2026-10-25T10:00:00.000Z", data: data() }] });
    const view = await new PostgresStudentProfileRepository({ query } as unknown as DatabasePool).transcript(actor, id);
    expect(Object.keys(view.transcript ?? {})).toEqual(["updatedAt", "data"]);
    expect(view.transcript?.data.sections[0]?.courses[0]).not.toHaveProperty("review");
    expect(String(query.mock.calls[0]![0])).not.toContain("data_consents");
    const none = vi.fn().mockResolvedValueOnce({ rows: [{ updatedAt: null, data: null }] });
    expect(await new PostgresStudentProfileRepository({ query: none } as unknown as DatabasePool).transcript(actor, id)).toEqual({ transcript: null });
    const missing = vi.fn().mockResolvedValueOnce({ rows: [] });
    await expect(new PostgresStudentProfileRepository({ query: missing } as unknown as DatabasePool).transcript(actor, id)).rejects.toMatchObject({ code: "student_not_found" });
  });
  // Nhật ký thao tác (AD-REPORT-12, 2026-10-31): who looked at whose grades, never the grades.
  it("logs each view of a stored transcript, with the student's MSSV and name only", async () => {
    const viewer = { userId: "3f2b8c1e-5d4a-4b6f-9a1e-2c3d4e5f6a7b", tenantId: "tenant", name: "Lê Quốc Bảo", role: "lecturer" } as AuthenticatedUser;
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ updatedAt: "2026-10-25T10:00:00.000Z", data: data(), studentCode: "2374802019917", name: "Nguyễn Minh Khoa" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await new PostgresStudentProfileRepository({ query } as unknown as DatabasePool).transcript(viewer, id);
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, values] = query.mock.calls[1]!;
    expect(String(sql)).toContain("INSERT INTO ad_audit_log");
    expect(values).toEqual(expect.arrayContaining([viewer.userId, "Lê Quốc Bảo", "lecturer", "access", "Xem bảng điểm",
      "Xem bảng điểm của sinh viên 2374802019917 Nguyễn Minh Khoa", "student", id, "GET", `/api/admin/students/${id}/transcript`]));
    expect(JSON.stringify(values)).not.toContain("Nhập môn mạng");
    // Nothing to log when no transcript is stored.
    const none = vi.fn().mockResolvedValueOnce({ rows: [{ updatedAt: null, data: null, studentCode: "2374802019917", name: "Nguyễn Minh Khoa" }] });
    await new PostgresStudentProfileRepository({ query: none } as unknown as DatabasePool).transcript(viewer, id);
    expect(none).toHaveBeenCalledTimes(1);
  });
});
