import { afterEach, describe, expect, it, vi } from "vitest";
import { notify, notifyInTransaction, notifyWarnings, transcriptFailed, transcriptReady } from "./notify.js";

// Writing notifications (migration 056): idempotent by source_key, never breaking the job that reports. Synthetic ids only.
const USER = "11111111-1111-4111-8111-111111111111";

function fakeDb(rowCount = 1, fail = false) {
  const query = vi.fn(async (sql: string) => {
    if (fail && sql.startsWith("INSERT INTO stu_notifications")) throw Object.assign(new Error("boom"), { code: "23514" });
    return { rowCount: sql.startsWith("INSERT") ? rowCount : 0, rows: [] };
  });
  return { query, sql: () => query.mock.calls.map(([text]) => String(text)), params: (index: number) => query.mock.calls[index]?.[1] as unknown[] };
}

afterEach(() => vi.restoreAllMocks());

describe("notify", () => {
  it("writes one row per source key, keeps only portal links and labels them", async () => {
    const db = fakeDb();
    expect(await notify(db, USER, { type: "ai", kind: "roadmap_ready", title: "  Lộ trình xong ", body: "Nội dung", link: "#roadmap", sourceKey: "roadmap:1" })).toBe(true);
    expect(db.sql()[0]).toContain("ON CONFLICT (user_id,source_key) WHERE source_key IS NOT NULL DO NOTHING");
    const [, user, type, kind, title, body, link, label, key, announcement] = db.params(0);
    expect([user, type, kind, title, body, link, label, key, announcement]).toEqual([USER, "ai", "roadmap_ready", "Lộ trình xong", "Nội dung", "#roadmap", "Mở Lộ trình học tập", "roadmap:1", null]);

    const outside = fakeDb(0);
    expect(await notify(outside, USER, { type: "khoa", kind: "announcement", title: "T", body: "B", link: "https://example.com" })).toBe(false);
    expect(outside.params(0).slice(6, 8)).toEqual([null, null]);
  });

  it("clips the title and body to the column limits", async () => {
    const db = fakeDb();
    await notify(db, USER, { type: "sys", kind: "catalog_updated", title: "T".repeat(260), body: "B".repeat(1500) });
    const [, , , , title, body] = db.params(0) as string[];
    expect(Array.from(title!)).toHaveLength(200);
    expect(Array.from(body!)).toHaveLength(1000);
    expect(body!.endsWith("…")).toBe(true);
  });

  it("writes under a savepoint inside a transaction and swallows its failure", async () => {
    const ok = fakeDb();
    await notifyInTransaction(ok, USER, transcriptReady(40, 10));
    expect(ok.sql()).toEqual(["SAVEPOINT edupath_notify", expect.stringContaining("INSERT INTO stu_notifications"), "RELEASE SAVEPOINT edupath_notify"]);

    const failing = fakeDb(1, true);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(notifyInTransaction(failing, USER, transcriptFailed("ocr_failed"))).resolves.toBeUndefined();
    expect(failing.sql()).toEqual(["SAVEPOINT edupath_notify", expect.stringContaining("INSERT INTO stu_notifications"), "ROLLBACK TO SAVEPOINT edupath_notify"]);
    expect(log).toHaveBeenCalledWith("[notifications] transcript_failed not written (23514)");
  });

  it("explains a transcript failure by its code", () => {
    expect(transcriptFailed("encrypted_pdf").body).toContain("PDF đang khóa bằng mật khẩu.");
    expect(transcriptFailed("something_new").body).toContain("Có lỗi khi đọc bảng điểm.");
    expect(transcriptReady(40, 10).body).toContain("đọc xong 40 học phần trong 10 học kỳ");
    expect(transcriptReady(null, null).body).toContain("đã đọc xong từ bảng điểm PDF");
  });
});

describe("notifyWarnings", () => {
  it("writes one notification per new risk or warn item, keyed by kind and key", async () => {
    const db = fakeDb();
    const written = await notifyWarnings(db, USER, [
      { kind: "failed_course", key: "71ITSE30603", level: "risk", text: "Môn bắt buộc chưa đạt: Phát triển ứng dụng di động.", action: { label: "Thêm vào Kế hoạch học kỳ", link: "#roadmap" } },
      { kind: "on_track", key: "all", level: "ok", text: "Bạn đang đúng tiến độ." },
      { kind: "made_up", key: "x", level: "warn", text: "?" },
      { kind: "late_course", key: "71ITIS30303", level: "warn", text: "Phân tích thiết kế hệ thống trễ kế hoạch.", action: { label: "Mở", link: "javascript:alert(1)" } },
    ]);
    expect(written).toBe(2);
    expect(db.query).toHaveBeenCalledTimes(2);
    const first = db.params(0);
    expect(first.slice(2, 9)).toEqual(["warn", "warning", "Có môn bắt buộc chưa đạt", "Môn bắt buộc chưa đạt: Phát triển ứng dụng di động.", "#roadmap", "Thêm vào Kế hoạch học kỳ", "warning:failed_course:71ITSE30603"]);
    // A link outside the portal is dropped with its label.
    expect(db.params(1).slice(6, 9)).toEqual([null, null, "warning:late_course:71ITIS30303"]);
  });

  it("counts only the rows actually written", async () => {
    const db = fakeDb(0);
    expect(await notifyWarnings(db, USER, [{ kind: "pace", key: "HK262", level: "risk", text: "Cần 19 TC mỗi kỳ." }])).toBe(0);
  });
});
