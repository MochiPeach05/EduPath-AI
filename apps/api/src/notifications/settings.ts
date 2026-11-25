// Cài đặt thông báo (AD-NOTI-06, 2026-11-23; function list: "bật/tắt từng loại thông báo được phép gửi bên trang sinh
// viên"): an admin may stop a kind of automatic notification, and since the same evening (user: "ngoài có thể cập nhật
// thông báo cho thông báo ở trang sinh viên thì có thể gửi tới email những thông báo này nữa") also send it to the
// students' school mailbox. A row of ad_notification_settings (migrations 066, 067) holds what differs from the default:
// enabled=false turns the bell notification off, email_enabled=true sends it by email too; no row means on, without
// email. Turning a kind off stops new notifications only: those already in a bell stay. The faculty's announcements are
// always written (their email is chosen when each is sent), and so are the notifications of a cố vấn học tập's actions (the
// privacy policy promises the student is told whenever someone acts for them): only their email can be turned on.
// The emails leave from one school mailbox, named in ad_notification_mail: the admin who turns the first email on, or who
// presses "Dùng hộp thư của tôi"; the permission itself is that admin's row of ad_mail_senders (mail/grants.ts).
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { personName } from "../users/person-name.js";

type Db = Pick<DatabasePool, "query"> | Pick<PoolClient, "query">;

export const NOTIFICATION_SETTINGS = [
  { key: "transcript", label: "Đọc bảng điểm", detail: "Bảng điểm PDF sinh viên tải lên đã đọc xong, hoặc chưa đọc được.", bellLocked: false },
  { key: "assessment_comment", label: "Nhận xét năng lực của AI", detail: "AI viết xong nhận xét sau một lần Đánh giá năng lực.", bellLocked: false },
  { key: "roadmap", label: "Lộ trình AI", detail: "Lộ trình học tập AI gợi ý đã xong, hoặc chưa tạo được.", bellLocked: false },
  { key: "graduation_advice", label: "Nhận xét xét tốt nghiệp của AI", detail: "AI viết xong nhận xét ở trang Xét tốt nghiệp.", bellLocked: false },
  { key: "warning", label: "Cảnh báo chậm tiến độ", detail: "Một cảnh báo mới xuất hiện ở trang Tổng quan của sinh viên.", bellLocked: false },
  { key: "catalog_updated", label: "Khoa cập nhật dữ liệu học tập", detail: "Khoa thay đổi chương trình đào tạo, kế hoạch đào tạo hoặc tiêu chuẩn xét tốt nghiệp của sinh viên.", bellLocked: false },
  { key: "advisor_action", label: "Việc làm thay sinh viên", detail: "Cố vấn học tập, quản trị viên hoặc Ban chủ nhiệm khoa làm thay sinh viên một việc trên EduPath AI. Sinh viên luôn được báo trong chuông.", bellLocked: true },
  // 2026-11-25: the reminders of Lịch đăng ký học tập (registration.ts), under EduPath AI's name.
  { key: "registration", label: "Nhắc đăng ký học tập", detail: "Khi đến thời gian của một đợt ở trang Lịch đăng ký, EduPath AI nhắc sinh viên của đợt đó đăng ký kế hoạch học tập hoặc đăng ký học phần.", bellLocked: false },
] as const;
export type NotificationSettingKey = (typeof NOTIFICATION_SETTINGS)[number]["key"];
export const NOTIFICATION_SETTING_KEYS = NOTIFICATION_SETTINGS.map((item) => item.key) as [NotificationSettingKey, ...NotificationSettingKey[]];
/** Emails of the last this many days are counted on the page and may be sent again. */
export const EMAIL_STATS_DAYS = 30;

/** SQL: the setting a notification kind (a text expression) belongs to; announcement belongs to none. */
export const settingOfKind = (kind: string) =>
  `(CASE WHEN ${kind} IN ('transcript_ready','transcript_failed') THEN 'transcript' WHEN ${kind} IN ('roadmap_ready','roadmap_failed') THEN 'roadmap'
    WHEN ${kind}='registration_reminder' THEN 'registration' ELSE ${kind} END)`;
/** SQL: true when an admin turned the kind off (advisor_action never: migration 067 keeps its row enabled). */
export const kindTurnedOff = (kind: string) => `EXISTS (SELECT 1 FROM ad_notification_settings s WHERE NOT s.enabled AND s.setting=${settingOfKind(kind)})`;
/** SQL: true when an admin turned the kind's email on. */
export const kindEmailed = (kind: string) => `EXISTS (SELECT 1 FROM ad_notification_settings s WHERE s.email_enabled AND s.setting=${settingOfKind(kind)})`;

/** The emails of a kind over the last EMAIL_STATS_DAYS days. */
export type EmailStats = { sent: number; pending: number; failed: number; noAddress: number };
export type NotificationSetting = {
  key: NotificationSettingKey; label: string; detail: string; bellLocked: boolean;
  enabled: boolean; email: boolean; updatedAt: string | null; updatedBy: string | null; emails: EmailStats;
};
const NO_EMAILS: EmailStats = { sent: 0, pending: 0, failed: 0, noAddress: 0 };

export async function listNotificationSettings(db: Db): Promise<NotificationSetting[]> {
  const rows = (await db.query<{ setting: NotificationSettingKey; enabled: boolean; email: boolean; updatedAt: Date | string; updatedBy: string | null }>(
    `SELECT s.setting,s.enabled,s.email_enabled AS email,s.updated_at AS "updatedAt",u.display_name AS "updatedBy"
      FROM ad_notification_settings s LEFT JOIN users u ON u.id=s.updated_by`)).rows;
  const stats = (await db.query<EmailStats & { setting: string }>(
    `SELECT ${settingOfKind("e.kind")} AS setting,(count(*) FILTER (WHERE e.status='sent'))::int AS sent,
        (count(*) FILTER (WHERE e.status IN ('pending','sending')))::int AS pending,(count(*) FILTER (WHERE e.status='failed'))::int AS failed,
        (count(*) FILTER (WHERE e.status='no_address'))::int AS "noAddress"
      FROM stu_notification_emails e WHERE e.created_at>now()-make_interval(days => $1) GROUP BY 1`, [EMAIL_STATS_DAYS])).rows;
  return NOTIFICATION_SETTINGS.map((item) => {
    const row = rows.find((candidate) => candidate.setting === item.key);
    const counted = stats.find((candidate) => candidate.setting === item.key);
    return {
      ...item, enabled: item.bellLocked || (row?.enabled ?? true), email: row?.email ?? false,
      updatedAt: row ? new Date(row.updatedAt).toISOString() : null, updatedBy: row?.updatedBy ? personName(row.updatedBy) || row.updatedBy : null,
      emails: counted ? { sent: counted.sent, pending: counted.pending, failed: counted.failed, noAddress: counted.noAddress } : NO_EMAILS,
    };
  });
}

/**
 * Turns a kind's bell notification and/or its email on or off. Turning the bell off turns the email off too (an email goes
 * only with a notification); an email turned off cancels the kind's messages that have not gone out.
 */
export async function saveNotificationSetting(db: Db, key: NotificationSettingKey, change: { enabled?: boolean | undefined; email?: boolean | undefined },
  actorId: string): Promise<NotificationSetting> {
  const saved = (await db.query<{ email: boolean }>(
    `INSERT INTO ad_notification_settings(setting,enabled,email_enabled,updated_by)
        VALUES($1,COALESCE($2::boolean,true),COALESCE($3::boolean,false) AND COALESCE($2::boolean,true),$4)
      ON CONFLICT (setting) DO UPDATE SET enabled=COALESCE($2::boolean,ad_notification_settings.enabled),
        email_enabled=COALESCE($3::boolean,ad_notification_settings.email_enabled) AND COALESCE($2::boolean,ad_notification_settings.enabled),
        updated_at=now(),updated_by=EXCLUDED.updated_by
      RETURNING email_enabled AS email`, [key, change.enabled ?? null, change.email ?? null, actorId])).rows[0];
  if (saved && !saved.email) {
    await db.query(`UPDATE stu_notification_emails SET status='cancelled',updated_at=now() WHERE status='pending' AND ${settingOfKind("kind")}=$1`, [key]);
  }
  return (await listNotificationSettings(db)).find((item) => item.key === key)!;
}

/** Whose mailbox sends the automatic emails: name, the address of their permission (null: none any more) and its error. */
export type AutoMailSender = { userId: string; name: string | null; address: string | null; lastError: string | null };

export async function autoMailSender(db: Db): Promise<AutoMailSender | null> {
  const row = (await db.query<AutoMailSender>(
    `SELECT m.sender_id AS "userId",u.display_name AS name,s.address,s.last_error AS "lastError"
      FROM ad_notification_mail m LEFT JOIN users u ON u.id=m.sender_id LEFT JOIN ad_mail_senders s ON s.user_id=m.sender_id
      WHERE m.sender_id IS NOT NULL`)).rows[0];
  return row ? { ...row, name: row.name ? personName(row.name) || row.name : null } : null;
}
/** A sender whose permission works: it exists and Microsoft has not asked to allow again. */
export const usableAutoSender = (sender: AutoMailSender | null) => Boolean(sender?.address && !sender.lastError);

/** The automatic emails leave from `userId`'s mailbox from now on, the queued ones too. */
export async function setAutoMailSender(db: Db, userId: string, actorId: string): Promise<void> {
  await db.query(
    `INSERT INTO ad_notification_mail(id,sender_id,updated_by) VALUES(true,$1,$2)
      ON CONFLICT (id) DO UPDATE SET sender_id=EXCLUDED.sender_id,updated_at=now(),updated_by=EXCLUDED.updated_by`, [userId, actorId]);
  await db.query("UPDATE stu_notification_emails SET sender_id=$1,updated_at=now() WHERE status='pending' AND sender_id IS DISTINCT FROM $1", [userId]);
}

/** "Gửi lại email lỗi": the failed automatic emails of the last EMAIL_STATS_DAYS days go again from `senderId`'s mailbox. */
export async function retryFailedNotificationEmails(db: Db, senderId: string): Promise<number> {
  const result = await db.query(
    `UPDATE stu_notification_emails SET status='pending',attempts=0,error=NULL,next_attempt_at=now(),updated_at=now(),sender_id=$1
      WHERE status='failed' AND address IS NOT NULL AND notification_id IS NOT NULL AND created_at>now()-make_interval(days => $2)`,
    [senderId, EMAIL_STATS_DAYS]);
  return result.rowCount ?? 0;
}
