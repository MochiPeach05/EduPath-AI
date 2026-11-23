import "express-session";
import type {
  AuthenticatedUser,
  AuthTransaction
} from "../auth/types.js";

declare module "express-session" {
  interface SessionData {
    authTransactions?: AuthTransaction[];
    /** The pending email test (AD-NOTI-04): Microsoft's Mail.Send consent, answered on the login's callback. */
    mailConsent?: AuthTransaction;
    /** The page that asked for the Mail.Send consent, where Microsoft's answer leads back (auth/router.ts). */
    mailConsentPage?: "compose" | "settings";
    user?: AuthenticatedUser;
    // Kept out of AuthenticatedUser so /api/auth/me never returns it.
    logoutHint?: string;
  }
}
