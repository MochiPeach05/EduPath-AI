// Data of the #roadmap page (the 3-month study roadmap written by EduPath AI): the API shape of
// /api/student/roadmap, its normalization and the plain-language labels of the page. Pure.

export const ROADMAP_API = "/api/student/roadmap";
/** How often the page asks for the job status while the AI writes. */
export const ROADMAP_POLL_MS = 3000;

export type RoadmapStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type RoadmapStudy = {
  code: string; name: string; credits: number | null; source: "running" | "late" | "next" | "following" | "choice";
  termCode: string | null; choiceLabel: string | null; advice: string | null; careerSkills: string[];
};
export type RoadmapChoice = { label: string; source: "next" | "late"; termCode: string | null; need: string; options: { code: string; name: string; credits: number | null }[] };
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
  window: { start: string; end: string; months: { index: number; start: string; end: string }[] };
  ended: boolean; careerName: string | null; specialtyLabel: string | null; summary: string | null;
  /** Key advice points (roadmap-v3); empty for a roadmap written before. */
  advice: string[];
  study: RoadmapStudy[]; choices: RoadmapChoice[]; improve: RoadmapImprove[]; skills: RoadmapSkill[]; months: RoadmapMonth[];
};
export type RoadmapResponse = {
  roadmap: Roadmap | null;
  assessment: { id: string; createdAt: string; hasCareer: boolean } | null;
  stale: boolean;
  /** The profile survey is answered: a new roadmap needs it (an older API without the field counts as yes). */
  surveyDone: boolean;
  aiEnabled: boolean;
  worker: { online: boolean; supportsRoadmap: boolean };
};
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
  return { roadmap: normalizeRoadmap(data.roadmap), assessment, stale: data.stale === true, surveyDone: data.surveyDone !== false, aiEnabled: data.aiEnabled === true, worker: worker(data.worker) };
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

/* ----------------------------------------------------------------- labels */

/** "2026-10-24" → "24/10/2026". */
export const dateText = (value: string) => value.split("-").reverse().join("/");
/** "2026-10-24" → "24/10". */
export const dayMonth = (value: string) => value.split("-").slice(1).reverse().join("/");
/** "HK253" → "học kỳ 3 năm học 2025–2026"; other shapes are shown as they are. */
export function termText(term: string | null | undefined): string | null {
  if (!term) return null;
  const match = /^HK(\d{2})([1-3])$/.exec(term.trim());
  if (!match) return term;
  const start = 2000 + Number(match[1]);
  return `học kỳ ${match[2]} năm học ${start}–${start + 1}`;
}
/** "HK261" → "HK1 2026–2027"; other shapes are shown as they are. */
export function termShort(term: string | null | undefined): string | null {
  if (!term) return null;
  const match = /^HK(\d{2})([1-3])$/.exec(term.trim());
  if (!match) return term;
  const start = 2000 + Number(match[1]);
  return `HK${match[2]} ${start}–${start + 1}`;
}
const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase("vi") + value.slice(1);

/** The tag of a course to take. */
export function studyTag(item: Pick<RoadmapStudy, "source" | "termCode" | "choiceLabel">): { text: string; tone: "running" | "late" | "next" | "following" | "choice" } {
  const term = termShort(item.termCode);
  if (item.source === "running") return { text: term ? `Đang học · ${term}` : "Đang học", tone: "running" };
  if (item.source === "late") return { text: term ? `Trễ kế hoạch · ${term}` : "Trễ kế hoạch", tone: "late" };
  if (item.source === "choice") return { text: item.choiceLabel ? `Tự chọn: ${item.choiceLabel}` : "Tự chọn", tone: "choice" };
  // Roadmaps written before 2026-10-24 (roadmap-v1) listed the term after the one being studied as "following".
  if (item.source === "following") return { text: term ? `Học kỳ tới · ${term}` : "Học kỳ tới", tone: "next" };
  return { text: term ? `Học kỳ tới · ${term}` : "Học kỳ tới", tone: "next" };
}

export const improveTag = (action: RoadmapImprove["action"]) => (action === "retake" ? "Học lại" : "Học cải thiện");

export function skillTags(skill: Pick<RoadmapSkill, "isRequired" | "kind">): string[] {
  return [skill.isRequired ? "Bắt buộc" : "Ưu tiên", ...(skill.kind === "self_study" ? ["Cần tự học"] : skill.kind === "deepen" ? ["Nâng cao"] : [])];
}

/** "Tháng 1 · 24/10 – 23/11/2026". */
export const monthTitle = (month: Pick<RoadmapMonth, "month" | "start" | "end">) => `Tháng ${month.month} · ${dayMonth(month.start)} – ${dateText(month.end)}`;

export const choiceText = (choice: RoadmapChoice) =>
  `${choice.label}: còn thiếu ${choice.need}${choice.source === "late" && choice.termCode ? ` (theo kế hoạch ở ${termText(choice.termCode)})` : ""}`;

const ERROR_MESSAGES: Record<string, string> = {
  assessment_required: "Bạn cần có kết quả Đánh giá năng lực trước khi tạo lộ trình.",
  survey_required: "Bạn cần hoàn thành Khảo sát định hướng trong Hồ sơ và bảng điểm trước khi tạo lộ trình.",
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
    case "ai_output_truncated": return "Lộ trình quá dài nên bị cắt giữa chừng.";
    case "invalid_ai_output": return "Nội dung AI soạn chưa đạt yêu cầu kiểm tra nên không được lưu.";
    case "ollama_unavailable": return "Máy AI chưa sẵn sàng.";
    default: return "Đã có lỗi khi soạn lộ trình.";
  }
}

/** The line under the spinner while the AI works, or the reason it waits. */
export function pendingCopy(status: "queued" | "processing", workerState: RoadmapResponse["worker"]): { title: string; text: string } {
  if (status === "processing") return { title: "EduPath AI đang soạn lộ trình…", text: "AI suy nghĩ kỹ trước khi viết nên có thể mất vài phút. Bạn có thể rời trang và quay lại sau." };
  if (!workerState.online) return { title: "Lộ trình sẽ được soạn khi máy AI hoạt động trở lại", text: "Yêu cầu đã được giữ trong hàng đợi; bạn không cần làm gì thêm." };
  if (!workerState.supportsRoadmap) return { title: "Máy AI đang chạy phiên bản cũ…", text: "Lộ trình sẽ được soạn khi máy AI được cập nhật." };
  return { title: "Đang chờ đến lượt…", text: "Yêu cầu của bạn đã vào hàng đợi của EduPath AI." };
}

/** "gemma4:e4b" → "Gemma 4 E4B". */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return "Gemma 4 E4B";
  const match = /^gemma(\d+):e(\d+)b/i.exec(model);
  return match ? `Gemma ${match[1]} E${match[2]}B` : model;
}

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
