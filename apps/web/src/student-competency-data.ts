// Pure helpers for the #competency page: labels, formatting, AI key mapping and
// the polling decision. No fetch, no DOM — everything here is unit tested.
import type {
  AiOutput, AiPriority, AiStatus, AssessmentResult, CareerRequirementResult, CareerResult, Confidence,
  CourseState, Eligibility, HistoryPoint, LevelCode, SkillPlan, SkillResult, StoredAssessment, SupportCourse,
} from "./competency-assessment-types";

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
  transcript_required: { title: "Cần bảng điểm để bắt đầu", text: "EduPath tính năng lực từ kết quả các học phần bạn đã học. Hãy import bảng điểm PDF xuất từ cổng đào tạo, rồi quay lại đây.", action: { label: "Import bảng điểm", href: "#profile" } },
  career_required: { title: "Cần chọn nghề mục tiêu", text: "Đánh giá năng lực cần đủ bảng điểm, nghề mục tiêu và chuyên ngành. Hãy chọn nghề mục tiêu trong hồ sơ, rồi quay lại đây.", action: { label: "Chọn nghề mục tiêu", href: "#profile" } },
  specialty_required: { title: "Cần chọn chuyên ngành", text: "Đánh giá năng lực cần đủ bảng điểm, nghề mục tiêu và chuyên ngành. Hãy chọn chuyên ngành trong hồ sơ, rồi quay lại đây.", action: { label: "Chọn chuyên ngành", href: "#profile" } },
  cohort_unknown: { title: "Hồ sơ chưa có khóa học", text: "Hệ thống cần biết bạn thuộc khóa nào để chọn đúng chương trình đào tạo. Thông tin khóa được đồng bộ từ tài khoản trường; nếu mục Khóa học trong hồ sơ còn trống, hãy liên hệ Khoa để được cập nhật.", action: { label: "Xem hồ sơ", href: "#profile" } },
  curriculum_unavailable: { title: "Chưa có chương trình đào tạo cho khóa của bạn", text: "Khoa chưa công bố chương trình đào tạo đang áp dụng cho khóa này trên EduPath. Bạn có thể quay lại sau khi chương trình được cập nhật.", action: null },
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
    profile && !profile.careerPositionId ? "nghề mục tiêu" : null,
    profile && profile.specialty !== undefined && !profile.specialty ? "chuyên ngành" : null,
  ].filter((item): item is string => item !== null);
}
/** "a", "a và b", "a, b và c". */
const joinWords = (words: readonly string[]) => words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} và ${words.at(-1)}`;
export const missingRequirementsMessage = (missing: readonly string[]) =>
  `Cần đủ bảng điểm, nghề mục tiêu và chuyên ngành để đánh giá năng lực. Hãy bổ sung ${joinWords(missing)} rồi bấm lại.`;

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
/**
 * Scores are classified unrounded by the engine and shown as whole numbers rounded DOWN,
 * so a shown score never crosses a level or threshold it has not reached (84,6 shows 84, not 85).
 */
export const formatScore = (value: number | null | undefined) => value === null || value === undefined ? "—" : integer.format(Math.floor(value + 1e-9));
export const formatNumber = (value: number | null | undefined) => value === null || value === undefined ? "—" : decimal.format(value);
export const formatPercent = (share: number | null | undefined) => share === null || share === undefined ? "—" : `${integer.format(share * 100)}%`;
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}
/** "HK253" → "HK3 · 2025–2026". Unknown shapes are shown as they are. */
export function termLabel(term: string | null | undefined): string {
  if (!term) return "Chưa xếp lịch";
  const match = /^HK(\d{2})(\d)$/.exec(term);
  if (!match) return term;
  const start = 2000 + Number(match[1]);
  return `HK${match[2]} · ${start}–${start + 1}`;
}

/* ----------------------------------------------------------------- levels */

/** Blue ramp steps (1 = Cơ bản dưới … 4 = Thành thạo); 0 = no fill (no score / exempt). */
export function levelStep(level: LevelCode | DisplayLevel | null | undefined): 0 | 1 | 2 | 3 | 4 {
  switch (level) {
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
 * (VT, a pass without a score…), otherwise "Sắp học": courses ahead, in progress or electives still
 * open. Display only: the engine and stored results keep no_evidence, so older results read the
 * same. A not-applicable skill has none (it is outside the student's choices).
 */
export type DisplayLevel = Exclude<LevelCode, "no_evidence"> | "upcoming" | "no_score";
export function displayLevel(skill: Pick<SkillResult, "level" | "status" | "evidenceCourses">): DisplayLevel | null {
  if (skill.status === "not_applicable") return null;
  if (skill.level !== "no_evidence") return skill.level;
  return skill.evidenceCourses.some((row) => row.role === "studied") ? "no_score" : "upcoming";
}

export const LEVEL_SCALE: readonly { code: DisplayLevel; label: string; range: string; text: string }[] = [
  { code: "proficient", label: "Thành thạo", range: "từ 85", text: "Kết quả các học phần liên quan rất tốt và ổn định." },
  { code: "good", label: "Khá", range: "70 đến dưới 85", text: "Nắm chắc phần lớn nội dung; có thể nâng lên bằng dự án thực tế." },
  { code: "basic", label: "Cơ bản", range: "50 đến dưới 70", text: "Đã có nền tảng, nên củng cố thêm để dùng tự tin hơn." },
  { code: "needs_work", label: "Cần củng cố", range: "dưới 50", text: "Kết quả các học phần liên quan còn thấp; nên ôn lại hoặc học cải thiện." },
  { code: "upcoming", label: "Sắp học", range: "chưa học", text: "Bạn đang học hoặc chưa học tới học phần đo kỹ năng này (kể cả môn tự chọn chưa chọn) — không phải điểm yếu." },
  { code: "no_score", label: "Chưa có điểm", range: "đã học", text: "Bạn đã học học phần liên quan nhưng bảng điểm chưa có điểm số, nên chưa đánh giá được." },
  { code: "exempt", label: "Miễn/công nhận", range: "MT", text: "Học phần được miễn hoặc công nhận nên không có điểm để tính." },
];

/** A group's or the overall level label: with no evidence it reads "Chưa có điểm", like its "—" score. */
export const levelText = (level: LevelCode | DisplayLevel | null | undefined, label: string | null | undefined): string =>
  level === "no_evidence" || !label ? "Chưa có điểm" : label;

/** One sentence that explains what the overall level means. */
export function levelSentence(level: LevelCode | null | undefined): string {
  return LEVEL_SCALE.find((item) => item.code === level)?.text ?? "Chưa đủ dữ liệu để xếp mức.";
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = { low: "Độ tin cậy thấp", medium: "Độ tin cậy trung bình", high: "Độ tin cậy cao" };

/* --------------------------------------------------------- career and gaps */

export type StatusTone = "pass" | "fail" | "unknown" | "neutral";
/** Deficits are unrounded; shown as whole points rounded UP (matches the rounded-down score), never "thiếu 0 điểm". */
function deficitPoints(deficit: number): number {
  return Math.max(1, Math.ceil(deficit - 1e-9));
}
export function deficitText(deficit: number | null): string {
  if (deficit === null) return "Dưới ngưỡng";
  return `Dưới ngưỡng · thiếu ${formatScore(deficitPoints(deficit))} điểm`;
}
/** "Chênh lệch" column: consistent with formatScore and deficitText; null when there is nothing to compare. */
export function scoreDifference(req: Pick<CareerRequirementResult, "score" | "status" | "deficit" | "threshold">): number | null {
  if (req.score === null || req.status === "upcoming" || req.status === "no_data") return null;
  if (req.status === "below" && req.deficit !== null) return -deficitPoints(req.deficit);
  return Math.floor(req.score + 1e-9) - req.threshold;
}
/** Glyph + text + colour of a career requirement. Green/red/amber only for met and gaps; never red for missing data. */
export function gapStatusDisplay(req: Pick<CareerRequirementResult, "status" | "deficit" | "upcomingTerm" | "exemptOnly">): { tone: StatusTone; glyph: string; text: string } {
  switch (req.status) {
    case "met": return { tone: "pass", glyph: "✓", text: req.exemptOnly ? "Đạt ngưỡng · miễn/công nhận" : "Đạt ngưỡng" };
    case "below": return { tone: "fail", glyph: "✗", text: deficitText(req.deficit) };
    case "not_studied": return { tone: "unknown", glyph: "!", text: "Chưa học" };
    case "upcoming": return { tone: "neutral", glyph: "○", text: req.upcomingTerm ? `Sắp học · ${req.upcomingTerm}` : "Sắp học" };
    default: return { tone: "neutral", glyph: "?", text: "Chưa đủ dữ liệu" };
  }
}

const STATUS_ORDER: Record<CareerRequirementResult["status"], number> = { below: 0, not_studied: 1, upcoming: 2, no_data: 3, met: 4 };
/** Bắt buộc first, then the largest shortfall first (spec §11.4). */
export function sortRequirements(list: readonly CareerRequirementResult[]): CareerRequirementResult[] {
  return [...list].sort((a, b) => Number(b.isRequired) - Number(a.isRequired)
    || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || (b.deficit ?? 0) - (a.deficit ?? 0)
    || a.title.localeCompare(b.title, "vi"));
}
export const isGap = (req: Pick<CareerRequirementResult, "status">) => req.status !== "met";

/**
 * "Thang mức phù hợp" of the gap page (user, 2026-10-21): the engine's fit labels and their bands
 * (FIT_LABEL_THRESHOLDS 0,8 / 0,5; "Chưa đủ dữ liệu" when under FIT_MIN_DATA_SHARE 0,5 of the
 * coefficients has data), in the student's words.
 */
export const FIT_SCALE: readonly { code: CareerResult["fitCode"]; label: string; range: string; text: string }[] = [
  { code: "fit", label: "Phù hợp", range: "từ 80% yêu cầu", text: "Bạn đã đạt gần hết kỹ năng mà nghề này yêu cầu." },
  { code: "fairly_fit", label: "Khá phù hợp", range: "50% đến dưới 80%", text: "Bạn đạt phần lớn yêu cầu; còn một vài kỹ năng cần nâng lên ngưỡng." },
  { code: "needs_more", label: "Cần bổ sung nhiều", range: "dưới 50%", text: "Nhiều kỹ năng của nghề chưa đạt ngưỡng; hãy bắt đầu từ các kỹ năng còn thiếu ở trên." },
  { code: "insufficient_data", label: "Chưa đủ dữ liệu", range: "dưới một nửa có điểm", text: "Chưa tới một nửa yêu cầu của nghề có điểm để so sánh (phần lớn còn sắp học hoặc chương trình chưa đo), nên chưa xếp mức." },
];
/** A fit share as a whole percent rounded DOWN, like the scores: 79,96% reads 79%, never 80% under Khá phù hợp. */
export const fitPercent = (share: number) => `${Math.floor(share * 100 + 1e-9).toLocaleString("vi-VN")}%`;

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
    case "graded_unknown": return { tone: "unknown", text: `Có điểm${score}, chưa rõ kết quả` };
    default: return { tone: "neutral", text: "Chưa học" };
  }
}

/**
 * The course plans that fit the result: with a target career, only its met skills below Thành thạo
 * ("deepen", comp-calc-v7); without one, the skills below Khá ("strengthen"; v6 plans have no purpose
 * and are of that kind). Weak skills outside the chosen career are never advised on.
 */
export function plansFor(result: Pick<AssessmentResult, "career" | "skillPlans">): SkillPlan[] {
  const purpose = result.career ? "deepen" : "strengthen";
  return (result.skillPlans ?? []).filter((plan) => (plan.purpose ?? "strengthen") === purpose);
}

/** Career requirement skills by key: the AI's improvements about them belong on the gap page too. */
export const careerSkillKeys = (result: Pick<AssessmentResult, "career">): Set<string> =>
  new Set((result.career?.requirements ?? []).map((req) => req.skillKey).filter((key): key is string => Boolean(key)));

/* ------------------------------------------------- history (STU-COMP-07) */

type HistoryRow = HistoryPoint & {
  /** Whole-point change of the overall score from the previous term with a score, as the page shows the scores (rounded down). */
  change: number | null;
  /** The newest term: the result shown everywhere else on the page. */
  latest: boolean;
};
type HistoryYear = { schoolYear: string; rows: HistoryRow[]; end: HistoryRow };

const shown = (score: number | null) => score === null ? null : Math.floor(score + 1e-9);

/** The history grouped by school year, oldest first, each term with its change from the term before. */
export function historyYears(history: readonly HistoryPoint[]): HistoryYear[] {
  const years: HistoryYear[] = [];
  let previous: number | null = null;
  history.forEach((point, index) => {
    const score = shown(point.overall.score);
    const row: HistoryRow = { ...point, change: score !== null && previous !== null ? score - previous : null, latest: index === history.length - 1 };
    if (score !== null) previous = score;
    const year = years.at(-1);
    if (year && year.schoolYear === point.schoolYear) { year.rows.push(row); year.end = row; }
    else years.push({ schoolYear: point.schoolYear, rows: [row], end: row });
  });
  return years;
}

/** "học kỳ 1 năm học 2023–2024". */
const termInWords = (point: Pick<HistoryPoint, "semester" | "schoolYear">) => `học kỳ ${point.semester} năm học ${point.schoolYear}`;

/** One sentence on the overall trend from the first term with a score to the newest one; null with fewer than two. */
export function historySentence(history: readonly HistoryPoint[]): string | null {
  const scored = history.filter((point) => point.overall.score !== null);
  if (scored.length < 2) return null;
  const first = scored[0]!, last = scored.at(-1)!;
  const from = shown(first.overall.score)!, to = shown(last.overall.score)!;
  const best = scored.reduce((top, point) => shown(point.overall.score)! > shown(top.overall.score)! ? point : top, first);
  const trend = to > from ? `tăng từ ${from} (${termInWords(first)}) lên ${to} (${termInWords(last)})`
    : to < from ? `giảm từ ${from} (${termInWords(first)}) xuống ${to} (${termInWords(last)})`
      : `giữ ở mức ${to} từ ${termInWords(first)} đến ${termInWords(last)}`;
  const peak = best !== first && best !== last && shown(best.overall.score)! > Math.max(from, to) ? ` Cao nhất là ${shown(best.overall.score)} vào ${termInWords(best)}.` : "";
  return `Điểm năng lực tổng ${trend}.${peak}`;
}

/* ------------------------------------------------- STU-GAP-07: career skills by term */

type GapHistoryRow = {
  requirementId: string; name: string; priorityLabel: string; isRequired: boolean; threshold: number;
  /** One cell per point: the score as the page shows it (rounded down) and the status of that term. */
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
      cells, change: scored.length >= 2 ? scored.at(-1)!.score! - scored[0]!.score! : null,
    };
  });
  const first = points[0]!, last = points.at(-1)!;
  const from = first.career!.met, to = last.career!.met, total = last.career!.total;
  const best = rows.reduce<GapHistoryRow | null>((top, row) => row.change !== null && row.change > 0 && (!top || row.change > top.change!) ? row : top, null);
  const sentence = points.length < 2
    ? `Mới có ${termInWords(last)} có điểm nên chưa so sánh được; ${to}/${total} kỹ năng nghề đạt ngưỡng.`
    : `Từ ${termInWords(first)} đến ${termInWords(last)}, số kỹ năng nghề đạt ngưỡng ${to > from ? `tăng từ ${from} lên ${to}` : to < from ? `giảm từ ${from} xuống ${to}` : `giữ ở ${to}`}/${total}.`
      + (best ? ` Tăng nhiều nhất: ${best.name} (+${best.change} điểm).` : "");
  return { state: "ready", points, rows, sentence };
}

/* ---------------------------------------------------- proficiency summary */

/** The level columns of the proficiency table, best first; "Sắp học" and "Chưa có điểm" last (not weaknesses). */
export const LEVEL_COLUMNS = ["proficient", "good", "basic", "needs_work", "upcoming", "no_score"] as const satisfies readonly DisplayLevel[];
type LevelRow = {
  key: string; name: string; score: number | null; level: LevelCode; levelLabel: string;
  /** Skills of the group counted like the group line: condition-only and not-applicable skills left out. */
  total: number;
  counts: Record<(typeof LEVEL_COLUMNS)[number], number>;
};
/** One row per skill group: how many of its skills sit at each proficiency level. */
/** A skill counted in its group like the group line: condition-only and not-applicable skills are left out. */
const countedInGroup = (skill: SkillResult, groupKey: string) => skill.groupKey === groupKey && !skill.conditionOnly && skill.status !== "not_applicable";

export function levelSummary(result: Pick<AssessmentResult, "groups" | "skills">): LevelRow[] {
  return result.groups.map((group) => {
    const skills = result.skills.filter((skill) => countedInGroup(skill, group.key));
    const counts = Object.fromEntries(LEVEL_COLUMNS.map((level) => [level, skills.filter((skill) => displayLevel(skill) === level).length])) as LevelRow["counts"];
    return { key: group.key, name: group.name, score: group.score, level: group.level, levelLabel: group.levelLabel, total: skills.length, counts };
  });
}

/* ------------------------------------------------- level chart ("Bảng phân tích mức độ thành thạo") */

/** Segment order of each group's bar: the four levels from the top down, then "Sắp học", "Chưa có điểm" and exempt (no score). */
export const CHART_LEVELS = [...LEVEL_COLUMNS, "exempt"] as const satisfies readonly DisplayLevel[];
export type ChartLevel = (typeof CHART_LEVELS)[number];
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
  const label = (level: ChartLevel) => LEVEL_SCALE.find((item) => item.code === level)?.label ?? level;
  const bars = rows.map(({ group, skills }) => {
    let offset = 0;
    const segments = CHART_LEVELS.flatMap((level): LevelSegment[] => {
      const members = skills.filter((skill) => displayLevel(skill) === level)
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, "vi"));
      if (!members.length) return [];
      const start = offset / axis.max;
      offset += members.length;
      return [{ level, label: label(level), count: members.length, share: members.length / skills.length, start, end: offset / axis.max, skills: members }];
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
  return skills.filter((skill) => (!filters.group || skill.groupKey === filters.group)
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
export function groupEvidenceCounts(skills: readonly Pick<SkillResult, "groupKey" | "conditionOnly" | "status">[], groupKey: string): { withEvidence: number; total: number } {
  const counted = skills.filter((skill) => skill.groupKey === groupKey && !skill.conditionOnly && skill.status !== "not_applicable");
  return { withEvidence: counted.filter((skill) => skill.status === "scored" || skill.status === "exempt_only").length, total: counted.length };
}

type SkillBucket = { id: string; title: string; note: string | null; skills: SkillResult[] };
/**
 * Groups for the skill list: one per engine group (scored or exempt skills),
 * then condition-only skills, skills outside the student's choices and, last,
 * "Sắp học" and "Chưa có điểm" (ids = their display levels) — never presented as weaknesses.
 */
export function bucketSkills(result: Pick<AssessmentResult, "groups">, skills: readonly SkillResult[]): SkillBucket[] {
  const buckets: SkillBucket[] = result.groups.map((group) => ({ id: group.key, title: group.name, note: null, skills: [] }));
  const condition: SkillBucket = { id: "condition", title: "Môn điều kiện (GDTC/GDQP)", note: "Không tính vào điểm nhóm và điểm tổng.", skills: [] };
  const notApplicable: SkillBucket = { id: "not-applicable", title: "Ngoài lựa chọn học phần của bạn", note: "Chỉ có trong học phần của chuyên ngành khác hoặc nhóm tự chọn bạn không chọn.", skills: [] };
  const upcoming: SkillBucket = { id: "upcoming", title: "Sắp học", note: "Không phải điểm yếu — bạn đang học hoặc chưa học tới học phần đo kỹ năng này (kể cả môn tự chọn chưa chọn).", skills: [] };
  const noScore: SkillBucket = { id: "no_score", title: "Chưa có điểm", note: "Bạn đã học học phần liên quan nhưng bảng điểm chưa có điểm số, nên chưa đánh giá được.", skills: [] };
  for (const skill of skills) {
    const level = displayLevel(skill);
    if (skill.status === "not_applicable") notApplicable.skills.push(skill);
    else if (level === "upcoming") upcoming.skills.push(skill);
    else if (level === "no_score") noScore.skills.push(skill);
    else if (skill.conditionOnly) condition.skills.push(skill);
    else (buckets.find((bucket) => bucket.id === skill.groupKey) ?? upcoming).skills.push(skill);
  }
  return [...buckets, condition, notApplicable, upcoming, noScore].filter((bucket) => bucket.skills.length > 0);
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
      : { title: "Nhận xét AI chưa được bật", text: "Kết quả bên dưới do hệ thống tính và đã đầy đủ. Khi máy AI của nhóm phát triển hoạt động, bạn có thể nhận thêm lời nhận xét." };
    case "deferred": return { title: "Hàng đợi AI đang đầy", text: "Kết quả tính toán đã sẵn sàng. Bấm tạo nhận xét sau ít phút để xếp hàng lại." };
    case "queued": return workerOnline
      ? { title: "Đang xếp hàng tạo nhận xét", text: "AI suy luận trước khi viết nên nhận xét thường mất 1–3 phút. Bạn có thể xem kết quả bên dưới trong lúc chờ." }
      : { title: "Đang chờ máy AI kết nối", text: "Yêu cầu đã được giữ trong hàng đợi và sẽ được xử lý khi máy AI kết nối lại." };
    case "processing": return { title: "EduPath AI đang suy luận và viết nhận xét", text: "Mô hình suy luận trên kết quả đã tính rồi mới viết nhận xét, thường mất 1–3 phút. Bạn có thể rời trang và quay lại sau." };
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

/** Comments written with Gemma's thinking mode: prompt comp-v7 and later. */
export function aiReasoned(promptVersion: string | null | undefined): boolean {
  const match = /^comp-v(\d+)$/.exec(promptVersion ?? "");
  return Boolean(match && Number(match[1]) >= 7);
}

/** "gemma4:e4b" → "Gemma 4 E4B". */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return "Gemma 4 E4B";
  const match = /^gemma(\d+):e(\d+)b/i.exec(model);
  return match ? `Gemma ${match[1]} E${match[2]}B` : model;
}

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
 */
export function mapAiOutput(output: AiOutput | null | undefined, result: AssessmentResult): MappedAiOutput | null {
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

/* ---------------------------------------------------------------- helpers */

export function skillName(result: Pick<AssessmentResult, "skillDirectory">, key: string): string | null {
  return result.skillDirectory.find((skill) => skill.key === key)?.name ?? null;
}

/** "Cập nhật lúc … · dữ liệu đã dùng …" for the page header. */
export function dataUsedLine(assessment: Pick<StoredAssessment, "createdAt" | "result">): string {
  const { meta, transcript } = assessment.result;
  const parts = [
    `Cập nhật lúc ${formatDateTime(assessment.createdAt)}`,
    `khóa ${meta.cohortCode}`,
    `bảng điểm ${transcript.courseCount.toLocaleString("vi-VN")} học phần${transcript.latestTerm ? ` đến ${transcript.latestTerm}` : ""}`,
  ];
  return parts.join(" · ");
}
