// Housekeeping of the competency comment jobs (stu_comp_ai_jobs), shared by the worker router (worker-router.ts, on
// /claim) and the student queue hook (queue.ts, on the student's reads and writes). Kept apart so queue.ts does not import
// the worker router, which runs the deferred comments' housekeeping of queue.ts (deferred.ts).
import type { DatabasePool } from "../../db/pool.js";
import { AI_HOUSEKEEPING_INTERVAL_MS, AI_JOB_MAX_ATTEMPTS } from "./worker-protocol.js";

/**
 * Fails stuck jobs and marks their assessments failed, then deletes old terminal JOBS.
 * Stuck = a processing job whose lease expired after the last attempt, or any pending job
 * older than 24 hours (a processing one only once its lease has expired, so a running job
 * is never cut off). ai_input is cleared with the failure. Assessments are never deleted here.
 */
export async function expireCompetencyAiJobs(db: Pick<DatabasePool, "query">): Promise<void> {
  await db.query(`WITH failed AS (
      UPDATE stu_comp_ai_jobs SET status='failed',error_code='worker_timeout',ai_input=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE (status='queued' AND created_at<now()-interval '24 hours')
        OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))
      RETURNING assessment_id)
    UPDATE stu_comp_assessments a SET ai_status='failed',ai_error_code='worker_timeout'
      FROM failed f WHERE a.id=f.assessment_id AND a.ai_status IN ('queued','processing')`, [AI_JOB_MAX_ATTEMPTS]);
  await db.query(`DELETE FROM stu_comp_ai_jobs WHERE status IN ('completed','failed','cancelled') AND updated_at<now()-interval '7 days'`);
}

/**
 * Rate-limited expiry (at most once per interval per returned function). The worker router
 * runs it on /claim and the student API on its reads and writes, so stuck jobs also expire
 * while the worker is offline.
 */
export function createCompetencyAiExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Pick<DatabasePool, "query">): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireCompetencyAiJobs(db);
    return true;
  };
}
