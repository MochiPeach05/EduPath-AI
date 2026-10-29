// Scoring of one answer in the evaluation of Trợ lý AI (docs/assistant-evaluation.md, 2026-10-28): the expected facts
// (accent-insensitive whole words), the links and course codes the answer adds (the definitions of validate.ts), the
// citations the server keeps, a refusal of an out-of-scope question and an admission that the data has no answer.
import { checkAnswer, codesIn, normalizeUrl, type AnswerContext } from "../../src/assistant/validate.js";
import { fold } from "../../src/competency-assessment/specialty.js";
import type { EvalQuestion } from "./questions.js";

/** The answer folded for matching: no diacritics, lower case, markdown emphasis and code marks dropped. */
export const foldAnswer = (text: string) => fold(text.replace(/\*\*|__|`/g, " "));
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `phrase` in a folded text as whole words: no letter or digit right before or after it, and a number is not part of a
 * longer one ("72" is not in "72,37", "9" is not in "TC309").
 */
export function hasPhrase(folded: string, phrase: string): boolean {
  const needle = fold(phrase);
  if (!needle) return false;
  return new RegExp(`(?<![a-z0-9])(?<![0-9][.,])${escapeRegExp(needle)}(?![a-z0-9])(?![.,][0-9])`).test(folded);
}

/** Indexes of the expect groups with none of their alternatives in the answer. */
export function missingGroups(answer: string, expect: readonly (readonly string[])[]): number[] {
  const folded = foldAnswer(answer);
  return expect.flatMap((group, index) => (group.some((alternative) => hasPhrase(folded, alternative)) ? [] : [index]));
}

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/g;
/** Every http(s) address of a text, as validate.ts compares them. */
export const linksIn = (text: string) => [...new Set((text.match(URL_PATTERN) ?? []).map(normalizeUrl))];

/** A polite refusal or "the data has nothing on it" (system prompt rules 1 and 5). */
const REFUSAL = [
  "khong the", "chi ho tro", "chi co the", "chi tra loi", "chi giup", "ngoai pham vi", "khong lien quan", "khong thuoc", "khong nam trong",
  "chua co thong tin", "khong co thong tin", "khong co du lieu", "chua co du lieu", "xin loi", "rat tiec", "tiec la", "tu choi",
];
/** The answer says the data does not hold what was asked (what the no-context condition should say). */
const NO_DATA = [
  "chua co thong tin", "khong co thong tin", "khong co du lieu", "chua co du lieu", "khong tim thay", "chua co ket qua",
  "khong co trong du lieu", "khong co san", "chua duoc cung cap", "khong duoc cung cap", "khong biet",
];
const anyOf = (folded: string, phrases: readonly string[]) => phrases.some((phrase) => folded.includes(phrase));

export type AnswerScore = {
  /** Every expect group present; null when the question has none (out of scope). */
  correct: boolean | null;
  missing: number[];
  /** Out of scope: declined, with no link and nothing it must not say; null for other questions. */
  refused: boolean | null;
  /** Says the data has no answer. */
  noData: boolean;
  mustNotHits: string[];
  /** Links of the raw answer outside the prompt's resources (all of them without context), and those inside. */
  inventedLinks: string[];
  validLinks: string[];
  /** Course codes of the raw answer the prompt (data, question, history) does not hold. */
  unknownCodes: string[];
  /** Source numbers the server keeps, and whether it dropped a citation to a source the prompt does not have. */
  cited: number[];
  citationRemoved: boolean;
  /** Internal keys of the data the student sees in the checked answer: skill keys "[S01]", empty brackets "[]". */
  internalKeys: string[];
  warnings: string[];
  /** The text the student sees (validate.ts checkAnswer). */
  content: string;
  chars: number;
};

/**
 * Scores an answer. `scoreRaw`: match the expected facts on the raw answer (the no-context condition, which has no
 * server check) instead of the checked text the student sees.
 */
export function scoreAnswer(question: EvalQuestion, raw: string, context: AnswerContext, scoreRaw: boolean): AnswerScore {
  const checked = checkAnswer(raw, context);
  const scored = scoreRaw ? raw : checked.content;
  const folded = foldAnswer(scored);
  const allowed = new Set(context.allowedUrls.map(normalizeUrl));
  const links = linksIn(raw);
  const known = new Set(context.knownCodes.map((code) => code.toUpperCase()));
  const missing = missingGroups(scored, question.expect);
  const mustNotHits = question.mustNot.filter((phrase) => hasPhrase(folded, phrase) || folded.includes(fold(phrase)));
  const outOfScope = question.function === "out_of_scope";
  return {
    correct: question.expect.length ? missing.length === 0 : null,
    missing,
    refused: outOfScope ? anyOf(folded, REFUSAL) && links.length === 0 && mustNotHits.length === 0 : null,
    noData: anyOf(folded, NO_DATA),
    mustNotHits,
    inventedLinks: links.filter((url) => !allowed.has(url)),
    validLinks: links.filter((url) => allowed.has(url)),
    unknownCodes: codesIn(raw).filter((code) => !known.has(code)),
    cited: checked.cited,
    citationRemoved: checked.warnings.includes("citation_removed"),
    internalKeys: [...new Set(checked.content.match(/\[(?:S\d{1,3})?\]/g) ?? [])],
    warnings: checked.warnings,
    content: checked.content,
    chars: checked.content.length,
  };
}
