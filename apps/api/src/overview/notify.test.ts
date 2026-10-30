import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { refreshWarningNotifications } from "./router.js";
import type { OverviewResponse, OverviewWarning } from "./types.js";

// "Cần chú ý" → the bell (2026-10-30). Synthetic ids and texts only.
const userId = "11111111-1111-4111-8111-111111111111";
const warning = (extra: Partial<OverviewWarning>): OverviewWarning => ({
  level: "warn", kind: "late_course", key: "late:71ITIS30303", text: "Phân tích thiết kế hệ thống trễ so với kế hoạch.", strong: [],
  action: { label: "Thêm vào Kế hoạch học kỳ", link: "#roadmap" }, ...extra,
});
const overview = (items: OverviewWarning[]) => ({ warnings: { level: "risk", items } }) as unknown as OverviewResponse;

afterEach(() => vi.restoreAllMocks());

describe("refreshWarningNotifications", () => {
  it("writes one notification per risk or warn item, keyed by its kind and key, and none for on_track or missing data", async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [] }));
    await refreshWarningNotifications({ query } as unknown as DatabasePool, userId, new Date("2026-10-30T03:00:00Z"), overview([
      warning({ level: "risk", kind: "failed_course", key: "failed:71ITSE30603", text: "Phát triển ứng dụng di động chưa đạt." }),
      warning({}),
      warning({ level: "ok", kind: "on_track", key: "on_track", text: "Bạn đang đúng tiến độ.", action: null }),
      warning({ kind: "missing_data", key: "missing:plan_unavailable", text: "Chưa tính được tiến độ." }),
    ]));
    const inserts = query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO stu_notifications"));
    expect(inserts.map(([, params]) => (params as unknown[])[8])).toEqual(["warning:failed_course:failed:71ITSE30603", "warning:late_course:late:71ITIS30303"]);
    expect((inserts[0]![1] as unknown[]).slice(1, 4)).toEqual([userId, "warn", "warning"]);
  });

  it("never throws: a database failure is logged with its name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const query = vi.fn(async () => { throw new Error("connection lost (contains no data)"); });
    await expect(refreshWarningNotifications({ query } as unknown as DatabasePool, userId, new Date(), overview([warning({})]))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[overview] warning notifications not written (Error)");
  });
});
