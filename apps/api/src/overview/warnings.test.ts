import { describe, expect, it } from "vitest";
import { overviewWarnings, type WarningInput } from "./warnings.js";

// "Cần chú ý" of Tổng quan: every kind, from synthetic inputs only.
const base: WarningInput = { hasTranscript: true, blocked: null, failed: [], late: [], electives: [], pace: null, gpa: null };

describe("overviewWarnings", () => {
  it("asks for the transcript, or says why the progress cannot be computed", () => {
    expect(overviewWarnings({ ...base, hasTranscript: false })).toEqual({ level: "none", items: [{
      level: "warn", kind: "missing_data", key: "missing:transcript",
      text: "Chưa tính được tiến độ vì chưa có bảng điểm. Import bảng điểm PDF ở Hồ sơ và bảng điểm để so với kế hoạch đào tạo của khóa.",
      strong: [], action: { label: "Mở Hồ sơ và bảng điểm", link: "#profile" },
    }] });
    const specialty = overviewWarnings({ ...base, blocked: "specialty_required", failed: [{ code: "A", name: "Môn A", letter: "F", term: "HK241", plannedIn: null }] });
    expect(specialty.level).toBe("none");
    expect(specialty.items).toEqual([expect.objectContaining({ kind: "missing_data", key: "missing:specialty_required",
      text: "Chưa tính được tiến độ vì chưa chọn chuyên ngành.", action: { label: "Mở Hồ sơ và bảng điểm", link: "#profile" } })]);
    expect(overviewWarnings({ ...base, blocked: "something_new" }).items[0]).toMatchObject({ text: "Chưa tính được tiến độ học tập. Vui lòng thử lại sau.", action: null });
  });

  it("flags a failed mandatory course, softer once the saved plan holds its retake", () => {
    const failed = overviewWarnings({ ...base, failed: [{ code: "71ITSE30603", name: "Phát triển ứng dụng di động", letter: "CT", term: "HK241", plannedIn: null }] });
    expect(failed).toEqual({ level: "risk", items: [{
      level: "risk", kind: "failed_course", key: "failed:71ITSE30603",
      text: "Môn bắt buộc chưa đạt: Phát triển ứng dụng di động (cấm thi, HK1 2024–2025) và chưa có trong Kế hoạch học kỳ.",
      strong: ["Phát triển ứng dụng di động"], action: { label: "Thêm vào Kế hoạch học kỳ", link: "#roadmap" },
    }] });
    const planned = overviewWarnings({ ...base, failed: [{ code: "71ITBS10203", name: "Cơ sở lập trình", letter: "F", term: "HK231", plannedIn: "HK262" }] });
    expect(planned.level).toBe("warn");
    expect(planned.items[0]).toMatchObject({ level: "warn", text: "Môn bắt buộc chưa đạt: Cơ sở lập trình (điểm F, HK1 2023–2024), đã xếp học lại ở HK2 2026–2027 trong Kế hoạch học kỳ.",
      action: { label: "Xem Kế hoạch học kỳ", link: "#roadmap" } });
    expect(overviewWarnings({ ...base, failed: [{ code: "X", name: "Môn X", letter: "VT", term: null, plannedIn: null }] }).items[0]!.text)
      .toBe("Môn bắt buộc chưa đạt: Môn X (vắng thi) và chưa có trong Kế hoạch học kỳ.");
  });

  it("warns when the credits left need more per term than the plan's heaviest term, or no plan term is left", () => {
    const heavy = overviewWarnings({ ...base, pace: { remaining: 38, termsLeft: 2, perTerm: 19, planMax: 16 } });
    expect(heavy.items).toEqual([{
      level: "risk", kind: "pace", key: "pace",
      text: "Còn 38 tín chỉ sau học kỳ này cho 2 học kỳ còn lại theo kế hoạch: khoảng 19 TC mỗi kỳ, nhiều hơn mức kế hoạch thường có (16 TC). Nên trao đổi với cố vấn học tập.",
      strong: ["38 tín chỉ", "19 TC mỗi kỳ"], action: { label: "Xem Theo dõi tiến độ", link: "#roadmap" },
    }]);
    expect(overviewWarnings({ ...base, pace: { remaining: 12, termsLeft: 0, perTerm: 12, planMax: null } }).items[0]!.text)
      .toBe("Kế hoạch đào tạo không còn học kỳ nào sau học kỳ này nhưng còn 12 tín chỉ chưa học. Nên trao đổi với cố vấn học tập để xếp các học kỳ còn lại.");
    expect(overviewWarnings({ ...base, pace: { remaining: 30, termsLeft: 2, perTerm: 15, planMax: 18 } }).level).toBe("ok");
    expect(overviewWarnings({ ...base, pace: { remaining: 0, termsLeft: 0, perTerm: null, planMax: null } }).level).toBe("ok");
  });

  it("flags a cumulative GPA under the graduation minimum", () => {
    expect(overviewWarnings({ ...base, gpa: { actual: 1.85, required: 2 } }).items).toEqual([{
      level: "risk", kind: "gpa_below", key: "gpa", text: "GPA tích lũy 1,85 dưới mức tối thiểu 2,00 để xét tốt nghiệp.",
      strong: ["1,85"], action: { label: "Xem Điều kiện xét tốt nghiệp", link: "#graduation" },
    }]);
    expect(overviewWarnings({ ...base, gpa: { actual: 2.85, required: 2 } }).level).toBe("ok");
  });

  it("lists three late courses one by one and groups the others", () => {
    const late = ["A", "B", "C", "D", "E"].map((letter, index) => ({ code: `C${index}`, name: `Môn ${letter}`, term: "HK243" }));
    const result = overviewWarnings({ ...base, late });
    expect(result.level).toBe("warn");
    expect(result.items.map((item) => item.key)).toEqual(["late:C0", "late:C1", "late:C2", "late:others"]);
    expect(result.items[0]!.text).toBe("Môn A trễ so với kế hoạch (dự kiến HK3 2024–2025).");
    expect(result.items[3]).toMatchObject({ text: "Còn 2 môn khác trễ so với kế hoạch: Môn D, Môn E.", strong: ["2 môn khác"] });
  });

  it("names an elective group or choice that is still short, in the unit of its requirement (comp-calc-v19)", () => {
    const result = overviewWarnings({ ...base, electives: [
      { label: "Nhóm tự chọn TC406: chọn 6 tín chỉ", code: "TC406", term: "HK243", unit: "credit", missing: 6, missingCredits: 6 },
      { label: "Chọn 1 trong 3 môn sau", code: null, term: "HK242", unit: "course", missing: 1, missingCredits: 3 },
      { label: "Chọn 1 trong 2 môn sau", code: null, term: "HK241", unit: "course", missing: 1, missingCredits: 3, shortfall: "1 học phần (3–6 TC)" },
    ] });
    expect(result.items.map((item) => item.text)).toEqual([
      "Nhóm tự chọn TC406 còn thiếu 6 TC (dự kiến HK3 2024–2025).",
      "Chọn 1 trong 3 môn sau (HK2 2024–2025): còn thiếu 1 học phần (3 TC).",
      "Chọn 1 trong 2 môn sau (HK1 2024–2025): còn thiếu 1 học phần (3–6 TC).",
    ]);
    expect(result.items[0]).toMatchObject({ kind: "elective_short", key: "elective:TC406:HK243", strong: ["Nhóm tự chọn TC406"] });
    // A credit group's course count with the TC unit read "còn thiếu 1 TC" (the review): the credits are what is short.
    expect(overviewWarnings({ ...base, electives: [{ label: "Nhóm tự chọn TC406: chọn 6 tín chỉ", code: "TC406", term: "HK243", unit: "credit", missing: 1, missingCredits: 6 }] })
      .items[0]!.text).toBe("Nhóm tự chọn TC406 còn thiếu 6 TC (dự kiến HK3 2024–2025).");
  });

  it("says the student is on track when nothing is wrong, notes a missing plan, and puts the worst first", () => {
    expect(overviewWarnings(base)).toEqual({ level: "ok", items: [{
      level: "ok", kind: "on_track", key: "on_track", text: "Đúng tiến độ: các môn của những học kỳ đã qua đều đạt theo kế hoạch đào tạo.",
      strong: ["Đúng tiến độ"], action: { label: "Xem học kỳ tới nên học gì", link: "#roadmap" },
    }] });
    const noPlan = overviewWarnings({ ...base, planMissing: true });
    expect(noPlan.level).toBe("warn");
    expect(noPlan.items).toEqual([expect.objectContaining({ kind: "missing_data", key: "missing:plan_unavailable" })]);
    const mixed = overviewWarnings({ ...base, late: [{ code: "L", name: "Môn L", term: "HK243" }], gpa: { actual: 1.5, required: 2 } });
    expect(mixed.level).toBe("risk");
    expect(mixed.items.map((item) => item.kind)).toEqual(["gpa_below", "late_course"]);
  });
});
