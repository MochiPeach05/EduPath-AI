// Nhật ký thao tác (AD-REPORT-11): logs every change made in the admin portal. Mounted on /api/admin before the admin
// routers (after the session), it waits for the answer: a POST/PUT/PATCH/DELETE that ends below 400 is written with the
// action and summary of its rule (routes.ts), or a generic line when no rule names the route yet. Reads are not logged
// here; the routers that read students' data log those reads themselves (student-profiles.ts, the report exports).
import type { RequestHandler, Response } from "express";
import type { DatabasePool } from "../../db/pool.js";
import { auditActorOf, recordAudit, type AuditEntryInput } from "./record.js";
import { matchAuditRoute, unknownRoute, type Described, type Lookup } from "./routes.js";

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const pending = new Set<Promise<void>>();

/** Resolves once every log write started so far has ended (tests; the writes themselves never throw). */
export async function settleAuditWrites(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

const plainBody = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body) ? body as Record<string, unknown> : {};

export function auditAdminMutations(pool: Pick<DatabasePool, "query"> | undefined): RequestHandler {
  const lookup: Lookup = async (text, values) => {
    try { return (await pool!.query(text, values)).rows[0] ?? null; } catch { return null; }
  };
  return (request, response, next) => {
    if (!pool || !MUTATIONS.has(request.method)) { next(); return; }
    const fullPath = request.originalUrl.split("?")[0] ?? "";
    const path = fullPath.replace(/^\/api\/admin(?=\/|$)/, "") || "/";
    const matched = matchAuditRoute(request.method, path);
    if (matched?.route.skip) { next(); return; }
    const userAtStart = request.session?.user;
    let result: unknown;
    const json = response.json.bind(response);
    response.json = ((body: unknown) => { result = body; return json(body); }) as Response["json"];
    response.once("finish", () => {
      if (response.statusCode >= 400) return;
      const user = request.session?.user ?? userAtStart;
      if (!user) return;
      const body = plainBody(request.body);
      const write = (async () => {
        let entry: AuditEntryInput;
        if (matched) {
          let described: Described | string = "";
          try {
            described = matched.route.describe ? await matched.route.describe({ params: matched.params, body, result, lookup }) : "";
          } catch { described = ""; }
          const line = typeof described === "string" ? { summary: described } : described;
          entry = { kind: matched.route.kind, action: line.action ?? matched.route.action, summary: line.summary || matched.route.action,
            targetType: line.targetType ?? null, targetId: line.targetId ?? null };
        } else {
          entry = { kind: "other", ...unknownRoute(request.method, path) };
        }
        await recordAudit(pool, auditActorOf(user), { ...entry, method: request.method, path: fullPath });
      })().catch((error: unknown) => { console.error("audit_log_write_failed", error instanceof Error ? error.message : error); });
      pending.add(write);
      void write.finally(() => pending.delete(write));
    });
    next();
  };
}
