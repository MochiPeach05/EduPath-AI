import { describe, expect, it } from "vitest";
import { foldText } from "./audit/record.js";
import { foldSql } from "./fold-sql.js";

/** What PostgreSQL's lower(translate(text, from, to)) gives, read off the SQL foldSql writes. */
function runFold(text: string): string {
  const match = /^lower\(translate\(x, '([^']*)', '([^']*)'\)\)$/u.exec(foldSql("x"));
  if (!match) throw new Error("unexpected SQL");
  const from = Array.from(match[1]!), to = Array.from(match[2]!);
  const mapped = Array.from(text).map((char) => {
    const at = from.indexOf(char);
    return at < 0 ? char : at < to.length ? to[at]! : "";
  });
  return mapped.join("").toLowerCase();
}

describe("foldSql: Vietnamese text without tones in SQL, as foldText does it in JavaScript (2026-11-25)", () => {
  it("maps every toned letter of either case to one plain letter", () => {
    const match = /^lower\(translate\(x, '([^']*)', '([^']*)'\)\)$/u.exec(foldSql("x"))!;
    expect(Array.from(match[1]!)).toHaveLength(Array.from(match[2]!).length);
    expect(match[1]).not.toContain("'");
  });

  it("meets foldText on names, codes and classes", () => {
    for (const text of ["Đào Văn Hòa", "NGUYỄN THỊ ÁNH DƯƠNG", "Lương Khánh Vy", "Tạ Minh Đức", "Phạm Ngọc Bảo Trâm", "Hồ Quang Minh",
      "2374802019901", "71K29CNTT99", "vy.2374802019901@vanlanguni.vn", "Ưng Ỷ Ỳ ỹ Ỵ"]) {
      expect(runFold(text)).toBe(foldText(text));
    }
  });
});
