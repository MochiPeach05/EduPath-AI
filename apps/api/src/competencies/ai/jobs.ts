// AI proposal jobs for the shared courses ("môn học", migration 038). A row of ad_comp_ai_suggestions is queued
// inside the admin transaction and handed to the same AI worker as the other kinds
// (/api/worker/competency-assessments, kind "competency_course_suggestion"); the worker router
// calls the claim/extend/complete functions below. Rows are never deleted: they are the audit
// record of what the AI proposed and what the admin saved.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../../db/pool.js";
import type { CurriculumCourse } from "../../curricula/model.js";
import {
  AI_HOUSEKEEPING_INTERVAL_MS,
  AI_JOB_LEASE_MINUTES,
  AI_JOB_MAX_ATTEMPTS,
  type WorkerCompletion
} from "../../competency-assessment/ai/worker-protocol.js";
import { CompetencyError } from "../model.js";
import { buildCourseAiInput, type CourseAiInput, type CourseAiMode, type CourseAiSource } from "./prompt.js";
import { courseAiContextFromInput, validateCourseAiOutput, type StoredCourseAiResult } from "./validate.js";

/** At most this many queued/processing course proposals system-wide (every shared course fits). */
const MAX_PENDING_COURSE_SUGGESTIONS = 300;
/** Serializes the pending check and the queue-size check of concurrent requests. */
const COURSE_SUGGESTION_QUEUE_LOCK = "edupath:competency-course-ai";

type Db = Pick<DatabasePool, "query">;
const PENDING = "('queued','processing')";

/**
 * Fails stuck proposals: queued for more than 24 hours, or processing with an expired lease after
 * the last attempt (or older than 24 hours). ai_input is cleared with the failure.
 */
export async function expireCourseSuggestions(db: Db): Promise<void> {
  await db.query(`UPDATE ad_comp_ai_suggestions SET status='failed',error_code=$2,ai_input=NULL,lease_token=NULL,lease_until=NULL,
      completed_at=now(),updated_at=now()
    WHERE (status='queued' AND created_at<now()-interval '24 hours')
      OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))`,
  [AI_JOB_MAX_ATTEMPTS, "worker_timeout"]);
}

/** Rate-limited expiry (at most once per interval per returned function), run from the worker and admin routers. */
export function createCourseSuggestionExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Db): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireCourseSuggestions(db);
    return true;
  };
}

type SharedSource = Pick<CourseAiSource, "groups" | "profiles" | "careerSkills">;
/** The curriculum row a course's AI input is read from, and its CTĐT. */
type SourceRow = { courseId: string; revisionId: string; sourceCode: string; code: string; name: string; course: CurriculumCourse; cohortCode: string; curriculumName: string; version: number };

/** The catalog shared by every course of one request. */
async function loadSharedSource(client: Db): Promise<SharedSource> {
  const groups = await client.query<{ id: string; name: string }>(
    "SELECT id,name FROM ad_comp_groups WHERE deleted_at IS NULL AND is_active ORDER BY name,id");
  const profiles = await client.query<{ id: string; name: string; description: string; groupId: string }>(
    `SELECT s.id,s.name,COALESCE(NULLIF(cs.scope,''),s.description) AS description,cs.group_id AS "groupId"
      FROM ad_comp_skills cs JOIN career_skills s ON s.id=cs.skill_id JOIN ad_comp_groups g ON g.id=cs.group_id
      WHERE cs.deleted_at IS NULL AND cs.is_active AND s.deleted_at IS NULL AND g.deleted_at IS NULL AND g.is_active
      ORDER BY s.name,s.id`);
  const careerSkills = await client.query<{ id: string; name: string; description: string }>(
    `SELECT s.id,s.name,s.description FROM career_skills s
      WHERE s.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM career_requirements r JOIN career_positions p ON p.id=r.career_position_id
          WHERE r.skill_id=s.id AND r.deleted_at IS NULL AND p.deleted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM ad_comp_skills cs WHERE cs.skill_id=s.id AND cs.deleted_at IS NULL)
      ORDER BY s.name,s.id`);
  return { groups: groups.rows, profiles: profiles.rows, careerSkills: careerSkills.rows };
}

/**
 * The course data sent to the model: the row of the newest cohort whose newest CTĐT revision has the
 * course (a course of older revisions only is not offered, migration 039). By code and name.
 */
async function loadSourceRows(client: Db, courseIds: string[]): Promise<SourceRow[]> {
  const result = await client.query<SourceRow>(`SELECT * FROM (SELECT DISTINCT ON (cc.course_id) cc.course_id AS "courseId",
      cc.revision_id AS "revisionId",cc.code AS "sourceCode",c.code,c.name,cc.data AS course,cu.cohort_code AS "cohortCode",COALESCE(r.data->>'name','') AS "curriculumName",r.version
      FROM curriculum_courses cc JOIN ad_comp_courses c ON c.id=cc.course_id
      JOIN curriculum_revisions r ON r.id=cc.revision_id JOIN curricula cu ON cu.id=r.curriculum_id AND cu.current_revision=r.id
      WHERE cc.course_id=ANY($1::uuid[])
      ORDER BY cc.course_id,NULLIF(regexp_replace(cu.cohort_code,'\\D','','g'),'')::int DESC NULLS LAST,cu.cohort_code DESC,cu.id) x
      ORDER BY code,name,"courseId"`, [courseIds]);
  return result.rows;
}

/** Current links of the courses (any status), by course id. */
async function loadCourseLinks(client: Db, courseIds: string[]) {
  const result = await client.query<{ courseId: string; skillId: string; name: string; groupId: string; description: string; weight: number }>(
    `SELECT c.course_id AS "courseId",l.skill_id AS "skillId",s.name,cs.group_id AS "groupId",
      COALESCE(NULLIF(cs.scope,''),s.description) AS description,l.weight::float8 AS weight
      FROM ad_comp_course_configs c JOIN ad_comp_course_links l ON l.config_id=c.id
      JOIN ad_comp_skills cs ON cs.skill_id=l.skill_id JOIN career_skills s ON s.id=l.skill_id
      WHERE c.course_id=ANY($1::uuid[]) ORDER BY c.course_id,s.name,s.id`, [courseIds]);
  const byCourse = new Map<string, CourseAiSource["links"]>();
  for (const row of result.rows) {
    const bucket = byCourse.get(row.courseId) ?? [];
    bucket.push({ skillId: row.skillId, name: row.name, groupId: row.groupId, description: row.description, weight: row.weight });
    byCourse.set(row.courseId, bucket);
  }
  return byCourse;
}

const hour = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** One course: the shared catalog, its curriculum row and its links. */
function courseSource(shared: SharedSource, row: SourceRow, links: CourseAiSource["links"]): CourseAiSource {
  const course = row.course;
  return {
    curriculum: { cohortCode: row.cohortCode, name: row.curriculumName, version: row.version },
    groups: shared.groups,
    profiles: shared.profiles,
    careerSkills: shared.careerSkills,
    links,
    course: {
      code: row.code,
      name: row.name,
      englishName: course.englishName ?? "",
      description: course.description ?? "",
      credits: Number(course.credits) || 0,
      type: course.type ?? "",
      block: course.block ?? "",
      specialty: course.specialty ?? "",
      studyYear: course.studyYear ?? null,
      semester: course.semester ?? null,
      hours: { lecture: hour(course.hours?.lecture), practice: hour(course.hours?.practice), project: hour(course.hours?.project), internship: hour(course.hours?.internship) }
    }
  };
}

/** Why a course cannot be sent to the model in this mode (409), checked before anything is queued. */
function assertRunnable(input: CourseAiInput) {
  if (!input.groups.length) throw new CompetencyError("no_active_groups", 409);
  if (input.mode === "weights" && !input.linked.length) throw new CompetencyError("course_has_no_links", 409);
  if (input.mode === "full" && input.linked.length) throw new CompetencyError("course_already_linked", 409);
  if (!input.skills.length) throw new CompetencyError(input.mode === "weights" ? "course_has_no_links" : "no_candidate_skills", 409);
}

async function pendingCount(client: PoolClient) {
  const count = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ad_comp_ai_suggestions WHERE status IN ${PENDING}`);
  return count.rows[0]?.count ?? 0;
}

/** revision_id and course_code name the curriculum row the course data was read from. */
async function insertJob(client: PoolClient, data: { source: SourceRow; mode: CourseAiMode; requestedBy: string; batchId: string | null; input: CourseAiInput }) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO ad_comp_ai_suggestions(id,course_id,revision_id,course_code,mode,batch_id,requested_by,status,ai_input,prompt_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8::jsonb,$9)`,
    [id, data.source.courseId, data.source.revisionId, data.source.sourceCode, data.mode, data.batchId, data.requestedBy,
      JSON.stringify(data.input), data.input.promptVersion]);
  return id;
}

/**
 * Queues a proposal for one course, or returns the one already pending in that mode (created=false).
 * Called inside the admin write transaction; ai_queue_full (429) when the global cap is reached.
 */
export async function enqueueCourseSuggestion(
  client: PoolClient,
  input: { courseId: string; mode: "links" | "weights"; requestedBy: string }
): Promise<{ id: string; created: boolean }> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [COURSE_SUGGESTION_QUEUE_LOCK]);
  const pending = await client.query<{ id: string }>(
    `SELECT id FROM ad_comp_ai_suggestions WHERE course_id=$1 AND mode=$2 AND status IN ${PENDING}`, [input.courseId, input.mode]);
  if (pending.rows[0]) return { id: pending.rows[0].id, created: false };
  const [source] = await loadSourceRows(client, [input.courseId]);
  if (!source) throw new CompetencyError("course_not_found", 404);
  const links = (await loadCourseLinks(client, [input.courseId])).get(input.courseId) ?? [];
  const aiInput = buildCourseAiInput(courseSource(await loadSharedSource(client), source, links), input.mode);
  assertRunnable(aiInput);
  if (await pendingCount(client) >= MAX_PENDING_COURSE_SUGGESTIONS) throw new CompetencyError("ai_queue_full", 429);
  const id = await insertJob(client, { source, mode: input.mode, requestedBy: input.requestedBy, batchId: null, input: aiInput });
  return { id, created: true };
}

type BatchQueued = {
  batchId: string | null;
  queued: number;
  /** Courses left out: already linked, already queued in another run. */
  skipped: { linked: number; pending: number };
};

/**
 * The run over the courses of the filter ("Chạy AI cho N môn chưa có liên kết"): one "full" proposal
 * for every course that has no link yet and no pending run. Nothing is queued (batchId null) when no
 * course qualifies.
 */
export async function enqueueCourseBatch(client: PoolClient, input: { courseIds: string[]; requestedBy: string }): Promise<BatchQueued> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [COURSE_SUGGESTION_QUEUE_LOCK]);
  const sources = await loadSourceRows(client, input.courseIds);
  const links = await loadCourseLinks(client, input.courseIds);
  const pending = await client.query<{ courseId: string }>(
    `SELECT course_id AS "courseId" FROM ad_comp_ai_suggestions WHERE course_id=ANY($1::uuid[]) AND mode='full' AND status IN ${PENDING}`, [input.courseIds]);
  const pendingIds = new Set(pending.rows.map((row) => row.courseId));
  const shared = await loadSharedSource(client);
  const skipped = { linked: 0, pending: 0 };
  const inputs: { source: SourceRow; input: CourseAiInput }[] = [];
  for (const source of sources) {
    if ((links.get(source.courseId) ?? []).length) { skipped.linked += 1; continue; }
    if (pendingIds.has(source.courseId)) { skipped.pending += 1; continue; }
    const aiInput = buildCourseAiInput(courseSource(shared, source, []), "full");
    assertRunnable(aiInput);
    inputs.push({ source, input: aiInput });
  }
  if (!inputs.length) return { batchId: null, queued: 0, skipped };
  if (await pendingCount(client) + inputs.length > MAX_PENDING_COURSE_SUGGESTIONS) throw new CompetencyError("ai_queue_full", 429);
  const batchId = randomUUID();
  for (const item of inputs) {
    await insertJob(client, { source: item.source, mode: "full", requestedBy: input.requestedBy, batchId, input: item.input });
  }
  return { batchId, queued: inputs.length, skipped };
}

/** Claims the oldest runnable proposal (SKIP LOCKED, 15 minute lease, at most 2 attempts). */
export async function claimCourseSuggestion(db: Db, leaseToken: string): Promise<{ id: string; leaseToken: string; aiInput: Record<string, unknown> } | null> {
  const result = await db.query<{ id: string; leaseToken: string; aiInput: Record<string, unknown> }>(`WITH candidate AS (
      SELECT id FROM ad_comp_ai_suggestions
      WHERE ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
      ORDER BY created_at, course_code, id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE ad_comp_ai_suggestions j SET status='processing',lease_token=$1,lease_until=now()+make_interval(mins => $3),attempts=j.attempts+1,updated_at=now()
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.lease_token AS "leaseToken",j.ai_input AS "aiInput"`,
  [leaseToken, AI_JOB_MAX_ATTEMPTS, AI_JOB_LEASE_MINUTES]);
  return result.rows[0] ?? null;
}

/** Extends a live lease; null when the proposal is not processing under this lease. */
export async function extendCourseSuggestion(db: Db, id: string, leaseToken: string): Promise<Date | null> {
  const result = await db.query<{ leaseUntil: Date }>(
    `UPDATE ad_comp_ai_suggestions SET lease_until=now()+make_interval(mins => $3),updated_at=now()
      WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now() RETURNING lease_until AS "leaseUntil"`,
    [id, leaseToken, AI_JOB_LEASE_MINUTES]);
  return result.rows[0]?.leaseUntil ?? null;
}

type LockedSuggestion = { status: string; lease_token: string | null; valid: boolean | null; ai_input: Record<string, unknown> | null };

/**
 * Stores the worker's result inside the worker router's transaction. Returns 'missing' when no
 * proposal has this id, 'expired' for another or lost lease (a cancelled proposal stays cancelled),
 * and 'ok' when stored or already stored under the same lease.
 */
export async function completeCourseSuggestion(client: PoolClient, id: string, input: WorkerCompletion): Promise<"ok" | "expired" | "missing"> {
  const locked = await client.query<LockedSuggestion>(
    "SELECT status,lease_token,lease_until>now() AS valid,ai_input FROM ad_comp_ai_suggestions WHERE id=$1 FOR UPDATE", [id]);
  const job = locked.rows[0];
  if (!job) return "missing";
  if ((job.status === "completed" || job.status === "failed") && job.lease_token === input.leaseToken) return "ok";
  if (job.status !== "processing" || job.lease_token !== input.leaseToken || job.valid !== true) return "expired";

  let errorCode: string | null = "error" in input ? input.error : null;
  let result: StoredCourseAiResult | null = null;
  if (!("error" in input)) {
    const context = courseAiContextFromInput(job.ai_input);
    const checked = context ? validateCourseAiOutput(input.output, context) : null;
    if (checked?.ok) result = checked.result;
    else errorCode = "invalid_ai_output";
  }
  const model = "error" in input ? null : input;
  const promptVersion = typeof job.ai_input?.promptVersion === "string" ? job.ai_input.promptVersion : null;
  await client.query(
    `UPDATE ad_comp_ai_suggestions SET status=$2,error_code=$3,result=$4::jsonb,metrics=$5::jsonb,ai_model=$6,ai_model_digest=$7,
      ollama_version=$8,prompt_version=COALESCE($9,prompt_version),ai_input=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1`,
    [id, errorCode ? "failed" : "completed", errorCode, result ? JSON.stringify(result) : null,
      model ? JSON.stringify(model.metrics) : null, model?.model ?? null, model?.digest || null, model?.ollamaVersion || null, promptVersion]);
  return "ok";
}
