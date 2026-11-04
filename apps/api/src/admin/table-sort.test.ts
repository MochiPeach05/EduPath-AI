import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { byGivenName, byOrder, byText, chooseVietnameseCollation, orderBy, setVietnameseCollation, sortSchema, vietnamese, vietnameseCollation, vietnameseOrder } from "./table-sort.js";

const columns = { name: byGivenName("name"), code: byText('"code"'), state: byOrder("state", ["active", "it's"]) };
const own = [["name", "ASC"], ["id", "ASC"]] as const;
const PROBE = ["Anh", "Ánh", "Ăn", "Âm", "Dz", "Đa", "Ez", "Êm", "Oz", "Ôm", "Ơn", "Uz", "Ưa"];

afterEach(() => setVietnameseCollation("vi-x-icu"));

describe("admin table sort", () => {
  it("keeps the list's own order without a column and turns it over for STT descending", () => {
    // A name in the list's own order is in Vietnamese order too (QA 2026-11-04: Đ after D).
    expect(orderBy(columns, own)).toBe('name COLLATE "vi-x-icu" ASC, id ASC');
    expect(orderBy(columns, own, "stt", "asc")).toBe('name COLLATE "vi-x-icu" ASC, id ASC');
    expect(orderBy(columns, own, "stt", "desc")).toBe('name COLLATE "vi-x-icu" DESC, id DESC');
    expect(orderBy(columns, [['"occurredAt"', "DESC"], ["id", "DESC"]], undefined, "desc")).toBe('"occurredAt" ASC, id ASC');
    // Only a person's name: other own-order columns stay as written.
    expect(orderBy(columns, [['"code"', "DESC"], ["id", "ASC"]])).toBe('"code" DESC, id ASC');
    expect(orderBy(columns, [[vietnamese('"code"'), "DESC"], ["id", "ASC"]])).toBe('"code" COLLATE "vi-x-icu" DESC, id ASC');
  });

  it("sorts by the column's expressions, empty values last, then by the list's own order", () => {
    expect(orderBy(columns, own, "name", "desc")).toBe(
      `NULLIF(regexp_replace(btrim(name), '^.*\\s', ''), '') COLLATE "vi-x-icu" DESC NULLS LAST, NULLIF(btrim(name), '') COLLATE "vi-x-icu" DESC NULLS LAST, name COLLATE "vi-x-icu" ASC, id ASC`);
    expect(orderBy(columns, own, "code", "asc")).toMatch(/^\(SELECT string_agg\(.*regexp_matches\(NULLIF\(btrim\("code"\), ''\), '\[0-9\]\+\|\[\^0-9\]\+', 'g'\).*\) COLLATE "vi-x-icu" ASC NULLS LAST, name COLLATE "vi-x-icu" ASC, id ASC$/s);
    expect(orderBy(columns, own, "state", "asc")).toBe(`CASE state WHEN 'active' THEN 0 WHEN 'it''s' THEN 1 END ASC NULLS LAST, name COLLATE "vi-x-icu" ASC, id ASC`);
  });

  it("never puts an unknown key into SQL", () => {
    expect(orderBy(columns, own, "constructor", "desc")).toBe('name COLLATE "vi-x-icu" DESC, id DESC');
    expect(orderBy(columns, own, "name; DROP TABLE users", "asc")).toBe('name COLLATE "vi-x-icu" ASC, id ASC');
  });

  it("accepts only the list's columns, STT and the two directions", () => {
    const schema = z.object(sortSchema(columns)).strict();
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ sort: "stt", dir: "desc" })).toEqual({ sort: "stt", dir: "desc" });
    expect(schema.parse({ sort: "code" })).toEqual({ sort: "code" });
    for (const query of [{ sort: "id" }, { sort: "name DESC" }, { dir: "up" }, { sort: ["name", "code"] }]) expect(schema.safeParse(query).success).toBe(false);
  });

  it("brackets an expression COLLATE would not bind to as a whole", () => {
    expect(vietnameseOrder('"actorName"', "DESC")).toBe('"actorName" COLLATE "vi-x-icu" DESC');
    expect(vietnameseOrder("p.full_name")).toBe('p.full_name COLLATE "vi-x-icu" ASC');
    expect(vietnameseOrder("concat_ws(' ', a, b)")).toBe(`concat_ws(' ', a, b) COLLATE "vi-x-icu" ASC`);
    expect(vietnameseOrder("a || b")).toBe('(a || b) COLLATE "vi-x-icu" ASC');
    expect(vietnameseOrder("lower(a) || lower(b)")).toBe('(lower(a) || lower(b)) COLLATE "vi-x-icu" ASC');
  });

  it("orders by a key of plain characters on a database without ICU, Đ after D and tones after the bare letter", () => {
    setVietnameseCollation(null);
    const sql = orderBy(columns, own, "name", "asc");
    expect(sql).not.toContain("vi-x-icu");
    // Given name, whole name, then the list's own name: each a letters key and a tones key.
    expect(sql.match(/translate\(/g)).toHaveLength(6);
    expect(sql).toMatch(/^translate\(NULLIF\(regexp_replace\(btrim\(name\), '\^\.\*\\s', ''\), ''\), '[^']+', '[^']+'\) COLLATE "C" ASC NULLS LAST, /);
    expect(sql.endsWith(`COLLATE "C" ASC, id ASC`)).toBe(true);
    // The key itself: every Vietnamese letter, any case and tone, to one character in alphabet order.
    const [, from, letters, tones] = /translate\(name, '([^']+)', '([^']+)'\) COLLATE "C" ASC, translate\(name, '[^']+', '([^']+)'\)/u.exec(sql)!;
    const key = (text: string, to: string) => [...text].map((char) => { const at = [...from!].indexOf(char); return at < 0 ? char : [...to][at]; }).join("");
    const byKey = (a: string, b: string) => {
      const [ka, kb, ta, tb] = [key(a, letters!), key(b, letters!), key(a, tones!), key(b, tones!)];
      return ka < kb ? -1 : ka > kb ? 1 : ta < tb ? -1 : ta > tb ? 1 : 0;
    };
    expect([...PROBE].reverse().sort(byKey)).toEqual(PROBE);
    expect(["Đào", "Dương", "dũng", "Đức", "Duy"].sort(byKey)).toEqual(["dũng", "Duy", "Dương", "Đào", "Đức"]);
    expect(["Họa", "Hoà", "Hóa", "Hoa", "Hõa", "Hỏa"].sort(byKey)).toEqual(["Hoa", "Hoà", "Hỏa", "Hõa", "Hóa", "Họa"]);
  });

  it("picks the database's ICU collation that orders Vietnamese, else the key, and keeps the choice when it cannot ask", async () => {
    const database = (collations: string[], ordered: (name: string) => string[]) => ({
      query: vi.fn(async (sql: string) => sql.includes("pg_collation")
        ? { rows: collations.map((collname) => ({ collname })) }
        : { rows: [{ words: ordered(/COLLATE "([^"]+)"/.exec(sql)![1]!) }] }),
    });
    await expect(chooseVietnameseCollation(database(["vi-x-icu", "vi-VN-x-icu"], () => PROBE))).resolves.toBe("vi-x-icu");
    // An ICU build without Vietnamese data sorts like any language: the next one, then the key.
    await expect(chooseVietnameseCollation(database(["vi-x-icu", "vi-VN-x-icu"], (name) => name === "vi-x-icu" ? [...PROBE].sort() : PROBE))).resolves.toBe("vi-VN-x-icu");
    await expect(chooseVietnameseCollation(database([], () => PROBE))).resolves.toBeNull();
    expect(vietnameseCollation()).toBeNull();
    expect(orderBy(columns, own)).toContain('COLLATE "C"');
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(chooseVietnameseCollation({ query: vi.fn().mockRejectedValue(new Error("connection refused")) })).resolves.toBeNull();
    expect(error).toHaveBeenCalledWith("vietnamese_collation_check_failed", "connection refused");
    error.mockRestore();
  });
});
