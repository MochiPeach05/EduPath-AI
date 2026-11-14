import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import StudentProfileSurvey, { SurveyCard, cancelledUi, loadedUi, openedUi, savedUi, type SurveyUi } from "./StudentProfileSurvey";
import { visibleInterests } from "./InterestChoices";
import { draftOf, surveyProblems, type StudentSurvey, type SurveyQuestion, type SurveyResponse } from "./profile-survey";
import { policyVersion } from "./public-information";
import { installAdvisorFetch, stopActing } from "./advisor-view";

// Invented questions and answers only, in the order of survey-v5.
const questions: SurveyQuestion[] = [
  { id: "field", label: "Lĩnh vực quan tâm nhất", options: [{ id: "web", label: "Web" }, { id: "data", label: "AI, dữ liệu" }] },
  { id: "goal", label: "Mục tiêu sau tốt nghiệp", options: [{ id: "work", label: "Đi làm ngay" }, { id: "study", label: "Học lên cao" }] },
  { id: "selfStudy", label: "Thời gian tự học mỗi tuần", options: [{ id: "low", label: "Dưới 5 giờ" }, { id: "high", label: "Trên 10 giờ" }] },
  { id: "english", label: "Tiếng Anh chuyên ngành", options: [{ id: "reading", label: "Đọc hiểu tốt" }, { id: "working", label: "Giao tiếp, làm việc được" }] },
];
const tech = ["Python", "SQL", "React", "Docker", "Kotlin", "Unity", "Figma", "Selenium"].map((label) => ({ id: label.toLowerCase(), label }));
const interests = { tech, hobbies: [{ id: "reading", label: "Đọc sách" }], max: 5 };
// A survey-v4 row: its Sở trường and Thành tích are still stored, never shown.
const survey: StudentSurvey = {
  version: "survey-v4", answers: { field: "data", goal: "work", selfStudy: "high", english: "reading", environment: "team" }, interestTech: ["python", "sql"],
  interestHobbies: ["reading"], hasAchievements: true, achievements: "Giải Ba cuộc thi lập trình cấp khoa 2025", updatedAt: "2026-10-24T03:15:00.000Z", complete: true,
};
const response = (extra: Partial<SurveyResponse> = {}): SurveyResponse =>
  ({ questions, interests, achievementsMax: 1000, survey, previous: null, consentVersion: policyVersion, ...extra });
// One answer missing (a question added since): not done.
const partial: StudentSurvey = { ...survey, answers: { field: "data", goal: "work", english: "reading" }, complete: false };

const render = (data: SurveyResponse, ui: SurveyUi) => renderToStaticMarkup(<SurveyCard data={data} ui={ui} />);
const isForm = (html: string) => html.includes('type="radio"') && html.includes("Lưu khảo sát");
const editLink = /<div class="sw-section-heading ps-heading">.*<button type="button" class="sw-text-link"><svg.*?<\/svg>Chỉnh sửa khảo sát<\/button><\/div>/;

describe("Khảo sát nhanh once done", () => {
  it("is a short summary on Định hướng nghề nghiệp: badge, date, the five answers in form order, Chỉnh sửa khảo sát", () => {
    const data = response();
    const ui = loadedUi(data, false);
    expect(ui.editing).toBe(false);
    const html = render(data, ui);
    expect(html).toContain('id="khao-sat-nhanh"');
    expect(html).toContain('class="sw-panel ps-survey ps-quick"');
    expect(html).toContain('<h2 id="ps-title" tabindex="-1">Khảo sát nhanh</h2><span class="sw-tag sw-tag-green">Đã hoàn thành</span>');
    expect(html).toContain('<p class="sw-muted ps-updated">Cập nhật lúc 10:15 24/10/2026</p>');
    expect(html).toMatch(editLink);
    expect(html).toContain('<dl class="ps-brief"><div><dt>Lĩnh vực quan tâm nhất</dt><dd>AI, dữ liệu</dd></div><div class="ps-brief-wide"><dt>Thế mạnh</dt><dd><ul class="ps-chips ps-chips-tech"><li>Python</li><li>SQL</li></ul></dd></div><div><dt>Mục tiêu sau tốt nghiệp</dt><dd>Đi làm ngay</dd></div>');
    expect(html).toContain("<dt>Thời gian tự học mỗi tuần</dt><dd>Trên 10 giờ</dd>");
    expect(html).toContain("<dt>Tiếng Anh chuyên ngành</dt><dd>Đọc hiểu tốt</dd>");
    // Only the chosen answers: no options, no form, no intro; Sở trường and Thành tích are gone.
    expect(isForm(html)).toBe(false);
    for (const absent of ["Học lên cao", "React", "Sở trường", "Đọc sách", "Thành tích", "Giải Ba", "Bắt buộc", "Không bắt buộc", "Để hoàn thành khảo sát", "Xóa câu trả lời", "Chưa trả lời", "sw-advisor-note"]) {
      expect(html).not.toContain(absent);
    }
  });

  it("leaves the date out when the data has none", () => {
    const data = response({ survey: { ...survey, updatedAt: "" } });
    const html = render(data, loadedUi(data, false));
    expect(html).not.toContain("Cập nhật lúc");
    expect(html).toMatch(editLink);
  });

  it("opens the form from Chỉnh sửa khảo sát: five numbered items, Thế mạnh second, Hủy, Xóa câu trả lời and Lưu khảo sát", () => {
    const data = response();
    const ui = openedUi(loadedUi(data, false));
    expect(ui.editing).toBe(true);
    const html = render(data, ui);
    expect(isForm(html)).toBe(true);
    expect(html).toContain("Trả lời 5 câu để EduPath AI gợi ý thêm vị trí hợp với sở thích, thế mạnh và soạn lộ trình sát hơn.");
    expect(html).toContain('name="ps-field" checked="" value="data"');
    expect(html).toContain('name="ps-selfStudy" checked="" value="high"');
    const at = (text: string) => html.indexOf(text);
    expect(at("Lĩnh vực quan tâm nhất")).toBeLessThan(at("Thế mạnh của bạn"));
    expect(at("Thế mạnh của bạn")).toBeLessThan(at("Mục tiêu sau tốt nghiệp"));
    expect(html).toMatch(/<span class="ps-number" aria-hidden="true">2<\/span><span>Thế mạnh của bạn/);
    expect(html).toMatch(/<span class="ps-number" aria-hidden="true">5<\/span><span>Tiếng Anh chuyên ngành/);
    expect(html).toContain("Hủy</button>");
    expect(html).toContain("Xóa câu trả lời</button>");
    expect(html).not.toContain("Chỉnh sửa khảo sát");
    expect(html).not.toContain('class="ps-brief"');
    for (const gone of ["Sở trường", "Thành tích", "ps-achievements"]) expect(html).not.toContain(gone);
    // Answers that count need no new consent.
    expect(html).not.toContain("Tôi đồng ý");
  });

  it("folds Thế mạnh to six technologies and the chosen ones, with + N công nghệ khác", () => {
    const html = render(response(), openedUi(loadedUi(response(), false)));
    expect(html).toContain("+ 2 công nghệ khác</button>");
    expect(html).not.toContain("Selenium");
    // The chosen ones show even past the fold; unfolded, all of them.
    expect(visibleInterests(tech, ["selenium"], 6, false).map((option) => option.label)).toEqual(["Python", "SQL", "React", "Docker", "Kotlin", "Unity", "Selenium"]);
    expect(visibleInterests(tech, [], 6, true)).toHaveLength(8);
    expect(visibleInterests(tech, [], undefined, false)).toHaveLength(8);
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
    expect(html).not.toContain("Không lưu được khảo sát");
    expect(html).toMatch(editLink);
    const again = render(data, openedUi(cancelled));
    expect(again).toContain('name="ps-goal" checked="" value="work"');
    expect(again).not.toContain('checked="" value="study"');
  });

  it("returns to the summary after saving, the message read with Chỉnh sửa khảo sát", () => {
    const html = render(response(), savedUi(survey));
    expect(isForm(html)).toBe(false);
    expect(html).toContain('<p class="sr-success" id="ps-message" role="status">Đã lưu Khảo sát nhanh. EduPath AI dùng các câu trả lời này để gợi ý vị trí nghề nghiệp và soạn lộ trình học tập cho bạn.</p>');
    expect(html).toContain('<button type="button" class="sw-text-link" aria-describedby="ps-message">');
  });
});

describe("Khảo sát nhanh not done", () => {
  it("keeps the form open, marked Không bắt buộc, with what is missing", () => {
    const data = response({ survey: partial });
    const ui = loadedUi(data, false);
    expect(ui.editing).toBe(true);
    const html = render(data, ui);
    expect(isForm(html)).toBe(true);
    expect(html).toContain('<span class="sw-tag ps-tag-optional">Không bắt buộc · 1 phút</span>');
    expect(html).toContain("<strong>Để hoàn thành khảo sát, bạn cần:</strong><ul><li>Trả lời 1 câu hỏi còn thiếu</li></ul>");
    // Optional: nothing red, nothing says a roadmap needs it.
    for (const gone of ["ps-survey-todo", "ps-tag-required", "Bắt buộc<", "trước khi tạo Lộ trình AI"]) expect(html).not.toContain(gone);
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
    expect(html).toContain("Tôi đồng ý để EduPath AI dùng câu trả lời Khảo sát nhanh để gợi ý vị trí nghề nghiệp và tư vấn lộ trình học tập bằng AI");
    expect(html).toContain("(Chính sách vừa được cập nhật, vui lòng xác nhận lại.)");
  });

  it("starts with the empty form and no Hủy when nothing is stored", () => {
    const data = response({ survey: null, consentVersion: null });
    const html = render(data, loadedUi(data, false));
    expect(isForm(html)).toBe(true);
    expect(html).toContain('<span class="sw-tag ps-tag-optional">Không bắt buộc · 1 phút</span>');
    expect(html).not.toContain("Hủy</button>");
    expect(html).not.toContain("Xóa câu trả lời");
    expect(html).not.toContain("Để hoàn thành khảo sát");
    // Even a closed form state shows the form: there is nothing to sum up.
    expect(isForm(render(data, { ...loadedUi(data, false), editing: false }))).toBe(true);
  });

  it("sums up an unfinished survey after Hủy, with Chỉnh sửa khảo sát to go on", () => {
    const data = response({ survey: partial });
    const html = render(data, cancelledUi(loadedUi(data, false), data));
    expect(isForm(html)).toBe(false);
    expect(html).toContain('<span class="sw-tag ps-tag-optional">Không bắt buộc · 1 phút</span>');
    expect(html).toContain("<li>Trả lời 1 câu hỏi còn thiếu</li>");
    expect(html).toContain('<dt>Thời gian tự học mỗi tuần</dt><dd><span class="ps-none">Chưa trả lời</span></dd>');
    expect(html).toMatch(editLink);
  });
});

describe("Khảo sát nhanh in the tab of a cố vấn học tập or the Khoa (policy 2026-11-10)", () => {
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
    expect(surveyProblems(questions, openedUi(loadedUi(data)).draft, { needsConsent: false, consented: false })).toEqual([]);
  });

  it("offers Làm khảo sát thay sinh viên when there is none, and nothing after the student withdrew the consent", () => {
    advisor();
    const none = response({ survey: null, consentVersion: null });
    const ui = loadedUi(none);
    expect(ui.editing).toBe(false);
    const empty = render(none, ui);
    expect(isForm(empty)).toBe(false);
    expect(empty).toContain('<p class="sw-advisor-note">Sinh viên chưa làm Khảo sát nhanh.</p>');
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
    expect(savedUi(survey, true).message).toBe("Đã lưu Khảo sát nhanh của sinh viên. EduPath AI dùng các câu trả lời này để gợi ý vị trí nghề nghiệp và soạn lộ trình học tập cho sinh viên.");
  });
});

describe("Khảo sát nhanh a cố vấn học tập filled in, in the student's own page (policy 2026-11-10)", () => {
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
    expect(html).toContain("Tôi đồng ý để EduPath AI dùng câu trả lời Khảo sát nhanh");
    expect(html).not.toContain("Chính sách vừa được cập nhật");
    expect(html).toContain("Xóa câu trả lời</button>");
    expect(html).not.toContain("sw-advisor-note");
  });
});

describe("Khảo sát nhanh while loading", () => {
  it("keeps the section id, so the buttons of Định hướng nghề nghiệp can open it", () => {
    const html = renderToStaticMarkup(<StudentProfileSurvey onSaved={() => {}} />);
    expect(html).toContain('id="khao-sat-nhanh"');
    expect(html).toContain("Đang tải Khảo sát nhanh…");
  });
});
