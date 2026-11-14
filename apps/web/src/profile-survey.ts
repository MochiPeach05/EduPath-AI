// "Khảo sát nhanh" on Định hướng nghề nghiệp (survey-v5, 2026-11-14; was "Khảo sát định hướng" of the profile, user
// 2026-10-24). The advisor found the old survey too long and made it a step students had to take before using EduPath AI
// ("khảo sát thì dài ơi dài … tụi nó nản ko mún xài"); the approved plan "Một bước để bắt đầu" keeps five items and makes
// it optional: Lĩnh vực quan tâm nhất, Thế mạnh của bạn (1 to 5 technologies), Mục tiêu sau tốt nghiệp, Thời gian tự học
// mỗi tuần and Tiếng Anh chuyên ngành. Sở trường and Thành tích are no longer asked. The questions and the technologies come
// from the API (apps/api/src/student/survey.ts, interests.ts). The policy and the consent keep the name "Khảo sát định
// hướng". Since 2026-11-10 a cố vấn học tập or the Khoa may fill it in for the student (savedBy): it counts without the
// student's consent, until the student saves it again themselves (policy 2026-11-10).
import { interestProblem, type InterestOption } from "./profile-interests";
import { isValidConsent } from "./public-information";

export const SURVEY_API = "/api/student/survey";
/** The survey's section on Định hướng nghề nghiệp (StudentProfileSurvey, StudentCareerGuidance). */
export const SURVEY_SECTION_ID = "khao-sat-nhanh";
/** Where the student finds the survey, for the links of other pages. */
export const SURVEY_PAGE_HREF = "#career";
/** The question the technologies ("Thế mạnh của bạn") follow in the form and the summary. */
const TECH_AFTER = "field";

export type SurveyQuestion = { id: string; label: string; options: { id: string; label: string }[] };
/** interestHobbies, hasAchievements and achievements: what survey-v4 and older stored; no longer asked, shown or sent. */
export type StudentSurvey = {
  version: string; answers: Record<string, string>; interestTech: string[]; updatedAt: string; complete: boolean;
  interestHobbies?: string[]; hasAchievements?: boolean; achievements?: string | null;
  /** Last saved for the student by their cố vấn học tập ("advisor") or the Khoa ("admin"); null when the student saved it. */
  savedBy?: "advisor" | "admin" | null;
};
/** What the profile held before the interests moved into the survey: the form starts from it. */
export type PreviousInterests = { tech: string[]; hobbies?: string[]; text: string | null };
/**
 * withdrawn: the student withdrew the consent (Xóa câu trả lời), so no one may fill the survey in for them. The API may
 * still send the lists of older surveys (interests.hobbies, achievementsMax): they are not used.
 */
export type SurveyResponse = {
  questions: SurveyQuestion[]; interests: { tech: InterestOption[]; hobbies?: InterestOption[]; max: number }; achievementsMax?: number;
  survey: StudentSurvey | null; previous: PreviousInterests | null; consentVersion: string | null; withdrawn?: boolean;
};
export type SurveyDraft = { answers: Record<string, string>; interestTech: string[] };

export const draftOf = (survey: StudentSurvey | null, previous: PreviousInterests | null = null): SurveyDraft => ({
  answers: { ...(survey?.answers ?? {}) },
  interestTech: survey?.interestTech.length ? [...survey.interestTech] : [...(previous?.tech ?? [])],
});

/**
 * What PUT /api/student/survey takes: the answers to the current questions only (an answer to a question of an older
 * survey would be refused) and the technologies.
 */
export const surveyBody = (questions: SurveyQuestion[], draft: SurveyDraft) => ({
  answers: Object.fromEntries(questions.flatMap((question) => draft.answers[question.id] ? [[question.id, draft.answers[question.id]!]] : [])),
  interestTech: draft.interestTech,
});

/** The label of the answer to a question, or null. */
export const answerLabel = (question: SurveyQuestion, answers: Record<string, string>) =>
  question.options.find((option) => option.id === answers[question.id])?.label ?? null;

/** The items of the form and the summary in order: Thế mạnh right after Lĩnh vực quan tâm nhất (else last), numbered 1… */
export type SurveyItem = { kind: "question"; question: SurveyQuestion; number: number } | { kind: "tech"; number: number };
export function surveyItems(questions: SurveyQuestion[]): SurveyItem[] {
  const at = questions.findIndex((question) => question.id === TECH_AFTER);
  const order: ({ kind: "question"; question: SurveyQuestion } | { kind: "tech" })[] = questions.map((question) => ({ kind: "question" as const, question }));
  order.splice(at < 0 ? order.length : at + 1, 0, { kind: "tech" });
  return order.map((item, index) => ({ ...item, number: index + 1 }));
}

/** Field keys of the form: "q:<question id>", "tech", "consent". */
export type SurveyField = `q:${string}` | "tech" | "consent";

/** What still blocks saving, in form order, with the Vietnamese message shown under each field. */
export function surveyProblems(questions: SurveyQuestion[], draft: SurveyDraft, options: { needsConsent: boolean; consented: boolean }): [SurveyField, string][] {
  const problems: [SurveyField, string][] = [];
  for (const item of surveyItems(questions)) {
    if (item.kind === "tech") {
      const tech = interestProblem("tech", draft.interestTech);
      if (tech) problems.push(["tech", tech]);
    } else if (!item.question.options.some((option) => option.id === draft.answers[item.question.id])) {
      problems.push([`q:${item.question.id}`, "Vui lòng chọn một câu trả lời."]);
    }
  }
  if (options.needsConsent && !options.consented) problems.push(["consent", "Vui lòng đánh dấu ô đồng ý trước khi lưu."]);
  return problems;
}

/** "Còn 3 mục chưa hoàn thành." for the screen-reader summary and the line above the save button. */
export const problemSummary = (count: number) => (count ? `Còn ${count} mục chưa hoàn thành. Vui lòng xem các thông báo màu đỏ.` : "");

/**
 * What stored answers still lack under the current questions and policy, in form order; empty when nothing is stored or
 * nothing is missing. Same rule as the API's "complete" (apps/api/src/student/survey.ts: the questions and 1 to 5
 * technologies) plus the consent, which answers filled in for the student by a cố vấn học tập or the Khoa do not need,
 * and which consent: false (their own view) leaves out.
 */
export function surveyGaps(questions: SurveyQuestion[], survey: StudentSurvey | null, consentVersion: string | null, consent = true): string[] {
  if (!survey) return [];
  const gaps: string[] = [];
  const unanswered = questions.filter((question) => answerLabel(question, survey.answers) === null).length;
  if (unanswered) gaps.push(`Trả lời ${unanswered} câu hỏi còn thiếu`);
  // Before survey-v3 the list meant "Công nghệ bạn thích": the technologies are chosen again.
  const older = survey.version === "survey-v1" || survey.version === "survey-v2";
  if (!survey.interestTech.length || older) gaps.push("Chọn công nghệ trong Thế mạnh của bạn");
  if (consent && !survey.savedBy && !isValidConsent(consentVersion)) {
    gaps.push(consentVersion ? "Xác nhận lại theo chính sách mới" : "Đánh dấu ô đồng ý cho EduPath AI dùng câu trả lời");
  }
  return gaps;
}

/** The gaps as one line: "Chọn công nghệ trong Thế mạnh của bạn và xác nhận lại theo chính sách mới". */
export function gapSentence(gaps: string[]): string {
  const parts = gaps.map((gap, index) => (index ? gap.charAt(0).toLocaleLowerCase("vi") + gap.slice(1) : gap));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} và ${parts.at(-1)}` : parts[0] ?? "";
}

const ERRORS: Record<string, string> = {
  invalid_survey: "Câu trả lời chưa hợp lệ. Vui lòng tải lại trang rồi thử lại.",
  consent_required: "Vui lòng đánh dấu ô đồng ý trước khi lưu.",
  survey_withdrawn: "Sinh viên đã xóa câu trả lời khảo sát và rút lại sự đồng ý, nên bạn không làm khảo sát thay được.",
  policy_outdated: "Chính sách bảo mật vừa được cập nhật. Hãy tải lại trang, đọc chính sách mới rồi xác nhận lại.",
  insufficient_role: "Tài khoản hiện không dùng được chức năng này.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
  database_required: "Chưa kết nối được nơi lưu hồ sơ. Vui lòng thử lại sau.",
};
/** What the request was doing, for the message when the API gives no known reason (or the network fails, status 0). */
export type SurveyAction = "load" | "save" | "delete";
const FALLBACKS: Record<SurveyAction, string> = {
  load: "Chưa tải được Khảo sát nhanh. Vui lòng thử lại.",
  save: "Không lưu được khảo sát. Vui lòng thử lại.",
  delete: "Chưa xóa được câu trả lời. Vui lòng thử lại.",
};
export const surveyErrorMessage = (code: string | undefined, status: number, action: SurveyAction = "save") =>
  status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : ERRORS[code ?? ""] ?? FALLBACKS[action];
