import { z } from "zod";
import { KNOWN_LETTER, TranscriptError, UNKNOWN_TERM_SECTION, isSettledResultConflict, reviewWarning, skippedRowsWarning, usualTerm, type TranscriptCourse, type TranscriptData, type TranscriptSection } from "./transcript-parser.js";

const text = z.string().max(2000);
// Since 2026-10-23 the values of a row are taken as printed (a code of another format, an unknown grade mark, a cell
// that is not a number): the worker's issues mark the row for review instead of refusing the transcript. The schema
// only guards the worker's contract (types, sizes, page numbers).
const courseSchema = z.object({
  ordinal: z.number().int().min(0).max(100000), course_code: z.string().max(200), course_name: text,
  credits: z.number().min(0).max(1000).nullable(),
  score_10: z.number().min(0).max(10).nullable(), score_4: z.number().min(0).max(4).nullable(),
  letter_grade: z.string().max(50).nullable(),
  result: z.enum(["passed", "failed"]).nullable(), result_raw: z.string().max(200).nullable().optional(), source_page: z.number().int().min(1).max(20),
  academic_year: z.string().max(50).nullable(), semester: z.string().max(50).nullable(),
  section: z.enum(["semester", "credit_transfer", "unknown"]), needs_review: z.boolean(), issues: z.array(text).max(100),
  raw_cells: z.array(text.nullable()).max(20).optional()
});
const documentSchema = z.object({
  schema_version: z.literal("1.1"), adapter: z.literal("vlu_8_columns"), course_count: z.number().int().min(0).max(1000),
  courses: z.array(courseSchema).max(1000), needs_review: z.boolean(),
  pages: z.array(z.object({ page: z.number().int().min(1).max(20), method: z.enum(["pdf_text", "ppocr", "gemma"]), warnings: z.array(text).max(100) })).min(1).max(20),
  summaries: z.array(z.object({ academic_year: text.nullable(), semester: text.nullable(), raw_cells: z.array(text.nullable()).max(20) })).max(200),
  semesters: z.array(z.record(z.string(), z.unknown())).max(100),
  unparsed_rows: z.array(z.object({ source_page: z.number().int().min(1).max(20).optional() })).max(1000)
});
/** GDTC/GDQP courses: current codes and the old ones of K26–K28, as the worker's CONDITIONAL_PREFIXES. */
const CONDITIONAL_CODE = /^(71NAD|71PE|DGT|DQP)/;

/**
 * Maps the OCR worker's result. Refused only when the worker breaks its contract (invalid_ocr_result) or found no course
 * row at all (unsupported_layout): every row it read is kept as printed.
 */
export function mapOcrTranscript(input: unknown): TranscriptData {
  const checked = documentSchema.safeParse(input);
  if (!checked.success) throw new TranscriptError("invalid_ocr_result");
  const d = checked.data;
  if (d.course_count !== d.courses.length || d.pages.some((p, i) => p.page !== i + 1) || d.courses.some(c => c.source_page > d.pages.length)) throw new TranscriptError("invalid_ocr_result");
  if (!d.courses.length) throw new TranscriptError("unsupported_layout");
  const sections = new Map<string, TranscriptSection>();
  let reviewed = 0;
  for (const c of d.courses) {
    const review = new Set(c.issues);
    // Older cohorts' results that disagree with the letter and are right (isSettledResultConflict): "Đạt" with 4,0 or
    // more, or any result with a D/D+ letter.
    const printedResult = c.result === "passed" ? "Đạt" : c.result === "failed" ? "Không đạt" : null;
    if (isSettledResultConflict({ result: printedResult, score10: c.score_10, letter: c.letter_grade })) review.delete("result_conflicts_with_grade");
    const transfer = c.section === "credit_transfer";
    const term = c.section === "semester" && c.academic_year && c.semester ? { year: c.academic_year, semester: c.semester } : null;
    if (!transfer && !term) review.add("missing_semester_context");
    else if (term && !usualTerm(term.year, term.semester)) review.add("unusual_term");
    const id = transfer ? "transfer" : term ? `${term.year}-${term.semester}` : UNKNOWN_TERM_SECTION.id;
    let s = sections.get(id);
    if (!s) {
      s = transfer ? { id, academicYear: null, semester: null, label: "Điểm bảo lưu", courses: [], summaries: [] }
        : term ? { id, academicYear: term.year, semester: term.semester, label: `${term.year} · ${term.semester}`, courses: [], summaries: [] }
        : { ...UNKNOWN_TERM_SECTION, courses: [], summaries: [] };
      sections.set(id, s);
    }
    if (s.courses.some(row => row.ordinal === c.ordinal)) review.add("duplicate_row");
    const code = c.course_code.trim(), raw = c.raw_cells ?? [];
    if (!code) review.add("missing_course_code");
    if (c.letter_grade && !KNOWN_LETTER.test(c.letter_grade.trim())) review.add("unrecognized_letter_grade");
    const printed: NonNullable<TranscriptCourse["printed"]> = {};
    const credits = c.credits !== null && Number.isInteger(c.credits) ? c.credits : null;
    if (credits === null) { review.add(c.credits === null ? "missing_credits" : "invalid_credits"); printed.credits = (raw[3] ?? "").trim(); }
    // A score cell the worker could not read as a number keeps its printed text (a new mark, a typo).
    if (c.score_10 === null && review.has("invalid_score_10") && raw[4]?.trim()) printed.score10 = raw[4].trim();
    if (c.score_4 === null && review.has("invalid_score_4") && raw[5]?.trim()) printed.score4 = raw[5].trim();
    const course: TranscriptCourse = {
      ordinal: c.ordinal, code, name: c.course_name, credits: credits ?? 0, score10: c.score_10, score4: c.score_4, letter: c.letter_grade?.trim() || null,
      // An unknown printed result ("Miễn", "Hoãn" …) is kept as text: the pages read it as a result they cannot decide.
      result: c.result === "passed" ? "Đạt" : c.result === "failed" ? "Không đạt" : c.result_raw?.trim() || null,
      conditional: c.course_name.includes("*") || CONDITIONAL_CODE.test(code), sourcePage: c.source_page
    };
    if (review.size) { course.review = [...review]; reviewed++; }
    if (Object.keys(printed).length) course.printed = printed;
    s.courses.push(course);
  }
  for (const raw of d.summaries) {
    // A summary whose term has no course row is left out (it cannot be placed), not a reason to refuse.
    const section = sections.get(raw.academic_year ? `${raw.academic_year}-${raw.semester}` : "transfer");
    if (!section) continue;
    for (const cell of raw.raw_cells) for (const line of (cell ?? "").split(/\r?\n/)) {
      const cleaned = line.replace(/^-\s*/, "").trim(), colon = cleaned.indexOf(":");
      if (colon >= 0) section.summaries.push({ label: cleaned.slice(0, colon).trim(), value: cleaned.slice(colon + 1).trim() || null });
    }
  }
  const skippedPages = [...new Set(d.unparsed_rows.map(row => row.source_page).filter((page): page is number => page !== undefined))];
  return {
    schemaVersion: 1, parserVersion: "vlu-ocr-1.1", pageCount: d.pages.length, courseCount: d.course_count,
    sections: [...sections.values()],
    warnings: ["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh.",
      ...(d.needs_review ? ["Bảng điểm đã được nhận dạng tự động. Hãy đối chiếu các môn học và điểm với PDF gốc."] : []),
      ...(reviewed ? [reviewWarning(reviewed)] : []),
      ...(d.unparsed_rows.length ? [`${skippedRowsWarning(d.unparsed_rows.length)}${skippedPages.length ? ` (trang ${skippedPages.join(", ")})` : ""}`] : [])],
    ocr: { needsReview: d.needs_review, pages: d.pages, semesters: d.semesters }
  };
}
