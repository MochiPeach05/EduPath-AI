// "Lộ trình học tập" after Stellic (user 2026-10-24): the data of "Theo dõi tiến độ" (the requirements with every course's
// state, official or with the plan) and "Lên kế hoạch (thủ công)" (terms, the courses still needed, the checks while
// planning). Mirrors apps/api/src/study-plan. Pure.
import { termName } from "./display-format";
import { formatDateTime, joinVi } from "./student-roadmap-data";

export type CourseState = "passed" | "exempt" | "failed" | "in_progress" | "graded_unknown" | "not_taken" | "not_in_curriculum";
export type PlanTerm = { code: string; courses: { code: string }[] };
/**
 * What taking the AI roadmap's proposal in added (the page does it at once, from any tab): the roadmap's time, the term
 * it prepares, the courses added (none when all were planned already) and when. Kept in the plan so "Kế hoạch học kỳ"
 * names them on later visits too.
 */
export type AiAdded = { completedAt: string; term: string; codes: string[]; addedAt: string };
/** roadmapId: the AI roadmap whose proposal the plan has taken in; aiAdded: what that added (null: nothing to say). */
export type StudyPlanData = { schemaVersion: 1; roadmapId?: string | null; aiAdded?: AiAdded | null; terms: PlanTerm[] };
export type TriState = "pass" | "fail" | "unknown";
/** What the cohort's own training plan asks of a CTĐT elective group ("Chọn 2 trong 6 HP…", study-plan/context.ts planChoices). */
export type StudyPlanChoice = { courses: number; sections: { label: string; termCode: string }[] };

export type StudyPlanCourse = {
  code: string; name: string; credits: number; type: string; kind: "mandatory" | "elective"; group: string | null;
  conditional: boolean; applicable: boolean; specialtyName: string | null; standardTerm: string | null;
  prerequisites: string[]; prior: string[]; state: CourseState; inProgressTerm: string | null; onlyInStandard?: boolean;
  planTerm: string | null; offeredTerms: string[]; grade: string | null; takenTerm: string | null; attempts: number; equivalent: string | null;
};
export type StudyPlanGraduationGroup = {
  label: string; kind: "mandatory" | "elective"; unit: "môn" | "TC"; required: number | null; passed: number | null; status: TriState; courseCodes: string[];
};
export type StudyPlanUnmatched = { code: string; name: string; credits: number; state: CourseState; grade: string | null; term: string | null };
/**
 * The elective group a thesis course completes alone and the way the system advises for it (apps/api/src/study-plan/
 * context.ts planThesis; user 2026-11-03: "điểm của sinh viên mà ổn thì đề xuất làm đồ án tốt nghiệp còn thấp thì làm 2 môn
 * thay thế đó", "TB tích lũy từ 2,80"): the thesis from a cumulative GPA of 2,80, Chuyên đề tốt nghiệp 1 and 2 below it, a
 * path already taken stays; way null without a GPA. replacements: the replacement path; others: the group's other courses.
 * reason: "điểm TB tích lũy 3,10, từ 2,80 trở lên" when the GPA decided.
 */
export type StudyPlanThesis = {
  group: string; thesis: string; replacements: string[]; others: string[];
  path: "not_started" | "thesis_in_progress" | "replacement"; way: "thesis" | "replacement" | null; reason: string | null;
};
export type StudyPlanContext = {
  cohortCode: string | null; specialty: string | null; specialtyLabel: string | null;
  curriculum: { name: string; totalCredits: number | null } | null; hasTranscript: boolean;
  currentTerm: string; studyTerm: string | null; admissionYear: number | null; standardTerms: string[];
  limits: { average: number; min: number; max: number } | null;
  courses: StudyPlanCourse[];
  electiveGroups: { code: string; requiredCredits: number | null; courseCodes: string[]; planChoice?: StudyPlanChoice | null }[];
  offeringUntil: string | null;
  graduation: {
    standardName: string; groups: StudyPlanGraduationGroup[];
    credits: { completed: number | null; required: number; source: "printed" | "calculated" } | null;
  } | null;
  gpa: { actual: number | null; required: number | null; scale: 4 | 10 };
  unmatched: StudyPlanUnmatched[];
  /** The thesis group still open (null: none, or the thesis passed). */
  thesis?: StudyPlanThesis | null;
};
export type StudyPlanProjection = {
  standardName: string; now: TriState; withPlan: TriState; groupCount: number;
  openGroups: { label: string; kind: "mandatory" | "elective"; unit: "môn" | "TC"; required: number | null; now: number | null; withPlan: number | null; status: TriState }[];
};
export type Saved = { version: string; data: StudyPlanData; updatedAt: string };
/**
 * The courses of the newest AI roadmap not yet taken in: term is the one it prepares, each course has its own term. Only
 * courses still missing of the student's own program (study-plan/prefill.ts, user 2026-11-03).
 */
export type AiProposal = { roadmapId: string; completedAt: string; term: string; courses: { code: string; term: string }[] };
/** A passed course the newest AI roadmap advises to improve, with the term it would go to: suggested, never added. */
export type AiSuggestion = { code: string; term: string };
/** suggested: where a student without a plan starts (the training plan's mandatory courses ahead). */
export type StudyPlanResponse = {
  context: StudyPlanContext; plan: Saved | null; suggested: StudyPlanData | null; aiProposal: AiProposal | null;
  aiSuggestions?: AiSuggestion[]; projection: StudyPlanProjection | null;
};
/**
 * Where the plan on screen came from during this visit: the training plan's prefill (not saved until the first edit), or
 * the AI roadmap's proposal taken in now (added: courses added), which Theo dõi tiến độ mentions too.
 */
export type PlanOrigin = { kind: "prefill" } | { kind: "ai"; added: number } | null;

export const STUDY_PLAN_API = "/api/student/study-plan";
export const MAX_TERMS = 15;

/* ------------------------------------------------------------------ terms */

export const termIndex = (code: string) => Number(code.slice(2, 4)) * 3 + Number(code.slice(4)) - 1;
export function nextTerm(code: string): string {
  const year = Number(code.slice(2, 4)), semester = Number(code.slice(4));
  return semester < 3 ? `HK${code.slice(2, 4)}${semester + 1}` : `HK${String((year + 1) % 100).padStart(2, "0")}1`;
}
/** "HK262" → "HK2 2026–2027", as every student page writes a term (user 2026-10-30). */
export const termLabel = (code: string): string => termName(code);

/** The terms the planner shows when nothing is saved: the running term to the end of the CTĐT, at least three. */
export function defaultTerms(context: Pick<StudyPlanContext, "currentTerm" | "standardTerms">): string[] {
  const last = context.standardTerms.at(-1);
  const terms = [context.currentTerm];
  while (terms.length < MAX_TERMS && (terms.length < 3 || (last && termIndex(terms.at(-1)!) < termIndex(last)))) terms.push(nextTerm(terms.at(-1)!));
  return terms;
}

/** The saved plan with the default terms the planner always shows (empty ones), oldest first. */
export function withTerms(context: Pick<StudyPlanContext, "currentTerm" | "standardTerms">, data: StudyPlanData | null): StudyPlanData {
  const terms = new Map((data?.terms ?? []).map((term) => [term.code, term]));
  for (const code of defaultTerms(context)) if (!terms.has(code)) terms.set(code, { code, courses: [] });
  return {
    schemaVersion: 1, roadmapId: data?.roadmapId ?? null, aiAdded: data?.aiAdded ?? null,
    terms: [...terms.values()].sort((a, b) => termIndex(a.code) - termIndex(b.code)),
  };
}

/**
 * The plan with the AI roadmap's proposal taken in: each proposed course not planned anywhere yet goes to its term (a
 * new term only while the plan has room); the plan remembers the roadmap so the same proposal is never added twice, and
 * what it added (aiAdded). Returns the plan and how many courses were added.
 */
export function applyProposal(plan: StudyPlanData, proposal: AiProposal, now = new Date()): { plan: StudyPlanData; added: number } {
  const placed = plannedTerms(plan);
  const terms = plan.terms.map((term) => ({ ...term, courses: [...term.courses] }));
  const codes: string[] = [];
  for (const item of proposal.courses) {
    const code = item.code.toUpperCase();
    if (placed.has(code)) continue;
    let term = terms.find((entry) => entry.code === item.term);
    if (!term && terms.length < MAX_TERMS) terms.push(term = { code: item.term, courses: [] });
    if (!term) continue;
    term.courses.push({ code });
    placed.set(code, item.term);
    codes.push(code);
  }
  return {
    added: codes.length,
    plan: {
      ...plan, roadmapId: proposal.roadmapId,
      aiAdded: { completedAt: proposal.completedAt, term: proposal.term, codes, addedAt: now.toISOString() },
      terms: terms.sort((a, b) => termIndex(a.code) - termIndex(b.code)),
    },
  };
}

/**
 * The plan without what an AI roadmap of before 2026-11-03 added and the plan must not hold (user 2026-11-03: improvements
 * only suggested, only missing courses, never another specialty's): an added course of another specialty, or one already
 * passed (an improvement). Only the courses the AI added (aiAdded) are looked at; returns the plan and the codes taken out.
 */
export function cleanAiAdded(context: Pick<StudyPlanContext, "courses">, plan: StudyPlanData): { plan: StudyPlanData; removed: string[] } {
  const codes = plan.aiAdded?.codes ?? [];
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const placed = plannedTerms(plan);
  const removed = codes.filter((code) => {
    const course = byCode.get(code.toUpperCase());
    return placed.has(code.toUpperCase()) && course !== undefined && (!course.applicable || isDone(course.state));
  });
  if (!removed.length) return { plan, removed };
  const cleaned = removed.reduce((next, code) => moveCourse(next, code, null), plan);
  return { plan: { ...cleaned, aiAdded: { ...plan.aiAdded!, codes: codes.filter((code) => !removed.includes(code)) } }, removed };
}

/** The courses of the thesis group's way the system advises (upper-case codes; none without a way). */
const thesisAdvised = (thesis: StudyPlanThesis) =>
  (thesis.way === "thesis" ? [thesis.thesis] : thesis.way === "replacement" ? thesis.replacements : []).map((code) => code.toUpperCase());

/**
 * The courses of the thesis group the advised way leaves out (upper-case codes; none without a way): with the thesis, the
 * replacement courses and the group's other courses; with the replacement courses, the thesis and the other courses.
 */
export function thesisLeftOut(context: Pick<StudyPlanContext, "thesis">): Set<string> {
  const thesis = context.thesis;
  if (!thesis?.way) return new Set();
  return new Set((thesis.way === "thesis" ? [...thesis.replacements, ...thesis.others] : [thesis.thesis, ...thesis.others]).map((code) => code.toUpperCase()));
}

/**
 * The plan without the thesis group's way the system does not advise (user 2026-11-03: never both ways in one plan): such
 * a course the AI roadmap added (aiAdded), or any such course while the advised way is planned, being studied or passed. A
 * course of the other way the student planned alone stays, marked (thesisHint). Returns the plan and the codes taken out.
 */
export function cleanThesisWay(context: Pick<StudyPlanContext, "thesis" | "courses">, plan: StudyPlanData): { plan: StudyPlanData; removed: string[] } {
  const leftOut = thesisLeftOut(context);
  if (!context.thesis || !leftOut.size) return { plan, removed: [] };
  const placed = plannedTerms(plan);
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const taken = (code: string) => { const state = byCode.get(code)?.state; return state !== undefined && (isDone(state) || state === "in_progress"); };
  const mixed = thesisAdvised(context.thesis).some((code) => placed.has(code) || taken(code));
  const added = new Set((plan.aiAdded?.codes ?? []).map((code) => code.toUpperCase()));
  const removed = [...placed.keys()].filter((code) => leftOut.has(code) && (mixed || added.has(code)));
  if (!removed.length) return { plan, removed };
  const cleaned = removed.reduce((next, code) => moveCourse(next, code, null), plan);
  return { plan: plan.aiAdded ? { ...cleaned, aiAdded: { ...plan.aiAdded, codes: plan.aiAdded.codes.filter((code) => !removed.includes(code.toUpperCase())) } } : cleaned, removed };
}

/**
 * The way the thesis group takes, as a clause: "hệ thống đề xuất làm Đồ án Tốt nghiệp (điểm TB tích lũy 3,10, từ 2,80 trở
 * lên)", "hệ thống đề xuất học Chuyên đề Tốt nghiệp 1 và Chuyên đề Tốt nghiệp 2 thay cho Đồ án Tốt nghiệp (…)", or the path
 * already taken. Null without a way.
 */
export function thesisAdvice(context: Pick<StudyPlanContext, "thesis" | "courses">): string | null {
  const thesis = context.thesis;
  if (!thesis?.way) return null;
  const name = (code: string) => context.courses.find((course) => course.code === code.toUpperCase())?.name ?? code;
  const reason = thesis.reason ? ` (${thesis.reason})` : "";
  if (thesis.way === "thesis") return thesis.path === "thesis_in_progress" ? `bạn đang làm ${name(thesis.thesis)}` : `hệ thống đề xuất làm ${name(thesis.thesis)}${reason}`;
  const replacements = joinVi(thesis.replacements.map(name));
  return thesis.path === "replacement"
    ? `bạn đã học theo phương án học phần thay thế ${name(thesis.thesis)} (${replacements})`
    : `hệ thống đề xuất học ${replacements} thay cho ${name(thesis.thesis)}${reason}`;
}

/** The line on a course of the thesis group's other way (planned by the student, or found by search), else null. */
export function thesisHint(context: Pick<StudyPlanContext, "thesis" | "courses">, code: string): string | null {
  const advice = thesisLeftOut(context).has(code.toUpperCase()) ? thesisAdvice(context) : null;
  return advice ? `Không cần học phần này: ${advice}.` : null;
}

/** The note on what cleanThesisWay took out of the plan, naming each course. */
export function thesisCleanedText(context: Pick<StudyPlanContext, "thesis" | "courses">, codes: readonly string[]): string {
  const advice = thesisAdvice(context);
  const group = context.thesis?.group.replace(/^Nhóm/, "nhóm");
  return `Đã bỏ khỏi kế hoạch ${courseList(context, codes)}${advice ? ` vì ${advice}` : ""}; kế hoạch chỉ giữ một phương án${group ? ` cho ${group}` : ""}.`;
}

/* ---------------------------------------------------------------- courses */

export const isDone = (state: CourseState) => state === "passed" || state === "exempt";
/** Still to plan: not done and not being studied. */
export const needsPlanning = (course: Pick<StudyPlanCourse, "state">) => !isDone(course.state) && course.state !== "in_progress";
/** Term of each planned course (upper-case code). */
export const plannedTerms = (plan: StudyPlanData) =>
  new Map(plan.terms.flatMap((term) => term.courses.map((course) => [course.code.toUpperCase(), term.code] as const)));

/** Courses being studied in a term according to the transcript (shown locked in that column). */
export const runningIn = (context: Pick<StudyPlanContext, "courses">, term: string) =>
  context.courses.filter((course) => course.state === "in_progress" && course.inProgressTerm === term);

/** conditional: the part of credits from GDTC/GDQP (môn điều kiện). */
export type TermLoad = { credits: number; conditional: number; status: "over" | "under" | "ok" | "empty" };
/**
 * Credits of a term (planned + being studied) against the limits. GDTC/GDQP count too (user 2026-10-24: a Futsal course
 * of TC102 must raise the term's total): they stay out of accumulated credits but are registered and studied that term.
 * Below the minimum only warns in HK1/HK2 and not in the last term with courses (TT 08/2021 sets the minimum for main
 * terms; the last term may be light).
 */
export function termLoad(context: Pick<StudyPlanContext, "courses" | "limits">, plan: StudyPlanData, term: string): TermLoad {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const placed = plannedTerms(plan);
  const courses = [...(plan.terms.find((item) => item.code === term)?.courses.map((course) => byCode.get(course.code.toUpperCase()))
    .filter((course): course is StudyPlanCourse => Boolean(course)) ?? []),
    ...runningIn(context, term).filter((course) => !placed.has(course.code))];
  const credits = courses.reduce((sum, course) => sum + course.credits, 0);
  const conditional = courses.reduce((sum, course) => sum + (course.conditional ? course.credits : 0), 0);
  if (!courses.length) return { credits, conditional, status: "empty" };
  const limits = context.limits;
  const lastWithCourses = [...plan.terms].reverse().find((item) => item.courses.length)?.code === term;
  const status = limits && credits > limits.max ? "over" : limits && credits < limits.min && !term.endsWith("3") && !lastWithCourses ? "under" : "ok";
  return { credits, conditional, status };
}

/** "21 TC · vượt mức tối đa 18 TC", "6 TC · dưới mức tối thiểu 9 TC", "12 TC". */
export function termLoadText(load: Pick<TermLoad, "credits" | "status">, limits: StudyPlanContext["limits"]): string {
  const credits = `${formatNumber(load.credits)} TC`;
  if (load.status === "over" && limits) return `${credits} · vượt mức tối đa ${formatNumber(limits.max)} TC`;
  if (load.status === "under" && limits) return `${credits} · dưới mức tối thiểu ${formatNumber(limits.min)} TC`;
  return credits;
}

/**
 * The codes of a course's relation (tiên quyết, học trước) that apply: for a course of the student's program, never
 * another specialty's course (the CTĐT can list every specialty's, "SV chuyên ngành CNPM … SV chuyên ngành CNDL …"; the
 * API leaves them out too, study-plan/context.ts). Another specialty's course keeps all of its own.
 */
export function ownRelations(course: Pick<StudyPlanCourse, "applicable">, codes: readonly string[], byCode: ReadonlyMap<string, Pick<StudyPlanCourse, "applicable">>): string[] {
  return course.applicable ? codes.filter((code) => byCode.get(code)?.applicable !== false) : [...codes];
}

/** notOffered: "semester" when no training plan opens the course in that semester, "term" when none opens it in that very term. */
export type PlanIssue = { prerequisites: string[]; prior: string[]; notOffered: "semester" | "term" | null };
/**
 * Checks of each planned course (Stellic flags missing prerequisites and courses not offered that term):
 * - tiên quyết: passed (or being studied) before the course's term, or planned in an earlier term;
 * - học trước: studied at least once (any result) before, or planned in an earlier term;
 * - not offered: no training plan opens the course in that semester ("semester"), or, up to the last term the plans
 *   cover, none opens it in that very term although some open it in that semester of other years ("term").
 * Codes outside the CTĐT are not checked, nor another specialty's courses for a course of the student's program (ownRelations).
 */
export function planIssues(context: Pick<StudyPlanContext, "courses" | "offeringUntil">, plan: StudyPlanData): Map<string, PlanIssue> {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const placed = plannedTerms(plan);
  const issues = new Map<string, PlanIssue>();
  for (const term of plan.terms) for (const item of term.courses) {
    const course = byCode.get(item.code.toUpperCase());
    if (!course) continue;
    const earlier = (code: string) => { const at = placed.get(code); return at !== undefined && termIndex(at) < termIndex(term.code); };
    const running = (code: string) => { const other = byCode.get(code); return other?.state === "in_progress" && (!other.inProgressTerm || termIndex(other.inProgressTerm) < termIndex(term.code)); };
    const prerequisites = ownRelations(course, course.prerequisites, byCode)
      .filter((code) => byCode.has(code) && !isDone(byCode.get(code)!.state) && !running(code) && !earlier(code));
    const prior = ownRelations(course, course.prior, byCode).filter((code) => byCode.has(code) && byCode.get(code)!.state === "not_taken" && !earlier(code));
    const offer = offering(course, term.code, context.offeringUntil);
    const notOffered = offer === "ok" ? null : offer;
    if (prerequisites.length || prior.length || notOffered) issues.set(course.code, { prerequisites, prior, notOffered });
  }
  return issues;
}

/**
 * Whether the training plans open a course in a term: "ok" when one opens it then, or nothing is known about its terms;
 * "semester" when none opens it in that semester of any year; "term" when, up to the last term the plans cover, none
 * opens it in that very term. Past that term the semester decides (a course of HK2 is opened in HK2).
 */
export function offering(course: Pick<StudyPlanCourse, "offeredTerms">, term: string, offeringUntil: string | null): "ok" | "semester" | "term" {
  if (!course.offeredTerms.length || course.offeredTerms.includes(term)) return "ok";
  if (!course.offeredTerms.some((offered) => offered.endsWith(term.slice(4)))) return "semester";
  return offeringUntil && termIndex(term) <= termIndex(offeringUntil) ? "term" : "ok";
}

/** "HK1, HK2": the semesters the training plans open a course in. */
export const offeredSemesters = (course: Pick<StudyPlanCourse, "offeredTerms">) =>
  [...new Set(course.offeredTerms.map((term) => `HK${term.slice(4)}`))].sort().join(", ");

/**
 * Whether the training plans open a course in the term after the current one, and in which semester they usually do
 * (user 2026-11-03: "ghi rõ kì sau mở hay không và thường mở ở học kì nào"): "Kỳ sau (HK2 2026–2027): có mở · thường mở
 * HK2". Every cohort's plan counts (a course one cohort studies next term is opened then); past the last term the plans
 * cover, the semester decides ("có thể mở").
 */
export function nextTermOffer(course: Pick<StudyPlanCourse, "offeredTerms">, context: Pick<StudyPlanContext, "currentTerm" | "offeringUntil">): { tone: "ok" | "warn" | "unknown"; text: string } {
  if (!course.offeredTerms.length) return { tone: "unknown", text: "Chưa có kế hoạch đào tạo nào xếp lịch mở môn này" };
  const next = nextTerm(context.currentTerm);
  const lead = `Kỳ sau (${termLabel(next)})`, usual = `thường mở ${offeredSemesters(course)}`;
  if (course.offeredTerms.includes(next)) return { tone: "ok", text: `${lead}: có mở · ${usual}` };
  if (offering(course, next, context.offeringUntil) === "ok") return { tone: "ok", text: `${lead}: có thể mở · ${usual}` };
  return { tone: "warn", text: `${lead}: không mở theo kế hoạch đào tạo · ${usual}` };
}

/** A copy of the plan with a course moved to a term (null: back to the list), creating the term when needed. */
export function moveCourse(plan: StudyPlanData, code: string, to: string | null): StudyPlanData {
  const key = code.toUpperCase();
  const terms = plan.terms.map((term) => ({ ...term, courses: term.courses.filter((course) => course.code.toUpperCase() !== key) }));
  if (to) {
    const target = terms.find((term) => term.code === to);
    if (target) target.courses.push({ code: key });
    else terms.push({ code: to, courses: [{ code: key }] });
  }
  return { ...plan, terms: terms.sort((a, b) => termIndex(a.code) - termIndex(b.code)) };
}

/**
 * Credits done, being studied and planned, against the required total (accumulated credits: GDTC/GDQP left out). Planned
 * counts only courses of the student's program; plannedOther, the planned courses of another specialty (they count
 * toward nothing, as Học phần không được tính).
 */
export function creditProgress(context: Pick<StudyPlanContext, "courses" | "curriculum" | "graduation">, plan: StudyPlanData) {
  const placed = plannedTerms(plan);
  const sum = (filter: (course: StudyPlanCourse) => boolean) => context.courses.filter((course) => !course.conditional && filter(course))
    .reduce((total, course) => total + course.credits, 0);
  const inPlan = (course: StudyPlanCourse) => placed.has(course.code) && needsPlanning(course);
  const done = context.graduation?.credits?.completed ?? sum((course) => isDone(course.state));
  return {
    done,
    running: sum((course) => course.state === "in_progress"),
    planned: sum((course) => course.applicable && inPlan(course)),
    plannedOther: sum((course) => !course.applicable && inPlan(course)),
    total: context.graduation?.credits?.required ?? context.curriculum?.totalCredits ?? null,
  };
}

/* --------------------------------------------------------- requirements */

export type AuditView = "official" | "planned";
/** done: completed (✓ green); running: being studied (✓✓ yellow); planned: in the plan (✓ yellow); needed: still needed. */
export type AuditMark = "done" | "running" | "planned" | "needed";
/**
 * The mark of a whole group: done when met by results (passed or exempt courses: ✓ green); running when the courses
 * being studied make up the rest (✓✓); planned when the plan does (✓ yellow, Theo kế hoạch only); open while still
 * short (red count); unknown when the required amount is not known (?).
 */
export type GroupMark = "done" | "running" | "planned" | "open" | "unknown";
export type AuditRow = { course: StudyPlanCourse; mark: AuditMark; plannedTerm: string | null };
export type AuditGroup = {
  id: string; label: string; unit: "môn" | "TC"; required: number | null; kind: "mandatory" | "elective";
  /** Passed (done), being studied (running), and counted with running (and planned) courses in the view, in the group's unit. */
  done: number; running: number; counted: number;
  /** Still needed in the view (red number): courses, or credits for an elective group. */
  remaining: number | null;
  /** Met by results alone: a course being studied or planned never completes a group. */
  complete: boolean;
  mark: GroupMark;
  /** The training plan's "Chọn k trong n" sections the required courses come from (a CTĐT group without "(n TC)"). */
  planChoice: StudyPlanChoice | null;
  rows: AuditRow[];
};

const MARK_ORDER: Record<AuditMark, number> = { done: 0, running: 1, planned: 2, needed: 3 };

/**
 * What a CTĐT elective group asks for without a graduation standard: its "(n TC)"; else the courses the cohort's training
 * plan has the student choose in it ("Chọn 2 trong 6 HP…", the rule the AI roadmap counts by); else nothing known.
 */
export function electiveRequirement(group: StudyPlanContext["electiveGroups"][number]): { unit: "môn" | "TC"; required: number | null; planChoice: StudyPlanChoice | null } {
  if (group.requiredCredits !== null) return { unit: "TC", required: group.requiredCredits, planChoice: null };
  if (group.planChoice?.courses) return { unit: "môn", required: group.planChoice.courses, planChoice: group.planChoice };
  return { unit: "TC", required: null, planChoice: null };
}

/**
 * The requirements as Stellic's audit shows them: the graduation standard's groups (without one, the CTĐT's mandatory
 * courses and elective groups), each course with its mark. "official" counts what is done or registered; "planned" also
 * the courses of the plan, as Stellic's Planned view does. A group is complete only by results (✓ green); one the
 * courses being studied or planned would complete shows ✓✓ or a yellow ✓.
 */
export function auditGroups(context: StudyPlanContext, plan: StudyPlanData, view: AuditView): AuditGroup[] {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const placed = plannedTerms(plan);
  const markOf = (course: StudyPlanCourse): AuditMark => isDone(course.state) ? "done" : course.state === "in_progress" ? "running"
    : view === "planned" && placed.has(course.code) ? "planned" : "needed";
  const groups = context.graduation
    ? context.graduation.groups.map((group, index) => ({
      id: `g${index}`, label: group.label, unit: group.unit, required: group.required, kind: group.kind, codes: group.courseCodes, planChoice: null,
    }))
    : [
      { id: "mandatory", label: "Học phần bắt buộc", unit: "môn" as const, required: null, kind: "mandatory" as const, planChoice: null,
        codes: context.courses.filter((course) => course.applicable && course.kind === "mandatory").map((course) => course.code) },
      ...context.electiveGroups.map((group) => ({ id: group.code, label: `Nhóm tự chọn ${group.code}`, ...electiveRequirement(group),
        kind: "elective" as const, codes: group.courseCodes.filter((code) => byCode.get(code)?.applicable) })),
    ];
  return groups.map((group) => {
    const rows = group.codes.map((code) => byCode.get(code)).filter((course): course is StudyPlanCourse => Boolean(course))
      .map((course) => ({ course, mark: markOf(course), plannedTerm: placed.get(course.code) ?? null }))
      .sort((a, b) => MARK_ORDER[a.mark] - MARK_ORDER[b.mark] || a.course.code.localeCompare(b.course.code));
    const amount = (row: AuditRow) => (group.unit === "TC" ? row.course.credits : 1);
    const total = (marks: readonly AuditMark[]) => rows.filter((row) => marks.includes(row.mark)).reduce((sum, row) => sum + amount(row), 0);
    const done = total(["done"]), running = total(["running"]), counted = total(["done", "running", "planned"]);
    const required = group.required ?? (group.unit === "môn" ? rows.length : null);
    const remaining = required === null ? null : Math.max(0, required - counted);
    const complete = required !== null && done >= required;
    const mark: GroupMark = required === null ? "unknown" : complete ? "done" : done + running >= required ? "running" : counted >= required ? "planned" : "open";
    return {
      id: group.id, label: group.label, unit: group.unit, required, kind: group.kind, done, running, counted, remaining, complete, mark,
      planChoice: group.planChoice, rows,
    };
  });
}

/**
 * What a group's summary says next to its mark: "Đã đủ 6 TC", "Đã đạt 0/6 TC · phần còn lại đang học", "Đã đạt 3/6 TC ·
 * phần còn lại đã có trong kế hoạch", "2/4 môn · còn thiếu 2 môn", "Chưa rõ số tín chỉ yêu cầu · đã có 9 TC".
 */
export function groupCountText(group: Pick<AuditGroup, "unit" | "required" | "done" | "counted" | "remaining" | "mark">): string {
  const unit = group.unit === "TC" ? "TC" : "môn";
  const amount = (value: number) => `${formatNumber(value)} ${unit}`;
  if (group.mark === "unknown" || group.required === null) {
    return `Chưa rõ số ${group.unit === "TC" ? "tín chỉ" : "môn"} yêu cầu${group.counted ? ` · đã có ${amount(group.counted)}` : ""}`;
  }
  const required = group.required;
  if (group.mark === "done") return `Đã đủ ${amount(required)}${group.done > required ? ` (đã có ${amount(group.done)})` : ""}`;
  if (group.mark === "running") return `Đã đạt ${formatNumber(group.done)}/${amount(required)} · phần còn lại đang học`;
  if (group.mark === "planned") return `Đã đạt ${formatNumber(group.done)}/${amount(required)} · phần còn lại đã có trong kế hoạch`;
  return `${formatNumber(group.counted)}/${amount(required)} · còn thiếu ${amount(group.remaining ?? 0)}`;
}

/** "Số môn cần chọn theo kế hoạch đào tạo của khóa: Chọn 2 trong 6 HP… (HK2 · 2025–2026) và Chọn 1 trong 3 HP… (HK3 · 2025–2026)." */
export const planChoiceText = (choice: StudyPlanChoice) =>
  `Số môn cần chọn theo kế hoạch đào tạo của khóa: ${joinVi(choice.sections.map((section) => `${section.label} (${termLabel(section.termCode)})`))}.`;

/* ---------------------------------------------------------- course list */

export type PoolSection = { id: string; title: string; note: string | null; courses: StudyPlanCourse[] };
/**
 * Stellic's "Tentative list" (Danh sách chờ): applicable courses not done, not being studied and not planned. With a
 * graduation standard, its groups (mandatory first, then each elective group that still needs courses or credits), then
 * the CTĐT's other courses; without one, the CTĐT's mandatory courses and elective groups; then the improvements the AI
 * roadmap suggests (passed courses, never added for the student). Another specialty's courses are not listed (user
 * 2026-11-03: "không có đề xuất môn khác chuyên ngành nữa"): search still finds them, marked. An elective group already
 * satisfied is left out: its courses are no longer needed (search still finds them).
 */
export function poolSections(context: StudyPlanContext, plan: StudyPlanData, suggestions: readonly AiSuggestion[] = []): PoolSection[] {
  const placed = plannedTerms(plan);
  const open = (course: StudyPlanCourse) => needsPlanning(course) && !placed.has(course.code);
  // The thesis group's way the system does not advise is not offered (user 2026-11-03): search still finds it, marked.
  const leftOut = thesisLeftOut(context);
  const own = context.courses.filter((course) => course.applicable && open(course) && !leftOut.has(course.code));
  const used = new Set<string>();
  const sections: PoolSection[] = [];
  const credits = (codes: Iterable<string>, filter: (course: StudyPlanCourse) => boolean) => [...codes]
    .map((code) => context.courses.find((course) => course.code === code)).filter((course): course is StudyPlanCourse => Boolean(course && filter(course)))
    .reduce((sum, course) => sum + course.credits, 0);
  const standardMandatory = context.graduation?.groups.filter((group) => group.kind === "mandatory").flatMap((group) => group.courseCodes);
  const mandatory = own.filter((course) => (standardMandatory ? standardMandatory.includes(course.code) : course.kind === "mandatory"));
  mandatory.forEach((course) => used.add(course.code));
  sections.push({ id: "mandatory", title: "Bắt buộc", note: mandatory.length ? `Còn ${mandatory.length} môn` : null, courses: mandatory });
  const groups = context.graduation
    ? context.graduation.groups.filter((group) => group.kind === "elective").map((group) => ({ id: group.label, title: group.label, required: group.required, unit: group.unit, codes: group.courseCodes }))
    : context.electiveGroups.map((group) => {
      const { required, unit } = electiveRequirement(group);
      return { id: group.code, title: `Tự chọn ${group.code}`, required, unit, codes: group.courseCodes };
    });
  for (const group of groups) {
    const courses = own.filter((course) => group.codes.includes(course.code) && !used.has(course.code));
    courses.forEach((course) => used.add(course.code));
    const covered = (course: StudyPlanCourse) => !needsPlanning(course) || placed.has(course.code);
    const counted = group.unit === "TC" ? credits(group.codes, covered)
      : group.codes.filter((code) => { const item = context.courses.find((entry) => entry.code === code); return Boolean(item && covered(item)); }).length;
    if (!courses.length || (group.required !== null && counted >= group.required)) continue;
    const note = group.required === null ? null : `Cần thêm ${group.required - counted} ${group.unit === "TC" ? "TC" : "môn"}`;
    sections.push({ id: `group-${group.id}`, title: group.title, note, courses });
  }
  const rest = own.filter((course) => !used.has(course.code));
  if (rest.length) sections.push(context.graduation
    ? { id: "other-ctdt", title: "Học phần khác trong CTĐT", note: "Tiêu chuẩn xét tốt nghiệp không yêu cầu", courses: rest }
    : { id: "electives", title: "Tự chọn khác", note: null, courses: rest });
  const improve = suggestions.map((item) => context.courses.find((course) => course.code === item.code.toUpperCase()))
    .filter((course): course is StudyPlanCourse => Boolean(course && course.applicable && course.state === "passed" && !placed.has(course.code)));
  if (improve.length) sections.push({ id: "improve", title: "Gợi ý học cải thiện", note: "Lộ trình AI gợi ý, không bắt buộc", courses: improve });
  return sections.filter((section) => section.courses.length);
}

/** Courses of the CTĐT matching a search ("lập trình", "71ITSE"), accents ignored, not done and not being studied. */
export function searchCourses(context: Pick<StudyPlanContext, "courses">, query: string): StudyPlanCourse[] {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return context.courses.filter((course) => needsPlanning(course) && words.every((word) => fold(`${course.code} ${course.name}`).includes(word))).slice(0, 30);
}

/* ---------------------------------------------------------------- labels */

/**
 * The colour of a course still needed (user 2026-10-30: "“Chưa học” tô đỏ cho cả những môn chưa tới kỳ. Màu đỏ nên để
 * dành cho Chưa đạt (F, VT)"): failed (F, VT, CT) is red; a mandatory course whose training-plan term (else CTĐT term)
 * is the current term or earlier is overdue (amber); anything else is not due yet (grey).
 */
export type NeededTone = "failed" | "overdue" | "upcoming";
export function neededTone(course: Pick<StudyPlanCourse, "state" | "kind" | "planTerm" | "standardTerm">, currentTerm: string): NeededTone {
  if (course.state === "failed") return "failed";
  const due = course.planTerm ?? course.standardTerm;
  return course.kind === "mandatory" && due !== null && termIndex(due) <= termIndex(currentTerm) ? "overdue" : "upcoming";
}

/**
 * What a row says next to its mark: the grade and term, "Đang học …", "Kế hoạch …", or why it is still needed and, with
 * the current term, whether its training-plan term has passed ("Trễ kế hoạch đào tạo") or is still ahead ("dự kiến …").
 */
export function auditNote(row: AuditRow, currentTerm?: string): string {
  const { course } = row;
  if (row.mark === "done") return [course.state === "exempt" ? "Miễn (MT)" : course.grade, course.takenTerm && termLabel(course.takenTerm)].filter(Boolean).join(" · ");
  if (row.mark === "running") return `Đang học${course.inProgressTerm ? ` · ${termLabel(course.inProgressTerm)}` : ""}`;
  if (row.mark === "planned") return `Kế hoạch${row.plannedTerm ? ` · ${termLabel(row.plannedTerm)}` : ""}`;
  const planned = row.plannedTerm ? ` · kế hoạch ${termLabel(row.plannedTerm)}` : "";
  if (course.state === "failed") return `Chưa đạt${course.grade ? ` (${course.grade})` : ""}${planned}`;
  const due = course.planTerm ?? course.standardTerm;
  if (currentTerm && due && neededTone(course, currentTerm) === "overdue") return `Trễ kế hoạch đào tạo (dự kiến ${termLabel(due)})${planned}`;
  return planned ? `Chưa học${planned}` : currentTerm && due ? `Chưa học · dự kiến ${termLabel(due)}` : "Chưa học";
}

export const unmatchedNote = (course: StudyPlanUnmatched) =>
  course.state === "in_progress" ? `Đang học${course.term ? ` · ${termLabel(course.term)}` : ""}`
    : [course.grade, course.term && termLabel(course.term)].filter(Boolean).join(" · ");

export const formatNumber = (value: number) => value.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** "Đồ án thực tập (71ITIN40304), Chuyên đề Tốt nghiệp 1 (71ITGR40203) và …": the courses by name and code. */
export function courseList(context: Pick<StudyPlanContext, "courses">, codes: readonly string[]): string {
  const names = new Map(context.courses.map((course) => [course.code, course.name]));
  return joinVi(codes.map((code) => (names.has(code.toUpperCase()) ? `${names.get(code.toUpperCase())} (${code})` : code)));
}

/** The note on what cleanAiAdded took out of the plan, naming each course. */
export function aiCleanedText(context: Pick<StudyPlanContext, "courses">, codes: readonly string[]): string {
  return `Đã bỏ khỏi kế hoạch ${codes.length} học phần lộ trình AI thêm trước đây vì không phải môn còn thiếu của chuyên ngành bạn (môn khác chuyên ngành, hoặc môn đã đạt chỉ nên gợi ý học cải thiện): ${courseList(context, codes)}.`;
}

/** The note of "Kế hoạch học kỳ" on what the AI roadmap's proposal added, naming each course. */
export function aiAddedText(context: Pick<StudyPlanContext, "courses">, added: AiAdded): string {
  if (!added.codes.length) return `Các học phần lộ trình AI đề xuất (lộ trình soạn lúc ${formatDateTime(added.completedAt)}) đã có sẵn trong kế hoạch.`;
  return `Đã thêm ${added.codes.length} học phần do lộ trình AI đề xuất (lộ trình soạn lúc ${formatDateTime(added.completedAt)}): ${courseList(context, added.codes)}. `
    + `Các học phần được xếp từ ${termLabel(added.term)} trở đi, vào học kỳ mà kế hoạch đào tạo mở môn đó; bạn điều chỉnh tiếp bên dưới.`;
}

const ERROR_MESSAGES: Record<string, string> = {
  plan_changed: "Kế hoạch vừa được sửa ở một phiên khác. Hãy tải lại trang để xem bản mới nhất.",
  invalid_plan: "Kế hoạch chưa hợp lệ nên chưa được lưu. Hãy tải lại trang.",
  plan_too_large: "Kế hoạch quá lớn để lưu.",
  account_unavailable: "Tài khoản hiện không dùng được chức năng này.",
  authentication_required: "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.",
  database_required: "Chưa kết nối được nơi lưu kế hoạch. Vui lòng thử lại sau.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
};
export const planErrorMessage = (code: string | undefined) => ERROR_MESSAGES[code ?? ""] ?? "Không xử lý được yêu cầu. Vui lòng thử lại.";
