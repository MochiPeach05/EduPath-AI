import type { PoolClient } from "pg";
import { readStudentRealCodes, studyPlanWithRealCodes } from "../curricula/real-codes.js";
import { studyPlanSchema, type StudyPlanData } from "./model.js";

// The courses a student placed in Kế hoạch học kỳ themselves, the choice every page follows for the thesis group (user
// 2026-11-10: "vẫn có giữ lại môn đồ án tốt nghiệp do sinh viên chọn hết mà"; graduation/thesis.ts thesisChoice).

type Db = Pick<PoolClient, "query">;
const key = (code: string) => code.trim().toUpperCase();

/**
 * Every course of the plan except those the AI roadmap's proposal added (aiAdded) and the student did not keep (kept, Bỏ
 * qua): those are the system's suggestion, not the student's choice. Upper-case codes.
 */
export function ownPlannedCodes(plan: Pick<StudyPlanData, "terms"> & Partial<Pick<StudyPlanData, "aiAdded" | "kept">>): Set<string> {
  const kept = new Set((plan.kept ?? []).map(key));
  const added = new Set((plan.aiAdded?.codes ?? []).map(key).filter((code) => !kept.has(code)));
  return new Set(plan.terms.flatMap((term) => term.courses.map((course) => key(course.code))).filter((code) => !added.has(code)));
}

/**
 * ownPlannedCodes of the student's saved plan, under the real codes (a plan saved before 2026-11-10 may name a course by its
 * CTĐT file's code, curricula/real-codes.ts): realCodes when the caller has them, else read for the student. Empty without a
 * saved plan or with one that does not parse.
 */
export async function readOwnPlannedCodes(db: Db, userId: string, realCodes?: ReadonlyMap<string, string>): Promise<Set<string>> {
  const row = (await db.query<{ data: unknown }>("SELECT data FROM stu_study_plans WHERE user_id=$1", [userId])).rows[0];
  const parsed = row ? studyPlanSchema.safeParse(row.data) : null;
  if (!parsed?.success || !parsed.data.terms.some((term) => term.courses.length)) return new Set();
  const codes = realCodes ?? await readStudentRealCodes(db, userId);
  return ownPlannedCodes(studyPlanWithRealCodes(parsed.data, codes));
}
