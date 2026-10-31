// The student's transcript in Trợ lý AI (assistant-v4, 2026-10-29). User, 2026-10-29, after the assistant answered "Mình
// không có thông tin về điểm tổng (GPA)": "giữ nguyên json bảng điểm luôn và lấy thêm thông tin từ nó nữa để sinh viên có
// thể tra cứu". The stored parsed_data of student_transcripts (never the PDF), read as the student pages show it
// (withoutSettledReviews, in facts.ts), becomes the lines of the source "Bảng điểm của bạn":
// - always a short summary: the cumulative lines printed at the end of the latest graded term (GPA on both scales,
//   accumulated credits, classification), the courses being studied, the number of courses and the courses not passed;
// - the rows of the courses (code or name) and the terms the question names;
// - for a grade question that names neither, the whole transcript, one short line per row, grouped by term with the
//   term's printed summaries.
// Scores and summaries are copied as printed, never recomputed: the GPA of the transcript is the school's. The printed
// result decides Đạt/Không đạt (course-state.ts attemptOutcome, the rule of the student pages: MT passes, VT and CT fail
// without a score, a blank result cell follows the letter). A course is passed once any attempt passes, also an attempt
// under another code with the same name (a retake with a later cohort, which comp-calc-v17 counts the same way).
import { formatNumber, sanitizeText } from "../competency-assessment/ai/prompt.js";
import { termName as calendarTerm } from "../term-name.js";
import { academicSections, attemptOutcome, courseKey, latestResultSection, termCode } from "../competency-assessment/course-state.js";
import { fold } from "../competency-assessment/specialty.js";
import { NO_SCORE_LETTERS, type TranscriptCourse, type TranscriptData, type TranscriptSection } from "../student/transcript-parser.js";
import type { AssistantIntent } from "./intent.js";
import { decimalComma } from "./validate.js";

/**
 * Rows of the whole transcript in one prompt (a transcript has about 40–70); past it the oldest terms are left out. 40 rows
 * with their term summaries took the prompt to 7–9k tokens on 2026-10-29, so 80 keeps room in the 16k context for the
 * thinking and the answer.
 */
export const MAX_TRANSCRIPT_ROWS = 80;
/** Course names listed in the "đang học" line of the summary. */
const MAX_RUNNING_NAMES = 12;
/** Printed summaries per line, so a line stays well under the source line limit. */
const SUMMARIES_PER_LINE = 6;

/** One printed row with its term; order: its place in the stored transcript. */
export type TranscriptAttempt = { section: TranscriptSection; course: TranscriptCourse; order: number };
type Row = TranscriptAttempt;
type Outcome = "pass" | "fail" | "unknown" | "pending";
export type TranscriptCourseState = "passed" | "unknown" | "in_progress" | "failed";
type CourseState = TranscriptCourseState;
/** One course of the transcript: every attempt under its code, and under other codes with the same name (a retake). */
export type TranscriptCourseGroup = { codes: string[]; names: string[]; rows: TranscriptAttempt[]; state: TranscriptCourseState };

/* ------------------------------------------------------------------------ */
/* Rows and courses */

/** A row with a score, a letter or a result; without them it is a registration of a term being studied. */
const isGraded = (course: TranscriptCourse) =>
  course.score10 !== null || course.score4 !== null || Boolean(course.letter?.trim()) || Boolean(course.result?.trim());
const outcomeOf = (course: TranscriptCourse): Outcome => (isGraded(course) ? attemptOutcome(course.result, course.letter).outcome : "pending");
const letterOf = (course: TranscriptCourse) => course.letter?.trim().toUpperCase() ?? "";
const isNoScore = (course: TranscriptCourse) => NO_SCORE_LETTERS.includes(letterOf(course)) && course.score10 === null && course.score4 === null;

/** A course name for matching, without its (*) mark, marks and punctuation; numbers kept ("Anh văn 1" is not "Anh văn 2"). */
export const courseNameKey = (name: string) => fold(name.replace(/\(\s*\*\s*\)|\*/g, " ")).replace(/[^a-z0-9]+/g, " ").trim();
/** The printed name without its (*) mark (the line says "môn điều kiện" instead). */
const printedName = (course: TranscriptCourse) => sanitizeText((course.name ?? "").replace(/\s*\(\s*\*\s*\)|\s*\*/g, " "), 120) || "(không có tên)";

/** MT or a pass on any attempt, then a graded attempt with an unreadable result, a registration, else failed (course-state.ts courseState). */
function stateOf(rows: readonly Row[]): CourseState {
  const outcomes = rows.map((row) => outcomeOf(row.course));
  if (outcomes.includes("pass")) return "passed";
  if (outcomes.includes("unknown")) return "unknown";
  if (outcomes.includes("pending")) return "in_progress";
  return "failed";
}

/** Terms in time order: "Điểm bảo lưu" and rows without a term first, then HKyyS. */
const timeKey = (section: TranscriptSection) => termCode(section) ?? "";

/**
 * The courses of a transcript: rows grouped by code, attempts in time order. Courses that share a name (courseNameKey,
 * two words or more) are one course when one of them is not passed and another one is passed or being studied: the
 * student retook it under another code (K26 failed DIT0070 Cơ sở dữ liệu and passed it as 71ITIS30103).
 */
export function transcriptCourseGroups(data: TranscriptData): TranscriptCourseGroup[] {
  const byCode = new Map<string, Row[]>();
  let order = 0;
  for (const section of data.sections) {
    for (const course of section.courses) {
      const code = courseKey(course.code ?? "");
      const key = code || `#${courseNameKey(course.name ?? "")}#${order}`;
      byCode.set(key, [...(byCode.get(key) ?? []), { section, course, order: order++ }]);
    }
  }
  const groups = [...byCode.values()].map((rows) => group(rows));
  const byName = new Map<string, TranscriptCourseGroup[]>();
  for (const item of groups) {
    for (const name of new Set(item.rows.map((row) => courseNameKey(row.course.name ?? "")))) {
      if (name.includes(" ")) byName.set(name, [...(byName.get(name) ?? []), item]);
    }
  }
  const merged = new Set<TranscriptCourseGroup>();
  const result: TranscriptCourseGroup[] = [];
  for (const item of groups) {
    if (merged.has(item)) continue;
    const name = courseNameKey(item.rows.at(-1)!.course.name ?? "");
    const same = (byName.get(name) ?? []).filter((other) => !merged.has(other));
    const retaken = same.length > 1 && same.some((other) => other.state === "failed" || other.state === "unknown")
      && same.some((other) => other.state === "passed" || other.state === "in_progress");
    if (!retaken) { result.push(item); continue; }
    for (const other of same) merged.add(other);
    result.push(group(same.flatMap((other) => other.rows)));
  }
  return result;
}

function group(rows: Row[]): TranscriptCourseGroup {
  const sorted = [...rows].sort((a, b) => timeKey(a.section).localeCompare(timeKey(b.section)) || a.order - b.order);
  const codes = [...new Set(sorted.map((row) => courseKey(row.course.code ?? "")).filter(Boolean))];
  const names = [...new Set(sorted.map((row) => printedName(row.course)))];
  return { codes, names, rows: sorted, state: stateOf(sorted) };
}

/* ------------------------------------------------------------------------ */
/* Text */

/** "HK1 2024–2025" like the pages (assistant-v7), or the printed label of a section without a usual term ("Điểm bảo lưu"). */
function termName(section: TranscriptSection): string {
  const code = termCode(section);
  return code ? calendarTerm(code) : sanitizeText(section.label, 60) || "phần chưa rõ học kỳ";
}
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const where = (section: TranscriptSection) => (termCode(section) ? termName(section) : `phần ${termName(section)}`);

const credits = (course: TranscriptCourse) =>
  `${course.printed?.credits !== undefined ? sanitizeText(course.printed.credits, 10) || "?" : formatNumber(course.credits)} TC${course.conditional ? ", môn điều kiện" : ""}`;

/** The scores of a row as printed: "8,6 điểm hệ 10, 3,7 hệ 4, điểm chữ A"; VT and CT without a score; MT. */
function gradeText(course: TranscriptCourse): string {
  if (!isGraded(course)) return "đang học, chưa có điểm";
  const letter = letterOf(course);
  if (letter === "MT") return "MT (miễn thi, công nhận)";
  if (isNoScore(course)) return `${letter} (${letter === "VT" ? "vắng thi" : "cấm thi"}, không có điểm)`;
  // A printed score keeps its digits but takes the decimal comma of the pages (assistant-v7: it answered "2.45").
  const score10 = course.score10 !== null ? formatNumber(course.score10) : course.printed?.score10 ? decimalComma(sanitizeText(course.printed.score10, 10)) : "";
  const score4 = course.score4 !== null ? formatNumber(course.score4) : course.printed?.score4 ? decimalComma(sanitizeText(course.printed.score4, 10)) : "";
  const parts = [score10 && `${score10} điểm hệ 10`, score4 && `${score4} hệ 4`, letter && `điểm chữ ${sanitizeText(letter, 8)}`].filter(Boolean);
  return parts.join(", ") || "có kết quả, không có điểm";
}

/** Đạt / Không đạt as decided by the printed result (else the letter); an unreadable printed result is quoted. */
function outcomeText(course: TranscriptCourse): string {
  const outcome = outcomeOf(course);
  if (outcome === "pending") return "";
  if (outcome === "pass") return "Đạt";
  if (outcome === "fail") return "Không đạt";
  return course.result?.trim() ? `kết quả in "${sanitizeText(course.result, 20)}" chưa rõ đạt hay không` : "chưa rõ kết quả";
}

/** One row with its scores and result; review: the row was marked for checking against the PDF. */
function rowDetails(course: TranscriptCourse): string {
  const outcome = outcomeText(course);
  return `${gradeText(course)}${outcome ? `, ${outcome}` : ""}${course.review?.length ? " (dòng này cần đối chiếu với PDF gốc)" : ""}`;
}
const rowLine = (course: TranscriptCourse) =>
  `- ${sanitizeText(course.code, 20) || "(không mã)"} ${printedName(course)} (${credits(course)}): ${rowDetails(course)}`;

/** A short attempt: "F (3 điểm hệ 10) ở HK1 2023–2024", "VT (vắng thi) ở …", "đạt C+ (6,6 điểm hệ 10) ở …". */
function attemptText(row: Row): string {
  const course = row.course;
  const letter = letterOf(course);
  const outcome = outcomeOf(course);
  const score = course.score10 !== null ? `${formatNumber(course.score10)} điểm hệ 10` : "";
  let text: string;
  if (outcome === "pending") text = "đang học";
  else if (letter === "MT") text = "MT (miễn thi, công nhận)";
  else if (isNoScore(course)) text = `${letter} (${letter === "VT" ? "vắng thi" : "cấm thi"})`;
  else {
    const mark = letter ? sanitizeText(letter, 8) : outcome === "pass" ? "Đạt" : outcome === "fail" ? "Không đạt" : "chưa rõ kết quả";
    text = `${outcome === "pass" && letter ? "đạt " : ""}${mark}${score ? ` (${score})` : ""}`;
  }
  return `${text} ở ${where(row.section)}`;
}

/** "Cơ sở dữ liệu (71ITIS30103)"; a retake under another code names both ("mã DIT0070, sau đó 71ITIS30103"). */
function courseTitle(item: TranscriptCourseGroup): string {
  const name = item.names.at(-1) ?? "(không có tên)";
  if (!item.codes.length) return name;
  return item.codes.length === 1 ? `${name} (${item.codes[0]})` : `${name} (mã ${item.codes.join(", sau đó ")})`;
}
const groupCredits = (item: TranscriptCourseGroup) => credits(item.rows.at(-1)!.course);

/** Printed summaries with a value, "label: value", a few per line. Only grade, credit and classification lines (never identity). */
function summaryLines(section: TranscriptSection, lead: string): string[] {
  const items = section.summaries
    .filter((summary) => summary.value?.trim() && /\b(diem|tin chi|tc|xep loai|hoc luc|ren luyen)\b/.test(fold(summary.label ?? "")))
    .map((summary) => `${sanitizeText(summary.label, 80)}: ${decimalComma(sanitizeText(summary.value, 60))}`);
  const lines: string[] = [];
  for (let at = 0; at < items.length; at += SUMMARIES_PER_LINE) {
    lines.push(`${at ? "Tổng kết (tiếp):" : lead} ${items.slice(at, at + SUMMARIES_PER_LINE).join("; ")}`);
  }
  return lines;
}

/** The rows of one term with its printed summaries. */
function sectionLines(section: TranscriptSection, suffix = ""): string[] {
  return [`${capitalized(termName(section))}${suffix} (${section.courses.length} dòng):`, ...section.courses.map(rowLine),
    ...summaryLines(section, "Tổng kết in trên bảng điểm:")];
}

/* ------------------------------------------------------------------------ */
/* The summary */

/** Cumulative lines ("… tích lũy …") printed at the end of the latest graded term, else of the newest term that has them. */
function cumulativeSection(data: TranscriptData): TranscriptSection | undefined {
  const hasCumulative = (section: TranscriptSection) => section.summaries.some((summary) => summary.value?.trim() && fold(summary.label ?? "").includes("tich luy"));
  const latest = latestResultSection(data);
  if (latest && hasCumulative(latest)) return latest;
  return [...academicSections(data)].reverse().find(hasCumulative);
}

export function transcriptSummaryLines(data: TranscriptData, groups: readonly TranscriptCourseGroup[]): string[] {
  const lines: string[] = [];
  const latest = latestResultSection(data);
  const graded = latest?.courses.some(isGraded) ? latest : undefined;
  lines.push(`Học kỳ gần nhất có điểm: ${graded ? termName(graded) : "bảng điểm chưa có học kỳ nào có điểm"}.`);
  const cumulative = cumulativeSection(data);
  if (cumulative) {
    // The running averages the term prints (assistant-v8, user 2026-10-31: "hãy xem cách tính của bảng điểm thật và học
    // theo"): the "tích lũy" lines (passed courses) and "Điểm TB học tập" with "Tổng số tín chỉ đăng ký" (every registered
    // credit, failed courses included).
    const runningFigure = (label: string) => label.includes("tich luy") || /diem\s*(?:tb|trung\s*binh)\s*hoc\s*tap/.test(label) || label.includes("tin chi dang ky");
    const items = cumulative.summaries.filter((summary) => summary.value?.trim() && runningFigure(fold(summary.label ?? "")))
      .map((summary) => `${sanitizeText(summary.label, 80)}: ${decimalComma(sanitizeText(summary.value, 60))}`);
    lines.push(`Tích lũy in trên bảng điểm ở cuối ${termName(cumulative)}${cumulative === graded ? "" : " (học kỳ gần nhất có in dòng tích lũy)"}: ${items.join("; ")}.`);
    lines.push("Điểm TB tích lũy là điểm trung bình chung tích lũy, tức GPA (điểm tổng) hiện tại của bạn, chỉ tính các môn đã đạt, hệ 4 và hệ 10 như in trên bảng điểm.");
    if (cumulative.summaries.some((summary) => summary.value?.trim() && /diem\s*(?:tb|trung\s*binh)\s*hoc\s*tap/.test(fold(summary.label ?? "")))) {
      lines.push("Điểm TB học tập tính mọi tín chỉ đã đăng ký, kể cả môn chưa đạt, nên thấp hơn Điểm TB tích lũy khi có môn rớt.");
    }
  } else {
    lines.push("Bảng điểm không in điểm trung bình tích lũy hay tổng số tín chỉ tích lũy.");
  }

  const running = groups.filter((item) => item.state === "in_progress");
  if (running.length) {
    const terms = [...new Set(running.map((item) => termName(item.rows.at(-1)!.section)))];
    const names = running.slice(0, MAX_RUNNING_NAMES).map(courseTitle);
    lines.push(`Đang học, chưa có điểm (${terms.join(", ")}): ${running.length} học phần: ${names.join("; ")}${running.length > names.length ? "; …" : ""}.`);
  }

  const rows = groups.reduce((sum, item) => sum + item.rows.length, 0);
  const count = (state: CourseState) => groups.filter((item) => item.state === state).length;
  const parts = [`đã đạt ${count("passed")}`, `chưa đạt ${count("failed")}`, ...(running.length ? [`đang học ${running.length}`] : []),
    ...(count("unknown") ? [`chưa rõ kết quả ${count("unknown")}`] : [])];
  lines.push(`Số học phần trên bảng điểm: ${groups.length} (${parts.join(", ")})${rows > groups.length ? `, trong ${rows} dòng vì có học phần học nhiều lần` : ""}.`);

  const failedRows = (item: TranscriptCourseGroup) => item.rows.filter((row) => outcomeOf(row.course) === "fail");
  const failed = groups.filter((item) => item.state === "failed");
  lines.push(failed.length ? "Học phần chưa đạt (chưa có lần học nào đạt, cần học lại):" : "Học phần chưa đạt: không có.");
  for (const item of failed) lines.push(`- ${courseTitle(item)}, ${groupCredits(item)}: ${item.rows.map(attemptText).join("; ")}`);
  const retaking = running.filter((item) => failedRows(item).length);
  if (retaking.length) lines.push("Học phần chưa đạt, đang học lại:");
  for (const item of retaking) lines.push(`- ${courseTitle(item)}, ${groupCredits(item)}: ${item.rows.map(attemptText).join("; ")}`);
  const unknown = groups.filter((item) => item.state === "unknown");
  if (unknown.length) lines.push("Học phần chưa rõ kết quả (hãy đối chiếu với PDF gốc):");
  for (const item of unknown) lines.push(`- ${courseTitle(item)}: ${item.rows.map((row) => `${rowDetails(row.course)} ở ${where(row.section)}`).join("; ")}`);
  const retaken = groups.filter((item) => item.state === "passed" && failedRows(item).length);
  if (retaken.length) lines.push("Học phần từng chưa đạt, đã học lại và đạt:");
  for (const item of retaken) lines.push(`- ${courseTitle(item)}: ${item.rows.map(attemptText).join("; ")}`);

  // Older cohorts passed from 4,0 (transcript-parser.ts OLD_PASS_SCORE_10): an F printed "Đạt" is a pass.
  if (groups.some((item) => item.rows.some((row) => letterOf(row.course) === "F" && outcomeOf(row.course) === "pass"))) {
    lines.push("Có dòng điểm chữ F nhưng ô Kết quả in Đạt (khóa trước đạt từ 4,0 điểm hệ 10): kết quả in trên bảng điểm được dùng.");
  }
  const reviewed = groups.reduce((sum, item) => sum + item.rows.filter((row) => row.course.review?.length).length, 0);
  if (reviewed || data.ocr?.needsReview) {
    const parts = [...(data.ocr?.needsReview ? ["được nhận dạng tự động"] : []), ...(reviewed ? [`có ${reviewed} dòng được đánh dấu cần kiểm tra`] : [])];
    lines.push(`Bảng điểm ${parts.join(" và ")}: nên đối chiếu các điểm này với PDF gốc.`);
  }
  return lines;
}

/* ------------------------------------------------------------------------ */
/* What the question names */

const CODE_IN_TEXT = /\b(?:\d{2}[A-Z]{2,10}\d{5,8}|[A-Z]{3}\d{4})\b/g;

/** Courses named by code or by full name (the longest name first, so "Hệ quản trị cơ sở dữ liệu" is not also "Cơ sở dữ liệu"). */
export function namedCourses(groups: readonly TranscriptCourseGroup[], question: string): { found: TranscriptCourseGroup[]; missingCodes: string[] } {
  const found = new Set<TranscriptCourseGroup>();
  const missingCodes: string[] = [];
  for (const code of new Set(question.toUpperCase().match(CODE_IN_TEXT) ?? [])) {
    const item = groups.find((candidate) => candidate.codes.includes(code));
    if (item) found.add(item); else missingCodes.push(code);
  }
  let text = ` ${fold(question).replace(/[^a-z0-9]+/g, " ").trim()} `;
  const names = groups.flatMap((item) => [...new Set(item.rows.map((row) => courseNameKey(row.course.name ?? "")))]
    .filter((name) => name.includes(" ")).map((name) => ({ item, name })))
    .sort((a, b) => b.name.length - a.name.length);
  for (const { item, name } of names) {
    if (!text.includes(` ${name} `)) continue;
    found.add(item);
    text = text.split(` ${name} `).join(" | ");
  }
  return { found: [...found], missingCodes };
}

const ORDINAL_YEARS: Record<string, number> = { nhat: 1, "1": 1, hai: 2, "2": 2, ba: 3, "3": 3, tu: 4, bon: 4, "4": 4 };

/**
 * Terms the question names: "học kỳ 1 năm 2024-2025", "HK1 2024-2025", "HK241", a year ("năm học 2024-2025"), "học kỳ
 * gần nhất / vừa rồi / trước", "học kỳ này / hiện tại" and "năm nhất … năm tư" (the n-th year on the transcript). A term
 * number alone ("học kỳ 1") or a single year ("năm 2024") counts only for a grade question (grades: true), being ambiguous.
 */
export function namedSections(data: TranscriptData, question: string, grades: boolean): TranscriptSection[] {
  const text = fold(question);
  const terms = academicSections(data);
  const picked = new Set<TranscriptSection>();
  const yearOf = (section: TranscriptSection) => section.academicYear ?? "";
  const semesterOf = (section: TranscriptSection) => Number((section.semester ?? "").replace(/\D/g, ""));

  for (const match of text.matchAll(/\bhk\s?(\d{2})([1-3])\b/g)) for (const section of terms) if (termCode(section) === `HK${match[1]}${match[2]}`) picked.add(section);

  const years = new Set<string>();
  for (const match of text.matchAll(/\b(20\d{2})\s*(?:-|–|—|\/|den|toi)\s*(20\d{2})\b/g)) years.add(`${match[1]}-${match[2]}`);
  // "năm 2024" alone may mean 2023-2024 or 2024-2025: both, and only for a grade question.
  const loose: string[] = [];
  if (grades) for (const match of text.matchAll(/\bnam(?: hoc)? (20\d{2})\b(?!\s*(?:-|–|—|\/|den|toi)\s*20\d{2})/g)) loose.push(match[1]!);
  const semesters = new Set<number>();
  for (const match of text.matchAll(/\b(?:hoc ky|hk|ky)\s*([1-3](?:\s*(?:,|va|hoac)\s*[1-3])*)\b/g)) for (const digit of match[1]!.match(/[1-3]/g) ?? []) semesters.add(Number(digit));
  for (const match of text.matchAll(/\bhoc ky (iii|ii|i)\b/g)) semesters.add(match[1]!.length);
  const ordinal = /\bnam (nhat|hai|ba|tu|bon|[1-4])\b(?!\s*\d)/.exec(text);
  const yearList = [...new Set(terms.map(yearOf))];
  const ordinalYear = ordinal && /\b(hoc ky|ky [1-3]|hk|mon|diem|hoc phan|tin chi)\b/.test(text) ? yearList[ORDINAL_YEARS[ordinal[1]!]! - 1] : undefined;

  const inYear = (section: TranscriptSection) =>
    years.has(yearOf(section)) || loose.some((year) => yearOf(section).startsWith(year) || yearOf(section).endsWith(year)) || yearOf(section) === ordinalYear;
  const hasYear = years.size > 0 || loose.length > 0 || ordinalYear !== undefined;
  for (const section of terms) {
    const semesterFits = !semesters.size || semesters.has(semesterOf(section));
    if (hasYear ? inYear(section) && semesterFits : semesters.size > 0 && grades && semesterFits) picked.add(section);
  }

  const latest = latestResultSection(data);
  if (latest && /\b(?:hoc ky|ky|hk) (?:gan (?:day )?nhat|vua (?:roi|qua|xong)|truoc|moi nhat|cuoi cung)\b/.test(text)) picked.add(latest);
  if (/\b(?:hoc ky|ky|hk) (?:nay|hien tai|dang hoc)\b/.test(text)) {
    const running = [...terms].reverse().find((section) => section.courses.some((course) => !isGraded(course)));
    if (running) picked.add(running);
    if (latest) picked.add(latest);
  }
  return terms.filter((section) => picked.has(section));
}

/* ------------------------------------------------------------------------ */
/* The source */

/** The whole transcript, newest terms kept first when it is longer than MAX_TRANSCRIPT_ROWS. */
function wholeTranscript(data: TranscriptData): string[] {
  const ordered = [...data.sections].sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
  const kept = new Set<TranscriptSection>();
  let rows = 0;
  for (const section of [...ordered].reverse()) {
    if (rows + section.courses.length > MAX_TRANSCRIPT_ROWS && kept.size) break;
    kept.add(section);
    rows += section.courses.length;
  }
  const lines = ["Toàn bộ bảng điểm theo học kỳ (mỗi dòng: mã, tên học phần (tín chỉ): điểm hệ 10, hệ 4, điểm chữ, kết quả):"];
  const left = ordered.filter((section) => !kept.has(section));
  if (left.length) lines.push(`(Không đưa vào ${left.reduce((sum, section) => sum + section.courses.length, 0)} dòng của các học kỳ cũ hơn: ${left.map(termName).join(", ")}; hãy hỏi theo học kỳ hoặc tên học phần.)`);
  for (const section of ordered) if (kept.has(section)) lines.push(...sectionLines(section));
  return lines;
}

/**
 * The text of the source "Bảng điểm của bạn": the summary; then the rows of the courses and terms the question names; or,
 * for a grade question (intent "transcript") that names none, the whole transcript.
 */
export function transcriptLines(data: TranscriptData, input: { question: string; intents: readonly AssistantIntent[]; updated: string }): string[] {
  const groups = transcriptCourseGroups(data);
  const grades = input.intents.includes("transcript");
  const lines = [
    `Bảng điểm PDF bạn tải lên, cập nhật ngày ${input.updated}. Điểm, tín chỉ và các dòng tổng kết chép đúng như in trên bảng điểm; Đạt hay Không đạt theo ô Kết quả in trên bảng điểm (ô trống thì theo điểm chữ: A+ đến D là Đạt; F, VT vắng thi, CT cấm thi là Không đạt; MT miễn thi là Đạt).`,
    ...transcriptSummaryLines(data, groups),
  ];
  const courses = namedCourses(groups, input.question);
  const sections = namedSections(data, input.question, grades);
  for (const item of courses.found) {
    const state = item.state === "passed" ? "đã đạt" : item.state === "failed" ? "chưa đạt"
      : item.state === "in_progress" ? (item.rows.some((row) => outcomeOf(row.course) === "fail") ? "chưa đạt, đang học lại" : "đang học") : "chưa rõ kết quả";
    lines.push(`Học phần bạn hỏi: ${courseTitle(item)}, ${groupCredits(item)}: ${state}.`);
    for (const row of item.rows) lines.push(`- ${capitalized(where(row.section))}: ${row.course.code && item.codes.length > 1 ? `mã ${sanitizeText(row.course.code, 20)}, ` : ""}${rowDetails(row.course)}`);
  }
  for (const code of courses.missingCodes) lines.push(`Bảng điểm không có học phần mã ${sanitizeText(code, 20)}.`);
  for (const section of sections) lines.push(...sectionLines(section, " (học kỳ bạn hỏi)"));
  if (grades && !courses.found.length && !sections.length) lines.push(...wholeTranscript(data));
  return lines;
}
