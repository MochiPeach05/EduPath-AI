// Nhật ký thao tác (AD-REPORT-12): GET /api/admin/audit-log, newest first, for every admin role. Rows older than one
// year are deleted when the log is read, at most once an hour.
import { Router } from "express";
import { z } from "zod";
import { adminRoles } from "../../auth/types.js";
import type { DatabasePool } from "../../db/pool.js";
import { requireAdminAccess } from "../../middleware/authorization.js";
import type { AuditEntry, AuditKind, AuditPage } from "../reports/types.js";
import { AUDIT_KINDS, foldText } from "./record.js";
import { roleLabel } from "./routes.js";

const RETENTION_CHECK_MS = 60 * 60 * 1000;

type Row = { id: string; at: string | Date; actorName: string; actorRole: string | null; kind: AuditKind; action: string; summary: string };

export function createAuditLogRouter(pool: Pick<DatabasePool, "query"> | undefined, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let lastCleanup = Number.NEGATIVE_INFINITY;
  const router = Router();
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  router.use(requireAdminAccess);
  // The session's role is checked again against the account now (a role taken away ends access at once).
  router.use(async (request, response, next) => {
    if (!pool) { response.status(503).json({ error: "database_required" }); return; }
    const actor = request.session.user!;
    const found = await pool.query(`SELECT 1 FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active
      AND COALESCE(role_override, role)=ANY($3::text[])`, [actor.userId, actor.tenantId, adminRoles]);
    if (!found.rowCount) { response.status(403).json({ error: "insufficient_role" }); return; }
    next();
  });

  router.get("/", async (request, response) => {
    const input = z.object({
      q: z.string().trim().max(120).default(""),
      kind: z.enum(AUDIT_KINDS).optional(),
      actor: z.string().trim().max(200).optional(),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      sort: z.enum(["at", "actor", "kind"]).optional(),
      dir: z.enum(["asc", "desc"]).optional(),
    }).strict().safeParse(request.query);
    if (!input.success) { response.status(400).json({ error: "invalid_query" }); return; }
    const { q, kind, actor, page, pageSize, sort, dir } = input.data;
    // Sortable headers like every admin table (admin/table-sort.ts); newest first breaks ties. Keys are whitelisted above.
    const column = sort === "actor" ? '"actorName"' : sort === "kind" ? "kind" : "at";
    const order = column === "at" ? `at ${dir === "asc" ? "ASC" : "DESC"}, id ${dir === "asc" ? "ASC" : "DESC"}` : `${column} ${dir === "asc" ? "ASC" : "DESC"}, at DESC, id DESC`;
    if (now() - lastCleanup >= RETENTION_CHECK_MS) {
      lastCleanup = now();
      await pool!.query("DELETE FROM ad_audit_log WHERE created_at < now() - interval '1 year'");
    }
    const result = await pool!.query<{ items: Row[]; total: number; actors: string[] }>(`WITH filtered AS (
        SELECT id, created_at AS at, actor_name AS "actorName", actor_role AS "actorRole", kind, action, summary FROM ad_audit_log
        WHERE ($1 = '' OR strpos(search_text, $1) > 0) AND ($2::text IS NULL OR kind = $2) AND ($3::text IS NULL OR actor_name = $3)
      ), paged AS (SELECT * FROM filtered ORDER BY ${order} LIMIT $4 OFFSET $5)
      SELECT COALESCE((SELECT json_agg(paged ORDER BY ${order}) FROM paged), '[]'::json) AS items,
        (SELECT count(*)::int FROM filtered) AS total,
        COALESCE((SELECT json_agg(name ORDER BY name) FROM (SELECT DISTINCT actor_name AS name FROM ad_audit_log) names), '[]'::json) AS actors`,
    [foldText(q), kind ?? null, actor || null, pageSize, (page - 1) * pageSize]);
    const row = result.rows[0] ?? { items: [], total: 0, actors: [] };
    const items: AuditEntry[] = row.items.map((item) => ({
      id: item.id, at: new Date(item.at).toISOString(), actorName: item.actorName, actorRole: item.actorRole ? roleLabel(item.actorRole) : null,
      kind: item.kind, action: item.action, summary: item.summary,
    }));
    const body: AuditPage = { items, total: row.total, page, pageSize, actors: row.actors };
    response.json(body);
  });
  return router;
}
