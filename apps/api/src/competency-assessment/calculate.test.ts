import { describe, expect, it } from "vitest";
import type { TranscriptData } from "../student/transcript-parser.js";
import {
  calculateAssessment, careerDataTextOf, careerSummaryOf, compareSkills, confidenceOf, deficitBand, fitCredit, floorScore, levelOf, snapScore, termParts,
} from "./calculate.js";
import { CALC_VERSION, fitCodeOf, fitDataShareOf, fitScoreOf, MAX_SKILL_PLANS } from "./constants.js";
import {
  SKILL, syntheticCareer, syntheticInputs, syntheticStudentTerms, syntheticTranscript, type SyntheticOptions, type TranscriptRow, type TranscriptTerm,
} from "./fixtures/synthetic-k29.js";
import type { AssessmentInputs, AssessmentResult, CareerInput, HistoryPoint, SpecialtyCode } from "./types.js";

/** The overall rebuilt from a result: every skill once, Σ score × credits × weight / Σ credits × weight (comp-calc-v12). */
const pooledOverall = (result: AssessmentResult) => {
  const courses = new Map(result.courses.map((course) => [course.code, course]));
  let num = 0, den = 0;
  for (const skill of result.skills) for (const row of skill.evidenceCourses) {
    const course = courses.get(row.code)!;
    if (course.conditionOnly || course.score10 === null) continue;
    num += course.score10 * row.contribution;
    den += row.contribution;
  }
  return floorScore(snapScore(10 * num / den));
};
const byName = (result: AssessmentResult, name: string) => {
  const skill = result.skills.find((item) => item.name === name);
  if (!skill) throw new Error(`skill ${name} missing`);
  return skill;
};
const career = (requirements: [string, boolean][], extra: Partial<CareerInput> = {}): CareerInput => {
  const base = syntheticCareer();
  const names = new Map(base.requirements.map((item) => [item.skillId, item.skillName]));
  const skillNames: Record<string, string> = {
    [SKILL.mobile]: "Lập trình di động", [SKILL.machineLearning]: "Học máy nhập môn", [SKILL.presenting]: "Thuyết trình",
    [SKILL.bigData]: "Phân tích dữ liệu lớn", [SKILL.csharp]: "Lập trình C#", [SKILL.teamwork]: "Làm việc nhóm",
  };
  return {
    ...base, ...extra,
    requirements: requirements.map(([skillId, isRequired], index) => {
      const name = names.get(skillId) ?? skillNames[skillId] ?? "Kỹ năng";
      return { id: `00000000-0000-4000-8000-00000000d1${String(index).padStart(2, "0")}`, skillId, skillName: name, title: name, isRequired };
    }),
  };
};
const mapTerms = (map: (row: TranscriptTerm["rows"][number]) => TranscriptTerm["rows"][number]) =>
  syntheticStudentTerms().map((term) => ({ ...term, rows: term.rows.map(map) }));
/** The synthetic terms with rows added to one term: 5 = HK243 (graded), 6 = HK251 (registered, no grades). */
const withRows = (termIndex: number, rows: TranscriptTerm["rows"]) =>
  syntheticStudentTerms().map((term, index) => (index === termIndex ? { ...term, rows: [...term.rows, ...rows] } : term));

describe("a skill in several competency groups (2026-10-22)", () => {
  const base = syntheticInputs();
  const before = calculateAssessment(base);
  // A scored skill and a group it is not in.
  const moved = before.skills.find((skill) => skill.status === "scored" && !skill.conditionOnly)!;
  const other = before.groups.find((group) => group.id !== moved.groupId)!;
  const withOtherGroups = (otherGroupIds: string[]): AssessmentInputs => ({ ...base, weights: { ...base.weights,
    skills: base.weights.skills.map((skill) => (skill.skillId === moved.skillId ? { ...skill, otherGroupIds } : skill)) } });
  const groupOf = (result: AssessmentResult, id: string) => result.groups.find((group) => group.id === id)!;

  it("counts the skill in each of its groups, and the overall coverage and evidence once", () => {
    const after = calculateAssessment(withOtherGroups([other.id]));
    const skill = after.skills.find((item) => item.skillId === moved.skillId)!;
    expect(skill.groupKey).toBe(moved.groupKey);
    expect(skill.groupKeys).toEqual(before.groups.filter((group) => [moved.groupId, other.id].includes(group.id)).map((group) => group.key));
    expect(groupOf(after, other.id).skillCount).toBe(groupOf(before, other.id).skillCount + 1);
    expect(groupOf(after, other.id).evidence).toBeGreaterThan(groupOf(before, other.id).evidence);
    expect(groupOf(after, moved.groupId)).toEqual(groupOf(before, moved.groupId));
    expect(after.overall.basis).toEqual(before.overall.basis);
    expect([after.overall.score, after.overall.coverage, after.overall.evidence]).toEqual([before.overall.score, before.overall.coverage, before.overall.evidence]);
    expect(after.skills.filter((item) => item.skillId !== moved.skillId).every((item) => item.groupKeys.join() === item.groupKey)).toBe(true);
  });

  it("ignores another group that is not active", () => {
    const after = calculateAssessment(withOtherGroups(["00000000-0000-4000-8000-00000000ffff"]));
    expect(after.groups).toEqual(before.groups);
    expect(after.skills.find((item) => item.skillId === moved.skillId)!.groupKeys).toEqual([moved.groupKey]);
  });
});

describe("formula helpers (spec §7.3, §7.5, §7.6)", () => {
  it("removes float noise and stores scores rounded down, so the shown whole number never passes a level", () => {
    expect(snapScore(84.99999999999999)).toBe(85);
    expect(snapScore(72.375)).toBe(72.375);
    expect(floorScore(84.996)).toBe(84.99);
    expect(floorScore(85)).toBe(85);
    expect(floorScore(70.1)).toBe(70.1);
    expect(floorScore(72.375)).toBe(72.37);
    expect(floorScore(89.996)).toBe(89.99);
    expect(levelOf(89.996)).toBe("proficient");
  });

  it("classifies levels on unrounded scores", () => {
    // comp-calc-v10: the transcript's 4-point classification × 25 (user, 2026-10-22).
    expect(levelOf(90)).toBe("excellent");
    expect(levelOf(89.999)).toBe("proficient");
    expect(levelOf(80)).toBe("proficient");
    expect(levelOf(79.999)).toBe("good");
    expect(levelOf(62.5)).toBe("good");
    expect(levelOf(62.49)).toBe("basic");
    expect(levelOf(49.99)).toBe("needs_work");
    expect(levelOf(null)).toBe("no_evidence");
    expect(levelOf(null, true)).toBe("exempt");
  });

  it("takes confidence as the lower of the coverage and evidence bands", () => {
    expect(confidenceOf(1, 0.9)).toBe("low");
    expect(confidenceOf(1, 1)).toBe("medium");
    expect(confidenceOf(0.7, 2.5)).toBe("high");
    expect(confidenceOf(0.69, 10)).toBe("medium");
    expect(confidenceOf(0.29, 10)).toBe("low");
    expect(confidenceOf(null, 10)).toBe("low");
  });

  it("bands deficits", () => {
    expect([deficitBand(5), deficitBand(5.01), deficitBand(15), deficitBand(15.5)]).toEqual(["near", "moderate", "moderate", "large"]);
  });

  it("scores requirements: met 1, below 0.5·clamp((s−40)/(thr−40)), not studied 0, upcoming/no data excluded", () => {
    expect(fitCredit("met", 90, 85)).toBe(1);
    expect(fitCredit("below", 55, 70)).toBeCloseTo(0.25);
    expect(fitCredit("below", 30, 70)).toBe(0);
    expect(fitCredit("below", 84.99, 85)).toBeLessThan(0.5);
    expect(fitCredit("not_studied", null, 70)).toBe(0);
    expect(fitCredit("upcoming", null, 70)).toBeNull();
    expect(fitCredit("no_data", null, 70)).toBeNull();
    // "Điểm phù hợp" on the bounds of the competency levels (2026-10-22): 90/80/62,5/50; a value a hair under a bound from float noise still reaches it.
    expect([90, 89.99, 80, 79.99, 62.5, 62.49, 50, 49.99, 0, 90 - 1e-12].map((score) => fitCodeOf(score, 1)))
      .toEqual(["very_fit", "fit", "fit", "average", "average", "low_fit", "low_fit", "not_fit", "not_fit", "very_fit"]);
    expect([fitCodeOf(100, 0.49), fitCodeOf(100, 0.5), fitCodeOf(null, 1)]).toEqual(["insufficient_data", "very_fit", "insufficient_data"]);
  });

  it("averages the career's skills into a 0–100 điểm phù hợp: Bắt buộc twice, 0 without a score, Sắp học too (comp-calc-v11, v14, v15)", () => {
    const req = (status: "met" | "below" | "not_studied" | "upcoming" | "no_data", score: number | null, coefficient = 1) => ({ status, score, coefficient });
    // The student's case (2026-10-22): every measured skill met, scored 92 on average → 92, not 100%.
    expect(fitScoreOf([req("met", 95, 2), req("met", 90), req("met", 89)])).toBe(92.25);
    // A Sắp học skill counts 0 (v15, 2026-10-25: "sắp học là 0 luôn đi"): 369 / 5.
    expect(fitScoreOf([req("met", 95, 2), req("met", 90), req("met", 89), req("upcoming", null)])).toBe(73.8);
    // Not studied and no data both count 0 (v14: "Tính đủ mọi kỹ năng"): (2 × 90 + 50 + 0 + 0) / 5.
    expect(fitScoreOf([req("met", 90, 2), req("below", 50), req("not_studied", null), req("no_data", null)])).toBe(46);
    // The user's case (2026-10-24): 0/4 met, Bắt buộc 76 below, a Bắt buộc and an Ưu tiên without data, an Ưu tiên not
    // studied: 152 / 6 = 25,33 (it was 152 / 3 = 50,66 "Ít phù hợp" while the two no-data skills were left out).
    expect(fitScoreOf([req("below", 76, 2), req("no_data", null, 2), req("not_studied", null), req("no_data", null)])).toBe(25.33);
    // The data share is what the score counts: everything but exempt-only skills (v15).
    expect(fitDataShareOf([req("met", 80, 2), req("upcoming", null, 2), req("no_data", null)])).toBe(1);
    expect(fitDataShareOf([req("met", 80), req("met", null, 2)])).toBe(0.3333);
    // Exempt-only (met without a score) is left out; Sắp học counts 0.
    expect(fitScoreOf([req("met", null), req("upcoming", null)])).toBe(0);
    expect(fitScoreOf([req("met", null)])).toBeNull();
    expect(fitScoreOf([req("met", 80), req("met", null, 2)])).toBe(80);
    expect(fitScoreOf([req("met", 71), req("below", 66.67)])).toBe(68.83);
  });

  it("never labels a profile whose requirements are all below threshold 'Rất phù hợp' or 'Phù hợp'", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const required = seed % 3 === 0;
      const threshold = required ? 85 : 70;
      const score = 40 + ((seed * 7919) % 1000) / 1000 * (threshold - 40 - 0.001);
      expect(["average", "low_fit", "not_fit"]).toContain(fitCodeOf(fitCredit("below", score, threshold), 1));
    }
  });

  it("orders skills by score, then evidence, then key (§7.11)", () => {
    const items = [
      { key: "S03", score: 80, evidence: 1 }, { key: "S01", score: 80, evidence: 1 }, { key: "S02", score: 80, evidence: 2 },
      { key: "S04", score: null, evidence: 5 }, { key: "S05", score: 90, evidence: 0.1 },
    ];
    expect([...items].sort(compareSkills).map((item) => item.key)).toEqual(["S05", "S02", "S01", "S03", "S04"]);
  });
});

describe("calculateAssessment on the synthetic CNPM student", () => {
  const result = calculateAssessment(syntheticInputs());

  it("assigns deterministic group and skill keys and stores version labels", () => {
    expect(result.groups.map((group) => [group.key, group.name])).toEqual([["G1", "Chuyên môn"], ["G2", "Kiến thức nền tảng"], ["G3", "Kỹ năng mềm"]]);
    expect(result.skillDirectory.map((item) => item.key)).toEqual(Array.from({ length: 15 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`));
    expect(result.skillDirectory.filter((item) => !item.measured).map((item) => item.name)).toEqual(["C#/C++", "Docker"]);
    expect(result.meta).toMatchObject({
      calcVersion: CALC_VERSION, promptVersion: "comp-v1", transcriptVersion: "00000000-0000-4000-8000-0000000000f1", cohortCode: "K29",
      curriculum: { revisionId: "00000000-0000-4000-8000-000000000002", version: 1 },
      weights: { activeCount: 25, maxConfigUpdatedAt: "2026-10-01T00:00:00.000Z" },
      graduationStandardId: "00000000-0000-4000-8000-000000000011", planRevisionId: "00000000-0000-4000-8000-000000000004",
      career: { id: "00000000-0000-4000-8000-0000000000c1" }, specialty: "CNPM",
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("averages score10 × credits × weight over the selected attempts (retake after F counts its pass)", () => {
    // (6.6·3·0.6 + 7.8·3·0.7 + 7.2·3·0.3) / (1.8 + 2.1 + 0.9) × 10 = 72.375, stored rounded down (comp-calc-v4)
    expect(byName(result, "Lập trình cơ bản")).toMatchObject({ score: 72.37, level: "good", evidence: 4.8, coverage: 1 });
    expect(result.courses.find((course) => course.code === "71ITBS10203")).toMatchObject({ state: "passed", score10: 6.6, attempts: 2, inferred: true });
  });

  it("counts MT as studied but keeps it out of the average, even after an F", () => {
    const database = byName(result, "Cơ sở dữ liệu quan hệ");
    expect(database).toMatchObject({ score: 70, evidence: 4.5 });
    expect(database.evidenceCourses.find((row) => row.code === "71ITIS30103")).toMatchObject({ role: "exempt" });
    expect(result.courses.find((course) => course.code === "71ITIS30103")).toMatchObject({ state: "exempt", score10: null, letter: "MT" });
  });

  it("uses elective quotas in the coverage denominator", () => {
    // 71ITIN40304 (4 × 0.5) + remaining TC406 quota 6 × average weight 9/12.
    expect(byName(result, "Thuyết trình")).toMatchObject({ denominator: 6.5, coverage: 0, status: "no_evidence", level: "no_evidence", confidence: null });
    // TC309 is full (6/6 credits), and the only applicable course is an unchosen option.
    expect(byName(result, "Phân tích dữ liệu lớn")).toMatchObject({ status: "not_applicable", notApplicableReason: "elective_not_chosen", denominator: 0, otherSpecialtyCourses: ["71ITDS40303"] });
    // PE quotas (TC002/TC102, 2 credits each) are met by one course each: 100 %, not 4/8.
    expect(byName(result, "Rèn luyện thể chất")).toMatchObject({ coverage: 1, conditionOnly: true });
    for (const skill of result.skills) if (skill.coverage !== null) expect(skill.coverage).toBeGreaterThanOrEqual(0), expect(skill.coverage).toBeLessThanOrEqual(1);
  });

  it("applies the confidence bands to real skill exposures", () => {
    expect(byName(result, "Lập trình C#")).toMatchObject({ coverage: 1, evidence: 0.9, confidence: "low" });
    expect(byName(result, "Kiểm thử phần mềm")).toMatchObject({ coverage: 0.3333, evidence: 1.5, confidence: "medium", level: "proficient" });
    expect(byName(result, "Học máy nhập môn")).toMatchObject({ score: 47, level: "needs_work", confidence: "high", otherSpecialtyCourses: ["71ITAI40803"] });
  });

  it("reaches a level exactly at its threshold despite float noise (comp-calc-v4)", () => {
    const codes = new Set(["71ITBS10203", "71ITSE30103", "71ITSE30503"]);
    const inputs = syntheticInputs({
      terms: mapTerms((row) => (codes.has(row[0]) ? [row[0], row[1], 8.5, 4, "A"] : row)),
      career: career([[SKILL.programming, true]]),
    });
    // 10 × 8.5·(0.3 + 0.3 + 0.3) / 0.9 is 84.99999999999999 in floating point without the snap.
    inputs.weights = { ...inputs.weights, links: inputs.weights.links.map((link) => (link.skillId === SKILL.programming ? { ...link, weight: 0.1 } : link)) };
    const snapped = calculateAssessment(inputs);
    expect(byName(snapped, "Lập trình cơ bản")).toMatchObject({ score: 85, level: "proficient" });
    expect(snapped.career!.requirements[0]).toMatchObject({ status: "met", score: 85, deficit: null });
  });

  it("keeps GDTC/GDQP out of group and overall scores but shows their skills", () => {
    const foundation = result.groups.find((group) => group.name === "Kiến thức nền tảng")!;
    expect(foundation).toMatchObject({ score: 80.28, skillCount: 1, skillsWithEvidence: 1 });
    expect(byName(result, "Kiến thức quốc phòng")).toMatchObject({ conditionOnly: true, score: 70 });
    expect(result.overall.score).toBe(pooledOverall(result));
    expect(result.overall).toMatchObject({ groupsWithScore: 3, basis: { skillsWithEvidence: 9, applicableSkills: 10, evidenceCourses: 9 } });
    const conditionKeys = result.skills.filter((skill) => skill.conditionOnly).map((skill) => skill.key);
    expect(conditionKeys).toHaveLength(2);
    // A strength needs at least medium confidence (2026-10-21).
    for (const key of result.highlights.strengths) expect(["medium", "high"]).toContain(result.skills.find((skill) => skill.key === key)!.confidence);
    for (const key of conditionKeys) {
      expect(result.highlights.strengths).not.toContain(key);
      expect(result.promptSelection.topSkillKeys).not.toContain(key);
      expect(result.promptSelection.bottomSkillKeys).not.toContain(key);
    }
  });

  it("pools every skill for the overall, so a group with little weight no longer counts for a third (comp-calc-v12)", () => {
    const base = syntheticInputs();
    const top = [...result.groups].filter((group) => group.score !== null).sort((a, b) => b.score! - a.score!)[0]!;
    const inTop = new Set(result.skills.filter((skill) => skill.groupId === top.id).map((skill) => skill.skillId));
    const light = calculateAssessment({ ...base, weights: { ...base.weights,
      links: base.weights.links.map((link) => (inTop.has(link.skillId) ? { ...link, weight: link.weight / 10 } : link)) } });
    const meanOfGroups = (item: AssessmentResult) => item.groups.reduce((sum, group) => sum + group.score!, 0) / item.groups.length;
    // A tenth of the weight leaves that group's score and the mean of the groups as they were; the pooled overall drops.
    expect(light.groups.find((group) => group.id === top.id)!.score).toBe(top.score);
    expect(meanOfGroups(light)).toBeCloseTo(meanOfGroups(result), 6);
    expect(light.overall.score).toBe(pooledOverall(light));
    expect(light.overall.score!).toBeLessThan(result.overall.score!);
  });

  it("counts group skills with the overall rule: not-applicable and condition-only skills are left out", () => {
    // Regression: the group line read 49/65 while the overview read 62/66 (not-applicable skills in the group denominator).
    const bigData = byName(result, "Phân tích dữ liệu lớn");
    expect(bigData.status).toBe("not_applicable");
    const group = result.groups.find((item) => item.key === bigData.groupKey)!;
    const counted = result.skills.filter((skill) => skill.groupKey === group.key && !skill.conditionOnly && skill.status !== "not_applicable");
    expect(group.skillCount).toBe(counted.length);
    expect(group.skillCount).toBeLessThan(result.skills.filter((skill) => skill.groupKey === group.key && !skill.conditionOnly).length);
    expect(result.groups.reduce((sum, item) => sum + item.skillCount, 0)).toBe(result.overall.basis.applicableSkills);
    expect(result.groups.reduce((sum, item) => sum + item.skillsWithEvidence, 0)).toBe(result.overall.basis.skillsWithEvidence);
  });

  it("sorts skills by score, evidence and key", () => {
    const scored = result.skills.filter((skill) => skill.score !== null).map((skill) => skill.score!);
    expect(scored).toEqual([...scored].sort((a, b) => b - a));
    expect(result.skills.slice(-2).map((skill) => skill.score)).toEqual([null, null]);
  });

  it("summarises the transcript, keeps codes outside the CTĐT as information and checks credits", () => {
    expect(result.transcript).toMatchObject({
      latestTerm: "HK243", passed: 12, exempt: 2, failed: 0, inProgress: 1, inferredCount: 12,
      creditCheck: { computed: 27, printed: 27, status: "match" },
    });
    expect(result.transcript.notInCurriculum.map((row) => row.code)).toEqual(["71ENG010000", "71ENG010012"]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["results_inferred"]);
    expect(result.warnings[0]!.message).toContain("khớp");
  });

  it("matches the CNPM standard and reports graduation with bounds", () => {
    expect(result.graduation).toMatchObject({ resolution: "specialty", status: "fail", gpa: { actual: 2.85, source: "printed", status: "pass" }, credits: { lower: 27, source: "printed" } });
    // comp-calc-v5: the two "Nhóm tự chọn TC102" groups are told apart by size and first code.
    expect(result.graduation.groups.map((group) => [group.label, group.code, group.curriculumElectiveCode, group.status])).toEqual([
      ["Học phần bắt buộc", null, null, "fail"],
      ["Nhóm tự chọn TC102 · 2 học phần, trong đó có 71PEKC10062", "TC102", "TC002", "pass"],
      ["Nhóm tự chọn TC102 · 2 học phần, trong đó có 71PEBA10052", "TC102", "TC102", "pass"],
      ["Nhóm tự chọn TC209", "TC209", "TC309", "pass"], ["Nhóm tự chọn TC306", "TC306", "TC406", "fail"],
    ]);
  });

  it("estimates graduation credits over the program when no total is printed (comp-calc-v5)", () => {
    const terms = syntheticStudentTerms().map((term) => ({ ...term, summaries: [] as [string, string][] }));
    const estimated = calculateAssessment(syntheticInputs({ terms }));
    // Passed/MT standard ∪ CTĐT courses without GDTC/GDQP: the 27 credits the transcript prints elsewhere.
    expect(estimated.graduation.credits).toMatchObject({ lower: 27, upper: 27, source: "calculated", status: "fail" });
    expect(estimated.transcript.creditCheck).toMatchObject({ computed: 27, printed: null, status: "unavailable" });
    // The synthetic standard copies the CTĐT credits, so the program only shows when they differ: here
    // 71ITSE30503 has 4 credits in the standard (3 in the CTĐT) and this CTĐT lacks 71ITSE30103.
    const inputs = syntheticInputs({ terms });
    const standard = inputs.graduation.standard!;
    inputs.graduation.standard = {
      ...standard,
      data: { ...standard.data, courses: standard.data.courses.map((course) => (course.code === "71ITSE30503" ? { ...course, credits: 4 } : course)) },
    };
    inputs.curriculum.courses = inputs.curriculum.courses.filter((course) => course.code !== "71ITSE30103");
    const program = calculateAssessment(inputs);
    // Program (programCreditMap): 27 − 3 + 4 = 28; the CTĐT credits alone give 24, as the competency's own cross-check does.
    expect(program.graduation.credits).toEqual({ lower: 28, upper: 28, required: 126, status: "fail", source: "calculated" });
    expect(program.transcript.creditCheck).toMatchObject({ computed: 24, printed: null, status: "unavailable" });
  });

  it("reports progress against the training plan from the term being studied (v13)", () => {
    // Kiểm thử phần mềm is registered without grades in HK251: that term is being studied, HK252 comes next.
    expect(result.progress).toMatchObject({ currentTerm: "HK251", nextTerm: "HK252", lateCount: 0, nextCount: 0 });
    expect(result.transcript.latestTerm).toBe("HK243");
  });

  it("counts a course planned for the term being studied but not registered as late, and never as sắp học", () => {
    const inputs = syntheticInputs();
    const plan = inputs.plan.resolution === "found" ? inputs.plan.revision.data : null;
    const item = plan!.items.find((entry) => entry.code === "71ITSE41203")!;
    plan!.items.push({ ...item, id: "row-extra", position: 999, code: "71ITIN40304", name: "Đồ án thực tập", credits: 4, sectionId: null });
    const progress = calculateAssessment(inputs).progress!;
    expect(progress.late.map((entry) => (entry.kind === "course" ? [entry.code, entry.termCode] : null))).toEqual([["71ITIN40304", "HK251"]]);
    expect(progress.next).toEqual([]);
  });

  it("lists unmeasured career skills for self-study with similar measured skills as context only", () => {
    expect(result.selfStudy.map((item) => [item.name, item.reason, item.relatedSkillKeys.map((key) => result.skillDirectory.find((entry) => entry.key === key)?.name)])).toEqual([
      ["C#/C++", "not_measured", ["Lập trình C#"]], ["Docker", "not_measured", []],
    ]);
    expect(result.career!.requirements.find((item) => item.title === "C#/C++")).toMatchObject({ status: "no_data", score: null });
  });

  it("does not suggest a specialty once one is chosen", () => {
    expect(result.specialtySuggestion).toBeNull();
  });
});

describe("applicable set A (spec §7.2)", () => {
  const run = (specialty: SpecialtyCode | null) => calculateAssessment(syntheticInputs({ specialty }));

  it("without a specialty: suggests one, keeps attempted specialty courses and never blocks", () => {
    const result = run(null);
    expect(result.specialtySuggestion).toEqual({ code: "CNPM", label: "Công nghệ phần mềm", passedCount: 1, text: "Gợi ý: Công nghệ phần mềm (1 học phần chuyên ngành đã học)" });
    expect(result.graduation).toMatchObject({ resolution: "specialty_unset", status: "unknown" });
    expect(result.warnings.map((warning) => warning.code)).toContain("graduation_standard_unresolved");
    expect(result.courses.filter((course) => course.specialty && course.applicable).map((course) => course.code).sort()).toEqual(["71ITSE41003", "71ITSE41203"]);
    expect(byName(result, "Kiểm thử phần mềm").coverage).toBe(byName(run("CNPM"), "Kiểm thử phần mềm").coverage);
  });

  it("with the wrong specialty: warns about the conflict and keeps coverage within [0, 1]", () => {
    const result = run("CNDL");
    expect(result.warnings.find((warning) => warning.code === "specialty_conflict")?.message).toContain("Công nghệ phần mềm: 1 học phần");
    expect(result.courses.filter((course) => course.specialty && course.applicable).map((course) => course.code).sort()).toEqual(["71ITDS40303", "71ITSE41003", "71ITSE41203"]);
    for (const skill of result.skills) {
      if (skill.coverage !== null) expect(skill.coverage).toBeLessThanOrEqual(1);
      if (skill.score !== null) expect(skill.status).toBe("scored");
    }
    expect(byName(result, "Phân tích dữ liệu lớn")).toMatchObject({ status: "no_evidence", denominator: 3 });
  });

  it("with the right specialty: adds that specialty's courses to A", () => {
    const ttnt = run("TTNT");
    expect(byName(ttnt, "Học máy nhập môn")).toMatchObject({ denominator: 6, coverage: 0.5, otherSpecialtyCourses: [] });
    expect(ttnt.graduation.resolution).toBe("not_found");
  });
});

describe("career gaps and fit (spec §7.5–§7.7)", () => {
  const inputs = syntheticInputs({
    career: career([
      [SKILL.testing, true], [SKILL.mobile, false], [SKILL.machineLearning, true], [SKILL.presenting, false], [SKILL.bigData, false], [SKILL.docker, false],
    ]),
  });
  const result = calculateAssessment(inputs);
  const row = (name: string) => result.career!.requirements.find((item) => item.title === name)!;

  it("gives the statuses with thresholds 80/62,5 and deficit bands; an elective not chosen is Cần tự học (v14)", () => {
    expect(row("Kiểm thử phần mềm")).toMatchObject({ status: "met", threshold: 80, coefficient: 2, priorityLabel: "Bắt buộc", fitCredit: 1 });
    expect(row("Lập trình di động")).toMatchObject({ status: "below", threshold: 62.5, score: 56, deficit: 6.5, deficitBand: "moderate", deficitBandLabel: "Thiếu vừa" });
    expect(row("Học máy nhập môn")).toMatchObject({ status: "below", deficit: 33, deficitBand: "large" });
    expect(row("Thuyết trình")).toMatchObject({ status: "upcoming", statusLabel: "Sắp học", upcomingTerm: "HK253", fitCredit: null });
    // Only an elective of a group whose credits are filled teaches it: "Cần tự học" like another specialty (v14), not "Chưa học".
    expect(row("Phân tích dữ liệu lớn")).toMatchObject({ status: "no_data", noDataReason: "elective_not_chosen", deficitBand: null, fitCredit: null, selfStudy: true });
    expect(row("Docker")).toMatchObject({ status: "no_data", noDataReason: "not_measured", fitCredit: null, selfStudy: true });
  });

  it("computes the non-saturating fit index, the data share and the count lines", () => {
    const fit = (2 * 1 + 1 * 0.5 * (56 - 40) / 22.5 + 2 * 0.5 * (47 - 40) / 40) / 5;
    expect(result.career!.fit).toBeCloseTo(fit, 4);
    expect(result.career).toMatchObject({
      // Điểm phù hợp (v15): (2 × 88 + 56 + 2 × 47 + 0 for Phân tích dữ liệu lớn, Cần tự học + 0 for Thuyết trình, Sắp
      // học + 0 for Docker, no data) / 8; every skill counts, so the data share is 1.
      fitScore: 40.75, fitCode: "not_fit", fitLabel: "Không phù hợp", dataShare: 1,
      // v17: every non-zero count, in a fixed order (the two skills below the threshold were not named before), and the
      // skills with a score (88, 56, 47) instead of "4/6 kỹ năng có dữ liệu".
      summaryText: "Đạt 1/6 kỹ năng · 2 dưới ngưỡng · 1 sắp học · 1 cần tự học · 1 chưa đủ dữ liệu", dataText: "3/6 kỹ năng có điểm",
      counts: { total: 6, met: 1, below: 2, upcoming: 1, notStudied: 0, noData: 2, withData: 4 },
      weightedMeanScore: 65.2, weightedMeanCount: 3,
    });
    expect(result.career!.requirements.map((item) => item.title)).toEqual([
      "Học máy nhập môn", "Kiểm thử phần mềm", "Lập trình di động", "Thuyết trình", "Phân tích dữ liệu lớn", "Docker",
    ]);
  });

  it("lists support courses by credits × weight with three-state prerequisites and planned terms", () => {
    // Registered for Chuyên đề Tốt nghiệp 1: the student is on the thesis replacement path, so its courses may be suggested
    // (comp-calc-v7) and the thesis no longer (v18: never both ways).
    const started = calculateAssessment({ ...inputs, transcript: { ...inputs.transcript, data: syntheticTranscript(withRows(6, [["71ITGR40203", 3]])) } });
    const courses = started.career!.requirements.find((item) => item.title === "Thuyết trình")!.supportCourses;
    expect(courses.map((course) => [course.code, course.eligibility, course.termLabel])).toEqual([
      ["71ITGR40203", "not_eligible", "HK261"], ["71ITIS30403", "review", "HK253"], ["71ITIN40304", "eligible", "HK253"],
    ]);
    // Only the CNPM block of the "SV chuyên ngành …" relation applies; 71ITSE41203 is in progress, not passed.
    expect(courses[0]!.missing).toEqual([{ code: "71ITSE41203", name: "Kiểm thử phần mềm", kind: "prerequisite" }]);
    expect(courses[1]!.reviewNotes).toEqual(["[71ENG010012]Anh văn dự bị (AV0)"]);
    expect(courses[0]!.reason).toBe("3 tín chỉ × trọng số 1 cho kỹ năng này");
    // Off that path the replacements are left out; the thesis itself stays.
    expect(row("Thuyết trình").supportCourses.map((course) => course.code)).toEqual(["71ITGR40206", "71ITIN40304"]);
  });

  it("asks for confirmation of specialty-dependent prerequisites when no specialty is set", () => {
    const unset = calculateAssessment(syntheticInputs({ specialty: null, terms: withRows(6, [["71ITGR40203", 3]]), career: inputs.career }));
    const course = unset.career!.requirements.find((item) => item.title === "Thuyết trình")!.supportCourses.find((item) => item.code === "71ITGR40203")!;
    expect(course).toMatchObject({ eligibility: "review", missing: [] });
    expect(course.reviewNotes[0]).toContain("chưa chọn chuyên ngành");
  });

  it("suggests improving passed courses below the threshold and lists self-study skills", () => {
    expect(row("Học máy nhập môn").improveCourses.map((course) => [course.code, course.kind, course.reason])).toEqual([
      ["71ITAI40103", "improve", "Đã đạt nhưng điểm học phần 47/100 thấp hơn ngưỡng 80"],
    ]);
    expect(row("Lập trình di động").supportCourses).toEqual([]);
    expect(result.selfStudy.map((item) => [item.name, item.reason])).toEqual([
      ["Phân tích dữ liệu lớn", "elective_quota_used"], ["Docker", "not_measured"],
    ]);
    // A below skill whose only courses are improve courses is not "no course left" (CS-3).
    for (const name of ["Học máy nhập môn", "Lập trình di động"]) {
      expect(row(name)).toMatchObject({ status: "below", supportCourses: [], selfStudy: false });
      expect(row(name).improveCourses.length).toBeGreaterThan(0);
    }
    // Priority = Σ coefficient × credits × weight: the required skill's improvement (2 × 3 × 1) comes first.
    expect(result.courseSuggestions.slice(0, 2).map((course) => [course.code, course.kind, course.priority])).toEqual([["71ITAI40103", "improve", 6], ["71ITGR40206", "take", 3]]);
    expect(result.courseSuggestions.find((course) => course.kind === "improve")).toMatchObject({ code: "71ITAI40103", skills: [{ key: row("Học máy nhập môn").skillKey, status: "below" }] });
  });

  it("separates 'Sắp học' from 'Chưa học' by the training-plan term", () => {
    const early = calculateAssessment(syntheticInputs({
      terms: [
        { year: "2023-2024", semester: "HK01", rows: [["71ITBS10103", 3, 8, 3.5, "B+"], ["71ITBS10203", 3, 7, 3, "B"]] },
        { year: "2023-2024", semester: "HK02", rows: [["71PEKC10062", 2, 8, 3.5, "B+"]] },
      ],
      career: career([[SKILL.csharp, false], [SKILL.testing, true], [SKILL.web, false]]),
    }));
    expect(early.career!.requirements.map((item) => [item.title, item.status, item.upcomingTerm])).toEqual([
      ["Kiểm thử phần mềm", "upcoming", "HK243"], ["Lập trình C#", "not_studied", null], ["Phát triển web", "upcoming", "HK241"],
    ]);
    // Đánh giá năng lực reads the same rule from the skill rows (v16): a course ahead or not, and its term.
    expect(["Kiểm thử phần mềm", "Lập trình C#", "Phát triển web"].map((name) => [byName(early, name).upcoming, byName(early, name).upcomingTerm]))
      .toEqual([[true, "HK243"], [false, null], [true, "HK241"]]);
    // Sắp học counts 0 (v15): nothing is scored yet, so the fit is 0 "Không phù hợp" rather than "Chưa đủ dữ liệu".
    expect(early.career).toMatchObject({ fitCode: "not_fit", fitScore: 0, fit: 0, dataShare: 1 });
    expect(early.progress!.late.map((entry) => ("code" in entry ? entry.code : entry.label))).toEqual(["71NAD110013", "71ITSE30103"]);
  });

  it("never calls a student 'Phù hợp' when every measured career skill is below threshold", () => {
    const allC = calculateAssessment(syntheticInputs({
      terms: mapTerms((row) => (row[4] === "MT" || row[2] === undefined ? row : [row[0], row[1], 5.5, 2, "C"])),
      career: career([[SKILL.programming, false], [SKILL.web, false], [SKILL.testing, true], [SKILL.database, false], [SKILL.mobile, false]]),
    }));
    expect(allC.career!.requirements.every((item) => item.status === "below")).toBe(true);
    expect(allC.career!.fit!).toBeLessThan(0.5);
    expect(allC.career!).toMatchObject({ fitScore: 55, fitCode: "low_fit", fitLabel: "Ít phù hợp" });
  });

  it("handles a requirement without a skill and a deleted career", () => {
    const base = career([[SKILL.testing, true]], { deleted: true });
    base.requirements.push({ id: "00000000-0000-4000-8000-00000000d199", skillId: null, skillName: null, title: "Tiếng Anh giao tiếp", isRequired: false });
    const deleted = calculateAssessment(syntheticInputs({ career: base }));
    expect(deleted.career!.requirements.find((item) => item.skillId === null)).toMatchObject({ status: "no_data", noDataReason: "no_skill", skillKey: null, selfStudy: false });
    expect(deleted.warnings.map((warning) => warning.code)).toContain("career_deleted");
  });

  it("still assesses competencies without a career", () => {
    const none = calculateAssessment(syntheticInputs({ career: null }));
    expect(none).toMatchObject({ career: null, selfStudy: [], courseSuggestions: [], promptSelection: { careerSkillKeys: [] } });
    expect(none.skills.length).toBe(13);
    expect(none.promptSelection.topSkillKeys).toHaveLength(5);
  });

  it("puts every career skill plus the 5 strongest and weakest other skills in the prompt selection", () => {
    expect(result.promptSelection.careerSkillKeys).toHaveLength(6);
    const others = [...result.promptSelection.topSkillKeys, ...result.promptSelection.bottomSkillKeys];
    expect(others.some((key) => result.promptSelection.careerSkillKeys.includes(key))).toBe(false);
    expect(new Set(others).size).toBe(others.length);
  });
});

describe("skill plans (comp-calc-v6, purpose since v7)", () => {
  const plan = (result: AssessmentResult, name: string) => {
    const found = result.skillPlans.find((item) => item.name === name);
    if (!found) throw new Error(`plan ${name} missing`);
    return found;
  };
  const allC = () => calculateAssessment(syntheticInputs({
    career: null, terms: mapTerms((row) => (row[4] === "MT" || row[2] === undefined ? row : [row[0], row[1], 5.5, 2, "C"])),
  }));
  const plusTeamwork = () => {
    const base = syntheticCareer();
    base.requirements.push({ id: "00000000-0000-4000-8000-0000000000d6", skillId: SKILL.teamwork, skillName: "Làm việc nhóm", title: "Làm việc nhóm", isRequired: false });
    return base;
  };

  it("without a career: strengthens the skills below Khá, weakest first, with their low passed courses to improve", () => {
    const result = calculateAssessment(syntheticInputs({ career: null }));
    expect(result.skillPlans.map((item) => [item.name, item.score, item.level, item.levelLabel, item.purpose, item.careerSkill, item.selfStudy])).toEqual([
      ["Học máy nhập môn", 47, "needs_work", "Yếu", "strengthen", false, false], ["Lập trình di động", 56, "basic", "Trung bình", "strengthen", false, false],
    ]);
    expect(result.skillPlans.map((item) => item.skillKey)).toEqual(result.highlights.improvements);
    const mobile = plan(result, "Lập trình di động");
    expect(mobile).toMatchObject({ skillId: SKILL.mobile, groupKey: byName(result, "Lập trình di động").groupKey });
    // Its other course, 71ITSE30903, is an option of the full TC309 quota: nothing to take.
    expect(mobile.take).toEqual([]);
    expect(mobile.improve).toEqual([expect.objectContaining({
      code: "71ITSE30603", kind: "improve", state: "passed", score10: 5.6, letter: "C", eligibility: "eligible",
      reason: "Đã đạt nhưng điểm học phần 56/100 thấp hơn ngưỡng 62,5",
    })]);
    // The other specialty's course (71ITAI40803) is never one to take.
    expect(plan(result, "Học máy nhập môn")).toMatchObject({ take: [], improve: [{ code: "71ITAI40103", score10: 4.7 }] });
  });

  it("lists courses still to take with prerequisites and term, and keeps a failed course as a retake", () => {
    const inputs = syntheticInputs({ career: null });
    inputs.weights.links.push({ courseCode: "71ITIN40304", skillId: SKILL.mobile, weight: 0.5 });
    inputs.curriculum.relations.push({ courseCode: "71ITIN40304", kind: "prerequisite", raw: "[71ITSE41203]Kiểm thử phần mềm", targetCodes: ["71ITSE41203"], unresolvedCodes: [], reviewRequired: false });
    const mobile = plan(calculateAssessment(inputs), "Lập trình di động");
    // 71ITSE41203 is in progress, not passed.
    expect(mobile.take).toEqual([expect.objectContaining({
      code: "71ITIN40304", kind: "take", state: "not_taken", eligibility: "not_eligible", eligibilityLabel: "Chưa đủ điều kiện",
      missing: [{ code: "71ITSE41203", name: "Kiểm thử phần mềm", kind: "prerequisite" }], term: "HK253", termSource: "plan",
    })]);
    expect(mobile.improve.map((course) => course.code)).toEqual(["71ITSE30603"]);
    const failed = calculateAssessment(syntheticInputs({ career: null, terms: mapTerms((row) => (row[0] === "71ITAI40103" ? ["71ITAI40103", 3, 3, 0, "F"] : row)) }));
    expect(plan(failed, "Học máy nhập môn")).toMatchObject({
      score: 30, take: [{ code: "71ITAI40103", kind: "take", state: "failed", eligibility: "eligible" }], improve: [], selfStudy: false,
    });
  });

  it("with a career: only deepens its met skills below Giỏi, never the other weak skills (comp-calc-v7, v10)", () => {
    const result = calculateAssessment(syntheticInputs());
    // Phát triển web 72 and Lập trình cơ bản 72,37 are met (Ưu tiên, 62,5) but below Giỏi; Kiểm thử phần mềm 88 needs nothing.
    // Học máy nhập môn 47 and Lập trình di động 56 are not in the career: no plan, although they stay improvement highlights.
    expect(result.skillPlans.map((item) => [item.name, item.score, item.purpose, item.careerSkill, item.selfStudy])).toEqual([
      ["Phát triển web", 72, "deepen", true, true], ["Lập trình cơ bản", 72.37, "deepen", true, true],
    ]);
    expect(result.highlights.improvements.map((key) => result.skillDirectory.find((item) => item.key === key)!.name)).toEqual(["Học máy nhập môn", "Lập trình di động"]);
    // Improve courses are still only the real drags (below Khá): its courses score 7,8, 7,2 and 6,6, all at
    // Khá since comp-calc-v10 (62,5; 6,6 was below the old 70), so it is self-study with a product.
    expect(plan(result, "Lập trình cơ bản")).toMatchObject({ take: [], improve: [], selfStudy: true });
    // Its web framework course is an option of the full TC309 quota: self-study with a product.
    expect(plan(result, "Phát triển web")).toMatchObject({ take: [], improve: [] });
    // Courses still to take, the thesis included (it is no replacement).
    const teamwork = plan(calculateAssessment(syntheticInputs({ career: plusTeamwork() })), "Làm việc nhóm");
    expect(teamwork).toMatchObject({ score: 79, purpose: "deepen", improve: [], selfStudy: false });
    expect(teamwork.take.map((course) => [course.code, course.state, course.eligibility])).toEqual([["71ITGR40206", "not_taken", "eligible"], ["71ITIN40304", "not_taken", "eligible"]]);
  });

  it("leaves career gaps to the career suggestions and plans no skill outside the career", () => {
    const both = calculateAssessment(syntheticInputs({ career: career([[SKILL.machineLearning, true], [SKILL.mobile, false]]) }));
    expect(both.career!.requirements.map((item) => item.status)).toEqual(["below", "below"]);
    expect(both.skillPlans).toEqual([]);
    expect(both.career!.requirements[0]).toMatchObject({ status: "below", improveCourses: [{ code: "71ITAI40103" }] });
    // Met for Ưu tiên but below Bắt buộc: a career gap, not a skill to deepen.
    const twice = calculateAssessment(syntheticInputs({ career: career([[SKILL.programming, true], [SKILL.programming, false]]) }));
    expect(twice.career!.requirements.map((item) => item.status)).toEqual(["below", "met"]);
    expect(twice.skillPlans).toEqual([]);
    expect(twice.career!.requirements[0]!.improveCourses.map((course) => course.code)).toEqual(["71ITSE30103", "71ITBS10203", "71ITSE30503"]);
    // No requirement status to deepen (its skill name is gone: no data), and Học máy nhập môn is not met.
    const unnamed = career([[SKILL.machineLearning, true]]);
    unnamed.requirements[0] = { ...unnamed.requirements[0]!, skillName: null };
    const noData = calculateAssessment(syntheticInputs({ career: unnamed }));
    expect(noData.career!.requirements[0]!.status).toBe("no_data");
    expect(noData.skillPlans).toEqual([]);
  });

  it("leaves condition-only skills out and marks self-study when no course is left", () => {
    const inputs = syntheticInputs({ career: null, terms: mapTerms((row) => (row[0] === "71NAD110013" ? ["71NAD110013", 3, 4, 1, "D"] : row)) });
    // Synthetic skill measured mostly by GDQP (condition-only: never a course to improve) and a well-passed course.
    const discipline = "00000000-0000-4000-8000-0000000000bf";
    inputs.weights.skills.push({ skillId: discipline, name: "Kỷ luật tác phong", description: "", scope: "Tác phong và kỷ luật.", groupId: "00000000-0000-4000-8000-0000000000a1" });
    inputs.weights.links.push({ courseCode: "71NAD110013", skillId: discipline, weight: 1 }, { courseCode: "71ITBS10103", skillId: discipline, weight: 0.2 });
    const result = calculateAssessment(inputs);
    expect(byName(result, "Kiến thức quốc phòng")).toMatchObject({ conditionOnly: true, score: 40, level: "needs_work" });
    expect(result.skillPlans.map((item) => item.name)).toEqual(["Học máy nhập môn", "Kỷ luật tác phong", "Lập trình di động"]);
    // (4 × 3 + 8,6 × 3 × 0,2) / 3,6 × 10 = 47,66…
    expect(plan(result, "Kỷ luật tác phong")).toMatchObject({ score: 47.66, take: [], improve: [], selfStudy: true });
    // A met condition-only career skill (Kiến thức quốc phòng 70, Ưu tiên) is not deepened either.
    const defence = calculateAssessment(syntheticInputs({ career: career([[SKILL.defence, false]]) }));
    expect(defence.career!.requirements[0]!.status).toBe("met");
    expect(defence.skillPlans).toEqual([]);
  });

  it("caps the plans at MAX_SKILL_PLANS in the order of the improvement highlights", () => {
    const result = allC();
    // Eleven skills score 55: the two GDTC/GDQP ones are left out, evidence then key break the tie,
    // and Lập trình C# (evidence 0,9) is cut by the cap.
    expect(result.skillPlans).toHaveLength(MAX_SKILL_PLANS);
    expect(result.skillPlans.map((item) => item.name)).toEqual([
      "Lập trình cơ bản", "Cơ sở dữ liệu quan hệ", "Tư duy công nghệ thông tin", "Học máy nhập môn", "Lập trình di động", "Làm việc nhóm",
      "Phát triển web", "Kiểm thử phần mềm",
    ]);
    expect(result.skillPlans.slice(0, 5).map((item) => item.skillKey)).toEqual(result.highlights.improvements);
    // Both lists are sorted by credits × weight; an ongoing course is still one to take.
    expect(plan(result, "Lập trình cơ bản").improve.map((course) => course.code)).toEqual(["71ITSE30103", "71ITBS10203", "71ITSE30503"]);
    expect(plan(result, "Làm việc nhóm").take.map((course) => course.code)).toEqual(["71ITGR40206", "71ITIN40304"]);
    expect(plan(result, "Kiểm thử phần mềm").take).toEqual([expect.objectContaining({ code: "71ITSE41203", state: "in_progress" })]);
    for (const item of result.skillPlans) expect(item).toMatchObject({ purpose: "strengthen", selfStudy: !item.take.length && !item.improve.length });
  });
});

describe("thesis replacement courses are never suggested off that path (comp-calc-v7)", () => {
  // TC406 ≡ standard "Nhóm tự chọn TC306" (6 TC): 71ITGR40206 Đồ án Tốt nghiệp (6 TC) completes it alone,
  // 71ITGR40203 Chuyên đề Tốt nghiệp 1 and 71ITIS30403 Quản lý và phát triển các hệ thống thông tin replace it.
  const gaps = career([[SKILL.presenting, false]]);
  const presenting = (result: AssessmentResult) => result.career!.requirements[0]!.supportCourses.map((course) => course.code);
  const run = (terms?: TranscriptTerm[], extra: SyntheticOptions = {}) => calculateAssessment(syntheticInputs({ career: gaps, terms, ...extra }));

  it("leaves the replacements out of career gaps, course suggestions and plans, but keeps the thesis", () => {
    const result = run();
    expect(result.excludedThesisReplacements).toEqual(["71ITGR40203", "71ITIS30403"]);
    expect(result.career!.requirements[0]).toMatchObject({ status: "upcoming", upcomingTerm: "HK253" });
    expect(presenting(result)).toEqual(["71ITGR40206", "71ITIN40304"]);
    expect(result.courseSuggestions.map((course) => course.code)).toEqual(["71ITGR40206", "71ITIN40304"]);
    // A plan: 71ITIS30403 (linked to Lập trình di động here) is left out, the thesis is kept.
    const inputs = syntheticInputs({ career: null });
    inputs.weights.links.push({ courseCode: "71ITIS30403", skillId: SKILL.mobile, weight: 1 }, { courseCode: "71ITGR40206", skillId: SKILL.mobile, weight: 0.5 });
    const plans = calculateAssessment(inputs);
    expect(plans.skillPlans.find((item) => item.skillId === SKILL.mobile)!.take.map((course) => course.code)).toEqual(["71ITGR40206"]);
  });

  it("suggests them once the student is on the replacement path, and the thesis no longer (v18)", () => {
    const registered = run(withRows(6, [["71ITGR40203", 3]]));
    expect(registered.excludedThesisReplacements).toEqual(["71ITGR40206"]);
    // Chuyên đề Tốt nghiệp 1 alone (3 TC) cannot complete the 6-TC group, so the other replacement stays on that path.
    expect(presenting(registered)).toEqual(["71ITGR40203", "71ITIS30403", "71ITIN40304"]);
    // A passed replacement meets Thuyết trình (75, below Giỏi): the plan to deepen it may name the other replacement.
    const passed = run(withRows(5, [["71ITIS30403", 3, 7.5, 3, "B"]]));
    expect(passed.excludedThesisReplacements).toEqual(["71ITGR40206"]);
    expect(passed.skillPlans.map((item) => [item.name, item.purpose, item.take.map((course) => course.code)])).toEqual([
      ["Thuyết trình", "deepen", ["71ITGR40203", "71ITIN40304"]],
    ]);
  });

  it("follows the cumulative GPA when no way is taken: the thesis from 2,80, the replacement courses below it (v18)", () => {
    /** The synthetic terms with the printed cumulative GPA (2,85) replaced. */
    const gpa = (value: string) => syntheticStudentTerms().map((term) => (term.summaries
      ? { ...term, summaries: term.summaries.map(([label, text]) => [label, /TB tích lũy/.test(label) ? value : text] as [string, string]) } : term));
    expect(run(gpa("2,80")).excludedThesisReplacements).toEqual(["71ITGR40203", "71ITIS30403"]);
    const low = run(gpa("2,79"));
    expect(low.excludedThesisReplacements).toEqual(["71ITGR40206"]);
    expect(presenting(low)).toEqual(["71ITGR40203", "71ITIS30403", "71ITIN40304"]);
    expect(low.courseSuggestions.map((course) => course.code)).not.toContain("71ITGR40206");
  });

  it("does not count a failed replacement or replacements next to a thesis in progress as that path", () => {
    const failed = run(withRows(5, [["71ITGR40203", 3, 3, 0, "F"]]));
    expect(failed.excludedThesisReplacements).toEqual(["71ITGR40203", "71ITIS30403"]);
    // The failed course is no retake to suggest either.
    expect(presenting(failed)).toEqual(["71ITGR40206", "71ITIN40304"]);
    const thesis = run(withRows(6, [["71ITGR40206", 6], ["71ITIS30403", 3]]));
    expect(thesis.excludedThesisReplacements).toEqual(["71ITGR40203", "71ITIS30403"]);
    expect(presenting(thesis)).toEqual(["71ITGR40206", "71ITIN40304"]);
  });

  it("needs the group quota, like graduation/thesis.ts: no standard, no thesis group", () => {
    // K29 has no general standard, so without a specialty the TC406 quota is unknown.
    expect(run(undefined, { specialty: null }).excludedThesisReplacements).toEqual([]);
  });
});

describe("competency history by graded term (STU-COMP-07, comp-calc-v8)", () => {
  /** The overall and groups of a result as a history point holds them. */
  const asPoint = (result: AssessmentResult) => ({
    overall: {
      score: result.overall.score, level: result.overall.level, levelLabel: result.overall.levelLabel,
      skillsWithEvidence: result.overall.basis.skillsWithEvidence, applicableSkills: result.overall.basis.applicableSkills,
    },
    groups: result.groups.map(({ key, name, score, level, levelLabel }) => ({ key, name, score, level, levelLabel })),
  });
  const groupScore = (point: HistoryPoint, name: string) => point.groups.find((group) => group.name === name)!.score;

  it("has one point per graded term, oldest first, with the school year and semester of its term code", () => {
    const result = calculateAssessment(syntheticInputs());
    // No HK242 section; HK251 only holds a registration without grades: no point for either.
    expect(result.history.map((point) => [point.term, point.schoolYear, point.semester, point.gradedCourses])).toEqual([
      ["HK231", "2023–2024", 1, 5], ["HK232", "2023–2024", 2, 7], ["HK233", "2023–2024", 3, 9], ["HK241", "2024–2025", 1, 11], ["HK243", "2024–2025", 3, 14],
    ]);
    // The last count is the transcript summary's: 12 passed + 2 exempt (the in-progress course has no result).
    expect(result.transcript).toMatchObject({ passed: 12, failed: 0, exempt: 2, gradedUnknown: 0, inProgress: 1 });
    expect(termParts("HK231")).toEqual({ schoolYear: "2023–2024", semester: 1 });
    expect(termParts("HK093")).toEqual({ schoolYear: "2009–2010", semester: 3 });
    expect(termParts("HK254")).toBeNull();
  });

  it("ends with the main result and keeps the keys, names and order of result.groups at every point", () => {
    for (const inputs of [syntheticInputs(), syntheticInputs({ career: null, specialty: null })]) {
      const result = calculateAssessment(inputs);
      const last = result.history.at(-1)!;
      expect(last.term).toBe(result.transcript.latestTerm);
      expect({ overall: last.overall, groups: last.groups }).toEqual(asPoint(result));
      for (const point of result.history) expect(point.groups.map((group) => [group.key, group.name])).toEqual(result.groups.map((group) => [group.key, group.name]));
    }
  });

  it("holds the career skills at every point (STU-GAP-07, comp-calc-v9); the last point is result.career", () => {
    const result = calculateAssessment(syntheticInputs());
    const last = result.history.at(-1)!;
    expect(last.career).toEqual({
      fitCode: result.career!.fitCode, fitLabel: result.career!.fitLabel, met: result.career!.counts.met, total: result.career!.counts.total,
      requirements: result.career!.requirements.map((req) => ({ requirementId: req.requirementId, score: req.score, status: req.status })),
    });
    for (const point of result.history) {
      const ids = (requirements: { requirementId: string }[]) => requirements.map((req) => req.requirementId).sort();
      expect(ids(point.career!.requirements)).toEqual(ids(result.career!.requirements));
      expect(point.career!.total).toBe(result.career!.counts.total);
    }
    // Fewer career skills are met at the first term than now.
    expect(result.history[0]!.career!.met).toBeLessThanOrEqual(last.career!.met);
    expect(calculateAssessment(syntheticInputs({ career: null })).history.every((point) => point.career === null)).toBe(true);
  });

  it("computes each point from the transcript up to its term: later terms and later attempts are not there yet", () => {
    const terms: TranscriptTerm[] = [
      { rows: [["71ITBS10103", 3, 9, 4, "A"]] }, // "Điểm bảo lưu": in every point
      { year: "2023-2024", semester: "HK01", rows: [["71ITBS10203", 3, 3, 0, "F"]] },
      { year: "2023-2024", semester: "HK02", rows: [["71ITSE30103", 3, 8, 3.5, "B+"]] },
      { year: "2023-2024", semester: "HK03", rows: [["71ITBS10203", 3, 7, 3, "B"]] }, // the retake
      { year: "2024-2025", semester: "HK01", rows: [["71ITSE30503", 3]] }, // registered, no grades
    ];
    const result = calculateAssessment(syntheticInputs({ career: null, terms }));
    // Cơ sở lập trình counts with its F (3,0) at HK231 and HK232 and with its B (7,0) from HK233.
    expect(result.history.map((point) => [point.term, point.gradedCourses, groupScore(point, "Chuyên môn"), groupScore(point, "Kiến thức nền tảng")])).toEqual([
      ["HK231", 2, 30, 72.85], ["HK232", 3, 61.25, 72.85], ["HK233", 3, 76.25, 84.28],
    ]);
    // An earlier point is the calculation on the transcript cut after its term.
    const upToHK232 = calculateAssessment(syntheticInputs({ career: null, terms: terms.slice(0, 3) }));
    expect({ overall: result.history[1]!.overall, groups: result.history[1]!.groups }).toEqual(asPoint(upToHK232));
    // Without the "Điểm bảo lưu" course, Kiến thức nền tảng starts from the F alone.
    expect(groupScore(calculateAssessment(syntheticInputs({ career: null, terms: terms.slice(1) })).history[0]!, "Kiến thức nền tảng")).toBe(30);
  });

  it("makes one point of two sections of a term and none without a graded term", () => {
    const split = calculateAssessment(syntheticInputs({ career: null, terms: [
      { year: "2023-2024", semester: "HK01", rows: [["71ITBS10103", 3, 9, 4, "A"]] },
      { year: "2023-2024", semester: "HK01", rows: [["71ITBS10203", 3, 3, 0, "F"]] },
    ] }));
    expect(split.history.map((point) => [point.term, point.gradedCourses])).toEqual([["HK231", 2]]);
    // Only "Điểm bảo lưu", or terms with registrations only.
    expect(calculateAssessment(syntheticInputs({ terms: [{ rows: [["71ENG010012", 2, null, null, "MT"]] }] })).history).toEqual([]);
    expect(calculateAssessment(syntheticInputs({ terms: [{ year: "2025-2026", semester: "HK01", rows: [["71ITSE41203", 3]] }] })).history).toEqual([]);
  });
});

describe("data warnings (spec §7.10)", () => {
  const codes = (inputs: AssessmentInputs) => calculateAssessment(inputs).warnings.map((warning) => warning.code);

  it("warns about weights from another revision and low weight coverage", () => {
    const inputs = syntheticInputs();
    inputs.weights = { ...inputs.weights, revisionId: "00000000-0000-4000-8000-0000000000ff", version: 0 };
    inputs.weights.links = inputs.weights.links.filter((link) => link.courseCode.startsWith("71ITBS") || link.courseCode.startsWith("71ITSE"));
    const warnings = calculateAssessment(inputs).warnings;
    expect(warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(["weights_revision_differs", "weights_coverage_low"]));
    for (const warning of warnings) expect(warning.consequence.length).toBeGreaterThan(10);
  });

  it("warns about OCR review, missing or ambiguous plans and unknown specialty values", () => {
    const ocr = syntheticTranscript(syntheticStudentTerms(), "vlu-ocr-1.1");
    ocr.ocr = { needsReview: true, pages: [], semesters: [] };
    expect(codes(syntheticInputs({ transcript: ocr }))).toContain("transcript_needs_review");
    const noPlan = calculateAssessment(syntheticInputs({ plan: false }));
    expect(noPlan.progress).toBeNull();
    expect(noPlan.warnings.map((warning) => warning.code)).toContain("plan_unavailable");
    expect(codes({ ...syntheticInputs(), plan: { resolution: "ambiguous", revision: null } })).toContain("plan_ambiguous");
    const odd = syntheticInputs();
    odd.curriculum.courses.push({ code: "71ITNW99903", name: "An ninh mạng", credits: 3, type: "BB", block: "", specialty: "An ninh Mạng và IoTs", semester: 1, studyYear: 4 });
    expect(calculateAssessment(odd).warnings.find((warning) => warning.code === "specialty_value_unknown")?.details).toEqual(["An ninh Mạng và IoTs"]);
  });

  it("treats the 'An ninh Mạng và IoT' courses of a K27 CTĐT as the ANM specialty (2026-10-23)", () => {
    const k27 = (specialty: SpecialtyCode | null) => {
      const inputs = syntheticInputs({ specialty });
      inputs.student = { ...inputs.student, cohortCode: "K27" };
      inputs.curriculum.courses.push({ code: "71ITNW40503", name: "Quản trị Mạng", credits: 3, type: "BB", block: "", specialty: "An ninh Mạng và IoT", semester: 1, studyYear: 4 });
      return calculateAssessment(inputs);
    };
    const cnpm = k27("CNPM"), anm = k27("ANM");
    expect(cnpm.warnings.map((warning) => warning.code)).not.toContain("specialty_value_unknown");
    expect(cnpm.courses.find((course) => course.code === "71ITNW40503")).toMatchObject({ specialty: "ANM", applicable: false });
    expect(anm.courses.find((course) => course.code === "71ITNW40503")).toMatchObject({ specialty: "ANM", applicable: true });
    expect(anm.warnings.map((warning) => warning.code)).not.toContain("specialty_not_in_curriculum");
  });

  it("gives a K28 student 'Không theo chuyên ngành' the general standard's course list (2026-10-23)", () => {
    // A CNDL elective the general standard lists (71ITDS49903) next to one it does not (71ITDS40303), both not taken.
    const base = syntheticInputs({ specialty: "CNPM" });
    base.curriculum.courses.push({ code: "71ITDS49903", name: "Môn tự chọn CNDL", credits: 3, type: "TC309", block: "", specialty: "Công nghệ Dữ liệu", semester: 1, studyYear: 4 });
    const original = base.graduation.standard!;
    const standard = { ...original, data: { ...original.data, courses: [...original.data.courses,
      { id: "kcn", groupId: original.data.courses[0]!.groupId, code: "71ITDS49903", name: "Môn tự chọn CNDL", credits: 3, conditionOnly: false, sourceRow: 999 }] } };
    const run = (specialty: SpecialtyCode | null) => calculateAssessment({ ...base, student: { ...base.student, cohortCode: "K28", specialty },
      graduation: { resolution: "general", standard } });
    const kcn = run("KCN"), unset = run(null);
    const codes = kcn.warnings.map((warning) => warning.code);
    expect(codes).not.toContain("specialty_not_in_curriculum");
    expect(codes).not.toContain("specialty_conflict");
    expect(kcn.courses.find((course) => course.code === "71ITDS49903")).toMatchObject({ specialty: "CNDL", state: "not_taken", applicable: true });
    expect(kcn.courses.find((course) => course.code === "71ITDS40303")).toMatchObject({ specialty: "CNDL", state: "not_taken", applicable: false });
    // "Chưa xác định" still uses the general standard only as a fallback: its electives do not apply.
    expect(unset.courses.find((course) => course.code === "71ITDS49903")).toMatchObject({ applicable: false });
  });

  it("reports a credit mismatch when printed results need no inference", () => {
    const terms = mapTerms((row) => [row[0], row[1], row[2] ?? null, row[3] ?? null, row[4] ?? null, row[4] === "F" ? "Không đạt" : row[2] !== undefined && row[4] !== "MT" ? "Đạt" : null]);
    terms[5]!.summaries = [["Tổng số tín chỉ tích lũy", "30"]];
    const result = calculateAssessment(syntheticInputs({ terms }));
    expect(result.transcript.inferredCount).toBe(0);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["credits_mismatch"]);
  });
});

describe("a course retaken under another code (comp-calc-v17)", () => {
  // The synthetic student fails Lập trình ứng dụng Web (71ITSE30503) in HK241 and passes it with a later cohort, under that
  // cohort's code 71ITWB30503, in HK243 ("học trả nợ với khóa sau"; K26: DIT0070 F, then 71ITIS30103 B).
  const retaken = (): TranscriptData => {
    const terms = syntheticStudentTerms().map((term, index) => index === 4
      ? { ...term, rows: term.rows.map((row): TranscriptRow => (row[0] === "71ITSE30503" ? ["71ITSE30503", 3, 3, 0, "F"] : row)) }
      : index === 5 ? { ...term, rows: [...term.rows, ["71ITWB30503", 3, 9, 4, "A"] as TranscriptRow] } : term);
    const data = syntheticTranscript(terms);
    for (const section of data.sections) for (const course of section.courses) {
      if (course.code === "71ITSE30503" || course.code === "71ITWB30503") course.name = "Lập trình ứng dụng Web";
    }
    return data;
  };
  const check = (result: AssessmentResult) => {
    expect(result.courses.find((course) => course.code === "71ITSE30503")).toMatchObject({ state: "passed", score10: 9, letter: "A", attempts: 2, term: "HK243" });
    // Phát triển web is scored from the A (90), no longer from the F (30).
    expect(byName(result, "Phát triển web")).toMatchObject({ status: "scored", score: 90 });
    // Not late, not failed, not outside the CTĐT; the credits match the printed 27 again.
    expect(result.progress!.late.filter((entry) => entry.kind === "course").map((entry) => entry.kind === "course" && entry.code)).not.toContain("71ITSE30503");
    expect(result.transcript).toMatchObject({ failed: 0, creditCheck: { computed: 27, printed: 27, status: "match" } });
    expect(result.transcript.notInCurriculum.map((course) => course.code)).not.toContain("71ITWB30503");
    expect(result.warnings.map((warning) => warning.code)).not.toContain("credits_mismatch");
  };

  it("counts the retake for its CTĐT course in the competency table, the progress and the transcript summary", () => {
    const result = calculateAssessment(syntheticInputs({ transcript: retaken() }));
    check(result);
    // The history keeps the F at HK241, the term before the retake.
    const web = result.career!.requirements.find((req) => req.title === "Phát triển web")!;
    const at = (term: string) => result.history.find((point) => point.term === term)!.career!.requirements.find((req) => req.requirementId === web.requirementId);
    expect([at("HK241"), at("HK243")]).toEqual([
      { requirementId: web.requirementId, score: 30, status: "below" }, { requirementId: web.requirementId, score: 90, status: "met" },
    ]);
  });

  it("does the same from the CTĐT's own course names without a graduation standard", () => {
    check(calculateAssessment({ ...syntheticInputs({ transcript: retaken() }), graduation: { resolution: "not_found", standard: null } }));
  });

  it("never takes the attempts of one CTĐT course for another", () => {
    // Both codes are CTĐT courses with the same name: each keeps its own attempts.
    const inputs = syntheticInputs({ transcript: retaken() });
    inputs.curriculum.courses.push({ code: "71ITWB30503", name: "Lập trình ứng dụng Web", credits: 3, type: "BB", block: "", specialty: "", semester: 3, studyYear: 2 });
    const result = calculateAssessment({ ...inputs, graduation: { resolution: "not_found", standard: null } });
    expect(result.courses.find((course) => course.code === "71ITSE30503")).toMatchObject({ state: "failed", score10: 3 });
    expect(result.courses.find((course) => course.code === "71ITWB30503")).toMatchObject({ state: "passed", score10: 9 });
  });
});

describe("audit of the competency pages (comp-calc-v17)", () => {
  it("marks a suggested course whose planned term has passed as overdue, and keeps the term being studied", () => {
    // Lập trình ứng dụng Web failed in HK241: the retake is suggested for Phát triển web, its plan term long gone.
    const failed = calculateAssessment(syntheticInputs({ terms: mapTerms((row) => (row[0] === "71ITSE30503" ? ["71ITSE30503", 3, 3, 0, "F"] : row)) }));
    const web = failed.career!.requirements.find((req) => req.title === "Phát triển web")!;
    expect(web.supportCourses.map((course) => [course.code, course.term, course.overdue])).toEqual([["71ITSE30503", "HK241", true]]);
    expect(failed.transcript).toMatchObject({ latestTerm: "HK243", studyTerm: "HK251" });
    // Planned after the term being studied: not overdue.
    const presenting = calculateAssessment(syntheticInputs({ career: career([[SKILL.presenting, false]]) })).career!.requirements[0]!;
    expect(presenting.supportCourses.map((course) => [course.code, course.term, course.overdue])).toEqual([["71ITGR40206", "HK261", false], ["71ITIN40304", "HK253", false]]);
  });

  it("scores a 0-credit GDTC/GDQP course with a nominal credit and keeps it a condition-only skill (K27/K28)", () => {
    const base = syntheticInputs();
    const zero = { ...base, curriculum: { ...base.curriculum, courses: base.curriculum.courses.map((course) => (course.code === "71NAD110013" ? { ...course, credits: 0 } : course)) } };
    const before = calculateAssessment(base), after = calculateAssessment(zero);
    // Before v17 it had no weight at all: not applicable ("no_credits"), listed as outside the student's choices.
    expect(byName(after, "Kiến thức quốc phòng")).toMatchObject({ status: "scored", score: 70, conditionOnly: true, notApplicableReason: null, denominator: 1 });
    expect(after.overall).toEqual(before.overall);
    expect(after.groups).toEqual(before.groups);
  });

  it("names only the non-zero counts of the career line, in a fixed order, and counts the skills with a score", () => {
    type Req = Parameters<typeof careerSummaryOf>[0][number];
    const req = (status: Req["status"], score: number | null = null, noDataReason: Req["noDataReason"] = null): Req => ({ status, score, noDataReason });
    // The K28 case: 4/6 met and 2 not studied read "· 0 sắp học · 0 chưa đủ dữ liệu" and "6/6 kỹ năng có dữ liệu".
    const k28 = [req("met", 85), req("met", 90), req("met", 70), req("met", 81), req("not_studied"), req("not_studied")];
    expect(careerSummaryOf(k28)).toBe("Đạt 4/6 kỹ năng · 2 chưa học");
    expect(careerDataTextOf(k28)).toBe("4/6 kỹ năng có điểm");
    expect(careerSummaryOf([
      req("no_data", null, "not_measured"), req("upcoming"), req("no_data", null, "elective_not_chosen"), req("not_studied"),
      req("below", 50), req("met", 90), req("met", null), req("no_data", null, "other_specialty"),
    ])).toBe("Đạt 2/8 kỹ năng · 1 dưới ngưỡng · 1 chưa học · 1 sắp học · 2 cần tự học · 1 chưa đủ dữ liệu");
    expect(careerSummaryOf([])).toBe("Đạt 0/0 kỹ năng");
  });

  it("lists only scored skills as similar skills of a self-study skill", () => {
    // Docker's similar skill "Docker cơ bản" has no course studied yet: it is no context for self-study.
    const inputs = syntheticInputs();
    inputs.weights.skills.push({ skillId: "00000000-0000-4000-8000-0000000000f9", name: "Docker cơ bản", description: "", scope: "", groupId: inputs.weights.groups[2]!.id });
    inputs.weights.links.push({ courseCode: "71ITSE30803", skillId: "00000000-0000-4000-8000-0000000000f9", weight: 1 });
    inputs.weights.skills.push({ skillId: "00000000-0000-4000-8000-0000000000fa", name: "Docker nâng cao", description: "", scope: "", groupId: inputs.weights.groups[2]!.id });
    inputs.weights.links.push({ courseCode: "71ITSE30503", skillId: "00000000-0000-4000-8000-0000000000fa", weight: 0.2 });
    const result = calculateAssessment(inputs);
    const docker = result.selfStudy.find((item) => item.name === "Docker")!;
    expect(docker.relatedSkillKeys.map((key) => result.skillDirectory.find((entry) => entry.key === key)!.name)).toEqual(["Docker nâng cao"]);
  });

  it("counts the next term in courses and spaces the plan's choice labels", () => {
    const inputs = syntheticInputs({ terms: syntheticStudentTerms().slice(0, 4) });
    const plan = inputs.plan.resolution === "found" ? inputs.plan.revision.data : null;
    plan!.sections = plan!.sections.map((section) => (section.id === "section-36" ? { ...section, label: "Chọn2 trong 2 môn sau" } : section));
    const progress = calculateAssessment(inputs).progress!;
    // HK241: Lập trình ứng dụng Web and two courses of "Chọn 2 trong 2": 3 courses, 2 entries.
    expect(progress).toMatchObject({ currentTerm: "HK233", nextTerm: "HK241", nextCount: 3, nextCredits: 9 });
    expect(progress.next.map((entry) => (entry.kind === "course" ? entry.code : entry.label))).toEqual(["71ITSE30503", "Chọn 2 trong 2 môn sau"]);
  });
});

describe("determinism", () => {
  it("returns the same result whatever the input order", () => {
    const inputs = syntheticInputs();
    const reversed = structuredClone(inputs);
    reversed.curriculum.courses.reverse();
    reversed.curriculum.relations.reverse();
    reversed.weights.links.reverse();
    reversed.weights.skills.reverse();
    reversed.weights.groups.reverse();
    reversed.career!.requirements.reverse();
    expect(calculateAssessment(reversed)).toEqual(calculateAssessment(inputs));
  });
});
