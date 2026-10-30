// Server-side check of the AI commentary before it is stored (spec §10).
// Any problem returns a typed error. Since comp-v13 (user review 2026-10-30) a comment whose schema holds is not failed
// at once: the worker router asks the model once more with the problems listed (retryNote), and if some remain,
// repairAiOutput drops the sentences and items at fault (the job metrics count them). A wrong schema still fails the job
// with invalid_ai_output.
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
  | "term_not_in_plan"
  | "off_topic_skill";

type AiValidationError = { code: "invalid_ai_output"; reason: AiValidationReason; path: string };
/** One problem of a comment; `term` is the term a term_not_in_plan text names. */
export type AiProblem = { reason: AiValidationReason; path: string; term?: string };
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
};

export type AiValidationContext = OutputSchemaContext & {
  /** Every numeric value that appears in the data block sent to the model. */
  numbers: ReadonlySet<number>;
  /** Every course-code-like token of the data block; free text may name only these. */
  courseCodes: ReadonlySet<string>;
  /** comp-v13; absent for a job queued before. */
  checks?: CommentChecks;
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

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isRecordOf = <T>(value: unknown, check: (item: unknown) => item is T): value is Record<string, T> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(check);
/** The stored checks of a comp-v13 job; undefined for an older job or a malformed value. */
function checksOf(value: unknown): CommentChecks | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { terms, names, courses } = value as Record<string, unknown>;
  return isStrings(terms) && isRecordOf(names, (item): item is string => typeof item === "string") && isRecordOf(courses, isStrings)
    ? { terms, names, courses } : undefined;
}

/** Allowlists for one job, read back from the stored ai_input; null when it is malformed. */
export function validationContextFromAiInput(input: { schema: unknown; user: unknown; checks?: unknown }): AiValidationContext | null {
  const context = schemaContext(input.schema);
  if (!context || typeof input.user !== "string") return null;
  const checks = checksOf(input.checks);
  return {
    ...context, numbers: new Set([...numbersIn(input.user), ...termCodeNumbers(input.user)]), courseCodes: new Set(courseCodesIn(input.user)),
    ...(checks ? { checks } : {})
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

/** The first problem of one text: forbidden content, a term outside the plan (comp-v13), an invented number or course code. */
function textProblem(value: string, context: AiValidationContext): Omit<AiProblem, "path"> | null {
  if (hasForbiddenContent(value)) return { reason: "forbidden_content" };
  const term = context.checks ? termsNamedIn(value).find((code) => !context.checks!.terms.includes(code)) : undefined;
  if (term) return { reason: "term_not_in_plan", term };
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
  term_not_in_plan: (problem) => `nhắc ${problem.term ? termName(problem.term) : "một học kỳ"}, học kỳ đã qua hoặc không có trong dữ liệu; chỉ nhắc học kỳ đang học và các học kỳ sau đó có trong dữ liệu`,
  off_topic_skill: () => "nội dung không nói về đúng kỹ năng của mục; nhắc tên kỹ năng hoặc học phần của chính kỹ năng đó và không mô tả kỹ năng khác"
};

/** The note added after the data block when the model is asked once more (comp-v13); at most 8 problems, each once. */
export function retryNote(problems: readonly AiProblem[], output: AiOutput, context: AiValidationContext): string {
  const names = context.checks?.names ?? {};
  const lines = uniq(problems.slice(0, 8).map((problem) => `- ${placeOf(problem.path, output, names)}: ${PROBLEM_TEXT[problem.reason](problem)}.`));
  return ["[BẢN TRƯỚC CHƯA ĐẠT] Bản nhận xét trước có các lỗi dưới đây. Hãy viết lại toàn bộ JSON theo đúng các nguyên tắc ở trên và sửa đúng những lỗi này:", ...lines].join("\n");
}
