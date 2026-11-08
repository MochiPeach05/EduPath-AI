import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdvisorDetailDialog, AdvisorTable, ClassChips, ImportPreview } from "./AdvisorsManagement";
import AdvisorPortal, { ClassTable, SCOPE_TEXT, StudentTable, withClass } from "./AdvisorPortal";
import { useTableSort } from "./table-sort";
import { ADVISORS_API, type AdvisedStudentRow, type AdvisorClass, type AdvisorImportPreview, type AdvisorRow } from "./advisor-types";

// Each request answers what a test gave for its address; any other is still loading, as on a page's first paint.
const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));
const answers = new Map<string, unknown>();
liveData.mockImplementation((url: string) => answers.has(url) ? { data: answers.get(url), error: null, loading: false } : { data: null, error: null, loading: true });
afterEach(() => answers.clear());

const advisor = (over: Partial<AdvisorRow> = {}): AdvisorRow => ({
  stt: 1, userId: "11111111-1111-4111-8111-111111111111", name: "Nguyễn Văn An", email: "an.nv@vlu.edu.vn", staffCode: "GV001", unit: "Bộ môn CNPM",
  classes: ["71K29CNTT01", "71K29CNTT02", "71K29CNTT03", "71K29CNTT04"], students: 182, account: "pending", role: "advisor", lastLoginAt: null, ...over,
});

function Advisors({ rows, canManage }: { rows: AdvisorRow[]; canManage: boolean }) {
  const { sort, sortHeader } = useTableSort();
  return <AdvisorTable rows={rows} canManage={canManage} sort={sort} sortHeader={sortHeader} page={1} onPick={() => undefined} />;
}
function Classes({ classes, showAdvisor }: { classes: AdvisorClass[]; showAdvisor?: boolean }) {
  const { sort, sortHeader } = useTableSort();
  return <ClassTable classes={classes} sort={sort} sortHeader={sortHeader} selected="71K29CNTT02" onPick={() => undefined} showAdvisor={showAdvisor} />;
}
function Students({ students }: { students: AdvisedStudentRow[] }) {
  const { sortHeader } = useTableSort();
  return <StudentTable students={students} page={1} sortHeader={sortHeader} opening={null} onOpen={() => undefined} />;
}

describe("Cố vấn page", () => {
  it("lists each advisor with the email, the classes as chips (+n) and the account state", () => {
    const html = renderToStaticMarkup(<Advisors rows={[advisor(), advisor({ stt: 2, userId: "2", name: "Trần Thị Bình", account: "active", classes: [], students: 0, staffCode: null })]} canManage={false} />);
    for (const header of ["STT", "Cố vấn học tập", "Mã giảng viên", "Đơn vị", "Lớp phụ trách", "Sinh viên", "Tài khoản"]) expect(html).toContain(`<span>${header}</span>`);
    expect(html).toContain("an.nv@vlu.edu.vn");
    expect(html).toContain('<span class="av-class">71K29CNTT03</span><span class="av-more">+1</span>');
    expect(html).toContain("Chưa đăng nhập");
    expect(html).toContain("Đang hoạt động");
    expect(html).toContain("Chưa có lớp");
    expect(html).toContain('aria-label="Thao tác với cố vấn học tập Nguyễn Văn An"');
  });

  it("colours the account red until the advisor signs in and green after, in the list and the details (user 2026-11-07)", () => {
    const list = renderToStaticMarkup(<Advisors rows={[advisor(), advisor({ stt: 2, userId: "2", account: "active" }), advisor({ stt: 3, userId: "3", account: "locked" })]} canManage />);
    expect(list).toContain('<td><span class="am-state av-state am-not-signed-in">Chưa đăng nhập</span></td>');
    expect(list).toContain('<td><span class="am-state av-state am-signed-in">Đang hoạt động</span></td>');
    // Đã khóa is another state: it keeps the red of a locked account.
    expect(list).toContain('<td><span class="am-state av-state am-state-locked">Đã khóa</span></td>');
    const details = (over: Partial<AdvisorRow>) => {
      const row = advisor(over);
      answers.set(`${ADVISORS_API}/${row.userId}`, { advisor: { ...row, createdAt: "2026-11-03T01:00:00.000Z", updatedAt: "2026-11-03T01:00:00.000Z", classDetails: [] } });
      return renderToStaticMarkup(<AdvisorDetailDialog id={row.userId} canManage={false} close={() => undefined} edit={() => undefined} />);
    };
    const pending = details({});
    expect(pending).toContain('<dt>Tài khoản</dt><dd><span class="am-state av-state am-not-signed-in">Chưa đăng nhập</span></dd>');
    expect(pending).toContain('<dt>Đăng nhập gần nhất</dt><dd><span class="am-not-signed-in">Chưa đăng nhập</span></dd>');
    const active = details({ account: "active", lastLoginAt: "2026-11-06T02:15:00.000Z" });
    expect(active).toContain('<dt>Tài khoản</dt><dd><span class="am-state av-state am-signed-in">Đang hoạt động</span></dd>');
    expect(active).toContain('<dt>Đăng nhập gần nhất</dt><dd><span class="am-signed-in">09:15 06/11/2026</span></dd>');
  });

  it("writes the whole list of classes in a chip row's tooltip", () => {
    expect(renderToStaticMarkup(<ClassChips classes={["A", "B"]} shown={1} />)).toBe('<span class="av-classes" title="A, B"><span class="av-class">A</span><span class="av-more">+1</span></span>');
  });

  it("previews an import with the rows, the classes after splitting, the status and what changes", () => {
    const preview: AdvisorImportPreview = {
      fileName: "co-van-hoc-tap.xlsx", rows: 4, fileProblems: [],
      summary: { add: 1, update: 1, unchanged: 0, error: 1, classes: 3, moved: 1 },
      items: [
        { rows: [2, 3], name: "Nguyễn Văn An", email: "an.nv@vlu.edu.vn", staffCode: "GV001", unit: null, classes: ["71K29CNTT01", "71K29CNTT02"], status: "update",
          changes: ["Thêm lớp 71K29CNTT02", "Lớp 71K29CNTT01 chuyển từ Trần Thị Bình"], problems: [], emptyClasses: ["71K29CNTT02"] },
        { rows: [4], name: "Lê Văn Cường", email: "cuong@gmail.com", staffCode: null, unit: null, classes: ["71K30CNTT01"], status: "error",
          changes: [], problems: ["Email không phải email của trường (@vlu.edu.vn hoặc @vanlanguni.vn)."], emptyClasses: [] },
        { rows: [5], name: "Phạm Thu Dung", email: "dung.pt@vlu.edu.vn", staffCode: null, unit: "Bộ môn HTTT", classes: ["71K30CNTT02"], status: "add",
          changes: ["Thêm cố vấn mới"], problems: [], emptyClasses: [] },
      ],
    };
    const html = renderToStaticMarkup(<ImportPreview preview={preview} />);
    expect(html).toContain("Đọc 4 dòng · 1 thêm mới · 1 cập nhật · 1 lỗi · 3 lớp, 1 lớp chuyển cố vấn");
    expect(html).toContain('<td class="cm-stt">2, 3</td>');
    expect(html).toContain('<span class="av-status av-status-update">Cập nhật</span>');
    expect(html).toContain('<span class="av-status av-status-error">Lỗi</span>');
    expect(html).toContain('<li class="av-note-change">Lớp 71K29CNTT01 chuyển từ Trần Thị Bình</li>');
    expect(html).toContain('<li class="av-note-error">Email không phải email của trường (@vlu.edu.vn hoặc @vanlanguni.vn).</li>');
    expect(html).toContain("Chưa có sinh viên trong EduPath AI: 71K29CNTT02");
    expect(html).toContain("Các cố vấn có Lỗi sẽ được bỏ qua");
    expect(html).toContain('<tr class="av-row-error">');
  });

  it("names the problems of the whole file", () => {
    const html = renderToStaticMarkup(<ImportPreview preview={{ fileName: "x.xlsx", rows: 0, items: [], fileProblems: ["Không tìm thấy cột Email."], summary: { add: 0, update: 0, unchanged: 0, error: 0, classes: 0, moved: 0 } }} />);
    expect(html).toContain("Tệp chưa đọc được hết");
    expect(html).toContain("<li>Không tìm thấy cột Email.</li>");
    expect(html).not.toContain("<table");
  });
});

describe("Quản lý sinh viên page (2026-11-03)", () => {
  // advisorName: the class's cố vấn học tập, null when the Khoa has assigned none.
  const classes: AdvisorClass[] = [
    { className: "71K29CNTT01", cohort: "K29", students: 45, withTranscript: 38, assessed: 30, surveyDone: 20, roadmap: 12, advisorName: "Nguyễn Văn An" },
    { className: "71K29CNTT02", cohort: "K29", students: 0, withTranscript: 0, assessed: 0, surveyDone: 0, roadmap: 0, advisorName: null },
  ];

  it("shows each class with its students and how many did each step, the chosen class marked", () => {
    const html = renderToStaticMarkup(<Classes classes={classes} />);
    expect(html).toContain("<td class=\"av-num\">38/45</td>");
    // Khóa first, then Lớp (user 2026-11-08).
    expect(html).toMatch(/<tr class="av-row-current"><td>K\d+<\/td><td><strong>71K29CNTT02<\/strong>/);
    expect(html.indexOf("<span>Khóa</span>")).toBeLessThan(html.indexOf("<span>Lớp</span>"));
    // The chosen class's button is the current one, not a toggle: pressing it again keeps the class (QA 2026-11-04).
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).not.toContain("aria-pressed");
    expect(html).toContain("Xem sinh viên");
    // An advisor's own classes: no advisor column.
    expect(html).not.toContain("<span>Cố vấn học tập</span>");
    expect(html).not.toContain("Nguyễn Văn An");
  });

  it("keeps the class filter when Xem sinh viên is pressed a second time on the same class", () => {
    const start = { q: "nguyen", class: "", status: "no_survey" };
    const first = withClass(start, "71K29CNTT08");
    expect(first).toEqual({ q: "nguyen", class: "71K29CNTT08", status: "no_survey" });
    expect(withClass(first, "71K29CNTT08")).toEqual(first);
    // Another class replaces it; a class of another cohort with the same name is another class.
    expect(withClass(first, "71K27CNTT08").class).toBe("71K27CNTT08");
  });

  it("names the cố vấn học tập of each class when every class is listed, Chưa phân công when none", () => {
    const html = renderToStaticMarkup(<Classes classes={classes} showAdvisor />);
    expect(html).toContain('<table class="cm-table av-classes-table av-classes-table-all">');
    expect(html.indexOf("<span>Khóa</span>")).toBeLessThan(html.indexOf("<span>Cố vấn học tập</span>"));
    expect(html.indexOf("<span>Cố vấn học tập</span>")).toBeLessThan(html.indexOf("<span>Sinh viên</span>"));
    expect(html).toContain("</strong></td><td>Nguyễn Văn An</td>");
    expect(html).toContain('</strong></td><td><span class="career-empty">Chưa phân công</span></td>');
  });

  it("lists the students with their steps in words and Xem chi tiết, which opens their page", () => {
    const html = renderToStaticMarkup(<Students students={[{
      stt: 7, userId: "s1", studentCode: "2374802010994", name: "Sinh viên Thử nghiệm", className: "71K29CNTT01", cohort: "K29", specialty: "Công nghệ phần mềm",
      targetCareer: null, hasTranscript: true, assessed: false, surveyDone: true, roadmap: false, lastLoginAt: null,
    }]} />);
    expect(html).toContain('<td class="cm-stt">7</td>');
    expect(html).toContain("MSSV 2374802010994");
    expect(html).toContain("Công nghệ phần mềm");
    expect(html).toContain('<span class="career-empty">Chưa chọn</span>');
    expect(html).toContain('title="Bảng điểm: đã có"');
    expect(html).toContain('title="Đánh giá năng lực: chưa có"');
    expect(html).toContain("Xem chi tiết</button>");
    expect(html).not.toContain("Mở trang sinh viên");
    for (const header of ["Bảng điểm", "Đánh giá năng lực", "Khảo sát", "Lộ trình AI", "Vị trí mục tiêu"]) expect(html).toContain(`<span>${header}</span>`);
  });

  it("says whose students the page lists: every student for the admins, the classes of an advisor", () => {
    const all = renderToStaticMarkup(<AdvisorPortal scope="all" />);
    const own = renderToStaticMarkup(<AdvisorPortal scope="own" />);
    expect(all).toContain(SCOPE_TEXT.all.lead);
    expect(all).toContain('<h2 id="av-classes-title">Lớp</h2>');
    expect(all).toContain('<h2 id="av-students-title">Sinh viên</h2>');
    expect(own).toContain(SCOPE_TEXT.own.lead);
    expect(own).toContain('<h2 id="av-classes-title">Lớp phụ trách</h2>');
    expect(own).toContain('<h2 id="av-students-title">Sinh viên lớp phụ trách</h2>');
    for (const html of [all, own]) {
      expect(html).toContain("Bấm Xem chi tiết để mở trang của một sinh viên ở thẻ mới");
      // No section of permissions any more (user 2026-11-07: "Xóa cái quyền làm việc này đi").
      expect(html).not.toContain("Quyền khi làm việc với trang sinh viên");
    }
  });
});
