// The queue of the automatic notifications' emails (stu_notification_emails, migration 067; Cài đặt thông báo, 2026-11-23).
// A notification written while its kind's email is on queues one message, in the same statement chain as the notification
// (notify.ts); the mail worker (worker.ts) sends it from the mailbox named in ad_notification_mail, sharing that mailbox's
// 24 messages a minute with its announcement emails, and retries a temporary failure like them. A message whose
// notification the student deleted, or whose kind's email was turned off, before it went out is cancelled.
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { kindEmailed } from "../notifications/settings.js";
import { EMAIL_RETENTION_DAYS, RECIPIENT_ADDRESS } from "./outbox.js";

type Db = Pick<DatabasePool, "query"> | Pick<PoolClient, "query">;

/** Queues the email of the notifications just written (their ids) whose kind's email is on, while a sender is named. */
export async function queueNotificationEmails(db: Db, notificationIds: readonly string[]): Promise<number> {
  if (!notificationIds.length) return 0;
  const result = await db.query(
    `INSERT INTO stu_notification_emails(id,notification_id,user_id,kind,sender_id,address,status)
      SELECT gen_random_uuid(),n.id,n.user_id,n.kind,m.sender_id,r.address,CASE WHEN r.address IS NULL THEN 'no_address' ELSE 'pending' END
      FROM stu_notifications n JOIN users u ON u.id=n.user_id CROSS JOIN ad_notification_mail m
        CROSS JOIN LATERAL (SELECT ${RECIPIENT_ADDRESS} AS address) r
      WHERE n.id=ANY($1::uuid[]) AND m.sender_id IS NOT NULL AND ${kindEmailed("n.kind")}
      ON CONFLICT (notification_id) DO NOTHING`, [notificationIds]);
  return result.rowCount ?? 0;
}

/** A message taken by the worker: where it goes and what the notification says. */
export type ClaimedNotificationEmail = {
  id: string; address: string | null; attempts: number; title: string; body: string; link: string | null; linkLabel: string | null; name: string | null;
};

/** Takes up to `limit` due messages of one sender (status sending), oldest first, skipping locked ones. */
export async function claimDueNotificationEmails(db: Db, senderId: string, limit: number): Promise<ClaimedNotificationEmail[]> {
  if (limit <= 0) return [];
  const result = await db.query<ClaimedNotificationEmail>(
    `WITH picked AS (
        SELECT e.id FROM stu_notification_emails e JOIN stu_notifications n ON n.id=e.notification_id
        WHERE e.status='pending' AND e.next_attempt_at<=now() AND e.sender_id=$1 AND n.deleted_at IS NULL
        ORDER BY e.created_at,e.id LIMIT $2 FOR UPDATE OF e SKIP LOCKED),
      claimed AS (UPDATE stu_notification_emails e SET status='sending',attempts=e.attempts+1,updated_at=now() FROM picked WHERE e.id=picked.id
        RETURNING e.id,e.notification_id,e.user_id,e.address,e.attempts)
      SELECT c.id,c.address,c.attempts,n.title,n.body,n.link,n.link_label AS "linkLabel",COALESCE(NULLIF(btrim(p.full_name),''),u.display_name) AS name
      FROM claimed c JOIN stu_notifications n ON n.id=c.notification_id
        LEFT JOIN users u ON u.id=c.user_id LEFT JOIN student_profiles p ON p.user_id=c.user_id
      ORDER BY c.id`, [senderId, limit]);
  return result.rows;
}

export async function sendersWithDueNotificationEmails(db: Db): Promise<string[]> {
  const result = await db.query<{ sender: string }>(
    `SELECT DISTINCT e.sender_id AS sender FROM stu_notification_emails e
      WHERE e.status='pending' AND e.next_attempt_at<=now() AND e.sender_id IS NOT NULL LIMIT 50`);
  return result.rows.map((row) => row.sender);
}

/** Every due message of a sender fails with `code` (the sender's permission is gone); returns how many. */
export async function failDueNotificationEmails(db: Db, senderId: string, code: string): Promise<number> {
  const result = await db.query(
    "UPDATE stu_notification_emails SET status='failed',error=$2,updated_at=now() WHERE sender_id=$1 AND status='pending' AND next_attempt_at<=now()",
    [senderId, code.slice(0, 80)]);
  return result.rowCount ?? 0;
}

/**
 * Housekeeping of the worker: a message left "sending" by a stopped server goes back to the queue, one whose notification
 * is gone or deleted is cancelled, and one without a sender (the account deleted) fails.
 */
export async function tidyNotificationEmails(db: Db): Promise<void> {
  await db.query("UPDATE stu_notification_emails SET status='pending',updated_at=now() WHERE status='sending' AND updated_at<now()-interval '10 minutes'");
  await db.query(`UPDATE stu_notification_emails e SET status='cancelled',updated_at=now() WHERE e.status='pending'
    AND (e.notification_id IS NULL OR EXISTS (SELECT 1 FROM stu_notifications n WHERE n.id=e.notification_id AND n.deleted_at IS NOT NULL))`);
  await db.query("UPDATE stu_notification_emails SET status='failed',error='sender_missing',updated_at=now() WHERE status='pending' AND sender_id IS NULL");
}

/** Messages older than the retention go, with their addresses. */
export async function purgeNotificationEmails(db: Db): Promise<void> {
  await db.query("DELETE FROM stu_notification_emails WHERE created_at<now()-make_interval(days => $1)", [EMAIL_RETENTION_DAYS]);
}
