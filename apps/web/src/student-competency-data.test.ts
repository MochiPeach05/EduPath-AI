import { describe, expect, it } from "vitest";
import {
  aiStateCopy, bucketSkills, canRegenerate, cleanKeyText, confidentStrengths, countAxis, dataUsedLine, displayLevel, FIT_SCALE, fitLabelOf, fitLevelOf, fitDataShareOf, fitScoreOf, fitStep, gapHistory, levelChart, levelSummary, levelText, overallIsPooled, deficitText, eligibilityDisplay, errorMessage, filterSkills, formatScore,
  careerSummaryText, gapStatusDisplay, groupEvidenceCounts, historySentence, historyYears, isPreconditionError, PRIORITY_LABELS, levelStep, mapAiOutput, missingRequirements, missingRequirementsMessage, modelLabel, needsSelfStudy, plansFor, skillGroupKeys,
  scoreDifference, shouldPoll, sortRequirements, termLabel, EMPTY_SKILL_FILTERS,
  careerThresholdsLine, chartLevelLabel, currentImprovements, LEVEL_SCALE, levelOfScore, withCurrentLevels,
} from "./student-competency-data";
import { fixtureAiOutput, fixtureAssessment, fixtureResult } from "./student-competency.fixture";
import type { CareerRequirementResult } from "./competency-assessment-types";

describe("levels named like the transcript's classification (comp-calc-v10, user 2026-10-22)", () => {
  it("reads a score as the transcript's 4-point classification × 25: Xuất sắc 90, Giỏi 80, Khá 62,5, Trung bình 50, Yếu", () => {
    expect([90, 89.99, 82, 80, 79.99, 62.5, 62.49, 50, 49.99, 0].map(levelOfScore)).toEqual([
      "excellent", "proficient", "proficient", "proficient", "good", "good", "basic", "basic", "needs_work", "needs_work",
    ]);
    expect(LEVEL_SCALE.map((item) => `${item.label} ${item.range}`)).toEqual([
      "Xuất sắc từ 90", "Giỏi 80 đến dưới 90", "Khá 62,5 đến dưới 80", "Trung bình 50 đến dưới 62,5", "Yếu dưới 50",
    ]);
    // Shown whole and rounded down, except from 62,5 to 63: one decimal, so a Khá score never reads 62.
    expect([82.4, 62.97, 62.5, 62.49, 63].map(formatScore)).toEqual(["82", "62,9", "62,5", "62", "63"]);
    // Sắp học, Chưa có điểm and Miễn/công nhận are not levels: they stay named in the chart, not in the scale.
    expect(["upcoming", "no_score", "exempt"].map((code) => chartLevelLabel(code as "upcoming"))).toEqual(["Sắp học", "Chưa có điểm", "Miễn/công nhận"]);
    expect(levelStep("excellent")).toBe(5);
  });
  it("re-reads a result stored on the old scale: 82 was Khá, it is Giỏi", () => {
    const old = { ...fixtureResult, overall: { ...fixtureResult.overall, score: 82, level: "good" as const, levelLabel: "Khá" } };
    const result = withCurrentLevels(old);
    expect([result.overall.level, result.overall.levelLabel]).toEqual(["proficient", "Giỏi"]);
    expect(result.skills.filter((skill) => skill.score !== null).map((skill) => `${skill.key} ${skill.levelLabel}`)).toEqual([
      "S01 Xuất sắc", "S02 Giỏi", "S03 Khá", "S04 Khá", "S06 Khá",
    ]);
    // Skills and groups without a score keep their state; the history, plans and career rows are re-read too.
    expect(result.skills.find((skill) => skill.key === "S05")!.level).toBe("exempt");
    expect(result.groups.map((group) => group.levelLabel)).toEqual(["Khá", "Miễn/công nhận"]);
    expect(result.history!.map((point) => point.overall.levelLabel)).toEqual(["Khá", "Khá", "Khá", "Giỏi", "Khá"]);
    expect(result.skillPlans!.map((plan) => plan.levelLabel)).toEqual(["Trung bình", "Yếu"]);
    expect(result.career!.requirements.map((req) => req.levelLabel)).toEqual(["Xuất sắc", "Khá", "Khá", "Chưa có minh chứng", null]);
    expect(withCurrentLevels(result)).toEqual(result);
    // "Cần củng cố" follows the scale too: Giải thuật (64) was below the old Khá (70), it is Khá now.
    expect(fixtureResult.highlights.improvements).toEqual(["S04"]);
    expect(currentImprovements(result)).toEqual([]);
    expect(currentImprovements({ ...result, skills: result.skills.map((skill) => skill.key === "S04" ? { ...skill, score: 61 } : skill) })).toEqual(["S04"]);
  });
  it("names the career thresholds from the result: Ưu tiên 62,5 is Khá, Bắt buộc 80 Giỏi; an older 70/85 has no level", () => {
    const career = fixtureResult.career!;
    const at = (preferred: number, required: number) => ({ requirements: career.requirements.map((req) => ({ ...req, threshold: req.isRequired ? required : preferred })) });
    expect(careerThresholdsLine(at(62.5, 80))).toBe("Ngưỡng đạt: kỹ năng Ưu tiên từ 62,5 (mức Khá), kỹ năng Bắt buộc từ 80 (mức Giỏi).");
    expect(careerThresholdsLine(at(70, 85))).toBe("Ngưỡng đạt: kỹ năng Ưu tiên từ 70, kỹ năng Bắt buộc từ 85.");
    // A career with Ưu tiên skills only: Bắt buộc is the one of the same version, never a mix (seen 2026-10-22: "70 … 80").
    const preferredOnly = (preferred: number) => ({ requirements: career.requirements.filter((req) => !req.isRequired).map((req) => ({ ...req, threshold: preferred })) });
    expect(careerThresholdsLine(preferredOnly(70))).toBe("Ngưỡng đạt: kỹ năng Ưu tiên từ 70, kỹ năng Bắt buộc từ 85.");
    expect(careerThresholdsLine(preferredOnly(62.5))).toBe("Ngưỡng đạt: kỹ năng Ưu tiên từ 62,5 (mức Khá), kỹ năng Bắt buộc từ 80 (mức Giỏi).");
  });
});

describe("skills without a score: Sắp học or Chưa có điểm (2026-10-21)", () => {
  const s07 = fixtureResult.skills.find((skill) => skill.key === "S07")!;
  const withRole = (role: "studied" | "in_progress" | "planned") => ({ ...s07, evidenceCourses: s07.evidenceCourses.map((row) => ({ ...row, role })) });
  const studied = { ...fixtureResult, skills: fixtureResult.skills.map((skill) => skill.key === "S07" ? withRole("studied") : skill) };
  it("shows Chưa có điểm once a related course was studied without a score, else Sắp học", () => {
    expect(displayLevel(s07)).toBe("upcoming");
    expect(displayLevel(withRole("in_progress"))).toBe("upcoming");
    expect(displayLevel(withRole("studied"))).toBe("no_score");
    expect(displayLevel(fixtureResult.skills.find((skill) => skill.key === "S01")!)).toBe("proficient");
    // Outside the student's choices: no display level, so no level filter shows it.
    expect(displayLevel(fixtureResult.skills.find((skill) => skill.key === "S08")!)).toBeNull();
    expect(filterSkills(fixtureResult.skills, { ...EMPTY_SKILL_FILTERS, level: "upcoming" }).map((skill) => skill.key)).toEqual(["S07"]);
  });
  it("counts, draws, filters and lists the two cases apart", () => {
    expect(levelSummary(studied)[0]!.counts).toMatchObject({ upcoming: 0, no_score: 1 });
    expect(levelChart(studied).bars[0]!.segments.at(-1)).toMatchObject({ level: "no_score", label: "Chưa có điểm", count: 1 });
    expect(filterSkills(studied.skills, { ...EMPTY_SKILL_FILTERS, level: "no_score" }).map((skill) => skill.key)).toEqual(["S07"]);
    expect(bucketSkills(studied, studied.skills).map((bucket) => [bucket.id, bucket.title])).toContainEqual(["no_score", "Chưa có điểm"]);
  });
  it("says Chưa học when no course of the skill is ahead, like Khoảng trống kỹ năng (comp-calc-v16, 2026-10-25)", () => {
    expect(displayLevel({ ...s07, upcoming: true })).toBe("upcoming");
    expect(displayLevel({ ...s07, upcoming: false })).toBe("not_studied");
    // Stored before v16 (no flag): still "Sắp học"; a course studied without a score stays "Chưa có điểm".
    expect(displayLevel({ ...s07, upcoming: undefined })).toBe("upcoming");
    expect(displayLevel({ ...withRole("studied"), upcoming: false })).toBe("no_score");
    const late = { ...fixtureResult, skills: fixtureResult.skills.map((skill) => skill.key === "S07" ? { ...s07, upcoming: false, upcomingTerm: null } : skill) };
    expect(levelSummary(late)[0]!.counts).toMatchObject({ upcoming: 0, not_studied: 1 });
    expect(levelChart(late).bars[0]!.segments.find((segment) => segment.level === "not_studied")).toMatchObject({ label: "Chưa học", count: 1 });
    expect(filterSkills(late.skills, { ...EMPTY_SKILL_FILTERS, level: "not_studied" }).map((skill) => skill.key)).toEqual(["S07"]);
    expect(bucketSkills(late, late.skills).find((bucket) => bucket.id === "not_studied")).toMatchObject({ title: "Chưa học" });
  });
  it("labels a group or the overall without evidence Chưa có điểm", () => {
    expect(levelText("no_evidence", "Chưa có minh chứng")).toBe("Chưa có điểm");
    expect(levelText("good", "Khá")).toBe("Khá");
  });
});

describe("a skill in several competency groups (2026-10-22)", () => {
  // S03 (Thiết kế cơ sở dữ liệu, Khá) also belongs to G2.
  const multi = { ...fixtureResult, skills: fixtureResult.skills.map((skill) => skill.key === "S03" ? { ...skill, groupKeys: ["G1", "G2"] } : skill) };
  const homes = (buckets: ReturnType<typeof bucketSkills>) => buckets.filter((bucket) => bucket.skills.some((skill) => skill.key === "S03")).map((bucket) => bucket.id);
  it("counts the skill in each of its groups", () => {
    const before = groupEvidenceCounts(fixtureResult.skills, "G2");
    expect(groupEvidenceCounts(multi.skills, "G2")).toEqual({ withEvidence: before.withEvidence + 1, total: before.total + 1 });
    expect(groupEvidenceCounts(multi.skills, "G1")).toEqual(groupEvidenceCounts(fixtureResult.skills, "G1"));
    expect(levelSummary(multi)[1]!.counts.good).toBe(levelSummary(fixtureResult)[1]!.counts.good + 1);
    expect(levelChart(multi).bars[1]!.total).toBe(levelChart(fixtureResult).bars[1]!.total + 1);
  });
  it("lists it under each group, or under the filtered group only", () => {
    expect(homes(bucketSkills(multi, multi.skills))).toEqual(["G1", "G2"]);
    expect(homes(bucketSkills(multi, multi.skills, "G2"))).toEqual(["G2"]);
    expect(filterSkills(multi.skills, { ...EMPTY_SKILL_FILTERS, group: "G2" }).map((skill) => skill.key)).toContain("S03");
    // A result stored before has no groupKeys: the skill keeps its one group.
    expect(skillGroupKeys(fixtureResult.skills[2]!)).toEqual(["G1"]);
  });
});

describe("fit scale (2026-10-22: a 0–100 điểm phù hợp on the bounds of the competency levels)", () => {
  type Req = Pick<CareerRequirementResult, "status" | "score" | "coefficient">;
  const req = (status: Req["status"], score: number | null, coefficient = 1): Req => ({ status, score, coefficient });
  const one = (score: number, upcoming = 0) => ({ requirements: [req("met", score), ...(upcoming ? [req("upcoming", null, upcoming)] : [])] as CareerRequirementResult[] });
  it("averages the career's skills: Bắt buộc twice, 0 without a score (Sắp học too, v15), exempt-only left out", () => {
    // The student's case: every measured skill met, 92 on average → 92, not 100%.
    expect(fitScoreOf([req("met", 95, 2), req("met", 90), req("met", 89)])).toBe(92.25);
    // A Sắp học skill counts 0 (v15, 2026-10-25: "sắp học là 0 luôn đi"): 369 / 5.
    expect(fitScoreOf([req("met", 95, 2), req("met", 90), req("met", 89), req("upcoming", null)])).toBe(73.8);
    // Not studied and no data both count 0 (comp-calc-v14, "Tính đủ mọi kỹ năng"): (2 × 90 + 50) / 5.
    expect(fitScoreOf([req("met", 90, 2), req("below", 50), req("not_studied", null), req("no_data", null)])).toBe(46);
    // The user's case (2026-10-24): 0/4 met → 152 / 6 = 25,33, not 50,66 "Ít phù hợp".
    expect(fitScoreOf([req("below", 76, 2), req("no_data", null, 2), req("not_studied", null), req("no_data", null)])).toBe(25.33);
    expect(fitDataShareOf([req("met", 80, 2), req("upcoming", null, 2), req("no_data", null)])).toBe(1);
    expect(fitScoreOf([req("met", null), req("upcoming", null)])).toBe(0);
    expect(fitScoreOf([req("met", null)])).toBeNull();
    // Read from the stored requirements (91, 75, 64,4, Kiểm thử Sắp học and Docker without data as 0; Bắt buộc twice),
    // whatever fit was stored: 396,4 / 7.
    expect(fitScoreOf(fixtureResult.career!.requirements)).toBe(56.62);
  });
  it("lists the five fit levels with their bands in points", () => {
    // Only the levels: "Chưa đủ dữ liệu" is no level, like Sắp học on the competency scale.
    expect(FIT_SCALE.map((item) => [item.code, item.label, item.range])).toEqual([
      ["very_fit", "Rất phù hợp", "từ 90"], ["fit", "Phù hợp", "80 đến dưới 90"], ["average", "Trung bình", "62,5 đến dưới 80"],
      ["low_fit", "Ít phù hợp", "50 đến dưới 62,5"], ["not_fit", "Không phù hợp", "dưới 50"],
    ]);
    // The engine's fitCodeOf bounds (90/80/62,5/50) on the điểm phù hợp.
    expect([90, 89.99, 80, 79.99, 62.5, 62.49, 50, 49.99, 0].map((score) => fitLevelOf(one(score))))
      .toEqual(["very_fit", "fit", "fit", "average", "average", "low_fit", "low_fit", "not_fit", "not_fit"]);
    // Sắp học counts 0 (v15): 100 / 3 and 100 / 2; "Chưa đủ dữ liệu" only without a skill to count.
    expect([fitLevelOf(one(100, 2)), fitLevelOf(one(100, 1)), fitLevelOf({ requirements: [] })])
      .toEqual(["not_fit", "low_fit", "insufficient_data"]);
    expect((["very_fit", "fit", "average", "low_fit", "not_fit", "insufficient_data"] as const).map(fitStep)).toEqual([5, 4, 3, 2, 1, 0]);
    // A result stored with the earlier labels (Khá phù hợp, 0,58) reads the current scale: 56,62 is Ít phù hợp.
    expect(fitLabelOf(fixtureResult.career!)).toBe("Ít phù hợp");
  });
});

describe("strengths (2026-10-21)", () => {
  it("only names skills with at least medium confidence, also in results stored before the rule", () => {
    const skills = fixtureResult.skills.slice(0, 3).map((skill, index) => ({ ...skill, confidence: (["low", "medium", "high"] as const)[index] }));
    const result = { ...fixtureResult, skills, highlights: { ...fixtureResult.highlights, strengths: skills.map((skill) => skill.key) } };
    expect(confidentStrengths(result)).toEqual([skills[1]!.key, skills[2]!.key]);
  });
});

describe("career skills by term (STU-GAP-07)", () => {
  it("lists every career skill per term with the change since its first score and a one-line summary", () => {
    const history = gapHistory(fixtureResult);
    expect(history?.state).toBe("ready");
    if (history?.state !== "ready") return;
    // Bắt buộc first, then the largest shortfall first, as in the detailed report.
    expect(history.rows.map((row) => [row.name, row.cells.map((cell) => cell.score), row.change])).toEqual([
      ["Thiết kế cơ sở dữ liệu", [null, 66, 70, 74, 75], 9],
      ["Lập trình web", [72, 80, 86, 89, 91], 19],
      ["Giải thuật", [null, null, 58, 62, 64], 6],
      ["Kiểm thử tự động", [null, null, null, null, null], null],
      ["Docker", [null, null, null, null, null], null],
    ]);
    expect(history.sentence).toBe("Từ học kỳ 1 năm học 2023–2024 đến học kỳ 2 năm học 2025–2026, số kỹ năng nghề đạt ngưỡng tăng từ 0 lên 1/5. Tăng nhiều nhất: Lập trình web (+19 điểm).");
  });
  it("asks for a new assessment when the history predates it, and is absent without a career", () => {
    const old = { ...fixtureResult, history: fixtureResult.history!.map(({ career: _career, ...point }) => point) };
    expect(gapHistory(old)).toEqual({ state: "outdated" });
    expect(gapHistory({ ...fixtureResult, history: [] })).toEqual({ state: "empty" });
    expect(gapHistory({ ...fixtureResult, career: null })).toBeNull();
  });
});

describe("level chart", () => {
  it("draws a clean count axis of at most five steps", () => {
    expect(countAxis(49)).toEqual({ max: 50, ticks: [0, 10, 20, 30, 40, 50] });
    expect(countAxis(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(countAxis(5)).toEqual({ max: 5, ticks: [0, 1, 2, 3, 4, 5] });
    expect(countAxis(81)).toEqual({ max: 100, ticks: [0, 20, 40, 60, 80, 100] });
    expect(countAxis(0)).toEqual({ max: 1, ticks: [0, 1] });
  });
  it("stacks each group's skills by level on one axis, counted like the group line", () => {
    const { axis, bars } = levelChart(fixtureResult);
    expect(axis.max).toBe(5);
    // G1 as stored (before comp-calc-v10): S01, S02 proficient · S03 good · S04 basic · S07 Sắp học; S08 is outside the student's choices.
    const [g1, g2] = bars;
    expect(g1!.total).toBe(5);
    expect(g1!.segments.map((segment) => [segment.level, segment.count, segment.start, segment.end])).toEqual([
      ["proficient", 2, 0, 0.4], ["good", 1, 0.4, 0.6], ["basic", 1, 0.6, 0.8], ["upcoming", 1, 0.8, 1],
    ]);
    expect(g1!.segments[0]!.skills.map((skill) => skill.name)).toEqual(["Lập trình web", "Lập trình hướng đối tượng"]);
    expect(g1!.segments[0]!.share).toBe(0.4);
    // G2: the exempt skill is its own segment, so the bar adds up to the group's skills; the condition-only one is left out.
    expect(g2!.total).toBe(1);
    expect(g2!.segments.map((segment) => [segment.level, segment.label, segment.count])).toEqual([["exempt", "Miễn/công nhận", 1]]);
  });
});

describe("polling and AI actions", () => {
  it("polls only while the AI comment can still change", () => {
    expect(shouldPoll("queued")).toBe(true);
    expect(shouldPoll("processing")).toBe(true);
    for (const status of ["disabled", "deferred", "completed", "failed", "cancelled", null] as const) expect(shouldPoll(status)).toBe(false);
  });
  it("offers regeneration for failed, cancelled, deferred and disabled-once-enabled", () => {
    expect(canRegenerate("failed", false)).toBe(true);
    expect(canRegenerate("cancelled", false)).toBe(true);
    expect(canRegenerate("deferred", false)).toBe(true);
    expect(canRegenerate("disabled", false)).toBe(false);
    expect(canRegenerate("disabled", true)).toBe(true);
    expect(canRegenerate("completed", true)).toBe(false);
    expect(canRegenerate("queued", true)).toBe(false);
  });
  it("tells a waiting queue apart from an offline worker", () => {
    expect(aiStateCopy("queued", true, true).title).toBe("Đang xếp hàng tạo nhận xét");
    expect(aiStateCopy("queued", false, true).title).toBe("Đang chờ máy AI kết nối");
    expect(aiStateCopy("disabled", false, false).title).toBe("Nhận xét AI chưa được bật");
  });
  it("names the local model", () => {
    expect(modelLabel("gemma4:e4b")).toBe("Gemma 4 E4B");
    expect(modelLabel(null)).toBe("Gemma 4 E4B");
    expect(modelLabel("other-model")).toBe("other-model");
  });
});

describe("errors", () => {
  it("separates precondition errors from failures and maps codes to Vietnamese", () => {
    expect(isPreconditionError("competency_weights_unavailable")).toBe(true);
    expect(isPreconditionError("transcript_required")).toBe(true);
    expect(isPreconditionError("career_required")).toBe(true);
    expect(isPreconditionError("specialty_required")).toBe(true);
    expect(isPreconditionError("assessment_too_frequent")).toBe(false);
    expect(isPreconditionError(undefined)).toBe(false);
    expect(errorMessage("assessment_too_frequent")).toContain("một phút");
    expect(errorMessage("unknown_code")).toBe("Thao tác chưa thành công. Vui lòng thử lại.");
  });
  it("asks for all three of the checklist before an assessment (2026-10-21)", () => {
    expect(missingRequirements(true, { careerPositionId: "career-1", specialty: "CNPM" })).toEqual([]);
    expect(missingRequirements(false, { careerPositionId: null, specialty: null })).toEqual(["bảng điểm", "nghề mục tiêu", "chuyên ngành"]);
    expect(missingRequirementsMessage(["nghề mục tiêu", "chuyên ngành"]))
      .toBe("Cần đủ bảng điểm, nghề mục tiêu và chuyên ngành để đánh giá năng lực. Hãy bổ sung nghề mục tiêu và chuyên ngành rồi bấm lại.");
    expect(missingRequirementsMessage(["bảng điểm", "nghề mục tiêu", "chuyên ngành"])).toContain("bổ sung bảng điểm, nghề mục tiêu và chuyên ngành rồi");
    // Values not known yet (loading, an older API without the specialty) are left to the server.
    expect(missingRequirements(null, null)).toEqual([]);
    expect(missingRequirements(true, { careerPositionId: "career-1" })).toEqual([]);
  });
});

describe("formatting", () => {
  it("shows whole scores rounded down so a shown score never crosses a threshold", () => {
    expect(formatScore(86.6)).toBe("86");
    expect(formatScore(84.6)).toBe("84");
    expect(formatScore(69.5)).toBe("69");
    expect(formatScore(85)).toBe("85");
    expect(formatScore(84.99999999999)).toBe("85");
    expect(formatScore(null)).toBe("—");
    expect(termLabel("HK253")).toBe("HK3 · 2025–2026");
    expect(termLabel(null)).toBe("Chưa xếp lịch");
  });
  it("maps levels to the four ramp steps", () => {
    expect([levelStep("proficient"), levelStep("good"), levelStep("basic"), levelStep("needs_work"), levelStep("no_evidence"), levelStep("exempt")]).toEqual([4, 3, 2, 1, 0, 0]);
  });
  it("never says 'thiếu 0 điểm'", () => {
    expect(deficitText(0.3)).toBe("Dưới ngưỡng · thiếu 1 điểm");
    expect(deficitText(5.6)).toBe("Dưới ngưỡng · thiếu 6 điểm");
    expect(deficitText(5)).toBe("Dưới ngưỡng · thiếu 5 điểm");
    expect(deficitText(null)).toBe("Dưới ngưỡng");
  });
  it("summarises the data used", () => {
    const line = dataUsedLine(fixtureAssessment());
    expect(line).not.toContain("phiên bản");
    expect(line).toContain("khóa K29");
    expect(line).toContain("bảng điểm 8 học phần đến HK252");
  });
});

describe("career gaps", () => {
  const reqs = fixtureResult.career!.requirements;
  it("uses green/red only for met and below, neutral for upcoming and missing data", () => {
    const byStatus = (status: CareerRequirementResult["status"]) => gapStatusDisplay(reqs.find((req) => req.status === status)!);
    expect(byStatus("met")).toEqual({ tone: "pass", glyph: "✓", text: "Đạt ngưỡng" });
    expect(byStatus("below").tone).toBe("fail");
    expect(byStatus("upcoming")).toEqual({ tone: "neutral", glyph: "○", text: "Sắp học · HK261" });
    expect(byStatus("no_data")).toEqual({ tone: "neutral", glyph: "?", text: "Chưa đủ dữ liệu" });
    expect(gapStatusDisplay({ status: "not_studied", deficit: null, upcomingTerm: null, exemptOnly: false }).tone).toBe("unknown");
  });
  it("names a skill only another specialty's courses teach Cần tự học and counts it apart (user 2026-10-23)", () => {
    const career = fixtureResult.career!;
    const other = { ...reqs.find((req) => req.status === "no_data")!, noDataReason: "other_specialty" as const };
    expect(gapStatusDisplay(other)).toEqual({ tone: "unknown", glyph: "!", text: "Cần tự học" });
    expect(needsSelfStudy(other)).toBe(true);
    expect(needsSelfStudy({ ...other, noDataReason: "not_measured" })).toBe(false);
    expect(careerSummaryText(career)).toBe(career.summaryText);
    expect(careerSummaryText({ ...career, requirements: career.requirements.map((req) => (req.status === "no_data" ? other : req)) }))
      .toBe("Đạt 1/5 kỹ năng · 1 sắp học · 1 cần tự học · 0 chưa đủ dữ liệu");
  });
  it("sorts Bắt buộc first, then the largest shortfall", () => {
    expect(sortRequirements(reqs).map((req) => req.requirementId)).toEqual(["q2", "q1", "q3", "q4", "q5"]);
  });
  it("describes prerequisite states", () => {
    expect(eligibilityDisplay("eligible", []).glyph).toBe("✓");
    expect(eligibilityDisplay("not_eligible", [{ code: "X1", name: "Môn X" }]).text).toBe("Cần học trước Môn X (X1)");
    expect(eligibilityDisplay("review", []).glyph).toBe("?");
  });
});

describe("skills", () => {
  it("filters by group, career skills, needs-work and accent-insensitive search", () => {
    expect(filterSkills(fixtureResult.skills, { ...EMPTY_SKILL_FILTERS, careerOnly: true }).map((s) => s.key)).toEqual(["S01", "S03", "S04", "S07"]);
    expect(filterSkills(fixtureResult.skills, { ...EMPTY_SKILL_FILTERS, needsWork: true }).map((s) => s.key)).toEqual(["S04"]);
    expect(filterSkills(fixtureResult.skills, { ...EMPTY_SKILL_FILTERS, search: "giai thuat" }).map((s) => s.key)).toEqual(["S04"]);
    expect(filterSkills(fixtureResult.skills, { ...EMPTY_SKILL_FILTERS, group: "G2" }).map((s) => s.key)).toEqual(["S05", "S06"]);
  });
  it("keeps condition-only, not-applicable and unscored skills out of the engine groups, Sắp học last", () => {
    const buckets = bucketSkills(fixtureResult, fixtureResult.skills);
    expect(buckets.map((b) => [b.id, b.skills.map((s) => s.key)])).toEqual([
      ["G1", ["S01", "S02", "S03", "S04"]], ["G2", ["S05"]], ["condition", ["S06"]], ["not-applicable", ["S08"]], ["upcoming", ["S07"]],
    ]);
    expect(buckets.at(-1)!.note).toContain("Không phải điểm yếu");
  });
  it("counts a group's skills with the overall rule, whatever a stored skillCount says", () => {
    // Regression: "49/65" next to an overall "62/66" — not-applicable skills (S08) are not in the denominator.
    // fixtureResult's G1 skillCount (6) is the pre-comp-calc-v3 value that still counted S08.
    expect(groupEvidenceCounts(fixtureResult.skills, "G1")).toEqual({ withEvidence: 4, total: 5 });
    // S06 is condition-only and S05 exempt-only (counts as evidence).
    expect(groupEvidenceCounts(fixtureResult.skills, "G2")).toEqual({ withEvidence: 1, total: 1 });
    const sum = fixtureResult.groups.map((group) => groupEvidenceCounts(fixtureResult.skills, group.key))
      .reduce((total, counts) => ({ withEvidence: total.withEvidence + counts.withEvidence, total: total.total + counts.total }), { withEvidence: 0, total: 0 });
    const counted = fixtureResult.skills.filter((skill) => !skill.conditionOnly && skill.status !== "not_applicable");
    expect(sum).toEqual({ withEvidence: counted.filter((skill) => skill.status === "scored" || skill.status === "exempt_only").length, total: counted.length });
    // The group rows add up to the overall "Dựa trên x/y kỹ năng" line.
    expect(sum).toEqual({ withEvidence: fixtureResult.overall.basis.skillsWithEvidence, total: fixtureResult.overall.basis.applicableSkills });
  });
});

describe("history (STU-COMP-07)", () => {
  const point = (term: string, schoolYear: string, semester: number, score: number | null) => ({
    term, schoolYear, semester, gradedCourses: semester * 3,
    overall: { score, level: "good" as const, levelLabel: "Khá", skillsWithEvidence: 1, applicableSkills: 2 }, groups: [],
  });
  it("groups the terms by school year with whole-point changes and the newest term marked", () => {
    const years = historyYears([point("HK231", "2023–2024", 1, 70.9), point("HK232", "2023–2024", 2, null), point("HK233", "2023–2024", 3, 72.2), point("HK241", "2024–2025", 1, 71.99)]);
    expect(years.map((year) => [year.schoolYear, year.rows.map((row) => row.change), year.end.term])).toEqual([
      // 70,9 → shown 70; a term without a score breaks nothing; 72,2 → 72: +2; 71,99 → 71: −1.
      ["2023–2024", [null, null, 2], "HK233"], ["2024–2025", [-1], "HK241"],
    ]);
    expect(years.flatMap((year) => year.rows).filter((row) => row.latest).map((row) => row.term)).toEqual(["HK241"]);
    expect(historyYears([])).toEqual([]);
  });
  it("says the trend in one sentence, with the peak only when it stands out", () => {
    expect(historySentence([point("HK231", "2023–2024", 1, 68.5), point("HK242", "2024–2025", 2, 81), point("HK252", "2025–2026", 2, 79.4)]))
      .toBe("Điểm năng lực tổng tăng từ 68 (học kỳ 1 năm học 2023–2024) lên 79 (học kỳ 2 năm học 2025–2026). Cao nhất là 81 vào học kỳ 2 năm học 2024–2025.");
    expect(historySentence([point("HK231", "2023–2024", 1, 80), point("HK232", "2023–2024", 2, 76.5)]))
      .toBe("Điểm năng lực tổng giảm từ 80 (học kỳ 1 năm học 2023–2024) xuống 76 (học kỳ 2 năm học 2023–2024).");
    expect(historySentence([point("HK231", "2023–2024", 1, 75.2), point("HK232", "2023–2024", 2, 75.9)]))
      .toBe("Điểm năng lực tổng giữ ở mức 75 từ học kỳ 1 năm học 2023–2024 đến học kỳ 2 năm học 2023–2024.");
    expect(historySentence([point("HK231", "2023–2024", 1, 75)])).toBeNull();
  });
});

describe("course plans", () => {
  it("keeps only the target career's plans once a career is chosen", () => {
    const plans = fixtureResult.skillPlans!;
    expect(plansFor(fixtureResult)).toEqual([]);
    expect(plansFor({ ...fixtureResult, career: null }).map((plan) => plan.skillKey)).toEqual(plans.map((plan) => plan.skillKey));
    const deepen = { ...plans[0]!, purpose: "deepen" as const };
    expect(plansFor({ ...fixtureResult, skillPlans: [deepen, plans[1]!] })).toEqual([deepen]);
    expect(plansFor({ ...fixtureResult, skillPlans: undefined })).toEqual([]);
  });
});

describe("scoreDifference", () => {
  it("agrees with the shown score and the deficit", () => {
    // 84,6 shows as 84 against 85: the difference is -1 and the status says 'thiếu 1 điểm'.
    expect(scoreDifference({ score: 84.6, status: "below", deficit: 0.4, threshold: 85 })).toBe(-1);
    expect(scoreDifference({ score: 64.4, status: "below", deficit: 5.6, threshold: 70 })).toBe(-6);
    expect(scoreDifference({ score: 91.7, status: "met", deficit: null, threshold: 85 })).toBe(6);
    expect(scoreDifference({ score: 85, status: "met", deficit: null, threshold: 85 })).toBe(0);
    expect(scoreDifference({ score: null, status: "not_studied", deficit: null, threshold: 85 })).toBeNull();
    expect(scoreDifference({ score: 50, status: "upcoming", deficit: null, threshold: 70 })).toBeNull();
  });
});

describe("cleanKeyText", () => {
  const names = new Map([["S12", "API"], ["S03", "Kiểm thử phần mềm"], ["S07", "C#"], ["G1", "Chuyên môn"], ["G2", "Kỹ năng mềm"]]);
  it("drops a key written next to its own name instead of repeating the name", () => {
    // Regression: "(API - S12)" used to become "(API - API)".
    expect(cleanKeyText("Khả năng tích hợp (API - S12) của bạn rất tốt.", names)).toBe("Khả năng tích hợp (API) của bạn rất tốt.");
    expect(cleanKeyText("API (S12) đạt mức Giỏi.", names)).toBe("API đạt mức Giỏi.");
    expect(cleanKeyText("S12 - API đạt mức Giỏi.", names)).toBe("API đạt mức Giỏi.");
    expect(cleanKeyText("Ôn (S12: API) và S12 (API).", names)).toBe("Ôn (API) và API.");
    expect(cleanKeyText("Kiểm thử phần mềm (S03), Lập trình C# (S07).", names)).toBe("Kiểm thử phần mềm, Lập trình C#.");
    expect(cleanKeyText("Nhóm Chuyên môn (G1) và nhóm G2 - Kỹ năng mềm.", names)).toBe("Nhóm Chuyên môn và nhóm Kỹ năng mềm.");
  });
  it("replaces a bare key elsewhere, drops a bracketed one and keeps unknown keys", () => {
    expect(cleanKeyText("Bạn nên luyện kỹ năng S12 và nhóm G1.", names)).toBe("Bạn nên luyện kỹ năng API và nhóm Chuyên môn.");
    expect(cleanKeyText("Kỹ năng kiểm thử (S03) cần thêm sản phẩm.", names)).toBe("Kỹ năng kiểm thử cần thêm sản phẩm.");
    expect(cleanKeyText("Mã S99, G9 và S120 giữ nguyên.", names)).toBe("Mã S99, G9 và S120 giữ nguyên.");
    expect(cleanKeyText("Không có khóa nào, 2 / 4 kỹ năng.", names)).toBe("Không có khóa nào, 2 / 4 kỹ năng.");
  });
});

describe("mapAiOutput", () => {
  it("replaces internal keys written in prose with names", () => {
    const mapped = mapAiOutput({
      ...fixtureAiOutput,
      summary: "Bạn mạnh ở Lập trình web (S01) và nhóm G1; kỹ năng S04 cần ôn. Mã S99 (S99) giữ nguyên.",
      nextSteps: ["Luyện thêm kỹ năng S03.", "Ôn Giải thuật (S04).", "Làm dự án."],
    }, fixtureResult)!;
    expect(mapped.summary).toBe("Bạn mạnh ở Lập trình web và nhóm Kiến thức chuyên môn; kỹ năng Giải thuật cần ôn. Mã S99 (S99) giữ nguyên.");
    expect(mapped.nextSteps).toEqual(["Luyện thêm kỹ năng Thiết kế cơ sở dữ liệu.", "Ôn Giải thuật.", "Làm dự án."]);
  });
  it("never shows a weak or below-threshold skill as a strength", () => {
    const mapped = mapAiOutput({
      ...fixtureAiOutput,
      strengths: [
        { skillKey: "S01", comment: "Tốt." },
        { skillKey: "S03", comment: "Dưới ngưỡng nghề nhưng bị nêu là điểm mạnh." },
        { skillKey: "S04", comment: "Cũng nằm trong mục cần cải thiện." },
      ],
    }, fixtureResult)!;
    expect(mapped.strengths.map((item) => item.key)).toEqual(["S01"]);
  });
  it("maps keys to names and drops what cannot be mapped", () => {
    const mapped = mapAiOutput(fixtureAiOutput, fixtureResult)!;
    expect(mapped.groupInsights.map((g) => g.name)).toEqual(["Kiến thức chuyên môn"]);
    expect(mapped.strengths[0]).toMatchObject({ key: "S01", name: "Lập trình web" });
    expect(mapped.gaps[0].courses).toEqual([{ code: "TST105", name: "Kiểm thử phần mềm", reason: "Đo trực tiếp kỹ năng kiểm thử." }]);
    expect(mapped.gaps[1]).toMatchObject({ key: "S09", name: "Docker" });
    expect(mapped.nextSteps).toHaveLength(3);
  });
  it("labels AI priorities apart from the career property 'Ưu tiên'", () => {
    expect(PRIORITY_LABELS).toEqual({ high: "Cần làm sớm", medium: "Nên làm", low: "Có thể để sau" });
    for (const label of Object.values(PRIORITY_LABELS)) expect(label).not.toMatch(/Ưu tiên/);
  });
  it("survives missing or malformed fields", () => {
    expect(mapAiOutput(null, fixtureResult)).toBeNull();
    const mapped = mapAiOutput({ summary: "Tóm tắt", strengths: "x", improvements: [{ skillKey: "S99", priority: "high", comment: "?" }] } as never, fixtureResult)!;
    expect(mapped.summary).toBe("Tóm tắt");
    expect(mapped.strengths).toEqual([]);
    expect(mapped.improvements).toEqual([]);
    expect(mapped.careerFit).toBe("");
  });
});

describe("overall method", () => {
  it("tells a pooled overall (comp-calc-v12) from the mean of the groups before", () => {
    expect(overallIsPooled("comp-calc-v12")).toBe(true);
    expect(overallIsPooled("comp-calc-v13")).toBe(true);
    expect(overallIsPooled("comp-calc-v11")).toBe(false);
    expect(overallIsPooled("comp-calc-v9")).toBe(false);
  });
});
