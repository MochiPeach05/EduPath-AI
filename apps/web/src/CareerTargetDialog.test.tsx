import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CareerTargetDialog, { CareerTargetList } from "./CareerTargetDialog";
import { gapTargetSavedText, type GuidanceCareer, type GuidanceResponse } from "./career-guidance-data";

// "Đổi vị trí nghề nghiệp mục tiêu" on Khoảng trống kỹ năng (user 2026-11-17). Synthetic careers only; without a DOM the first render.
const career = (id: string, nameVi: string, score: number | null, extra: Partial<GuidanceCareer> = {}): GuidanceCareer => ({
  id, code: id, nameVi, nameEn: `${nameVi} EN`, category: "7", categoryName: "Phát triển phần mềm", description: "", isTarget: false,
  fit: score === null ? null : { score, code: score >= 80 ? "fit" : "average", label: score >= 80 ? "Phù hợp" : "Trung bình", dataShare: 1, met: 2, below: 1, notStudied: 0, upcoming: 0, noData: 0, total: 3, summaryText: "", dataText: "" },
  requirements: [], interests: { field: null, tech: [] }, ...extra,
});
const guidance = (extra: Partial<GuidanceResponse> = {}): GuidanceResponse => ({
  blocked: null, targetCareerId: "b", fields: [{ code: "7", name: "Phát triển phần mềm" }],
  careers: [career("c", "Kiểm thử viên", 64), career("a", "Lập trình viên web", 82), career("b", "Kỹ sư dữ liệu", 70, { isTarget: true })],
  surveyDone: false, deletedTargetName: null, gapCurrent: true, gapAssessedAt: null, gapCareerId: "b", gapCareerName: "Kỹ sư dữ liệu", ...extra,
});
const list = (data: GuidanceResponse, query = "", saving: string | null = null) =>
  renderToStaticMarkup(createElement(CareerTargetList, { data, query, saving, onPick: () => {} }));
const names = (html: string) => [...html.matchAll(/<h4>([^<]+)<\/h4>/g)].map((match) => match[1]);

describe("the list of the popup", () => {
  it("lists every vị trí best fit first, with its score, and marks the target in place of its button", () => {
    const html = list(guidance());
    expect(html).toContain('<p class="sw-muted" role="status">3 vị trí nghề nghiệp · Sắp xếp theo điểm phù hợp giảm dần</p>');
    expect(names(html)).toEqual(["Lập trình viên web", "Kỹ sư dữ liệu", "Kiểm thử viên"]);
    expect(html).toContain('<strong class="cg-score">82<small>/100</small></strong>');
    expect(html).toMatch(/<li class="is-target">.*?Kỹ sư dữ liệu.*?<span class="cg-target-tag cg-target-tag-action">.*?Vị trí nghề nghiệp mục tiêu<\/span><\/div><\/li>/);
    expect(html).not.toContain('aria-label="Chọn làm mục tiêu: Kỹ sư dữ liệu"');
    expect(html).toContain('aria-label="Chọn làm mục tiêu: Lập trình viên web"');
  });

  it("finds by name, says when nothing matches, and holds the buttons while one is saved", () => {
    expect(names(list(guidance(), "kiem thu"))).toEqual(["Kiểm thử viên"]);
    expect(names(list(guidance(), "engineer"))).toEqual([]);
    expect(list(guidance(), "khong co")).toContain('<p class="cg-empty">Không có vị trí nghề nghiệp nào khớp từ khóa.</p>');
    const saving = list(guidance(), "", "a");
    expect(saving).toMatch(/<button type="button" class="sw-outline" disabled="" aria-label="Chọn làm mục tiêu: Lập trình viên web">.*?Đang lưu…<\/button>/);
    expect(saving).toMatch(/disabled="" aria-label="Chọn làm mục tiêu: Kiểm thử viên">.*?Chọn làm mục tiêu<\/button>/);
  });

  it("sorts by name while no fit can be computed", () => {
    const blocked = guidance({ blocked: "transcript_required", careers: [career("c", "Kiểm thử viên", null), career("a", "Lập trình viên web", null), career("b", "Kỹ sư dữ liệu", null)] });
    const html = list(blocked);
    expect(html).toContain("3 vị trí nghề nghiệp · Sắp xếp theo tên");
    expect(names(html)).toEqual(["Kiểm thử viên", "Kỹ sư dữ liệu", "Lập trình viên web"]);
    expect(html).toContain('<span class="cg-fit cg-fit-0">Chưa tính</span>');
  });
});

describe("the popup", () => {
  it("opens with its title, the way back to Định hướng nghề nghiệp, and a status while the fits are computed", () => {
    const html = renderToStaticMarkup(createElement(CareerTargetDialog, { onClose: () => {}, onSaved: () => {} }));
    expect(html).toContain('<dialog class="cg-dialog ctd-dialog" aria-labelledby="ctd-title">');
    expect(html).toContain('<h2 id="ctd-title">Đổi vị trí nghề nghiệp mục tiêu</h2>');
    expect(html).toContain('<p role="status">Đang tính điểm phù hợp với từng vị trí nghề nghiệp…</p>');
    expect(html).toContain('<a class="sw-text-link" href="#career">Mở Định hướng nghề nghiệp</a>');
  });

  it("says what was saved: the new assessment when the API made one", () => {
    expect(gapTargetSavedText("Kỹ sư dữ liệu", true)).toBe("Đã chọn Kỹ sư dữ liệu làm vị trí nghề nghiệp mục tiêu và đánh giá lại năng lực với vị trí này.");
    expect(gapTargetSavedText("Kỹ sư dữ liệu", false)).toBe("Đã chọn Kỹ sư dữ liệu làm vị trí nghề nghiệp mục tiêu.");
  });
});
