// The file check of the admin import dialogs: a chosen file is sent only when the endpoint that reads it would take it,
// by the same rules (QA 2026-11-04: the Tiêu chuẩn xét tốt nghiệp import sent a .pdf and a 6 MB file to the server).
// The CTĐT, KHĐT and CVHT imports check ".xlsx, at most 5 MB" the same way.

/** The largest file an admin import endpoint takes: express raw({ limit: "5mb" }) is 5 × 1024 × 1024 bytes. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** ".xlsx", or ".xls, .xlsx hoặc .zip" for several. */
export function extensionText(extensions: readonly string[]): string {
  if (extensions.length < 2) return extensions[0] ?? "";
  return `${extensions.slice(0, -1).join(", ")} hoặc ${extensions[extensions.length - 1]}`;
}

/**
 * Why the chosen file cannot be imported, in Vietnamese, or "" when it can: a type the endpoint does not read (by the
 * extension, as the server checks the file name), an empty file, then a file over the limit.
 */
export function importFileProblem(file: Pick<File, "name" | "size">, extensions: readonly string[], maxBytes = IMPORT_MAX_BYTES): string {
  const types = extensionText(extensions);
  const limit = `${Math.round(maxBytes / 1024 / 1024)} MB`;
  const name = file.name.toLowerCase();
  if (!extensions.some((extension) => name.endsWith(extension.toLowerCase())))
    return `Tệp “${file.name}” không đúng định dạng. Hãy chọn tệp ${types}.`;
  if (!file.size) return `Tệp “${file.name}” không có dữ liệu. Hãy chọn lại tệp ${types}.`;
  if (file.size > maxBytes) return `Tệp “${file.name}” lớn hơn ${limit}. Hãy chọn tệp ${types} không quá ${limit}.`;
  return "";
}
