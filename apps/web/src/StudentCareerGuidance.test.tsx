import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StudentCareerGuidance from "./StudentCareerGuidance";
import type { GuidanceCareer, GuidanceResponse } from "./career-guidance-data";

// Synthetic careers only (plan "Một bước để bắt đầu", 2026-11-14, mockup E).
const career = (id: string, nameVi: string, score: number, extra: Partial<GuidanceCareer> = {}): GuidanceCareer => ({
  id, code: id, nameVi, nameEn: `${nameVi} EN`, category: "7", categoryName: "Phát triển phần mềm", description: "", isTarget: false,
  fit: { score, code: score >= 80 ? "fit" : "average", label: score >= 80 ? "Phù hợp" : "Trung bình", dataShare: 1, met: 2, below: 1, notStudied: 0, upcoming: 0, noData: 0, total: 3, summaryText: "", dataText: "" },
  requirements: [], interests: { field: null, tech: [] }, ...extra,
});
const guidance = (extra: Partial<GuidanceResponse> = {}): GuidanceResponse => ({
  blocked: null, targetCareerId: null, fields: [{ code: "7", name: "Phát triển phần mềm" }],
  careers: [career("a", "Lập trình viên web", 82), career("b", "Kỹ sư dữ liệu", 70), career("c", "Kiểm thử viên", 64), career("d", "Kỹ sư DevOps", 58)],
  surveyDone: false, deletedTargetName: null, gapCurrent: false, gapAssessedAt: null, gapCareerId: null, gapCareerName: null, ...extra,
});
const page = (data: GuidanceResponse) => renderToStaticMarkup(createElement(StudentCareerGuidance, { onProfileChanged: () => {}, initial: data }));
const row = (html: string) => html.slice(html.indexOf('<div class="cg-top-row">'), html.indexOf('<div class="cg-level"><h3>Các lựa chọn khác</h3>'));

describe("Định hướng nghề nghiệp (plan \"Một bước để bắt đầu\", 2026-11-14)", () => {
  it("says the target is optional while none is chosen", () => {
    const html = page(guidance());
    expect(html).toContain('<span class="cg-target-label">Vị trí nghề nghiệp mục tiêu:</span><strong>Chưa chọn</strong><span class="cg-target-hint">Chọn một vị trí bên dưới khi bạn muốn. Không bắt buộc.</span>');
    expect(html).toContain("từ điểm kỹ năng trong bảng điểm và Khảo sát nhanh (nếu bạn làm).");
  });

  it("puts Khảo sát nhanh beside the best fit, and its button in place of the survey matches", () => {
    const html = page(guidance());
    const top = row(html);
    expect(top).toContain('class="sw-panel cg-top"');
    expect(top).toContain('id="khao-sat-nhanh"');
    expect(top.indexOf('class="sw-panel cg-top"')).toBeLessThan(top.indexOf('id="khao-sat-nhanh"'));
    expect(html).toContain("Làm Khảo sát nhanh (5 câu, khoảng 1 phút, không bắt buộc) để xem các vị trí nghề nghiệp hợp với sở thích và thế mạnh của bạn.");
    expect(html).toContain('<button type="button" class="sw-outline">Làm Khảo sát nhanh</button>');
    // Nothing sends the student to Hồ sơ và bảng điểm for the survey any more, and nothing calls it required.
    for (const gone of ["Làm khảo sát ở Hồ sơ và bảng điểm", "Khảo sát định hướng", "ps-tag-required"]) expect(html).not.toContain(gone);
  });

  it("lists the survey matches once the survey is done, with Chỉnh sửa khảo sát beside their title", () => {
    const liked = career("e", "Kỹ sư AI", 50, { interests: { field: "AI, dữ liệu", tech: ["Python, phân tích dữ liệu"] } });
    const html = page(guidance({ surveyDone: true, careers: [...guidance().careers, liked] }));
    expect(html).toMatch(/<h4 id="cg-liked-title">Vị trí nghề nghiệp phù hợp với sở thích và thế mạnh<\/h4>\s*<button type="button" class="cg-link">Chỉnh sửa khảo sát<\/button>/);
    expect(html).toContain("bạn chọn trong Khảo sát nhanh.");
    expect(html).toContain("Kỹ sư AI");
    expect(html).not.toContain("Làm Khảo sát nhanh (5 câu");
  });

  // User 2026-11-14: "Chỗ đổi vị trí nghề nghiệp ở đây đâu nếu chưa có bảng điểm và có cả bảng điểm luôn?"
  const chosen = guidance({ targetCareerId: "b", careers: guidance().careers.map((item) => ({ ...item, isTarget: item.id === "b" })) });
  it("puts Đổi vị trí nghề nghiệp beside the target with or without a transcript, and Chọn làm mục tiêu on every other vị trí of the full list", () => {
    for (const data of [chosen, { ...chosen, blocked: "transcript_required" }]) {
      const html = page(data);
      expect(html).toMatch(/<button type="button" class="sw-outline" aria-controls="cg-all"><svg[^]*?<\/svg>Đổi vị trí nghề nghiệp<\/button>/);
      expect(html).toContain('<details id="cg-all" class="sw-panel cg-all"');
      expect(html.match(/>Chọn làm mục tiêu<\/button>/g)).toHaveLength(3);
      expect(html).toContain('aria-label="Chọn làm mục tiêu: Lập trình viên web"');
      expect(html).not.toContain('aria-label="Chọn làm mục tiêu: Kỹ sư dữ liệu"');
    }
    expect(page(guidance())).toMatch(/aria-controls="cg-all"><svg[^]*?<\/svg>Chọn vị trí nghề nghiệp<\/button>/);
  });

  it("gives the note under the target a link to Đánh giá năng lực, and leaves the note out while no fit is computed", () => {
    expect(page(chosen)).toContain('<div class="cg-note cg-note-warn"><p>Bạn chưa đánh giá năng lực với vị trí nghề nghiệp này; bấm Đánh giá năng lực để xem '
      + 'Khoảng trống kỹ năng.</p><a class="sw-outline" href="#competency">Mở Đánh giá năng lực</a></div>');
    const blocked = page({ ...chosen, blocked: "transcript_required" });
    expect(blocked).not.toContain("Bạn chưa đánh giá năng lực với vị trí nghề nghiệp này");
    expect(blocked).toContain("Mở Hồ sơ và bảng điểm");
  });

  it("shows the survey alone while no fit can be computed", () => {
    const html = page(guidance({ blocked: "transcript_required" }));
    const top = row(html.replace('<div class="cg-level"><h3>Các lựa chọn khác</h3>', "") + '<div class="cg-level"><h3>Các lựa chọn khác</h3>');
    expect(top).toContain('id="khao-sat-nhanh"');
    expect(top).not.toContain('class="sw-panel cg-top"');
    expect(html).toContain("Bạn cần tải bảng điểm lên ở Hồ sơ và bảng điểm");
  });
});
