// Báo cáo của cổng quản trị: every report as a pure function of the student rows (rows.ts) and the filters. Each
// aggregate comes for the whole scope and for each cohort ("mọi phần đều có xem trung bình toàn khóa với từng khóa",
// user 2026-10-31). Means skip missing values and keep full precision (the pages floor 0–100 scores to the tenth); the
// level and fit words are the student pages' (Xuất sắc/Giỏi/Khá/Trung bình/Yếu at 90/80/62,5/50; Rất phù hợp/Phù hợp/
// Trung bình/Ít phù hợp/Không phù hợp on the same bounds).
import { FIT_LABELS, LEVEL_THRESHOLDS, fitCodeOf } from "../../competency-assessment/constants.js";
import { fold, SPECIALTIES } from "../../competency-assessment/specialty.js";
import { MAJORS } from "../../curricula/majors.js";
import { TERM_CALENDAR, vietnamToday } from "../../roadmap/window.js";
import { termName } from "../../term-name.js";
import type { ReportRow } from "./rows.js";
import type {
  AverageRow, AverageTable, CareerRow, CareersReport, CohortSplit, CompetencyGroups, CourseHow, CourseRow, CoursesReport, CourseStudents,
  DashboardKpis, DashboardReport, FitSummary, GpaBandLabel, GpaBands, GpaPoint, ProgressCounts, ProgressReport, ProgressStatus,
  ProgressStudent, ReportHead, ReportOptions, ReportPage, ReportScope, ReportStudentBase, ReportTerm, RiskKind,
  RiskReport, RiskStudent, SkillAverage, SkillGapRow, SkillGapStatus, SkillsReport, SkillStudents,
} from "./types.js";

/** The filter bar as parsed (the contract's ReportFilters, where an absent value may be undefined). */
export type Filters = { cohort?: string | undefined; major?: string | undefined; specialty?: string | undefined; q?: string | undefined };
type Dir = "asc" | "desc";

/* ------------------------------------------------------------------------ */
/* Words, numbers, terms */

export const LEVEL_WORDS = ["Xuất sắc", "Giỏi", "Khá", "Trung bình", "Yếu"] as const;
export const FIT_WORDS = ["Rất phù hợp", "Phù hợp", "Trung bình", "Ít phù hợp", "Không phù hợp"] as const;

/** The level word of a 0–100 score, on the bounds of the competency levels. */
export function levelWord(score: number | null): string | null {
  if (score === null) return null;
  const t = LEVEL_THRESHOLDS, reaches = (bound: number) => score + 1e-9 >= bound;
  return reaches(t.excellent) ? "Xuất sắc" : reaches(t.proficient) ? "Giỏi" : reaches(t.good) ? "Khá" : reaches(t.basic) ? "Trung bình" : "Yếu";
}
/** The fit word of a mean fit score (the engine's fitCodeOf with every skill counted). */
export const fitWord = (score: number | null): string | null => (score === null ? null : FIT_LABELS[fitCodeOf(score, 1)]);

export const mean = (values: readonly (number | null | undefined)[]): number | null => {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
};
const termRef = (code: string): ReportTerm => ({ code, label: termName(code) });

const GPA_BANDS: readonly { label: GpaBandLabel; min: number; range: string }[] = [
  { label: "Xuất sắc", min: 3.6, range: "từ 3,60" },
  { label: "Giỏi", min: 3.2, range: "3,20–3,59" },
  { label: "Khá", min: 2.5, range: "2,50–3,19" },
  { label: "Trung bình", min: 2.0, range: "2,00–2,49" },
  { label: "Yếu", min: Number.NEGATIVE_INFINITY, range: "dưới 2,00" },
];
/** Học lực by the printed cumulative GPA. */
export const gpaBandOf = (gpa: number): GpaBandLabel => GPA_BANDS.find((band) => gpa + 1e-9 >= band.min)!.label;

/** The term of the school calendar under way on the Vietnam date (the calendar's years shifted), else the next one. */
export function calendarTerm(now: Date): ReportTerm | null {
  const today = vietnamToday(now);
  const terms = TERM_CALENDAR.flatMap((entry) => Array.from({ length: 12 }, (_, index) => {
    const years = index - 2;
    const move = (value: string) => `${Number(value.slice(0, 4)) + years}${value.slice(4)}`;
    return { term: `HK${String(Number(entry.term.slice(2, 4)) + years).padStart(2, "0")}${entry.term.slice(4)}`, start: move(entry.start), end: move(entry.end) };
  })).sort((a, b) => a.start.localeCompare(b.start));
  const started = terms.filter((term) => term.start <= today);
  const current = started.at(-1) ?? terms[0];
  return current ? termRef(current.term) : null;
}

/* ------------------------------------------------------------------------ */
/* Scope */

/** Cohorts oldest first: K26 before K29 before K100; anything else after, alphabetically. */
export function compareCohorts(a: string, b: string): number {
  const na = /^K(\d+)$/.exec(a)?.[1], nb = /^K(\d+)$/.exec(b)?.[1];
  if (na && nb) return Number(na) - Number(nb);
  if (na) return -1;
  if (nb) return 1;
  return a.localeCompare(b, "vi");
}

/** The rows of the filter bar: cohort, major, specialty, and MSSV or name (accents ignored). */
export function filterRows(rows: readonly ReportRow[], filters: Filters): ReportRow[] {
  const q = filters.q ? fold(filters.q) : "";
  return rows.filter((row) => (!filters.cohort || row.cohort === filters.cohort)
    && (!filters.major || row.majorCode === filters.major)
    && (!filters.specialty || row.specialtyCode === filters.specialty)
    && (!q || fold(`${row.studentCode ?? ""} ${row.name}`).includes(q)));
}

/** One aggregate for all rows and for each cohort present (students without a cohort count in `all` only). */
export function cohortSplit<T extends object>(rows: readonly ReportRow[], build: (rows: readonly ReportRow[], cohort: string | null) => T): CohortSplit<T> {
  const cohorts = [...new Set(rows.map((row) => row.cohort).filter((cohort): cohort is string => cohort !== null))].sort(compareCohorts);
  return { all: build(rows, null), byCohort: cohorts.map((cohort) => ({ cohort, ...build(rows.filter((row) => row.cohort === cohort), cohort) })) };
}

export const scopeOf = (rows: readonly ReportRow[]): ReportScope => ({
  students: rows.length,
  withTranscript: rows.filter((row) => row.hasTranscript).length,
  assessed: rows.filter((row) => row.competency !== null).length,
});

export const headOf = (rows: readonly ReportRow[], generatedAt: string, now: Date): ReportHead => ({ generatedAt, studyTerm: calendarTerm(now), scope: scopeOf(rows) });

const baseOf = (row: ReportRow): ReportStudentBase => ({
  userId: row.userId, studentCode: row.studentCode, name: row.name, cohort: row.cohort, majorName: row.majorName, specialtyName: row.specialtyName,
});

/** Vietnamese names sort by the given name (the last word), then the full name, then the MSSV, as the admin lists do. */
export function compareNames(a: Pick<ReportRow, "name" | "studentCode">, b: Pick<ReportRow, "name" | "studentCode">): number {
  const given = (name: string) => fold(name.trim().split(/\s+/).at(-1) ?? "");
  return given(a.name).localeCompare(given(b.name), "vi") || fold(a.name).localeCompare(fold(b.name), "vi")
    || (a.studentCode ?? "").localeCompare(b.studentCode ?? "");
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): ReportPage<T> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

/** Sorts by one key, nulls last whatever the direction, then by name. */
function sortBy<T extends Pick<ReportRow, "name" | "studentCode">>(items: readonly T[], value: (item: T) => string | number | null, dir: Dir): T[] {
  return [...items].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    const order = va === null || vb === null || va === vb ? 0 : typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "vi");
    return (dir === "asc" ? order : -order) || compareNames(a, b);
  });
}

/* ------------------------------------------------------------------------ */
/* AD-REPORT-01 Tổng quan */

/** Each student's latest printed cumulative GPA up to `term` (null before the student's first term with one). */
function cumulativeAt(row: ReportRow, term: string): number | null {
  let value: number | null = null;
  for (const point of row.series) if (point.term <= term && point.cumulativeGpa !== null) value = point.cumulativeGpa;
  return value;
}

export function gpaPoints(rows: readonly ReportRow[]): GpaPoint[] {
  const withT = rows.filter((row) => row.hasTranscript);
  const terms = [...new Set(withT.flatMap((row) => row.series.map((point) => point.term)))].sort();
  return terms.flatMap((term) => {
    const termValues = withT.flatMap((row) => row.series.filter((point) => point.term === term && point.termGpa !== null).map((point) => point.termGpa!));
    const point = { term: termRef(term), termGpa: mean(termValues), termStudents: termValues.length, cumulativeGpa: mean(withT.map((row) => cumulativeAt(row, term))) };
    return point.termGpa === null && point.cumulativeGpa === null ? [] : [point];
  });
}

export function kpisOf(rows: readonly ReportRow[]): DashboardKpis {
  const withT = rows.filter((row) => row.hasTranscript);
  const assessed = rows.filter((row) => row.competency !== null);
  const points = gpaPoints(rows).filter((point) => point.cumulativeGpa !== null);
  const last = points.at(-1), previous = points.at(-2);
  const competency = mean(assessed.map((row) => row.competency!.overall));
  const fit = mean(assessed.map((row) => row.competency!.career?.fitScore ?? null));
  return {
    ...scopeOf(rows),
    gpa: mean(withT.map((row) => row.gpa)),
    gpaChange: last && previous ? last.cumulativeGpa! - previous.cumulativeGpa! : null,
    gpaChangeFrom: last && previous ? previous.term : null,
    competency, competencyLevel: levelWord(competency),
    fit, fitLabel: fitWord(fit),
    risk: rows.filter((row) => row.risk.level === "risk").length,
    warn: rows.filter((row) => row.risk.level === "warn").length,
  };
}

export function gpaBandsOf(rows: readonly ReportRow[]): GpaBands {
  const gpas = rows.filter((row) => row.hasTranscript && row.gpa !== null).map((row) => row.gpa!);
  return { bands: GPA_BANDS.map((band) => ({ label: band.label, range: band.range, students: gpas.filter((gpa) => gpaBandOf(gpa) === band.label).length })) };
}

function averageRow(key: string, label: string, rows: readonly ReportRow[]): AverageRow {
  const withT = rows.filter((row) => row.hasTranscript);
  const assessed = withT.filter((row) => row.competency !== null);
  const competency = mean(assessed.map((row) => row.competency!.overall));
  const fit = mean(assessed.map((row) => row.competency!.career?.fitScore ?? null));
  return {
    key, label, students: withT.length,
    gpa: mean(withT.map((row) => row.gpa)), lastTermGpa: mean(withT.map((row) => row.lastTermGpa)), credits: mean(withT.map((row) => row.passedCredits)),
    below2: withT.filter((row) => row.gpa !== null && row.gpa < 2).length,
    competency, competencyLevel: levelWord(competency), fit, fitLabel: fitWord(fit),
  };
}

/** The table "Bảng điểm trung bình" by cohort, major and specialty, each with its total row; groups without a transcript are left out. */
export function averageTables(rows: readonly ReportRow[]): AverageTable[] {
  const table = (by: AverageTable["by"], keyOf: (row: ReportRow) => string, labelOf: (key: string) => string, order: (a: string, b: string) => number): AverageTable => {
    const keys = [...new Set(rows.filter((row) => row.hasTranscript).map(keyOf))].sort(order);
    return { by, rows: keys.map((key) => averageRow(key, labelOf(key), rows.filter((row) => keyOf(row) === key))), all: averageRow("all", "Tất cả", rows) };
  };
  const NONE = "none";
  const majorLabel = (code: string) => MAJORS.find((major) => major.code === code)?.label ?? (code === NONE ? "Chưa rõ ngành" : `Mã ngành ${code}`);
  const specialtyName = (code: string) => SPECIALTIES.find((item) => item.code === code)?.label ?? "Chưa chọn chuyên ngành";
  const specialtyOrder = (a: string, b: string) => (a === NONE ? 1 : b === NONE ? -1 : SPECIALTIES.findIndex((item) => item.code === a) - SPECIALTIES.findIndex((item) => item.code === b));
  return [
    table("cohort", (row) => row.cohort ?? NONE, (key) => (key === NONE ? "Chưa rõ khóa" : key), (a, b) => (a === NONE ? 1 : b === NONE ? -1 : compareCohorts(a, b))),
    table("major", (row) => row.majorCode ?? NONE, majorLabel, (a, b) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b))),
    table("specialty", (row) => row.specialtyCode ?? NONE, specialtyName, specialtyOrder),
  ];
}

export function competencyGroupsOf(rows: readonly ReportRow[]): CompetencyGroups {
  const assessed = rows.filter((row) => row.competency !== null).map((row) => row.competency!);
  const groupNames = [...new Set(assessed.flatMap((competency) => competency.groups.map((group) => group.name)))].sort((a, b) => a.localeCompare(b, "vi"));
  const groups = groupNames.map((name) => {
    const scores = assessed.flatMap((competency) => competency.groups.filter((group) => group.name === name && group.score !== null).map((group) => group.score!));
    const score = mean(scores);
    return { name, score, level: levelWord(score), students: scores.length };
  });
  const skills = new Map<string, { group: string | null; scores: number[] }>();
  for (const competency of assessed) for (const skill of competency.skills) {
    const entry = skills.get(skill.name) ?? { group: skill.group, scores: [] };
    entry.scores.push(skill.score);
    skills.set(skill.name, entry);
  }
  const averages: SkillAverage[] = [...skills.entries()].map(([name, entry]) => ({ name, group: entry.group, score: mean(entry.scores)!, students: entry.scores.length }))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "vi"));
  const lowest = averages.slice(0, 5);
  const highest = [...averages].reverse().filter((skill) => !lowest.some((low) => low.name === skill.name)).slice(0, 5);
  return { groups, lowest, highest };
}

export function fitSummaryOf(rows: readonly ReportRow[]): FitSummary {
  const careers = rows.filter((row) => row.competency?.career).map((row) => row.competency!.career!);
  const average = mean(careers.map((career) => career.fitScore));
  const byName = new Map<string, (number | null)[]>();
  for (const career of careers) byName.set(career.name, [...(byName.get(career.name) ?? []), career.fitScore]);
  return {
    average, label: fitWord(average),
    levels: FIT_WORDS.map((label) => ({ label, students: careers.filter((career) => career.fitLabel === label).length })),
    careers: [...byName.entries()].map(([name, scores]) => ({ name, students: scores.length, average: mean(scores) }))
      .sort((a, b) => b.students - a.students || a.name.localeCompare(b.name, "vi")),
  };
}

export function progressCountsOf(rows: readonly ReportRow[]): ProgressCounts {
  const count = (status: ProgressStatus) => rows.filter((row) => row.status === status).length;
  return { total: rows.length, onTrack: count("on_track"), late: count("late"), unknown: count("unknown"), noTranscript: count("no_transcript") };
}

export function dashboardReport(all: readonly ReportRow[], filters: Filters, generatedAt: string, now: Date): DashboardReport {
  const rows = filterRows(all, filters);
  return {
    ...headOf(rows, generatedAt, now),
    kpis: cohortSplit(rows, kpisOf),
    gpaByTerm: cohortSplit(rows, (part) => ({ points: gpaPoints(part) })),
    gpaBands: cohortSplit(rows, gpaBandsOf),
    averages: averageTables(rows),
    competencyGroups: cohortSplit(rows, competencyGroupsOf),
    fit: cohortSplit(rows, fitSummaryOf),
    progress: cohortSplit(rows, progressCountsOf),
  };
}

/* ------------------------------------------------------------------------ */
/* AD-REPORT-02/03 Tiến độ */

export const PROGRESS_SORTS = ["name", "studentCode", "cohort", "specialty", "credits", "gpa", "status"] as const;
export type ProgressQuery = Filters & { status?: ProgressStatus | undefined; sort?: (typeof PROGRESS_SORTS)[number] | undefined; dir?: Dir | undefined; page?: number | undefined; pageSize?: number | undefined };
const STATUS_ORDER: Record<ProgressStatus, number> = { late: 0, on_track: 1, unknown: 2, no_transcript: 3 };

export const progressStudent = (row: ReportRow): ProgressStudent => ({
  ...baseOf(row), status: row.status, passedCredits: row.passedCredits, totalCredits: row.totalCredits, expectedCredits: row.expectedCredits,
  gpa: row.gpa, risk: row.risk.level,
});

/** The students of the progress report in the asked order (every page, for the Excel export too). */
export function progressRows(all: readonly ReportRow[], query: ProgressQuery): ReportRow[] {
  const rows = filterRows(all, query).filter((row) => !query.status || row.status === query.status);
  const dir = query.dir ?? "asc";
  switch (query.sort ?? "name") {
    case "studentCode": return sortBy(rows, (row) => row.studentCode, dir);
    case "cohort": return sortBy(rows, (row) => (row.cohort ? Number(/\d+/.exec(row.cohort)?.[0] ?? 0) : null), dir);
    case "specialty": return sortBy(rows, (row) => row.specialtyName, dir);
    case "credits": return sortBy(rows, (row) => row.passedCredits, dir);
    case "gpa": return sortBy(rows, (row) => row.gpa, dir);
    case "status": return sortBy(rows, (row) => STATUS_ORDER[row.status], dir);
    default: return dir === "asc" ? [...rows].sort(compareNames) : [...rows].sort((a, b) => compareNames(b, a));
  }
}

export function progressReport(all: readonly ReportRow[], query: ProgressQuery, generatedAt: string, now: Date): ProgressReport {
  const scoped = filterRows(all, query);
  return {
    ...headOf(scoped, generatedAt, now),
    counts: cohortSplit(scoped, progressCountsOf),
    page: paginate(progressRows(all, query).map(progressStudent), query.page ?? 1, query.pageSize ?? 20),
  };
}

/* ------------------------------------------------------------------------ */
/* AD-REPORT-04/05 Nguy cơ */

export const RISK_LABELS: Record<RiskKind, string> = {
  failed_course: "Môn bắt buộc chưa đạt", pace: "Không kịp tín chỉ", gpa_below: "GPA dưới ngưỡng", late_course: "Trễ môn so với KHĐT",
  elective_short: "Thiếu tín chỉ tự chọn",
};
const RISK_ORDER: readonly RiskKind[] = ["failed_course", "pace", "gpa_below", "late_course", "elective_short"];
export const RISK_SORTS = ["name", "studentCode", "cohort", "level", "gpa", "reasons"] as const;
export type RiskQuery = Filters & { level?: "risk" | "warn" | undefined; sort?: (typeof RISK_SORTS)[number] | undefined; dir?: Dir | undefined; page?: number | undefined; pageSize?: number | undefined };

export const riskStudent = (row: ReportRow): RiskStudent => ({ ...baseOf(row), level: row.risk.level!, reasons: row.risk.items, gpa: row.gpa });

export function riskRows(all: readonly ReportRow[], query: RiskQuery): ReportRow[] {
  const rows = filterRows(all, query).filter((row) => row.risk.level !== null && (!query.level || row.risk.level === query.level));
  const dir = query.dir ?? "asc";
  switch (query.sort ?? "level") {
    case "name": return dir === "asc" ? [...rows].sort(compareNames) : [...rows].sort((a, b) => compareNames(b, a));
    case "studentCode": return sortBy(rows, (row) => row.studentCode, dir);
    case "cohort": return sortBy(rows, (row) => (row.cohort ? Number(/\d+/.exec(row.cohort)?.[0] ?? 0) : null), dir);
    case "gpa": return sortBy(rows, (row) => row.gpa, dir);
    case "reasons": return sortBy(rows, (row) => row.risk.items.length, dir);
    default: return sortBy(rows, (row) => (row.risk.level === "risk" ? 0 : 1), dir);
  }
}

export function riskReport(all: readonly ReportRow[], query: RiskQuery, generatedAt: string, now: Date): RiskReport {
  const scoped = filterRows(all, query);
  const flagged = (rows: readonly ReportRow[]) => rows.filter((row) => row.risk.level !== null);
  return {
    ...headOf(scoped, generatedAt, now),
    counts: cohortSplit(scoped, (rows) => ({
      total: flagged(rows).length, risk: rows.filter((row) => row.risk.level === "risk").length, warn: rows.filter((row) => row.risk.level === "warn").length,
    })),
    reasons: cohortSplit(scoped, (rows) => ({
      items: RISK_ORDER.map((kind) => ({ kind, label: RISK_LABELS[kind], students: flagged(rows).filter((row) => row.risk.items.some((item) => item.kind === kind)).length })),
    })),
    page: paginate(riskRows(all, query).map(riskStudent), query.page ?? 1, query.pageSize ?? 20),
  };
}

/* ------------------------------------------------------------------------ */
/* AD-REPORT-06/07 Kỹ năng còn thiếu */

export type SkillsQuery = Filters & { career?: string | undefined };
export const SKILL_STATUS_LABELS: Record<SkillGapStatus, string> = {
  below: "Dưới ngưỡng", not_studied: "Chưa học", self_study: "Cần tự học ngoài chương trình", no_data: "Chưa có điểm",
};
const SKILL_STATUS_ORDER: readonly SkillGapStatus[] = ["below", "not_studied", "self_study", "no_data"];
/** How many skills the chart shows. */
export const TOP_SKILLS = 12;

const withCareer = (rows: readonly ReportRow[], career: string | undefined) =>
  rows.filter((row) => row.competency?.career && (!career || row.competency.career.name === career));

export function skillGapRows(rows: readonly ReportRow[], names?: readonly string[]): SkillGapRow[] {
  const counts = new Map<string, SkillGapRow>();
  const rowOf = (name: string) => counts.get(name) ?? { name, below: 0, notStudied: 0, selfStudy: 0, noData: 0, total: 0 };
  for (const name of names ?? []) counts.set(name, rowOf(name));
  for (const row of rows) for (const gap of row.competency?.career?.gaps ?? []) {
    if (names && !names.includes(gap.name)) continue;
    const entry = rowOf(gap.name);
    if (gap.status === "below") entry.below++;
    else if (gap.status === "not_studied") entry.notStudied++;
    else if (gap.status === "self_study") entry.selfStudy++;
    else entry.noData++;
    entry.total++;
    counts.set(gap.name, entry);
  }
  const list = [...counts.values()];
  return names ? names.map((name) => counts.get(name)!) : list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "vi"));
}

export function skillsReport(all: readonly ReportRow[], query: SkillsQuery, generatedAt: string, now: Date): SkillsReport {
  const scoped = filterRows(all, query);
  const rows = withCareer(scoped, query.career);
  const top = skillGapRows(rows).slice(0, TOP_SKILLS);
  const names = top.map((item) => item.name);
  return {
    ...headOf(scoped, generatedAt, now),
    careers: [...new Set(withCareer(scoped, undefined).map((row) => row.competency!.career!.name))].sort((a, b) => a.localeCompare(b, "vi")),
    skills: { all: { items: top }, byCohort: cohortSplit(rows, (part) => ({ items: skillGapRows(part, names) })).byCohort },
  };
}

export function skillStudents(all: readonly ReportRow[], query: SkillsQuery & { skill: string }): SkillStudents {
  const rows = withCareer(filterRows(all, query), query.career);
  const items = rows.flatMap((row) => {
    const gap = row.competency!.career!.gaps.find((entry) => entry.name === query.skill);
    return gap ? [{ ...baseOf(row), careerName: row.competency!.career!.name, status: gap.status, fitScore: row.competency!.career!.fitScore, fitLabel: row.competency!.career!.fitLabel }] : [];
  }).sort((a, b) => SKILL_STATUS_ORDER.indexOf(a.status) - SKILL_STATUS_ORDER.indexOf(b.status) || compareNames(a, b));
  return { skill: query.skill, items };
}

/* ------------------------------------------------------------------------ */
/* AD-REPORT-08 Nghề nghiệp mục tiêu */

function careerRows(rows: readonly ReportRow[], names?: readonly string[]): CareerRow[] {
  const groups = new Map<string, NonNullable<NonNullable<ReportRow["competency"]>["career"]>[]>();
  for (const name of names ?? []) groups.set(name, []);
  for (const row of rows) {
    const career = row.competency?.career;
    if (!career || (names && !names.includes(career.name))) continue;
    groups.set(career.name, [...(groups.get(career.name) ?? []), career]);
  }
  const list = [...groups.entries()].map(([name, careers]): CareerRow => {
    const gaps = new Map<string, number>();
    for (const career of careers) for (const gap of career.gaps) gaps.set(gap.name, (gaps.get(gap.name) ?? 0) + 1);
    return {
      name, students: careers.length, average: mean(careers.map((career) => career.fitScore)),
      levels: FIT_WORDS.map((label) => ({ label, students: careers.filter((career) => career.fitLabel === label).length })),
      topGaps: [...gaps.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi")).slice(0, 3).map(([gap, students]) => ({ name: gap, students })),
    };
  });
  return names ? names.map((name) => list.find((row) => row.name === name)!) : list.sort((a, b) => b.students - a.students || a.name.localeCompare(b.name, "vi"));
}

export function careersReport(all: readonly ReportRow[], filters: Filters, generatedAt: string, now: Date): CareersReport {
  const rows = filterRows(all, filters);
  const overall = careerRows(rows);
  const names = overall.map((row) => row.name);
  return {
    ...headOf(rows, generatedAt, now),
    withoutCareer: rows.filter((row) => row.hasTranscript && !row.competency?.career).length,
    careers: { all: { items: overall }, byCohort: cohortSplit(rows, (part) => ({ items: careerRows(part, names) })).byCohort },
  };
}

/* ------------------------------------------------------------------------ */
/* AD-REPORT-09 Môn học được đề xuất */

const HOW_ORDER: readonly CourseHow[] = ["retake", "improve", "new"];

function courseRows(rows: readonly ReportRow[], codes?: readonly string[]): CourseRow[] {
  const counts = new Map<string, CourseRow>();
  for (const code of codes ?? []) counts.set(code, { code, name: "", newStudents: 0, retake: 0, improve: 0, total: 0 });
  for (const row of rows) for (const course of row.roadmapCourses ?? []) {
    if (codes && !codes.includes(course.code)) continue;
    const entry = counts.get(course.code) ?? { code: course.code, name: course.name, newStudents: 0, retake: 0, improve: 0, total: 0 };
    if (!entry.name) entry.name = course.name;
    if (course.how === "new") entry.newStudents++;
    else if (course.how === "retake") entry.retake++;
    else entry.improve++;
    entry.total++;
    counts.set(course.code, entry);
  }
  return codes ? codes.map((code) => counts.get(code)!) : [...counts.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "vi"));
}

export function coursesReport(all: readonly ReportRow[], filters: Filters, generatedAt: string, now: Date): CoursesReport {
  const rows = filterRows(all, filters);
  const overall = courseRows(rows);
  const names = new Map(overall.map((row) => [row.code, row.name]));
  return {
    ...headOf(rows, generatedAt, now),
    withRoadmap: rows.filter((row) => row.roadmapCourses !== null).length,
    courses: {
      all: { items: overall },
      byCohort: cohortSplit(rows, (part) => ({ items: courseRows(part, overall.map((row) => row.code)).map((row) => ({ ...row, name: names.get(row.code) ?? row.name })) })).byCohort,
    },
  };
}

export function courseStudents(all: readonly ReportRow[], query: Filters & { code: string }): CourseStudents {
  const code = query.code.trim().toUpperCase();
  let name = "";
  const items = filterRows(all, query).flatMap((row) => {
    const course = row.roadmapCourses?.find((entry) => entry.code === code);
    if (!course) return [];
    name ||= course.name;
    return [{ ...baseOf(row), how: course.how, gpa: row.gpa }];
  }).sort((a, b) => HOW_ORDER.indexOf(a.how) - HOW_ORDER.indexOf(b.how) || compareNames(a, b));
  return { code, name, items };
}

/* ------------------------------------------------------------------------ */
/* Filter choices */

/** The filter bar's choices: the students' cohorts (read without the cached rows, so the bar never waits), majors, specialties. */
export function reportOptions(cohorts: readonly (string | null)[], now: Date): ReportOptions {
  return {
    cohorts: [...new Set(cohorts.map((cohort) => cohort?.trim().toUpperCase() || null).filter((cohort): cohort is string => cohort !== null))].sort(compareCohorts),
    majors: MAJORS.map((major) => ({ code: major.code, name: major.label })),
    specialties: SPECIALTIES.map((item) => ({ code: item.code, name: item.label, majorCode: item.major ?? null })),
    studyTerm: calendarTerm(now),
  };
}
