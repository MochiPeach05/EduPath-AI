/**
 * The Faculty's majors (user, 2026-10-26: "CNTT, HTTT và MMT & TTDT là 3 ngành khác nhau … không phải chuyên ngành của
 * CNTT"). A workbook may name its major by the short name ("KẾ HOẠCH ĐÀO TẠO THỰC TẾ - KHÓA 31 - MMT & TTDL"); the full
 * name keeps the CTĐT and the KHĐT of one major and cohort under one identity (major:cohort).
 */
const FULL_NAMES: Record<string, string> = {
  cntt: "CÔNG NGHỆ THÔNG TIN",
  it: "CÔNG NGHỆ THÔNG TIN",
  httt: "HỆ THỐNG THÔNG TIN",
  mmtttdl: "MẠNG MÁY TÍNH VÀ TRUYỀN THÔNG DỮ LIỆU",
  mmtvattdl: "MẠNG MÁY TÍNH VÀ TRUYỀN THÔNG DỮ LIỆU",
};

/** The full name of a major written by its short name; any other name as written. */
export function fullMajorName(name: string) {
  const key = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z]/g, "");
  return FULL_NAMES[key] ?? name;
}

/**
 * The majors by the programme code a student's MSSV holds (student_profiles.major_code, migration 052;
 * user, 2026-10-27: "Điền ngành đúng nè").
 */
export const MAJORS = [
  { code: "7480201", name: "CÔNG NGHỆ THÔNG TIN", label: "Công nghệ thông tin" },
  { code: "7480104", name: "HỆ THỐNG THÔNG TIN", label: "Hệ thống thông tin" },
  { code: "7480102", name: "MẠNG MÁY TÍNH VÀ TRUYỀN THÔNG DỮ LIỆU", label: "Mạng máy tính và truyền thông dữ liệu" },
] as const;
export type MajorCode = (typeof MAJORS)[number]["code"];
export const CNTT_MAJOR: MajorCode = "7480201";

/** A CTĐT/KHĐT identity names its major folded ("cong nghe thong tin" of "cong nghe thong tin:K29"). */
export const majorKey = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The identity part of the frameworks and plans of a student's major (user, 2026-10-27: "Chọn khung ok như vậy đi"), or
 * null when the profile has no major (no MSSV): then the cohort's only framework is used, as before majors. A programme
 * the Faculty does not teach matches no framework.
 */
export function majorIdentity(code: string | null | undefined): string | null {
  const value = code?.trim();
  if (!value) return null;
  const major = MAJORS.find((item) => item.code === value);
  return major ? majorKey(major.name) : `ma nganh ${value}`;
}

/** SQL: the framework or plan `alias` is of the major given as parameter $n (majorIdentity); a null major takes any. */
export const majorCondition = (alias: string, param: number) =>
  `($${param}::text IS NULL OR split_part(${alias}.identity_key, ':', 1) = $${param})`;
