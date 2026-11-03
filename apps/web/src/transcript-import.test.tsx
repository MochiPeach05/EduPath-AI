import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudentTranscript, {
  TRANSCRIPT_UPDATED_EVENT, TranscriptDropZone, TranscriptUpdateBar, announceTranscriptUpdated, fileSizeText, transcriptFileProblem, type Transcript,
} from "./StudentTranscript";

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
