// What a study roadmap is built from: the facts the system computes before the AI writes (engine computes, AI
// explains). Pure: read from one competency assessment result (it already holds the course states and grades, the
// training-plan progress and the gaps to the target career) and the roadmap window. No names, student codes,
// emails, classes or interests (the privacy policy of 2026-10-11 keeps interests away from the model).
import { FAIL_LETTERS } from "../competency-assessment/constants.js";
import { fold } from "../competency-assessment/specialty.js";
import type { AssessmentResult, CourseFact, GapStatus, PlanCourseRef } from "../competency-assessment/types.js";
import { THESIS_NAME_PATTERN } from "../graduation/thesis.js";
import type { RoadmapWindow } from "./window.js";

/**
 * A course to take: being studied now (termCode: the term being studied), late against the training plan (also a
 * course planned for the term being studied but not registered), or planned for the next term, the registration the
 * 3 months lead to.
 */
export type RoadmapCourse = { code: string; name: string; credits: number; source: "running" | "late" | "next"; termCode: string | null; careerSkills: string[] };
export type RoadmapOption = { code: string; name: string; credits: number | null };
/**
 * A choice of the training plan ("chọn n TC trong …") still open. The thesis group (TC406, user 2026-10-24: "chuyên đề 1
 * + chuyên đề 2 hoặc đồ án tốt nghiệp chớ ta") is done one way only: the thesis alone, or both "Chuyên đề tốt nghiệp"
 * courses; its other courses are never offered, and once a chuyên đề is under way only the other one is.
 */
export type RoadmapChoice = {
  label: string; source: "next" | "late"; termCode: string | null; need: string; options: RoadmapOption[];
  thesis: { thesis: RoadmapOption | null; topics: RoadmapOption[] } | null;
};
/** F/VT/CT: must be taken again; D, D+: worth improving (user, 2026-10-24), never an English course (Anh văn, user 2026-10-24). */
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
  /** Latest graded term of the transcript, the term being studied (registrations without grades) and the plan's next term (HKyyS). */
  currentTerm: string | null;
  runningTerm: string | null;
  nextTerm: string | null;
  study: RoadmapCourse[];
  choices: RoadmapChoice[];
  improve: RoadmapImprove[];
  skills: RoadmapSkill[];
  graduation: { status: string; statusLabel: string };
  /**
   * How far graduation is (user 2026-10-24: a K30 student should hear how to keep pace to graduate on time): credits
   * accumulated and required, the cumulative GPA and its minimum, the groups not complete, the terms the program still
   * plans after the one being studied and the credits each of them needs on average.
   */
  pace: {
    creditsDone: number | null; creditsRequired: number | null; creditsLeft: number | null;
    gpa: number | null; gpaRequired: number | null; gpaScale: 4 | 10;
    openGroups: { label: string; unit: "môn" | "TC"; done: number | null; required: number | null }[];
    termsLeft: string[]; lastTerm: string | null; creditsPerTerm: number | null; lateCount: number;
  };
};

/** Skills offered to the model: required first, the widest gaps first. */
export const MAX_ROADMAP_SKILLS = 10;
/** Courses named per skill gap. */
const MAX_SKILL_COURSES = 4;
const IMPROVE_LETTERS = new Set(["D", "D+"]);
/** English courses are never offered for improvement (user, 2026-10-24); a failed one is still a retake. */
const isEnglish = (item: Pick<CourseFact, "code" | "name">) => /^71ENG/i.test(item.code) || /^(?:anh van|tieng anh)\b/.test(fold(item.name));
const TOPIC_NAME_PATTERN = /\bchuyen de tot nghiep\b/;
/** The levels in order, to name the next one a met skill can reach. */
const LEVEL_LADDER = ["Yếu", "Trung bình", "Khá", "Giỏi", "Xuất sắc"];
const RETAKE_LETTERS = new Set(FAIL_LETTERS);
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
      (item.state === "failed" && RETAKE_LETTERS.has(item.letter)) || (item.state === "passed" && IMPROVE_LETTERS.has(item.letter) && !isEnglish(item))))
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
  // The term being studied: the first term of the courses registered without grades.
  const runningTerm = (result.courses ?? []).filter((item) => item.state === "in_progress" && item.term).map((item) => item.term!).sort()[0] ?? null;
  for (const item of result.courses ?? []) if (item.state === "in_progress" && item.applicable) add(item, "running", item.term);
  const choices: RoadmapChoice[] = [];
  const progress = result.progress;
  // The options of a choice still to take; the thesis group keeps only the thesis or its chuyên đề courses.
  const offered = (options: readonly PlanCourseRef[]): Pick<RoadmapChoice, "options" | "thesis"> => {
    const open = (option: PlanCourseRef) => option.state !== "passed" && option.state !== "exempt";
    const plain = ({ code, name, credits }: PlanCourseRef): RoadmapOption => ({ code, name, credits });
    const thesis = options.find((option) => THESIS_NAME_PATTERN.test(fold(option.name)));
    if (!thesis) return { options: options.filter(open).map(plain), thesis: null };
    const topics = options.filter((option) => TOPIC_NAME_PATTERN.test(fold(option.name)));
    // A chuyên đề under way (or passed) is the chuyên đề path: only the other one is left.
    const started = topics.some((option) => option.state !== "not_taken" && option.state !== "failed" && option.state !== "not_in_curriculum");
    const left = started ? topics.filter(open) : [...(open(thesis) ? [thesis] : []), ...topics.filter(open)];
    return { options: left.map(plain), thesis: { thesis: started || !open(thesis) ? null : plain(thesis), topics: topics.filter(open).map(plain) } };
  };
  // Before comp-calc-v13 the plan counted from the latest graded term, so its "next term" was the term being studied:
  // the courses it plans there and the student did not register are late, and the term after it is the next one.
  const legacy = Boolean(runningTerm && progress?.nextTerm === runningTerm);
  const upcoming = legacy ? "late" as const : "next" as const;
  for (const entry of progress?.late ?? []) {
    if (entry.kind === "course") add(entry, course.get(entry.code)?.state === "in_progress" ? "running" : "late", entry.termCode);
    else if (entry.kind === "choice") choices.push({ label: entry.label, source: "late", termCode: entry.termCode, need: `${entry.missing} ${entry.unit === "credit" ? "TC" : "môn"}`, ...offered(entry.options) });
    else choices.push({ label: entry.label, source: "late", termCode: entry.termCode, need: `${Math.max(0, entry.required - entry.passed)} môn`, options: [], thesis: null });
  }
  for (const entry of progress?.next ?? []) {
    if (entry.kind === "course") add(entry, entry.state === "in_progress" ? "running" : upcoming, progress?.nextTerm ?? null);
    else if (entry.kind === "choice") choices.push({ label: entry.label, source: upcoming, termCode: progress?.nextTerm ?? null, need: `${entry.remaining} ${entry.unit === "credit" ? "TC" : "môn"}`, ...offered(entry.options) });
    else choices.push({ label: entry.label, source: upcoming, termCode: progress?.nextTerm ?? null, need: `${Math.max(0, entry.required - entry.passed)} môn`, options: [], thesis: null });
  }
  let nextTerm = progress?.nextTerm ?? null;
  if (legacy) {
    // The mandatory courses the plan puts in the term after the one being studied (electives stay with their choices).
    nextTerm = (result.courses ?? []).filter((item) => item.plannedTermSource === "plan" && item.plannedTerm && item.plannedTerm > runningTerm!)
      .map((item) => item.plannedTerm!).sort()[0] ?? null;
    for (const item of result.courses ?? []) {
      if (nextTerm && item.plannedTerm === nextTerm && item.plannedTermSource === "plan" && item.applicable && !item.conditionOnly
        && !item.electiveGroup && item.state === "not_taken") add(item, "next", nextTerm);
    }
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
  // Every student hears what to learn next (user 2026-10-24: "dù là bảng điểm tốt thì vẫn phải mở đường cho sv học
  // tiếp"): with no gap left, each career skill is offered one level up.
  if (!skills.length) for (const requirement of result.career?.requirements ?? []) {
    if (!requirement.skillKey || requirement.status !== "met") continue;
    const level = requirement.levelLabel ?? "Khá";
    const next = LEVEL_LADDER[LEVEL_LADDER.indexOf(level) + 1];
    skills.push({ skillKey: requirement.skillKey, name: requirement.skillName ?? requirement.title, kind: "deepen", status: "met",
      statusLabel: next ? `Đã đạt mức ${level}: nâng lên mức ${next}` : `Đã đạt mức ${level}: mở rộng sang kiến thức nâng cao`,
      isRequired: requirement.isRequired, score: requirement.score, threshold: requirement.threshold, courses: [] });
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

  // Terms the program still plans after the one being studied (the last planned term of an applicable course).
  const from = runningTerm ?? result.progress?.currentTerm ?? result.transcript?.latestTerm ?? null;
  const planned = [...new Set((result.courses ?? []).filter((item) => item.applicable && item.plannedTerm).map((item) => item.plannedTerm!))].sort();
  const lastTerm = planned.at(-1) ?? null;
  const termsLeft = planned.filter((term) => !from || term > from);
  const credits = result.graduation?.credits ?? null;
  const creditsLeft = credits?.lower !== null && credits?.lower !== undefined ? Math.max(0, credits.required - credits.lower) : null;
  const pace: RoadmapFacts["pace"] = {
    creditsDone: credits?.lower ?? null, creditsRequired: credits?.required ?? null, creditsLeft,
    gpa: result.graduation?.gpa?.actual ?? null, gpaRequired: result.graduation?.gpa?.required ?? null, gpaScale: result.graduation?.gpa?.scale ?? 4,
    openGroups: (result.graduation?.groups ?? []).filter((group) => group.status !== "pass")
      .map((group) => ({ label: group.label, unit: group.unit, done: group.lower, required: group.required })),
    termsLeft, lastTerm,
    creditsPerTerm: creditsLeft !== null && termsLeft.length ? Math.ceil(creditsLeft / termsLeft.length) : null,
    lateCount: result.progress?.lateCount ?? 0,
  };

  return {
    window, assessmentId, calcVersion: result.meta.calcVersion, pace,
    cohortCode: result.student.cohortCode, specialtyLabel: result.student.specialtyLabel, careerName: result.career?.nameVi ?? null,
    currentTerm: result.transcript?.latestTerm ?? null, runningTerm, nextTerm,
    study, choices, improve, skills: ordered,
    graduation: { status: result.graduation.status, statusLabel: result.graduation.statusLabel },
  };
}
