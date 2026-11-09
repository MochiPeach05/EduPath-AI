import "dotenv/config";
import { createApp } from "./app.js";
import { MsalMicrosoftAuthClient } from "./auth/microsoft-auth-client.js";
import { loadConfig } from "./config.js";
import { runDatabaseMigrations } from "./db/migrate.js";
import { createDatabasePool } from "./db/pool.js";
import { createPostgresSessionStore } from "./session/postgres-session-store.js";
import { PostgresUserRepository } from "./users/postgres-user-repository.js";
import { MemoryUserRepository } from "./users/memory-user-repository.js";
import { PostgresAdminAccountRepository } from "./admin/accounts.js";
import { PostgresAuthActivity } from "./auth/activity.js";
import { PostgresStudentProfileRepository } from "./admin/student-profiles.js";
import { chooseVietnameseCollation } from "./admin/table-sort.js";
import { startCloudAiWorker } from "./ai-worker/cloud.js";
import { createNeuronBudget } from "./ai-worker/budget.js";

async function startServer(): Promise<void> {
  const config = loadConfig();
  const databasePool = config.database.url ? createDatabasePool(config.database) : undefined;

  try {
    if (databasePool && config.database.autoMigrate) {
      await runDatabaseMigrations(databasePool);
    } else if (databasePool) {
      await databasePool.query("SELECT 1");
    } else {
      console.log("[STORAGE] Preview mode: users and sessions are temporary (no DATABASE_URL)");
    }
    if (databasePool) {
      // How the admin lists put names in Vietnamese order: ICU when the database has it, else a plain-character key.
      const collation = await chooseVietnameseCollation(databasePool);
      console.log(`[DATABASE] Vietnamese order: ${collation ? `collation "${collation}"` : "fallback key (no ICU collation for vi)"}`);
    }

    const microsoftAuthClient = new MsalMicrosoftAuthClient(config);
    const userRepository = databasePool
      ? new PostgresUserRepository(databasePool)
      : new MemoryUserRepository();
    const app = createApp({
      config,
      microsoftAuthClient,
      userRepository,
      ...(databasePool ? {
        databasePool,
        sessionStore: createPostgresSessionStore(databasePool),
        authActivity: new PostgresAuthActivity(databasePool),
        studentProfileRepository: new PostgresStudentProfileRepository(databasePool),
        adminAccountRepository: new PostgresAdminAccountRepository(databasePool)
      } : {})
    });

    let cloudWorker: ReturnType<typeof startCloudAiWorker> | null = null;
    const server = app.listen(config.port, () => {
      console.log(`EduPath API listening on http://localhost:${config.port}`);
      // AI_PROVIDER=cloudflare (user 2026-11-08): this process runs the AI jobs on Cloudflare Workers AI, no PC needed.
      if (config.ai?.provider !== "cloudflare") return;
      if (!databasePool || !config.aiWorkerKey || !config.ai.cloudflare) {
        console.error("[AI] AI_PROVIDER=cloudflare needs DATABASE_URL, AI_WORKER_KEY, CLOUDFLARE_ACCOUNT_ID (32 hex characters) and CLOUDFLARE_API_TOKEN; the AI worker was not started");
        return;
      }
      cloudWorker = startCloudAiWorker({
        port: config.port,
        workerKey: config.aiWorkerKey,
        accountId: config.ai.cloudflare.accountId,
        apiToken: config.ai.cloudflare.apiToken,
        concurrency: config.ai.concurrency,
        thinking: config.ai.thinking,
        budget: createNeuronBudget({ limit: config.ai.dailyNeurons, db: databasePool })
      });
    });

    const shutdown = (signal: string) => {
      console.log(`[SERVER] Received ${signal}; shutting down`);
      cloudWorker?.stop();
      server.close(() => {
        void (databasePool?.end() ?? Promise.resolve()).finally(() => process.exit(0));
      });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    await databasePool?.end().catch(() => undefined);
    throw error;
  }
}

try {
  await startServer();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`EduPath API could not start: ${message}`);
  process.exitCode = 1;
}
