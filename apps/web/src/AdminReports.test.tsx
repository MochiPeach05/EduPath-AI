import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminReports, {
  FilterBar, advisorScopeText, AuditTable, AveragesTable, CareersView, CoursesView, DashboardView, ProgressView, RiskView, SkillsView, bandParts, cohortGpaLines, coverageNotes, coverageText,
  dataBaseText, fitParts, fitWord, gpaColumnTip, matrixRows, progressLegend, progressParts, recentLogText, skillsLeadText, updatedText,
} from "./AdminReports";
import { EMPTY_FILTERS, apiFilters, fileNameFrom, filtersFromSearch, filtersToSearch, reportErrorText, reportUrl } from "./admin-report-api";
import { HBarList, ShareBars, axisStep, cohortColor, heatColor, labelFits, segmentWidths } from "./admin-report-charts";
import type {
  AuditPage, CareersReport, CohortSplit, CoursesReport, DashboardKpis, DashboardReport, FitSummary, GpaBands, GpaPoint, ProgressCounts, ProgressReport, ReportHead, RiskReport, SkillsReport,
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
const dashboard: DashboardReport = {
  ...head,
  kpis: split(kpi(), kpi({ students: 140, gpa: 2.91 }), kpi({ students: 130, gpa: 2.8, competency: null, competencyLevel: null })),
  gpaByTerm: split({ points: points(0) }, { points: points(0.05) }, { points: points(-0.05).slice(1) }),
  gpaBands: split(bands(2), bands(1), bands(1)),
  averages: [
    { by: "cohort", rows: [
      { key: "K29", label: "K29", withTranscript: 78, withData: 77, gpa: 3.06, lastTermGpa: 3.08, credits: 107.4, below2: 0, assessed: 60, competency: 67.4, competencyLevel: "Khá", fit: 74.2, fitLabel: "Trung bình" },
      { key: "K30", label: "K30", withTranscript: 58, withData: 58, gpa: 2.98, lastTermGpa: 2.97, credits: 73, below2: 3, assessed: 41, competency: 66, competencyLevel: "Khá", fit: 68, fitLabel: "Trung bình" },
    ], all: { key: "all", label: "Tất cả", withTranscript: 136, withData: 135, gpa: 3.01, lastTermGpa: 3.01, credits: 89, below2: 3, assessed: 101, competency: 67, competencyLevel: "Khá", fit: 70.5, fitLabel: "Trung bình" } },
    { by: "major", rows: [], all: { key: "all", label: "Tất cả", withTranscript: 0, withData: 0, gpa: null, lastTermGpa: null, credits: null, below2: 0, assessed: 0, competency: null, competencyLevel: null, fit: null, fitLabel: null } },
  ],
  competencyGroups: split(
    { groups: [{ name: "Chuyên môn", score: 67.8, level: "Khá", students: 186 }, { name: "Kiến thức nền tảng", score: 61.1, level: "Trung bình", students: 186 }, { name: "Kỹ năng mềm", score: 72.8, level: "Khá", students: 186 }],
      lowest: [{ name: "Tiếng Anh chuyên ngành", group: "Kỹ năng mềm", score: 57.8, students: 150 }], highest: [{ name: "Làm việc nhóm", group: "Kỹ năng mềm", score: 80.4, students: 186 }] },
    { groups: [{ name: "Chuyên môn", score: 69.2, level: "Khá", students: 90 }], lowest: [], highest: [] },
    { groups: [{ name: "Chuyên môn", score: 64.1, level: "Khá", students: 70 }], lowest: [], highest: [] }),
  fit: split(fit(61.24), fit(70.5), fit(55)),
  progress: split(progress(2), progress(1), progress(1)),
};

const noop = () => undefined;
const plainHeader = (label: unknown) => <th>{String(label)}</th>;

afterEach(() => vi.unstubAllGlobals());

describe("Thống kê of a cố vấn học tập (user 2026-11-07)", () => {
  const options = { cohorts: ["K29"], majors: [], specialties: [], studyTerm: null };
  it("says over the filters that the numbers are those of the advisor's classes", () => {
    expect(advisorScopeText(["71K29CNTT08", "71K29CNTT09"])).toBe("Số liệu chỉ gồm sinh viên các lớp bạn phụ trách: 71K29CNTT08, 71K29CNTT09.");
    expect(advisorScopeText([])).toBe("Bạn chưa phụ trách lớp nào nên chưa có số liệu.");
    const own = renderToStaticMarkup(<FilterBar filters={EMPTY_FILTERS} setFilters={() => {}} options={{ ...options, scope: { classes: ["71K29CNTT08"] } }} />);
    expect(own).toContain('<p class="rp-scope">Số liệu chỉ gồm sinh viên các lớp bạn phụ trách: 71K29CNTT08.</p>');
    const all = renderToStaticMarkup(<FilterBar filters={EMPTY_FILTERS} setFilters={() => {}} options={{ ...options, scope: null }} />);
    expect(all).not.toContain("rp-scope");
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
  it("draw one cumulative line per cohort over every term", () => {
    const lines = cohortGpaLines(dashboard.gpaByTerm);
    expect(lines.terms.map((item) => item.code)).toEqual(["HK241", "HK242", "HK251"]);
    expect(lines.series.map((line) => [line.key, line.values.map((value) => value === null ? null : Math.round(value * 100) / 100)])).toEqual([
      ["K29", [2.85, 2.89, 2.92]], ["K30", [null, 2.79, 2.82]],
    ]);
    expect(gpaColumnTip(dashboard.gpaByTerm.all.points, 2)).toBe("HK1 2025–2026\nGPA TB học kỳ: — (0 sinh viên có điểm)\nGPA TB tích lũy: 2,87");
  });

  it("order statuses, bands and fit words, and give each cohort a fixed colour", () => {
    expect(progressParts(progress(1)).map((part) => `${part.label}:${part.value}`)).toEqual(["Đúng tiến độ:60", "Trễ kế hoạch:20", "Chưa đủ dữ liệu:5", "Chưa có bảng điểm:15"]);
    expect(bandParts({ bands: [{ label: "Yếu", range: "dưới 2,00", students: 4 }], withTranscript: 5, withData: 4 }).map((part) => part.value)).toEqual([0, 0, 0, 0, 4]);
    expect(fitParts(fit(70)).map((part) => part.label)).toEqual(["Rất phù hợp", "Phù hợp", "Trung bình", "Ít phù hợp", "Không phù hợp"]);
    expect(fitWord(62.4)).toBe("Ít phù hợp");
    expect(fitWord(62.5)).toBe("Trung bình");
    expect(cohortColor("K29")).toBe(cohortColor("K29"));
    expect(new Set(["K26", "K27", "K28", "K29", "K30", "K31", "K32", "K33"].map(cohortColor)).size).toBe(8);
    expect(cohortColor("K34")).toBe(cohortColor("K26"));
    expect(heatColor(0, 10).background).toBe("#f6f8fc");
    expect(heatColor(10, 10).color).toBe("#ffffff");
    expect(axisStep(140)).toBe(25);
    expect(axisStep(4)).toBe(1);
  });

  it("print a count inside a segment only when it fits, whatever its share", () => {
    expect(labelFits("2", 18)).toBe(true);
    expect(labelFits("2", 17)).toBe(false);
    expect(labelFits("12", 26)).toBe(true);
    // 9 + 2 + 3 + 12 students on a 600 px bar: the "2" (7,7%) gets 46 px, room enough; before, a 9% threshold hid it.
    const parts = progressParts({ total: 26, onTrack: 9, late: 2, unknown: 3, noTranscript: 12 });
    const widths = segmentWidths(parts, 600, 26);
    expect(Math.round(widths[1]!)).toBe(46);
    expect(labelFits("2", widths[1]!)).toBe(true);
    expect(Math.round(widths.reduce((sum, width) => sum + width, 0))).toBe(594);
    // A bar list fills total / axis maximum of the track; a zero part draws nothing.
    expect(segmentWidths([{ label: "A", value: 0, color: "#000" }, { label: "B", value: 5, color: "#000" }], 400, 10)).toEqual([0, 200]);
  });

  it("give every segment its tooltip, every bar its parts in words, and a table view", () => {
    const parts = progressParts({ total: 26, onTrack: 9, late: 2, unknown: 3, noTranscript: 12 });
    const html = renderToStaticMarkup(<ShareBars label="Tiến độ" rows={[{ key: "all", label: "Toàn khóa", parts }]} />);
    expect(html).toContain('data-tip="Toàn khóa\nTrễ kế hoạch: 2 sinh viên (8%)"');
    expect(html).toContain('aria-label="Toàn khóa: 26 sinh viên (Đúng tiến độ 9 (35%), Trễ kế hoạch 2 (8%), Chưa đủ dữ liệu 3 (12%), Chưa có bảng điểm 12 (46%))"');
    expect(html).toContain("<summary>Xem số liệu dạng bảng</summary>");
    expect(html).toContain('<td class="rp-num">2<small> (8%)</small></td>');
    // Bars of one part carry their value at the tip, so only bars of several parts get the table.
    expect(renderToStaticMarkup(<HBarList label="Lý do" rows={[{ key: "a", label: "A", parts: [{ label: "A", value: 3, color: "#000" }] }]} />)).not.toContain("<summary>");
    expect(renderToStaticMarkup(<HBarList label="Kỹ năng" rowHeader="Kỹ năng" rows={[{ key: "a", label: "Docker", parts: [{ label: "Dưới ngưỡng", value: 3, color: "#000" }, { label: "Chưa học", value: 1, color: "#111" }] }]} />))
      .toContain('<th scope="col">Kỹ năng</th><th scope="col" class="rp-num">Dưới ngưỡng</th><th scope="col" class="rp-num">Chưa học</th>');
    // Toàn khóa: the legend gives each status its count; Từng khóa keeps the names (the numbers are in each bar and the table).
    expect(progressLegend({ total: 26, onTrack: 9, late: 2, unknown: 3, noTranscript: 12 }, true).map((item) => item[2])).toEqual([9, 2, 3, 12]);
    expect(progressLegend({ total: 26, onTrack: 9, late: 2, unknown: 3, noTranscript: 12 }, false).every((item) => item.length === 2)).toBe(true);
  });

  it("say the real count in the titles and their lines", () => {
    expect(skillsLeadText(8, 120)).toBe("8 kỹ năng, xếp theo số sinh viên còn thiếu (nhiều nhất trước). 120 sinh viên đã đánh giá năng lực trong phạm vi lọc.");
    expect(skillsLeadText(0, 0)).toBe("0 sinh viên đã đánh giá năng lực trong phạm vi lọc.");
    const entry = { id: "a", at: "2026-10-31T02:12:00.000Z", actorName: "Phạm Thu Trang", actorRole: null, kind: "report" as const, action: "Xuất Excel", summary: "x" };
    expect(recentLogText({ items: Array.from({ length: 20 }, () => entry), total: 134 })).toBe("20 thao tác mới nhất trong 134 thao tác của Nhật ký thao tác.");
    expect(recentLogText({ items: [entry, entry, entry], total: 3 })).toBe("Cả 3 thao tác trong Nhật ký thao tác.");
    expect(recentLogText(null)).toBe("Các thao tác mới nhất trong Nhật ký thao tác.");
  });

  it("line up each cohort's count with the whole-scope rows of a matrix", () => {
    const rows = matrixRows({ all: { items: [{ name: "React", total: 9 }, { name: "Docker", total: 4 }] }, byCohort: [{ cohort: "K29", items: [{ name: "Docker", total: 4 }] }, { cohort: "K30", items: [{ name: "React", total: 9 }] }] },
      (item) => item.name, (item) => item.name, (item) => item.total);
    expect(rows).toEqual([{ key: "React", label: "React", values: { K29: 0, K30: 9 }, total: 9 }, { key: "Docker", label: "Docker", values: { K29: 4, K30: 0 }, total: 4 }]);
  });

  it("write the coverage and the update time the way the pages do", () => {
    expect(coverageText(head)).toBe("Dựa trên 224/486 sinh viên đã tải bảng điểm (chưa xác minh)");
    // A transcript without data counts as uploaded and is named apart (QA 2026-11-04: 14 uploaded, 13 in Xếp loại).
    expect(coverageNotes({ ...head, scope: { students: 20, withTranscript: 14, withData: 13, assessed: 3 } })).toEqual([
      "Dựa trên 14/20 sinh viên đã tải bảng điểm (chưa xác minh)",
      "13/14 bảng điểm có dữ liệu; 1 bảng điểm chưa đọc được GPA tích lũy nên không tính vào điểm, xếp loại và tiến độ",
      "3 sinh viên đã đánh giá năng lực",
    ]);
    expect(coverageNotes({ ...head, scope: { students: 20, withTranscript: 14, withData: 14, assessed: 0 } })).toEqual(["Dựa trên 14/20 sinh viên đã tải bảng điểm (chưa xác minh)"]);
    expect(dataBaseText(13, 14)).toBe("Dựa trên 13/14 bảng điểm có dữ liệu");
    expect(updatedText("2026-10-31T02:15:00.000Z")).toBe("09:15 31/10/2026");
    expect(updatedText(null)).toBe("—");
  });
});

describe("Tổng quan", () => {
  const html = renderToStaticMarkup(<DashboardView data={dashboard} navigate={noop} />);

  it("offers Toàn khóa and Từng khóa on every section", () => {
    for (const title of ["Số liệu chính", "Điểm trung bình theo học kỳ", "Xếp loại học lực", "Độ thành thạo kỹ năng trung bình", "Độ phù hợp với vị trí nghề nghiệp mục tiêu", "Tiến độ học tập"]) expect(html).toContain(`>${title}</h2>`);
    expect(html.match(/aria-pressed="true">Toàn khóa<\/button>/g)).toHaveLength(6);
    expect(html.match(/>Từng khóa<\/button>/g)).toHaveLength(7);
    expect(html).toContain("Bảng điểm trung bình");
  });

  it("shows the headline numbers in the pages' formats and colours each word by its meaning", () => {
    expect(html).toContain("Dựa trên 224/486 sinh viên đã tải bảng điểm (chưa xác minh)");
    // The GPA card, the GPA chart and Xếp loại học lực say their base the same way.
    expect(html).toContain('<p class="rp-kpi-foot">Dựa trên 223/224 bảng điểm có dữ liệu</p>');
    expect(html).toContain("chỉ tính môn đã đạt. Dựa trên 223/224 bảng điểm có dữ liệu.</p>");
    expect(html).toContain("<p>Theo GPA tích lũy hệ 4. Dựa trên 184/186 bảng điểm có dữ liệu.</p>");
    expect(html).toContain('<b class="rp-kpi-value">2,87<small>/ 4</small></b>');
    expect(html).toContain('<b class="rp-kpi-value">67,8<small>/ 100</small></b>');
    expect(html).toContain('<b class="rp-kpi-value">61,2<small>/ 100</small></b>');
    expect(html).toContain("▲ 0,03</span> so với HK2 2025–2026");
    expect(html).toContain('<span class="rp-chip meaning-warn">Ít phù hợp</span>');
    expect(html).toContain('<span class="rp-chip meaning-fine">Khá</span>');
    expect(html).toContain(">51 nguy cơ</span>");
  });

  it("writes the averages table with the whole scope as its last row", () => {
    const table = renderToStaticMarkup(<AveragesTable table={dashboard.averages[0]!} />);
    expect(table).toContain('<tfoot><tr class="rp-foot"><th scope="row">Toàn khóa</th>');
    expect(table).toContain(">3,06</span>");
    expect(table).toContain(">107</td>");
    // Every figure says its base (QA 2026-11-04): 77 of the 78 uploaded K29 transcripts have data; "GPA dưới 2,00" is a
    // share of the K30 transcripts with data (3 of 58), competency and fit come after "Đã đánh giá".
    expect(table).toContain('<th scope="row">K29</th><td class="rp-num">77/78</td>');
    expect(table).toContain('<td class="rp-num">3 <small>(5%)</small></td><td class="rp-num">41</td>');
    expect(table).toContain(">Bảng điểm có dữ liệu<");
    expect(table).toContain(">Đã đánh giá<");
    expect(renderToStaticMarkup(<AveragesTable table={dashboard.averages[1]!} />)).toContain("Chưa có sinh viên nào tải bảng điểm trong phạm vi lọc.");
  });
});

describe("report pages", () => {
  const progressReport: ProgressReport = {
    ...head, counts: split(progress(2), progress(1), progress(1)),
    page: { page: 1, pageSize: 10, total: 2, items: [
      { userId: "u1", studentCode: "2374802019001", name: "Trần Minh An", cohort: "K29", majorName: "Công nghệ thông tin", specialtyName: "Công nghệ phần mềm", status: "late", passedCredits: 86, totalCredits: 150, expectedCredits: 117, gpa: 2.45, risk: "warn" },
      { userId: "u2", studentCode: null, name: "Lê Thu Hà", cohort: "K30", majorName: null, specialtyName: null, status: "no_transcript", passedCredits: null, totalCredits: null, expectedCredits: null, gpa: null, risk: null },
    ] },
  };

  it("lists students by progress with status tabs, credits against the plan and an Excel export", () => {
    const html = renderToStaticMarkup(<ProgressView data={progressReport} status="all" setStatus={noop} page={1} setPage={noop} sortHeader={plainHeader} exportUrl="/api/admin/reports/progress.xlsx" navigate={noop} />);
    expect(html).toContain("Trễ kế hoạch<b>40</b>");
    expect(html).toContain("86/150 · kế hoạch 117");
    expect(html).toContain('<span class="rp-chip meaning-warn">Trễ kế hoạch</span><span class="rp-chip meaning-warn">Cần chú ý</span>');
    expect(html).toContain("Chưa có MSSV");
    expect(html).toContain("Xuất Excel");
    expect(html).toContain('aria-pressed="true">Toàn khóa</button>');
    // "Xem hồ sơ" on every row opens the student's details on the Sinh viên page (user, 2026-10-31).
    expect(html).toContain('<a class="rp-link" href="/quantri/sinh-vien?id=u1" aria-label="Xem hồ sơ của Trần Minh An">Xem hồ sơ</a>');
    expect(html).toContain('href="/quantri/sinh-vien?id=u2"');
  });

  it("explains each risk with its reasons", () => {
    const risk: RiskReport = {
      ...head, counts: split({ total: 2, risk: 1, warn: 1 }, { total: 1, risk: 1, warn: 0 }, { total: 1, risk: 0, warn: 1 }),
      reasons: split({ items: [{ kind: "failed_course", label: "Môn bắt buộc chưa đạt", students: 1 }, { kind: "late_course", label: "Trễ môn so với KHĐT", students: 1 }] },
        { items: [{ kind: "failed_course", label: "Môn bắt buộc chưa đạt", students: 1 }] }, { items: [{ kind: "late_course", label: "Trễ môn so với KHĐT", students: 1 }] }),
      page: { page: 1, pageSize: 10, total: 1, items: [{ userId: "u1", studentCode: "2374802019001", name: "Trần Minh An", cohort: "K29", majorName: null, specialtyName: "Công nghệ phần mềm", level: "risk", gpa: 1.95,
        reasons: [{ kind: "failed_course", level: "risk", text: "Môn bắt buộc chưa đạt: Cơ sở dữ liệu" }, { kind: "gpa_below", level: "risk", text: "GPA tích lũy 1,95, dưới 2,00" }] }] },
    };
    const html = renderToStaticMarkup(<RiskView data={risk} level="all" setLevel={noop} page={1} setPage={noop} sortHeader={plainHeader} exportUrl="/api/admin/reports/risk.xlsx" navigate={noop} />);
    expect(html).toContain('<ul class="rp-reasons"><li class="rp-chip meaning-bad">Môn bắt buộc chưa đạt: Cơ sở dữ liệu</li>');
    expect(html).toContain('<td class="rp-action"><a class="rp-link" href="/quantri/sinh-vien?id=u1"');
    expect(html).toContain("Không kịp tín chỉ");
    expect(html).toContain(">1,95</td>");
    expect(html).toContain('href="/quantri/sinh-vien?id=u1" aria-label="Xem hồ sơ của Trần Minh An"');
  });

  it("counts missing skills, careers and suggested courses for all cohorts and each one", () => {
    const skills: SkillsReport = { ...head, careers: ["Kỹ sư dữ liệu"], skills: split(
      { items: [{ name: "Docker", below: 2, notStudied: 3, selfStudy: 10, noData: 1, total: 16 }] },
      { items: [{ name: "Docker", below: 1, notStudied: 1, selfStudy: 6, noData: 0, total: 8 }] }, { items: [{ name: "Docker", below: 1, notStudied: 2, selfStudy: 4, noData: 1, total: 8 }] }) };
    const skillHtml = renderToStaticMarkup(<SkillsView data={skills} career="" setCareer={noop} selected="Docker" setSelected={noop} students={{ data: { skill: "Docker", items: [
      { userId: "u1", studentCode: "2374802019001", name: "Trần Minh An", cohort: "K29", majorName: null, specialtyName: null, careerName: "Kỹ sư dữ liệu", status: "self_study", fitScore: 58.4, fitLabel: "Ít phù hợp" }] }, error: null, loading: false, retry: noop }} exportUrl="/x.xlsx" navigate={noop} />);
    expect(skillHtml).toContain("Docker: sinh viên còn thiếu");
    expect(skillHtml).toContain('<h2 id="rp-skills-title">Kỹ năng thiếu nhiều nhất</h2><p>1 kỹ năng, xếp theo số sinh viên còn thiếu (nhiều nhất trước).');
    expect(skillHtml).not.toContain("12 kỹ năng");
    expect(skillHtml).toContain('<span class="rp-chip rp-chip-violet">Cần tự học ngoài chương trình</span>');
    expect(skillHtml).toContain("58,4");
    expect(skillHtml).toContain('href="/quantri/sinh-vien?id=u1"');

    const careers: CareersReport = { ...head, withoutCareer: 38, careers: split(
      { items: [{ name: "Kỹ sư phần mềm", students: 30, average: 72.4, levels: [{ label: "Phù hợp", students: 10 }, { label: "Trung bình", students: 20 }], topGaps: [{ name: "Docker", students: 12 }] }] },
      { items: [{ name: "Kỹ sư phần mềm", students: 18, average: 74, levels: [], topGaps: [] }] }, { items: [{ name: "Kỹ sư phần mềm", students: 12, average: 70, levels: [], topGaps: [] }] }) };
    const careerHtml = renderToStaticMarkup(<CareersView data={careers} />);
    expect(careerHtml).toContain("30 sinh viên đã chọn vị trí nghề nghiệp");
    expect(careerHtml).toContain("38 sinh viên đã tải bảng điểm nhưng chưa đánh giá năng lực");
    expect(careerHtml).toContain("Docker (12)");

    const courses: CoursesReport = { ...head, withRoadmap: 97, courses: split(
      { items: [{ code: "71ITSE30503", name: "Lập trình ứng dụng Web", newStudents: 20, retake: 5, improve: 2, total: 27 }] },
      { items: [{ code: "71ITSE30503", name: "Lập trình ứng dụng Web", newStudents: 0, retake: 5, improve: 2, total: 7 }] }, { items: [{ code: "71ITSE30503", name: "Lập trình ứng dụng Web", newStudents: 20, retake: 0, improve: 0, total: 20 }] }) };
    const courseHtml = renderToStaticMarkup(<CoursesView data={courses} selected={null} setSelected={noop} students={null} navigate={noop} />);
    expect(courseHtml).toContain("1 môn được AI đề xuất");
    expect(courseHtml).toContain("97 sinh viên đã có Lộ trình AI");
    expect(courseHtml).toContain("Lập trình ứng dụng Web");
    const chosen = renderToStaticMarkup(<CoursesView data={courses} selected="71ITSE30503" setSelected={noop} navigate={noop} students={{ data: { code: "71ITSE30503", name: "Lập trình ứng dụng Web", items: [
      { userId: "u3", studentCode: "2374802019003", name: "Phạm Gia Huy", cohort: "K30", majorName: null, specialtyName: null, how: "retake", gpa: 2.1 }] }, error: null, loading: false, retry: noop }} />);
    expect(chosen).toContain('<a class="rp-link" href="/quantri/sinh-vien?id=u3" aria-label="Xem hồ sơ của Phạm Gia Huy">Xem hồ sơ</a>');
  });

  it("shows the log newest first with who, what and when", () => {
    const page: AuditPage = { page: 1, pageSize: 10, total: 1, actors: ["Phạm Thu Trang"], items: [
      { id: "a1", at: "2026-10-31T02:12:00.000Z", actorName: "Phạm Thu Trang", actorRole: "Ban chủ nhiệm khoa", kind: "report", action: "Xuất Excel", summary: "Sinh viên có nguy cơ chậm tiến độ (khóa K29, 18 dòng)" }] };
    const html = renderToStaticMarkup(<AuditTable data={page} page={1} setPage={noop} sortHeader={plainHeader} />);
    expect(html).toContain("09:12 31/10/2026");
    expect(html).toContain('<span class="rp-chip rp-chip-blue">Xuất báo cáo</span>');
    expect(html).toContain("Sinh viên có nguy cơ chậm tiến độ (khóa K29, 18 dòng)");
  });

  it("opens on the shared filter bar and a loading state", () => {
    vi.stubGlobal("window", { location: { pathname: "/quantri/tong-quan", search: "?cohort=K29", hash: "" } });
    const html = renderToStaticMarkup(<AdminReports path="/quantri/tong-quan" navigate={noop} />);
    expect(html).toContain('aria-label="Tìm kiếm và lọc dữ liệu thống kê"');
    expect(html).toContain(">AD-REPORT-01</span>Tổng quan dữ liệu và hoạt động</p>");
    expect(html).toContain("Thao tác gần đây");
    expect(html).toContain("Đang tải thống kê…");
    const audit = renderToStaticMarkup(<AdminReports path="/quantri/nhat-ky" navigate={noop} />);
    expect(audit).not.toContain('aria-label="Tìm kiếm và lọc dữ liệu thống kê"');
    expect(audit).toContain("Tìm trong nhật ký");
    // Codes after the function-list merge of 2026-10-31: the filter bar is AD-REPORT-10, Nhật ký is AD-REPORT-11.
    expect(audit).toContain(">AD-REPORT-11</span>Nhật ký thao tác</p>");
  });
});
