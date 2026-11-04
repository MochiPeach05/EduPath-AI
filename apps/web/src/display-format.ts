// One way to write terms, scores, program names and status colours on every student page (user review 2026-10-30:
// "Học kỳ đang được gọi theo 4 kiểu … Nên chọn một kiểu duy nhất", "Dấu thập phân lẫn lộn", "Tên chương trình viết HOA
// toàn bộ", "Màu trạng thái chưa đúng nghĩa").

/** "HK261" → "HK1 2026–2027": the one way a term is written on student pages, in tables and sentences alike. Other shapes are shown as they are. */
export function termName(code: string): string {
  const match = /^HK(\d{2})([1-3])$/.exec(code);
  if (!match) return code;
  const start = 2000 + Number(match[1]);
  return `HK${match[2]} ${start}–${start + 1}`;
}

/** Days and times are shown in Vietnam time, wherever the browser is. */
const VIETNAM_TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", hourCycle: "h23", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric",
});
type Moment = string | number | Date | null | undefined;
function vietnamParts(value: Moment): Record<string, string> | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Object.fromEntries(VIETNAM_TIME.formatToParts(date).map(part => [part.type, part.value]));
}

/**
 * "03/11/2026": the day of a moment in Vietnam time, the one way both portals write a date (QA 2026-11-04: the admin
 * pages wrote dates four ways). `empty` stands for no moment or one that cannot be read.
 */
export function formatVnDate(value: Moment, empty = "—"): string {
  const parts = vietnamParts(value);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : empty;
}

/** "14:05 03/11/2026": the time, then the day, in Vietnam time, as the "Cập nhật lúc" lines of the student pages. */
export function formatVnDateTime(value: Moment, empty = "—"): string {
  const parts = vietnamParts(value);
  return parts ? `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}/${parts.year}` : empty;
}

/** A CTĐT/KHĐT position (study year N, semester S) as the cohort's calendar term: year 1 of a cohort admitted in 2023 is HK1 2023–2024 ("HK231"). */
export function planTermCode(studyYear: number, semester: number, admissionYear: number): string {
  return `HK${String((admissionYear + studyYear - 1) % 100).padStart(2, "0")}${semester}`;
}

/**
 * A 0–100 score as every page shows it: at most one decimal, rounded down to the tenth so a level bound (50, 62,5, 80, 90)
 * is never shown as reached before it is. 59,86 → "59,8", 68 → "68", 62,5 → "62,5".
 */
export function scoreText(value: number): string {
  return (Math.floor(value * 10 + 1e-9) / 10).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
}

/** A number with the Vietnamese decimal comma: 2.45 → "2,45"; with `digits`, exactly that many decimals (GPA 2.4 → "2,40"). */
export function decimalText(value: number, digits?: number): string {
  return value.toLocaleString("vi-VN", digits === undefined ? { maximumFractionDigits: 2 } : { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Short all-capital words that stay as they are when a name is turned into sentence case (no Vietnamese word lacks a vowel). */
const KEPT_WORDS: Record<string, string> = { AI: "AI", IT: "IT", IOT: "IoT", UI: "UI", UX: "UX" };
const VOWEL = /[aăâeêioôơuưyàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;

/**
 * A program name stored in capitals ("KỸ THUẬT PHẦN MỀM") in sentence case ("Kỹ thuật phần mềm"). Words without a vowel
 * are acronyms and stay (CNTT, HTTT), and so do AI, IT, IoT, UI, UX. A name that already has lower-case letters is kept.
 */
export function programName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name !== name.toLocaleUpperCase("vi-VN")) return name;
  const words = name.split(" ").map((word) => KEPT_WORDS[word] ?? (VOWEL.test(word) ? word.toLocaleLowerCase("vi-VN") : word));
  const first = words[0]!;
  words[0] = first === first.toLocaleLowerCase("vi-VN") ? first.charAt(0).toLocaleUpperCase("vi-VN") + first.slice(1) : first;
  return words.join(" ");
}

/**
 * What a status colour means, the same on every page: good = green (đạt tốt), fine = blue (đạt), warn = amber (cần chú ý),
 * bad = red (chưa đạt), none = grey (chưa có điểm, chưa tới kỳ, bình thường). Red is only for something not passed.
 */
export type Meaning = "good" | "fine" | "warn" | "bad" | "none";

/** One colour per word, so the same word never wears two colours (Trung bình is amber as a level and as a fit). */
const MEANING_OF_WORD: Record<string, Meaning> = {
  "Xuất sắc": "good", "Giỏi": "good", "Rất phù hợp": "good", "Phù hợp": "good", "Đạt": "good",
  "Khá": "fine",
  "Trung bình": "warn", "Ít phù hợp": "warn",
  "Yếu": "bad", "Không phù hợp": "bad", "Chưa đạt": "bad",
};
/** The meaning of a level, fit or result label ("Ít phù hợp" → warn); anything else, such as "Chưa có điểm", is none. */
export const meaningOf = (label: string | null | undefined): Meaning => (label ? MEANING_OF_WORD[label.trim()] : undefined) ?? "none";
/** The class that paints a chip or badge in its meaning's colours (display-format.css). */
export const meaningClass = (meaning: Meaning) => `meaning-${meaning}`;
