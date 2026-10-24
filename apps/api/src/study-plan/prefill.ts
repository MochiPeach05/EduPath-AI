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
 * The newest completed AI roadmap the plan has not taken in yet: the courses it advises to take (not the running ones),
 * to retake or to improve, from the registration term it prepares (the plan's next term, at least the term after the
 * current one); a course the training plans do not open then goes to the next term within a year they open it in (or,
 * failing that, open it in that semester of other years). A
 * chuyên đề of the thesis group brings the other one along (both or the thesis, never a mix).
 */
export async function readAiProposal(db: Db, userId: string, context: Pick<StudyPlanContext, "courses" | "currentTerm" | "offeringUntil">, appliedRoadmapId: string | null): Promise<AiProposal | null> {
  const row = (await db.query<{ id: string; facts: RoadmapFacts; output: RoadmapOutput | null; completed_at: Date | string }>(
    `SELECT id,facts,ai_output AS output,completed_at FROM stu_roadmaps WHERE user_id=$1 AND status='completed'
     ORDER BY completed_at DESC,id DESC LIMIT 1`, [userId])).rows[0];
  if (!row?.output || row.id === appliedRoadmapId) return null;
  const facts = row.facts;
  const first = nextTerm(context.currentTerm);
  const term = facts.nextTerm && termIndex(facts.nextTerm) >= termIndex(first) ? facts.nextTerm : first;
  const running = new Set((facts.study ?? []).filter((item) => item.source === "running").map((item) => item.code));
  const picked = [...(row.output.study ?? []).map((item) => item.code).filter((code) => !running.has(code)), ...(row.output.improve ?? []).map((item) => item.code)];
  for (const choice of facts.choices ?? []) {
    const topics = choice.thesis?.topics.map((item) => item.code) ?? [];
    if (topics.some((code) => picked.includes(code))) picked.push(...topics);
  }
  const byCode = new Map(context.courses.map((course) => [course.code, course]));
  const courses: AiProposal["courses"] = [];
  for (const code of new Set(picked)) {
    const course = byCode.get(code);
    // A passed course is only added back when the AI advises to improve it.
    if (!course || !(needsPlanning(course) || (row.output.improve ?? []).some((item) => item.code === code))) continue;
    // The term a plan opens it in, else one of the semester plans open it in, else the term of the roadmap.
    const candidates = [term, nextTerm(term), nextTerm(nextTerm(term))];
    const target = candidates.find((candidate) => opensIn(course, candidate, context.offeringUntil))
      ?? candidates.find((candidate) => sameSemester(course, candidate)) ?? term;
    courses.push({ code, term: target });
  }
  return { roadmapId: row.id, completedAt: new Date(row.completed_at).toISOString(), term, courses };
}
