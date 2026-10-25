// The time span of a study roadmap. User, 2026-10-24: "trong thời gian 3 tháng, bắt đầu từ ngày … đến ngày …"; user,
// 2026-10-25: a roadmap prepares the next term of the school calendar instead ("HK1 giờ đang học dở rồi nên chúng ta sẽ
// đi đến HK2 luôn"), on the expected term dates below ("dự kiến chung chung sẽ là 20 tuần"). The window is the first
// term that has not started yet, split into months. Change this file only: everything else reads roadmapWindow's result.

/**
 * Expected term dates (user, 2026-10-25). A term the table does not list repeats its semester's dates in its own year
 * (HK272 = HK262 one year later).
 */
export const TERM_CALENDAR: readonly { term: string; start: string; end: string }[] = [
  { term: "HK262", start: "2026-12-21", end: "2027-04-04" },
  { term: "HK263", start: "2027-05-03", end: "2027-08-15" },
  { term: "HK271", start: "2027-09-05", end: "2028-01-22" },
];
/** A term no date is known for lasts this long (user: "dự kiến chung chung sẽ là 20 tuần"). */
export const DEFAULT_TERM_WEEKS = 20;
/** A last month shorter than this is merged into the month before it (HK3's 13 days in August). */
const MIN_LAST_MONTH_DAYS = 15;

/**
 * Dates are "YYYY-MM-DD"; month i runs from its start to the day before month i+1 starts, the last month to the end.
 * `term` is the term the window covers ("HK262"); roadmaps stored before 2026-10-25 covered 3 months from their day of
 * creation and have no term.
 */
export type RoadmapWindow = { start: string; end: string; months: { index: number; start: string; end: string }[]; term?: string };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const parse = (value: string) => new Date(`${value}T00:00:00Z`);
/** The same day `months` later, clamped to the last day of a shorter month (31/01 + 1 → 28/02). */
function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), last)));
}
const DAY = 24 * 3600 * 1000;
const dayBefore = (date: Date) => new Date(date.getTime() - DAY);

/** Today in Vietnam time, "YYYY-MM-DD". */
export function vietnamToday(now: Date): string {
  const local = new Date(now.getTime() + 7 * 3600 * 1000);
  return iso(new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())));
}

/** The calendar's terms shifted by whole years: HK262 + 1 → HK272 on the same days of the next year. */
function shifted(entry: (typeof TERM_CALENDAR)[number], years: number): { term: string; start: string; end: string } {
  const year = Number(entry.term.slice(2, 4)) + years;
  const move = (value: string) => { const date = parse(value); date.setUTCFullYear(date.getUTCFullYear() + years); return iso(date); };
  return { term: `HK${String(year).padStart(2, "0")}${entry.term.slice(4)}`, start: move(entry.start), end: move(entry.end) };
}

/** The first term starting today or later: the term a roadmap made today prepares. */
export function nextCalendarTerm(today: string): { term: string; start: string; end: string } {
  const terms = TERM_CALENDAR.flatMap((entry) => Array.from({ length: 12 }, (_, index) => shifted(entry, index - 1)));
  const next = terms.filter((term) => term.start >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (next) return next;
  const end = iso(new Date(parse(today).getTime() + (DEFAULT_TERM_WEEKS * 7 - 1) * DAY));
  return { term: "", start: today, end };
}

/** Calendar months from `start` to `end`; a last month shorter than MIN_LAST_MONTH_DAYS joins the month before. */
export function windowMonths(start: string, end: string): RoadmapWindow["months"] {
  const first = parse(start), last = parse(end);
  const months: RoadmapWindow["months"] = [];
  for (let index = 0; ; index++) {
    const from = addMonths(first, index);
    if (from > last) break;
    const to = dayBefore(addMonths(first, index + 1));
    months.push({ index: index + 1, start: iso(from), end: iso(to < last ? to : last) });
  }
  const tail = months.at(-1);
  if (months.length > 1 && tail && (parse(tail.end).getTime() - parse(tail.start).getTime()) / DAY + 1 < MIN_LAST_MONTH_DAYS) {
    months.pop();
    months[months.length - 1]!.end = tail.end;
  }
  return months;
}

export function roadmapWindow(now: Date): RoadmapWindow {
  const term = nextCalendarTerm(vietnamToday(now));
  return { start: term.start, end: term.end, months: windowMonths(term.start, term.end), ...(term.term ? { term: term.term } : {}) };
}

/** "2026-10-24" → "24/10/2026". */
export const dateText = (value: string) => value.split("-").reverse().join("/");
