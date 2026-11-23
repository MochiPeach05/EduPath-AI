import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { toAuthenticatedUser } from "./auth/security.js";
import type {
  AppRole,
  AuthTransaction,
  AuthenticatedUser,
  MicrosoftAuthClient,
  MicrosoftIdentity
} from "./auth/types.js";
import type { UserRepository } from "./users/user-repository.js";
import { MemoryUserRepository } from "./users/memory-user-repository.js";
import type { DatabasePool } from "./db/pool.js";
import type { MailConsentClient, MailConsentGrant, MailToken } from "./auth/mail-consent-client.js";
import type { MailMessage, MailResult } from "./mail/graph-mail.js";
import type { MailGrant, MailGrantStore } from "./mail/grants.js";

const clientId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";

const config: AppConfig = {
  nodeEnv: "test",
  port: 4000,
  webOrigin: "http://localhost:5173",
  session: {
    secret: "test-session-secret-that-is-longer-than-32-characters",
    maxAgeMs: 28_800_000,
    secure: false
  },
  trustProxy: false,
  database: {
    url: "postgresql://test:test@localhost:5432/edupath_test",
    maxConnections: 2,
    connectionTimeoutMs: 1_000,
    idleTimeoutMs: 1_000,
    autoMigrate: false
  },
  entra: {
    clientId,
    clientSecret: "test-secret",
    tenantId,
    authority: "https://login.microsoftonline.com/organizations",
    redirectUri: "http://localhost:4000/api/auth/microsoft/callback",
    postLogoutRedirectUri: "http://localhost:5173/",
    allowAnyTenant: true,
    allowedTenantIds: new Set([tenantId])
  },
  authDefaultRole: "student",
  staffEmailDomains: new Set(["vlu.edu.vn"])
};

class FakeMicrosoftAuthClient implements MicrosoftAuthClient {
  public transaction: AuthTransaction | null = null;
  public nextRoles: string[] = [];
  public nextEmail = "test@example.edu";
  public nextName = "Test User";
  public exchangeCount = 0;

  public async getAuthorizationUrl(transaction: AuthTransaction): Promise<string> {
    this.transaction = transaction;
    const url = new URL("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    url.searchParams.set("state", transaction.state);
    url.searchParams.set("code_challenge", transaction.codeChallenge);
    return url.toString();
  }

  public async exchangeAuthorizationCode(
    _code: string,
    _codeVerifier: string,
    nonce: string
  ): Promise<MicrosoftIdentity> {
    this.exchangeCount += 1;
    return {
      tenantId,
      objectId: "33333333-3333-4333-8333-333333333333",
      subject: "subject",
      name: this.nextName,
      email: this.nextEmail,
      username: this.nextEmail,
      loginHint: "test-login-hint",
      roles: this.nextRoles,
      nonce,
      audience: clientId,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    };
  }

  public getLogoutUrl(id?: string, returnPath: "/" | "/quantri" = "/", logoutHint?: string): string {
    const url = new URL(`https://login.microsoftonline.com/${id ?? "organizations"}/logout`);
    url.searchParams.set("post_logout_redirect_uri", new URL(returnPath, config.webOrigin).toString());
    if (logoutHint) url.searchParams.set("logout_hint", logoutHint);
    return url.toString();
  }
}

class FakeUserRepository implements UserRepository {
  public readonly users = new Map<string, AuthenticatedUser>();
  public upsertCount = 0;
  public shouldFail = false;
  public roleOverride: AppRole | null = null;

  public async getRoleOverride(_identity: MicrosoftIdentity): Promise<AppRole | null> {
    return this.roleOverride;
  }

  public async upsertMicrosoftUser(
    identity: MicrosoftIdentity,
    role: AppRole
  ): Promise<AuthenticatedUser> {
    this.upsertCount += 1;
    if (this.shouldFail) throw new Error("Database unavailable");

    const identityKey = `${identity.tenantId}:${identity.objectId}`;
    const existing = this.users.get(identityKey);
    const user = toAuthenticatedUser(
      identity,
      role,
      existing?.userId ?? "55555555-5555-4555-8555-555555555555"
    );
    this.users.set(identityKey, user);
    return user;
  }
}

function createTestApp(
  authClient: FakeMicrosoftAuthClient,
  userRepository = new FakeUserRepository()
) {
  return createApp({
    config,
    microsoftAuthClient: authClient,
    userRepository
  });
}

async function login(
  agent: ReturnType<typeof request.agent>,
  authClient: FakeMicrosoftAuthClient,
  returnTo = "/dashboard"
) {
  const start = await agent
    .get("/api/auth/microsoft/start")
    .query({ returnTo })
    .expect(302);
  const state = new URL(start.headers.location).searchParams.get("state");
  expect(state).toBeTruthy();

  return agent
    .get("/api/auth/microsoft/callback")
    .query({ code: "test-code", state })
    .expect(302);
}

describe("Microsoft authentication routes", () => {
  it("records successful sign-in and rejects a subsequently revoked session", async () => {
    const client = new FakeMicrosoftAuthClient(); client.nextRoles = ["Admin"];
    const activity = { current: vi.fn().mockResolvedValue(true), record: vi.fn().mockResolvedValue(undefined) };
    const agent = request.agent(createApp({ config, microsoftAuthClient: client, userRepository: new FakeUserRepository(), authActivity: activity }));
    await login(agent, client, "/quantri");
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), "success", "signed_in", "admin");
    await agent.get("/api/admin/me").expect(200);
    activity.current.mockResolvedValue(false);
    await agent.get("/api/admin/summary").expect(401);
    activity.current.mockResolvedValue(true);
    await agent.get("/api/admin/me").expect(401);
  });
  it("records verified admin denial but never fabricates an identity for invalid state", async () => {
    const client = new FakeMicrosoftAuthClient();
    const activity = { current: vi.fn().mockResolvedValue(true), record: vi.fn().mockResolvedValue(undefined) };
    const agent = request.agent(createApp({ config, microsoftAuthClient: client, userRepository: new FakeUserRepository(), authActivity: activity }));
    await login(agent, client, "/quantri");
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), "denied", "admin_required", "admin");
    activity.record.mockClear();
    await agent.get("/api/auth/microsoft/callback?state=invalid&code=bad").expect(302);
    expect(activity.record).not.toHaveBeenCalled();
  });
  it("does not leave a usable session if history persistence fails", async () => {
    const client = new FakeMicrosoftAuthClient(); client.nextRoles = ["Admin"];
    const activity = { current: vi.fn().mockResolvedValue(true), record: vi.fn().mockRejectedValue(new Error("storage unavailable")) };
    const agent = request.agent(createApp({ config, microsoftAuthClient: client, userRepository: new FakeUserRepository(), authActivity: activity }));
    expect((await login(agent, client, "/quantri")).headers.location).toContain("authError=callback_failed");
    await agent.get("/api/admin/me").expect(401);
  });
  it.each(["faculty_board", "department_head", "lecturer", "admin"] as const)("keeps assigned %s on the admin portal only", async role => {
    const client = new FakeMicrosoftAuthClient();
    client.nextEmail = "hoa.2374802010145@vanlanguni.vn";
    const repository = new FakeUserRepository(); repository.roleOverride = role;
    const activity = { current: vi.fn().mockResolvedValue(true), record: vi.fn().mockResolvedValue(undefined) };
    const agent = request.agent(createApp({ config, microsoftAuthClient: client, userRepository: repository, authActivity: activity }));
    expect((await login(agent, client, "/quantri")).headers.location).toBe(`${config.webOrigin}/quantri`);
    await agent.get("/api/admin/me").expect(200);
    expect((await agent.get("/api/auth/me").expect(200)).body.studentPortal).toBe(false);
    await agent.get("/api/student/summary").expect(403);
    await agent.post("/api/auth/logout").expect(200);
    expect((await login(agent, client, "/dashboard")).headers.location).toBe(`${config.webOrigin}/login?authError=admin_portal_only`);
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), "denied", "admin_portal_only", "student");
    expect((await agent.get("/api/auth/me")).body.authenticated).toBe(false);
  });
  it("keeps a staff mailbox out of the student portal before saving a user", async () => {
    const client = new FakeMicrosoftAuthClient();
    client.nextEmail = "giangvien@vlu.edu.vn";
    const repository = new FakeUserRepository();
    const activity = { current: vi.fn().mockResolvedValue(true), record: vi.fn().mockResolvedValue(undefined) };
    const agent = request.agent(createApp({ config, microsoftAuthClient: client, userRepository: repository, authActivity: activity }));
    const callback = await login(agent, client, "/dashboard");
    expect(callback.headers.location).toBe(`${config.webOrigin}/login?authError=staff_portal_only`);
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), "denied", "staff_portal_only", "student");
    expect(repository.upsertCount).toBe(0);
    expect((await agent.get("/api/auth/me")).body.authenticated).toBe(false);
  });

  it("lets an approved staff mailbox use the admin portal but no student endpoint", async () => {
    const client = new FakeMicrosoftAuthClient();
    client.nextEmail = "giangvien@vlu.edu.vn";
    const repository = new FakeUserRepository();
    repository.roleOverride = "lecturer";
    const agent = request.agent(createTestApp(client, repository));
    expect((await login(agent, client, "/quantri")).headers.location).toBe(`${config.webOrigin}/quantri`);
    await agent.get("/api/admin/me").expect(200);
    await agent.get("/api/student/summary").expect(403);
  });

  it("refuses an unapproved staff mailbox on the admin portal", async () => {
    const client = new FakeMicrosoftAuthClient();
    client.nextEmail = "nhanvien@vlu.edu.vn";
    const repository = new FakeUserRepository();
    const agent = request.agent(createTestApp(client, repository));
    expect((await login(agent, client, "/quantri")).headers.location).toBe(`${config.webOrigin}/quantri?authError=admin_required`);
    expect(repository.upsertCount).toBe(0);
  });

  it("keeps a student-role mailbox on the student portal only", async () => {
    const client = new FakeMicrosoftAuthClient();
    client.nextEmail = "duy.2374802010078@vanlanguni.vn";
    const agent = request.agent(createTestApp(client));
    expect((await login(agent, client, "/dashboard")).headers.location).toContain("/auth/callback");
    expect((await agent.get("/api/auth/me").expect(200)).body.studentPortal).toBe(true);
    await agent.get("/api/student/summary").expect(200);
    await agent.post("/api/auth/logout").expect(200);
    expect((await login(agent, client, "/quantri")).headers.location).toBe(`${config.webOrigin}/quantri?authError=admin_required`);
  });

  it("accepts a database-assigned Admin without a Microsoft Admin claim", async () => {
    const client = new FakeMicrosoftAuthClient();
    const repository = new FakeUserRepository();
    repository.roleOverride = "admin";
    const agent = request.agent(createTestApp(client, repository));
    const callback = await login(agent, client, "/quantri");
    expect(callback.headers.location).toBe(`${config.webOrigin}/quantri`);
    expect((await agent.get("/api/admin/me").expect(200)).body.user.role).toBe("admin");
    await agent.post("/api/auth/logout").expect(200);
    await login(agent, client, "/quantri");
    await agent.get("/api/admin/me").expect(200);
  });

  it("honors an explicit Student override even with a Microsoft Admin claim", async () => {
    const client = new FakeMicrosoftAuthClient();
    client.nextRoles = ["Admin"];
    const repository = new FakeUserRepository();
    repository.roleOverride = "student";
    const agent = request.agent(createTestApp(client, repository));
    const callback = await login(agent, client, "/quantri");
    expect(callback.headers.location).toContain("authError=admin_required");
    await agent.get("/api/admin/me").expect(401);
    expect(repository.upsertCount).toBe(0);
  });
  it("admits an Admin via /quantri and ends access after logout", async () => {
    const client = new FakeMicrosoftAuthClient();
    client.nextRoles = ["Admin"];
    const agent = request.agent(createTestApp(client));
    await agent.get("/api/admin/me").expect(401);
    const callback = await login(agent, client, "/quantri");
    expect(callback.headers.location).toBe(`${config.webOrigin}/quantri`);
    const me = await agent.get("/api/admin/me").expect(200);
    expect(me.body.user.role).toBe("admin");
    expect(me.headers["cache-control"]).toBe("no-store");
    const result = await agent.post("/api/auth/logout?portal=admin").expect(200);
    expect(new URL(result.body.logoutUrl).searchParams.get("post_logout_redirect_uri")).toBe(`${config.webOrigin}/quantri`);
    await agent.get("/api/admin/me").expect(401);
    await agent.get("/api/admin/summary").expect(401);
  });

  it.each(["/quantri", "/quantri/", "/quantri?tab=users", "/quantri/users"])(
    "refuses Student authentication into %s before saving a user", async (path) => {
      const client = new FakeMicrosoftAuthClient();
      const repository = new FakeUserRepository();
      const agent = request.agent(createTestApp(client, repository));
      const callback = await login(agent, client, path);
      expect(callback.headers.location).toBe(`${config.webOrigin}/quantri?authError=admin_required`);
      expect(repository.upsertCount).toBe(0);
      await agent.get("/api/admin/me").expect(401);
      expect((await agent.get("/api/auth/me")).body.authenticated).toBe(false);
    }
  );

  it("keeps an existing Student out of admin and permits signing out to the admin login", async () => {
    const client = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(client));
    await login(agent, client);
    await agent.get("/api/admin/me").expect(403);
    const result = await agent.post("/api/auth/logout?portal=admin").expect(200);
    expect(new URL(result.body.logoutUrl).searchParams.get("post_logout_redirect_uri")).toBe(`${config.webOrigin}/quantri`);
    await agent.get("/api/admin/me").expect(401);
  });

  it.each(["denied", "missing_code", "exchange_failure"])("returns admin callback failure %s to the admin login", async (failure) => {
    const client = new FakeMicrosoftAuthClient();
    const repository = new FakeUserRepository();
    client.nextRoles = ["Admin"];
    repository.shouldFail = failure === "exchange_failure";
    const agent = request.agent(createTestApp(client, repository));
    const start = await agent.get("/api/auth/microsoft/start?returnTo=%2Fquantri").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");
    const query = failure === "denied" ? { state, error: "access_denied" }
      : failure === "missing_code" ? { state } : { state, code: "code" };
    const callback = await agent.get("/api/auth/microsoft/callback").query(query).expect(302);
    expect(callback.headers.location).toMatch(/\/quantri\?authError=/);
    await agent.get("/api/admin/me").expect(401);
  });

  it("ignores external logout destinations for Student sessions", async () => {
    const client = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(client));
    await login(agent, client);
    const result = await agent.post("/api/auth/logout?portal=https://evil.example&returnTo=https://evil.example").expect(200);
    expect(new URL(result.body.logoutUrl).searchParams.get("post_logout_redirect_uri")).toBe(`${config.webOrigin}/`);
  });
  it("supports login, repeated login and logout without PostgreSQL", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createApp({
      config: { ...config, database: { ...config.database, url: undefined } },
      microsoftAuthClient: authClient,
      userRepository: new MemoryUserRepository()
    }));
    await login(agent, authClient);
    const first = await agent.get("/api/auth/me").expect(200);
    expect(first.body.authenticated).toBe(true);
    await agent.get("/api/admin/summary").expect(403);
    await login(agent, authClient);
    const second = await agent.get("/api/auth/me").expect(200);
    expect(second.body.user.userId).toBe(first.body.user.userId);
    await agent.post("/api/auth/logout").expect(200);
    const signedOut = await agent.get("/api/auth/me").expect(200);
    expect(signedOut.body.authenticated).toBe(false);
  });
  it("creates PKCE state and a secure local session cookie before redirecting", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(authClient));

    const response = await agent.get("/api/auth/microsoft/start").expect(302);

    expect(response.headers.location).toContain("login.microsoftonline.com");
    expect(authClient.transaction?.state).toBeTruthy();
    expect(authClient.transaction?.nonce).toBeTruthy();
    expect(authClient.transaction?.codeVerifier).toBeTruthy();
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
  });

  it("creates a Student session after a valid callback", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const userRepository = new FakeUserRepository();
    const agent = request.agent(createTestApp(authClient, userRepository));

    const callback = await login(agent, authClient);
    expect(callback.headers.location).toContain("/auth/callback?returnTo=%2Fdashboard");

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.authenticated).toBe(true);
    expect(me.body.user.role).toBe("student");
    expect(me.body.user.userId).toBe("55555555-5555-4555-8555-555555555555");
    expect(me.body.user.identityKey).toBe(
      `${tenantId}:33333333-3333-4333-8333-333333333333`
    );
    expect(userRepository.upsertCount).toBe(1);
    expect(userRepository.users.size).toBe(1);
  });

  it("upserts the same Microsoft identity instead of creating a duplicate", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const userRepository = new FakeUserRepository();
    const agent = request.agent(createTestApp(authClient, userRepository));

    await login(agent, authClient);
    await login(agent, authClient);

    expect(userRepository.upsertCount).toBe(2);
    expect(userRepository.users.size).toBe(1);
  });

  it("does not create an authenticated session when persistence fails", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const userRepository = new FakeUserRepository();
    userRepository.shouldFail = true;
    const agent = request.agent(createTestApp(authClient, userRepository));

    const callback = await login(agent, authClient);
    expect(callback.headers.location).toContain("authError=callback_failed");

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body).toEqual({ authenticated: false });
  });

  it("rejects an invalid state without exchanging an authorization code", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(authClient));
    await agent.get("/api/auth/microsoft/start").expect(302);

    const callback = await agent
      .get("/api/auth/microsoft/callback")
      .query({ code: "test-code", state: "wrong-state" })
      .expect(302);

    expect(callback.headers.location).toContain("authError=invalid_state");
    expect(authClient.exchangeCount).toBe(0);
  });

  it("consumes state once and rejects a replayed callback", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(authClient));
    const start = await agent.get("/api/auth/microsoft/start").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");

    await agent
      .get("/api/auth/microsoft/callback")
      .query({ code: "first-code", state })
      .expect(302);
    const replay = await agent
      .get("/api/auth/microsoft/callback")
      .query({ code: "second-code", state })
      .expect(302);

    expect(replay.headers.location).toContain("authError=invalid_state");
    expect(authClient.exchangeCount).toBe(1);
  });

  it("allows Admin role and blocks Student from the admin endpoint", async () => {
    const studentClient = new FakeMicrosoftAuthClient();
    const student = request.agent(createTestApp(studentClient));
    await login(student, studentClient);
    await student.get("/api/admin/summary").expect(403);

    const adminClient = new FakeMicrosoftAuthClient();
    adminClient.nextRoles = ["Admin"];
    const admin = request.agent(createTestApp(adminClient));
    await login(admin, adminClient, "/quantri");
    await admin.get("/api/admin/summary").expect(200);
  });

  it("destroys the local session on logout and checks the request origin", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(authClient));
    await login(agent, authClient);

    await agent
      .post("/api/auth/logout")
      .set("Origin", "https://evil.example")
      .expect(403);

    const logout = await agent
      .post("/api/auth/logout")
      .set("Origin", config.webOrigin)
      .expect(200);
    expect(logout.body.logoutUrl).toContain(tenantId);
    expect(new URL(logout.body.logoutUrl).searchParams.get("post_logout_redirect_uri")).toBe(`${config.webOrigin}/`);
    expect(new URL(logout.body.logoutUrl).searchParams.get("logout_hint")).toBe("test-login-hint");
    expect(logout.headers["set-cookie"]?.[0]).toContain("edupath.sid=");

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body).toEqual({ authenticated: false });
  });
});

describe("the reference rows the student pages share (db/reference-cache.ts, 2026-11-10)", () => {
  it("are read once for many requests, and again after any write request to the admin API", async () => {
    const query = vi.fn(async (sql: string) => (sql.startsWith("SELECT id FROM users") ? { rowCount: 1, rows: [{ id: "u" }] } : { rowCount: 0, rows: [] }));
    const pool = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as DatabasePool;
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createApp({ config, microsoftAuthClient: authClient, userRepository: new FakeUserRepository(), databasePool: pool }));
    await login(agent, authClient);
    const catalogReads = () => query.mock.calls.filter(([sql]) => String(sql).includes("FROM career_positions c JOIN career_fields f")).length;
    await agent.get("/api/student/career-guidance").expect(200);
    await agent.get("/api/student/career-guidance").expect(200);
    expect(catalogReads()).toBe(1);
    // Any write to the admin API empties it, even one refused (a student session here).
    const write = await agent.post("/api/admin/careers").send({});
    expect(write.status).toBeGreaterThanOrEqual(400);
    await agent.get("/api/student/career-guidance").expect(200);
    expect(catalogReads()).toBe(2);
    // A read of the admin API does not.
    await agent.get("/api/admin/careers");
    await agent.get("/api/student/career-guidance").expect(200);
    expect(catalogReads()).toBe(2);
  });
});

class FakeMailConsentClient implements MailConsentClient {
  public consentArgs: { tenantId: string; loginHint: string | null } | null = null;
  public exchanges = 0;
  public grant: Partial<MailConsentGrant> = {};
  public failure: Error | null = null;

  public async getConsentUrl(transaction: AuthTransaction, tenant: string, loginHint: string | null): Promise<string> {
    this.consentArgs = { tenantId: tenant, loginHint };
    const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    url.searchParams.set("state", transaction.state);
    url.searchParams.set("scope", "openid profile email https://graph.microsoft.com/Mail.Send");
    return url.toString();
  }

  public async exchangeCode(_code: string, _codeVerifier: string, nonce: string): Promise<MailConsentGrant> {
    this.exchanges += 1;
    if (this.failure) throw this.failure;
    return {
      accessToken: "graph-token", tenantId, objectId: "33333333-3333-4333-8333-333333333333", nonce,
      email: "test@example.edu", username: "test@example.edu", cache: "made-up-token-cache", ...this.grant
    };
  }

  public async acquireToken(): Promise<MailToken> {
    return { accessToken: "graph-token", cache: "made-up-token-cache" };
  }
}

/** The senders' permissions in memory (mail/grants.ts keeps them encrypted in ad_mail_senders). */
class FakeMailGrantStore implements MailGrantStore {
  public grants = new Map<string, MailGrant>();
  public failure: Error | null = null;
  public async save(grant: MailGrant) {
    if (this.failure) throw this.failure;
    this.grants.set(grant.userId, grant);
  }
  public async load(userId: string) { return this.grants.get(userId) ?? null; }
  public async remove(userId: string) { return this.grants.delete(userId); }
  public async status(userId: string) {
    const grant = this.grants.get(userId);
    return grant ? { address: grant.address, grantedAt: "2026-11-23T02:00:00.000Z", lastError: null } : null;
  }
  public async markFailed() { return undefined; }
}

describe("the email test of AD-NOTI-04: Microsoft's Mail.Send, asked for at run time (2026-11-23)", () => {
  const page = `${config.webOrigin}/quantri/gui-thong-bao`;
  async function setup(role: AppRole | "student-login" = "admin", withMail = true, mailGrants?: MailGrantStore) {
    const client = new FakeMicrosoftAuthClient();
    // A school display name, as Microsoft gives it: "MSSV - Họ tên - Lớp" (made-up).
    client.nextName = "2374802019001 - Trần Minh An - 71K29CNTT08";
    const repository = new FakeUserRepository();
    if (role !== "student-login") repository.roleOverride = role;
    const mail = new FakeMailConsentClient();
    const sent: { token: string; message: MailMessage }[] = [];
    const sendMail = vi.fn(async (token: string, message: MailMessage): Promise<MailResult> => {
      sent.push({ token, message });
      return { ok: true };
    });
    const agent = request.agent(createApp({
      config, microsoftAuthClient: client, userRepository: repository, ...(withMail ? { mailConsentClient: mail } : {}), sendMail,
      ...(mailGrants ? { mailGrants } : {})
    }));
    await login(agent, client, role === "student-login" ? "/dashboard" : "/quantri");
    return { agent, mail, sendMail, sent, repository };
  }
  async function start(agent: ReturnType<typeof request.agent>) {
    const response = await agent.post("/api/auth/microsoft/mail-consent").set("Origin", config.webOrigin).expect(200);
    return new URL(response.body.url).searchParams.get("state")!;
  }
  const back = async (agent: ReturnType<typeof request.agent>, query: Record<string, string>) =>
    (await agent.get("/api/auth/microsoft/callback").query(query).expect(302)).headers.location as string;

  it("asks for Mail.Send on the member's own tenant and account, then sends one message to that mailbox", async () => {
    const { agent, mail, sent } = await setup();
    const state = await start(agent);
    expect(mail.consentArgs).toEqual({ tenantId, loginHint: "test@example.edu" });
    expect(await back(agent, { state, code: "mail-code" })).toBe(`${page}?emailTest=sent`);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.token).toBe("graph-token");
    expect(sent[0]!.message).toMatchObject({ to: "test@example.edu", subject: "[EduPath AI] Thư thử gửi thông báo qua email" });
    // The greeting names the person, not the whole display name (first real test, 23/11/2026).
    expect(sent[0]!.message.html).toContain("Chào Trần Minh An,");
    // The member stays signed in, and the same answer cannot send again.
    await agent.get("/api/admin/me").expect(200);
    expect(await back(agent, { state, code: "mail-code" })).toContain("authError=invalid_state");
    expect(sent).toHaveLength(1);
    await agent.get("/api/admin/me").expect(200);
  });

  it("is only for staff who can send announcements, from the portal's own pages", async () => {
    const anonymous = request.agent(createApp({
      config, microsoftAuthClient: new FakeMicrosoftAuthClient(), userRepository: new FakeUserRepository(), mailConsentClient: new FakeMailConsentClient()
    }));
    await anonymous.post("/api/auth/microsoft/mail-consent").set("Origin", config.webOrigin).expect(401, { error: "authentication_required" });
    const student = await setup("student-login");
    await student.agent.post("/api/auth/microsoft/mail-consent").set("Origin", config.webOrigin).expect(403, { error: "insufficient_role" });
    const advisor = await setup("advisor");
    await advisor.agent.post("/api/auth/microsoft/mail-consent").set("Origin", config.webOrigin).expect(403, { error: "insufficient_role" });
    const admin = await setup();
    await admin.agent.post("/api/auth/microsoft/mail-consent").set("Origin", "https://example.org").expect(403, { error: "invalid_origin" });
    const off = await setup("admin", false);
    await off.agent.post("/api/auth/microsoft/mail-consent").set("Origin", config.webOrigin).expect(503, { error: "mail_unavailable" });
  });

  it("sends nothing for another account, a cancelled or blocked consent, or a wrong nonce", async () => {
    const { agent, mail, sendMail } = await setup();
    mail.grant = { objectId: "44444444-4444-4444-8444-444444444444" };
    expect(await back(agent, { state: await start(agent), code: "c" })).toBe(`${page}?emailTest=other_account`);
    // Microsoft's error comes back on the callback; only its AADSTS code is passed to the page.
    expect(await back(agent, { state: await start(agent), error: "access_denied", error_description: "AADSTS65004: User declined to consent to access the app." }))
      .toBe(`${page}?emailTest=denied&code=AADSTS65004`);
    expect(await back(agent, { state: await start(agent), error: "invalid_request", error_description: "something else" }))
      .toBe(`${page}?emailTest=failed&code=invalid_request`);
    mail.grant = { nonce: "another-nonce" };
    expect(await back(agent, { state: await start(agent), code: "c" })).toBe(`${page}?emailTest=failed&code=invalid_nonce`);
    expect(mail.exchanges).toBe(2);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("says why Microsoft or Graph refused", async () => {
    const { agent, mail, sendMail } = await setup();
    mail.failure = Object.assign(new Error("AADSTS65001: The user or administrator has not consented to use the application."), { errorCode: "invalid_grant" });
    expect(await back(agent, { state: await start(agent), code: "c" })).toBe(`${page}?emailTest=failed&code=AADSTS65001`);
    mail.failure = Object.assign(new Error("network down"), { errorCode: "network_error" });
    expect(await back(agent, { state: await start(agent), code: "c" })).toBe(`${page}?emailTest=failed&code=network_error`);
    mail.failure = null;
    sendMail.mockResolvedValueOnce({ ok: false, status: 404, code: "MailboxNotEnabledForRESTAPI" });
    expect(await back(agent, { state: await start(agent), code: "c" })).toBe(`${page}?emailTest=send_failed&code=MailboxNotEnabledForRESTAPI`);
  });

  it("keeps the permission for the announcement emails, and sends nothing when it cannot be kept", async () => {
    const grants = new FakeMailGrantStore();
    const { agent, sent } = await setup("admin", true, grants);
    expect(await back(agent, { state: await start(agent), code: "c" })).toBe(`${page}?emailTest=sent`);
    expect([...grants.grants.values()]).toEqual([{ userId: expect.any(String), address: "test@example.edu", tenantId, cache: "made-up-token-cache" }]);
    expect(sent).toHaveLength(1);
    grants.failure = Object.assign(new Error("db down"), { code: "57P01" });
    expect(await back(agent, { state: await start(agent), code: "c" })).toBe(`${page}?emailTest=failed&code=grant_not_saved`);
    expect(sent).toHaveLength(1);
  });

  it("drops a test left more than ten minutes on Microsoft's page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-23T02:00:00Z"));
      const { agent, sendMail } = await setup();
      const state = await start(agent);
      vi.setSystemTime(new Date("2026-11-23T02:11:00Z"));
      expect(await back(agent, { state, code: "c" })).toBe(`${page}?emailTest=expired`);
      expect(sendMail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
