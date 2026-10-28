import { describe, expect, it } from "vitest";
import { z } from "zod";
import { byGivenName, byOrder, byText, orderBy, sortSchema } from "./table-sort.js";

const columns = { name: byGivenName("name"), code: byText('"code"'), state: byOrder("state", ["active", "it's"]) };
const own = [["name", "ASC"], ["id", "ASC"]] as const;

describe("admin table sort", () => {
  it("keeps the list's own order without a column and turns it over for STT descending", () => {
    expect(orderBy(columns, own)).toBe("name ASC, id ASC");
    expect(orderBy(columns, own, "stt", "asc")).toBe("name ASC, id ASC");
    expect(orderBy(columns, own, "stt", "desc")).toBe("name DESC, id DESC");
    expect(orderBy(columns, [['"occurredAt"', "DESC"], ["id", "DESC"]], undefined, "desc")).toBe('"occurredAt" ASC, id ASC');
  });

  it("sorts by the column's expressions, empty values last, then by the list's own order", () => {
    expect(orderBy(columns, own, "name", "desc")).toBe(
      `NULLIF(regexp_replace(btrim(name), '^.*\\s', ''), '') COLLATE "vi-x-icu" DESC NULLS LAST, NULLIF(btrim(name), '') COLLATE "vi-x-icu" DESC NULLS LAST, name ASC, id ASC`);
    expect(orderBy(columns, own, "code", "asc")).toMatch(/^\(SELECT string_agg\(.*regexp_matches\(NULLIF\(btrim\("code"\), ''\), '\[0-9\]\+\|\[\^0-9\]\+', 'g'\).*COLLATE "vi-x-icu" ASC NULLS LAST, name ASC, id ASC$/s);
    expect(orderBy(columns, own, "state", "asc")).toBe("CASE state WHEN 'active' THEN 0 WHEN 'it''s' THEN 1 END ASC NULLS LAST, name ASC, id ASC");
  });

  it("never puts an unknown key into SQL", () => {
    expect(orderBy(columns, own, "constructor", "desc")).toBe("name DESC, id DESC");
    expect(orderBy(columns, own, "name; DROP TABLE users", "asc")).toBe("name ASC, id ASC");
  });

  it("accepts only the list's columns, STT and the two directions", () => {
    const schema = z.object(sortSchema(columns)).strict();
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ sort: "stt", dir: "desc" })).toEqual({ sort: "stt", dir: "desc" });
    expect(schema.parse({ sort: "code" })).toEqual({ sort: "code" });
    for (const query of [{ sort: "id" }, { sort: "name DESC" }, { dir: "up" }, { sort: ["name", "code"] }]) expect(schema.safeParse(query).success).toBe(false);
  });
});
