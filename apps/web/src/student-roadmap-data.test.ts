import { describe, expect, it } from "vitest";
import {
  choiceText, failureText, improveHeading, monthTitle, normalizeRoadmapResponse, normalizeRoadmapStatus, pendingCopy, requestErrorMessage, ROADMAP_RETRY_CODE, roadmapWindowTitle, skillTags, studyTag, termShort,
  hasMonthPlan, previousRoadmap, PREVIOUS_ROADMAP_NOTE, type Roadmap,
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
    // An API without surveyDone (before the profile survey) never blocks "Tạo lộ trình".
    expect(normalizeRoadmapResponse(null)).toEqual({ roadmap: null, previous: null, assessment: null, stale: false, surveyDone: true, aiEnabled: false, worker: { online: false, supportsRoadmap: false }, upcoming: null, basis: null });
    // Where the advice comes from (roadmap-v9), strings only; an empty one is none.
    expect(normalizeRoadmapResponse({ basis: { recorded: ["React: chưa có điểm", 1], selfReported: ["Thực tập: Đang thực tập"], surveyChanged: true } }).basis)
      .toEqual({ recorded: ["React: chưa có điểm"], selfReported: ["Thực tập: Đang thực tập"], surveyChanged: true });
    expect(normalizeRoadmapResponse({ basis: { recorded: [], selfReported: [] } }).basis).toBeNull();
    // The term a new roadmap would cover (2026-10-25); a 3-month roadmap made before has no term.
    expect(normalizeRoadmapResponse({ upcoming: { term: "HK262", start: "2026-12-21", end: "2027-04-04" } }).upcoming).toEqual({ term: "HK262", start: "2026-12-21", end: "2027-04-04" });
    expect([roadmapWindowTitle({ term: "HK262" }), roadmapWindowTitle({})]).toEqual(["Lộ trình HK2 2026–2027", "Lộ trình 3 tháng"]);
    expect(normalizeRoadmapResponse({ surveyDone: false }).surveyDone).toBe(false);
    expect(normalizeRoadmapResponse({ roadmap: { id: 1 } }).roadmap).toBeNull();
    expect(normalizeRoadmapStatus({ id: "r1", status: "processing" })).toEqual({ id: "r1", status: "processing", errorCode: null, worker: { online: false, supportsRoadmap: false } });
  });
});

describe("the older roadmap shown dimmed while a new one is written (2026-11-05, like Xét tốt nghiệp)", () => {
  const roadmap = (id: string, status: Roadmap["status"], extra: Partial<Roadmap> = {}): Roadmap => ({
    id, assessmentId: "a1", status, errorCode: null, createdAt: "2026-10-20T03:00:00.000Z", completedAt: status === "completed" ? "2026-10-20T03:04:00.000Z" : null,
    model: status === "completed" ? "gemma4:e4b" : null, window: { start: "2026-12-21", end: "2027-04-04", months: [], term: "HK262" }, ended: false,
    careerName: null, specialtyLabel: null, summary: status === "completed" ? "Lộ trình trước." : null, advice: [], study: [], choices: [], improve: [], skills: [],
    months: [{ month: 1, start: "2026-12-21", end: "2027-01-20", focus: status === "completed" ? "Ổn định lịch học" : null, tasks: [] }], ...extra,
  });
  const older = roadmap("r1", "completed"), remembered = roadmap("r0", "completed", { summary: "Lộ trình nhớ trong phiên." });

  it("reads the API's previous: a completed roadmap only, none from an older API", () => {
    expect(normalizeRoadmapResponse({ roadmap: { ...roadmap("r2", "processing") }, previous: older }).previous).toMatchObject({ id: "r1", summary: "Lộ trình trước." });
    expect(normalizeRoadmapResponse({ roadmap: roadmap("r2", "processing"), previous: roadmap("r1", "failed") }).previous).toBeNull();
    expect(normalizeRoadmapResponse({ roadmap: roadmap("r2", "processing") }).previous).toBeNull();
  });
  it("is the API's while the newest is not completed, else the one this page session showed, and needs an AI part", () => {
    for (const status of ["queued", "processing", "failed", "cancelled"] as const) {
      expect(previousRoadmap({ roadmap: roadmap("r2", status), previous: older }, remembered)).toBe(older);
      expect(previousRoadmap({ roadmap: roadmap("r2", status), previous: null }, remembered)).toBe(remembered);
    }
    expect(previousRoadmap({ roadmap: roadmap("r2", "completed"), previous: older }, remembered)).toBeNull();
    expect(previousRoadmap({ roadmap: null, previous: older }, remembered)).toBeNull();
    expect(previousRoadmap(null, remembered)).toBeNull();
    // The session's memory of this very roadmap is not "an older roadmap".
    expect(previousRoadmap({ roadmap: roadmap("r0", "failed"), previous: null }, remembered)).toBeNull();
    // Advice or a month plan is enough; a roadmap with neither shows nothing.
    const monthsOnly = roadmap("r1", "completed", { summary: null });
    expect(previousRoadmap({ roadmap: roadmap("r2", "queued"), previous: monthsOnly }, null)).toBe(monthsOnly);
    expect(hasMonthPlan(monthsOnly)).toBe(true);
    const nothing = roadmap("r1", "completed", { summary: null, months: [{ month: 1, start: "2026-12-21", end: "2027-01-20", focus: null, tasks: [] }] });
    expect(hasMonthPlan(nothing)).toBe(false);
    expect(previousRoadmap({ roadmap: roadmap("r2", "queued"), previous: nothing }, null)).toBeNull();
    expect(PREVIOUS_ROADMAP_NOTE).toBe("Lộ trình trước, viết cho dữ liệu cũ — có thể không còn đúng. Lộ trình mới sẽ thay thế khi sẵn sàng.");
  });
});

describe("labels", () => {
  it("tags the courses to take in plain words", () => {
    expect(termShort("HK261")).toBe("HK1 2026–2027");
    expect(studyTag({ source: "running", termCode: null, choiceLabel: null })).toEqual({ text: "Đang học", tone: "running" });
    expect(studyTag({ source: "running", termCode: "HK261", choiceLabel: null }).text).toBe("Đang học · HK1 2026–2027");
    expect(studyTag({ source: "late", termCode: "HK243", choiceLabel: null }).text).toBe("Trễ kế hoạch · HK3 2024–2025");
    // The term being studied's unregistered course is not late (comp-calc-v19, user 2026-11-04).
    expect(studyTag({ source: "late", thisTerm: true, termCode: "HK261", choiceLabel: null })).toEqual({ text: "Kế hoạch HK1 2026–2027 · chưa đăng ký", tone: "next" });
    expect(studyTag({ source: "next", termCode: "HK262", choiceLabel: null }).text).toBe("Học kỳ tới · HK2 2026–2027");
    expect(studyTag({ source: "following", termCode: "HK262", choiceLabel: null }).text).toBe("Học kỳ tới · HK2 2026–2027");
    expect(studyTag({ source: "choice", termCode: "HK243", choiceLabel: "Nhóm tự chọn TC309" }).text).toBe("Tự chọn: Nhóm tự chọn TC309");
    expect(skillTags({ isRequired: true, kind: "self_study" })).toEqual(["Bắt buộc", "Cần tự học"]);
    expect(skillTags({ isRequired: false, kind: "deepen" })).toEqual(["Ưu tiên", "Nâng cao"]);
    // Học lại (not passed) and học cải thiện (passed) named apart; both together under the user's title (2026-10-31).
    expect(improveHeading([{ action: "retake" }, { action: "improve" }])).toBe("Môn học bạn cần học lại và cải thiện");
    expect(improveHeading([{ action: "retake" }])).toBe("Môn học bạn cần học lại");
    expect(improveHeading([{ action: "improve" }])).toBe("Môn học bạn có thể học cải thiện");
    expect(improveHeading([])).toBe("Môn học bạn cần học lại và cải thiện");
    expect(monthTitle({ month: 1, start: "2026-10-24", end: "2026-11-23" })).toBe("Tháng 1 · 24/10 – 23/11/2026");
    expect(choiceText({ label: "Nhóm tự chọn TC309", source: "late", termCode: "HK243", need: "3 TC", options: [] }))
      .toBe("Nhóm tự chọn TC309: còn thiếu 3 TC, theo kế hoạch ở HK3 2024–2025");
    // The system's shortfall in the unit of the requirement (comp-calc-v19): a "Chọn k" choice in courses with their credits,
    // never two pairs of brackets; a group of credits in credits (a course count read "còn thiếu 1 TC" before).
    expect(choiceText({ label: "Chọn 1 trong 2 môn sau", source: "late", termCode: "HK241", need: "1 học phần (3 TC)", options: [] }))
      .toBe("Chọn 1 trong 2 môn sau: còn thiếu 1 học phần (3 TC), theo kế hoạch ở HK1 2024–2025");
    expect(choiceText({ label: "Nhóm tự chọn TC406: chọn 6 tín chỉ", source: "next", termCode: "HK262", need: "6 TC", options: [] }))
      .toBe("Nhóm tự chọn TC406: chọn 6 tín chỉ: còn thiếu 6 TC");
  });

  it("explains waiting, failures and refusals", () => {
    expect(pendingCopy("processing", { online: true, supportsRoadmap: true }).title).toBe("EduPath AI đang soạn lộ trình…");
    expect(pendingCopy("queued", { online: false, supportsRoadmap: false }).title).toBe("Lộ trình sẽ được soạn khi máy AI hoạt động trở lại");
    expect(pendingCopy("queued", { online: true, supportsRoadmap: false }).title).toBe("Máy AI đang chạy phiên bản cũ…");
    expect(pendingCopy("queued", { online: true, supportsRoadmap: true }).title).toBe("Đang chờ đến lượt…");
    // A second try because the first answer did not hold to the data (roadmap-v9).
    expect(pendingCopy("processing", { online: true, supportsRoadmap: true }, ROADMAP_RETRY_CODE).title).toBe("EduPath AI đang viết lại lộ trình…");
    expect(pendingCopy("queued", { online: true, supportsRoadmap: true }, ROADMAP_RETRY_CODE).text).toContain("chưa khớp dữ liệu của bạn");
    expect(pendingCopy("queued", { online: false, supportsRoadmap: false }, ROADMAP_RETRY_CODE).title).toBe("Lộ trình sẽ được soạn khi máy AI hoạt động trở lại");
    expect(failureText("invalid_ai_output")).toContain("chưa đạt yêu cầu kiểm tra");
    expect(failureText(null)).toBe("Đã có lỗi khi soạn lộ trình.");
    expect(requestErrorMessage("roadmap_too_frequent")).toContain("nửa phút");
    expect(requestErrorMessage("whatever")).toBe("Không xử lý được yêu cầu. Vui lòng thử lại.");
  });
});
