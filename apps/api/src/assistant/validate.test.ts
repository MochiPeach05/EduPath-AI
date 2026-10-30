import { describe, expect, it } from "vitest";
import { addressesIn, checkAnswer, codesIn, compactCitations, decimalComma } from "./validate.js";

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

  it("drops empty citations and merges stacked ones into one sorted group (assistant-v6)", () => {
    const checked = checkAnswer("Môn này có 4 tín chỉ [7], [5], [12]. Chưa rõ []. Xem [2] [1].", { ...context, sourceCount: 12 });
    expect(checked.content).toBe("Môn này có 4 tín chỉ [5][7][12]. Chưa rõ. Xem [1][2].");
    expect(checked.cited).toEqual([1, 2, 5, 7, 12]);
  });

  it("keeps a source's last citation in each block, the others go with their space (assistant-v6)", () => {
    const checked = checkAnswer("Bạn cần học lại môn X [3].\n- Môn Y [3]\n- Môn Z [2][3]\n\nĐoạn sau [3].", context);
    expect(checked.content).toBe("Bạn cần học lại môn X.\n- Môn Y\n- Môn Z [2][3]\n\nĐoạn sau [3].");
    expect(checked.cited).toEqual([2, 3]);
    // A group keeps the numbers cited for the last time there.
    expect(compactCitations("A [1][2]. B [2].")).toBe("A [1]. B [2].");
    expect(compactCitations("Không có số nguồn.")).toBe("Không có số nguồn.");
  });

  it("writes score-like decimals with a comma, not versions, dates or addresses (assistant-v7)", () => {
    expect(checkAnswer("GPA tích lũy của bạn là 2.45 [1], học kỳ trước 1.85.", context).content).toBe("GPA tích lũy của bạn là 2,45 [1], học kỳ trước 1,85.");
    expect(decimalComma("Điểm TB tích lũy (Hệ 4): 3.10; GPA 2.45; IELTS 6.5; điểm C+ 6.6; (8.5)")).toBe("Điểm TB tích lũy (Hệ 4): 3,10; GPA 2,45; IELTS 6,5; điểm C+ 6,6; (8,5)");
    for (const kept of ["Python 3.12", "Node.js 20.11", "phiên bản 3.12", "ngày 30.10.2026", "192.168.1.1", "1.500.000 đồng", "3.141 điểm", "https://example.org/v2.10/a"]) {
      expect(decimalComma(kept)).toBe(kept);
    }
    // A numbered list and a sentence that ends on a number stay as they are.
    expect(decimalComma("1. Học lại môn X.\nBạn đạt 8.")).toBe("1. Học lại môn X.\nBạn đạt 8.");
  });

  it("finds the addresses and codes of a prompt block", () => {
    expect(addressesIn("a https://x.org/a. b http://y.org c https://x.org/a/")).toEqual(["https://x.org/a"]);
    expect(codesIn("71itse30103 và DQP0061, DQP0061")).toEqual(["DQP0061"]);
  });
});
