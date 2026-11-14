import { describe, expect, it } from "vitest";
import { academicSections, foldText, formatUpdatedAt, latestResultSection, printedSemesterGpa, profileSectionOf } from "./student-overview-data";
import type { Transcript } from "./StudentTranscript";

type Section = Transcript["data"]["sections"][number];
function section(id: string, score: number | null = null): Section {
  const [year, semester] = id.split("/");
  return {
    id, label: id, academicYear: year, semester, summaries: [], courses: [
      { ordinal: 1, code: "71IT000001", name: "Sample course", credits: 3, score10: score, score4: null, letter: null, result: null, conditional: false, sourcePage: 1 }
    ]
  };
}
describe("student overview academic data", () => {
  it("excludes transfer sections, sorts terms, and leaves source order unchanged", () => {
    const sections = [section("2025-2026/HK01"), { ...section("transfer/HK01"), academicYear: null, semester: null }, section("2024-2025/HK03")];
    const transcript = { data: { sections } } as Transcript;
    expect(academicSections(transcript).map(value => value.id)).toEqual(["2024-2025/HK03", "2025-2026/HK01"]);
    expect(sections[0].id).toBe("2025-2026/HK01");
  });
  it("shows the latest graded term instead of future ungraded registration", () => {
    const graded = section("2025-2026/HK02", 0);
    expect(latestResultSection([section("2025-2026/HK01", 8), graded, section("2025-2026/HK03")])).toBe(graded);
  });
  it("handles an empty transcript and falls back to the latest ungraded term", () => {
    expect(academicSections(null)).toEqual([]);
    expect(latestResultSection([])).toBeUndefined();
    const latest = section("2025-2026/HK03");
    expect(latestResultSection([section("2025-2026/HK02"), latest])).toBe(latest);
  });
  it("uses the printed semester GPA, not cumulative GPA or a computed average", () => {
    const term = section("2025-2026/HK02", 9);
    term.summaries = [{ label: "Điểm TB tích lũy (Hệ 4)", value: "3.10" }, { label: "Điểm TB học kỳ (Hệ 4)", value: "3.41" }];
    expect(printedSemesterGpa(term)).toBe("3.41");
    term.summaries.pop();
    expect(printedSemesterGpa(term)).toBeNull();
  });
  it("reads the semester GPA also when the label is written out", () => {
    const term = section("2025-2026/HK02", 9);
    term.summaries = [{ label: "Điểm trung bình tích lũy hệ 4", value: "3.10" }, { label: "Điểm trung bình học kỳ hệ 4", value: "3.52" }];
    expect(printedSemesterGpa(term)).toBe("3.52");
    term.summaries = [{ label: "Điểm trung bình học kỳ hệ 10", value: "8.10" }];
    expect(printedSemesterGpa(term)).toBeNull();
  });
});

describe("profile helpers", () => {
  it("folds Vietnamese marks and đ for matching", () => {
    expect(foldText("Đồ án Tốt nghiệp")).toBe("do an tot nghiep");
    expect(foldText("ĐIỂM TB HỌC KỲ")).toBe("diem tb hoc ky");
  });
  it("writes update times as HH:mm dd/MM/yyyy in Vietnam time, without seconds", () => {
    expect(formatUpdatedAt("2026-10-22T21:02:43.000Z")).toBe("04:02 23/10/2026");
    expect(formatUpdatedAt("2026-10-23T17:00:05.000Z")).toBe("00:00 24/10/2026");
    expect(formatUpdatedAt("not a date")).toBe("—");
  });
  it("opens the transcript of Hồ sơ và bảng điểm for the transcript and the specialty, chosen in its import (2026-11-14)", () => {
    // The target vị trí nghề nghiệp and Khảo sát nhanh live on Định hướng nghề nghiệp, not on this page.
    expect(["transcript", "specialty", "career", "survey", "other"].map(profileSectionOf))
      .toEqual(["bang-diem", "bang-diem", undefined, undefined, undefined]);
  });
});
