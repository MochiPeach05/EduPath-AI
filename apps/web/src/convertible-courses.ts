// Courses of another specialty the student passed (API graduation/convertible.ts, on GET /api/student/transcript and
// GET /api/student/graduation):
// - otherSpecialty (user 2026-11-14, after the GVHD confirmed it): counted in the student's specialty electives group, a
//   mandatory course or an elective of another specialty alike (comp-calc-v24); the pages say in which group.
// - convertible (user 2026-11-08, "Không tính, chỉ nhắc"): passed mandatory courses of another specialty still counted in
//   no group, because the student's standard has no specialty electives group to take them; the school can convert them.
import { decimalText } from "./display-format";

type OtherCourse = { code: string; name: string; credits: number; specialty: string };
export type ConvertibleCourses = { courses: OtherCourse[]; groupCode: string | null };
/** group: the label of the standard's group they count in ("Nhóm tự chọn TC209"). */
export type CountedOtherSpecialty = { courses: OtherCourse[]; group: string };

const key = (code: string) => code.trim().toUpperCase();

/** The codes, to mark their rows. */
export const convertibleCodes = (convertible: ConvertibleCourses | null | undefined): ReadonlySet<string> =>
  new Set((convertible?.courses ?? []).map((course) => key(course.code)));
export const isConvertible = (codes: ReadonlySet<string>, code: string | null | undefined) => Boolean(code && codes.has(key(code)));

/** The mark on the row of a course still counted nowhere. */
export const CONVERTIBLE_ROW_NOTE = "Môn của chuyên ngành khác: liên hệ nhà trường để chuyển thành môn tự chọn";
/** The mark on the row of a course the specialty electives group counts. */
export const countedRowNote = (group: string) => `Môn của chuyên ngành khác: được tính vào ${group || "nhóm tự chọn chuyên ngành"}`;

/** Code → the mark on its transcript row: the counted courses name their group, the others keep the reminder. */
export function otherSpecialtyNotes(convertible: ConvertibleCourses | null | undefined, counted: CountedOtherSpecialty | null | undefined): ReadonlyMap<string, string> {
  const notes = new Map<string, string>();
  for (const course of convertible?.courses ?? []) notes.set(key(course.code), CONVERTIBLE_ROW_NOTE);
  for (const course of counted?.courses ?? []) notes.set(key(course.code), countedRowNote(counted!.group));
  return notes;
}

const listOf = (courses: readonly OtherCourse[]) =>
  courses.map((course) => `${course.name} (${decimalText(course.credits)} TC, chuyên ngành ${course.specialty})`).join("; ");

/** "Môn Nhập môn xử lý ảnh số (3 TC, chuyên ngành Trí tuệ nhân tạo) thuộc chuyên ngành khác và được tính vào …"; null without any. */
export function countedText(counted: CountedOtherSpecialty | null | undefined): string | null {
  const courses = counted?.courses ?? [];
  if (!courses.length) return null;
  const one = courses.length === 1;
  return `${one ? "Môn" : "Các môn"} ${listOf(courses)} thuộc chuyên ngành khác và được tính vào ${counted!.group || "nhóm tự chọn chuyên ngành"}, `
    + "nhóm tự chọn chuyên ngành của bạn.";
}

/** "Môn Nhập môn công nghệ phần mềm (3 TC, chuyên ngành Công nghệ phần mềm) thuộc chuyên ngành khác …"; null without any. */
export function convertibleText(convertible: ConvertibleCourses | null | undefined): string | null {
  const courses = convertible?.courses ?? [];
  if (!courses.length) return null;
  const one = courses.length === 1;
  const target = convertible!.groupCode ? `môn tự chọn chuyên ngành (${convertible!.groupCode})` : "môn tự chọn";
  return `${one ? "Môn" : "Các môn"} ${listOf(courses)} thuộc chuyên ngành khác nên chưa được tính vào nhóm học phần nào của bạn. `
    + `Bạn có thể liên hệ nhà trường để chuyển ${one ? "môn này" : "các môn này"} thành ${target}.`;
}
