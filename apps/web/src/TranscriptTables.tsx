import { Fragment, useId, useReducer, useState } from "react";
import { decimalText, meaningClass, termName, type Meaning } from "./display-format";
import { Icon } from "./student-icons";
import type { Transcript } from "./StudentTranscript";
import { INFERRED_RESULT_NOTE, attemptOutcome, isFailLetter, isRowWarning, reviewLabels, transcriptCreditCheck, type CreditCheck } from "./transcript-results";
import { academicSections, foldText, printedSemesterGpa } from "./student-overview-data";
import "./student-records.css";
import "./transcript-terms.css";

// The transcript tables of "Bảng điểm của tôi", read only, shared with the admin portal's student details (user,
// 2026-10-25: "xem thêm bảng điểm của sinh viên định dạng giống như của bên sinh viên"): the term and search filters,
// one table per term with its printed summaries, and the notes under them. Since 2026-11-04 (all terms open made the
// page about 3.7 screens long) each term folds under a header that says what it holds: the newest term with results and
// the term being studied start open, the others folded, and a search or a chosen term opens every term it shows.

type TranscriptData = Transcript["data"];
type Section = TranscriptData["sections"][number];
type Course = Section["courses"][number];

/** Search by code or name, with or without Vietnamese marks ("lap trinh" finds "Lập trình"). */
export function courseMatcher(search: string): (course: Pick<Course, "code" | "name">) => boolean {
  const query = foldText(search.trim());
  return course => foldText(`${course.code} ${course.name}`).includes(query);
}
/**
 * A term section the one way students read a term (user review 2026-10-30): the printed heading "2021-2022 · HK02" reads
 * "HK2 2021–2022". "Điểm bảo lưu", "Chưa rõ học kỳ" and headings outside the usual years and terms stay as printed.
 */
export function sectionTitle(section: Pick<Section, "label" | "academicYear" | "semester">): string {
  const years = /^(\d{4})-(\d{4})$/.exec(section.academicYear ?? "");
  const term = /^HK0?([1-3])$/.exec(section.semester ?? "");
  return years && term && Number(years[2]) === Number(years[1]) + 1 ? termName(`HK${years[1]!.slice(2)}${term[1]}`) : section.label;
}
/** A printed summary figure with the decimal comma every page uses ("2.45" → "2,45"); words stay as printed. */
export const printedFigure = (value: string) => value.replace(/^(\s*-?\d+)\.(\d+)(?=\s|$)/, "$1,$2");
/** The transcript's notes shown above the tables: an OCR import shows all of them; a text-layer import only the rows it marked or skipped. */
export const transcriptNotes = (data: TranscriptData) => data.warnings.filter(w => data.parserVersion === "vlu-ocr-1.1" || isRowWarning(w));

/** A row registered without a score, letter or result yet: a course being studied. */
const inProgress = (course: Course) => attemptOutcome(course).status === "pending";
/**
 * The newest term with results (a score, a letter or a printed result, so a term of VT/CT only counts) and the term being
 * studied: the first later term with courses registered but not graded, else the newest term itself while some of its
 * courses have no grade yet (the competency engine's studyTermCode, comp-calc-v13). Terms in time order; "Điểm bảo lưu"
 * and "Chưa rõ học kỳ" are never either.
 */
export function currentTerms(data: TranscriptData): { latest?: Section; studying?: Section } {
  const terms = academicSections({ data });
  let index = terms.length - 1;
  while (index >= 0 && terms[index]!.courses.every(inProgress)) index--;
  const latest = index >= 0 ? terms[index] : undefined;
  const studying = terms.slice(index + 1).find(term => term.courses.some(inProgress)) ?? (latest?.courses.some(inProgress) ? latest : undefined);
  return { latest, studying };
}
/** The terms open when the tables are first drawn: the newest term with results and the term being studied; without either (no usual term at all), every section. */
export function defaultOpenTerms(data: TranscriptData): Set<string> {
  const { latest, studying } = currentTerms(data);
  return new Set(latest || studying ? [latest, studying].flatMap(term => term ? [term.id] : []) : data.sections.map(section => section.id));
}

export type TermFacts = { courses: number; credits: number; average: string | null; notPassed: number; review: number };
/**
 * What a term's header says: its rows and their credits as the table lists them, the printed "Điểm TB học kỳ (Hệ 4)"
 * (never computed), the rows not passed by the pages' one rule (a printed result first, else F, VT or CT) and the rows
 * marked "Cần kiểm tra".
 */
export function termFacts(section: Section): TermFacts {
  const average = printedSemesterGpa(section)?.trim();
  return {
    courses: section.courses.length,
    credits: section.courses.reduce((sum, course) => sum + (Number.isFinite(course.credits) && course.credits > 0 ? course.credits : 0), 0),
    average: average ? printedFigure(average) : null,
    notPassed: section.courses.filter(course => attemptOutcome(course).status === "fail").length,
    review: section.courses.filter(course => course.review?.length).length,
  };
}

/**
 * Which terms are open. `open` is the reader's own choice, starting from defaultOpenTerms. While a search or a chosen term
 * filters the tables, every term shown is open except those closed since the filter last changed, so a search never
 * hides what it found; clearing the filter brings back the reader's own choice. Mở tất cả / Thu gọn tất cả set both.
 */
export type TermFolds = { open: ReadonlySet<string>; closedWhileFiltered: ReadonlySet<string> };
export type TermFoldAction =
  | { type: "toggle"; id: string; filtered: boolean }
  | { type: "all"; ids: readonly string[]; open: boolean }
  | { type: "filter-changed" };
export const initialTermFolds = (data: TranscriptData): TermFolds => ({ open: defaultOpenTerms(data), closedWhileFiltered: new Set() });
const flip = (ids: ReadonlySet<string>, id: string) => { const next = new Set(ids); if (!next.delete(id)) next.add(id); return next; };
export function foldTerms(folds: TermFolds, action: TermFoldAction): TermFolds {
  switch (action.type) {
    case "toggle": return action.filtered ? { ...folds, closedWhileFiltered: flip(folds.closedWhileFiltered, action.id) } : { ...folds, open: flip(folds.open, action.id) };
    case "all": return { open: new Set(action.open ? action.ids : []), closedWhileFiltered: new Set(action.open ? [] : action.ids) };
    case "filter-changed": return folds.closedWhileFiltered.size ? { ...folds, closedWhileFiltered: new Set() } : folds;
  }
}
export type TableFilters = { term: string; search: string };
const isFiltered = (filters: TableFilters) => filters.term !== "all" || filters.search.trim() !== "";
const isTermOpen = (folds: TermFolds, id: string, filtered: boolean) => filtered ? !folds.closedWhileFiltered.has(id) : folds.open.has(id);

/** One term as the tables draw it: its place in the transcript, the rows left after the filters, and whether it is open. */
export type TermView = { section: Section; index: number; title: string; courses: Course[]; open: boolean };
/** The terms drawn, in the transcript's printed order: those with rows left after the term and search filters. */
export function shownTerms(data: TranscriptData, filters: TableFilters, folds: TermFolds): TermView[] {
  const matches = courseMatcher(filters.search);
  const filtered = isFiltered(filters);
  return data.sections.flatMap((section, index) => {
    if (filters.term !== "all" && section.id !== filters.term) return [];
    const courses = section.courses.filter(matches);
    return courses.length ? [{ section, index, title: sectionTitle(section), courses, open: isTermOpen(folds, section.id, filtered) }] : [];
  });
}

/** Explicit pass/fail text uses its corresponding colour. MT exemptions are
    displayed separately as passed without changing the imported source data. */
function resultClass(result: string | null): string | undefined {
  const text = (result ?? "").trim().toLowerCase();
  if (/^(không|khong|chưa|chua|ko)\s*đạt|^(rớt|trượt)|^✗/.test(text)) return "sr-result-fail";
  if (/^đạt/.test(text) || text === "✓") return "sr-result-pass";
  return undefined;
}
/** The printed result as read, MT as an exemption, or, for a blank cell, the
    result decided from the official letter grade with a short text note. */
function ResultCell({ course }: { course: Course }) {
  const outcome = attemptOutcome(course);
  if (outcome.exempt) return <td className="sr-result-pass">Đạt (miễn thi)</td>;
  if (course.result?.trim()) return <td className={resultClass(course.result)}>{course.result}</td>;
  if (!outcome.inferred) return <td>—</td>;
  return <td className={`sr-result-${outcome.status}`}>{outcome.status === "pass" ? "Đạt" : "Không đạt"}<small className="sr-result-note">{INFERRED_RESULT_NOTE}</small></td>;
}
const credits = (n: number) => `${n.toLocaleString("vi-VN")} TC`;
/** Passed credits (without GDTC/GDQP) disagree with the printed "Tổng số tín chỉ tích lũy". */
function CreditMismatch({ check }: { check: CreditCheck }) {
  const counted = check.uncertain
    ? `${credits(check.computed)} (hoặc ${credits(check.computed + check.uncertain)} nếu tính cả học phần bảo lưu)`
    : credits(check.computed);
  return <div className="sr-review" role="note"><strong>Tổng tín chỉ chưa khớp với bảng điểm.</strong> Tổng số tín chỉ tích lũy in trên bảng điểm là {credits(check.printed ?? 0)}, nhưng các môn có kết quả Đạt (không tính môn điều kiện GDTC/GDQP) cộng lại được {counted}. Kết quả Đạt/Không đạt của một số môn có thể chưa chính xác; hãy đối chiếu với PDF gốc.</div>;
}

/**
 * One term: its header is a button (the WAI-ARIA disclosure pattern) that opens or folds the table and the printed
 * summaries under it. "1 môn chưa đạt" is the one red note; rows to check are amber, the term being studied grey.
 */
function TermSection({ term, studying, panelId, onToggle }: { term: TermView; studying: boolean; panelId: string; onToggle: () => void }) {
  const { section, title, courses, open } = term;
  const facts = termFacts(section);
  const line = [`${facts.courses} môn`, facts.credits > 0 ? credits(facts.credits) : "", facts.average ? `Điểm TB học kỳ ${facts.average}` : ""].filter(Boolean).join(" · ");
  const flags = ([
    [studying, "none", "Đang học"],
    [facts.notPassed > 0, "bad", `${facts.notPassed} môn chưa đạt`],
    [facts.review > 0, "warn", `${facts.review} dòng cần kiểm tra`],
  ] satisfies [boolean, Meaning, string][]).filter(([shown]) => shown);
  // The spaces between the parts keep the button's spoken name apart ("HK1 2025–2026 7 môn … 1 môn chưa đạt"); flex and grid layouts drop them.
  return <section className={`sr-term tt-term${open ? " is-open" : ""}`}>
    <h3 className="tt-term-heading"><button type="button" className="tt-term-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
      <Icon name="chevron" className="tt-chevron" />
      <span className="tt-term-main"><span className="tt-term-name">{title}</span>{" "}<span className="tt-term-facts">{line}</span></span>
      {flags.length > 0 && <>{" "}<span className="tt-term-flags">{flags.map(([, meaning, text], i) => <Fragment key={meaning}>{i > 0 && " "}<span className={`tt-flag ${meaningClass(meaning)}`}>{text}</span></Fragment>)}</span></>}
    </button></h3>
    <div className="tt-term-panel" id={panelId} hidden={!open}>
      <div className="sr-table-scroll" tabIndex={0} role="region" aria-label={`Bảng điểm ${title}`}><table><caption className="sr-only">{`Bảng điểm ${title}`}</caption><thead><tr><th scope="col">STT</th><th scope="col">Mã môn học</th><th scope="col">Tên môn học</th><th scope="col">Tín chỉ</th><th scope="col">Hệ 10</th><th scope="col">Hệ 4</th><th scope="col">Điểm chữ</th><th scope="col">Kết quả</th></tr></thead><tbody>{courses.map((course, index) => <tr key={`${course.sourcePage}-${course.ordinal}-${index}`} className={course.review?.length ? "sr-row-review" : undefined}><td>{course.ordinal}</td><td>{course.code || "—"}</td><td>{course.name}{course.review?.length ? <small className="sr-review-reasons">Cần kiểm tra: {reviewLabels(course.review).join(", ")}</small> : null}</td><td>{course.printed?.credits !== undefined ? course.printed.credits || "—" : decimalText(course.credits)}</td><td>{course.score10 !== null ? decimalText(course.score10) : course.printed?.score10 ?? "—"}</td><td>{course.score4 === null ? course.printed?.score4 ?? "—" : decimalText(course.score4, 2)}</td><td><span className={isFailLetter(course.letter) ? "sr-grade-fail" : "sr-grade"}>{course.letter ?? "—"}</span></td><ResultCell course={course} /></tr>)}</tbody></table></div>
      {section.summaries.length > 0 && <dl className="sr-summaries">{section.summaries.map((summary, i) => <div key={i}><dt>{summary.label}</dt><dd>{summary.value === null ? "—" : printedFigure(summary.value)}</dd></div>)}</dl>}
    </div>
  </section>;
}

/** Remount it (`key`) to clear the filters and fold the terms as at first, e.g. after a new import. */
export default function TranscriptTables({ data }: { data: TranscriptData }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [folds, dispatch] = useReducer(foldTerms, data, initialTermFolds);
  const idPrefix = useId();
  const filters = { term: filter, search };
  const filtered = isFiltered(filters);
  const terms = shownTerms(data, filters, folds);
  const studying = currentTerms(data).studying?.id;
  const creditCheck = transcriptCreditCheck({ data });
  const inferredRows = data.sections.reduce((n, s) => n + s.courses.filter(c => attemptOutcome(c).inferred).length, 0);
  const count = terms.reduce((n, term) => n + term.courses.length, 0);
  const foldAll = (open: boolean) => dispatch({ type: "all", ids: data.sections.map(section => section.id), open });
  return <>
    {creditCheck.status === "mismatch" && <CreditMismatch check={creditCheck} />}
    <div className="sr-table-filters"><label>Học kỳ<select value={filter} onChange={e => { setFilter(e.target.value); dispatch({ type: "filter-changed" }); }}><option value="all">Tất cả học kỳ</option>{data.sections.map(s => <option key={s.id} value={s.id}>{sectionTitle(s)}</option>)}</select></label><label>Tìm học phần<input value={search} onChange={e => { setSearch(e.target.value); dispatch({ type: "filter-changed" }); }} placeholder="Mã hoặc tên học phần…" /></label><span>{count} dòng học phần</span></div>
    {count > 0 && <div className="tt-terms">
      {terms.length > 1 && <div className="tt-terms-bar"><p>Bấm vào học kỳ để mở hoặc thu gọn.</p><div className="tt-terms-actions"><button type="button" className="tt-text-button" onClick={() => foldAll(true)}>Mở tất cả</button><button type="button" className="tt-text-button" onClick={() => foldAll(false)}>Thu gọn tất cả</button></div></div>}
      {/* Phones: the grade columns sit right of the screen (the tables keep one column layout across terms). */}
      {terms.some(term => term.open) && <p className="sr-swipe-hint" aria-hidden="true">Vuốt ngang để xem điểm <Icon name="arrow" /></p>}
      {terms.map(term => <TermSection key={term.section.id} term={term} studying={term.section.id === studying} panelId={`${idPrefix}-term-${term.index}`} onToggle={() => dispatch({ type: "toggle", id: term.section.id, filtered })} />)}
    </div>}
    {!count && <p className="sw-empty">Không tìm thấy học phần phù hợp.</p>}
    <p className="sw-muted">(*) Môn điều kiện theo ghi chú PDF. Các tổng kết học kỳ được lấy nguyên từ bảng điểm của trường, không tính lại theo các dòng đang lọc.</p>
    {inferredRows > 0 && <p className="sw-muted">Nếu ô Kết quả trong PDF chỉ có biểu tượng, hệ thống xem ô đó là trống. Khi đó Đạt/Không đạt được suy ra từ điểm chữ chính thức: A+ đến D là Đạt, F, VT (vắng thi) và CT (cấm thi) là Không đạt.{creditCheck.status === "match" ? ` Tổng tín chỉ các môn Đạt khớp với Tổng số tín chỉ tích lũy ${credits(creditCheck.printed ?? 0)} in trên bảng điểm.` : ""}</p>}
  </>;
}
