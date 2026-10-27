import { describe, expect, it } from "vitest";
import { buildCourseAiInput, COURSE_AI_PROMPT_VERSIONS, courseTypeLabel } from "./prompt.js";
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
    expect(input.user.trimEnd().endsWith('Luôn đưa các kỹ năng đã liên kết ở mục [7] vào "links".')).toBe(true);
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
    expect(COURSE_AI_PROMPT_VERSIONS).toEqual({ links: "comp-link-v6", weights: "comp-weight-v2", full: "comp-course-v5" });
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
    expect(linked.user.indexOf("[6. MÔN CÙNG TÊN")).toBeLessThan(linked.user.indexOf("[7. KỸ NĂNG ĐÃ LIÊN KẾT"));
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

  it("offers a skill kept to some majors only to their courses and shows the configured course of the same name (v6/v5, 2026-10-27)", () => {
    const SKILL_GIS = "00000000-0000-4000-8000-000000000021";
    const profiles = [...courseSource().profiles,
      { id: SKILL_GIS, name: "Hệ thống thông tin địa lý (GIS)", description: "Bản đồ và phân tích không gian", groupId: GROUP_CORE, majorCodes: ["7480104"] }];
    // A CNTT course never sees the HTTT skill, in either mode; nor does a course of no known major.
    for (const mode of ["links", "full"] as const) {
      const cntt = buildCourseAiInput(courseSource({ profiles, majors: [{ code: "7480201", cohorts: ["K29", "K31"] }] }), mode);
      expect(cntt.skills.map((entry) => entry.id)).not.toContain(SKILL_GIS);
      expect(cntt.user).toContain("Ngành có học phần này trong CTĐT mới nhất: Công nghệ thông tin (CNTT): K29, K31");
      expect(buildCourseAiInput(courseSource({ profiles }), mode).skills.map((entry) => entry.id)).not.toContain(SKILL_GIS);
    }
    // An HTTT course gets the HTTT skill, marked, and keeps the skills of every major.
    const httt = buildCourseAiInput(courseSource({ profiles, majors: [{ code: "7480104", cohorts: ["K29", "K31"] }] }), "full");
    expect(httt.skills.map((entry) => entry.id)).toEqual(expect.arrayContaining([SKILL_WEB, SKILL_DB, SKILL_TEAM, SKILL_DOCKER, SKILL_GIS]));
    expect(httt.user).toMatch(/S\d{3} \| Hệ thống thông tin địa lý \(GIS\) \| Chuyên môn · riêng ngành HTTT \| Bản đồ/);
    expect(httt.user).toContain("Hệ thống thông tin (HTTT): K29, K31");
    expect(httt.system).toContain("chọn kỹ năng riêng đó");
    expect(httt.system).toContain("Mạng máy tính và truyền thông dữ liệu");
    // A course keeps a linked skill of another major in links mode: it has it.
    const linkedGis = buildCourseAiInput(courseSource({ profiles, majors: [{ code: "7480201", cohorts: ["K31"] }],
      links: [{ skillId: SKILL_GIS, name: "Hệ thống thông tin địa lý (GIS)", groupId: GROUP_CORE, description: "", weight: 1 }] }), "links");
    expect(linkedGis.skills.map((entry) => entry.id)).toContain(SKILL_GIS);

    const namesake = { code: "71ITNW41003", where: "CNTT K27, MMT&TTDL K31", links: [
      { skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", weight: 0.6 }, { skillId: SKILL_WEB, name: "Lập trình web", weight: 0.4 },
      { skillId: SKILL_GIS, name: "Hệ thống thông tin địa lý (GIS)", weight: 0.2 }] };
    for (const mode of ["links", "full"] as const) {
      const input = buildCourseAiInput(courseSource({ profiles, majors: [{ code: "7480201", cohorts: ["K31"] }], namesake }), mode);
      const section = input.user.slice(input.user.indexOf("[6. MÔN CÙNG TÊN ĐÃ CẤU HÌNH]"));
      expect(section).toContain("Mã 71ITNW41003 · CNTT K27, MMT&TTDL K31\n- S002 · Thiết kế cơ sở dữ liệu (60%)\n- S001 · Lập trình web (40%)");
      // A skill that is not a candidate of this course is left out.
      expect(section).not.toContain("GIS");
      expect(input.user.indexOf("[5. KỸ NĂNG KHOA")).toBeLessThan(input.user.indexOf("[6. MÔN CÙNG TÊN"));
      expect(input.system).toContain("Mục [5] đáng tin hơn mục [6]");
    }
    expect(buildCourseAiInput(courseSource(), "full").user)
      .toContain("[6. MÔN CÙNG TÊN ĐÃ CẤU HÌNH] (cùng tên, khác mã, ở ngành hoặc khóa khác; cấu hình đang áp dụng)\nChưa có.");
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
