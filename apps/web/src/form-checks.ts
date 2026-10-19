// Vietnamese messages for the constraints a form field declares (required, maxLength, min, max,
// type, pattern, a word limit…). The browser's own bubbles follow the browser language, so the forms
// check their fields themselves (CheckedForm.tsx) and show these messages under the fields
// (user, 2026-10-20: "Ở các phần ràng buộc phải nhập thông tin thủ công hãy thêm thông báo").
// Pure: no DOM access, unit tested.

/** Words in a text: runs of characters between spaces. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * Word limits of the descriptions (user, 2026-10-20: "để dư giả một xíu không gò bó quá"). The longest
 * description in use has about 60 words; both limits stay well inside the character limits (2000 and
 * 4000). The API checks the same limits (apps/api/src/word-limits.ts).
 */
export const DESCRIPTION_MAX_WORDS = 200;
/** Job descriptions, requirement descriptions and the "Phạm vi đánh giá" of a skill. */
export const LONG_DESCRIPTION_MAX_WORDS = 400;

const number = (value: number) => value.toLocaleString("vi-VN");

export function wordLimitMessage(label: string, maxWords: number, words: number): string {
  return `${label} tối đa ${number(maxWords)} từ (hiện có ${number(words)} từ).`;
}

/** What a field declares and how the browser judged it, read from the DOM by CheckedForm. */
export type FieldState = {
  tag: "input" | "select" | "textarea";
  /** The input type ("text", "number", "email", "checkbox"…); "" for a select or a textarea. */
  type: string;
  required: boolean;
  value: string;
  /** The label's own words before the field ("Tên nhóm năng lực"), without the "*". */
  label: string;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
  title?: string;
  validity: Pick<ValidityState, "valueMissing" | "typeMismatch" | "patternMismatch" | "tooLong" | "tooShort" | "rangeUnderflow" | "rangeOverflow" | "stepMismatch" | "badInput" | "customError">;
  /** The field's own message (setCustomValidity), used for a custom error such as a word limit. */
  validationMessage: string;
};

/** "Tên nhóm năng lực" → "tên nhóm năng lực"; an acronym such as "CTĐT" stays as it is. */
function lowerFirst(label: string): string {
  return /^\p{Lu}\p{Ll}/u.test(label) ? label.charAt(0).toLocaleLowerCase("vi") + label.slice(1) : label;
}

const NOT_TEXT = new Set(["checkbox", "radio", "number", "file", "range", "color", "date", "datetime-local", "month", "time", "week"]);

/** The message to show under the field, or "" when it is valid. A required text of only spaces is empty. */
export function fieldMessage(field: FieldState): string {
  const label = field.label || "Thông tin này";
  const lower = lowerFirst(label);
  const v = field.validity;
  const isText = field.tag === "textarea" || (field.tag === "input" && !NOT_TEXT.has(field.type));
  if (v.valueMissing || (field.required && isText && !field.value.trim())) {
    if (field.type === "checkbox") return "Vui lòng đánh dấu ô xác nhận trước khi tiếp tục.";
    if (field.type === "file") return `Vui lòng chọn ${lower}.`;
    if (field.tag === "select" || field.type === "radio") return /^chọn /iu.test(label) ? `Vui lòng ${lower}.` : `Vui lòng chọn ${lower}.`;
    return /^nhập /iu.test(label) ? `Vui lòng ${lower}.` : `Vui lòng nhập ${lower}.`;
  }
  if (v.customError) return field.validationMessage;
  if (v.badInput) return `${label} phải là số.`;
  if (v.typeMismatch) {
    if (field.type === "email") return "Email chưa đúng định dạng, ví dụ ten@vlu.edu.vn.";
    if (field.type === "url") return "Đường dẫn chưa đúng định dạng, ví dụ https://…";
    return `${label} chưa đúng định dạng.`;
  }
  if (v.patternMismatch) return field.title || `${label} chưa đúng định dạng.`;
  if (v.tooShort) return `${label} cần ít nhất ${number(field.minLength ?? 0)} ký tự.`;
  if (v.tooLong) return `${label} tối đa ${number(field.maxLength ?? 0)} ký tự.`;
  if (v.rangeUnderflow || v.rangeOverflow) {
    if (field.min && field.max) return `${label} phải từ ${field.min} đến ${field.max}.`;
    return field.min ? `${label} phải từ ${field.min} trở lên.` : `${label} tối đa ${field.max}.`;
  }
  if (v.stepMismatch) return !field.step || Number(field.step) === 1 ? `${label} phải là số nguyên.` : `${label} phải là bội số của ${field.step}.`;
  return "";
}

/** The note announced after a refused save: the first message, with the count when there are more. */
export function summaryMessage(messages: readonly string[]): string {
  const found = messages.filter(Boolean);
  if (!found.length) return "";
  return found.length === 1 ? found[0]! : `Còn ${number(found.length)} thông tin cần nhập hoặc sửa. ${found[0]}`;
}
