// The mail worker of the API process (AD-NOTI-04, 2026-11-23): every 15 seconds it sends the due announcement emails of
// each sender from that sender's own school mailbox through Microsoft Graph. The token comes from the sender's stored
// permission (grants.ts), renewed by MSAL as Microsoft allows. Render's free instance sleeps after a while without visits;
// whatever is still queued then goes out when it wakes, so the queue lives in the database, never in memory.
import type { DatabasePool } from "../db/pool.js";
import type { MailConsentClient, MailToken } from "../auth/mail-consent-client.js";
import { personName } from "../users/person-name.js";
import type { MailResult, SendMail } from "./graph-mail.js";
import type { MailGrantStore } from "./grants.js";
import { announcementMailMessage } from "./messages.js";
import {
  claimDueEmails, EMAILS_PER_TICK, failDueEmails, markEmailFailed, markEmailRetry, markEmailSent, MAX_ATTEMPTS, retryDelayMinutes,
  sendersWithDueEmails, tidyEmails,
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

/** One round: tidy the queue, then for each sender with due messages renew the token and send a few. */
export async function runMailTick(deps: MailWorkerDeps): Promise<TickOutcome> {
  const { db, client, grants, sendMail, webOrigin } = deps;
  const log = deps.log ?? ((line: string) => console.error(line));
  const outcome: TickOutcome = { sent: 0, retried: 0, failed: 0 };
  await tidyEmails(db);
  for (const sender of await sendersWithDueEmails(db)) {
    const grant = await grants.load(sender);
    if (!grant) {
      // Gone, or no longer readable (SESSION_SECRET changed): the page asks the member to allow EduPath AI again.
      await grants.markFailed(sender, "grant_required");
      outcome.failed += await failDueEmails(db, sender, "grant_required");
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
        outcome.failed += await failDueEmails(db, sender, code);
      } else {
        log(`[MAIL] The token was not renewed (${code}); the messages wait for the next round`);
      }
      continue;
    }
    if (token.cache !== grant.cache) await grants.save({ ...grant, cache: token.cache });
    for (const mail of await claimDueEmails(db, sender, deps.perTick ?? EMAILS_PER_TICK)) {
      if (!mail.address) {
        await markEmailFailed(db, mail.id, "no_address");
        outcome.failed += 1;
        continue;
      }
      const result = await sendMail(token.accessToken, announcementMailMessage(
        { to: mail.address, name: mail.name ? personName(mail.name) : null, title: mail.title, body: mail.body, link: mail.link }, webOrigin));
      if (result.ok) {
        await markEmailSent(db, mail.id);
        outcome.sent += 1;
      } else if (isTemporary(result) && mail.attempts < MAX_ATTEMPTS) {
        await markEmailRetry(db, mail.id, result.code, retryDelayMinutes(mail.attempts));
        outcome.retried += 1;
      } else {
        await markEmailFailed(db, mail.id, result.code);
        outcome.failed += 1;
      }
    }
  }
  return outcome;
}

/** Runs runMailTick every `intervalMs` (15 s), never two rounds at once; stop() ends it. */
export function startMailWorker(deps: MailWorkerDeps, intervalMs = 15_000) {
  let running = false;
  const log = deps.log ?? ((line: string) => console.error(line));
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runMailTick(deps)
      .then((outcome) => { if (outcome.sent || outcome.failed) console.log(`[MAIL] ${outcome.sent} sent, ${outcome.failed} failed, ${outcome.retried} to retry`); })
      .catch((error: unknown) => log(`[MAIL] The mail round failed (${(error as { code?: string } | null)?.code ?? "error"})`))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
