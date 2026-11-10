import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { PlanData } from "./model.js";
import { createStudentPlansRouter } from "./student-router.js";

const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
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

const plan: PlanData = {
  schemaVersion: 1,
  name: "Bachelor of Computing plan",
  major: "Information Technology",
  cohortCode: "K29",
  admissionYear: 2023,
  totalCredits: 126,
  notes: "Administrative plan notes",
  items: [
    {
      id: "row-1",
      position: 1,
      code: "71IT000001",
      name: "Introduction to Computing",
      credits: 3,
      type: "BB",
      termCode: "HK011",
      semester: 1,
      studyYear: 1,
      sectionId: "section-1",
      prerequisite: "",
      prior: "",
      notes: "Student-facing item note",
      hours: {
        lecture: 30,
        practice: 15,
        project: null,
        internship: null,
      },
      sourceRow: 12,
      sourceSheet: "K29",
      sourceCells: { A: "secret source value" },
    },
  ],
  terms: [
    { code: "HK011", semester: 1, studyYear: 1, sourceCredits: 20 },
  ],
  sections: [
    {
      id: "section-1",
      termCode: "HK011",
      label: "Required courses",
      kind: "choice",
      sourceRow: 10,
    },
  ],
  sourceWarnings: [{ row: 12, message: "Internal source warning" }],
  warnings: [{ row: 12, message: "Internal review warning" }],
  curriculum: {
    id: "66666666-6666-4666-8666-666666666666",
    revisionId: "77777777-7777-4777-8777-777777777777",
    version: 2,
    name: "Linked curriculum",
  },
};

const activeListRow = {
  id: planId,
  cohortCode: "K29",
  name: plan.name,
  major: plan.major,
  totalCredits: plan.totalCredits,
  itemCount: plan.items.length,
  version: 2,
};
const k27CurriculumId = "88888888-8888-4888-8888-888888888888";
const k29CurriculumId = "99999999-9999-4999-8999-999999999999";
/** An active CTĐT as the own-curriculum query reads it (curricula/own-program.ts). */
const curriculumRow = (id: string, cohortCode: string, identityKey: string, major = "Information Technology") =>
  ({ id, identityKey, cohortCode, name: `CTĐT ${cohortCode}`, major, totalCredits: 130, courseCount: 3, version: 1 });
/** An active KHĐT as the own-plan query reads it; linkedTo: the CTĐT its revision was linked to. */
const planRow = (row: typeof activeListRow, identityKey: string, linkedTo: string | null = null) =>
  ({ ...row, identityKey, dataCohort: row.cohortCode, linkedTo });
const k29Plan = planRow(activeListRow, "information technology:K29", k29CurriculumId);

type SetupOptions = {
  sessionUser?: AuthenticatedUser | null;
  active?: boolean;
  profileCohort?: string | null;
  profileMajor?: string | null;
  /** Every active CTĐT and KHĐT; the own queries keep those of the cohort and major they are asked for. */
  curricula?: ReturnType<typeof curriculumRow>[];
  plans?: ReturnType<typeof planRow>[];
  detailRows?: unknown[];
  /** The CTĐT courses of the plan's identity (physical education groups). */
  curriculumRows?: unknown[];
  /** The CTĐT a plan is read from (ctdt-<id>). */
  curriculumDetailRows?: unknown[];
  /** Acting mode: the student another account works for (X-Advisor-Student, advisors/access.ts). */
  acting?: AuthenticatedUser;
};

/** The rows of an identity major:cohort for the cohort $1 and the major $2 of majorCondition (null: any). */
const ofCohortAndMajor = <T extends { cohortCode: string; identityKey: string }>(rows: T[], params: unknown[]) =>
  rows.filter((row) => row.cohortCode === params[0] && (params[1] === null || row.identityKey.split(":")[0] === params[1]));

function setup(options: SetupOptions = {}) {
  const sessionUser =
    options.sessionUser === null ? undefined : options.sessionUser ?? student;
  const profileCohort = options.profileCohort === undefined ? "K29" : options.profileCohort;
  // The fixtures name their major in English: by default the profile has no major (no MSSV) and takes the cohort's.
  const profileMajor = options.profileMajor ?? null;
  const curricula = options.curricula ?? [curriculumRow(k29CurriculumId, "K29", "information technology:K29")];
  const plans = options.plans ?? [k29Plan];
  const detailRows = options.detailRows ?? [{ id: planId, version: 2, data: plan }];
  const curriculumRows = options.curriculumRows ?? [];
  const curriculumDetailRows = options.curriculumDetailRows ?? [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT id FROM users")) {
      return {
        rowCount: options.active === false ? 0 : 1,
        rows: options.active === false ? [] : [{ id: studentId }],
      };
    }
    if (sql.includes("SELECT cohort_code,major_code FROM student_profiles")) {
      return {
        rowCount: profileCohort ? 1 : 0,
        rows: profileCohort ? [{ cohort_code: profileCohort, major_code: profileMajor }] : [],
      };
    }
    if (sql.includes('c.identity_key AS "identityKey"')) {
      const rows = ofCohortAndMajor(curricula, params);
      return { rowCount: rows.length, rows };
    }
    if (sql.includes("FROM training_plans p")) {
      // The KHĐT query keeps neither the identity nor the link: it answers "linked" for the CTĐT $3.
      const rows = ofCohortAndMajor(plans, params).map(({ identityKey: _identity, linkedTo, ...row }) => ({ ...row, linked: linkedTo !== null && linkedTo === params[2] }));
      return { rowCount: rows.length, rows };
    }
    if (sql.includes("SELECT c.id,r.version,r.data"))
      return { rowCount: detailRows.length, rows: detailRows };
    if (sql.includes("SELECT c.id,r.data FROM curricula c"))
      return { rowCount: curriculumDetailRows.length, rows: curriculumDetailRows };
    if (sql.includes("r.data->'courses' AS courses FROM curricula c"))
      return { rowCount: curriculumRows.length, rows: curriculumRows };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: sessionUser } as typeof req.session;
    if (options.acting) req.advisorActing = { advisor: sessionUser!, student: { user: options.acting } } as typeof req.advisorActing;
    next();
  });
  app.use(
    "/plans",
    createStudentPlansRouter({ query } as unknown as DatabasePool),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : "unexpected_error" });
    },
  );
  return { app, query };
}

function queryText(query: ReturnType<typeof setup>["query"]) {
  return query.mock.calls.map((call) => String(call[0])).join("\n");
}

/** The CTĐT of K27 as stored, for the plan read from it. */
function k27Data() {
  const course = (position: number, code: string, studyYear: number | null, semester: number | null, type = "BB") => ({
    position, code, name: `Course ${code}`, englishName: "", credits: 3, type, block: "", specialty: "", semester, studyYear,
    prerequisite: "", prior: "", notes: "internal", department: "", departmentCode: "", groupId: "g", sourceRow: position, sourceSheet: "K27", sourceCells: {},
    hours: { lecture: 30, practice: 30, project: null, internship: null } });
  return { schemaVersion: 1, name: "CTĐT K27", major: "Information Technology", cohortCode: "K27", admissionYear: 2022, totalCredits: 130, notes: "",
    courses: [course(1, "71IT000001", 1, 1), course(2, "71PEKC10062", 1, 2, "TC102"), course(3, "71IT000003", null, null)],
    groups: [], electives: [], relations: [], warnings: [], sourceWarnings: [] };
}
const k27Curricula = [curriculumRow(k27CurriculumId, "K27", "information technology:K27"), curriculumRow(k29CurriculumId, "K29", "information technology:K29")];

describe("student plans API", () => {
  it("requires authentication and rejects inactive accounts before reading plans", async () => {
    const unauthenticated = setup({ sessionUser: null });
    await request(unauthenticated.app).get("/plans").expect(401);
    expect(unauthenticated.query).not.toHaveBeenCalled();

    const inactive = setup({ active: false });
    const response = await request(inactive.app).get("/plans").expect(403);
    expect(response.body).toEqual({ error: "account_unavailable" });
    expect(inactive.query).toHaveBeenCalledTimes(1);
  });

  // User 2026-11-10: no choice of KHĐT, only the student's own, as Xét tốt nghiệp shows only the student's own standard.
  it("lists only the student's own KHĐT: the cohort in the account and the major of the MSSV, as the engine picks it", async () => {
    const cntt = planRow(activeListRow, "cong nghe thong tin:K29");
    const httt = planRow({ ...activeListRow, id: "12121212-1212-4121-8121-121212121212" }, "he thong thong tin:K29");
    const k30 = planRow({ ...activeListRow, id: "66666666-6666-4666-8666-666666666666", cohortCode: "K30" }, "cong nghe thong tin:K30");
    const { app, query } = setup({ profileMajor: "7480201", plans: [httt, cntt, k30],
      curricula: [curriculumRow(k29CurriculumId, "K29", "cong nghe thong tin:K29")] });
    const response = await request(app).get("/plans").expect(200);

    expect(response.body).toEqual({
      items: [activeListRow],
      profileCohort: "K29",
      profileMajor: "7480201",
      resolution: "found",
      suggestedId: planId,
    });
    expect(queryText(query)).toContain("WHERE p.is_active AND p.cohort_code=$1 AND ($2::text IS NULL OR split_part(p.identity_key, ':', 1) = $2)");
    expect(queryText(query)).toContain("JOIN training_plan_revisions r ON r.id=p.current_revision");
    expect(query.mock.calls.find(([sql]) => String(sql).includes("FROM training_plans p"))?.[1]).toEqual(["K29", "cong nghe thong tin", k29CurriculumId]);
    expect((await request(setup({ profileMajor: "7480104", plans: [httt, cntt, k30] }).app).get("/plans").expect(200)).body)
      .toMatchObject({ resolution: "found", suggestedId: httt.id });
  });

  it("gives a cohort and major without a KHĐT the plan read from their own CTĐT (user 2026-11-05)", async () => {
    const { app } = setup({ profileCohort: "K27", profileMajor: null, curricula: k27Curricula });
    const response = await request(app).get("/plans").expect(200);
    expect(response.body).toEqual({
      items: [{ id: `ctdt-${k27CurriculumId}`, cohortCode: "K27", major: "Information Technology",
        name: "Kế hoạch đào tạo ngành Information Technology khóa 27 (theo chương trình đào tạo)", fromCurriculum: true }],
      profileCohort: "K27", profileMajor: null, resolution: "found", suggestedId: `ctdt-${k27CurriculumId}`,
    });
  });

  it("takes, among a cohort's KHĐT for a profile without a major, the one linked to its CTĐT, else the one of its identity", async () => {
    const httt = planRow({ ...activeListRow, id: "12121212-1212-4121-8121-121212121212", major: "Information Systems" }, "information systems:K29");
    const linked = (await request(setup({ profileMajor: null, plans: [httt, k29Plan] }).app).get("/plans").expect(200)).body;
    expect(linked).toMatchObject({ resolution: "found", suggestedId: planId });
    const unlinked = [httt, { ...k29Plan, linkedTo: null }];
    expect((await request(setup({ profileMajor: null, plans: unlinked }).app).get("/plans").expect(200)).body)
      .toMatchObject({ resolution: "found", suggestedId: planId });
    // Two CTĐT of the cohort (no major): neither the CTĐT nor the KHĐT can be told apart.
    const twoCurricula = [curriculumRow(k29CurriculumId, "K29", "information technology:K29"),
      curriculumRow("13131313-1313-4131-8131-131313131313", "K29", "information systems:K29", "Information Systems")];
    expect((await request(setup({ profileMajor: null, plans: unlinked, curricula: twoCurricula }).app).get("/plans").expect(200)).body)
      .toEqual({ items: [], profileCohort: "K29", profileMajor: null, resolution: "ambiguous", suggestedId: null });
    expect((await request(setup({ profileMajor: null, plans: [], curricula: twoCurricula }).app).get("/plans").expect(200)).body)
      .toMatchObject({ items: [], resolution: "ambiguous" });
  });

  it("never falls back to another cohort or major: not_found, and cohort_unknown without a cohort", async () => {
    const k32 = (await request(setup({ profileCohort: "K32", profileMajor: "7480201" }).app).get("/plans").expect(200)).body;
    expect(k32).toEqual({ items: [], profileCohort: "K32", profileMajor: "7480201", resolution: "not_found", suggestedId: null });
    expect((await request(setup({ profileMajor: "7480104" }).app).get("/plans").expect(200)).body)
      .toMatchObject({ items: [], resolution: "not_found", suggestedId: null });
    const { app, query } = setup({ profileCohort: null });
    expect((await request(app).get("/plans").expect(200)).body)
      .toEqual({ items: [], profileCohort: null, profileMajor: null, resolution: "cohort_unknown", suggestedId: null });
    expect(queryText(query)).not.toContain("FROM training_plans");
  });

  it("serves the plan read from the student's own CTĐT, and 404 for another one or once the CTĐT is closed", async () => {
    const { app } = setup({ profileCohort: "K27", curricula: k27Curricula, curriculumDetailRows: [{ id: k27CurriculumId, data: k27Data() }] });
    const response = await request(app).get(`/plans/ctdt-${k27CurriculumId}`).expect(200);
    expect(response.body).toMatchObject({ id: `ctdt-${k27CurriculumId}`, fromCurriculum: true, cohortCode: "K27", unplacedCount: 1,
      terms: [{ code: "HK221" }, { code: "HK222" }], physicalEducationGroups: { TC002: [], TC102: ["71PEKC10062"] } });
    expect(JSON.stringify(response.body)).not.toContain("internal");
    // K29 has its own KHĐT: the plan read from its CTĐT is not the student's.
    expect((await request(app).get(`/plans/ctdt-${k29CurriculumId}`).expect(404)).body).toEqual({ error: "plan_unavailable" });
    await request(setup({ profileCohort: "K27", curricula: [] }).app).get(`/plans/ctdt-${k27CurriculumId}`).expect(404);
    await request(setup().app).get("/plans/ctdt-not-a-uuid").expect(400);
  });

  it("refuses another cohort's KHĐT, even an active one, without reading it", async () => {
    const other = "66666666-6666-4666-8666-666666666666";
    const { app, query } = setup({ plans: [k29Plan, planRow({ ...activeListRow, id: other, cohortCode: "K30" }, "information technology:K30")] });
    expect((await request(app).get(`/plans/${other}`).expect(404)).body).toEqual({ error: "plan_unavailable" });
    expect(queryText(query)).not.toContain("SELECT c.id,r.version,r.data");
    await request(setup({ profileCohort: "K32" }).app).get(`/plans/${planId}`).expect(404);
  });

  it("serves the KHĐT of the student a staff account works for (acting mode)", async () => {
    const acted = { ...student, userId: "77777777-7777-4777-8777-777777777777" } satisfies AuthenticatedUser;
    const { app, query } = setup({ sessionUser: { ...student, role: "admin" }, acting: acted });
    await request(app).get("/plans").expect(200);
    expect(query.mock.calls.find(([sql]) => String(sql).includes("FROM student_profiles"))?.[1]).toEqual([acted.userId]);
  });

  it("projects only student-safe detail fields from the current revision", async () => {
    const { app } = setup();
    const response = await request(app).get(`/plans/${planId}`).expect(200);

    expect(response.body).toMatchObject({
      id: planId,
      version: 2,
      name: plan.name,
      major: plan.major,
      cohortCode: plan.cohortCode,
      admissionYear: plan.admissionYear,
      totalCredits: plan.totalCredits,
    });
    expect(response.body.terms).toEqual([
      { code: "HK011", semester: 1, studyYear: 1, sourceCredits: 20 },
    ]);
    expect(response.body.sections).toEqual([
      { id: "section-1", termCode: "HK011", label: "Required courses", kind: "choice" },
    ]);
    expect(response.body.items[0]).toMatchObject({
      id: "row-1",
      code: "71IT000001",
      name: "Introduction to Computing",
      notes: "Student-facing item note",
    });
    expect(response.body).not.toHaveProperty("data");
    for (const key of ["notes", "sourceWarnings", "warnings", "curriculum"]) {
      expect(response.body).not.toHaveProperty(key);
    }
    for (const key of ["position", "sourceRow", "sourceSheet", "sourceCells"]) {
      expect(response.body.items[0]).not.toHaveProperty(key);
    }
    expect(response.body.sections[0]).not.toHaveProperty("sourceRow");
  });

  it("returns distinct TC002 and TC102 codes from the active current curriculum for the exact plan identity", async () => {
    const curriculumRows = [{
      courses: [
        { code: "71TC0020001", type: "TC002 - Physical education" },
        { code: " 71tc0020001 ", type: "TC002 - Physical education" },
        { code: "71TC0020002", type: "TC002 - Physical education" },
        { code: "71TC1020001", type: "TC102 - Physical education" },
        { code: "71TC2090001", type: "TC209 - Other elective" },
        { code: "71IT000001", type: "BB - Required" },
      ],
    }];
    const { app, query } = setup({ curriculumRows });
    const response = await request(app).get(`/plans/${planId}`).expect(200);

    expect(response.body.physicalEducationGroups).toEqual({
      TC002: ["71TC0020001", "71TC0020002"],
      TC102: ["71TC1020001"],
    });
    const curriculumCall = query.mock.calls.find(([sql]) => String(sql).includes("AS courses FROM curricula c"));
    expect(curriculumCall?.[1]).toEqual(["information technology:K29"]);
    expect(String(curriculumCall?.[0])).toContain(
      "JOIN curriculum_revisions r ON r.id=c.current_revision",
    );
    expect(String(curriculumCall?.[0])).toContain(
      "WHERE c.identity_key=$1 AND c.is_active",
    );
  });

  it("returns empty physical education groups when the matching active curriculum is absent", async () => {
    const { app, query } = setup({ curriculumRows: [] });
    const response = await request(app).get(`/plans/${planId}`).expect(200);

    expect(response.body.physicalEducationGroups).toEqual({ TC002: [], TC102: [] });
    const curriculumCall = query.mock.calls.find(([sql]) => String(sql).includes("AS courses FROM curricula c"));
    expect(curriculumCall?.[1]).toEqual(["information technology:K29"]);
    expect(String(curriculumCall?.[0])).toContain(
      "JOIN curriculum_revisions r ON r.id=c.current_revision",
    );
    expect(String(curriculumCall?.[0])).toContain(
      "WHERE c.identity_key=$1 AND c.is_active",
    );
  });

  it.each([lockedId, missingId])(
    "returns 404 for locked or nonexistent plan %s",
    async (id) => {
      const { app, query } = setup({ plans: [planRow({ ...activeListRow, id }, "information technology:K29")], detailRows: [] });
      const response = await request(app).get(`/plans/${id}`).expect(404);

      expect(response.body).toEqual({ error: "plan_unavailable" });
      expect(queryText(query)).toContain(
        "WHERE c.id=$1 AND c.is_active",
      );
    },
  );

  it("rejects unknown query parameters and malformed ids", async () => {
    const { app, query } = setup();
    await request(app).get("/plans?revision=old").expect(400);
    await request(app).get(`/plans/${planId}?revision=old`).expect(400);
    await request(app).get("/plans/not-a-uuid").expect(400);
    expect(query).toHaveBeenCalled();
  });

  it("allows GET and HEAD while rejecting every write method", async () => {
    const { app } = setup();
    await request(app).get("/plans").expect(200);
    await request(app).head("/plans").expect(200);
    for (const response of await Promise.all([
      request(app).post("/plans"),
      request(app).put(`/plans/${planId}`),
      request(app).patch(`/plans/${planId}`),
      request(app).delete(`/plans/${planId}`),
    ])) {
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET, HEAD");
      expect(response.body).toEqual({ error: "read_only" });
    }
  });
});
