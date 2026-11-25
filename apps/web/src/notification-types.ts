/**
 * Thông báo (STU-PROG-04…09) and the faculty's announcements (AD-NOTI-01, 02), 2026-10-30. Notifications live only in the
 * bell of the student header (user: "thông báo xóa đi vì mình có cái icon chuông cái đó là thông báo rồi mà"). The system
 * writes them (an AI job finished, a progress warning, the faculty updated a catalog) and the faculty sends announcements
 * to cohorts and majors. A notification is deleted 90 days after it was created. Approved preview:
 * https://claude.ai/code/artifact/e8499fd2-b393-45c5-a261-1fead4e09652
 *
 * Email (AD-NOTI-04/05, 2026-11-23; user: "Làm cả 04, 05, 06", "Chỉ sinh viên đã có tài khoản", "Dùng mặc định"): an
 * announcement may also go to the students' school address, from the sender's own school mailbox through Microsoft Graph
 * (Mail.Send, allowed once on Microsoft's page: POST /api/auth/microsoft/mail-consent). One message per student, about 25
 * a minute, tried again on a passing failure, not kept in the sender's Sent Items; a sent email cannot be withdrawn. The
 * addresses and outcomes are kept 90 days. AD-NOTI-06 Cài đặt thông báo turns each kind of automatic notification off and
 * on; the faculty's announcements and the notifications of a cố vấn học tập's actions are always written. Since the same
 * evening (user: "ngoài có thể cập nhật thông báo cho thông báo ở trang sinh viên thì có thể gửi tới email những thông báo
 * này nữa") each kind may also go by email, off by default, from one school mailbox: the admin who turns the first email
 * on, or who presses "Dùng hộp thư của tôi".
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
 * GET    /reach?cohorts=K29,K30&majors=7480201        → { count: number; withEmail: number }               (students who would receive it, and those of them with an address; majors are programme codes from /options)
 * GET    /students?q=hoa&limit=20                     → { items: RecipientStudent[] }                      ("Chọn sinh viên", 2026-11-25: every word typed in the name, MSSV, class or address, tones and case ignored; by given name)
 * POST   / { title, body, link, cohorts, majors, students, email } → 201 { announcement: Announcement }   (students: account ids picked one by one, at most 200, then no cohort and no major; email: also by email, from the caller's mailbox)
 * GET    /:id/recipients                              → { items: RecipientStudent[] }                      (the picked students of an announcement; none for a group one)
 * POST   /:id/withdraw {}                             → { announcement: Announcement }                     (removes it from every bell and cancels the emails not sent yet)
 * GET    /:id/emails                                  → { items: EmailProblem[] }                          (the messages that did not go out)
 * POST   /:id/emails/retry {}                         → { announcement: Announcement; requeued: number }   (the failed ones again, from the caller's mailbox)
 * GET    /mail-sender                                 → MailSenderState                                    (whether email can be sent, and from which mailbox the caller allowed it)
 * DELETE /mail-sender                                 → 204                                                (EduPath AI forgets the caller's permission)
 * POST   /mail-sender/test { title?, body?, link? }   → { sent: true; to: string; preview: boolean }       (one message to the caller's own mailbox: the draft when it has a title and a text)
 * GET    /settings                                    → { items: NotificationSetting[]; mail: AutoMailState }
 * PUT    /settings/:key { enabled?, email? }          → { setting: NotificationSetting; mail: AutoMailState }    (the bell off takes the email off; the first email on without a working sender makes the caller's mailbox the sender)
 * POST   /settings/mail-sender {}                     → { mail: AutoMailState }                            ("Dùng hộp thư của tôi")
 * POST   /settings/retry-emails {}                    → { requeued: number; items: NotificationSetting[] } (the failed automatic emails of the last 30 days)
 *
 * Errors: { error } with 400 invalid_input | title_required | body_required | no_recipients, 401 authentication_required,
 * 403 insufficient_role | invalid_origin | account_unavailable, 404 not_found, 409 already_withdrawn | mail_grant_required
 * (allow EduPath AI on Microsoft's page first, or again) | bell_off (turn the notification on before its email), 400
 * bell_locked (Việc làm thay sinh viên is always in the bell), 502 send_failed (with code, Microsoft's own), 503
 * database_required | mail_unavailable (the server sends no email).
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
 * - warning: a warning of the overview's "Cảnh báo chậm tiến độ" appeared (one per warning key);
 * - catalog_updated: the faculty changed the student's CTĐT, training plan or graduation standard (Đánh giá lại);
 * - announcement: sent by the faculty (AD-NOTI-01);
 * - advisor_action: the student's cố vấn học tập did something for them (AD-AST-07, 08; 2026-11-03).
 */
export type NotificationKind =
  | "transcript_ready" | "transcript_failed" | "assessment_comment" | "roadmap_ready" | "roadmap_failed" | "graduation_advice"
  | "warning" | "catalog_updated" | "announcement" | "advisor_action";

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

/** Cohorts and majors (none of either: every student), or the students picked one by one (account ids). */
export type AnnouncementTarget = {
  cohorts: string[]; majors: string[]; students?: string[];
  /** How many students were picked, once their list was cleared after 90 days. */
  picked?: number;
};
/** The most students one announcement may be sent to by picking them. */
export const ANNOUNCEMENT_STUDENTS_MAX = 200;
/** A student in "Chọn sinh viên": the name as the admin lists show it, MSSV, class (71K29CNTT08), and whether an email can reach them. */
export type RecipientStudent = { id: string; name: string; studentCode: string | null; className: string | null; cohort: string | null; hasEmail: boolean };
export type Announcement = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  /** Empty lists mean every student. */
  target: AnnouncementTarget;
  /** "Tất cả sinh viên", "K29 · Công nghệ thông tin" or "3 sinh viên được chọn". */
  targetLabel: string;
  recipients: number;
  read: number;
  createdAt: string;
  createdBy: string | null;
  withdrawnAt: string | null;
  /** The email part; null (or missing, from an older server) when it went to the bell only. */
  email?: AnnouncementEmail | null;
};

/** How the emails of an announcement went (AD-NOTI-05). */
export type AnnouncementEmail = {
  /** The school mailbox they are sent from. */
  from: string | null;
  /** One per student reached. */
  total: number;
  sent: number;
  /** Waiting or being sent. */
  pending: number;
  failed: number;
  /** Not sent because the announcement was withdrawn first. */
  cancelled: number;
  /** Students whose account has no email address. */
  noAddress: number;
};

/** A member's permission to send from their school mailbox; lastError "grant_required" when Microsoft asks to allow again. */
export type MailSender = { address: string; grantedAt: string; lastError: string | null };
export type MailSenderState = { available: boolean; sender: MailSender | null };

/** A message that did not go out: failed (error: Microsoft's code or grant_required, sender_missing) or no_address. */
export type EmailProblem = {
  name: string;
  studentCode: string | null;
  address: string | null;
  status: "failed" | "no_address";
  error: string | null;
  at: string;
};

/**
 * AD-NOTI-06: the kinds of automatic notifications an admin may turn off (no stored choice means on) or send by email too
 * (off by default). advisor_action (Việc làm thay sinh viên) is always in the bell (bellLocked): only its email changes.
 */
export type NotificationSettingKey = "transcript" | "assessment_comment" | "roadmap" | "graduation_advice" | "warning" | "catalog_updated" | "advisor_action";
/** A kind's emails of the last 30 days. */
export type EmailStats = { sent: number; pending: number; failed: number; noAddress: number };
export type NotificationSetting = {
  key: NotificationSettingKey;
  label: string;
  detail: string;
  bellLocked: boolean;
  enabled: boolean;
  /** Also sent to the students' school mailbox. */
  email: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  emails: EmailStats;
};
/**
 * Whose mailbox sends the automatic emails (sender; lastError "grant_required" when Microsoft asks that member to allow
 * EduPath AI again or the permission was taken back), and the caller's own permission (me).
 */
export type AutoMailState = {
  available: boolean;
  sender: { name: string | null; address: string | null; lastError: string | null; mine: boolean } | null;
  me: MailSender | null;
};
