import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentResult } from "../../competency-assessment/types.js";
import type { OverviewResponse, OverviewWarning } from "../../overview/types.js";
import type { RoadmapRow } from "../../roadmap/jobs.js";
import { ROADMAP_ASSESSMENT, syntheticRoadmapFacts, syntheticRoadmapResult } from "../../roadmap/test-fixture.js";
import {
  competencyOf, expectedCreditsOf, fallbackRow, gapStatusOf, progressStatus, readReportRow, riskOf, roadmapCoursesOf, rowFromParts, type ReportIdentity,
} from "./rows.js";

// One student's report row from what Tổng quan reads, with synthetic data only (the K29 fixture of the engine tests).
const NOW = new Date("2026-10-31T02:00:00Z");
const identity: ReportIdentity = { userId: "00000000-0000-4000-8000-000000000001", name: "Sinh Viên Mẫu", studentCode: "9900000001", cohort: "K29", majorCode: "7480201", specialtyCode: "CNPM" };

const warning = (kind: OverviewWarning["kind"], level: OverviewWarning["level"], text = "Nội dung."): OverviewWarning => ({ kind, level, key: kind, text, strong: [], action: null });
function overview(over: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    generatedAt: NOW.toISOString(),
    profile: { cohortCode: "K29", majorName: "Công nghệ thông tin", specialtyName: "Công nghệ phần mềm", careerName: null },
    readiness: { transcript: true, specialty: true, career: false, survey: false, assessment: false, roadmap: false },
    terms: { studying: { code: "HK261", label: "HK1 2026–2027" }, next: null },
    transcript: {
      updatedAt: NOW.toISOString(), gpa4: 2.85, gpa10: 7.1, rank: "Khá", credits: 98, gpaChange: 0.05,
      series: [
        { term: { code: "HK251", label: "HK1 2025–2026" }, termGpa4: 2.7, cumulativeGpa4: 2.8 },
        { term: { code: "HK252", label: "HK2 2025–2026" }, termGpa4: 2.95, cumulativeGpa4: 2.85 },
        { term: { code: "HK253", label: "HK3 2025–2026" }, termGpa4: null, cumulativeGpa4: 2.85 },
      ],
    },
    progress: {
      blocked: null, totalCredits: 150, passedCredits: 98, runningCredits: 15, lateCredits: 0, remainingCredits: 37, termsLeft: 3, creditsPerTerm: 13, planMaxPerTerm: 18,
      terms: [
        { term: { code: "HK251", label: "HK1 2025–2026" }, state: "done", passedCredits: 17, plannedCredits: 17, courses: [] },
        { term: { code: "HK252", label: "HK2 2025–2026" }, state: "done", passedCredits: 18, plannedCredits: 18, courses: [] },
        { term: { code: "HK261", label: "HK1 2026–2027" }, state: "running", passedCredits: 0, plannedCredits: 15, courses: [] },
        { term: { code: "HK262", label: "HK2 2026–2027" }, state: "planned", passedCredits: 0, plannedCredits: 16, courses: [] },
      ],
    },
    graduation: null,
    competency: null,
    roadmap: null,
    running: [],
    warnings: { level: "ok", items: [warning("on_track", "ok")] },
    suggestions: [],
    ...over,
  };
}

describe("a student's progress status", () => {
  it("is judged once, as Tổng quan judges it", () => {
    expect(progressStatus(overview())).toBe("on_track");
    expect(progressStatus(overview({ transcript: null, progress: null }))).toBe("no_transcript");
    expect(progressStatus(overview({ progress: { ...overview().progress!, blocked: "plan_unavailable" } }))).toBe("unknown");
    expect(progressStatus(overview({ progress: null }))).toBe("unknown");
    expect(progressStatus(overview({ warnings: { level: "warn", items: [warning("late_course", "warn")] } }))).toBe("late");
    expect(progressStatus(overview({ warnings: { level: "risk", items: [warning("pace", "risk")] } }))).toBe("late");
    expect(progressStatus(overview({ progress: { ...overview().progress!, lateCredits: 3 } }))).toBe("late");
    // A failed course already planned again is a warning, not lateness by itself.
    expect(progressStatus(overview({ warnings: { level: "warn", items: [warning("failed_course", "warn")] } }))).toBe("on_track");
  });

  it("keeps the 'Cần chú ý' items that are risks, not missing data or 'Đúng tiến độ'", () => {
    expect(riskOf([warning("on_track", "ok")])).toEqual({ level: null, items: [] });
    expect(riskOf([warning("missing_data", "warn")])).toEqual({ level: null, items: [] });
    expect(riskOf([warning("late_course", "warn", "A trễ."), warning("gpa_below", "risk", "GPA thấp.")])).toEqual({
      level: "risk", items: [{ kind: "late_course", level: "warn", text: "A trễ." }, { kind: "gpa_below", level: "risk", text: "GPA thấp." }],
    });
  });

  it("expects the KHĐT credits of the terms before the one being studied", () => {
    expect(expectedCreditsOf(overview().progress)).toBe(35);
    expect(expectedCreditsOf(null)).toBeNull();
    expect(expectedCreditsOf({ ...overview().progress!, blocked: "plan_unavailable" })).toBeNull();
  });
});

describe("the competency part", () => {
  const computed = syntheticRoadmapResult();

  it("groups the career gaps in the words of Khoảng trống kỹ năng", () => {
    expect(gapStatusOf({ status: "met", noDataReason: null })).toBeNull();
    expect(gapStatusOf({ status: "below", noDataReason: null })).toBe("below");
    expect(gapStatusOf({ status: "upcoming", noDataReason: null })).toBe("not_studied");
    expect(gapStatusOf({ status: "not_studied", noDataReason: null })).toBe("not_studied");
    expect(gapStatusOf({ status: "no_data", noDataReason: "other_specialty" })).toBe("self_study");
    expect(gapStatusOf({ status: "no_data", noDataReason: "elective_not_chosen" })).toBe("self_study");
    expect(gapStatusOf({ status: "no_data", noDataReason: "not_measured" })).toBe("no_data");
  });

  it("keeps every group score, the scored skills and the gaps of the stored assessment", () => {
    const part = competencyOf(computed, { name: "Kỹ sư phần mềm", fitScore: 64.2, fitLabel: "Trung bình", met: 3, total: 5, gaps: [] });
    expect(part.overall).toBe(computed.overall.score);
    expect(part.groups).toEqual(computed.groups.map((group) => ({ name: group.name, score: group.score })));
    expect(part.skills.length).toBe(computed.skills.filter((skill) => skill.score !== null && !skill.conditionOnly).length);
    expect(part.skills.every((skill) => typeof skill.score === "number")).toBe(true);
    expect(part.career).toMatchObject({ name: "Kỹ sư phần mềm", fitScore: 64.2, fitLabel: "Trung bình" });
    const notMet = computed.career!.requirements.filter((requirement) => requirement.status !== "met").length;
    expect(part.career!.gaps).toHaveLength(notMet);
  });
});

describe("the Lộ trình AI courses", () => {
  const row = (extra: Partial<RoadmapRow> = {}): RoadmapRow => ({
    id: "44444444-4444-4444-8444-444444444444", assessmentId: ROADMAP_ASSESSMENT, status: "completed", errorCode: null,
    createdAt: new Date("2026-10-24T03:00:00Z"), completedAt: new Date("2026-10-24T03:02:00Z"), model: "gemma4:e4b", facts: syntheticRoadmapFacts(), recent: false,
    output: {
      summary: "Tóm tắt.",
      study: [{ code: "71ITSE30803", advice: "Chọn môn này." }, { code: "71ITIS30203", advice: "Đăng ký sớm." }],
      improve: [{ code: "71ITAI40103", advice: "Học cải thiện." }],
      skills: [], months: [],
    },
    ...extra,
  } as RoadmapRow);

  it("are every retake, the improvements and the studies the AI chose", () => {
    expect(roadmapCoursesOf(row(), "2026-10-31").map((course) => [course.code, course.how])).toEqual([
      ["71ITBS10203", "retake"], ["71ITAI40103", "improve"], ["71ITSE30803", "new"], ["71ITIS30203", "new"],
    ]);
  });
});

describe("a report row", () => {
  it("copies what Tổng quan shows and adds the latest term GPA", () => {
    const row = rowFromParts(identity, overview({ warnings: { level: "warn", items: [warning("late_course", "warn", "Môn A trễ.")] } }), null, null, NOW);
    expect(row).toMatchObject({
      name: "Sinh Viên Mẫu", cohort: "K29", majorName: "Công nghệ thông tin", specialtyName: "Công nghệ phần mềm", hasTranscript: true,
      status: "late", gpa: 2.85, lastTermGpa: 2.95, passedCredits: 98, totalCredits: 150, expectedCredits: 35,
      risk: { level: "warn", items: [{ kind: "late_course", level: "warn", text: "Môn A trễ." }] }, competency: null, roadmapCourses: null,
      computedAt: NOW.toISOString(),
    });
    expect(row.series).toEqual([
      { term: "HK251", termGpa: 2.7, cumulativeGpa: 2.8 }, { term: "HK252", termGpa: 2.95, cumulativeGpa: 2.85 }, { term: "HK253", termGpa: null, cumulativeGpa: 2.85 },
    ]);
  });

  it("has nothing of the assessment unless Tổng quan shows it (no consent, no assessment)", () => {
    const computed = syntheticRoadmapResult();
    expect(rowFromParts(identity, overview({ competency: null }), { computed }, null, NOW).competency).toBeNull();
    const shown = overview({ competency: { assessedAt: NOW.toISOString(), overallScore: 70, overallLevel: "Khá", strengths: [], career: null, stale: false } });
    expect(rowFromParts(identity, shown, { computed }, null, NOW).competency?.overall).toBe(computed.overall.score);
  });

  it("without a transcript has no risk and status no_transcript", () => {
    const row = rowFromParts(identity, overview({ transcript: null, progress: null, warnings: { level: "none", items: [warning("missing_data", "warn")] } }), null, null, NOW);
    expect(row).toMatchObject({ hasTranscript: false, status: "no_transcript", gpa: null, risk: { level: null, items: [] } });
    expect(fallbackRow(identity, NOW)).toMatchObject({ status: "unknown", hasTranscript: false, name: "Sinh Viên Mẫu" });
  });

  it("reads the assessment only when Tổng quan shows one, and the newest completed roadmap", async () => {
    const computed = syntheticRoadmapResult() as AssessmentResult;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM stu_comp_assessments")) return { rowCount: 1, rows: [{ id: "a", createdAt: NOW, computed }] };
      if (sql.includes("FROM stu_roadmaps WHERE user_id=$1 AND status='completed'")) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    });
    const db = { query } as unknown as PoolClient;
    const withAssessment = overview({ competency: { assessedAt: NOW.toISOString(), overallScore: 70, overallLevel: "Khá", strengths: [], career: null, stale: false } });
    const row = await readReportRow(db, identity, NOW, async () => withAssessment);
    expect(row.competency?.groups.length).toBe(computed.groups.length);
    expect(row.roadmapCourses).toBeNull();
    query.mockClear();
    await readReportRow(db, identity, NOW, async () => overview());
    expect(query.mock.calls.some(([sql]) => String(sql).includes("FROM stu_comp_assessments"))).toBe(false);
  });
});
