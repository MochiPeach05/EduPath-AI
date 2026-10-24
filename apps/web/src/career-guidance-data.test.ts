import { describe, expect, it } from "vitest";
import {
  bestFits, blockedText, compareRows, filterCareers, fitScoreText, fitSummary, interestPicks, missingSkills, orderedRequirements, requirementState, toggleCompare,
  type GuidanceCareer, type GuidanceRequirement,
} from "./career-guidance-data";

// Synthetic careers only.
const req = (skillName: string, status: GuidanceRequirement["status"], extra: Partial<GuidanceRequirement> = {}): GuidanceRequirement => ({
  title: skillName, skillName, isRequired: false, status, statusLabel: null, score: null, threshold: 62.5, deficit: null, upcomingTerm: null, exemptOnly: false, noDataReason: null, otherSpecialtyCourses: [], ...extra,
});
const career = (id: string, nameVi: string, score: number | null, extra: Partial<GuidanceCareer> = {}): GuidanceCareer => ({
  id, code: id, nameVi, nameEn: `${nameVi} EN`, category: "7", categoryName: "Phát triển phần mềm", description: "", isTarget: false,
  fit: score === null ? null : { score, code: score >= 80 ? "fit" : "average", label: "", dataShare: 1, met: 1, below: 1, notStudied: 0, upcoming: 0, noData: 0, total: 2, summaryText: "", dataText: "" },
  requirements: [], interests: { field: null, tech: [] }, ...extra,
});

const careers = [
  career("a", "Kỹ sư dữ liệu", 72, { category: "3", categoryName: "Dữ liệu & Trí tuệ nhân tạo", interests: { field: "AI, dữ liệu", tech: [] } }),
  career("b", "Lập trình viên web", 85, { interests: { field: null, tech: ["Web front-end", "Web back-end"] } }),
  career("c", "Kỹ sư mạng", 90, { fit: { score: 90, code: "insufficient_data", label: "", dataShare: 0.3, met: 0, below: 0, notStudied: 0, upcoming: 0, noData: 3, total: 3, summaryText: "", dataText: "" } }),
  career("d", "Chuyên viên kiểm thử", null),
];

describe("career guidance", () => {
  it("suggests the best fits with enough data, and the careers matching the survey", () => {
    expect(bestFits(careers).map((item) => item.id)).toEqual(["b", "a"]);
    expect(interestPicks(careers).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("filters by name without diacritics, by field and by survey match, best fit first or A–Z", () => {
    const all = { q: "", field: "", sort: "fit" as const, interestOnly: false };
    // No fit or too little data: last, by name.
    expect(filterCareers(careers, all).map((item) => item.id)).toEqual(["b", "a", "d", "c"]);
    expect(filterCareers(careers, { ...all, q: "ky su" }).map((item) => item.id)).toEqual(["a", "c"]);
    expect(filterCareers(careers, { ...all, field: "3" }).map((item) => item.id)).toEqual(["a"]);
    expect(filterCareers(careers, { ...all, interestOnly: true }).map((item) => item.id)).toEqual(["b", "a"]);
    expect(filterCareers(careers, { ...all, sort: "name" }).map((item) => item.nameVi)).toEqual(["Chuyên viên kiểm thử", "Kỹ sư dữ liệu", "Kỹ sư mạng", "Lập trình viên web"]);
  });

  it("says how the student stands on each requirement and what is still missing", () => {
    expect(requirementState(req("SQL", "met"))).toEqual({ tone: "pass", glyph: "✓", text: "Đạt ngưỡng" });
    expect(requirementState(req("SQL", "met", { exemptOnly: true }))).toEqual({ tone: "pass", glyph: "✓", text: "Đạt ngưỡng · miễn/công nhận" });
    expect(requirementState(req("SQL", "below", { deficit: 8.25 }))).toEqual({ tone: "fail", glyph: "✗", text: "Dưới ngưỡng · thiếu 9 điểm" });
    expect(requirementState(req("SQL", "below", { deficit: 0.04 }))).toEqual({ tone: "fail", glyph: "✗", text: "Dưới ngưỡng · thiếu 1 điểm" });
    expect(requirementState(req("Git", "upcoming", { upcomingTerm: "HK262" }))).toEqual({ tone: "neutral", glyph: "○", text: "Sắp học · HK262" });
    expect(requirementState(req("AWS", "no_data", { noDataReason: "other_specialty" }))).toEqual({ tone: "unknown", glyph: "!", text: "Cần tự học" });
    expect(requirementState(req("AWS", "no_data", { noDataReason: "not_measured" }))).toEqual({ tone: "neutral", glyph: "?", text: "Chưa đủ dữ liệu" });
    expect(requirementState(req("Docker", null))).toEqual({ tone: "neutral", glyph: "?", text: "Chưa tính" });
    expect(fitScoreText(50.66)).toBe("50");
    expect(fitScoreText(62.73)).toBe("62,7");
    const mixed = career("y", "Y", 50, { requirements: [req("IAM", "not_studied"), req("Chuỗi khối", "no_data", { noDataReason: "other_specialty" }), req("Bảo mật", "below", { deficit: 4, isRequired: true })] });
    expect(missingSkills(mixed)).toEqual(["Bảo mật", "IAM", "Chuỗi khối"]);
    expect(orderedRequirements(mixed).map((row) => row.title)).toEqual(["Bảo mật", "IAM", "Chuỗi khối"]);
    expect(fitSummary({ ...mixed, fit: { ...mixed.fit!, met: 0, total: 3, upcoming: 0, noData: 1, summaryText: "Đạt 0/3 kỹ năng · 0 sắp học · 1 chưa đủ dữ liệu", dataText: "2/3 kỹ năng có dữ liệu" } }))
      .toBe("Đạt 0/3 kỹ năng · 0 sắp học · 1 cần tự học · 0 chưa đủ dữ liệu · 2/3 kỹ năng có dữ liệu");
    // Every skill that lowers the fit is missing, "Chưa đủ dữ liệu" too (comp-calc-v14).
    expect(missingSkills(career("x", "X", 50, { requirements: [req("SQL", "below"), req("Git", "met"), req("Docker", "not_studied"), req("AWS", "no_data")] }))).toEqual(["SQL", "Docker", "AWS"]);
    expect(requirementState(req("BI", "no_data", { noDataReason: "elective_not_chosen" }))).toEqual({ tone: "unknown", glyph: "!", text: "Cần tự học" });
  });

  it("compares the skills of several careers, the shared ones first, and keeps at most 3", () => {
    const one = career("1", "Một", 70, { requirements: [req("SQL", "met"), req("Git", "below")] });
    const two = career("2", "Hai", 60, { requirements: [req("Docker", "not_studied"), req("SQL", "met")] });
    expect(compareRows([one, two]).map((row) => [row.name, row.cells.map((cell) => cell?.status ?? null)])).toEqual([
      ["SQL", ["met", "met"]], ["Docker", [null, "not_studied"]], ["Git", ["below", null]],
    ]);
    expect(toggleCompare(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
    expect(toggleCompare(["a", "b"], "a")).toEqual(["b"]);
    expect(blockedText("transcript_required")).toContain("tải bảng điểm");
  });
});
