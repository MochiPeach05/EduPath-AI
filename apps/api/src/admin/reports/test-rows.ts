// Synthetic student rows for the report tests (made-up names and codes; no real student).
import type { ReportRow } from "./rows.js";

let serial = 0;

/** A student with a transcript, on track, without an assessment or roadmap, unless `over` says otherwise. */
export function reportRow(over: Partial<ReportRow> = {}): ReportRow {
  serial += 1;
  return {
    userId: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    name: `Sinh Viên Mẫu ${serial}`,
    studentCode: `99000${String(serial).padStart(5, "0")}`,
    cohort: "K29",
    majorCode: "7480201",
    specialtyCode: "CNPM",
    majorName: "Công nghệ thông tin",
    specialtyName: "Công nghệ phần mềm",
    hasTranscript: true,
    status: "on_track",
    gpa: 3,
    lastTermGpa: 3,
    series: [],
    passedCredits: 100,
    totalCredits: 150,
    expectedCredits: 100,
    risk: { level: null, items: [] },
    competency: null,
    roadmapCourses: null,
    computedAt: "2026-10-31T02:00:00.000Z",
    ...over,
  };
}

/** The competency part of a row: groups, skills and an optional career with gaps. */
export function competency(over: Partial<NonNullable<ReportRow["competency"]>> = {}): NonNullable<ReportRow["competency"]> {
  return {
    overall: 70,
    groups: [{ name: "Chuyên môn", score: 70 }, { name: "Kỹ năng mềm", score: 80 }],
    skills: [{ name: "SQL", group: "Chuyên môn", score: 70 }, { name: "Giao tiếp", group: "Kỹ năng mềm", score: 80 }],
    career: { name: "Kỹ sư phần mềm", fitScore: 70, fitLabel: "Trung bình", gaps: [] },
    ...over,
  };
}
