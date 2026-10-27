import { z } from "zod";
import { DESCRIPTION_MAX_WORDS, LONG_DESCRIPTION_MAX_WORDS, limitedText } from "../word-limits.js";

export class CompetencyError extends Error {
  constructor(public readonly code: string, public readonly status = 422, public readonly details: string[] = []) { super(code); }
}
export const WEIGHT_TOLERANCE = 0.000001;
export const groupInput = z.object({ name: z.string().trim().min(1).max(160), description: limitedText(2000, DESCRIPTION_MAX_WORDS), isActive: z.boolean() }).strict();
/**
 * A skill profile. groupIds: its competency groups, one or more (2026-10-22, migration 040), duplicates
 * dropped; a page served before the change still sends a single groupId.
 */
export const skillInput = z.object({
  name: z.string().trim().min(1).max(100), description: limitedText(2000, DESCRIPTION_MAX_WORDS), scope: limitedText(4000, LONG_DESCRIPTION_MAX_WORDS),
  groupIds: z.array(z.uuid()).min(1).max(10).optional(), groupId: z.uuid().optional(), isActive: z.boolean(),
}).strict().refine(value => Boolean(value.groupIds?.length || value.groupId), { path: ["groupIds"] })
  .transform(({ groupId, groupIds, ...value }) => ({ ...value, groupIds: [...new Set(groupIds ?? [groupId!])] }));
/** The cohort filter of "Cấu hình môn học" ("" = every course). */
export const cohortFilter = z.string().trim().max(20).regex(/^[0-9A-Za-z]*$/);
const allocationSchema = z.object({ skillId: z.uuid(), weight: z.number().min(0).max(1) }).strict();
export const configurationInput = z.object({ status: z.enum(["draft", "active"]), links: z.array(allocationSchema).max(200), note: z.string().trim().max(500).default("") }).strict();
export function validateWeights(links: {skillId: string; weight: number}[], status: string): number {
  if (new Set(links.map(link => link.skillId)).size !== links.length) throw new CompetencyError("duplicate_skill_link", 409);
  if (links.some(link => !Number.isFinite(link.weight) || link.weight < 0 || link.weight > 1)) throw new CompetencyError("invalid_weight", 400);
  const total = links.reduce((sum, link) => sum + link.weight, 0);
  if (status === "active" && (!links.length || Math.abs(total - 1) > WEIGHT_TOLERANCE)) throw new CompetencyError("weight_total_invalid", 422, [`Tổng trọng số hiện tại ${(total * 100).toFixed(4)}%; cần 100%.`]);
  return total;
}
