import { courseKey } from "../competency-assessment/course-state.js";
import { assessGraduationStandard, graduationInputs } from "../competency-assessment/graduation.js";
import type { TriState } from "../competency-assessment/types.js";
import type { TranscriptCourse, TranscriptData } from "../student/transcript-parser.js";
import type { StudyPlanFacts } from "./context.js";
import { termLabel, type StudyPlanData } from "./model.js";

export type StudyPlanProjectionGroup = {
  label: string; kind: "mandatory" | "elective"; unit: "môn" | "TC";
  required: number | null; now: number | null; withPlan: number | null; status: TriState;
};
/** The graduation standard's groups now and if every planned and running course is passed (STU-AI-05); GPA cannot be foreseen. */
export type StudyPlanProjection = {
  standardName: string;
  now: TriState;
  withPlan: TriState;
  /** Groups the plan does not complete yet (status of the projection not "pass"). */
  openGroups: StudyPlanProjectionGroup[];
  groupCount: number;
};

/**
 * The transcript plus one term per plan term in which every planned course is passed ("Đạt"); the courses being studied
 * (`running`) are passed too, in a term of their own.
 */
export function plannedTranscript(transcript: TranscriptData, plan: StudyPlanData, names: ReadonlyMap<string, { name: string; credits: number; conditional: boolean }>, running: readonly string[] = []): TranscriptData {
  const terms = [...(running.length ? [{ code: "HK000", courses: running.map((code) => ({ code })) }] : []), ...plan.terms];
  const sections = terms.filter((term) => term.courses.length).map((term) => {
    const year = 2000 + Number(term.code.slice(2, 4));
    return {
      id: `plan-${term.code}`, academicYear: `${year}-${year + 1}`, semester: `HK0${term.code.slice(4)}`, label: `Kế hoạch ${termLabel(term.code)}`,
      courses: term.courses.map((course, index): TranscriptCourse => {
        const info = names.get(courseKey(course.code));
        return { ordinal: index + 1, code: course.code, name: info?.name ?? course.code, credits: info?.credits ?? 0, score10: null, score4: null,
          letter: null, result: "Đạt", conditional: info?.conditional ?? false, sourcePage: 0 };
      }),
      summaries: [],
    };
  });
  return { ...transcript, sections: [...transcript.sections, ...sections] };
}

export function projectGraduation(facts: StudyPlanFacts, plan: StudyPlanData): StudyPlanProjection | null {
  const { standard, transcript, curriculumCourses } = facts;
  if (!standard || !transcript) return null;
  const names = new Map(facts.context.courses.map((course) => [course.code, { name: course.name, credits: course.credits, conditional: course.conditional }]));
  const now = assessGraduationStandard(standard.data, graduationInputs(standard.data, curriculumCourses, transcript));
  const running = facts.context.courses.filter((course) => course.state === "in_progress").map((course) => course.code);
  const later = assessGraduationStandard(standard.data, graduationInputs(standard.data, curriculumCourses, plannedTranscript(transcript, plan, names, running)));
  const before = new Map(now.groups.map((group) => [group.groupId, group]));
  return {
    standardName: standard.data.name,
    now: now.groupStatus,
    withPlan: later.groupStatus,
    groupCount: later.groups.length,
    openGroups: later.groups.filter((group) => group.status !== "pass").map((group) => ({
      label: group.label, kind: group.kind, unit: group.unit, required: group.required,
      now: before.get(group.groupId)?.lower ?? null, withPlan: group.lower, status: group.status,
    })),
  };
}
