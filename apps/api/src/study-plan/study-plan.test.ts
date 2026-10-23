import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import { syntheticCurriculum, syntheticStandards, syntheticStudentTerms, syntheticTranscript } from "../competency-assessment/fixtures/synthetic-k29.js";
import type { DatabasePool } from "../db/pool.js";
import { readStudyPlanFacts, type StudyPlanContext } from "./context.js";
import { creditLimits, currentTermCode, nextTerm, sessionKinds, studyPlanSchema, termIndex, termLabel } from "./model.js";
import { plannedTranscript, projectGraduation } from "./projection.js";
import { createStudyPlanRouter } from "./router.js";
import { suggestStudyPlan } from "./suggest.js";

// Synthetic K29 rows only (fixtures/synthetic-k29.json); no real student data.
const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const origin = "https://edupath.example";
const today = new Date("2026-10-23T08:00:00Z");
const student = {
  userId: studentId, identityKey: `${tenantId}:${studentId}`, tenantId, objectId: studentId, name: "Student User",
  email: "student@example.edu", username: "student@example.edu", role: "student", signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;

/** The synthetic CTĐT as a stored revision: every course 30 LT + 30 TH periods, 126 credits. */
function curriculumData() {
  const curriculum = syntheticCurriculum();
  return {
    name: curriculum.name, admissionYear: curriculum.admissionYear, totalCredits: 126, relations: curriculum.relations,
    courses: curriculum.courses.map((course) => ({ ...course, hours: { lecture: 30, practice: 30, project: null, internship: null } })),
  };
}

type Options = { specialty?: string | null; standards?: boolean; transcript?: boolean; active?: boolean };
function fakeDb(options: Options = {}) {
  const saved: { version: string; data: unknown; updated_at: Date }[] = [];
  const standards = options.standards === false ? [] : syntheticStandards().map((item) => ({ id: item.id, revision_id: item.revisionId, version: item.version, data: item.data }));
  const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return rows([]);
    if (sql.includes("SELECT id FROM users")) return options.active === false ? rows([]) : rows([{ id: studentId }]);
    if (sql.includes("FROM student_profiles")) return rows([{ cohort_code: "K29", specialty: options.specialty === undefined ? "CNPM" : options.specialty }]);
    if (sql.includes("FROM student_transcripts")) return rows(options.transcript === false ? [] : [{ data: syntheticTranscript(syntheticStudentTerms()) }]);
    if (sql.includes("FROM curricula")) return rows(params[0] === "K29" ? [{ data: curriculumData() }] : []);
    if (sql.includes("FROM graduation_standards")) return rows(standards);
    if (sql.startsWith("SELECT version,data,updated_at FROM stu_study_plans")) return rows(saved.slice(-1));
    if (sql.startsWith("INSERT INTO stu_study_plans")) {
      saved.push({ version: String(params[1]), data: JSON.parse(String(params[2])), updated_at: today });
      return rows([{ version: params[1], updated_at: today }]);
    }
    if (sql.startsWith("DELETE FROM stu_study_plans")) {
      const found = saved.length && saved.at(-1)!.version === params[1];
      if (found) saved.length = 0;
      return { rowCount: found ? 1 : 0, rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query, saved };
}
const facts = (options: Options = {}) => readStudyPlanFacts(fakeDb(options) as never, studentId, today);

describe("study plan model", () => {
  it("orders and names terms, and finds the running term in Vietnam time", () => {
    expect([nextTerm("HK261"), nextTerm("HK262"), nextTerm("HK263"), nextTerm("HK993")]).toEqual(["HK262", "HK263", "HK271", "HK001"]);
    expect(termIndex("HK263") < termIndex("HK271")).toBe(true);
    expect(termLabel("HK262")).toBe("HK2 · 2026-2027");
    expect(["2026-10-23T08:00:00Z", "2027-01-20T08:00:00Z", "2027-02-01T08:00:00Z", "2027-07-15T08:00:00Z", "2026-08-31T18:00:00Z"]
      .map((date) => currentTermCode(new Date(date)))).toEqual(["HK261", "HK261", "HK262", "HK263", "HK261"]);
  });

  it("starts a course with an LT session for lecture periods and a TH one for practice periods", () => {
    expect(sessionKinds({ lecture: 30, practice: 30, project: null, internship: null })).toEqual(["LT", "TH"]);
    expect(sessionKinds({ lecture: 45, practice: 0, project: null, internship: null })).toEqual(["LT"]);
    expect(sessionKinds({ lecture: null, practice: null, project: 90, internship: null })).toEqual([]);
    expect(sessionKinds(undefined)).toEqual(["LT"]);
  });

  it("keeps the credits of a term within 2/3 and 3/2 of the average CTĐT term (Thông tư 08/2021)", () => {
    expect(creditLimits(126, 10)).toEqual({ average: 12.6, min: 9, max: 18 });
    expect(creditLimits(null, 10)).toBeNull();
  });

  it("refuses a course twice, a term twice and a day without a block", () => {
    const term = (code: string, courses: string[]) => ({ code, courses: courses.map((course) => ({ code: course, sessions: [] })) });
    expect(studyPlanSchema.safeParse({ schemaVersion: 1, terms: [term("HK262", ["A1"]), term("HK263", ["a1"])] }).success).toBe(false);
    expect(studyPlanSchema.safeParse({ schemaVersion: 1, terms: [term("HK262", []), term("HK262", [])] }).success).toBe(false);
    expect(studyPlanSchema.safeParse({ schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "A1", sessions: [{ kind: "LT", day: 2, block: null }] }] }] }).success).toBe(false);
    expect(studyPlanSchema.safeParse({ schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "A1", sessions: [{ kind: "TH", day: 8, block: 5 }] }] }] }).success).toBe(true);
  });
});

describe("study plan context", () => {
  it("reads each CTĐT course with its state, term, sessions and conditions", async () => {
    const { context } = await facts();
    expect(context).toMatchObject({ cohortCode: "K29", specialty: "CNPM", currentTerm: "HK261", admissionYear: 2023, hasTranscript: true,
      limits: { average: 14, min: 10, max: 21 } });
    const byCode = new Map(context.courses.map((course) => [course.code, course]));
    expect(byCode.get("71ITBS10103")).toMatchObject({ state: "passed", standardTerm: "HK231", kind: "mandatory", sessions: ["LT", "TH"] });
    expect(byCode.get("71ITSE41203")).toMatchObject({ state: "in_progress", inProgressTerm: "HK251", prior: ["71ITSE41003"] });
    expect(byCode.get("71ITDS40303")).toMatchObject({ applicable: false, specialtyName: "Công nghệ Dữ liệu" });
    expect(byCode.get("71PEBA10052")).toMatchObject({ conditional: true, kind: "elective", group: "TC102" });
    expect(context.graduation?.groups.map((group) => [group.label, group.unit, group.required, group.passed])).toContainEqual(["Nhóm tự chọn TC306", "TC", 6, 0]);
  });
});

describe("Xếp theo kế hoạch đào tạo", () => {
  it("plans every remaining mandatory course and the electives the graduation standard still needs, from the next term", async () => {
    const plan = suggestStudyPlan((await facts()).context);
    expect(plan.terms.map((term) => [term.code, term.courses.map((course) => course.code)])).toEqual([["HK262", ["71ITIN40304", "71ITGR40206"]]]);
    expect(plan.terms[0]!.courses[0]!.sessions).toEqual([{ kind: "LT", day: null, block: null }, { kind: "TH", day: null, block: null }]);
  });

  it("without a standard only fills the CTĐT groups that state their credits; without a specialty only common courses", async () => {
    const noStandard = suggestStudyPlan((await facts({ standards: false })).context);
    expect(noStandard.terms.flatMap((term) => term.courses.map((course) => course.code))).toEqual(["71ITIN40304"]);
    const noSpecialty = (await facts({ specialty: null, standards: false })).context;
    const planned = suggestStudyPlan(noSpecialty).terms.flatMap((term) => term.courses.map((course) => course.code));
    expect(planned).not.toContain("71ITDS40303");
    expect(planned).not.toContain("71ITAI40803");
  });

  it("moves a course past a full term and after the term of its prerequisite", () => {
    const course = (code: string, standardTerm: string, prerequisites: string[] = []) => ({
      code, name: code, credits: 3, type: "BB", kind: "mandatory" as const, group: null, conditional: false, applicable: true, specialtyName: null,
      standardTerm, sessions: [], prerequisites, prior: [], state: "not_taken" as const, inProgressTerm: null, onlyInStandard: false,
    });
    const context: StudyPlanContext = {
      cohortCode: "K29", specialty: "CNPM", specialtyLabel: null, curriculum: { name: "CTĐT", totalCredits: 12 }, hasTranscript: true,
      currentTerm: "HK261", admissionYear: 2023, standardTerms: [], limits: { average: 3, min: 2, max: 4 }, electiveGroups: [], graduation: null,
      courses: [course("A", "HK231"), course("B", "HK231"), course("C", "HK271", ["A"]), course("D", "HK262", ["B"])],
    };
    // Max 4 credits: one 3-credit course per term. D waits for B (HK263); C's own term HK271 is then full.
    expect(suggestStudyPlan(context).terms.map((term) => [term.code, term.courses.map((item) => item.code)]))
      .toEqual([["HK262", ["A"]], ["HK263", ["B"]], ["HK271", ["D"]], ["HK272", ["C"]]]);
  });
});

describe("graduation projection", () => {
  it("counts planned and running courses as passed: the standard's groups go from fail to pass", async () => {
    const loaded = await facts();
    const plan = suggestStudyPlan(loaded.context);
    expect(projectGraduation(loaded, { schemaVersion: 1, terms: [] })).toMatchObject({ now: "fail", withPlan: "fail" });
    expect(projectGraduation(loaded, plan)).toMatchObject({ now: "fail", withPlan: "pass", openGroups: [] });
    expect(projectGraduation({ ...loaded, standard: null }, plan)).toBeNull();
  });

  it("adds one transcript term per plan term, every course passed", async () => {
    const transcript = syntheticTranscript(syntheticStudentTerms());
    const result = plannedTranscript(transcript, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "71ITIN40304", sessions: [] }] }, { code: "HK263", courses: [] }] },
      new Map([["71ITIN40304", { name: "Thực tập", credits: 4, conditional: false }]]), ["71ITSE41203"]);
    expect(result.sections.slice(transcript.sections.length).map((section) => [section.academicYear, section.semester, section.courses.map((course) => [course.code, course.result])]))
      .toEqual([["2000-2001", "HK00", [["71ITSE41203", "Đạt"]]], ["2026-2027", "HK02", [["71ITIN40304", "Đạt"]]]]);
  });
});

describe("study plan API", () => {
  function setup(options: Options & { sessionUser?: AuthenticatedUser | null } = {}) {
    const db = fakeDb(options);
    const release = vi.fn();
    const pool = { query: db.query, connect: vi.fn(async () => ({ query: db.query, release })) } as unknown as DatabasePool;
    const app = express();
    app.use((req, _res, next) => { req.session = { user: options.sessionUser === null ? undefined : options.sessionUser ?? student } as typeof req.session; next(); });
    app.use("/plan", createStudyPlanRouter(pool, origin, { now: () => today }));
    return { app, db };
  }
  const plan = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "71ITIN40304", sessions: [{ kind: "LT", day: 2, block: 3 }] }] }] };

  it("needs a session, an active account and the web origin to write", async () => {
    await request(setup({ sessionUser: null }).app).get("/plan").expect(401);
    await request(setup({ active: false }).app).get("/plan").expect(403);
    await request(setup().app).put("/plan").send({ version: null, data: plan }).expect(403);
  });

  it("returns the context without the transcript or the standard, no plan yet, and the projection", async () => {
    const response = await request(setup().app).get("/plan").expect(200);
    expect(response.body.plan).toBeNull();
    expect(response.body.context.courses.length).toBeGreaterThan(10);
    expect(response.body).not.toHaveProperty("transcript");
    expect(response.body.context).not.toHaveProperty("standard");
    expect(response.body.projection).toMatchObject({ now: "fail", withPlan: "fail" });
  });

  it("saves with the loaded version and refuses a stale one or a malformed plan", async () => {
    const { app } = setup();
    const first = await request(app).put("/plan").set("Origin", origin).send({ version: null, data: plan }).expect(200);
    expect(first.body.plan.data).toEqual(plan);
    expect(first.body.projection.openGroups.map((group: { label: string }) => group.label)).toEqual(["Nhóm tự chọn TC306"]);
    await request(app).put("/plan").set("Origin", origin).send({ version: null, data: plan }).expect(409, { error: "plan_changed" });
    await request(app).put("/plan").set("Origin", origin).send({ version: first.body.plan.version, data: plan }).expect(200);
    await request(app).put("/plan").set("Origin", origin).send({ version: null, data: { ...plan, terms: [plan.terms[0], plan.terms[0]] } }).expect(400, { error: "invalid_plan" });
  });

  it("suggests without saving, exports the saved plan as Excel and deletes it", async () => {
    const { app, db } = setup();
    const suggested = await request(app).post("/plan/suggest").set("Origin", origin).expect(200);
    expect(suggested.body.projection.withPlan).toBe("pass");
    expect(db.saved).toEqual([]);
    await request(app).get("/plan/export").expect(404);
    const saved = await request(app).put("/plan").set("Origin", origin).send({ version: null, data: suggested.body.data }).expect(200);
    const file = await request(app).get("/plan/export").buffer(true).parse((res, done) => {
      const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk)); res.on("end", () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(file.headers["content-type"]).toContain("spreadsheetml");
    expect((file.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    await request(app).delete("/plan").set("Origin", origin).send({ version: saved.body.plan.version }).expect(200, { plan: null });
  });
});
