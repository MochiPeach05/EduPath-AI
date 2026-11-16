import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveFilters } from "./use-live-filters";
import {
  courseKind,
  courseRowKey,
  courseTypeLabel,
  electiveGroupName,
  isSpecialtyName,
  plannedTermText,
  prerequisiteText,
  programTitle,
  searchableCourse,
  searchTerm,
  studentCurriculumWithRealCodes,
  studyYearText,
  uniqueCourseCount,
  type StudentCourse,
  type StudentCurriculumData,
  type StudentCurriculumList,
} from "./student-curriculum-types";
import { decimalText } from "./display-format";
import { MissingProgram, OwnProgramNote, ownItem, type OwnProgramFacts } from "./own-program";
import { readGraduation } from "./student-graduation-api";
import { GRADUATION_API, standardElectiveQuotas, type StandardElectiveQuota } from "./student-graduation-data";
import { Icon } from "./student-icons";
import {
  courseResult,
  courseResultDisplay,
  filledResult,
  graduationCourseAliases,
  physicalEducationFills,
  transcriptCourseStates,
  type CourseResultView,
} from "./student-plan-results";
import { useLiveData } from "./use-live-data";
import type { Transcript } from "./StudentTranscript";
import "./student-curriculum.css";

const endpoint = "/api/student/curricula";
async function readTranscript(res: Response): Promise<{ transcript: Transcript | null }> {
  if (!res.ok) throw new Error("Chưa tải được kết quả bảng điểm. Vui lòng thử lại.");
  return res.json();
}
async function readCurriculum<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message =
      res.status === 401
        ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
        : res.status === 403
          ? "Tài khoản hiện không thể truy cập dữ liệu."
          : res.status === 404
            ? "Chương trình đào tạo này hiện không còn mở để tra cứu. Vui lòng thử lại."
            : "Chưa tải được chương trình đào tạo. Vui lòng thử lại.";
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
function useCurriculumRequest<T>(url: string, revision: number) {
  return useLiveData<T>(url, revision, readCurriculum);
}

/**
 * #curriculum: the student's own CTĐT only (user 2026-11-10: "Không cho sinh viên chọn … như trang xét tốt nghiệp"), the
 * one of the cohort in the account and the major of the MSSV (own-program.tsx); no other cohort's or major's is offered.
 */
export default function StudentCurriculum() {
  const [revision, setRevision] = useState(0);
  const list = useCurriculumRequest<StudentCurriculumList>(endpoint, revision);
  const retry = () => setRevision((n) => n + 1);
  const own = ownItem(list.data);
  return (
    <div className="sc-workspace">
      {list.loading && (
        <section className="sw-panel sc-empty" role="status">
          Đang tải chương trình đào tạo của bạn…
        </section>
      )}
      {list.error && (
        <section className="sw-panel sc-empty">
          <p role="alert" className="sw-error">
            {list.error}
          </p>
          <button className="sw-outline" onClick={retry}>
            <Icon name="refresh" /> Thử lại
          </button>
        </section>
      )}
      {list.data &&
        (own ? (
          <CurriculumContent
            key={own.id}
            id={own.id}
            facts={list.data}
            revision={revision}
            retry={retry}
          />
        ) : (
          <MissingProgram kind="curriculum" facts={list.data} />
        ))}
    </div>
  );
}

function CurriculumContent({
  id,
  facts,
  revision,
  retry,
}: {
  id: string;
  facts: OwnProgramFacts;
  revision: number;
  retry: () => void;
}) {
  const transcript = useLiveData<{ transcript: Transcript | null }>(
    "/api/student/transcript", revision, readTranscript,
  );
  // The student's own graduation check: the other codes a course was counted through and the
  // elective quotas of the standard. Optional: without it the page shows the transcript alone.
  const graduation = useLiveData(GRADUATION_API, revision, readGraduation);
  const states = transcriptCourseStates(transcript.data?.transcript?.data.sections ?? []);
  const aliases = graduationCourseAliases(graduation.data?.evaluation);
  const remote = useCurriculumRequest<StudentCurriculumData>(
    `${endpoint}/${id}`,
    revision,
  );
  // Read with the real codes of its courses only (studentCurriculumWithRealCodes; never the file's code).
  const shown = useMemo(() => remote.data && studentCurriculumWithRealCodes(remote.data), [remote.data]);
  // The opened row itself: a code can be listed in several groups (K27 71ITDS40503).
  const [opened, setOpened] = useState<StudentCourse | null>(null);
  const { draft, setDraft, filters, reset } = useLiveFilters({
    q: "",
    group: "",
    kind: "",
    specialty: "",
    semester: "",
    year: "",
  });
  if (remote.loading)
    return (
      <section className="sw-panel sc-empty" role="status">
        Đang tải học phần…
      </section>
    );
  if (remote.error)
    return (
      <section className="sw-panel sc-empty">
        <p role="alert" className="sw-error">
          {remote.error}
        </p>
        <button className="sw-outline" onClick={retry}>
          <Icon name="refresh" /> Thử lại
        </button>
      </section>
    );
  const data = shown;
  if (!data) return null;
  const term = searchTerm(filters.q);
  const courses = data.courses.filter(
    (c) =>
      (!term || searchableCourse(c).includes(term)) &&
      (!filters.group || c.groupId === filters.group) &&
      (!filters.kind || courseKind(c.type) === filters.kind) &&
      (!filters.specialty || c.specialty === filters.specialty) &&
      (!filters.semester || String(c.semester) === filters.semester) &&
      (!filters.year || String(c.studyYear) === filters.year),
  );
  // The PE electives a CTĐT without them fills its "Giáo dục thể chất (1)", "(2)" with (ngành HTTT K29, 2026-11-10).
  const fills = physicalEducationFills(data.courses, new Set(data.courses.map((c) => c.code.trim().toUpperCase())),
    transcript.data?.transcript?.data.sections ?? [], states);
  const result = (c: StudentCourse) => filledResult(c.code, states, fills) ?? courseResult(c.code, states, aliases);
  const groups = new Map(data.groups.map((g) => [g.id, g.label]));
  // Quotas of the student's own standard apply to the CTĐT of the same cohort only.
  const standard = graduation.data?.standard ?? null;
  const quotas: ReadonlyMap<string, StandardElectiveQuota> =
    standard && standard.cohortCode.trim().toUpperCase() === data.cohortCode.trim().toUpperCase()
      ? standardElectiveQuotas(data.electives, standard) : new Map();
  return (
    <>
      <section className="sw-panel sc-summary">
        <div className="sc-summary-title">
          <div>
            <p className="sc-eyebrow">
              {data.cohortCode} · Nhập học {data.admissionYear}
            </p>
            <h2>{programTitle(data.name, data.major)}</h2>
            <OwnProgramNote kind="curriculum" facts={facts} />
          </div>
        </div>
        <dl className="sc-stats">
          <div>
            <dt>Tín chỉ chương trình</dt>
            <dd>
              {data.totalCredits === null ? "Chưa xác định" : decimalText(data.totalCredits)}
              <small>Theo quy định của khung</small>
            </dd>
          </div>
          <div>
            <dt>Học phần trong danh mục</dt>
            <dd>
              {uniqueCourseCount(data.courses)}
              <small>Gồm các phương án lựa chọn</small>
            </dd>
          </div>
          <div>
            <dt>Nhóm môn tự chọn</dt>
            <dd>
              {data.electives.length}
              <small>Chọn theo yêu cầu từng nhóm</small>
            </dd>
          </div>
        </dl>
        <p className="sc-muted">
          Không cần học tất cả môn trong danh mục. Môn tự chọn và chuyên ngành
          áp dụng theo quy định của chương trình.
        </p>
        {!!data.electives.length && (
          <details className="sc-electives">
            <summary>Xem các nhóm tự chọn</summary>
            <div>
              {data.electives.map((group) => {
                const quota = quotas.get(group.code);
                return (
                  <article key={group.code}>
                    <strong>{electiveGroupName(group.code)}</strong>
                    <p>
                      {quota
                        ? `Chọn ${decimalText(quota.credits)} tín chỉ (theo tiêu chuẩn xét tốt nghiệp${quota.groupCode ? `, nhóm ${quota.groupCode}` : ""})`
                        : group.requiredCredits === null
                          ? "Xem quy định tín chỉ trong khung hoặc liên hệ cố vấn học tập."
                          : `Chọn ${decimalText(group.requiredCredits)} tín chỉ`}
                    </p>
                    <small>{new Set(group.courseCodes).size} học phần trong nhóm</small>
                  </article>
                );
              })}
            </div>
          </details>
        )}
      </section>
      <section className="sw-panel sc-catalog">
        <div className="sc-catalog-heading">
          <div>
            <h2>Danh sách học phần</h2>
            <p className="sc-muted">
              Chọn tên học phần để xem mô tả và điều kiện học.
            </p>
          </div>
          <span className="sc-badge" role="status">
            {courses.length} / {data.courses.length} học phần
          </span>
        </div>
        <div className="sc-filters">
          <label className="sc-search">
            Tìm học phần
            <input
              type="search"
              placeholder="Mã hoặc tên học phần…"
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </label>
          <label>
            Khối kiến thức
            <select
              value={draft.group}
              onChange={(e) => setDraft({ ...draft, group: e.target.value })}
            >
              <option value="">Tất cả khối</option>
              {data.groups
                .filter((g) => data.courses.some((c) => c.groupId === g.id))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Loại môn
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              <option value="">Tất cả loại</option>
              <option value="required">Bắt buộc</option>
              <option value="elective">Tự chọn</option>
            </select>
          </label>
          <label>
            Chuyên ngành
            <select
              value={draft.specialty}
              onChange={(e) =>
                setDraft({ ...draft, specialty: e.target.value })
              }
            >
              <option value="">Tất cả chuyên ngành</option>
              {[
                ...new Set(
                  data.courses.map((c) => c.specialty).filter(isSpecialtyName),
                ),
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Năm học
            <select
              value={draft.year}
              onChange={(e) => setDraft({ ...draft, year: e.target.value })}
            >
              <option value="">Tất cả năm</option>
              {[
                ...new Set(
                  data.courses
                    .map((c) => c.studyYear)
                    .filter((n): n is number => n !== null),
                ),
              ]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {studyYearText(n, data.admissionYear)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Học kỳ
            <select
              value={draft.semester}
              onChange={(e) => setDraft({ ...draft, semester: e.target.value })}
            >
              <option value="">Tất cả học kỳ</option>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  HK{n}
                </option>
              ))}
            </select>
          </label>
          <button className="sw-outline" onClick={reset}>
            Xóa bộ lọc
          </button>
        </div>
        {transcript.loading && <p className="sc-muted" role="status">Đang đối chiếu bảng điểm…</p>}
        {transcript.error && <p role="alert">{transcript.error} <button className="sw-outline" onClick={retry}>Thử lại</button></p>}
        <div
          className="sc-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Danh sách học phần, có thể cuộn ngang"
        >
          <table className="sc-table">
            <thead>
              <tr>
                <th>Mã học phần</th>
                <th>Học phần</th>
                <th>Tín chỉ</th>
                <th>Loại môn</th>
                <th>Học kỳ dự kiến</th>
                <th>Tiên quyết</th>
                <th className="sc-result-cell">Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c, i) => (
                <Fragment key={courseRowKey(c, i)}>
                  {c.groupId !== courses[i - 1]?.groupId && (
                    <tr className="sc-group">
                      <th colSpan={7} scope="rowgroup">
                        {groups.get(c.groupId) ?? "Học phần"}
                      </th>
                    </tr>
                  )}
                  <tr>
                    <td>{c.code}</td>
                    <th scope="row">
                      <button
                        className="sc-course-link"
                        onClick={() => setOpened(c)}
                      >
                        {c.name}
                      </button>
                      <small>{c.englishName}</small>
                    </th>
                    <td>{decimalText(c.credits)}</td>
                    <td>
                      <span
                        className={`sc-badge ${courseKind(c.type) === "elective" ? "sc-elective" : ""}`}
                      >
                        {courseTypeLabel(c.type, c.code)}
                      </span>
                    </td>
                    <td className="sc-term">
                      {plannedTermText(c.studyYear, c.semester, data.admissionYear)}
                    </td>
                    <td>
                      <span className="sc-condition-text">
                        {c.prerequisite ? prerequisiteText(c.prerequisite) : "Không ghi trong khung"}
                      </span>
                      {c.conditions.some(
                        (r) => r.kind === "prerequisite" && r.reviewRequired,
                      ) && (
                          <small className="sc-review">
                            Cần xác nhận điều kiện
                          </small>
                        )}
                    </td>
                    <td className="sc-result-cell">
                      <CourseResultMark view={result(c)} />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {!courses.length && (
          <div className="sc-empty">
            <h3>Không tìm thấy học phần phù hợp</h3>
            <p>Thử thay đổi từ khóa hoặc xóa bộ lọc.</p>
            <button className="sw-outline" onClick={reset}>
              Xóa bộ lọc
            </button>
          </div>
        )}
      </section>
      {opened && (
        <CourseDetail
          course={opened}
          data={data}
          onClose={() => setOpened(null)}
          onCourse={setOpened}
        />
      )}
    </>
  );
}

/**
 * The Kết quả cell, in the graduation page's words: ✓ Đã đạt, ✗ Chưa đạt, ✓ Miễn thi (MT), ◐ Đang học,
 * ? Chưa rõ kết quả, or ⇄ for a course passed with a later cohort under another code. The glyph speaks
 * its label; anything but a plain ✓/✗ (and a result read from the letter grade) is also written out.
 */
export function CourseResultMark({ view }: { view: CourseResultView | undefined }) {
  if (!view) return null;
  const display = courseResultDisplay(view);
  return (
    <>
      <span className={`sc-result sc-result-${display.tone}`} role="img" aria-label={display.label} title={display.label}>
        {display.glyph}
      </span>
      {display.notes.map((note) => <small key={note} className="sc-result-note">{note}</small>)}
    </>
  );
}

/** The course dialog of one row (exported for its test). */
export function CourseDetail({
  course,
  data,
  onClose,
  onCourse,
}: {
  course: StudentCourse;
  data: StudentCurriculumData;
  onClose: () => void;
  onCourse: (course: StudentCourse) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    opener.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [course]);
  return (
    <dialog
      ref={dialog}
      className="sc-dialog"
      aria-labelledby="student-course-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <p className="sc-eyebrow">
            {course.code} · {data.cohortCode}
          </p>
          <h2 id="student-course-title" ref={heading} tabIndex={-1}>
            {course.name}
          </h2>
          {course.englishName && (
            <p className="sc-muted">{course.englishName}</p>
          )}
        </div>
        <button className="sw-outline" onClick={onClose}>
          Đóng
        </button>
      </header>
      <div className="sc-dialog-content">
        <div className="sc-course-meta">
          <span className="sc-badge">{decimalText(course.credits)} tín chỉ</span>
          <span className="sc-badge">{courseTypeLabel(course.type, course.code)}</span>
          <span className="sc-badge">
            Học kỳ dự kiến: {plannedTermText(course.studyYear, course.semester, data.admissionYear)}
          </span>
        </div>
        <section>
          <h3>Mô tả học phần</h3>
          <p className="sc-prewrap">
            {course.description ||
              "Nhà trường chưa cung cấp mô tả chi tiết cho học phần này."}
          </p>
        </section>
        {(["prerequisite", "prior"] as const).map((kind) => {
          const condition = course.conditions.find((r) => r.kind === kind);
          return (
            <section key={kind} className="sc-condition">
              <h3>
                {kind === "prerequisite"
                  ? "Điều kiện tiên quyết"
                  : "Học phần học trước"}
              </h3>
              <p className="sc-prewrap">
                {course[kind]
                  ? prerequisiteText(course[kind])
                  : "Không ghi điều kiện trong khung chương trình."}
              </p>
              {condition?.reviewRequired && (
                <p className="sc-review">
                  Điều kiện này cần nhà trường xác nhận. Liên hệ cố vấn học tập
                  trước khi lập kế hoạch đăng ký.
                </p>
              )}
              <div className="sc-related">
                {condition?.targetCodes.map((code) => {
                  const related = data.courses.find((c) => c.code === code);
                  return related && code !== course.code ? (
                    <button
                      key={code}
                      className="sw-outline"
                      onClick={() => onCourse(related)}
                    >
                      {related.code} · {related.name}
                    </button>
                  ) : null;
                })}
              </div>
            </section>
          );
        })}
        <dl className="sc-course-fields">
          <div>
            <dt>Khối kiến thức</dt>
            <dd>
              {course.block ||
                data.groups.find((g) => g.id === course.groupId)?.label ||
                "Chưa xác định"}
            </dd>
          </div>
          <div>
            <dt>Chuyên ngành</dt>
            <dd>{course.specialty || "Không ghi trong khung"}</dd>
          </div>
          <div>
            <dt>Bộ môn</dt>
            <dd>{course.department || "Chưa cập nhật"}</dd>
          </div>
          <div>
            <dt>Giờ lý thuyết / thực hành / đồ án / thực tập</dt>
            <dd>
              {[
                course.hours.lecture,
                course.hours.practice,
                course.hours.project,
                course.hours.internship,
              ]
                .map((n) => (n === null ? "—" : decimalText(n)))
                .join(" / ")}
            </dd>
          </div>
        </dl>
        {course.scheduleNeedsReview && (
          <p className="sc-muted">
            Chưa xác định đầy đủ năm hoặc học kỳ dự kiến cho học phần này.
          </p>
        )}
        {course.notes && (
          <section>
            <h3>Ghi chú trong khung</h3>
            <p className="sc-prewrap">{course.notes}</p>
          </section>
        )}
        <div className="sr-actions sr-form-actions"><button className="sw-outline" type="button" onClick={onClose}>Đóng</button></div>
      </div>
    </dialog>
  );
}
