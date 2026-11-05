import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import type { AssessmentMeta, AssessmentResult, GapStatus } from "./types.js";

/** Most recent assessments kept per student (spec §8); older ones are removed on insert. */
const MAX_ASSESSMENTS_PER_USER = 20;
/** One new assessment per student per 60 seconds. */
const ASSESSMENT_COOLDOWN_SECONDS = 60;
/**
 * Advisory lock key for the competency AI queue. Never reuse 1946032027 (shared by the OCR queue
 * and the AD-COMP catalog lock) or 1946032026 (migrations).
 */
export const COMPETENCY_AI_QUEUE_LOCK = 1_946_032_031;

export type AiStatus = "disabled" | "deferred" | "queued" | "processing" | "completed" | "failed" | "cancelled";
/** ai_status values a student may ask to regenerate from (POST /:id/ai). */
export const REGENERABLE_AI_STATUSES: readonly AiStatus[] = ["failed", "cancelled", "deferred", "disabled"];

/** Response shape of every student endpoint that returns an assessment (contract C4). */
type StoredAssessment = {
  id: string;
  createdAt: string;
  meta: AssessmentMeta;
  result: AssessmentResult;
  ai: { status: AiStatus; errorCode: string | null; model: string | null; completedAt: string | null; output: unknown | null };
};

type Queryable = Pick<DatabasePool, "query"> | PoolClient;

type AssessmentRow = {
  id: string; created_at: Date | string; meta: AssessmentMeta; computed: AssessmentResult;
  ai_status: AiStatus; ai_error_code: string | null; ai_model: string | null;
  ai_completed_at: Date | string | null; ai_output: unknown | null;
};
const assessmentColumns = "id,created_at,meta,computed,ai_status,ai_error_code,ai_model,ai_completed_at,ai_output";
const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();

function toStoredAssessment(row: AssessmentRow): StoredAssessment {
  return {
    id: row.id,
    createdAt: iso(row.created_at)!,
    meta: row.meta,
    result: row.computed,
    ai: {
      status: row.ai_status,
      errorCode: row.ai_error_code,
      model: row.ai_model,
      completedAt: iso(row.ai_completed_at),
      output: row.ai_status === "completed" ? row.ai_output ?? null : null,
    },
  };
}

/** Removes every stu_comp_* row of the student (jobs first, then results). Caller holds the user's row lock. */
export async function deleteCompetencyData(client: Queryable, userId: string) {
  await client.query("DELETE FROM stu_comp_ai_jobs WHERE user_id=$1", [userId]);
  await client.query("DELETE FROM stu_comp_assessments WHERE user_id=$1", [userId]);
}

/** True when the student created an assessment within the cooldown window. */
export async function withinCooldown(db: Queryable, userId: string) {
  const result = await db.query<{ recent: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM stu_comp_assessments WHERE user_id=$1
      AND created_at>now()-make_interval(secs=>$2)) AS recent`, [userId, ASSESSMENT_COOLDOWN_SECONDS]);
  return Boolean(result.rows[0]?.recent);
}

/** Inserts a computed assessment with ai_status 'disabled'; the AI queue may change it in the same transaction. */
export async function insertAssessment(client: PoolClient, input: { userId: string; transcriptVersion: string; result: AssessmentResult }) {
  const id = randomUUID();
  await client.query(`INSERT INTO stu_comp_assessments(id,user_id,transcript_version,meta,computed,ai_status)
    VALUES($1,$2,$3,$4::jsonb,$5::jsonb,'disabled')`,
  [id, input.userId, input.transcriptVersion, JSON.stringify(input.result.meta), JSON.stringify(input.result)]);
  return id;
}

/** Keeps the newest MAX_ASSESSMENTS_PER_USER results of the student (their AI jobs go with them). */
export async function pruneAssessments(client: PoolClient, userId: string) {
  await client.query(`DELETE FROM stu_comp_assessments WHERE user_id=$1 AND id NOT IN (
    SELECT id FROM stu_comp_assessments WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2)`, [userId, MAX_ASSESSMENTS_PER_USER]);
}

export async function findAssessment(db: Queryable, userId: string, id: string) {
  const result = await db.query<AssessmentRow>(`SELECT ${assessmentColumns} FROM stu_comp_assessments WHERE id=$1 AND user_id=$2`, [id, userId]);
  return result.rows[0] ? toStoredAssessment(result.rows[0]) : null;
}

export async function latestAssessment(db: Queryable, userId: string) {
  const result = await db.query<AssessmentRow>(`SELECT ${assessmentColumns} FROM stu_comp_assessments
    WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [userId]);
  return result.rows[0] ? toStoredAssessment(result.rows[0]) : null;
}

/**
 * What the page reads of a result to show a comment written for it (web mapAiOutput, careerSkillKeys): the names its
 * keys stand for, its career's requirement statuses and its course names. Keys (S01, G1…) are per assessment.
 */
export type AiCommentContext = {
  skillDirectory: { key: string; name: string }[];
  groups: { key: string; name: string }[];
  career: { requirements: { skillKey: string | null; status: GapStatus }[] } | null;
  courses: { code: string; name: string }[];
  courseSuggestions: { code: string; name: string }[];
};

/** The comment of an older assessment, shown dimmed while the newest assessment's comment is not ready (GET /latest). */
export type PreviousAiComment = {
  assessmentId: string;
  assessmentCreatedAt: string;
  model: string | null;
  completedAt: string | null;
  promptVersion: string | null;
  output: unknown;
  context: AiCommentContext;
};

type Requirements = NonNullable<AssessmentResult["career"]>["requirements"];
type ContextSource = Partial<Pick<AssessmentResult, "skillDirectory" | "groups" | "courses" | "courseSuggestions">> & { career?: { requirements?: Requirements } | null };

const keyed = (rows: readonly { key: string; name: string }[] | undefined) => (rows ?? []).map(({ key, name }) => ({ key, name }));
const coded = (rows: readonly { code: string; name: string }[] | undefined) => (rows ?? []).map(({ code, name }) => ({ code, name }));

/** The context of a stored result, trimmed to the fields the page needs (a list a stored result lacks is empty). */
export function aiCommentContext(result: ContextSource): AiCommentContext {
  return {
    skillDirectory: keyed(result.skillDirectory),
    groups: keyed(result.groups),
    career: result.career ? { requirements: (result.career.requirements ?? []).map(({ skillKey, status }) => ({ skillKey, status })) } : null,
    courses: coded(result.courses),
    courseSuggestions: coded(result.courseSuggestions),
  };
}

type PreviousRow = {
  id: string; created_at: Date | string; ai_model: string | null; ai_completed_at: Date | string | null; ai_output: unknown;
  prompt_version: string | null; skill_directory: AssessmentResult["skillDirectory"] | null; groups: AssessmentResult["groups"] | null;
  requirements: Requirements | null; has_career: boolean | null;
  courses: AssessmentResult["courses"] | null; course_suggestions: AssessmentResult["courseSuggestions"] | null;
};

/**
 * The newest completed comment of an assessment older than `latestId`, with the context its keys need: GET /latest sends
 * it while the newest assessment's comment is queued, being written, failed or cancelled, and the page shows it dimmed
 * (like the advice of Xét tốt nghiệp) instead of an empty panel. Only the parts of the result the page reads are selected.
 */
export async function previousAiComment(db: Queryable, userId: string, latestId: string): Promise<PreviousAiComment | null> {
  const result = await db.query<PreviousRow>(
    `SELECT id,created_at,ai_model,ai_completed_at,ai_output,COALESCE(prompt_version,computed->'meta'->>'promptVersion') AS prompt_version,
       computed->'skillDirectory' AS skill_directory,computed->'groups' AS groups,computed->'career'->'requirements' AS requirements,
       jsonb_typeof(computed->'career')='object' AS has_career,computed->'courses' AS courses,computed->'courseSuggestions' AS course_suggestions
     FROM stu_comp_assessments
     WHERE user_id=$1 AND ai_status='completed' AND ai_output IS NOT NULL
       AND (created_at,id)<(SELECT l.created_at,l.id FROM stu_comp_assessments l WHERE l.id=$2 AND l.user_id=$1)
     ORDER BY created_at DESC,id DESC LIMIT 1`, [userId, latestId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    assessmentId: row.id,
    assessmentCreatedAt: iso(row.created_at)!,
    model: row.ai_model,
    completedAt: iso(row.ai_completed_at),
    promptVersion: row.prompt_version,
    output: row.ai_output,
    context: aiCommentContext({
      skillDirectory: row.skill_directory ?? [], groups: row.groups ?? [], courses: row.courses ?? [], courseSuggestions: row.course_suggestions ?? [],
      career: row.has_career ? { requirements: row.requirements ?? [] } : null,
    }),
  };
}

export async function latestAssessmentStatus(db: Queryable, userId: string) {
  const result = await db.query<{ id: string; ai_status: AiStatus; ai_error_code: string | null }>(
    `SELECT id,ai_status,ai_error_code FROM stu_comp_assessments WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [userId]);
  const row = result.rows[0];
  return { id: row?.id ?? null, aiStatus: row?.ai_status ?? null, aiErrorCode: row?.ai_error_code ?? null };
}
