import { describe, expect, it } from "vitest";
import { CLASS_OF, CLASS_PREFIX, classCode, classCodeSql, cohortCode, needsCohort, normalizeClassName } from "./class-code.js";

// Synthetic profiles only: the sign-in stores class CNTT08 and cohort K29 for "2374802010994 - Họ Tên - 71K29CNTT08"
// (migrations 005, 044, 045); the Khoa's list writes 71K29CNTT08, and 72…/74… for other programs of a cohort.
const name = (code: string) => `2374802010994 - Sinh viên Thử nghiệm - ${code}`;

describe("class codes (QA 2026-11-04)", () => {
  it.each([
    // A profile: the class after the cohort and the cohort apart.
    ["CNTT08", "K29", name("71K29CNTT08"), "71K29CNTT08"],
    ["CNTT08", "K27", name("71K27CNTT08"), "71K27CNTT08"],
    // The prefix of another program, from the display name, only when it writes that very class.
    ["CNTT01", "K29", name("72K29CNTT01"), "72K29CNTT01"],
    ["CNTT01", "K31", name("74K31CNTT01"), "74K31CNTT01"],
    ["CNTT08", "K29", name("72K29CNTT09"), "71K29CNTT08"],
    ["CNTT08", "K29", "Sinh viên Thử nghiệm", "71K29CNTT08"],
    ["CNTT08", "K29", null, "71K29CNTT08"],
    ["cntt08", " k29 ", `${name("72k29cntt08")}  `, "72K29CNTT08"],
    ["TTDL01", "K28", "2274802010995 - Sinh viên Thử nghiệm – 71K28TTDL01", "71K28TTDL01"],
    // A full code is kept (the e2e harness stores one), written any way.
    ["71K29CNTT99", "K29", name("71K29CNTT99"), "71K29CNTT99"],
    ["71k29 cntt99", null, null, "71K29CNTT99"],
    ["72K27CNTT01", "K29", null, "72K27CNTT01"],
    // The cohort without the prefix gets it.
    ["K29CNTT08", null, name("72K29CNTT08"), "72K29CNTT08"],
    ["K29CNTT08", null, null, "71K29CNTT08"],
    // K26 ("… - K26T-IT11" gives IT11 and K26).
    ["IT11", "K26", "207CT00991 - Sinh viên Thử nghiệm - K26T-IT11", "71K26IT11"],
    // No cohort, no class or another shape: as it is.
    ["CNTT08", null, name("72K29CNTT08"), "CNTT08"],
    ["CNTT08", "29", null, "CNTT08"],
    ["T-IT11", "K26", null, "T-IT11"],
    [null, "K29", null, ""],
    ["  ", "K29", null, ""],
  ] as const)("classCode(%j, %j, %j) is %j", (className, cohort, displayName, code) => {
    expect(classCode(className, cohort, displayName)).toBe(code);
  });

  it("counts CNTT08 of K29 and of K27 as two classes (the row CNTT08 · K29 · 3 SV was 2 K29 and 1 K27)", () => {
    const profiles = [
      { className: "CNTT08", cohort: "K29", displayName: name("71K29CNTT08") },
      { className: "CNTT08", cohort: "K29", displayName: name("71K29CNTT08") },
      { className: "CNTT08", cohort: "K27", displayName: name("71K27CNTT08") },
      { className: "CNTT01", cohort: "K29", displayName: name("72K29CNTT01") },
    ];
    const counts: Record<string, number> = {};
    for (const profile of profiles) {
      const code = classCode(profile.className, profile.cohort, profile.displayName);
      counts[code] = (counts[code] ?? 0) + 1;
    }
    expect(counts).toEqual({ "71K29CNTT08": 2, "71K27CNTT08": 1, "72K29CNTT01": 1 });
    // The class of an advisor imported from the Khoa's list is the code of the K29 students, and not of the K27 one.
    expect(profiles.filter((profile) => classCode(profile.className, profile.cohort, profile.displayName) === classCode("71K29CNTT08"))).toHaveLength(2);
  });

  it("names the classes still written without their cohort", () => {
    expect(needsCohort("CNTT08")).toBe(true);
    expect(needsCohort(classCode("CNTT08", "K29"))).toBe(false);
    expect(needsCohort("71K29CNTT08")).toBe(false);
    expect(needsCohort("T-IT11")).toBe(false);
  });

  it("reads a Khóa cell as the cohort", () => {
    expect(["K29", "k 29", "29", "Khóa 29", "KHÓA K29", "Khoá 29"].map(cohortCode)).toEqual(["K29", "K29", "K29", "K29", "K29", "K29"]);
    expect(["", "Công nghệ thông tin", "2023", "K2", null].map(cohortCode)).toEqual([null, null, null, null, null]);
    expect(normalizeClassName(" 71k29 cntt01 ")).toBe("71K29CNTT01");
  });

  it("writes the same rule in SQL over the aliases it is given (checked against PostgreSQL with the cases above)", () => {
    const sql = classCodeSql("sp", "su");
    expect(sql).toContain("upper(regexp_replace(sp.class_name, '\\s', '', 'g'))");
    expect(sql).toContain("upper(regexp_replace(sp.cohort_code, '\\s', '', 'g'))");
    expect(sql).toContain("upper(su.display_name)");
    expect(sql).not.toMatch(/(^|[^a-z_])[pu]\./);
    expect(sql).toContain(`'${CLASS_PREFIX}'`);
    expect(CLASS_OF).toBe(classCodeSql("p", "u"));
    expect(CLASS_PREFIX).toBe("71");
  });
});
