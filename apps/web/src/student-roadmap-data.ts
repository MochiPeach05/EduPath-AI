// Data of the #roadmap page (the 3-month study roadmap written by EduPath AI): the API shape of
// /api/student/roadmap, its normalization and the plain-language labels of the page. Pure.
import { termName } from "./display-format";

export const ROADMAP_API = "/api/student/roadmap";
/** How often the page asks for the job status while the AI writes. */
export const ROADMAP_POLL_MS = 3000;

/** "deferred" (2026-11-10): asked for while the AI queue was full; the server queues it by itself once there is room. */
export type RoadmapStatus = "deferred" | "queued" | "processing" | "completed" | "failed" | "cancelled";
export type RoadmapStudy = {
  code: string; name: string; credits: number | null; source: "running" | "late" | "next" | "following" | "choice";
  /** An item of the term being studied not registered (comp-calc-v19): not "Trễ kế hoạch" (user 2026-11-04). */
  thisTerm?: boolean;
  termCode: string | null; choiceLabel: string | null; advice: string | null; careerSkills: string[];
};
export type RoadmapChoice = { label: string; source: "next" | "late"; thisTerm?: boolean; termCode: string | null; need: string; options: { code: string; name: string; credits: number | null }[] };
export type RoadmapImprove = {
  code: string; name: string; credits: number; letter: string; score10: number | null; action: "retake" | "improve"; advice: string | null; careerSkills: string[];
};
export type RoadmapSkill = {
  key: string; skillKey: string; name: string; kind: "gap" | "self_study" | "deepen"; statusLabel: string; isRequired: boolean;
  courses: { code: string; name: string }[]; picked: boolean; why: string | null; steps: string[]; outcome: string | null;
};
export type RoadmapMonth = { month: number; start: string; end: string; focus: string | null; tasks: string[] };
export type Roadmap = {
  id: string; assessmentId: string; status: RoadmapStatus; errorCode: string | null; createdAt: string; completedAt: string | null; model: string | null;
  /** term: the term of the school calendar the window covers (roadmap-v7); none for a 3-month roadmap made before. */
  window: { start: string; end: string; months: { index: number; start: string; end: string }[]; term?: string };
  ended: boolean; careerName: string | null; specialtyLabel: string | null; summary: string | null;
  /** Key advice points (roadmap-v3); empty for a roadmap written before. */
  advice: string[];
  study: RoadmapStudy[]; choices: RoadmapChoice[]; improve: RoadmapImprove[]; skills: RoadmapSkill[]; months: RoadmapMonth[];
};
/**
 * Where the advice comes from (roadmap-v9; user 2026-10-30: "Nên tách riêng phần 'bạn tự đánh giá' với 'hệ thống ghi
 * nhận'"): what the system had on record and what the student says in the profile survey (as it is now; surveyChanged:
 * edited after the roadmap was written). Null for a roadmap made before, or without the survey.
 */
export type RoadmapBasis = { recorded: string[]; selfReported: string[]; surveyChanged: boolean };
export type RoadmapResponse = {
  roadmap: Roadmap | null;
  /**
   * While the newest roadmap is not completed: the newest completed one before it, presented the same way; its AI parts
   * stay visible, dimmed, until the new one replaces them (null otherwise, and from an older API).
   */
  previous: Roadmap | null;
  assessment: { id: string; createdAt: string; hasCareer: boolean } | null;
  stale: boolean;
  /**
   * Khảo sát nhanh is answered and may be used: the AI uses it; a roadmap no longer needs it (plan "Một bước để bắt đầu",
   * 2026-11-14). An older API without the field counts as yes.
   */
  surveyDone: boolean;
  aiEnabled: boolean;
  worker: { online: boolean; supportsRoadmap: boolean };
  /** The term a roadmap made now would cover (null from an older API). */
  upcoming: { term: string | null; start: string; end: string } | null;
  basis: RoadmapBasis | null;
};
/** "HK262" → "HK2 2026–2027", as every student page writes a term (user 2026-10-30). */
export const roadmapTermLabel = (code: string): string => termName(code);
/** The eyebrow of a roadmap: its term, or "Lộ trình 3 tháng" for one made before roadmaps followed the school calendar. */
export const roadmapWindowTitle = (window: { term?: string | null }) =>
  window.term ? `Lộ trình ${roadmapTermLabel(window.term)}` : "Lộ trình 3 tháng";
export type RoadmapStatusResponse = { id: string | null; status: RoadmapStatus | null; errorCode: string | null; worker: RoadmapResponse["worker"] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);
const worker = (value: unknown): RoadmapResponse["worker"] =>
  isRecord(value) ? { online: value.online === true, supportsRoadmap: value.supportsRoadmap === true } : { online: false, supportsRoadmap: false };

/** A roadmap as the API sends it; lists default to empty so an older or partial answer never breaks the page. */
export function normalizeRoadmap(value: unknown): Roadmap | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.window)) return null;
  const roadmap = value as unknown as Roadmap;
  return {
    ...roadmap,
    window: { ...roadmap.window, months: list(roadmap.window.months) },
    advice: list<string>(roadmap.advice).filter((item) => typeof item === "string"),
    study: list<RoadmapStudy>(roadmap.study).map((item) => ({ ...item, careerSkills: list(item.careerSkills) })),
    choices: list<RoadmapChoice>(roadmap.choices).map((item) => ({ ...item, options: list(item.options) })),
    improve: list<RoadmapImprove>(roadmap.improve).map((item) => ({ ...item, careerSkills: list(item.careerSkills) })),
    skills: list<RoadmapSkill>(roadmap.skills).map((item) => ({ ...item, courses: list(item.courses), steps: list(item.steps) })),
    months: list<RoadmapMonth>(roadmap.months).map((item) => ({ ...item, tasks: list(item.tasks) })),
  };
}

export function normalizeRoadmapResponse(value: unknown): RoadmapResponse {
  const data = isRecord(value) ? value : {};
  const assessment = isRecord(data.assessment) && typeof data.assessment.id === "string"
    ? { id: data.assessment.id, createdAt: String(data.assessment.createdAt ?? ""), hasCareer: data.assessment.hasCareer === true } : null;
  const upcoming = isRecord(data.upcoming) && typeof data.upcoming.start === "string" && typeof data.upcoming.end === "string"
    ? { term: typeof data.upcoming.term === "string" && data.upcoming.term ? data.upcoming.term : null, start: data.upcoming.start, end: data.upcoming.end } : null;
  const lines = (value: unknown) => list<unknown>(value).filter((item): item is string => typeof item === "string");
  const basis = isRecord(data.basis) ? { recorded: lines(data.basis.recorded), selfReported: lines(data.basis.selfReported), surveyChanged: data.basis.surveyChanged === true } : null;
  const previous = normalizeRoadmap(data.previous);
  return {
    roadmap: normalizeRoadmap(data.roadmap), previous: previous?.status === "completed" ? previous : null, assessment, stale: data.stale === true,
    surveyDone: data.surveyDone !== false, aiEnabled: data.aiEnabled === true,
    worker: worker(data.worker), upcoming, basis: basis && (basis.recorded.length || basis.selfReported.length) ? basis : null,
  };
}

/** Over the AI parts of an older roadmap shown while the newest one is not ready (the wording of Xét tốt nghiệp's previous advice). */
export const PREVIOUS_ROADMAP_NOTE = "Lộ trình trước, viết cho dữ liệu cũ — có thể không còn đúng. Lộ trình mới sẽ thay thế khi sẵn sàng.";
/** The note once the newest roadmap failed or was stopped: no new one is coming by itself (2026-11-10). */
export const previousRoadmapNote = (status: RoadmapStatus | "pending" | null | undefined) =>
  status === "failed" || status === "cancelled" ? "Lộ trình trước, viết cho dữ liệu cũ — có thể không còn đúng." : PREVIOUS_ROADMAP_NOTE;
/** The AI wrote a plan for at least one month. */
export const hasMonthPlan = (roadmap: Pick<Roadmap, "months">) => roadmap.months.some((month) => month.focus || month.tasks.length > 0);

/**
 * The older roadmap whose AI parts (Lời khuyên của cố vấn AI, Kế hoạch theo tháng) stay visible, dimmed, while the newest
 * one is queued, being written, failed or cancelled (user 2026-11-05, like Xét tốt nghiệp): the one the API sends, else
 * the newest completed one this page session has shown ("Tạo lại" answers with the new roadmap alone). Null when it has
 * no AI part to show.
 */
export function previousRoadmap(response: Pick<RoadmapResponse, "roadmap" | "previous"> | null, remembered: Roadmap | null): Roadmap | null {
  const roadmap = response?.roadmap;
  if (!response || !roadmap || roadmap.status === "completed") return null;
  const previous = response.previous ?? (remembered?.status === "completed" && remembered.id !== roadmap.id ? remembered : null);
  return previous && (previous.summary || hasMonthPlan(previous)) ? previous : null;
}

export function normalizeRoadmapStatus(value: unknown): RoadmapStatusResponse {
  const data = isRecord(value) ? value : {};
  return {
    id: typeof data.id === "string" ? data.id : null,
    status: typeof data.status === "string" ? data.status as RoadmapStatus : null,
    errorCode: typeof data.errorCode === "string" ? data.errorCode : null,
    worker: worker(data.worker),
  };
}

export const isPending = (status: RoadmapStatus | null | undefined) => status === "queued" || status === "processing";
/** The statuses that change on their own, so the page polls them: a deferred roadmap is queued by the server (2026-11-10). */
export const shouldPollRoadmap = (status: RoadmapStatus | null | undefined) => isPending(status) || status === "deferred";

/* ----------------------------------------------------------------- labels */

/** "2026-10-24" → "24/10/2026". */
export const dateText = (value: string) => value.split("-").reverse().join("/");
/** "2026-10-24" → "24/10". */
export const dayMonth = (value: string) => value.split("-").slice(1).reverse().join("/");
/** "HK261" → "HK1 2026–2027" (termName, the one way a term is written); other shapes are shown as they are. */
export const termShort = (term: string | null | undefined): string | null => (term ? termName(term.trim()) : null);
const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase("vi") + value.slice(1);

/** The tag of a course to take. */
export function studyTag(item: Pick<RoadmapStudy, "source" | "termCode" | "choiceLabel" | "thisTerm">): { text: string; tone: "running" | "late" | "next" | "following" | "choice" } {
  const term = termShort(item.termCode);
  if (item.source === "running") return { text: term ? `Đang học · ${term}` : "Đang học", tone: "running" };
  if (item.source === "late" && item.thisTerm) return { text: term ? `Kế hoạch ${term} · chưa đăng ký` : "Kế hoạch học kỳ này · chưa đăng ký", tone: "next" };
  if (item.source === "late") return { text: term ? `Trễ kế hoạch · ${term}` : "Trễ kế hoạch", tone: "late" };
  if (item.source === "choice") return { text: item.choiceLabel ? `Tự chọn: ${item.choiceLabel}` : "Tự chọn", tone: "choice" };
  // Roadmaps written before 2026-10-24 (roadmap-v1) listed the term after the one being studied as "following".
  if (item.source === "following") return { text: term ? `Học kỳ tới · ${term}` : "Học kỳ tới", tone: "next" };
  return { text: term ? `Học kỳ tới · ${term}` : "Học kỳ tới", tone: "next" };
}

export const improveTag = (action: RoadmapImprove["action"]) => (action === "retake" ? "Học lại" : "Học cải thiện");
/**
 * The title of the học lại / học cải thiện list (user 2026-10-31: "Phải phân biệt học lại (chưa đạt) với học cải thiện (đã đạt
 * nhưng muốn nâng điểm). Nếu hiển thị cả hai, dùng tiêu đề 'Môn học bạn cần học lại và cải thiện'"): it names only the kinds shown;
 * a passed course is improved by choice, so alone it is "có thể".
 */
export function improveHeading(items: readonly Pick<RoadmapImprove, "action">[]): string {
  const retake = items.some((item) => item.action === "retake");
  const improve = items.some((item) => item.action !== "retake");
  if (retake && !improve) return "Môn học bạn cần học lại";
  if (improve && !retake) return "Môn học bạn có thể học cải thiện";
  return "Môn học bạn cần học lại và cải thiện";
}

export function skillTags(skill: Pick<RoadmapSkill, "isRequired" | "kind">): string[] {
  return [skill.isRequired ? "Bắt buộc" : "Ưu tiên", ...(skill.kind === "self_study" ? ["Cần tự học"] : skill.kind === "deepen" ? ["Nâng cao"] : [])];
}

/** "Tháng 1 · 24/10 – 23/11/2026". */
export const monthTitle = (month: Pick<RoadmapMonth, "month" | "start" | "end">) => `Tháng ${month.month} · ${dayMonth(month.start)} – ${dateText(month.end)}`;

/**
 * "Nhóm tự chọn TC406: chọn 6 tín chỉ: còn thiếu 6 TC, theo kế hoạch ở HK1 2026–2027". need is the system's shortfall in the
 * unit of the requirement (comp-calc-v19 shortfallText: "6 TC", "1 học phần (3 TC)"); a roadmap made before wrote "n môn", or
 * for a group of credits its course count with the TC unit ("1 TC"), until it is made again.
 */
export const choiceText = (choice: RoadmapChoice) =>
  `${choice.label}: còn thiếu ${choice.need}${choice.source === "late" && choice.termCode ? `, theo kế hoạch ở ${termShort(choice.termCode)}${choice.thisTerm ? ", chưa đăng ký" : ""}` : ""}`;

const ERROR_MESSAGES: Record<string, string> = {
  assessment_required: "Bạn cần có kết quả Đánh giá năng lực trước khi tạo lộ trình.",
  // An older API only: a roadmap needs no survey since 2026-11-14.
  survey_required: "Hệ thống đang cập nhật. Hãy tải lại trang rồi bấm Tạo lộ trình lần nữa.",
  roadmap_too_frequent: "Bạn vừa tạo lộ trình. Vui lòng đợi khoảng nửa phút rồi thử lại.",
  queue_full: "Hàng đợi AI đang đầy. Vui lòng thử lại sau ít phút.",
  ai_disabled: "Lộ trình do EduPath AI soạn hiện chưa được bật.",
  account_unavailable: "Tài khoản hiện không dùng được chức năng này.",
  authentication_required: "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.",
  database_required: "Chưa kết nối được nơi lưu lộ trình. Vui lòng thử lại sau.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
};
export const requestErrorMessage = (code: string | undefined) => ERROR_MESSAGES[code ?? ""] ?? "Không xử lý được yêu cầu. Vui lòng thử lại.";

/** Why a job failed, in plain words. */
export function failureText(errorCode: string | null): string {
  switch (errorCode) {
    case "worker_timeout": return "Máy AI không trả lời kịp.";
    case "ai_timeout": return "EduPath AI soạn quá lâu nên đã dừng.";
    case "ai_output_truncated": return "Câu trả lời của AI bị cắt giữa chừng nên chưa dùng được.";
    case "invalid_ai_output": return "Nội dung AI soạn chưa đạt yêu cầu kiểm tra nên không được lưu.";
    case "ollama_unavailable": return "Máy AI chưa sẵn sàng.";
    default: return "Đã có lỗi khi soạn lộ trình.";
  }
}

/**
 * The line over the older roadmap when the newest one failed (QA 2026-11-10: the page kept the old roadmap dimmed without
 * saying the new one failed and what to do): when, why (failureText) and the button; action: where that button is.
 */
export const failedRoadmapText = (roadmap: { createdAt: string; errorCode?: string | null }, action = "Bấm “Thử lại” để thử lần nữa.") =>
  `Lần tạo Lộ trình AI mới lúc ${formatDateTime(roadmap.createdAt)} không thành công. ${roadmap.errorCode ? `${failureText(roadmap.errorCode)} ` : ""}Lộ trình bên dưới là bản trước. ${action}`;

/** A roadmap asked for while the AI queue was full (2026-11-10): it is queued by itself, no button needed. */
export const DEFERRED_ROADMAP_COPY = {
  title: "Hàng đợi AI đang đầy",
  text: "Yêu cầu của bạn đã được giữ lại. Hệ thống sẽ tự xếp hàng soạn lộ trình khi hàng đợi có chỗ, bạn không cần bấm gì thêm.",
} as const;

/** error_code of a roadmap the AI writes once more because its first answer did not hold to the data (roadmap-v9). */
export const ROADMAP_RETRY_CODE = "grounding_retry";

/** The line under the spinner while the AI works, or the reason it waits; errorCode: a second try (ROADMAP_RETRY_CODE). */
export function pendingCopy(status: "queued" | "processing", workerState: RoadmapResponse["worker"], errorCode: string | null = null): { title: string; text: string } {
  if (errorCode === ROADMAP_RETRY_CODE && (status === "processing" || (workerState.online && workerState.supportsRoadmap))) {
    return { title: "EduPath AI đang viết lại lộ trình…", text: "Bản đầu có vài câu chưa khớp dữ liệu của bạn (học kỳ đã qua, hoặc điều bạn tự đánh giá mà hệ thống chưa ghi nhận) nên AI viết lại một lần, thường thêm khoảng 30 giây đến 1 phút." };
  }
  if (status === "processing") return { title: "EduPath AI đang soạn lộ trình…", text: "Thường mất khoảng 1–2 phút. Bạn có thể rời trang và quay lại sau." };
  if (!workerState.online) return { title: "Lộ trình sẽ được soạn khi máy AI hoạt động trở lại", text: "Yêu cầu đã được giữ trong hàng đợi; bạn không cần làm gì thêm." };
  if (!workerState.supportsRoadmap) return { title: "Máy AI đang chạy phiên bản cũ…", text: "Lộ trình sẽ được soạn khi máy AI được cập nhật." };
  return { title: "Đang chờ đến lượt…", text: "Yêu cầu của bạn đã vào hàng đợi của EduPath AI." };
}

/** "gemma4:e4b" → "Gemma 4 E4B", "@cf/google/gemma-4-26b-a4b-it" → "Gemma 4 26B" (ai-model.ts). */
export { modelLabel, modelPlace } from "./ai-model";

/** hh:mm dd/mm/yyyy in Vietnam time. */
export function formatDateTime(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

/** "A", "A và B", "A, B và C". */
export function joinVi(parts: readonly string[]): string {
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} và ${parts[parts.length - 1]}`;
}

export const helpsText = (skills: readonly string[]) => (skills.length ? `Giúp rèn kỹ năng ${joinVi(skills)}.` : "");
export const sentence = (value: string) => capitalize(value.trim());
