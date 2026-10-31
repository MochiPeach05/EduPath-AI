// Server-side check of a study roadmap before it is stored. Strict on the shape: anything that is not
// { summary, study[{ code, advice }], improve[{ code, advice }], skills[{ key, why, steps, outcome }], months[{ month,
// focus, tasks }] } fails the job with invalid_ai_output. Lenient per item, as for the graduation advice: a text with
// forbidden content (link, email, HTML, special token), a section number of the data block, a number or a course code
// that is not in the data block, or an unknown skill key is dropped and the rest are kept; skill keys (S01…) and course
// codes written into prose become their names (the page shows names only). The job fails only when the summary is
// unusable or nothing at all remains.
// roadmap-v9 (user review 2026-10-30) also holds every sentence to the data: terms are written "HK2 2026–2027", a sentence
// naming a term the roadmap may not name (one already past, or outside the plan) or stating as fact what the student only
// said in the survey is dropped and reported as an issue; jobs.ts asks the model once more with the issues.
import { z } from "zod";
import { sanitizeText } from "../competency-assessment/ai/prompt.js";
import { cleanKeyText } from "../competency-assessment/ai/key-cleanup.js";
import { courseCodesIn, hasForbiddenContent, numbersIn, termCodeNumbers } from "../competency-assessment/ai/validate.js";
import { fold } from "../competency-assessment/specialty.js";
import { termName, termsNamedIn } from "../term-name.js";
import { INTERNSHIP_TOPIC, nameParts } from "./basis.js";
import { ROADMAP_LIMITS as L } from "./schema.js";

/** The cleaned roadmap stored in stu_roadmaps.ai_output (the router adds names and dates from the facts). */
export type RoadmapOutput = {
  summary: string;
  /** Key advice points (roadmap-v3); absent in a roadmap written before. */
  advice?: string[];
  study: { code: string; advice: string }[];
  improve: { code: string; advice: string }[];
  skills: { key: string; why: string; steps: string[]; outcome: string | null }[];
  months: { month: number; focus: string | null; tasks: string[] }[];
};

export type RoadmapContext = {
  courses: ReadonlySet<string>;
  improve: ReadonlySet<string>;
  /** Skill key (S01…) → name. */
  skills: ReadonlyMap<string, string>;
  /** Course code of the data block → name. */
  names: ReadonlyMap<string, string>;
  /** The thesis groups: the thesis course or both chuyên đề courses. */
  thesis: { thesis: string | null; topics: string[] }[];
  months: number;
  /** Every number of the data block, plus the HKyyS codes of the terms it writes in words. */
  numbers: ReadonlySet<number>;
  /** Every course-code-like token of the data block. */
  courseCodes: ReadonlySet<string>;
  /** roadmap-v9: the terms the text may name; null for an input made before, which is not held to the checks below. */
  terms: ReadonlySet<string> | null;
  /** Skills and technologies the system has no evidence for (or a weak one): stated as fact only with "bạn tự đánh giá…". */
  unproven: readonly string[];
  /** An internship course is passed, so "kinh nghiệm thực tập" is on record. */
  internshipDone: boolean;
  /** The roadmap's term, for the summary written when every sentence of the model's had to go. */
  windowTerm: string | null;
  /** roadmap-v11: the courses not passed (học lại), code → name; empty for an input made before. */
  retakes: ReadonlyMap<string, string>;
};

/**
 * issues: the sentences dropped for not holding to the data (roadmap-v9), what the model is told when asked again; also
 * on an empty result, which those drops can cause.
 */
type RoadmapValidation =
  | { ok: true; output: RoadmapOutput; dropped: number; issues: string[] }
  | { ok: false; reason: "schema" | "summary" | "empty"; path: string; issues?: string[] };

const raw = z.string().max(4000);
/** The shape only; lengths and counts are capped by the grammar and trimmed below. */
const roadmapOutputSchema = z.object({
  summary: raw,
  advice: z.array(raw).max(20).optional(),
  study: z.array(z.object({ code: z.string().max(64), advice: raw }).strict()).max(30),
  improve: z.array(z.object({ code: z.string().max(64), advice: raw }).strict()).max(30),
  skills: z.array(z.object({ key: z.string().max(16), why: raw, steps: z.array(raw).max(20), outcome: raw }).strict()).max(30),
  months: z.array(z.object({ month: z.string().max(4), focus: raw, tasks: z.array(raw).max(20) }).strict()).max(12),
}).strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const pairs = (value: unknown, key: "code" | "key"): [string, string][] | null => {
  if (!Array.isArray(value)) return null;
  const out: [string, string][] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry[key] !== "string" || !entry[key] || typeof entry.name !== "string") return null;
    out.push([entry[key] as string, entry.name]);
  }
  return out;
};

/** Allowlists read back from the stored ai_input; null when it is malformed. */
export function roadmapContextFromAiInput(input: unknown): RoadmapContext | null {
  if (!isRecord(input) || typeof input.user !== "string" || !isRecord(input.keys)) return null;
  const courses = pairs(input.keys.courses, "code");
  const improve = pairs(input.keys.improve, "code");
  const skills = pairs(input.keys.skills, "key");
  const months = input.keys.months;
  if (!courses || !improve || !skills || typeof months !== "number" || !Number.isInteger(months) || months < 1) return null;
  const names = input.keys.names === undefined ? [] : pairs(input.keys.names, "code");
  if (!names) return null;
  const thesis = Array.isArray(input.keys.thesis) ? input.keys.thesis.filter(isRecord).map((group) => ({
    thesis: typeof group.thesis === "string" ? group.thesis : null,
    topics: Array.isArray(group.topics) ? group.topics.filter((item): item is string => typeof item === "string") : [],
  })) : [];
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  const allNames = new Map([...courses, ...improve, ...names]);
  return {
    courses: new Set(courses.map(([code]) => code)),
    improve: new Set(improve.map(([code]) => code)),
    skills: new Map(skills),
    names: allNames,
    thesis,
    months,
    numbers: new Set([...numbersIn(input.user), ...termCodeNumbers(input.user)]),
    courseCodes: new Set(courseCodesIn(input.user)),
    terms: Array.isArray(input.keys.terms) ? new Set(strings(input.keys.terms)) : null,
    unproven: strings(input.keys.unproven),
    internshipDone: input.keys.internshipDone === true,
    windowTerm: typeof input.keys.windowTerm === "string" ? input.keys.windowTerm : null,
    retakes: new Map(strings(input.keys.retakes).map((code) => [code, allNames.get(code) ?? code])),
  };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Course codes of the data block written into prose become their names: "Đồ án Tốt nghiệp (71ITGR40206)" and
 * "DIT0070 Cơ sở dữ liệu" (the data block's own order) → the name alone, "(71ITGR40206, 6 TC)" after the name → "(6 TC)",
 * a bare code → the name. An unknown code is left for the check.
 */
export function cleanCourseCodes(text: string, names: ReadonlyMap<string, string>): string {
  let out = text;
  for (const code of new Set(courseCodesIn(out))) {
    const name = names.get(code)?.trim();
    if (!name) continue;
    const c = `(?<![\\p{L}\\p{N}])${escapeRegExp(code)}(?![\\p{L}\\p{N}])`;
    const n = `((?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}]))`;
    out = out.replace(new RegExp(`${n}\\s*[(\\[]\\s*${c}\\s*[)\\]]`, "giu"), "$1"); // Tên (MÃ)
    out = out.replace(new RegExp(`${n}\\s*[(\\[]\\s*${c}\\s*[,;]\\s*`, "giu"), "$1 ("); // Tên (MÃ, 6 TC)
    out = out.replace(new RegExp(`\\s*[,;]\\s*${c}\\s*(?=[)\\]])`, "gu"), ""); // (6 TC, MÃ)
    out = out.replace(new RegExp(`\\s*[(\\[]\\s*${c}\\s*[)\\]]`, "gu"), ""); // (MÃ) elsewhere
    out = out.replace(new RegExp(`${n}\\s*[-–—:]?\\s*${c}|${c}\\s*[-–—:]?\\s*${n}`, "giu"), (_m, a, b) => a ?? b); // Tên - MÃ, MÃ: Tên, MÃ Tên
    out = out.replace(new RegExp(c, "gu"), name);
  }
  return out.replace(/ {2,}/g, " ").replace(/\s+([.,;:!?)\]])/g, "$1").replace(/\(\s*\)/g, "").trim();
}

/* ------------------------------------------------------------- holding to the data (roadmap-v9) */

const SPELLED_TERM = /(?<![\p{L}\p{N}])(?:HK|học (?:kỳ|kì))\s*([1-3])\s*(?:[·,\-–]\s*)?(?:năm học\s*|năm\s*)?(20\d{2})\s*[-–]\s*(20\d{2})(?![\p{L}\p{N}])/giu;
const CODE_TERM = /(?<![\p{L}\p{N}])HK(\d{2})([1-3])(?![\p{L}\p{N}])/gu;
/** Every term the text names, written as on the pages: "HK262", "học kỳ 2 năm học 2026-2027" → "HK2 2026–2027". */
export function normalizeTermNames(text: string): string {
  return text
    .replace(SPELLED_TERM, (match, semester: string, start: string, end: string) => (Number(end) === Number(start) + 1 ? termName(`HK${start.slice(2)}${semester}`) : match))
    .replace(CODE_TERM, (_match, year: string, semester: string) => termName(`HK${year}${semester}`));
}

/** A sentence ends with . ! ? before the next one starts. */
const sentencesOf = (text: string) => text.split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"'“(])/u).map((part) => part.trim()).filter(Boolean);
/** Praise of what someone knows: "nền tảng vững chắc", "thành thạo", "giỏi", "thế mạnh"… */
const PRAISE = /(?<![\p{L}\p{N}])(?:nền tảng\s+(?:rất\s+)?(?:vững chắc|vững|tốt|chắc chắn|chắc|mạnh|ổn định)|vững chắc|vững vàng|thành thạo|nắm vững|nắm chắc|am hiểu|giỏi|thế mạnh|điểm mạnh|mạnh về|sở trường về)(?![\p{L}\p{N}])/iu;
/** Experience stated as had: "có kinh nghiệm", "đã thực tập", "đang thực tập", "từng dẫn dắt"… */
const EXPERIENCE = /(?<![\p{L}\p{N}])(?:(?:có|với|nhờ|sẵn có|sẵn)\s+(?:[\p{L}\p{N}]+\s+){0,2}?kinh nghiệm|(?:đã|đang|từng)\s+(?:từng\s+)?(?:đi thực tập|thực tập|làm thêm|dẫn dắt|làm trưởng nhóm|làm việc tại|làm việc ở|đi làm|tham gia dự án|làm dự án|làm \d+ dự án|có \d+ dự án))(?![\p{L}\p{N}])/iu;
/** Before the praise, a goal, advice or a negation: "để thành thạo", "hãy", "chưa có kinh nghiệm"… */
const NOT_A_CLAIM = /(?<![\p{L}\p{N}])(?:để|nhằm|giúp|hãy|nên|cần|sẽ|muốn|mục tiêu|hướng tới|trở thành|tích lũy|tích luỹ|bổ sung|chưa|không|thiếu|khi|nếu|có thể|nâng|lên mức|chứng minh|kiểm chứng)(?![\p{L}\p{N}])/iu;
/** Praise is about the student when someone has it ("bạn có", "với", "đã"…) or it is "của bạn": "Nắm vững Docker giúp…" is not. */
const HOLDER_BEFORE = /(?<![\p{L}\p{N}])(?:bạn|với|nhờ|có|sẵn|vốn|đã|đang|là)(?![\p{L}\p{N}])/iu;
const HOLDER_AFTER = /^[^,;:.]{0,48}?(?<![\p{L}\p{N}])của bạn(?![\p{L}\p{N}])/iu;
/** The sentence gives the claim as the student's own word. */
const ATTRIBUTED = /(?<![\p{L}\p{N}])(?:tự đánh giá|tự khai|tự nhận|tự mô tả|tự viết|theo khảo sát|trong khảo sát|khảo sát định hướng|bạn cho biết|bạn chia sẻ|bạn nói|theo bạn|bạn đã chọn|bạn liệt kê|bạn kể|bạn ghi)(?![\p{L}\p{N}])/iu;
const quoted = (sentence: string) => `"${sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence}"`;

/**
 * Why a sentence states as fact what only the student said, or null: in one of its clauses the student is said to have a
 * praise word with a skill or technology the system has no evidence for, or experience is stated as had (only a passed
 * internship course is on record), with no goal, advice or negation before it and nothing in the sentence giving it as
 * the student's word ("bạn tự đánh giá…", "bạn cho biết…").
 */
export function unattributedClaim(sentence: string, context: Pick<RoadmapContext, "unproven" | "internshipDone">): string | null {
  if (ATTRIBUTED.test(sentence)) return null;
  for (const clause of sentence.split(/[,;:]|\s(?:nhưng|tuy nhiên)\s/u)) {
    const asserted = (match: RegExpExecArray | null): match is RegExpExecArray => match !== null && !NOT_A_CLAIM.test(clause.slice(0, match.index));
    const folded = fold(clause);
    const names = (topic: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(fold(topic))}(?![\\p{L}\\p{N}+#])`, "u").test(folded);
    const praise = PRAISE.exec(clause);
    if (asserted(praise) && (HOLDER_BEFORE.test(clause.slice(0, praise.index)) || HOLDER_AFTER.test(clause.slice(praise.index)))) {
      const topic = context.unproven.find((name) => [name, ...nameParts(name)].some(names));
      if (topic) return topic;
    }
    const experience = EXPERIENCE.exec(clause);
    if (asserted(experience)) {
      const internship = names(INTERNSHIP_TOPIC);
      if (!(internship && context.internshipDone)) return internship ? INTERNSHIP_TOPIC : experience[0].trim();
    }
  }
  return null;
}

const IMPROVE_WORD = /(?<![\p{L}\p{N}])cai thien(?![\p{L}\p{N}])/u;
const RETAKE_WORD = /(?<![\p{L}\p{N}])hoc lai(?![\p{L}\p{N}])/u;
/**
 * The course not passed that a sentence calls "cải thiện" without saying "học lại", or null (roadmap-v11, user 2026-10-31:
 * "Hệ thống đang gọi môn bị rớt là 'môn cần cải thiện'"). `about` is the course the text is the advice of (an improve item),
 * whose sentences need not name it; any other sentence names the course by name or code.
 */
export function retakeCalledImprove(sentence: string, context: Pick<RoadmapContext, "retakes">, about: string | null = null): string | null {
  const folded = fold(sentence);
  if (!IMPROVE_WORD.test(folded) || RETAKE_WORD.test(folded)) return null;
  if (about && context.retakes.has(about)) return context.retakes.get(about)!;
  for (const [code, name] of context.retakes) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(fold(name))}(?![\\p{L}\\p{N}])`, "u").test(folded) || folded.includes(fold(code))) return name;
  }
  return null;
}

/** The text with every sentence that does not hold to the data dropped; each dropped sentence is reported in issues. */
function groundedText(text: string, context: RoadmapContext, claims: boolean, issues: string[], about: string | null = null): string {
  const kept: string[] = [];
  for (const sentence of sentencesOf(text)) {
    const outside = termsNamedIn(sentence).filter((code) => !context.terms!.has(code));
    if (outside.length) {
      issues.push(`Nhắc học kỳ không có trong danh sách được nhắc tới (đã qua hoặc ngoài kế hoạch): ${outside.map(termName).join(", ")}. Câu: ${quoted(sentence)}`);
      continue;
    }
    const topic = claims ? unattributedClaim(sentence, context) : null;
    if (topic) {
      issues.push(`Viết như sự thật điều bạn chỉ tự khai hoặc hệ thống chưa có minh chứng (${topic}); cần ghi rõ "bạn tự đánh giá…" hay "bạn cho biết…". Câu: ${quoted(sentence)}`);
      continue;
    }
    const retake = retakeCalledImprove(sentence, context, about);
    if (retake) {
      issues.push(`Gọi học phần chưa đạt ${retake} là "cải thiện"; học phần chưa đạt phải gọi là "học lại", chỉ học phần đã đạt (D, D+) mới là "học cải thiện". Câu: ${quoted(sentence)}`);
      continue;
    }
    kept.push(sentence);
  }
  return kept.join(" ");
}

/** The summary when every sentence of the model's had to go: plain, and true of any roadmap. */
export const fallbackSummary = (windowTerm: string | null) =>
  `Lộ trình ${windowTerm ? termName(windowTerm) : "học kỳ tới"} gồm các học phần cần học, học phần cần học lại hoặc học cải thiện và kỹ năng nên bổ sung bên dưới. Hãy trao đổi với cố vấn học tập trước khi đăng ký học phần.`;

/** Tokens that look like a skill key; one that is not a key of the job makes the text invalid. */
const KEY_TOKEN = /(?<![\p{L}\p{N}_])S\d{1,3}(?![\p{L}\p{N}_])/gu;
const SECTION_REFERENCE = /\[\s*\d{1,2}\s*\]|(?<![\p{L}\p{N}_])mục\s*\[?\s*\d/iu;

/**
 * One prose field as stored: sanitized, skill keys replaced by names, terms written one way and the sentences that do not
 * hold to the data dropped (roadmap-v9; claims: also the praise and experience check, for the fields that describe the
 * student rather than set a goal), length capped, or null when it must be dropped.
 */
function cleanText(value: string, max: number, context: RoadmapContext, issues: string[] = [], claims = false, about: string | null = null): string | null {
  // Special tokens, links and markup in the raw text already disqualify it (sanitizeText would hide them).
  if (hasForbiddenContent(value)) return null;
  // "mục [4]", "[6]": section numbers of the data block mean nothing to the student.
  if (SECTION_REFERENCE.test(value)) return null;
  const sanitized = sanitizeText(value, 4000);
  if ((sanitized.match(KEY_TOKEN) ?? []).some((token) => !context.skills.has(token))) return null;
  let text = sanitizeText(cleanCourseCodes(cleanKeyText(sanitized, context.skills), context.names), max * 2);
  if (context.terms) text = groundedText(normalizeTermNames(text), context, claims, issues, about);
  if (!text || hasForbiddenContent(text)) return null;
  if (numbersIn(text).some((number) => !context.numbers.has(number))) return null;
  if (courseCodesIn(text).some((code) => !context.courseCodes.has(code))) return null;
  return text;
}

/** Items whose id is allowed, the first of each id only, with their text cleaned; the rest are dropped. */
function cleanItems<T extends { code: string; advice: string }>(items: readonly T[], allowed: ReadonlySet<string>, max: number, context: RoadmapContext, issues: string[]) {
  const seen = new Set<string>();
  const out: { code: string; advice: string }[] = [];
  for (const item of items) {
    if (!allowed.has(item.code) || seen.has(item.code)) continue;
    // The advice of a course not passed must call it "học lại" (roadmap-v11).
    const advice = cleanText(item.advice, L.advice, context, issues, true, item.code);
    if (!advice) continue;
    seen.add(item.code);
    out.push({ code: item.code, advice });
  }
  return out.slice(0, max);
}

export function validateRoadmapOutput(output: unknown, context: RoadmapContext): RoadmapValidation {
  const parsed = roadmapOutputSchema.safeParse(output);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: "schema", path: issue ? issue.path.join(".") : "" };
  }
  const data = parsed.data;
  const issues: string[] = [];
  const summaryIssues: string[] = [];
  // A summary whose every sentence had to go is replaced by a plain one (the issues ask the model again first).
  const summary = cleanText(data.summary, L.summary, context, summaryIssues, true) ?? (summaryIssues.length ? fallbackSummary(context.windowTerm) : null);
  issues.push(...summaryIssues);
  if (!summary) return { ok: false, reason: "summary", path: "summary" };

  // The thesis group is done one way: the first way the model names wins, the courses of the other are dropped.
  const way = new Map<number, "thesis" | "topics">();
  const studyItems = data.study.filter((item) => {
    const index = context.thesis.findIndex((group) => group.thesis === item.code || group.topics.includes(item.code));
    if (index < 0) return true;
    const kind = context.thesis[index]!.thesis === item.code ? "thesis" : "topics";
    if (!way.has(index)) way.set(index, kind);
    return way.get(index) === kind;
  });
  const study = cleanItems(studyItems, context.courses, L.studyMax, context, issues);
  const advice = (data.advice ?? []).map((item) => cleanText(item, L.adviceItem, context, issues, true)).filter((item): item is string => Boolean(item)).slice(0, L.adviceMax);
  const improve = cleanItems(data.improve, context.improve, L.improveMax, context, issues);

  const skills: RoadmapOutput["skills"] = [];
  for (const item of data.skills) {
    if (!context.skills.has(item.key) || skills.some((skill) => skill.key === item.key)) continue;
    const why = cleanText(item.why, L.why, context, issues, true);
    // Steps and the outcome set goals ("thành thạo React sau học kỳ"): only their terms are checked.
    const steps = item.steps.map((step) => cleanText(step, L.step, context, issues)).filter((step): step is string => Boolean(step)).slice(0, L.stepsMax);
    if (!why || !steps.length) continue;
    skills.push({ key: item.key, why, steps, outcome: cleanText(item.outcome, L.outcome, context, issues) });
  }

  const months: RoadmapOutput["months"] = [];
  for (const item of data.months) {
    const month = Number(item.month);
    if (!Number.isInteger(month) || month < 1 || month > context.months || months.some((entry) => entry.month === month)) continue;
    const tasks = item.tasks.map((task) => cleanText(task, L.task, context, issues)).filter((task): task is string => Boolean(task)).slice(0, L.tasksMax);
    if (!tasks.length) continue;
    months.push({ month, focus: cleanText(item.focus, L.focus, context, issues), tasks });
  }
  months.sort((a, b) => a.month - b.month);

  const kept: RoadmapOutput = { summary, advice, study, improve, skills: skills.slice(0, L.skillsMax), months };
  if (!study.length && !improve.length && !kept.skills.length && !months.length) return { ok: false, reason: "empty", path: "", issues };
  const returned = data.study.length + data.improve.length + data.skills.length + data.months.length + (data.advice?.length ?? 0);
  return { ok: true, output: kept, dropped: returned - study.length - improve.length - kept.skills.length - months.length - advice.length, issues };
}
