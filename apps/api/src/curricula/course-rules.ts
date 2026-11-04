// Rules about when a course can be taken that the planner and the AI roadmap keep whatever a revision's documents write.
// One place, used by the planner (study-plan/context.ts) and the AI roadmap's choice options (roadmap/facts.ts). Pure.
import { fold } from "../competency-assessment/specialty.js";

/**
 * The courses the school opens every term, whatever the training plans list (user 2026-11-04: "môn anh văn kì nào cũng
 * mở nhé", "thêm các môn thể chất nữa … kì nào cũng mở hết"):
 * - English, by its code (71ENG…) or its name ("Anh văn 5 (AV5)", K26's DTA… "Anh văn 1 (AV1)", "Tiếng Anh …");
 * - Giáo dục thể chất, by its code (71PE…, K26's DGT0010/DGT0020) or its name ("Giáo dục thể chất 1 (*)").
 */
export function opensEveryTerm(code: string, name: string): boolean {
  const key = code.trim().toUpperCase();
  return /^\d*ENG/.test(key) || /^\d*PE/.test(key) || /^DGT/.test(key) || /^(anh van|tieng anh|giao duc the chat)\b/.test(fold(name));
}

/**
 * Courses that need another one studied first (học trước), by name so that every cohort's code is covered (user
 * 2026-11-04: "riêng môn cờ vua nâng cao là phải học xong cờ vua mới cho đk cờ vua nâng cao đó nha"; the CTĐT writes the
 * same pair as học trước): Cờ vua nâng cao after Cờ vua. Names may end with the standard's "(*)".
 */
const STUDIED_FIRST: readonly { course: RegExp; requires: RegExp }[] = [
  { course: /^co vua nang cao\b/, requires: /^co vua\b(?!\s*nang cao)/ },
];

/**
 * The codes among `courses` that a course named `name` needs studied first, one per rule: a course already taken wins
 * over a same-name one that was not, so the planner's check asks for one course, never every code of it.
 */
export function studiedFirstCodes(name: string, courses: readonly { code: string; name: string; state?: string }[]): string[] {
  const own = fold(name);
  return [...new Set(STUDIED_FIRST.filter((rule) => rule.course.test(own)).flatMap((rule) => {
    const matches = courses.filter((course) => rule.requires.test(fold(course.name)));
    const pick = matches.find((course) => course.state !== undefined && course.state !== "not_taken") ?? matches[0];
    return pick ? [pick.code] : [];
  }))];
}

/** A course named `name` cannot be registered yet: a rule asks for a course that none of `studiedNames` (taken at least once, any result, or being taken) is. */
export function blockedUntilStudied(name: string, studiedNames: readonly string[]): boolean {
  const own = fold(name);
  return STUDIED_FIRST.some((rule) => rule.course.test(own) && !studiedNames.some((studied) => rule.requires.test(fold(studied))));
}
