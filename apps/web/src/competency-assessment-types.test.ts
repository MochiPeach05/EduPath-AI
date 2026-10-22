import { describe, expect, it } from "vitest";
import { specialtiesFor, specialtyLabel } from "./competency-assessment-types";

describe("specialties offered on the student profile", () => {
  it("adds An ninh Mạng và IoTs for K27 only", () => {
    expect(specialtiesFor("K27").map((item) => item.code)).toEqual(["CNPM", "CNDL", "TTNT", "ANM"]);
    expect(specialtiesFor(" k27 ").map((item) => item.code)).toContain("ANM");
    for (const cohort of ["K26", "K28", "K29", "", null, undefined])
      expect(specialtiesFor(cohort).map((item) => item.code)).toEqual(["CNPM", "CNDL", "TTNT"]);
  });

  it("labels every code, ANM included", () => {
    expect(specialtyLabel("ANM")).toBe("An ninh Mạng và IoTs");
    expect(specialtyLabel(null)).toBe("Chưa xác định");
  });
});
