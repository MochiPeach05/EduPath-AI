import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createStudentDataRouter } from "./router.js";
import type { DatabasePool } from "../db/pool.js";

function setup() {
  const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { session: { user: { userId: "student-id", tenantId: "tenant-id", role: "student" } } });
    next();
  });
  app.use("/student", createStudentDataRouter({ connect } as unknown as DatabasePool, "https://edupath.example"));
  return { app, query, connect };
}
const profile = { interests: null };
const legacyProfile = { className: "CNTT08", interests: null, careerGoal: "Legacy goal" };
describe("student profile writes", () => {
  it("accepts legacy class and goal fields without allowing them to overwrite stored values", async () => {
    const { app, query } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send(legacyProfile).expect(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO student_profiles"), ["student-id", null, null, null, null]);
    const insertSql = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO student_profiles"))?.[0] as string;
    expect(insertSql).not.toContain("class_name=EXCLUDED");
    expect(insertSql).not.toContain("career_goal=EXCLUDED");
  });
  it("allows a new profile request without legacy class or goal fields", async () => {
    const { app } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send(profile).expect(200);
  });
  it.each([1, 2, 3, null])("saves semester %s", async currentSemester => {
    const { app, query } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send({ ...profile, currentSemester }).expect(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO student_profiles"), ["student-id", null, null, null, currentSemester]);
  });
  it.each([0, 4, 20, 1.5, "3"])("rejects invalid semester %s before accessing the database", async currentSemester => {
    const { app, connect } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send({ ...profile, currentSemester }).expect(400);
    expect(connect).not.toHaveBeenCalled();
  });
});
describe("student specialty", () => {
  it.each(["CNPM", "CNDL", "TTNT", null])("saves specialty %s", async specialty => {
    const { app, query } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send({ ...profile, specialty }).expect(200);
    expect(query).toHaveBeenCalledWith("UPDATE student_profiles SET specialty=$2 WHERE user_id=$1", ["student-id", specialty]);
  });
  it.each([
    ["ANM", "K27", 200], ["ANM", "K29", 409], ["ANM", null, 409],
    ["KCN", "K28", 200], ["KCN", "K26", 200], ["KCN", "K29", 409],
  ] as const)("saves %s only in its cohorts (cohort %s)", async (specialty, cohort, status) => {
    const { app, query } = setup();
    query.mockImplementation(async (sql: string) => String(sql).startsWith("SELECT cohort_code")
      ? { rowCount: 1, rows: [{ cohort_code: cohort }] } : { rowCount: 1, rows: [] });
    const response = await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send({ ...profile, specialty }).expect(status);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE student_profiles SET specialty"))).toBe(status === 200);
    if (status === 409) {
      expect(response.body).toEqual({ error: "specialty_unavailable" });
      expect(query).toHaveBeenCalledWith("ROLLBACK");
    }
  });
  // 2026-10-27: each major has its own specialties (052, 053).
  it.each([
    ["HTTT_CDS", "7480104", 200], ["MMT_IOT", "7480102", 200], ["HTTT_CDS", "7480201", 409], ["CNPM", "7480104", 409], ["HTTT_GIS", null, 409],
  ] as const)("saves %s only for its major (major %s)", async (specialty, major, status) => {
    const { app, query } = setup();
    query.mockImplementation(async (sql: string) => String(sql).startsWith("SELECT cohort_code,major_code")
      ? { rowCount: 1, rows: [{ cohort_code: "K31", major_code: major }] } : { rowCount: 1, rows: [] });
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send({ ...profile, specialty }).expect(status);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE student_profiles SET specialty"))).toBe(status === 200);
  });
  it("keeps the stored specialty when the field is absent", async () => {
    const { app, query } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send(profile).expect(200);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("specialty"))).toBe(false);
  });
  it.each(["cnpm", "ATTT", "", 3])("rejects specialty %s before accessing the database", async specialty => {
    const { app, connect } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send({ ...profile, specialty }).expect(400, { error: "invalid_profile" });
    expect(connect).not.toHaveBeenCalled();
  });
});
