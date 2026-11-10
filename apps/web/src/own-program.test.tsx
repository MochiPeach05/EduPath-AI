import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MissingProgram, missingProgramCopy, ownItem, ownProgramLine, ownScope } from "./own-program";

// The student's own CTĐT/KHĐT (user 2026-11-10: no choice, "như trang xét tốt nghiệp"). Synthetic facts only.
describe("own-program", () => {
  it("names the cohort and the major of the MSSV; a programme the Faculty does not teach by its code", () => {
    expect(ownProgramLine("curriculum", { profileCohort: "K29", profileMajor: "7480104" }))
      .toBe("Chương trình đào tạo của khóa K29, ngành Hệ thống thông tin theo hồ sơ của bạn.");
    expect(ownProgramLine("plan", { profileCohort: "K31", profileMajor: "7480102" }))
      .toBe("Kế hoạch đào tạo của khóa K31, ngành Mạng máy tính và truyền thông dữ liệu theo hồ sơ của bạn.");
    expect(ownScope({ profileCohort: "K29", profileMajor: null })).toBe("khóa K29");
    expect(ownScope({ profileCohort: "K29", profileMajor: "7340101" })).toBe("khóa K29, mã ngành 7340101");
  });

  it("takes only the item the API names", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(ownItem({ items, suggestedId: "b" })).toEqual({ id: "b" });
    expect(ownItem({ items, suggestedId: null })).toBeNull();
    expect(ownItem({ items, suggestedId: "c" })).toBeNull();
    expect(ownItem(null)).toBeNull();
  });

  it("says why there is none in the words of Xét tốt nghiệp, with the profile link only where checking it helps", () => {
    const several = missingProgramCopy("curriculum", { profileCohort: "K29", profileMajor: "7480201", resolution: "ambiguous" });
    expect(several).toEqual({
      title: "Có nhiều chương trình đào tạo cùng phù hợp với bạn",
      text: "Khóa K29, ngành Công nghệ thông tin đang có hơn một chương trình đào tạo nên hệ thống chưa chọn được bản đúng. Khoa sẽ rà soát lại; bạn chưa cần làm gì thêm.",
      action: false,
    });
    const card = renderToStaticMarkup(createElement(MissingProgram, { kind: "plan", facts: { profileCohort: "K29", profileMajor: "7480201", resolution: "ambiguous" } }));
    expect(card).not.toContain('href="#profile"');
    expect(card).toContain('<p class="sc-eyebrow">Kế hoạch đào tạo của bạn</p>');
    const noCohort = renderToStaticMarkup(createElement(MissingProgram, { kind: "plan", facts: { profileCohort: null, profileMajor: null, resolution: "cohort_unknown" } }));
    expect(noCohort).toContain("Kế hoạch đào tạo được chọn theo khóa trong tài khoản và ngành trong hồ sơ của bạn.");
    expect(noCohort).toContain("<li><span>Khóa trong tài khoản:</span> <strong>Chưa có</strong></li><li><span>Ngành trong hồ sơ:</span> <strong>Chưa có</strong></li>");
    expect(noCohort).toContain('<a class="sw-outline" href="#profile">Xem hồ sơ</a>');
  });
});
