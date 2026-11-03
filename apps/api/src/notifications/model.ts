// Notifications of the student portal's bell (STU-PROG-04…09) and the faculty's announcements (AD-NOTI-01/02), 2026-10-30
// (user: "Ok triển khai đi"; contract: apps/web/src/notification-types.ts, migration 056). A notification is written by
// the system (an AI job finished, a progress warning, a catalog update) or by the faculty (an announcement), and lives
// in EduPath AI only; email comes later.

export type NotificationType = "ai" | "warn" | "khoa" | "sys";
export const NOTIFICATION_KINDS = [
  "transcript_ready", "transcript_failed", "assessment_comment", "roadmap_ready", "roadmap_failed", "graduation_advice",
  "warning", "catalog_updated", "announcement", "advisor_action",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The pages of the student portal a notification may open, with the label of its button ("Mở Lộ trình học tập"). */
export const PORTAL_PAGES: Readonly<Record<string, string>> = {
  "#overview": "Tổng quan",
  "#profile": "Hồ sơ và bảng điểm",
  "#competency": "Đánh giá năng lực",
  "#skill-gap": "Khoảng trống kỹ năng",
  "#career": "Định hướng nghề nghiệp",
  "#roadmap": "Lộ trình học tập",
  "#curriculum": "Chương trình đào tạo",
  "#plans": "Kế hoạch đào tạo",
  "#graduation": "Xét tốt nghiệp",
  "#assistant": "Trợ lý AI",
};
export const isPortalPage = (link: string | null | undefined): link is string => typeof link === "string" && Object.hasOwn(PORTAL_PAGES, link);
export const openLabel = (link: string) => `Mở ${PORTAL_PAGES[link] ?? "trang"}`;

export const TITLE_MAX = 200;
export const BODY_MAX = 1000;
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 1000;
/** A notification is deleted this many days after it was created. */
export const RETENTION_DAYS = 90;
/** A deleted notification can be restored ("Hoàn tác") for this long; the page offers it for 10 seconds. */
export const RESTORE_MINUTES = 10;
export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 100;
/** newest: newest first; unread: the unread ones first, each part newest first (the bell's popover). */
export const NOTIFICATION_ORDERS = ["newest", "unread"] as const;
export type NotificationOrder = (typeof NOTIFICATION_ORDERS)[number];

/**
 * What a notification is about, as SQL over a stu_notifications row. The bell shows only the newest notification of each
 * topic and counts only those (user review 2026-10-30: "huy hiệu báo 5 chưa đọc, nhưng có 2 cặp trùng nhau"):
 * - a new run of an AI job replaces the notification of the run before: the transcript read (ready or failed), the
 *   competency comment, the AI roadmap (ready or failed), the graduation advice;
 * - a catalog update replaces the one before about the same catalog of the same cohort (its title);
 * - warnings and announcements are one topic only when their title and body are the same.
 */
export const NOTIFICATION_TOPIC = `(CASE WHEN kind IN ('transcript_ready','transcript_failed') THEN 'transcript'
  WHEN kind IN ('roadmap_ready','roadmap_failed') THEN 'roadmap'
  WHEN kind IN ('assessment_comment','graduation_advice') THEN kind
  WHEN kind='catalog_updated' THEN 'catalog:'||title
  ELSE kind||':'||title||':'||body END)`;

export type NotificationRow = {
  id: string; type: NotificationType; kind: NotificationKind; title: string; body: string; link: string | null; linkLabel: string | null;
  readAt: Date | string | null; createdAt: Date | string;
};
export const notificationColumns = `id,type,kind,title,body,link,link_label AS "linkLabel",read_at AS "readAt",created_at AS "createdAt"`;

const iso = (value: Date | string) => new Date(value).toISOString();
export const presentNotification = (row: NotificationRow) => ({
  id: row.id, type: row.type, kind: row.kind, title: row.title, body: row.body, link: row.link, linkLabel: row.linkLabel,
  read: row.readAt !== null, createdAt: iso(row.createdAt),
});

export type AnnouncementTarget = { cohorts: string[]; majors: string[] };
export type AnnouncementRow = {
  id: string; title: string; body: string; link: string | null; target: AnnouncementTarget; recipients: number; read: number;
  createdAt: Date | string; createdBy: string | null; withdrawnAt: Date | string | null;
};
