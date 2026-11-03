import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { studentUser } from "../advisors/access.js";
import { majorIdentity, majorKey } from "./majors.js";
import type { CurriculumData } from "./model.js";

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
  router.get("/", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const [result, profile] = await Promise.all([
      pool!
        .query(`SELECT c.id,c.cohort_code AS "cohortCode",r.data->>'name' AS name,
        r.data->>'major' AS major,(r.data->>'totalCredits')::int AS "totalCredits",
        jsonb_array_length(r.data->'courses') AS "courseCount",r.version
        FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision
        WHERE c.is_active ORDER BY c.cohort_code DESC,r.data->>'major',c.id`),
      pool!.query("SELECT cohort_code,major_code FROM student_profiles WHERE user_id=$1", [
        studentUser(req).userId,
      ]),
    ]);
    const profileCohort = profile.rows[0]?.cohort_code ?? null;
    // The cohort's framework of the student's major (052; user, 2026-10-27).
    const major = majorIdentity(profile.rows[0]?.major_code);
    const matches = result.rows.filter(
      (row) => row.cohortCode === profileCohort && (!major || majorKey(row.major ?? "") === major),
    );
    res.json({
      items: result.rows,
      profileCohort,
      suggestedId: matches.length === 1 ? matches[0]!.id : null,
    });
  });
  router.get("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    z.object({}).strict().parse(req.query);
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
