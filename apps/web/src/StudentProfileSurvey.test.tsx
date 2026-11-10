import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import StudentProfileSurvey, { SurveyCard, cancelledUi, loadedUi, openedUi, savedUi, type SurveyUi } from "./StudentProfileSurvey";
import { draftOf, surveyProblems, type StudentSurvey, type SurveyQuestion, type SurveyResponse } from "./profile-survey";
import { policyVersion } from "./public-information";
import { installAdvisorFetch, stopActing } from "./advisor-view";

// Invented questions and answers only.
const questions: SurveyQuestion[] = [
  { id: "goal", label: "Mục tiêu sau tốt nghiệp", options: [{ id: "work", label: "Đi làm ngay" }, { id: "study", label: "Học lên cao" }] },
  { id: "english", label: "Tiếng Anh chuyên ngành", options: [{ id: "reading", label: "Đọc hiểu tốt" }, { id: "working", label: "Giao tiếp, làm việc được" }] },
  { id: "selfStudy", label: "Thời gian tự học mỗi tuần", options: [{ id: "low", label: "Dưới 5 giờ" }, { id: "high", label: "Trên 10 giờ" }] },
];
const interests = {
  tech: [{ id: "python", label: "Python" }, { id: "sql", label: "SQL" }, { id: "react", label: "React" }],
  hobbies: [{ id: "reading", label: "Đọc sách" }, { id: "sport", label: "Thể thao" }],
  max: 5,
};
const survey: StudentSurvey = {
  version: "survey-v4", answers: { goal: "work", english: "reading", selfStudy: "high" }, interestTech: ["python", "sql"], interestHobbies: ["reading"],
  hasAchievements: true, achievements: "Giải Ba cuộc thi lập trình cấp khoa 2025\nHọc bổng khuyến khích học tập HK1 2025–2026",
  updatedAt: "2026-10-24T03:15:00.000Z", complete: true,
};
const response = (extra: Partial<SurveyResponse> = {}): SurveyResponse =>
  ({ questions, interests, achievementsMax: 1000, survey, previous: null, consentVersion: policyVersion, ...extra });
// One answer missing (a question added since): not done.
const partial: StudentSurvey = { ...survey, answers: { goal: "work", english: "reading" }, complete: false };

const render = (data: SurveyResponse, ui: SurveyUi) => renderToStaticMarkup(<SurveyCard data={data} ui={ui} />);
const isForm = (html: string) => html.includes('type="radio"') && html.includes("Lưu khảo sát");
const editLink = /<div class="sw-section-heading ps-heading">.*<button type="button" class="sw-text-link"><svg.*?<\/svg>Chỉnh sửa khảo sát<\/button><\/div>/;

describe("Khảo sát định hướng once done (user 2026-11-04)", () => {
  it("is a short summary: badge, date, the answers as a grid, the chips, and Chỉnh sửa khảo sát at the top right", () => {
    const data = response();
    const ui = loadedUi(data, false);
    expect(ui.editing).toBe(false);
    const html = render(data, ui);
    expect(html).toContain('id="khao-sat-dinh-huong"');
    expect(html).toContain('<h2 id="ps-title" tabindex="-1">Khảo sát định hướng</h2><span class="sw-tag sw-tag-green">Đã hoàn thành</span>');
    expect(html).toContain('<p class="sw-muted ps-updated">Cập nhật lúc 10:15 24/10/2026</p>');
    expect(html).toMatch(editLink);
    expect(html).toContain('<dl class="ps-brief"><div><dt>Mục tiêu sau tốt nghiệp</dt><dd>Đi làm ngay</dd></div><div><dt>Tiếng Anh chuyên ngành</dt><dd>Đọc hiểu tốt</dd></div>');
    expect(html).toContain("<dt>Thời gian tự học mỗi tuần</dt><dd>Trên 10 giờ</dd>");
    expect(html).toContain('<dt>Thế mạnh</dt><dd><ul class="ps-chips ps-chips-tech"><li>Python</li><li>SQL</li></ul></dd>');
    expect(html).toContain('<dt>Sở trường</dt><dd><ul class="ps-chips"><li>Đọc sách</li></ul></dd>');
    expect(html).toContain('<dt>Thành tích</dt><dd><ul class="ps-achievement-list"><li>Giải Ba cuộc thi lập trình cấp khoa 2025</li><li>Học bổng khuyến khích học tập HK1 2025–2026</li></ul></dd>');
    // Only the chosen answers: no options, no form, no intro, no red marks.
    expect(isForm(html)).toBe(false);
    for (const absent of ["Học lên cao", "React", "Thể thao", "Bắt buộc", "ps-survey-todo", "Trả lời 3 câu hỏi ngắn", "Để hoàn thành khảo sát", "Xóa câu trả lời", "Chưa trả lời", "sw-advisor-note"]) {
      expect(html).not.toContain(absent);
    }
  });

  it("writes Không có without achievements and leaves the date out when the data has none", () => {
    const data = response({ survey: { ...survey, hasAchievements: false, achievements: null, updatedAt: "" } });
    const html = render(data, loadedUi(data, false));
    expect(html).toContain("<dt>Thành tích</dt><dd>Không có</dd>");
    expect(html).not.toContain("Cập nhật lúc");
    expect(html).toMatch(editLink);
  });

  it("opens the full form from Chỉnh sửa khảo sát, with the stored answers, Hủy, Xóa câu trả lời and Lưu khảo sát", () => {
    const data = response();
    const ui = openedUi(loadedUi(data, false));
    expect(ui.editing).toBe(true);
    const html = render(data, ui);
    expect(isForm(html)).toBe(true);
    expect(html).toContain('name="ps-goal" checked="" value="work"');
    expect(html).toContain('name="ps-selfStudy" checked="" value="high"');
    expect(html).toContain("Hủy</button>");
    expect(html).toContain("Xóa câu trả lời</button>");
    expect(html).toContain("Trả lời 3 câu hỏi ngắn");
    expect(html).toContain('<span class="sw-tag sw-tag-green">Đã hoàn thành</span>');
    expect(html).not.toContain("Chỉnh sửa khảo sát");
    expect(html).not.toContain('class="ps-brief"');
    // Answers that count need no new consent.
    expect(html).not.toContain("Tôi đồng ý");
  });

  it("goes back to the summary on Hủy with nothing changed, and opens again from the stored answers", () => {
    const data = response();
    const opened = openedUi(loadedUi(data, false));
    const changed: SurveyUi = { ...opened, draft: { ...opened.draft, answers: { ...opened.draft.answers, goal: "study" } }, attempted: true, error: "Không lưu được khảo sát. Vui lòng thử lại." };
    expect(render(data, changed)).toContain('name="ps-goal" checked="" value="study"');
    const cancelled = cancelledUi(changed, data);
    expect(cancelled).toMatchObject({ editing: false, attempted: false, consented: false, error: "" });
    expect(cancelled.draft).toEqual(draftOf(survey));
    const html = render(data, cancelled);
    expect(isForm(html)).toBe(false);
    expect(html).toContain("<dt>Mục tiêu sau tốt nghiệp</dt><dd>Đi làm ngay</dd>");
    expect(html).not.toContain("Học lên cao");
    expect(html).not.toContain("Không lưu được khảo sát");
    expect(html).toMatch(editLink);
    const again = render(data, openedUi(cancelled));
    expect(again).toContain('name="ps-goal" checked="" value="work"');
    expect(again).not.toContain('checked="" value="study"');
  });

  it("returns to the summary after saving, the message read with Chỉnh sửa khảo sát", () => {
    const html = render(response(), savedUi(survey));
    expect(isForm(html)).toBe(false);
    expect(html).toContain('<p class="sr-success" id="ps-message" role="status">Đã lưu khảo sát định hướng.');
    expect(html).toContain('<button type="button" class="sw-text-link" aria-describedby="ps-message">');
    expect(html).toContain("<dd>Đi làm ngay</dd>");
  });
});

describe("Khảo sát định hướng not done", () => {
  it("keeps the form open with Bắt buộc and what is missing", () => {
    const data = response({ survey: partial });
    const ui = loadedUi(data, false);
    expect(ui.editing).toBe(true);
    const html = render(data, ui);
    expect(isForm(html)).toBe(true);
    expect(html).toContain('<span class="sw-tag ps-tag-required">Bắt buộc</span>');
    expect(html).toContain("ps-survey-todo");
    expect(html).toContain("<strong>Để hoàn thành khảo sát, bạn cần:</strong><ul><li>Trả lời 1 câu hỏi còn thiếu</li></ul>");
    expect(html).toContain("Bạn cần hoàn thành khảo sát trước khi tạo Lộ trình AI.");
    // Stored answers can still go back to the summary.
    expect(html).toContain("Hủy</button>");
    expect(html).not.toContain("Chỉnh sửa khảo sát");
  });

  it("asks for the consent again after a policy update, in the open form", () => {
    const data = response({ consentVersion: "2026-10-24" });
    const ui = loadedUi(data, false);
    expect(ui.editing).toBe(true);
    const html = render(data, ui);
    expect(isForm(html)).toBe(true);
    expect(html).toContain("<li>Xác nhận lại theo chính sách mới</li>");
    expect(html).toContain("Tôi đồng ý để EduPath AI dùng câu trả lời khảo sát");
    expect(html).toContain('<span class="sw-tag ps-tag-required">Bắt buộc</span>');
  });

  it("starts with the empty form and no Hủy when nothing is stored", () => {
    const data = response({ survey: null, consentVersion: null });
    const html = render(data, loadedUi(data, false));
    expect(isForm(html)).toBe(true);
    expect(html).not.toContain("Hủy</button>");
    expect(html).not.toContain("Xóa câu trả lời");
    expect(html).not.toContain("Để hoàn thành khảo sát");
    // Even a closed form state shows the form: there is nothing to sum up.
    expect(isForm(render(data, { ...loadedUi(data, false), editing: false }))).toBe(true);
  });

  it("sums up an unfinished survey after Hủy, still marked Bắt buộc, with Chỉnh sửa khảo sát to go on", () => {
    const data = response({ survey: partial });
    const html = render(data, cancelledUi(loadedUi(data, false), data));
    expect(isForm(html)).toBe(false);
    expect(html).toContain('<span class="sw-tag ps-tag-required">Bắt buộc</span>');
    expect(html).toContain("<li>Trả lời 1 câu hỏi còn thiếu</li>");
    expect(html).toContain('<dt>Thời gian tự học mỗi tuần</dt><dd><span class="ps-none">Chưa trả lời</span></dd>');
    expect(html).toMatch(editLink);
  });
});

describe("Khảo sát định hướng in the tab of a cố vấn học tập or the Khoa (policy 2026-11-10)", () => {
  afterEach(() => stopActing());
  const advisor = () => installAdvisorFetch("00000000-0000-4000-8000-0000000e2e05");
  const note = "Bạn làm khảo sát thay sinh viên; sinh viên sẽ nhận thông báo và có thể sửa lại.";

  it("starts on the summary, with Chỉnh sửa khảo sát and never Xóa câu trả lời", () => {
    advisor();
    const data = response();
    const ui = loadedUi(data);
    expect(ui.editing).toBe(false);
    const html = render(data, ui);
    expect(isForm(html)).toBe(false);
    expect(html).toContain('<span class="sw-tag sw-tag-green">Đã hoàn thành</span>');
    expect(html).toContain("<dt>Mục tiêu sau tốt nghiệp</dt><dd>Đi làm ngay</dd>");
    expect(html).toMatch(editLink);
    for (const gone of ["Bạn chỉ xem", "sinh viên tự sửa", "Xóa câu trả lời"]) expect(html).not.toContain(gone);
  });

  it("opens the form without the student's consent box, with a note instead, Hủy and no Xóa câu trả lời", () => {
    advisor();
    // The student's consent no longer counts (an older policy): staff still save it, never agreeing for the student.
    const data = response({ consentVersion: "2026-10-24" });
    const html = render(data, openedUi(loadedUi(data)));
    expect(isForm(html)).toBe(true);
    expect(html).toContain(`<p class="sw-advisor-note">${note}</p>`);
    expect(html).toContain("Hủy</button>");
    for (const gone of ["Tôi đồng ý", "Xóa câu trả lời", "Xác nhận lại theo chính sách mới", "Đánh dấu ô đồng ý"]) expect(html).not.toContain(gone);
    // Nothing blocks saving but the answers themselves.
    expect(surveyProblems(questions, openedUi(loadedUi(data)).draft, { needsConsent: false, consented: false, achievementsMax: 1000 })).toEqual([]);
  });

  it("offers Làm khảo sát thay sinh viên when there is none, and nothing after the student withdrew the consent", () => {
    advisor();
    const none = response({ survey: null, consentVersion: null });
    const ui = loadedUi(none);
    expect(ui.editing).toBe(false);
    const empty = render(none, ui);
    expect(isForm(empty)).toBe(false);
    expect(empty).toContain('<p class="sw-advisor-note">Sinh viên chưa làm Khảo sát định hướng.</p>');
    expect(empty).toMatch(/<button type="button" class="sw-text-link"><svg.*?<\/svg>Làm khảo sát thay sinh viên<\/button>/);
    const opened = render(none, openedUi(ui));
    expect(isForm(opened)).toBe(true);
    expect(opened).toContain("Hủy</button>");
    expect(opened).toContain(note);
    const withdrawn = response({ survey: null, consentVersion: null, withdrawn: true });
    const refused = render(withdrawn, loadedUi(withdrawn));
    expect(refused).toContain("Sinh viên đã xóa câu trả lời khảo sát và rút lại sự đồng ý, nên bạn không làm khảo sát thay được.");
    expect(refused).not.toContain("Làm khảo sát thay sinh viên");
    // An unfinished survey: what it lacks, without the consent, and Chỉnh sửa khảo sát.
    const unfinished = render(response({ survey: partial, consentVersion: null }), loadedUi(response({ survey: partial })));
    expect(unfinished).toContain("<strong>Để hoàn thành khảo sát, bạn cần:</strong><ul><li>Trả lời 1 câu hỏi còn thiếu</li></ul>");
    expect(unfinished).toMatch(editLink);
  });

  it("says who filled the answers in, and that they count", () => {
    advisor();
    const data = response({ survey: { ...survey, savedBy: "admin" }, consentVersion: null });
    const html = render(data, loadedUi(data));
    expect(html).toContain('<span class="sw-tag sw-tag-green">Đã hoàn thành</span>');
    expect(html).toContain('<p class="sw-muted ps-updated">Cập nhật lúc 10:15 24/10/2026, do cán bộ Khoa làm thay sinh viên</p>');
    expect(savedUi(survey, true).message).toBe("Đã lưu khảo sát định hướng của sinh viên. EduPath AI sẽ dùng các câu trả lời này khi soạn lộ trình học tập cho sinh viên.");
  });
});

describe("Khảo sát định hướng a cố vấn học tập filled in, in the student's own page (policy 2026-11-10)", () => {
  const data = response({ survey: { ...survey, savedBy: "advisor" }, consentVersion: null });

  it("counts without the student's consent and says who filled it in", () => {
    const ui = loadedUi(data, false);
    expect(ui.editing).toBe(false);
    const html = render(data, ui);
    expect(html).toContain('<span class="sw-tag sw-tag-green">Đã hoàn thành</span>');
    expect(html).toContain('<p class="sw-muted ps-updated">Cập nhật lúc 10:15 24/10/2026, do cố vấn học tập làm thay bạn</p>');
    expect(html).not.toContain("Để hoàn thành khảo sát");
    expect(html).toMatch(editLink);
  });

  it("asks the student's consent when the student saves it, as for any first save", () => {
    const html = render(data, openedUi(loadedUi(data, false)));
    expect(html).toContain("Tôi đồng ý để EduPath AI dùng câu trả lời khảo sát");
    expect(html).not.toContain("Chính sách vừa được cập nhật");
    expect(html).toContain("Xóa câu trả lời</button>");
    expect(html).not.toContain("sw-advisor-note");
  });
});

describe("Khảo sát định hướng while loading", () => {
  it("keeps the section id, so Tổng quan can open it", () => {
    const html = renderToStaticMarkup(<StudentProfileSurvey onSaved={() => {}} />);
    expect(html).toContain('id="khao-sat-dinh-huong"');
    expect(html).toContain("Đang tải khảo sát định hướng…");
  });
});
