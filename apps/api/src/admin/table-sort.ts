import { z } from "zod";

/**
 * The order of an admin list that pages on the server (Sinh viên, Tài khoản, Lịch sử đăng nhập), chosen with the arrows of
 * a column header (web table-sort.tsx; user, 2026-10-28). A key only picks one of the list's own SQL expressions, never
 * text from the request. Empty values come last either way and the list's own order breaks ties; "stt" (or no key) is
 * the list's own order, upside down for "desc", as on the pages that sort in the browser.
 */
export type SortDirection = "asc" | "desc";
/** One column's order: SQL expressions, most significant first, each written for ascending order. */
export type SortColumns<K extends string> = Record<K, readonly string[]>;
/** A list's own order, e.g. [["name", "ASC"], ["id", "ASC"]]. */
export type OwnOrder = readonly (readonly [expression: string, direction: "ASC" | "DESC"])[];

/** The query parameters of a sortable list: sort (a column key or "stt") and dir. */
export const sortSchema = <K extends string>(columns: SortColumns<K>) => ({
  sort: z.enum(["stt", ...Object.keys(columns)] as ["stt" | K, ...("stt" | K)[]]).optional(),
  dir: z.enum(["asc", "desc"]).optional()
});

const flip = (direction: "ASC" | "DESC") => direction === "ASC" ? "DESC" : "ASC";
/** The ORDER BY terms of a list: the chosen column, then the list's own order; or only the list's own order. */
export function orderBy(columns: SortColumns<string>, own: OwnOrder, sort?: string, dir?: SortDirection): string {
  const column = sort && sort !== "stt" && Object.hasOwn(columns, sort) ? columns[sort]! : null;
  const ownTerms = own.map(([expression, direction]) => `${expression} ${!column && dir === "desc" ? flip(direction) : direction}`);
  if (!column) return ownTerms.join(", ");
  const direction = dir === "desc" ? "DESC" : "ASC";
  return [...column.map((expression) => `${expression} ${direction} NULLS LAST`), ...ownTerms].join(", ");
}

/** A person's name: by the given name, the last word ("Đào Văn Hòa": "Hòa"), then the whole name, in Vietnamese order. */
export const byGivenName = (expression: string) => [
  `NULLIF(regexp_replace(btrim(${expression}), '^.*\\s', ''), '') COLLATE "vi-x-icu"`,
  `NULLIF(btrim(${expression}), '') COLLATE "vi-x-icu"`
];
/** Text in Vietnamese order with its numbers compared by value ("K9" before "K29", "CNTT2" before "CNTT10"). */
export const byText = (expression: string) => [`(SELECT string_agg(CASE WHEN m.part[1] ~ '^[0-9]'
    THEN lpad(m.part[1], greatest(length(m.part[1]), 20), '0') ELSE m.part[1] END, '' ORDER BY m.n)
  FROM regexp_matches(NULLIF(btrim(${expression}), ''), '[0-9]+|[^0-9]+', 'g') WITH ORDINALITY AS m(part, n)) COLLATE "vi-x-icu"`];
/** Values in a fixed order (states: "Đang hoạt động" before "Đã khóa"); a value not listed counts as empty. */
export const byOrder = (expression: string, order: readonly string[]) =>
  [`CASE ${expression} ${order.map((value, index) => `WHEN '${value.replaceAll("'", "''")}' THEN ${index}`).join(" ")} END`];
