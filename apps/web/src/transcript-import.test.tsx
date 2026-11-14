import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudentTranscript, {
  TRANSCRIPT_UPDATED_EVENT, TranscriptDropZone, TranscriptUpdateBar, announceTranscriptUpdated, fileSizeText, firstImportHint, sendImport,
  transcriptFileProblem, type Transcript,
} from "./StudentTranscript";
import { policyVersion } from "./public-information";

// Synthetic data only. Without a DOM these tests draw the first render; the requests and drag events run in the browser.
// The term tables have tests of their own (TranscriptTables.test.tsx).
vi.mock("./TranscriptTables", () => ({ default: () => null, courseMatcher: () => () => true, transcriptNotes: () => [] }));

const noop = () => {};
const target = { dragging: false, disabled: false, error: "", onChoose: noop, onDragging: noop, onFiles: noop };
const transcript: Transcript = {
  version: "00000000-0000-4000-8000-0000000000a1", filename: "bang-diem-thu-nghiem.pdf", fileSize: 245 * 1024,
  createdAt: "2026-10-20T01:00:00Z", updatedAt: "2026-11-03T07:05:00Z",
  data: { schemaVersion: 1, parserVersion: "vlu-ocr-1.1", pageCount: 3, courseCount: 54, sections: [], warnings: [] },
};
const MB = 1024 * 1024;

afterEach(() => { vi.unstubAllGlobals(); });

describe("transcript files", () => {
  it("takes one PDF of at most 5 MB and says why any other file is refused", () => {
    expect(transcriptFileProblem({ name: "bang-diem.pdf", size: 200_000 })).toBe("");
    expect(transcriptFileProblem({ name: "BANG-DIEM.PDF", size: 5 * MB })).toBe("");
    expect(transcriptFileProblem({ name: "bang-diem.docx", size: 1_000 })).toBe("Tệp “bang-diem.docx” không phải PDF. Hãy chọn tệp PDF bảng điểm xuất từ cổng đào tạo.");
    expect(transcriptFileProblem({ name: "bang-diem.pdf.png", size: 1_000 })).toContain("không phải PDF");
    expect(transcriptFileProblem({ name: "bang-diem.pdf", size: 5 * MB + 1 })).toBe("Tệp “bang-diem.pdf” lớn hơn 5 MB. Hãy dùng bản PDF xuất trực tiếp từ cổng đào tạo.");
    expect(transcriptFileProblem({ name: "bang-diem.pdf", size: 0 })).toBe("Tệp “bang-diem.pdf” rỗng. Hãy chọn lại tệp PDF bảng điểm.");
  });

  it("writes sizes in KB below 1 000 KB, else in MB with a decimal comma", () => {
    expect(fileSizeText(245 * 1024)).toBe("245 KB");
    expect(fileSizeText(100)).toBe("1 KB");
    expect(fileSizeText(1.5 * MB)).toBe("1,5 MB");
  });
});

describe("no transcript yet: the drop zone", () => {
  it("asks for a dropped PDF, or a red Chọn tệp PDF, with where the PDF comes from and the 5 MB limit", () => {
    const html = renderToStaticMarkup(createElement(TranscriptDropZone, target));
    expect(html).toContain('<p class="ti-zone-title">Kéo thả tệp PDF bảng điểm vào đây</p>');
    expect(html).toContain('<p class="ti-zone-or">hoặc</p>');
    expect(html).toMatch(/<button type="button" class="sw-primary" aria-describedby="[^"]+-hint">.*Chọn tệp PDF<\/button>/);
    expect(html).toContain("PDF xuất từ cổng đào tạo của trường, tối đa 5 MB");
    expect(html).not.toContain("is-dragging");
    expect(html).not.toContain('role="alert"');
  });

  it("lights up while a file is dragged over it and tells why a file was refused", () => {
    const dragging = renderToStaticMarkup(createElement(TranscriptDropZone, { ...target, dragging: true }));
    expect(dragging).toContain('class="ti-zone is-dragging"');
    expect(dragging).toContain("Thả tệp PDF vào đây");
    const refused = renderToStaticMarkup(createElement(TranscriptDropZone, { ...target, error: transcriptFileProblem({ name: "anh.png", size: 10 }) }));
    expect(refused).toMatch(/aria-describedby="([^"]+)-hint \1-error"/);
    expect(refused).toMatch(/<p id="[^"]+-error" class="ti-file-error" role="alert">.*Tệp “anh\.png” không phải PDF\./);
  });

  it("takes nothing while busy", () => {
    const html = renderToStaticMarkup(createElement(TranscriptDropZone, { ...target, disabled: true }));
    expect(html).toContain('class="ti-zone is-disabled"');
    expect(html).toMatch(/<button type="button" class="sw-primary" disabled=""/);
  });
});

describe("a transcript: the bar above the tables", () => {
  it("says when the transcript was last updated, names the file and offers Cập nhật bảng điểm and Xóa bảng điểm", () => {
    const html = renderToStaticMarkup(createElement(TranscriptUpdateBar, { ...target, transcript, onDelete: noop }));
    expect(html).toMatch(/Bảng điểm cập nhật lần cuối lúc <time [^>]*>14:05 03\/11\/2026<\/time>/);
    expect(html).toContain("bang-diem-thu-nghiem.pdf · 3 trang · 54 học phần");
    expect(html).toContain("Có bảng điểm mới? Kéo thả tệp PDF vào đây, tối đa 5 MB");
    expect(html).toMatch(/<button type="button" class="sw-outline"[^>]*>.*Cập nhật bảng điểm<\/button>/);
    expect(html).toMatch(/<button type="button" class="ti-delete">.*Xóa bảng điểm<\/button>/);
  });

  it("has no Xóa bảng điểm for an advisor, who may still update the transcript", () => {
    const html = renderToStaticMarkup(createElement(TranscriptUpdateBar, { ...target, transcript }));
    expect(html).not.toContain("Xóa bảng điểm");
    expect(html).toContain("Cập nhật bảng điểm");
  });

  it("takes a dropped PDF as the new transcript", () => {
    const html = renderToStaticMarkup(createElement(TranscriptUpdateBar, { ...target, transcript, onDelete: noop, dragging: true }));
    expect(html).toContain('class="ti-bar is-dragging"');
    expect(html).toContain("Thả tệp PDF vào đây để cập nhật bảng điểm");
  });
});

describe("the transcript section", () => {
  it("keeps its id for the links of other pages and loads first", () => {
    vi.stubGlobal("window", { location: { pathname: "/dashboard", search: "", hash: "#profile" } });
    const html = renderToStaticMarkup(createElement(StudentTranscript));
    expect(html).toContain('id="bang-diem"');
    expect(html).toContain("Bảng điểm của tôi");
    expect(html).toContain("Đang tải bảng điểm…");
  });

  it("tells the page each time a transcript is saved or deleted", () => {
    const page = new EventTarget();
    vi.stubGlobal("window", page);
    const heard = vi.fn();
    page.addEventListener("edupath-transcript-updated", heard);
    announceTranscriptUpdated();
    expect(TRANSCRIPT_UPDATED_EVENT).toBe("edupath-transcript-updated");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
  });
});

describe("the first import: the specialty, then the PDF (GVHD 2026-11-13, plan \"Một bước để bắt đầu\", 2026-11-14)", () => {
  const k29 = { cohortCode: "K29", majorCode: "7480201", specialty: null };

  it("keeps Import bảng điểm off and says what is missing, in the order the student does things", () => {
    const ready = { profileKnown: true, askSpecialty: true, pick: "CNPM", file: true, confirmed: true };
    expect(firstImportHint(ready)).toBe("");
    expect(firstImportHint({ ...ready, profileKnown: false, pick: "" })).toBe("Đang tải hồ sơ của bạn…");
    expect(firstImportHint({ ...ready, pick: "", file: false })).toBe("Chọn chuyên ngành để import");
    expect(firstImportHint({ ...ready, pick: "none", file: false })).toBe("Chọn tệp PDF để import");
    expect(firstImportHint({ ...ready, confirmed: false })).toBe("Đánh dấu ô xác nhận để import");
    // An API without the specialty in the profile: the PDF alone.
    expect(firstImportHint({ ...ready, askSpecialty: false, pick: "" })).toBe("");
  });

  it("saves a changed specialty before the PDF is sent, and sends the PDF as before", async () => {
    const calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? "GET", url, body: init.body, headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify(init.method === "POST" ? { transcript: null, job: { id: "j1", filename: "bang-diem.pdf", status: "queued", errorCode: null } } : { student: {} }), { status: 200 });
    }));
    const saved = vi.fn();
    const pdf = new File(["%PDF-1.7"], "bảng điểm.pdf", { type: "application/pdf" });
    const data = await sendImport(pdf, { specialty: "CNPM", onSpecialtySaved: saved });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["PATCH /api/student/profile", "POST /api/student/transcript"]);
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ specialty: "CNPM" });
    expect(saved).toHaveBeenCalledWith("CNPM");
    expect(calls[1]!.headers).toMatchObject({ "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent("bảng điểm.pdf"), "X-Confirm-Own-Transcript": "true", "X-Consent-Policy-Version": policyVersion });
    expect(calls[1]!.headers).not.toHaveProperty("X-Transcript-Version");
    expect(data.job?.status).toBe("queued");
    // "Chưa có chuyên ngành" stores none; an unchanged specialty sends no PATCH; a replaced transcript names its version.
    calls.length = 0;
    await sendImport(pdf, { specialty: null });
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ specialty: null });
    calls.length = 0;
    await sendImport(pdf, { version: transcript.version });
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
    expect(calls[0]!.headers["X-Transcript-Version"]).toBe(transcript.version);
  });

  it("sends no PDF when the specialty is refused, and says why", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "specialty_unavailable" }), { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const pdf = new File(["%PDF-1.7"], "bang-diem.pdf", { type: "application/pdf" });
    await expect(sendImport(pdf, { specialty: "ANM" })).rejects.toThrow("Chuyên ngành này không áp dụng cho khóa của bạn. Hãy chọn chuyên ngành khác.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows the short import of Tổng quan and Xét tốt nghiệp: the specialty as a select, the PDF, no tables", () => {
    vi.stubGlobal("window", { location: { pathname: "/dashboard", search: "", hash: "#overview" } });
    const html = renderToStaticMarkup(createElement(StudentTranscript, { profile: { ...k29, specialty: "CNDL" }, mode: "start", submitLabel: "Import và xét tốt nghiệp" }));
    expect(html).toContain('<option value="CNDL" selected="">Công nghệ dữ liệu</option>');
    expect(html).toContain('<option value="none">Chưa có chuyên ngành</option>');
    expect(html).toMatch(/<button type="button" class="sw-outline ti-start-choose" disabled="" aria-describedby="[^"]+-file">.*Chọn tệp PDF bảng điểm<\/button>/);
    expect(html).toContain("Cùng với khóa K29, dùng để chọn tiêu chuẩn xét tốt nghiệp và học phần chuyên ngành khi đánh giá năng lực.");
    // The confirmation and the button come with the PDF; no section, heading or tables of Hồ sơ và bảng điểm.
    for (const absent of ["Import và xét tốt nghiệp", "Tôi xác nhận", 'id="bang-diem"', "Bảng điểm của tôi"]) expect(html).not.toContain(absent);
    const waiting = renderToStaticMarkup(createElement(StudentTranscript, { profile: null, mode: "start" }));
    expect(waiting).toContain('<p class="ti-start-loading" role="status">Đang tải hồ sơ của bạn…</p>');
    expect(waiting).not.toContain("<select");
  });

  it("names the specialty on the transcript bar, with Đổi", () => {
    const html = renderToStaticMarkup(createElement(TranscriptUpdateBar, { ...target, transcript, onDelete: noop,
      specialty: createElement("p", { className: "ti-bar-spec" }, "Chuyên ngành: Công nghệ phần mềm") }));
    expect(html).toContain('<p class="ti-bar-spec">Chuyên ngành: Công nghệ phần mềm</p>');
    expect(html).not.toContain("ti-bar-below");
  });
});
