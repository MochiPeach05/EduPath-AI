import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckedForm, DescriptionField } from "./CheckedForm";

describe("CheckedForm", () => {
  it("turns the browser's own bubbles off and keeps an announcement for screen readers", () => {
    const html = renderToStaticMarkup(createElement(CheckedForm, { className: "cm-form" }, createElement("input", { required: true })));
    expect(html).toBe('<form class="cm-form" noValidate=""><input required=""/><p class="sr-only" role="alert"></p></form>');
  });
});

describe("DescriptionField", () => {
  const render = (value: string, maxWords = 200) =>
    renderToStaticMarkup(createElement(DescriptionField, { label: "Mô tả", value, maxWords, rows: 4, maxLength: 2000, onChange: () => {} }));

  it("counts the words under the description", () => {
    const html = render("Kỹ năng làm việc nhóm");
    expect(html).toMatch(/^<label>Mô tả<textarea rows="4" maxLength="2000" aria-describedby="([^"]+)">Kỹ năng làm việc nhóm<\/textarea><small id="\1" class="cm-word-count">5\/200 từ<\/small><\/label>$/);
  });

  it("turns the counter red past the limit", () => {
    const html = render(Array.from({ length: 201 }, () => "từ").join(" "));
    expect(html).toContain('class="cm-word-count cm-word-count-over">201/200 từ</small>');
    expect(render("một hai ba", 2)).toContain("cm-word-count-over");
  });
});
