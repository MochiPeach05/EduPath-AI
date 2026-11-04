// A person's name from an account's display name, the same way in both portals (QA 2026-11-04: the admin header showed
// "2374802010145 - Đào Văn Hòa - 71K29CNTT08" and the avatar "2"). Microsoft names VLU students "MSSV - Họ tên - Lớp"
// ("2374802010145 - Đào Văn Hòa - 71K29CNTT08"; K26: "207CT12345 - Họ Tên - K26T-IT11"), which the database splits the
// same way into student_profiles (migrations 005, 044–045); a staff account carries only the name. The API writes names
// the same way (apps/api/src/users/person-name.ts: Nhật ký thao tác, the student's notifications).

const SEPARATOR = /\s+[-–—]\s+/;

/** A display name split: the person's name, and the student code (MSSV) when the display name carries one. */
export type PersonIdentity = { name: string; code: string | null };

/**
 * "2374802010145 - Đào Văn Hòa - 71K29CNTT08" → { name: "Đào Văn Hòa", code: "2374802010145" }; "MSSV - Họ tên" and
 * "Họ tên - Lớp" are read too. Any other name is kept whole ("Trần Thị Mai-Anh", "ThS. Nguyễn Văn A").
 */
export function personIdentity(raw: string): PersonIdentity {
  const whole = raw.trim();
  const parts = whole.split(SEPARATOR).filter(Boolean);
  if (parts.length >= 3) return { name: parts.slice(1, -1).join(" - "), code: parts[0]! };
  if (parts.length === 2) {
    if (/^\d+$/.test(parts[0]!)) return { name: parts[1]!, code: parts[0]! };
    if (/^\d{2}K\d{2}/i.test(parts[1]!)) return { name: parts[0]!, code: null };
  }
  return { name: whole, code: null };
}

/** The name to show for a display name (personIdentity): only the name part of "MSSV - Họ tên - Lớp". */
export const personName = (raw: string): string => personIdentity(raw).name;

/**
 * Up to two initials, from the last two words that start with a capital letter (any letter when none does), so a
 * student code, a class code or a stray "-" never shows up: "Nguyễn Bảo Duy" gives "BD", "Sinh viên Thử nghiệm K27" "TK".
 */
export function nameInitials(name: string): string {
  const words = name.normalize("NFC").split(/\s+/).filter(word => /^\p{L}/u.test(word));
  const capitalised = words.filter(word => /^\p{Lu}/u.test(word));
  return (capitalised.length > 0 ? capitalised : words).slice(-2).map(word => word[0]).join("").toLocaleUpperCase("vi");
}
