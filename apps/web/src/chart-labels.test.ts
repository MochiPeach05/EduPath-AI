import { describe, expect, it } from "vitest";
import { fitAxisLabels, shortYear, yearAxisLabels } from "./chart-labels";

describe("chart axis labels (user 2026-11-04: no text over text)", () => {
  it("keeps the labels that fit side by side, the newest first", () => {
    const terms = (step: number) => ["HK1", "HK2", "HK3", "HK1", "HK2"].map((text, i) => ({ x: 40 + i * step, text }));
    expect(fitAxisLabels(terms(40), 12.8)).toEqual([true, true, true, true, true]);
    expect(fitAxisLabels(terms(26), 12.8)).toEqual([true, false, true, false, true]);
    expect(fitAxisLabels([], 12.8)).toEqual([]);
  });

  it("shortens the school years when that shows more of them", () => {
    expect(shortYear("2023–2024")).toBe("23–24");
    const years = (step: number) => ["2023–2024", "2024–2025", "2025–2026"].map((year, i) => ({ year, x: 40 + i * step }));
    expect(yearAxisLabels(years(90)).map((label) => [label.text, label.shown])).toEqual([["2023–2024", true], ["2024–2025", true], ["2025–2026", true]]);
    expect(yearAxisLabels(years(50)).map((label) => [label.text, label.shown])).toEqual([["23–24", true], ["24–25", true], ["25–26", true]]);
    expect(yearAxisLabels(years(30)).map((label) => label.shown)).toEqual([true, false, true]);
  });
});
