// "Định hướng nghề nghiệp" (user 2026-10-24: "làm theo ý bạn muốn nhưng vẫn phải phù hợp với đề tài"): every career of
// the catalog against the student's current competencies, with the same calculation as the target career on Khoảng
// trống kỹ năng (careerFitsFor, from the current transcript and the faculty's configuration), plus the careers matching
// the field and technologies of Khảo sát định hướng. Read only: the page saves the chosen target career through
// PATCH /api/student/profile. The system computes everything here; no AI.
import { Router, type ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { assessWithCareerFits } from "../competency-assessment/calculate.js";
import { courseKey, uniqueCurriculumCourses } from "../competency-assessment/course-state.js";
import { AssessmentError, readAssessmentInputs } from "../competency-assessment/inputs.js";
import type { AssessmentInputs, AssessmentResult, CareerInput, CareerRequirementResult, CareerResult, FitCode, GapStatus } from "../competency-assessment/types.js";
import type { DatabasePool } from "../db/pool.js";
import { snapshotReads, type ReferenceCache } from "../db/reference-cache.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { studentAccountChecked, studentUser } from "../advisors/access.js";
import { consentWithdrawn } from "../student/consent.js";
import { readSurvey, surveyUsable, type StudentSurvey } from "../student/survey.js";
import { interestMatch, type InterestMatch } from "./interests.js";

type CatalogRow = CareerInput & { category: string; categoryName: string; description: string };
type NoDataReason = NonNullable<CareerRequirementResult["noDataReason"]>;

export type GuidanceRequirement = {
  title: string; skillName: string | null; isRequired: boolean;
  /** null when the fit could not be computed (blocked). */
  status: GapStatus | null; statusLabel: string | null; score: number | null; threshold: number | null; deficit: number | null; upcomingTerm: string | null;
  /** As on Khoảng trống kỹ năng: "other_specialty" and "elective_not_chosen" read "Cần tự học". */
  noDataReason: NoDataReason | null; exemptOnly: boolean; coefficient: number;
  /** Courses of another specialty that measure the skill, "Name (CODE)" as the note of Khoảng trống kỹ năng. */
  otherSpecialtyCourses: string[];
  /**
   * The courses the score comes from, largest share first, with the grade printed on the transcript (user 2026-10-30: "Nên
   * ghi môn làm minh chứng cạnh từng điểm"); empty without a score.
   */
  sources: GuidanceSource[];
};
export type GuidanceSource = { name: string; score10: number | null; letter: string | null };
export type GuidanceCareer = {
  id: string; code: string; nameVi: string; nameEn: string; category: string; categoryName: string; description: string; isTarget: boolean;
  fit: {
    score: number | null; code: FitCode; label: string; dataShare: number; met: number; below: number; notStudied: number; upcoming: number; noData: number;
    selfStudy: number; total: number;
    /** The count lines of Khoảng trống kỹ năng ("Đạt x/y kỹ năng · z sắp học · …", "u/y kỹ năng có điểm"). */
    summaryText: string; dataText: string;
  } | null;
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

/** Per skill key, the courses its score comes from (evidence rows with role "score"), largest share first. */
export function scoreSourcesBySkill(result: Pick<AssessmentResult, "skills" | "courses">): Map<string, GuidanceSource[]> {
  const courses = new Map(result.courses.map((course) => [course.code, course]));
  return new Map(result.skills.map((skill) => [skill.key, skill.evidenceCourses.filter((row) => row.role === "score")
    .sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || b.contribution - a.contribution || a.code.localeCompare(b.code))
    .map((row) => {
      const course = courses.get(row.code);
      return { name: course?.name ?? row.code, score10: course?.score10 ?? null, letter: course?.letter ?? null };
    })]));
}

const requirementsOf = (career: CatalogRow, fit: CareerResult | null, courseNames: ReadonlyMap<string, string>,
  sources: ReadonlyMap<string, GuidanceSource[]>): GuidanceRequirement[] => fit
  ? fit.requirements.map((row) => ({
    title: row.title, skillName: row.skillName, isRequired: row.isRequired, status: row.status, statusLabel: row.statusLabel,
    score: row.score, threshold: row.threshold, deficit: row.deficit, upcomingTerm: row.upcomingTerm,
    noDataReason: row.noDataReason, exemptOnly: row.exemptOnly, coefficient: row.coefficient,
    otherSpecialtyCourses: (row.otherSpecialtyCourses ?? []).map((code) => (courseNames.has(code) ? `${courseNames.get(code)} (${code})` : code)),
    sources: row.score !== null && row.skillKey ? sources.get(row.skillKey) ?? [] : [],
  }))
  : career.requirements.map((row) => ({
    title: row.title, skillName: row.skillName, isRequired: row.isRequired, status: null, statusLabel: null, score: null, threshold: null, deficit: null, upcomingTerm: null,
    noDataReason: null, exemptOnly: false, coefficient: row.isRequired ? 2 : 1, otherSpecialtyCourses: [], sources: [],
  }));

/** The careers, best fit first (no fit last, then by name), each with its fit, requirements and survey matches. */
export function guidanceCareers(catalog: CatalogRow[], inputs: AssessmentInputs | null, targetId: string | null,
  survey: { field: string | null; tech: readonly string[] }): GuidanceCareer[] {
  // One run of the engine: the fit of every career, and the skills' evidence (it does not depend on the career), which gives
  // every requirement its courses.
  const run = inputs ? assessWithCareerFits(inputs, catalog) : null;
  const fits = run?.careerFits ?? [];
  const courseNames = new Map(uniqueCurriculumCourses(inputs?.curriculum.courses ?? []).map((course) => [courseKey(course.code), course.name]));
  const sources = run ? scoreSourcesBySkill(run.assessment) : new Map<string, GuidanceSource[]>();
  const careers = catalog.map((career, index): GuidanceCareer => {
    const fit = fits[index] ?? null;
    return {
      id: career.id, code: career.code, nameVi: career.nameVi, nameEn: career.nameEn, category: career.category, categoryName: career.categoryName,
      description: career.description, isTarget: career.id === targetId,
      fit: fit && {
        score: fit.fitScore ?? null, code: fit.fitCode, label: fit.fitLabel, dataShare: fit.dataShare, met: fit.counts.met, below: fit.counts.below,
        notStudied: fit.counts.notStudied, upcoming: fit.counts.upcoming, noData: fit.counts.noData, total: fit.counts.total,
        selfStudy: fit.requirements.filter((row) => row.status === "no_data" && (row.noDataReason === "other_specialty" || row.noDataReason === "elective_not_chosen")).length,
        summaryText: fit.summaryText, dataText: fit.dataText,
      },
      requirements: requirementsOf(career, fit, courseNames, sources),
      interests: interestMatch(career, survey),
    };
  });
  const rank = (career: GuidanceCareer) => (career.fit && career.fit.code !== "insufficient_data" ? career.fit.score ?? -1 : -1);
  return careers.sort((a, b) => rank(b) - rank(a) || a.nameVi.localeCompare(b.nameVi, "vi") || a.id.localeCompare(b.id));
}

/**
 * The survey answers this page may use: only a Khảo sát định hướng the AI features may use (usable: student/survey.ts
 * surveyUsable, the rule of the AI roadmap); older or partial answers are left out and the page asks for the survey.
 */
export function surveyAnswers(survey: StudentSurvey | null, usable: boolean): { done: boolean; field: string | null; tech: string[] } {
  if (survey?.complete !== true || !usable) return { done: false, field: null, tech: [] };
  const field = survey.answers.field;
  return { done: true, field: field && field !== "unsure" ? field : null, tech: survey.interestTech };
}

/** Whether a stored assessment's career (Khoảng trống kỹ năng) has the statuses and scores this page computes now. */
export function sameAsStored(stored: CareerResult | null, live: GuidanceCareer): boolean {
  const key = (rows: readonly { title: string; isRequired: boolean; status: GapStatus | null; score: number | null }[]) =>
    JSON.stringify(rows.map((row) => [row.title, row.isRequired, row.status, row.score]).sort());
  return Boolean(stored && stored.id === live.id && key(stored.requirements) === key(live.requirements));
}

export function createCareerGuidanceRouter(pool: DatabasePool | undefined, options: { reference?: ReferenceCache } = {}) {
  const router = Router();
  router.use(requireAuthentication);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    const user = studentUser(req);
    if (!studentAccountChecked(req, res)) {
      const active = await pool.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active", [user.userId, user.tenantId]);
      if (!active.rowCount) { res.status(403).json({ error: "account_unavailable" }); return; }
    }
    next();
  });

  router.get("/", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const userId = studentUser(req).userId;
    // The CTĐT, standards, skill configuration and careers come from the shared reference cache (db/reference-cache.ts,
    // 2026-11-10: 29 round trips to the database a request); its reader is taken before the snapshot starts.
    const reader = options.reference?.reader();
    const client = await pool!.connect();
    let read;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const db = snapshotReads(client, reader);
      let inputs: AssessmentInputs | null = null;
      let blocked: string | null = null;
      // "Xóa kết quả đánh giá" withdrew the consent to assess the competencies: no fit is computed from the transcript until
      // the student assesses again and agrees again (user 2026-10-29: "Khi người dùng đã xóa kết quả năng lực cũ thì nó nên
      // ghi rõ đây là kết quả cũ hoặc là xóa luôn chứ"). A student who never assessed still sees the fits to choose a career.
      if (await consentWithdrawn(db, userId, "competency_assessment")) blocked = "assessment_withdrawn";
      else {
        try {
          inputs = await readAssessmentInputs(db, userId);
        } catch (error) {
          if (!(error instanceof AssessmentError)) throw error;
          blocked = error.code;
        }
      }
      const catalog = await readCareerCatalog(db);
      const fields = await db.query<{ code: string; name: string }>(
        "SELECT code,name FROM career_fields WHERE deleted_at IS NULL ORDER BY code::bigint,id");
      // The inputs carry the profile's target career, read in this snapshot.
      const targetId = inputs ? inputs.student.careerPositionId : (await db.query<{ career_position_id: string | null }>(
        "SELECT career_position_id FROM student_profiles WHERE user_id=$1", [userId])).rows[0]?.career_position_id ?? null;
      // A soft-deleted target is not in the catalog; Khoảng trống kỹ năng still shows it ("không còn trong danh mục").
      const deletedTarget = targetId && !catalog.some((career) => career.id === targetId)
        ? (await db.query<{ name_vi: string }>("SELECT name_vi FROM career_positions WHERE id=$1", [targetId])).rows[0]?.name_vi ?? null : null;
      // What Khoảng trống kỹ năng shows: the target career of the latest stored assessment.
      const stored = await db.query<{ career: CareerResult | null; created_at: Date }>(
        "SELECT computed->'career' AS career,created_at FROM stu_comp_assessments WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [userId]);
      const survey = await readSurvey(db, userId);
      const usable = await surveyUsable(db, userId, survey);
      await client.query("COMMIT");
      read = { inputs, blocked, catalog, fields: fields.rows, targetId, deletedTarget, stored: stored.rows[0] ?? null, survey, usable };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    // Computed with the connection back in the pool: several pages at once no longer hold every connection meanwhile.
    const { inputs, blocked, catalog, fields, targetId, deletedTarget, stored, survey, usable } = read;
    const answers = surveyAnswers(survey, usable);
    const careers = guidanceCareers(catalog, inputs, targetId, answers);
    const target = careers.find((career) => career.isTarget);
    const gapCareer = stored?.career ?? null;
    res.json({
      blocked,
      targetCareerId: targetId,
      deletedTargetName: deletedTarget,
      // false when Khoảng trống kỹ năng shows another career, or other statuses or scores for the target career (an older assessment).
      gapCurrent: Boolean(target?.fit && sameAsStored(gapCareer, target)),
      gapAssessedAt: stored?.created_at ?? null,
      // The career Khoảng trống kỹ năng shows (the latest assessment's), so the page can say it is another one.
      gapCareerId: gapCareer?.id ?? null,
      gapCareerName: gapCareer?.nameVi ?? null,
      surveyDone: answers.done,
      fields: fields.filter((field) => catalog.some((career) => career.category === field.code)),
      careers,
    });
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
