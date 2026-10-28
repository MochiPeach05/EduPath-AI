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
      .toEqual(["Xem chi tiết", "Chỉnh sửa nhóm năng lực", "Xóa nhóm năng lực"]);
    expect(items(renderToStaticMarkup(createElement(CompetencySkillsTab, { canManage: true, revision: 0, onSaved: () => {} }))))
      .toEqual(["Xem chi tiết", "Chỉnh sửa cấu hình năng lực", "Xóa cấu hình năng lực"]);
  });
});

describe("course row menu (2026-10-20)", () => {
  const course = { id: "c-web", code: "71ITSE30203", name: "Lập trình Web", credits: 3, type: "BB", block: "", specialty: "", cohorts: ["K29", "K30"],
    status: "active", configId: "cfg", version: "v1", skillCount: 2, totalWeight: 1, mergedFrom: ["K29 · phiên bản 1"] };
  const render = () => {
    liveData.mockImplementation((url: string) => ({ error: null, loading: false, data: url.includes("/courses?") ? { items: [course] }
      : url.includes("/summary") ? { cohort: "", activeCount: 1, draftCount: 0, missingCount: 0, archivedCount: 0, courseCount: 1, unlinkedSkillCount: 0, warnings: [] }
        : url.includes("/cohorts") ? { items: [{ cohortCode: "K30", courseCount: 87 }, { cohortCode: "K29", courseCount: 88 }] }
          : url.includes("/ai/status") ? { enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: null } } : { batch: null } }));
    return renderToStaticMarkup(createElement(CompetencyCoursesTab, { canManage: true, revision: 0, onSaved: () => {} }));
  };

  it("creates links with their weights and deletes them with one item", () => {
    expect(items(render()))
      .toEqual(["Xem chi tiết", "Tạo liên kết kỹ năng (Thủ công)", "Tạo liên kết kỹ năng (AI)", "Chỉnh sửa liên kết và trọng số", "Xóa liên kết và trọng số"]);
  });

  it("lists the shared courses with their cohorts and filters by cohort (Cấu hình môn học)", () => {
    const html = render();
    expect(html).toMatch(/<span>Môn học<\/span>.*?<\/th><th scope="col"><button[^>]*><span>Khóa áp dụng<\/span>/);
    expect(html).toContain("<td>K29, K30</td>");
    expect(html).toContain('<option value="" selected="">Tất cả khóa</option><option value="K30">K30 · 87 môn</option><option value="K29">K29 · 88 môn</option>');
    expect(html).toContain("Đã gộp cấu hình khác của K29 · phiên bản 1; xem lịch sử.");
  });
});
