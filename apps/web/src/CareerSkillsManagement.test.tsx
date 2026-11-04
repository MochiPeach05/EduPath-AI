import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillEditor, skillChanged, skillName, skillPayload } from "./CareerSkillsManagement";
import type { ManagedCareerSkill } from "./career-types";

// The Kỹ năng form of Quản lý nghề nghiệp. Synthetic skills only.
const skill: ManagedCareerSkill = {
  id: "11111111-1111-4111-8111-111111111111", name: "SQL", description: "Truy vấn dữ liệu quan hệ",
  version: "22222222-2222-4222-8222-222222222222", careerCount: 2, assessmentCount: 0,
};
const noop = () => undefined;

describe("skill form", () => {
  it("sends the name as the API saves it, so \" api \" meets \"API\" as a duplicate", () => {
    expect(skillName(" api ")).toBe("api");
    expect(skillName("API    Gateway\t")).toBe("API Gateway");
    expect(skillName("Phân tích dữ liệu")).toBe("Phân tích dữ liệu".normalize("NFC"));
    expect(skillPayload({ name: "  Docker ", description: " Đóng gói ứng dụng.\n" })).toEqual({ name: "Docker", description: "Đóng gói ứng dụng." });
  });

  it("finds no change when only the spaces around the texts differ", () => {
    expect(skillChanged(null, { name: "", description: "" })).toBe(true);
    expect(skillChanged(skill, { name: "SQL", description: "Truy vấn dữ liệu quan hệ" })).toBe(false);
    expect(skillChanged(skill, { name: " SQL ", description: "Truy vấn dữ liệu quan hệ  " })).toBe(false);
    expect(skillChanged(skill, { name: "sql", description: skill.description })).toBe(true);
    expect(skillChanged(skill, { name: "SQL", description: "Truy vấn và tối ưu dữ liệu quan hệ" })).toBe(true);
  });

  it("keeps Lưu kỹ năng off until the opened skill is changed; a new skill can be saved", () => {
    const edit = renderToStaticMarkup(<SkillEditor current={skill} close={noop} saved={noop} />);
    expect(edit).toContain('<button class="am-primary" disabled="" title="Chưa có thay đổi để lưu">');
    expect(edit).toContain("Lưu kỹ năng");
    const add = renderToStaticMarkup(<SkillEditor current={null} close={noop} saved={noop} />);
    expect(add).toContain("Lưu kỹ năng");
    expect(add).not.toContain("Chưa có thay đổi để lưu");
    expect(add).not.toMatch(/<button class="am-primary" disabled=""/);
  });
});
