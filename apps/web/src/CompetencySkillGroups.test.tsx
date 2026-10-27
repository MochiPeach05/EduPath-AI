import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompetencySkillsTab, SkillEditor } from "./CompetencyProfiles";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));
const groups = [
  { id: "g1", name: "Chuyên môn", description: "", isActive: true, version: "v", skillCount: 2 },
  { id: "g2", name: "Kỹ năng mềm", description: "", isActive: true, version: "v", skillCount: 1 },
];
// Synthetic profile of the user's case: "Viết tài liệu" is Kỹ năng mềm and also Chuyên môn.
const writing = {
  id: "s1", name: "Viết tài liệu", description: "", scope: "", groupId: "g2", groupName: "Kỹ năng mềm", groupActive: true,
  groups: [{ id: "g2", name: "Kỹ năng mềm", isActive: true }, { id: "g1", name: "Chuyên môn", isActive: true }],
  isActive: true, courseCount: 1, careerCount: 2, version: "v", legacySkillId: null,
};
liveData.mockImplementation((url: string) => ({ data: { items: url.includes("/skills") ? [writing] : url.includes("/groups") ? groups : [] }, error: null, loading: false }));
const editor = (current: typeof writing | null) => {
  const html = renderToStaticMarkup(createElement(SkillEditor, { current, revision: 0, groups, close: () => {}, saved: () => {} }));
  return html.slice(html.indexOf('<fieldset class="comp-group-picks">'), html.indexOf("</fieldset>", html.indexOf('<fieldset class="comp-group-picks">')));
};

describe("a skill profile with one or more competency groups (2026-10-22)", () => {
  it("lists every group of a profile", () => {
    const html = renderToStaticMarkup(createElement(CompetencySkillsTab, { canManage: true, revision: 0, onSaved: () => {} }));
    expect(html).toContain("<td>Kỹ năng mềm, Chuyên môn</td>");
    expect(html).toContain("gồm một kỹ năng, một hoặc nhiều nhóm năng lực");
  });
  it("offers every group as a tick box: all groups of the profile ticked, the first group in use for a new one", () => {
    const edited = editor(writing), added = editor(null);
    expect(edited.match(/type="checkbox"/g)).toHaveLength(2);
    expect(edited.match(/checked=""/g)).toHaveLength(2);
    expect(added.match(/checked=""/g)).toHaveLength(1);
    expect(added.indexOf('checked=""')).toBeLessThan(added.indexOf("Kỹ năng mềm"));
    expect(edited).toContain("Chọn một hoặc nhiều nhóm. Điểm kỹ năng được tính vào từng nhóm đã chọn.");
    expect(edited).not.toContain("<select");
  });
});

describe("Ngành áp dụng of a skill profile (2026-10-27, migration 054)", () => {
  // Synthetic profile kept to HTTT: the AI only offers it to the courses of that major.
  const gis = { ...writing, id: "s2", name: "Hệ thống thông tin địa lý (GIS)", majorCodes: ["7480104"] };
  const majorsBox = (current: typeof writing | null) => {
    const html = renderToStaticMarkup(createElement(SkillEditor, { current, revision: 0, groups, close: () => {}, saved: () => {} }));
    const start = html.indexOf("<legend>Ngành áp dụng</legend>");
    return start < 0 ? "" : html.slice(start, html.indexOf("</fieldset>", start));
  };
  it("ticks the majors of a profile, none for a new one or a skill of every major", () => {
    expect(majorsBox(gis).match(/type="checkbox"/g)).toHaveLength(3);
    expect(majorsBox(gis).match(/checked=""/g)).toHaveLength(1);
    expect(majorsBox(gis)).toMatch(/checked=""\/>\s*(<!-- -->)?Hệ thống thông tin/);
    expect(majorsBox(null).match(/checked=""/g) ?? []).toHaveLength(0);
    expect(majorsBox(writing).match(/checked=""/g) ?? []).toHaveLength(0);
    expect(majorsBox(null)).toContain("Không chọn ngành nào: kỹ năng dùng cho mọi ngành.");
  });
  it("names the majors under the skill in the list and filters by major", () => {
    liveData.mockImplementation((url: string) => ({ data: { items: url.includes("/skills") ? [gis, writing] : url.includes("/groups") ? groups : [] }, error: null, loading: false }));
    try {
      const html = renderToStaticMarkup(createElement(CompetencySkillsTab, { canManage: true, revision: 0, onSaved: () => {} }));
      expect(html).toContain("Hệ thống thông tin địa lý (GIS)</button><small>Riêng ngành HTTT</small>");
      expect(html).toContain("Viết tài liệu</button></td>");
      expect(html).toContain('<option value="shared">Dùng cho mọi ngành</option>');
      expect(html).toContain('<option value="7480102">Riêng ngành MMT&amp;TTDL</option>');
    } finally {
      liveData.mockImplementation((url: string) => ({ data: { items: url.includes("/skills") ? [writing] : url.includes("/groups") ? groups : [] }, error: null, loading: false }));
    }
  });
});
