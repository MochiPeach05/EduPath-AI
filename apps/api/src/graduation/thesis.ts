// The graduation thesis option of an elective group: K29 "Nhóm tự chọn TC306" (6 TC) holds
// 71ITGR40206 Đồ án Tốt nghiệp (6 TC) next to 3-TC replacement courses ("Khóa luận/đồ án tốt
// nghiệp; hoặc học phần thay thế KL/ĐA TN"), K28 the same with Khóa luận tốt nghiệp. Pure. The
// graduation page's deterministic suggestions (apps/web) apply the same rule: keep both identical.
// The Khoa's eligibility rule for doing the thesis is not in our data.
import type { GradCourseState, GraduationCourseRow, GraduationGroupEvaluation } from "./evaluation.js";
import { fold } from "./model.js";

/**
 * not_started: neither the thesis nor a replacement course is under way; replacement: another
 * course of the group is passed, exempt, in progress or graded (the student took the replacement
 * path); thesis_in_progress: the thesis course itself is in progress.
 */
export type ThesisPath = "not_started" | "replacement" | "thesis_in_progress";

export type ThesisOption = {
  /** The first course of the group, in standard order, that is a thesis and completes the group alone. */
  thesis: GraduationCourseRow;
  /** Every other course of the group, in standard order. */
  replacements: GraduationCourseRow[];
  path: ThesisPath;
};

/** Matched on the folded name (NFD, marks stripped, đ → d, lower case, spaces collapsed). */
export const THESIS_NAME_PATTERN = /\b(do an|khoa luan) tot nghiep\b/;

/** A course state that puts the student on the replacement path (a failed attempt does not). */
export const startsReplacementPath = (state: GradCourseState): boolean =>
  state === "passed" || state === "exempt" || state === "in_progress" || state === "graded_unknown";

const isThesis = (course: GraduationCourseRow, required: number | null): boolean =>
  course.credits !== null && required !== null && course.credits >= required && THESIS_NAME_PATTERN.test(fold(course.name));

/** The thesis option of an elective group that is not passed; null for any other group or without a thesis course. */
export function thesisOption(group: GraduationGroupEvaluation): ThesisOption | null {
  if (group.kind !== "elective" || group.status === "pass") return null;
  const thesis = group.courses.find((course) => isThesis(course, group.required));
  if (!thesis) return null;
  const replacements = group.courses.filter((course) => course !== thesis);
  const path: ThesisPath = thesis.state === "in_progress" ? "thesis_in_progress"
    : replacements.some((course) => startsReplacementPath(course.state)) ? "replacement" : "not_started";
  return { thesis, replacements, path };
}

/** "Chuyên đề tốt nghiệp 1", "Chuyên đề Tốt nghiệp 2": the courses that replace the thesis. */
export const TOPIC_NAME_PATTERN = /\bchuyen de tot nghiep\b/;

/**
 * Cumulative GPA (4-point scale, as the transcript prints it) from which the thesis is recommended; below it, the
 * replacement courses (user 2026-11-03: "Chuyển đề tốt nghiệp 1, 2 là môn học thay thế đồ án tốt nghiệp thôi … điểm của sinh
 * viên mà ổn thì đề xuất làm đồ án tốt nghiệp còn thấp thì làm 2 môn thay thế đó", "TB tích lũy từ 2,80"). An internal
 * setting since 2026-11-10 (user: "cái này như kiểu là cài đặt ngầm trong hệ thống vậy thôi sẽ hiện ra như kiểu đề xuất tất
 * nhiên và vẫn có giữ lại môn đồ án tốt nghiệp do sinh viên chọn hết mà"): it only picks the way the pages recommend. No
 * student-facing text, AI prompt or data block states it, the GPA as the reason, or "vì điểm…"; the other way stays an
 * option, and the way the student chose (thesisChoice) always wins over it.
 */
export const THESIS_MIN_GPA = 2.8;
/** thesis: the thesis course alone; replacement: the replacement courses (the chuyên đề courses when the group has them). */
export type ThesisWay = "thesis" | "replacement";
export type ThesisGpa = { actual: number | null; scale: number } | null | undefined;

/**
 * The way the system recommends for a thesis group: a path already taken stays (the thesis in progress; a replacement
 * passed, exempt, in progress or graded); otherwise the cumulative GPA decides, the thesis from THESIS_MIN_GPA and the
 * replacement courses below it (an internal setting, never explained to the student). Null when the GPA is unknown or not
 * on the 4-point scale (the thesis stays the main option then).
 */
export function thesisWay(path: ThesisPath, gpa: ThesisGpa): ThesisWay | null {
  if (path === "thesis_in_progress") return "thesis";
  if (path === "replacement") return "replacement";
  if (!gpa || gpa.actual === null || gpa.scale !== 4) return null;
  return gpa.actual >= THESIS_MIN_GPA - 1e-9 ? "thesis" : "replacement";
}

/** One way, or "both" when the student holds the thesis and a replacement course at once (null: no way yet). */
export type ThesisChoice = ThesisWay | "both" | null;

const codeKey = (code: string) => code.trim().toUpperCase();

/**
 * The way the student chose for a thesis group (user 2026-11-10: "vẫn có giữ lại môn đồ án tốt nghiệp do sinh viên chọn hết
 * mà"): what the transcript shows (path: the thesis in progress; another course of the group passed, exempt, in progress or
 * graded) together with the courses the student placed in Kế hoạch học kỳ themselves (study-plan/own-plan.ts
 * ownPlannedCodes). One way → that way; the thesis and another course of the group → "both"; nothing → null.
 */
export function thesisChoice(path: ThesisPath, thesisCode: string, otherCodes: readonly string[], planned: ReadonlySet<string>): ThesisChoice {
  const placed = new Set([...planned].map(codeKey));
  const thesis = path === "thesis_in_progress" || placed.has(codeKey(thesisCode));
  const replacement = path === "replacement" || otherCodes.some((code) => placed.has(codeKey(code)));
  return thesis && replacement ? "both" : thesis ? "thesis" : replacement ? "replacement" : null;
}

/**
 * The way the pages follow for a thesis group: the student's choice when it is one way (it always wins over the
 * recommendation), else the way the system recommends (thesisWay). Null while the student holds both ways (they keep both,
 * and only hear that one way is enough) or when nothing is recommended.
 */
export function followedThesisWay(choice: ThesisChoice, recommended: ThesisWay | null): ThesisWay | null {
  if (choice === "both") return null;
  return choice ?? recommended;
}

/** "dưới 2,80", "từ 2,80 trở lên", "ngưỡng 2,8": the threshold the rule of 2026-11-03 named (THESIS_MIN_GPA). */
const THRESHOLD_TEXT = /(?:dưới|từ|trên|ngưỡng|mức|đạt)\s+(?:mức\s+|ngưỡng\s+)?2[,.]80?(?![\d,.]*\d)|2[,.]80?\s*(?:\/\s*4\s*)?trở lên/u;
const THESIS_TEXT = /(?:đồ án|khóa luận|khoá luận|chuyên đề) tốt nghiệp|học phần thay thế/u;
const GPA_TEXT = /điểm (?:trung bình|tb)|(?<![a-z])gpa(?![a-z])|đtb/u;

/**
 * A text an AI wrote while its data gave the GPA behind the thesis way (roadmap-v13 to v15, grad-advice-v4 to v6, before
 * the rule became an internal setting on 2026-11-10), without the sentences that explain the way by it: a sentence naming
 * the threshold ("dưới 2,80", "từ 2,80 trở lên"), or the thesis group's courses together with the GPA ("Với điểm trung bình
 * tích lũy 2,45, bạn nên học Chuyên đề tốt nghiệp…"). Null when nothing is left. Newer outputs are never filtered: their
 * data has no such reason.
 */
export function withoutThesisGpaReason(text: string): string | null {
  const kept = text.split(/(?<=[.!?…])\s+/u).filter((sentence) => {
    const plain = sentence.normalize("NFC").toLocaleLowerCase("vi");
    return !THRESHOLD_TEXT.test(plain) && !(THESIS_TEXT.test(plain) && GPA_TEXT.test(plain));
  });
  const joined = kept.join(" ").trim();
  return joined || null;
}

/**
 * The replacement path's courses: the chuyên đề courses when the group has them and their credits complete the group's
 * quota (required; unknown: they do), else every other course of the group (a group with only Chuyên đề tốt nghiệp 1
 * beside a 6-TC thesis would otherwise ask for 6 TC from 3).
 */
export function replacementPath<T extends { name: string; credits: number | null }>(replacements: readonly T[], required: number | null = null): T[] {
  const found = replacements.filter((course) => TOPIC_NAME_PATTERN.test(fold(course.name)));
  const enough = required === null || found.reduce((sum, course) => sum + (course.credits ?? 0), 0) + 1e-9 >= required;
  const topics = enough ? found : [];
  return topics.length ? topics : [...replacements];
}

/** "khóa luận tốt nghiệp" or "đồ án tốt nghiệp", as the thesis course names itself. */
export const thesisNoun = (thesis: Pick<GraduationCourseRow, "name">): string =>
  THESIS_NAME_PATTERN.exec(fold(thesis.name))?.[1] === "khoa luan" ? "khóa luận tốt nghiệp" : "đồ án tốt nghiệp";
