import { describe, expect, it } from "vitest";
import {
  bestFits, bestFitsHeading, blockedText, compareRows, filterCareers, fitRuleText, fitScoreText, fitSummary, gapNote, interestPicks, missingSkills,
  orderedRequirements, requirementState, toggleCompare, FIT_RULE_TEXT, type GuidanceCareer, type GuidanceRequirement,
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
    expect(requirementState(req("Git", "upcoming", { upcomingTerm: "HK262" }))).toEqual({ tone: "neutral", glyph: "○", text: "Sắp học · HK2 · 2026–2027" });
    expect(requirementState(req("AWS", "no_data", { noDataReason: "other_specialty" }))).toEqual({ tone: "unknown", glyph: "!", text: "Cần tự học" });
    expect(requirementState(req("AWS", "no_data", { noDataReason: "not_measured" }))).toEqual({ tone: "neutral", glyph: "?", text: "Chưa đủ dữ liệu" });
    expect(requirementState(req("Docker", null))).toEqual({ tone: "neutral", glyph: "?", text: "Chưa tính" });
    expect(fitScoreText(50.66)).toBe("50");
    expect(fitScoreText(62.73)).toBe("62,7");
    const mixed = career("y", "Y", 50, { requirements: [req("IAM", "not_studied"), req("Chuỗi khối", "no_data", { noDataReason: "other_specialty" }), req("Bảo mật", "below", { score: 58.5, deficit: 4, isRequired: true })] });
    expect(missingSkills(mixed)).toEqual(["Bảo mật", "IAM", "Chuỗi khối"]);
    expect(orderedRequirements(mixed).map((row) => row.title)).toEqual(["Bảo mật", "IAM", "Chuỗi khối"]);
    expect(fitSummary({ ...mixed, fit: { ...mixed.fit!, met: 0, total: 3, upcoming: 0, noData: 1, summaryText: "Đạt 0/3 kỹ năng · 0 sắp học · 1 chưa đủ dữ liệu", dataText: "2/3 kỹ năng có dữ liệu" } }))
      .toBe("Đạt 0/3 kỹ năng · 1 dưới ngưỡng · 1 chưa học · 1 cần tự học · 1/3 kỹ năng có điểm");
    // Every skill that lowers the fit is missing, "Chưa đủ dữ liệu" too (comp-calc-v14).
    expect(missingSkills(career("x", "X", 50, { requirements: [req("SQL", "below"), req("Git", "met"), req("Docker", "not_studied"), req("AWS", "no_data")] }))).toEqual(["SQL", "Docker", "AWS"]);
    expect(requirementState(req("BI", "no_data", { noDataReason: "elective_not_chosen" }))).toEqual({ tone: "unknown", glyph: "!", text: "Cần tự học" });
  });

  it("titles the best fits by how far they reach", () => {
    expect(bestFitsHeading(bestFits(careers)).title).toBe("Phù hợp nhất với năng lực hiện tại");
    // K31: 48, 48 and 47, all Không phù hợp, most skills still ahead.
    const low = (id: string, score: number) => career(id, `Nghề ${id}`, score, { fit: { score, code: "not_fit", label: "Không phù hợp", dataShare: 0.4, met: 1, below: 1,
      notStudied: 2, upcoming: 4, noData: 0, total: 8, summaryText: "", dataText: "" } });
    const heading = bestFitsHeading(bestFits([low("p", 48), low("q", 48), low("r", 47)]));
    expect(heading.title).toBe("Mức phù hợp cao nhất hiện nay");
    expect(heading.note).toContain("phần lớn kỹ năng của các nghề này bạn chưa học tới");
    // Low because of skills below the threshold, not of skills ahead.
    const below = career("s", "Nghề s", 30, { fit: { score: 30, code: "low_fit", label: "Ít phù hợp", dataShare: 1, met: 1, below: 5, notStudied: 0, upcoming: 0, noData: 0,
      total: 6, summaryText: "", dataText: "" } });
    expect(bestFitsHeading([below]).note).toContain("còn dưới ngưỡng");
  });

  it("says the score grows with the courses ahead only for a career with Sắp học skills", () => {
    const ahead = career("u", "U", 50, { requirements: [req("Git", "upcoming", { upcomingTerm: "HK262" })] });
    expect(fitRuleText(ahead)).toBe(`${FIT_RULE_TEXT} Điểm sẽ tăng khi bạn học các học phần sắp học.`);
    expect(fitRuleText(career("v", "V", 50, { requirements: [req("SQL", "met"), req("Git", "not_studied")] }))).toBe(FIT_RULE_TEXT);
  });

  it("says what Khoảng trống kỹ năng shows when it is not the target career this page computes", () => {
    const target = career("c1", "Lập trình viên toàn diện", 60);
    const stored = { gapCurrent: false, gapAssessedAt: "2026-10-24T18:52:14.000Z", gapCareerId: "c2", gapCareerName: "Kỹ sư dữ liệu" };
    // Another career is assessed: say which, not "dữ liệu cũ hơn".
    expect(gapNote(stored, target)).toBe("Khoảng trống kỹ năng vẫn đang hiển thị nghề Kỹ sư dữ liệu. Bấm Đánh giá lại ở trang Đánh giá năng lực để cập nhật theo nghề mới.");
    // The same career from older data, at the app's time format.
    expect(gapNote({ ...stored, gapCareerId: "c1", gapCareerName: target.nameVi }, target))
      .toBe("Trang Khoảng trống kỹ năng đang hiển thị lần đánh giá lúc 01:52 25/10/2026, tính trên dữ liệu cũ hơn nên có thể khác mức ở đây. Bấm Đánh giá lại ở trang Đánh giá năng lực để cập nhật.");
    // It matches: nothing to say.
    expect(gapNote({ ...stored, gapCurrent: true, gapCareerId: "c1" }, target)).toBeNull();
    expect(gapNote({ ...stored, gapAssessedAt: null, gapCareerId: null, gapCareerName: null }, target)).toContain("Bạn chưa đánh giá năng lực");
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
