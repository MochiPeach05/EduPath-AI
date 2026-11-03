// Student API of the bell (STU-PROG-04…09), mounted at /api/student/notifications (contract:
// apps/web/src/notification-types.ts). The student reads, marks and deletes their own notifications only.
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { studentUser } from "../advisors/access.js";
import { LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, NOTIFICATION_ORDERS, presentNotification } from "./model.js";
import {
  createNotificationHousekeeping, deleteNotification, listNotifications, readAll, restoreNotification, setRead, unreadCount,
} from "./repository.js";

const id = z.guid();
const emptyBody = z.object({}).strict();
const listQuery = z.object({
  filter: z.enum(["all", "unread", "ai", "warn", "khoa", "sys"]).default("all"),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT),
  order: z.enum(NOTIFICATION_ORDERS).default("newest"),
}).strict();

class NotificationError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

export function createStudentNotificationsRouter(pool: DatabasePool | undefined, webOrigin: string) {
  const router = Router();
  // The bell polls the unread count about once a minute: the purge runs at most once an hour from there.
  const housekeeping = createNotificationHousekeeping();

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

  router.get("/", async (req, res) => {
    const query = listQuery.parse(req.query);
    const userId = studentUser(req).userId;
    const items = await listNotifications(pool!, userId, query.filter, query.limit, query.order);
    res.json({ items: items.map(presentNotification), unread: await unreadCount(pool!, userId) });
  });

  router.get("/unread-count", async (req, res) => {
    z.object({}).strict().parse(req.query);
    await housekeeping(pool!).catch(() => false);
    res.json({ unread: await unreadCount(pool!, studentUser(req).userId) });
  });

  router.post("/read-all", async (req, res) => {
    emptyBody.parse(req.body ?? {});
    await readAll(pool!, studentUser(req).userId);
    res.json({ unread: 0 });
  });

  for (const [path, read] of [["read", true], ["unread", false]] as const) {
    router.post(`/:id/${path}`, async (req, res) => {
      emptyBody.parse(req.body ?? {});
      const row = await setRead(pool!, studentUser(req).userId, id.parse(req.params.id), read);
      if (!row) throw new NotificationError("not_found", 404);
      res.json({ notification: presentNotification(row) });
    });
  }

  router.delete("/:id", async (req, res) => {
    if (!await deleteNotification(pool!, studentUser(req).userId, id.parse(req.params.id))) throw new NotificationError("not_found", 404);
    res.status(204).end();
  });

  router.post("/:id/restore", async (req, res) => {
    emptyBody.parse(req.body ?? {});
    const row = await restoreNotification(pool!, studentUser(req).userId, id.parse(req.params.id));
    if (!row) throw new NotificationError("not_found", 404);
    res.json({ notification: presentNotification(row) });
  });

  router.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof NotificationError) { res.status(error.status).json({ error: error.code }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
