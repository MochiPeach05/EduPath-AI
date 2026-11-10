import type { PoolClient } from "pg";
import { courseNameKey } from "../competency-assessment/graduation.js";
import type { GraduationData } from "../graduation/model.js";
import { normalizeCohortCode, standardIdentity, standardMajor } from "../graduation/resolve.js";
import { MAJORS, majorCondition, majorIdentity, majorKey } from "./majors.js";

// "Mã thực tế" (user 2026-11-10: "dùng luôn mã thực tế"; "các file điều kiện xét tốt nghiệp thường là file dữ liệu đầu ra cuối
// cùng chính xác nhất"). Some CTĐT revisions write a course under a code students never register, while the graduation
// standard of the same cohort and major, and the transcripts, use the real one: ngành HTTT K29 writes Đại số tuyến tính và
// ứng dụng 71ITMA10203 and Chuyên đề Thương mại điện tử 71ISGR40203, students take 71MATL10053 and 71ITIS30503. Every view
// of a CTĐT reads the real code: the competency engine (competency-assessment/inputs.ts), Lộ trình học tập and Kế hoạch học
// kỳ (study-plan/context.ts, a saved plan too), Tổng quan, Lộ trình AI's relations (roadmap/jobs.ts), Trợ lý AI's catalog
// (assistant/knowledge.ts), Cấu hình môn học and the career course weights (the row counts under the real code's shared
// course), the student CTĐT and KHĐT (curricula/student-router.ts, plans/student-router.ts: the real code is the row's
// code), and the admin CTĐT and KHĐT details (`realCode` on the row, withRealCodeField, with the file's code beside it; the
// KHĐT's rows take the codes of the plan's CTĐT, readPlanRealCodes, as the student KHĐT does). The CTĐT and the KHĐT keep the
// file's code (an admin edits the row by it) and graduation reads the CTĐT as filed, so its results do not change.

type Db = Pick<PoolClient, "query">;
type StandardCourse = GraduationData["courses"][number];

const key = (code: string) => code.trim().toUpperCase();

/**
 * CTĐT code → real code. A CTĐT course whose code no standard of its cohort and major lists (code or alternativeCodes) takes
 * the code of the standards' one course with the same name (graduation.ts courseNameKey, the name rule of graduationCodeAliases)
 * and the same credits, when that code is no other course of the CTĐT. Every standard that names the course must agree: one
 * listing the CTĐT's own code, two codes, two courses of that name, other credits (or none) keep the CTĐT's code. Two CTĐT
 * courses never take one code (both keep theirs).
 */
export function realCourseCodes(
  courses: readonly { code: string; name: string; credits: number }[],
  standards: readonly Pick<GraduationData, "courses">[],
): Map<string, string> {
  const codes = new Set(courses.map((course) => key(course.code)));
  const known = standards.map((standard) => new Set(standard.courses.flatMap((course) => [course.code, ...(course.alternativeCodes ?? [])].map(key))));
  const named = standards.map((standard) => {
    const names = new Map<string, StandardCourse[]>();
    for (const course of standard.courses) {
      const name = courseNameKey(course.name);
      if (name) names.set(name, [...(names.get(name) ?? []), course]);
    }
    return names;
  });
  const found = new Map<string, string>();
  const seen = new Set<string>();
  for (const course of courses) {
    const code = key(course.code), name = courseNameKey(course.name);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    if (!name) continue;
    let real: string | null = null, blocked = false;
    standards.forEach((_, index) => {
      if (known[index]!.has(code)) { blocked = true; return; }
      const same = named[index]!.get(name) ?? [];
      if (!same.length) return;
      const targets = [...new Set(same.map((item) => key(item.code)))];
      const target = targets[0]!;
      const credits = same.every((item) => item.credits === course.credits);
      if (targets.length > 1 || !credits || codes.has(target) || (real !== null && real !== target)) { blocked = true; return; }
      real = target;
    });
    if (real !== null && !blocked) found.set(code, real);
  }
  const taken = new Map<string, number>();
  for (const real of found.values()) taken.set(real, (taken.get(real) ?? 0) + 1);
  return new Map([...found].filter(([, real]) => taken.get(real) === 1));
}

/**
 * The rows (a CTĐT's courses, a KHĐT's items) with `realCode` on each one the file writes under another code, the file's
 * code kept as `code`: the admin CTĐT detail shows `realCode ?? code` with the file's code beside it, and edits the row by
 * `code`. The other rows are returned as they are.
 */
export function withRealCodeField<T extends { code: string }>(rows: readonly T[], codes: ReadonlyMap<string, string>): (T & { realCode?: string })[] {
  if (!codes.size) return [...rows];
  return rows.map((row) => {
    const real = codes.get(key(row.code));
    return real ? { ...row, realCode: real } : row;
  });
}

/**
 * A saved Kế hoạch học kỳ (stu_study_plans) with the real codes: a plan saved before 2026-11-10 names such a course by the
 * file's code, which no page lists any more. A course planned twice that way stays once (its first term).
 */
export function studyPlanWithRealCodes<T extends {
  terms: { courses: { code: string }[] }[]; aiAdded?: { codes: string[] } | null | undefined; kept?: string[] | undefined;
}>(plan: T, codes: ReadonlyMap<string, string>): T {
  if (!codes.size) return plan;
  const real = (code: string) => codes.get(key(code)) ?? code;
  const once = (list: readonly string[]) => [...new Map(list.map((code) => [key(code), code])).values()];
  const seen = new Set<string>();
  return {
    ...plan,
    terms: plan.terms.map((term) => ({
      ...term,
      courses: term.courses.flatMap((course) => {
        const code = real(course.code);
        if (seen.has(key(code))) return [];
        seen.add(key(code));
        return [{ ...course, code }];
      }),
    })),
    ...(plan.aiAdded ? { aiAdded: { ...plan.aiAdded, codes: once(plan.aiAdded.codes.map(real)) } } : {}),
    ...(plan.kept ? { kept: once(plan.kept.map(real)) } : {}),
  };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A text that names courses by code (a relation "71ITMA10203 (Đại số …)"), its CTĐT codes written as the real ones. */
export function realCodesInText(text: string, codes: ReadonlyMap<string, string>): string {
  if (!text || !codes.size) return text;
  let result = text;
  for (const [file, real] of codes) result = result.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(file)}(?![\\p{L}\\p{N}])`, "giu"), real);
  return result;
}

type CurriculumLike = {
  courses: { code: string; prerequisite?: string; prior?: string }[];
  electives?: { courseCodes: string[] }[];
  relations?: { courseCode: string; raw: string; targetCodes: string[]; unresolvedCodes: string[] }[];
};

/**
 * A CTĐT revision's data with the real codes: its courses (each changed one keeps the file's code in `fileCode`), elective
 * groups, relations and the texts of its conditions. The data given is left as it is.
 */
export function curriculumWithRealCodes<T extends CurriculumLike>(data: T, codes: ReadonlyMap<string, string>):
  T & { courses: (T["courses"][number] & { fileCode?: string })[] } {
  if (!codes.size) return data;
  const real = (code: string) => (codes.has(key(code)) ? codes.get(key(code))! : code);
  return {
    ...data,
    courses: data.courses.map((course) => {
      const code = real(course.code);
      return {
        ...course, code,
        ...(course.prerequisite !== undefined ? { prerequisite: realCodesInText(course.prerequisite, codes) } : {}),
        ...(course.prior !== undefined ? { prior: realCodesInText(course.prior, codes) } : {}),
        ...(code !== course.code ? { fileCode: course.code } : {}),
      };
    }),
    ...(data.electives ? { electives: data.electives.map((group) => ({ ...group, courseCodes: group.courseCodes.map(real) })) } : {}),
    ...(data.relations ? {
      relations: data.relations.map((relation) => ({
        ...relation, courseCode: real(relation.courseCode), raw: realCodesInText(relation.raw, codes),
        targetCodes: relation.targetCodes.map(real), unresolvedCodes: relation.unresolvedCodes.map(real),
      })),
    } : {}),
  };
}

/** A training plan (KHĐT) of the cohort and major, with the real codes of their CTĐT in its items and their conditions. */
export function planWithRealCodes<T extends { items: { code: string; prerequisite?: string; prior?: string }[] }>(data: T, codes: ReadonlyMap<string, string>): T {
  if (!codes.size) return data;
  return {
    ...data,
    items: data.items.map((item) => ({
      ...item, code: codes.get(key(item.code)) ?? item.code,
      ...(item.prerequisite !== undefined ? { prerequisite: realCodesInText(item.prerequisite, codes) } : {}),
      ...(item.prior !== undefined ? { prior: realCodesInText(item.prior, codes) } : {}),
    })),
  };
}

/** The programme of a CTĐT/KHĐT identity ("he thong thong tin:K29" → "7480104"), or null for a major the Faculty does not list. */
export const identityProgramme = (identityKey: string): string | null =>
  MAJORS.find((major) => majorKey(major.name) === identityKey.split(":")[0])?.code ?? null;

type StandardRow = { cohort_code: string; data: GraduationData };

/** The active standards of the cohorts (current revisions), as graduation/resolve.ts reads a cohort's candidates. */
async function activeStandards(db: Db, cohorts: readonly string[]): Promise<StandardRow[]> {
  if (!cohorts.length) return [];
  return (await db.query<StandardRow>(
    `SELECT g.cohort_code,r.data FROM graduation_standards g JOIN graduation_revisions r ON r.id=g.current_revision
     WHERE g.is_active AND g.cohort_code=ANY($1::text[]) ORDER BY g.id`, [[...new Set(cohorts)]])).rows;
}

/** The standards a CTĐT is read against: those of its cohort and of its major (graduation/resolve.ts resolveCohortStandard). */
const ownStandards = (standards: readonly StandardRow[], cohortCode: string, identityKey: string) => {
  const programme = identityProgramme(identityKey);
  return standards.filter((row) => row.cohort_code === cohortCode && (!programme || standardMajor(standardIdentity(row.data)) === programme))
    .map((row) => row.data);
};

/** The real codes of one CTĐT, its courses as read (curriculum_courses or the revision's data). */
export async function readRealCodes(db: Db, curriculum: { cohortCode: string; identityKey: string; courses: readonly { code: string; name: string; credits: number | string }[] }):
  Promise<Map<string, string>> {
  const standards = await activeStandards(db, [curriculum.cohortCode]);
  return realCourseCodes(curriculum.courses.map((course) => ({ code: course.code, name: course.name, credits: Number(course.credits) })),
    ownStandards(standards, curriculum.cohortCode, curriculum.identityKey));
}

/** The real codes of a training plan's CTĐT (the active CTĐT with the plan's identity), none without one. */
export async function readPlanRealCodes(db: Db, identityKey: string): Promise<Map<string, string>> {
  const rows = (await db.query<{ cohort_code: string; code: string; name: string; credits: string | number }>(
    `SELECT c.cohort_code,cc.code,cc.name,cc.credits FROM curricula c JOIN curriculum_courses cc ON cc.revision_id=c.current_revision
     WHERE c.is_active AND c.identity_key=$1 ORDER BY cc.position`, [identityKey])).rows;
  if (!rows.length) return new Map();
  return readRealCodes(db, { cohortCode: rows[0]!.cohort_code, identityKey, courses: rows });
}

/**
 * The real codes of a student's own CTĐT: the single active one of the cohort in the account and the major of the MSSV, as
 * the competency engine and Lộ trình học tập pick it; none without one.
 */
export async function readStudentRealCodes(db: Db, userId: string): Promise<Map<string, string>> {
  const profile = (await db.query<{ cohort_code: string | null; major_code: string | null }>(
    "SELECT cohort_code,major_code FROM student_profiles WHERE user_id=$1", [userId])).rows[0];
  const cohortCode = normalizeCohortCode(profile?.cohort_code);
  if (!cohortCode) return new Map();
  const curricula = (await db.query<{ identity_key: string; revision_id: string }>(
    `SELECT c.identity_key,c.current_revision AS revision_id FROM curricula c
     WHERE c.is_active AND c.cohort_code=$1 AND ${majorCondition("c", 2)} ORDER BY c.id`, [cohortCode, majorIdentity(profile?.major_code)])).rows;
  if (curricula.length !== 1) return new Map();
  const courses = (await db.query<{ code: string; name: string; credits: string | number }>(
    "SELECT code,name,credits FROM curriculum_courses WHERE revision_id=$1 ORDER BY position", [curricula[0]!.revision_id])).rows;
  return readRealCodes(db, { cohortCode, identityKey: curricula[0]!.identity_key ?? "", courses });
}

/** One CTĐT row read with its real code, and the shared course ("môn học") it counts under there (null: its own). */
export type RealCourseRow = { revision_id: string; code: string; real_code: string; course_id: string | null };

/**
 * The CTĐT rows with a real code in the current revisions (all of them, or those given), each with the shared course of its
 * real code (ad_comp_courses), whose configuration counts (user 2026-11-10: "K29 HTTT counts under 71MATL10053, its existing
 * skill config is used"): the one with the row's name (courseNameKey) and credits, else the only one with that code; none
 * (null) keeps the row's own course. No configuration is added or copied. For the SQL of realCourseJoin.
 */
export async function readRealCourseRows(db: Db, revisionIds?: readonly string[]): Promise<RealCourseRow[]> {
  const rows = (await db.query<{ revision_id: string; cohort_code: string; identity_key: string; code: string; name: string; credits: string | number }>(
    `SELECT c.current_revision AS revision_id,c.cohort_code,c.identity_key,cc.code,cc.name,cc.credits
     FROM curricula c JOIN curriculum_courses cc ON cc.revision_id=c.current_revision
     WHERE ($1::uuid[] IS NULL OR c.current_revision=ANY($1::uuid[])) ORDER BY c.id,cc.position`, [revisionIds ? [...revisionIds] : null])).rows;
  const standards = await activeStandards(db, rows.map((row) => row.cohort_code));
  const byRevision = new Map<string, typeof rows>();
  for (const row of rows) byRevision.set(row.revision_id, [...(byRevision.get(row.revision_id) ?? []), row]);
  const mapped: { revision_id: string; code: string; real_code: string; name: string; credits: number }[] = [];
  for (const [revisionId, list] of byRevision) {
    const codes = realCourseCodes(list.map((row) => ({ code: row.code, name: row.name, credits: Number(row.credits) })),
      ownStandards(standards, list[0]!.cohort_code, list[0]!.identity_key));
    for (const [file, real] of codes) {
      const row = list.find((item) => key(item.code) === file)!;
      mapped.push({ revision_id: revisionId, code: file, real_code: real, name: row.name, credits: Number(row.credits) });
    }
  }
  if (!mapped.length) return [];
  const courses = (await db.query<{ id: string; code: string; name: string; credits: number }>(
    "SELECT id,upper(btrim(code)) AS code,name,credits::float8 AS credits FROM ad_comp_courses WHERE upper(btrim(code))=ANY($1::text[]) ORDER BY id",
    [[...new Set(mapped.map((row) => row.real_code))]])).rows;
  return mapped.map((row) => {
    const same = courses.filter((course) => course.code === row.real_code);
    const exact = same.filter((course) => courseNameKey(course.name) === courseNameKey(row.name) && course.credits === row.credits);
    const course = exact.length === 1 ? exact[0] : same.length === 1 ? same[0] : undefined;
    return { revision_id: row.revision_id, code: row.code, real_code: row.real_code, course_id: course?.id ?? null };
  });
}

/** CTĐT code → real code of the rows of readRealCourseRows. */
export const realCodesOfRows = (rows: readonly RealCourseRow[]) => new Map(rows.map((row) => [row.code, row.real_code]));

/**
 * SQL: joins the real courses of parameter $n (JSON of readRealCourseRows) to the curriculum_courses rows aliased `cc`, as
 * `rc`; COALESCE(rc.course_id,cc.course_id) is the shared course a row counts under, COALESCE(rc.real_code,cc.code) its code.
 */
export const realCourseJoin = (param: number) =>
  `LEFT JOIN jsonb_to_recordset($${param}::jsonb) AS rc(revision_id uuid,code text,real_code text,course_id uuid)
   ON rc.revision_id=cc.revision_id AND rc.code=upper(btrim(cc.code))`;
