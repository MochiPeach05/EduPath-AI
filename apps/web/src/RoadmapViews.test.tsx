import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RoadmapPlanner } from "./RoadmapPlanner";
import { RoadmapTrack } from "./RoadmapProgress";
import StudentAiRoadmap from "./StudentAiRoadmap";
import { tabFromHash, tabHash } from "./StudentRoadmap";
import type { Roadmap, RoadmapResponse } from "./student-roadmap-data";
import { planProposal, type PlanProposal, type StudyPlanContext, type StudyPlanCourse, type StudyPlanData } from "./study-plan-data";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

// Synthetic courses only (no student data).
const course = (code: string, extra: Partial<StudyPlanCourse> = {}): StudyPlanCourse => ({
  code, name: `Môn ${code}`, credits: 3, type: "BB", kind: "mandatory", group: null, conditional: false, applicable: true, specialtyName: null,
  standardTerm: null, prerequisites: [], prior: [], state: "not_taken", inProgressTerm: null, planTerm: null, offeredTerms: [],
  grade: null, takenTerm: null, attempts: 0, equivalent: null, ...extra,
});
const context: StudyPlanContext = {
  cohortCode: "K29", specialty: "CNPM", specialtyLabel: "Công nghệ phần mềm", curriculum: { name: "CTĐT K29", totalCredits: 30 }, hasTranscript: true,
  currentTerm: "HK261", studyTerm: "HK261", admissionYear: 2023, standardTerms: ["HK261", "HK262"], limits: { average: 5, min: 4, max: 7 },
  offeringUntil: "HK262", electiveGroups: [], unmatched: [], gpa: { actual: 2.8, required: 2, scale: 4 },
  courses: [
    course("A", { state: "passed", grade: "A", takenTerm: "HK251" }),
    course("THESIS", { name: "Đồ án Tốt nghiệp", credits: 6, kind: "elective", group: "TC306", state: "in_progress", inProgressTerm: "HK261" }),
    course("C"), course("D"), course("PE", { name: "Bóng bàn", credits: 2, conditional: true, kind: "elective", group: "TC102" }),
  ],
  graduation: {
    standardName: "Tiêu chuẩn K29", credits: { completed: 3, required: 30, source: "printed" },
    groups: [
      { label: "Học phần bắt buộc", kind: "mandatory", unit: "môn", required: 3, passed: 1, status: "fail", courseCodes: ["A", "C", "D"] },
      { label: "Nhóm tự chọn TC306", kind: "elective", unit: "TC", required: 6, passed: 0, status: "unknown", courseCodes: ["THESIS"] },
    ],
  },
};
const empty: StudyPlanData = { schemaVersion: 1, terms: [{ code: "HK261", courses: [] }, { code: "HK262", courses: [] }] };

describe("Theo dõi tiến độ", () => {
  it("keeps red for Chưa đạt only: a course not due yet is grey, an overdue one amber, Không được tính a grey i", () => {
    const colours: StudyPlanContext = { ...context,
      courses: [...context.courses.map((item) => item.code === "C" ? { ...item, planTerm: "HK252" } : item.code === "D" ? { ...item, planTerm: "HK262" } : item),
        course("F1", { state: "failed", grade: "F", takenTerm: "HK251", planTerm: "HK251" })],
      graduation: { ...context.graduation!, groups: [{ ...context.graduation!.groups[0]!, required: 4, courseCodes: ["A", "C", "D", "F1"] }, context.graduation!.groups[1]!] },
      unmatched: [{ code: "AV0", name: "Anh văn đầu vào", credits: 0, state: "passed", grade: "Đạt", term: "HK231" }],
    };
    const html = renderToStaticMarkup(createElement(RoadmapTrack, { context: colours, plan: empty, projection: null }));
    expect(html).toMatch(/rm-req-row rm-row-needed rm-needed-overdue">.*?Trễ kế hoạch đào tạo \(dự kiến HK2 2025–2026\)/);
    expect(html).toMatch(/rm-req-row rm-row-needed rm-needed-upcoming">.*?Chưa học · dự kiến HK2 2026–2027/);
    expect(html).toMatch(/rm-req-row rm-row-needed rm-needed-failed">.*?Chưa đạt \(F\)/);
    expect(html).toContain('class="rm-mark rm-mark-needed rm-tone-failed" role="img" aria-label="Chưa đạt"');
    expect(html).toContain('class="rm-mark rm-mark-not-counted" role="img" aria-label="Không được tính" title="Không được tính">i</span>');
    expect(html).toContain("Đây không phải lỗi");
    expect(html).toContain("<dd>HK1 2026–2027 · 1 học phần</dd>");
  });

  it("shows a group whose only course is being studied as ✓✓ Đang học, never Đã hoàn thành, and what the AI just added", () => {
    const plan: StudyPlanData = { ...empty, aiAdded: { completedAt: "2026-10-24T10:00:00.000Z", term: "HK262", codes: ["C"], addedAt: "2026-10-24T10:05:00.000Z" },
      terms: [{ code: "HK261", courses: [] }, { code: "HK262", courses: [{ code: "C" }] }] };
    const html = renderToStaticMarkup(createElement(RoadmapTrack, { context, plan, projection: null, origin: { kind: "ai", added: 1 }, onOpenPlanner: () => {} }));
    expect(html).toContain('class="rm-req rm-req-running"');
    expect(html).toContain("Đã đạt 0/6 TC · phần còn lại đang học");
    expect(html).not.toContain("Đã đủ 6 TC");
    expect(html).toContain("Kế hoạch học kỳ vừa được thêm 1 học phần do lộ trình AI đề xuất: Môn C (C).");
    expect(html).toContain("Mở Kế hoạch học kỳ");
  });

  it("names a proposal the student has not applied yet and counts only the plan as saved (user 2026-11-04)", () => {
    const proposal = planProposal(context, empty, { roadmapId: "99999999-9999-4999-8999-999999999999", completedAt: "2026-10-24T10:00:00.000Z",
      term: "HK262", courses: [{ code: "C", term: "HK262" }] });
    const html = renderToStaticMarkup(createElement(RoadmapTrack, { context, plan: empty, projection: null, proposal, onOpenPlanner: () => {} }));
    expect(html).toContain("Có đề xuất cho Kế hoạch học kỳ: thêm 1 học phần do lộ trình AI đề xuất. Kế hoạch chưa thay đổi; mở Kế hoạch học kỳ để xem và chọn Áp dụng hoặc Bỏ qua.");
    expect(html).toContain("Mở Kế hoạch học kỳ");
    expect(html).not.toContain("vừa được thêm");
    // Theo kế hoạch counts nothing planned: the proposal is not in the plan.
    expect(renderToStaticMarkup(createElement(RoadmapTrack, { context, plan: empty, projection: null }))).not.toContain("Có đề xuất cho Kế hoạch học kỳ");
  });
});

describe("addresses of the tabs", () => {
  it("opens the tab an address names and writes each tab's address", () => {
    expect([tabFromHash("#roadmap/tien-do"), tabFromHash("#roadmap/lo-trinh-ai"), tabFromHash("#roadmap/ke-hoach-hoc-ky")]).toEqual(["track", "ai", "manual"]);
    // A bare address (the header's link) or an unknown tab names none: the page opens the tab used last.
    expect([tabFromHash("#roadmap"), tabFromHash("#roadmap/khac"), tabFromHash("#plans")]).toEqual([null, null, null]);
    expect([tabHash("track"), tabHash("ai"), tabHash("manual")]).toEqual(["#roadmap/tien-do", "#roadmap/lo-trinh-ai", "#roadmap/ke-hoach-hoc-ky"]);
  });
});

describe("Kế hoạch học kỳ", () => {
  const planner = (plan: StudyPlanData, readOnly = false) => renderToStaticMarkup(createElement(RoadmapPlanner, {
    context, plan, onChange: () => {}, saveState: "idle", saveError: "", origin: null, onOpenAi: () => {}, readOnly,
  }));

  it("names the class of another cohort a planned course is studied in, once per card (user 2026-11-08)", () => {
    const retake = course("R", { name: "Môn học lại", state: "failed", grade: "F", offeredTerms: ["HK262"],
      classes: [{ term: "HK262", cohort: "K30", major: null, source: "plan" }, { term: "HK263", cohort: "K32", major: null, source: "curriculum" }] });
    const html = renderToStaticMarkup(createElement(RoadmapPlanner, {
      context: { ...context, courses: [...context.courses, retake] }, plan: { schemaVersion: 1, terms: [{ code: "HK261", courses: [] }, { code: "HK262", courses: [{ code: "R" }] }] },
      onChange: () => {}, saveState: "idle", saveError: "", origin: null, onOpenAi: () => {},
    }));
    expect(html).toContain('<small class="rm-class">Học cùng lớp khóa K30 (theo kế hoạch đào tạo)</small>');
    expect(html.match(/lớp khóa K30/g)).toHaveLength(1);
    expect(html).toContain("Kỳ sau (HK2 2026–2027): có mở · thường mở HK2");
  });

  it("shows a cố vấn học tập the plan with nothing to move, add or hide until Sửa kế hoạch (user 2026-11-10)", () => {
    const html = planner({ schemaVersion: 1, aiAdded: { completedAt: "2026-10-24T10:00:00.000Z", term: "HK262", codes: ["C"], addedAt: "2026-10-24T10:05:00.000Z" },
      terms: [{ code: "HK261", courses: [] }, { code: "HK262", courses: [{ code: "C" }] }] }, true);
    expect(html).toContain("<p>Kế hoạch các học kỳ tới của sinh viên.</p>");
    expect(html).not.toContain("Bạn chỉ xem");
    expect(html).not.toContain("Sửa kế hoạch");
    expect(html).toContain("Môn C");
    for (const control of ["Danh sách chờ", "Thêm học kỳ", "+ Thêm vào học kỳ này", "Bỏ khỏi kế hoạch", "Ẩn thông báo", "draggable"]) {
      expect(html).not.toContain(control);
    }
    expect(html).toContain("rm-planner-readonly");
    const editable = renderToStaticMarkup(createElement(RoadmapPlanner, {
      context, plan: { schemaVersion: 1, terms: [{ code: "HK262", courses: [{ code: "C" }] }] }, onChange: () => {}, saveState: "idle", saveError: "",
      origin: null, onOpenAi: () => {}, readOnly: true, onEdit: () => {},
    }));
    expect(editable).toContain("Bấm Sửa kế hoạch để sắp xếp, điều chỉnh kế hoạch thay sinh viên.");
    expect(editable).toMatch(/<button type="button" class="sw-outline"><svg[^>]*>.*?<\/svg>Sửa kế hoạch<\/button>/);
    expect(editable).not.toContain("draggable");
  });

  it("promises no prefill when nothing is planned, even with a course being studied", () => {
    const html = planner(empty);
    expect(html).not.toContain("Kế hoạch được điền sẵn");
    expect(html).toContain("Xếp các học phần còn thiếu vào từng học kỳ");
    expect(html).toContain("Kế hoạch chưa có học phần nào.");
  });

  it("names the courses the AI added and says the credit limits in words, môn điều kiện visible", () => {
    const html = planner({ schemaVersion: 1, aiAdded: { completedAt: "2026-10-24T10:00:00.000Z", term: "HK262", codes: ["C", "D"], addedAt: "2026-10-24T10:05:00.000Z" },
      terms: [{ code: "HK261", courses: [] }, { code: "HK262", courses: [{ code: "C" }, { code: "D" }, { code: "PE" }] }] });
    expect(html).toContain("Đã thêm 2 học phần do lộ trình AI đề xuất (lộ trình soạn lúc 17:00 24/10/2026): Môn C (C) và Môn D (D).");
    expect(html).toContain("Ẩn thông báo");
    expect(html).toContain("8 TC · vượt mức tối đa 7 TC");
    // A planner check is a warning (amber !), not a failure.
    expect(html).not.toContain("rm-mark-not-counted");
    expect(html).toContain("gồm 2 TC môn điều kiện");
    expect(html).toContain("Bạn điều chỉnh kế hoạch bằng cách kéo học phần");
    expect(html).not.toContain("Kế hoạch chưa có học phần nào.");
  });

  it("says the credit limits and that a summer term needs no minimum (QA 2026-11-04)", () => {
    const html = planner({ schemaVersion: 1, terms: [{ code: "HK261", courses: [] }, { code: "HK262", courses: [{ code: "C" }, { code: "D" }] },
      { code: "HK263", courses: [{ code: "PE" }] }, { code: "HK271", courses: [{ code: "C2" }] }] });
    expect(html).toContain("Số tín chỉ mỗi học kỳ: tối thiểu 4 TC, tối đa 7 TC, tính cả môn điều kiện. Học kỳ hè (HK3) không yêu cầu số tín chỉ tối thiểu");
    // HK263 holds 2 TC: no warning, and the reason under its credits.
    expect(html).toMatch(/aria-label="HK3 2026–2027".*?2 TC<\/span>.*?Học kỳ hè: không yêu cầu tối thiểu 4 TC/);
    expect(html).not.toContain("dưới mức tối thiểu");
  });

  it("lists the AI's courses it moves after their tiên quyết, from and to (user 2026-11-08)", () => {
    const proposal: PlanProposal = { plan: empty, roadmap: null, added: [], aiRemoved: [], thesisRemoved: [], keepable: ["C"], moved: [{ code: "C", from: "HK262", to: "HK263" }] };
    const html = renderToStaticMarkup(createElement(RoadmapPlanner, {
      context, plan: empty, onChange: () => {}, saveState: "idle", saveError: "", origin: null, onOpenAi: () => {}, proposal, onApply: () => {}, onDecline: () => {},
    }));
    expect(html).toContain("Chuyển 1 học phần do lộ trình AI đề xuất ra sau môn tiên quyết của nó, vì chỉ đăng ký được khi đã đạt môn tiên quyết:");
    expect(html).toContain("<li><strong>Môn C</strong> (C): HK2 2026–2027 → HK3 2026–2027</li>");
  });

  it("proposes the AI roadmap's courses with Áp dụng and Bỏ qua, the plan unchanged, and nothing to apply for a cố vấn", () => {
    const proposal = planProposal(context, empty, { roadmapId: "99999999-9999-4999-8999-999999999999", completedAt: "2026-10-24T10:00:00.000Z",
      term: "HK262", courses: [{ code: "C", term: "HK262" }, { code: "D", term: "HK262" }] });
    const render = (readOnly: boolean) => renderToStaticMarkup(createElement(RoadmapPlanner, {
      context, plan: empty, onChange: () => {}, saveState: "idle", saveError: "", origin: null, onOpenAi: () => {}, readOnly, proposal, onApply: () => {}, onDecline: () => {},
    }));
    const html = render(false);
    expect(html).toContain("Đề xuất thay đổi kế hoạch");
    expect(html).toContain("Kế hoạch của bạn chưa thay đổi. Bấm Áp dụng để cập nhật kế hoạch theo đề xuất dưới đây, hoặc Bỏ qua để giữ nguyên kế hoạch.");
    expect(html).toContain("Thêm 2 học phần do lộ trình AI đề xuất (lộ trình soạn lúc 17:00 24/10/2026), vào học kỳ mà kế hoạch đào tạo mở môn đó:");
    expect(html).toContain("<li><strong>Môn C</strong> (C): HK2 2026–2027</li>");
    expect(html).toMatch(/<button type="button" class="sw-primary">Áp dụng<\/button><button type="button" class="sw-outline">Bỏ qua<\/button>/);
    // The terms still show the plan as it is: nothing planned yet.
    expect(html).toContain("Kế hoạch chưa có học phần nào.");
    expect(html).not.toContain("rm-save-saving");
    const advisor = render(true);
    for (const text of ["Đề xuất thay đổi kế hoạch", "Áp dụng", "Bỏ qua"]) expect(advisor).not.toContain(text);
  });

  it("says a declined proposal will not come back", () => {
    const html = renderToStaticMarkup(createElement(RoadmapPlanner, {
      context, plan: empty, onChange: () => {}, saveState: "saved", saveError: "", origin: null, onOpenAi: () => {}, declined: true,
    }));
    expect(html).toContain("Đã bỏ qua đề xuất: kế hoạch giữ nguyên và đề xuất này sẽ không hiện lại.");
  });
});

describe("Lộ trình AI đề xuất", () => {
  const response = (surveyDone: boolean): RoadmapResponse => ({
    roadmap: {
      id: "r1", assessmentId: "a1", status: "completed", errorCode: null, createdAt: "2026-10-24T03:00:00.000Z", completedAt: "2026-10-24T03:05:00.000Z", model: "gemma4:e4b",
      window: { start: "2026-12-21", end: "2027-04-04", months: [], term: "HK262" }, ended: false, careerName: null, specialtyLabel: null, summary: null, advice: [],
      study: [], choices: [], improve: [], skills: [], months: [],
    },
    previous: null,
    assessment: { id: "a2", createdAt: "2026-10-25T03:00:00.000Z", hasCareer: true }, stale: true, surveyDone, aiEnabled: true,
    worker: { online: false, supportsRoadmap: false }, upcoming: { term: "HK262", start: "2026-12-21", end: "2027-04-04" },
    basis: { recorded: ["Chưa có minh chứng (chưa có điểm từ học phần nào): React", "Học phần thực tập trong chương trình: Đồ án thực tập (chưa học)"],
      selfReported: ["Bạn tự mô tả: Thành thạo React", "Thực tập: Đang thực tập"], surveyChanged: false },
  });
  const page = (surveyDone: boolean) => {
    liveData.mockReturnValue({ data: response(surveyDone), error: null, loading: false });
    return renderToStaticMarkup(createElement(StudentAiRoadmap));
  };

  it("names học lại and học cải thiện apart, under the user's title when both are shown (2026-10-31)", () => {
    const base = response(true);
    const improve = [
      { code: "F1", name: "Cơ sở lập trình", credits: 3, letter: "F", score10: 3.2, action: "retake" as const, advice: "Đăng ký học lại sớm.", careerSkills: [] },
      { code: "D1", name: "Kiểm thử phần mềm", credits: 3, letter: "D+", score10: 5.6, action: "improve" as const, advice: null, careerSkills: [] },
    ];
    liveData.mockReturnValue({ data: { ...base, roadmap: { ...base.roadmap!, improve } }, error: null, loading: false });
    const html = renderToStaticMarkup(createElement(StudentAiRoadmap));
    expect(html).toContain("Môn học bạn cần học lại và cải thiện");
    expect(html).toMatch(/<h3>Học lại<\/h3><p>Học phần chưa đạt \(điểm F, VT hoặc CT\), cần học lại\.<\/p>.*Cơ sở lập trình.*<h3>Học cải thiện<\/h3><p>Học phần đã đạt nhưng điểm D hoặc D\+; học lại nếu bạn muốn nâng điểm\. Đây chỉ là gợi ý: Kế hoạch học kỳ không tự thêm các môn này, bạn tự thêm ở Danh sách chờ nếu muốn\.<\/p>.*Kiểm thử phần mềm/);
    expect(html).not.toContain("Môn bạn cần cải thiện");
  });

  it("names the term of the school calendar the roadmap covers (user, 2026-10-25)", () => {
    const html = page(true);
    expect(html).toContain("Lộ trình HK2 2026–2027");
    expect(html).toContain("Từ 21/12/2026 đến 04/04/2027");
  });

  it("shows what the system has on record apart from what the student says (user 2026-10-30)", () => {
    const html = page(true);
    expect(html).toContain("Lời khuyên dựa trên");
    expect(html).toMatch(/Hệ thống ghi nhận<\/h4>.*Chưa có minh chứng \(chưa có điểm từ học phần nào\): React.*Bạn tự đánh giá<\/h4>.*Thực tập: Đang thực tập/);
  });

  describe("the older roadmap while a new one is written (user 2026-11-05: like Xét tốt nghiệp)", () => {
    const note = "Lộ trình trước, viết cho dữ liệu cũ — có thể không còn đúng. Lộ trình mới sẽ thay thế khi sẵn sàng.";
    const month = (index: number, start: string, end: string, focus: string | null, tasks: string[]) => ({ month: index, start, end, focus, tasks });
    // Synthetic: the newest roadmap (HK262) is not written yet; the older one covered HK261.
    const older: Roadmap = {
      ...response(true).roadmap!, id: "r0", assessmentId: "a0", createdAt: "2026-09-01T03:00:00.000Z", completedAt: "2026-09-01T03:05:00.000Z",
      window: { start: "2026-09-07", end: "2027-01-24", months: [], term: "HK261" },
      summary: "Lộ trình trước: học lại Cơ sở lập trình ngay học kỳ này.", advice: ["Đăng ký học lại sớm."],
      months: [month(1, "2026-09-07", "2026-10-06", "Ổn định lịch học", ["Đăng ký học lại Cơ sở lập trình."]), month(2, "2026-10-07", "2026-11-06", null, [])],
    };
    const newest = (status: Roadmap["status"], errorCode: string | null = null): Roadmap => ({
      ...response(true).roadmap!, id: "r2", assessmentId: "a2", status, errorCode, completedAt: null, model: null, summary: null, advice: [],
      months: [month(1, "2026-12-21", "2027-01-20", null, [])],
    });
    const page = (data: RoadmapResponse) => {
      liveData.mockReturnValue({ data, error: null, loading: false });
      return renderToStaticMarkup(createElement(StudentAiRoadmap));
    };

    it.each([["queued", null], ["processing", null], ["failed", "ai_timeout"], ["cancelled", null]] as const)("keeps its advice and month plan dimmed while the newest is %s", (status, errorCode) => {
      const html = page({ ...response(true), stale: false, roadmap: newest(status, errorCode), previous: older });
      const at = { state: html.indexOf('class="rm-ai-state'), advice: html.indexOf('<div class="rm-previous rm-dimmed"><p class="rm-old">'), study: html.indexOf('id="rm-study"') };
      expect(at.state).toBeGreaterThan(0);
      expect(at.advice).toBeGreaterThan(at.state);
      expect(at.study).toBeGreaterThan(at.advice);
      expect(html).toContain("Lời khuyên của cố vấn AI");
      expect(html).toContain("Lộ trình trước: học lại Cơ sở lập trình ngay học kỳ này.");
      expect(html).toContain("<li>Đăng ký học lại sớm.</li>");
      // Which roadmap and when it was written.
      expect(html).toMatch(/<p class="rm-previous-meta">Lộ trình HK1 2026–2027 · Gemma 4 E4B \(chạy cục bộ\) soạn lúc [^<]*2026\.<\/p>/);
      // Its month plan, dimmed under the same note, after the system's sections.
      const months = html.slice(html.indexOf('id="rm-months"'));
      expect(html.indexOf('id="rm-months"')).toBeGreaterThan(html.indexOf('id="rm-skills"'));
      expect(months).toContain(`<div class="rm-previous rm-dimmed"><p class="rm-old">${note}</p><ol class="rm-months">`);
      expect(months).toContain("Tháng 1 · 07/09 – 06/10/2026");
      expect(months).toContain("Đăng ký học lại Cơ sở lập trình.");
      expect(html.match(new RegExp(note, "g"))).toHaveLength(2);
      // The page's footer stays the one of the current state.
      expect(html).toContain("Các học phần và kỹ năng trên do hệ thống tính từ kết quả Đánh giá năng lực của bạn.");
    });

    it("shows only the month plan of an older roadmap without advice, and nothing once the newest is written", () => {
      const monthsOnly = page({ ...response(true), roadmap: newest("processing"), previous: { ...older, summary: null } });
      expect(monthsOnly).not.toContain("Lời khuyên của cố vấn AI");
      expect(monthsOnly).not.toContain("rm-previous-meta");
      expect(monthsOnly.match(new RegExp(note, "g"))).toHaveLength(1);
      expect(monthsOnly).toContain("Ổn định lịch học");
      const written = page({ ...response(true), roadmap: { ...older, id: "r3" }, previous: older });
      expect(written).not.toContain(note);
      expect(written).not.toContain("rm-dimmed");
      expect(page({ ...response(true), roadmap: newest("processing"), previous: null })).not.toContain(note);
    });
  });

  it("keeps Tạo lại for after Khảo sát định hướng, which a new roadmap needs", () => {
    const waiting = page(false);
    expect(waiting).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="rm-survey-needed"[^>]*>.*Tạo lại<\/button>/);
    expect(waiting).toContain("Hoàn thành Khảo sát định hướng rồi bấm Tạo lại để cập nhật theo kết quả mới.");
    expect(waiting).toContain('id="rm-survey-needed"');
    const ready = page(true);
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Tạo lại<\/button>/);
    expect(ready).toContain("Bấm Tạo lại để cập nhật theo kết quả mới.");
  });
});
