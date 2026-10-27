/** The Faculty's majors by the programme code of the MSSV (apps/api/src/curricula/majors.ts; user, 2026-10-27). */
export const MAJOR_OPTIONS = [
  { code: "7480201", label: "Công nghệ thông tin", short: "CNTT" },
  { code: "7480104", label: "Hệ thống thông tin", short: "HTTT" },
  { code: "7480102", label: "Mạng máy tính và truyền thông dữ liệu", short: "MMT&TTDL" },
] as const;
const MAJOR_LABELS: Record<string, string> = Object.fromEntries(MAJOR_OPTIONS.map((major) => [major.code, major.label]));

/** "Công nghệ thông tin" for 7480201; another programme by its code; null without one. */
export const majorLabel = (code: string | null | undefined) =>
  code ? MAJOR_LABELS[code.trim()] ?? `Mã ngành ${code.trim()}` : null;

/** "HTTT, MMT&TTDL": the short names of the Faculty's majors among the codes, in the Faculty's order. */
export const majorShortNames = (codes: readonly string[] | null | undefined) =>
  MAJOR_OPTIONS.filter((major) => codes?.includes(major.code)).map((major) => major.short).join(", ");
