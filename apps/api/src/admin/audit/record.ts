// Nhật ký thao tác (AD-REPORT-11, 2026-10-31). recordAudit is the one way any admin code writes the log (table
// ad_audit_log, migration 057). A row says who did what to which object, never the data itself: no grades, no file contents.
import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "../../auth/types.js";
import type { AuditKind } from "../reports/types.js";
import { personName } from "../../users/person-name.js";

/** Who did it: the signed-in admin of the request. */
export type AuditActor = { userId: string; name: string; role: string | null };

/**
 * What happened, in words an admin reads in the log: action is short ("Xuất Excel"), summary says what exactly.
 * method and path are the request that did it, when there is one.
 */
export type AuditEntryInput = {
  kind: AuditKind;
  action: string;
  summary: string;
  targetType?: string | null;
  targetId?: string | null;
  method?: string | null;
  path?: string | null;
};

/** Minimal query surface, so a pool or a transaction client both fit. */
export type AuditDb = { query: (text: string, values?: unknown[]) => Promise<unknown> };

export const AUDIT_KINDS = ["account", "training", "career", "competency", "notify", "report", "access", "advisor", "other"] as const satisfies readonly AuditKind[];

/** The actor of a session user; the name falls back to the email or username, so a row always names someone. */
export function auditActorOf(user: Pick<AuthenticatedUser, "userId" | "name" | "role"> & Partial<Pick<AuthenticatedUser, "email" | "username">>): AuditActor {
  return { userId: user.userId, name: user.name?.trim() || user.email?.trim() || user.username?.trim() || "Không rõ", role: user.role ?? null };
}

/** Lower case without diacritics ("Đổi vai trò" → "doi vai tro"), for accent-insensitive search. */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
}

/** One line, at most max characters (an ellipsis marks a cut). */
export function clip(text: string | null | undefined, max: number): string {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const optional = (text: string | null | undefined, max: number) => { const line = clip(text, max); return line || null; };

/**
 * Writes one log row. Never throws: a failed log write must not fail the admin's action (it is reported to the console).
 * Texts are cut to the column limits; an unknown kind is stored as "other". The actor is named as the admin header names
 * them: only the name of "MSSV - Họ tên - Lớp" (users/person-name.ts, QA 2026-11-04).
 */
export async function recordAudit(db: AuditDb | undefined, actor: AuditActor, entry: AuditEntryInput): Promise<void> {
  if (!db) return;
  try {
    const name = clip(personName(actor.name ?? ""), 200) || "Không rõ";
    const action = clip(entry.action, 120) || "Thao tác";
    const summary = clip(entry.summary, 500) || action;
    const kind = AUDIT_KINDS.includes(entry.kind) ? entry.kind : "other";
    const method = entry.method && METHODS.has(entry.method.toUpperCase()) ? entry.method.toUpperCase() : null;
    await db.query(
      `INSERT INTO ad_audit_log(id,actor_user_id,actor_name,actor_role,kind,action,summary,target_type,target_id,method,path,search_text)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [randomUUID(), UUID.test(actor.userId) ? actor.userId : null, name, optional(actor.role, 40), kind, action, summary,
        optional(entry.targetType, 60), optional(entry.targetId, 200), method, optional(entry.path, 300), foldText(`${name} ${action} ${summary}`)],
    );
  } catch (error) {
    console.error("audit_log_write_failed", error instanceof Error ? error.message : error);
  }
}
