import { describe, expect, it } from "vitest";
import {
  averageTables, calendarTerm, careersReport, cohortSplit, compareCohorts, competencyGroupsOf, courseStudents, coursesReport, dashboardReport,
  filterRows, fitSummaryOf, fitWord, gpaBandOf, gpaPoints, kpisOf, levelWord, progressReport, reportOptions, riskReport, skillsReport, skillStudents,
} from "./aggregate.js";
import { competency, reportRow } from "./test-rows.js";

// The reports as pure functions of synthetic student rows (made-up names and codes).
const NOW = new Date("2026-10-31T02:00:00Z");
const GEN = "2026-10-31T01:00:00.000Z";

describe("words and numbers", () => {
  it("use the student pages' level and fit words on the same bounds", () => {
    expect([90, 89.99, 80, 62.5, 62.49, 50, 49.9].map(levelWord)).toEqual(["Xuất sắc", "Giỏi", "Giỏi", "Khá", "Trung bình", "Trung bình", "Yếu"]);
    expect([95, 85, 70, 55, 10].map(fitWord)).toEqual(["Rất phù hợp", "Phù hợp", "Trung bình", "Ít phù hợp", "Không phù hợp"]);
    expect(levelWord(null)).toBeNull();
    expect([3.6, 3.59, 3.2, 2.5, 2.49, 2, 1.99].map(gpaBandOf)).toEqual(["Xuất sắc", "Giỏi", "Giỏi", "Khá", "Trung bình", "Trung bình", "Yếu"]);
  });

  it("know the term under way from the school calendar", () => {
    expect(calendarTerm(NOW)).toEqual({ code: "HK261", label: "HK1 2026–2027" });
    expect(calendarTerm(new Date("2027-01-05T02:00:00Z"))?.code).toBe("HK262");
    // Between two terms, the one that ended last.
    expect(calendarTerm(new Date("2027-08-25T02:00:00Z"))?.code).toBe("HK263");
  });
});

describe("scope", () => {
  const rows = [
    reportRow({ name: "Nguyễn Văn An", studentCode: "9901", cohort: "K30" }),
    reportRow({ name: "Trần Thị Bình", studentCode: "9902", cohort: "K29", majorCode: "7480104", specialtyCode: "HTTT_CDS" }),
    reportRow({ name: "Lê Đức Cường", studentCode: "9903", cohort: null }),
  ];

  it("filter by cohort, major, specialty and MSSV or name without accents", () => {
    expect(filterRows(rows, { cohort: "K30" }).map((row) => row.studentCode)).toEqual(["9901"]);
    expect(filterRows(rows, { major: "7480104" }).map((row) => row.studentCode)).toEqual(["9902"]);
    expect(filterRows(rows, { specialty: "CNPM" })).toHaveLength(2);
    expect(filterRows(rows, { q: "binh" }).map((row) => row.studentCode)).toEqual(["9902"]);
    expect(filterRows(rows, { q: "9903" }).map((row) => row.name)).toEqual(["Lê Đức Cường"]);
    expect(filterRows(rows, { q: "cuong" })).toHaveLength(1);
  });

  it("split every aggregate by cohort, oldest first, students without a cohort only in the total", () => {
    const split = cohortSplit(rows, (part) => ({ n: part.length }));
    expect(split).toEqual({ all: { n: 3 }, byCohort: [{ cohort: "K29", n: 1 }, { cohort: "K30", n: 1 }] });
    expect(["K100", "K31", "K26", "Khác"].sort(compareCohorts)).toEqual(["K26", "K31", "K100", "Khác"]);
  });
});

describe("Tổng quan (AD-REPORT-01)", () => {
  const a = reportRow({
    cohort: "K29", gpa: 3, lastTermGpa: 2.5,
    series: [{ term: "HK241", termGpa: 2.8, cumulativeGpa: 2.9 }, { term: "HK242", termGpa: 2.5, cumulativeGpa: 3 }],
    risk: { level: "risk", items: [{ kind: "gpa_below", level: "risk", text: "GPA tích lũy 1,90 dưới mức tối thiểu 2,00 để xét tốt nghiệp." }] },
    competency: competency({ overall: 80, career: { name: "Kỹ sư phần mềm", fitScore: 90, fitLabel: "Rất phù hợp", gaps: [] } }),
  });
  const b = reportRow({
    cohort: "K30", gpa: 2, lastTermGpa: 3,
    series: [{ term: "HK242", termGpa: 3, cumulativeGpa: 2 }],
    risk: { level: "warn", items: [{ kind: "late_course", level: "warn", text: "Cấu trúc dữ liệu trễ so với kế hoạch (dự kiến HK2 2025–2026)." }] },
    competency: competency({ overall: 60, career: { name: "Kỹ sư dữ liệu", fitScore: 50, fitLabel: "Ít phù hợp", gaps: [] } }),
  });
  const none = reportRow({ cohort: "K30", hasTranscript: false, status: "no_transcript", gpa: null, lastTermGpa: null, passedCredits: null });

  it("carry each student's cumulative GPA forward term by term", () => {
    expect(gpaPoints([a, b, none])).toEqual([
      { term: { code: "HK241", label: "HK1 2024–2025" }, termGpa: 2.8, termStudents: 1, cumulativeGpa: 2.9 },
      { term: { code: "HK242", label: "HK2 2024–2025" }, termGpa: 2.75, termStudents: 2, cumulativeGpa: 2.5 },
    ]);
  });

  it("sum up GPA, competency, fit and the students who need attention", () => {
    const kpis = kpisOf([a, b, none]);
    expect(kpis).toMatchObject({ students: 3, withTranscript: 2, assessed: 2, gpa: 2.5, competency: 70, competencyLevel: "Khá", fit: 70, fitLabel: "Trung bình", risk: 1, warn: 1 });
    expect(kpis.gpaChange).toBeCloseTo(-0.4);
    expect(kpis.gpaChangeFrom?.code).toBe("HK241");
  });

  it("averages per cohort, major and specialty with a total row", () => {
    const [byCohort, byMajor, bySpecialty] = averageTables([a, b, none]);
    expect(byCohort!.rows.map((row) => [row.key, row.students, row.gpa, row.below2])).toEqual([["K29", 1, 3, 0], ["K30", 1, 2, 0]]);
    expect(byCohort!.all).toMatchObject({ key: "all", label: "Tất cả", students: 2, gpa: 2.5, lastTermGpa: 2.75, credits: 100, competency: 70, competencyLevel: "Khá" });
    expect(byMajor!.rows.map((row) => row.label)).toEqual(["Công nghệ thông tin"]);
    expect(bySpecialty!.rows.map((row) => row.label)).toEqual(["Công nghệ phần mềm"]);
  });

  it("averages the competency groups and names the weakest and strongest skills once", () => {
    const groups = competencyGroupsOf([a, b]);
    expect(groups.groups).toEqual([
      { name: "Chuyên môn", score: 70, level: "Khá", students: 2 },
      { name: "Kỹ năng mềm", score: 80, level: "Giỏi", students: 2 },
    ]);
    expect(groups.lowest.map((skill) => skill.name)).toEqual(["SQL", "Giao tiếp"]);
    expect(groups.highest).toEqual([]);
  });

  it("counts the fit words the students see and averages each career", () => {
    const fit = fitSummaryOf([a, b]);
    expect(fit.average).toBe(70);
    expect(fit.label).toBe("Trung bình");
    expect(fit.levels.find((level) => level.label === "Rất phù hợp")?.students).toBe(1);
    expect(fit.levels.find((level) => level.label === "Ít phù hợp")?.students).toBe(1);
    expect(fit.careers).toEqual([{ name: "Kỹ sư dữ liệu", students: 1, average: 50 }, { name: "Kỹ sư phần mềm", students: 1, average: 90 }]);
  });

  it("gives every section for all cohorts and for each cohort", () => {
    const report = dashboardReport([a, b, none], {}, GEN, NOW);
    expect(report.generatedAt).toBe(GEN);
    expect(report.studyTerm?.code).toBe("HK261");
    expect(report.scope).toEqual({ students: 3, withTranscript: 2, assessed: 2 });
    expect(report.kpis.byCohort.map((entry) => [entry.cohort, entry.students, entry.gpa])).toEqual([["K29", 1, 3], ["K30", 2, 2]]);
    expect(report.progress.all).toEqual({ total: 3, onTrack: 2, late: 0, unknown: 0, noTranscript: 1 });
    expect(report.gpaBands.all.bands.map((band) => band.students)).toEqual([0, 0, 1, 1, 0]);
    expect(report.competencyGroups.byCohort).toHaveLength(2);
    expect(report.fit.byCohort[1]).toMatchObject({ cohort: "K30", average: 50 });
    expect(dashboardReport([a, b, none], { cohort: "K29" }, GEN, NOW).scope.students).toBe(1);
  });
});

describe("Tiến độ and Nguy cơ (AD-REPORT-02, 04)", () => {
  const rows = [
    reportRow({ name: "Phạm Văn Bảo", cohort: "K29", status: "late", gpa: 2.1, risk: { level: "warn", items: [{ kind: "late_course", level: "warn", text: "Môn A trễ so với kế hoạch." }] } }),
    reportRow({ name: "Nguyễn Thị An", cohort: "K30", status: "on_track", gpa: 3.5 }),
    reportRow({ name: "Võ Minh Châu", cohort: "K30", status: "unknown", gpa: 1.8, risk: { level: "risk", items: [
      { kind: "failed_course", level: "risk", text: "Môn bắt buộc chưa đạt: Môn B (F) và chưa có trong Kế hoạch học kỳ." },
      { kind: "gpa_below", level: "risk", text: "GPA tích lũy 1,80 dưới mức tối thiểu 2,00 để xét tốt nghiệp." },
    ] } }),
    reportRow({ name: "Đỗ Gia Huy", cohort: "K31", hasTranscript: false, status: "no_transcript", gpa: null }),
  ];

  it("list students by given name and page through them", () => {
    const report = progressReport(rows, { pageSize: 2 }, GEN, NOW);
    expect(report.page.total).toBe(4);
    expect(report.page.items.map((item) => item.name)).toEqual(["Nguyễn Thị An", "Phạm Văn Bảo"]);
    expect(progressReport(rows, { pageSize: 2, page: 2 }, GEN, NOW).page.items.map((item) => item.name)).toEqual(["Võ Minh Châu", "Đỗ Gia Huy"]);
    expect(report.counts.all).toEqual({ total: 4, onTrack: 1, late: 1, unknown: 1, noTranscript: 1 });
    expect(report.counts.byCohort.map((entry) => entry.cohort)).toEqual(["K29", "K30", "K31"]);
  });

  it("filter and sort the progress list, students without a GPA last", () => {
    expect(progressReport(rows, { status: "late" }, GEN, NOW).page.items.map((item) => item.name)).toEqual(["Phạm Văn Bảo"]);
    expect(progressReport(rows, { sort: "gpa", dir: "desc" }, GEN, NOW).page.items.map((item) => item.gpa)).toEqual([3.5, 2.1, 1.8, null]);
    expect(progressReport(rows, { sort: "gpa", dir: "asc" }, GEN, NOW).page.items.map((item) => item.gpa)).toEqual([1.8, 2.1, 3.5, null]);
  });

  it("put risk before warn and count every reason per cohort", () => {
    const report = riskReport(rows, {}, GEN, NOW);
    expect(report.page.items.map((item) => [item.name, item.level, item.reasons.length])).toEqual([["Võ Minh Châu", "risk", 2], ["Phạm Văn Bảo", "warn", 1]]);
    expect(report.counts.all).toEqual({ total: 2, risk: 1, warn: 1 });
    expect(report.reasons.all.items.map((item) => [item.kind, item.students])).toEqual([
      ["failed_course", 1], ["pace", 0], ["gpa_below", 1], ["late_course", 1], ["elective_short", 0],
    ]);
    expect(report.reasons.byCohort.find((entry) => entry.cohort === "K29")!.items.find((item) => item.kind === "late_course")!.students).toBe(1);
    expect(riskReport(rows, { level: "warn" }, GEN, NOW).page.items).toHaveLength(1);
  });
});

describe("Kỹ năng, Nghề nghiệp, Môn học (AD-REPORT-06, 08, 09)", () => {
  const career = (name: string, fitScore: number, fitLabel: string, gaps: { name: string; status: "below" | "not_studied" | "self_study" | "no_data" }[]) =>
    competency({ career: { name, fitScore, fitLabel, gaps } });
  const rows = [
    reportRow({ name: "Mai Anh", cohort: "K29", competency: career("Kỹ sư phần mềm", 70, "Trung bình", [{ name: "React", status: "self_study" }, { name: "SQL", status: "below" }]),
      roadmapCourses: [{ code: "COS120", name: "Cấu trúc dữ liệu", how: "retake" }, { code: "COS130", name: "Cơ sở dữ liệu", how: "new" }] }),
    reportRow({ name: "Hà Bảo", cohort: "K30", competency: career("Kỹ sư phần mềm", 85, "Phù hợp", [{ name: "React", status: "not_studied" }]),
      roadmapCourses: [{ code: "COS130", name: "Cơ sở dữ liệu", how: "new" }] }),
    reportRow({ name: "Lý Châu", cohort: "K30", competency: career("Kỹ sư dữ liệu", 55, "Ít phù hợp", [{ name: "Spark", status: "self_study" }]), roadmapCourses: [] }),
    reportRow({ name: "Tô Dũng", cohort: "K31" }),
  ];

  it("rank the missing skills and give the same skills per cohort", () => {
    const report = skillsReport(rows, {}, GEN, NOW);
    expect(report.careers).toEqual(["Kỹ sư dữ liệu", "Kỹ sư phần mềm"]);
    expect(report.skills.all.items.map((item) => [item.name, item.total])).toEqual([["React", 2], ["Spark", 1], ["SQL", 1]]);
    expect(report.skills.all.items[0]).toEqual({ name: "React", below: 0, notStudied: 1, selfStudy: 1, noData: 0, total: 2 });
    const k29 = report.skills.byCohort.find((entry) => entry.cohort === "K29")!;
    expect(k29.items.map((item) => [item.name, item.total])).toEqual([["React", 1], ["Spark", 0], ["SQL", 1]]);
    expect(skillsReport(rows, { career: "Kỹ sư dữ liệu" }, GEN, NOW).skills.all.items.map((item) => item.name)).toEqual(["Spark"]);
  });

  it("name the students who miss a skill, below the threshold first", () => {
    const list = skillStudents(rows, { skill: "React" });
    expect(list.items.map((item) => [item.name, item.status, item.careerName])).toEqual([
      ["Hà Bảo", "not_studied", "Kỹ sư phần mềm"], ["Mai Anh", "self_study", "Kỹ sư phần mềm"],
    ]);
  });

  it("count the target careers with their fit words and most missed skills", () => {
    const report = careersReport(rows, {}, GEN, NOW);
    expect(report.withoutCareer).toBe(1);
    expect(report.careers.all.items[0]).toMatchObject({ name: "Kỹ sư phần mềm", students: 2, average: 77.5, topGaps: [{ name: "React", students: 2 }, { name: "SQL", students: 1 }] });
    expect(report.careers.all.items[0]!.levels.find((level) => level.label === "Phù hợp")!.students).toBe(1);
    const k31 = report.careers.byCohort.find((entry) => entry.cohort === "K31")!;
    expect(k31.items.map((item) => [item.name, item.students, item.average])).toEqual([["Kỹ sư phần mềm", 0, null], ["Kỹ sư dữ liệu", 0, null]]);
  });

  it("count the courses Lộ trình AI proposes, by how", () => {
    const report = coursesReport(rows, {}, GEN, NOW);
    expect(report.withRoadmap).toBe(3);
    expect(report.courses.all.items).toEqual([
      { code: "COS130", name: "Cơ sở dữ liệu", newStudents: 2, retake: 0, improve: 0, total: 2 },
      { code: "COS120", name: "Cấu trúc dữ liệu", newStudents: 0, retake: 1, improve: 0, total: 1 },
    ]);
    expect(report.courses.byCohort.find((entry) => entry.cohort === "K30")!.items.map((item) => [item.code, item.name, item.total])).toEqual([
      ["COS130", "Cơ sở dữ liệu", 1], ["COS120", "Cấu trúc dữ liệu", 0],
    ]);
    expect(courseStudents(rows, { code: "cos130" })).toMatchObject({ code: "COS130", name: "Cơ sở dữ liệu", items: [{ name: "Mai Anh", how: "new" }, { name: "Hà Bảo", how: "new" }] });
  });

  it("offer the cohorts of the students, the majors and the specialties", () => {
    const options = reportOptions(["K30", "k29 ", null, "K31", "K30"], NOW);
    expect(options.cohorts).toEqual(["K29", "K30", "K31"]);
    expect(options.majors.map((major) => major.code)).toEqual(["7480201", "7480104", "7480102"]);
    expect(options.specialties.find((item) => item.code === "CNPM")).toEqual({ code: "CNPM", name: "Công nghệ phần mềm", majorCode: "7480201" });
    expect(options.studyTerm?.label).toBe("HK1 2026–2027");
  });
});
