import type { PoolClient } from "pg";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";

// "Khảo sát định hướng" in the student profile (user 2026-10-24): "bổ sung cái vụ sở thích và thành tích làm như 1 cái
// form luôn á và bộ câu hỏi nên đi kèm câu trả lời dạng radius để tránh việc sv bỏ trống hoặc nhập bừa", and for
// achievements "cho nó chọn: nếu có thì chọn có xong hiện ra ô để sv liệt kê, còn nó chọn không có thì thôi và điều kiện là
// bắt buộc chọn luôn". The page renders the questions the API sends; the AI study roadmap reads the answers as their
// labels (policy 2026-10-24, consent purpose profile_survey, migration 048).

export const SURVEY_VERSION = "survey-v1";
/** Characters of the achievements list. */
export const ACHIEVEMENTS_MAX = 1000;

type SurveyQuestion = { id: string; label: string; options: readonly { id: string; label: string }[] };

/** Every question needs one answer. */
export const SURVEY_QUESTIONS = [
  { id: "goal", label: "Mục tiêu sau tốt nghiệp", options: [
    { id: "work", label: "Đi làm ngay" }, { id: "study", label: "Học lên cao (thạc sĩ, nghiên cứu)" },
    { id: "business", label: "Khởi nghiệp hoặc làm tự do" }, { id: "unsure", label: "Chưa xác định" }] },
  { id: "environment", label: "Môi trường học tập, làm việc bạn thích", options: [
    { id: "alone", label: "Làm việc độc lập" }, { id: "team", label: "Làm việc theo nhóm" }, { id: "both", label: "Kết hợp cả hai" }] },
  { id: "company", label: "Loại hình công ty mong muốn", options: [
    { id: "large", label: "Công ty lớn, quy trình rõ ràng" }, { id: "startup", label: "Startup năng động" },
    { id: "public", label: "Nhà nước, nghiên cứu" }, { id: "unsure", label: "Chưa xác định" }] },
  { id: "partTime", label: "Bạn có làm thêm không", options: [
    { id: "no", label: "Không" }, { id: "other", label: "Có, không liên quan CNTT" }, { id: "it", label: "Có, liên quan CNTT" }] },
  { id: "leadership", label: "Kinh nghiệm dẫn dắt nhóm", options: [
    { id: "none", label: "Chưa từng" }, { id: "one", label: "1 dự án" }, { id: "few", label: "2–3 dự án" }, { id: "many", label: "Từ 4 dự án" }] },
  { id: "projects", label: "Dự án ngoài môn học", options: [
    { id: "none", label: "Chưa có" }, { id: "some", label: "1–2 dự án" }, { id: "many", label: "Từ 3 dự án" }] },
  { id: "internship", label: "Thực tập", options: [
    { id: "none", label: "Chưa thực tập" }, { id: "current", label: "Đang thực tập" }, { id: "done", label: "Đã thực tập" }] },
  { id: "selfStudy", label: "Thời gian tự học mỗi tuần", options: [
    { id: "low", label: "Dưới 5 giờ" }, { id: "medium", label: "5–10 giờ" }, { id: "high", label: "Trên 10 giờ" }] },
  { id: "english", label: "Tiếng Anh chuyên ngành", options: [
    { id: "basic", label: "Đọc tài liệu còn khó" }, { id: "reading", label: "Đọc hiểu tốt" }, { id: "working", label: "Giao tiếp, làm việc được" }] },
  { id: "field", label: "Lĩnh vực quan tâm nhất", options: [
    { id: "web", label: "Web" }, { id: "mobile", label: "Di động" }, { id: "data", label: "AI, dữ liệu" }, { id: "security", label: "An ninh mạng" },
    { id: "cloud", label: "Cloud, DevOps" }, { id: "game", label: "Game" }, { id: "embedded", label: "Nhúng, IoT" }, { id: "unsure", label: "Chưa xác định" }] },
] as const satisfies readonly SurveyQuestion[];

export type SurveyAnswers = Record<string, string>;
export type StudentSurvey = {
  version: string; answers: SurveyAnswers; hasAchievements: boolean; achievements: string | null; updatedAt: string;
  /** Every question of the current set is answered (a newer set may add questions). */
  complete: boolean;
};
export type SurveyInput = { answers: SurveyAnswers; hasAchievements: boolean; achievements: string | null };

const answersSchema = z.object(Object.fromEntries(SURVEY_QUESTIONS.map((question) =>
  [question.id, z.enum(question.options.map((option) => option.id) as [string, ...string[]])]))).strict();

/** One achievement per line: control characters dropped, lines trimmed, empty lines removed. */
export const cleanAchievements = (value: string) => value.normalize("NFC").replace(/\r\n?/g, "\n")
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");

const surveySchema = z.object({
  answers: answersSchema,
  hasAchievements: z.boolean(),
  achievements: z.string().max(ACHIEVEMENTS_MAX * 4).nullable().optional(),
}).strict();

/** PUT /api/student/survey body → the answers to store, or the error code to send (400). */
export function parseSurveyInput(body: unknown): { value: SurveyInput } | { error: "invalid_survey" | "achievements_required" | "achievements_too_long" } {
  const parsed = surveySchema.safeParse(body);
  if (!parsed.success) return { error: "invalid_survey" };
  const { answers, hasAchievements } = parsed.data;
  if (!hasAchievements) return { value: { answers, hasAchievements, achievements: null } };
  const achievements = cleanAchievements(parsed.data.achievements ?? "");
  if (!achievements) return { error: "achievements_required" };
  if (achievements.length > ACHIEVEMENTS_MAX) return { error: "achievements_too_long" };
  return { value: { answers, hasAchievements, achievements } };
}

const isComplete = (answers: SurveyAnswers) =>
  SURVEY_QUESTIONS.every((question) => question.options.some((option) => option.id === answers[question.id]));

type SurveyRow = { version: string; answers: SurveyAnswers; has_achievements: boolean; achievements: string | null; updated_at: Date | string };
const surveyColumns = "survey_version AS version,answers,has_achievements,achievements,updated_at";
const fromRow = (row: SurveyRow): StudentSurvey => ({
  version: row.version, answers: row.answers, hasAchievements: row.has_achievements, achievements: row.achievements,
  updatedAt: new Date(row.updated_at).toISOString(), complete: isComplete(row.answers),
});

export async function readSurvey(db: Pick<DatabasePool, "query"> | PoolClient, userId: string): Promise<StudentSurvey | null> {
  const row = (await db.query<SurveyRow>(`SELECT ${surveyColumns} FROM stu_profile_surveys WHERE user_id=$1`, [userId])).rows[0];
  return row ? fromRow(row) : null;
}

/** Caller holds the user's row lock and has checked the consent. */
export async function saveSurvey(client: PoolClient, userId: string, input: SurveyInput): Promise<StudentSurvey> {
  const result = await client.query<SurveyRow>(`INSERT INTO stu_profile_surveys(user_id,survey_version,answers,has_achievements,achievements)
    VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(user_id) DO UPDATE SET survey_version=EXCLUDED.survey_version,answers=EXCLUDED.answers,
    has_achievements=EXCLUDED.has_achievements,achievements=EXCLUDED.achievements,updated_at=now() RETURNING ${surveyColumns}`,
  [userId, SURVEY_VERSION, JSON.stringify(input.answers), input.hasAchievements, input.achievements]);
  return fromRow(result.rows[0]!);
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

/** What the AI study roadmap reads: each answered question with the label of its answer, and the achievements list. */
export type SurveyFacts = { answers: { question: string; answer: string }[]; achievements: string | null };
export function surveyFacts(survey: Pick<StudentSurvey, "answers" | "hasAchievements" | "achievements">): SurveyFacts {
  return {
    answers: SURVEY_QUESTIONS.flatMap((question) => {
      const option = question.options.find((item) => item.id === survey.answers[question.id]);
      return option ? [{ question: question.label, answer: option.label }] : [];
    }),
    achievements: survey.hasAchievements ? survey.achievements : null,
  };
}
