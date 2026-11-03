import { randomUUID } from "node:crypto";
import express, { Router, type ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { studentUser } from "../advisors/access.js";
import { readStudyPlanFacts, type StudyPlanFacts } from "./context.js";
import { studyPlanSchema, type StudyPlanData } from "./model.js";
import { prefillPlan, readAiPlan } from "./prefill.js";
import { projectGraduation } from "./projection.js";

class StudyPlanError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}
type Saved = { version: string; data: StudyPlanData; updatedAt: string };

async function inTransaction<T>(pool: DatabasePool, readOnly: boolean, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
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

async function readSaved(db: Pick<PoolClient, "query">, userId: string, lock = false): Promise<Saved | null> {
  const row = (await db.query<{ version: string; data: unknown; updated_at: Date | string }>(
    `SELECT version,data,updated_at FROM stu_study_plans WHERE user_id=$1${lock ? " FOR UPDATE" : ""}`, [userId])).rows[0];
  if (!row) return null;
  // A stored plan that no longer matches the schema reads as empty rather than breaking the page.
  const parsed = studyPlanSchema.safeParse(row.data);
  return { version: row.version, data: parsed.success ? parsed.data : { schemaVersion: 1, terms: [] }, updatedAt: new Date(row.updated_at).toISOString() };
}

/**
 * What the page receives: the context (no transcript, no standard data), the saved plan, the plan a student without one
 * starts from (the training plan's mandatory courses ahead), the AI roadmap's proposal not taken in yet, its improvement
 * courses (only suggested, never added), and the projection of the plan in use.
 */
async function view(db: Pick<PoolClient, "query">, userId: string, facts: StudyPlanFacts, plan: Saved | null) {
  const suggested = plan ? null : prefillPlan(facts.context);
  const ai = await readAiPlan(db, userId, facts.context, plan?.data.roadmapId ?? null);
  return {
    context: facts.context,
    plan,
    suggested,
    aiProposal: ai.proposal,
    aiSuggestions: ai.suggestions,
    projection: projectGraduation(facts, plan?.data ?? suggested ?? { schemaVersion: 1, terms: [] }),
  };
}

/**
 * "Lộ trình học tập" API (user 2026-10-24, after Stellic), mounted at /api/student/study-plan: what "Theo dõi tiến độ" and
 * "Lên kế hoạch (thủ công)" show, and the manual plan itself (one per student, migration 046).
 */
export function createStudyPlanRouter(pool: DatabasePool | undefined, webOrigin: string, options: { now?: () => Date } = {}) {
  const router = Router();
  const now = options.now ?? (() => new Date());
  router.use(requireAuthentication);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    const user = studentUser(req);
    const active = await pool.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active", [user.userId, user.tenantId]);
    if (!active.rowCount) { res.status(403).json({ error: "account_unavailable" }); return; }
    next();
  });
  router.use(express.json({ limit: "256kb" }));

  router.get("/", async (req, res) => {
    const userId = studentUser(req).userId;
    res.json(await inTransaction(pool!, true, async (client) => view(client, userId, await readStudyPlanFacts(client, userId, now()), await readSaved(client, userId))));
  });

  /** Saves the whole plan; `version` is the one the page loaded (null for the first save), else 409 plan_changed. */
  router.put("/", async (req, res) => {
    const input = z.object({ version: z.uuid().nullable(), data: studyPlanSchema }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid_plan" }); return; }
    const userId = studentUser(req).userId;
    res.json(await inTransaction(pool!, false, async (client) => {
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      const current = await readSaved(client, userId, true);
      if ((current?.version ?? null) !== input.data.version) throw new StudyPlanError("plan_changed", 409);
      const row = (await client.query<{ version: string; updated_at: Date }>(
        `INSERT INTO stu_study_plans(user_id,version,data) VALUES($1,$2,$3::jsonb)
         ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,data=EXCLUDED.data,updated_at=now() RETURNING version,updated_at`,
        [userId, randomUUID(), JSON.stringify(input.data.data)])).rows[0]!;
      const saved: Saved = { version: row.version, data: input.data.data, updatedAt: new Date(row.updated_at).toISOString() };
      return { plan: saved, projection: projectGraduation(await readStudyPlanFacts(client, userId, now()), saved.data) };
    }));
  });

  router.delete("/", async (req, res) => {
    const input = z.object({ version: z.uuid() }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid_input" }); return; }
    const userId = studentUser(req).userId;
    await inTransaction(pool!, false, async (client) => {
      const deleted = await client.query("DELETE FROM stu_study_plans WHERE user_id=$1 AND version=$2", [userId, input.data.version]);
      if (!deleted.rowCount) throw new StudyPlanError("plan_changed", 409);
    });
    res.json({ plan: null });
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof StudyPlanError) { res.status(error.status).json({ error: error.code }); return; }
    if (error?.type === "entity.too.large") { res.status(413).json({ error: "plan_too_large" }); return; }
    if (error?.type === "entity.parse.failed") { res.status(400).json({ error: "invalid_plan" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
