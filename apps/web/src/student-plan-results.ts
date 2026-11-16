// The "Kết quả" cell of #curriculum and #plans: one state per course code with the graduation page's
// vocabulary (◐ Đang học, Miễn thi (MT), ? Chưa rõ kết quả besides ✓/✗), the other code a course was
// counted through on #graduation (a retake with a later cohort, "⇄ Đã học trả nợ … cần chuyển điểm"),
// the plans' GDTC placeholder rows and the credits of a plan term. Pure; unit tested.
import { isConditionOnlyCourse } from "./student-curriculum-types";
import { COURSE_STATES, type GraduationEvaluationExtras, type Tone } from "./student-graduation-data";
import type { GradCourseState, GraduationEvaluation } from "./student-graduation-types";
import { attemptOutcome } from "./transcript-results";

type ResultCourse = Parameters<typeof attemptOutcome>[0];
/** A course state that rests on transcript rows ("not taken" has none). */
export type CourseResultState = Exclude<GradCourseState, "not_taken">;
export type CourseStateEntry = { state: CourseResultState; inferred: boolean };
/** A standard course counted through another printed code on #graduation (GET /api/student/graduation). */
export type CourseAlias = { code: string; viaCode: string; transfer: boolean };
export type CourseResultView = CourseStateEntry & {
  /** The result is the one of this other code (a retake with a later cohort when `transfer`). */
  via: { code: string; transfer: boolean } | null;
  /** A numbered GDTC course filled by this PE elective (physicalEducationFills): the result is that elective's. */
  filledBy?: { code: string; name: string };
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
  if (view.via?.transfer) {
    return { glyph: "⇄", label: "Đã học trả nợ", tone: "info", notes: [`Đã học trả nợ (mã ${view.via.code}) — cần chuyển điểm`] };
  }
  const { glyph, label, tone } = COURSE_STATES[view.state];
  const taken = view.filledBy ? filledByNote(view.filledBy, view.state) : null;
  // A GDTC course being studied through its elective says so once: "Đang học: Cờ vua (71PEKC10062)".
  const written = view.state === "passed" || view.state === "failed" || (taken && view.state === "in_progress") ? [] : [label];
  return { glyph, label, tone, notes: [...written, ...(view.via ? [`học với mã ${view.via.code}`] : []), ...(taken ? [taken] : [])] };
}

/* ------------------------------------------------- GDTC filled by PE */

/** "Giáo dục thể chất (1)", "Giáo dục thể chất 2 (*)", "GDTC 1": the number of a numbered GDTC course, else null (API physicalEducationNumber). */
export function physicalEducationNumber(name: string): number | null {
  const folded = name.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();
  const match = /^(?:giao duc the chat|gdtc)\s*\(?\s*(\d+)\s*\)?(?:\s*\(\s*\*\s*\))?$/.exec(folded);
  return match ? Number(match[1]) : null;
}

/** A numbered GDTC course's elective: its code, its printed name and the state of its attempts. */
export type PhysicalEducationFill = { code: string; name: string; entry: CourseStateEntry };

type FillSection = { academicYear?: string | null; semester?: string | null; courses: readonly (ResultCourse & { name?: string | null })[] };

/** "2023-2024" + "HK03" → "HK233"; "" without a term ("Điểm bảo lưu"), which comes first. */
function sectionTerm(section: FillSection): string {
  const year = /^(\d{4})\s*-\s*\d{4}$/.exec(section.academicYear?.trim() ?? "");
  const semester = Number(/(\d+)/.exec(section.semester ?? "")?.[1]);
  return year && semester >= 1 && semester <= 3 ? `HK${year[1]!.slice(2)}${semester}` : "";
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The PE electives that fill the numbered GDTC courses of the programme a page lists, as the API decides them (course-state.ts
 * physicalEducationFills, comp-calc-v21; user 2026-11-10): each PE elective 71PE… of the transcript the programme does not
 * list (`listed`), passed (MT too), then graded with an unreadable result, then being studied, the earliest term first, fills
 * one numbered course ("Giáo dục thể chất (1)", "(2)" …, in number order) not passed under its own code; a failed one fills
 * nothing. The map is keyed by the GDTC course's code.
 */
export function physicalEducationFills(
  rows: readonly { code: string; name: string }[],
  listed: ReadonlySet<string>,
  sections: readonly FillSection[],
  states: ReadonlyMap<string, CourseStateEntry>,
): Map<string, PhysicalEducationFill> {
  const seen = new Set<string>();
  const slots = rows.map((row) => ({ code: key(row.code), number: physicalEducationNumber(row.name) }))
    .filter((slot): slot is { code: string; number: number } => {
      if (!slot.code || slot.number === null || seen.has(slot.code)) return false;
      seen.add(slot.code);
      const own = states.get(slot.code)?.state;
      return !own || !isPassed(own);
    })
    .sort((a, b) => a.number - b.number || compareText(a.code, b.code));
  const fills = new Map<string, PhysicalEducationFill>();
  if (!slots.length) return fills;
  const terms = new Map<string, string[]>(), names = new Map<string, string>();
  for (const section of sections) for (const course of section.courses) {
    const code = key(course.code);
    const entry = states.get(code);
    if (!/^71PE/.test(code) || listed.has(code) || !entry || entry.state === "failed") continue;
    if (!names.has(code) && course.name?.trim()) names.set(code, course.name.trim());
    // The attempts that decide the state: a pass (or MT), a grade without a readable result, a registration.
    const status = attemptOutcome(course).status;
    const deciding = isPassed(entry.state) ? status === "pass" : entry.state === "graded_unknown" ? status === "unknown" : status === "pending";
    if (deciding) terms.set(code, [...(terms.get(code) ?? []), sectionTerm(section)]);
  }
  const rank = (state: CourseResultState) => (isPassed(state) ? 0 : state === "graded_unknown" ? 1 : 2);
  const electives = [...terms].map(([code, list]) => ({ code, term: [...list].sort(compareText)[0]!, entry: states.get(code)! }))
    .sort((a, b) => rank(a.entry.state) - rank(b.entry.state) || compareText(a.term, b.term) || compareText(a.code, b.code));
  slots.slice(0, electives.length).forEach((slot, index) => {
    const elective = electives[index]!;
    fills.set(slot.code, { code: elective.code, name: names.get(elective.code) ?? elective.code, entry: elective.entry });
  });
  return fills;
}

/** The state rank of transcriptCourseStates: MT > passed > graded without a readable result > registered > failed. */
const STATE_RANK: Record<CourseResultState, number> = { exempt: 4, passed: 3, graded_unknown: 2, in_progress: 1, failed: 0 };

/**
 * The result of a GDTC course its elective fills: its own attempts and the elective's decided as one course (the better
 * state), with the elective named. Undefined for a course nothing fills.
 */
export function filledResult(code: string, states: ReadonlyMap<string, CourseStateEntry>, fills: ReadonlyMap<string, PhysicalEducationFill>): CourseResultView | undefined {
  const fill = fills.get(key(code));
  if (!fill) return undefined;
  const own = states.get(key(code));
  const entry = own && STATE_RANK[own.state] > STATE_RANK[fill.entry.state] ? own : fill.entry;
  return { ...entry, via: null, filledBy: { code: fill.code, name: fill.name } };
}

/** "Đã học: Bóng chuyền (71PEVB10022)", "Đang học: Cờ vua (71PEKC10062)": the line under a filled GDTC course (study-plan-data filledByText). */
export function filledByNote(taken: { code: string; name: string }, state: CourseResultState): string {
  const name = taken.name.trim() && taken.name.trim() !== taken.code ? `${taken.name.trim()} (${taken.code})` : taken.code;
  return `${state === "in_progress" ? "Đang học" : "Đã học"}: ${name}`;
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
  fills: ReadonlyMap<string, PhysicalEducationFill> = new Map(),
): CourseResultView | undefined {
  const filled = item.code.trim() ? filledResult(item.code, states, fills) : undefined;
  if (filled) return filled;
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
