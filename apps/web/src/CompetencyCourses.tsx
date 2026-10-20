import { useState, type ReactNode } from "react";
import { Icon } from "./admin-account-shared";
import { ActionMenu, Modal, Pagination, Status } from "./admin-ui";
import { useLiveFilters } from "./use-live-filters";
import { searchTerm } from "./student-curriculum-types";
import { assessAllocations, splitEvenly, type AllocationInput } from "./competency-weights";
import { COMPETENCY_API, cohortList, competencyDate, competencyRequest, percentage, statusLabels, useCompetencyData, type Cohort, type CompetencyCourse, type CompetencySummary, type CourseDetail, type EventEntry, type Group, type Skill } from "./competency-types";
import CompetencyCourseAi from "./CompetencyCourseAi";
import { CompetencyBulkAi } from "./CompetencyBulkAi";

type Props = { canManage: boolean; revision: number; onSaved: () => void };
/**
 * What a course row opens: details, the full editor, one of the manual steps, or an AI proposal.
 * "Thêm trọng số (Thủ công)" and "(AI)" were merged into "Tạo liên kết kỹ năng", and "Xóa liên kết"
 * and "Xóa trọng số" into one "Xóa liên kết và trọng số" (user, 2026-10-20).
 */
type Mode = "view" | "edit" | "links" | "removeLinks" | "aiLinks";
const courseUrl = (id: string) => `${COMPETENCY_API}/courses/${encodeURIComponent(id)}`;
const putCourse = (detail: CourseDetail, body: { status: "draft" | "active"; links: { skillId: string; weight: number }[]; note: string }) =>
  competencyRequest(courseUrl(detail.courseId), { method: "PUT", headers: { "Content-Type": "application/json", "x-version": detail.version ?? "new" }, body: JSON.stringify(body) });

/** "Cấu hình môn học": the shared courses of every CTĐT, filtered by cohort (2026-10-20). */
export function CompetencyCoursesTab({ canManage, revision, onSaved }: Props) {
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({ q: "", status: "", cohort: "" });
  const query = new URLSearchParams(filters);
  const cohorts = useCompetencyData<{ items: Cohort[] }>(`${COMPETENCY_API}/cohorts`, revision);
  const courses = useCompetencyData<{ items: CompetencyCourse[] }>(`${COMPETENCY_API}/courses?${query}`, revision);
  const summary = useCompetencyData<CompetencySummary>(`${COMPETENCY_API}/summary?${new URLSearchParams({ cohort: filters.cohort })}`, revision);
  const [selected, setSelected] = useState<CompetencyCourse | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const close = () => setSelected(null);
  const saved = () => { close(); onSaved(); };
  function open(course: CompetencyCourse, next: Mode) { setSelected(course); setMode(next); }
  const scope = filters.cohort ? `các môn của ${filters.cohort}` : "các môn học";

  return <div className="comp-section-stack">
    <section className="cm-panel comp-summary"><Status {...summary} />{summary.data && <>
      <div className="cm-stats">
        <div><span>Đang áp dụng</span><strong>{summary.data.activeCount}</strong><small>/ {summary.data.courseCount} môn học{filters.cohort ? ` của ${filters.cohort}` : ""}</small></div>
        <div><span>Bản nháp</span><strong>{summary.data.draftCount}</strong><small>Cần hoàn thiện trước khi áp dụng</small></div>
        <div><span>Chưa cấu hình</span><strong>{summary.data.missingCount}</strong><small>{summary.data.archivedCount} cấu hình đã lưu trữ</small></div>
        <div><span>Kỹ năng chưa đóng góp</span><strong>{summary.data.unlinkedSkillCount}</strong><small>Có cấu hình năng lực</small></div>
      </div>
      {summary.data.courseCount > 0 && summary.data.activeCount === 0 && summary.data.draftCount === 0 && <p className="comp-empty-config" role="status">Chưa có {scope} nào có cấu hình đang sử dụng. Có thể chạy AI cho các môn chưa có liên kết hoặc tạo liên kết kỹ năng kèm trọng số cho từng môn.</p>}
      {summary.data.warnings.length > 0 && <details className="cm-warning"><summary>{summary.data.warnings.length} cảnh báo cần rà soát</summary><ul>{summary.data.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.courseCode && <strong>{warning.courseCode}: </strong>}{warning.message}</li>)}</ul></details>}
    </>}</section>
    <CompetencyBulkAi cohort={filters.cohort} canManage={canManage} revision={revision} onSaved={onSaved} />
    <section className="cm-panel">
      <div className="cm-filters">
        <label className="cm-search">Tìm môn học<input maxLength={200} value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} placeholder="Mã hoặc tên môn học…" /></label>
        <label>Khóa<select value={draft.cohort} disabled={!cohorts.data} onChange={event => setDraft({ ...draft, cohort: event.target.value })}><option value="">Tất cả khóa</option>{(cohorts.data?.items ?? []).map(item => <option key={item.cohortCode} value={item.cohortCode}>{item.cohortCode} · {item.courseCount} môn</option>)}</select></label>
        <label>Trạng thái<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">Tất cả trạng thái</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="am-outline" onClick={reset}><Icon name="refresh" /> Xóa bộ lọc</button>
      </div>
      <Status {...cohorts} /><Status {...courses} />
      {courses.data && <><div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Bảng cấu hình môn học"><table className="cm-table comp-course-table"><thead><tr><th className="cm-stt">STT</th><th>Môn học</th><th>Khóa áp dụng</th><th>Trạng thái</th><th>Kỹ năng / tổng trọng số</th><th>Thao tác</th></tr></thead><tbody>{courses.data.items.slice((page - 1) * 10, page * 10).map((course, index) => {
        const linked = course.skillCount > 0;
        return <tr key={course.id}>
          <td className="cm-stt">{(page - 1) * 10 + index + 1}</td>
          <td><strong>{course.code}</strong>{course.name}<small>{course.credits} tín chỉ · {course.type || "Chưa xác định loại"}{course.block ? ` · ${course.block}` : ""}</small></td>
          <td>{cohortList(course)}</td>
          <td><span className={`comp-state comp-state-${course.status}`}>{statusLabels[course.status]}</span>{course.mergedFrom.length > 0 && <small className="comp-merged">Đã gộp cấu hình khác của {course.mergedFrom.join(", ")}; xem lịch sử.</small>}</td>
          <td>{course.skillCount} kỹ năng<strong>{percentage(course.totalWeight)}</strong>{course.status === "archived" && <small>Trọng số lưu trong lịch sử; không đóng góp.</small>}</td>
          <td><ActionMenu label={`Thao tác với ${course.code} · ${course.name}`} items={[
            { key: "view", icon: "eye", label: "Xem chi tiết môn học", onSelect: () => open(course, "view") },
            ...(canManage ? [
              { key: "links", icon: "link", label: "Tạo liên kết kỹ năng (Thủ công)", onSelect: () => open(course, "links") },
              { key: "aiLinks", icon: "spark", label: "Tạo liên kết kỹ năng (AI)", onSelect: () => open(course, "aiLinks") },
              { key: "edit", icon: "edit", label: "Chỉnh sửa liên kết và trọng số", onSelect: () => open(course, "edit") },
              { key: "removeLinks", icon: "trash", label: "Xóa liên kết và trọng số", danger: true, disabled: !linked, onSelect: () => open(course, "removeLinks") },
            ] : []),
          ]} /></td>
        </tr>;
      })}</tbody></table></div>{!courses.data.items.length && <p className="am-empty">Không có môn học phù hợp.</p>}<Pagination total={courses.data.items.length} page={page} setPage={setPage} /></>}
    </section>
    {selected && mode === "aiLinks"
      ? <CompetencyCourseAi course={selected} close={close} saved={saved} />
      : selected && <CourseDialog course={selected} mode={mode} canManage={canManage} close={close} saved={saved} />}
  </div>;
}

const dialogTitles: Partial<Record<Mode, string>> = {
  links: "Tạo liên kết kỹ năng (Thủ công)", removeLinks: "Xóa liên kết và trọng số",
};

function CourseDialog({ course, mode, canManage, close, saved }: { course: CompetencyCourse; mode: Mode; canManage: boolean; close: () => void; saved: () => void }) {
  const remote = useCompetencyData<CourseDetail>(courseUrl(course.id));
  const [busy, setBusy] = useState(false);
  const step = { detail: remote.data!, canManage, close, saved, busy, setBusy };
  const title = dialogTitles[mode];
  return <Modal title={title ? `${title} · ${course.code}` : `${course.code} · ${course.name}`} onClose={close} busy={busy}>
    <div className="cm-dialog-body comp-course-dialog"><p className="comp-hint">{course.code} · {course.name} · {course.credits} tín chỉ · Khóa áp dụng: {cohortList(course)}. Cấu hình dùng chung cho mọi khóa có môn này.</p><Status {...remote} />
      {remote.data && (mode === "links" ? <ManualLinks key={course.id} {...step} />
          : mode === "removeLinks" ? <RemoveLinks key={course.id} {...step} />
              : <CourseConfiguration key={course.id} initial={remote.data} canManage={canManage} startEditing={mode === "edit"} close={close} saved={saved} busy={busy} setBusy={setBusy} />)}
      {!remote.data && <div className="cm-actions"><button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button></div>}
    </div>
  </Modal>;
}

type StepProps = { detail: CourseDetail; canManage: boolean; close: () => void; saved: () => void; busy: boolean; setBusy: (value: boolean) => void };

/** Status after a change that keeps the weights: an applied course stays applied while its total is 100%. */
const keepStatus = (detail: CourseDetail, links: { weight: number }[]) =>
  detail.status === "active" && Math.abs(links.reduce((sum, link) => sum + link.weight, 0) - 1) <= 0.000001 ? "active" as const : "draft" as const;

function DialogActions({ busy, close, children }: { busy: boolean; close: () => void; children: ReactNode }) {
  return <div className="cm-actions cm-dialog-actions"><button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button><div className="cm-dialog-actions-main">{children}</div></div>;
}

/**
 * "Tạo liên kết kỹ năng (Thủ công)" (with "Thêm trọng số (Thủ công)" merged in, user 2026-10-20): tick
 * skills of the competency catalog and give every skill of the course its percent, linked ones included.
 * A draft is saved whatever the total; applying needs exactly 100% and skills in use.
 */
function ManualLinks({ detail, canManage, close, saved, busy, setBusy }: StepProps) {
  const [current] = useState(detail);
  const skills = useCompetencyData<{ items: Skill[] }>(`${COMPETENCY_API}/skills`);
  const groups = useCompetencyData<{ items: Group[] }>(`${COMPETENCY_API}/groups`);
  const [chosen, setChosen] = useState<string[]>([]);
  const [percents, setPercents] = useState<Record<string, string>>(() =>
    Object.fromEntries(current.links.map((link) => [link.skillId, String(Number((link.weight * 100).toFixed(8)))])));
  const [term, setTerm] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState("");
  const linked = new Set(current.links.map((link) => link.skillId));
  const catalog = new Map((skills.data?.items ?? []).map((skill) => [skill.id, skill]));
  const available = (skills.data?.items ?? []).filter((skill) => !linked.has(skill.id) && skill.isActive && skill.groupActive
    && (!groupId || skill.groupId === groupId) && searchTerm(`${skill.name} ${skill.groupName}`).includes(searchTerm(term)));
  // Every skill of the course after the save: its links first, then the ticked ones.
  const rows = [
    ...current.links.map((link) => ({ skillId: link.skillId, name: link.skillName, group: link.groupName, linked: true, usable: link.isActive })),
    ...chosen.map((id) => {
      const skill = catalog.get(id);
      return { skillId: id, name: skill?.name ?? "", group: skill?.groupName ?? "", linked: false, usable: Boolean(skill?.isActive && skill.groupActive) };
    }),
  ];
  const allocation = assessAllocations(rows.map((row) => ({ skillId: row.skillId, percent: percents[row.skillId] ?? "0" })));
  const unavailable = rows.some((row) => !row.usable);
  const toggle = (id: string) => {
    setChosen((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
    setPercents((previous) => id in previous ? previous : { ...previous, [id]: "0" });
  };
  const even = () => {
    const values = splitEvenly(rows.length);
    setPercents((previous) => ({ ...previous, ...Object.fromEntries(rows.map((row, index) => [row.skillId, String(values[index])])) }));
  };
  async function save(status: "draft" | "active") {
    if (busy || !canManage || !rows.length || allocation.errors.length || (status === "active" && (!allocation.canActivate || unavailable))) return;
    setBusy(true); setError("");
    try { await putCourse(current, { status, links: allocation.links, note: current.note }); saved(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="cm-form">
    <p className="comp-hint">Chọn kỹ năng môn học này rèn luyện rồi nhập trọng số cho mọi kỹ năng của môn. Áp dụng cần tổng đúng 100%; bản nháp được lưu dù tổng chưa đủ. Môn học đã có {current.links.length} kỹ năng liên kết.</p>
    <Status {...skills} />
    <div className="cm-filters comp-pick-filters">
      <label className="cm-search">Tìm kỹ năng<input maxLength={200} value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Tên kỹ năng…" /></label>
      <label>Nhóm<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Tất cả nhóm</option>{(groups.data?.items ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    </div>
    {skills.data && <fieldset className="cm-fields comp-pick-list" disabled={busy}>
      <legend className="sr-only">Kỹ năng có thể liên kết</legend>
      {available.map((skill) => <label key={skill.id} className="cm-check"><input type="checkbox" checked={chosen.includes(skill.id)} onChange={() => toggle(skill.id)} /><span>{skill.name}<small> · {skill.groupName}</small></span></label>)}
      {!available.length && <p className="comp-hint">Không còn kỹ năng phù hợp để liên kết.</p>}
    </fieldset>}
    <p className="cai-summary" aria-live="polite">Đã chọn thêm {chosen.length.toLocaleString("vi-VN")} kỹ năng</p>
    <h4 className="comp-subheading">Trọng số của {rows.length.toLocaleString("vi-VN")} kỹ năng</h4>
    {rows.length ? <fieldset className="cm-fields" disabled={busy}><div className="comp-allocation-list">
      {rows.map((row) => <div className="comp-allocation-row comp-weight-row" key={row.skillId}>
        <label>Kỹ năng<strong>{row.name}<small> · {row.group}{row.linked ? " · đã liên kết" : " · mới"}</small></strong></label>
        <label className="comp-percent">Trọng số (%)<input type="number" min="0" max="100" step="any" value={percents[row.skillId] ?? "0"}
          onChange={(event) => setPercents((previous) => ({ ...previous, [row.skillId]: event.target.value }))} /></label>
        {!row.usable && <small className="comp-row-warning">Kỹ năng hoặc nhóm đang ngừng sử dụng; không thể áp dụng.</small>}
      </div>)}
    </div>
    <button type="button" className="am-outline comp-even-split" onClick={even}><Icon name="chart" /> Chia đều 100%</button></fieldset>
      : <p className="comp-hint">Chưa có kỹ năng nào: hãy chọn kỹ năng ở danh sách trên.</p>}
    <div className={`comp-weight-total${allocation.canActivate ? " comp-weight-valid" : ""}`} role="status"><span>Tổng trọng số</span><strong>{percentage(allocation.total)} / 100%</strong></div>
    {allocation.errors.length > 0 && <div className="admin-error" role="alert"><ul>{allocation.errors.map((message) => <li key={message}>{message}</li>)}</ul></div>}
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    <DialogActions busy={busy} close={close}>
      <button type="button" className="am-outline" disabled={busy || !rows.length || allocation.errors.length > 0} onClick={() => void save("draft")}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu bản nháp"}</button>
      <button type="button" className="am-primary" disabled={busy || !allocation.canActivate || unavailable} onClick={() => void save("active")}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu và áp dụng"}</button>
    </DialogActions>
  </div>;
}

/**
 * "Xóa liên kết và trọng số" (the former "Xóa liên kết" and "Xóa trọng số", merged 2026-10-20): the
 * ticked skills leave the course with their weights; "Chọn tất cả" empties it. An applied course goes
 * back to draft when its total is no longer 100%.
 */
function RemoveLinks({ detail, canManage, close, saved, busy, setBusy }: StepProps) {
  const [current] = useState(detail);
  const [removed, setRemoved] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const kept = current.links.filter((link) => !removed.includes(link.skillId)).map((link) => ({ skillId: link.skillId, weight: link.weight }));
  const nextStatus = keepStatus(current, kept);
  const toDraft = current.status === "active" && nextStatus === "draft";
  const all = current.links.length > 0 && removed.length === current.links.length;
  async function save() {
    if (busy || !canManage || !removed.length || !confirmed) return;
    setBusy(true); setError("");
    try { await putCourse(current, { status: nextStatus, links: kept, note: current.note }); saved(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="cm-form">
    <p className="comp-hint">Chọn kỹ năng cần xóa khỏi môn học. Xóa liên kết cũng xóa trọng số của kỹ năng đó; lịch sử cấu hình vẫn giữ trọng số cũ để đối chiếu.</p>
    <fieldset className="cm-fields comp-pick-list" disabled={busy}>
      <legend className="sr-only">Kỹ năng đang liên kết</legend>
      <label className="cm-check comp-pick-all"><input type="checkbox" checked={all} onChange={() => { setRemoved(all ? [] : current.links.map((link) => link.skillId)); setConfirmed(false); }} /><span><strong>Chọn tất cả {current.links.length.toLocaleString("vi-VN")} kỹ năng</strong></span></label>
      {current.links.map((link) => <label key={link.skillId} className="cm-check"><input type="checkbox" checked={removed.includes(link.skillId)}
        onChange={() => setRemoved((previous) => previous.includes(link.skillId) ? previous.filter((id) => id !== link.skillId) : [...previous, link.skillId])} /><span>{link.skillName}<small> · {percentage(link.weight)}</small></span></label>)}
    </fieldset>
    {all ? <p className="cm-warning" role="alert">Môn học sẽ không còn kỹ năng nào, chuyển về Bản nháp và không được tính vào đánh giá năng lực của mọi khóa có môn này cho đến khi tạo liên kết kỹ năng lại.</p>
      : toDraft && <p className="cm-warning" role="alert">Sau khi xóa, tổng trọng số không còn 100% nên môn học chuyển về Bản nháp và tạm không được tính vào đánh giá năng lực. Hãy dùng Tạo liên kết kỹ năng hoặc Chỉnh sửa liên kết và trọng số để chia lại 100% rồi áp dụng.</p>}
    <label className="cm-check"><input type="checkbox" checked={confirmed} disabled={busy || !removed.length} onChange={(event) => setConfirmed(event.target.checked)} /><span>Tôi xác nhận xóa liên kết và trọng số của {removed.length} kỹ năng khỏi {current.courseCode}.</span></label>
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    <DialogActions busy={busy} close={close}><button type="button" className="am-primary am-delete" disabled={busy || !removed.length || !confirmed} onClick={() => void save()}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa"}</button></DialogActions>
  </div>;
}

function CourseConfiguration({ initial, canManage, startEditing, close, saved, busy, setBusy }: { initial: CourseDetail; canManage: boolean; startEditing: boolean; close: () => void; saved: () => void; busy: boolean; setBusy: (value: boolean) => void }) {
  // Pin the version originally opened. Background refreshes never replace an unsaved edit.
  const [current] = useState(initial);
  const [editing, setEditing] = useState(startEditing && canManage);
  const [rows, setRows] = useState<AllocationInput[]>(current.links.map(link => ({ skillId: link.skillId, percent: String(Number((link.weight * 100).toFixed(8))) })));
  const [note, setNote] = useState(current.note);
  const [error, setError] = useState("");
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const skills = useCompetencyData<{ items: Skill[] }>(`${COMPETENCY_API}/skills`);
  const options = skills.data?.items ?? [];
  const allocation = assessAllocations(rows);
  const catalogReady = !!skills.data && !skills.loading && !skills.error;
  const missingSkills = catalogReady && rows.some(row => !!row.skillId && !options.some(skill => skill.id === row.skillId));
  const unavailable = rows.some(row => {
    const skill = options.find(item => item.id === row.skillId);
    return !skill || !skill.isActive || !skill.groupActive;
  });
  const validDraft = catalogReady && allocation.errors.length === 0 && !missingSkills;
  const canActivate = validDraft && allocation.canActivate && !unavailable;
  const skillName = (id: string) => options.find(item => item.id === id)?.name ?? current.links.find(link => link.skillId === id)?.skillName ?? "Kỹ năng chưa chọn";
  async function save(status: "draft" | "active") {
    if (busy || !editing || !canManage || !validDraft || (status === "active" && !canActivate)) return;
    setBusy(true); setError("");
    try {
      await putCourse(current, { status, links: allocation.links, note });
      saved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="cm-form">
    <p><span className={`comp-state comp-state-${current.status}`}>{statusLabels[current.status]}</span>{current.status === "archived" && <span className="comp-hint"> Cấu hình đã lưu trữ, không đóng góp vào năng lực. Chọn chỉnh sửa để tạo trạng thái mới.</span>}</p>
    {current.mergedFrom.length > 0 && <p className="cm-warning">Khi chuyển sang cấu hình dùng chung, cấu hình khác của {current.mergedFrom.join(", ")} đã được thay bằng cấu hình này. Xem Lịch sử cấu hình để đối chiếu; ghi chú này mất sau lần lưu tiếp theo.</p>}
    {editing && <><p className="comp-hint">Nhập phần trăm cho toàn bộ danh sách. Áp dụng cần ít nhất một kỹ năng, tổng 100% và mọi kỹ năng đang hoạt động. Trọng số 0% được giữ nhưng không đóng góp.</p><Status {...skills} /></>}
    <fieldset className="cm-fields" disabled={busy || !editing}>
      <div className="comp-allocation-list">
        {rows.map((row, index) => {
          const selected = options.find(skill => skill.id === row.skillId);
          const linked = current.links.find(link => link.skillId === row.skillId);
          return <div className="comp-allocation-row" key={index}>
            <label>Kỹ năng {index + 1}{editing ? <select value={row.skillId} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, skillId: event.target.value } : item))}><option value="">Chọn kỹ năng</option>{!selected && row.skillId && <option value={row.skillId}>{linked?.skillName ?? "Kỹ năng không còn khả dụng"}</option>}{options.map(skill => <option key={skill.id} value={skill.id} disabled={!skill.isActive || !skill.groupActive || rows.some((item, at) => at !== index && item.skillId === skill.id)}>{skill.name} · {skill.groupName}{!skill.isActive || !skill.groupActive ? " · Ngừng sử dụng" : ""}</option>)}</select> : <strong>{skillName(row.skillId)}</strong>}</label>
            <label className="comp-percent">Trọng số (%)<input type="number" min="0" max="100" step="any" value={row.percent} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, percent: event.target.value } : item))} /></label>
            {editing && <button type="button" className="am-outline comp-remove-link" aria-label={`Xóa liên kết ${skillName(row.skillId)} khỏi cấu hình môn học`} onClick={() => setRemoveIndex(index)}><Icon name="trash" /> Xóa liên kết</button>}
            {(selected && (!selected.isActive || !selected.groupActive)) || (!selected && linked && !linked.isActive) ? <small className="comp-row-warning">Kỹ năng hoặc nhóm đang ngừng sử dụng; không thể áp dụng.</small> : null}
          </div>;
        })}
        {!rows.length && <p className="comp-hint">Chưa liên kết kỹ năng với môn học này.</p>}
      </div>
      {editing && <button type="button" className="am-outline" disabled={busy || skills.loading || !!skills.error || rows.length >= 200} onClick={() => setRows([...rows, { skillId: "", percent: "0" }])}><Icon name="plus" /> Thêm liên kết kỹ năng</button>}
      <label>Ghi chú cấu hình<textarea rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
    </fieldset>
    {removeIndex !== null && <div className="comp-inline-confirm"><p>Xóa liên kết <strong>{skillName(rows[removeIndex]?.skillId ?? "")}</strong>? Thay đổi được ghi khi lưu toàn bộ cấu hình.</p><div className="cm-actions"><button className="am-outline" disabled={busy} onClick={() => setRemoveIndex(null)}>Giữ liên kết</button><button className="am-primary am-delete" disabled={busy} onClick={() => { setRows(rows.filter((_, index) => index !== removeIndex)); setRemoveIndex(null); }}>Xác nhận xóa</button></div></div>}
    <div className={`comp-weight-total${allocation.canActivate ? " comp-weight-valid" : ""}`} role="status"><span>Tổng trọng số</span><strong>{percentage(allocation.total)} / 100%</strong></div>
    {editing && allocation.errors.length > 0 && <div className="admin-error" role="alert"><ul>{allocation.errors.map(message => <li key={message}>{message}</li>)}</ul></div>}
    {editing && missingSkills && <p className="cm-warning" role="alert">Có kỹ năng không còn cấu hình năng lực. Hãy thay thế hoặc xóa các liên kết đó trước khi lưu bản nháp hoặc áp dụng.</p>}
    {editing && !missingSkills && unavailable && catalogReady && <p className="cm-warning">Có kỹ năng hoặc nhóm ngừng sử dụng. Hãy thay thế hoặc xóa liên kết trước khi áp dụng.</p>}
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    <div className="cm-actions cm-dialog-actions"><button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Đóng</button><div className="cm-dialog-actions-main">{canManage && (editing ? <><button className="am-outline" disabled={busy || !validDraft || removeIndex !== null} onClick={() => void save("draft")}><Icon name="save" />{busy ? "Đang lưu…" : "Lưu bản nháp"}</button><button className="am-primary" disabled={busy || !canActivate || removeIndex !== null} onClick={() => void save("active")}><Icon name="save" />{busy ? "Đang lưu…" : "Lưu và áp dụng"}</button></> : <button className="am-primary" onClick={() => setEditing(true)}><Icon name="edit" />{current.status === "missing" ? "Tạo cấu hình môn học" : "Chỉnh sửa cấu hình môn học"}</button>)}</div></div>
    <CourseHistory entries={current.history} />
  </div>;
}

function CourseHistory({ entries }: { entries: EventEntry[] }) {
  const [page, setPage] = useState(1);
  return <section className="comp-history"><h3>Lịch sử cấu hình</h3>{!entries.length && <p className="comp-hint">Chưa có lần lưu cấu hình.</p>}{entries.slice((page - 1) * 10, page * 10).map(entry => {
    const snapshot = entry.snapshot && typeof entry.snapshot === "object" ? entry.snapshot as Partial<CourseDetail> : null;
    return <details key={entry.id}><summary>{competencyDate(entry.createdAt)} · {entry.actorName || "Hệ thống"}{snapshot?.status && ` · ${statusLabels[snapshot.status]}`}{entry.scope && ` · ${entry.scope}`}</summary>{entry.note && <p>{entry.note}</p>}{snapshot?.note && snapshot.note !== entry.note && <p className="cm-prewrap">Ghi chú: {snapshot.note}</p>}{Array.isArray(snapshot?.links) && <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Trọng số tại thời điểm lưu"><table className="cm-table"><thead><tr><th className="cm-stt">STT</th><th>Kỹ năng tại thời điểm lưu</th><th>Nhóm</th><th>Trọng số</th></tr></thead><tbody>{snapshot.links.map((link, index) => <tr key={link.skillId}><td className="cm-stt">{index + 1}</td><td>{link.skillName}</td><td>{link.groupName}</td><td>{percentage(link.weight)}</td></tr>)}</tbody></table></div>}</details>;
  })}{entries.length > 0 && <Pagination total={entries.length} page={page} setPage={setPage} />}</section>;
}
