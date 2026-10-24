// The "Kết quả" cell of #curriculum and #plans: one state per course code with the graduation page's
// vocabulary (◐ Đang học, Miễn thi (MT), ? Chưa rõ kết quả besides ✓/✗), the other code a course was
// counted through on #graduation (a retake with a later cohort, "⇄ Đã học trả nợ … cần chuyển điểm"),
// the plans' GDTC placeholder rows and the credits of a plan term. Pure; unit tested.
import { isConditionOnlyCourse } from "./student-curriculum-types";
import { COURSE_STATES, type GraduationEvaluationExtras, type Tone } from "./student-graduation-data";
import type { GradCourseState, GraduationEvaluation } from "./student-graduation-types";
import { attemptOutcome, INFERRED_RESULT_NOTE } from "./transcript-results";

type ResultCourse = Parameters<typeof attemptOutcome>[0];
/** A course state that rests on transcript rows ("not taken" has none). */
export type CourseResultState = Exclude<GradCourseState, "not_taken">;
export type CourseStateEntry = { state: CourseResultState; inferred: boolean };
/** A standard course counted through another printed code on #graduation (GET /api/student/graduation). */
export type CourseAlias = { code: string; viaCode: string; transfer: boolean };
export type CourseResultView = CourseStateEntry & {
  /** The result is the one of this other code (a retake with a later cohort when `transfer`). */
  via: { code: string; transfer: boolean } | null;
};

const key = (code: string) => code.trim().toUpperCase();
const isPassed = (state: CourseResultState) => state === "passed" || state === "exempt";

/**
 * One state per course code across every attempt, "Điểm bảo lưu" included, by the graduation page's rule
 * (courseState in apps/api/src/competency-assessment/course-state.ts): MT > passed > graded without a
 * readable result > registered without a grade > failed. A course failed and registered again reads
 * "Đang học", as on #graduation. Inferred: the attempts that decide the pass (or the fail) all rest on
 * a letter grade, because the printed result cell is blank.
 */
export function transcriptCourseStates(sections: readonly { courses: readonly ResultCourse[] }[]): Map<string, CourseStateEntry> {
  const attempts = new Map<string, ReturnType<typeof attemptOutcome>[]>();
  for (const course of sections.flatMap((section) => section.courses)) {
    const code = key(course.code);
    if (code) attempts.set(code, [...(attempts.get(code) ?? []), attemptOutcome(course)]);
  }
  const states = new Map<string, CourseStateEntry>();
  for (const [code, list] of attempts) {
    const deciding = (status: "pass" | "fail") => list.filter((attempt) => attempt.status === status);
    const inferred = (status: "pass" | "fail") => deciding(status).every((attempt) => attempt.inferred);
    states.set(code,
      list.some((attempt) => attempt.exempt) ? { state: "exempt", inferred: false }
        : deciding("pass").length ? { state: "passed", inferred: inferred("pass") }
          : list.some((attempt) => attempt.status === "unknown") ? { state: "graded_unknown", inferred: false }
            : list.some((attempt) => attempt.status === "pending") ? { state: "in_progress", inferred: false }
              : { state: "failed", inferred: inferred("fail") });
  }
  return states;
}

/** The other codes #graduation counted a course through: its codeAliases, or from an older server its credit transfers. */
export function graduationCourseAliases(evaluation: (GraduationEvaluation & GraduationEvaluationExtras) | null | undefined): CourseAlias[] {
  if (!evaluation) return [];
  return evaluation.codeAliases
    ?? (evaluation.creditTransfers ?? []).map((transfer) => ({ code: transfer.code, viaCode: transfer.viaCode, transfer: true }));
}

/**
 * The result of a course code: its own state, unless it is not passed and #graduation counts it as passed
 * through another code (K26 DIT0070 failed, passed as 71ITIS30103 with a later cohort): then that code's.
 */
export function courseResult(
  code: string,
  states: ReadonlyMap<string, CourseStateEntry>,
  aliases: readonly CourseAlias[] = [],
): CourseResultView | undefined {
  const own = states.get(key(code));
  if (!own || !isPassed(own.state)) {
    for (const alias of aliases) {
      if (key(alias.code) !== key(code)) continue;
      const via = states.get(key(alias.viaCode));
      if (via && isPassed(via.state)) return { ...via, via: { code: key(alias.viaCode), transfer: alias.transfer } };
    }
  }
  return own && { ...own, via: null };
}

export type CourseResultDisplay = { glyph: string; label: string; tone: Tone; notes: string[] };

/**
 * What the Kết quả cell shows, in the graduation page's words: the glyph with its label for screen
 * readers; the label is also written out unless it is a plain ✓ Đã đạt or ✗ Chưa đạt.
 */
export function courseResultDisplay(view: CourseResultView): CourseResultDisplay {
  const inferred = view.inferred ? [INFERRED_RESULT_NOTE] : [];
  if (view.via?.transfer) {
    return { glyph: "⇄", label: "Đã học trả nợ", tone: "info", notes: [`Đã học trả nợ (mã ${view.via.code}) — cần chuyển điểm`, ...inferred] };
  }
  const { glyph, label, tone } = COURSE_STATES[view.state];
  const written = view.state === "passed" || view.state === "failed" ? [] : [label];
  return { glyph, label, tone, notes: [...written, ...(view.via ? [`học với mã ${view.via.code}`] : []), ...inferred] };
}

/* ----------------------------------------------------------------- #plans */

/** Plan rows "GDTC 1"/"GDTC 2" have placeholder codes; slot n is met by n distinct passed PE electives. */
function physicalEducationSlot(name: string): number | null {
  const folded = name.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toUpperCase();
  const slot = /^(?:GDTC|GIAO DUC THE CHAT)\s*([12])$/.exec(folded);
  return slot ? Number(slot[1]) : null;
}

export type PhysicalEducationProgress = {
  /** Distinct passed PE electives, and those confirmed by a printed result or MT rather than a letter grade. */
  passed: number;
  confirmed: number;
  /** Distinct PE electives being studied. */
  inProgress: number;
  /** The CTĐT has PE elective groups (TC002/TC102): the placeholder rows stand for them. */
  groups: boolean;
};

/** Progress over the PE electives of the CTĐT's TC002/TC102 groups. */
export function physicalEducationProgress(
  courseCodes: readonly string[],
  states: ReadonlyMap<string, CourseStateEntry>,
): PhysicalEducationProgress {
  const codes = [...new Set(courseCodes.map(key))].filter(Boolean);
  let passed = 0, confirmed = 0, inProgress = 0;
  for (const code of codes) {
    const state = states.get(code);
    if (state?.state === "in_progress") inProgress++;
    if (!state || !isPassed(state.state)) continue;
    passed++;
    if (!state.inferred) confirmed++;
  }
  return { passed, confirmed, inProgress, groups: codes.length > 0 };
}

/**
 * The result of a plan row. The row's own code comes first (K26 "DGT0010 Giáo dục thể chất 1" was
 * passed under that code and has no PE groups); a "GDTC n" placeholder row stands for the n-th PE
 * elective only when its code has no result or the CTĐT has PE groups.
 */
export function studentPlanOutcome(
  item: { code: string; name: string },
  states: ReadonlyMap<string, CourseStateEntry>,
  physicalEducation: PhysicalEducationProgress,
  aliases: readonly CourseAlias[] = [],
): CourseResultView | undefined {
  const own = item.code.trim() ? courseResult(item.code, states, aliases) : undefined;
  const slot = physicalEducationSlot(item.name);
  if (!slot || (own && !physicalEducation.groups)) return own;
  if (physicalEducation.passed >= slot) return { state: "passed", inferred: physicalEducation.confirmed < slot, via: null };
  if (physicalEducation.passed + physicalEducation.inProgress >= slot) return { state: "in_progress", inferred: false, via: null };
  return own;
}

type PlanRow = { code: string; name: string; type: string; credits: number | null; sectionId: string };

/** A plan row of a condition-only (*) course: GDTC/GDQP code, a BBKTL type or "(*)" in its name. */
export const isConditionOnlyPlanRow = (row: Pick<PlanRow, "code" | "name" | "type">) =>
  isConditionOnlyCourse(row.code, row.type) || /\(\s*\*\s*\)/.test(row.name);

/**
 * Credits of a plan term without a printed total (K26): the rows every student takes, outside the
 * term's choice, specialty and note sections, without condition-only (*) rows. `partial` when the term
 * also offers rows to choose from. Null when nothing can be added up (no such row, or one without credits).
 */
export function planTermCredits(rows: readonly PlanRow[], sectionIds: ReadonlySet<string>): { credits: number; partial: boolean } | null {
  const counted = rows.filter((row) => !isConditionOnlyPlanRow(row));
  const optional = (row: PlanRow) => Boolean(row.sectionId) && sectionIds.has(row.sectionId);
  const core = counted.filter((row) => !optional(row));
  if (!core.length || core.some((row) => row.credits === null)) return null;
  return { credits: core.reduce((sum, row) => sum + row.credits!, 0), partial: counted.some(optional) };
}
