import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudentProfiles from "./StudentProfiles";

// Synthetic ids only. The page reads its data in effects, which do not run here: these tests check what the first render shows.

afterEach(() => vi.unstubAllGlobals());
const render = (search: string) => {
  vi.stubGlobal("window", { location: { pathname: "/quantri/sinh-vien", search, hash: "" } });
  return renderToStaticMarkup(<StudentProfiles />);
};

describe("Sinh viên page", () => {
  it("opens one student's details from the address (Xem hồ sơ in the reports)", () => {
    const html = render("?id=6f1c2a9e-0b7d-4c1e-9a3f-2d4e5f607182");
    expect(html).toContain('<h2 id="account-dialog-title">Chi tiết hồ sơ sinh viên</h2>');
    expect(html).toContain("Danh sách sinh viên");
  });

  it("shows only the list without a student in the address", () => {
    const html = render("");
    expect(html).not.toContain("Chi tiết hồ sơ sinh viên");
    expect(html).toContain("Danh sách sinh viên");
  });
});
