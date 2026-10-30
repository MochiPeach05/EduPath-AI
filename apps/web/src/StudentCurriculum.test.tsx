import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StudentCurriculum, { CourseDetail } from "./StudentCurriculum";
import type { StudentCourse, StudentCurriculumData, StudentCurriculumList } from "./student-curriculum-types";
import type { StudentGraduationResponse } from "./student-graduation-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

// Synthetic K27-like rows only; no real student data.
const curriculumId = "33333333-3333-4333-8333-333333333333";
const course = (code: string, name: string, extra: Partial<StudentCourse> = {}): StudentCourse => ({
  code, name, englishName: "", description: null, credits: 3, type: "BB", block: "", specialty: "", groupId: "core",
  semester: 1, studyYear: 1, department: "", hours: { lecture: null, practice: null, project: null, internship: null },
  notes: "", prerequisite: "", prior: "", scheduleNeedsReview: false, conditions: [], ...extra,
});
const courses = [
  course("DIT0070", "Cơ sở dữ liệu"),
  course("71ITGR40106", "Khoá luận tốt nghiệp", { credits: 6 }),
  course("71ENG110013", "Anh văn 1", { prerequisite: "[71ENG010012]Anh văn dự bị (AV0)" }),
  course("71ITSE30303", "Cấu trúc dữ liệu và giải thuật"),
  course("71NAD110013", "Giáo dục quốc phòng 1", { credits: 0, groupId: "gdqp" }),
  course("71PEKC10062", "Cờ vua", { credits: 2, type: "TC002 (2TC)", groupId: "gdqp" }),
  // The same course in two specialties (K27 71ITDS40503): one row each, each with its own type.
  course("71ITDS40503", "Mã hóa và an toàn dữ liệu", { type: "TC203", groupId: "cndl", specialty: "Công nghệ Dữ liệu" }),
  course("71ITDS40503", "Mã hóa và an toàn dữ liệu", { type: "BB", groupId: "anm", specialty: "An ninh Mạng và IoT" }),
  course("71ITSE30803", "Lập trình Java nâng cao", { type: "TC309", groupId: "tc", specialty: "Tự chọn Chuyên ngành" }),
  course("71ITSE30903", "Thiết kế giao diện người dùng", { type: "TC309", groupId: "tc", specialty: "Tự chọn Chuyên ngành" }),
  course("71ITGR40206", "Đồ án Tốt nghiệp", { type: "TC", groupId: "tn", specialty: "Học phần thay thế Đồ án tốt nghiệp" }),
];
const data: StudentCurriculumData = {
  id: curriculumId, version: 1, name: "KHUNG CHƯƠNG TRÌNH ĐÀO TẠO KHÓA 27", major: "Công nghệ thông tin", cohortCode: "K27",
  admissionYear: 2021, totalCredits: 130,
  groups: [
    { id: "core", label: "Kiến thức chung", credits: null }, { id: "gdqp", label: "Giáo dục thể chất và quốc phòng", credits: null },
    { id: "cndl", label: "Chuyên ngành Công nghệ Dữ liệu", credits: null }, { id: "anm", label: "Chuyên ngành An ninh Mạng và IoT", credits: null },
    { id: "tc", label: "Tự chọn chuyên ngành", credits: null }, { id: "tn", label: "Tốt nghiệp", credits: null },
  ],
  electives: [
    { code: "TC002", requiredCredits: 2, courseCodes: ["71PEKC10062"] },
    { code: "TC203", requiredCredits: null, courseCodes: ["71ITDS40503"] },
    { code: "TC309", requiredCredits: null, courseCodes: ["71ITSE30803", "71ITSE30903", "71ITSE30903"] },
    { code: "TC", requiredCredits: null, courseCodes: ["71ITGR40206"] },
  ],
  courses,
};
const list: StudentCurriculumList = {
  items: [{ id: curriculumId, version: 1, name: data.name, major: data.major, cohortCode: "K27", totalCredits: 130, courseCount: courses.length }],
  profileCohort: "K27", suggestedId: curriculumId,
};
const row = (code: string, result: string | null, letter: string | null, extra: Record<string, unknown> = {}) =>
  ({ code, name: code, credits: 3, score10: letter ? 7 : null, score4: letter ? 3 : null, letter, result, conditional: false, ...extra });
const transcript = {
  transcript: {
    data: {
      sections: [
        { courses: [row("71ENG110013", null, "MT")] },
        { courses: [row("DIT0070", "Không đạt", "F"), row("71ITIS30103", "Đạt", "B"), row("71ITSE30303", null, null, { score10: 6, score4: 2 })] },
        { courses: [row("71ITGR40106", null, null)] },
      ],
    },
  },
};
const graduation = {
  profile: { cohortCode: "K27", specialty: null }, resolution: "general", transcript: null, specialtySuggestion: null,
  standard: {
    id: "s", revisionId: "r", version: 1, name: "71K27CNTT_TN04 - K27CNTT-Công nghệ thông tin", cohortCode: "K27", classBlock: "", major: "",
    specialty: "", educationSystem: "", faculty: "", minimumCredits: 130, mandatoryCredits: null, electiveCredits: null,
    freeElectiveCredits: null, minimumGpa: 2, gpaScale: 4, notes: "",
    groups: [{ id: "g1", name: "Nhóm tự chọn TC209", kind: "elective", minimumCredits: 9 }],
    courses: [
      { id: "c1", groupId: "g1", code: "71ITSE30803", name: "Lập trình Java nâng cao", credits: 3, conditionOnly: false },
      { id: "c2", groupId: "g1", code: "71ITSE30903", name: "Thiết kế giao diện người dùng", credits: 3, conditionOnly: false },
    ],
  },
  evaluation: { codeAliases: [{ code: "DIT0070", viaCode: "71ITIS30103", transfer: true }] },
} as unknown as StudentGraduationResponse;

const ready = <T,>(value: T) => ({ data: value, error: null, loading: false });
function render(options: { graduation?: unknown } = {}) {
  liveData.mockImplementation((url: string) => {
    if (url === "/api/student/curricula") return ready(list);
    if (url === `/api/student/curricula/${curriculumId}`) return ready(data);
    if (url === "/api/student/transcript") return ready(transcript);
    if (url === "/api/student/graduation") return options.graduation === undefined ? ready(graduation) : options.graduation;
    throw new Error(`Unexpected URL ${url}`);
  });
  return renderToStaticMarkup(createElement(StudentCurriculum));
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("StudentCurriculum (audit 2026-10-25)", () => {
  it("draws every row once, a code listed in two groups twice, and counts each code once in the stats", () => {
    const html = render();
    expect(html.match(/<td>71ITDS40503<\/td>/g)).toHaveLength(2);
    expect(html).toContain("Tự chọn · TC203");
    expect(html).toMatch(/<dt>Học phần trong danh mục<\/dt><dd>10<small>/);
    expect(text(html)).toContain(`${courses.length} / ${courses.length} học phần`);
  });

  it("shows every result in the graduation page's words, and a retake with a later cohort as on #graduation", () => {
    const html = render();
    const visible = text(html);
    expect(html).toContain('aria-label="Đã học trả nợ" title="Đã học trả nợ">⇄</span>');
    expect(visible).toContain("Đã học trả nợ (mã 71ITIS30103) — cần chuyển điểm");
    expect(html).toContain('aria-label="Miễn thi (MT)" title="Miễn thi (MT)">✓</span><small class="sc-result-note">Miễn thi (MT)</small>');
    expect(html).toContain('aria-label="Đang học" title="Đang học">◐</span><small class="sc-result-note">Đang học</small>');
    expect(html).toContain('aria-label="Chưa rõ kết quả" title="Chưa rõ kết quả">?</span><small class="sc-result-note">Chưa rõ kết quả</small>');
    // Without the graduation data the transcript's own result stays.
    const alone = render({ graduation: { data: null, error: "x", loading: false } });
    expect(alone).toContain('aria-label="Chưa đạt" title="Chưa đạt">✗</span>');
    expect(alone).not.toContain("⇄");
  });

  it("marks GDTC/GDQP as condition-only courses and names a bare TC group", () => {
    const html = render();
    const badge = (code: string) => new RegExp(`<td>${code}</td>(?:(?!</tr>).)*?<span class="sc-badge ?(?:sc-elective)?">([^<]*)</span>`, "s").exec(html)?.[1];
    expect(badge("71NAD110013")).toBe("Môn điều kiện (*) · không tính tích lũy");
    expect(badge("71PEKC10062")).toBe("Môn điều kiện (*) · tự chọn TC002 (2TC) · không tính tích lũy");
    expect(badge("71ITGR40206")).toBe("Tự chọn (không ghi mã nhóm)");
    expect(badge("DIT0070")).toBe("Bắt buộc");
  });

  it("gives the standard's quota and code to the matching CTĐT elective group of the same cohort", () => {
    const html = render();
    expect(html).toContain("<strong>TC309</strong><p>Chọn 9 tín chỉ (theo tiêu chuẩn xét tốt nghiệp, nhóm TC209)</p><small>2 học phần trong nhóm</small>");
    expect(html).toContain("<strong>TC002</strong><p>Chọn 2 tín chỉ</p>");
    expect(html).toContain("<strong>Tự chọn (không ghi mã nhóm)</strong><p>Xem quy định tín chỉ trong khung hoặc liên hệ cố vấn học tập.</p>");
    // Another cohort's standard says nothing about this CTĐT.
    const other = { ...graduation, standard: { ...graduation.standard!, cohortCode: "K28" } };
    expect(render({ graduation: ready(other) })).not.toContain("theo tiêu chuẩn xét tốt nghiệp");
  });

  it("offers only real specialties and reads a bracketed prerequisite code", () => {
    const html = render();
    expect(html).toContain("<option>Công nghệ Dữ liệu</option><option>An ninh Mạng và IoT</option></select>");
    expect(html).not.toContain("<option>Tự chọn Chuyên ngành</option>");
    expect(html).not.toContain("<option>Học phần thay thế Đồ án tốt nghiệp</option>");
    expect(html).toContain('<span class="sc-condition-text">71ENG010012 · Anh văn dự bị (AV0)</span>');
  });

  it("writes each planned term as the cohort's calendar term and the capital name in sentence case (user review 2026-10-30)", () => {
    const html = render();
    expect(html).toContain("<h2>Khung chương trình đào tạo khóa 27</h2>");
    expect(html).toContain("<th>Học kỳ dự kiến</th>");
    expect(html).toContain('<td class="sc-term">HK1 2021–2022</td>');
    expect(html).toContain('<option value="1">2021–2022</option>');
    expect(html).toContain('<option value="1">HK1</option>');
    expect(html).not.toMatch(/Năm 1|Năm · Học kỳ|Học kỳ 1</);
  });
});

describe("CourseDetail", () => {
  it("shows the row it was opened from, not another row with the same code", () => {
    const anm = courses[7]!;
    const html = renderToStaticMarkup(createElement(CourseDetail, { course: anm, data, onClose: () => undefined, onCourse: () => undefined }));
    expect(html).toContain('<span class="sc-badge">Bắt buộc</span>');
    expect(html).not.toContain("TC203");
    expect(html).toContain("<dd>An ninh Mạng và IoT</dd>");
    expect(html).toContain('<span class="sc-badge">Học kỳ dự kiến: HK1 2021–2022</span>');
  });
});
