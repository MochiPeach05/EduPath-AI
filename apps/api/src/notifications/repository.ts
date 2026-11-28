// Storage of the notifications (stu_notifications) and the faculty's announcements (ad_announcements), migration 056.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { foldText } from "../admin/audit/record.js";
import { foldSql } from "../admin/fold-sql.js";
import { orderBy, byText, vietnameseOrder, type SortDirection } from "../admin/table-sort.js";
import { CLASS_OF } from "../advisors/class-code.js";
import { personName } from "../users/person-name.js";
import { MAJORS } from "../curricula/majors.js";
import type { DatabasePool } from "../db/pool.js";
import {
  ANNOUNCEMENT_STUDENTS_MAX, notificationColumns, NOTIFICATION_TOPIC, RESTORE_MINUTES, RETENTION_DAYS, type AnnouncementRow, type AnnouncementSender, type AnnouncementTarget,
  type NotificationOrder,
  type NotificationRow, type NotificationType,
} from "./model.js";
import { notifyMany } from "./notify.js";
import { purgeNotificationEmails } from "../mail/notification-outbox.js";
import { cancelPendingEmails, EMAIL_SUMMARY, purgeEmails, queueAnnouncementEmails, RECIPIENT_ADDRESS } from "../mail/outbox.js";

type Db = Pick<DatabasePool, "query"> | Pick<PoolClient, "query">;

/* ------------------------------------------------------------------------ */
/* Student side */

export type NotificationFilter = "all" | "unread" | NotificationType;

/**
 * The notifications a student sees ($1): not deleted, and only the newest of each topic (model.ts NOTIFICATION_TOPIC). The
 * list and the badge's count read the same rows, so the badge always equals the unread notifications listed.
 */
const VISIBLE = `SELECT DISTINCT ON ${NOTIFICATION_TOPIC} * FROM stu_notifications WHERE user_id=$1 AND deleted_at IS NULL
  ORDER BY ${NOTIFICATION_TOPIC},created_at DESC,id DESC`;

export async function listNotifications(db: Db, userId: string, filter: NotificationFilter, limit: number, order: NotificationOrder = "newest"): Promise<NotificationRow[]> {
  const condition = filter === "all" ? "" : filter === "unread" ? "WHERE read_at IS NULL" : "WHERE type=$3";
  const params: unknown[] = [userId, limit];
  if (filter !== "all" && filter !== "unread") params.push(filter);
  const sort = order === "unread" ? "(read_at IS NULL) DESC,created_at DESC,id DESC" : "created_at DESC,id DESC";
  const result = await db.query<NotificationRow>(
    `SELECT ${notificationColumns} FROM (${VISIBLE}) n ${condition} ORDER BY ${sort} LIMIT $2`, params);
  return result.rows;
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const result = await db.query<{ unread: number }>(`SELECT count(*)::int AS unread FROM (${VISIBLE}) n WHERE read_at IS NULL`, [userId]);
  return result.rows[0]?.unread ?? 0;
}

/** read: mark read (keeps the first time) or unread; null when the student has no such notification. */
export async function setRead(db: Db, userId: string, id: string, read: boolean): Promise<NotificationRow | null> {
  const result = await db.query<NotificationRow>(
    `UPDATE stu_notifications SET read_at=${read ? "COALESCE(read_at,now())" : "NULL"}
      WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING ${notificationColumns}`, [id, userId]);
  return result.rows[0] ?? null;
}

export async function readAll(db: Db, userId: string): Promise<void> {
  await db.query("UPDATE stu_notifications SET read_at=now() WHERE user_id=$1 AND deleted_at IS NULL AND read_at IS NULL", [userId]);
}

/**
 * Soft delete, so "Hoàn tác" can bring it back for a moment; false when there is nothing to delete. The older notifications
 * of the same topic go with it, so deleting one never brings an older one about the same thing back into the bell.
 */
export async function deleteNotification(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE stu_notifications SET deleted_at=now() WHERE user_id=$2 AND deleted_at IS NULL
      AND ${NOTIFICATION_TOPIC}=(SELECT ${NOTIFICATION_TOPIC} FROM stu_notifications WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL)`, [id, userId]);
  return Boolean(result.rowCount);
}

/** Undoes a delete made in the last RESTORE_MINUTES; null otherwise. */
export async function restoreNotification(db: Db, userId: string, id: string): Promise<NotificationRow | null> {
  const result = await db.query<NotificationRow>(
    `UPDATE stu_notifications SET deleted_at=NULL WHERE id=$1 AND user_id=$2 AND deleted_at>now()-make_interval(mins => $3)
      RETURNING ${notificationColumns}`, [id, userId, RESTORE_MINUTES]);
  return result.rows[0] ?? null;
}

/**
 * Housekeeping: notifications older than RETENTION_DAYS go; a student's deletion becomes final after a day, except for
 * warnings, which stay hidden until the 90-day purge so the same warning is not notified again; the notifications of a
 * withdrawn announcement go.
 */
export async function purgeNotifications(db: Db): Promise<void> {
  await db.query("DELETE FROM stu_notifications WHERE created_at<now()-make_interval(days => $1)", [RETENTION_DAYS]);
  // Who was picked one by one is kept as long as their notifications; then only how many (review 25/11/2026).
  await db.query(`UPDATE ad_announcements SET target=(target-'students')||jsonb_build_object('picked',jsonb_array_length(target->'students'))
    WHERE jsonb_typeof(target->'students')='array' AND created_at<now()-make_interval(days => $1)`, [RETENTION_DAYS]);
  await db.query("DELETE FROM stu_notifications WHERE deleted_at<now()-interval '1 day' AND kind<>'warning'");
  await db.query("DELETE FROM stu_notifications n USING ad_announcements a WHERE n.announcement_id=a.id AND a.withdrawn_at IS NOT NULL");
  // The emails (addresses and outcomes) are kept as long as the notifications.
  await purgeEmails(db);
  await purgeNotificationEmails(db);
}

/** Runs purgeNotifications at most once per interval in this process (the bell's poll triggers it). */
export function createNotificationHousekeeping(intervalMs = 60 * 60 * 1000) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Db): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await purgeNotifications(db);
    return true;
  };
}

/* ------------------------------------------------------------------------ */
/* Faculty side: announcements */

/**
 * The students an announcement reaches: active student accounts (no staff mailbox) of the chosen cohorts and majors, or
 * the picked students among them. Four parameters from `first`: cohorts, majors, staff domains, picked account ids.
 */
function recipientsWhere(first: number) {
  return `u.is_active AND COALESCE(u.role_override,u.role)='student'
    AND (cardinality($${first}::text[])=0 OR p.cohort_code=ANY($${first}::text[]))
    AND (cardinality($${first + 1}::text[])=0 OR p.major_code::text=ANY($${first + 1}::text[]))
    AND NOT (lower(split_part(COALESCE(u.email,''),'@',2))=ANY($${first + 2}::text[])
      OR lower(split_part(COALESCE(u.username,''),'@',2))=ANY($${first + 2}::text[]))
    AND (cardinality($${first + 3}::uuid[])=0 OR u.id=ANY($${first + 3}::uuid[]))`;
}
const recipientsFrom = "FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id";
const targetParams = (target: AnnouncementTarget, staffDomains: readonly string[]) => [target.cohorts, target.majors, staffDomains, target.students ?? []];

export async function announcementOptions(db: Db, staffDomains: readonly string[]) {
  const result = await db.query<{ cohort: string | null; major: string | null }>(
    `SELECT DISTINCT p.cohort_code AS cohort,p.major_code::text AS major ${recipientsFrom} WHERE ${recipientsWhere(1)}`, [[], [], staffDomains, []]);
  const cohorts = [...new Set(result.rows.map((row) => row.cohort).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")) || a.localeCompare(b));
  const majors = [...new Set(result.rows.map((row) => row.major?.trim()).filter((value): value is string => Boolean(value)))]
    .sort(facultyMajorsFirst)
    .map((code) => ({ code, name: majorName(code) }));
  return { cohorts, majors };
}

/**
 * The name of a major on the announcement pages: a faculty major by its name (curricula/majors.ts), any other programme
 * code as "Ngành khác (mã 7340201)" rather than the bare code (2026-11-04 QA).
 */
export const majorName = (code: string) => MAJORS.find((major) => major.code === code)?.label ?? `Ngành khác (mã ${code})`;
/** The faculty's majors first, then any other programme an MSSV names (a student of another faculty), each by code. */
const otherMajor = (code: string) => Number(!MAJORS.some((major) => major.code === code));
const facultyMajorsFirst = (a: string, b: string) => otherMajor(a) - otherMajor(b) || a.localeCompare(b);

/** Who an announcement reaches, and how many of them have a school mailbox for its email (AD-NOTI-04). */
export async function reachCount(db: Db, target: AnnouncementTarget, staffDomains: readonly string[]): Promise<{ count: number; withEmail: number }> {
  const result = await db.query<{ count: number; withEmail: number }>(
    `SELECT count(*)::int AS count,count(${RECIPIENT_ADDRESS})::int AS "withEmail" ${recipientsFrom} WHERE ${recipientsWhere(1)}`,
    targetParams(target, staffDomains));
  const row = result.rows[0];
  return { count: row?.count ?? 0, withEmail: row?.withEmail ?? row?.count ?? 0 };
}

/**
 * A student as "Chọn sinh viên" lists one (2026-11-25): the name as the admin lists show it, MSSV, class in its canonical
 * form (71K29CNTT08) and whether the account has an address for the email.
 */
export type RecipientStudent = { id: string; name: string; studentCode: string | null; className: string | null; cohort: string | null; hasEmail: boolean };
const STUDENT_NAME = "COALESCE(NULLIF(btrim(p.full_name),''),u.display_name)";
const studentColumns = `u.id,${STUDENT_NAME} AS name,p.student_code AS "studentCode",${CLASS_OF} AS "className",p.cohort_code AS cohort,
  (${RECIPIENT_ADDRESS} IS NOT NULL) AS "hasEmail"`;
// By given name, then the whole name, as the admin's student list orders people.
const studentOrder = `${vietnameseOrder(`NULLIF(regexp_replace(btrim(${STUDENT_NAME}), '^.*\\s', ''), '')`)},${vietnameseOrder(STUDENT_NAME)},u.id`;
/** An account named "MSSV - Họ tên - Lớp" by Microsoft is shown by the name alone. */
const presentStudent = (row: RecipientStudent): RecipientStudent => ({ ...row, name: personName(row.name) || row.name });

/**
 * The students an announcement may be sent to whose name, MSSV, class or address holds every word typed (tones and case
 * ignored: "hoa" finds "Hòa"), the first `limit` by name; no word typed lists the first students.
 */
export async function searchRecipients(db: Db, term: string, staffDomains: readonly string[], limit: number): Promise<RecipientStudent[]> {
  const words = foldText(term).split(" ").filter(Boolean).slice(0, 8);
  const haystack = foldSql(`concat_ws(' ',p.full_name,u.display_name,p.student_code,${CLASS_OF},u.email)`);
  const result = await db.query<RecipientStudent>(
    `SELECT ${studentColumns} ${recipientsFrom}
      WHERE ${recipientsWhere(1)} AND NOT EXISTS (SELECT 1 FROM unnest($5::text[]) AS word WHERE strpos(${haystack},word)=0)
      ORDER BY ${studentOrder} LIMIT $6`, [[], [], staffDomains, [], words, limit]);
  return result.rows.map(presentStudent);
}

/** The students an announcement was sent to by picking them (their accounts as they are now), by name. */
export async function announcementStudents(db: Db, ids: readonly string[]): Promise<RecipientStudent[]> {
  if (!ids.length) return [];
  const result = await db.query<RecipientStudent>(
    `SELECT ${studentColumns} ${recipientsFrom} WHERE u.id=ANY($1::uuid[]) ORDER BY ${studentOrder} LIMIT ${ANNOUNCEMENT_STUDENTS_MAX}`, [ids]);
  return result.rows.map(presentStudent);
}

export function targetLabel(target: AnnouncementTarget): string {
  const picked = target.students?.length || target.picked || 0;
  if (picked) return `${picked.toLocaleString("vi-VN")} sinh viên được chọn`;
  if (!target.cohorts.length && !target.majors.length) return "Tất cả sinh viên";
  return [target.cohorts.join(", "), [...target.majors].sort(facultyMajorsFirst).map(majorName).join(", ")].filter(Boolean).join(" · ");
}

const announcementColumns = `a.id,a.title,a.body,a.link,a.target,a.recipients,a.created_at AS "createdAt",a.withdrawn_at AS "withdrawnAt",
  u.display_name AS "createdBy",
  (SELECT count(*)::int FROM stu_notifications n WHERE n.announcement_id=a.id AND n.read_at IS NOT NULL) AS read,
  a.email_requested AS "emailRequested",a.email_from AS "emailFrom",${EMAIL_SUMMARY} AS email,a.sender`;

export const ANNOUNCEMENT_SORT = {
  title: byText("a.title"),
  createdAt: ["a.created_at"],
  recipients: ["a.recipients"],
  read: ["(SELECT count(*) FROM stu_notifications n WHERE n.announcement_id=a.id AND n.read_at IS NOT NULL)"],
} as const;
export type AnnouncementSortKey = keyof typeof ANNOUNCEMENT_SORT;

export async function listAnnouncements(db: Db, sort?: string, dir?: SortDirection): Promise<AnnouncementRow[]> {
  const result = await db.query<AnnouncementRow>(
    `SELECT ${announcementColumns} FROM ad_announcements a LEFT JOIN users u ON u.id=a.created_by
      ORDER BY ${orderBy(ANNOUNCEMENT_SORT, [["a.created_at", "DESC"], ["a.id", "DESC"]], sort, dir)} LIMIT 500`);
  return result.rows;
}

export async function findAnnouncement(db: Db, id: string): Promise<AnnouncementRow | null> {
  const result = await db.query<AnnouncementRow>(
    `SELECT ${announcementColumns} FROM ad_announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1`, [id]);
  return result.rows[0] ?? null;
}

export type AnnouncementInput = {
  title: string; body: string; link: string | null; target: AnnouncementTarget;
  /** The Khoa (default) or EduPath AI: the bell's "Từ Khoa" or "Hệ thống", and the email's last line. */
  sender?: AnnouncementSender;
};
/** Email with the announcement (AD-NOTI-04): from the actor's school mailbox, whose permission the caller checked. */
export type AnnouncementEmail = { senderId: string; from: string };

/**
 * Sends an announcement inside the caller's transaction: the announcement, then one notification per recipient (type
 * "khoa", kind "announcement", source_key "announcement:<id>"), and with `email` one queued message per recipient (the
 * mail worker sends them). null when it reaches nobody.
 */
export async function sendAnnouncement(client: Pick<PoolClient, "query">, actorId: string, input: AnnouncementInput,
  staffDomains: readonly string[], email: AnnouncementEmail | null = null): Promise<AnnouncementRow | null> {
  const recipients = (await client.query<{ id: string }>(
    `SELECT u.id ${recipientsFrom} WHERE ${recipientsWhere(1)} ORDER BY u.id`, targetParams(input.target, staffDomains))).rows.map((row) => row.id);
  if (!recipients.length) return null;
  const id = randomUUID();
  // Picked students: the announcement keeps those it really reached (an account locked meanwhile is left out).
  const target: AnnouncementTarget = input.target.students?.length
    ? { cohorts: [], majors: [], students: recipients } : { cohorts: input.target.cohorts, majors: input.target.majors };
  const sender: AnnouncementSender = input.sender ?? "khoa";
  await client.query(
    `INSERT INTO ad_announcements(id,title,body,link,target,recipients,created_by,sender) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
    [id, input.title, input.body, input.link, JSON.stringify(target), recipients.length, actorId, sender]);
  await notifyMany(client, recipients, {
    type: sender === "edupath" ? "sys" : "khoa", kind: "announcement", title: input.title, body: input.body, link: input.link,
    sourceKey: `announcement:${id}`, announcementId: id,
  });
  if (email) {
    await client.query("UPDATE ad_announcements SET email_requested=true,email_sender_id=$2,email_from=$3 WHERE id=$1", [id, email.senderId, email.from]);
    await queueAnnouncementEmails(client, id, recipients);
  }
  return findAnnouncement(client, id);
}

/**
 * Withdraws an announcement and takes it out of every bell, and cancels its emails that have not gone out (a sent email
 * cannot be recalled); "missing" or "withdrawn" (already) otherwise.
 */
export async function withdrawAnnouncement(client: Pick<PoolClient, "query">, id: string): Promise<AnnouncementRow | "missing" | "withdrawn"> {
  const updated = await client.query("UPDATE ad_announcements SET withdrawn_at=now() WHERE id=$1 AND withdrawn_at IS NULL", [id]);
  if (!updated.rowCount) return (await client.query("SELECT 1 FROM ad_announcements WHERE id=$1", [id])).rowCount ? "withdrawn" : "missing";
  await client.query("UPDATE stu_notifications SET deleted_at=now() WHERE announcement_id=$1 AND deleted_at IS NULL", [id]);
  await cancelPendingEmails(client, id);
  return (await findAnnouncement(client, id)) ?? "missing";
}
