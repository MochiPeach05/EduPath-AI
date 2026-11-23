import { describe, expect, it, vi } from "vitest";
import type { MailConsentClient } from "../auth/mail-consent-client.js";
import type { DatabasePool } from "../db/pool.js";
import type { MailMessage, MailResult } from "./graph-mail.js";
import type { MailGrant, MailGrantStore } from "./grants.js";
import type { ClaimedEmail } from "./outbox.js";
import { isTemporary, runMailTick } from "./worker.js";

// The mail worker over a fake database, Microsoft and Graph. Made-up students and addresses only.
const SENDER = "11111111-1111-4111-8111-111111111111";
const grant: MailGrant = { userId: SENDER, address: "can.bo@example.edu", tenantId: "t", cache: "cache-1" };
const mail = (id: string, extra: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  id, address: `${id}@example.edu`, attempts: 1, title: "Lịch đăng ký học phần", body: "Mở từ 01/12.", link: "#plans", name: "71K29 - Trần Minh An - 71K29CNTT08", ...extra,
});

function setup(options: { claimed?: ClaimedEmail[]; grant?: MailGrant | null; acquire?: () => Promise<{ accessToken: string; cache: string }>; results?: MailResult[] } = {}) {
  const updates: { kind: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT DISTINCT a.email_sender_id AS sender")) return { rowCount: 1, rows: [{ sender: SENDER }] };
    if (sql.startsWith("WITH picked AS")) return { rowCount: options.claimed?.length ?? 0, rows: options.claimed ?? [] };
    if (sql.startsWith("UPDATE ad_announcement_emails e SET status='failed',error=$2")) { updates.push({ kind: "failDue", params }); return { rowCount: 3, rows: [] }; }
    if (sql.startsWith("UPDATE ad_announcement_emails SET status='sent'")) { updates.push({ kind: "sent", params }); return { rowCount: 1, rows: [] }; }
    if (sql.startsWith("UPDATE ad_announcement_emails SET status='pending',error=$2")) { updates.push({ kind: "retry", params }); return { rowCount: 1, rows: [] }; }
    if (sql.startsWith("UPDATE ad_announcement_emails SET status='failed',error=$2")) { updates.push({ kind: "failed", params }); return { rowCount: 1, rows: [] }; }
    return { rowCount: 0, rows: [] };
  });
  const grants: MailGrantStore = {
    save: vi.fn(async () => undefined), load: vi.fn(async () => (options.grant === undefined ? grant : options.grant)), remove: vi.fn(async () => true),
    status: vi.fn(async () => null), markFailed: vi.fn(async () => undefined),
  };
  const client: MailConsentClient = {
    getConsentUrl: vi.fn(), exchangeCode: vi.fn(),
    acquireToken: vi.fn(options.acquire ?? (async () => ({ accessToken: "graph-token", cache: "cache-2" }))),
  };
  const results = [...(options.results ?? [])];
  const sent: MailMessage[] = [];
  const sendMail = vi.fn(async (_token: string, message: MailMessage): Promise<MailResult> => { sent.push(message); return results.shift() ?? { ok: true }; });
  const log = vi.fn();
  const deps = { db: { query } as unknown as Pick<DatabasePool, "query">, client, grants, sendMail, webOrigin: "https://edupath.example", log };
  return { deps, updates, grants, client, sendMail, sent, log };
}

describe("the mail worker (AD-NOTI-04, 2026-11-23)", () => {
  it("sends each due message from the sender's mailbox and keeps the renewed permission", async () => {
    const { deps, updates, grants, sendMail, sent } = setup({ claimed: [mail("a"), mail("b")] });
    expect(await runMailTick(deps)).toEqual({ sent: 2, retried: 0, failed: 0 });
    expect(sendMail).toHaveBeenCalledWith("graph-token", expect.anything());
    expect(sent.map((message) => message.to)).toEqual(["a@example.edu", "b@example.edu"]);
    expect(sent[0]!.subject).toBe("[EduPath AI] Lịch đăng ký học phần");
    // The greeting names the student, not the whole display name.
    expect(sent[0]!.html).toContain("Chào Trần Minh An,");
    expect(updates.map((update) => [update.kind, update.params[0]])).toEqual([["sent", "a"], ["sent", "b"]]);
    expect(grants.save).toHaveBeenCalledWith({ ...grant, cache: "cache-2" });
  });

  it("tries a temporary failure again later and gives a permanent one up", async () => {
    const { deps, updates } = setup({
      claimed: [mail("a"), mail("b", { attempts: 4 }), mail("c"), mail("d", { address: null })],
      results: [{ ok: false, status: 429, code: "ErrorTooManyRequests" }, { ok: false, status: 503, code: "http_503" }, { ok: false, status: 400, code: "ErrorInvalidRecipients" }],
    });
    expect(await runMailTick(deps)).toEqual({ sent: 0, retried: 1, failed: 3 });
    expect(updates.map((update) => [update.kind, ...update.params])).toEqual([
      ["retry", "a", "ErrorTooManyRequests", 1],
      // The fourth attempt was the last.
      ["failed", "b", "http_503"],
      ["failed", "c", "ErrorInvalidRecipients"],
      ["failed", "d", "no_address"],
    ]);
    expect(isTemporary({ ok: false, status: 0, code: "network_error" })).toBe(true);
    expect(isTemporary({ ok: false, status: 403, code: "ErrorAccessDenied" })).toBe(false);
  });

  it("fails a sender's due messages when the permission is gone, and only waits on a passing error", async () => {
    const none = setup({ grant: null, claimed: [mail("a")] });
    expect(await runMailTick(none.deps)).toEqual({ sent: 0, retried: 0, failed: 3 });
    expect(none.updates).toEqual([{ kind: "failDue", params: [SENDER, "grant_required"] }]);
    expect(none.grants.markFailed).toHaveBeenCalledWith(SENDER, "grant_required");
    expect(none.sendMail).not.toHaveBeenCalled();

    const refused = setup({ claimed: [mail("a")], acquire: async () => { throw Object.assign(new Error("again"), { errorCode: "grant_required" }); } });
    expect(await runMailTick(refused.deps)).toEqual({ sent: 0, retried: 0, failed: 3 });
    expect(refused.grants.markFailed).toHaveBeenCalledWith(SENDER, "grant_required");
    expect(refused.sendMail).not.toHaveBeenCalled();

    const passing = setup({ claimed: [mail("a")], acquire: async () => { throw Object.assign(new Error("timeout"), { errorCode: "network_error" }); } });
    expect(await runMailTick(passing.deps)).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(passing.updates).toEqual([]);
    expect(passing.log).toHaveBeenCalledWith(expect.stringContaining("network_error"));
  });
});
