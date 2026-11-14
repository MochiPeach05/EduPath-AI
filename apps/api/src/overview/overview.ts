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
  academicSections, conditionOnlyCodes, courseKey, hasScore, isConditionOnly, latestResultSection, printedCumulativeCredits, printedSummaryNumber,
  studyTermCode, termCode,
} from "../competency-assessment/course-state.js";
import { AssessmentError, readAssessmentInputs } from "../competency-assessment/inputs.js";
import { choiceCreditRange, choiceLabel, choiceRule, physicalEducationSlot, shortfallText } from "../competency-assessment/plan-progress.js";
import { fold, specialtyLabel } from "../competency-assessment/specialty.js";
import type { AssessmentInputs, AssessmentResult, CareerRequirementResult, CourseFact, PlanProgressResult } from "../competency-assessment/types.js";
import { MAJORS } from "../curricula/majors.js";
import { studyPlanWithRealCodes } from "../curricula/real-codes.js";
import { normalizeCohortCode, profileSpecialty } from "../graduation/resolve.js";
import { readStudentGraduation, type StudentGraduation } from "../graduation/student-graduation.js";
import type { PlanData } from "../plans/model.js";
import { newestAssessment, newestAssessmentInfo, readNewestRoadmap, readPreviousCompletedRoadmap, type RoadmapRow } from "../roadmap/jobs.js";
import { presentRoadmap } from "../roadmap/present.js";
import { nextCalendarTerm, vietnamToday } from "../roadmap/window.js";
import { consentWithdrawn } from "../student/consent.js";
import { withoutSettledReviews, type TranscriptData, type TranscriptSection } from "../student/transcript-parser.js";
import { readStudyPlanFacts, type StudyPlanContext } from "../study-plan/context.js";
import type { StudyPlanData } from "../study-plan/model.js";
import { termName } from "../term-name.js";
import type {
  OverviewCompetency, OverviewCourseState, OverviewGapStatus, OverviewGraduation, OverviewProgress, OverviewProgressTerm, OverviewResponse, OverviewRoadmap,
  OverviewRunningCourse, OverviewTerm, OverviewTermCourse, OverviewTermLoad, OverviewTranscript, PreviousRoadmapCard,
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

/**
 * Courses registered without grades in the studying term, from the transcript alone (when the engine cannot run). A course
 * starred in the transcript ("(*)") or with a GDTC/GDQP code is a condition (comp-calc-v19): listed, its credits not counted.
 */
export function transcriptRunning(data: TranscriptData, studyTerm: string | null): OverviewRunningCourse[] {
  if (!studyTerm) return [];
  const graded = new Set(data.sections.flatMap((section) => section.courses
    .filter((course) => course.score10 !== null || course.score4 !== null || course.letter?.trim() || course.result?.trim()).map((course) => courseKey(course.code))));
  const starred = /\(\s*\*\s*\)/;
  return academicSections(data).filter((section) => termCode(section) === studyTerm).flatMap((section) => section.courses)
    .filter((course) => course.score10 === null && course.score4 === null && !course.letter?.trim() && !course.result?.trim())
    .map((course) => ({
      code: courseKey(course.code), name: course.name.replace(/\s*\(\s*\*\s*\)\s*$/, "").trim(), credits: course.credits, retake: graded.has(courseKey(course.code)),
      conditionOnly: starred.test(course.name) || CONDITION_PLAN_CODE.test(course.code.trim()), skills: [],
    }));
}

/* ------------------------------------------------------------------------ */
/* Progress against the training plan */

const scoreText = (value: number) => value.toFixed(1).replace(".", ",");

/**
 * One course of a plan term as the page prints it; a failed option of a choice says what is left instead of "cần học lại".
 * A failed course says only what to do (user 2026-10-30: "Không cần ghi rõ ✗ VT (vắng thi), cần học lại ghi cần học lại
 * được rồi"); its grade stays on the transcript page. A course not taken is late only in a term before the one being studied
 * (comp-calc-v19, user 2026-11-04); in the term being studied it is that term's plan, "chưa đăng ký".
 */
export function courseRow(course: CourseFact, term: string, studyTerm: string | null, failedNote = "cần học lại"): OverviewTermCourse {
  const base = { code: course.code, name: course.name, credits: course.credits };
  const letter = course.letter?.trim().toUpperCase() || null;
  switch (course.state) {
    case "passed": return { ...base, state: "passed", detail: letter ?? (course.score10 !== null ? scoreText(course.score10) : "Đạt") };
    case "exempt": return { ...base, state: "passed", detail: "MT (miễn)" };
    case "graded_unknown": return { ...base, state: "passed", detail: "chưa rõ kết quả, đối chiếu bảng điểm" };
    case "in_progress": return { ...base, state: "running", detail: course.attempts > 1 ? "đang học lại" : "đang học" };
    case "failed": return { ...base, state: "failed", detail: failedNote };
    default:
      if (studyTerm !== null && term < studyTerm) return { ...base, state: "late", detail: "chưa học, trễ so với kế hoạch" };
      return { ...base, state: "planned", detail: term === studyTerm ? "chưa đăng ký" : "dự kiến" };
  }
}

type PlanView = { terms: OverviewProgressTerm[]; late: { code: string; name: string; term: string; credits: number }[] };

/** A plan row of a condition-only (*) course: a GDTC/GDQP code (K26–K28 DGT/DQP too), a BBKTL type or "(*)" in its name. */
const CONDITION_PLAN_CODE = /^(?:71NAD|71PE|DQP|DGT)/i;
const conditionPlanRow = (row: { code: string; name: string; type: string }) =>
  CONDITION_PLAN_CODE.test(row.code.trim()) || row.type.trim().toUpperCase() === "BBKTL" || /\(\s*\*\s*\)/.test(row.name);

/**
 * "Tín chỉ học kỳ theo kế hoạch" exactly as Kế hoạch đào tạo prints it (apps/web/src/StudentPlans.tsx termCreditsText and
 * student-plan-results.ts planTermCredits): the plan's own figure of the term, else the credits of the rows every student
 * takes (outside the term's choice, specialty and note sections, condition-only rows left out). null when the plan has no
 * figure and the term also offers rows to choose (the plan page then says the sum leaves them out) or a row has no credits.
 */
export function planTermCredits(plan: Pick<PlanData, "items" | "sections" | "terms">, termCode: string): number | null {
  const own = plan.terms.find((term) => term.code === termCode)?.sourceCredits;
  if (own !== null && own !== undefined && Number.isFinite(own)) return own;
  const sectionIds = new Set(plan.sections.map((section) => section.id));
  const counted = plan.items.filter((item) => item.termCode === termCode && !conditionPlanRow(item));
  const optional = (item: PlanData["items"][number]) => Boolean(item.sectionId) && sectionIds.has(item.sectionId);
  const core = counted.filter((item) => !optional(item));
  if (!core.length || core.some((item) => item.credits === null) || counted.some(optional)) return null;
  return core.reduce((sum, item) => sum + item.credits!, 0);
}

/**
 * What the plan view adds to the terms: the engine's progress (its credit groups), the courses registered this term, the
 * thesis group's courses off the advised way (excludedThesisReplacements) and the elective groups Xét tốt nghiệp passes.
 */
export type PlanViewExtras = {
  progress?: Pick<PlanProgressResult, "late" | "current" | "next" | "nextTerm"> | null;
  running?: readonly Omit<OverviewRunningCourse, "skills">[];
  excluded?: ReadonlySet<string>;
  doneGroups?: ReadonlySet<string>;
};
const GROUP_LABEL = /^Nhóm tự chọn (\S+):/;

/**
 * The training plan term by term for the student's specialty, with the rules of the plan progress (plan-progress.ts):
 * courses outside the curriculum, of another specialty, GDTC slots and condition-only courses are left out; a "Chọn k
 * trong n" section lists the options taken, plus what is still to choose; an elective outside such a section is listed once
 * taken, and its group, while short, as the engine's credit choice ("Nhóm tự chọn TC406: chọn 6 tín chỉ") in the term the
 * engine puts it; sections that never count ("Không tính vào tích lũy") are skipped. Since comp-calc-v19 (user 2026-11-04):
 * - plannedCredits is the term's figure on Kế hoạch đào tạo (planTermCredits; Tổng quan said 14, 17 and 0 where that page
 *   said 17, 11 and 6), else, when that page has none, the student's own: the term's courses, the options chosen in its
 *   choices (the cheapest still open for the rest) and the engine's credit groups of the term;
 * - a course is late only in a term before the one being studied; the term being studied lists, besides its plan ("chưa đăng
 *   ký"), every course registered in it (condition-only ones left out), so its runningCredits are "Đang học";
 * - lateCredits of a term: what of it is late or failed, the "còn nợ" of its chip.
 */
export function planTermsView(plan: Pick<PlanData, "items" | "sections" | "terms">, courses: readonly CourseFact[], studyTerm: string | null, extras: PlanViewExtras = {}): PlanView {
  const byCode = new Map(courses.map((course) => [courseKey(course.code), course]));
  const sections = new Map(plan.sections.map((section) => [section.id, section]));
  const items = [...plan.items].sort((a, b) => (a.termCode < b.termCode ? -1 : a.termCode > b.termCode ? 1 : a.position - b.position));
  type Slot = { label: string; need: number; options: CourseFact[] };
  const plain = new Map<string, CourseFact[]>();
  const slots = new Map<string, Map<string, Slot>>();
  // Electives outside a "Chọn k" section not taken yet (TC406's courses): their group is the engine's credit choice; a term
  // the engine says nothing of (after the next one) lists them as the plan does, the thesis way not advised left out.
  const alternatives = new Map<string, CourseFact[]>();
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
    if (course.electiveGroup !== null && course.state === "not_taken") {
      if (!extras.excluded?.has(course.code) && !extras.doneGroups?.has(course.electiveGroup)
        && !(alternatives.get(item.termCode) ?? []).some((option) => option.code === course.code)) {
        alternatives.set(item.termCode, [...(alternatives.get(item.termCode) ?? []), course]);
      }
      continue;
    }
    if (seen.has(course.code)) continue;
    seen.add(course.code);
    plain.set(item.termCode, [...(plain.get(item.termCode) ?? []), course]);
  }

  const termCodes = [...new Set([...plan.terms.map((term) => term.code), ...items.map((item) => item.termCode)])].sort();
  const late: PlanView["late"] = [];
  const passedLike = (course: CourseFact) => course.state === "passed" || course.state === "exempt" || course.state === "graded_unknown";
  const before = (term: string) => studyTerm !== null && term < studyTerm;

  // The engine's credit groups still short ("Nhóm tự chọn TC406: chọn 6 tín chỉ"), in the term it puts them: late, the term
  // being studied (its plan, comp-calc-v19) and the next term. A group of condition-only courses is left out like them.
  const progress = extras.progress ?? null;
  const conditionGroup = (options: readonly { code: string }[]) => options.length > 0 && options.every((option) => byCode.get(courseKey(option.code))?.conditionOnly === true);
  const groupRows = new Map<string, OverviewTermCourse[]>();
  /** Terms whose groups the engine covers: their courses not taken are not listed one by one. */
  const coveredGroups = new Map<string, Set<string>>();
  const addGroup = (term: string | null, label: string, credits: number, state: OverviewCourseState, detail: string) => {
    if (!term || credits <= 0) return;
    groupRows.set(term, [...(groupRows.get(term) ?? []), { code: "", name: label, credits, state, detail }]);
    const code = GROUP_LABEL.exec(label)?.[1];
    if (code) coveredGroups.set(term, new Set([...(coveredGroups.get(term) ?? []), code]));
  };
  for (const entry of progress?.late ?? []) {
    if (entry.kind === "choice" && entry.unit === "credit" && !conditionGroup(entry.options)) addGroup(entry.termCode, entry.label, entry.missingCredits, "late", "chưa chọn đủ, trễ so với kế hoạch");
  }
  for (const entry of progress?.current ?? []) {
    if (entry.kind === "choice" && entry.unit === "credit" && !conditionGroup(entry.options)) addGroup(entry.termCode, entry.label, entry.missingCredits, "planned", "chưa đăng ký");
  }
  for (const entry of progress?.next ?? []) {
    if (entry.kind === "choice" && entry.unit === "credit" && !conditionGroup(entry.options)) addGroup(progress?.nextTerm ?? null, entry.label, entry.remaining, "planned", "chọn trong các môn của nhóm");
  }
  // Every course registered in the term being studied, condition-only ones left out like everywhere in this view.
  const registered = (extras.running ?? []).filter((course) => !course.conditionOnly);

  // As the plan progress allocates them (plan-progress.ts): one course fills one choice only, earliest first; a course the
  // plan also lists on its own still fills a choice, but is not listed or counted twice. A failed option is listed in its
  // first choice only. Then, as the engine does (comp-calc-v20, user 2026-11-05: "người ta học đúng kế hoạch mà"), a choice
  // still short takes the passed or running courses of its CTĐT elective group that no choice used (taken in another term),
  // earliest choice first; and a choice of a group Xét tốt nghiệp already passes is met.
  const allocated = new Set<string>();
  const failedListed = new Set<string>();
  type Fill = { need: number; passed: CourseFact[]; running: CourseFact[]; failedOwn: CourseFact[]; others: CourseFact[]; groups: Set<string> };
  const fills = new Map<Slot, Fill>();
  for (const term of termCodes) for (const slot of slots.get(term)?.values() ?? []) {
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
    const groups = new Set(slot.options.map((option) => option.electiveGroup).filter((group): group is string => Boolean(group)));
    fills.set(slot, { need, passed, running, failedOwn, others: [], groups });
  }
  for (const term of termCodes) for (const slot of slots.get(term)?.values() ?? []) {
    const fill = fills.get(slot)!;
    let short = fill.need - fill.passed.length - fill.running.length;
    if (short <= 0 || !fill.groups.size) continue;
    const candidates = [...byCode.values()].filter((course) => course.applicable && !course.conditionOnly && course.electiveGroup !== null
      && fill.groups.has(course.electiveGroup) && !allocated.has(course.code) && !seen.has(course.code))
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    for (const course of [...candidates.filter(passedLike), ...candidates.filter((course) => course.state === "in_progress")]) {
      if (short <= 0) break;
      allocated.add(course.code);
      fill.others.push(course);
      short--;
    }
  }
  const terms = termCodes.map((term): OverviewProgressTerm => {
    const rows = (plain.get(term) ?? []).map((course) => courseRow(course, term, studyTerm));
    let ownCredits = rows.reduce((sum, row) => sum + row.credits, 0);
    let passedCredits = rows.filter((row) => row.state === "passed").reduce((sum, row) => sum + row.credits, 0);
    let lateCredits = before(term) ? rows.filter((row) => row.state === "late" || row.state === "failed").reduce((sum, row) => sum + row.credits, 0) : 0;
    let complete = rows.every((row) => row.state === "passed");
    for (const row of rows) if (row.state === "late") late.push({ code: row.code, name: row.name, term, credits: row.credits });
    for (const slot of slots.get(term)?.values() ?? []) {
      const { need, passed: ownPassed, running: ownRunning, failedOwn, others, groups } = fills.get(slot)!;
      const passed = [...ownPassed, ...others.filter(passedLike)];
      const running = [...ownRunning, ...others.filter((option) => option.state === "in_progress")];
      const short = need - passed.length - running.length;
      // A group Xét tốt nghiệp already passes needs no more of its courses (comp-calc-v20).
      const met = short > 0 && groups.size > 0 && [...groups].every((group) => extras.doneGroups?.has(group) === true);
      const missing = met ? 0 : short;
      // Any option fills the choice, so a failed one need not be retaken.
      const failedNote = missing > 0 ? "học lại hoặc chọn môn khác" : "đã chọn môn khác";
      // A course of the group taken in another term says where.
      const otherRow = (course: CourseFact) => {
        const row = courseRow(course, term, studyTerm);
        return course.term && course.term !== term ? { ...row, detail: `${row.detail} · học ở ${termName(course.term)}` } : row;
      };
      rows.push(...[...ownPassed, ...ownRunning].map((option) => courseRow(option, term, studyTerm)), ...others.map(otherRow),
        ...failedOwn.map((option) => courseRow(option, term, studyTerm, failedNote)));
      // The courses chosen, and for the ones still to choose the cheapest options still open, as the engine counts them.
      const missingCredits = missing > 0 ? choiceCreditRange(slot.options.filter((option) => !allocated.has(option.code)), missing).low : 0;
      ownCredits += [...passed, ...running].reduce((sum, option) => sum + option.credits, 0) + missingCredits;
      passedCredits += passed.reduce((sum, option) => sum + option.credits, 0);
      if (passed.length < need && !met) complete = false;
      if (missing > 0) {
        const credits = missingCredits;
        rows.push({
          code: "", name: choiceLabel(slot.label, slot.need, slot.options.length), credits,
          ...(before(term) ? { state: "late" as const, detail: "chưa chọn, trễ so với kế hoạch" }
            : term === studyTerm ? { state: "planned" as const, detail: "chưa chọn" } : { state: "planned" as const, detail: "chọn trong các môn của nhóm" }),
        });
        if (before(term)) lateCredits += credits;
      }
    }
    for (const row of groupRows.get(term) ?? []) {
      rows.push(row);
      ownCredits += row.credits;
      complete = false;
      if (row.state === "late") lateCredits += row.credits;
    }
    // A term after the one being studied: the group's courses the plan puts there, when the engine says nothing of it.
    if (studyTerm !== null && term > studyTerm) {
      for (const course of alternatives.get(term) ?? []) {
        if (course.electiveGroup && coveredGroups.get(term)?.has(course.electiveGroup)) continue;
        rows.push({ code: course.code, name: course.name, credits: course.credits, state: "planned", detail: `dự kiến · tự chọn ${course.electiveGroup}` });
      }
    }
    if (term === studyTerm) {
      for (const course of registered) {
        if (rows.some((row) => row.code && courseKey(row.code) === courseKey(course.code))) continue;
        const planned = byCode.get(courseKey(course.code))?.plannedTerm ?? null;
        rows.push({
          code: course.code, name: course.name, credits: course.credits, state: "running",
          detail: `${course.retake ? "đang học lại" : "đang học"}${planned && planned !== term ? ` · kế hoạch ${termName(planned)}` : ""}`,
        });
      }
    }
    const runningCredits = rows.filter((row) => row.state === "running").reduce((sum, row) => sum + row.credits, 0);
    const state = studyTerm === null ? "planned" : term < studyTerm ? (complete ? "done" : "late") : term === studyTerm ? "running" : "planned";
    return { term: termRef(term), state, passedCredits, plannedCredits: planTermCredits(plan, term) ?? ownCredits, lateCredits, runningCredits, courses: rows };
  });
  return { terms, late };
}

/**
 * The courses registered without grades, in the term being studied (in the CTĐT or not); conditionOnly: a GDTC/GDQP course
 * (the engine's flag, else the condition codes or a GDTC/GDQP code), listed but counted in no credit total (comp-calc-v19).
 */
export function registeredCourses(engine: Engine, conditionCodes: ReadonlySet<string> = new Set()): Omit<OverviewRunningCourse, "skills">[] {
  const condition = (code: string) => isConditionOnly(code, conditionCodes) || CONDITION_PLAN_CODE.test(code.trim());
  // A GDTC course filled by a PE elective being studied (comp-calc-v21) is listed as that elective, the course registered.
  const inCurriculum = engine.courses.filter((course) => course.state === "in_progress")
    .map((course) => ({ code: course.filledBy?.code ?? course.code, name: course.filledBy?.name ?? course.name, credits: course.credits, retake: course.attempts > 1,
      conditionOnly: course.conditionOnly || condition(course.code) }));
  const outside = engine.transcript.notInCurriculum.filter((course) => course.state === "in_progress")
    .map((course) => ({ code: course.code, name: course.name ?? course.code, credits: course.credits, retake: false, conditionOnly: condition(course.code) }));
  return [...inCurriculum, ...outside].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/** Credits of the courses that count (condition-only ones left out). */
const countedCredits = (courses: readonly { credits: number; conditionOnly: boolean }[]) =>
  courses.filter((course) => !course.conditionOnly).reduce((sum, course) => sum + course.credits, 0);

type ProgressArgs = {
  engine: Engine;
  plan: Pick<PlanData, "items" | "sections" | "terms"> | null;
  studyTerm: string | null;
  /** Required by the graduation standard, else the training plan. */
  totalCredits: number | null;
  /** The transcript's printed accumulated credits. */
  printedCredits: number | null;
  /** The courses registered in the term being studied ("Học kỳ này"); from the engine when not given. */
  running?: readonly Omit<OverviewRunningCourse, "skills">[];
};

/**
 * The progress block: the credit totals and the plan terms (empty, blocked "plan_unavailable", without a plan). The bar adds
 * up to the program (user 2026-11-04: 109 + 5 + 20 = 134 on a bar of 126, "Còn lại 0 TC" under "Còn lại sau kỳ này 12 TC"):
 * passed + running + late + rest = total. remaining (everything after this term) = total − passed − running; late = the
 * engine's late credits (comp-calc-v19: terms before the one being studied, no condition-only credits), never more than
 * remaining (passed credits outside the plan's courses leave less to do than the plan lists); rest = remaining − late.
 */
export function progressOverview({ engine, plan, studyTerm, totalCredits, printedCredits, running = registeredCourses(engine) }: ProgressArgs): { progress: OverviewProgress; late: PlanView["late"] } {
  const doneGroups = new Set((engine.graduation?.groups ?? []).filter((group) => group.kind === "elective" && group.status === "pass" && group.curriculumElectiveCode)
    .map((group) => group.curriculumElectiveCode!));
  const view = plan ? planTermsView(plan, engine.courses, studyTerm, {
    progress: engine.progress, running, excluded: new Set(engine.excludedThesisReplacements ?? []), doneGroups,
  }) : { terms: [], late: [] };
  const passedCredits = printedCredits ?? engine.transcript.creditCheck.computed;
  // "Đang học" is "Học kỳ này": every course registered, condition-only ones left out.
  const runningCredits = countedCredits(running);
  const remainingCredits = totalCredits === null ? null : Math.max(0, totalCredits - passedCredits - runningCredits);
  const engineLate = engine.progress?.lateCredits ?? view.late.reduce((sum, course) => sum + course.credits, 0);
  const lateCredits = remainingCredits === null ? engineLate : Math.min(engineLate, remainingCredits);
  const restCredits = remainingCredits === null ? null : remainingCredits - lateCredits;
  const ahead = view.terms.filter((term) => studyTerm !== null && term.term.code > studyTerm && term.plannedCredits > 0);
  const termsLeft = plan ? ahead.length : null;
  // No plan term left: no pace ("0 kỳ · ~12 TC/kỳ" before); the page says the plan's terms are over and what is left.
  const creditsPerTerm = remainingCredits === null || termsLeft === null || termsLeft === 0 ? null : Math.ceil(remainingCredits / termsLeft);
  return {
    progress: {
      blocked: plan ? null : "plan_unavailable",
      totalCredits, passedCredits, runningCredits, lateCredits, restCredits, remainingCredits, termsLeft, creditsPerTerm,
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

// A deferred roadmap (asked for while the queue was full) is queued by the server by itself (2026-11-10): "Đang soạn".
const ROADMAP_STATUS: Record<RoadmapRow["status"], OverviewRoadmap["status"]> = {
  completed: "completed", deferred: "pending", queued: "pending", processing: "pending", failed: "failed", cancelled: "failed",
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

/** What the roadmap block reads beside the roadmap itself. */
export type RoadmapContext = {
  /** The student's newest competency assessment (newestAssessmentInfo), what Lộ trình AI compares the roadmap with; null: none. */
  newestAssessmentId?: string | null;
  /** The term being studied: a course the roadmap calls late but planned for this term or later is not late (comp-calc-v19). */
  studyTerm?: string | null;
};

/**
 * The newest AI roadmap: the courses it recommends (retakes and the AI's picks first, as Lộ trình AI đề xuất lists them;
 * none while it is being written), the skills it picked, the first month of its plan that has a text, the saved Kế hoạch
 * học kỳ of its term checked as the planner checks it, and the planner's credit limits per term. Without the planner's
 * facts the saved term's credits are counted from the curriculum and not checked. stale and ended are the two notes of the
 * Lộ trình AI tab (user review 2026-11-04: the card said "Đã có" while the tab warned): made from an assessment other than the
 * newest one (roadmap/router.ts), and its window over.
 */
/** The card's part of an earlier roadmap, when it was completed (shown dimmed while a new one is written). */
export function previousRoadmapCard(card: OverviewRoadmap | null): PreviousRoadmapCard | null {
  if (!card || card.status !== "completed") return null;
  return { createdAt: card.createdAt, term: card.term, courses: card.courses, skills: card.skills, firstMonth: card.firstMonth };
}

export function roadmapOverview(
  row: RoadmapRow | null, saved: StudyPlanData | null, credits: ReadonlyMap<string, number>, now: Date, planner: PlannerFacts | null = null,
  context: RoadmapContext = {},
): OverviewRoadmap | null {
  if (!row) return null;
  const status = ROADMAP_STATUS[row.status];
  const term = row.facts.window.term ?? null;
  const view = presentRoadmap(row, vietnamToday(now));
  const courses: OverviewRoadmap["courses"] = [];
  const add = (code: string, name: string, credit: number | null, reason: string) => {
    if (courses.length < MAX_ROADMAP_COURSES && !courses.some((course) => course.code === code)) courses.push({ code, name, credits: credit ?? credits.get(courseKey(code)) ?? 0, reason });
  };
  if (status === "completed") {
    // Late is a course of a term before the one being studied (comp-calc-v19): one of the term being studied that the
    // roadmap lists as late (by its own term it will be) reads as the plan, like the progress card beside it.
    const studyTerm = context.studyTerm ?? null;
    const studyReason = (item: { source: string; choiceLabel: string | null; termCode: string | null }) =>
      item.source === "late" ? (studyTerm && item.termCode && item.termCode >= studyTerm ? "Theo kế hoạch" : "Trễ kế hoạch")
        : item.source === "choice" ? (tcCode(item.choiceLabel) ? `Tự chọn ${tcCode(item.choiceLabel)}` : "Tự chọn") : "Theo kế hoạch";
    // Retakes first (they are required), then the AI's picks in its order, then the other facts; a passed course to
    // improve only when the AI picked it.
    const study = view.study.filter((item) => item.source !== "running");
    for (const item of view.improve) if (item.action === "retake") add(item.code, item.name, item.credits, "Học lại");
    for (const item of study) if (item.advice !== null) add(item.code, item.name, item.credits, studyReason(item));
    for (const item of view.improve) if (item.advice !== null && item.action === "improve") add(item.code, item.name, item.credits, "Học cải thiện");
    for (const item of study) add(item.code, item.name, item.credits, studyReason(item));
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
    // Why the newest one failed (the Lộ trình AI tab's texts): the card says so over the previous one (2026-11-10).
    errorCode: status === "failed" ? row.errorCode : null,
    createdAt: new Date(row.createdAt).toISOString(),
    term: term ? termRef(term) : null,
    courses,
    skills: status === "completed" ? (picked.length ? picked : view.skills.filter((skill) => skill.kind !== "deepen").slice(0, MAX_STRENGTHS)).map((skill) => skill.name) : [],
    firstMonth: month && monthText ? { label: `Tháng ${Number(month.start.slice(5, 7))}/${month.start.slice(0, 4)}`, text: monthText } : null,
    plan,
    limits: planner?.limits ? { min: planner.limits.min, max: planner.limits.max } : null,
    stale: Boolean(context.newestAssessmentId && row.assessmentId !== context.newestAssessmentId),
    ended: view.ended,
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
  // The engine's condition codes (the standard's, else the CTĐT's GDTC/GDQP block) also mark a course outside the CTĐT.
  const conditions = conditionOnlyCodes(inputs.graduation.standard?.data ?? null, inputs.curriculum.courses);
  return registeredCourses(engine, conditions).map((course) => ({ ...course, skills: skillsOf(course.code) }));
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
      inputs = await readAssessmentInputs(db, userId, { weightsOptional: true });
      engine = assessWithoutHistory(inputs);
    } catch (error) {
      if (!(error instanceof AssessmentError)) throw error;
      blocked = error.code;
    }
  }
  const graduationData = await readStudentGraduation(db, userId);
  const graduation = graduationOverview(graduationData);
  // The engine reads the CTĐT with the real codes (curricula/real-codes.ts); a plan saved before 2026-11-10 may name such a
  // course by the file's code.
  const fileCodes = Object.entries(inputs?.curriculum.fileCodes ?? {});
  const savedPlan = await readSavedPlan(db, userId);
  const saved = savedPlan && fileCodes.length ? studyPlanWithRealCodes(savedPlan, new Map(fileCodes.map(([real, file]) => [file, real]))) : savedPlan;
  const printedCredits = transcript ? printedCumulativeCredits(transcript) : null;
  const totalCredits = graduationData.evaluation?.credits?.required ?? inputs?.plan.revision?.data.totalCredits ?? null;
  // "Học kỳ này": the courses registered in the term being studied; "Đang học" and its term in the progress card count them.
  const running = engine && inputs ? runningOverview(engine, inputs) : transcript ? transcriptRunning(transcript, studyTerm) : [];

  let progress: OverviewProgress | null = null;
  let late: { code: string; name: string; term: string }[] = [];
  if (transcript && engine && inputs) {
    const built = progressOverview({
      engine, plan: inputs.plan.revision?.data ?? null, studyTerm, running,
      totalCredits, printedCredits: printedCredits === null || Number.isNaN(printedCredits) ? null : printedCredits,
    });
    progress = built.progress;
    late = built.late;
  } else if (transcript) {
    const runningCredits = countedCredits(running);
    const passed = printedCredits === null || Number.isNaN(printedCredits) ? 0 : printedCredits;
    const remainingCredits = totalCredits === null ? null : Math.max(0, totalCredits - passed - runningCredits);
    progress = {
      blocked, totalCredits, passedCredits: passed, runningCredits, lateCredits: 0, restCredits: remainingCredits, remainingCredits,
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
  // The staleness rule of the Lộ trình AI tab (roadmap/router.ts): made from an assessment other than the newest one.
  const newestAssessmentId = roadmapRow ? (await newestAssessmentInfo(db, userId))?.id ?? null : null;
  const newest = roadmapOverview(roadmapRow, saved, credits, now, roadmapRow && options.plannerFacts !== false ? await readPlannerFacts(db, userId, now) : null,
    { newestAssessmentId, studyTerm });
  // While a new roadmap is written or failed, the newest completed one before it (the Lộ trình AI tab shows it too).
  const earlier = roadmapRow && newest && newest.status !== "completed" ? await readPreviousCompletedRoadmap(db, userId, roadmapRow.id) : null;
  const roadmap = newest && newest.status !== "completed"
    ? { ...newest, previous: previousRoadmapCard(earlier && roadmapOverview(earlier, saved, credits, now, null, { newestAssessmentId, studyTerm })) }
    : newest;

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
  // Choices of the terms before the one being studied (comp-calc-v19), their shortfall in the unit of the requirement.
  const electives: WarningInput["electives"] = (engine?.progress?.late ?? []).flatMap((entry) => entry.kind === "choice" && !entry.conditionOnly
    ? [{ label: entry.label, code: tcCode(entry.label), term: entry.termCode, unit: entry.unit, missing: entry.missing, missingCredits: entry.missingCredits, shortfall: shortfallText(entry) }]
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
