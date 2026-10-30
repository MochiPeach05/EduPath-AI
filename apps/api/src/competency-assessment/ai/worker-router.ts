// Worker API for the local AI commentary (contract C3, spec §8). Mounted at
// /api/worker/competency-assessments BEFORE the global JSON parser: the key is checked
// before any body is read, then this router parses JSON itself (512 kB).
// The same endpoints also serve career skill suggestions (careers/ai-suggestions/jobs.ts) to
// workers that advertise the "career_skill_suggestion" kind and graduation advice
// (graduation/advice/jobs.ts) to workers that advertise "graduation_advice", and AI proposals for
// the courses of a CTĐT (competencies/ai/jobs.ts) to workers that advertise
// "competency_course_suggestion_v2", and study roadmaps (roadmap/jobs.ts) to workers that advertise
// "study_roadmap"; extend/complete find the id in any of the job tables. Since 2026-10-28 they also serve the answers of
// Trợ lý AI ("assistant_chat", assistant/chat.ts, with /:id/prepare and /:id/progress) and the embeddings of its
// knowledge index ("knowledge_embedding", assistant/knowledge-jobs.ts); see assistant/protocol.ts.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import express, { Router, type ErrorRequestHandler, type RequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../../db/pool.js";
import {
  claimCareerSuggestion,
  completeCareerSuggestion,
  createCareerSuggestionExpiry,
  extendCareerSuggestion
} from "../../careers/ai-suggestions/jobs.js";
import {
  claimGraduationAdvice,
  completeGraduationAdvice,
  createGraduationAdviceExpiry,
  extendGraduationAdvice
} from "../../graduation/advice/jobs.js";
import {
  claimCourseSuggestion,
  completeCourseSuggestion,
  createCourseSuggestionExpiry,
  extendCourseSuggestion
} from "../../competencies/ai/jobs.js";
import { claimRoadmap, completeRoadmap, createRoadmapExpiry, extendRoadmap } from "../../roadmap/jobs.js";
import { assessmentComment, notifyInTransaction } from "../../notifications/notify.js";
import {
  assistantWorkerJob,
  claimAssistantAnswer,
  completeAssistantAnswer,
  createAssistantExpiry,
  extendAssistantAnswer,
  prepareAssistantAnswer,
  progressAssistantAnswer
} from "../../assistant/chat.js";
import {
  claimKnowledgeEmbedding,
  completeKnowledgeEmbedding,
  createKnowledgeExpiry,
  enqueueKnowledgeEmbeddings,
  extendKnowledgeEmbedding,
  knowledgeWorkerJob
} from "../../assistant/knowledge-jobs.js";
import { createKnowledgeRefresh } from "../../assistant/knowledge.js";
import { CLAIM_WAIT_MS, EMBEDDING_DIMENSIONS, prepareBodySchema, progressBodySchema } from "../../assistant/protocol.js";
import { waitForAssistantWork } from "../../assistant/wakeup.js";
import { cleanAiOutputKeys, keyNamesFrom } from "./key-cleanup.js";
import { repairAiOutput, retryNote, validateAiOutput, validationContextFromAiInput } from "./validate.js";
import {
  AI_HOUSEKEEPING_INTERVAL_MS,
  AI_JOB_LEASE_MINUTES,
  AI_JOB_MAX_ATTEMPTS,
  AI_WORKER_ERROR_CODES,
  ASSISTANT_CHAT_KIND,
  CAREER_SKILL_SUGGESTION_KIND,
  COMPETENCY_ASSESSMENT_KIND,
  COMPETENCY_COURSE_SUGGESTION_KIND,
  GRADUATION_ADVICE_KIND,
  KNOWLEDGE_EMBEDDING_KIND,
  STUDY_ROADMAP_KIND,
  normalizeJobKinds,
  type AiJobKind
} from "./worker-protocol.js";

class WorkerError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const leaseBody = z.object({ leaseToken: z.uuid() }).strict();
/**
 * Optional on /heartbeat and /claim; workers released before career suggestions send {}. wait (2026-10-28): with no job,
 * hold the claim up to CLAIM_WAIT_MS for a question to answer.
 */
const kindsBody = z.object({ kinds: z.array(z.string().max(64)).max(16).optional(), wait: z.boolean().optional() });
const metricsSchema = z.record(z.string().max(64), z.union([z.number(), z.string().max(200), z.boolean(), z.null()]))
  .refine((value) => Object.keys(value).length <= 32, "too_many_metrics");
const completeBody = z.union([
  z.object({
    leaseToken: z.uuid(),
    model: z.string().min(1).max(200),
    digest: z.string().max(200),
    ollamaVersion: z.string().max(64),
    metrics: metricsSchema,
    output: z.unknown()
  }).strict(),
  z.object({ leaseToken: z.uuid(), error: z.enum(AI_WORKER_ERROR_CODES) }).strict()
]);

type JobRow = {
  status: string;
  lease_token: string | null;
  valid: boolean | null;
  assessment_id: string;
  user_id: string;
  ai_input: { schema?: unknown; user?: unknown; promptVersion?: unknown; checks?: unknown; retryNote?: unknown } | null;
};

/**
 * Fails stuck jobs and marks their assessments failed, then deletes old terminal JOBS.
 * Stuck = a processing job whose lease expired after the last attempt, or any pending job
 * older than 24 hours (a processing one only once its lease has expired, so a running job
 * is never cut off). ai_input is cleared with the failure. Assessments are never deleted here.
 */
export async function expireCompetencyAiJobs(db: Pick<DatabasePool, "query">): Promise<void> {
  await db.query(`WITH failed AS (
      UPDATE stu_comp_ai_jobs SET status='failed',error_code='worker_timeout',ai_input=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE (status='queued' AND created_at<now()-interval '24 hours')
        OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))
      RETURNING assessment_id)
    UPDATE stu_comp_assessments a SET ai_status='failed',ai_error_code='worker_timeout'
      FROM failed f WHERE a.id=f.assessment_id AND a.ai_status IN ('queued','processing')`, [AI_JOB_MAX_ATTEMPTS]);
  await db.query(`DELETE FROM stu_comp_ai_jobs WHERE status IN ('completed','failed','cancelled') AND updated_at<now()-interval '7 days'`);
}

/**
 * Rate-limited expiry (at most once per interval per returned function). The worker router
 * runs it on /claim and the student API on its reads and writes, so stuck jobs also expire
 * while the worker is offline.
 */
export function createCompetencyAiExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Pick<DatabasePool, "query">): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireCompetencyAiJobs(db);
    return true;
  };
}

export function createCompetencyWorkerRouter(pool: DatabasePool | undefined, aiWorkerKey: string | undefined) {
  const router = Router();
  const hash = (value: string) => createHash("sha256").update(value).digest();
  const expected = aiWorkerKey ? hash(`Bearer ${aiWorkerKey}`) : null;
  const housekeeping = createCompetencyAiExpiry();
  const careerHousekeeping = createCareerSuggestionExpiry();
  const graduationHousekeeping = createGraduationAdviceExpiry();
  const courseHousekeeping = createCourseSuggestionExpiry();
  const roadmapHousekeeping = createRoadmapExpiry();
  const assistantHousekeeping = createAssistantExpiry();
  const knowledgeHousekeeping = createKnowledgeExpiry();
  // The knowledge index is rebuilt from the catalogs at most every 10 minutes, in the background of a claim (it reads
  // every catalog), then its changed chunks are queued for embedding. Neither ever fails a claim.
  const refreshKnowledge = createKnowledgeRefresh();
  const refreshInBackground = () => {
    void refreshKnowledge(db).then((ran) => (ran ? enqueueKnowledgeEmbeddings(db) : 0)).catch(() => undefined);
  };

  const authenticate: RequestHandler = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!expected || !pool) { res.status(503).json({ error: "worker_disabled" }); return; }
    if (!timingSafeEqual(hash(req.get("authorization") ?? ""), expected)) { res.status(401).json({ error: "unauthorized" }); return; }
    next();
  };
  router.use(authenticate);
  router.use(express.json({ limit: "512kb" }));
  const db = pool!;

  const heartbeat = (kinds: AiJobKind[]) => db.query(
    "INSERT INTO stu_comp_ai_worker_status(id,seen_at,kinds) VALUES(1,now(),$1::text[]) ON CONFLICT(id) DO UPDATE SET seen_at=now(),kinds=EXCLUDED.kinds",
    [kinds]);
  const jobKinds = (body: unknown) => {
    const parsed = kindsBody.safeParse(body ?? {});
    if (!parsed.success) throw new WorkerError("invalid_input", 400);
    return normalizeJobKinds(parsed.data.kinds);
  };
  const jobId = (value: unknown) => {
    const parsed = z.uuid().safeParse(value);
    if (!parsed.success) throw new WorkerError("invalid_input", 400);
    return parsed.data;
  };

  router.post("/heartbeat", async (req, res) => {
    await heartbeat(jobKinds(req.body));
    res.json({ ok: true });
  });

  /**
   * Only what the worker needs: key maps (career catalog/linked, graduation keys) stay on the server.
   * `think` is sent only when the job asks for Gemma's thinking mode (course proposals, and the student
   * comment since comp-v7).
   */
  const workerJob = (kind: AiJobKind, claimed: { id: string; leaseToken: string; aiInput: Record<string, unknown> }) => ({
    kind,
    id: claimed.id,
    leaseToken: claimed.leaseToken,
    promptVersion: claimed.aiInput.promptVersion,
    system: claimed.aiInput.system,
    // A comment asked once more (comp-v13) carries what was wrong after the data block.
    user: typeof claimed.aiInput.retryNote === "string" ? `${String(claimed.aiInput.user)}\n\n${claimed.aiInput.retryNote}` : claimed.aiInput.user,
    schema: claimed.aiInput.schema,
    options: claimed.aiInput.options,
    ...(claimed.aiInput.think === true ? { think: true } : {})
  });

  router.post("/claim", async (req, res) => {
    const kinds = jobKinds(req.body);
    const wait = (req.body as { wait?: unknown } | undefined)?.wait === true;
    await heartbeat(kinds);
    await housekeeping(db);
    await careerHousekeeping(db);
    await graduationHousekeeping(db);
    await courseHousekeeping(db);
    await roadmapHousekeeping(db);
    // The Trợ lý AI tables are touched only by workers that run its kinds (the student API expires answers too).
    if (kinds.includes(ASSISTANT_CHAT_KIND)) await assistantHousekeeping(db);
    if (kinds.includes(KNOWLEDGE_EMBEDDING_KIND)) {
      await knowledgeHousekeeping(db);
      refreshInBackground();
    }
    // Answers of Trợ lý AI first: a student waits on the chat, and an answer takes seconds.
    if (kinds.includes(ASSISTANT_CHAT_KIND)) {
      const answer = await claimAssistantAnswer(db, randomUUID());
      if (answer) { res.json({ job: assistantWorkerJob(answer) }); return; }
    }
    // Career suggestions first: an admin is waiting on the page and these jobs are rare.
    if (kinds.includes(CAREER_SKILL_SUGGESTION_KIND)) {
      const career = await claimCareerSuggestion(db, randomUUID());
      if (career) { res.json({ job: workerJob(CAREER_SKILL_SUGGESTION_KIND, career) }); return; }
    }
    // Then graduation advice (a student may be waiting on the page), before the competency-only
    // return below: a worker that does not advertise this kind never receives it.
    if (kinds.includes(GRADUATION_ADVICE_KIND)) {
      const advice = await claimGraduationAdvice(db, randomUUID());
      if (advice) { res.json({ job: workerJob(GRADUATION_ADVICE_KIND, advice) }); return; }
    }
    // Then study roadmaps: the student pressed "Tạo lộ trình" and waits on the page.
    if (kinds.includes(STUDY_ROADMAP_KIND)) {
      const roadmap = await claimRoadmap(db, randomUUID());
      if (roadmap) { res.json({ job: workerJob(STUDY_ROADMAP_KIND, roadmap) }); return; }
    }
    if (kinds.includes(COMPETENCY_ASSESSMENT_KIND)) {
      const result = await db.query<{ id: string; leaseToken: string; aiInput: Record<string, unknown> }>(`WITH candidate AS (
          SELECT id FROM stu_comp_ai_jobs
          WHERE ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
          ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1),
        claimed AS (
          UPDATE stu_comp_ai_jobs j SET status='processing',lease_token=$1,lease_until=now()+make_interval(mins => $3),attempts=j.attempts+1,updated_at=now()
          FROM candidate c WHERE j.id=c.id RETURNING j.id,j.assessment_id,j.lease_token,j.ai_input),
        marked AS (
          UPDATE stu_comp_assessments a SET ai_status='processing' FROM claimed c WHERE a.id=c.assessment_id AND a.ai_status='queued')
        SELECT id,lease_token AS "leaseToken",ai_input AS "aiInput" FROM claimed`,
        [randomUUID(), AI_JOB_MAX_ATTEMPTS, AI_JOB_LEASE_MINUTES]);
      const row = result.rows[0];
      // Same shape as the other kinds, so a comment that asks for thinking (comp-v7) gets think:true.
      if (row) { res.json({ job: workerJob(COMPETENCY_ASSESSMENT_KIND, row) }); return; }
    }
    // Course proposals last: a whole-program run queues one job per course, and no student should
    // wait behind it.
    if (kinds.includes(COMPETENCY_COURSE_SUGGESTION_KIND)) {
      const course = await claimCourseSuggestion(db, randomUUID());
      if (course) { res.json({ job: workerJob(COMPETENCY_COURSE_SUGGESTION_KIND, course) }); return; }
    }
    // Embeddings of the knowledge index last: background work no one waits for.
    if (kinds.includes(KNOWLEDGE_EMBEDDING_KIND)) {
      const batch = await claimKnowledgeEmbedding(db, randomUUID());
      if (batch) { res.json({ job: knowledgeWorkerJob(batch) }); return; }
    }
    // Nothing to do: a worker that asks to wait is held until a question is queued in this process (or CLAIM_WAIT_MS).
    if (wait && kinds.includes(ASSISTANT_CHAT_KIND)) {
      const gone = new AbortController();
      res.on("close", () => gone.abort());
      if (await waitForAssistantWork(CLAIM_WAIT_MS, gone.signal)) {
        const answer = await claimAssistantAnswer(db, randomUUID());
        if (answer) { res.json({ job: assistantWorkerJob(answer) }); return; }
      }
    }
    res.json({ job: null });
  });

  // Trợ lý AI: the prompt of a claimed answer, built from the student's data and the knowledge search (the worker sends
  // the question's vector, or null when embedding failed).
  router.post("/:id/prepare", async (req, res) => {
    const id = jobId(req.params.id);
    const body = prepareBodySchema.safeParse(req.body);
    if (!body.success) throw new WorkerError("invalid_input", 400);
    const vector = body.data.vector?.length === EMBEDDING_DIMENSIONS ? body.data.vector : null;
    const prompt = await prepareAssistantAnswer(db, id, body.data.leaseToken, vector, body.data.standalone ?? null);
    if (prompt === "missing" || prompt === "expired") throw new WorkerError("job_expired", 409);
    res.json(prompt);
  });

  // Trợ lý AI: the answer so far, about once a second while Gemma writes.
  router.post("/:id/progress", async (req, res) => {
    const id = jobId(req.params.id);
    const body = progressBodySchema.safeParse(req.body);
    if (!body.success) throw new WorkerError("invalid_input", 400);
    const outcome = await progressAssistantAnswer(db, id, body.data.leaseToken, body.data.content);
    if (outcome !== "ok") throw new WorkerError("job_expired", 409);
    res.json({ ok: true });
  });

  router.post("/:id/extend", async (req, res) => {
    const id = jobId(req.params.id);
    const body = leaseBody.safeParse(req.body);
    if (!body.success) throw new WorkerError("invalid_input", 400);
    const result = await db.query<{ leaseUntil: Date }>(
      `UPDATE stu_comp_ai_jobs SET lease_until=now()+make_interval(mins => $3),updated_at=now()
        WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now() RETURNING lease_until AS "leaseUntil"`,
      [id, body.data.leaseToken, AI_JOB_LEASE_MINUTES]);
    const leaseUntil = result.rows[0]?.leaseUntil ?? await extendCareerSuggestion(db, id, body.data.leaseToken)
      ?? await extendGraduationAdvice(db, id, body.data.leaseToken) ?? await extendCourseSuggestion(db, id, body.data.leaseToken)
      ?? await extendRoadmap(db, id, body.data.leaseToken) ?? await extendAssistantAnswer(db, id, body.data.leaseToken)
      ?? await extendKnowledgeEmbedding(db, id, body.data.leaseToken);
    if (!leaseUntil) throw new WorkerError("job_expired", 409);
    res.json({ leaseUntil: new Date(leaseUntil).toISOString() });
  });

  router.post("/:id/complete", async (req, res) => {
    const id = jobId(req.params.id);
    const body = completeBody.safeParse(req.body);
    if (!body.success) throw new WorkerError("invalid_input", 400);
    const input = body.data;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<JobRow>(
        `SELECT status,lease_token,lease_until>now() AS valid,assessment_id,user_id,ai_input FROM stu_comp_ai_jobs WHERE id=$1 FOR UPDATE`, [id]);
      const job = locked.rows[0];
      if (job && (job.status === "completed" || job.status === "failed") && job.lease_token === input.leaseToken) {
        await client.query("COMMIT");
        res.json({ ok: true });
        return;
      }
      if (!job) {
        // Not a competency job: the id may be a career skill suggestion, a graduation advice, a course proposal, a roadmap,
        // an answer of Trợ lý AI or a batch of knowledge embeddings.
        const career = await completeCareerSuggestion(client, id, input);
        const graduation = career === "missing" ? await completeGraduationAdvice(client, id, input) : career;
        const course = graduation === "missing" ? await completeCourseSuggestion(client, id, input) : graduation;
        const roadmap = course === "missing" ? await completeRoadmap(client, id, input) : course;
        const answer = roadmap === "missing" ? await completeAssistantAnswer(client, id, input) : roadmap;
        const outcome = answer === "missing" ? await completeKnowledgeEmbedding(client, id, input) : answer;
        if (outcome !== "ok") throw new WorkerError("job_expired", 409);
        await client.query("COMMIT");
        res.json({ ok: true });
        return;
      }
      if (job.status !== "processing" || job.lease_token !== input.leaseToken || job.valid !== true) {
        throw new WorkerError("job_expired", 409);
      }

      let errorCode: string | null = "error" in input ? input.error : null;
      let output: unknown = null;
      const retried = typeof job.ai_input?.retryNote === "string";
      let repaired = 0;
      if (!("error" in input)) {
        const context = job.ai_input ? validationContextFromAiInput({ schema: job.ai_input.schema, user: job.ai_input.user, checks: job.ai_input.checks }) : null;
        const checked = context ? validateAiOutput(input.output, context) : null;
        let accepted = checked?.ok ? checked.output : null;
        if (context && checked && !checked.ok && checked.problems && checked.output) {
          // comp-v13 (user review 2026-10-30): a comment whose schema holds is asked for once more with what was wrong;
          // after that the sentences and items at fault are dropped instead of failing the whole comment.
          if (!retried) {
            await client.query(
              `UPDATE stu_comp_ai_jobs SET status='queued',lease_token=NULL,lease_until=NULL,ai_input=ai_input||jsonb_build_object('retryNote',$2::text),updated_at=now() WHERE id=$1`,
              [id, retryNote(checked.problems, checked.output, context)]);
            await client.query("COMMIT");
            res.json({ ok: true });
            return;
          }
          accepted = repairAiOutput(checked.output, context);
          if (accepted) repaired = checked.problems.length;
        }
        if (accepted) {
          // Keys the model wrote into prose are replaced by names before storing (comp-v3).
          const names = await client.query<{ skills: unknown; groups: unknown }>(
            `SELECT computed->'skillDirectory' AS skills,computed->'groups' AS groups FROM stu_comp_assessments WHERE id=$1 AND user_id=$2`,
            [job.assessment_id, job.user_id]);
          const row = names.rows[0];
          output = cleanAiOutputKeys(accepted, keyNamesFrom(row?.skills, row?.groups));
        } else errorCode = "invalid_ai_output";
      }
      const promptVersion = typeof job.ai_input?.promptVersion === "string" ? job.ai_input.promptVersion : null;
      if (errorCode === null && !("error" in input)) {
        await client.query(
          `UPDATE stu_comp_assessments SET ai_status='completed',ai_output=$3::jsonb,ai_model=$4,ai_model_digest=$5,ollama_version=$6,
            prompt_version=$7,ai_error_code=NULL,ai_completed_at=now() WHERE id=$1 AND user_id=$2`,
          [job.assessment_id, job.user_id, JSON.stringify(output), input.model, input.digest || null, input.ollamaVersion || null, promptVersion]);
        // The comment comes minutes after the assessment: the bell tells the student (2026-10-30, STU-PROG-04).
        await notifyInTransaction(client, job.user_id, { ...assessmentComment(), sourceKey: `assessment:${job.assessment_id}` });
      } else {
        await client.query(
          `UPDATE stu_comp_assessments SET ai_status='failed',ai_error_code=$3,ai_output=NULL WHERE id=$1 AND user_id=$2`,
          [job.assessment_id, job.user_id, errorCode]);
      }
      await client.query(
        `UPDATE stu_comp_ai_jobs SET status=$2,error_code=$3,metrics=$4::jsonb,ai_input=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,
        [id, errorCode ? "failed" : "completed", errorCode,
          "metrics" in input ? JSON.stringify({ ...input.metrics, ...(retried ? { retried: true } : {}), ...(repaired ? { repairedProblems: repaired } : {}) }) : null]);
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof WorkerError) { res.status(error.status).json({ error: error.code }); return; }
    const type = (error as { type?: unknown } | null)?.type;
    if (type === "entity.too.large") { res.status(413).json({ error: "payload_too_large" }); return; }
    if (type === "entity.parse.failed") { res.status(400).json({ error: "invalid_json" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
