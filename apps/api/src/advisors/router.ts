// Quản lý cố vấn học tập (AD-ADV-01…05; user 2026-11-03, migration 058; contract: apps/web/src/advisor-types.ts). Every
// account of the admin portal reads the list and the details (the "QTV & CVHT" rows of the function list); adding,
// editing, removing and importing advisors is for the admins and Ban chủ nhiệm khoa (canManageAdvisors), with the exact
// Origin of the web app like the other admin changes. An import is read and previewed first (POST /import/preview), then
// applied from the same file (POST /import); the template is GET /import/template.
import { Router, raw, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { canManageAdvisors } from "../auth/types.js";
import { requireAdminAccess } from "../middleware/authorization.js";
import { normalizeClassName } from "./access.js";
import { advisorTemplate, readAdvisorWorkbook } from "./import.js";
import { AdvisorError, CLASS_PATTERN } from "./model.js";
import { PostgresAdvisorRepository, type AdvisorRepository } from "./repository.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const text = (max: number) => z.string().transform((value) => value.replace(/\s+/g, " ").trim()).pipe(z.string().max(max));
const optionalText = (max: number) => z.union([text(max), z.null()]).optional().transform((value) => value || null);
/** Classes typed by hand: normalized like the import ("71k29cntt01" → "71K29CNTT01"), each once. */
const classList = z.array(z.string().max(60)).max(60).transform((values, context) => {
  const classes: string[] = [];
  for (const value of values) {
    const name = normalizeClassName(value);
    if (!name) continue;
    if (!CLASS_PATTERN.test(name)) { context.addIssue({ code: "custom", message: "invalid_class" }); return z.NEVER; }
    if (!classes.includes(name)) classes.push(name);
  }
  return classes;
});
const advisorInput = z.object({
  name: text(200),
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  staffCode: optionalText(50),
  unit: optionalText(200),
  classes: classList,
}).strict();
/** An edit: the email names the account and cannot change (the form shows it read only), so it is ignored. */
const advisorChange = advisorInput.omit({ email: true }).extend({ email: z.string().max(320).optional() }).strict();

/** The first failing rule of an advisor form, as an error code of ADVISOR_ERRORS (an email typed wrong is invalid_input). */
function inputError(error: z.ZodError, body: unknown): string {
  const issue = error.issues[0];
  const field = String(issue?.path[0] ?? "");
  const typed = body && typeof body === "object" ? (body as Record<string, unknown>)[field] : undefined;
  const blank = typeof typed !== "string" || !typed.trim();
  if (issue?.message === "invalid_class") return "invalid_class";
  if (field === "name") return "name_required";
  if (field === "email") return blank ? "email_required" : "invalid_input";
  if (field === "classes") return "classes_required";
  return "invalid_input";
}

export function createAdvisorsRouter(pool: DatabasePool | undefined, webOrigin: string, staffEmailDomains: ReadonlySet<string>,
  repository: AdvisorRepository | undefined = pool ? new PostgresAdvisorRepository(pool, staffEmailDomains) : undefined) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(requireAdminAccess);
  router.use(async (req, res, next) => {
    if (!repository) { res.status(503).json({ error: "database_required" }); return; }
    const write = !["GET", "HEAD"].includes(req.method);
    if (write && !canManageAdvisors(req.session.user!.role)) { res.status(403).json({ error: "insufficient_role" }); return; }
    if (write && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    await repository.access(req.session.user!, write);
    next();
  });
  const id = (value: unknown) => {
    const parsed = z.guid().safeParse(value);
    if (!parsed.success) throw new AdvisorError("advisor_not_found", 404);
    return parsed.data;
  };
  const input = <T extends { name: string; classes: string[] }>(schema: z.ZodType<T>, body: unknown): T => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new AdvisorError(inputError(parsed.error, body), 400);
    if (!parsed.data.name) throw new AdvisorError("name_required", 400);
    if (!parsed.data.classes.length) throw new AdvisorError("classes_required", 400);
    return parsed.data;
  };
  const upload = raw({ type: XLSX, limit: "5mb" });
  const workbook = (body: unknown) => {
    if (!Buffer.isBuffer(body) || !body.length) throw new AdvisorError("invalid_workbook", 400);
    return body;
  };
  const fileName = (header: string | undefined) => {
    let name = "co-van-hoc-tap.xlsx";
    try { name = decodeURIComponent(header ?? name); } catch { throw new AdvisorError("invalid_filename", 400); }
    if (!/\.xlsx$/i.test(name) || name.length > 240 || /[\x00-\x1f/\\]/.test(name)) throw new AdvisorError("invalid_filename", 400);
    return name;
  };

  router.get("/", async (req, res) => {
    // sort: a column of the list (repository.ts advisorSort); an unknown one keeps the list's own order.
    const query = z.object({ q: z.string().trim().max(120).default(""), sort: z.string().trim().max(40).optional(), dir: z.enum(["asc", "desc"]).optional() })
      .strict().safeParse(req.query);
    if (!query.success) { res.status(400).json({ error: "invalid_query" }); return; }
    res.json({ items: await repository!.list(query.data) });
  });
  router.get("/import/template", async (_req, res) => {
    const domain = [...staffEmailDomains][0] ?? "vlu.edu.vn";
    res.type(XLSX).attachment("mau-danh-sach-co-van-hoc-tap.xlsx").send(await advisorTemplate(domain));
  });
  router.get("/:id", async (req, res) => {
    res.json({ advisor: await repository!.detail(id(req.params.id)) });
  });
  router.post("/import/preview", upload, async (req, res) => {
    const name = fileName(req.get("x-filename"));
    res.json(await repository!.preview(req.session.user!, name, await readAdvisorWorkbook(workbook(req.body))));
  });
  router.post("/import", upload, async (req, res) => {
    const name = fileName(req.get("x-filename"));
    res.json(await repository!.apply(req.session.user!, name, await readAdvisorWorkbook(workbook(req.body))));
  });
  router.post("/", async (req, res) => {
    res.status(201).json({ advisor: await repository!.create(req.session.user!, input(advisorInput, req.body)) });
  });
  router.put("/:id", async (req, res) => {
    const advisorId = id(req.params.id);
    const { email: _email, ...change } = input(advisorChange, req.body);
    res.json({ advisor: await repository!.update(req.session.user!, advisorId, change) });
  });
  router.delete("/:id", async (req, res) => {
    await repository!.remove(req.session.user!, id(req.params.id));
    res.json({ ok: true });
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AdvisorError) { res.status(error.status).json({ error: error.code, ...error.details }); return; }
    if (error?.type === "entity.too.large") { res.status(413).json({ error: "workbook_too_large" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
