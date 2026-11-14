import { useRef, useState } from "react";
import { Pagination, Status, useData } from "./admin-ui";
import { Icon } from "./admin-account-shared";
import { CheckedForm } from "./CheckedForm";
import { useLiveFilters } from "./use-live-filters";
import { sortParams, sortRows, useTableSort, type SortRule, type TableSort } from "./table-sort";
import {
  ADVISOR_PORTAL_API, type AdvisedStudentRow, type AdvisorClass, type AdvisorMe,
} from "./advisor-types";
import { STUDENT_STATUS_TEXT, advisorRequest, isStudentStatus, openStudentPage } from "./advisor-admin";
import "./curricula.css";
import "./careers.css";
import "./advisors.css";

// Quản lý sinh viên (AD-AST-01…09; user 2026-11-03: "Cái mục quyền cố vấn sửa lại thành quản lý sinh viên … ấn xem chi tiết
// từng sinh viên … là quản trị viên có giao diện của sinh viên bên trang sinh viên luôn"). The admins and Ban chủ nhiệm khoa
// see every class and student (scope "all"), a cố vấn học tập the classes the Khoa assigned (scope "own"): the classes,
// then their students (search, class and status filters, sorted and paged on the server), each with "Xem chi tiết", which
// opens the student portal of that student in a tab of its own (advisor-view.ts), then what may be done there, as the API
// lists it (permissions.ts). Contract: advisor-types.ts.

/** all: every student (admins, Ban chủ nhiệm khoa); own: the classes the signed-in account advises (GET /me). */
export type StudentScope = AdvisorMe["scope"];

/** What the page says it shows, for each scope. */
export const SCOPE_TEXT: Record<StudentScope, { lead: string; classes: string; students: string; noClass: string; noStudent: string }> = {
  all: {
    lead: "Bạn xem được mọi sinh viên của Khoa; cố vấn học tập chỉ xem sinh viên các lớp mình phụ trách.",
    classes: "Lớp", students: "Sinh viên",
    noClass: "Chưa có lớp nào có sinh viên trong EduPath AI.",
    noStudent: "Chưa có sinh viên nào đăng nhập EduPath AI.",
  },
  own: {
    lead: "Bạn xem được sinh viên của các lớp Khoa phân công cho bạn.",
    classes: "Lớp phụ trách", students: "Sinh viên lớp phụ trách",
    noClass: "Bạn chưa được phân công lớp nào. Khoa thêm lớp phụ trách cho cố vấn ở trang Danh sách cố vấn học tập.",
    noStudent: "Chưa có sinh viên nào của lớp bạn phụ trách đăng nhập EduPath AI.",
  },
};

export default function AdvisorPortal({ scope }: { scope: StudentScope }) {
  const text = SCOPE_TEXT[scope];
  return <section className="cm-workspace career-workspace av-workspace">
    <p className="av-lead">{text.lead} Bấm Xem chi tiết để mở trang của một sinh viên ở thẻ mới, như chính sinh viên đó thấy.</p>
    <StudentManagement scope={scope} />
  </section>;
}

/** "38/45": the students of the class that did a step, out of its students. */
const share = (count: number, total: number) => `${count.toLocaleString("vi-VN")}/${total.toLocaleString("vi-VN")}`;

const classSort: Record<string, SortRule<AdvisorClass>> = {
  className: { value: (row) => row.className },
  cohort: { value: (row) => row.cohort },
  advisorName: { value: (row) => row.advisorName, by: "name" },
  students: { value: (row) => row.students, by: "number" },
  withTranscript: { value: (row) => (row.students ? row.withTranscript / row.students : null), by: "number" },
  assessed: { value: (row) => (row.students ? row.assessed / row.students : null), by: "number" },
  surveyDone: { value: (row) => (row.students ? row.surveyDone / row.students : null), by: "number" },
  roadmap: { value: (row) => (row.students ? row.roadmap / row.students : null), by: "number" },
};

/** The classes (AD-AST-01; exported for its test). showAdvisor: the column of each class's cố vấn học tập (scope "all"). */
export function ClassTable({ classes, sort, sortHeader, selected, onPick, showAdvisor = false }: {
  classes: readonly AdvisorClass[]; sort: TableSort; sortHeader: ReturnType<typeof useTableSort>["sortHeader"]; selected: string;
  onPick: (className: string) => void; showAdvisor?: boolean;
}) {
  return <div className="cm-table-scroll"><table className={`cm-table av-classes-table${showAdvisor ? " av-classes-table-all" : ""}`}>
    <thead><tr>{sortHeader("Khóa", "cohort")}{sortHeader("Lớp", "className")}{showAdvisor && sortHeader("Cố vấn học tập", "advisorName")}{sortHeader("Sinh viên", "students")}
      {sortHeader("Có bảng điểm", "withTranscript")}{sortHeader("Đã đánh giá năng lực", "assessed")}{sortHeader("Đã làm khảo sát", "surveyDone")}{sortHeader("Có Lộ trình AI", "roadmap")}
      <th scope="col">Thao tác</th></tr></thead>
    <tbody>{sortRows(classes, classSort, sort).map(({ row }) => <tr key={row.className} className={row.className === selected ? "av-row-current" : undefined}>
      <td>{row.cohort ?? "—"}</td>
      <td><strong>{row.className}</strong></td>
      {showAdvisor && <td>{row.advisorName?.trim() ? row.advisorName : <span className="career-empty">Chưa phân công</span>}</td>}
      <td className="av-num">{row.students.toLocaleString("vi-VN")}</td>
      <td className="av-num">{share(row.withTranscript, row.students)}</td>
      <td className="av-num">{share(row.assessed, row.students)}</td>
      <td className="av-num">{share(row.surveyDone, row.students)}</td>
      <td className="av-num">{share(row.roadmap, row.students)}</td>
      <td><button type="button" className="am-outline" aria-current={row.className === selected ? "true" : undefined} onClick={() => onPick(row.className)}><Icon name="users" /> Xem sinh viên</button></td>
    </tr>)}</tbody>
  </table></div>;
}

/** One step of a student: done ("Có") or not yet ("Chưa"); words, not colour alone. */
function Step({ done, label }: { done: boolean; label: string }) {
  return <span className={`av-step ${done ? "av-step-done" : "av-step-todo"}`} title={`${label}: ${done ? "đã có" : "chưa có"}`}>
    {done && <Icon name="check" />}{done ? "Có" : "Chưa"}
  </span>;
}

/** One page of the students (AD-AST-02…06; exported for its test): "Xem chi tiết" opens the student's own page. */
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
      <td><Step done={student.surveyDone} label="Khảo sát nhanh" /></td>
      <td><Step done={student.roadmap} label="Lộ trình AI" /></td>
      <td><button type="button" className="am-primary av-open" disabled={opening !== null} onClick={() => onOpen(student)}>
        <Icon name="eye" /> {opening === student.userId ? "Đang mở…" : "Xem chi tiết"}</button></td>
    </tr>)}</tbody>
  </table></div>;
}

const emptyFilters = { q: "", class: "", status: "all" };

/**
 * The filters after Xem sinh viên on a class: that class, the other filters kept (exported for its test). A second click
 * on the same class keeps it (QA 2026-11-04: it cleared the filter and listed every class); Xóa bộ lọc or "Tất cả lớp"
 * clears it.
 */
export const withClass = <T extends { class: string }>(filters: T, className: string): T => ({ ...filters, class: className });

function StudentManagement({ scope }: { scope: StudentScope }) {
  const text = SCOPE_TEXT[scope];
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
    setDraft(withClass(draft, className));
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
  return <>
    <section className="cm-panel" aria-labelledby="av-classes-title">
      <div className="career-list-heading">
        <div>
          <h2 id="av-classes-title">{text.classes}{classes.data && <span className="am-count">{items.length}</span>}</h2>
          <p>Chọn Xem sinh viên để xem sinh viên của một lớp.</p>
        </div>
      </div>
      <Status {...classes} />
      {classes.data && (items.length
        ? <ClassTable classes={items} sort={classTable.sort} sortHeader={classTable.sortHeader} selected={filters.class} onPick={pickClass} showAdvisor={scope === "all"} />
        : <p className="am-empty">{text.noClass}</p>)}
    </section>
    <section ref={studentsPanel} className="cm-panel av-students" aria-labelledby="av-students-title">
      <div className="career-list-heading">
        <div>
          <h2 id="av-students-title">{text.students}{students.data && <span className="am-count">{students.data.total}</span>}</h2>
          <p>Ở trang sinh viên, bạn xem được các mục sinh viên đã cung cấp, có thể import bảng điểm, chọn chuyên ngành và vị trí nghề nghiệp mục tiêu, sửa Kế hoạch học kỳ, làm Khảo sát định hướng, chạy Đánh giá năng lực, Lộ trình AI và hỏi Trợ lý AI thay sinh viên. Mỗi việc làm thay được ghi vào Nhật ký thao tác và báo cho sinh viên.</p>
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
        {!students.data.items.length && <p className="am-empty">{filtered ? "Không có sinh viên phù hợp. Thử từ khóa khác hoặc xóa bộ lọc." : text.noStudent}</p>}
        <Pagination total={students.data.total} page={page} setPage={setPage} />
      </>}
    </section>
  </>;
}
