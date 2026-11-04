import type { PoolClient } from "pg";
import { isPassedState } from "../competency-assessment/course-state.js";
import type { RoadmapFacts } from "../roadmap/facts.js";
import type { RoadmapOutput } from "../roadmap/validate.js";
import type { StudyPlanContext, StudyPlanCourse } from "./context.js";
import { MAX_COURSES_PER_TERM, MAX_TERMS, nextTerm, termIndex, type StudyPlanData } from "./model.js";

// Where "Kế hoạch học kỳ" starts (user 2026-10-24): "thêm mấy môn bắt buộc theo đúng kế hoạch ở file kế hoạch đào tạo
// luôn nha còn những người bị trễ kế hoạch thì sẽ không có gì hết", then "khi AI cho kế hoạch cái là bên thủ công nó sẽ
// được cập nhật luôn cả cái của AI đề xuất. rồi sv điều chỉnh thủ công từ cái bản AI đề xuất".

type Db = Pick<PoolClient, "query">;

/** Not done and not being studied: the course still has to be planned. */
const needsPlanning = (course: Pick<StudyPlanCourse, "state">) => !isPassedState(course.state) && course.state !== "in_progress";

/**
 * The plan of a student who has none: every mandatory course still to take (the graduation standard's mandatory
 * groups, else the CTĐT's), in the term the cohort's training plan puts it, when that term is still ahead. A course whose
 * plan term has passed (late) is left out: the AI roadmap proposes where it goes.
 */
export function prefillPlan(context: Pick<StudyPlanContext, "courses" | "currentTerm" | "graduation">): StudyPlanData {
  const mandatory = context.graduation
    ? new Set(context.graduation.groups.filter((group) => group.kind === "mandatory").flatMap((group) => group.courseCodes))
    : null;
  const terms = new Map<string, { code: string }[]>();
  for (const course of context.courses) {
    if (!course.applicable || !needsPlanning(course) || !course.planTerm) continue;
    if (mandatory ? !mandatory.has(course.code) : course.kind !== "mandatory") continue;
    if (termIndex(course.planTerm) <= termIndex(context.currentTerm)) continue;
    const list = terms.get(course.planTerm) ?? [];
    if (list.length < MAX_COURSES_PER_TERM) terms.set(course.planTerm, [...list, { code: course.code }]);
  }
  const codes = [...terms.keys()].sort((a, b) => termIndex(a) - termIndex(b)).slice(0, MAX_TERMS);
  return { schemaVersion: 1, terms: codes.map((code) => ({ code, courses: terms.get(code)! })) };
}

/**
 * The courses of the newest AI roadmap to add to the plan: term is the registration term the roadmap prepares, each
 * course goes to the first term from it that the training plans open it in.
 */
export type AiProposal = { roadmapId: string; completedAt: string; term: string; courses: { code: string; term: string }[] };

/** A training plan opens the course in that semester (HK1, HK2 or HK3) of some year, or none says. */
const sameSemester = (course: Pick<StudyPlanCourse, "offeredTerms">, term: string) =>
  !course.offeredTerms.length || course.offeredTerms.some((offered) => offered.endsWith(term.slice(4)));
/** The planner's check (web study-plan-data.ts offering): a training plan opens the course in that term, or none says. */
function opensIn(course: Pick<StudyPlanCourse, "offeredTerms">, term: string, offeringUntil: string | null): boolean {
  if (!course.offeredTerms.length || course.offeredTerms.includes(term)) return true;
  if (!sameSemester(course, term)) return false;
  return !offeringUntil || termIndex(term) > termIndex(offeringUntil);
}

/**
 * A passed course the newest AI roadmap advises to improve (D, D+), with the term it would go to: only suggested in Kế
 * hoạch học kỳ, never put in the plan for the student (user 2026-11-03: "các môn học cải thiện chỉ gợi ý chứ không có
 * tích vào dùm sinh viên").
 */
export type AiSuggestion = { code: string; term: string };

/**
 * The newest completed AI roadmap (roadmapId: the page reads the plan again only when Lộ trình AI đề xuất shows a newer
 * one): the courses to add to the plan when the plan has neither taken that roadmap in nor declined it (proposal, which
 * the page only proposes, user 2026-11-04: "Hỏi trước, bấm mới lưu"), and its improvement courses to suggest
 * (suggestions, every time). Only courses still missing (not passed,
 * not being studied) of the student's own program are added, a retake included (user 2026-11-03: "chỉ thêm vào lịch học
 * các môn Còn thiếu", "chuyên ngành nào thì đề xuất môn học đó thôi chứ không có đề xuất môn khác chuyên ngành nữa").
 * They start from the registration term the roadmap prepares (the plan's next term, at least the term after the current
 * one); a course the training plans do not open then goes to the next term within a year they open it in (or, failing
 * that, open it in that semester of other years). A chuyên đề of the thesis group brings the other one along (both or the
 * thesis, never a mix).
 */
export async function readAiPlan(db: Db, userId: string, context: Pick<StudyPlanContext, "courses" | "currentTerm" | "offeringUntil"> & Partial<Pick<StudyPlanContext, "thesis">>,
  appliedRoadmapId: string | null): Promise<{ proposal: AiProposal | null; suggestions: AiSuggestion[]; roadmapId: string | null }> {
  const row = (await db.query<{ id: string; facts: RoadmapFacts; output: RoadmapOutput | null; completed_at: Date | string }>(
    `SELECT id,facts,ai_output AS output,completed_at FROM stu_roadmaps WHERE user_id=$1 AND status='completed'
     ORDER BY completed_at DESC,id DESC LIMIT 1`, [userId])).rows[0];
  if (!row?.output) return { proposal: null, suggestions: [], roadmapId: row?.id ?? null };
  const facts = row.facts;
  const first = nextTerm(context.currentTerm);
  const term = facts.nextTerm && termIndex(facts.nextTerm) >= termIndex(first) ? facts.nextTerm : first;
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  // The term a plan opens it in, else one of the semester plans open it in, else the term of the roadmap.
  const placeOf = (course: Pick<StudyPlanCourse, "offeredTerms">) => {
    const candidates = [term, nextTerm(term), nextTerm(nextTerm(term))];
    return candidates.find((candidate) => opensIn(course, candidate, context.offeringUntil))
      ?? candidates.find((candidate) => sameSemester(course, candidate)) ?? term;
  };
  const suggestions: AiSuggestion[] = [];
  for (const item of row.output.improve ?? []) {
    const course = byCode.get(item.code);
    if (course?.applicable && course.state === "passed" && !suggestions.some((entry) => entry.code === course.code)) suggestions.push({ code: course.code, term: placeOf(course) });
  }
  if (row.id === appliedRoadmapId) return { proposal: null, suggestions, roadmapId: row.id };
  const running = new Set((facts.study ?? []).filter((item) => item.source === "running").map((item) => item.code));
  const picked = [...(row.output.study ?? []).map((item) => item.code).filter((code) => !running.has(code)), ...(row.output.improve ?? []).map((item) => item.code)];
  // The thesis group goes one way, the one the system advises by the GPA (user 2026-11-03, "TB tích lũy từ 2,80"): a roadmap
  // made before roadmap-v13 may have picked the other.
  const thesis = context.thesis ?? null;
  const advised = thesis?.way === "thesis" ? [thesis.thesis] : thesis?.way === "replacement" ? thesis.replacements : null;
  const excluded = new Set(thesis && advised ? [thesis.thesis, ...thesis.replacements, ...thesis.others].filter((code) => !advised.includes(code)) : []);
  if (thesis?.way !== "thesis") for (const choice of facts.choices ?? []) {
    const topics = choice.thesis?.topics.map((item) => item.code) ?? [];
    if (topics.some((code) => picked.includes(code))) picked.push(...topics);
  }
  const courses: AiProposal["courses"] = [];
  for (const code of new Set(picked)) {
    const course = byCode.get(code);
    // Another specialty's course, a passed one (an improvement), one being studied or the thesis group's other way never
    // goes into the plan.
    if (!course || !course.applicable || !needsPlanning(course) || excluded.has(code)) continue;
    courses.push({ code, term: placeOf(course) });
  }
  return { proposal: { roadmapId: row.id, completedAt: new Date(row.completed_at).toISOString(), term, courses }, suggestions, roadmapId: row.id };
}

/** The proposal alone (readAiPlan): what the plan has not taken in yet, or null. */
export async function readAiProposal(db: Db, userId: string, context: Pick<StudyPlanContext, "courses" | "currentTerm" | "offeringUntil">, appliedRoadmapId: string | null): Promise<AiProposal | null> {
  return (await readAiPlan(db, userId, context, appliedRoadmapId)).proposal;
}
