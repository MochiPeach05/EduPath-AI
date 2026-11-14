import { GRADUATION_CALC_VERSION } from "../competency-assessment/constants.js";
import {
  courseKey, currentTermCode, estimateProgramCredits, isConditionOnly, isPassedState, printedCumulativeCredits, transcriptCourses,
  type TranscriptCourseRecord,
} from "../competency-assessment/course-state.js";
import {
  assessGraduationStandard, countsInGpa, gpaAttempt, graduationInputs, standardCodesAmbiguous, standardCourseCredits, type CreditTransfer,
  type GraduationInputs, type GraduationStudent,
} from "../competency-assessment/graduation.js";
import type { CurriculumCourseInput, GraduationStandardInput } from "../competency-assessment/types.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import type { GraduationData } from "./model.js";

// The graduation page's verdict (design §3), computed on the server from the same core as the
// competency assessment (assessGraduationStandard), so groups, credits and GPA are identical numbers.
// Pure: the DB loader (student-graduation.ts) reads the inputs. The web mirrors these types.

export type GradStatus = "pass" | "fail" | "unknown";
export type GradCourseState = "passed" | "exempt" | "failed" | "in_progress" | "graded_unknown" | "not_taken";

export interface GraduationCourseRow {
  /** courseKey(code) */
  code: string;
  /** Standard course name (as stored; may contain "(*)"). */
  name: string;
  /** E3: standard → CTĐT → transcript credit of the selected attempt (> 0) → null. */
  credits: number | null;
  conditionOnly: boolean;
  groupId: string;
  state: GradCourseState;
  /** The pass/fail state rests on a letter-grade inference. */
  inferred: boolean;
  /** Transcript attempts for this code (0 when not_taken). */
  attempts: number;
  /** Selected attempt (MT: null). */
  score10: number | null;
  score4: number | null;
  /** "MT" for an exemption. */
  letter: string | null;
  /** Selected attempt HKyyS; null for "Điểm bảo lưu" or not taken. */
  term: string | null;
  /** Passed only under this other code with the same name (a retake with a later cohort): needs a credit transfer. */
  transferFrom?: string;
  /**
   * Only on a row of the student's own programme that is not a standard course: a passed GDTC course ("Giáo dục thể chất
   * (1)", DGT0010) that fills the 71PE elective with this code (graduationCodeAliases), for graduation only and without a
   * transfer. It is listed first in its group, with the elective's credits; the elective's own row reads "not_taken".
   */
  inPlaceOf?: string;
  /**
   * Only on a row that is no standard course: a passed course of this other specialty (its label, "Trí tuệ nhân tạo")
   * that the specialty electives group counts (crossSpecialtyCourses, 2026-11-14). Listed after the group's own courses.
   */
  fromSpecialty?: string;
}

/** A passed transcript course that maps to no course of the standard: it counts toward no group (shown for the student to ask). */
export interface GraduationOutsideCourse {
  /** courseKey(code) as printed. */
  code: string;
  /** As printed on the transcript. */
  name: string;
  /** Credits of the selected attempt (> 0), else null. */
  credits: number | null;
  state: "passed" | "exempt";
  /** Selected attempt (MT: null). */
  score10: number | null;
  score4: number | null;
  letter: string | null;
  /** HKyyS; null for "Điểm bảo lưu". */
  term: string | null;
}

export interface GraduationGroupEvaluation {
  id: string;
  name: string;
  /** E1 label (a repeated name adds its size and first code). */
  label: string;
  kind: "mandatory" | "elective";
  /** "TC306" from the name, else null. */
  code: string | null;
  /** CTĐT elective code with the same courses, e.g. "TC406". */
  curriculumElectiveCode: string | null;
  unit: "môn" | "TC";
  required: number | null;
  lower: number | null;
  upper: number | null;
  /** status !== "pass" && required !== null && lower !== null ? max(0, required − lower) : null */
  remaining: number | null;
  status: GradStatus;
  /** Standard group credits (informational). */
  minimumCredits: number | null;
  /** Certain, non-(*) credits. */
  accumulatedCredits: number | null;
  courseCount: number;
  passedCount: number;
  /** Every standard course of the group, in standard order, after the own-programme courses that fill one of them (inPlaceOf). */
  courses: GraduationCourseRow[];
}

export type GraduationWarningCode =
  | "results_inferred" | "credits_mismatch" | "printed_credits_unreadable" | "ocr_needs_review" | "standard_ambiguous_codes"
  | "credit_transfer_needed";

export interface GraduationWarning {
  code: GraduationWarningCode;
  count?: number;
  printed?: number;
  computedLower?: number;
  computedUpper?: number;
}

export interface GraduationImprovementCandidate {
  code: string;
  name: string;
  /** E3 credits (> 0). */
  credits: number;
  /** Best grade on the GPA's scale: the grade the GPA estimate counts. */
  score: number;
  scale: 4 | 10;
  letter: string | null;
  /** "passed": retake to improve ("học cải thiện"); "failed", never passed: retake ("học lại"). */
  state: "passed" | "failed";
}

export interface GraduationEvaluation {
  calcVersion: string;
  status: GradStatus;
  groupStatus: GradStatus;
  /** Groups pass, GPA fails. */
  needsImprovement: boolean;
  asOf: { transcriptVersion: string; transcriptUpdatedAt: string; latestTerm: string | null };
  groups: GraduationGroupEvaluation[];
  /** Null when the standard has no minimumCredits. */
  credits: {
    lower: number | null; upper: number | null; required: number; status: GradStatus;
    source: "printed" | "calculated"; remaining: number | null;
  } | null;
  gpa: {
    actual: number | null; required: number | null; scale: 4 | 10; status: GradStatus;
    source: "printed" | "calculated" | null; reason: string; remaining: number | null;
  };
  creditCheck: { status: "match" | "mismatch" | "unavailable"; printed: number | null; computedLower: number; computedUpper: number };
  /** Only when gpa.status === "fail" (see improvementCandidates()). */
  improvementCandidates: GraduationImprovementCandidate[];
  /** Standard courses in progress (max MAX_LISTED_COURSES). */
  inProgress: GraduationCourseRow[];
  /** Standard courses graded with an unreadable result (max MAX_LISTED_COURSES). */
  unknownResults: GraduationCourseRow[];
  /**
   * Standard courses passed only under another code with the same name (a retake with a later cohort).
   * They count as passed; the student still has to have the grades transferred. Absent when there is none.
   */
  creditTransfers?: { code: string; name: string; viaCode: string; viaName: string; credits: number | null }[];
  /**
   * The other codes a standard course was counted through, for the pages that list courses by code (#curriculum,
   * #plans): the standard's other code of the course, a same-name course of the CTĐT, or a retake with a later cohort
   * (`transfer`: needs a credit transfer, also in creditTransfers). Only codes printed on the transcript, ordered by
   * code; a GDTC course that fills a 71PE elective is left out (that elective was not taken). Absent when there is none.
   */
  codeAliases?: { code: string; viaCode: string; transfer: boolean }[];
  /**
   * Passed transcript courses that map to no standard course (K26 DIT0410 and K28 71ITGR40106 "Khoá luận tốt nghiệp"),
   * ordered by code: they count toward no group and change no condition (visibility only). Absent when there is none.
   */
  outsideStandard?: GraduationOutsideCourse[];
  warnings: GraduationWarning[];
}

type GraduationEvaluationInput = {
  /** The resolved standard (gpaScale already defaulted by the resolver; a missing one reads 4 anyway). */
  standard: Pick<GraduationStandardInput, "data">;
  transcript: { version: string; updatedAt: string; data: TranscriptData };
  /** Courses of the cohort's single active CTĐT, current revision; [] when it is missing or ambiguous. */
  curriculumCourses: readonly CurriculumCourseInput[];
  /** The student's specialty and cohort: another specialty's passed courses then count as specialty electives. */
  student?: GraduationStudent;
};

export const MAX_IMPROVEMENT_CANDIDATES = 8;
export const MAX_LISTED_COURSES = 20;
/** Tolerance of the printed-credit range check (E7). */
const CREDIT_TOLERANCE = 1e-6;

type StandardCourse = GraduationData["courses"][number];

const compareCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function evaluateGraduation(input: GraduationEvaluationInput): GraduationEvaluation {
  const data = input.standard.data;
  const transcript = input.transcript.data;
  const core = graduationInputs(data, input.curriculumCourses, transcript, input.student);
  const { records, programCredits, conditionCodes } = core;
  const result = assessGraduationStandard(data, core);
  const transferOf = new Map(core.transfers.map((transfer) => [transfer.code, transfer.viaCode]));
  const substitutes = core.substitutes ?? [];
  const filledBy = new Map(substitutes.map((substitute) => [substitute.code, substitute]));

  /** Result fields of a record (the selected attempt; MT shows no score). */
  const outcome = (record: TranscriptCourseRecord | undefined) => {
    const selected = record?.selected;
    const exempt = record?.state === "exempt";
    return {
      state: record?.state ?? "not_taken", inferred: record?.inferred ?? false, attempts: record?.attempts.length ?? 0,
      score10: selected && !exempt ? selected.score10 : null, score4: selected && !exempt ? selected.score4 : null,
      letter: selected?.letter ?? null, term: selected?.termCode ?? null,
    } satisfies Partial<GraduationCourseRow>;
  };
  const row = (course: StandardCourse): GraduationCourseRow => {
    const code = courseKey(course.code);
    // An elective a GDTC course fills was not taken itself: its own row reads "not taken" (the GDTC row carries the result).
    const record = filledBy.has(code) ? undefined : records.get(code);
    return {
      code, name: course.name, credits: standardCourseCredits(course, programCredits, records.get(code)),
      conditionOnly: course.conditionOnly || isConditionOnly(code, conditionCodes), groupId: course.groupId, ...outcome(record),
      ...(transferOf.has(code) ? { transferFrom: transferOf.get(code)! } : {}),
    };
  };
  /** The GDTC course of the student's own programme that fills a 71PE elective, as a row of the elective's group. */
  const fillRow = (substitute: CreditTransfer, course: StandardCourse): GraduationCourseRow => {
    const record = records.get(substitute.viaCode) ?? records.get(substitute.code);
    return {
      code: substitute.viaCode, name: substitute.viaName || course.name,
      credits: standardCourseCredits(course, programCredits, records.get(substitute.code)), conditionOnly: true,
      groupId: course.groupId, ...outcome(record), inPlaceOf: substitute.code,
    };
  };
  const rows = data.courses.map(row);
  const fills = substitutes.flatMap((substitute) => {
    const course = data.courses.find((item) => courseKey(item.code) === substitute.code);
    return course ? [fillRow(substitute, course)] : [];
  });
  // Another specialty's passed courses the specialty electives group counts, after the group's own courses.
  const cross = core.crossSpecialty ?? [];
  const crossRows = cross.map((course): GraduationCourseRow => ({
    code: course.code, name: course.name, credits: course.credits, conditionOnly: false, groupId: course.groupId,
    ...outcome(records.get(course.code)), fromSpecialty: course.specialty,
  }));
  // One row per code for the lists outside the groups (a code repeated in the standard is listed once).
  const listed = new Set<string>();
  const distinct = [...fills, ...rows].filter((item) => !listed.has(item.code) && Boolean(listed.add(item.code)));

  const groups: GraduationGroupEvaluation[] = data.groups.map((group, index) => {
    const check = result.groups[index]!;
    const courses = [...fills, ...rows, ...crossRows].filter((item) => item.groupId === group.id);
    return {
      id: group.id, name: group.name, label: check.label, kind: group.kind, code: check.code,
      curriculumElectiveCode: check.curriculumElectiveCode, unit: check.unit,
      required: check.required, lower: check.lower, upper: check.upper,
      remaining: check.status !== "pass" && check.required !== null && check.lower !== null ? Math.max(0, check.required - check.lower) : null,
      status: check.status, minimumCredits: group.minimumCredits, accumulatedCredits: check.accumulatedCredits,
      courseCount: courses.length, passedCount: courses.filter((item) => isPassedState(item.state)).length, courses,
    };
  });

  const credits = result.credits && {
    ...result.credits,
    remaining: result.credits.status === "fail" && result.credits.lower !== null ? result.credits.required - result.credits.lower : null,
  };
  const gpa = {
    ...result.gpa,
    remaining: result.gpa.status === "fail" && result.gpa.actual !== null && result.gpa.required !== null ? result.gpa.required - result.gpa.actual : null,
  };

  // E7: the printed total matches when it lies within the program estimate's bounds.
  const estimate = estimateProgramCredits(records, programCredits, conditionCodes);
  const printedValue = printedCumulativeCredits(transcript);
  const printed = printedValue === null || Number.isNaN(printedValue) ? null : printedValue;
  const computedLower = estimate.certain, computedUpper = estimate.certain + estimate.unknown;
  const creditCheck: GraduationEvaluation["creditCheck"] = {
    status: printed === null ? "unavailable"
      : computedLower - CREDIT_TOLERANCE <= printed && printed <= computedUpper + CREDIT_TOLERANCE ? "match" : "mismatch",
    printed, computedLower, computedUpper,
  };

  const warnings: GraduationWarning[] = [];
  // Counted on the standard's courses: the rows the page marks "suy ra từ điểm chữ".
  const inferred = distinct.filter((item) => item.inferred).length;
  if (inferred) warnings.push({ code: "results_inferred", count: inferred });
  if (creditCheck.status === "mismatch") warnings.push({ code: "credits_mismatch", printed: printed!, computedLower, computedUpper });
  if (printedValue !== null && Number.isNaN(printedValue)) warnings.push({ code: "printed_credits_unreadable" });
  if (transcript.ocr?.needsReview) warnings.push({ code: "ocr_needs_review" });
  if (standardCodesAmbiguous(data)) warnings.push({ code: "standard_ambiguous_codes" });
  if (core.transfers.length) warnings.push({ code: "credit_transfer_needed", count: core.transfers.length });
  const credit = new Map(distinct.map((item) => [item.code, item.credits]));

  // The transcript as printed, code by code: which other code a standard course was counted through (for #curriculum
  // and #plans), and which passed courses map to no standard course at all.
  const aliases = core.aliases ?? new Map<string, string>();
  const printedNames = new Map<string, string>();
  for (const course of transcript.sections.flatMap((section) => section.courses)) {
    const code = courseKey(course.code ?? "");
    if (code && !printedNames.has(code)) printedNames.set(code, course.name?.trim() ?? "");
  }
  const filling = new Set(substitutes.map((substitute) => substitute.viaCode));
  const transferred = new Set(core.transfers.map((transfer) => transfer.viaCode));
  const codeAliases = [...aliases]
    .filter(([via, code]) => via !== code && printedNames.has(via) && !filling.has(via))
    .map(([via, code]) => ({ code, viaCode: via, transfer: transferred.has(via) }))
    .sort((a, b) => compareCode(a.code, b.code) || compareCode(a.viaCode, b.viaCode));
  const standardCodes = new Set(data.courses.map((course) => courseKey(course.code)));
  const counted = new Set(cross.map((course) => course.code));
  const outsideStandard = [...transcriptCourses(transcript).values()]
    .filter((record) => isPassedState(record.state) && !standardCodes.has(aliases.get(record.code) ?? record.code) && !counted.has(record.code))
    .sort((a, b) => compareCode(a.code, b.code))
    .map((record): GraduationOutsideCourse => {
      const { state, score10, score4, letter, term } = outcome(record);
      return {
        code: record.code, name: printedNames.get(record.code) ?? "", credits: record.selected.credits > 0 ? record.selected.credits : null,
        state: state === "exempt" ? "exempt" : "passed", score10, score4, letter, term,
      };
    });

  return {
    calcVersion: GRADUATION_CALC_VERSION,
    status: result.status,
    groupStatus: result.groupStatus,
    needsImprovement: result.needsImprovement,
    asOf: { transcriptVersion: input.transcript.version, transcriptUpdatedAt: input.transcript.updatedAt, latestTerm: currentTermCode(transcript) },
    groups,
    credits,
    gpa,
    creditCheck,
    improvementCandidates: gpa.status === "fail" && gpa.required !== null ? improvementCandidates(data, core, gpa.required, gpa.scale) : [],
    inProgress: distinct.filter((item) => item.state === "in_progress").slice(0, MAX_LISTED_COURSES),
    unknownResults: distinct.filter((item) => item.state === "graded_unknown").slice(0, MAX_LISTED_COURSES),
    ...(core.transfers.length
      ? { creditTransfers: core.transfers.map((transfer) => ({ ...transfer, credits: credit.get(transfer.code) ?? null })) }
      : {}),
    ...(codeAliases.length ? { codeAliases } : {}),
    ...(outsideStandard.length ? { outsideStandard } : {}),
    warnings,
  };
}

/**
 * Courses whose retake would raise a failing GPA (§3, revised): standard courses that count in the
 * GPA — not (*) or condition-only, no conditional or MT attempt, credits > 0, graded on the GPA's
 * scale — whose best grade on that scale, the grade the GPA estimate counts (gpaAttempt), is below
 * the required GPA: passed ones ("học cải thiện") and failed, never passed ones ("học lại"; the
 * estimate counts their F). A course retaken now (in progress) or graded without a readable result
 * is not listed. Lowest score first, then more credits, then code; at most MAX_IMPROVEMENT_CANDIDATES.
 */
function improvementCandidates(
  data: Pick<GraduationData, "courses">,
  core: GraduationInputs,
  required: number,
  scale: 4 | 10,
): GraduationImprovementCandidate[] {
  const seen = new Set<string>();
  const candidates: GraduationImprovementCandidate[] = [];
  for (const course of data.courses) {
    const code = courseKey(course.code);
    if (seen.has(code)) continue;
    seen.add(code);
    const record = core.records.get(code);
    const state = record?.state;
    if (!record || (state !== "passed" && state !== "failed") || course.conditionOnly || !countsInGpa(record, core.conditionCodes)) continue;
    const best = gpaAttempt(record, scale);
    const score = best ? (scale === 4 ? best.score4 : best.score10) : null;
    // A 0-credit attempt does not enter the GPA estimate.
    if (!best || score === null || score >= required || best.credits <= 0) continue;
    const credits = standardCourseCredits(course, core.programCredits, record) ?? best.credits;
    if (credits <= 0) continue;
    candidates.push({ code, name: course.name, credits, score, scale, letter: best.letter, state });
  }
  return candidates
    .sort((a, b) => a.score - b.score || b.credits - a.credits || compareCode(a.code, b.code))
    .slice(0, MAX_IMPROVEMENT_CANDIDATES);
}
