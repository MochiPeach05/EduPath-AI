import { useEffect, useRef, useState } from "react";
import { Modal, Status } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { formatDateTime, workerLine } from "./career-ai-suggestions";
import { searchTerm } from "./student-curriculum-types";
import {
  ADD_SKILLS_PATH, ALL_COURSES_CONFIRMATION, COMPETENCY_API, NO_MATCHING_SKILL_MESSAGE, WEIGHT_TOLERANCE, competencyRequest, useCompetencyData,
  type CompetencyCourse,
} from "./competency-types";
import {
  AI_COMPUTING_MESSAGE, COMPETENCY_AI_API, POLL_BATCH_MS, aiRequest, batchPending, batchProgress, jsonPost, noMatchCourses, skipReason,
  type BatchApplyResult, type CourseAiBatch, type CourseAiStatus,
} from "./competency-ai";
import { CheckedForm } from "./CheckedForm";

type Busy = "run" | "cancel" | "draft" | "active" | "activate" | null;
type Activation = { activated: number; skipped: { courseCode: string; courseName?: string; reason: string }[] };
/** cohort: the filter of the course list ("" = every course). */
type Props = { cohort: string; canManage: boolean; revision: number; onSaved: () => void };
const LATEST_BATCH_URL = `${COMPETENCY_AI_API}/batches/latest`;
/** "TẤT CẢ" and "tat ca" match, as on the server. */
const sameText = (left: string, right: string) => searchTerm(left.replace(/\s+/g, " ")) === searchTerm(right.replace(/\s+/g, " "));

/**
 * "Chạy AI cho các môn chưa có liên kết": one AI proposal (skills and weights) for every course of the
 * filter that has no link yet, processed one by one by the local AI. The courses are shared by every
 * cohort, so the card shows the latest run whatever filter it was started from. Nothing is saved until
 * the admin saves the finished proposals as drafts, or applies them.
 */
export function CompetencyBulkAi({ cohort, canManage, revision, onSaved }: Props) {
  const courses = useCompetencyData<{ items: CompetencyCourse[] }>(`${COMPETENCY_API}/courses?${new URLSearchParams({ cohort })}`, revision);
  const status = useCompetencyData<CourseAiStatus>(`${COMPETENCY_AI_API}/status`);
  const latest = useCompetencyData<{ batch: CourseAiBatch | null }>(LATEST_BATCH_URL, revision);
  const [polled, setPolled] = useState<CourseAiBatch | null | undefined>(undefined);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmActive, setConfirmActive] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<BatchApplyResult | null>(null);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const [confirmDrafts, setConfirmDrafts] = useState(false);
  const [activation, setActivation] = useState<Activation | null>(null);
  const batch = polled !== undefined ? polled : latest.data?.batch ?? null;
  const pending = batchPending(batch);
  const unlinked = (courses.data?.items ?? []).filter((course) => course.skillCount === 0).length;
  const linked = (courses.data?.items ?? []).filter((course) => course.skillCount > 0).length;
  // Drafts (saved from an AI run or by hand) that can be applied: they have links that add up to 100%.
  const drafts = (courses.data?.items ?? []).filter((course) => course.status === "draft");
  const readyDrafts = drafts.filter((course) => course.skillCount > 0 && Math.abs(course.totalWeight - 1) <= WEIGHT_TOLERANCE).length;
  const showDrafts = canManage && !pending && !(batch && batch.ready > 0) && readyDrafts > 0;
  const worker = workerLine(status.data);
  // Courses of the run that no catalog skill fits and that still have no link.
  const noMatch = batch ? noMatchCourses(batch) : [];

  useEffect(() => {
    if (!pending || !batch) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      aiRequest<{ batch: CourseAiBatch | null }>(LATEST_BATCH_URL, { signal: controller.signal })
        .then((next) => { if (!controller.signal.aborted) setPolled(next.batch); })
        .catch(() => { /* keep the last progress */ });
    }, POLL_BATCH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [pending, batch?.id]);

  const run = async () => {
    setBusy("run"); setError(""); setNotice(""); setResult(null); setActivation(null);
    try {
      const response = await aiRequest<{ queued: number; batch: CourseAiBatch | null; skipped: { linked: number; pending: number } }>(
        `${COMPETENCY_AI_API}/batches`, jsonPost({ cohort }));
      if (response.batch) setPolled(response.batch);
      setNotice(response.queued
        ? `Đã gửi ${response.queued.toLocaleString("vi-VN")} môn học cho máy AI.`
        : "Không còn môn nào cần chạy: các môn đã có liên kết hoặc đang chờ AI xử lý.");
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  const cancel = async () => {
    if (!batch) return;
    setBusy("cancel"); setError("");
    try { setPolled((await aiRequest<{ batch: CourseAiBatch }>(`${COMPETENCY_AI_API}/batches/${encodeURIComponent(batch.id)}/cancel`, jsonPost({}))).batch); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  const apply = async (target: "draft" | "active") => {
    if (!batch) return;
    setBusy(target); setError(""); setNotice("");
    try {
      const response = await aiRequest<BatchApplyResult>(`${COMPETENCY_AI_API}/batches/${encodeURIComponent(batch.id)}/apply`, jsonPost({ status: target }));
      setResult(response); setPolled(response.batch); setConfirmActive(false);
      onSaved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };

  /** "Áp dụng bản nháp": every draft of the filter that adds up to 100% becomes active; the rest is listed. */
  const activateDrafts = async () => {
    setBusy("activate"); setError(""); setNotice(""); setResult(null);
    try {
      const response = await competencyRequest<Activation>(`${COMPETENCY_API}/courses/activate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cohort, confirmed: true }),
      });
      setActivation(response); setConfirmDrafts(false);
      onSaved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };

  const progress = batch ? batchProgress(batch) : null;
  return <section className="cm-panel comp-ai-batch" aria-labelledby="comp-ai-batch-title">
    <div className="comp-ai-batch-head">
      <span className="cai-intro-icon" aria-hidden="true"><Icon name="spark" /></span>
      <div>
        <h3 id="comp-ai-batch-title">Chạy AI cho các môn chưa có liên kết</h3>
        <p className="comp-hint">AI đề xuất liên kết kỹ năng và trọng số cho từng môn chưa có liên kết {cohort ? `của ${cohort}` : "(mọi khóa)"}. AI suy luận trước khi trả lời nên mỗi môn mất khoảng 30 giây đến 2 phút; 80 môn khoảng 1–2 giờ. Đề xuất chỉ được lưu khi bạn bấm lưu; môn đã có liên kết được giữ nguyên.</p>
      </div>
    </div>
    <p className={`cai-worker cai-worker-${worker.tone}`}><span aria-hidden="true" />{status.loading && !status.data ? "Đang kiểm tra máy AI…" : worker.text}</p>
    {pending && status.data?.worker.online && <div className="cai-waiting comp-ai-computing" role="status" aria-live="polite">
      <span className="cai-spinner" aria-hidden="true" /><p>{AI_COMPUTING_MESSAGE}</p>
    </div>}
    <Status {...courses} /><Status {...latest} />
    {batch && progress && <div className="comp-ai-batch-progress">
      <p><strong>{progress.done.toLocaleString("vi-VN")}/{batch.total.toLocaleString("vi-VN")} môn đã xong</strong><span> · lần chạy gần nhất lúc {formatDateTime(batch.createdAt)}</span></p>
      <div className="comp-ai-bar" role="progressbar" aria-label="Tiến độ chạy AI cho các môn học" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div>
      <ul className="comp-ai-counts">
        <li><span>Đang chờ</span><strong>{batch.queued}</strong></li>
        <li><span>Đang xử lý</span><strong>{batch.processing}</strong></li>
        <li><span>Có đề xuất chưa lưu</span><strong>{batch.ready}</strong></li>
        <li><span>Đã lưu</span><strong>{batch.applied}</strong></li>
        <li><span>Chưa có kỹ năng phù hợp</span><strong>{batch.noMatch ?? 0}</strong></li>
        <li><span>Lỗi</span><strong>{batch.failed}</strong></li>
        <li><span>Đã hủy</span><strong>{batch.cancelled}</strong></li>
      </ul>
    </div>}
    {noMatch.length > 0 && <div className="comp-ai-nomatch" role="status">
      <h4>{noMatch.length.toLocaleString("vi-VN")} môn chưa có kỹ năng phù hợp</h4>
      <ul>{noMatch.map((course) => <li key={course.key}><strong>{course.code} · {course.name}</strong><span>{NO_MATCHING_SKILL_MESSAGE}</span></li>)}</ul>
      <p className="comp-hint">Sau khi bổ sung kỹ năng ở Cấu hình năng lực, bấm “Chạy AI cho … môn chưa có liên kết” để AI đề xuất lại các môn này.</p>
      {canManage && <div className="cm-actions"><a className="am-outline" href={ADD_SKILLS_PATH}><Icon name="plus" /> Bổ sung kỹ năng</a></div>}
    </div>}
    {notice && <p className="comp-hint" role="status">{notice}</p>}
    {result && <div className="comp-ai-result" role="status">
      <p>Đã lưu {result.drafted.toLocaleString("vi-VN")} bản nháp và áp dụng {result.activated.toLocaleString("vi-VN")} môn học.{result.empty ? ` ${result.empty.toLocaleString("vi-VN")} môn chưa có kỹ năng phù hợp.` : ""}</p>
      {result.skipped.length > 0 && <p>Bỏ qua {result.skipped.length} môn: {result.skipped.slice(0, 8).map((item) => `${item.courseCode} (${skipReason(item.reason)})`).join(", ")}{result.skipped.length > 8 ? "…" : ""}</p>}
    </div>}
    {activation && <div className="comp-ai-result" role="status">
      <p>Đã áp dụng {activation.activated.toLocaleString("vi-VN")} môn học.</p>
      {activation.skipped.length > 0 && <p>Chưa áp dụng {activation.skipped.length} môn: {activation.skipped.slice(0, 8).map((item) => `${item.courseCode} (${skipReason(item.reason)})`).join(", ")}{activation.skipped.length > 8 ? "…" : ""}</p>}
    </div>}
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    {canManage && <>
      {batch && batch.ready > 0 && <div className="comp-ai-apply">
        <label className="cm-check"><input type="checkbox" checked={confirmActive} disabled={busy !== null} onChange={(event) => setConfirmActive(event.target.checked)} />
          <span>Tôi hiểu rằng khi áp dụng, các môn này được tính ngay vào đánh giá năng lực của sinh viên mọi khóa có các môn đó.</span></label>
      </div>}
      {showDrafts && <div className="comp-ai-apply">
        <label className="cm-check"><input type="checkbox" checked={confirmDrafts} disabled={busy !== null} onChange={(event) => setConfirmDrafts(event.target.checked)} />
          <span>Tôi hiểu rằng khi áp dụng, {readyDrafts.toLocaleString("vi-VN")} môn đang ở bản nháp được tính ngay vào đánh giá năng lực của sinh viên mọi khóa có các môn đó.</span></label>
        {drafts.length > readyDrafts && <p className="comp-hint">{(drafts.length - readyDrafts).toLocaleString("vi-VN")} bản nháp khác chưa có liên kết hoặc tổng trọng số chưa đủ 100% nên chưa áp dụng được; hãy hoàn thiện từng môn.</p>}
      </div>}
      <div className="cm-actions">
        {showDrafts && <button type="button" className="am-primary" disabled={busy !== null || !confirmDrafts} onClick={() => void activateDrafts()}>
          <Icon name="check" /> {busy === "activate" ? "Đang áp dụng…" : `Áp dụng ${readyDrafts.toLocaleString("vi-VN")} bản nháp`}</button>}
        {pending && <button type="button" className="am-outline" disabled={busy !== null} onClick={() => void cancel()}><Icon name="close" /> {busy === "cancel" ? "Đang hủy…" : "Hủy lần chạy"}</button>}
        {batch && batch.ready > 0 && <>
          <button type="button" className="am-outline" disabled={busy !== null} onClick={() => void apply("draft")}><Icon name="save" /> {busy === "draft" ? "Đang lưu…" : `Lưu ${batch.ready} đề xuất thành bản nháp`}</button>
          <button type="button" className="am-primary" disabled={busy !== null || !confirmActive} onClick={() => void apply("active")}><Icon name="save" /> {busy === "active" ? "Đang lưu…" : `Lưu và áp dụng ${batch.ready} môn`}</button>
        </>}
        {!pending && linked > 0 && <button type="button" className="am-outline" disabled={busy !== null} onClick={() => { setNotice(""); setResult(null); setActivation(null); setClearing(true); }}>
          <Icon name="trash" /> Xóa liên kết của {linked.toLocaleString("vi-VN")} môn</button>}
        {!pending && <button type="button" className={(batch && batch.ready > 0) || showDrafts ? "am-outline" : "am-primary"} disabled={busy !== null || !worker.canCreate || !courses.data || unlinked === 0} onClick={() => void run()}>
          <Icon name="spark" /> {busy === "run" ? "Đang gửi…" : unlinked ? `Chạy AI cho ${unlinked.toLocaleString("vi-VN")} môn chưa có liên kết` : "Mọi môn đã có liên kết"}</button>}
      </div>
    </>}
    {clearing && <ClearCourses cohort={cohort} linked={linked} close={() => setClearing(false)} cleared={(count) => {
      setClearing(false);
      setNotice(`Đã xóa liên kết và trọng số của ${count.toLocaleString("vi-VN")} môn học. Bấm “Chạy AI cho … môn chưa có liên kết” để AI đề xuất lại.`);
      onSaved();
    }} />}
  </section>;
}

/**
 * "Xóa liên kết của N môn": every course of the filter loses its links and weights and becomes an
 * empty draft, so an AI run can redo them. The courses are shared, so every cohort that has them
 * loses them too. The admin types the cohort code, or ALL_COURSES_CONFIRMATION without a filter.
 */
export function ClearCourses({ cohort, linked, close, cleared }: { cohort: string; linked: number; close: () => void; cleared: (count: number) => void }) {
  const expected = cohort || ALL_COURSES_CONFIRMATION;
  const [code, setCode] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // A wrong text is explained on save (the form shows it under the field) instead of a disabled button.
  const mismatchOf = (value: string) => value.trim() && !sameText(value, expected) ? `Chưa đúng: hãy nhập ${expected}.` : "";
  useEffect(() => { input.current?.setCustomValidity(mismatchOf(code)); });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const matches = sameText(code, expected);
  return <Modal title="Xóa liên kết của nhiều môn học" onClose={close} busy={busy} size="sm">
    <CheckedForm className="cm-dialog-body cm-form" onSubmit={async (event) => {
      event.preventDefault();
      if (!matches || busy) return;
      setBusy(true); setError("");
      try {
        const response = await competencyRequest<{ cleared: number }>(`${COMPETENCY_API}/courses/clear`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cohort, confirm: code.trim() }),
        });
        cleared(response.cleared);
      } catch (failure) { setError((failure as Error).message); setBusy(false); }
    }}>
      <p>Toàn bộ liên kết kỹ năng và trọng số của <strong>{linked.toLocaleString("vi-VN")} môn học</strong>{cohort ? ` thuộc ${cohort}` : ""} sẽ bị xóa; các môn chuyển về bản nháp trống.</p>
      <p className="cm-warning">Môn học dùng chung cho mọi khóa: sinh viên của mọi khóa có các môn này sẽ chưa có điểm năng lực từ các môn đó cho tới khi bạn lưu và áp dụng lại liên kết, trọng số. Lịch sử thay đổi của từng môn vẫn được giữ.</p>
      <p className="comp-hint">Sau khi xóa, bấm “Chạy AI cho … môn chưa có liên kết” để AI đề xuất lại.</p>
      <label><RequiredLabel>Nhập {expected} để xác nhận</RequiredLabel><input ref={input} required value={code} maxLength={40} autoComplete="off" disabled={busy} onChange={(event) => { event.target.setCustomValidity(mismatchOf(event.target.value)); setCode(event.target.value); }} /></label>
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary am-delete" disabled={busy}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xóa liên kết"}</button>
      </div>
    </CheckedForm>
  </Modal>;
}
