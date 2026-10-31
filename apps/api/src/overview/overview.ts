// Tổng quan (STU-PROG-01…03, 2026-10-30; user: "Ok triển khai đi" on the preview): the whole student dashboard in one
// read, apps/web/src/overview-types.ts. Each part reuses what its own page computes:
// - the transcript's printed figures (never recomputed), as Trợ lý AI reads them (withoutSettledReviews);
// - the progress against the cohort's training plan from the competency engine's course states, run live on the current
//   transcript without the course–skill weights (no competency score is shown from it);
// - the graduation check of Điều kiện xét tốt nghiệp (readStudentGraduation);
// - the latest stored competency assessment, never computed here (it needs the student's consent; none once withdrawn);
// - the latest AI roadmap as Lộ trình học tập shows it (presentRoadmap) and the saved Kế hoạch học kỳ;
// - the "Cần chú ý" warnings (warnings.ts) and Trợ lý AI's suggested questions (assistant/readiness.ts).
// The builders are pure; readOverview does the reading, inside the caller's REPEATABLE READ READ ONLY transaction.
import type { PoolClient } from "pg";
import { readReadiness, suggestedQuestions } from "../assistant/readiness.js";
import { assessWithoutHistory } from "../competency-assessment/calculate.js";
import { FIT_LABELS } from "../competency-assessment/constants.js";
import {
  academicSections, courseKey, hasScore, latestResultSection, printedCumulativeCredits, printedSummaryNumber, studyTermCode, termCode,
} from "../competency-assessment/course-state.js";
import { AssessmentError, readAssessmentInputs } from "../competency-assessment/inputs.js";
import { choiceLabel, choiceRule, physicalEducationSlot } from "../competency-assessment/plan-progress.js";
import { fold, specialtyLabel } from "../competency-assessment/specialty.js";
import type { AssessmentInputs, AssessmentResult, CareerRequirementResult, CourseFact } from "../competency-assessment/types.js";
import { MAJORS } from "../curricula/majors.js";
import { normalizeCohortCode, profileSpecialty } from "../graduation/resolve.js";
import { readStudentGraduation, type StudentGraduation } from "../graduation/student-graduation.js";
import type { PlanData } from "../plans/model.js";
import { newestAssessment, readNewestRoadmap, type RoadmapRow } from "../roadmap/jobs.js";
import { presentRoadmap } from "../roadmap/present.js";
import { nextCalendarTerm, vietnamToday } from "../roadmap/window.js";
import { consentWithdrawn } from "../student/consent.js";
import { withoutSettledReviews, type TranscriptData, type TranscriptSection } from "../student/transcript-parser.js";
import { readStudyPlanFacts, type StudyPlanContext } from "../study-plan/context.js";
import type { StudyPlanData } from "../study-plan/model.js";
import { termName } from "../term-name.js";
import type {
  OverviewCompetency, OverviewGapStatus, OverviewGraduation, OverviewProgress, OverviewProgressTerm, OverviewResponse, OverviewRoadmap,
  OverviewRunningCourse, OverviewTerm, OverviewTermCourse, OverviewTermLoad, OverviewTranscript,
} from "./types.js";
import { gpaText, overviewWarnings, type WarningInput } from "./warnings.js";

type Engine = Omit<AssessmentResult, "history">;
const DAY = 24 * 3600 * 1000;
/** Strengths and missing career skills shown. */
const MAX_STRENGTHS = 3;
const MAX_GAPS = 4;
/** Courses of the AI roadmap shown, and missing courses named in one graduation condition. */
const MAX_ROADMAP_COURSES = 6;
const MAX_NAMED_COURSES = 3;

/* ------------------------------------------------------------------------ */
/* Terms */

/** "HK261" with its label "HK1 2026–2027", written the one way of every student page (user 2026-10-30: "Học kỳ đang được gọi theo 4 kiểu"). */
export const termRef = (code: string): OverviewTerm => ({ code, label: termName(code) });

/** The next term of the calendar (roadmap/window.ts) and how many days until it starts, in Vietnam time. */
export function nextTermOverview(now: Date): OverviewResponse["terms"]["next"] {
  const today = vietnamToday(now);
  const next = nextCalendarTerm(today);
  if (!next.term) return null;
  const daysUntil = Math.round((Date.parse(`${next.start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  return { ...termRef(next.term), start: next.start, end: next.end, daysUntil };
}

/* ------------------------------------------------------------------------ */
/* Transcript */

/**
 * Folded summary labels of the VLU transcript. Each term prints three averages on the 4-point scale (user 2026-10-31: "hãy
 * xem cách tính của bảng điểm thật và học theo"): "Điểm TB học kỳ" (that term, failed courses included), "Điểm TB học tập"
 * (every registered credit so far, failed courses included; printed next to "Tổng số tín chỉ đăng ký") and "Điểm TB tích
 * lũy" (passed courses only; next to "Tổng số tín chỉ tích lũy"). All three are copied as printed, never recomputed.
 */
const TERM_GPA4 = /diem\s*(?:tb|trung\s*binh)\s*hoc\s*ky\b.*he\s*4(?!\d)/;
const STUDY_GPA4 = /diem\s*(?:tb|trung\s*binh)\s*hoc\s*tap.*he\s*4(?!\d)/;
const CUMULATIVE_GPA4 = /diem\s*(?:tb|trung\s*binh)\s*tich\s*luy.*he\s*4(?!\d)/;
const CUMULATIVE_GPA10 = /diem\s*(?:tb|trung\s*binh)\s*tich\s*luy.*he\s*10/;
const CUMULATIVE_RANK = /xep\s*loai.*tich\s*luy/;

/** A printed number, null when missing, unreadable or conflicting. */
const printed = (section: TranscriptSection | undefined, label: RegExp, max: number) => {
  const value = printedSummaryNumber(section, (text) => label.test(text), max);
  return value === null || Number.isNaN(value) ? null : value;
};
const printedText = (section: TranscriptSection | undefined, label: RegExp) =>
  section?.summaries.find((summary) => summary.value?.trim() && label.test(fold(summary.label ?? "")))?.value?.trim() ?? null;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** The printed figures of the latest graded term and the GPA of every graded term (transfer section left out). */
export function transcriptOverview(data: TranscriptData, updatedAt: Date | string): OverviewTranscript {
  const series = academicSections(data).filter(hasScore).flatMap((section) => {
    const code = termCode(section);
    return code ? [{ term: termRef(code), termGpa4: printed(section, TERM_GPA4, 4), studyGpa4: printed(section, STUDY_GPA4, 4), cumulativeGpa4: printed(section, CUMULATIVE_GPA4, 4) }] : [];
  });
  const latest = latestResultSection(data);
  const last = series.at(-1)?.cumulativeGpa4 ?? null;
  const before = series.at(-2)?.cumulativeGpa4 ?? null;
  const credits = printedCumulativeCredits(data);
  return {
    updatedAt: new Date(updatedAt).toISOString(),
    gpa4: printed(latest, CUMULATIVE_GPA4, 4),
    studyGpa4: printed(latest, STUDY_GPA4, 4),
    gpa10: printed(latest, CUMULATIVE_GPA10, 10),
    rank: printedText(latest, CUMULATIVE_RANK),
    credits: credits === null || Number.isNaN(credits) ? null : credits,
    gpaChange: last !== null && before !== null ? round2(last - before) : null,
    series,
  };
}

/** Courses registered without grades in the studying term, from the transcript alone (when the engine cannot run). */
export function transcriptRunning(data: TranscriptData, studyTerm: string | null): OverviewRunningCourse[] {
  if (!studyTerm) return [];
  const graded = new Set(data.sections.flatMap((section) => section.courses
    .filter((course) => course.score10 !== null || course.score4 !== null || course.letter?.trim() || course.result?.trim()).map((course) => courseKey(course.code))));
  return academicSections(data).filter((section) => termCode(section) === studyTerm).flatMap((section) => section.courses)
    .filter((course) => course.score10 === null && course.score4 === null && !course.letter?.trim() && !course.result?.trim())
    .map((course) => ({ code: courseKey(course.code), name: course.name.replace(/\s*\(\s*\*\s*\)\s*$/, "").trim(), credits: course.credits, retake: graded.has(courseKey(course.code)), skills: [] }));
}

/* ------------------------------------------------------------------------ */
/* Progress against the training plan */

const scoreText = (value: number) => value.toFixed(1).replace(".", ",");

/**
 * One course of a plan term as the page prints it; a failed option of a choice says what is left instead of "cần học lại".
 * A failed course says only what to do (user 2026-10-30: "Không cần ghi rõ ✗ VT (vắng thi), cần học lại ghi cần học lại
 * được rồi"); its grade stays on the transcript page.
 */
export function courseRow(course: CourseFact, term: string, studyTerm: string | null, failedNote = "cần học lại"): OverviewTermCourse {
  const base = { code: course.code, name: course.name, credits: course.credits };
  const due = studyTerm !== null && term <= studyTerm;
  const letter = course.letter?.trim().toUpperCase() || null;
  switch (course.state) {
    case "passed": return { ...base, state: "passed", detail: letter ?? (course.score10 !== null ? scoreText(course.score10) : "Đạt") };
    case "exempt": return { ...base, state: "passed", detail: "MT (miễn)" };
    case "graded_unknown": return { ...base, state: "passed", detail: "chưa rõ kết quả, đối chiếu bảng điểm" };
    case "in_progress": return { ...base, state: "running", detail: course.attempts > 1 ? "đang học lại" : "đang học" };
    case "failed": return { ...base, state: "failed", detail: failedNote };
    default: return due ? { ...base, state: "late", detail: "chưa học, trễ so với kế hoạch" } : { ...base, state: "planned", detail: "dự kiến" };
  }
}

type PlanView = { terms: OverviewProgressTerm[]; late: { code: string; name: string; term: string; credits: number }[] };

/**
 * The training plan term by term for the student's specialty, with the rules of the plan progress (plan-progress.ts):
 * courses outside the curriculum, of another specialty, GDTC slots and condition-only courses are left out; a "Chọn k
 * trong n" section counts k of its options (min credits) and lists the options taken, plus what is still to choose;
 * an elective outside such a section is listed once taken (its group is checked by the graduation conditions); sections
 * that never count ("Không tính vào tích lũy") are skipped.
 */
export function planTermsView(plan: Pick<PlanData, "items" | "sections" | "terms">, courses: readonly CourseFact[], studyTerm: string | null): PlanView {
  const byCode = new Map(courses.map((course) => [courseKey(course.code), course]));
  const sections = new Map(plan.sections.map((section) => [section.id, section]));
  const items = [...plan.items].sort((a, b) => (a.termCode < b.termCode ? -1 : a.termCode > b.termCode ? 1 : a.position - b.position));
  type Slot = { label: string; need: number; options: CourseFact[] };
  const plain = new Map<string, CourseFact[]>();
  const slots = new Map<string, Map<string, Slot>>();
  const seen = new Set<string>();
  for (const item of items) {
    if (physicalEducationSlot(item.name) !== null) continue;
    const course = byCode.get(courseKey(item.code));
    if (!course || !course.applicable || course.conditionOnly) continue;
    const section = item.sectionId ? sections.get(item.sectionId) : undefined;
    const rule = section ? choiceRule(section.label) : null;
    if (section && rule?.choice && rule.informational) continue;
    if (section && rule?.choice && rule.k !== null) {
      const termSlots = slots.get(item.termCode) ?? new Map<string, Slot>();
      const slot = termSlots.get(section.id) ?? { label: section.label, need: rule.k, options: [] };
      if (!slot.options.some((option) => option.code === course.code)) slot.options.push(course);
      termSlots.set(section.id, slot);
      slots.set(item.termCode, termSlots);
      continue;
    }
    if (course.electiveGroup !== null && course.state === "not_taken") continue;
    if (seen.has(course.code)) continue;
    seen.add(course.code);
    plain.set(item.termCode, [...(plain.get(item.termCode) ?? []), course]);
  }

  const termCodes = [...new Set([...plan.terms.map((term) => term.code), ...items.map((item) => item.termCode)])].sort();
  const late: PlanView["late"] = [];
  const passedLike = (course: CourseFact) => course.state === "passed" || course.state === "exempt" || course.state === "graded_unknown";
  // As the plan progress allocates them: one course fills one choice only, earliest first; a course the plan also lists
  // on its own still fills a choice, but is not listed or counted twice. A failed option is listed in its first choice only.
  const allocated = new Set<string>();
  const failedListed = new Set<string>();
  const terms = termCodes.map((term): OverviewProgressTerm => {
    const rows = (plain.get(term) ?? []).map((course) => courseRow(course, term, studyTerm));
    let plannedCredits = rows.reduce((sum, row) => sum + row.credits, 0);
    let passedCredits = rows.filter((row) => row.state === "passed").reduce((sum, row) => sum + row.credits, 0);
    let complete = rows.every((row) => row.state === "passed");
    for (const row of rows) if (row.state === "late") late.push({ code: row.code, name: row.name, term, credits: row.credits });
    for (const slot of slots.get(term)?.values() ?? []) {
      const unit = Math.min(...slot.options.map((option) => option.credits));
      const usable = slot.options.filter((option) => option.state !== "not_taken" && !allocated.has(option.code));
      const elsewhere = usable.filter((option) => seen.has(option.code) && (passedLike(option) || option.state === "in_progress"))
        .slice(0, Math.min(slot.need, Math.max(slot.options.length, 1)));
      for (const option of elsewhere) allocated.add(option.code);
      const need = Math.max(0, Math.min(slot.need, Math.max(slot.options.length, 1)) - elsewhere.length);
      const own = usable.filter((option) => !seen.has(option.code));
      const passed = own.filter(passedLike).slice(0, need);
      const running = own.filter((option) => option.state === "in_progress").slice(0, need - passed.length);
      for (const option of [...passed, ...running]) allocated.add(option.code);
      const failedOwn = own.filter((option) => option.state === "failed" && !failedListed.has(option.code));
      for (const option of failedOwn) failedListed.add(option.code);
      const missing = need - passed.length - running.length;
      // Any option fills the choice, so a failed one need not be retaken.
      const failedNote = missing > 0 ? "học lại hoặc chọn môn khác" : "đã chọn môn khác";
      rows.push(...[...passed, ...running].map((option) => courseRow(option, term, studyTerm)),
        ...failedOwn.map((option) => courseRow(option, term, studyTerm, failedNote)));
      plannedCredits += need * unit;
      passedCredits += passed.reduce((sum, option) => sum + option.credits, 0);
      if (passed.length < need) complete = false;
      if (missing > 0) {
        const due = studyTerm !== null && term <= studyTerm;
        rows.push({
          code: "", name: choiceLabel(slot.label, slot.need, slot.options.length), credits: missing * unit, state: due ? "late" : "planned",
          detail: due ? "chưa chọn, trễ so với kế hoạch" : "chọn trong các môn của nhóm",
        });
      }
    }
    const state = studyTerm === null ? "planned" : term < studyTerm ? (complete ? "done" : "late") : term === studyTerm ? "running" : "planned";
    return { term: termRef(term), state, passedCredits, plannedCredits, courses: rows };
  });
  return { terms, late };
}

type ProgressArgs = {
  engine: Engine;
  plan: Pick<PlanData, "items" | "sections" | "terms"> | null;
  studyTerm: string | null;
  /** Required by the graduation standard, else the training plan. */
  totalCredits: number | null;
  /** The transcript's printed accumulated credits. */
  printedCredits: number | null;
};

/** The progress block: the credit totals and the plan terms (empty, blocked "plan_unavailable", without a plan). */
export function progressOverview({ engine, plan, studyTerm, totalCredits, printedCredits }: ProgressArgs): { progress: OverviewProgress; late: PlanView["late"] } {
  const view = plan ? planTermsView(plan, engine.courses, studyTerm) : { terms: [], late: [] };
  const passedCredits = printedCredits ?? engine.transcript.creditCheck.computed;
  const runningCredits = engine.courses.filter((course) => course.state === "in_progress" && !course.conditionOnly).reduce((sum, course) => sum + course.credits, 0)
    + engine.transcript.notInCurriculum.filter((course) => course.state === "in_progress").reduce((sum, course) => sum + course.credits, 0);
  const lateCredits = engine.progress?.lateCredits ?? view.late.reduce((sum, course) => sum + course.credits, 0);
  const remainingCredits = totalCredits === null ? null : Math.max(0, totalCredits - passedCredits - runningCredits);
  const ahead = view.terms.filter((term) => studyTerm !== null && term.term.code > studyTerm && term.plannedCredits > 0);
  const termsLeft = plan ? ahead.length : null;
  const creditsPerTerm = remainingCredits === null || termsLeft === null ? null
    : termsLeft > 0 ? Math.ceil(remainingCredits / termsLeft) : remainingCredits > 0 ? remainingCredits : null;
  return {
    progress: {
      blocked: plan ? null : "plan_unavailable",
      totalCredits, passedCredits, runningCredits, lateCredits, remainingCredits, termsLeft, creditsPerTerm,
      planMaxPerTerm: ahead.length ? Math.max(...ahead.map((term) => term.plannedCredits)) : null,
      terms: view.terms,
    },
    late: view.late,
  };
}

/* ------------------------------------------------------------------------ */
/* Graduation */

const courseName = (name: string) => name.replace(/\s*\(\s*\*\s*\)\s*/g, " ").replace(/\s+/g, " ").trim();
const named = (names: readonly string[]) => `${names.slice(0, MAX_NAMED_COURSES).join(", ")}${names.length > MAX_NAMED_COURSES ? ", …" : ""}`;

/** The conditions of Điều kiện xét tốt nghiệp: accumulated credits, every group of the standard, the GPA minimum. */
export function graduationOverview({ standard, evaluation }: Pick<StudentGraduation, "standard" | "evaluation">): OverviewGraduation | null {
  if (!standard || !evaluation) return null;
  const conditions: OverviewGraduation["conditions"] = [];
  if (evaluation.credits) {
    conditions.push({
      label: "Tín chỉ tích lũy", done: evaluation.credits.lower ?? 0, need: evaluation.credits.required, unit: "TC",
      met: evaluation.credits.status === "pass", note: null,
    });
  }
  for (const group of evaluation.groups) {
    const met = group.status === "pass";
    const missing = group.courses.filter((course) => course.state !== "passed" && course.state !== "exempt").map((course) => courseName(course.name));
    const note = met ? null
      : group.kind === "mandatory" && missing.length ? `Còn: ${named(missing)}`
        : group.remaining !== null ? `Còn thiếu ${group.remaining} ${group.unit}` : null;
    // A code two groups share (the GDTC electives) keeps the evaluation's own label, which tells them apart.
    const ownCode = group.kind === "elective" && group.code && evaluation.groups.filter((other) => other.code === group.code).length === 1;
    conditions.push({
      label: ownCode ? `Nhóm tự chọn ${group.code}` : group.label,
      done: group.lower ?? 0, need: group.required, unit: group.unit, met, note,
    });
  }
  const gpa = evaluation.gpa;
  if (gpa.required !== null) {
    conditions.push({
      label: `GPA tích lũy từ ${gpaText(gpa.required)}`, done: gpa.actual === null ? "Chưa có" : gpaText(gpa.actual), need: null, unit: "",
      met: gpa.status === "pass", note: gpa.status === "unknown" ? gpa.reason || null : null,
    });
  }
  return {
    standardName: standard.data.name,
    eligible: evaluation.status === "pass",
    missing: conditions.filter((condition) => !condition.met).length,
    conditions,
  };
}

/* ------------------------------------------------------------------------ */
/* Competency */

const STATUS_ORDER: Record<CareerRequirementResult["status"], number> = { below: 0, not_studied: 1, upcoming: 2, no_data: 3, met: 4 };
const pointsText = (value: number) => (Math.round(value * 10) / 10).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
/** A 0–100 score as every page shows it (apps/web/src/display-format.ts scoreText): rounded down to the tenth. */
const shownScore = (value: number) => Math.floor(value * 10 + 1e-9) / 10;

/** The shortfall as the pages show it: the threshold minus the score as shown, so the two add up (62,5 − 59,8 = 2,7). */
function shortfall(requirement: CareerRequirementResult): number | null {
  if (requirement.score === null || !Number.isFinite(requirement.threshold)) return requirement.deficit;
  return Math.round((requirement.threshold - shownScore(requirement.score)) * 10) / 10;
}

function gapOf(requirement: CareerRequirementResult): { name: string; status: OverviewGapStatus; label: string } {
  const name = requirement.skillName ?? requirement.title;
  switch (requirement.status) {
    case "below": {
      const deficit = shortfall(requirement);
      return { name, status: "below", label: deficit === null || deficit <= 0 ? "Dưới ngưỡng" : `Dưới ngưỡng · thiếu ${pointsText(deficit)} điểm` };
    }
    case "not_studied": return { name, status: "not_studied", label: "Chưa học" };
    case "upcoming": return { name, status: "upcoming", label: requirement.upcomingTerm ? `Sắp học · ${termName(requirement.upcomingTerm)}` : "Sắp học" };
    default:
      return requirement.noDataReason === "other_specialty" || requirement.noDataReason === "elective_not_chosen"
        ? { name, status: "self_study", label: "Cần tự học" }
        : { name, status: "no_data", label: "Chưa đủ dữ liệu" };
  }
}

/**
 * The courses a skill's score comes from (evidence rows counted in the score, largest contribution first), named as the
 * CTĐT names them with the letter of the attempt that counts. Shown beside each score (user 2026-10-30: "Nhiều kỹ năng
 * cùng đúng 68 điểm … trông như số giả. Nên ghi môn làm minh chứng cạnh từng điểm").
 */
function scoreCourses(skill: AssessmentResult["skills"][number], courses: ReadonlyMap<string, CourseFact>): { name: string; letter: string | null }[] {
  const named = new Set<string>();
  return [...(skill.evidenceCourses ?? [])].filter((row) => row.role === "score").sort((a, b) => b.contribution - a.contribution).flatMap((row) => {
    const course = courses.get(row.code);
    if (!course || named.has(course.name)) return [];
    named.add(course.name);
    return [{ name: course.name, letter: course.letter?.trim() || null }];
  });
}

/**
 * The latest stored assessment: overall level, the best scored skills (GDTC/GDQP left out) with the courses their scores
 * come from, and the target career's fit with its missing skills in the order of Khoảng trống kỹ năng (Bắt buộc first,
 * then the status, then the shortfall). The fit label is read from the fit code when the result has one, so an older
 * result reads the current scale. stale: the assessment was made from another transcript, specialty or target career.
 */
export function competencyOverview(
  row: { createdAt: Date | string; computed: AssessmentResult } | null,
  current: { transcriptVersion: string | null; specialty: string | null; careerId: string | null },
): OverviewCompetency | null {
  if (!row) return null;
  const { computed } = row;
  const career = computed.career;
  const gaps = career ? [...career.requirements].filter((requirement) => requirement.status !== "met")
    .sort((a, b) => Number(b.isRequired) - Number(a.isRequired) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      || (b.deficit ?? 0) - (a.deficit ?? 0) || a.title.localeCompare(b.title, "vi"))
    .slice(0, MAX_GAPS).map(gapOf) : [];
  const meta = computed.meta;
  const courses = new Map((computed.courses ?? []).map((course) => [course.code, course]));
  return {
    assessedAt: new Date(row.createdAt).toISOString(),
    overallScore: computed.overall?.score ?? null,
    overallLevel: computed.overall?.score === null || computed.overall?.score === undefined ? null : computed.overall.levelLabel,
    strengths: computed.skills.filter((skill) => skill.score !== null && !skill.conditionOnly).slice(0, MAX_STRENGTHS)
      .map((skill) => ({ name: skill.name, score: skill.score!, courses: scoreCourses(skill, courses) })),
    career: career && {
      name: career.nameVi, fitScore: career.fitScore ?? null, fitLabel: (career.fitCode && FIT_LABELS[career.fitCode]) || career.fitLabel,
      met: career.counts.met, total: career.counts.total, gaps,
    },
    stale: (current.transcriptVersion !== null && meta.transcriptVersion !== current.transcriptVersion)
      || (meta.specialty ?? null) !== (current.specialty ?? null) || (meta.career?.id ?? null) !== (current.careerId ?? null),
  };
}

/* ------------------------------------------------------------------------ */
/* AI roadmap */

const ROADMAP_STATUS: Record<RoadmapRow["status"], OverviewRoadmap["status"]> = {
  completed: "completed", queued: "pending", processing: "pending", failed: "failed", cancelled: "failed",
};
const tcCode = (label: string | null) => /\bTC\d{3}\b/.exec(label ?? "")?.[0] ?? null;

/** What the planner knows of the student's courses and credit limits (study-plan/context.ts). */
export type PlannerFacts = Pick<StudyPlanContext, "courses" | "limits">;

/**
 * A term of the saved Kế hoạch học kỳ checked exactly as the planner checks it (apps/web/src/study-plan-data.ts
 * termLoad): its planned courses plus the courses being studied that term and planned nowhere, GDTC/GDQP included,
 * against the limits per term; below the minimum only in HK1/HK2 and not in the last term with courses. Tổng quan said
 * "20/16 TC" in green while the planner said "vượt mức tối đa 18 TC" (user 2026-10-30).
 */
export function plannedTermLoad(planner: PlannerFacts, plan: StudyPlanData, term: string): OverviewTermLoad {
  const byCode = new Map(planner.courses.map((course) => [courseKey(course.code), course]));
  const placed = new Set(plan.terms.flatMap((entry) => entry.courses.map((course) => courseKey(course.code))));
  const courses = [
    ...(plan.terms.find((entry) => entry.code === term)?.courses ?? []).flatMap((course) => byCode.get(courseKey(course.code)) ?? []),
    ...planner.courses.filter((course) => course.state === "in_progress" && course.inProgressTerm === term && !placed.has(courseKey(course.code))),
  ];
  const credits = courses.reduce((sum, course) => sum + course.credits, 0);
  if (!courses.length) return { credits, status: "empty" };
  const limits = planner.limits;
  const lastWithCourses = [...plan.terms].sort((a, b) => a.code.localeCompare(b.code)).reverse().find((entry) => entry.courses.length)?.code === term;
  const status = limits && credits > limits.max ? "over" : limits && credits < limits.min && !term.endsWith("3") && !lastWithCourses ? "under" : "ok";
  return { credits, status };
}

/**
 * The newest AI roadmap: the courses it recommends (retakes and the AI's picks first, as Lộ trình AI đề xuất lists them;
 * none while it is being written), the skills it picked, the first month of its plan that has a text, the saved Kế hoạch
 * học kỳ of its term checked as the planner checks it, and the planner's credit limits per term. Without the planner's
 * facts the saved term's credits are counted from the curriculum and not checked.
 */
export function roadmapOverview(row: RoadmapRow | null, saved: StudyPlanData | null, credits: ReadonlyMap<string, number>, now: Date, planner: PlannerFacts | null = null): OverviewRoadmap | null {
  if (!row) return null;
  const status = ROADMAP_STATUS[row.status];
  const term = row.facts.window.term ?? null;
  const view = presentRoadmap(row, vietnamToday(now));
  const courses: OverviewRoadmap["courses"] = [];
  const add = (code: string, name: string, credit: number | null, reason: string) => {
    if (courses.length < MAX_ROADMAP_COURSES && !courses.some((course) => course.code === code)) courses.push({ code, name, credits: credit ?? credits.get(courseKey(code)) ?? 0, reason });
  };
  if (status === "completed") {
    const studyReason = (source: string, label: string | null) =>
      source === "late" ? "Trễ kế hoạch" : source === "choice" ? (tcCode(label) ? `Tự chọn ${tcCode(label)}` : "Tự chọn") : "Theo kế hoạch";
    // Retakes first (they are required), then the AI's picks in its order, then the other facts; a passed course to
    // improve only when the AI picked it.
    const study = view.study.filter((item) => item.source !== "running");
    for (const item of view.improve) if (item.action === "retake") add(item.code, item.name, item.credits, "Học lại");
    for (const item of study) if (item.advice !== null) add(item.code, item.name, item.credits, studyReason(item.source, item.choiceLabel));
    for (const item of view.improve) if (item.advice !== null && item.action === "improve") add(item.code, item.name, item.credits, "Học cải thiện");
    for (const item of study) add(item.code, item.name, item.credits, studyReason(item.source, item.choiceLabel));
  }
  const picked = view.skills.filter((skill) => skill.picked);
  const month = status === "completed" ? view.months.find((entry) => entry.focus || entry.tasks.length) : undefined;
  const monthText = month ? (month.focus ?? month.tasks.join("; ")) : null;
  const termCourses = term ? saved?.terms.find((entry) => entry.code === term)?.courses ?? null : null;
  let plan: OverviewTermLoad | null = null;
  if (term && saved && termCourses) {
    if (planner) plan = plannedTermLoad(planner, saved, term);
    else {
      const total = termCourses.reduce((sum, course) => sum + (credits.get(courseKey(course.code)) ?? 0), 0);
      plan = { credits: total, status: termCourses.length ? "ok" : "empty" };
    }
  }
  return {
    status,
    createdAt: new Date(row.createdAt).toISOString(),
    term: term ? termRef(term) : null,
    courses,
    skills: status === "completed" ? (picked.length ? picked : view.skills.filter((skill) => skill.kind !== "deepen").slice(0, MAX_STRENGTHS)).map((skill) => skill.name) : [],
    firstMonth: month && monthText ? { label: `Tháng ${Number(month.start.slice(5, 7))}/${month.start.slice(0, 4)}`, text: monthText } : null,
    plan,
    limits: planner?.limits ? { min: planner.limits.min, max: planner.limits.max } : null,
  };
}

/**
 * The planner's facts for the roadmap block, in a savepoint of the caller's read-only transaction: a failure leaves the
 * block unchecked instead of failing Tổng quan.
 */
async function readPlannerFacts(db: PoolClient, userId: string, now: Date): Promise<PlannerFacts | null> {
  await db.query("SAVEPOINT overview_planner");
  try {
    const { context } = await readStudyPlanFacts(db, userId, now);
    await db.query("RELEASE SAVEPOINT overview_planner");
    return { courses: context.courses, limits: context.limits };
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT overview_planner");
    console.error(`[overview] planner facts not read (${error instanceof Error ? error.name : "error"})`);
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Courses being studied */

/** In-progress courses with the skills the faculty links to them; retake: an earlier attempt exists. */
export function runningOverview(engine: Engine, inputs: AssessmentInputs): OverviewRunningCourse[] {
  const skillNames = new Map(inputs.weights.skills.map((skill) => [skill.skillId, skill.name]));
  const skillsOf = (code: string) => [...new Set(inputs.weights.links.filter((link) => courseKey(link.courseCode) === courseKey(code))
    .sort((a, b) => b.weight - a.weight).map((link) => skillNames.get(link.skillId)).filter((name): name is string => Boolean(name)))];
  const inCurriculum = engine.courses.filter((course) => course.state === "in_progress")
    .map((course) => ({ code: course.code, name: course.name, credits: course.credits, retake: course.attempts > 1, skills: skillsOf(course.code) }));
  const outside = engine.transcript.notInCurriculum.filter((course) => course.state === "in_progress")
    .map((course) => ({ code: course.code, name: course.name ?? course.code, credits: course.credits, retake: false, skills: [] }));
  return [...inCurriculum, ...outside].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/* ------------------------------------------------------------------------ */
/* Reading */

/** The saved Kế hoạch học kỳ, when it parses (the study-plan router stores it validated). */
async function readSavedPlan(db: PoolClient, userId: string): Promise<StudyPlanData | null> {
  const row = (await db.query<{ data: StudyPlanData | null }>("SELECT data FROM stu_study_plans WHERE user_id=$1", [userId])).rows[0];
  return row?.data && Array.isArray(row.data.terms) ? row.data : null;
}

/**
 * The whole overview of one student, read inside the caller's REPEATABLE READ READ ONLY transaction. The admin reports
 * pass plannerFacts: false: they never show the roadmap's credit check, and the planner's facts cost about 180 ms a student.
 */
export async function readOverview(db: PoolClient, userId: string, now: Date = new Date(), options: { plannerFacts?: boolean } = {}): Promise<OverviewResponse> {
  const profileRow = (await db.query<{ cohort_code: string | null; specialty: string | null; major_code: string | null; career_position_id: string | null; career: string | null }>(
    `SELECT p.cohort_code,p.specialty,p.major_code,p.career_position_id,c.name_vi AS career FROM student_profiles p
      LEFT JOIN career_positions c ON c.id=p.career_position_id AND c.deleted_at IS NULL WHERE p.user_id=$1`, [userId])).rows[0];
  const specialty = profileSpecialty(profileRow?.specialty ?? null);
  const readiness = await readReadiness(db, userId);
  const transcriptRow = (await db.query<{ version: string; data: TranscriptData | null; updated_at: Date | string }>(
    "SELECT version,parsed_data AS data,updated_at FROM student_transcripts WHERE user_id=$1", [userId])).rows[0];
  const transcript = transcriptRow?.data?.sections ? withoutSettledReviews(transcriptRow.data) : null;
  const studyTerm = transcript ? studyTermCode(transcript) : null;

  // The engine on the current transcript, for the course states and the plan progress only (no weights needed).
  let inputs: AssessmentInputs | null = null;
  let engine: Engine | null = null;
  let blocked: string | null = null;
  if (transcript) {
    try {
      inputs = await readAssessmentInputs(db, userId, { careerOptional: true, weightsOptional: true });
      engine = assessWithoutHistory(inputs);
    } catch (error) {
      if (!(error instanceof AssessmentError)) throw error;
      blocked = error.code;
    }
  }
  const graduationData = await readStudentGraduation(db, userId);
  const graduation = graduationOverview(graduationData);
  const saved = await readSavedPlan(db, userId);
  const printedCredits = transcript ? printedCumulativeCredits(transcript) : null;
  const totalCredits = graduationData.evaluation?.credits?.required ?? inputs?.plan.revision?.data.totalCredits ?? null;

  let progress: OverviewProgress | null = null;
  let late: { code: string; name: string; term: string }[] = [];
  if (transcript && engine && inputs) {
    const built = progressOverview({
      engine, plan: inputs.plan.revision?.data ?? null, studyTerm,
      totalCredits, printedCredits: printedCredits === null || Number.isNaN(printedCredits) ? null : printedCredits,
    });
    progress = built.progress;
    late = built.late;
  } else if (transcript) {
    const running = transcriptRunning(transcript, studyTerm).reduce((sum, course) => sum + course.credits, 0);
    const passed = printedCredits === null || Number.isNaN(printedCredits) ? 0 : printedCredits;
    progress = {
      blocked, totalCredits, passedCredits: passed, runningCredits: running, lateCredits: 0,
      remainingCredits: totalCredits === null ? null : Math.max(0, totalCredits - passed - running),
      termsLeft: null, creditsPerTerm: null, planMaxPerTerm: null, terms: [],
    };
  }

  // Competency: only a stored assessment, and none once the student withdrew the consent ("Xóa kết quả đánh giá").
  const withdrawn = await consentWithdrawn(db, userId, "competency_assessment");
  const assessment = withdrawn ? null : await newestAssessment(db, userId);
  const competency = competencyOverview(assessment, {
    transcriptVersion: transcriptRow?.version ?? null, specialty, careerId: profileRow?.career_position_id ?? null,
  });

  const credits = new Map<string, number>((inputs?.curriculum.courses ?? []).map((course) => [courseKey(course.code), course.credits]));
  const roadmapRow = await readNewestRoadmap(db, userId);
  const roadmap = roadmapOverview(roadmapRow, saved, credits, now, roadmapRow && options.plannerFacts !== false ? await readPlannerFacts(db, userId, now) : null);
  const running = engine && inputs ? runningOverview(engine, inputs) : transcript ? transcriptRunning(transcript, studyTerm) : [];

  // "Cần chú ý"
  const failed = engine
    ? engine.courses.filter((course) => course.state === "failed" && course.electiveGroup === null && course.applicable && !course.conditionOnly)
      .map((course) => ({
        code: course.code, name: course.name, letter: course.letter, term: course.term,
        plannedIn: saved?.terms.find((term) => (studyTerm === null || term.code > studyTerm)
          && term.courses.some((entry) => courseKey(entry.code) === courseKey(course.code)))?.code ?? null,
      }))
    : [];
  const failedCodes = new Set(failed.map((course) => course.code));
  const electives: WarningInput["electives"] = (engine?.progress?.late ?? []).flatMap((entry) => entry.kind === "choice"
    ? [{ label: entry.label, code: tcCode(entry.label), term: entry.termCode, unit: entry.unit, missing: entry.missing, missingCredits: entry.missingCredits }]
    : []);
  const gpa = graduationData.evaluation?.gpa;
  const warnings = overviewWarnings({
    hasTranscript: Boolean(transcript),
    // Without the engine nothing is known; without a plan the failed courses and the GPA still are.
    blocked: transcript && !engine ? blocked ?? "unknown" : null,
    planMissing: Boolean(engine) && progress?.blocked === "plan_unavailable",
    failed,
    late: late.filter((course) => !failedCodes.has(course.code) && course.code),
    electives,
    pace: progress && progress.remainingCredits !== null && progress.termsLeft !== null
      ? { remaining: progress.remainingCredits, termsLeft: progress.termsLeft, perTerm: progress.creditsPerTerm, planMax: progress.planMaxPerTerm } : null,
    gpa: gpa && gpa.actual !== null && gpa.required !== null && gpa.status !== "unknown" ? { actual: gpa.actual, required: gpa.required } : null,
  });

  return {
    generatedAt: now.toISOString(),
    profile: {
      cohortCode: normalizeCohortCode(profileRow?.cohort_code),
      majorName: MAJORS.find((major) => major.code === profileRow?.major_code?.trim())?.label ?? null,
      specialtyName: specialtyLabel(specialty),
      careerName: profileRow?.career ?? null,
    },
    readiness,
    terms: { studying: studyTerm ? termRef(studyTerm) : null, next: nextTermOverview(now) },
    transcript: transcript && transcriptRow ? transcriptOverview(transcript, transcriptRow.updated_at) : null,
    progress,
    graduation,
    competency,
    roadmap,
    running,
    warnings,
    suggestions: suggestedQuestions(readiness),
  };
}
