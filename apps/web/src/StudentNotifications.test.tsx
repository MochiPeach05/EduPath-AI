import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotificationDetail, NotificationItem, NotificationsPanel, NOTIFICATION_FILTERS, badgeText, bellLabel, emptyNotificationsText,
  notificationErrorText, notificationExcerpt, notificationTime, notificationsApi, portalLink,
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

  it("follows only portal pages and lists the filters in the user's order", () => {
    expect(portalLink("#roadmap")).toBe("#roadmap");
    expect(portalLink("https://example.com")).toBeNull();
    expect(portalLink(null)).toBeNull();
    expect(NOTIFICATION_FILTERS.map((item) => item.label)).toEqual(["Tất cả", "Chưa đọc", "Cảnh báo", "Kết quả AI", "Từ Khoa", "Hệ thống"]);
  });

  it("shows the first line of the text and says why a filter is empty", () => {
    expect(notificationExcerpt("\n  Môn bắt buộc chưa đạt: Môn A (F).  \nDòng hai")).toBe("Môn bắt buộc chưa đạt: Môn A (F).");
    expect(notificationExcerpt("")).toBe("");
    expect(emptyNotificationsText("all")).toContain("Chưa có thông báo nào.");
    expect(emptyNotificationsText("unread")).toBe("Bạn đã đọc hết thông báo.");
    expect(emptyNotificationsText("khoa")).toBe("Không có thông báo nào thuộc loại này.");
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
    // "Tất cả" in the popover asks for the unread ones first.
    await notificationsApi.list("all", 50, undefined, "unread");
    expect(fetchMock.mock.calls.pop()![0]).toBe("/api/student/notifications?filter=all&limit=50&order=unread");
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

  it("is the whole view: the filters on the left, Tất cả first, and no link to another list (user 2026-11-03)", () => {
    const html = renderToStaticMarkup(<NotificationsPanel onNavigate={() => undefined} onUnread={() => undefined} />);
    expect(html).toContain('id="student-notifications-title"');
    expect(html).toContain('class="nt-side" role="group" aria-label="Lọc thông báo"');
    expect(html).toContain('aria-pressed="true"><span>Tất cả</span></button>');
    for (const label of ["Chưa đọc", "Cảnh báo", "Kết quả AI", "Từ Khoa", "Hệ thống"]) expect(html).toContain(`aria-pressed="false"><span>${label}</span></button>`);
    expect(html).toContain("Đang tải thông báo…");
    expect(html).not.toContain("Xem tất cả thông báo");
  });
});
