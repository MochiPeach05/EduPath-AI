import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { Icon } from "./student-icons";
import { useLiveData } from "./use-live-data";
import { competencyPolicyHref, isValidConsent, policyVersion } from "./public-information";
import type { StudentProfile } from "./StudentOverview";
import { specialtyLabel, type AiStatus, type AssessmentResult, type AssessmentStatusResponse, type CareerRequirementResult, type CourseSuggestion, type LatestAssessmentResponse, type LevelCode, type PreviousAiComment, type SkillPlan, type SkillResult, type StoredAssessment, type SupportCourse } from "./competency-assessment-types";
import {
  CHART_LEVELS, COMPETENCY_API, CONFIDENCE_LABELS, COURSE_STATE_LABELS, EMPTY_SKILL_FILTERS, FIT_LABELS, FIT_SCALE, LEVEL_COLUMNS, LEVEL_LABELS, LEVEL_SCALE, LEVEL_THRESHOLDS, PRECONDITION_COPY, PRIORITY_LABELS, UNSCORED_STATES,
  aiErrorMessage, aiReasoned, aiStateCopy, bucketSkills, canRegenerate, careerDataText, careerSkillKeys, careerThresholdsLine, chartLevelLabel, choiceLabel, confidentStrengths, courseTermText, currentImprovements, courseStanding, dataUsedLine, displayLevel, eligibilityDisplay, errorMessage, filterSkills, fitLevelOf, fitScoreOf, fitStep, formatDateTime,
  careerSummaryText, formatDifference, formatNumber, formatPercent, formatScore, gapHistory, gapStatusDisplay, groupEvidenceCounts, historySentence, historyYears, isGap, isOverdue, isPreconditionError, levelChart, levelSentence, levelStep, nextCourseCount, nextTermOf, noCreditSkill, overallIsPooled, overdueText, countsFromStudyTerm, thesisWayAdvised, thesisPlanOutdatedText, lateBeforeStudyTerm, physicalEducationOutdated, levelSummary, levelText, mapAiOutput, missingRequirements, skillGroupKeys, missingRequirementsMessage, modelLabel, modelPlace, needsSelfStudy,
  plannedCourseNote, plansFor, relatedSkillNames, scoreDifference, shouldPoll, skillName, sortRequirements, studyTermOf, upcomingText, withCurrentLevels, type ChartLevel, type DisplayLevel, type FitLevel, type LevelBar, type LevelSegment, type MappedAiOutput, type PreconditionError, type SkillFilters, type StatusTone,
  fitMeaning, historyTermName, levelMeaning, noGapText, scoreSources, scoreSourcesText,
  careerRaise, failedCommentText, hasCompetencyContent, hasGapContent, normalizePreviousComment, ownComment, previousComment, previousCommentNote,
} from "./student-competency-data";
import { meaningClass, termName } from "./display-format";
import { readGraduation } from "./student-graduation-api";
import { GRADUATION_API, unresolvedCopy, verdictHeadline } from "./student-graduation-data";
import type { GraduationEvaluation } from "./student-graduation-types";
import "./student-curriculum.css";
import "./student-graduation.css";
import "./student-records.css";
import { isAdvisorView } from "./advisor-view";
import { ActingConfirmDialog, assessmentConfirm } from "./acting-confirm";
import "./student-competency.css";

// Two student pages share this module and one stored assessment:
// - #competency ("Đánh giá năng lực", STU-COMP): overall and group scores, the proficiency table,
//   progress versus the training plan and the graduation check of the graduation page;
// - #skill-gap ("Khoảng trống kỹ năng", STU-GAP): career fit, missing skills and their shortfall,
//   the courses that close them and the skills to study alone.
export type CompetencyView = "competency" | "gap";

type Profile = Pick<StudentProfile, "careerPositionId" | "careerPosition"> & { specialty?: string | null };
type ApiError = Error & { code?: string; status?: number };

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...init });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    const error: ApiError = new Error(errorMessage(data.error ?? (response.status === 404 ? "not_found" : null)));
    error.code = data.error; error.status = response.status;
    throw error;
  }
  return data;
}
async function readLatest(response: Response): Promise<LatestAssessmentResponse> {
  const data = await response.json().catch(() => ({})) as LatestAssessmentResponse & { error?: string };
  if (!response.ok) throw new Error(errorMessage(data.error, "Chưa tải được kết quả đánh giá năng lực."));
  return {
    assessment: data.assessment ?? null, aiEnabled: Boolean(data.aiEnabled), workerOnline: Boolean(data.workerOnline),
    consentVersion: typeof data.consentVersion === "string" ? data.consentVersion : null, previous: normalizePreviousComment(data.previous),
    ...(Array.isArray(data.thesisPlanOutdated) && data.thesisPlanOutdated.length ? { thesisPlanOutdated: data.thesisPlanOutdated.filter((code) => typeof code === "string") } : {}),
  };
}
async function readTranscriptPresence(response: Response): Promise<boolean> {
  if (!response.ok) throw new Error("Chưa kiểm tra được bảng điểm.");
  const data = await response.json().catch(() => ({})) as { transcript?: unknown };
  return Boolean(data.transcript);
}
const jsonWrite = (method: string, body: unknown = {}): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const scrollToSection = (id: string) => {
  const target = document.getElementById(id);
  if (!target) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
};

/* ------------------------------------------------------------ small parts */

/** Gridlines at the bounds of Trung bình, Khá, Giỏi and Xuất sắc. */
const LEVEL_TICKS = [LEVEL_THRESHOLDS.basic, LEVEL_THRESHOLDS.good, LEVEL_THRESHOLDS.proficient, LEVEL_THRESHOLDS.excellent];
/** Gridlines and axis labels of the 0–100 bars: the ends and those bounds. */
const SKILL_TICKS = [0, ...LEVEL_TICKS, 100];

/** Badges wear the colour of their word (levelMeaning, fitMeaning); a badge without a score keeps the dashed outline. */
function LevelBadge({ level, label }: { level: LevelCode | DisplayLevel | null; label: string | null }) {
  const step = levelStep(level);
  const none = level === "no_evidence" || level === "upcoming" || level === "not_studied" || level === "no_score" || level === null;
  const meaning = levelMeaning(level);
  return <span className={`scomp-level scomp-level-${step}${none ? " scomp-level-none" : ""}${meaning !== "none" ? ` ${meaningClass(meaning)}` : ""}`}>
    <span className="scomp-pips" aria-hidden="true">{[1, 2, 3, 4, 5].map((pip) => <i key={pip} className={pip <= step ? "is-on" : undefined} />)}</span>
    {levelText(level, label)}
  </span>;
}
/** The fit level as a badge with the pips of LevelBadge (2026-10-22: "tương tự của phần đánh giá năng lực"). */
function FitBadge({ level }: { level: FitLevel }) {
  const step = fitStep(level);
  const meaning = fitMeaning(level);
  return <span className={`scomp-level scomp-level-${step}${step === 0 ? " scomp-level-none" : ""}${meaning !== "none" ? ` ${meaningClass(meaning)}` : ""}`}>
    <span className="scomp-pips" aria-hidden="true">{[1, 2, 3, 4, 5].map((pip) => <i key={pip} className={pip <= step ? "is-on" : undefined} />)}</span>
    {FIT_LABELS[level]}
  </span>;
}
/** Score bar on the shared 0–100 scale; decorative, the number is printed beside it. */
function ScoreBar({ score, level, ticks = [], threshold }: { score: number | null; level: LevelCode | null; ticks?: number[]; threshold?: number }) {
  const width = score === null ? 0 : Math.max(0, Math.min(100, score));
  return <span className={`scomp-bar${score === null ? " scomp-bar-empty" : ""}`} aria-hidden="true">
    {ticks.map((tick) => <i key={tick} className="scomp-bar-tick" style={{ left: `${tick}%` }} />)}
    {score !== null && <span className={`scomp-bar-fill scomp-fill-${levelStep(level)}`} style={{ width: `${width}%` }} />}
    {threshold !== undefined && <i className="scomp-bar-threshold" style={{ left: `${threshold}%` }} />}
  </span>;
}
function StatusText({ tone, glyph, text }: { tone: StatusTone; glyph: string; text: string }) {
  return <span className={`scomp-status ${tone === "neutral" ? "scomp-status-neutral" : `sg-status-${tone}`}`}><span aria-hidden="true">{glyph}</span> {text}</span>;
}
function Section({ id, title, children, className = "", description, aside }: { id: string; title: string; children: ReactNode; className?: string; description?: ReactNode; aside?: ReactNode }) {
  return <section id={id} tabIndex={-1} className={`sw-panel scomp-section ${className}`} aria-labelledby={`${id}-title`}>
    <div className="scomp-section-heading"><div><h2 id={`${id}-title`}>{title}</h2>{description && <p className="scomp-lead">{description}</p>}</div>{aside}</div>
    {children}
  </section>;
}

function useModal(onCancel: () => void, busy: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (element && !element.open) element.showModal?.();
    return () => { element?.close?.(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return { ref: dialog, onCancel: (event: SyntheticEvent) => { event.preventDefault(); if (!busy) onCancel(); } };
}

function ConsentDialog({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const modal = useModal(onClose, busy);
  const [checked, setChecked] = useState(false);
  return <dialog ref={modal.ref} className="sr-confirm-dialog scomp-dialog" aria-labelledby="scomp-consent-title" aria-describedby="scomp-consent-text" onCancel={modal.onCancel}>
    <h2 id="scomp-consent-title">Đồng ý đánh giá năng lực</h2>
    <div id="scomp-consent-text">
      <p>EduPath AI sẽ dùng bảng điểm, khóa, chuyên ngành và vị trí nghề nghiệp mục tiêu của bạn để tính điểm năng lực, khoảng trống kỹ năng và gợi ý học phần. Kết quả được lưu trong tài khoản của bạn (tối đa 20 lần gần nhất) đến khi bạn xóa.</p>
      <p>Nếu nhận xét AI được bật, mô hình chạy trên Cloudflare Workers AI chỉ nhận mã, tên học phần, điểm và kết quả đã tính — không nhận họ tên, MSSV, email hay tệp PDF.</p>
    </div>
    <label className="sr-confirm scomp-consent-check"><input type="checkbox" checked={checked} disabled={busy} onChange={(event) => setChecked(event.target.checked)} /><span>Tôi đồng ý để EduPath AI xử lý dữ liệu học tập của tôi cho việc đánh giá năng lực theo <a href={competencyPolicyHref} target="_blank" rel="noreferrer">Chính sách bảo mật</a>.</span></label>
    <div className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" disabled={busy} onClick={onClose} autoFocus>Để sau</button>
      <button type="button" className="sw-primary" disabled={busy || !checked} onClick={onConfirm}>{busy ? "Đang đánh giá…" : "Đồng ý và đánh giá"}</button>
    </div>
  </dialog>;
}

function DeleteDialog({ busy, error, onClose, onConfirm }: { busy: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  const modal = useModal(onClose, busy);
  return <dialog ref={modal.ref} className="sr-confirm-dialog scomp-dialog" aria-labelledby="scomp-delete-title" aria-busy={busy} onCancel={modal.onCancel}>
    <h2 id="scomp-delete-title">Xóa kết quả đánh giá</h2>
    <p>Xóa toàn bộ kết quả đánh giá năng lực và nhận xét AI đã lưu, đồng thời rút lại sự đồng ý cho việc đánh giá? Bảng điểm và hồ sơ của bạn vẫn được giữ nguyên. Bạn có thể đánh giá lại bất cứ lúc nào.</p>
    {error && <p className="sr-error" role="alert">{error}</p>}
    <div className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" disabled={busy} onClick={onClose} autoFocus>Hủy</button>
      <button type="button" className="sw-primary sr-delete-confirm" disabled={busy} onClick={onConfirm}>{busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
    </div>
  </dialog>;
}

/* ------------------------------------------------- "Đánh giá năng lực" page */

function Overview({ result }: { result: AssessmentResult }) {
  const { overall, career } = result;
  const names = (keys: string[]) => keys.map((key) => ({ key, name: skillName(result, key) })).filter((item): item is { key: string; name: string } => Boolean(item.name));
  const strengths = names(confidentStrengths(result)), improvements = names(currentImprovements(result));
  return <Section id="scomp-overview" title="Tổng quan" className="scomp-overview">
    <div className="scomp-overview-grid">
      <div className="scomp-score-card">
        <span className="scomp-kicker">Điểm năng lực tổng</span>
        <p className="scomp-big"><strong>{formatScore(overall.score)}</strong><span>/100</span></p>
        <p className="scomp-score-tags"><LevelBadge level={overall.level} label={overall.levelLabel} />{overall.confidence && <span className="scomp-confidence">{CONFIDENCE_LABELS[overall.confidence]}</span>}</p>
        <p className="scomp-prose">{levelSentence(overall.level)}</p>
        <p className="scomp-meta">Dựa trên {overall.basis.skillsWithEvidence.toLocaleString("vi-VN")}/{overall.basis.applicableSkills.toLocaleString("vi-VN")} kỹ năng có minh chứng từ {overall.basis.evidenceCourses.toLocaleString("vi-VN")} học phần.{overallIsPooled(result.meta.calcVersion)
          ? " Điểm tổng gộp tất cả các kỹ năng đó, tính cùng cách với điểm nhóm."
          : ` Điểm tổng của kết quả này là trung bình của ${overall.groupsWithScore.toLocaleString("vi-VN")} nhóm (cách tính cũ); bấm “Đánh giá lại” để tính theo cách mới, gộp tất cả kỹ năng như điểm nhóm.`}</p>
      </div>
      <div className="scomp-groups">
        <h3>Theo nhóm năng lực</h3>
        <ul>{result.groups.map((group) => { const counts = groupEvidenceCounts(result.skills, group.key); return <li key={group.key}>
          <div className="scomp-group-label"><strong>{group.name}</strong><span>{counts.withEvidence.toLocaleString("vi-VN")}/{counts.total.toLocaleString("vi-VN")} kỹ năng có minh chứng</span></div>
          <ScoreBar score={group.score} level={group.level} ticks={LEVEL_TICKS} />
          <div className="scomp-group-value"><strong>{formatScore(group.score)}</strong><span>{levelText(group.level, group.levelLabel)}</span></div>
        </li>; })}</ul>
        <div className="scomp-axis-row" aria-hidden="true"><span /><div className="scomp-axis">{SKILL_TICKS.map((tick) => <span key={tick} style={{ left: `${tick}%` }}>{formatNumber(tick)}</span>)}</div><span /></div>
      </div>
      <div className="scomp-fit-tile">
        <span className="scomp-kicker">Mức phù hợp với vị trí nghề nghiệp</span>
        {career ? <>
          <p className="scomp-score-tags">{fitLevelOf(career) !== "insufficient_data" && <strong className="scomp-fit-label">{formatScore(fitScoreOf(career.requirements))}<small>/100</small></strong>}<FitBadge level={fitLevelOf(career)} /></p>
          <p>{career.nameVi}</p>
          <p className="scomp-meta">{careerSummaryText(career)}</p>
          <a className="sw-text-link" href="#skill-gap">Xem Khoảng trống kỹ năng <Icon name="arrow" /></a>
        </> : <>
          <strong className="scomp-fit-label">Chưa chọn vị trí nghề nghiệp</strong>
          <p className="scomp-meta">Chọn vị trí nghề nghiệp mục tiêu để biết kỹ năng nào cần bổ sung.</p>
          <a className="sw-text-link" href="#career">Chọn vị trí nghề nghiệp mục tiêu <Icon name="arrow" /></a>
        </>}
      </div>
    </div>
    {(strengths.length > 0 || improvements.length > 0) && <div className="scomp-chips">
      {strengths.length > 0 && <div><span className="scomp-chip-title">Điểm mạnh</span><ul>{strengths.map((item) => <li key={item.key} className="scomp-chip">{item.name}</li>)}</ul></div>}
      {improvements.length > 0 && <div><span className="scomp-chip-title">Cần củng cố</span><ul>{improvements.map((item) => <li key={item.key} className="scomp-chip scomp-chip-soft">{item.name}</li>)}</ul></div>}
    </div>}
    <details className="scomp-legend"><summary>Thang mức năng lực</summary>
      <ul>{LEVEL_SCALE.map((item) => <li key={item.code}><LevelBadge level={item.code} label={item.label} /><span className="scomp-legend-range">{item.range}</span><span>{item.text}</span></li>)}</ul>
      <p className="scomp-meta">Cùng ngưỡng với xếp loại học lực trên bảng điểm (điểm hệ 4 × 25): 3,6 → 90 · 3,2 → 80 · 2,5 → 62,5 · 2,0 → 50.</p>
    </details>
  </Section>;
}

/** STU-COMP-07: the competency at the end of each graded term, grouped by school year. */
function HistorySection({ result }: { result: AssessmentResult }) {
  const history = result.history;
  const years = useMemo(() => historyYears(history ?? []), [history]);
  const sentence = history ? historySentence(history) : null;
  const columns = 5 + result.groups.length;
  return <Section id="scomp-history" title="Theo dõi năng lực theo học kỳ" description="Điểm năng lực tính lũy kế đến cuối mỗi học kỳ, chỉ từ các học phần đã có kết quả đến học kỳ đó, theo cùng cách tính và trọng số hiện hành. Nhờ đó bạn thấy năng lực của mình thay đổi thế nào qua từng năm học.">
    {!history ? <p className="scomp-meta">Kết quả này được tính trước khi có phần theo dõi theo học kỳ. Bấm “Đánh giá lại” để xem năng lực của bạn qua từng năm, từng học kỳ.</p>
      : !history.length ? <p className="scomp-meta">Bảng điểm chưa có học kỳ nào có điểm nên chưa theo dõi được.</p> : <>
        {sentence && <p className="scomp-prose">{sentence}</p>}
        <div className="scomp-table-scroll" tabIndex={0} role="region" aria-labelledby="scomp-history-caption">
          <table className="scomp-table scomp-history-table">
            <caption id="scomp-history-caption">Điểm năng lực tổng và điểm từng nhóm năng lực ở cuối mỗi học kỳ (thang 100)</caption>
            <thead><tr>
              <th scope="col">Học kỳ</th>
              <th scope="col" className="scomp-num">Học phần có kết quả</th>
              <th scope="col">Điểm năng lực tổng</th>
              <th scope="col">Mức</th>
              {result.groups.map((group) => <th key={group.key} scope="col" className="scomp-num">{group.name}</th>)}
              <th scope="col" className="scomp-num">Thay đổi</th>
            </tr></thead>
            {years.map((year) => <tbody key={year.schoolYear}>
              <tr className="scomp-year-row"><th colSpan={columns} scope="rowgroup">Năm học {year.schoolYear}<span>Cuối năm: {formatScore(year.end.overall.score)} · {levelText(year.end.overall.level, year.end.overall.levelLabel)}</span></th></tr>
              {year.rows.map((row) => <tr key={row.term} className={row.latest ? "scomp-history-latest" : undefined}>
                <th scope="row">{historyTermName(row)}{row.latest && <span className="scomp-career-tag">Mới nhất</span>}</th>
                <td className="scomp-num">{row.gradedCourses.toLocaleString("vi-VN")}</td>
                <td><span className="scomp-bullet"><ScoreBar score={row.overall.score} level={row.overall.level} ticks={LEVEL_TICKS} /><strong>{formatScore(row.overall.score)}</strong></span></td>
                <td><LevelBadge level={row.overall.level} label={row.overall.levelLabel} /></td>
                {result.groups.map((group) => { const value = row.groups.find((item) => item.key === group.key); return <td key={group.key} className="scomp-num">
                  {value && value.score !== null ? <><strong>{formatScore(value.score)}</strong><small>{levelText(value.level, value.levelLabel)}</small></> : <span className="scomp-zero">—</span>}
                </td>; })}
                <td className="scomp-num">{row.change === null ? <span className="scomp-zero">—</span>
                  : <span className={row.change > 0 ? "sg-status-pass" : row.change < 0 ? "sg-status-unknown" : "scomp-zero"}>{formatDifference(row.change)}</span>}</td>
              </tr>)}
            </tbody>)}
          </table>
        </div>
        <p className="scomp-meta">Điểm của học kỳ trước không thay đổi khi bạn học lại sau đó: mỗi dòng chỉ dùng kết quả có đến học kỳ đó. Học kỳ đang học chưa có điểm nên chưa có trong bảng.</p>
      </>}
  </Section>;
}

const LEVEL_COLUMN_LABELS: Record<(typeof LEVEL_COLUMNS)[number], string> = { ...LEVEL_LABELS, upcoming: "Sắp học", not_studied: "Chưa học", no_score: "Chưa có điểm", exempt: "Miễn/công nhận" };

const CHART_TIP_SKILLS = 5;
const CHART_RANGES: Partial<Record<ChartLevel, string>> = Object.fromEntries(LEVEL_SCALE.map((level) => [level.code, level.range]));
/** What the tooltip says about the level itself, after the count. */
function segmentNote(segment: LevelSegment): string {
  if (segment.level === "upcoming") return "Đang học hoặc sẽ học học phần đo các kỹ năng này ở học kỳ sau — không phải điểm yếu";
  if (segment.level === "not_studied") return "Học phần đo các kỹ năng này đã qua học kỳ trong kế hoạch mà bạn chưa học, hoặc không có trong kế hoạch";
  if (segment.level === "no_score") return "Đã học học phần liên quan nhưng bảng điểm chưa có điểm số, nên chưa đánh giá được";
  if (segment.level === "exempt") return "Học phần được miễn hoặc công nhận nên không có điểm";
  return `Điểm kỹ năng ${CHART_RANGES[segment.level] ?? ""}`;
}
/** The tooltip box opens toward the middle of the plot so it never leaves the card. */
const tipSide = (segment: LevelSegment) => (segment.start + segment.end) / 2 < 0.35 ? "start" : (segment.start + segment.end) / 2 > 0.65 ? "end" : "middle";
/**
 * Opens the tooltip below the mark when there is no room above it (under the sticky header, and under the strip stuck
 * below it when staff work in the student's page, advisor-view.css) and more room below.
 */
function placeTip(button: HTMLElement) {
  const tip = button.querySelector<HTMLElement>(".scomp-tip");
  if (!tip) return;
  const bar = button.getBoundingClientRect(), height = tip.getBoundingClientRect().height;
  const top = (document.querySelector(".sw-advisor-banner") ?? document.querySelector(".sw-topbar"))?.getBoundingClientRect().bottom ?? 0;
  const above = bar.top - top, below = window.innerHeight - bar.bottom;
  button.dataset.tip = above < height + 12 && below > above ? "below" : "above";
}

/** A segment is never narrower than this (px), so one skill can still be pointed at and tapped (2026-10-25: 4 px at 500 px wide). */
const CHART_MIN_SEGMENT = 14;
function ChartSegment({ bar, segment, last, scaleWidth, onSelect }: { bar: LevelBar; segment: LevelSegment; last: boolean; scaleWidth: number; onSelect: () => void }) {
  // The count rides inside the segment only when it fits with padding; otherwise the tooltip and the table carry it.
  const fits = scaleWidth > 0 && (segment.end - segment.start) * scaleWidth - 2 >= String(segment.count).length * 8 + 12;
  const rest = segment.count - CHART_TIP_SKILLS;
  // Width by count (flex-grow) within the bar, at least CHART_MIN_SEGMENT: the count, the tooltip and the table stay exact.
  return <button type="button" className={`scomp-chart-seg scomp-chart-${segment.level}${last ? " is-last" : ""}`}
    style={{ flexGrow: segment.count }}
    aria-label={`${bar.name}: ${segment.count} kỹ năng ${segment.label}, ${formatPercent(segment.share)} số kỹ năng của nhóm. Bấm để xem các kỹ năng này.`} onClick={onSelect}
    onPointerEnter={(event) => placeTip(event.currentTarget)} onFocus={(event) => placeTip(event.currentTarget)}>
    <span className="scomp-chart-fill" aria-hidden="true">{fits && <span className="scomp-chart-value">{segment.count.toLocaleString("vi-VN")}</span>}</span>
    <span className={`scomp-tip scomp-chart-tip scomp-chart-tip-${tipSide(segment)}`} aria-hidden="true">
      <span className="scomp-tip-head"><i className={`scomp-chart-key scomp-chart-${segment.level}`} /><strong>{segment.count.toLocaleString("vi-VN")} kỹ năng</strong><span>{segment.label}</span></span>
      <span>{bar.name} · {formatPercent(segment.share)} số kỹ năng của nhóm</span>
      <span>{segmentNote(segment)}</span>
      <span className="scomp-tip-list">{segment.skills.slice(0, CHART_TIP_SKILLS).map((skill) => <span key={skill.key}><span>{skill.name}</span>{skill.score !== null && <b>{formatScore(skill.score)}</b>}</span>)}
        {rest > 0 && <span className="scomp-tip-more">và {rest.toLocaleString("vi-VN")} kỹ năng khác</span>}</span>
      <span className="scomp-tip-hint">Bấm để xem danh sách</span>
    </span>
  </button>;
}

/** "Bảng phân tích mức độ thành thạo" as one stacked bar per group on a shared count axis (user, 2026-10-17). */
function LevelChart({ result, onSelect }: { result: AssessmentResult; onSelect: (group: string, level: ChartLevel) => void }) {
  const { axis, bars } = useMemo(() => levelChart(result), [result]);
  // "Chưa có điểm" and exempt are rare: in the legend only when a bar has them.
  const levels = CHART_LEVELS.filter((level) => (level !== "exempt" && level !== "no_score" && level !== "not_studied") || bars.some((bar) => bar.segments.some((segment) => segment.level === level)));
  const scaleRef = useRef<HTMLDivElement>(null);
  const [scaleWidth, setScaleWidth] = useState(0);
  useLayoutEffect(() => {
    const element = scaleRef.current;
    if (!element) return;
    setScaleWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setScaleWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const grid = <span className="scomp-chart-grid" aria-hidden="true">{axis.ticks.map((tick) => <i key={tick} style={{ left: `${(tick / axis.max) * 100}%` }} />)}</span>;
  return <figure className="scomp-chart" aria-labelledby="scomp-chart-caption">
    <figcaption id="scomp-chart-caption" className="scomp-meta">Số kỹ năng ở từng mức trong mỗi nhóm. Di chuột vào một đoạn để xem chi tiết, bấm để xem đúng các kỹ năng đó.</figcaption>
    <ul className="scomp-chart-legend" aria-label="Chú thích màu">{levels.map((level) => <li key={level}><i className={`scomp-chart-key scomp-chart-${level}`} aria-hidden="true" />{chartLevelLabel(level)}</li>)}</ul>
    <div className="scomp-chart-rows">
      {bars.map((bar) => <div key={bar.key} className="scomp-chart-row">
        <div className="scomp-chart-label"><strong>{bar.name}</strong><span><LevelBadge level={bar.level} label={bar.levelLabel} />{bar.score !== null && <span>Điểm nhóm {formatScore(bar.score)}</span>}</span></div>
        <div className="scomp-chart-scale">
          {grid}
          <div className="scomp-chart-bar" style={{ width: `${(bar.total / axis.max) * 100}%`, minWidth: `${bar.segments.length * CHART_MIN_SEGMENT}px` }}>
            {bar.segments.map((segment, index) => <ChartSegment key={segment.level} bar={bar} segment={segment} last={index === bar.segments.length - 1} scaleWidth={scaleWidth} onSelect={() => onSelect(bar.key, segment.level)} />)}
            <span className="scomp-chart-total">{bar.total.toLocaleString("vi-VN")} kỹ năng</span>
          </div>
        </div>
      </div>)}
      <div className="scomp-chart-row scomp-chart-axis" aria-hidden="true">
        <span />
        <div className="scomp-chart-scale" ref={scaleRef}>{axis.ticks.map((tick) => <span key={tick} style={{ left: `${(tick / axis.max) * 100}%` }}>{tick.toLocaleString("vi-VN")}</span>)}</div>
      </div>
      <div className="scomp-chart-row scomp-chart-unit" aria-hidden="true"><span /><p>Số kỹ năng</p></div>
    </div>
  </figure>;
}

function SkillsSection({ result }: { result: AssessmentResult }) {
  const [filters, setFilters] = useState<SkillFilters>(EMPTY_SKILL_FILTERS);
  const filtered = useMemo(() => filterSkills(result.skills, filters), [result.skills, filters]);
  const buckets = useMemo(() => bucketSkills(result, filtered, filters.group), [result, filtered, filters.group]);
  const summary = useMemo(() => levelSummary(result), [result]);
  const defaultOpen = (id: string) => result.groups.some((group) => group.key === id);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => expanded[id] ?? defaultOpen(id);
  const allOpen = buckets.length > 0 && buckets.every((bucket) => isOpen(bucket.id));
  const courses = useMemo(() => new Map(result.courses.map((course) => [course.code, course])), [result.courses]);
  const groups = useMemo(() => new Map(result.groups.map((group) => [group.key, group])), [result.groups]);
  const terms: Terms = { study: studyTermOf(result), next: nextTermOf(result) };
  const set = (patch: Partial<SkillFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const filtering = (Object.keys(EMPTY_SKILL_FILTERS) as (keyof SkillFilters)[]).some((key) => filters[key] !== EMPTY_SKILL_FILTERS[key]);
  // A segment of the chart (or a count in its table view) filters the list below to exactly those skills.
  const show = (group: string, level: string) => {
    setFilters({ ...EMPTY_SKILL_FILTERS, group, level });
    setExpanded((current) => ({ ...current, [level === "upcoming" || level === "not_studied" || level === "no_score" ? level : group]: true }));
    scrollToSection("scomp-skill-list");
  };
  return <Section id="scomp-skills" title="Bảng phân tích mức độ thành thạo theo nhóm năng lực" description={`${result.skills.length.toLocaleString("vi-VN")} kỹ năng, chia theo nhóm. Mỗi kỹ năng được chấm theo thang 0–100 từ điểm các học phần minh chứng, theo trọng số học phần do Khoa cấu hình, rồi xếp vào một mức thành thạo.`}>
    <div className="scomp-value">
      <h3>Kết quả này cho biết gì?</h3>
      <ul>
        <li><strong>Xuất sắc, Giỏi, Khá:</strong> kỹ năng bạn đã nắm chắc qua các học phần đã học; có thể ghi vào hồ sơ xin việc và dùng ngay trong dự án.</li>
        <li><strong>Trung bình, Yếu:</strong> kỹ năng nên ôn lại hoặc học cải thiện; học phần cụ thể cho từng kỹ năng có ở trang <a className="sw-text-link" href="#skill-gap">Khoảng trống kỹ năng</a>.</li>
        <li><strong>Sắp học:</strong> bạn đang học hoặc chưa học tới học phần đo kỹ năng đó — không phải điểm yếu.</li>
        <li><strong>Chưa học:</strong> học phần đo kỹ năng đó đã qua học kỳ trong kế hoạch mà bạn chưa học, hoặc không có trong kế hoạch; hãy đăng ký ở học kỳ tới.</li>
        <li><strong>Chưa có điểm:</strong> bạn đã học học phần liên quan nhưng bảng điểm chưa có điểm số, nên chưa đánh giá được.</li>
        <li><strong>Độ tin cậy:</strong> cho biết kết quả dựa trên bao nhiêu minh chứng; độ tin cậy thấp nghĩa là mới có ít học phần đo kỹ năng này.</li>
      </ul>
    </div>
    <LevelChart result={result} onSelect={show} />
    <details className="scomp-legend scomp-chart-table"><summary>Xem dạng bảng</summary><div className="scomp-table-scroll" tabIndex={0} role="region" aria-labelledby="scomp-level-caption">
      <table className="scomp-table scomp-level-table">
        <caption id="scomp-level-caption">Số kỹ năng ở từng mức thành thạo trong mỗi nhóm. Bấm vào một con số để xem đúng các kỹ năng đó.</caption>
        <thead><tr><th scope="col">Nhóm năng lực</th><th scope="col" className="scomp-num">Điểm nhóm</th><th scope="col">Mức của nhóm</th>{LEVEL_COLUMNS.map((level) => <th key={level} scope="col" className="scomp-num">{LEVEL_COLUMN_LABELS[level]}</th>)}</tr></thead>
        <tbody>{summary.map((row) => <tr key={row.key}>
          <th scope="row">{row.name}<small>{row.total.toLocaleString("vi-VN")} kỹ năng</small></th>
          <td className="scomp-num"><strong>{formatScore(row.score)}</strong></td>
          <td><LevelBadge level={row.level} label={row.levelLabel} /></td>
          {LEVEL_COLUMNS.map((level) => <td key={level} className="scomp-num">{row.counts[level] > 0
            ? <button type="button" className="scomp-count-button" aria-label={`${row.counts[level]} kỹ năng ${LEVEL_COLUMN_LABELS[level]} trong nhóm ${row.name}`} onClick={() => show(row.key, level)}>{row.counts[level].toLocaleString("vi-VN")}</button>
            : <span className="scomp-zero">0</span>}</td>)}
        </tr>)}</tbody>
      </table>
    </div></details>
    <div className="scomp-filters" id="scomp-skill-list" tabIndex={-1}>
      <label>Nhóm<select value={filters.group} onChange={(event) => set({ group: event.target.value })}><option value="">Tất cả nhóm</option>{result.groups.map((group) => <option key={group.key} value={group.key}>{group.name}</option>)}</select></label>
      <label>Mức<select value={filters.level} onChange={(event) => set({ level: event.target.value })}><option value="">Tất cả mức</option>{[...LEVEL_SCALE, ...UNSCORED_STATES].map((level) => <option key={level.code} value={level.code}>{level.label}</option>)}</select></label>
      <label>Độ tin cậy<select value={filters.confidence} onChange={(event) => set({ confidence: event.target.value })}><option value="">Tất cả</option><option value="high">Cao</option><option value="medium">Trung bình</option><option value="low">Thấp</option></select></label>
      <label className="scomp-search">Tìm kỹ năng<input type="search" value={filters.search} onChange={(event) => set({ search: event.target.value })} placeholder="Tên kỹ năng hoặc mã học phần…" /></label>
      <label className="scomp-toggle"><input type="checkbox" checked={filters.careerOnly} onChange={(event) => set({ careerOnly: event.target.checked })} />Chỉ kỹ năng của vị trí nghề nghiệp</label>
      <label className="scomp-toggle"><input type="checkbox" checked={filters.needsWork} onChange={(event) => set({ needsWork: event.target.checked })} />Chỉ kỹ năng cần củng cố</label>
      <button type="button" className="sr-secondary" onClick={() => setExpanded(Object.fromEntries(buckets.map((bucket) => [bucket.id, !allOpen])))}>{allOpen ? "Thu gọn tất cả" : "Mở rộng tất cả"}</button>
    </div>
    <p className="scomp-meta">Mỗi thanh là điểm của một kỹ năng trên thang 0–100; vạch 50 · 62,5 · 80 · 90 là ngưỡng Trung bình, Khá, Giỏi và Xuất sắc. Di chuột vào một dòng để xem chi tiết, bấm để xem học phần minh chứng.</p>
    <p className="scomp-meta" aria-live="polite">{filtered.length.toLocaleString("vi-VN")} kỹ năng phù hợp bộ lọc{filtering && <> · <button type="button" className="scomp-link-button" onClick={() => setFilters(EMPTY_SKILL_FILTERS)}>Xem tất cả kỹ năng</button></>}</p>
    {buckets.map((bucket) => { const group = groups.get(bucket.id); return <details key={bucket.id} className="scomp-bucket" open={isOpen(bucket.id)} onToggle={(event) => { const open = event.currentTarget.open; if (open !== isOpen(bucket.id)) setExpanded((current) => ({ ...current, [bucket.id]: open })); }}>
      <summary><strong>{bucket.title} ({bucket.skills.length.toLocaleString("vi-VN")})</strong>{group && group.score !== null && <span>Điểm nhóm {formatScore(group.score)} · {group.levelLabel}</span>}{bucket.note && <span>{bucket.note}</span>}</summary>
      {bucket.skills.some((skill) => skill.score !== null) && <div className="scomp-skill-axis" aria-hidden="true"><span /><span>Kỹ năng</span>
        <span className="scomp-skill-track">{SKILL_TICKS.map((tick) => <span key={tick} style={{ left: `${tick}%` }}>{formatNumber(tick)}</span>)}</span></div>}
      <ul className="scomp-skill-list">{bucket.skills.map((skill) => <SkillRow key={skill.key} skill={skill} courses={courses} groups={groups} terms={terms} />)}</ul>
    </details>; })}
    {!buckets.length && <p className="sw-empty">Không có kỹ năng nào phù hợp bộ lọc.</p>}
  </Section>;
}

/** The term being studied and the one after it (studyTermOf, nextTermOf): "Sắp học" and overdue courses count from them. */
type Terms = { study: string | null; next: string | null };
type CourseFact = AssessmentResult["courses"][number];
type EvidenceRow = SkillResult["evidenceCourses"][number];
const ROLE_NOTES: Partial<Record<EvidenceRow["role"], string>> = { not_chosen: "Học phần tự chọn bạn không chọn", in_progress: "Đang học", exempt: "Miễn/công nhận", studied: "Đã học" };
/** An evidence course without a score: a planned one is "Sắp học · <term>" when its term is ahead, else "Chưa học" (like the skill). */
const roleNote = (row: EvidenceRow, course: CourseFact | undefined, terms: Terms) =>
  row.role === "planned" ? plannedCourseNote(course?.plannedTerm ?? null, terms.study) : ROLE_NOTES[row.role];
/** The "Học kỳ" of an evidence course: its attempt, else its planned term, said as passed when it is (2026-10-25 audit: "Dự kiến HK213"). */
function evidenceTerm(row: EvidenceRow, course: CourseFact | undefined, terms: Terms): string {
  if (course?.term) return termName(course.term);
  if (row.role === "not_chosen" || !course?.plannedTerm) return "—";
  return isOverdue({ term: course.plannedTerm, state: course.state }, terms.study) ? overdueText(course.plannedTerm, terms.next) : `Dự kiến ${termName(course.plannedTerm)}`;
}
const TIP_COURSES = 3;
const courseScore = (course: CourseFact | undefined) => course?.score10 === null || course?.score10 === undefined
  ? (course?.letter ?? "—") : `${formatNumber(course.score10)}${course.letter ? ` · ${course.letter}` : ""}`;
/** Said in place of a bar when the skill has no score. */
function noScoreText(skill: SkillResult): string {
  // A course without credits (K27/K28 GDTC/GDQP before comp-calc-v17) is a condition, not outside the student's choices.
  if (noCreditSkill(skill)) return "Học phần không tính tín chỉ";
  if (skill.status === "not_applicable") return "Ngoài lựa chọn học phần của bạn";
  if (skill.level === "exempt") return "Miễn/công nhận, không có điểm";
  const level = displayLevel(skill);
  if (level === "no_score") return "Chưa có điểm";
  if (level === "not_studied") return "Chưa học";
  return upcomingText(skill.upcomingTerm);
}

function SkillRow({ skill, courses, groups, terms }: { skill: SkillResult; courses: Map<string, CourseFact>; groups: Map<string, AssessmentResult["groups"][number]>; terms: Terms }) {
  // A skill in several groups is listed under each one; its details name them all (2026-10-22).
  const groupNames = skillGroupKeys(skill).map((key) => groups.get(key)?.name).filter((name): name is string => Boolean(name));
  const score = skill.score === null ? null : Math.max(0, Math.min(100, skill.score));
  // Coverage counts only the student's own path (electives chosen, own specialty); say so when other courses are listed (v14).
  const ownPathOnly = skill.evidenceCourses.some((row) => row.role === "not_chosen") || skill.otherSpecialtyCourses.length > 0;
  const facts = `${skill.confidence ? CONFIDENCE_LABELS[skill.confidence] : "Chưa xác định độ tin cậy"} · độ phủ ${formatPercent(skill.coverage)}${ownPathOnly ? " (chỉ tính học phần trong lựa chọn của bạn)" : ""}`;
  const moreCourses = skill.evidenceCourses.length - TIP_COURSES;
  // The courses the score comes from, beside it: many skills share one course and so one score (user 2026-10-30: "68" everywhere).
  const sources = skill.score !== null ? scoreSourcesText(scoreSources(skill, courses)) : "";
  return <li><details className="scomp-skill">
    <summary onPointerEnter={(event) => placeTip(event.currentTarget)} onFocus={(event) => placeTip(event.currentTarget)}>
      <span className="scomp-skill-name">{skill.name}{skill.careerSkill && <span className="scomp-career-tag">Vị trí nghề nghiệp mục tiêu</span>}{sources && <small className="scomp-skill-from" title={sources}>{sources}</small>}</span>
      <span className="scomp-skill-track">
        <span className="scomp-skill-grid" aria-hidden="true">{SKILL_TICKS.map((tick) => <i key={tick} style={{ left: `${tick}%` }} />)}</span>
        {score !== null ? <>
          <span className={`scomp-skill-bar scomp-chart-${skill.level}`} style={{ width: `${score}%` }} aria-hidden="true" />
          <span className="scomp-skill-score" style={{ left: `calc(${score}% + 6px)` }}>{formatScore(skill.score)}</span>
        </> : <span className="scomp-skill-none">{noScoreText(skill)}</span>}
        <span className="sr-only">{skill.score !== null ? `${skill.levelLabel} · ` : ""}{facts}</span>
        <span className="scomp-tip scomp-skill-tip" aria-hidden="true">
          <span className="scomp-tip-head"><i className={`scomp-chart-key scomp-chart-${displayLevel(skill) ?? skill.level}`} /><strong>{skill.score !== null ? `${formatScore(skill.score)} điểm` : noScoreText(skill)}</strong>{skill.score !== null && <span>{skill.levelLabel}</span>}</span>
          <span>{skill.name}{skill.careerSkill ? " · kỹ năng của vị trí nghề nghiệp mục tiêu" : ""}</span>
          <span>{facts}</span>
          {skill.evidenceCourses.length > 0 && <span className="scomp-tip-list">{skill.evidenceCourses.slice(0, TIP_COURSES).map((row) => { const course = courses.get(row.code); const note = row.role !== "score" ? roleNote(row, course, terms) : undefined; return <span key={row.code}>
            <span>{course?.name ?? row.code} ({row.code})</span><b>{note ?? courseScore(course)}</b></span>; })}
            {moreCourses > 0 && <span className="scomp-tip-more">và {moreCourses.toLocaleString("vi-VN")} học phần khác</span>}</span>}
          <span className="scomp-tip-hint">Bấm để xem học phần minh chứng</span>
        </span>
      </span>
    </summary>
    <div className="scomp-skill-body">
      <p className="scomp-meta">{skill.score !== null ? `${formatScore(skill.score)} điểm · ${skill.levelLabel}` : noScoreText(skill)} · {facts}</p>
      {groupNames.length > 1 && <p className="scomp-meta">Thuộc các nhóm năng lực: {groupNames.join(", ")}. Điểm kỹ năng được tính vào từng nhóm.</p>}
      {skill.scope && <p className="scomp-prose"><strong>Phạm vi: </strong>{skill.scope}</p>}
      {skill.status === "not_applicable" && <p className="scomp-meta">{skill.notApplicableReason === "other_specialty" ? "Kỹ năng này chỉ có trong học phần của chuyên ngành khác." : skill.notApplicableReason === "elective_not_chosen" ? "Kỹ năng này nằm trong nhóm tự chọn bạn đã chọn đủ bằng học phần khác." : "Học phần đo kỹ năng này không có tín chỉ."}</p>}
      {/* No table of headers only when no course of the student's own path measures the skill (2026-10-25 audit). */}
      {skill.evidenceCourses.length > 0 && <div className="scomp-table-scroll" tabIndex={0} role="region" aria-label={`Học phần minh chứng của ${skill.name}`}>
        <table className="scomp-table scomp-evidence">
          <caption>Học phần minh chứng của {skill.name}</caption>
          <thead><tr><th scope="col">Mã</th><th scope="col">Tên học phần</th><th scope="col">TC</th><th scope="col">Điểm</th><th scope="col">Kết quả</th><th scope="col">Số lần học</th><th scope="col">Trọng số</th><th scope="col">Học kỳ</th><th scope="col">Tỷ trọng</th></tr></thead>
          <tbody>{skill.evidenceCourses.map((row) => {
            const course = courses.get(row.code);
            const note = row.role !== "score" ? roleNote(row, course, terms) : undefined;
            return <tr key={row.code}>
              <td>{row.code}</td>
              <td>{course?.name ?? "—"}{note && <small>{note}</small>}</td>
              <td className="scomp-num">{formatNumber(course?.credits)}</td>
              <td className="scomp-num">{course?.score10 === null || course?.score10 === undefined ? (course?.letter ?? "—") : `${formatNumber(course.score10)}${course.letter ? ` · ${course.letter}` : ""}`}</td>
              <td>{course ? (course.state === "not_taken" ? "Chưa đăng ký" : COURSE_STATE_LABELS[course.state]) : "—"}{course?.inferred && <small>suy ra từ điểm chữ</small>}</td>
              <td className="scomp-num">{course ? course.attempts.toLocaleString("vi-VN") : "—"}</td>
              <td className="scomp-num">{formatNumber(row.weight)}</td>
              <td>{evidenceTerm(row, course, terms)}</td>
              <td className="scomp-num">{formatPercent(row.share)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      {skill.otherSpecialtyCourses.length > 0 && <p className="scomp-meta">Học phần chuyên ngành khác cũng đo kỹ năng này: {skill.otherSpecialtyCourses
        .map((code) => (courses.get(code)?.name ? `${courses.get(code)!.name} (${code})` : code)).join(", ")}</p>}
    </div>
  </details></li>;
}

/**
 * A plan choice as the student reads it: "Chọn 1 trong 3 môn sau" over the options listed (choiceLabel, comp-calc-v17; results
 * stored before kept the plan's "Chọn1 trong 3" or "trong 4" over 3 options). A credit choice's label is the engine's own.
 */
const planChoiceLabel = (entry: { label: string; unit: "course" | "credit"; required: number; options: readonly unknown[] }) =>
  entry.unit === "course" ? choiceLabel(entry.label, entry.required, entry.options.length) : entry.label;

function ProgressSection({ result }: { result: AssessmentResult }) {
  const progress = result.progress;
  const late = (progress?.lateCount ?? 0) > 0;
  // Late is amber, not red: red is kept for a course not passed (user 2026-10-30: "Màu đỏ nên để dành cho Chưa đạt").
  return <Section id="scomp-progress" title="Tiến độ so với kế hoạch đào tạo">
    {!progress ? <p className="scomp-meta">Chưa xác định được kế hoạch đào tạo áp dụng cho bạn nên chưa so sánh được tiến độ.</p> : <>
      <p className={`scomp-plan-status ${late ? "scomp-plan-late" : "scomp-plan-ok"}`}>
        <span aria-hidden="true">{late ? "!" : "✓"}</span>
        <span>{late ? `Chậm so với kế hoạch: ${progress.lateCount.toLocaleString("vi-VN")} học phần · ${formatNumber(progress.lateCredits)} TC chưa hoàn thành đúng học kỳ dự kiến.` : "Đúng kế hoạch: bạn đã hoàn thành mọi học phần theo kế hoạch đào tạo đến học kỳ hiện tại."}</span>
      </p>
      {!countsFromStudyTerm(result.meta.calcVersion) && result.transcript.inProgress > 0 && <p className="scomp-meta">Kết quả này được tính khi hệ thống còn lấy học kỳ có điểm gần nhất làm học kỳ hiện tại, nên học kỳ bạn đang học bị ghi là học kỳ tới. Bấm “Đánh giá lại” để cập nhật.</p>}
      <dl className="sg-stats scomp-stats">
        <div><dt>Học kỳ hiện tại (suy từ bảng điểm)</dt><dd>{progress.currentTerm ? termName(progress.currentTerm) : "—"}</dd></div>
        <div><dt>Chậm so với kế hoạch</dt><dd className={late ? "sg-status-unknown" : "sg-status-pass"}>{progress.lateCount.toLocaleString("vi-VN")} <small>học phần · {formatNumber(progress.lateCredits)} TC</small></dd></div>
        {/* "Học kỳ tới" here is the Kế hoạch đào tạo's; Tổng quan's comes from Lộ trình AI (user 2026-10-30: name them apart). */}
        <div><dt>Học kỳ tới theo Kế hoạch đào tạo{progress.nextTerm ? ` (${termName(progress.nextTerm)})` : ""}</dt><dd>{nextCourseCount(progress, result.meta.calcVersion).toLocaleString("vi-VN")} <small>học phần · {formatNumber(progress.nextCredits)} TC</small></dd></div>
      </dl>
      <div className="scomp-two-columns">
        <div><h3 className={`scomp-subtitle ${late ? "sg-status-unknown" : "sg-status-pass"}`}>{late ? "Chậm so với kế hoạch" : "Đúng kế hoạch"}</h3>{progress.late.length ? <ul className="scomp-plan-list scomp-plan-list-late">{progress.late.map((entry, index) => <li key={index}>
          {entry.kind === "course" ? <><strong>{entry.name}</strong> <span className="scomp-code">{entry.code}</span><small>{formatNumber(entry.credits)} TC · kế hoạch {termName(entry.termCode)} · {COURSE_STATE_LABELS[entry.state]}</small></>
            : entry.kind === "choice" ? <><strong>{planChoiceLabel(entry)}</strong><small>Còn thiếu {entry.missing.toLocaleString("vi-VN")} {entry.unit === "course" ? "học phần" : "TC"} · kế hoạch {termName(entry.termCode)}</small><small>Lựa chọn: {entry.options.map((option) => option.name).join(", ")}</small></>
              : <><strong>{entry.label}</strong><small>Đã đạt {entry.passed}/{entry.required} · kế hoạch {termName(entry.termCode)}</small></>}
        </li>)}</ul> : <p className="scomp-meta sg-status-pass">Bạn đang theo đúng kế hoạch đào tạo.</p>}</div>
        <div><h3 className="scomp-subtitle">Học kỳ tới theo Kế hoạch đào tạo</h3>{progress.next.length ? <ul className="scomp-plan-list">{progress.next.map((entry, index) => <li key={index}>
          {entry.kind === "course" ? <><strong>{entry.name}</strong> <span className="scomp-code">{entry.code}</span><small>{formatNumber(entry.credits)} TC</small></>
            : entry.kind === "choice" ? <><strong>{planChoiceLabel(entry)}</strong><small>Chọn {entry.remaining.toLocaleString("vi-VN")} {entry.unit === "course" ? "học phần" : "TC"} trong: {entry.options.map((option) => option.name).join(", ")}</small></>
              : <><strong>{entry.label}</strong><small>Đã đạt {entry.passed}/{entry.required}</small></>}
        </li>)}</ul> : <p className="scomp-meta">Kế hoạch đào tạo chưa có học phần nào cho học kỳ tới.</p>}</div>
      </div>
      {progress.informationalSections.length > 0 && <details className="scomp-legend"><summary>Mục chỉ để tham khảo, không tính là chậm ({progress.informationalSections.length})</summary><ul>{progress.informationalSections.map((section, index) => <li key={index}><strong>{choiceLabel(section.label)}</strong> · {termName(section.termCode)}<span>{section.options.map((option) => option.name).join(", ")}</span></li>)}</ul></details>}
    </>}
  </Section>;
}

/** Only the verdict and the way to the graduation page; the criteria and what to do live there (user, 2026-10-17). */
function GraduationVerdict({ evaluation }: { evaluation: GraduationEvaluation }) {
  const verdict = verdictHeadline(evaluation);
  return <div className={`scomp-grad-verdict scomp-grad-${verdict.tone}`}>
    <p><span className="scomp-grad-glyph" aria-hidden="true">{verdict.glyph}</span><span>{verdict.text}</span></p>
    <a className="sw-outline scomp-grad-detail" href="#graduation">Xem chi tiết <Icon name="arrow" /></a>
  </div>;
}

/**
 * The graduation check of the graduation page (GET /api/student/graduation, computed on the server
 * when the page opens), never the copy stored with the assessment: both screens show the same
 * criteria, numbers, order and reasons.
 */
function GraduationSection() {
  const [revision, setRevision] = useState(0);
  const live = useLiveData(GRADUATION_API, revision, readGraduation);
  const data = live.data;
  const unresolved = data && !data.standard ? unresolvedCopy(data) : null;
  return <Section id="scomp-graduation" title="Xét tốt nghiệp (tham khảo)">
    {!data ? live.loading ? <p className="scomp-meta">Đang tải kết quả xét tốt nghiệp…</p>
      : <div className="sr-error" role="alert">{live.error ?? "Chưa tải được kết quả xét tốt nghiệp."}<button type="button" onClick={() => setRevision((value) => value + 1)}>Thử lại</button></div>
      : unresolved ? <div className="scomp-grad-unresolved"><strong>{unresolved.title}</strong><p className="scomp-meta">{unresolved.text}</p>{unresolved.action && <a className="sw-outline" href={unresolved.action.href}>{unresolved.action.label}</a>}</div>
        : !data.evaluation ? <p className="scomp-meta">Chưa có bảng điểm để đối chiếu. <a className="sw-text-link" href="#profile">Import bảng điểm</a></p>
          : <GraduationVerdict evaluation={data.evaluation} />}
  </Section>;
}

/* ------------------------------------------------- "Khoảng trống kỹ năng" page */

/**
 * "Thang mức phù hợp": the five fit levels like "Thang mức năng lực" (same bounds and badges, 2026-10-22)
 * with the student's own marked, and how the điểm phù hợp is counted.
 */
function FitScale({ career }: { career: NonNullable<AssessmentResult["career"]> }) {
  const level = fitLevelOf(career);
  const own = level === "insufficient_data"
    ? "Vị trí nghề nghiệp này chưa có kỹ năng nào tính được điểm nên chưa xếp mức (Chưa đủ dữ liệu)." : null;
  return <details className="scomp-legend scomp-fit-legend"><summary>Thang mức phù hợp</summary>
    <ul>{FIT_SCALE.map((item) => <li key={item.code}>
      <span className="scomp-fit-scale-name"><FitBadge level={item.code} />{item.code === level && <span className="scomp-career-tag">Mức của bạn</span>}</span>
      <span className="scomp-legend-range">{item.range}</span>
      <span>{item.text}</span>
    </li>)}</ul>
    <p className="scomp-meta">Cùng ngưỡng với Thang mức năng lực ở trang Đánh giá năng lực.</p>
    {own && <p className="scomp-meta">{own}</p>}
    <p className="scomp-meta">Cách tính điểm phù hợp: trung bình điểm các kỹ năng của vị trí nghề nghiệp, kỹ năng Bắt buộc tính gấp đôi kỹ năng Ưu tiên; kỹ năng chưa có điểm (chưa học, sắp học, cần tự học, chưa đủ dữ liệu) tính 0 điểm. Kỹ năng chỉ có học phần miễn/công nhận chưa được tính.</p>
  </details>;
}

const NO_REQUIREMENTS_TEXT = "Vị trí nghề nghiệp này chưa có yêu cầu kỹ năng trong danh mục nên chưa so sánh được.";
/** No skill left to act on (isGap): every skill met, or the scored ones met and those still to come counted 0 (noGapText). */
const allMetText = (career: NonNullable<AssessmentResult["career"]>) => { const text = noGapText(career); return text.zero ? `${text.met} ${text.zero}` : text.met; };

/** "✓ …" only for what is reached; the skills that count 0 in the fit (Sắp học) are said apart, without the tick. */
function NoGapLines({ career }: { career: NonNullable<AssessmentResult["career"]> }) {
  const text = noGapText(career);
  return <><p className="scomp-prose sg-status-pass">✓ {text.met}</p>{text.zero && <p className="scomp-prose">{text.zero}</p>}</>;
}

function GapSummary({ result }: { result: AssessmentResult }) {
  const career = result.career;
  if (!career) return <Section id="sgap-summary" title="Mức phù hợp với vị trí nghề nghiệp mục tiêu">
    <div className="sw-empty scomp-empty"><h3>Bạn chưa chọn vị trí nghề nghiệp mục tiêu</h3><p>Khoảng trống kỹ năng được tính so với yêu cầu của vị trí nghề nghiệp mục tiêu. Kết quả này được tính khi hồ sơ chưa có vị trí nghề nghiệp mục tiêu; hãy chọn vị trí nghề nghiệp rồi bấm “Đánh giá lại” để biết kỹ năng nào đã đạt, kỹ năng nào còn thiếu và học phần nên học.</p><a className="sw-outline" href="#career">Chọn vị trí nghề nghiệp mục tiêu</a></div>
  </Section>;
  // "Kỹ năng còn thiếu" (isGap): below, not studied, "Cần tự học" and "Chưa đủ dữ liệu"; "Sắp học" comes with the plan.
  const missing = sortRequirements(career.requirements).filter(isGap);
  const level = fitLevelOf(career);
  return <Section id="sgap-summary" title="Mức phù hợp với vị trí nghề nghiệp mục tiêu" description={<>So với yêu cầu của vị trí nghề nghiệp <strong>{career.nameVi}</strong> ({career.nameEn}).{career.deleted && " Vị trí này không còn trong danh mục; bạn nên chọn vị trí nghề nghiệp khác."}</>}>
    <div className="scomp-fit-summary">
      <div className="scomp-fit-score"><span className="scomp-kicker">Mức phù hợp</span>
        {level !== "insufficient_data" && <p className="scomp-big"><strong>{formatScore(fitScoreOf(career.requirements))}</strong><span>/100</span></p>}
        <p className="scomp-score-tags"><FitBadge level={level} /></p>
      </div>
      <ul className="scomp-fit-facts">
        <li>{careerSummaryText(career)}</li>
        <li>{careerDataText(career)}</li>
      </ul>
    </div>
    <div className="sgap-missing">
      <h3>Kỹ năng còn thiếu{missing.length > 0 && <span className="scomp-count">{missing.length.toLocaleString("vi-VN")}</span>}</h3>
      {missing.length ? <ul>{missing.map((req) => <li key={req.requirementId}>
        <strong>{req.skillName ?? req.title}</strong>
        <span className={req.isRequired ? "scomp-required" : "scomp-code"}>{req.priorityLabel}</span>
        <StatusText {...gapStatusDisplay(req)} />
        {req.deficitBandLabel && req.status === "below" && <span className="scomp-code">{req.deficitBandLabel}</span>}
      </li>)}</ul>
        : career.requirements.length ? <NoGapLines career={career} /> : <p className="scomp-meta">{NO_REQUIREMENTS_TEXT}</p>}
    </div>
    <p className="scomp-meta">{careerThresholdsLine(career)} Kỹ năng chưa có điểm (chưa học, sắp học, cần tự học, chưa đủ dữ liệu) tính 0 điểm khi tính mức phù hợp{career.requirements.some((req) => req.status === "upcoming") ? "; điểm sẽ tăng khi bạn học các học phần sắp học." : "."}</p>
    <FitScale career={career} />
  </Section>;
}

function GapTable({ result }: { result: AssessmentResult }) {
  const [gapsOnly, setGapsOnly] = useState(false);
  const career = result.career;
  if (!career) return null;
  const rows = sortRequirements(career.requirements).filter((req) => !gapsOnly || isGap(req));
  // The courses of another specialty that teach a "Cần tự học" skill, as "Name (CODE)".
  const names = new Map(result.courses.map((course) => [course.code, course.name]));
  const otherCourses = (req: CareerRequirementResult) => (result.skills.find((skill) => skill.key === req.skillKey)?.otherSpecialtyCourses ?? [])
    .map((code) => (names.get(code) ? `${names.get(code)} (${code})` : code));
  const courses = new Map(result.courses.map((course) => [course.code, course]));
  const sources = (req: CareerRequirementResult) => {
    const skill = req.score !== null ? result.skills.find((item) => item.key === req.skillKey) : undefined;
    return skill ? scoreSourcesText(scoreSources(skill, courses)) : "";
  };
  return <Section id="scomp-career" title="Báo cáo chi tiết khoảng trống kỹ năng" description="Từng kỹ năng mà vị trí nghề nghiệp yêu cầu: điểm hiện tại của bạn, ngưỡng cần đạt, mức thiếu hụt và trạng thái.">
    {/* The same words and rule as "Kỹ năng còn thiếu" above (isGap); "Sắp học" stays out of both (2026-10-25 audit). */}
    <label className="scomp-toggle"><input type="checkbox" checked={gapsOnly} onChange={(event) => setGapsOnly(event.target.checked)} />Chỉ kỹ năng còn thiếu</label>
    <div className="scomp-table-scroll" tabIndex={0} role="region" aria-labelledby="scomp-career-caption">
      <table className="scomp-table scomp-gap-table">
        <caption id="scomp-career-caption">Kỹ năng của vị trí nghề nghiệp {career.nameVi}: điểm hiện tại so với ngưỡng</caption>
        <thead><tr><th scope="col">Kỹ năng</th><th scope="col">Tính chất</th><th scope="col">Hiện tại</th><th scope="col">Ngưỡng</th><th scope="col">Chênh lệch</th><th scope="col">Trạng thái</th></tr></thead>
        <tbody>{rows.map((req) => <GapRow key={req.requirementId} req={req} otherCourses={otherCourses(req)} sources={sources(req)} />)}
          {!rows.length && <tr><td colSpan={6}>{career.requirements.length ? allMetText(career) : NO_REQUIREMENTS_TEXT}</td></tr>}
        </tbody>
      </table>
    </div>
  </Section>;
}

const GAP_STATUS_WORDS: Record<CareerRequirementResult["status"], string> = { met: "Đạt ngưỡng", below: "Dưới ngưỡng", upcoming: "Sắp học", not_studied: "Chưa học", no_data: "Chưa đủ dữ liệu" };

/** STU-GAP-07: each career skill at the end of every graded term, against its threshold. */
function GapHistory({ result }: { result: AssessmentResult }) {
  const history = gapHistory(result);
  if (!history) return null;
  const selfStudy = new Set(result.career!.requirements.filter(needsSelfStudy).map((req) => req.requirementId));
  const statusWord = (status: CareerRequirementResult["status"], requirementId: string) =>
    (status === "no_data" && selfStudy.has(requirementId) ? "Cần tự học" : GAP_STATUS_WORDS[status]);
  return <Section id="sgap-history" title="Theo dõi mức độ cải thiện kỹ năng" description={`Điểm từng kỹ năng của vị trí nghề nghiệp ${result.career!.nameVi} vào cuối mỗi học kỳ đã có điểm. Xanh có dấu ✓ là đạt ngưỡng, đỏ là chưa đạt.`}>
    {history.state === "empty" ? <p className="scomp-meta">Bảng điểm chưa có học kỳ nào có điểm nên chưa theo dõi được.</p>
      : history.state === "outdated" ? <p className="scomp-meta">Kết quả này được tính trước khi có phần theo dõi kỹ năng của vị trí nghề nghiệp. Bấm “Đánh giá lại” để xem kỹ năng của bạn thay đổi qua từng học kỳ.</p>
        : <>
          <p className="scomp-prose">{history.sentence}</p>
          <div className="scomp-table-scroll" tabIndex={0} role="region" aria-labelledby="sgap-history-caption">
            <table className="scomp-table scomp-gap-history">
              <caption id="sgap-history-caption">Điểm từng kỹ năng của vị trí nghề nghiệp ở cuối mỗi học kỳ</caption>
              <thead>
                <tr><th scope="col" rowSpan={2}>Kỹ năng</th>
                  {historyYears(history.points).map((year) => <th key={year.schoolYear} scope="colgroup" colSpan={year.rows.length} className="scomp-gap-year">Năm học {year.schoolYear}</th>)}
                  <th scope="col" rowSpan={2} className="scomp-num">Thay đổi</th></tr>
                <tr>{history.points.map((point, index) => <th key={point.term} scope="col" className="scomp-num">HK{point.semester}{index === history.points.length - 1 && <small>Mới nhất</small>}</th>)}</tr>
              </thead>
              <tbody>{history.rows.map((row) => <tr key={row.requirementId}>
                <th scope="row"><span className="scomp-cell-title">{row.name}</span><small>{row.priorityLabel} · ngưỡng {formatScore(row.threshold)}</small></th>
                {row.cells.map((cell) => <td key={cell.term} className="scomp-num">{cell.score === null
                  ? <span className="scomp-zero" title={cell.status ? statusWord(cell.status, row.requirementId) : undefined}>—</span>
                  : <span className={cell.status === "met" ? "sg-status-pass" : "sg-status-fail"} title={cell.status ? statusWord(cell.status, row.requirementId) : undefined}>{formatScore(cell.score)}{cell.status === "met" && " ✓"}</span>}</td>)}
                <td className="scomp-num">{row.change === null ? <span className="scomp-zero">—</span>
                  : <span className={row.change ? "scomp-gap-change" : "scomp-zero"}>{formatDifference(row.change)}</span>}</td>
              </tr>)}</tbody>
              <tfoot><tr><th scope="row">Kỹ năng đạt ngưỡng</th>{history.points.map((point) => <td key={point.term} className="scomp-num">{point.career!.met}/{point.career!.total}</td>)}<td /></tr></tfoot>
            </table>
          </div>
          <p className="scomp-meta">“—”: ở học kỳ đó, kỹ năng chưa có điểm (chưa học, sắp học, cần tự học hoặc chưa đủ dữ liệu); di chuột lên ô để xem trạng thái. “Thay đổi” là điểm hiện tại trừ điểm đầu tiên. Học lại ở học kỳ sau không làm đổi điểm của học kỳ trước.</p>
        </>}
  </Section>;
}

/** sources: the courses the score comes from ("Từ …", scoreSourcesText), "" without a score. */
function GapRow({ req, otherCourses, sources }: { req: CareerRequirementResult; otherCourses: string[]; sources: string }) {
  const status = gapStatusDisplay(req);
  const difference = scoreDifference(req);
  return <tr>
    <th scope="row"><span className="scomp-cell-title">{req.skillName ?? req.title}</span>{req.skillName && req.skillName !== req.title && <small>{req.title}</small>}</th>
    <td data-label="Tính chất"><span className={req.isRequired ? "scomp-required" : undefined}>{req.priorityLabel}</span></td>
    <td data-label="Hiện tại"><span className="scomp-bullet"><ScoreBar score={req.score} level={req.level} threshold={req.threshold} /><strong>{formatScore(req.score)}</strong></span>{req.levelLabel && req.level !== "no_evidence" && <small>{req.levelLabel}</small>}{sources && <small>{sources}</small>}</td>
    <td className="scomp-num" data-label="Ngưỡng">{formatScore(req.threshold)}</td>
    <td className="scomp-num" data-label="Chênh lệch">{difference === null ? "—" : formatDifference(difference)}{req.deficitBandLabel && <small>{req.deficitBandLabel}</small>}</td>
    <td data-label="Trạng thái"><StatusText {...status} />{req.status === "no_data" && <small>{req.noDataReason === "other_specialty"
      ? `Chỉ có trong học phần của chuyên ngành khác${otherCourses.length ? `: ${otherCourses.join(", ")}` : ""}.`
      : req.noDataReason === "elective_not_chosen"
        ? "Chỉ có trong học phần tự chọn bạn không chọn (nhóm tự chọn đã đủ tín chỉ)."
        : "Chương trình đào tạo chưa có học phần đo kỹ năng này — không phải điểm yếu."}</small>}</td>
  </tr>;
}

const STANDING_GLYPH: Record<StatusTone, string> = { pass: "✓", fail: "✗", unknown: "?", neutral: "○" };
function CourseCard({ course, terms }: { course: CourseSuggestion; terms: Terms }) {
  const eligibility = eligibilityDisplay(course.eligibility, course.missing);
  const standing = courseStanding(course);
  // One line names the career skills the course helps (the engine's reason); "Giúp rèn kỹ năng: …" repeated it (2026-10-25 audit).
  return <li className="scomp-course">
    <div className="scomp-course-head"><strong>{course.name}</strong><span className="scomp-code">{course.code}</span></div>
    <dl className="scomp-course-facts">
      <div><dt>Tín chỉ</dt><dd>{formatNumber(course.credits)}</dd></div>
      <div><dt>Học kỳ</dt><dd>{courseTermText(course, terms.study, terms.next)}</dd></div>
      <div className="scomp-course-wide"><dt>Tình trạng của bạn</dt><dd><StatusText tone={standing.tone} glyph={STANDING_GLYPH[standing.tone]} text={standing.text} /></dd></div>
      <div className="scomp-course-wide"><dt>{course.kind === "improve" ? "Đăng ký học cải thiện" : "Điều kiện đăng ký"}</dt><dd><StatusText {...eligibility} /></dd></div>
    </dl>
    <p className="scomp-course-reason">{course.reason}</p>
    {course.reviewNotes.length > 0 && <p className="scomp-meta">Cần xác nhận: {course.reviewNotes.join("; ")}</p>}
  </li>;
}

/** One course of a weak skill: what to do with it, where the student stands, and whether it can be registered. */
function PlanCourseLine({ course, terms }: { course: SupportCourse; terms: Terms }) {
  const standing = courseStanding(course);
  const action = course.kind === "improve" ? "Học cải thiện" : course.state === "failed" ? "Học lại" : course.state === "in_progress" ? "Đang học" : "Học mới";
  const registering = course.kind === "take" && course.state !== "in_progress";
  return <li>
    <div className="scomp-plan-course-head"><span className="scomp-plan-action">{action}</span><strong>{course.name}</strong><span className="scomp-code">{course.code} · {formatNumber(course.credits)} TC</span></div>
    <div className="scomp-plan-course-facts">
      <StatusText tone={standing.tone} glyph={STANDING_GLYPH[standing.tone]} text={standing.text} />
      {registering && <StatusText {...eligibilityDisplay(course.eligibility, course.missing)} />}
      {course.kind === "take" && <span>{courseTermText(course, terms.study, terms.next)}</span>}
    </div>
    {/* The prerequisite text to confirm with the faculty, as on the course cards. */}
    {registering && course.reviewNotes.length > 0 && <p className="scomp-meta">Cần xác nhận: {course.reviewNotes.join("; ")}</p>}
  </li>;
}

function SkillPlans({ plans, career, terms }: { plans: SkillPlan[]; career: string | null; terms: Terms }) {
  const deepen = career !== null;
  return <>
    <h3 className="scomp-subtitle">{deepen ? "Nâng kỹ năng của vị trí nghề nghiệp lên mức Giỏi" : "Kỹ năng cần củng cố (dưới mức Khá)"}</h3>
    <p className="scomp-meta">{deepen
      ? `Kỹ năng của vị trí nghề nghiệp ${career} mà bạn đã đạt ngưỡng nhưng chưa lên mức Giỏi (từ 80), kèm học phần còn có thể học. Khi không còn học phần, hãy rèn thêm bằng một dự án gắn với vị trí này.`
      : "Kỹ năng ở mức Trung bình hoặc Yếu, kèm học phần cụ thể để học cải thiện hoặc học mới. Học phần đã đạt có thể đăng ký học cải thiện theo quy chế của trường."}</p>
    {plans.length ? <ul className="scomp-plan-cards">{plans.map((plan) => {
      const courses = [...plan.improve, ...plan.take];
      return <li key={plan.skillKey}>
        <div className="scomp-course-head"><strong>Kỹ năng: {plan.name}</strong><LevelBadge level={plan.level} label={`${plan.levelLabel} · ${formatScore(plan.score)}`} /></div>
        {courses.length ? <ul className="scomp-plan-courses">{courses.map((course) => <PlanCourseLine key={`${course.kind}:${course.code}`} course={course} terms={terms} />)}</ul>
          : <p className="scomp-meta">{deepen
            ? "Bạn đã học hết học phần đo kỹ năng này trong chương trình; hãy làm một dự án nhỏ gắn với vị trí nghề nghiệp để rèn thêm và có sản phẩm minh chứng."
            : "Không còn học phần nào trong chương trình của bạn để học thêm cho kỹ năng này; hãy tự học và làm một sản phẩm nhỏ để kiểm chứng."}</p>}
      </li>;
    })}</ul> : <p className="scomp-meta">{deepen ? "Mọi kỹ năng của vị trí nghề nghiệp đã đạt mức Giỏi hoặc đã nằm trong phần khoảng trống ở trên." : "Không có kỹ năng nào dưới mức Khá."}</p>}
  </>;
}

function CoursesSection({ result, ai }: { result: AssessmentResult; ai: MappedAiOutput | null }) {
  const take = result.courseSuggestions.filter((course) => course.kind === "take");
  const improve = result.courseSuggestions.filter((course) => course.kind === "improve");
  const aiTips = new Map((ai?.gaps ?? []).map((gap) => [gap.key, gap.selfStudy]));
  const courseNames = new Map(result.courses.map((course) => [course.code, course.name]));
  const plans = plansFor(result);
  const terms: Terms = { study: studyTermOf(result), next: nextTermOf(result) };
  return <Section id="scomp-courses" title="Học phần nên ưu tiên và kỹ năng cần tự học" description={result.career ? `Học phần cụ thể cho các kỹ năng của vị trí nghề nghiệp ${result.career.nameVi}: kỹ năng chưa đạt ngưỡng và kỹ năng có thể nâng lên mức Giỏi. Mỗi học phần ghi rõ bạn đã học chưa, điểm hiện tại và đã đủ điều kiện đăng ký chưa.` : "Chọn vị trí nghề nghiệp mục tiêu để nhận gợi ý học phần theo khoảng trống kỹ năng."}>
    {result.career && <>
      <h3 className="scomp-subtitle">Học phần nên học</h3>
      {take.length ? <ol className="scomp-course-list">{take.map((course) => <CourseCard key={course.code} course={course} terms={terms} />)}</ol> : <p className="scomp-meta">Không còn học phần nào cần học thêm cho các kỹ năng chưa đạt của vị trí nghề nghiệp.</p>}
      <h3 className="scomp-subtitle">Học cải thiện</h3>
      {improve.length ? <><p className="scomp-meta">Học phần bạn đã đạt nhưng điểm thấp hơn ngưỡng của kỹ năng mà vị trí nghề nghiệp yêu cầu. Có thể đăng ký học cải thiện theo quy chế của trường.</p><ol className="scomp-course-list">{improve.map((course) => <CourseCard key={course.code} course={course} terms={terms} />)}</ol></> : <p className="scomp-meta">Không có học phần nào cần học cải thiện.</p>}
    </>}
    {plans.length > 0 && <SkillPlans plans={plans} career={result.career?.nameVi ?? null} terms={terms} />}
    {/* Only skills no course of the student's own program is left for: the AI roadmap's practice suggestions on Tổng quan are
        another list (user 2026-10-30: "Tổng quan liệt kê 4 kỹ năng nên tự học, nhưng … Không có kỹ năng nào cần tự học"). */}
    <h3 className="scomp-subtitle">Kỹ năng cần tự học ngoài chương trình</h3>
    {result.selfStudy.length ? <ul className="scomp-selfstudy">{result.selfStudy.map((item) => {
      // Only similar skills with a score (comp-calc-v17; older results also listed skills still to come).
      const related = relatedSkillNames(result, item);
      const tips = aiTips.get(item.skillKey) ?? [];
      const other = item.otherSpecialtyCourses.map((code) => courseNames.get(code) ? `${courseNames.get(code)} (${code})` : code);
      return <li key={item.skillKey}>
        <div className="scomp-course-head"><strong>Kỹ năng: {item.name}</strong><span className={item.isRequired ? "scomp-required" : "scomp-code"}>{item.isRequired ? "Bắt buộc" : "Ưu tiên"}</span></div>
        <p className="scomp-meta">{item.reasonLabel}</p>
        <p className="scomp-meta">{other.length ? `Học phần đo kỹ năng này thuộc chuyên ngành khác, không nằm trong chương trình của bạn: ${other.join(", ")}.` : "Không có học phần nào trong chương trình đào tạo của bạn để đăng ký cho kỹ năng này."}</p>
        {related.length > 0 && <p className="scomp-meta">Kỹ năng gần giống đã đo (tham khảo, không thay thế): {related.join(", ")}</p>}
        {tips.length > 0 && <div className="scomp-ai-tip"><span className="scomp-ai-tag">AI</span><ul>{tips.map((tip) => <li key={tip}>{tip}</li>)}</ul></div>}
      </li>;
    })}</ul> : <p className="scomp-meta">{result.career
      ? "Chương trình của bạn có học phần cho mọi kỹ năng của vị trí nghề nghiệp này, nên không có kỹ năng nào phải tự học ngoài chương trình."
      : "Chọn vị trí nghề nghiệp mục tiêu để biết kỹ năng nào của vị trí đó phải tự học ngoài chương trình."}</p>}
  </Section>;
}

/* --------------------------------------------------------------------- AI */

/**
 * previous: an older comment shown dimmed under the state box while this assessment's comment is not ready, read with its
 * own assessment's names (previousComment); the panel's footer stays the one of the current state.
 */
function AiPanel({ assessment, aiEnabled, workerOnline, busy, onRegenerate, onCancel, view, previous }: { assessment: StoredAssessment; aiEnabled: boolean; workerOnline: boolean; busy: boolean; onRegenerate: () => void; onCancel: () => void; view: CompetencyView; previous: PreviousAiComment | null }) {
  const { ai, result } = assessment;
  const mapped = ai.status === "completed" ? mapAiOutput(ai.output, result) : null;
  const pending = shouldPoll(ai.status);
  const copy = aiStateCopy(ai.status, workerOnline, aiEnabled);
  // The newest comment failed while an older one stays below, dimmed: say so, when and what to do (QA 2026-11-10).
  const failedOverPrevious = ai.status === "failed" && previous !== null && previousContent(previous, view) !== null;
  return <section id="scomp-ai" tabIndex={-1} className="sw-panel scomp-section scomp-ai" aria-labelledby="scomp-ai-title">
    <div className="scomp-section-heading"><div className="scomp-ai-heading"><span className="scomp-ai-icon"><Icon name="spark" /></span><h2 id="scomp-ai-title">{view === "gap" ? "Nhận xét từ EduPath AI về khoảng trống kỹ năng" : "Nhận xét từ EduPath AI"}</h2><span className="scomp-ai-tag">AI</span></div></div>
    {mapped ? view === "gap" ? <AiGapContent output={mapped} hasCareer={Boolean(result.career)} careerKeys={careerSkillKeys(result)} /> : <AiContent output={mapped} /> : <div className={`scomp-ai-state${pending ? " scomp-ai-pending" : ""}${ai.status === "failed" ? " scomp-ai-failed" : ""}`}>
      {pending && <span className="sr-job-spinner" aria-hidden="true" />}
      <strong>{ai.status === "completed" ? "Chưa hiển thị được nhận xét" : failedOverPrevious ? "Chưa tạo được nhận xét mới" : copy.title}</strong>
      <p>{failedOverPrevious ? failedCommentText(assessment) : ai.status === "failed" ? `${aiErrorMessage(ai.errorCode)} ${copy.text}` : ai.status === "completed" ? "Nhận xét đã lưu không đọc được. Kết quả tính toán bên dưới vẫn đầy đủ." : copy.text}</p>
      {pending && <ol className="sr-job-steps" aria-label="Tiến trình tạo nhận xét"><li>1. Đã tính kết quả</li><li aria-current={ai.status === "queued" || ai.status === "deferred" ? "step" : undefined}>2. {ai.status === "deferred" ? "Chờ hàng đợi có chỗ" : workerOnline ? "Xếp hàng" : "Chờ máy AI"}</li><li aria-current={ai.status === "processing" ? "step" : undefined}>3. Viết nhận xét</li></ol>}
    </div>}
    {(canRegenerate(ai.status, aiEnabled) || pending) && <div className="scomp-actions">
      {canRegenerate(ai.status, aiEnabled) && <button type="button" className="sw-outline" disabled={busy} onClick={onRegenerate}><Icon name="refresh" />{ai.status === "disabled" ? "Tạo nhận xét" : "Tạo lại nhận xét"}</button>}
      {pending && !isAdvisorView() && <button type="button" className="sr-secondary" disabled={busy} onClick={onCancel}>Hủy tạo nhận xét</button>}
    </div>}
    {!mapped && previous && <PreviousComment comment={previous} view={view} note={previousCommentNote(ai.status)} />}
    <p className="scomp-ai-footer">{ai.status === "completed" ? `${modelLabel(ai.model)}${aiReasoned(result.meta.promptVersion, ai.model) ? " có suy luận" : ""}, ${modelPlace(ai.model)} · tạo lúc ${formatDateTime(ai.completedAt)}. ` : ""}Nhận xét do AI viết dựa trên kết quả đã tính, có thể chưa chính xác — hãy đối chiếu số liệu và trao đổi với cố vấn học tập.</p>
  </section>;
}

/** The competency part of the AI comment: overall picture, groups, strengths, what to improve and how. */
function AiContent({ output }: { output: MappedAiOutput }) {
  return <div className="scomp-ai-body">
    {output.summary && <p className="scomp-prose scomp-ai-summary">{output.summary}</p>}
    {output.groupInsights.length > 0 && <div className="scomp-ai-block"><h3>Theo nhóm năng lực</h3><ul>{output.groupInsights.map((item) => <li key={item.key}><strong>{item.name}.</strong> {item.comment}</li>)}</ul></div>}
    <div className="scomp-ai-columns">
      {output.strengths.length > 0 && <div className="scomp-ai-block"><h3>Điểm mạnh</h3><ul>{output.strengths.map((item) => <li key={item.key}><strong>{item.name}.</strong> {item.comment}</li>)}</ul></div>}
      {output.improvements.length > 0 && <div className="scomp-ai-block"><h3>Nên cải thiện</h3><ul>{output.improvements.map((item) => <li key={item.key}>
        <strong>{item.name}</strong> <span className="scomp-priority">{PRIORITY_LABELS[item.priority]}</span>. {item.comment}
        {item.courses.length > 0 && <ul className="scomp-ai-sub">{item.courses.map((course) => <li key={course.code}>Học phần {course.name} ({course.code}){course.reason && `: ${course.reason}`}</li>)}</ul>}
      </li>)}</ul></div>}
    </div>
    {output.progress && <div className="scomp-ai-block"><h3>Tiến độ học tập</h3><p className="scomp-prose">{output.progress}</p></div>}
    {output.nextSteps.length > 0 && <div className="scomp-ai-block"><h3>Bước tiếp theo</h3><ol>{output.nextSteps.map((step) => <li key={step}>{step}</li>)}</ol></div>}
  </div>;
}

/**
 * The gap part of the AI comment: fit with the target career, the gaps worth closing first with their
 * courses, and the AI's advice on raising the career's own skills (never the skills outside the career).
 */
function AiGapContent({ output, hasCareer, careerKeys }: { output: MappedAiOutput; hasCareer: boolean; careerKeys: Set<string> }) {
  const raise = careerRaise(output, careerKeys);
  if (!output.careerFit && !output.gaps.length && !raise.length) return <p className="scomp-meta">{hasCareer ? "Nhận xét lần này không có phần riêng về khoảng trống kỹ năng. Kết quả tính toán bên dưới vẫn đầy đủ." : "Chọn vị trí nghề nghiệp mục tiêu rồi đánh giá lại để có nhận xét về khoảng trống kỹ năng."}</p>;
  return <div className="scomp-ai-body">
    {output.careerFit && <div className="scomp-ai-block"><h3>Với vị trí nghề nghiệp mục tiêu</h3><p className="scomp-prose">{output.careerFit}</p></div>}
    {output.gaps.length > 0 && <div className="scomp-ai-block"><h3>Khoảng trống nên ưu tiên</h3><ul>{output.gaps.map((gap) => <li key={gap.key}>
      <strong>{gap.name}</strong> <span className="scomp-priority">{PRIORITY_LABELS[gap.priority]}</span>{gap.explanation && <>. {gap.explanation}</>}
      {gap.courses.length > 0 && <ul className="scomp-ai-sub">{gap.courses.map((course) => <li key={course.code}>Học phần {course.name} ({course.code}){course.reason && `: ${course.reason}`}</li>)}</ul>}
      {gap.selfStudy.length > 0 && <ul className="scomp-ai-sub">{gap.selfStudy.map((tip) => <li key={tip}>Tự học: {tip}</li>)}</ul>}
    </li>)}</ul></div>}
    {raise.length > 0 && <div className="scomp-ai-block"><h3>Nâng kỹ năng của vị trí nghề nghiệp</h3><ul>{raise.map((item) => <li key={item.key}>
      <strong>{item.name}</strong> <span className="scomp-priority">{PRIORITY_LABELS[item.priority]}</span>. {item.comment}
      {item.courses.length > 0 && <ul className="scomp-ai-sub">{item.courses.map((course) => <li key={course.code}>Học phần {course.name} ({course.code}){course.reason && `: ${course.reason}`}</li>)}</ul>}
    </li>)}</ul></div>}
  </div>;
}

/**
 * An older comment kept, dimmed, under the state box until the new one is ready (user 2026-11-05: every AI comment like
 * Xét tốt nghiệp's "Lời khuyên trước, viết cho dữ liệu cũ"). Its keys are read with its own assessment's names; nothing
 * shows when it has no part for this page.
 */
/** The older comment read with its own assessment's names, or null when it has no part for this page. */
function previousContent(comment: PreviousAiComment, view: CompetencyView): MappedAiOutput | null {
  const mapped = mapAiOutput(comment.output, comment.context);
  if (!mapped || (view === "gap" ? !hasGapContent(mapped, careerSkillKeys(comment.context)) : !hasCompetencyContent(mapped))) return null;
  return mapped;
}

function PreviousComment({ comment, view, note }: { comment: PreviousAiComment; view: CompetencyView; note: string }) {
  const mapped = previousContent(comment, view);
  const careerKeys = careerSkillKeys(comment.context);
  if (!mapped) return null;
  return <div className="scomp-ai-previous scomp-ai-dimmed">
    <p className="scomp-ai-old">{note}</p>
    {view === "gap" ? <AiGapContent output={mapped} hasCareer={Boolean(comment.context.career)} careerKeys={careerKeys} /> : <AiContent output={mapped} />}
    <p className="scomp-ai-old-meta">{modelLabel(comment.model)}{aiReasoned(comment.promptVersion, comment.model) ? " có suy luận" : ""}, {modelPlace(comment.model)} · tạo lúc {formatDateTime(comment.completedAt)}.</p>
  </div>;
}

/* ------------------------------------------------------------------- page */

function Checklist({ hasTranscript, transcriptFailed, profile, suggestion }: { hasTranscript: boolean | null; transcriptFailed: boolean; profile: Profile | null; suggestion: string | null }) {
  const specialty = profile?.specialty ?? null;
  const items: { label: string; done: boolean | null; value: string; note?: string | null }[] = [
    { label: "Bảng điểm", done: hasTranscript, value: transcriptFailed ? "Chưa kiểm tra được — thử tải lại trang" : hasTranscript === null ? "Đang kiểm tra…" : hasTranscript ? "Đã import" : "Chưa có bảng điểm" },
    { label: "Vị trí nghề nghiệp mục tiêu", done: profile ? Boolean(profile.careerPositionId) : null, value: profile?.careerPosition?.nameVi ?? (profile ? "Chưa chọn" : "Đang tải…") },
    { label: "Chuyên ngành", done: profile ? Boolean(specialty) : null, value: profile ? (specialty ? specialtyLabel(specialty) : "Chưa chọn") : "Đang tải…", note: !specialty ? suggestion : null },
  ];
  return <ul className="scomp-checklist" aria-label="Điều kiện đánh giá">{items.map((item) => <li key={item.label}>
    <span className={`so-check ${item.done ? "so-check-done" : ""}`} aria-hidden="true">{item.done ? <Icon name="check" /> : null}</span>
    <span className="scomp-check-text"><strong>{item.label}</strong><span>{item.value}</span>{item.note && <span className="scomp-suggestion">{item.note}</span>}</span>
    <span className="sr-only">{item.done === null ? "Chưa xác định" : item.done ? "Đã có" : "Chưa có"}</span>
    <a className="sw-text-link" href="#profile">{item.done ? "Chỉnh sửa" : "Bổ sung"}</a>
  </li>)}</ul>;
}

const HEADER_COPY: Record<CompetencyView, { title: string; resultTitle: string; lead: string; introTitle: string; intro: string }> = {
  competency: {
    title: "Đánh giá năng lực của bạn", resultTitle: "Kết quả đánh giá năng lực",
    lead: "Hệ thống tính điểm từng kỹ năng từ bảng điểm và trọng số học phần do Khoa cấu hình, xếp mức thành thạo theo nhóm năng lực và đối chiếu tiến độ học tập.",
    introTitle: "Chưa có kết quả đánh giá",
    intro: "Khi hồ sơ có đủ bảng điểm, vị trí nghề nghiệp mục tiêu và chuyên ngành, bấm “Đánh giá năng lực” để xem điểm theo từng nhóm năng lực, mức thành thạo của từng kỹ năng, tiến độ so với kế hoạch đào tạo và điều kiện xét tốt nghiệp. Kết quả chỉ mang tính tham khảo.",
  },
  gap: {
    title: "Phân tích khoảng trống kỹ năng", resultTitle: "Kết quả phân tích khoảng trống kỹ năng",
    lead: "Khoảng trống được tính từ điểm từng kỹ năng ở trang Đánh giá năng lực, so với ngưỡng mà vị trí nghề nghiệp mục tiêu của bạn yêu cầu.",
    introTitle: "Chưa có kết quả phân tích",
    intro: "Khoảng trống kỹ năng được tính cùng lúc với đánh giá năng lực, từ bảng điểm, chuyên ngành và vị trí nghề nghiệp mục tiêu của bạn. Khi hồ sơ có đủ ba mục này, bấm “Đánh giá năng lực” để bắt đầu. Kết quả chỉ mang tính tham khảo.",
  },
};

/** notice: shown under the result panel (the workspace's "Hồ sơ của bạn chưa đầy đủ"). */
export default function StudentCompetency({ profile, view = "competency", notice }: { profile: Profile | null; view?: CompetencyView; notice?: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const live = useLiveData(`${COMPETENCY_API}/latest`, revision, readLatest);
  const transcript = useLiveData("/api/student/transcript", 0, readTranscriptPresence);
  const [current, setCurrent] = useState<LatestAssessmentResponse | null>(null);
  useEffect(() => { if (live.data) setCurrent(live.data); }, [live.data]);
  const data = current ?? live.data;
  const assessment = data?.assessment ?? null;
  const [busy, setBusy] = useState<"run" | "ai" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState<PreconditionError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actingConfirm, setActingConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // The newest comment this page session has shown (the assessment's own, or the older one the API sent): "Đánh giá lại"
  // answers with the new assessment alone, so the page keeps showing it, dimmed, until the new comment is ready.
  const served = data?.previous ?? null;
  const [remembered, setRemembered] = useState<PreviousAiComment | null>(null);
  useEffect(() => {
    const shown = (assessment && ownComment(assessment)) ?? served;
    if (shown) setRemembered(shown);
  }, [assessment, served]);
  const shownPrevious = previousComment({ assessment, aiEnabled: data?.aiEnabled ?? false, served, remembered });

  const aiStatus: AiStatus | null = assessment?.ai.status ?? null;
  const assessmentId = assessment?.id ?? null;
  const previous = useRef<{ id: string | null; status: AiStatus | null }>({ id: null, status: null });
  useEffect(() => {
    const before = previous.current;
    previous.current = { id: assessmentId, status: aiStatus };
    if (!assessmentId || before.id !== assessmentId || before.status === aiStatus || !aiStatus) return;
    setAnnouncement(aiStatus === "completed" ? "Đã có nhận xét từ EduPath AI." : aiStatus === "failed" ? "Chưa tạo được nhận xét AI." : aiStateCopy(aiStatus, data?.workerOnline ?? false, data?.aiEnabled ?? false).title);
  }, [assessmentId, aiStatus, data?.workerOnline, data?.aiEnabled]);

  // Poll the small status payload only while the AI comment can still change.
  useEffect(() => {
    if (!assessmentId || !shouldPoll(aiStatus)) return;
    const pending = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await send<AssessmentStatusResponse>(`${COMPETENCY_API}/latest/status`, { signal: pending.signal });
        if (pending.signal.aborted) return;
        if (status.id !== assessmentId || status.aiStatus !== aiStatus) {
          const latest = await readLatest(await fetch(`${COMPETENCY_API}/latest`, { credentials: "include", cache: "no-store", signal: pending.signal }));
          if (!pending.signal.aborted) setCurrent(latest);
          return;
        }
        setCurrent((value) => value && value.workerOnline !== status.workerOnline ? { ...value, workerOnline: status.workerOnline } : value);
      } catch { /* a failed poll keeps the last state; the next one tries again */ }
      if (!pending.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { pending.abort(); clearTimeout(timer); };
  }, [assessmentId, aiStatus]);

  const run = async (consented: boolean) => {
    setConsentOpen(false); setBusy("run"); setError(""); setAnnouncement("Đang tính kết quả đánh giá năng lực…");
    try {
      const response = await send<{ assessment: StoredAssessment }>(`${COMPETENCY_API}`, { method: "POST", headers: { "Content-Type": "application/json", ...(consented ? { "X-Consent-Policy-Version": policyVersion } : {}) }, body: "{}" });
      setBlocked(null);
      previous.current = { id: response.assessment.id, status: response.assessment.ai.status };
      setCurrent((value) => ({ assessment: response.assessment, aiEnabled: value?.aiEnabled ?? data?.aiEnabled ?? false, workerOnline: value?.workerOnline ?? data?.workerOnline ?? false, consentVersion: consented ? policyVersion : value?.consentVersion ?? data?.consentVersion ?? null }));
      setAnnouncement("Đã cập nhật kết quả đánh giá năng lực.");
    } catch (e) {
      const failure = e as ApiError;
      if (isPreconditionError(failure.code)) { setBlocked(failure.code); setAnnouncement(PRECONDITION_COPY[failure.code].title); }
      else if (failure.code === "consent_required" && isAdvisorView()) {
        // A cố vấn học tập never consents for the student; the API runs it without consent (policy 2026-11-03).
        setError("Chưa chạy được Đánh giá năng lực thay sinh viên. Vui lòng thử lại sau."); setAnnouncement("");
      } else if (failure.code === "consent_required") {
        // The server holds no consent for this student: ask instead of failing.
        setCurrent((value) => value ? { ...value, consentVersion: null } : value);
        setAnnouncement(""); setConsentOpen(true);
      } else {
        // policy_outdated means this page is older than the server's policy: only a reload helps.
        if (failure.code === "policy_outdated") setCurrent((value) => value ? { ...value, consentVersion: null } : value);
        setError(failure.message); setAnnouncement("");
      }
    } finally { setBusy(null); }
  };
  const hasTranscript = transcript.loading ? null : transcript.error ? null : transcript.data;
  const missing = missingRequirements(hasTranscript, profile);
  // Consent is per student and kept by the server (GET /latest consentVersion), never per browser; one that still counts
  // (from 2026-10-25) is not asked again.
  const start = () => {
    if (missing.length) { setAnnouncement(""); setError(missingRequirementsMessage(missing)); return; }
    // A cố vấn học tập runs it for the student without the consent dialog (advisor-view.ts; the API records no consent),
    // once confirmed: the result is replaced and the student is told (QA 2026-11-07).
    if (isAdvisorView()) { setActingConfirm(true); return; }
    if (isValidConsent(data?.consentVersion)) void run(false); else setConsentOpen(true);
  };
  const confirmConsent = () => { void run(true); };
  const regenerate = async () => {
    if (!assessment) return;
    setBusy("ai"); setError("");
    try {
      const response = await send<{ aiStatus: AiStatus }>(`${COMPETENCY_API}/${encodeURIComponent(assessment.id)}/ai`, jsonWrite("POST"));
      setCurrent((value) => value?.assessment?.id === assessment.id ? { ...value, assessment: { ...value.assessment, ai: { ...value.assessment.ai, status: response.aiStatus, errorCode: null } } } : value);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };
  const cancelAi = async () => {
    if (!assessment) return;
    setBusy("ai"); setError("");
    try {
      await send<{ cancelled: boolean }>(`${COMPETENCY_API}/${encodeURIComponent(assessment.id)}/ai`, jsonWrite("DELETE"));
      setCurrent(await readLatest(await fetch(`${COMPETENCY_API}/latest`, { credentials: "include", cache: "no-store" })));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("delete"); setDeleteError("");
    try {
      await send<{ deleted: boolean }>(`${COMPETENCY_API}`, jsonWrite("DELETE", { confirmed: true }));
      setDeleteOpen(false);
      // Every result and comment is gone: none comes back dimmed after the next assessment.
      setRemembered(null);
      setCurrent((value) => ({ assessment: null, aiEnabled: value?.aiEnabled ?? false, workerOnline: value?.workerOnline ?? false, consentVersion: null }));
      setAnnouncement("Đã xóa kết quả đánh giá năng lực và rút lại sự đồng ý.");
    } catch (e) { setDeleteError((e as Error).message); }
    finally { setBusy(null); }
  };

  // Stored scores are read on the current level scale (comp-calc-v10), older results included.
  const result = useMemo(() => (assessment ? withCurrentLevels(assessment.result) : null), [assessment]);
  const peOutdated = result ? physicalEducationOutdated(result) : null;
  // comp-calc-v23: a course of the thesis group the student placed in Kế hoạch học kỳ that this result leaves out.
  const thesisPlanNote = result ? thesisPlanOutdatedText(result, data?.thesisPlanOutdated) : null;
  const mapped = useMemo(() => assessment && result && assessment.ai.status === "completed" ? mapAiOutput(assessment.ai.output, result) : null, [assessment, result]);
  // The result was computed for meta.specialty / meta.career; say so when the profile changed since.
  // profile.specialty is undefined only while an older API is serving: skip that comparison then.
  const profileChanged = Boolean(result && profile && (
    (profile.specialty !== undefined && (profile.specialty ?? null) !== result.meta.specialty)
    || (profile.careerPositionId ?? null) !== (result.meta.career?.id ?? null)));
  const copy = HEADER_COPY[view];
  const aiPanel = assessment && <AiPanel assessment={assessment} aiEnabled={data?.aiEnabled ?? false} workerOnline={data?.workerOnline ?? false} busy={busy !== null} onRegenerate={() => void regenerate()} onCancel={() => void cancelAi()} view={view} previous={shownPrevious} />;
  return <div className="scomp-page">
    <section className="sw-panel scomp-header" aria-labelledby="scomp-title">
      <div className="scomp-header-main">
        <div>
          <h2 id="scomp-title">{assessment ? copy.resultTitle : copy.title}</h2>
          <p className="scomp-lead">{copy.lead}</p>
        </div>
        <div className="scomp-header-actions">
          <button type="button" className="sw-primary" disabled={busy !== null || live.loading} onClick={start}><Icon name={assessment ? "refresh" : "chart"} />{busy === "run" ? "Đang đánh giá…" : assessment ? "Đánh giá lại" : "Đánh giá năng lực"}</button>
          {assessment && view === "competency" && !isAdvisorView() && <button type="button" className="sr-secondary sr-danger" disabled={busy !== null} onClick={() => { setDeleteError(""); setDeleteOpen(true); }}><Icon name="trash" />Xóa kết quả đánh giá</button>}
        </div>
      </div>
      <Checklist hasTranscript={hasTranscript} transcriptFailed={!transcript.loading && Boolean(transcript.error)} profile={profile} suggestion={result?.specialtySuggestion?.text ?? null} />
      {profileChanged && <p className="scomp-meta">Hồ sơ đã thay đổi sau lần đánh giá này. Bấm “Đánh giá lại” để cập nhật kết quả.</p>}
      {result && !thesisWayAdvised(result.meta.calcVersion) && <p className="scomp-meta">Kết quả này được tính trước khi hệ thống đề xuất một phương án cho nhóm đồ án tốt nghiệp (Đồ án tốt nghiệp, hoặc Chuyên đề tốt nghiệp thay thế). Bấm “Đánh giá lại” để cập nhật gợi ý học phần.</p>}
      {result && thesisPlanNote && <p className="scomp-meta">{thesisPlanNote}</p>}
      {result && view === "competency" && !lateBeforeStudyTerm(result.meta.calcVersion) && <p className="scomp-meta">Kết quả này được tính trước khi hệ thống sửa cách tính tiến độ: môn của học kỳ đang học không còn bị tính là chậm, tín chỉ môn điều kiện (GDTC, GDQP) không được cộng, và nhóm tự chọn ghi đúng số tín chỉ còn thiếu. Bấm “Đánh giá lại” để cập nhật.</p>}
      {result && peOutdated && <p className="scomp-meta">Kết quả này được tính trước khi hệ thống ghi nhận học phần giáo dục thể chất bạn đã học ({peOutdated.join(", ")}) cho các học phần Giáo dục thể chất trong chương trình đào tạo. Bấm “Đánh giá lại” để cập nhật.</p>}
      {assessment && <p className="scomp-data-line">{dataUsedLine(assessment)}</p>}
      <p className="scomp-live" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      {error && <div className="sr-error" role="alert">{error}</div>}
      {live.error && !data && <div className="sr-error" role="alert">{live.error}<button type="button" onClick={() => setRevision((n) => n + 1)}>Thử lại</button></div>}
    </section>
    {notice}
    {live.loading && !data && <section className="sw-panel scomp-section scomp-loading" aria-busy="true"><p>Đang tải kết quả đánh giá…</p><div /><div /><div /></section>}
    {blocked && <section className="sw-panel scomp-section" aria-labelledby="scomp-blocked-title"><div className="sw-empty scomp-empty"><span className="scomp-empty-icon" aria-hidden="true"><Icon name={blocked === "transcript_required" ? "document" : "info"} /></span><h3 id="scomp-blocked-title">{PRECONDITION_COPY[blocked].title}</h3><p>{PRECONDITION_COPY[blocked].text}</p>{PRECONDITION_COPY[blocked].action && <a className="sw-outline" href={PRECONDITION_COPY[blocked].action!.href}>{PRECONDITION_COPY[blocked].action!.label}</a>}</div></section>}
    {data && !assessment && !blocked && <section className="sw-panel scomp-section" aria-labelledby="scomp-intro-title"><div className="sw-empty scomp-empty">
      <span className="scomp-empty-icon" aria-hidden="true"><Icon name={view === "gap" ? "target" : "chart"} /></span>
      <h3 id="scomp-intro-title">{copy.introTitle}</h3>
      <p>{copy.intro}</p>
    </div></section>}
    {assessment && result && (view === "gap" ? <>
      <GapSummary result={result} />
      {aiPanel}
      <GapTable result={result} />
      <GapHistory result={result} />
      <CoursesSection result={result} ai={mapped} />
    </> : <>
      <Overview result={result} />
      {aiPanel}
      <HistorySection result={result} />
      <SkillsSection key={assessment.id} result={result} />
      <ProgressSection result={result} />
      <GraduationSection />
    </>)}
    {consentOpen && <ConsentDialog busy={busy === "run"} onClose={() => setConsentOpen(false)} onConfirm={confirmConsent} />}
    {deleteOpen && <DeleteDialog busy={busy === "delete"} error={deleteError} onClose={() => setDeleteOpen(false)} onConfirm={() => void remove()} />}
    {actingConfirm && <ActingConfirmDialog {...assessmentConfirm(Boolean(assessment))} onClose={() => setActingConfirm(false)}
      onConfirm={() => { setActingConfirm(false); void run(false); }} />}
  </div>;
}
