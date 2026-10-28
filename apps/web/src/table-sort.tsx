import { useState, type ReactNode } from "react";
import "./table-sort.css";

/**
 * Sortable table headers (user, 2026-10-28: "thêm một nút mũi tên nhỏ lên, xuống ở bên cạnh" each column so a list
 * can be ordered "từ trên xuống hoặc dưới lên hoặc các bộ lọc khác phù hợp với cột đó"). A click on a header goes
 * ascending → descending → the list's own order. Each row keeps its STT, its number in the list's own order, the way a
 * spreadsheet row keeps its number when the sheet is sorted; sorting by STT turns the list upside down.
 */
export type SortDirection = "asc" | "desc";
export type TableSort = { key: string; direction: SortDirection } | null;
export type SortValue = string | number | boolean | null | undefined;
/**
 * How a column orders its rows: text (Vietnamese order, numbers inside text by value: K9 before K29), a person's
 * name (by the given name, then the whole name, as Vietnamese class lists do), a number, a date, or a fixed order of
 * states ("Đang hoạt động" before "Đã khóa"). Empty values, and values missing from a fixed order, always come last.
 * The lists sorted on the server (apps/api/src/admin/table-sort.ts) follow the same rules.
 */
export type SortRule<T> = { value: (row: T) => SortValue; by?: "text" | "name" | "number" | "date"; order?: readonly SortValue[] };

const collator = new Intl.Collator("vi", { numeric: true });
/** "Đào Văn Hòa" → "Hòa". */
export const givenName = (name: string) => name.trim().split(/\s+/).at(-1) ?? "";
const isEmpty = <T,>(value: SortValue, rule: SortRule<T>) => value === null || value === undefined || (typeof value === "string" && !value.trim())
  || (typeof value === "number" && !Number.isFinite(value)) || (rule.order !== undefined && !rule.order.includes(value));

/** The order of two non-empty values under a rule, ascending. */
export function compareValues<T>(a: SortValue, b: SortValue, rule: Pick<SortRule<T>, "by" | "order">): number {
  if (rule.order) return rule.order.indexOf(a) - rule.order.indexOf(b);
  if (rule.by === "number") return Number(a) - Number(b);
  if (rule.by === "date") return Date.parse(String(a)) - Date.parse(String(b));
  if (rule.by === "name") return collator.compare(givenName(String(a)), givenName(String(b))) || collator.compare(String(a).trim(), String(b).trim());
  return collator.compare(String(a).trim(), String(b).trim());
}

/** The next sort of a header click: ascending, then descending, then none (the list's own order). */
export const nextSort = (sort: TableSort, key: string): TableSort =>
  sort?.key !== key ? { key, direction: "asc" } : sort.direction === "asc" ? { key, direction: "desc" } : null;

/**
 * The rows in the chosen order, each with its STT (number in the list's own order). Ties keep the list's order. A
 * table whose STT column shows a stored number (a field's code) gives a "stt" rule; otherwise STT turns the list over.
 */
export function sortRows<T>(rows: readonly T[], rules: Record<string, SortRule<T>>, sort: TableSort): { row: T; stt: number }[] {
  const numbered = rows.map((row, index) => ({ row, stt: index + 1 }));
  if (!sort) return numbered;
  if (sort.key === "stt" && !rules.stt) return sort.direction === "asc" ? numbered : [...numbered].reverse();
  const rule = rules[sort.key];
  if (!rule) return numbered;
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...numbered].sort((x, y) => {
    const a = rule.value(x.row), b = rule.value(y.row);
    const emptyA = isEmpty(a, rule), emptyB = isEmpty(b, rule);
    if (emptyA || emptyB) return emptyA === emptyB ? x.stt - y.stt : emptyA ? 1 : -1;
    return factor * compareValues(a, b, rule) || x.stt - y.stt;
  });
}

/**
 * The sort of one table; onChange runs on every change (go back to the first page). sortHeader(label, column) is the
 * column's header cell; "Thao tác" columns stay plain th cells.
 */
export function useTableSort(onChange?: () => void) {
  const [sort, setSort] = useState<TableSort>(null);
  const onSort = (key: string) => { setSort((current) => nextSort(current, key)); onChange?.(); };
  const sortHeader = (label: ReactNode, column: string, className?: string) =>
    <SortHeader label={label} column={column} sort={sort} onSort={onSort} className={className} />;
  return { sort, onSort, sortHeader };
}

/** The query of a list sorted on the server (Tài khoản, Sinh viên, Lịch sử đăng nhập): sort and dir, none for its own order. */
export function sortParams(sort: TableSort, params: URLSearchParams) {
  if (sort) { params.set("sort", sort.key); params.set("dir", sort.direction); }
  return params;
}

/** A column header that sorts its table: the label and two small arrows, the one in use highlighted. */
export function SortHeader({ label, column, sort, onSort, className }: { label: ReactNode; column: string; sort: TableSort; onSort: (column: string) => void; className?: string }) {
  const direction = sort?.key === column ? sort.direction : null;
  const hint = direction === null ? "Sắp xếp tăng dần" : direction === "asc" ? "Sắp xếp giảm dần" : "Trở về thứ tự mặc định";
  return <th scope="col" className={className} {...(direction ? { "aria-sort": direction === "asc" ? "ascending" : "descending" } : {})}>
    <button type="button" className={`ts-sort${direction ? " ts-sort-active" : ""}`} title={hint} onClick={() => onSort(column)}>
      <span>{label}</span>
      <svg className="ts-arrows" viewBox="0 0 8 13" aria-hidden="true" focusable="false">
        <path className={direction === "asc" ? "ts-on" : undefined} d="M4 0 8 5H0Z" />
        <path className={direction === "desc" ? "ts-on" : undefined} d="M4 13 0 8h8Z" />
      </svg>
    </button>
  </th>;
}
