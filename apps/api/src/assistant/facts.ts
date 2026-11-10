// The student's own data for an answer of Trợ lý AI (the structured half of its retrieval, 2026-10-28). Read at prepare
// time from what the system already computed: the newest competency assessment (courses, plan progress, gaps to the
// target career, graduation pace: the same lines the AI roadmap reads, roadmap/prompt.ts roadmapDataSections), the newest
// AI roadmap and, under a valid consent, the profile survey. Each part is one numbered source of the prompt. Never a
// name, student code, email or class (the rule of the roadmap prompt); numbers come from the engine, the AI only explains.
// Since assistant-v4 (2026-10-29) the stored transcript is a source too (transcript.ts): its scores and printed
// summaries are copied as printed, so a student can look up a grade, the GPA or the credits in the chat.
import { levelOf } from "../competency-assessment/calculate.js";
import { formatScoreOf100, sanitizeText } from "../competency-assessment/ai/prompt.js";
import { fold, specialtyLabel } from "../competency-assessment/specialty.js";
import type { AssessmentResult, LevelCode, SkillResult, SpecialtyCode } from "../competency-assessment/types.js";
import type { DatabasePool } from "../db/pool.js";
import { buildRoadmapFacts, type RoadmapFacts, type RoadmapSkill } from "../roadmap/facts.js";
import { newestAssessment, readNewestRoadmap, readRoadmapRelations, type RoadmapRow } from "../roadmap/jobs.js";
import { shownRoadmapOutput } from "../roadmap/present.js";
import { roadmapDataSections } from "../roadmap/prompt.js";
import { roadmapWindow } from "../roadmap/window.js";
import { readOwnPlannedCodes } from "../study-plan/own-plan.js";
import { readSurvey, surveyFacts, surveyUsable } from "../student/survey.js";
import { withoutSettledReviews, type TranscriptData } from "../student/transcript-parser.js";
import type { AssistantIntent } from "./intent.js";
import { termName } from "../term-name.js";
import { transcriptLines } from "./transcript.js";

type Db = Pick<DatabasePool, "query">;
export type AssistantSourceKind =
  | "profile" | "assessment" | "roadmap" | "graduation" | "course" | "skill" | "career" | "curriculum" | "plan" | "resource" | "guide"
  | "transcript";
/**
 * One source of the prompt: what the answer may cite as [n], with the page the student can open. ref: the knowledge chunk
 * it came from (source_kind, source_key), so a later question of the conversation can bring it back (assistant-v3).
 */
export type ContextSource = { kind: AssistantSourceKind; title: string; link: string | null; text: string; ref?: { kind: string; key: string } };
/** The student's sources and the target career's skills still to build (for the self-study resources). */
export type StudentContext = { sources: ContextSource[]; gapSkills: string[] };

/** Level names as the student pages show them (scores re-read with the current thresholds, like withCurrentLevels). */
const LEVELS: Record<LevelCode, string> = {
  excellent: "Xuất sắc", proficient: "Giỏi", good: "Khá", basic: "Trung bình", needs_work: "Yếu", no_evidence: "Chưa có điểm", exempt: "Miễn/công nhận",
};
/** Skills listed in "Mức các kỹ năng của bạn": the ones the question names first, then the career's, then the extremes. */
const MAX_SKILL_LINES = 16;
const LINE_MAX = 400;
/** A transcript line holds a course with its attempts, or up to 6 printed summaries. */
const TRANSCRIPT_LINE_MAX = 600;

const dateText = (value: Date | string) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
const clean = (lines: readonly string[], max = LINE_MAX) => lines.map((line) => sanitizeText(line, max)).filter(Boolean).join("\n");

type StoredTranscript = { data: TranscriptData; updatedAt: Date | string };

/** The stored transcript as the student pages show it (withoutSettledReviews): parsed_data and its date, never the PDF. */
async function readTranscript(db: Db, userId: string): Promise<StoredTranscript | null> {
  const row = (await db.query<{ data: TranscriptData | null; updatedAt: Date | string }>(
    `SELECT parsed_data AS data,updated_at AS "updatedAt" FROM student_transcripts WHERE user_id=$1`, [userId])).rows[0];
  return row?.data?.sections ? { data: withoutSettledReviews(row.data), updatedAt: row.updatedAt } : null;
}

/** "Bảng điểm của bạn" (transcript.ts): the summary, plus the rows the question names or, for a grade question, every row. */
function transcriptSource(transcript: StoredTranscript, question: string, intents: readonly AssistantIntent[]): ContextSource {
  return {
    kind: "transcript", title: "Bảng điểm của bạn", link: "#profile",
    text: clean(transcriptLines(transcript.data, { question, intents, updated: dateText(transcript.updatedAt) }), TRANSCRIPT_LINE_MAX),
  };
}

function skillLevel(skill: Pick<SkillResult, "score" | "status" | "upcoming" | "upcomingTerm">): string {
  if (skill.score === null) {
    if (skill.status === "exempt_only") return LEVELS.exempt;
    return skill.upcoming ? `Sắp học${skill.upcomingTerm ? ` (${termName(skill.upcomingTerm)})` : ""}` : "Chưa có điểm";
  }
  // assistant-v10: 0–100 scores as the pages show them, floored to the tenth with the scale (2 decimals rounded before:
  // 72,37 and even 89,996 → "90" next to the level Giỏi).
  return `${LEVELS[levelOf(skill.score)]} (${formatScoreOf100(skill.score)} điểm)`;
}

function careerLines(result: AssessmentResult): string[] {
  const career = result.career;
  if (!career) return ["Vị trí nghề nghiệp mục tiêu: chưa chọn (chọn ở trang Định hướng nghề nghiệp để mình so kỹ năng với vị trí nghề nghiệp)."];
  const fit = typeof career.fitScore === "number" ? `điểm phù hợp ${formatScoreOf100(career.fitScore)} (${career.fitLabel})` : `mức phù hợp: ${career.fitLabel}`;
  return [`Vị trí nghề nghiệp mục tiêu: ${career.nameVi}; ${fit}; ${career.summaryText}.`];
}

/**
 * The target career's skills still missing, then the met ones worth raising, each under its own heading (assistant-v11,
 * user 2026-11-09: a student who met 4/4 skills was told "Hiện tại bạn chưa có kết quả Đánh giá năng lực mới nhất": the
 * met skills sat under "cần bổ sung" and no line said that none was missing). `lines` holds roadmapDataSections' line of
 * each `skills` item, in the same order ("Không có." alone without any).
 */
export function careerSkillLines(result: AssessmentResult, skills: readonly Pick<RoadmapSkill, "kind">[], lines: readonly string[]): string[] {
  const career = result.career;
  if (!career) return [];
  // The S01… keys of the roadmap prompt mean nothing to the student: the lines go without them.
  const line = (index: number) => (lines[index] ?? "").replace(/^- \[S\d+\] /, "- ");
  const missing = skills.flatMap((skill, index) => skill.kind === "deepen" ? [] : [line(index)]);
  const raise = skills.flatMap((skill, index) => skill.kind === "deepen" ? [line(index)] : []);
  const out = missing.length ? ["Kỹ năng của vị trí nghề nghiệp cần bổ sung:", ...missing]
    : career.counts.total > 0
      ? [`Kỹ năng của vị trí nghề nghiệp còn thiếu: không có. Theo kết quả Đánh giá năng lực của bạn, bạn đã đạt ngưỡng cả ${career.counts.met}/${career.counts.total} kỹ năng của vị trí nghề nghiệp này.`]
      : ["Vị trí nghề nghiệp này chưa có kỹ năng yêu cầu nào."];
  if (raise.length) out.push("Kỹ năng đã đạt, có thể học thêm để nâng lên mức cao hơn:", ...raise);
  return out;
}

function overallLine(result: AssessmentResult): string {
  const overall = result.overall;
  if (overall.score === null) return "Mức năng lực chung: chưa có điểm.";
  return `Mức năng lực chung: ${LEVELS[levelOf(overall.score)]} (${formatScoreOf100(overall.score)} điểm, dựa trên ${overall.basis.skillsWithEvidence}/${overall.basis.applicableSkills} kỹ năng có điểm).`;
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
  return [...picked.values()].map((skill) => `- ${skill.name}${skill.careerSkill ? " (kỹ năng của vị trí nghề nghiệp mục tiêu)" : ""}: ${skillLevel(skill)}`);
}

/**
 * The newest AI roadmap as the student page shows it: names instead of codes and keys, and for a roadmap written while its
 * data gave the GPA behind the thesis way, without the sentences explaining the way by it (assistant-v12, present.ts).
 */
export function aiRoadmapLines(row: RoadmapRow, newestAssessmentId: string): string[] {
  const output = shownRoadmapOutput(row);
  if (!output) return [];
  const facts: RoadmapFacts = row.facts;
  const names = new Map<string, string>();
  for (const item of facts.study) names.set(item.code, item.name);
  for (const choice of facts.choices) for (const option of choice.options) names.set(option.code, option.name);
  for (const item of facts.improve) names.set(item.code, item.name);
  const skillNames = new Map(facts.skills.map((skill) => [skill.key, skill.name]));
  const course = (code: string) => `${names.get(code) ?? code} (${code})`;
  const lines = [`Lộ trình cho ${facts.window.term ? termName(facts.window.term) : "học kỳ tới"}, tạo ngày ${dateText(row.createdAt)}${row.assessmentId === newestAssessmentId ? "" : " từ một kết quả đánh giá cũ hơn"}.`];
  if (output.summary) lines.push(`Nhận định: ${output.summary}`);
  for (const advice of output.advice ?? []) lines.push(`- Lời khuyên: ${advice}`);
  for (const item of output.study) lines.push(`- Nên học ${course(item.code)}${item.advice ? `: ${item.advice}` : ""}`);
  // A course not passed is "học lại", a passed one "học cải thiện" (user 2026-10-31: "Phải phân biệt học lại (chưa đạt) với học cải thiện").
  const actions = new Map(facts.improve.map((item) => [item.code, item.action]));
  for (const item of output.improve) {
    lines.push(`- ${actions.get(item.code) === "retake" ? "Nên học lại" : "Có thể học cải thiện"} ${course(item.code)}${item.advice ? `: ${item.advice}` : ""}`);
  }
  for (const item of output.skills) lines.push(`- Nên tự học kỹ năng ${skillNames.get(item.key) ?? item.key}${item.why ? `: ${item.why}` : ""}`);
  return lines;
}

/** Without an assessment only the profile (and the transcript, if any) is known; the answer should say how to get the rest. */
async function profileOnly(db: Db, userId: string, hasTranscript: boolean): Promise<ContextSource> {
  const result = await db.query<{ cohortCode: string | null; specialty: SpecialtyCode | null; career: string | null }>(
    `SELECT p.cohort_code AS "cohortCode",p.specialty,c.name_vi AS career FROM student_profiles p
      LEFT JOIN career_positions c ON c.id=p.career_position_id AND c.deleted_at IS NULL WHERE p.user_id=$1`, [userId]);
  const row = result.rows[0];
  return {
    kind: "profile", title: "Hồ sơ học tập của bạn", link: "#profile",
    text: clean([
      `Khóa: ${row?.cohortCode ?? "chưa cập nhật"}`,
      `Chuyên ngành: ${specialtyLabel(row?.specialty ?? null) ?? "Chưa xác định"}`,
      `Vị trí nghề nghiệp mục tiêu: ${row?.career ?? "Chưa chọn"}`,
      // assistant-v5 (2026-10-29, user: "nên trả lời một cách rõ ràng hơn bạn chưa thực hiện đánh giá năng lực nên chúng tôi
      // chưa có cơ sở để tư vấn"): the missing results and the steps, for the answer to say first.
      hasTranscript
        ? "Bạn đã import bảng điểm nhưng chưa thực hiện Đánh giá năng lực nên EduPath AI chưa có cơ sở để tư vấn về kỹ năng, học phần nên học, lộ trình và tiến độ tốt nghiệp của bạn. Cần làm: bấm Đánh giá năng lực ở trang Đánh giá năng lực (cần đủ bảng điểm, chuyên ngành và vị trí nghề nghiệp mục tiêu)."
        : "Bạn chưa import bảng điểm và chưa thực hiện Đánh giá năng lực nên EduPath AI chưa có cơ sở để tư vấn về điểm, kỹ năng, học phần nên học, lộ trình và tiến độ tốt nghiệp của bạn. Cần làm: import bảng điểm PDF ở Hồ sơ và bảng điểm, chọn chuyên ngành và vị trí nghề nghiệp mục tiêu, rồi bấm Đánh giá năng lực ở trang Đánh giá năng lực.",
    ]),
  };
}

/**
 * The student's sources for one question. Always: profile, the transcript (if any), the target career's skills, the
 * courses to take or improve, the graduation pace. By intent: the skill levels (gaps, or a skill named in the question),
 * the newest AI roadmap (roadmap, course_reason) and the profile survey (roadmap, resources; only under a valid
 * profile_survey consent, or filled in for the student by a cố vấn học tập or the Khoa, surveyUsable). The transcript gives the rows the question names, or every row for a grade question.
 */
export async function studentSources(db: Db, userId: string, question: string, intents: readonly AssistantIntent[], now: Date = new Date()): Promise<StudentContext> {
  const assessment = await newestAssessment(db, userId);
  const transcript = await readTranscript(db, userId);
  const transcriptPart = transcript ? [transcriptSource(transcript, question, intents)] : [];
  if (!assessment) return { sources: [await profileOnly(db, userId, transcript !== null), ...transcriptPart], gapSkills: [] };
  const wants = (...names: AssistantIntent[]) => names.some((name) => intents.includes(name));
  // assistant-v12: the thesis group follows the way the student chose in Kế hoạch học kỳ, as Lộ trình AI does (roadmap-v16).
  const facts = buildRoadmapFacts(assessment.id, assessment.computed, roadmapWindow(now), await readRoadmapRelations(db, assessment.computed),
    await readOwnPlannedCodes(db, userId));
  let survey = null;
  if (wants("roadmap", "resources")) {
    const row = await readSurvey(db, userId);
    if (row && await surveyUsable(db, userId, row)) survey = surveyFacts(row);
  }
  const sections = roadmapDataSections(facts, survey);
  const sources: ContextSource[] = [
    {
      kind: "profile", title: "Hồ sơ học tập của bạn", link: "#profile",
      // assistant-v11: said as a fact the answer cannot turn into "bạn chưa có kết quả" ("Kết quả … mới nhất: ngày …" before).
      text: clean([...sections.profile, sections.window.at(-1) ?? "", `Bạn đã làm Đánh giá năng lực; kết quả mới nhất ngày ${dateText(assessment.createdAt)}.`]),
    },
    ...transcriptPart,
    {
      kind: "assessment", title: "Kỹ năng của vị trí nghề nghiệp mục tiêu (kết quả đánh giá năng lực)", link: "#skill-gap",
      text: clean([...careerLines(assessment.computed), overallLine(assessment.computed), ...careerSkillLines(assessment.computed, facts.skills, sections.skills)]),
    },
    {
      kind: "roadmap", title: "Học phần đang học, cần học, cần học lại và có thể học cải thiện", link: "#roadmap",
      text: clean(["Đang học:", ...sections.running, "Cần học theo kế hoạch đào tạo:", ...sections.needed, "Cần học lại (chưa đạt) và có thể học cải thiện (đã đạt, muốn nâng điểm):", ...sections.improve]),
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

/**
 * Names of the target career's skills the self-study resources are looked up for: those still to build; with none left
 * (assistant-v11), the met ones from the lowest score up, so a student who met them all gets resources for the career's
 * own skills, not whatever the question's words find (TCP/IP and Machine learning for a web developer, 2026-11-09).
 */
export function gapSkillNames(result: AssessmentResult | null): string[] {
  if (!result?.career) return [];
  const named = result.career.requirements.filter((requirement) => requirement.skillName);
  const gaps = named.filter((requirement) => requirement.status !== "met");
  const picked = gaps.length ? gaps : [...named].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  return picked.map((requirement) => requirement.skillName!).slice(0, 5);
}
