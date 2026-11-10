import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FaqAnswer from "./FaqAnswer";
import {
  competencyPolicyCategoryId,
  competencyPolicyHref,
  frequentlyAskedQuestions,
  informationPolicies,
  policyUpdatedAt,
  policyVersion,
  publicInformationLinks,
  supportEmail
} from "./public-information";

const policyBlocks = Object.values(informationPolicies).flatMap((policy) =>
  policy.categories.flatMap((category) => category.sections.flatMap((section) => [section.title, ...section.paragraphs.flat()])));
const faqBlocks = frequentlyAskedQuestions.flatMap((faq) => [faq.question, ...faq.answer, ...(faq.steps ?? []), ...(faq.note ? [faq.note] : [])]);
const competencyCategory = informationPolicies.privacy.categories.find((category) => category.id === competencyPolicyCategoryId);
const competencyText = competencyCategory?.sections.flatMap((section) => section.paragraphs.flat()).join(" ") ?? "";

describe("public policy, terms and FAQ", () => {
  it("shows the consent policy version as the update date", () => {
    expect(policyVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(policyUpdatedAt).toBe(policyVersion.split("-").reverse().join("/"));
  });

  it("links competency consent to a privacy category the policy page renders", () => {
    expect(competencyPolicyHref).toBe(`${publicInformationLinks[0].href}#bao-mat-${competencyPolicyCategoryId}`);
    expect(competencyCategory?.label).toBe("Đánh giá năng lực và AI");
  });

  it("explains what the AI model on Cloudflare Workers AI receives, what it never receives and how long results are kept", () => {
    expect(competencyText).toContain("Gemma 4 26B");
    expect(competencyText).toContain("Cloudflare Workers AI");
    expect(competencyText).toContain("không nhận họ tên, mã số sinh viên, email, lớp");
    expect(competencyText).toContain("không lưu lại và không dùng dữ liệu để huấn luyện mô hình AI");
    expect(competencyText).not.toContain("chạy cục bộ");
    expect(competencyText).toContain("tối đa 20 lần đánh giá gần nhất");
    expect(competencyText).toContain("rút lại sự đồng ý");
  });

  it("no longer says EduPath does not use AI or will announce AI features before they launch", () => {
    for (const text of [...policyBlocks, ...faqBlocks]) {
      expect(text).not.toMatch(/chưa dùng AI|chưa sử dụng AI|được đưa vào sử dụng|thông báo trước khi áp dụng/);
    }
  });

  it("keeps the existing policy anchors", () => {
    expect(informationPolicies.privacy.categories.map((category) => category.id)).toEqual(
      expect.arrayContaining(["tong-quan", "thong-tin", "muc-dich", "bang-diem", "chia-se", "luu-tru", "quyen-cua-ban", "lien-he"]));
    expect(informationPolicies.terms.categories.map((category) => category.id)).toEqual(
      ["gioi-thieu", "tai-khoan", "bang-diem", "quy-tac", "ket-qua", "dich-vu", "vi-pham"]);
  });

  it("keeps category ids, section titles and FAQ questions unique", () => {
    for (const policy of Object.values(informationPolicies)) {
      const ids = policy.categories.map((category) => category.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const category of policy.categories) {
        const titles = category.sections.map((section) => section.title);
        expect(new Set(titles).size).toBe(titles.length);
      }
    }
    const questions = frequentlyAskedQuestions.map((faq) => faq.question);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("stays plain text", () => {
    for (const text of [...policyBlocks, ...faqBlocks]) expect(text).not.toMatch(/\*\*|`|\]\(|<\/?[a-z]/);
  });

  it("sends students to the pages that do each job today", () => {
    const faqText = faqBlocks.join(" ");
    expect(faqText).not.toContain("chọn mục tiêu trong Thông tin cá nhân");
    expect(faqText).not.toContain("dùng Đánh giá năng lực để biết kỹ năng hiện tại");
    expect(faqText).not.toContain("cổng sinh viên");
    const functions = frequentlyAskedQuestions.find((faq) => faq.question === "Tôi có thể sử dụng những chức năng học tập nào?");
    for (const page of ["Hồ sơ và bảng điểm", "Định hướng nghề nghiệp", "Đánh giá năng lực", "Khoảng trống kỹ năng", "Lộ trình học tập", "Điều kiện xét tốt nghiệp"]) {
      expect(functions?.note).toContain(page);
    }
    const ai = frequentlyAskedQuestions.find((faq) => faq.question === "EduPath AI dùng AI vào việc gì?")?.answer.join(" ") ?? "";
    for (const use of ["Đánh giá năng lực", "Lộ trình AI", "Lời khuyên từ EduPath AI"]) expect(ai).toContain(use);
  });

  it("says the cố vấn học tập and the Khoa's staff may choose the goals, edit the plan and fill in the survey for the student (policy 2026-11-10)", () => {
    expect(policyUpdatedAt).toBe("10/11/2026");
    for (const text of [...policyBlocks, ...faqBlocks]) {
      expect(text).not.toMatch(/không chọn chuyên ngành|không sửa [Kk]ế hoạch học kỳ|không làm hay sửa [Kk]hảo sát|không sửa hay xóa được khảo sát|tự làm Khảo sát định hướng và đồng ý/);
    }
    const survey = "dùng cho các chức năng AI của bạn như khảo sát bạn tự làm, cho đến khi bạn sửa lại hoặc rút đồng ý.";
    const faq = frequentlyAskedQuestions.find((item) => item.question === "Cố vấn học tập và cán bộ Khoa có thể làm thay tôi những gì?")?.answer.join(" ");
    expect(faq).toContain("làm thay bạn: import bảng điểm, chọn chuyên ngành và vị trí nghề nghiệp mục tiêu, sửa Kế hoạch học kỳ, làm Khảo sát định hướng,");
    expect(faq).toContain(survey);
    expect(faq).toContain("Cố vấn và cán bộ Khoa không đồng ý hay rút đồng ý thay bạn và không xóa dữ liệu của bạn.");
    const sharing = policyBlocks.find((text) => text.startsWith("Cố vấn học tập được Khoa phân công cho lớp của bạn xem được toàn bộ trang EduPath AI của bạn:"));
    expect(sharing).toContain("Cố vấn có thể làm thay bạn: import bảng điểm, chọn chuyên ngành và vị trí nghề nghiệp mục tiêu, sửa kế hoạch học kỳ, làm khảo sát định hướng,");
    expect(sharing).toContain(survey);
    const update = policyBlocks.filter((text) => text.startsWith("Bản cập nhật ngày 10/11/2026"));
    expect(update).toHaveLength(1);
    expect(update[0]).toContain("chọn chuyên ngành và vị trí nghề nghiệp mục tiêu, sửa Kế hoạch học kỳ và làm Khảo sát định hướng thay bạn");
    expect(update[0]).toContain(survey);
  });

  it("renders the support e-mail in FAQ answers as a link", () => {
    const faq = frequentlyAskedQuestions.find((item) => item.note?.includes(supportEmail));
    expect(faq).toBeDefined();
    expect(renderToStaticMarkup(createElement(FaqAnswer, { faq: faq! }))).toContain(`<a href="mailto:${supportEmail}">${supportEmail}</a>`);
  });
});
