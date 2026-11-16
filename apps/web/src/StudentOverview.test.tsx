import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StudentOverview, {
  OverviewDashboard, creditText, defaultTermCode, emphasize, evidenceText, formatDecimal, gpaChangeText, gpaScale, pageOfLink, paceText, planLoadText,
  progressParts, reasonTone, roadmapOutdated, termChip, termFacts, termGroups, type StudentProfile,
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
    blocked: null, totalCredits: 126, passedCredits: 79, runningCredits: 6, lateCredits: 6, restCredits: 35, remainingCredits: 41, termsLeft: 2, creditsPerTerm: 21, planMaxPerTerm: 16,
    terms: [
      { term: term("HK231"), state: "done", passedCredits: 15, plannedCredits: 15, lateCredits: 0, runningCredits: 0, courses: [course("71ITBS10103", "Nhập môn Công nghệ thông tin", "passed", "A")] },
      { term: term("HK241"), state: "late", passedCredits: 12, plannedCredits: 15, lateCredits: 3, runningCredits: 0, courses: [course("71ITSE30603", "Phát triển ứng dụng di động", "failed", "cần học lại"), course("71ITSE30503", "Lập trình ứng dụng Web", "passed", "B+")] },
      { term: term("HK261"), state: "running", passedCredits: 0, plannedCredits: 9, lateCredits: 0, runningCredits: 6, courses: [course("71ITSE41203", "Kiểm thử phần mềm", "running", "đang học")] },
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
      { main: "15 TC", sub: "đủ" }, { main: "15 TC", sub: "còn nợ 3 TC" }, { main: "6 TC", sub: "đang học" }, { main: "20 TC", sub: "dự kiến" },
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

  it("say a saved term's credits only, as the planner does (user 2026-11-10), and name the courses a score comes from", () => {
    expect([planLoadText({ credits: 20 }), planLoadText({ credits: 6 }), planLoadText({ credits: 15 })]).toEqual(["20 TC", "6 TC", "15 TC"]);
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

  it("shows the six key figures, the cards in the approved order and Cảnh báo chậm tiến độ last, without a notifications block", () => {
    const html = dashboard(full);
    const plain = text(html);
    for (const figure of ["GPA tích lũy 2,85 / 4 Khá +0,03 so với học kỳ trước", "Tín chỉ đã đạt 79 / 126 63% chương trình · 6 TC đang học", "Năng lực chung 68,4 / 100 Khá",
      "Mức phù hợp với vị trí nghề nghiệp 74,6 / 100 Phù hợp 4/6 kỹ năng đạt ngưỡng", "Xét tốt nghiệp Chưa đủ Còn 4 điều kiện", "Lộ trình AI Đã có"]) expect(plain).toContain(figure);
    const order = ["Tiến độ học tập", "Học kỳ này", "Học kỳ tới · theo Lộ trình AI", "Xét tốt nghiệp", "Năng lực và vị trí nghề nghiệp mục tiêu", "Điểm trung bình theo học kỳ", "Hỏi nhanh Trợ lý AI", "Cảnh báo chậm tiến độ"]
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
    expect(text(html)).toContain("Còn lại 35 TC");
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

  it("keeps the chart's end labels 16px apart and above the term labels, even when the three averages meet at the bottom", () => {
    const series = full.transcript!.series.map((point, i, all) => i === all.length - 1 ? { ...point, termGpa4: 1.5, studyGpa4: 1.51, cumulativeGpa4: 1.52 } : point);
    const html = dashboard({ ...full, transcript: { ...full.transcript!, series } });
    const ends = [...html.matchAll(/<text x="[\d.]+" y="([\d.]+)" class="ov-end-label/g)].map((match) => Number(match[1]));
    expect(ends).toHaveLength(3);
    for (let i = 1; i < ends.length; i++) expect(ends[i]! - ends[i - 1]!).toBeGreaterThanOrEqual(16);
    // 1,50 is the bottom of the scale: the plot ends at 186 (230 high, 44 below it for the term and year labels), and a
    // label's baseline sits 4px under its line.
    expect(Math.max(...ends)).toBeLessThanOrEqual(186 + 4);
  });

  it("lists this term's courses, the AI roadmap's choices and the warnings with their actions", () => {
    const plain = text(dashboard(full));
    expect(plain).toContain("Kỹ thuật lập trình đang học lại · 3 TC Rèn luyện: Lập trình cơ bản");
    expect(plain).toContain("Phát triển ứng dụng di động · 3 TC Học lại");
    expect(plain).toContain("Tháng 12/2026: Ôn lại Java");
    expect(plain).toContain("Kế hoạch học kỳ của bạn 20 TC Mở Lộ trình AI đề xuất");
    for (const gone of ["vượt mức", "dưới mức", "Mức cho phép"]) expect(plain).not.toContain(gone);
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

  it("asks to place the AI roadmap's courses when the plan has no such term yet, without any limit (user 2026-11-10)", () => {
    const roadmap = full.roadmap!;
    const heavy = { ...roadmap, plan: null, limits: { min: 9, max: 5 } };
    const plain = text(dashboard({ ...full, roadmap: heavy }));
    expect(plain).toContain("Bạn chưa xếp các môn này vào Kế hoạch học kỳ.");
    expect(plain).not.toContain("vượt mức");
    expect(text(dashboard({ ...full, roadmap: { ...roadmap, plan: null } }))).toContain("Bạn chưa xếp các môn này vào Kế hoạch học kỳ.");
    expect(text(dashboard({ ...full, roadmap: { ...roadmap, plan: { credits: 0, status: "empty" } } }))).toContain("Bạn chưa xếp các môn này vào Kế hoạch học kỳ.");
  });

  it("says what is missing when the student has no results yet", () => {
    const plain = text(dashboard(empty));
    for (const message of ["Chưa có bảng điểm nên chưa tính được tiến độ.", "Cần bảng điểm và chuyên ngành để đối chiếu với tiêu chuẩn xét tốt nghiệp.",
      "Bạn chưa có kết quả Đánh giá năng lực.", "Chưa có bảng điểm nên chưa vẽ được điểm theo học kỳ.", "Import bảng điểm để xem các môn bạn đang học.",
      "Lộ trình AI cần kết quả Đánh giá năng lực.", "Chưa đủ dữ liệu", "Chưa tính được tiến độ: bạn cần import bảng điểm PDF."]) expect(plain).toContain(message);
    // The AI roadmap no longer needs the survey (plan "Một bước để bắt đầu", 2026-11-14).
    expect(plain).not.toContain("Làm khảo sát");
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

  it("starts a student without a transcript with one card, the specialty and the PDF, and no required-profile gate (2026-11-14)", () => {
    const html = render({ ...student, specialty: null, careerPositionId: null, hasTranscript: false, surveyComplete: false, surveyUpdatedAt: null }, false);
    expect(html).toContain("Đang tải trang Tổng quan…");
    expect(html).toContain('<h2 id="so-start-title">Chọn chuyên ngành và import bảng điểm</h2>');
    expect(html).toContain("Xong bước này bạn dùng được ngay:");
    for (const page of ["Xét tốt nghiệp", "Đánh giá năng lực", "Định hướng nghề nghiệp", "Lộ trình học tập", "Trợ lý AI"]) expect(html).toContain(`<li>${page}</li>`);
    // Nothing chosen yet: the student picks a specialty, then the PDF (K29: no "Chưa có chuyên ngành", user 2026-11-16).
    expect(html).toMatch(/<option value=""[^>]*>Chọn chuyên ngành…<\/option><option value="CNPM">Công nghệ phần mềm<\/option>/);
    expect(html).not.toContain("Chưa có chuyên ngành");
    expect(html).toContain("Chọn tệp PDF bảng điểm");
    for (const absent of ["so-gate", "BẮT BUỘC TRƯỚC KHI SỬ DỤNG", "Hoàn thành hồ sơ", "Vị trí nghề nghiệp mục tiêu", "Khảo sát"]) expect(html).not.toContain(absent);
    // Without the profile yet, no definite answer.
    expect(render(null, true)).not.toContain("so-start");
  });

  it("asks the specialty of a transcript imported without one, and nothing of a student who has both", () => {
    const html = render({ ...student, specialty: null, hasTranscript: true }, false);
    expect(html).toContain('<h2 id="so-specialty-title">Chọn chuyên ngành của bạn</h2>');
    expect(html).toContain('<button type="submit" class="sw-primary" disabled="">Lưu chuyên ngành</button>');
    expect(html).not.toContain("Chưa có chuyên ngành");
    expect(html).not.toContain("so-start-title");
    expect(render({ ...student, hasTranscript: true }, false)).not.toContain("so-start");
    // A major whose cohort has no specialty to choose: nothing to ask.
    expect(render({ ...student, specialty: null, hasTranscript: true, majorCode: "7340201" }, false)).not.toContain("so-specialty");
  });
});

describe("Tổng quan progress after the review of 2026-11-04 (comp-calc-v19)", () => {
  // The reviewed student, synthetic: 126 TC; 109 passed, 5 being studied (2 courses), 12 late (AV5, AV6, AV7 and Nhập môn xử lý
  // ảnh số), the thesis group of the term being studied not registered (its plan, not late), GDTC 2 a condition (no credits).
  const reviewed: OverviewResponse = {
    ...full,
    terms: { ...full.terms, studying: term("HK261") },
    progress: {
      blocked: null, totalCredits: 126, passedCredits: 109, runningCredits: 5, lateCredits: 12, restCredits: 0, remainingCredits: 12,
      termsLeft: 0, creditsPerTerm: null, planMaxPerTerm: null,
      terms: [
        { term: term("HK242"), state: "done", passedCredits: 14, plannedCredits: 17, lateCredits: 0, runningCredits: 0, courses: [course("71ITSE30503", "Lập trình ứng dụng Web", "passed", "B+")] },
        { term: term("HK243"), state: "late", passedCredits: 8, plannedCredits: 11, lateCredits: 3, runningCredits: 0, courses: [course("71ITAI40803", "Nhập môn xử lý ảnh số", "late", "chưa học, trễ so với kế hoạch")] },
        { term: term("HK261"), state: "running", passedCredits: 0, plannedCredits: 6, lateCredits: 0, runningCredits: 5, courses: [
          { code: "", name: "Nhóm tự chọn TC406: chọn 6 tín chỉ", credits: 6, state: "planned", detail: "chưa đăng ký" },
          course("71ENG710053", "Anh văn 8", "running", "đang học", 2), course("71ITSE41203", "Kiểm thử phần mềm", "running", "đang học"),
        ] },
      ],
    },
    running: [
      { code: "71ENG710053", name: "Anh văn 8", credits: 2, retake: false, conditionOnly: false, skills: [] },
      { code: "71ITSE41203", name: "Kiểm thử phần mềm", credits: 3, retake: false, conditionOnly: false, skills: [] },
    ],
  };
  const widths = (html: string) => [...html.matchAll(/class="ov-bar-[a-z]+" style="width:([\d.]+)%"/g)].map((match) => Number(match[1]));

  it("adds the bar up to the programme: 109 + 5 + 12 + 0 = 126, the boxes and the legend saying the same numbers", () => {
    const html = dashboard(reviewed);
    const plain = text(html);
    for (const box of ["Đã đạt 109 TC", "Đang học 5 TC", "Trễ kế hoạch 12 TC", "Còn lại 0 TC"]) expect(plain).toContain(box);
    expect(plain).toContain("Đã đạt 109 TC Đang học 5 TC Trễ kế hoạch 12 TC Còn lại 0 TC");
    expect(plain).not.toContain("Còn lại sau kỳ này");
    // The bar never runs past the programme: 109 + 5 + 12 of 126.
    const bar = widths(html);
    expect(bar).toHaveLength(3);
    expect(bar.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 6);
    // No plan term left: said plainly, never "0 kỳ · ~12 TC/kỳ".
    expect(plain).toContain("Kế hoạch đào tạo không còn học kỳ nào sau học kỳ này, nhưng bạn còn 12 TC cần học.");
    expect(plain).not.toMatch(/0 kỳ|TC\/kỳ/);
  });

  it("says the term being studied with what is registered in it, the figure of Học kỳ này, and the plan's own figure", () => {
    const plain = text(dashboard(reviewed));
    expect(plain).toContain("2 môn · 5 TC");
    expect(termChip(reviewed.progress!.terms[2]!)).toEqual({ main: "5 TC", sub: "đang học" });
    // The plan's term figures, as Kế hoạch đào tạo prints them; a late term says what it still owes.
    expect(reviewed.progress!.terms.map(termChip)).toEqual([{ main: "17 TC", sub: "đủ" }, { main: "11 TC", sub: "còn nợ 3 TC" }, { main: "5 TC", sub: "đang học" }]);
    expect(reviewed.progress!.terms.map(termFacts)).toEqual([
      "Kế hoạch đào tạo: 17 TC", "Kế hoạch đào tạo: 11 TC · còn nợ 3 TC", "Kế hoạch đào tạo: 6 TC · đang học 5 TC",
    ]);
    // A late term whose only course left is being studied again owes nothing; an older API without the figure says "còn nợ".
    expect(termChip({ ...reviewed.progress!.terms[1]!, lateCredits: 0 })).toEqual({ main: "11 TC", sub: "đang học bù" });
    const { lateCredits: _owed, runningCredits: _running, ...older } = reviewed.progress!.terms[1]!;
    expect(termChip(older)).toEqual({ main: "11 TC", sub: "còn nợ" });
    // Between two terms nothing is registered: the term being studied shows its plan, never "0 TC đang học".
    expect(termChip({ ...reviewed.progress!.terms[2]!, runningCredits: 0 })).toEqual({ main: "6 TC", sub: "học kỳ này" });
    expect(termFacts({ ...reviewed.progress!.terms[2]!, runningCredits: 0 })).toBe("Kế hoạch đào tạo: 6 TC");
  });

  it("lists a GDTC/GDQP course being studied as a condition, out of the credits", () => {
    const withCondition = { ...reviewed, running: [...reviewed.running, { code: "71NAD110013", name: "GDQP1", credits: 3, retake: false, conditionOnly: true, skills: [] }] };
    const plain = text(dashboard(withCondition));
    expect(plain).toContain("3 môn · 5 TC");
    expect(plain).toContain("GDQP1 đang học · môn điều kiện");
  });

  it("keeps the four parts adding up with an older API and says the pace in plain words", () => {
    const progress = reviewed.progress!;
    expect(progressParts(progress)).toEqual({ passed: 109, running: 5, late: 12, rest: 0 });
    // An older API: no rest, and late above what is left (it drew 134 of 126): late is cut to what is left.
    const { restCredits: _rest, ...older } = progress;
    expect(progressParts({ ...older, lateCredits: 20 })).toEqual({ passed: 109, running: 5, late: 12, rest: 0 });
    expect(progressParts({ ...older, totalCredits: null, remainingCredits: null })).toEqual({ passed: 109, running: 5, late: 12, rest: null });
    expect(paceText({ ...progress, remainingCredits: 38, termsLeft: 2, creditsPerTerm: 19 })).toBe("Sau học kỳ này còn 38 TC cho 2 học kỳ của kế hoạch, khoảng 19 TC mỗi kỳ.");
    expect(paceText({ ...progress, remainingCredits: 0 })).toBe("Đạt các môn đang học là bạn đủ số tín chỉ của chương trình.");
    expect(paceText({ ...progress, remainingCredits: null })).toBeNull();
    expect(creditText(1.55)).toBe("1,5");
  });

  it("keeps the previous roadmap, dimmed, while a new one is written or failed (2026-11-07)", () => {
    const { createdAt, term, courses, skills, firstMonth } = full.roadmap!;
    const pending = { ...full, roadmap: { ...full.roadmap!, status: "pending" as const, courses: [], skills: [], firstMonth: null,
      previous: { createdAt, term, courses, skills, firstMonth } } };
    const html = dashboard(pending);
    expect(html).toContain('<div class="ov-previous"><p class="ov-previous-note">Lộ trình trước, viết cho dữ liệu cũ — có thể không còn đúng. Lộ trình mới sẽ thay thế khi sẵn sàng.</p>');
    expect(text(html)).toContain("EduPath AI đang soạn lộ trình cho học kỳ tới, bạn quay lại sau khoảng 1–2 phút nhé.");
    expect(text(html)).toContain(`${courses[0]!.name} · ${courses[0]!.credits} TC`);
    // Without an earlier roadmap the card says only what is happening.
    const alone = dashboard({ ...full, roadmap: { ...pending.roadmap, previous: null } });
    expect(alone).not.toContain("ov-previous");
    expect(text(alone)).toContain("EduPath AI đang soạn lộ trình cho học kỳ tới");
  });

  it("says above the previous roadmap that the newest one failed, when, why and where to try again (QA 2026-11-10)", () => {
    const { term, courses, skills, firstMonth } = full.roadmap!;
    const failed = { ...full, roadmap: { ...full.roadmap!, status: "failed" as const, errorCode: "ai_output_truncated", createdAt: "2026-11-08T14:40:00.000Z",
      courses: [], skills: [], firstMonth: null, previous: { createdAt: "2026-11-01T03:00:00.000Z", term, courses, skills, firstMonth } } };
    const html = dashboard(failed);
    expect(text(html)).toContain("Lần tạo Lộ trình AI mới lúc 21:40 08/11/2026 không thành công. Câu trả lời của AI bị cắt giữa chừng nên chưa dùng được. "
      + "Lộ trình bên dưới là bản trước. Bạn mở Lộ trình AI đề xuất và bấm “Thử lại” để thử lần nữa.");
    // The line is not dimmed; the note over the dimmed roadmap no longer promises a new one.
    expect(html.indexOf("Lần tạo Lộ trình AI mới")).toBeLessThan(html.indexOf('class="ov-previous"'));
    expect(html).toContain('<p class="ov-previous-note">Lộ trình trước, viết cho dữ liệu cũ — có thể không còn đúng.</p>');
    expect(html).not.toContain("ai_output_truncated");
    // A stopped one (no error code), or an older API without it, still says when.
    const older = dashboard({ ...failed, roadmap: { ...failed.roadmap, errorCode: undefined } });
    expect(text(older)).toContain("Lần tạo Lộ trình AI mới lúc 21:40 08/11/2026 không thành công. Lộ trình bên dưới là bản trước.");
  });

  it("says on the card that the roadmap is out of date, by the Lộ trình AI tab's rules", () => {
    const stale = { ...full, roadmap: { ...full.roadmap!, stale: true, ended: false } };
    const plain = text(dashboard(stale));
    expect(plain).toContain("Lộ trình AI Cần tạo lại");
    expect(plain).toContain("Soạn trước lần đánh giá mới nhất");
    expect(plain).toContain("Kết quả Đánh giá năng lực của bạn đã thay đổi sau khi lộ trình này được soạn. Bấm Tạo lại ở Lộ trình học tập để cập nhật theo kết quả mới.");
    expect(text(dashboard({ ...full, roadmap: { ...full.roadmap!, stale: false, ended: true } }))).toContain("Lộ trình này đã hết thời gian.");
    expect(text(dashboard(full))).toContain("Lộ trình AI Đã có");
    expect(roadmapOutdated({ ...full.roadmap!, status: "pending", stale: true })).toBeNull();
    expect(roadmapOutdated(null)).toBeNull();
  });
});
