import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decimalComma, formatAnswer, parseAnswer, parseInline, safeHttpsUrl, type AnswerFormatOptions } from "./assistant-format";
import type { AssistantSource } from "./assistant-types";

const html = (text: string, options?: AnswerFormatOptions) => renderToStaticMarkup(createElement(Fragment, null, ...formatAnswer(text, options)));
const sources: AssistantSource[] = [
  { n: 1, kind: "assessment", title: "Kết quả Đánh giá năng lực", link: "#competency" },
  { n: 2, kind: "resource", title: "Tài liệu tự học", link: "https://example.edu/docker" },
];

describe("answer blocks", () => {
  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    expect(parseAnswer("Dòng một\nDòng hai\n\nĐoạn hai").map((block) => block.kind)).toEqual(["paragraph", "paragraph"]);
    expect(html("Dòng một\nDòng hai\n\nĐoạn hai")).toBe("<p>Dòng một<br/>Dòng hai</p><p>Đoạn hai</p>");
  });

  it("makes one list of consecutive bullets, also across blank lines, and keeps the first number of a numbered list", () => {
    expect(html("Bạn cần:\n- Kiểm thử\n\n- Cơ sở dữ liệu\nSau đó:\n3. Học A\n4. Học B")).toBe(
      "<p>Bạn cần:</p><ul><li>Kiểm thử</li><li>Cơ sở dữ liệu</li></ul><p>Sau đó:</p><ol start=\"3\"><li>Học A</li><li>Học B</li></ol>");
    expect(html("1. Một\n2. Hai")).toBe("<ol><li>Một</li><li>Hai</li></ol>");
    expect(html("* Sao\n• Chấm")).toBe("<ul><li>Sao</li><li>Chấm</li></ul>");
  });

  it("continues a list item with an indented line right under it", () => {
    expect(html("1. **Học phần A**\n   Lý do: còn thiếu kỹ năng.\n2. Học phần B")).toBe(
      "<ol><li><strong>Học phần A</strong><br/>Lý do: còn thiếu kỹ năng.</li><li>Học phần B</li></ol>");
  });

  it("shows a markdown heading as a bold line, without the hashes", () => {
    expect(html("### Kết luận\nBạn đã sẵn sàng.")).toBe('<p class="as-answer-heading"><strong>Kết luận</strong></p><p>Bạn đã sẵn sàng.</p>');
  });

  it("needs a space after the list mark, so numbers and dashes inside a sentence stay text", () => {
    expect(parseAnswer("-5 điểm\n2026.Năm học")[0]).toEqual({ kind: "paragraph", lines: [[{ kind: "text", text: "-5 điểm" }], [{ kind: "text", text: "2026.Năm học" }]] });
  });
});

describe("answer lines", () => {
  it("reads bold, citations and addresses", () => {
    expect(parseInline("**Kiểm thử** còn thiếu [1], xem https://example.edu/docker.")).toEqual([
      { kind: "bold", children: [{ kind: "text", text: "Kiểm thử" }] },
      { kind: "text", text: " còn thiếu " },
      { kind: "cite", n: 1 },
      { kind: "text", text: ", xem " },
      { kind: "link", href: "https://example.edu/docker", text: "https://example.edu/docker" },
      { kind: "text", text: "." },
    ]);
  });

  it("shows score-like decimals with a comma, also in answers stored before, but not in addresses or versions", () => {
    expect(parseInline("GPA tích lũy của bạn là **2.45** [1], tăng từ 2.10.")).toEqual([
      { kind: "text", text: "GPA tích lũy của bạn là " },
      { kind: "bold", children: [{ kind: "text", text: "2,45" }] },
      { kind: "text", text: " " },
      { kind: "cite", n: 1 },
      { kind: "text", text: ", tăng từ 2,10." },
    ]);
    expect(parseInline("Xem https://example.edu/v2.10/a")).toEqual([
      { kind: "text", text: "Xem " }, { kind: "link", href: "https://example.edu/v2.10/a", text: "https://example.edu/v2.10/a" },
    ]);
    for (const kept of ["Python 3.12", "phiên bản 3.12", "ngày 30.10.2026", "192.168.1.1"]) expect(decimalComma(kept)).toBe(kept);
    expect(decimalComma("Điểm TB tích lũy (Hệ 4): 3.10; IELTS 6.5")).toBe("Điểm TB tích lũy (Hệ 4): 3,10; IELTS 6,5");
  });

  it("reads [1, 2] as two citations and keeps a lone ** as text", () => {
    expect(parseInline("Theo [1, 2] và ** thôi")).toEqual([
      { kind: "text", text: "Theo " }, { kind: "cite", n: 1 }, { kind: "cite", n: 2 }, { kind: "text", text: " và ** thôi" },
    ]);
  });

  it("ends a bare address before the punctuation, a bracket or a bold mark after it", () => {
    expect(parseInline("(https://example.edu/a)")).toEqual([{ kind: "text", text: "(" }, { kind: "link", href: "https://example.edu/a", text: "https://example.edu/a" }, { kind: "text", text: ")" }]);
    expect(parseInline("https://vi.wikipedia.org/wiki/Docker_(phần_mềm)")[0]).toMatchObject({ kind: "link", text: "https://vi.wikipedia.org/wiki/Docker_(phần_mềm)" });
    expect(parseInline("https://example.edu/a[2]")).toEqual([{ kind: "link", href: "https://example.edu/a", text: "https://example.edu/a" }, { kind: "cite", n: 2 }]);
    expect(parseInline("**https://example.edu/a**")).toEqual([{ kind: "bold", children: [{ kind: "link", href: "https://example.edu/a", text: "https://example.edu/a" }] }]);
  });

  it("links only https:// addresses", () => {
    expect(parseInline("http://example.edu javascript:alert(1) ftp://example.edu").every((piece) => piece.kind === "text")).toBe(true);
    expect(parseInline("[bấm vào đây](javascript:alert(1))")).toEqual([{ kind: "text", text: "[bấm vào đây](javascript:alert(1))" }]);
    expect(parseInline("[Khóa học](https://example.edu/khoa-hoc)")).toEqual([{ kind: "link", href: "https://example.edu/khoa-hoc", text: "Khóa học" }]);
  });

  it("refuses addresses that hide a login or have no host", () => {
    expect(safeHttpsUrl("https://example.edu/a?b=1")).toBe("https://example.edu/a?b=1");
    expect(safeHttpsUrl("https://user:pass@example.edu")).toBeNull();
    expect(safeHttpsUrl("https://example.edu@evil.example")).toBeNull();
    expect(safeHttpsUrl("http://example.edu")).toBeNull();
    expect(safeHttpsUrl("https://")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("answer as React nodes", () => {
  it("escapes markup the model writes instead of running it", () => {
    const out = html('<img src=x onerror="alert(1)"> **<b>đậm</b>** <script>alert(1)</script>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(out).toContain("<strong>&lt;b&gt;đậm&lt;/b&gt;</strong>");
  });

  it("opens links in a new tab without handing over the page", () => {
    expect(html("Xem https://example.edu/docker")).toBe(
      '<p>Xem <a href="https://example.edu/docker" target="_blank" rel="noopener noreferrer">https://example.edu/docker<span class="sr-only"> (mở trong tab mới)</span></a></p>');
  });

  it("turns a citation with a known source into a button and leaves the others as [n]", () => {
    const out = html("Theo [1] và [3].", { sources, onCite: () => undefined });
    expect(out).toContain('<sup class="as-cite"><button type="button" class="as-cite-button" title="Kết quả Đánh giá năng lực" aria-label="Xem nguồn 1: Kết quả Đánh giá năng lực">1</button></sup>');
    expect(out).toContain('<sup class="as-cite">[3]</sup>');
    // While the answer is written there are no sources yet: no buttons.
    expect(html("Theo [1].")).toBe('<p>Theo <sup class="as-cite">[1]</sup>.</p>');
  });
});
