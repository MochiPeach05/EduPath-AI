import { describe, expect, it, vi } from "vitest";
import { createNotificationHousekeeping, purgeNotifications, targetLabel } from "./repository.js";

// The notifications' housekeeping (2026-11-25 review: the students picked for an announcement are kept as long as their
// notifications, then only how many). A fake database; no real data.
function fakeDb() {
  const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
  return { query, sql: () => query.mock.calls.map((call) => String((call as unknown[])[0])), params: () => query.mock.calls.map((call) => (call as unknown[])[1]) };
}

describe("notification housekeeping", () => {
  it("clears the picked students of an announcement after 90 days, keeping how many, with the notifications and the emails", async () => {
    const db = fakeDb();
    await purgeNotifications(db);
    const sql = db.sql();
    expect(sql[0]).toBe("DELETE FROM stu_notifications WHERE created_at<now()-make_interval(days => $1)");
    expect(sql[1]).toContain("UPDATE ad_announcements SET target=(target-'students')||jsonb_build_object('picked',jsonb_array_length(target->'students'))");
    expect(sql[1]).toContain("WHERE jsonb_typeof(target->'students')='array' AND created_at<now()-make_interval(days => $1)");
    expect(db.params()[1]).toEqual([90]);
    expect(sql.some((text) => text.startsWith("DELETE FROM ad_announcement_emails"))).toBe(true);
    expect(sql.some((text) => text.startsWith("DELETE FROM stu_notification_emails"))).toBe(true);
  });

  it("runs at most once an interval", async () => {
    const db = fakeDb();
    const tidy = createNotificationHousekeeping(60_000);
    expect(await tidy(db)).toBe(true);
    expect(await tidy(db)).toBe(false);
  });

  it("names a picked announcement by how many, before and after its list is cleared", () => {
    expect(targetLabel({ cohorts: [], majors: [], students: ["a", "b", "c"] })).toBe("3 sinh viên được chọn");
    expect(targetLabel({ cohorts: [], majors: [], picked: 1200 })).toBe("1.200 sinh viên được chọn");
    expect(targetLabel({ cohorts: [], majors: [] })).toBe("Tất cả sinh viên");
    expect(targetLabel({ cohorts: ["K29"], majors: [] })).toBe("K29");
  });
});
