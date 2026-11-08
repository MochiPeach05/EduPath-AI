// Môn bắt buộc của chuyên ngành khác (user 2026-11-08: "sinh viên khi có điểm môn bắt buộc của ngành khác có thể chuyển nó
// thành môn tự chọn … yêu cầu sinh viên liên hệ với nhà trường"; asked, they chose "Không tính, chỉ nhắc"). A passed
// mandatory course of another specialty of the student's own CTĐT counts in no group until the school converts it into an
// elective of the specialty electives group (TC206 for K26, TC209 for K28, TC309 for K29–K31 …); Xét tốt nghiệp and the
// transcript only say so. Pure.
import { courseKey, isPassedState, transcriptCourses, uniqueCurriculumCourses } from "../competency-assessment/course-state.js";
import { classifyCurriculumSpecialty, fold, specialtyLabel } from "../competency-assessment/specialty.js";
import type { CurriculumCourseInput, SpecialtyCode } from "../competency-assessment/types.js";
import type { TranscriptData } from "../student/transcript-parser.js";

export type ConvertibleCourse = { code: string; name: string; credits: number; specialty: string };
/** groupCode: the CTĐT's specialty electives group the school can convert them into; null when the CTĐT has none. */
export type ConvertibleCourses = { courses: ConvertibleCourse[]; groupCode: string | null };

const SPECIALTY_ELECTIVES = "tu chon chuyen nganh";
const groupOf = (type: string) => /^(TC\d+)/i.exec(type.trim())?.[1]?.toUpperCase() ?? null;

/** The elective group of the CTĐT whose courses are its "Tự chọn Chuyên ngành" (the most of them, when several). */
export function specialtyElectivesGroup(courses: readonly Pick<CurriculumCourseInput, "type" | "specialty">[]): string | null {
  const counts = new Map<string, number>();
  for (const course of courses) {
    const group = groupOf(course.type);
    if (group && fold(course.specialty ?? "") === SPECIALTY_ELECTIVES) counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/**
 * The passed mandatory courses of the CTĐT's other specialties (none without the student's own specialty, as then
 * nothing is "other"), in the CTĐT's order, with the group they could become electives of.
 */
export function convertibleCourses(courses: readonly CurriculumCourseInput[], transcript: TranscriptData, cohortCode: string | null,
  specialty: SpecialtyCode | null): ConvertibleCourses {
  if (!specialty || !courses.length) return { courses: [], groupCode: null };
  const records = transcriptCourses(transcript);
  const own = new Set(uniqueCurriculumCourses(courses).filter((course) => {
    const kind = classifyCurriculumSpecialty(course.specialty, cohortCode);
    return kind.kind !== "specialty" || kind.code === specialty;
  }).map((course) => courseKey(course.code)));
  const found = uniqueCurriculumCourses(courses).flatMap((course): ConvertibleCourse[] => {
    const kind = classifyCurriculumSpecialty(course.specialty, cohortCode);
    if (kind.kind !== "specialty" || kind.code === specialty || !/^BB/i.test(course.type.trim()) || own.has(courseKey(course.code))) return [];
    if (!isPassedState(records.get(courseKey(course.code))?.state ?? "not_taken")) return [];
    return [{ code: course.code, name: course.name, credits: course.credits, specialty: specialtyLabel(kind.code) ?? course.specialty }];
  });
  return { courses: found, groupCode: found.length ? specialtyElectivesGroup(courses) : null };
}
