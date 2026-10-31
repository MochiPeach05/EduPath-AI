import { describe, expect, it, vi } from "vitest";
import { auditActorOf, clip, foldText, recordAudit } from "./record.js";

const actor = { userId: "3f2b8c1e-5d4a-4b6f-9a1e-2c3d4e5f6a7b", name: "Phạm Thu Trang", role: "faculty_board" };

describe("audit log writes", () => {
  it("inserts one row with the actor, the folded search text and the request", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await recordAudit({ query }, actor, { kind: "report", action: "Xuất Excel", summary: "Xuất Excel: Sinh viên có nguy cơ (18 dòng)",
      targetType: "report", targetId: "risk", method: "get", path: "/api/admin/reports/risk.xlsx" });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(String(sql)).toContain("INSERT INTO ad_audit_log");
    expect(values).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/), actor.userId, "Phạm Thu Trang", "faculty_board", "report", "Xuất Excel",
      "Xuất Excel: Sinh viên có nguy cơ (18 dòng)", "report", "risk", "GET", "/api/admin/reports/risk.xlsx",
      "pham thu trang xuat excel xuat excel: sinh vien co nguy co (18 dong)"]);
  });

  it("cuts long texts, falls back to other for an unknown kind and stores no actor id that is not a UUID", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await recordAudit({ query }, { userId: "admin", name: "  ", role: null }, { kind: "weird" as never, action: "", summary: "x".repeat(900) });
    const values = query.mock.calls[0]![1] as unknown[];
    expect(values[1]).toBeNull();
    expect(values[2]).toBe("Không rõ");
    expect(values[3]).toBeNull();
    expect(values[4]).toBe("other");
    expect(values[5]).toBe("Thao tác");
    expect((values[6] as string).length).toBe(500);
    expect((values[6] as string).endsWith("…")).toBe(true);
    expect(values.slice(7, 11)).toEqual([null, null, null, null]);
  });

  it("never throws: a failed write is only reported, and there is nothing to do without a database", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const query = vi.fn().mockRejectedValue(new Error("relation does not exist"));
    await expect(recordAudit({ query }, actor, { kind: "access", action: "Xem bảng điểm", summary: "Xem bảng điểm" })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("audit_log_write_failed", "relation does not exist");
    await expect(recordAudit(undefined, actor, { kind: "access", action: "Xem bảng điểm", summary: "Xem bảng điểm" })).resolves.toBeUndefined();
    error.mockRestore();
  });

  it("names the actor from the session and folds Vietnamese for search", () => {
    expect(auditActorOf({ userId: "u", name: "", email: "bcnkhoa.test@vlu.edu.vn", role: "admin" })).toEqual({ userId: "u", name: "bcnkhoa.test@vlu.edu.vn", role: "admin" });
    expect(foldText("  Đổi VAI trò   Trưởng/phó bộ môn ")).toBe("doi vai tro truong/pho bo mon");
    expect(clip(" a\n b ", 10)).toBe("a b");
    expect(clip("abcdef", 4)).toBe("abc…");
  });
});
