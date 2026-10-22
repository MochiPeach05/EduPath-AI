import { describe, expect, it } from "vitest";
import { specialtiesFor, specialtyLabel } from "./competency-assessment-types";

describe("specialties offered on the student profile", () => {
  it("adds An ninh Mạng và IoTs for K27 and Không theo chuyên ngành for K28 and earlier", () => {
    expect(specialtiesFor("K27").map((item) => item.code)).toEqual(["CNPM", "CNDL", "TTNT", "ANM", "KCN"]);
    expect(specialtiesFor(" k27 ").map((item) => item.code)).toContain("ANM");
    for (const cohort of ["K28", "K26", "K20"])
      expect(specialtiesFor(cohort).map((item) => item.code)).toEqual(["CNPM", "CNDL", "TTNT", "KCN"]);
    for (const cohort of ["K29", "K32", "", "KX", null, undefined])
      expect(specialtiesFor(cohort).map((item) => item.code)).toEqual(["CNPM", "CNDL", "TTNT"]);
  });

  it("labels every code, ANM included", () => {
    expect(specialtyLabel("ANM")).toBe("An ninh Mạng và IoTs");
    expect(specialtyLabel("KCN")).toBe("Không theo chuyên ngành");
    expect(specialtyLabel(null)).toBe("Chưa xác định");
  });
});
