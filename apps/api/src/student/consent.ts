import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";

// Date of the privacy policy a student agrees to before importing a transcript, running a competency assessment or
// saving the profile survey ("Khảo sát định hướng"). 2026-10-24: the study roadmap page, the survey and achievements, and
// the AI roadmap that reads them. 2026-10-25 (written on 24/10, the date had to change): the technologies and free-time
// interests moved into the survey and the AI roadmap reads them too. 2026-10-26 (approved by the user on 25/10): the
// Khoa's admins may see a student's transcript scores (not the PDF) once the student agrees to this version, and the AI
// roadmap covers the next term instead of 3 months.
// Must equal `policyVersion` in apps/web/src/public-information.ts (checked by consent.test.ts).
export const TRANSCRIPT_POLICY_VERSION = "2026-10-26";
/** The first policy version under which the Khoa's admins may see a student's transcript scores (user, 2026-10-25). */
export const STAFF_TRANSCRIPT_SINCE = "2026-10-26";
/** The student's transcript consent allows the admin view: given under STAFF_TRANSCRIPT_SINCE or a later version. */
export const allowsStaffTranscript = (consentVersion: string | null) => consentVersion !== null && consentVersion >= STAFF_TRANSCRIPT_SINCE;

/** data_consents.purpose values allowed by migrations 018, 030 and 048. */
export type ConsentPurpose = "transcript_processing" | "competency_assessment" | "profile_survey";

// Caller holds the user's row lock. Consent to a newer policy supersedes the active one;
// repeating consent to the same version keeps the original record.
export async function recordConsent(client: PoolClient, userId: string, purpose: ConsentPurpose) {
  await client.query(`UPDATE data_consents SET ended_at=now(),end_reason='superseded'
    WHERE user_id=$1 AND purpose=$3 AND ended_at IS NULL AND policy_version<>$2`, [userId, TRANSCRIPT_POLICY_VERSION, purpose]);
  await client.query(`INSERT INTO data_consents(id,user_id,purpose,policy_version) VALUES($1,$2,$4,$3)
    ON CONFLICT(user_id,purpose) WHERE ended_at IS NULL DO NOTHING`, [randomUUID(), userId, TRANSCRIPT_POLICY_VERSION, purpose]);
}

export async function withdrawConsent(client: PoolClient, userId: string, purpose: ConsentPurpose) {
  await client.query(`UPDATE data_consents SET ended_at=now(),end_reason='withdrawn'
    WHERE user_id=$1 AND purpose=$2 AND ended_at IS NULL`, [userId, purpose]);
}

export const recordTranscriptConsent = (client: PoolClient, userId: string) => recordConsent(client, userId, "transcript_processing");
export const withdrawTranscriptConsent = (client: PoolClient, userId: string) => withdrawConsent(client, userId, "transcript_processing");

/** Policy version of the student's active consent for a purpose, or null when none is active. */
export async function activeConsentVersion(db: Pick<DatabasePool, "query"> | PoolClient, userId: string, purpose: ConsentPurpose): Promise<string | null> {
  const result = await db.query<{ policy_version: string }>(
    "SELECT policy_version FROM data_consents WHERE user_id=$1 AND purpose=$2 AND ended_at IS NULL", [userId, purpose]);
  return result.rows[0]?.policy_version ?? null;
}
