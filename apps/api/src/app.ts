import { createCareersRouter } from "./careers/router.js";
import { createCompetenciesRouter } from "./competencies/router.js";
import { createGraduationRouter } from "./graduation/router.js";
import { createStudentGraduationRouter } from "./graduation/student-router.js";
import { createGraduationAdviceRouter } from "./graduation/advice/router.js";
import { ensureGraduationAdviceAfterImport } from "./graduation/advice/jobs.js";
import { createStudentPlansRouter } from "./plans/student-router.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, {
  type ErrorRequestHandler,
  type RequestHandler
} from "express";
import session from "express-session";
import type { Store } from "express-session";
import helmet from "helmet";
import type { DatabasePool } from "./db/pool.js";
import { createStudentDataRouter } from "./student/router.js";
import { createRoadmapRouter } from "./roadmap/router.js";
import { createAssistantRouter } from "./assistant/router.js";
import { createCareerGuidanceRouter } from "./career-guidance/router.js";
import { createOverviewRouter, refreshWarningNotifications } from "./overview/router.js";
import { createStudentNotificationsRouter } from "./notifications/student-router.js";
import { createAnnouncementsRouter } from "./notifications/admin-router.js";
import { createStudyPlanRouter } from "./study-plan/router.js";
import { createCompetencyAssessmentRouter } from "./competency-assessment/router.js";
import { createCompetencyAiQueue } from "./competency-assessment/ai/queue.js";
import { PROMPT_VERSION } from "./competency-assessment/ai/prompt.js";
import { createCompetencyWorkerRouter } from "./competency-assessment/ai/worker-router.js";
import { createCurriculaRouter } from "./curricula/router.js";
import { createPlansRouter } from "./plans/router.js";
import { createStudentCurriculaRouter } from "./curricula/student-router.js";
import { createTranscriptWorkerRouter } from "./student/transcript-jobs.js";
import { postgresTextLayerJobs, startTextLayerReader, textLayerPython } from "./student/text-layer.js";
import { createNeuronBudget } from "./ai-worker/budget.js";
import type { AppConfig } from "./config.js";
import { createAuthRouter } from "./auth/router.js";
import type { MicrosoftAuthClient } from "./auth/types.js";
import type { UserRepository } from "./users/user-repository.js";
import type { AuthActivity } from "./auth/activity.js";
import { createStudentProfilesRouter, type StudentProfileRepository } from "./admin/student-profiles.js";
import { createAdminAccountsRouter, type AdminAccountRepository } from "./admin/accounts.js";
import { auditAdminMutations } from "./admin/audit/middleware.js";
import { createAuditLogRouter } from "./admin/audit/router.js";
import { createReportsRouter } from "./admin/reports/router.js";
import { advisorActing, advisorReadOnly, studentUser } from "./advisors/access.js";
import { createAdvisorsRouter } from "./advisors/router.js";
import { createAdvisorPortalRouter } from "./advisors/portal-router.js";
import {
  requireAuthentication,
  requireAdminAccess
} from "./middleware/authorization.js";

interface CreateAppDependencies {
  databasePool?: DatabasePool;
  studentProfileRepository?: StudentProfileRepository;
  authActivity?: AuthActivity;
  config: AppConfig;
  microsoftAuthClient: MicrosoftAuthClient;
  userRepository: UserRepository;
  sessionStore?: Store;
  adminAccountRepository?: AdminAccountRepository;
}

const webDistPath = fileURLToPath(new URL("../../web/dist/", import.meta.url));

export function createApp({
  databasePool,
  config,
  microsoftAuthClient,
  userRepository,
  sessionStore,
  adminAccountRepository,
  authActivity,
  studentProfileRepository
}: CreateAppDependencies) {
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" }
    })
  );
  // Graduation advice is AI work: queued only when AI_WORKER_KEY is configured. A committed
  // transcript import (native upload or OCR) queues it best-effort for the new transcript.
  const graduationAdviceEnabled = Boolean(config.aiWorkerKey);
  // The new transcript's "Cần chú ý" warnings also reach the bell at once (each one once, 2026-10-30).
  const afterTranscriptImport = databasePool
    ? async (userId: string) => {
      await refreshWarningNotifications(databasePool, userId);
      if (graduationAdviceEnabled) await ensureGraduationAdviceAfterImport(databasePool, userId);
    }
    : undefined;
  // A PDF with a text layer is read on this server with the OCR worker's own code (text-layer.ts, 2026-11-07); the PC
  // worker keeps the PDFs that need OCR. Only with the OCR queue (OCR_WORKER_KEY) and a Python (on Render, python3).
  // On Cloudflare (AI_PROVIDER=cloudflare, 2026-11-08) Gemma reads the scans here too and the PC worker is refused.
  const gemmaOcr = config.ai?.provider === "cloudflare" ? config.ai.cloudflare : null;
  const textLayer = startTextLayerReader(config.ocrWorkerKey ? textLayerPython() : null,
    config.ocrWorkerKey && databasePool ? postgresTextLayerJobs(databasePool, { afterTranscriptImport }) : null, {
      gemma: gemmaOcr,
      // Scans count against the same day's neurons as the AI jobs (ai-worker/budget.ts, migration 059).
      budget: gemmaOcr ? createNeuronBudget({ limit: config.ai?.dailyNeurons ?? null, db: databasePool }) : null,
    });
  app.use("/api/worker/transcripts", createTranscriptWorkerRouter(databasePool,config.ocrWorkerKey, {
    afterTranscriptImport, refuseWorker: () => gemmaOcr !== null && textLayer.status() === "ready" }));
  // The AI worker router authenticates before parsing its own body, so it must come before express.json.
  // On Cloudflare (AI_PROVIDER=cloudflare) only this process's own worker may claim AI jobs: a PC worker still running is
  // refused, so every job runs on the same models.
  app.use("/api/worker/competency-assessments", createCompetencyWorkerRouter(databasePool, config.aiWorkerKey, { localOnly: config.ai?.provider === "cloudflare" }));
  app.use("/api/admin/graduation", express.json({ limit: "2mb" }));
  app.use("/api/admin/competencies", express.json({ limit: "2mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  const correlationId: RequestHandler = (request, response, next) => {
    const id = request.get("x-correlation-id") ?? randomUUID();
    response.setHeader("x-correlation-id", id);
    next();
  };
  app.use(correlationId);

  app.use(["/api/auth", "/api/admin"], (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(
    session({
      ...(sessionStore ? { store: sessionStore } : {}),
      name: "edupath.sid",
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.session.secure,
        sameSite: "lax",
        maxAge: config.session.maxAgeMs,
        path: "/"
      }
    })
  );

  app.use("/api", async (request, response, next) => {
    const user = request.session.user;
    if (authActivity && user && !await authActivity.current(user)) {
      await new Promise<void>((resolve, reject) => request.session.destroy((err) => err ? reject(err) : resolve()));
      response.clearCookie("edupath.sid", { path: "/", httpOnly: true, secure: config.session.secure, sameSite: "lax" });
      response.status(401).json({ error: "authentication_required" });
      return;
    }
    next();
  });

  // Admin-portal roles and staff mailboxes live in the admin portal only; their
  // session must not reach any student endpoint, even through a link or a
  // restored tab, except as the cố vấn học tập of the student named by the tab
  // (X-Advisor-Student, advisors/access.ts; AD-AST-05…08, 2026-11-03).
  app.use("/api/student", advisorActing(databasePool, config.staffEmailDomains));

  app.get("/api/health", (_request, response) => {
    // textLayer: whether this server reads transcripts with a text layer itself (off, checking, ready).
    // ai: where the AI jobs run (ollama = the PC worker, cloudflare = this server on Workers AI); no secret, no state.
    response.json({ status: "ok", service: "edupath-api", textLayer: textLayer.status(), ai: config.ai?.provider ?? "ollama" });
  });

  app.use(
    "/api/auth",
    createAuthRouter({ config, microsoftAuthClient, userRepository, ...(authActivity ? { authActivity } : {}) })
  );

  app.get(
    "/api/student/summary",
    requireAuthentication,
    (request, response) => {
      response.json({
        message: `Xin chào ${request.session.user?.name ?? "sinh viên"}`,
        role: request.session.user?.role
      });
    }
  );

  app.get("/api/admin/summary", requireAdminAccess, (request, response) => {
    response.json({
      message: `Xin chào quản trị viên ${request.session.user?.name ?? ""}`.trim(),
      role: request.session.user?.role
    });
  });

  app.get("/api/student/profile", requireAuthentication, async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!studentProfileRepository) {
      response.status(503).json({ error: "database_required" });
      return;
    }
    const user = studentUser(request);
    response.json({ student: await studentProfileRepository.detail(user, user.userId) });
  });

  app.get("/api/admin/me", requireAdminAccess, (request, response) => {
    response.json({ authenticated: true, user: request.session.user });
  });

  // Cố vấn học tập (role 'advisor') only reads the admin portal; it must run before the log and the admin routers.
  app.use("/api/admin", advisorReadOnly);
  // Nhật ký thao tác (AD-REPORT-11): every successful admin change is logged; it must run before the admin routers.
  app.use("/api/admin", auditAdminMutations(databasePool));
  app.use("/api/admin/audit-log", createAuditLogRouter(databasePool));
  app.use("/api/admin/reports", createReportsRouter(databasePool));
  app.use("/api/admin/accounts", createAdminAccountsRouter(adminAccountRepository, config.webOrigin));
  app.use("/api/admin/curricula", createCurriculaRouter(databasePool, config.webOrigin));
  app.use("/api/admin/careers", createCareersRouter(databasePool, config.webOrigin, false, { aiSuggestions: Boolean(config.aiWorkerKey) }));
  app.use("/api/admin/competencies", createCompetenciesRouter(databasePool, config.webOrigin, { aiSuggestions: Boolean(config.aiWorkerKey) }));
  app.use("/api/student/careers", createCareersRouter(databasePool, config.webOrigin, true));
  app.use("/api/admin/graduation", createGraduationRouter(databasePool, config.webOrigin));
  app.use("/api/admin/plans", createPlansRouter(databasePool, config.webOrigin));
  app.use("/api/student/plans", createStudentPlansRouter(databasePool));
  // Before the read-only graduation router, which answers every non-GET with 405.
  app.use("/api/student/graduation/advice", createGraduationAdviceRouter(databasePool, config.webOrigin, { enabled: graduationAdviceEnabled }));
  app.use("/api/student/graduation", createStudentGraduationRouter(databasePool));
  app.use("/api/student/curricula", createStudentCurriculaRouter(databasePool));
  // "Lộ trình học tập": progress against the graduation standard and the manual plan, then the AI 3-month roadmap.
  app.use("/api/student/study-plan", createStudyPlanRouter(databasePool, config.webOrigin));
  // The 3-month study roadmap is AI work too: it is created only when AI_WORKER_KEY is configured.
  app.use("/api/student/roadmap", createRoadmapRouter(databasePool, config.webOrigin, { enabled: Boolean(config.aiWorkerKey) }));
  // "Trợ lý AI" (STU-CHAT-01..05): answers come from the local AI worker too, so questions are queued only with AI_WORKER_KEY.
  app.use("/api/student/assistant", createAssistantRouter(databasePool, config.webOrigin, { enabled: Boolean(config.aiWorkerKey) }));
  // "Định hướng nghề nghiệp": every catalog career against the student's competencies and survey (read only, no AI).
  app.use("/api/student/career-guidance", createCareerGuidanceRouter(databasePool));
  // Tổng quan (STU-PROG-01…03): the student dashboard in one read-only snapshot, warnings included.
  app.use("/api/student/overview", createOverviewRouter(databasePool));
  // The bell of the student portal (STU-PROG-04…09) and the faculty's announcements to it (AD-NOTI-01/02).
  app.use("/api/student/notifications", createStudentNotificationsRouter(databasePool, config.webOrigin));
  app.use("/api/admin/announcements", createAnnouncementsRouter(databasePool, config.webOrigin, { staffEmailDomains: config.staffEmailDomains }));
  // AI comments are queued only when AI_WORKER_KEY is configured; otherwise ai_status is 'disabled'.
  app.use("/api/student/competency-assessments", createCompetencyAssessmentRouter(databasePool, config.webOrigin,
    createCompetencyAiQueue({ enabled: Boolean(config.aiWorkerKey) }), { promptVersion: PROMPT_VERSION }));
  app.use("/api/student", createStudentDataRouter(databasePool, config.webOrigin,Boolean(config.ocrWorkerKey), { afterTranscriptImport, textLayer }));
  app.use("/api/admin/students", createStudentProfilesRouter(studentProfileRepository, adminAccountRepository));
  // Quản lý cố vấn học tập (AD-ADV-01…05) and an advisor's Lớp phụ trách (AD-AST-01…05, 09), 2026-11-03.
  app.use("/api/admin/advisors", createAdvisorsRouter(databasePool, config.webOrigin, config.staffEmailDomains));
  app.use("/api/admin/advisor-portal", createAdvisorPortalRouter(databasePool, config.webOrigin));

  if (config.nodeEnv === "production") {
    app.use(
      express.static(webDistPath, {
        index: false,
        maxAge: "1h"
      })
    );

    // Every other address gets the web app, which shows Không tìm thấy trang for one it does not know
    // (apps/web/src/routing.ts): an address not listed here answers 404, so link previews and crawlers do not take
    // it for a page. Under /quantri the app decides (its pages are in apps/web/src/admin-navigation.ts).
    const webAppPath = /^\/(?:login|dashboard|auth\/callback|chinh-sach-va-dieu-khoan|chinh-sach-bao-mat|dieu-khoan-su-dung|cau-hoi-thuong-gap|quantri(?:\/.*)?)?\/*$/;
    app.get(/^(?!\/api(?:\/|$)).*/, (request, response, next) => {
      response.setHeader("Cache-Control", "no-cache");
      if (!webAppPath.test(request.path)) response.status(404);
      response.sendFile("index.html", { root: webDistPath }, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error(`[SERVER] ${message}`);
    if (!response.headersSent) {
      response.status(500).json({ error: "internal_server_error" });
    }
  };
  app.use(errorHandler);

  return app;
}
