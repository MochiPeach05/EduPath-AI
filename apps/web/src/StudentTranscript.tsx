import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type RefObject } from "react";
import { Icon } from "./student-icons";
import TranscriptProgress from "./TranscriptProgress";
import { policyVersion } from "./public-information";
import TranscriptTables, { courseMatcher, transcriptNotes } from "./TranscriptTables";
import type { ConvertibleCourses } from "./convertible-courses";
import { PROFILE_SECTIONS, TRANSCRIPT_UPDATED_EVENT, formatUpdatedAt } from "./student-overview-data";
import { isAdvisorView } from "./advisor-view";
import { decimalText } from "./display-format";
import "./student-records.css";
import "./transcript-import.css";

/** review/printed (2026-10-23): a row saved as printed although something in it did not fit a known form. */
type Course = { ordinal: number; code: string; name: string; credits: number; score10: number | null; score4: number | null; letter: string | null; result: string | null; conditional: boolean; sourcePage: number; review?: string[]; printed?: { credits?: string; score10?: string; score4?: string } };
type Section = { id: string; label: string; academicYear: string | null; semester: string | null; courses: Course[]; summaries: { label: string; value: string | null }[] };
export type Transcript = { version: string; filename: string; fileSize: number; createdAt: string; updatedAt: string; data: { schemaVersion: number; parserVersion: string; pageCount: number; courseCount: number; sections: Section[]; warnings: string[] } };
type ImportJob = { id: string; filename: string; status: "queued" | "processing" | "completed" | "failed" | "cancelled"; errorCode: string | null };
const errors: Record<string, string> = {
  import_pending: "Bạn đang có một bảng điểm chờ xử lý. Hãy đợi hoặc hủy tác vụ trước.", queue_full: "Đang có nhiều bảng điểm chờ xử lý. Vui lòng thử lại sau.",
  worker_timeout: "Bảng điểm chưa xử lý được trong thời gian cho phép. Vui lòng tải lại PDF sau ít phút.", ocr_failed: "Không nhận dạng được bảng điểm. Hãy thử lại với PDF rõ, lưu từ cổng đào tạo.", invalid_ocr_result: "Kết quả nhận dạng chưa hợp lệ. Bảng điểm cũ vẫn được giữ nguyên.",
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
async function read(response: Response, fallback: string): Promise<{ transcript?: Transcript | null; job?: ImportJob | null; workerOnline?: boolean; ocrEnabled?: boolean; convertible?: ConvertibleCourses | null }> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new TranscriptRequestError(errors[data.error] ?? fallback);
  return data;
}
const messageOf = (failure: unknown, fallback: string) => failure instanceof TranscriptRequestError ? failure.message : fallback;

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
 */
export function TranscriptUpdateBar({ transcript, onDelete, dragging, disabled, error, chooseRef, onChoose, onDragging, onFiles }: ImportTarget & { transcript: Transcript; onDelete?: () => void }) {
  const id = useId();
  return <div className={`ti-bar${dragging ? " is-dragging" : ""}`} {...dropHandlers({ disabled, onDragging, onFiles })}>
    <span className="ti-file-icon" aria-hidden="true"><Icon name="document" /></span>
    <div className="ti-bar-text">
      <p className="ti-bar-title">{dragging ? "Thả tệp PDF vào đây để cập nhật bảng điểm"
        : <>Bảng điểm cập nhật lần cuối lúc <time dateTime={transcript.updatedAt}>{formatUpdatedAt(transcript.updatedAt)}</time></>}</p>
      <p className="ti-bar-file">{transcript.filename} · {transcript.data.pageCount} trang · {transcript.data.courseCount} học phần</p>
      <p id={`${id}-hint`} className="ti-bar-hint">Có bảng điểm mới? Kéo thả tệp PDF vào đây, tối đa 5 MB</p>
    </div>
    <div className="ti-bar-actions">
      <button ref={chooseRef} type="button" className="sw-outline" disabled={disabled} aria-describedby={describedBy(id, error)} onClick={onChoose}><Icon name="upload" />Cập nhật bảng điểm</button>
      {onDelete && <button type="button" className="ti-delete" disabled={disabled} onClick={onDelete}><Icon name="trash" />Xóa bảng điểm</button>}
    </div>
    <FileError id={`${id}-error`} error={error} />
  </div>;
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
export default function StudentTranscript() {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [workerOnline, setWorkerOnline] = useState(false);
  // Passed mandatory courses of another specialty (graduation/convertible.ts): marked, counted nowhere.
  const [convertible, setConvertible] = useState<ConvertibleCourses | null>(null);
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
  const confirmBox = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  // Keyboard focus after the next render: the button that was used is gone by then (drop zone, upload, delete).
  const focusNext = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    target?.()?.focus();
  });
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
    try { const data = await read(await fetch("/api/student/transcript", { credentials: "include", signal: pending.signal }), FAILED.load); if (!pending.signal.aborted) { setTranscript(data.transcript ?? null); setJob(data.job ?? null); setWorkerOnline(data.workerOnline ?? false); setConvertible(data.convertible ?? null); setLoaded(true); } }
    catch (e) { if (!pending.signal.aborted) setLoadError(messageOf(e, FAILED.load)); }
    finally { if (!pending.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  useEffect(() => {
    if (!pendingJob) return;
    const pending = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await read(await fetch("/api/student/transcript", { credentials: "include", signal: pending.signal }), FAILED.poll);
        if (!pending.signal.aborted) {
          setJob(data.job ?? null); setWorkerOnline(data.workerOnline ?? false);
          setTranscript(data.transcript ?? null); setConvertible(data.convertible ?? null); setError("");
          // The 100% bar says it was saved (TranscriptProgress); no second message.
          if (data.job?.status === "completed") { setImportCompleted(true); setMessage(""); announceTranscriptUpdated(); }
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
      focusNext.current = () => heading.current;
      await load();
    } catch (e) { setError(messageOf(e, FAILED.cancel)); }
    finally { setBusy(false); }
  };
  const [dragging, setDragging] = useState(false);
  const clearFile = () => { setFile(null); setConfirmed(false); if (input.current) input.current.value = ""; };
  const pick = (selected: File | undefined) => {
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
    pick(files[0]);
  };
  // "Hủy chọn": back to the button that chooses a file (the drop zone's comes back with the zone).
  const cancelChoice = () => { clearFile(); setError(""); focusNext.current = () => chooseButton.current; };
  const upload = async () => {
    if (!file || !confirmed || !loaded || pendingJob) return;
    setImportCompleted(false); setImportAttempt(current => current + 1);
    setBusy(true); setUploading(true); setError(""); setFileError(""); setMessage("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(file.name), "X-Confirm-Own-Transcript": "true", "X-Consent-Policy-Version": policyVersion };
      if (transcript) headers["X-Transcript-Version"] = transcript.version;
      const data = await read(await fetch("/api/student/transcript", { method: "POST", credentials: "include", headers, body: file }), FAILED.upload);
      // Queued: the job box follows (the poll announces the saved transcript); saved at once: the 100% bar says so (one success message).
      if (data.job) setJob(data.job);
      else { setJob(null); setTranscript(data.transcript ?? null); setImportCompleted(true); announceTranscriptUpdated(); }
      clearFile();
      focusNext.current = () => heading.current;
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
  // A cố vấn học tập imports for the student (AD-AST-07) without the student's consent being asked or recorded, and never
  // deletes the transcript (policy 2026-11-03).
  const advisorView = isAdvisorView();
  // The import leads the section (user 2026-11-04): a drop zone until there is a transcript, then a bar above the tables;
  // a chosen PDF waits below them for the confirmation, with a refused upload told there.
  const chosen = loaded ? file : null;
  const showZone = loaded && !transcript && !chosen && !pendingJob;
  const target: ImportTarget = { dragging, disabled: busy || pendingJob, error: fileError, chooseRef: chooseButton, onChoose: () => input.current?.click(), onDragging: setDragging, onFiles: takeFiles };
  return <section className="sw-panel sr-transcript" id={PROFILE_SECTIONS.transcript} aria-labelledby="transcript-title" aria-busy={loading}><div className="sw-section-heading"><div><h2 id="transcript-title" ref={heading} tabIndex={-1}>Bảng điểm của tôi</h2><p className="sw-muted">Import PDF từ cổng đào tạo để theo dõi kết quả học tập.</p></div></div>
    <input ref={input} type="file" accept=".pdf,application/pdf" hidden disabled={busy || pendingJob} onChange={e => pick(e.target.files?.[0])} />
    {loading && <p role="status">Đang tải bảng điểm…</p>}
    {loadError && <div className="sr-error" role="alert">{loadError}<button type="button" disabled={busy || loading} onClick={() => void load()}>Thử lại</button></div>}
    {error && !chosen && <p className="sr-error" role="alert">{error}</p>}
    {message && <p className="sr-success" role="status">{message}</p>}
    {job?.status === "failed" && <div className="sr-error" role="alert">{failedImportMessage(job.errorCode)}</div>}
    {(showZone || (loaded && (transcript || chosen))) && <div className="ti-import">
      {transcript ? <TranscriptUpdateBar {...target} transcript={transcript} onDelete={advisorView ? undefined : () => { setDeleteError(""); setDeleteOpen(true); }} />
        : showZone && <TranscriptDropZone {...target} />}
      {chosen && <div className="ti-pending">
        <div className="ti-pending-file"><span className="ti-file-icon" aria-hidden="true"><Icon name="document" /></span><p className="ti-pending-name"><strong>{chosen.name}</strong><span>{fileSizeText(chosen.size)}</span></p></div>
        {transcript && <p className="ti-pending-note">Bảng điểm mới sẽ thay thế PDF và toàn bộ dữ liệu bảng điểm hiện tại sau khi đọc thành công. Kết quả Đánh giá năng lực, các nhận xét của AI và Lộ trình AI tính từ bảng điểm hiện tại cũng sẽ bị xóa.</p>}
        <label className="sr-confirm"><input ref={confirmBox} type="checkbox" checked={confirmed} disabled={busy || pendingJob} onChange={e => setConfirmed(e.target.checked)} /><span>{advisorView ? "Tôi xác nhận đây là bảng điểm của sinh viên này. Việc import được ghi là do cố vấn học tập thực hiện và sinh viên sẽ nhận thông báo."
          : <>Tôi xác nhận đây là bảng điểm của mình và đồng ý để EduPath AI lưu trữ, xử lý bảng điểm theo <a href="/chinh-sach-va-dieu-khoan#bao-mat-bang-diem" target="_blank" rel="noreferrer">Chính sách bảo mật</a>.</>}</span></label>
        <FileError error={error} />
        <div className="sr-actions sr-form-actions"><button type="button" className="sr-secondary" disabled={busy || pendingJob} onClick={cancelChoice}>Hủy chọn</button><button type="button" className="sw-primary" disabled={busy || pendingJob || !confirmed} onClick={() => void upload()}><Icon name="upload" />{busy ? "Đang đọc và lưu PDF…" : transcript ? "Cập nhật bảng điểm" : "Import bảng điểm"}</button></div>
      </div>}
    </div>}
    {(uploading || pendingJob || importCompleted) && <TranscriptProgress key={importAttempt} stage={uploading ? "uploading" : pendingJob ? job?.status === "queued" ? "queued" : "processing" : "completed"} workerOnline={workerOnline} />}
    {job && pendingJob && <div className="sr-job"><div role="status" aria-live="polite" aria-atomic="true"><strong>{job.status === "queued" ? "Đã nhận PDF · Đang chờ xử lý" : "Đang đọc bảng điểm"}</strong><p>{job.filename}</p><p>{workerOnline ? "Hệ thống đọc chữ trong PDF trước, tự nhận dạng khi cần. Bạn có thể rời trang và quay lại sau." : "Máy xử lý hiện chưa kết nối. PDF đã được giữ trong hàng đợi và sẽ được xử lý khi máy kết nối lại."}</p></div><ol className="sr-job-steps" aria-label="Tiến trình import"><li>1. Đã tải PDF</li><li aria-current="step">2. {job.status === "queued" ? "Chờ đọc bảng điểm" : "Đọc chữ / nhận dạng"}</li><li>3. Lưu kết quả</li></ol><button className="sr-secondary" disabled={busy} onClick={() => void cancelJob()}>Hủy xử lý</button></div>}
    {transcriptWarnings.length > 0 && <div className="sr-review" role="note">{transcriptWarnings.join(" ")}</div>}
    {loaded && transcript && <TranscriptTables key={transcript.version} data={transcript.data} convertible={convertible} />}
    {deleteOpen && <DeleteTranscriptDialog busy={busy} error={deleteError} onClose={() => setDeleteOpen(false)} onConfirm={() => void remove()} />}
  </section>;
}
