import { describe, expect, it, vi } from "vitest";
import { cohortsText, deliverReminder, remindAtOf, remindDueWindows, reminderText, whenText, type RegistrationWindowRow } from "./registration.js";

// Lịch đăng ký học tập (2026-11-25): the reminders of the registration windows. Made-up windows and students only.
const A = "22222222-2222-4222-8222-222222222221";
const B = "22222222-2222-4222-8222-222222222222";
const W = "33333333-3333-4333-8333-333333333333";
const at = (text: string) => new Date(text);
const window = (extra: Partial<RegistrationWindowRow> = {}): RegistrationWindowRow => ({
  id: W, termCode: "HK262", kind: "course", round: "Đợt 1", cohorts: ["K29"], opensAt: at("2026-11-26T15:00:00Z"), closesAt: at("2026-11-27T07:00:00Z"),
  remindBefore: 0, remindAt: at("2026-11-26T15:00:00Z"), note: null, remindedAt: null, outcome: null, recipients: null, withdrawnAt: null,
  read: 0, createdBy: null, createdAt: at("2026-11-25T10:00:00Z"), updatedAt: at("2026-11-25T10:00:00Z"), ...extra,
});

describe("the reminder students get", () => {
  it("names the đợt, the term, the cohorts and both times in Vietnam time before the opening", () => {
    const text = reminderText(window({ kind: "study_plan", round: " Đợt 2 (bổ sung) ", cohorts: ["K30", "K31"] }), at("2026-11-25T15:00:00Z"));
    expect(text.title).toBe("Nhắc đăng ký kế hoạch học tập HK2 2026–2027: Đợt 2 (bổ sung)");
    expect(text.body).toContain("Đợt 2 (bổ sung) đăng ký kế hoạch học tập HK2 2026–2027 dành cho sinh viên K30, K31 mở lúc 22:00 ngày 26/11/2026 và kết thúc lúc 14:00 ngày 27/11/2026.");
    expect(text.body).toContain("Bạn đăng ký tại https://regist.vlu.edu.vn/ và nên trao đổi với cố vấn học tập trước khi đăng ký.");
    expect(text.body).toContain("Chưa đăng ký kế hoạch học tập thì không được đăng ký học phần ở Đợt 1");
    expect(text.body.endsWith("Bạn xem Kế hoạch học kỳ trên EduPath AI để chọn môn phù hợp với lộ trình.\nEduPath AI")).toBe(true);
    // Under EduPath AI's name, never the Khoa's.
    expect(text.body).not.toContain("Khoa");
  });

  it("gives the closing time once the window is open, and the admin's note before the closing lines", () => {
    const text = reminderText(window({ cohorts: [], note: "  Lớp học phần còn ít chỗ, đăng ký sớm.  " }), at("2026-11-26T15:00:00Z"));
    expect(text.title).toBe("Nhắc đăng ký học phần HK2 2026–2027: Đợt 1");
    expect(text.body.startsWith("Đợt 1 đăng ký học phần HK2 2026–2027 dành cho tất cả sinh viên đang mở, đến 14:00 ngày 27/11/2026.")).toBe(true);
    expect(text.body).toContain("Chưa hoàn tất học phí các học kỳ trước thì chưa đăng ký được học phần.\n\nLớp học phần còn ít chỗ, đăng ký sớm.\n\nBạn xem Kế hoạch học kỳ");
    expect(Array.from(text.body).length).toBeLessThanOrEqual(1000);
  });

  it("writes times and cohorts as the notices do, and reminds one or two days ahead", () => {
    expect(whenText(at("2026-04-15T15:00:00Z"))).toBe("22:00 ngày 15/04/2026");
    expect(cohortsText([])).toBe("tất cả sinh viên");
    expect(cohortsText(["K28", "K29"])).toBe("sinh viên K28, K29");
    expect(remindAtOf(at("2026-11-26T15:00:00Z"), 1440).toISOString()).toBe("2026-11-25T15:00:00.000Z");
    expect(remindAtOf(at("2026-11-26T15:00:00Z"), 0).toISOString()).toBe("2026-11-26T15:00:00.000Z");
  });
});

function fakeClient(options: { off?: boolean; students?: string[]; written?: number } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT EXISTS (SELECT 1 FROM ad_notification_settings")) return { rowCount: 1, rows: [{ off: options.off ?? false }] };
    if (sql.startsWith("SELECT u.id FROM users u")) return { rowCount: (options.students ?? [A, B]).length, rows: (options.students ?? [A, B]).map((id) => ({ id })) };
    if (sql.startsWith("INSERT INTO stu_notifications")) return { rowCount: options.written ?? (options.students ?? [A, B]).length, rows: [] };
    return { rowCount: 0, rows: [] };
  });
  const calls = () => query.mock.calls.map((call) => [String((call as unknown[])[0]), (call as unknown[])[1]] as const);
  return { query, calls };
}

describe("sending a window's reminder", () => {
  it("notifies the window's students under EduPath AI's name, once, and records it", async () => {
    const client = fakeClient();
    expect(await deliverReminder(client, window(), ["vlu.edu.vn"], at("2026-11-26T15:00:00Z"))).toBe("sent");
    const reach = client.calls().find(([sql]) => sql.startsWith("SELECT u.id FROM users u"))!;
    expect(reach[1]).toEqual([["K29"], [], ["vlu.edu.vn"], []]);
    const insert = client.calls().find(([sql]) => sql.startsWith("INSERT INTO stu_notifications"))!;
    const params = insert[1] as unknown[][];
    expect(params[1]).toEqual([A, B]);
    expect(params[2]).toEqual(["sys", "sys"]);
    expect(params[3]).toEqual(["registration_reminder", "registration_reminder"]);
    expect(params[6]).toEqual(["#roadmap", "#roadmap"]);
    expect(params[8]).toEqual([`registration:${W}`, `registration:${W}`]);
    const recorded = client.calls().find(([sql]) => sql.startsWith("UPDATE ad_registration_windows SET reminded_at=now()"))!;
    expect(recorded[1]).toEqual([W, "sent", 2]);
  });

  it("sends nothing once the window has ended, while the kind is off, or to nobody", async () => {
    const closed = fakeClient();
    expect(await deliverReminder(closed, window(), ["vlu.edu.vn"], at("2026-11-27T08:00:00Z"))).toBe("closed");
    expect(closed.calls().some(([sql]) => sql.startsWith("INSERT INTO stu_notifications"))).toBe(false);
    const off = fakeClient({ off: true });
    expect(await deliverReminder(off, window(), ["vlu.edu.vn"], at("2026-11-26T15:00:00Z"))).toBe("turned_off");
    expect(off.calls().find(([sql]) => sql.startsWith("SELECT EXISTS"))![0]).toContain("WHEN 'registration_reminder'::text='registration_reminder' THEN 'registration'");
    const nobody = fakeClient({ students: [] });
    expect(await deliverReminder(nobody, window(), ["vlu.edu.vn"], at("2026-11-26T15:00:00Z"))).toBe("nobody");
    expect(nobody.calls().at(-1)![1]).toEqual([W, "nobody", 0]);
  });

  it("handles every due window in one transaction, skipping those another round holds", async () => {
    const client = fakeClient();
    const query = client.query;
    query.mockImplementation((async (sql: string) => {
      if (sql.startsWith("SELECT w.id")) return { rowCount: 1, rows: [window({ closesAt: at("2099-01-01T00:00:00Z") })] };
      if (sql.startsWith("SELECT EXISTS")) return { rowCount: 1, rows: [{ off: false }] };
      if (sql.startsWith("SELECT u.id FROM users u")) return { rowCount: 1, rows: [{ id: A }] };
      if (sql.startsWith("INSERT INTO stu_notifications")) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    }) as never);
    const release = vi.fn();
    expect(await remindDueWindows({ connect: async () => ({ query, release }) } as never, ["vlu.edu.vn"])).toBe(1);
    const statements = client.calls().map(([sql]) => sql);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain("WHERE w.reminded_at IS NULL AND w.remind_at<=now()");
    expect(statements[1]).toContain("FOR UPDATE OF w SKIP LOCKED");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
});
