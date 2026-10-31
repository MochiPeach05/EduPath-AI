import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "./admin-account-shared";
import { Pagination } from "./admin-ui";
import { REPORT_PATHS, reportViewOf, studentProfileLink, type ReportView } from "./admin-navigation";
import { meaningClass, meaningOf, termName } from "./display-format";
import { sortRows, useTableSort, type SortRule, type TableSort } from "./table-sort";
import {
  AUDIT_API, EMPTY_FILTERS, REPORTS_API, downloadExcel, filtersFromSearch, filtersToSearch, reportUrl, useDebounced, useReport, type ReportFilterState,
} from "./admin-report-api";
import {
  Card, CohortMatrix, Donut, Gauge, HBarList, LEVEL_RAMP, Legend, LineChart, ModeSwitch, Ring, SERIES_COLORS, STATUS_COLORS, Segmented, ShareBars, Sparkline,
  TooltipLayer, cohortColor, countText, gpaText, percent, scoreOrDash, type BarPart, type BarRow, type CohortMode, type LineSeries, type MatrixRow,
} from "./admin-report-charts";
import type {
  AuditEntry, AuditKind, AuditPage, AverageRow, AverageTable, CareerRow, CareersReport, CohortSplit, CompetencyGroups, CourseHow, CourseRow, CourseStudents,
  CoursesReport, DashboardKpis, DashboardReport, FitSummary, GpaBandLabel, GpaBands, GpaPoint, ProgressCounts, ProgressReport, ProgressStatus, ProgressStudent,
  ReportHead, ReportOptions, ReportTerm, RiskKind, RiskReport, RiskStudent, SkillAverage, SkillGapRow, SkillGapStatus, SkillStudents, SkillsReport,
} from "./admin-report-types";
import "./table-sort.css";
import "./admin-reports.css";

// Báo cáo của cổng quản trị (AD-REPORT-01…11, 2026-10-31), built from the preview the user approved ("Triển khai đi")
// with one more rule: "mọi phần đều có xem trung bình toàn khóa với từng khóa hết á" — every section reads for all
// cohorts together (Toàn khóa) and for each cohort (Từng khóa). Every admin sees and exports everything ("hiện đầy đủ",
// "mọi quản trị viên"). Progress and risk are the student's own Tổng quan numbers (server: readOverview), never AI.
// Contract: admin-report-types.ts; requests: admin-report-api.ts; charts: admin-report-charts.tsx.

/* ------------------------------------------------------------------ words */

const PAGE_TEXT: Record<ReportView, { code: string; title: string; lead: string }> = {
  dashboard: { code: "01", title: "Tổng quan dữ liệu và hoạt động", lead: "Điểm trung bình, năng lực, mức phù hợp với nghề và tiến độ của sinh viên trong phạm vi lọc." },
  progress: { code: "02–03", title: "Thống kê sinh viên theo tiến độ", lead: "Tính giống trang Tổng quan của sinh viên: tín chỉ đã đạt so với kế hoạch đào tạo của khóa, đến học kỳ đang học." },
  risk: { code: "04–05", title: "Sinh viên có nguy cơ chậm tiến độ", lead: "Đúng các mục \"Cần chú ý\" sinh viên thấy trên trang của mình. Hệ thống tự tính, không dùng AI; chỉ để tham khảo, không thay cảnh báo học vụ." },
  skills: { code: "06–07", title: "Thống kê kỹ năng còn thiếu", lead: "Từ lần Đánh giá năng lực mới nhất của mỗi sinh viên, so với nghề mục tiêu. Bấm một kỹ năng để xem sinh viên còn thiếu." },
  careers: { code: "08", title: "Thống kê nghề nghiệp mục tiêu", lead: "Nghề sinh viên chọn trong Đánh giá năng lực và mức phù hợp hiện tại." },
  courses: { code: "09", title: "Thống kê môn học được đề xuất", lead: "Các môn Lộ trình AI đề xuất cho sinh viên. Bấm một môn để xem sinh viên được đề xuất." },
  audit: { code: "11", title: "Nhật ký thao tác", lead: "Ai đã làm gì, lúc nào: thay đổi dữ liệu và cấu hình, gửi thông báo, xem bảng điểm và xuất báo cáo có tên sinh viên. Lưu 1 năm; không lưu nội dung dữ liệu của sinh viên." },
};

export const STATUS_TEXT: Record<ProgressStatus, { label: string; tone: string }> = {
  on_track: { label: "Đúng tiến độ", tone: meaningClass("good") },
  late: { label: "Trễ kế hoạch", tone: meaningClass("warn") },
  unknown: { label: "Chưa đủ dữ liệu", tone: meaningClass("none") },
  no_transcript: { label: "Chưa có bảng điểm", tone: meaningClass("none") },
};
export const RISK_TEXT: Record<RiskKind, string> = {
  failed_course: "Môn bắt buộc chưa đạt", pace: "Không kịp tín chỉ", gpa_below: "GPA dưới ngưỡng", late_course: "Trễ môn so với KHĐT", elective_short: "Thiếu tín chỉ tự chọn",
};
const RISK_ORDER: readonly RiskKind[] = ["failed_course", "pace", "gpa_below", "late_course", "elective_short"];
const LEVEL_TEXT = { risk: { label: "Nguy cơ", tone: meaningClass("bad") }, warn: { label: "Cần chú ý", tone: meaningClass("warn") } } as const;
export const GAP_TEXT: Record<SkillGapStatus, { label: string; color: string; tone: string }> = {
  below: { label: "Dưới ngưỡng", color: SERIES_COLORS.amber, tone: meaningClass("warn") },
  not_studied: { label: "Chưa học", color: SERIES_COLORS.blue, tone: "rp-chip-blue" },
  self_study: { label: "Cần tự học ngoài chương trình", color: SERIES_COLORS.violet, tone: "rp-chip-violet" },
  no_data: { label: "Chưa có điểm", color: STATUS_COLORS.none, tone: meaningClass("none") },
};
export const HOW_TEXT: Record<CourseHow, { label: string; color: string; tone: string }> = {
  new: { label: "Học mới", color: SERIES_COLORS.blue, tone: "rp-chip-blue" },
  retake: { label: "Học lại", color: SERIES_COLORS.amber, tone: meaningClass("warn") },
  improve: { label: "Học cải thiện", color: SERIES_COLORS.violet, tone: "rp-chip-violet" },
};
export const AUDIT_TEXT: Record<AuditKind, string> = {
  account: "Tài khoản", training: "Đào tạo", career: "Nghề nghiệp", competency: "Năng lực", notify: "Thông báo", report: "Xuất báo cáo", access: "Xem dữ liệu sinh viên", other: "Khác",
};
const BAND_ORDER: readonly GpaBandLabel[] = ["Xuất sắc", "Giỏi", "Khá", "Trung bình", "Yếu"];
const FIT_ORDER = ["Rất phù hợp", "Phù hợp", "Trung bình", "Ít phù hợp", "Không phù hợp"] as const;

/** A level, fit or result word as a chip in its meaning's colour (one colour per word, display-format.ts). */
function Word({ word }: { word: string | null | undefined }) {
  return word ? <span className={`rp-chip ${meaningClass(meaningOf(word))}`}>{word}</span> : null;
}
const Chip = ({ tone, children }: { tone: string; children: ReactNode }) => <span className={`rp-chip ${tone}`}>{children}</span>;

/** "09:15 31/10/2026" in Vietnam time. */
export function updatedText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric", hour12: false })
    .formatToParts(date).reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}/${parts.year}`;
}
const termLabel = (term: ReportTerm | null | undefined) => (term ? term.label || termName(term.code) : "—");

/* ------------------------------------------------------------------ pure helpers (tested) */

/** The cohort lines of "GPA theo học kỳ · Từng khóa": the terms of every cohort, oldest first, one cumulative-GPA line per cohort. */
export function cohortGpaLines(split: CohortSplit<{ points: GpaPoint[] }>): { terms: ReportTerm[]; series: LineSeries[] } {
  const terms = new Map<string, ReportTerm>();
  for (const cohort of split.byCohort) for (const point of cohort.points) terms.set(point.term.code, point.term);
  const ordered = [...terms.values()].sort((a, b) => a.code.localeCompare(b.code));
  const series = split.byCohort.map((cohort) => ({
    key: cohort.cohort, label: cohort.cohort, color: cohortColor(cohort.cohort),
    values: ordered.map((term) => cohort.points.find((point) => point.term.code === term.code)?.cumulativeGpa ?? null),
  }));
  return { terms: ordered, series };
}

/** The status parts of a progress count, in the legend's order. */
export const progressParts = (counts: ProgressCounts): BarPart[] => [
  { label: STATUS_TEXT.on_track.label, value: counts.onTrack, color: STATUS_COLORS.good },
  { label: STATUS_TEXT.late.label, value: counts.late, color: STATUS_COLORS.warn },
  { label: STATUS_TEXT.unknown.label, value: counts.unknown, color: STATUS_COLORS.unknown },
  { label: STATUS_TEXT.no_transcript.label, value: counts.noTranscript, color: STATUS_COLORS.none },
];

/** The five học lực bands in order (Xuất sắc first) with the ramp colour; a band the server left out counts 0. */
export function bandParts(bands: GpaBands): (BarPart & { range: string })[] {
  return BAND_ORDER.map((label, index) => {
    const band = bands.bands.find((item) => item.label === label);
    return { label, range: band?.range ?? "", value: band?.students ?? 0, color: LEVEL_RAMP[index]! };
  });
}

/** The five fit words in order (Rất phù hợp first) with the ramp colour. */
export function fitParts(fit: FitSummary): BarPart[] {
  return FIT_ORDER.map((label, index) => ({ label, value: fit.levels.find((level) => level.label === label)?.students ?? 0, color: LEVEL_RAMP[index]! }));
}

/** The cohorts present in a split, oldest first, as the matrices list them. */
export const cohortsOf = (split: CohortSplit<object>) => split.byCohort.map((item) => item.cohort);

/** A matrix row per item of the "all" list, with each cohort's count of the same item (matched by `key`). */
export function matrixRows<T>(split: CohortSplit<{ items: T[] }>, key: (item: T) => string, label: (item: T) => string, count: (item: T) => number): MatrixRow[] {
  return split.all.items.map((item) => {
    const values: Record<string, number> = {};
    for (const cohort of split.byCohort) { const match = cohort.items.find((other) => key(other) === key(item)); values[cohort.cohort] = match ? count(match) : 0; }
    return { key: key(item), label: label(item), values, total: count(item) };
  });
}

/** The page of a list that goes back to 1 whenever its filters change. */
function usePageFor(key: string): [number, (page: number) => void] {
  const [state, setState] = useState({ key, page: 1 });
  return [state.key === key ? state.page : 1, (page: number) => setState({ key, page })];
}
const sortQuery = (sort: TableSort) => (sort ? { sort: sort.key, dir: sort.direction } : {});

/* ------------------------------------------------------------------ shared pieces */

/** The filters of the report pages, kept in the address bar so they survive page changes, reloads and shared links. */
function useReportFilters(): [ReportFilterState, (next: ReportFilterState) => void] {
  const [filters, setState] = useState<ReportFilterState>(() => (typeof window === "undefined" ? EMPTY_FILTERS : filtersFromSearch(window.location.search)));
  useEffect(() => {
    const onPop = () => setState(filtersFromSearch(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const set = (next: ReportFilterState) => {
    setState(next);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${filtersToSearch(next)}`);
  };
  return [filters, set];
}

/** The shared filter bar (AD-REPORT-10: search and filters, one row since the user's function-list merge of 2026-10-31). */
export function FilterBar({ filters, setFilters, options }: { filters: ReportFilterState; setFilters: (next: ReportFilterState) => void; options: ReportOptions | null }) {
  const [draft, setDraft] = useState(filters.q);
  useEffect(() => setDraft(filters.q), [filters.q]);
  const settled = useDebounced(draft);
  useEffect(() => { if (settled.trim() !== filters.q) setFilters({ ...filters, q: settled.trim() }); }, [settled]); // eslint-disable-line react-hooks/exhaustive-deps
  const specialties = (options?.specialties ?? []).filter((item) => !filters.major || !item.majorCode || item.majorCode === filters.major);
  const submit = (event: FormEvent) => { event.preventDefault(); if (draft.trim() !== filters.q) setFilters({ ...filters, q: draft.trim() }); };
  const any = Boolean(filters.q || filters.cohort || filters.major || filters.specialty || draft.trim());
  return <form className="rp-filters" role="search" aria-label="Tìm kiếm và lọc dữ liệu báo cáo" onSubmit={submit}>
    <label className="rp-field rp-field-search">Tìm sinh viên<span className="rp-search"><Icon name="search" /><input id="rp-q" type="search" value={draft} maxLength={120} placeholder="MSSV hoặc họ tên" onChange={(event) => setDraft(event.target.value)} /></span></label>
    <label className="rp-field">Khóa<select id="rp-cohort" value={filters.cohort} onChange={(event) => setFilters({ ...filters, cohort: event.target.value })}><option value="">Tất cả</option>{(options?.cohorts ?? []).map((cohort) => <option key={cohort} value={cohort}>{cohort}</option>)}</select></label>
    <label className="rp-field">Ngành<select id="rp-major" value={filters.major} onChange={(event) => {
      const major = event.target.value;
      const keep = (options?.specialties ?? []).some((item) => item.code === filters.specialty && (!major || !item.majorCode || item.majorCode === major));
      setFilters({ ...filters, major, specialty: keep ? filters.specialty : "" });
    }}><option value="">Tất cả</option>{(options?.majors ?? []).map((major) => <option key={major.code} value={major.code}>{major.name}</option>)}</select></label>
    <label className="rp-field">Chuyên ngành<select id="rp-specialty" value={filters.specialty} onChange={(event) => setFilters({ ...filters, specialty: event.target.value })}><option value="">Tất cả</option>{specialties.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    <button type="button" className="rp-reset" disabled={!any} onClick={() => { setDraft(""); setFilters(EMPTY_FILTERS); }}>Xóa bộ lọc</button>
  </form>;
}

/** The head of a report: its code, long title and one-line explanation; the pills (term, update time) and actions on the right. */
function Intro({ view, head, studyTerm, actions }: { view: ReportView; head: ReportHead | null; studyTerm: ReportTerm | null; actions?: ReactNode }) {
  const text = PAGE_TEXT[view];
  return <div className="rp-intro">
    <div><p className="rp-title"><span className="rp-code">AD-REPORT-{text.code}</span>{text.title}</p><p className="rp-lead">{text.lead}</p></div>
    <div className="rp-pills">
      {view !== "audit" && <span className="rp-pill">Học kỳ đang học <b>{termLabel(head?.studyTerm ?? studyTerm)}</b></span>}
      {head && <span className="rp-pill">Cập nhật <b>{updatedText(head.generatedAt)}</b></span>}
      {actions}
    </div>
  </div>;
}

/** "Dựa trên N/M sinh viên đã tải bảng điểm (chưa xác minh)". */
export function coverageText(head: ReportHead): string {
  return `Dựa trên ${countText(head.scope.withTranscript)}/${countText(head.scope.students)} sinh viên đã tải bảng điểm (chưa xác minh)`;
}
function Coverage({ head }: { head: ReportHead }) {
  return <p className="rp-coverage"><Icon name="info" />{coverageText(head)}{head.scope.assessed > 0 && <> · {countText(head.scope.assessed)} sinh viên đã đánh giá năng lực</>}</p>;
}

function Loading<T>({ state, children }: { state: { data: T | null; error: string | null; loading: boolean; retry: () => void }; children: (data: T) => ReactNode }) {
  if (state.data) return <div className={state.loading ? "rp-refreshing" : undefined} aria-busy={state.loading}>{children(state.data)}</div>;
  if (state.error) return <div className="rp-card rp-state"><p className="admin-error" role="alert">{state.error}</p><button type="button" className="rp-btn" onClick={state.retry}><Icon name="refresh" />Thử lại</button></div>;
  return <div className="rp-card rp-state" role="status">Đang tải báo cáo…</div>;
}

const EMPTY_SCOPE = "Chưa có sinh viên nào tải bảng điểm trong phạm vi lọc.";
const EMPTY_ASSESSED = "Chưa có sinh viên nào đánh giá năng lực trong phạm vi lọc.";

/** Downloads an Excel export (AD-REPORT-03/05/07) and says what happened, in Vietnamese. */
export function ExportButton({ url, fallbackName }: { url: string; fallbackName: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy(true); setMessage(null);
    try { const name = await downloadExcel(url, fallbackName); setMessage({ ok: true, text: `Đã tải ${name}.` }); }
    catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Không xuất được file. Vui lòng thử lại." }); }
    finally { setBusy(false); }
  };
  return <div className="rp-export">
    <button type="button" className="rp-btn" disabled={busy} onClick={() => void run()}><Icon name="download" />{busy ? "Đang xuất…" : "Xuất Excel"}</button>
    {message && <span className={message.ok ? "rp-export-ok" : "rp-export-error"} role={message.ok ? "status" : "alert"}>{message.text}</span>}
  </div>;
}

/** A stored student's name and MSSV, the way every report table shows a student. */
const Student = ({ name, code }: { name: string; code: string | null }) => <span className="rp-who"><b>{name}</b><small>{code ?? "Chưa có MSSV"}</small></span>;
/**
 * "Xem hồ sơ" (user, 2026-10-31): the student's details on the Sinh viên page, through the workspace navigation. A real link,
 * so a middle click or Ctrl+click still opens them in a new tab.
 */
function ProfileLink({ userId, name, navigate }: { userId: string; name: string; navigate: (path: string) => void }) {
  const href = studentProfileLink(userId);
  return <a className="rp-link" href={href} aria-label={`Xem hồ sơ của ${name}`}
    onClick={(event) => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(href); } }}>Xem hồ sơ</a>;
}

/* ------------------------------------------------------------------ AD-REPORT-01 Tổng quan */

function KpiCards({ kpis, sparkline }: { kpis: DashboardKpis; sparkline: number[] }) {
  return <div className="rp-kpis">
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-blue"><Icon name="users" /></span><span>Sinh viên</span></div>
      <div className="rp-kpi-body"><b className="rp-kpi-value">{countText(kpis.students)}</b><Ring share={kpis.students ? kpis.withTranscript / kpis.students : 0} label="Đã tải bảng điểm" /></div>
      <p className="rp-kpi-foot">{countText(kpis.withTranscript)} đã tải bảng điểm · {countText(kpis.assessed)} đã đánh giá năng lực</p></div>
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-violet"><Icon name="chart" /></span><span>GPA tích lũy trung bình</span></div>
      <div className="rp-kpi-body"><b className="rp-kpi-value">{gpaText(kpis.gpa)}<small>/ 4</small></b><span data-tip={sparkline.length > 1 ? "GPA trung bình tích lũy theo học kỳ (Toàn khóa)" : undefined}><Sparkline values={sparkline} label="GPA trung bình tích lũy theo học kỳ" /></span></div>
      <p className="rp-kpi-foot">{kpis.gpaChange === null ? "Chưa đủ học kỳ để so sánh" : <><span className={`rp-delta ${kpis.gpaChange >= 0 ? "rp-up" : "rp-down"}`}>{kpis.gpaChange >= 0 ? "▲" : "▼"} {gpaText(Math.abs(kpis.gpaChange))}</span> so với {termLabel(kpis.gpaChangeFrom)}</>}</p></div>
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-teal"><Icon name="spark" /></span><span>Độ thành thạo kỹ năng trung bình</span></div>
      <div className="rp-kpi-body"><b className="rp-kpi-value">{scoreOrDash(kpis.competency)}<small>/ 100</small></b><Gauge value={kpis.competency} size="mini" label="Độ thành thạo kỹ năng trung bình" /></div>
      <p className="rp-kpi-foot"><Word word={kpis.competencyLevel} /> Năng lực chung của {countText(kpis.assessed)} sinh viên</p></div>
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-amber"><Icon name="target" /></span><span>Độ phù hợp với nghề trung bình</span></div>
      <div className="rp-kpi-body"><b className="rp-kpi-value">{scoreOrDash(kpis.fit)}<small>/ 100</small></b><Gauge value={kpis.fit} size="mini" color={SERIES_COLORS.amber} label="Độ phù hợp với nghề trung bình" /></div>
      <p className="rp-kpi-foot"><Word word={kpis.fitLabel} /> So với nghề mục tiêu</p></div>
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-red"><Icon name="bell" /></span><span>Cần chú ý</span></div>
      <div className="rp-kpi-body"><b className="rp-kpi-value">{countText(kpis.risk + kpis.warn)}</b></div>
      <span className="rp-split" data-tip={`Nguy cơ: ${countText(kpis.risk)}\nCần chú ý: ${countText(kpis.warn)}`} tabIndex={0}><i style={{ flexGrow: kpis.risk || 0.0001, background: STATUS_COLORS.bad }} /><i style={{ flexGrow: kpis.warn || 0.0001, background: STATUS_COLORS.warn }} /></span>
      <p className="rp-kpi-foot"><Chip tone={LEVEL_TEXT.risk.tone}>{countText(kpis.risk)} nguy cơ</Chip><Chip tone={LEVEL_TEXT.warn.tone}>{countText(kpis.warn)} cần chú ý</Chip></p></div>
  </div>;
}

/** Từng khóa of the KPI strip: one row per cohort, the whole scope last. */
function KpiTable({ kpis }: { kpis: CohortSplit<DashboardKpis> }) {
  const row = (label: string, item: DashboardKpis, footer = false) => <tr key={label} className={footer ? "rp-foot" : undefined}>
    <th scope="row">{label}</th><td className="rp-num">{countText(item.students)}</td>
    <td className="rp-num">{countText(item.withTranscript)} <small>({percent(item.withTranscript, item.students)}%)</small></td><td className="rp-num">{countText(item.assessed)}</td>
    <td className="rp-num">{gpaText(item.gpa)}</td><td>{scoreOrDash(item.competency)} <Word word={item.competencyLevel} /></td>
    <td>{scoreOrDash(item.fit)} <Word word={item.fitLabel} /></td><td className="rp-num">{countText(item.risk)}</td><td className="rp-num">{countText(item.warn)}</td>
  </tr>;
  return <div className="rp-table-wrap" tabIndex={0} role="region" aria-label="Số liệu chính theo từng khóa"><table className="rp-table">
    <thead><tr><th scope="col">Khóa</th><th scope="col" className="rp-num">Sinh viên</th><th scope="col" className="rp-num">Đã tải bảng điểm</th><th scope="col" className="rp-num">Đã đánh giá</th>
      <th scope="col" className="rp-num">GPA TB tích lũy</th><th scope="col">Thành thạo kỹ năng TB</th><th scope="col">Phù hợp nghề TB</th><th scope="col" className="rp-num">Nguy cơ</th><th scope="col" className="rp-num">Cần chú ý</th></tr></thead>
    <tbody>{kpis.byCohort.map((item) => row(item.cohort, item))}</tbody>
    <tfoot>{row("Toàn khóa", kpis.all, true)}</tfoot>
  </table></div>;
}

function KpiSection({ data }: { data: DashboardReport }) {
  const [mode, setMode] = useState<CohortMode>("all");
  const sparkline = data.gpaByTerm.all.points.map((point) => point.cumulativeGpa).filter((value): value is number => value !== null);
  return <section className="rp-section" aria-labelledby="rp-kpi-title">
    <div className="rp-section-head"><h2 id="rp-kpi-title">Số liệu chính</h2><ModeSwitch value={mode} onChange={setMode} label="số liệu chính" /></div>
    {mode === "all" ? <KpiCards kpis={data.kpis.all} sparkline={sparkline} /> : <div className="rp-card"><KpiTable kpis={data.kpis} /></div>}
  </section>;
}

export function gpaColumnTip(points: readonly GpaPoint[], index: number): string {
  const point = points[index]!;
  return `${termLabel(point.term)}\nGPA TB học kỳ: ${gpaText(point.termGpa)} (${countText(point.termStudents)} sinh viên có điểm)\nGPA TB tích lũy: ${gpaText(point.cumulativeGpa)}`;
}

function GpaSection({ split }: { split: CohortSplit<{ points: GpaPoint[] }> }) {
  const [mode, setMode] = useState<CohortMode>("all");
  const points = split.all.points;
  const byCohort = cohortGpaLines(split);
  return <Card id="rp-gpa" title="Điểm trung bình theo học kỳ" className="rp-span-2"
    sub="Trung bình các dòng tổng kết in trên bảng điểm (hệ 4). Điểm học kỳ tính cả môn chưa đạt, điểm tích lũy chỉ tính môn đã đạt."
    actions={<ModeSwitch value={mode} onChange={setMode} label="điểm trung bình theo học kỳ" />}>
    {mode === "all" ? <>
      <Legend items={[["GPA TB tích lũy", SERIES_COLORS.cumulative], ["GPA TB học kỳ", SERIES_COLORS.term]]} />
      <LineChart terms={points.map((point) => point.term)} label="GPA trung bình theo học kỳ, toàn khóa" emptyText={EMPTY_SCOPE}
        series={[{ key: "cum", label: "Tích lũy", color: SERIES_COLORS.cumulative, values: points.map((point) => point.cumulativeGpa), area: true },
          { key: "term", label: "Học kỳ", color: SERIES_COLORS.term, values: points.map((point) => point.termGpa) }]}
        columnTip={(index) => gpaColumnTip(points, index)} />
    </> : <>
      <Legend items={byCohort.series.map((line) => [line.label, line.color] as const)} label="Khóa" />
      <LineChart terms={byCohort.terms} series={byCohort.series} label="GPA trung bình tích lũy theo học kỳ của từng khóa" emptyText={EMPTY_SCOPE}
        columnTip={(index) => `${termLabel(byCohort.terms[index])} · GPA TB tích lũy\n${byCohort.series.filter((line) => line.values[index] !== null).map((line) => `${line.label}: ${gpaText(line.values[index])}`).join("\n") || "Chưa có khóa nào có điểm"}`} />
    </>}
  </Card>;
}

function BandSection({ split }: { split: CohortSplit<GpaBands> }) {
  const [mode, setMode] = useState<CohortMode>("all");
  const parts = bandParts(split.all);
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const max = Math.max(1, ...parts.map((part) => part.value));
  return <Card id="rp-bands" title="Xếp loại học lực" sub={`Theo GPA tích lũy hệ 4 của ${countText(total)} sinh viên.`} actions={<ModeSwitch value={mode} onChange={setMode} label="xếp loại học lực" />}>
    {total === 0 ? <p className="rp-empty">{EMPTY_SCOPE}</p> : mode === "all" ? <>
      <ul className="rp-bandlist">{parts.map((part) => <li key={part.label} data-tip={`${part.label} (GPA ${part.range}): ${countText(part.value)} sinh viên · ${percent(part.value, total)}%`} tabIndex={0}>
        <span className="rp-band-label">{part.label}<small>{part.range}</small></span><span className="rp-band-track"><i style={{ width: `${(part.value / max) * 100}%`, background: part.color }} /></span>
        <b>{countText(part.value)}</b><small>{percent(part.value, total)}%</small></li>)}</ul>
      <div className="rp-facts"><div><b>{percent(parts.slice(0, 3).reduce((sum, part) => sum + part.value, 0), total)}%</b><span>từ Khá trở lên</span></div><div><b>{percent(parts[4]!.value, total)}%</b><span>GPA dưới 2,00</span></div></div>
    </> : <>
      <Legend items={parts.map((part) => [part.label, part.color] as const)} label="Xếp loại" />
      <ShareBars label="Xếp loại học lực theo từng khóa" rows={split.byCohort.map((cohort) => ({ key: cohort.cohort, label: cohort.cohort, parts: bandParts(cohort) }))} />
    </>}
  </Card>;
}

function sortAverages(rows: readonly AverageRow[], sort: TableSort) {
  const rules: Record<string, SortRule<AverageRow>> = {
    label: { value: (row) => row.label }, students: { value: (row) => row.students, by: "number" }, gpa: { value: (row) => row.gpa, by: "number" },
    lastTermGpa: { value: (row) => row.lastTermGpa, by: "number" }, credits: { value: (row) => row.credits, by: "number" }, below2: { value: (row) => row.below2, by: "number" },
    competency: { value: (row) => row.competency, by: "number" }, fit: { value: (row) => row.fit, by: "number" },
  };
  return sortRows(rows, rules, sort).map((item) => item.row);
}

/** Bảng điểm trung bình: rows by cohort, major or specialty, and "Toàn khóa" (the whole scope) as the last row. */
export function AveragesTable({ table }: { table: AverageTable }) {
  const { sort, sortHeader } = useTableSort();
  const head = table.by === "cohort" ? "Khóa" : table.by === "major" ? "Ngành" : "Chuyên ngành";
  const row = (item: AverageRow, footer = false) => <tr key={`${footer ? "all" : item.key}`} className={footer ? "rp-foot" : undefined}>
    <th scope="row">{footer ? "Toàn khóa" : item.label}</th><td className="rp-num">{countText(item.students)}</td>
    <td><span className="rp-cell-bar"><span className="rp-meter"><i style={{ width: `${((item.gpa ?? 0) / 4) * 100}%` }} /></span>{gpaText(item.gpa)}</span></td>
    <td className="rp-num">{gpaText(item.lastTermGpa)}</td><td className="rp-num">{item.credits === null ? "—" : countText(Math.round(item.credits))}</td>
    <td className="rp-num">{countText(item.below2)} <small>({percent(item.below2, item.students)}%)</small></td>
    <td>{scoreOrDash(item.competency)} <Word word={item.competencyLevel} /></td><td>{scoreOrDash(item.fit)} <Word word={item.fitLabel} /></td>
  </tr>;
  return <div className="rp-table-wrap" tabIndex={0} role="region" aria-label={`Bảng điểm trung bình theo ${head.toLowerCase()}`}><table className="rp-table">
    <thead><tr>{sortHeader(head, "label")}{sortHeader("Sinh viên", "students", "rp-num")}{sortHeader("GPA TB tích lũy", "gpa")}{sortHeader("GPA TB học kỳ gần nhất", "lastTermGpa", "rp-num")}
      {sortHeader("Tín chỉ TB đã đạt", "credits", "rp-num")}{sortHeader("GPA dưới 2,00", "below2", "rp-num")}{sortHeader("Thành thạo kỹ năng TB", "competency")}{sortHeader("Phù hợp nghề TB", "fit")}</tr></thead>
    <tbody>{table.rows.length ? sortAverages(table.rows, sort).map((item) => row(item)) : <tr><td colSpan={8} className="rp-empty">{EMPTY_SCOPE}</td></tr>}</tbody>
    {table.rows.length > 0 && <tfoot>{row(table.all, true)}</tfoot>}
  </table></div>;
}

function AveragesSection({ tables }: { tables: AverageTable[] }) {
  const [by, setBy] = useState<AverageTable["by"]>("cohort");
  const table = tables.find((item) => item.by === by) ?? tables[0];
  return <Card id="rp-averages" title="Bảng điểm trung bình" className="rp-span-3" sub="Mỗi dòng là trung bình của sinh viên đã tải bảng điểm trong nhóm; dòng cuối là Toàn khóa."
    actions={<Segmented label="Nhóm theo" value={by} onChange={setBy} options={[{ value: "cohort", label: "Từng khóa" }, { value: "major", label: "Theo ngành" }, { value: "specialty", label: "Theo chuyên ngành" }]} />}>
    {table ? <AveragesTable key={table.by} table={table} /> : <p className="rp-empty">{EMPTY_SCOPE}</p>}
  </Card>;
}

const SkillRank = ({ items, title }: { items: SkillAverage[]; title: string }) => <div><h3>{title}</h3>{items.length ? <ol className="rp-rank">{items.map((item) =>
  <li key={item.name} data-tip={`${item.name}${item.group ? ` (${item.group})` : ""}: ${scoreOrDash(item.score)} / 100 · ${countText(item.students)} sinh viên có điểm`} tabIndex={0}>
    <span>{item.name}</span><b>{scoreOrDash(item.score)}</b><span className="rp-meter rp-meter-full"><i style={{ width: `${item.score}%`, background: SERIES_COLORS.teal }} /></span></li>)}</ol> : <p className="rp-empty">Chưa có kỹ năng có điểm.</p>}</div>;

function CompetencySection({ split, kpis }: { split: CohortSplit<CompetencyGroups>; kpis: CohortSplit<DashboardKpis> }) {
  const [mode, setMode] = useState<CohortMode>("all");
  const groups = split.all.groups;
  const assessed = groups.reduce((max, group) => Math.max(max, group.students), 0);
  return <Card id="rp-competency" title="Độ thành thạo kỹ năng trung bình" sub="Theo nhóm năng lực, từ lần Đánh giá năng lực mới nhất. Vạch: ngưỡng Khá (62,5) và Giỏi (80)."
    actions={<ModeSwitch value={mode} onChange={setMode} label="độ thành thạo kỹ năng" />}>
    {assessed === 0 && !split.all.lowest.length ? <p className="rp-empty">{EMPTY_ASSESSED}</p> : <>
      {mode === "all" ? <div className="rp-gauges">{groups.map((group) => <div key={group.name} className="rp-gauge-box" data-tip={`${group.name}: ${scoreOrDash(group.score)} / 100 · ${countText(group.students)} sinh viên`} tabIndex={0}>
        <Gauge value={group.score} ticks label={group.name} /><b>{group.name}</b><Word word={group.level} /></div>)}</div>
        : <div className="rp-table-wrap" tabIndex={0} role="region" aria-label="Độ thành thạo theo nhóm năng lực của từng khóa"><table className="rp-table">
          <thead><tr><th scope="col">Khóa</th>{groups.map((group) => <th key={group.name} scope="col">{group.name}</th>)}<th scope="col">Năng lực chung</th></tr></thead>
          <tbody>{split.byCohort.map((cohort) => {
            const overall = kpis.byCohort.find((item) => item.cohort === cohort.cohort);
            return <tr key={cohort.cohort}><th scope="row">{cohort.cohort}</th>{groups.map((group) => { const match = cohort.groups.find((item) => item.name === group.name); return <td key={group.name}>{scoreOrDash(match?.score)} <Word word={match?.level} /></td>; })}
              <td>{scoreOrDash(overall?.competency)} <Word word={overall?.competencyLevel} /></td></tr>;
          })}</tbody>
          <tfoot><tr className="rp-foot"><th scope="row">Toàn khóa</th>{groups.map((group) => <td key={group.name}>{scoreOrDash(group.score)} <Word word={group.level} /></td>)}<td>{scoreOrDash(kpis.all.competency)} <Word word={kpis.all.competencyLevel} /></td></tr></tfoot>
        </table></div>}
      <div className="rp-ranks"><SkillRank title="Thấp nhất (toàn khóa)" items={split.all.lowest} /><SkillRank title="Cao nhất (toàn khóa)" items={split.all.highest} /></div>
    </>}
  </Card>;
}

function FitSection({ split, navigate }: { split: CohortSplit<FitSummary>; navigate: (path: string) => void }) {
  const [mode, setMode] = useState<CohortMode>("all");
  const parts = fitParts(split.all);
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const careers = [...split.all.careers].sort((a, b) => b.students - a.students).slice(0, 5);
  return <Card id="rp-fit" title="Độ phù hợp với nghề mục tiêu" sub={`${countText(total)} sinh viên đã chọn nghề; kỹ năng chưa có điểm tính 0.`}
    actions={<><ModeSwitch value={mode} onChange={setMode} label="độ phù hợp với nghề" /><button type="button" className="rp-link" onClick={() => navigate(REPORT_PATHS.careers)}>Nghề mục tiêu</button></>}>
    {total === 0 ? <p className="rp-empty">{EMPTY_ASSESSED}</p> : mode === "all" ? <>
      <div className="rp-donut-wrap"><Donut parts={parts} center={scoreOrDash(split.all.average)} sub="điểm TB" label="Mức phù hợp với nghề, toàn khóa" />
        <ul className="rp-donut-legend">{parts.map((part) => <li key={part.label}><i style={{ background: part.color }} aria-hidden="true" /><span>{part.label}</span><b>{countText(part.value)}</b><small>{percent(part.value, total)}%</small></li>)}</ul></div>
      {careers.length > 0 && <ul className="rp-career-list">{careers.map((career) => <li key={career.name} data-tip={`${career.name}: ${countText(career.students)} sinh viên, điểm phù hợp TB ${scoreOrDash(career.average)}`} tabIndex={0}>
        <span>{career.name} <small>{countText(career.students)} SV</small></span><span className="rp-meter"><i style={{ width: `${career.average ?? 0}%` }} /></span><b>{scoreOrDash(career.average)}</b></li>)}</ul>}
    </> : <>
      <Legend items={parts.map((part) => [part.label, part.color] as const)} label="Mức phù hợp" />
      <ShareBars label="Mức phù hợp với nghề theo từng khóa" rows={split.byCohort.map((cohort) => ({ key: cohort.cohort, label: cohort.cohort, sub: `TB ${scoreOrDash(cohort.average)}${cohort.label ? ` · ${cohort.label}` : ""}`, parts: fitParts(cohort) }))} />
    </>}
  </Card>;
}

function ProgressSection({ split, navigate }: { split: CohortSplit<ProgressCounts>; navigate: (path: string) => void }) {
  const [mode, setMode] = useState<CohortMode>("all");
  const legend = progressParts(split.all).map((part) => [part.label, part.color] as const);
  return <Card id="rp-progress" title="Tiến độ học tập" className="rp-span-3" sub="Mỗi sinh viên một trạng thái, tính giống trang Tổng quan của sinh viên."
    actions={<><ModeSwitch value={mode} onChange={setMode} label="tiến độ học tập" /><button type="button" className="rp-link" onClick={() => navigate(REPORT_PATHS.progress)}>Xem báo cáo tiến độ</button></>}>
    <Legend items={legend} label="Tình trạng" />
    <ShareBars label={mode === "all" ? "Tiến độ học tập toàn khóa" : "Tiến độ học tập theo từng khóa"}
      rows={mode === "all" ? [{ key: "all", label: "Toàn khóa", parts: progressParts(split.all) }] : split.byCohort.map((cohort) => ({ key: cohort.cohort, label: cohort.cohort, parts: progressParts(cohort) }))} />
  </Card>;
}

export function DashboardView({ data, navigate }: { data: DashboardReport; navigate: (path: string) => void }) {
  return <div className="rp-stack">
    <Coverage head={data} />
    <KpiSection data={data} />
    <div className="rp-grid">
      <GpaSection split={data.gpaByTerm} />
      <BandSection split={data.gpaBands} />
      <AveragesSection tables={data.averages} />
    </div>
    <div className="rp-grid rp-grid-halves">
      <CompetencySection split={data.competencyGroups} kpis={data.kpis} />
      <FitSection split={data.fit} navigate={navigate} />
    </div>
    <ProgressSection split={data.progress} navigate={navigate} />
  </div>;
}

/** "Thao tác gần đây": the latest 20 log entries in a side panel, with the way to the whole log. */
function AuditDrawer({ onClose, navigate }: { onClose: () => void; navigate: (path: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open && typeof element.showModal === "function") element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  const state = useReport<AuditPage>(`${AUDIT_API}?page=1&pageSize=20`);
  return <dialog ref={dialog} className="rp-drawer" aria-labelledby="rp-drawer-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
    <header><div><h2 id="rp-drawer-title">Thao tác gần đây</h2><p>20 thao tác mới nhất trong Nhật ký thao tác.</p></div><button type="button" className="rp-icon-btn" aria-label="Đóng" onClick={onClose}><Icon name="close" /></button></header>
    <div className="rp-drawer-body">{state.data ? (state.data.items.length ? <ol className="rp-log">{state.data.items.map((entry) => <li key={entry.id}>
      <span className="rp-log-head"><b>{entry.action}</b><Chip tone={entry.kind === "access" ? meaningClass("warn") : entry.kind === "report" ? "rp-chip-blue" : meaningClass("none")}>{AUDIT_TEXT[entry.kind] ?? entry.kind}</Chip></span>
      <span>{entry.summary}</span><small>{entry.actorName}{entry.actorRole ? ` · ${entry.actorRole}` : ""} · {updatedText(entry.at)}</small></li>)}</ol>
      : <p className="rp-empty">Chưa có thao tác nào được ghi.</p>) : state.error ? <p className="admin-error" role="alert">{state.error}</p> : <p className="rp-empty" role="status">Đang tải…</p>}</div>
    <footer><button type="button" className="rp-btn" onClick={() => { onClose(); navigate(REPORT_PATHS.audit); }}>Mở Nhật ký thao tác</button></footer>
  </dialog>;
}

function DashboardPage({ filters, studyTerm, navigate, bar }: { filters: ReportFilterState; studyTerm: ReportTerm | null; navigate: (path: string) => void; bar: ReactNode }) {
  const state = useReport<DashboardReport>(reportUrl("/dashboard", filters));
  const [log, setLog] = useState(false);
  return <>
    <Intro view="dashboard" head={state.data} studyTerm={studyTerm} actions={<button type="button" className="rp-small-btn" onClick={() => setLog(true)}><Icon name="clock" />Thao tác gần đây</button>} />
    {bar}
    <Loading state={state}>{(data) => <DashboardView data={data} navigate={navigate} />}</Loading>
    {log && <AuditDrawer onClose={() => setLog(false)} navigate={navigate} />}
  </>;
}

/* ------------------------------------------------------------------ AD-REPORT-02/03 Tiến độ */

function CreditsCell({ student }: { student: ProgressStudent }) {
  if (student.passedCredits === null || !student.totalCredits) return <>—</>;
  const late = student.status === "late";
  return <span className="rp-credit" data-tip={`${countText(student.passedCredits)} TC đã đạt / ${countText(student.totalCredits)} TC của CTĐT${student.expectedCredits !== null ? `\nKế hoạch đến hết học kỳ trước: ${countText(student.expectedCredits)} TC` : ""}`} tabIndex={0}>
    <span className="rp-meter"><i className={late ? "rp-late" : undefined} style={{ width: `${Math.min(100, (student.passedCredits / student.totalCredits) * 100)}%` }} />
      {student.expectedCredits !== null && <s style={{ left: `${Math.min(100, (student.expectedCredits / student.totalCredits) * 100)}%` }} />}</span>
    <small>{countText(student.passedCredits)}/{countText(student.totalCredits)}{student.expectedCredits !== null ? ` · kế hoạch ${countText(student.expectedCredits)}` : ""}</small>
  </span>;
}

export function ProgressView({ data, status, setStatus, page, setPage, sortHeader, exportUrl, navigate }: {
  data: ProgressReport; status: "all" | ProgressStatus; setStatus: (status: "all" | ProgressStatus) => void; page: number; setPage: (page: number) => void;
  sortHeader: (label: ReactNode, column: string, className?: string) => ReactNode; exportUrl: string; navigate: (path: string) => void;
}) {
  const [mode, setMode] = useState<CohortMode>("all");
  const counts = data.counts.all;
  return <div className="rp-stack">
    <Coverage head={data} />
    <Card id="rp-progress-summary" title="Tình trạng tiến độ" sub="Đúng tiến độ hay trễ so với kế hoạch đào tạo của khóa, như trang Tổng quan của sinh viên." actions={<ModeSwitch value={mode} onChange={setMode} label="tình trạng tiến độ" />}>
      <Legend items={progressParts(counts).map((part) => [part.label, part.color] as const)} label="Tình trạng" />
      <ShareBars label={mode === "all" ? "Tình trạng tiến độ toàn khóa" : "Tình trạng tiến độ theo từng khóa"}
        rows={mode === "all" ? [{ key: "all", label: "Toàn khóa", parts: progressParts(counts) }] : data.counts.byCohort.map((cohort) => ({ key: cohort.cohort, label: cohort.cohort, parts: progressParts(cohort) }))} />
    </Card>
    <section className="rp-card" aria-labelledby="rp-progress-list">
      <div className="rp-card-head"><div><h2 id="rp-progress-list">Danh sách sinh viên</h2><p>Vạch đen trên thanh là số tín chỉ kế hoạch đào tạo đặt ra đến hết học kỳ trước.</p></div>
        <div className="rp-card-actions"><ExportButton url={exportUrl} fallbackName="bao-cao-tien-do.xlsx" /></div></div>
      <Segmented label="Tình trạng" value={status} onChange={setStatus} options={[{ value: "all", label: "Tất cả", count: counts.total }, { value: "on_track", label: "Đúng tiến độ", count: counts.onTrack },
        { value: "late", label: "Trễ kế hoạch", count: counts.late }, { value: "unknown", label: "Chưa đủ dữ liệu", count: counts.unknown }, { value: "no_transcript", label: "Chưa có bảng điểm", count: counts.noTranscript }]} />
      <div className="rp-table-wrap" tabIndex={0} role="region" aria-label="Danh sách sinh viên theo tiến độ"><table className="rp-table">
        <thead><tr><th scope="col" className="rp-num">STT</th>{sortHeader("Sinh viên", "name")}{sortHeader("Khóa", "cohort")}{sortHeader("Chuyên ngành", "specialty")}{sortHeader("Tín chỉ đã đạt", "credits")}{sortHeader("GPA tích lũy", "gpa", "rp-num")}{sortHeader("Tình trạng", "status")}<th scope="col">Thao tác</th></tr></thead>
        <tbody>{data.page.items.length ? data.page.items.map((student, index) => <tr key={student.userId}>
          <td className="rp-num">{countText((data.page.page - 1) * data.page.pageSize + index + 1)}</td><td><Student name={student.name} code={student.studentCode} /></td>
          <td>{student.cohort ?? "—"}</td><td>{student.specialtyName ?? "Chưa xác định"}</td><td><CreditsCell student={student} /></td><td className="rp-num">{gpaText(student.gpa)}</td>
          <td><span className="rp-chips"><Chip tone={STATUS_TEXT[student.status].tone}>{STATUS_TEXT[student.status].label}</Chip>{student.risk && <Chip tone={LEVEL_TEXT[student.risk].tone}>{LEVEL_TEXT[student.risk].label}</Chip>}</span></td>
          <td><ProfileLink userId={student.userId} name={student.name} navigate={navigate} /></td>
        </tr>) : <tr><td colSpan={8} className="rp-empty">Không có sinh viên phù hợp với bộ lọc.</td></tr>}</tbody>
      </table></div>
      <Pagination total={data.page.total} page={page} setPage={setPage} />
    </section>
  </div>;
}

function ProgressPage({ filters, studyTerm, bar, navigate }: { filters: ReportFilterState; studyTerm: ReportTerm | null; bar: ReactNode; navigate: (path: string) => void }) {
  const [status, setStatus] = useState<"all" | ProgressStatus>("all");
  const [page, setPage] = usePageFor(`${filtersToSearch(filters)}|${status}`);
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  const query = { status: status === "all" ? null : status, ...sortQuery(sort) };
  const state = useReport<ProgressReport>(reportUrl("/progress", filters, { ...query, page, pageSize: 10 }));
  return <>
    <Intro view="progress" head={state.data} studyTerm={studyTerm} />
    {bar}
    <Loading state={state}>{(data) => <ProgressView data={data} status={status} setStatus={setStatus} page={page} setPage={setPage} sortHeader={sortHeader} exportUrl={reportUrl("/progress.xlsx", filters, query)} navigate={navigate} />}</Loading>
  </>;
}

/* ------------------------------------------------------------------ AD-REPORT-04/05 Nguy cơ */

export function RiskView({ data, level, setLevel, page, setPage, sortHeader, exportUrl, navigate }: {
  data: RiskReport; level: "all" | "risk" | "warn"; setLevel: (level: "all" | "risk" | "warn") => void; page: number; setPage: (page: number) => void;
  sortHeader: (label: ReactNode, column: string, className?: string) => ReactNode; exportUrl: string; navigate: (path: string) => void;
}) {
  const [mode, setMode] = useState<CohortMode>("all");
  const kinds = (items: { kind: RiskKind; label: string; students: number }[]) => RISK_ORDER.map((kind) => items.find((item) => item.kind === kind) ?? { kind, label: RISK_TEXT[kind], students: 0 });
  const isWarn = (kind: RiskKind) => kind === "late_course" || kind === "elective_short";
  const reasonRows: BarRow[] = kinds(data.reasons.all.items).map((item) => ({ key: item.kind, label: item.label || RISK_TEXT[item.kind], parts: [{ label: item.label || RISK_TEXT[item.kind], value: item.students, color: isWarn(item.kind) ? STATUS_COLORS.warn : STATUS_COLORS.bad }] }));
  const matrix: MatrixRow[] = kinds(data.reasons.all.items).map((item) => {
    const values: Record<string, number> = {};
    for (const cohort of data.reasons.byCohort) values[cohort.cohort] = cohort.items.find((other) => other.kind === item.kind)?.students ?? 0;
    return { key: item.kind, label: item.label || RISK_TEXT[item.kind], values, total: item.students };
  });
  const counts = data.counts.all;
  return <div className="rp-stack">
    <Coverage head={data} />
    <Card id="rp-risk-reasons" title="Lý do" sub="Một sinh viên có thể có nhiều lý do. Nguy cơ: môn bắt buộc chưa đạt (F, VT, CT), không kịp tín chỉ, GPA dưới ngưỡng. Cần chú ý: trễ môn so với KHĐT, thiếu tín chỉ tự chọn."
      actions={<ModeSwitch value={mode} onChange={setMode} label="lý do cần chú ý" />}>
      {mode === "all" ? <><Legend items={[["Nguy cơ", STATUS_COLORS.bad], ["Cần chú ý", STATUS_COLORS.warn]]} label="Mức" /><HBarList rows={reasonRows} label="Số sinh viên theo lý do, toàn khóa" labelWidth={200} /></>
        : <CohortMatrix rows={matrix} cohorts={cohortsOf(data.reasons)} label="Số sinh viên theo lý do và từng khóa" rowHeader="Lý do" />}
    </Card>
    <section className="rp-card" aria-labelledby="rp-risk-list">
      <div className="rp-card-head"><div><h2 id="rp-risk-list">Danh sách sinh viên cần chú ý</h2><p>Sinh viên chưa tải bảng điểm không có trong danh sách này; xem ở báo cáo Tiến độ.</p></div>
        <div className="rp-card-actions"><ExportButton url={exportUrl} fallbackName="sinh-vien-co-nguy-co.xlsx" /></div></div>
      <Segmented label="Mức" value={level} onChange={setLevel} options={[{ value: "all", label: "Tất cả", count: counts.total }, { value: "risk", label: "Nguy cơ", count: counts.risk }, { value: "warn", label: "Cần chú ý", count: counts.warn }]} />
      <div className="rp-table-wrap" tabIndex={0} role="region" aria-label="Danh sách sinh viên cần chú ý"><table className="rp-table">
        <thead><tr><th scope="col" className="rp-num">STT</th>{sortHeader("Sinh viên", "name")}{sortHeader("Khóa", "cohort")}{sortHeader("Mức", "level")}<th scope="col">Lý do</th>{sortHeader("GPA", "gpa", "rp-num")}<th scope="col">Thao tác</th></tr></thead>
        <tbody>{data.page.items.length ? data.page.items.map((student: RiskStudent, index) => <tr key={student.userId}>
          <td className="rp-num">{countText((data.page.page - 1) * data.page.pageSize + index + 1)}</td><td><Student name={student.name} code={student.studentCode} /></td>
          <td>{student.cohort ?? "—"}<small className="rp-sub">{student.specialtyName ?? ""}</small></td><td><Chip tone={LEVEL_TEXT[student.level].tone}>{LEVEL_TEXT[student.level].label}</Chip></td>
          <td><span className="rp-chips">{student.reasons.map((reason, reasonIndex) => <Chip key={reasonIndex} tone={LEVEL_TEXT[reason.level].tone}>{reason.text}</Chip>)}</span></td><td className="rp-num">{gpaText(student.gpa)}</td>
          <td><ProfileLink userId={student.userId} name={student.name} navigate={navigate} /></td>
        </tr>) : <tr><td colSpan={7} className="rp-empty">Không có sinh viên cần chú ý trong phạm vi lọc.</td></tr>}</tbody>
      </table></div>
      <Pagination total={data.page.total} page={page} setPage={setPage} />
    </section>
  </div>;
}

function RiskPage({ filters, studyTerm, bar, navigate }: { filters: ReportFilterState; studyTerm: ReportTerm | null; bar: ReactNode; navigate: (path: string) => void }) {
  const [level, setLevel] = useState<"all" | "risk" | "warn">("all");
  const [page, setPage] = usePageFor(`${filtersToSearch(filters)}|${level}`);
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  const query = { level: level === "all" ? null : level, ...sortQuery(sort) };
  const state = useReport<RiskReport>(reportUrl("/risk", filters, { ...query, page, pageSize: 10 }));
  return <>
    <Intro view="risk" head={state.data} studyTerm={studyTerm} />
    {bar}
    <Loading state={state}>{(data) => <RiskView data={data} level={level} setLevel={setLevel} page={page} setPage={setPage} sortHeader={sortHeader} exportUrl={reportUrl("/risk.xlsx", filters, query)} navigate={navigate} />}</Loading>
  </>;
}

/* ------------------------------------------------------------------ AD-REPORT-06/07 Kỹ năng còn thiếu */

const gapParts = (row: SkillGapRow): BarPart[] => [
  { label: GAP_TEXT.below.label, value: row.below, color: GAP_TEXT.below.color },
  { label: GAP_TEXT.not_studied.label, value: row.notStudied, color: GAP_TEXT.not_studied.color },
  { label: GAP_TEXT.self_study.label, value: row.selfStudy, color: GAP_TEXT.self_study.color },
  { label: GAP_TEXT.no_data.label, value: row.noData, color: GAP_TEXT.no_data.color },
];

function SkillStudentsTable({ data, navigate }: { data: SkillStudents; navigate: (path: string) => void }) {
  const { sort, sortHeader } = useTableSort();
  const rules: Record<string, SortRule<SkillStudents["items"][number]>> = {
    name: { value: (row) => row.name, by: "name" }, cohort: { value: (row) => row.cohort }, career: { value: (row) => row.careerName },
    status: { value: (row) => row.status, order: ["below", "not_studied", "self_study", "no_data"] }, fit: { value: (row) => row.fitScore, by: "number" },
  };
  return <div className="rp-table-wrap" tabIndex={0} role="region" aria-label={`Sinh viên còn thiếu ${data.skill}`}><table className="rp-table">
    <thead><tr>{sortHeader("Sinh viên", "name")}{sortHeader("Khóa", "cohort")}{sortHeader("Nghề mục tiêu", "career")}{sortHeader("Tình trạng kỹ năng", "status")}{sortHeader("Điểm phù hợp", "fit")}<th scope="col">Thao tác</th></tr></thead>
    <tbody>{data.items.length ? sortRows(data.items, rules, sort).map(({ row }) => <tr key={row.userId}>
      <td><Student name={row.name} code={row.studentCode} /></td><td>{row.cohort ?? "—"}</td><td>{row.careerName ?? "—"}</td>
      <td><Chip tone={GAP_TEXT[row.status].tone}>{GAP_TEXT[row.status].label}</Chip></td><td>{scoreOrDash(row.fitScore)} <Word word={row.fitLabel} /></td><td><ProfileLink userId={row.userId} name={row.name} navigate={navigate} /></td>
    </tr>) : <tr><td colSpan={6} className="rp-empty">Không có sinh viên nào còn thiếu kỹ năng này trong phạm vi lọc.</td></tr>}</tbody>
  </table></div>;
}

export function SkillsView({ data, career, setCareer, selected, setSelected, students, exportUrl, navigate }: {
  data: SkillsReport; career: string; setCareer: (career: string) => void; selected: string | null; setSelected: (skill: string | null) => void;
  students: { data: SkillStudents | null; error: string | null; loading: boolean; retry: () => void } | null; exportUrl: string; navigate: (path: string) => void;
}) {
  const [mode, setMode] = useState<CohortMode>("all");
  const rows: BarRow[] = data.skills.all.items.map((item) => ({ key: item.name, label: item.name, parts: gapParts(item) }));
  const matrix = matrixRows(data.skills, (item) => item.name, (item) => item.name, (item) => item.total);
  const toggle = (skill: string) => setSelected(selected === skill ? null : skill);
  return <div className="rp-stack">
    <Coverage head={data} />
    <section className="rp-card" aria-labelledby="rp-skills-title">
      <div className="rp-card-head"><div><h2 id="rp-skills-title">12 kỹ năng thiếu nhiều nhất</h2><p>{countText(data.scope.assessed)} sinh viên đã đánh giá năng lực trong phạm vi lọc.</p></div>
        <div className="rp-card-actions"><label className="rp-field rp-field-inline">Nghề mục tiêu<select id="rp-career" value={career} onChange={(event) => setCareer(event.target.value)}><option value="">Mọi nghề</option>{data.careers.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <ModeSwitch value={mode} onChange={setMode} label="kỹ năng còn thiếu" /><ExportButton url={exportUrl} fallbackName="ky-nang-con-thieu.xlsx" /></div></div>
      {!rows.length ? <p className="rp-empty">{data.scope.assessed ? "Không có kỹ năng nào còn thiếu trong phạm vi lọc." : EMPTY_ASSESSED}</p> : mode === "all" ? <>
        <Legend items={(["below", "not_studied", "self_study", "no_data"] as const).map((status) => [GAP_TEXT[status].label, GAP_TEXT[status].color] as const)} label="Tình trạng kỹ năng" />
        <HBarList rows={rows} label="Số sinh viên còn thiếu mỗi kỹ năng, toàn khóa" onSelect={toggle} selected={selected} />
      </> : <CohortMatrix rows={matrix} cohorts={cohortsOf(data.skills)} label="Số sinh viên còn thiếu mỗi kỹ năng theo từng khóa" rowHeader="Kỹ năng" onSelect={toggle} selected={selected} />}
      {selected && <div className="rp-panel">
        <div className="rp-card-head"><div><h3>{selected}: sinh viên còn thiếu</h3></div><button type="button" className="rp-link" onClick={() => setSelected(null)}>Đóng</button></div>
        {students && <Loading state={students}>{(list) => <SkillStudentsTable data={list} navigate={navigate} />}</Loading>}
      </div>}
    </section>
  </div>;
}

function SkillsPage({ filters, studyTerm, bar, navigate }: { filters: ReportFilterState; studyTerm: ReportTerm | null; bar: ReactNode; navigate: (path: string) => void }) {
  const [career, setCareer] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [filters, career]);
  const state = useReport<SkillsReport>(reportUrl("/skills", filters, { career: career || null }));
  const students = useReport<SkillStudents>(selected ? reportUrl("/skills/students", filters, { skill: selected, career: career || null }) : null);
  return <>
    <Intro view="skills" head={state.data} studyTerm={studyTerm} />
    {bar}
    <Loading state={state}>{(data) => <SkillsView data={data} career={career} setCareer={setCareer} selected={selected} setSelected={setSelected} students={selected ? students : null}
      exportUrl={reportUrl("/skills.xlsx", filters, { career: career || null })} navigate={navigate} />}</Loading>
  </>;
}

/* ------------------------------------------------------------------ AD-REPORT-08 Nghề nghiệp mục tiêu */

export function CareersView({ data }: { data: CareersReport }) {
  const [mode, setMode] = useState<CohortMode>("all");
  const { sort, sortHeader } = useTableSort();
  const items = data.careers.all.items;
  const rules: Record<string, SortRule<CareerRow>> = { name: { value: (row) => row.name }, students: { value: (row) => row.students, by: "number" }, average: { value: (row) => row.average, by: "number" } };
  const levelParts = (row: CareerRow) => FIT_ORDER.map((label, index) => ({ label, value: row.levels.find((level) => level.label === label)?.students ?? 0, color: LEVEL_RAMP[index]! }));
  return <div className="rp-stack">
    <Coverage head={data} />
    <Card id="rp-careers-count" title={`${countText(items.reduce((sum, row) => sum + row.students, 0))} sinh viên đã chọn nghề`}
      sub={`${countText(data.withoutCareer)} sinh viên đã tải bảng điểm nhưng chưa đánh giá năng lực (chưa có nghề mục tiêu).`}
      actions={<ModeSwitch value={mode} onChange={setMode} label="nghề mục tiêu" />}>
      {!items.length ? <p className="rp-empty">{EMPTY_ASSESSED}</p> : mode === "all"
        ? <HBarList rows={items.map((row) => ({ key: row.name, label: row.name, parts: [{ label: "Sinh viên", value: row.students, color: SERIES_COLORS.blue }] }))} label="Số sinh viên chọn mỗi nghề, toàn khóa" labelWidth={260} />
        : <CohortMatrix rows={matrixRows(data.careers, (row) => row.name, (row) => row.name, (row) => row.students)} cohorts={cohortsOf(data.careers)} label="Số sinh viên chọn mỗi nghề theo từng khóa" rowHeader="Nghề" />}
    </Card>
    <Card id="rp-careers-fit" title="Mức phù hợp theo nghề" sub="Mức phù hợp hiện tại (toàn khóa); kỹ năng chưa có điểm tính 0, như trên trang của sinh viên.">
      <Legend items={FIT_ORDER.map((label, index) => [label, LEVEL_RAMP[index]!] as const)} label="Mức phù hợp" />
      <div className="rp-table-wrap" tabIndex={0} role="region" aria-label="Mức phù hợp theo nghề"><table className="rp-table">
        <thead><tr>{sortHeader("Nghề", "name")}{sortHeader("Số sinh viên", "students", "rp-num")}{sortHeader("Điểm phù hợp TB", "average")}<th scope="col">Phân bố mức phù hợp</th><th scope="col">Kỹ năng thiếu nhiều nhất</th></tr></thead>
        <tbody>{items.length ? sortRows(items, rules, sort).map(({ row }) => { const parts = levelParts(row); return <tr key={row.name}>
          <th scope="row">{row.name}</th><td className="rp-num">{countText(row.students)}</td><td>{scoreOrDash(row.average)} <Word word={row.average === null ? null : fitWord(row.average)} /></td>
          <td><span className="rp-dist" data-tip={parts.map((part) => `${part.label}: ${countText(part.value)}`).join("\n")} tabIndex={0}>{parts.filter((part) => part.value > 0).map((part) => <i key={part.label} style={{ flexGrow: part.value, background: part.color }} />)}</span></td>
          <td>{row.topGaps.length ? row.topGaps.map((gap) => `${gap.name} (${countText(gap.students)})`).join(", ") : "—"}</td>
        </tr>; }) : <tr><td colSpan={5} className="rp-empty">{EMPTY_ASSESSED}</td></tr>}</tbody>
      </table></div>
    </Card>
  </div>;
}
/** The fit word of a score (thresholds of the competency engine: 90, 80, 62,5, 50). */
export const fitWord = (score: number) => (score >= 90 ? "Rất phù hợp" : score >= 80 ? "Phù hợp" : score >= 62.5 ? "Trung bình" : score >= 50 ? "Ít phù hợp" : "Không phù hợp");

function CareersPage({ filters, studyTerm, bar }: { filters: ReportFilterState; studyTerm: ReportTerm | null; bar: ReactNode }) {
  const state = useReport<CareersReport>(reportUrl("/careers", filters));
  return <><Intro view="careers" head={state.data} studyTerm={studyTerm} />{bar}<Loading state={state}>{(data) => <CareersView data={data} />}</Loading></>;
}

/* ------------------------------------------------------------------ AD-REPORT-09 Môn học được đề xuất */

const howParts = (row: CourseRow): BarPart[] => [
  { label: HOW_TEXT.new.label, value: row.newStudents, color: HOW_TEXT.new.color },
  { label: HOW_TEXT.retake.label, value: row.retake, color: HOW_TEXT.retake.color },
  { label: HOW_TEXT.improve.label, value: row.improve, color: HOW_TEXT.improve.color },
];

function CourseStudentsTable({ data, navigate }: { data: CourseStudents; navigate: (path: string) => void }) {
  const { sort, sortHeader } = useTableSort();
  const rules: Record<string, SortRule<CourseStudents["items"][number]>> = {
    name: { value: (row) => row.name, by: "name" }, cohort: { value: (row) => row.cohort }, specialty: { value: (row) => row.specialtyName },
    how: { value: (row) => row.how, order: ["new", "retake", "improve"] }, gpa: { value: (row) => row.gpa, by: "number" },
  };
  return <div className="rp-table-wrap" tabIndex={0} role="region" aria-label={`Sinh viên được đề xuất ${data.name}`}><table className="rp-table">
    <thead><tr>{sortHeader("Sinh viên", "name")}{sortHeader("Khóa", "cohort")}{sortHeader("Chuyên ngành", "specialty")}{sortHeader("Cách học", "how")}{sortHeader("GPA tích lũy", "gpa", "rp-num")}<th scope="col">Thao tác</th></tr></thead>
    <tbody>{data.items.length ? sortRows(data.items, rules, sort).map(({ row }) => <tr key={`${row.userId}-${row.how}`}>
      <td><Student name={row.name} code={row.studentCode} /></td><td>{row.cohort ?? "—"}</td><td>{row.specialtyName ?? "Chưa xác định"}</td>
      <td><Chip tone={HOW_TEXT[row.how].tone}>{HOW_TEXT[row.how].label}</Chip></td><td className="rp-num">{gpaText(row.gpa)}</td><td><ProfileLink userId={row.userId} name={row.name} navigate={navigate} /></td>
    </tr>) : <tr><td colSpan={6} className="rp-empty">Không có sinh viên nào được đề xuất môn này trong phạm vi lọc.</td></tr>}</tbody>
  </table></div>;
}

export function CoursesView({ data, selected, setSelected, students, navigate }: {
  data: CoursesReport; selected: string | null; setSelected: (code: string | null) => void;
  students: { data: CourseStudents | null; error: string | null; loading: boolean; retry: () => void } | null; navigate: (path: string) => void;
}) {
  const [mode, setMode] = useState<CohortMode>("all");
  const items = data.courses.all.items;
  const label = (row: CourseRow) => `${row.name} (${row.code})`;
  const toggle = (code: string) => setSelected(selected === code ? null : code);
  const chosen = items.find((row) => row.code === selected);
  return <div className="rp-stack">
    <Coverage head={data} />
    <section className="rp-card" aria-labelledby="rp-courses-title">
      <div className="rp-card-head"><div><h2 id="rp-courses-title">{countText(items.length)} môn được AI đề xuất</h2><p>Đếm số sinh viên được đề xuất mỗi môn, theo cách học; {countText(data.withRoadmap)} sinh viên đã có Lộ trình AI.</p></div>
        <div className="rp-card-actions"><ModeSwitch value={mode} onChange={setMode} label="môn được đề xuất" /></div></div>
      {!items.length ? <p className="rp-empty">Chưa có môn nào được AI đề xuất trong phạm vi lọc.</p> : mode === "all" ? <>
        <Legend items={(["new", "retake", "improve"] as const).map((how) => [HOW_TEXT[how].label, HOW_TEXT[how].color] as const)} label="Cách học" />
        <HBarList rows={items.map((row) => ({ key: row.code, label: row.name, sub: row.code, parts: howParts(row) }))} label="Số sinh viên được đề xuất mỗi môn, toàn khóa" onSelect={toggle} selected={selected} labelWidth={240} />
      </> : <CohortMatrix rows={matrixRows(data.courses, (row) => row.code, label, (row) => row.total)} cohorts={cohortsOf(data.courses)} label="Số sinh viên được đề xuất mỗi môn theo từng khóa" rowHeader="Môn học" onSelect={toggle} selected={selected} />}
      {selected && <div className="rp-panel">
        <div className="rp-card-head"><div><h3>{chosen ? label(chosen) : selected}: sinh viên được đề xuất</h3></div><button type="button" className="rp-link" onClick={() => setSelected(null)}>Đóng</button></div>
        {students && <Loading state={students}>{(list) => <CourseStudentsTable data={list} navigate={navigate} />}</Loading>}
      </div>}
    </section>
  </div>;
}

function CoursesPage({ filters, studyTerm, bar, navigate }: { filters: ReportFilterState; studyTerm: ReportTerm | null; bar: ReactNode; navigate: (path: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [filters]);
  const state = useReport<CoursesReport>(reportUrl("/courses", filters));
  const students = useReport<CourseStudents>(selected ? reportUrl("/courses/students", filters, { code: selected }) : null);
  return <>
    <Intro view="courses" head={state.data} studyTerm={studyTerm} />
    {bar}
    <Loading state={state}>{(data) => <CoursesView data={data} selected={selected} setSelected={setSelected} students={selected ? students : null} navigate={navigate} />}</Loading>
  </>;
}

/* ------------------------------------------------------------------ AD-REPORT-11 Nhật ký thao tác */

export function AuditTable({ data, page, setPage, sortHeader }: { data: AuditPage; page: number; setPage: (page: number) => void; sortHeader: (label: ReactNode, column: string, className?: string) => ReactNode }) {
  return <>
    <div className="rp-table-wrap" tabIndex={0} role="region" aria-label="Nhật ký thao tác"><table className="rp-table">
      <thead><tr>{sortHeader("Thời gian", "at")}{sortHeader("Người thực hiện", "actor")}{sortHeader("Loại", "kind")}<th scope="col">Thao tác</th><th scope="col">Nội dung</th></tr></thead>
      <tbody>{data.items.length ? data.items.map((entry: AuditEntry) => <tr key={entry.id}>
        <td className="rp-time">{updatedText(entry.at)}</td><td><span className="rp-who"><b>{entry.actorName}</b><small>{entry.actorRole ?? ""}</small></span></td>
        <td><Chip tone={entry.kind === "access" ? meaningClass("warn") : entry.kind === "report" ? "rp-chip-blue" : meaningClass("none")}>{AUDIT_TEXT[entry.kind] ?? entry.kind}</Chip></td>
        <td>{entry.action}</td><td>{entry.summary}</td>
      </tr>) : <tr><td colSpan={5} className="rp-empty">Không có thao tác phù hợp.</td></tr>}</tbody>
    </table></div>
    <Pagination total={data.total} page={page} setPage={setPage} />
  </>;
}

function AuditLogPage() {
  const [draft, setDraft] = useState("");
  const q = useDebounced(draft).trim();
  const [actor, setActor] = useState("");
  const [kind, setKind] = useState<"" | AuditKind>("");
  const [actors, setActors] = useState<string[]>([]);
  const [page, setPage] = usePageFor(`${q}|${actor}|${kind}`);
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  const params = new URLSearchParams({ page: String(page), pageSize: "10" });
  if (q) params.set("q", q);
  if (actor) params.set("actor", actor);
  if (kind) params.set("kind", kind);
  if (sort) { params.set("sort", sort.key); params.set("dir", sort.direction); }
  const state = useReport<AuditPage>(`${AUDIT_API}?${params}`);
  useEffect(() => { if (state.data?.actors.length) setActors(state.data.actors); }, [state.data]);
  return <>
    <Intro view="audit" head={null} studyTerm={null} actions={<span className="rp-pill">Lưu <b>1 năm</b></span>} />
    <section className="rp-card" aria-labelledby="rp-audit-title">
      <div className="rp-card-head"><div><h2 id="rp-audit-title">Nhật ký thao tác {state.data && <span className="rp-count">{countText(state.data.total)}</span>}</h2><p>Lịch sử đăng nhập vẫn ở Tài khoản.</p></div></div>
      <form className="rp-filters rp-filters-inline" role="search" aria-label="Tìm trong nhật ký" onSubmit={(event) => event.preventDefault()}>
        <label className="rp-field rp-field-search">Tìm trong nhật ký<span className="rp-search"><Icon name="search" /><input id="rp-audit-q" type="search" value={draft} maxLength={120} placeholder="Người thực hiện, thao tác, nội dung" onChange={(event) => setDraft(event.target.value)} /></span></label>
        <label className="rp-field">Người thực hiện<select id="rp-audit-actor" value={actor} onChange={(event) => setActor(event.target.value)}><option value="">Tất cả</option>{actors.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="rp-field">Loại thao tác<select id="rp-audit-kind" value={kind} onChange={(event) => setKind(event.target.value as "" | AuditKind)}><option value="">Tất cả</option>{(Object.keys(AUDIT_TEXT) as AuditKind[]).map((value) => <option key={value} value={value}>{AUDIT_TEXT[value]}</option>)}</select></label>
        <button type="button" className="rp-reset" disabled={!draft && !actor && !kind} onClick={() => { setDraft(""); setActor(""); setKind(""); }}>Xóa bộ lọc</button>
      </form>
      <Loading state={state}>{(data) => <AuditTable data={data} page={page} setPage={setPage} sortHeader={sortHeader} />}</Loading>
    </section>
  </>;
}

/* ------------------------------------------------------------------ the page */

/** Every report page: the shared filter bar (not on Nhật ký) and the report of `path`. */
export default function AdminReports({ path, navigate }: { path: string; navigate: (path: string) => void }) {
  const view = reportViewOf(path) ?? "dashboard";
  const [filters, setFilters] = useReportFilters();
  const options = useReport<ReportOptions>(`${REPORTS_API}/options`);
  const studyTerm = options.data?.studyTerm ?? null;
  const bar = <FilterBar filters={filters} setFilters={setFilters} options={options.data} />;
  return <div className="rp">
    <TooltipLayer root="rp" />
    {view === "dashboard" ? <DashboardPage filters={filters} studyTerm={studyTerm} navigate={navigate} bar={bar} />
      : view === "progress" ? <ProgressPage filters={filters} studyTerm={studyTerm} bar={bar} navigate={navigate} />
        : view === "risk" ? <RiskPage filters={filters} studyTerm={studyTerm} bar={bar} navigate={navigate} />
          : view === "skills" ? <SkillsPage filters={filters} studyTerm={studyTerm} bar={bar} navigate={navigate} />
            : view === "careers" ? <CareersPage filters={filters} studyTerm={studyTerm} bar={bar} />
              : view === "courses" ? <CoursesPage filters={filters} studyTerm={studyTerm} bar={bar} navigate={navigate} />
                : <AuditLogPage />}
  </div>;
}
