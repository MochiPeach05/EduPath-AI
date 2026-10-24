import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RoadmapPlanner } from "./RoadmapPlanner";
import { RoadmapTrack } from "./RoadmapProgress";
import StudentAiRoadmap from "./StudentAiRoadmap";
import type { RoadmapResponse } from "./student-roadmap-data";
import type { StudyPlanContext, StudyPlanCourse, StudyPlanData } from "./study-plan-data";

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
});

describe("Kế hoạch học kỳ", () => {
  const planner = (plan: StudyPlanData) => renderToStaticMarkup(createElement(RoadmapPlanner, {
    context, plan, onChange: () => {}, saveState: "idle", saveError: "", origin: null, onOpenAi: () => {},
  }));

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
    expect(html).toContain("gồm 2 TC môn điều kiện");
    expect(html).toContain("Bạn điều chỉnh kế hoạch bằng cách kéo học phần");
    expect(html).not.toContain("Kế hoạch chưa có học phần nào.");
  });
});

describe("Lộ trình AI đề xuất", () => {
  const response = (surveyDone: boolean): RoadmapResponse => ({
    roadmap: {
      id: "r1", assessmentId: "a1", status: "completed", errorCode: null, createdAt: "2026-10-24T03:00:00.000Z", completedAt: "2026-10-24T03:05:00.000Z", model: "gemma4:e4b",
      window: { start: "2026-10-24", end: "2027-01-23", months: [] }, ended: false, careerName: null, specialtyLabel: null, summary: null, advice: [],
      study: [], choices: [], improve: [], skills: [], months: [],
    },
    assessment: { id: "a2", createdAt: "2026-10-25T03:00:00.000Z", hasCareer: true }, stale: true, surveyDone, aiEnabled: true,
    worker: { online: false, supportsRoadmap: false },
  });
  const page = (surveyDone: boolean) => {
    liveData.mockReturnValue({ data: response(surveyDone), error: null, loading: false });
    return renderToStaticMarkup(createElement(StudentAiRoadmap));
  };

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
