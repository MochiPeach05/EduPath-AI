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
