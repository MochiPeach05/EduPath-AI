import { z } from "zod";

/**
 * The order of an admin list that pages on the server (Sinh viên, Tài khoản, Lịch sử đăng nhập), chosen with the arrows of
 * a column header (web table-sort.tsx; user, 2026-10-28). A key only picks one of the list's own SQL expressions, never
 * text from the request. Empty values come last either way and the list's own order breaks ties; "stt" (or no key) is
 * the list's own order, upside down for "desc", as on the pages that sort in the browser.
 *
 * Text is put in Vietnamese order (QA 2026-11-04: "Đ" was sorted as "D"): Đ after D, Ă and Â after A, Ê after E, Ô and Ơ
 * after O, Ư after U, a bare letter before its tones. The database's ICU collation does it when it has one
 * (chooseVietnameseCollation, at start); without ICU a key of plain characters gives the same order, so a list never
 * fails and pages stay stable.
 */
export type SortDirection = "asc" | "desc";
/** Text to put in Vietnamese order: an expression that binds tighter than COLLATE is used as it is, others in brackets. */
export type VietnameseText = { readonly vietnamese: string };
/** One term of an order: plain SQL, or text in Vietnamese order. */
export type SortTerm = string | VietnameseText;
/** One column's order: terms, most significant first, each written for ascending order. */
export type SortColumns<K extends string> = Record<K, readonly SortTerm[]>;
/** A list's own order, e.g. [["name", "ASC"], ["id", "ASC"]]. */
export type OwnOrder = readonly (readonly [expression: SortTerm, direction: "ASC" | "DESC"])[];

/** expression in Vietnamese order (rendered by orderBy or vietnameseOrder). */
export const vietnamese = (expression: string): VietnameseText => ({ vietnamese: expression });

/** The ICU collations that know Vietnamese, best first (Postgres built with ICU, as Supabase and Render run it). */
export const VIETNAMESE_COLLATIONS = ["vi-x-icu", "vi-VN-x-icu"] as const;
/** The collation in use; null: the database has none that orders Vietnamese, the fallback key does. */
let collation: string | null = VIETNAMESE_COLLATIONS[0];
/** The collation the lists use now (null: the fallback key). */
export const vietnameseCollation = () => collation;
/** Sets the collation by hand (tests; chooseVietnameseCollation sets it at start). */
export function setVietnameseCollation(name: string | null) { collation = name; }

/** Words in Vietnamese order that a collation without Vietnamese gets wrong (Ă, Â, Đ, Ê, Ô, Ơ, Ư; a tone after the bare letter). */
const PROBE = ["Anh", "Ánh", "Ăn", "Âm", "Dz", "Đa", "Ez", "Êm", "Oz", "Ôm", "Ơn", "Uz", "Ưa"];
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };

/**
 * Picks, once at start, how the lists put text in Vietnamese order: the first ICU collation the database has that sorts
 * PROBE right, else the fallback key. When the database cannot be asked, the choice stays as it was.
 */
export async function chooseVietnameseCollation(db: Queryable): Promise<string | null> {
  let present: Set<string>;
  try {
    const found = await db.query("SELECT collname FROM pg_collation WHERE collname = ANY($1::text[])", [[...VIETNAMESE_COLLATIONS]]);
    present = new Set(found.rows.map((row) => String((row as { collname?: unknown }).collname)));
  } catch (error) {
    console.error("vietnamese_collation_check_failed", error instanceof Error ? error.message : error);
    return collation;
  }
  for (const name of VIETNAMESE_COLLATIONS) {
    if (!present.has(name)) continue;
    try {
      const probe = await db.query(`SELECT array_agg(word ORDER BY word COLLATE "${name}") AS words FROM unnest($1::text[]) AS word`, [[...PROBE].reverse()]);
      const words = (probe.rows[0] as { words?: unknown } | undefined)?.words;
      if (Array.isArray(words) && words.join("|") === PROBE.join("|")) return (collation = name);
    } catch { /* a collation the database cannot use: try the next */ }
  }
  return (collation = null);
}

/**
 * The fallback key: translate() turns every Vietnamese letter, any tone and case, into one plain character in alphabet
 * order (a ă â b c d đ e ê … u ư v w x y z → A B C … g), so byte order ("C") is Vietnamese order; a second key holds
 * the tones (none, huyền, hỏi, ngã, sắc, nặng as 0–5). Digits, spaces and punctuation are kept and come first.
 */
const LETTERS = ["a", "ă", "â", "b", "c", "d", "đ", "e", "ê", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "ô", "ơ", "p", "q",
  "r", "s", "t", "u", "ư", "v", "w", "x", "y", "z"];
const TONED: Record<string, string> = {
  a: "aàảãáạ", ă: "ăằẳẵắặ", â: "âầẩẫấậ", e: "eèẻẽéẹ", ê: "êềểễếệ", i: "iìỉĩíị", o: "oòỏõóọ", ô: "ôồổỗốộ", ơ: "ơờởỡớợ",
  u: "uùủũúụ", ư: "ưừửữứự", y: "yỳỷỹýỵ",
};
const KEY = (() => {
  let from = "", letters = "", tones = "";
  LETTERS.forEach((letter, index) => {
    const code = String.fromCharCode(index < 26 ? 65 + index : 97 + index - 26);
    [...(TONED[letter] ?? letter)].forEach((form, tone) => {
      for (const variant of new Set([form, form.toUpperCase()])) { from += variant; letters += code; tones += String(tone); }
    });
  });
  return { from, letters, tones };
})();

/** An expression COLLATE can follow as it is: a column, a quoted name, a function call or a bracketed expression. */
function isAtom(expression: string): boolean {
  const text = expression.trim();
  if (/^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$|^"[^"]+"$/.test(text)) return true;
  const open = text.search(/\(/);
  if (open < 0 || !text.endsWith(")") || !/^[A-Za-z_\w.]*$/.test(text.slice(0, open))) return false;
  // The bracket opened first closes last (quoted text skipped).
  let depth = 0, quoted = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "(") depth += 1;
    else if (!quoted && char === ")" && --depth === 0 && index < text.length - 1) return false;
  }
  return depth === 0;
}

/** The SQL terms of one sort term, for ascending order. */
function render(term: SortTerm): string[] {
  if (typeof term === "string") return [term];
  const expression = isAtom(term.vietnamese) ? term.vietnamese : `(${term.vietnamese})`;
  return collation
    ? [`${expression} COLLATE "${collation}"`]
    : [`translate(${expression}, '${KEY.from}', '${KEY.letters}') COLLATE "C"`, `translate(${expression}, '${KEY.from}', '${KEY.tones}') COLLATE "C"`];
}

/** ORDER BY terms putting one text expression in Vietnamese order, for a query that does not use orderBy. */
export const vietnameseOrder = (expression: string, direction: "ASC" | "DESC" = "ASC") =>
  render(vietnamese(expression)).map((sql) => `${sql} ${direction}`).join(", ");

/** The query parameters of a sortable list: sort (a column key or "stt") and dir. */
export const sortSchema = <K extends string>(columns: SortColumns<K>) => ({
  sort: z.enum(["stt", ...Object.keys(columns)] as ["stt" | K, ...("stt" | K)[]]).optional(),
  dir: z.enum(["asc", "desc"]).optional()
});

/** The columns that hold a person's name (byGivenName). */
const personColumns = new WeakSet<readonly SortTerm[]>();
/**
 * A list's own order by a column that holds a person's name ("name") is in Vietnamese order too, as when the column is
 * chosen; other own-order terms stay as they are written.
 */
function ownTerm(columns: SortColumns<string>, expression: SortTerm): SortTerm {
  if (typeof expression !== "string") return expression;
  const key = expression.replace(/^"(.*)"$/, "$1");
  return Object.hasOwn(columns, key) && personColumns.has(columns[key]!) ? vietnamese(expression) : expression;
}

const flip = (direction: "ASC" | "DESC") => direction === "ASC" ? "DESC" : "ASC";
/** The ORDER BY terms of a list: the chosen column, then the list's own order; or only the list's own order. */
export function orderBy(columns: SortColumns<string>, own: OwnOrder, sort?: string, dir?: SortDirection): string {
  const column = sort && sort !== "stt" && Object.hasOwn(columns, sort) ? columns[sort]! : null;
  const ownTerms = own.flatMap(([expression, direction]) =>
    render(ownTerm(columns, expression)).map((sql) => `${sql} ${!column && dir === "desc" ? flip(direction) : direction}`));
  if (!column) return ownTerms.join(", ");
  const direction = dir === "desc" ? "DESC" : "ASC";
  return [...column.flatMap(render).map((sql) => `${sql} ${direction} NULLS LAST`), ...ownTerms].join(", ");
}

/** A person's name: by the given name, the last word ("Đào Văn Hòa": "Hòa"), then the whole name, in Vietnamese order. */
export const byGivenName = (expression: string): readonly SortTerm[] => {
  const terms = [
    vietnamese(`NULLIF(regexp_replace(btrim(${expression}), '^.*\\s', ''), '')`),
    vietnamese(`NULLIF(btrim(${expression}), '')`),
  ];
  personColumns.add(terms);
  return terms;
};
/** Text in Vietnamese order with its numbers compared by value ("K9" before "K29", "CNTT2" before "CNTT10"). */
export const byText = (expression: string): readonly SortTerm[] => [vietnamese(`(SELECT string_agg(CASE WHEN m.part[1] ~ '^[0-9]'
    THEN lpad(m.part[1], greatest(length(m.part[1]), 20), '0') ELSE m.part[1] END, '' ORDER BY m.n)
  FROM regexp_matches(NULLIF(btrim(${expression}), ''), '[0-9]+|[^0-9]+', 'g') WITH ORDINALITY AS m(part, n))`)];
/** Values in a fixed order (states: "Đang hoạt động" before "Đã khóa"); a value not listed counts as empty. */
export const byOrder = (expression: string, order: readonly string[]) =>
  [`CASE ${expression} ${order.map((value, index) => `WHEN '${value.replaceAll("'", "''")}' THEN ${index}`).join(" ")} END`];
