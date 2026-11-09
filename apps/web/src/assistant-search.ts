/**
 * Tìm cuộc trò chuyện of Trợ lý AI (user 2026-11-09: "Thêm một chức năng tìm kiếm cuộc hội thoại nữa"): the words of a
 * search, compared without accents or case exactly as the server compares them (apps/api/src/assistant/thread-search.ts),
 * so "dieu kien" finds "Điều kiện"; and where they appear in a text, to mark them.
 */
/** The longest search sent, in characters (the server reads no more). */
export const MAX_SEARCH_CHARS = 100;

/** One character as the search compares it: lower case, no diacritics, đ → d. */
const foldChar = (ch: string) => ch.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();

/** The text folded (foldChar), and for each folded character where it starts in the text (one more at the end). */
export function foldWithMap(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  let index = 0;
  for (const ch of text) {
    const one = foldChar(ch);
    for (let k = 0; k < one.length; k += 1) at.push(index);
    folded += one;
    index += ch.length;
  }
  at.push(index);
  return { folded, at };
}

/** The folded words of a search, each once; none when it has fewer than two letters or digits in all. */
export function searchWords(query: string): string[] {
  const words = [...new Set(foldWithMap(query.slice(0, MAX_SEARCH_CHARS)).folded.split(/[\s.,;:!?"'“”‘’()[\]{}<>]+/u).filter(Boolean))];
  return words.join("").replace(/[^\p{L}\p{N}]/gu, "").length >= 2 ? words : [];
}

/** Whether a title holds every word of the search. */
export function titleHas(title: string, words: readonly string[]): boolean {
  const folded = foldWithMap(title).folded;
  return words.length > 0 && words.every((word) => folded.includes(word));
}

/** Where the words appear in `text`: [start, end) of the text in order, merged when they overlap or only spaces part them. */
export function matchRanges(text: string, words: readonly string[]): [number, number][] {
  const { folded, at } = foldWithMap(text);
  const ranges: [number, number][] = [];
  for (const word of words) {
    for (let index = folded.indexOf(word); index >= 0; index = folded.indexOf(word, index + word.length)) {
      ranges.push([at[index]!, at[index + word.length]!]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && (start <= last[1] || !text.slice(last[1], start).trim())) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
