// The server's check of an answer of Trợ lý AI before it is stored (assistant-v1, 2026-10-28): citations only to sources
// of its prompt, links only to the self-study resources the prompt gave (the model never invents an address the student
// can click), course codes the data did not hold reported as warnings. It does not judge the advice itself: the
// evaluation set does (docs/assistant-evaluation.md).
import { MAX_ANSWER_CHARS } from "./protocol.js";

export type AnswerContext = { sourceCount: number; allowedUrls: readonly string[]; knownCodes: readonly string[] };
export type CheckedAnswer = { content: string; cited: number[]; warnings: string[] };

const MARKDOWN_LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/g;
const CITATION_PATTERN = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g;
/** VLU course codes (71ITSE30103, DQP0061) and the like. */
const CODE_PATTERN = /\b(?:\d{2}[A-Z]{2,8}\d{3,6}|[A-Z]{2,5}\d{3,6})\b/g;

/** An address without the punctuation that ends its sentence, and without a trailing slash, for comparison. */
export const normalizeUrl = (url: string) => url.replace(/[.,;:!?]+$/, "").replace(/\/+$/, "");

/** One or more citations side by side ("[2][5]"), with the spaces before them. */
const CITATION_GROUP = /([ \t]*)((?:\[\d+\])+)/g;
const numbersOf = (group: string) => (group.match(/\d+/g) ?? []).map(Number);

/**
 * Fewer markers in the text (assistant-v6, user 2026-10-29: "Tôi thấy hiện tại nó trả lời không có human lắm"): an empty
 * "[]" goes, stacked citations ("[7], [5], [12]", "[7] [5]") become one sorted group ("[5][7][12]"), and within a block
 * (text between blank lines) a source keeps only its last citation. The sources cited stay the same.
 */
export function compactCitations(text: string): string {
  const grouped = text.replace(/[ \t]*\[[ \t]*\]/g, "")
    .replace(/\[\d+\](?:[ \t]*[,;]?[ \t]*\[\d+\])+/g, (group) => [...new Set(numbersOf(group))].sort((a, b) => a - b).map((n) => `[${n}]`).join(""));
  return grouped.split(/(\n[ \t]*\n)/).map((block, index) => {
    if (index % 2) return block;
    const last = new Map<number, number>();
    [...block.matchAll(CITATION_GROUP)].forEach((match, at) => { for (const n of numbersOf(match[2]!)) last.set(n, at); });
    let at = -1;
    return block.replace(CITATION_GROUP, (_match, space: string, group: string) => {
      at += 1;
      const kept = numbersOf(group).filter((n) => last.get(n) === at);
      return kept.length ? `${space}${kept.map((n) => `[${n}]`).join("")}` : "";
    });
  }).join("");
}

/** A word before a number that names a version, not a score: "Python 3.12", "phiên bản 3.12", "Node.js 20.11". */
const VERSION_WORDS = /^(?:bản|version|ver)$/i;
/** ASCII words that do come before a score: "GPA 2.45", "IELTS 6.5", "C+ 6.6". */
const SCORE_WORDS = /^(?:gpa|cpa|tb|tbc|ielts|toefl|toeic|vstep|[a-f][+-]?)$/i;
const ASCII_WORD = /^[A-Za-z0-9.+#_-]+$/;
/** One or two decimals after a point, not part of a longer dotted run (a date, an IP address, 1.500.000) or of a word. */
const POINT_DECIMAL = /(?<![\p{L}\p{N}.,])(\d{1,3})\.(\d{1,2})(?![\p{N}\p{L}]|[.,]\d)/gu;

/**
 * Decimals written with a point become Vietnamese decimals, as on the pages (user review 2026-10-30: the assistant
 * answered "2.45"): "GPA của bạn là 2.45" → "2,45". Addresses keep their dots, and so does a number after a technology
 * name or "phiên bản" (a version).
 */
export function decimalComma(text: string): string {
  return text.split(/(https?:\/\/\S+)/).map((part, index) => (index % 2 ? part : part.replace(POINT_DECIMAL,
    (match: string, whole: string, fraction: string, offset: number, all: string) => {
      const before = /(\S+)\s?$/.exec(all.slice(0, offset))?.[1] ?? "";
      const version = VERSION_WORDS.test(before) || (ASCII_WORD.test(before) && !SCORE_WORDS.test(before));
      return version ? match : `${whole},${fraction}`;
    }))).join("");
}

export function checkAnswer(raw: string, context: AnswerContext): CheckedAnswer {
  const warnings = new Set<string>();
  let text = raw.replace(/\r\n?/g, "\n").replace(/^#{1,6}\s+/gm, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // [tên](https://…) becomes "tên: https://…", so the address is checked like any other.
  text = text.replace(MARKDOWN_LINK, (_match, label: string, url: string) => `${label}: ${url}`);
  const allowed = new Set(context.allowedUrls.map(normalizeUrl));
  text = text.replace(URL_PATTERN, (match) => {
    const url = normalizeUrl(match);
    if (allowed.has(url)) return match;
    warnings.add("link_removed");
    return match.slice(url.length).replace(/^\/+/, "");
  });

  const cited = new Set<number>();
  text = text.replace(CITATION_PATTERN, (_match, list: string) => {
    const numbers = list.split(/[,;]/).map((item) => Number(item.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= context.sourceCount);
    if (numbers.length !== list.split(/[,;]/).length) warnings.add("citation_removed");
    for (const n of numbers) cited.add(n);
    return [...new Set(numbers)].map((n) => `[${n}]`).join("");
  });
  text = decimalComma(compactCitations(text));

  const known = new Set(context.knownCodes.map((code) => code.toUpperCase()));
  for (const code of text.match(CODE_PATTERN) ?? []) if (!known.has(code.toUpperCase())) warnings.add(`unknown_code:${code}`);

  text = text.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim();
  if (text.length > MAX_ANSWER_CHARS) { text = `${text.slice(0, MAX_ANSWER_CHARS - 1).trimEnd()}…`; warnings.add("answer_truncated"); }
  return { content: text, cited: [...cited].sort((a, b) => a - b), warnings: [...warnings].slice(0, 20) };
}

/** The https addresses and course codes in a block of prompt text: what an answer may link to and may name. */
export function addressesIn(text: string): string[] {
  return [...new Set((text.match(URL_PATTERN) ?? []).map(normalizeUrl).filter((url) => url.startsWith("https://")))];
}
export function codesIn(text: string): string[] {
  return [...new Set((text.match(CODE_PATTERN) ?? []).map((code) => code.toUpperCase()))];
}
