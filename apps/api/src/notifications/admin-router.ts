// Faculty announcements (AD-NOTI-01 "Gửi thông báo cho sinh viên", AD-NOTI-02 "Xem thông báo đã gửi"), mounted at
// /api/admin/announcements (contract: apps/web/src/notification-types.ts). An announcement reaches the active student
// accounts of the chosen cohorts and majors (none chosen: every student) as a notification in their bell; email later.
import { Router, type ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { adminRoles, type AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { requireAdminAccess } from "../middleware/authorization.js";
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, isPortalPage, type AnnouncementRow, type AnnouncementTarget } from "./model.js";
import {
  ANNOUNCEMENT_SORT, announcementOptions, listAnnouncements, reachCount, sendAnnouncement, targetLabel, withdrawAnnouncement,
} from "./repository.js";

class AnnouncementError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const id = z.guid();
const cohort = z.string().regex(/^K\d{1,3}$/);
const major = z.string().regex(/^\d{7}$/);
/** "K29,K30" in a query string. */
const list = (item: z.ZodString) => z.string().max(400).optional()
  .transform((value) => (value ? value.split(",").map((part) => part.trim()).filter(Boolean) : []))
  .pipe(z.array(item).max(30));
const reachQuery = z.object({ cohorts: list(cohort), majors: list(major) }).strict();
const sortKeys = Object.keys(ANNOUNCEMENT_SORT) as [string, ...string[]];
const listQuery = z.object({
  sort: z.enum(["stt", ...sortKeys]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  /** The contract's name for dir. */
  order: z.enum(["asc", "desc"]).optional(),
}).strict();
const sendBody = z.object({
  title: z.string().max(ANNOUNCEMENT_TITLE_MAX * 2),
  body: z.string().max(ANNOUNCEMENT_BODY_MAX * 2),
  link: z.string().max(40).nullable().optional(),
  cohorts: z.array(cohort).max(30).default([]),
  majors: z.array(major).max(10).default([]),
}).strict();

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
const unique = (values: readonly string[]) => [...new Set(values)].sort();
export const presentAnnouncement = (row: AnnouncementRow) => {
  const target: AnnouncementTarget = { cohorts: row.target?.cohorts ?? [], majors: row.target?.majors ?? [] };
  return {
    id: row.id, title: row.title, body: row.body, link: row.link, target, targetLabel: targetLabel(target),
    recipients: row.recipients, read: row.read ?? 0, createdAt: iso(row.createdAt)!, createdBy: row.createdBy ?? null, withdrawnAt: iso(row.withdrawnAt),
  };
};

/** The admin is still an active account of an admin role (as the other admin routers check). */
async function access(db: Pick<DatabasePool, "query"> | PoolClient, actor: AuthenticatedUser, lock = false) {
  const row = await db.query(
    `SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active AND COALESCE(role_override,role)=ANY($3::text[])${lock ? " FOR SHARE" : ""}`,
    [actor.userId, actor.tenantId, adminRoles]);
  if (!row.rowCount) throw new AnnouncementError("insufficient_role", 403);
}

export type AnnouncementsRouterOptions = {
  /** Staff mailbox domains (config.staffEmailDomains): such accounts never use the student portal, so they receive nothing. */
  staffEmailDomains?: ReadonlySet<string>;
};

export function createAnnouncementsRouter(pool: DatabasePool | undefined, webOrigin: string, options: AnnouncementsRouterOptions = {}) {
  const router = Router();
  const staff = [...(options.staffEmailDomains ?? [])].map((domain) => domain.toLowerCase());

  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(requireAdminAccess);
  router.use(async (req, res, next) => {
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    await access(pool, req.session.user!);
    next();
  });

  router.get("/", async (req, res) => {
    const query = listQuery.parse(req.query);
    const rows = await listAnnouncements(pool!, query.sort, query.dir ?? query.order);
    res.json({ items: rows.map(presentAnnouncement) });
  });

  router.get("/options", async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json(await announcementOptions(pool!, staff));
  });

  router.get("/reach", async (req, res) => {
    const query = reachQuery.parse(req.query);
    res.json({ count: await reachCount(pool!, { cohorts: unique(query.cohorts), majors: unique(query.majors) }, staff) });
  });

  router.post("/", async (req, res) => {
    const parsed = sendBody.safeParse(req.body ?? {});
    if (!parsed.success) throw new AnnouncementError("invalid_input", 400);
    const title = parsed.data.title.replace(/\s+/g, " ").trim();
    const body = parsed.data.body.replace(/\r\n?/g, "\n").trim();
    if (!title) throw new AnnouncementError("title_required", 400);
    if (!body) throw new AnnouncementError("body_required", 400);
    if (Array.from(title).length > ANNOUNCEMENT_TITLE_MAX || Array.from(body).length > ANNOUNCEMENT_BODY_MAX) throw new AnnouncementError("invalid_input", 400);
    const link = parsed.data.link?.trim() || null;
    if (link !== null && !isPortalPage(link)) throw new AnnouncementError("invalid_input", 400);
    const target = { cohorts: unique(parsed.data.cohorts), majors: unique(parsed.data.majors) };
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await access(client, req.session.user!, true);
      const sent = await sendAnnouncement(client, req.session.user!.userId, { title, body, link, target }, staff);
      if (!sent) throw new AnnouncementError("no_recipients", 400);
      await client.query("COMMIT");
      res.status(201).json({ announcement: presentAnnouncement(sent) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  router.post("/:id/withdraw", async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    const announcementId = id.parse(req.params.id);
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await access(client, req.session.user!, true);
      const outcome = await withdrawAnnouncement(client, announcementId);
      if (outcome === "missing") throw new AnnouncementError("not_found", 404);
      if (outcome === "withdrawn") throw new AnnouncementError("already_withdrawn", 409);
      await client.query("COMMIT");
      res.json({ announcement: presentAnnouncement(outcome) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  router.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AnnouncementError) { res.status(error.status).json({ error: error.code }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
