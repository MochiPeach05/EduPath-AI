import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { studentUser } from "../advisors/access.js";
import type { CurriculumData } from "./model.js";
import { readOwnProgramProfile, resolveOwnCurriculum } from "./own-program.js";

/** One element per distinct key, the first one kept, in order. */
function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

// Student responses expose the current teaching framework, never administrative
// tokens, actors, source cells, files, audit events or historical revisions.
// A row repeated with the same code, group and type (K26 lists DIT0330/DIT0340
// twice in TC206) is shown once; the same code in another group stays.
export function studentCurriculumData(data: CurriculumData) {
  const courses = uniqueBy(data.courses, (c) => JSON.stringify([c.groupId, c.code, c.type]));
  return {
    name: data.name,
    major: data.major,
    cohortCode: data.cohortCode,
    admissionYear: data.admissionYear,
    totalCredits: data.totalCredits,
    groups: data.groups.map(({ id, label, credits }) => ({
      id,
      label,
      credits,
    })),
    electives: data.electives.map(({ code, requiredCredits, courseCodes }) => ({
      code,
      requiredCredits,
      courseCodes,
    })),
    courses: courses.map((c) => ({
      code: c.code,
      name: c.name,
      englishName: c.englishName,
      description: c.description?.trim() || null,
      credits: c.credits,
      type: c.type,
      block: c.block,
      specialty: c.specialty,
      groupId: c.groupId,
      semester: c.semester,
      studyYear: c.studyYear,
      department: c.department,
      hours: c.hours,
      notes: c.notes,
      prerequisite: c.prerequisite,
      prior: c.prior,
      // A repeated row repeats its relations at import; each one is listed once.
      conditions: uniqueBy(
        data.relations
          .filter((r) => r.courseCode === c.code)
          .map((r) => ({
            kind: r.kind,
            targetCodes: r.targetCodes,
            reviewRequired: r.reviewRequired,
          })),
        (r) => JSON.stringify(r),
      ),
      scheduleNeedsReview: !c.semester || !c.studyYear,
    })),
  };
}

export function createStudentCurriculaRouter(pool: DatabasePool | undefined) {
  const router = Router();
  router.use(requireAuthentication);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) {
      res.status(503).json({ error: "database_required" });
      return;
    }
    const user = studentUser(req);
    const active = await pool.query(
      "SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active",
      [user.userId, user.tenantId],
    );
    if (!active.rowCount) {
      res.status(403).json({ error: "account_unavailable" });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).json({ error: "read_only" });
      return;
    }
    next();
  });
  // Only the student's own CTĐT (own-program.ts, user 2026-11-10: no choice, "như trang xét tốt nghiệp"): the cohort in the
  // account and the major of the MSSV, as the engine picks it. items holds it alone and suggestedId is its id, so a page
  // loaded before the change still opens it.
  router.get("/", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const profile = await readOwnProgramProfile(pool!, studentUser(req).userId);
    const { resolution, curriculum } = await resolveOwnCurriculum(pool!, profile);
    res.json({
      items: curriculum ? [{
        id: curriculum.id, cohortCode: curriculum.cohortCode, name: curriculum.name, major: curriculum.major,
        totalCredits: curriculum.totalCredits, courseCount: curriculum.courseCount, version: curriculum.version,
      }] : [],
      profileCohort: profile.cohortCode,
      profileMajor: profile.majorCode,
      resolution,
      suggestedId: curriculum?.id ?? null,
    });
  });
  // Another CTĐT than the student's own is unavailable, as a closed one.
  router.get("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    z.object({}).strict().parse(req.query);
    const own = await resolveOwnCurriculum(pool!, await readOwnProgramProfile(pool!, studentUser(req).userId));
    if (own.curriculum?.id !== id) {
      res.status(404).json({ error: "curriculum_unavailable" });
      return;
    }
    const result = await pool!.query<{
      id: string;
      version: number;
      data: CurriculumData;
    }>(
      `SELECT c.id,r.version,r.data FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision
       WHERE c.id=$1 AND c.is_active`,
      [id],
    );
    const current = result.rows[0];
    if (!current) {
      res.status(404).json({ error: "curriculum_unavailable" });
      return;
    }
    res.json({
      id: current.id,
      version: current.version,
      ...studentCurriculumData(current.data),
    });
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "invalid_curriculum_query" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
