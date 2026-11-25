// The mail worker of the API process (AD-NOTI-04, 2026-11-23): every 15 seconds it sends the due emails of each sender from
// that sender's own school mailbox through Microsoft Graph: the announcement emails (outbox.ts) and the automatic
// notifications' emails an admin turned on in Cài đặt thông báo (notification-outbox.ts), together at most 6 a round per
// mailbox. The token comes from the sender's stored permission (grants.ts), renewed by MSAL as Microsoft allows. Render's
// free instance sleeps after a while without visits; whatever is still queued then goes out when it wakes, so the queues
// live in the database, never in memory.
import type { DatabasePool } from "../db/pool.js";
import type { MailConsentClient, MailToken } from "../auth/mail-consent-client.js";
import { personName } from "../users/person-name.js";
import type { MailMessage, MailResult, SendMail } from "./graph-mail.js";
import type { MailGrantStore } from "./grants.js";
import { announcementMailMessage, notificationMailMessage } from "./messages.js";
import {
  claimDueNotificationEmails, failDueNotificationEmails, sendersWithDueNotificationEmails, tidyNotificationEmails,
} from "./notification-outbox.js";
import {
  claimDueEmails, EMAILS_PER_TICK, failDueEmails, markEmailFailed, markEmailRetry, markEmailSent, MAX_ATTEMPTS, retryDelayMinutes,
  sendersWithDueEmails, tidyEmails, type EmailTable,
} from "./outbox.js";

export type MailWorkerDeps = {
  db: Pick<DatabasePool, "query">;
  client: MailConsentClient;
  grants: MailGrantStore;
  sendMail: SendMail;
  webOrigin: string;
  perTick?: number;
  log?: (line: string) => void;
};

/** Graph's answer worth another try later: no answer, an expired token, throttling or a server error. */
export const isTemporary = (result: Extract<MailResult, { ok: false }>) =>
  result.status === 0 || result.status === 401 || result.status === 408 || result.status === 429 || result.status >= 500;

const codeOf = (error: unknown) => {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === "string" && /^[\w.-]{1,60}$/.test(code) ? code : "token_failed";
};

export type TickOutcome = { sent: number; retried: number; failed: number };
/** One message to send: its queue, row, address, attempts so far (this one included) and what it says. */
type Job = { table: EmailTable; id: string; address: string | null; attempts: number; message: (to: string) => MailMessage };

/** Every due message of a sender, in both queues, fails with `code`. */
const failSender = async (db: MailWorkerDeps["db"], sender: string, code: string) =>
  (await failDueEmails(db, sender, code)) + (await failDueNotificationEmails(db, sender, code));

/**
 * One round: tidy the queues (when `tidy`), then for each sender with due messages renew the token and send a few,
 * announcements first.
 */
export async function runMailTick(deps: MailWorkerDeps, options: { tidy?: boolean } = {}): Promise<TickOutcome> {
  const { db, client, grants, sendMail, webOrigin } = deps;
  const log = deps.log ?? ((line: string) => console.error(line));
  const outcome: TickOutcome = { sent: 0, retried: 0, failed: 0 };
  if (options.tidy ?? true) {
    await tidyEmails(db);
    await tidyNotificationEmails(db);
  }
  const senders = [...new Set([...await sendersWithDueEmails(db), ...await sendersWithDueNotificationEmails(db)])];
  for (const sender of senders) {
    const grant = await grants.load(sender);
    if (!grant) {
      // Gone, or no longer readable (SESSION_SECRET changed): the page asks the member to allow EduPath AI again.
      await grants.markFailed(sender, "grant_required");
      outcome.failed += await failSender(db, sender, "grant_required");
      continue;
    }
    let token: MailToken;
    try {
      token = await client.acquireToken(grant.tenantId, grant.cache);
    } catch (error) {
      const code = codeOf(error);
      if (code === "grant_required") {
        // Microsoft wants the member to allow EduPath AI again: their page says so, and "Gửi lại thư lỗi" sends these later.
        await grants.markFailed(sender, code);
        outcome.failed += await failSender(db, sender, code);
      } else {
        log(`[MAIL] The token was not renewed (${code}); the messages wait for the next round`);
      }
      continue;
    }
    if (token.cache !== grant.cache) await grants.save({ ...grant, cache: token.cache });
    const limit = deps.perTick ?? EMAILS_PER_TICK;
    const announcements = await claimDueEmails(db, sender, limit);
    const notifications = await claimDueNotificationEmails(db, sender, limit - announcements.length);
    const name = (value: string | null) => (value ? personName(value) : null);
    const jobs: Job[] = [
      ...announcements.map((mail): Job => ({ table: "ad_announcement_emails", id: mail.id, address: mail.address, attempts: mail.attempts,
        message: (to) => announcementMailMessage({ to, name: name(mail.name), title: mail.title, body: mail.body, link: mail.link, sender: mail.sender }, webOrigin) })),
      ...notifications.map((mail): Job => ({ table: "stu_notification_emails", id: mail.id, address: mail.address, attempts: mail.attempts,
        message: (to) => notificationMailMessage({ to, name: name(mail.name), title: mail.title, body: mail.body, link: mail.link, linkLabel: mail.linkLabel }, webOrigin) })),
    ];
    for (const job of jobs) {
      if (!job.address) {
        await markEmailFailed(db, job.id, "no_address", job.table);
        outcome.failed += 1;
        continue;
      }
      const result = await sendMail(token.accessToken, job.message(job.address));
      if (result.ok) {
        await markEmailSent(db, job.id, job.table);
        outcome.sent += 1;
      } else if (isTemporary(result) && job.attempts < MAX_ATTEMPTS) {
        await markEmailRetry(db, job.id, result.code, retryDelayMinutes(job.attempts), job.table);
        outcome.retried += 1;
      } else {
        await markEmailFailed(db, job.id, result.code, job.table);
        outcome.failed += 1;
      }
    }
  }
  return outcome;
}

/** Runs runMailTick every `intervalMs` (15 s), tidying once a minute, never two rounds at once; stop() ends it. */
export function startMailWorker(deps: MailWorkerDeps, intervalMs = 15_000) {
  let running = false;
  let round = 0;
  const log = deps.log ?? ((line: string) => console.error(line));
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    const tidy = round % 4 === 0;
    round += 1;
    void runMailTick(deps, { tidy })
      .then((outcome) => { if (outcome.sent || outcome.failed) console.log(`[MAIL] ${outcome.sent} sent, ${outcome.failed} failed, ${outcome.retried} to retry`); })
      .catch((error: unknown) => log(`[MAIL] The mail round failed (${(error as { code?: string } | null)?.code ?? "error"})`))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
