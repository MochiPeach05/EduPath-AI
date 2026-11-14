import type { PoolClient } from "pg";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { activeConsentVersion, consentWithdrawn, isValidConsent } from "./consent.js";
import { INTEREST_TECH, INTEREST_TECH_IDS, interestChoices, interestLabels } from "./interests.js";

// "Khảo sát định hướng" in the student profile (user 2026-10-24): "bổ sung cái vụ sở thích và thành tích làm như 1 cái
// form luôn á và bộ câu hỏi nên đi kèm câu trả lời dạng radius để tránh việc sv bỏ trống hoặc nhập bừa", and for
// achievements "cho nó chọn: nếu có thì chọn có xong hiện ra ô để sv liệt kê, còn nó chọn không có thì thôi và điều kiện là
// bắt buộc chọn luôn". The page renders the questions the API sends; the AI study roadmap reads the answers as their
// labels (policy 2026-10-24, consent purpose profile_survey, migration 048). survey-v2 (user, same day: "Công nghệ bạn
// thích và Sở thích khi rảnh có áp dụng vào được Khảo sát định hướng luôn không", AI uses them, policy 2026-10-25) adds
// the two interest lists (1 to 5 each, interests.ts, migration 050); a v1 survey is incomplete until saved again.
// survey-v3 (user, same day): question 11 is "Thế mạnh của bạn" (the technologies, plus a required description of those
// the student is proficient in, migration 051), question 12 "Sở trường"; a v2 survey is incomplete until saved again.
// survey-v4 (user 2026-10-31: "Bỏ cái câu tự luận ở thế mạnh của bạn đi"): "Thế mạnh của bạn" is the technologies only. A
// stored description is no longer read, shown or given to the AI, and saving the survey clears it; v3 surveys stay complete.
// Since 2026-11-10 (user: "Khảo sát định hướng … cố vấn học tập và quản trị viên làm luôn nhé", policy 2026-11-10) a cố vấn
// học tập or the Khoa may fill it in for the student (savedBy, migration 062): no consent is recorded in the student's name,
// and such a survey counts like the student's own unless the student withdrew the consent (surveyUsable).
// survey-v5 (2026-11-14, user: "Triển khai theo kế hoạch này đi" on the plan "Một bước để bắt đầu", after the thesis
// advisor's review: "khảo sát thì dài ơi dài … tụi nó nản ko mún xài lun"): the survey is optional, lives on Định hướng
// nghề nghiệp ("Khảo sát nhanh" on the page) and asks five things only: Lĩnh vực quan tâm nhất, Thế mạnh của bạn (the
// technologies), Mục tiêu sau tốt nghiệp, Thời gian tự học mỗi tuần and Tiếng Anh chuyên ngành. The other questions, Sở
// trường and Thành tích are no longer asked, required or given to the AI; saving the survey clears what they held. A
// survey-v3 or v4 answered all five, so it stays complete.

export const SURVEY_VERSION = "survey-v5";
/** Characters of the achievements list (survey-v4 and before; GET /survey still sends it for pages loaded before v5). */
export const ACHIEVEMENTS_MAX = 1000;

type SurveyQuestion = { id: string; label: string; options: readonly { id: string; label: string }[] };

/** Every question needs one answer; the page shows them in this order, "Thế mạnh của bạn" after the first one. */
export const SURVEY_QUESTIONS = [
  { id: "field", label: "Lĩnh vực quan tâm nhất", options: [
    { id: "web", label: "Web" }, { id: "mobile", label: "Di động" }, { id: "data", label: "AI, dữ liệu" }, { id: "security", label: "An ninh mạng" },
    { id: "cloud", label: "Cloud, DevOps" }, { id: "game", label: "Game" }, { id: "embedded", label: "Nhúng, IoT" }, { id: "unsure", label: "Chưa xác định" }] },
  { id: "goal", label: "Mục tiêu sau tốt nghiệp", options: [
    { id: "work", label: "Đi làm ngay" }, { id: "study", label: "Học lên cao (thạc sĩ, nghiên cứu)" },
    { id: "business", label: "Khởi nghiệp hoặc làm tự do" }, { id: "unsure", label: "Chưa xác định" }] },
  { id: "selfStudy", label: "Thời gian tự học mỗi tuần", options: [
    { id: "low", label: "Dưới 5 giờ" }, { id: "medium", label: "5–10 giờ" }, { id: "high", label: "Trên 10 giờ" }] },
  { id: "english", label: "Tiếng Anh chuyên ngành", options: [
    { id: "basic", label: "Khó khăn trong việc đọc hiểu" }, { id: "reading", label: "Đọc hiểu tốt" }, { id: "working", label: "Giao tiếp, làm việc được" }] },
] as const satisfies readonly SurveyQuestion[];
/** Questions of survey-v4 and before that survey-v5 no longer asks: a page loaded before v5 may still send their answers. */
const LEGACY_QUESTION_IDS = ["environment", "company", "partTime", "leadership", "projects", "internship"] as const;

export type SurveyAnswers = Record<string, string>;
/** Who filled in the survey for the student (migration 062): the class's cố vấn học tập, or the Khoa (an admin, Ban chủ nhiệm khoa). */
export type SurveySavedBy = "advisor" | "admin";
/**
 * interestTech makes "Thế mạnh của bạn". interestHobbies ("Sở trường"), hasAchievements and achievements are what a survey
 * saved before survey-v5 holds (empty after a v5 save); nothing reads them for a feature any more.
 */
export type StudentSurvey = {
  version: string; answers: SurveyAnswers; interestTech: string[]; interestHobbies: string[];
  hasAchievements: boolean; achievements: string | null; updatedAt: string;
  /** Every question of the current set is answered (a newer set may add questions). */
  complete: boolean;
  /** Last saved for the student in their page (policy 2026-11-10); null when the student saved it. */
  savedBy: SurveySavedBy | null;
};
/** What a save stores: the answers of SURVEY_QUESTIONS and the technologies. */
export type SurveyInput = { answers: SurveyAnswers; interestTech: string[] };

const answersSchema = z.object({
  ...Object.fromEntries(SURVEY_QUESTIONS.map((question) => [question.id, z.enum(question.options.map((option) => option.id) as [string, ...string[]])])),
  // Answers of the questions survey-v5 dropped: accepted and ignored.
  ...Object.fromEntries(LEGACY_QUESTION_IDS.map((id) => [id, z.string().max(40).optional()])),
}).strict();

/** One achievement per line: control characters dropped, lines trimmed, empty lines removed. */
export const cleanAchievements = (value: string) => value.normalize("NFC").replace(/\r\n?/g, "\n")
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");

const surveySchema = z.object({
  answers: answersSchema,
  interestTech: interestChoices(INTEREST_TECH_IDS),
  // What a page loaded before survey-v5 (or v4: the strengths description) may still send. Accepted and ignored.
  strengths: z.string().max(2000).optional(),
  interestHobbies: z.array(z.string().max(80)).max(20).optional(),
  hasAchievements: z.boolean().optional(),
  achievements: z.string().max(ACHIEVEMENTS_MAX * 4).nullable().optional(),
}).strict();

/** PUT /api/student/survey body → the answers to store, or the error code to send (400). */
export function parseSurveyInput(body: unknown): { value: SurveyInput } | { error: "invalid_survey" } {
  const parsed = surveySchema.safeParse(body);
  if (!parsed.success) return { error: "invalid_survey" };
  const answers: SurveyAnswers = Object.fromEntries(SURVEY_QUESTIONS.map((question) => [question.id, String(parsed.data.answers[question.id])]));
  return { value: { answers, interestTech: parsed.data.interestTech } };
}

/** Before survey-v3 the two lists meant other things ("Công nghệ bạn thích", "Sở thích khi rảnh"): such a survey stays incomplete. */
const BEFORE_STRENGTHS = new Set(["survey-v1", "survey-v2"]);
const isComplete = (row: Pick<StudentSurvey, "version" | "answers" | "interestTech">) =>
  !BEFORE_STRENGTHS.has(row.version)
  && SURVEY_QUESTIONS.every((question) => question.options.some((option) => option.id === row.answers[question.id]))
  && row.interestTech.length > 0;

type SurveyRow = {
  version: string; answers: SurveyAnswers; interest_tech: string[] | null; interest_hobbies: string[] | null;
  has_achievements: boolean; achievements: string | null; updated_at: Date | string; saved_by_role?: SurveySavedBy | null;
};
const surveyColumns = "survey_version AS version,answers,interest_tech,interest_hobbies,has_achievements,achievements,updated_at,saved_by_role";
function fromRow(row: SurveyRow): StudentSurvey {
  const survey = {
    version: row.version, answers: row.answers, interestTech: row.interest_tech ?? [], interestHobbies: row.interest_hobbies ?? [],
    hasAchievements: row.has_achievements, achievements: row.achievements, updatedAt: new Date(row.updated_at).toISOString(),
  };
  return { ...survey, complete: isComplete(survey), savedBy: row.saved_by_role ?? null };
}

export async function readSurvey(db: Pick<DatabasePool, "query"> | PoolClient, userId: string): Promise<StudentSurvey | null> {
  const row = (await db.query<SurveyRow>(`SELECT ${surveyColumns} FROM stu_profile_surveys WHERE user_id=$1`, [userId])).rows[0];
  return row ? fromRow(row) : null;
}

/**
 * Caller holds the user's row lock and has checked the consent (the student) or the withdrawal (savedBy: a cố vấn học tập
 * or the Khoa saving it for the student, policy 2026-11-10; the student's own save clears it). The interests chosen in the
 * profile before the move (049) and the free text before that are cleared: the survey holds them now. So is what survey-v5
 * no longer asks (2026-11-14): the answers of the dropped questions, Sở trường, Thành tích and a survey-v3 description of
 * the strengths.
 */
export async function saveSurvey(client: PoolClient, userId: string, input: SurveyInput,
  savedBy: { userId: string; role: SurveySavedBy } | null = null): Promise<StudentSurvey> {
  const result = await client.query<SurveyRow>(`INSERT INTO stu_profile_surveys(user_id,survey_version,answers,interest_tech,interest_hobbies,has_achievements,achievements,strengths,saved_by,saved_by_role)
    VALUES($1,$2,$3::jsonb,$4,'{}',false,NULL,NULL,$5,$6) ON CONFLICT(user_id) DO UPDATE SET survey_version=EXCLUDED.survey_version,answers=EXCLUDED.answers,
    interest_tech=EXCLUDED.interest_tech,interest_hobbies='{}',has_achievements=false,
    achievements=NULL,strengths=NULL,saved_by=EXCLUDED.saved_by,saved_by_role=EXCLUDED.saved_by_role,updated_at=now() RETURNING ${surveyColumns}`,
  [userId, SURVEY_VERSION, JSON.stringify(input.answers), input.interestTech, savedBy?.userId ?? null, savedBy?.role ?? null]);
  await client.query("UPDATE student_profiles SET interest_tech='{}',interest_hobbies='{}',interests=NULL WHERE user_id=$1", [userId]);
  return fromRow(result.rows[0]!);
}

/** What the student chose or wrote in the profile before the move, to start the survey's interest lists from. */
export async function readPreviousInterests(db: Pick<DatabasePool, "query"> | PoolClient, userId: string): Promise<{ tech: string[]; hobbies: string[]; text: string | null } | null> {
  const row = (await db.query<{ tech: string[] | null; hobbies: string[] | null; text: string | null }>(
    "SELECT interest_tech AS tech,interest_hobbies AS hobbies,NULLIF(btrim(interests),'') AS text FROM student_profiles WHERE user_id=$1", [userId])).rows[0];
  if (!row || (!row.tech?.length && !row.hobbies?.length && !row.text)) return null;
  return { tech: row.tech ?? [], hobbies: row.hobbies ?? [], text: row.text };
}

/**
 * "Xóa câu trả lời": the answers go, and with them every AI roadmap, which may have been written from them. Caller holds
 * the user's row lock and withdraws the consent.
 */
export async function deleteSurvey(client: PoolClient, userId: string): Promise<boolean> {
  const deleted = await client.query("DELETE FROM stu_profile_surveys WHERE user_id=$1", [userId]);
  await client.query("DELETE FROM stu_roadmaps WHERE user_id=$1", [userId]);
  return Boolean(deleted.rowCount);
}

/**
 * Whether the AI features (Lộ trình AI, Trợ lý AI) and Định hướng nghề nghiệp may use the stored survey: complete, and
 * agreed to by the student under a policy whose consents still count, or filled in for the student by a cố vấn học tập or
 * the Khoa (savedBy) while the student has not withdrawn the consent ("Cho làm, báo sinh viên", policy 2026-11-10). The
 * same rule in SQL: SURVEY_COMPLETE_SQL (admin/student-profiles.ts). Nothing requires the survey since 2026-11-14: without
 * it these features work from the student's results alone.
 */
export async function surveyUsable(db: Pick<DatabasePool, "query"> | PoolClient, userId: string, survey: StudentSurvey | null): Promise<boolean> {
  if (survey?.complete !== true) return false;
  if (isValidConsent(await activeConsentVersion(db, userId, "profile_survey"))) return true;
  return survey.savedBy !== null && !await consentWithdrawn(db, userId, "profile_survey");
}

/**
 * What the AI study roadmap and Trợ lý AI read: each question of survey-v5 the student answered, with the label of the
 * answer, and the strengths (technologies by label). A survey saved before v5 gives the same five, never what v5 dropped.
 */
export type SurveyFacts = { answers: { question: string; answer: string }[]; tech: string[] };
export function surveyFacts(survey: Pick<StudentSurvey, "answers" | "interestTech">): SurveyFacts {
  return {
    answers: SURVEY_QUESTIONS.flatMap((question) => {
      const option = question.options.find((item) => item.id === survey.answers[question.id]);
      return option ? [{ question: question.label, answer: option.label }] : [];
    }),
    tech: interestLabels(INTEREST_TECH, survey.interestTech),
  };
}
