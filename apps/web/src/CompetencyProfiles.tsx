import { useEffect, useRef, useState } from "react";
import { ActionMenu, Modal, Pagination, Status } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { searchTerm } from "./student-curriculum-types";
import { useLiveFilters } from "./use-live-filters";
import {
  COMPETENCY_API, competencyDate, competencyRequest, percentage, skillGroups, statusLabels,
  useCompetencyData, type CatalogSkill, type EventEntry, type Group, type Skill, type SkillDetail,
} from "./competency-types";
import { CheckedForm, DescriptionField } from "./CheckedForm";
import { DESCRIPTION_MAX_WORDS, LONG_DESCRIPTION_MAX_WORDS } from "./form-checks";

type TabProps = { canManage: boolean; revision: number; onSaved: () => void };
type EditorProps<T> = { current: T | null; close: () => void; saved: () => void };
type GroupDetail = Group & { skills?: Skill[]; history?: EventEntry[] };

/** A profile's groups (2026-10-22: one or more), naming the ones no longer in use. */
function GroupNames({ skill }: { skill: Skill }) {
  const groups = skillGroups(skill), inactive = groups.filter(group => !group.isActive);
  return <>{groups.map(group => group.name).join(", ")}{inactive.length > 0 && <small className="comp-hint">Nhóm ngừng sử dụng{groups.length > 1 ? `: ${inactive.map(group => group.name).join(", ")}` : ""}</small>}</>;
}

/** Group names of a history snapshot: every group since 2026-10-22, the single group before. */
function snapshotGroups(snapshot: Record<string, unknown>): string {
  const groups = Array.isArray(snapshot.groups) ? snapshot.groups.map(group => (group && typeof group === "object" ? String((group as { name?: unknown }).name ?? "") : "")).filter(Boolean) : [];
  return groups.length ? groups.join(", ") : String(snapshot.groupName ?? "");
}

function ProfileState({ active }: { active: boolean }) {
  return <span className={`comp-state${active ? "" : " comp-state-inactive"}`}>{active ? "Đang sử dụng" : "Ngừng sử dụng"}</span>;
}

export function CompetencyGroupsTab({ canManage, revision, onSaved }: TabProps) {
  const remote = useCompetencyData<{ items: Group[] }>(`${COMPETENCY_API}/groups`, revision);
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({ q: "", active: "" });
  const [selected, setSelected] = useState<Group | null>(null);
  const [mode, setMode] = useState<"detail" | "edit" | "delete" | null>(null);
  const close = () => { setSelected(null); setMode(null); };
  const saved = () => { close(); onSaved(); };
  const items = remote.data?.items.filter(group =>
    searchTerm(`${group.name} ${group.description}`).includes(searchTerm(filters.q)) &&
    (!filters.active || String(group.isActive) === filters.active)) ?? [];

  return <section className="cm-workspace comp-workspace">
    <div className="cm-toolbar">
      <p>Phân nhóm các kỹ năng dùng để đánh giá năng lực.</p>
      {canManage && <button className="am-primary" onClick={() => { setSelected(null); setMode("edit"); }}><Icon name="plus" /> Thêm nhóm năng lực</button>}
    </div>
    <section className="cm-panel">
      <div className="cm-filters">
        <label className="cm-search">Tìm nhóm năng lực<input value={draft.q} maxLength={200} placeholder="Tên hoặc mô tả nhóm…" onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>
        <label>Trạng thái<select value={draft.active} onChange={event => setDraft({ ...draft, active: event.target.value })}><option value="">Tất cả</option><option value="true">Đang sử dụng</option><option value="false">Ngừng sử dụng</option></select></label>
        <button className="am-outline" onClick={reset}><Icon name="refresh" /> Xóa bộ lọc</button>
      </div>
      <Status {...remote} />
      {remote.data && <>
        <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Bảng nhóm năng lực"><table className="cm-table comp-group-table">
          <thead><tr><th className="cm-stt">STT</th><th>Nhóm năng lực</th><th>Mô tả</th><th>Số kỹ năng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>{items.slice((page - 1) * 10, page * 10).map((group, index) => <tr key={group.id}>
            <td className="cm-stt">{(page - 1) * 10 + index + 1}</td>
            <td><button className="am-name-link" onClick={() => { setSelected(group); setMode("detail"); }}>{group.name}</button></td>
            <td className="comp-description">{group.description || "Chưa bổ sung"}</td>
            <td>{group.skillCount}</td><td><ProfileState active={group.isActive} /></td>
            <td><ActionMenu label={`Thao tác với nhóm ${group.name}`} items={[
              { key: "detail", icon: "eye", label: "Xem chi tiết", onSelect: () => { setSelected(group); setMode("detail"); } },
              ...(canManage ? [
                { key: "edit", icon: "edit", label: "Chỉnh sửa nhóm năng lực", onSelect: () => { setSelected(group); setMode("edit"); } },
                { key: "delete", icon: "trash", label: "Xóa nhóm năng lực", danger: true, onSelect: () => { setSelected(group); setMode("delete"); } },
              ] : []),
            ]} /></td>
          </tr>)}</tbody>
        </table></div>
        {!items.length && <p className="am-empty">Không có nhóm năng lực phù hợp.</p>}
        <Pagination total={items.length} page={page} setPage={setPage} />
      </>}
    </section>
    {mode === "detail" && selected && <GroupDetails current={selected} revision={revision} canManage={canManage} close={close} edit={group => { setSelected(group); setMode("edit"); }} />}
    {canManage && mode === "edit" && <GroupEditor current={selected} close={close} saved={saved} />}
    {canManage && mode === "delete" && selected && <GroupDelete current={selected} close={close} saved={saved} />}
  </section>;
}

/** "Xóa nhóm năng lực": only an empty group can go; its history is kept. */
function GroupDelete({ current, close, saved }: { current: Group; close: () => void; saved: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const empty = current.skillCount === 0;
  return <Modal title="Xóa nhóm năng lực" onClose={close} busy={busy} size="sm">
    <div className="cm-dialog-body cm-form">
      {empty ? <p>Xóa nhóm <strong>{current.name}</strong> khỏi danh mục? Nhóm không còn kỹ năng nào. Lịch sử thay đổi của nhóm vẫn được giữ.</p>
        : <p className="cm-warning" role="alert">Nhóm <strong>{current.name}</strong> còn {current.skillCount} kỹ năng. Hãy chuyển các kỹ năng sang nhóm khác hoặc xóa chúng ở trang Cấu hình năng lực trước khi xóa nhóm.</p>}
      {empty && <label className="cm-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>Tôi xác nhận xóa nhóm năng lực này.</span></label>}
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> {empty ? "Hủy" : "Đóng"}</button>
        {empty && <button type="button" className="am-primary am-delete" disabled={busy || !confirmed} onClick={async () => {
          setBusy(true); setError("");
          try {
            await competencyRequest(`${COMPETENCY_API}/groups/${current.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-version": current.version }, body: JSON.stringify({ confirmed: true }) });
            saved();
          } catch (failure) { setError((failure as Error).message); }
          finally { setBusy(false); }
        }}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa"}</button>}
      </div>
    </div>
  </Modal>;
}

function GroupDetails({ current, revision, canManage, close, edit }: { current: Group; revision: number; canManage: boolean; close: () => void; edit: (group: Group) => void }) {
  const remote = useCompetencyData<GroupDetail>(`${COMPETENCY_API}/groups/${current.id}`, revision);
  const [page, setPage] = useState(1);
  const detail = remote.data;
  return <Modal title={`Chi tiết nhóm năng lực — ${current.name}`} onClose={close}>
    <div className="cm-dialog-body cm-form">
      <Status {...remote} />
      {detail && <>
        <dl className="comp-detail-grid">
          <div><dt>Tên nhóm</dt><dd>{detail.name}</dd></div>
          <div><dt>Mô tả</dt><dd className="comp-description">{detail.description || "Chưa bổ sung mô tả."}</dd></div>
          <div><dt>Số kỹ năng</dt><dd>{detail.skillCount}</dd></div>
          <div><dt>Trạng thái</dt><dd><ProfileState active={detail.isActive} /></dd></div>
        </dl>
        {detail.skills && <section className="comp-section">
          <h3>Kỹ năng thuộc nhóm</h3>
          {detail.skills.length ? <>
            <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Các kỹ năng thuộc nhóm"><table className="cm-table">
              <thead><tr><th className="cm-stt">STT</th><th>Kỹ năng</th><th>Phạm vi đánh giá</th><th>Trạng thái</th></tr></thead>
              <tbody>{detail.skills.slice((page - 1) * 10, page * 10).map((skill, index) => <tr key={skill.id}><td className="cm-stt">{(page - 1) * 10 + index + 1}</td><td><strong>{skill.name}</strong></td><td className="comp-description">{skill.scope || "Chưa bổ sung."}</td><td><ProfileState active={skill.isActive} /></td></tr>)}</tbody>
            </table></div>
            <Pagination total={detail.skills.length} page={page} setPage={setPage} />
          </> : <p className="am-empty">Chưa có kỹ năng thuộc nhóm này.</p>}
        </section>}
        <ProfileHistory entries={detail.history ?? []} entity="group" />
      </>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button>
        {canManage && detail && <button className="am-primary" onClick={() => edit(detail)}><Icon name="edit" /> Chỉnh sửa nhóm năng lực</button>}
      </div>
    </div>
  </Modal>;
}

function GroupEditor({ current, close, saved }: EditorProps<Group>) {
  const [form, setForm] = useState({ name: current?.name ?? "", description: current?.description ?? "", isActive: current?.isActive ?? true });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false);
  return <Modal title={current ? "Chỉnh sửa nhóm năng lực" : "Thêm nhóm năng lực"} onClose={close} busy={busy}>
    <CheckedForm className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault(); if (submitting.current) return;
      submitting.current = true; setBusy(true); setError("");
      try {
        await competencyRequest(current ? `${COMPETENCY_API}/groups/${current.id}` : `${COMPETENCY_API}/groups`, {
          method: current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(current ? { "x-version": current.version } : {}) },
          body: JSON.stringify(form),
        }); saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { submitting.current = false; setBusy(false); }
    }}>
      <fieldset className="cm-fields" disabled={busy}>
        <label><RequiredLabel>Tên nhóm năng lực</RequiredLabel><input required maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <DescriptionField label="Mô tả" maxWords={DESCRIPTION_MAX_WORDS} rows={4} maxLength={2000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
        <label className="cm-check"><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} /> Đang sử dụng</label>
        {current && <p className="comp-hint">Để ngừng sử dụng nhóm, cần điều chỉnh các cấu hình môn học đang áp dụng có kỹ năng thuộc nhóm này.</p>}
      </fieldset>
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        {error && <button type="button" className="am-outline" disabled={busy} onClick={saved}><Icon name="refresh" /> Đóng và tải lại</button>}
        <button className="am-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu nhóm năng lực"}</button>
      </div>
    </CheckedForm>
  </Modal>;
}

export function CompetencySkillsTab({ canManage, revision, onSaved }: TabProps) {
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({ q: "", groupId: "", active: "" });
  const remote = useCompetencyData<{ items: Skill[] }>(`${COMPETENCY_API}/skills?${new URLSearchParams(filters)}`, revision);
  const groups = useCompetencyData<{ items: Group[] }>(`${COMPETENCY_API}/groups`, revision);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [mode, setMode] = useState<"detail" | "edit" | "delete" | null>(null);
  const close = () => { setMode(null); setSelected(null); };
  const saved = () => { close(); onSaved(); };

  return <section className="cm-workspace comp-workspace">
    <div className="cm-toolbar">
      <p>Mỗi cấu hình năng lực gồm một kỹ năng, một hoặc nhiều nhóm năng lực, phạm vi đánh giá và trạng thái sử dụng.</p>
      {canManage && <button className="am-primary" onClick={() => { setSelected(null); setMode("edit"); }}><Icon name="plus" /> Thêm cấu hình năng lực</button>}
    </div>
    <section className="cm-panel">
      <div className="cm-filters">
        <label className="cm-search">Tìm kỹ năng<input value={draft.q} maxLength={200} placeholder="Tên, mô tả hoặc phạm vi…" onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>
        <label>Nhóm năng lực<select value={draft.groupId} disabled={groups.loading} onChange={event => setDraft({ ...draft, groupId: event.target.value })}>
          <option value="">Tất cả nhóm</option>{groups.data?.items.map(group => <option key={group.id} value={group.id}>{group.name}{group.isActive ? "" : " (ngừng sử dụng)"}</option>)}
        </select></label>
        <label>Trạng thái<select value={draft.active} onChange={event => setDraft({ ...draft, active: event.target.value })}><option value="">Tất cả</option><option value="true">Đang sử dụng</option><option value="false">Ngừng sử dụng</option></select></label>
        <button className="am-outline" onClick={reset}><Icon name="refresh" /> Xóa bộ lọc</button>
      </div>
      {groups.error && <Status {...groups} />}
      <Status {...remote} />
      {remote.data && <>
        <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Bảng cấu hình năng lực"><table className="cm-table comp-skill-table">
          <thead><tr><th className="cm-stt">STT</th><th>Kỹ năng</th><th>Nhóm năng lực</th><th>Phạm vi</th><th>Trạng thái</th><th>Liên kết</th><th>Thao tác</th></tr></thead>
          <tbody>{remote.data.items.slice((page - 1) * 10, page * 10).map((skill, index) => <tr key={skill.id}>
            <td className="cm-stt">{(page - 1) * 10 + index + 1}</td>
            <td><button className="am-name-link" onClick={() => { setSelected(skill); setMode("detail"); }}>{skill.name}</button></td>
            <td><GroupNames skill={skill} /></td>
            <td className="comp-description">{skill.scope || "Chưa bổ sung"}</td>
            <td><ProfileState active={skill.isActive} /></td>
            <td>{skill.courseCount} môn học<br />{skill.careerCount} nghề nghiệp</td>
            <td><ActionMenu label={`Thao tác với kỹ năng ${skill.name}`} items={[
              { key: "detail", icon: "eye", label: "Xem chi tiết", onSelect: () => { setSelected(skill); setMode("detail"); } },
              ...(canManage ? [
                { key: "edit", icon: "edit", label: "Chỉnh sửa cấu hình năng lực", onSelect: () => { setSelected(skill); setMode("edit"); } },
                { key: "delete", icon: "trash", label: "Xóa cấu hình năng lực", danger: true, onSelect: () => { setSelected(skill); setMode("delete"); } },
              ] : []),
            ]} /></td>
          </tr>)}</tbody>
        </table></div>
        {!remote.data.items.length && <p className="am-empty">Không có kỹ năng phù hợp.</p>}
        <Pagination total={remote.data.items.length} page={page} setPage={setPage} />
      </>}
    </section>
    {mode === "detail" && selected && <SkillDetails current={selected} revision={revision} canManage={canManage} close={close} edit={skill => { setSelected(skill); setMode("edit"); }} />}
    {canManage && mode === "edit" && <SkillEditor current={selected} revision={revision} groups={groups.data?.items ?? []} close={close} saved={saved} />}
    {canManage && mode === "delete" && selected && <SkillDelete current={selected} close={close} saved={saved} />}
  </section>;
}

/** Same comparison as the server: whitespace, case and accents ignored. */
const skillKey = (name: string) => searchTerm(name.replace(/\s+/g, " "));

export function SkillEditor({ current, revision, groups, close, saved }: EditorProps<Skill> & { revision: number; groups: Group[] }) {
  // No "Nguồn kỹ năng" choice (user, 2026-10-18): a name already in the Kỹ năng catalog reuses that skill,
  // and a skill that already has a cấu hình năng lực is edited from the list instead.
  const catalog = useCompetencyData<{ items: CatalogSkill[] }>(`${COMPETENCY_API}/catalog`, revision);
  const profiles = useCompetencyData<{ items: Skill[] }>(`${COMPETENCY_API}/skills`, revision);
  // No "Chọn nhóm năng lực" placeholder (user, 2026-10-20): a new profile starts in the first group in use.
  const firstGroup = groups.find(group => group.isActive)?.id ?? groups[0]?.id ?? "";
  // One or more groups (user, 2026-10-22: "Viết tài liệu" is Kỹ năng mềm and also Chuyên môn): the skill score counts in each.
  const [form, setForm] = useState({ name: current?.name ?? "", description: current?.description ?? "", scope: current?.scope ?? "",
    groupIds: current ? skillGroups(current).map(group => group.id) : firstGroup ? [firstGroup] : [], isActive: current?.isActive ?? true });
  // The groups can arrive after the dialog opens: the shown groups and the saved ones stay the same.
  useEffect(() => { if (firstGroup) setForm(previous => previous.groupIds.length ? previous : { ...previous, groupIds: [firstGroup] }); }, [firstGroup]);
  // Groups of the profile that the list no longer has (deleted) stay visible, so the admin can untick them.
  const groupOptions = [...groups, ...(current ? skillGroups(current).filter(group => !groups.some(item => item.id === group.id)) : [])];
  const toggleGroup = (id: string) => setForm(previous => ({ ...previous,
    groupIds: previous.groupIds.includes(id) ? previous.groupIds.filter(item => item !== id) : [...previous.groupIds, id] }));
  const firstGroupBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const box = firstGroupBox.current;
    if (!box) return;
    box.setCustomValidity(form.groupIds.length ? "" : "Chọn ít nhất một nhóm năng lực.");
    // Ticking any group clears the message CheckedForm wrote under the first box (it rechecks only the box clicked).
    if (form.groupIds.length && box.getAttribute("aria-invalid") === "true") { box.removeAttribute("aria-invalid"); box.closest("label")?.removeAttribute("data-error"); }
  }, [form.groupIds.length, groupOptions.length]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false);
  const match = !current && form.name.trim() ? catalog.data?.items.find(skill => skillKey(skill.name) === skillKey(form.name)) : undefined;
  const profiled = Boolean(match && profiles.data?.items.some(skill => skill.id === match.id));
  const keepsDescription = Boolean(match?.description);
  const canSave = Boolean(form.groupIds.length && form.name.trim() && !profiled);
  const profiledMessage = (name: string) => `Kỹ năng “${name}” đã có cấu hình năng lực. Muốn thêm nhóm năng lực cho kỹ năng này, hãy tìm trong danh sách và dùng “Chỉnh sửa cấu hình năng lực”.`;

  return <Modal title={current ? "Chỉnh sửa cấu hình năng lực" : "Thêm cấu hình năng lực"} onClose={close} busy={busy}>
    <CheckedForm className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault();
      if (submitting.current) return;
      if (!canSave) { setError(profiled ? profiledMessage(match?.name ?? form.name.trim()) : "Hãy nhập tên kỹ năng và chọn ít nhất một nhóm năng lực."); return; }
      submitting.current = true; setBusy(true); setError("");
      try {
        await competencyRequest(current ? `${COMPETENCY_API}/skills/${current.id}` : `${COMPETENCY_API}/skills`, {
          method: current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(current ? { "x-version": current.version } : {}) },
          // The groups in the order of the list, so the first group is the same whatever the ticking order.
          body: JSON.stringify({ ...form, groupIds: groupOptions.filter(group => form.groupIds.includes(group.id)).map(group => group.id) }),
        }); saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { submitting.current = false; setBusy(false); }
    }}>
      <fieldset className="cm-fields" disabled={busy}>
        <label><RequiredLabel>Tên kỹ năng</RequiredLabel><input required maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        {match && (profiled
          ? <p className="admin-error" role="alert">{profiledMessage(match.name)}</p>
          : <p className="comp-hint">“{match.name}” đã có trong danh mục Kỹ năng: cấu hình năng lực sẽ dùng kỹ năng này{keepsDescription ? " và giữ mô tả hiện có" : ""}.</p>)}
        <DescriptionField label="Mô tả kỹ năng chung" maxWords={DESCRIPTION_MAX_WORDS} rows={3} maxLength={2000} readOnly={keepsDescription} value={keepsDescription ? match?.description ?? "" : form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
        <fieldset className="comp-group-picks">
          <legend><RequiredLabel>Nhóm năng lực</RequiredLabel></legend>
          {groupOptions.map((group, index) => <label key={group.id} className="cm-check"><input ref={index === 0 ? firstGroupBox : undefined} type="checkbox"
            checked={form.groupIds.includes(group.id)} onChange={() => toggleGroup(group.id)} /> {group.name}{group.isActive ? "" : " (ngừng sử dụng)"}</label>)}
          <p className="comp-hint">Chọn một hoặc nhiều nhóm. Điểm kỹ năng được tính vào từng nhóm đã chọn. Mức độ quan trọng của kỹ năng đối với từng nghề được đặt trong phần yêu cầu của nghề (Bắt buộc/Ưu tiên).</p>
        </fieldset>
        {!groups.length && <p className="comp-hint">Chưa tải được nhóm năng lực. Đóng hộp thoại và tải lại danh sách nhóm trước khi lưu.</p>}
        <DescriptionField label="Phạm vi đánh giá" maxWords={LONG_DESCRIPTION_MAX_WORDS} rows={5} maxLength={4000} value={form.scope} placeholder="Nội dung và phạm vi đánh giá kỹ năng…" onChange={event => setForm({ ...form, scope: event.target.value })} />
        <label className="cm-check"><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} /> Đang sử dụng trong đánh giá năng lực</label>
        {current && <p className="comp-hint">Tên và mô tả dùng chung với mục Quản lý nghề nghiệp. Việc chỉnh sửa sẽ cập nhật thông tin liên quan. Để ngừng sử dụng kỹ năng, cần điều chỉnh các cấu hình môn học đang áp dụng kỹ năng này.</p>}
      </fieldset>
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        {error && <button type="button" className="am-outline" disabled={busy} onClick={saved}><Icon name="refresh" /> Đóng và tải lại</button>}
        <button className="am-primary" disabled={busy || profiled}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu cấu hình năng lực"}</button>
      </div>
    </CheckedForm>
  </Modal>;
}

function SkillDetails({ current, revision, canManage, close, edit }: { current: Skill; revision: number; canManage: boolean; close: () => void; edit: (skill: Skill) => void }) {
  const remote = useCompetencyData<SkillDetail>(`${COMPETENCY_API}/skills/${current.id}`, revision);
  const [page, setPage] = useState(1);
  const detail = remote.data;
  return <Modal title={`Chi tiết cấu hình năng lực — ${current.name}`} onClose={close}>
    <div className="cm-dialog-body cm-form">
      <Status {...remote} />
      {detail && <>
        <dl className="comp-detail-grid">
          <div><dt>Tên kỹ năng</dt><dd>{detail.name}</dd></div>
          <div><dt>Nhóm năng lực</dt><dd><GroupNames skill={detail} /></dd></div>
          <div><dt>Mô tả kỹ năng chung</dt><dd className="comp-description">{detail.description || "Chưa bổ sung."}</dd></div>
          <div><dt>Phạm vi đánh giá</dt><dd className="comp-description">{detail.scope || "Chưa bổ sung."}</dd></div>
          <div><dt>Trạng thái sử dụng</dt><dd><ProfileState active={detail.isActive} /></dd></div>
          <div><dt>Liên kết nghề nghiệp</dt><dd>{detail.careerCount} nghề nghiệp</dd></div>
          {detail.legacySkillId && <div><dt>Dữ liệu đánh giá cũ</dt><dd>Giữ liên kết với dữ liệu đánh giá cũ.</dd></div>}
        </dl>
        <section className="comp-section">
          <h3>Môn học liên kết và đóng góp</h3>
          <p className="comp-hint">Đóng góp được tính từ cấu hình môn học đang áp dụng có trọng số lớn hơn 0. Mỗi môn có một cấu hình dùng chung cho mọi khóa có môn đó.</p>
          {detail.contributions.length ? <>
            <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Môn học đóng góp vào năng lực"><table className="cm-table">
              <thead><tr><th className="cm-stt">STT</th><th>Môn học</th><th>Khóa áp dụng</th><th>Trọng số</th><th>Cấu hình môn học</th></tr></thead>
              <tbody>{detail.contributions.slice((page - 1) * 10, page * 10).map((item, index) => <tr key={item.courseId}>
                <td className="cm-stt">{(page - 1) * 10 + index + 1}</td>
                <td><strong>{item.courseCode}</strong><br />{item.courseName}</td>
                <td>{item.cohorts.join(", ")}</td>
                <td>{percentage(item.weight)}{item.weight === 0 && <small className="comp-hint">Không đóng góp</small>}</td>
                <td>{statusLabels[item.status]}</td>
              </tr>)}</tbody>
            </table></div>
            <Pagination total={detail.contributions.length} page={page} setPage={setPage} />
          </> : <p className="am-empty">Chưa có môn học liên kết với cấu hình năng lực này.</p>}
        </section>
        <ProfileHistory entries={detail.history ?? detail.events ?? []} entity="skill" />
      </>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button>
        {canManage && detail && <button className="am-primary" onClick={() => edit(detail)}><Icon name="edit" /> Chỉnh sửa cấu hình năng lực</button>}
      </div>
    </div>
  </Modal>;
}

function ProfileHistory({ entries, entity }: { entries: EventEntry[]; entity: "skill" | "group" }) {
  const [page, setPage] = useState(1);
  return <section className="comp-section">
    <h3>Lịch sử thay đổi</h3>
    {entries.length ? <>
      <ol className="comp-history">{entries.slice((page - 1) * 10, page * 10).map(entry => {
        const snapshot = entry.snapshot && typeof entry.snapshot === "object" ? entry.snapshot as Record<string, unknown> : {};
        return <li key={entry.id}>
          <div className="comp-history-meta"><time dateTime={entry.createdAt}>{competencyDate(entry.createdAt)}</time><span>{entry.actorName || "Hệ thống"}</span></div>
          <p className="cm-prewrap">{entry.note || (entity === "group" ? "Cập nhật nhóm năng lực" : "Cập nhật cấu hình năng lực")}</p>
          {(typeof snapshot.name === "string" || typeof snapshot.scope === "string" || typeof snapshot.isActive === "boolean") && <details>
            <summary>Thông tin tại thời điểm thay đổi</summary>
            <dl className="comp-detail-grid comp-snapshot">
              {typeof snapshot.name === "string" && <div><dt>{entity === "group" ? "Tên nhóm" : "Tên kỹ năng"}</dt><dd>{snapshot.name}</dd></div>}
              {typeof snapshot.description === "string" && <div><dt>Mô tả</dt><dd className="comp-description">{snapshot.description || "Chưa bổ sung."}</dd></div>}
              {typeof snapshot.groupName === "string" && <div><dt>Nhóm năng lực</dt><dd>{snapshotGroups(snapshot)}</dd></div>}
              {typeof snapshot.scope === "string" && <div><dt>Phạm vi</dt><dd className="comp-description">{snapshot.scope || "Chưa bổ sung."}</dd></div>}
              {typeof snapshot.skillCount === "number" && <div><dt>Số kỹ năng</dt><dd>{snapshot.skillCount}</dd></div>}
              {typeof snapshot.isActive === "boolean" && <div><dt>Trạng thái</dt><dd><ProfileState active={snapshot.isActive} /></dd></div>}
            </dl>
          </details>}
        </li>;
      })}</ol>
      <Pagination total={entries.length} page={page} setPage={setPage} />
    </> : <p className="am-empty">Chưa có lịch sử thay đổi.</p>}
  </section>;
}

function SkillDelete({ current, close, saved }: { current: Skill; close: () => void; saved: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false);
  return <Modal title="Xóa cấu hình năng lực" onClose={close} busy={busy} size="sm">
    <CheckedForm className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault(); if (!confirmed || submitting.current) return;
      submitting.current = true; setBusy(true); setError("");
      try {
        await competencyRequest(`${COMPETENCY_API}/skills/${current.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-version": current.version }, body: JSON.stringify({ confirmed: true }) }); saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { submitting.current = false; setBusy(false); }
    }}>
      <strong>{current.name}</strong>
      <p>Cấu hình năng lực sẽ bị xóa, kỹ năng không còn được dùng để đánh giá năng lực. Kỹ năng chung và các liên kết nghề nghiệp vẫn được giữ lại.</p>
      <p className="comp-hint">Cần xóa liên kết kỹ năng này khỏi các cấu hình môn học đang áp dụng trước khi xóa cấu hình.</p>
      <label className="cm-check"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> Tôi xác nhận xóa cấu hình năng lực này.</label>
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        {error && <button type="button" className="am-outline" disabled={busy} onClick={saved}><Icon name="refresh" /> Đóng và tải lại</button>}
        <button className="am-primary am-delete" disabled={busy || !confirmed}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
      </div>
    </CheckedForm>
  </Modal>;
}
