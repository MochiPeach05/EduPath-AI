import { describe, expect, it } from "vitest";
import {
  bestFits, bestFitsHeading, blockedAction, blockedText, careerPicks, compareRows, filterCareers, fitRuleText, fitScoreText, fitSummary, gapNote, interestPicks,
  interestReason, metSkills, missingSkills, nameList, nextFitLevel, rankOf, surveyInterests, targetStanding,
  orderedRequirements, requirementSourcesText, requirementState, toggleCompare, FIT_RULE_TEXT, type GuidanceCareer, type GuidanceRequirement,
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

  it("filters by name without diacritics and by field, best fit first", () => {
    const all = { q: "", field: "" };
    // No fit or too little data: last, by name.
    expect(filterCareers(careers, all).map((item) => item.id)).toEqual(["b", "a", "d", "c"]);
    expect(filterCareers(careers, { ...all, q: "ky su" }).map((item) => item.id)).toEqual(["a", "c"]);
    expect(filterCareers(careers, { ...all, field: "3" }).map((item) => item.id)).toEqual(["a"]);
  });

  it("picks the best fit, the next ones by fit and the survey matches, never one career twice (user 2026-10-31)", () => {
    const many = [
      career("p1", "Nghề một", 80), career("p2", "Nghề hai", 75), career("p3", "Nghề ba", 70), career("p4", "Nghề bốn", 65),
      career("p5", "Nghề năm", 60, { interests: { field: "Web", tech: [] } }),
      career("p6", "Nghề sáu", 55, { interests: { field: null, tech: ["Web front-end"] } }),
      // A survey match already in the ranking stays there only.
      career("p7", "Nghề bảy", 50, { interests: { field: null, tech: ["Cơ sở dữ liệu"] } }),
    ];
    many[1] = { ...many[1]!, interests: { field: "Web", tech: ["Web front-end"] } };
    const picks = careerPicks(many);
    expect(picks.top?.id).toBe("p1");
    expect(picks.ranked.map((item) => item.id)).toEqual(["p2", "p3", "p4"]);
    expect(picks.liked.map((item) => item.id)).toEqual(["p5", "p6", "p7"]);
    expect(picks.scored).toBe(7);
    expect(careerPicks([]).top).toBeNull();
    expect(surveyInterests(many)).toEqual({ field: "Web", tech: ["Web front-end", "Cơ sở dữ liệu"] });
    expect(interestReason(many[4]!)).toBe("Khớp: lĩnh vực Web");
    expect(interestReason(many[1]!)).toBe("Khớp: lĩnh vực Web · thế mạnh Web front-end");
    expect(nameList(["A", "B"])).toBe("A, B");
    expect(nameList(["A", "B", "C", "D", "E"])).toBe("A, B, C và 2 kỹ năng khác");
  });

  it("leaves the target career out of the lists, and makes it the best fit on equal scores", () => {
    const list = [career("p1", "Nghề một", 80), career("p2", "Nghề hai", 75, { isTarget: true }), career("p3", "Nghề ba", 70),
      career("p4", "Nghề bốn", 65, { interests: { field: "Web", tech: [] } }), career("p5", "Nghề năm", 60)];
    const picks = careerPicks(list);
    expect(picks.top?.id).toBe("p1");
    expect(picks.ranked.map((item) => item.id)).toEqual(["p3", "p4", "p5"]);
    expect(rankOf(list, list[2]!)).toBe(3);
    const tied = [career("p1", "Nghề một", 80), career("p2", "Nghề hai", 80, { isTarget: true }), career("p3", "Nghề ba", 70)];
    expect(careerPicks(tied).top?.id).toBe("p2");
    expect(careerPicks(tied).ranked.map((item) => item.id)).toEqual(["p1", "p3"]);
    // Equal scores share a place.
    expect(rankOf(tied, tied[0]!)).toBe(1);
    expect(rankOf(tied, career("x", "Không điểm", null))).toBeNull();
  });

  it("names the next fit level and the points the shown score lacks", () => {
    expect(nextFitLevel(54.78)).toEqual({ label: "Trung bình", points: 7.8 });
    expect(nextFitLevel(62.49)).toEqual({ label: "Trung bình", points: 0.1 });
    expect(nextFitLevel(62.5)).toEqual({ label: "Phù hợp", points: 17.5 });
    expect(nextFitLevel(79.99)).toEqual({ label: "Phù hợp", points: 0.1 });
    expect(nextFitLevel(49.99)).toEqual({ label: "Ít phù hợp", points: 0.1 });
    expect(nextFitLevel(90)).toBeNull();
  });

  it("explains the target career's score and why it ranks below the best fit (user 2026-10-31)", () => {
    const must = (name: string, status: GuidanceRequirement["status"], score: number | null, extra: Partial<GuidanceRequirement> = {}) =>
      req(name, status, { isRequired: true, threshold: 80, score, ...extra });
    const may = (name: string, status: GuidanceRequirement["status"], score: number | null, extra: Partial<GuidanceRequirement> = {}) =>
      req(name, status, { score, ...extra });
    // 904/12 = 75,33: one Ưu tiên skill without a score; the scored ones average 904/11 = 82,18.
    const best = career("a", "Nghề A", 75.33, { requirements: [must("Node.js", "met", 86), must("SQL", "met", 88), must("API", "met", 84), must("OOP", "met", 82),
      may("Git", "met", 90), may("Kiểm thử", "met", 76), may("Docker", "upcoming", null), may("Bảo mật", "below", 58, { deficit: 4.5 })] });
    // 767/14 = 54,78: 4 of the 14 coefficients without a score; the scored ones average 767/10 = 76,7.
    const target = career("b", "Nghề B", 54.78, { isTarget: true, requirements: [must("Linux", "met", 84), must("Mạng máy tính", "met", 81.5), must("CI/CD", "met", 82),
      must("Hệ điều hành", "below", 71, { deficit: 9 }), must("Docker", "upcoming", null), may("Lập trình Python", "met", 72), may("Bảo mật", "below", 58, { deficit: 4.5 }),
      may("Điện toán đám mây", "no_data", null, { noDataReason: "other_specialty" }), may("Giám sát hệ thống", "not_studied", null)] });
    const standing = targetStanding([best, career("c", "Nghề C", 60), target], target);
    expect(standing).toMatchObject({ rank: 3, scored: 3, next: { label: "Trung bình", points: 7.8 } });
    expect(standing.met).toEqual(["CI/CD", "Linux", "Mạng máy tính", "Lập trình Python"]);
    expect(standing.below).toEqual(["Hệ điều hành", "Bảo mật"]);
    expect(standing.zero).toEqual([{ why: "chưa học", names: ["Giám sát hệ thống"] }, { why: "sắp học", names: ["Docker"] }, { why: "cần tự học", names: ["Điện toán đám mây"] }]);
    // The gap of 20,55 splits into 15,52 from the skills at 0 points and 5,03 from the lower scores: both named, the larger first.
    expect(standing.belowTop?.career.id).toBe("a");
    expect(standing.belowTop?.reasons).toEqual([
      "3/9 kỹ năng của Nghề B chưa có điểm nên tính 0 điểm, so với 1/8 của Nghề A. Trong đó 1 kỹ năng sắp học sẽ có điểm khi bạn học tới.",
      "Các kỹ năng đã có điểm của Nghề B có điểm thấp hơn: trung bình 76,7, so với 82,1 của Nghề A; 2 kỹ năng còn dưới ngưỡng.",
    ]);
    // The best fit itself: no comparison.
    const mine = { ...best, isTarget: true };
    const own = targetStanding([mine, { ...target, isTarget: false }], mine);
    expect(own.rank).toBe(1);
    expect(own.belowTop).toBeNull();
    // Nothing scored yet: every skill counts 0.
    const ahead = career("d", "Nghề D", 0, { isTarget: true, requirements: [must("React", "upcoming", null), may("Docker", "upcoming", null)] });
    expect(targetStanding([best, ahead], ahead).belowTop?.reasons).toEqual(["Chưa kỹ năng nào của Nghề D có điểm nên cả 2 kỹ năng đều tính 0 điểm, còn Nghề A đã có 7/8 kỹ năng có điểm."]);
    // A smaller cause under a fifth of the gap is left out.
    // (2 × 62 + 70) / 3 = 64,66 with every skill scored: only the lower scores explain the gap.
    const lowScores = career("e", "Nghề E", 64.66, { isTarget: true, requirements: [must("SQL", "below", 62, { deficit: 18 }), may("Git", "met", 70)] });
    expect(targetStanding([best, lowScores], lowScores).belowTop?.reasons).toEqual(["Các kỹ năng đã có điểm của Nghề E có điểm thấp hơn: trung bình 64,6, so với 82,1 của Nghề A; 1 kỹ năng còn dưới ngưỡng."]);
  });

  it("says how the student stands on each requirement and what is still missing", () => {
    expect(requirementState(req("SQL", "met"))).toEqual({ tone: "pass", glyph: "✓", text: "Đạt ngưỡng" });
    expect(requirementState(req("SQL", "met", { exemptOnly: true }))).toEqual({ tone: "pass", glyph: "✓", text: "Đạt ngưỡng · miễn/công nhận" });
    expect(requirementState(req("SQL", "below", { deficit: 8.25 }))).toEqual({ tone: "fail", glyph: "✗", text: "Dưới ngưỡng · thiếu 8,3 điểm" });
    expect(requirementState(req("SQL", "below", { deficit: 0.04 }))).toEqual({ tone: "fail", glyph: "✗", text: "Dưới ngưỡng · thiếu 0,1 điểm" });
    expect(requirementState(req("SQL", "below", { score: 58.46, deficit: 4.04 }))).toEqual({ tone: "fail", glyph: "✗", text: "Dưới ngưỡng · thiếu 4,1 điểm" });
    expect(requirementState(req("Git", "upcoming", { upcomingTerm: "HK262" }))).toEqual({ tone: "neutral", glyph: "○", text: "Sắp học · HK2 2026–2027" });
    expect(requirementState(req("AWS", "no_data", { noDataReason: "other_specialty" }))).toEqual({ tone: "unknown", glyph: "!", text: "Cần tự học" });
    expect(requirementState(req("AWS", "no_data", { noDataReason: "not_measured" }))).toEqual({ tone: "neutral", glyph: "?", text: "Chưa đủ dữ liệu" });
    expect(requirementState(req("Docker", null))).toEqual({ tone: "neutral", glyph: "?", text: "Chưa tính" });
    // Rounded down to the tenth like every score of the app (user 2026-10-30).
    expect(fitScoreText(50.66)).toBe("50,6");
    expect(fitScoreText(62.73)).toBe("62,7");
    // The courses a score comes from, beside it (user 2026-10-30: "Nên ghi môn làm minh chứng cạnh từng điểm").
    const sources = [{ name: "Thiết kế giao diện", score10: 6.8, letter: "C+" }, { name: "Lập trình web", score10: 6.8, letter: null }, { name: "Đồ án", score10: null, letter: "B" }];
    expect(requirementSourcesText(req("Figma", "met", { score: 68, sources }))).toBe("Từ Thiết kế giao diện (6,8 · C+), Lập trình web (6,8) và 1 học phần khác");
    expect(requirementSourcesText(req("Figma", "met", { score: 68, sources: sources.slice(0, 2) }))).toBe("Từ Thiết kế giao diện (6,8 · C+) và Lập trình web (6,8)");
    expect(requirementSourcesText(req("Figma", "upcoming", { sources }))).toBe("");
    expect(requirementSourcesText(req("Figma", "met", { score: 68 }))).toBe("");
    const mixed = career("y", "Y", 50, { requirements: [req("IAM", "not_studied"), req("Chuỗi khối", "no_data", { noDataReason: "other_specialty" }), req("Bảo mật", "below", { score: 58.5, deficit: 4, isRequired: true })] });
    expect(missingSkills(mixed)).toEqual(["Bảo mật", "IAM", "Chuỗi khối"]);
    expect(orderedRequirements(mixed).map((row) => row.title)).toEqual(["Bảo mật", "IAM", "Chuỗi khối"]);
    expect(fitSummary({ ...mixed, fit: { ...mixed.fit!, met: 0, total: 3, upcoming: 0, noData: 1, summaryText: "Đạt 0/3 kỹ năng · 0 sắp học · 1 chưa đủ dữ liệu", dataText: "2/3 kỹ năng có dữ liệu" } }))
      .toBe("Đạt 0/3 kỹ năng · 1 dưới ngưỡng · 1 chưa học · 1 cần tự học · 1/3 kỹ năng có điểm");
    // Every skill that lowers the fit is missing, "Chưa đủ dữ liệu" too (comp-calc-v14).
    expect(missingSkills(career("x", "X", 50, { requirements: [req("SQL", "below"), req("Git", "met"), req("Docker", "not_studied"), req("AWS", "no_data")] }))).toEqual(["SQL", "Docker", "AWS"]);
    expect(metSkills(career("x", "X", 50, { requirements: [req("SQL", "below"), req("Git", "met"), req("Docker", "not_studied")] }))).toEqual(["Git"]);
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

  it("says why no fit is computed after the assessment results were deleted, and where to assess again", () => {
    expect(blockedText("assessment_withdrawn")).toBe("Bạn đã xóa kết quả đánh giá năng lực và rút lại sự đồng ý, nên EduPath AI không tính mức phù hợp của bạn với từng nghề. Muốn xem lại, hãy bấm Đánh giá năng lực ở trang Đánh giá năng lực.");
    expect(blockedAction("assessment_withdrawn")).toEqual({ href: "#competency", label: "Mở Đánh giá năng lực" });
    expect(blockedAction("specialty_required")).toEqual({ href: "#profile", label: "Mở Hồ sơ và bảng điểm" });
    expect(blockedAction("cohort_unknown")).toBeNull();
  });
});
