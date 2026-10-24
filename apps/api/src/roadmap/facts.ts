// What a study roadmap is built from: the facts the system computes before the AI writes (engine computes, AI
// explains). Pure: read from one competency assessment result (it already holds the course states and grades, the
// training-plan progress and the gaps to the target career) and the roadmap window. No names, student codes,
// emails, classes or interests (the privacy policy of 2026-10-11 keeps interests away from the model).
import type { AssessmentResult, CourseFact, GapStatus } from "../competency-assessment/types.js";
import type { RoadmapWindow } from "./window.js";

/**
 * A course to take: being studied now, late against the training plan, planned for its next term, or (while courses are
 * running, so the next term is the one being studied) planned for the term after it, which the student registers for
 * within the 3 months.
 */
export type RoadmapCourse = {
  code: string; name: string; credits: number; source: "running" | "late" | "next" | "following"; termCode: string | null; careerSkills: string[];
};
/** A choice of the training plan ("chọn n TC trong …") still open. */
export type RoadmapChoice = { label: string; source: "next" | "late"; termCode: string | null; need: string; options: { code: string; name: string; credits: number | null }[] };
/** F/VT: must be taken again; D, D+: worth improving (user, 2026-10-24). */
export type RoadmapImprove = { code: string; name: string; credits: number; letter: string; score10: number | null; action: "retake" | "improve"; careerSkills: string[] };
/** A skill of the target career to build up: a gap, one only self-study can cover, or a met one worth deepening. key: S01… (the prompt's key). */
export type RoadmapSkill = {
  key: string; skillKey: string; name: string; kind: "gap" | "self_study" | "deepen"; status: GapStatus;
  statusLabel: string; isRequired: boolean; score: number | null; threshold: number | null;
  /** Courses of the student's own program that build the skill (the assessment's suggestions); none for self-study. */
  courses: { code: string; name: string }[];
};
export type RoadmapFacts = {
  window: RoadmapWindow;
  assessmentId: string;
  calcVersion: string;
  cohortCode: string;
  specialtyLabel: string | null;
  careerName: string | null;
  /** Latest graded term of the transcript, the next term of the training plan and the one after it (HKyyS). */
  currentTerm: string | null;
  nextTerm: string | null;
  followingTerm: string | null;
  study: RoadmapCourse[];
  choices: RoadmapChoice[];
  improve: RoadmapImprove[];
  skills: RoadmapSkill[];
  graduation: { status: string; statusLabel: string };
};

/** Skills offered to the model: required first, the widest gaps first. */
export const MAX_ROADMAP_SKILLS = 10;
/** Courses named per skill gap. */
const MAX_SKILL_COURSES = 4;
const IMPROVE_LETTERS = new Set(["D", "D+"]);
const RETAKE_LETTERS = new Set(["F", "VT"]);
/** The order a gap is worth working on: below the threshold, not studied, only self-study, then still to come. */
const STATUS_ORDER: Record<string, number> = { below: 0, not_studied: 1, no_data: 2, upcoming: 3, met: 4 };

export function buildRoadmapFacts(assessmentId: string, result: AssessmentResult, window: RoadmapWindow): RoadmapFacts {
  // Stored results of older calc versions may lack a list: read every list defensively.
  const course = new Map((result.courses ?? []).map((item) => [item.code, item]));
  const careerKeys = new Set((result.career?.requirements ?? []).map((item) => item.skillKey).filter((key): key is string => Boolean(key)));
  // Course → the target career's skills it builds (the skill evidence of the assessment).
  const careerSkillsOf = new Map<string, string[]>();
  for (const skill of result.skills ?? []) {
    if (!careerKeys.has(skill.key)) continue;
    for (const row of skill.evidenceCourses) careerSkillsOf.set(row.code, [...new Set([...(careerSkillsOf.get(row.code) ?? []), skill.name])]);
  }
  const skillsOf = (code: string) => careerSkillsOf.get(code) ?? [];

  const improve: RoadmapImprove[] = (result.courses ?? [])
    .filter((item) => item.applicable && !item.conditionOnly && item.letter && (
      (item.state === "failed" && RETAKE_LETTERS.has(item.letter)) || (item.state === "passed" && IMPROVE_LETTERS.has(item.letter))))
    .map((item) => ({ code: item.code, name: item.name, credits: item.credits, letter: item.letter!, score10: item.score10,
      action: item.state === "failed" ? "retake" as const : "improve" as const, careerSkills: skillsOf(item.code) }))
    // Retakes first, then the lowest grades; courses that build career skills before the others.
    .sort((a, b) => Number(b.action === "retake") - Number(a.action === "retake") || Number(b.careerSkills.length > 0) - Number(a.careerSkills.length > 0)
      || (a.score10 ?? 0) - (b.score10 ?? 0) || a.code.localeCompare(b.code));
  const improving = new Set(improve.map((item) => item.code));

  const study: RoadmapCourse[] = [];
  const add = (fact: Pick<CourseFact, "code" | "name" | "credits">, source: RoadmapCourse["source"], termCode: string | null) => {
    if (improving.has(fact.code) || study.some((item) => item.code === fact.code)) return;
    study.push({ code: fact.code, name: fact.name, credits: fact.credits, source, termCode, careerSkills: skillsOf(fact.code) });
  };
  for (const item of result.courses ?? []) if (item.state === "in_progress" && item.applicable) add(item, "running", null);
  const choices: RoadmapChoice[] = [];
  const progress = result.progress;
  for (const entry of progress?.late ?? []) {
    if (entry.kind === "course") add(entry, course.get(entry.code)?.state === "in_progress" ? "running" : "late", entry.termCode);
    else if (entry.kind === "choice") choices.push({ label: entry.label, source: "late", termCode: entry.termCode, need: `${entry.missing} ${entry.unit === "credit" ? "TC" : "môn"}`,
      options: entry.options.filter((option) => option.state !== "passed" && option.state !== "exempt").map(({ code, name, credits }) => ({ code, name, credits })) });
    else choices.push({ label: entry.label, source: "late", termCode: entry.termCode, need: `${Math.max(0, entry.required - entry.passed)} môn`, options: [] });
  }
  for (const entry of progress?.next ?? []) {
    if (entry.kind === "course") add(entry, entry.state === "in_progress" ? "running" : "next", progress?.nextTerm ?? null);
    else if (entry.kind === "choice") choices.push({ label: entry.label, source: "next", termCode: progress?.nextTerm ?? null, need: `${entry.remaining} ${entry.unit === "credit" ? "TC" : "môn"}`,
      options: entry.options.filter((option) => option.state !== "passed" && option.state !== "exempt").map(({ code, name, credits }) => ({ code, name, credits })) });
    else choices.push({ label: entry.label, source: "next", termCode: progress?.nextTerm ?? null, need: `${Math.max(0, entry.required - entry.passed)} môn`, options: [] });
  }
  // Courses running means the next term is the one being studied: add the mandatory courses the plan puts in the term
  // after it, the registration the 3 months lead to (electives stay with their choices).
  const nextTerm = progress?.nextTerm ?? null;
  const followingTerm = nextTerm && study.some((item) => item.source === "running")
    ? (result.courses ?? []).filter((item) => item.plannedTermSource === "plan" && item.plannedTerm && item.plannedTerm > nextTerm)
      .map((item) => item.plannedTerm!).sort()[0] ?? null
    : null;
  for (const item of result.courses ?? []) {
    if (followingTerm && item.plannedTerm === followingTerm && item.plannedTermSource === "plan" && item.applicable && !item.conditionOnly
      && !item.electiveGroup && item.state === "not_taken") add(item, "following", followingTerm);
  }

  // Skills: the career's gaps (merged with "Cần tự học"), then met skills worth deepening.
  const selfStudy = new Map((result.selfStudy ?? []).map((item) => [item.skillKey, item]));
  const suggested = new Map<string, { code: string; name: string }[]>();
  for (const item of result.courseSuggestions ?? []) {
    for (const skill of item.skills) suggested.set(skill.key, [...(suggested.get(skill.key) ?? []), { code: item.code, name: item.name }]);
  }
  const skills: Omit<RoadmapSkill, "key">[] = [];
  for (const requirement of result.career?.requirements ?? []) {
    if (!requirement.skillKey || requirement.status === "met") continue;
    const own = selfStudy.get(requirement.skillKey);
    skills.push({
      skillKey: requirement.skillKey, name: requirement.skillName ?? requirement.title, kind: own ? "self_study" : "gap", status: requirement.status,
      statusLabel: own?.reasonLabel ?? requirement.statusLabel, isRequired: requirement.isRequired, score: requirement.score, threshold: requirement.threshold,
      courses: own ? [] : (suggested.get(requirement.skillKey) ?? []).slice(0, MAX_SKILL_COURSES),
    });
  }
  for (const plan of result.skillPlans ?? []) {
    if (skills.some((item) => item.skillKey === plan.skillKey)) continue;
    const requirement = result.career?.requirements.find((item) => item.skillKey === plan.skillKey);
    const label = plan.purpose === "strengthen" ? `Mức ${plan.levelLabel}: nên củng cố` : `Đã đạt, mức ${plan.levelLabel}: có thể nâng cao`;
    skills.push({ skillKey: plan.skillKey, name: plan.name, kind: "deepen", status: "met", statusLabel: label,
      isRequired: requirement?.isRequired ?? false, score: plan.score, threshold: requirement?.threshold ?? null, courses: [] });
  }
  const ordered = skills
    .sort((a, b) => Number(a.kind === "deepen") - Number(b.kind === "deepen") || Number(b.isRequired) - Number(a.isRequired)
      || STATUS_ORDER[a.status]! - STATUS_ORDER[b.status]! || ((b.threshold ?? 0) - (b.score ?? 0)) - ((a.threshold ?? 0) - (a.score ?? 0)) || a.name.localeCompare(b.name, "vi"))
    .slice(0, MAX_ROADMAP_SKILLS)
    .map((item, index) => ({ key: `S${String(index + 1).padStart(2, "0")}`, ...item }));

  return {
    window, assessmentId, calcVersion: result.meta.calcVersion,
    cohortCode: result.student.cohortCode, specialtyLabel: result.student.specialtyLabel, careerName: result.career?.nameVi ?? null,
    currentTerm: progress?.currentTerm ?? null, nextTerm, followingTerm,
    study, choices, improve, skills: ordered,
    graduation: { status: result.graduation.status, statusLabel: result.graduation.statusLabel },
  };
}
