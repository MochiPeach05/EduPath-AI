import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StudentCompetency, { type CompetencyView } from "./StudentCompetency";
import { fixtureAssessment, fixtureResult } from "./student-competency.fixture";
import type { AiStatus, LatestAssessmentResponse } from "./competency-assessment-types";
import type { GraduationCourseRow, GraduationEvaluation, StudentGraduationResponse } from "./student-graduation-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

// Synthetic graduation answer: everything passes but the thesis group TC306 and, because of it, the total credits.
const row = (code: string, name: string, credits: number, state: GraduationCourseRow["state"]): GraduationCourseRow => ({
  code, name, credits, conditionOnly: false, groupId: "TC306", state, inferred: false, attempts: state === "not_taken" ? 0 : 1,
  score10: null, score4: null, letter: null, term: null,
});
const evaluation: GraduationEvaluation = {
  calcVersion: "comp-calc-v5", status: "fail", groupStatus: "fail", needsImprovement: false,
  asOf: { transcriptVersion: "v1", transcriptUpdatedAt: "2026-10-01T08:00:00Z", latestTerm: "HK253" },
  groups: [
    { id: "BB", name: "Nhóm bắt buộc", label: "Nhóm bắt buộc", kind: "mandatory", code: null, curriculumElectiveCode: null, unit: "môn", required: 42, lower: 42, upper: 42, remaining: null, status: "pass", minimumCredits: null, accumulatedCredits: 108, courseCount: 42, passedCount: 42, courses: [] },
    {
      id: "TC306", name: "Nhóm tự chọn TC306", label: "Nhóm tự chọn TC306", kind: "elective", code: "TC306", curriculumElectiveCode: "TC406", unit: "TC",
      required: 6, lower: 0, upper: 0, remaining: 6, status: "fail", minimumCredits: 6, accumulatedCredits: 0, courseCount: 3, passedCount: 0,
      courses: [row("TST301", "Chuyên đề Tốt nghiệp 1", 3, "not_taken"), row("TST306", "Đồ án Tốt nghiệp", 6, "not_taken"), row("TST302", "Chuyên đề Tốt nghiệp 2", 3, "not_taken")],
    },
  ],
  credits: { lower: 120, upper: 120, required: 126, status: "fail", source: "printed", remaining: 6 },
  gpa: { actual: 3.11, required: 2, scale: 4, status: "pass", source: "printed", reason: "", remaining: null },
  creditCheck: { status: "match", printed: 120, computedLower: 120, computedUpper: 120 },
  improvementCandidates: [], inProgress: [], unknownResults: [], warnings: [],
};
const graduation: StudentGraduationResponse = {
  profile: { cohortCode: "K29", specialty: "CNPM" }, resolution: "specialty",
  standard: {
    id: "std-1", revisionId: "rev-1", version: 1, name: "71K29CNTT_7480201-03_TN04 - K29CNTT_Công nghệ thông tin (Công nghệ phần mềm)",
    cohortCode: "K29", classBlock: "71K29CNTT", major: "Công nghệ thông tin", specialty: "Công nghệ phần mềm (7480201-03)",
    educationSystem: "Đại học chính quy", faculty: "Công nghệ thông tin", minimumCredits: 126, mandatoryCredits: null, electiveCredits: null,
    freeElectiveCredits: null, minimumGpa: 2, gpaScale: 4, notes: "", groups: [], courses: [],
  },
  transcript: { version: "v1", updatedAt: "2026-10-01T08:00:00Z" }, evaluation, specialtySuggestion: null,
};

const profile = { careerPositionId: "career-1", careerPosition: { id: "career-1", nameVi: "Lập trình viên web", nameEn: "Web Developer", deletedAt: null } };
function render(latest: LatestAssessmentResponse | null, options: { loading?: boolean; transcript?: boolean; specialty?: string | null; view?: CompetencyView; graduation?: StudentGraduationResponse } = {}) {
  liveData.mockImplementation((url: string) => url.endsWith("/latest")
    ? { data: latest, error: null, loading: options.loading ?? false }
    : url === "/api/student/graduation" ? { data: options.graduation ?? graduation, error: null, loading: false }
      : { data: options.transcript ?? true, error: null, loading: false });
  return renderToStaticMarkup(createElement(StudentCompetency, { profile: { ...profile, specialty: options.specialty === undefined ? "CNPM" : options.specialty }, view: options.view }));
}
const withAi = (status: AiStatus, view?: CompetencyView) => render({ assessment: fixtureAssessment(status), aiEnabled: true, workerOnline: true }, { view });
const sectionOrder = (html: string, ids: string[]) => ids.map((id) => html.indexOf(`id="${id}"`));

describe("StudentCompetency — Đánh giá năng lực", () => {
  it("renders the competency sections in order with the AI comment right after the overview", () => {
    const html = withAi("completed");
    const order = sectionOrder(html, ["scomp-overview", "scomp-ai", "scomp-history", "scomp-skills", "scomp-progress", "scomp-graduation"]);
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // "Cảnh báo dữ liệu và cách tính" was removed from this page (user, 2026-10-17).
    expect(html).not.toContain('id="scomp-warnings"');
    expect(html).not.toContain("Cách tính điểm năng lực");
    // The gap analysis lives on its own page now.
    expect(html).not.toContain('id="scomp-career"');
    expect(html).not.toContain('id="scomp-courses"');
    expect(html).toContain('href="#skill-gap"');
    expect(html).toContain("Đánh giá lại");
    expect(html).toContain("Xóa kết quả đánh giá");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });
  it("shows the competency part of the AI text with names, the AI label and the local model footer", () => {
    const html = withAi("completed");
    expect(html).toContain("Nhận xét từ EduPath AI");
    expect(html).toContain(">AI<");
    expect(html).toContain("Gemma 4 E4B, chạy cục bộ");
    expect(html).toContain("có thể chưa chính xác");
    expect(html).toContain("Bạn đang có nền tảng lập trình web rất tốt");
    expect(html).toContain("Nên cải thiện");
    expect(html).not.toContain("Với nghề mục tiêu");
    expect(html).not.toContain("Không ánh xạ được");
    // comp-v4: each improvement names its course; codes outside the engine's list are dropped.
    expect(html).toContain("Học phần Cấu trúc dữ liệu và giải thuật (TST102): Đã đạt với điểm 6,4; học cải thiện để nâng kỹ năng giải thuật.");
    expect(html).not.toContain("XXX998");
  });
  it("keeps the full computed result when AI is disabled", () => {
    const html = render({ assessment: fixtureAssessment("disabled"), aiEnabled: false, workerOnline: false });
    expect(html).toContain("Nhận xét AI chưa được bật");
    expect(html).not.toContain("Tạo lại nhận xét");
    expect(html).toContain("Khá phù hợp");
    expect(html).toContain("Bảng phân tích mức độ thành thạo theo nhóm năng lực");
  });
  it("explains the proficiency table and counts skills per level and group", () => {
    const html = withAi("completed");
    expect(html).not.toContain("Chi tiết kỹ năng");
    expect(html).toContain("Kết quả này cho biết gì?");
    // G1: S01, S02 Thành thạo · S03 Khá · S04 Cơ bản · S07 Sắp học (S08 is outside the student's choices).
    expect(html).toContain('aria-label="2 kỹ năng Thành thạo trong nhóm Kiến thức chuyên môn"');
    expect(html).toContain('aria-label="1 kỹ năng Cơ bản trong nhóm Kiến thức chuyên môn"');
    expect(html).toContain('aria-label="1 kỹ năng Sắp học trong nhóm Kiến thức chuyên môn"');
    // The engine's "Chưa có minh chứng" is never shown: split into Sắp học / Chưa có điểm (2026-10-21).
    expect(html).not.toContain("Chưa có minh chứng");
    expect(withAi("completed", "gap")).not.toContain("Chưa có minh chứng");
    expect(html).toContain("Điểm nhóm 79 · Khá");
  });
  it("draws the proficiency table as one stacked bar per group with a tooltip on every segment", () => {
    const html = withAi("completed");
    const section = html.slice(html.indexOf('id="scomp-skills"'), html.indexOf('id="scomp-skill-list"'));
    // One row per group: name, group level and score, then the bar and its total.
    expect([...section.matchAll(/<div class="scomp-chart-label"><strong>([^<]+)<\/strong>/g)].map((match) => match[1])).toEqual(["Kiến thức chuyên môn", "Kỹ năng bổ trợ"]);
    expect(section).toContain("<span>Điểm nhóm 79</span>");
    expect(section).toContain(">5 kỹ năng</span>");
    // Segments in scale order, each a button that names the group, the count and the share.
    expect([...section.matchAll(/class="scomp-chart-seg scomp-chart-(\w+)/g)].map((match) => match[1])).toEqual(["proficient", "good", "basic", "upcoming", "exempt"]);
    expect(section).toContain('aria-label="Kiến thức chuyên môn: 2 kỹ năng Thành thạo, 40% số kỹ năng của nhóm. Bấm để xem các kỹ năng này."');
    expect(section).toContain("left:0%;width:40%");
    // The tooltip gives the full picture: count, level, group share, the level's range and the skills with their scores.
    const tip = section.slice(section.indexOf("scomp-chart-tip"), section.indexOf("Bấm để xem danh sách"));
    expect(tip).toContain("<strong>2 kỹ năng</strong><span>Thành thạo</span>");
    expect(tip).toContain("Kiến thức chuyên môn · 40% số kỹ năng của nhóm");
    expect(tip).toContain("Điểm kỹ năng từ 85");
    expect(tip).toContain("<span>Lập trình web</span><b>91</b>");
    expect(tip).toContain("<span>Lập trình hướng đối tượng</span><b>86</b>");
    expect(section).toContain("Đang học hoặc chưa học tới học phần đo các kỹ năng này — không phải điểm yếu");
    // Legend for every level present, axis ticks, and the table as a collapsed twin.
    expect([...section.matchAll(/<li><i class="scomp-chart-key scomp-chart-\w+" aria-hidden="true"><\/i>([^<]+)<\/li>/g)].map((match) => match[1]))
      .toEqual(["Thành thạo", "Khá", "Cơ bản", "Cần củng cố", "Sắp học", "Miễn/công nhận"]);
    expect([...section.matchAll(/<span style="left:[\d.]+%">(\d+)<\/span>/g)].map((match) => match[1])).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(section).toMatch(/<details class="scomp-legend scomp-chart-table"><summary>Xem dạng bảng<\/summary>/);
  });
  it("draws every skill as a score bar on 0–100 with a tooltip and keeps the evidence behind a click", () => {
    const html = withAi("completed");
    const list = html.slice(html.indexOf('id="scomp-skill-list"'));
    // Lập trình web: 91 → Thành thạo bar at 91%, its score at the tip.
    const row = list.slice(list.indexOf('scomp-skill-name">Lập trình web'), list.indexOf("Học phần minh chứng của Lập trình web"));
    expect(row).toContain('class="scomp-skill-bar scomp-chart-proficient" style="width:91%"');
    expect(row).toContain('<span class="scomp-skill-score" style="left:calc(91% + 6px)">91</span>');
    expect(row).toContain('<span class="sr-only">Thành thạo · Độ tin cậy trung bình · độ phủ 50%</span>');
    // The tooltip: score and level first, then the skill, confidence and its evidence courses with their results.
    expect(row).toContain("<strong>91 điểm</strong><span>Thành thạo</span>");
    expect(row).toContain("Lập trình web · kỹ năng của nghề mục tiêu");
    expect(row).toContain("<span>Độ tin cậy trung bình · độ phủ 50%</span>");
    expect(row).toContain("<span>Lập trình web (TST104)</span><b>9,1 · A+</b>");
    expect(row).toContain("Bấm để xem học phần minh chứng");
    // The opened row repeats the facts, so nothing is only in the tooltip.
    expect(row).toContain('<p class="scomp-meta">91 điểm · Thành thạo · Độ tin cậy trung bình · độ phủ 50%</p>');
    // A skill without a score has no bar but says why; the axis marks the level thresholds.
    expect(list).toContain('<span class="scomp-skill-none">Sắp học</span>');
    expect(list).toContain('<span style="left:50%">50</span><span style="left:70%">70</span><span style="left:85%">85</span>');
  });
  it("follows the competency term by term, grouped by school year (STU-COMP-07)", () => {
    const html = withAi("completed");
    const section = html.slice(html.indexOf('id="scomp-history"'), html.indexOf('id="scomp-skills"'));
    expect(section).toContain("Theo dõi năng lực theo học kỳ");
    expect(section).toContain("Điểm năng lực tổng tăng từ 68 (học kỳ 1 năm học 2023–2024) lên 79 (học kỳ 2 năm học 2025–2026). Cao nhất là 81 vào học kỳ 2 năm học 2024–2025.");
    // One row group per school year, its end-of-year score in the header.
    expect([...section.matchAll(/Năm học (\d{4}–\d{4})<span>Cuối năm: (\d+) · (\S+)<\/span>/g)].map((match) => match.slice(1).join(" "))).toEqual([
      "2023–2024 72 Khá", "2024–2025 81 Khá", "2025–2026 79 Khá",
    ]);
    // Group columns follow the result's groups; a group without a score shows a dash.
    expect(section).toContain('<th scope="col" class="scomp-num">Kiến thức chuyên môn</th><th scope="col" class="scomp-num">Kỹ năng bổ trợ</th>');
    // Changes in whole points as shown: rises green, falls red, the first term has none.
    const changes = [...section.matchAll(/<td class="scomp-num">(?:<span class="(sg-status-pass|sg-status-fail|scomp-zero)">([^<]+)<\/span>)<\/td><\/tr>/g)].map((match) => `${match[2]} ${match[1]}`);
    expect(changes).toEqual(["— scomp-zero", "+4 sg-status-pass", "+3 sg-status-pass", "+6 sg-status-pass", "−2 sg-status-fail"]);
    expect(section).toMatch(/class="scomp-history-latest"><th scope="row">Học kỳ 2<span class="scomp-career-tag">Hiện tại<\/span><small>HK252<\/small>/);
    // A result stored before the history asks for a new run instead of an empty table.
    const assessment = fixtureAssessment("completed");
    const older = render({ assessment: { ...assessment, result: { ...fixtureResult, history: undefined } }, aiEnabled: true, workerOnline: true });
    expect(older).toContain("Bấm “Đánh giá lại” để xem năng lực của bạn qua từng năm, từng học kỳ.");
    expect(older).not.toContain("scomp-history-table");
  });
  it("shows a busy AI box with a cancel button while processing", () => {
    const html = withAi("processing");
    // No aria-busy on the AI section: it would hide the pending state from screen readers for minutes.
    expect(html).not.toMatch(/id="scomp-ai"[^>]*aria-busy/);
    expect(html).toContain("EduPath AI đang suy luận và viết nhận xét");
    expect(html).toContain("Hủy tạo nhận xét");
  });
  it("offers regeneration after a failure and explains the error", () => {
    const failed = fixtureAssessment("failed", "ai_timeout");
    const html = render({ assessment: failed, aiEnabled: true, workerOnline: true });
    expect(html).toContain("Máy AI xử lý quá thời gian cho phép.");
    expect(html).toContain("Tạo lại nhận xét");
  });
  it("counts group skills like the overall line and tags AI priorities without 'Ưu tiên'", () => {
    const html = withAi("completed");
    // G1 has S01–S04 scored, S07 no evidence, S08 outside the student's choices (not counted).
    expect(html).toContain("4/5 kỹ năng có minh chứng");
    expect(html).not.toContain("4/6 kỹ năng có minh chứng");
    // G1 4/5 + G2 1/1 = the overall 5/6.
    expect(html).toContain("1/1 kỹ năng có minh chứng");
    expect(html).toContain("Dựa trên 5/6 kỹ năng có minh chứng");
    expect(html).toContain('class="scomp-priority">Cần làm sớm</span>');
    expect(html).not.toMatch(/scomp-priority">Ưu tiên/);
  });
  it("groups skills with no evidence last and says it is not a weakness", () => {
    const html = withAi("completed");
    expect(html.indexOf("Sắp học (1)")).toBeGreaterThan(html.indexOf("Kiến thức chuyên môn (4)"));
    expect(html).toContain("Không phải điểm yếu");
    expect(html).toContain("suy ra từ điểm chữ");
  });
  it("shows a skill whose studied course has no score as Chưa có điểm, apart from Sắp học", () => {
    const assessment = fixtureAssessment("completed");
    const skills = assessment.result.skills.map((skill) => skill.key === "S07" ? { ...skill, evidenceCourses: skill.evidenceCourses.map((row) => ({ ...row, role: "studied" as const })) } : skill);
    const html = render({ assessment: { ...assessment, result: { ...assessment.result, skills } }, aiEnabled: true, workerOnline: true });
    expect(html).toContain("Chưa có điểm (1)");
    expect(html).not.toContain("Sắp học (1)");
    expect(html).toContain('<span class="scomp-skill-none">Chưa có điểm</span>');
    expect(html).toContain('class="scomp-chart-seg scomp-chart-no_score');
    expect(html).toMatch(/<li><i class="scomp-chart-key scomp-chart-no_score" aria-hidden="true"><\/i>Chưa có điểm<\/li>/);
  });
  it("colours progress red when late and green when on plan", () => {
    const late = withAi("completed");
    expect(late).toMatch(/scomp-plan-status scomp-plan-late"><span aria-hidden="true">✗<\/span><span>Chậm so với kế hoạch: 1 học phần · 3 TC/);
    expect(late).toContain('<dd class="sg-status-fail">1 ');
    const assessment = fixtureAssessment("completed");
    const onPlan = { ...assessment, result: { ...fixtureResult, progress: { ...fixtureResult.progress!, late: [], lateCount: 0, lateCredits: 0 } } };
    const html = render({ assessment: onPlan, aiEnabled: true, workerOnline: true });
    expect(html).toMatch(/scomp-plan-status scomp-plan-ok"><span aria-hidden="true">✓<\/span><span>Đúng kế hoạch/);
    expect(html).toContain("sg-status-pass\">Bạn đang theo đúng kế hoạch đào tạo.");
  });
  it("shows only the graduation page's verdict and the detail link", () => {
    const html = withAi("completed");
    const section = html.slice(html.indexOf('id="scomp-graduation"'));
    expect(section).toContain("Hiện tại bạn chưa đủ điều kiện xét tốt nghiệp vì còn thiếu 6 tín chỉ thuộc nhóm tự chọn TC306. Tổng số tín chỉ tích lũy (120/126) cũng sẽ đủ khi bạn hoàn thành nhóm tự chọn TC306.");
    expect(section).toMatch(/scomp-grad-verdict scomp-grad-fail">.*<a class="sw-outline scomp-grad-detail" href="#graduation">Xem chi tiết/);
    // The standard name, "Nên làm" and the criteria table live on the graduation page only (user, 2026-10-17).
    for (const gone of ["Căn cứ:", "Nên làm", "<table", "Đồ án Tốt nghiệp", "Bảng điểm cập nhật"]) expect(section).not.toContain(gone);
    // Never the copy stored with the assessment (its standard name and numbers differ).
    expect(section).not.toContain("Tiêu chuẩn tốt nghiệp K29 – CNPM");
  });
  it("explains a missing standard instead of a verdict", () => {
    const html = render({ assessment: fixtureAssessment("completed"), aiEnabled: true, workerOnline: true }, { graduation: { ...graduation, resolution: "specialty_unset", standard: null, evaluation: null } });
    expect(html).toContain("Hãy chọn chuyên ngành trong hồ sơ");
    expect(html).not.toContain("scomp-grad-verdict");
  });
  it("shows an introduction when there is no assessment yet", () => {
    const html = render({ assessment: null, aiEnabled: false, workerOnline: false }, { specialty: null });
    expect(html).toContain("Chưa có kết quả đánh giá");
    expect(html).toContain("Đánh giá năng lực</button>");
    expect(html).toContain("Chưa xác định");
    expect(html).not.toContain("Xóa kết quả đánh giá");
  });
  it("shows a loading state while the first request runs", () => {
    const html = render(null, { loading: true });
    expect(html).toContain("Đang tải kết quả đánh giá…");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Đánh giá năng lực<\/button>/);
  });
  it("says when the profile changed after the assessment", () => {
    expect(withAi("completed")).not.toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
    const html = render({ assessment: fixtureAssessment("completed"), aiEnabled: true, workerOnline: true }, { specialty: null });
    expect(html).toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
  });
  it("does not stay on 'Đang kiểm tra…' when the transcript check fails", () => {
    liveData.mockImplementation((url: string) => url.endsWith("/latest")
      ? { data: { assessment: null, aiEnabled: false, workerOnline: false }, error: null, loading: false }
      : { data: null, error: "Chưa kiểm tra được bảng điểm.", loading: false });
    const html = renderToStaticMarkup(createElement(StudentCompetency, { profile: { ...profile, specialty: "CNPM" } }));
    expect(html).toContain("Chưa kiểm tra được — thử tải lại trang");
    expect(html).not.toContain("Đang kiểm tra…");
  });
});

describe("StudentCompetency — Khoảng trống kỹ năng", () => {
  it("renders the gap sections in order, with no delete button and no graduation check", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("Kết quả phân tích khoảng trống kỹ năng");
    const order = sectionOrder(html, ["sgap-summary", "scomp-ai", "scomp-career", "sgap-history", "scomp-courses"]);
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('id="scomp-skills"');
    expect(html).not.toContain('id="scomp-graduation"');
    expect(html).not.toContain("Xóa kết quả đánh giá");
    expect(html).toContain("Đánh giá lại");
    // "Cảnh báo dữ liệu và cách tính mức phù hợp" was removed from this page too (user, 2026-10-18).
    expect(html).not.toContain('id="scomp-warnings"');
    expect(html).not.toContain("Cách tính mức phù hợp và khoảng trống");
  });
  it("tracks each career skill term by term (STU-GAP-07)", () => {
    const html = withAi("completed", "gap");
    const section = html.slice(html.indexOf('id="sgap-history"'), html.indexOf('id="scomp-courses"'));
    expect(section).toContain("Theo dõi mức độ cải thiện kỹ năng");
    expect(section).toContain("số kỹ năng nghề đạt ngưỡng tăng từ 0 lên 1/5. Tăng nhiều nhất: Lập trình web (+19 điểm).");
    expect(section).toContain('<th scope="colgroup" colSpan="2" class="scomp-gap-year">Năm học 2023–2024</th>');
    expect(section).toContain('<span class="sg-status-pass" title="Đạt ngưỡng">91 ✓</span>');
    expect(section).toContain('<span class="sg-status-fail" title="Dưới ngưỡng">75</span>');
    expect(section).toContain('<span class="scomp-zero" title="Sắp học">—</span>');
    expect(section).toContain('<span class="scomp-gap-change">+19</span>');
    expect(section).toContain("<th scope=\"row\">Kỹ năng đạt ngưỡng</th>");
  });
  it("shows no data warnings on either page, not even a header link (user, 2026-10-18)", () => {
    const assessment = fixtureAssessment("completed");
    const warned = { ...assessment, result: { ...fixtureResult, warnings: [{ code: "results_inferred" as const, message: "Một số kết quả được suy ra", consequence: "Điểm có thể lệch", details: [] }] } };
    const state = { assessment: warned, aiEnabled: true, workerOnline: true };
    for (const html of [render(state, { view: "gap" }), render(state)]) {
      expect(html).not.toContain("cảnh báo dữ liệu");
      expect(html).not.toContain("Một số kết quả được suy ra");
    }
  });
  it("lists the missing skills with their shortfall", () => {
    const html = withAi("completed", "gap");
    const summary = html.slice(html.indexOf('id="sgap-summary"'), html.indexOf('id="scomp-ai"'));
    expect(summary).toContain("Kỹ năng còn thiếu");
    expect(summary).toContain("Thiết kế cơ sở dữ liệu");
    expect(summary).toContain("Dưới ngưỡng · thiếu 10 điểm");
    expect(summary).toContain("Thiếu vừa");
    expect(summary).not.toContain("Lập trình web</strong>");
  });
  it("shows the gap part of the AI text with its courses", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("Nhận xét từ EduPath AI về khoảng trống kỹ năng");
    expect(html).toContain("Với nghề mục tiêu");
    expect(html).toContain("Học phần Kiểm thử phần mềm (TST105)");
    expect(html).not.toContain("XXX999");
    expect(html).not.toContain("Bước tiếp theo");
  });
  it("renders gap statuses with glyphs and never colours missing data as a failure", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("✓</span> Đạt ngưỡng");
    expect(html).toContain("Dưới ngưỡng · thiếu 10 điểm");
    expect(html).toContain("Sắp học · HK261");
    expect(html).toMatch(/scomp-status scomp-status-neutral"><span aria-hidden="true">\?<\/span> Chưa đủ dữ liệu/);
    expect(html).toContain("<caption");
  });
  it("names every suggested course with whether it was taken and whether it can be registered", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("Học phần nên học");
    expect(html).toContain("Tình trạng của bạn");
    expect(html).toContain("○</span> Chưa học");
    expect(html).toContain("Cần học trước Công nghệ phần mềm (TST109)");
    expect(html).toContain("Học cải thiện");
    expect(html).toContain("✓</span> Đã học, đạt · điểm 6,4 (C+)");
    expect(html).toContain("Kỹ năng cần tự học (CTĐT chưa đo)");
    expect(html).toContain("Kỹ năng: Docker");
    expect(html).toContain("Không có học phần nào trong chương trình đào tạo của bạn để đăng ký cho kỹ năng này.");
    expect(html).toContain("Đóng gói ứng dụng web của bạn bằng Docker.");
  });
  it("advises only on the target career's skills: raising its met skills to Thành thạo", () => {
    const assessment = fixtureAssessment("completed");
    const deepen = [
      { ...fixtureResult.skillPlans![0]!, skillKey: "S01", name: "Lập trình web", level: "good" as const, levelLabel: "Khá", score: 80, careerSkill: true, purpose: "deepen" as const },
      { ...fixtureResult.skillPlans![1]!, skillKey: "S03", name: "Git", level: "good" as const, levelLabel: "Khá", score: 78, careerSkill: true, purpose: "deepen" as const },
    ];
    const html = render({ assessment: { ...assessment, result: { ...fixtureResult, skillPlans: deepen } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    const plans = html.slice(html.indexOf("Nâng kỹ năng của nghề lên mức Thành thạo"), html.indexOf("Kỹ năng cần tự học (CTĐT chưa đo)"));
    expect(plans).toContain("Kỹ năng nghề Lập trình viên web bạn đã đạt ngưỡng nhưng chưa đạt mức Thành thạo (từ 85)");
    expect(plans).toContain("Kỹ năng: Lập trình web");
    expect(plans).toContain("Khá · 80");
    expect(plans).toContain("Bạn đã học hết học phần đo kỹ năng này trong chương trình; hãy làm một dự án nhỏ gắn với nghề");
    expect(html).not.toContain("Kỹ năng cần củng cố (dưới mức Khá)");
    // Weak skills outside the career (plans of an older result) are never advised on once a career is chosen.
    const older = withAi("completed", "gap");
    expect(older).not.toContain("Kỹ năng cần củng cố (dưới mức Khá)");
    expect(older).not.toContain("Kỹ năng: Sử dụng tiếng Anh");
    // The AI's advice on the career's own skills shows on this page too.
    expect(older).toContain("Nâng kỹ năng của nghề");
    expect(older).toContain("Học phần Cấu trúc dữ liệu và giải thuật (TST102)");
  });
  it("without a target career, gives each weak skill its courses: retake, take with prerequisites checked, or self-study", () => {
    const assessment = fixtureAssessment("completed");
    const html = render({ assessment: { ...assessment, result: { ...assessment.result, career: null } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    const plans = html.slice(html.indexOf("Kỹ năng cần củng cố (dưới mức Khá)"), html.indexOf("Kỹ năng cần tự học (CTĐT chưa đo)"));
    expect(plans).toContain("Kỹ năng: Sử dụng tiếng Anh");
    expect(plans).toContain("Cơ bản · 61");
    expect(plans).toMatch(/scomp-plan-action">Học cải thiện<\/span><strong>Tiếng Anh 2<\/strong>/);
    expect(plans).toContain("✓</span> Đã học, đạt · điểm 5,8 (C)");
    expect(plans).toMatch(/scomp-plan-action">Học mới<\/span><strong>Tiếng Anh chuyên ngành<\/strong>/);
    expect(plans).toContain("✓</span> Đủ điều kiện đăng ký");
    expect(plans).toContain("HK261 theo KHĐT");
    expect(plans).toContain("Kỹ năng: Định tuyến mạng");
    expect(plans).toContain("Không còn học phần nào trong chương trình của bạn để học thêm cho kỹ năng này");
    // Results stored before comp-calc-v6 have no plans: the part is left out, nothing breaks.
    const old = render({ assessment: { ...assessment, result: { ...fixtureResult, career: null, skillPlans: undefined } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(old).not.toContain("Kỹ năng cần củng cố (dưới mức Khá)");
  });
  it("does not praise a career that has no requirements yet", () => {
    const assessment = fixtureAssessment("completed");
    const result = { ...assessment.result, career: { ...assessment.result.career!, requirements: [] } };
    const html = render({ assessment: { ...assessment, result }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(html).toContain("Nghề này chưa có yêu cầu kỹ năng trong danh mục nên chưa so sánh được.");
    expect(html).not.toContain("Bạn đã đạt mọi kỹ năng có dữ liệu của nghề này.");
  });
  it("asks for a target career when none is chosen", () => {
    const assessment = fixtureAssessment("completed");
    const html = render({ assessment: { ...assessment, result: { ...assessment.result, career: null } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(html).toContain("Bạn chưa chọn nghề mục tiêu");
    expect(html).not.toContain('id="scomp-career"');
  });
  it("introduces the page before the first assessment", () => {
    const html = render({ assessment: null, aiEnabled: false, workerOnline: false }, { view: "gap" });
    expect(html).toContain("Chưa có kết quả phân tích");
    expect(html).toContain("Khoảng trống kỹ năng được tính cùng lúc với đánh giá năng lực");
  });
});
