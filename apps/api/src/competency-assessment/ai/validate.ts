// Server-side check of the AI commentary before it is stored (spec §10).
// Any problem returns a typed error. Since comp-v13 (user review 2026-10-30) a comment whose schema holds is not failed
// at once: the worker router asks the model once more with the problems listed (retryNote), and if some remain,
// repairAiOutput drops the sentences and items at fault (the job metrics count them). A wrong schema still fails the job
// with invalid_ai_output. comp-v14 (review 2026-11-04: "69" for 69,9): a number that lost its decimals is one more problem
// (truncated_number, truncatedNumber below; the roadmap and graduation advice validators use it too).
import { z } from "zod";
import { termName, termsNamedIn } from "../../term-name.js";
import { AI_OUTPUT_LIMITS as L, AI_PRIORITIES, schemaContext, type AiOutput, type OutputSchemaContext } from "./schema.js";

export type { AiOutput } from "./schema.js";

type AiValidationReason =
  | "schema"
  | "unknown_group_key"
  | "unknown_skill_key"
  | "unknown_gap_skill"
  | "foreign_course"
  | "conflicting_skill"
  | "forbidden_content"
  | "invented_number"
  | "truncated_number"
  | "term_not_in_plan"
  | "off_topic_skill";

type AiValidationError = { code: "invalid_ai_output"; reason: AiValidationReason; path: string };
/**
 * One problem of a comment; `term` is the term a term_not_in_plan text names, `number` the number a truncated_number text
 * writes and `given` the numbers of the data block it was cut from (comp-v14).
 */
export type AiProblem = { reason: AiValidationReason; path: string; term?: string; number?: string; given?: string[] };
type AiValidationResult =
  | { ok: true; output: AiOutput }
  /** problems and output: every problem of a comment whose schema held, for the retry and repairAiOutput. */
  | { ok: false; error: AiValidationError; problems?: AiProblem[]; output?: AiOutput };

/**
 * What a comp-v13 comment is checked against beyond the schema (prompt.ts commentChecks, kept in ai_input on the server):
 * the terms it may name, the name of every skill the data lists, and the course names that tie a strength, improvement or
 * gap item to its own skill.
 */
export type CommentChecks = {
  /** HKyyS: the term being studied, the next one and the later terms of the data block. */
  terms: string[];
  names: Record<string, string>;
  courses: Record<string, string[]>;
  /** comp-v14: the scores of the data block by skill, group and course name (truncatedNamedScore); absent before. */
  scores?: NamedScore[];
};

export type AiValidationContext = OutputSchemaContext & {
  /** Every numeric value that appears in the data block sent to the model. */
  numbers: ReadonlySet<number>;
  /** Every course-code-like token of the data block; free text may name only these. */
  courseCodes: ReadonlySet<string>;
  /** comp-v13; absent for a job queued before. */
  checks?: CommentChecks;
  /** The decimals and scores of the data block, for truncatedNumber (comp-v14); absent: no such check. */
  numberFacts?: NumberFacts;
};

const text = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0, "empty");
const priority = z.enum(AI_PRIORITIES);
const courseChoice = z.object({ courseCode: z.string().max(32), reason: text(L.courseReason) }).strict();

const aiOutputSchema = z.object({
  summary: text(L.summary),
  groupInsights: z.array(z.object({ groupKey: z.string().max(16), comment: text(L.groupComment) }).strict()).max(L.groupInsights),
  strengths: z.array(z.object({ skillKey: z.string().max(16), comment: text(L.skillComment) }).strict()).max(L.strengths),
  improvements: z.array(z.object({
    skillKey: z.string().max(16),
    priority,
    // comp-v4. Missing only from the output of a job queued before it (its schema has no courses): read as [].
    courses: z.array(courseChoice).max(L.improvementCourses).optional(),
    comment: text(L.skillComment)
  }).strict()).max(L.improvements),
  careerFit: z.object({ comment: text(L.careerFit) }).strict(),
  gaps: z.array(z.object({
    skillKey: z.string().max(16),
    priority,
    explanation: text(L.gapExplanation),
    courses: z.array(courseChoice).max(L.gapCourses),
    selfStudy: z.array(text(L.selfStudyItem)).max(L.selfStudy)
  }).strict()).max(L.gaps),
  progress: text(L.progress),
  nextSteps: z.array(text(L.nextStep)).min(L.nextStepsMin).max(L.nextStepsMax)
}).strict();

/* ------------------------------------------------------------------------ */

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;

/** Numeric tokens of a text ("72,5" and "72.5" both read as 72.5; "HK253" gives 253). */
export function numbersIn(value: string): number[] {
  return (value.match(NUMBER_PATTERN) ?? []).map((token) => Number(token.replace(",", ".")));
}

/**
 * The HKyyS codes of the terms the data block names ("HK3 2025–2026", or "học kỳ 3 năm học 2025–2026" before comp-v13,
 * → 253), so a model that still writes "HK253" for a term it was given is not rejected, while an invented term code still is.
 */
export function termCodeNumbers(value: string): number[] {
  return termsNamedIn(value.normalize("NFC")).map((code) => Number(code.slice(2)));
}

const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /\b(?:https?|ftp):\/\//i,
  /\bwww\./i,
  /\b[\p{L}\d-]+\.(?:com|vn|org|edu|gov|info)(?:\.[a-z]{2})?(?:\/|\b)/iu,
  /[\p{L}\d._%+-]+@[\p{L}\d-]+\.[\p{L}\d.-]+/u,
  /<\/?[a-z!][^>]*>/i,
  /&(?:[a-z]+|#\d+|#x[\da-f]+);/i,
  /<\||\|>/
];

/** Course-code-like tokens ("71ITSE30103", "71ENG010012"; also a mangled "ITSE30103"). */
const COURSE_CODE_PATTERN = /\b\d{0,2}[A-Z]{2,6}\d{4,6}\b/g;
export function courseCodesIn(value: string): string[] {
  return value.match(COURSE_CODE_PATTERN) ?? [];
}

export function hasForbiddenContent(value: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(value));
}

/* ------------------------------------------------------------------------ */
/* comp-v14: a number copied without its decimals */

/**
 * What a data block says about its numbers (comp-v14, review 2026-11-04: comments wrote "69" for 69,9 and "64" for 64,8): its
 * numbers with a decimal part as written ("69,9", "2,85"; score: written as a score), and every value it writes as a score.
 */
export type NumberFacts = {
  decimals: readonly { text: string; value: number; places: number; score: boolean }[];
  scores: ReadonlySet<number>;
};
type NumberToken = { text: string; value: number; places: number; score: boolean };

/** A number on its own, not inside a word or a code (HK1, S01, 71ITSE30103), with its decimal part. */
const NUMBER_TOKEN = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?![\p{L}\p{N}])/gu;
/** Terms ("HK2 2026–2027", "học kỳ 2 năm học 2026-2027") and dates (21/12/2026) hold no amount. */
const NOT_AN_AMOUNT = /(?<![\p{L}\p{N}])(?:(?:HK|học k[ỳì])\s*[1-3]\s*(?:[·,\-–]\s*)?(?:năm học\s*|năm\s*)?20\d{2}\s*[-–]\s*20\d{2}|\d{1,2}\/\d{1,2}\/\d{4})(?![\p{L}\p{N}])/giu;
/** After a number, what is counted: "3 TC", "8/10 môn", "9 kỹ năng", "46%". A count is never a score. */
const COUNT_UNIT = /^\s*(?:%|(?:tín chỉ|tc|môn|học phần|kỹ năng|mục|nhóm|lần|học kỳ|năm|tháng|tuần|ngày|giờ|dòng|bước|việc|dự án|sinh viên|nghề|vị trí)(?![\p{L}]))/iu;
/** After a number, a score: "69 điểm" (not "3 điểm mạnh"). */
const SCORE_AFTER = /^\s*điểm(?![\p{L}])(?!\s+(?:mạnh|yếu|cần|chú ý|lưu ý|nổi bật|chung|khác|quan trọng|đáng)(?![\p{L}]))/iu;
const SCORE_LABEL = String.raw`(?:tổng|phù hợp|kỹ năng|nhóm|năng lực|trung bình|tb|tích lũy|tích luỹ|học tập|hệ\s*\d+|số|hiện tại|hiện có|của bạn|chung|cao nhất|thấp nhất)`;
const SCORE_JOIN = String.raw`(?:là|đạt|chỉ|mới|còn|khoảng|ở mức|mức|đang|vẫn|được|bằng)`;
/** Before a number, a score: "điểm 69", "điểm tổng: 69", "điểm trung bình tích lũy là 2", "ngưỡng 80", "đạt 72", "thiếu 15". */
const SCORE_BEFORE = new RegExp(String.raw`(?<![\p{L}])(?:(?:điểm|ngưỡng)(?:\s+${SCORE_LABEL})*\s*:?(?:\s+${SCORE_JOIN})*|đạt|ở mức|mức|thiếu)\s*$`, "iu");
/** The scales a score is written over: "69,9/100", "8,5/10", "2,85/4". */
const SCORE_SCALES = new Set(["100", "10", "4"]);

/** Whether the number at index is written as a score: by a scale or "điểm" after it, or a score word before it; a count never is. */
function isScoreAt(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 80), index);
  // The scale of a score ("/100") or the total of a count ("/126") is no score itself.
  if (/\/\s*$/.test(before)) return false;
  let after = text.slice(index + length, index + length + 40);
  const scale = /^\s*\/\s*(\d+)(?![\p{N}])/u.exec(after);
  if (scale) {
    after = after.slice(scale[0].length);
    return SCORE_SCALES.has(scale[1]!) && !COUNT_UNIT.test(after);
  }
  if (COUNT_UNIT.test(after)) return false;
  return SCORE_AFTER.test(after) || SCORE_BEFORE.test(before);
}

/** The numbers of a text with their decimal places and whether each is written as a score; terms and dates left out. */
function numberTokens(raw: string): NumberToken[] {
  const text = raw.normalize("NFC").replace(NOT_AN_AMOUNT, (match) => " ".repeat(match.length));
  return [...text.matchAll(NUMBER_TOKEN)].map((match) => {
    const digits = match[0];
    const places = /[.,](\d+)$/.exec(digits)?.[1]?.length ?? 0;
    return { text: digits.replace(".", ","), value: Number(digits.replace(",", ".")), places, score: isScoreAt(text, match.index ?? 0, digits.length) };
  });
}

/** The decimals and the score values of a data block (the prompt's user message), for truncatedNumber. */
export function numberFactsOf(data: string): NumberFacts {
  const tokens = numberTokens(data);
  const decimals = new Map<string, NumberToken>();
  for (const token of tokens) {
    if (!token.places || Number.isInteger(token.value)) continue;
    const seen = decimals.get(token.text);
    decimals.set(token.text, { ...token, score: token.score || Boolean(seen?.score) });
  }
  return { decimals: [...decimals.values()], scores: new Set(tokens.filter((token) => token.score).map((token) => token.value)) };
}

/** A value cut to fewer decimal places, and rounded to them: 69,94 → 69 and 70 (no places), 2,85 → 2,8 and 2,9 (one). */
const cutTo = (value: number, places: number) => {
  const factor = 10 ** places;
  return [Math.trunc(value * factor + 1e-9) / factor, Math.round(value * factor) / factor];
};

/**
 * The first number of a text that is a number of the data block with its decimals dropped or rounded away, with the numbers
 * it was cut from (at most 3), or null (comp-v14). "69" when the data has 69,9 and no 69; "2,8" for 2,85. Also "69 điểm",
 * "điểm 69", "69/100" or "đạt 69" when the data has the score 69,9 and 69 only as something else (a count): written as a
 * score, it must be one of the data's scores. Terms, dates and the numbers inside codes are not amounts.
 */
export function truncatedNumber(text: string, numbers: ReadonlySet<number>, facts: NumberFacts): { number: string; given: string[] } | null {
  for (const token of numberTokens(text)) {
    const invented = !numbers.has(token.value);
    if (!invented && !(token.places === 0 && token.score && !facts.scores.has(token.value))) continue;
    // A number of the data written as a score is checked against the data's scores only.
    const pool = invented ? facts.decimals : facts.decimals.filter((item) => item.score);
    const given = pool.filter((item) => item.places > token.places && cutTo(item.value, token.places).some((value) => Math.abs(value - token.value) < 1e-9));
    if (given.length) return { number: token.text, given: given.slice(0, 3).map((item) => item.text) };
  }
  return null;
}

/**
 * A score of a data block and what it belongs to: a skill, group or course name, "điểm tổng", "điểm trung bình tích lũy"
 * (comp-v14). value is written as in the data block ("72,3"). Kept on the server with the job's input.
 */
export type NamedScore = { name: string; value: string };
/** Between a name and a number, words that make the number another quantity: a minimum, threshold, shortfall or change. */
const OTHER_QUANTITY = /(?<![\p{L}])(?:tối thiểu|yêu cầu|ngưỡng|từ|dưới|trên|hơn|cần|thiếu|còn|tăng|giảm|thêm|so với|mục tiêu|lên)(?![\p{L}])/iu;
/** Right before a number, a place in a sequence, not an amount: "học kỳ 2", "lần 2", "tháng 3". */
const POSITION_BEFORE = /(?<![\p{L}])(?:học k[ỳì]|kỳ|hk|năm|lần|tháng|tuần|bước|mục|phần|giai đoạn)\s*$/iu;
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const decimalPlaces = (text: string) => /[.,](\d+)$/.exec(text)?.[1]?.length ?? 0;

/** Stored named scores of a job (a list of { name, value } strings); [] for a job without them or a malformed value. */
export function namedScoresOf(value: unknown): NamedScore[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is NamedScore => typeof item === "object" && item !== null
    && typeof (item as NamedScore).name === "string" && typeof (item as NamedScore).value === "string");
}

/**
 * The first named score whose own number a text writes cut (comp-v14): a name of the list followed in its clause by its
 * value without the decimals, or rounded away, as the first number that is no count: "Lập trình cơ bản đạt 72" for 72,3
 * also when another skill scores 72, "Điểm tổng của bạn là 70" for 70,3. Longer names are read first ("Lập trình cơ bản"
 * is not also "Lập trình"); a minimum, threshold or shortfall between the name and the number ("cần tối thiểu 2") is left
 * alone. Returns like truncatedNumber.
 */
export function truncatedNamedScore(text: string, named: readonly NamedScore[]): { number: string; given: string[] } | null {
  const plain = text.normalize("NFC").replace(NOT_AN_AMOUNT, (match) => " ".repeat(match.length));
  const byName = new Map<string, { name: string; values: string[] }>();
  for (const item of named) {
    const name = item.name.normalize("NFC").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = name.toLocaleLowerCase("vi-VN");
    const entry = byName.get(key) ?? { name, values: [] };
    if (!entry.values.includes(item.value)) entry.values.push(item.value);
    byName.set(key, entry);
  }
  const taken = new Set<number>();
  const found: { start: number; end: number; values: string[] }[] = [];
  for (const entry of [...byName.values()].sort((a, b) => b.name.length - a.name.length)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${entry.name.split(" ").map(escapePattern).join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
    for (const match of plain.matchAll(pattern)) {
      const start = match.index ?? 0, end = start + match[0].length;
      let free = true;
      for (let at = start; at < end && free; at++) free = !taken.has(at);
      if (!free) continue;
      for (let at = start; at < end; at++) taken.add(at);
      found.push({ start, end, values: entry.values });
    }
  }
  found.sort((a, b) => a.start - b.start);
  for (const [index, item] of found.entries()) {
    const values = item.values.map((value) => ({ text: value, value: Number(value.replace(",", ".")), places: decimalPlaces(value) }))
      .filter((value) => Number.isFinite(value.value));
    if (!values.some((value) => value.places && !Number.isInteger(value.value))) continue;
    // The clause after the name, up to the next name: "." ends it unless a decimal digit follows.
    let window = plain.slice(item.end, Math.min(found[index + 1]?.start ?? plain.length, item.end + 80));
    const stop = window.search(/[;!?\n]|\.(?!\d)/);
    if (stop >= 0) window = window.slice(0, stop);
    for (const match of window.matchAll(NUMBER_TOKEN)) {
      const at = match.index ?? 0, digits = match[0];
      const before = window.slice(0, at);
      // A scale or total ("/100"), a place ("học kỳ 2") or a count, also of a ratio ("3 TC", "3/4 kỹ năng"), is no score.
      const counted = COUNT_UNIT.test(window.slice(at + digits.length).replace(/^\s*\/\s*\d+(?![\p{N}])/u, ""));
      if (/\/\s*$/.test(before) || POSITION_BEFORE.test(before) || counted) continue;
      if (OTHER_QUANTITY.test(before)) break;
      const token = { value: Number(digits.replace(",", ".")), places: decimalPlaces(digits) };
      if (values.some((value) => Math.abs(value.value - token.value) < 1e-9)) break;
      const given = values.filter((value) => value.places > token.places && cutTo(value.value, token.places).some((cut) => Math.abs(cut - token.value) < 1e-9));
      if (given.length) return { number: digits.replace(".", ","), given: given.map((value) => value.text) };
      break;
    }
  }
  return null;
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isRecordOf = <T>(value: unknown, check: (item: unknown) => item is T): value is Record<string, T> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(check);
/** The stored checks of a comp-v13 job; undefined for an older job or a malformed value. */
function checksOf(value: unknown): CommentChecks | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { terms, names, courses, scores } = value as Record<string, unknown>;
  if (!(isStrings(terms) && isRecordOf(names, (item): item is string => typeof item === "string") && isRecordOf(courses, isStrings))) return undefined;
  return scores === undefined ? { terms, names, courses } : { terms, names, courses, scores: namedScoresOf(scores) };
}

/** Allowlists for one job, read back from the stored ai_input; null when it is malformed. */
export function validationContextFromAiInput(input: { schema: unknown; user: unknown; checks?: unknown }): AiValidationContext | null {
  const context = schemaContext(input.schema);
  if (!context || typeof input.user !== "string") return null;
  const checks = checksOf(input.checks);
  return {
    ...context, numbers: new Set([...numbersIn(input.user), ...termCodeNumbers(input.user)]), courseCodes: new Set(courseCodesIn(input.user)),
    numberFacts: numberFactsOf(input.user), ...(checks ? { checks } : {})
  };
}

/* ------------------------------------------------------------------------ */
/* comp-v13: is a skill item about its own skill? */

/** Lower case, letters and digits only, padded with spaces so a phrase matches whole words: " lập trình web ". */
const fold = (value: string) => ` ${value.normalize("NFC").toLocaleLowerCase("vi-VN").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
const isPhrase = (form: string, min: number) => form.trim().length >= min;
const uniq = (values: readonly string[]) => [...new Set(values)];
/** The parts of a name: its whole, without the part in brackets, the part in brackets, and the halves of "HTML/CSS" or "A và B". */
function nameParts(name: string): { whole: string[]; halves: string[] } {
  const bare = name.replace(/\([^)]*\)/g, " ");
  const inner = (name.match(/\(([^)]*)\)/g) ?? []).map((part) => part.slice(1, -1));
  return { whole: [name, bare, ...inner], halves: bare.split(/[/,;&+]| và /) };
}
/** Ways a text names its own skill (lenient: any half will do). */
const ownForms = (name: string) => { const parts = nameParts(name); return uniq([...parts.whole, ...parts.halves].map(fold)).filter((form) => isPhrase(form, 2)); };
/** Ways a text names another skill: its whole name, or a one-word technical half such as "HTML" (a common word is no proof). */
const otherForms = (name: string) => {
  const parts = nameParts(name);
  return uniq([...parts.whole.map(fold), ...parts.halves.map(fold).filter((form) => /^ [a-z0-9]{3,} $/.test(form))]).filter((form) => isPhrase(form, 3));
};

/**
 * Whether a strength, improvement or gap text talks about another skill (comp-v13, user review 2026-10-30: "Làm việc
 * nhóm" talked about Accessibility, "Giao tiếp" about HTML/CSS): it names another listed skill and not its own. The
 * names inside its own courses do not count ("Đồ án Thiết kế web" may teach teamwork), and a text that names no skill
 * is fine: the page prints the skill as its title. Unknown keys are not checked.
 */
export function offTopic(value: string, key: string, checks: CommentChecks): boolean {
  const own = checks.names[key];
  if (!own) return false;
  const text = fold(value);
  const forms = ownForms(own);
  if (forms.some((form) => text.includes(form))) return false;
  const courses = (checks.courses[key] ?? []).map(fold).filter((form) => isPhrase(form, 3));
  let rest = text;
  for (const phrase of [...forms, ...courses]) for (let guard = 0; rest.includes(phrase) && guard < 20; guard++) rest = rest.replace(phrase, " ");
  return Object.entries(checks.names).some(([other, name]) => other !== key && otherForms(name).some((form) => rest.includes(form)));
}

const fail = (reason: AiValidationReason, path: string): AiValidationResult => ({ ok: false, error: { code: "invalid_ai_output", reason, path } });
/** The first entry of each key: a repeated group, skill or course is dropped, not a reason to reject the whole comment. */
const firstOf = <T>(items: readonly T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && Boolean(seen.add(key(item))));
};

/**
 * The first problem of one text: forbidden content, a term outside the plan (comp-v13), a number without its decimals
 * (comp-v14), an invented number or course code.
 */
function textProblem(value: string, context: AiValidationContext): Omit<AiProblem, "path"> | null {
  if (hasForbiddenContent(value)) return { reason: "forbidden_content" };
  const term = context.checks ? termsNamedIn(value).find((code) => !context.checks!.terms.includes(code)) : undefined;
  if (term) return { reason: "term_not_in_plan", term };
  const cut = (context.numberFacts ? truncatedNumber(value, context.numbers, context.numberFacts) : null)
    ?? (context.checks?.scores ? truncatedNamedScore(value, context.checks.scores) : null);
  if (cut) return { reason: "truncated_number", ...cut };
  if (numbersIn(value).some((number) => !context.numbers.has(number))) return { reason: "invented_number" };
  if (courseCodesIn(value).some((code) => !context.courseCodes.has(code))) return { reason: "foreign_course" };
  return null;
}

/** Every free text of a comment with its path. */
function textsOf(output: AiOutput): [string, string][] {
  return [
    ["summary", output.summary],
    ...output.groupInsights.map((item, i): [string, string] => [`groupInsights.${i}.comment`, item.comment]),
    ...output.strengths.map((item, i): [string, string] => [`strengths.${i}.comment`, item.comment]),
    ...output.improvements.flatMap((item, i): [string, string][] => [
      ...item.courses.map((course, j): [string, string] => [`improvements.${i}.courses.${j}.reason`, course.reason]),
      [`improvements.${i}.comment`, item.comment]
    ]),
    ["careerFit.comment", output.careerFit.comment],
    ...output.gaps.flatMap((gap, i): [string, string][] => [
      [`gaps.${i}.explanation`, gap.explanation],
      ...gap.courses.map((course, j): [string, string] => [`gaps.${i}.courses.${j}.reason`, course.reason]),
      ...gap.selfStudy.map((item, j): [string, string] => [`gaps.${i}.selfStudy.${j}`, item])
    ]),
    ["progress", output.progress],
    ...output.nextSteps.map((item, i): [string, string] => [`nextSteps.${i}`, item])
  ];
}

/** Every problem of a parsed comment, in the order the first one is reported: keys, courses, conflicts, topics, texts. */
function problemsOf(output: AiOutput, context: AiValidationContext): AiProblem[] {
  const problems: AiProblem[] = [];
  const add = (reason: AiValidationReason, path: string) => problems.push({ reason, path });
  const groups = new Set(context.groupKeys);
  const strengthKeys = new Set(context.strengthKeys);
  const improvementKeys = new Set(context.improvementKeys);
  const improvementCourses = new Map(context.improvementSkills.map((skill) => [skill.key, new Set(skill.courseCodes)]));
  const gapCourses = new Map(context.gapSkills.map((gap) => [gap.key, new Set(gap.courseCodes)]));

  for (const [index, item] of output.groupInsights.entries()) if (!groups.has(item.groupKey)) add("unknown_group_key", `groupInsights.${index}.groupKey`);
  for (const [index, item] of output.strengths.entries()) if (!strengthKeys.has(item.skillKey)) add("unknown_skill_key", `strengths.${index}.skillKey`);
  for (const [index, item] of output.improvements.entries()) {
    if (!improvementKeys.has(item.skillKey)) { add("unknown_skill_key", `improvements.${index}.skillKey`); continue; }
    // Only the courses listed for exactly this skill (its plan or career gap), like gaps.
    const allowed = improvementCourses.get(item.skillKey);
    for (const [courseIndex, course] of item.courses.entries()) {
      if (!allowed?.has(course.courseCode)) add("foreign_course", `improvements.${index}.courses.${courseIndex}.courseCode`);
    }
  }
  for (const [index, gap] of output.gaps.entries()) {
    const allowed = gapCourses.get(gap.skillKey);
    if (!allowed) { add("unknown_gap_skill", `gaps.${index}.skillKey`); continue; }
    for (const [courseIndex, course] of gap.courses.entries()) {
      if (!allowed.has(course.courseCode)) add("foreign_course", `gaps.${index}.courses.${courseIndex}.courseCode`);
    }
  }
  // A skill named as a strength must not also be one to improve or a gap.
  const weak = new Set([...output.improvements, ...output.gaps].map((item) => item.skillKey));
  for (const [index, item] of output.strengths.entries()) if (weak.has(item.skillKey)) add("conflicting_skill", `strengths.${index}.skillKey`);
  // comp-v13: the page prints the skill name as the title of the item, so the text must be about that skill.
  const checks = context.checks;
  if (checks) {
    for (const [index, item] of output.strengths.entries()) if (offTopic(item.comment, item.skillKey, checks)) add("off_topic_skill", `strengths.${index}.comment`);
    for (const [index, item] of output.improvements.entries()) if (offTopic(item.comment, item.skillKey, checks)) add("off_topic_skill", `improvements.${index}.comment`);
    for (const [index, gap] of output.gaps.entries()) if (offTopic(gap.explanation, gap.skillKey, checks)) add("off_topic_skill", `gaps.${index}.explanation`);
  }
  for (const [path, value] of textsOf(output)) {
    const problem = textProblem(value, context);
    if (problem) problems.push({ ...problem, path });
  }
  return problems;
}

export function validateAiOutput(raw: unknown, context: AiValidationContext): AiValidationResult {
  const parsed = aiOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("schema", issue ? issue.path.join(".") : "");
  }
  // comp-v7 (thinking mode): the model sometimes repeats an entry; the repeat is dropped (2026-10-18 trial).
  const output: AiOutput = {
    ...parsed.data,
    groupInsights: firstOf(parsed.data.groupInsights, (item) => item.groupKey),
    strengths: firstOf(parsed.data.strengths, (item) => item.skillKey),
    improvements: firstOf(parsed.data.improvements, (item) => item.skillKey)
      .map(({ skillKey, priority, courses, comment }) => ({ skillKey, priority, courses: firstOf(courses ?? [], (course) => course.courseCode), comment })),
    gaps: firstOf(parsed.data.gaps, (gap) => gap.skillKey).map((gap) => ({ ...gap, courses: firstOf(gap.courses, (course) => course.courseCode) }))
  };
  const problems = problemsOf(output, context);
  const first = problems[0];
  if (!first) return { ok: true, output };
  return { ok: false, error: { code: "invalid_ai_output", reason: first.reason, path: first.path }, problems, output };
}

/* ------------------------------------------------------------------------ */
/* comp-v13: what is left of a comment once the parts at fault are dropped */

/** The sentences of a text: a sentence ends with . ! ? or … before a space ("example.org" and "8.5" do not end one). */
const sentencesOf = (value: string) => value.split(/(?<=[.!?…])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
/** The text without its sentences at fault; "" when none is left. */
const cleanText = (value: string, context: AiValidationContext) => sentencesOf(value).filter((sentence) => !textProblem(sentence, context)).join(" ");

/**
 * The comment without what is wrong (comp-v13, after the one retry): items with an unknown key, a course of another
 * skill, a strength that is also weak and an item about another skill go; a text keeps its sentences without a problem
 * and an item whose text is left empty goes. null when summary, careerFit or progress is left empty, no next step is
 * left, or a problem remains.
 */
export function repairAiOutput(output: AiOutput, context: AiValidationContext): AiOutput | null {
  const groups = new Set(context.groupKeys);
  const strengthKeys = new Set(context.strengthKeys);
  const improvementCourses = new Map(context.improvementSkills.map((skill) => [skill.key, new Set(skill.courseCodes)]));
  const gapCourses = new Map(context.gapSkills.map((gap) => [gap.key, new Set(gap.courseCodes)]));
  const checks = context.checks;
  const onTopic = (text: string, key: string) => !checks || !offTopic(text, key, checks);
  const courses = (list: AiOutput["gaps"][number]["courses"], allowed: ReadonlySet<string> | undefined) => list
    .filter((course) => allowed?.has(course.courseCode))
    .map((course) => ({ ...course, reason: cleanText(course.reason, context) }))
    .filter((course) => course.reason);

  const improvements = output.improvements
    .filter((item) => improvementCourses.has(item.skillKey))
    .map((item) => ({ ...item, courses: courses(item.courses, improvementCourses.get(item.skillKey)), comment: cleanText(item.comment, context) }))
    .filter((item) => item.comment && onTopic(item.comment, item.skillKey));
  const gaps = output.gaps
    .filter((gap) => gapCourses.has(gap.skillKey))
    .map((gap) => ({
      ...gap, explanation: cleanText(gap.explanation, context), courses: courses(gap.courses, gapCourses.get(gap.skillKey)),
      selfStudy: gap.selfStudy.map((item) => cleanText(item, context)).filter(Boolean)
    }))
    .filter((gap) => gap.explanation && onTopic(gap.explanation, gap.skillKey));
  const weak = new Set([...improvements, ...gaps].map((item) => item.skillKey));
  const repaired: AiOutput = {
    summary: cleanText(output.summary, context),
    groupInsights: output.groupInsights.filter((item) => groups.has(item.groupKey))
      .map((item) => ({ ...item, comment: cleanText(item.comment, context) })).filter((item) => item.comment),
    strengths: output.strengths.filter((item) => strengthKeys.has(item.skillKey) && !weak.has(item.skillKey))
      .map((item) => ({ ...item, comment: cleanText(item.comment, context) })).filter((item) => item.comment && onTopic(item.comment, item.skillKey)),
    improvements,
    careerFit: { comment: cleanText(output.careerFit.comment, context) },
    gaps,
    progress: cleanText(output.progress, context),
    nextSteps: output.nextSteps.map((item) => cleanText(item, context)).filter(Boolean)
  };
  if (!repaired.summary || !repaired.careerFit.comment || !repaired.progress || !repaired.nextSteps.length) return null;
  return problemsOf(repaired, context).length ? null : repaired;
}

/** Where a problem is, in the words of the JSON the model wrote: "strengths, mục “Làm việc nhóm”", "nextSteps, việc thứ 2". */
function placeOf(path: string, output: AiOutput, names: Record<string, string>): string {
  const [field, index] = path.split(".");
  const at = Number(index);
  const item = (list: readonly { skillKey: string }[]) => `${field}, mục “${names[list[at]?.skillKey ?? ""] ?? list[at]?.skillKey ?? "?"}”`;
  switch (field) {
    case "strengths": return item(output.strengths);
    case "improvements": return item(output.improvements);
    case "gaps": return item(output.gaps);
    case "groupInsights": return `groupInsights, nhóm ${output.groupInsights[at]?.groupKey ?? "?"}`;
    case "nextSteps": return `nextSteps, việc thứ ${at + 1}`;
    default: return field ?? path;
  }
}

const PROBLEM_TEXT: Record<AiValidationReason, (problem: AiProblem) => string> = {
  schema: () => "sai cấu trúc JSON",
  unknown_group_key: () => "khóa nhóm không có trong dữ liệu",
  unknown_skill_key: () => "khóa kỹ năng không có trong danh sách được phép của mục này",
  unknown_gap_skill: () => "kỹ năng không có trong mục [5]",
  foreign_course: () => "có học phần hoặc mã học phần không thuộc danh sách của đúng kỹ năng đó; gọi học phần bằng tên và chỉ chọn trong danh sách của kỹ năng",
  conflicting_skill: () => "kỹ năng vừa là điểm mạnh vừa nằm ở improvements hoặc gaps; mỗi kỹ năng chỉ ở một mục",
  forbidden_content: () => "có đường link, email hoặc thẻ HTML; bỏ đi",
  invented_number: () => "có con số không có trong dữ liệu; chỉ chép số có sẵn",
  truncated_number: (problem) => `viết ${problem.number ?? "một con số"} trong khi dữ liệu ghi ${problem.given?.length ? problem.given.join(" hoặc ") : "số có phần thập phân"}; chép đúng từng chữ số, giữ nguyên phần thập phân, không làm tròn hay bỏ số lẻ`,
  term_not_in_plan: (problem) => `nhắc ${problem.term ? termName(problem.term) : "một học kỳ"}, học kỳ đã qua hoặc không có trong dữ liệu; chỉ nhắc học kỳ đang học và các học kỳ sau đó có trong dữ liệu`,
  off_topic_skill: () => "nội dung không nói về đúng kỹ năng của mục; nhắc tên kỹ năng hoặc học phần của chính kỹ năng đó và không mô tả kỹ năng khác"
};

/** The note added after the data block when the model is asked once more (comp-v13); at most 8 problems, each once. */
export function retryNote(problems: readonly AiProblem[], output: AiOutput, context: AiValidationContext): string {
  const names = context.checks?.names ?? {};
  const lines = uniq(problems.slice(0, 8).map((problem) => `- ${placeOf(problem.path, output, names)}: ${PROBLEM_TEXT[problem.reason](problem)}.`));
  return ["[BẢN TRƯỚC CHƯA ĐẠT] Bản nhận xét trước có các lỗi dưới đây. Hãy viết lại toàn bộ JSON theo đúng các nguyên tắc ở trên và sửa đúng những lỗi này:", ...lines].join("\n");
}
