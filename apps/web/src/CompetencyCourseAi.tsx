import { useState } from "react";
import { Modal, Status } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import {
  ADD_SKILLS_PATH, COMPETENCY_API, NO_MATCHING_SKILL_MESSAGE, percentage, useCompetencyData,
  type CompetencyCourse, type CurriculumRevision, type Group,
} from "./competency-types";
import {
  AI_COMPUTING_MESSAGE, COMPETENCY_AI_API, SKILL_NAME_MAX,
  aiRequest, applyLinkItems, failureMessage, jsonPost, linkRows, validateLinkRows,
  type CourseAiSuggestion, type LinkRow,
} from "./competency-ai";
import { Elapsed, ReviewHead, WorkerLine } from "./CompetencyAiParts";
import { useCompetencySuggestion, type SuggestionBusy as Busy } from "./use-competency-suggestion";
import "./careers.css";

type Props = { curriculum: CurriculumRevision; course: CompetencyCourse; close: () => void; saved: () => void };

/**
 * "Tạo liên kết kỹ năng (AI)" for one course: the local AI picks the skills and splits the course's
 * 100% over all of its skills ("Thêm trọng số (AI)" was merged into it, 2026-10-20). The admin reviews
 * and saves what is kept as a draft or applied. The AI receives curriculum data only, never student data.
 */
export default function CompetencyCourseAi({ curriculum, course, close, saved }: Props) {
  const mode = "links";
  const query = new URLSearchParams({ revisionId: curriculum.revisionId, code: course.code, mode });
  const { latest, latestFailed, statusLoading, worker, suggestion, view, busy, setBusy, error, create, cancel } =
    useCompetencySuggestion(`${COMPETENCY_AI_API}/latest?${query}`, COMPETENCY_AI_API, { revisionId: curriculum.revisionId, code: course.code, mode });

  return <Modal title={`Tạo liên kết kỹ năng (AI) · ${course.code}`} onClose={close} busy={busy !== null}>
    <div className="cm-dialog-body cm-form cai-body">
      {view === "loading" && <Status {...latest} />}
      {latestFailed && <Status {...latest} />}
      {view === "intro" && !latest.error && <>
        <div className="cai-intro">
          <span className="cai-intro-icon" aria-hidden="true"><Icon name="spark" /></span>
          <div>
            <h3>{course.code} · {course.name}</h3>
            <p>AI đọc tên, mô tả, khối kiến thức và số giờ của học phần cùng các kỹ năng đã có cấu hình năng lực (gồm cả kỹ năng nghề nghiệp chưa có học phần đo), đề xuất những kỹ năng học phần rèn luyện và chia 100% trọng số cho các kỹ năng của học phần{course.skillCount ? `, kể cả ${course.skillCount} kỹ năng đã liên kết` : ""}. Bạn xem, sửa rồi lưu bản nháp hoặc áp dụng.</p>
            <p className="cai-muted">AI chỉ nhận dữ liệu chương trình đào tạo, không nhận dữ liệu sinh viên. Kết quả chỉ là gợi ý: bạn chọn, sửa rồi mới lưu.</p>
          </div>
        </div>
        <WorkerLine line={worker} loading={statusLoading} />
        {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
          <button type="button" className="am-primary" disabled={busy !== null || !worker.canCreate} onClick={() => void create()}><Icon name="spark" /> {busy === "create" ? "Đang gửi…" : "Tạo đề xuất"}</button>
        </div>
      </>}
      {view === "waiting" && suggestion && <>
        <div className="cai-waiting">
          <span className="cai-spinner" aria-hidden="true" />
          <div>
            <p className="cai-state" role="status" aria-live="polite">{suggestion.status === "queued" ? "Đang chờ máy AI nhận việc…" : "AI đang chọn kỹ năng và chia trọng số cho học phần…"}</p>
            {suggestion.status === "processing" && <p className="cai-muted"><Elapsed since={suggestion.updatedAt} /> · AI suy luận trước khi trả lời nên thường mất 30 giây đến 2 phút.</p>}
            {(suggestion.status === "processing" || worker.tone === "ok") && <p className="cai-muted">{AI_COMPUTING_MESSAGE}</p>}
            <p className="cai-muted">{course.code} · {course.name}</p>
          </div>
        </div>
        <WorkerLine line={worker} loading={false} />
        {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Đóng</button>
          <button type="button" className="am-outline" disabled={busy !== null} onClick={() => void cancel()}><Icon name="close" /> {busy === "cancel" ? "Đang hủy…" : "Hủy đề xuất"}</button>
        </div>
      </>}
      {view === "failed" && suggestion && <>
        <div className="cai-failed" role="status" aria-live="polite"><h3>Chưa tạo được đề xuất</h3><p>{failureMessage(suggestion.errorCode)}</p></div>
        <WorkerLine line={worker} loading={false} />
        {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
          <button type="button" className="am-primary" disabled={busy !== null || !worker.canCreate} onClick={() => void create()}><Icon name="refresh" /> {busy === "create" ? "Đang gửi…" : "Tạo lại đề xuất"}</button>
        </div>
      </>}
      {view === "completed" && suggestion && <LinksReview key={suggestion.id} suggestion={suggestion} course={course} busy={busy} setBusy={setBusy} createError={error} canCreate={worker.canCreate} regenerate={() => void create()} close={close} saved={saved} />}
    </div>
  </Modal>;
}

type ReviewProps = {
  suggestion: CourseAiSuggestion; course: CompetencyCourse; busy: Busy; setBusy: (busy: Busy) => void;
  createError: string; canCreate: boolean; regenerate: () => void; close: () => void; saved: () => void;
};

function LinksReview({ suggestion, course, busy, setBusy, createError, canCreate, regenerate, close, saved }: ReviewProps) {
  const groups = useCompetencyData<{ items: Group[] }>(`${COMPETENCY_API}/groups`);
  const [rows, setRows] = useState<LinkRow[]>(() => linkRows(suggestion.items));
  const [error, setError] = useState("");
  const check = validateLinkRows(rows);
  const options = (groups.data?.items ?? []).filter((group) => group.isActive);
  const update = (key: string, patch: Partial<LinkRow>) => { setError(""); setRows((previous) => previous.map((row) => row.key === key ? { ...row, ...patch } : row)); };
  const apply = async (status: "draft" | "active") => {
    setBusy("apply"); setError("");
    try {
      await aiRequest(`${COMPETENCY_AI_API}/${encodeURIComponent(suggestion.id)}/apply`, jsonPost({ items: applyLinkItems(rows), status }));
      saved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  const proposed = suggestion.items.filter((item) => !item.alreadyLinked).length;
  return <>
    <ReviewHead suggestion={suggestion} heading={suggestion.items.length ? `AI đề xuất ${proposed.toLocaleString("vi-VN")} kỹ năng mới và trọng số cho ${course.code}` : `Chưa có kỹ năng phù hợp cho ${course.code}`}
      text={suggestion.items.length ? "Bỏ chọn kỹ năng không phù hợp, chọn nhóm năng lực cho kỹ năng chưa có cấu hình năng lực và sửa phần trăm nếu cần. Kỹ năng đã liên kết luôn được giữ. Áp dụng cần tổng đúng 100%; bản nháp được lưu dù tổng chưa đủ." : NO_MATCHING_SKILL_MESSAGE} />
    {suggestion.stale && <p className="cm-warning" role="alert">Liên kết kỹ năng của học phần đã thay đổi sau khi AI đề xuất. Hãy tạo lại đề xuất.</p>}
    {!suggestion.items.length && <p className="cai-muted">Bổ sung kỹ năng ở Cấu hình năng lực rồi tạo lại đề xuất, hoặc tạo liên kết thủ công.</p>}
    <Status {...groups} />
    {rows.length > 0 && <ul className="cai-rows">{rows.map((row) => {
      const id = `ca-${suggestion.id}-${row.key}`;
      const rowErrors = check.errors[row.key] ?? [];
      return <li key={row.key} className={`cai-row${row.checked && !row.alreadyLinked ? " cai-row-on" : ""}${row.alreadyLinked ? " cai-row-linked" : ""}${rowErrors.length ? " cai-row-invalid" : ""}`}>
        <div className="cai-row-head">
          <label className="cai-check"><input type="checkbox" checked={row.checked || row.alreadyLinked} disabled={row.alreadyLinked || busy !== null} onChange={(event) => update(row.key, { checked: event.target.checked })} /><span>{row.skillName || "kỹ năng mới"}</span></label>
          {row.alreadyLinked && <span className="cai-tag">Đã liên kết</span>}
          {row.isNewSkill && <span className="cai-tag cai-tag-similar">Kỹ năng mới</span>}
          {!row.hasProfile && !row.isNewSkill && <span className="cai-tag cai-tag-required">Kỹ năng nghề chưa đo</span>}
          <label className="comp-percent cai-percent">Trọng số (%)<input type="number" min="0" max="100" step="any" value={row.percent} disabled={busy !== null || suggestion.stale || (!row.checked && !row.alreadyLinked)}
            onChange={(event) => update(row.key, { percent: event.target.value })} /></label>
          {!row.alreadyLinked && <button type="button" className="am-icon-btn am-delete-icon cai-remove" disabled={busy !== null} aria-label={`Bỏ đề xuất ${row.skillName}`} title="Bỏ đề xuất" onClick={() => setRows((previous) => previous.filter((item) => item.key !== row.key))}><Icon name="trash" /></button>}
        </div>
        {(row.isNewSkill || !row.hasProfile) && !row.alreadyLinked && <fieldset className="cai-row-fields" disabled={busy !== null}>
          <legend className="sr-only">Thông tin kỹ năng {row.skillName}</legend>
          {row.isNewSkill && <label htmlFor={`${id}-name`}><RequiredLabel>Tên kỹ năng mới</RequiredLabel><input id={`${id}-name`} maxLength={SKILL_NAME_MAX} value={row.skillName} onChange={(event) => update(row.key, { skillName: event.target.value })} /></label>}
          <label htmlFor={`${id}-group`}><RequiredLabel>Nhóm năng lực</RequiredLabel><select id={`${id}-group`} value={row.groupId} disabled={!groups.data} onChange={(event) => update(row.key, { groupId: event.target.value })}>
            <option value="">Chọn nhóm</option>{options.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select></label>
        </fieldset>}
        {!row.hasProfile && !row.alreadyLinked && <p className="cai-similar">{row.isNewSkill ? "Khi lưu, kỹ năng mới được thêm vào mục Kỹ năng của Nghề nghiệp và được tạo cấu hình năng lực." : "Kỹ năng này đang được nghề nghiệp yêu cầu nhưng chưa có học phần đo. Khi lưu, kỹ năng được tạo cấu hình năng lực."}</p>}
        {row.reason && <p className="cai-reason">Lý do AI đề xuất: {row.reason}</p>}
        {rowErrors.length > 0 && <ul className="cai-row-errors" role="alert">{rowErrors.map((message) => <li key={message}>{message}</li>)}</ul>}
      </li>;
    })}</ul>}
    {rows.length > 0 && <>
      <p className="cai-summary" aria-live="polite">{course.code} sẽ có {check.selected.toLocaleString("vi-VN")} kỹ năng ({check.added.toLocaleString("vi-VN")} kỹ năng mới)</p>
      <div className={`comp-weight-total${check.canActivate ? " comp-weight-valid" : ""}`} role="status"><span>Tổng trọng số</span><strong>{percentage(check.total / 100)} / 100%</strong></div>
    </>}
    {(error || createError) && <p className="admin-error cm-prewrap" role="alert">{error || createError}</p>}
    <div className="cm-actions cm-dialog-actions">
      <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
      <div className="cm-dialog-actions-main">
        {!suggestion.items.length && <a className="am-outline" href={ADD_SKILLS_PATH}><Icon name="plus" /> Bổ sung kỹ năng</a>}
        <button type="button" className="am-outline" disabled={busy !== null || !canCreate} onClick={regenerate}><Icon name="refresh" /> {busy === "create" ? "Đang gửi…" : "Tạo lại đề xuất"}</button>
        {suggestion.items.length > 0 && <>
          <button type="button" className="am-outline" disabled={busy !== null || !check.valid || !groups.data || suggestion.stale} onClick={() => void apply("draft")}><Icon name="save" /> {busy === "apply" ? "Đang lưu…" : "Lưu bản nháp"}</button>
          <button type="button" className="am-primary" disabled={busy !== null || !check.canActivate || !groups.data || suggestion.stale} onClick={() => void apply("active")}><Icon name="save" /> {busy === "apply" ? "Đang lưu…" : "Lưu và áp dụng"}</button>
        </>}
      </div>
    </div>
  </>;
}
