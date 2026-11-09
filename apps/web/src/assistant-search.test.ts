import { describe, expect, it } from "vitest";
import { matchRanges, searchWords, titleHas } from "./assistant-search";

// Tìm cuộc trò chuyện (2026-11-09): words compared as the server compares them. Synthetic texts only.
describe("the words of a search", () => {
  it("are compared without accents or case, each once, and only from two letters on", () => {
    expect(searchWords("  Điều KIỆN  điều kiện, “tốt nghiệp”?")).toEqual(["dieu", "kien", "tot", "nghiep"]);
    expect(searchWords("ĐỒ ÁN")).toEqual(["do", "an"]);
    expect(searchWords("a")).toEqual([]);
    expect(searchWords("…  ?")).toEqual([]);
    expect(searchWords("x".repeat(150))).toEqual(["x".repeat(100)]);
  });

  it("find a title holding every word, typed with or without accents", () => {
    const title = "Điều kiện xét tốt nghiệp của khóa mình là gì?";
    expect(titleHas(title, searchWords("dieu kien"))).toBe(true);
    expect(titleHas(title, searchWords("TỐT NGHIỆP khóa"))).toBe(true);
    expect(titleHas(title, searchWords("tốt nghiệp đồ án"))).toBe(false);
    expect(titleHas(title, [])).toBe(false);
  });

  it("mark where the words stand in the text as printed, overlaps merged", () => {
    const text = "Cơ sở dữ liệu nâng cao, cơ sở";
    expect(matchRanges(text, searchWords("co so")).map(([start, end]) => text.slice(start, end))).toEqual(["Cơ sở", "cơ sở"]);
    expect(matchRanges(text, searchWords("du lieu nang")).map(([start, end]) => text.slice(start, end))).toEqual(["dữ liệu nâng"]);
    expect(matchRanges("Đồ án", ["do"])).toEqual([[0, 2]]);
    expect(matchRanges("Không có", ["sql"])).toEqual([]);
  });
});
