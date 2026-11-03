import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import StudentProfileEditor from "./StudentProfileEditor";
import { installAdvisorFetch, stopActing } from "./advisor-view";

const render = (profile: Parameters<typeof StudentProfileEditor>[0]["profile"]) =>
  renderToStaticMarkup(createElement(StudentProfileEditor, { profile, onSaved: () => {} }));

describe("Mục tiêu học tập", () => {
  it("is the card of the career and the specialty, with one name for the career", () => {
    const html = render({ careerPositionId: null, careerPosition: null, specialty: null, cohortCode: "K30" });
    expect(html).toContain('<h2 id="sr-goals-title" tabindex="-1">Mục tiêu học tập</h2>');
    expect(html).toContain('id="muc-tieu-hoc-tap"');
    expect(html).toContain("<dt>Vị trí nghề nghiệp mục tiêu</dt>");
    expect(html).toContain("Chưa chọn vị trí nghề nghiệp mục tiêu.");
    expect(html).toContain("<dd>Chưa xác định</dd>");
    for (const old of ["Thông tin cá nhân", "Vị trí nghề nghiệp mong muốn", "Chưa chọn vị trí nghề nghiệp.", "Nghề mục tiêu", "nghề mục tiêu"]) expect(html).not.toContain(old);
  });

  it("offers another career when the chosen one was removed from the catalogue", () => {
    const html = render({ careerPositionId: "c1", careerPosition: { id: "c1", nameVi: "Kỹ sư dữ liệu", nameEn: "Data Engineer", deletedAt: "2026-10-20T00:00:00.000Z" }, specialty: "CNDL", cohortCode: "K29" });
    expect(html).toContain("Kỹ sư dữ liệu — Data Engineer");
    expect(html).toContain("(đã ngừng sử dụng; bạn có thể chọn vị trí nghề nghiệp khác)");
    expect(html).not.toContain("Xem yêu cầu của vị trí nghề nghiệp");
  });
});

describe("Mục tiêu học tập in a cố vấn học tập's tab", () => {
  afterEach(() => stopActing());

  it("shows the goals with no way to change them", () => {
    installAdvisorFetch("00000000-0000-4000-8000-0000000e2e05");
    const html = render({ careerPositionId: "c1", careerPosition: { id: "c1", nameVi: "Kỹ sư phần mềm", nameEn: "Software Engineer", deletedAt: null }, specialty: "CNPM", cohortCode: "K29" });
    expect(html).toContain("Kỹ sư phần mềm — Software Engineer");
    expect(html).toContain("Sinh viên tự chọn chuyên ngành và vị trí nghề nghiệp mục tiêu; bạn chỉ xem.");
    expect(html).not.toContain("Chỉnh sửa thông tin");
    expect(html).not.toContain(">Chọn vị trí nghề nghiệp mục tiêu</button>");
  });

  it("offers the changes again in the student's own tab", () => {
    const html = render({ careerPositionId: null, careerPosition: null, specialty: null, cohortCode: "K30" });
    expect(html).toContain("Chỉnh sửa thông tin");
    expect(html).toContain(">Chọn vị trí nghề nghiệp mục tiêu</button>");
    expect(html).not.toContain("Sinh viên tự chọn chuyên ngành và vị trí nghề nghiệp mục tiêu");
  });
});
