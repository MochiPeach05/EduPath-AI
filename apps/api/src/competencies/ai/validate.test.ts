import { describe, expect, it } from "vitest";
import { buildCourseAiInput, buildCourseCheckInput } from "./prompt.js";
import { courseAiContextFromInput, courseCheckContextFromInput, normalizePercents, similarSkill, validateCourseAiOutput, validateCourseCheckOutput } from "./validate.js";
import { courseSource, GROUP_CORE, GROUP_SOFT, SKILL_DB, SKILL_DOCKER, SKILL_TEAM, SKILL_WEB } from "./test-fixture.js";

const contextFor = (mode: "links" | "weights" | "full", source = courseSource()) => {
  const context = courseAiContextFromInput(JSON.parse(JSON.stringify(buildCourseAiInput(source, mode))));
  if (!context) throw new Error("no context");
  return context;
};
const linkedSource = () => courseSource({ links: [
  { skillId: SKILL_WEB, name: "Lập trình web", groupId: GROUP_CORE, description: "", weight: 0 },
  { skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "", weight: 0 },
  { skillId: SKILL_TEAM, name: "Làm việc nhóm", groupId: GROUP_SOFT, description: "", weight: 0 }
] });

describe("normalizePercents", () => {
  it("returns whole percents that add up to exactly 100", () => {
    expect(normalizePercents([50, 30, 20])).toEqual([50, 30, 20]);
    expect(normalizePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(normalizePercents([60, 60])).toEqual([50, 50]);
    expect(normalizePercents([70, 20, 5])).toEqual([74, 21, 5]);
    expect(normalizePercents([0, 0])).toEqual([50, 50]);
    expect(normalizePercents([-5, 150, Number.NaN])).toEqual([0, 100, 0]);
    expect(normalizePercents([])).toEqual([]);
    for (const values of [[33.3, 33.3, 33.4], [7, 11, 13, 17], [99, 1, 1]]) {
      expect(normalizePercents(values).reduce((sum, value) => sum + value, 0)).toBe(100);
    }
  });
});

describe("validateCourseAiOutput", () => {
  it("links (v4): keeps known keys once, keeps the linked skill (0% when left out) and scales every percent to 100", () => {
    // Keys: S001 Lập trình web, S002 Thiết kế cơ sở dữ liệu (linked), S003 Làm việc nhóm, S004 Docker.
    const context = contextFor("links", courseSource({ links: [{ skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "", weight: 1 }] }));
    const result = validateCourseAiOutput({
      links: [
        { skillKey: "S001", groupKey: "G2", percent: 50, reason: "Học phần xây dựng ứng dụng S001 hoàn chỉnh." },
        { skillKey: "S001", groupKey: "G1", percent: 90, reason: "lặp" },
        { skillKey: "S099", groupKey: "G1", percent: 10, reason: "không có" },
        { skillKey: "S004", groupKey: "G1", percent: 20, reason: "Đóng gói bản triển khai bằng container." }
      ],
      newSkills: [
        { name: "Kỹ năng  kiểm thử API", groupKey: "G1", percent: 10, reason: "Học phần có phần kiểm thử API." },
        { name: "thiết kế cơ sở dữ liệu", groupKey: "G1", percent: 5, reason: "đã liên kết" }
      ]
    }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.items).toEqual([
      // A profile keeps its own group whatever the model wrote; the key in prose became the name.
      { skillId: SKILL_WEB, skillName: "Lập trình web", groupId: GROUP_CORE, hasProfile: true, isNewSkill: false, percent: 63, reason: "Học phần xây dựng ứng dụng Lập trình web hoàn chỉnh." },
      { skillId: SKILL_DOCKER, skillName: "Docker", groupId: GROUP_CORE, hasProfile: false, isNewSkill: false, percent: 25, reason: "Đóng gói bản triển khai bằng container." },
      { skillId: null, skillName: "Kiểm thử API", groupId: GROUP_CORE, hasProfile: false, isNewSkill: true, percent: 12, reason: "Học phần có phần kiểm thử API." },
      { skillId: SKILL_DB, skillName: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, hasProfile: true, isNewSkill: false, percent: 0, reason: "" }
    ]);
    expect(result.result.returned).toBe(6);
    expect(result.result.dropped).toBe(3);
    expect(result.result.modelTotal).toBe(80);
    // The model may weigh the linked skill itself.
    const weighed = validateCourseAiOutput({ links: [{ skillKey: "S002", groupKey: "G1", percent: 40, reason: "Thiết kế dữ liệu." }, { skillKey: "S001", groupKey: "G1", percent: 60, reason: "Trọng tâm." }], newSkills: [] }, context);
    expect(weighed.ok && weighed.result.items.map((item) => [item.skillName, item.percent])).toEqual([["Thiết kế cơ sở dữ liệu", 40], ["Lập trình web", 60]]);
  });

  it("links: an answer without percents (v3, queued before 2026-10-20) keeps null percents and lists the linked skills", () => {
    const context = contextFor("links", courseSource({ links: [{ skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "", weight: 1 }] }));
    const result = validateCourseAiOutput({ links: [{ skillKey: "S001", groupKey: "G1", reason: "Trọng tâm." }], newSkills: [] }, context);
    expect(result.ok && result.result.items.map((item) => [item.skillName, item.percent])).toEqual([["Lập trình web", null], ["Thiết kế cơ sở dữ liệu", null]]);
    expect(result.ok && result.result.modelTotal).toBeNull();
  });

  it("links: an empty answer is a valid empty proposal; only bad items fail the job", () => {
    const context = contextFor("links");
    expect(validateCourseAiOutput({ links: [], newSkills: [] }, context)).toMatchObject({ ok: true, result: { items: [] } });
    expect(validateCourseAiOutput({ links: [{ skillKey: "S099", groupKey: "G1", reason: "x" }], newSkills: [] }, context))
      .toEqual({ ok: false, reason: "no_valid_items", path: "" });
    expect(validateCourseAiOutput({ links: [], newSkills: [], extra: 1 }, context)).toMatchObject({ ok: false, reason: "schema" });
  });

  it("weights: covers every linked skill once and scales the model's numbers to exactly 100", () => {
    const context = contextFor("weights", linkedSource());
    // Keys follow name order: S001 Làm việc nhóm, S002 Lập trình web, S003 Thiết kế cơ sở dữ liệu.
    const result = validateCourseAiOutput({ weights: [
      { skillKey: "S002", percent: 60, reason: "Trọng tâm của học phần." },
      { skillKey: "S003", percent: 30, reason: "Dùng cơ sở dữ liệu trong đồ án." },
      { skillKey: "S003", percent: 99, reason: "lặp" }
    ] }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.items.map((item) => [item.skillName, item.percent])).toEqual([
      ["Làm việc nhóm", 0], ["Lập trình web", 67], ["Thiết kế cơ sở dữ liệu", 33]
    ]);
    expect(result.result.modelTotal).toBe(90);
    expect(result.result.items.reduce((sum, item) => sum + (item.percent ?? 0), 0)).toBe(100);
    expect(validateCourseAiOutput({ weights: [{ skillKey: "S099", percent: 100, reason: "x" }] }, context))
      .toEqual({ ok: false, reason: "no_valid_items", path: "" });
  });

  it("full: keeps the chosen skills with percents that add up to 100", () => {
    const context = contextFor("full");
    const result = validateCourseAiOutput({ links: [
      { skillKey: "S001", groupKey: "G1", percent: 70, reason: "Trọng tâm." },
      { skillKey: "S003", groupKey: "G1", percent: 20, reason: "Triển khai." },
      { skillKey: "S004", groupKey: "G2", percent: 20, reason: "Làm nhóm." }
    ] }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.items.map((item) => [item.skillName, item.percent, item.hasProfile])).toEqual([
      ["Lập trình web", 64, true], ["Làm việc nhóm", 18, true], ["Docker", 18, false]
    ]);
    expect(validateCourseAiOutput({ links: [{ skillKey: "S001", groupKey: "G1", percent: 100, reason: "x" }], newSkills: [] }, context))
      .toMatchObject({ ok: false, reason: "schema" });
  });

  it("rejects a malformed stored input", () => {
    expect(courseAiContextFromInput(null)).toBeNull();
    expect(courseAiContextFromInput({ mode: "links", skills: [{ key: "S001" }], groups: [], linked: [] })).toBeNull();
    expect(courseAiContextFromInput({ mode: "other", skills: [], groups: [], linked: [] })).toBeNull();
    // "skills" proposals (the removed "Thêm kỹ năng (AI)") are no longer a mode this server runs.
    expect(courseAiContextFromInput({ mode: "skills", skills: [], groups: [], linked: [] })).toBeNull();
  });
});

describe("near-duplicate new skills (v5, 2026-10-22: hợp nhất các kỹ năng)", () => {
  const catalog = ["Lập trình hệ thống nhúng và IoT (ESP32)", "Python", "SQL", "Quản trị cơ sở dữ liệu SQL Server", "Phân tích dữ liệu",
    "Lập trình Java", "Lập trình C#", "Kiểm thử", "Web security"].map((name) => ({ name }));
  const match = (name: string) => similarSkill(name, catalog)?.name ?? null;
  it("maps a variant of a catalog skill to that skill", () => {
    expect(match("Hệ thống nhúng IoT")).toBe("Lập trình hệ thống nhúng và IoT (ESP32)");
    expect(match("Lập trình Python")).toBe("Python");
    expect(match("Python nâng cao")).toBe("Python");
    expect(match("SQL Server")).toBe("Quản trị cơ sở dữ liệu SQL Server");
    expect(match("Phân tích dữ liệu lớn")).toBe("Phân tích dữ liệu");
    expect(match("Kiểm thử phần mềm")).toBe("Kiểm thử");
  });
  it("keeps a really new skill new", () => {
    expect(match("Thiết kế trải nghiệm người dùng")).toBeNull();
    expect(match("Tiếp thị trực tuyến")).toBeNull();
    expect(match("Lập trình Go")).toBeNull();
    expect(match("Phát triển ứng dụng web với React và Node.js")).toBeNull();
    expect(match("")).toBeNull();
  });
});

describe("the second pass (comp-check-v1, 2026-10-27)", () => {
  const item = (skillId: string | null, skillName: string, percent: number, reason: string) =>
    ({ skillId, skillName, groupId: GROUP_CORE, hasProfile: true, isNewSkill: false, percent, reason });
  const check = (mode: "links" | "full", entries: { key: string; item: ReturnType<typeof item>; linked: boolean }[]) => {
    const input = buildCourseCheckInput({ mode, promptVersion: "comp-course-v6", course: ["Mã: X"], groups: [],
      entries: entries.map((entry) => ({ ...entry, description: "" })) });
    const context = courseCheckContextFromInput(JSON.parse(JSON.stringify(input)));
    if (!context) throw new Error("no context");
    return context;
  };
  const proposal = [
    { key: "S010", item: item(SKILL_DB, "Quản trị cơ sở dữ liệu", 35, "Quản trị hệ quản trị."), linked: false },
    { key: "S020", item: item(SKILL_WEB, "Giải bài toán tối ưu hóa", 25, "Tối ưu."), linked: false },
    { key: "S030", item: item(SKILL_TEAM, "Tư duy phản biện và giải quyết vấn đề", 20, "Phân tích."), linked: false },
    { key: "S040", item: item(SKILL_DOCKER, "Mã hóa và bảo mật dữ liệu", 20, "Bảo mật."), linked: false }
  ];

  it("drops what the check drops, records why, keeps the rest at the check's percents scaled to 100", () => {
    const checked = validateCourseCheckOutput({ links: [
      { skillKey: "S010", keep: true, percent: 60, reason: "Nội dung chính." },
      { skillKey: "S020", keep: false, percent: 0, reason: "S020 là tối ưu truy vấn, không phải tối ưu hóa." },
      { skillKey: "S030", keep: false, percent: 0, reason: "Kỹ năng chung." },
      { skillKey: "S040", keep: true, percent: 30, reason: "Bảo mật cơ sở dữ liệu." },
      { skillKey: "S999", keep: true, percent: 50, reason: "Khóa lạ bị bỏ qua." }
    ] }, check("full", proposal));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.result.items.map((entry) => [entry.skillName, entry.percent, entry.reason])).toEqual([
      ["Quản trị cơ sở dữ liệu", 67, "Quản trị hệ quản trị."], ["Mã hóa và bảo mật dữ liệu", 33, "Bảo mật."]]);
    expect(checked.result.check).toEqual({ proposed: 4, removed: [
      { skillName: "Giải bài toán tối ưu hóa", reason: "Giải bài toán tối ưu hóa là tối ưu truy vấn, không phải tối ưu hóa." },
      { skillName: "Tư duy phản biện và giải quyết vấn đề", reason: "Kỹ năng chung." }] });
    expect([checked.result.mode, checked.result.dropped, checked.result.returned, checked.result.modelTotal]).toEqual(["full", 2, 5, 90]);
  });

  it("keeps a skill the answer left out at the first pass's percent; dropping all is a valid empty proposal", () => {
    const partial = validateCourseCheckOutput({ links: [{ skillKey: "S010", keep: false, percent: 0, reason: "Không." }] }, check("full", proposal));
    expect(partial.ok && partial.result.items.map((entry) => [entry.skillName, entry.percent])).toEqual([
      ["Giải bài toán tối ưu hóa", 38], ["Tư duy phản biện và giải quyết vấn đề", 31], ["Mã hóa và bảo mật dữ liệu", 31]]);
    const none = validateCourseCheckOutput({ links: proposal.map((entry) => ({ skillKey: entry.key, keep: false, percent: 0, reason: "Không phải nội dung chính." })) }, check("full", proposal));
    expect(none.ok && [none.result.items, none.result.modelTotal, none.result.check?.removed.length]).toEqual([[], null, 4]);
  });

  it("links: a dropped linked skill stays at 0%, so the review still lists every linked skill", () => {
    const entries = [{ ...proposal[0]!, linked: true }, proposal[1]!];
    const checked = validateCourseCheckOutput({ links: [
      { skillKey: "S010", keep: false, percent: 0, reason: "Trái với học phần." }, { skillKey: "S020", keep: true, percent: 80, reason: "Đúng." }] }, check("links", entries));
    expect(checked.ok && checked.result.items.map((entry) => [entry.skillName, entry.percent])).toEqual([["Quản trị cơ sở dữ liệu", 0], ["Giải bài toán tối ưu hóa", 100]]);
    const onlyLinked = validateCourseCheckOutput({ links: [{ skillKey: "S010", keep: false, percent: 0, reason: "Không." }] }, check("links", [{ ...proposal[0]!, linked: true }]));
    expect(onlyLinked.ok && onlyLinked.result.items.map((entry) => entry.percent)).toEqual([0]);
  });

  it("fails a malformed answer and reads only a check input back", () => {
    expect(validateCourseCheckOutput({ links: [{ skillKey: "S010", percent: 10, reason: "" }] }, check("full", proposal)).ok).toBe(false);
    expect(validateCourseCheckOutput({ checks: [] }, check("full", proposal)).ok).toBe(false);
    expect(courseCheckContextFromInput(JSON.parse(JSON.stringify(buildCourseAiInput(courseSource(), "full"))))).toBeNull();
    expect(courseCheckContextFromInput({ stage: "check", mode: "full", entries: [{ key: "S1", linked: false, item: { skillName: "x" } }] })).toBeNull();
    expect(courseCheckContextFromInput({ stage: "check", mode: "weights", entries: [] })).toBeNull();
  });
});
