// The student's own data for an answer of Trợ lý AI (the structured half of its retrieval, 2026-10-28). Read at prepare
// time from what the system already computed: the newest competency assessment (courses, plan progress, gaps to the
// target career, graduation pace: the same lines the AI roadmap reads, roadmap/prompt.ts roadmapDataSections), the newest
// AI roadmap and, under a valid consent, the profile survey. Each part is one numbered source of the prompt. Never a
// name, student code, email or class (the rule of the roadmap prompt); numbers come from the engine, the AI only explains.
import { levelOf } from "../competency-assessment/calculate.js";
import { formatNumber, sanitizeText, termText } from "../competency-assessment/ai/prompt.js";
import { fold, specialtyLabel } from "../competency-assessment/specialty.js";
import type { AssessmentResult, LevelCode, SkillResult, SpecialtyCode } from "../competency-assessment/types.js";
import type { DatabasePool } from "../db/pool.js";
import { buildRoadmapFacts, type RoadmapFacts } from "../roadmap/facts.js";
import { newestAssessment, readNewestRoadmap, type RoadmapRow } from "../roadmap/jobs.js";
import { roadmapDataSections } from "../roadmap/prompt.js";
import { roadmapWindow } from "../roadmap/window.js";
import { activeConsentVersion, isValidConsent } from "../student/consent.js";
import { readSurvey, surveyFacts } from "../student/survey.js";
import type { AssistantIntent } from "./intent.js";

type Db = Pick<DatabasePool, "query">;
export type AssistantSourceKind =
  | "profile" | "assessment" | "roadmap" | "graduation" | "course" | "skill" | "career" | "curriculum" | "plan" | "resource" | "guide";
/** One source of the prompt: what the answer may cite as [n], with the page the student can open. */
export type ContextSource = { kind: AssistantSourceKind; title: string; link: string | null; text: string };
/** The student's sources and the target career's skills still to build (for the self-study resources). */
export type StudentContext = { sources: ContextSource[]; gapSkills: string[] };

/** Level names as the student pages show them (scores re-read with the current thresholds, like withCurrentLevels). */
const LEVELS: Record<LevelCode, string> = {
  excellent: "Xuất sắc", proficient: "Giỏi", good: "Khá", basic: "Trung bình", needs_work: "Yếu", no_evidence: "Chưa có điểm", exempt: "Miễn/công nhận",
};
/** Skills listed in "Mức các kỹ năng của bạn": the ones the question names first, then the career's, then the extremes. */
const MAX_SKILL_LINES = 16;
const LINE_MAX = 400;

const dateText = (value: Date | string) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
const clean = (lines: readonly string[]) => lines.map((line) => sanitizeText(line, LINE_MAX)).filter(Boolean).join("\n");

function skillLevel(skill: Pick<SkillResult, "score" | "status" | "upcoming" | "upcomingTerm">): string {
  if (skill.score === null) {
    if (skill.status === "exempt_only") return LEVELS.exempt;
    return skill.upcoming ? `Sắp học${skill.upcomingTerm ? ` (${termText(skill.upcomingTerm)})` : ""}` : "Chưa có điểm";
  }
  return `${LEVELS[levelOf(skill.score)]} (${formatNumber(skill.score)} điểm)`;
}

function careerLines(result: AssessmentResult): string[] {
  const career = result.career;
  if (!career) return ["Nghề mục tiêu: chưa chọn (chọn ở trang Định hướng nghề nghiệp để mình so kỹ năng với nghề)."];
  const fit = typeof career.fitScore === "number" ? `điểm phù hợp ${formatNumber(career.fitScore)}/100 (${career.fitLabel})` : `mức phù hợp: ${career.fitLabel}`;
  return [`Nghề mục tiêu: ${career.nameVi}; ${fit}; ${career.summaryText}.`];
}

function overallLine(result: AssessmentResult): string {
  const overall = result.overall;
  if (overall.score === null) return "Mức năng lực chung: chưa có điểm.";
  return `Mức năng lực chung: ${LEVELS[levelOf(overall.score)]} (${formatNumber(overall.score)} điểm, dựa trên ${overall.basis.skillsWithEvidence}/${overall.basis.applicableSkills} kỹ năng có điểm).`;
}

/** The question names one of the student's skills ("SQL của mình ở mức nào?"). */
export function namesASkill(result: AssessmentResult, question: string): boolean {
  const asked = fold(question);
  return (result.skills ?? []).some((skill) => fold(skill.name).length >= 3 && asked.includes(fold(skill.name)));
}

/** Skill levels: those named in the question, then the target career's, then the 4 strongest and 4 weakest scored ones. */
export function skillLevelLines(result: AssessmentResult, question: string): string[] {
  const skills = (result.skills ?? []).filter((skill) => !skill.conditionOnly && skill.status !== "not_applicable");
  const asked = fold(question);
  const picked = new Map<string, SkillResult>();
  const add = (skill: SkillResult) => { if (picked.size < MAX_SKILL_LINES && !picked.has(skill.key)) picked.set(skill.key, skill); };
  for (const skill of skills) if (fold(skill.name).length >= 3 && asked.includes(fold(skill.name))) add(skill);
  for (const skill of skills) if (skill.careerSkill) add(skill);
  const scored = skills.filter((skill) => skill.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const skill of scored.slice(0, 4)) add(skill);
  for (const skill of scored.slice(-4)) add(skill);
  return [...picked.values()].map((skill) => `- ${skill.name}${skill.careerSkill ? " (kỹ năng của nghề mục tiêu)" : ""}: ${skillLevel(skill)}`);
}

/** The newest AI roadmap as the student page shows it: names instead of codes and keys. */
export function aiRoadmapLines(row: RoadmapRow, newestAssessmentId: string): string[] {
  const output = row.output;
  if (!output) return [];
  const facts: RoadmapFacts = row.facts;
  const names = new Map<string, string>();
  for (const item of facts.study) names.set(item.code, item.name);
  for (const choice of facts.choices) for (const option of choice.options) names.set(option.code, option.name);
  for (const item of facts.improve) names.set(item.code, item.name);
  const skillNames = new Map(facts.skills.map((skill) => [skill.key, skill.name]));
  const course = (code: string) => `${names.get(code) ?? code} (${code})`;
  const lines = [`Lộ trình cho ${facts.window.term ? termText(facts.window.term) : "học kỳ tới"}, tạo ngày ${dateText(row.createdAt)}${row.assessmentId === newestAssessmentId ? "" : " từ một kết quả đánh giá cũ hơn"}.`];
  lines.push(`Nhận định: ${output.summary}`);
  for (const advice of output.advice ?? []) lines.push(`- Lời khuyên: ${advice}`);
  for (const item of output.study) lines.push(`- Nên học ${course(item.code)}: ${item.advice}`);
  for (const item of output.improve) lines.push(`- Nên học lại hoặc cải thiện ${course(item.code)}: ${item.advice}`);
  for (const item of output.skills) lines.push(`- Nên tự học kỹ năng ${skillNames.get(item.key) ?? item.key}: ${item.why}`);
  return lines;
}

/** Without an assessment only the profile is known; the answer should say how to get the rest. */
async function profileOnly(db: Db, userId: string): Promise<ContextSource> {
  const result = await db.query<{ cohortCode: string | null; specialty: SpecialtyCode | null; career: string | null }>(
    `SELECT p.cohort_code AS "cohortCode",p.specialty,c.name_vi AS career FROM student_profiles p
      LEFT JOIN career_positions c ON c.id=p.career_position_id AND c.deleted_at IS NULL WHERE p.user_id=$1`, [userId]);
  const row = result.rows[0];
  return {
    kind: "profile", title: "Hồ sơ học tập của bạn", link: "#profile",
    text: clean([
      `Khóa: ${row?.cohortCode ?? "chưa cập nhật"}`,
      `Chuyên ngành: ${specialtyLabel(row?.specialty ?? null) ?? "Chưa xác định"}`,
      `Nghề mục tiêu: ${row?.career ?? "Chưa chọn"}`,
      "Bạn chưa có kết quả đánh giá năng lực trên EduPath AI: cần tải bảng điểm lên rồi chạy Đánh giá năng lực thì mới biết điểm các kỹ năng, học phần còn thiếu và tiến độ tốt nghiệp của bạn.",
    ]),
  };
}

/**
 * The student's sources for one question. Always: profile, the target career's skills, the courses to take or improve,
 * the graduation pace. By intent: the skill levels (gaps, or a skill named in the question), the newest AI roadmap
 * (roadmap, course_reason) and the profile survey (roadmap, resources; only under a valid profile_survey consent).
 */
export async function studentSources(db: Db, userId: string, question: string, intents: readonly AssistantIntent[], now: Date = new Date()): Promise<StudentContext> {
  const assessment = await newestAssessment(db, userId);
  if (!assessment) return { sources: [await profileOnly(db, userId)], gapSkills: [] };
  const wants = (...names: AssistantIntent[]) => names.some((name) => intents.includes(name));
  const facts = buildRoadmapFacts(assessment.id, assessment.computed, roadmapWindow(now));
  let survey = null;
  if (wants("roadmap", "resources")) {
    const row = await readSurvey(db, userId);
    if (row?.complete && isValidConsent(await activeConsentVersion(db, userId, "profile_survey"))) survey = surveyFacts(row);
  }
  const sections = roadmapDataSections(facts, survey);
  const sources: ContextSource[] = [
    {
      kind: "profile", title: "Hồ sơ học tập của bạn", link: "#profile",
      text: clean([...sections.profile, sections.window.at(-1) ?? "", `Kết quả đánh giá năng lực mới nhất: ngày ${dateText(assessment.createdAt)}.`]),
    },
    {
      kind: "assessment", title: "Kỹ năng của nghề mục tiêu (kết quả đánh giá năng lực)", link: "#skill-gap",
      // The S01… keys of the roadmap prompt mean nothing to the student: the lines go without them.
      text: clean([...careerLines(assessment.computed), overallLine(assessment.computed), "Kỹ năng nghề cần bổ sung:",
        ...sections.skills.map((line) => line.replace(/^- \[S\d+\] /, "- "))]),
    },
    {
      kind: "roadmap", title: "Học phần đang học, cần học và cần cải thiện", link: "#roadmap",
      text: clean(["Đang học:", ...sections.running, "Cần học theo kế hoạch đào tạo:", ...sections.needed, "Cần học lại hoặc cải thiện:", ...sections.improve]),
    },
    { kind: "graduation", title: "Tiến độ xét tốt nghiệp của bạn", link: "#graduation", text: clean(sections.graduation) },
  ];
  if (wants("gaps") || namesASkill(assessment.computed, question)) {
    const skillLines = skillLevelLines(assessment.computed, question);
    if (skillLines.length) sources.push({ kind: "assessment", title: "Mức các kỹ năng của bạn", link: "#competency", text: clean(skillLines) });
  }
  if (wants("roadmap", "course_reason")) {
    const roadmap = await readNewestRoadmap(db, userId);
    const lines = roadmap?.status === "completed" ? aiRoadmapLines(roadmap, assessment.id) : [];
    if (lines.length) sources.push({ kind: "roadmap", title: "Lộ trình AI đề xuất cho bạn", link: "#roadmap", text: clean(lines) });
  }
  if (sections.survey) sources.push({ kind: "profile", title: "Khảo sát định hướng của bạn (bạn tự khai)", link: "#profile", text: clean(sections.survey) });
  return { sources, gapSkills: gapSkillNames(assessment.computed) };
}

/** Names of the target career's skills still to build (gaps first): what the self-study resources are searched for. */
export function gapSkillNames(result: AssessmentResult | null): string[] {
  if (!result?.career) return [];
  return result.career.requirements
    .filter((requirement) => requirement.status !== "met" && requirement.skillName)
    .map((requirement) => requirement.skillName!)
    .slice(0, 5);
}
