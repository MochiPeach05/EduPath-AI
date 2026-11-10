import { describe, expect, it, vi } from "vitest";
import {
  curriculumWithRealCodes, planWithRealCodes, readRealCourseRows, realCourseCodes, realCodesInText, studyPlanWithRealCodes, withRealCodeField,
} from "./real-codes.js";

// Catalog data only (codes and names of the ngành HTTT K29 CTĐT and graduation standard, user 2026-11-10); no student data.
type Course = { code: string; name: string; credits: number };
const ctdt = (...courses: [string, string, number][]): Course[] => courses.map(([code, name, credits]) => ({ code, name, credits }));
const standard = (...courses: [string, string, number | null, string[]?][]) => ({
  courses: courses.map(([code, name, credits, alternativeCodes], index) => ({
    id: `s${index}`, groupId: "g", code, name, credits, conditionOnly: false, sourceRow: index, ...(alternativeCodes ? { alternativeCodes } : {}),
  })),
});
const httt = ctdt(["71ITMA10203", "Đại số tuyến tính và ứng dụng", 3], ["71ISGR40203", "Chuyên đề Thương mại điện tử", 3], ["71ITBS10103", "Nhập môn Công nghệ thông tin", 3]);
const htttStandard = standard(["71MATL10053", "Đại số tuyến tính và ứng dụng", 3], ["71ITIS30503", "Chuyên đề Thương Mại điện tử", 3],
  ["71ITBS10103", "Nhập môn Công nghệ thông tin", 3]);

describe("realCourseCodes (user 2026-11-10: \"dùng luôn mã thực tế\")", () => {
  it("gives a CTĐT course no standard lists the code of the standard's one course with that name and credits", () => {
    expect(realCourseCodes(httt, [htttStandard])).toEqual(new Map([["71ITMA10203", "71MATL10053"], ["71ISGR40203", "71ITIS30503"]]));
    // Every standard of the cohort and major that names the course agrees; one that does not name it says nothing.
    expect(realCourseCodes(httt, [htttStandard, standard(["71MATL10053", "Đại số tuyến tính và ứng dụng", 3])]).get("71ITMA10203")).toBe("71MATL10053");
    expect(realCourseCodes(httt, [htttStandard, standard(["71ITBS10103", "Nhập môn Công nghệ thông tin", 3])]).size).toBe(2);
  });

  it("keeps the CTĐT's code when a standard lists it, under its own or another code of the course", () => {
    expect(realCourseCodes(httt, [standard(["71ITMA10203", "Đại số tuyến tính", 3])]).size).toBe(0);
    expect(realCourseCodes(httt, [htttStandard, standard(["71MATL10053", "Đại số tuyến tính và ứng dụng", 3, ["71ITMA10203"]])]).has("71ITMA10203")).toBe(false);
    expect(realCourseCodes(httt, [htttStandard, standard(["71ITMA10203", "Đại số tuyến tính và ứng dụng", 3])]).has("71ITMA10203")).toBe(false);
  });

  it("keeps it on other credits, two courses of that name, standards that disagree, or a code the CTĐT has elsewhere", () => {
    // K26: the CTĐT's DQP0060 has 1 TC, the standard's DQP0061 0 TC; a standard without credits says nothing certain either.
    expect(realCourseCodes(ctdt(["DQP0060", "Giáo dục quốc phòng 4", 1]), [standard(["DQP0061", "Giáo dục quốc phòng 4", 0])]).size).toBe(0);
    expect(realCourseCodes(httt, [standard(["71MATL10053", "Đại số tuyến tính và ứng dụng", null])]).size).toBe(0);
    expect(realCourseCodes(httt, [standard(["71MATL10053", "Đại số tuyến tính và ứng dụng", 3], ["71MATL10054", "Đại số tuyến tính và ứng dụng", 3])]).size).toBe(0);
    expect(realCourseCodes(httt, [htttStandard, standard(["71MATL19999", "Đại số tuyến tính và ứng dụng", 3])]).has("71ITMA10203")).toBe(false);
    expect(realCourseCodes([...httt, { code: "71MATL10053", name: "Toán rời rạc", credits: 3 }], [htttStandard]).has("71ITMA10203")).toBe(false);
  });

  it("never gives two CTĐT courses one code, and reads nothing without a standard", () => {
    const twice = [...httt, { code: "71ITMA10299", name: "Đại số tuyến tính và ứng dụng", credits: 3 }];
    expect([...realCourseCodes(twice, [htttStandard]).keys()]).toEqual(["71ISGR40203"]);
    expect(realCourseCodes(httt, []).size).toBe(0);
    // A repeated CTĐT row (the same code in two groups) is one course.
    expect(realCourseCodes([...httt, httt[0]!], [htttStandard]).get("71ITMA10203")).toBe("71MATL10053");
  });
});

describe("reading data with the real codes", () => {
  const codes = new Map([["71ITMA10203", "71MATL10053"], ["71ISGR40203", "71ITIS30503"]]);

  it("writes the real code in texts, CTĐT data and training plans, the data given unchanged", () => {
    expect(realCodesInText("[71ITMA10203]Đại số tuyến tính; 71ITMA102031 khác", codes)).toBe("[71MATL10053]Đại số tuyến tính; 71ITMA102031 khác");
    const data = {
      courses: [{ code: "71ISGR40203", prerequisite: "", prior: "71ITMA10203" }, { code: "71ITBS10103" }],
      electives: [{ courseCodes: ["71ISGR40203", "71ITBS10103"] }],
      relations: [{ courseCode: "71ISGR40203", raw: "[71ITMA10203]", targetCodes: ["71ITMA10203"], unresolvedCodes: [] }],
    };
    const before = JSON.stringify(data);
    expect(curriculumWithRealCodes(data, codes)).toEqual({
      courses: [{ code: "71ITIS30503", fileCode: "71ISGR40203", prerequisite: "", prior: "71MATL10053" }, { code: "71ITBS10103" }],
      electives: [{ courseCodes: ["71ITIS30503", "71ITBS10103"] }],
      relations: [{ courseCode: "71ITIS30503", raw: "[71MATL10053]", targetCodes: ["71MATL10053"], unresolvedCodes: [] }],
    });
    expect(JSON.stringify(data)).toBe(before);
    expect(planWithRealCodes({ items: [{ code: "71ITMA10203", prior: "" }] }, codes).items).toEqual([{ code: "71MATL10053", prior: "" }]);
  });

  it("marks the rows a page shows under the real code (realCode), the others as they are", () => {
    expect(withRealCodeField([{ code: "71ITMA10203", name: "Đại số" }, { code: "71ITBS10103", name: "Nhập môn" }], codes))
      .toEqual([{ code: "71ITMA10203", name: "Đại số", realCode: "71MATL10053" }, { code: "71ITBS10103", name: "Nhập môn" }]);
    expect(withRealCodeField([{ code: "71ITMA10203" }], new Map())).toEqual([{ code: "71ITMA10203" }]);
  });

  it("reads a Kế hoạch học kỳ saved with the file's code under the real one, a course planned twice once", () => {
    const saved = {
      schemaVersion: 1 as const, roadmapId: null,
      aiAdded: { completedAt: "2026-11-01T00:00:00Z", term: "HK262", codes: ["71ISGR40203", "71ITIS30503"], addedAt: "2026-11-01T00:00:00Z" },
      kept: ["71isgr40203"],
      terms: [{ code: "HK262", courses: [{ code: "71ISGR40203" }, { code: "71ITBS10103" }] }, { code: "HK263", courses: [{ code: "71ITIS30503" }] }],
    };
    expect(studyPlanWithRealCodes(saved, codes)).toEqual({
      ...saved, aiAdded: { ...saved.aiAdded, codes: ["71ITIS30503"] }, kept: ["71ITIS30503"],
      terms: [{ code: "HK262", courses: [{ code: "71ITIS30503" }, { code: "71ITBS10103" }] }, { code: "HK263", courses: [] }],
    });
    expect(studyPlanWithRealCodes(saved, new Map())).toBe(saved);
  });
});

describe("readRealCourseRows", () => {
  const revision = "11111111-1111-4111-8111-111111111111";
  const fakeDb = () => {
    const query = vi.fn(async (sql: string) => {
      const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
      if (sql.includes("FROM curricula c JOIN curriculum_courses cc")) return rows(httt.map((course) => ({
        revision_id: revision, cohort_code: "K29", identity_key: "he thong thong tin:K29", code: course.code, name: course.name, credits: String(course.credits),
      })));
      if (sql.includes("FROM graduation_standards g")) return rows([
        { cohort_code: "K29", data: { ...htttStandard, specialty: "", classBlock: "71K29HTTT", standardCode: "71K29HTTT_TN04", major: "Hệ thống thông tin (7480104)" } },
        // Another major's standard of the cohort is not read (Công nghệ thông tin writes 71ISGR40203 itself).
        { cohort_code: "K29", data: { ...standard(["71ISGR40203", "Chuyên đề Thương mại điện tử", 3]), specialty: "Công nghệ phần mềm (7480201-03)",
          classBlock: "71K29CNTT_7480201-03", standardCode: "71K29CNTT_7480201-03_TN04" } },
      ]);
      if (sql.includes("FROM ad_comp_courses")) return rows([
        { id: "algebra", code: "71MATL10053", name: "Đại số tuyến tính và ứng dụng", credits: 3 },
        // Two shared courses carry 71ITIS30503 (K30 names it differently): the one with the row's name and credits counts.
        { id: "ecommerce-k30", code: "71ITIS30503", name: "Thương mại điện tử và Mạng xã hội", credits: 3 },
        { id: "ecommerce", code: "71ITIS30503", name: "Chuyên đề Thương Mại điện tử", credits: 3 },
      ]);
      throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
    });
    return { query };
  };

  it("reads each mapped CTĐT row with the shared course of its real code, among the standards of its cohort and major", async () => {
    expect(await readRealCourseRows(fakeDb(), [revision])).toEqual([
      { revision_id: revision, code: "71ITMA10203", real_code: "71MATL10053", course_id: "algebra" },
      { revision_id: revision, code: "71ISGR40203", real_code: "71ITIS30503", course_id: "ecommerce" },
    ]);
  });
});
