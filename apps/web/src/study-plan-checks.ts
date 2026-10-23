// "Lộ trình học tập" (STU-PLAN-01–07): the page's types and the checks it shows while the student drags courses
// (credits per term, tiên quyết / học trước, timetable clashes). Mirrors apps/api/src/study-plan.

export type SessionKind = "LT" | "TH";
export type CourseState = "passed" | "exempt" | "failed" | "in_progress" | "graded_unknown" | "not_taken" | "not_in_curriculum";
export type PlanSession = { kind: SessionKind; day: number | null; block: number | null };
export type PlanCourse = { code: string; sessions: PlanSession[] };
export type PlanTerm = { code: string; courses: PlanCourse[] };
export type StudyPlanData = { schemaVersion: 1; terms: PlanTerm[] };

export type StudyPlanCourse = {
  code: string; name: string; credits: number; type: string; kind: "mandatory" | "elective"; group: string | null;
  conditional: boolean; applicable: boolean; specialtyName: string | null; standardTerm: string | null; sessions: SessionKind[];
  prerequisites: string[]; prior: string[]; state: CourseState; inProgressTerm: string | null;
  /** In the graduation standard but not in the CTĐT. */
  onlyInStandard?: boolean;
};
export type StudyPlanGraduationGroup = { label: string; kind: "mandatory" | "elective"; unit: "môn" | "TC"; required: number | null; passed: number | null; courseCodes: string[] };
export type StudyPlanContext = {
  cohortCode: string | null; specialty: string | null; specialtyLabel: string | null;
  curriculum: { name: string; totalCredits: number | null } | null; hasTranscript: boolean;
  currentTerm: string; admissionYear: number | null; standardTerms: string[];
  limits: { average: number; min: number; max: number } | null;
  courses: StudyPlanCourse[];
  electiveGroups: { code: string; requiredCredits: number | null; courseCodes: string[] }[];
  graduation: { standardName: string; groups: StudyPlanGraduationGroup[] } | null;
};
export type TriState = "pass" | "fail" | "unknown";
export type StudyPlanProjection = {
  standardName: string; now: TriState; withPlan: TriState; groupCount: number;
  openGroups: { label: string; kind: "mandatory" | "elective"; unit: "môn" | "TC"; required: number | null; now: number | null; withPlan: number | null; status: TriState }[];
};

/** Thứ 2 … Chủ nhật (8) × blocks of 3 periods, as the school's period times (study-plan/model.ts). */
export const DAYS = [2, 3, 4, 5, 6, 7, 8] as const;
export const dayLabel = (day: number) => (day === 8 ? "Chủ nhật" : `Thứ ${day}`);
export const BLOCKS = [
  { block: 1, periods: "1–3", time: "07:00–09:25" },
  { block: 2, periods: "4–6", time: "09:35–12:00" },
  { block: 3, periods: "7–9", time: "13:00–15:25" },
  { block: 4, periods: "10–12", time: "15:35–18:00" },
  { block: 5, periods: "13–15", time: "18:05–20:20" },
] as const;
export const MAX_TERMS = 15;
export const MAX_SESSIONS = 6;

export const termIndex = (code: string) => Number(code.slice(2, 4)) * 3 + Number(code.slice(4)) - 1;
export function nextTerm(code: string): string {
  const year = Number(code.slice(2, 4)), semester = Number(code.slice(4));
  return semester < 3 ? `HK${code.slice(2, 4)}${semester + 1}` : `HK${String((year + 1) % 100).padStart(2, "0")}1`;
}
/** "HK262" → "HK2 · 2026-2027". */
export function termLabel(code: string): string {
  const year = 2000 + Number(code.slice(2, 4));
  return `HK${code.slice(4)} · ${year}-${year + 1}`;
}

export const isDone = (state: CourseState) => state === "passed" || state === "exempt";
/** Still to plan: not done and not being studied. */
export const needsPlanning = (course: Pick<StudyPlanCourse, "state">) => !isDone(course.state) && course.state !== "in_progress";
/** Credits counted against the limits: GDTC/GDQP stay out, as in accumulated credits. */
export const limitCredits = (course: Pick<StudyPlanCourse, "credits" | "conditional">) => (course.conditional ? 0 : course.credits);

/** The terms the page shows when nothing is saved: the running term to the end of the CTĐT, at least three. */
export function defaultTerms(context: Pick<StudyPlanContext, "currentTerm" | "standardTerms">): string[] {
  const last = context.standardTerms.at(-1);
  const terms = [context.currentTerm];
  while (terms.length < MAX_TERMS && (terms.length < 3 || (last && termIndex(terms.at(-1)!) < termIndex(last)))) terms.push(nextTerm(terms.at(-1)!));
  return terms;
}

/** Term of each planned course (upper-case code). */
export const plannedTerms = (plan: StudyPlanData) =>
  new Map(plan.terms.flatMap((term) => term.courses.map((course) => [course.code.toUpperCase(), term.code] as const)));

/** Courses being studied in a term according to the transcript (shown locked in that column). */
export const runningIn = (context: Pick<StudyPlanContext, "courses">, term: string) =>
  context.courses.filter((course) => course.state === "in_progress" && course.inProgressTerm === term);

export type TermLoad = { credits: number; conditional: number; status: "over" | "under" | "ok" | "empty" };
/**
 * Credits of a term (planned + being studied) against the limits. Below the minimum only warns in HK1/HK2 and not in
 * the last term with courses (TT 08/2021 sets the minimum for main terms; the last term may be light).
 */
export function termLoad(context: Pick<StudyPlanContext, "courses" | "limits">, plan: StudyPlanData, term: string): TermLoad {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const courses = [...(plan.terms.find((item) => item.code === term)?.courses.map((course) => byCode.get(course.code.toUpperCase())).filter((course): course is StudyPlanCourse => Boolean(course)) ?? []),
    ...runningIn(context, term).filter((course) => !plannedTerms(plan).has(course.code))];
  const credits = courses.reduce((sum, course) => sum + limitCredits(course), 0);
  const conditional = courses.reduce((sum, course) => sum + (course.conditional ? course.credits : 0), 0);
  if (!courses.length) return { credits, conditional, status: "empty" };
  const limits = context.limits;
  const lastWithCourses = [...plan.terms].reverse().find((item) => item.courses.length)?.code === term;
  const status = limits && credits > limits.max ? "over"
    : limits && credits < limits.min && term.endsWith("3") === false && !lastWithCourses ? "under" : "ok";
  return { credits, conditional, status };
}

export type ConditionIssue = { prerequisites: string[]; prior: string[] };
/**
 * Tiên quyết: passed (or being studied) before the course's term, or planned in an earlier term. Học trước: studied at
 * least once (any result) before, or planned in an earlier term. Codes outside the CTĐT are not checked.
 */
export function conditionIssues(context: Pick<StudyPlanContext, "courses">, plan: StudyPlanData): Map<string, ConditionIssue> {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const placed = plannedTerms(plan);
  const issues = new Map<string, ConditionIssue>();
  for (const term of plan.terms) for (const item of term.courses) {
    const course = byCode.get(item.code.toUpperCase());
    if (!course) continue;
    const earlier = (code: string) => { const at = placed.get(code); return at !== undefined && termIndex(at) < termIndex(term.code); };
    const running = (code: string) => { const other = byCode.get(code); return other?.state === "in_progress" && (!other.inProgressTerm || termIndex(other.inProgressTerm) < termIndex(term.code)); };
    const prerequisites = course.prerequisites.filter((code) => byCode.has(code) && !isDone(byCode.get(code)!.state) && !running(code) && !earlier(code));
    const prior = course.prior.filter((code) => byCode.has(code) && byCode.get(code)!.state === "not_taken" && !earlier(code));
    if (prerequisites.length || prior.length) issues.set(course.code, { prerequisites, prior });
  }
  return issues;
}

/** Sessions of a term that share a day and block with another session ("code#index"). */
export function clashes(term: PlanTerm | undefined): Set<string> {
  const slots = new Map<string, string[]>();
  for (const course of term?.courses ?? []) course.sessions.forEach((session, index) => {
    if (session.day === null || session.block === null) return;
    const key = `${session.day}-${session.block}`;
    slots.set(key, [...(slots.get(key) ?? []), `${course.code}#${index}`]);
  });
  return new Set([...slots.values()].filter((list) => list.length > 1).flat());
}

/** Credits done, being studied and planned, against the CTĐT total (accumulated credits: GDTC/GDQP left out). */
export function creditProgress(context: Pick<StudyPlanContext, "courses" | "curriculum">, plan: StudyPlanData) {
  const placed = plannedTerms(plan);
  const sum = (filter: (course: StudyPlanCourse) => boolean) => context.courses.filter((course) => !course.conditional && filter(course)).reduce((total, course) => total + course.credits, 0);
  return {
    done: sum((course) => isDone(course.state)),
    running: sum((course) => course.state === "in_progress" && !placed.has(course.code)),
    planned: sum((course) => placed.has(course.code) && !isDone(course.state)),
    total: context.curriculum?.totalCredits ?? null,
  };
}

export type PoolSection = { id: string; title: string; note: string | null; courses: StudyPlanCourse[] };
/**
 * "Môn còn phải học": applicable courses not done, not being studied and not planned. With a graduation standard, its
 * groups (mandatory first, each elective group with the credits it still needs), then the CTĐT's other courses; without
 * one, the CTĐT's mandatory courses and elective groups. Other specialties' courses come last.
 */
export function poolSections(context: StudyPlanContext, plan: StudyPlanData): PoolSection[] {
  const placed = plannedTerms(plan);
  const open = (course: StudyPlanCourse) => needsPlanning(course) && !placed.has(course.code);
  const own = context.courses.filter((course) => course.applicable && open(course));
  const used = new Set<string>();
  const sections: PoolSection[] = [];
  const credits = (codes: Iterable<string>, filter: (course: StudyPlanCourse) => boolean) => [...codes]
    .map((code) => context.courses.find((course) => course.code === code)).filter((course): course is StudyPlanCourse => Boolean(course && filter(course)))
    .reduce((sum, course) => sum + course.credits, 0);
  const standardMandatory = context.graduation?.groups.filter((group) => group.unit === "môn").flatMap((group) => group.courseCodes);
  const mandatory = own.filter((course) => (standardMandatory ? standardMandatory.includes(course.code) : course.kind === "mandatory"));
  mandatory.forEach((course) => used.add(course.code));
  sections.push({ id: "mandatory", title: "Bắt buộc", note: mandatory.length ? `Còn ${mandatory.length} môn` : null, courses: mandatory });
  const groups = context.graduation
    ? context.graduation.groups.filter((group) => group.unit === "TC").map((group) => ({ id: group.label, title: group.label, required: group.required, codes: group.courseCodes }))
    : context.electiveGroups.map((group) => ({ id: group.code, title: `Tự chọn ${group.code}`, required: group.requiredCredits, codes: group.courseCodes }));
  for (const group of groups) {
    const courses = own.filter((course) => group.codes.includes(course.code) && !used.has(course.code));
    if (!courses.length) continue;
    courses.forEach((course) => used.add(course.code));
    const counted = credits(group.codes, (course) => !needsPlanning(course) || placed.has(course.code));
    const note = group.required === null ? null : counted >= group.required ? `Đã đủ ${group.required} TC` : `Cần thêm ${group.required - counted} TC`;
    sections.push({ id: `group-${group.id}`, title: group.title, note, courses });
  }
  const rest = own.filter((course) => !used.has(course.code));
  if (rest.length) sections.push(context.graduation
    ? { id: "other-ctdt", title: "Môn khác trong CTĐT", note: "Tiêu chuẩn xét tốt nghiệp không yêu cầu", courses: rest }
    : { id: "electives", title: "Tự chọn khác", note: null, courses: rest });
  const other = context.courses.filter((course) => !course.applicable && open(course));
  if (other.length) sections.push({ id: "other", title: "Chuyên ngành khác", note: "Không tính cho chuyên ngành của bạn", courses: other });
  return sections;
}

/** A copy of the plan with a course moved to a term (null: back to the pool), creating the term when needed. */
export function moveCourse(plan: StudyPlanData, context: Pick<StudyPlanContext, "courses">, code: string, to: string | null): StudyPlanData {
  const key = code.toUpperCase();
  const existing = plan.terms.flatMap((term) => term.courses).find((course) => course.code.toUpperCase() === key);
  const info = context.courses.find((course) => course.code === key);
  // A course keeps its sessions (and their places) when it moves; a new one starts with LT/TH from its periods.
  const moved: PlanCourse = existing ? { ...existing, sessions: existing.sessions.map((session) => ({ ...session, day: null, block: null })) }
    : { code: key, sessions: (info?.sessions ?? ["LT"]).map((kind) => ({ kind, day: null, block: null })) };
  const terms = plan.terms.map((term) => ({ ...term, courses: term.courses.filter((course) => course.code.toUpperCase() !== key) }));
  if (to) {
    const target = terms.find((term) => term.code === to);
    if (target) target.courses.push(existing && plan.terms.find((term) => term.code === to)?.courses.some((course) => course.code.toUpperCase() === key) ? existing : moved);
    else terms.push({ code: to, courses: [moved] });
  }
  return { ...plan, terms: terms.sort((a, b) => termIndex(a.code) - termIndex(b.code)) };
}

/** A copy of the plan with one session of a course placed on a slot (null: unplaced). */
export function placeSession(plan: StudyPlanData, term: string, code: string, index: number, slot: { day: number; block: number } | null): StudyPlanData {
  return { ...plan, terms: plan.terms.map((item) => item.code !== term ? item : { ...item, courses: item.courses.map((course) => course.code !== code ? course
    : { ...course, sessions: course.sessions.map((session, at) => at === index ? { ...session, day: slot?.day ?? null, block: slot?.block ?? null } : session) }) }) };
}

/** A copy of the plan with a session added (LT, or TH when the course has none) or removed. */
export function changeSessions(plan: StudyPlanData, term: string, code: string, change: { add: true } | { remove: number }): StudyPlanData {
  return { ...plan, terms: plan.terms.map((item) => item.code !== term ? item : { ...item, courses: item.courses.map((course) => {
    if (course.code !== code) return course;
    if ("remove" in change) return { ...course, sessions: course.sessions.filter((_, at) => at !== change.remove) };
    if (course.sessions.length >= MAX_SESSIONS) return course;
    const kind: SessionKind = course.sessions.some((session) => session.kind === "TH") || !course.sessions.length ? "LT" : "TH";
    return { ...course, sessions: [...course.sessions, { kind, day: null, block: null }] };
  }) }) };
}

/** The suggested plan, keeping the weekly places of courses that stay in the same term. */
export function mergeSuggestion(current: StudyPlanData, suggested: StudyPlanData): StudyPlanData {
  const before = new Map(current.terms.flatMap((term) => term.courses.map((course) => [`${term.code}:${course.code.toUpperCase()}`, course] as const)));
  return { ...suggested, terms: suggested.terms.map((term) => ({ ...term, courses: term.courses.map((course) => before.get(`${term.code}:${course.code.toUpperCase()}`) ?? course) })) };
}
