import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlansManagement, { planItemChange } from "./PlansManagement";
import type { PlanDetail, PlanItem } from "./plan-types";

// Admin Kế hoạch đào tạo (user 2026-11-10, "dùng luôn mã thực tế"): a row the KHĐT file writes under a code students never
// register shows the real code of the plan's CTĐT (API plans/repository.ts), with the file's code under it for the admin;
// Tìm học phần finds it by either code, and Lưu phân bổ still edits it by the file's code. Catalog data of ngành CNTT K28 only.

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));
// What is typed in Tìm học phần: useLiveFilters keeps it in state, which a static render cannot type into.
const typed = vi.hoisted(() => ({ q: "" }));
vi.mock("./use-live-filters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-live-filters")>();
  return {
    ...actual,
    useLiveFilters: (initial: { q: string } & Record<string, string>) => {
      const live = actual.useLiveFilters(initial);
      return { ...live, draft: { ...live.draft, q: typed.q }, filters: { ...live.filters, q: typed.q } };
    },
  };
});

const item = (id: string, code: string, name: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  id, position: 1, code, name, credits: 3, type: "BB", termCode: "HK221", semester: 1, studyYear: 1, sectionId: "", prerequisite: "", prior: "",
  notes: "", hours: { lecture: 45, practice: null, project: null, internship: null }, sourceRow: 12, sourceSheet: "K28", sourceCells: { C: id },
  ...extra,
});
const plan: PlanDetail = {
  id: "p1", token: "t", isActive: true, version: 1, revisionId: "r1", sourceFilename: "ke-hoach-cntt-k28.xlsx", updatedAt: "2026-11-01T00:00:00.000Z",
  history: [{ id: "r1", version: 1, note: "Import kế hoạch đào tạo", createdAt: "2026-11-01T00:00:00.000Z" }], events: [],
  data: {
    schemaVersion: 1, name: "Kế hoạch đào tạo CNTT K28", major: "Công nghệ thông tin", cohortCode: "K28", admissionYear: 2022, totalCredits: 130, notes: "",
    items: [item("row-12", "71ITMA10203", "Đại số tuyến tính và ứng dụng", { realCode: "71MATL10053" }),
      item("row-13", "71ITBS10103", "Nhập môn Công nghệ thông tin", { position: 2, sourceRow: 13 })],
    terms: [{ code: "HK221", semester: 1, studyYear: 1, sourceCredits: 18 }],
    sections: [], warnings: [], sourceWarnings: [], curriculum: null,
  },
};

function renderDetail(canManage: boolean, q = "") {
  typed.q = q;
  vi.stubGlobal("window", { location: { hash: "#p1", pathname: "/quantri", search: "" }, addEventListener: () => undefined, removeEventListener: () => undefined });
  liveData.mockImplementation((url: string) => ({ data: url.includes("/plans/") ? plan : { items: [], total: 0, cohorts: [] }, error: null, loading: false }));
  return renderToStaticMarkup(createElement(PlansManagement, { canManage }));
}

afterEach(() => { vi.unstubAllGlobals(); liveData.mockReset(); typed.q = ""; });

describe("the real code of a KHĐT row on the admin detail", () => {
  it.each([true, false])("shows the real code with 'Mã trong tệp KHĐT' under it (canManage %s), the other rows as filed", (canManage) => {
    const html = renderDetail(canManage);
    expect(html).toContain("<td>71MATL10053<small class=\"cm-file-code\">Mã trong tệp KHĐT: 71ITMA10203</small></td>");
    expect(html.match(/Mã trong tệp KHĐT/g)).toHaveLength(1);
    expect(html).toContain("<td>71ITBS10103</td>");
    expect(html).toContain("2 / 2 lượt môn");
    expect(html).not.toMatch(/tương đương/i);
  });

  it.each(["71MATL10053", "71itma10203", "ITMA102", "71MATL10053 Đại số"])("finds the row by its real code or the file's code (%s)", (q) => {
    const html = renderDetail(true, q);
    expect(html).toContain("1 / 2 lượt môn");
    expect(html).toContain("Mã trong tệp KHĐT: 71ITMA10203");
    expect(html).not.toContain("71ITBS10103");
  });

  it("keeps the other rows found by their own code only, and a code no row has finds none", () => {
    for (const q of ["71ITBS10103", "71ITBS10103 Nhập môn"]) {
      const other = renderDetail(true, q);
      expect(other).toContain("1 / 2 lượt môn");
      expect(other).not.toContain("Mã trong tệp KHĐT");
    }
    expect(renderDetail(true, "71MATL99999")).toContain("Không có môn phù hợp với bộ lọc.");
  });
});

describe("Lưu phân bổ of a row with a real code", () => {
  it("sends the editable fields under the file's code, never realCode (the API's item schema is strict)", () => {
    const change = planItemChange(plan.data.items[0]!);
    expect(change).not.toHaveProperty("realCode");
    expect(change.code).toBe("71ITMA10203");
    // The fields of the API's editableItem (plans/router.ts): itemSchema without id, position and the source cells.
    expect(Object.keys(change).sort()).toEqual(
      ["code", "name", "credits", "type", "termCode", "semester", "studyYear", "sectionId", "prerequisite", "prior", "notes", "hours"].sort(),
    );
    expect(planItemChange(plan.data.items[1]!)).toMatchObject({ code: "71ITBS10103", name: "Nhập môn Công nghệ thông tin" });
  });
});
