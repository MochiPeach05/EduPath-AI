import { describe, expect, it } from "vitest";
import {
  bestFits, blockedText, compareRows, filterCareers, interestPicks, missingSkills, requirementState, toggleCompare,
  type GuidanceCareer, type GuidanceRequirement,
} from "./career-guidance-data";

// Synthetic careers only.
const req = (skillName: string, status: GuidanceRequirement["status"], extra: Partial<GuidanceRequirement> = {}): GuidanceRequirement => ({
  title: skillName, skillName, isRequired: false, status, statusLabel: null, score: null, threshold: 62.5, deficit: null, upcomingTerm: null, ...extra,
});
const career = (id: string, nameVi: string, score: number | null, extra: Partial<GuidanceCareer> = {}): GuidanceCareer => ({
  id, code: id, nameVi, nameEn: `${nameVi} EN`, category: "7", categoryName: "Phát triển phần mềm", description: "", isTarget: false,
  fit: score === null ? null : { score, code: score >= 80 ? "fit" : "average", label: "", dataShare: 1, met: 1, below: 1, notStudied: 0, upcoming: 0, noData: 0, total: 2 },
  requirements: [], interests: { field: null, tech: [] }, ...extra,
});

const careers = [
  career("a", "Kỹ sư dữ liệu", 72, { category: "3", categoryName: "Dữ liệu & Trí tuệ nhân tạo", interests: { field: "AI, dữ liệu", tech: [] } }),
  career("b", "Lập trình viên web", 85, { interests: { field: null, tech: ["Web front-end", "Web back-end"] } }),
  career("c", "Kỹ sư mạng", 90, { fit: { score: 90, code: "insufficient_data", label: "", dataShare: 0.3, met: 0, below: 0, notStudied: 0, upcoming: 0, noData: 3, total: 3 } }),
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
    expect(requirementState(req("SQL", "met"))).toEqual({ tone: "met", text: "Đạt" });
    expect(requirementState(req("SQL", "below", { deficit: 8.25 }))).toEqual({ tone: "below", text: "Thiếu 8,3 điểm" });
    expect(requirementState(req("Git", "upcoming", { upcomingTerm: "HK262" }))).toEqual({ tone: "upcoming", text: "Sắp học · HK2 2026–2027" });
    expect(requirementState(req("Docker", null))).toEqual({ tone: "unknown", text: "Chưa tính" });
    expect(missingSkills(career("x", "X", 50, { requirements: [req("SQL", "below"), req("Git", "met"), req("Docker", "not_studied"), req("AWS", "no_data")] }))).toEqual(["SQL", "Docker"]);
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
