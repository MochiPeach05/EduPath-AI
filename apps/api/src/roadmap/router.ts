// Student API of the study roadmap, mounted at /api/student/roadmap. GET / reads the newest roadmap with the newest
// competency assessment (a roadmap built from an older one is "stale"), GET /status is the cheap poll while the AI
// writes, POST / creates one ("Tạo lộ trình", "Tạo lại"). No consent header: a roadmap is built only from an
// assessment and a profile survey the student already consented to, and goes with them.
import { Router, type ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { WORKER_ONLINE_SECONDS } from "../competency-assessment/ai/queue.js";
import { STUDY_ROADMAP_KIND } from "../competency-assessment/ai/worker-protocol.js";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { activeConsentVersion, isValidConsent } from "../student/consent.js";
import { readSurvey } from "../student/survey.js";
import { createRoadmap, createRoadmapExpiry, newestAssessmentInfo, readNewestRoadmap, RoadmapError, type RoadmapStatus } from "./jobs.js";
import { presentRoadmap } from "./present.js";
import { roadmapWindow, vietnamToday } from "./window.js";

type RoadmapRouterOptions = {
  /** AI_WORKER_KEY is configured; otherwise nothing is queued. */
  enabled: boolean;
};

const emptyObject = z.object({}).strict();
const iso = (value: Date | string) => new Date(value).toISOString();
/** Today in Vietnam time ("YYYY-MM-DD"), the calendar of the roadmap window (no longer its start: a window is a coming term). */
const today = () => vietnamToday(new Date());
/** The term a roadmap made now would cover, shown before one exists and in the "Tạo lại" notes. */
function upcomingTerm() {
  const window = roadmapWindow(new Date());
  return { term: window.term ?? null, start: window.start, end: window.end };
}

async function inTransaction<T>(pool: DatabasePool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createRoadmapRouter(pool: DatabasePool | undefined, webOrigin: string, options: RoadmapRouterOptions) {
  const router = Router();
  const { enabled } = options;
  // Stuck jobs also expire while the worker is offline (rate-limited to once per 60 s); a failed expiry never breaks a read.
  const expire = createRoadmapExpiry();
  const expireQuietly = () => expire(pool!).catch(() => false);

  const workerStatus = async (): Promise<{ online: boolean; supportsRoadmap: boolean }> => {
    if (!enabled) return { online: false, supportsRoadmap: false };
    const status = await pool!.query<{ online: boolean; kinds: string[] | null }>(
      "SELECT seen_at>now()-make_interval(secs => $1) AS online,kinds FROM stu_comp_ai_worker_status WHERE id=1", [WORKER_ONLINE_SECONDS]);
    const row = status.rows[0];
    const online = row?.online === true;
    return { online, supportsRoadmap: online && (row?.kinds ?? []).includes(STUDY_ROADMAP_KIND) };
  };

  router.use(requireAuthentication);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    const user = req.session.user!;
    const active = await pool.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active", [user.userId, user.tenantId]);
    if (!active.rowCount) { res.status(403).json({ error: "account_unavailable" }); return; }
    next();
  });

  router.get("/", async (req, res) => {
    emptyObject.parse(req.query);
    const userId = req.session.user!.userId;
    await expireQuietly();
    const client = await pool!.connect();
    let row: Awaited<ReturnType<typeof readNewestRoadmap>>;
    let assessment: Awaited<ReturnType<typeof newestAssessmentInfo>>;
    let survey: Awaited<ReturnType<typeof readSurvey>>;
    let surveyConsent: string | null;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      assessment = await newestAssessmentInfo(client, userId);
      row = await readNewestRoadmap(client, userId);
      survey = await readSurvey(client, userId);
      surveyConsent = await activeConsentVersion(client, userId, "profile_survey");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    res.json({
      roadmap: row && presentRoadmap(row, today()),
      assessment: assessment && { id: assessment.id, createdAt: iso(assessment.createdAt), hasCareer: assessment.hasCareer === true },
      stale: Boolean(row && assessment && row.assessmentId !== assessment.id),
      // A new roadmap needs the answered profile survey, agreed to under the current policy.
      surveyDone: survey?.complete === true && isValidConsent(surveyConsent),
      aiEnabled: enabled,
      worker: await workerStatus(),
      upcoming: upcomingTerm(),
    });
  });

  // Cheap poll (every few seconds while queued/processing): the student's newest row.
  router.get("/status", async (req, res) => {
    emptyObject.parse(req.query);
    await expireQuietly();
    const found = await pool!.query<{ id: string; status: RoadmapStatus; errorCode: string | null }>(
      `SELECT id,status,error_code AS "errorCode" FROM stu_roadmaps WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,
      [req.session.user!.userId]);
    const row = found.rows[0];
    res.json({ id: row?.id ?? null, status: row?.status ?? null, errorCode: row?.errorCode ?? null, worker: await workerStatus() });
  });

  router.post("/", async (req, res) => {
    if (!emptyObject.safeParse(req.body ?? {}).success) { res.status(400).json({ error: "invalid_input" }); return; }
    if (!enabled) { res.status(409).json({ error: "ai_disabled" }); return; }
    const outcome = await inTransaction(pool!, (client) => createRoadmap(client, req.session.user!.userId, { expire }));
    res.status(outcome.created ? 201 : 200).json({ roadmap: presentRoadmap(outcome.row, today()) });
  });

  router.use((_req, res) => { res.status(404).json({ error: "not_found" }); });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof RoadmapError) { res.status(error.status).json({ error: error.code }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
