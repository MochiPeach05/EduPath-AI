import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StudentOverview, {
  OverviewDashboard, defaultTermCode, emphasize, evidenceText, formatDecimal, gpaChangeText, gpaScale, pageOfLink, planLoadText, reasonTone,
  termChip, termGroups, type StudentProfile,
} from "./StudentOverview";
import type { OverviewResponse } from "./overview-types";

// Invented student and results (no real data).
const student: StudentProfile = {
  name: "Sinh viên", studentCode: null, cohortCode: "K29", className: null, cohortYear: 2023, currentSemester: null, email: null,
  careerGoal: null, interests: null, profileStatus: "complete", specialty: "CNPM", careerPositionId: "c1", careerPosition: null, surveyUpdatedAt: "2026-10-20T00:00:00Z", surveyComplete: true,
};
const term = (code: string) => {
  const yy = Number(code.slice(2, 4));
  return { code, label: `HK${code.slice(4)} ${2000 + yy}–${2001 + yy}` };
};
const course = (code: string, name: string, state: "passed" | "failed" | "running" | "late" | "planned", detail: string, credits = 3) => ({ code, name, credits, state, detail });

const full: OverviewResponse = {
  generatedAt: "2026-10-30T03:00:00.000Z",
  profile: { cohortCode: "K29", majorName: "Công nghệ thông tin", specialtyName: "Công nghệ phần mềm", careerName: "Lập trình viên giao diện web" },
  readiness: { transcript: true, specialty: true, career: true, survey: true, assessment: true, roadmap: true },
  terms: { studying: term("HK261"), next: { ...term("HK262"), start: "2026-12-21", end: "2027-04-04", daysUntil: 52 } },
  transcript: {
    updatedAt: "2026-10-28T02:00:00.000Z", gpa4: 2.85, studyGpa4: 2.62, gpa10: 7.28, rank: "Khá", credits: 79, gpaChange: 0.03,
    series: [
      { term: term("HK231"), termGpa4: 2.62, studyGpa4: 2.62, cumulativeGpa4: 2.62 }, { term: term("HK232"), termGpa4: 2.41, studyGpa4: 2.47, cumulativeGpa4: 2.52 },
      { term: term("HK241"), termGpa4: 3.05, studyGpa4: 2.66, cumulativeGpa4: 2.74 }, { term: term("HK251"), termGpa4: 2.5, studyGpa4: 2.62, cumulativeGpa4: 2.85 },
    ],
  },
  progress: {
    blocked: null, totalCredits: 126, passedCredits: 79, runningCredits: 9, lateCredits: 6, remainingCredits: 38, termsLeft: 2, creditsPerTerm: 19, planMaxPerTerm: 16,
    terms: [
      { term: term("HK231"), state: "done", passedCredits: 15, plannedCredits: 15, courses: [course("71ITBS10103", "Nhập môn Công nghệ thông tin", "passed", "A")] },
      { term: term("HK241"), state: "late", passedCredits: 12, plannedCredits: 15, courses: [course("71ITSE30603", "Phát triển ứng dụng di động", "failed", "cần học lại"), course("71ITSE30503", "Lập trình ứng dụng Web", "passed", "B+")] },
      { term: term("HK261"), state: "running", passedCredits: 0, plannedCredits: 9, courses: [course("71ITSE41203", "Kiểm thử phần mềm", "running", "đang học")] },
      { term: term("HK262"), state: "planned", passedCredits: 0, plannedCredits: 20, courses: [course("71ITGR40303", "Chuyên đề Tốt nghiệp 2", "planned", "dự kiến")] },
    ],
  },
  graduation: {
    standardName: "Tiêu chuẩn K29 · Công nghệ phần mềm", eligible: false, missing: 4,
    conditions: [
      { label: "Tín chỉ tích lũy", done: 79, need: 126, unit: "TC", met: false, note: null },
      { label: "Học phần bắt buộc", done: 40, need: 42, unit: "môn", met: false, note: "Còn: Phát triển ứng dụng di động, Phân tích thiết kế hệ thống" },
      { label: "GPA tích lũy từ 2,00", done: "2,85", need: null, unit: "", met: true, note: null },
    ],
  },
  competency: {
    assessedAt: "2026-10-28T02:30:00.000Z", overallScore: 68.4, overallLevel: "Khá", stale: false,
    strengths: [
      { name: "Phát triển web", score: 85.7, courses: [{ name: "Lập trình ứng dụng Web", letter: "B+" }, { name: "Thiết kế web", letter: "A" }, { name: "Đồ án web", letter: null }] },
      { name: "Cơ sở dữ liệu", score: 85.5, courses: [{ name: "Cơ sở dữ liệu", letter: "A" }] },
      { name: "Lập trình cơ bản", score: 71.3, courses: [] },
    ],
    career: { name: "Lập trình viên giao diện web", fitScore: 74.6, fitLabel: "Phù hợp", met: 4, total: 6,
      gaps: [{ name: "Thiết kế giao diện người dùng", status: "below", label: "Dưới ngưỡng · thiếu 4 điểm" }, { name: "TypeScript", status: "self_study", label: "Cần tự học" }] },
  },
  roadmap: {
    status: "completed", createdAt: "2026-10-29T03:00:00.000Z", term: term("HK262"),
    courses: [{ code: "71ITSE30603", name: "Phát triển ứng dụng di động", credits: 3, reason: "Học lại" }, { code: "71ITSE30803", name: "Lập trình Web nâng cao với framework", credits: 3, reason: "Tự chọn TC309" }],
    skills: ["TypeScript"], firstMonth: { label: "Tháng 12/2026", text: "Ôn lại Java và đăng ký học lại môn chưa đạt." },
    plan: { credits: 20, status: "over" }, limits: { min: 9, max: 18 },
  },
  running: [{ code: "71ITSE30103", name: "Kỹ thuật lập trình", credits: 3, retake: true, skills: ["Lập trình cơ bản"] }, { code: "71ITSE41203", name: "Kiểm thử phần mềm", credits: 3, retake: false, skills: [] }],
  warnings: {
    level: "risk",
    items: [
      { level: "risk", kind: "failed_course", key: "71ITSE30603", text: "Môn bắt buộc chưa đạt: Phát triển ứng dụng di động, chưa có trong kế hoạch học lại.", strong: ["Phát triển ứng dụng di động"], action: { label: "Thêm vào Kế hoạch học kỳ", link: "#roadmap" } },
      { level: "warn", kind: "elective_short", key: "TC309", text: "Nhóm tự chọn TC309 còn thiếu 3 TC.", strong: ["TC309"], action: null },
    ],
  },
  suggestions: ["Học kỳ tới mình nên học những môn nào?", "Mình còn thiếu kỹ năng gì cho vị trí nghề nghiệp mục tiêu?"],
};
const empty: OverviewResponse = {
  generatedAt: "2026-10-30T03:00:00.000Z",
  profile: { cohortCode: "K29", majorName: null, specialtyName: null, careerName: null },
  readiness: { transcript: false, specialty: false, career: false, survey: false, assessment: false, roadmap: false },
  terms: { studying: null, next: { ...term("HK262"), start: "2026-12-21", end: "2027-04-04", daysUntil: 52 } },
  transcript: null, progress: null, graduation: null, competency: null, roadmap: null, running: [],
  warnings: { level: "none", items: [{ level: "warn", kind: "missing_data", key: "transcript", text: "Chưa tính được tiến độ: bạn cần import bảng điểm PDF.", strong: [], action: { label: "Mở Hồ sơ và bảng điểm", link: "#profile" } }] },
  suggestions: ["Làm sao để import bảng điểm PDF?"],
};
const dashboard = (data: OverviewResponse) => renderToStaticMarkup(createElement(OverviewDashboard, { data, navigate: () => {}, openTranscript: () => {} }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Tổng quan helpers", () => {
  it("format numbers the Vietnamese way and the GPA change against the term before", () => {
    expect(formatDecimal(2.85)).toBe("2,85");
    expect(formatDecimal(2, 1)).toBe("2,0");
    expect(gpaChangeText(0.03)).toBe("+0,03 so với học kỳ trước");
    expect(gpaChangeText(-0.05)).toBe("−0,05 so với học kỳ trước");
    expect(gpaChangeText(0.001)).toBe("Không đổi so với học kỳ trước");
    expect(gpaChangeText(null)).toBeNull();
  });

  it("group the plan's terms by school year and open the first late one", () => {
    const terms = full.progress!.terms;
    expect(termGroups(terms).map((group) => [group.year, group.terms.map((item) => item.term.code)])).toEqual([
      ["2023–2024", ["HK231"]], ["2024–2025", ["HK241"]], ["2026–2027", ["HK261", "HK262"]],
    ]);
    expect(defaultTermCode(terms)).toBe("HK241");
    expect(defaultTermCode(terms.filter((item) => item.state !== "late"))).toBe("HK261");
    expect(defaultTermCode([])).toBeNull();
    expect(terms.map(termChip)).toEqual([
      { main: "15/15", sub: "đủ" }, { main: "12/15", sub: "còn nợ" }, { main: "9 TC", sub: "đang học" }, { main: "20 TC", sub: "dự kiến" },
    ]);
  });

  it("bold a warning's names and map its link to a portal page", () => {
    expect(emphasize("Nhóm tự chọn TC309 còn thiếu 3 TC.", ["TC309", "3 TC"])).toEqual([
      { text: "Nhóm tự chọn ", strong: false }, { text: "TC309", strong: true }, { text: " còn thiếu ", strong: false }, { text: "3 TC", strong: true }, { text: ".", strong: false },
    ]);
    expect(emphasize("Không có gì", ["vắng"])).toEqual([{ text: "Không có gì", strong: false }]);
    expect(pageOfLink("#roadmap")).toBe("roadmap");
    expect(pageOfLink("#skill-gap")).toBe("skill-gap");
    expect(pageOfLink("#admin")).toBeNull();
    expect(pageOfLink(null)).toBeNull();
    expect([reasonTone("Học lại"), reasonTone("Trễ kế hoạch"), reasonTone("Tự chọn TC309"), reasonTone("Theo kế hoạch")]).toEqual(["risk", "warn", "ai", ""]);
  });

  it("say a saved term's credits in the planner's words and name the courses a score comes from", () => {
    const limits = { min: 9, max: 18 };
    expect(planLoadText({ credits: 20, status: "over" }, limits)).toEqual({ text: "20 TC · vượt mức tối đa 18 TC", meaning: "warn" });
    expect(planLoadText({ credits: 6, status: "under" }, limits)).toEqual({ text: "6 TC · dưới mức tối thiểu 9 TC", meaning: "warn" });
    expect(planLoadText({ credits: 15, status: "ok" }, limits)).toEqual({ text: "15 TC", meaning: "none" });
    expect(planLoadText({ credits: 20, status: "over" }, null)).toEqual({ text: "20 TC", meaning: "none" });
    const courses = [{ name: "Lập trình ứng dụng Web", letter: "B+" }, { name: "Thiết kế web", letter: "A" }, { name: "Đồ án web", letter: null }];
    expect(evidenceText(courses)).toBe("Lập trình ứng dụng Web (B+), Thiết kế web (A) và 1 môn khác");
    expect(evidenceText(courses.slice(2))).toBe("Đồ án web");
  });

  it("scale the GPA chart from 1,5 (lower when a term is) to 4,0", () => {
    expect(gpaScale([2.15, 3.5, null])).toEqual({ lo: 1.5, hi: 4, ticks: [1.5, 2, 2.5, 3, 3.5, 4] });
    expect(gpaScale([1.2, 2.4]).lo).toBe(1);
    expect(gpaScale([]).lo).toBe(1.5);
  });
});

describe("Tổng quan dashboard", () => {
  it("leaves out the countdown, the dates and the ✗ marks the user dropped, and boxes the suggested questions (2026-10-30)", () => {
    const html = dashboard(full);
    expect(text(html)).not.toMatch(/bắt đầu sau|soạn (hôm|\d)|đánh giá \d|✗/);
    expect(html).toContain('class="ov-columns"');
    expect(html).toMatch(/class="ov-sugs"[^>]*><button type="button">/);
  });

  it("shows the six key figures, the cards in the approved order and Cần chú ý last, without a notifications block", () => {
    const html = dashboard(full);
    const plain = text(html);
    for (const figure of ["GPA tích lũy 2,85 / 4 Khá +0,03 so với học kỳ trước", "Tín chỉ đã đạt 79 / 126 63% chương trình · 9 TC đang học", "Năng lực chung 68,4 / 100 Khá",
      "Mức phù hợp với vị trí nghề nghiệp 74,6 / 100 Phù hợp 4/6 kỹ năng đạt ngưỡng", "Xét tốt nghiệp Chưa đủ Còn 4 điều kiện", "Lộ trình AI Đã có"]) expect(plain).toContain(figure);
    const order = ["Tiến độ học tập", "Học kỳ này", "Học kỳ tới · theo Lộ trình AI", "Xét tốt nghiệp", "Năng lực và vị trí nghề nghiệp mục tiêu", "Điểm trung bình theo học kỳ", "Hỏi nhanh Trợ lý AI", "Cần chú ý"]
      .map((title) => html.indexOf(`>${title}</h2>`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain(">Thông báo</h2>");
    expect(html).not.toContain("3 tháng");
  });

  it("opens the first late term with its courses and marks each term chip", () => {
    const html = dashboard(full);
    expect(html).toContain('class="ov-term ov-term-late" aria-pressed="true"');
    expect(text(html)).toContain("Phát triển ứng dụng di động · 3 TC cần học lại");
    expect(html).toContain("ov-term ov-term-running");
    expect(text(html)).toContain("Còn lại 32 TC");
  });

  it("draws the GPA chart with a legend, end labels, the 2,00 threshold and a data table", () => {
    const html = dashboard(full);
    const plain = text(html);
    expect(plain).toContain("Điểm TB tích lũy (chỉ tính môn đã đạt) Điểm TB học tập (tính cả môn chưa đạt) Điểm TB học kỳ (riêng từng học kỳ) Ngưỡng tốt nghiệp 2,00");
    expect(plain).toContain("2,85 tích lũy");
    expect(plain).toContain("2,50 học kỳ");
    expect(plain).toContain("2,62 học tập");
    // Three printed averages a term (học kỳ, học tập, tích lũy): a dot each for every term.
    expect(html.match(/<circle /g)?.length).toBe(12);
    expect(html.match(/<tr>/g)?.length).toBe(1 + full.transcript!.series.length);
    expect(plain).toContain("Học kỳ Điểm TB học kỳ Điểm TB học tập Điểm TB tích lũy");
    expect(plain).toContain("HK1 2025–2026 2,50 2,62 2,85");
    expect(plain).toContain("Điểm TB học tập 2,62");
  });

  it("lists this term's courses, the AI roadmap's choices and the warnings with their actions", () => {
    const plain = text(dashboard(full));
    expect(plain).toContain("Kỹ thuật lập trình đang học lại · 3 TC Rèn luyện: Lập trình cơ bản");
    expect(plain).toContain("Phát triển ứng dụng di động · 3 TC Học lại");
    expect(plain).toContain("Tháng 12/2026: Ôn lại Java");
    expect(plain).toContain("Kế hoạch học kỳ của bạn 20 TC · vượt mức tối đa 18 TC Mức cho phép: 9–18 TC mỗi học kỳ, như trong Kế hoạch học kỳ.");
    expect(plain).toContain("Lộ trình AI gợi ý luyện thêm: TypeScript");
    expect(plain).not.toContain("Kỹ năng nên tự học");
    expect(plain).toContain("2 môn · 6 TC");
    expect(plain).toContain("▲ Nguy cơ chậm tiến độ");
    expect(dashboard(full)).toContain("<b>Phát triển ứng dụng di động</b>");
    expect(plain).toContain("Thêm vào Kế hoạch học kỳ");
    expect(plain).toContain("Học kỳ tới mình nên học những môn nào?");
  });

  it("colours each level, fit and status by its word, never red for something not failed (2026-10-30)", () => {
    const html = dashboard({
      ...full,
      transcript: { ...full.transcript!, rank: "Trung bình" },
      competency: { ...full.competency!, overallLevel: "Trung bình", career: { ...full.competency!.career!, fitScore: 51, fitLabel: "Ít phù hợp" } },
    });
    expect(html).toContain('<span class="ov-chip meaning-warn">Ít phù hợp</span>');
    expect(html.match(/<span class="ov-chip meaning-warn">Trung bình<\/span>/g)).toHaveLength(2);
    expect(html).not.toMatch(/ov-chip-ok">(Ít phù hợp|Trung bình|Phù hợp)/);
    expect(html).toContain('<span class="ov-chip meaning-warn">Còn 4 điều kiện</span>');
    expect(html).toContain('<span class="ov-chip meaning-warn">Dưới ngưỡng · thiếu 4 điểm</span>');
    expect(html).toContain('<span class="ov-chip meaning-none">Cần tự học</span>');
    expect(dashboard(full)).toContain('<span class="ov-chip meaning-good">Phù hợp</span>');
  });

  it("shows the score of each strength with its courses, rounded down to the tenth like the competency pages", () => {
    const plain = text(dashboard({ ...full, competency: { ...full.competency!, overallScore: 59.86 } }));
    expect(plain).toContain("Năng lực chung 59,8 / 100");
    expect(plain).toContain("Phát triển web 85,7 Minh chứng: Lập trình ứng dụng Web (B+), Thiết kế web (A) và 1 môn khác");
    expect(plain).toContain("Cơ sở dữ liệu 85,5 Minh chứng: Cơ sở dữ liệu (A)");
    expect(plain).not.toContain("Lập trình cơ bản 71,3 Minh chứng");
  });

  it("checks the AI roadmap's credits against the limit when the plan has no such term yet", () => {
    const roadmap = full.roadmap!;
    const heavy = { ...roadmap, plan: null, limits: { min: 9, max: 5 } };
    expect(text(dashboard({ ...full, roadmap: heavy }))).toContain("Lộ trình đề xuất 6 TC, vượt mức tối đa 5 TC mỗi học kỳ.");
    expect(text(dashboard({ ...full, roadmap: { ...roadmap, plan: null } }))).toContain("Bạn chưa xếp các môn này vào Kế hoạch học kỳ.");
    expect(text(dashboard({ ...full, roadmap: { ...roadmap, plan: { credits: 0, status: "empty" } } }))).toContain("Bạn chưa xếp các môn này vào Kế hoạch học kỳ.");
  });

  it("says what is missing when the student has no results yet", () => {
    const plain = text(dashboard(empty));
    for (const message of ["Chưa có bảng điểm nên chưa tính được tiến độ.", "Cần bảng điểm và chuyên ngành để đối chiếu với tiêu chuẩn xét tốt nghiệp.",
      "Bạn chưa có kết quả Đánh giá năng lực.", "Chưa có bảng điểm nên chưa vẽ được điểm theo học kỳ.", "Import bảng điểm để xem các môn bạn đang học.",
      "Lộ trình AI cần kết quả Đánh giá năng lực và Khảo sát định hướng.", "Chưa đủ dữ liệu", "Chưa tính được tiến độ: bạn cần import bảng điểm PDF."]) expect(plain).toContain(message);
    expect(plain).toContain("GPA tích lũy — Cần bảng điểm");
    expect(plain).not.toContain("NaN");
  });

  it("explains a blocked progress", () => {
    const blocked = { ...full, progress: { ...full.progress!, blocked: "specialty_required" } };
    expect(text(dashboard(blocked))).toContain("Bạn cần chọn chuyên ngành để EduPath AI biết các môn của bạn trong kế hoạch đào tạo.");
  });
});

describe("Tổng quan page", () => {
  const render = (profile: StudentProfile | null, loading: boolean) =>
    renderToStaticMarkup(createElement(StudentOverview, { profile, loading, navigate: () => {}, identity: null }));

  it("shows the loading state and keeps the required-profile notice", () => {
    const html = render({ ...student, hasTranscript: false, surveyComplete: false, surveyUpdatedAt: null }, false);
    expect(html).toContain("Đang tải trang Tổng quan…");
    expect(html).toContain("Hoàn thành Hồ sơ và bảng điểm để EduPath AI hỗ trợ bạn");
    expect(html).toContain('<span class="so-gate-count" aria-hidden="true">2/4</span>');
    // Without the profile yet, no definite answer.
    expect(render(null, true)).not.toContain("so-gate");
  });
});
