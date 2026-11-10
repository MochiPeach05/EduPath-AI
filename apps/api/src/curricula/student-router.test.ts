import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { CurriculumData, CurriculumCourse } from "./model.js";
import { createStudentCurriculaRouter } from "./student-router.js";

const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const curriculumId = "33333333-3333-4333-8333-333333333333";
const lockedId = "44444444-4444-4444-8444-444444444444";
const missingId = "55555555-5555-4555-8555-555555555555";

const student = {
  userId: studentId,
  identityKey: `${tenantId}:${studentId}`,
  tenantId,
  objectId: studentId,
  name: "Student User",
  email: "student@example.edu",
  username: "student@example.edu",
  role: "student",
  signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;

function course(overrides: Partial<CurriculumCourse> = {}): CurriculumCourse {
  return {
    position: 1,
    code: "71IT000001",
    name: "Introduction to Computing",
    englishName: "Introduction to Computing",
    description: "  A public course description.  ",
    credits: 3,
    type: "BB",
    block: "General",
    specialty: "",
    semester: 1,
    studyYear: 1,
    department: "Computer Science",
    departmentCode: "CS",
    hours: {
      lecture: 30,
      practice: 15,
      project: null,
      internship: null,
    },
    groupId: "general",
    sourceRow: 12,
    sourceSheet: "K29",
    sourceCells: { A: "secret source cell" },
    notes: "Internal note",
    prerequisite: "",
    prior: "",
    ...overrides,
  };
}

const curriculum: CurriculumData = {
  schemaVersion: 1,
  name: "Bachelor of Computing",
  major: "Information Technology",
  cohortCode: "K29",
  admissionYear: 2023,
  totalCredits: 126,
  notes: "Administrative notes must stay private",
  courses: [course()],
  groups: [{ id: "general", label: "General knowledge", credits: 3, sourceRow: 10 }],
  electives: [{ code: "TC001", requiredCredits: 3, courseCodes: ["71IT000001"] }],
  relations: [
    {
      courseCode: "71IT000001",
      kind: "prerequisite",
      raw: "71IT000002",
      targetCodes: ["71IT000002"],
      unresolvedCodes: [],
      reviewRequired: false,
    },
  ],
  warnings: [{ row: 12, message: "Administrative warning" }],
  sourceWarnings: [{ row: 12, message: "Source warning" }],
};

const activeListRow = {
  id: curriculumId,
  cohortCode: "K29",
  name: curriculum.name,
  major: curriculum.major,
  totalCredits: curriculum.totalCredits,
  courseCount: curriculum.courses.length,
  version: 2,
};
/** An active CTĐT as the own-curriculum query reads it (own-program.ts), with its identity major:cohort. */
const ownRow = (row: typeof activeListRow, identityKey: string) => ({ ...row, identityKey });
const k29Cntt = ownRow(activeListRow, "cong nghe thong tin:K29");
const k29Httt = ownRow({ ...activeListRow, id: "11111111-2222-4333-8444-555555555555", major: "HỆ THỐNG THÔNG TIN" }, "he thong thong tin:K29");
const k30Cntt = ownRow({ ...activeListRow, id: "66666666-6666-4666-8666-666666666666", cohortCode: "K30" }, "cong nghe thong tin:K30");

type SetupOptions = {
  sessionUser?: AuthenticatedUser | null;
  active?: boolean;
  profileCohort?: string | null;
  profileMajor?: string | null;
  /** Every active CTĐT; the own-curriculum query keeps those of the cohort and major it is asked for. */
  curricula?: ReturnType<typeof ownRow>[];
  detailRows?: unknown[];
  /** Acting mode: the student another account works for (X-Advisor-Student, advisors/access.ts). */
  acting?: AuthenticatedUser;
};

function setup(options: SetupOptions = {}) {
  const sessionUser = options.sessionUser === null ? undefined : options.sessionUser ?? student;
  const curricula = options.curricula ?? [k29Cntt, k29Httt, k30Cntt];
  const profileCohort = options.profileCohort === undefined ? "K29" : options.profileCohort;
  const profileMajor = options.profileMajor === undefined ? "7480201" : options.profileMajor;
  const detailRows = options.detailRows ?? [{ id: curriculumId, version: 2, data: curriculum }];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT id FROM users")) {
      return {
        rowCount: options.active === false ? 0 : 1,
        rows: options.active === false ? [] : [{ id: studentId }],
      };
    }
    if (sql.includes("SELECT cohort_code,major_code FROM student_profiles")) {
      return { rowCount: profileCohort ? 1 : 0, rows: profileCohort ? [{ cohort_code: profileCohort, major_code: profileMajor }] : [] };
    }
    if (sql.includes('c.identity_key AS "identityKey"')) {
      const [cohort, major] = params as [string, string | null];
      const rows = curricula.filter((row) => row.cohortCode === cohort && (major === null || row.identityKey.split(":")[0] === major));
      return { rowCount: rows.length, rows };
    }
    if (sql.includes("SELECT c.id,r.version,r.data")) return { rowCount: detailRows.length, rows: detailRows };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: sessionUser } as typeof req.session;
    if (options.acting) req.advisorActing = { advisor: sessionUser!, student: { user: options.acting } } as typeof req.advisorActing;
    next();
  });
  app.use("/curricula", createStudentCurriculaRouter({ query } as unknown as DatabasePool));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, query };
}

function queryText(query: ReturnType<typeof setup>["query"]) {
  return query.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("student curriculum API", () => {
  it("requires authentication and rejects a blocked account before reading curricula", async () => {
    const unauthenticated = setup({ sessionUser: null });
    await request(unauthenticated.app).get("/curricula").expect(401);
    expect(unauthenticated.query).not.toHaveBeenCalled();

    const blocked = setup({ active: false });
    const response = await request(blocked.app).get("/curricula").expect(403);
    expect(response.body).toEqual({ error: "account_unavailable" });
    expect(blocked.query).toHaveBeenCalledTimes(1);
  });

  // User 2026-11-10: no choice of CTĐT, only the student's own, as Xét tốt nghiệp shows only the student's own standard.
  it("lists only the student's own CTĐT: the cohort in the account and the major of the MSSV, as the engine picks it", async () => {
    const { app, query } = setup();
    const response = await request(app).get("/curricula").expect(200);

    expect(response.body).toEqual({
      items: [activeListRow],
      profileCohort: "K29",
      profileMajor: "7480201",
      resolution: "found",
      suggestedId: curriculumId,
    });
    expect(queryText(query)).toContain("WHERE c.is_active AND c.cohort_code=$1 AND ($2::text IS NULL OR split_part(c.identity_key, ':', 1) = $2)");
    expect(queryText(query)).toContain("JOIN curriculum_revisions r ON r.id=c.current_revision");
    expect(query.mock.calls.find(([sql]) => String(sql).includes('"identityKey"'))?.[1]).toEqual(["K29", "cong nghe thong tin"]);
  });

  // 2026-10-27: a cohort may have a CTĐT per major; the student's is the one of the major in the MSSV.
  it("takes the CTĐT of the student's major when the cohort has several, and none without a major", async () => {
    const asHttt = (await request(setup({ profileMajor: "7480104" }).app).get("/curricula").expect(200)).body;
    expect(asHttt).toMatchObject({ resolution: "found", suggestedId: k29Httt.id, items: [{ id: k29Httt.id, major: "HỆ THỐNG THÔNG TIN" }] });
    expect(asHttt.items[0]).not.toHaveProperty("identityKey");
    // Without a major (no MSSV) a cohort with two CTĐT is ambiguous: nothing is shown.
    const noMajor = (await request(setup({ profileMajor: null }).app).get("/curricula").expect(200)).body;
    expect(noMajor).toEqual({ items: [], profileCohort: "K29", profileMajor: null, resolution: "ambiguous", suggestedId: null });
    // A cohort with one CTĐT takes it without a major, as before majors.
    expect((await request(setup({ profileMajor: null, curricula: [k29Cntt, k30Cntt] }).app).get("/curricula").expect(200)).body)
      .toMatchObject({ resolution: "found", suggestedId: curriculumId });
  });

  it("never falls back to another cohort or major: not_found, and cohort_unknown without a cohort", async () => {
    const k32 = (await request(setup({ profileCohort: "K32" }).app).get("/curricula").expect(200)).body;
    expect(k32).toEqual({ items: [], profileCohort: "K32", profileMajor: "7480201", resolution: "not_found", suggestedId: null });
    const mmt = (await request(setup({ profileMajor: "7480102" }).app).get("/curricula").expect(200)).body;
    expect(mmt).toMatchObject({ items: [], resolution: "not_found", suggestedId: null });

    const { app, query } = setup({ profileCohort: null });
    expect((await request(app).get("/curricula").expect(200)).body)
      .toEqual({ items: [], profileCohort: null, profileMajor: null, resolution: "cohort_unknown", suggestedId: null });
    expect(queryText(query)).not.toContain("FROM curricula");
  });

  it("reads the cohort as the engine does (trimmed, upper case)", async () => {
    const { app, query } = setup({ profileCohort: " k29 " });
    expect((await request(app).get("/curricula").expect(200)).body).toMatchObject({ profileCohort: "K29", suggestedId: curriculumId });
    expect(query.mock.calls.find(([sql]) => String(sql).includes('"identityKey"'))?.[1]).toEqual(["K29", "cong nghe thong tin"]);
  });

  it("serves the CTĐT of the student a staff account works for (acting mode)", async () => {
    const acted = { ...student, userId: "77777777-7777-4777-8777-777777777777" } satisfies AuthenticatedUser;
    const { app, query } = setup({ sessionUser: { ...student, role: "admin" }, acting: acted });
    await request(app).get("/curricula").expect(200);
    expect(query.mock.calls.find(([sql]) => String(sql).includes("FROM student_profiles"))?.[1]).toEqual([acted.userId]);
  });

  it("projects detail data without administrative fields and preserves public conditions", async () => {
    const { app } = setup();
    const response = await request(app).get(`/curricula/${curriculumId}`).expect(200);
    const body = response.body;

    expect(body).toMatchObject({
      id: curriculumId,
      version: 2,
      name: curriculum.name,
      major: curriculum.major,
      cohortCode: curriculum.cohortCode,
      admissionYear: curriculum.admissionYear,
      totalCredits: curriculum.totalCredits,
    });
    expect(body.courses[0]).toMatchObject({
      code: "71IT000001",
      description: "A public course description.",
      conditions: [{ kind: "prerequisite", targetCodes: ["71IT000002"], reviewRequired: false }],
      scheduleNeedsReview: false,
    });
    expect(body).not.toHaveProperty("data");
    for (const key of ["notes", "warnings", "sourceWarnings", "history", "events", "sourceFilename", "token", "isActive"]) {
      expect(body).not.toHaveProperty(key);
    }
    for (const key of ["position", "sourceRow", "sourceSheet", "sourceCells", "departmentCode"]) {
      expect(body.courses[0]).not.toHaveProperty(key);
    }
  });

  it("shows a row repeated with the same code, group and type once, and keeps the same code in another group (audit 2026-10-25)", async () => {
    // K26 lists DIT0330 twice in TC206; K27 lists 71ITDS40503 under two specialties.
    const relation = curriculum.relations[0]!;
    const repeated: CurriculumData = {
      ...curriculum,
      courses: [
        course(),
        course({ position: 2, sourceRow: 40 }),
        course({ position: 3, sourceRow: 50, groupId: "major", type: "TC203", specialty: "Công nghệ Dữ liệu" }),
      ],
      relations: [relation, { ...relation }],
    };
    const { app } = setup({ detailRows: [{ id: curriculumId, version: 2, data: repeated }] });
    const body = (await request(app).get(`/curricula/${curriculumId}`).expect(200)).body;
    expect(body.courses.map((c: { code: string; groupId: string; type: string }) => [c.code, c.groupId, c.type])).toEqual([
      ["71IT000001", "general", "BB"], ["71IT000001", "major", "TC203"],
    ]);
    expect(body.courses[0].conditions).toEqual([{ kind: "prerequisite", targetCodes: ["71IT000002"], reviewRequired: false }]);
  });

  it.each([lockedId, missingId])("returns 404 for locked or nonexistent framework %s", async (id) => {
    const { app, query } = setup({ curricula: [ownRow({ ...activeListRow, id }, "cong nghe thong tin:K29")], detailRows: [] });
    const response = await request(app).get(`/curricula/${id}`).expect(404);
    expect(response.body).toEqual({ error: "curriculum_unavailable" });
    expect(queryText(query)).toContain("WHERE c.id=$1 AND c.is_active");
  });

  it("refuses another cohort's or major's CTĐT, even an active one, without reading it", async () => {
    for (const other of [k29Httt.id, k30Cntt.id]) {
      const { app, query } = setup();
      expect((await request(app).get(`/curricula/${other}`).expect(404)).body).toEqual({ error: "curriculum_unavailable" });
      expect(queryText(query)).not.toContain("SELECT c.id,r.version,r.data");
    }
    // Without a CTĐT of their own a student opens none.
    await request(setup({ profileCohort: "K32" }).app).get(`/curricula/${curriculumId}`).expect(404);
  });

  it("rejects historical revision queries instead of exposing an older revision", async () => {
    const { app, query } = setup();
    const response = await request(app).get(`/curricula/${curriculumId}?revision=${missingId}`).expect(400);
    expect(response.body).toEqual({ error: "invalid_curriculum_query" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("allows GET and HEAD while rejecting every write method", async () => {
    const { app } = setup();
    await request(app).get("/curricula").expect(200);
    await request(app).head("/curricula").expect(200);
    for (const response of await Promise.all([
      request(app).post("/curricula"),
      request(app).put(`/curricula/${curriculumId}`),
      request(app).patch(`/curricula/${curriculumId}`),
      request(app).delete(`/curricula/${curriculumId}`),
    ])) {
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET, HEAD");
      expect(response.body).toEqual({ error: "read_only" });
    }
  });
});
