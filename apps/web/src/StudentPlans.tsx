import { useState } from "react";
import type { PlanData, PlanItem } from "./plan-types";
import { courseTypeLabel, prerequisiteText, searchTerm } from "./student-curriculum-types";
import { CourseResultMark } from "./StudentCurriculum";
import { readGraduation } from "./student-graduation-api";
import { GRADUATION_API } from "./student-graduation-data";
import { useLiveData } from "./use-live-data";
import type { Transcript } from "./StudentTranscript";
import { INFERRED_RESULT_NOTE } from "./transcript-results";
import {
  graduationCourseAliases, physicalEducationProgress, planTermCredits, studentPlanOutcome, transcriptCourseStates,
} from "./student-plan-results";
import "./student-curriculum.css";
import "./student-plans.css";

type List = {
  items: { id: string; name: string; cohortCode: string; major: string }[];
  suggestedId: string | null;
  profileCohort: string | null;
};
type Detail = Pick<
  PlanData,
  "name" | "major" | "cohortCode" | "totalCredits" | "terms" | "sections"
> & {
  physicalEducationGroups?: Record<string, string[]>;
  items: Omit<
    PlanItem,
    "position" | "sourceRow" | "sourceSheet" | "sourceCells"
  >[];
};
async function readPlan<T>(response: Response): Promise<T> {
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "Kế hoạch không còn được mở. Hãy chọn kế hoạch khác."
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

/** Where a student without a plan of their cohort still finds each course's planned year and term. */
function CurriculumLink() {
  return <a className="sp-link" href="#curriculum">Chương trình đào tạo</a>;
}

export default function StudentPlans() {
  const [choice, setChoice] = useState<string | null>(null);
  const list = useLiveData<List>("/api/student/plans", 0, readPlan);
  const id = choice ?? list.data?.suggestedId ?? "";
  const selected = list.data?.items.find((item) => item.id === id);
  const profileCohort = list.data?.profileCohort ?? null;
  const ownMissing = Boolean(profileCohort && list.data && !list.data.items.some((item) => item.cohortCode === profileCohort));
  return (
    <div className="sc-workspace">
      <section className="sw-panel sc-selector sp-selector">
        <div>
          <p className="sc-eyebrow">KẾ HOẠCH ĐÀO TẠO</p>
          <h2>Tra cứu kế hoạch theo học kỳ</h2>
          <p className="sc-muted">
            Xem các học phần dự kiến trong từng năm học, học kỳ của khóa tuyển
            sinh.
          </p>
        </div>
        <div className="sc-selector-controls">
          <label>
            Kế hoạch đang mở
            <select
              value={selected?.id ?? ""}
              onChange={(e) => setChoice(e.target.value)}
              disabled={list.loading}
            >
              <option value="">Chọn kế hoạch đào tạo</option>
              {list.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.cohortCode} · {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {list.loading && <p role="status">Đang tải kế hoạch…</p>}
        {list.error && <p role="alert">{list.error}</p>}
        {list.data && !list.data.items.length && (
          <p>
            Chưa có kế hoạch đào tạo đang mở. Bạn có thể xem năm học, học kỳ dự kiến của từng học phần trong <CurriculumLink />.
          </p>
        )}
        {list.data && !!list.data.items.length && (
          <p className="sc-muted">
            {selected?.cohortCode === profileCohort
              ? "Kế hoạch cùng khóa tuyển sinh của bạn."
              : ownMissing
                ? <>Chưa có kế hoạch đào tạo của khóa {profileCohort}. Bạn có thể chọn kế hoạch của khóa khác để tham khảo, hoặc xem năm học, học kỳ dự kiến của từng học phần trong <CurriculumLink />.</>
                : "Bạn có thể chọn kế hoạch của khóa khác để tham khảo."}
            {selected && " Đây là kế hoạch giảng dạy, không phải danh sách môn bạn đã đăng ký."}
          </p>
        )}
      </section>
      {selected && (
        <PlanContents key={selected.id} id={selected.id} />
      )}
    </div>
  );
}

/** "Tín chỉ học kỳ theo kế hoạch": the plan's own figure, else what the term's rows add up to (K26 prints none). */
function termCreditsText(term: Detail["terms"][number], items: Detail["items"], sectionIds: ReadonlySet<string>): string {
  if (term.sourceCredits !== null) return String(term.sourceCredits);
  const sum = planTermCredits(items.filter((item) => item.termCode === term.code), sectionIds);
  if (!sum) return "Chưa xác định";
  return sum.partial
    ? `${sum.credits} tín chỉ chung, chưa tính các học phần tự chọn hoặc theo chuyên ngành bên dưới`
    : `${sum.credits} (cộng từ các học phần trong kỳ, không tính môn điều kiện (*))`;
}

function PlanContents({ id }: { id: string }) {
  const [transcriptRevision, setTranscriptRevision] = useState(0);
  const transcript = useLiveData<{ transcript: Transcript | null }>(
    "/api/student/transcript", transcriptRevision, readTranscript,
  );
  // The student's own graduation check: a course passed under another code (a retake with a later cohort).
  const graduation = useLiveData(GRADUATION_API, transcriptRevision, readGraduation);
  const states = transcriptCourseStates(transcript.data?.transcript?.data.sections ?? []);
  const aliases = graduationCourseAliases(graduation.data?.evaluation);
  const remote = useLiveData<Detail>(`/api/student/plans/${id}`, 0, readPlan);
  const [query, setQuery] = useState(""),
    [term, setTerm] = useState("");
  if (remote.loading)
    return (
      <section className="sw-panel" role="status">
        Đang tải nội dung kế hoạch…
      </section>
    );
  if (remote.error)
    return (
      <section className="sw-panel" role="alert">
        {remote.error}
      </section>
    );
  const data = remote.data!;
  const physicalEducation = physicalEducationProgress(
    [...(data.physicalEducationGroups?.TC002 ?? []), ...(data.physicalEducationGroups?.TC102 ?? [])],
    states,
  );
  const outcome = (item: Detail["items"][number]) => studentPlanOutcome(item, states, physicalEducation, aliases);
  const sectionIds = new Set(data.sections.map((section) => section.id));
  const rows = data.items.filter(
    (item) =>
      (!term || item.termCode === term) &&
      searchTerm(`${item.code} ${item.name}`).includes(searchTerm(query)),
  );
  const showsInferred = rows.some((item) => outcome(item)?.inferred);
  return (
    <section className="sw-panel sp-content">
      <h2>{data.name}</h2>
      <p>
        {data.major} · {data.cohortCode} · Tổng tín chỉ quy định:{" "}
        {data.totalCredits ?? "Chưa xác định"}
      </p>
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
          Năm học · Học kỳ
          <select value={term} onChange={(e) => setTerm(e.target.value)}>
            <option value="">Tất cả học kỳ</option>
            {data.terms.map((t) => (
              <option key={t.code} value={t.code}>
                Năm {t.studyYear} · Học kỳ {t.semester}
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
              <h3>
                Năm {t.studyYear} · Học kỳ {t.semester}
              </h3>
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
                        <td>{item.credits ?? "—"}</td>
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
