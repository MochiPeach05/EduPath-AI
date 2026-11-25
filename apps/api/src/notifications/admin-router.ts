// Faculty announcements (AD-NOTI-01 "Gửi thông báo cho sinh viên", AD-NOTI-02/03 "Xem thông báo đã gửi", AD-NOTI-04/05
// email and its outcome, AD-NOTI-06 "Cài đặt thông báo"), mounted at /api/admin/announcements (contract:
// apps/web/src/notification-types.ts). An announcement reaches the active student accounts of the chosen cohorts and majors
// (none chosen: every student), or since 2026-11-25 the students picked one by one (user: "thêm tính năng có thể gửi tới
// từng bạn sinh viên mình chọn"), as a notification in their bell. Since 2026-11-23 the sender may also send it by email
// (user: "Làm cả 04, 05, 06", "Chỉ sinh viên đã có tài khoản", "Dùng mặc định"): from their own school mailbox through
// Microsoft Graph, once they allowed EduPath AI on Microsoft's page (auth/router.ts), one message per student, sent by the
// mail worker (mail/worker.ts).
import { Router, type ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { adminRoles, type AuthenticatedUser } from "../auth/types.js";
import type { MailConsentClient, MailToken } from "../auth/mail-consent-client.js";
import type { DatabasePool } from "../db/pool.js";
import { testMailMessage, type SendMail } from "../mail/graph-mail.js";
import type { MailGrantStore } from "../mail/grants.js";
import { announcementMailMessage } from "../mail/messages.js";
import { emailProblems, retryFailedEmails } from "../mail/outbox.js";
import { requireAdminAccess } from "../middleware/authorization.js";
import { personName } from "../users/person-name.js";
import {
  ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_STUDENTS_MAX, ANNOUNCEMENT_TITLE_MAX, isPortalPage, type AnnouncementRow, type AnnouncementTarget,
} from "./model.js";
import {
  ANNOUNCEMENT_SORT, announcementOptions, announcementStudents, findAnnouncement, listAnnouncements, reachCount, searchRecipients, sendAnnouncement,
  targetLabel, withdrawAnnouncement,
} from "./repository.js";
import {
  autoMailSender, listNotificationSettings, NOTIFICATION_SETTING_KEYS, NOTIFICATION_SETTINGS, retryFailedNotificationEmails, saveNotificationSetting,
  setAutoMailSender, usableAutoSender,
} from "./settings.js";

class AnnouncementError extends Error {
  constructor(readonly code: string, readonly status: number, readonly detail: Record<string, string> = {}) { super(code); }
}

const id = z.guid();
const cohort = z.string().regex(/^K\d{1,3}$/);
const major = z.string().regex(/^\d{7}$/);
/** "K29,K30" in a query string. */
const list = (item: z.ZodString) => z.string().max(400).optional()
  .transform((value) => (value ? value.split(",").map((part) => part.trim()).filter(Boolean) : []))
  .pipe(z.array(item).max(30));
const reachQuery = z.object({ cohorts: list(cohort), majors: list(major) }).strict();
const sortKeys = Object.keys(ANNOUNCEMENT_SORT) as [string, ...string[]];
const listQuery = z.object({
  sort: z.enum(["stt", ...sortKeys]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  /** The contract's name for dir. */
  order: z.enum(["asc", "desc"]).optional(),
}).strict();
const sendBody = z.object({
  title: z.string().max(ANNOUNCEMENT_TITLE_MAX * 2),
  body: z.string().max(ANNOUNCEMENT_BODY_MAX * 2),
  link: z.string().max(40).nullable().optional(),
  cohorts: z.array(cohort).max(30).default([]),
  majors: z.array(major).max(10).default([]),
  /** The students picked one by one (account ids); then no cohort and no major is given. */
  students: z.array(id).max(ANNOUNCEMENT_STUDENTS_MAX).default([]),
  /** Also by email, from the sender's school mailbox (AD-NOTI-04). */
  email: z.boolean().default(false),
}).strict();
/** "Chọn sinh viên": the words typed (name, MSSV, class) and how many students to list. */
const studentsQuery = z.object({ q: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).strict();
/** "Gửi email thử cho chính tôi": the draft, when it has a title and a text, as a student would receive it. */
const testBody = z.object({
  title: z.string().max(ANNOUNCEMENT_TITLE_MAX * 2).optional(),
  body: z.string().max(ANNOUNCEMENT_BODY_MAX * 2).optional(),
  link: z.string().max(40).nullable().optional(),
}).strict();
/** A kind's bell notification and/or its email (Cài đặt thông báo); at least one of them. */
const settingBody = z.object({ enabled: z.boolean().optional(), email: z.boolean().optional() }).strict()
  .refine((body) => body.enabled !== undefined || body.email !== undefined);

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
const unique = (values: readonly string[]) => [...new Set(values)].sort();
const count = (value: unknown) => (typeof value === "number" ? value : Number(value) || 0);
export const presentAnnouncement = (row: AnnouncementRow) => {
  const target: AnnouncementTarget = {
    cohorts: row.target?.cohorts ?? [], majors: row.target?.majors ?? [], ...(row.target?.students?.length ? { students: row.target.students } : {}),
    ...(row.target?.picked ? { picked: row.target.picked } : {}),
  };
  const email = row.emailRequested ? {
    from: row.emailFrom ?? null, total: count(row.email?.total), sent: count(row.email?.sent), pending: count(row.email?.pending),
    failed: count(row.email?.failed), cancelled: count(row.email?.cancelled), noAddress: count(row.email?.noAddress),
  } : null;
  return {
    id: row.id, title: row.title, body: row.body, link: row.link, target, targetLabel: targetLabel(target),
    recipients: row.recipients, read: row.read ?? 0, createdAt: iso(row.createdAt)!, createdBy: row.createdBy ?? null, withdrawnAt: iso(row.withdrawnAt),
    email,
  };
};
const cleanTitle = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const cleanBody = (text: string | undefined) => (text ?? "").replace(/\r\n?/g, "\n").trim();

/** The admin is still an active account of an admin role (as the other admin routers check). */
async function access(db: Pick<DatabasePool, "query"> | PoolClient, actor: AuthenticatedUser, lock = false) {
  const row = await db.query(
    `SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active AND COALESCE(role_override,role)=ANY($3::text[])${lock ? " FOR SHARE" : ""}`,
    [actor.userId, actor.tenantId, adminRoles]);
  if (!row.rowCount) throw new AnnouncementError("insufficient_role", 403);
}

export type AnnouncementsRouterOptions = {
  /** Staff mailbox domains (config.staffEmailDomains): such accounts never use the student portal, so they receive nothing. */
  staffEmailDomains?: ReadonlySet<string>;
  /** Email (AD-NOTI-04): Microsoft's tokens, the senders' stored permissions and how a message is sent. Without it: bell only. */
  mail?: { client: MailConsentClient; grants: MailGrantStore; sendMail: SendMail };
};

export function createAnnouncementsRouter(pool: DatabasePool | undefined, webOrigin: string, options: AnnouncementsRouterOptions = {}) {
  const router = Router();
  const staff = [...(options.staffEmailDomains ?? [])].map((domain) => domain.toLowerCase());
  const mail = options.mail;

  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(requireAdminAccess);
  router.use(async (req, res, next) => {
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    await access(pool, req.session.user!);
    next();
  });

  /** The member's permission to send from their mailbox, usable now (allowed, and Microsoft did not ask to allow again). */
  const usableSender = async (userId: string) => {
    if (!mail) throw new AnnouncementError("mail_unavailable", 503);
    const sender = await mail.grants.status(userId);
    if (!sender || sender.lastError) throw new AnnouncementError("mail_grant_required", 409);
    return sender;
  };

  router.get("/", async (req, res) => {
    const query = listQuery.parse(req.query);
    const rows = await listAnnouncements(pool!, query.sort, query.dir ?? query.order);
    res.json({ items: rows.map(presentAnnouncement) });
  });

  router.get("/options", async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json(await announcementOptions(pool!, staff));
  });

  router.get("/reach", async (req, res) => {
    const query = reachQuery.parse(req.query);
    res.json(await reachCount(pool!, { cohorts: unique(query.cohorts), majors: unique(query.majors) }, staff));
  });

  /** "Chọn sinh viên": the students an announcement may be sent to that match the words typed. */
  router.get("/students", async (req, res) => {
    const query = studentsQuery.parse(req.query);
    res.json({ items: await searchRecipients(pool!, query.q ?? "", staff, query.limit ?? 20) });
  });

  /** Whether email can be sent at all, and from which mailbox the member allowed it. */
  router.get("/mail-sender", async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json({ available: Boolean(mail), sender: mail ? await mail.grants.status(req.session.user!.userId) : null });
  });

  /** "Thu hồi quyền gửi email": EduPath AI forgets the member's permission at once. */
  router.delete("/mail-sender", async (req, res) => {
    if (!mail) throw new AnnouncementError("mail_unavailable", 503);
    await mail.grants.remove(req.session.user!.userId);
    res.status(204).end();
  });

  /** "Gửi email thử cho chính tôi": one message to the member's own mailbox, the draft when it has a title and a text. */
  router.post("/mail-sender/test", async (req, res) => {
    const input = testBody.parse(req.body ?? {});
    if (!mail) throw new AnnouncementError("mail_unavailable", 503);
    const user = req.session.user!;
    const grant = await mail.grants.load(user.userId);
    if (!grant) {
      // A stored permission that can no longer be read (SESSION_SECRET changed) asks to allow again, like a refused one.
      await mail.grants.markFailed(user.userId, "grant_required");
      throw new AnnouncementError("mail_grant_required", 409);
    }
    let token: MailToken;
    try {
      token = await mail.client.acquireToken(grant.tenantId, grant.cache);
    } catch (error) {
      if ((error as { errorCode?: unknown } | null)?.errorCode === "grant_required") {
        await mail.grants.markFailed(user.userId, "grant_required");
        throw new AnnouncementError("mail_grant_required", 409);
      }
      throw new AnnouncementError("send_failed", 502, { code: "token_failed" });
    }
    if (token.cache !== grant.cache) await mail.grants.save({ ...grant, cache: token.cache });
    const title = cleanTitle(input.title), body = cleanBody(input.body);
    const link = isPortalPage(input.link) ? input.link : null;
    const preview = Boolean(title && body);
    const name = personName(user.name);
    const message = preview
      ? announcementMailMessage({ to: grant.address, name, title, body, link }, webOrigin)
      : testMailMessage(grant.address, name, new Date(), webOrigin);
    const result = await mail.sendMail(token.accessToken, message);
    if (!result.ok) throw new AnnouncementError("send_failed", 502, { code: result.code });
    res.json({ sent: true, to: grant.address, preview });
  });

  router.post("/", async (req, res) => {
    const parsed = sendBody.safeParse(req.body ?? {});
    if (!parsed.success) throw new AnnouncementError("invalid_input", 400);
    const title = cleanTitle(parsed.data.title);
    const body = cleanBody(parsed.data.body);
    if (!title) throw new AnnouncementError("title_required", 400);
    if (!body) throw new AnnouncementError("body_required", 400);
    if (Array.from(title).length > ANNOUNCEMENT_TITLE_MAX || Array.from(body).length > ANNOUNCEMENT_BODY_MAX) throw new AnnouncementError("invalid_input", 400);
    const link = parsed.data.link?.trim() || null;
    if (link !== null && !isPortalPage(link)) throw new AnnouncementError("invalid_input", 400);
    const students = [...new Set(parsed.data.students)];
    // Either a group (cohorts, majors) or picked students, never both.
    if (students.length && (parsed.data.cohorts.length || parsed.data.majors.length)) throw new AnnouncementError("invalid_input", 400);
    const target: AnnouncementTarget = students.length
      ? { cohorts: [], majors: [], students } : { cohorts: unique(parsed.data.cohorts), majors: unique(parsed.data.majors) };
    const user = req.session.user!;
    const email = parsed.data.email ? { senderId: user.userId, from: (await usableSender(user.userId)).address } : null;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await access(client, user, true);
      const sent = await sendAnnouncement(client, user.userId, { title, body, link, target }, staff, email);
      if (!sent) throw new AnnouncementError("no_recipients", 400);
      await client.query("COMMIT");
      res.status(201).json({ announcement: presentAnnouncement(sent) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  router.post("/:id/withdraw", async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    const announcementId = id.parse(req.params.id);
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await access(client, req.session.user!, true);
      const outcome = await withdrawAnnouncement(client, announcementId);
      if (outcome === "missing") throw new AnnouncementError("not_found", 404);
      if (outcome === "withdrawn") throw new AnnouncementError("already_withdrawn", 409);
      await client.query("COMMIT");
      res.json({ announcement: presentAnnouncement(outcome) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  /** The students an announcement was sent to by picking them (none for one sent to cohorts and majors). */
  router.get("/:id/recipients", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const found = await findAnnouncement(pool!, id.parse(req.params.id));
    if (!found) throw new AnnouncementError("not_found", 404);
    res.json({ items: await announcementStudents(pool!, found.target?.students ?? []) });
  });

  /** AD-NOTI-05: the messages of an announcement that did not go out, and why. */
  router.get("/:id/emails", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const announcementId = id.parse(req.params.id);
    if (!await findAnnouncement(pool!, announcementId)) throw new AnnouncementError("not_found", 404);
    res.json({ items: await emailProblems(pool!, announcementId) });
  });

  /** "Gửi lại thư lỗi": the failed messages go again, from the mailbox of the member who asks. */
  router.post("/:id/emails/retry", async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    const announcementId = id.parse(req.params.id);
    const user = req.session.user!;
    const sender = await usableSender(user.userId);
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await access(client, user, true);
      const found = await findAnnouncement(client, announcementId);
      if (!found) throw new AnnouncementError("not_found", 404);
      if (found.withdrawnAt) throw new AnnouncementError("already_withdrawn", 409);
      const requeued = await retryFailedEmails(client, announcementId, user.userId, sender.address);
      await client.query("COMMIT");
      res.json({ announcement: presentAnnouncement((await findAnnouncement(pool!, announcementId))!), requeued });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  /**
   * Whose mailbox sends the automatic notifications' emails, as the settings page shows it (lastError "grant_required"
   * also when that member took the permission back), and the caller's own permission.
   */
  const autoMailState = async (userId: string) => {
    if (!mail) return { available: false, sender: null, me: null };
    const sender = await autoMailSender(pool!);
    return {
      available: true,
      sender: sender ? { name: sender.name, address: sender.address, lastError: sender.address ? sender.lastError : "grant_required", mine: sender.userId === userId } : null,
      me: await mail.grants.status(userId),
    };
  };
  /** The caller's permission, usable now; else 409 (allow EduPath AI on Microsoft's page first, or again). */
  const usableOwnGrant = async (userId: string) => {
    if (!mail) throw new AnnouncementError("mail_unavailable", 503);
    const mine = await mail.grants.status(userId);
    if (!mine || mine.lastError) throw new AnnouncementError("mail_grant_required", 409);
  };

  /** AD-NOTI-06 Cài đặt thông báo: the kinds of automatic notifications, whether each is on and goes by email. */
  router.get("/settings", async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json({ items: await listNotificationSettings(pool!), mail: await autoMailState(req.session.user!.userId) });
  });

  /**
   * Turns a kind's bell notification and/or its email on or off. The first email turned on while no working mailbox is
   * named makes the caller's mailbox the sender (it needs their permission).
   */
  router.put("/settings/:setting", async (req, res) => {
    const key = z.enum(NOTIFICATION_SETTING_KEYS).parse(req.params.setting);
    const change = settingBody.parse(req.body ?? {});
    const user = req.session.user!;
    if (NOTIFICATION_SETTINGS.find((item) => item.key === key)!.bellLocked && change.enabled === false) throw new AnnouncementError("bell_locked", 400);
    if (change.email === true) {
      if (change.enabled === false) throw new AnnouncementError("invalid_input", 400);
      if (!mail) throw new AnnouncementError("mail_unavailable", 503);
      const current = (await listNotificationSettings(pool!)).find((item) => item.key === key)!;
      if (!current.enabled && change.enabled !== true) throw new AnnouncementError("bell_off", 409);
      if (!usableAutoSender(await autoMailSender(pool!))) {
        await usableOwnGrant(user.userId);
        await setAutoMailSender(pool!, user.userId, user.userId);
      }
    }
    res.json({ setting: await saveNotificationSetting(pool!, key, change, user.userId), mail: await autoMailState(user.userId) });
  });

  /** "Dùng hộp thư của tôi": the automatic emails leave from the caller's mailbox from now on, the queued ones too. */
  router.post("/settings/mail-sender", async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    const user = req.session.user!;
    await usableOwnGrant(user.userId);
    await setAutoMailSender(pool!, user.userId, user.userId);
    res.json({ mail: await autoMailState(user.userId) });
  });

  /** "Gửi lại email lỗi": the failed automatic emails of the last 30 days go again from the named mailbox. */
  router.post("/settings/retry-emails", async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    if (!mail) throw new AnnouncementError("mail_unavailable", 503);
    const sender = await autoMailSender(pool!);
    if (!sender || !usableAutoSender(sender)) throw new AnnouncementError("mail_grant_required", 409);
    const requeued = await retryFailedNotificationEmails(pool!, sender.userId);
    res.json({ requeued, items: await listNotificationSettings(pool!) });
  });

  router.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AnnouncementError) { res.status(error.status).json({ error: error.code, ...error.detail }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
