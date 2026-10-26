export interface StudentCourse {
  code: string;
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
export interface StudentCurriculumList {
  items: {
    id: string;
    version: number;
    name: string;
    major: string;
    cohortCode: string;
    totalCredits: number | null;
    courseCount: number;
  }[];
  profileCohort: string | null;
  suggestedId: string | null;
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
    whichever part the curriculum does not give. */
export const termLabel = (studyYear: number | null, semester: number | null) =>
  [
    studyYear === null ? "" : `Năm ${studyYear}`,
    semester === null ? "" : `HK ${semester}`,
  ]
    .filter(Boolean)
    .join(" · ") || "—";
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
