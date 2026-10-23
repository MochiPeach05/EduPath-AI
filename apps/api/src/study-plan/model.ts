import { z } from "zod";

// "Lộ trình học tập" (STU-PLAN-01–07, user 2026-10-23): the courses a student places in each future term, and per
// course the weekly sessions placed on a day × block of 3 periods, like the school's timetable.

/** Thứ 2 … Thứ 7 are 2 … 7; Chủ nhật is 8. */
export const DAYS = [2, 3, 4, 5, 6, 7, 8] as const;
/** Blocks of 3 periods from the school's period times; the evening block keeps periods 13–15 (user, 2026-10-23). */
export const BLOCKS = [
  { block: 1, periods: "1–3", time: "07:00–09:25" },
  { block: 2, periods: "4–6", time: "09:35–12:00" },
  { block: 3, periods: "7–9", time: "13:00–15:25" },
  { block: 4, periods: "10–12", time: "15:35–18:00" },
  { block: 5, periods: "13–15", time: "18:05–20:20" },
] as const;
/** LT: lecture session, TH: practice session. */
export const SESSION_KINDS = ["LT", "TH"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
/** At most this many terms in a plan, courses in a term and weekly sessions of a course. */
export const MAX_TERMS = 15;
export const MAX_COURSES_PER_TERM = 40;
export const MAX_SESSIONS = 6;

const termCode = z.string().regex(/^HK\d{2}[123]$/);
const session = z.object({
  kind: z.enum(SESSION_KINDS),
  day: z.number().int().min(2).max(8).nullable(),
  block: z.number().int().min(1).max(BLOCKS.length).nullable(),
}).strict().refine((value) => (value.day === null) === (value.block === null), { message: "day and block go together" });

export const studyPlanSchema = z.object({
  schemaVersion: z.literal(1),
  terms: z.array(z.object({
    code: termCode,
    courses: z.array(z.object({ code: z.string().trim().min(1).max(40), sessions: z.array(session).max(MAX_SESSIONS) }).strict()).max(MAX_COURSES_PER_TERM),
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
export function currentTermCode(now: Date): string {
  const local = new Date(now.getTime() + 7 * 3600 * 1000);
  const month = local.getUTCMonth() + 1, year = local.getUTCFullYear();
  const start = month >= 9 ? year : year - 1;
  const semester = month >= 9 || month === 1 ? 1 : month <= 6 ? 2 : 3;
  return `HK${String(start % 100).padStart(2, "0")}${semester}`;
}

/** Weekly sessions a course starts with: LT when it has lecture periods, TH when it has practice periods. */
export function sessionKinds(hours: { lecture: number | null; practice: number | null; project: number | null; internship: number | null } | null | undefined): SessionKind[] {
  const kinds: SessionKind[] = [];
  if ((hours?.lecture ?? 0) > 0) kinds.push("LT");
  if ((hours?.practice ?? 0) > 0) kinds.push("TH");
  // A project or an internship (thesis, Thực tập) has no weekly class; a course without hours gets one session.
  if (!kinds.length && !((hours?.project ?? 0) > 0) && !((hours?.internship ?? 0) > 0)) kinds.push("LT");
  return kinds;
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
