// Thống kê của cổng quản trị (AD-REPORT-01…10, 2026-10-31): GET /api/admin/reports/*. Every active admin role reads and
// exports everything, students by name included (user: "hiện đầy đủ", "mọi quản trị viên"); a cố vấn học tập reads and
// exports the same pages over the students of the classes they advise (user 2026-11-07: "cho CVHT xem nữa"; privacy policy
// 2026-11-03). Every Excel export is written to the Nhật ký thao tác. The rows come from the cached source (cache.ts),
// the answers from aggregate.ts.
import { Router } from "express";
import { z } from "zod";
import { advisedStudentIds, advisorClassesOf } from "../../advisors/access.js";
import { adminRoles, type AuthenticatedUser } from "../../auth/types.js";
import { SPECIALTIES } from "../../competency-assessment/specialty.js";
import { MAJORS } from "../../curricula/majors.js";
import type { DatabasePool } from "../../db/pool.js";
import { requireAdminAccess } from "../../middleware/authorization.js";
import { recordAudit } from "../audit/record.js";
import {
  careersReport, courseStudents, coursesReport, dashboardReport, filterRows, type Filters, PROGRESS_SORTS, progressReport, progressRows, reportOptions,
  RISK_LABELS, RISK_SORTS, riskReport, riskRows, skillsReport, skillStudents,
} from "./aggregate.js";
import type { RiskKind } from "./types.js";
import { createReportRowSource, type ReportRowSource } from "./cache.js";
import { progressWorkbook, riskWorkbook, skillsWorkbook, STATUS_LABELS, vietnamDate } from "./excel.js";

export type ReportsRouterOptions = {
  /** The student rows; the database-backed cache by default (tests pass a fake). */
  source?: ReportRowSource;
  now?: () => Date;
  /** Fill the cache this long after start so the first report opens warm; null turns it off. Default 60 s. */
  warmUpAfterMs?: number | null;
};

const empty = (value: unknown) => (value === "" ? undefined : value);
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(empty, schema.optional());
const specialtyCodes = SPECIALTIES.map((item) => item.code) as [string, ...string[]];
const filterShape = {
  cohort: optional(z.string().trim().toUpperCase().regex(/^K[0-9]{2,3}$/)),
  major: optional(z.string().trim().regex(/^[0-9]{7}$/)),
  specialty: optional(z.enum(specialtyCodes)),
  q: optional(z.string().trim().max(120)),
};
const pageShape = {
  dir: optional(z.enum(["asc", "desc"])),
  page: optional(z.coerce.number().int().min(1).max(100000)),
  pageSize: optional(z.coerce.number().int().min(1).max(100)),
};
const filtersQuery = z.object(filterShape).strict();
const progressQuery = z.object({ ...filterShape, ...pageShape, status: optional(z.enum(["on_track", "late", "unknown", "no_transcript"])), sort: optional(z.enum(PROGRESS_SORTS)) }).strict();
const riskKinds = ["failed_course", "pace", "gpa_below", "late_course", "elective_short"] as const satisfies readonly RiskKind[];
const riskQuery = z.object({
  ...filterShape, ...pageShape, level: optional(z.enum(["risk", "warn"])), kind: optional(z.enum(riskKinds)), sort: optional(z.enum(RISK_SORTS)),
}).strict();
const skillsQuery = z.object({ ...filterShape, career: optional(z.string().trim().min(1).max(200)) }).strict();
const skillStudentsQuery = z.object({ ...filterShape, career: optional(z.string().trim().min(1).max(200)), skill: z.string().trim().min(1).max(200) }).strict();
const courseStudentsQuery = z.object({ ...filterShape, code: z.string().trim().min(1).max(32) }).strict();

/** The filters in words, for the Excel notes and the log: ["khóa K29", "ngành Công nghệ thông tin", …]. */
export function filterWords(query: Filters & { status?: string | undefined; level?: string | undefined; kind?: RiskKind | undefined; career?: string | undefined }): string[] {
  const words: string[] = [];
  if (query.cohort) words.push(`khóa ${query.cohort}`);
  if (query.major) words.push(`ngành ${MAJORS.find((major) => major.code === query.major)?.label ?? query.major}`);
  if (query.specialty) words.push(`chuyên ngành ${SPECIALTIES.find((item) => item.code === query.specialty)?.label ?? query.specialty}`);
  if (query.status) words.push(`tình trạng ${STATUS_LABELS[query.status as keyof typeof STATUS_LABELS] ?? query.status}`);
  if (query.level) words.push(query.level === "risk" ? "mức Nguy cơ" : "mức Cần chú ý");
  if (query.kind) words.push(`lý do ${RISK_LABELS[query.kind]}`);
  if (query.career) words.push(`vị trí nghề nghiệp ${query.career}`);
  if (query.q) words.push(`tìm "${query.q}"`);
  return words;
}

/** The admin is still an active account of an admin role (as the other admin routers check). */
async function isActiveAdmin(pool: Pick<DatabasePool, "query">, actor: AuthenticatedUser): Promise<boolean> {
  const row = await pool.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active AND COALESCE(role_override,role)=ANY($3::text[])",
    [actor.userId, actor.tenantId, adminRoles]);
  return Boolean(row.rowCount);
}

export function createReportsRouter(pool: DatabasePool | undefined, options: ReportsRouterOptions = {}) {
  const router = Router();
  const now = options.now ?? (() => new Date());
  const built = !options.source && pool ? createReportRowSource(pool) : undefined;
  const source = options.source ?? built;
  if (built && options.warmUpAfterMs !== null) setTimeout(() => { void built.warm(); }, options.warmUpAfterMs ?? 60_000).unref();

  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(requireAdminAccess);
  router.use(async (req, res, next) => {
    if (!pool || !source) { res.status(503).json({ error: "database_required" }); return; }
    if (!await isActiveAdmin(pool, req.session.user!)) { res.status(403).json({ error: "insufficient_role" }); return; }
    next();
  });

  const parse = <T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> | null => {
    const result = schema.safeParse(query);
    return result.success ? result.data : null;
  };
  const invalid = (res: import("express").Response) => res.status(400).json({ error: "invalid_query" });
  const actorOf = (user: AuthenticatedUser) => ({ userId: user.userId, name: user.name, role: user.role });
  const sendWorkbook = (res: import("express").Response, file: string, body: Buffer) => {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${file}"; filename*=UTF-8''${encodeURIComponent(file)}`);
    res.send(body);
  };
  const filtersOf = (query: Filters): Filters => ({ cohort: query.cohort, major: query.major, specialty: query.specialty, q: query.q });
  /** A cố vấn học tập's classes and students; null for the other admin roles, who read every student. */
  const scopeOf = async (user: AuthenticatedUser): Promise<{ classes: string[]; students: ReadonlySet<string> } | null> => {
    if (user.role !== "advisor") return null;
    const [classes, students] = await Promise.all([advisorClassesOf(pool!, user.userId), advisedStudentIds(pool!, user.userId)]);
    return { classes, students };
  };
  /** The cached rows the account may count: an advisor's own students only. */
  const rowsOf = async (req: import("express").Request, at: Date) => {
    const [{ rows, generatedAt }, scope] = await Promise.all([source!.rows(at), scopeOf(req.session.user!)]);
    return { rows: scope ? rows.filter((row) => scope.students.has(row.userId)) : rows, generatedAt, scope };
  };
  /** The scope in words for the Excel notes and the log: ["lớp 71K29CNTT08, 71K29CNTT09"] for an advisor. */
  const scopeWords = (scope: { classes: string[] } | null) =>
    scope ? [scope.classes.length ? `lớp ${scope.classes.join(", ")}` : "chưa phụ trách lớp nào"] : [];

  router.get("/options", async (req, res) => {
    if (!parse(z.object({}).strict(), req.query)) { invalid(res); return; }
    const at = now();
    if (req.session.user!.role === "advisor") {
      // The cohorts of the advisor's own students, and which classes the numbers cover.
      const { rows, scope } = await rowsOf(req, at);
      res.json({ ...reportOptions(rows.map((row) => row.cohort), at), scope: { classes: scope?.classes ?? [] } });
      return;
    }
    const cohorts = await pool!.query<{ cohort: string | null }>(`SELECT DISTINCT p.cohort_code AS cohort FROM users u JOIN student_profiles p ON p.user_id=u.id
      WHERE (COALESCE(u.role_override,u.role)='student' OR u.is_student) AND NULLIF(btrim(p.cohort_code),'') IS NOT NULL`);
    res.json({ ...reportOptions(cohorts.rows.map((row) => row.cohort), at), scope: null });
  });

  router.get("/dashboard", async (req, res) => {
    const query = parse(filtersQuery, req.query);
    if (!query) { invalid(res); return; }
    const at = now();
    const { rows, generatedAt } = await rowsOf(req, at);
    res.json(dashboardReport(rows, query, generatedAt, at));
  });

  router.get("/progress", async (req, res) => {
    const query = parse(progressQuery, req.query);
    if (!query) { invalid(res); return; }
    const at = now();
    const { rows, generatedAt } = await rowsOf(req, at);
    res.json(progressReport(rows, query, generatedAt, at));
  });

  router.get("/progress.xlsx", async (req, res) => {
    const query = parse(progressQuery, req.query);
    if (!query) { invalid(res); return; }
    const at = now();
    const { rows, scope } = await rowsOf(req, at);
    const list = progressRows(rows, query);
    const words = [...scopeWords(scope), ...filterWords(query)];
    const body = await progressWorkbook(list, filterRows(rows, filtersOf(query)), words, at);
    await recordAudit(pool, actorOf(req.session.user!), {
      kind: "report", action: "Xuất Excel", summary: `Sinh viên theo tiến độ (${[...words, `${list.length} dòng`].join(", ")})`, targetType: "report", targetId: "progress",
    });
    sendWorkbook(res, `Bao-cao-tien-do-${vietnamDate(at)}.xlsx`, body);
  });

  router.get("/risk", async (req, res) => {
    const query = parse(riskQuery, req.query);
    if (!query) { invalid(res); return; }
    const at = now();
    const { rows, generatedAt } = await rowsOf(req, at);
    res.json(riskReport(rows, query, generatedAt, at));
  });

  router.get("/risk.xlsx", async (req, res) => {
    const query = parse(riskQuery, req.query);
    if (!query) { invalid(res); return; }
    const at = now();
    const { rows, scope } = await rowsOf(req, at);
    const list = riskRows(rows, query);
    const words = [...scopeWords(scope), ...filterWords(query)];
    const body = await riskWorkbook(list, filterRows(rows, filtersOf(query)), words, at);
    await recordAudit(pool, actorOf(req.session.user!), {
      kind: "report", action: "Xuất Excel", summary: `Sinh viên có nguy cơ chậm tiến độ (${[...words, `${list.length} dòng`].join(", ")})`, targetType: "report", targetId: "risk",
    });
    sendWorkbook(res, `Sinh-vien-co-nguy-co-${vietnamDate(at)}.xlsx`, body);
  });

  router.get("/skills", async (req, res) => {
    const query = parse(skillsQuery, req.query);
    if (!query) { invalid(res); return; }
    const at = now();
    const { rows, generatedAt } = await rowsOf(req, at);
    res.json(skillsReport(rows, query, generatedAt, at));
  });

  router.get("/skills/students", async (req, res) => {
    const query = parse(skillStudentsQuery, req.query);
    if (!query) { invalid(res); return; }
    const { rows } = await rowsOf(req, now());
    res.json(skillStudents(rows, query));
  });

  router.get("/skills.xlsx", async (req, res) => {
    const query = parse(skillsQuery, req.query);
    if (!query) { invalid(res); return; }
    const at = now();
    const { rows, scope } = await rowsOf(req, at);
    const scoped = filterRows(rows, filtersOf(query));
    const withCareer = scoped.filter((row) => row.competency?.career && (!query.career || row.competency.career.name === query.career));
    const words = [...scopeWords(scope), ...filterWords(query)];
    const body = await skillsWorkbook(withCareer, scoped, words, at);
    const gaps = withCareer.reduce((sum, row) => sum + (row.competency?.career?.gaps.length ?? 0), 0);
    await recordAudit(pool, actorOf(req.session.user!), {
      kind: "report", action: "Xuất Excel", summary: `Kỹ năng còn thiếu (${[...words, `${withCareer.length} sinh viên, ${gaps} kỹ năng thiếu`].join(", ")})`,
      targetType: "report", targetId: "skills",
    });
    sendWorkbook(res, `Ky-nang-con-thieu-${vietnamDate(at)}.xlsx`, body);
  });

  router.get("/careers", async (req, res) => {
    const query = parse(filtersQuery, req.query);
    if (!query) { invalid(res); return; }
    const at = now();
    const { rows, generatedAt } = await rowsOf(req, at);
    res.json(careersReport(rows, query, generatedAt, at));
  });

  router.get("/courses", async (req, res) => {
    const query = parse(filtersQuery, req.query);
    if (!query) { invalid(res); return; }
    const at = now();
    const { rows, generatedAt } = await rowsOf(req, at);
    res.json(coursesReport(rows, query, generatedAt, at));
  });

  router.get("/courses/students", async (req, res) => {
    const query = parse(courseStudentsQuery, req.query);
    if (!query) { invalid(res); return; }
    const { rows } = await rowsOf(req, now());
    res.json(courseStudents(rows, query));
  });

  return router;
}
