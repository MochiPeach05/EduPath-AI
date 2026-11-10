import { NO_SCORE_LETTERS } from "../student/transcript-parser.js";
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
 * v15: "Sắp học" counts 0 too (user, 2026-10-25: "sắp học là 0 luôn đi"): the score is how ready the student is
 * now, so a career whose skills are mostly still to come can no longer score high on one or two met skills. Only
 * exempt-only skills (met without a score) wait; "Chưa đủ dữ liệu" as a level is left for careers without skills.
 * v16: every skill without a score says whether a course of it is in progress or planned after the term being
 * studied (SkillResult.upcoming/upcomingTerm), the rule of the career rows, so Đánh giá năng lực tells "Sắp học"
 * from "Chưa học" like Khoảng trống kỹ năng (user, 2026-10-25, chose to align the pages).
 */
/**
 * v17 (audit of Đánh giá năng lực and Khoảng trống kỹ năng, 2026-10-25):
 * - a course retaken under another code ("học trả nợ với khóa sau": K26 failed DIT0070 and passed it as 71ITIS30103) counts
 *   for its CTĐT course in the competency table, the plan progress and the transcript summary, through the graduation
 *   check's code aliases (the CTĐT's own course names without a standard), not only for graduation;
 * - a suggested course whose planned term is the term being studied or earlier, and not in progress, is `overdue`;
 *   the transcript summary keeps that term (`studyTerm`);
 * - "Giáo dục thể chất (1)/(2)" courses (K26–K28, not in TC002/TC102) fill the plan's GDTC slots 1 and 2;
 * - "học kỳ tới" counts courses: one per course, the courses still to choose of a choice, the credits of a credit choice
 *   over its largest option;
 * - a condition-only course (GDTC/GDQP) printed with 0 credits (K27/K28) scores its skills with a nominal credit
 *   (CONDITION_NOMINAL_CREDITS), so they show under "Môn điều kiện" like K29–K31, never "Ngoài lựa chọn học phần";
 * - the career count line names only its non-zero parts ("Đạt 4/6 kỹ năng · 2 chưa học"), and dataText counts the
 *   skills with a score ("x/y kỹ năng có điểm"; "có dữ liệu" before);
 * - "Kỹ năng gần giống đã đo" of a self-study skill lists scored skills only;
 * - plan choice labels are spaced ("Chọn1 trong 3" → "Chọn 1 trong 3") and say the real number of options.
 */
/**
 * v18 (user 2026-11-03, the thesis rule of Xét tốt nghiệp, Lộ trình AI and Kế hoạch học kỳ, "có" to it here): the thesis
 * group follows the way graduation/thesis.ts thesisWay advises. A path already taken stays; otherwise the cumulative GPA
 * chooses Đồ án/Khóa luận tốt nghiệp from 2,80 and Chuyên đề tốt nghiệp 1 and 2 below it; without a GPA the thesis first
 * (v7). The other way's courses not started are never suggested and never make a skill "Sắp học".
 */
/**
 * v19 (user 2026-11-04, review of Tổng quan → Tiến độ học tập: 109 + 5 + 20 = 134 TC on a bar of 126, "còn thiếu 1 TC" for a
 * group of 6 TC):
 * - "Trễ kế hoạch" (progress.late) counts only what the training plan puts in a term BEFORE the term being studied and that is
 *   neither passed nor in progress; the open items of the term being studied are that term's plan (progress.current), not late
 *   (v13 counted them late);
 * - condition-only courses (GDTC/GDQP: conditionCodes, and every GDTC slot) count in no credit total of the progress (late,
 *   the term being studied, next term); they stay listed with conditionOnly;
 * - a late credit choice's `missing` is in credits, like a next choice's `remaining` (it counted courses and read "còn thiếu 1
 *   TC"); plan-progress.ts shortfallText writes every shortfall the one way ("6 TC", "1 học phần (3 TC)");
 * - a "Chọn k" choice's missing credits are its k cheapest options still open (k × the cheapest option before).
 * Stored results change only with "Đánh giá lại"; Đánh giá năng lực says so for older ones (web lateBeforeStudyTerm).
 * Tổng quan computes its progress live and always reads v19.
 * comp-calc-v20 (user 2026-11-05: "người ta học đúng kế hoạch mà"): a plan choice of a CTĐT elective group is met once the
 * group's credits are reached; a plan can list more choices of a group than its credits (plan-progress.ts).
 */
/**
 * v21 (user 2026-11-10, "thể chất thì duyệt"): a PE elective 71PE… the CTĐT does not list fills one of its numbered GDTC
 * courses ("Giáo dục thể chất (1)", "(2)"; ngành HTTT K29) not passed under its own code, in term order (course-state.ts
 * physicalEducationFills). The course reads that elective's state, grade and term (CourseFact.filledBy), counts as a
 * condition (GDTC), is no longer late, and the elective leaves the courses outside the CTĐT. Graduation is unchanged.
 */
/**
 * v22 (user 2026-11-10, "dùng luôn mã thực tế"): a CTĐT course the file writes under a code students never register takes the
 * code of the graduation standard of its cohort and major (curricula/real-codes.ts: same name and credits, one such course,
 * the standards agree; ngành HTTT K29 71ITMA10203 → 71MATL10053, 71ISGR40203 → 71ITIS30503). Its state, grade and plan term
 * come from the transcript under that code, its skills from that course's configuration (Cấu hình môn học), and the
 * transcript's course no longer stands outside the CTĐT. Graduation reads the CTĐT as filed and is unchanged.
 */
/**
 * v23 (user 2026-11-10: "vẫn có giữ lại môn đồ án tốt nghiệp do sinh viên chọn hết mà"): the thesis group follows the way the
 * student chose, the transcript's path and the courses they placed in Kế hoạch học kỳ themselves (inputs.plannedCourses,
 * graduation/thesis.ts thesisChoice), over the way the system recommends (thesisWay, the GPA rule of v18, now an internal
 * setting). While the student holds both ways neither is left out; a course the student placed or started never is.
 * Stored results change only with "Đánh giá lại"; Đánh giá năng lực says so when the plan holds a course the stored result
 * leaves out (router.ts thesisPlanOutdated). Tổng quan computes the engine live and always reads v23.
 */
export const CALC_VERSION = "comp-calc-v23";
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
 * counts 0, whether not studied, "Cần tự học", "Chưa đủ dữ liệu" (user, 2026-10-24: "Tính đủ mọi kỹ năng") or
 * "Sắp học" (v15, 2026-10-25). Only exempt-only skills are left out; null when nothing is left. Rounded down to
 * 2 decimals like the scores. It is read from the stored requirements, so the page and the AI prompt show
 * older results the same way. Before v11 the level came from `fit`, the share of requirement credit (all
 * met = 100% however high the scores). Mirrored in apps/web/src/student-competency-data.ts (fitScoreOf).
 */
export function fitScoreOf(requirements: readonly { status: GapStatus; score: number | null; coefficient: number }[]): number | null {
  let sum = 0, weight = 0;
  for (const req of requirements) {
    const value = req.status === "met" || req.status === "below" ? req.score : 0;
    if (value === null) continue;
    sum += req.coefficient * value;
    weight += req.coefficient;
  }
  return weight > 0 ? Math.floor((sum / weight) * 100 + 1e-9) / 100 : null;
}
/**
 * Share of the coefficients the fit score counts: everything but exempt-only skills (v15; v14 left "Sắp học" out).
 * Read from the requirements like fitScoreOf, so stored results show the same level. Mirrored in the web.
 */
export function fitDataShareOf(requirements: readonly { status: GapStatus; score: number | null; coefficient: number }[]): number {
  let total = 0, counted = 0;
  for (const req of requirements) {
    total += req.coefficient;
    if (!(req.status === "met" && req.score === null)) counted += req.coefficient;
  }
  return total > 0 ? Math.round((counted / total) * 10000) / 10000 : 0;
}
/** Below this share (more than half of the coefficients exempt-only, or no skill at all) the fit label is "Chưa đủ dữ liệu". */
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
 * "VT" (vắng thi), "CT" (cấm thi, 2026-10-26) and "DC" (2026-11-09) are printed in the score and letter columns alike: a failed attempt
 * without a score, worth 0 in the printed semester GPA like an F (transcript-parser NO_SCORE_LETTERS, services/ocr).
 */
export const FAIL_LETTERS: readonly string[] = ["F", ...NO_SCORE_LETTERS];
/** Exemption/recognition letter. Counts as passed; never inferred. */
export const EXEMPT_LETTER = "MT";

/** Condition-only courses (GDTC/GDQP) when no graduation standard says otherwise. */
export const CONDITION_ONLY_CODE_PATTERN = /^71(?:NAD|PE)/;
/**
 * Credits a condition-only course (GDTC/GDQP) printed with 0 credits (K27/K28 "Giáo dục thể chất (1)") counts in its skills'
 * score and coverage (comp-calc-v17). Its skills are condition-only, so group and overall scores never see it; without it such a
 * skill had no weight at all and was listed as outside the student's choices although the course was passed.
 */
export const CONDITION_NOMINAL_CREDITS = 1;
/** Folded CTĐT block name of the condition-only courses. */
export const CONDITION_ONLY_BLOCK = "giao duc the chat va giao duc quoc phong";
