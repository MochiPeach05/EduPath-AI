import type { Confidence, FitCode, GapStatus } from "./types.js";

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
/**
 * v10: five levels named and bounded like the transcript's classification (user, 2026-10-22: "3.2 thì
 * ở đây 80đ thì nó phải là mức giỏi rồi, 3.6 … là xuất sắc, còn 2.8 là khá"): Xuất sắc ≥ 90, Giỏi ≥ 80,
 * Khá ≥ 62,5, Trung bình ≥ 50, Yếu below (was Thành thạo ≥ 85, Khá ≥ 70, Cơ bản ≥ 50, Cần củng cố).
 * "Bắt buộc" needs Giỏi (80, was 85), "Ưu tiên" Khá (62,5, was 70); strengths, improvements and the
 * plans without a career use Khá too, and a career's met skills below Giỏi are deepened.
 */
/**
 * v11: the career fit is a 0–100 "điểm phù hợp" (fitScoreOf; user, 2026-10-22: "Sao lại 100% tròn nhỉ
 * tại vì nó chỉ chấm 92 điểm và sửa lại thành đơn vị điểm"), its level on the competency bounds.
 * v12: the overall pools every skill once by credits × weight, like a group score, instead of the mean of the
 * groups (user, 2026-10-23): a small group (Kỹ năng mềm, 8% of the weight) no longer counts for a third.
 */
/**
 * v13: the plan's "học kỳ hiện tại" is the term being studied, the first term after the latest graded one with
 * registrations without grades (studyTermCode), not the latest graded term (user, 2026-10-24: "anh văn 7 và kỹ thuật
 * lấy yêu cầu là HK1 2026-2027 rồi"). Its planned courses not registered are late, "học kỳ tới" is the term after
 * it, and a career skill whose course was planned for it but not registered is no longer "sắp học".
 */
/**
 * v14: the "điểm phù hợp" counts every career skill: a skill without a score counts 0 whether it is not studied,
 * "Cần tự học" (only another specialty teaches it) or "Chưa đủ dữ liệu" (no course measures it); only "Sắp học" waits
 * (user, 2026-10-24: "Tính đủ mọi kỹ năng", after a career with 0/4 skills met scored 50,6 because its two no-data
 * skills were left out). "Chưa đủ dữ liệu" as a level now means more than half of the coefficients are "Sắp học".
 */
export const CALC_VERSION = "comp-calc-v14";
/**
 * The graduation evaluation uses no skill level, so it keeps the version of its last change:
 * comp-calc-v10 changed only levels and must not re-date every student's graduation advice.
 */
export const GRADUATION_CALC_VERSION = "comp-calc-v9";

/**
 * Skill, group and overall levels (0–100 scale), classified on unrounded values. The 0–100 score is the
 * 10-point course score × 10 and VLU prints hệ 4 = hệ 10 × 0,4, so a score is the 4-point average × 25
 * and the bounds are the transcript's "Xếp loại" on the 4-point scale (Thông tư 08/2021): Xuất sắc 3,6 ·
 * Giỏi 3,2 · Khá 2,5 · Trung bình 2,0. Yếu also covers Kém (below 1,0). Khá is the one bound that is not
 * a whole number: a score between 62,5 and 63 is shown with one decimal (prompt formatScore, web formatScore).
 * Mirrored in apps/web/src/student-competency-data.ts (levelOfScore).
 */
export const LEVEL_THRESHOLDS = { excellent: 90, proficient: 80, good: 62.5, basic: 50 } as const;

/** Confidence = min(coverage band, evidence band). */
export const COVERAGE_BANDS = { medium: 0.3, high: 0.7 } as const;
/** Evidence amount is Σ(credits × weight) of the studied courses (MT included). */
export const EVIDENCE_BANDS = { medium: 1, high: 2.5 } as const;

/** Career requirement thresholds: "Ưu tiên" needs level Khá, "Bắt buộc" needs Giỏi (v10; Khá 70 and Thành thạo 85 before). */
export const CAREER_THRESHOLDS = { required: LEVEL_THRESHOLDS.proficient, preferred: LEVEL_THRESHOLDS.good } as const;
export const CAREER_COEFFICIENTS = { required: 2, preferred: 1 } as const;

/** A 'below' requirement earns at most this much, scaled from FIT_BELOW_FLOOR up to the threshold. */
export const FIT_BELOW_MAX_CREDIT = 0.5;
export const FIT_BELOW_FLOOR = 40;
/**
 * "Điểm phù hợp" (comp-calc-v11, every skill counted since v14): the career's skills averaged like a score,
 * "Bắt buộc" counted twice (its coefficient). A met or below skill counts its score; a skill without a score
 * counts 0, whether not studied, "Cần tự học" or "Chưa đủ dữ liệu" (user, 2026-10-24: "Tính đủ mọi kỹ năng").
 * Only upcoming ("Sắp học") and exempt-only skills are left out; null when nothing is left. Rounded down to
 * 2 decimals like the scores. It is read from the stored requirements, so the page and the AI prompt show
 * older results the same way. Before v11 the level came from `fit`, the share of requirement credit (all
 * met = 100% however high the scores). Mirrored in apps/web/src/student-competency-data.ts (fitScoreOf).
 */
export function fitScoreOf(requirements: readonly { status: GapStatus; score: number | null; coefficient: number }[]): number | null {
  let sum = 0, weight = 0;
  for (const req of requirements) {
    const value = req.status === "met" || req.status === "below" ? req.score : req.status === "not_studied" || req.status === "no_data" ? 0 : null;
    if (value === null) continue;
    sum += req.coefficient * value;
    weight += req.coefficient;
  }
  return weight > 0 ? Math.floor((sum / weight) * 100 + 1e-9) / 100 : null;
}
/**
 * Share of the coefficients that are not "Sắp học" (v14). Read from the requirements like fitScoreOf, so stored
 * results (whose dataShare was the share with a score before v14) show the same level. Mirrored in the web.
 */
export function fitDataShareOf(requirements: readonly { status: GapStatus; coefficient: number }[]): number {
  let total = 0, counted = 0;
  for (const req of requirements) {
    total += req.coefficient;
    if (req.status !== "upcoming") counted += req.coefficient;
  }
  return total > 0 ? Math.round((counted / total) * 10000) / 10000 : 0;
}
/** Below this share (more than half of the coefficients still "Sắp học") the fit label is "Chưa đủ dữ liệu". */
export const FIT_MIN_DATA_SHARE = 0.5;
export const FIT_LABELS: Record<FitCode, string> = {
  very_fit: "Rất phù hợp", fit: "Phù hợp", average: "Trung bình", low_fit: "Ít phù hợp", not_fit: "Không phù hợp",
  insufficient_data: "Chưa đủ dữ liệu",
};
/**
 * Fit level of a "điểm phù hợp" on the bounds of the competency levels (user, 2026-10-22: "Đồng bộ cái
 * mức phù hợp bên này thành tương tự của phần đánh giá năng lực"): Rất phù hợp ≥ 90, Phù hợp ≥ 80,
 * Trung bình ≥ 62,5, Ít phù hợp ≥ 50, Không phù hợp below. Mirrored in the web's fitLevelOf.
 */
export function fitCodeOf(fitScore: number | null, dataShare: number): FitCode {
  if (fitScore === null || dataShare + 1e-9 < FIT_MIN_DATA_SHARE) return "insufficient_data";
  const reaches = (bound: number) => fitScore + 1e-9 >= bound;
  const t = LEVEL_THRESHOLDS;
  return reaches(t.excellent) ? "very_fit" : reaches(t.proficient) ? "fit" : reaches(t.good) ? "average" : reaches(t.basic) ? "low_fit" : "not_fit";
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
