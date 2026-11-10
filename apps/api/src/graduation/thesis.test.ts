import { describe, expect, it } from "vitest";
import type { GradCourseState, GraduationCourseRow, GraduationGroupEvaluation } from "./evaluation.js";
import { followedThesisWay, startsReplacementPath, thesisChoice, thesisNoun, thesisOption, thesisWay, withoutThesisGpaReason } from "./thesis.js";

// Public K28/K29 course codes and names only; no student record.

const course = (code: string, name: string, credits: number | null, state: GradCourseState = "not_taken"): GraduationCourseRow => ({
  code, name, credits, conditionOnly: false, groupId: "row-92", state, inferred: false, attempts: state === "not_taken" ? 0 : 1,
  score10: null, score4: null, letter: null, term: null,
});

const group = (courses: GraduationCourseRow[], extra: Partial<GraduationGroupEvaluation> = {}): GraduationGroupEvaluation => ({
  id: "row-92", name: "Nhóm tự chọn TC306", label: "Nhóm tự chọn TC306", kind: "elective", code: "TC306", curriculumElectiveCode: "TC406",
  unit: "TC", required: 6, lower: 0, upper: 0, remaining: 6, status: "fail", minimumCredits: 6, accumulatedCredits: 0,
  courseCount: courses.length, passedCount: 0, courses, ...extra,
});

/** K29 "Nhóm tự chọn TC306" (all three specialties) with the given course states. */
const k29 = (states: Record<string, GradCourseState> = {}) => group([
  course("71ITGR40206", "Đồ án Tốt nghiệp", 6, states["71ITGR40206"]),
  course("71ITGR40203", "Chuyên đề Tốt nghiệp 1", 3, states["71ITGR40203"]),
  course("71ITGR40303", "Chuyên đề Tốt nghiệp 2", 3, states["71ITGR40303"]),
  course("71ITIS30403", "Quản lý và phát triển các hệ thống thông tin", 3, states["71ITIS30403"]),
  course("71ITIS30603", "Chuyên đề Tối ưu hóa máy tìm kiếm", 3, states["71ITIS30603"]),
]);

const codes = (rows: readonly GraduationCourseRow[]) => rows.map((row) => row.code);

describe("thesisOption", () => {
  it("finds Đồ án Tốt nghiệp in K29 Nhóm tự chọn TC306 and keeps every other course, in standard order, as a replacement", () => {
    const option = thesisOption(k29())!;
    expect(option.thesis.code).toBe("71ITGR40206");
    expect(codes(option.replacements)).toEqual(["71ITGR40203", "71ITGR40303", "71ITIS30403", "71ITIS30603"]);
    expect(option.path).toBe("not_started");
    expect(thesisNoun(option.thesis)).toBe("đồ án tốt nghiệp");
  });

  it("finds Khóa luận tốt nghiệp in K28 Nhóm tự chọn TC306_Tự chọn tốt nghiệp", () => {
    const k28 = group([
      course("71ITGR40203", "Chuyên đề Tốt nghiệp 1", 3),
      course("71ITGR40106", "Khóa luận tốt nghiệp", 6),
      course("71ITGR40303", "Chuyên đề Tốt nghiệp 2", 3),
      course("71ITIS30403", "Quản lý và phát triển các hệ thống thông tin", 3),
    ], { name: "Nhóm tự chọn TC306_Tự chọn tốt nghiệp", label: "Nhóm tự chọn TC306_Tự chọn tốt nghiệp", code: null });
    const option = thesisOption(k28)!;
    expect(option.thesis.code).toBe("71ITGR40106");
    expect(codes(option.replacements)).toEqual(["71ITGR40203", "71ITGR40303", "71ITIS30403"]);
    expect(thesisNoun(option.thesis)).toBe("khóa luận tốt nghiệp");
  });

  it("folds Vietnamese names: decomposed marks, capitals, Đ, old-style tone marks and extra spaces", () => {
    const names = [
      "Đồ án Tốt nghiệp".normalize("NFD"), "ĐỒ ÁN TỐT NGHIỆP", "Đồ  án  tốt   nghiệp", "Đồ án tốt nghiệp (Công nghệ phần mềm)",
      "Khoá luận tốt nghiệp", "KHÓA LUẬN TỐT NGHIỆP".normalize("NFD"), "Do an tot nghiep",
    ];
    for (const name of names) {
      const option = thesisOption(group([course("71ITGR40203", "Chuyên đề Tốt nghiệp 1", 3), course("71ITGR40206", name, 6)]));
      expect({ name, thesis: option?.thesis.code }).toEqual({ name, thesis: "71ITGR40206" });
    }
    expect(thesisNoun({ name: "KHOÁ LUẬN TỐT NGHIỆP".normalize("NFD") })).toBe("khóa luận tốt nghiệp");
    expect(thesisNoun({ name: "ĐỒ ÁN TỐT NGHIỆP" })).toBe("đồ án tốt nghiệp");
  });

  it("is null for a group without a thesis course", () => {
    const tc209 = group([
      course("71ITSE30603", "Phát triển ứng dụng di động", 3), course("71ITIS30203", "Hệ quản trị cơ sở dữ liệu", 3),
    ], { name: "Nhóm tự chọn TC209", label: "Nhóm tự chọn TC209", code: "TC209" });
    expect(thesisOption(tc209)).toBeNull();
    // Neither a Chuyên đề Tốt nghiệp, an internship project nor a specialty project is the thesis.
    for (const name of ["Chuyên đề Tốt nghiệp 1", "Đồ án thực tập", "Đồ án chuyên ngành", "Thực tập tốt nghiệp", "Đồ án tốt nghiệpx"]) {
      expect({ name, option: thesisOption(group([course("71ITXX40006", name, 6)])) }).toEqual({ name, option: null });
    }
  });

  it("is null when the thesis course alone does not complete the group (fewer or unknown credits, no requirement)", () => {
    expect(thesisOption(group([course("71ITGR40203", "Đồ án tốt nghiệp", 3), course("71ITIS30403", "Quản lý và phát triển các hệ thống thông tin", 3)]))).toBeNull();
    expect(thesisOption(group([course("71ITGR40206", "Đồ án Tốt nghiệp", null)]))).toBeNull();
    expect(thesisOption(group([course("71ITGR40206", "Đồ án Tốt nghiệp", 6)], { required: null, remaining: null, status: "unknown" }))).toBeNull();
    // More credits than required still complete the group.
    expect(thesisOption(group([course("71ITGR40208", "Đồ án Tốt nghiệp", 8)]))?.thesis.code).toBe("71ITGR40208");
  });

  it("only applies to an elective group that is not passed", () => {
    expect(thesisOption({ ...k29(), kind: "mandatory", unit: "môn", required: 5, remaining: 5 })).toBeNull();
    expect(thesisOption({ ...k29({ "71ITGR40206": "passed" }), status: "pass", lower: 6, upper: 6, remaining: null })).toBeNull();
    expect(thesisOption({ ...k29({ "71ITGR40203": "graded_unknown" }), status: "unknown" })?.path).toBe("replacement");
  });

  it("takes the first thesis course in standard order; a later one is a replacement", () => {
    const option = thesisOption(group([
      course("71ITGR40203", "Chuyên đề Tốt nghiệp 1", 3), course("71ITGR40106", "Khóa luận tốt nghiệp", 6), course("71ITGR40206", "Đồ án Tốt nghiệp", 6),
    ]))!;
    expect(option.thesis.code).toBe("71ITGR40106");
    expect(codes(option.replacements)).toEqual(["71ITGR40203", "71ITGR40206"]);
  });

  it("is not_started until the thesis or a replacement course is under way (a failed attempt does not count)", () => {
    expect(thesisOption(k29())!.path).toBe("not_started");
    expect(thesisOption(k29({ "71ITGR40203": "failed" }))!.path).toBe("not_started");
    expect(thesisOption(k29({ "71ITGR40206": "failed" }))!.path).toBe("not_started");
    expect(thesisOption(k29({ "71ITGR40206": "graded_unknown" }))!.path).toBe("not_started");
  });

  it("is replacement once another course of the group is passed, exempt, in progress or graded", () => {
    for (const state of ["passed", "exempt", "in_progress", "graded_unknown"] as const) {
      expect({ state, path: thesisOption(k29({ "71ITGR40303": state }))!.path }).toEqual({ state, path: "replacement" });
    }
    expect(thesisOption(k29({ "71ITGR40206": "failed", "71ITGR40203": "passed" }))!.path).toBe("replacement");
  });

  it("is thesis_in_progress while the thesis course is in progress, whatever the other courses", () => {
    expect(thesisOption(k29({ "71ITGR40206": "in_progress" }))!.path).toBe("thesis_in_progress");
    expect(thesisOption(k29({ "71ITGR40206": "in_progress", "71ITGR40203": "passed" }))!.path).toBe("thesis_in_progress");
  });
});

describe("the way recommended and the way the student chose (user 2026-11-10: an internal setting, the student chooses)", () => {
  const others = ["71ITGR40203", "71ITGR40303", "71ITIS30403"];
  it("recommends by the cumulative GPA only when no way is taken (the rule itself is never shown)", () => {
    expect(thesisWay("not_started", { actual: 2.8, scale: 4 })).toBe("thesis");
    expect(thesisWay("not_started", { actual: 2.79, scale: 4 })).toBe("replacement");
    expect(thesisWay("not_started", { actual: 8.1, scale: 10 })).toBeNull();
    expect(thesisWay("not_started", null)).toBeNull();
    expect(thesisWay("replacement", { actual: 3.6, scale: 4 })).toBe("replacement");
    expect(thesisWay("thesis_in_progress", { actual: 2.1, scale: 4 })).toBe("thesis");
  });

  it("reads the student's choice from the transcript's path and their own courses of the group in the plan", () => {
    expect(thesisChoice("not_started", "71ITGR40206", others, new Set())).toBeNull();
    expect(thesisChoice("not_started", "71ITGR40206", others, new Set(["71itgr40206 "]))).toBe("thesis");
    expect(thesisChoice("not_started", "71ITGR40206", others, new Set(["71ITIS30403"]))).toBe("replacement");
    expect(thesisChoice("not_started", "71ITGR40206", others, new Set(["71ITGR40206", "71ITGR40303"]))).toBe("both");
    expect(thesisChoice("replacement", "71ITGR40206", others, new Set())).toBe("replacement");
    expect(thesisChoice("replacement", "71ITGR40206", others, new Set(["71ITGR40206"]))).toBe("both");
    expect(thesisChoice("thesis_in_progress", "71ITGR40206", others, new Set(["71ITINXXXXX"]))).toBe("thesis");
  });

  it("follows the student's choice over the recommendation, and no single way while they hold both", () => {
    expect(followedThesisWay("thesis", "replacement")).toBe("thesis");
    expect(followedThesisWay("replacement", "thesis")).toBe("replacement");
    expect(followedThesisWay(null, "replacement")).toBe("replacement");
    expect(followedThesisWay(null, null)).toBeNull();
    expect(followedThesisWay("both", "thesis")).toBeNull();
  });
});

describe("withoutThesisGpaReason (outputs written while the data gave the GPA behind the way)", () => {
  it("drops the sentences explaining the thesis way by the GPA or the threshold, keeps the rest", () => {
    expect(withoutThesisGpaReason("Bạn còn thiếu 6 TC của Nhóm tự chọn TC306. Vì điểm TB tích lũy của bạn là 2,45, dưới 2,80, hệ thống đề xuất học Chuyên đề Tốt nghiệp 1 và Chuyên đề Tốt nghiệp 2. Hãy hỏi cố vấn học tập."))
      .toBe("Bạn còn thiếu 6 TC của Nhóm tự chọn TC306. Hãy hỏi cố vấn học tập.");
    expect(withoutThesisGpaReason("Với điểm trung bình tích lũy 3,10, bạn nên làm Đồ án tốt nghiệp. Hoàn thành tốt Kiểm thử phần mềm."))
      .toBe("Hoàn thành tốt Kiểm thử phần mềm.");
    expect(withoutThesisGpaReason("Điểm TB tích lũy từ 2,8 trở lên nên bạn làm khóa luận tốt nghiệp.")).toBeNull();
    // The GPA alone, the threshold-free advice and other numbers stay.
    expect(withoutThesisGpaReason("Điểm trung bình tích lũy của bạn là 2,80/4, đạt yêu cầu tối thiểu 2,00/4.")).toBe("Điểm trung bình tích lũy của bạn là 2,80/4, đạt yêu cầu tối thiểu 2,00/4.");
    expect(withoutThesisGpaReason("Hãy đăng ký Đồ án tốt nghiệp ở HK2 2026–2027.")).toBe("Hãy đăng ký Đồ án tốt nghiệp ở HK2 2026–2027.");
  });
});

describe("startsReplacementPath", () => {
  it("counts passed, exempt, in-progress and graded courses, never a failed or untaken one", () => {
    const states: GradCourseState[] = ["passed", "exempt", "failed", "in_progress", "graded_unknown", "not_taken"];
    expect(states.filter(startsReplacementPath)).toEqual(["passed", "exempt", "in_progress", "graded_unknown"]);
  });
});
