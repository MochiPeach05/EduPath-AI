import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SortHeader, givenName, nextSort, sortParams, sortRows, type SortRule, type TableSort } from "./table-sort";

type Row = { name: string; code: string | null; credits: number | null; status: string; active: boolean };
const rows: Row[] = [
  { name: "Trần Thị Bình", code: "K29", credits: 3, status: "draft", active: true },
  { name: "Nguyễn Văn An", code: "K9", credits: null, status: "active", active: false },
  { name: "Lê Đức", code: null, credits: 4, status: "unknown", active: true },
  { name: "Phạm Dũng", code: "K30", credits: 3, status: "archived", active: false },
];
const rules: Record<string, SortRule<Row>> = {
  name: { value: row => row.name, by: "name" }, code: { value: row => row.code }, credits: { value: row => row.credits, by: "number" },
  status: { value: row => row.status, order: ["active", "draft", "archived"] }, active: { value: row => row.active, order: [true, false] },
};
const sorted = (key: string, direction: "asc" | "desc") => sortRows(rows, rules, { key, direction });

describe("table sort", () => {
  it("goes ascending, descending, then back to the list's own order, and starts again on another column", () => {
    let sort: TableSort = null;
    sort = nextSort(sort, "name"); expect(sort).toEqual({ key: "name", direction: "asc" });
    sort = nextSort(sort, "name"); expect(sort).toEqual({ key: "name", direction: "desc" });
    expect(nextSort(sort, "code")).toEqual({ key: "code", direction: "asc" });
    expect(nextSort(sort, "name")).toBeNull();
  });

  it("sorts people by the given name in Vietnamese order (D before Đ) and keeps each row's STT", () => {
    expect(givenName("  Đào Văn Hòa ")).toBe("Hòa");
    expect(sorted("name", "asc").map(({ row, stt }) => `${stt}:${givenName(row.name)}`)).toEqual(["2:An", "1:Bình", "4:Dũng", "3:Đức"]);
    expect(sorted("name", "desc").map(({ stt }) => stt)).toEqual([3, 4, 1, 2]);
  });

  it("compares numbers inside text by value and puts empty values last both ways", () => {
    expect(sorted("code", "asc").map(({ row }) => row.code)).toEqual(["K9", "K29", "K30", null]);
    expect(sorted("code", "desc").map(({ row }) => row.code)).toEqual(["K30", "K29", "K9", null]);
    expect(sorted("credits", "desc").map(({ stt }) => stt)).toEqual([3, 1, 4, 2]);
  });

  it("orders states by their own order, a state not listed counting as empty, and keeps the list's order on ties", () => {
    expect(sorted("status", "asc").map(({ row }) => row.status)).toEqual(["active", "draft", "archived", "unknown"]);
    expect(sorted("status", "desc").map(({ row }) => row.status)).toEqual(["archived", "draft", "active", "unknown"]);
    expect(sorted("active", "asc").map(({ stt }) => stt)).toEqual([1, 3, 2, 4]);
    expect(sorted("active", "desc").map(({ stt }) => stt)).toEqual([2, 4, 1, 3]);
  });

  it("turns the list over by STT unless the table gives its own STT rule, and leaves it alone without a sort", () => {
    expect(sortRows(rows, rules, null).map(({ stt }) => stt)).toEqual([1, 2, 3, 4]);
    expect(sorted("stt", "desc").map(({ stt }) => stt)).toEqual([4, 3, 2, 1]);
    const byCode = sortRows(rows, { stt: rules.code! }, { key: "stt", direction: "asc" });
    expect(byCode.map(({ row }) => row.code)).toEqual(["K9", "K29", "K30", null]);
  });

  it("asks the server for sort and dir only when a column is sorted", () => {
    expect(sortParams(null, new URLSearchParams({ page: "1" })).toString()).toBe("page=1");
    expect(sortParams({ key: "name", direction: "desc" }, new URLSearchParams({ page: "1" })).toString()).toBe("page=1&sort=name&dir=desc");
  });

  it("draws a header button with two arrows, marking the active one for screen readers", () => {
    const idle = renderToStaticMarkup(<table><thead><tr><SortHeader label="Sinh viên" column="name" sort={null} onSort={() => undefined} /></tr></thead></table>);
    expect(idle).toContain('<th scope="col"><button type="button" class="ts-sort" title="Sắp xếp tăng dần"><span>Sinh viên</span>');
    expect(idle).not.toContain("aria-sort");
    const active = renderToStaticMarkup(<table><thead><tr><SortHeader label="STT" column="stt" className="cm-stt" sort={{ key: "stt", direction: "desc" }} onSort={() => undefined} /></tr></thead></table>);
    expect(active).toContain('<th scope="col" class="cm-stt" aria-sort="descending"><button type="button" class="ts-sort ts-sort-active" title="Trở về thứ tự mặc định">');
    expect(active).toMatch(/<path d="M4 0 8 5H0Z"><\/path><path class="ts-on" d="M4 13 0 8h8Z">/);
  });
});
