// Study roadmap jobs. A stu_roadmaps row is both the AI worker job (kind "study_roadmap", handed out by
// /api/worker/competency-assessments, whose router calls the claim/extend/complete functions below) and the stored
// roadmap. The student asks for one on the page ("Tạo lộ trình", "Tạo lại"); it is built from the newest competency
// assessment and goes with it (foreign key ON DELETE CASCADE: transcript replaced or deleted, consent withdrawn,
// assessment pruned), and from the profile survey, which only the AI input carries (cleared when the job ends; deleting
// the survey deletes the roadmaps). One pending row per student; the newest MAX_ROADMAPS_PER_USER rows are kept.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  AI_HOUSEKEEPING_INTERVAL_MS,
  AI_JOB_LEASE_MINUTES,
  AI_JOB_MAX_ATTEMPTS,
  type WorkerCompletion,
} from "../competency-assessment/ai/worker-protocol.js";
import type { AssessmentResult } from "../competency-assessment/types.js";
import { readRealCourseRows, realCodesOfRows } from "../curricula/real-codes.js";
import type { DatabasePool } from "../db/pool.js";
import { readOwnPlannedCodes } from "../study-plan/own-plan.js";
import { readSurvey, surveyFacts, surveyUsable } from "../student/survey.js";
import { buildRoadmapFacts, type RoadmapFacts, type RoadmapRelation } from "./facts.js";
import { sanitizeText } from "../competency-assessment/ai/prompt.js";
import { buildRoadmapInput } from "./prompt.js";
import { roadmapContextFromAiInput, validateRoadmapOutput, type RoadmapOutput } from "./validate.js";
import { notifyInTransaction, roadmapFailed, roadmapReady } from "../notifications/notify.js";
import { roadmapWindow } from "./window.js";

/** Serializes the pending checks, the queue-size check and the inserts of concurrent requests. */
const ROADMAP_QUEUE_LOCK = "edupath:study-roadmap";
/** New work is refused while this many roadmaps of OTHER students are queued or processing. */
const MAX_PENDING_ROADMAPS = 20;
/** Rows kept per student (newest first); older finished rows are pruned on every insert. */
const MAX_ROADMAPS_PER_USER = 5;
/** At most one insert per student within this many seconds. */
const ROADMAP_INSERT_INTERVAL_SECONDS = 30;
/** error_code of a roadmap asked again because its first answer did not hold to the data (roadmap-v9); cleared when it ends. */
export const ROADMAP_RETRY_CODE = "grounding_retry";
/** Issues named to the model when it is asked again. */
const MAX_RETRY_ISSUES = 6;

type Db = Pick<DatabasePool, "query">;
const PENDING = "('queued','processing')";

export type RoadmapStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

/** A stored row as the student routes read it. */
export type RoadmapRow = {
  id: string;
  assessmentId: string;
  status: RoadmapStatus;
  errorCode: string | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
  model: string | null;
  facts: RoadmapFacts;
  output: RoadmapOutput | null;
  /** Created within ROADMAP_INSERT_INTERVAL_SECONDS (database clock). */
  recent: boolean;
};

export class RoadmapError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "RoadmapError";
  }
}

const rowColumns = `id,assessment_id AS "assessmentId",status,error_code AS "errorCode",created_at AS "createdAt",completed_at AS "completedAt",
  ai_model AS model,facts,ai_output AS output,created_at>now()-make_interval(secs => $2) AS recent`;

/** Every roadmap row of the student, newest first (at most a handful: they are pruned on insert). */
export async function readRoadmapRows(db: Db, userId: string): Promise<RoadmapRow[]> {
  const result = await db.query<RoadmapRow>(
    `SELECT ${rowColumns} FROM stu_roadmaps WHERE user_id=$1 ORDER BY created_at DESC,id DESC`, [userId, ROADMAP_INSERT_INTERVAL_SECONDS]);
  return result.rows;
}

/** The newest roadmap of the student, or null (GET /). */
export async function readNewestRoadmap(db: Db, userId: string): Promise<RoadmapRow | null> {
  const result = await db.query<RoadmapRow>(
    `SELECT ${rowColumns} FROM stu_roadmaps WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [userId, ROADMAP_INSERT_INTERVAL_SECONDS]);
  return result.rows[0] ?? null;
}

/**
 * The newest completed roadmap older than `newestId` (GET /): while the newest one is queued, being written, failed or
 * cancelled, the page shows this one's AI parts dimmed, like the advice of Xét tốt nghiệp.
 */
export async function readPreviousCompletedRoadmap(db: Db, userId: string, newestId: string): Promise<RoadmapRow | null> {
  const result = await db.query<RoadmapRow>(
    `SELECT ${rowColumns} FROM stu_roadmaps WHERE user_id=$1 AND status='completed' AND ai_output IS NOT NULL
      AND (created_at,id)<(SELECT n.created_at,n.id FROM stu_roadmaps n WHERE n.id=$3 AND n.user_id=$1)
      ORDER BY created_at DESC,id DESC LIMIT 1`, [userId, ROADMAP_INSERT_INTERVAL_SECONDS, newestId]);
  return result.rows[0] ?? null;
}

/** The newest assessment without its result (GET /): its id, its time and whether it has a target career. */
export async function newestAssessmentInfo(db: Db, userId: string): Promise<{ id: string; createdAt: Date | string; hasCareer: boolean } | null> {
  const result = await db.query<{ id: string; createdAt: Date | string; hasCareer: boolean }>(
    `SELECT id,created_at AS "createdAt",jsonb_typeof(computed->'career')='object' AS "hasCareer" FROM stu_comp_assessments
      WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [userId]);
  return result.rows[0] ?? null;
}

/** The newest competency assessment of the student: what a roadmap is built from. */
export async function newestAssessment(db: Db, userId: string): Promise<{ id: string; createdAt: Date | string; computed: AssessmentResult } | null> {
  const result = await db.query<{ id: string; createdAt: Date | string; computed: AssessmentResult }>(
    `SELECT id,created_at AS "createdAt",computed FROM stu_comp_assessments WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [userId]);
  return result.rows[0] ?? null;
}

/** A result of comp-calc-v22 on reads its CTĐT with the real codes of the graduation standard (curricula/real-codes.ts). */
const readsRealCodes = (calcVersion: string | undefined) => Number(/^comp-calc-v(\d+)$/.exec(calcVersion ?? "")?.[1]) >= 22;

/**
 * The tiên quyết and học trước of the CTĐT revision an assessment read (roadmap-v15, user 2026-11-08): what the roadmap's
 * facts check each course against (facts.ts waitsFor). None for a result without its revision, or a revision gone. A
 * result that reads the real codes (comp-calc-v22) reads its relations with them too; an older one keeps the file's.
 */
export async function readRoadmapRelations(db: Db, result: Pick<AssessmentResult, "meta">): Promise<RoadmapRelation[]> {
  const revisionId = result.meta?.curriculum?.revisionId;
  if (!revisionId) return [];
  const relations = (await db.query<RoadmapRelation>(
    `SELECT course_code AS "courseCode",kind,target_codes AS "targetCodes" FROM curriculum_relations
     WHERE revision_id=$1 ORDER BY course_code,kind`, [revisionId])).rows;
  if (!relations.length || !readsRealCodes(result.meta?.calcVersion)) return relations;
  const codes = realCodesOfRows(await readRealCourseRows(db, [revisionId]));
  const real = (code: string) => codes.get(code.trim().toUpperCase()) ?? code;
  return codes.size ? relations.map((relation) => ({ ...relation, courseCode: real(relation.courseCode), targetCodes: relation.targetCodes.map(real) })) : relations;
}

/* ------------------------------------------------------------------------ */
/* Housekeeping */

/**
 * Fails stuck roadmaps: queued for more than 24 hours, or processing with an expired lease after the last attempt
 * (or older than 24 hours). ai_input is cleared with the failure.
 */
export async function expireRoadmaps(db: Db): Promise<void> {
  await db.query(`UPDATE stu_roadmaps SET status='failed',error_code=$2,ai_input=NULL,lease_token=NULL,lease_until=NULL,
      completed_at=now(),updated_at=now()
    WHERE (status='queued' AND created_at<now()-interval '24 hours')
      OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))`,
  [AI_JOB_MAX_ATTEMPTS, "worker_timeout"]);
}

/** Rate-limited expiry (at most once per interval per returned function), run from the worker and student routers. */
export function createRoadmapExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Db): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireRoadmaps(db);
    return true;
  };
}

/** Keeps the newest MAX_ROADMAPS_PER_USER rows of the student (a pending row is never pruned). */
async function pruneRoadmaps(db: Db, userId: string): Promise<void> {
  await db.query(`DELETE FROM stu_roadmaps WHERE user_id=$1 AND status NOT IN ${PENDING} AND id NOT IN (
    SELECT id FROM stu_roadmaps WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2)`, [userId, MAX_ROADMAPS_PER_USER]);
}

/* ------------------------------------------------------------------------ */
/* Queueing (student route) */

type CreateOptions = {
  /** Rate-limited housekeeping run inside the transaction (createRoadmapExpiry). */
  expire?: (db: Db) => Promise<unknown>;
  /** Test seam: the day the roadmap starts from. */
  now?: Date;
};

/**
 * "Tạo lộ trình" / "Tạo lại" (POST /api/student/roadmap), inside the caller's transaction. The student's row comes
 * first (FOR KEY SHARE, the lock the insert's foreign key takes anyway), then the queue lock. It needs an assessment
 * (409 assessment_required) and the answered profile survey, agreed to under the current policy (409 survey_required,
 * user 2026-10-24: the AI advises from it). A roadmap still being written for the newest assessment is returned as it is; otherwise one queued for an older
 * assessment is cancelled and a new one is queued, unless the student queued one in the last 30 seconds (429
 * roadmap_too_frequent) or the queue is full (429 queue_full).
 */
export async function createRoadmap(client: PoolClient, userId: string, options: CreateOptions = {}): Promise<{ row: RoadmapRow; created: boolean }> {
  const user = await client.query("SELECT id FROM users WHERE id=$1 AND is_active FOR KEY SHARE", [userId]);
  if (!user.rowCount) throw new RoadmapError("account_unavailable", 403);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ROADMAP_QUEUE_LOCK]);
  if (options.expire) await options.expire(client);
  const assessment = await newestAssessment(client, userId);
  if (!assessment) throw new RoadmapError("assessment_required", 409);
  // The answers go to the AI only under consent to the current policy (2026-10-25 added the interests), or when a cố vấn
  // học tập or the Khoa filled them in for the student and the student has not withdrawn it (surveyUsable, policy 2026-11-10).
  const survey = await readSurvey(client, userId);
  if (!survey || !await surveyUsable(client, userId, survey)) throw new RoadmapError("survey_required", 409);
  const rows = await readRoadmapRows(client, userId);
  const pending = rows.find((row) => row.status === "queued" || row.status === "processing");
  if (pending?.assessmentId === assessment.id) return { row: pending, created: false };
  if (rows[0]?.recent) throw new RoadmapError("roadmap_too_frequent", 429);
  const others = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM stu_roadmaps WHERE status IN ${PENDING} AND user_id<>$1`, [userId]);
  if ((others.rows[0]?.count ?? 0) >= MAX_PENDING_ROADMAPS) throw new RoadmapError("queue_full", 429);

  await client.query(`UPDATE stu_roadmaps SET status='cancelled',ai_input=NULL,lease_token=NULL,lease_until=NULL,completed_at=now(),updated_at=now()
    WHERE user_id=$1 AND status IN ${PENDING}`, [userId]);
  const window = roadmapWindow(options.now ?? new Date());
  // roadmap-v16: the thesis group follows the way the student chose in Kế hoạch học kỳ (user 2026-11-10).
  const facts = buildRoadmapFacts(assessment.id, assessment.computed, window, await readRoadmapRelations(client, assessment.computed),
    await readOwnPlannedCodes(client, userId));
  const aiInput = buildRoadmapInput(facts, surveyFacts(survey));
  const id = randomUUID();
  const inserted = await client.query<{ createdAt: Date | string }>(
    `INSERT INTO stu_roadmaps(id,user_id,assessment_id,window_start,window_end,facts,status,ai_input,prompt_version)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,'queued',$7::jsonb,$8) RETURNING created_at AS "createdAt"`,
    [id, userId, assessment.id, window.start, window.end, JSON.stringify(facts), JSON.stringify(aiInput), aiInput.promptVersion]);
  await pruneRoadmaps(client, userId);
  return {
    row: { id, assessmentId: assessment.id, status: "queued", errorCode: null, createdAt: inserted.rows[0]?.createdAt ?? new Date(),
      completedAt: null, model: null, facts, output: null, recent: true },
    created: true,
  };
}

/* ------------------------------------------------------------------------ */
/* Worker side (called by competency-assessment/ai/worker-router.ts) */

/** Claims the oldest runnable roadmap (SKIP LOCKED, 15 minute lease, at most 2 attempts). */
export async function claimRoadmap(db: Db, leaseToken: string): Promise<{ id: string; leaseToken: string; aiInput: Record<string, unknown> } | null> {
  const result = await db.query<{ id: string; leaseToken: string; aiInput: Record<string, unknown> }>(`WITH candidate AS (
      SELECT id FROM stu_roadmaps
      WHERE ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE stu_roadmaps j SET status='processing',lease_token=$1,lease_until=now()+make_interval(mins => $3),attempts=j.attempts+1,updated_at=now()
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.lease_token AS "leaseToken",j.ai_input AS "aiInput"`,
  [leaseToken, AI_JOB_MAX_ATTEMPTS, AI_JOB_LEASE_MINUTES]);
  return result.rows[0] ?? null;
}

/** Extends a live lease; null when the roadmap is not processing under this lease. */
export async function extendRoadmap(db: Db, id: string, leaseToken: string): Promise<Date | null> {
  const result = await db.query<{ leaseUntil: Date }>(
    `UPDATE stu_roadmaps SET lease_until=now()+make_interval(mins => $3),updated_at=now()
      WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now() RETURNING lease_until AS "leaseUntil"`,
    [id, leaseToken, AI_JOB_LEASE_MINUTES]);
  return result.rows[0]?.leaseUntil ?? null;
}

type LockedRoadmap = { status: string; lease_token: string | null; valid: boolean | null; ai_input: Record<string, unknown> | null };

/**
 * The input of the second try (roadmap-v9; user 2026-10-30: "kiểm tra lại đầu ra trước khi hiện"): the same data, the
 * system message with what the first answer got wrong, and that answer's checked output, kept if the second one is
 * unusable. Null when the input was already asked again (one retry only) or cannot be read.
 */
export function retryInput(input: Record<string, unknown> | null, issues: readonly string[], fallback: RoadmapOutput | null): Record<string, unknown> | null {
  if (!input || input.retry !== undefined || typeof input.system !== "string") return null;
  const listed = issues.slice(0, MAX_RETRY_ISSUES).map((issue) => `- ${sanitizeText(issue, 400)}`);
  const note = ["", "LƯU Ý CHO LẦN VIẾT NÀY: bản trước bị hệ thống trả lại vì các câu sau không khớp dữ liệu:", ...listed,
    "Chỉ nhắc các học kỳ trong danh sách học kỳ được nhắc tới; điều chỉ có trong phần bạn tự khai thì ghi rõ \"bạn tự đánh giá…\" hay \"bạn cho biết…\" và gợi ý cách chứng minh. Hãy viết lại toàn bộ lộ trình theo đúng cấu trúc JSON."].join("\n");
  return { ...input, system: `${input.system}\n${note}`, retry: { issues: issues.slice(0, MAX_RETRY_ISSUES), fallback } };
}
/** The checked output of the first try, stored with the retry. */
function retryFallback(input: Record<string, unknown> | null): RoadmapOutput | null {
  const retry = input?.retry;
  return retry && typeof retry === "object" && !Array.isArray(retry) && (retry as { fallback?: unknown }).fallback
    ? (retry as { fallback: RoadmapOutput }).fallback : null;
}

/**
 * Stores the worker's result inside the worker router's transaction. Returns 'missing' when no roadmap has this id,
 * 'expired' for another or lost lease (a cancelled roadmap stays cancelled), and 'ok' when stored or already stored
 * under the same lease. The output is validated and cleaned (validate.ts); ai_input is cleared either way.
 */
export async function completeRoadmap(client: PoolClient, id: string, input: WorkerCompletion): Promise<"ok" | "expired" | "missing"> {
  const locked = await client.query<LockedRoadmap>(
    "SELECT status,lease_token,lease_until>now() AS valid,ai_input FROM stu_roadmaps WHERE id=$1 FOR UPDATE", [id]);
  const job = locked.rows[0];
  if (!job) return "missing";
  if ((job.status === "completed" || job.status === "failed") && job.lease_token === input.leaseToken) return "ok";
  if (job.status !== "processing" || job.lease_token !== input.leaseToken || job.valid !== true) return "expired";

  let errorCode: string | null = "error" in input ? input.error : null;
  let output: RoadmapOutput | null = null;
  if (!("error" in input)) {
    const context = roadmapContextFromAiInput(job.ai_input);
    const checked = context ? validateRoadmapOutput(input.output, context) : null;
    const issues = checked?.issues ?? [];
    if (checked && issues.length) {
      // The answer named a term it may not name or stated as fact what only the student said: ask once more, with what
      // was wrong (the sentences are already dropped from this output, kept should the second answer be unusable).
      const again = retryInput(job.ai_input, issues, checked.ok ? checked.output : null);
      if (again) {
        await client.query(`UPDATE stu_roadmaps SET status='queued',error_code=$2,ai_input=$3::jsonb,lease_token=NULL,lease_until=NULL,updated_at=now()
          WHERE id=$1`, [id, ROADMAP_RETRY_CODE, JSON.stringify(again)]);
        return "ok";
      }
    }
    if (checked?.ok) output = checked.output;
    else errorCode = "invalid_ai_output";
  }
  // The second try failed: the first answer, its stray sentences dropped, is better than no roadmap.
  const fallback = errorCode ? retryFallback(job.ai_input) : null;
  if (fallback) { output = fallback; errorCode = null; }
  const model = "error" in input ? null : input;
  const promptVersion = typeof job.ai_input?.promptVersion === "string" ? job.ai_input.promptVersion : null;
  const updated = await client.query<{ user_id: string }>(
    `UPDATE stu_roadmaps SET status=$2,error_code=$3,ai_output=$4::jsonb,metrics=$5::jsonb,ai_model=$6,ai_model_digest=$7,
      ollama_version=$8,prompt_version=COALESCE($9,prompt_version),ai_input=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1
      RETURNING user_id`,
    [id, errorCode ? "failed" : "completed", errorCode, output ? JSON.stringify(output) : null,
      model ? JSON.stringify(model.metrics) : null, model?.model ?? null, model?.digest || null, model?.ollamaVersion || null, promptVersion]);
  // The roadmap takes minutes to write: the bell tells the student how it ended (2026-10-30, STU-PROG-04).
  const userId = updated?.rows[0]?.user_id;
  if (userId) await notifyInTransaction(client, userId, { ...(errorCode ? roadmapFailed() : roadmapReady()), sourceKey: `roadmap:${id}` });
  return "ok";
}
