import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import { syntheticCurriculum, syntheticPlan, syntheticStandards, syntheticStudentTerms, syntheticTranscript } from "../competency-assessment/fixtures/synthetic-k29.js";
import type { DatabasePool } from "../db/pool.js";
import { readStudyPlanFacts } from "./context.js";
import { calendarTermCode, creditLimits, nextTerm, studyPlanSchema, termIndex, termLabel, type StudyPlanData } from "./model.js";
import { prefillPlan, readAiProposal } from "./prefill.js";
import { plannedTranscript, projectGraduation } from "./projection.js";
import { createStudyPlanRouter } from "./router.js";

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

type Roadmap = { id: string; facts: unknown; output: unknown; completed_at: Date };
type Options = { specialty?: string | null; standards?: boolean; transcript?: boolean; active?: boolean; roadmap?: Roadmap };
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
    if (sql.includes("FROM training_plans tp JOIN training_plan_items")) {
      const k29 = syntheticPlan().data.items.map((item) => ({ cohort_code: "K29", code: item.code, name: item.name, term_code: item.termCode }));
      return rows([...k29, { cohort_code: "K30", code: "71ITIN40304", name: "Đồ án thực tập", term_code: "HK262" }]);
    }
    if (sql.startsWith("SELECT version,data,updated_at FROM stu_study_plans")) return rows(saved.slice(-1));
    if (sql.includes("FROM stu_roadmaps WHERE user_id=$1 AND status='completed'")) return rows(options.roadmap ? [options.roadmap] : []);
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
      .map((date) => calendarTermCode(new Date(date)))).toEqual(["HK261", "HK261", "HK262", "HK263", "HK261"]);
  });

  it("keeps the credits of a term within 2/3 and 3/2 of the average CTĐT term (Thông tư 08/2021)", () => {
    expect(creditLimits(126, 10)).toEqual({ average: 12.6, min: 9, max: 18 });
    expect(creditLimits(null, 10)).toBeNull();
  });

  it("refuses a course twice or a term twice, and drops the weekly sessions of a plan saved by the first version", () => {
    const term = (code: string, courses: string[]) => ({ code, courses: courses.map((course) => ({ code: course })) });
    expect(studyPlanSchema.safeParse({ schemaVersion: 1, terms: [term("HK262", ["A1"]), term("HK263", ["a1"])] }).success).toBe(false);
    expect(studyPlanSchema.safeParse({ schemaVersion: 1, terms: [term("HK262", []), term("HK262", [])] }).success).toBe(false);
    const old = studyPlanSchema.safeParse({ schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "A1", sessions: [{ kind: "TH", day: 8, block: 5 }] }] }] });
    expect(old.success && old.data).toEqual({ schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "A1" }] }] });
  });
});

describe("study plan context", () => {
  it("reads each CTĐT course with its state, conditions, plan terms and the grade that counts", async () => {
    const { context } = await facts();
    // The calendar is in HK261; the transcript studies HK251 (Kiểm thử phần mềm without grades).
    expect(context).toMatchObject({ cohortCode: "K29", specialty: "CNPM", currentTerm: "HK261", studyTerm: "HK251", admissionYear: 2023, hasTranscript: true,
      limits: { average: 14, min: 10, max: 21 }, offeringUntil: "HK262" });
    const byCode = new Map(context.courses.map((course) => [course.code, course]));
    expect(byCode.get("71ITBS10103")).toMatchObject({ state: "passed", standardTerm: "HK231", kind: "mandatory", grade: "A", takenTerm: "HK231", attempts: 1, planTerm: "HK231" });
    expect(byCode.get("71ITSE41203")).toMatchObject({ state: "in_progress", inProgressTerm: "HK251", prior: ["71ITSE41003"], grade: null });
    expect(byCode.get("71ITDS40303")).toMatchObject({ applicable: false, specialtyName: "Công nghệ Dữ liệu" });
    expect(byCode.get("71PEBA10052")).toMatchObject({ conditional: true, kind: "elective", group: "TC102" });
    // Offered by the K29 plan in HK253 and by a K30 plan in HK262.
    expect(byCode.get("71ITIN40304")).toMatchObject({ planTerm: "HK253", offeredTerms: ["HK253", "HK262"], state: "not_taken" });
  });

  it("reads the standard's groups, credits and GPA, and the courses no requirement counts", async () => {
    const { context } = await facts();
    expect(context.graduation?.groups.map((group) => [group.label, group.unit, group.required, group.passed])).toContainEqual(["Nhóm tự chọn TC306", "TC", 6, 0]);
    expect(context.graduation?.credits).toMatchObject({ required: 126 });
    expect(context.gpa.scale).toBe(4);
    const counted = new Set(context.graduation!.groups.flatMap((group) => group.courseCodes));
    expect(context.unmatched.every((course) => !counted.has(course.code))).toBe(true);
    // Without a standard every applicable CTĐT course counts.
    const plain = (await facts({ standards: false })).context;
    expect(plain.graduation).toBeNull();
    // The GPA still shows, from the transcript, without a minimum.
    expect(plain.gpa).toMatchObject({ required: null, scale: 4 });
    expect(plain.gpa.actual).not.toBeNull();
    expect(plain.unmatched.map((course) => course.code)).not.toContain("71ITBS10103");
  });
});

describe("where the plan starts", () => {
  it("fills the mandatory courses still ahead in the terms of the cohort's training plan, never a late one", async () => {
    const { context } = await facts();
    // Calendar term HK261: the internship of HK253 is late and left out; nothing mandatory of the plan is still ahead.
    expect(prefillPlan(context)).toEqual({ schemaVersion: 1, terms: [] });
    // Earlier in the program (calendar term HK243), the HK253 internship is ahead and lands in HK253.
    const early = { ...context, currentTerm: "HK243" };
    expect(prefillPlan(early).terms.map((term) => [term.code, term.courses.map((course) => course.code)])).toContainEqual(["HK253", ["71ITIN40304"]]);
    expect(prefillPlan(early).terms.flatMap((term) => term.courses.map((course) => course.code))).not.toContain("71ITSE30803");
  });

  it("proposes the courses of the newest AI roadmap once, in the term it prepares, a chuyên đề with its pair", async () => {
    const roadmap: Roadmap = {
      id: "99999999-9999-4999-8999-999999999999", completed_at: new Date("2026-10-24T10:00:00Z"),
      facts: { nextTerm: "HK262", study: [{ code: "71ITSE41203", source: "running" }], choices: [
        { thesis: { thesis: { code: "71ITGR40206" }, topics: [{ code: "71ITGR40203" }, { code: "71ITGR40303" }] } }] },
      output: { study: [{ code: "71ITSE41203" }, { code: "71ITIN40304" }, { code: "71ITGR40203" }], improve: [{ code: "71ITAI40103" }] },
    };
    const db = fakeDb({ roadmap });
    const loaded = await readStudyPlanFacts(db as never, studentId, today);
    const proposal = await readAiProposal(db as never, studentId, loaded.context, null);
    // The running course stays out; Chuyên đề 1 brings Chuyên đề 2 only when the CTĐT has it (the synthetic one has not).
    expect(proposal).toMatchObject({ roadmapId: roadmap.id, term: "HK262" });
    const codes = proposal!.courses.map((course) => course.code);
    expect(codes).toEqual(expect.arrayContaining(["71ITIN40304", "71ITGR40203"]));
    expect(codes).not.toContain("71ITSE41203");
    // The K30 plan opens the internship in HK262 itself.
    expect(proposal!.courses.find((course) => course.code === "71ITIN40304")?.term).toBe("HK262");
    expect(await readAiProposal(db as never, studentId, loaded.context, roadmap.id)).toBeNull();
  });

  it("moves a proposed course to the next term within a year that a training plan opens it in", async () => {
    const roadmap: Roadmap = {
      id: "99999999-9999-4999-8999-999999999999", completed_at: new Date("2026-10-24T10:00:00Z"),
      facts: { nextTerm: "HK262", study: [], choices: [] }, output: { study: [{ code: "SUMMER" }, { code: "ANY" }, { code: "RARE" }], improve: [] },
    };
    const db = { query: vi.fn(async () => ({ rowCount: 1, rows: [roadmap] })) };
    const course = (code: string, offeredTerms: string[]) => ({ code, state: "not_taken", offeredTerms });
    const context = { currentTerm: "HK261", offeringUntil: "HK263", courses: [course("SUMMER", ["HK253"]), course("ANY", []), course("RARE", ["HK252"])] };
    // Plans open SUMMER in HK3 only (of an earlier year); nothing says when ANY is opened; RARE is an HK2 course whose
    // term no plan opens within a year, so it stays in the HK2 the roadmap prepares.
    expect((await readAiProposal(db as never, studentId, context as never, null))!.courses)
      .toEqual([{ code: "SUMMER", term: "HK263" }, { code: "ANY", term: "HK262" }, { code: "RARE", term: "HK262" }]);
  });
});

describe("graduation projection", () => {
  /** What a student could plan: the internship and the thesis next term. */
  const manualPlan: StudyPlanData = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "71ITIN40304" }, { code: "71ITGR40206" }] }] };

  it("counts planned and running courses as passed: the plan closes groups of the standard", async () => {
    const loaded = await facts();
    const plan = manualPlan;
    expect(projectGraduation(loaded, { schemaVersion: 1, terms: [] })).toMatchObject({ now: "fail", withPlan: "fail" });
    const projected = projectGraduation(loaded, plan)!;
    expect(projected.now).toBe("fail");
    expect(projected.openGroups.length).toBeLessThan(projectGraduation(loaded, { schemaVersion: 1, terms: [] })!.openGroups.length);
    expect(projectGraduation({ ...loaded, standard: null }, plan)).toBeNull();
  });

  it("adds one transcript term per plan term, every course passed", async () => {
    const transcript = syntheticTranscript(syntheticStudentTerms());
    const result = plannedTranscript(transcript, { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "71ITIN40304" }] }, { code: "HK263", courses: [] }] },
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
  const plan = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "71ITIN40304" }] }] };

  it("needs a session, an active account and the web origin to write", async () => {
    await request(setup({ sessionUser: null }).app).get("/plan").expect(401);
    await request(setup({ active: false }).app).get("/plan").expect(403);
    await request(setup().app).put("/plan").send({ version: null, data: plan }).expect(403);
  });

  it("returns the context without the transcript or the standard, no plan yet, and the projection", async () => {
    const response = await request(setup().app).get("/plan").expect(200);
    expect(response.body.plan).toBeNull();
    expect(response.body.suggested).toEqual({ schemaVersion: 1, terms: [] });
    expect(response.body.aiProposal).toBeNull();
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

  it("deletes the saved plan with its version only", async () => {
    const { app } = setup();
    const saved = await request(app).put("/plan").set("Origin", origin).send({ version: null, data: plan }).expect(200);
    await request(app).delete("/plan").set("Origin", origin).send({ version: "33333333-3333-4333-8333-333333333333" }).expect(409, { error: "plan_changed" });
    await request(app).delete("/plan").set("Origin", origin).send({ version: saved.body.plan.version }).expect(200, { plan: null });
    expect((await request(app).get("/plan").expect(200)).body.plan).toBeNull();
  });
});
