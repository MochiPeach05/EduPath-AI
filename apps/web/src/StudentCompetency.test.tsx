import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StudentCompetency, { type CompetencyView } from "./StudentCompetency";
import { installAdvisorFetch, stopActing } from "./advisor-view";
import { fixtureAssessment, fixtureResult } from "./student-competency.fixture";
import type { AiStatus, LatestAssessmentResponse, PreviousAiComment } from "./competency-assessment-types";
import type { GraduationCourseRow, GraduationEvaluation, StudentGraduationResponse } from "./student-graduation-types";
import { unresolvedCopy } from "./student-graduation-data";

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
/** target: false for a student who chose no target career (plan "Một bước để bắt đầu", 2026-11-14: it is optional). */
function render(latest: LatestAssessmentResponse | null, options: { loading?: boolean; transcript?: boolean; specialty?: string | null; view?: CompetencyView; graduation?: StudentGraduationResponse; target?: boolean } = {}) {
  liveData.mockImplementation((url: string) => url.endsWith("/latest")
    ? { data: latest, error: null, loading: options.loading ?? false }
    : url === "/api/student/graduation" ? { data: options.graduation ?? graduation, error: null, loading: false }
      : { data: options.transcript ?? true, error: null, loading: false });
  const chosen = options.target === false ? { careerPositionId: null, careerPosition: null } : profile;
  return renderToStaticMarkup(createElement(StudentCompetency, { profile: { ...chosen, specialty: options.specialty === undefined ? "CNPM" : options.specialty }, view: options.view }));
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
    expect(html).not.toContain("Với vị trí nghề nghiệp mục tiêu");
    expect(html).not.toContain("Không ánh xạ được");
    // comp-v4: each improvement names its course; codes outside the engine's list are dropped.
    expect(html).toContain("Học phần Cấu trúc dữ liệu và giải thuật (TST102): Đã đạt với điểm 6,4; học cải thiện để nâng kỹ năng giải thuật.");
    expect(html).not.toContain("XXX998");
  });
  it("keeps the full computed result when AI is disabled", () => {
    const html = render({ assessment: fixtureAssessment("disabled"), aiEnabled: false, workerOnline: false });
    expect(html).toContain("Nhận xét AI chưa được bật");
    expect(html).not.toContain("Tạo lại nhận xét");
    // The fixture is stored with the earlier label "Khá phù hợp" (0,58); its requirements give a điểm phù hợp
    // of 56,62 (comp-calc-v15: Docker without data and Kiểm thử Sắp học count 0), Ít phù hợp on the competency bounds, shown as points
    // (rounded down to the tenth) with a pip badge in the amber of its word (user 2026-10-30: "Ít phù hợp" was green).
    expect(html).toMatch(/<strong class="scomp-fit-label">56,6<small>\/100<\/small><\/strong><span class="scomp-level scomp-level-2 meaning-warn">.*?<\/span>Ít phù hợp<\/span>/);
    expect(html).not.toContain("Khá phù hợp");
    expect(html).toContain("Bảng phân tích mức độ thành thạo theo nhóm năng lực");
  });
  it("explains the proficiency table and counts skills per level and group", () => {
    const html = withAi("completed");
    expect(html).not.toContain("Chi tiết kỹ năng");
    expect(html).toContain("Kết quả này cho biết gì?");
    // G1, read on the comp-calc-v10 scale from a result stored before it: S01 (91) Xuất sắc · S02 (86) Giỏi ·
    // S03 (75) and S04 (64) Khá · S07 Sắp học (S08 is outside the student's choices).
    expect(html).toContain('aria-label="1 kỹ năng Xuất sắc trong nhóm Kiến thức chuyên môn"');
    expect(html).toContain('aria-label="1 kỹ năng Giỏi trong nhóm Kiến thức chuyên môn"');
    expect(html).toContain('aria-label="2 kỹ năng Khá trong nhóm Kiến thức chuyên môn"');
    expect(html).not.toContain("Thành thạo");
    expect(html).not.toContain("Cơ bản");
    expect(html).toContain('aria-label="1 kỹ năng Sắp học trong nhóm Kiến thức chuyên môn"');
    // The engine's "Chưa có minh chứng" is never shown: split into Sắp học / Chưa có điểm (2026-10-21).
    expect(html).not.toContain("Chưa có minh chứng");
    expect(withAi("completed", "gap")).not.toContain("Chưa có minh chứng");
    expect(html).toContain("Điểm nhóm 79,4 · Khá");
  });
  it("lists only the five levels in Thang mức năng lực and reads an old 82 as Giỏi (user, 2026-10-22)", () => {
    const html = withAi("completed");
    const legend = html.slice(html.indexOf("<summary>Thang mức năng lực</summary>"), html.indexOf("</details>", html.indexOf("<summary>Thang mức năng lực</summary>")));
    expect([...legend.matchAll(/<\/span>([^<]+)<\/span><span class="scomp-legend-range">([^<]+)<\/span>/g)].map((match) => `${match[1]} ${match[2]}`)).toEqual([
      "Xuất sắc từ 90", "Giỏi 80 đến dưới 90", "Khá 62,5 đến dưới 80", "Trung bình 50 đến dưới 62,5", "Yếu dưới 50",
    ]);
    expect(legend).toContain("Cùng ngưỡng với xếp loại học lực trên bảng điểm (điểm hệ 4 × 25): 3,6 → 90 · 3,2 → 80 · 2,5 → 62,5 · 2,0 → 50.");
    for (const state of ["Sắp học", "Chưa có điểm", "Miễn/công nhận"]) expect(legend).not.toContain(state);
    // The student's case: a result stored with 82 · Khá before comp-calc-v10 now reads Giỏi.
    const assessment = fixtureAssessment("completed");
    const old = { ...assessment, result: { ...assessment.result, overall: { ...assessment.result.overall, score: 82, level: "good" as const, levelLabel: "Khá" } } };
    const overview = render({ assessment: old, aiEnabled: true, workerOnline: true });
    const card = overview.slice(overview.indexOf("scomp-score-card"), overview.indexOf("scomp-groups"));
    expect(card).toContain("<strong>82</strong>");
    expect(card).toMatch(/scomp-level scomp-level-4 meaning-good">.*<\/span>Giỏi<\/span>/);
    expect(card).toContain("Kết quả các học phần liên quan tốt; nắm vững phần lớn nội dung.");
  });
  it("draws the proficiency table as one stacked bar per group with a tooltip on every segment", () => {
    const html = withAi("completed");
    const section = html.slice(html.indexOf('id="scomp-skills"'), html.indexOf('id="scomp-skill-list"'));
    // One row per group: name, group level and score, then the bar and its total.
    expect([...section.matchAll(/<div class="scomp-chart-label"><strong>([^<]+)<\/strong>/g)].map((match) => match[1])).toEqual(["Kiến thức chuyên môn", "Kỹ năng bổ trợ"]);
    expect(section).toContain("<span>Điểm nhóm 79,4</span>");
    expect(section).toContain(">5 kỹ năng</span>");
    // Segments in scale order, each a button that names the group, the count and the share.
    expect([...section.matchAll(/class="scomp-chart-seg scomp-chart-(\w+)/g)].map((match) => match[1])).toEqual(["excellent", "proficient", "good", "upcoming", "exempt"]);
    expect(section).toContain('aria-label="Kiến thức chuyên môn: 1 kỹ năng Xuất sắc, 20% số kỹ năng của nhóm. Bấm để xem các kỹ năng này."');
    // Each bar is the group's share of the axis; its segments grow with their counts but stay at least 14px wide (2026-10-25).
    expect(section).toContain('<div class="scomp-chart-bar" style="width:100%;min-width:56px"><button type="button" class="scomp-chart-seg scomp-chart-excellent" style="flex-grow:1"');
    expect(section).toContain('class="scomp-chart-seg scomp-chart-good" style="flex-grow:2"');
    // The tooltip gives the full picture: count, level, group share, the level's range and the skills with their scores.
    const tip = section.slice(section.indexOf("scomp-chart-tip"), section.indexOf("Bấm để xem danh sách"));
    expect(tip).toContain("<strong>1 kỹ năng</strong><span>Xuất sắc</span>");
    expect(tip).toContain("Kiến thức chuyên môn · 20% số kỹ năng của nhóm");
    expect(tip).toContain("Điểm kỹ năng từ 90");
    expect(tip).toContain("<span>Lập trình web</span><b>91</b>");
    expect(section).toContain("Điểm kỹ năng 80 đến dưới 90");
    expect(section).toContain("<span>Lập trình hướng đối tượng</span><b>86,2</b>");
    expect(section).toContain("Đang học hoặc sẽ học học phần đo các kỹ năng này ở học kỳ sau — không phải điểm yếu");
    // Legend for every level present, axis ticks, and the table as a collapsed twin.
    expect([...section.matchAll(/<li><i class="scomp-chart-key scomp-chart-\w+" aria-hidden="true"><\/i>([^<]+)<\/li>/g)].map((match) => match[1]))
      .toEqual(["Xuất sắc", "Giỏi", "Khá", "Trung bình", "Yếu", "Sắp học", "Miễn/công nhận"]);
    expect([...section.matchAll(/<span style="left:[\d.]+%">(\d+)<\/span>/g)].map((match) => match[1])).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(section).toMatch(/<details class="scomp-legend scomp-chart-table"><summary>Xem dạng bảng<\/summary>/);
  });
  it("draws every skill as a score bar on 0–100 with a tooltip and keeps the evidence behind a click", () => {
    const html = withAi("completed");
    const list = html.slice(html.indexOf('id="scomp-skill-list"'));
    // Lập trình web: 91 → Xuất sắc bar at 91%, its score at the tip.
    const row = list.slice(list.indexOf('scomp-skill-name">Lập trình web'), list.indexOf("Học phần minh chứng của Lập trình web"));
    expect(row).toContain('class="scomp-skill-bar scomp-chart-excellent" style="width:91%"');
    expect(row).toContain('<span class="scomp-skill-score" style="left:calc(91% + 6px)">91</span>');
    expect(row).toContain('<span class="sr-only">Xuất sắc · Độ tin cậy trung bình · độ phủ 50%</span>');
    // The tooltip: score and level first, then the skill, confidence and its evidence courses with their results.
    expect(row).toContain("<strong>91 điểm</strong><span>Xuất sắc</span>");
    expect(row).toContain("Lập trình web · kỹ năng của vị trí nghề nghiệp mục tiêu");
    expect(row).toContain("<span>Độ tin cậy trung bình · độ phủ 50%</span>");
    expect(row).toContain("<span>Lập trình web (TST104)</span><b>9,1 · A+</b>");
    expect(row).toContain("Bấm để xem học phần minh chứng");
    // The courses the score comes from, beside it (user 2026-10-30: many skills read the same 68 and looked made up).
    expect(row).toContain('<small class="scomp-skill-from" title="Từ Lập trình web (9,1 · A+) và Nhập môn lập trình (8,6 · A)">Từ Lập trình web (9,1 · A+) và Nhập môn lập trình (8,6 · A)</small>');
    // The opened row repeats the facts, so nothing is only in the tooltip.
    expect(row).toContain('<p class="scomp-meta">91 điểm · Xuất sắc · Độ tin cậy trung bình · độ phủ 50%</p>');
    // A skill without a score has no bar but says why; the axis marks the level thresholds.
    expect(list).toContain('<span class="scomp-skill-none">Sắp học</span>');
    expect(list).toContain('<span style="left:50%">50</span><span style="left:62.5%">62,5</span><span style="left:80%">80</span><span style="left:90%">90</span>');
  });
  it("follows the competency term by term, grouped by school year (STU-COMP-07)", () => {
    const html = withAi("completed");
    const section = html.slice(html.indexOf('id="scomp-history"'), html.indexOf('id="scomp-skills"'));
    expect(section).toContain("Theo dõi năng lực theo học kỳ");
    expect(section).toContain("Điểm năng lực tổng tăng từ 68,5 (HK1 2023–2024) lên 79,4 (HK2 2025–2026). Cao nhất là 81 vào HK2 2024–2025.");
    // One row group per school year, its end-of-year score in the header.
    expect([...section.matchAll(/Năm học (\d{4}–\d{4})<span>Cuối năm: ([\d,]+) · (\S+)<\/span>/g)].map((match) => match.slice(1).join(" "))).toEqual([
      "2023–2024 72 Khá", "2024–2025 81 Giỏi", "2025–2026 79,4 Khá",
    ]);
    // Group columns follow the result's groups; a group without a score shows a dash.
    expect(section).toContain('<th scope="col" class="scomp-num">Kiến thức chuyên môn</th><th scope="col" class="scomp-num">Kỹ năng bổ trợ</th>');
    // Changes between the shown scores: rises green, falls amber (red is kept for a course not passed), the first term has none.
    const changes = [...section.matchAll(/<td class="scomp-num">(?:<span class="(sg-status-pass|sg-status-unknown|sg-status-fail|scomp-zero)">([^<]+)<\/span>)<\/td><\/tr>/g)].map((match) => `${match[2]} ${match[1]}`);
    expect(changes).toEqual(["— scomp-zero", "+3,5 sg-status-pass", "+3,3 sg-status-pass", "+5,7 sg-status-pass", "−1,6 sg-status-unknown"]);
    // "Mới nhất", not "Hiện tại": the term being studied is another one (2026-10-25 audit); terms read one way (HK2 2025–2026).
    expect(section).toMatch(/class="scomp-history-latest"><th scope="row">HK2 2025–2026<span class="scomp-career-tag">Mới nhất<\/span><\/th>/);
    expect(section).not.toContain("Hiện tại");
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
    expect(html).toContain("EduPath AI đang viết nhận xét");
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
    // User 2026-11-16: "Xóa cái chữ suy ra từ điểm chữ đi": no note under a course result any more.
    expect(html).not.toContain("<small>suy ra từ điểm chữ</small>");
  });
  it("lists a skill in several groups under each one and names them in its details (2026-10-22)", () => {
    const assessment = fixtureAssessment("completed");
    const skills = assessment.result.skills.map((skill) => skill.key === "S03" ? { ...skill, groupKeys: ["G1", "G2"] } : skill);
    const html = render({ assessment: { ...assessment, result: { ...assessment.result, skills } }, aiEnabled: true, workerOnline: true });
    expect(html).toContain("Kỹ năng bổ trợ (2)");
    expect(html).toContain("Kiến thức chuyên môn (4)");
    expect(html).toContain("Thuộc các nhóm năng lực: Kiến thức chuyên môn, Kỹ năng bổ trợ. Điểm kỹ năng được tính vào từng nhóm.");
    expect(withAi("completed")).not.toContain("Thuộc các nhóm năng lực");
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
  it("colours progress amber when late and green when on plan, and names the plan's next term", () => {
    const late = withAi("completed");
    // Amber, not red: red is kept for a course not passed (user 2026-10-30).
    expect(late).toMatch(/scomp-plan-status scomp-plan-late"><span aria-hidden="true">!<\/span><span>Chậm so với kế hoạch: 1 học phần · 3 TC/);
    expect(late).toContain('<dd class="sg-status-unknown">1 ');
    expect(late).toContain("<dt>Học kỳ hiện tại (suy từ bảng điểm)</dt><dd>HK2 2025–2026</dd>");
    expect(late).toContain("kế hoạch HK2 2025–2026 · Chưa học");
    // "Học kỳ tới" of the Kế hoạch đào tạo, apart from Tổng quan's (Lộ trình AI) (user 2026-10-30).
    expect(late).toContain(">Học kỳ tới theo Kế hoạch đào tạo</h3>");
    expect(late).not.toMatch(/>Học kỳ tới<\/h3>/);
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
    const unset = { ...graduation, resolution: "specialty_unset" as const, standard: null, evaluation: null };
    const html = render({ assessment: fixtureAssessment("completed"), aiEnabled: true, workerOnline: true }, { graduation: unset });
    // The words of Xét tốt nghiệp itself (student-graduation-data.ts unresolvedCopy).
    expect(html).toContain(unresolvedCopy(unset).title);
    expect(html).not.toContain("scomp-grad-verdict");
  });
  it("shows an introduction when there is no assessment yet", () => {
    const html = render({ assessment: null, aiEnabled: false, workerOnline: false }, { specialty: null });
    expect(html).toContain("Chưa có kết quả đánh giá");
    expect(html).toContain("Đánh giá năng lực</button>");
    // The transcript and the specialty only (2026-11-14): the intro says so, a missing specialty reads "Chưa chọn".
    expect(html).toContain("Khi hồ sơ có bảng điểm và chuyên ngành, bấm “Đánh giá năng lực”");
    expect(html).toContain("<span>Chưa chọn</span>");
    expect(html).not.toContain("Xóa kết quả đánh giá");
  });
  it("needs no target career: the checklist and the intro leave it out, and nothing asks for it (2026-11-14)", () => {
    const html = render({ assessment: null, aiEnabled: false, workerOnline: false }, { target: false });
    const checklist = html.slice(html.indexOf('aria-label="Điều kiện đánh giá"'), html.indexOf("</ul>", html.indexOf('aria-label="Điều kiện đánh giá"')));
    expect(checklist).toContain("<strong>Bảng điểm</strong>");
    expect(checklist).toContain("<strong>Chuyên ngành</strong>");
    expect(checklist).not.toContain("Vị trí nghề nghiệp mục tiêu");
    expect(html).not.toContain("vị trí nghề nghiệp mục tiêu");
    // An assessment made without a target: the competency page shows it all, with no note that the profile changed.
    const assessment = fixtureAssessment("completed");
    const result = { ...assessment.result, career: null, meta: { ...assessment.result.meta, career: null } };
    const shown = render({ assessment: { ...assessment, result }, aiEnabled: true, workerOnline: true }, { target: false });
    expect(sectionOrder(shown, ["scomp-overview", "scomp-ai", "scomp-skills", "scomp-progress"]).every((index) => index > 0)).toBe(true);
    expect(shown).not.toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
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
    // Another target career matters only to Khoảng trống kỹ năng.
    const assessment = fixtureAssessment("completed");
    const other = { ...assessment, result: { ...assessment.result, meta: { ...assessment.result.meta, career: { id: "career-2", version: "v1" } } } };
    expect(render({ assessment: other, aiEnabled: true, workerOnline: true })).not.toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
    expect(render({ assessment: other, aiEnabled: true, workerOnline: true }, { view: "gap" })).toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
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
    expect(section).toContain("số kỹ năng của vị trí nghề nghiệp đạt ngưỡng tăng từ 0 lên 1/5. Tăng nhiều nhất: Lập trình web (+19 điểm).");
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
  it("explains the fit levels with the student's own marked, like the competency scale (2026-10-22)", () => {
    const html = withAi("completed", "gap");
    const summary = html.slice(html.indexOf('id="sgap-summary"'), html.indexOf('id="scomp-ai"'));
    expect(summary).toContain("<summary>Thang mức phù hợp</summary>");
    // The điểm phù hợp (56,62 since comp-calc-v15) in points with a pip badge, like "82/100 · Giỏi" (2026-10-22: "đơn vị điểm thôi chứ khỏi %").
    expect(summary).toMatch(/<span class="scomp-kicker">Mức phù hợp<\/span><p class="scomp-big"><strong>56,6<\/strong><span>\/100<\/span><\/p><p class="scomp-score-tags"><span class="scomp-level scomp-level-2 meaning-warn">.*?<\/span>Ít phù hợp<\/span><\/p>/);
    expect(summary).not.toContain("%");
    expect(summary).not.toContain("Điểm trung bình các kỹ năng của vị trí nghề nghiệp có điểm");
    // Five badged levels, the student's marked; "Chưa đủ dữ liệu" is no row of the scale.
    const scale = summary.slice(summary.indexOf("<summary>Thang mức phù hợp</summary>"));
    expect([...scale.matchAll(/<\/span>([^<]+)<\/span>(?:<span class="scomp-career-tag">Mức của bạn<\/span>)?<\/span><span class="scomp-legend-range">([^<]+)<\/span>/g)].map((match) => `${match[1]} ${match[2]}`)).toEqual([
      "Rất phù hợp từ 90", "Phù hợp 80 đến dưới 90", "Trung bình 62,5 đến dưới 80", "Ít phù hợp 50 đến dưới 62,5", "Không phù hợp dưới 50",
    ]);
    expect(scale).toMatch(/Ít phù hợp<\/span><span class="scomp-career-tag">Mức của bạn<\/span>/);
    expect(scale).not.toContain("Chưa đủ dữ liệu");
    expect(scale).toContain("Cùng ngưỡng với Thang mức năng lực ở trang Đánh giá năng lực.");
    expect(summary).not.toContain("Khá phù hợp");
    expect(summary.match(/Mức của bạn/g)).toHaveLength(1);
    expect(summary).toContain("Cách tính điểm phù hợp: trung bình điểm các kỹ năng của vị trí nghề nghiệp, kỹ năng Bắt buộc tính gấp đôi kỹ năng Ưu tiên; kỹ năng chưa có điểm (chưa học, sắp học, cần tự học, chưa đủ dữ liệu) tính 0 điểm.");
  });
  it("shows the gap part of the AI text with its courses", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("Nhận xét từ EduPath AI về khoảng trống kỹ năng");
    expect(html).toContain("Với vị trí nghề nghiệp mục tiêu");
    expect(html).toContain("Học phần Kiểm thử phần mềm (TST105)");
    expect(html).not.toContain("XXX999");
    expect(html).not.toContain("Bước tiếp theo");
  });
  it("renders gap statuses with glyphs and never colours missing data as a failure", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("✓</span> Đạt ngưỡng");
    expect(html).toContain("Dưới ngưỡng · thiếu 10 điểm");
    expect(html).toContain("Sắp học · HK1 2026–2027");
    expect(html).not.toContain("Sắp học · HK261");
    // Each score names the courses it comes from.
    expect(html).toContain("<strong>91</strong></span><small>Xuất sắc</small><small>Từ Lập trình web (9,1 · A+) và Nhập môn lập trình (8,6 · A)</small>");
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
    expect(html).toContain(">Kỹ năng cần tự học ngoài chương trình</h3>");
    expect(html).toContain("Kỹ năng: Docker");
    expect(html).toContain("Không có học phần nào trong chương trình đào tạo của bạn để đăng ký cho kỹ năng này.");
    expect(html).toContain("Đóng gói ứng dụng web của bạn bằng Docker.");
  });
  it("advises only on the target career's skills: raising its met skills to Giỏi", () => {
    const assessment = fixtureAssessment("completed");
    const deepen = [
      { ...fixtureResult.skillPlans![0]!, skillKey: "S01", name: "Lập trình web", level: "good" as const, levelLabel: "Khá", score: 76, careerSkill: true, purpose: "deepen" as const },
      { ...fixtureResult.skillPlans![1]!, skillKey: "S03", name: "Git", level: "good" as const, levelLabel: "Khá", score: 78, careerSkill: true, purpose: "deepen" as const },
    ];
    const html = render({ assessment: { ...assessment, result: { ...fixtureResult, skillPlans: deepen } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    const plans = html.slice(html.indexOf("Nâng kỹ năng của vị trí nghề nghiệp lên mức Giỏi"), html.indexOf(">Kỹ năng cần tự học ngoài chương trình</h3>"));
    expect(plans).toContain("Kỹ năng của vị trí nghề nghiệp Lập trình viên web mà bạn đã đạt ngưỡng nhưng chưa lên mức Giỏi (từ 80)");
    expect(plans).toContain("Kỹ năng: Lập trình web");
    expect(plans).toContain("Khá · 76");
    expect(plans).toContain("Bạn đã học hết học phần đo kỹ năng này trong chương trình; hãy làm một dự án nhỏ gắn với vị trí nghề nghiệp");
    expect(html).not.toContain("Kỹ năng cần củng cố (dưới mức Khá)");
    // Weak skills outside the career (plans of an older result) are never advised on once a career is chosen.
    const older = withAi("completed", "gap");
    expect(older).not.toContain("Kỹ năng cần củng cố (dưới mức Khá)");
    expect(older).not.toContain("Kỹ năng: Sử dụng tiếng Anh");
    // The AI's advice on the career's own skills shows on this page too.
    expect(older).toContain("Nâng kỹ năng của vị trí nghề nghiệp");
    expect(older).toContain("Học phần Cấu trúc dữ liệu và giải thuật (TST102)");
  });
  it("without a target career, gives each weak skill its courses: retake, take with prerequisites checked, or self-study", () => {
    const assessment = fixtureAssessment("completed");
    const html = render({ assessment: { ...assessment, result: { ...assessment.result, career: null } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    const plans = html.slice(html.indexOf("Kỹ năng cần củng cố (dưới mức Khá)"), html.indexOf(">Kỹ năng cần tự học ngoài chương trình</h3>"));
    expect(plans).toContain("Kỹ năng: Sử dụng tiếng Anh");
    expect(plans).toContain("Trung bình · 61,5");
    expect(plans).toMatch(/scomp-plan-action">Học cải thiện<\/span><strong>Tiếng Anh 2<\/strong>/);
    expect(plans).toContain("✓</span> Đã học, đạt · điểm 5,8 (C)");
    expect(plans).toMatch(/scomp-plan-action">Học mới<\/span><strong>Tiếng Anh chuyên ngành<\/strong>/);
    expect(plans).toContain("✓</span> Đủ điều kiện đăng ký");
    expect(plans).toContain("HK1 2026–2027 theo KHĐT");
    expect(plans).toContain("Kỹ năng: Định tuyến mạng");
    expect(plans).toContain("Không còn học phần nào trong chương trình của bạn để học thêm cho kỹ năng này");
    // Results stored before comp-calc-v6 have no plans: the part is left out, nothing breaks.
    const old = render({ assessment: { ...assessment, result: { ...fixtureResult, career: null, skillPlans: undefined } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(old).not.toContain("Kỹ năng cần củng cố (dưới mức Khá)");
  });
  it("never says every skill is reached while skills still to come count 0 (user 2026-10-30)", () => {
    const assessment = fixtureAssessment("completed");
    const career = assessment.result.career!;
    // Every scored skill met, Kiểm thử tự động Sắp học, Docker left out: (2 × 91 + 2 × 86 + 72 + 0) / 6 = 71.
    const requirements = career.requirements.filter((req) => req.requirementId !== "q5").map((req) => req.requirementId === "q2" ? { ...req, status: "met" as const, score: 86, deficit: null }
      : req.requirementId === "q3" ? { ...req, status: "met" as const, score: 72, deficit: null } : req);
    const html = render({ assessment: { ...assessment, result: { ...assessment.result, career: { ...career, requirements } } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    const summary = html.slice(html.indexOf('id="sgap-summary"'), html.indexOf('id="scomp-ai"'));
    expect(summary).toContain('<p class="scomp-prose sg-status-pass">✓ Các kỹ năng đã có điểm đều đạt ngưỡng.</p>');
    expect(summary).toContain("Kiểm thử tự động chưa có điểm (sắp học) nên đang tính 0, kéo điểm phù hợp xuống 71/100; điểm sẽ tăng khi bạn học các học phần đó.");
    expect(summary).not.toContain("Bạn đã đạt mọi kỹ năng");
    // Trung bình as a fit is amber, like Trung bình as a level (one colour per word).
    expect(summary).toMatch(/scomp-level scomp-level-3 meaning-warn">.*?<\/span>Trung bình<\/span>/);
    // With nothing still to come, every skill is reached.
    const done = requirements.filter((req) => req.requirementId !== "q4");
    const all = render({ assessment: { ...assessment, result: { ...assessment.result, career: { ...career, requirements: done } } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(all).toContain("✓ Bạn đã đạt mọi kỹ năng của vị trí nghề nghiệp này.");
  });
  it("says the self-study list is only the skills the program has no course for", () => {
    const assessment = fixtureAssessment("completed");
    const html = render({ assessment: { ...assessment, result: { ...assessment.result, selfStudy: [] } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(html).toContain("Chương trình của bạn có học phần cho mọi kỹ năng của vị trí nghề nghiệp này, nên không có kỹ năng nào phải tự học ngoài chương trình.");
    expect(html).not.toContain("Không có kỹ năng nào cần tự học");
  });
  it("does not praise a career that has no requirements yet", () => {
    const assessment = fixtureAssessment("completed");
    const result = { ...assessment.result, career: { ...assessment.result.career!, requirements: [] } };
    const html = render({ assessment: { ...assessment, result }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(html).toContain("Vị trí nghề nghiệp này chưa có yêu cầu kỹ năng trong danh mục nên chưa so sánh được.");
    expect(html).not.toContain("Bạn đã đạt mọi kỹ năng có dữ liệu của vị trí nghề nghiệp này.");
  });
  it("asks for a target career on Định hướng nghề nghiệp when none is chosen, and shows nothing else (mockup F, 2026-11-14)", () => {
    const assessment = fixtureAssessment("completed");
    const withoutCareer = { ...assessment, result: { ...assessment.result, career: null, meta: { ...assessment.result.meta, career: null } } };
    const html = render({ assessment: withoutCareer, aiEnabled: true, workerOnline: true }, { view: "gap", target: false });
    expect(html).toContain('<h3 id="sgap-no-target-title">Chọn vị trí nghề nghiệp mục tiêu để xem kỹ năng còn thiếu</h3>');
    expect(html).toContain("Trang này so năng lực của bạn với yêu cầu của một vị trí nghề nghiệp. Bạn chọn vị trí ở Định hướng nghề nghiệp, EduPath AI tính lại ngay.");
    expect(html).toContain('<a class="sw-primary" href="#career">Mở Định hướng nghề nghiệp</a>');
    // In place of the target's summary; the courses for the weak skills need no target and stay.
    for (const id of ["sgap-summary", "scomp-career", "sgap-history"]) expect(html).not.toContain(`id="${id}"`);
    expect(html.indexOf('id="sgap-no-target-title"')).toBeLessThan(html.indexOf('id="scomp-courses"'));
    expect(html).not.toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
    // The checklist of this page names the target; its Chọn opens the popup of this page (user 2026-11-17), not Định hướng nghề nghiệp.
    expect(html).toMatch(/<strong>Vị trí nghề nghiệp mục tiêu<\/strong><span>Chưa chọn<\/span>.*?<button type="button" class="sw-text-link" aria-haspopup="dialog">Chọn<\/button>/);
    // Before any assessment: choose, then assess.
    const first = render({ assessment: null, aiEnabled: false, workerOnline: false }, { view: "gap", target: false });
    expect(first).toContain("Hãy chọn vị trí ở Định hướng nghề nghiệp, rồi bấm “Đánh giá năng lực” để xem kỹ năng còn thiếu.");
    expect(first).not.toContain("Chưa có kết quả phân tích");
  });
  it("asks to assess again when the target was chosen after an assessment made without one", () => {
    const assessment = fixtureAssessment("completed");
    const withoutCareer = { ...assessment, result: { ...assessment.result, career: null, meta: { ...assessment.result.meta, career: null } } };
    const html = render({ assessment: withoutCareer, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(html).toContain("Cần đánh giá lại với vị trí nghề nghiệp mục tiêu");
    expect(html).toContain("với vị trí <strong>Lập trình viên web</strong>");
    for (const id of ["scomp-career", "sgap-history", "sgap-no-target-title"]) expect(html).not.toContain(`id="${id}"`);
    expect(html).toContain('id="scomp-courses"');
  });
  it("introduces the page before the first assessment", () => {
    const html = render({ assessment: null, aiEnabled: false, workerOnline: false }, { view: "gap" });
    expect(html).toContain("Chưa có kết quả phân tích");
    expect(html).toContain("Khoảng trống kỹ năng được tính cùng lúc với đánh giá năng lực");
  });
});

describe("StudentCompetency — audit of 2026-10-25", () => {
  const withResult = (patch: (result: typeof fixtureResult) => typeof fixtureResult, view?: CompetencyView) => {
    const assessment = fixtureAssessment("completed");
    return render({ assessment: { ...assessment, result: patch(assessment.result) }, aiEnabled: true, workerOnline: true }, { view });
  };
  /** The fixture as computed by comp-calc-v17 in HK261 (being studied), HK262 next. */
  const v17 = (result: typeof fixtureResult) => ({
    ...result, meta: { ...result.meta, calcVersion: "comp-calc-v17" }, transcript: { ...result.transcript, studyTerm: "HK261" },
    progress: { ...result.progress!, currentTerm: "HK261", nextTerm: "HK262" },
  });

  it("links to the career page and the gap page by their names", () => {
    const html = withAi("completed");
    expect(html).toContain('href="#skill-gap">Xem Khoảng trống kỹ năng');
    const none = withResult((result) => ({ ...result, career: null }));
    expect(none).toContain('<a class="sw-text-link" href="#career">Chọn vị trí nghề nghiệp mục tiêu');
    // Khoảng trống kỹ năng changes the target in its own popup (user 2026-11-17: "có thể hiện 1 popup đổi ở trang này luôn"); the other
    // items of its checklist stay links.
    const gap = withResult((result) => ({ ...result, career: null }), "gap");
    expect(gap).toContain('<button type="button" class="sw-text-link" aria-haspopup="dialog">Đổi</button>');
    expect(gap).toContain('<a class="sw-text-link" href="#profile">Chỉnh sửa</a>');
    expect(gap).not.toContain('href="#career">Đổi');
  });

  it("explains Chưa học and names a planned evidence course Sắp học after the term being studied", () => {
    const html = withAi("completed");
    expect(html).toContain("<li><strong>Chưa học:</strong> học phần đo kỹ năng đó đã qua học kỳ trong kế hoạch mà bạn chưa học, hoặc không có trong kế hoạch; hãy đăng ký ở học kỳ tới.</li>");
    // Kiểm thử phần mềm (TST105), planned for HK261 while HK252 is the newest term: Sắp học, not Chưa học; not registered yet.
    const row = html.slice(html.indexOf("<td>TST105</td>"), html.indexOf("</tr>", html.indexOf("<td>TST105</td>")));
    expect(row).toContain("Kiểm thử phần mềm<small>Sắp học · HK1 2026–2027</small>");
    expect(row).toContain("<td>Chưa đăng ký</td>");
    expect(row).toContain("<td>Dự kiến HK1 2026–2027</td>");
    expect(html).toContain("<span>Kiểm thử phần mềm (TST105)</span><b>Sắp học · HK1 2026–2027</b>");
    // The skill's own term reads the same way (it read "Sắp học · HK261").
    const termed = withResult((result) => ({ ...result, skills: result.skills.map((skill) => (skill.key === "S07" ? { ...skill, upcoming: true, upcomingTerm: "HK261" } : skill)) }));
    expect(termed).toContain('<span class="scomp-skill-none">Sắp học · HK1 2026–2027</span>');
  });

  it("says a planned term that has passed and when to register, on the evidence and on the suggested courses", () => {
    // TST105 planned for HK253 while HK261 is being studied.
    const late = (result: typeof fixtureResult) => {
      const next = v17(result);
      return {
        ...next, courses: next.courses.map((course) => (course.code === "TST105" ? { ...course, plannedTerm: "HK253" } : course)),
        courseSuggestions: next.courseSuggestions.map((course) => (course.code === "TST105" ? { ...course, term: "HK253", overdue: true } : course)),
      };
    };
    const html = withResult(late);
    expect(html).toContain("Kiểm thử phần mềm<small>Chưa học</small>");
    expect(html).toContain("<td>Đã qua học kỳ dự kiến HK3 2025–2026 — đăng ký ở HK2 2026–2027</td>");
    const gap = withResult(late, "gap");
    expect(gap).toContain("<dt>Học kỳ</dt><dd>Đã qua học kỳ dự kiến HK3 2025–2026 — đăng ký ở HK2 2026–2027</dd>");
    expect(gap).not.toContain("theo KHĐT</dd>");
  });

  it("hides the evidence table of a skill without courses of the student's own path", () => {
    const html = withResult((result) => ({ ...result, skills: result.skills.map((skill) => (skill.key === "S08" ? { ...skill, evidenceCourses: [] } : skill)) }));
    expect(html).not.toContain("<caption>Học phần minh chứng của Triển khai dịch vụ đám mây</caption>");
    expect(html).toContain("<caption>Học phần minh chứng của Lập trình web</caption>");
  });

  it("lists a skill of courses without credits under Môn điều kiện (K27/K28 before comp-calc-v17)", () => {
    const html = withResult((result) => ({ ...result, skills: result.skills.map((skill) => (skill.key === "S08" ? { ...skill, notApplicableReason: "no_credits" as const } : skill)) }));
    expect(html).toContain("Môn điều kiện (GDTC/GDQP) (2)");
    expect(html).not.toContain("Ngoài lựa chọn học phần của bạn");
    expect(html).toContain('<span class="scomp-skill-none">Học phần không tính tín chỉ</span>');
  });

  it("counts the next term in courses and spaces the plan's choice labels in results stored before", () => {
    const html = withResult((result) => ({ ...result, progress: { ...result.progress!, nextCount: 2, next: [
      ...result.progress!.next.filter((entry) => entry.kind === "course"),
      { kind: "choice" as const, label: "Chọn2 trong 4 môn sau", required: 2, unit: "course" as const, remaining: 2, options: [
        { code: "TST106", name: "Điện toán đám mây", credits: 3, state: "not_taken" as const }, { code: "TST110", name: "Phát triển ứng dụng di động", credits: 3, state: "not_taken" as const },
      ] },
    ] } }));
    expect(html).toContain("<dt>Học kỳ tới theo Kế hoạch đào tạo (HK1 2026–2027)</dt><dd>3 <small>học phần");
    expect(html).toContain("<strong>Chọn 2 trong 2 môn sau</strong>");
  });

  it("aligns the gap counts, the missing list and the toggle, with the shortfall adding up", () => {
    const html = withAi("completed", "gap");
    const summary = html.slice(html.indexOf('id="sgap-summary"'), html.indexOf('id="scomp-ai"'));
    expect(summary).toContain("<li>Đạt 1/5 kỹ năng · 2 dưới ngưỡng · 1 sắp học · 1 chưa đủ dữ liệu</li><li>3/5 kỹ năng có điểm</li>");
    expect(summary).not.toContain("kỹ năng có dữ liệu");
    expect(html).toContain("Chỉ kỹ năng còn thiếu");
    expect(html).not.toContain("Chỉ kỹ năng chưa đạt");
    // 75 against 85: −10 with a real minus sign; 91 against 85: +6.
    expect(html).toContain('data-label="Chênh lệch">−10<small>Thiếu vừa</small>');
    expect(html).toContain('data-label="Chênh lệch">+6</td>');
    // The career line of the overview reads the same.
    expect(withAi("completed")).toContain("<p class=\"scomp-meta\">Đạt 1/5 kỹ năng · 2 dưới ngưỡng · 1 sắp học · 1 chưa đủ dữ liệu</p>");
    // The last column of the career history is the newest graded term, not "Hiện tại".
    const history = html.slice(html.indexOf('id="sgap-history"'), html.indexOf('id="scomp-courses"'));
    expect(history).toContain("HK2<small>Mới nhất</small>");
  });

  it("names the helped skills once per course card and shows the prerequisite notes of plan courses", () => {
    const html = withAi("completed", "gap");
    expect(html).not.toContain("Giúp rèn kỹ năng");
    const noCareer = withResult((result) => ({ ...result, career: null, skillPlans: result.skillPlans!.map((plan, index) => (index ? plan : {
      ...plan, take: plan.take.map((course) => ({ ...course, eligibility: "review" as const, reviewNotes: ["[71ENG010012]Anh văn dự bị (AV0)"] })),
    })) }), "gap");
    expect(noCareer).toContain("<p class=\"scomp-meta\">Cần xác nhận: [71ENG010012]Anh văn dự bị (AV0)</p>");
  });

  it("lists only similar skills with a score next to a self-study skill", () => {
    // Docker's related S08 has no score (outside the student's choices).
    expect(withAi("completed", "gap")).not.toContain("Kỹ năng gần giống đã đo");
  });

  it("shows the exempt column in the table view of the proficiency chart", () => {
    const html = withAi("completed");
    expect(html).toContain('aria-label="1 kỹ năng Miễn/công nhận trong nhóm Kỹ năng bổ trợ"');
  });
});

describe("StudentCompetency — the older comment while a new one is prepared (user 2026-11-05: like Xét tốt nghiệp)", () => {
  const note = "Nhận xét trước, viết cho kết quả đánh giá cũ — có thể không còn đúng. Nhận xét mới sẽ thay thế khi sẵn sàng.";
  const pendingNote = note;
  // Synthetic older assessment: its S01 is Kiểm thử tự động (Lập trình web in the newest result) and only it has TST120.
  const previous: PreviousAiComment = {
    assessmentId: "22222222-2222-4222-8222-222222222222", assessmentCreatedAt: "2026-10-01T02:00:00.000Z", model: "gemma4:e4b",
    completedAt: "2026-10-01T02:04:00.000Z", promptVersion: "comp-v13",
    output: {
      summary: "Nhận xét cũ: kỹ năng S01 cần thêm thời gian.", groupInsights: [{ groupKey: "G1", comment: "Nhóm G1 ở mức Trung bình." }], strengths: [],
      improvements: [{ skillKey: "S01", priority: "high", comment: "Luyện viết kiểm thử tự động.", courses: [{ courseCode: "TST120", reason: "Học phần đo kỹ năng này." }] }],
      careerFit: { comment: "Lần trước bạn còn thiếu kỹ năng kiểm thử tự động cho vị trí nghề nghiệp mục tiêu." },
      gaps: [{ skillKey: "S02", priority: "medium", explanation: "Chưa học Docker.", courses: [], selfStudy: ["Tự cài Docker cho một dự án nhỏ."] }],
      progress: "", nextSteps: ["Đăng ký DevOps căn bản."],
    },
    context: {
      skillDirectory: [{ key: "S01", name: "Kiểm thử tự động" }, { key: "S02", name: "Docker" }], groups: [{ key: "G1", name: "Kỹ thuật phần mềm" }],
      career: { requirements: [{ skillKey: "S01", status: "below" }, { skillKey: "S02", status: "not_studied" }] },
      courses: [{ code: "TST120", name: "DevOps căn bản" }], courseSuggestions: [],
    },
  };
  const page = (status: AiStatus, view?: CompetencyView, extra: Partial<LatestAssessmentResponse> = {}) =>
    render({ assessment: fixtureAssessment(status, status === "failed" ? "ai_timeout" : null), aiEnabled: true, workerOnline: true, previous, ...extra }, { view });
  const panel = (html: string) => html.slice(html.indexOf('id="scomp-ai"'), html.indexOf("</section>", html.indexOf('id="scomp-ai"')));

  it.each(["queued", "processing", "failed", "cancelled", "deferred"] as const)("keeps it dimmed under the state box while the comment is %s", (status) => {
    // Once the newest failed or was stopped, no new comment is coming by itself: the note says no more (2026-11-10).
    const note = status === "failed" || status === "cancelled" ? "Nhận xét trước, viết cho kết quả đánh giá cũ — có thể không còn đúng." : pendingNote;
    const html = panel(page(status));
    const at = { state: html.indexOf("scomp-ai-state"), dimmed: html.indexOf('<div class="scomp-ai-previous scomp-ai-dimmed"><p class="scomp-ai-old">'), footer: html.indexOf("scomp-ai-footer") };
    expect(at.state).toBeGreaterThan(0);
    expect(at.dimmed).toBeGreaterThan(at.state);
    expect(at.footer).toBeGreaterThan(at.dimmed);
    expect(html).toContain(note);
    // Read with its own assessment's names, never the newest result's.
    expect(html).toContain("Nhận xét cũ: kỹ năng Kiểm thử tự động cần thêm thời gian.");
    expect(html).not.toContain("Nhận xét cũ: kỹ năng Lập trình web");
    expect(html).toContain("<strong>Kỹ thuật phần mềm.</strong> Nhóm Kỹ thuật phần mềm ở mức Trung bình.");
    expect(html).toContain("Học phần DevOps căn bản (TST120): Học phần đo kỹ năng này.");
    // Its own date; the panel's footer stays the one of the current state.
    expect(html).toMatch(/<p class="scomp-ai-old-meta">Gemma 4 E4B có suy luận, chạy cục bộ · tạo lúc [^<]*2026\.<\/p>/);
    expect(html).toContain('<p class="scomp-ai-footer">Nhận xét do AI viết dựa trên kết quả đã tính');
    expect(html).not.toContain("nhóm phát triển");
  });
  it("keeps the state box's actions right under it", () => {
    const failed = panel(page("failed"));
    const older = "Nhận xét trước, viết cho kết quả đánh giá cũ — có thể không còn đúng.";
    expect(failed).toContain("Máy AI xử lý quá thời gian cho phép.");
    expect(failed.lastIndexOf("Tạo lại nhận xét")).toBeLessThan(failed.indexOf(older));
    const processing = panel(page("processing"));
    expect(processing.indexOf("Hủy tạo nhận xét")).toBeLessThan(processing.indexOf(note));
  });
  it("says above the older comment that the newest one failed, when, why and what to do (QA 2026-11-10)", () => {
    const html = panel(page("failed"));
    expect(html).toMatch(/<strong>Chưa tạo được nhận xét mới<\/strong><p>Lần tạo nhận xét mới cho kết quả đánh giá lúc \d\d:\d\d \d\d\/\d\d\/2026 không thành công\. Máy AI xử lý quá thời gian cho phép\. Nhận xét bên dưới là bản trước\. Bấm “Tạo lại nhận xét” để thử lần nữa\.<\/p>/);
    // Not dimmed: the line is in the state box, before the dimmed older comment.
    expect(html.indexOf("Lần tạo nhận xét mới")).toBeLessThan(html.indexOf("scomp-ai-dimmed"));
    expect(html).not.toContain("ai_timeout");
    // Without an older comment the box keeps its short words.
    const alone = panel(page("failed", undefined, { previous: null }));
    expect(alone).toContain("<strong>Chưa tạo được nhận xét</strong><p>Máy AI xử lý quá thời gian cho phép. Kết quả tính toán không bị ảnh hưởng.</p>");
  });
  it("waits for room in the queue on step 2 while deferred, with the regenerate button as an option", () => {
    const html = panel(page("deferred", undefined, { previous: null }));
    expect(html).toContain("Hệ thống sẽ tự xếp hàng tạo nhận xét khi hàng đợi có chỗ, bạn không cần làm gì thêm.");
    expect(html).toContain('<li aria-current="step">2. Chờ hàng đợi có chỗ</li>');
    expect(html).toContain("Tạo lại nhận xét</button>");
  });
  it("shows the gap part on Khoảng trống kỹ năng, with that assessment's career", () => {
    const html = panel(page("processing", "gap"));
    expect(html).toContain(note);
    expect(html).toContain("Lần trước bạn còn thiếu kỹ năng kiểm thử tự động cho vị trí nghề nghiệp mục tiêu.");
    expect(html).toContain("<strong>Docker</strong>");
    expect(html).toContain("Tự học: Tự cài Docker cho một dự án nhỏ.");
    // S01 is a career skill of that assessment outside its gaps: "Nâng kỹ năng của vị trí nghề nghiệp".
    expect(html).toContain("Nâng kỹ năng của vị trí nghề nghiệp");
    expect(html).toContain("<strong>Kiểm thử tự động</strong>");
    // No part for this page: nothing dimmed (never "Nhận xét lần này không có phần riêng…").
    const competencyOnly = { ...previous, output: { ...previous.output, careerFit: { comment: "" }, gaps: [], improvements: [] } };
    const without = panel(page("processing", "gap", { previous: competencyOnly }));
    expect(without).not.toContain(note);
    expect(without).not.toContain("Nhận xét lần này không có phần riêng");
    expect(panel(page("processing", "competency", { previous: competencyOnly }))).toContain(note);
  });
  it("shows nothing older once the comment is ready, without one, or while AI is off", () => {
    const ready = page("completed");
    expect(ready).not.toContain(note);
    expect(ready).not.toContain("scomp-ai-dimmed");
    expect(ready).toContain("Bạn đang có nền tảng lập trình web rất tốt");
    expect(page("processing", "competency", { previous: null })).not.toContain(note);
    expect(page("processing", "competency", { previous: undefined })).not.toContain(note);
    const off = page("disabled", "competency", { aiEnabled: false });
    expect(off).toContain("Nhận xét AI chưa được bật");
    expect(off).not.toContain(note);
    // AI just switched on: the result has no comment yet, the older one stays until one is made.
    expect(page("disabled")).toContain(note);
  });
  it("is the same for a cố vấn học tập working in the student's page", () => {
    installAdvisorFetch("00000000-0000-4000-8000-0000000e2e05");
    try {
      const html = panel(page("processing"));
      expect(html).toContain(note);
      expect(html).toContain("Nhận xét cũ: kỹ năng Kiểm thử tự động cần thêm thời gian.");
      expect(html).not.toContain("Hủy tạo nhận xét");
    } finally { stopActing(); }
  });
});

describe("StudentCompetency — progress rules of comp-calc-v19 (user 2026-11-04)", () => {
  const html = (calcVersion: string, view?: CompetencyView) => {
    const assessment = fixtureAssessment("completed");
    return render({ assessment: { ...assessment, result: { ...assessment.result, meta: { ...assessment.result.meta, calcVersion } } }, aiEnabled: true, workerOnline: true }, { view });
  };
  const note = "Kết quả này được tính trước khi hệ thống sửa cách tính tiến độ: môn của học kỳ đang học không còn bị tính là chậm, tín chỉ môn điều kiện (GDTC, GDQP) không được cộng, và nhóm tự chọn ghi đúng số tín chỉ còn thiếu. Bấm “Đánh giá lại” để cập nhật.";

  it("asks a result stored before comp-calc-v19 for Đánh giá lại on Đánh giá năng lực, like the v18 thesis note", () => {
    expect(html("comp-calc-v18")).toContain(note);
    expect(html("comp-calc-v19")).not.toContain(note);
    // Khoảng trống kỹ năng shows no progress, so no note there.
    expect(html("comp-calc-v18", "gap")).not.toContain(note);
  });
});
