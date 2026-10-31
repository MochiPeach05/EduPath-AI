import { useEffect, useRef, useState } from "react";
import { decimalText } from "./display-format";
import { Icon } from "./student-icons";
import { useLiveData } from "./use-live-data";
import {
  ROADMAP_API, ROADMAP_POLL_MS, choiceText, dateText, failureText, roadmapTermLabel, roadmapWindowTitle, formatDateTime, helpsText, improveHeading, improveTag, isPending, modelLabel,
  monthTitle, normalizeRoadmap, normalizeRoadmapResponse, normalizeRoadmapStatus, pendingCopy, requestErrorMessage, sentence, skillTags, studyTag,
  type Roadmap, type RoadmapBasis, type RoadmapImprove, type RoadmapResponse, type RoadmapSkill, type RoadmapStatus, type RoadmapStudy,
} from "./student-roadmap-data";
import "./student-roadmap.css";

// "Lên kế hoạch (AI)" of #roadmap (user, 2026-10-24): a study roadmap for the next term of the school calendar (user, 2026-10-25;
// before, 3 months from the day it was made) that EduPath AI writes as an academic advisor — the courses to
// take, the courses to improve and the skills of the target career to study on one's own — from the newest competency
// assessment. What the system computed shows at once; the AI's advice and month plan fill in once they are written.

async function readRoadmap(response: Response): Promise<RoadmapResponse> {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    throw new Error(requestErrorMessage(data?.error));
  }
  return normalizeRoadmapResponse(data);
}
const getJson = (url: string, signal: AbortSignal) => fetch(url, { credentials: "include", cache: "no-store", signal });
async function postRoadmap(): Promise<Roadmap | null> {
  const response = await fetch(ROADMAP_API, {
    method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
  const data = await response.json().catch(() => ({})) as { error?: string; roadmap?: unknown };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    throw new Error(requestErrorMessage(data.error));
  }
  return normalizeRoadmap(data.roadmap);
}

/** The page data: the live GET, replaced by what POST and the status poll bring back. */
function useRoadmap() {
  const live = useLiveData(ROADMAP_API, 0, readRoadmap);
  const [current, setCurrent] = useState<RoadmapResponse | null>(null);
  useEffect(() => { if (live.data) setCurrent(live.data); }, [live.data]);
  const response = current ?? live.data;

  const roadmapId = response?.roadmap?.id ?? null, status = response?.roadmap?.status ?? null;
  useEffect(() => {
    if (!roadmapId || !isPending(status)) return;
    const pending = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const now = normalizeRoadmapStatus(await (await getJson(`${ROADMAP_API}/status`, pending.signal)).json());
        if (pending.signal.aborted) return;
        if (now.id !== roadmapId || now.status !== status) {
          const fresh = await readRoadmap(await getJson(ROADMAP_API, pending.signal));
          if (pending.signal.aborted) return;
          setCurrent(fresh);
          if (fresh.roadmap?.id !== roadmapId || fresh.roadmap?.status !== status) return;
        } else {
          setCurrent((value) => value && (value.worker.online !== now.worker.online || value.worker.supportsRoadmap !== now.worker.supportsRoadmap)
            ? { ...value, worker: now.worker } : value);
        }
      } catch { /* a failed poll keeps the last state; the next one tries again */ }
      if (!pending.signal.aborted) timer = setTimeout(() => void poll(), ROADMAP_POLL_MS);
    };
    timer = setTimeout(() => void poll(), ROADMAP_POLL_MS);
    return () => { pending.abort(); clearTimeout(timer); };
  }, [roadmapId, status]);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const create = () => {
    setCreating(true); setCreateError("");
    postRoadmap().then((roadmap) => {
      if (roadmap) setCurrent((value) => value && { ...value, roadmap, stale: false });
    }, (error: Error) => setCreateError(error.message)).finally(() => setCreating(false));
  };

  // Tell screen readers when the AI finishes or fails while the page is open.
  const [announcement, setAnnouncement] = useState("");
  const shown = useRef<RoadmapStatus | null>(null);
  useEffect(() => {
    const before = shown.current;
    shown.current = status;
    if (before && isPending(before) && status === "completed") setAnnouncement("EduPath AI đã soạn xong lộ trình học tập.");
    if (before && isPending(before) && status === "failed") setAnnouncement("Chưa soạn được lộ trình học tập.");
  }, [status]);

  return { response, loading: live.loading && !response, error: response ? null : live.error, create, creating, createError, announcement };
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000)) || 0;
  return <span className="rm-elapsed"><span className="sr-only">Đã chạy </span>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</span>;
}

/* ---------------------------------------------------------------- sections */

function StudyItem({ item }: { item: RoadmapStudy }) {
  const tag = studyTag(item);
  return <li className={`rm-item${item.advice ? "" : " rm-item-plain"}`}>
    <div className="rm-item-head">
      <strong>{item.name}</strong>
      <span className={`rm-tag rm-tag-${tag.tone}`}>{tag.text}</span>
    </div>
    <p className="rm-item-meta">{item.code}{item.credits !== null ? ` · ${decimalText(item.credits)} tín chỉ` : ""}</p>
    {item.advice && <p className="rm-advice">{item.advice}</p>}
    {!item.advice && item.careerSkills.length > 0 && <p className="rm-item-meta">{helpsText(item.careerSkills)}</p>}
  </li>;
}

function StudySection({ roadmap }: { roadmap: Roadmap }) {
  const picked = roadmap.study.filter((item) => item.advice);
  const others = roadmap.study.filter((item) => !item.advice);
  return <section className="sw-panel rm-section" aria-labelledby="rm-study">
    <header className="rm-section-head"><span className="rm-section-icon" aria-hidden="true"><Icon name="book" /></span><div>
      <h2 id="rm-study">Môn bạn cần học</h2>
      <p>Học phần đang học, học phần trễ so với kế hoạch đào tạo (kể cả học phần được kế hoạch đào tạo xếp vào học kỳ đang học mà bạn chưa đăng ký) và học phần theo kế hoạch của học kỳ tới.</p>
    </div></header>
    {!roadmap.study.length && !roadmap.choices.length && <p className="rm-empty">Không có học phần nào cần học thêm trong kế hoạch đào tạo của bạn.</p>}
    {picked.length > 0 && <ul className="rm-items">{picked.map((item) => <StudyItem key={item.code} item={item} />)}</ul>}
    {others.length > 0 && (picked.length > 0
      ? <details className="rm-more"><summary>Các học phần khác trong kế hoạch ({others.length})</summary><ul className="rm-items rm-items-compact">{others.map((item) => <StudyItem key={item.code} item={item} />)}</ul></details>
      : <ul className="rm-items rm-items-compact">{others.map((item) => <StudyItem key={item.code} item={item} />)}</ul>)}
    {roadmap.choices.length > 0 && <div className="rm-choices">
      <h3>Nhóm tự chọn còn thiếu</h3>
      <ul>{roadmap.choices.map((choice, index) => <li key={`${choice.label}-${index}`}>{choiceText(choice)}</li>)}</ul>
    </div>}
  </section>;
}

function ImproveItem({ item }: { item: RoadmapImprove }) {
  return <li className={`rm-item${item.advice ? "" : " rm-item-plain"}`}>
    <div className="rm-item-head">
      <strong>{item.name}</strong>
      <span className={`rm-tag ${item.action === "retake" ? "rm-tag-retake" : "rm-tag-improve"}`}>{improveTag(item.action)}</span>
    </div>
    <p className="rm-item-meta">{item.code} · {decimalText(item.credits)} tín chỉ · điểm chữ {item.letter}</p>
    {item.advice && <p className="rm-advice">{item.advice}</p>}
    {!item.advice && item.careerSkills.length > 0 && <p className="rm-item-meta">{helpsText(item.careerSkills)}</p>}
  </li>;
}

/**
 * Học lại (not passed) and học cải thiện (passed, to raise the grade) apart, each with what it means (user 2026-10-31: "Hệ thống
 * đang gọi môn bị rớt là 'môn cần cải thiện'"); the title names the kinds shown (improveHeading).
 */
function ImproveSection({ roadmap }: { roadmap: Roadmap }) {
  const retake = roadmap.improve.filter((item) => item.action === "retake");
  const improve = roadmap.improve.filter((item) => item.action !== "retake");
  return <section className="sw-panel rm-section" aria-labelledby="rm-improve">
    <header className="rm-section-head"><span className="rm-section-icon" aria-hidden="true"><Icon name="refresh" /></span><div>
      <h2 id="rm-improve">{improveHeading(roadmap.improve)}</h2>
    </div></header>
    {!roadmap.improve.length && <p className="rm-empty">Bạn không có học phần nào cần học lại hay học cải thiện.</p>}
    {retake.length > 0 && <div className="rm-improve-group">
      <h3>Học lại</h3>
      <p>Học phần chưa đạt (điểm F, VT hoặc CT), cần học lại.</p>
      <ul className="rm-items">{retake.map((item) => <ImproveItem key={item.code} item={item} />)}</ul>
    </div>}
    {improve.length > 0 && <div className="rm-improve-group">
      <h3>Học cải thiện</h3>
      <p>Học phần đã đạt nhưng điểm D hoặc D+; học lại nếu bạn muốn nâng điểm.</p>
      <ul className="rm-items">{improve.map((item) => <ImproveItem key={item.code} item={item} />)}</ul>
    </div>}
  </section>;
}

/** outcomeTitle: "Cuối học kỳ", or "Sau 3 tháng" for a roadmap made before roadmaps followed the school calendar. */
function SkillItem({ skill, outcomeTitle }: { skill: RoadmapSkill; outcomeTitle: string }) {
  return <li className="rm-skill">
    <div className="rm-item-head">
      <strong>{skill.name}</strong>
      <span className="rm-tags">{skillTags(skill).map((tag) => <span key={tag} className={`rm-tag${tag === "Cần tự học" ? " rm-tag-self" : tag === "Bắt buộc" ? " rm-tag-required" : ""}`}>{tag}</span>)}</span>
    </div>
    <p className="rm-item-meta">{sentence(skill.statusLabel)}</p>
    {skill.why && <p className="rm-advice">{skill.why}</p>}
    {skill.steps.length > 0 && <div className="rm-skill-block"><h4>Cách học</h4><ol>{skill.steps.map((step, index) => <li key={index}>{step}</li>)}</ol></div>}
    {skill.outcome && <div className="rm-skill-block"><h4>{outcomeTitle}</h4><p>{skill.outcome}</p></div>}
    {skill.courses.length > 0 && <p className="rm-item-meta">Học phần trong chương trình giúp bổ sung: {skill.courses.map((course) => course.name).join(", ")}.</p>}
  </li>;
}

function SkillsSection({ roadmap, completed }: { roadmap: Roadmap; completed: boolean }) {
  const picked = roadmap.skills.filter((skill) => skill.picked);
  const others = roadmap.skills.filter((skill) => !skill.picked);
  return <section className="sw-panel rm-section" aria-labelledby="rm-skills">
    <header className="rm-section-head"><span className="rm-section-icon" aria-hidden="true"><Icon name="target" /></span><div>
      <h2 id="rm-skills">Kỹ năng, kiến thức nên bổ sung</h2>
      <p>{roadmap.careerName ? `Để nâng cao trình độ và tăng khả năng làm việc ở vị trí nghề nghiệp ${roadmap.careerName}.` : "Để nâng cao trình độ và tăng khả năng làm việc."}</p>
    </div></header>
    {!roadmap.skills.length && <p className="rm-empty">Bạn đã đạt các kỹ năng của vị trí nghề nghiệp mục tiêu theo kết quả hiện có.</p>}
    {picked.length > 0 && <ul className="rm-skills">{picked.map((skill) => <SkillItem key={skill.key} skill={skill} outcomeTitle={roadmap.window.term ? "Cuối học kỳ" : "Sau 3 tháng"} />)}</ul>}
    {others.length > 0 && (completed && picked.length
      ? <p className="rm-others">Kỹ năng khác của vị trí nghề nghiệp còn có thể bổ sung: {others.map((skill) => skill.name).join(", ")}.</p>
      : <ul className="rm-items rm-items-compact">{others.map((skill) => <li key={skill.key} className="rm-item rm-item-plain">
        <div className="rm-item-head"><strong>{skill.name}</strong><span className="rm-tags">{skillTags(skill).map((tag) => <span key={tag} className="rm-tag">{tag}</span>)}</span></div>
        <p className="rm-item-meta">{sentence(skill.statusLabel)}</p>
      </li>)}</ul>)}
  </section>;
}

function MonthsSection({ roadmap }: { roadmap: Roadmap }) {
  return <section className="sw-panel rm-section" aria-labelledby="rm-months">
    <header className="rm-section-head"><span className="rm-section-icon" aria-hidden="true"><Icon name="clock" /></span><div>
      <h2 id="rm-months">Kế hoạch theo tháng</h2>
      <p>Cân đối giữa học trên lớp, học lại hoặc học cải thiện và tự học kỹ năng.</p>
    </div></header>
    <ol className="rm-months">{roadmap.months.map((month) => <li key={month.month} className="rm-month">
      <h3>{monthTitle(month)}</h3>
      {month.focus && <p className="rm-month-focus">{month.focus}</p>}
      {month.tasks.length ? <ul>{month.tasks.map((task, index) => <li key={index}>{task}</li>)}</ul> : <p className="rm-item-meta">Chưa có việc cụ thể cho tháng này.</p>}
    </li>)}</ol>
  </section>;
}

/* -------------------------------------------------------------------- page */

/**
 * Where the advice comes from (roadmap-v9; user 2026-10-30: "Nên tách riêng phần 'bạn tự đánh giá' với 'hệ thống ghi
 * nhận'"): what the system has on record next to what the student says in Khảo sát định hướng, which the AI may only
 * repeat as the student's own view.
 */
function BasisBox({ basis }: { basis: RoadmapBasis }) {
  return <section className="rm-basis" aria-labelledby="rm-basis-title">
    <h3 id="rm-basis-title">Lời khuyên dựa trên</h3>
    <div className="rm-basis-cols">
      <div>
        <h4>Hệ thống ghi nhận</h4>
        <p>Từ bảng điểm và kết quả Đánh giá năng lực của bạn.</p>
        <ul>{basis.recorded.map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
      <div>
        <h4>Bạn tự đánh giá</h4>
        <p>Từ Khảo sát định hướng, chưa được kiểm chứng. AI chỉ nhắc lại là ý kiến của bạn và gợi ý cách chứng minh.{basis.surveyChanged ? " Bạn đã sửa khảo sát sau khi lộ trình này được soạn." : ""}</p>
        {basis.selfReported.length ? <ul>{basis.selfReported.map((line) => <li key={line}>{line}</li>)}</ul> : <p>Bạn chưa nêu công nghệ hay kinh nghiệm nào.</p>}
      </div>
    </div>
  </section>;
}

/** The AI advises from the profile survey (user 2026-10-24), so a roadmap needs it first. */
const SURVEY_NOTE_ID = "rm-survey-needed";
function SurveyNeeded({ again = false }: { again?: boolean }) {
  return <div className="rm-survey-needed" id={SURVEY_NOTE_ID} role="note">
    <p><strong>Cần hoàn thành Khảo sát định hướng{again ? " trước khi tạo lại" : ""}.</strong> EduPath AI dùng mục tiêu, kinh nghiệm, thời gian tự học và thành tích của bạn để lộ trình sát với bạn hơn. Khảo sát chủ yếu gồm các câu chọn đáp án có sẵn, chỉ mất vài phút.</p>
    <a className="sw-primary" href="#profile">Làm khảo sát ở Hồ sơ và bảng điểm <Icon name="arrow" /></a>
  </div>;
}

function AiState({ roadmap, response, create, creating }: { roadmap: Roadmap; response: RoadmapResponse; create: () => void; creating: boolean }) {
  if (roadmap.status === "queued" || roadmap.status === "processing") {
    const copy = pendingCopy(roadmap.status, response.worker, roadmap.errorCode);
    const moving = roadmap.status === "processing" || (response.worker.online && response.worker.supportsRoadmap);
    return <div className={`rm-ai-state${moving ? " rm-ai-pending" : ""}`} aria-busy={moving}>
      {moving && <span className="rm-spinner" aria-hidden="true" />}
      <strong>{copy.title}</strong>
      <p>{roadmap.status === "processing" && <><Elapsed since={roadmap.createdAt} /> · </>}{copy.text}</p>
      <p>Trong lúc chờ, các học phần và kỹ năng do hệ thống tính sẵn đã hiện bên dưới.</p>
    </div>;
  }
  if (roadmap.status === "failed" || roadmap.status === "cancelled") {
    return <div className="rm-ai-state rm-ai-problem">
      <strong>{roadmap.status === "failed" ? "Chưa soạn được lộ trình" : "Yêu cầu soạn lộ trình đã dừng"}</strong>
      <p>{roadmap.status === "failed" ? `${failureText(roadmap.errorCode)} ` : ""}Các học phần và kỹ năng do hệ thống tính bên dưới vẫn dùng được.</p>
      <div className="rm-actions"><button type="button" className="sw-outline" disabled={creating || !response.surveyDone}
        aria-describedby={response.surveyDone ? undefined : SURVEY_NOTE_ID} onClick={create}><Icon name="refresh" />{creating ? "Đang gửi…" : "Thử lại"}</button></div>
    </div>;
  }
  return null;
}

/** "Bấm Tạo lại …", or, while the survey a new roadmap needs is not done (POST answers 409 survey_required), what comes first. */
const regenerateText = (surveyDone: boolean, purpose: string) =>
  surveyDone ? `Bấm Tạo lại ${purpose}` : `Hoàn thành Khảo sát định hướng rồi bấm Tạo lại ${purpose}`;

function RoadmapView({ roadmap, response, create, creating, createError }: {
  roadmap: Roadmap; response: RoadmapResponse; create: () => void; creating: boolean; createError: string;
}) {
  const completed = roadmap.status === "completed";
  const pending = isPending(roadmap.status);
  return <>
    <section className="sw-panel rm-hero" aria-labelledby="rm-title">
      <div className="rm-hero-head">
        <div>
          <p className="rm-eyebrow">{roadmapWindowTitle(roadmap.window)}</p>
          <h2 id="rm-title">Từ {dateText(roadmap.window.start)} đến {dateText(roadmap.window.end)}</h2>
          <p className="rm-hero-meta">{[roadmap.careerName && `Vị trí nghề nghiệp mục tiêu: ${roadmap.careerName}`, roadmap.specialtyLabel && `Chuyên ngành: ${roadmap.specialtyLabel}`].filter(Boolean).join(" · ")}</p>
        </div>
        {/* A new roadmap needs the survey (POST answers 409 survey_required): "Tạo lại" waits for it. */}
        {!pending && <button type="button" className="sw-outline" disabled={creating || !response.surveyDone}
          aria-describedby={response.surveyDone ? undefined : SURVEY_NOTE_ID} onClick={create}><Icon name="refresh" />{creating ? "Đang gửi…" : "Tạo lại"}</button>}
      </div>
      {createError && <p className="rm-error" role="alert">{createError}</p>}
      {!response.surveyDone && !pending && <SurveyNeeded again />}
      {response.stale && <p className="rm-note">Kết quả Đánh giá năng lực của bạn đã thay đổi sau khi lộ trình này được soạn. {regenerateText(response.surveyDone, "để cập nhật theo kết quả mới.")}</p>}
      {roadmap.ended && <p className="rm-note">Lộ trình này đã hết thời gian (đến {dateText(roadmap.window.end)}). {regenerateText(response.surveyDone, "để soạn lộ trình cho học kỳ tiếp theo.")}</p>}
      <AiState roadmap={roadmap} response={response} create={create} creating={creating} />
      {completed && roadmap.summary && <div className="rm-summary">
        <span className="rm-ai-icon" aria-hidden="true"><Icon name="spark" /></span>
        <div>
          <h3>Lời khuyên của cố vấn AI <span className="rm-ai-tag">AI</span></h3>
          <p>{roadmap.summary}</p>
          {roadmap.advice.length > 0 && <ul className="rm-advice-list">{roadmap.advice.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        </div>
      </div>}
      {response.basis && <BasisBox basis={response.basis} />}
    </section>
    <StudySection roadmap={roadmap} />
    <ImproveSection roadmap={roadmap} />
    <SkillsSection roadmap={roadmap} completed={completed} />
    {completed && <MonthsSection roadmap={roadmap} />}
    <p className="rm-footer">{completed
      ? `Lộ trình do ${modelLabel(roadmap.model)} (chạy cục bộ) soạn lúc ${formatDateTime(roadmap.completedAt ?? roadmap.createdAt)} từ kết quả Đánh giá năng lực của bạn.`
      : "Các học phần và kỹ năng trên do hệ thống tính từ kết quả Đánh giá năng lực của bạn."} Lộ trình chỉ để tham khảo: hãy trao đổi với cố vấn học tập và xem lịch đăng ký học phần của trường trước khi đăng ký.</p>
  </>;
}

export default function StudentAiRoadmap() {
  const { response, loading, error, create, creating, createError, announcement } = useRoadmap();
  const live = <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>;
  if (loading) return <section className="sw-panel" aria-busy="true"><p role="status">Đang tải lộ trình học tập…</p></section>;
  if (error || !response) return <section className="sw-panel rm-problem" role="alert"><strong>Chưa tải được lộ trình học tập</strong><p>{error ?? "Vui lòng thử lại sau."}</p></section>;
  const { roadmap, assessment } = response;

  if (!roadmap && !assessment) return <section className="sw-panel sw-empty rm-start">
    <span className="rm-start-icon" aria-hidden="true"><Icon name="route" /></span>
    <h2>Chưa có kết quả Đánh giá năng lực</h2>
    <p>Lộ trình học tập được soạn từ kết quả Đánh giá năng lực mới nhất của bạn. Hãy tạo kết quả đánh giá trước, rồi quay lại đây.</p>
    <a className="sw-primary" href="#competency">Mở Đánh giá năng lực <Icon name="arrow" /></a>
  </section>;

  if (!roadmap) return <section className="sw-panel rm-start">
    {live}
    <span className="rm-start-icon" aria-hidden="true"><Icon name="route" /></span>
    <h2>Lộ trình học tập cho học kỳ tới</h2>
    <p>EduPath AI đóng vai cố vấn học tập, soạn cho bạn kế hoạch {response.upcoming?.term ? roadmapTermLabel(response.upcoming.term) : "học kỳ tới"}{response.upcoming ? ` (dự kiến từ ${dateText(response.upcoming.start)} đến ${dateText(response.upcoming.end)})` : ""}:</p>
    <ul className="rm-start-list">
      <li><Icon name="book" /><span><strong>Môn bạn cần học</strong> theo kế hoạch đào tạo: học phần đang học, học phần trễ và học phần của học kỳ tới.</span></li>
      <li><Icon name="refresh" /><span><strong>Môn học bạn cần học lại và cải thiện</strong>: học lại học phần chưa đạt; học cải thiện học phần đã đạt điểm D, D+ nếu bạn muốn nâng điểm.</span></li>
      <li><Icon name="target" /><span><strong>Kỹ năng, kiến thức nên bổ sung</strong> để nâng cao trình độ và tăng khả năng làm việc ở vị trí nghề nghiệp mục tiêu.</span></li>
      <li><Icon name="spark" /><span><strong>Lời khuyên theo mục tiêu của bạn</strong>: tiến độ tốt nghiệp, nên học gì để làm việc thực tế tốt hơn, dựa trên kết quả đánh giá và Khảo sát định hướng.</span></li>
    </ul>
    {!response.aiEnabled
      ? <p className="rm-note">Lộ trình do EduPath AI soạn hiện chưa được bật.</p>
      : <>
        {assessment && !assessment.hasCareer && <p className="rm-note">Kết quả đánh giá của bạn chưa có vị trí nghề nghiệp mục tiêu nên lộ trình sẽ chưa có phần kỹ năng của vị trí nghề nghiệp. Hãy chọn vị trí nghề nghiệp mục tiêu ở Hồ sơ và bảng điểm rồi đánh giá lại để có lộ trình đầy đủ.</p>}
        {!response.surveyDone ? <SurveyNeeded /> : <>
          {!response.worker.online && <p className="rm-note">Máy AI đang tạm nghỉ: yêu cầu của bạn sẽ được giữ trong hàng đợi và lộ trình sẽ được soạn khi máy hoạt động trở lại.</p>}
          <div className="rm-actions"><button type="button" className="sw-primary" disabled={creating} onClick={create}><Icon name="spark" />{creating ? "Đang gửi…" : "Tạo lộ trình"}</button></div>
        </>}
        {createError && <p className="rm-error" role="alert">{createError}</p>}
      </>}
    <p className="rm-footer">Lộ trình sẽ dùng kết quả Đánh giá năng lực tạo lúc {formatDateTime(assessment?.createdAt)}. Nếu bảng điểm vừa thay đổi, hãy tạo lại kết quả đánh giá trước.</p>
  </section>;

  return <div className="rm-page">{live}<RoadmapView roadmap={roadmap} response={response} create={create} creating={creating} createError={createError} /></div>;
}
