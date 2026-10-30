import { describe, expect, it } from "vitest";
import { termName, termsNamedIn } from "./term-name.js";

describe("term names", () => {
  it("write a term one way", () => {
    expect(termName("HK261")).toBe("HK1 2026–2027");
    expect(termName("HK253")).toBe("HK3 2025–2026");
    expect(termName("khác")).toBe("khác");
  });

  it("find every term an AI text names", () => {
    expect(termsNamedIn("Học lại Lập trình ứng dụng Web ở HK1 2025–2026.")).toEqual(["HK251"]);
    expect(termsNamedIn("Đăng ký ở học kỳ 2 năm học 2026-2027 hoặc HK1 · 2027–2028.").sort()).toEqual(["HK262", "HK271"]);
    expect(termsNamedIn("Môn này mở ở HK262, sau đó HK3 2026–2027.").sort()).toEqual(["HK262", "HK263"]);
    expect(termsNamedIn("Năm 2026 bạn nên học thêm.")).toEqual([]);
    expect(termsNamedIn("HK1 2026–2028 không phải một năm học.")).toEqual([]);
  });
});
