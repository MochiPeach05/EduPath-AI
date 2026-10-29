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
    // "danh sách" is a list, not a book (the evaluation of 2026-10-29).
    ["Danh sách học phần của nhóm TC309 gồm những môn nào?", []],
    // Grade questions read the transcript (assistant-v4, 2026-10-29).
    ["Điểm tổng của tôi hiện tại là bao nhiêu", ["transcript"]],
    ["diem tong cua toi la bao nhieu", ["transcript"]],
    ["GPA của mình bao nhiêu?", ["graduation", "transcript"]],
    ["Môn Cơ sở dữ liệu mình được mấy điểm?", ["transcript"]],
    ["Điểm của mình môn Lập trình Web", ["transcript"]],
    ["Mình còn nợ môn nào không?", ["roadmap", "transcript"]],
    ["Mình rớt mấy môn rồi?", ["transcript"]],
    ["Môn nào mình điểm cao nhất?", ["transcript"]],
    ["Mình tích lũy được bao nhiêu tín chỉ rồi?", ["graduation", "transcript"]],
    ["Điểm hk1 của mình thế nào", ["transcript"]],
    ["Xếp loại học lực của mình là gì?", ["transcript"]],
    ["Mình có vắng thi môn nào không?", ["transcript"]],
    ["Cho mình xem bảng điểm", ["transcript"]],
    // "điểm" that is not a grade: strengths, weaknesses, the career fit, competency and skill scores.
    ["Điểm mạnh của mình là gì?", ["gaps"]],
    ["Điểm yếu nhất của mình là gì?", ["gaps"]],
    ["Điểm phù hợp với nghề mục tiêu của mình là bao nhiêu?", ["gaps"]],
    ["Điểm năng lực chung của mình bao nhiêu?", ["gaps"]],
    ["Kỹ năng nào của mình điểm cao nhất?", ["gaps"]],
    ["Điểm kỹ năng SQL của mình là bao nhiêu?", ["gaps"]],
    ["Mình cần bao nhiêu tín chỉ để tốt nghiệp?", ["graduation"]],
    ["Nó là môn gì vậy?", []],
  ])("reads %s", (question, intents) => {
    expect(detectIntents(question)).toEqual(intents);
  });

  it("treats short or pronoun-led questions as follow-ups", () => {
    expect(isFollowUp("Còn môn kia thì sao?")).toBe(true);
    expect(isFollowUp("vì sao vậy")).toBe(true);
    expect(isFollowUp("Học phần Cơ sở dữ liệu giúp mình những kỹ năng gì cho nghề kiểm thử?")).toBe(false);
  });
});
