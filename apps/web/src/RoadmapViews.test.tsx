import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RoadmapPlanner } from "./RoadmapPlanner";
import { RoadmapTrack } from "./RoadmapProgress";
import StudentAiRoadmap from "./StudentAiRoadmap";
import { tabFromHash, tabHash } from "./StudentRoadmap";
import type { RoadmapResponse } from "./student-roadmap-data";
import { planProposal, type StudyPlanContext, type StudyPlanCourse, type StudyPlanData } from "./study-plan-data";

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

  it("shows a cố vấn học tập the plan with nothing to move, add or hide", () => {
    const html = planner({ schemaVersion: 1, aiAdded: { completedAt: "2026-10-24T10:00:00.000Z", term: "HK262", codes: ["C"], addedAt: "2026-10-24T10:05:00.000Z" },
      terms: [{ code: "HK261", courses: [] }, { code: "HK262", courses: [{ code: "C" }] }] }, true);
    expect(html).toContain("Bạn chỉ xem; sinh viên tự sắp xếp và điều chỉnh kế hoạch này.");
    expect(html).toContain("Môn C");
    for (const control of ["Danh sách chờ", "Thêm học kỳ", "+ Thêm vào học kỳ này", "Bỏ khỏi kế hoạch", "Ẩn thông báo", "draggable"]) {
      expect(html).not.toContain(control);
    }
    expect(html).toContain("rm-planner-readonly");
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
