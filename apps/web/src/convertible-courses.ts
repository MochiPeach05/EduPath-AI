// Môn bắt buộc của chuyên ngành khác mà sinh viên đã đạt (user 2026-11-08, "Không tính, chỉ nhắc"): counted in no group,
// the school can convert it into an elective of the specialty electives group. The API lists them (graduation/convertible.ts)
// on GET /api/student/transcript and GET /api/student/graduation; the pages only say so.
import { decimalText } from "./display-format";

export type ConvertibleCourses = { courses: { code: string; name: string; credits: number; specialty: string }[]; groupCode: string | null };

const key = (code: string) => code.trim().toUpperCase();

/** The codes, to mark their rows. */
export const convertibleCodes = (convertible: ConvertibleCourses | null | undefined): ReadonlySet<string> =>
  new Set((convertible?.courses ?? []).map((course) => key(course.code)));
export const isConvertible = (codes: ReadonlySet<string>, code: string | null | undefined) => Boolean(code && codes.has(key(code)));

/** The mark on the row of such a course. */
export const CONVERTIBLE_ROW_NOTE = "Môn của chuyên ngành khác: liên hệ nhà trường để chuyển thành môn tự chọn";

/** "Môn Nhập môn công nghệ phần mềm (3 TC, chuyên ngành Công nghệ phần mềm) thuộc chuyên ngành khác …"; null without any. */
export function convertibleText(convertible: ConvertibleCourses | null | undefined): string | null {
  const courses = convertible?.courses ?? [];
  if (!courses.length) return null;
  const one = courses.length === 1;
  const list = courses.map((course) => `${course.name} (${decimalText(course.credits)} TC, chuyên ngành ${course.specialty})`).join("; ");
  const target = convertible!.groupCode ? `môn tự chọn chuyên ngành (${convertible!.groupCode})` : "môn tự chọn";
  return `${one ? "Môn" : "Các môn"} ${list} thuộc chuyên ngành khác nên chưa được tính vào nhóm học phần nào của bạn. `
    + `Bạn có thể liên hệ nhà trường để chuyển ${one ? "môn này" : "các môn này"} thành ${target}.`;
}
