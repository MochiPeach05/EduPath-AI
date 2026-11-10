import type { PoolClient } from "pg";
import { normalizeCohortCode } from "../graduation/resolve.js";
import { curriculumPlanId, curriculumPlanName } from "../plans/from-curriculum.js";
import { identity as planIdentity } from "../plans/model.js";
import { majorCondition, majorIdentity } from "./majors.js";

// The student's own CTĐT and KHĐT (user 2026-11-10: "Không cho sinh viên chọn Khung chương trình đào tạo và CTĐT như vậy
// nó sẽ cố định theo thông tin của sinh viên luôn như trang xét tốt nghiệp vậy"). The student pages Chương trình đào tạo
// and Kế hoạch đào tạo show only these, picked the way the competency engine (competency-assessment/inputs.ts), Lộ trình
// học tập (study-plan/context.ts) and Xét tốt nghiệp (graduation/student-graduation.ts) pick them: the cohort in the
// account and the major of the MSSV (majorCondition; a profile without a major takes the cohort's), the single active
// CTĐT at its current revision; among several active KHĐT the one linked to that CTĐT, else the one of its identity. A
// cohort and major without a KHĐT study by their CTĐT (plans/from-curriculum.ts).

type Db = Pick<PoolClient, "query">;

/** The cohort (normalized as the engine reads it) and the major code of the MSSV in a student's profile. */
export type OwnProgramProfile = { cohortCode: string | null; majorCode: string | null };

/**
 * found: the student's own; not_found: none for the cohort and major; ambiguous: several (a profile without a major in a
 * cohort of several majors); cohort_unknown: a profile without a cohort.
 */
export type OwnProgramResolution = "found" | "not_found" | "ambiguous" | "cohort_unknown";

/** The student's own CTĐT as the student list shows it, with its identity (major:cohort) kept on the server. */
export type OwnCurriculum = {
  id: string; identityKey: string; cohortCode: string; name: string | null; major: string | null;
  totalCredits: number | null; courseCount: number; version: number;
};

/** The student's own KHĐT as the student list shows it; a plan read from the CTĐT has the id "ctdt-<CTĐT id>". */
export type OwnPlan =
  | { id: string; cohortCode: string; name: string | null; major: string | null; totalCredits: string | null; itemCount: number; version: number }
  | { id: string; cohortCode: string; name: string; major: string | null; fromCurriculum: true };

export async function readOwnProgramProfile(db: Db, userId: string): Promise<OwnProgramProfile> {
  const row = (await db.query<{ cohort_code: string | null; major_code: string | null }>(
    "SELECT cohort_code,major_code FROM student_profiles WHERE user_id=$1", [userId])).rows[0];
  return { cohortCode: normalizeCohortCode(row?.cohort_code), majorCode: row?.major_code?.trim() || null };
}

export async function resolveOwnCurriculum(db: Db, profile: OwnProgramProfile): Promise<{
  resolution: OwnProgramResolution; curriculum: OwnCurriculum | null;
}> {
  if (!profile.cohortCode) return { resolution: "cohort_unknown", curriculum: null };
  const rows = (await db.query<OwnCurriculum>(
    `SELECT c.id,c.identity_key AS "identityKey",c.cohort_code AS "cohortCode",r.data->>'name' AS name,r.data->>'major' AS major,
       (r.data->>'totalCredits')::int AS "totalCredits",jsonb_array_length(r.data->'courses') AS "courseCount",r.version
     FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision
     WHERE c.is_active AND c.cohort_code=$1 AND ${majorCondition("c", 2)} ORDER BY c.id`,
    [profile.cohortCode, majorIdentity(profile.majorCode)])).rows;
  return rows.length === 1 ? { resolution: "found", curriculum: rows[0]! } : { resolution: rows.length ? "ambiguous" : "not_found", curriculum: null };
}

type PlanRow = {
  id: string; cohortCode: string; name: string | null; major: string | null; totalCredits: string | null; itemCount: number; version: number;
  dataCohort: string | null; linked: boolean;
};

/** The student's own KHĐT, else the plan read from the student's own CTĐT (resolveOwnCurriculum's result). */
export async function resolveOwnPlan(db: Db, profile: OwnProgramProfile, own: Awaited<ReturnType<typeof resolveOwnCurriculum>>): Promise<{
  resolution: OwnProgramResolution; plan: OwnPlan | null;
}> {
  if (!profile.cohortCode) return { resolution: "cohort_unknown", plan: null };
  const curriculum = own.curriculum;
  const rows = (await db.query<PlanRow>(
    `SELECT p.id,p.cohort_code AS "cohortCode",r.data->>'name' AS name,r.data->>'major' AS major,
       (r.data->>'totalCredits')::numeric AS "totalCredits",jsonb_array_length(r.data->'items') AS "itemCount",r.version,
       r.data->>'cohortCode' AS "dataCohort",
       COALESCE(r.curriculum_revision_id IN (SELECT id FROM curriculum_revisions WHERE curriculum_id=$3),false) AS linked
     FROM training_plans p JOIN training_plan_revisions r ON r.id=p.current_revision
     WHERE p.is_active AND p.cohort_code=$1 AND ${majorCondition("p", 2)} ORDER BY p.id`,
    [profile.cohortCode, majorIdentity(profile.majorCode), curriculum?.id ?? null])).rows;
  // Several (a profile without a major): the one linked to the student's CTĐT, else of its identity, as the engine does.
  let candidates = rows;
  if (rows.length > 1 && curriculum) {
    const linked = rows.filter((row) => row.linked);
    candidates = linked.length ? linked
      : rows.filter((row) => planIdentity({ major: row.major ?? "", cohortCode: row.dataCohort ?? "" }) === curriculum.identityKey);
  }
  if (candidates.length === 1) {
    const { id, cohortCode, name, major, totalCredits, itemCount, version } = candidates[0]!;
    return { resolution: "found", plan: { id, cohortCode, name, major, totalCredits, itemCount, version } };
  }
  if (rows.length) return { resolution: "ambiguous", plan: null };
  if (!curriculum) return { resolution: own.resolution === "ambiguous" ? "ambiguous" : "not_found", plan: null };
  return {
    resolution: "found",
    plan: { id: curriculumPlanId(curriculum.id), cohortCode: curriculum.cohortCode, name: curriculumPlanName(curriculum.major ?? "", curriculum.cohortCode),
      major: curriculum.major, fromCurriculum: true },
  };
}
