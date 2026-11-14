import { useLiveFilters } from "./use-live-filters";
import { nameInitials, personName } from "./person-name";
import { sortParams, useTableSort } from "./table-sort";
import { useEffect, useRef, useState } from "react";
import { useData, Status, Pagination, Modal, ActionMenu, type MenuEntry } from "./admin-ui";
import { CreateAccount, Icon, SignInTime, readResponse, roleLabels, type Account, type AccountPage } from "./admin-account-shared";
import { CheckedForm } from "./CheckedForm";
import { appRoles } from "./types";
import { adminFailureText } from "./admin-errors";
import { formatVnDateTime } from "./display-format";

type Detail = Account & { createdAt: string; firstLoginAt: string | null; updatedAt: string };
type LoginEvent = { id: string; name: string; email: string | null; occurredAt: string; outcome: "success" | "denied"; reason: string; portal: string };
type HistoryPage = { items: LoginEvent[]; total: number };
const date = (value: string) => formatVnDateTime(value);
const roleName = (role: Account["role"]) => roleLabels[role];

function History({ userId }: { userId?: string }) {
  const { draft, setDraft, filters, page, setPage, flush, reset, datesValid } = useLiveFilters({ q: "", outcome: "", portal: "", from: "", to: "" });
  // The server sorts the whole history (admin/accounts.ts); its own order is the newest first.
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  const params = sortParams(sort, new URLSearchParams({ q: filters.q, page: String(page), pageSize: "10" }));
  if (userId) params.set("userId", userId);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.portal) params.set("portal", filters.portal);
  if (filters.from) params.set("from", new Date(`${filters.from}T00:00:00+07:00`).toISOString());
  if (filters.to) params.set("to", new Date(Date.parse(`${filters.to}T00:00:00+07:00`) + 86400000).toISOString());
  const state = useData<HistoryPage>(`/api/admin/accounts/history?${params}`);
  return <section aria-label="Lịch sử đăng nhập"><p className="am-table-note"></p>
    <CheckedForm className="am-filters" onSubmit={(event) => { event.preventDefault(); flush(); }}>
      <label>Nhập từ khóa tìm kiếm<input placeholder="Tên, email, mã kết quả…" maxLength={120} value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} /></label>
      <label>Kết quả<select value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}><option value="">Tất cả kết quả</option><option value="success">Thành công</option><option value="denied">Bị từ chối</option></select></label>
      <label>Cổng đăng nhập<select value={draft.portal} onChange={(e) => setDraft({ ...draft, portal: e.target.value })}><option value="">Tất cả cổng</option><option value="admin">Quản trị</option><option value="student">Sinh viên</option></select></label>
      <label>Từ ngày<input type="date" value={draft.from} max={draft.to || "9999-12-31"} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>Đến ngày<input type="date" value={draft.to} min={draft.from} max="9999-12-30" onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
      <button className="am-quiet" type="button" onClick={reset}>Xóa bộ lọc</button>
      {!datesValid && <p className="admin-error" role="alert">Chọn ngày hợp lệ; ngày bắt đầu không được sau ngày kết thúc.</p>}
    </CheckedForm>
    <Status {...state} />{state.data && <><div className="am-table-scroll" tabIndex={0} role="region" aria-label="Bảng lịch sử đăng nhập"><table className="am-table"><thead><tr>{sortHeader("Thời gian", "occurredAt")}{sortHeader("Người dùng", "name")}{sortHeader("Cổng", "portal")}{sortHeader("Kết quả", "outcome")}{sortHeader("Thông tin", "reason")}</tr></thead><tbody>{state.data.items.map((item) => <tr key={item.id}><td>{date(item.occurredAt)}</td><td><strong>{item.name}</strong><br />{item.email}</td><td>{item.portal === "admin" ? "Quản trị" : "Sinh viên"}</td><td><span className={`am-state ${item.outcome === "denied" ? "am-state-locked" : ""}`}>{item.outcome === "success" ? "Thành công" : "Bị từ chối"}</span></td><td>{({ signed_in: "Đăng nhập thành công", admin_required: "Chưa được cấp quyền quản trị", admin_portal_only: "Tài khoản quản trị không dùng cổng sinh viên", staff_portal_only: "Email nội bộ không dùng cổng sinh viên", callback_failed: "Không hoàn tất xác thực / tài khoản bị khóa" } as Record<string, string>)[item.reason] ?? item.reason}</td></tr>)}</tbody></table></div>{!state.data.items.length && <p className="am-empty">Không có lịch sử đăng nhập phù hợp.</p>}<Pagination total={state.data.total} page={page} setPage={setPage} /></>}
  </section>;
}
/** One account (exported for its test); the sign-in times are green, Chưa đăng nhập red (SignInTime). */
export function AccountDetails({ id }: { id: string }) {
  const state = useData<{ user: Detail }>(`/api/admin/accounts/${id}`);
  return <><Status {...state} />{state.data && <dl className="am-detail-grid">{Object.entries({ "Họ tên": state.data.user.name, "Email": state.data.user.email, "Tên đăng nhập": state.data.user.username, "Vai trò": roleName(state.data.user.role), "Trạng thái": state.data.user.isActive ? "Đang hoạt động" : "Đã khóa", "Ngày tạo": date(state.data.user.createdAt), "Đăng nhập đầu tiên": <SignInTime at={state.data.user.firstLoginAt} />, "Đăng nhập gần nhất": <SignInTime at={state.data.user.lastLoginAt} />, "Cập nhật gần nhất": date(state.data.user.updatedAt) }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>}</>;
}
function ChangeAccount({ account, mode, onClose, onSaved }: { account: Account; mode: "role" | "lock"; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState(account.role);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const title = mode === "role" ? "Phân quyền theo vai trò" : account.isActive ? "Khóa tài khoản" : "Mở khóa tài khoản";
  return <Modal title={title} onClose={onClose} busy={busy}><CheckedForm className="cm-dialog-body cm-form" onSubmit={(event) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null);
    void fetch(`/api/admin/accounts/${account.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(mode === "role" ? { role } : { isActive: !account.isActive }), confirmed }) }).then(readResponse).then(onSaved).catch((err) => setError(adminFailureText(err))).finally(() => setBusy(false));
  }}><p><strong>{account.name}</strong><br />{account.email ?? account.username}</p>{error && <p className="admin-error" role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
    {mode === "role" && <label>Vai trò mới<select value={role} disabled={busy} onChange={(e) => setRole(e.target.value as Account["role"])}>{appRoles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></label>}
    {mode === "role" && role === "advisor" && role !== account.role && <p className="cm-help">Cố vấn học tập chỉ có quyền xem ở trang quản trị. Thêm lớp phụ trách cho tài khoản này ở trang Danh sách cố vấn học tập.</p>}
    <p>Thao tác chỉ áp dụng trong EduPath AI, không thay đổi tài khoản Microsoft. Các phiên EduPath AI hiện tại của người dùng sẽ bị thu hồi; người dùng cần đăng nhập lại.</p>
    <label className="cm-check"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /><span>Tôi xác nhận {mode === "role" ? "phân quyền theo vai trò cho tài khoản này" : account.isActive ? "khóa tài khoản này" : "mở khóa tài khoản này"}.</span></label>
    <div className="cm-actions cm-dialog-actions"><button className="am-outline" type="button" onClick={onClose} disabled={busy}><Icon name="close" /> Hủy</button><button className="am-primary" disabled={busy || (mode === "role" && role === account.role)}><Icon name={mode === "role" ? "save" : account.isActive ? "lock" : "unlock"} /> {busy ? "Đang lưu…" : mode === "role" ? "Lưu vai trò" : account.isActive ? "Xác nhận khóa" : "Xác nhận mở khóa"}</button></div>
  </CheckedForm></Modal>;
}
type MenuAction = "detail" | "history" | "role" | "lock";
function RowMenu({ account, self, canManage, canAssignRoles, onPick }: { account: Account; self: boolean; canManage: boolean; canAssignRoles: boolean; onPick: (mode: MenuAction) => void }) {
  const items: MenuEntry[] = [{ key: "detail", icon: "eye", label: "Xem chi tiết", onSelect: () => onPick("detail") }];
  if (canManage) items.push(
    { key: "history", icon: "clock", label: "Xem lịch sử đăng nhập", onSelect: () => onPick("history") },
    ...(canAssignRoles ? [{ key: "role", icon: "shield", label: "Phân quyền tài khoản", disabled: self, onSelect: () => onPick("role") }] : []),
    account.isActive
      ? { key: "lock", icon: "lock", danger: true, label: "Khóa tài khoản", disabled: self, onSelect: () => onPick("lock") }
      : { key: "lock", icon: "unlock", label: "Mở khóa tài khoản", disabled: self, onSelect: () => onPick("lock") });
  return <ActionMenu label={`Thao tác với ${account.name}`} items={items} note={canManage && self ? "Bạn không thể tự đổi vai trò hoặc khóa tài khoản đang sử dụng." : undefined} />;
}
export default function AccountsManagement({ actorId, canManage = false, canAssignRoles = false }: { actorId: string; canManage?: boolean; canAssignRoles?: boolean }) {
  const { draft, setDraft, filters, page, setPage, flush, reset } = useLiveFilters({ q: "", role: "", active: "" });
  // The server sorts the whole list (admin/accounts.ts); STT stays the row's number in the list by name.
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<"accounts" | "history">("accounts");
  const [modal, setModal] = useState<{ mode: MenuAction; account: Account } | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const params = sortParams(sort, new URLSearchParams({ q: filters.q, page: String(page), pageSize: "10" }));
  if (filters.role) params.set("role", filters.role);
  if (filters.active) params.set("active", filters.active);
  const state = useData<AccountPage>(`/api/admin/accounts?${params}`, revision);
  function refreshed() { setRevision((n) => n + 1); }
  return <><section className="am-card"><div className="am-card-heading"><div><h2>Tài khoản người dùng {state.data && <span className="am-count">{state.data.total}</span>}</h2><p>Tài khoản, phân quyền và lịch sử đăng nhập ở cùng một nơi.</p></div>{canAssignRoles && <button className="am-primary" onClick={() => setCreating(true)}><Icon name="add" />Tạo tài khoản quản trị</button>}</div>
    <div className="am-view-switch" role="group" aria-label="Chế độ xem"><button aria-pressed={tab === "accounts"} onClick={() => setTab("accounts")}>Tài khoản</button>{canManage && <button aria-pressed={tab === "history"} onClick={() => setTab("history")}>Lịch sử đăng nhập</button>}</div>
    {notice && <p className="am-notice" role="status">{notice}</p>}
    {tab === "history" ? <History /> : <><CheckedForm className="am-filters" onSubmit={(event) => { event.preventDefault(); flush(); }}>
      <label>Nhập từ khóa tìm kiếm<input placeholder="Họ tên hoặc email…" maxLength={120} value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} /></label>
      <label>Vai trò<select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}><option value="">Tất cả vai trò</option>{appRoles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></label>
      <label>Trạng thái<select value={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.value })}><option value="">Tất cả trạng thái</option><option value="true">Đang hoạt động</option><option value="false">Đã khóa</option></select></label>
      <button className="am-quiet" type="button" onClick={reset}>Xóa bộ lọc</button>
    </CheckedForm><Status {...state} />{state.data && <><div className="am-table-scroll" tabIndex={0} role="region" aria-label="Bảng tài khoản người dùng"><table className="am-table"><thead><tr>{sortHeader("STT", "stt")}{sortHeader("Người dùng", "name")}{sortHeader("Vai trò", "role")}{sortHeader("Trạng thái", "isActive")}{sortHeader("Đăng nhập gần nhất", "lastLoginAt")}<th>Thao tác</th></tr></thead><tbody>{state.data.items.map((account, index) => <tr key={account.id}><td>{account.stt ?? (page - 1) * 10 + index + 1}</td><td><div className="am-person"><span className="am-avatar" aria-hidden="true">{nameInitials(personName(account.name)) || account.name.slice(0, 1)}</span><div><button className="am-name-link" onClick={() => setModal({ mode: "detail", account })}>{account.name}</button><small>{account.email ?? account.username}</small></div></div></td><td><span className={`am-badge ${account.role === "admin" ? "am-badge-admin" : ""}`}>{roleName(account.role)}</span></td><td><span className={`am-state ${account.isActive ? "" : "am-state-locked"}`}>{account.isActive ? "Đang hoạt động" : "Đã khóa"}</span></td><td><SignInTime at={account.lastLoginAt} /></td><td><RowMenu account={account} self={account.id === actorId} canManage={canManage} canAssignRoles={canAssignRoles} onPick={(mode) => setModal({ mode, account })} /></td></tr>)}</tbody></table></div>{!state.data.items.length && <p className="am-empty">Không tìm thấy tài khoản phù hợp.</p>}<Pagination total={state.data.total} page={page} setPage={setPage} /></>}
      <p className="am-table-note"></p></>}
  </section>
    {canAssignRoles && creating && <Modal title="Tạo tài khoản quản trị" busy={creatingBusy} onClose={() => { setCreating(false); refreshed(); }}><CreateAccount onBusy={setCreatingBusy} onList={() => { setCreating(false); refreshed(); }} /></Modal>}
    {modal && ((canAssignRoles && modal.mode === "role") || (canManage && modal.mode === "lock")) && <ChangeAccount account={modal.account} mode={modal.mode} onClose={() => setModal(null)} onSaved={() => { setModal(null); refreshed(); setNotice("Đã cập nhật tài khoản và thu hồi các phiên đăng nhập cũ."); }} />}
    {modal && (modal.mode === "detail" || modal.mode === "history") && <Modal title={`${modal.mode === "detail" ? "Chi tiết tài khoản" : "Lịch sử đăng nhập"} — ${modal.account.name}`} onClose={() => setModal(null)}>{modal.mode === "detail" ? <AccountDetails id={modal.account.id} /> : <History userId={modal.account.id} />}<div className="am-form-actions am-dialog-footer"><button className="am-outline" type="button" onClick={() => setModal(null)}><Icon name="close" /> Đóng</button></div></Modal>}
  </>;
}
