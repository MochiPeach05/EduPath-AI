import { describe, expect, it, vi } from "vitest";
import { catalogStampSql, createRowCache, identityOf, runLimited, STUDENTS_SQL } from "./cache.js";
import type { ReportIdentity } from "./rows.js";
import { reportRow } from "./test-rows.js";

// The row cache over fake reads: a row is computed again only when its fingerprint or the catalog changes.
type Student = { userId: string; name: string; studentCode: string | null; cohortCode: string | null; majorCode: string | null; specialty: string | null; fingerprint: string };
const student = (userId: string, fingerprint = "v1", over: Partial<Student> = {}): Student => ({
  userId, name: `Sinh Viên ${userId}`, studentCode: `99${userId}`, cohortCode: "k29 ", majorCode: "7480201", specialty: "CNPM", fingerprint, ...over,
});

function setup(students: Student[], options: { fail?: Set<string>; delay?: number } = {}) {
  const list = { students };
  const stamp = { value: "catalog-1" };
  let running = 0, maxRunning = 0;
  const computeRow = vi.fn(async (identity: ReportIdentity, now: Date) => {
    running++; maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, options.delay ?? 1));
    running--;
    if (options.fail?.has(identity.userId)) throw new Error("boom");
    return reportRow({ ...identity, computedAt: now.toISOString() });
  });
  const cache = createRowCache({ listStudents: async () => list.students, sharedStamp: async () => stamp.value, computeRow, concurrency: 2 });
  return { cache, computeRow, list, stamp, maxRunning: () => maxRunning };
}

describe("the report row cache", () => {
  it("computes each student once, then reuses the rows while nothing changed", async () => {
    const { cache, computeRow } = setup([student("1"), student("2")]);
    const first = await cache.rows(new Date("2026-10-31T02:00:00Z"));
    expect(first.rows.map((row) => row.userId)).toEqual(["1", "2"]);
    expect(first.rows[0]).toMatchObject({ cohort: "K29", specialtyCode: "CNPM", name: "Sinh Viên 1" });
    expect(computeRow).toHaveBeenCalledTimes(2);
    const second = await cache.rows(new Date("2026-10-31T03:00:00Z"));
    expect(computeRow).toHaveBeenCalledTimes(2);
    expect(second.generatedAt).toBe("2026-10-31T02:00:00.000Z");
  });

  it("recomputes a student whose inputs changed, every student after a catalog change, and forgets removed students", async () => {
    const { cache, computeRow, list, stamp } = setup([student("1"), student("2")]);
    await cache.rows(new Date("2026-10-31T02:00:00Z"));
    list.students = [student("1", "v2")];
    const after = await cache.rows(new Date("2026-10-31T03:00:00Z"));
    expect(computeRow).toHaveBeenCalledTimes(3);
    expect(after.rows.map((row) => row.userId)).toEqual(["1"]);
    expect(cache.size()).toBe(1);
    stamp.value = "catalog-2";
    await cache.rows(new Date("2026-10-31T04:00:00Z"));
    expect(computeRow).toHaveBeenCalledTimes(4);
  });

  it("computes a few at a time and shares a row being computed between requests", async () => {
    const { cache, computeRow, maxRunning } = setup(["1", "2", "3", "4", "5"].map((id) => student(id)), { delay: 5 });
    const [a, b] = await Promise.all([cache.rows(new Date()), cache.rows(new Date())]);
    expect(a.rows).toHaveLength(5);
    expect(b.rows).toHaveLength(5);
    expect(computeRow).toHaveBeenCalledTimes(5);
    expect(maxRunning()).toBeLessThanOrEqual(4);
  });

  it("counts a student whose row failed as 'Chưa đủ dữ liệu', and tries again next time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fail = new Set(["2"]);
    const { cache, computeRow } = setup([student("1"), student("2")], { fail });
    const first = await cache.rows(new Date());
    expect(first.rows.map((row) => [row.userId, row.status])).toEqual([["1", "on_track"], ["2", "unknown"]]);
    fail.clear();
    const second = await cache.rows(new Date());
    expect(second.rows.map((row) => row.status)).toEqual(["on_track", "on_track"]);
    expect(computeRow).toHaveBeenCalledTimes(3);
  });

  it("reads identities as the profiles hold them", () => {
    expect(identityOf(student("9", "x", { name: "  ", cohortCode: null, specialty: "unknown", studentCode: " " }))).toEqual({
      userId: "9", name: "(chưa có tên)", studentCode: null, cohort: null, majorCode: "7480201", specialtyCode: null,
    });
  });
});

describe("helpers", () => {
  it("run at most `limit` tasks at once", async () => {
    let running = 0, max = 0;
    const done: number[] = [];
    await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running++; max = Math.max(max, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running--; done.push(item);
    });
    expect(max).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("stamp the catalog from the tables and columns that exist only", () => {
    const sql = catalogStampSql(new Map([
      ["curricula", new Set(["id", "created_at", "updated_at"])],
      ["ad_comp_course_links", new Set(["config_id", "skill_id", "weight"])],
      ["ad_comp_skills", new Set(["id", "updated_at", "deleted_at", "version"])],
      ["not_a_catalog_table", new Set(["updated_at"])],
    ]))!;
    expect(sql).toContain("FROM curricula x");
    expect(sql).toContain("max(GREATEST(created_at,updated_at))");
    expect(sql).toContain("sum(hashtext(x::text))");
    expect(sql).toContain("string_agg(version::text");
    expect(sql).not.toContain("not_a_catalog_table");
    expect(catalogStampSql(new Map())).toBeNull();
  });

  it("list every student account with the versions of the row's inputs", () => {
    expect(STUDENTS_SQL).toContain("COALESCE(u.role_override,u.role)='student' OR u.is_student");
    for (const input of ["student_transcripts", "stu_study_plans", "stu_comp_assessments", "stu_roadmaps", "data_consents", "career_position_id"]) expect(STUDENTS_SQL).toContain(input);
  });
});
