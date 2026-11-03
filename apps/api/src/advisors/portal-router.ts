// Quản lý sinh viên of a cố vấn học tập (AD-AST-01…05, 09; user 2026-11-03, migration 058; contract:
// apps/web/src/advisor-types.ts). The signed-in account sees its own classes and their students (any admin-portal account
// the Khoa gave classes; the others get empty lists), and admins and Ban chủ nhiệm khoa every class and every student
// (AD-AST "QTV & CVHT"): GET /me, /classes, /students, /permissions. Opening a student's page (POST /students/:id/open)
// checks the student again, is logged (kind 'advisor') and answers the link of the student portal tab, where
// advisors/access.ts checks every request once more.
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAdminAccess } from "../middleware/authorization.js";
import { normalizeClassName } from "./access.js";
import { ADVISOR_PERMISSIONS } from "./permissions.js";
import { ADVISED_STUDENT_STATUSES, AdvisorError } from "./model.js";
import { PostgresAdvisorRepository, type AdvisorRepository } from "./repository.js";

export function createAdvisorPortalRouter(pool: DatabasePool | undefined, webOrigin: string,
  repository: AdvisorRepository | undefined = pool ? new PostgresAdvisorRepository(pool, new Set()) : undefined) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(requireAdminAccess);
  router.use(async (req, res, next) => {
    if (!repository) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    await repository.access(req.session.user!);
    next();
  });

  router.get("/me", async (req, res) => {
    res.json(await repository!.me(req.session.user!));
  });
  router.get("/classes", async (req, res) => {
    res.json({ items: await repository!.classes(req.session.user!) });
  });
  router.get("/students", async (req, res) => {
    const query = z.object({
      class: z.string().trim().max(60).transform(normalizeClassName).optional(),
      q: z.string().trim().max(120).default(""),
      status: z.enum(ADVISED_STUDENT_STATUSES).default("all"),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(10),
      // Any field name of the list; one it cannot sort by keeps the list's own order (repository.ts studentSort).
      sort: z.string().trim().max(40).optional(),
      dir: z.enum(["asc", "desc"]).optional(),
    }).strict().safeParse(req.query);
    if (!query.success) { res.status(400).json({ error: "invalid_query" }); return; }
    const { class: className, ...rest } = query.data;
    const page = await repository!.students(req.session.user!, { ...rest, className: className || undefined });
    res.json({ ...page, page: rest.page, pageSize: rest.pageSize });
  });
  router.get("/permissions", (_req, res) => {
    res.json(ADVISOR_PERMISSIONS);
  });
  router.post("/students/:id/open", async (req, res) => {
    const id = z.guid().safeParse(req.params.id);
    if (!id.success) throw new AdvisorError("student_not_advised", 403);
    res.json(await repository!.open(req.session.user!, id.data, req.originalUrl.split("?")[0] ?? ""));
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AdvisorError) { res.status(error.status).json({ error: error.code, ...error.details }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
