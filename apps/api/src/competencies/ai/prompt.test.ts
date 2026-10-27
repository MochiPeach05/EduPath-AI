import { describe, expect, it } from "vitest";
import { buildCourseAiInput, buildCourseCheckInput, COURSE_AI_PROMPT_VERSIONS, courseTypeLabel } from "./prompt.js";
import { courseSource, GROUP_CORE, GROUP_SOFT, SKILL_DB, SKILL_DOCKER, SKILL_TEAM, SKILL_WEB } from "./test-fixture.js";

type Schema = { properties: Record<string, { maxItems?: number; items: { properties: Record<string, { enum?: string[]; type?: string }> } }> };

describe("course AI prompt", () => {
  it("offers profiles by group, then career skills without a profile; links keeps the linked skills to weigh them (v4)", () => {
    const input = buildCourseAiInput(courseSource({ links: [{ skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "", weight: 0.5 }] }), "links");
    expect(input.groups).toEqual([{ key: "G1", id: GROUP_CORE, name: "Chuyên môn" }, { key: "G2", id: GROUP_SOFT, name: "Kỹ năng mềm" }]);
    expect(input.skills).toEqual([
      { key: "S001", id: SKILL_WEB, name: "Lập trình web", groupId: GROUP_CORE },
      { key: "S002", id: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE },
      { key: "S003", id: SKILL_TEAM, name: "Làm việc nhóm", groupId: GROUP_SOFT },
      { key: "S004", id: SKILL_DOCKER, name: "Docker", groupId: null }
    ]);
    expect(input.linked).toEqual([{ id: SKILL_DB, name: "Thiết kế cơ sở dữ liệu" }]);
    expect(input.promptVersion).toBe(COURSE_AI_PROMPT_VERSIONS.links);
    expect(input.user).toContain("S004 | Docker | kỹ năng nghề, chưa có nhóm");
    // The linked skill is marked, listed again with its weight, and must come back with a percent.
    expect(input.user).toContain("S002 | Thiết kế cơ sở dữ liệu | Chuyên môn | Mô hình hóa dữ liệu quan hệ | đã liên kết");
    expect(input.user).toContain("- S002 · Thiết kế cơ sở dữ liệu (trọng số hiện tại 50%)");
    expect(input.user.trimEnd().endsWith('Luôn đưa các kỹ năng đã liên kết ở mục [6] vào "links".')).toBe(true);
    expect(input.system).toContain("tổng percent của mọi mục trong \"links\" và \"newSkills\" bằng đúng 100");
    // The full mode (whole program, courses without links) still leaves linked skills out.
    expect(buildCourseAiInput(courseSource({ links: [{ skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "", weight: 0.5 }] }), "full").skills
      .map((entry) => entry.id)).not.toContain(SKILL_DB);
    expect(input.user).toContain("S001 | Lập trình web | Chuyên môn | Xây dựng giao diện và máy chủ web");
    expect(input.user).toContain("Mã: 71ITSE40103");
    // "BB" is written out: the model read the bare code as general education.
    expect(input.user).toContain("Loại: Bắt buộc · Khối kiến thức: Kiến thức chuyên ngành");
    expect(input.think).toBe(true);
    expect(input.options).toMatchObject({ num_ctx: 16384, num_predict: 8192 });
    expect(input.system).toContain("không chọn kỹ năng về chính trị và xã hội, pháp luật, quốc phòng và an ninh");
    expect(input.user).toContain("Số giờ: lý thuyết 30, thực hành 30");
    // The shared part comes before the course, so a whole-program run reuses one prompt prefix.
    expect(input.user.indexOf("[3. DANH MỤC KỸ NĂNG")).toBeLessThan(input.user.indexOf("[4. HỌC PHẦN"));
    const schema = input.schema as Schema;
    expect(schema.properties.links!.items.properties.skillKey!.enum).toEqual(["S001", "S002", "S003", "S004"]);
    expect(schema.properties.links!.items.properties.groupKey!.enum).toEqual(["G1", "G2"]);
    expect(schema.properties.links!.items.properties.percent!.type).toBe("integer");
    expect(schema.properties.links!.maxItems).toBe(4);
    expect(schema.properties.newSkills!.maxItems).toBe(2);
    expect(schema.properties.newSkills!.items.properties.percent!.type).toBe("integer");
  });

  it("writes the course type out in words", () => {
    expect(courseTypeLabel("BB")).toBe("Bắt buộc");
    expect(courseTypeLabel("TC102 (2TC)")).toBe("Tự chọn (nhóm TC102 (2TC))");
    expect(courseTypeLabel("")).toBe("chưa ghi");
    expect(courseTypeLabel("Khác")).toBe("Khác");
  });

  it("asks only for the linked skills in weights mode, with integer percents", () => {
    const input = buildCourseAiInput(courseSource({ links: [
      { skillId: SKILL_WEB, name: "Lập trình web", groupId: GROUP_CORE, description: "Web", weight: 0 },
      { skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "CSDL", weight: 0 }
    ] }), "weights");
    expect(input.skills.map((entry) => entry.name)).toEqual(["Lập trình web", "Thiết kế cơ sở dữ liệu"]);
    expect(input.user).not.toContain("Docker");
    expect(input.user).toContain("[3. KỸ NĂNG ĐÃ LIÊN KẾT VỚI HỌC PHẦN]");
    const schema = input.schema as Schema;
    expect(schema.properties.weights!.items.properties.percent!.type).toBe("integer");
    expect(schema.properties.weights!.maxItems).toBe(2);
    expect(input.system).toContain("tổng percent của tất cả kỹ năng bằng đúng 100");
  });

  it("asks for an empty list when no catalog skill is the course's main content (v3, 2026-10-19)", () => {
    expect(COURSE_AI_PROMPT_VERSIONS).toEqual({ links: "comp-link-v7", weights: "comp-weight-v2", full: "comp-course-v6" });
    for (const mode of ["links", "full"] as const) {
      const input = buildCourseAiInput(courseSource(), mode);
      expect(input.system).toContain('trả về "links": [] (danh sách rỗng)');
      expect(input.system).toContain("Không chọn kỹ năng chỉ vì học phần có dùng tới nó");
      expect(input.system).toContain("Ngoại ngữ khác tiếng Anh không nhận kỹ năng tiếng Anh");
      expect(input.user.trimEnd().endsWith('trả về "links": [].')).toBe(true);
      // The grammar allows an empty answer.
      expect((input.schema as { properties: { links: { minItems?: number } } }).properties.links.minItems).toBeUndefined();
    }
  });

  it("shows the skills the faculty imported as the most reliable source and keeps their technologies (v5, 2026-10-22)", () => {
    const facultyLinks = [{ skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", weight: 0.6 }, { skillId: SKILL_WEB, name: "Lập trình web", weight: 0.4 },
      { skillId: "00000000-0000-4000-8000-000000000099", name: "Kỹ năng không còn trong danh mục", weight: 0.2 }];
    for (const mode of ["links", "full"] as const) {
      const input = buildCourseAiInput(courseSource({ facultyLinks }), mode);
      const section = input.user.slice(input.user.indexOf("[5. KỸ NĂNG KHOA ĐÃ NHẬP CHO HỌC PHẦN]"));
      expect(section).toContain("- S002 · Thiết kế cơ sở dữ liệu (Khoa ghi 60%)");
      expect(section).toContain("- S001 · Lập trình web (Khoa ghi 40%)");
      // A skill that is no longer a candidate is not listed (the model can only answer with keys).
      expect(section).not.toContain("không còn trong danh mục");
      expect(input.user.indexOf("[4. HỌC PHẦN")).toBeLessThan(input.user.indexOf("[5. KỸ NĂNG KHOA"));
      expect(input.system).toContain("nguồn đáng tin nhất về nội dung học phần");
      expect(input.system).toContain("không thay một công nghệ Khoa đã ghi bằng công nghệ khác");
      expect(input.system).toContain('"không mặc định Flutter hoặc React Native"');
      expect(input.system).toContain("tên chung như \"Lập trình ứng dụng di động\" chưa đủ để khẳng định công nghệ");
      expect(input.system).toContain("Hợp nhất: khi nhiều kỹ năng trong danh mục gần nghĩa, chỉ chọn một kỹ năng sát nhất");
      expect(input.system).toContain("thường 40–65%");
    }
    const linked = buildCourseAiInput(courseSource({ facultyLinks, links: [{ skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "", weight: 1 }] }), "links");
    expect(linked.user.indexOf("[5. KỸ NĂNG KHOA")).toBeLessThan(linked.user.indexOf("[6. KỸ NĂNG ĐÃ LIÊN KẾT"));
    expect(linked.system).toContain("không là biến thể (thêm hay bớt tên công cụ, viết tắt, tiếng Anh hay tiếng Việt)");
    // Trial of 2026-10-22: Gemma kept the AI's Flutter/Kotlin links of a mobile course while the faculty had Android.
    expect(linked.system).toContain("không phải bằng chứng về nội dung học phần");
    expect(linked.system).toContain("kỹ năng nào trái với mục [5] (ví dụ một công nghệ khác với công nghệ Khoa ghi) thì vẫn đưa vào nhưng cho 0%");
    expect(linked.user).toContain("(luôn đưa vào \"links\" kèm phần trăm; kỹ năng trái với mục [5] thì cho 0%)");
    expect(buildCourseAiInput(courseSource(), "full").user).toContain("[5. KỸ NĂNG KHOA ĐÃ NHẬP CHO HỌC PHẦN] (nguồn đáng tin nhất về nội dung học phần)\nChưa có.");
  });

  it("gives each skill up to 120 characters of its description, so a scope's limits are read (v5)", () => {
    const scope = "Xây dựng ứng dụng Android: layout XML, Activity/Intent, sự kiện và lưu trữ; không mặc định Flutter hoặc React Native.";
    const input = buildCourseAiInput(courseSource({ profiles: [{ id: SKILL_WEB, name: "Phát triển ứng dụng Android", description: scope, groupId: GROUP_CORE }] }), "full");
    expect(scope.length).toBeLessThanOrEqual(120);
    expect(input.user).toContain(`S001 | Phát triển ứng dụng Android | Chuyên môn | ${scope}`);
  });

  it("leaves the specialty out and never infers content from the programme (v7/v6, 2026-10-27)", () => {
    for (const mode of ["links", "full"] as const) {
      const input = buildCourseAiInput(courseSource({ course: { ...courseSource().course, specialty: "An Ninh Mạng" } }), mode);
      expect(input.user).not.toContain("Chuyên ngành");
      expect(input.user).not.toContain("An Ninh Mạng");
      expect(input.user).toContain("Loại: Bắt buộc · Khối kiến thức: Kiến thức chuyên ngành\n");
      expect(input.system).toContain("Không suy ra nội dung học phần từ tên ngành, chuyên ngành hay nhóm tự chọn của chương trình");
      expect(input.system).toContain("chương trình đào tạo các ngành thuộc Khoa Công nghệ Thông tin");
      expect(input.system).toContain("học phần chuyên môn của ngành đào tạo");
      expect(input.system).not.toContain("lĩnh vực khác như kế toán");
      // The course block is kept for the second pass, and is the block the model saw.
      expect(input.course[0]).toBe("Mã: 71ITSE40103");
      expect(input.user).toContain(input.course.join("\n"));
    }
  });

  it("builds the second pass from the proposal: its keys, the linked marker, keep-or-drop answers (comp-check-v1)", () => {
    const item = (skillId: string | null, skillName: string, percent: number, reason: string, isNewSkill = false) =>
      ({ skillId, skillName, groupId: GROUP_CORE, hasProfile: !isNewSkill, isNewSkill, percent, reason });
    const course = buildCourseAiInput(courseSource(), "links").course;
    const input = buildCourseCheckInput({ mode: "links", promptVersion: COURSE_AI_PROMPT_VERSIONS.links, course,
      groups: [{ id: GROUP_CORE, name: "Chuyên môn" }],
      entries: [
        { key: "S002", item: item(SKILL_DB, "Thiết kế cơ sở dữ liệu", 60, "Thiết kế lược đồ."), description: "Mô hình hóa dữ liệu quan hệ", linked: true },
        { key: "S901", item: item(null, "Kiểm thử API", 40, "Có phần kiểm thử API.", true), description: "", linked: false }
      ] });
    expect(input.stage).toBe("check");
    expect(input.promptVersion).toBe("comp-link-v7+comp-check-v1");
    expect(input.think).toBe(true);
    expect(input.user).toContain("[1. HỌC PHẦN]\nMã: 71ITSE40103");
    expect(input.user).toContain("S002 | Thiết kế cơ sở dữ liệu | Chuyên môn | Mô hình hóa dữ liệu quan hệ | 60% | Thiết kế lược đồ. | đã liên kết");
    expect(input.user).toContain("S901 | Kiểm thử API | Chuyên môn | kỹ năng mới, chưa có trong danh mục | 40% | Có phần kiểm thử API.");
    // No programme in the check: neither major nor specialty can lead it.
    expect(input.user).not.toContain("CHƯƠNG TRÌNH ĐÀO TẠO");
    expect(input.system).toContain("kỹ năng đã liên kết bị bỏ vẫn được giữ với 0%");
    expect(input.system).toContain('"tối ưu" trong một học phần cơ sở dữ liệu là tối ưu truy vấn');
    const schema = input.schema as { properties: { links: { maxItems: number; items: { properties: Record<string, { enum?: string[]; type?: string }> } } } };
    expect(schema.properties.links.maxItems).toBe(2);
    expect(schema.properties.links.items.properties.skillKey!.enum).toEqual(["S002", "S901"]);
    expect(schema.properties.links.items.properties.keep!.type).toBe("boolean");
    expect(input.entries.map((entry) => [entry.key, entry.linked])).toEqual([["S002", true], ["S901", false]]);
    const full = buildCourseCheckInput({ mode: "full", promptVersion: COURSE_AI_PROMPT_VERSIONS.full, course, groups: [], entries: [] });
    expect(full.promptVersion).toBe("comp-course-v6+comp-check-v1");
    expect(full.system).not.toContain("đã liên kết");
  });

  it("has no new skills in full mode and keeps student data out", () => {
    const input = buildCourseAiInput(courseSource(), "full");
    const schema = input.schema as Schema;
    expect(Object.keys(schema.properties)).toEqual(["links"]);
    expect(schema.properties.links!.items.properties.percent!.type).toBe("integer");
    expect(input.user).not.toMatch(/MSSV|họ tên|email/i);
    expect(input.user).toContain("=== KẾT THÚC DỮ LIỆU ===");
  });

});
