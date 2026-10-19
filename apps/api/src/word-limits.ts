// Word limits of the catalog descriptions, the same as the admin forms (apps/web/src/form-checks.ts,
// user 2026-10-20: "Thêm ràng buộc nhập Mô tả", generous on purpose). The longest description in use
// has about 60 words.
import { z } from "zod";

export const DESCRIPTION_MAX_WORDS = 200;
/** Job descriptions, requirement descriptions and the "Phạm vi đánh giá" of a skill. */
export const LONG_DESCRIPTION_MAX_WORDS = 400;

/** Words in a text: runs of characters between spaces. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/** A trimmed text of at most maxLength characters and maxWords words. */
export const limitedText = (maxLength: number, maxWords: number) =>
  z.string().trim().max(maxLength).refine((value) => countWords(value) <= maxWords, { message: `Tối đa ${maxWords} từ.` });
