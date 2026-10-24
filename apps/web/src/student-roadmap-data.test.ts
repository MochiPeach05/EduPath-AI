import { describe, expect, it } from "vitest";
import {
  choiceText, failureText, monthTitle, normalizeRoadmapResponse, normalizeRoadmapStatus, pendingCopy, requestErrorMessage, skillTags, studyTag, termShort,
} from "./student-roadmap-data";

describe("normalizeRoadmapResponse", () => {
  it("fills missing lists so an older or partial answer never breaks the page", () => {
    const data = normalizeRoadmapResponse({
      roadmap: { id: "r1", status: "queued", window: { start: "2026-10-24", end: "2027-01-23" }, study: [{ code: "A" }], skills: [{ key: "S01" }] },
      assessment: { id: "a1", createdAt: "2026-10-24T01:00:00.000Z", hasCareer: true }, stale: true, aiEnabled: true, worker: { online: true },
    });
    expect(data.roadmap).toMatchObject({ window: { months: [] }, study: [{ code: "A", careerSkills: [] }], choices: [], improve: [], months: [],
      skills: [{ key: "S01", courses: [], steps: [] }] });
    expect(data).toMatchObject({ stale: true, aiEnabled: true, worker: { online: true, supportsRoadmap: false }, assessment: { id: "a1", hasCareer: true } });
    expect(normalizeRoadmapResponse(null)).toEqual({ roadmap: null, assessment: null, stale: false, aiEnabled: false, worker: { online: false, supportsRoadmap: false } });
    expect(normalizeRoadmapResponse({ roadmap: { id: 1 } }).roadmap).toBeNull();
    expect(normalizeRoadmapStatus({ id: "r1", status: "processing" })).toEqual({ id: "r1", status: "processing", errorCode: null, worker: { online: false, supportsRoadmap: false } });
  });
});

describe("labels", () => {
  it("tags the courses to take in plain words", () => {
    expect(termShort("HK261")).toBe("HK1 2026–2027");
    expect(studyTag({ source: "running", termCode: null, choiceLabel: null })).toEqual({ text: "Đang học", tone: "running" });
    expect(studyTag({ source: "late", termCode: "HK243", choiceLabel: null }).text).toBe("Trễ kế hoạch HK3 2024–2025");
    expect(studyTag({ source: "next", termCode: "HK261", choiceLabel: null }).text).toBe("Kế hoạch HK1 2026–2027");
    expect(studyTag({ source: "following", termCode: "HK262", choiceLabel: null }).text).toBe("Học kỳ sau · HK2 2026–2027");
    expect(studyTag({ source: "choice", termCode: "HK243", choiceLabel: "Nhóm tự chọn TC309" }).text).toBe("Tự chọn: Nhóm tự chọn TC309");
    expect(skillTags({ isRequired: true, kind: "self_study" })).toEqual(["Bắt buộc", "Cần tự học"]);
    expect(skillTags({ isRequired: false, kind: "deepen" })).toEqual(["Ưu tiên", "Nâng cao"]);
    expect(monthTitle({ month: 1, start: "2026-10-24", end: "2026-11-23" })).toBe("Tháng 1 · 24/10 – 23/11/2026");
    expect(choiceText({ label: "Nhóm tự chọn TC309", source: "late", termCode: "HK243", need: "3 TC", options: [] }))
      .toBe("Nhóm tự chọn TC309: còn thiếu 3 TC (theo kế hoạch ở học kỳ 3 năm học 2024–2025)");
  });

  it("explains waiting, failures and refusals", () => {
    expect(pendingCopy("processing", { online: true, supportsRoadmap: true }).title).toBe("EduPath AI đang soạn lộ trình…");
    expect(pendingCopy("queued", { online: false, supportsRoadmap: false }).title).toBe("Lộ trình sẽ được soạn khi máy AI hoạt động trở lại");
    expect(pendingCopy("queued", { online: true, supportsRoadmap: false }).title).toBe("Máy AI đang chạy phiên bản cũ…");
    expect(pendingCopy("queued", { online: true, supportsRoadmap: true }).title).toBe("Đang chờ đến lượt…");
    expect(failureText("invalid_ai_output")).toContain("chưa đạt yêu cầu kiểm tra");
    expect(failureText(null)).toBe("Đã có lỗi khi soạn lộ trình.");
    expect(requestErrorMessage("roadmap_too_frequent")).toContain("nửa phút");
    expect(requestErrorMessage("whatever")).toBe("Không xử lý được yêu cầu. Vui lòng thử lại.");
  });
});
