// Storage of the notifications (stu_notifications) and the faculty's announcements (ad_announcements), migration 056.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { orderBy, byText, type SortDirection } from "../admin/table-sort.js";
import { MAJORS } from "../curricula/majors.js";
import type { DatabasePool } from "../db/pool.js";
import {
  notificationColumns, NOTIFICATION_TOPIC, RESTORE_MINUTES, RETENTION_DAYS, type AnnouncementRow, type AnnouncementTarget, type NotificationOrder,
  type NotificationRow, type NotificationType,
} from "./model.js";
import { notifyMany } from "./notify.js";

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
  await db.query("DELETE FROM stu_notifications WHERE deleted_at<now()-interval '1 day' AND kind<>'warning'");
  await db.query("DELETE FROM stu_notifications n USING ad_announcements a WHERE n.announcement_id=a.id AND a.withdrawn_at IS NOT NULL");
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

/** The students an announcement reaches: active student accounts (no staff mailbox) of the chosen cohorts and majors. */
function recipientsWhere(first: number) {
  return `u.is_active AND COALESCE(u.role_override,u.role)='student'
    AND (cardinality($${first}::text[])=0 OR p.cohort_code=ANY($${first}::text[]))
    AND (cardinality($${first + 1}::text[])=0 OR p.major_code::text=ANY($${first + 1}::text[]))
    AND NOT (lower(split_part(COALESCE(u.email,''),'@',2))=ANY($${first + 2}::text[])
      OR lower(split_part(COALESCE(u.username,''),'@',2))=ANY($${first + 2}::text[]))`;
}
const recipientsFrom = "FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id";

export async function announcementOptions(db: Db, staffDomains: readonly string[]) {
  const result = await db.query<{ cohort: string | null; major: string | null }>(
    `SELECT DISTINCT p.cohort_code AS cohort,p.major_code::text AS major ${recipientsFrom} WHERE ${recipientsWhere(1)}`, [[], [], staffDomains]);
  const cohorts = [...new Set(result.rows.map((row) => row.cohort).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")) || a.localeCompare(b));
  const majors = [...new Set(result.rows.map((row) => row.major?.trim()).filter((value): value is string => Boolean(value)))].sort()
    .map((code) => ({ code, name: majorName(code) }));
  return { cohorts, majors };
}

export const majorName = (code: string) => MAJORS.find((major) => major.code === code)?.label ?? `Ngành ${code}`;

export async function reachCount(db: Db, target: AnnouncementTarget, staffDomains: readonly string[]): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count ${recipientsFrom} WHERE ${recipientsWhere(1)}`, [target.cohorts, target.majors, staffDomains]);
  return result.rows[0]?.count ?? 0;
}

export function targetLabel(target: AnnouncementTarget): string {
  if (!target.cohorts.length && !target.majors.length) return "Tất cả sinh viên";
  return [target.cohorts.join(", "), target.majors.map(majorName).join(", ")].filter(Boolean).join(" · ");
}

const announcementColumns = `a.id,a.title,a.body,a.link,a.target,a.recipients,a.created_at AS "createdAt",a.withdrawn_at AS "withdrawnAt",
  u.display_name AS "createdBy",
  (SELECT count(*)::int FROM stu_notifications n WHERE n.announcement_id=a.id AND n.read_at IS NOT NULL) AS read`;

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

async function findAnnouncement(db: Db, id: string): Promise<AnnouncementRow | null> {
  const result = await db.query<AnnouncementRow>(
    `SELECT ${announcementColumns} FROM ad_announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1`, [id]);
  return result.rows[0] ?? null;
}

export type AnnouncementInput = { title: string; body: string; link: string | null; target: AnnouncementTarget };

/**
 * Sends an announcement inside the caller's transaction: the announcement, then one notification per recipient (type
 * "khoa", kind "announcement", source_key "announcement:<id>"). null when it reaches nobody.
 */
export async function sendAnnouncement(client: Pick<PoolClient, "query">, actorId: string, input: AnnouncementInput,
  staffDomains: readonly string[]): Promise<AnnouncementRow | null> {
  const recipients = (await client.query<{ id: string }>(
    `SELECT u.id ${recipientsFrom} WHERE ${recipientsWhere(1)} ORDER BY u.id`, [input.target.cohorts, input.target.majors, staffDomains])).rows.map((row) => row.id);
  if (!recipients.length) return null;
  const id = randomUUID();
  await client.query(
    `INSERT INTO ad_announcements(id,title,body,link,target,recipients,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [id, input.title, input.body, input.link, JSON.stringify(input.target), recipients.length, actorId]);
  await notifyMany(client, recipients, {
    type: "khoa", kind: "announcement", title: input.title, body: input.body, link: input.link, sourceKey: `announcement:${id}`, announcementId: id,
  });
  return findAnnouncement(client, id);
}

/** Withdraws an announcement and takes it out of every bell; "missing" or "withdrawn" (already) otherwise. */
export async function withdrawAnnouncement(client: Pick<PoolClient, "query">, id: string): Promise<AnnouncementRow | "missing" | "withdrawn"> {
  const updated = await client.query("UPDATE ad_announcements SET withdrawn_at=now() WHERE id=$1 AND withdrawn_at IS NULL", [id]);
  if (!updated.rowCount) return (await client.query("SELECT 1 FROM ad_announcements WHERE id=$1", [id])).rowCount ? "withdrawn" : "missing";
  await client.query("UPDATE stu_notifications SET deleted_at=now() WHERE announcement_id=$1 AND deleted_at IS NULL", [id]);
  return (await findAnnouncement(client, id)) ?? "missing";
}
