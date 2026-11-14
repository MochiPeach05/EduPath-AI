// "Lộ trình học tập" after Stellic (user 2026-10-24): the data of "Theo dõi tiến độ" (the requirements with every course's
// state, official or with the plan) and "Lên kế hoạch (thủ công)" (terms, the courses still needed, the checks while
// planning). Mirrors apps/api/src/study-plan. Pure.
import { termName } from "./display-format";
import { formatDateTime, joinVi } from "./student-roadmap-data";

export type CourseState = "passed" | "exempt" | "failed" | "in_progress" | "graded_unknown" | "not_taken" | "not_in_curriculum";
export type PlanTerm = { code: string; courses: { code: string }[] };
/**
 * What taking the AI roadmap's proposal in added (when the student pressed Áp dụng): the roadmap's time, the term it
 * prepares, the courses added and when. Kept in the plan so "Kế hoạch học kỳ" names them on later visits too.
 */
export type AiAdded = { completedAt: string; term: string; codes: string[]; addedAt: string };
/**
 * roadmapId: the AI roadmap whose proposal the plan has taken in (Áp dụng) or the student declined (Bỏ qua); aiAdded:
 * what taking it in added (null: nothing to say); kept: courses the page proposed to take out and the student kept (Bỏ
 * qua), never proposed again while they stay planned.
 */
export type StudyPlanData = { schemaVersion: 1; roadmapId?: string | null; aiAdded?: AiAdded | null; kept?: string[]; terms: PlanTerm[] };
export type TriState = "pass" | "fail" | "unknown";
/** What the cohort's own training plan asks of a CTĐT elective group ("Chọn 2 trong 6 HP…", study-plan/context.ts planChoices). */
export type StudyPlanChoice = { courses: number; sections: { label: string; termCode: string }[] };

export type StudyPlanCourse = {
  code: string; name: string; credits: number; type: string; kind: "mandatory" | "elective"; group: string | null;
  conditional: boolean; applicable: boolean; specialtyName: string | null; standardTerm: string | null;
  prerequisites: string[]; prior: string[]; state: CourseState; inProgressTerm: string | null; onlyInStandard?: boolean;
  planTerm: string | null; offeredTerms: string[];
  /** Opened every term whatever the training plans list: English (API opensEveryTerm); absent before 2026-11-04. */
  everyTerm?: boolean; grade: string | null; takenTerm: string | null; attempts: number; equivalent: string | null;
  /** The classes of every cohort from the term of today on (API StudyPlanClass, 2026-11-08); absent before. */
  classes?: StudyPlanClass[];
  /**
   * The PE elective that fills this numbered GDTC course of the CTĐT (API course-state.ts physicalEducationFills, 2026-11-10):
   * the state, grade and term are that elective's. Absent otherwise.
   */
  filledBy?: { code: string; name: string } | null;
};

/**
 * The line under a GDTC course filled by a PE elective, what the student took (user 2026-11-10: the row simply shows the
 * course taken): "Đã học: Bóng chuyền (71PEVB10022)", "Đang học: Cờ vua (71PEKC10062)". Null for any other course.
 */
export function filledByText(course: Pick<StudyPlanCourse, "filledBy" | "state">): string | null {
  const taken = course.filledBy;
  if (!taken) return null;
  const name = taken.name.trim() && taken.name.trim() !== taken.code ? `${taken.name.trim()} (${taken.code})` : taken.code;
  return `${course.state === "in_progress" ? "Đang học" : "Đã học"}: ${name}`;
}
/**
 * A class: the term a cohort studies the course in, by its training plan ("plan") or, for a cohort without one, its CTĐT
 * ("curriculum"). major: the short name of another major ("HTTT"), null for the student's own.
 */
export type StudyPlanClass = { term: string; cohort: string; major: string | null; source: "plan" | "curriculum" };
export type StudyPlanGraduationGroup = {
  label: string; kind: "mandatory" | "elective"; unit: "môn" | "TC"; required: number | null; passed: number | null; status: TriState; courseCodes: string[];
};
export type StudyPlanUnmatched = { code: string; name: string; credits: number; state: CourseState; grade: string | null; term: string | null };
/**
 * The elective group a thesis course completes alone and the way the system recommends for it (apps/api/src/study-plan/
 * context.ts planThesis, user 2026-11-03): a path already taken stays, else an internal rule (user 2026-11-10: "cài đặt
 * ngầm trong hệ thống", never explained to the student); way null without one. The page follows the way the student chose
 * in the plan over it (thesisChoice). replacements: the replacement path; others: the group's other courses.
 */
export type StudyPlanThesis = {
  group: string; thesis: string; replacements: string[]; others: string[];
  path: "not_started" | "thesis_in_progress" | "replacement"; way: "thesis" | "replacement" | null;
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
/**
 * suggested: where a student without a plan starts (the training plan's mandatory courses ahead); aiRoadmapId: the newest
 * completed AI roadmap the answer knows (the page reads the plan again when Lộ trình AI đề xuất shows a newer one).
 */
export type StudyPlanResponse = {
  context: StudyPlanContext; plan: Saved | null; suggested: StudyPlanData | null; aiProposal: AiProposal | null;
  aiSuggestions?: AiSuggestion[]; aiRoadmapId?: string | null; projection: StudyPlanProjection | null;
};
/**
 * Where the plan on screen came from during this visit: the training plan's prefill (not saved until the first edit), or
 * the AI roadmap's proposal the student applied now (added: courses added), which Theo dõi tiến độ mentions too.
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
    schemaVersion: 1, roadmapId: data?.roadmapId ?? null, aiAdded: data?.aiAdded ?? null, ...(data?.kept?.length ? { kept: data.kept } : {}),
    terms: [...terms.values()].sort((a, b) => termIndex(a.code) - termIndex(b.code)),
  };
}

/** The courses the student kept when the page proposed to take them out (upper-case codes). */
const keptCodes = (plan: StudyPlanData) => new Set((plan.kept ?? []).map((code) => code.toUpperCase()));

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
 * passed (an improvement). Only the courses the AI added (aiAdded) are looked at, never one the student kept; returns the
 * plan and the codes taken out.
 */
export function cleanAiAdded(context: Pick<StudyPlanContext, "courses">, plan: StudyPlanData): { plan: StudyPlanData; removed: string[] } {
  const codes = plan.aiAdded?.codes ?? [];
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const placed = plannedTerms(plan);
  const kept = keptCodes(plan);
  const removed = codes.filter((code) => {
    const course = byCode.get(code.toUpperCase());
    return placed.has(code.toUpperCase()) && !kept.has(code.toUpperCase()) && course !== undefined && (!course.applicable || isDone(course.state));
  });
  if (!removed.length) return { plan, removed };
  const cleaned = removed.reduce((next, code) => moveCourse(next, code, null), plan);
  return { plan: { ...cleaned, aiAdded: { ...plan.aiAdded!, codes: codes.filter((code) => !removed.includes(code)) } }, removed };
}

/** An AI-added course moved after the courses it waits for (orderAiAdded). */
export type PlanMove = { code: string; from: string; to: string };

/**
 * The plan with each course the AI roadmap added moved after the courses it waits for (user 2026-11-08: "AI đang đề xuất
 * av 5,6,7 vào một kì như vậy là không được … chưa đạt môn tiên quyết sao mà đk được"): a tiên quyết not passed or a học
 * trước never taken (neither being studied) that the plan puts in the same term or later. The course goes to the first
 * term after it that a training plan opens it in (within three terms, else that first term), one after the other (Anh văn
 * 5, 6, 7). Only what the AI added and the student did not keep is moved; the student's own placements keep their
 * warnings (planIssues). Returns the plan and the moves.
 */
export function orderAiAdded(context: Pick<StudyPlanContext, "courses"> & Partial<Pick<StudyPlanContext, "offeringUntil">>, plan: StudyPlanData): { plan: StudyPlanData; moved: PlanMove[] } {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const kept = keptCodes(plan);
  const codes = (plan.aiAdded?.codes ?? []).map((code) => code.toUpperCase()).filter((code) => !kept.has(code) && byCode.has(code));
  const waiting = (code: string, kind: "prerequisite" | "prior") => {
    const other = byCode.get(code);
    if (!other || other.state === "in_progress") return false;
    return kind === "prerequisite" ? !isDone(other.state) : other.state === "not_taken" || other.state === "not_in_curriculum";
  };
  let next = plan;
  const moved = new Map<string, PlanMove>();
  // A chain moves one link per round (AV6 after AV5, then AV7 after AV6's new term); a loop stops at the round limit.
  for (let round = 0; round <= codes.length; round++) {
    const placed = plannedTerms(next);
    let changed = false;
    for (const code of codes) {
      const course = byCode.get(code)!;
      const at = placed.get(code);
      if (!at) continue;
      let from: string | null = null;
      for (const [kind, targets] of [["prerequisite", course.prerequisites ?? []], ["prior", course.prior ?? []]] as const) {
        for (const target of ownRelations(course, targets, byCode)) {
          const there = placed.get(target);
          if (!there || termIndex(there) < termIndex(at) || !waiting(target, kind)) continue;
          const after = nextTerm(there);
          if (!from || termIndex(after) > termIndex(from)) from = after;
        }
      }
      if (!from) continue;
      const candidates = [from, nextTerm(from), nextTerm(nextTerm(from))];
      const to = candidates.find((term) => offering(course, term, context.offeringUntil ?? null) === "ok") ?? from;
      if (!next.terms.some((term) => term.code === to) && next.terms.length >= MAX_TERMS) continue;
      next = moveCourse(next, code, to);
      placed.set(code, to);
      moved.set(code, { code, from: moved.get(code)?.from ?? at, to });
      changed = true;
    }
    if (!changed) break;
  }
  return { plan: next, moved: [...moved.values()] };
}

/* ---------------------------------------------------------- thesis group */
// The thesis group (TC306/TC406) is done one way: Đồ án/Khóa luận tốt nghiệp alone, or the replacement courses (Chuyên đề
// tốt nghiệp 1 and 2). The system recommends one by an internal rule (API graduation/thesis.ts thesisWay); since 2026-11-10
// (user: "cái này như kiểu là cài đặt ngầm trong hệ thống vậy thôi sẽ hiện ra như kiểu đề xuất tất nhiên và vẫn có giữ lại
// môn đồ án tốt nghiệp do sinh viên chọn hết mà") the page shows it only as a suggestion, never with the GPA, keeps the other
// way available, and follows the way the student chose: a course they placed is never taken out nor called unnecessary.

type ThesisWay = "thesis" | "replacement";
const upper = (code: string) => code.toUpperCase();

/**
 * The courses the student placed in the plan themselves (upper-case codes): every planned course except those an AI
 * roadmap's proposal added (aiAdded) and the student did not keep (Bỏ qua), as the API's study-plan/own-plan.ts reads them.
 */
export function ownPlanned(plan: StudyPlanData): Set<string> {
  const kept = keptCodes(plan);
  const added = new Set((plan.aiAdded?.codes ?? []).map(upper).filter((code) => !kept.has(code)));
  return new Set([...plannedTerms(plan).keys()].filter((code) => !added.has(code)));
}

/** The side of the thesis group a course is on: the thesis, a replacement course, another course of the group; else null. */
function thesisSide(thesis: StudyPlanThesis, code: string): ThesisWay | "other" | null {
  const key = upper(code);
  if (upper(thesis.thesis) === key) return "thesis";
  if (thesis.replacements.some((item) => upper(item) === key)) return "replacement";
  return thesis.others.some((item) => upper(item) === key) ? "other" : null;
}

/** The ways the transcript's path and some planned courses hold (another course of the group counts as a replacement). */
function heldWays(thesis: StudyPlanThesis, codes: Iterable<string>): Set<ThesisWay> {
  const ways = new Set<ThesisWay>();
  if (thesis.path === "thesis_in_progress") ways.add("thesis");
  if (thesis.path === "replacement") ways.add("replacement");
  for (const code of codes) {
    const side = thesisSide(thesis, code);
    if (side) ways.add(side === "thesis" ? "thesis" : "replacement");
  }
  return ways;
}

/**
 * The way the student chose for the thesis group (the API's thesisChoice): the transcript's path and the courses they placed
 * in the plan themselves (ownPlanned); "both" when they hold both ways, null when neither.
 */
export function thesisChoice(context: Pick<StudyPlanContext, "thesis">, plan: StudyPlanData): ThesisWay | "both" | null {
  if (!context.thesis) return null;
  const ways = heldWays(context.thesis, ownPlanned(plan));
  return ways.size === 2 ? "both" : ways.size ? [...ways][0]! : null;
}

/** The way the page follows: the student's choice when it is one way, else the way the system recommends; null while they hold both. */
export function followedThesisWay(context: Pick<StudyPlanContext, "thesis">, plan: StudyPlanData): ThesisWay | null {
  const choice = thesisChoice(context, plan);
  return choice === "both" ? null : choice ?? context.thesis?.way ?? null;
}

/** The courses of one way (upper-case codes). */
const wayCodes = (thesis: StudyPlanThesis, way: ThesisWay) => (way === "thesis" ? [thesis.thesis] : thesis.replacements).map(upper);

/** "làm Đồ án Tốt nghiệp", "học Chuyên đề Tốt nghiệp 1 và Chuyên đề Tốt nghiệp 2": one way, by the courses' names. */
export function thesisWayText(context: Pick<StudyPlanContext, "thesis" | "courses">, way: ThesisWay): string {
  const thesis = context.thesis;
  if (!thesis) return "";
  const name = (code: string) => context.courses.find((course) => course.code === upper(code))?.name ?? code;
  return way === "thesis" ? `làm ${name(thesis.thesis)}` : `học ${joinVi(thesis.replacements.map(name))}`;
}

/**
 * The courses of the thesis group Danh sách chờ leaves out (upper-case codes; Tìm học phần still finds them, with
 * thesisHint): the group's other courses, offered by neither way, and once the student chose a way the other way. Before
 * they chose, both ways are listed, the recommended one first (poolSections). Nothing without a recommendation, as before.
 */
export function thesisLeftOut(context: Pick<StudyPlanContext, "thesis">, plan: StudyPlanData = { schemaVersion: 1, terms: [] }): Set<string> {
  const thesis = context.thesis;
  if (!thesis) return new Set();
  const choice = thesisChoice(context, plan);
  if (!choice && !thesis.way) return new Set();
  const others = thesis.others.map(upper);
  if (choice === "thesis") return new Set([...others, ...wayCodes(thesis, "replacement")]);
  if (choice === "replacement") return new Set([...others, ...wayCodes(thesis, "thesis")]);
  return new Set(others);
}

/**
 * The plan without what an AI roadmap added (aiAdded) of the thesis group off the way the page follows (the student's
 * choice, else the recommendation): a roadmap made before roadmap-v13 may have picked the other way, or the student chose
 * the other way since. A course the student placed themselves, or kept (Bỏ qua), is never taken out (user 2026-11-10), and
 * while they hold both ways nothing is. Returns the plan and the codes taken out.
 */
export function cleanThesisWay(context: Pick<StudyPlanContext, "thesis" | "courses">, plan: StudyPlanData): { plan: StudyPlanData; removed: string[] } {
  const thesis = context.thesis;
  const way = thesis ? followedThesisWay(context, plan) : null;
  if (!thesis || !way) return { plan, removed: [] };
  const followed = new Set(wayCodes(thesis, way));
  const added = new Set((plan.aiAdded?.codes ?? []).map(upper));
  const own = ownPlanned(plan);
  const removed = [...plannedTerms(plan).keys()].filter((code) => thesisSide(thesis, code) && !followed.has(code) && added.has(code) && !own.has(code));
  if (!removed.length) return { plan, removed };
  const cleaned = removed.reduce((next, code) => moveCourse(next, code, null), plan);
  return { plan: plan.aiAdded ? { ...cleaned, aiAdded: { ...plan.aiAdded, codes: plan.aiAdded.codes.filter((code) => !removed.includes(upper(code))) } } : cleaned, removed };
}

/**
 * The line on a course of the thesis group, planned or in Danh sách chờ and Tìm học phần (user 2026-11-10: the system's
 * recommendation is a suggestion and the student chooses; never "Không cần học phần này", never the GPA): when the plan holds
 * both ways, that one is enough; on a course listed before the student chose, whether it is the recommended way or the other
 * option; once they chose, on a course of the other way, the way they chose. Null for any other course, and for a planned
 * course while the plan holds one way.
 */
export function thesisHint(context: Pick<StudyPlanContext, "thesis" | "courses">, plan: StudyPlanData, code: string): string | null {
  const thesis = context.thesis;
  const side = thesis ? thesisSide(thesis, code) : null;
  if (!thesis || !side) return null;
  const group = thesis.group.replace(/^Nhóm/, "nhóm");
  const placed = plannedTerms(plan);
  const both = `Chỉ cần một phương án cho ${group}: ${thesisWayText(context, "thesis")}, hoặc ${thesisWayText(context, "replacement")}.`;
  if (heldWays(thesis, placed.keys()).size === 2) return both;
  if (placed.has(upper(code))) return null;
  const choice = thesisChoice(context, plan);
  const way = side === "other" ? null : side;
  if (choice === "thesis" || choice === "replacement") {
    return way === choice ? null : `Bạn đã chọn ${thesisWayText(context, choice)} cho ${group}; chỉ cần một phương án.`;
  }
  const recommended = thesis.way;
  if (!recommended) return null;
  if (!way) return `Học phần này không thuộc phương án đề xuất cho ${group} (${thesisWayText(context, recommended)}).`;
  return way === recommended ? `Đề xuất cho ${group}: ${thesisWayText(context, recommended)}.`
    : `Phương án khác cho ${group}, nếu bạn chọn; đề xuất: ${thesisWayText(context, recommended)}.`;
}

/**
 * The note on what cleanThesisWay took out of the plan (only courses an AI roadmap added), naming each course; proposed:
 * what it would take out, in the proposal the student applies or declines ("Bỏ khỏi kế hoạch …"). The reason is the way
 * the student chose, or the way the system recommends, never the GPA.
 */
export function thesisCleanedText(context: Pick<StudyPlanContext, "thesis" | "courses">, plan: StudyPlanData, codes: readonly string[], proposed = false): string {
  const thesis = context.thesis;
  const group = thesis?.group.replace(/^Nhóm/, "nhóm") ?? "nhóm đồ án tốt nghiệp";
  const way = thesis ? followedThesisWay(context, plan) : null;
  const own = way !== null && thesisChoice(context, plan) === way;
  const why = way ? `: ${own ? "bạn đã chọn" : "hệ thống đề xuất"} ${thesisWayText(context, way)} cho ${group}, chỉ cần một phương án` : "";
  return `${proposed ? "Bỏ" : "Đã bỏ"} khỏi kế hoạch ${courseList(context, codes)} do lộ trình AI thêm trước đây${why}.${own ? "" : " Bạn vẫn có thể tự thêm lại các học phần này nếu muốn chọn chúng."}`;
}

/**
 * What the page proposes to change in the plan; nothing changes and nothing is saved until the student presses Áp dụng
 * (user 2026-11-04: "Hỏi trước, bấm mới lưu"). plan: the plan once applied; roadmap and added: the newest AI roadmap's
 * courses to add, each with its term (roadmap null when it adds none); aiRemoved: what an older AI roadmap added and the
 * plan must not hold (cleanAiAdded); thesisRemoved: the thesis group's way the system does not advise (cleanThesisWay);
 * keepable: the courses whose removal stands without the AI's courses, which Bỏ qua keeps (declineProposal).
 */
export type PlanProposal = {
  plan: StudyPlanData;
  roadmap: { id: string; completedAt: string; term: string } | null;
  added: { code: string; term: string }[];
  aiRemoved: string[];
  thesisRemoved: string[];
  /** Courses an AI roadmap added before, moved after the courses they wait for (orderAiAdded, user 2026-11-08). */
  moved: PlanMove[];
  keepable: string[];
};

/**
 * The proposal for a plan (null when nothing would change): the clean-ups first (cleanAiAdded, then cleanThesisWay), then
 * the AI roadmap's proposal unless the plan has taken that roadmap in or the student declined it (roadmapId), and the
 * thesis group's other way again (the AI's courses can make the plan hold both ways).
 */
export function planProposal(context: Pick<StudyPlanContext, "courses" | "thesis"> & Partial<Pick<StudyPlanContext, "offeringUntil">>, plan: StudyPlanData,
  aiProposal: AiProposal | null, now = new Date()): PlanProposal | null {
  const ai = cleanAiAdded(context, plan);
  const before = cleanThesisWay(context, ai.plan);
  let next = before.plan;
  let roadmap: PlanProposal["roadmap"] = null;
  let addedCodes: string[] = [];
  if (aiProposal && aiProposal.roadmapId !== plan.roadmapId) {
    const applied = applyProposal(next, aiProposal, now);
    if (applied.added) {
      next = applied.plan;
      roadmap = { id: aiProposal.roadmapId, completedAt: aiProposal.completedAt, term: aiProposal.term };
      addedCodes = applied.plan.aiAdded?.codes ?? [];
    }
  }
  const after = cleanThesisWay(context, next);
  // The AI's courses after the courses they wait for, those just added as well as those added before (user 2026-11-08).
  const ordered = orderAiAdded(context, after.plan);
  const placed = plannedTerms(ordered.plan);
  const added = addedCodes.filter((code) => placed.has(code)).map((code) => ({ code, term: placed.get(code)! }));
  const moved = ordered.moved.filter((move) => !addedCodes.includes(move.code));
  const thesisRemoved = [...before.removed, ...after.removed.filter((code) => !addedCodes.includes(code))];
  if (!added.length && !ai.removed.length && !thesisRemoved.length && !moved.length) return null;
  return { plan: ordered.plan, roadmap: added.length ? roadmap : null, added, aiRemoved: ai.removed, thesisRemoved, moved,
    keepable: [...new Set([...ai.removed, ...before.removed, ...moved.map((move) => move.code)].map((code) => code.toUpperCase()))] };
}

/**
 * The plan as it is with the proposal declined (Bỏ qua): its AI roadmap is not proposed again (roadmapId), and the
 * courses it would have taken out on their own are kept, so the same proposal never comes back.
 */
export function declineProposal(plan: StudyPlanData, proposal: PlanProposal): StudyPlanData {
  const kept = [...new Set([...(plan.kept ?? []), ...proposal.keepable])];
  return { ...plan, roadmapId: proposal.roadmap?.id ?? plan.roadmapId ?? null, ...(kept.length ? { kept } : {}) };
}

/** "thêm 3 học phần do lộ trình AI đề xuất và bỏ 2 học phần": what a proposal does, for Theo dõi tiến độ. */
export function proposalSummaryText(proposal: Pick<PlanProposal, "added" | "aiRemoved" | "thesisRemoved"> & Partial<Pick<PlanProposal, "moved">>): string {
  const removed = proposal.aiRemoved.length + proposal.thesisRemoved.length;
  const moved = proposal.moved?.length ?? 0;
  return joinVi([proposal.added.length ? `thêm ${proposal.added.length} học phần do lộ trình AI đề xuất` : null,
    moved ? `chuyển ${moved} học phần ra sau môn tiên quyết` : null,
    removed ? `bỏ ${removed} học phần` : null].filter((part): part is string => Boolean(part)));
}

/** The heading of the courses a proposal adds: "Thêm 2 học phần do lộ trình AI đề xuất (lộ trình soạn lúc 17:00 24/10/2026), …". */
export function proposalAddedText(proposal: Pick<PlanProposal, "added" | "roadmap">): string {
  const when = proposal.roadmap ? ` (lộ trình soạn lúc ${formatDateTime(proposal.roadmap.completedAt)})` : "";
  return `Thêm ${proposal.added.length} học phần do lộ trình AI đề xuất${when}, vào học kỳ mà kế hoạch đào tạo mở môn đó:`;
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
export type TermLoad = { credits: number; conditional: number };
/**
 * Credits of a term (planned + being studied). GDTC/GDQP count too (user 2026-10-24: a Futsal course of TC102 must raise
 * the term's total): they stay out of accumulated credits but are registered and studied that term. The page says the
 * credits only (user 2026-11-10: "xóa mấy cái thông báo này luôn nha chỉ cần ghi số tín chỉ đăng ký ở kì đó thôi"): no
 * minimum or maximum per term is shown any more; the API keeps the limits (context.limits) for the AI roadmap.
 */
export function termLoad(context: Pick<StudyPlanContext, "courses">, plan: StudyPlanData, term: string): TermLoad {
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const placed = plannedTerms(plan);
  const courses = [...(plan.terms.find((item) => item.code === term)?.courses.map((course) => byCode.get(course.code.toUpperCase()))
    .filter((course): course is StudyPlanCourse => Boolean(course)) ?? []),
    ...runningIn(context, term).filter((course) => !placed.has(course.code))];
  const credits = courses.reduce((sum, course) => sum + course.credits, 0);
  const conditional = courses.reduce((sum, course) => sum + (course.conditional ? course.credits : 0), 0);
  return { credits, conditional };
}

/** "12 TC", "0 TC": the credits of a term, nothing more (user 2026-11-10). */
export const termLoadText = (load: Pick<TermLoad, "credits">) => `${formatNumber(load.credits)} TC`;

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
 * - học trước: studied at least once (any result) before the course's term, or planned in an earlier term (Cờ vua
 *   nâng cao after Cờ vua, user 2026-11-04: "phải học xong cờ vua mới cho đk"; one being studied counts from the next term);
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
    const studied = (code: string) => { const state = byCode.get(code)!.state; return state === "in_progress" ? running(code) : state !== "not_taken"; };
    const prior = ownRelations(course, course.prior, byCode).filter((code) => byCode.has(code) && !studied(code) && !earlier(code));
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
export function offering(course: Pick<StudyPlanCourse, "offeredTerms" | "everyTerm">, term: string, offeringUntil: string | null): "ok" | "semester" | "term" {
  // English opens every term (user 2026-11-04: "môn anh văn kì nào cũng mở nhé"; the API's opensEveryTerm).
  if (course.everyTerm || !course.offeredTerms.length || course.offeredTerms.includes(term)) return "ok";
  if (!course.offeredTerms.some((offered) => offered.endsWith(term.slice(4)))) return "semester";
  return offeringUntil && termIndex(term) <= termIndex(offeringUntil) ? "term" : "ok";
}

/** "HK1, HK2": the semesters the training plans open a course in. */
export const offeredSemesters = (course: Pick<StudyPlanCourse, "offeredTerms" | "everyTerm">) =>
  course.everyTerm ? "mọi học kỳ" : [...new Set(course.offeredTerms.map((term) => `HK${term.slice(4)}`))].sort().join(", ");

/**
 * The other cohorts' classes of a course in a term (user 2026-11-08: "những môn học rớt, học lại, cải thiện, trễ kế hoạch
 * đều là học lại chung với các khóa sau ghi rõ lớp học đấy thuộc khóa nào trong ctdt hoặc file kế hoạch"): "lớp khóa K30,
 * K31 (theo kế hoạch đào tạo)", "lớp khóa K32 (theo CTĐT)". Null when the student's own cohort studies it then (the
 * student's own class) or no cohort does. The student's major's classes, else another major's ("K30 HTTT").
 */
export function classesText(course: Pick<StudyPlanCourse, "classes">, term: string, ownCohort: string | null | undefined): string | null {
  const all = (course.classes ?? []).filter((item) => item.term === term);
  if (!all.length || all.some((item) => item.cohort === ownCohort && !item.major)) return null;
  const own = all.filter((item) => !item.major);
  const shown = own.length ? own : all;
  const names = (source: StudyPlanClass["source"]) =>
    [...new Set(shown.filter((item) => item.source === source).map((item) => (item.major ? `${item.cohort} ${item.major}` : item.cohort)))];
  const parts = ([["plan", "theo kế hoạch đào tạo"], ["curriculum", "theo CTĐT"]] as const)
    .map(([source, label]) => [names(source), label] as const).filter(([list]) => list.length).map(([list, label]) => `${list.join(", ")} (${label})`);
  return `lớp khóa ${parts.join(", ")}`;
}

/**
 * Whether the training plans open a course in the term after the current one, and in which semester they usually do
 * (user 2026-11-03: "ghi rõ kì sau mở hay không và thường mở ở học kì nào"): "Kỳ sau (HK2 2026–2027): có mở · thường mở
 * HK2". Every cohort's plan counts (a course one cohort studies next term is opened then); past the last term the plans
 * cover, the semester decides ("có thể mở").
 */
export function nextTermOffer(course: Pick<StudyPlanCourse, "offeredTerms" | "everyTerm" | "classes">,
  context: Pick<StudyPlanContext, "currentTerm" | "offeringUntil"> & Partial<Pick<StudyPlanContext, "cohortCode">>,
  options: { classes?: boolean } = {}): { tone: "ok" | "warn" | "unknown"; text: string } {
  const next = nextTerm(context.currentTerm);
  // The other cohorts' class it would be studied in (classesText, user 2026-11-08), unless the caller names it apart.
  const joined = options.classes === false ? null : classesText(course, next, context.cohortCode);
  const open = (word: string) => `${word}${joined ? `, học cùng ${joined}` : ""}`;
  if (course.everyTerm) return { tone: "ok", text: `Kỳ sau (${termLabel(next)}): ${open("có mở")} · mở mọi học kỳ` };
  if (!course.offeredTerms.length) return { tone: "unknown", text: "Chưa có kế hoạch đào tạo nào xếp lịch mở môn này" };
  const lead = `Kỳ sau (${termLabel(next)})`, usual = `thường mở ${offeredSemesters(course)}`;
  if (course.offeredTerms.includes(next)) return { tone: "ok", text: `${lead}: ${open("có mở")} · ${usual}` };
  if (offering(course, next, context.offeringUntil) === "ok") return { tone: "ok", text: `${lead}: có thể mở · ${usual}` };
  return { tone: "warn", text: `${lead}: không mở theo kế hoạch đào tạo · ${usual}` };
}

/**
 * A copy of the plan with a course moved to a term (null: back to the list), creating the term when needed. A course
 * taken out is no longer kept (kept): planned again later, it is like any other.
 */
export function moveCourse(plan: StudyPlanData, code: string, to: string | null): StudyPlanData {
  const key = code.toUpperCase();
  const terms = plan.terms.map((term) => ({ ...term, courses: term.courses.filter((course) => course.code.toUpperCase() !== key) }));
  if (to) {
    const target = terms.find((term) => term.code === to);
    if (target) target.courses.push({ code: key });
    else terms.push({ code: to, courses: [{ code: key }] });
  }
  const kept = !to && plan.kept ? { kept: plan.kept.filter((item) => item.toUpperCase() !== key) } : {};
  return { ...plan, ...kept, terms: terms.sort((a, b) => termIndex(a.code) - termIndex(b.code)) };
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
  // The thesis group (user 2026-11-03, 2026-11-10): its other courses are not offered, nor, once the student chose a way, the
  // other way; before that both ways are, the recommended one first. Search still finds every course, marked (thesisHint).
  const leftOut = thesisLeftOut(context, plan);
  const followed = context.thesis ? followedThesisWay(context, plan) : null;
  const first = new Set(context.thesis && followed ? wayCodes(context.thesis, followed) : []);
  const own = context.courses.filter((course) => course.applicable && open(course) && !leftOut.has(course.code))
    .sort((a, b) => Number(!first.has(a.code)) - Number(!first.has(b.code)));
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

/**
 * The note on a course of another specialty a requirement group lists: the specialty electives group counts it (API
 * crossSpecialtyCourses, user 2026-11-14). Only such courses are rows of a standard's group without applying to the student.
 */
export const otherSpecialtyRowNote = (specialtyName: string) => `Môn chuyên ngành ${specialtyName}: được tính vào nhóm này`;

export const unmatchedNote = (course: StudyPlanUnmatched) =>
  course.state === "in_progress" ? `Đang học${course.term ? ` · ${termLabel(course.term)}` : ""}`
    : [course.grade, course.term && termLabel(course.term)].filter(Boolean).join(" · ");

export const formatNumber = (value: number) => value.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** "Đồ án thực tập (71ITIN40304), Chuyên đề Tốt nghiệp 1 (71ITGR40203) và …": the courses by name and code. */
export function courseList(context: Pick<StudyPlanContext, "courses">, codes: readonly string[]): string {
  const names = new Map(context.courses.map((course) => [course.code, course.name]));
  return joinVi(codes.map((code) => (names.has(code.toUpperCase()) ? `${names.get(code.toUpperCase())} (${code})` : code)));
}

/** The note on what cleanAiAdded took out of the plan, naming each course; proposed: what it would take out ("Bỏ khỏi …"). */
export function aiCleanedText(context: Pick<StudyPlanContext, "courses">, codes: readonly string[], proposed = false): string {
  return `${proposed ? "Bỏ" : "Đã bỏ"} khỏi kế hoạch ${codes.length} học phần lộ trình AI thêm trước đây vì không phải môn còn thiếu của chuyên ngành bạn (môn khác chuyên ngành, hoặc môn đã đạt chỉ nên gợi ý học cải thiện): ${courseList(context, codes)}.`;
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
