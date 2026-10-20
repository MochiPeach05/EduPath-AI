import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompetencyGroupsTab, CompetencySkillsTab } from "./CompetencyProfiles";
import { CompetencyCoursesTab } from "./CompetencyCourses";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));
vi.mock("./admin-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admin-ui")>()),
  // The real menu lists its items only once opened; list them all so the markup shows what a row offers.
  ActionMenu: ({ items }: { items: { label: string }[] }) => <ul>{items.map((item) => <li key={item.label}>{item.label}</li>)}</ul>,
}));

const group = { id: "g1", name: "Chuyên môn", description: "", isActive: true, version: "v", skillCount: 1 };
const skill = { id: "s1", name: "SQL", description: "", scope: "", groupId: "g1", groupName: "Chuyên môn", groupActive: true, isActive: true, courseCount: 1, careerCount: 1, version: "v" };
liveData.mockImplementation((url: string) => ({ data: { items: url.includes("/skills") ? [skill] : [group] }, error: null, loading: false }));
const items = (html: string) => [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((match) => match[1]);

// Every row action is a verb plus its noun (user, 2026-10-17).
describe("competency row menus", () => {
  it("names the noun in every item", () => {
    expect(items(renderToStaticMarkup(createElement(CompetencyGroupsTab, { canManage: true, revision: 0, onSaved: () => {} }))))
      .toEqual(["Xem chi tiết nhóm năng lực", "Chỉnh sửa nhóm năng lực", "Xóa nhóm năng lực"]);
    expect(items(renderToStaticMarkup(createElement(CompetencySkillsTab, { canManage: true, revision: 0, onSaved: () => {} }))))
      .toEqual(["Xem chi tiết cấu hình năng lực", "Chỉnh sửa cấu hình năng lực", "Xóa cấu hình năng lực"]);
  });
});

describe("course row menu (2026-10-20)", () => {
  it("creates links with their weights and deletes them with one item", () => {
    const curriculum = { curriculumId: "c1", revisionId: "r1", cohortCode: "K29", name: "CTĐT K29", version: 1, isCurrent: true, isActive: true,
      courseCount: 1, configuredCount: 1, activeCount: 1, draftCount: 0 };
    const course = { code: "71ITSE30203", name: "Lập trình Web", credits: 3, type: "BB", block: "", specialty: "", occurrenceCount: 1, status: "active",
      configId: "cfg", version: "v1", skillCount: 2, totalWeight: 1 };
    liveData.mockImplementation((url: string) => ({ error: null, loading: false, data: url.includes("/courses?") ? { items: [course] }
      : url.includes("/summary") ? { activeCount: 1, draftCount: 0, missingCount: 0, archivedCount: 0, courseCount: 1, unlinkedSkillCount: 0, warnings: [] }
        : url.includes("/ai/status") ? { enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: null } } : { batch: null } }));
    expect(items(renderToStaticMarkup(createElement(CompetencyCoursesTab, { curriculum, canManage: true, revision: 0, onSaved: () => {} }))))
      .toEqual(["Xem chi tiết học phần", "Tạo liên kết kỹ năng (Thủ công)", "Tạo liên kết kỹ năng (AI)", "Chỉnh sửa liên kết và trọng số", "Xóa liên kết và trọng số"]);
  });
});
