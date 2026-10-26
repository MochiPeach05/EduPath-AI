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

type SetupOptions = {
  sessionUser?: AuthenticatedUser | null;
  active?: boolean;
  profileCohort?: string | null;
  profileMajor?: string | null;
  listRows?: unknown[];
  detailRows?: unknown[];
};

function setup(options: SetupOptions = {}) {
  const sessionUser = options.sessionUser === null ? undefined : options.sessionUser ?? student;
  const listRows = options.listRows ?? [activeListRow];
  const detailRows = options.detailRows ?? [{ id: curriculumId, version: 2, data: curriculum }];
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT id FROM users")) {
      return {
        rowCount: options.active === false ? 0 : 1,
        rows: options.active === false ? [] : [{ id: studentId }],
      };
    }
    if (sql.includes("SELECT cohort_code,major_code FROM student_profiles")) {
      return { rowCount: options.profileCohort ? 1 : 0, rows: options.profileCohort ? [{ cohort_code: options.profileCohort, major_code: options.profileMajor ?? null }] : [] };
    }
    if (sql.includes("SELECT c.id,c.cohort_code")) return { rowCount: listRows.length, rows: listRows };
    if (sql.includes("SELECT c.id,r.version,r.data")) return { rowCount: detailRows.length, rows: detailRows };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: sessionUser } as typeof req.session;
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

  it("lists active frameworks and suggests the one matching the student cohort", async () => {
    const { app, query } = setup({ listRows: [activeListRow], profileCohort: "K29" });
    const response = await request(app).get("/curricula").expect(200);

    expect(response.body).toEqual({
      items: [activeListRow],
      profileCohort: "K29",
      suggestedId: curriculumId,
    });
    expect(queryText(query)).toContain("WHERE c.is_active");
    expect(queryText(query)).toContain("JOIN curriculum_revisions r ON r.id=c.current_revision");
  });

  // 2026-10-27: a cohort may have a framework per major; the student's is the one of the major in the MSSV.
  it("suggests the framework of the student's major when the cohort has several", async () => {
    const cntt = { ...activeListRow, major: "CÔNG NGHỆ THÔNG TIN" };
    const httt = { ...activeListRow, id: "11111111-2222-4333-8444-555555555555", major: "HỆ THỐNG THÔNG TIN" };
    const asHttt = (await request(setup({ listRows: [cntt, httt], profileCohort: "K29", profileMajor: "7480104" }).app).get("/curricula").expect(200)).body;
    expect(asHttt.suggestedId).toBe(httt.id);
    const asCntt = (await request(setup({ listRows: [cntt, httt], profileCohort: "K29", profileMajor: "7480201" }).app).get("/curricula").expect(200)).body;
    expect(asCntt.suggestedId).toBe(curriculumId);
    // Without a major (no MSSV) a cohort with two frameworks suggests none, as before.
    expect((await request(setup({ listRows: [cntt, httt], profileCohort: "K29" }).app).get("/curricula").expect(200)).body.suggestedId).toBeNull();
  });

  it("does not fall back to another cohort when the profile cohort is unmatched", async () => {
    const { app } = setup({ profileCohort: "K32" });
    const response = await request(app).get("/curricula").expect(200);

    expect(response.body.profileCohort).toBe("K32");
    expect(response.body.items).toHaveLength(1);
    expect(response.body.suggestedId).toBeNull();
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
    const { app, query } = setup({ detailRows: [] });
    const response = await request(app).get(`/curricula/${id}`).expect(404);
    expect(response.body).toEqual({ error: "curriculum_unavailable" });
    expect(queryText(query)).toContain("WHERE c.id=$1 AND c.is_active");
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
