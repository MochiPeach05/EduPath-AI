import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import { syntheticCurriculum, syntheticPlan, syntheticStandards, syntheticStudentTerms, syntheticTranscript } from "../competency-assessment/fixtures/synthetic-k29.js";
import type { DatabasePool } from "../db/pool.js";
import { opensEveryTerm, planChoices, readStudyPlanFacts, type StudyPlanContext, type StudyPlanCourse } from "./context.js";
import { calendarTermCode, creditLimits, nextTerm, studyPlanSchema, termIndex, termLabel, type StudyPlanData } from "./model.js";
import { ownPlannedCodes } from "./own-plan.js";
import { prefillPlan, readAiPlan, readAiProposal } from "./prefill.js";
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
type Offering = { cohort_code: string; code: string; name: string; term_code: string; section_label: string | null };
type CurriculumClass = { cohort_code: string; major_key: string; admission_year: number | null; code: string; name: string; study_year: number | null; semester: number | null };
type Options = { specialty?: string | null; standards?: boolean; transcript?: boolean; active?: boolean; roadmap?: Roadmap; offerings?: Offering[];
  /** false: the standards come without their cohort, so curricula/real-codes.ts finds none (the CTĐT read as filed, before 2026-11-10). */
  realCodes?: boolean;
  /** Changes the synthetic transcript (a code printed otherwise). */
  transcriptData?: (data: ReturnType<typeof syntheticTranscript>) => ReturnType<typeof syntheticTranscript>;
  curriculumClasses?: CurriculumClass[];
  curriculum?: (data: ReturnType<typeof curriculumData>) => ReturnType<typeof curriculumData> };
function fakeDb(options: Options = {}) {
  const saved: { version: string; data: unknown; updated_at: Date }[] = [];
  const standards = options.standards === false ? [] : syntheticStandards().map((item) => ({ id: item.id, revision_id: item.revisionId, version: item.version, data: item.data,
    ...(options.realCodes === false ? {} : { cohort_code: "K29" }) }));
  const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return rows([]);
    if (sql.includes("SELECT id FROM users")) return options.active === false ? rows([]) : rows([{ id: studentId }]);
    if (sql.includes("FROM student_profiles")) return rows([{ cohort_code: "K29", specialty: options.specialty === undefined ? "CNPM" : options.specialty }]);
    if (sql.includes("FROM student_transcripts")) return rows(options.transcript === false ? []
      : [{ data: (options.transcriptData ?? ((data) => data))(syntheticTranscript(syntheticStudentTerms())) }]);
    if (sql.includes("JOIN curriculum_courses cc")) return rows(options.curriculumClasses ?? []);
    if (sql.includes("FROM curricula")) return rows(params[0] === "K29" ? [{ data: (options.curriculum ?? ((data) => data))(curriculumData()) }] : []);
    if (sql.includes("FROM graduation_standards")) return rows(standards);
    if (sql.includes("FROM training_plans tp JOIN training_plan_items")) {
      const plan = syntheticPlan().data;
      const labels = new Map(plan.sections.map((section) => [section.id, section.label]));
      const k29 = plan.items.map((item) => ({ cohort_code: "K29", code: item.code, name: item.name, term_code: item.termCode, section_label: labels.get(item.sectionId) ?? null }));
      // Another cohort's "Chọn" section never sets K29's requirements.
      return rows([...k29, { cohort_code: "K30", code: "71ITIN40304", name: "Đồ án thực tập", term_code: "HK262", section_label: null },
        { cohort_code: "K30", code: "71ITSE30803", name: "Lập trình Web nâng cao với framework", term_code: "HK262", section_label: "Chọn 2 trong 4 môn sau" },
        ...options.offerings ?? []]);
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
    expect(termLabel("HK262")).toBe("HK2 2026–2027");
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

  it("keeps what the AI roadmap's proposal added, so Kế hoạch học kỳ can name it later", () => {
    const aiAdded = { completedAt: "2026-10-24T10:00:00.000Z", term: "HK262", codes: ["71ITIN40304"], addedAt: "2026-10-24T10:05:00.000Z" };
    const plan = { schemaVersion: 1, roadmapId: "99999999-9999-4999-8999-999999999999", aiAdded, terms: [{ code: "HK262", courses: [{ code: "71ITIN40304" }] }] };
    expect(studyPlanSchema.parse(plan)).toEqual(plan);
    expect(studyPlanSchema.safeParse({ ...plan, aiAdded: null }).success).toBe(true);
    expect(studyPlanSchema.safeParse({ ...plan, aiAdded: { ...aiAdded, term: "2026" } }).success).toBe(false);
    expect(studyPlanSchema.safeParse({ ...plan, aiAdded: { ...aiAdded, extra: true } }).success).toBe(false);
  });

  it("keeps the courses the student kept when the page proposed to take them out (Bỏ qua, 2026-11-04)", () => {
    const plan = { schemaVersion: 1, roadmapId: "99999999-9999-4999-8999-999999999999", kept: ["71ITGR40203"], terms: [{ code: "HK262", courses: [{ code: "71ITGR40203" }] }] };
    expect(studyPlanSchema.parse(plan)).toEqual(plan);
    expect(studyPlanSchema.safeParse({ ...plan, kept: [""] }).success).toBe(false);
    expect(studyPlanSchema.safeParse({ ...plan, kept: null }).success).toBe(false);
  });
});

describe("courses opened every term (user 2026-11-04: \"môn anh văn kì nào cũng mở nhé\")", () => {
  it("knows English by its code or its name, and nothing else", () => {
    expect(opensEveryTerm("71ENG610063", "Anh văn 6 (AV6)")).toBe(true);
    expect(opensEveryTerm("71ENG010012", "Anh văn dự bị (AV0)")).toBe(true);
    expect(opensEveryTerm("X1", "Tiếng Anh chuyên ngành")).toBe(true);
    expect(opensEveryTerm("71ITAI40803", "Nhập môn xử lý ảnh số")).toBe(false);
    expect(opensEveryTerm("71ITSE30103", "Kiểm thử phần mềm")).toBe(false);
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

  it("matches a plan row by code, or by name whatever its accents, case and spaces (another cohort's code)", async () => {
    // A K27 plan opens the internship under an older code and a name written differently; an unrelated row does not count.
    const offerings = [{ cohort_code: "K27", code: "DIT0450", name: "  ĐỒ ÁN  thực tập ", term_code: "HK263", section_label: null },
      { cohort_code: "K27", code: "DIT0451", name: "Đồ án thực tập nâng cao", term_code: "HK271", section_label: null }];
    const course = (await facts({ offerings })).context.courses.find((item) => item.code === "71ITIN40304");
    expect(course).toMatchObject({ planTerm: "HK253", offeredTerms: ["HK253", "HK262", "HK263"] });
  });

  it("names the cohorts whose classes a course is studied in, by their training plan or, without one, their CTĐT (user 2026-11-08)", async () => {
    // K30's plan opens the internship in HK262 (fakeDb); K32 has no plan, its CTĐT puts it in year 1, HK2 (HK262 for 2026),
    // K31's in year 2, HK1 (HK261, the term of today); past classes, as K29's own HK253, are left out.
    const curriculumClasses = [
      { cohort_code: "K32", major_key: "cong nghe thong tin", admission_year: 2026, code: "71ITIN40304", name: "Đồ án thực tập", study_year: 1, semester: 2 },
      { cohort_code: "K31", major_key: "cong nghe thong tin", admission_year: null, code: "OLD0450", name: "Đồ án  thực tập", study_year: 2, semester: 1 },
    ];
    const course = (await facts({ curriculumClasses })).context.courses.find((item) => item.code === "71ITIN40304")!;
    expect(course.classes).toEqual([
      { term: "HK261", cohort: "K31", major: null, source: "curriculum" },
      { term: "HK262", cohort: "K30", major: null, source: "plan" },
      { term: "HK262", cohort: "K32", major: null, source: "curriculum" },
    ]);
    // The CTĐT's terms count as opened, as the plans' do.
    expect(course.offeredTerms).toEqual(["HK253", "HK261", "HK262"]);
  });

  it("asks Cờ vua nâng cao for Cờ vua studied first even when the CTĐT does not write it, and opens PE every term (user 2026-11-04)", async () => {
    const withAdvanced = (data: ReturnType<typeof curriculumData>) => {
      const chess = data.courses.find((course) => course.name === "Cờ vua")!;
      return { ...data, relations: data.relations.filter((relation) => relation.courseCode !== "71PEKC10172"),
        courses: [...data.courses, { ...chess, code: "71PEKC10172", name: "Cờ vua nâng cao" }] };
    };
    const courses = (await facts({ curriculum: withAdvanced })).context.courses;
    const chess = courses.find((course) => course.name === "Cờ vua")!;
    expect(courses.find((course) => course.code === "71PEKC10172")).toMatchObject({ prior: [chess.code], prerequisites: [], everyTerm: true });
    expect(chess.prior).toEqual([]);
    expect(chess.everyTerm).toBe(true);
  });

  it("asks a course of the student's program for the prerequisites of the student's own specialty only", async () => {
    // The CTĐT lists the prerequisites of Chuyên đề Tốt nghiệp 1 for every specialty: CNPM, then CNDL, then TTNT.
    const own = (await facts()).context.courses.find((course) => course.code === "71ITGR40203");
    expect(own?.prerequisites).toEqual(["71ITSE41003", "71ITSE41203"]);
    const data = (await facts({ specialty: "CNDL" })).context.courses.find((course) => course.code === "71ITGR40203");
    expect(data?.prerequisites).toEqual(["71ITDS40303"]);
    // Without a specialty every course applies, and so does every prerequisite.
    const any = (await facts({ specialty: null })).context.courses.find((course) => course.code === "71ITGR40203");
    expect(any?.prerequisites).toEqual(["71ITSE41003", "71ITSE41203", "71ITDS40303", "71ITAI40803"]);
  });

  it("takes the courses to choose in a CTĐT elective group from the cohort's training plan", async () => {
    const { context } = await facts({ standards: false });
    const groups = new Map(context.electiveGroups.map((group) => [group.code, group]));
    // K29 TC309 has no "(n TC)": its plan says "Chọn 1 trong 2 môn sau" (HK241) and "Chọn1 trong 3 môn sau" (HK243);
    // "Chọn các môn sau (Không tính vào tích lũy)" asks for nothing. K30's section is another cohort's.
    expect(groups.get("TC309")).toMatchObject({ requiredCredits: null, planChoice: { courses: 2, sections: [
      { label: "Chọn 1 trong 2 môn sau", termCode: "HK241" }, { label: "Chọn1 trong 3 môn sau", termCode: "HK243" }] } });
    // The thesis group has no section in the plan: nothing known; "(2TC)" groups keep their credits.
    expect(groups.get("TC406")?.planChoice).toBeNull();
    expect(groups.get("TC002")).toMatchObject({ requiredCredits: 2, planChoice: null });
  });

  it("counts a choice section in the group most of its options belong to, at most its own options", () => {
    const course = (code: string, group: string | null, applicable = true) => ({ code, name: `Môn ${code}`, group, applicable }) as StudyPlanCourse;
    const courses = [course("A1", "TC209"), course("A2", "TC209"), course("A3", "TC209"), course("B1", "TC309"), course("B2", "TC309"), course("X1", "TC309", false)];
    const row = (code: string, term_code: string, section_label: string | null) => ({ cohort_code: "K30", code, name: `Môn ${code}`, term_code, section_label });
    const choices = planChoices([
      // K30's "Chọn 2 trong 6 HP tự chọn Cơ sở ngành" lists a TC309 course among its TC209 ones.
      row("A1", "HK252", "Chọn 2 trong 6 HP tự chọn Cơ sở ngành"), row("A2", "HK252", "Chọn 2 trong 6 HP tự chọn Cơ sở ngành"), row("B1", "HK252", "Chọn 2 trong 6 HP tự chọn Cơ sở ngành"),
      // Only one of its options applies (X1 is another specialty's): one course, not two.
      row("B2", "HK262", "Chọn 2 trong 4 HP tự chọn Chuyên ngành sau"), row("X1", "HK262", "Chọn 2 trong 4 HP tự chọn Chuyên ngành sau"),
      // A course outside every section, and a section without k.
      row("A3", "HK253", null), row("A3", "HK261", "Chọn các môn sau (Không tính vào tích lũy)"),
    ], courses);
    expect(Object.fromEntries(choices)).toEqual({
      TC209: { courses: 2, sections: [{ label: "Chọn 2 trong 6 HP tự chọn Cơ sở ngành", termCode: "HK252" }] },
      TC309: { courses: 1, sections: [{ label: "Chọn 2 trong 4 HP tự chọn Chuyên ngành sau", termCode: "HK262" }] },
    });
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

describe("PE electives filling the numbered GDTC courses of the CTĐT (comp-calc-v21, user 2026-11-10)", () => {
  // Ngành HTTT K29: "Giáo dục thể chất (1)", "(2)" in the CTĐT, no PE elective; the student passed Cờ vua (HK232) and Bóng bàn (HK233).
  const htttLike = (names = ["Giáo dục thể chất (1)", "Giáo dục thể chất (2)"]) => (data: ReturnType<typeof curriculumData>) => {
    const base = data.courses.find((course) => course.code === "71ITBS10103")!;
    return { ...data, relations: data.relations.filter((relation) => !relation.courseCode.startsWith("71PE")), courses: [
      ...data.courses.filter((course) => !course.code.startsWith("71PE")),
      { ...base, code: "DGT0010", name: names[0]!, credits: 0, type: "BB", block: "", specialty: "", semester: 2, studyYear: 1 },
      { ...base, code: "DGT0020", name: names[1]!, credits: 0, type: "BB", block: "", specialty: "", semester: 3, studyYear: 1 },
    ] };
  };

  it("shows each GDTC course with the elective that fills it, never among the courses no requirement counts", async () => {
    const { context } = await facts({ standards: false, curriculum: htttLike() });
    const byCode = new Map(context.courses.map((course) => [course.code, course]));
    expect(byCode.get("DGT0010")).toMatchObject({ state: "passed", grade: "A", takenTerm: "HK232", attempts: 1, conditional: true, equivalent: null,
      filledBy: { code: "71PEKC10062", name: "Học phần tổng hợp" } });
    expect(byCode.get("DGT0020")).toMatchObject({ state: "passed", grade: "B", takenTerm: "HK233", filledBy: { code: "71PETT10012" } });
    expect(context.unmatched.map((course) => course.code).filter((code) => code.startsWith("71PE"))).toEqual([]);
    // Without numbered names the GDTC courses read "Chưa học" and the electives count toward nothing, as before.
    const before = (await facts({ standards: false, curriculum: htttLike(["Giáo dục thể chất A", "Giáo dục thể chất B"]) })).context;
    expect(before.courses.find((course) => course.code === "DGT0010")).toMatchObject({ state: "not_taken", conditional: false });
    expect(before.unmatched.map((course) => course.code)).toEqual(expect.arrayContaining(["71PEKC10062", "71PETT10012"]));
  });

  it("keeps the graduation standard's groups, credits and GPA as they were", async () => {
    const filled = (await facts({ curriculum: htttLike() })).context;
    const unfilled = (await facts({ curriculum: htttLike(["Giáo dục thể chất A", "Giáo dục thể chất B"]) })).context;
    expect(filled.courses.find((course) => course.code === "DGT0010")?.filledBy?.code).toBe("71PEKC10062");
    expect(filled.graduation).toEqual(unfilled.graduation);
    expect(filled.gpa).toEqual(unfilled.gpa);
    // The standard's TC102 electives still count there, with their own codes.
    expect(filled.courses.find((course) => course.code === "71PEKC10062")).toMatchObject({ state: "passed", onlyInStandard: true });
  });
});

describe("the real codes of the graduation standard (user 2026-11-10: \"dùng luôn mã thực tế\")", () => {
  // The CTĐT file writes two courses under codes students never register, the standard and the transcript use the real ones
  // (ngành HTTT K29: Chuyên đề Thương mại điện tử 71ISGR40203 for 71ITIS30503 in TC209, Đại số tuyến tính và ứng dụng
  // 71ITMA10203 for 71MATL10053, a mandatory course). Here: Phân tích thiết kế hệ thống (TC209) and Trí tuệ nhân tạo.
  const paperCodes: Record<string, string> = { "71ITIS30303": "71ISPP40303", "71ITAI40103": "71ITPP10203" };
  const onPaper = (data: ReturnType<typeof curriculumData>) => {
    const paper = (code: string) => paperCodes[code] ?? code;
    return { ...data, courses: data.courses.map((course) => ({ ...course, code: paper(course.code) })),
      relations: data.relations.map((relation) => ({ ...relation, courseCode: paper(relation.courseCode), targetCodes: relation.targetCodes.map(paper) })) };
  };
  /**
   * Theo dõi tiến độ's count of each group of the standard (web study-plan-data.ts auditGroups, official view): the group's codes
   * found among the course rows, the passed ones in the group's unit; and how many of its codes have no row.
   */
  const shown = (context: StudyPlanContext) => {
    const byCode = new Map(context.courses.map((course) => [course.code, course]));
    return context.graduation!.groups.map((group) => {
      const rows = group.courseCodes.map((code) => byCode.get(code)).filter((course): course is StudyPlanCourse => Boolean(course));
      const done = rows.filter((course) => course.state === "passed" || course.state === "exempt").reduce((sum, course) => sum + (group.unit === "TC" ? course.credits : 1), 0);
      return { label: group.label, done, required: group.required, missingRows: group.courseCodes.length - rows.length };
    });
  };
  const graduation = (context: StudyPlanContext) => context.graduation!.groups.map((group) => ({ label: group.label, done: group.passed, required: group.required, missingRows: 0 }));

  it("reads each such course under its real code, so every group of Theo dõi tiến độ counts what Xét tốt nghiệp counts", async () => {
    const { context } = await facts({ curriculum: onPaper });
    expect(shown(context)).toEqual(graduation(context));
    const byCode = new Map(context.courses.map((course) => [course.code, course]));
    expect(byCode.get("71ITIS30303")).toMatchObject({ name: "Phân tích thiết kế hệ thống", state: "passed", grade: "B", group: "TC309", onlyInStandard: false });
    expect(byCode.get("71ITAI40103")).toMatchObject({ state: "passed", grade: "D+", kind: "mandatory", onlyInStandard: false });
    // The paper codes are nowhere: no row, no course counted toward nothing.
    expect(context.courses.map((course) => course.code)).not.toEqual(expect.arrayContaining(["71ISPP40303"]));
    expect(context.courses.some((course) => Object.values(paperCodes).includes(course.code))).toBe(false);
    expect(context.unmatched.map((course) => course.code)).not.toContain("71ITIS30303");
  });

  it("was off before: the courses of the paper codes had no row in the standard's groups (TC209 6/9 TC beside 9/9)", async () => {
    const { context } = await facts({ curriculum: onPaper, realCodes: false });
    const before = shown(context);
    expect(before).not.toEqual(graduation(context));
    expect(before.find((group) => group.label === "Nhóm tự chọn TC209")).toMatchObject({ done: 3, required: 6, missingRows: 1 });
    expect(graduation(context).find((group) => group.label === "Nhóm tự chọn TC209")).toMatchObject({ done: 6 });
  });

  it("keeps graduation as it is: the standard's groups, credits and GPA read the CTĐT as filed", async () => {
    const real = (await facts({ curriculum: onPaper })).context, filed = (await facts({ curriculum: onPaper, realCodes: false })).context;
    expect(real.graduation).toEqual(filed.graduation);
    expect(real.gpa).toEqual(filed.gpa);
  });

  it("reads a transcript that prints the file's code as that course, under the real code, never through another", async () => {
    const printedOnPaper = (data: ReturnType<typeof syntheticTranscript>) => ({ ...data, sections: data.sections.map((section) => ({
      ...section, courses: section.courses.map((course) => (course.code === "71ITIS30303" ? { ...course, code: "71ISPP40303", name: "Phân tích thiết kế hệ thống" } : course)) })) });
    const { context } = await facts({ curriculum: onPaper, transcriptData: printedOnPaper });
    expect(context.courses.find((course) => course.code === "71ITIS30303")).toMatchObject({ state: "passed", grade: "B", equivalent: null });
    expect(context.courses.some((course) => course.code === "71ISPP40303")).toBe(false);
    expect(context.unmatched.map((course) => course.code)).not.toContain("71ISPP40303");
    expect(shown(context)).toEqual(graduation(context));
  });
});

describe("the courses the student placed themselves (own-plan.ts, user 2026-11-10)", () => {
  it("are every planned course but what an AI roadmap added and the student did not keep", () => {
    expect([...ownPlannedCodes({ terms: [{ code: "HK262", courses: [{ code: "71itgr40206" }, { code: "71ITGR40203" }, { code: "71ITIN40304" }] }],
      aiAdded: { completedAt: "2026-11-01T00:00:00.000Z", term: "HK262", codes: ["71ITGR40203", "71ITIN40304"], addedAt: "2026-11-01T00:00:00.000Z" },
      kept: ["71ITIN40304"] })].sort()).toEqual(["71ITGR40206", "71ITIN40304"]);
    expect(ownPlannedCodes({ terms: [] }).size).toBe(0);
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
    // Below a cumulative GPA of 2,80 the chuyên đề way is advised (user 2026-11-03): the running course stays out; Chuyên đề 1
    // brings Chuyên đề 2 only when the CTĐT has it (the synthetic one has not).
    const low = { ...loaded.context, thesis: loaded.context.thesis && { ...loaded.context.thesis, way: "replacement" as const } };
    const proposal = await readAiProposal(db as never, studentId, low, null);
    expect(proposal).toMatchObject({ roadmapId: roadmap.id, term: "HK262" });
    const codes = proposal!.courses.map((course) => course.code);
    expect(codes).toEqual(expect.arrayContaining(["71ITIN40304", "71ITGR40203"]));
    expect(codes).not.toContain("71ITSE41203");
    // From 2,80 the thesis is advised: a chuyên đề the model picked never goes into the plan.
    const high = { ...loaded.context, thesis: loaded.context.thesis && { ...loaded.context.thesis, way: "thesis" as const } };
    expect(loaded.context.thesis).toMatchObject({ thesis: "71ITGR40206" });
    expect(loaded.context.thesis).not.toHaveProperty("reason");
    expect((await readAiProposal(db as never, studentId, high, null))!.courses.map((course) => course.code)).not.toContain("71ITGR40203");
    // The student's own choice in the plan wins (user 2026-11-10): Đồ án tốt nghiệp placed below 2,80 keeps the chuyên đề out;
    // a replacement course placed from 2,80 lets the AI's chuyên đề in (the synthetic CTĐT has Chuyên đề 1 and 71ITIS30403 as
    // the replacement path); both ways placed, the AI adds nothing of the group.
    const proposed = async (context: typeof low, own: string[]) =>
      (await readAiPlan(db as never, studentId, context, null, new Map(), new Set(own))).proposal!.courses.map((course) => course.code);
    expect(await proposed(low, ["71ITGR40206"])).not.toContain("71ITGR40203");
    expect(await proposed(high, ["71ITIS30403"])).toContain("71ITGR40203");
    expect(await proposed(low, ["71ITGR40206", "71ITIS30403"])).not.toContain("71ITGR40203");
    expect(await proposed(low, ["71ITIN40304"])).toContain("71ITGR40203");
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
    const course = (code: string, offeredTerms: string[]) => ({ code, state: "not_taken", offeredTerms, applicable: true });
    const context = { currentTerm: "HK261", offeringUntil: "HK263", courses: [course("SUMMER", ["HK253"]), course("ANY", []), course("RARE", ["HK252"])] };
    // Plans open SUMMER in HK3 only (of an earlier year); nothing says when ANY is opened; RARE is an HK2 course whose
    // term no plan opens within a year, so it stays in the HK2 the roadmap prepares.
    expect((await readAiProposal(db as never, studentId, context as never, null))!.courses)
      .toEqual([{ code: "SUMMER", term: "HK263" }, { code: "ANY", term: "HK262" }, { code: "RARE", term: "HK262" }]);
  });

  it("places a course after the courses of the same proposal it waits for: Anh văn 5, 6 and 7 in three terms (user 2026-11-08)", async () => {
    const roadmap: Roadmap = {
      id: "99999999-9999-4999-8999-999999999999", completed_at: new Date("2026-11-08T04:58:00Z"),
      facts: { nextTerm: "HK262", study: [], choices: [] },
      output: { study: [{ code: "AV7" }, { code: "AV6" }, { code: "AV5" }, { code: "LATER" }], improve: [] },
    };
    const db = { query: vi.fn(async () => ({ rowCount: 1, rows: [roadmap] })) };
    const english = (code: string, state: string, prerequisites: string[]) =>
      ({ code, state, offeredTerms: [], everyTerm: true, applicable: true, prerequisites, prior: [] });
    const context = { currentTerm: "HK261", offeringUntil: "HK263", courses: [
      english("AV4", "in_progress", []), english("AV5", "not_taken", ["AV4"]), english("AV6", "not_taken", ["AV5"]), english("AV7", "not_taken", ["AV6"]),
      { code: "LATER", state: "not_taken", offeredTerms: ["HK262"], applicable: true, prerequisites: [], prior: ["AV5"] },
    ] };
    // English opens every term: AV5 (AV4 being studied is done by then) in HK262, AV6 in HK263, AV7 in HK271. LATER, an
    // HK2 course to study after AV5, goes to the next HK2.
    expect((await readAiProposal(db as never, studentId, context as never, null))!.courses).toEqual([
      { code: "AV7", term: "HK271" }, { code: "AV6", term: "HK263" }, { code: "AV5", term: "HK262" }, { code: "LATER", term: "HK272" },
    ]);
  });

  it("adds only courses still missing of the student's program; improvements are suggested, never added (user 2026-11-03)", async () => {
    const roadmap: Roadmap = {
      id: "99999999-9999-4999-8999-999999999999", completed_at: new Date("2026-11-03T07:24:00Z"),
      facts: { nextTerm: "HK262", study: [], choices: [] },
      output: { study: [{ code: "NEW" }, { code: "OTHER" }], improve: [{ code: "RETAKE" }, { code: "LOWD" }, { code: "OTHERD" }] },
    };
    const db = { query: vi.fn(async () => ({ rowCount: 1, rows: [roadmap] })) };
    const course = (code: string, state: string, applicable = true) => ({ code, state, offeredTerms: ["HK262"], applicable });
    const context = { currentTerm: "HK261", offeringUntil: "HK263", courses: [course("NEW", "not_taken"), course("OTHER", "not_taken", false),
      course("RETAKE", "failed"), course("LOWD", "passed"), course("OTHERD", "passed", false)] };
    const ai = await readAiPlan(db as never, studentId, context as never, null);
    // Another specialty's course never goes in; a failed course is still missing (học lại); a passed D is only suggested.
    expect(ai.proposal!.courses.map((item) => item.code)).toEqual(["NEW", "RETAKE"]);
    expect(ai.suggestions).toEqual([{ code: "LOWD", term: "HK262" }]);
    // Once the plan took the roadmap in (or the student declined it), the improvement stays suggested.
    expect(await readAiPlan(db as never, studentId, context as never, roadmap.id))
      .toEqual({ proposal: null, suggestions: [{ code: "LOWD", term: "HK262" }], roadmapId: roadmap.id });
    // The page compares the newest completed roadmap with the one Lộ trình AI đề xuất shows.
    expect(ai.roadmapId).toBe(roadmap.id);
    expect(await readAiPlan({ query: vi.fn(async () => ({ rowCount: 0, rows: [] })) } as never, studentId, context as never, null))
      .toEqual({ proposal: null, suggestions: [], roadmapId: null });
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
    expect(response.body.aiRoadmapId).toBeNull();
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

  it("reads a plan saved with a CTĐT file's code under the real code of the standard (2026-11-10)", async () => {
    // The file writes Phân tích thiết kế hệ thống under a code students never register; the standard and the transcript use
    // 71ITIS30303. A plan saved before the page read the real codes names the file's code: it comes back under the real one.
    const { app } = setup({ curriculum: (data) => ({ ...data, courses: data.courses.map((course) => (course.code === "71ITIS30303" ? { ...course, code: "71ISPP40303" } : course)) }) });
    const old = { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "71ISPP40303" }, { code: "71ITIN40304" }] }] };
    await request(app).put("/plan").set("Origin", origin).send({ version: null, data: old }).expect(200);
    const response = await request(app).get("/plan").expect(200);
    expect(response.body.plan.data.terms).toEqual([{ code: "HK262", courses: [{ code: "71ITIS30303" }, { code: "71ITIN40304" }] }]);
    expect(response.body.context.courses.map((course: { code: string }) => course.code)).toContain("71ITIS30303");
    expect(response.body.context.courses.map((course: { code: string }) => course.code)).not.toContain("71ISPP40303");
  });

  it("deletes the saved plan with its version only", async () => {
    const { app } = setup();
    const saved = await request(app).put("/plan").set("Origin", origin).send({ version: null, data: plan }).expect(200);
    await request(app).delete("/plan").set("Origin", origin).send({ version: "33333333-3333-4333-8333-333333333333" }).expect(409, { error: "plan_changed" });
    await request(app).delete("/plan").set("Origin", origin).send({ version: saved.body.plan.version }).expect(200, { plan: null });
    expect((await request(app).get("/plan").expect(200)).body.plan).toBeNull();
  });
});
