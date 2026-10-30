import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { normalizeCohortCode, profileSpecialty, resolveCohortStandard } from "../graduation/resolve.js";
import { identity as planIdentity, type PlanData } from "../plans/model.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import { courseKey, transcriptCourses } from "./course-state.js";
import { physicalEducationGroupsFor } from "./plan-progress.js";
import { SCOPE_MAX_LENGTH } from "./constants.js";
import { majorCondition, majorIdentity } from "../curricula/majors.js";
import type {
  AssessmentInputs, CareerInput, CurriculumCourseInput, CurriculumRelationInput,
  PlanResolution, PlanRevisionInput, WeightsInput,
} from "./types.js";

/** A request-level failure of the competency assessment API: `{ error: code }` with this HTTP status. */
export class AssessmentError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

type Db = Pick<PoolClient, "query">;
const num = (value: unknown) => value === null || value === undefined ? null : Number(value);

/**
 * Reads everything one assessment needs (spec §6) with plain SELECTs, every list in a
 * deterministic order. The caller runs it inside a REPEATABLE READ READ ONLY transaction
 * (see loadAssessmentInputs); no row locks are taken (they fail with SQLSTATE 25006 there).
 */
/**
 * careerOptional: no target career needed ("Định hướng nghề nghiệp" sets each catalog career itself); career is null then.
 * weightsOptional: no course–skill weights needed (Tổng quan reads only the course states and the plan progress); the
 * weights are then empty when the faculty has applied none.
 */
export async function readAssessmentInputs(db: Db, userId: string,
  options: { promptVersion?: string; careerOptional?: boolean; weightsOptional?: boolean } = {}): Promise<AssessmentInputs> {
  const student = await db.query<{ cohort_code: string | null; specialty: string | null; career_position_id: string | null; major_code: string | null }>(
    "SELECT cohort_code,specialty,career_position_id,major_code FROM student_profiles WHERE user_id=$1", [userId]);
  const transcript = await db.query<{ version: string; data: TranscriptData }>(
    "SELECT version,parsed_data AS data FROM student_transcripts WHERE user_id=$1", [userId]);
  if (!transcript.rows[0]) throw new AssessmentError("transcript_required", 409);
  const profile = student.rows[0];
  const cohortCode = normalizeCohortCode(profile?.cohort_code);
  if (!cohortCode) throw new AssessmentError("cohort_unknown", 409);
  const specialty = profileSpecialty(profile?.specialty);
  // All three of the page's checklist are required (user, 2026-10-21): transcript, target career and specialty.
  if (!profile?.career_position_id && !options.careerOptional) throw new AssessmentError("career_required", 409);
  if (!specialty) throw new AssessmentError("specialty_required", 409);

  /* Curriculum: the single active one of the cohort and the student's major (052), current revision. */
  const major = majorIdentity(profile?.major_code);
  const curricula = await db.query<{ id: string; identity_key: string; revision_id: string; version: number; name: string | null; admission_year: unknown }>(
    `SELECT c.id,c.identity_key,c.current_revision AS revision_id,r.version,r.data->>'name' AS name,r.data->'admissionYear' AS admission_year
     FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision
     WHERE c.is_active AND c.cohort_code=$1 AND ${majorCondition("c", 2)} ORDER BY c.id`, [cohortCode, major]);
  if (!curricula.rowCount) throw new AssessmentError("curriculum_unavailable", 409);
  if (curricula.rows.length > 1) throw new AssessmentError("curriculum_ambiguous", 409);
  const curriculumRow = curricula.rows[0]!;
  const courses = await db.query<{ code: string; name: string; credits: string | number; type: string; block: string; specialty: string; semester: number | null; study_year: number | null }>(
    `SELECT code,name,credits,course_type AS type,block,specialty,semester,study_year FROM curriculum_courses
     WHERE revision_id=$1 ORDER BY position,code`, [curriculumRow.revision_id]);
  const relations = await db.query<{ course_code: string; kind: "prerequisite" | "prior"; raw: string; target_codes: string[]; unresolved_codes: string[]; review_required: boolean }>(
    `SELECT course_code,kind,raw,target_codes,unresolved_codes,review_required FROM curriculum_relations
     WHERE revision_id=$1 ORDER BY course_code,kind`, [curriculumRow.revision_id]);
  const curriculumCourses: CurriculumCourseInput[] = courses.rows.map((row) => ({
    code: row.code, name: row.name, credits: Number(row.credits), type: row.type, block: row.block,
    specialty: row.specialty, semester: row.semester, studyYear: row.study_year,
  }));
  const curriculumRelations: CurriculumRelationInput[] = relations.rows.map((row) => ({
    courseCode: row.course_code, kind: row.kind, raw: row.raw, targetCodes: row.target_codes,
    unresolvedCodes: row.unresolved_codes, reviewRequired: row.review_required,
  }));
  const admissionYear = num(curriculumRow.admission_year);

  /*
   * Weights (§2.3): the applied configurations of the shared courses ("môn học", migration 038) of
   * the current revision, matched to its rows by course; a course has one configuration for every cohort.
   */
  const weightState = await db.query<{ active_count: number; max_updated: Date | string | null }>(
    `SELECT count(*)::int AS active_count,max(cfg.updated_at) AS max_updated
     FROM curriculum_courses cc JOIN ad_comp_course_configs cfg ON cfg.course_id=cc.course_id AND cfg.status='active'
     WHERE cc.revision_id=$1`, [curriculumRow.revision_id]);
  const weightRow = weightState.rows[0];
  if (!weightRow?.active_count && !options.weightsOptional) throw new AssessmentError("competency_weights_unavailable", 409);
  const links = await db.query<{ course_code: string; skill_id: string; weight: string | number }>(
    `SELECT cc.code AS course_code,l.skill_id,l.weight FROM curriculum_courses cc
     JOIN ad_comp_course_configs cfg ON cfg.course_id=cc.course_id AND cfg.status='active'
     JOIN ad_comp_course_links l ON l.config_id=cfg.id
     WHERE cc.revision_id=$1 AND l.weight>0 ORDER BY cc.code,l.skill_id`, [curriculumRow.revision_id]);
  // A skill's other groups (migration 040) count only while they are active.
  const skills = await db.query<{ skill_id: string; name: string; description: string; scope: string; group_id: string; other_group_ids?: string[] }>(
    `SELECT s.skill_id,k.name,k.description,left(s.scope,$1) AS scope,s.group_id,
       ARRAY(SELECT m.group_id FROM ad_comp_skill_groups m JOIN ad_comp_groups o ON o.id=m.group_id AND o.is_active
         WHERE m.skill_id=s.skill_id AND m.group_id<>s.group_id ORDER BY o.name,o.id) AS other_group_ids
     FROM ad_comp_skills s JOIN career_skills k ON k.id=s.skill_id JOIN ad_comp_groups g ON g.id=s.group_id
     WHERE s.is_active AND s.deleted_at IS NULL AND k.deleted_at IS NULL AND g.is_active ORDER BY k.name,s.skill_id`, [SCOPE_MAX_LENGTH]);
  const groups = await db.query<{ id: string; name: string }>("SELECT id,name FROM ad_comp_groups WHERE is_active ORDER BY name,id");
  const weights: WeightsInput = {
    revisionId: curriculumRow.revision_id, version: curriculumRow.version, activeCount: weightRow?.active_count ?? 0,
    maxConfigUpdatedAt: weightRow?.max_updated ? new Date(weightRow.max_updated).toISOString() : null,
    links: links.rows.map((row) => ({ courseCode: row.course_code, skillId: row.skill_id, weight: Number(row.weight) })),
    skills: skills.rows.map((row) => ({ skillId: row.skill_id, name: row.name, description: row.description, scope: row.scope, groupId: row.group_id,
      otherGroupIds: row.other_group_ids ?? [] })),
    groups: groups.rows.map((row) => ({ id: row.id, name: row.name })),
  };

  /* Graduation standard: active, same cohort, current revision; resolved by specialty (shared resolver, D3). */
  const resolved = await resolveCohortStandard(db, cohortCode, specialty, profile?.major_code ?? null);

  /* Training plan: active, same cohort; several -> the one linked to this curriculum. */
  const plans = await db.query<{ id: string; revision_id: string; version: number; data: PlanData; linked: boolean }>(
    `SELECT p.id,p.current_revision AS revision_id,r.version,r.data,
       COALESCE(r.curriculum_revision_id IN (SELECT id FROM curriculum_revisions WHERE curriculum_id=$2),false) AS linked
     FROM training_plans p JOIN training_plan_revisions r ON r.id=p.current_revision
     WHERE p.is_active AND p.cohort_code=$1 AND ${majorCondition("p", 3)} ORDER BY p.id`, [cohortCode, curriculumRow.id, major]);
  let planRows = plans.rows;
  if (planRows.length > 1) {
    const linked = planRows.filter((row) => row.linked);
    planRows = linked.length ? linked : planRows.filter((row) => planIdentity(row.data) === curriculumRow.identity_key);
  }
  const planResolution: PlanResolution = !plans.rowCount ? "not_found" : planRows.length === 1 ? "found" : "ambiguous";
  const planRow = planResolution === "found" ? planRows[0]! : null;
  const planRevision: PlanRevisionInput | null = planRow ? {
    id: planRow.id, revisionId: planRow.revision_id, version: planRow.version, data: planRow.data,
    physicalEducationGroups: physicalEducationGroupsFor(curriculumCourses),
  } : null;

  /* Target career (kept even when soft-deleted, so the result can warn). */
  let career: CareerInput | null = null;
  if (profile?.career_position_id) {
    const position = await db.query<{ id: string; code: string; name_vi: string; name_en: string; version: string; deleted: boolean }>(
      "SELECT id,code,name_vi,name_en,version,deleted_at IS NOT NULL AS deleted FROM career_positions WHERE id=$1", [profile.career_position_id]);
    const row = position.rows[0];
    if (row) {
      const requirements = await db.query<{ id: string; skill_id: string | null; skill_name: string | null; title: string; is_required: boolean }>(
        `SELECT r.id,r.skill_id,CASE WHEN k.deleted_at IS NULL THEN k.name END AS skill_name,r.title,r.is_required
         FROM career_requirements r LEFT JOIN career_skills k ON k.id=r.skill_id
         WHERE r.career_position_id=$1 AND r.deleted_at IS NULL ORDER BY r.is_required DESC,r.title,r.id`, [row.id]);
      career = {
        id: row.id, code: row.code, nameVi: row.name_vi, nameEn: row.name_en, version: row.version, deleted: row.deleted,
        requirements: requirements.rows.map((item) => ({
          id: item.id, skillId: item.skill_id, skillName: item.skill_name, title: item.title, isRequired: item.is_required,
        })),
      };
    }
  }
  if (!career && !options.careerOptional) throw new AssessmentError("career_required", 409);

  /* Catalog names for transcript codes outside the curriculum (names never come from the transcript). */
  const curriculumCodes = new Set(curriculumCourses.map((course) => courseKey(course.code)));
  const outside = [...transcriptCourses(transcript.rows[0].data).keys()].filter((code) => !curriculumCodes.has(code)).sort();
  const catalogNames: Record<string, string> = {};
  if (outside.length) {
    const catalog = await db.query<{ code: string; name: string }>(
      "SELECT code,name FROM course_catalog WHERE upper(btrim(code))=ANY($1::text[]) ORDER BY code", [outside]);
    for (const row of catalog.rows) catalogNames[courseKey(row.code)] = row.name;
  }

  return {
    student: { cohortCode, specialty, careerPositionId: profile?.career_position_id ?? null },
    transcript: { version: transcript.rows[0].version, data: transcript.rows[0].data },
    curriculum: {
      id: curriculumRow.id, revisionId: curriculumRow.revision_id, version: curriculumRow.version,
      name: curriculumRow.name ?? "", admissionYear: admissionYear !== null && Number.isFinite(admissionYear) ? admissionYear : null,
      courses: curriculumCourses, relations: curriculumRelations,
    },
    weights,
    graduation: { resolution: resolved.resolution, standard: resolved.standard },
    plan: { resolution: planResolution, revision: planRevision },
    career,
    catalogNames,
    ...(options.promptVersion ? { promptVersion: options.promptVersion } : {}),
  };
}

/** Runs readAssessmentInputs in its own REPEATABLE READ READ ONLY snapshot (transaction 1 of POST). */
export async function loadAssessmentInputs(pool: DatabasePool, userId: string, options: { promptVersion?: string } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const inputs = await readAssessmentInputs(client, userId, options);
    await client.query("COMMIT");
    return inputs;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
