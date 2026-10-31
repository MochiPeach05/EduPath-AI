import type { CareerSelection } from "./career-types";
import { useLiveFilters } from "./use-live-filters";
import { useEffect, useState } from "react";
import { useData, Status, Pagination, Modal } from "./admin-ui";
import { Icon } from "./admin-account-shared";
import { specialtyLabel } from "./competency-assessment-types";
import { majorLabel } from "./majors";
import TranscriptTables, { transcriptNotes } from "./TranscriptTables";
import { formatUpdatedAt } from "./student-overview-data";
import { sortParams, useTableSort } from "./table-sort";
import { profileIdOf, studentProfileLink, withoutProfileId } from "./admin-navigation";
import type { Transcript } from "./StudentTranscript";
import "./student-profiles.css";

type ProfileStatus = "missing" | "incomplete" | "complete";
type Student = { stt?: number; id: string; name: string; email: string | null; isActive: boolean; studentCode: string | null; cohortCode: string | null; className: string | null; cohortYear: number | null; profileStatus: ProfileStatus };
type StudentDetail = Student & { majorCode?: string | null; specialty?: string | null; surveyUpdatedAt?: string | null; surveyComplete?: boolean; careerPosition?: CareerSelection | null; username: string | null; interests: string | null; careerGoal: string | null; accountCreatedAt: string; firstLoginAt: string; lastLoginAt: string; profileCreatedAt: string | null; profileUpdatedAt: string | null };
type StudentPage = { items: Student[]; total: number; cohortYears: number[]; cohortCodes: string[] };
const statusLabels: Record<ProfileStatus, string> = { missing: "Chưa có hồ sơ", incomplete: "Chưa hoàn tất", complete: "Đã hoàn tất" };
const emptyFilters = { q: "", cohortYear: "", cohortCode: "", active: "", profileStatus: "" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa có dữ liệu";

function ProfileBadge({ status }: { status: ProfileStatus }) {
  return <span className={`sp-badge sp-badge-${status}`}>{statusLabels[status]}</span>;
}
/** GET /api/admin/students/:id/transcript: the stored transcript's scores, null when the student has none. */
type AdminTranscript = { transcript: { updatedAt: string; data: Transcript["data"] } | null };
/** The student's transcript as the student page shows it (user, 2026-10-25), read only and without the PDF. */
function StudentTranscriptView({ id }: { id: string }) {
  const state = useData<AdminTranscript>(`/api/admin/students/${id}/transcript`);
  const view = state.data;
  const notes = view?.transcript ? transcriptNotes(view.transcript.data) : [];
  return <section className="sp-transcript" aria-labelledby="sp-transcript-title">
    <h3 id="sp-transcript-title">Bảng điểm</h3>
    <Status {...state} />
    {view && (view.transcript ? <>
      <p className="sp-note">{view.transcript.data.pageCount} trang · {view.transcript.data.courseCount} học phần · Cập nhật lúc {formatUpdatedAt(view.transcript.updatedAt)}</p>
      {notes.length > 0 && <div className="sr-review" role="note">{notes.join(" ")}</div>}
      <TranscriptTables data={view.transcript.data} />
    </> : <p className="sp-note">Sinh viên chưa tải bảng điểm lên EduPath AI.</p>)}
  </section>;
}
function StudentDetails({ id }: { id: string }) {
  const state = useData<{ student: StudentDetail }>(`/api/admin/students/${id}`);
  const student = state.data?.student;
  return <><Status {...state} />{student && <div className="sp-detail">
    <div className="sp-detail-heading"><span className="am-avatar" aria-hidden="true">{student.name.slice(0, 1)}</span><div><h3>{student.name}</h3><p>{student.studentCode ? `MSSV: ${student.studentCode}` : "Chưa cập nhật mã sinh viên"}</p></div><ProfileBadge status={student.profileStatus} /></div>
    {student.profileStatus === "missing" && <p className="sp-note">Tài khoản sinh viên đã có trong EduPath AI nhưng chưa có bản ghi hồ sơ. Các thông tin học tập bên dưới chưa được cung cấp.</p>}
    <h3>Thông tin cá nhân và học tập</h3>
    <dl className="am-detail-grid">{Object.entries({ "Họ và tên": student.name, "Mã sinh viên": student.studentCode, ...(student.majorCode !== undefined ? { "Ngành": majorLabel(student.majorCode) } : {}), "Email": student.email, "Tên đăng nhập": student.username, "Khóa học": student.cohortCode, "Lớp học": student.className, "Năm nhập học": student.cohortYear, ...(student.specialty !== undefined ? { "Chuyên ngành": specialtyLabel(student.specialty) } : {}), ...(student.surveyUpdatedAt !== undefined ? { "Khảo sát định hướng": student.surveyComplete ? "Đã hoàn thành" : student.surveyUpdatedAt ? "Cần cập nhật" : "Chưa làm" } : {}), "Trạng thái tài khoản": student.isActive ? "Đang hoạt động" : "Đã khóa", "Trạng thái hồ sơ": statusLabels[student.profileStatus] }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Chưa cập nhật"}</dd></div>)}</dl>
    {student.interests?.trim() && <><h3>Sở thích (ghi trước đây)</h3><p className="sp-career-goal">{student.interests.trim()}</p></>}
    <h3>Vị trí nghề nghiệp mục tiêu</h3><p className="sp-career-goal">{student.careerPosition ? `${student.careerPosition.nameVi} — ${student.careerPosition.nameEn}${student.careerPosition.deletedAt ? " (đã ngừng sử dụng)" : ""}` : "Chưa chọn vị trí nghề nghiệp."}</p>
    <h3>Thông tin cập nhật</h3><dl className="am-detail-grid">{Object.entries({ "Tạo tài khoản EduPath": date(student.accountCreatedAt), "Đăng nhập đầu tiên": date(student.firstLoginAt), "Đăng nhập gần nhất": date(student.lastLoginAt), "Tạo hồ sơ": date(student.profileCreatedAt), "Cập nhật hồ sơ gần nhất": date(student.profileUpdatedAt) }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <StudentTranscriptView id={id} />
  </div>}</>;
}

export default function StudentProfiles() {
  const { draft, setDraft, filters, page, setPage, flush, reset } = useLiveFilters(emptyFilters);
  // The server sorts the whole list (admin/student-profiles.ts); STT stays the row's number in the list by name.
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  // One student's details by link (?id=<users.id>, "Xem hồ sơ" in the reports, 2026-10-31): the address opens them, a reload
  // keeps them, closing drops the parameter. Opening from the list writes the address too, without a new history entry.
  const [selectedId, setSelectedId] = useState<string | null>(() => (typeof window === "undefined" ? null : profileIdOf(window.location.search)));
  useEffect(() => {
    const onPopState = () => setSelectedId(profileIdOf(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const openStudent = (id: string) => { setSelectedId(id); window.history.replaceState(window.history.state, "", studentProfileLink(id)); };
  const closeStudent = () => {
    setSelectedId(null);
    if (profileIdOf(window.location.search)) window.history.replaceState(window.history.state, "", `${window.location.pathname}${withoutProfileId(window.location.search)}`);
  };
  const [cohortCodes, setCohortCodes] = useState<string[]>([]);
  const [cohortYears, setCohortYears] = useState<number[]>([]);
  const params = sortParams(sort, new URLSearchParams({ page: String(page), pageSize: "10" }));
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const state = useData<StudentPage>(`/api/admin/students?${params}`);
  useEffect(() => { if (state.data) { setCohortYears(state.data.cohortYears); setCohortCodes(state.data.cohortCodes ?? []); } }, [state.data]);
  const filtered = Object.values(filters).some(Boolean);
  return <><section className="am-card" aria-labelledby="student-list-title">
    <div className="am-card-heading"><div><h2 id="student-list-title">Danh sách sinh viên {state.data && <span className="am-count">{state.data.total}</span>}</h2><p>Tra cứu thông tin cá nhân, học tập, vị trí nghề nghiệp mục tiêu và bảng điểm của sinh viên.</p></div><span className="sp-readonly">Chỉ xem hồ sơ</span></div>
    <form className="am-filters sp-filters" onSubmit={(event) => { event.preventDefault(); flush(); }}>
      <label className="sp-search" htmlFor="student-search">Nhập từ khóa tìm kiếm<input id="student-search" maxLength={120} value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder="MSSV, họ tên, email, khóa, lớp, mục tiêu…" /></label>
      <label htmlFor="student-cohort">Năm nhập học<select id="student-cohort" value={draft.cohortYear} onChange={(e) => setDraft({ ...draft, cohortYear: e.target.value })}><option value="">Tất cả năm</option>{cohortYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
      <label htmlFor="student-cohort-code">Khóa<select id="student-cohort-code" value={draft.cohortCode} onChange={(e) => setDraft({ ...draft, cohortCode: e.target.value })}><option value="">Tất cả khóa</option>{cohortCodes.map(code => <option key={code} value={code}>{code}</option>)}</select></label>
      <label htmlFor="student-profile-status">Trạng thái hồ sơ<select id="student-profile-status" value={draft.profileStatus} onChange={(e) => setDraft({ ...draft, profileStatus: e.target.value })}><option value="">Tất cả hồ sơ</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label htmlFor="student-active">Trạng thái tài khoản<select id="student-active" value={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.value })}><option value="">Tất cả tài khoản</option><option value="true">Đang hoạt động</option><option value="false">Đã khóa</option></select></label>
      <div className="sp-filter-actions"><button className="am-outline" type="button" onClick={reset}>Xóa bộ lọc</button></div>
    </form>
    <Status {...state} />{state.data && <><div className="am-table-scroll" tabIndex={0} role="region" aria-label="Bảng hồ sơ sinh viên, cuộn ngang trên màn hình nhỏ"><table className="am-table sp-table"><thead><tr>{sortHeader("STT", "stt")}{sortHeader("Sinh viên", "name")}{sortHeader("Mã sinh viên", "studentCode")}{sortHeader("Khóa học", "cohortCode")}{sortHeader("Lớp học", "className")}{sortHeader("Năm nhập học", "cohortYear")}{sortHeader("Hồ sơ", "profileStatus")}{sortHeader("Tài khoản", "isActive")}<th scope="col">Thao tác</th></tr></thead><tbody>{state.data.items.map((student, index) => <tr key={student.id}><td>{student.stt ?? (page - 1) * 10 + index + 1}</td><td><div className="am-person"><span className="am-avatar" aria-hidden="true">{student.name.slice(0, 1)}</span><div><button className="am-name-link" onClick={() => openStudent(student.id)}>{student.name}</button><small>{student.email ?? "Chưa có email"}</small></div></div></td><td>{student.studentCode ?? "Chưa cập nhật"}</td><td>{student.cohortCode ?? "—"}</td><td>{student.className ?? "—"}</td><td>{student.cohortYear ?? "—"}</td><td><ProfileBadge status={student.profileStatus} /></td><td><span className={`am-state ${student.isActive ? "" : "am-state-locked"}`}>{student.isActive ? "Đang hoạt động" : "Đã khóa"}</span></td><td><button className="am-outline" onClick={() => openStudent(student.id)}><Icon name="eye" />Xem chi tiết</button></td></tr>)}</tbody></table></div>
      {!state.data.items.length && <div className="am-empty"><h3>{filtered ? "Không tìm thấy hồ sơ phù hợp" : "Chưa có sinh viên trong danh sách"}</h3><p>{filtered ? "Thử từ khóa khác hoặc xóa bộ lọc." : "Danh sách sẽ hiển thị khi có tài khoản mang vai trò Sinh viên trong hệ thống."}</p></div>}
      <Pagination total={state.data.total} page={page} setPage={setPage} /></>}
    <p className="am-table-note"></p>
  </section>{selectedId && <Modal title="Chi tiết hồ sơ sinh viên" onClose={closeStudent}><StudentDetails key={selectedId} id={selectedId} /><div className="am-form-actions am-dialog-footer"><button className="am-outline" type="button" onClick={closeStudent}><Icon name="close" /> Đóng</button></div></Modal>}</>;
}
