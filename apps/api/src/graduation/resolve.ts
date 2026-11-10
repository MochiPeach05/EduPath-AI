import type { PoolClient } from "pg";
import { isSpecialtyCode, resolveGraduationStandard } from "../competency-assessment/specialty.js";
import { CNTT_MAJOR } from "../curricula/majors.js";
import type { GraduationResolution, GraduationStandardInput, SpecialtyCode } from "../competency-assessment/types.js";
import type { GraduationData } from "./model.js";

// D3: the one way to pick a student's graduation standard. Used by the competency inputs
// (competency-assessment/inputs.ts), the student graduation page (student-graduation.ts) and the
// graduation advice. A student only ever sees the standard of the cohort in the account and the
// specialty declared in the profile.

type Db = Pick<PoolClient, "query">;

/** The resolution of the graduation page: the competency resolutions plus a profile without a cohort. */
export type StudentGraduationResolution = GraduationResolution | "cohort_unknown";

/** student_profiles.cohort_code as standards store it (trimmed, upper-case); null when missing or blank. */
export const normalizeCohortCode = (value: string | null | undefined): string | null => value?.trim().toUpperCase() || null;

/** student_profiles.specialty when it is a known code, else null ("Chưa xác định"). */
export const profileSpecialty = (value: unknown): SpecialtyCode | null => (isSpecialtyCode(value) ? value : null);

/**
 * The full identity used to match a standard to a specialty (program code in specialty, classBlock or standardCode) and
 * to its major (also the "Ngành đào tạo" it names).
 */
export const standardIdentity = (data: Pick<GraduationData, "specialty" | "classBlock" | "standardCode"> & { major?: string | null }) => ({
  specialty: data.specialty ?? "", classBlock: data.classBlock ?? "", standardCode: data.standardCode ?? "", major: data.major ?? "",
});

/**
 * The major a graduation standard is for (2026-10-27): the programme of its specialty code ("71K29CNTT_7480201-03" →
 * 7480201), else the code of its "Ngành đào tạo" ("Mạng máy tính và truyền thông dữ liệu (7480102)", a general standard;
 * 2026-11-10), else HTTT or MMT/TTDL named in it (the Faculty writes MMT&TTDL classes "71K29TTDL"), else Công nghệ thông
 * tin, the major of every standard before the other majors came.
 */
export function standardMajor(identity: { specialty: string; classBlock: string; standardCode: string; major?: string }): string {
  const text = `${identity.specialty} ${identity.classBlock} ${identity.standardCode}`;
  const programme = /(?<!\d)(\d{7})-\d{2}(?!\d)/.exec(text)?.[1] ?? /(?<!\d)(\d{7})(?![\d-])/.exec(identity.major ?? "")?.[1];
  if (programme) return programme;
  if (/HTTT/i.test(text)) return "7480104";
  if (/MMT|TTDL/i.test(text)) return "7480102";
  return CNTT_MAJOR;
}

/** Active standards of a cohort (normalized code), current revision, in a deterministic order. */
async function readCohortStandards(db: Db, cohortCode: string): Promise<GraduationStandardInput[]> {
  const standards = await db.query<{ id: string; revision_id: string; version: number; data: GraduationData }>(
    `SELECT g.id,g.current_revision AS revision_id,r.version,r.data FROM graduation_standards g
     JOIN graduation_revisions r ON r.id=g.current_revision WHERE g.is_active AND g.cohort_code=$1 ORDER BY g.id`, [cohortCode]);
  return standards.rows.map((row) => ({ id: row.id, revisionId: row.revision_id, version: row.version, data: row.data }));
}

/**
 * The standard of a cohort for a specialty (resolveGraduationStandard with the full identity), among the standards of the
 * student's major (standardMajor; a profile without a major takes the cohort's, as before majors). The picked standard's
 * missing gpaScale reads 4, as everywhere else.
 */
export async function resolveCohortStandard(db: Db, cohortCode: string, specialty: SpecialtyCode | null, majorCode: string | null = null): Promise<{
  resolution: GraduationResolution; standard: GraduationStandardInput | null;
}> {
  const major = majorCode?.trim() || null;
  const candidates = (await readCohortStandards(db, cohortCode)).filter((candidate) => !major || standardMajor(standardIdentity(candidate.data)) === major);
  const resolved = resolveGraduationStandard(candidates, specialty, (candidate) => standardIdentity(candidate.data));
  const standard = resolved.standard
    ? { ...resolved.standard, data: { ...resolved.standard.data, gpaScale: resolved.standard.data.gpaScale ?? 4 } }
    : null;
  return { resolution: resolved.resolution, standard };
}

/** The standard of a profile; a profile without a cohort is "cohort_unknown" and reads no standard. */
export async function resolveStudentStandard(db: Db, profile: { cohortCode: string | null; specialty: SpecialtyCode | null; majorCode?: string | null }): Promise<{
  resolution: StudentGraduationResolution; standard: GraduationStandardInput | null;
}> {
  const cohortCode = normalizeCohortCode(profile.cohortCode);
  if (!cohortCode) return { resolution: "cohort_unknown", standard: null };
  return resolveCohortStandard(db, cohortCode, profile.specialty, profile.majorCode ?? null);
}
