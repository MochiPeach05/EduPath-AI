import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdvisorRosterImport, { RosterPreview, RosterRemoveDialog, rowsText } from "./AdvisorRosterImport";
import { StudentTable } from "./AdvisorPortal";
import { useTableSort } from "./table-sort";
import type { AdvisedStudentRow } from "./advisor-types";
import {
  rosterImportUrl, rosterRemovedText, rosterResultText, rosterStudentUrl, rosterSummaryText, rosterTemplateUrl, type RosterImportPreview,
} from "./advisor-roster-types";
import { STUDENT_STATUS_TEXT } from "./advisor-admin";

// Made-up students only.
const preview: RosterImportPreview = {
  fileName: "Danh sach lop 71K29CNTT99.xlsx", rows: 4, fileProblems: [], sheets: ["Danh sách lớp"],
  notes: [{ tone: "info", text: 'Đọc trang tính "Danh sách lớp".' }, { tone: "warn", text: "Bỏ qua 1 dòng cuối danh sách không có MSSV (dòng 9): dòng tổng, chữ ký, ngày tháng. Nếu có sinh viên ở đó, ghi MSSV rồi chọn lại tệp." }],
  summary: { add: 1, update: 1, unchanged: 1, error: 1, classes: 1, moved: 1, signedIn: 2 },
  items: [
    { rows: [6], studentCode: "2374802010991", name: "Nguyễn Văn An", cohort: "K29", className: "71K29CNTT99", email: "an.2374802010991@vanlanguni.vn",
      status: "add", signedIn: false, changes: ["Thêm vào danh sách lớp 71K29CNTT99"], problems: [], warnings: [] },
    { rows: [7], studentCode: "2374802010992", name: "Trần Thị Bình", cohort: "K29", className: "71K29CNTT99", email: null, status: "update", signedIn: true,
      changes: ["Chuyển từ lớp 71K29CNTT98 (cố vấn Trần Thử Một) sang lớp 71K29CNTT99"], problems: [],
      warnings: ["Dòng 7, cột Email: binh@gmail.com không phải email sinh viên của trường (@vanlanguni.vn) nên không được lưu."] },
    { rows: [8], studentCode: "2374802010993", name: "Lê Văn Cường", cohort: "K29", className: "71K29CNTT99", email: null, status: "unchanged", signedIn: true,
      changes: [], problems: [], warnings: [] },
    { rows: [5], studentCode: "2374802010995", name: "Phạm Thị Dung", cohort: "K29", className: "71K29CNTT05", email: null, status: "error", signedIn: false,
      changes: [], problems: ["Lớp 71K29CNTT05 không thuộc các lớp bạn phụ trách nên không import được sinh viên này."], warnings: [] },
  ],
};

function Students({ students }: { students: AdvisedStudentRow[] }) {
  const { sortHeader } = useTableSort();
  return <StudentTable students={students} page={1} sortHeader={sortHeader} opening={null} onOpen={() => undefined} />;
}

describe("Import danh sách sinh viên: the dialog (reviewer note 2026-11-14)", () => {
  it("names the class and the three steps, links the sample tệp of the class and says what is kept", () => {
    const html = renderToStaticMarkup(<AdvisorRosterImport className="71K29CNTT99" close={() => undefined} imported={() => undefined} />);
    expect(html).toContain("Import danh sách sinh viên lớp 71K29CNTT99");
    expect(html).toContain("1. Chọn tệp Excel → 2. Xem trước và rà soát → 3. Xác nhận import");
    expect(html).toContain(`href="${rosterTemplateUrl("71K29CNTT99").replaceAll("&", "&amp;")}"`);
    expect(html).toContain("Tải tệp mẫu");
    expect(html).toContain("EduPath AI chỉ lưu MSSV, họ và tên, lớp và email @vanlanguni.vn");
    expect(html).toContain("Có thể import lại tệp nhiều lần sau khi sửa");
    // The dialog says tệp, never file (the input's type="file" aside).
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\bfile\b/i);
    expect(rosterImportUrl("71K29CNTT99", true)).toBe("/api/admin/advisor-portal/roster/import/preview?class=71K29CNTT99");
    expect(rosterImportUrl("71K29CNTT99", false)).toBe("/api/admin/advisor-portal/roster/import?class=71K29CNTT99");
  });

  it("previews each student with Khóa right before Lớp, the status and what changes, errors marked", () => {
    const html = renderToStaticMarkup(<RosterPreview preview={preview} />);
    expect(html).toContain("Đọc 4 dòng · 1 thêm mới · 1 cập nhật · 1 không đổi · 1 lỗi · 1 lớp · 1 sinh viên chuyển lớp · 2 sinh viên đã đăng nhập EduPath AI");
    const headers = [...html.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
    expect(headers.slice(0, 5)).toEqual(["Dòng", "Sinh viên", "Khóa", "Lớp", "Trạng thái"]);
    expect(html).toContain('<span class="av-status av-status-add">Thêm mới</span>');
    expect(html).toContain('<span class="av-status av-status-error">Lỗi</span>');
    expect(html).toContain('<tr class="av-row-error">');
    expect(html).toContain('<li class="av-note-change">Chuyển từ lớp 71K29CNTT98 (cố vấn Trần Thử Một) sang lớp 71K29CNTT99</li>');
    expect(html).toContain('<li class="av-note-error">Lớp 71K29CNTT05 không thuộc các lớp bạn phụ trách nên không import được sinh viên này.</li>');
    expect(html).toContain('<li class="av-note-warn">Dòng 7, cột Email: binh@gmail.com');
    expect(html).toContain("Đã đăng nhập EduPath AI");
    expect(html).toContain("an.2374802010991@vanlanguni.vn");
    expect(html).toContain("Các sinh viên có Lỗi sẽ được bỏ qua");
    expect(html).toContain('<li class="av-note-warn">Bỏ qua 1 dòng cuối danh sách');
  });

  it("says when a tệp chosen again holds nothing new", () => {
    const same = { ...preview, items: [preview.items[2]!], summary: { add: 0, update: 0, unchanged: 1, error: 0, classes: 1, moved: 0, signedIn: 1 } };
    expect(renderToStaticMarkup(<RosterPreview preview={same} />)).toContain("Mọi dòng trong tệp đều giống danh sách hiện tại, không có gì cần cập nhật.");
  });

  it("words the summary and the result", () => {
    expect(rosterSummaryText({ add: 0, update: 0, unchanged: 0, error: 0, classes: 0, moved: 0, signedIn: 0 })).toBe("Không có sinh viên nào");
    expect(rosterResultText("71K29CNTT99", { added: 40, updated: 2, unchanged: 3, skipped: 1 }))
      .toBe("Đã import danh sách sinh viên lớp 71K29CNTT99: 40 thêm mới, 2 cập nhật, 3 không đổi; bỏ qua 1 sinh viên có lỗi.");
    expect(rowsText([2, 3, 4, 7])).toBe("2–4, 7");
  });
});

describe("Quản lý sinh viên: students of a class list who never signed in", () => {
  it("lists them as Chưa đăng nhập, with their email and no page to open", () => {
    const html = renderToStaticMarkup(<Students students={[
      { stt: 1, userId: null, signedIn: false, email: "an.2374802010991@vanlanguni.vn", studentCode: "2374802010991", name: "Nguyễn Văn An", className: "71K29CNTT99",
        cohort: "K29", specialty: null, targetCareer: null, hasTranscript: false, assessed: false, surveyDone: false, roadmap: false, lastLoginAt: null },
      { stt: 2, userId: "s2", signedIn: true, email: null, studentCode: "2374802010994", name: "Sinh viên Thử nghiệm", className: "71K29CNTT99", cohort: "K29",
        specialty: "Công nghệ phần mềm", targetCareer: null, hasTranscript: true, assessed: true, surveyDone: false, roadmap: false, lastLoginAt: null },
    ]} />);
    expect(html).toContain('<tr class="av-row-listed">');
    expect(html).toContain('<span class="am-state av-state am-not-signed-in av-listed-state">Chưa đăng nhập</span>');
    expect(html).toContain("<small>an.2374802010991@vanlanguni.vn</small>");
    expect(html).toContain('<td colSpan="6" class="av-listed-note">Chưa có hồ sơ: sinh viên có trong danh sách lớp nhưng chưa đăng nhập EduPath AI.</td>');
    expect(html).toContain("Chưa có trang");
    // The student who signed in keeps their steps and Xem chi tiết.
    expect(html.match(/Xem chi tiết<\/button>/g)).toHaveLength(1);
    expect(html.match(/<tr/g)).toHaveLength(3);
  });

  it("asks before removing one from the class list, naming the student, the MSSV and the class", () => {
    const html = renderToStaticMarkup(<RosterRemoveDialog close={() => undefined} removed={() => undefined} student={{ stt: 1, userId: null, signedIn: false,
      email: null, studentCode: "2374802019001", name: "Nguyễn Văn Thử", className: "71K29CNTT99", cohort: "K29", specialty: null, targetCareer: null,
      hasTranscript: false, assessed: false, surveyDone: false, roadmap: false, lastLoginAt: null }} />);
    expect(html).toContain("Xóa khỏi danh sách lớp");
    expect(html).toContain("<strong>Nguyễn Văn Thử</strong>");
    expect(html).toContain("MSSV 2374802019001 · lớp 71K29CNTT99.");
    expect(html).toContain("Xác nhận xóa</button>");
    expect(html).toContain("Hủy</button>");
    expect(rosterStudentUrl("2374802019001")).toBe("/api/admin/advisor-portal/roster/students/2374802019001");
    expect(rosterRemovedText({ name: "Nguyễn Văn Thử", studentCode: "2374802019001", className: "71K29CNTT99" }))
      .toBe("Đã xóa Nguyễn Văn Thử (MSSV 2374802019001) khỏi danh sách lớp 71K29CNTT99.");
  });

  it("filters them with Chưa đăng nhập EduPath AI, right after every student", () => {
    expect(Object.entries(STUDENT_STATUS_TEXT).slice(0, 2)).toEqual([["all", "Tất cả sinh viên"], ["not_signed_in", "Chưa đăng nhập EduPath AI"]]);
  });
});
