import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { checkArchive, parseCurriculum, readWorkbook } from "./parser.js";
import { courseSchema, rebuild, type CurriculumData } from "./model.js";
import { identity } from "./repository.js";
let k29: CurriculumData, k30: CurriculumData, k31: CurriculumData;
beforeAll(async () => {
  [k29, k30, k31] = await Promise.all(
    [29, 30, 31].map(async (k) =>
      readWorkbook(
        await readFile(
          new URL(`../../data/curricula/K${k}.xlsx`, import.meta.url),
        ),
      ),
    ),
  );
}, 30000);

function creditFixture(
  totalCredits: number,
  groups: CurriculumData["groups"],
  courses: { code: string; type: string; credits: number; groupId: string }[],
): CurriculumData {
  const template = k29.courses[0]!;
  return {
    ...structuredClone(k29),
    totalCredits,
    groups: structuredClone(groups),
    courses: courses.map((course, index) => ({
      ...template,
      position: index + 1,
      code: course.code,
      name: course.code,
      englishName: course.code,
      credits: course.credits,
      type: course.type,
      groupId: course.groupId,
      specialty: "",
      semester: 1,
      studyYear: 1,
      prerequisite: "",
      prior: "",
      sourceRow: index + 100,
      sourceSheet: "Credit fixture",
      sourceCells: {},
    })),
    electives: [],
    relations: [],
    warnings: [],
    sourceWarnings: [],
  };
}

function totalCreditWarnings(data: CurriculumData) {
  return data.warnings.filter((warning) =>
    warning.row === null && /ghi \d+/.test(warning.message),
  );
}
describe("real faculty curriculum workbooks", () => {
  it("imports exactly the supplied cohorts, preserving every course and authoritative credits", () => {
    for (const [data, count, year] of [
      [k29, 88, 2023],
      [k30, 89, 2024],
      [k31, 89, 2025],
    ] as const) {
      expect(data.courses).toHaveLength(count);
      expect(data.admissionYear).toBe(year);
      expect(data.totalCredits).toBe(126);
      for (const course of data.courses)
        expect(courseSchema.safeParse(course).success, course.code).toBe(true);
      expect(new Set(data.courses.map((c) => c.code)).size).toBe(count);
    }
  });
  it("imports changed code formats without changing the course data or source values", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await readFile(new URL("../../data/curricula/K31.xlsx", import.meta.url)) as never);
    const sourceCodes = ["module/2027.01", "môn a+b", "BACKEND", "101"];
    for (const [index, sourceCode] of sourceCodes.entries()) {
      const original = k31.courses[index]!;
      workbook.getWorksheet(original.sourceSheet)!.getCell(original.sourceRow, 2).value = sourceCode;
    }
    const first = k31.courses[0]!;
    workbook.getWorksheet(first.sourceSheet)!.getCell(first.sourceRow, 12).value = "[môn a+b]";

    const data = await readWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(data.courses).toHaveLength(k31.courses.length);
    for (const [index, sourceCode] of sourceCodes.entries()) {
      expect(data.courses[index]).toMatchObject({
        code: sourceCode.toUpperCase(),
        name: k31.courses[index]!.name,
        credits: k31.courses[index]!.credits,
        sourceCells: { B: sourceCode },
      });
    }
    expect(data.relations.find((relation) => relation.courseCode === "MODULE/2027.01" && relation.kind === "prior"))
      .toMatchObject({ targetCodes: ["MÔN A+B"], unresolvedCodes: [], reviewRequired: false });
  });
  it("preserves BBKTL and separates elective requirements from the offered course credits", () => {
    expect(k30.courses.filter((c) => c.type === "BBKTL")).toHaveLength(4);
    expect(k31.electives.find((g) => g.code === "TC309")?.requiredCredits).toBe(
      9,
    );
    expect(
      k29.electives.find((g) => g.code === "TC309")?.requiredCredits,
    ).toBeNull();
    expect(k31.courses.reduce((sum, c) => sum + c.credits, 0)).toBeGreaterThan(
      k31.totalCredits,
    );
  });
  it("does not report false total-credit warnings for the supplied K29-K31 workbooks", () => {
    const warningsByCohort = Object.fromEntries([k29, k30, k31].map((data) => [
      data.cohortCode,
      totalCreditWarnings(data).map((warning) => warning.message),
    ]));
    expect(warningsByCohort).toEqual({ K29: [], K30: [], K31: [] });
  });
  it("retains invalid formula and shifted source cells without inventing semester or department", () => {
    expect(k29.sourceWarnings.some((w) => w.message.includes("#REF!"))).toBe(
      true,
    );
    const shifted = k29.courses.find((c) => c.sourceRow === 108)!;
    expect(shifted.semester).toBeNull();
    expect(shifted.department).toBe("");
    expect(shifted.sourceCells.R).not.toBe("");
    expect(shifted.sourceCells.M).toContain("71ITSE30503");
  });
  it("does not silently map an obsolete prerequisite code by similar course name", () => {
    expect(k31.courses.some((c) => c.code === "71ITMA10404")).toBe(true);
    expect(
      k31.relations.find((r) => r.courseCode === "71ITDS40203"),
    ).toMatchObject({
      kind: "prior",
      reviewRequired: true,
      unresolvedCodes: ["71ITMA10403"],
    });
  });
  it("keeps the two relation kinds and conditional requirements distinct", () => {
    expect(k31.relations.some((r) => r.kind === "prior")).toBe(true);
    expect(k31.relations.some((r) => r.kind === "prerequisite")).toBe(true);
    expect(
      k31.relations
        .filter((r) => r.courseCode === "71ITGR40206")
        .every((r) => r.reviewRequired),
    ).toBe(true);
  });
  it("runs parsing in a real bounded worker, independently of the uploaded filename", async () => {
    const data = await parseCurriculum(
      await readFile(new URL("../../data/curricula/K30.xlsx", import.meta.url)),
    );
    expect(data.cohortCode).toBe("K30");
    expect(data.courses).toHaveLength(89);
  }, 30000);
  it("warns on duplicate codes while preserving rows and marking their relations for review", () => {
    const data = structuredClone(k29);
    const first = data.courses[0]!;
    const duplicate = {
      ...first,
      position: data.courses.length + 1,
      sourceRow: 200,
    };
    const targetCode = data.courses[1]!.code;
    first.prerequisite = targetCode;
    duplicate.prerequisite = targetCode;
    data.courses.push(duplicate);

    const rebuilt = rebuild(data);
    const sameCodeRows = rebuilt.courses.filter((course) => course.code === first.code);
    const duplicateWarning = rebuilt.warnings.find((warning) =>
      warning.row === duplicate.sourceRow &&
      warning.message.includes(first.code) &&
      warning.message.includes(String(first.sourceRow)) &&
      warning.message.includes(String(duplicate.sourceRow)),
    );
    const duplicateRelations = rebuilt.relations.filter((relation) =>
      relation.courseCode === first.code && relation.kind === "prerequisite",
    );

    expect(rebuilt.courses).toHaveLength(k29.courses.length + 1);
    expect(sameCodeRows).toHaveLength(2);
    expect(duplicateWarning).toBeDefined();
    expect(duplicateRelations).toHaveLength(2);
    expect(duplicateRelations.every((relation) => relation.reviewRequired)).toBe(true);
  });
  it("accepts an explicit elective requirement appearing after a bare group code", () => {
    const data = structuredClone(k31);
    const electives = data.courses.filter((c) => c.type.startsWith("TC002"));
    electives[0]!.type = "TC002";
    expect(
      rebuild(data).electives.find((g) => g.code === "TC002")?.requiredCredits,
    ).toBe(2);
  });
  it("warns when required course credits do not match the block declaration", () => {
    const data = creditFixture(
      4,
      [{ id: "a", label: "A. General", credits: 4, sourceRow: 77 }],
      [{ code: "71ITGEN1001", type: "BB", credits: 3, groupId: "a" }],
    );

    rebuild(data);

    expect(data.warnings.some((warning) =>
      warning.row === 77 && warning.message.includes("4") && warning.message.includes("3"),
    )).toBe(true);
    expect(totalCreditWarnings(data)).toEqual([]);
  });
  it("warns when the top-level declared credit total does not match its blocks", () => {
    const data = creditFixture(
      12,
      [
        { id: "a", label: "A. General", credits: 3, sourceRow: 10 },
        { id: "b", label: "B. Major", credits: 6, sourceRow: 20 },
      ],
      [
        { code: "71ITGEN1001", type: "BB", credits: 3, groupId: "a" },
        { code: "71ITMAJ1001", type: "BB", credits: 6, groupId: "b" },
      ],
    );

    rebuild(data);

    expect(totalCreditWarnings(data)).toHaveLength(1);
    expect(totalCreditWarnings(data)[0]!.message).toContain("12");
    expect(totalCreditWarnings(data)[0]!.message).toContain("9");
  });
  it("accepts matching block and top-level credit totals", () => {
    const data = creditFixture(
      9,
      [
        { id: "a", label: "A. General", credits: 3, sourceRow: 10 },
        { id: "b", label: "B. Major", credits: 6, sourceRow: 20 },
      ],
      [
        { code: "71ITGEN1001", type: "BB", credits: 3, groupId: "a" },
        { code: "71ITMAJ1001", type: "BB", credits: 6, groupId: "b" },
      ],
    );

    rebuild(data);

    expect(data.warnings).toEqual([]);
  });
  it("counts an elective requirement once instead of summing its offered courses", () => {
    const data = creditFixture(
      9,
      [{ id: "a", label: "A. Program", credits: 9, sourceRow: 10 }],
      [
        { code: "71ITGEN1001", type: "BB", credits: 6, groupId: "a" },
        { code: "71ITELC1001", type: "TC001 (3 TC)", credits: 5, groupId: "a" },
        { code: "71ITELC1002", type: "TC001 (3 TC)", credits: 4, groupId: "a" },
      ],
    );

    rebuild(data);

    expect(data.electives.find((group) => group.code === "TC001")?.requiredCredits).toBe(3);
    expect(data.warnings).toEqual([]);
  });
  it("leaves unknown credit rules unverified instead of reporting a mismatch", () => {
    const data = creditFixture(
      3,
      [{ id: "general", label: "General", credits: 3, sourceRow: 10 }],
      [{ code: "71ITUNK1001", type: "", credits: 3, groupId: "general" }],
    );

    rebuild(data);

    expect(data.warnings.some((warning) =>
      warning.row === null && warning.message.includes("quy \u0111\u1ecbnh t\u00edn ch\u1ec9"),
    )).toBe(true);
    expect(totalCreditWarnings(data)).toEqual([]);
    expect(data.warnings.some((warning) => warning.row === 10)).toBe(false);
  });
  it("marks cyclic dependencies for review", () => {
    const data = structuredClone(k31);
    const [a, b] = data.courses;
    a!.prerequisite = b!.code;
    b!.prerequisite = a!.code;
    expect(
      rebuild(data).warnings.some((w) => w.message.includes("chu trình")),
    ).toBe(true);
  });
  it("uses major and cohort identity, not filename or presentation title", () => {
    expect(identity(k29)).toBe(
      identity({ ...k29, name: "Tên mới", major: k29.major.toLowerCase() }),
    );
    expect(identity(k30)).not.toBe(identity(k29));
  });
  it("only allows semesters 1, 2, 3 on edits", () => {
    expect(
      courseSchema.safeParse({ ...k29.courses[0], semester: 4 }).success,
    ).toBe(false);
    expect(
      courseSchema.safeParse({ ...k29.courses[0], semester: 3 }).success,
    ).toBe(true);
  });
  it("rejects non-workbooks and archives whose advertised expansion exceeds the limit", async () => {
    expect(() => checkArchive(Buffer.from("%PDF-invalid"))).toThrow(
      "invalid_workbook",
    );
    const file = await readFile(
      new URL("../../data/curricula/K30.xlsx", import.meta.url),
    );
    const index = file.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    file.writeUInt32LE(40 * 1024 * 1024, index + 24);
    expect(() => checkArchive(file)).toThrow("workbook_too_large");
  });
});

describe("older Faculty templates (K26–K28, 2026-10-23)", () => {
  const read = async (file: string) => readWorkbook(await readFile(new URL(`../../data/curricula/${file}`, import.meta.url)));
  it("reads each cohort's framework by its header names, with the 2025 template's values", async () => {
    const [k26, k27, k28] = await Promise.all([
      read("Khung CTĐT K26 CNTT (Gởi SV).xlsx"),
      read("Khung CTĐT K27 CNTT (Gởi SV-CVHT).xlsx"),
      read("Khung CTĐT K28 CNTT (Gởi SV-CVHT).xlsx"),
    ]);
    for (const [data, cohort, total, courses, sheet] of [
      [k26, 26, 130, 85, "K26 CNTT"],
      [k27, 27, 127, 84, "K27 CNTT (Năm 4)"],
      [k28, 28, 126, 71, "Khung CTĐT K28 CNTT (Năm 3)"],
    ] as const) {
      expect(data).toMatchObject({
        name: `KHUNG CHƯƠNG TRÌNH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN KHÓA ${cohort}`, major: "CÔNG NGHỆ THÔNG TIN",
        cohortCode: `K${cohort}`, admissionYear: 1994 + cohort, totalCredits: total,
      });
      expect(identity(data)).toBe(`cong nghe thong tin:K${cohort}`);
      expect(data.courses).toHaveLength(courses);
      // Hidden sheets are never read: the K28 workbook also hides a K27 framework and a Ngôn ngữ Anh template.
      expect(new Set(data.courses.map((course) => course.sourceSheet))).toEqual(new Set([sheet]));
      for (const course of data.courses) expect(courseSchema.safeParse(course).success).toBe(true);
    }
    const course = (data: CurriculumData, code: string) => data.courses.find((item) => item.code === code)!;
    // "HK tổ chức" 231 is the second study year of K28 (2022), semester 1; LT/TH/TT sit under "Số tiết/giờ".
    expect(course(k28, "71ITSE30503")).toMatchObject({
      name: "Lập trình ứng dụng Web", credits: 3, type: "BB", block: "Kiến thức cơ sở ngành", specialty: "",
      studyYear: 2, semester: 1, hours: { lecture: 30, practice: 30, project: null, internship: 0 }, prior: "Cơ sở lập trình",
    });
    expect(course(k28, "71NAD110013").block).toBe("Giáo dục thể chất và giáo dục quốc phòng");
    // Specialty headings ("2.3.1 Chuyên ngành Công nghệ Phần mềm: 18 tín chỉ BB") give the specialty names.
    expect([...new Set(k28.courses.map((item) => item.specialty))].sort()).toEqual(["", "Công nghệ Dữ liệu", "Công nghệ Phần mềm", "Trí tuệ Nhân tạo", "Tự chọn Chuyên ngành"]);
    expect([...new Set(k27.courses.map((item) => item.specialty))]).toContain("Tin học Quản trị");
    // K26 keeps its own codes and English names; "BB/KTL" is written BBKTL as in the 2025 template.
    expect(course(k26, "DQP0021")).toMatchObject({ type: "BBKTL", block: "Giáo dục thể chất và giáo dục quốc phòng", studyYear: 1, semester: 1 });
    expect(course(k26, "DIT0010").englishName).toBe("Introduction to Information Technology");
    expect(k26.warnings[0]!.message).toContain("Mẫu khung CTĐT cũ");
  });

  it("does not take a training plan or a hidden template for a framework", async () => {
    await expect(readWorkbook(await readFile(new URL("../../data/plans/Ke hoach giảng dạy CNTT K28.xlsx", import.meta.url))))
      .rejects.toThrow("unsupported_curriculum_template");
  });
});
