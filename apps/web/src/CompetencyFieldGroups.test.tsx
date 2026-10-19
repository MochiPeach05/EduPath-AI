import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldGroupsEditor } from "./CompetencyProfiles";
import type { CareerField } from "./career-types";
import type { Group } from "./competency-types";

const group = (id: string, name: string): Group => ({ id, name, description: "", isActive: true, version: "v", skillCount: 3 });
const field = (id: string, name: string) => ({ id, code: id, name, description: "", version: "v" }) as CareerField;
const groups = [group("g-core", "Chuyên môn"), group("g-soft", "Kỹ năng mềm")];
const fields = [field("f-test", "Kiểm thử & Chất lượng"), field("f-dev", "Phát triển phần mềm")];

describe("Nhóm năng lực theo lĩnh vực (2026-10-20)", () => {
  const render = (rows: { key: string; fieldId: string; groupId: string }[], fieldList = fields) =>
    renderToStaticMarkup(createElement(FieldGroupsEditor, { rows, setRows: () => {}, fields: fieldList, fieldsError: null, groups, defaultGroupId: "g-soft" }));

  it("explains the rule with the user's example and starts empty", () => {
    const html = render([]);
    expect(html).toContain("<legend>Nhóm năng lực theo lĩnh vực</legend>");
    expect(html).toContain("Đọc tài liệu là Kỹ năng mềm nhưng là Chuyên môn ở lĩnh vực Kiểm thử &amp; Chất lượng");
    expect(html).toMatch(/<button type="button" class="am-outline">.*Thêm nhóm theo lĩnh vực<\/button>/);
  });

  it("offers each field once and never the default group", () => {
    const html = render([{ key: "a", fieldId: "f-test", groupId: "g-core" }, { key: "b", fieldId: "", groupId: "" }]);
    // The second row cannot pick the field of the first one; no row can pick the default group.
    expect(html.match(/<option value="f-test" disabled="">/g)).toHaveLength(1);
    expect(html.match(/<option value="g-soft" disabled="">/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Bỏ nhóm theo lĩnh vực Kiểm thử &amp; Chất lượng"');
    // Every field has a row: nothing left to add.
    expect(render([{ key: "a", fieldId: "f-test", groupId: "g-core" }, { key: "b", fieldId: "f-dev", groupId: "g-core" }]))
      .toMatch(/<button type="button" class="am-outline" disabled="">.*Thêm nhóm theo lĩnh vực<\/button>/);
  });
});
