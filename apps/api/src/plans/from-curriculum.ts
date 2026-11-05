// A training plan read from a CTĐT, for a cohort and major the Khoa sent no KHĐT for (user 2026-11-05: "Cái kế hoạch đào
// tạo này sửa lại khóa nào cũng coi khóa đó như CTĐT thôi"; asked, they chose "Khóa thiếu KHĐT thì dựng từ CTĐT"). The
// CTĐT's own planned study year and semester of each course give the terms; specialties and elective groups give the
// sections, as a KHĐT names them. A cohort that has a KHĐT keeps it. Pure.
import { curriculumTermCode } from "../competency-assessment/course-state.js";
import { classifyCurriculumSpecialty, specialtyLabel } from "../competency-assessment/specialty.js";
import type { CurriculumCourse, CurriculumData } from "../curricula/model.js";

/** The id of the plan read from the CTĐT with that id, beside the uuids of the imported plans. */
export const CURRICULUM_PLAN_PREFIX = "ctdt-";
export const curriculumPlanId = (curriculumId: string) => `${CURRICULUM_PLAN_PREFIX}${curriculumId}`;
/** The CTĐT id behind a plan id, or null for an imported plan. */
export const curriculumIdOf = (planId: string): string | null =>
  planId.startsWith(CURRICULUM_PLAN_PREFIX) ? planId.slice(CURRICULUM_PLAN_PREFIX.length) : null;

/** "Kế hoạch đào tạo ngành Công nghệ thông tin khóa 27 (theo chương trình đào tạo)"; the web writes the major's case. */
export const curriculumPlanName = (major: string, cohortCode: string) =>
  `Kế hoạch đào tạo ngành ${major.trim()} khóa ${cohortCode.trim().replace(/^K/i, "")} (theo chương trình đào tạo)`;

const electiveGroup = (type: string) => /^(TC\d+)/i.exec(type.trim())?.[1]?.toUpperCase() ?? null;

/** The physical education choices (TC002, TC102) of a CTĐT, as the plan page counts them. */
export function physicalEducationGroupsOf(courses: readonly Pick<CurriculumCourse, "code" | "type">[]): Record<string, string[]> {
  return Object.fromEntries(["TC002", "TC102"].map((group) => [group,
    [...new Set(courses.filter((course) => electiveGroup(course.type) === group).map((course) => course.code.trim().toUpperCase()))]]));
}

/**
 * The plan of a CTĐT: one term per planned study year and semester (HKyyS from the admission year), a section per
 * specialty ("Chuyên ngành Công nghệ phần mềm") and per elective group ("Tự chọn TC209: chọn 9 tín chỉ") in each term,
 * the courses without a planned term counted apart. The CTĐT's notes stay with the Khoa.
 */
export function curriculumPlan(data: CurriculumData) {
  const termOf = (course: CurriculumCourse) => curriculumTermCode(data.admissionYear, course.studyYear, course.semester);
  const placed = data.courses.filter((course) => termOf(course) !== null);
  const terms = [...new Map(placed.map((course) => [termOf(course)!,
    { code: termOf(course)!, semester: course.semester!, studyYear: course.studyYear!, sourceCredits: null as number | null }])).values()]
    .sort((a, b) => a.studyYear - b.studyYear || a.semester - b.semester);
  const required = new Map(data.electives.map((elective) => [elective.code.trim().toUpperCase(), elective.requiredCredits]));
  const sections = new Map<string, { id: string; termCode: string; label: string; kind: "choice" | "specialty" }>();
  const items = placed.map((course) => {
    const termCode = termOf(course)!;
    const specialty = classifyCurriculumSpecialty(course.specialty, data.cohortCode);
    const group = electiveGroup(course.type);
    let sectionId = "";
    if (specialty.kind === "specialty") {
      sectionId = `${termCode}-${specialty.code}`;
      if (!sections.has(sectionId)) sections.set(sectionId, { id: sectionId, termCode, label: `Chuyên ngành ${specialtyLabel(specialty.code)}`, kind: "specialty" });
    } else if (group) {
      sectionId = `${termCode}-${group}`;
      const credits = required.get(group);
      if (!sections.has(sectionId)) sections.set(sectionId, { id: sectionId, termCode, label: `Tự chọn ${group}${credits ? `: chọn ${credits} tín chỉ` : ""}`, kind: "choice" });
    }
    return {
      id: `row-${course.position}`, code: course.code, name: course.name, credits: course.credits, type: course.type, termCode,
      semester: course.semester!, studyYear: course.studyYear!, sectionId, prerequisite: course.prerequisite, prior: course.prior,
      hours: course.hours, notes: "",
    };
  });
  return {
    name: curriculumPlanName(data.major, data.cohortCode), major: data.major, cohortCode: data.cohortCode, admissionYear: data.admissionYear,
    totalCredits: data.totalCredits, terms, sections: [...sections.values()], items, unplacedCount: data.courses.length - placed.length,
  };
}
