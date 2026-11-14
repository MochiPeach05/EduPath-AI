import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdvisorRequestError, advisorErrorText, advisorFileProblem, advisorRequest, advisorTime, classPreview, cohortOfClass, forgetChosenFile, importNothingText, importResultText,
  importSummaryText, importableCount, isStudentStatus, matchesSearch, openStudentPage, readWorkbook, splitClasses, uploadWorkbook,
} from "./advisor-admin";

afterEach(() => vi.unstubAllGlobals());

describe("advisor admin helpers", () => {
  it("splits typed classes the way the API stores them: commas, semicolons, slashes, new lines, no spaces, upper case, once each", () => {
    expect(splitClasses("71k29cntt01, 71K29CNTT02;71K29CNTT03\n 71K30 CNTT01 / 71k29cntt01")).toEqual(["71K29CNTT01", "71K29CNTT02", "71K29CNTT03", "71K30CNTT01"]);
    expect(splitClasses(" , ;\n")).toEqual([]);
  });

  it("shows the first classes of a cell and counts the rest", () => {
    expect(classPreview(["A", "B", "C", "D", "E"])).toEqual({ shown: ["A", "B", "C"], more: 2 });
    expect(classPreview(["A"], 3)).toEqual({ shown: ["A"], more: 0 });
    expect(cohortOfClass("71K29CNTT01")).toBe("K29");
    expect(cohortOfClass("DH20IT01")).toBeNull();
  });

  it("names the classes another advisor holds", () => {
    expect(advisorErrorText("class_taken", { classes: [{ className: "71K29CNTT01", advisorName: "Nguyễn Văn A" }] }))
      .toBe("Lớp 71K29CNTT01 (Nguyễn Văn A) đang do cố vấn học tập khác phụ trách. Bỏ lớp khỏi cố vấn đó trước, hoặc import danh sách mới để chuyển lớp.");
    expect(advisorErrorText("class_taken", { classes: [{ className: "A" }, { className: "B", advisorName: " " }] })).toMatch(/^Các lớp A, B đang do/);
    expect(advisorErrorText("class_taken")).toBe("Có lớp đang do cố vấn học tập khác phụ trách.");
    expect(advisorErrorText("read_only_role")).toBe("Cố vấn học tập chỉ có quyền xem ở trang quản trị.");
    // Any other code is worded by the status, as on every admin page (admin-errors.ts).
    expect(advisorErrorText("something_else")).toBe("Hệ thống đang bận hoặc gặp lỗi. Vui lòng thử lại sau.");
    expect(advisorErrorText("something_else", {}, 400)).toBe("Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.");
  });

  it("sums up a preview and a result in words, leaving out what is zero", () => {
    expect(importSummaryText({ add: 3, update: 2, unchanged: 0, error: 1, classes: 14, moved: 2 })).toBe("3 thêm mới · 2 cập nhật · 1 lỗi · 14 lớp, 2 lớp chuyển cố vấn");
    expect(importSummaryText({ add: 0, update: 0, unchanged: 0, error: 0, classes: 0, moved: 0 })).toBe("Không có cố vấn nào");
    expect(importableCount({ summary: { add: 3, update: 2, unchanged: 4, error: 1, classes: 9, moved: 0 } })).toBe(5);
    expect(importResultText({ added: 3, updated: 0, unchanged: 1, skipped: 2 })).toBe("Đã import danh sách cố vấn học tập: 3 thêm mới, 1 không đổi; bỏ qua 2 cố vấn có lỗi.");
    expect(importResultText({ added: 0, updated: 0, unchanged: 0, skipped: 0 })).toBe("Đã import danh sách cố vấn học tập.");
  });

  // User 2026-11-14: "Phải cho phép import lại file Excel sau khi dữ liệu thay đổi. Không chỉ import một lần."
  it("reads a chosen tệp once: the preview and the import send the same bytes, even when the tệp is saved again in between", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    const first = new Uint8Array([80, 75, 3, 4, 1]).buffer;
    // The tệp on disk changes after it was chosen: a second read would give other bytes.
    const arrayBuffer = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(new Uint8Array([80, 75, 3, 4, 2]).buffer);
    const workbook = await readWorkbook({ name: "CVHT 2026–2027.xlsx", arrayBuffer });
    await uploadWorkbook("/api/admin/advisors/import/preview", workbook);
    await uploadWorkbook("/api/admin/advisors/import", workbook);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["/api/admin/advisors/import/preview", "/api/admin/advisors/import"]);
    for (const call of fetch.mock.calls) {
      expect((call as unknown[])[1]).toMatchObject({ method: "POST", body: first, headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x-filename": encodeURIComponent("CVHT 2026–2027.xlsx") } });
    }
    await expect(readWorkbook({ name: "x.xlsx", arrayBuffer: vi.fn().mockRejectedValue(new DOMException("changed", "NotReadableError")) }))
      .rejects.toThrow("Không đọc được tệp này. Vui lòng chọn lại tệp.");
  });

  it("lets the same path be chosen again: the file input forgets its tệp when clicked", () => {
    const input = { value: "C:\\fakepath\\CVHT 2026–2027.xlsx" };
    forgetChosenFile({ currentTarget: input });
    expect(input.value).toBe("");
  });

  it("says why a preview of the same tệp has nothing to import", () => {
    expect(importNothingText({ add: 0, update: 0, unchanged: 9, error: 0, classes: 11, moved: 0 })).toBe("Mọi dòng trong tệp đều giống danh sách hiện tại, không có gì cần cập nhật.");
    expect(importNothingText({ add: 0, update: 0, unchanged: 3, error: 1, classes: 4, moved: 0 })).toBe("Các dòng không có lỗi đều giống danh sách hiện tại, không có gì cần cập nhật.");
    expect(importNothingText({ add: 0, update: 5, unchanged: 3, error: 0, classes: 10, moved: 1 })).toBeNull();
    expect(importNothingText({ add: 0, update: 0, unchanged: 0, error: 2, classes: 0, moved: 0 })).toBeNull();
  });

  it("searches without accents and knows the status filter values", () => {
    expect(matchesSearch("nguyen van", "Nguyễn Văn A", "a@vlu.edu.vn")).toBe(true);
    expect(matchesSearch("71k29", null, "71K29CNTT01")).toBe(true);
    expect(matchesSearch("tran", "Nguyễn Văn A")).toBe(false);
    expect(isStudentStatus("no_survey")).toBe(true);
    expect(isStudentStatus("deleted")).toBe(false);
  });

  it("prints times in Vietnam and says when there is none", () => {
    expect(advisorTime("2026-11-03T01:30:00Z")).toBe("08:30 03/11/2026");
    expect(advisorTime(null)).toBe("Chưa đăng nhập");
    expect(advisorTime("x", "—")).toBe("—");
  });

  it("turns an error answer into its message and keeps the code", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "class_taken", classes: [{ className: "71K29CNTT01", advisorName: "B" }] }), { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    const failure = await advisorRequest("/api/admin/advisors", { method: "POST", body: "{}" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdvisorRequestError);
    expect(failure).toMatchObject({ code: "class_taken", status: 409 });
    expect((failure as Error).message).toMatch(/^Lớp 71K29CNTT01 \(B\)/);
    expect(fetch).toHaveBeenCalledWith("/api/admin/advisors", expect.objectContaining({ credentials: "include", headers: { "Content-Type": "application/json" } }));
  });

  it("opens the tab at once, then sends it to the student's page; a refused tab gives the address back", async () => {
    const tab = { opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    const win = { open: vi.fn(() => tab as unknown as Window) };
    await expect(openStudentPage(async () => ({ url: "/dashboard?sv=1#overview" }), win)).resolves.toBeNull();
    expect(win.open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    expect(tab.location.replace).toHaveBeenCalledWith("/dashboard?sv=1#overview");

    await expect(openStudentPage(async () => { throw new Error("Sinh viên này không thuộc lớp bạn phụ trách."); }, win)).rejects.toThrow("không thuộc lớp");
    expect(tab.close).toHaveBeenCalled();

    const blocked = { open: vi.fn(() => null) };
    await expect(openStudentPage(async () => ({ url: "/dashboard?sv=2#overview" }), blocked)).resolves.toBe("/dashboard?sv=2#overview");
  });
});

// QA 2026-11-14 (user: "Kiểm thử các trường hợp file Excel sai cấu trúc, thêm cột, thừa dữ liệu hoặc khác file mẫu. Cần có
// cách xử lý và thông báo phù hợp"). Made-up file names and sizes.
describe("Import danh sách cố vấn học tập: a tệp that cannot be read", () => {
  it("refuses an .xls, a CSV, another type, an empty tệp and one over 5 MB in the dialog, saying how to fix it", () => {
    expect(advisorFileProblem({ name: "CVHT 2026-2027.xlsx", size: 40_000 })).toBe("");
    expect(advisorFileProblem({ name: "CVHT.XLSX", size: 5 * 1024 * 1024 })).toBe("");
    expect(advisorFileProblem({ name: "CVHT cũ.xls", size: 40_000 }))
      .toBe("Tệp “CVHT cũ.xls” là bảng tính Excel 97–2003 (.xls), chưa đọc được. Mở tệp bằng Excel, chọn Lưu thành → Excel Workbook (.xlsx) rồi chọn lại tệp.");
    expect(advisorFileProblem({ name: "cvht.csv", size: 300 }))
      .toBe("Tệp “cvht.csv” là tệp CSV, chưa đọc được. Mở tệp bằng Excel, chọn Lưu thành → Excel Workbook (.xlsx) rồi chọn lại tệp.");
    expect(advisorFileProblem({ name: "cvht.pdf", size: 300 })).toBe("Tệp “cvht.pdf” không đúng định dạng. Hãy chọn tệp .xlsx.");
    expect(advisorFileProblem({ name: "rong.xlsx", size: 0 })).toBe("Tệp “rong.xlsx” không có dữ liệu. Hãy chọn lại tệp .xlsx.");
    expect(advisorFileProblem({ name: "lon.xlsx", size: 6 * 1024 * 1024 })).toBe("Tệp “lon.xlsx” lớn hơn 5 MB. Hãy chọn tệp .xlsx không quá 5 MB.");
  });

  it("shows what the API found in the tệp (sheet, header row, columns) and words the other refusals itself", () => {
    const message = 'Trang "CVHT" (dòng tiêu đề 5) thiếu cột EMAIL. Cần đủ các cột CVHT (họ và tên), EMAIL và MÃ LỚP: thêm cột còn thiếu hoặc sửa tên cột cho giống tệp mẫu, rồi chọn lại tệp.';
    expect(advisorErrorText("missing_columns", { message }, 400)).toBe(message);
    expect(advisorErrorText("empty_workbook", { message: " Trang \"CVHT\" có dòng tiêu đề (dòng 5) nhưng chưa có cố vấn nào bên dưới. " }, 400))
      .toBe("Trang \"CVHT\" có dòng tiêu đề (dòng 5) nhưng chưa có cố vấn nào bên dưới.");
    expect(advisorErrorText("missing_columns", {}, 400)).toBe("Tệp Excel thiếu cột CVHT (họ và tên), EMAIL hoặc MÃ LỚP. Sửa tên cột cho giống tệp mẫu rồi chọn lại tệp.");
    expect(advisorErrorText("legacy_workbook", {}, 400)).toMatch(/^Tệp là bảng tính Excel 97–2003 \(\.xls\) hoặc đang đặt mật khẩu/);
    expect(advisorErrorText("invalid_workbook", {}, 400)).toMatch(/^Tệp không phải bảng tính Excel \(\.xlsx\) hợp lệ hoặc đã bị hỏng\./);
    // A message is only taken for the tệp's own refusals; another code keeps the page's text.
    expect(advisorErrorText("read_only_role", { message: "Thông điệp khác" }, 403)).toBe("Cố vấn học tập chỉ có quyền xem ở trang quản trị.");
  });

  it("passes the message of a refused preview to the dialog", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "student_list", message: "Trang \"DSSV\" có cột MSSV: đây là danh sách sinh viên." }),
      { status: 400, headers: { "Content-Type": "application/json" } })));
    await expect(advisorRequest("/api/admin/advisors/import/preview", { method: "POST", body: new ArrayBuffer(1) }))
      .rejects.toMatchObject({ code: "student_list", status: 400, message: "Trang \"DSSV\" có cột MSSV: đây là danh sách sinh viên." });
  });
});
