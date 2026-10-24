import { describe, expect, it } from "vitest";
import { calculateAssessment, careerFitsFor } from "./calculate.js";
import { syntheticCareer, syntheticInputs } from "./fixtures/synthetic-k29.js";

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
});
