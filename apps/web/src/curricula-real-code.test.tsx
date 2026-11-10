import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CurriculaManagement from "./CurriculaManagement";
import type { CurriculumCourse, CurriculumDetail } from "./curriculum-types";

// Admin Chương trình đào tạo (user 2026-11-10, "dùng luôn mã thực tế"): a course the CTĐT file writes under a code students
// never register shows the graduation standard's real code, with the file's code beside it for the admin. Catalog data
// of ngành HTTT K29 only.

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

const course = (code: string, name: string, extra: Partial<CurriculumCourse> = {}): CurriculumCourse => ({
  position: 1, code, name, englishName: "", credits: 3, type: "BB", block: "Kiến thức giáo dục đại cương", specialty: "", semester: 1, studyYear: 1,
  prerequisite: "", prior: "", notes: "", department: "", departmentCode: "", hours: { lecture: null, practice: null, project: null, internship: null },
  groupId: "g1", sourceRow: 12, sourceSheet: "K29", sourceCells: {}, ...extra,
});
const curriculum: CurriculumDetail = {
  id: "c1", token: "t", isActive: true, version: 2, revisionId: "r2", sourceFilename: "khung-httt-k29.xlsx", updatedAt: "2026-11-01T00:00:00.000Z",
  history: [{ id: "r2", version: 2, note: "Import", createdAt: "2026-11-01T00:00:00.000Z" }], events: [],
  data: {
    schemaVersion: 1, name: "Khung CTĐT HTTT K29", major: "Hệ thống thông tin", cohortCode: "K29", admissionYear: 2023, totalCredits: 120, notes: "",
    groups: [{ id: "g1", label: "Kiến thức giáo dục đại cương", credits: 30, sourceRow: 1 }],
    courses: [course("71ITMA10203", "Đại số tuyến tính và ứng dụng", { realCode: "71MATL10053" }),
      course("71ITBS10103", "Nhập môn Công nghệ thông tin", { position: 2, sourceRow: 13 })],
    electives: [], relations: [], warnings: [], sourceWarnings: [],
  },
};

function renderDetail(canManage: boolean) {
  vi.stubGlobal("window", { location: { hash: "#c1", pathname: "/quantri", search: "" }, addEventListener: () => undefined, removeEventListener: () => undefined });
  liveData.mockImplementation((url: string) => ({ data: url.includes("/curricula/") ? curriculum : { items: [] }, error: null, loading: false }));
  return renderToStaticMarkup(createElement(CurriculaManagement, { canManage }));
}

afterEach(() => { vi.unstubAllGlobals(); liveData.mockReset(); });

describe("the real code of a CTĐT course on the admin detail", () => {
  it.each([true, false])("shows the real code with 'Mã trong tệp CTĐT' under it (canManage %s), the other rows as filed", (canManage) => {
    const html = renderDetail(canManage);
    expect(html).toContain("71MATL10053<small class=\"cm-file-code\">Mã trong tệp CTĐT: 71ITMA10203</small>");
    expect(html.match(/Mã trong tệp CTĐT/g)).toHaveLength(1);
    expect(html).toContain("71ITBS10103");
    expect(html).not.toMatch(/tương đương/i);
  });
});
