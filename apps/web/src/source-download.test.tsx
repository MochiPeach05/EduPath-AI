import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RETRY_DELAY_MS, SourceDownloadLink, downloadSource, sourceDownloadError } from "./source-download";
import { ADMIN_ERROR_TEXTS, adminErrorText } from "./admin-errors";

// "Tải xuống Excel nguồn" over a fake server. Synthetic ids and file names only.
const url = "/api/admin/graduation/11111111-1111-4111-8111-111111111111/source/22222222-2222-4222-8222-222222222222";
const workbook = () => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
  status: 200,
  headers: { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename=\"graduation-source\"; filename*=UTF-8''Ti%C3%AAu%20chu%E1%BA%A9n%20K29.xlsx" },
});
const failure = (status: number, error?: string) => new Response(error ? JSON.stringify({ error }) : "Service Unavailable", {
  status, headers: { "Content-Type": error ? "application/json" : "text/plain" },
});
function server(...answers: (Response | Error)[]) {
  const fetch = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  });
  const wait = vi.fn(async () => undefined);
  const save = vi.fn();
  return { fetch, wait, save, deps: { fetch: fetch as unknown as typeof globalThis.fetch, wait, save } };
}

describe("source workbook download", () => {
  it("saves the workbook under the server's file name, with the session cookie", async () => {
    const { fetch, save, wait, deps } = server(workbook());
    await expect(downloadSource(url, "tieu-chuan.xlsx", deps)).resolves.toBe("Tiêu chuẩn K29.xlsx");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(url, { credentials: "include", cache: "no-store" });
    expect(wait).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.any(Blob), "Tiêu chuẩn K29.xlsx");
    expect((save.mock.calls[0]![0] as Blob).size).toBe(4);
  });

  it("tries a 503 once more after a moment, and the second answer wins", async () => {
    const { fetch, save, wait, deps } = server(failure(503), workbook());
    await expect(downloadSource(url, "tieu-chuan.xlsx", deps)).resolves.toBe("Tiêu chuẩn K29.xlsx");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(RETRY_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("tries a proxy error or a lost connection once more too", async () => {
    for (const first of [failure(502), failure(504), new TypeError("Failed to fetch")]) {
      const { fetch, save, deps } = server(first, workbook());
      await downloadSource(url, "tieu-chuan.xlsx", deps);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenCalledTimes(1);
    }
  });

  it("says plainly what failed after the one retry, and saves nothing", async () => {
    const busy = server(failure(503), failure(503));
    await expect(downloadSource(url, "x.xlsx", busy.deps)).rejects.toThrow("Máy chủ đang khởi động hoặc đang bận nên chưa tải được tệp. Vui lòng thử lại sau ít phút.");
    expect(busy.fetch).toHaveBeenCalledTimes(2);
    expect(busy.save).not.toHaveBeenCalled();
    // Anything else is worded as on every admin screen (admin-errors.ts).
    const offline = server(new TypeError("Failed to fetch"), new TypeError("Failed to fetch"));
    await expect(downloadSource(url, "x.xlsx", offline.deps)).rejects.toThrow(ADMIN_ERROR_TEXTS.network);
    const noDatabase = server(failure(503, "database_required"), failure(503, "database_required"));
    await expect(downloadSource(url, "x.xlsx", noDatabase.deps)).rejects.toThrow(adminErrorText(503, { error: "database_required" }));
  });

  it("does not retry an answer that a retry would not change", async () => {
    for (const [answer, text] of [
      [failure(404, "not_found"), "Không tìm thấy tệp nguồn của phiên bản này. Vui lòng tải lại trang."],
      [failure(403, "insufficient_role"), adminErrorText(403, { error: "insufficient_role" })],
      [failure(500, "internal_server_error"), ADMIN_ERROR_TEXTS.server],
    ] as const) {
      const { fetch, wait, deps } = server(answer);
      await expect(downloadSource(url, "x.xlsx", deps)).rejects.toThrow(text);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    }
    expect(sourceDownloadError(401)).toBe(ADMIN_ERROR_TEXTS.session);
  });

  it("stays a real link, so it can still be opened or copied the browser's way", () => {
    const html = renderToStaticMarkup(<SourceDownloadLink href={url} fallbackName="tieu-chuan.xlsx" title="Tệp gốc" />);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("Tải xuống Excel nguồn");
    expect(html).toContain('title="Tệp gốc"');
    expect(html).not.toContain('role="alert"');
  });
});
