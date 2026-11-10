import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoadmapTrack } from "./RoadmapProgress";
import { filledByText, type StudyPlanContext, type StudyPlanCourse, type StudyPlanData } from "./study-plan-data";

// Synthetic courses only (no student data): a CTĐT like ngành HTTT K29, "Giáo dục thể chất (1)", "(2)" and no PE elective.
const course = (code: string, extra: Partial<StudyPlanCourse> = {}): StudyPlanCourse => ({
  code, name: `Môn ${code}`, credits: 3, type: "BB", kind: "mandatory", group: null, conditional: false, applicable: true, specialtyName: null,
  standardTerm: null, prerequisites: [], prior: [], state: "not_taken", inProgressTerm: null, planTerm: null, offeredTerms: [],
  grade: null, takenTerm: null, attempts: 0, equivalent: null, ...extra,
});
const context: StudyPlanContext = {
  cohortCode: "K29", specialty: null, specialtyLabel: null, curriculum: { name: "CTĐT HTTT K29", totalCredits: 30 }, hasTranscript: true,
  currentTerm: "HK261", studyTerm: "HK261", admissionYear: 2023, standardTerms: ["HK232", "HK233"], limits: null, offeringUntil: null,
  electiveGroups: [], gpa: { actual: 3, required: null, scale: 4 }, graduation: null,
  courses: [
    course("71ITBS10103", { state: "passed", grade: "A", takenTerm: "HK231" }),
    course("DGT0010", { name: "Giáo dục thể chất (1)", credits: 0, conditional: true, state: "passed", grade: "A", takenTerm: "HK233",
      standardTerm: "HK232", filledBy: { code: "71PEVB10022", name: "Bóng chuyền" } }),
    course("DGT0020", { name: "Giáo dục thể chất (2)", credits: 0, conditional: true, state: "in_progress", inProgressTerm: "HK261",
      standardTerm: "HK233", filledBy: { code: "71PEKC10062", name: "Cờ vua" } }),
  ],
  // The electives fill the GDTC courses: only AV0 counts toward nothing.
  unmatched: [{ code: "AV0", name: "Anh văn đầu vào", credits: 0, state: "passed", grade: "Đạt", term: "HK231" }],
};
const plan: StudyPlanData = { schemaVersion: 1, terms: [{ code: "HK261", courses: [] }] };

describe("Theo dõi tiến độ: GDTC courses filled by PE electives (2026-11-10)", () => {
  it("writes the course taken under the GDTC course, done or being studied", () => {
    expect(filledByText(context.courses[1]!)).toBe("Đã học: Bóng chuyền (71PEVB10022)");
    expect(filledByText(context.courses[2]!)).toBe("Đang học: Cờ vua (71PEKC10062)");
    expect(filledByText({ state: "passed", filledBy: { code: "71PEVB10022", name: "71PEVB10022" } })).toBe("Đã học: 71PEVB10022");
    expect(filledByText(context.courses[0]!)).toBeNull();
  });

  it("shows the GDTC rows done with the elective's grade and term, never as an equivalent course, the electives not listed apart", () => {
    const html = renderToStaticMarkup(createElement(RoadmapTrack, { context, plan, projection: null }));
    expect(html).toMatch(/rm-req-row rm-row-done"><span[^>]*>✓<\/span><span class="rm-row-code">DGT0010<\/span><span class="rm-row-name">Giáo dục thể chất \(1\)<small class="rm-row-taken">Đã học: Bóng chuyền \(71PEVB10022\)<\/small><\/span><span class="rm-row-credits">0 TC<\/span><span class="rm-row-note">A · HK3 2023–2024<\/span>/);
    expect(html).toMatch(/rm-req-row rm-row-running">.*?Giáo dục thể chất \(2\)<small class="rm-row-taken">Đang học: Cờ vua \(71PEKC10062\)<\/small>.*?Đang học · HK1 2026–2027/);
    expect(html).toContain("Học phần không được tính (1)");
    const outside = html.slice(html.indexOf('class="rm-unmatched"'));
    expect(outside).toContain("AV0");
    expect(outside).not.toContain("71PEVB10022");
    expect(outside).not.toContain("71PEKC10062");
    // The rows never read "tương đương" (the legend's own symbol list is not a row).
    const rows = html.slice(html.indexOf('class="rm-audit-groups"'));
    expect(rows).not.toContain("tương đương");
  });
});
