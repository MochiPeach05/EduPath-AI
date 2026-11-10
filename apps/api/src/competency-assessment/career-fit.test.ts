import { describe, expect, it } from "vitest";
import { assessWithCareerFits, assessWithoutHistory, calculateAssessment, careerFitsFor } from "./calculate.js";
import { SKILL, syntheticCareer, syntheticInputs } from "./fixtures/synthetic-k29.js";
import type { CareerInput } from "./types.js";

// Synthetic K29 data only. The career fit of the target career is the same through careerFitsFor.
describe("careerFitsFor", () => {
  it("gives each career the fit the full assessment gives the target career, fast enough for a page", () => {
    const inputs = syntheticInputs();
    const career = syntheticCareer();
    const full = calculateAssessment(inputs).career!;
    const started = performance.now();
    const fits = careerFitsFor(inputs, Array.from({ length: 30 }, () => career));
    const elapsed = performance.now() - started;
    expect(fits).toHaveLength(30);
    expect(fits[0]).toEqual(full);
    // About 35 ms on the synthetic student (2026-10-24); generous bound for slow machines.
    expect(elapsed).toBeLessThan(3000);
  });

  // 2026-11-10: one run of the engine for every career (it ran once per career). Each career's part must equal what a
  // whole run with that career as the target gives, whatever the target career of the inputs.
  const fakeSkill = (index: number) => `00000000-0000-4000-8000-0000000f${String(index).padStart(4, "0")}`;
  const requirement = (index: number, skillId: string | null, skillName: string | null, isRequired: boolean) =>
    ({ id: `00000000-0000-4000-8000-00000000e${String(index).padStart(3, "0")}`, skillId, skillName, title: skillName ?? `Yêu cầu ${index}`, isRequired });
  const careers = (): CareerInput[] => {
    const base = syntheticCareer();
    return [
      base,
      { ...base, id: "00000000-0000-4000-8000-0000000c0002", code: "NN902", nameVi: "Nghề đã xóa", deleted: true },
      // Skills no course measures (career-only keys), a requirement without a skill, required and preferred.
      { ...base, id: "00000000-0000-4000-8000-0000000c0003", code: "NN903", nameVi: "Nghề có kỹ năng chưa đo", requirements: [
        requirement(1, SKILL.web, "Phát triển web", true), requirement(2, fakeSkill(1), "Kỹ năng chưa đo B", true),
        requirement(3, fakeSkill(2), "Kỹ năng chưa đo A", false), requirement(4, null, null, false), requirement(5, SKILL.mobile, "Lập trình di động", false),
      ] },
      // So many career-only skills that every key gets three digits (S001 …): the keys of this career differ from the others'.
      { ...base, id: "00000000-0000-4000-8000-0000000c0004", code: "NN904", nameVi: "Nghề nhiều kỹ năng", requirements: [
        requirement(10, SKILL.programming, "Lập trình", true), requirement(11, SKILL.database, "Cơ sở dữ liệu", false),
        ...Array.from({ length: 120 }, (_, index) => requirement(20 + index, fakeSkill(100 + index), `Kỹ năng ngoài CTĐT ${index}`, index % 3 === 0)),
      ] },
      { ...base, id: "00000000-0000-4000-8000-0000000c0005", code: "NN905", nameVi: "Nghề chưa có yêu cầu", requirements: [] },
    ];
  };
  const alone = (inputs: ReturnType<typeof syntheticInputs>, list: CareerInput[]) => list.map((career) => assessWithoutHistory({ ...inputs, career }).career);

  it("equals a whole run per career, with or without a target career, keys of every width included", () => {
    const list = careers();
    for (const target of [null, syntheticCareer(), list[3]!]) {
      const inputs = { ...syntheticInputs(), career: target };
      const fits = careerFitsFor(inputs, list);
      expect(fits).toEqual(alone(inputs, list));
      // The three-digit keys of the long career, two digits elsewhere.
      expect(fits[3]!.requirements.some((row) => row.skillKey?.length === 4)).toBe(true);
      expect(fits[0]!.requirements.every((row) => row.skillKey === null || row.skillKey.length === 3)).toBe(true);
    }
  });

  it("assessWithCareerFits gives assessWithoutHistory and careerFitsFor from one run", () => {
    const list = careers();
    for (const target of [null, syntheticCareer()]) {
      const inputs = { ...syntheticInputs(), career: target };
      const both = assessWithCareerFits(inputs, list);
      expect(both.assessment).toEqual(assessWithoutHistory(inputs));
      expect(both.careerFits).toEqual(alone(inputs, list));
    }
    // Without other careers the result is the plain assessment, nothing added to it.
    const inputs = syntheticInputs();
    expect(assessWithCareerFits(inputs, []).assessment).toEqual(assessWithoutHistory(inputs));
    expect(Object.keys(calculateAssessment(inputs))).not.toContain("careerFits");
  });
});
