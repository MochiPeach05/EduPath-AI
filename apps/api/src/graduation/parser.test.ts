import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { fold, graduationSchema, validateData, warnings, type GraduationData } from "./model.js";
import { courseCodes, parseGraduation, parseSheet } from "./parser.js";

const sourceDirectory = fileURLToPath(
  new URL("../../../../output/graduation-audit/files/", import.meta.url),
);
const auditDirectory = process.env.GRADUATION_AUDIT_DIR
  ? resolve(process.cwd(), process.env.GRADUATION_AUDIT_DIR)
  : sourceDirectory;
const hasAuditSources = existsSync(auditDirectory);
let parsed: GraduationData[] = [];

type Expected = {
  cohort: string;
  classBlock: string;
  groups: number;
  mandatoryGroups: number;
  electiveGroups: number;
  courses: number;
  conditionOnly: number;
  nullCredits: number;
  thresholds: [number, number, number, number, number];
};

function assertMetadata(data: GraduationData, expected: Expected) {
  expect(data.cohortCode).toBe(expected.cohort);
  expect(data.classBlock).toBe(expected.classBlock);
  expect(data.groups).toHaveLength(expected.groups);
  expect(
    data.groups.filter((group) => group.kind === "mandatory"),
  ).toHaveLength(expected.mandatoryGroups);
  expect(data.groups.filter((group) => group.kind === "elective")).toHaveLength(
    expected.electiveGroups,
  );
  expect(data.courses).toHaveLength(expected.courses);
  expect(data.courses.filter((course) => course.conditionOnly)).toHaveLength(
    expected.conditionOnly,
  );
  expect(data.courses.filter((course) => course.credits === null)).toHaveLength(
    expected.nullCredits,
  );
  expect([
    data.minimumCredits,
    data.mandatoryCredits,
    data.electiveCredits,
    data.freeElectiveCredits,
    data.minimumGpa,
  ]).toEqual(expected.thresholds);
}

function findSource(predicate: (data: GraduationData) => boolean) {
  const data = parsed.find(predicate);
  expect(data).toBeDefined();
  return data!;
}

beforeAll(async () => {
  if (!hasAuditSources) return;
  const files = (await readdir(auditDirectory))
    .filter((file) => /\.xlsx?$/i.test(file))
    .sort();
  for (const file of files) {
    const workbook = await parseGraduation(
      await readFile(resolve(auditDirectory, file)),
      file,
    );
    parsed.push(...workbook);
  }
}, 60_000);

describe.skipIf(!hasAuditSources)("graduation source workbook parser audit", () => {
  it("parses every supplied workbook and every populated K27/K29 sheet", () => {
    expect(new Set(parsed.map((data) => data.sourceWorkbook)).size).toBe(9);
    expect(parsed).toHaveLength(15);
    for (const data of parsed)
      expect(graduationSchema.safeParse(data).success, data.sourceSheet).toBe(
        true,
      );
  });

  it("preserves the supplied metadata, group counts, course counts, and thresholds", () => {
    assertMetadata(
      findSource((data) => data.sourceWorkbook.startsWith("3_")),
      {
        cohort: "K28",
        classBlock: "71K28CNTT_7480201-03",
        groups: 5,
        mandatoryGroups: 1,
        electiveGroups: 4,
        courses: 88,
        conditionOnly: 20,
        nullCredits: 0,
        thresholds: [126, 105, 21, 0, 2],
      },
    );
    assertMetadata(
      findSource(
        (data) =>
          data.sourceWorkbook.startsWith("4_") && data.groups.length === 5,
      ),
      {
        cohort: "K28",
        classBlock: "71K28CNTT",
        groups: 5,
        mandatoryGroups: 1,
        electiveGroups: 4,
        courses: 87,
        conditionOnly: 20,
        nullCredits: 0,
        thresholds: [126, 87, 39, 0, 2],
      },
    );
    assertMetadata(
      findSource(
        (data) =>
          data.sourceWorkbook.startsWith("4_") && data.groups.length === 4,
      ),
      {
        cohort: "K28",
        classBlock: "71K28CNTT",
        groups: 4,
        mandatoryGroups: 1,
        electiveGroups: 3,
        courses: 87,
        conditionOnly: 20,
        nullCredits: 0,
        thresholds: [126, 87, 39, 0, 2],
      },
    );
    for (const prefix of ["5_", "6_"])
      assertMetadata(
        findSource((data) => data.sourceWorkbook.startsWith(prefix)),
        {
          cohort: "K28",
          classBlock:
            prefix === "5_" ? "71K28CNTT_7480201-02" : "71K28CNTT_7480201-04",
          groups: 5,
          mandatoryGroups: 1,
          electiveGroups: 4,
          courses: 88,
          conditionOnly: 20,
          nullCredits: 0,
          thresholds: [126, 105, 21, 0, 2],
        },
      );
    // K26 (2026-10-23): column A is 1 px wide and holds stale group names on course rows; the
    // visible group rows are B:J. Before the fix each elective group came out twice and 3 courses
    // were lost (7 groups, 91 and 92 courses).
    for (const [courses, groups] of [
      [93, [["Nhóm bắt buộc", 82, 37], ["Nhóm tự chọn TC118", 18, 10], ["Nhóm tự chọn TC124 và nhóm tự chọn TC206", 30, 30], ["Nhóm tự chọn TC004", 4, 16]]],
      [95, [["Nhóm bắt buộc", 82, 37], ["Nhóm tự chọn TC118", 18, 10], ["Nhóm tự chọn TC230", 30, 32], ["Nhóm tự chọn TC004", 4, 16]]],
    ] as const) {
      const data = findSource(
        (candidate) =>
          fold(candidate.sourceWorkbook).startsWith("chuan xet") && candidate.courses.length === courses,
      );
      assertMetadata(data, {
        cohort: "K26",
        classBlock: "K26T-CN",
        groups: 4,
        mandatoryGroups: 1,
        electiveGroups: 3,
        courses,
        conditionOnly: 21,
        nullCredits: 0,
        thresholds: [130, 82, 48, 0, 2],
      });
      expect(data.groups.map((group) => [group.name, group.minimumCredits,
        data.courses.filter((course) => course.groupId === group.id).length])).toEqual(groups);
      expect(data.courses.find((course) => course.code === "DVL0020")?.groupId).toBe(data.groups[0]!.id);
    }
    const major = findSource((data) => fold(data.sourceWorkbook).startsWith("chuan xet") && data.courses.length === 93);
    expect(major.courses.find((course) => course.code === "DIT0091")?.alternativeCodes).toEqual(["71ITDS30103"]);
    expect(major.courses.find((course) => course.code === "DIT0210")?.alternativeCodes).toEqual(["71ITNW30403", "71ITNW40803"]);
    expect(major.courses.find((course) => course.code === "DIT0530")?.alternativeCodes).toBeUndefined();
  });

  it("preserves each K27 sheet's counts, thresholds, and blank graduation credits", () => {
    const expected = new Map([
      ["K27T", ["71K27CNTT", 95, 82, 45]],
      ["K27T-ANM", ["71K27CNTT_7480201-01", 96, 106, 21]],
      ["K27T-CNDL", ["71K27CNTT_7480201-02", 96, 106, 21]],
      ["K27T-CNPM", ["71K27CNTT_7480201-03", 96, 106, 21]],
      ["K27T-TTNT", ["71K27CNTT_7480201-04", 96, 106, 21]],
    ] as const);
    for (const [
      sheet,
      [classBlock, courses, mandatory, elective],
    ] of expected) {
      const data = findSource(
        (candidate) =>
          candidate.sourceWorkbook.startsWith("K27CNTT") &&
          candidate.sourceSheet === sheet,
      );
      assertMetadata(data, {
        cohort: "K27",
        classBlock,
        groups: 4,
        mandatoryGroups: 1,
        electiveGroups: 3,
        courses,
        conditionOnly: 18,
        nullCredits: 4,
        thresholds: [127, mandatory, elective, 0, 2],
      });
      expect(
        data.courses
          .filter((course) => course.credits === null)
          .map((course) => course.code),
      ).toEqual(["71NAD110013", "71NAD210022", "71NAD310032", "71NAD410044"]);
    }
  });

  it("marks starred courses as condition-only and keeps personal result columns out of the model", () => {
    for (const data of parsed) {
      const starred = data.courses.filter((course) =>
        course.name.includes("*"),
      );
      expect(
        starred.every((course) => course.conditionOnly),
        data.sourceSheet,
      ).toBe(true);
      expect(
        data.courses
          .filter((course) => course.conditionOnly)
          .every((course) => course.name.includes("*")),
        data.sourceSheet,
      ).toBe(true);
      if (data.sourceNotes.length)
        expect(data.sourceNotes[0]).toContain("không được dùng");
    }
    expect(parsed.filter((data) => data.sourceNotes.length)).toHaveLength(14);
  });

  it("keeps repeated TC102 groups distinct on the K29 data-sheet", () => {
    const data = findSource(
      (candidate) =>
        candidate.sourceWorkbook.startsWith("K29CNTT") &&
        candidate.sourceSheet === "CNDL",
    );
    const groups = data.groups.filter((group) => group.name.includes("TC102"));
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.id)).size).toBe(2);
    expect(
      groups.every((group) =>
        data.courses.some((course) => course.groupId === group.id),
      ),
    ).toBe(true);
  });
});

function cells(values: Record<number, string>): unknown[] {
  const row = Array(12).fill("");
  for (const [index, value] of Object.entries(values)) row[Number(index)] = value;
  return row;
}

const syntheticRows = [
  cells({ 1: "Tiêu chuẩn xét tốt nghiệp" }),
  cells({ 1: "Tiêu chuẩn", 4: "TC-SYN-01 - Chuẩn tốt nghiệp" }),
  cells({ 1: "Khối lớp", 4: "K29" }),
  cells({ 1: "Ngành đào tạo", 4: "Công nghệ thông tin - Chuyên ngành: Dữ liệu" }),
  cells({ 1: "Hệ đào tạo", 4: "Chính quy" }),
  cells({ 1: "Khoa đào tạo", 4: "Công nghệ thông tin" }),
  cells({ 1: "Số tín chỉ tích lũy tối thiểu", 8: "126" }),
  cells({ 1: "Tổng tín chỉ bắt buộc", 8: "105" }),
  cells({ 1: "Tổng tín chỉ tối thiểu nhóm bắt buộc tự chọn", 8: "21" }),
  cells({ 1: "Tổng số tín chỉ tự chọn tự do", 8: "0" }),
  cells({ 1: "Điểm trung bình tích lũy tối thiểu", 8: "2" }),
  cells({ 1: "Ghi chú: các cột kết quả cá nhân chỉ để tham khảo", 11: "personal-result" }),
  cells({ 2: "Mã MH", 4: "Tên môn học" }),
  cells({ 1: "Nhóm bắt buộc", 10: "3" }),
  cells({ 2: "71AAA10001", 4: "Môn bắt buộc", 10: "3" }),
  cells({ 2: "71BBB10002", 4: "Môn điều kiện (*)", 10: "" }),
];

describe("graduation synthetic parser cases", () => {
  it("parses metadata, a mandatory group, a starred condition-only course, and blank credits", () => {
    const data = parseSheet({
      workbook: "synthetic.xlsx",
      sheet: "Sheet",
      rows: syntheticRows,
    });
    expect(data).not.toBeNull();
    const parsed = data!;

    expect(parsed).toMatchObject({
      cohortCode: "K29",
      standardCode: "TC-SYN-01",
      classBlock: "K29",
      major: "Công nghệ thông tin",
      specialty: "Dữ liệu",
      minimumCredits: 126,
      mandatoryCredits: 105,
      electiveCredits: 21,
      freeElectiveCredits: 0,
      minimumGpa: 2,
      gpaScale: 4,
    });
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]).toMatchObject({ kind: "mandatory", minimumCredits: 3 });
    expect(parsed.courses).toHaveLength(2);
    expect(parsed.courses[1]).toMatchObject({
      code: "71BBB10002",
      credits: null,
      conditionOnly: true,
    });
    expect(parsed.sourceNotes).toHaveLength(1);
  });

  it("rejects a course before its group and malformed or oversized workbook bytes", async () => {
    const withoutGroup = syntheticRows.filter(
      (row) => row[1] !== "Nhóm bắt buộc",
    );
    expect(() =>
      parseSheet({ workbook: "synthetic.xlsx", sheet: "Sheet", rows: withoutGroup }),
    ).toThrow("course_without_group");
    await expect(
      parseGraduation(Buffer.from("not an xlsx"), "bad.xlsx"),
    ).rejects.toMatchObject({ code: "invalid_workbook" });
    await expect(
      parseGraduation(Buffer.alloc(5 * 1024 * 1024 + 1), "large.xlsx"),
    ).rejects.toMatchObject({ code: "invalid_workbook" });
  });

  it("reads the K26 layout: stale group names in column A, old / new codes, a code twice in a group", () => {
    const rows = [
      ...syntheticRows.slice(0, 13),
      cells({ 0: "Nhóm bắt buộc", 10: "82" }),
      cells({ 0: "1", 2: "DIT0091 / 71ITDS30103", 4: "Các nền tảng phát triển phần mềm", 10: "3" }),
      // Column A (1 px wide) holds the next group's name on the last course of this group.
      cells({ 0: "Nhóm tự chọn TC118", 1: "2", 2: "DVL0020", 4: "Vật lý đại cương 2", 10: "2" }),
      cells({ 0: "1", 1: "Nhóm tự chọn TC118", 10: "18" }),
      cells({ 0: "2", 2: "DIT0110 / 71ITSE30403", 4: "Lập trình ứng dụng Java", 10: "3" }),
      cells({ 0: "3", 2: "DIT0530 / 71ITSE 30403", 4: "Quản lý và phát triển các hệ thống thông tin", 10: "3" }),
      cells({ 0: "4", 2: "DIT0210 / 71ITNW30403", 4: "Lập trình hệ thống nhúng và mạng kết nối vạn vật", 10: "3" }),
      cells({ 0: "Nhóm tự chọn TC004", 2: "DIT0210 71ITNW40803", 4: "Lập trình Hệ thống nhúng và IOT", 10: "3" }),
      cells({ 0: "1", 1: "Nhóm tự chọn TC004", 10: "4" }),
      cells({ 0: "2", 2: "DGT0010", 4: "Giáo dục thể chất 1 (*)", 10: "2" }),
    ];
    const data = parseSheet({ workbook: "k26.xls", sheet: "Sheet", rows })!;
    expect(data.groups.map((group) => [group.name, group.kind, group.minimumCredits])).toEqual([
      ["Nhóm bắt buộc", "mandatory", 82], ["Nhóm tự chọn TC118", "elective", 18], ["Nhóm tự chọn TC004", "elective", 4],
    ]);
    const [mandatory, tc118, tc004] = data.groups.map((group) => group.id);
    expect(data.courses.map((course) => [course.groupId, course.code, course.alternativeCodes])).toEqual([
      [mandatory, "DIT0091", ["71ITDS30103"]],
      [mandatory, "DVL0020", undefined],
      [tc118, "DIT0110", ["71ITSE30403"]],
      [tc118, "DIT0530", undefined],
      [tc118, "DIT0210", ["71ITNW30403", "71ITNW40803"]],
      [tc004, "DGT0010", undefined],
    ]);
    expect(data.sourceNotes).toEqual([
      expect.stringContaining("không được dùng"),
      "3 học phần ghi nhiều mã (mã cũ / mã mới): mã đầu là mã chính, các mã sau cũng được dùng khi đối chiếu bảng điểm.",
      "Dòng 16, 21 vừa có tên nhóm vừa có học phần: đã đọc là học phần của nhóm trước, nhóm mới bắt đầu từ dòng chỉ có tên nhóm.",
      "Mã ghi hai lần trong cùng nhóm được gộp thành một học phần: DIT0210 (dòng 20 và 21).",
      "Đã bỏ mã thay thế trùng với học phần khác, hãy kiểm tra biểu mẫu: 71ITSE30403 ở DIT0530 (đã ghi cho DIT0110).",
    ]);
  });

  it("splits a code cell into its codes", () => {
    expect(courseCodes("DIT0091 / 71ITDS30103")).toEqual(["DIT0091", "71ITDS30103"]);
    expect(courseCodes("DIT0160 71ITSE41003")).toEqual(["DIT0160", "71ITSE41003"]);
    expect(courseCodes("DIT0530 / 71ITSE 30403")).toEqual(["DIT0530", "71ITSE30403"]);
    expect(courseCodes("DIT0320 / 71ITNW40903 / 71ITDS40503")).toEqual(["DIT0320", "71ITNW40903", "71ITDS40503"]);
    expect(courseCodes("71AAA10001")).toEqual(["71AAA10001"]);
    expect(courseCodes("DIT0091 / dit0091")).toEqual(["DIT0091"]);
  });

  it.each([4, 10] as const)("reads an explicit GPA scale %s from the source label", (gpaScale) => {
    const rows = syntheticRows.map((row) => [...row]);
    rows[10]![1] = `Điểm trung bình tích lũy tối thiểu (Hệ ${gpaScale})`;
    rows[10]![8] = gpaScale === 4 ? "2" : "5.5";
    expect(parseSheet({ workbook: "synthetic.xlsx", sheet: "Sheet", rows }))
      .toMatchObject({ gpaScale, minimumGpa: gpaScale === 4 ? 2 : 5.5 });
  });

  it("defaults new and legacy standards to scale 4 and validates explicit overrides", () => {
    const data = parseSheet({ workbook: "synthetic.xlsx", sheet: "Sheet", rows: syntheticRows })!;
    expect(data.gpaScale).toBe(4);
    expect(warnings(data).some((warning) => warning.includes("thang điểm"))).toBe(false);
    const { gpaScale, ...legacy } = data;
    void gpaScale;
    expect(validateData(legacy)).toMatchObject({ minimumGpa: 2, gpaScale: 4 });
    expect(validateData({ ...legacy, gpaScale: null }).gpaScale).toBe(4);
    expect(() => validateData({ ...legacy, minimumGpa: 5.5 })).toThrow();
    expect(warnings({ ...legacy, minimumGpa: 5.5 }).some((warning) => warning.includes("vượt thang điểm"))).toBe(true);
    expect(validateData({ ...data, minimumGpa: 5.5, gpaScale: 10 }).gpaScale).toBe(10);
    expect(() => validateData({ ...data, minimumGpa: 5.5, gpaScale: 4 })).toThrow();
    expect(() => validateData({ ...data, gpaScale: 100 })).toThrow();
  });
});
