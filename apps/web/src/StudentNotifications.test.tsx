import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotificationDetail, NotificationItem, NotificationsDrawer, NotificationsPanel, NOTIFICATION_FILTERS, badgeText, bellLabel, drawerSummary,
  moreUnreadText, notificationErrorText, notificationExcerpt, notificationTime, notificationsApi, portalLink,
} from "./StudentNotifications";
import type { StudentNotification } from "./notification-types";

// Synthetic notifications only (no student data).
const now = new Date("2026-10-30T05:00:00.000Z"); // 12:00 in Vietnam
const notification = (extra: Partial<StudentNotification> = {}): StudentNotification => ({
  id: "n1", type: "ai", kind: "assessment_comment", title: "Nhận xét năng lực đã sẵn sàng",
  body: "EduPath AI đã viết xong nhận xét cho lần Đánh giá năng lực lúc 09:12 hôm nay.", link: "#competency", linkLabel: "Mở Đánh giá năng lực",
  read: false, createdAt: "2026-10-30T04:50:00.000Z", ...extra,
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("bell texts", () => {
  it("names the bell with the unread count and caps the badge", () => {
    expect(bellLabel(0)).toBe("Thông báo");
    expect(bellLabel(3)).toBe("Thông báo, 3 chưa đọc");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(120)).toBe("99+");
  });

  it("says when a notification came in Vietnam time", () => {
    expect(notificationTime("2026-10-30T04:59:40.000Z", now)).toBe("Vừa xong");
    expect(notificationTime("2026-10-30T04:50:00.000Z", now)).toBe("10 phút trước");
    expect(notificationTime("2026-10-30T02:00:00.000Z", now)).toBe("3 giờ trước");
    // 23:30 on 29/10 in Vietnam is yesterday even though it is under 24 hours ago.
    expect(notificationTime("2026-10-29T16:30:00.000Z", now)).toBe("Hôm qua");
    expect(notificationTime("2026-10-28T03:00:00.000Z", now)).toBe("28/10/2026");
    expect(notificationTime("không phải ngày", now)).toBe("");
  });

  it("follows only portal pages and sums up the drawer", () => {
    expect(portalLink("#roadmap")).toBe("#roadmap");
    expect(portalLink("https://example.com")).toBeNull();
    expect(portalLink(null)).toBeNull();
    // The summary counts the list the filter shows, so "Cảnh báo" never reads "1 thông báo · 3 chưa đọc".
    expect(drawerSummary([notification(), notification({ id: "n2", read: true }), notification({ id: "n3" })])).toBe("3 thông báo · 2 chưa đọc");
    expect(drawerSummary([notification({ read: true })])).toBe("1 thông báo · đã đọc hết");
    expect(drawerSummary([])).toBe("0 thông báo");
    expect(drawerSummary(Array.from({ length: 50 }, (_, index) => notification({ id: `n${index}`, read: index > 0 })))).toBe("50 thông báo mới nhất · 1 chưa đọc");
    expect(NOTIFICATION_FILTERS.map((item) => item.label)).toEqual(["Tất cả", "Chưa đọc", "Cảnh báo", "Kết quả AI", "Từ Khoa", "Hệ thống"]);
  });

  it("shows the first line of the text and says when the popover has no room for every unread one", () => {
    expect(notificationExcerpt("\n  Môn bắt buộc chưa đạt: Môn A (F).  \nDòng hai")).toBe("Môn bắt buộc chưa đạt: Môn A (F).");
    expect(notificationExcerpt("")).toBe("");
    // The badge says 5: the popover shows 3 of them, so it says the other 2 are a click away.
    const shown = [notification(), notification({ id: "n2" }), notification({ id: "n3" }), notification({ id: "n4", read: true }), notification({ id: "n5", read: true })];
    expect(moreUnreadText(5, shown)).toBe("Còn 2 thông báo chưa đọc khác");
    expect(moreUnreadText(3, shown)).toBeNull();
    expect(moreUnreadText(0, [])).toBeNull();
  });
});

/** A fetch that answers with JSON bodies (a plain object stands in for Response). */
function stubFetch(answer: (url: string, init?: RequestInit) => { status: number; body?: unknown }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const result = answer(url, init);
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("requests", () => {
  it("lists by filter, polls the count and posts the actions with the session cookie", async () => {
    const fetchMock = stubFetch((url) => (url.endsWith("/n1") ? { status: 204 } : url.includes("unread-count") ? { status: 200, body: { unread: 2 } } : { status: 200, body: { items: [], unread: 0, notification: notification() } }));
    await notificationsApi.list("warn", 50);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/student/notifications?filter=warn&limit=50");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store" });
    // The popover asks for the unread ones first.
    await notificationsApi.list("all", 5, undefined, "unread");
    expect(fetchMock.mock.calls.pop()![0]).toBe("/api/student/notifications?filter=all&limit=5&order=unread");
    await expect(notificationsApi.unreadCount()).resolves.toEqual({ unread: 2 });
    await notificationsApi.read("n1");
    expect(fetchMock.mock.calls[2]).toEqual(["/api/student/notifications/n1/read", expect.objectContaining({ method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })]);
    await notificationsApi.unread("n1");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/student/notifications/n1/unread");
    await notificationsApi.readAll();
    expect(fetchMock.mock.calls[4][0]).toBe("/api/student/notifications/read-all");
    await expect(notificationsApi.remove("n1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[5][1]).toMatchObject({ method: "DELETE" });
    await notificationsApi.restore("n1");
    expect(fetchMock.mock.calls[6][0]).toBe("/api/student/notifications/n1/restore");
  });

  it("turns the server's error codes and a lost connection into Vietnamese messages", async () => {
    stubFetch(() => ({ status: 404, body: { error: "not_found" } }));
    const failure = await notificationsApi.read("n9").catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "not_found", status: 404 });
    expect(notificationErrorText(failure)).toBe("Thông báo này không còn nữa.");
    expect(notificationErrorText(new TypeError("Failed to fetch"))).toBe("Không kết nối được máy chủ. Vui lòng thử lại.");
  });

  it("tells the workspace when the session has expired", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    stubFetch(() => ({ status: 401, body: { error: "authentication_required" } }));
    await expect(notificationsApi.unreadCount()).rejects.toMatchObject({ code: "authentication_required" });
    expect(dispatchEvent.mock.calls[0][0].type).toBe("edupath-session-expired");
  });
});

describe("views", () => {
  it("shows an unread notification with its type icon, time and dot", () => {
    const html = renderToStaticMarkup(<NotificationItem notification={notification()} now={now} onSelect={() => undefined} />);
    expect(html).toContain('class="nt-item nt-ai nt-unread"');
    expect(html).toContain(">AI<");
    expect(html).toContain("Kết quả AI · 10 phút trước · chưa đọc");
    expect(html).toContain('<span class="nt-excerpt">EduPath AI đã viết xong nhận xét cho lần Đánh giá năng lực lúc 09:12 hôm nay.</span>');
    const read = renderToStaticMarkup(<NotificationItem notification={notification({ type: "warn", read: true })} now={now} current onSelect={() => undefined} />);
    expect(read).toContain('class="nt-item nt-warn"');
    expect(read).toContain('aria-current="true"');
    expect(read).not.toContain("chưa đọc");
  });

  it("offers the page, read or unread and delete in the detail, and says how long it is kept", () => {
    const html = renderToStaticMarkup(<NotificationDetail notification={notification()} now={now} busy={false} error=""
      onBack={() => undefined} onOpenLink={() => undefined} onToggleRead={() => undefined} onDelete={() => undefined} />);
    expect(html).toContain("Mở Đánh giá năng lực");
    expect(html).toContain("Đánh dấu đã đọc");
    expect(html).toContain("Xóa");
    expect(html).toContain("‹ Quay lại danh sách");
    expect(html).toContain("Thông báo tự xóa sau 90 ngày.");
    const plain = renderToStaticMarkup(<NotificationDetail notification={notification({ read: true, link: "https://example.com" })} now={now} busy error="Thông báo này không còn nữa."
      onBack={() => undefined} onOpenLink={() => undefined} onToggleRead={() => undefined} onDelete={() => undefined} />);
    expect(plain).not.toContain("Mở Đánh giá năng lực");
    expect(plain).toContain("Đánh dấu chưa đọc");
    expect(plain).toContain('role="alert"');
  });

  it("labels the popover by its heading while the list loads", () => {
    const html = renderToStaticMarkup(<NotificationsPanel onOpen={() => undefined} onOpenAll={() => undefined} onUnread={() => undefined} />);
    expect(html).toContain('id="student-notifications-title"');
    expect(html).toContain("Đang tải thông báo…");
    expect(html).toContain("Xem tất cả thông báo");
  });

  it("opens the drawer on the notification picked in the popover, with every filter", () => {
    const html = renderToStaticMarkup(<NotificationsDrawer initial={notification()} onClose={() => undefined} onNavigate={() => undefined} onUnread={() => undefined} />);
    expect(html).toContain('class="nt-drawer"');
    expect(html).toContain('aria-labelledby="nt-drawer-title"');
    expect(html).toContain("Tất cả thông báo");
    expect(html).toContain('aria-pressed="true">Tất cả</button>');
    for (const label of ["Chưa đọc", "Cảnh báo", "Kết quả AI", "Từ Khoa", "Hệ thống"]) expect(html).toContain(`aria-pressed="false">${label}</button>`);
    expect(html).toContain("nt-drawer-body nt-has-detail");
    expect(html).toContain("Nhận xét năng lực đã sẵn sàng");
    const empty = renderToStaticMarkup(<NotificationsDrawer initial={null} onClose={() => undefined} onNavigate={() => undefined} onUnread={() => undefined} />);
    expect(empty).toContain("Chọn một thông báo để xem chi tiết.");
    // From the popover's "Còn … chưa đọc khác": the drawer opens on "Chưa đọc".
    const unread = renderToStaticMarkup(<NotificationsDrawer initial={null} initialFilter="unread" onClose={() => undefined} onNavigate={() => undefined} onUnread={() => undefined} />);
    expect(unread).toContain('aria-pressed="true">Chưa đọc</button>');
    expect(unread).toContain('aria-pressed="false">Tất cả</button>');
  });
});
