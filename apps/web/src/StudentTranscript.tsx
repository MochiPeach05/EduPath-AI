import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { Icon } from "./student-icons";
import TranscriptProgress from "./TranscriptProgress";
import { policyVersion } from "./public-information";
import TranscriptTables, { courseMatcher, transcriptNotes } from "./TranscriptTables";
import { PROFILE_SECTIONS, formatUpdatedAt } from "./student-overview-data";
import "./student-records.css";

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
async function read(response: Response, fallback: string): Promise<{ transcript?: Transcript | null; job?: ImportJob | null; workerOnline?: boolean; ocrEnabled?: boolean }> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new TranscriptRequestError(errors[data.error] ?? fallback);
  return data;
}
const messageOf = (failure: unknown, fallback: string) => failure instanceof TranscriptRequestError ? failure.message : fallback;
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
  const pendingJob = job?.status === "queued" || job?.status === "processing";
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importCompleted, setImportCompleted] = useState(false);
  const [importAttempt, setImportAttempt] = useState(0);
  // A failed load offers Thử lại; a refused action (a wrong file, an upload, a cancel) only says why.
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmBox = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  // Keyboard focus after the next render: the button that was used is gone by then (drop zone, upload, delete).
  const focusNext = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    target?.()?.focus();
  });
  const load = useCallback(async () => {
    controller.current?.abort(); const pending = new AbortController(); controller.current = pending;
    setLoading(true); setLoadError(""); setLoaded(false);
    try { const data = await read(await fetch("/api/student/transcript", { credentials: "include", signal: pending.signal }), FAILED.load); if (!pending.signal.aborted) { setTranscript(data.transcript ?? null); setJob(data.job ?? null); setWorkerOnline(data.workerOnline ?? false); setLoaded(true); } }
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
          setTranscript(data.transcript ?? null); setError("");
          // The 100% bar says it was saved (TranscriptProgress); no second message.
          if (data.job?.status === "completed") { setImportCompleted(true); setMessage(""); }
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
    setError(""); setMessage(""); setConfirmed(false);
    if (!selected) { setFile(null); return; }
    if (!selected.name.toLowerCase().endsWith(".pdf") || selected.size > 5 * 1024 * 1024 || !selected.size) { setError("Chọn tệp PDF không rỗng, tối đa 5 MB."); clearFile(); return; }
    setFile(selected);
    // Next step: the confirmation (the drop zone that was used is gone).
    focusNext.current = () => confirmBox.current;
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false);
    if (busy || pendingJob) return;
    const files = e.dataTransfer.files;
    if (files.length > 1) { setError("Chỉ kéo thả một tệp PDF mỗi lần."); return; }
    pick(files[0]);
  };
  const upload = async () => {
    if (!file || !confirmed || !loaded || pendingJob) return;
    setImportCompleted(false); setImportAttempt(current => current + 1);
    setBusy(true); setUploading(true); setError(""); setMessage("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(file.name), "X-Confirm-Own-Transcript": "true", "X-Consent-Policy-Version": policyVersion };
      if (transcript) headers["X-Transcript-Version"] = transcript.version;
      const data = await read(await fetch("/api/student/transcript", { method: "POST", credentials: "include", headers, body: file }), FAILED.upload);
      // Queued: the job box follows; saved at once: the 100% bar says so (one success message).
      if (data.job) setJob(data.job);
      else { setJob(null); setTranscript(data.transcript ?? null); setImportCompleted(true); }
      clearFile();
      focusNext.current = () => heading.current;
    } catch (e) { setError(messageOf(e, FAILED.upload)); }
    finally { setBusy(false); setUploading(false); }
  };
  const remove = async () => {
    if (!transcript || busy || pendingJob) return;
    setBusy(true); setDeleteError(""); setError(""); setMessage("");
    try {
      await read(await fetch("/api/student/transcript", { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: transcript.version, confirmed: true }) }), FAILED.remove);
      setDeleteOpen(false); setTranscript(null); setImportCompleted(false); clearFile(); setMessage("Đã xóa PDF và dữ liệu bảng điểm.");
      // The delete button went with the transcript: back to the heading, the message just below it.
      focusNext.current = () => heading.current;
    }
    catch (e) { setDeleteError(messageOf(e, FAILED.remove)); }
    finally { setBusy(false); }
  };
  const transcriptWarnings = transcript ? transcriptNotes(transcript.data) : [];
  return <section className="sw-panel sr-transcript" id={PROFILE_SECTIONS.transcript} aria-labelledby="transcript-title" aria-busy={loading}><div className="sw-section-heading"><div><h2 id="transcript-title" ref={heading} tabIndex={-1}>Bảng điểm của tôi</h2><p className="sw-muted">Import PDF từ cổng đào tạo để theo dõi kết quả học tập.</p></div><span className="sw-tag">PDF · tối đa 5 MB</span></div>
    {loading && <p role="status">Đang tải bảng điểm…</p>}
    {loadError && <div className="sr-error" role="alert">{loadError}<button type="button" disabled={busy || loading} onClick={() => void load()}>Thử lại</button></div>}
    {error && <p className="sr-error" role="alert">{error}</p>}
    {message && <p className="sr-success" role="status">{message}</p>}
    {(uploading || pendingJob || importCompleted) && <TranscriptProgress key={importAttempt} stage={uploading ? "uploading" : pendingJob ? job?.status === "queued" ? "queued" : "processing" : "completed"} workerOnline={workerOnline} />}
    {job && pendingJob && <div className="sr-job"><div role="status" aria-live="polite" aria-atomic="true"><strong>{job.status === "queued" ? "Đã nhận PDF · Đang chờ xử lý" : "Đang đọc bảng điểm"}</strong><p>{job.filename}</p><p>{workerOnline ? "Hệ thống đọc chữ trong PDF trước, tự nhận dạng khi cần. Bạn có thể rời trang và quay lại sau." : "Máy xử lý hiện chưa kết nối. PDF đã được giữ trong hàng đợi và sẽ được xử lý khi máy kết nối lại."}</p></div><ol className="sr-job-steps" aria-label="Tiến trình import"><li>1. Đã tải PDF</li><li aria-current="step">2. {job.status === "queued" ? "Chờ đọc bảng điểm" : "Đọc chữ / nhận dạng"}</li><li>3. Lưu kết quả</li></ol><button className="sr-secondary" disabled={busy} onClick={() => void cancelJob()}>Hủy xử lý</button></div>}
    {job?.status === "failed" && <div className="sr-error" role="alert">{failedImportMessage(job.errorCode)}</div>}
    {transcriptWarnings.length > 0 && <div className="sr-review" role="note">{transcriptWarnings.join(" ")}</div>}
    {loaded && <>{transcript && <div className="sr-upload"><div><strong>Cập nhật bảng điểm mới</strong><p>Dùng PDF rõ, lưu từ cổng đào tạo. Hệ thống đọc chữ trước, tự nhận dạng khi cần.</p></div><button type="button" className="sr-secondary sr-upload-button" disabled={busy || pendingJob} onClick={() => input.current?.click()}><Icon name="upload" />Chọn tệp PDF</button><input ref={input} type="file" accept=".pdf,application/pdf" hidden disabled={busy || pendingJob} onChange={e => pick(e.target.files?.[0])} /></div>}
      {file && <div className="sr-pending"><p><strong>{file.name}</strong> · {(file.size / 1024).toFixed(0)} KB</p>{transcript && <p>Bảng điểm mới sẽ thay thế PDF và toàn bộ dữ liệu bảng điểm hiện tại sau khi đọc thành công. Kết quả Đánh giá năng lực, các nhận xét của AI và Lộ trình AI tính từ bảng điểm hiện tại cũng sẽ bị xóa.</p>}<label className="sr-confirm"><input ref={confirmBox} type="checkbox" checked={confirmed} disabled={busy || pendingJob} onChange={e => setConfirmed(e.target.checked)} /><span>Tôi xác nhận đây là bảng điểm của mình và đồng ý để EduPath AI lưu trữ, xử lý bảng điểm theo <a href="/chinh-sach-va-dieu-khoan#bao-mat-bang-diem" target="_blank" rel="noreferrer">Chính sách bảo mật</a>.</span></label><div className="sr-actions sr-form-actions"><button type="button" className="sr-secondary" disabled={busy || pendingJob} onClick={clearFile}>Hủy chọn</button><button type="button" className="sw-primary" disabled={busy || pendingJob || !confirmed} onClick={() => void upload()}><Icon name="upload" />{busy ? "Đang đọc và lưu PDF…" : transcript ? "Cập nhật bảng điểm" : "Import bảng điểm"}</button></div></div>}
      {transcript ? <><div className="sr-file-info"><div><strong>{transcript.filename}</strong><p>{transcript.data.pageCount} trang · {transcript.data.courseCount} học phần · Cập nhật lúc {formatUpdatedAt(transcript.updatedAt)}</p></div><div className="sr-file-actions"><button className="sr-secondary sr-danger" disabled={busy || pendingJob} onClick={() => { setDeleteError(""); setDeleteOpen(true); }}><Icon name="trash" />Xóa bảng điểm</button></div></div><TranscriptTables key={transcript.version} data={transcript.data} />
      </> : !file && !pendingJob && <div className={`sr-dropzone${dragging ? " is-dragging" : ""}`} onClick={() => { if (!busy) input.current?.click(); }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? "none" : "copy"; setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDrop={onDrop}>
        <svg className="sr-dropzone-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 16V6h24l12 12v20" /><path d="M42 6v12h12" /><path d="M18 30v28h22" /><rect x="8" y="16" width="26" height="14" rx="2" /><text x="21" y="26.5" fill="currentColor" stroke="none" fontSize="9" fontWeight="700" textAnchor="middle" fontFamily="inherit">PDF</text><path d="M26 40h12M26 47h8" /><path d="M50 60V44M44 50l6-6 6 6" /></svg>
        <h3>{dragging ? "Thả tệp PDF vào đây" : "Chưa có bảng điểm"}</h3>
        <p>Kéo thả hoặc tải lên bảng điểm PDF xuất từ cổng đào tạo. Bảng điểm sẽ được lưu riêng trong tài khoản của bạn.</p>
        <button type="button" className="sw-primary sr-drop-button" disabled={busy}>Chọn tệp PDF</button>
        <input ref={input} type="file" accept=".pdf,application/pdf" hidden disabled={busy} onChange={e => pick(e.target.files?.[0])} />
      </div>}</>}
    {deleteOpen && <DeleteTranscriptDialog busy={busy} error={deleteError} onClose={() => setDeleteOpen(false)} onConfirm={() => void remove()} />}
  </section>;
}
