import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminReports, {
  AuditView, AveragesTable, CareersView, CoursesView, DashboardView, HeadFilters, PageHead, ProgressView, RiskView, SkillsView, advisorScopeText, auditDays, bandParts, careerShares,
  creditsText, dataBaseText, dayLabel, fitParts, fitWord, gpaColumnTip, helpLines, meanFit, metaText, progressParts, updatedText, vietnamDay,
} from "./AdminReports";
import { EMPTY_FILTERS, apiFilters, fileNameFrom, filtersFromSearch, filtersToSearch, reportErrorText, reportUrl, type ReportState } from "./admin-report-api";
import { ColumnChart, Radar, ShareColumns, StackBar, axisStep, heatColor } from "./admin-report-charts";
import type {
  AuditEntry, AuditPage, AverageRow, CareerRow, CareersReport, CohortSplit, CoursesReport, DashboardKpis, DashboardReport, FitSummary, GpaBands, GpaPoint, ProgressCounts, ProgressReport, ReportHead,
  RiskReport, SkillsReport,
} from "./admin-report-types";

// Synthetic report data only: two cohorts, invented names and codes.

const term = (code: string) => ({ code, label: `HK${code[4]} 20${code.slice(2, 4)}–20${Number(code.slice(2, 4)) + 1}` });
const head: ReportHead = { generatedAt: "2026-10-31T02:15:00.000Z", studyTerm: term("HK261"), scope: { students: 486, withTranscript: 224, withData: 223, assessed: 186 } };
const kpi = (extra: Partial<DashboardKpis> = {}): DashboardKpis => ({
  students: 486, withTranscript: 224, withData: 223, assessed: 186, gpa: 2.873, gpaChange: 0.031, gpaChangeFrom: term("HK252"),
  competency: 67.86, competencyLevel: "Khá", fit: 61.24, fitLabel: "Ít phù hợp", risk: 51, warn: 40, ...extra,
});
const split = <T extends object>(all: T, k29: T, k30: T): CohortSplit<T> => ({ all, byCohort: [{ cohort: "K29", ...k29 }, { cohort: "K30", ...k30 }] });
const points = (shift: number): GpaPoint[] => [
  { term: term("HK241"), termGpa: 2.6 + shift, termStudents: 120, cumulativeGpa: 2.8 + shift },
  { term: term("HK242"), termGpa: 2.7 + shift, termStudents: 118, cumulativeGpa: 2.84 + shift },
  { term: term("HK251"), termGpa: null, termStudents: 0, cumulativeGpa: 2.87 + shift },
];
const bands = (scale: number): GpaBands => ({ bands: [
  { label: "Xuất sắc", range: "từ 3,60", students: 5 * scale }, { label: "Giỏi", range: "3,20–3,59", students: 20 * scale }, { label: "Khá", range: "2,50–3,19", students: 50 * scale },
  { label: "Trung bình", range: "2,00–2,49", students: 15 * scale }, { label: "Yếu", range: "dưới 2,00", students: 2 * scale },
], withTranscript: 93 * scale, withData: 92 * scale });
const fit = (average: number): FitSummary => ({
  average, label: fitWord(average),
  levels: [{ label: "Rất phù hợp", students: 3 }, { label: "Phù hợp", students: 20 }, { label: "Trung bình", students: 60 }, { label: "Ít phù hợp", students: 15 }, { label: "Không phù hợp", students: 2 }],
  careers: [{ name: "Kỹ sư phần mềm", students: 30, average: 72.4 }, { name: "Chuyên viên phân tích dữ liệu", students: 25, average: 66.1 }],
});
const progress = (scale: number): ProgressCounts => ({ total: 100 * scale, onTrack: 60 * scale, late: 20 * scale, unknown: 5 * scale, noTranscript: 15 * scale });
const average = (extra: Partial<AverageRow>): AverageRow => ({
  key: "K29", label: "K29", students: 120, withTranscript: 78, withData: 77, gpa: 3.06, lastTermGpa: 3.08, credits: 107.4, below2: 0, assessed: 60, competency: 67.4, competencyLevel: "Khá",
  fit: 74.2, fitLabel: "Trung bình", late: 12, risk: 4, warn: 9, ...extra,
});
const dashboard: DashboardReport = {
  ...head,
  kpis: split(kpi(), kpi({ students: 140, gpa: 2.91 }), kpi({ students: 130, gpa: 2.8, competency: null, competencyLevel: null })),
  gpaByTerm: split({ points: points(0) }, { points: points(0.05) }, { points: points(-0.05).slice(1) }),
  gpaBands: split(bands(2), bands(1), bands(1)),
  averages: [
    { by: "cohort", rows: [average({}), average({ key: "K30", label: "K30", students: 90, withTranscript: 58, withData: 58, gpa: 2.98, assessed: 41, competency: 66, fit: 68, late: 7, risk: 2, warn: 3 })],
      all: average({ key: "all", label: "Tất cả", students: 210, withTranscript: 136, withData: 135, gpa: 3.01, assessed: 101, competency: 67, fit: 70.5, late: 19, risk: 6, warn: 12 }) },
    { by: "major", rows: [], all: average({ key: "all", label: "Tất cả", students: 0, withTranscript: 0, withData: 0, gpa: null, assessed: 0, competency: null, competencyLevel: null, fit: null, fitLabel: null, late: 0, risk: 0, warn: 0 }) },
  ],
  competencyGroups: split(
    { groups: [{ name: "Chuyên môn", score: 67.8, level: "Khá", students: 186 }, { name: "Kiến thức nền tảng", score: 61.1, level: "Trung bình", students: 186 }, { name: "Kỹ năng mềm", score: 72.8, level: "Khá", students: 186 }],
      lowest: [{ name: "Tiếng Anh chuyên ngành", group: "Kỹ năng mềm", score: 57.8, students: 150 }], highest: [{ name: "Làm việc nhóm", group: "Kỹ năng mềm", score: 80.4, students: 186 }] },
    { groups: [{ name: "Chuyên môn", score: 69.2, level: "Khá", students: 90 }], lowest: [], highest: [] },
    { groups: [{ name: "Chuyên môn", score: 64.1, level: "Khá", students: 70 }], lowest: [], highest: [] }),
  fit: split(fit(61.24), fit(70.5), fit(55)),
  progress: split(progress(2), progress(1), progress(1)),
};
const entry = (extra: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "a1", at: "2026-10-31T02:12:00.000Z", actorName: "Phạm Thu Trang", actorRole: "Ban chủ nhiệm khoa", kind: "report", action: "Xuất Excel",
  summary: "Sinh viên có nguy cơ chậm tiến độ (khóa K29, 18 dòng)", ...extra,
});
const audit: AuditPage = {
  page: 1, pageSize: 20, total: 41, actors: ["Lê Quốc Bảo", "Phạm Thu Trang"],
  items: [entry(), entry({ id: "a2", at: "2026-10-31T01:05:00.000Z", actorName: "Lê Quốc Bảo", actorRole: "Cố vấn học tập", kind: "access", action: "Xem bảng điểm", summary: "Bảng điểm của Trần Minh An" }),
    entry({ id: "a3", at: "2026-10-30T09:40:00.000Z", kind: "training", action: "Cập nhật kế hoạch đào tạo", summary: "Kế hoạch đào tạo khóa 29" })],
  days: [{ date: "2026-10-30", count: 9, access: 2, report: 1 }, { date: "2026-10-31", count: 2, access: 1, report: 1 }],
  kinds: [{ kind: "access", count: 20 }, { kind: "report", count: 12 }, { kind: "training", count: 9 }],
  actorCounts: [{ name: "Phạm Thu Trang", role: "Ban chủ nhiệm khoa", count: 30 }, { name: "Lê Quốc Bảo", role: "Cố vấn học tập", count: 11 }],
};
const loaded = <T,>(data: T): ReportState<T> => ({ data, error: null, loading: false, retry: () => undefined });

const noop = () => undefined;
const plainHeader = (label: unknown) => <th>{String(label)}</th>;

afterEach(() => vi.unstubAllGlobals());

describe("the head of a report page", () => {
  const options = { cohorts: ["K29", "K30"], majors: [{ code: "7480201", name: "Công nghệ thông tin" }], specialties: [{ code: "CNPM", name: "Công nghệ phần mềm", majorCode: "7480201" }], studyTerm: null };

  it("says under the title that an advisor's numbers are those of their classes (user 2026-11-07)", () => {
    expect(advisorScopeText(["71K29CNTT08", "71K29CNTT09"])).toBe("Số liệu chỉ gồm sinh viên các lớp bạn phụ trách: 71K29CNTT08, 71K29CNTT09.");
    expect(advisorScopeText([])).toBe("Bạn chưa phụ trách lớp nào nên chưa có số liệu.");
    const own = renderToStaticMarkup(<PageHead meta="x" scope={{ classes: ["71K29CNTT08"] }} />);
    expect(own).toContain('<p class="rp-scope">Số liệu chỉ gồm sinh viên các lớp bạn phụ trách: 71K29CNTT08.</p>');
    expect(renderToStaticMarkup(<PageHead meta="x" scope={null} />)).not.toContain("rp-scope");
  });

  it("carries the portal's title, one line under it, the three filters and a closed Cách tính", () => {
    const html = renderToStaticMarkup(<PageHead heading={<h1>Thống kê</h1>} meta={metaText(head, null)} help={helpLines("dashboard", head)}
      filters={<HeadFilters filters={{ ...EMPTY_FILTERS, cohort: "K29" }} setFilters={noop} options={options} />} />);
    expect(html).toContain('<div class="am-page-heading rp-heading"><div class="rp-heading-text"><h1>Thống kê</h1><p class="rp-head-meta">Học kỳ đang học: HK1 2026–2027 · Cập nhật 09:15 31/10/2026</p></div>');
    expect(html).toContain('role="search" aria-label="Lọc dữ liệu thống kê"');
    for (const id of ["rp-cohort", "rp-major", "rp-specialty"]) expect(html).toContain(`<select id="${id}">`);
    expect(html).toContain('<option value="K29" selected="">K29</option>');
    // "Xóa bộ lọc" only while a filter is set; the explanation stays folded until asked for.
    expect(html).toContain(">Xóa bộ lọc</button>");
    expect(renderToStaticMarkup(<HeadFilters filters={{ ...EMPTY_FILTERS, q: "an" }} setFilters={noop} options={options} />)).not.toContain("Xóa bộ lọc");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("rp-help");
    expect(metaText(null, term("HK261"))).toBe("Học kỳ đang học: HK1 2026–2027");
  });

  it("names the bases of the figures once per page, with the counts of the loaded report (QA 2026-11-04)", () => {
    const lines = helpLines("dashboard", head);
    expect(lines[0]).toContain("(224/486 sinh viên đã tải bảng điểm), chưa xác minh.");
    // A transcript without data counts as uploaded and is named apart.
    expect(lines[0]).toContain("1 bảng điểm chưa đọc được GPA tích lũy nên không tính vào điểm, xếp loại và tiến độ.");
    expect(lines[1]).toContain("(186 sinh viên đã đánh giá)");
    expect(lines[2]).toContain("không dùng AI");
    expect(helpLines("dashboard", { ...head, scope: { ...head.scope, withData: 224 } })[0]).not.toContain("chưa đọc được");
    expect(helpLines("progress", null).join(" ")).not.toMatch(/\d+\/\d+/);
    for (const view of ["progress", "risk", "skills", "careers", "courses"] as const) expect(helpLines(view, head).length).toBeGreaterThanOrEqual(3);
    expect(dataBaseText(13, 14)).toBe("Dựa trên 13/14 bảng điểm có dữ liệu");
    expect(updatedText("2026-10-31T02:15:00.000Z")).toBe("09:15 31/10/2026");
    expect(updatedText(null)).toBe("—");
  });
});

describe("report requests", () => {
  it("keep the filters in the address bar and send them to the API", () => {
    const filters = filtersFromSearch("?cohort=K29&major=7480201&q=%20an%20&other=1");
    expect(filters).toEqual({ q: "an", cohort: "K29", major: "7480201", specialty: "" });
    expect(filtersToSearch(filters)).toBe("?q=an&cohort=K29&major=7480201");
    expect(filtersToSearch(EMPTY_FILTERS)).toBe("");
    expect(apiFilters({ ...EMPTY_FILTERS, specialty: "software" })).toEqual({ specialty: "software" });
    expect(reportUrl("/progress", filters, { status: "late", page: 2, sort: null, dir: undefined })).toBe("/api/admin/reports/progress?q=an&cohort=K29&major=7480201&status=late&page=2");
    expect(reportUrl("/risk", EMPTY_FILTERS, { level: null, kind: "gpa_below", page: 1, pageSize: 8 })).toBe("/api/admin/reports/risk?kind=gpa_below&page=1&pageSize=8");
    expect(reportUrl("/options", EMPTY_FILTERS)).toBe("/api/admin/reports/options");
  });

  it("name a download after the server's file and explain failures in Vietnamese", () => {
    expect(fileNameFrom("attachment; filename=\"tien-do.xlsx\"; filename*=UTF-8''B%C3%A1o-c%C3%A1o%20ti%E1%BA%BFn%20%C4%91%E1%BB%99.xlsx", "x.xlsx")).toBe("Báo-cáo tiến độ.xlsx");
    expect(fileNameFrom("attachment; filename=\"nguy-co.xlsx\"", "x.xlsx")).toBe("nguy-co.xlsx");
    expect(fileNameFrom("attachment; filename=\"../../etc/a.xlsx\"", "x.xlsx")).toBe("..-..-etc-a.xlsx");
    expect(fileNameFrom(null, "bao-cao.xlsx")).toBe("bao-cao.xlsx");
    expect(reportErrorText(403, "insufficient_role")).toBe("Bạn không có quyền xem thống kê này.");
    expect(reportErrorText(500, undefined)).toBe("Không tải được thống kê. Vui lòng thử lại.");
  });
});

describe("report helpers", () => {
  it("order statuses, bands and fit words and colour them the same on every page", () => {
    expect(progressParts(progress(1)).map((part) => `${part.label}:${part.value}`)).toEqual(["Đúng tiến độ:60", "Trễ kế hoạch:20", "Chưa đủ dữ liệu:5", "Chưa có bảng điểm:15"]);
    expect(bandParts({ bands: [{ label: "Yếu", range: "dưới 2,00", students: 4 }], withTranscript: 5, withData: 4 }).map((part) => part.value)).toEqual([0, 0, 0, 0, 4]);
    expect(fitParts(fit(70).levels).map((part) => part.label)).toEqual(["Rất phù hợp", "Phù hợp", "Trung bình", "Ít phù hợp", "Không phù hợp"]);
    expect(fitParts([{ label: "Phù hợp", students: 10 }]).map((part) => part.value)).toEqual([0, 10, 0, 0, 0]);
    // Best to worst runs from teal to red, for học lực and for fit.
    expect(bandParts(bands(1))[0]!.color).toBe(fitParts(fit(70).levels)[0]!.color);
    expect(bandParts(bands(1))[4]!.color).toBe("#c4352b");
    expect(fitWord(62.4)).toBe("Ít phù hợp");
    expect(fitWord(62.5)).toBe("Trung bình");
    expect(gpaColumnTip(dashboard.gpaByTerm.all.points, 2)).toBe("HK1 2025–2026\nGPA TB học kỳ: — (0 sinh viên có điểm)\nGPA TB tích lũy: 2,87");
    expect(heatColor(0, 10)).toEqual({ background: "transparent", color: "#667085" });
    expect(heatColor(10, 10).background).toBe("rgba(58, 106, 212, 0.62)");
    expect(heatColor(5, 10).background).toBe("rgba(58, 106, 212, 0.38)");
    expect(axisStep(140)).toBe(25);
    expect(axisStep(4)).toBe(1);
  });

  it("sum up the careers for the donut and the strip", () => {
    const row = (name: string, students: number, score: number | null): CareerRow => ({ name, students, average: score, levels: [], topGaps: [] });
    const rows = [row("A", 10, 80), row("B", 8, 70), row("C", 6, 60), row("D", 4, 50), row("E", 3, 40), row("F", 2, 90), row("G", 1, null)];
    // The five most chosen careers, every other one together.
    expect(careerShares(rows).map((part) => `${part.label}:${part.value}`)).toEqual(["A:10", "B:8", "C:6", "D:4", "E:3", "Vị trí khác:3"]);
    expect(careerShares(rows.slice(0, 3)).map((part) => part.label)).toEqual(["A", "B", "C"]);
    // Each career's mean weighs as many students as chose it; a career without a mean is left out.
    expect(meanFit([row("A", 3, 80), row("B", 1, 40), row("C", 5, null)])).toBe(70);
    expect(meanFit([])).toBeNull();
    expect(creditsText({ students: 12, passed: 81.6, expected: 104, total: 150 })).toBe("82/104 TC");
    expect(creditsText({ students: 0, passed: null, expected: null, total: null })).toBe("chưa có");
  });

  it("group the log by Vietnam day and name each day", () => {
    expect(vietnamDay("2026-11-20T17:30:00.000Z")).toBe("2026-11-21");
    expect(vietnamDay("2026-11-20T16:59:59.000Z")).toBe("2026-11-20");
    expect(dayLabel("2026-11-21", "2026-11-21")).toBe("Hôm nay · Thứ Bảy 21/11/2026");
    expect(dayLabel("2026-11-15", "2026-11-21")).toBe("Chủ nhật 15/11/2026");
    expect(auditDays(audit.items).map((group) => [group.day, group.items.map((item) => item.id)])).toEqual([["2026-10-31", ["a1", "a2"]], ["2026-10-30", ["a3"]]]);
  });
});

describe("charts", () => {
  it("draw stacked columns with the total above, a tooltip on every part and each column's parts in words", () => {
    const html = renderToStaticMarkup(<ColumnChart label="Theo khóa" columns={[
      { key: "K29", label: "K29", parts: progressParts({ total: 26, onTrack: 9, late: 2, unknown: 3, noTranscript: 12 }), strong: true }, { key: "K30", label: "K30", parts: progressParts(progress(0)) }]} />);
    expect(html).toContain('aria-label="K29: 26 sinh viên (Đúng tiến độ 9, Trễ kế hoạch 2, Chưa đủ dữ liệu 3, Chưa có bảng điểm 12)"');
    expect(html).toContain('data-tip="K29\nTrễ kế hoạch: 2 sinh viên"');
    expect(html).toContain('class="rp-colchart-total">26</text>');
    expect(html).toContain('class="rp-colchart-label rp-strong">K29</text>');
    expect(html).toContain('aria-label="K30: 0 sinh viên"');
    // The axis reaches the tallest column on round steps.
    expect(html).toContain(">30</text>");
  });

  it("number the columns of a ranking and mark the picked one", () => {
    const html = renderToStaticMarkup(<ColumnChart ranks label="Môn" selected="B" onSelect={noop} columns={[
      { key: "A", label: "A", name: "Học máy (A)", parts: [{ label: "Học mới", value: 5, color: "#3a6ad4" }] }, { key: "B", label: "B", name: "Kiểm thử (B)", parts: [{ label: "Học mới", value: 3, color: "#3a6ad4" }] }]} />);
    expect(html).toContain('role="button" tabindex="0" aria-pressed="false" aria-label="Hạng 1: Học máy (A): 5 sinh viên"');
    expect(html).toContain('aria-pressed="true" aria-label="Hạng 2: Kiểm thử (B): 3 sinh viên"');
    expect(html).toContain('class="rp-colchart-rank rp-picked"');
  });

  it("say every 100% column, bar and radar vertex in words", () => {
    const columns = renderToStaticMarkup(<ShareColumns label="Tiến độ" columns={[{ key: "K29", label: "K29", sub: "26 SV", parts: progressParts({ total: 26, onTrack: 9, late: 2, unknown: 3, noTranscript: 12 }) }]} />);
    expect(columns).toContain('aria-label="K29: 26 sinh viên (Đúng tiến độ 9, Trễ kế hoạch 2, Chưa đủ dữ liệu 3, Chưa có bảng điểm 12)"');
    expect(columns).toContain("Trễ kế hoạch: 2 (8%)");
    expect(columns).toContain("<small>26 SV</small>");
    const bar = renderToStaticMarkup(<StackBar label="Mức" parts={[{ label: "Nguy cơ", value: 3, color: "#c4352b" }, { label: "Cần chú ý", value: 0, color: "#d4901f" }]} />);
    expect(bar).toContain('role="img" aria-label="Mức: Nguy cơ 3, Cần chú ý 0"');
    expect(bar).toContain('data-tip="Nguy cơ: 3 (100%)"');
    expect(renderToStaticMarkup(<StackBar label="Mức" parts={[]} />)).toContain('aria-label="Mức: chưa có"');
    const radar = renderToStaticMarkup(<Radar label="Kỹ năng" what="sinh viên còn thiếu" selected="SQL" onSelect={noop}
      axes={[{ key: "Docker", name: "Docker", share: 40 }, { key: "SQL", name: "SQL", share: 22.4 }, { key: "Git", name: "Git", share: 10 }]} />);
    expect(radar).toContain('aria-pressed="true" aria-label="Hạng 2: SQL: 22% sinh viên còn thiếu"');
    // The scale ends on a round share above the biggest one: 40% draws on 15, 30, 45.
    for (const text of ["15%", "30%", "45%"]) expect(radar).toContain(`>${text}</text>`);
  });
});

describe("Thống kê", () => {
  const html = renderToStaticMarkup(<DashboardView data={dashboard} navigate={noop} recent={loaded(audit)} cohort="K30" />);

  it("lays out the cards of the approved preview, without the Toàn khóa and Từng khóa switches", () => {
    for (const title of ["Điểm trung bình theo học kỳ", "Xếp loại học lực", "Tiến độ học tập theo khóa", "Năng lực theo nhóm", "Độ phù hợp với vị trí nghề nghiệp", "Bảng thống kê", "Hoạt động gần đây"]) expect(html).toContain(`>${title}</h2>`);
    expect(html).not.toContain("Từng khóa");
    expect(html).not.toContain("Toàn khóa</button>");
    expect(html).not.toContain("Thao tác gần đây");
    expect(html).not.toContain("rp-coverage");
  });

  it("shows the headline numbers in the pages' formats and colours each word by its meaning", () => {
    expect(html).toContain('<b class="rp-kpi-value">486</b>');
    expect(html).toContain("224 đã tải bảng điểm · 186 đã đánh giá năng lực");
    // The base of the GPA stays one hover away, the same words as before.
    expect(html).toContain('<b class="rp-kpi-value" data-tip="Dựa trên 223/224 bảng điểm có dữ liệu" tabindex="0">2,87<small>/ 4</small></b>');
    // Scores are cut to one decimal, never rounded up, as on the student's pages (display-format.ts scoreText).
    expect(html).toContain('<b class="rp-kpi-value">67,8<small>/ 100</small></b>');
    expect(html).toContain('<b class="rp-kpi-value">61,2<small>/ 100</small></b>');
    expect(html).toContain("▲ 0,03</span> so với HK2 2025–2026");
    expect(html).toContain('<span class="rp-chip meaning-warn">Ít phù hợp</span>');
    expect(html).toContain('<span class="rp-chip meaning-fine">Khá</span>');
    expect(html).toContain('<b class="rp-kpi-value">91</b>');
    expect(html).toContain(">51 nguy cơ</span>");
    expect(html).toContain('<a class="rp-link" href="/quantri/bao-cao-nguy-co" aria-label="Xem sinh viên có cảnh báo">Xem</a>');
  });

  it("draws the charts with their numbers beside them", () => {
    // The legend of the GPA chart carries the newest values of both lines.
    expect(html).toContain("GPA TB tích lũy<b>2,87</b>");
    expect(html).toContain("GPA TB học kỳ<b>2,70</b>");
    // Xếp loại học lực: the transcripts with data in the middle, every band with its range, count and share.
    expect(html).toContain('data-tip="Dựa trên 184/186 bảng điểm có dữ liệu"');
    expect(html).toContain(">184</text>");
    expect(html).toContain("<span>Khá <small>2,50–3,19</small></span><b>100</b><small>54%</small>");
    // Tiến độ theo khóa: the legend counts the scope, each cohort is a column, the chosen cohort is marked.
    expect(html).toContain("Đúng tiến độ<b>120</b>");
    expect(html).toContain('aria-label="K29: 100 sinh viên (Đúng tiến độ 60, Trễ kế hoạch 20, Chưa đủ dữ liệu 5, Chưa có bảng điểm 15)"');
    expect(html).toContain('<b class="rp-strong">K30</b><small>100 SV</small>');
    expect(html).toContain('href="/quantri/bao-cao-tien-do">Xem danh sách</a>');
    // Năng lực theo nhóm and the weakest skill; fit with the careers chosen most.
    expect(html).toContain('data-tip="Kiến thức nền tảng: 61,1 / 100 · 186 sinh viên"');
    expect(html).toContain("<span>Tiếng Anh chuyên ngành</span>");
    expect(html).toContain("<span>Kỹ sư phần mềm</span><small>30 SV</small><b>72,4</b>");
    expect(html).toContain(">61,2</text>");
  });

  it("lists the newest log entries without their summaries", () => {
    expect(html).toContain("<b>Xem bảng điểm</b>");
    expect(html).toContain("<small>Lê Quốc Bảo · 08:05 31/10/2026</small>");
    // A summary can name a student: it stays on Nhật ký.
    expect(html).not.toContain("Trần Minh An");
    expect(html).toContain('href="/quantri/nhat-ky">Mở Nhật ký</a>');
    const waiting = renderToStaticMarkup(<DashboardView data={dashboard} navigate={noop} recent={null} />);
    expect(waiting).toContain("Đang tải…");
    expect(renderToStaticMarkup(<DashboardView data={dashboard} navigate={noop} recent={loaded({ ...audit, items: [] })} />)).toContain("Chưa có thao tác nào được ghi.");
  });

  it("writes Bảng thống kê with counts that add up to its last row and the base of each average", () => {
    const table = renderToStaticMarkup(<AveragesTable table={dashboard.averages[0]!} />);
    expect(table).toContain('aria-label="Bảng thống kê theo khóa"');
    for (const column of ["Sinh viên", "Đã tải bảng điểm", "GPA TB", "Năng lực TB", "Phù hợp TB", "Trễ kế hoạch", "Có cảnh báo"]) expect(table).toContain(`>${column}<`);
    expect(table).toContain('<th scope="row">K29</th><td class="rp-num">120</td><td class="rp-num">78 <small>(65%)</small></td>');
    expect(table).toContain('data-tip="GPA tích lũy trung bình của 77/78 bảng điểm có dữ liệu"');
    expect(table).toContain('data-tip="60 sinh viên đã đánh giá năng lực"');
    expect(table).toContain('<td class="rp-num">12</td><td class="rp-num" data-tip="Nguy cơ: 4\nCần chú ý: 9">13</td>');
    expect(table).toContain('<tfoot><tr><th scope="row">Toàn khóa</th><td class="rp-num">210</td>');
    const byMajor = renderToStaticMarkup(<AveragesTable table={dashboard.averages[1]!} />);
    expect(byMajor).toContain("Chưa có sinh viên trong phạm vi lọc.");
    expect(byMajor).not.toContain("<tfoot>");
  });
});

describe("Tiến độ", () => {
  const report: ProgressReport = {
    ...head, counts: split(progress(2), progress(1), progress(1)),
    credits: split({ students: 160, passed: 96.4, expected: 98, total: 150 }, { students: 80, passed: 110.2, expected: 104, total: 150 }, { students: 0, passed: null, expected: null, total: null }),
    page: { page: 1, pageSize: 10, total: 2, items: [
      { userId: "u1", studentCode: "2374802019001", name: "Trần Minh An", cohort: "K29", majorName: "Công nghệ thông tin", specialtyName: "Công nghệ phần mềm", status: "late", passedCredits: 86, totalCredits: 150, expectedCredits: 117, gpa: 2.45, risk: "warn" },
      { userId: "u2", studentCode: null, name: "Lê Thu Hà", cohort: "K30", majorName: null, specialtyName: null, status: "no_transcript", passedCredits: null, totalCredits: null, expectedCredits: null, gpa: null, risk: null },
    ] },
  };
  const view = (status: "all" | "late") => renderToStaticMarkup(<ProgressView data={report} status={status} setStatus={noop} q="" setQ={noop} page={1} setPage={noop} pageSize={10} sortHeader={plainHeader}
    exportUrl="/api/admin/reports/progress.xlsx" navigate={noop} cohort="K29" />);

  it("counts every status in a block that filters the list", () => {
    const html = view("late");
    expect(html).toContain(">Tình trạng tiến độ của 200 sinh viên</h2>");
    expect(html).toContain('aria-pressed="true" style="--tone:#d4901f;--soft:#fff3d9"><span class="rp-block-top"><b>40</b><span>20%</span></span>');
    expect(html.match(/class="rp-block" aria-pressed="false"/g)).toHaveLength(3);
    expect(html).toContain('<h2 id="rp-progress-list">Sinh viên trễ kế hoạch <span class="rp-count">2</span></h2>');
    expect(view("all")).toContain('<h2 id="rp-progress-list">Danh sách sinh viên <span class="rp-count">2</span></h2>');
  });

  it("compares the cohorts by students and by credits against the plan", () => {
    const html = view("all");
    expect(html).toContain(">Số sinh viên theo khóa</h2>");
    expect(html).toContain('class="rp-colchart-label rp-strong">K29</text>');
    // 120 of the 160 students who can be compared with the plan are on track.
    expect(html).toContain("<b>120/160</b> sinh viên so được với kế hoạch");
    expect(html).toContain('aria-label="Sinh viên đạt đủ tín chỉ kế hoạch: 75%"');
    expect(html).toContain('<b class="rp-picked-text">K29</b>');
    expect(html).toContain("<span>110/104 TC</span>");
    expect(html).toContain('data-tip="K30: chưa có sinh viên so được với kế hoạch"');
    expect(html).toContain("<span>chưa có</span>");
  });

  it("lists students with credits against the plan, a search box and an Excel export", () => {
    const html = view("all");
    expect(html).toContain("Tìm sinh viên");
    expect(html).toContain('placeholder="MSSV hoặc họ tên"');
    expect(html).toContain("Xuất Excel");
    expect(html).toContain("86/150 TC · kế hoạch 117");
    expect(html).toContain('<span class="rp-badge rp-badge-warn">Trễ kế hoạch</span><span class="rp-badge rp-badge-warn">Cần chú ý</span>');
    expect(html).toContain('<small class="rp-code">Chưa có MSSV</small>');
    expect(html).toContain('aria-hidden="true" style="background:');
    // "Xem hồ sơ" on every row opens the student's details on the Sinh viên page (user, 2026-10-31).
    expect(html).toContain('<a class="rp-link" href="/quantri/sinh-vien?id=u1" aria-label="Xem hồ sơ của Trần Minh An">Xem hồ sơ</a>');
    expect(html).toContain('href="/quantri/sinh-vien?id=u2"');
    expect(html).toContain("Hiển thị 1–2 trong 2 sinh viên");
    expect(html).toContain("Trang 1/1");
  });
});

describe("Nguy cơ", () => {
  const risk: RiskReport = {
    ...head, counts: split({ total: 2, risk: 1, warn: 1 }, { total: 1, risk: 1, warn: 0 }, { total: 1, risk: 0, warn: 1 }),
    reasons: split({ items: [{ kind: "failed_course", label: "Môn bắt buộc chưa đạt", students: 1 }, { kind: "late_course", label: "Trễ môn so với KHĐT", students: 1 }] },
      { items: [{ kind: "failed_course", label: "Môn bắt buộc chưa đạt", students: 1 }] }, { items: [{ kind: "late_course", label: "Trễ môn so với KHĐT", students: 1 }] }),
    page: { page: 1, pageSize: 8, total: 1, items: [{ userId: "u1", studentCode: "2374802019001", name: "Trần Minh An", cohort: "K29", majorName: null, specialtyName: "Công nghệ phần mềm", level: "risk", gpa: 1.95,
      reasons: [{ kind: "failed_course", level: "risk", text: "Môn bắt buộc chưa đạt: Cơ sở dữ liệu" }, { kind: "gpa_below", level: "risk", text: "GPA tích lũy 1,95, dưới 2,00" }] }] },
  };
  const view = (kind: "gpa_below" | null) => renderToStaticMarkup(<RiskView data={risk} level="risk" setLevel={noop} kind={kind} setKind={noop} q="" setQ={noop} page={1} setPage={noop} pageSize={8}
    exportUrl="/api/admin/reports/risk.xlsx" navigate={noop} />);

  it("counts the flagged students by level, reason and cohort, each one a filter of the list", () => {
    const html = view("gpa_below");
    expect(html).toContain('<h2 id="rp-risk-count">Sinh viên có cảnh báo</h2><b>2</b>');
    expect(html).toContain("1% trong 224 sinh viên<br/>có bảng điểm");
    expect(html).toContain('<button type="button" class="rp-tile rp-tile-risk" aria-pressed="true"><b>1</b>');
    expect(html).toContain('<button type="button" class="rp-tile rp-tile-warn" aria-pressed="false">');
    // The five reasons in their order; a reason nobody has counts 0, the chosen one is pressed.
    expect(html.match(/class="rp-facet"/g)).toHaveLength(5);
    expect(html).toContain('aria-pressed="true" style="--tone:#c4352b"><i class="rp-dot" aria-hidden="true"></i><span>GPA dưới ngưỡng</span>');
    expect(html).toContain("<span>Không kịp tín chỉ</span>");
    expect(html).toContain('aria-label="K29: sinh viên có cảnh báo: Nguy cơ 1, Cần chú ý 0"');
    expect(html).toContain('<span>Lý do: GPA dưới ngưỡng</span>');
    expect(view(null)).not.toContain("Lý do: ");
  });

  it("shows each student on a card with every reason in words", () => {
    const html = view(null);
    expect(html).toContain('<h2 id="rp-risk-list">Sinh viên cần theo dõi <span class="rp-count">1</span></h2>');
    expect(html).toContain("<b>Trần Minh An</b><small>2374802019001 · K29 · Công nghệ phần mềm</small>");
    expect(html).toContain('<span class="rp-badge rp-badge-bad">Nguy cơ</span>');
    expect(html).toContain("<span>Môn bắt buộc chưa đạt: Cơ sở dữ liệu</span>");
    expect(html).toContain("<span>GPA tích lũy 1,95, dưới 2,00</span>");
    expect(html).toContain("GPA tích lũy <b>1,95</b>");
    expect(html).toContain('href="/quantri/sinh-vien?id=u1" aria-label="Xem hồ sơ của Trần Minh An"');
    expect(html).toContain("Xuất Excel");
    expect(html).toContain("Nguy cơ<b>1</b>");
    const none = renderToStaticMarkup(<RiskView data={{ ...risk, page: { ...risk.page, total: 0, items: [] } }} level="all" setLevel={noop} kind={null} setKind={noop} q="x" setQ={noop} page={1} setPage={noop} pageSize={8} exportUrl="/x" navigate={noop} />);
    expect(none).toContain("Không có sinh viên nào có cảnh báo trong phạm vi lọc.");
    expect(none).toContain("Không có sinh viên nào");
  });
});

describe("Kỹ năng thiếu, Vị trí mục tiêu, Môn đề xuất", () => {
  const gap = (name: string, scale: number) => ({ name, below: 2 * scale, notStudied: 3 * scale, selfStudy: 10 * scale, noData: scale, total: 16 * scale });
  const skills: SkillsReport = { ...head, careers: ["Kỹ sư dữ liệu"], skills: split(
    { items: [gap("Docker", 2), gap("SQL", 1), gap("Git", 1)] }, { items: [gap("Docker", 1), gap("SQL", 1), gap("Git", 0)] }, { items: [gap("Docker", 1), gap("SQL", 0), gap("Git", 1)] }) };
  const students = loaded({ skill: "SQL", items: [{ userId: "u1", studentCode: "2374802019001", name: "Trần Minh An", cohort: "K29", majorName: null, specialtyName: null, careerName: "Kỹ sư dữ liệu",
    status: "self_study" as const, fitScore: 58.4, fitLabel: "Ít phù hợp" }] });

  it("ranks the missing skills, draws them on a radar and a heat table, and names the students of the picked one", () => {
    const html = renderToStaticMarkup(<SkillsView data={skills} career="" setCareer={noop} selected="SQL" setSelected={noop} students={students} exportUrl="/x.xlsx" navigate={noop} />);
    expect(html).toContain(">Xếp hạng kỹ năng còn thiếu</h2><p>186 sinh viên đã đánh giá năng lực · bấm một kỹ năng để xem sinh viên</p>");
    expect(html).toContain('aria-pressed="true"><span class="rp-rank rp-rank-top" aria-hidden="true">2</span><span>SQL</span>');
    expect(html).toContain("<b>32</b><small> · 17%</small>");
    expect(html).toContain('aria-label="Docker: Dưới ngưỡng 4, Chưa học 6, Cần tự học ngoài chương trình 20, Chưa có điểm 2"');
    expect(html).toContain("Tỉ lệ sinh viên đã đánh giá còn thiếu, 3 kỹ năng đứng đầu");
    expect(html).toContain('aria-label="Hạng 1: Docker: 17% sinh viên đã đánh giá còn thiếu"');
    // The heat table: every skill by cohort, the picked row marked.
    expect(html).toContain('<tr class="rp-picked"><th scope="row">SQL</th><td data-tip="SQL · K29: 16 sinh viên còn thiếu">');
    expect(html).toContain('<td data-tip="SQL · K30: 0 sinh viên còn thiếu"><span style="background:transparent;color:#667085">0</span></td><td class="rp-heat-total">16</td>');
    expect(html).toContain('<p class="rp-pick-eyebrow">Kỹ năng đang chọn · hạng 2</p><h2 id="rp-skill-picked" class="rp-pick-title">SQL</h2>');
    expect(html).toContain('<div class="rp-pick-tile rp-tone-violet"><b>10</b><span>Cần tự học</span></div>');
    expect(html).toContain("1 sinh viên còn thiếu</h3>");
    expect(html).toContain("<b>Trần Minh An</b><small>2374802019001 · K29 · Kỹ sư dữ liệu</small>");
    expect(html).toContain('<span class="rp-badge rp-badge-violet">Cần tự học</span><a class="rp-link" href="/quantri/sinh-vien?id=u1"');
    expect(html).toContain("Xuất Excel");
  });

  it("picks the first skill until one is chosen and says when there is nothing to draw", () => {
    const first = renderToStaticMarkup(<SkillsView data={skills} career="" setCareer={noop} selected={null} setSelected={noop} students={null} exportUrl="/x.xlsx" navigate={noop} />);
    expect(first).toContain("Kỹ năng đang chọn · hạng 1</p>");
    const two = { ...skills, skills: split({ items: [gap("Docker", 2), gap("SQL", 1)] }, { items: [] }, { items: [] }) };
    expect(renderToStaticMarkup(<SkillsView data={two} career="" setCareer={noop} selected={null} setSelected={noop} students={null} exportUrl="/x" navigate={noop} />)).toContain("Cần ít nhất 3 kỹ năng còn thiếu để vẽ biểu đồ.");
    const empty = { ...skills, scope: { ...head.scope, assessed: 0 }, skills: split({ items: [] }, { items: [] }, { items: [] }) };
    const none = renderToStaticMarkup(<SkillsView data={empty} career="" setCareer={noop} selected={null} setSelected={noop} students={null} exportUrl="/x" navigate={noop} />);
    expect(none).toContain("Chưa có sinh viên nào đánh giá năng lực trong phạm vi lọc.");
    expect(none).not.toContain("Kỹ năng theo khóa");
  });

  it("shows each target career on a card with its fit and most missed skills", () => {
    const careers: CareersReport = { ...head, withoutCareer: 38, careers: split(
      { items: [{ name: "Kỹ sư phần mềm", students: 30, average: 72.4, levels: [{ label: "Phù hợp", students: 10 }, { label: "Trung bình", students: 20 }], topGaps: [{ name: "Docker", students: 12 }] },
        { name: "Kỹ sư dữ liệu", students: 10, average: 84, levels: [{ label: "Phù hợp", students: 10 }], topGaps: [] }] },
      { items: [] }, { items: [] }) };
    const html = renderToStaticMarkup(<CareersView data={careers} />);
    expect(html).toContain('<span class="rp-strip-label">Đã chọn vị trí mục tiêu</span><b class="rp-strip-value">40</b><span class="rp-strip-note">trong 224 sinh viên có bảng điểm</span>');
    expect(html).toContain('<b class="rp-strip-value">2</b><span class="rp-strip-note">nhiều nhất: Kỹ sư phần mềm</span>');
    // (72,4 × 30 + 84 × 10) / 40
    expect(html).toContain('<b class="rp-strip-value">75,3<small>/ 100</small></b><span class="rp-chip meaning-warn">Trung bình</span>');
    expect(html).toContain('<b class="rp-strip-value">38</b><span class="rp-strip-note">đã tải bảng điểm, chưa có vị trí mục tiêu</span>');
    expect(html).toContain(">Cơ cấu vị trí mục tiêu</h2>");
    expect(html).toContain("<span>Kỹ sư phần mềm</span><b>30</b><small>75%</small>");
    expect(html).toContain("<h3>Kỹ sư phần mềm</h3>");
    expect(html).toContain("<b>30</b> <small>sinh viên · 75%</small>");
    expect(html).toContain("<span>Phù hợp trở lên: 10/30</span>");
    expect(html).toContain("<span>Docker <b>12</b></span>");
    expect(html).toContain('<span class="rp-chip meaning-good">Phù hợp</span>');
    expect(html).toContain("Không có kỹ năng nào còn thiếu.");
    expect(html).toContain("Rất phù hợp · từ 90");
    expect(renderToStaticMarkup(<CareersView data={{ ...careers, careers: split({ items: [] }, { items: [] }, { items: [] }) }} />)).toContain("Chưa có sinh viên nào đánh giá năng lực trong phạm vi lọc.");
  });

  it("counts the courses Lộ trình AI proposes, by how, and names the students of the picked one", () => {
    const course = (index: number, scale = 1) => ({ code: `71ITSE3050${index}`, name: `Môn thử ${index}`, newStudents: (20 - index) * scale, retake: 5 * scale, improve: index === 1 ? 2 * scale : 0, total: (25 - index + (index === 1 ? 2 : 0)) * scale });
    const list = Array.from({ length: 14 }, (_, index) => course(index + 1));
    const courses: CoursesReport = { ...head, withRoadmap: 97, courses: split({ items: list }, { items: list.map((row) => ({ ...row, total: 3 })) }, { items: list.map((row) => ({ ...row, total: 1 })) }) };
    const html = renderToStaticMarkup(<CoursesView data={courses} selected={null} setSelected={noop} students={null} navigate={noop} />);
    expect(html).toContain(">Lượt đề xuất theo môn</h2><p>97 sinh viên đã có Lộ trình AI · 14 môn được đề xuất · biểu đồ vẽ 12 môn đứng đầu</p>");
    // 19 + 18 + … + 6 new, 14 × 5 retakes, 2 improvements.
    expect(html).toContain("Học mới</span><b>175</b>");
    expect(html).toContain("Học lại</span><b>70</b>");
    expect(html).toContain("Học cải thiện</span><b>2</b>");
    expect(html.match(/class="rp-colchart-col rp-colchart-button"/g)).toHaveLength(12);
    expect(html).toContain('aria-pressed="true" aria-label="Hạng 1: Môn thử 1 (71ITSE30501): 26 sinh viên (Học mới 19, Học lại 5, Học cải thiện 2)"');
    // The ranking lists ten courses, then more on request; the first course is picked until another one is.
    expect(html.match(/class="rp-course"/g)).toHaveLength(10);
    expect(html).toContain("Xem thêm 4 môn</button>");
    expect(html).toContain("<b>Môn thử 1</b>");
    expect(html).toContain("Môn đang chọn · hạng 1</p>");
    expect(html).toContain('<div class="rp-pick-tile rp-tone-blue"><b>19</b><span>Học mới</span></div>');
    expect(html).toContain("<b>K29</b>");
    const chosen = renderToStaticMarkup(<CoursesView data={courses} selected="71ITSE305012" setSelected={noop} navigate={noop} students={loaded({ code: "71ITSE305012", name: "Môn thử 12", items: [
      { userId: "u3", studentCode: "2374802019003", name: "Phạm Gia Huy", cohort: "K30", majorName: null, specialtyName: null, how: "retake" as const, gpa: 2.1 }] })} />);
    // A course past the first ten rows is listed when it is the picked one.
    expect(chosen.match(/class="rp-course"/g)).toHaveLength(12);
    expect(chosen).toContain("Môn đang chọn · hạng 12</p>");
    expect(chosen).toContain("1 sinh viên được đề xuất</h3>");
    expect(chosen).toContain('<span class="rp-badge rp-badge-warn">Học lại</span><a class="rp-link" href="/quantri/sinh-vien?id=u3" aria-label="Xem hồ sơ của Phạm Gia Huy">Xem hồ sơ</a>');
    expect(renderToStaticMarkup(<CoursesView data={{ ...courses, courses: split({ items: [] }, { items: [] }, { items: [] }) }} selected={null} setSelected={noop} students={null} navigate={noop} />))
      .toContain("Chưa có môn nào được AI đề xuất trong phạm vi lọc.");
  });
});

describe("Nhật ký", () => {
  const view = (kind: "" | "access", actor: string) => renderToStaticMarkup(<AuditView data={audit} kind={kind} setKind={noop} actor={actor} setActor={noop} q="" setQ={noop} page={1} setPage={noop} today="2026-10-31" />);

  it("counts the last days, the kinds and the people, each kind and person a filter", () => {
    const html = view("access", "Lê Quốc Bảo");
    expect(html).toContain(">Thao tác 7 ngày qua</h2><p>30/10 đến 31/10/2026</p>");
    expect(html).toContain("<span>Tổng thao tác</span><b>11</b>");
    expect(html).toContain("<span>Xem dữ liệu sinh viên</span><b style=\"color:#8f5a00\">3</b>");
    expect(html).toContain("<span>Xuất báo cáo</span><b style=\"color:#2456a6\">2</b>");
    expect(html).toContain('aria-label="Hôm nay · Thứ Bảy 31/10/2026: 2 thao tác"');
    expect(html).toContain('class="rp-colchart-label rp-strong">T7</text>');
    expect(html).toContain('class="rp-colchart-sub">30/10</text>');
    // Eight kinds always, "Khác" only when the log has one.
    expect(html.match(/class="rp-facet rp-facet-icon"/g)).toHaveLength(8);
    expect(html).not.toContain("<span>Khác</span>");
    expect(html).toContain('<span>Xem dữ liệu sinh viên</span><span class="rp-facet-bar" aria-hidden="true"><i style="width:100%"></i></span><b>20</b>');
    expect(html).toContain('<span>Tài khoản</span><span class="rp-facet-bar" aria-hidden="true"><i style="width:0%"></i></span><b>0</b>');
    expect(html).toContain("<b>Lê Quốc Bảo</b><small>Cố vấn học tập</small>");
    expect(html.match(/class="rp-actor" aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('Đang lọc: <b style="color:var(--rp-ink)">Xem dữ liệu sinh viên · Lê Quốc Bảo</b>');
    expect(html).toContain(">Xóa bộ lọc</button>");
    expect(view("", "")).not.toContain("Đang lọc");
  });

  it("writes the log as a timeline by day with who, what and when", () => {
    const html = view("", "");
    expect(html).toContain('<h2 id="rp-audit-title">Dòng thời gian <span class="rp-count">41</span></h2>');
    expect(html).toContain("<h3><span>Hôm nay · Thứ Bảy 31/10/2026</span><span>2 thao tác</span></h3>");
    expect(html).toContain("<h3><span>Thứ Sáu 30/10/2026</span><span>9 thao tác</span></h3>");
    expect(html).toContain('<time dateTime="2026-10-31T02:12:00.000Z">09:12</time>');
    expect(html).toContain('<b>Xuất Excel</b><span class="rp-timeline-kind" style="--soft:#e9effc;--ink:#2456a6">Xuất báo cáo</span>');
    expect(html).toContain('<span class="rp-timeline-summary">Sinh viên có nguy cơ chậm tiến độ (khóa K29, 18 dòng)</span>');
    expect(html).toContain("Phạm Thu Trang · Ban chủ nhiệm khoa</span>");
    expect(html).toContain("Tìm trong nhật ký");
    expect(html).toContain("Hiển thị 1–20 trong 41 thao tác");
    expect(html).toContain(">Mới hơn</button>");
    expect(html).toContain(">Cũ hơn</button>");
    expect(html).toContain("Lưu 1 năm; không lưu nội dung dữ liệu của sinh viên. Lịch sử đăng nhập xem ở Tài khoản.");
    const none = renderToStaticMarkup(<AuditView data={{ ...audit, items: [], total: 0, days: [], kinds: [], actorCounts: [] }} kind="" setKind={noop} actor="" setActor={noop} q="" setQ={noop} page={1} setPage={noop} today="2026-10-31" />);
    expect(none).toContain("Không có thao tác phù hợp.");
    expect(none).toContain("Chưa có số liệu theo ngày.");
  });
});

describe("the pages of the Tổng quan group", () => {
  it("open on the workspace's title with the filters beside it and a loading state", () => {
    vi.stubGlobal("window", { location: { pathname: "/quantri/tong-quan", search: "?cohort=K29", hash: "" } });
    const html = renderToStaticMarkup(<AdminReports path="/quantri/tong-quan" navigate={noop} heading={<h1>Thống kê</h1>} />);
    expect(html).toContain('<div class="am-page-heading rp-heading"><div class="rp-heading-text"><h1>Thống kê</h1><p class="rp-head-meta">Học kỳ đang học: —</p></div>');
    expect(html).toContain('aria-label="Lọc dữ liệu thống kê"');
    expect(html).toContain("Cách tính</button>");
    // No second title, no lead, no pills, no function-list code (user 2026-11-07), no search box on an aggregate page.
    expect(html).not.toContain("rp-title");
    expect(html).not.toContain("AD-REPORT");
    expect(html).not.toContain("Tìm sinh viên");
    expect(html).toContain("Đang tải thống kê…");
    for (const path of ["/quantri/bao-cao-tien-do", "/quantri/bao-cao-nguy-co", "/quantri/bao-cao-ky-nang", "/quantri/bao-cao-nghe-nghiep", "/quantri/bao-cao-mon-hoc"]) {
      const page = renderToStaticMarkup(<AdminReports path={path} navigate={noop} />);
      expect(page).toContain('aria-label="Lọc dữ liệu thống kê"');
      expect(page).toContain("Đang tải thống kê…");
    }
  });

  it("open Nhật ký without the student filters", () => {
    const audit = renderToStaticMarkup(<AdminReports path="/quantri/nhat-ky" navigate={noop} heading={<h1>Nhật ký</h1>} />);
    expect(audit).toContain('<h1>Nhật ký</h1><p class="rp-head-meta">Ai đã làm gì, lúc nào.</p>');
    expect(audit).not.toContain('aria-label="Lọc dữ liệu thống kê"');
    expect(audit).not.toContain("Cách tính");
    expect(audit).not.toContain("AD-REPORT");
    expect(audit).toContain("Đang tải thống kê…");
  });
});
