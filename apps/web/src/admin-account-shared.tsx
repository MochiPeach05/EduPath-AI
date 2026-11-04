import type { AppRole } from "./types";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "./ui-icon";
import { CheckedForm } from "./CheckedForm";
import { adminFailureText, readAdminResponse } from "./admin-errors";
export { Icon } from "./ui-icon";
const failures: Record<string, string> = {
  student_not_found: "Không tìm thấy sinh viên hoặc tài khoản không còn mang vai trò Sinh viên.",
  invalid_student_id: "Mã hồ sơ sinh viên không hợp lệ. Vui lòng đóng hộp thoại và tải lại danh sách.",
  invalid_account_id: "Mã tài khoản không hợp lệ. Vui lòng tải lại danh sách tài khoản.",
  self_change_forbidden: "Không thể tự thay đổi quyền hoặc khóa tài khoản đang sử dụng.",
  last_admin_required: "Không thể khóa quản trị viên cuối cùng còn hoạt động.",
  account_not_found: "Không tìm thấy tài khoản trong hệ thống.",
  invalid_query: "Bộ lọc hoặc khoảng ngày chưa hợp lệ.",
  already_admin: "Tài khoản này đã là quản trị viên. Không cần tạo lại.",
  account_locked: "Tài khoản đang bị khóa. Không thể thêm làm quản trị viên.",
  ambiguous_account: "Email này trùng với nhiều tài khoản. Cần kiểm tra dữ liệu trước khi cấp quyền.",
  insufficient_role: "Bạn không còn quyền thực hiện thao tác này. Hãy đăng xuất và kiểm tra lại tài khoản.",
  database_required: "Chức năng quản lý tài khoản cần kết nối cơ sở dữ liệu; hiện đang ở chế độ xem thử.",
  invalid_input: "Email hoặc xác nhận quyền quản trị chưa hợp lệ.",
  invalid_origin: "Yêu cầu không hợp lệ. Vui lòng tải lại trang rồi thử lại.",
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng xuất và đăng nhập lại."
};
export type Account = { stt?: number; id: string; name: string; email: string | null; username: string | null; role: AppRole; isActive: boolean; lastLoginAt: string | null };
export type AccountPage = { items: Account[]; total: number; page: number; pageSize: number };

/** A field label ending in the red asterisk that marks the field as required.
    The asterisk is hidden from screen readers, which announce the input's own
    required state instead. */
export function RequiredLabel({ children }: { children: ReactNode }) {
  return <span>{children}<span className="am-required" aria-hidden="true">*</span></span>;
}

/** The JSON of a Tài khoản or Sinh viên response; a failure is worded by admin-errors.ts, with this page's texts first. */
export function readResponse<T>(response: Response): Promise<T> {
  return readAdminResponse<T>(response, failures);
}

export function CreateAccount({ onList, onBusy }: { onList: () => void; onBusy?: (busy: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusy?.(busy); }, [busy, onBusy]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Account | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await fetch("/api/admin/accounts", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase(), confirmAdmin: confirmed }) }).then(readResponse<{ user: Account }>);
      setCreated(result.user);
    } catch (err) { setError(adminFailureText(err)); }
    finally { setBusy(false); }
  }
  return <div className="am-create-layout"><section className="am-card am-create-card"><p className="admin-eyebrow">TÀI KHOẢN MICROSOFT · EDUPATH AI</p><h2>Thêm quản trị viên</h2><p>Cấp quyền quản trị theo email Microsoft, kể cả khi người dùng chưa đăng nhập EduPath AI.</p>
    {created ? <div className="am-success" role="status"><Icon name="shield" /><h3>Đã thêm quản trị viên</h3><p><strong>{created.name}</strong><br />{created.email ?? created.username}</p><p>Người dùng đăng nhập tại <code>/quantri</code> bằng đúng email Microsoft đã được cấp quyền. Nếu đang có phiên đăng nhập, hãy đăng xuất rồi đăng nhập lại để nhận quyền mới.</p><button className="am-outline" onClick={onList}><Icon name="back" /> Trở về danh sách</button></div>
      : <CheckedForm className="cm-form" onSubmit={(event) => void submit(event)}>
        {error && <p ref={errorRef} tabIndex={-1} className="admin-error" role="alert">{error}</p>}
        <label htmlFor="new-admin-email"><RequiredLabel>Email Microsoft</RequiredLabel><input id="new-admin-email" type="email" autoComplete="off" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ten@vlu.edu.vn" aria-describedby="new-admin-help" disabled={busy} /><span id="new-admin-help" className="cm-help">Nhập đúng địa chỉ dùng để đăng nhập Microsoft. Có thể thêm trước lần đăng nhập đầu tiên vào EduPath AI.</span></label>
        <label>Vai trò được cấp<input readOnly value="Quản trị viên" /></label>
        <label className="cm-check"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} /><span>Tôi xác nhận cấp quyền quản trị EduPath AI cho tài khoản trên.</span></label>
        <div className="cm-actions cm-dialog-actions"><button className="am-outline" type="button" onClick={onList} disabled={busy}><Icon name="close" /> Hủy</button><button className="am-primary" type="submit" disabled={busy}><Icon name="plus" /> {busy ? "Đang tạo…" : "Tạo tài khoản quản trị"}</button></div>
      </CheckedForm>}
  </section><aside className="am-create-note"><Icon name="shield" /><h3>Cấp đúng quyền.<br />Đúng người dùng.</h3><p>Quản trị viên có thể truy cập khu vực quản trị và thêm quản trị viên khác.</p><hr /><h4>Không cần tạo mật khẩu</h4><p>Người dùng đăng nhập bằng tài khoản Microsoft của mình. Thao tác này không tạo mật khẩu, hộp thư hay tài khoản Microsoft mới.</p><h4>Email chưa có trong EduPath AI?</h4><p>Hệ thống lưu sẵn quyền quản trị cho email này. Người dùng đăng nhập bằng đúng tài khoản Microsoft đã được thêm để truy cập khu vực quản trị.</p></aside></div>;
}

export const roleLabels: Record<AppRole, string> = {
  student: "Sinh viên", admin: "Quản trị viên", faculty_board: "Ban chủ nhiệm khoa",
  department_head: "Trưởng/phó bộ môn", lecturer: "Giảng viên", advisor: "Cố vấn học tập"
};
