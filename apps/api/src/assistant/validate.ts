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
