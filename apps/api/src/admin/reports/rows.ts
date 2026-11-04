// Báo cáo của cổng quản trị (AD-REPORT, 2026-10-31): one row per student, read once and cached (cache.ts). A row holds
// what the student's own Tổng quan shows, read by the same readOverview (printed transcript figures, progress against
// the KHĐT, "Cần chú ý", the latest stored assessment with the consent respected), so admins and students always see the
// same story; one exception, a transcript without data (hasTranscriptData), which the reports leave out of every figure.
// The reports add, from the same stored results: every group and skill score and every career gap of the latest
// assessment (only when Tổng quan shows that assessment), and the courses of the newest completed Lộ trình AI.
import type { PoolClient } from "pg";
import type { AssessmentResult, CareerRequirementResult, SpecialtyCode } from "../../competency-assessment/types.js";
import { MAJORS } from "../../curricula/majors.js";
import { specialtyLabel } from "../../competency-assessment/specialty.js";
import { readOverview } from "../../overview/overview.js";
import type { OverviewResponse, OverviewWarning } from "../../overview/types.js";
import { newestAssessment, type RoadmapRow } from "../../roadmap/jobs.js";
import { presentRoadmap } from "../../roadmap/present.js";
import { vietnamToday } from "../../roadmap/window.js";
import type { CourseHow, ProgressStatus, RiskItem, RiskKind, SkillGapStatus } from "./types.js";

/** Who the row is about, as the student list reads it (student_profiles, else the account). */
export type ReportIdentity = {
  userId: string;
  name: string;
  studentCode: string | null;
  /** Normalised "K29", null when unknown. */
  cohort: string | null;
  majorCode: string | null;
  /** A known specialty code (profileSpecialty), else null. */
  specialtyCode: SpecialtyCode | null;
};

export type ReportRow = ReportIdentity & {
  majorName: string | null;
  specialtyName: string | null;
  hasTranscript: boolean;
  status: ProgressStatus;
  /** Printed cumulative GPA (hệ 4), as Tổng quan reads it. */
  gpa: number | null;
  /** The latest printed term GPA (hệ 4). */
  lastTermGpa: number | null;
  /** The printed GPA lines term by term, oldest first. */
  series: { term: string; termGpa: number | null; cumulativeGpa: number | null }[];
  passedCredits: number | null;
  totalCredits: number | null;
  expectedCredits: number | null;
  risk: { level: "risk" | "warn" | null; items: RiskItem[] };
  /** Only when Tổng quan shows the latest assessment (none without one, none once the consent is withdrawn). */
  competency: null | {
    overall: number | null;
    groups: { name: string; score: number | null }[];
    skills: { name: string; group: string | null; score: number }[];
    career: null | { name: string; fitScore: number | null; fitLabel: string | null; gaps: { name: string; status: SkillGapStatus }[] };
  };
  /** Courses of the newest completed Lộ trình AI; null without one. */
  roadmapCourses: { code: string; name: string; how: CourseHow }[] | null;
  computedAt: string;
};

const RISK_KINDS: ReadonlySet<string> = new Set<RiskKind>(["failed_course", "pace", "gpa_below", "late_course", "elective_short"]);

/**
 * "Bảng điểm có dữ liệu", one rule for every report (QA 2026-11-04: 14 transcripts uploaded but 13 in Xếp loại học lực, and
 * one row averaging the GPA over 5 students and the credits over 6): a stored transcript whose printed cumulative GPA
 * (hệ 4) was read, so at least one graded term was. A transcript without it still counts as uploaded ("đã tải bảng
 * điểm"), and is left out of every average and distribution the same way: no GPA, credits, học lực or GPA by term from
 * it, and no progress judgement or risk (rowFromParts: "Chưa đủ dữ liệu", like a progress that cannot be compared).
 */
export const hasTranscriptData = (row: Pick<ReportRow, "hasTranscript" | "gpa">): boolean => row.hasTranscript && row.gpa !== null;

/**
 * Tiến độ as Tổng quan judges it, defined once for every report: no_transcript without a stored transcript; unknown when
 * the progress cannot be compared with the KHĐT (blocked: no plan, no specialty, …); late when "Cần chú ý" has a late
 * course or a pace warning, or courses of a past term of the plan are not passed (late credits); else on_track. A
 * transcript without data (hasTranscriptData) is unknown too: rowFromParts never asks for its status.
 */
export function progressStatus(overview: Pick<OverviewResponse, "transcript" | "progress" | "warnings">): ProgressStatus {
  if (!overview.transcript) return "no_transcript";
  const progress = overview.progress;
  if (!progress || progress.blocked !== null) return "unknown";
  const late = overview.warnings.items.some((item) => item.kind === "late_course" || item.kind === "pace") || progress.lateCredits > 0;
  return late ? "late" : "on_track";
}

/** The "Cần chú ý" items that make a student need attention (missing data and "Đúng tiến độ" are not risks). */
export function riskOf(warnings: readonly OverviewWarning[]): ReportRow["risk"] {
  const items: RiskItem[] = warnings.filter((item) => RISK_KINDS.has(item.kind) && item.level !== "ok")
    .map((item) => ({ kind: item.kind as RiskKind, level: item.level as "risk" | "warn", text: item.text }));
  const level = items.some((item) => item.level === "risk") ? "risk" : items.length ? "warn" : null;
  return { level, items };
}

/** The KHĐT credits planned before the term being studied (the plan terms Tổng quan marks done or late). */
export function expectedCreditsOf(progress: OverviewResponse["progress"]): number | null {
  if (!progress || progress.blocked !== null || !progress.terms.length) return null;
  return progress.terms.filter((term) => term.state === "done" || term.state === "late").reduce((sum, term) => sum + term.plannedCredits, 0);
}

/** A career requirement not met, as the reports group it (Khoảng trống kỹ năng's words). */
export function gapStatusOf(requirement: Pick<CareerRequirementResult, "status" | "noDataReason">): SkillGapStatus | null {
  switch (requirement.status) {
    case "met": return null;
    case "below": return "below";
    case "not_studied":
    case "upcoming": return "not_studied";
    default:
      return requirement.noDataReason === "other_specialty" || requirement.noDataReason === "elective_not_chosen" ? "self_study" : "no_data";
  }
}

/** Group scores, scored skills (GDTC/GDQP left out) and the career's gaps of a stored assessment. */
export function competencyOf(computed: AssessmentResult, career: NonNullable<OverviewResponse["competency"]>["career"]): NonNullable<ReportRow["competency"]> {
  const requirements = computed.career?.requirements ?? [];
  const gaps = requirements.flatMap((requirement) => {
    const status = gapStatusOf(requirement);
    return status ? [{ name: requirement.skillName ?? requirement.title, status }] : [];
  });
  return {
    overall: computed.overall?.score ?? null,
    groups: (computed.groups ?? []).map((group) => ({ name: group.name, score: group.score ?? null })),
    skills: (computed.skills ?? []).filter((skill) => skill.score !== null && !skill.conditionOnly)
      .map((skill) => ({ name: skill.name, group: skill.groupName ?? null, score: skill.score! })),
    career: computed.career ? {
      name: career?.name ?? computed.career.nameVi,
      fitScore: career?.fitScore ?? computed.career.fitScore ?? null,
      fitLabel: career?.fitLabel ?? computed.career.fitLabel ?? null,
      gaps,
    } : null,
  };
}

/**
 * The courses Lộ trình AI proposes, as the page Lộ trình AI đề xuất shows them: every retake (F/VT/CT must be taken
 * again), the passed courses the AI chose to improve, and the courses the AI chose to study (not the ones being
 * studied). One entry per course, retake before improve before new.
 */
export function roadmapCoursesOf(row: RoadmapRow, today: string): NonNullable<ReportRow["roadmapCourses"]> {
  const view = presentRoadmap(row, today);
  const courses = new Map<string, { code: string; name: string; how: CourseHow }>();
  const put = (code: string, name: string, how: CourseHow) => {
    const key = code.trim().toUpperCase();
    if (key && !courses.has(key)) courses.set(key, { code: key, name, how });
  };
  for (const item of view.improve) if (item.action === "retake") put(item.code, item.name, "retake");
  for (const item of view.improve) if (item.action === "improve" && item.advice !== null) put(item.code, item.name, "improve");
  for (const item of view.study) if (item.source !== "running" && item.advice !== null) put(item.code, item.name, "new");
  return [...courses.values()];
}

/**
 * The row from what was read; pure. A transcript without data (hasTranscriptData) keeps only that it was uploaded: no
 * figure is taken from it (GPA lines, credits) and its progress is "Chưa đủ dữ liệu" without risk, so every report
 * leaves it out of its averages and distributions the same way.
 */
export function rowFromParts(
  identity: ReportIdentity,
  overview: OverviewResponse,
  assessment: { computed: AssessmentResult } | null,
  roadmapCourses: ReportRow["roadmapCourses"],
  computedAt: Date,
): ReportRow {
  const transcript = overview.transcript;
  const hasTranscript = Boolean(transcript);
  const gpa = transcript?.gpa4 ?? null;
  const usable = hasTranscriptData({ hasTranscript, gpa });
  const series = usable ? (transcript?.series ?? []).map((point) => ({ term: point.term.code, termGpa: point.termGpa4, cumulativeGpa: point.cumulativeGpa4 })) : [];
  const lastTerm = [...series].reverse().find((point) => point.termGpa !== null);
  return {
    ...identity,
    majorName: MAJORS.find((major) => major.code === identity.majorCode)?.label ?? null,
    specialtyName: specialtyLabel(identity.specialtyCode),
    hasTranscript,
    status: hasTranscript && !usable ? "unknown" : progressStatus(overview),
    gpa,
    lastTermGpa: lastTerm?.termGpa ?? null,
    series,
    passedCredits: usable ? overview.progress?.passedCredits ?? transcript?.credits ?? null : null,
    totalCredits: overview.progress?.totalCredits ?? null,
    expectedCredits: expectedCreditsOf(overview.progress),
    risk: usable ? riskOf(overview.warnings.items) : { level: null, items: [] },
    competency: overview.competency && assessment ? competencyOf(assessment.computed, overview.competency.career) : null,
    roadmapCourses,
    computedAt: computedAt.toISOString(),
  };
}

/** The row of a student whose reading failed: counted, but nothing is known ("Chưa đủ dữ liệu"). */
export function fallbackRow(identity: ReportIdentity, now: Date): ReportRow {
  return {
    ...identity,
    majorName: MAJORS.find((major) => major.code === identity.majorCode)?.label ?? null,
    specialtyName: specialtyLabel(identity.specialtyCode),
    hasTranscript: false, status: "unknown", gpa: null, lastTermGpa: null, series: [], passedCredits: null, totalCredits: null,
    expectedCredits: null, risk: { level: null, items: [] }, competency: null, roadmapCourses: null, computedAt: now.toISOString(),
  };
}

/** The newest completed roadmap of the student (Lộ trình AI đề xuất keeps showing it while a newer one is written). */
async function readNewestCompletedRoadmap(db: PoolClient, userId: string): Promise<RoadmapRow | null> {
  const result = await db.query<RoadmapRow>(
    `SELECT id,assessment_id AS "assessmentId",status,error_code AS "errorCode",created_at AS "createdAt",completed_at AS "completedAt",
       ai_model AS model,facts,ai_output AS output,false AS recent
     FROM stu_roadmaps WHERE user_id=$1 AND status='completed' ORDER BY created_at DESC,id DESC LIMIT 1`, [userId]);
  return result.rows[0] ?? null;
}

export type ReadOverview = (db: PoolClient, userId: string, now: Date) => Promise<OverviewResponse>;

/**
 * One student's row, read inside the caller's REPEATABLE READ READ ONLY transaction. The assessment details are read only
 * when Tổng quan shows that assessment (so never after a consent withdrawal).
 */
/** The student's own Tổng quan without the planner's credit check, which no report shows. */
const readOverviewForReports: ReadOverview = (db, userId, now) => readOverview(db, userId, now, { plannerFacts: false });

export async function readReportRow(db: PoolClient, identity: ReportIdentity, now: Date, read: ReadOverview = readOverviewForReports): Promise<ReportRow> {
  const overview = await read(db, identity.userId, now);
  const assessment = overview.competency ? await newestAssessment(db, identity.userId) : null;
  const roadmap = await readNewestCompletedRoadmap(db, identity.userId);
  let courses: ReportRow["roadmapCourses"] = null;
  if (roadmap) {
    try { courses = roadmapCoursesOf(roadmap, vietnamToday(now)); }
    catch (error) { console.error(`[reports] roadmap not read (${error instanceof Error ? error.name : "error"})`); }
  }
  return rowFromParts(identity, overview, assessment, courses, now);
}
