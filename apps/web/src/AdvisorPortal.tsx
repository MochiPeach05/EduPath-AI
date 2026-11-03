import { useRef, useState } from "react";
import { Pagination, Status, useData } from "./admin-ui";
import { Icon } from "./admin-account-shared";
import { CheckedForm } from "./CheckedForm";
import { useLiveFilters } from "./use-live-filters";
import { sortParams, sortRows, useTableSort, type SortRule, type TableSort } from "./table-sort";
import {
  ADVISOR_PORTAL_API, type AdvisedStudentRow, type AdvisorClass, type AdvisorPermissionItem, type AdvisorPermissions,
} from "./advisor-types";
import { STUDENT_STATUS_TEXT, advisorRequest, isStudentStatus, openStudentPage } from "./advisor-admin";
import "./curricula.css";
import "./careers.css";
import "./advisors.css";

// The cố vấn học tập's own pages (AD-AST-01…05, 09; user 2026-11-03). Lớp phụ trách: the classes the Khoa assigned to the
// signed-in account, then their students (search, class and status filters, sorted and paged on the server), each with
// "Mở trang sinh viên", which opens the student portal of that student in a tab of its own (the advisor's view,
// advisor-view.ts). Quyền cố vấn: what an advisor may see and do, as the API lists it (permissions.ts). Contract:
// advisor-types.ts.

export default function AdvisorPortal({ section }: { section: "classes" | "permissions" }) {
  return section === "classes" ? <AdvisorClasses /> : <AdvisorPermissionsPage />;
}

/** "38/45": the students of the class that did a step, out of its students. */
const share = (count: number, total: number) => `${count.toLocaleString("vi-VN")}/${total.toLocaleString("vi-VN")}`;

const classSort: Record<string, SortRule<AdvisorClass>> = {
  className: { value: (row) => row.className },
  cohort: { value: (row) => row.cohort },
  students: { value: (row) => row.students, by: "number" },
  withTranscript: { value: (row) => (row.students ? row.withTranscript / row.students : null), by: "number" },
  assessed: { value: (row) => (row.students ? row.assessed / row.students : null), by: "number" },
  surveyDone: { value: (row) => (row.students ? row.surveyDone / row.students : null), by: "number" },
  roadmap: { value: (row) => (row.students ? row.roadmap / row.students : null), by: "number" },
};

/** The advisor's classes (AD-AST-01; exported for its test). */
export function ClassTable({ classes, sort, sortHeader, selected, onPick }: {
  classes: readonly AdvisorClass[]; sort: TableSort; sortHeader: ReturnType<typeof useTableSort>["sortHeader"]; selected: string;
  onPick: (className: string) => void;
}) {
  return <div className="cm-table-scroll"><table className="cm-table av-classes-table">
    <thead><tr>{sortHeader("Lớp", "className")}{sortHeader("Khóa", "cohort")}{sortHeader("Sinh viên", "students")}{sortHeader("Có bảng điểm", "withTranscript")}
      {sortHeader("Đã đánh giá năng lực", "assessed")}{sortHeader("Đã làm khảo sát", "surveyDone")}{sortHeader("Có Lộ trình AI", "roadmap")}<th scope="col">Thao tác</th></tr></thead>
    <tbody>{sortRows(classes, classSort, sort).map(({ row }) => <tr key={row.className} className={row.className === selected ? "av-row-current" : undefined}>
      <td><strong>{row.className}</strong></td>
      <td>{row.cohort ?? "—"}</td>
      <td className="av-num">{row.students.toLocaleString("vi-VN")}</td>
      <td className="av-num">{share(row.withTranscript, row.students)}</td>
      <td className="av-num">{share(row.assessed, row.students)}</td>
      <td className="av-num">{share(row.surveyDone, row.students)}</td>
      <td className="av-num">{share(row.roadmap, row.students)}</td>
      <td><button type="button" className="am-outline" aria-pressed={row.className === selected} onClick={() => onPick(row.className)}><Icon name="users" /> Xem sinh viên</button></td>
    </tr>)}</tbody>
  </table></div>;
}

/** One step of a student: done ("Có") or not yet ("Chưa"); words, not colour alone. */
function Step({ done, label }: { done: boolean; label: string }) {
  return <span className={`av-step ${done ? "av-step-done" : "av-step-todo"}`} title={`${label}: ${done ? "đã có" : "chưa có"}`}>
    {done && <Icon name="check" />}{done ? "Có" : "Chưa"}
  </span>;
}

/** One page of the students of the advisor's classes (AD-AST-02…05; exported for its test). */
export function StudentTable({ students, page, sortHeader, opening, onOpen }: {
  students: readonly AdvisedStudentRow[]; page: number; sortHeader: ReturnType<typeof useTableSort>["sortHeader"]; opening: string | null;
  onOpen: (student: AdvisedStudentRow) => void;
}) {
  return <div className="cm-table-scroll"><table className="cm-table av-students-table">
    <thead><tr>{sortHeader("STT", "stt", "cm-stt")}{sortHeader("Sinh viên", "name")}{sortHeader("Lớp", "className")}{sortHeader("Chuyên ngành", "specialty")}
      {sortHeader("Vị trí mục tiêu", "targetCareer")}{sortHeader("Bảng điểm", "hasTranscript")}{sortHeader("Đánh giá năng lực", "assessed")}
      {sortHeader("Khảo sát", "surveyDone")}{sortHeader("Lộ trình AI", "roadmap")}<th scope="col">Thao tác</th></tr></thead>
    <tbody>{students.map((student, index) => <tr key={student.userId}>
      <td className="cm-stt">{student.stt ?? (page - 1) * 10 + index + 1}</td>
      <td><strong>{student.name}</strong><small>{student.studentCode ? `MSSV ${student.studentCode}` : "Chưa có MSSV"}</small></td>
      <td>{student.className}{student.cohort && <small>{student.cohort}</small>}</td>
      <td>{student.specialty ?? <span className="career-empty">Chưa chọn</span>}</td>
      <td>{student.targetCareer ?? <span className="career-empty">Chưa chọn</span>}</td>
      <td><Step done={student.hasTranscript} label="Bảng điểm" /></td>
      <td><Step done={student.assessed} label="Đánh giá năng lực" /></td>
      <td><Step done={student.surveyDone} label="Khảo sát định hướng" /></td>
      <td><Step done={student.roadmap} label="Lộ trình AI" /></td>
      <td><button type="button" className="am-primary av-open" disabled={opening !== null} onClick={() => onOpen(student)}>
        <Icon name="arrowUpRight" /> {opening === student.userId ? "Đang mở…" : "Mở trang sinh viên"}</button></td>
    </tr>)}</tbody>
  </table></div>;
}

const emptyFilters = { q: "", class: "", status: "all" };

function AdvisorClasses() {
  const classes = useData<{ items: AdvisorClass[] }>(`${ADVISOR_PORTAL_API}/classes`);
  const classTable = useTableSort();
  const { draft, setDraft, filters, page, setPage, flush, reset } = useLiveFilters(emptyFilters);
  // The server sorts and pages the students (advisors/portal-router.ts); STT stays the row's number in the list by name.
  const studentTable = useTableSort(() => setPage(1));
  const params = sortParams(studentTable.sort, new URLSearchParams({ page: String(page), pageSize: "10" }));
  if (filters.q) params.set("q", filters.q);
  if (filters.class) params.set("class", filters.class);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  const students = useData<{ items: AdvisedStudentRow[]; total: number }>(`${ADVISOR_PORTAL_API}/students?${params}`);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const [blocked, setBlocked] = useState<{ url: string; name: string } | null>(null);
  const studentsPanel = useRef<HTMLElement>(null);
  const items = classes.data?.items ?? [];
  const pickClass = (className: string) => {
    setDraft({ ...draft, class: draft.class === className ? "" : className });
    studentsPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const open = async (student: AdvisedStudentRow) => {
    setOpening(student.userId); setOpenError(""); setBlocked(null);
    try {
      const url = await openStudentPage(() => advisorRequest<{ url: string }>(`${ADVISOR_PORTAL_API}/students/${encodeURIComponent(student.userId)}/open`,
        { method: "POST", body: "{}" }));
      if (url) setBlocked({ url, name: student.name });
    } catch (failure) { setOpenError((failure as Error).message); }
    finally { setOpening(null); }
  };
  const filtered = Boolean(filters.q || filters.class || filters.status !== "all");
  return <section className="cm-workspace career-workspace av-workspace">
    <section className="cm-panel" aria-labelledby="av-classes-title">
      <div className="career-list-heading">
        <div>
          <h2 id="av-classes-title">Lớp phụ trách{classes.data && <span className="am-count">{items.length}</span>}</h2>
          <p>Các lớp Khoa phân công cho bạn. Chọn Xem sinh viên để xem sinh viên của một lớp.</p>
        </div>
      </div>
      <Status {...classes} />
      {classes.data && (items.length
        ? <ClassTable classes={items} sort={classTable.sort} sortHeader={classTable.sortHeader} selected={filters.class} onPick={pickClass} />
        : <p className="am-empty">Bạn chưa được phân công lớp nào. Khoa thêm lớp phụ trách cho cố vấn ở trang Cố vấn.</p>)}
    </section>
    <section ref={studentsPanel} className="cm-panel av-students" aria-labelledby="av-students-title">
      <div className="career-list-heading">
        <div>
          <h2 id="av-students-title">Sinh viên lớp phụ trách{students.data && <span className="am-count">{students.data.total}</span>}</h2>
          <p>Mở trang sinh viên mở cổng sinh viên ở thẻ mới, xem như chính sinh viên đó. Những việc bạn làm thay được nằm ở trang Quyền cố vấn; mỗi việc được ghi vào Nhật ký thao tác và báo cho sinh viên.</p>
        </div>
      </div>
      <CheckedForm className="cm-filters av-student-filters" onSubmit={(event) => { event.preventDefault(); flush(); }}>
        <label className="cm-search">Tìm sinh viên<input type="search" maxLength={120} value={draft.q} placeholder="MSSV hoặc họ tên…" onChange={(event) => setDraft({ ...draft, q: event.target.value })} /></label>
        <label>Lớp<select value={draft.class} onChange={(event) => setDraft({ ...draft, class: event.target.value })}>
          <option value="">Tất cả lớp</option>{items.map((item) => <option key={item.className} value={item.className}>{item.className}</option>)}</select></label>
        <label>Tình trạng<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: isStudentStatus(event.target.value) ? event.target.value : "all" })}>
          {Object.entries(STUDENT_STATUS_TEXT).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="am-quiet" type="button" onClick={reset}>Xóa bộ lọc</button>
      </CheckedForm>
      {openError && <p className="admin-error av-open-error" role="alert">{openError}</p>}
      {blocked && <p className="cm-warning av-open-blocked" role="status">Trình duyệt chặn mở thẻ mới. <a href={blocked.url} target="_blank" rel="noopener">Mở trang của {blocked.name}</a></p>}
      <Status {...students} />
      {students.data && <>
        <StudentTable students={students.data.items} page={page} sortHeader={studentTable.sortHeader} opening={opening} onOpen={(student) => void open(student)} />
        {!students.data.items.length && <p className="am-empty">{filtered ? "Không có sinh viên phù hợp. Thử từ khóa khác hoặc xóa bộ lọc." : "Chưa có sinh viên nào của lớp bạn phụ trách đăng nhập EduPath AI."}</p>}
        <Pagination total={students.data.total} page={page} setPage={setPage} />
      </>}
    </section>
  </section>;
}

function PermissionCard({ tone, title, items }: { tone: "view" | "act" | "never"; title: string; items: readonly AdvisorPermissionItem[] }) {
  return <section className={`cm-panel av-perm av-perm-${tone}`} aria-label={title}>
    <h2><Icon name={tone === "never" ? "lock" : tone === "act" ? "check" : "eye"} /> {title}</h2>
    <ul>{items.map((item) => <li key={item.label}><strong>{item.label}</strong><span>{item.detail}</span></li>)}</ul>
  </section>;
}

/** What a cố vấn học tập may see and do (AD-AST-09; exported for its test). */
export function PermissionsView({ permissions }: { permissions: AdvisorPermissions }) {
  return <>
    <p className="av-lead">Cố vấn học tập chỉ làm việc với sinh viên thuộc lớp mình phụ trách, theo Chính sách bảo mật của EduPath AI. Ở trang quản trị, cố vấn chỉ có quyền xem.</p>
    <div className="av-perm-grid">
      <PermissionCard tone="view" title="Xem được" items={permissions.view} />
      <PermissionCard tone="act" title="Làm thay sinh viên được" items={permissions.act} />
      <PermissionCard tone="never" title="Không làm thay được" items={permissions.never} />
    </div>
    {permissions.notes.length > 0 && <section className="cm-panel av-perm-notes" aria-label="Ghi nhận và thông báo">
      <h2><Icon name="bell" /> Ghi nhận và thông báo</h2>
      <ul>{permissions.notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </section>}
  </>;
}

function AdvisorPermissionsPage() {
  const state = useData<AdvisorPermissions>(`${ADVISOR_PORTAL_API}/permissions`);
  return <section className="cm-workspace av-workspace">
    <Status {...state} />
    {state.data && <PermissionsView permissions={state.data} />}
  </section>;
}
