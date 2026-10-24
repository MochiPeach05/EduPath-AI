import { z } from "zod";

// "Lộ trình học tập", manual planning (user 2026-10-24, after Stellic's "Plan your path"): the courses a student places in
// each future term. No weekly timetable ("Bỏ Lịch trình học kỳ"): a plan stored by the first version (87f61ff) also
// held weekly sessions per course; they are dropped when it is read.

/** At most this many terms in a plan and courses in a term. */
export const MAX_TERMS = 15;
export const MAX_COURSES_PER_TERM = 40;

const termCode = z.string().regex(/^HK\d{2}[123]$/);

export const studyPlanSchema = z.object({
  schemaVersion: z.literal(1),
  /** The AI roadmap whose proposal the plan has taken in (prefill.ts readAiProposal); null or absent before any. */
  roadmapId: z.uuid().nullable().optional(),
  terms: z.array(z.object({
    code: termCode,
    // Unknown keys (the old "sessions") are stripped.
    courses: z.array(z.object({ code: z.string().trim().min(1).max(40) })).max(MAX_COURSES_PER_TERM),
  }).strict()).max(MAX_TERMS),
}).strict().superRefine((plan, context) => {
  const terms = plan.terms.map((term) => term.code);
  if (new Set(terms).size !== terms.length) context.addIssue({ code: "custom", message: "a term appears twice" });
  const codes = plan.terms.flatMap((term) => term.courses.map((course) => course.code.toUpperCase()));
  if (new Set(codes).size !== codes.length) context.addIssue({ code: "custom", message: "a course appears twice" });
});
export type StudyPlanData = z.infer<typeof studyPlanSchema>;
export const emptyStudyPlan = (): StudyPlanData => ({ schemaVersion: 1, terms: [] });

/** HKyyS → a number that orders terms: HK261 < HK262 < HK263 < HK271. */
export const termIndex = (code: string) => Number(code.slice(2, 4)) * 3 + Number(code.slice(4)) - 1;
export function nextTerm(code: string): string {
  const year = Number(code.slice(2, 4)), semester = Number(code.slice(4));
  return semester < 3 ? `HK${code.slice(2, 4)}${semester + 1}` : `HK${String((year + 1) % 100).padStart(2, "0")}1`;
}
/** "HK261" → "HK1 · 2026-2027". */
export function termLabel(code: string): string {
  const year = 2000 + Number(code.slice(2, 4));
  return `HK${code.slice(4)} · ${year}-${year + 1}`;
}

/**
 * The term running on a date, in Vietnam time: HK1 from September to January, HK2 from February to June, HK3 in
 * July and August (the school year starts in September).
 */
export function calendarTermCode(now: Date): string {
  const local = new Date(now.getTime() + 7 * 3600 * 1000);
  const month = local.getUTCMonth() + 1, year = local.getUTCFullYear();
  const start = month >= 9 ? year : year - 1;
  const semester = month >= 9 || month === 1 ? 1 : month <= 6 ? 2 : 3;
  return `HK${String(start % 100).padStart(2, "0")}${semester}`;
}

/**
 * Credits per term (STU-AI-04). Thông tư 08/2021/TT-BGDĐT lets each school set the limits within 2/3 and 3/2 of the
 * average term of the standard plan; the school's own figures are not in the system, so the band is used:
 * CTĐT credits / its terms (126 / 10 = 12,6 → 9 to 18 credits).
 */
export function creditLimits(totalCredits: number | null, standardTermCount: number): { average: number; min: number; max: number } | null {
  if (!totalCredits || standardTermCount < 1) return null;
  const average = totalCredits / standardTermCount;
  return { average: Math.round(average * 10) / 10, min: Math.ceil(average * 2 / 3 - 1e-9), max: Math.floor(average * 3 / 2 + 1e-9) };
}
