import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CareerTargetDialog, { CareerTargetList, careerTargetRows } from "./CareerTargetDialog";
import { gapTargetSavedText } from "./career-guidance-data";
import { readCareerList, type CareerListItem } from "./career-target";

// "Đổi vị trí nghề nghiệp mục tiêu" on Khoảng trống kỹ năng (user 2026-11-17): the catalog by name, no điểm phù hợp ("đây là tính năng
// của bên trang định hướng nghề nghiệp"). Synthetic careers only; without a DOM the first render.
const careers: CareerListItem[] = [
  { id: "c", nameVi: "Kiểm thử viên", nameEn: "Software Tester", categoryName: "Kiểm thử" },
  { id: "a", nameVi: "Lập trình viên web", nameEn: "Web Developer", categoryName: "Phát triển phần mềm" },
  { id: "b", nameVi: "Kỹ sư dữ liệu", nameEn: "Data Engineer", categoryName: "Dữ liệu" },
];
const list = (currentId: string | null, query = "", saving: string | null = null) =>
  renderToStaticMarkup(createElement(CareerTargetList, { careers, currentId, query, saving, onPick: () => {} }));
const names = (html: string) => [...html.matchAll(/<h4>([^<]+)<\/h4>/g)].map((match) => match[1]);

afterEach(() => { vi.unstubAllGlobals(); });

describe("the list of the popup", () => {
  it("lists every vị trí by name with the target first, marked in place of its button, and no fit", () => {
    const html = list("b");
    expect(html).toContain('<p class="sw-muted" role="status">3 vị trí nghề nghiệp</p>');
    expect(names(html)).toEqual(["Kỹ sư dữ liệu", "Kiểm thử viên", "Lập trình viên web"]);
    expect(html).toMatch(/<li class="is-target">.*?Kỹ sư dữ liệu.*?<span class="cg-target-tag cg-target-tag-action">.*?Vị trí nghề nghiệp mục tiêu<\/span><\/div><\/li>/);
    expect(html).toContain('<p class="cg-en">Data Engineer · Dữ liệu</p>');
    expect(html).not.toContain('aria-label="Chọn làm mục tiêu: Kỹ sư dữ liệu"');
    expect(html).toContain('aria-label="Chọn làm mục tiêu: Lập trình viên web"');
    for (const word of ["Điểm phù hợp", "cg-score", "cg-fit", "/100"]) expect(html).not.toContain(word);
    // No target yet: by name only.
    expect(names(list(null))).toEqual(["Kiểm thử viên", "Kỹ sư dữ liệu", "Lập trình viên web"]);
  });

  it("finds by Vietnamese or English name or field, says when nothing matches, and holds the buttons while one is saved", () => {
    expect(careerTargetRows(careers, null, "kiem thu").map((career) => career.id)).toEqual(["c"]);
    expect(careerTargetRows(careers, null, "engineer").map((career) => career.id)).toEqual(["b"]);
    expect(careerTargetRows(careers, null, "phat trien").map((career) => career.id)).toEqual(["a"]);
    expect(list(null, "khong co")).toContain('<p class="cg-empty">Không có vị trí nghề nghiệp nào khớp từ khóa.</p>');
    const saving = list("b", "", "a");
    expect(saving).toMatch(/<button type="button" class="sw-outline" disabled="" aria-label="Chọn làm mục tiêu: Lập trình viên web">.*?Đang lưu…<\/button>/);
    expect(saving).toMatch(/disabled="" aria-label="Chọn làm mục tiêu: Kiểm thử viên">.*?Chọn làm mục tiêu<\/button>/);
  });
});

describe("the popup", () => {
  it("opens with its title, the way to the fits of Định hướng nghề nghiệp, and a status while the list loads", () => {
    const html = renderToStaticMarkup(createElement(CareerTargetDialog, { currentId: null, onClose: () => {}, onSaved: () => {} }));
    expect(html).toContain('<dialog class="cg-dialog ctd-dialog" aria-labelledby="ctd-title">');
    expect(html).toContain('<h2 id="ctd-title">Đổi vị trí nghề nghiệp mục tiêu</h2>');
    expect(html).toContain('<p role="status">Đang tải danh sách vị trí nghề nghiệp…</p>');
    expect(html).toContain('Muốn xem điểm phù hợp, yêu cầu kỹ năng của từng vị trí hoặc so sánh các vị trí? <a class="sw-text-link" href="#career">Mở Định hướng nghề nghiệp</a>');
  });

  it("reads the plain catalog list, not the fits", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: "a", code: "NN001", nameVi: "Lập trình viên web", nameEn: "Web Developer", category: "1", categoryName: "Phát triển phần mềm", skills: [] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await readCareerList()).toEqual([{ id: "a", nameVi: "Lập trình viên web", nameEn: "Web Developer", categoryName: "Phát triển phần mềm" }]);
    expect(fetch).toHaveBeenCalledWith("/api/student/careers", expect.objectContaining({ credentials: "include" }));
  });

  it("says what was saved: the new assessment when the API made one", () => {
    expect(gapTargetSavedText("Kỹ sư dữ liệu", true)).toBe("Đã chọn Kỹ sư dữ liệu làm vị trí nghề nghiệp mục tiêu và đánh giá lại năng lực với vị trí này.");
    expect(gapTargetSavedText("Kỹ sư dữ liệu", false)).toBe("Đã chọn Kỹ sư dữ liệu làm vị trí nghề nghiệp mục tiêu.");
  });
});
