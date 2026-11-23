// The queue of announcement emails (ad_announcement_emails, migration 066; AD-NOTI-04, 05). An announcement sent with email
// queues one message per recipient in its own transaction; the mail worker (worker.ts) sends them from the sender's
// mailbox a few at a time, so at most 24 a minute leave one mailbox (Exchange Online allows 30), and retries a temporary
// failure after 1, 5 and 15 minutes before giving up. Withdrawing the announcement cancels what has not gone out.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";

type Db = Pick<DatabasePool, "query"> | Pick<PoolClient, "query">;

/** Messages one sender may send in one tick of the worker (every 15 s: 24 a minute). */
export const EMAILS_PER_TICK = 6;
/** Attempts before a message is given up (the first and three retries). */
export const MAX_ATTEMPTS = 4;
/** Minutes before the next attempt once `attempts` have failed: 1, 5, then 15. */
export const retryDelayMinutes = (attempts: number) => (attempts <= 1 ? 1 : attempts === 2 ? 5 : 15);
/** Messages and their outcome are kept as long as the notifications (model.ts RETENTION_DAYS). */
export const EMAIL_RETENTION_DAYS = 90;

/** The address of a student's account (users u): the email claim, else the UPN when it is an address; null when neither. */
export const RECIPIENT_ADDRESS = `lower(COALESCE(CASE WHEN btrim(u.email) LIKE '_%@_%' THEN btrim(u.email) END,
  CASE WHEN btrim(u.username) LIKE '_%@_%' THEN btrim(u.username) END))`;

/** The email part of an announcement (ad_announcements a) as JSON, or null when it was sent without email. */
export const EMAIL_SUMMARY = `CASE WHEN a.email_requested THEN (SELECT json_build_object(
    'total', count(*), 'sent', count(*) FILTER (WHERE e.status='sent'), 'pending', count(*) FILTER (WHERE e.status IN ('pending','sending')),
    'failed', count(*) FILTER (WHERE e.status='failed'), 'cancelled', count(*) FILTER (WHERE e.status='cancelled'),
    'noAddress', count(*) FILTER (WHERE e.status='no_address'))
  FROM ad_announcement_emails e WHERE e.announcement_id=a.id) END`;

export type EmailCounts = { total: number; sent: number; pending: number; failed: number; cancelled: number; noAddress: number };

/** Queues one message per recipient, inside the caller's transaction (an account without an address is kept as no_address). */
export async function queueAnnouncementEmails(client: Db, announcementId: string, userIds: readonly string[]): Promise<{ queued: number; noAddress: number }> {
  if (!userIds.length) return { queued: 0, noAddress: 0 };
  const result = await client.query<{ queued: number; noAddress: number }>(
    `WITH r AS (SELECT u.id AS user_id, ${RECIPIENT_ADDRESS} AS address FROM users u WHERE u.id=ANY($2::uuid[])),
      added AS (INSERT INTO ad_announcement_emails(id,announcement_id,user_id,address,status)
        SELECT ids.id,$1,r.user_id,r.address,CASE WHEN r.address IS NULL THEN 'no_address' ELSE 'pending' END
        FROM r JOIN unnest($2::uuid[],$3::uuid[]) AS ids(user_id,id) ON ids.user_id=r.user_id
        ON CONFLICT (announcement_id,user_id) DO NOTHING RETURNING status)
      SELECT (count(*) FILTER (WHERE status='pending'))::int AS queued,(count(*) FILTER (WHERE status='no_address'))::int AS "noAddress" FROM added`,
    [announcementId, userIds, userIds.map(() => randomUUID())]);
  return result.rows[0] ?? { queued: 0, noAddress: 0 };
}

/** A message taken by the worker: where it goes, what it says and how many times it was tried (this one included). */
export type ClaimedEmail = { id: string; address: string | null; attempts: number; title: string; body: string; link: string | null; name: string | null };

/** Takes up to `limit` due messages of one sender's announcements (status sending), oldest first, skipping locked ones. */
export async function claimDueEmails(db: Db, senderId: string, limit: number): Promise<ClaimedEmail[]> {
  const result = await db.query<ClaimedEmail>(
    `WITH picked AS (
        SELECT e.id FROM ad_announcement_emails e JOIN ad_announcements a ON a.id=e.announcement_id
        WHERE e.status='pending' AND e.next_attempt_at<=now() AND a.withdrawn_at IS NULL AND a.email_sender_id=$1
        ORDER BY e.created_at,e.id LIMIT $2 FOR UPDATE OF e SKIP LOCKED),
      claimed AS (UPDATE ad_announcement_emails e SET status='sending',attempts=e.attempts+1,updated_at=now() FROM picked WHERE e.id=picked.id
        RETURNING e.id,e.announcement_id,e.user_id,e.address,e.attempts)
      SELECT c.id,c.address,c.attempts,a.title,a.body,a.link,COALESCE(NULLIF(btrim(p.full_name),''),u.display_name) AS name
      FROM claimed c JOIN ad_announcements a ON a.id=c.announcement_id
        LEFT JOIN users u ON u.id=c.user_id LEFT JOIN student_profiles p ON p.user_id=c.user_id
      ORDER BY c.id`, [senderId, limit]);
  return result.rows;
}

/** The two queues the worker sends from: the announcements' (066) and the automatic notifications' (067). */
export type EmailTable = "ad_announcement_emails" | "stu_notification_emails";

export async function markEmailSent(db: Db, id: string, table: EmailTable = "ad_announcement_emails"): Promise<void> {
  await db.query(`UPDATE ${table} SET status='sent',sent_at=now(),error=NULL,updated_at=now() WHERE id=$1`, [id]);
}

export async function markEmailRetry(db: Db, id: string, code: string, minutes: number, table: EmailTable = "ad_announcement_emails"): Promise<void> {
  await db.query(`UPDATE ${table} SET status='pending',error=$2,next_attempt_at=now()+make_interval(mins => $3),updated_at=now()
    WHERE id=$1`, [id, code.slice(0, 80), minutes]);
}

export async function markEmailFailed(db: Db, id: string, code: string, table: EmailTable = "ad_announcement_emails"): Promise<void> {
  await db.query(`UPDATE ${table} SET status='failed',error=$2,updated_at=now() WHERE id=$1`, [id, code.slice(0, 80)]);
}

/** Every due message of a sender fails with `code` (the sender's permission is gone); returns how many. */
export async function failDueEmails(db: Db, senderId: string, code: string): Promise<number> {
  const result = await db.query(
    `UPDATE ad_announcement_emails e SET status='failed',error=$2,updated_at=now() FROM ad_announcements a
      WHERE a.id=e.announcement_id AND a.email_sender_id=$1 AND a.withdrawn_at IS NULL AND e.status='pending' AND e.next_attempt_at<=now()`,
    [senderId, code.slice(0, 80)]);
  return result.rowCount ?? 0;
}

/**
 * Housekeeping of the worker: a message left "sending" by a stopped server goes back to the queue (it may go out twice,
 * rarely), and due messages whose sender's account no longer exists fail.
 */
export async function tidyEmails(db: Db): Promise<void> {
  await db.query("UPDATE ad_announcement_emails SET status='pending',updated_at=now() WHERE status='sending' AND updated_at<now()-interval '10 minutes'");
  await db.query(`UPDATE ad_announcement_emails e SET status='failed',error='sender_missing',updated_at=now() FROM ad_announcements a
    WHERE a.id=e.announcement_id AND a.email_sender_id IS NULL AND a.withdrawn_at IS NULL AND e.status='pending'`);
}

/** The senders with messages due now. */
export async function sendersWithDueEmails(db: Db): Promise<string[]> {
  const result = await db.query<{ sender: string }>(
    `SELECT DISTINCT a.email_sender_id AS sender FROM ad_announcement_emails e JOIN ad_announcements a ON a.id=e.announcement_id
      WHERE e.status='pending' AND e.next_attempt_at<=now() AND a.withdrawn_at IS NULL AND a.email_sender_id IS NOT NULL LIMIT 50`);
  return result.rows.map((row) => row.sender);
}

/** A withdrawn announcement's messages that have not gone out are cancelled (sent ones cannot be recalled). */
export async function cancelPendingEmails(db: Db, announcementId: string): Promise<number> {
  const result = await db.query(
    "UPDATE ad_announcement_emails SET status='cancelled',updated_at=now() WHERE announcement_id=$1 AND status='pending'", [announcementId]);
  return result.rowCount ?? 0;
}

/**
 * "Gửi lại thư lỗi": the failed messages are queued again, from the mailbox of the member who asks (their permission is
 * checked by the caller); returns how many.
 */
export async function retryFailedEmails(db: Db, announcementId: string, senderId: string, senderAddress: string): Promise<number> {
  const result = await db.query(
    `UPDATE ad_announcement_emails SET status='pending',attempts=0,error=NULL,next_attempt_at=now(),updated_at=now()
      WHERE announcement_id=$1 AND status='failed' AND address IS NOT NULL`, [announcementId]);
  if (result.rowCount) {
    await db.query("UPDATE ad_announcements SET email_sender_id=$2,email_from=$3 WHERE id=$1", [announcementId, senderId, senderAddress]);
  }
  return result.rowCount ?? 0;
}

export type EmailProblem = { name: string; studentCode: string | null; address: string | null; status: "failed" | "no_address"; error: string | null; at: string };

/** The messages of an announcement that did not go out: failed ones, and students without an address. */
export async function emailProblems(db: Db, announcementId: string): Promise<EmailProblem[]> {
  const result = await db.query<Omit<EmailProblem, "at"> & { at: Date | string }>(
    `SELECT COALESCE(NULLIF(btrim(p.full_name),''),u.display_name,'') AS name,p.student_code AS "studentCode",e.address,e.status,e.error,
        e.updated_at AS at
      FROM ad_announcement_emails e LEFT JOIN users u ON u.id=e.user_id LEFT JOIN student_profiles p ON p.user_id=e.user_id
      WHERE e.announcement_id=$1 AND e.status IN ('failed','no_address')
      ORDER BY e.status,p.student_code NULLS LAST,e.id LIMIT 1000`, [announcementId]);
  return result.rows.map((row) => ({ ...row, at: new Date(row.at).toISOString() }));
}

/** Messages older than the retention go, with their addresses. */
export async function purgeEmails(db: Db): Promise<void> {
  await db.query("DELETE FROM ad_announcement_emails WHERE created_at<now()-make_interval(days => $1)", [EMAIL_RETENTION_DAYS]);
}
