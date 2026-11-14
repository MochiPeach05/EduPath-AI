// Courses of another specialty the student passed.
// - Counted (user 2026-11-14, after the GVHD confirmed it: "môn chuyên ngành của ngành khác chuyển qua tự chọn của ngành này
//   và môn tự chọn của ngành khác cũng được tính vào tự chọn của ngành này"): a mandatory course or an elective of another
//   specialty of the student's CTĐT that the standard does not list counts toward the standard's specialty electives group
//   (competency-assessment/graduation.ts crossSpecialtyCourses, comp-calc-v24). The pages say in which group.
// - Still counted nowhere: a passed mandatory course of another specialty when the student's standard has no specialty
//   electives group to take it (user 2026-11-08: "Không tính, chỉ nhắc"); Xét tốt nghiệp and the transcript only say so.
// Pure.
import { courseKey, isPassedState, transcriptCourses, uniqueCurriculumCourses } from "../competency-assessment/course-state.js";
import { graduationGroupLabels, graduationInputs, specialtyElectivesGroup } from "../competency-assessment/graduation.js";
import { classifyCurriculumSpecialty, specialtyLabel } from "../competency-assessment/specialty.js";
import type { CurriculumCourseInput, SpecialtyCode } from "../competency-assessment/types.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import type { GraduationData } from "./model.js";

export { specialtyElectivesGroup };

export type ConvertibleCourse = { code: string; name: string; credits: number; specialty: string };
/** groupCode: the CTĐT's specialty electives group the school can convert them into; null when the CTĐT has none. */
export type ConvertibleCourses = { courses: ConvertibleCourse[]; groupCode: string | null };
/** Courses of another specialty the graduation check counts, and the label of the group they count in ("Nhóm tự chọn TC209"). */
export type CountedOtherSpecialty = { courses: ConvertibleCourse[]; group: string };

/**
 * The passed mandatory courses of the CTĐT's other specialties (none without the student's own specialty, as then
 * nothing is "other"), in the CTĐT's order, with the group they could become electives of. `counted`: codes the graduation
 * check counts already (crossSpecialtyCourses); they are left out.
 */
export function convertibleCourses(courses: readonly CurriculumCourseInput[], transcript: TranscriptData, cohortCode: string | null,
  specialty: SpecialtyCode | null, counted: ReadonlySet<string> = new Set()): ConvertibleCourses {
  if (!specialty || !courses.length) return { courses: [], groupCode: null };
  const records = transcriptCourses(transcript);
  const own = new Set(uniqueCurriculumCourses(courses).filter((course) => {
    const kind = classifyCurriculumSpecialty(course.specialty, cohortCode);
    return kind.kind !== "specialty" || kind.code === specialty;
  }).map((course) => courseKey(course.code)));
  const found = uniqueCurriculumCourses(courses).flatMap((course): ConvertibleCourse[] => {
    const kind = classifyCurriculumSpecialty(course.specialty, cohortCode);
    const code = courseKey(course.code);
    if (kind.kind !== "specialty" || kind.code === specialty || !/^BB/i.test(course.type.trim()) || own.has(code) || counted.has(code)) return [];
    if (!isPassedState(records.get(code)?.state ?? "not_taken")) return [];
    return [{ code: course.code, name: course.name, credits: course.credits, specialty: specialtyLabel(kind.code) ?? course.specialty }];
  });
  return { courses: found, groupCode: found.length ? specialtyElectivesGroup(courses) : null };
}

/**
 * What the pages say about the courses of another specialty: those the graduation check counts (with their group) and
 * those still counted nowhere. Both null without a specialty or a transcript; `counted` null without a standard or when
 * none counts.
 */
export function otherSpecialtyCourses(standard: Pick<GraduationData, "groups" | "courses"> | null, courses: readonly CurriculumCourseInput[],
  transcript: TranscriptData | null, cohortCode: string | null, specialty: SpecialtyCode | null): { counted: CountedOtherSpecialty | null; convertible: ConvertibleCourses | null } {
  if (!transcript || !specialty) return { counted: null, convertible: null };
  const cross = standard ? graduationInputs(standard, courses, transcript, { specialty, cohortCode }).crossSpecialty ?? [] : [];
  const counted = cross.length ? {
    courses: cross.map(({ code, name, credits, specialty: label }) => ({ code, name, credits, specialty: label })),
    group: graduationGroupLabels(standard!).get(cross[0]!.groupId) ?? "",
  } : null;
  return { counted, convertible: convertibleCourses(courses, transcript, cohortCode, specialty, new Set(cross.map((course) => course.code))) };
}
