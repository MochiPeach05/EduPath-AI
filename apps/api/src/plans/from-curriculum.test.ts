import { describe, expect, it } from "vitest";
import type { CurriculumCourse, CurriculumData } from "../curricula/model.js";
import { curriculumIdOf, curriculumPlan, curriculumPlanId, curriculumPlanName, physicalEducationGroupsOf } from "./from-curriculum.js";

// Synthetic CTĐT rows only.
const course = (position: number, code: string, extra: Partial<CurriculumCourse> = {}): CurriculumCourse => ({
  position, code, name: `Môn ${code}`, englishName: "", credits: 3, type: "BB", block: "", specialty: "", semester: 1, studyYear: 1,
  prerequisite: "", prior: "", notes: "ghi chú nội bộ", department: "", departmentCode: "",
  hours: { lecture: 30, practice: 30, project: null, internship: null }, groupId: "g1", sourceRow: position, sourceSheet: "K27", sourceCells: {}, ...extra,
});
const data = {
  schemaVersion: 1, name: "KHUNG CTĐT K27", major: "Công nghệ thông tin", cohortCode: "K27", admissionYear: 2022, totalCredits: 130, notes: "",
  courses: [
    course(1, "71ITBS10103"),
    course(2, "71PEKC10062", { type: "TC002 (2TC)", credits: 2 }),
    course(3, "71ITSE30803", { specialty: "Công nghệ Phần mềm", semester: 2, studyYear: 3 }),
    course(4, "71ITSE31003", { type: "TC209", specialty: "Tự chọn Chuyên ngành", semester: 2, studyYear: 3 }),
    course(5, "71ITGR40206", { semester: null, studyYear: null }),
  ],
  groups: [], electives: [{ code: "TC209", requiredCredits: 9, courseCodes: ["71ITSE31003"] }, { code: "TC002", requiredCredits: 2, courseCodes: ["71PEKC10062"] }],
  relations: [], warnings: [], sourceWarnings: [],
} satisfies CurriculumData;

describe("a training plan read from the CTĐT (user 2026-11-05)", () => {
  it("names and ids the plan apart from imported ones", () => {
    expect(curriculumPlanId("abc")).toBe("ctdt-abc");
    expect(curriculumIdOf("ctdt-abc")).toBe("abc");
    expect(curriculumIdOf("33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(curriculumPlanName("Công nghệ thông tin", "K27")).toBe("Kế hoạch đào tạo ngành Công nghệ thông tin khóa 27 (theo chương trình đào tạo)");
  });

  it("puts each course in its planned term, with specialty and elective sections, and counts the unplaced", () => {
    const plan = curriculumPlan(data);
    expect(plan.terms).toEqual([
      { code: "HK221", semester: 1, studyYear: 1, sourceCredits: null },
      { code: "HK242", semester: 2, studyYear: 3, sourceCredits: null },
    ]);
    expect(plan.items.map((item) => [item.code, item.termCode, item.sectionId])).toEqual([
      ["71ITBS10103", "HK221", ""],
      ["71PEKC10062", "HK221", "HK221-TC002"],
      ["71ITSE30803", "HK242", "HK242-CNPM"],
      ["71ITSE31003", "HK242", "HK242-TC209"],
    ]);
    expect(plan.sections).toEqual([
      { id: "HK221-TC002", termCode: "HK221", label: "Tự chọn TC002: chọn 2 tín chỉ", kind: "choice" },
      { id: "HK242-CNPM", termCode: "HK242", label: "Chuyên ngành Công nghệ phần mềm", kind: "specialty" },
      { id: "HK242-TC209", termCode: "HK242", label: "Tự chọn TC209: chọn 9 tín chỉ", kind: "choice" },
    ]);
    expect(plan.unplacedCount).toBe(1);
    expect(plan.items.every((item) => item.notes === "")).toBe(true);
    expect(plan).toMatchObject({ major: "Công nghệ thông tin", cohortCode: "K27", admissionYear: 2022, totalCredits: 130 });
  });

  it("lists the physical education choices like an imported plan", () => {
    expect(physicalEducationGroupsOf(data.courses)).toEqual({ TC002: ["71PEKC10062"], TC102: [] });
  });
});
