import { describe, expect, it } from "vitest";
import { addressesIn, checkAnswer, codesIn } from "./validate.js";

const context = { sourceCount: 3, allowedUrls: ["https://developer.mozilla.org/vi/docs/Learn"], knownCodes: ["71ITSE30103"] };

describe("assistant answer check", () => {
  it("keeps citations to the prompt's sources, splits lists and drops the others", () => {
    const checked = checkAnswer("Bạn còn thiếu SQL [2]. Nên học Lập trình Web [1, 3] và [7].", context);
    expect(checked.content).toBe("Bạn còn thiếu SQL [2]. Nên học Lập trình Web [1][3] và.");
    expect(checked.cited).toEqual([1, 2, 3]);
    expect(checked.warnings).toContain("citation_removed");
  });

  it("keeps only the links of the self-study resources it was given", () => {
    const checked = checkAnswer("Xem https://developer.mozilla.org/vi/docs/Learn/. Hoặc https://bit.ly/abc nhé, và [MDN](https://developer.mozilla.org/vi/docs/Learn).", context);
    expect(checked.content).toBe("Xem https://developer.mozilla.org/vi/docs/Learn/. Hoặc nhé, và MDN: https://developer.mozilla.org/vi/docs/Learn.");
    expect(checked.warnings).toEqual(["link_removed"]);
  });

  it("reports course codes the data did not hold and cleans markdown headings", () => {
    const checked = checkAnswer("## Gợi ý\nHọc 71ITSE30103 rồi 71ITAI99999.", context);
    expect(checked.content).toBe("Gợi ý\nHọc 71ITSE30103 rồi 71ITAI99999.");
    expect(checked.warnings).toEqual(["unknown_code:71ITAI99999"]);
  });

  it("finds the addresses and codes of a prompt block", () => {
    expect(addressesIn("a https://x.org/a. b http://y.org c https://x.org/a/")).toEqual(["https://x.org/a"]);
    expect(codesIn("71itse30103 và DQP0061, DQP0061")).toEqual(["DQP0061"]);
  });
});
