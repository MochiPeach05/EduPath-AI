import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";

// Date of the privacy policy a student agrees to before importing a transcript, running a competency assessment or
// saving the profile survey ("Khảo sát định hướng"). 2026-10-24: the study roadmap page, the survey and achievements, and
// the AI roadmap that reads them. 2026-10-25 (written on 24/10, the date had to change): the technologies and free-time
// interests moved into the survey and the AI roadmap reads them too. 2026-10-26 (approved by the user on 25/10, amended
// on 26/10): the Khoa's admins see the scores of every stored transcript (not the PDF), those imported earlier included,
// and the AI roadmap covers the next term instead of 3 months. 2026-10-28 (approved by the user): Trợ lý AI answers from
// these results and the survey (under its consent) and keeps the conversations until deleted or 90 days without a message.
// 2026-10-29 (user: "giữ nguyên json bảng điểm luôn và lấy thêm thông tin từ nó nữa để sinh viên có thể tra cứu"): Trợ lý
// AI also reads the transcript's scores (the printed GPA, credits and courses not passed; every row for a grade question).
// 2026-10-31 (user: "hiện đầy đủ", "Triển khai đi"): the Khoa's admin reports show each student's progress, competency
// results and Lộ trình AI courses by name, exportable to Excel; transcript views and exports are logged.
// 2026-11-03 (user: "Cập nhật luôn, không hỏi lại"): the cố vấn học tập of the student's class sees the student's pages and
// may import the transcript, run the competency assessment and the AI roadmap, ask Trợ lý AI for them (advisors/access.ts).
// 2026-11-08 (user: "điền vào .env dùm và triển khai luôn"): the AI models and the reading of scanned transcripts run on
// Cloudflare Workers AI (Gemma 4 26B, BGE-M3) instead of a PC of the team; only the transcript table of a scan is sent.
// Must equal `policyVersion` in apps/web/src/public-information.ts (checked by consent.test.ts).
export const TRANSCRIPT_POLICY_VERSION = "2026-11-08";
/**
 * The oldest policy version whose consents still count, so 2026-10-26, 2026-10-28, 2026-10-29, 2026-10-31, 2026-11-03 and 2026-11-08 ask no one again (user,
 * 2026-10-26: "không để lại ghi chú gì hết"); new consents are recorded under TRANSCRIPT_POLICY_VERSION. Must equal
 * `consentValidSince` in apps/web/src/public-information.ts (checked by consent.test.ts).
 */
export const CONSENT_VALID_SINCE = "2026-10-25";
/** An active consent given under CONSENT_VALID_SINCE or a later version. */
export const isValidConsent = (version: string | null | undefined) => typeof version === "string" && version >= CONSENT_VALID_SINCE;

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

/** Whether the student withdrew the consent for a purpose and has not given it again (e.g. "Xóa kết quả đánh giá"). */
export async function consentWithdrawn(db: Pick<DatabasePool, "query"> | PoolClient, userId: string, purpose: ConsentPurpose): Promise<boolean> {
  const result = await db.query<{ withdrawn: boolean }>(
    `SELECT NOT EXISTS (SELECT 1 FROM data_consents WHERE user_id=$1 AND purpose=$2 AND ended_at IS NULL)
       AND EXISTS (SELECT 1 FROM data_consents WHERE user_id=$1 AND purpose=$2 AND end_reason='withdrawn') AS withdrawn`, [userId, purpose]);
  return result.rows[0]?.withdrawn === true;
}

/** Policy version of the student's active consent for a purpose, or null when none is active. */
export async function activeConsentVersion(db: Pick<DatabasePool, "query"> | PoolClient, userId: string, purpose: ConsentPurpose): Promise<string | null> {
  const result = await db.query<{ policy_version: string }>(
    "SELECT policy_version FROM data_consents WHERE user_id=$1 AND purpose=$2 AND ended_at IS NULL", [userId, purpose]);
  return result.rows[0]?.policy_version ?? null;
}
