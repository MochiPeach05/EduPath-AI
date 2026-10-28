import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CompetencyManagement from "./CompetencyManagement";
import { CompetencyGroupsTab, CompetencySkillsTab } from "./CompetencyProfiles";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));
const group = { id: "g1", name: "Chuyên môn", description: "", isActive: true, version: "v", skillCount: 1 };
const skill = { id: "s1", name: "SQL", description: "", scope: "", groupId: "g1", groupName: "Chuyên môn", groupActive: true, isActive: true, courseCount: 1, careerCount: 1, version: "v" };
const summary = { cohort: "", courseCount: 0, activeCount: 0, draftCount: 0, archivedCount: 0, missingCount: 0, skillCount: 1, unlinkedSkillCount: 1, warnings: [] };
liveData.mockImplementation((url: string) => ({ data: url.includes("/summary") ? summary : url.includes("/batches/latest") ? { batch: null }
  : { items: url.includes("/skills") ? [skill] : url.includes("/groups") ? [group] : [] }, error: null, loading: false }));
const props = { canManage: true, revision: 0, onSaved: () => {} };

// Terms agreed on 2026-10-17: Nhóm năng lực (the groups), Kỹ năng (one skill), Cấu hình năng lực (a skill
// set up for assessment: group, scope, state).
describe("competency terms", () => {
  it("shows one part per page of Quản lý năng lực, without tabs", () => {
    const page = (section: "groups" | "profiles" | "courses") => renderToStaticMarkup(createElement(CompetencyManagement, { canManage: true, section }));
    const [groups, profiles, courses] = [page("groups"), page("profiles"), page("courses")];
    expect(groups).toContain("Thêm nhóm năng lực");
    expect(groups).not.toContain("Thêm cấu hình năng lực");
    expect(profiles).toContain("Thêm cấu hình năng lực");
    expect(profiles).not.toContain("Thêm nhóm năng lực");
    // Cấu hình môn học (2026-10-20): one list of shared courses; the cohort only filters it.
    expect(courses).toContain("Mỗi môn (cùng mã, tên và số tín chỉ) chỉ có một cấu hình, dùng chung cho mọi khóa có môn đó");
    expect(courses).toContain('<option value="" selected="">Tất cả khóa</option>');
    expect(courses).not.toMatch(/Khóa tuyển sinh|Phiên bản chương trình đào tạo/);
    expect(courses).not.toMatch(/Thêm nhóm năng lực|Thêm cấu hình năng lực/);
    for (const html of [groups, profiles, courses]) expect(html).not.toContain("aria-pressed");
  });

  it("uses the new names on both tabs and never the old ones", () => {
    const groups = renderToStaticMarkup(createElement(CompetencyGroupsTab, props));
    const skills = renderToStaticMarkup(createElement(CompetencySkillsTab, props));
    expect(groups).toContain("Thêm nhóm năng lực");
    expect(skills).toContain("Thêm cấu hình năng lực");
    expect(skills).toMatch(/<th scope="col"><button type="button" class="ts-sort"[^>]*><span>Nhóm năng lực<\/span>/);
    for (const html of [groups, skills]) expect(html).not.toMatch(/nhóm kỹ năng|hồ sơ|Danh mục kỹ năng/i);
  });
});
