// Quyền gửi thư của Microsoft (AD-NOTI-04, 2026-11-23). A staff member signed in to the admin portal grants EduPath AI the
// delegated Mail.Send permission on Microsoft's consent page. It is asked for at run time (incremental consent; user:
// "hiện tại không thể vào app"), so the app registration needs no change, and it comes back on the login's own redirect
// address (auth/router.ts tells the two apart by the state). Every call uses a new MSAL client: its token cache leaves the
// call only as the serialized `cache`, which the caller encrypts and stores (mail/grants.ts) and hands back to renew the
// token when mail goes out.
import { ConfidentialClientApplication, InteractionRequiredAuthError, LogLevel, ResponseMode, type Configuration } from "@azure/msal-node";
import type { AppConfig } from "../config.js";
import type { AuthTransaction } from "./types.js";

export const MAIL_SEND_SCOPE = "https://graph.microsoft.com/Mail.Send";
const MAIL_CONSENT_SCOPES = ["openid", "profile", "email", MAIL_SEND_SCOPE];

/** What Microsoft gave for the code: a Graph token with Mail.Send and the account it belongs to (from the ID token). */
export type MailConsentGrant = {
  accessToken: string;
  tenantId: string | null;
  objectId: string | null;
  nonce: string | null;
  email: string | null;
  username: string | null;
  /** The MSAL token cache after the exchange (with the refresh token), to be stored encrypted. */
  cache: string;
};

/** A Graph token for Mail.Send out of a stored cache, and the cache as it is now (MSAL may have renewed the refresh token). */
export type MailToken = { accessToken: string; cache: string };

export interface MailConsentClient {
  /** Microsoft's page asking the account (`loginHint`) of `tenantId` for Mail.Send. */
  getConsentUrl(transaction: AuthTransaction, tenantId: string, loginHint: string | null): Promise<string>;
  /** The code that page sent back, exchanged with the transaction's PKCE verifier. */
  exchangeCode(code: string, codeVerifier: string, nonce: string, tenantId: string): Promise<MailConsentGrant>;
  /**
   * A token from a stored cache. Throws with errorCode "grant_required" when Microsoft wants the member to allow EduPath AI
   * again (permission withdrawn, expired, password changed); any other error is temporary.
   */
  acquireToken(tenantId: string, cache: string): Promise<MailToken>;
}

export class MsalMailConsentClient implements MailConsentClient {
  public constructor(private readonly config: AppConfig) {}

  /** A new client on the account's own tenant, so the account picker stays in it and nothing cached outlives the call. */
  private client(tenantId: string): ConfidentialClientApplication {
    const configuration: Configuration = {
      auth: {
        clientId: this.config.entra.clientId,
        clientSecret: this.config.entra.clientSecret,
        authority: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`,
      },
      system: { loggerOptions: { piiLoggingEnabled: false, logLevel: LogLevel.Error, loggerCallback: () => undefined } },
    };
    return new ConfidentialClientApplication(configuration);
  }

  public getConsentUrl(transaction: AuthTransaction, tenantId: string, loginHint: string | null): Promise<string> {
    return this.client(tenantId).getAuthCodeUrl({
      scopes: MAIL_CONSENT_SCOPES,
      redirectUri: this.config.entra.redirectUri,
      responseMode: ResponseMode.QUERY,
      state: transaction.state,
      nonce: transaction.nonce,
      codeChallenge: transaction.codeChallenge,
      codeChallengeMethod: "S256",
      ...(loginHint ? { loginHint } : {}),
    });
  }

  public async exchangeCode(code: string, codeVerifier: string, nonce: string, tenantId: string): Promise<MailConsentGrant> {
    const client = this.client(tenantId);
    const result = await client.acquireTokenByCode({
      code,
      scopes: MAIL_CONSENT_SCOPES,
      redirectUri: this.config.entra.redirectUri,
      codeVerifier,
      nonce,
    });
    const cache = client.getTokenCache().serialize();
    const claims = (result.idTokenClaims ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof claims[key] === "string" && claims[key] ? claims[key] as string : null);
    return {
      accessToken: result.accessToken,
      tenantId: text("tid"),
      objectId: text("oid"),
      nonce: text("nonce"),
      email: text("email"),
      username: text("preferred_username"),
      cache,
    };
  }

  public async acquireToken(tenantId: string, cache: string): Promise<MailToken> {
    const client = this.client(tenantId);
    const tokens = client.getTokenCache();
    tokens.deserialize(cache);
    const [account] = await tokens.getAllAccounts();
    if (!account) throw Object.assign(new Error("The stored mail permission holds no account"), { errorCode: "grant_required" });
    try {
      const result = await client.acquireTokenSilent({ account, scopes: [MAIL_SEND_SCOPE] });
      return { accessToken: result.accessToken, cache: tokens.serialize() };
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) throw Object.assign(new Error("Microsoft asks to allow EduPath AI again"), { errorCode: "grant_required" });
      throw error;
    }
  }
}
