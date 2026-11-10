import { Worker } from "node:worker_threads";

export class TranscriptError extends Error {
  constructor(public readonly code: string, public readonly status = 422) { super(code); }
}
type Item = { text: string; x: number; y: number; width: number };
type Page = { page: number; items: Item[] };
export type TranscriptCourse = {
  ordinal: number; code: string; name: string; credits: number; score10: number | null; score4: number | null; letter: string | null; result: string | null; conditional: boolean; sourcePage: number;
  /**
   * What in this row did not fit a known form (2026-10-23): a code of another format, an unknown grade mark, a cell that is
   * not a number… The row is kept as printed and marked for review instead of refusing the transcript. Codes as the OCR
   * worker's issues (invalid_course_code, unrecognized_letter_grade, invalid_score_10 …), labels in the web's REVIEW_LABELS.
   */
  review?: string[];
  /** Printed text of a cell that could not be read as a number; its value above is 0 (credits) or null (scores). */
  printed?: { credits?: string; score10?: string; score4?: string };
};
export type TranscriptSection = { id: string; academicYear: string | null; semester: string | null; label: string; courses: TranscriptCourse[]; summaries: { label: string; value: string | null }[] };
/** Rows found before any term heading (2026-10-23): kept in their own section instead of refusing the transcript. */
export const UNKNOWN_TERM_SECTION = { id: "unknown", academicYear: null, semester: null, label: "Chưa rõ học kỳ" } as const;
/**
 * "VT" (vắng thi, absent from the exam), "CT" (cấm thi, barred from the exam; user 2026-10-26: "CT … là chữ cấm thi
 * cũng là không đạt") and "DC" (user 2026-11-09: "tính chung với rớt là được rồi … ở bảng điểm vẫn giữ nguyên chữ DC";
 * its meaning is not written anywhere, at the user's request) are printed in the score and letter columns alike: a failed
 * attempt without a score, 0 in the GPA.
 */
export const NO_SCORE_LETTERS: readonly string[] = ["VT", "CT", "DC"];
/** The letter marks the pages know (pass, fail, VT, CT and DC without a score, MT exempt); another printed mark is kept and marked for review. */
export const KNOWN_LETTER = /^(A\+?|B\+?|C\+?|D\+?|F|MT|VT|CT|DC)$/;
/** One warning for the rows marked for review, shown with the transcript. */
export const reviewWarning = (rows: number) =>
  `Có ${rows} dòng có mã môn, ký hiệu hoặc ô khác dạng thường gặp. Hệ thống vẫn lưu đúng như in trên PDF và đánh dấu các dòng này; hãy đối chiếu với PDF gốc.`;
const REVIEW_WARNING = /^Có \d+ dòng có mã môn, ký hiệu hoặc ô khác dạng thường gặp\./;

/**
 * Older cohorts' pass rules differ from the later ones, so some printed results disagree with the letter and are still
 * right; the OCR worker's result_conflicts_with_grade is no error there:
 * - "Đạt" with 4,0 or more, whatever the letter (user, 2026-10-25: "khóa trước chỉ có 4đ thôi là đạt"; 4,1 · F · Đạt);
 * - any printed result with a D or D+ letter (user, 2026-11-10, a K25 transcript with 4,3 · D · Không đạt next to
 *   4,5 · D · Đạt: "các tính toán khác mấy khóa sau tí nhưng mà không có lỗi đâu xóa thông báo đó đi").
 * The printed result already decides the outcome on every page (attemptOutcome), so only the review mark goes.
 */
export const OLD_PASS_SCORE_10 = 4;
const BORDER_LETTERS = new Set(["D", "D+"]);
export const isSettledResultConflict = (course: { result: string | null; score10: number | null; letter?: string | null }) => {
  const result = (course.result ?? "").normalize("NFC").trim().toLowerCase();
  if (/^(đạt|không đạt)\b/.test(result) && BORDER_LETTERS.has((course.letter ?? "").trim().toUpperCase())) return true;
  return /^đạt\b/.test(result) && course.score10 !== null && course.score10 >= OLD_PASS_SCORE_10;
};

/**
 * A VT/CT/DC row stored before its mark was known (CT 2026-10-26, DC 2026-11-09): no score, and the mark (or nothing) in
 * its printed score cells, which were read as "not a number" and the mark as unknown.
 */
const isNoScoreRow = (course: TranscriptCourse) => course.letter !== null && NO_SCORE_LETTERS.includes(course.letter)
  && course.score10 === null && course.score4 === null
  && [course.printed?.score10, course.printed?.score4].every((cell) => cell === undefined || cell === course.letter);
const NO_SCORE_REVIEW = ["invalid_score_10", "invalid_score_4", "incomplete_scores", "unrecognized_letter_grade"];

/**
 * A stored transcript read as if uploaded now: without the review marks that are not errors (Đạt with 4,0 or more,
 * isSettledResultConflict; a VT/CT/DC row, isNoScoreRow, whose printed mark goes too), its review warning recounted.
 */
export function withoutSettledReviews(data: TranscriptData): TranscriptData {
  let changed = false;
  const sections = data.sections.map((section) => ({ ...section, courses: section.courses.map((course): TranscriptCourse => {
    if (!course.review?.length) return course;
    const noScore = isNoScoreRow(course);
    const settled = new Set([...(isSettledResultConflict(course) ? ["result_conflicts_with_grade"] : []), ...(noScore ? NO_SCORE_REVIEW : [])]);
    if (!course.review.some((code) => settled.has(code))) return course;
    changed = true;
    const { review, printed, ...rest } = course;
    const left = review.filter((code) => !settled.has(code));
    let kept = printed;
    if (noScore && printed) { kept = { ...printed }; delete kept.score10; delete kept.score4; }
    return { ...rest, ...(left.length ? { review: left } : {}), ...(kept && Object.keys(kept).length ? { printed: kept } : {}) };
  }) }));
  if (!changed) return data;
  const reviewed = sections.reduce((sum, section) => sum + section.courses.filter((course) => course.review?.length).length, 0);
  const warnings = data.warnings.flatMap((warning) => (REVIEW_WARNING.test(warning) ? (reviewed ? [reviewWarning(reviewed)] : []) : [warning]));
  return { ...data, sections, warnings };
}
export type TranscriptData = { schemaVersion: 1; parserVersion: "vlu-native-1" | "vlu-ocr-1.1"; pageCount: number; courseCount: number; sections: TranscriptSection[]; warnings: string[]; ocr?: { needsReview: boolean; pages: { page: number; method: string; warnings: string[] }[]; semesters: Record<string, unknown>[] } };
const clean = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const fold = (s: string) => clean(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d");
function join(items: Item[]) {
  let text = "", end = 0;
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    if (text && item.x - end > 1.2 && !text.endsWith(" ")) text += " ";
    text += item.text; end = item.x + item.width;
  }
  return clean(text);
}
function lines(items: Item[]) {
  const result: { y: number; items: Item[]; text: string }[] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = result[result.length - 1];
    if (!line || Math.abs(line.y - item.y) > 2) { line = { y: item.y, items: [], text: "" }; result.push(line); }
    line.items.push(item);
  }
  for (const line of result) line.text = join(line.items);
  return result;
}
/** A printed number up to max; "" is null and anything else is "bad" (kept as printed by the caller). */
function numeric(value: string, max: number): number | null | "bad" {
  if (!value) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) return "bad";
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n <= max ? n : "bad";
}

// PDF extraction runs off the API thread and is terminated after 25 seconds.
let extracting = false;
export async function parseTranscript(pdf: Buffer): Promise<TranscriptData> {
  if (extracting) throw new TranscriptError("parser_busy", 429);
  extracting = true;
  try {
    const pages = await new Promise<Page[]>((resolve, reject) => {
      const worker = new Worker(`
        const {parentPort,workerData}=require('node:worker_threads');
        (async()=>{
          const {getDocument}=await import(workerData.module);
          const task=getDocument({data:new Uint8Array(workerData.pdf),isEvalSupported:false,disableFontFace:true,verbosity:0});
          try {
            const doc=await task.promise;
            if(doc.numPages>20) throw new Error('too_many_pages');
            const pages=[];
            for(let n=1;n<=doc.numPages;n++){
              const page=await doc.getPage(n), viewport=page.getViewport({scale:1});
              const content=await page.getTextContent();
              if(content.items.length>20000) throw new Error('unsupported_pdf');
              const items=content.items.filter(i=>'str' in i && i.str).map(i=>{
                const [x,y]=viewport.convertToViewportPoint(i.transform[4],i.transform[5]);
                return {text:i.str,x:x/viewport.width*612,y:y/viewport.height*792,width:i.width/viewport.width*612};
              }).filter(i=>i.y>32&&i.y<757);
              pages.push({page:n,items});
            }
            parentPort.postMessage({pages});
          } finally {await task.destroy();}
        })().catch(e=>parentPort.postMessage({error:e.name==='PasswordException'?'encrypted_pdf':e.message==='too_many_pages'?'too_many_pages':'unsupported_pdf'}));
      `, { eval: true, execArgv: [], workerData: { pdf, module: import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs") }, resourceLimits: { maxOldGenerationSizeMb: 192 } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new TranscriptError("parse_timeout")); }, 25000);
      worker.once("message", (message: { pages?: Page[]; error?: string }) => { clearTimeout(timer); void worker.terminate(); if (message.pages) resolve(message.pages); else reject(new TranscriptError(message.error ?? "unsupported_pdf")); });
      worker.once("error", () => { clearTimeout(timer); reject(new TranscriptError("unsupported_pdf")); });
      worker.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new TranscriptError("unsupported_pdf")); });
    });
    return parsePages(pages);
  } finally { extracting = false; }
}

/**
 * A course code: the current format (71ITBS10103) or the old one that K26 courses and the GDTC courses of
 * K27/K28 still carry (DIT0070, DGT0010). With the old one missing, a K26–K28 transcript was refused whole.
 */
export const COURSE_CODE_PATTERN = /^(?:\d{2}[A-Z]{2,10}\d{5,8}|[A-Z]{3}\d{4})$/;
/** Rows of the PDF that are not numbered course rows; they are reported with the transcript, not saved. */
export const skippedRowsWarning = (rows: number) =>
  `Có ${rows} dòng trong PDF không đọc được thành dòng môn học (không có số thứ tự) nên chưa được lưu; hãy đối chiếu với PDF gốc.`;
/** A term heading the pages can place: consecutive years and HK01–HK03. */
export const usualTerm = (academicYear: string | null, semester: string | null) => {
  const years = /^(\d{4})-(\d{4})$/.exec(academicYear ?? "");
  return Boolean(years && Number(years[2]) === Number(years[1]) + 1 && /^HK0[1-3]$/.test(semester ?? ""));
};

/**
 * Reads the VLU transcript. Only the frame can refuse it (no text layer, no 8-column header, no course row): since
 * 2026-10-23 every numbered row inside is kept as printed, and what does not fit a known form is marked for review
 * (TranscriptCourse.review) instead of refusing the whole transcript.
 */
export function parsePages(pages: Page[]): TranscriptData {
  const sections: TranscriptSection[] = [];
  let active: TranscriptSection | undefined;
  let count = 0, reviewed = 0, skipped = 0;
  if (pages.some(page => !page.items.some(item => clean(item.text)))) throw new TranscriptError("scanned_pdf");
  // The portal's "Xem điểm theo CTĐT" table (its column "Môn tương đương"), on any page: a full-page print puts the
  // portal menu first. It is refused by name (user 2026-11-05: "không hỗ trợ định dạng Xem điểm theo CTĐT").
  if (pages.some(page => fold(lines(page.items).map(l => l.text).join(" ")).includes("mon tuong duong"))) throw new TranscriptError("curriculum_view");
  const firstText = fold(lines(pages[0]?.items ?? []).map(l => l.text).join(" "));
  if (!["ma mon hoc", "ten mon hoc", "tin chi", "he 10", "he 4"].every(t => firstText.includes(t))) throw new TranscriptError("unsupported_layout");
  for (const page of pages) {
    const pageLines = lines(page.items);
    if (!pageLines.length) throw new TranscriptError("scanned_pdf");
    // A course row is a line numbered in the STT column, whatever its code looks like. A known code on a line
    // without a number is reported (skippedRowsWarning), not guessed.
    const numbered = pageLines.filter(l => /^\d+$/.test(join(l.items.filter(i => i.x >= 28 && i.x < 61))));
    skipped += pageLines.filter(l => !numbered.includes(l) && l.items.some(i => COURSE_CODE_PATTERN.test(clean(i.text)) && i.x > 60 && i.x < 155)).length;
    const heading = (l: { text: string }) => /\d{4}\s*-\s*\d{4}.*HK\s*\d+/i.test(l.text) || fold(l.text).includes("diem bao luu");
    const events = pageLines.filter(l => numbered.includes(l) || heading(l) || l.text.startsWith("-"));
    for (let index = 0; index < events.length; index++) {
      const line = events[index]!;
      const context = numbered.includes(line) ? null : line.text.match(/(\d{4})\s*-\s*(\d{4}).*HK\s*(\d+)/i);
      if (context || (!numbered.includes(line) && heading(line))) {
        const academicYear = context ? `${context[1]}-${context[2]}` : null;
        const semester = context ? `HK${context[3]!.padStart(2, "0")}` : null;
        const id = context ? `${academicYear}-${semester}` : "transfer";
        active = sections.find(s => s.id === id);
        if (!active) { active = { id, academicYear, semester, label: context ? `${academicYear} · ${semester}` : "Điểm bảo lưu", courses: [], summaries: [] }; sections.push(active); }
        continue;
      }
      if (line.text.startsWith("-")) {
        if (active) for (const segment of [line.items.filter(i => i.x < 384), line.items.filter(i => i.x >= 384)]) {
          const raw = join(segment).replace(/^-\s*/, ""); const colon = raw.indexOf(":");
          if (raw && colon >= 0) active.summaries.push({ label: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() || null });
        }
        continue;
      }
      const top = Math.max(line.y - 24, index ? (events[index - 1]!.y + line.y) / 2 : 32);
      const bottom = Math.min(line.y + 24, index + 1 < events.length ? (events[index + 1]!.y + line.y) / 2 : 757);
      const rowItems = page.items.filter(i => i.y > top && i.y < bottom);
      const bounds = [28, 61, 156, 323, 384, 424, 464, 528, 585];
      const cells = bounds.slice(0, -1).map((left, col) => lines(rowItems.filter(i => i.x >= left && i.x < bounds[col + 1]!)).map(l => l.text).join(" ").trim());
      // A number with neither a code nor a name (a page number, a stray digit) is not a course row.
      if (!cells[1] && !cells[2]) { skipped++; continue; }
      const review: string[] = [], printed: NonNullable<TranscriptCourse["printed"]> = {};
      if (!active) {
        active = sections.find(s => s.id === UNKNOWN_TERM_SECTION.id);
        if (!active) { active = { ...UNKNOWN_TERM_SECTION, courses: [], summaries: [] }; sections.push(active); }
      }
      if (active.id === UNKNOWN_TERM_SECTION.id) review.push("missing_semester_context");
      else if (active.academicYear !== null && !usualTerm(active.academicYear, active.semester)) review.push("unusual_term");
      if (!cells[1]) review.push("missing_course_code"); else if (!COURSE_CODE_PATTERN.test(cells[1])) review.push("invalid_course_code");
      if (!cells[2]) review.push("missing_course_name");
      if (cells.some(c => c.includes("\ufffd"))) review.push("unreadable_characters");
      const credits = numeric(cells[3]!, 30);
      const wholeCredits = typeof credits === "number" && Number.isInteger(credits);
      if (!wholeCredits) { review.push(credits === null ? "missing_credits" : "invalid_credits"); printed.credits = cells[3]!; }
      const letter = cells[6] || null;
      // VT, CT and DC fill the score columns too: a failed attempt without a score.
      const noScore = letter !== null && NO_SCORE_LETTERS.includes(letter), blank = (cell: string) => noScore && (cell === "" || cell === letter);
      const score = (cell: string, max: number, field: "score10" | "score4") => {
        if (blank(cell)) return null;
        const value = numeric(cell, max);
        if (value !== "bad") return value;
        review.push(field === "score10" ? "invalid_score_10" : "invalid_score_4");
        printed[field] = cell;
        return null;
      };
      const score10 = score(cells[4]!, 10, "score10"), score4 = score(cells[5]!, 4, "score4");
      if (letter && !KNOWN_LETTER.test(letter)) review.push("unrecognized_letter_grade");
      if ((score10 === null) !== (score4 === null)) review.push("incomplete_scores");
      if (active.courses.some(c => c.ordinal === Number(cells[0]))) review.push("duplicate_row");
      const course: TranscriptCourse = { ordinal: Number(cells[0]), code: cells[1]!, name: cells[2]!, credits: wholeCredits ? credits : 0, score10, score4, letter, result: cells[7] || null, conditional: cells[2]!.includes("*"), sourcePage: page.page };
      if (review.length) { course.review = review; reviewed++; }
      if (Object.keys(printed).length) course.printed = printed;
      active.courses.push(course);
      count++;
    }
  }
  if (!count) throw new TranscriptError("unsupported_layout");
  if (count > 1000) throw new TranscriptError("unreadable_rows");
  const warnings = ["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh.", "Ô Kết quả chỉ có biểu tượng (không có chữ) được xem là trống; khi ô Kết quả trống, Đạt/Không đạt được xác định theo điểm chữ chính thức: A+ đến D là Đạt, F, VT và CT là Không đạt."];
  if (reviewed) warnings.push(reviewWarning(reviewed));
  if (skipped) warnings.push(skippedRowsWarning(skipped));
  return { schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: pages.length, courseCount: count, sections: sections.filter(s => s.courses.length), warnings };
}
