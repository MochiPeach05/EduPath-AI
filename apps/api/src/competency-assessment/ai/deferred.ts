// The deferred requests' housekeeping (QA 2026-11-10: "Hàng đợi AI đang đầy … bấm “Tạo lại nhận xét” để xếp hàng lại"
// never came back by itself). A competency comment, a study roadmap or a graduation advice asked for while its queue was
// full is kept as deferred; the worker router runs this on /claim, at most once per AI_HOUSEKEEPING_INTERVAL_MS, and each
// kind the claiming worker runs puts its deferred requests back into the queue, oldest first, while the queue has room.
// Only a worker's claim runs it: the AI worker claims only while it can work (Ollama up, or Workers AI with neurons left in
// its budget, ai-worker/budget.ts), so nothing is queued while the AI cannot run it and a deferred request keeps waiting
// instead of failing after 24 hours in the queue. Logs carry codes and counts only.
import type { DatabasePool } from "../../db/pool.js";
import { promoteDeferredGraduationAdvice } from "../../graduation/advice/jobs.js";
import { promoteDeferredRoadmaps } from "../../roadmap/jobs.js";
import { promoteDeferredCompetencyAi } from "./queue.js";
import { AI_HOUSEKEEPING_INTERVAL_MS, COMPETENCY_ASSESSMENT_KIND, GRADUATION_ADVICE_KIND, STUDY_ROADMAP_KIND, type AiJobKind } from "./worker-protocol.js";

type Pool = Pick<DatabasePool, "query" | "connect">;
/** Runs the housekeeping for the kinds a claiming worker advertises; false when it did not run (too soon). Never throws. */
export type DeferredPromotion = (db: Pool, kinds: readonly AiJobKind[]) => Promise<boolean>;

type Promoters = Partial<Record<AiJobKind, (db: Pool) => Promise<number>>>;

const PROMOTERS: Promoters = {
  [COMPETENCY_ASSESSMENT_KIND]: promoteDeferredCompetencyAi,
  [GRADUATION_ADVICE_KIND]: (db) => promoteDeferredGraduationAdvice(db),
  [STUDY_ROADMAP_KIND]: (db) => promoteDeferredRoadmaps(db),
};

/** A loggable code without data: the PostgreSQL SQLSTATE or the error class. */
const errorCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : error instanceof Error ? error.name : "unknown";
};

export function createDeferredPromotion(options: { intervalMs?: number; promoters?: Promoters; log?: Pick<Console, "error" | "info"> } = {}): DeferredPromotion {
  const intervalMs = options.intervalMs ?? AI_HOUSEKEEPING_INTERVAL_MS;
  const promoters = options.promoters ?? PROMOTERS;
  const log = options.log ?? console;
  let last = Number.NEGATIVE_INFINITY;
  return async (db, kinds) => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    for (const kind of kinds) {
      const promote = promoters[kind];
      if (!promote) continue;
      try {
        const queued = await promote(db);
        if (queued > 0) log.info(`[AI] queued ${queued} deferred ${kind} request(s)`);
      } catch (error) {
        log.error(`[AI] deferred ${kind} requests not queued (${errorCode(error)})`);
      }
    }
    return true;
  };
}
