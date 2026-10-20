import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CompetencyCourseAi from "./CompetencyCourseAi";
import type { CourseAiItem, CourseAiStatus, CourseAiSuggestion } from "./competency-ai";
import type { CompetencyCourse } from "./competency-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

const course: CompetencyCourse = { id: "c-web2", code: "71ITSE40103", name: "Lập trình web nâng cao", credits: 3, type: "BB", block: "Chuyên ngành", specialty: "",
  cohorts: ["K99"], pastCohorts: [], status: "draft", configId: "cfg", version: "v1", skillCount: 2, totalWeight: 0, mergedFrom: [] };
const online: CourseAiStatus = { enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: "2026-10-16T05:00:00.000Z" } };
const item = (patch: Partial<CourseAiItem>): CourseAiItem => ({ index: 0, skillId: "s-web", skillName: "Lập trình web", groupId: "g1", groupName: "Chuyên môn",
  hasProfile: true, isNewSkill: false, alreadyLinked: false, percent: null, reason: "Học phần dạy trực tiếp.", ...patch });
const suggestion = (patch: Partial<CourseAiSuggestion>): CourseAiSuggestion => ({ id: "sug-1", courseId: course.id, courseCode: course.code, mode: "links", batchId: null,
  status: "completed", errorCode: null, createdAt: "2026-10-16T05:00:00.000Z", updatedAt: "2026-10-16T05:00:40.000Z", completedAt: "2026-10-16T05:00:40.000Z",
  appliedAt: null, model: "gemma4:e4b", promptVersion: "comp-link-v1", items: [], stale: false, ...patch });

function render(latest: CourseAiSuggestion | null, status: CourseAiStatus = online) {
  liveData.mockImplementation((url: string) => url.endsWith("/status") ? { data: status, error: null, loading: false }
    : url.includes("/latest?") ? { data: { suggestion: latest }, error: null, loading: false }
      : { data: { items: [{ id: "g1", name: "Chuyên môn", description: "", isActive: true, version: "v", skillCount: 3 }] }, error: null, loading: false });
  return renderToStaticMarkup(createElement(CompetencyCourseAi, { course, close: () => {}, saved: () => {} }));
}

describe("CompetencyCourseAi", () => {
  it("proposes skills and weights in one step and keeps student data out (2026-10-20)", () => {
    const links = render(null);
    expect(links).toContain("Tạo liên kết kỹ năng (AI) · 71ITSE40103");
    expect(links).toContain("chia 100% trọng số cho các kỹ năng của môn học, kể cả 2 kỹ năng đã liên kết");
    // The proposal is read and created by the shared course's id (2026-10-20).
    expect(liveData.mock.calls.some(([url]) => String(url).includes("/latest?courseId=c-web2&mode=links"))).toBe(true);
    expect(links).toContain("không nhận dữ liệu sinh viên");
    expect(links).toMatch(/<button type="button" class="am-primary">.*Tạo đề xuất<\/button>/);
    expect(render(null, { enabled: false, worker: { online: false, supportsSuggestions: false, seenAt: null } }))
      .toMatch(/Máy chủ chưa bật tính năng AI\.[\s\S]*<button type="button" class="am-primary" disabled="">/);
  });

  it("shows the waiting and failed states", () => {
    expect(render(suggestion({ status: "queued", completedAt: null }))).toContain("Đang chờ máy AI nhận việc…");
    expect(render(suggestion({ status: "processing", completedAt: null }))).toContain("AI đang chọn kỹ năng và chia trọng số cho môn học…");
    expect(render(suggestion({ status: "failed", errorCode: "ai_timeout" }))).toContain("Máy AI xử lý quá thời gian cho phép.");
    expect(render(suggestion({ status: "processing", completedAt: null })))
      .toContain("AI đang trong quá trình tính toán... Bạn có thể thực hiện các thao tác khác trên hệ thống và quay lại nhận kết quả sau ít phút nữa.");
  });

  it("says the catalog has no fitting skill when the AI picks none (2026-10-19)", () => {
    const html = render(suggestion({ items: [] }));
    expect(html).toContain("Chưa có kỹ năng phù hợp cho 71ITSE40103");
    expect(html).toContain("Danh sách kỹ năng hiện tại trong kho dữ liệu của bạn chưa đủ đáp ứng môn học này. Vui lòng bổ sung thêm kỹ năng.");
    expect(html).toContain('<a class="am-outline" href="/quantri/cau-hinh-nang-luc">');
    expect(html).not.toContain("Lưu và áp dụng</button>");
  });

  it("reviews skills with their percents: a career skill without a profile needs a group, a new skill starts unticked, a linked one stays", () => {
    const html = render(suggestion({ items: [
      item({ percent: 50 }),
      item({ index: 1, skillId: "s-docker", skillName: "Docker", hasProfile: false, groupId: null, groupName: null, percent: 20 }),
      item({ index: 2, skillId: null, skillName: "Kiểm thử API", hasProfile: false, isNewSkill: true, percent: 10 }),
      item({ index: 3, skillId: "s-team", skillName: "Làm việc nhóm", alreadyLinked: true, percent: 20 }),
    ] }));
    expect(html).toContain("AI đề xuất 3 kỹ năng mới và trọng số cho 71ITSE40103");
    expect(html).toContain("Kỹ năng nghề chưa đo");
    expect(html).toContain("Kỹ năng mới");
    expect(html).toContain("Đã liên kết");
    expect(html).toContain("Chọn nhóm năng lực.");
    // The linked skill is always kept and has no remove button; the unticked new skill cannot take a percent.
    expect(html).toContain('<input type="checkbox" disabled="" checked=""/><span>Làm việc nhóm</span>');
    expect(html).not.toContain('aria-label="Bỏ đề xuất Làm việc nhóm"');
    expect(html).toMatch(/<input type="number" min="0" max="100" step="any" disabled="" value="10"\/>/);
    // Kept: web 50 + Docker 20 + linked 20 = 90%: a draft only.
    expect(html).toContain("71ITSE40103 sẽ có 3 kỹ năng (2 kỹ năng mới)");
    expect(html).toMatch(/<div class="comp-weight-total" role="status"><span>Tổng trọng số<\/span><strong>90% \/ 100%<\/strong>/);
    expect(html).toMatch(/<button type="button" class="am-primary" disabled="">.*Lưu và áp dụng<\/button>/);
  });

  it("applies at exactly 100% and blocks a stale proposal", () => {
    const items = [item({ percent: 70 }), item({ index: 1, skillId: "s-db", skillName: "Thiết kế cơ sở dữ liệu", alreadyLinked: true, percent: 30 })];
    const html = render(suggestion({ items }));
    expect(html).toMatch(/comp-weight-total comp-weight-valid[\s\S]*100%/);
    expect(html).toMatch(/<button type="button" class="am-outline">.*Lưu bản nháp<\/button>/);
    expect(html).toMatch(/<button type="button" class="am-primary">.*Lưu và áp dụng<\/button>/);
    const stale = render(suggestion({ items, stale: true }));
    expect(stale).toContain("Liên kết kỹ năng của môn học đã thay đổi sau khi AI đề xuất. Hãy tạo lại đề xuất.");
    expect(stale).toMatch(/<button type="button" class="am-primary" disabled="">.*Lưu và áp dụng<\/button>/);
  });
});
