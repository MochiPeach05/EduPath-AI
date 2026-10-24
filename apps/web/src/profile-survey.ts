// "Khảo sát định hướng" of the profile (user 2026-10-24): ten single-choice questions, "Thế mạnh của bạn" (1 to 5
// technologies and a description, survey-v3), "Sở trường" (1 to 5) and the achievements yes/no with a list when yes, all
// required. The questions and
// interest lists come from the API (apps/api/src/student/survey.ts, interests.ts).
import { interestProblem, type InterestOption } from "./profile-interests";

export const SURVEY_API = "/api/student/survey";

export type SurveyQuestion = { id: string; label: string; options: { id: string; label: string }[] };
export type StudentSurvey = {
  version: string; answers: Record<string, string>; interestTech: string[]; strengths: string | null; interestHobbies: string[];
  hasAchievements: boolean; achievements: string | null; updatedAt: string; complete: boolean;
};
/** What the profile held before the interests moved into the survey: the form starts from it. */
export type PreviousInterests = { tech: string[]; hobbies: string[]; text: string | null };
export type SurveyResponse = {
  questions: SurveyQuestion[]; interests: { tech: InterestOption[]; hobbies: InterestOption[]; max: number }; achievementsMax: number; strengthsMax: number;
  survey: StudentSurvey | null; previous: PreviousInterests | null; consentVersion: string | null;
};
/** hasAchievements is null until the student picks Có or Không. */
export type SurveyDraft = {
  answers: Record<string, string>; interestTech: string[]; strengths: string; interestHobbies: string[]; hasAchievements: boolean | null; achievements: string;
};

export const draftOf = (survey: StudentSurvey | null, previous: PreviousInterests | null = null): SurveyDraft => ({
  answers: { ...(survey?.answers ?? {}) },
  interestTech: survey?.interestTech.length ? [...survey.interestTech] : [...(previous?.tech ?? [])],
  strengths: survey?.strengths ?? "",
  interestHobbies: survey?.interestHobbies.length ? [...survey.interestHobbies] : [...(previous?.hobbies ?? [])],
  hasAchievements: survey ? survey.hasAchievements : null,
  achievements: survey?.achievements ?? "",
});

/** The label of the answer to a question, or null. */
export const answerLabel = (question: SurveyQuestion, answers: Record<string, string>) =>
  question.options.find((option) => option.id === answers[question.id])?.label ?? null;

/** Field keys of the form: "q:<question id>", "tech", "strengths", "hobbies", "hasAchievements", "achievements", "consent". */
export type SurveyField = `q:${string}` | "tech" | "strengths" | "hobbies" | "hasAchievements" | "achievements" | "consent";

/** What still blocks saving, in form order, with the Vietnamese message shown under each field. */
export function surveyProblems(questions: SurveyQuestion[], draft: SurveyDraft, options: { needsConsent: boolean; consented: boolean; achievementsMax: number; strengthsMax?: number }): [SurveyField, string][] {
  const problems: [SurveyField, string][] = [];
  for (const question of questions) {
    if (!question.options.some((option) => option.id === draft.answers[question.id])) problems.push([`q:${question.id}`, "Vui lòng chọn một câu trả lời."]);
  }
  const tech = interestProblem("tech", draft.interestTech);
  if (tech) problems.push(["tech", tech]);
  const strengths = draft.strengths.trim();
  const strengthsMax = options.strengthsMax ?? 500;
  if (!strengths) problems.push(["strengths", "Vui lòng mô tả công nghệ bạn thành thạo."]);
  else if (strengths.length > strengthsMax) problems.push(["strengths", `Phần mô tả tối đa ${strengthsMax.toLocaleString("vi-VN")} ký tự (hiện có ${strengths.length.toLocaleString("vi-VN")}).`]);
  const hobbies = interestProblem("hobbies", draft.interestHobbies);
  if (hobbies) problems.push(["hobbies", hobbies]);
  if (draft.hasAchievements === null) problems.push(["hasAchievements", "Vui lòng chọn Có hoặc Không."]);
  else if (draft.hasAchievements) {
    const text = draft.achievements.trim();
    if (!text) problems.push(["achievements", "Vui lòng liệt kê thành tích của bạn."]);
    else if (text.length > options.achievementsMax) problems.push(["achievements", `Thành tích tối đa ${options.achievementsMax.toLocaleString("vi-VN")} ký tự (hiện có ${text.length.toLocaleString("vi-VN")}).`]);
  }
  if (options.needsConsent && !options.consented) problems.push(["consent", "Vui lòng đánh dấu ô đồng ý trước khi lưu."]);
  return problems;
}

/** "Còn 3 mục chưa hoàn thành." for the screen-reader summary and the line above the save button. */
export const problemSummary = (count: number) => (count ? `Còn ${count} mục chưa hoàn thành. Vui lòng xem các thông báo màu đỏ.` : "");

const ERRORS: Record<string, string> = {
  invalid_survey: "Câu trả lời chưa hợp lệ. Vui lòng tải lại trang rồi thử lại.",
  strengths_required: "Vui lòng mô tả công nghệ bạn thành thạo.",
  strengths_too_long: "Phần mô tả thế mạnh quá dài.",
  achievements_required: "Vui lòng liệt kê thành tích của bạn.",
  achievements_too_long: "Danh sách thành tích quá dài.",
  consent_required: "Vui lòng đánh dấu ô đồng ý trước khi lưu.",
  policy_outdated: "Chính sách bảo mật vừa được cập nhật. Hãy tải lại trang, đọc chính sách mới rồi xác nhận lại.",
  insufficient_role: "Tài khoản hiện không dùng được chức năng này.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
  database_required: "Chưa kết nối được nơi lưu hồ sơ. Vui lòng thử lại sau.",
};
export const surveyErrorMessage = (code: string | undefined, status: number) =>
  status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : ERRORS[code ?? ""] ?? "Không lưu được khảo sát. Vui lòng thử lại.";
