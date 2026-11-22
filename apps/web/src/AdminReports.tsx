import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./admin-account-shared";
import { REPORT_PATHS, reportViewOf, studentProfileLink } from "./admin-navigation";
import { formatVnDateTime, meaningClass, meaningOf, termName } from "./display-format";
import { nameInitials } from "./person-name";
import { sortRows, useTableSort, type SortRule, type TableSort } from "./table-sort";
import {
  AUDIT_API, REPORTS_API, downloadExcel, filtersFromSearch, filtersToSearch, reportUrl, useDebounced, useReport, EMPTY_FILTERS, type ReportFilterState, type ReportState,
} from "./admin-report-api";
import {
  BAND_COLORS, CATEGORY_COLORS, Card, ColumnChart, Donut, FIT_COLORS, Gauge, Legend, LineChart, Radar, Ring, SERIES_COLORS, STATUS_COLORS, Segmented, ShareColumns, Sparkline, StackBar,
  TooltipLayer, countText, gpaText, heatColor, percent, scoreOrDash, type BarPart, type Column,
} from "./admin-report-charts";
import type {
  AuditEntry, AuditKind, AuditPage, AverageRow, AverageTable, CareerRow, CareersReport, CohortSplit, CompetencyGroups, CourseHow, CourseRow, CourseStudents,
  CoursesReport, CreditAverages, DashboardKpis, DashboardReport, FitSummary, GpaBandLabel, GpaBands, GpaPoint, ProgressCounts, ProgressReport, ProgressStatus, ProgressStudent,
  ReportHead, ReportOptions, ReportTerm, RiskKind, RiskReport, RiskStudent, SkillGapRow, SkillGapStatus, SkillStudents, SkillsReport,
} from "./admin-report-types";
import "./table-sort.css";
import "./admin-reports.css";

// Tổng quan của cổng quản trị (AD-REPORT-01…12): Thống kê, Tiến độ, Nguy cơ, Kỹ năng thiếu, Vị trí mục tiêu, Môn đề xuất
// and Nhật ký. Rebuilt on 2026-11-22 from the preview the user approved ("Triển khai đi") after two corrections:
// charts of many kinds and statistics tables stay ("biểu đồ tròn và nhiều dạng"), and every page has its own layout
// ("mỗi trang nó có một cái giao diện khác nhau"). What went away with it: the Toàn khóa | Từng khóa switches (the Khóa
// filter and the per-cohort charts and tables answer both), the "Thao tác gần đây" drawer, the second title and lead
// of each page, the coverage line and the grey lines under the cards (one "Cách tính" panel per page says the bases).
// Every admin sees and exports everything; a cố vấn học tập sees the students of their classes. Progress and risk are
// the student's own Tổng quan numbers (server: readOverview), never AI.
// Contract: admin-report-types.ts; requests: admin-report-api.ts; charts: admin-report-charts.tsx.

/* ------------------------------------------------------------------ words */

type Tone = "good" | "warn" | "bad" | "none" | "blue" | "violet";
export const STATUS_TEXT: Record<ProgressStatus, { label: string; color: string; soft: string; tone: Tone }> = {
  on_track: { label: "Đúng tiến độ", color: STATUS_COLORS.good, soft: "#e6f2ec", tone: "good" },
  late: { label: "Trễ kế hoạch", color: STATUS_COLORS.warn, soft: "#fff3d9", tone: "warn" },
  unknown: { label: "Chưa đủ dữ liệu", color: STATUS_COLORS.unknown, soft: "#eef0f4", tone: "none" },
  no_transcript: { label: "Chưa có bảng điểm", color: STATUS_COLORS.none, soft: "#f3f5fa", tone: "none" },
};
const STATUS_ORDER: readonly ProgressStatus[] = ["on_track", "late", "unknown", "no_transcript"];
export const RISK_TEXT: Record<RiskKind, string> = {
  failed_course: "Môn bắt buộc chưa đạt", pace: "Không kịp tín chỉ", gpa_below: "GPA dưới ngưỡng", late_course: "Trễ môn so với KHĐT", elective_short: "Thiếu tín chỉ tự chọn",
};
const RISK_ORDER: readonly RiskKind[] = ["failed_course", "pace", "gpa_below", "late_course", "elective_short"];
/** A reason of the level Cần chú ý; the three others make a student Nguy cơ. */
const isWarnKind = (kind: RiskKind) => kind === "late_course" || kind === "elective_short";
const LEVEL_TEXT = { risk: { label: "Nguy cơ", tone: "bad", color: STATUS_COLORS.bad }, warn: { label: "Cần chú ý", tone: "warn", color: STATUS_COLORS.warn } } as const;
export const GAP_TEXT: Record<SkillGapStatus, { label: string; short: string; color: string; tone: Tone }> = {
  below: { label: "Dưới ngưỡng", short: "Dưới ngưỡng", color: SERIES_COLORS.amber, tone: "warn" },
  not_studied: { label: "Chưa học", short: "Chưa học", color: SERIES_COLORS.blue, tone: "blue" },
  self_study: { label: "Cần tự học ngoài chương trình", short: "Cần tự học", color: SERIES_COLORS.violet, tone: "violet" },
  no_data: { label: "Chưa có điểm", short: "Chưa có điểm", color: STATUS_COLORS.none, tone: "none" },
};
const GAP_ORDER: readonly SkillGapStatus[] = ["below", "not_studied", "self_study", "no_data"];
export const HOW_TEXT: Record<CourseHow, { label: string; color: string; tone: Tone }> = {
  new: { label: "Học mới", color: SERIES_COLORS.blue, tone: "blue" },
  retake: { label: "Học lại", color: SERIES_COLORS.amber, tone: "warn" },
  improve: { label: "Học cải thiện", color: SERIES_COLORS.violet, tone: "violet" },
};
const HOW_ORDER: readonly CourseHow[] = ["new", "retake", "improve"];
/** A kind of logged action: its name, the icon and the colours of its marks on Nhật ký. */
export const AUDIT_KINDS: Record<AuditKind, { label: string; icon: string; color: string; soft: string; ink: string }> = {
  report: { label: "Xuất báo cáo", icon: "download", color: "#3a6ad4", soft: "#e9effc", ink: "#2456a6" },
  access: { label: "Xem dữ liệu sinh viên", icon: "eye", color: "#d4901f", soft: "#fff3d9", ink: "#8f5a00" },
  training: { label: "Đào tạo", icon: "book", color: "#0f7c79", soft: "#e3f4f3", ink: "#0f6b68" },
  notify: { label: "Thông báo", icon: "bell", color: "#a33ea1", soft: "#f6e9f6", ink: "#7d2b7b" },
  competency: { label: "Năng lực", icon: "spark", color: "#2f8a63", soft: "#e6f2ec", ink: "#27765b" },
  career: { label: "Nghề nghiệp", icon: "briefcase", color: "#b51639", soft: "#fbeef1", ink: "#921631" },
  advisor: { label: "Làm thay sinh viên", icon: "compass", color: "#d9762b", soft: "#fdf0e3", ink: "#96490f" },
  account: { label: "Tài khoản", icon: "user", color: "#667085", soft: "#eef0f4", ink: "#4b5563" },
  other: { label: "Khác", icon: "document", color: "#8a94a6", soft: "#eef0f4", ink: "#4b5563" },
};
const AUDIT_ORDER: readonly AuditKind[] = ["report", "access", "training", "notify", "competency", "career", "advisor", "account", "other"];
const BAND_ORDER: readonly GpaBandLabel[] = ["Xuất sắc", "Giỏi", "Khá", "Trung bình", "Yếu"];
const FIT_ORDER = ["Rất phù hợp", "Phù hợp", "Trung bình", "Ít phù hợp", "Không phù hợp"] as const;
const FIT_FLOORS = ["từ 90", "từ 80", "từ 62,5", "từ 50", "dưới 50"] as const;

const EMPTY_SCOPE = "Chưa có sinh viên nào tải bảng điểm trong phạm vi lọc.";
const EMPTY_ASSESSED = "Chưa có sinh viên nào đánh giá năng lực trong phạm vi lọc.";

/** A CSS custom property set, as React's style takes it. */
const vars = (values: Record<string, string>) => values as CSSProperties;

/* ------------------------------------------------------------------ pure helpers (tested) */

/** "09:15 31/10/2026" in Vietnam time: the portals' one way to write a moment (display-format.ts formatVnDateTime). */
export const updatedText = (iso: string | null | undefined): string => formatVnDateTime(iso);
const termLabel = (term: ReportTerm | null | undefined) => (term ? term.label || termName(term.code) : "—");

/** The fit word of a score (thresholds of the competency engine: 90, 80, 62,5, 50). */
export const fitWord = (score: number): (typeof FIT_ORDER)[number] => (score >= 90 ? "Rất phù hợp" : score >= 80 ? "Phù hợp" : score >= 62.5 ? "Trung bình" : score >= 50 ? "Ít phù hợp" : "Không phù hợp");

/** The status parts of a progress count, in the legend's order. */
export const progressParts = (counts: ProgressCounts): BarPart[] => [
  { label: STATUS_TEXT.on_track.label, value: counts.onTrack, color: STATUS_TEXT.on_track.color },
  { label: STATUS_TEXT.late.label, value: counts.late, color: STATUS_TEXT.late.color },
  { label: STATUS_TEXT.unknown.label, value: counts.unknown, color: STATUS_TEXT.unknown.color },
  { label: STATUS_TEXT.no_transcript.label, value: counts.noTranscript, color: STATUS_TEXT.no_transcript.color },
];
const statusCount = (counts: ProgressCounts, status: ProgressStatus) =>
  (status === "on_track" ? counts.onTrack : status === "late" ? counts.late : status === "unknown" ? counts.unknown : counts.noTranscript);

/** The five học lực bands in order (Xuất sắc first) with their colour; a band the server left out counts 0. */
export function bandParts(bands: GpaBands): (BarPart & { range: string })[] {
  return BAND_ORDER.map((label, index) => {
    const band = bands.bands.find((item) => item.label === label);
    return { label, range: band?.range ?? "", value: band?.students ?? 0, color: BAND_COLORS[index]! };
  });
}

/** The five fit words in order (Rất phù hợp first) with their colour. */
export const fitParts = (levels: readonly { label: string; students: number }[]): BarPart[] =>
  FIT_ORDER.map((label, index) => ({ label, value: levels.find((level) => level.label === label)?.students ?? 0, color: FIT_COLORS[index]! }));

/** The cohorts present in a split, oldest first. */
export const cohortsOf = (split: CohortSplit<object>) => split.byCohort.map((item) => item.cohort);

/** "Dựa trên 13/14 bảng điểm có dữ liệu": the base of every GPA, credit and học lực figure (QA 2026-11-04). */
export const dataBaseText = (withData: number, withTranscript: number) => `Dựa trên ${countText(withData)}/${countText(withTranscript)} bảng điểm có dữ liệu`;

export function gpaColumnTip(points: readonly GpaPoint[], index: number): string {
  const point = points[index]!;
  return `${termLabel(point.term)}\nGPA TB học kỳ: ${gpaText(point.termGpa)} (${countText(point.termStudents)} sinh viên có điểm)\nGPA TB tích lũy: ${gpaText(point.cumulativeGpa)}`;
}

/** Over the reports of a cố vấn học tập (2026-11-07): the numbers are those of the classes they advise. */
export const advisorScopeText = (classes: readonly string[]) => classes.length
  ? `Số liệu chỉ gồm sinh viên các lớp bạn phụ trách: ${classes.join(", ")}.`
  : "Bạn chưa phụ trách lớp nào nên chưa có số liệu.";

type HelpView = "dashboard" | "progress" | "risk" | "skills" | "careers" | "courses";
/**
 * "Cách tính" of a page: where the figures come from and over how many students, said once per page instead of under
 * every card (the bases every figure must name, QA 2026-11-04). The counts are written when the report is loaded.
 */
export function helpLines(view: HelpView, head: ReportHead | null): string[] {
  const scope = head?.scope;
  const uploaded = scope ? ` (${countText(scope.withTranscript)}/${countText(scope.students)} sinh viên đã tải bảng điểm)` : "";
  const noData = scope && scope.withData < scope.withTranscript
    ? ` ${countText(scope.withTranscript - scope.withData)} bảng điểm chưa đọc được GPA tích lũy nên không tính vào điểm, xếp loại và tiến độ.` : "";
  const assessed = scope ? ` (${countText(scope.assessed)} sinh viên đã đánh giá)` : "";
  switch (view) {
    case "dashboard": return [
      `GPA và xếp loại học lực lấy từ dòng tổng kết in trên bảng điểm sinh viên tự tải lên${uploaded}, chưa xác minh. Điểm học kỳ tính cả môn chưa đạt, điểm tích lũy chỉ tính môn đã đạt.${noData}`,
      `Năng lực và độ phù hợp lấy từ lần Đánh giá năng lực mới nhất của mỗi sinh viên${assessed}. Vạch trên đồng hồ: ngưỡng Khá 62,5 và Giỏi 80.`,
      "Tiến độ và cảnh báo tính giống trang Tổng quan của sinh viên: so tín chỉ đã đạt với kế hoạch đào tạo của khóa. Hệ thống tự tính, không dùng AI.",
    ];
    case "progress": return [
      "Tiến độ tính giống trang Tổng quan của sinh viên: so số tín chỉ đã đạt với số tín chỉ kế hoạch đào tạo của khóa đặt ra đến hết học kỳ trước. Vạch đen trên thanh tín chỉ là mức kế hoạch đó.",
      "Chưa đủ dữ liệu: chưa so được với kế hoạch đào tạo vì thiếu kế hoạch hoặc chuyên ngành, hoặc bảng điểm chưa đọc được GPA tích lũy.",
      `Số liệu lấy từ bảng điểm sinh viên tự tải lên${uploaded}, chưa xác minh.${noData}`,
    ];
    case "risk": return [
      "Đây đúng là các mục “Cảnh báo chậm tiến độ” sinh viên thấy trên trang Tổng quan của mình. Hệ thống tự tính, không dùng AI; chỉ để tham khảo, không thay cảnh báo học vụ.",
      "Một sinh viên có thể có nhiều lý do; mức của sinh viên là mức nặng nhất trong các lý do. Nguy cơ: môn bắt buộc chưa đạt (F, VT, CT, DC), không kịp tín chỉ, GPA dưới ngưỡng. Cần chú ý: trễ môn so với kế hoạch đào tạo, thiếu tín chỉ tự chọn.",
      "Sinh viên chưa tải bảng điểm, hoặc có bảng điểm chưa đọc được GPA tích lũy, không có trong danh sách này; xem ở trang Tiến độ.",
    ];
    case "skills": return [
      `Lấy từ lần Đánh giá năng lực mới nhất của mỗi sinh viên${assessed}, so với yêu cầu của vị trí nghề nghiệp mục tiêu sinh viên đã chọn. Bảng xếp hạng hiện tối đa 12 kỹ năng thiếu nhiều nhất.`,
      "Dưới ngưỡng: có điểm nhưng thấp hơn ngưỡng của vị trí nghề nghiệp. Chưa học: môn trong chương trình chưa học hoặc sắp học.",
      "Cần tự học ngoài chương trình: chỉ học phần của chuyên ngành khác hoặc môn tự chọn chưa chọn dạy kỹ năng này. Chưa có điểm: đã học học phần liên quan nhưng bảng điểm chưa có điểm số.",
    ];
    case "careers": return [
      "Vị trí nghề nghiệp mục tiêu lấy từ lần Đánh giá năng lực mới nhất của mỗi sinh viên. Sinh viên chưa đánh giá năng lực, hoặc đánh giá khi chưa chọn vị trí mục tiêu, được đếm ở ô Chưa chọn vị trí.",
      "Điểm phù hợp tính như trên trang của sinh viên; kỹ năng chưa có điểm tính 0. Rất phù hợp từ 90, Phù hợp từ 80, Trung bình từ 62,5, Ít phù hợp từ 50, dưới 50 là Không phù hợp. Hai vạch trên đồng hồ là ngưỡng 62,5 và 80.",
      "Kỹ năng thiếu nhiều nhất: ba kỹ năng có nhiều sinh viên của vị trí đó còn thiếu nhất, kèm số sinh viên.",
    ];
    case "courses": return [
      "Đếm số sinh viên được Lộ trình AI đề xuất mỗi môn cho học kỳ tới. Chỉ tính sinh viên đã có Lộ trình AI.",
      "Học mới: môn sinh viên chưa học. Học lại: môn đã học nhưng chưa đạt. Học cải thiện: môn đã đạt, học lại để nâng điểm.",
      "Số dưới mỗi cột của biểu đồ là thứ hạng của môn trong bảng xếp hạng bên dưới.",
    ];
  }
}

/** "Hôm nay · Thứ Bảy 22/11/2026" for today, "Thứ Sáu 21/11/2026" for another day ("2026-11-21", a Vietnam date). */
export function dayLabel(day: string, today: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const weekday = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"][new Date(Date.UTC(year, month - 1, date)).getUTCDay()]!;
  return `${day === today ? "Hôm nay · " : ""}${weekday} ${String(date).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}
/** The Vietnam calendar day of a moment: "2026-11-21". */
export const vietnamDay = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const SHORT_WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;
/** "21/11" and "21/11/2026" of a day written "2026-11-21". */
const shortDate = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const fullDate = (day: string) => `${shortDate(day)}/${day.slice(0, 4)}`;

/** The log's entries of a page grouped by Vietnam day, newest day first as the server lists them. */
export function auditDays(items: readonly AuditEntry[]): { day: string; items: AuditEntry[] }[] {
  const groups: { day: string; items: AuditEntry[] }[] = [];
  for (const entry of items) {
    const day = vietnamDay(entry.at), last = groups.at(-1);
    if (last && last.day === day) last.items.push(entry); else groups.push({ day, items: [entry] });
  }
  return groups;
}

/** The page of a list that goes back to 1 whenever its filters change. */
function usePageFor(key: string): [number, (page: number) => void] {
  const [state, setState] = useState({ key, page: 1 });
  return [state.key === key ? state.page : 1, (page: number) => setState({ key, page })];
}
const sortQuery = (sort: TableSort) => (sort ? { sort: sort.key, dir: sort.direction } : {});

/* ------------------------------------------------------------------ shared pieces */

/** A level, fit or result word as a chip in its meaning's colour (one colour per word, display-format.ts). */
function Word({ word }: { word: string | null | undefined }) {
  return word ? <span className={`rp-chip ${meaningClass(meaningOf(word))}`}>{word}</span> : null;
}
const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`rp-badge rp-badge-${tone}`}>{children}</span>;

const TINTS = [["#e9effc", "#2456a6"], ["#e3f4f3", "#0f6b68"], ["#f6e9f6", "#7d2b7b"], ["#fff3d9", "#8f5a00"], ["#fbeef1", "#921631"]] as const;
/** The colours of a person's avatar: always the same for the same person. */
function tintOf(seed: string): readonly [string, string] {
  let hash = 0;
  for (const letter of seed) hash = (hash * 31 + letter.codePointAt(0)!) >>> 0;
  return TINTS[hash % TINTS.length]!;
}
/** The initials of a person in a round mark (decorative: the name stands beside it). */
function Avatar({ name, seed, tint, size }: { name: string; seed?: string; tint?: readonly [string, string]; size?: "sm" | "lg" }) {
  const [background, color] = tint ?? tintOf(seed ?? name);
  return <span className={`rp-avatar${size ? ` rp-avatar-${size}` : ""}`} aria-hidden="true" style={{ background, color }}>{nameInitials(name) || "?"}</span>;
}
const Rank = ({ index, square = false }: { index: number; square?: boolean }) =>
  <span className={`rp-rank${index < 3 ? " rp-rank-top" : ""}${square ? " rp-rank-square" : ""}`} aria-hidden="true">{index + 1}</span>;

const plainClick = (event: MouseEvent) => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
/** A link to another page of the portal through the workspace navigation; a middle click or Ctrl+click still opens a new tab. */
function PageLink({ to, navigate, children, label }: { to: string; navigate: (path: string) => void; children: ReactNode; label?: string }) {
  return <a className="rp-link" href={to} aria-label={label} onClick={(event) => { if (plainClick(event)) { event.preventDefault(); navigate(to); } }}>{children}</a>;
}
/** "Xem hồ sơ" (user, 2026-10-31): the student's details on the Sinh viên page. */
const ProfileLink = ({ userId, name, navigate }: { userId: string; name: string; navigate: (path: string) => void }) =>
  <PageLink to={studentProfileLink(userId)} navigate={navigate} label={`Xem hồ sơ của ${name}`}>Xem hồ sơ</PageLink>;

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

/** Khóa, Ngành, Chuyên ngành in the head of every report (AD-REPORT-11 Lọc dữ liệu); "Xóa bộ lọc" while one is set. */
export function HeadFilters({ filters, setFilters, options }: { filters: ReportFilterState; setFilters: (next: ReportFilterState) => void; options: ReportOptions | null }) {
  const specialties = (options?.specialties ?? []).filter((item) => !filters.major || !item.majorCode || item.majorCode === filters.major);
  const any = Boolean(filters.cohort || filters.major || filters.specialty);
  return <>
    <label className="rp-field">Khóa<select id="rp-cohort" value={filters.cohort} onChange={(event) => setFilters({ ...filters, cohort: event.target.value })}><option value="">Tất cả</option>{(options?.cohorts ?? []).map((cohort) => <option key={cohort} value={cohort}>{cohort}</option>)}</select></label>
    <label className="rp-field">Ngành<select id="rp-major" value={filters.major} onChange={(event) => {
      const major = event.target.value;
      const keep = (options?.specialties ?? []).some((item) => item.code === filters.specialty && (!major || !item.majorCode || item.majorCode === major));
      setFilters({ ...filters, major, specialty: keep ? filters.specialty : "" });
    }}><option value="">Tất cả</option>{(options?.majors ?? []).map((major) => <option key={major.code} value={major.code}>{major.name}</option>)}</select></label>
    <label className="rp-field">Chuyên ngành<select id="rp-specialty" value={filters.specialty} onChange={(event) => setFilters({ ...filters, specialty: event.target.value })}><option value="">Tất cả</option>{specialties.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    {any && <button type="button" className="rp-reset" onClick={() => setFilters({ ...filters, cohort: "", major: "", specialty: "" })}>Xóa bộ lọc</button>}
  </>;
}

/**
 * The head of a report page: the portal's eyebrow and title (given by the workspace, which focuses the title on every
 * page change), one muted line under it, and on the right the filters and "Cách tính", whose panel opens under the head.
 */
export function PageHead({ heading, meta, filters, help, scope }: { heading?: ReactNode; meta: ReactNode; filters?: ReactNode; help?: readonly string[]; scope?: { classes: string[] } | null }) {
  const [open, setOpen] = useState(false);
  return <>
    <div className="am-page-heading rp-heading">
      <div className="rp-heading-text">{heading}<p className="rp-head-meta">{meta}</p></div>
      {(filters || help) && <div className="rp-head-actions" role="search" aria-label="Lọc dữ liệu thống kê">{filters}
        {help && <button type="button" className="rp-btn" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="info" />Cách tính</button>}</div>}
    </div>
    {scope && <p className="rp-scope">{advisorScopeText(scope.classes)}</p>}
    {open && help && <div className="rp-help"><b>Cách tính</b><ul>{help.map((line) => <li key={line}>{line}</li>)}</ul></div>}
  </>;
}

/** "Học kỳ đang học: HK1 2026–2027 · Cập nhật 09:15 21/11/2026"; the update time once the report is loaded. */
export const metaText = (head: ReportHead | null, studyTerm: ReportTerm | null) =>
  `Học kỳ đang học: ${termLabel(head?.studyTerm ?? studyTerm)}${head ? ` · Cập nhật ${updatedText(head.generatedAt)}` : ""}`;

function Loading<T>({ state, children }: { state: ReportState<T>; children: (data: T) => ReactNode }) {
  if (state.data) return <div className={`rp-stack${state.loading ? " rp-refreshing" : ""}`} aria-busy={state.loading}>{children(state.data)}</div>;
  if (state.error) return <div className="rp-card rp-state"><p className="admin-error" role="alert">{state.error}</p><button type="button" className="rp-btn" onClick={state.retry}><Icon name="refresh" />Thử lại</button></div>;
  return <div className="rp-card rp-state" role="status">Đang tải thống kê…</div>;
}

/** "Tìm sinh viên" of a student list (AD-REPORT-10): applied when the person stops typing, or at once on Enter. */
function SearchBox({ id, value, onChange, label = "Tìm sinh viên", placeholder = "MSSV hoặc họ tên", wide = false }: { id: string; value: string; onChange: (value: string) => void; label?: string; placeholder?: string; wide?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const settled = useDebounced(draft);
  useEffect(() => { if (settled.trim() !== value) onChange(settled.trim()); }, [settled]); // eslint-disable-line react-hooks/exhaustive-deps
  return <form role="search" aria-label={label} onSubmit={(event) => { event.preventDefault(); if (draft.trim() !== value) onChange(draft.trim()); }}>
    <label className="rp-field rp-field-search">{label}<span className={wide ? "rp-search rp-search-wide" : "rp-search"}><Icon name="search" /><input id={id} type="search" value={draft} maxLength={120} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} /></span></label>
  </form>;
}

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
    <button type="button" className="rp-btn rp-btn-primary" disabled={busy} onClick={() => void run()}><Icon name="download" />{busy ? "Đang xuất…" : "Xuất Excel"}</button>
    {message && <span className={message.ok ? "rp-export-ok" : "rp-export-error"} role={message.ok ? "status" : "alert"}>{message.text}</span>}
  </div>;
}

/** "Hiển thị 1–8 trong 84 sinh viên" and the two page buttons of a list. */
function Pager({ total, page, pageSize, setPage, unit, byTime = false }: { total: number; page: number; pageSize: number; setPage: (page: number) => void; unit: string; byTime?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  return <div className="rp-pager">
    <span role="status">{total ? `Hiển thị ${countText(from)}–${countText(to)} trong ${countText(total)} ${unit}` : `Không có ${unit} nào`}</span>
    <div><button type="button" className="rp-btn rp-btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>{byTime ? "Mới hơn" : "Trước"}</button>
      <span>Trang {countText(page)}/{countText(pages)}</span>
      <button type="button" className="rp-btn rp-btn-small" disabled={page >= pages} onClick={() => setPage(page + 1)}>{byTime ? "Cũ hơn" : "Sau"}</button></div>
  </div>;
}

/** A student as every list shows one: the initials, the name and a line under it. */
const Who = ({ name, sub, seed, tint, mono = false }: { name: string; sub: string; seed: string; tint?: readonly [string, string]; mono?: boolean }) =>
  <span className="rp-who"><Avatar name={name} seed={seed} tint={tint} /><span><b>{name}</b><small className={mono ? "rp-code" : undefined}>{sub}</small></span></span>;
/** "9900000001 · K29 · Công nghệ phần mềm": what is known of a student, in one line. */
const studentLine = (...parts: (string | null | undefined)[]) => parts.filter((part): part is string => Boolean(part)).join(" · ");

/* ------------------------------------------------------------------ AD-REPORT-01 Thống kê */

function KpiCards({ kpis, sparkline, navigate }: { kpis: DashboardKpis; sparkline: number[]; navigate: (path: string) => void }) {
  return <div className="rp-kpis">
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-blue"><Icon name="users" /></span><span>Sinh viên</span></div>
      <div className="rp-kpi-body"><b className="rp-kpi-value">{countText(kpis.students)}</b><Ring share={kpis.students ? kpis.withTranscript / kpis.students : 0} label="Đã tải bảng điểm" /></div>
      <p className="rp-kpi-foot">{countText(kpis.withTranscript)} đã tải bảng điểm · {countText(kpis.assessed)} đã đánh giá năng lực</p></div>
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-violet"><Icon name="chart" /></span><span>GPA tích lũy trung bình</span></div>
      <div className="rp-kpi-body"><b className="rp-kpi-value" data-tip={dataBaseText(kpis.withData, kpis.withTranscript)} tabIndex={0}>{gpaText(kpis.gpa)}<small>/ 4</small></b>
        <Sparkline values={sparkline} label="GPA trung bình tích lũy qua các học kỳ" /></div>
      <p className="rp-kpi-foot">{kpis.gpaChange === null ? "Chưa đủ học kỳ để so sánh" : <><span className={`rp-delta ${kpis.gpaChange >= 0 ? "rp-up" : "rp-down"}`}>{kpis.gpaChange >= 0 ? "▲" : "▼"} {gpaText(Math.abs(kpis.gpaChange))}</span> so với {termLabel(kpis.gpaChangeFrom)}</>}</p></div>
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-teal"><Icon name="spark" /></span><span>Năng lực trung bình</span></div>
      <div className="rp-kpi-body"><b className="rp-kpi-value">{scoreOrDash(kpis.competency)}<small>/ 100</small></b><Gauge value={kpis.competency} size="mini" label="Năng lực trung bình" /></div>
      <p className="rp-kpi-foot"><Word word={kpis.competencyLevel} /><span>{countText(kpis.assessed)} sinh viên đã đánh giá</span></p></div>
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-amber"><Icon name="target" /></span><span>Phù hợp vị trí mục tiêu</span></div>
      <div className="rp-kpi-body"><b className="rp-kpi-value">{scoreOrDash(kpis.fit)}<small>/ 100</small></b><Gauge value={kpis.fit} size="mini" color={SERIES_COLORS.amber} label="Điểm phù hợp với vị trí nghề nghiệp mục tiêu trung bình" /></div>
      <p className="rp-kpi-foot"><Word word={kpis.fitLabel} /><span>điểm phù hợp trung bình</span></p></div>
    <div className="rp-kpi"><div className="rp-kpi-top"><span className="rp-kpi-icon rp-red"><Icon name="bell" /></span><span>Có cảnh báo chậm tiến độ</span></div>
      <div className="rp-kpi-body rp-kpi-body-stack"><b className="rp-kpi-value">{countText(kpis.risk + kpis.warn)}</b>
        <StackBar className="rp-split" label="Sinh viên có cảnh báo theo mức" parts={[{ label: "Nguy cơ", value: kpis.risk, color: STATUS_COLORS.bad }, { label: "Cần chú ý", value: kpis.warn, color: STATUS_COLORS.warn }]} /></div>
      <p className="rp-kpi-foot"><span className={`rp-chip ${meaningClass("bad")}`}>{countText(kpis.risk)} nguy cơ</span><span className={`rp-chip ${meaningClass("warn")}`}>{countText(kpis.warn)} cần chú ý</span>
        <PageLink to={REPORT_PATHS.risk} navigate={navigate} label="Xem sinh viên có cảnh báo">Xem</PageLink></p></div>
  </div>;
}

function GpaCard({ points }: { points: GpaPoint[] }) {
  const latest = (pick: (point: GpaPoint) => number | null) => [...points].reverse().map(pick).find((value) => value !== null) ?? null;
  return <Card id="rp-gpa" className="rp-wide" title="Điểm trung bình theo học kỳ"
    actions={<Legend lines items={[["GPA TB tích lũy", SERIES_COLORS.cumulative, gpaText(latest((point) => point.cumulativeGpa))], ["GPA TB học kỳ", SERIES_COLORS.term, gpaText(latest((point) => point.termGpa))]]} />}>
    <LineChart terms={points.map((point) => point.term)} label="GPA trung bình tích lũy và GPA trung bình học kỳ qua các học kỳ" emptyText={EMPTY_SCOPE}
      series={[{ key: "cum", label: "Tích lũy", color: SERIES_COLORS.cumulative, values: points.map((point) => point.cumulativeGpa), area: true },
        { key: "term", label: "Học kỳ", color: SERIES_COLORS.term, values: points.map((point) => point.termGpa) }]}
      columnTip={(index) => gpaColumnTip(points, index)} />
  </Card>;
}

/** A donut's legend: one row per part with its count and share. */
function PartList({ parts, total, ranges }: { parts: readonly (BarPart & { range?: string })[]; total: number; ranges?: boolean }) {
  return <ul className="rp-donut-legend">{parts.map((part) => <li key={part.label}><i style={{ background: part.color }} aria-hidden="true" />
    <span>{part.label}{ranges && part.range && <> <small>{part.range}</small></>}</span><b>{countText(part.value)}</b><small>{percent(part.value, total)}%</small></li>)}</ul>;
}

function BandCard({ bands }: { bands: GpaBands }) {
  const parts = bandParts(bands);
  // The bands add up to the transcripts with data, the same base as every GPA figure of the page.
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return <Card id="rp-bands" className="rp-narrow" title="Xếp loại học lực">
    {total === 0 ? <p className="rp-empty">{EMPTY_SCOPE}</p> : <>
      <div className="rp-donut-center" data-tip={dataBaseText(total, bands.withTranscript)}><Donut parts={parts} center={countText(total)} sub="bảng điểm" label="Xếp loại học lực theo GPA tích lũy" size={170} unit="bảng điểm" /></div>
      <PartList parts={parts} total={total} ranges />
    </>}
  </Card>;
}

function CohortProgressCard({ split, cohort, navigate }: { split: CohortSplit<ProgressCounts>; cohort: string; navigate: (path: string) => void }) {
  const parts = progressParts(split.all);
  return <Card id="rp-progress" title="Tiến độ học tập theo khóa" actions={<PageLink to={REPORT_PATHS.progress} navigate={navigate}>Xem danh sách</PageLink>}>
    <Legend items={parts.map((part) => [part.label, part.color, part.value] as const)} label="Tình trạng" />
    {split.byCohort.length ? <ShareColumns label="Tình trạng tiến độ của từng khóa"
      columns={split.byCohort.map((item) => ({ key: item.cohort, label: item.cohort, sub: `${countText(item.total)} SV`, parts: progressParts(item), strong: item.cohort === cohort }))} />
      : <p className="rp-empty">Chưa có sinh viên trong phạm vi lọc.</p>}
  </Card>;
}

function CompetencyCard({ groups }: { groups: CompetencyGroups }) {
  const lowest = groups.lowest.slice(0, 3);
  return <Card id="rp-competency" title="Năng lực theo nhóm">
    {!groups.groups.some((group) => group.score !== null) && !lowest.length ? <p className="rp-empty">{EMPTY_ASSESSED}</p> : <>
      <div className="rp-gauges">{groups.groups.map((group) => <div key={group.name} className="rp-gauge-box" data-tip={`${group.name}: ${scoreOrDash(group.score)} / 100 · ${countText(group.students)} sinh viên`} tabIndex={0}>
        <Gauge value={group.score} ticks="marks" label={group.name} /><b>{group.name}</b><Word word={group.level} /></div>)}</div>
      {lowest.length > 0 && <div className="rp-divided"><h3 className="rp-sub-title">Kỹ năng thấp nhất</h3>
        <ul className="rp-mini-list">{lowest.map((skill) => <li key={skill.name} data-tip={`${skill.name}${skill.group ? ` (${skill.group})` : ""}: ${scoreOrDash(skill.score)} / 100 · ${countText(skill.students)} sinh viên có điểm`} tabIndex={0}>
          <span>{skill.name}</span><span className="rp-meter rp-meter-full"><i className="rp-teal-fill" style={{ width: `${Math.min(100, skill.score)}%` }} /></span><b>{scoreOrDash(skill.score)}</b></li>)}</ul></div>}
    </>}
  </Card>;
}

function FitCard({ fit, navigate }: { fit: FitSummary; navigate: (path: string) => void }) {
  const parts = fitParts(fit.levels);
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const careers = [...fit.careers].sort((a, b) => b.students - a.students).slice(0, 3);
  return <Card id="rp-fit" title="Độ phù hợp với vị trí nghề nghiệp" actions={<PageLink to={REPORT_PATHS.careers} navigate={navigate} label="Xem tất cả vị trí nghề nghiệp mục tiêu">Xem tất cả</PageLink>}>
    {total === 0 ? <p className="rp-empty">{EMPTY_ASSESSED}</p> : <>
      <div className="rp-donut-side"><div className="rp-donut-center"><Donut parts={parts} center={scoreOrDash(fit.average)} sub="điểm TB" label="Mức phù hợp với vị trí nghề nghiệp mục tiêu" size={130} /></div>
        <PartList parts={parts} total={total} /></div>
      {careers.length > 0 && <div className="rp-divided"><h3 className="rp-sub-title">Vị trí được chọn nhiều nhất</h3>
        <ul className="rp-mini-list rp-mini-list-count">{careers.map((career) => <li key={career.name} data-tip={`${career.name}: ${countText(career.students)} sinh viên, điểm phù hợp trung bình ${scoreOrDash(career.average)}`} tabIndex={0}>
          <span>{career.name}</span><small>{countText(career.students)} SV</small><b>{scoreOrDash(career.average)}</b></li>)}</ul></div>}
    </>}
  </Card>;
}

function sortAverages(rows: readonly AverageRow[], sort: TableSort) {
  const rules: Record<string, SortRule<AverageRow>> = {
    label: { value: (row) => row.label }, students: { value: (row) => row.students, by: "number" }, withTranscript: { value: (row) => row.withTranscript, by: "number" },
    gpa: { value: (row) => row.gpa, by: "number" }, competency: { value: (row) => row.competency, by: "number" }, fit: { value: (row) => row.fit, by: "number" },
    late: { value: (row) => row.late, by: "number" }, flagged: { value: (row) => row.risk + row.warn, by: "number" },
  };
  return sortRows(rows, rules, sort).map((item) => item.row);
}

/**
 * Bảng thống kê: one row per cohort, major or specialty and the whole scope as the last row. The counts add up to that
 * row; each average says its base in its tooltip (GPA over the transcripts with data, competency and fit over the
 * students who were assessed).
 */
export function AveragesTable({ table }: { table: AverageTable }) {
  const { sort, sortHeader } = useTableSort();
  const head = table.by === "cohort" ? "Khóa" : table.by === "major" ? "Ngành" : "Chuyên ngành";
  const row = (item: AverageRow, footer = false) => <tr key={footer ? "all" : item.key}>
    <th scope="row">{footer ? (table.by === "cohort" ? "Toàn khóa" : "Tất cả") : item.label}</th>
    <td className="rp-num">{countText(item.students)}</td>
    <td className="rp-num">{countText(item.withTranscript)} <small>({percent(item.withTranscript, item.students)}%)</small></td>
    <td><span className="rp-cell-bar" data-tip={`GPA tích lũy trung bình của ${countText(item.withData)}/${countText(item.withTranscript)} bảng điểm có dữ liệu`}><span className="rp-meter"><i style={{ width: `${((item.gpa ?? 0) / 4) * 100}%` }} /></span>{gpaText(item.gpa)}</span></td>
    <td><span className="rp-cell-word" data-tip={`${countText(item.assessed)} sinh viên đã đánh giá năng lực`}>{scoreOrDash(item.competency)} <Word word={item.competencyLevel} /></span></td>
    <td><span className="rp-cell-word" data-tip={`${countText(item.assessed)} sinh viên đã đánh giá năng lực`}>{scoreOrDash(item.fit)} <Word word={item.fitLabel} /></span></td>
    <td className="rp-num">{countText(item.late)}</td>
    <td className="rp-num" data-tip={`Nguy cơ: ${countText(item.risk)}\nCần chú ý: ${countText(item.warn)}`}>{countText(item.risk + item.warn)}</td>
  </tr>;
  return <div className="rp-table-wrap" tabIndex={0} role="region" aria-label={`Bảng thống kê theo ${head.toLowerCase()}`}><table className="rp-table">
    <thead><tr>{sortHeader(head, "label")}{sortHeader("Sinh viên", "students", "rp-num")}{sortHeader("Đã tải bảng điểm", "withTranscript", "rp-num")}{sortHeader("GPA TB", "gpa")}
      {sortHeader("Năng lực TB", "competency")}{sortHeader("Phù hợp TB", "fit")}{sortHeader("Trễ kế hoạch", "late", "rp-num")}{sortHeader("Có cảnh báo", "flagged", "rp-num")}</tr></thead>
    <tbody>{table.rows.length ? sortAverages(table.rows, sort).map((item) => row(item)) : <tr><td colSpan={8} className="rp-empty">Chưa có sinh viên trong phạm vi lọc.</td></tr>}</tbody>
    {table.rows.length > 0 && <tfoot>{row(table.all, true)}</tfoot>}
  </table></div>;
}

function AveragesCard({ tables }: { tables: AverageTable[] }) {
  const [by, setBy] = useState<AverageTable["by"]>("cohort");
  const table = tables.find((item) => item.by === by) ?? tables[0];
  return <Card id="rp-averages" className="rp-wide" title="Bảng thống kê"
    actions={<Segmented label="Nhóm theo" value={by} onChange={setBy} options={[{ value: "cohort", label: "Theo khóa" }, { value: "major", label: "Theo ngành" }, { value: "specialty", label: "Theo chuyên ngành" }]} />}>
    {table ? <AveragesTable key={table.by} table={table} /> : <p className="rp-empty">Chưa có sinh viên trong phạm vi lọc.</p>}
  </Card>;
}

const KindChip = ({ kind }: { kind: AuditKind }) => {
  const text = AUDIT_KINDS[kind] ?? AUDIT_KINDS.other;
  return <span className="rp-timeline-kind" style={vars({ "--soft": text.soft, "--ink": text.ink })}>{text.label}</span>;
};

/** How many entries "Hoạt động gần đây" shows. */
const RECENT_LOG = 5;
/**
 * Hoạt động gần đây: the newest log entries with who and when. The summary stays on Nhật ký: it can name a student, and
 * this page is the first one every admin opens.
 */
function RecentCard({ recent, navigate }: { recent: ReportState<AuditPage> | null; navigate: (path: string) => void }) {
  const items = recent?.data?.items.slice(0, RECENT_LOG) ?? [];
  return <Card id="rp-recent" className="rp-narrow" title="Hoạt động gần đây" actions={<PageLink to={REPORT_PATHS.audit} navigate={navigate}>Mở Nhật ký</PageLink>}>
    {items.length ? <ul className="rp-recent">{items.map((entry) => <li key={entry.id}><span><b>{entry.action}</b><KindChip kind={entry.kind} /></span><small>{entry.actorName} · {updatedText(entry.at)}</small></li>)}</ul>
      : recent?.error ? <p className="admin-error" role="alert">{recent.error}</p>
        : <p className="rp-empty" role={recent?.data ? undefined : "status"}>{recent?.data ? "Chưa có thao tác nào được ghi." : "Đang tải…"}</p>}
  </Card>;
}

export function DashboardView({ data, navigate, recent, cohort = "" }: { data: DashboardReport; navigate: (path: string) => void; recent: ReportState<AuditPage> | null; cohort?: string }) {
  const points = data.gpaByTerm.all.points;
  const sparkline = points.map((point) => point.cumulativeGpa).filter((value): value is number => value !== null).slice(-9);
  return <>
    <KpiCards kpis={data.kpis.all} sparkline={sparkline} navigate={navigate} />
    <div className="rp-row"><GpaCard points={points} /><BandCard bands={data.gpaBands.all} /></div>
    <div className="rp-cols-3">
      <CohortProgressCard split={data.progress} cohort={cohort} navigate={navigate} />
      <CompetencyCard groups={data.competencyGroups.all} />
      <FitCard fit={data.fit.all} navigate={navigate} />
    </div>
    <div className="rp-row"><AveragesCard tables={data.averages} /><RecentCard recent={recent} navigate={navigate} /></div>
  </>;
}

type Shell = { heading?: ReactNode; filters: ReportFilterState; setFilters: (next: ReportFilterState) => void; options: ReportOptions | null; navigate: (path: string) => void };
/** The filters a page without a search box sends: the search of the student lists never narrows the aggregate pages. */
const scopeFilters = (filters: ReportFilterState): ReportFilterState => ({ ...filters, q: "" });
const headOf = (shell: Shell, view: HelpView, head: ReportHead | null) =>
  <PageHead heading={shell.heading} meta={metaText(head, shell.options?.studyTerm ?? null)} scope={shell.options?.scope}
    filters={<HeadFilters filters={shell.filters} setFilters={shell.setFilters} options={shell.options} />} help={helpLines(view, head)} />;

function DashboardPage({ shell }: { shell: Shell }) {
  const state = useReport<DashboardReport>(reportUrl("/dashboard", scopeFilters(shell.filters)));
  const recent = useReport<AuditPage>(`${AUDIT_API}?page=1&pageSize=${RECENT_LOG}`);
  return <>{headOf(shell, "dashboard", state.data)}
    <Loading state={state}>{(data) => <DashboardView data={data} navigate={shell.navigate} recent={recent} cohort={shell.filters.cohort} />}</Loading></>;
}

/* ------------------------------------------------------------------ AD-REPORT-02/03 Tiến độ */

function CreditsCell({ student }: { student: ProgressStudent }) {
  if (student.passedCredits === null || !student.totalCredits) return <>—</>;
  const late = student.status === "late";
  return <span className="rp-credit" data-tip={`${countText(student.passedCredits)} TC đã đạt / ${countText(student.totalCredits)} TC của CTĐT${student.expectedCredits !== null ? `\nKế hoạch đến hết học kỳ trước: ${countText(student.expectedCredits)} TC` : ""}`}>
    <span className="rp-meter rp-meter-credit"><i className={late ? "rp-late" : undefined} style={{ width: `${Math.min(100, (student.passedCredits / student.totalCredits) * 100)}%` }} />
      {student.expectedCredits !== null && <s style={{ left: `${Math.min(99, (student.expectedCredits / student.totalCredits) * 100)}%` }} />}</span>
    <small>{countText(student.passedCredits)}/{countText(student.totalCredits)} TC{student.expectedCredits !== null ? ` · kế hoạch ${countText(student.expectedCredits)}` : ""}</small>
  </span>;
}

/** "82/104 TC": a cohort's mean passed credits over its mean planned credits, as "Tín chỉ so với kế hoạch" writes them. */
export const creditsText = (credits: CreditAverages) =>
  (credits.students && credits.passed !== null && credits.expected !== null ? `${countText(Math.round(credits.passed))}/${countText(Math.round(credits.expected))} TC` : "chưa có");

function PlanCard({ counts, credits, cohort }: { counts: ProgressCounts; credits: CohortSplit<CreditAverages>; cohort: string }) {
  const comparable = counts.onTrack + counts.late;
  return <Card id="rp-plan" className="rp-narrow" title="Tín chỉ so với kế hoạch">
    <div className="rp-plan"><Ring share={comparable ? counts.onTrack / comparable : 0} label="Sinh viên đạt đủ tín chỉ kế hoạch" size={76} color={STATUS_COLORS.good} />
      <p><b>{countText(counts.onTrack)}/{countText(comparable)}</b> sinh viên so được với kế hoạch đang đạt đủ số tín chỉ kế hoạch đào tạo đặt ra.</p></div>
    {credits.byCohort.length > 0 && <ul className="rp-bullets">{credits.byCohort.map((item) => {
      const known = item.students > 0 && item.passed !== null && item.expected !== null && Boolean(item.total);
      const behind = known && item.passed! < item.expected!;
      return <li key={item.cohort} data-tip={known ? `${item.cohort}: trung bình ${countText(Math.round(item.passed!))} TC đã đạt, kế hoạch ${countText(Math.round(item.expected!))} TC, chương trình ${countText(Math.round(item.total!))} TC\n${countText(item.students)} sinh viên so được với kế hoạch` : `${item.cohort}: chưa có sinh viên so được với kế hoạch`} tabIndex={0}>
        <b className={item.cohort === cohort ? "rp-picked-text" : undefined}>{item.cohort}</b>
        <span className="rp-meter rp-meter-bullet">{known && <><i className={behind ? "rp-late" : undefined} style={{ width: `${Math.min(100, (item.passed! / item.total!) * 100)}%` }} /><s style={{ left: `${Math.min(99, (item.expected! / item.total!) * 100)}%` }} /></>}</span>
        <span>{creditsText(item)}</span></li>;
    })}</ul>}
    <p className="rp-note">Thanh: tín chỉ đã đạt trung bình của khóa. Vạch đen: mức kế hoạch đào tạo đến hết học kỳ trước. Mỗi thanh tính trên tổng tín chỉ của chương trình.</p>
  </Card>;
}

export function ProgressView({ data, status, setStatus, q, setQ, page, setPage, pageSize, sortHeader, exportUrl, navigate, cohort = "" }: {
  data: ProgressReport; status: "all" | ProgressStatus; setStatus: (status: "all" | ProgressStatus) => void; q: string; setQ: (q: string) => void; page: number; setPage: (page: number) => void; pageSize: number;
  sortHeader: (label: ReactNode, column: string, className?: string) => ReactNode; exportUrl: string; navigate: (path: string) => void; cohort?: string;
}) {
  const counts = data.counts.all;
  return <>
    <Card id="rp-progress-summary" title={`Tình trạng tiến độ của ${countText(counts.total)} sinh viên`} actions={<span className="rp-note">Bấm một tình trạng để lọc danh sách bên dưới</span>}>
      <StackBar className="rp-pipeline" label="Tỉ lệ sinh viên theo tình trạng tiến độ" parts={progressParts(counts)} />
      <div className="rp-blocks">{STATUS_ORDER.map((key) => {
        const text = STATUS_TEXT[key], value = statusCount(counts, key), share = percent(value, counts.total);
        return <button key={key} type="button" className="rp-block" aria-pressed={status === key} style={vars({ "--tone": text.color, "--soft": text.soft })} onClick={() => setStatus(status === key ? "all" : key)}>
          <span className="rp-block-top"><b>{countText(value)}</b><span>{share}%</span></span>
          <span className="rp-block-name"><i className="rp-dot" aria-hidden="true" />{text.label}</span>
          <span className="rp-block-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
        </button>;
      })}</div>
    </Card>
    <div className="rp-row">
      <Card id="rp-progress-cohorts" className="rp-wide" title="Số sinh viên theo khóa" actions={<Legend items={STATUS_ORDER.map((key) => [STATUS_TEXT[key].label, STATUS_TEXT[key].color] as const)} label="Tình trạng" />}>
        {data.counts.byCohort.length ? <ColumnChart label="Số sinh viên của từng khóa theo tình trạng tiến độ"
          columns={data.counts.byCohort.map((item): Column => ({ key: item.cohort, label: item.cohort, parts: progressParts(item), strong: item.cohort === cohort }))} />
          : <p className="rp-empty">Chưa có sinh viên trong phạm vi lọc.</p>}
      </Card>
      <PlanCard counts={counts} credits={data.credits} cohort={cohort} />
    </div>
    <section className="rp-card" aria-labelledby="rp-progress-list">
      <div className="rp-card-head rp-card-tools"><h2 id="rp-progress-list">{status === "all" ? "Danh sách sinh viên" : `Sinh viên ${STATUS_TEXT[status].label.toLowerCase()}`} <span className="rp-count">{countText(data.page.total)}</span></h2>
        <div className="rp-card-actions"><SearchBox id="rp-q" value={q} onChange={setQ} /><ExportButton url={exportUrl} fallbackName="bao-cao-tien-do.xlsx" /></div></div>
      <div className="rp-table-wrap" tabIndex={0} role="region" aria-label="Danh sách sinh viên theo tiến độ"><table className="rp-table rp-students">
        <thead><tr>{sortHeader("Sinh viên", "name")}{sortHeader("Khóa", "cohort")}{sortHeader("Chuyên ngành", "specialty")}{sortHeader("Tín chỉ đã đạt", "credits")}{sortHeader("GPA tích lũy", "gpa", "rp-num")}{sortHeader("Tình trạng", "status")}<th scope="col" className="rp-action">Thao tác</th></tr></thead>
        <tbody>{data.page.items.length ? data.page.items.map((student) => <tr key={student.userId}>
          <td><Who name={student.name} sub={student.studentCode ?? "Chưa có MSSV"} seed={student.userId} mono /></td>
          <td>{student.cohort ?? "—"}</td><td>{student.specialtyName ?? "Chưa xác định"}</td><td><CreditsCell student={student} /></td><td className="rp-num rp-gpa">{gpaText(student.gpa)}</td>
          <td><span className="rp-chips"><Badge tone={STATUS_TEXT[student.status].tone}>{STATUS_TEXT[student.status].label}</Badge>{student.risk && <Badge tone={LEVEL_TEXT[student.risk].tone}>{LEVEL_TEXT[student.risk].label}</Badge>}</span></td>
          <td className="rp-action"><ProfileLink userId={student.userId} name={student.name} navigate={navigate} /></td>
        </tr>) : <tr><td colSpan={7} className="rp-empty">Không có sinh viên phù hợp với bộ lọc.</td></tr>}</tbody>
      </table></div>
      <Pager total={data.page.total} page={page} pageSize={pageSize} setPage={setPage} unit="sinh viên" />
    </section>
  </>;
}

const PROGRESS_PAGE = 10;
function ProgressPage({ shell }: { shell: Shell }) {
  const { filters } = shell;
  const [status, setStatus] = useState<"all" | ProgressStatus>("all");
  const [page, setPage] = usePageFor(`${filtersToSearch(filters)}|${status}`);
  const { sort, sortHeader } = useTableSort(() => setPage(1));
  const query = { status: status === "all" ? null : status, ...sortQuery(sort) };
  const state = useReport<ProgressReport>(reportUrl("/progress", filters, { ...query, page, pageSize: PROGRESS_PAGE }));
  return <>{headOf(shell, "progress", state.data)}
    <Loading state={state}>{(data) => <ProgressView data={data} status={status} setStatus={setStatus} q={filters.q} setQ={(q) => shell.setFilters({ ...filters, q })} page={page} setPage={setPage} pageSize={PROGRESS_PAGE}
      sortHeader={sortHeader} exportUrl={reportUrl("/progress.xlsx", filters, query)} navigate={shell.navigate} cohort={filters.cohort} />}</Loading></>;
}

/* ------------------------------------------------------------------ AD-REPORT-04/05 Nguy cơ */

type RiskLevel = "all" | "risk" | "warn";
const RISK_TINT = { risk: ["#fdecea", "#b42318"], warn: ["#fff3d9", "#8f5a00"] } as const;

export function RiskView({ data, level, setLevel, kind, setKind, q, setQ, page, setPage, pageSize, exportUrl, navigate, cohort = "" }: {
  data: RiskReport; level: RiskLevel; setLevel: (level: RiskLevel) => void; kind: RiskKind | null; setKind: (kind: RiskKind | null) => void; q: string; setQ: (q: string) => void;
  page: number; setPage: (page: number) => void; pageSize: number; exportUrl: string; navigate: (path: string) => void; cohort?: string;
}) {
  const counts = data.counts.all;
  const reasons = RISK_ORDER.map((key) => data.reasons.all.items.find((item) => item.kind === key) ?? { kind: key, label: RISK_TEXT[key], students: 0 });
  const reasonMax = Math.max(1, ...reasons.map((item) => item.students));
  const cohortMax = Math.max(1, ...data.counts.byCohort.map((item) => item.total));
  return <div className="rp-row rp-row-top">
    <div className="rp-side rp-narrow">
      <section className="rp-card" aria-labelledby="rp-risk-count">
        <div className="rp-flag-head"><div><h2 id="rp-risk-count">Sinh viên có cảnh báo</h2><b>{countText(counts.total)}</b></div>
          <p>{percent(counts.total, data.scope.withTranscript)}% trong {countText(data.scope.withTranscript)} sinh viên<br />có bảng điểm</p></div>
        <button type="button" className="rp-tile rp-tile-risk" aria-pressed={level === "risk"} onClick={() => setLevel(level === "risk" ? "all" : "risk")}>
          <b>{countText(counts.risk)}</b><span><b>Nguy cơ</b><span>môn bắt buộc chưa đạt, không kịp tín chỉ, GPA dưới ngưỡng</span></span></button>
        <button type="button" className="rp-tile rp-tile-warn" aria-pressed={level === "warn"} onClick={() => setLevel(level === "warn" ? "all" : "warn")}>
          <b>{countText(counts.warn)}</b><span><b>Cần chú ý</b><span>trễ môn so với kế hoạch đào tạo, thiếu tín chỉ tự chọn</span></span></button>
      </section>
      <section className="rp-card" aria-labelledby="rp-risk-reasons">
        <h2 id="rp-risk-reasons">Lý do</h2>
        <div className="rp-facets">{reasons.map((item) => <button key={item.kind} type="button" className="rp-facet" aria-pressed={kind === item.kind} style={vars({ "--tone": isWarnKind(item.kind) ? STATUS_COLORS.warn : STATUS_COLORS.bad })}
          onClick={() => setKind(kind === item.kind ? null : item.kind)}>
          <i className="rp-dot" aria-hidden="true" /><span>{item.label || RISK_TEXT[item.kind]}</span><span className="rp-facet-bar" aria-hidden="true"><i style={{ width: `${(item.students / reasonMax) * 100}%` }} /></span><b>{countText(item.students)}</b>
        </button>)}</div>
      </section>
      <Card id="rp-risk-cohorts" title="Theo khóa" actions={<Legend items={[["Nguy cơ", STATUS_COLORS.bad], ["Cần chú ý", STATUS_COLORS.warn]]} label="Mức" />}>
        {data.counts.byCohort.length ? <ul className="rp-cohort-bars">{data.counts.byCohort.map((item) => <li key={item.cohort}><b className={item.cohort === cohort ? "rp-picked-text" : undefined}>{item.cohort}</b>
          <StackBar label={`${item.cohort}: sinh viên có cảnh báo`} rest={cohortMax - item.total} tip={`${item.cohort}: ${countText(item.total)} sinh viên có cảnh báo\nNguy cơ: ${countText(item.risk)}\nCần chú ý: ${countText(item.warn)}`}
            parts={[{ label: "Nguy cơ", value: item.risk, color: STATUS_COLORS.bad }, { label: "Cần chú ý", value: item.warn, color: STATUS_COLORS.warn }]} /><b>{countText(item.total)}</b></li>)}</ul>
          : <p className="rp-empty">Chưa có sinh viên trong phạm vi lọc.</p>}
      </Card>
    </div>
    <section className="rp-card rp-wider" aria-labelledby="rp-risk-list">
      <div className="rp-card-head rp-card-tools"><h2 id="rp-risk-list">Sinh viên cần theo dõi <span className="rp-count">{countText(data.page.total)}</span></h2>
        <div className="rp-card-actions"><SearchBox id="rp-q" value={q} onChange={setQ} /><ExportButton url={exportUrl} fallbackName="sinh-vien-co-nguy-co.xlsx" /></div></div>
      <div className="rp-toolbar">
        <Segmented label="Mức" value={level} onChange={setLevel} options={[{ value: "all", label: "Tất cả", count: counts.total }, { value: "risk", label: "Nguy cơ", count: counts.risk }, { value: "warn", label: "Cần chú ý", count: counts.warn }]} />
        {kind && <button type="button" className="rp-pill" onClick={() => setKind(null)}><span>Lý do: {RISK_TEXT[kind]}</span><Icon name="close" /><span className="rp-sr">Bỏ lọc lý do</span></button>}
      </div>
      {data.page.items.length ? <div className="rp-alerts">{data.page.items.map((student: RiskStudent) => <article key={student.userId} className="rp-alert">
        <div className="rp-alert-head"><Avatar name={student.name} tint={RISK_TINT[student.level]} size="lg" />
          <span><b>{student.name}</b><small>{studentLine(student.studentCode ?? "Chưa có MSSV", student.cohort, student.specialtyName)}</small></span>
          <Badge tone={LEVEL_TEXT[student.level].tone}>{LEVEL_TEXT[student.level].label}</Badge></div>
        <ul className="rp-reasons">{student.reasons.map((reason, index) => <li key={index}><i className="rp-dot rp-dot-small" aria-hidden="true" style={vars({ "--tone": LEVEL_TEXT[reason.level].color })} /><span>{reason.text}</span></li>)}</ul>
        <div className="rp-alert-foot"><span>GPA tích lũy <b>{gpaText(student.gpa)}</b></span><ProfileLink userId={student.userId} name={student.name} navigate={navigate} /></div>
      </article>)}</div> : <p className="rp-empty">Không có sinh viên nào có cảnh báo trong phạm vi lọc.</p>}
      <Pager total={data.page.total} page={page} pageSize={pageSize} setPage={setPage} unit="sinh viên" />
    </section>
  </div>;
}

const RISK_PAGE = 8;
function RiskPage({ shell }: { shell: Shell }) {
  const { filters } = shell;
  const [level, setLevel] = useState<RiskLevel>("all");
  const [kind, setKind] = useState<RiskKind | null>(null);
  const [page, setPage] = usePageFor(`${filtersToSearch(filters)}|${level}|${kind ?? ""}`);
  const query = { level: level === "all" ? null : level, kind };
  const state = useReport<RiskReport>(reportUrl("/risk", filters, { ...query, page, pageSize: RISK_PAGE }));
  return <>{headOf(shell, "risk", state.data)}
    <Loading state={state}>{(data) => <RiskView data={data} level={level} setLevel={setLevel} kind={kind} setKind={setKind} q={filters.q} setQ={(q) => shell.setFilters({ ...filters, q })} page={page} setPage={setPage} pageSize={RISK_PAGE}
      exportUrl={reportUrl("/risk.xlsx", filters, query)} navigate={shell.navigate} cohort={filters.cohort} />}</Loading></>;
}

/* ------------------------------------------------------------------ AD-REPORT-06/07 Kỹ năng thiếu */

const gapParts = (row: SkillGapRow): BarPart[] => [
  { label: GAP_TEXT.below.label, value: row.below, color: GAP_TEXT.below.color },
  { label: GAP_TEXT.not_studied.label, value: row.notStudied, color: GAP_TEXT.not_studied.color },
  { label: GAP_TEXT.self_study.label, value: row.selfStudy, color: GAP_TEXT.self_study.color },
  { label: GAP_TEXT.no_data.label, value: row.noData, color: GAP_TEXT.no_data.color },
];
const gapCount = (row: SkillGapRow, status: SkillGapStatus) => (status === "below" ? row.below : status === "not_studied" ? row.notStudied : status === "self_study" ? row.selfStudy : row.noData);
const RADAR_AXES = 8;

/** The picked item of a ranking, with what is known of it and the students behind it. */
function PickPanel({ id, eyebrow, title, code, tiles, children }: { id: string; eyebrow: string; title: string; code?: string; tiles: { label: string; value: number; tone: Tone }[]; children: ReactNode }) {
  return <section className="rp-card rp-half" aria-labelledby={id}>
    <div><p className="rp-pick-eyebrow">{eyebrow}</p><h2 id={id} className="rp-pick-title">{title}</h2>{code && <p className="rp-code">{code}</p>}</div>
    <div className="rp-pick-tiles">{tiles.map((tile) => <div key={tile.label} className={`rp-pick-tile rp-tone-${tile.tone}`}><b>{countText(tile.value)}</b><span>{tile.label}</span></div>)}</div>
    {children}
  </section>;
}

/** The students behind a picked skill or course: who, one line about them, a status and the way to their details. */
function People<T extends { userId: string; name: string }>({ state, empty, title, navigate, row }: {
  state: ReportState<{ items: T[] }> | null; empty: string; title: (count: number) => string; navigate: (path: string) => void; row: (item: T) => { sub: string; badge: ReactNode };
}) {
  if (!state) return null;
  if (!state.data) return state.error ? <div className="rp-state"><p className="admin-error" role="alert">{state.error}</p><button type="button" className="rp-btn" onClick={state.retry}><Icon name="refresh" />Thử lại</button></div> : <p className="rp-empty" role="status">Đang tải danh sách sinh viên…</p>;
  const items = state.data.items;
  return <div className={state.loading ? "rp-stack rp-refreshing" : "rp-stack"} aria-busy={state.loading}>
    <h3 className="rp-sub-title">{title(items.length)}</h3>
    {items.length ? <ul className="rp-people" tabIndex={0} aria-label={title(items.length)}>{items.map((item, index) => { const cell = row(item); return <li key={`${item.userId}-${index}`}>
      <Avatar name={item.name} seed={item.userId} /><span><b>{item.name}</b><small>{cell.sub}</small></span>
      <span className="rp-people-end">{cell.badge}<ProfileLink userId={item.userId} name={item.name} navigate={navigate} /></span></li>; })}</ul> : <p className="rp-empty">{empty}</p>}
  </div>;
}

export function SkillsView({ data, career, setCareer, selected, setSelected, students, exportUrl, navigate }: {
  data: SkillsReport; career: string; setCareer: (career: string) => void; selected: string | null; setSelected: (skill: string) => void;
  students: ReportState<SkillStudents> | null; exportUrl: string; navigate: (path: string) => void;
}) {
  const items = data.skills.all.items;
  const assessed = data.scope.assessed;
  const cohorts = cohortsOf(data.skills);
  const max = Math.max(1, ...items.map((item) => item.total));
  const cellMax = Math.max(1, ...data.skills.byCohort.flatMap((cohort) => cohort.items.map((item) => item.total)));
  const pickedIndex = Math.max(0, items.findIndex((item) => item.name === selected));
  const picked = items[pickedIndex];
  // Every share is of the students assessed in scope, with or without a career chosen, like the "· 45%" of the ranking.
  const radar = items.slice(0, RADAR_AXES).map((item) => ({ key: item.name, name: item.name, share: assessed ? (item.total / assessed) * 100 : 0 }));
  return <>
    <div className="rp-row">
      <Card id="rp-skill-radar" className="rp-narrow" title="Hồ sơ kỹ năng thiếu" sub={`Tỉ lệ sinh viên đã đánh giá còn thiếu, ${countText(radar.length)} kỹ năng đứng đầu`}>
        {radar.length >= 3 ? <><Radar axes={radar} selected={picked?.name} onSelect={setSelected} label="Biểu đồ mạng nhện: tỉ lệ sinh viên còn thiếu các kỹ năng đứng đầu" what="sinh viên đã đánh giá còn thiếu" />
          <p className="rp-note" style={{ textAlign: "center" }}>Số ở mỗi đỉnh là thứ hạng trong bảng xếp hạng bên cạnh. Càng xa tâm, càng nhiều sinh viên còn thiếu.</p></>
          : <p className="rp-empty">Cần ít nhất 3 kỹ năng còn thiếu để vẽ biểu đồ.</p>}
      </Card>
      <section className="rp-card rp-wide" aria-labelledby="rp-skills-title">
        <div className="rp-card-head rp-card-tools"><div><h2 id="rp-skills-title">Xếp hạng kỹ năng còn thiếu</h2><p>{countText(assessed)} sinh viên đã đánh giá năng lực · bấm một kỹ năng để xem sinh viên</p></div>
          <div className="rp-card-actions"><label className="rp-field">Vị trí nghề nghiệp mục tiêu<select id="rp-career" value={career} onChange={(event) => setCareer(event.target.value)}><option value="">Mọi vị trí nghề nghiệp</option>{data.careers.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <ExportButton url={exportUrl} fallbackName="ky-nang-con-thieu.xlsx" /></div></div>
        {items.length ? <>
          <Legend items={GAP_ORDER.map((status) => [GAP_TEXT[status].label, GAP_TEXT[status].color] as const)} label="Tình trạng kỹ năng" />
          <div className="rp-rankrows">{items.map((item, index) => <button key={item.name} type="button" className="rp-rankrow" aria-pressed={picked?.name === item.name} onClick={() => setSelected(item.name)}>
            <Rank index={index} /><span>{item.name}</span><StackBar label={item.name} parts={gapParts(item)} rest={max - item.total} />
            <span><b>{countText(item.total)}</b><small> · {percent(item.total, assessed)}%</small></span>
          </button>)}</div>
        </> : <p className="rp-empty">{assessed ? "Không có kỹ năng nào còn thiếu trong phạm vi lọc." : EMPTY_ASSESSED}</p>}
      </section>
    </div>
    {picked && <div className="rp-row rp-row-top">
      <Card id="rp-skill-heat" className="rp-half-wide" title="Kỹ năng theo khóa" actions={<span className="rp-scale">Ít<span aria-hidden="true">{[0.14, 0.3, 0.46, 0.62].map((alpha) => <i key={alpha} style={{ background: `rgba(58, 106, 212, ${alpha})` }} />)}</span>Nhiều</span>}>
        <div className="rp-heat-wrap" tabIndex={0} role="region" aria-label="Số sinh viên còn thiếu mỗi kỹ năng theo từng khóa"><table className="rp-heat">
          <thead><tr><th scope="col">Kỹ năng</th>{cohorts.map((cohort) => <th key={cohort} scope="col">{cohort}</th>)}<th scope="col">Tổng</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.name} className={picked.name === item.name ? "rp-picked" : undefined}><th scope="row">{item.name}</th>
            {data.skills.byCohort.map((cohort) => { const value = cohort.items.find((other) => other.name === item.name)?.total ?? 0; return <td key={cohort.cohort} data-tip={`${item.name} · ${cohort.cohort}: ${countText(value)} sinh viên còn thiếu`}><span style={heatColor(value, cellMax)}>{countText(value)}</span></td>; })}
            <td className="rp-heat-total">{countText(item.total)}</td></tr>)}</tbody>
        </table></div>
      </Card>
      <PickPanel id="rp-skill-picked" eyebrow={`Kỹ năng đang chọn · hạng ${pickedIndex + 1}`} title={picked.name} tiles={GAP_ORDER.map((status) => ({ label: GAP_TEXT[status].short, value: gapCount(picked, status), tone: GAP_TEXT[status].tone }))}>
        <People state={students} navigate={navigate} empty="Không có sinh viên nào còn thiếu kỹ năng này trong phạm vi lọc." title={(count) => `${countText(count)} sinh viên còn thiếu`}
          row={(item: SkillStudents["items"][number]) => ({ sub: studentLine(item.studentCode ?? "Chưa có MSSV", item.cohort, item.careerName), badge: <Badge tone={GAP_TEXT[item.status].tone}>{GAP_TEXT[item.status].short}</Badge> })} />
      </PickPanel>
    </div>}
  </>;
}

function SkillsPage({ shell }: { shell: Shell }) {
  const filters = scopeFilters(shell.filters);
  const [career, setCareer] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const key = `${filtersToSearch(filters)}|${career}`;
  useEffect(() => setChosen(null), [key]);
  const state = useReport<SkillsReport>(reportUrl("/skills", filters, { career: career || null }));
  // The first skill of the ranking is picked until the person picks another one.
  const items = state.data?.skills.all.items ?? [];
  const selected = items.some((item) => item.name === chosen) ? chosen : items[0]?.name ?? null;
  const students = useReport<SkillStudents>(selected ? reportUrl("/skills/students", filters, { skill: selected, career: career || null }) : null);
  return <>{headOf(shell, "skills", state.data)}
    <Loading state={state}>{(data) => <SkillsView data={data} career={career} setCareer={setCareer} selected={selected} setSelected={setChosen} students={selected ? students : null}
      exportUrl={reportUrl("/skills.xlsx", filters, { career: career || null })} navigate={shell.navigate} />}</Loading></>;
}

/* ------------------------------------------------------------------ AD-REPORT-08 Vị trí mục tiêu */

const DONUT_PARTS = 5;
/** The donut of careers: the five most chosen ones, every other one together as "Vị trí khác". */
export function careerShares(items: readonly CareerRow[]): BarPart[] {
  const parts: BarPart[] = items.slice(0, DONUT_PARTS).map((row, index) => ({ label: row.name, value: row.students, color: CATEGORY_COLORS[index]! }));
  const other = items.slice(DONUT_PARTS).reduce((sum, row) => sum + row.students, 0);
  return other > 0 ? [...parts, { label: "Vị trí khác", value: other, color: CATEGORY_COLORS[DONUT_PARTS]! }] : parts;
}
/** The mean fit score of every student with a target career: the careers' means weighted by their students. */
export function meanFit(items: readonly CareerRow[]): number | null {
  const scored = items.filter((row) => row.average !== null && row.students > 0);
  const students = scored.reduce((sum, row) => sum + row.students, 0);
  return students ? scored.reduce((sum, row) => sum + row.average! * row.students, 0) / students : null;
}

export function CareersView({ data }: { data: CareersReport }) {
  const items = data.careers.all.items;
  const chosen = items.reduce((sum, row) => sum + row.students, 0);
  const average = meanFit(items);
  const shares = careerShares(items);
  return <>
    <section className="rp-strip" aria-label="Số liệu chính">
      <div><div><span className="rp-strip-label">Đã chọn vị trí mục tiêu</span><b className="rp-strip-value">{countText(chosen)}</b><span className="rp-strip-note">trong {countText(data.scope.withTranscript)} sinh viên có bảng điểm</span></div><span className="rp-strip-icon rp-blue" aria-hidden="true"><Icon name="target" /></span></div>
      <div><div><span className="rp-strip-label">Vị trí được chọn</span><b className="rp-strip-value">{countText(items.length)}</b><span className="rp-strip-note">{items[0] ? `nhiều nhất: ${items[0].name}` : "chưa có vị trí nào"}</span></div><span className="rp-strip-icon rp-teal" aria-hidden="true"><Icon name="briefcase" /></span></div>
      <div><div><span className="rp-strip-label">Điểm phù hợp trung bình</span><b className="rp-strip-value">{scoreOrDash(average)}<small>/ 100</small></b><Word word={average === null ? null : fitWord(average)} /></div><span className="rp-strip-icon rp-amber" aria-hidden="true"><Icon name="spark" /></span></div>
      <div><div><span className="rp-strip-label">Chưa chọn vị trí</span><b className="rp-strip-value">{countText(data.withoutCareer)}</b><span className="rp-strip-note">đã tải bảng điểm, chưa có vị trí mục tiêu</span></div><span className="rp-strip-icon rp-violet" aria-hidden="true"><Icon name="users" /></span></div>
    </section>
    {items.length ? <div className="rp-row rp-row-top">
      <Card id="rp-career-shares" className="rp-narrow" title="Cơ cấu vị trí mục tiêu">
        <div className="rp-donut-center"><Donut parts={shares} center={countText(chosen)} sub="sinh viên" label="Tỉ lệ sinh viên theo vị trí nghề nghiệp mục tiêu" size={190} /></div>
        <PartList parts={shares} total={chosen} />
        <div className="rp-divided"><h3 className="rp-sub-title">Mức phù hợp trên các thẻ</h3>
          <ul className="rp-legend rp-legend-bars" aria-label="Mức phù hợp">{FIT_ORDER.map((label, index) => <li key={label}><i style={{ background: FIT_COLORS[index] }} aria-hidden="true" />{label} · {FIT_FLOORS[index]}</li>)}</ul></div>
      </Card>
      <div className="rp-careers rp-wider">{items.map((row, index) => {
        const parts = fitParts(row.levels);
        const word = row.average === null ? null : fitWord(row.average);
        const good = (parts[0]?.value ?? 0) + (parts[1]?.value ?? 0);
        return <article key={row.name} className="rp-career">
          <div className="rp-career-head"><Rank index={index} square /><h3>{row.name}</h3><i aria-hidden="true" style={{ background: CATEGORY_COLORS[Math.min(index, DONUT_PARTS)] }} /></div>
          <div className="rp-career-main"><Gauge value={row.average} ticks="marks" color={word ? FIT_COLORS[FIT_ORDER.indexOf(word)] : undefined} label={`Điểm phù hợp trung bình với ${row.name}`} />
            <div><span><b>{countText(row.students)}</b> <small>sinh viên · {percent(row.students, chosen)}%</small></span><Word word={word} /></div></div>
          <div className="rp-career-dist"><span><span>Phân bố mức phù hợp</span><span>Phù hợp trở lên: {countText(good)}/{countText(row.students)}</span></span>
            <StackBar label={`Mức phù hợp của sinh viên chọn ${row.name}`} parts={parts} tip={parts.map((part) => `${part.label}: ${countText(part.value)}`).join("\n")} /></div>
          <div className="rp-divided"><span className="rp-gap-title">Kỹ năng thiếu nhiều nhất</span>
            {row.topGaps.length ? <span className="rp-gaps">{row.topGaps.map((gap) => <span key={gap.name}>{gap.name} <b>{countText(gap.students)}</b></span>)}</span> : <span className="rp-note">Không có kỹ năng nào còn thiếu.</span>}</div>
        </article>;
      })}</div>
    </div> : <p className="rp-card rp-empty">{EMPTY_ASSESSED}</p>}
  </>;
}

function CareersPage({ shell }: { shell: Shell }) {
  const state = useReport<CareersReport>(reportUrl("/careers", scopeFilters(shell.filters)));
  return <>{headOf(shell, "careers", state.data)}<Loading state={state}>{(data) => <CareersView data={data} />}</Loading></>;
}

/* ------------------------------------------------------------------ AD-REPORT-09 Môn đề xuất */

const howParts = (row: CourseRow): BarPart[] => [
  { label: HOW_TEXT.new.label, value: row.newStudents, color: HOW_TEXT.new.color },
  { label: HOW_TEXT.retake.label, value: row.retake, color: HOW_TEXT.retake.color },
  { label: HOW_TEXT.improve.label, value: row.improve, color: HOW_TEXT.improve.color },
];
const howCount = (row: CourseRow, how: CourseHow) => (how === "new" ? row.newStudents : how === "retake" ? row.retake : row.improve);
/** How many courses the chart draws and how many the ranking lists at first. */
const COURSE_COLUMNS = 12;
const COURSE_ROWS = 10;

export function CoursesView({ data, selected, setSelected, students, navigate }: {
  data: CoursesReport; selected: string | null; setSelected: (code: string) => void; students: ReportState<CourseStudents> | null; navigate: (path: string) => void;
}) {
  const items = data.courses.all.items;
  const pickedIndex = Math.max(0, items.findIndex((row) => row.code === selected));
  const picked = items[pickedIndex];
  const [shown, setShown] = useState(COURSE_ROWS);
  // The picked course is always in the list, also when it sits past the rows shown so far.
  const listed = Math.max(shown, pickedIndex + 1);
  const charted = items.slice(0, COURSE_COLUMNS);
  const cohortMax = picked ? Math.max(1, ...data.courses.byCohort.map((cohort) => cohort.items.find((row) => row.code === picked.code)?.total ?? 0)) : 1;
  return <>
    <section className="rp-statcard" aria-labelledby="rp-courses-title">
      <div className="rp-stathead"><div><h2 id="rp-courses-title">Lượt đề xuất theo môn</h2><p>{countText(data.withRoadmap)} sinh viên đã có Lộ trình AI · {countText(items.length)} môn được đề xuất{items.length > charted.length ? ` · biểu đồ vẽ ${countText(charted.length)} môn đứng đầu` : ""}</p></div>
        <div className="rp-statcells">{HOW_ORDER.map((how) => <div key={how} className="rp-statcell"><span><i style={{ background: HOW_TEXT[how].color }} aria-hidden="true" />{HOW_TEXT[how].label}</span><b>{countText(items.reduce((sum, row) => sum + howCount(row, how), 0))}</b></div>)}</div></div>
      <div className="rp-statbody">{charted.length ? <ColumnChart ranks label="Số sinh viên được đề xuất mỗi môn, chia theo cách học" selected={picked?.code} onSelect={setSelected}
        columns={charted.map((row): Column => ({ key: row.code, label: row.code, name: `${row.name} (${row.code})`, parts: howParts(row) }))} />
        : <p className="rp-empty">Chưa có môn nào được AI đề xuất trong phạm vi lọc.</p>}</div>
    </section>
    {picked && <div className="rp-row rp-row-top">
      <section className="rp-card rp-half-wide" aria-labelledby="rp-course-rank">
        <div><h2 id="rp-course-rank">Bảng xếp hạng môn được đề xuất</h2><p className="rp-head-meta">Bấm một môn để xem sinh viên được đề xuất</p></div>
        <div className="rp-courses">{items.slice(0, listed).map((row, index) => <button key={row.code} type="button" className="rp-course" aria-pressed={picked.code === row.code} onClick={() => setSelected(row.code)}>
          <Rank index={index} square />
          <span><b>{row.name}</b><span className="rp-course-tags"><span className="rp-code">{row.code}</span>{HOW_ORDER.filter((how) => howCount(row, how) > 0).map((how) => <span key={how}><i style={{ background: HOW_TEXT[how].color }} aria-hidden="true" />{HOW_TEXT[how].label} {countText(howCount(row, how))}</span>)}</span></span>
          <span><b>{countText(row.total)}</b> <small>sinh viên</small></span>
        </button>)}</div>
        {items.length > listed && <button type="button" className="rp-btn" style={{ justifySelf: "start" }} onClick={() => setShown(listed + COURSE_ROWS)}>Xem thêm {countText(Math.min(COURSE_ROWS, items.length - listed))} môn</button>}
      </section>
      <PickPanel id="rp-course-picked" eyebrow={`Môn đang chọn · hạng ${pickedIndex + 1}`} title={picked.name} code={picked.code} tiles={HOW_ORDER.map((how) => ({ label: HOW_TEXT[how].label, value: howCount(picked, how), tone: HOW_TEXT[how].tone }))}>
        {data.courses.byCohort.length > 0 && <div className="rp-stack" style={{ gap: 8 }}><h3 className="rp-sub-title">Theo khóa</h3>
          <ul className="rp-cohort-mini">{data.courses.byCohort.map((cohort) => { const value = cohort.items.find((row) => row.code === picked.code)?.total ?? 0; return <li key={cohort.cohort}><b>{cohort.cohort}</b>
            <span className="rp-meter rp-meter-full" style={{ height: 8 }}><i style={{ width: `${(value / cohortMax) * 100}%` }} /></span><span>{countText(value)}</span></li>; })}</ul></div>}
        <People state={students} navigate={navigate} empty="Không có sinh viên nào được đề xuất môn này trong phạm vi lọc." title={(count) => `${countText(count)} sinh viên được đề xuất`}
          row={(item: CourseStudents["items"][number]) => ({ sub: studentLine(item.studentCode ?? "Chưa có MSSV", item.cohort, item.specialtyName), badge: <Badge tone={HOW_TEXT[item.how].tone}>{HOW_TEXT[item.how].label}</Badge> })} />
      </PickPanel>
    </div>}
  </>;
}

function CoursesPage({ shell }: { shell: Shell }) {
  const filters = scopeFilters(shell.filters);
  const [chosen, setChosen] = useState<string | null>(null);
  const key = filtersToSearch(filters);
  useEffect(() => setChosen(null), [key]);
  const state = useReport<CoursesReport>(reportUrl("/courses", filters));
  const items = state.data?.courses.all.items ?? [];
  const selected = items.some((row) => row.code === chosen) ? chosen : items[0]?.code ?? null;
  const students = useReport<CourseStudents>(selected ? reportUrl("/courses/students", filters, { code: selected }) : null);
  return <>{headOf(shell, "courses", state.data)}
    <Loading state={state}>{(data) => <CoursesView data={data} selected={selected} setSelected={setChosen} students={selected ? students : null} navigate={shell.navigate} />}</Loading></>;
}

/* ------------------------------------------------------------------ AD-REPORT-12 Nhật ký */

const ROLE_TINTS: Record<string, readonly [string, string]> = { "Cố vấn học tập": ["#e9effc", "#2456a6"] };
const actorTint = (role: string | null) => ROLE_TINTS[role ?? ""] ?? (["#fbeef1", "#921631"] as const);

export function AuditView({ data, kind, setKind, actor, setActor, q, setQ, page, setPage, today }: {
  data: AuditPage; kind: "" | AuditKind; setKind: (kind: "" | AuditKind) => void; actor: string; setActor: (actor: string) => void; q: string; setQ: (q: string) => void;
  page: number; setPage: (page: number) => void; today: string;
}) {
  const weekTotal = data.days.reduce((sum, day) => sum + day.count, 0);
  const kindCount = (key: AuditKind) => data.kinds.find((item) => item.kind === key)?.count ?? 0;
  const kinds = AUDIT_ORDER.filter((key) => key !== "other" || kindCount(key) > 0 || kind === key);
  const kindMax = Math.max(1, ...data.kinds.map((item) => item.count));
  const actorTotal = Math.max(1, data.actorCounts.reduce((sum, item) => sum + item.count, 0));
  const dayCounts = new Map(data.days.map((day) => [day.date, day.count]));
  const filtered = [kind ? AUDIT_KINDS[kind].label : "", actor].filter(Boolean);
  const range = data.days.length ? `${shortDate(data.days[0]!.date)} đến ${fullDate(data.days.at(-1)!.date)}` : "";
  return <>
    <div className="rp-row">
      <section className="rp-statcard rp-wide" aria-labelledby="rp-audit-week">
        <div className="rp-stathead"><div><h2 id="rp-audit-week">Thao tác 7 ngày qua</h2>{range && <p>{range}</p>}</div>
          <div className="rp-statcells">
            <div className="rp-statcell"><span>Tổng thao tác</span><b>{countText(weekTotal)}</b></div>
            <div className="rp-statcell"><span>Xem dữ liệu sinh viên</span><b style={{ color: AUDIT_KINDS.access.ink }}>{countText(data.days.reduce((sum, day) => sum + day.access, 0))}</b></div>
            <div className="rp-statcell"><span>Xuất báo cáo</span><b style={{ color: AUDIT_KINDS.report.ink }}>{countText(data.days.reduce((sum, day) => sum + day.report, 0))}</b></div>
          </div></div>
        <div className="rp-statbody">{data.days.length ? <ColumnChart height={240} unit="thao tác" label="Số thao tác mỗi ngày trong 7 ngày qua"
          columns={data.days.map((day): Column => ({
            key: day.date, label: SHORT_WEEKDAYS[new Date(`${day.date}T00:00:00Z`).getUTCDay()]!, sub: shortDate(day.date), name: dayLabel(day.date, today), strong: day.date === today,
            parts: [{ label: "Thao tác", value: day.count, color: day.date === today ? SERIES_COLORS.brand : SERIES_COLORS.blue }],
          }))} /> : <p className="rp-empty">Chưa có số liệu theo ngày.</p>}</div>
      </section>
      <section className="rp-card rp-narrow" aria-labelledby="rp-audit-kinds">
        <h2 id="rp-audit-kinds">Theo loại thao tác</h2>
        <div className="rp-facets">{kinds.map((key) => { const text = AUDIT_KINDS[key], count = kindCount(key); return <button key={key} type="button" className="rp-facet rp-facet-icon" aria-pressed={kind === key} style={vars({ "--tone": text.color, "--soft": text.soft })} onClick={() => setKind(kind === key ? "" : key)}>
          <span className="rp-facet-tile" aria-hidden="true"><Icon name={text.icon} /></span><span>{text.label}</span><span className="rp-facet-bar" aria-hidden="true"><i style={{ width: `${(count / kindMax) * 100}%` }} /></span><b>{countText(count)}</b>
        </button>; })}</div>
      </section>
    </div>
    <div className="rp-row rp-row-top">
      <section className="rp-card rp-wider" aria-labelledby="rp-audit-title">
        <div className="rp-card-head rp-card-tools"><h2 id="rp-audit-title">Dòng thời gian <span className="rp-count">{countText(data.total)}</span></h2>
          <div className="rp-card-actions"><SearchBox id="rp-audit-q" value={q} onChange={setQ} label="Tìm trong nhật ký" placeholder="Người thực hiện, thao tác, nội dung" wide />
            {(q || kind || actor) && <button type="button" className="rp-reset" onClick={() => { setQ(""); setKind(""); setActor(""); }}>Xóa bộ lọc</button>}</div></div>
        {filtered.length > 0 && <p className="rp-head-meta">Đang lọc: <b style={{ color: "var(--rp-ink)" }}>{filtered.join(" · ")}</b></p>}
        {data.items.length ? auditDays(data.items).map((group) => <div key={group.day} className="rp-timeline-day">
          <h3><span>{dayLabel(group.day, today)}</span>{dayCounts.has(group.day) && <span>{countText(dayCounts.get(group.day)!)} thao tác</span>}</h3>
          <ul className="rp-timeline">{group.items.map((entry) => { const text = AUDIT_KINDS[entry.kind] ?? AUDIT_KINDS.other; return <li key={entry.id}>
            <time dateTime={entry.at}>{updatedText(entry.at).slice(0, 5)}</time>
            <div className="rp-timeline-entry" style={vars({ "--tone": text.color })}><i aria-hidden="true" />
              <span><b>{entry.action}</b><KindChip kind={entry.kind} /></span>
              <span className="rp-timeline-summary">{entry.summary}</span>
              <span className="rp-timeline-actor"><Avatar name={entry.actorName} tint={actorTint(entry.actorRole)} size="sm" />{entry.actorName}{entry.actorRole ? ` · ${entry.actorRole}` : ""}</span></div>
          </li>; })}</ul>
        </div>) : <p className="rp-empty">Không có thao tác phù hợp.</p>}
        <Pager total={data.total} page={page} pageSize={data.pageSize} setPage={setPage} unit="thao tác" byTime />
      </section>
      <div className="rp-side rp-narrow">
        <section className="rp-card" aria-labelledby="rp-audit-actors">
          <h2 id="rp-audit-actors">Người thực hiện</h2>
          {data.actorCounts.length ? <div className="rp-actors">{data.actorCounts.map((item) => { const tint = actorTint(item.role); return <button key={item.name} type="button" className="rp-actor" aria-pressed={actor === item.name} style={vars({ "--tone": tint[1], "--soft": tint[0] })} onClick={() => setActor(actor === item.name ? "" : item.name)}>
            <Avatar name={item.name} tint={tint} size="lg" /><span><span><b>{item.name}</b>{item.role && <small>{item.role}</small>}</span><span className="rp-facet-bar" aria-hidden="true"><i style={{ width: `${(item.count / actorTotal) * 100}%` }} /></span></span><b>{countText(item.count)}</b>
          </button>; })}</div> : <p className="rp-empty">Chưa có thao tác nào được ghi.</p>}
        </section>
        <section className="rp-info" aria-label="Nhật ký ghi những gì"><span aria-hidden="true"><Icon name="shield" /></span>
          <div><b>Nhật ký ghi những gì</b><span>Thay đổi dữ liệu và cấu hình, gửi thông báo, xem bảng điểm và xuất báo cáo có tên sinh viên.</span><span>Lưu 1 năm; không lưu nội dung dữ liệu của sinh viên. Lịch sử đăng nhập xem ở Tài khoản.</span></div></section>
      </div>
    </div>
  </>;
}

const AUDIT_PAGE = 10;
/**
 * scoped: a cố vấn học tập, whose log holds their own actions and those about the students of their classes (the API
 * scopes it, user 2026-11-07: "Của mình + lớp mình").
 */
function AuditLogPage({ heading, scoped }: { heading?: ReactNode; scoped: boolean }) {
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const [kind, setKind] = useState<"" | AuditKind>("");
  const [page, setPage] = usePageFor(`${q}|${actor}|${kind}`);
  const params = new URLSearchParams({ page: String(page), pageSize: String(AUDIT_PAGE) });
  if (q) params.set("q", q);
  if (actor) params.set("actor", actor);
  if (kind) params.set("kind", kind);
  const state = useReport<AuditPage>(`${AUDIT_API}?${params}`);
  return <>
    <PageHead heading={heading} meta={scoped ? "Ai đã làm gì, lúc nào: thao tác của bạn và các thao tác liên quan đến sinh viên các lớp bạn phụ trách." : "Ai đã làm gì, lúc nào."} />
    <Loading state={state}>{(data) => <AuditView data={data} kind={kind} setKind={setKind} actor={actor} setActor={setActor} q={q} setQ={setQ} page={page} setPage={setPage} today={vietnamDay(new Date().toISOString())} />}</Loading>
  </>;
}

/* ------------------------------------------------------------------ the page */

/**
 * Every page of the Tổng quan group. `heading` is the workspace's eyebrow and title, drawn here so the filters and
 * "Cách tính" sit on its row.
 */
export default function AdminReports({ path, navigate, heading }: { path: string; navigate: (path: string) => void; heading?: ReactNode }) {
  const view = reportViewOf(path) ?? "dashboard";
  const [filters, setFilters] = useReportFilters();
  const options = useReport<ReportOptions>(`${REPORTS_API}/options`);
  const shell: Shell = { heading, filters, setFilters, options: options.data, navigate };
  return <div className="rp">
    <TooltipLayer root="rp" />
    {view === "dashboard" ? <DashboardPage shell={shell} />
      : view === "progress" ? <ProgressPage shell={shell} />
        : view === "risk" ? <RiskPage shell={shell} />
          : view === "skills" ? <SkillsPage shell={shell} />
            : view === "careers" ? <CareersPage shell={shell} />
              : view === "courses" ? <CoursesPage shell={shell} />
                : <AuditLogPage heading={heading} scoped={Boolean(options.data?.scope)} />}
  </div>;
}
