import { canAccessAdmin, canManageAdmin } from "./types.js";
import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AppConfig } from "../config.js";
import { sendGraphMail, testMailMessage, type SendMail } from "../mail/graph-mail.js";
import type { MailGrantStore } from "../mail/grants.js";
import { personName } from "../users/person-name.js";
import type { UserRepository } from "../users/user-repository.js";
import type { MailConsentClient, MailConsentGrant } from "./mail-consent-client.js";
import type { AuthTransaction, MicrosoftAuthClient } from "./types.js";
import type { MicrosoftIdentity } from "./types.js";
import type { AuthActivity } from "./activity.js";
import {
  assertIdentityIsAllowed,
  createAuthTransaction,
  isAuthTransactionFresh,
  isSafeEqual,
  canUseStudentPortal,
  isStaffAccount,
  resolveAppRole
} from "./security.js";
import type { AppRole } from "./types.js";

interface AuthRouterDependencies {
  authActivity?: AuthActivity;
  config: AppConfig;
  microsoftAuthClient: MicrosoftAuthClient;
  userRepository: UserRepository;
  /** Microsoft's Mail.Send consent for the email test (AD-NOTI-04); without it the test answers 503. */
  mailConsentClient?: MailConsentClient;
  /** How a message is sent (Microsoft Graph by default; tests pass a fake). */
  sendMail?: SendMail;
  /** Where the permission is kept for the announcement emails (AD-NOTI-04); without it the consent only sends the test. */
  mailGrants?: MailGrantStore;
  now?: () => Date;
}

/**
 * Where Microsoft's consent page ends: the page the member started from (Gửi thông báo, or Cài đặt thông báo since
 * 2026-11-23) with its outcome (?emailTest=sent, …&code=AADSTS65004).
 */
const MAIL_CONSENT_PAGES = { compose: "/quantri/gui-thong-bao", settings: "/quantri/cai-dat-thong-bao" } as const;
type MailConsentPage = keyof typeof MAIL_CONSENT_PAGES;
function mailTestRedirect(config: AppConfig, outcome: string, code?: string | null, page: MailConsentPage = "compose"): string {
  const url = new URL(MAIL_CONSENT_PAGES[page], `${config.webOrigin}/`);
  url.searchParams.set("emailTest", outcome);
  if (code && /^[A-Za-z0-9_.-]{1,80}$/.test(code)) url.searchParams.set("code", code);
  return url.toString();
}
/** "AADSTS65004" out of a Microsoft error text: the only part of it the page shows. */
const aadstsCode = (text: unknown) => (typeof text === "string" ? /AADSTS\d{4,6}/.exec(text)?.[0] ?? null : null);

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function frontendUrl(config: AppConfig, path: string): string {
  return new URL(path, `${config.webOrigin}/`).toString();
}

function authErrorRedirect(config: AppConfig, code: string, returnTo?: string): string {
  const url = new URL(returnTo === "/quantri" ? "/quantri" : "/login", `${config.webOrigin}/`);
  url.searchParams.set("authError", code);
  return url.toString();
}

function callbackRedirect(config: AppConfig, returnTo: string): string {
  const url = new URL("/auth/callback", `${config.webOrigin}/`);
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

function isSameOrigin(request: Request, expectedOrigin: string): boolean {
  const origin = request.get("origin");
  return !origin || origin === expectedOrigin;
}

function addAuthTransaction(request: Request, transaction: AuthTransaction): void {
  const activeTransactions = (request.session.authTransactions ?? [])
    .filter(isAuthTransactionFresh)
    .slice(-4);
  activeTransactions.push(transaction);
  request.session.authTransactions = activeTransactions;
}

function takeAuthTransaction(request: Request, state: unknown): AuthTransaction | undefined {
  const transactions = request.session.authTransactions ?? [];
  const index = transactions.findIndex((item) => isSafeEqual(state, item.state));
  if (index < 0) return undefined;

  const [transaction] = transactions.splice(index, 1);
  request.session.authTransactions = transactions;
  return transaction;
}

export function createAuthRouter({
  config,
  microsoftAuthClient,
  userRepository,
  authActivity,
  mailConsentClient,
  sendMail = sendGraphMail,
  mailGrants,
  now = () => new Date()
}: AuthRouterDependencies): Router {
  const router = Router();

  /**
   * "Cho phép gửi email" (AD-NOTI-04, 2026-11-23): a staff member who can send announcements asks Microsoft for the
   * Mail.Send permission. The answer is the address of Microsoft's consent page; the callback below stores the permission
   * encrypted (mail/grants.ts; the test step of the same day kept none) and sends one message to the member's own mailbox
   * as proof. One request at a time per session: a new one replaces the last.
   */
  router.post("/microsoft/mail-consent", async (request, response) => {
    if (!isSameOrigin(request, config.webOrigin)) {
      response.status(403).json({ error: "invalid_origin" });
      return;
    }
    const user = request.session.user;
    if (!user) {
      response.status(401).json({ error: "authentication_required" });
      return;
    }
    if (!canManageAdmin(user.role)) {
      response.status(403).json({ error: "insufficient_role" });
      return;
    }
    if (!mailConsentClient) {
      response.status(503).json({ error: "mail_unavailable" });
      return;
    }
    const transaction = createAuthTransaction("/quantri");
    request.session.mailConsent = transaction;
    // { page: "settings" } from Cài đặt thông báo: Microsoft's answer leads back there.
    request.session.mailConsentPage = (request.body as { page?: unknown } | undefined)?.page === "settings" ? "settings" : "compose";
    // The account's UPN preselects it on Microsoft's page (the opaque login_hint claim only when there is no UPN).
    const url = await mailConsentClient.getConsentUrl(transaction, user.tenantId, user.username ?? user.email ?? request.session.logoutHint ?? null);
    await saveSession(request);
    response.json({ url });
  });

  /** The rest of the email test once Microsoft sends the member back: the outcome page's address. */
  async function finishMailTest(request: Request, transaction: AuthTransaction, page: MailConsentPage): Promise<string> {
    const back = (outcome: string, code?: string | null) => mailTestRedirect(config, outcome, code, page);
    const microsoftError = request.query.error;
    if (typeof microsoftError === "string") {
      // access_denied: the member cancelled, or the school lets only an administrator grant the permission.
      return back(microsoftError === "access_denied" ? "denied" : "failed",
        aadstsCode(request.query.error_description) ?? microsoftError);
    }
    if (!isAuthTransactionFresh(transaction)) return back("expired");
    const user = request.session.user;
    if (!user || !canManageAdmin(user.role)) return back("signed_out");
    const code = request.query.code;
    if (typeof code !== "string" || code.length === 0) return back("failed", "missing_code");
    if (!mailConsentClient) return back("failed", "mail_unavailable");

    let grant: MailConsentGrant;
    try {
      grant = await mailConsentClient.exchangeCode(code, transaction.codeVerifier, transaction.nonce, user.tenantId);
    } catch (error) {
      const reason = aadstsCode(error instanceof Error ? error.message : null)
        ?? (error && typeof error === "object" && "errorCode" in error && typeof error.errorCode === "string" ? error.errorCode : "exchange_failed");
      console.error(`[MAIL] Microsoft did not exchange the consent code (${reason})`);
      return back("failed", reason);
    }
    if (!grant.nonce || !isSafeEqual(grant.nonce, transaction.nonce)) return back("failed", "invalid_nonce");
    // Only the account signed in to EduPath AI: a message never leaves another mailbox picked on Microsoft's page.
    if (grant.tenantId !== user.tenantId || grant.objectId !== user.objectId) return back("other_account");
    const to = grant.email ?? grant.username ?? user.email ?? user.username;
    if (!to) return back("failed", "no_mailbox");
    if (mailGrants) {
      try {
        await mailGrants.save({ userId: user.userId, address: to, tenantId: user.tenantId, cache: grant.cache });
      } catch (error) {
        console.error(`[MAIL] The mail permission was not stored (${(error as { code?: string } | null)?.code ?? "error"})`);
        return back("failed", "grant_not_saved");
      }
    }
    // "Chào Đào Văn Hòa": the name part of a school display name "MSSV - Họ tên - Lớp" (first test, 23/11/2026).
    const result = await sendMail(grant.accessToken, testMailMessage(to, personName(user.name), now(), config.webOrigin));
    if (!result.ok) {
      console.error(`[MAIL] Microsoft Graph refused the test message (${result.code})`);
      return back("send_failed", result.code);
    }
    return back("sent");
  }

  router.get("/microsoft/start", async (request, response) => {
    const transaction = createAuthTransaction(request.query.returnTo);
    addAuthTransaction(request, transaction);

    const authorizationUrl = await microsoftAuthClient.getAuthorizationUrl(transaction);
    await saveSession(request);
    response.redirect(authorizationUrl);
  });

  router.get("/microsoft/callback", async (request, response) => {
    // The email test comes back on the login's address too; its state is the session's mailConsent, never a login's.
    const mailConsent = request.session.mailConsent;
    if (mailConsent && isSafeEqual(request.query.state, mailConsent.state)) {
      const page = request.session.mailConsentPage === "settings" ? "settings" : "compose";
      delete request.session.mailConsent;
      delete request.session.mailConsentPage;
      const target = await finishMailTest(request, mailConsent, page);
      await saveSession(request);
      response.redirect(target);
      return;
    }

    const correlationId = randomUUID();
    const transaction = takeAuthTransaction(request, request.query.state);
    const microsoftError = request.query.error;
    if (typeof microsoftError === "string") {
      await saveSession(request);
      response.redirect(authErrorRedirect(config, "microsoft_denied", transaction?.returnTo));
      return;
    }

    if (
      !transaction ||
      !isAuthTransactionFresh(transaction) ||
      !isSafeEqual(request.query.state, transaction.state)
    ) {
      await saveSession(request);
      response.redirect(authErrorRedirect(config, "invalid_state", transaction?.returnTo));
      return;
    }

    const code = request.query.code;
    if (typeof code !== "string" || code.length === 0) {
      await saveSession(request);
      response.redirect(authErrorRedirect(config, "missing_code", transaction.returnTo));
      return;
    }

    let verifiedIdentity: MicrosoftIdentity | undefined;
    const portal = transaction.returnTo === "/quantri" ? "admin" : "student";
    try {
      const identity = await microsoftAuthClient.exchangeAuthorizationCode(
        code,
        transaction.codeVerifier,
        transaction.nonce
      );
      assertIdentityIsAllowed(identity, transaction, config);
      verifiedIdentity = identity;
      // Staff mailboxes may only sign in through the admin portal, and only
      // after an admin approves a role for them below.
      if (transaction.returnTo !== "/quantri" && isStaffAccount(identity, config.staffEmailDomains)) {
        await authActivity?.record(identity, "denied", "staff_portal_only", portal);
        await saveSession(request);
        response.redirect(authErrorRedirect(config, "staff_portal_only", transaction.returnTo));
        return;
      }
      // The assigned role decides the portal: admin-portal roles sign in only
      // through /quantri, and the student role only through the student portal.
      const portalDenial = (role: AppRole) => portal === "admin"
        ? canAccessAdmin(role) ? null : "admin_required"
        : canAccessAdmin(role) ? "admin_portal_only" : null;
      const roleOverride = await userRepository.getRoleOverride(identity);
      const role = roleOverride ?? resolveAppRole(identity.roles, config.authDefaultRole);
      const denial = portalDenial(role);
      if (denial) {
        await authActivity?.record(identity, "denied", denial, portal);
        await saveSession(request);
        response.redirect(authErrorRedirect(config, denial, transaction.returnTo));
        return;
      }
      const user = await userRepository.upsertMicrosoftUser(identity, role, {
        requireRoleOverride: roleOverride !== null
      });
      // Check the persisted role too, in case an override changed during sign-in.
      const persistedDenial = portalDenial(user.role);
      if (persistedDenial) {
        await authActivity?.record(identity, "denied", persistedDenial, portal);
        await saveSession(request);
        response.redirect(authErrorRedirect(config, persistedDenial, transaction.returnTo));
        return;
      }

      await regenerateSession(request);
      request.session.user = user;
      if (identity.loginHint) request.session.logoutHint = identity.loginHint;
      await saveSession(request);

      await authActivity?.record(identity, "success", "signed_in", portal);
      response.redirect(transaction.returnTo === "/quantri"
        ? frontendUrl(config, "/quantri")
        : callbackRedirect(config, transaction.returnTo));
    } catch (error) {
      await destroySession(request);
      if (verifiedIdentity) await authActivity?.record(verifiedIdentity, "denied", "callback_failed", portal).catch(() => undefined);
      const errorName = error instanceof Error ? error.name : "UnknownAuthError";
      console.error(`[AUTH:${correlationId}] Microsoft callback failed (${errorName})`);
      response.redirect(authErrorRedirect(config, "callback_failed", transaction.returnTo));
    }
  });

  router.get("/me", (request, response) => {
    if (!request.session.user) {
      response.json({ authenticated: false });
      return;
    }

    response.json({
      authenticated: true,
      user: request.session.user,
      studentPortal: canUseStudentPortal(request.session.user, config.staffEmailDomains)
    });
  });

  router.post("/logout", async (request, response) => {
    if (!isSameOrigin(request, config.webOrigin)) {
      response.status(403).json({ error: "invalid_origin" });
      return;
    }

    const tenantId = request.session.user?.tenantId;
    const logoutHint = request.session.logoutHint;
    // Only fixed local destinations are accepted; this is not a role grant.
    const returnPath = request.query.portal === "admin"
      ? "/quantri" : "/";
    const logoutUrl = microsoftAuthClient.getLogoutUrl(tenantId, returnPath, logoutHint);
    await destroySession(request);
    response.clearCookie("edupath.sid", {
      httpOnly: true,
      secure: config.session.secure,
      sameSite: "lax",
      path: "/"
    });
    response.json({ logoutUrl });
  });

  return router;
}
