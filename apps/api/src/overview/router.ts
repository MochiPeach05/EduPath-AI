// GET /api/student/overview (Tổng quan, STU-PROG-01…03, 2026-10-30): the student dashboard in one read-only snapshot.
// Contract: apps/web/src/overview-types.ts. Errors: 401, 403 account_unavailable, 400 invalid_input, 503 database_required.
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { snapshotReads, type ReferenceCache } from "../db/reference-cache.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { studentAccountChecked, studentUser } from "../advisors/access.js";
import { notifyWarnings } from "../notifications/notify.js";
import { readOverview } from "./overview.js";
import type { OverviewResponse } from "./types.js";

/**
 * The "Cần chú ý" warnings become notifications of the bell, each one once (notifications/notify.ts notifyWarnings,
 * keyed by the warning's kind and key): after a transcript import (app.ts afterTranscriptImport) and whenever Tổng quan
 * is read. Best effort: a failure is logged with its name only, never thrown.
 */
export async function refreshWarningNotifications(pool: DatabasePool, userId: string, now: Date = new Date(), overview?: OverviewResponse): Promise<void> {
  try {
    let current = overview;
    if (!current) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        current = await readOverview(client, userId, now);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    await notifyWarnings(pool, userId, current.warnings.items);
  } catch (error) {
    console.error(`[overview] warning notifications not written (${error instanceof Error ? error.name : "error"})`);
  }
}

export function createOverviewRouter(pool: DatabasePool | undefined, options: { now?: () => Date; reference?: ReferenceCache } = {}) {
  const router = Router();
  const now = options.now ?? (() => new Date());
  router.use(requireAuthentication);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    const user = studentUser(req);
    if (!studentAccountChecked(req, res)) {
      const active = await pool.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active", [user.userId, user.tenantId]);
      if (!active.rowCount) { res.status(403).json({ error: "account_unavailable" }); return; }
    }
    next();
  });

  router.get("/", async (req, res) => {
    z.object({}).strict().parse(req.query);
    // The CTĐT, KHĐT, standards and skill configuration from the shared reference cache, and each other read once in the
    // snapshot (db/reference-cache.ts, 2026-11-10: 45 round trips to the database a request); the reader comes first.
    const reader = options.reference?.reader();
    const client = await pool!.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      // readOverview and every part of it only call query() (checked 2026-11-10).
      const overview = await readOverview(snapshotReads(client, reader) as PoolClient, studentUser(req).userId, now());
      await client.query("COMMIT");
      res.json(overview);
      void refreshWarningNotifications(pool!, studentUser(req).userId, now(), overview);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
