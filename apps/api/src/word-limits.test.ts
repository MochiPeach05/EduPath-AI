import { describe, expect, it } from "vitest";
import { countWords, DESCRIPTION_MAX_WORDS, limitedText, LONG_DESCRIPTION_MAX_WORDS } from "./word-limits.js";

const words = (count: number) => Array.from({ length: count }, (_, index) => `từ${index}`).join(" ");

describe("description word limits", () => {
  it("counts runs of characters between spaces, ignoring extra spaces and line breaks", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    // Vietnamese words are counted by syllable, as word processors do: two words for one compound.
    expect(countWords(" Kỹ năng  làm việc\nnhóm. ")).toBe(5);
  });

  it("accepts up to the limit and refuses one word more", () => {
    const short = limitedText(2000, DESCRIPTION_MAX_WORDS);
    expect(short.safeParse(words(200)).success).toBe(true);
    expect(short.safeParse(words(201)).success).toBe(false);
    expect(short.parse("  Mô tả ngắn  ")).toBe("Mô tả ngắn");
    expect(limitedText(4000, LONG_DESCRIPTION_MAX_WORDS).safeParse(words(400)).success).toBe(true);
    expect(limitedText(4000, LONG_DESCRIPTION_MAX_WORDS).safeParse(words(401)).success).toBe(false);
  });
});
