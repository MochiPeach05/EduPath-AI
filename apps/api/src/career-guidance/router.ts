// "Định hướng nghề nghiệp" (user 2026-10-24: "làm theo ý bạn muốn nhưng vẫn phải phù hợp với đề tài"): every career of
// the catalog against the student's current competencies, with the same calculation as the target career on Khoảng
// trống kỹ năng (careerFitsFor, from the current transcript and the faculty's configuration), plus the careers matching
// the field and technologies of Khảo sát định hướng. Read only: the page saves the chosen target career through
// PATCH /api/student/profile. The system computes everything here; no AI.
import { Router, type ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { careerFitsFor } from "../competency-assessment/calculate.js";
import { AssessmentError, readAssessmentInputs } from "../competency-assessment/inputs.js";
import type { AssessmentInputs, CareerInput, CareerResult, FitCode, GapStatus } from "../competency-assessment/types.js";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { readSurvey } from "../student/survey.js";
import { interestMatch, type InterestMatch } from "./interests.js";

type CatalogRow = CareerInput & { category: string; categoryName: string; description: string };

export type GuidanceRequirement = {
  title: string; skillName: string | null; isRequired: boolean;
  /** null when the fit could not be computed (blocked). */
  status: GapStatus | null; statusLabel: string | null; score: number | null; threshold: number | null; deficit: number | null; upcomingTerm: string | null;
};
export type GuidanceCareer = {
  id: string; code: string; nameVi: string; nameEn: string; category: string; categoryName: string; description: string; isTarget: boolean;
  fit: { score: number | null; code: FitCode; label: string; dataShare: number; met: number; below: number; notStudied: number; upcoming: number; noData: number; total: number } | null;
  requirements: GuidanceRequirement[];
  interests: InterestMatch;
};

/** Every active career of the catalog with its requirements, in the shape the assessment engine reads. */
export async function readCareerCatalog(db: Pick<PoolClient, "query">): Promise<CatalogRow[]> {
  const rows = await db.query<{
    id: string; code: string; name_vi: string; name_en: string; version: string; category: string; category_name: string; description: string | null;
    requirements: { id: string; skillId: string | null; skillName: string | null; title: string; isRequired: boolean }[];
  }>(`SELECT c.id,c.code,c.name_vi,c.name_en,c.version,c.category,f.name AS category_name,c.description,
      COALESCE((SELECT json_agg(json_build_object('id',r.id,'skillId',r.skill_id,'skillName',CASE WHEN k.deleted_at IS NULL THEN k.name END,
        'title',r.title,'isRequired',r.is_required) ORDER BY r.is_required DESC,r.title,r.id)
        FROM career_requirements r LEFT JOIN career_skills k ON k.id=r.skill_id
        WHERE r.career_position_id=c.id AND r.deleted_at IS NULL),'[]'::json) AS requirements
    FROM career_positions c JOIN career_fields f ON f.code=c.category
    WHERE c.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY c.name_vi,c.id`);
  return rows.rows.map((row) => ({
    id: row.id, code: row.code, nameVi: row.name_vi, nameEn: row.name_en, version: row.version, deleted: false,
    category: row.category, categoryName: row.category_name, description: row.description ?? "", requirements: row.requirements,
  }));
}

const requirementsOf = (career: CatalogRow, fit: CareerResult | null): GuidanceRequirement[] => fit
  ? fit.requirements.map((row) => ({
    title: row.title, skillName: row.skillName, isRequired: row.isRequired, status: row.status, statusLabel: row.statusLabel,
    score: row.score, threshold: row.threshold, deficit: row.deficit, upcomingTerm: row.upcomingTerm,
  }))
  : career.requirements.map((row) => ({
    title: row.title, skillName: row.skillName, isRequired: row.isRequired, status: null, statusLabel: null, score: null, threshold: null, deficit: null, upcomingTerm: null,
  }));

/** The careers, best fit first (no fit last, then by name), each with its fit, requirements and survey matches. */
export function guidanceCareers(catalog: CatalogRow[], inputs: AssessmentInputs | null, targetId: string | null,
  survey: { field: string | null; tech: readonly string[] }): GuidanceCareer[] {
  const fits = inputs ? careerFitsFor(inputs, catalog) : [];
  const careers = catalog.map((career, index): GuidanceCareer => {
    const fit = fits[index] ?? null;
    return {
      id: career.id, code: career.code, nameVi: career.nameVi, nameEn: career.nameEn, category: career.category, categoryName: career.categoryName,
      description: career.description, isTarget: career.id === targetId,
      fit: fit && {
        score: fit.fitScore ?? null, code: fit.fitCode, label: fit.fitLabel, dataShare: fit.dataShare, met: fit.counts.met, below: fit.counts.below,
        notStudied: fit.counts.notStudied, upcoming: fit.counts.upcoming, noData: fit.counts.noData, total: fit.counts.total,
      },
      requirements: requirementsOf(career, fit),
      interests: interestMatch(career, survey),
    };
  });
  const rank = (career: GuidanceCareer) => (career.fit && career.fit.code !== "insufficient_data" ? career.fit.score ?? -1 : -1);
  return careers.sort((a, b) => rank(b) - rank(a) || a.nameVi.localeCompare(b.nameVi, "vi") || a.id.localeCompare(b.id));
}

export function createCareerGuidanceRouter(pool: DatabasePool | undefined) {
  const router = Router();
  router.use(requireAuthentication);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    const user = req.session.user!;
    const active = await pool.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active", [user.userId, user.tenantId]);
    if (!active.rowCount) { res.status(403).json({ error: "account_unavailable" }); return; }
    next();
  });

  router.get("/", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const userId = req.session.user!.userId;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      let inputs: AssessmentInputs | null = null;
      let blocked: string | null = null;
      try {
        inputs = await readAssessmentInputs(client, userId, { careerOptional: true });
      } catch (error) {
        if (!(error instanceof AssessmentError)) throw error;
        blocked = error.code;
      }
      const catalog = await readCareerCatalog(client);
      const fields = await client.query<{ code: string; name: string }>(
        "SELECT code,name FROM career_fields WHERE deleted_at IS NULL ORDER BY code::bigint,id");
      const profile = await client.query<{ career_position_id: string | null }>("SELECT career_position_id FROM student_profiles WHERE user_id=$1", [userId]);
      const survey = await readSurvey(client, userId);
      await client.query("COMMIT");
      const answers = { field: survey?.answers.field && survey.answers.field !== "unsure" ? survey.answers.field : null, tech: survey?.interestTech ?? [] };
      res.json({
        blocked,
        targetCareerId: profile.rows[0]?.career_position_id ?? null,
        surveyDone: Boolean(survey && (answers.field || answers.tech.length)),
        fields: fields.rows.filter((field) => catalog.some((career) => career.category === field.code)),
        careers: guidanceCareers(catalog, inputs, profile.rows[0]?.career_position_id ?? null, answers),
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
