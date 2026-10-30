/** The Faculty's majors by the programme code of the MSSV (apps/api/src/curricula/majors.ts; user, 2026-10-27). */
const MAJOR_LABELS: Record<string, string> = {
  "7480201": "Công nghệ thông tin",
  "7480104": "Hệ thống thông tin",
  "7480102": "Mạng máy tính và truyền thông dữ liệu",
};

/** The majors as choices (code and name) by code, as GET /api/admin/announcements/options lists them (Object.entries puts
 *  these number-like keys in numeric order): the announcement targets use them (2026-10-30). */
export const majorOptions: readonly { code: string; name: string }[] = Object.entries(MAJOR_LABELS).map(([code, name]) => ({ code, name }));

/** "Công nghệ thông tin" for 7480201; another programme by its code; null without one. */
export const majorLabel = (code: string | null | undefined) =>
  code ? MAJOR_LABELS[code.trim()] ?? `Mã ngành ${code.trim()}` : null;
