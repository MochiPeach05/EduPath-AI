import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccountsManagement, { AccountDetails } from "./AccountsManagement";

// Synthetic accounts only. The page reads its data in effects, which do not run here: each request answers what the test
// gave for the start of its address, any other is still loading.
const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));
const answers = new Map<string, unknown>();
liveData.mockImplementation((url: string) => {
  const key = [...answers.keys()].find((start) => url.startsWith(start));
  return key ? { data: answers.get(key), error: null, loading: false } : { data: null, error: null, loading: true };
});
afterEach(() => answers.clear());

const account = { id: "a1", name: "Quản trị Thử nghiệm", email: "qt.thu@vlu.edu.vn", username: "qt.thu@vlu.edu.vn", role: "admin", isActive: true, lastLoginAt: null };

describe("Tài khoản page: whether an account has signed in (user 2026-11-07)", () => {
  it("writes Chưa đăng nhập in red and the last sign-in time in green in the list", () => {
    answers.set("/api/admin/accounts?", {
      items: [
        { ...account, stt: 1 },
        { ...account, stt: 2, id: "a2", name: "Giảng viên Thử nghiệm", email: "gv.thu@vlu.edu.vn", role: "lecturer", lastLoginAt: "2026-11-06T02:15:00.000Z" },
      ],
      total: 2, page: 1, pageSize: 10,
    });
    const html = renderToStaticMarkup(<AccountsManagement actorId="a0" canManage />);
    expect(html).toContain('<td><span class="am-not-signed-in">Chưa đăng nhập</span></td>');
    expect(html).toContain('<td><span class="am-signed-in">09:15 06/11/2026</span></td>');
    // Trạng thái (Đang hoạt động, Đã khóa) is another state: it keeps its own colours.
    expect(html).toMatch(/<span class="am-state ?">Đang hoạt động<\/span>/);
    expect(html).not.toMatch(/am-(not-)?signed-in[^>]*>Đang hoạt động/);
  });

  it("colours the first and the last sign-in of the details the same way", () => {
    const detail = { ...account, createdAt: "2026-10-01T01:00:00.000Z", updatedAt: "2026-10-01T01:00:00.000Z", firstLoginAt: null };
    answers.set("/api/admin/accounts/a1", { user: detail });
    const never = renderToStaticMarkup(<AccountDetails id="a1" />);
    expect(never).toContain('<dt>Đăng nhập đầu tiên</dt><dd><span class="am-not-signed-in">Chưa đăng nhập</span></dd>');
    expect(never).toContain('<dt>Đăng nhập gần nhất</dt><dd><span class="am-not-signed-in">Chưa đăng nhập</span></dd>');
    answers.set("/api/admin/accounts/a1", { user: { ...detail, firstLoginAt: "2026-10-02T01:00:00.000Z", lastLoginAt: "2026-11-06T02:15:00.000Z" } });
    const signedIn = renderToStaticMarkup(<AccountDetails id="a1" />);
    expect(signedIn).toContain('<dt>Đăng nhập đầu tiên</dt><dd><span class="am-signed-in">08:00 02/10/2026</span></dd>');
    expect(signedIn).toContain('<dt>Đăng nhập gần nhất</dt><dd><span class="am-signed-in">09:15 06/11/2026</span></dd>');
    // The other times stay plain text.
    expect(signedIn).toContain("<dt>Ngày tạo</dt><dd>08:00 01/10/2026</dd>");
  });
});
