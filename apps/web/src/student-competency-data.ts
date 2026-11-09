// Pure helpers for the #competency page: labels, formatting, AI key mapping and
// the polling decision. No fetch, no DOM — everything here is unit tested.
import type {
  AiCommentContext, AiOutput, AiPriority, AiStatus, AssessmentResult, CareerRequirementResult, CareerResult, Confidence,
  CourseState, Eligibility, HistoryPoint, LevelCode, PlanProgressResult, PreviousAiComment, SelfStudyItem, SkillPlan, SkillResult, StoredAssessment, SupportCourse,
} from "./competency-assessment-types";
import { meaningOf, scoreText, termName, type Meaning } from "./display-format";
import { ADVISOR_ERRORS } from "./advisor-types";

export const COMPETENCY_API = "/api/student/competency-assessments";

/* ----------------------------------------------------------------- errors */

/** Errors of POST / that describe a missing precondition: shown as a calm empty state, not as a failure. */
export const PRECONDITION_ERRORS = ["transcript_required", "career_required", "specialty_required", "cohort_unknown", "curriculum_unavailable", "curriculum_ambiguous", "competency_weights_unavailable"] as const;
export type PreconditionError = typeof PRECONDITION_ERRORS[number];

export function isPreconditionError(code: string | null | undefined): code is PreconditionError {
  return (PRECONDITION_ERRORS as readonly string[]).includes(code ?? "");
}

/** Title, explanation and next step for each precondition. */
export const PRECONDITION_COPY: Record<PreconditionError, { title: string; text: string; action: { label: string; href: string } | null }> = {
  transcript_required: { title: "Cần bảng điểm để bắt đầu", text: "EduPath AI tính năng lực từ kết quả các học phần bạn đã học. Hãy import bảng điểm PDF xuất từ cổng đào tạo, rồi quay lại đây.", action: { label: "Import bảng điểm", href: "#profile" } },
  career_required: { title: "Cần chọn vị trí nghề nghiệp mục tiêu", text: "Đánh giá năng lực cần đủ bảng điểm, vị trí nghề nghiệp mục tiêu và chuyên ngành. Hãy chọn vị trí nghề nghiệp mục tiêu ở trang Định hướng nghề nghiệp, rồi quay lại đây.", action: { label: "Chọn vị trí nghề nghiệp mục tiêu", href: "#career" } },
  specialty_required: { title: "Cần chọn chuyên ngành", text: "Đánh giá năng lực cần đủ bảng điểm, vị trí nghề nghiệp mục tiêu và chuyên ngành. Hãy chọn chuyên ngành trong hồ sơ, rồi quay lại đây.", action: { label: "Chọn chuyên ngành", href: "#profile" } },
  cohort_unknown: { title: "Hồ sơ chưa có khóa học", text: "Hệ thống cần biết bạn thuộc khóa nào để chọn đúng chương trình đào tạo. Thông tin khóa được đồng bộ từ tài khoản trường; nếu mục Khóa học trong hồ sơ còn trống, hãy liên hệ Khoa để được cập nhật.", action: { label: "Xem hồ sơ", href: "#profile" } },
  curriculum_unavailable: { title: "Chưa có chương trình đào tạo cho khóa của bạn", text: "Khoa chưa công bố chương trình đào tạo đang áp dụng cho khóa này trên EduPath AI. Bạn có thể quay lại sau khi chương trình được cập nhật.", action: null },
  curriculum_ambiguous: { title: "Khóa của bạn đang có nhiều chương trình đào tạo", text: "Có hơn một chương trình đào tạo đang áp dụng cho khóa này nên hệ thống chưa chọn được bản đúng. Khoa sẽ rà soát lại; bạn chưa cần làm gì thêm.", action: null },
  competency_weights_unavailable: { title: "Khóa của bạn chưa có dữ liệu kỹ năng", text: "Để tính năng lực, mỗi học phần cần được Khoa gắn với các kỹ năng mà học phần đó rèn luyện. Chương trình của khóa bạn chưa có dữ liệu này, nên chưa thể đánh giá. Bảng điểm và hồ sơ của bạn vẫn được giữ nguyên; hãy quay lại khi Khoa cập nhật.", action: null },
};

const ERROR_MESSAGES: Record<string, string> = {
  consent_required: "Hãy đồng ý để EduPath AI dùng bảng điểm cho việc đánh giá năng lực.",
  policy_outdated: "Chính sách bảo mật vừa được cập nhật. Hãy tải lại trang, đọc chính sách mới rồi xác nhận lại.",
  transcript_changed: "Bảng điểm vừa thay đổi trong lúc đánh giá. Hãy bấm đánh giá lại.",
  assessment_too_frequent: "Bạn vừa đánh giá xong. Hãy đợi khoảng một phút rồi thử lại.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  database_required: "Chưa kết nối được nơi lưu kết quả. Vui lòng thử lại sau.",
  insufficient_role: "Tài khoản hiện không có quyền sinh viên.",
  ai_disabled: "Nhận xét AI hiện chưa được bật.",
  ai_not_regenerable: "Nhận xét đang được tạo hoặc đã có. Hãy đợi kết quả hiện tại.",
  queue_full: "Hàng đợi nhận xét AI đang đầy. Vui lòng thử lại sau ít phút.",
  not_found: "Không tìm thấy kết quả đánh giá này. Hãy tải lại trang.",
  assessment_not_found: "Không tìm thấy kết quả đánh giá này. Hãy tải lại trang.",
  account_unavailable: "Tài khoản của bạn hiện không dùng được tính năng này. Vui lòng liên hệ Khoa nếu cần hỗ trợ.",
  invalid_input: "Yêu cầu chưa hợp lệ. Vui lòng tải lại trang rồi thử lại.",
  // A cố vấn học tập's run after the student deleted their results (advisors/access.ts, 409).
  assessment_withdrawn: ADVISOR_ERRORS.assessment_withdrawn!,
  ...Object.fromEntries(PRECONDITION_ERRORS.map((code) => [code, PRECONDITION_COPY[code].title])),
};

export function errorMessage(code: string | null | undefined, fallback = "Thao tác chưa thành công. Vui lòng thử lại."): string {
  return ERROR_MESSAGES[code ?? ""] ?? fallback;
}

/**
 * The checklist items still missing before an assessment: all three are required (user, 2026-10-21;
 * the server checks the same). A value not known yet (loading, or an older API without the
 * specialty) is left to the server.
 */
export function missingRequirements(hasTranscript: boolean | null, profile: { careerPositionId?: string | null; specialty?: string | null } | null): string[] {
  return [
    hasTranscript === false ? "bảng điểm" : null,
    profile && !profile.careerPositionId ? "vị trí nghề nghiệp mục tiêu" : null,
    profile && profile.specialty !== undefined && !profile.specialty ? "chuyên ngành" : null,
  ].filter((item): item is string => item !== null);
}
/** "a", "a và b", "a, b và c". */
const joinWords = (words: readonly string[]) => words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} và ${words.at(-1)}`;
export const missingRequirementsMessage = (missing: readonly string[]) =>
  `Cần đủ bảng điểm, vị trí nghề nghiệp mục tiêu và chuyên ngành để đánh giá năng lực. Hãy bổ sung ${joinWords(missing)} rồi bấm lại.`;

/** Why the AI comment failed, in the student's words. */
const AI_ERROR_MESSAGES: Record<string, string> = {
  ai_timeout: "Máy AI xử lý quá thời gian cho phép.",
  ai_output_truncated: "Nhận xét bị cắt giữa chừng nên chưa dùng được.",
  invalid_ai_output: "Nhận xét chưa khớp với số liệu đã tính nên hệ thống không hiển thị.",
  ollama_unavailable: "Máy AI tạm thời không phản hồi.",
  worker_timeout: "Máy AI chưa xử lý xong trong thời gian cho phép.",
  ai_failed: "Máy AI gặp lỗi khi tạo nhận xét.",
};
export function aiErrorMessage(code: string | null | undefined): string {
  return AI_ERROR_MESSAGES[code ?? ""] ?? "Chưa tạo được nhận xét.";
}

/* ------------------------------------------------------------- formatting */

const integer = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const oneDecimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
/**
 * Scores are classified unrounded by the engine and shown with scoreText (display-format.ts): one decimal at most, rounded
 * DOWN to the tenth, so a shown score never crosses a level or threshold it has not reached (89,96 shows 89,9) and every page
 * prints the same number (user 2026-10-30: Năng lực chung read 59,8 on Tổng quan and 59 here).
 */
export const formatScore = (value: number | null | undefined) => (value === null || value === undefined ? "—" : scoreText(value));
export const formatNumber = (value: number | null | undefined) => value === null || value === undefined ? "—" : decimal.format(value);
export const formatPercent = (share: number | null | undefined) => share === null || share === undefined ? "—" : `${integer.format(share * 100)}%`;
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}
/** "HK253" → "HK3 2025–2026" (termName, the one way terms are written); no term is "Chưa xếp lịch". */
export const termLabel = (term: string | null | undefined): string => (term ? termName(term) : "Chưa xếp lịch");
/** "Sắp học · HK3 2026–2027": a skill or course still to come, its term written like termLabel (2026-10-25 audit, "Sắp học · HK263" before). */
export const upcomingText = (term: string | null | undefined) => (term ? `Sắp học · ${termLabel(term)}` : "Sắp học");

/* ------------------------------------------------------------ terms ahead */

/**
 * The term being studied (comp-calc-v13): stored with the transcript since comp-calc-v17, else the plan's current term of a
 * v13+ result, else the latest graded term. "Sắp học" and overdue courses count from it.
 */
export function studyTermOf(result: Pick<AssessmentResult, "transcript" | "progress" | "meta">): string | null {
  if (result.transcript.studyTerm !== undefined) return result.transcript.studyTerm;
  if (result.progress && countsFromStudyTerm(result.meta.calcVersion)) return result.progress.currentTerm;
  return result.transcript.latestTerm;
}
/** The term after the one being studied, from the plan (v13+ results), else null ("học kỳ tới"). */
export function nextTermOf(result: Pick<AssessmentResult, "progress" | "meta">): string | null {
  return result.progress && countsFromStudyTerm(result.meta.calcVersion) ? result.progress.nextTerm : null;
}
/**
 * A course whose planned term is the term being studied or earlier and that is not in progress (SupportCourse.overdue,
 * comp-calc-v17; compared here for results stored before).
 */
export function isOverdue(course: { term: string | null; state: CourseState; overdue?: boolean }, studyTerm: string | null): boolean {
  if (course.overdue !== undefined) return course.overdue;
  return course.term !== null && studyTerm !== null && course.state !== "in_progress" && course.term <= studyTerm;
}
/** "Đã qua học kỳ dự kiến HK3 2023–2024 — đăng ký ở HK2 2026–2027" (or "ở học kỳ tới" when the next term is not known). */
export const overdueText = (term: string, nextTerm: string | null) => `Đã qua học kỳ dự kiến ${termName(term)} — đăng ký ở ${nextTerm ? termName(nextTerm) : "học kỳ tới"}`;
/** The "Học kỳ" of a suggested course: "HK1 2026–2027 theo KHĐT", "Chưa xếp lịch", or the overdue wording when its term has passed. */
export function courseTermText(course: Pick<SupportCourse, "term" | "termSource" | "state" | "overdue">, studyTerm: string | null, nextTerm: string | null): string {
  if (!course.term) return "Chưa xếp lịch";
  if (isOverdue(course, studyTerm)) return overdueText(course.term, nextTerm);
  return `${termName(course.term)} theo ${course.termSource === "plan" ? "KHĐT" : "CTĐT"}`;
}
/**
 * What an evidence course not taken yet says (2026-10-25 audit): "Sắp học · HK2 2026–2027" when it is planned after the
 * term being studied (the engine's rule for SkillResult.upcoming), else "Chưa học" (its term has passed or it has none).
 */
export function plannedCourseNote(plannedTerm: string | null, studyTerm: string | null): string {
  return plannedTerm !== null && (studyTerm === null || plannedTerm > studyTerm) ? upcomingText(plannedTerm) : "Chưa học";
}

/**
 * A plan choice label as the student reads it, like the engine's choiceLabel (comp-calc-v17), so results stored before read the
 * same: spaces normalised ("Chọn1 trong 3 môn sau" → "Chọn 1 trong 3 môn sau") and "Chọn k trong n" rebuilt from the options
 * listed when the label's n differs ("Chọn 1 trong 4 môn sau" over 3 courses).
 */
export function choiceLabel(label: string, required?: number, optionCount?: number): string {
  let text = label.normalize("NFC").replace(/\s+/g, " ").trim()
    .replace(/(ch[oọ]n)\s*(\d+)/iu, "$1 $2").replace(/(\d+)\s*(trong)(?![\p{L}])/iu, "$1 $2").replace(/(trong)\s*(\d+)/iu, "$1 $2");
  const rule = /(ch[oọ]n )(\d+)( trong )(\d+)/iu.exec(text);
  if (rule && optionCount && optionCount > 0 && Number(rule[4]) !== optionCount) {
    const k = Math.min(required ?? Number(rule[2]), optionCount);
    text = text.replace(rule[0], `${rule[1]}${k}${rule[3]}${optionCount}`);
  }
  return text;
}

/* ----------------------------------------------------------------- levels */

/**
 * Levels named and bounded like the transcript's classification (user, 2026-10-22: "3.2 thì ở đây 80đ
 * thì nó phải là mức giỏi rồi, 3.6 … là xuất sắc, còn 2.8 là khá"): VLU prints hệ 4 = hệ 10 × 0,4, so
 * a 0–100 score is the 4-point average × 25 and the bounds are 3,6 · 3,2 · 2,5 · 2,0 × 25. Mirrors the
 * API's LEVEL_THRESHOLDS (comp-calc-v10); before it the levels were Thành thạo ≥ 85, Khá ≥ 70, Cơ bản ≥ 50, Cần củng cố.
 */
export const LEVEL_THRESHOLDS = { excellent: 90, proficient: 80, good: 62.5, basic: 50 } as const;
export type ScoredLevel = "excellent" | "proficient" | "good" | "basic" | "needs_work";
export const LEVEL_LABELS: Record<ScoredLevel, string> = { excellent: "Xuất sắc", proficient: "Giỏi", good: "Khá", basic: "Trung bình", needs_work: "Yếu" };
/** The level of a stored score (rounded down to 2 decimals, so it never passes a bound the unrounded score has not). */
export function levelOfScore(score: number): ScoredLevel {
  const t = LEVEL_THRESHOLDS;
  return score >= t.excellent ? "excellent" : score >= t.proficient ? "proficient" : score >= t.good ? "good" : score >= t.basic ? "basic" : "needs_work";
}
const releveled = <T extends { score: number | null; level: LevelCode | null; levelLabel: string | null }>(item: T): T => {
  if (item.score === null) return item;
  const level = levelOfScore(item.score);
  return { ...item, level, levelLabel: LEVEL_LABELS[level] };
};
/**
 * The result with every score read on the current scale, so a result stored before comp-calc-v10
 * shows the new levels too. Its career thresholds and plans stay as they were computed until the
 * student runs the assessment again.
 */
export function withCurrentLevels(result: AssessmentResult): AssessmentResult {
  return {
    ...result,
    overall: releveled(result.overall),
    groups: result.groups.map(releveled),
    skills: result.skills.map(releveled),
    career: result.career && { ...result.career, requirements: result.career.requirements.map(releveled) },
    ...(result.skillPlans ? { skillPlans: result.skillPlans.map(releveled) } : {}),
    ...(result.history ? { history: result.history.map((point) => ({ ...point, overall: releveled(point.overall), groups: point.groups.map(releveled) })) } : {}),
  };
}

/** Blue ramp steps (1 = Yếu … 5 = Xuất sắc); 0 = no fill (no score / exempt). */
export function levelStep(level: LevelCode | DisplayLevel | null | undefined): 0 | 1 | 2 | 3 | 4 | 5 {
  switch (level) {
    case "excellent": return 5;
    case "proficient": return 4;
    case "good": return 3;
    case "basic": return 2;
    case "needs_work": return 1;
    default: return 0;
  }
}

/**
 * The level a skill is shown at. The engine's no_evidence ("Chưa có minh chứng") is split for the
 * student (user, 2026-10-21): "Chưa có điểm" when a related course was studied but has no score
 * (VT, a pass without a score…); "Sắp học" when a course of it is in progress or planned after the
 * term being studied; "Chưa học" when none is (late or not in the plan) — the engine's rule of the
 * career rows (comp-calc-v16, user 2026-10-25: the pages call a skill the same). Results stored before
 * v16 have no `upcoming` and keep "Sắp học". A not-applicable skill has none (outside the student's choices).
 */
export type DisplayLevel = Exclude<LevelCode, "no_evidence"> | "upcoming" | "not_studied" | "no_score";
export function displayLevel(skill: Pick<SkillResult, "level" | "status" | "evidenceCourses" | "upcoming">): DisplayLevel | null {
  if (skill.status === "not_applicable") return null;
  if (skill.level !== "no_evidence") return skill.level;
  if (skill.evidenceCourses.some((row) => row.role === "studied")) return "no_score";
  return skill.upcoming === false ? "not_studied" : "upcoming";
}

/** "Thang mức năng lực": the five levels only (user, 2026-10-22: Sắp học, Chưa có điểm and Miễn/công nhận left out). */
export const LEVEL_SCALE: readonly { code: ScoredLevel; label: string; range: string; text: string }[] = [
  { code: "excellent", label: LEVEL_LABELS.excellent, range: "từ 90", text: "Kết quả các học phần liên quan rất cao và ổn định." },
  { code: "proficient", label: LEVEL_LABELS.proficient, range: "80 đến dưới 90", text: "Kết quả các học phần liên quan tốt; nắm vững phần lớn nội dung." },
  { code: "good", label: LEVEL_LABELS.good, range: "62,5 đến dưới 80", text: "Nắm được phần lớn nội dung; có thể nâng lên bằng dự án thực tế." },
  { code: "basic", label: LEVEL_LABELS.basic, range: "50 đến dưới 62,5", text: "Đã có nền tảng, nên củng cố thêm để dùng tự tin hơn." },
  { code: "needs_work", label: LEVEL_LABELS.needs_work, range: "dưới 50", text: "Kết quả các học phần liên quan còn thấp; nên ôn lại hoặc học cải thiện." },
];
/** The skills without a score, shown beside the levels in the chart and the filter (not weaknesses). */
export const UNSCORED_STATES: readonly { code: "upcoming" | "not_studied" | "no_score" | "exempt"; label: string }[] = [
  { code: "upcoming", label: "Sắp học" },
  { code: "not_studied", label: "Chưa học" },
  { code: "no_score", label: "Chưa có điểm" },
  { code: "exempt", label: "Miễn/công nhận" },
];

/** A group's or the overall level label: with no evidence it reads "Chưa có điểm", like its "—" score. */
export const levelText = (level: LevelCode | DisplayLevel | null | undefined, label: string | null | undefined): string =>
  level === "no_evidence" || !label ? "Chưa có điểm" : label;

/** comp-calc-v12 (2026-10-23): the overall pools every skill like a group score; earlier results averaged the groups. */
export function overallIsPooled(calcVersion: string | null | undefined): boolean {
  const version = Number(/^comp-calc-v(\d+)$/.exec(calcVersion ?? "")?.[1]);
  return !Number.isFinite(version) || version >= 12;
}

/**
 * comp-calc-v18 (2026-11-03): the thesis group follows the cumulative GPA (Đồ án tốt nghiệp from 2,80, Chuyên đề tốt nghiệp
 * below it); earlier results suggested the thesis first.
 */
export function thesisByGpa(calcVersion: string | null | undefined): boolean {
  const version = Number(/^comp-calc-v(\d+)$/.exec(calcVersion ?? "")?.[1]);
  return !Number.isFinite(version) || version >= 18;
}

/**
 * comp-calc-v19 (user 2026-11-04): "Chậm so với kế hoạch" counts only the terms before the one being studied (its own courses not
 * registered are its plan), never the credits of GDTC/GDQP, and an elective group's shortfall is in credits ("còn thiếu 6 TC";
 * a result stored before read its course count as "còn thiếu 1 TC"). Earlier results ask for Đánh giá lại.
 */
export function lateBeforeStudyTerm(calcVersion: string | null | undefined): boolean {
  const version = Number(/^comp-calc-v(\d+)$/.exec(calcVersion ?? "")?.[1]);
  return !Number.isFinite(version) || version >= 19;
}

/** comp-calc-v13 (2026-10-24): the plan progress counts from the term being studied; earlier results from the latest graded term. */
export function countsFromStudyTerm(calcVersion: string | null | undefined): boolean {
  const version = Number(/^comp-calc-v(\d+)$/.exec(calcVersion ?? "")?.[1]);
  return !Number.isFinite(version) || version >= 13;
}

/**
 * "Học kỳ tới: n học phần": the engine's count of courses since comp-calc-v17; a result stored before counted entries ("3 courses +
 * Chọn 2 trong 4" read 4), so it is counted here the same way: a course or GDTC slot 1, a choice the courses still to choose, a
 * credit choice its credits over its largest option.
 */
export function nextCourseCount(progress: Pick<PlanProgressResult, "next" | "nextCount">, calcVersion: string | null | undefined): number {
  const version = Number(/^comp-calc-v(\d+)$/.exec(calcVersion ?? "")?.[1]);
  if (!Number.isFinite(version) || version >= 17) return progress.nextCount;
  return progress.next.reduce((sum, entry) => sum + (entry.kind !== "choice" ? 1 : entry.unit === "course" ? entry.remaining
    : Math.max(1, Math.ceil(entry.remaining / Math.max(1, ...entry.options.map((option) => option.credits ?? 0))))), 0);
}

/** One sentence that explains what the overall level means. */
export function levelSentence(level: LevelCode | null | undefined): string {
  return LEVEL_SCALE.find((item) => item.code === level)?.text ?? "Chưa đủ dữ liệu để xếp mức.";
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = { low: "Độ tin cậy thấp", medium: "Độ tin cậy trung bình", high: "Độ tin cậy cao" };

/* --------------------------------------------------------- career and gaps */

export type StatusTone = "pass" | "fail" | "unknown" | "neutral";
/** The value formatScore prints, as a number: rounded down to the tenth (84,66 → 84,6; 62,49 → 62,4), like scoreText. */
export const shownScore = (value: number): number => Math.floor(value * 10 + 1e-9) / 10;
const tenths = (value: number) => Math.round(value * 10) / 10;
/**
 * The shortfall as the page shows it (2026-10-25 audit): the threshold minus the score as shown, so the two add up — 43 is
 * "thiếu 19,5" against 62,5, 74,6 "thiếu 5,4" against 80. Without the score and threshold (an older caller) the deficit
 * rounded up to the tenth. Never 0: a score below the threshold always lacks something.
 */
function shortfall(deficit: number, shown?: { score?: number | null; threshold?: number | null }): number {
  if (typeof shown?.score === "number" && typeof shown.threshold === "number") return Math.max(0.1, tenths(shown.threshold - shownScore(shown.score)));
  return Math.max(0.1, Math.ceil(deficit * 10 - 1e-9) / 10);
}
/** A number of points with at most one decimal ("19,5", "6"). */
const formatPoints = (value: number) => oneDecimal.format(tenths(value));
/** "Dưới ngưỡng · thiếu 19,5 điểm"; pass the score and threshold so the shortfall adds up with the shown score (shortfall). */
export function deficitText(deficit: number | null, shown?: { score?: number | null; threshold?: number | null }): string {
  if (deficit === null) return "Dưới ngưỡng";
  return `Dưới ngưỡng · thiếu ${formatPoints(shortfall(deficit, shown))} điểm`;
}
/**
 * "Chênh lệch" column: the shown score minus the threshold, consistent with formatScore and deficitText (73 against 62,5 is
 * +10,5, 43 is −19,5; it read +11 and -19); null when there is nothing to compare. Never below 0 for a met skill.
 */
export function scoreDifference(req: Pick<CareerRequirementResult, "score" | "status" | "deficit" | "threshold">): number | null {
  if (req.score === null || req.status === "upcoming" || req.status === "no_data") return null;
  if (req.status === "below" && req.deficit !== null) return -shortfall(req.deficit, req);
  return Math.max(0, tenths(shownScore(req.score) - req.threshold));
}
/** A difference with its sign: "+10,5", "−19,5" (a real minus sign, like the history's changes), "0". */
export const formatDifference = (value: number) => (value > 0 ? `+${formatPoints(value)}` : value < 0 ? `−${formatPoints(-value)}` : "0");
/**
 * A career skill only courses of another specialty teach (user 2026-10-23), or only electives the student did not
 * choose (comp-calc-v14): "Cần tự học" on the page. It counts 0 in the fit score since v14.
 */
export const needsSelfStudy = (req: Pick<CareerRequirementResult, "status"> & { noDataReason?: CareerRequirementResult["noDataReason"] }) =>
  req.status === "no_data" && (req.noDataReason === "other_specialty" || req.noDataReason === "elective_not_chosen");

/**
 * The career's count line, rebuilt from the requirements so results stored before read the same (2026-10-25 audit, the
 * engine's careerSummaryOf since comp-calc-v17): "Đạt x/y kỹ năng", then only the counts that are not 0, in this order —
 * "Đạt 4/6 kỹ năng · 1 dưới ngưỡng · 2 chưa học · 1 sắp học · 1 cần tự học · 1 chưa đủ dữ liệu". It said
 * "· 0 sắp học · 0 chưa đủ dữ liệu" and left the skills below the threshold or not studied out. `summaryText` is not read.
 */
export function careerSummaryText(career: Partial<Pick<CareerResult, "summaryText">> & { requirements: readonly (Pick<CareerRequirementResult, "status"> & { noDataReason?: CareerRequirementResult["noDataReason"] })[] }): string {
  const count = (keep: (req: (typeof career.requirements)[number]) => boolean) => career.requirements.filter(keep).length;
  const parts: [number, string][] = [
    [count((req) => req.status === "below"), "dưới ngưỡng"],
    [count((req) => req.status === "not_studied"), "chưa học"],
    [count((req) => req.status === "upcoming"), "sắp học"],
    [count(needsSelfStudy), "cần tự học"],
    [count((req) => req.status === "no_data" && !needsSelfStudy(req)), "chưa đủ dữ liệu"],
  ];
  return [`Đạt ${count((req) => req.status === "met")}/${career.requirements.length} kỹ năng`,
    ...parts.filter(([value]) => value > 0).map(([value, label]) => `${value} ${label}`)].join(" · ");
}
/** "x/y kỹ năng có điểm" from the requirements (comp-calc-v17's dataText; a stored "x/y kỹ năng có dữ liệu" is not shown). */
export const careerDataText = (career: { requirements: readonly Pick<CareerRequirementResult, "score">[] }) =>
  `${career.requirements.filter((req) => req.score !== null).length}/${career.requirements.length} kỹ năng có điểm`;

/**
 * Glyph + text + colour of a career requirement. Green/red/amber only for met and gaps; never red for missing data.
 * A skill only another specialty's courses teach is "Cần tự học", not missing data. With its score and threshold, the
 * shortfall adds up with the shown score (deficitText); the term of "Sắp học" reads like termLabel (2026-10-25 audit).
 */
export function gapStatusDisplay(req: Pick<CareerRequirementResult, "status" | "deficit" | "upcomingTerm" | "exemptOnly">
  & { noDataReason?: CareerRequirementResult["noDataReason"]; score?: number | null; threshold?: number | null }): { tone: StatusTone; glyph: string; text: string } {
  switch (req.status) {
    case "met": return { tone: "pass", glyph: "✓", text: req.exemptOnly ? "Đạt ngưỡng · miễn/công nhận" : "Đạt ngưỡng" };
    case "below": return { tone: "fail", glyph: "✗", text: deficitText(req.deficit, req) };
    case "not_studied": return { tone: "unknown", glyph: "!", text: "Chưa học" };
    case "upcoming": return { tone: "neutral", glyph: "○", text: upcomingText(req.upcomingTerm) };
    default: return needsSelfStudy(req)
      ? { tone: "unknown", glyph: "!", text: "Cần tự học" }
      : { tone: "neutral", glyph: "?", text: "Chưa đủ dữ liệu" };
  }
}

const STATUS_ORDER: Record<CareerRequirementResult["status"], number> = { below: 0, not_studied: 1, upcoming: 2, no_data: 3, met: 4 };
/** Bắt buộc first, then the largest shortfall first (spec §11.4). */
export function sortRequirements<T extends Pick<CareerRequirementResult, "isRequired" | "status" | "deficit" | "title">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(b.isRequired) - Number(a.isRequired)
    || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || (b.deficit ?? 0) - (a.deficit ?? 0)
    || a.title.localeCompare(b.title, "vi"));
}
/**
 * "Kỹ năng còn thiếu": below the threshold, not studied, "Cần tự học" or "Chưa đủ dữ liệu" — the skills the student has to act
 * on. "Sắp học" comes with the plan and is not one of them (2026-10-25 audit: the toggle of the detailed report counted it,
 * the summary list did not; both use this rule and these words now).
 */
export const isGap = (req: Pick<CareerRequirementResult, "status">) => req.status === "below" || req.status === "not_studied" || req.status === "no_data";

/** "a", "a, b và c", or the first three and "và n kỹ năng khác". */
const nameList = (names: readonly string[]) => names.length > 3 ? `${names.slice(0, 3).join(", ")} và ${names.length - 3} kỹ năng khác` : joinWords(names);
/**
 * What "Kỹ năng còn thiếu" says when no skill is missing (isGap). It never says every skill is reached while skills without a
 * score count 0 in the fit (user 2026-10-30: "✓ Bạn đã đạt mọi kỹ năng" beside "51/100 · Ít phù hợp"): the "Sắp học" skills,
 * the only ones isGap leaves out, are named with what they do to the score. `zero` is null when every skill is reached.
 */
export function noGapText(career: Pick<CareerResult, "requirements">): { met: string; zero: string | null } {
  const ahead = sortRequirements(career.requirements).filter((req) => req.status === "upcoming").map((req) => req.skillName ?? req.title);
  if (!ahead.length) return { met: "Bạn đã đạt mọi kỹ năng của vị trí nghề nghiệp này.", zero: null };
  const level = fitLevelOf(career);
  const effect = level === "insufficient_data" ? "nên chưa đủ dữ liệu để xếp mức phù hợp"
    : `kéo điểm phù hợp xuống ${formatScore(fitScoreOf(career.requirements))}/100`;
  return {
    met: "Các kỹ năng đã có điểm đều đạt ngưỡng.",
    zero: `${nameList(ahead)} chưa có điểm (sắp học) nên đang tính 0, ${effect}; điểm sẽ tăng khi bạn học các học phần đó.`,
  };
}

/**
 * "Điểm phù hợp" 0–100 (comp-calc-v11, user 2026-10-22: "Sao lại 100% tròn nhỉ tại vì nó chỉ chấm 92
 * điểm và sửa lại thành đơn vị điểm"): the career's skills averaged like a score, Bắt buộc counted
 * twice; a met or below skill counts its score, a skill without a score 0 — not studied, "Cần tự học" or
 * "Chưa đủ dữ liệu" alike (comp-calc-v14, user 2026-10-24: "Tính đủ mọi kỹ năng") and "Sắp học" too (v15,
 * 2026-10-25: "sắp học là 0 luôn đi"); only exempt-only skills are left out. Read from the stored requirements,
 * so older results show it too.
 * Mirrors the API's fitScoreOf (constants.ts).
 */
export function fitScoreOf(requirements: readonly Pick<CareerRequirementResult, "status" | "score" | "coefficient">[]): number | null {
  let sum = 0, weight = 0;
  for (const req of requirements) {
    const value = req.status === "met" || req.status === "below" ? req.score : 0;
    if (value === null) continue;
    sum += req.coefficient * value;
    weight += req.coefficient;
  }
  return weight > 0 ? Math.floor((sum / weight) * 100 + 1e-9) / 100 : null;
}
/**
 * The fit level: the điểm phù hợp on the bounds of the competency levels (user, 2026-10-22: "Đồng bộ
 * cái mức phù hợp bên này thành tương tự của phần đánh giá năng lực"): Rất phù hợp ≥ 90, Phù hợp ≥ 80,
 * Trung bình ≥ 62,5, Ít phù hợp ≥ 50, Không phù hợp; "Chưa đủ dữ liệu" when the career has no skill the score
 * can count (v15). Same as the engine's fitCodeOf (FIT_MIN_DATA_SHARE); the share is
 * read from the requirements (fitDataShareOf), not the stored dataShare, so older results show the same level.
 */
export type FitLevel = "very_fit" | "fit" | "average" | "low_fit" | "not_fit" | "insufficient_data";
/** Share of the coefficients the fit score counts: everything but exempt-only skills (v15). Mirrors the API's fitDataShareOf. */
export function fitDataShareOf(requirements: readonly Pick<CareerRequirementResult, "status" | "score" | "coefficient">[]): number {
  let total = 0, counted = 0;
  for (const req of requirements) {
    total += req.coefficient;
    if (!(req.status === "met" && req.score === null)) counted += req.coefficient;
  }
  return total > 0 ? Math.round((counted / total) * 10000) / 10000 : 0;
}
export function fitLevelOf(career: Pick<CareerResult, "requirements">): FitLevel {
  const score = fitScoreOf(career.requirements);
  if (score === null || fitDataShareOf(career.requirements) + 1e-9 < 0.5) return "insufficient_data";
  const t = LEVEL_THRESHOLDS;
  const reaches = (bound: number) => score + 1e-9 >= bound;
  return reaches(t.excellent) ? "very_fit" : reaches(t.proficient) ? "fit" : reaches(t.good) ? "average" : reaches(t.basic) ? "low_fit" : "not_fit";
}

export const FIT_LABELS: Record<FitLevel, string> = {
  very_fit: "Rất phù hợp", fit: "Phù hợp", average: "Trung bình", low_fit: "Ít phù hợp", not_fit: "Không phù hợp", insufficient_data: "Chưa đủ dữ liệu",
};
/**
 * "Thang mức phù hợp" of the gap page: the five levels only, like "Thang mức năng lực" (2026-10-22;
 * "Chưa đủ dữ liệu" is no level and is explained under the scale when it is the student's). Each text names the score band
 * on the competency levels, never the skills' statuses (2026-10-25 audit: a career whose 4 skills were all met read "một
 * số kỹ năng còn dưới ngưỡng hoặc chưa học").
 */
export const FIT_SCALE: readonly { code: Exclude<FitLevel, "insufficient_data">; label: string; range: string; text: string }[] = [
  { code: "very_fit", label: FIT_LABELS.very_fit, range: "từ 90", text: "Điểm trung bình các kỹ năng của vị trí nghề nghiệp ở mức Xuất sắc (từ 90)." },
  { code: "fit", label: FIT_LABELS.fit, range: "80 đến dưới 90", text: "Điểm trung bình các kỹ năng của vị trí nghề nghiệp ở mức Giỏi (80 đến dưới 90)." },
  { code: "average", label: FIT_LABELS.average, range: "62,5 đến dưới 80", text: "Điểm trung bình các kỹ năng của vị trí nghề nghiệp ở mức Khá (62,5 đến dưới 80)." },
  { code: "low_fit", label: FIT_LABELS.low_fit, range: "50 đến dưới 62,5", text: "Điểm trung bình các kỹ năng của vị trí nghề nghiệp ở mức Trung bình (50 đến dưới 62,5)." },
  { code: "not_fit", label: FIT_LABELS.not_fit, range: "dưới 50", text: "Điểm trung bình các kỹ năng của vị trí nghề nghiệp ở mức Yếu (dưới 50)." },
];
export const fitLabelOf = (career: Pick<CareerResult, "requirements">) => FIT_LABELS[fitLevelOf(career)];
/** Ramp step of a fit level, like levelStep (5 = Rất phù hợp … 1 = Không phù hợp; 0 = Chưa đủ dữ liệu). */
export function fitStep(level: FitLevel): 0 | 1 | 2 | 3 | 4 | 5 {
  return level === "insufficient_data" ? 0 : (5 - FIT_SCALE.findIndex((item) => item.code === level)) as 1 | 2 | 3 | 4 | 5;
}

/**
 * The colour of a level or fit badge (user 2026-10-30: "Ít phù hợp" was green, "Trung bình" green on one page and blue on
 * another): one colour per word everywhere (display-format meaningOf), so Trung bình is amber as a level and as a fit. A badge
 * without a score (Sắp học, Chưa học, Chưa có điểm, miễn/công nhận, Chưa đủ dữ liệu) has none.
 */
export function levelMeaning(level: LevelCode | DisplayLevel | null | undefined): Meaning {
  return level && level in LEVEL_LABELS ? meaningOf(LEVEL_LABELS[level as ScoredLevel]) : "none";
}
export const fitMeaning = (level: FitLevel): Meaning => (level === "insufficient_data" ? "none" : meaningOf(FIT_LABELS[level]));

export function eligibilityDisplay(eligibility: Eligibility, missing: { code: string; name: string | null }[]): { tone: StatusTone; glyph: string; text: string } {
  if (eligibility === "eligible") return { tone: "pass", glyph: "✓", text: "Đủ điều kiện đăng ký" };
  if (eligibility === "not_eligible") return { tone: "unknown", glyph: "⚠", text: missing.length ? `Cần học trước ${missing.map((m) => m.name ? `${m.name} (${m.code})` : m.code).join(", ")}` : "Chưa đủ điều kiện" };
  return { tone: "neutral", glyph: "?", text: "Cần xác nhận điều kiện với Khoa" };
}

export const COURSE_STATE_LABELS: Record<CourseState, string> = {
  passed: "Đạt", failed: "Không đạt", exempt: "Miễn/công nhận", graded_unknown: "Có điểm, chưa rõ kết quả",
  in_progress: "Đang học", not_taken: "Chưa học", not_in_curriculum: "Ngoài CTĐT",
};

/**
 * Where the student stands with a suggested course, in words: whether it was taken, its score and
 * what that means ("Đã học, đạt · điểm 6,5 (C+)", "Đã học, chưa đạt · điểm 3 (F) — cần học lại", "Chưa học").
 */
export function courseStanding(course: Pick<SupportCourse, "state" | "score10" | "letter">): { tone: StatusTone; text: string } {
  const score = course.score10 !== null ? ` · điểm ${formatNumber(course.score10)}${course.letter ? ` (${course.letter})` : ""}` : course.letter ? ` · ${course.letter}` : "";
  switch (course.state) {
    case "passed": return { tone: "pass", text: `Đã học, đạt${score}` };
    case "failed": return { tone: "fail", text: `Đã học, chưa đạt${score} — cần học lại` };
    case "exempt": return { tone: "pass", text: "Miễn/công nhận" };
    case "in_progress": return { tone: "neutral", text: "Đang học" };
    case "graded_unknown": return { tone: "unknown", text: `Chưa rõ kết quả${score}` };
    default: return { tone: "neutral", text: "Chưa học" };
  }
}

/**
 * The courses a skill's score comes from (user 2026-10-30: "Nhiều kỹ năng cùng đúng 68 điểm … Nên ghi môn làm minh chứng cạnh
 * từng điểm"): the scored evidence courses, largest share first, each as "Name (6,8 · C+)" with the grade printed on the
 * transcript; at most `max`, and how many more there are.
 */
export function scoreSources(skill: Pick<SkillResult, "evidenceCourses">, courses: ReadonlyMap<string, Pick<AssessmentResult["courses"][number], "name" | "score10" | "letter">>, max = 2): { names: string[]; more: number } {
  const rows = skill.evidenceCourses.filter((row) => row.role === "score")
    .sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || b.contribution - a.contribution || a.code.localeCompare(b.code));
  const names = rows.slice(0, max).map((row) => gradedCourseText(courses.get(row.code) ?? { name: row.code, score10: null, letter: null }));
  return { names, more: Math.max(0, rows.length - max) };
}
/** "Lập trình web (6,8 · C+)": a course with the grade printed on the transcript (hệ 10, then the letter). */
export function gradedCourseText(course: { name: string; score10: number | null; letter: string | null }): string {
  const grade = course.score10 !== null ? `${formatNumber(course.score10)}${course.letter ? ` · ${course.letter}` : ""}` : course.letter;
  return `${course.name}${grade ? ` (${grade})` : ""}`;
}
/** "Từ Lập trình web (6,8 · C+), Cơ sở dữ liệu (7,5 · B) và 1 học phần khác"; "" without a scored course. */
export const scoreSourcesText = (sources: { names: string[]; more: number }) =>
  !sources.names.length ? "" : `Từ ${sources.more ? `${sources.names.join(", ")} và ${sources.more} học phần khác` : joinWords(sources.names)}`;

/**
 * The course plans that fit the result: with a target career, only its met skills below Giỏi (Thành thạo before comp-calc-v10)
 * ("deepen", comp-calc-v7); without one, the skills below Khá ("strengthen"; v6 plans have no purpose
 * and are of that kind). Weak skills outside the chosen career are never advised on.
 */
export function plansFor(result: Pick<AssessmentResult, "career" | "skillPlans">): SkillPlan[] {
  const purpose = result.career ? "deepen" : "strengthen";
  return (result.skillPlans ?? []).filter((plan) => (plan.purpose ?? "strengthen") === purpose);
}

/** Career requirement skills by key: the AI's improvements about them belong on the gap page too. */
export const careerSkillKeys = (result: Pick<AiCommentContext, "career">): Set<string> =>
  new Set((result.career?.requirements ?? []).map((req) => req.skillKey).filter((key): key is string => Boolean(key)));

/* ------------------------------------------------- history (STU-COMP-07) */

type HistoryRow = HistoryPoint & {
  /** Change of the overall score from the previous term with a score, as the page shows the scores (tenths, rounded down). */
  change: number | null;
  /** The newest term: the result shown everywhere else on the page. */
  latest: boolean;
};
type HistoryYear = { schoolYear: string; rows: HistoryRow[]; end: HistoryRow };

const shown = (score: number | null) => score === null ? null : shownScore(score);

/** The history grouped by school year, oldest first, each term with its change from the term before. */
export function historyYears(history: readonly HistoryPoint[]): HistoryYear[] {
  const years: HistoryYear[] = [];
  let previous: number | null = null;
  history.forEach((point, index) => {
    const score = shown(point.overall.score);
    const row: HistoryRow = { ...point, change: score !== null && previous !== null ? tenths(score - previous) : null, latest: index === history.length - 1 };
    if (score !== null) previous = score;
    const year = years.at(-1);
    if (year && year.schoolYear === point.schoolYear) { year.rows.push(row); year.end = row; }
    else years.push({ schoolYear: point.schoolYear, rows: [row], end: row });
  });
  return years;
}

/** "HK1 2023–2024", like every other term on the page (termName). */
export const historyTermName = (point: Pick<HistoryPoint, "term" | "semester" | "schoolYear">) =>
  /^HK\d{3}$/.test(point.term) ? termName(point.term) : `HK${point.semester} ${point.schoolYear}`;
const termInWords = historyTermName;

/** One sentence on the overall trend from the first term with a score to the newest one; null with fewer than two. */
export function historySentence(history: readonly HistoryPoint[]): string | null {
  const scored = history.filter((point) => point.overall.score !== null);
  if (scored.length < 2) return null;
  const first = scored[0]!, last = scored.at(-1)!;
  const from = shown(first.overall.score)!, to = shown(last.overall.score)!;
  const best = scored.reduce((top, point) => shown(point.overall.score)! > shown(top.overall.score)! ? point : top, first);
  const trend = to > from ? `tăng từ ${scoreText(from)} (${termInWords(first)}) lên ${scoreText(to)} (${termInWords(last)})`
    : to < from ? `giảm từ ${scoreText(from)} (${termInWords(first)}) xuống ${scoreText(to)} (${termInWords(last)})`
      : `giữ ở mức ${scoreText(to)} từ ${termInWords(first)} đến ${termInWords(last)}`;
  const peak = best !== first && best !== last && shown(best.overall.score)! > Math.max(from, to) ? ` Cao nhất là ${scoreText(shown(best.overall.score)!)} vào ${termInWords(best)}.` : "";
  return `Điểm năng lực tổng ${trend}.${peak}`;
}

/* ------------------------------------------------- STU-GAP-07: career skills by term */

type GapHistoryRow = {
  requirementId: string; name: string; priorityLabel: string; isRequired: boolean; threshold: number;
  /** One cell per point: the score as the page shows it (tenths, rounded down) and the status of that term. */
  cells: { term: string; score: number | null; status: CareerRequirementResult["status"] | null }[];
  /** Latest scored cell − first scored cell; null with fewer than two scored cells. */
  change: number | null;
};
type GapHistory =
  | { state: "empty" }
  | { state: "outdated" }
  | { state: "ready"; points: HistoryPoint[]; rows: GapHistoryRow[]; sentence: string };

/**
 * "Theo dõi mức độ cải thiện kỹ năng": every career skill at the end of each graded term. Null without a
 * career; "outdated" for results computed before comp-calc-v9 (no career in the history).
 */
export function gapHistory(result: Pick<AssessmentResult, "career" | "history">): GapHistory | null {
  const career = result.career;
  if (!career) return null;
  if (!result.history?.length) return { state: "empty" };
  const points = result.history.filter((point) => point.career);
  if (points.length !== result.history.length) return { state: "outdated" };
  const rows = sortRequirements(career.requirements).map((req): GapHistoryRow => {
    const cells = points.map((point) => {
      const cell = point.career!.requirements.find((item) => item.requirementId === req.requirementId);
      return { term: point.term, score: shown(cell?.score ?? null), status: cell?.status ?? null };
    });
    const scored = cells.filter((cell) => cell.score !== null);
    return {
      requirementId: req.requirementId, name: req.skillName ?? req.title, priorityLabel: req.priorityLabel, isRequired: req.isRequired, threshold: req.threshold,
      cells, change: scored.length >= 2 ? tenths(scored.at(-1)!.score! - scored[0]!.score!) : null,
    };
  });
  const first = points[0]!, last = points.at(-1)!;
  const from = first.career!.met, to = last.career!.met, total = last.career!.total;
  const best = rows.reduce<GapHistoryRow | null>((top, row) => row.change !== null && row.change > 0 && (!top || row.change > top.change!) ? row : top, null);
  const sentence = points.length < 2
    ? `Mới có ${termInWords(last)} có điểm nên chưa so sánh được; ${to}/${total} kỹ năng của vị trí nghề nghiệp đạt ngưỡng.`
    : `Từ ${termInWords(first)} đến ${termInWords(last)}, số kỹ năng của vị trí nghề nghiệp đạt ngưỡng ${to > from ? `tăng từ ${from} lên ${to}` : to < from ? `giảm từ ${from} xuống ${to}` : `giữ ở ${to}`}/${total}.`
      + (best ? ` Tăng nhiều nhất: ${best.name} (${formatDifference(best.change!)} điểm).` : "");
  return { state: "ready", points, rows, sentence };
}

/* ---------------------------------------------------- proficiency summary */

/**
 * The level columns of the proficiency table, best first; "Sắp học", "Chưa học", "Chưa có điểm" and "Miễn/công nhận" last
 * (not weaknesses). The same segments as the chart (CHART_LEVELS): the exempt column was missing from the table (2026-10-25).
 */
export const LEVEL_COLUMNS = ["excellent", "proficient", "good", "basic", "needs_work", "upcoming", "not_studied", "no_score", "exempt"] as const satisfies readonly DisplayLevel[];
type LevelRow = {
  key: string; name: string; score: number | null; level: LevelCode; levelLabel: string;
  /** Skills of the group counted like the group line: condition-only and not-applicable skills left out. */
  total: number;
  counts: Record<(typeof LEVEL_COLUMNS)[number], number>;
};
/** One row per skill group: how many of its skills sit at each proficiency level. */
/** Every group a skill counts in (2026-10-22: one or more); a result stored before has only groupKey. */
export const skillGroupKeys = (skill: Pick<SkillResult, "groupKey" | "groupKeys">): string[] => skill.groupKeys?.length ? skill.groupKeys : [skill.groupKey];
/** A skill counted in a group like the group line: condition-only and not-applicable skills are left out. */
const countedInGroup = (skill: SkillResult, groupKey: string) => skillGroupKeys(skill).includes(groupKey) && !skill.conditionOnly && skill.status !== "not_applicable";

export function levelSummary(result: Pick<AssessmentResult, "groups" | "skills">): LevelRow[] {
  return result.groups.map((group) => {
    const skills = result.skills.filter((skill) => countedInGroup(skill, group.key));
    const counts = Object.fromEntries(LEVEL_COLUMNS.map((level) => [level, skills.filter((skill) => displayLevel(skill) === level).length])) as LevelRow["counts"];
    return { key: group.key, name: group.name, score: group.score, level: group.level, levelLabel: group.levelLabel, total: skills.length, counts };
  });
}

/**
 * "Ngưỡng đạt: …" of the gap page, read from the stored thresholds: a result computed before
 * comp-calc-v10 still says Ưu tiên 70 and Bắt buộc 85 (no level starts there) until the student runs it again.
 */
export function careerThresholdsLine(career: Pick<CareerResult, "requirements">): string {
  // A career with one kind of requirement: the other threshold of the same version (v10: 62,5/80; before: 70/85).
  const pairs = [{ preferred: LEVEL_THRESHOLDS.good, required: LEVEL_THRESHOLDS.proficient }, { preferred: 70, required: 85 }];
  const stored = (required: boolean) => career.requirements.find((req) => req.isRequired === required)?.threshold;
  const pair = pairs.find((item) => item.preferred === stored(false) || item.required === stored(true)) ?? pairs[0]!;
  const of = (required: boolean, fallback: number) => stored(required) ?? fallback;
  const named = (value: number) => {
    const level = LEVEL_SCALE.find((item) => item.code !== "needs_work" && LEVEL_THRESHOLDS[item.code] === value);
    return level ? ` (mức ${level.label})` : "";
  };
  const preferred = of(false, pair.preferred), required = of(true, pair.required);
  return `Ngưỡng đạt: kỹ năng Ưu tiên từ ${formatScore(preferred)}${named(preferred)}, kỹ năng Bắt buộc từ ${formatScore(required)}${named(required)}.`;
}

/* ------------------------------------------------- level chart ("Bảng phân tích mức độ thành thạo") */

/** Segment order of each group's bar: the five levels from the top down, then "Sắp học", "Chưa học", "Chưa có điểm" and exempt (no score). */
export const CHART_LEVELS = LEVEL_COLUMNS;
export type ChartLevel = (typeof CHART_LEVELS)[number];
/** The name of a level or of an unscored state in the chart and its legend. */
export const chartLevelLabel = (level: ChartLevel): string => [...LEVEL_SCALE, ...UNSCORED_STATES].find((item) => item.code === level)?.label ?? level;
export type LevelSegment = {
  level: ChartLevel; label: string; count: number;
  /** Part of the group's skills. */
  share: number;
  /** Where the segment starts and ends, as fractions of the axis. */
  start: number; end: number;
  /** Highest score first. */
  skills: SkillResult[];
};
export type LevelBar = { key: string; name: string; score: number | null; level: LevelCode; levelLabel: string; total: number; segments: LevelSegment[] };

/** A count axis from 0 in steps of 1, 2 or 5 × 10ⁿ, at most five steps, ending on the first tick at or past the largest value. */
export function countAxis(largest: number): { max: number; ticks: number[] } {
  const top = Math.max(1, Math.ceil(largest));
  let step = 1;
  for (let magnitude = 1; ; magnitude *= 10) {
    const found = [1, 2, 5].map((base) => base * magnitude).find((candidate) => Math.ceil(top / candidate) <= 5);
    if (found) { step = found; break; }
  }
  const max = Math.ceil(top / step) * step;
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, index) => index * step) };
}

/** One stacked bar per group: its skills (counted like the group line) split by level on one shared count axis. */
export function levelChart(result: Pick<AssessmentResult, "groups" | "skills">): { axis: { max: number; ticks: number[] }; bars: LevelBar[] } {
  const rows = result.groups.map((group) => ({ group, skills: result.skills.filter((skill) => countedInGroup(skill, group.key)) }));
  const axis = countAxis(Math.max(0, ...rows.map((row) => row.skills.length)));
  const bars = rows.map(({ group, skills }) => {
    let offset = 0;
    const segments = CHART_LEVELS.flatMap((level): LevelSegment[] => {
      const members = skills.filter((skill) => displayLevel(skill) === level)
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, "vi"));
      if (!members.length) return [];
      const start = offset / axis.max;
      offset += members.length;
      return [{ level, label: chartLevelLabel(level), count: members.length, share: members.length / skills.length, start, end: offset / axis.max, skills: members }];
    });
    return { key: group.key, name: group.name, score: group.score, level: group.level, levelLabel: group.levelLabel, total: skills.length, segments };
  });
  return { axis, bars };
}

/** AI priority tags; worded apart from the career property "Ưu tiên" (preferred). The stored enum stays high/medium/low. */
export const PRIORITY_LABELS: Record<AiPriority, string> = { high: "Cần làm sớm", medium: "Nên làm", low: "Có thể để sau" };

/* ----------------------------------------------------------------- skills */

export type SkillFilters = { group: string; level: string; confidence: string; careerOnly: boolean; needsWork: boolean; search: string };
export const EMPTY_SKILL_FILTERS: SkillFilters = { group: "", level: "", confidence: "", careerOnly: false, needsWork: false, search: "" };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();

/** "Cần cải thiện" = scored below Khá. */
const skillNeedsWork = (skill: Pick<SkillResult, "level">) => skill.level === "basic" || skill.level === "needs_work";

export function filterSkills(skills: readonly SkillResult[], filters: SkillFilters): SkillResult[] {
  const query = fold(filters.search);
  return skills.filter((skill) => (!filters.group || skillGroupKeys(skill).includes(filters.group))
    && (!filters.level || displayLevel(skill) === filters.level)
    && (!filters.confidence || skill.confidence === filters.confidence)
    && (!filters.careerOnly || skill.careerSkill)
    && (!filters.needsWork || skillNeedsWork(skill))
    && (!query || fold(`${skill.name} ${skill.scope} ${skill.evidenceCourses.map((row) => row.code).join(" ")}`).includes(query)));
}

/**
 * "x/y kỹ năng có minh chứng" of one group, with the same rule as overall.basis: condition-only
 * and not-applicable skills are left out. Derived from the skills so results stored before
 * comp-calc-v3 (whose group skillCount still included not-applicable skills) read the same.
 */
export function groupEvidenceCounts(skills: readonly Pick<SkillResult, "groupKey" | "groupKeys" | "conditionOnly" | "status">[], groupKey: string): { withEvidence: number; total: number } {
  const counted = skills.filter((skill) => skillGroupKeys(skill).includes(groupKey) && !skill.conditionOnly && skill.status !== "not_applicable");
  return { withEvidence: counted.filter((skill) => skill.status === "scored" || skill.status === "exempt_only").length, total: counted.length };
}

type SkillBucket = { id: string; title: string; note: string | null; skills: SkillResult[] };
/** "Chưa học" in the student's words; "Kết quả này cho biết gì?" on the page says the same of "kỹ năng đó". */
const NOT_STUDIED_NOTE = "Học phần đo kỹ năng này đã qua học kỳ trong kế hoạch mà bạn chưa học, hoặc không có trong kế hoạch; hãy đăng ký ở học kỳ tới.";
/**
 * A skill whose only courses carry no credit (not applicable, "no_credits"): before comp-calc-v17 the 0-credit GDTC/GDQP
 * courses of K27/K28, passed or not. It belongs with the condition-only skills, never "Ngoài lựa chọn học phần của bạn".
 */
export const noCreditSkill = (skill: Pick<SkillResult, "status" | "notApplicableReason">) => skill.status === "not_applicable" && skill.notApplicableReason === "no_credits";
/**
 * Groups for the skill list: one per engine group (scored or exempt skills),
 * then condition-only skills (and those of courses without credits), skills outside the student's choices and, last,
 * "Sắp học" and "Chưa có điểm" (ids = their display levels) — never presented as weaknesses.
 * A skill in several groups is listed under each of them, or only under `group` when the list is
 * filtered to one group.
 */
export function bucketSkills(result: Pick<AssessmentResult, "groups">, skills: readonly SkillResult[], group = ""): SkillBucket[] {
  const buckets: SkillBucket[] = result.groups.map((group) => ({ id: group.key, title: group.name, note: null, skills: [] }));
  const condition: SkillBucket = { id: "condition", title: "Môn điều kiện (GDTC/GDQP)", note: "Không tính vào điểm nhóm và điểm tổng.", skills: [] };
  const notApplicable: SkillBucket = { id: "not-applicable", title: "Ngoài lựa chọn học phần của bạn", note: "Chỉ có trong học phần của chuyên ngành khác hoặc học phần tự chọn bạn không chọn.", skills: [] };
  const upcoming: SkillBucket = { id: "upcoming", title: "Sắp học", note: "Không phải điểm yếu — bạn đang học hoặc sẽ học học phần đo kỹ năng này ở học kỳ sau theo kế hoạch (kể cả môn tự chọn chưa chọn).", skills: [] };
  const notStudied: SkillBucket = { id: "not_studied", title: "Chưa học", note: NOT_STUDIED_NOTE, skills: [] };
  const noScore: SkillBucket = { id: "no_score", title: "Chưa có điểm", note: "Bạn đã học học phần liên quan nhưng bảng điểm chưa có điểm số, nên chưa đánh giá được.", skills: [] };
  for (const skill of skills) {
    const level = displayLevel(skill);
    if (noCreditSkill(skill)) condition.skills.push(skill);
    else if (skill.status === "not_applicable") notApplicable.skills.push(skill);
    else if (level === "upcoming") upcoming.skills.push(skill);
    else if (level === "not_studied") notStudied.skills.push(skill);
    else if (level === "no_score") noScore.skills.push(skill);
    else if (skill.conditionOnly) condition.skills.push(skill);
    else {
      const homes = buckets.filter((bucket) => skillGroupKeys(skill).includes(bucket.id) && (!group || bucket.id === group));
      for (const bucket of homes.length ? homes : [upcoming]) bucket.skills.push(skill);
    }
  }
  return [...buckets, condition, notApplicable, upcoming, notStudied, noScore].filter((bucket) => bucket.skills.length > 0);
}

/* --------------------------------------------------------------------- AI */

/** Only these statuses change on their own, so only they are polled. */
export const shouldPoll = (status: AiStatus | null | undefined) => status === "queued" || status === "processing";

/** POST /:id/ai is offered for these states (disabled only once AI is switched on). */
export function canRegenerate(status: AiStatus, aiEnabled: boolean): boolean {
  return status === "failed" || status === "cancelled" || status === "deferred" || (status === "disabled" && aiEnabled);
}

export function aiStateCopy(status: AiStatus, workerOnline: boolean, aiEnabled: boolean): { title: string; text: string } {
  switch (status) {
    case "disabled": return aiEnabled
      ? { title: "Chưa có nhận xét cho lần đánh giá này", text: "Nhận xét AI vừa được bật. Bạn có thể tạo nhận xét cho kết quả hiện tại." }
      : { title: "Nhận xét AI chưa được bật", text: "Kết quả bên dưới do hệ thống tính và đã đầy đủ. Khi nhận xét AI được bật, bạn có thể nhận thêm lời nhận xét." };
    case "deferred": return { title: "Hàng đợi AI đang đầy", text: "Kết quả tính toán đã sẵn sàng. Sau ít phút, bấm “Tạo lại nhận xét” để xếp hàng lại." };
    case "queued": return workerOnline
      ? { title: "Đang xếp hàng tạo nhận xét", text: "AI suy luận trước khi viết nên nhận xét thường mất 1–3 phút. Bạn có thể xem kết quả bên dưới trong lúc chờ." }
      : { title: "Đang chờ máy AI kết nối", text: "Yêu cầu đã được giữ trong hàng đợi và sẽ được xử lý khi máy AI kết nối lại." };
    case "processing": return { title: "EduPath AI đang suy luận và viết nhận xét", text: "Mô hình suy luận từ kết quả đã tính rồi mới viết nhận xét, thường mất 1–3 phút. Bạn có thể rời trang và quay lại sau." };
    case "failed": return { title: "Chưa tạo được nhận xét", text: "Kết quả tính toán không bị ảnh hưởng." };
    case "cancelled": return { title: "Đã hủy tạo nhận xét", text: "Bạn có thể tạo lại nhận xét bất cứ lúc nào." };
    default: return { title: "Nhận xét từ EduPath AI", text: "" };
  }
}

/**
 * "Điểm mạnh": the result's strengths with at least medium confidence (user, 2026-10-21). One course
 * with a small weight can score high (MLOps 94 from a single 15% link); results stored before the
 * engine applied the same rule are filtered here, so they show it without a new assessment.
 */
export function confidentStrengths(result: Pick<AssessmentResult, "highlights" | "skills">): string[] {
  const confident = new Set(result.skills.filter((skill) => skill.confidence === "medium" || skill.confidence === "high").map((skill) => skill.key));
  return result.highlights.strengths.filter((key) => confident.has(key));
}
/**
 * "Cần củng cố": the result's improvements still below Khá on the current scale. A result stored
 * before comp-calc-v10 listed skills below 70; one at 64 is Khá now (62,5) and is no longer shown.
 */
export function currentImprovements(result: Pick<AssessmentResult, "highlights" | "skills">): string[] {
  const below = new Set(result.skills.filter((skill) => skill.score !== null && skill.score < LEVEL_THRESHOLDS.good).map((skill) => skill.key));
  return result.highlights.improvements.filter((key) => below.has(key));
}

/** Comments written with Gemma's thinking mode: prompt comp-v7 and later. */
export function aiReasoned(promptVersion: string | null | undefined): boolean {
  const match = /^comp-v(\d+)$/.exec(promptVersion ?? "");
  return Boolean(match && Number(match[1]) >= 7);
}

/** "gemma4:e4b" → "Gemma 4 E4B", "@cf/google/gemma-4-26b-a4b-it" → "Gemma 4 26B" (ai-model.ts). */
export { modelLabel, modelPlace } from "./ai-model";

export type MappedAiOutput = {
  summary: string;
  groupInsights: { key: string; name: string; comment: string }[];
  strengths: { key: string; name: string; comment: string }[];
  improvements: { key: string; name: string; priority: AiPriority; comment: string; courses: { code: string; name: string; reason: string }[] }[];
  careerFit: string;
  gaps: { key: string; name: string; priority: AiPriority; explanation: string; courses: { code: string; name: string; reason: string }[]; selfStudy: string[] }[];
  progress: string;
  nextSteps: string[];
};

const plain = (value: unknown) => typeof value === "string" ? value.trim() : "";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEY_PATTERN = /(?<![\p{L}\p{N}])[SG]\d{1,3}(?![\p{L}\p{N}])/gu;
const KEY_SEP = "(?:\\s*[-–—:,/]\\s*|\\s+)";
const KEY_OPEN = "[(\\[]";
const KEY_CLOSE = "[)\\]]";
/**
 * Removes internal keys (S01…, G1…) from AI prose. Same rules as the server cleanup
 * (apps/api/src/competency-assessment/ai/key-cleanup.ts), kept here as a safety net for
 * outputs stored before comp-v3: a key next to its own name is dropped with its separator
 * ("API (S12)" → "API", "(API - S12)" → "(API)", "S12 - API" → "API"), a bracketed key
 * elsewhere is dropped and a bare key elsewhere becomes the name.
 */
export function cleanKeyText(text: string, names: ReadonlyMap<string, string>): string {
  let out = text;
  const keys = [...new Set(out.match(KEY_PATTERN) ?? [])].filter((key) => names.has(key));
  if (!keys.length) return text;
  for (const key of keys) {
    const name = names.get(key)!.trim();
    const k = `(?<![\\p{L}\\p{N}])${key}(?![\\p{L}\\p{N}])`;
    if (name) {
      const n = `((?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}]))`;
      const rules = [
        `${n}\\s*${KEY_OPEN}\\s*${k}\\s*${KEY_CLOSE}`,
        `${n}${KEY_SEP}${k}`,
        `${KEY_OPEN}\\s*${k}\\s*${KEY_CLOSE}\\s*${n}`,
        `${k}\\s*${KEY_OPEN}\\s*${n}\\s*${KEY_CLOSE}`,
        `${k}${KEY_SEP}${n}`,
      ];
      for (const rule of rules) out = out.replace(new RegExp(rule, "giu"), "$1");
    }
    out = out.replace(new RegExp(`\\s*${KEY_OPEN}\\s*${k}\\s*${KEY_CLOSE}`, "gu"), "");
    if (name) out = out.replace(new RegExp(k, "gu"), name);
  }
  return out.replace(/ {2,}/g, " ").replace(/\s+([.,;:!?)])/g, "$1").trim();
}
const list = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const priority = (value: unknown): AiPriority => value === "high" || value === "low" ? value : "medium";

/**
 * Maps the model's keys to real names and drops whatever cannot be mapped:
 * unknown skill or group keys, and courses that are not candidates of the
 * engine (the server validates too; this keeps the page safe on its own).
 * `result` is the context of the assessment the comment was written for (keys are per assessment).
 */
export function mapAiOutput(output: AiOutput | null | undefined, result: AiCommentContext): MappedAiOutput | null {
  if (!output || typeof output !== "object") return null;
  const skills = new Map(result.skillDirectory.map((skill) => [skill.key, skill.name]));
  const groups = new Map(result.groups.map((group) => [group.key, group.name]));
  // The model sometimes writes internal keys in prose ("Kiểm thử (S03)", "(API - S12)", "kỹ năng S03").
  const names = new Map<string, string>([...skills, ...groups]);
  const text = (value: unknown) => cleanKeyText(plain(value), names);
  // A skill below a career threshold (or not studied) is never shown as a strength.
  const careerGap = new Set((result.career?.requirements ?? []).filter((req) => req.skillKey && (req.status === "below" || req.status === "not_studied")).map((req) => req.skillKey!));
  const weak = new Set([...list<{ skillKey?: unknown }>(output.improvements), ...list<{ skillKey?: unknown }>(output.gaps)].map((item) => item?.skillKey));
  const courses = new Map(result.courses.map((course) => [course.code, course.name]));
  for (const course of result.courseSuggestions) courses.set(course.code, course.name);
  const courseList = (value: unknown) => list<{ courseCode: string; reason: string }>(value).filter((course) => courses.has(course?.courseCode))
    .map((course) => ({ code: course.courseCode, name: courses.get(course.courseCode)!, reason: text(course.reason) }));
  const mapped: MappedAiOutput = {
    summary: text(output.summary),
    groupInsights: list<AiOutput["groupInsights"][number]>(output.groupInsights)
      .filter((item) => groups.has(item?.groupKey) && text(item.comment))
      .map((item) => ({ key: item.groupKey, name: groups.get(item.groupKey)!, comment: text(item.comment) })),
    strengths: list<AiOutput["strengths"][number]>(output.strengths)
      .filter((item) => skills.has(item?.skillKey) && text(item.comment) && !weak.has(item.skillKey) && !careerGap.has(item.skillKey))
      .map((item) => ({ key: item.skillKey, name: skills.get(item.skillKey)!, comment: text(item.comment) })),
    improvements: list<AiOutput["improvements"][number]>(output.improvements)
      .filter((item) => skills.has(item?.skillKey) && text(item.comment))
      .map((item) => ({ key: item.skillKey, name: skills.get(item.skillKey)!, priority: priority(item.priority), comment: text(item.comment), courses: courseList(item.courses) })),
    careerFit: text(output.careerFit?.comment),
    gaps: list<AiOutput["gaps"][number]>(output.gaps)
      .filter((item) => skills.has(item?.skillKey))
      .map((item) => ({
        key: item.skillKey, name: skills.get(item.skillKey)!, priority: priority(item.priority), explanation: text(item.explanation),
        courses: courseList(item.courses),
        selfStudy: list<unknown>(item.selfStudy).map(text).filter(Boolean),
      }))
      .filter((item) => item.explanation || item.courses.length || item.selfStudy.length),
    progress: text(output.progress),
    nextSteps: list<unknown>(output.nextSteps).map(text).filter(Boolean),
  };
  return mapped;
}

/** The AI's advice on the target career's own skills that are not among its gaps ("Nâng kỹ năng của vị trí nghề nghiệp"). */
export function careerRaise(output: MappedAiOutput, careerKeys: ReadonlySet<string>): MappedAiOutput["improvements"] {
  const gapKeys = new Set(output.gaps.map((gap) => gap.key));
  return output.improvements.filter((item) => careerKeys.has(item.key) && !gapKeys.has(item.key));
}
/** The comment has something for #skill-gap: fit with the career, its gaps or the career's skills to raise. */
export const hasGapContent = (output: MappedAiOutput, careerKeys: ReadonlySet<string>): boolean =>
  Boolean(output.careerFit || output.gaps.length || careerRaise(output, careerKeys).length);
/** The comment has something for #competency. */
export const hasCompetencyContent = (output: MappedAiOutput): boolean =>
  Boolean(output.summary || output.groupInsights.length || output.strengths.length || output.improvements.length || output.progress || output.nextSteps.length);

/** Over an older comment shown while the newest one is not ready (the wording of Xét tốt nghiệp's previous advice). */
export const PREVIOUS_COMMENT_NOTE = "Nhận xét trước, viết cho kết quả đánh giá cũ — có thể không còn đúng. Nhận xét mới sẽ thay thế khi sẵn sàng.";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const textOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

/** GET /latest previous, or null when it is missing (an older API) or unreadable; missing lists are empty. */
export function normalizePreviousComment(value: unknown): PreviousAiComment | null {
  if (!isRecord(value) || typeof value.assessmentId !== "string" || !isRecord(value.output) || !isRecord(value.context)) return null;
  const { context } = value;
  return {
    assessmentId: value.assessmentId,
    assessmentCreatedAt: textOrNull(value.assessmentCreatedAt),
    model: textOrNull(value.model),
    completedAt: textOrNull(value.completedAt),
    promptVersion: textOrNull(value.promptVersion),
    output: value.output as AiOutput,
    context: {
      skillDirectory: list(context.skillDirectory),
      groups: list(context.groups),
      career: isRecord(context.career) ? { requirements: list(context.career.requirements) } : null,
      courses: list(context.courses),
      courseSuggestions: list(context.courseSuggestions),
    },
  };
}

/** The assessment's own comment, once completed, in the shape of a previous one (what the page remembers). */
export function ownComment(assessment: StoredAssessment): PreviousAiComment | null {
  const { ai } = assessment;
  if (ai.status !== "completed" || !ai.output) return null;
  return { assessmentId: assessment.id, assessmentCreatedAt: assessment.createdAt, model: ai.model, completedAt: ai.completedAt,
    promptVersion: assessment.result.meta.promptVersion, output: ai.output, context: assessment.result };
}

/**
 * The older comment shown dimmed under the AI state box, like Xét tốt nghiệp's previous advice: while the newest comment
 * is not ready (queued, being written, failed, cancelled, deferred, or AI only just switched on), the one the API sends
 * (the newest completed comment of an older assessment), else the newest one this page session has shown for another
 * assessment ("Đánh giá lại" answers with the new assessment alone). None under "Nhận xét AI chưa được bật": no new
 * comment would replace it.
 */
export function previousComment(input: {
  assessment: StoredAssessment | null;
  aiEnabled: boolean;
  served: PreviousAiComment | null | undefined;
  remembered: PreviousAiComment | null;
}): PreviousAiComment | null {
  const { assessment, remembered } = input;
  if (!assessment || ownComment(assessment) || (assessment.ai.status === "disabled" && !input.aiEnabled)) return null;
  return input.served ?? (remembered && remembered.assessmentId !== assessment.id ? remembered : null);
}

/* ---------------------------------------------------------------- helpers */

export function skillName(result: Pick<AssessmentResult, "skillDirectory">, key: string): string | null {
  return result.skillDirectory.find((skill) => skill.key === key)?.name ?? null;
}

/**
 * "Kỹ năng gần giống đã đo" of a self-study skill: only the similar skills that have a score (comp-calc-v17 stores no other;
 * older results listed skills still to come or outside the student's choices).
 */
export function relatedSkillNames(result: Pick<AssessmentResult, "skills" | "skillDirectory">, item: Pick<SelfStudyItem, "relatedSkillKeys">): string[] {
  const scored = new Set(result.skills.filter((skill) => skill.score !== null).map((skill) => skill.key));
  return item.relatedSkillKeys.filter((key) => scored.has(key)).map((key) => skillName(result, key)).filter((name): name is string => Boolean(name));
}

/** "Cập nhật lúc … · dữ liệu đã dùng …" for the page header. */
export function dataUsedLine(assessment: Pick<StoredAssessment, "createdAt" | "result">): string {
  const { meta, transcript } = assessment.result;
  const parts = [
    `Cập nhật lúc ${formatDateTime(assessment.createdAt)}`,
    `khóa ${meta.cohortCode}`,
    `bảng điểm ${transcript.courseCount.toLocaleString("vi-VN")} học phần${transcript.latestTerm ? ` đến ${termName(transcript.latestTerm)}` : ""}`,
  ];
  return parts.join(" · ");
}
