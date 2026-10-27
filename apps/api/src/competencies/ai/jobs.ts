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
import { majorCodesOf, majorsOf } from "../repository.js";
import { MAJORS, majorKey } from "../../curricula/majors.js";
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
  const profiles = await client.query<{ id: string; name: string; description: string; groupId: string; majorCodes: string[] }>(
    `SELECT s.id,s.name,COALESCE(NULLIF(cs.scope,''),s.description) AS description,cs.group_id AS "groupId",${majorsOf("cs")} AS "majorCodes"
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

/**
 * The skills the faculty imported for each course (v5): the links of its first "Nhập dữ liệu" history
 * entry (the K29 workbook import), mapped to the live, active profiles, highest weight first.
 */
async function loadFacultyLinks(client: Db, courseIds: string[]) {
  const result = await client.query<{ courseId: string; skillId: string; name: string; weight: number }>(
    `WITH origin AS (SELECT DISTINCT ON (e.entity_key) e.entity_key,e.snapshot->'links' AS links FROM ad_comp_events e
        WHERE e.kind='course' AND e.entity_key=ANY($1::text[]) AND e.note LIKE 'Nhập dữ liệu%' ORDER BY e.entity_key,e.created_at,e.id)
      SELECT o.entity_key AS "courseId",s.id AS "skillId",s.name,(l->>'weight')::float8 AS weight
      FROM origin o CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.links)='array' THEN o.links ELSE '[]'::jsonb END) l
      JOIN career_skills s ON s.id::text=l->>'skillId' AND s.deleted_at IS NULL
      JOIN ad_comp_skills cs ON cs.skill_id=s.id AND cs.deleted_at IS NULL AND cs.is_active
      WHERE (l->>'weight')::float8>0 ORDER BY o.entity_key,weight DESC,s.name,s.id`, [courseIds]);
  const byCourse = new Map<string, NonNullable<CourseAiSource["facultyLinks"]>>();
  for (const row of result.rows) {
    const bucket = byCourse.get(row.courseId) ?? [];
    bucket.push({ skillId: row.skillId, name: row.name, weight: row.weight });
    byCourse.set(row.courseId, bucket);
  }
  return byCourse;
}

const cohortNumber = (cohort: string) => Number(cohort.replace(/\D/g, "")) || 0;
const shortOf = (major: string) => MAJORS.find((item) => majorKey(item.name) === major)?.short ?? major;

/**
 * The Faculty's majors whose newest CTĐT revision has each course, with those cohorts (v6/v5): the AI only
 * offers a skill kept to some majors to their courses, and names the majors in mục [1].
 */
async function loadCourseMajors(client: Db, courseIds: string[]) {
  const result = await client.query<{ courseId: string; major: string; cohorts: string[] }>(
    `SELECT cc.course_id AS "courseId",split_part(cu.identity_key,':',1) AS major,array_agg(DISTINCT cu.cohort_code) AS cohorts
      FROM curriculum_courses cc JOIN curricula cu ON cu.current_revision=cc.revision_id
      WHERE cc.course_id=ANY($1::uuid[]) GROUP BY 1,2`, [courseIds]);
  const byCourse = new Map<string, NonNullable<CourseAiSource["majors"]>>();
  for (const courseId of new Set(result.rows.map((row) => row.courseId))) {
    const rows = result.rows.filter((row) => row.courseId === courseId);
    byCourse.set(courseId, majorCodesOf(rows.map((row) => row.major)).map((code) => ({
      code,
      cohorts: rows.filter((row) => majorCodesOf([row.major]).includes(code)).flatMap((row) => row.cohorts)
        .sort((a, b) => cohortNumber(a) - cohortNumber(b) || a.localeCompare(b))
    })));
  }
  return byCourse;
}

/**
 * For each course, the applied configuration of a course of the same name under another code (v6/v5): the same
 * course in another major or an older cohort ("An ninh Mạng không dây" of MMT&TTDL and of CNTT). The name is
 * compared as the shared course key compares it (migration 038); the one in the newest cohort wins. Its links
 * with a weight, live active profiles only, highest weight first.
 */
async function loadNamesakes(client: Db, courseIds: string[]) {
  const result = await client.query<{ courseId: string; code: string; identities: string[]; skillId: string; name: string; weight: number }>(
    `WITH current AS (SELECT cc.course_id,cu.identity_key,cu.cohort_code FROM curriculum_courses cc JOIN curricula cu ON cu.current_revision=cc.revision_id),
      named AS (SELECT c.id,c.code,split_part(public.ad_comp_course_key(c.code,c.name,c.credits),'|',2) AS name_key FROM ad_comp_courses c),
      chosen AS (SELECT DISTINCT ON (t.id) t.id AS course_id,o.id AS other_id,o.code,cfg.id AS config_id
        FROM named t JOIN named o ON o.name_key=t.name_key AND o.id<>t.id
        JOIN ad_comp_course_configs cfg ON cfg.course_id=o.id AND cfg.status='active'
        WHERE t.id=ANY($1::uuid[]) AND EXISTS(SELECT 1 FROM current x WHERE x.course_id=o.id)
          AND EXISTS(SELECT 1 FROM ad_comp_course_links l WHERE l.config_id=cfg.id AND l.weight>0)
        ORDER BY t.id,(SELECT max(NULLIF(regexp_replace(x.cohort_code,'\\D','','g'),'')::int) FROM current x WHERE x.course_id=o.id) DESC NULLS LAST,o.code,o.id)
      SELECT ch.course_id AS "courseId",ch.code,
        (SELECT array_agg(DISTINCT x.identity_key) FROM current x WHERE x.course_id=ch.other_id) AS identities,
        l.skill_id AS "skillId",s.name,l.weight::float8 AS weight
      FROM chosen ch JOIN ad_comp_course_links l ON l.config_id=ch.config_id AND l.weight>0
      JOIN career_skills s ON s.id=l.skill_id AND s.deleted_at IS NULL
      JOIN ad_comp_skills cs ON cs.skill_id=l.skill_id AND cs.deleted_at IS NULL AND cs.is_active
      ORDER BY ch.course_id,l.weight DESC,s.name,s.id`, [courseIds]);
  const byCourse = new Map<string, NonNullable<CourseAiSource["namesake"]>>();
  for (const row of result.rows) {
    let namesake = byCourse.get(row.courseId);
    if (!namesake) {
      // "CNTT K27, MMT&TTDL K31": the majors and cohorts that have the namesake, oldest cohort first.
      const where = [...row.identities].map((identity) => identity.split(":") as [string, string])
        .sort((a, b) => cohortNumber(a[1]) - cohortNumber(b[1]) || a[0].localeCompare(b[0]))
        .map(([major, cohort]) => `${shortOf(major)} ${cohort}`).join(", ");
      namesake = { code: row.code, where, links: [] };
      byCourse.set(row.courseId, namesake);
    }
    namesake.links.push({ skillId: row.skillId, name: row.name, weight: row.weight });
  }
  return byCourse;
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

/** What a course adds to the shared catalog (v6/v5: its majors and the configured course of the same name). */
type CourseExtras = { facultyLinks?: CourseAiSource["facultyLinks"]; majors?: CourseAiSource["majors"]; namesake?: CourseAiSource["namesake"] };

/** One course: the shared catalog, its curriculum row and its links. */
function courseSource(shared: SharedSource, row: SourceRow, links: CourseAiSource["links"], extras: CourseExtras = {}): CourseAiSource {
  const course = row.course;
  return {
    curriculum: { cohortCode: row.cohortCode, name: row.curriculumName, version: row.version },
    majors: extras.majors ?? [],
    groups: shared.groups,
    profiles: shared.profiles,
    careerSkills: shared.careerSkills,
    links,
    facultyLinks: extras.facultyLinks ?? [],
    namesake: extras.namesake ?? null,
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
  const extras: CourseExtras = {
    facultyLinks: (await loadFacultyLinks(client, [input.courseId])).get(input.courseId),
    majors: (await loadCourseMajors(client, [input.courseId])).get(input.courseId),
    namesake: (await loadNamesakes(client, [input.courseId])).get(input.courseId)
  };
  const aiInput = buildCourseAiInput(courseSource(await loadSharedSource(client), source, links, extras), input.mode);
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
  const faculty = await loadFacultyLinks(client, input.courseIds);
  const majors = await loadCourseMajors(client, input.courseIds);
  const namesakes = await loadNamesakes(client, input.courseIds);
  const pending = await client.query<{ courseId: string }>(
    `SELECT course_id AS "courseId" FROM ad_comp_ai_suggestions WHERE course_id=ANY($1::uuid[]) AND mode='full' AND status IN ${PENDING}`, [input.courseIds]);
  const pendingIds = new Set(pending.rows.map((row) => row.courseId));
  const shared = await loadSharedSource(client);
  const skipped = { linked: 0, pending: 0 };
  const inputs: { source: SourceRow; input: CourseAiInput }[] = [];
  for (const source of sources) {
    if ((links.get(source.courseId) ?? []).length) { skipped.linked += 1; continue; }
    if (pendingIds.has(source.courseId)) { skipped.pending += 1; continue; }
    const aiInput = buildCourseAiInput(courseSource(shared, source, [], {
      facultyLinks: faculty.get(source.courseId), majors: majors.get(source.courseId), namesake: namesakes.get(source.courseId)
    }), "full");
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

/**
 * What a run over these courses would send to the model, read only (nothing is queued): the inputs of the
 * courses without a link, "full" mode. For checking a prompt or catalog change on real data before a run.
 */
export async function previewCourseBatch(client: Db, courseIds: string[]): Promise<{ courseId: string; code: string; name: string; input: CourseAiInput }[]> {
  const sources = await loadSourceRows(client, courseIds);
  const links = await loadCourseLinks(client, courseIds);
  const faculty = await loadFacultyLinks(client, courseIds);
  const majors = await loadCourseMajors(client, courseIds);
  const namesakes = await loadNamesakes(client, courseIds);
  const shared = await loadSharedSource(client);
  return sources.filter((source) => !(links.get(source.courseId) ?? []).length).map((source) => ({
    courseId: source.courseId, code: source.code, name: source.name,
    input: buildCourseAiInput(courseSource(shared, source, [], {
      facultyLinks: faculty.get(source.courseId), majors: majors.get(source.courseId), namesake: namesakes.get(source.courseId)
    }), "full")
  }));
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
