import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { readAdvisorGrid } from "./import.js";
import { PostgresAdvisorRepository } from "./repository.js";

// Invented accounts only.
const admin = {
  userId: "99999999-9999-4999-8999-999999999999", identityKey: "t:o", tenantId: "t", objectId: "o", name: "Quản trị",
  email: "qtv@vlu.edu.vn", username: "qtv@vlu.edu.vn", role: "admin", signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;

describe("the students of the advisors' lists (Quản lý sinh viên)", () => {
  it("counts a student as done with every step after a transcript, an assessment and an AI roadmap; the survey is optional (2026-11-14)", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total: 0 }] });
    const repository = new PostgresAdvisorRepository({ query } as unknown as DatabasePool, new Set(["vlu.edu.vn"]));
    await repository.students(admin, { q: "", status: "complete", page: 1, pageSize: 20 });
    const sql = String(query.mock.calls[0]![0]);
    expect(sql).toContain(`WHEN 'complete' THEN "hasTranscript" AND assessed AND roadmap ELSE TRUE END`);
    // Who has not done the survey can still be listed.
    expect(sql).toContain(`WHEN 'no_survey' THEN NOT "surveyDone"`);
    expect(query.mock.calls[0]![1]).toEqual([null, null, "", "complete", 20, 0]);
  });
});

/**
 * The advisor tables in memory, answering the statements apply() sends (repository.ts: lookups, ensureAccount, the
 * ad_advisors upsert, the display name, setClasses). writes lists every INSERT, UPDATE and DELETE that changed a row.
 */
function advisorTables(seed: { email: string; name: string; staffCode?: string; unit?: string; classes: string[] }[] = []) {
  let clock = 0;
  const users = new Map<string, { email: string; displayName: string }>();
  const advisors = new Map<string, { name: string; staffCode: string | null; unit: string | null; updatedAt: number }>();
  const classes = new Map<string, { advisor: string; assignedAt: number }>();
  for (const [index, row] of seed.entries()) {
    const id = `u${index + 1}`;
    users.set(id, { email: row.email, displayName: row.name });
    advisors.set(id, { name: row.name, staffCode: row.staffCode ?? null, unit: row.unit ?? null, updatedAt: ++clock });
    for (const name of row.classes) classes.set(name, { advisor: id, assignedAt: ++clock });
  }
  const writes: { sql: string; values: unknown[] }[] = [];
  const query = vi.fn(async (statement: string, values: unknown[] = []) => {
    const sql = statement.replace(/\s+/g, " ").trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT 1 FROM users WHERE id = $1 AND entra_tenant_id")) return { rows: [{}], rowCount: 1 };
    if (sql.startsWith("SELECT k.key, u.id")) {
      const rows = (values[0] as string[]).flatMap((key) => [...users].filter(([, user]) => user.email === key)
        .map(([id]) => ({ key, id, role: "advisor", isActive: true })));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT a.user_id AS "userId", a.full_name AS name')) {
      const rows = (values[0] as string[]).filter((id) => advisors.has(id)).map((id) => ({ userId: id, ...advisors.get(id)!,
        classes: [...classes].filter(([, owner]) => owner.advisor === id).map(([name]) => name).sort() }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT c.class_name AS "className", c.advisor_user_id AS "userId"')) {
      const rows = (values[0] as string[]).filter((name) => classes.has(name))
        .map((name) => ({ className: name, userId: classes.get(name)!.advisor, name: advisors.get(classes.get(name)!.advisor)!.name }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("WITH class_members")) return { rows: [], rowCount: 0 };
    const result = change(sql, values);
    if (result.rowCount) writes.push({ sql, values });
    return result;
  });
  const change = (sql: string, values: unknown[]) => {
    if (sql.startsWith("INSERT INTO users")) {
      users.set(values[0] as string, { email: values[3] as string, displayName: values[2] as string });
      return { rows: [{ id: values[0] }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO ad_advisors")) {
      const [id, name, staffCode, unit] = values as [string, string, string | null, string | null];
      advisors.set(id, { name, staffCode, unit, updatedAt: ++clock });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE users SET display_name")) {
      const user = users.get(values[0] as string);
      if (!user || user.displayName === values[1]) return { rows: [], rowCount: 0 };
      user.displayName = values[1] as string;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM ad_advisor_classes")) {
      const gone = [...classes].filter(([name, owner]) => owner.advisor === values[0] && !(values[1] as string[]).includes(name)).map(([name]) => name);
      for (const name of gone) classes.delete(name);
      return { rows: [], rowCount: gone.length };
    }
    if (sql.startsWith("INSERT INTO ad_advisor_classes")) {
      let changed = 0;
      for (const name of values[0] as string[]) {
        const owner = classes.get(name);
        if (owner?.advisor === values[1]) continue;
        if (owner && !sql.includes("DO UPDATE")) continue;
        classes.set(name, { advisor: values[1] as string, assignedAt: ++clock });
        changed++;
      }
      return { rows: [], rowCount: changed };
    }
    throw new Error(`unexpected statement: ${sql.slice(0, 80)}`);
  };
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) } as unknown as DatabasePool;
  return { repository: new PostgresAdvisorRepository(pool, new Set(["vlu.edu.vn"])), users, advisors, classes, writes };
}

// User 2026-11-14: "Phải cho phép import lại file Excel sau khi dữ liệu thay đổi. Không chỉ import một lần. Dòng không thay đổi
// giữ nguyên, dòng có nội dung thay đổi phải được cập nhật tương ứng." Names and emails are made up.
describe("importing the advisor list again", () => {
  const HEADER = ["STT", "Họ và tên", "Email", "Mã giảng viên", "Đơn vị", "Lớp phụ trách"];
  const an = ["1", "Nguyễn Văn An", "an.nv@vlu.edu.vn", "GV01", "Bộ môn KTPM", "71K29CNTT01, 71K29CNTT02"];
  const binh = ["2", "Trần Thị Bình", "binh.tt@vlu.edu.vn", "GV02", "Bộ môn HTTT", "71K29CNTT03, 71K29CNTT04"];
  const cuong = ["3", "Lê Văn Cường", "cuong.lv@vlu.edu.vn", "GV03", "Bộ môn MMT", "71K29CNTT05"];
  const seed = [
    { email: "an.nv@vlu.edu.vn", name: "Nguyễn Văn An", staffCode: "GV01", unit: "Bộ môn KTPM", classes: ["71K29CNTT01", "71K29CNTT02"] },
    { email: "binh.tt@vlu.edu.vn", name: "Trần Thị Bình", staffCode: "GV02", unit: "Bộ môn HTTT", classes: ["71K29CNTT03", "71K29CNTT04"] },
    { email: "cuong.lv@vlu.edu.vn", name: "Lê Văn Cường", staffCode: "GV03", unit: "Bộ môn MMT", classes: ["71K29CNTT05"] },
  ];
  const state = (db: ReturnType<typeof advisorTables>) => JSON.stringify({ advisors: [...db.advisors], classes: [...db.classes], users: [...db.users] });

  it("imports a tệp, then the same tệp again: the second time nothing is written", async () => {
    const db = advisorTables();
    const sheet = readAdvisorGrid([HEADER, an, binh, cuong]);
    expect(await db.repository.apply(admin, "cvht.xlsx", sheet)).toMatchObject({ added: 3, updated: 0, unchanged: 0, skipped: 0 });
    expect(db.advisors.size).toBe(3);
    expect(db.classes.size).toBe(5);
    const before = state(db);
    db.writes.length = 0;
    const again = await db.repository.apply(admin, "cvht.xlsx", readAdvisorGrid([HEADER, an, binh, cuong]));
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 3, skipped: 0 });
    expect(again.preview.items.map((item) => item.status)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(db.writes).toEqual([]);
    expect(state(db)).toBe(before);
  });

  it("writes only the changed row: a class taken off is released, an advisor missing from the tệp is kept", async () => {
    const db = advisorTables(seed);
    const before = { an: { ...db.advisors.get("u1")! }, cuong: { ...db.advisors.get("u3")! }, classes: new Map(db.classes) };
    // Bình's row loses 71K29CNTT04; An's row is as stored; Cường's row is deleted from the tệp.
    const edited = readAdvisorGrid([HEADER, an, ["2", "Trần Thị Bình", "binh.tt@vlu.edu.vn", "GV02", "Bộ môn HTTT", "71K29CNTT03"]]);
    const result = await db.repository.apply(admin, "cvht.xlsx", edited);
    expect(result).toMatchObject({ added: 0, updated: 1, unchanged: 1, skipped: 0 });
    expect(result.preview.items.map((item) => [item.email, item.status, item.changes])).toEqual([
      ["an.nv@vlu.edu.vn", "unchanged", []], ["binh.tt@vlu.edu.vn", "update", ["Bỏ lớp 71K29CNTT04"]],
    ]);
    // Only Bình's rows change: her advisor row and the class taken off. Her name and 71K29CNTT03 are as they were, so her
    // account and that class are not written.
    expect(db.writes.map((write) => [write.sql.split(" ").slice(0, 3).join(" "), write.values[0]])).toEqual([
      ["INSERT INTO ad_advisors(user_id,", "u2"], ["DELETE FROM ad_advisor_classes", "u2"],
    ]);
    expect(db.classes.has("71K29CNTT04")).toBe(false);
    expect(db.classes.get("71K29CNTT03")).toEqual(before.classes.get("71K29CNTT03"));
    expect(db.advisors.get("u1")).toEqual(before.an);
    expect(db.advisors.get("u3")).toEqual(before.cuong);
    expect(db.classes.get("71K29CNTT05")).toEqual(before.classes.get("71K29CNTT05"));
  });

  it("moves a class the tệp gives to another advisor; the one who had it keeps the rest, in the tệp or not", async () => {
    const db = advisorTables(seed);
    // 71K29CNTT05 goes from Cường (not in the tệp) to An, whose name is corrected too.
    const edited = readAdvisorGrid([HEADER, ["1", "Nguyễn Văn Anh", "an.nv@vlu.edu.vn", "GV01", "Bộ môn KTPM", "71K29CNTT01, 71K29CNTT02, 71K29CNTT05"], binh]);
    const result = await db.repository.apply(admin, "cvht.xlsx", edited);
    expect(result.preview.items[0]).toMatchObject({ status: "update",
      changes: ["Đổi họ và tên: Nguyễn Văn An → Nguyễn Văn Anh", "Thêm lớp 71K29CNTT05", "Lớp 71K29CNTT05 chuyển từ Lê Văn Cường"] });
    expect(result).toMatchObject({ updated: 1, unchanged: 1 });
    expect(db.classes.get("71K29CNTT05")?.advisor).toBe("u1");
    expect(db.advisors.get("u1")?.name).toBe("Nguyễn Văn Anh");
    expect(db.users.get("u1")?.displayName).toBe("Nguyễn Văn Anh");
    expect(db.advisors.has("u3")).toBe(true);
  });
});
