import type { PoolClient } from "pg";
import { courseKey, curriculumTermCode, electiveCodeOf, isConditionOnly, studyTermCode, uniqueCurriculumCourses } from "../competency-assessment/course-state.js";
import { CONDITION_ONLY_BLOCK } from "../competency-assessment/constants.js";
import { assessGraduationGpa, assessGraduationStandard, graduationCodeAliases, graduationInputs } from "../competency-assessment/graduation.js";
import { classifyCurriculumSpecialty, fold, specialtyLabel } from "../competency-assessment/specialty.js";
import type { CourseState, CurriculumCourseInput, GraduationStandardInput, SpecialtyCode, TriState } from "../competency-assessment/types.js";
import type { CurriculumData } from "../curricula/model.js";
import { normalizeCohortCode, profileSpecialty, resolveStudentStandard } from "../graduation/resolve.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import { calendarTermCode, creditLimits, termIndex } from "./model.js";

// What the "Lộ trình học tập" page shows besides the AI roadmap (user 2026-10-24, after Stellic): "Theo dõi tiến độ"
// (the graduation standard's requirements with every course's state) and "Lên kế hoạch" (the courses still needed,
// with their conditions and the terms the training plans open them).

type Db = Pick<PoolClient, "query">;

/** One CTĐT course (or a course only the graduation standard lists) as the page needs it. */
export type StudyPlanCourse = {
  code: string;
  name: string;
  credits: number;
  /** CTĐT course type: "BB", "TC102 (6TC)" … */
  type: string;
  kind: "mandatory" | "elective";
  /** Elective group code ("TC102"), null for a mandatory course. */
  group: string | null;
  /** GDTC/GDQP: outside accumulated credits and the credit limits. */
  conditional: boolean;
  /**
   * Common, the student's own specialty, any specialty while the student has none, or listed by the student's graduation
   * standard (it decides graduation: K27's requires 71ITDS40503, which the CTĐT files under Công nghệ Dữ liệu).
   */
  applicable: boolean;
  /** The CTĐT specialty of a specialty course ("Công nghệ Phần mềm"), null for a common course. */
  specialtyName: string | null;
  /** HKyyS of the CTĐT study year and semester for the student's intake, or null. */
  standardTerm: string | null;
  /** Courses to pass first (tiên quyết) and to have studied first (học trước), CTĐT codes. */
  prerequisites: string[];
  prior: string[];
  state: CourseState;
  /** HKyyS of a registration without grades yet (the course is being studied), else null. */
  inProgressTerm: string | null;
  /** A course of the graduation standard that the CTĐT lists neither by code nor by name (K26: DTA0620). */
  onlyInStandard: boolean;
  /** HKyyS of the course in the student's own cohort's training plan (kế hoạch đào tạo), else null. */
  planTerm: string | null;
  /**
   * Terms in which a training plan of any cohort opens the course, by code or by name (K26's old codes): the school
   * opens classes mostly by these plans, and courses outside them rarely (user, 2026-10-24).
   */
  offeredTerms: string[];
  /** The letter of the attempt that counts (A … F, VT, MT), the term it was taken and how many times the course was taken. */
  grade: string | null;
  takenTerm: string | null;
  attempts: number;
  /** The other code the course is counted through: an older code of the standard, or a same-name course of another cohort. */
  equivalent: string | null;
};

export type StudyPlanGraduationGroup = {
  label: string; kind: "mandatory" | "elective"; unit: "môn" | "TC"; required: number | null;
  /** Certainly completed (passed/MT), in the group's unit. */
  passed: number | null;
  status: TriState;
  courseCodes: string[];
};

/** A course of the transcript that counts toward no requirement (Stellic's "Unmatched courses"). */
export type StudyPlanUnmatched = { code: string; name: string; credits: number; state: CourseState; grade: string | null; term: string | null };

export type StudyPlanContext = {
  cohortCode: string | null;
  specialty: SpecialtyCode | null;
  specialtyLabel: string | null;
  curriculum: { name: string; totalCredits: number | null } | null;
  hasTranscript: boolean;
  /** The term running now (HKyyS): the later of the calendar's term and the term the transcript is being studied in. */
  currentTerm: string;
  /** The term being studied according to the transcript (registrations without grades, comp-calc-v13), else null. */
  studyTerm: string | null;
  admissionYear: number | null;
  /** Terms of the CTĐT for the student's intake, oldest first. */
  standardTerms: string[];
  limits: { average: number; min: number; max: number } | null;
  courses: StudyPlanCourse[];
  /** CTĐT elective groups: required credits from "(n TC)". */
  electiveGroups: { code: string; requiredCredits: number | null; courseCodes: string[] }[];
  /** The last term any training plan covers; later terms have no plan to compare with (null without plans). */
  offeringUntil: string | null;
  /**
   * The student's graduation standard, when one is resolved: its groups (what graduating takes; a CTĐT elective group
   * often states no credits, the standard does) and the accumulated credits against its minimum.
   */
  graduation: {
    standardName: string;
    groups: StudyPlanGraduationGroup[];
    credits: { completed: number | null; required: number; source: "printed" | "calculated" } | null;
  } | null;
  /** The cumulative GPA (printed, else calculated) on the standard's scale (4 without one), and the standard's minimum. */
  gpa: { actual: number | null; required: number | null; scale: 4 | 10 };
  /** Courses of the transcript no requirement counts (another specialty's course, a course outside the program). */
  unmatched: StudyPlanUnmatched[];
};

/** What the server keeps for the graduation projection; never sent to the browser as is. */
export type StudyPlanFacts = {
  context: StudyPlanContext;
  standard: GraduationStandardInput | null;
  transcript: TranscriptData | null;
  curriculumCourses: CurriculumCourseInput[];
};

const EMPTY_TRANSCRIPT: TranscriptData = { schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: 0, courseCount: 0, sections: [], warnings: [] };

/** The cohort's single active CTĐT (current revision), or null when there is none or several. */
async function readCurriculum(db: Db, cohortCode: string): Promise<CurriculumData | null> {
  const rows = (await db.query<{ data: CurriculumData }>(
    `SELECT r.data FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision
     WHERE c.is_active AND c.cohort_code=$1 ORDER BY c.id`, [cohortCode])).rows;
  return rows.length === 1 ? rows[0]!.data : null;
}

/** Items of every active training plan (kế hoạch đào tạo): which course each cohort's plan opens in which term. */
async function readPlanOfferings(db: Db) {
  return (await db.query<{ cohort_code: string; code: string; name: string; term_code: string }>(
    `SELECT tp.cohort_code,i.code,i.name,i.term_code FROM training_plans tp JOIN training_plan_items i ON i.revision_id=tp.current_revision
     WHERE tp.is_active ORDER BY tp.cohort_code,i.position`)).rows;
}

const laterTerm = (a: string, b: string | null) => (b && termIndex(b) > termIndex(a) ? b : a);

/** Reads everything the page needs for one student with plain SELECTs (the caller holds a snapshot). */
export async function readStudyPlanFacts(db: Db, userId: string, now = new Date()): Promise<StudyPlanFacts> {
  const profileRow = (await db.query<{ cohort_code: string | null; specialty: string | null }>(
    "SELECT cohort_code,specialty FROM student_profiles WHERE user_id=$1", [userId])).rows[0];
  const cohortCode = normalizeCohortCode(profileRow?.cohort_code);
  const specialty = profileSpecialty(profileRow?.specialty);
  const transcript = (await db.query<{ data: TranscriptData }>("SELECT parsed_data AS data FROM student_transcripts WHERE user_id=$1", [userId])).rows[0]?.data ?? null;
  const curriculum = cohortCode ? await readCurriculum(db, cohortCode) : null;
  const { standard } = await resolveStudentStandard(db, { cohortCode, specialty });
  const offerings = await readPlanOfferings(db);
  const cohortNumber = Number(/^K(\d{2})$/.exec(cohortCode ?? "")?.[1]);
  // The CTĐT's intake year, else the cohort's as the student identity reads it (K29 → 2023).
  const admissionYear = curriculum?.admissionYear ?? (Number.isInteger(cohortNumber) ? cohortNumber + 1994 : null);
  const sourceCourses = uniqueCurriculumCourses(curriculum?.courses ?? []);
  const curriculumCourses: CurriculumCourseInput[] = sourceCourses.map((course) => ({
    code: course.code, name: course.name, credits: course.credits, type: course.type, block: course.block,
    specialty: course.specialty, semester: course.semester, studyYear: course.studyYear,
  }));
  const readTranscript = transcript ?? EMPTY_TRANSCRIPT;
  const inputs = graduationInputs(standard?.data ?? null, curriculumCourses, readTranscript);
  const standardCodes = new Set((standard?.data.courses ?? []).map((course) => courseKey(course.code)));
  const relationsOf = (code: string, kind: "prerequisite" | "prior") => [...new Set((curriculum?.relations ?? [])
    .filter((relation) => relation.kind === kind && courseKey(relation.courseCode) === courseKey(code))
    .flatMap((relation) => relation.targetCodes.map(courseKey)))];
  const termsOf = (rows: typeof offerings) => [...new Set(rows.map((row) => row.term_code))].sort((a, b) => termIndex(a) - termIndex(b));
  // A course matches a plan row by code, or by name when cohorts carry different codes for it.
  const planRows = (code: string, name: string) => offerings.filter((row) => courseKey(row.code) === code || fold(row.name) === fold(name));
  const planTermOf = (code: string, name: string) => termsOf(planRows(code, name).filter((row) => normalizeCohortCode(row.cohort_code) === cohortCode))[0] ?? null;

  // The other code a course is counted through: an older code of the standard (K26 "DIT0091 / 71ITDS30103"), or a
  // same-name course of another cohort ("học trả nợ với khóa sau").
  const { aliases, transfers } = graduationCodeAliases(standard?.data ?? null, readTranscript, new Set(curriculumCourses.map((course) => courseKey(course.code))));
  const printedCodes = new Set(readTranscript.sections.flatMap((section) => section.courses.map((course) => courseKey(course.code ?? ""))));
  const equivalentOf = (code: string) => transfers.find((transfer) => courseKey(transfer.code) === code)?.viaCode
    ?? [...aliases].find(([printed, main]) => main === code && printed !== code && printedCodes.has(printed))?.[0] ?? null;
  const audit = (code: string) => {
    const record = inputs.records.get(code);
    return { grade: record?.selected.letter ?? null, takenTerm: record?.selected.termCode ?? null, attempts: record?.attempts.length ?? 0, equivalent: equivalentOf(code) };
  };

  const courses: StudyPlanCourse[] = sourceCourses.map((course) => {
    const code = courseKey(course.code);
    const record = inputs.records.get(code);
    const group = electiveCodeOf(course.type);
    const specialtyClass = classifyCurriculumSpecialty(course.specialty, cohortCode);
    const ownSpecialty = specialtyClass.kind === "common" || !specialty || specialtyClass.code === specialty || standardCodes.has(code);
    const running = record?.attempts.filter((attempt) => !attempt.graded && attempt.termCode).map((attempt) => attempt.termCode!) ?? [];
    return {
      code, name: course.name, credits: course.credits, type: course.type, kind: group ? "elective" : "mandatory", group,
      conditional: isConditionOnly(code, inputs.conditionCodes) || fold(course.block).includes(CONDITION_ONLY_BLOCK) || course.name.includes("*"),
      applicable: ownSpecialty, specialtyName: specialtyClass.kind === "specialty" ? course.specialty : null,
      standardTerm: curriculumTermCode(admissionYear, course.studyYear, course.semester),
      prerequisites: relationsOf(code, "prerequisite"), prior: relationsOf(code, "prior"),
      state: record?.state ?? "not_taken",
      inProgressTerm: record?.state === "in_progress" && running.length ? running.sort((a, b) => termIndex(b) - termIndex(a))[0]! : null,
      onlyInStandard: false, planTerm: planTermOf(code, course.name), offeredTerms: termsOf(planRows(code, course.name)), ...audit(code),
    };
  });
  // The standard can require a course the CTĐT does not list; a same-name CTĐT course is the same course (9a0e8b1).
  const known = new Set(courses.map((course) => course.code)), knownNames = new Set(courses.map((course) => fold(course.name)));
  for (const group of standard?.data.groups ?? []) for (const item of standard!.data.courses.filter((course) => course.groupId === group.id)) {
    const code = courseKey(item.code);
    if (!code || known.has(code) || knownNames.has(fold(item.name))) continue;
    known.add(code);
    const record = inputs.records.get(code);
    courses.push({
      code, name: item.name, credits: item.credits ?? 0, type: group.kind === "mandatory" ? "BB" : "", kind: group.kind === "mandatory" ? "mandatory" : "elective",
      group: null, conditional: item.conditionOnly, applicable: true, specialtyName: null, standardTerm: null, prerequisites: [], prior: [],
      state: record?.state ?? "not_taken", inProgressTerm: null, onlyInStandard: true,
      planTerm: planTermOf(code, item.name), offeredTerms: termsOf(planRows(code, item.name)), ...audit(code),
    });
  }

  let graduation: StudyPlanContext["graduation"] = null;
  // Without a standard the GPA is read on the 4-point scale, with no minimum.
  let gpa: StudyPlanContext["gpa"] = { actual: null, required: null, scale: 4 };
  if (transcript && !standard) gpa.actual = assessGraduationGpa({ minimumGpa: 0, gpaScale: 4 }, transcript, inputs.records, inputs.conditionCodes).actual;
  if (standard) {
    const assessed = assessGraduationStandard(standard.data, inputs);
    gpa = { actual: assessed.gpa.actual, required: assessed.gpa.required, scale: assessed.gpa.scale };
    graduation = {
      standardName: standard.data.name,
      groups: assessed.groups.map((group): StudyPlanGraduationGroup => ({
        label: group.label, kind: group.kind, unit: group.unit, required: group.required, passed: group.lower, status: group.status,
        courseCodes: [...new Set(standard.data.courses.filter((course) => course.groupId === group.groupId).map((course) => courseKey(course.code)))],
      })),
      credits: assessed.credits ? { completed: assessed.credits.lower, required: assessed.credits.required, source: assessed.credits.source } : null,
    };
  }

  // Unmatched: transcript courses outside every group of the standard (without one: outside the CTĐT courses that apply).
  const counted = graduation ? new Set(graduation.groups.flatMap((group) => group.courseCodes))
    : new Set(courses.filter((course) => course.applicable).map((course) => course.code));
  const printedNames = new Map<string, string>();
  for (const section of readTranscript.sections) for (const course of section.courses) {
    const code = aliases.get(courseKey(course.code ?? "")) ?? courseKey(course.code ?? "");
    if (code && course.name?.trim() && !printedNames.has(code)) printedNames.set(code, course.name.trim());
  }
  const unmatched: StudyPlanUnmatched[] = [...inputs.records.values()]
    .filter((record) => !counted.has(record.code))
    .map((record) => ({
      code: record.code, name: courses.find((course) => course.code === record.code)?.name ?? printedNames.get(record.code) ?? record.code,
      credits: record.selected.credits, state: record.state, grade: record.selected.letter, term: record.selected.termCode,
    }))
    .sort((a, b) => (a.term ?? "").localeCompare(b.term ?? "") || a.code.localeCompare(b.code));

  const standardTerms = [...new Set(courses.map((course) => course.standardTerm).filter((term): term is string => term !== null))]
    .sort((a, b) => termIndex(a) - termIndex(b));
  const totalCredits = curriculum?.totalCredits ?? null;
  const studyTerm = transcript ? studyTermCode(transcript) : null;
  return {
    context: {
      cohortCode, specialty, specialtyLabel: specialtyLabel(specialty),
      curriculum: curriculum ? { name: curriculum.name, totalCredits } : null,
      hasTranscript: Boolean(transcript), currentTerm: laterTerm(calendarTermCode(now), studyTerm), studyTerm, admissionYear, standardTerms,
      limits: creditLimits(totalCredits, standardTerms.length), courses,
      electiveGroups: inputs.electives.map((group) => ({ code: group.code, requiredCredits: group.requiredCredits, courseCodes: group.courseCodes })),
      offeringUntil: termsOf(offerings).at(-1) ?? null,
      graduation, gpa, unmatched,
    },
    standard, transcript, curriculumCourses,
  };
}
