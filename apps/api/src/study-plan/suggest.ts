import { isPassedState } from "../competency-assessment/course-state.js";
import type { StudyPlanContext, StudyPlanCourse } from "./context.js";
import { MAX_COURSES_PER_TERM, MAX_TERMS, nextTerm, termIndex, type StudyPlanData } from "./model.js";

/** Not done and not being studied: the course still has to be planned. */
export const needsPlanning = (course: Pick<StudyPlanCourse, "state">) => !isPassedState(course.state) && course.state !== "in_progress";

/** A course the suggestion may place: applicable, and a specialty course only once the student has a specialty. */
export const plannable = (context: Pick<StudyPlanContext, "specialty">, course: Pick<StudyPlanCourse, "applicable" | "specialtyName">) =>
  course.applicable && (context.specialty !== null || course.specialtyName === null);

/**
 * The first term from `earliest` on to plan a course in: its own-plan term, else the first term a plan opens it. Past the
 * last term the plans cover (`offeringUntil`), plans repeat every year, so a term of a semester the plans open it in. With
 * no plan at all, the CTĐT term when it is ahead. Else `earliest` (the course is outside the plans: few classes).
 */
export function targetTerm(course: Pick<StudyPlanCourse, "planTerm" | "offeredTerms" | "standardTerm">, earliest: string, offeringUntil: string | null): string {
  const ahead = (term: string | null): term is string => term !== null && termIndex(term) >= termIndex(earliest);
  if (ahead(course.planTerm)) return course.planTerm;
  const offered = course.offeredTerms.find(ahead);
  if (offered) return offered;
  if (offeringUntil && course.offeredTerms.length) {
    const semesters = new Set(course.offeredTerms.map((term) => term.slice(4)));
    let term = termIndex(earliest) > termIndex(offeringUntil) ? earliest : nextTerm(offeringUntil);
    for (let guard = 0; guard < 3; term = nextTerm(term), guard++) if (semesters.has(term.slice(4))) return term;
  }
  if (!offeringUntil && ahead(course.standardTerm)) return course.standardTerm;
  return earliest;
}

/** Credits counted against the term limits: condition-only courses (GDTC/GDQP) stay out, as in accumulated credits. */
export const limitCredits = (course: Pick<StudyPlanCourse, "credits" | "conditional">) => (course.conditional ? 0 : course.credits);

/**
 * "Xếp theo kế hoạch đào tạo" (STU-PLAN-04 until the AI suggestion exists). The school opens classes mostly by the training
 * plans (kế hoạch đào tạo) of the cohorts, so a remaining course goes to (user, 2026-10-24), see targetTerm: its term in
 * the student's own plan when that is still ahead; else the next term some cohort's plan opens it (a retake, a late course,
 * K27 without a plan). Always after the terms of its unfinished prerequisites and without passing the credit limit (a
 * full term passes to the next candidate). What to plan: with a graduation standard, its groups (every mandatory course, and options of
 * an elective group in CTĐT order until its credits are met), since the standard decides graduation; without one, the
 * CTĐT's mandatory courses and the CTĐT elective groups that state their credits. The student can swap the options. A
 * student without a specialty only gets the common courses. Sessions start unplaced: the week is the student's to arrange.
 */
export function suggestStudyPlan(context: StudyPlanContext): StudyPlanData {
  const first = nextTerm(context.currentTerm);
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const chosen: StudyPlanCourse[] = context.graduation ? []
    : context.courses.filter((course) => plannable(context, course) && course.kind === "mandatory" && needsPlanning(course));
  const options = (codes: readonly string[]) => codes.map((code) => byCode.get(code)).filter((course): course is StudyPlanCourse => Boolean(course && plannable(context, course)));
  const doneCredits = (courses: readonly StudyPlanCourse[]) => courses.filter((course) => !needsPlanning(course)).reduce((sum, course) => sum + course.credits, 0);
  const fill = (courses: readonly StudyPlanCourse[], required: number) => {
    let done = doneCredits(courses);
    for (const course of courses) {
      if (done >= required) break;
      if (!needsPlanning(course) || chosen.includes(course)) continue;
      chosen.push(course);
      done += course.credits;
    }
  };
  if (context.graduation) {
    for (const group of context.graduation.groups) {
      const courses = options(group.courseCodes);
      if (group.unit === "môn") chosen.push(...courses.filter((course) => needsPlanning(course) && !chosen.includes(course)));
      else if (group.required !== null) fill(courses, group.required);
    }
  } else {
    for (const group of context.electiveGroups) if (group.requiredCredits !== null) fill(options(group.courseCodes), group.requiredCredits);
  }
  const order = (course: StudyPlanCourse) => (course.standardTerm ? termIndex(course.standardTerm) : Number.MAX_SAFE_INTEGER);
  chosen.sort((a, b) => order(a) - order(b));
  const terms = new Map<string, StudyPlanCourse[]>();
  const placedTerm = new Map<string, string>();
  const max = context.limits?.max ?? Number.POSITIVE_INFINITY;
  const used = (term: string) => (terms.get(term) ?? []).reduce((sum, course) => sum + limitCredits(course), 0);
  for (const course of chosen) {
    // After every unfinished prerequisite or prior course placed earlier in this plan.
    let earliest = first;
    for (const code of [...course.prerequisites, ...course.prior]) {
      const before = placedTerm.get(code);
      if (before && termIndex(before) >= termIndex(earliest)) earliest = nextTerm(before);
    }
    let term = targetTerm(course, earliest, context.offeringUntil);
    for (let guard = 0; guard < MAX_TERMS * 3; guard++) {
      const fits = used(term) + limitCredits(course) <= max || !(terms.get(term)?.length);
      if (fits && (terms.get(term)?.length ?? 0) < MAX_COURSES_PER_TERM) break;
      const later = targetTerm(course, nextTerm(term), context.offeringUntil);
      term = termIndex(later) > termIndex(term) ? later : nextTerm(term);
    }
    if (termIndex(term) - termIndex(first) >= MAX_TERMS) continue;
    terms.set(term, [...(terms.get(term) ?? []), course]);
    placedTerm.set(course.code, term);
  }
  const last = [...terms.keys()].sort((a, b) => termIndex(b) - termIndex(a))[0] ?? first;
  const codes: string[] = [];
  for (let term = first; termIndex(term) <= termIndex(last) && codes.length < MAX_TERMS; term = nextTerm(term)) codes.push(term);
  return {
    schemaVersion: 1,
    terms: codes.map((code) => ({
      code,
      courses: (terms.get(code) ?? []).map((course) => ({ code: course.code, sessions: course.sessions.map((kind) => ({ kind, day: null, block: null })) })),
    })),
  };
}
