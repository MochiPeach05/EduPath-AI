import type { Confidence, FitCode } from "./types.js";

// Every threshold and band used by the competency calculation lives here.
// Changing a value changes stored results, so bump CALC_VERSION with it.

/** Stored in meta.calcVersion of every assessment. */
/** v2: a below skill with a Học cải thiện course is no longer listed as "no course left". */
/** v3: a group's skillCount leaves out not-applicable skills, like overall.basis.applicableSkills. */
/**
 * v4: computed scores lose their float noise before they are classified (all 8.5 grades gave
 * 84.99999999999999, i.e. Khá and below Bắt buộc 85), and 0–100 scores are stored rounded down to
 * 2 decimals, so the whole number the page shows never reaches a level the score has not reached.
 */
/**
 * v5: graduation.ts is the one engine of the competency assessment and the graduation page:
 * repeated group names are labelled with their size and first code; a met lower bound passes even
 * without an upper bound; course credits fall back standard → CTĐT → transcript; the credit estimate
 * accumulates the program (standard ∪ CTĐT), so cohorts without a CTĐT no longer estimate 0; the
 * printed total also reads "Số tín chỉ tích lũy" and an unreadable one falls back to the estimate.
 */
/** v6: skillPlans gives every scored skill below Khá outside the career gaps its courses to take, retake or improve. */
/** v7: with a career, plans only deepen its met skills below Thành thạo; thesis replacement courses are never suggested off that path. */
/** v8: history gives the overall and group competency as the transcript stood at the end of each graded term (STU-COMP-07). */
/** v9: every history point also holds the target career's skills (score and status) at that term (STU-GAP-07). */
export const CALC_VERSION = "comp-calc-v9";

/** Skill, group and overall levels (0–100 scale), classified on unrounded values. */
export const LEVEL_THRESHOLDS = { proficient: 85, good: 70, basic: 50 } as const;

/** Confidence = min(coverage band, evidence band). */
export const COVERAGE_BANDS = { medium: 0.3, high: 0.7 } as const;
/** Evidence amount is Σ(credits × weight) of the studied courses (MT included). */
export const EVIDENCE_BANDS = { medium: 1, high: 2.5 } as const;

/** Career requirement thresholds: "Ưu tiên" needs level Khá, "Bắt buộc" needs Thành thạo. */
export const CAREER_THRESHOLDS = { required: 85, preferred: 70 } as const;
export const CAREER_COEFFICIENTS = { required: 2, preferred: 1 } as const;

/** A 'below' requirement earns at most this much, scaled from FIT_BELOW_FLOOR up to the threshold. */
export const FIT_BELOW_MAX_CREDIT = 0.5;
export const FIT_BELOW_FLOOR = 40;
/**
 * Fit levels in steps of 20% (user, 2026-10-21: "một thang nhất quán … Rất phù hợp / Phù hợp / Trung
 * bình / Ít phù hợp / Không phù hợp"; before: Phù hợp ≥ 0,8, Khá phù hợp ≥ 0,5, Cần bổ sung nhiều).
 * The level is read from the stored (rounded) fit and data share, and the page and the AI prompt
 * read it the same way for older results, so CALC_VERSION (which also dates the graduation advice)
 * was not bumped. Mirrored in apps/web/src/student-competency-data.ts (fitLevelOf).
 */
export const FIT_LABEL_THRESHOLDS = { veryFit: 0.8, fit: 0.6, average: 0.4, lowFit: 0.2 } as const;
/** Below this share of coefficients with data the fit label is "Chưa đủ dữ liệu". */
export const FIT_MIN_DATA_SHARE = 0.5;
export const FIT_LABELS: Record<FitCode, string> = {
  very_fit: "Rất phù hợp", fit: "Phù hợp", average: "Trung bình", low_fit: "Ít phù hợp", not_fit: "Không phù hợp",
  insufficient_data: "Chưa đủ dữ liệu",
};
export function fitCodeOf(fit: number | null, dataShare: number): FitCode {
  if (fit === null || dataShare + 1e-9 < FIT_MIN_DATA_SHARE) return "insufficient_data";
  const reaches = (floor: number) => fit + 1e-9 >= floor;
  const t = FIT_LABEL_THRESHOLDS;
  return reaches(t.veryFit) ? "very_fit" : reaches(t.fit) ? "fit" : reaches(t.average) ? "average" : reaches(t.lowFit) ? "low_fit" : "not_fit";
}

/** Deficit bands for 'below': ≤ near → gần ngưỡng, ≤ moderate → thiếu vừa, otherwise thiếu nhiều. */
export const DEFICIT_BANDS = { near: 5, moderate: 15 } as const;

/** At most this many course candidates (and improvement candidates) per skill. */
export const MAX_SUPPORT_COURSES = 5;
/** At most this many skills get a course plan (skillPlans), weakest first. */
export const MAX_SKILL_PLANS = 8;
/** Warn when fewer curriculum courses than this share have skill weights. */
export const MIN_WEIGHTED_COURSE_SHARE = 0.8;
/** Skill scope text kept in results and prompts. */
export const SCOPE_MAX_LENGTH = 200;
/** Size of the strongest/weakest skill lists. */
export const HIGHLIGHT_COUNT = 5;
/**
 * A strength (the page's "Điểm mạnh" and the AI comment's) needs at least medium confidence (user,
 * 2026-10-21): one course with a small weight can score high (MLOps 94 from a single 15% link).
 * The page filters stored results the same way, so CALC_VERSION (which also dates the graduation
 * advice) was not bumped for it.
 */
export const isStrengthConfidence = (confidence: Confidence | null) => confidence === "medium" || confidence === "high";
/** Related measured skills listed as context for one self-study item. */
export const MAX_RELATED_SKILLS = 3;

/** Same pass letters as the OCR pipeline (services/ocr/test_ocr.py PASS_LETTERS). */
export const PASS_LETTERS: readonly string[] = ["A+", "A", "B+", "B", "C+", "C", "D+", "D"];
/**
 * "VT" (vắng thi, absent from the exam) is printed in the score and letter columns alike: a failed
 * attempt without a score, worth 0 in the printed semester GPA like an F (services/ocr FAIL_LETTERS).
 */
export const ABSENT_LETTER = "VT";
export const FAIL_LETTERS: readonly string[] = ["F", ABSENT_LETTER];
/** Exemption/recognition letter. Counts as passed; never inferred. */
export const EXEMPT_LETTER = "MT";

/** Condition-only courses (GDTC/GDQP) when no graduation standard says otherwise. */
export const CONDITION_ONLY_CODE_PATTERN = /^71(?:NAD|PE)/;
/** Folded CTĐT block name of the condition-only courses. */
export const CONDITION_ONLY_BLOCK = "giao duc the chat va giao duc quoc phong";
