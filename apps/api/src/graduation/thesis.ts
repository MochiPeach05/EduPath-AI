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
 * Cumulative GPA (4-point scale, as the transcript prints it) from which the thesis is advised; below it, the replacement
 * courses (user 2026-11-03: "Chuyển đề tốt nghiệp 1, 2 là môn học thay thế đồ án tốt nghiệp thôi … điểm của sinh viên mà
 * ổn thì đề xuất làm đồ án tốt nghiệp còn thấp thì làm 2 môn thay thế đó", "TB tích lũy từ 2,80").
 */
export const THESIS_MIN_GPA = 2.8;
/** thesis: the thesis course alone; replacement: the replacement courses (the chuyên đề courses when the group has them). */
export type ThesisWay = "thesis" | "replacement";
export type ThesisGpa = { actual: number | null; scale: number } | null | undefined;

/**
 * The way to advise for a thesis group: a path already taken stays (the thesis in progress; a replacement passed, exempt,
 * in progress or graded); otherwise the cumulative GPA decides, the thesis from THESIS_MIN_GPA and the replacement
 * courses below it. Null when the GPA is unknown or not on the 4-point scale (the thesis stays the main option then).
 */
export function thesisWay(path: ThesisPath, gpa: ThesisGpa): ThesisWay | null {
  if (path === "thesis_in_progress") return "thesis";
  if (path === "replacement") return "replacement";
  if (!gpa || gpa.actual === null || gpa.scale !== 4) return null;
  return gpa.actual >= THESIS_MIN_GPA - 1e-9 ? "thesis" : "replacement";
}

const gpaText = (value: number) => value.toFixed(2).replace(".", ",");
/** "điểm TB tích lũy 3,10, từ 2,80 trở lên" or "điểm TB tích lũy 2,45, dưới 2,80": why the GPA chose the way (null otherwise). */
export function thesisWayReason(path: ThesisPath, gpa: ThesisGpa): string | null {
  const way = path === "not_started" ? thesisWay(path, gpa) : null;
  if (!way || !gpa || gpa.actual === null) return null;
  return `điểm TB tích lũy ${gpaText(gpa.actual)}, ${way === "thesis" ? `từ ${gpaText(THESIS_MIN_GPA)} trở lên` : `dưới ${gpaText(THESIS_MIN_GPA)}`}`;
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
