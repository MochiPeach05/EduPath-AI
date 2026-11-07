import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudentProfiles, { classOf } from "./StudentProfiles";

// Synthetic ids only. The page reads its data in effects, which do not run here: these tests check what the first render
// shows, with the data a test gives for an address (any other request is still loading).
const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));
const answers = new Map<string, unknown>();
liveData.mockImplementation((url: string) => answers.has(url) ? { data: answers.get(url), error: null, loading: false } : { data: null, error: null, loading: true });

afterEach(() => { vi.unstubAllGlobals(); answers.clear(); });
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

  it("shows the sign-in times in green, and in red when the account has none (user 2026-11-07)", () => {
    const id = "6f1c2a9e-0b7d-4c1e-9a3f-2d4e5f607182";
    const student = {
      id, name: "Sinh viên Thử nghiệm", email: "sv.thu@vanlanguni.vn", isActive: true, studentCode: "2374802010994", cohortCode: "K29", className: "CNTT01",
      cohortYear: 2023, profileStatus: "complete", username: "sv.thu@vanlanguni.vn", interests: null, careerGoal: null, accountCreatedAt: "2026-09-01T01:00:00.000Z",
      firstLoginAt: "2026-09-01T01:00:00.000Z", lastLoginAt: "2026-11-06T02:15:00.000Z", profileCreatedAt: null, profileUpdatedAt: null,
    };
    answers.set(`/api/admin/students/${id}/transcript`, { transcript: null });
    answers.set(`/api/admin/students/${id}`, { student });
    const signedIn = render(`?id=${id}`);
    expect(signedIn).toContain('<dt>Đăng nhập đầu tiên</dt><dd><span class="am-signed-in">08:00 01/09/2026</span></dd>');
    expect(signedIn).toContain('<dt>Đăng nhập gần nhất</dt><dd><span class="am-signed-in">09:15 06/11/2026</span></dd>');
    // The other times stay plain text.
    expect(signedIn).toContain("<dt>Tạo tài khoản EduPath</dt><dd>08:00 01/09/2026</dd>");
    // An account given the role Sinh viên before its first sign-in has no time yet: the page's words, in red.
    answers.set(`/api/admin/students/${id}`, { student: { ...student, firstLoginAt: null, lastLoginAt: null } });
    const never = render(`?id=${id}`);
    expect(never).toContain('<dt>Đăng nhập đầu tiên</dt><dd><span class="am-not-signed-in">Chưa có dữ liệu</span></dd>');
    expect(never).toContain('<dt>Đăng nhập gần nhất</dt><dd><span class="am-not-signed-in">Chưa có dữ liệu</span></dd>');
  });

  it("names a class by its canonical code, as the advisor pages do (QA 2026-11-04)", () => {
    expect(classOf({ className: "CNTT08", classCode: "71K29CNTT08" })).toBe("71K29CNTT08");
    expect(classOf({ className: "CNTT08" })).toBe("CNTT08");
    expect(classOf({ className: null, classCode: null })).toBeNull();
  });
});
