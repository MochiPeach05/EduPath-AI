// The time span of a study roadmap (user, 2026-10-24: "trong thời gian 3 tháng, bắt đầu từ ngày … đến ngày …").
// The exact dates will follow a schedule the user provides later; until then a roadmap starts on the day it is
// created (Vietnam time) and covers three calendar months. Change roadmapWindow only: everything else reads its result.

export const ROADMAP_MONTHS = 3;

/** Dates are "YYYY-MM-DD"; month i runs from its start to the day before month i+1 starts. */
export type RoadmapWindow = { start: string; end: string; months: { index: number; start: string; end: string }[] };

const iso = (date: Date) => date.toISOString().slice(0, 10);
/** The same day `months` later, clamped to the last day of a shorter month (31/01 + 1 → 28/02). */
function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), last)));
}
const dayBefore = (date: Date) => new Date(date.getTime() - 24 * 3600 * 1000);

export function roadmapWindow(now: Date): RoadmapWindow {
  const local = new Date(now.getTime() + 7 * 3600 * 1000);
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const months = Array.from({ length: ROADMAP_MONTHS }, (_, index) => ({
    index: index + 1, start: iso(addMonths(start, index)), end: iso(dayBefore(addMonths(start, index + 1))),
  }));
  return { start: iso(start), end: months.at(-1)!.end, months };
}

/** "2026-10-24" → "24/10/2026". */
export const dateText = (value: string) => value.split("-").reverse().join("/");
