// Per-job JSON schema of a study roadmap for Ollama structured output. Same grammar-safe subset as
// competency-assessment/ai/schema.ts: no pattern/format/minimum/maximum/uniqueItems/$ref, limits <= 2000, non-empty
// enums, additionalProperties false and every property required. The code and skill enums are exactly those of the job;
// an empty list gets the placeholder "NONE" with maxItems 0.
import type { JsonSchema } from "../competency-assessment/ai/schema.js";

/** Output limits (characters / items), shared by the schema, the prompt and the validator. */
export const ROADMAP_LIMITS = {
  summary: 600,
  adviceMin: 3,
  adviceMax: 6,
  adviceItem: 300,
  studyMax: 8,
  improveMax: 5,
  advice: 240,
  skillsMax: 4,
  why: 240,
  stepsMin: 1,
  stepsMax: 3,
  step: 160,
  outcome: 160,
  focus: 160,
  tasksMin: 1,
  tasksMax: 4,
  task: 160,
} as const;
export const NONE = "NONE";

const L = ROADMAP_LIMITS;
const text = (maxLength: number): JsonSchema => ({ type: "string", minLength: 1, maxLength });
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const list = (items: JsonSchema, minItems: number, maxItems: number): JsonSchema => ({ type: "array", minItems, maxItems, items });
const choice = (values: readonly string[]): JsonSchema => ({ type: "string", enum: values.length ? [...values] : [NONE] });

export function buildRoadmapSchema(options: { studyCodes: readonly string[]; improveCodes: readonly string[]; skillKeys: readonly string[]; months: number }): JsonSchema {
  return object({
    summary: text(L.summary),
    advice: list(text(L.adviceItem), L.adviceMin, L.adviceMax),
    study: list(object({ code: choice(options.studyCodes), advice: text(L.advice) }), 0, options.studyCodes.length ? L.studyMax : 0),
    improve: list(object({ code: choice(options.improveCodes), advice: text(L.advice) }), 0, options.improveCodes.length ? L.improveMax : 0),
    skills: list(object({ key: choice(options.skillKeys), why: text(L.why), steps: list(text(L.step), L.stepsMin, L.stepsMax), outcome: text(L.outcome) }),
      options.skillKeys.length ? 1 : 0, options.skillKeys.length ? Math.min(L.skillsMax, options.skillKeys.length) : 0),
    months: list(object({ month: choice(Array.from({ length: options.months }, (_, index) => String(index + 1))), focus: text(L.focus), tasks: list(text(L.task), L.tasksMin, L.tasksMax) }),
      options.months, options.months),
  });
}
