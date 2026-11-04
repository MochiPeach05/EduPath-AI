import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ERROR_TEXTS, AdminRequestError, SESSION_EXPIRED_EVENT, adminErrorText, adminFailureText, adminRequest, readAdminResponse } from "./admin-errors";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const screenTexts = { plan_changed: "Kế hoạch đã thay đổi. Đóng hộp thoại và tải lại trước khi sửa tiếp." };

afterEach(() => vi.unstubAllGlobals());

describe("admin request failures", () => {
  it("words each status once, never calling a refused input a connection problem", () => {
    expect(adminErrorText(400, {})).toBe("Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.");
    expect(adminErrorText(422, { error: "something_new" })).toBe(ADMIN_ERROR_TEXTS.invalid);
    expect(adminErrorText(401, {})).toBe(ADMIN_ERROR_TEXTS.session);
    expect(adminErrorText(403, {})).toBe(ADMIN_ERROR_TEXTS.forbidden);
    expect(adminErrorText(404, {})).toBe(ADMIN_ERROR_TEXTS.notFound);
    expect(adminErrorText(409, {})).toBe(ADMIN_ERROR_TEXTS.conflict);
    expect(adminErrorText(413, {})).toBe(ADMIN_ERROR_TEXTS.tooLarge);
    for (const status of [500, 502, 503, 504]) expect(adminErrorText(status, "<html>")).toBe("Hệ thống đang bận hoặc gặp lỗi. Vui lòng thử lại sau.");
    expect(adminErrorText(0, {})).toBe("Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.");
  });

  it("keeps a screen's own text for its codes, then the shared texts, then the server's Vietnamese message", () => {
    expect(adminErrorText(409, { error: "plan_changed" }, screenTexts)).toBe(screenTexts.plan_changed);
    expect(adminErrorText(403, { error: "read_only_role" })).toBe("Cố vấn học tập chỉ có quyền xem ở trang quản trị.");
    // A function of the Quản trị viên read by a cố vấn học tập (API advisors/access.ts, 2026-11-04).
    expect(adminErrorText(403, { error: "admin_only" })).toBe("Chức năng này chỉ dành cho quản trị viên.");
    expect(adminErrorText(503, { error: "database_required" })).toBe("Hệ thống chưa kết nối cơ sở dữ liệu. Vui lòng thử lại sau.");
    expect(adminErrorText(400, { error: "invalid_input", message: "Tên kỹ năng không được để trống." })).toBe("Tên kỹ năng không được để trống.");
    // An English or technical message is not shown.
    expect(adminErrorText(400, { error: "invalid_input", message: "Invalid input: expected string" })).toBe(ADMIN_ERROR_TEXTS.invalid);
    expect(adminErrorText(500, { message: "Lỗi nội bộ" })).toBe(ADMIN_ERROR_TEXTS.server);
    expect(adminErrorText(422, { error: "weight_total_invalid", details: ["Tổng trọng số hiện tại 90%; cần 100%.", 3] }, { weight_total_invalid: "Tổng trọng số phải bằng 100%." }, { details: true }))
      .toBe("Tổng trọng số phải bằng 100%.\nTổng trọng số hiện tại 90%; cần 100%.");
  });

  it("reads a response: the data when it succeeds, a worded error when it fails, the session event on 401", async () => {
    await expect(readAdminResponse(json(200, { items: [1] }))).resolves.toEqual({ items: [1] });
    await expect(readAdminResponse(new Response("", { status: 200 }))).resolves.toEqual({});
    await expect(readAdminResponse(new Response("<html>Bad gateway</html>", { status: 200 }))).rejects.toMatchObject({ message: ADMIN_ERROR_TEXTS.server });
    await expect(readAdminResponse(json(409, { error: "plan_changed" }), screenTexts)).rejects.toMatchObject({ status: 409, code: "plan_changed", message: screenTexts.plan_changed });
    await expect(readAdminResponse(new Response("Bad gateway", { status: 502 }))).rejects.toMatchObject({ status: 502, code: null, message: ADMIN_ERROR_TEXTS.server });
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    await expect(readAdminResponse(json(401, { error: "authentication_required" }))).rejects.toMatchObject({ message: ADMIN_ERROR_TEXTS.session });
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: SESSION_EXPIRED_EVENT }));
  });

  it("tells a request that got no answer from one that was cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(adminRequest("/api/admin/accounts")).rejects.toMatchObject({ status: 0, message: ADMIN_ERROR_TEXTS.network });
    const aborted = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));
    await expect(adminRequest("/api/admin/accounts")).rejects.toBe(aborted);
    const fetch = vi.fn().mockResolvedValue(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);
    await adminRequest("/api/admin/plans/1", { method: "PATCH" });
    expect(fetch).toHaveBeenCalledWith("/api/admin/plans/1", { credentials: "include", cache: "no-store", method: "PATCH" });
  });

  it("words anything a request threw", () => {
    expect(adminFailureText(new AdminRequestError("Kế hoạch đã thay đổi.", 409))).toBe("Kế hoạch đã thay đổi.");
    for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "fetch failed"]) {
      expect(adminFailureText(new TypeError(message))).toBe(ADMIN_ERROR_TEXTS.network);
    }
    expect(adminFailureText(new Error("Chọn tệp .xlsx."))).toBe("Chọn tệp .xlsx.");
    expect(adminFailureText(new SyntaxError("Unexpected token '<'"))).toBe(ADMIN_ERROR_TEXTS.server);
    expect(adminFailureText(new TypeError("Cannot read properties of undefined"))).toBe(ADMIN_ERROR_TEXTS.server);
    expect(adminFailureText("boom")).toBe(ADMIN_ERROR_TEXTS.server);
  });
});
