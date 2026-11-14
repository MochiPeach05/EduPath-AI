import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode, type RefObject } from "react";
import { Icon } from "./student-icons";
import TranscriptProgress from "./TranscriptProgress";
import { policyVersion } from "./public-information";
import TranscriptTables, { courseMatcher, transcriptNotes } from "./TranscriptTables";
import type { ConvertibleCourses, CountedOtherSpecialty } from "./convertible-courses";
import { PROFILE_SECTIONS, TRANSCRIPT_UPDATED_EVENT, formatUpdatedAt } from "./student-overview-data";
import { isAdvisorView } from "./advisor-view";
import { decimalText } from "./display-format";
import { ActingConfirmDialog } from "./acting-confirm";
import SpecialtyChoice, {
  SpecialtyForm, SpecialtySaveError, initialPick, pickChanges, pickedSpecialty, saveSpecialty, specialtyConfirm, specialtyHint, specialtyText,
  type SpecialtyPick, type SpecialtyProfile,
} from "./SpecialtyChoice";
import "./student-records.css";
import "./transcript-import.css";

/** review/printed (2026-10-23): a row saved as printed although something in it did not fit a known form. */
type Course = { ordinal: number; code: string; name: string; credits: number; score10: number | null; score4: number | null; letter: string | null; result: string | null; conditional: boolean; sourcePage: number; review?: string[]; printed?: { credits?: string; score10?: string; score4?: string } };
type Section = { id: string; label: string; academicYear: string | null; semester: string | null; courses: Course[]; summaries: { label: string; value: string | null }[] };
export type Transcript = { version: string; filename: string; fileSize: number; createdAt: string; updatedAt: string; data: { schemaVersion: number; parserVersion: string; pageCount: number; courseCount: number; sections: Section[]; warnings: string[] } };
type ImportJob = { id: string; filename: string; status: "queued" | "processing" | "completed" | "failed" | "cancelled"; errorCode: string | null };
const errors: Record<string, string> = {
  import_pending: "Bạn đang có một bảng điểm chờ xử lý. Hãy đợi hoặc hủy tác vụ trước.", queue_full: "Đang có nhiều bảng điểm chờ xử lý. Vui lòng thử lại sau.",
  worker_timeout: "Bảng điểm chưa xử lý được trong thời gian cho phép. Vui lòng tải lại PDF sau ít phút.", ocr_failed: "Không nhận dạng được bảng điểm. Hãy thử lại với PDF rõ, lưu từ cổng đào tạo.",
  ocr_busy: "Máy đọc bảng điểm scan đang tạm ngưng nên chưa đọc được PDF này. Bảng điểm cũ vẫn được giữ nguyên. Hãy thử lại sau, hoặc dùng bản PDF xuất trực tiếp từ cổng đào tạo (đọc được ngay).", invalid_ocr_result: "Kết quả nhận dạng chưa hợp lệ. Bảng điểm cũ vẫn được giữ nguyên.",
  invalid_pdf: "Chỉ nhận tệp PDF hợp lệ.", pdf_too_large: "Tệp vượt quá giới hạn 5 MB.",
  unsupported_pdf: "Không đọc được PDF này. Hãy xuất lại PDF từ cổng đào tạo của trường.",
  unsupported_layout: "PDF không khớp bảng điểm 8 cột của trường hoặc không có lớp chữ. Hãy dùng bản PDF xuất từ cổng đào tạo.",
  // The portal's "Xem điểm theo CTĐT" table (OCR worker and API parser: curriculum_view; user 2026-11-05).
  curriculum_view: "EduPath AI không hỗ trợ định dạng “Xem điểm theo CTĐT”. Ở trang Kết quả học tập của cổng đào tạo, hãy chọn “Xem điểm SV” rồi xuất lại bảng điểm ra PDF.",
  scanned_pdf: "PDF không có lớp chữ và dịch vụ nhận dạng chưa được bật. Vui lòng liên hệ quản trị viên.",
  unreadable_rows: "Có dòng học phần chưa đọc đầy đủ. Bảng điểm cũ vẫn được giữ nguyên; hãy xuất lại tệp PDF.",
  unreadable_grades: "Có ô tín chỉ hoặc điểm không đọc được chính xác. Bảng điểm cũ vẫn được giữ nguyên.",
  missing_semester: "Không xác định được học kỳ của một số học phần.", duplicate_rows: "Phát hiện học phần trùng trong cùng học kỳ. Hãy kiểm tra lại PDF.",
  encrypted_pdf: "PDF có mật khẩu. Hãy tải lên bản PDF không khóa.", too_many_pages: "Chỉ hỗ trợ bảng điểm tối đa 20 trang.",
  parse_timeout: "Đọc PDF quá thời gian cho phép. Hãy thử tệp PDF xuất trực tiếp từ cổng đào tạo.",
  parser_busy: "Máy chủ đang đọc một bảng điểm khác. Vui lòng thử lại sau vài giây.",
  transcript_changed: "Bảng điểm đã thay đổi ở phiên khác. Vui lòng tải lại trang trước khi tiếp tục.",
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  database_required: "Chưa kết nối được nơi lưu bảng điểm. Vui lòng thử lại sau.",
  ownership_confirmation_required: "Hãy xác nhận đây là bảng điểm của bạn.",
  consent_required: "Hãy đồng ý để EduPath AI xử lý bảng điểm trước khi import.",
  policy_outdated: "Chính sách bảo mật vừa được cập nhật. Hãy tải lại trang, đọc chính sách mới rồi xác nhận lại.",
  insufficient_role: "Tài khoản hiện không có quyền sinh viên.", invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang."
};
/** What each request says when the API gives no known reason or the network fails. */
const FAILED = {
  load: "Chưa tải được bảng điểm. Vui lòng thử lại.",
  poll: "Chưa cập nhật được trạng thái xử lý. Hệ thống sẽ tự thử lại.",
  upload: "Không import được bảng điểm. Vui lòng thử lại.",
  cancel: "Chưa hủy được tác vụ. Vui lòng thử lại.",
  remove: "Chưa xóa được bảng điểm. Vui lòng thử lại.",
} as const;
/** Why an import job failed, then (once) that the previous transcript is kept. */
export function failedImportMessage(code: string | null): string {
  const reason = errors[code ?? ""] ?? "Không xử lý được bảng điểm. Hãy chọn lại PDF để thử lại.";
  return /giữ nguyên/.test(reason) ? reason : `${reason} Bảng điểm cũ (nếu có) vẫn được giữ nguyên.`;
}
/** Kept here for the callers of this module (TranscriptTables owns it). */
export { courseMatcher };
/** A request the API refused, carrying the message to show; anything else (a network error's own text is English) gets the request's fallback. */
class TranscriptRequestError extends Error {}
async function read(response: Response, fallback: string): Promise<{ transcript?: Transcript | null; job?: ImportJob | null; workerOnline?: boolean; ocrEnabled?: boolean; convertible?: ConvertibleCourses | null; otherSpecialty?: CountedOtherSpecialty | null }> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new TranscriptRequestError(errors[data.error] ?? fallback);
  return data;
}
const messageOf = (failure: unknown, fallback: string) =>
  failure instanceof TranscriptRequestError || failure instanceof SpecialtySaveError ? failure.message : fallback;

/**
 * Sent on window once a transcript is saved (at once or when its import job completes) or deleted on this page:
 * StudentWorkspace refreshes the profile and its steps. Nothing is sent for a refused, failed or cancelled import.
 */
export { TRANSCRIPT_UPDATED_EVENT };
export function announceTranscriptUpdated(): void {
  window.dispatchEvent(new CustomEvent(TRANSCRIPT_UPDATED_EVENT));
}

/** The API takes PDFs up to 5 MB (express.raw limit "5mb", refused as pdf_too_large). */
const MAX_PDF_BYTES = 5 * 1024 * 1024;
/** Why a chosen or dropped file cannot be imported, or "" when it can be sent. */
export function transcriptFileProblem(file: Pick<File, "name" | "size">): string {
  if (!file.name.toLowerCase().endsWith(".pdf")) return `Tệp “${file.name}” không phải PDF. Hãy chọn tệp PDF bảng điểm xuất từ cổng đào tạo.`;
  if (file.size > MAX_PDF_BYTES) return `Tệp “${file.name}” lớn hơn 5 MB. Hãy dùng bản PDF xuất trực tiếp từ cổng đào tạo.`;
  if (!file.size) return `Tệp “${file.name}” rỗng. Hãy chọn lại tệp PDF bảng điểm.`;
  return "";
}
/** "245 KB", "1,5 MB". */
export const fileSizeText = (bytes: number) => bytes < 1000 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${decimalText(bytes / 1024 / 1024, 1)} MB`;

/**
 * What still keeps the first import's button off, in the order the student does things, or "" when it can be sent
 * (plan "Một bước để bắt đầu", 2026-11-14: the specialty, then the PDF, then the confirmation). profileKnown: the profile
 * (its specialty) has loaded; askSpecialty: the API keeps a specialty.
 */
export function firstImportHint({ profileKnown, askSpecialty, pick, file, confirmed }: {
  profileKnown: boolean; askSpecialty: boolean; pick: SpecialtyPick; file: boolean; confirmed: boolean;
}): string {
  if (!profileKnown) return "Đang tải hồ sơ của bạn…";
  if (askSpecialty && !pick) return "Chọn chuyên ngành để import";
  if (!file) return "Chọn tệp PDF để import";
  if (!confirmed) return "Đánh dấu ô xác nhận để import";
  return "";
}

/**
 * The requests of an import, in order: the specialty first when it changes (PATCH /api/student/profile; specialty
 * undefined = unchanged, null = "Chưa có chuyên ngành"), then the PDF (POST /api/student/transcript; version: the transcript
 * it replaces). A refused specialty stops the import before the PDF leaves (SpecialtySaveError); onSpecialtySaved runs as
 * soon as it is stored, even if the PDF is refused afterwards.
 */
export async function sendImport(file: File, { version, specialty, advisorView = false, onSpecialtySaved }: {
  version?: string; specialty?: string | null; advisorView?: boolean; onSpecialtySaved?: (value: string | null) => void;
}) {
  if (specialty !== undefined) {
    await saveSpecialty(specialty, advisorView);
    onSpecialtySaved?.(specialty);
  }
  const headers: Record<string, string> = { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(file.name), "X-Confirm-Own-Transcript": "true", "X-Consent-Policy-Version": policyVersion };
  if (version) headers["X-Transcript-Version"] = version;
  return read(await fetch("/api/student/transcript", { method: "POST", credentials: "include", headers, body: file }), FAILED.upload);
}

/** What the drop zone and the update bar share: both open the file picker and take one dropped PDF. */
type ImportTarget = {
  /** A file is being dragged over the target. */
  dragging: boolean;
  /** An upload, a cancel or a delete is running, or a PDF is being read: nothing can be chosen or dropped. */
  disabled: boolean;
  /** Why the last chosen or dropped file was refused. */
  error: string;
  /** The button that opens the file picker, focused again after "Hủy chọn". */
  chooseRef?: RefObject<HTMLButtonElement | null>;
  onChoose: () => void;
  onDragging: (dragging: boolean) => void;
  onFiles: (files: FileList) => void;
};
/** Files only: a dragged text or link is not taken (and does not light the target up). */
const carriesFiles = (event: ReactDragEvent) => Array.from(event.dataTransfer.types).includes("Files");
function dropHandlers({ disabled, onDragging, onFiles }: Pick<ImportTarget, "disabled" | "onDragging" | "onFiles">) {
  const over = (event: ReactDragEvent<HTMLElement>) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    if (!disabled) onDragging(true);
  };
  return {
    onDragEnter: over,
    onDragOver: over,
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragging(false); },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      onDragging(false);
      if (!disabled) onFiles(event.dataTransfer.files);
    },
  };
}
const describedBy = (id: string, error: string) => `${id}-hint${error ? ` ${id}-error` : ""}`;
function FileError({ id, error }: { id?: string; error: string }) {
  return error ? <p id={id} className="ti-file-error" role="alert"><Icon name="info" />{error}</p> : null;
}

/** No transcript yet: a large drop zone at the top of the section. A click anywhere in it opens the file picker too. */
export function TranscriptDropZone({ dragging, disabled, error, chooseRef, onChoose, onDragging, onFiles }: ImportTarget) {
  const id = useId();
  return <div className={`ti-zone${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
    onClick={event => { if (!disabled && !(event.target as Element).closest("button, a")) onChoose(); }}
    {...dropHandlers({ disabled, onDragging, onFiles })}>
    <span className="ti-zone-icon" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 16V6h24l12 12v20" /><path d="M42 6v12h12" /><path d="M18 30v28h22" /><rect x="8" y="16" width="26" height="14" rx="2" /><text x="21" y="26.5" fill="currentColor" stroke="none" fontSize="9" fontWeight="700" textAnchor="middle" fontFamily="inherit">PDF</text><path d="M26 40h12M26 47h8" /><path d="M50 60V44M44 50l6-6 6 6" /></svg></span>
    <p className="ti-zone-title">{dragging ? "Thả tệp PDF vào đây" : "Kéo thả tệp PDF bảng điểm vào đây"}</p>
    <p className="ti-zone-or">hoặc</p>
    <button ref={chooseRef} type="button" className="sw-primary" disabled={disabled} aria-describedby={describedBy(id, error)} onClick={onChoose}><Icon name="upload" />Chọn tệp PDF</button>
    <p id={`${id}-hint`} className="ti-hint">PDF xuất từ cổng đào tạo của trường, tối đa 5 MB</p>
    <FileError id={`${id}-error`} error={error} />
  </div>;
}

/**
 * A transcript: a bar at the top of the section with the last update and the file, "Cập nhật bảng điểm" and, for the
 * student only (no `onDelete` for an advisor), "Xóa bảng điểm". A PDF dropped on the bar is taken as a new transcript.
 * specialty: the line "Chuyên ngành: … Đổi" under the file (2026-11-14); below: what opens under the bar (the specialty's
 * choice once Đổi is pressed).
 */
export function TranscriptUpdateBar({ transcript, onDelete, specialty, below, dragging, disabled, error, chooseRef, onChoose, onDragging, onFiles }: ImportTarget & {
  transcript: Transcript; onDelete?: () => void; specialty?: ReactNode; below?: ReactNode;
}) {
  const id = useId();
  return <div className={`ti-bar${dragging ? " is-dragging" : ""}`} {...dropHandlers({ disabled, onDragging, onFiles })}>
    <span className="ti-file-icon" aria-hidden="true"><Icon name="document" /></span>
    <div className="ti-bar-text">
      <p className="ti-bar-title">{dragging ? "Thả tệp PDF vào đây để cập nhật bảng điểm"
        : <>Bảng điểm cập nhật lần cuối lúc <time dateTime={transcript.updatedAt}>{formatUpdatedAt(transcript.updatedAt)}</time></>}</p>
      <p className="ti-bar-file">{transcript.filename} · {transcript.data.pageCount} trang · {transcript.data.courseCount} học phần</p>
      <p id={`${id}-hint`} className="ti-bar-hint">Có bảng điểm mới? Kéo thả tệp PDF vào đây, tối đa 5 MB</p>
      {specialty}
    </div>
    <div className="ti-bar-actions">
      <button ref={chooseRef} type="button" className="sw-outline" disabled={disabled} aria-describedby={describedBy(id, error)} onClick={onChoose}><Icon name="upload" />Cập nhật bảng điểm</button>
      {onDelete && <button type="button" className="ti-delete" disabled={disabled} onClick={onDelete}><Icon name="trash" />Xóa bảng điểm</button>}
    </div>
    <FileError id={`${id}-error`} error={error} />
    {below && <div className="ti-bar-below">{below}</div>}
  </div>;
}

/** The PDF chosen for the first import: its name and size, and "Hủy chọn". */
function ChosenFile({ file, disabled, onCancel }: { file: File; disabled: boolean; onCancel: () => void }) {
  return <div className="ti-chosen">
    <span className="ti-file-icon" aria-hidden="true"><Icon name="document" /></span>
    <p className="ti-pending-name"><strong>{file.name}</strong><span>{fileSizeText(file.size)}</span></p>
    <button type="button" className="sr-secondary ti-chosen-cancel" disabled={disabled} onClick={onCancel}>Hủy chọn</button>
  </div>;
}

/** A PDF waiting for the worker or being read: what happens and "Hủy xử lý". */
function ImportJobBox({ job, workerOnline, busy, onCancel }: { job: ImportJob; workerOnline: boolean; busy: boolean; onCancel: () => void }) {
  return <div className="sr-job"><div role="status" aria-live="polite" aria-atomic="true"><strong>{job.status === "queued" ? "Đã nhận PDF · Đang chờ xử lý" : "Đang đọc bảng điểm"}</strong><p>{job.filename}</p><p>{workerOnline ? "Hệ thống đọc chữ trong PDF trước, tự nhận dạng khi cần. Bạn có thể rời trang và quay lại sau." : "Máy xử lý hiện chưa kết nối. PDF đã được giữ trong hàng đợi và sẽ được xử lý khi máy kết nối lại."}</p></div><ol className="sr-job-steps" aria-label="Tiến trình import"><li>1. Đã tải PDF</li><li aria-current="step">2. {job.status === "queued" ? "Chờ đọc bảng điểm" : "Đọc chữ / nhận dạng"}</li><li>3. Lưu kết quả</li></ol><button className="sr-secondary" disabled={busy} onClick={onCancel}>Hủy xử lý</button></div>;
}

function DeleteTranscriptDialog({ busy, error, onClose, onConfirm }: {
  busy: boolean; error: string; onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="sr-confirm-dialog" aria-labelledby="delete-transcript-title" aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="delete-transcript-title">Xóa bảng điểm</h2>
    <p>Xóa PDF và toàn bộ dữ liệu bảng điểm đã import? Kết quả Đánh giá năng lực, các nhận xét của AI và Lộ trình AI tính từ bảng điểm này cũng sẽ bị xóa. Thông tin cá nhân của bạn vẫn được giữ lại.</p>
    {error && <p className="sr-error" role="alert">{error}</p>}
    <div className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" disabled={busy} onClick={onClose} autoFocus>Hủy</button>
      <button type="button" className="sw-primary sr-delete-confirm" disabled={busy} onClick={onConfirm}>{busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
    </div>
  </dialog>;
}

/**
 * "Bảng điểm của tôi". The first import has two steps (GVHD 2026-11-13, plan "Một bước để bắt đầu", user 2026-11-14): the
 * specialty, then the PDF; the specialty is saved (PATCH /api/student/profile) before the PDF is sent, and is the only thing
 * EduPath AI asks before its pages work. With a transcript, the bar names the specialty, which "Đổi" changes on its own.
 *
 * mode "profile": the section of Hồ sơ và bảng điểm (the bar, the tables). mode "start": the short import of Tổng quan and of
 * Xét tốt nghiệp before the first transcript (a select, no tables); onImported tells the page to read its data again.
 * profile: the specialty, cohort and major the choice needs; null while the profile loads.
 */
export default function StudentTranscript({ profile = null, mode = "profile", submitLabel, onImported, onProfileChanged }: {
  profile?: SpecialtyProfile | null;
  mode?: "profile" | "start";
  /** The import button of mode "start" (Xét tốt nghiệp: "Import và xét tốt nghiệp"). */
  submitLabel?: string;
  /** A transcript was saved (at once or when its import job completed), or mode "start" found one already. */
  onImported?: () => void;
  /** The specialty was saved: the page reads the profile again. */
  onProfileChanged?: () => void;
}) {
  const start = mode === "start";
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [workerOnline, setWorkerOnline] = useState(false);
  // Passed courses of another specialty (graduation/convertible.ts): counted in the specialty electives group (otherSpecialty,
  // 2026-11-14) or, without such a group, counted nowhere (convertible); both are marked.
  const [convertible, setConvertible] = useState<ConvertibleCourses | null>(null);
  const [otherSpecialty, setOtherSpecialty] = useState<CountedOtherSpecialty | null>(null);
  const pendingJob = job?.status === "queued" || job?.status === "processing";
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importCompleted, setImportCompleted] = useState(false);
  const [importAttempt, setImportAttempt] = useState(0);
  // A failed load offers Thử lại; a refused action (an upload, a cancel) only says why; a refused file is told in the drop zone or the bar.
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [message, setMessage] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const startBox = useRef<HTMLDivElement>(null);
  const confirmBox = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const specialtyButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const hintId = useId();
  // The page's callbacks, read by the requests (which outlive renders).
  const imported = useRef(onImported);
  imported.current = onImported;
  // Keyboard focus after the next render: the button that was used is gone by then (drop zone, upload, delete).
  const focusNext = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    target?.()?.focus();
  });
  // The top of what this component draws: the section's heading, or the short import's box.
  const top = () => (start ? startBox.current : heading.current);

  // Chuyên ngành. The choice starts from the profile and follows it until the student changes it.
  const profileKnown = profile !== null;
  const askSpecialty = profileKnown && profile.specialty !== undefined;
  const [pick, setPick] = useState<SpecialtyPick>(() => initialPick(profile?.specialty));
  const pickTouched = useRef(false);
  useEffect(() => { if (!pickTouched.current) setPick(initialPick(profile?.specialty)); }, [profile?.specialty]);
  const choosePick = (value: SpecialtyPick) => { pickTouched.current = true; setPick(value); setError(""); };
  // The specialty just saved, shown until the profile read again has it.
  const [savedSpecialty, setSavedSpecialty] = useState<{ value: string | null } | null>(null);
  useEffect(() => setSavedSpecialty(null), [profile?.specialty]);
  const shownSpecialty = savedSpecialty ? savedSpecialty.value : profile?.specialty ?? null;
  const [editingSpecialty, setEditingSpecialty] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);

  // A PDF dropped beside the zone or the bar would open in the tab and leave the page: there, a dropped file does nothing.
  useEffect(() => {
    const guard = (event: WindowEventMap["dragover"]) => {
      if (event.defaultPrevented || !event.dataTransfer || !Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      if (event.type === "dragover") event.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => { window.removeEventListener("dragover", guard); window.removeEventListener("drop", guard); };
  }, []);
  const load = useCallback(async () => {
    controller.current?.abort(); const pending = new AbortController(); controller.current = pending;
    setLoading(true); setLoadError(""); setLoaded(false);
    try {
      const data = await read(await fetch("/api/student/transcript", { credentials: "include", signal: pending.signal }), FAILED.load);
      if (!pending.signal.aborted) {
        setTranscript(data.transcript ?? null); setJob(data.job ?? null); setWorkerOnline(data.workerOnline ?? false); setConvertible(data.convertible ?? null); setOtherSpecialty(data.otherSpecialty ?? null); setLoaded(true);
        // The short import of a page that thought there was none: the page reads its data again.
        if (start && data.transcript) imported.current?.();
      }
    }
    catch (e) { if (!pending.signal.aborted) setLoadError(messageOf(e, FAILED.load)); }
    finally { if (!pending.signal.aborted) setLoading(false); }
  }, [start]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  useEffect(() => {
    if (!pendingJob) return;
    const pending = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await read(await fetch("/api/student/transcript", { credentials: "include", signal: pending.signal }), FAILED.poll);
        if (!pending.signal.aborted) {
          setJob(data.job ?? null); setWorkerOnline(data.workerOnline ?? false);
          setTranscript(data.transcript ?? null); setConvertible(data.convertible ?? null); setOtherSpecialty(data.otherSpecialty ?? null); setError("");
          // The 100% bar says it was saved (TranscriptProgress); no second message.
          if (data.job?.status === "completed") { setImportCompleted(true); setMessage(""); announceTranscriptUpdated(); imported.current?.(); }
        }
      } catch (e) { if (!pending.signal.aborted) setError(messageOf(e, FAILED.poll)); }
      finally { if (!pending.signal.aborted) timer = setTimeout(() => void poll(), 2000); }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { pending.abort(); clearTimeout(timer); };
  }, [pendingJob, job?.id]);
  const cancelJob = async () => {
    if (!job) return;
    setBusy(true); setError("");
    try {
      await read(await fetch("/api/student/transcript/job", { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: job.id }) }), FAILED.cancel);
      focusNext.current = top;
      await load();
    } catch (e) { setError(messageOf(e, FAILED.cancel)); }
    finally { setBusy(false); }
  };
  const [dragging, setDragging] = useState(false);
  const clearFile = () => { setFile(null); setConfirmed(false); if (input.current) input.current.value = ""; };
  const pickFile = (selected: File | undefined) => {
    setImportCompleted(false);
    setError(""); setFileError(""); setMessage(""); setConfirmed(false);
    if (!selected) { setFile(null); return; }
    const problem = transcriptFileProblem(selected);
    if (problem) { setFileError(problem); clearFile(); return; }
    setFile(selected);
    // Next step: the confirmation (the drop zone that was used is gone).
    focusNext.current = () => confirmBox.current;
  };
  const takeFiles = (files: FileList) => {
    if (files.length !== 1) { setFileError(files.length ? "Chỉ kéo thả một tệp PDF mỗi lần." : "Không nhận được tệp. Hãy kéo thả tệp PDF từ máy của bạn."); return; }
    pickFile(files[0]);
  };
  // "Hủy chọn": back to the button that chooses a file (the drop zone's comes back with the zone).
  const cancelChoice = () => { clearFile(); setError(""); focusNext.current = () => chooseButton.current; };
  // A cố vấn học tập or a Khoa admin imports for the student (AD-AST-07) without the student's consent being asked or
  // recorded, never deletes the transcript (policy 2026-11-03), and confirms a specialty changed for the student.
  const advisorView = isAdvisorView();
  /** actingConfirmed: a cố vấn học tập or a Khoa admin has confirmed the specialty changed with this import. */
  const upload = async (actingConfirmed = false) => {
    if (!file || !confirmed || !loaded || pendingJob) return;
    // The first import: the specialty first (a choice is needed when the API keeps one), saved before the PDF is sent.
    const first = !transcript;
    if (first && (!profileKnown || (askSpecialty && !pick))) return;
    const specialtyChange = first && askSpecialty && pickChanges(pick, profile?.specialty);
    if (specialtyChange && advisorView && !actingConfirmed) { setConfirmingImport(true); return; }
    setImportCompleted(false); setImportAttempt(current => current + 1);
    setBusy(true); setUploading(true); setError(""); setFileError(""); setMessage("");
    try {
      const data = await sendImport(file, {
        version: transcript?.version, specialty: specialtyChange ? pickedSpecialty(pick) : undefined, advisorView,
        onSpecialtySaved: (value) => { setSavedSpecialty({ value }); onProfileChanged?.(); },
      });
      // Queued: the job box follows (the poll announces the saved transcript); saved at once: the 100% bar says so (one success message).
      if (data.job) setJob(data.job);
      else { setJob(null); setTranscript(data.transcript ?? null); setImportCompleted(true); announceTranscriptUpdated(); imported.current?.(); }
      clearFile();
      focusNext.current = top;
    } catch (e) { setError(messageOf(e, FAILED.upload)); }
    finally { setBusy(false); setUploading(false); }
  };
  const remove = async () => {
    if (!transcript || busy || pendingJob) return;
    setBusy(true); setDeleteError(""); setError(""); setFileError(""); setMessage("");
    try {
      await read(await fetch("/api/student/transcript", { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: transcript.version, confirmed: true }) }), FAILED.remove);
      setDeleteOpen(false); setTranscript(null); setImportCompleted(false); clearFile(); setMessage("Đã xóa PDF và dữ liệu bảng điểm.");
      announceTranscriptUpdated();
      // The delete button went with the transcript: back to the heading, the message just below it.
      focusNext.current = () => heading.current;
    }
    catch (e) { setDeleteError(messageOf(e, FAILED.remove)); }
    finally { setBusy(false); }
  };
  const transcriptWarnings = transcript ? transcriptNotes(transcript.data) : [];
  // The import leads the section (user 2026-11-04): two steps until there is a transcript, then a bar above the tables; a
  // PDF chosen for an update waits below the bar for the confirmation, with a refused upload told there.
  const chosen = loaded ? file : null;
  const firstForm = loaded && !transcript && !pendingJob;
  const target: ImportTarget = { dragging, disabled: busy || pendingJob, error: fileError, chooseRef: chooseButton, onChoose: () => input.current?.click(), onDragging: setDragging, onFiles: takeFiles };
  const firstHint = firstImportHint({ profileKnown, askSpecialty, pick, file: Boolean(chosen), confirmed });
  const consent = <label className="sr-confirm"><input ref={confirmBox} type="checkbox" checked={confirmed} disabled={busy || pendingJob} onChange={e => setConfirmed(e.target.checked)} /><span>{advisorView ? "Tôi xác nhận đây là bảng điểm của sinh viên này. Việc import được ghi là do cố vấn học tập thực hiện và sinh viên sẽ nhận thông báo."
    : <>Tôi xác nhận đây là bảng điểm của mình và đồng ý để EduPath AI lưu trữ, xử lý bảng điểm theo <a href="/chinh-sach-va-dieu-khoan#bao-mat-bang-diem" target="_blank" rel="noreferrer">Chính sách bảo mật</a>.</>}</span></label>;
  const importButton = (label: string) => <button type="button" className="sw-primary" disabled={busy || pendingJob || Boolean(firstHint)}
    aria-describedby={firstHint ? hintId : undefined} onClick={() => void upload()}><Icon name="upload" />{busy ? "Đang đọc và lưu PDF…" : label}</button>;
  const progress = (uploading || pendingJob || importCompleted) && <TranscriptProgress key={importAttempt} stage={uploading ? "uploading" : pendingJob ? job?.status === "queued" ? "queued" : "processing" : "completed"} workerOnline={workerOnline} />;
  const jobBox = job && pendingJob && <ImportJobBox job={job} workerOnline={workerOnline} busy={busy} onCancel={() => void cancelJob()} />;
  const actingDialog = confirmingImport && <ActingConfirmDialog {...specialtyConfirm(pick, "Đổi chuyên ngành và import")} onClose={() => setConfirmingImport(false)}
    onConfirm={() => { setConfirmingImport(false); void upload(true); }} />;

  if (start) {
    // A transcript saved here: only its 100% bar, until the page has read its data again.
    if (loaded && transcript) return importCompleted ? <div className="ti-start" ref={startBox} tabIndex={-1}>{progress}</div> : null;
    return <div className={`ti-start${dragging && !chosen ? " is-dragging" : ""}`} ref={startBox} tabIndex={-1} aria-busy={loading}
      {...(chosen || pendingJob ? {} : dropHandlers({ disabled: busy || !loaded, onDragging: setDragging, onFiles: takeFiles }))}>
      <input ref={input} type="file" accept=".pdf,application/pdf" hidden disabled={busy || pendingJob} onChange={e => pickFile(e.target.files?.[0])} />
      {loadError && <div className="sr-error" role="alert">{loadError}<button type="button" disabled={busy || loading} onClick={() => void load()}>Thử lại</button></div>}
      {message && <p className="sr-success" role="status">{message}</p>}
      {job?.status === "failed" && <div className="sr-error" role="alert">{failedImportMessage(job.errorCode)}</div>}
      {!pendingJob && <div className="ti-start-form">
        <div className="ti-start-fields">
          {!profileKnown ? <p className="ti-start-loading" role="status">Đang tải hồ sơ của bạn…</p>
            : askSpecialty && <SpecialtyChoice variant="select" profile={profile} value={pick} onChange={choosePick} disabled={busy} hint={false} />}
          <div className="ti-start-file">
            <span className="spc-label">Bảng điểm PDF<span className="spc-required" aria-hidden="true"> *</span></span>
            {chosen ? <ChosenFile file={chosen} disabled={busy} onCancel={cancelChoice} />
              : <button ref={chooseButton} type="button" className="sw-outline ti-start-choose" disabled={busy || !loaded} aria-describedby={`${hintId}-file`} onClick={() => input.current?.click()}><Icon name="upload" />Chọn tệp PDF bảng điểm</button>}
            <small id={`${hintId}-file`} className="ti-start-hint">{dragging && !chosen ? "Thả tệp PDF vào đây" : "PDF xuất từ cổng đào tạo của trường, tối đa 5 MB"}</small>
          </div>
        </div>
        {askSpecialty && <small className="ti-start-hint">{specialtyHint(profile?.cohortCode)}</small>}
        <FileError error={fileError} />
        {chosen && consent}
        <FileError error={error} />
        {chosen && <div className="ti-actions">
          {firstHint && <span id={hintId} className="ti-action-hint">{firstHint}</span>}
          {importButton(submitLabel ?? "Import bảng điểm")}
        </div>}
      </div>}
      {progress}
      {jobBox}
      {actingDialog}
    </div>;
  }

  // With a transcript, the specialty's line under the file, or its choice once Đổi is pressed.
  const specialtyLine = askSpecialty && !editingSpecialty ? <p className="ti-bar-spec">Chuyên ngành: <strong>{specialtyText(shownSpecialty)}</strong>
    <button ref={specialtyButton} type="button" className="sw-text-link" disabled={busy || pendingJob} onClick={() => { setEditingSpecialty(true); setMessage(""); }}>{shownSpecialty ? "Đổi" : "Chọn chuyên ngành"}</button></p> : null;
  const specialtyEditor = askSpecialty && editingSpecialty ? <SpecialtyForm profile={{ ...profile, specialty: shownSpecialty }} focusOnMount
    onSaved={(value) => {
      setSavedSpecialty({ value }); setEditingSpecialty(false);
      setMessage(advisorView ? "Đã lưu chuyên ngành của sinh viên." : "Đã lưu chuyên ngành.");
      focusNext.current = () => specialtyButton.current;
      onProfileChanged?.();
    }}
    onCancel={() => { setEditingSpecialty(false); focusNext.current = () => specialtyButton.current; }} /> : null;
  return <section className="sw-panel sr-transcript" id={PROFILE_SECTIONS.transcript} aria-labelledby="transcript-title" aria-busy={loading}><div className="sw-section-heading"><div><h2 id="transcript-title" ref={heading} tabIndex={-1}>Bảng điểm của tôi</h2><p className="sw-muted">{firstForm ? "Chọn chuyên ngành rồi import PDF bảng điểm từ cổng đào tạo." : "Import PDF từ cổng đào tạo để theo dõi kết quả học tập."}</p></div></div>
    <input ref={input} type="file" accept=".pdf,application/pdf" hidden disabled={busy || pendingJob} onChange={e => pickFile(e.target.files?.[0])} />
    {loading && <p role="status">Đang tải bảng điểm…</p>}
    {loadError && <div className="sr-error" role="alert">{loadError}<button type="button" disabled={busy || loading} onClick={() => void load()}>Thử lại</button></div>}
    {error && !chosen && !firstForm && <p className="sr-error" role="alert">{error}</p>}
    {message && <p className="sr-success" role="status">{message}</p>}
    {job?.status === "failed" && <div className="sr-error" role="alert">{failedImportMessage(job.errorCode)}</div>}
    {firstForm && <div className="ti-import ti-first">
      <ol className="ti-steps">
        {(!profileKnown || askSpecialty) && <li className="ti-step">
          <span className="ti-step-n" aria-hidden="true">1</span>
          <div className="ti-step-body">{profileKnown
            ? <SpecialtyChoice profile={profile} value={pick} onChange={choosePick} disabled={busy} />
            : <p className="ti-step-loading" role="status">Đang tải hồ sơ của bạn…</p>}</div>
        </li>}
        <li className="ti-step">
          <span className="ti-step-n" aria-hidden="true">{!profileKnown || askSpecialty ? 2 : 1}</span>
          <div className="ti-step-body">
            <p className="ti-step-title">Bảng điểm PDF<span className="spc-required" aria-hidden="true"> *</span></p>
            {chosen ? <ChosenFile file={chosen} disabled={busy} onCancel={cancelChoice} /> : <TranscriptDropZone {...target} />}
          </div>
        </li>
      </ol>
      {chosen && consent}
      <FileError error={error} />
      <div className="ti-actions">
        {firstHint && <span id={hintId} className="ti-action-hint">{firstHint}</span>}
        {importButton("Import bảng điểm")}
      </div>
    </div>}
    {loaded && transcript && <div className="ti-import">
      <TranscriptUpdateBar {...target} transcript={transcript} onDelete={advisorView ? undefined : () => { setDeleteError(""); setDeleteOpen(true); }}
        specialty={specialtyLine} below={specialtyEditor} />
      {chosen && <div className="ti-pending">
        <div className="ti-pending-file"><span className="ti-file-icon" aria-hidden="true"><Icon name="document" /></span><p className="ti-pending-name"><strong>{chosen.name}</strong><span>{fileSizeText(chosen.size)}</span></p></div>
        <p className="ti-pending-note">Bảng điểm mới sẽ thay thế PDF và toàn bộ dữ liệu bảng điểm hiện tại sau khi đọc thành công. Kết quả Đánh giá năng lực, các nhận xét của AI và Lộ trình AI tính từ bảng điểm hiện tại cũng sẽ bị xóa.</p>
        {consent}
        <FileError error={error} />
        <div className="sr-actions sr-form-actions"><button type="button" className="sr-secondary" disabled={busy || pendingJob} onClick={cancelChoice}>Hủy chọn</button><button type="button" className="sw-primary" disabled={busy || pendingJob || !confirmed} onClick={() => void upload()}><Icon name="upload" />{busy ? "Đang đọc và lưu PDF…" : "Cập nhật bảng điểm"}</button></div>
      </div>}
    </div>}
    {progress}
    {jobBox}
    {transcriptWarnings.length > 0 && <div className="sr-review" role="note">{transcriptWarnings.join(" ")}</div>}
    {loaded && transcript && <TranscriptTables key={transcript.version} data={transcript.data} convertible={convertible} otherSpecialty={otherSpecialty} />}
    {deleteOpen && <DeleteTranscriptDialog busy={busy} error={deleteError} onClose={() => setDeleteOpen(false)} onConfirm={() => void remove()} />}
    {actingDialog}
  </section>;
}
