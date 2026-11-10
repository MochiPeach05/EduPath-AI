// A stored roadmap as the page shows it: the facts the system computed (always) merged with what the AI wrote (once
// completed). Items the AI picked come first, in its order, with its advice; the other facts follow without advice, so
// nothing the system found is hidden when the model leaves it out. Pure.
import { withoutThesisGpaReason } from "../graduation/thesis.js";
import type { RoadmapChoice, RoadmapCourse, RoadmapFacts, RoadmapImprove, RoadmapSkill } from "./facts.js";
import type { RoadmapRow, RoadmapStatus } from "./jobs.js";
import type { RoadmapWindow } from "./window.js";

export type RoadmapStudyView = Omit<RoadmapCourse, "source" | "credits"> & {
  credits: number | null;
  /** "choice": a course the AI picked from a choice of the training plan. */
  source: RoadmapCourse["source"] | "choice";
  choiceLabel: string | null;
  advice: string | null;
};
export type RoadmapImproveView = RoadmapImprove & { advice: string | null };
export type RoadmapSkillView = Omit<RoadmapSkill, "score" | "threshold" | "status"> & {
  picked: boolean; why: string | null; steps: string[]; outcome: string | null;
};
export type RoadmapMonthView = { month: number; start: string; end: string; focus: string | null; tasks: string[] };

export type RoadmapView = {
  id: string;
  assessmentId: string;
  status: RoadmapStatus;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Ollama model tag, e.g. "gemma4:e4b". */
  model: string | null;
  window: RoadmapWindow;
  /** The window ended before `today`. */
  ended: boolean;
  careerName: string | null;
  specialtyLabel: string | null;
  summary: string | null;
  /** Key advice points (roadmap-v3), empty before. */
  advice: string[];
  study: RoadmapStudyView[];
  /** The choices without their thesis group's facts (the page never shows them; an older roadmap holds a GPA reason there). */
  choices: Omit<RoadmapChoice, "thesis">[];
  improve: RoadmapImproveView[];
  skills: RoadmapSkillView[];
  months: RoadmapMonthView[];
};

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

/**
 * A roadmap written while its data gave the GPA behind the thesis group's way (roadmap-v13 to v15: the facts kept that
 * reason): its text is shown without the sentences explaining the way by the GPA (user 2026-11-10, the rule is an internal
 * setting; graduation/thesis.ts withoutThesisGpaReason). Newer roadmaps hold no reason and are shown as written.
 */
export const explainedThesisByGpa = (facts: Pick<RoadmapFacts, "choices">): boolean =>
  (facts.choices ?? []).some((choice) => Boolean(choice.thesis?.reason));

/** The AI's output as shown: for such a roadmap, without those sentences (an item left empty is dropped). */
export function shownRoadmapOutput(row: Pick<RoadmapRow, "facts" | "output">): RoadmapRow["output"] {
  const output = row.output;
  if (!output || !explainedThesisByGpa(row.facts)) return output;
  const text = (value: string) => withoutThesisGpaReason(value) ?? "";
  const texts = (values: readonly string[]) => values.map(text).filter(Boolean);
  const optional = (value: string | null) => (value === null ? null : withoutThesisGpaReason(value));
  return {
    ...output,
    summary: text(output.summary),
    ...(output.advice ? { advice: texts(output.advice) } : {}),
    study: output.study.map((item) => ({ ...item, advice: text(item.advice) })),
    improve: output.improve.map((item) => ({ ...item, advice: text(item.advice) })),
    skills: output.skills.map((item) => ({ ...item, why: text(item.why), steps: texts(item.steps), outcome: optional(item.outcome) })),
    months: output.months.map((item) => ({ ...item, focus: optional(item.focus), tasks: texts(item.tasks) })),
  };
}

/** `today` is "YYYY-MM-DD" in Vietnam time (the window's own calendar). */
export function presentRoadmap(row: RoadmapRow, today: string): RoadmapView {
  const { facts } = row;
  const output = row.status === "completed" ? shownRoadmapOutput(row) : null;

  const study: RoadmapStudyView[] = [];
  const own = new Map(facts.study.map((item) => [item.code, item]));
  for (const item of output?.study ?? []) {
    const fact = own.get(item.code);
    if (fact) { study.push({ ...fact, choiceLabel: null, advice: item.advice }); continue; }
    const choice = facts.choices.find((entry) => entry.options.some((option) => option.code === item.code));
    const option = choice?.options.find((entry) => entry.code === item.code);
    if (choice && option && !study.some((entry) => entry.code === item.code)) {
      study.push({ code: option.code, name: option.name, credits: option.credits, source: "choice", termCode: choice.termCode, careerSkills: [], choiceLabel: choice.label, advice: item.advice });
    }
  }
  for (const fact of facts.study) if (!study.some((entry) => entry.code === fact.code)) study.push({ ...fact, choiceLabel: null, advice: null });

  const improveAdvice = new Map((output?.improve ?? []).map((item) => [item.code, item.advice]));
  const improve: RoadmapImproveView[] = [
    ...(output?.improve ?? []).map((item) => facts.improve.find((fact) => fact.code === item.code)).filter((fact): fact is RoadmapImprove => Boolean(fact)),
    ...facts.improve.filter((fact) => !improveAdvice.has(fact.code)),
  ].map((fact) => ({ ...fact, advice: improveAdvice.get(fact.code) ?? null }));

  const skillText = new Map((output?.skills ?? []).map((item) => [item.key, item]));
  const skills: RoadmapSkillView[] = [
    ...(output?.skills ?? []).map((item) => facts.skills.find((fact) => fact.key === item.key)).filter((fact): fact is RoadmapSkill => Boolean(fact)),
    ...facts.skills.filter((fact) => !skillText.has(fact.key)),
  ].map(({ score: _score, threshold: _threshold, status: _status, ...fact }) => {
    const text = skillText.get(fact.key);
    return { ...fact, picked: Boolean(text), why: text?.why ?? null, steps: text?.steps ?? [], outcome: text?.outcome ?? null };
  });

  const monthText = new Map((output?.months ?? []).map((item) => [item.month, item]));
  const months = facts.window.months.map((month) => ({
    month: month.index, start: month.start, end: month.end, focus: monthText.get(month.index)?.focus ?? null, tasks: monthText.get(month.index)?.tasks ?? [],
  }));

  return {
    id: row.id,
    assessmentId: row.assessmentId,
    status: row.status,
    errorCode: row.errorCode,
    createdAt: iso(row.createdAt)!,
    completedAt: iso(row.completedAt),
    model: row.model,
    window: facts.window,
    ended: facts.window.end < today,
    careerName: facts.careerName,
    specialtyLabel: facts.specialtyLabel,
    summary: output?.summary || null,
    advice: output?.advice ?? [],
    study,
    choices: facts.choices.map(({ thesis: _thesis, ...choice }) => choice),
    improve,
    skills,
    months,
  };
}
