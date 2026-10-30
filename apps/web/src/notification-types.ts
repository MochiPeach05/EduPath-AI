/**
 * Thông báo (STU-PROG-04…09) and the faculty's announcements (AD-NOTI-01, 02), 2026-10-30. Notifications live only in the
 * bell of the student header (user: "thông báo xóa đi vì mình có cái icon chuông cái đó là thông báo rồi mà"). The system
 * writes them (an AI job finished, a progress warning, the faculty updated a catalog) and the faculty sends announcements
 * to cohorts and majors. Delivery is in EduPath AI only; email comes later (user: "tương lai sẽ làm thêm chức năng gửi về
 * mail thật của sinh viên"). A notification is deleted 90 days after it was created. Approved preview:
 * https://claude.ai/code/artifact/e8499fd2-b393-45c5-a261-1fead4e09652
 *
 * Student, /api/student/notifications:
 * GET    /?filter=all|unread|ai|warn|khoa|sys&limit=50&order=newest|unread → { items: StudentNotification[]; unread: number }
 *        (newest first; order=unread puts the unread ones first, for the popover)
 * GET    /unread-count                                → { unread: number }                                 (the bell polls it)
 * POST   /:id/read   {}                               → { notification: StudentNotification }
 * POST   /:id/unread {}                               → { notification: StudentNotification }
 * POST   /read-all   {}                               → { unread: 0 }
 * DELETE /:id                                         → 204
 * POST   /:id/restore {}                              → { notification: StudentNotification }  (accepted for 10 minutes; the page offers "Hoàn tác" for 10 s)
 *
 * Admin, /api/admin/announcements (admins only, same origin check as the other admin writes):
 * GET    /?sort=createdAt&order=desc                  → { items: Announcement[] }
 * GET    /options                                     → { cohorts: string[]; majors: { code: string; name: string }[] }  (of the students on file)
 * GET    /reach?cohorts=K29,K30&majors=7480201        → { count: number }                                  (students who would receive it; majors are programme codes from /options)
 * POST   / { title, body, link, cohorts, majors }      → 201 { announcement: Announcement }
 * POST   /:id/withdraw {}                             → { announcement: Announcement }                     (removes it from every bell)
 *
 * Errors: { error } with 400 invalid_input | title_required | body_required | no_recipients, 401 authentication_required,
 * 403 insufficient_role | invalid_origin | account_unavailable, 404 not_found, 409 already_withdrawn, 503 database_required.
 * Lists return the newest `limit` (50 by default); there is no paging past it. The bell shows one notification per topic, the
 * newest (user review 2026-10-30: "có 2 cặp trùng nhau"): a new run of an AI job replaces the notification of the run
 * before, a catalog update the one before about the same catalog; warnings and announcements collapse only when their title
 * and body are the same. `unread` counts the same notifications, so the badge always equals the unread ones listed;
 * deleting one also deletes the older ones of its topic.
 */
export const NOTIFICATIONS_API = "/api/student/notifications";
export const ANNOUNCEMENTS_API = "/api/admin/announcements";
/** How often the bell reads the unread count again (and when the tab gets focus). */
export const NOTIFICATION_POLL_MS = 60_000;
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 1000;

/** ai: an AI job finished; warn: a progress warning; khoa: from the faculty; sys: the system (policy, catalog updates). */
export type NotificationType = "ai" | "warn" | "khoa" | "sys";

/**
 * kind, what produced it:
 * - transcript_ready / transcript_failed: the transcript PDF was read or could not be read;
 * - assessment_comment: the AI comment of a competency assessment is ready;
 * - roadmap_ready / roadmap_failed: the AI roadmap was written or failed;
 * - graduation_advice: the graduation advice was written;
 * - warning: a "Cần chú ý" warning of the overview appeared (one per warning key);
 * - catalog_updated: the faculty changed the student's CTĐT, training plan or graduation standard (Đánh giá lại);
 * - announcement: sent by the faculty (AD-NOTI-01).
 */
export type NotificationKind =
  | "transcript_ready" | "transcript_failed" | "assessment_comment" | "roadmap_ready" | "roadmap_failed" | "graduation_advice"
  | "warning" | "catalog_updated" | "announcement";

export type StudentNotification = {
  id: string;
  type: NotificationType;
  kind: NotificationKind;
  title: string;
  /** Plain text, at most 1000 characters. */
  body: string;
  /** The portal page it opens ("#competency", "#roadmap"…) and the button's label ("Mở Đánh giá năng lực"), or null. */
  link: string | null;
  linkLabel: string | null;
  read: boolean;
  createdAt: string;
};

export type AnnouncementTarget = { cohorts: string[]; majors: string[] };
export type Announcement = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  /** Empty lists mean every student. */
  target: AnnouncementTarget;
  /** "Tất cả sinh viên" or "K29 · Công nghệ thông tin". */
  targetLabel: string;
  recipients: number;
  read: number;
  createdAt: string;
  createdBy: string | null;
  withdrawnAt: string | null;
};
