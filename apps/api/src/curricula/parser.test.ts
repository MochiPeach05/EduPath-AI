import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { checkArchive, parseCurriculum, readWorkbook } from "./parser.js";
import { courseSchema, rebuild, type CurriculumData } from "./model.js";
import { identity } from "./repository.js";
import { fullMajorName } from "./majors.js";
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
  it("resolves course names the K28 CTĐT writes instead of codes, when it is imported again (audit 2026-10-25)", async () => {
    const k28 = await readWorkbook(await readFile(new URL("../../data/curricula/Khung CTĐT K28 CNTT (Gởi SV-CVHT).xlsx", import.meta.url)));
    expect(k28.relations.find((r) => r.courseCode === "71ITSE30803" && r.kind === "prior")).toMatchObject({
      raw: "Lập trình ứng dụng Java", targetCodes: ["71ITSE30403"], unresolvedCodes: [], reviewRequired: false,
    });
    // Two names separated by ";" with a final period, and an en dash for a hyphen.
    expect(k28.relations.find((r) => r.courseCode === "71POLC10052")).toMatchObject({ targetCodes: ["71POLS10032", "71POLH10042"], reviewRequired: false });
    expect(k28.relations.find((r) => r.courseCode === "71POLS10032")).toMatchObject({ raw: "Triết học Mác – Lênin", reviewRequired: false });
    // Text that names no course stays for review.
    expect(k28.relations.find((r) => r.courseCode === "71NAD310032")).toMatchObject({ raw: "GDQP 1,2", targetCodes: [], reviewRequired: true });
  }, 30000);
  it("resolves only exact names of the same CTĐT, never a bracketed text, a partial name or a name two codes share", () => {
    const data = creditFixture(
      12,
      [{ id: "a", label: "A. Program", credits: 12, sourceRow: 10 }],
      ["71ITSE30403", "71ITSE30803", "71ITIS30103", "71ITAI40203", "71ITAI40303"].map((code) => ({ code, type: "BB", credits: 3, groupId: "a" })),
    );
    const [java, advanced, database, first, second] = data.courses;
    java!.name = "Lập trình ứng dụng Java";
    advanced!.name = "Lập trình Java nâng cao";
    advanced!.prior = "lập trình ứng dụng  JAVA.";
    database!.name = "Cơ sở dữ liệu";
    database!.prior = "Lập trình ứng dụng Java; Lập trình Java nâng cao";
    database!.prerequisite = "[71ITSE30403]Lập trình ứng dụng Java";
    first!.name = "Học máy";
    second!.name = "Học máy";
    first!.prior = "Lập trình ứng dụng";
    second!.prior = "Học máy";
    rebuild(data);
    const relation = (code: string, kind: "prior" | "prerequisite") => data.relations.find((r) => r.courseCode === code && r.kind === kind);
    expect(relation("71ITSE30803", "prior")).toMatchObject({ targetCodes: ["71ITSE30403"], reviewRequired: false });
    expect(relation("71ITIS30103", "prior")).toMatchObject({ targetCodes: ["71ITSE30403", "71ITSE30803"], reviewRequired: false });
    expect(relation("71ITIS30103", "prerequisite")).toMatchObject({ targetCodes: ["71ITSE30403"], reviewRequired: false });
    expect(relation("71ITAI40203", "prior")).toMatchObject({ targetCodes: [], reviewRequired: true });
    expect(relation("71ITAI40303", "prior")).toMatchObject({ targetCodes: [], reviewRequired: true });
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

// 2026-10-26 (user): frameworks of the other majors, HTTT and MMT&TTDL. Synthetic workbooks laid out like the teacher's files.
describe("frameworks of the other majors (HTTT, MMT&TTDL)", () => {
  /** `fills`: row number → ARGB colour of the code cell. */
  async function workbook(name: string, rows: (string | number | null)[][], fills: Record<number, string> = {}) {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet(name);
    rows.forEach((row, r) => row.forEach((value, c) => { if (value !== null) sheet.getCell(r + 1, c + 1).value = value; }));
    for (const [row, argb] of Object.entries(fills)) sheet.getCell(Number(row), 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  const k29Header = (major: string) => [
    [],
    [`PHÂN BỐ KIẾN THỨC TRONG CTĐT KHÓA 29 - NGÀNH ${major}`],
    [null, null, null, null, 126],
    ["TT", "Mã học phần mới", "Tên học phần (Tiếng Việt)", "Tên học phần (Tiếng Anh)", "Số tín chỉ", "Số tiết/giờ", null, null,
      "Bắt buộc/Tự chọn", "ĐK tiên quyết", "ĐK học trước", "Mã BM", "BM Phụ trách", "Học kỳ triển khai"],
    [null, "Mã học phần mới", null, null, null, "LT", "TH", "TT"],
  ];
  const course = (n: number, code: string, name: string, type: string, term: number, prerequisite = "Không") =>
    [n, code, name, name, 3, 30, 30, 0, type, prerequisite, "Không", null, null, term];

  it("names the specialties of the K29 MMT&TTDL headings, and its electives by their colour", async () => {
    const IOT = "FFE2EFDA", ANM = "FFFCE4D6", TOPIC = "FFFFFF00";
    const data = await readWorkbook(await workbook("CTĐT_MMT_K29 (2023)", [
      ...k29Header("MẠNG MÁY TÍNH VÀ TRUYỀN THÔNG DỮ LIỆU"),
      ["Các môn Bắt buộc - Chuyên ngành IoT (Khối kiến thức chuyên ngành)"],
      course(1, "71NWSE40103", "Nhập môn hệ thống nhúng", "BB", 6),
      course(2, "71NWSE40203", "Lập trình ứng dụng IoT cơ bản", "BB", 7),
      ["Các môn Bắt buộc - Chuyên ngành An ninh Mạng (Khối kiến thức chuyên ngành)"],
      course(3, "71NWCS40103", "An ninh Hạ tầng mạng", "BB", 6),
      course(4, "71NWCS40203", "An ninh Mạng không dây", "BB", 7),
      ["Các môn Tự chọn (Khối kiến thức Chuyên ngành)"],
      course(5, "71NWSE40603", "Lập trình ứng dụng mạng", "TC209", 8),
      course(6, "71NWCS40703", "Điều tra mạng", "TC309", 8),
      course(7, "71NWGR40203", "Chuyên đề chiến lược quản lý dịch vụ IT", "TC309", 8),
      course(8, "71NWGR40106", "Đồ án tốt nghiệp", "BB", 10),
    ], { 7: IOT, 8: IOT, 10: ANM, 11: ANM, 13: IOT, 14: ANM, 15: TOPIC }));
    expect(data.courses.map((item) => [item.code, item.specialty])).toEqual([
      ["71NWSE40103", "IoT"], ["71NWSE40203", "IoT"], ["71NWCS40103", "An ninh Mạng"], ["71NWCS40203", "An ninh Mạng"],
      // The electives of the whole block take the specialty of their colour; the topic open to both keeps the block's value.
      ["71NWSE40603", "IoT"], ["71NWCS40703", "An ninh Mạng"], ["71NWGR40203", "Tự chọn Chuyên ngành"],
      // A mandatory course after the electives without a heading of its own is no elective.
      ["71NWGR40106", ""],
    ]);
    expect(data.courses.at(-1)!.block).toBe("Khóa luận/đồ án tốt nghiệp; hoặc học phần thay thế KL/ĐA TN");
  });

  it("names the colour runs of the K29 HTTT specialties by the course lists of its graduation project", async () => {
    // One colour paints general education and the Chuyển đổi số courses: only the run holding listed courses is named.
    const SHARED = "FFDDEBF7", CORE = "FFFFF2CC", GIS = "FFE2EFDA";
    const lists = "Chuyên ngành HTTT Chuyển đổi số:\nHoạch định nguồn lực doanh nghiệp\nQuản lý quy trình nghiệp vụ\n"
      + "Chuyên ngành HTTT Địa lý:\nQuản lý và Xử lý dữ liệu địa không gian\nCông nghệ web cho các hệ thống thông tin địa lý";
    const data = await readWorkbook(await workbook("CTĐT_HTTT_K29 (2024)", [
      ...k29Header("HỆ THỐNG THÔNG TIN"),
      course(1, "71POLP10013", "Triết học Mác Lênin", "BB", 2),
      course(2, "71ITBS10203", "Cơ sở lập trình", "BB", 1),
      course(3, "71ISDT40103", "Nhập môn chuyển đổi số", "", 6),
      course(4, "71ISDT40203", "Quản lý quy trình nghiệp vụ", "", 7),
      course(5, "71ISDT40403", "Hoạch định nguồn lực doanh nghiệp", "", 7),
      course(6, "71ISGS40103", "Các hệ thống GIS nguồn mở", "BB", 8),
      course(7, "71ISGS40503", "Quản lý và Xử lý dữ liệu địa không gian", "BB", 7),
      course(8, "71ISGS40303", "Công nghệ web cho các hệ thống thông tin địa lý", "BB", 7),
      course(9, "71ISGR40106", "Đồ án TN", "BB", 10, lists),
    ], { 6: SHARED, 7: CORE, 8: SHARED, 9: SHARED, 10: SHARED, 11: GIS, 12: GIS, 13: GIS }));
    expect(data.courses.map((item) => [item.code, item.specialty])).toEqual([
      ["71POLP10013", ""], ["71ITBS10203", ""],
      ["71ISDT40103", "HTTT Chuyển đổi số"], ["71ISDT40203", "HTTT Chuyển đổi số"], ["71ISDT40403", "HTTT Chuyển đổi số"],
      ["71ISGS40103", "HTTT Địa lý"], ["71ISGS40503", "HTTT Địa lý"], ["71ISGS40303", "HTTT Địa lý"],
      ["71ISGR40106", ""],
    ]);
    expect(data.warnings.some((warning) => warning.message.startsWith("Chuyên ngành của một số môn lấy theo màu tô trong tệp (HTTT Chuyển đổi số: 3 môn, HTTT Địa lý: 3 môn)"))).toBe(true);
  });

  it("reads a framework without a total, and not the column numbers under the signature", async () => {
    // K32 HTTT names no "Tổng tín chỉ"; K31 MMT&TTDL repeats 1, 2, 3 … under its signature.
    const data = await readWorkbook(await workbook("CTĐT_HTTT_K32 (2025)", [
      ["KHUNG CHƯƠNG TRÌNH ĐÀO TẠO NGÀNH HỆ THỐNG THÔNG TIN KHÓA 32"],
      [],
      ["TT", "Mã học phần", "Tên học phần tiếng Việt", "Tên học phần tiếng Anh", "Số tín chỉ", "LT", "TH", "ĐA", "TT", "BB/TC",
        "Điều kiện tiên quyết", "Điều kiện học trước", "Khối kiến thức", "Tên chuyên ngành/chuyên sâu", "Ghi chú", "Mã BM", "BM Phụ trách", "Học kỳ", "Năm"],
      [1, "71POLP10013", "Triết học Mác-Lênin", "Philosophy of Marxism and Leninism", 3, 45, 0, 0, null, "BB", "Không", "Không",
        "Kiến thức giáo dục đại cương", null, null, "200111206", "Bộ môn Triết học", 2, 1],
      [],
      [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ]));
    expect(data).toMatchObject({ major: "HỆ THỐNG THÔNG TIN", cohortCode: "K32", totalCredits: null });
    expect(data.courses.map((course) => [course.code, course.semester, course.studyYear])).toEqual([["71POLP10013", 2, 1]]);
    expect(data.warnings.map((warning) => warning.message)).toContain("Tệp không ghi Tổng tín chỉ của CTĐT; hãy nhập tổng tín chỉ khi rà soát khung.");
  });

  it("takes the term of a course from the term number of the K29 frameworks (Học kỳ triển khai)", async () => {
    const data = await readWorkbook(await workbook("CTĐT_HTTT_K29 (2024)", [
      [],
      ["PHÂN BỐ KIẾN THỨC TRONG CTĐT KHÓA 29 - NGÀNH HỆ THỐNG THÔNG TIN"],
      [null, null, null, null, 126],
      ["TT", "Mã học phần mới", "Tên học phần (Tiếng Việt)", "Tên học phần (Tiếng Anh)", "Số tín chỉ", "Số tiết/giờ", null, null,
        "Bắt buộc/Tự chọn", "ĐK tiên quyết", "ĐK học trước", "Mã BM", "BM Phụ trách", "Học kỳ triển khai"],
      [null, "Mã học phần mới", null, null, null, "LT", "TH", "TT"],
      [1, "71POLP10013", "Triết học Mác Lênin", "Philosophy of Marxism and Leninism", 3, 45, 0, 0, "BB", "Không", "Không", "200111207", "Bộ môn", 2],
      [2, "71ISIN40104", "Đồ án thực tập", "Internship Project", 4, 0, 0, 60, "BB", "Không", "Không", null, null, 9],
      [3, "71ISGR40106", "Đồ án TN", "Graduation Projects", 6, 0, 0, 180, "BB", "Không", "Không", null, null, 10],
    ]));
    expect(data).toMatchObject({ major: "HỆ THỐNG THÔNG TIN", cohortCode: "K29", totalCredits: 126 });
    // 1–3 are HK1, HK2 and HK3 of year 1: 9 is HK3 of year 3 (253), 10 HK1 of year 4 (261).
    expect(data.courses.map((course) => [course.code, course.semester, course.studyYear])).toEqual([
      ["71POLP10013", 2, 1], ["71ISIN40104", 3, 3], ["71ISGR40106", 1, 4],
    ]);
    expect(data.warnings.some((warning) => warning.message.startsWith("Cột Học kỳ triển khai ghi số thứ tự học kỳ"))).toBe(true);
  });

  it("names a major written by its short name in full, so its CTĐT and KHĐT share one identity", () => {
    expect(["MMT & TTDL", "MMT&TTDL", "HTTT", "CNTT", "Hệ thống thông tin"].map(fullMajorName)).toEqual([
      "MẠNG MÁY TÍNH VÀ TRUYỀN THÔNG DỮ LIỆU", "MẠNG MÁY TÍNH VÀ TRUYỀN THÔNG DỮ LIỆU", "HỆ THỐNG THÔNG TIN", "CÔNG NGHỆ THÔNG TIN",
      "Hệ thống thông tin",
    ]);
  });
});
