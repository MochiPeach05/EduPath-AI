// Server-side check of a study roadmap before it is stored. Strict on the shape: anything that is not
// { summary, study[{ code, advice }], improve[{ code, advice }], skills[{ key, why, steps, outcome }], months[{ month,
// focus, tasks }] } fails the job with invalid_ai_output. Lenient per item, as for the graduation advice: a text with
// forbidden content (link, email, HTML, special token), a section number of the data block, a number or a course code
// that is not in the data block, or an unknown skill key is dropped and the rest are kept; skill keys (S01…) and course
// codes written into prose become their names (the page shows names only). The job fails only when the summary is
// unusable or nothing at all remains.
import { z } from "zod";
import { sanitizeText } from "../competency-assessment/ai/prompt.js";
import { cleanKeyText } from "../competency-assessment/ai/key-cleanup.js";
import { courseCodesIn, hasForbiddenContent, numbersIn, termCodeNumbers } from "../competency-assessment/ai/validate.js";
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
};

type RoadmapValidation =
  | { ok: true; output: RoadmapOutput; dropped: number }
  | { ok: false; reason: "schema" | "summary" | "empty"; path: string };

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
  return {
    courses: new Set(courses.map(([code]) => code)),
    improve: new Set(improve.map(([code]) => code)),
    skills: new Map(skills),
    names: new Map([...courses, ...improve, ...names]),
    thesis,
    months,
    numbers: new Set([...numbersIn(input.user), ...termCodeNumbers(input.user)]),
    courseCodes: new Set(courseCodesIn(input.user)),
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

/** Tokens that look like a skill key; one that is not a key of the job makes the text invalid. */
const KEY_TOKEN = /(?<![\p{L}\p{N}_])S\d{1,3}(?![\p{L}\p{N}_])/gu;
const SECTION_REFERENCE = /\[\s*\d{1,2}\s*\]|(?<![\p{L}\p{N}_])mục\s*\[?\s*\d/iu;

/** One prose field as stored: sanitized, skill keys replaced by names, length capped, or null when it must be dropped. */
function cleanText(value: string, max: number, context: RoadmapContext): string | null {
  // Special tokens, links and markup in the raw text already disqualify it (sanitizeText would hide them).
  if (hasForbiddenContent(value)) return null;
  // "mục [4]", "[6]": section numbers of the data block mean nothing to the student.
  if (SECTION_REFERENCE.test(value)) return null;
  const sanitized = sanitizeText(value, 4000);
  if ((sanitized.match(KEY_TOKEN) ?? []).some((token) => !context.skills.has(token))) return null;
  const text = sanitizeText(cleanCourseCodes(cleanKeyText(sanitized, context.skills), context.names), max * 2);
  if (!text || hasForbiddenContent(text)) return null;
  if (numbersIn(text).some((number) => !context.numbers.has(number))) return null;
  if (courseCodesIn(text).some((code) => !context.courseCodes.has(code))) return null;
  return text;
}

/** Items whose id is allowed, the first of each id only, with their text cleaned; the rest are dropped. */
function cleanItems<T extends { code: string; advice: string }>(items: readonly T[], allowed: ReadonlySet<string>, max: number, context: RoadmapContext) {
  const seen = new Set<string>();
  const out: { code: string; advice: string }[] = [];
  for (const item of items) {
    if (!allowed.has(item.code) || seen.has(item.code)) continue;
    const advice = cleanText(item.advice, L.advice, context);
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
  const summary = cleanText(data.summary, L.summary, context);
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
  const study = cleanItems(studyItems, context.courses, L.studyMax, context);
  const advice = (data.advice ?? []).map((item) => cleanText(item, L.adviceItem, context)).filter((item): item is string => Boolean(item)).slice(0, L.adviceMax);
  const improve = cleanItems(data.improve, context.improve, L.improveMax, context);

  const skills: RoadmapOutput["skills"] = [];
  for (const item of data.skills) {
    if (!context.skills.has(item.key) || skills.some((skill) => skill.key === item.key)) continue;
    const why = cleanText(item.why, L.why, context);
    const steps = item.steps.map((step) => cleanText(step, L.step, context)).filter((step): step is string => Boolean(step)).slice(0, L.stepsMax);
    if (!why || !steps.length) continue;
    skills.push({ key: item.key, why, steps, outcome: cleanText(item.outcome, L.outcome, context) });
  }

  const months: RoadmapOutput["months"] = [];
  for (const item of data.months) {
    const month = Number(item.month);
    if (!Number.isInteger(month) || month < 1 || month > context.months || months.some((entry) => entry.month === month)) continue;
    const tasks = item.tasks.map((task) => cleanText(task, L.task, context)).filter((task): task is string => Boolean(task)).slice(0, L.tasksMax);
    if (!tasks.length) continue;
    months.push({ month, focus: cleanText(item.focus, L.focus, context), tasks });
  }
  months.sort((a, b) => a.month - b.month);

  const kept: RoadmapOutput = { summary, advice, study, improve, skills: skills.slice(0, L.skillsMax), months };
  if (!study.length && !improve.length && !kept.skills.length && !months.length) return { ok: false, reason: "empty", path: "" };
  const returned = data.study.length + data.improve.length + data.skills.length + data.months.length + (data.advice?.length ?? 0);
  return { ok: true, output: kept, dropped: returned - study.length - improve.length - kept.skills.length - months.length - advice.length };
}
