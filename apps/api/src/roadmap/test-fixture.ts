// Test-only: a study roadmap built from the synthetic K29 assessment (fixtures/synthetic-k29.json), with a few
// invented grades so every kind of course shows up (a retake, an improvement, a late course, a choice and a course
// of the term after). No real student data.
import { calculateAssessment } from "../competency-assessment/calculate.js";
import { syntheticInputs } from "../competency-assessment/fixtures/synthetic-k29.js";
import type { AssessmentResult, CourseFact } from "../competency-assessment/types.js";
import { buildRoadmapFacts, type RoadmapFacts } from "./facts.js";
import { roadmapWindow } from "./window.js";

export const ROADMAP_ASSESSMENT = "33333333-3333-4333-8333-333333333333";
/** 10:00 on 24/10/2026 in Vietnam. */
export const ROADMAP_NOW = new Date("2026-10-24T03:00:00Z");

export function syntheticRoadmapResult(): AssessmentResult {
  const result = calculateAssessment(syntheticInputs());
  const change = (code: string, extra: Partial<CourseFact>) => {
    const course = result.courses.find((item) => item.code === code);
    if (!course) throw new Error(`fixture course ${code} missing`);
    Object.assign(course, extra);
  };
  // A failed mandatory course (học lại), a D one (học cải thiện) next to the D+ of the fixture.
  change("71ITBS10203", { state: "failed", outcome: "fail", letter: "F", score10: 3.2 });
  change("71ITSE30603", { letter: "D", score10: 4.2 });
  // The internship planned for the next term (HK252; HK251 is being studied).
  change("71ITIN40304", { plannedTerm: "HK252", plannedTermSource: "plan" });
  result.progress = {
    ...result.progress!,
    next: [{ kind: "course", code: "71ITIN40304", name: "Đồ án thực tập", credits: 4, state: "not_taken" }],
    late: [
      { kind: "course", code: "71ITIS30203", name: "Hệ quản trị cơ sở dữ liệu", credits: 3, termCode: "HK243", state: "not_taken" },
      { kind: "choice", label: "Nhóm tự chọn TC309: chọn 6 tín chỉ", termCode: "HK243", required: 6, unit: "credit", missing: 3, missingCredits: 3, options: [
        { code: "71ITSE30803", name: "Lập trình Web nâng cao với framework", credits: 3, state: "not_taken" },
        { code: "71ITSE30903", name: "Phát triển ứng dụng đa nền tảng", credits: 3, state: "not_taken" },
        { code: "71ITIS30303", name: "Phân tích thiết kế hệ thống", credits: 3, state: "passed" },
      ] },
    ],
  };
  return result;
}

export const syntheticRoadmapFacts = (result: AssessmentResult = syntheticRoadmapResult()): RoadmapFacts =>
  buildRoadmapFacts(ROADMAP_ASSESSMENT, result, roadmapWindow(ROADMAP_NOW));

/** An invented profile survey as stu_profile_surveys returns it (readSurvey). */
export const syntheticSurveyRow = () => ({
  version: "survey-v1",
  answers: { goal: "work", environment: "team", company: "startup", partTime: "it", leadership: "one", projects: "some", internship: "none",
    selfStudy: "medium", english: "reading", field: "web" },
  interest_tech: ["web_frontend", "ai_ml"],
  interest_hobbies: ["side_projects", "sports"],
  strengths: "Thành thạo React và Node.js\nĐã làm 2 dự án web bán hàng",
  has_achievements: true,
  achievements: "Giải Ba cuộc thi lập trình cấp khoa 2025\nHọc bổng khuyến khích học tập",
  updated_at: new Date("2026-10-24T00:30:00Z"),
});
