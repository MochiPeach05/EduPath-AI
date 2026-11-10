import { planTermCode, programName, termName } from "./display-format";
import type { OwnProgramFacts } from "./own-program";

export interface StudentCourse {
  code: string;
  /**
   * The graduation standard's code of a course the CTĐT file writes under another one (API curricula/real-codes.ts, user
   * 2026-11-10: "dùng luôn mã thực tế"; HTTT K29 71ITMA10203 → 71MATL10053). Students read only this code
   * (studentCurriculumWithRealCodes); absent when the codes agree or the API already serves the real one as `code`.
   */
  realCode?: string | null;
  name: string;
  englishName: string;
  description: string | null;
  credits: number;
  type: string;
  block: string;
  specialty: string;
  groupId: string;
  semester: number | null;
  studyYear: number | null;
  department: string;
  hours: {
    lecture: number | null;
    practice: number | null;
    project: number | null;
    internship: number | null;
  };
  notes: string;
  prerequisite: string;
  prior: string;
  scheduleNeedsReview: boolean;
  conditions: {
    kind: "prerequisite" | "prior";
    targetCodes: string[];
    reviewRequired: boolean;
  }[];
}
export interface StudentCurriculumData {
  id: string;
  version: number;
  name: string;
  major: string;
  cohortCode: string;
  admissionYear: number;
  totalCredits: number | null;
  groups: { id: string; label: string; credits: number | null }[];
  electives: {
    code: string;
    requiredCredits: number | null;
    courseCodes: string[];
  }[];
  courses: StudentCourse[];
}
/**
 * GET /api/student/curricula: the student's own CTĐT alone (user 2026-11-10, no choice, as on Xét tốt nghiệp), picked by
 * the cohort in the account and the major of the MSSV; suggestedId is its id, null with why in `resolution`.
 */
export interface StudentCurriculumList extends OwnProgramFacts {
  items: {
    id: string;
    version: number;
    name: string;
    major: string;
    cohortCode: string;
    totalCredits: number | null;
    courseCount: number;
  }[];
  suggestedId: string | null;
}

const codeKey = (code: string) => code.trim().toUpperCase();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** File code (upper case) → real code, of the rows that carry a real code other than their own. */
export function realCodeMap(rows: readonly { code: string; realCode?: string | null }[]): Map<string, string> {
  const codes = new Map<string, string>();
  for (const row of rows) {
    const real = row.realCode?.trim();
    if (real && codeKey(real) !== codeKey(row.code)) codes.set(codeKey(row.code), real);
  }
  return codes;
}

/** A text naming courses by code ("[71ITMA10203]Đại số…"), each file code written as its real one. */
export function realCodesInText(text: string, codes: ReadonlyMap<string, string>): string {
  if (!text || !codes.size) return text;
  let result = text;
  for (const [file, real] of codes)
    result = result.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(file)}(?![\\p{L}\\p{N}])`, "giu"), (_, before: string) => `${before}${real}`);
  return result;
}

/**
 * The CTĐT as students read it: a course with a real code is shown, searched and matched to the transcript by that code
 * only, and its conditions, elective groups and the prerequisite texts of the other courses name it so too; students never
 * see the file's code. Data without real codes is returned as it is.
 */
export function studentCurriculumWithRealCodes(data: StudentCurriculumData): StudentCurriculumData {
  const codes = realCodeMap(data.courses);
  if (!codes.size) return data;
  const real = (code: string) => codes.get(codeKey(code)) ?? code;
  return {
    ...data,
    electives: data.electives.map((group) => ({ ...group, courseCodes: group.courseCodes.map(real) })),
    courses: data.courses.map(({ realCode: _realCode, ...course }) => ({
      ...course,
      code: real(course.code),
      prerequisite: realCodesInText(course.prerequisite, codes),
      prior: realCodesInText(course.prior, codes),
      conditions: course.conditions.map((condition) => ({ ...condition, targetCodes: condition.targetCodes.map(real) })),
    })),
  };
}
export const courseKind = (type: string) =>
  type.startsWith("TC") ? "elective" : "required";
/**
 * GDTC/GDQP codes: condition-only (*) courses, which a student must pass but which count toward no
 * accumulated credits. The rule of conditionalCourseCode in transcript-results.ts (71NAD/71PE; not
 * exported there) plus the older DQP/DGT codes of K26–K28.
 */
export const CONDITION_ONLY_CODE = /^(?:71NAD|71PE|DQP|DGT)/i;
/** A condition-only (*) course: by its code, or a "BBKTL" row (bắt buộc không tích lũy). */
export const isConditionOnlyCourse = (code: string, type = "") =>
  CONDITION_ONLY_CODE.test(code.trim()) || type.trim().toUpperCase() === "BBKTL";
/**
 * The "Loại môn" badge. A condition-only course says so, whatever its type ("Bắt buộc" with 3 TC for
 * GDQP, 0 TC in K27/K28); a bare "TC" has no group code.
 */
export function courseTypeLabel(type: string, code = ""): string {
  const value = type.trim();
  const elective = /^TC/i.test(value);
  const group = /^TC\d/i.test(value) ? value : null;
  if (isConditionOnlyCourse(code, value))
    return `Môn điều kiện (*)${group ? ` · tự chọn ${group}` : elective ? " · tự chọn" : ""} · không tính tích lũy`;
  if (value === "BB") return "Bắt buộc";
  if (elective) return group ? `Tự chọn · ${group}` : "Tự chọn (không ghi mã nhóm)";
  return value;
}
/** An elective group code as the summary names it: a bare "TC" has no group code. */
export const electiveGroupName = (code: string) =>
  /^TC\d/i.test(code.trim()) ? code.trim() : "Tự chọn (không ghi mã nhóm)";
/** "[71ENG010012]Anh văn dự bị (AV0)" → "71ENG010012 · Anh văn dự bị (AV0)": a bracketed code reads as a code. */
export const prerequisiteText = (raw: string) =>
  raw
    .replace(/\[([^[\]\r\n]+)\][ \t]*(?=[^\s·])/g, "$1 · ")
    .replace(/\[([^[\]\r\n]+)\]/g, "$1");
/**
 * A value of the CTĐT "Chuyên ngành" column that names a specialty: not "Tự chọn Chuyên ngành",
 * "Học phần thay thế Đồ án tốt nghiệp" or a stray value without letters.
 */
export const isSpecialtyName = (value: string) => {
  const text = searchTerm(value);
  return /[a-z]/.test(text) && !/^(tu chon|hoc phan thay the)\b/.test(text);
};
/** React key of a course row: a code can repeat in other groups (K27 71ITDS40503) or twice in a group (K26). */
export const courseRowKey = (course: Pick<StudentCourse, "groupId" | "code">, index: number) =>
  `${course.groupId}:${course.code}:${index}`;
/** Courses in the catalogue: each code once, though it may be listed under several groups. */
export const uniqueCourseCount = (courses: readonly Pick<StudentCourse, "code">[]) =>
  new Set(courses.map((course) => course.code.trim().toUpperCase())).size;
/** "Năm 1 · HK 2" for a course's planned year and semester, leaving out
    whichever part the curriculum does not give (admin pages; students read plannedTermText). */
export const termLabel = (studyYear: number | null, semester: number | null) =>
  [
    studyYear === null ? "" : `Năm ${studyYear}`,
    semester === null ? "" : `HK ${semester}`,
  ]
    .filter(Boolean)
    .join(" · ") || "—";
const knownAdmission = (year: number | null | undefined): year is number => typeof year === "number" && Number.isInteger(year) && year >= 2000 && year < 2100;
/** The school year of a cohort's study year N: year 1 of a cohort admitted in 2023 is "2023–2024"; "Năm N" without the admission year. */
export const studyYearText = (studyYear: number, admissionYear: number | null | undefined) =>
  knownAdmission(admissionYear) ? `${admissionYear + studyYear - 1}–${admissionYear + studyYear}` : `Năm ${studyYear}`;
/**
 * A course's planned year and semester as the cohort's calendar term, the one way students read a term (user review
 * 2026-10-30: "Học kỳ đang được gọi theo 4 kiểu"): year 1, semester 1 of a cohort admitted in 2023 is "HK1 2023–2024".
 * Without the year it is "HK1", without the semester the school year; without a usable admission year "HK1, năm thứ 1".
 */
export function plannedTermText(studyYear: number | null, semester: number | null, admissionYear: number | null | undefined): string {
  const year = studyYear !== null && studyYear >= 1 ? studyYear : null;
  const term = semester !== null && semester >= 1 && semester <= 3 ? semester : null;
  if (year !== null && term !== null) return knownAdmission(admissionYear) ? termName(planTermCode(year, term, admissionYear)) : `HK${term}, năm thứ ${year}`;
  if (term !== null) return `HK${term}`;
  return year !== null ? studyYearText(year, admissionYear) : "—";
}
/**
 * A CTĐT/KHĐT title stored in capitals as a heading (user review 2026-10-30: "Tên chương trình viết HOA toàn bộ"):
 * "KẾ HOẠCH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN - KHÓA 29" → "Kế hoạch đào tạo ngành Công nghệ thông tin – khóa 29".
 * Sentence case by programName; the major keeps its capital where the title names it; a spaced hyphen reads as a dash.
 */
export function programTitle(name: string, major = ""): string {
  const title = programName(name.normalize("NFC")).replace(/\s+-\s+/g, " – ");
  const majorName = programName(major.normalize("NFC"));
  if (!majorName) return title;
  const at = title.toLocaleLowerCase("vi-VN").indexOf(majorName.toLocaleLowerCase("vi-VN"));
  return at > 0 ? title.slice(0, at) + majorName + title.slice(at + majorName.length) : title;
}
export const searchableCourse = (course: StudentCourse) =>
  `${course.code} ${course.name} ${course.englishName}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
export const searchTerm = (term: string) =>
  term
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
