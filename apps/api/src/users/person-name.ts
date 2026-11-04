// A person's name from an account's display name (QA 2026-11-04: the admin portal showed "2374802010145 - Đào Văn Hòa -
// 71K29CNTT08" for an admin's name). Microsoft names VLU students "MSSV - Họ tên - Lớp" (K26: "207CT12345 - Họ Tên -
// K26T-IT11"); the database keeps the name part in student_profiles.full_name (migrations 005, 044–045), and the web shows
// it the same way (apps/web/src/person-name.ts). This is for the names the API writes itself: Nhật ký thao tác and the
// student's notifications.

const SEPARATOR = /\s+[-–—]\s+/;

/**
 * "2374802010145 - Đào Văn Hòa - 71K29CNTT08" → "Đào Văn Hòa"; "MSSV - Họ tên" and "Họ tên - Lớp" too. Any other name is
 * kept whole ("ThS. Nguyễn Văn A", "Trần Thị Mai-Anh"), trimmed.
 */
export function personName(raw: string): string {
  const whole = raw.trim();
  const parts = whole.split(SEPARATOR).filter(Boolean);
  if (parts.length >= 3) return parts.slice(1, -1).join(" - ");
  if (parts.length === 2) {
    const [first, second] = parts as [string, string];
    if (/^\d+$/.test(first)) return second;
    if (/^\d{2}K\d{2}/i.test(second)) return first;
  }
  return whole;
}
