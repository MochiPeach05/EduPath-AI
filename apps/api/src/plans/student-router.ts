import { Router, type ErrorRequestHandler, type Request } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { studentUser } from "../advisors/access.js";
import type { CurriculumData } from "../curricula/model.js";
import { readOwnProgramProfile, resolveOwnCurriculum, resolveOwnPlan } from "../curricula/own-program.js";
import { curriculumWithRealCodes, planWithRealCodes, readPlanRealCodes, readRealCodes } from "../curricula/real-codes.js";
import { curriculumIdOf, curriculumPlan, physicalEducationGroupsOf } from "./from-curriculum.js";
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
  // The student's own KHĐT (own-program.ts, user 2026-11-10: no choice, "như trang xét tốt nghiệp"): the cohort in the
  // account and the major of the MSSV, as the engine picks it; a cohort and major without a KHĐT get the plan read from
  // their CTĐT (from-curriculum.ts, user 2026-11-05). items holds it alone and suggestedId is its id, so a page loaded
  // before the change still opens it.
  const ownPlan = async (req: Request) => {
    const profile = await readOwnProgramProfile(pool!, studentUser(req).userId);
    return { profile, ...await resolveOwnPlan(pool!, profile, await resolveOwnCurriculum(pool!, profile)) };
  };
  router.get("/", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const { profile, resolution, plan } = await ownPlan(req);
    res.json({
      items: plan ? [plan] : [],
      profileCohort: profile.cohortCode,
      profileMajor: profile.majorCode,
      resolution,
      suggestedId: plan?.id ?? null,
    });
  });
  // Another plan than the student's own is unavailable, as a closed one.
  router.get("/:id", async (req, res) => {
    const curriculumId = curriculumIdOf(req.params.id);
    z.uuid().parse(curriculumId ?? req.params.id);
    z.object({}).strict().parse(req.query);
    if ((await ownPlan(req)).plan?.id !== req.params.id) {
      res.status(404).json({ error: "plan_unavailable" });
      return;
    }
    if (curriculumId !== null) {
      const found = await pool!.query<{ id: string; data: CurriculumData; cohortCode: string; identityKey: string }>(
        `SELECT c.id,r.data,c.cohort_code AS "cohortCode",c.identity_key AS "identityKey" FROM curricula c
         JOIN curriculum_revisions r ON r.id=c.current_revision WHERE c.id=$1 AND c.is_active`,
        [curriculumId],
      );
      const curriculum = found.rows[0];
      if (!curriculum) {
        res.status(404).json({ error: "plan_unavailable" });
        return;
      }
      // The CTĐT with the real codes of its courses (curricula/real-codes.ts, user 2026-11-10): students read only those.
      const data = curriculumWithRealCodes(curriculum.data,
        await readRealCodes(pool!, { cohortCode: curriculum.cohortCode, identityKey: curriculum.identityKey, courses: curriculum.data.courses }));
      res.json({ id: req.params.id, version: 0, fromCurriculum: true, ...curriculumPlan(data),
        physicalEducationGroups: physicalEducationGroupsOf(data.courses) });
      return;
    }
    const id = req.params.id;
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
    // The real codes of the plan's CTĐT (curricula/real-codes.ts, user 2026-11-10): its rows are served under those only.
    const realCodes = await readPlanRealCodes(pool!, identity(current.data));
    const physicalEducationGroups = physicalEducationGroupsOf((curriculum.rows[0]?.courses ?? [])
      .map((course) => ({ ...course, code: realCodes.get(course.code.trim().toUpperCase()) ?? course.code })));
    res.json({
      id: current.id,
      version: current.version,
      ...studentPlanData(planWithRealCodes(current.data, realCodes)),
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
