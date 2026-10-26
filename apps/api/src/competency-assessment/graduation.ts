import type { GraduationData } from "../graduation/model.js";
import { NO_SCORE_LETTERS, type TranscriptData } from "../student/transcript-parser.js";
import {
  conditionOnlyCodes, courseKey, curriculumCreditMap, deriveElectiveGroups, estimateProgramCredits, isConditionOnly, isPassedState,
  latestResultSection, printedCumulativeCredits, printedSummaryNumber, transcriptCourses, uniqueCurriculumCourses,
  type Attempt, type ElectiveGroup, type TranscriptCourseRecord,
} from "./course-state.js";
import { fold } from "./specialty.js";
import type {
  CurriculumCourseInput, GraduationCredits, GraduationGpa, GraduationGroupCheck, GraduationResolution, GraduationStandardInput,
  GraduationSummary, TriState,
} from "./types.js";

// The one graduation engine (comp-calc-v5): the competency assessment (calculate.ts) and the
// student graduation page (graduation/evaluation.ts) both call assessGraduationStandard with
// inputs built the same way, so both show the same groups, credits and GPA.

type StandardGroup = GraduationData["groups"][number];
type StandardCourse = GraduationData["courses"][number];

const GRADUATION_STATUS_LABELS: Record<TriState, string> = {
  pass: "Đạt các điều kiện (tham khảo)",
  fail: "Chưa đủ điều kiện",
  unknown: "Chưa xác định",
};

const UNRESOLVED_REASONS: Record<GraduationResolution, string> = {
  specialty: "Chưa có tiêu chuẩn xét tốt nghiệp phù hợp với chuyên ngành của bạn.",
  general: "Chưa có tiêu chuẩn xét tốt nghiệp chung cho khóa của bạn.",
  specialty_unset: "Khóa của bạn có tiêu chuẩn xét tốt nghiệp riêng cho từng chuyên ngành. Hãy chọn chuyên ngành trong hồ sơ để đối chiếu.",
  not_found: "Chưa có tiêu chuẩn xét tốt nghiệp đang áp dụng cho khóa và chuyên ngành của bạn.",
  ambiguous: "Có nhiều tiêu chuẩn xét tốt nghiệp cùng phù hợp nên chưa chọn được tiêu chuẩn để đối chiếu.",
};

/** Overlap of two code lists: accepted when each side shares at least half of its codes. */
function overlap(a: readonly string[], b: readonly string[]): { shared: number; difference: number } | null {
  const left = new Set(a.map(courseKey)), right = new Set(b.map(courseKey));
  const shared = [...left].filter((code) => right.has(code)).length;
  if (!shared || shared * 2 < left.size || shared * 2 < right.size) return null;
  return { shared, difference: left.size + right.size - 2 * shared };
}

const standardGroupCodes = (standard: Pick<GraduationData, "courses">, groupId: string) =>
  standard.courses.filter((course) => course.groupId === groupId).map((course) => courseKey(course.code));

/** Standard elective group with the same courses as a CTĐT elective group (TC309 ≡ TC209), matched by codes, never by name. */
export function matchStandardElectiveGroup(courseCodes: readonly string[], standard: Pick<GraduationData, "groups" | "courses"> | null): StandardGroup | null {
  let best: { group: StandardGroup; shared: number; difference: number } | null = null;
  for (const group of standard?.groups ?? []) {
    if (group.kind !== "elective") continue;
    const match = overlap(courseCodes, standardGroupCodes(standard!, group.id));
    if (match && (!best || match.shared > best.shared || (match.shared === best.shared && match.difference < best.difference))) best = { group, ...match };
  }
  return best?.group ?? null;
}

/** CTĐT elective code of a standard group (the inverse match). */
function matchCurriculumElective(group: StandardGroup, standard: Pick<GraduationData, "courses">, electives: readonly ElectiveGroup[]): string | null {
  const codes = standardGroupCodes(standard, group.id);
  let best: { code: string; shared: number; difference: number } | null = null;
  for (const elective of electives) {
    const match = overlap(codes, elective.courseCodes);
    if (match && (!best || match.shared > best.shared || (match.shared === best.shared && match.difference < best.difference))) best = { code: elective.code, ...match };
  }
  return best?.code ?? null;
}

export type ElectiveQuota = {
  code: string;
  courseCodes: string[];
  /** Credits the student must choose in this group, or null when unknown. */
  quota: number | null;
  source: "standard" | "curriculum" | null;
};

/** Quota per CTĐT elective group: standard minimumCredits by course membership, else "(n TC)" in the CTĐT, else null. */
export function electiveQuotas(electives: readonly ElectiveGroup[], standard: Pick<GraduationData, "groups" | "courses"> | null): Map<string, ElectiveQuota> {
  const quotas = new Map<string, ElectiveQuota>();
  for (const elective of electives) {
    const fromStandard = matchStandardElectiveGroup(elective.courseCodes, standard)?.minimumCredits ?? null;
    quotas.set(elective.code, {
      code: elective.code, courseCodes: elective.courseCodes,
      quota: fromStandard ?? elective.requiredCredits,
      source: fromStandard !== null ? "standard" : elective.requiredCredits !== null ? "curriculum" : null,
    });
  }
  return quotas;
}

/** E1: the group code written in a group name ("Nhóm tự chọn TC306" → "TC306"), else null. */
export const groupCode = (name: string): string | null => /\bTC\d{3}\b/i.exec(name)?.[0]?.toUpperCase() ?? null;

/** "Nhóm tự chọn TC124 và nhóm tự chọn TC206": one group the source file names after two codes. */
const COMBINED_GROUP = /\b(TC\d{3})\s+và\s+(?:nhóm\s+)?(?:tự\s+chọn\s+)?(TC\d{3})\b/iu;

/**
 * A standard group name as a student reads it (audit 2026-10-25): the source files write "TC104 (4TC)_Tự chọn giáo dục
 * thể chất", "TC533(27TC)-Tự chọn chuyên ngành" or "TC124 và nhóm tự chọn TC206", and these names reach the verdict
 * sentence and the advice input. The credit note "(4TC)" goes (the requirement is shown on its own), a "_" or a "-"
 * after the code becomes " – ", and a group named after two codes reads "TC124 + TC206". Codes stay as written.
 * Mirrored in apps/web/src/student-graduation-data.ts (readableGroupName).
 */
export function readableGroupName(name: string): string {
  let text = name.normalize("NFC")
    .replace(/\s*\(\s*\d+(?:[.,]\d+)?\s*TC\s*\)/giu, " ")
    .replace(/\s*_+\s*/g, " – ")
    .replace(/\b(TC\d{3})\s*-\s*/giu, "$1 – ")
    .replace(/\s+[-–—]\s+/g, " – ");
  while (COMBINED_GROUP.test(text)) text = text.replace(COMBINED_GROUP, "$1 + $2");
  return text.replace(/\s+/g, " ").replace(/^[\s–-]+|[\s–-]+$/g, "");
}

/**
 * E1: display label per group id: the readable name (readableGroupName). Groups are matched by their member courses,
 * never by name, and a name can repeat (K29 CNDL has two "Nhóm tự chọn TC102"), so a repeated name shows its course
 * count and first code in standard order, exactly as the old web helper did; a unique name stays as it reads.
 */
export function graduationGroupLabels(standard: Pick<GraduationData, "groups" | "courses">): Map<string, string> {
  const readable = new Map(standard.groups.map((group) => [group.id, readableGroupName(group.name)]));
  const names = new Map<string, number>();
  for (const name of readable.values()) names.set(name, (names.get(name) ?? 0) + 1);
  return new Map(standard.groups.map((group) => {
    const name = readable.get(group.id)!;
    if ((names.get(name) ?? 0) < 2) return [group.id, name];
    const codes = standardGroupCodes(standard, group.id);
    return [group.id, `${name} · ${codes.length} học phần${codes[0] ? `, trong đó có ${codes[0]}` : ""}`];
  }));
}

/** A standard whose course codes cannot be matched one-to-one (none, blank or repeated codes, or a course without its group). */
export function standardCodesAmbiguous(standard: Pick<GraduationData, "groups" | "courses">): boolean {
  const codes = standard.courses.map((course) => courseKey(course.code));
  return !codes.length || new Set(codes).size !== codes.length || codes.some((code) => !code) ||
    standard.courses.some((course) => !standard.groups.some((group) => group.id === course.groupId));
}

/**
 * E4 program: every code of the standard or of the CTĐT with its credit — the standard's credit,
 * else the CTĐT credit, else null (still in the program). A repeated standard code keeps its first
 * known credit. `curriculumCredits` is keyed by courseKey (curriculumCreditMap).
 */
export function programCreditMap(standard: Pick<GraduationData, "courses"> | null, curriculumCredits: ReadonlyMap<string, number>): Map<string, number | null> {
  const program = new Map<string, number | null>(curriculumCredits);
  const standardCredits = new Map<string, number | null>();
  for (const course of standard?.courses ?? []) {
    const code = courseKey(course.code);
    if (code && (standardCredits.get(code) ?? null) === null) standardCredits.set(code, course.credits);
  }
  for (const [code, credits] of standardCredits) program.set(code, credits ?? curriculumCredits.get(code) ?? null);
  return program;
}

/** E3: credits of a standard course — standard → CTĐT (program map) → transcript credit of the selected attempt (> 0) → null. */
export function standardCourseCredits(
  course: Pick<StandardCourse, "code" | "credits">,
  programCredits: ReadonlyMap<string, number | null>,
  record: TranscriptCourseRecord | undefined,
): number | null {
  const transcriptCredits = record && record.selected.credits > 0 ? record.selected.credits : null;
  return course.credits ?? programCredits.get(courseKey(course.code)) ?? transcriptCredits;
}

/** Everything the graduation core reads besides the standard; built once per caller with graduationInputs. */
export type GraduationInputs = {
  transcript: TranscriptData;
  records: ReadonlyMap<string, TranscriptCourseRecord>;
  /** programCreditMap: standard ∪ CTĐT codes with their credits. */
  programCredits: ReadonlyMap<string, number | null>;
  /** CTĐT elective groups (curriculumElectiveCode). */
  electives: readonly ElectiveGroup[];
  conditionCodes: ReadonlySet<string>;
  /** Standard courses counted as passed through a same-name course under another code (graduationCodeAliases). */
  transfers: CreditTransfer[];
  /** Every transcript code → standard code the records were built with (graduationCodeAliases); absent = none. */
  aliases?: ReadonlyMap<string, string>;
  /** Standard 71PE electives filled by a passed GDTC course of the student's own programme (graduationCodeAliases); absent = none. */
  substitutes?: CreditTransfer[];
};

/**
 * A standard course passed only under another code with the same name: a retake with a later cohort
 * ("học trả nợ với khóa sau"). It counts as passed, but the school still lists the course as owed until
 * the student has the grade transferred ("làm thủ tục chuyển điểm").
 * The same shape describes a substitute: a 71PE elective of the standard (`code`) filled by a passed GDTC course of the
 * student's own programme (`viaCode`); no transfer is needed for it.
 */
export type CreditTransfer = { code: string; name: string; viaCode: string; viaName: string };

/** Phrases different cohorts write differently ("Quản lý Dự án CNTT", "… Internet vạn vật", "… và IOT"). */
const NAME_PHRASES: readonly [RegExp, string][] = [
  [/\bcntt\b/g, "cong nghe thong tin"],
  [/\b(?:internet van vat|iots?)\b/g, "mang ket noi van vat"],
];
/** Words that do not tell two courses apart ("Học máy và ứng dụng" is "Học máy ứng dụng"). */
const NAME_FILLERS = new Set(["va", "cua", "cho", "voi", "trong", "theo"]);

/**
 * A course name for comparing courses of different cohorts, so nearly identical names match (user
 * 2026-10-23): accents, case, "(…)", punctuation, word order, fillers like "và" and the abbreviations
 * above are ignored; numbers are kept ("Anh văn 1" is not "Anh văn 2").
 */
export function courseNameKey(name: string): string {
  let text = fold(name.replace(/\([^)]*\)/g, " ")).replace(/[^a-z0-9]+/g, " ");
  for (const [pattern, phrase] of NAME_PHRASES) text = text.replace(pattern, phrase);
  return [...new Set(text.split(" ").filter((word) => word && !NAME_FILLERS.has(word)))].sort().join(" ");
}

/**
 * Transcript code → standard code for the other codes a standard writes for a course (K26:
 * "DIT0091 / 71ITDS30103"), so a course taken under its new code counts for the standard's course.
 * A code that is itself a course of the standard, or that two courses list, stays as it is.
 */
export function standardCodeAliases(standard: Pick<GraduationData, "courses"> | null): Map<string, string> {
  const courses = standard?.courses ?? [];
  const primaries = new Set(courses.map((course) => courseKey(course.code)));
  const owners = new Map<string, Set<string>>();
  for (const course of courses) {
    for (const code of course.alternativeCodes ?? []) {
      const key = courseKey(code);
      if (key && !primaries.has(key)) owners.set(key, (owners.get(key) ?? new Set()).add(courseKey(course.code)));
    }
  }
  return new Map([...owners].filter(([, set]) => set.size === 1).map(([key, set]) => [key, [...set][0]!]));
}

/** A 71PE elective of a standard: a 71PE… code marked (*) (conditionOnly, or "(*)" in its name). */
const isPhysicalEducationElective = (course: StandardCourse) =>
  /^71PE/.test(courseKey(course.code)) && (course.conditionOnly || /\(\s*\*\s*\)/.test(course.name));

/** The standard's groups (in standard order) whose courses are all 71PE (*) electives (K27/K28 TC104, K29 TC002/TC102). */
function physicalEducationGroups(courses: readonly StandardCourse[]): StandardCourse[][] {
  const groups = new Map<string, StandardCourse[]>();
  for (const course of courses) groups.set(course.groupId, [...(groups.get(course.groupId) ?? []), course]);
  return [...groups.values()].filter((list) => list.every(isPhysicalEducationElective));
}

/** The GDTC courses K27/K28 students take: their CTĐT lists them, their standard lists only the 71PE electives (TC104). */
const NUMBERED_PE_CODES: ReadonlySet<string> = new Set(["DGT0010", "DGT0020"]);
/** "Giáo dục thể chất (1)", "Giáo dục thể chất 2 (*)", folded: a numbered GDTC course of a CTĐT. */
const NUMBERED_PE_NAME = /^giao duc the chat\s*\(?\s*\d+\s*\)?(?:\s*\(\s*\*\s*\))?$/;

/**
 * Every transcript code → standard code map of the graduation check: the standard's other codes
 * (standardCodeAliases), then, for each standard course not passed under its own codes, a passed
 * course with the same name (courseNameKey) under a code the standard does not list — a retake with a
 * later cohort (user 2026-10-23). Each such course is used once; a name the standard lists twice is
 * skipped. The second kind is returned as `transfers` too, unless the code is a course of the student's own
 * CTĐT (`curriculumCodes`): then the standard and the CTĐT only write the course differently (K26 standard
 * DQP0061, K26 CTĐT DQP0060) and no transfer is needed.
 * Last, the numbered GDTC courses (audit 2026-10-25): a passed DGT0010/DGT0020, or a passed course of the own CTĐT named
 * "Giáo dục thể chất (n)" (`curriculumNames`, else its transcript name), that the standard does not list fills one 71PE
 * elective of a group whose courses are all 71PE (*) electives — K27/K28 students took GDTC (1)/(2) while their standard
 * lists only the 71PE electives of TC104. It fills a course nobody took, in the group with the fewest passed courses
 * (standard order on ties), for graduation only; it is returned as `substitutes` and needs no transfer.
 */
export function graduationCodeAliases(
  standard: Pick<GraduationData, "courses"> | null,
  transcript: TranscriptData,
  curriculumCodes: ReadonlySet<string> = new Set(),
  curriculumNames: ReadonlyMap<string, string> = new Map(),
): { aliases: Map<string, string>; transfers: CreditTransfer[]; substitutes: CreditTransfer[] } {
  const aliases = standardCodeAliases(standard);
  const courses = standard?.courses ?? [];
  if (!courses.length) return { aliases, transfers: [], substitutes: [] };
  const records = transcriptCourses(transcript, aliases);
  const known = new Set(courses.flatMap((course) => [course.code, ...(course.alternativeCodes ?? [])].map(courseKey)));
  const names = new Map<string, string>();
  for (const section of transcript.sections) {
    for (const course of section.courses) {
      const printed = courseKey(course.code ?? "");
      const code = aliases.get(printed) ?? printed;
      if (code && course.name?.trim() && !names.has(code)) names.set(code, course.name.trim());
    }
  }
  const passedByName = new Map<string, string[]>();
  for (const [code, record] of records) {
    const name = courseNameKey(names.get(code) ?? "");
    if (name && !known.has(code) && isPassedState(record.state)) passedByName.set(name, [...(passedByName.get(name) ?? []), code]);
  }
  const standardNames = new Map<string, number>();
  for (const course of courses) {
    const name = courseNameKey(course.name);
    if (name) standardNames.set(name, (standardNames.get(name) ?? 0) + 1);
  }
  const transfers: CreditTransfer[] = [];
  const used = new Set<string>();
  for (const course of courses) {
    const code = courseKey(course.code), name = courseNameKey(course.name);
    if (!name || standardNames.get(name) !== 1 || isPassedState(records.get(code)?.state ?? "not_taken")) continue;
    const via = (passedByName.get(name) ?? []).filter((candidate) => !used.has(candidate)).sort()[0];
    if (!via) continue;
    used.add(via);
    aliases.set(via, code);
    if (!curriculumCodes.has(via)) transfers.push({ code, name: course.name, viaCode: via, viaName: names.get(via) ?? "" });
  }
  const substitutes: CreditTransfer[] = [];
  const groups = physicalEducationGroups(courses);
  if (groups.length) {
    const numbered = (code: string) => NUMBERED_PE_CODES.has(code) ||
      (curriculumCodes.has(code) && NUMBERED_PE_NAME.test(fold(curriculumNames.get(code) ?? names.get(code) ?? "")));
    const candidates = [...records.keys()].filter((code) =>
      !known.has(code) && !aliases.has(code) && isPassedState(records.get(code)!.state) && numbered(code)).sort();
    const targets = new Set(aliases.values());
    const filled = groups.map((group) => group.filter((course) => isPassedState(records.get(courseKey(course.code))?.state ?? "not_taken")).length);
    const free = (course: StandardCourse) => !records.has(courseKey(course.code)) && !targets.has(courseKey(course.code));
    for (const via of candidates) {
      const index = groups.map((_, position) => position).sort((a, b) => filled[a]! - filled[b]! || a - b)
        .find((position) => groups[position]!.some(free));
      if (index === undefined) break;
      const target = groups[index]!.find(free)!;
      const code = courseKey(target.code);
      targets.add(code);
      filled[index] = filled[index]! + 1;
      aliases.set(via, code);
      substitutes.push({ code, name: target.name, viaCode: via, viaName: names.get(via) ?? "" });
    }
  }
  return { aliases, transfers, substitutes };
}

/** The graduation inputs from the standard, the cohort's CTĐT courses ([] when there is none) and the transcript. */
export function graduationInputs(
  standard: Pick<GraduationData, "courses"> | null,
  curriculumCourses: readonly CurriculumCourseInput[],
  transcript: TranscriptData,
): GraduationInputs {
  const courses = uniqueCurriculumCourses(curriculumCourses);
  const { aliases, transfers, substitutes } = graduationCodeAliases(standard, transcript,
    new Set(courses.map((course) => courseKey(course.code))), new Map(courses.map((course) => [courseKey(course.code), course.name])));
  const records = transcriptCourses(transcript, aliases);
  // A GDTC course that fills a 71PE elective keeps its own record as well: the CTĐT lists it, and the study plan reads
  // these records. Nothing counts twice: the copy under the 71PE code is condition-only (no credits, no GPA), and the
  // GDTC course itself counts in the credits and the GPA exactly as it did before it filled the elective.
  if (substitutes.length) {
    const own = transcriptCourses(transcript);
    for (const substitute of substitutes) {
      const record = own.get(substitute.viaCode);
      if (record) records.set(substitute.viaCode, record);
    }
  }
  return {
    transcript,
    records,
    programCredits: programCreditMap(standard, curriculumCreditMap(courses)),
    electives: deriveElectiveGroups(courses),
    conditionCodes: conditionOnlyCodes(standard, courses),
    transfers,
    aliases,
    substitutes,
  };
}

const numericIn = (value: number | null | undefined, max: number): value is number =>
  value !== null && value !== undefined && Number.isFinite(value) && value >= 0 && value <= max;

/** A course the GPA estimate may count: not condition-only, no conditional or MT attempt. */
export const countsInGpa = (record: TranscriptCourseRecord, conditionCodes: ReadonlySet<string>) =>
  !isConditionOnly(record.code, conditionCodes) && !record.attempts.some((attempt) => attempt.conditional || attempt.exempt);

/**
 * The attempt the GPA estimate counts for a course: its best graded attempt on the scale, an F
 * included (a failed course enters the GPA at its F, a VT or CT at 0); undefined for registrations without grades.
 */
export function gpaAttempt(record: TranscriptCourseRecord, scale: 4 | 10): Attempt | undefined {
  const field = scale === 4 ? "score4" : "score10";
  const graded = record.attempts.filter((attempt) => attempt.score10 !== null || attempt.score4 !== null || attempt.result || attempt.letter);
  return [...graded].sort((a, b) => (b[field] ?? -1) - (a[field] ?? -1))[0];
}

/**
 * GPA check: the printed cumulative GPA of the latest
 * graded term on the standard's scale (default 4), else a credit-weighted estimate of the best
 * grade per code (gpaAttempt), without condition-only and MT courses (countsInGpa).
 */
export function assessGraduationGpa(
  standard: Pick<GraduationData, "minimumGpa" | "gpaScale">,
  transcript: TranscriptData,
  records: ReadonlyMap<string, TranscriptCourseRecord>,
  conditionCodes: ReadonlySet<string>,
): GraduationGpa {
  const scale: 4 | 10 = standard.gpaScale ?? 4;
  const required = standard.minimumGpa;
  const unknown = (reason: string): GraduationGpa => ({ actual: null, required, scale, status: "unknown", source: null, reason });
  if (required === null) return unknown("Tiêu chuẩn chưa có điểm trung bình tối thiểu.");
  if (!numericIn(required, scale)) return unknown("Ngưỡng điểm trung bình chưa phù hợp với thang điểm đã chọn.");
  const result = (actual: number, source: "printed" | "calculated"): GraduationGpa => ({
    actual, required, scale, source, status: actual + 1e-9 >= required ? "pass" : "fail", reason: "",
  });
  const printed = printedSummaryNumber(latestResultSection(transcript),
    (label) => /diem (?:tb|trung binh) tich luy/.test(label) && new RegExp(`(?:he|thang(?: diem)?)\\s*${scale}\\b`).test(label), scale);
  if (printed !== null) {
    return Number.isNaN(printed)
      ? unknown("Điểm trung bình tích lũy trong bảng điểm chưa rõ hoặc không khớp. Hãy kiểm tra PDF gốc.")
      : result(printed, "printed");
  }
  let total = 0, credits = 0;
  for (const record of records.values()) {
    if (!countsInGpa(record, conditionCodes)) continue;
    const best = gpaAttempt(record, scale);
    if (!best) continue; // Registrations without grades do not enter the GPA.
    // VT (vắng thi) and CT (cấm thi) print no score and count 0, like the transcript's own semester GPA.
    const value = NO_SCORE_LETTERS.includes(best.letter ?? "") && best.score4 === null && best.score10 === null ? 0 : scale === 4 ? best.score4 : best.score10;
    if (!numericIn(value, scale)) return unknown(`Chưa có đủ điểm hệ ${scale} hoặc tín chỉ của môn ${record.code} để tính điểm trung bình.`);
    if (best.credits === 0) continue;
    credits += best.credits;
    total += value * best.credits;
  }
  if (!credits) return unknown(`Chưa có điểm của các môn được tính vào điểm trung bình hệ ${scale}.`);
  return result(total / credits, "calculated");
}

/**
 * E2: pass once the lower bound meets the requirement (even without an upper bound), fail once
 * the upper bound cannot, otherwise unknown; a missing requirement is unknown.
 */
export const decide = (lower: number | null, upper: number | null, required: number | null): TriState =>
  required === null ? "unknown"
    : lower !== null && lower + 1e-9 >= required ? "pass"
      : upper !== null && upper + 1e-9 < required ? "fail" : "unknown";

/**
 * Total credits: the printed "Tổng số tín chỉ tích lũy" of the latest graded term, else the E4
 * program estimate with lower/upper bounds. An unreadable or conflicting printed value falls back to
 * the estimate (E5; the graduation page warns printed_credits_unreadable).
 */
function assessGraduationCredits(
  required: number,
  transcript: TranscriptData,
  records: ReadonlyMap<string, TranscriptCourseRecord>,
  programCredits: ReadonlyMap<string, number | null>,
  conditionCodes: ReadonlySet<string>,
): GraduationCredits {
  const printed = printedCumulativeCredits(transcript);
  if (printed !== null && !Number.isNaN(printed)) {
    return { lower: printed, upper: printed, required, status: decide(printed, printed, required), source: "printed" };
  }
  const { certain, unknown } = estimateProgramCredits(records, programCredits, conditionCodes);
  return { lower: certain, upper: certain + unknown, required, status: decide(certain, certain + unknown, required), source: "calculated" };
}

/**
 * Each group has a lower bound (certainly completed: passed/MT) and an upper bound (+ graded with
 * an unknown result); pass when lower ≥ required, fail when upper < required, otherwise unknown (E2).
 * Mandatory groups count courses, (*) included (E8); elective groups count E3 credits.
 */
function assessGraduationGroups(
  standard: Pick<GraduationData, "groups" | "courses">,
  records: ReadonlyMap<string, TranscriptCourseRecord>,
  programCredits: ReadonlyMap<string, number | null>,
  electives: readonly ElectiveGroup[],
): GraduationGroupCheck[] {
  const state = (code: string) => records.get(courseKey(code))?.state;
  const ambiguous = standardCodesAmbiguous(standard);
  const labels = graduationGroupLabels(standard);
  const creditOf = (course: StandardCourse) => standardCourseCredits(course, programCredits, records.get(courseKey(course.code)));
  const sumCredits = (items: StandardCourse[]) => {
    const credits = items.map(creditOf);
    return credits.some((value) => value === null) ? null : credits.reduce<number>((sum, value) => sum + value!, 0);
  };
  return standard.groups.map((group) => {
    const courses = standard.courses.filter((course) => course.groupId === group.id);
    const certain = courses.filter((course) => { const value = state(course.code); return value !== undefined && isPassedState(value); });
    const possible = [...certain, ...courses.filter((course) => state(course.code) === "graded_unknown")];
    const mandatory = group.kind === "mandatory";
    // Starred courses satisfy elective quotas, but not accumulated academic credits.
    const lower = mandatory ? certain.length : sumCredits(certain);
    const upper = mandatory ? possible.length : sumCredits(possible);
    const required = mandatory ? courses.length : group.minimumCredits;
    return {
      groupId: group.id,
      label: labels.get(group.id) ?? group.name,
      kind: group.kind,
      code: groupCode(group.name),
      unit: mandatory ? "môn" : "TC",
      lower,
      upper,
      required,
      status: !courses.length || ambiguous ? "unknown" : decide(lower, upper, required),
      accumulatedCredits: sumCredits(certain.filter((course) => !course.conditionOnly)),
      curriculumElectiveCode: mandatory ? null : matchCurriculumElective(group, standard, electives),
    };
  });
}

/** The verdict against one resolved standard (everything of GraduationSummary but the resolution and the standard's identity). */
type GraduationAssessment = Pick<GraduationSummary, "status" | "reason" | "groups" | "groupStatus" | "credits" | "needsImprovement"> & {
  gpa: GraduationGpa;
};

/** The core shared by the competency assessment and the graduation page. */
export function assessGraduationStandard(
  data: Pick<GraduationData, "groups" | "courses" | "minimumCredits" | "minimumGpa" | "gpaScale">,
  inputs: GraduationInputs,
): GraduationAssessment {
  const groups = assessGraduationGroups(data, inputs.records, inputs.programCredits, inputs.electives);
  const groupStatus: TriState = groups.some((check) => check.status === "fail") ? "fail"
    : !groups.length || groups.some((check) => check.status === "unknown") ? "unknown" : "pass";
  const gpa = assessGraduationGpa(data, inputs.transcript, inputs.records, inputs.conditionCodes);
  const credits = data.minimumCredits === null ? null
    : assessGraduationCredits(data.minimumCredits, inputs.transcript, inputs.records, inputs.programCredits, inputs.conditionCodes);
  const statuses = [groupStatus, gpa.status, ...(credits ? [credits.status] : [])];
  const status: TriState = statuses.includes("fail") ? "fail" : statuses.includes("unknown") ? "unknown" : "pass";
  const reason = status !== "unknown" ? null
    : groupStatus === "unknown" ? "Chưa đủ dữ liệu để kết luận một số nhóm học phần (có học phần chưa xác định kết quả)."
      : gpa.status === "unknown" ? gpa.reason
        : "Chưa xác định được tổng số tín chỉ tích lũy.";
  return { status, reason, groups, groupStatus, gpa, credits, needsImprovement: groupStatus === "pass" && gpa.status === "fail" };
}

export function assessGraduation(args: GraduationInputs & {
  resolution: GraduationResolution;
  standard: GraduationStandardInput | null;
}): GraduationSummary {
  const { standard } = args;
  if (!standard) {
    return {
      resolution: args.resolution, standard: null, status: "unknown", statusLabel: GRADUATION_STATUS_LABELS.unknown,
      reason: UNRESOLVED_REASONS[args.resolution], groups: [], groupStatus: "unknown", gpa: null, credits: null, needsImprovement: false,
    };
  }
  const data = standard.data;
  const result = assessGraduationStandard(data, args);
  return {
    resolution: args.resolution,
    standard: { id: standard.id, name: data.name, version: standard.version, specialty: data.specialty, classBlock: data.classBlock },
    status: result.status, statusLabel: GRADUATION_STATUS_LABELS[result.status], reason: result.reason, groups: result.groups,
    groupStatus: result.groupStatus, gpa: result.gpa, credits: result.credits, needsImprovement: result.needsImprovement,
  };
}
