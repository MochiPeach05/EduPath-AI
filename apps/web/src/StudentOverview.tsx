import type { CareerSelection } from "./career-types";
import { useEffect, useState, type ReactNode } from "react";
import type { Transcript } from "./StudentTranscript";
import { academicSections, latestResultSection, printedSemesterGpa } from "./student-overview-data";
import { Icon } from "./student-icons";
import { isFailLetter } from "./transcript-results";

export type StudentProfile = {
  careerPositionId?: string | null; careerPosition?: CareerSelection | null;
  /** Chuyên ngành (CNPM/CNDL/TTNT; K27 còn có ANM); null = chưa xác định, absent on older APIs. */
  specialty?: string | null;
  name: string; studentCode: string | null; cohortCode: string | null;
  className: string | null; cohortYear: number | null; currentSemester: number | null;
  email: string | null; careerGoal: string | null; interests: string | null; profileStatus: string;
  /** When the profile survey ("Khảo sát định hướng") was saved; null when not yet. */
  surveyUpdatedAt?: string | null;
  /** The survey is complete (interests included) and agreed to under the current policy. */
  surveyComplete?: boolean;
  /** A transcript is stored. */
  hasTranscript?: boolean;
};

/**
 * What the profile needs before EduPath AI can help (user 2026-10-24: "mày muốn xài cái này là mày bắt buộc phải hoàn
 * thành phần này trước"): the same fields as the API's profileStatus "complete".
 */
export function requiredProfileItems(profile: StudentProfile | null, hasTranscript: boolean) {
  return [
    { id: "transcript", label: "Bảng điểm học tập", hint: "Tải bảng điểm PDF của bạn", done: hasTranscript },
    { id: "specialty", label: "Chuyên ngành", hint: "Chọn trong Thông tin cá nhân", done: Boolean(profile?.specialty) },
    { id: "career", label: "Nghề mục tiêu", hint: "Chọn vị trí nghề nghiệp mong muốn", done: Boolean(profile?.careerPositionId) },
    { id: "survey", label: "Khảo sát định hướng", hint: profile?.surveyUpdatedAt ? "Bổ sung thế mạnh, sở trường và xác nhận lại" : "Câu hỏi, thế mạnh, sở trường và thành tích", done: profile?.surveyComplete === true },
  ];
}

export default function StudentOverview({ profile, loading: profileLoading, navigate, identity }: {
  profile: StudentProfile | null; loading: boolean;
  navigate: (page: "profile" | "career" | "roadmap" | "competency") => void;
  /** The student's identity strip, shown above the required-profile notice (user 2026-10-24: under the account name). */
  identity: ReactNode;
}) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/student/transcript", { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : "Chưa tải được kết quả học tập.");
        return response.json() as Promise<{ transcript: Transcript | null }>;
      })
      .then(data => { if (!controller.signal.aborted) { setTranscript(data.transcript); setSelectedId(latestResultSection(academicSections(data.transcript))?.id ?? ""); } })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Chưa tải được bảng điểm."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  const semesters = academicSections(transcript);
  const semester = semesters.find(item => item.id === selectedId);
  const gpa = printedSemesterGpa(semester);
  const checklist = requiredProfileItems(profile, Boolean(transcript));
  const ready = checklist.filter(item => item.done).length;
  const readyKnown = !loading && !profileLoading && !error && profile !== null;
  const missing = checklist.length - ready;
  return <div className="so-overview">
    {identity}
    {readyKnown && missing > 0 && <section className="so-gate" aria-labelledby="so-gate-title">
      <span className="so-gate-icon" aria-hidden="true"><Icon name="shield" /></span>
      <div className="so-gate-body">
        <p className="so-gate-kicker">BẮT BUỘC TRƯỚC KHI SỬ DỤNG</p>
        <h2 id="so-gate-title">Hoàn thành Hồ sơ và bảng điểm để EduPath AI hỗ trợ bạn</h2>
        <p>Bạn vui lòng cung cấp đầy đủ các mục thông tin dưới đây để kết quả đánh giá được chính xác. Nếu có sự thay đổi, bạn có thể điều chỉnh lại các thông tin này trong tương lai.</p>
        <ol className="so-gate-steps">{checklist.map((item, index) => <li key={item.id} className={item.done ? "is-done" : undefined}>
          <span className="so-gate-check" aria-hidden="true">{item.done ? <Icon name="check" /> : index + 1}</span>
          <span><strong>{item.label}</strong><small>{item.done ? "Đã hoàn thành" : item.hint}</small></span>
          <span className="sr-only">{item.done ? "Đã hoàn thành" : "Chưa hoàn thành"}</span>
        </li>)}</ol>
      </div>
      <div className="so-gate-actions">
        <span className="so-gate-count" aria-hidden="true">{ready}/{checklist.length}</span>
        <button className="sw-primary so-gate-button" onClick={() => navigate("profile")}>Hoàn thành hồ sơ ngay <Icon name="arrow" /></button>
      </div>
    </section>}
    <div className="sw-section-heading"><h2>Không gian học tập của bạn</h2><span className="sw-muted">Mỗi bước nhỏ, một hướng đi rõ hơn</span></div>
    <div className="so-quick-grid">
      <article className="so-quick-card">
        <div className="so-card-heading"><span className="so-kicker">THEO DÕI</span><span className={`sw-tag ${transcript && !error ? "sw-tag-green" : ""}`}>{loading ? "Đang tải" : error ? "Chưa kết nối" : transcript ? "Đã có bảng điểm" : "Chưa có dữ liệu"}</span></div>
        <h3>Kết quả học tập</h3><p>Bảng điểm và học phần, cùng một nơi.</p>
        <dl className="so-card-metrics"><div><dt>Môn học</dt><dd>{loading || error ? "—" : transcript?.data.courseCount ?? "—"}</dd></div><div><dt>Học kỳ đã import</dt><dd>{loading || error || !transcript ? "—" : semesters.length}</dd></div></dl>
        <button className="so-card-link" onClick={() => navigate("profile")}>{transcript ? "Xem bảng điểm" : "Import bảng điểm"}<Icon name="arrowUpRight" /></button>
      </article>
      <article className="so-quick-card">
        <div className="so-card-heading"><span className="so-kicker">KHÁM PHÁ</span><span className="sw-tag">Mục tiêu cá nhân</span></div>
        <h3>Định hướng của bạn</h3><p>Kết nối điều bạn thích với điều muốn làm.</p>
        <div className="so-card-detail"><small>Vị trí nghề nghiệp mong muốn</small><strong>{profileLoading ? "Đang tải hồ sơ…" : profile?.careerPosition?.nameVi || "Bạn muốn phát triển theo hướng nào?"}</strong></div>
        <button className="so-card-link" onClick={() => navigate("career")}>{profile?.careerPositionId ? "Xem nghề phù hợp" : "Khám phá nghề phù hợp"}<Icon name="arrowUpRight" /></button>
      </article>
      <article className="so-quick-card">
        <div className="so-card-heading"><span className="so-kicker">LÊN KẾ HOẠCH</span><span className={`sw-tag ${readyKnown && !missing ? "sw-tag-green" : ""}`}>{readyKnown && !missing ? "Sẵn sàng" : "Cần hồ sơ đầy đủ"}</span></div>
        <h3>Lộ trình học tập</h3><p>Theo dõi tiến độ, lên kế hoạch học kỳ và nhận lộ trình 3 tháng do AI soạn.</p>
        <div className="so-card-detail"><small>Khảo sát định hướng</small><strong>{profileLoading ? "Đang tải hồ sơ…" : profile?.surveyComplete ? "Đã hoàn thành" : profile?.surveyUpdatedAt ? "Cần cập nhật" : "Chưa làm khảo sát"}</strong><span>Lộ trình AI dùng kết quả đánh giá năng lực và câu trả lời khảo sát của bạn.</span></div>
        <button className="so-card-link" onClick={() => navigate("roadmap")}>Mở lộ trình học tập<Icon name="arrowUpRight" /></button>
      </article>
    </div>
    <div className="so-columns">
      <section className="sw-panel so-results" aria-labelledby="recent-results-title">
        <div className="sw-section-heading"><div><h2 id="recent-results-title">Kết quả học tập gần nhất</h2><p className="sw-muted">Các học phần trong bảng điểm bạn đã import.</p></div>{semesters.length > 0 && !error && <label className="so-term-select"><span className="sr-only">Chọn học kỳ</span><select value={selectedId} onChange={event => setSelectedId(event.target.value)}>{[...semesters].reverse().map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}</div>
        {loading ? <div className="so-loading" role="status"><p>Đang tải kết quả học tập…</p><div /><div /><div /></div> : error ? <div className="sw-empty" role="alert"><h3>{error}</h3><p>Bạn có thể thử lại để tiếp tục xem bảng điểm.</p><button className="sw-outline" onClick={() => setReload(value => value + 1)}><Icon name="refresh" />Thử lại</button></div> : semester ? <>
          <div className="so-table-wrap" tabIndex={0} role="region" aria-label={`Học phần ${semester.label}`}><table className="so-course-table"><thead><tr><th scope="col">Học phần</th><th scope="col">Tín chỉ</th><th scope="col">Hệ 10</th><th scope="col">Điểm chữ</th></tr></thead><tbody>{semester.courses.map(course => <tr key={`${course.sourcePage}-${course.ordinal}`}><td><strong>{course.name}</strong><span>{course.code}</span></td><td>{course.credits}</td><td>{course.score10 ?? "—"}</td><td><span className={`so-grade ${isFailLetter(course.letter) ? "so-grade-fail" : ""}`}>{course.letter ?? "—"}</span></td></tr>)}</tbody></table></div>
          <div className="so-results-footer"><span>Điểm TB học kỳ (hệ 4) <strong>{gpa ?? "Chưa có"}</strong></span><button className="sw-text-link" onClick={() => navigate("profile")}>Xem toàn bộ bảng điểm <Icon name="arrow" /></button></div>
        </> : <div className="sw-empty so-transcript-empty"><span className="so-paper-icon" aria-hidden="true"><Icon name="document" /></span><h3>{transcript ? "Chưa có học phần theo học kỳ" : "Bắt đầu với bảng điểm của bạn"}</h3><p>{transcript ? "Xem điểm bảo lưu và các dữ liệu hiện có trong hồ sơ." : "Tải bảng điểm PDF để xem môn học, điểm số và kết quả từng học kỳ ngay tại đây."}</p><button className="sw-outline" onClick={() => navigate("profile")}>{transcript ? "Xem bảng điểm" : "Import bảng điểm"}</button></div>}
      </section>
      <aside className="so-aside">
        <section className="sw-panel so-checklist"><div className="sw-section-heading"><h2>Hồ sơ sẵn sàng</h2><span className="so-check-count">{readyKnown ? `${ready}/${checklist.length}` : `—/${checklist.length}`}</span></div><p className="sw-muted">Các mục bắt buộc để EduPath AI hiểu và hỗ trợ bạn.</p><progress max={checklist.length} value={readyKnown ? ready : 0} aria-label="Số mục hồ sơ đã bổ sung" /><ul>{checklist.map(item => <li key={item.id}><span className={`so-check ${readyKnown && item.done ? "so-check-done" : ""}`} aria-hidden="true">{readyKnown && item.done ? <Icon name="check" /> : null}</span><span>{item.label}</span><span className="sr-only">{!readyKnown ? "Chưa xác định" : item.done ? "Đã bổ sung" : "Chưa bổ sung"}</span></li>)}</ul><button className="sw-text-link" onClick={() => navigate("profile")}>Hoàn thiện hồ sơ <Icon name="arrow" /></button></section>
        <section className="so-guidance"><span className="so-kicker">GỢI Ý CHO BẠN</span><h2>Hiểu mình trước.<br />Chọn hướng đi sau.</h2><p>Sở thích và mục tiêu hôm nay là điểm bắt đầu cho hành trình học tập phù hợp với bạn.</p><button className="sw-text-link" onClick={() => navigate("career")}>Khám phá định hướng <Icon name="arrowUpRight" /></button></section>
      </aside>
    </div>
  </div>;
}
