import { describe, expect, it } from "vitest";
import { applyLinkItems, batchProgress, batchPending, failureMessage, linkRows, noMatchCourses, skipReason, validateLinkRows, type CourseAiBatch, type CourseAiItem } from "./competency-ai";

const item = (patch: Partial<CourseAiItem>): CourseAiItem => ({
  index: 0, skillId: "s-web", skillName: "Lập trình web", groupId: "g-core", groupName: "Chuyên môn", hasProfile: true,
  isNewSkill: false, alreadyLinked: false, percent: null, reason: "Học phần dạy trực tiếp.", ...patch,
});

describe("link review", () => {
  const items = [
    item({ percent: 40 }),
    item({ index: 1, skillId: "s-team", skillName: "Làm việc nhóm", alreadyLinked: true, percent: 20 }),
    item({ index: 2, skillId: "s-docker", skillName: "Docker", hasProfile: false, groupId: null, groupName: null, percent: 30 }),
    item({ index: 3, skillId: null, skillName: "Kiểm thử API", hasProfile: false, isNewSkill: true, percent: 10 }),
  ];

  it("ticks catalog and linked skills with the AI percents, and leaves new skills to the admin", () => {
    expect(linkRows(items).map((row) => [row.skillName, row.checked, row.percent])).toEqual([
      ["Lập trình web", true, "40"], ["Làm việc nhóm", true, "20"], ["Docker", true, "30"], ["Kiểm thử API", false, "10"],
    ]);
    // A proposal made before 2026-10-20 has no percent: the rows start at 0.
    expect(linkRows([item({ percent: null })])[0]!.percent).toBe("0");
  });

  it("needs a group for a skill without a profile, a name for a new skill and a valid percent; applies at exactly 100%", () => {
    const rows = linkRows(items);
    const check = validateLinkRows(rows);
    expect(check).toMatchObject({ valid: false, canActivate: false, selected: 3, added: 2, total: 90 });
    expect(check.errors["row-2"]).toEqual(["Chọn nhóm năng lực."]);
    const fixed = rows.map((row) => row.key === "row-2" ? { ...row, groupId: "g-core" } : row.key === "row-3" ? { ...row, checked: true, skillName: "  " } : row);
    expect(validateLinkRows(fixed).errors["row-3"]).toEqual(["Nhập tên kỹ năng mới."]);
    const ready = fixed.map((row) => row.key === "row-3" ? { ...row, skillName: "Kiểm thử  API" } : row);
    expect(validateLinkRows(ready)).toMatchObject({ valid: true, canActivate: true, selected: 4, added: 3, total: 100 });
    expect(applyLinkItems(ready)).toEqual([
      { skillId: "s-web", skillName: "", groupId: null, percent: 40 },
      { skillId: "s-team", skillName: "", groupId: null, percent: 20 },
      { skillId: "s-docker", skillName: "", groupId: "g-core", percent: 30 },
      { skillId: null, skillName: "Kiểm thử API", groupId: "g-core", percent: 10 },
    ]);
    const wrong = ready.map((row) => row.key === "row-0" ? { ...row, percent: "120" } : row);
    expect(validateLinkRows(wrong)).toMatchObject({ valid: false, canActivate: false, errors: { "row-0": ["Nhập trọng số từ 0 đến 100."] } });
  });

  it("keeps a linked skill even unticked, refuses an empty selection and the same new name twice", () => {
    const linkedOnly = linkRows([item({ alreadyLinked: true, percent: 100 })]).map((row) => ({ ...row, checked: false }));
    expect(validateLinkRows(linkedOnly)).toMatchObject({ valid: true, canActivate: true, selected: 1, added: 0 });
    expect(validateLinkRows([]).valid).toBe(false);
    const twice = linkRows([item({ skillId: null, isNewSkill: true, hasProfile: false, skillName: "Kiểm thử API" }),
      item({ index: 1, skillId: null, isNewSkill: true, hasProfile: false, skillName: "kiem thu api" })]).map((row) => ({ ...row, checked: true }));
    expect(validateLinkRows(twice).errors["row-1"]).toEqual(["Kỹ năng này đã có ở dòng khác."]);
  });
});

describe("whole-program run", () => {
  const batch = (patch: Partial<CourseAiBatch>): CourseAiBatch => ({ id: "b1", createdAt: "2026-10-16T05:00:00.000Z", total: 10, queued: 2, processing: 1,
    completed: 6, failed: 1, cancelled: 0, applied: 0, ready: 5, items: [], ...patch });

  it("counts finished jobs and knows when it still runs", () => {
    expect(batchProgress(batch({}))).toEqual({ done: 7, percent: 70 });
    expect(batchPending(batch({}))).toBe(true);
    expect(batchPending(batch({ queued: 0, processing: 0 }))).toBe(false);
    expect(batchPending(null)).toBe(false);
    expect(batchProgress(batch({ total: 0, completed: 0, failed: 0 }))).toEqual({ done: 0, percent: 0 });
  });

  it("lists the courses no catalog skill fits that still have no link (2026-10-19)", () => {
    const entry = (courseCode: string, patch: Partial<CourseAiBatch["items"][number]>) =>
      ({ id: courseCode, courseCode, status: "completed" as const, errorCode: null, applied: false, itemCount: 0, ...patch });
    const run = batch({ items: [
      entry("A", {}),
      entry("B", { applied: true, noMatch: true }),
      entry("C", { itemCount: 2, noMatch: false }),
      // Every pick became unusable when the run was saved.
      entry("D", { applied: true, itemCount: 2, noMatch: true }),
      entry("E", { status: "processing" }),
      entry("F", {}),
    ] });
    const courses = [["A", "Tiếng Nhật 1", 0], ["B", "Kế toán tài chính 1", 0], ["C", "Lập trình web", 0], ["D", "Sinh học đại cương", 0], ["E", "Đang chạy", 0], ["F", "Đã liên kết thủ công", 2]]
      .map(([code, name, skillCount]) => ({ code: code as string, name: name as string, skillCount: skillCount as number }));
    expect(noMatchCourses(run, courses)).toEqual([{ code: "A", name: "Tiếng Nhật 1" }, { code: "B", name: "Kế toán tài chính 1" }, { code: "D", name: "Sinh học đại cương" }]);
  });

  it("explains failures and skipped courses in the admin's words", () => {
    expect(failureMessage("worker_timeout")).toContain("chưa xử lý xong");
    expect(failureMessage("other")).toBe("Chưa tạo được đề xuất.");
    expect(skipReason("course_already_linked")).toBe("đã có liên kết kỹ năng");
    expect(skipReason("x")).toBe("không lưu được");
  });
});
