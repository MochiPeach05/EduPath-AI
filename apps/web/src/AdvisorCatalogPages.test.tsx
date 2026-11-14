import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CurriculaManagement from "./CurriculaManagement";
import PlansManagement from "./PlansManagement";
import GraduationManagement from "./GraduationManagement";
import CompetencyManagement from "./CompetencyManagement";
import type { CurriculumDetail } from "./curriculum-types";
import type { PlanDetail } from "./plan-types";
import type { GraduationDetail } from "./graduation-types";

// The catalog pages a cố vấn học tập reads (canManage false: the role advisor, web types.ts canManageAdmin), against the
// function list ver0.3 (user, 2026-11-04): the "QTV & CVHT" rows are views, searches and filters; the source workbooks
// (AD-PLAN-14) and the AI runs of the course links (AD-CRS-06, 09, 10) belong to the Quản trị viên alone.

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

const history = [{ id: "r2", version: 2, note: "Cập nhật", createdAt: "2026-11-01T00:00:00.000Z" }, { id: "r1", version: 1, note: "Import", createdAt: "2026-10-01T00:00:00.000Z" }];
const curriculum: CurriculumDetail = {
  id: "c1", token: "t", isActive: true, version: 2, revisionId: "r2", sourceFilename: "khung-k31.xlsx", updatedAt: "2026-11-01T00:00:00.000Z", history, events: [],
  data: { schemaVersion: 1, name: "Khung CTĐT CNTT K31", major: "Công nghệ thông tin", cohortCode: "K31", admissionYear: 2025, totalCredits: 126, notes: "",
    courses: [], groups: [], electives: [], relations: [], warnings: [], sourceWarnings: [] },
};
const plan: PlanDetail = {
  id: "p1", token: "t", isActive: true, version: 2, revisionId: "r2", sourceFilename: "ke-hoach-k31.xlsx", updatedAt: "2026-11-01T00:00:00.000Z", history, events: [],
  data: { schemaVersion: 1, name: "Kế hoạch CNTT K31", major: "Công nghệ thông tin", cohortCode: "K31", admissionYear: 2025, totalCredits: 126, notes: "",
    items: [], terms: [], sections: [], warnings: [], sourceWarnings: [], curriculum: null },
};
const standard: GraduationDetail = {
  id: "g1", token: "t", isActive: true, version: 2, revisionId: "r2", sourceFilename: "tieu-chuan-k31.xlsx", warnings: [], history, events: [],
  data: { schemaVersion: 1, name: "Tiêu chuẩn CNTT K31", standardCode: "TN01", cohortCode: "K31", classBlock: "71K31CNTT", major: "Công nghệ thông tin",
    specialty: "", educationSystem: "Đại học chính quy", faculty: "Khoa Công nghệ Thông tin", minimumCredits: 126, mandatoryCredits: 100, electiveCredits: 26,
    freeElectiveCredits: 0, minimumGpa: 2, notes: "", groups: [], courses: [], sourceWorkbook: "tieu-chuan-k31.xlsx", sourceSheet: "K31", sourceNotes: [] },
};
const answer = (data: unknown) => ({ data, error: null, loading: false });

/** A detail page opened by its address (#id), as the list's "Xem chi tiết" does. */
function renderDetail(page: "curricula" | "plans" | "graduation", canManage: boolean) {
  const id = page === "curricula" ? "c1" : page === "plans" ? "p1" : "g1";
  vi.stubGlobal("window", { location: { hash: `#${id}`, pathname: "/quantri", search: "" }, addEventListener: () => undefined, removeEventListener: () => undefined });
  liveData.mockImplementation((url: string) => answer(url.includes("/curricula/") ? curriculum : url.includes("/plans/") ? plan : url.includes("/graduation/") ? standard : { items: [] }));
  const component = page === "curricula" ? CurriculaManagement : page === "plans" ? PlansManagement : GraduationManagement;
  return renderToStaticMarkup(createElement(component, { canManage }));
}

afterEach(() => { vi.unstubAllGlobals(); liveData.mockReset(); });

describe("source workbooks are the Quản trị viên's (AD-PLAN-14; no CVHT row for CTĐT or Tiêu chuẩn)", () => {
  it.each(["curricula", "plans", "graduation"] as const)("%s: the details show no download to a cố vấn học tập", (page) => {
    const advisor = renderDetail(page, false);
    expect(advisor).toContain("Phiên bản 2");
    expect(advisor).not.toContain("Tải xuống Excel");
    expect(advisor).not.toContain("/source/");
    expect(advisor).not.toContain("Tệp tải xuống");
    // Nor any change: import, lock, edit.
    expect(advisor).not.toMatch(/Cập nhật (CTĐT|KHĐT|tiêu chuẩn) từ Excel|Khóa (khung|kế hoạch|tiêu chuẩn)|Chỉnh sửa thông tin/);
  });

  it.each(["curricula", "plans", "graduation"] as const)("%s: an admin keeps the download and the changes", (page) => {
    const admin = renderDetail(page, true);
    // Named after what they hold (user 2026-11-14: "Không ghi là tải xuống excel nguồn phải ghi là tải xuống excel CTĐT").
    expect(admin).toContain(`Tải xuống Excel ${page === "curricula" ? "CTĐT" : page === "plans" ? "KHĐT" : "tiêu chuẩn"}`);
    expect(admin).not.toContain("Excel nguồn");
    expect(admin).toContain(`/api/admin/${page}/${page === "curricula" ? "c1" : page === "plans" ? "p1" : "g1"}/source/r2`);
    expect(admin).toContain(`Cập nhật ${page === "curricula" ? "CTĐT" : page === "plans" ? "KHĐT" : "tiêu chuẩn"} từ Excel`);
  });

  it("keeps the source notes an admin reads", () => {
    expect(renderDetail("curricula", true)).toContain("Tệp tải xuống là tệp Excel CTĐT đã import; các chỉnh sửa trực tiếp được lưu trong phiên bản trên hệ thống.");
    expect(renderDetail("graduation", true)).toContain("Tệp tải xuống là tệp gốc, chưa bao gồm chỉnh sửa trực tiếp.");
  });
});

describe("Cấu hình môn học for a cố vấn học tập (AD-CRS-01…04 only)", () => {
  const course = { id: "c-web", code: "71ITSE30203", name: "Lập trình Web", credits: 3, type: "BB", block: "", specialty: "", cohorts: ["K29"],
    status: "missing", configId: null, version: null, skillCount: 0, totalWeight: 0, mergedFrom: [] };
  const render = (canManage: boolean) => {
    liveData.mockImplementation((url: string) => answer(url.includes("/courses?") ? { items: [course] }
      : url.includes("/summary") ? { cohort: "", activeCount: 0, draftCount: 0, missingCount: 1, archivedCount: 0, courseCount: 1, unlinkedSkillCount: 0, warnings: [] }
        : url.includes("/cohorts") ? { items: [{ cohortCode: "K29", courseCount: 1 }] }
          : url.includes("/ai/status") ? { enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: null } } : { batch: null }));
    return renderToStaticMarkup(createElement(CompetencyManagement, { canManage, section: "courses" }));
  };

  it("shows the configurations without the AI runs, their proposals or the admin's hints, and asks nothing of the AI", () => {
    const html = render(false);
    expect(html).toContain("Lập trình Web");
    expect(html).toContain("Kỹ năng và trọng số của từng môn học.");
    expect(html).not.toContain("Chạy AI cho các môn chưa có liên kết");
    expect(html).not.toContain("AI có thể đề xuất");
    expect(html).not.toContain("Có thể chạy AI");
    expect(html).toContain("Chưa có môn học nào có cấu hình đang áp dụng hoặc bản nháp.</p>");
    expect(liveData.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/ai/"))).toEqual([]);
  });

  it("keeps the AI runs and the hints for an admin", () => {
    const html = render(true);
    expect(html).toContain("Chạy AI cho các môn chưa có liên kết");
    expect(html).toContain("Gắn kỹ năng với từng môn học và chia trọng số.");
    expect(html).toContain("AI có thể đề xuất liên kết và trọng số.");
    expect(html).toContain("Có thể chạy AI cho các môn chưa có liên kết hoặc tạo liên kết kỹ năng kèm trọng số cho từng môn.");
    expect(liveData.mock.calls.some(([url]) => String(url).endsWith("/ai/batches/latest"))).toBe(true);
  });
});
