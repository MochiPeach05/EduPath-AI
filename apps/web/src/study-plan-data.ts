// "Lộ trình học tập" after Stellic (user 2026-10-24): the data of "Theo dõi tiến độ" (the requirements with every course's
// state, official or with the plan) and "Lên kế hoạch (thủ công)" (terms, the courses still needed, the checks while
// planning). Mirrors apps/api/src/study-plan. Pure.

export type CourseState = "passed" | "exempt" | "failed" | "in_progress" | "graded_unknown" | "not_taken" | "not_in_curriculum";
export type PlanTerm = { code: string; courses: { code: string }[] };
export type StudyPlanData = { schemaVersion: 1; terms: PlanTerm[] };
export type TriState = "pass" | "fail" | "unknown";

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
export type StudyPlanContext = {
  cohortCode: string | null; specialty: string | null; specialtyLabel: string | null;
  curriculum: { name: string; totalCredits: number | null } | null; hasTranscript: boolean;
  currentTerm: string; studyTerm: string | null; admissionYear: number | null; standardTerms: string[];
  limits: { average: number; min: number; max: number } | null;
  courses: StudyPlanCourse[];
  electiveGroups: { code: string; requiredCredits: number | null; courseCodes: string[] }[];
  offeringUntil: string | null;
  graduation: {
    standardName: string; groups: StudyPlanGraduationGroup[];
    credits: { completed: number | null; required: number; source: "printed" | "calculated" } | null;
  } | null;
  gpa: { actual: number | null; required: number | null; scale: 4 | 10 };
  unmatched: StudyPlanUnmatched[];
};
export type StudyPlanProjection = {
  standardName: string; now: TriState; withPlan: TriState; groupCount: number;
  openGroups: { label: string; kind: "mandatory" | "elective"; unit: "môn" | "TC"; required: number | null; now: number | null; withPlan: number | null; status: TriState }[];
};
export type Saved = { version: string; data: StudyPlanData; updatedAt: string };
export type StudyPlanResponse = { context: StudyPlanContext; plan: Saved | null; projection: StudyPlanProjection | null };

export const STUDY_PLAN_API = "/api/student/study-plan";
export const MAX_TERMS = 15;

/* ------------------------------------------------------------------ terms */

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
  return { schemaVersion: 1, terms: [...terms.values()].sort((a, b) => termIndex(a.code) - termIndex(b.code)) };
}

/* ---------------------------------------------------------------- courses */

export const isDone = (state: CourseState) => state === "passed" || state === "exempt";
/** Still to plan: not done and not being studied. */
export const needsPlanning = (course: Pick<StudyPlanCourse, "state">) => !isDone(course.state) && course.state !== "in_progress";
/** Credits counted against the limits: GDTC/GDQP stay out, as in accumulated credits. */
export const limitCredits = (course: Pick<StudyPlanCourse, "credits" | "conditional">) => (course.conditional ? 0 : course.credits);

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
  const placed = plannedTerms(plan);
  const courses = [...(plan.terms.find((item) => item.code === term)?.courses.map((course) => byCode.get(course.code.toUpperCase()))
    .filter((course): course is StudyPlanCourse => Boolean(course)) ?? []),
    ...runningIn(context, term).filter((course) => !placed.has(course.code))];
  const credits = courses.reduce((sum, course) => sum + limitCredits(course), 0);
  const conditional = courses.reduce((sum, course) => sum + (course.conditional ? course.credits : 0), 0);
  if (!courses.length) return { credits, conditional, status: "empty" };
  const limits = context.limits;
  const lastWithCourses = [...plan.terms].reverse().find((item) => item.courses.length)?.code === term;
  const status = limits && credits > limits.max ? "over" : limits && credits < limits.min && !term.endsWith("3") && !lastWithCourses ? "under" : "ok";
  return { credits, conditional, status };
}

/** notOffered: "semester" when no training plan opens the course in that semester, "term" when none opens it in that very term. */
export type PlanIssue = { prerequisites: string[]; prior: string[]; notOffered: "semester" | "term" | null };
/**
 * Checks of each planned course (Stellic flags missing prerequisites and courses not offered that term):
 * - tiên quyết: passed (or being studied) before the course's term, or planned in an earlier term;
 * - học trước: studied at least once (any result) before, or planned in an earlier term;
 * - not offered: no training plan opens the course in that semester ("semester"), or, up to the last term the plans
 *   cover, none opens it in that very term although some open it in that semester of other years ("term").
 * Codes outside the CTĐT are not checked.
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
    const prerequisites = course.prerequisites.filter((code) => byCode.has(code) && !isDone(byCode.get(code)!.state) && !running(code) && !earlier(code));
    const prior = course.prior.filter((code) => byCode.has(code) && byCode.get(code)!.state === "not_taken" && !earlier(code));
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

/** Credits done, being studied and planned, against the required total (accumulated credits: GDTC/GDQP left out). */
export function creditProgress(context: Pick<StudyPlanContext, "courses" | "curriculum" | "graduation">, plan: StudyPlanData) {
  const placed = plannedTerms(plan);
  const sum = (filter: (course: StudyPlanCourse) => boolean) => context.courses.filter((course) => !course.conditional && filter(course))
    .reduce((total, course) => total + course.credits, 0);
  const done = context.graduation?.credits?.completed ?? sum((course) => isDone(course.state));
  return {
    done,
    running: sum((course) => course.state === "in_progress"),
    planned: sum((course) => placed.has(course.code) && needsPlanning(course)),
    total: context.graduation?.credits?.required ?? context.curriculum?.totalCredits ?? null,
  };
}

/* --------------------------------------------------------- requirements */

export type AuditView = "official" | "planned";
/** done: completed (✓ green); running: being studied (✓✓ yellow); planned: in the plan (✓ yellow); needed: still needed. */
export type AuditMark = "done" | "running" | "planned" | "needed";
export type AuditRow = { course: StudyPlanCourse; mark: AuditMark; plannedTerm: string | null };
export type AuditGroup = {
  id: string; label: string; unit: "môn" | "TC"; required: number | null; kind: "mandatory" | "elective";
  /** Completed, counted with running (and planned) courses in the view, in the group's unit. */
  done: number; counted: number;
  /** Still needed in the view (red number): courses, or credits for an elective group. */
  remaining: number | null;
  complete: boolean;
  rows: AuditRow[];
};

const MARK_ORDER: Record<AuditMark, number> = { done: 0, running: 1, planned: 2, needed: 3 };

/**
 * The requirements as Stellic's audit shows them: the graduation standard's groups (without one, the CTĐT's mandatory
 * courses and elective groups), each course with its mark. "official" counts what is done or registered; "planned" also
 * the courses of the plan, as Stellic's Planned view does.
 */
export function auditGroups(context: StudyPlanContext, plan: StudyPlanData, view: AuditView): AuditGroup[] {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const placed = plannedTerms(plan);
  const markOf = (course: StudyPlanCourse): AuditMark => isDone(course.state) ? "done" : course.state === "in_progress" ? "running"
    : view === "planned" && placed.has(course.code) ? "planned" : "needed";
  const groups = context.graduation
    ? context.graduation.groups.map((group, index) => ({ id: `g${index}`, label: group.label, unit: group.unit, required: group.required, kind: group.kind, codes: group.courseCodes }))
    : [
      { id: "mandatory", label: "Học phần bắt buộc", unit: "môn" as const, required: null, kind: "mandatory" as const,
        codes: context.courses.filter((course) => course.applicable && course.kind === "mandatory").map((course) => course.code) },
      ...context.electiveGroups.map((group) => ({ id: group.code, label: `Nhóm tự chọn ${group.code}`, unit: "TC" as const, required: group.requiredCredits,
        kind: "elective" as const, codes: group.courseCodes.filter((code) => byCode.get(code)?.applicable) })),
    ];
  return groups.map((group) => {
    const rows = group.codes.map((code) => byCode.get(code)).filter((course): course is StudyPlanCourse => Boolean(course))
      .map((course) => ({ course, mark: markOf(course), plannedTerm: placed.get(course.code) ?? null }))
      .sort((a, b) => MARK_ORDER[a.mark] - MARK_ORDER[b.mark] || a.course.code.localeCompare(b.course.code));
    const amount = (row: AuditRow) => (group.unit === "TC" ? row.course.credits : 1);
    const done = rows.filter((row) => row.mark === "done").reduce((sum, row) => sum + amount(row), 0);
    const counted = rows.filter((row) => row.mark !== "needed").reduce((sum, row) => sum + amount(row), 0);
    const required = group.required ?? (group.unit === "môn" ? rows.length : null);
    const remaining = required === null ? null : Math.max(0, required - counted);
    return { id: group.id, label: group.label, unit: group.unit, required, kind: group.kind, done, counted, remaining, complete: remaining === 0, rows };
  });
}

/* ---------------------------------------------------------- course list */

export type PoolSection = { id: string; title: string; note: string | null; courses: StudyPlanCourse[] };
/**
 * Stellic's "Tentative list" (Danh sách chờ): applicable courses not done, not being studied and not planned. With a
 * graduation standard, its groups (mandatory first, then each elective group that still needs courses or credits), then
 * the CTĐT's other courses; without one, the CTĐT's mandatory courses and elective groups. Other specialties' courses
 * last. An elective group already satisfied is left out: its courses are no longer needed (search still finds them).
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
  const standardMandatory = context.graduation?.groups.filter((group) => group.kind === "mandatory").flatMap((group) => group.courseCodes);
  const mandatory = own.filter((course) => (standardMandatory ? standardMandatory.includes(course.code) : course.kind === "mandatory"));
  mandatory.forEach((course) => used.add(course.code));
  sections.push({ id: "mandatory", title: "Bắt buộc", note: mandatory.length ? `Còn ${mandatory.length} môn` : null, courses: mandatory });
  const groups = context.graduation
    ? context.graduation.groups.filter((group) => group.kind === "elective").map((group) => ({ id: group.label, title: group.label, required: group.required, unit: group.unit, codes: group.courseCodes }))
    : context.electiveGroups.map((group) => ({ id: group.code, title: `Tự chọn ${group.code}`, required: group.requiredCredits, unit: "TC" as const, codes: group.courseCodes }));
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
    ? { id: "other-ctdt", title: "Môn khác trong CTĐT", note: "Tiêu chuẩn xét tốt nghiệp không yêu cầu", courses: rest }
    : { id: "electives", title: "Tự chọn khác", note: null, courses: rest });
  const other = context.courses.filter((course) => !course.applicable && open(course));
  if (other.length) sections.push({ id: "other", title: "Chuyên ngành khác", note: "Không tính cho chuyên ngành của bạn", courses: other });
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

/** What a row says next to its mark: the grade and term, "Đang học …", "Kế hoạch …", or why it is still needed. */
export function auditNote(row: AuditRow): string {
  const { course } = row;
  if (row.mark === "done") return [course.state === "exempt" ? "Miễn (MT)" : course.grade, course.takenTerm && termLabel(course.takenTerm)].filter(Boolean).join(" · ");
  if (row.mark === "running") return `Đang học${course.inProgressTerm ? ` · ${termLabel(course.inProgressTerm)}` : ""}`;
  if (row.mark === "planned") return `Kế hoạch${row.plannedTerm ? ` · ${termLabel(row.plannedTerm)}` : ""}`;
  if (course.state === "failed") return `Chưa đạt${course.grade ? ` (${course.grade})` : ""}${row.plannedTerm ? ` · kế hoạch ${termLabel(row.plannedTerm)}` : ""}`;
  return row.plannedTerm ? `Chưa học · kế hoạch ${termLabel(row.plannedTerm)}` : "Chưa học";
}

export const unmatchedNote = (course: StudyPlanUnmatched) =>
  course.state === "in_progress" ? `Đang học${course.term ? ` · ${termLabel(course.term)}` : ""}`
    : [course.grade, course.term && termLabel(course.term)].filter(Boolean).join(" · ");

export const formatNumber = (value: number) => value.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

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
