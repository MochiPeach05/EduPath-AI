import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StudentPlans from "./StudentPlans";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

// Synthetic K26-like plan rows only; no real student data.
const planId = "44444444-4444-4444-8444-444444444444";
const item = (id: string, code: string, name: string, credits: number | null, type = "BB", extra: Record<string, unknown> = {}) => ({
  id, code, name, credits, type, termCode: "HK201", semester: 1, studyYear: 1, sectionId: "", prerequisite: "", prior: "", notes: "",
  hours: { lecture: null, practice: null, project: null, internship: null }, ...extra,
});
const plan = {
  name: "Kế hoạch giảng dạy CNTT K26", major: "Công nghệ thông tin", cohortCode: "K26", totalCredits: 130,
  terms: [
    { code: "HK201", semester: 1, studyYear: 1, sourceCredits: null },
    { code: "HK202", semester: 2, studyYear: 1, sourceCredits: 18 },
  ],
  sections: [{ id: "section-36", termCode: "HK202", label: "Học phần tự chọn: chọn 1 trong các môn dưới", kind: "choice" }],
  physicalEducationGroups: { TC002: [], TC102: [] },
  items: [
    item("1", "DCT0080", "Triết học Mác Lê nin", 3),
    item("2", "DQP0021", "Giáo dục an ninh Quốc phòng", 0, "BBKTL"),
    item("3", "DIT0020", "Cơ sở lập trình", 4, "BB", { prior: "[DIT0010]Nhập môn Công nghệ thông tin" }),
    item("4", "DGT0010", "Giáo dục thể chất 1", 0, "BBKTL", { termCode: "HK202", semester: 2 }),
    item("5", "DIT0070", "Cơ sở dữ liệu", 3, "BB", { termCode: "HK202", semester: 2 }),
    item("6", "DIT0140", "Hệ Quản trị Cơ sở dữ liệu", 3, "TC118", { termCode: "HK202", semester: 2, sectionId: "section-36" }),
  ],
};
const row = (code: string, result: string | null, letter: string | null) =>
  ({ code, name: code, credits: 3, score10: letter ? 7 : null, score4: letter ? 3 : null, letter, result, conditional: false });
const transcript = { transcript: { data: { sections: [{ courses: [
  row("DGT0010", "Đạt", "B"), row("DCT0080", null, null), row("DIT0070", "Không đạt", "F"), row("71ITIS30103", "Đạt", "B"),
] }] } } };
const graduation = { evaluation: { codeAliases: [{ code: "DIT0070", viaCode: "71ITIS30103", transfer: true }] } };

const ready = <T,>(value: T) => ({ data: value, error: null, loading: false });
type List = {
  items: { id: string; name: string; cohortCode: string; major: string; fromCurriculum?: boolean }[];
  suggestedId: string | null; profileCohort: string | null; profileMajor?: string | null; resolution?: string;
};
function render(list: List, detail: unknown = plan) {
  liveData.mockImplementation((url: string) => {
    if (url === "/api/student/plans") return ready(list);
    if (url === `/api/student/plans/${planId}`) return ready(detail);
    if (url === "/api/student/transcript") return ready(transcript);
    if (url === "/api/student/graduation") return ready(graduation);
    throw new Error(`Unexpected URL ${url}`);
  });
  return renderToStaticMarkup(createElement(StudentPlans));
}
const k26 = { id: planId, name: plan.name, cohortCode: "K26", major: plan.major };
// The student's own KHĐT alone (API curricula/own-program.ts, user 2026-11-10).
const own: List = { items: [k26], suggestedId: planId, profileCohort: "K26", profileMajor: "7480201", resolution: "found" };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("StudentPlans (audit 2026-10-25)", () => {
  it("shows the K26 results: DGT0010 passed under its own code, a course being studied, a retake with a later cohort", () => {
    const html = render(own);
    const cell = (code: string) => new RegExp(`<td>${code}</td>(?:(?!</tr>).)*?<td class="sc-result-cell">((?:(?!</td>).)*)</td>`, "s").exec(html)?.[1];
    expect(cell("DGT0010")).toBe('<span class="sc-result sc-result-pass" role="img" aria-label="Đã đạt" title="Đã đạt">✓</span>');
    expect(cell("DCT0080")).toBe('<span class="sc-result sc-result-info" role="img" aria-label="Đang học" title="Đang học">◐</span><small class="sc-result-note">Đang học</small>');
    expect(cell("DIT0070")).toContain("Đã học trả nợ (mã 71ITIS30103) — cần chuyển điểm");
    expect(cell("DIT0020")).toBe("");
  });

  it("adds up a term without a printed total, labels condition-only rows and reads bracketed codes", () => {
    const html = render(own);
    const visible = text(html);
    // HK201: 3 + 4 TC; GDQP (BBKTL) is left out.
    expect(visible).toContain("Tín chỉ học kỳ theo kế hoạch: 7 (cộng từ các học phần trong kỳ, không tính môn điều kiện (*))");
    expect(visible).toContain("Tín chỉ học kỳ theo kế hoạch: 18");
    expect(html).toContain("<td>Môn điều kiện (*) · không tính tích lũy</td>");
    expect(html).toContain("<div>Học trước: DIT0010 · Nhập môn Công nghệ thông tin</div>");
    expect(visible).toContain("Đây là kế hoạch giảng dạy, không phải danh sách môn bạn đã đăng ký.");
  });

  // User 2026-11-10: no choice of KHĐT; without one of their own (and no CTĐT to read it from) a card like Xét tốt nghiệp's.
  it("without a plan of the student's own, shows the not-found card and never another cohort's plan", () => {
    liveData.mockClear();
    const html = render({ items: [], suggestedId: null, profileCohort: "K32", profileMajor: "7480201", resolution: "not_found" });
    const visible = text(html);
    expect(html).toContain('<h2 id="sc-own-missing-title">Chưa có kế hoạch đào tạo cho khóa K32, ngành Công nghệ thông tin</h2>');
    expect(visible).toContain("Khoa chưa công bố kế hoạch đào tạo của khóa K32, ngành Công nghệ thông tin. Hãy quay lại sau; nếu khóa hoặc ngành trong hồ sơ chưa đúng, hãy liên hệ Khoa để được cập nhật.");
    expect(html).toContain('<a class="sw-outline" href="#profile">Xem hồ sơ</a>');
    expect(visible).not.toContain("Đây là kế hoạch giảng dạy");
    expect(html).not.toContain("sp-content");
    // An older API listing every plan: another cohort's is never opened.
    const other = render({ items: [{ ...k26, cohortCode: "K29", id: "55555555-5555-4555-8555-555555555555" }], suggestedId: null, profileCohort: "K27" });
    expect(text(other)).toContain("Chưa có kế hoạch đào tạo cho khóa K27");
    expect(liveData.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/student/plans/"))).toEqual([]);
  });

  it("offers no choice and says whose plan it is, with the way to check the profile", () => {
    const html = render(own);
    const visible = text(html);
    expect(visible).toContain("Kế hoạch đào tạo của khóa K26, ngành Công nghệ thông tin theo hồ sơ của bạn. Xem hồ sơ");
    expect(html).toContain('<a class="sp-link" href="#profile">Xem hồ sơ</a>');
    expect(visible).not.toMatch(/Kế hoạch đang mở|Chọn kế hoạch|tham khảo|Kế hoạch cùng khóa tuyển sinh/);
    expect(html).not.toContain("sp-selector");
    // Search and the term filter stay.
    expect(html).toContain('<option value="" selected="">Tất cả học kỳ</option>');
  });

  it("reads a row the file writes under another code by its real code only (API curricula/real-codes.ts)", () => {
    const withReal = { ...plan, items: [
      item("1", "71ITMA10203", "Đại số tuyến tính và ứng dụng", 3, "BB", { realCode: "71MATL10053" }),
      item("2", "71ITSE20103", "Toán rời rạc", 3, "BB", { prerequisite: "[71ITMA10203]Đại số tuyến tính và ứng dụng" }),
    ] };
    liveData.mockImplementation((url: string) => {
      if (url === "/api/student/plans") return ready(own);
      if (url === `/api/student/plans/${planId}`) return ready(withReal);
      if (url === "/api/student/transcript") return ready({ transcript: { data: { sections: [{ courses: [row("71MATL10053", "Đạt", "B")] }] } } });
      if (url === "/api/student/graduation") return ready(graduation);
      throw new Error(`Unexpected URL ${url}`);
    });
    const html = renderToStaticMarkup(createElement(StudentPlans));
    expect(html).not.toContain("71ITMA10203");
    expect(html).toContain("<td>71MATL10053</td>");
    expect(html).toContain("<div>Tiên quyết: 71MATL10053 · Đại số tuyến tính và ứng dụng</div>");
    expect(new RegExp('<td>71MATL10053</td>(?:(?!</tr>).)*?aria-label="Đã đạt"', "s").test(html)).toBe(true);
  });

  it("shows the plan read from the CTĐT of a cohort without a KHĐT and says so (user 2026-11-05)", () => {
    const fromCurriculum = { id: "ctdt-66666666-6666-4666-8666-666666666666", cohortCode: "K27", major: "CÔNG NGHỆ THÔNG TIN",
      name: "Kế hoạch đào tạo ngành CÔNG NGHỆ THÔNG TIN khóa 27 (theo chương trình đào tạo)", fromCurriculum: true };
    liveData.mockImplementation((url: string) => {
      if (url === "/api/student/plans") return ready({ items: [fromCurriculum], suggestedId: fromCurriculum.id, profileCohort: "K27", profileMajor: "7480201", resolution: "found" });
      if (url === `/api/student/plans/${fromCurriculum.id}`) return ready({ ...plan, name: fromCurriculum.name, major: fromCurriculum.major, cohortCode: "K27", admissionYear: 2022, unplacedCount: 2 });
      if (url === "/api/student/transcript") return ready(transcript);
      if (url === "/api/student/graduation") return ready(graduation);
      throw new Error(`Unexpected URL ${url}`);
    });
    const html = renderToStaticMarkup(createElement(StudentPlans));
    const visible = text(html);
    expect(visible).toContain("Khóa K27, ngành Công nghệ thông tin chưa có kế hoạch đào tạo riêng; các học kỳ dưới đây lấy từ năm học, học kỳ dự kiến của từng học phần trong Chương trình đào tạo của bạn. Đây là kế hoạch giảng dạy, không phải danh sách môn bạn đã đăng ký.");
    expect(html).toContain('<a class="sp-link" href="#curriculum">Chương trình đào tạo</a>');
    expect(html).toContain("<h2>Kế hoạch đào tạo ngành Công nghệ thông tin khóa 27 (theo chương trình đào tạo)</h2>");
    expect(visible).toContain("2 học phần trong chương trình đào tạo không ghi năm học, học kỳ dự kiến nên không có trong kế hoạch này.");
    expect(visible).not.toContain("Chưa có kế hoạch đào tạo cho khóa K27");
  });

  it("writes each term the one way and a capital name in sentence case (user review 2026-10-30)", () => {
    const capital = { ...k26, name: "KẾ HOẠCH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN - KHÓA 26", major: "CÔNG NGHỆ THÔNG TIN" };
    liveData.mockImplementation((url: string) => {
      if (url === "/api/student/plans") return ready({ items: [capital], suggestedId: planId, profileCohort: "K26", profileMajor: "7480201", resolution: "found" });
      if (url === `/api/student/plans/${planId}`) return ready({ ...plan, name: capital.name, major: capital.major, admissionYear: 2020 });
      if (url === "/api/student/transcript") return ready(transcript);
      if (url === "/api/student/graduation") return ready(graduation);
      throw new Error(`Unexpected URL ${url}`);
    });
    const html = renderToStaticMarkup(createElement(StudentPlans));
    expect(html).toContain("<h2>Kế hoạch đào tạo ngành Công nghệ thông tin – khóa 26</h2>");
    expect(text(html)).toContain("Công nghệ thông tin · K26 · Tổng tín chỉ quy định: 130");
    expect(html).toContain("<h3>HK1 2020–2021</h3>");
    expect(html).toContain('<option value="HK202">HK2 2020–2021</option>');
    expect(html).not.toMatch(/Năm 1 · Học kỳ|Năm học · Học kỳ/);
  });
});
