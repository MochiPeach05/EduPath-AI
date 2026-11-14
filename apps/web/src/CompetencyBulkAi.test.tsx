import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClearCourses, CompetencyBulkAi } from "./CompetencyBulkAi";
import type { CourseAiBatch, CourseAiStatus } from "./competency-ai";
import type { CompetencyCourse } from "./competency-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

const course = (code: string, skillCount: number, status?: CompetencyCourse["status"]): CompetencyCourse => ({ id: `id-${code}`, code, name: code, credits: 3, type: "BB",
  block: "", specialty: "", cohorts: ["K30"], status: status ?? (skillCount ? "active" : "missing"), configId: null, version: null, skillCount,
  totalWeight: skillCount ? 1 : 0, mergedFrom: [] });
const online: CourseAiStatus = { enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: "2026-10-17T05:00:00.000Z" } };
const pendingBatch: CourseAiBatch = { id: "b1", createdAt: "2026-10-17T05:00:00.000Z", total: 1, queued: 1, processing: 0, completed: 0, failed: 0, cancelled: 0,
  applied: 0, ready: 0, items: [] };

function render(batch: CourseAiBatch | null, items: CompetencyCourse[] = [course("A", 4), course("B", 2), course("C", 0)], status: CourseAiStatus = online, cohort = "K30") {
  liveData.mockImplementation((url: string) => url.includes("/courses?") ? { data: { items }, error: null, loading: false }
    : url.endsWith("/status") ? { data: status, error: null, loading: false }
      : { data: { batch }, error: null, loading: false });
  return renderToStaticMarkup(createElement(CompetencyBulkAi, { cohort, canManage: true, revision: 0, onSaved: () => {} }));
}

describe("CompetencyBulkAi", () => {
  it("offers to clear the linked courses of the filter and says the AI reasons before answering", () => {
    const html = render(null);
    expect(html).toContain("Xóa liên kết của 2 môn");
    expect(html).toContain("Chạy AI cho 1 môn chưa có liên kết");
    expect(html).toContain("Mỗi môn thường mất khoảng 10–30 giây; 80 môn khoảng 10–30 phút.");
    expect(html).toContain("cho từng môn chưa có liên kết của K30.");
    // The course list follows the cohort filter; the latest run is shown whatever filter started it.
    expect(liveData.mock.calls.some(([url]) => String(url).endsWith("/courses?cohort=K30"))).toBe(true);
    expect(liveData.mock.calls.some(([url]) => String(url).endsWith("/ai/batches/latest"))).toBe(true);
    expect(render(null, undefined, online, "")).toContain("cho từng môn chưa có liên kết (mọi khóa).");
  });

  it("applies the drafts that add up to 100% after a confirmation", () => {
    const drafts = render(null, [course("A", 2, "draft"), course("B", 3, "draft"), course("C", 0, "draft"), course("D", 0)]);
    expect(drafts).toContain("Áp dụng 2 bản nháp");
    expect(drafts).toMatch(/<button type="button" class="am-primary" disabled="">.*?Áp dụng 2 bản nháp<\/button>/s);
    expect(drafts).toContain("Tôi hiểu rằng khi áp dụng, 2 môn đang ở bản nháp được tính ngay vào đánh giá năng lực của sinh viên mọi khóa có các môn đó.");
    expect(drafts).toContain("1 bản nháp khác chưa có liên kết hoặc tổng trọng số chưa đủ 100%");
    expect(render(null)).not.toContain("bản nháp</button>");
  });

  it("hides the clear button while a run is pending", () => {
    expect(render(pendingBatch)).not.toContain("Xóa liên kết của");
  });

  it("says the AI is computing while a run is pending and the AI machine is on (2026-10-19)", () => {
    const message = "AI đang trong quá trình tính toán... Bạn có thể thực hiện các thao tác khác trên hệ thống và quay lại nhận kết quả sau ít phút nữa.";
    expect(render(pendingBatch)).toContain(message);
    // Nothing is computed while the AI machine is off: the worker line says so instead.
    const offline = render(pendingBatch, undefined, { enabled: true, worker: { online: false, supportsSuggestions: false, seenAt: null } });
    expect(offline).not.toContain(message);
    expect(offline).toContain("Máy AI đang tắt.");
    expect(render({ ...pendingBatch, queued: 0, completed: 1 })).not.toContain(message);
  });

  it("lists the courses no catalog skill fits with the function list sentence and a way to add skills", () => {
    const entry = (code: string, name: string, patch: Partial<CourseAiBatch["items"][number]>): CourseAiBatch["items"][number] =>
      ({ id: `j-${code}`, courseId: `id-${code}`, courseCode: code, courseName: name, status: "completed", errorCode: null, applied: false, itemCount: 0, noMatch: false, linked: false, ...patch });
    const finished: CourseAiBatch = { ...pendingBatch, total: 3, queued: 0, completed: 3, applied: 1, ready: 1, noMatch: 1, items: [
      entry("A", "A", { applied: true, itemCount: 2, linked: true }),
      entry("B", "B", { itemCount: 3 }),
      entry("C", "Tiếng Nhật 1", { noMatch: true }),
    ] };
    const html = render(finished);
    expect(html).toContain("<span>Chưa có kỹ năng phù hợp</span><strong>1</strong>");
    expect(html).toContain("1 môn chưa có kỹ năng phù hợp");
    expect(html).toContain("<strong>C · Tiếng Nhật 1</strong><span>Danh sách kỹ năng hiện tại trong kho dữ liệu của bạn chưa đủ đáp ứng môn học này. Vui lòng bổ sung thêm kỹ năng.</span>");
    expect(html).toContain('href="/quantri/cau-hinh-nang-luc"');
    expect(html).not.toContain("B · B</strong>");
    // A course linked by hand since the run is no longer listed.
    expect(render({ ...finished, items: finished.items.map((item) => ({ ...item, linked: true })) })).not.toContain("môn chưa có kỹ năng phù hợp</h4>");
  });

  it("asks for the cohort code, or TẤT CẢ without a filter, before clearing shared courses", () => {
    const html = renderToStaticMarkup(createElement(ClearCourses, { cohort: "K30", linked: 2, close: () => {}, cleared: () => {} }));
    expect(html).toContain("Nhập K30 để xác nhận");
    expect(html).toContain("Môn học dùng chung cho mọi khóa: sinh viên của mọi khóa có các môn này sẽ chưa có điểm năng lực");
    // The text is required and checked on save, so a wrong text is explained instead of a disabled button.
    expect(html).toContain('<form class="cm-dialog-body cm-form" noValidate="">');
    expect(html).toContain('<input required="" maxLength="40" autoComplete="off" value=""/>');
    expect(html).toMatch(/<button class="am-primary am-delete">/);
    expect(renderToStaticMarkup(createElement(ClearCourses, { cohort: "", linked: 88, close: () => {}, cleared: () => {} }))).toContain("Nhập TẤT CẢ để xác nhận");
  });
});
