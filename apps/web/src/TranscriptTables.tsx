import { useState } from "react";
import { Icon } from "./student-icons";
import type { Transcript } from "./StudentTranscript";
import { INFERRED_RESULT_NOTE, attemptOutcome, isFailLetter, isRowWarning, reviewLabels, transcriptCreditCheck, type CreditCheck } from "./transcript-results";
import { foldText } from "./student-overview-data";
import "./student-records.css";

// The transcript tables of "Bảng điểm của tôi", read only, shared with the admin portal's student details (user,
// 2026-10-25: "xem thêm bảng điểm của sinh viên định dạng giống như của bên sinh viên"): the term and search filters,
// one table per term with its printed summaries, and the notes under them.

type TranscriptData = Transcript["data"];
type Course = TranscriptData["sections"][number]["courses"][number];

/** Search by code or name, with or without Vietnamese marks ("lap trinh" finds "Lập trình"). */
export function courseMatcher(search: string): (course: Pick<Course, "code" | "name">) => boolean {
  const query = foldText(search.trim());
  return course => foldText(`${course.code} ${course.name}`).includes(query);
}
/** The transcript's notes shown above the tables: an OCR import shows all of them; a text-layer import only the rows it marked or skipped. */
export const transcriptNotes = (data: TranscriptData) => data.warnings.filter(w => data.parserVersion === "vlu-ocr-1.1" || isRowWarning(w));

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

/** Remount it (`key`) to clear the filters, e.g. after a new import. */
export default function TranscriptTables({ data }: { data: TranscriptData }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const sections = data.sections.filter(s => filter === "all" || s.id === filter);
  const creditCheck = transcriptCreditCheck({ data });
  const inferredRows = data.sections.reduce((n, s) => n + s.courses.filter(c => attemptOutcome(c).inferred).length, 0);
  const matches = courseMatcher(search);
  const count = sections.reduce((n, s) => n + s.courses.filter(matches).length, 0);
  return <>
    {creditCheck.status === "mismatch" && <CreditMismatch check={creditCheck} />}
    <div className="sr-table-filters"><label>Học kỳ<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Tất cả học kỳ</option>{data.sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label><label>Tìm học phần<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Mã hoặc tên học phần…" /></label><span>{count} dòng học phần</span></div>
    {/* Phones: the grade columns sit right of the screen (the tables keep one column layout across terms). */}
    {count > 0 && <p className="sr-swipe-hint" aria-hidden="true">Vuốt ngang để xem điểm <Icon name="arrow" /></p>}
    {sections.map(section => { const courses = section.courses.filter(matches); if (!courses.length) return null; return <section className="sr-term" key={section.id}><h3>{section.label}</h3><div className="sr-table-scroll" tabIndex={0} role="region" aria-label={`Bảng điểm ${section.label}`}><table><thead><tr><th scope="col">STT</th><th scope="col">Mã môn học</th><th scope="col">Tên môn học</th><th scope="col">Tín chỉ</th><th scope="col">Hệ 10</th><th scope="col">Hệ 4</th><th scope="col">Điểm chữ</th><th scope="col">Kết quả</th></tr></thead><tbody>{courses.map((course, index) => <tr key={`${course.sourcePage}-${course.ordinal}-${index}`} className={course.review?.length ? "sr-row-review" : undefined}><td>{course.ordinal}</td><td>{course.code || "—"}</td><td>{course.name}{course.review?.length ? <small className="sr-review-reasons">Cần kiểm tra: {reviewLabels(course.review).join(", ")}</small> : null}</td><td>{course.printed?.credits !== undefined ? course.printed.credits || "—" : course.credits}</td><td>{course.score10 ?? course.printed?.score10 ?? "—"}</td><td>{course.score4 === null ? course.printed?.score4 ?? "—" : course.score4.toFixed(2)}</td><td><span className={isFailLetter(course.letter) ? "sr-grade-fail" : "sr-grade"}>{course.letter ?? "—"}</span></td><ResultCell course={course} /></tr>)}</tbody></table></div>{section.summaries.length > 0 && <dl className="sr-summaries">{section.summaries.map((summary, i) => <div key={i}><dt>{summary.label}</dt><dd>{summary.value ?? "—"}</dd></div>)}</dl>}</section>; })}
    {!count && <p className="sw-empty">Không tìm thấy học phần phù hợp.</p>}
    <p className="sw-muted">(*) Môn điều kiện theo ghi chú PDF. Các tổng kết học kỳ được lấy nguyên từ bảng điểm của trường, không tính lại theo các dòng đang lọc.</p>
    {inferredRows > 0 && <p className="sw-muted">Nếu ô Kết quả trong PDF chỉ có biểu tượng, hệ thống xem ô đó là trống. Khi đó Đạt/Không đạt được suy ra từ điểm chữ chính thức: A+ đến D là Đạt, F, VT (vắng thi) và CT (cấm thi) là Không đạt.{creditCheck.status === "match" ? ` Tổng tín chỉ các môn Đạt khớp với Tổng số tín chỉ tích lũy ${credits(creditCheck.printed ?? 0)} in trên bảng điểm.` : ""}</p>}
  </>;
}
