import { z } from "zod";

const booleanFromString = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase() === "true";
}, z.boolean());

const postgresUrl = z.string().trim().min(1).refine((value) => {
  try {
    return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "DATABASE_URL must be a valid PostgreSQL connection URL");

const optionalWorkerKey = z.preprocess(v => typeof v === "string" && !v.trim() ? undefined : v, z.string().min(32).optional());

const environmentSchema = z.object({
  OCR_WORKER_KEY: optionalWorkerKey,
  // Bearer key of the local AI worker (competency comments). Optional: without it AI is disabled.
  AI_WORKER_KEY: optionalWorkerKey,
  // Where the AI jobs run (user 2026-11-08): "ollama" (default) = the worker on the PC polls this API; "cloudflare" = this
  // process runs the worker itself on Cloudflare Workers AI (ai-worker/cloud.ts). Read leniently: a wrong value or a
  // badly pasted Cloudflare id never stops the site, server.ts only logs why the AI worker did not start.
  AI_PROVIDER: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  AI_CONCURRENCY: z.string().optional(),
  AI_THINKING: z.string().optional(),
  AI_DAILY_NEURONS: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().optional(),
  RENDER_EXTERNAL_HOSTNAME: z.string().trim().min(1).optional(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must contain at least 32 characters"),
  SESSION_MAX_AGE_MS: z.coerce.number().int().positive().default(28_800_000),
  TRUST_PROXY: booleanFromString.default(false),
  DATABASE_URL: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    postgresUrl.optional()
  ),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),
  DATABASE_AUTO_MIGRATE: booleanFromString.default(true),
  ENTRA_CLIENT_ID: z.uuid(),
  ENTRA_CLIENT_SECRET: z.string().min(1),
  ENTRA_TENANT_ID: z.uuid().optional(),
  ENTRA_AUTHORITY: z.url().default("https://login.microsoftonline.com/organizations"),
  ENTRA_REDIRECT_URI: z.url().optional(),
  ENTRA_POST_LOGOUT_REDIRECT_URI: z.url().optional(),
  ENTRA_ALLOW_ANY_TENANT: booleanFromString.default(false),
  ENTRA_ALLOWED_TENANT_IDS: z.string().default(""),
  AUTH_DEFAULT_ROLE: z.enum(["student", "none"]).default("none"),
  // Staff mailbox domains. These accounts belong to lecturers and university
  // staff, so they may only reach the admin portal, and only once an admin has
  // approved a role for them.
  STAFF_EMAIL_DOMAINS: z.string().default("vlu.edu.vn")
}).refine(
  (env) => !env.AI_WORKER_KEY || env.AI_WORKER_KEY !== env.OCR_WORKER_KEY,
  { message: "AI_WORKER_KEY must differ from OCR_WORKER_KEY", path: ["AI_WORKER_KEY"] }
);

/** Where the AI jobs run; cloudflare is null unless both values look right. */
export interface AiProviderConfig {
  provider: "ollama" | "cloudflare";
  cloudflare: { accountId: string; apiToken: string } | null;
  /** Jobs the in-process worker runs at a time (AI_CONCURRENCY, 1–4, default 2). */
  concurrency: number;
  /** AI_THINKING=on: jobs that ask for Gemma's thinking get it on Cloudflare too (off by default, cloudflare.ts). */
  thinking: boolean;
  /** AI_DAILY_NEURONS: neurons the last 24 hours may spend on Workers AI (default 9000, under the free 10,000); null = no limit ("off"). */
  dailyNeurons: number | null;
}

/** AI_PROVIDER and the Cloudflare values, read without ever failing the start. */
export function aiProviderConfig(environment: { [key in "AI_PROVIDER" | "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_API_TOKEN" | "AI_CONCURRENCY" | "AI_THINKING" | "AI_DAILY_NEURONS"]?: string | undefined }): AiProviderConfig {
  const clean = (value: string | undefined) => (value ?? "").trim().replace(/^["']|["']$/g, "").trim();
  const accountId = clean(environment.CLOUDFLARE_ACCOUNT_ID).toLowerCase();
  const apiToken = clean(environment.CLOUDFLARE_API_TOKEN);
  const concurrency = Number(clean(environment.AI_CONCURRENCY) || 2);
  return {
    provider: clean(environment.AI_PROVIDER).toLowerCase() === "cloudflare" ? "cloudflare" : "ollama",
    cloudflare: /^[0-9a-f]{32}$/.test(accountId) && /^[A-Za-z0-9_-]{20,400}$/.test(apiToken) ? { accountId, apiToken } : null,
    concurrency: Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 4 ? concurrency : 2,
    thinking: clean(environment.AI_THINKING).toLowerCase() === "on",
    dailyNeurons: dailyNeurons(clean(environment.AI_DAILY_NEURONS))
  };
}

/** AI_DAILY_NEURONS: "off" (or 0) for no limit, a positive number of neurons, else the default under the free 10,000. */
function dailyNeurons(value: string): number | null {
  if (/^(off|0)$/i.test(value)) return null;
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 9_000;
}

export interface AppConfig {
  ocrWorkerKey?: string;
  aiWorkerKey?: string;
  /** Absent in hand-made test configs: the PC worker (ollama). */
  ai?: AiProviderConfig;
  nodeEnv: "development" | "test" | "production";
  port: number;
  webOrigin: string;
  session: {
    secret: string;
    maxAgeMs: number;
    secure: boolean;
  };
  trustProxy: boolean;
  database: {
    url: string | undefined;
    maxConnections: number;
    connectionTimeoutMs: number;
    idleTimeoutMs: number;
    autoMigrate: boolean;
  };
  entra: {
    clientId: string;
    clientSecret: string;
    tenantId?: string;
    authority: string;
    redirectUri: string;
    postLogoutRedirectUri: string;
    allowAnyTenant: boolean;
    allowedTenantIds: ReadonlySet<string>;
  };
  authDefaultRole: "student" | "none";
  staffEmailDomains: ReadonlySet<string>;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const renderOrigin = parsed.RENDER_EXTERNAL_HOSTNAME
    ? `https://${parsed.RENDER_EXTERNAL_HOSTNAME}`
    : undefined;
  const webOrigin = (parsed.WEB_ORIGIN ?? renderOrigin ?? "http://localhost:5173")
    .replace(/\/$/, "");
  const redirectUri =
    parsed.ENTRA_REDIRECT_URI ??
    new URL("/api/auth/microsoft/callback", `${webOrigin}/`).toString();
  // Student logout returns to the introduction page, including older configs
  // that point at the login page or an authenticated route.
  const postLogoutRedirectUri = new URL(
    "/",
    parsed.ENTRA_POST_LOGOUT_REDIRECT_URI ?? `${webOrigin}/`
  ).toString();
  const allowedTenantIds = new Set(
    parsed.ENTRA_ALLOWED_TENANT_IDS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  if (parsed.ENTRA_TENANT_ID) {
    allowedTenantIds.add(parsed.ENTRA_TENANT_ID.toLowerCase());
  }

  if (!parsed.ENTRA_ALLOW_ANY_TENANT && allowedTenantIds.size === 0) {
    throw new Error(
      "At least one tenant must be configured when ENTRA_ALLOW_ANY_TENANT is false"
    );
  }

  return {
    ...(parsed.OCR_WORKER_KEY ? {ocrWorkerKey:parsed.OCR_WORKER_KEY} : {}),
    ...(parsed.AI_WORKER_KEY ? { aiWorkerKey: parsed.AI_WORKER_KEY } : {}),
    ai: aiProviderConfig(parsed),
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    webOrigin,
    session: {
      secret: parsed.SESSION_SECRET,
      maxAgeMs: parsed.SESSION_MAX_AGE_MS,
      secure: parsed.NODE_ENV === "production"
    },
    trustProxy: parsed.TRUST_PROXY,
    database: {
      url: parsed.DATABASE_URL,
      maxConnections: parsed.DATABASE_POOL_MAX,
      connectionTimeoutMs: parsed.DATABASE_CONNECTION_TIMEOUT_MS,
      idleTimeoutMs: parsed.DATABASE_IDLE_TIMEOUT_MS,
      autoMigrate: parsed.DATABASE_AUTO_MIGRATE
    },
    entra: {
      clientId: parsed.ENTRA_CLIENT_ID,
      clientSecret: parsed.ENTRA_CLIENT_SECRET,
      ...(parsed.ENTRA_TENANT_ID ? { tenantId: parsed.ENTRA_TENANT_ID } : {}),
      authority: parsed.ENTRA_AUTHORITY.replace(/\/$/, ""),
      redirectUri,
      postLogoutRedirectUri,
      allowAnyTenant: parsed.ENTRA_ALLOW_ANY_TENANT,
      allowedTenantIds
    },
    authDefaultRole: parsed.AUTH_DEFAULT_ROLE,
    staffEmailDomains: new Set(
      parsed.STAFF_EMAIL_DOMAINS.split(",")
        .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean)
    )
  };
}
