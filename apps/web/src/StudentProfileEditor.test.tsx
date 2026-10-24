import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StudentProfileEditor from "./StudentProfileEditor";

const render = (profile: Parameters<typeof StudentProfileEditor>[0]["profile"]) =>
  renderToStaticMarkup(createElement(StudentProfileEditor, { profile, onSaved: () => {} }));

describe("Mục tiêu học tập", () => {
  it("is the card of the career and the specialty, with one name for the career", () => {
    const html = render({ careerPositionId: null, careerPosition: null, specialty: null, cohortCode: "K30" });
    expect(html).toContain('<h2 id="sr-goals-title" tabindex="-1">Mục tiêu học tập</h2>');
    expect(html).toContain('id="muc-tieu-hoc-tap"');
    expect(html).toContain("<dt>Nghề mục tiêu</dt>");
    expect(html).toContain("Chưa chọn nghề mục tiêu.");
    expect(html).toContain("<dd>Chưa xác định</dd>");
    for (const old of ["Thông tin cá nhân", "Vị trí nghề nghiệp mong muốn", "Chưa chọn vị trí nghề nghiệp"]) expect(html).not.toContain(old);
  });

  it("offers another career when the chosen one was removed from the catalogue", () => {
    const html = render({ careerPositionId: "c1", careerPosition: { id: "c1", nameVi: "Kỹ sư dữ liệu", nameEn: "Data Engineer", deletedAt: "2026-10-20T00:00:00.000Z" }, specialty: "CNDL", cohortCode: "K29" });
    expect(html).toContain("Kỹ sư dữ liệu — Data Engineer");
    expect(html).toContain("(đã ngừng sử dụng; bạn có thể chọn nghề khác)");
    expect(html).not.toContain("Xem yêu cầu nghề nghiệp");
  });
});
