import { describe, expect, it } from "vitest";
import { detectIntents, isFollowUp } from "./intent.js";

describe("assistant intents", () => {
  it.each([
    ["Mình còn thiếu những kỹ năng nào cho nghề mục tiêu?", ["gaps"]],
    ["Học kỳ tới mình nên học những môn nào?", ["roadmap"]],
    ["Vì sao lộ trình đề xuất môn Lập trình Web?", ["roadmap", "course_reason"]],
    ["Điều kiện xét tốt nghiệp của khóa mình là gì?", ["graduation"]],
    ["Mình nên tự học Docker ở đâu, có tài liệu nào không?", ["resources"]],
    ["Chào bạn", []],
  ])("reads %s", (question, intents) => {
    expect(detectIntents(question)).toEqual(intents);
  });

  it("treats short or pronoun-led questions as follow-ups", () => {
    expect(isFollowUp("Còn môn kia thì sao?")).toBe(true);
    expect(isFollowUp("vì sao vậy")).toBe(true);
    expect(isFollowUp("Học phần Cơ sở dữ liệu giúp mình những kỹ năng gì cho nghề kiểm thử?")).toBe(false);
  });
});
