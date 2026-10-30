import { afterEach, describe, expect, it, vi } from "vitest";

// "Khoa cập nhật …" (kind catalog_updated): who a changed CTĐT, plan or graduation standard reaches. Synthetic ids only.
vi.mock("../graduation/resolve.js", () => ({
  resolveCohortStandard: vi.fn(async (_db: unknown, _cohort: string, specialty: string | null) =>
    ({ resolution: "resolved", standard: specialty === "CNPM" ? { id: "std-cnpm" } : { id: "std-other" } })),
}));
const { notifyCatalogUpdate } = await import("./catalog.js");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function client(rows: (sql: string, params: unknown[]) => unknown[] | undefined, failInsert = false) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (failInsert && sql.startsWith("INSERT INTO stu_notifications")) throw Object.assign(new Error("x"), { code: "42P01" });
    const found = rows(sql, params);
    return { rowCount: found?.length ?? 0, rows: found ?? [] };
  });
  return { query, calls: () => query.mock.calls.map(([sql, params]) => [String(sql), (params ?? []) as unknown[]] as const) };
}

afterEach(() => vi.clearAllMocks());

describe("notifyCatalogUpdate", () => {
  it("tells the students of a CTĐT's cohort and major, keyed by the new revision", async () => {
    const db = client((sql) => (sql.startsWith("SELECT cohort_code AS cohort") ? [{ cohort: "K29", identity: "cong nghe thong tin:K29" }]
      : sql.startsWith("SELECT u.id") ? [{ id: A }, { id: B }] : undefined));
    await notifyCatalogUpdate(db, { kind: "curriculum", id: "cur-1", revisionId: "rev-9" });
    const calls = db.calls();
    expect(calls[1]![0]).toContain("FROM curricula WHERE id=$1");
    const students = calls.find(([sql]) => sql.startsWith("SELECT u.id"))!;
    expect(students[1]).toEqual(["K29", ["7480201"]]);
    const insert = calls.find(([sql]) => sql.startsWith("INSERT INTO stu_notifications"))!;
    const params = insert[1] as unknown[][];
    expect(params[1]).toEqual([A, B]);
    expect(params[3]).toEqual(["catalog_updated", "catalog_updated"]);
    expect(params[4]![0]).toBe("Khoa cập nhật chương trình đào tạo khóa K29");
    expect(params[8]).toEqual(["catalog:curriculum:rev-9", "catalog:curriculum:rev-9"]);
    expect(calls.at(-1)![0]).toBe("RELEASE SAVEPOINT edupath_catalog_notify");
  });

  it("tells only the students whose graduation standard it is", async () => {
    const db = client((sql, params) => (sql.startsWith("SELECT cohort_code AS cohort") ? [{ cohort: "K29", identity: "x|y" }]
      : sql.startsWith("SELECT DISTINCT p.specialty") ? [{ specialty: "CNPM", major: "7480201" }, { specialty: "AI", major: "7480201" }]
      : sql.startsWith("SELECT u.id") ? (params[1] === "CNPM" ? [{ id: A }] : [{ id: B }]) : undefined));
    await notifyCatalogUpdate(db, { kind: "graduation", id: "std-cnpm", revisionId: "rev-3" });
    const insert = db.calls().find(([sql]) => sql.startsWith("INSERT INTO stu_notifications"))!;
    expect((insert[1] as unknown[][])[1]).toEqual([A]);
    expect((insert[1] as unknown[][])[4]![0]).toBe("Khoa cập nhật tiêu chuẩn xét tốt nghiệp khóa K29");
  });

  it("never undoes the import when the notification fails", async () => {
    const db = client((sql) => (sql.startsWith("SELECT cohort_code AS cohort") ? [{ cohort: "K29", identity: "cong nghe thong tin:K29" }]
      : sql.startsWith("SELECT u.id") ? [{ id: A }] : undefined), true);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(notifyCatalogUpdate(db, { kind: "plan", id: "plan-1", revisionId: "rev-1" })).resolves.toBeUndefined();
    expect(db.calls().at(-1)![0]).toBe("ROLLBACK TO SAVEPOINT edupath_catalog_notify");
    expect(log).toHaveBeenCalledWith("[notifications] catalog_updated not written (42P01)");
  });
});
