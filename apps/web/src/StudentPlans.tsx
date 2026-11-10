import { useMemo, useState } from "react";
import type { PlanData, PlanItem } from "./plan-types";
import { decimalText, programName, termName } from "./display-format";
import {
  courseTypeLabel, plannedTermText, prerequisiteText, programTitle, realCodeMap, realCodesInText, searchTerm,
} from "./student-curriculum-types";
import { CourseResultMark } from "./StudentCurriculum";
import { MissingProgram, OwnProgramNote, ownItem, ownScope, upperFirst, type OwnProgramFacts } from "./own-program";
import { readGraduation } from "./student-graduation-api";
import { GRADUATION_API } from "./student-graduation-data";
import { Icon } from "./student-icons";
import { useLiveData } from "./use-live-data";
import type { Transcript } from "./StudentTranscript";
import { INFERRED_RESULT_NOTE } from "./transcript-results";
import {
  graduationCourseAliases, physicalEducationFills, physicalEducationProgress, planTermCredits, studentPlanOutcome, transcriptCourseStates,
} from "./student-plan-results";
import "./student-curriculum.css";
import "./student-plans.css";

/**
 * GET /api/student/plans: the student's own KHĐT alone (user 2026-11-10, no choice, as on Xét tốt nghiệp), picked by the
 * cohort in the account and the major of the MSSV; suggestedId is its id, null with why in `resolution`.
 */
type List = OwnProgramFacts & {
  /** fromCurriculum: read from the CTĐT of a cohort and major without a KHĐT (API plans/from-curriculum.ts, 2026-11-05). */
  items: { id: string; name: string; cohortCode: string; major: string; fromCurriculum?: boolean }[];
  suggestedId: string | null;
};
type DetailItem = Omit<PlanItem, "position" | "sourceRow" | "sourceSheet" | "sourceCells"> & {
  /** The real code of a row the file writes under another one (as StudentCourse.realCode); students read only it. */
  realCode?: string | null;
};
type Detail = Pick<
  PlanData,
  "name" | "major" | "cohortCode" | "admissionYear" | "totalCredits" | "terms" | "sections"
> & {
  physicalEducationGroups?: Record<string, string[]>;
  /** A plan read from the CTĐT: its courses without a planned year and semester, not shown. */
  unplacedCount?: number;
  items: DetailItem[];
};
async function readPlan<T>(response: Response): Promise<T> {
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "Kế hoạch đào tạo này hiện không còn mở để tra cứu. Vui lòng thử lại."
        : response.status === 401
          ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
          : "Không thể tải kế hoạch đào tạo. Vui lòng thử lại.",
    );
  return response.json() as Promise<T>;
}
async function readTranscript(response: Response): Promise<{ transcript: Transcript | null }> {
  if (!response.ok) throw new Error("Chưa tải được kết quả bảng điểm. Vui lòng thử lại.");
  return response.json();
}

/** The plan as students read it: each row by its real code only, also in the conditions of the other rows. */
function planWithRealCodes(data: Detail): Detail {
  const codes = realCodeMap(data.items);
  if (!codes.size) return data;
  return {
    ...data,
    items: data.items.map(({ realCode: _realCode, ...item }) => ({
      ...item,
      code: codes.get(item.code.trim().toUpperCase()) ?? item.code,
      prerequisite: realCodesInText(item.prerequisite, codes),
      prior: realCodesInText(item.prior, codes),
    })),
  };
}

/** Where a student whose plan is read from the CTĐT finds each course's planned year and term. */
function CurriculumLink() {
  return <a className="sp-link" href="#curriculum">Chương trình đào tạo</a>;
}

/**
 * #plans: the student's own KHĐT only (user 2026-11-10: "Không cho sinh viên chọn … như trang xét tốt nghiệp"), the one
 * of the cohort in the account and the major of the MSSV, else the plan read from their CTĐT (own-program.tsx).
 */
export default function StudentPlans() {
  const [revision, setRevision] = useState(0);
  const list = useLiveData<List>("/api/student/plans", revision, readPlan);
  const retry = () => setRevision((n) => n + 1);
  const own = ownItem(list.data);
  return (
    <div className="sc-workspace">
      {list.loading && (
        <section className="sw-panel" role="status">
          Đang tải kế hoạch đào tạo của bạn…
        </section>
      )}
      {list.error && (
        <section className="sw-panel sc-empty">
          <p role="alert" className="sw-error">{list.error}</p>
          <button className="sw-outline" onClick={retry}>
            <Icon name="refresh" /> Thử lại
          </button>
        </section>
      )}
      {list.data &&
        (own ? (
          <PlanContents key={own.id} id={own.id} fromCurriculum={own.fromCurriculum === true} facts={list.data} revision={revision} retry={retry} />
        ) : (
          <MissingProgram kind="plan" facts={list.data} />
        ))}
    </div>
  );
}

/**
 * A plan term the one way students read a term (user review 2026-10-30): its calendar code "HK231" → "HK1 2023–2024";
 * a term without such a code by its year and semester in the cohort.
 */
export const planTermName = (term: Pick<Detail["terms"][number], "code" | "studyYear" | "semester">, admissionYear?: number | null) =>
  /^HK\d{2}[1-3]$/.test(term.code) ? termName(term.code) : plannedTermText(term.studyYear, term.semester, admissionYear);

/** "Tín chỉ học kỳ theo kế hoạch": the plan's own figure, else what the term's rows add up to (K26 prints none). */
function termCreditsText(term: Detail["terms"][number], items: Detail["items"], sectionIds: ReadonlySet<string>): string {
  if (term.sourceCredits !== null) return decimalText(term.sourceCredits);
  const sum = planTermCredits(items.filter((item) => item.termCode === term.code), sectionIds);
  if (!sum) return "Chưa xác định";
  return sum.partial
    ? `${decimalText(sum.credits)} tín chỉ chung, chưa tính các học phần tự chọn hoặc theo chuyên ngành bên dưới`
    : `${decimalText(sum.credits)} (cộng từ các học phần trong kỳ, không tính môn điều kiện (*))`;
}

function PlanContents({ id, fromCurriculum, facts, revision, retry }: {
  id: string;
  fromCurriculum: boolean;
  facts: OwnProgramFacts;
  revision: number;
  retry: () => void;
}) {
  const [transcriptRevision, setTranscriptRevision] = useState(0);
  const transcript = useLiveData<{ transcript: Transcript | null }>(
    "/api/student/transcript", transcriptRevision, readTranscript,
  );
  // The student's own graduation check: a course passed under another code (a retake with a later cohort).
  const graduation = useLiveData(GRADUATION_API, transcriptRevision, readGraduation);
  const states = transcriptCourseStates(transcript.data?.transcript?.data.sections ?? []);
  const aliases = graduationCourseAliases(graduation.data?.evaluation);
  const remote = useLiveData<Detail>(`/api/student/plans/${id}`, revision, readPlan);
  // Read with the real codes of its rows only (planWithRealCodes; never the file's code).
  const shown = useMemo(() => remote.data && planWithRealCodes(remote.data), [remote.data]);
  const [query, setQuery] = useState(""),
    [term, setTerm] = useState("");
  if (remote.loading)
    return (
      <section className="sw-panel" role="status">
        Đang tải nội dung kế hoạch…
      </section>
    );
  if (remote.error || !shown)
    return (
      <section className="sw-panel sc-empty">
        <p role="alert" className="sw-error">{remote.error ?? "Không thể tải kế hoạch đào tạo. Vui lòng thử lại."}</p>
        <button className="sw-outline" onClick={retry}>
          <Icon name="refresh" /> Thử lại
        </button>
      </section>
    );
  const data = shown;
  const physicalEducation = physicalEducationProgress(
    [...(data.physicalEducationGroups?.TC002 ?? []), ...(data.physicalEducationGroups?.TC102 ?? [])],
    states,
  );
  // A CTĐT without PE electives (ngành HTTT K29: "Giáo dục thể chất (1)", "(2)"): the electives taken fill those rows (2026-11-10).
  const fills = physicalEducation.groups ? new Map() : physicalEducationFills(data.items,
    new Set(data.items.map((item) => item.code.trim().toUpperCase())), transcript.data?.transcript?.data.sections ?? [], states);
  const outcome = (item: Detail["items"][number]) => studentPlanOutcome(item, states, physicalEducation, aliases, fills);
  const sectionIds = new Set(data.sections.map((section) => section.id));
  const rows = data.items.filter(
    (item) =>
      (!term || item.termCode === term) &&
      searchTerm(`${item.code} ${item.name}`).includes(searchTerm(query)),
  );
  const showsInferred = rows.some((item) => outcome(item)?.inferred);
  return (
    <section className="sw-panel sp-content">
      <div className="sp-heading">
        <h2>{programTitle(data.name, data.major)}</h2>
        <p>
          {programName(data.major)} · {data.cohortCode} · Tổng tín chỉ quy định:{" "}
          {data.totalCredits === null ? "Chưa xác định" : decimalText(data.totalCredits)}
        </p>
        <OwnProgramNote kind="plan" facts={facts} />
      </div>
      <p className="sc-muted">
        {fromCurriculum && (
          <>
            {upperFirst(ownScope(facts))} chưa có kế hoạch đào tạo riêng; các học kỳ dưới đây lấy từ năm học, học kỳ dự kiến
            của từng học phần trong <CurriculumLink /> của bạn.{" "}
          </>
        )}
        Đây là kế hoạch giảng dạy, không phải danh sách môn bạn đã đăng ký.
      </p>
      {!!data.unplacedCount && (
        <p className="sc-muted">
          {data.unplacedCount} học phần trong chương trình đào tạo không ghi năm học, học kỳ dự kiến nên không có trong kế hoạch này.
        </p>
      )}
      <div className="sc-filters">
        <label className="sc-search">
          Tìm học phần
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Mã hoặc tên học phần…"
          />
        </label>
        <label>
          Học kỳ
          <select value={term} onChange={(e) => setTerm(e.target.value)}>
            <option value="">Tất cả học kỳ</option>
            {data.terms.map((t) => (
              <option key={t.code} value={t.code}>
                {planTermName(t, data.admissionYear)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="sw-outline"
          onClick={() => {
            setQuery("");
            setTerm("");
          }}
        >
          Xóa bộ lọc
        </button>
      </div>
      <p role="status">
        {rows.length} / {data.items.length} học phần
      </p>
      {transcript.loading && <p role="status">Đang đối chiếu bảng điểm…</p>}
      {transcript.error && <p role="alert">{transcript.error} <button className="sw-outline" onClick={() => setTranscriptRevision((n) => n + 1)}>Thử lại</button></p>}
      {showsInferred && (
        <p className="sc-muted">
          Kết quả ghi “{INFERRED_RESULT_NOTE}” là do ô Kết quả trong PDF để
          trống: điểm A+ đến D được tính là Đạt, F là Chưa đạt.
        </p>
      )}
      {data.terms
        .filter((t) => !term || term === t.code)
        .map((t) => {
          const items = rows.filter((item) => item.termCode === t.code);
          if (!items.length) return null;
          return (
            <div key={t.code}>
              <h3>{planTermName(t, data.admissionYear)}</h3>
              <p className="sc-muted">
                Tín chỉ học kỳ theo kế hoạch:{" "}
                {termCreditsText(t, data.items, sectionIds)}
              </p>
              <div className="sc-table-wrap">
                <table className="sc-table">
                  <thead>
                    <tr>
                      <th>Mã học phần</th>
                      <th>Tên học phần</th>
                      <th>TC</th>
                      <th>Loại</th>
                      <th>Điều kiện học</th>
                      <th className="sc-result-cell">Kết quả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.code || "—"}</td>
                        <td>
                          <strong>{item.name}</strong>
                          <small>
                            {
                              data.sections.find((s) => s.id === item.sectionId)
                                ?.label
                            }
                          </small>
                          {item.notes && <small>{item.notes}</small>}
                        </td>
                        <td>{item.credits === null ? "—" : decimalText(item.credits)}</td>
                        <td>{courseTypeLabel(item.type, item.code) || "—"}</td>
                        <td>
                          {item.prerequisite && (
                            <div>Tiên quyết: {prerequisiteText(item.prerequisite)}</div>
                          )}
                          {item.prior && <div>Học trước: {prerequisiteText(item.prior)}</div>}
                          {!item.prerequisite && !item.prior && "Không ghi trong kế hoạch"}
                        </td>
                        <td className="sc-result-cell">
                          <CourseResultMark view={outcome(item)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      {!rows.length && <p>Không có học phần phù hợp với bộ lọc.</p>}
    </section>
  );
}
