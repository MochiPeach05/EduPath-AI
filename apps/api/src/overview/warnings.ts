// "Cần chú ý" of Tổng quan (STU-PROG-03, 2026-10-30): warnings the system computes, no AI, from the progress against the
// training plan, the transcript and the graduation check. Pure, so the faculty's report of students at risk (AD-REPORT-04)
// and the notifications can reuse the same rules. The texts are the portal's neutral voice, as the approved preview reads.
import type { OverviewWarning, OverviewWarnings } from "./types.js";

/** Late courses listed one by one; the others are grouped in one item. */
export const MAX_LATE_ITEMS = 3;

export type WarningInput = {
  hasTranscript: boolean;
  /** The progress could not be computed at all (the engine's AssessmentError code). */
  blocked: string | null;
  /** The course states are known but the cohort has no training plan: nothing can be late, a note says why. */
  planMissing?: boolean;
  /**
   * Mandatory courses with no passing attempt that are not being retaken. letter: the printed mark of the failed attempt;
   * term: its term; plannedIn: the term of the student's saved Kế hoạch học kỳ that holds the course again, if any.
   */
  failed: { code: string; name: string; letter: string | null; term: string | null; plannedIn: string | null }[];
  /** Planned courses of a term before the studying one (or that one) not taken yet, failed ones excluded. */
  late: { code: string; name: string; term: string }[];
  /** Choices and elective groups of the plan that are due and still short. */
  electives: { label: string; code: string | null; term: string; unit: "course" | "credit"; missing: number; missingCredits: number }[];
  /** The credits left after the studying term against the plan's remaining terms. */
  pace: { remaining: number; termsLeft: number; perTerm: number | null; planMax: number | null } | null;
  /** The cumulative GPA and the graduation minimum, when both are known. */
  gpa: { actual: number; required: number } | null;
};

const RANK: Record<OverviewWarning["level"], number> = { risk: 2, warn: 1, ok: 0 };

/** "HK242" → "học kỳ 2 năm học 2024–2025" (inside a sentence). */
export function termPhrase(code: string): string {
  const match = /^HK(\d{2})([123])$/.exec(code);
  if (!match) return code;
  const year = 2000 + Number(match[1]);
  return `học kỳ ${match[2]} năm học ${year}–${year + 1}`;
}

/** 2.85 → "2,85" (two decimals, Vietnamese comma). */
export const gpaText = (value: number) => value.toFixed(2).replace(".", ",");

const letterText = (letter: string | null) => {
  const mark = letter?.trim().toUpperCase() ?? "";
  if (mark === "CT") return "cấm thi";
  if (mark === "VT") return "vắng thi";
  return mark ? `điểm ${mark}` : "chưa đạt";
};

const BLOCKED: Record<string, string> = {
  specialty_required: "Chưa tính được tiến độ vì chưa chọn chuyên ngành.",
  cohort_unknown: "Chưa tính được tiến độ vì hồ sơ chưa có khóa học. Hãy liên hệ Khoa để cập nhật.",
  curriculum_unavailable: "Chưa tính được tiến độ vì Khoa chưa có chương trình đào tạo cho khóa và ngành này.",
  curriculum_ambiguous: "Chưa tính được tiến độ vì khóa này đang có nhiều chương trình đào tạo. Hãy liên hệ Khoa.",
  plan_unavailable: "Chưa tính được tiến độ theo học kỳ vì Khoa chưa có kế hoạch đào tạo cho khóa và ngành này.",
};

function missingData(input: WarningInput): OverviewWarning {
  if (!input.hasTranscript) {
    return {
      level: "warn", kind: "missing_data", key: "missing:transcript",
      text: "Chưa tính được tiến độ vì chưa có bảng điểm. Import bảng điểm PDF ở Hồ sơ và bảng điểm để so với kế hoạch đào tạo của khóa.",
      strong: [], action: { label: "Mở Hồ sơ và bảng điểm", link: "#profile" },
    };
  }
  const code = input.blocked ?? "unknown";
  return {
    level: "warn", kind: "missing_data", key: `missing:${code}`,
    text: BLOCKED[code] ?? "Chưa tính được tiến độ học tập. Vui lòng thử lại sau.",
    strong: [], action: code === "specialty_required" ? { label: "Mở Hồ sơ và bảng điểm", link: "#profile" } : null,
  };
}

/**
 * The warnings, worst first:
 * - failed_course (risk): a mandatory course failed and not retaken; warn once the saved plan holds its retake;
 * - pace (risk): more credits per remaining term than the plan's heaviest one, or no plan term left;
 * - gpa_below (risk): the cumulative GPA under the graduation minimum;
 * - late_course (warn): a planned course not taken in time, MAX_LATE_ITEMS one by one, the rest in one item;
 * - elective_short (warn): a choice or elective group of a past term still short;
 * - on_track (ok) when nothing is wrong; missing_data (level "none") without a transcript or a computable progress.
 */
export function overviewWarnings(input: WarningInput): OverviewWarnings {
  if (!input.hasTranscript || input.blocked) return { level: "none", items: [missingData(input)] };
  const items: OverviewWarning[] = [];

  for (const course of input.failed) {
    const when = course.term ? `, ${termPhrase(course.term)}` : "";
    items.push(course.plannedIn
      ? {
        level: "warn", kind: "failed_course", key: `failed:${course.code}`,
        text: `Môn bắt buộc chưa đạt: ${course.name} (${letterText(course.letter)}${when}), đã xếp học lại ở ${termPhrase(course.plannedIn)} trong Kế hoạch học kỳ.`,
        strong: [course.name], action: { label: "Xem Kế hoạch học kỳ", link: "#roadmap" },
      }
      : {
        level: "risk", kind: "failed_course", key: `failed:${course.code}`,
        text: `Môn bắt buộc chưa đạt: ${course.name} (${letterText(course.letter)}${when}) và chưa có trong Kế hoạch học kỳ.`,
        strong: [course.name], action: { label: "Thêm vào Kế hoạch học kỳ", link: "#roadmap" },
      });
  }

  const pace = input.pace;
  if (pace && pace.remaining > 0) {
    if (pace.termsLeft === 0) {
      items.push({
        level: "risk", kind: "pace", key: "pace",
        text: `Kế hoạch đào tạo không còn học kỳ nào sau học kỳ này nhưng còn ${pace.remaining} tín chỉ chưa học. Nên trao đổi với cố vấn học tập để xếp các học kỳ còn lại.`,
        strong: [`${pace.remaining} tín chỉ`], action: { label: "Xem Theo dõi tiến độ", link: "#roadmap" },
      });
    } else if (pace.perTerm !== null && pace.planMax !== null && pace.perTerm > pace.planMax) {
      items.push({
        level: "risk", kind: "pace", key: "pace",
        text: `Còn ${pace.remaining} tín chỉ sau học kỳ này cho ${pace.termsLeft} học kỳ còn lại theo kế hoạch: khoảng ${pace.perTerm} TC mỗi kỳ, `
          + `nhiều hơn mức kế hoạch thường có (${pace.planMax} TC). Nên trao đổi với cố vấn học tập.`,
        strong: [`${pace.remaining} tín chỉ`, `${pace.perTerm} TC mỗi kỳ`], action: { label: "Xem Theo dõi tiến độ", link: "#roadmap" },
      });
    }
  }

  if (input.gpa && input.gpa.actual < input.gpa.required) {
    const actual = gpaText(input.gpa.actual);
    items.push({
      level: "risk", kind: "gpa_below", key: "gpa",
      text: `GPA tích lũy ${actual} dưới mức tối thiểu ${gpaText(input.gpa.required)} để xét tốt nghiệp.`,
      strong: [actual], action: { label: "Xem Điều kiện xét tốt nghiệp", link: "#graduation" },
    });
  }

  for (const course of input.late.slice(0, MAX_LATE_ITEMS)) {
    items.push({
      level: "warn", kind: "late_course", key: `late:${course.code}`,
      text: `${course.name} trễ so với kế hoạch (dự kiến ${termPhrase(course.term)}).`,
      strong: [course.name], action: { label: "Thêm vào Kế hoạch học kỳ", link: "#roadmap" },
    });
  }
  const others = input.late.slice(MAX_LATE_ITEMS);
  if (others.length) {
    const names = others.slice(0, MAX_LATE_ITEMS).map((course) => course.name);
    items.push({
      level: "warn", kind: "late_course", key: "late:others",
      text: `Còn ${others.length} môn khác trễ so với kế hoạch: ${names.join(", ")}${others.length > names.length ? ", …" : ""}.`,
      strong: [`${others.length} môn khác`], action: { label: "Xem Theo dõi tiến độ", link: "#roadmap" },
    });
  }

  if (input.planMissing) items.push({ ...missingData({ ...input, blocked: "plan_unavailable" }) });

  for (const group of input.electives) {
    const name = group.code ? `Nhóm tự chọn ${group.code}` : group.label;
    const missing = group.unit === "credit" ? `${group.missingCredits} TC` : `${group.missing} môn`;
    items.push({
      level: "warn", kind: "elective_short", key: `elective:${group.code ?? group.label}:${group.term}`,
      text: group.code
        ? `${name} còn thiếu ${missing} (dự kiến ${termPhrase(group.term)}).`
        : `${name} (${termPhrase(group.term)}): còn thiếu ${missing}.`,
      strong: [name], action: { label: "Xem các môn trong nhóm", link: "#roadmap" },
    });
  }

  if (!items.length) {
    return {
      level: "ok",
      items: [{
        level: "ok", kind: "on_track", key: "on_track",
        text: "Đúng tiến độ: các môn của những học kỳ đã qua đều đạt theo kế hoạch đào tạo.",
        strong: ["Đúng tiến độ"], action: { label: "Xem học kỳ tới nên học gì", link: "#roadmap" },
      }],
    };
  }
  items.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { level: items[0]!.level, items };
}
