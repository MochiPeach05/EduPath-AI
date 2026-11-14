import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { AssessmentError, loadAssessmentInputs, readAssessmentInputs } from "./inputs.js";

// Synthetic rows only. Course codes follow the public K29 curriculum; everything else is invented.
const userId = "11111111-1111-4111-8111-111111111111";
const curriculumId = "c0000000-0000-4000-8000-000000000001";
const currentRevision = "c0000000-0000-4000-8000-000000000002";
const transcriptData = {
  schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: 1, courseCount: 2, warnings: [],
  sections: [{
    id: "s1", academicYear: "2023-2024", semester: "HK1", label: "HK1", summaries: [],
    courses: [
      { ordinal: 1, code: "71ITBS10103", name: "Tên in trên bảng điểm", credits: 3, score10: 8, score4: 3.5, letter: "B+", result: null, conditional: false, sourcePage: 1 },
      { ordinal: 2, code: "71av010003", name: "Anh văn", credits: 0, score10: null, score4: null, letter: "MT", result: null, conditional: false, sourcePage: 1 },
    ],
  }],
};
const standardData = (specialty: string, classBlock: string) => ({
  name: `Chuẩn ${specialty}`, standardCode: "TCTN", classBlock, specialty, groups: [], courses: [], minimumCredits: 120, minimumGpa: 2,
});

type Tables = {
  profile: Record<string, unknown> | null; transcript: boolean; curricula: number; weights: boolean;
  specialty: string | null; plans: { linked: boolean; major: string }[]; career: boolean;
  /** The CTĐT writes Đại số tuyến tính và ứng dụng under a paper code (71ITMA10203), its standard under the real one (71MATL10053). */
  paper?: boolean;
  /** The saved Kế hoạch học kỳ (stu_study_plans.data); none by default. */
  studyPlan?: unknown;
};

function fakeDb(overrides: Partial<Tables> = {}) {
  const t: Tables = { profile: { cohort_code: " k29 ", specialty: "CNDL", career_position_id: "p1" }, transcript: true, curricula: 1, weights: true,
    specialty: "CNDL", plans: [{ linked: false, major: "Công nghệ thông tin" }, { linked: true, major: "Công nghệ thông tin" }], career: true, ...overrides };
  if (overrides.profile === undefined && overrides.specialty !== undefined) t.profile = { cohort_code: "K29", specialty: overrides.specialty, career_position_id: "p1" };
  const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return rows([]);
    if (sql.includes("FROM student_profiles")) return rows(t.profile ? [t.profile] : []);
    if (sql.includes("FROM student_transcripts")) return rows(t.transcript ? [{ version: "v1", data: transcriptData }] : []);
    // The CTĐT rows read with their real codes (curricula/real-codes.ts), the standards and shared courses they need.
    if (sql.includes("cc.code,cc.name,cc.credits")) return rows(t.paper ? [{ revision_id: currentRevision, cohort_code: "K29", identity_key: "cong nghe thong tin:K29",
      code: "71ITMA10203", name: "Đại số tuyến tính và ứng dụng", credits: "3" }] : []);
    if (sql.includes("SELECT g.cohort_code,r.data")) return rows(t.paper ? [{ cohort_code: "K29", data: { ...standardData("Công nghệ dữ liệu", "7480201-02"),
      courses: [{ id: "x1", groupId: "g", code: "71MATL10053", name: "Đại số tuyến tính và ứng dụng", credits: 3, conditionOnly: false, sourceRow: 1 }] } }] : []);
    if (sql.includes("FROM ad_comp_courses")) return rows([{ id: "course-real", code: "71MATL10053", name: "Đại số tuyến tính và ứng dụng", credits: 3 }]);
    if (sql.includes("FROM curricula")) return rows(Array.from({ length: t.curricula }, (_, i) => ({
      id: i ? `other-${i}` : curriculumId, identity_key: "cong nghe thong tin:K29", revision_id: currentRevision, version: 3, name: "CTĐT K29", admission_year: 2023,
    })));
    // Weights of the shared courses of the current revision (migration 038), before the plain course rows.
    if (sql.includes("JOIN ad_comp_course_links")) return rows([{ course_code: "71ITBS10103", skill_id: "k1", weight: "0.5000000000" }]);
    if (sql.includes("JOIN ad_comp_course_configs")) return rows([{ active_count: t.weights ? 5 : 0, max_updated: t.weights ? new Date("2026-10-01T00:00:00Z") : null }]);
    if (sql.includes("FROM curriculum_courses")) return rows([
      { code: "71ITBS10103", name: "Nhập môn Công nghệ thông tin", credits: "3", type: "BB", block: "Kiến thức cơ sở khối ngành", specialty: "", semester: 1, study_year: 1 },
      { code: "71PEKC10062", name: "Cờ vua", credits: "2", type: "TC002 (2TC)", block: "Giáo dục thể chất và giáo dục quốc phòng", specialty: "", semester: 2, study_year: 1 },
      ...t.paper ? [{ code: "71ITMA10203", name: "Đại số tuyến tính và ứng dụng", credits: "3", type: "BB", block: "", specialty: "", semester: 1, study_year: 1 }] : [],
    ]);
    if (sql.includes("FROM curriculum_relations")) return rows([t.paper
      ? { course_code: "71ITBS10103", kind: "prior", raw: "71ITMA10203", target_codes: ["71ITMA10203"], unresolved_codes: [], review_required: false }
      : { course_code: "71ITBS10103", kind: "prior", raw: "", target_codes: [], unresolved_codes: [], review_required: false }]);
    if (sql.includes("FROM ad_comp_skills")) return rows([{ skill_id: "k1", name: "Lập trình", description: "", scope: "Phạm vi", group_id: "g1" }]);
    if (sql.includes("FROM ad_comp_groups")) return rows([{ id: "g1", name: "Chuyên môn" }]);
    if (sql.includes("FROM graduation_standards")) return rows([
      { id: "std-cnpm", revision_id: "r1", version: 1, data: standardData("Công nghệ phần mềm", "7480201-03") },
      { id: "std-cndl", revision_id: "r2", version: 4, data: standardData("Công nghệ dữ liệu", "7480201-02") },
    ]);
    if (sql.includes("FROM training_plans")) return rows(t.plans.map((plan, i) => ({
      id: `plan-${i}`, revision_id: `pr-${i}`, version: 1, linked: plan.linked, data: { major: plan.major, cohortCode: "K29", admissionYear: 2023, sections: [], terms: [],
        items: t.paper ? [{ code: "71ITMA10203", name: "Đại số tuyến tính và ứng dụng", prerequisite: "", prior: "71ITMA10203" }] : [] },
    })));
    if (sql.includes("FROM career_positions")) return rows(t.career ? [{ id: "p1", code: "NN009", name_vi: "Kỹ sư dữ liệu", name_en: "Data Engineer", version: "pv", deleted: false }] : []);
    if (sql.includes("FROM career_requirements")) return rows([{ id: "req1", skill_id: "k1", skill_name: "Lập trình", title: "Lập trình", is_required: true }]);
    if (sql.includes("FROM course_catalog")) return rows([{ code: "71AV010003", name: "Anh văn đầu vào" }]);
    if (sql.includes("FROM stu_study_plans")) return rows(t.studyPlan ? [{ data: t.studyPlan }] : []);
    throw new Error(`unexpected query: ${sql}`);
  });
  return { query, sql: () => query.mock.calls.map(([text]) => String(text)) };
}

describe("readAssessmentInputs", () => {
  it("builds the inputs from plain, ordered SELECTs", async () => {
    const db = fakeDb();
    const inputs = await readAssessmentInputs(db, userId, { promptVersion: "comp-v1" });
    expect(inputs.student).toEqual({ cohortCode: "K29", specialty: "CNDL", careerPositionId: "p1" });
    expect(inputs.transcript.version).toBe("v1");
    expect(inputs.curriculum).toMatchObject({ id: curriculumId, revisionId: currentRevision, version: 3, admissionYear: 2023 });
    expect(inputs.curriculum.courses[0]).toEqual({ code: "71ITBS10103", name: "Nhập môn Công nghệ thông tin", credits: 3, type: "BB",
      block: "Kiến thức cơ sở khối ngành", specialty: "", semester: 1, studyYear: 1 });
    expect(inputs.curriculum.relations).toHaveLength(1);
    expect(inputs.weights).toMatchObject({ revisionId: currentRevision, version: 3, activeCount: 5, maxConfigUpdatedAt: "2026-10-01T00:00:00.000Z",
      links: [{ courseCode: "71ITBS10103", skillId: "k1", weight: 0.5 }], groups: [{ id: "g1", name: "Chuyên môn" }] });
    expect(inputs.graduation.resolution).toBe("specialty");
    expect(inputs.graduation.standard).toMatchObject({ id: "std-cndl", revisionId: "r2", version: 4, data: { gpaScale: 4 } });
    expect(inputs.plan.resolution).toBe("found");
    expect(inputs.plan.revision).toMatchObject({ id: "plan-1", physicalEducationGroups: { TC002: ["71PEKC10062"], TC102: [] } });
    expect(inputs.career).toMatchObject({ id: "p1", code: "NN009", requirements: [{ id: "req1", skillId: "k1", isRequired: true }] });
    // A skill's other groups (migration 040), only the active ones; none here.
    expect(inputs.weights.skills).toEqual([{ skillId: "k1", name: "Lập trình", description: "", scope: "Phạm vi", groupId: "g1", otherGroupIds: [] }]);
    expect(db.sql().find((sql) => sql.includes("FROM ad_comp_skills s"))).toContain("FROM ad_comp_skill_groups m JOIN ad_comp_groups o ON o.id=m.group_id AND o.is_active");
    expect(inputs.catalogNames).toEqual({ "71AV010003": "Anh văn đầu vào" });
    expect(inputs.promptVersion).toBe("comp-v1");
    const calls = db.sql();
    expect(calls.some((sql) => /FOR (UPDATE|SHARE|NO KEY|KEY)/i.test(sql))).toBe(false);
    // Single-row reads need no order: the profile, the transcript, the career, the saved plan and the weight totals.
    for (const sql of calls.filter((text) => !/FROM (student_profiles|student_transcripts|career_positions|stu_study_plans) WHERE|^SELECT count\(\*\)::int AS active_count/.test(text)))
      expect(sql).toMatch(/ORDER BY/);
    // Without a saved plan nothing is planned (comp-calc-v23).
    expect(inputs.plannedCourses).toBeUndefined();
    // The weights are those of the shared courses of the current revision (migration 038).
    const weightLinks = db.query.mock.calls.find(([sql]) => String(sql).includes("JOIN ad_comp_course_links"));
    expect(String(weightLinks?.[0])).toContain("cfg.course_id=COALESCE(rc.course_id,cc.course_id) AND cfg.status='active'");
    expect(weightLinks?.[1]).toEqual([currentRevision, "[]"]);
    expect(inputs.curriculum.fileCodes).toBeUndefined();
    // Interests and career goals never leave the profile table.
    expect(calls.find((sql) => sql.includes("FROM student_profiles"))).not.toMatch(/interests|career_goal|full_name|student_code/);
    const catalog = db.query.mock.calls.find(([sql]) => String(sql).includes("course_catalog"));
    expect(catalog?.[1]).toEqual([["71AV010003"]]);
  });

  it("reads the courses the student placed in Kế hoạch học kỳ themselves, under the real codes, never what an AI roadmap added (comp-calc-v23)", async () => {
    const studyPlan = {
      schemaVersion: 1, roadmapId: null, kept: ["71ITSE30503"],
      aiAdded: { completedAt: "2026-11-01T00:00:00.000Z", term: "HK262", codes: ["71ITGR40203", "71ITGR40303", "71ITSE30503"], addedAt: "2026-11-01T00:00:00.000Z" },
      terms: [{ code: "HK262", courses: [{ code: "71itgr40206" }, { code: "71ITGR40203" }, { code: "71ITGR40303" }, { code: "71ITSE30503" }, { code: "71ITMA10203" }] }],
    };
    const inputs = await readAssessmentInputs(fakeDb({ studyPlan, paper: true }), userId);
    // Đồ án tốt nghiệp placed by the student, a course the student kept, the paper code read as the real one; the AI's two
    // chuyên đề are the system's suggestion, not the student's choice.
    expect(inputs.plannedCourses).toEqual(["71ITGR40206", "71ITSE30503", "71MATL10053"]);
    // A plan that does not parse reads as none.
    expect((await readAssessmentInputs(fakeDb({ studyPlan: { terms: "?" } }), userId)).plannedCourses).toBeUndefined();
  });

  it("reports missing data with the API error codes", async () => {
    const expectCode = async (overrides: Partial<Tables>, code: string) => {
      const error = await readAssessmentInputs(fakeDb(overrides), userId).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AssessmentError);
      expect(error).toMatchObject({ code, status: 409 });
    };
    await expectCode({ transcript: false }, "transcript_required");
    await expectCode({ profile: null }, "cohort_unknown");
    await expectCode({ profile: { cohort_code: "  ", specialty: null, career_position_id: null } }, "cohort_unknown");
    // The specialty is required; the target career is not since 2026-11-14 (plan "Một bước để bắt đầu").
    await expectCode({ specialty: null }, "specialty_required");
    await expectCode({ curricula: 0 }, "curriculum_unavailable");
    await expectCode({ curricula: 2 }, "curriculum_ambiguous");
    await expectCode({ weights: false }, "competency_weights_unavailable");
  });

  it("reads a student without a target career, or whose target is gone, with career null (2026-11-14: the target is optional)", async () => {
    const without = await readAssessmentInputs(fakeDb({ profile: { cohort_code: "K29", specialty: "CNDL", career_position_id: null } }), userId);
    expect(without.career).toBeNull();
    expect(without.student.careerPositionId).toBeNull();
    expect((await readAssessmentInputs(fakeDb({ career: false }), userId)).career).toBeNull();
  });

  it("marks several unlinked plans as ambiguous", async () => {
    const inputs = await readAssessmentInputs(fakeDb({ plans: [{ linked: false, major: "Khác" }, { linked: false, major: "Khác 2" }] }), userId);
    expect(inputs.plan).toEqual({ resolution: "ambiguous", revision: null });
    const none = await readAssessmentInputs(fakeDb({ plans: [] }), userId);
    expect(none.plan).toEqual({ resolution: "not_found", revision: null });
    const byIdentity = await readAssessmentInputs(fakeDb({ plans: [{ linked: false, major: "Khác" }, { linked: false, major: "Công nghệ thông tin" }] }), userId);
    expect(byIdentity.plan.revision?.id).toBe("plan-1");
  });

  // 2026-10-27: a cohort may have a CTĐT and a KHĐT per major; the student's are those of the major of the MSSV (052).
  it("reads the CTĐT, KHĐT and standard of the student's major", async () => {
    const db = fakeDb({ profile: { cohort_code: "K29", specialty: "CNDL", career_position_id: "p1", major_code: "7480104" } });
    await readAssessmentInputs(db, userId).catch(() => undefined);
    const call = (table: string) => db.query.mock.calls.find(([sql]) => String(sql).includes(`FROM ${table}`))!;
    expect(String(call("curricula")[0])).toContain("split_part(c.identity_key, ':', 1)");
    expect(call("curricula")[1]).toEqual(["K29", "he thong thong tin"]);
    expect(call("training_plans")[1]).toEqual(["K29", curriculumId, "he thong thong tin"]);
    // CNTT's standards are not those of HTTT: no standard until the Faculty adds one.
    const inputs = await readAssessmentInputs(fakeDb({ profile: { cohort_code: "K29", specialty: "CNDL", career_position_id: "p1", major_code: "7480104" } }), userId);
    expect(inputs.graduation.resolution).toBe("not_found");
    // Without a major (no MSSV) any framework of the cohort, as before.
    const unknown = fakeDb();
    await readAssessmentInputs(unknown, userId);
    expect(unknown.query.mock.calls.find(([sql]) => String(sql).includes("FROM curricula"))![1]).toEqual(["K29", null]);
  });
});

describe("readAssessmentInputs with the real codes of the standard (comp-calc-v22, user 2026-11-10)", () => {
  it("reads the CTĐT's paper code as the standard's real code, its weights from that course; graduation keeps the file's code", async () => {
    const db = fakeDb({ paper: true });
    const inputs = await readAssessmentInputs(db, userId);
    expect(inputs.curriculum.courses.map((course) => course.code)).toEqual(["71ITBS10103", "71PEKC10062", "71MATL10053"]);
    expect(inputs.curriculum.fileCodes).toEqual({ "71MATL10053": "71ITMA10203" });
    expect(inputs.curriculum.relations).toEqual([expect.objectContaining({ courseCode: "71ITBS10103", raw: "71MATL10053", targetCodes: ["71MATL10053"] })]);
    expect(inputs.plan.revision?.data.items).toEqual([expect.objectContaining({ code: "71MATL10053", prior: "71MATL10053" })]);
    // The row counts under the shared course of the real code (its existing configuration), keyed by the real code.
    const weightLinks = db.query.mock.calls.find(([sql]) => String(sql).includes("JOIN ad_comp_course_links"))!;
    expect(String(weightLinks[0])).toContain("COALESCE(rc.real_code,cc.code) AS course_code");
    expect(JSON.parse(String(weightLinks[1]![1]))).toEqual([{ revision_id: currentRevision, code: "71ITMA10203", real_code: "71MATL10053", course_id: "course-real" }]);
  });
});

describe("loadAssessmentInputs", () => {
  it("reads in a REPEATABLE READ READ ONLY snapshot and releases the client", async () => {
    const db = fakeDb();
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query: db.query, release }) } as unknown as DatabasePool;
    await loadAssessmentInputs(pool, userId);
    expect(db.sql()[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(db.sql().at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalled();
  });

  it("rolls back and rethrows on failure", async () => {
    const db = fakeDb({ transcript: false });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query: db.query, release }) } as unknown as DatabasePool;
    await expect(loadAssessmentInputs(pool, userId)).rejects.toMatchObject({ code: "transcript_required" });
    expect(db.sql().at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalled();
  });
});
