import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { studentUser } from "../advisors/access.js";
import { majorIdentity, majorKey } from "../curricula/majors.js";
import type { CurriculumData } from "../curricula/model.js";
import { curriculumIdOf, curriculumPlan, curriculumPlanId, curriculumPlanName, physicalEducationGroupsOf } from "./from-curriculum.js";
import { identity, type PlanData } from "./model.js";

function studentPlanData(data: PlanData) {
  return {
    name: data.name,
    major: data.major,
    cohortCode: data.cohortCode,
    admissionYear: data.admissionYear,
    totalCredits: data.totalCredits,
    terms: data.terms.map(({ code, semester, studyYear, sourceCredits }) => ({
      code,
      semester,
      studyYear,
      sourceCredits,
    })),
    sections: data.sections.map(({ id, termCode, label, kind }) => ({
      id,
      termCode,
      label,
      kind,
    })),
    items: data.items.map(
      ({
        id,
        code,
        name,
        credits,
        type,
        termCode,
        semester,
        studyYear,
        sectionId,
        prerequisite,
        prior,
        hours,
        notes,
      }) => ({
        id,
        code,
        name,
        credits,
        type,
        termCode,
        semester,
        studyYear,
        sectionId,
        prerequisite,
        prior,
        hours,
        notes,
      }),
    ),
  };
}

export function createStudentPlansRouter(pool: DatabasePool | undefined) {
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
    const [result, profile, curricula] = await Promise.all([
      pool!
        .query(`SELECT c.id,c.cohort_code AS "cohortCode",r.data->>'name' AS name,
        r.data->>'major' AS major,(r.data->>'totalCredits')::numeric AS "totalCredits",
        jsonb_array_length(r.data->'items') AS "itemCount",r.version
        FROM training_plans c JOIN training_plan_revisions r ON r.id=c.current_revision
        WHERE c.is_active ORDER BY c.cohort_code DESC,r.data->>'major',c.id`),
      pool!.query("SELECT cohort_code,major_code FROM student_profiles WHERE user_id=$1", [
        studentUser(req).userId,
      ]),
      pool!.query(`SELECT c.id AS "curriculumId",c.cohort_code AS "cohortCode",r.data->>'major' AS major
        FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision WHERE c.is_active`),
    ]);
    // A cohort and major without a KHĐT get a plan read from their CTĐT (from-curriculum.ts, user 2026-11-05).
    const planned = new Set(result.rows.map((row) => `${majorKey(row.major ?? "")}:${row.cohortCode}`));
    const fromCurricula = curricula.rows
      .filter((row) => !planned.has(`${majorKey(row.major ?? "")}:${row.cohortCode}`))
      .map((row) => ({ id: curriculumPlanId(row.curriculumId), cohortCode: row.cohortCode,
        name: curriculumPlanName(row.major ?? "", row.cohortCode), major: row.major, fromCurriculum: true }));
    const items = [...result.rows, ...fromCurricula].sort((a, b) =>
      String(b.cohortCode).localeCompare(String(a.cohortCode)) || majorKey(a.major ?? "").localeCompare(majorKey(b.major ?? "")));
    const profileCohort = profile.rows[0]?.cohort_code ?? null;
    // The cohort's framework of the student's major (052; user, 2026-10-27).
    const major = majorIdentity(profile.rows[0]?.major_code);
    const matches = items.filter(
      (row) => row.cohortCode === profileCohort && (!major || majorKey(row.major ?? "") === major),
    );
    res.json({
      items,
      profileCohort,
      suggestedId: matches.length === 1 ? matches[0]!.id : null,
    });
  });
  router.get("/:id", async (req, res) => {
    const curriculumId = curriculumIdOf(req.params.id);
    if (curriculumId !== null) {
      const found = await pool!.query<{ id: string; data: CurriculumData }>(
        `SELECT c.id,r.data FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision
         WHERE c.id=$1 AND c.is_active`,
        [z.uuid().parse(curriculumId)],
      );
      z.object({}).strict().parse(req.query);
      const curriculum = found.rows[0];
      if (!curriculum) {
        res.status(404).json({ error: "plan_unavailable" });
        return;
      }
      res.json({ id: req.params.id, version: 0, fromCurriculum: true, ...curriculumPlan(curriculum.data),
        physicalEducationGroups: physicalEducationGroupsOf(curriculum.data.courses) });
      return;
    }
    const id = z.uuid().parse(req.params.id);
    z.object({}).strict().parse(req.query);
    const result = await pool!.query<{
      id: string;
      version: number;
      data: PlanData;
    }>(
      `SELECT c.id,r.version,r.data FROM training_plans c JOIN training_plan_revisions r ON r.id=c.current_revision
       WHERE c.id=$1 AND c.is_active`,
      [id],
    );
    const current = result.rows[0];
    if (!current) {
      res.status(404).json({ error: "plan_unavailable" });
      return;
    }
    const curriculum = await pool!.query<{ courses: { code: string; type: string }[] }>(
      `SELECT r.data->'courses' AS courses FROM curricula c
       JOIN curriculum_revisions r ON r.id=c.current_revision
       WHERE c.identity_key=$1 AND c.is_active`,
      [identity(current.data)],
    );
    const physicalEducationGroups = physicalEducationGroupsOf(curriculum.rows[0]?.courses ?? []);
    res.json({
      id: current.id,
      version: current.version,
      ...studentPlanData(current.data),
      physicalEducationGroups,
    });
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "invalid_plan_query" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
