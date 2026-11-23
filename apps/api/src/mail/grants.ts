// Who may send the faculty's announcements by email, and from which mailbox (ad_mail_senders, migration 066): a staff
// member allows EduPath AI once on Microsoft's consent page (auth/router.ts); the MSAL token cache that comes back is kept
// encrypted (grant-crypto.ts) so the mail worker can send later, refreshing the token as Microsoft allows (about 90 days
// without use). "Thu hồi quyền gửi thư" deletes the row.
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { openGrant, sealGrant } from "./grant-crypto.js";

type Db = Pick<DatabasePool, "query"> | Pick<PoolClient, "query">;

/** cache: the MSAL token cache as MSAL serializes it (plain JSON, only ever held in memory). */
export type MailGrant = { userId: string; address: string; tenantId: string; cache: string };
/** What the pages show about a sender's permission. */
export type MailSenderStatus = { address: string; grantedAt: string; lastError: string | null };

export interface MailGrantStore {
  save(grant: MailGrant): Promise<void>;
  /** null when there is none, or it can no longer be read (another key). */
  load(userId: string): Promise<MailGrant | null>;
  remove(userId: string): Promise<boolean>;
  status(userId: string): Promise<MailSenderStatus | null>;
  /** Microsoft refused to renew the permission: it is kept (for the address) but marked so the page asks again. */
  markFailed(userId: string, code: string): Promise<void>;
}

const iso = (value: Date | string) => new Date(value).toISOString();

export class PostgresMailGrantStore implements MailGrantStore {
  public constructor(private readonly db: Db, private readonly key: Buffer) {}

  public async save(grant: MailGrant): Promise<void> {
    await this.db.query(
      `INSERT INTO ad_mail_senders(user_id,address,tenant_id,token_cache) VALUES($1,$2,$3,$4)
        ON CONFLICT (user_id) DO UPDATE SET address=EXCLUDED.address,tenant_id=EXCLUDED.tenant_id,token_cache=EXCLUDED.token_cache,
          updated_at=now(),last_error=NULL`,
      [grant.userId, grant.address.toLowerCase(), grant.tenantId, sealGrant(grant.cache, this.key)]);
  }

  public async load(userId: string): Promise<MailGrant | null> {
    const row = (await this.db.query<{ address: string; tenantId: string; sealed: string }>(
      `SELECT address,tenant_id AS "tenantId",token_cache AS sealed FROM ad_mail_senders WHERE user_id=$1`, [userId])).rows[0];
    if (!row) return null;
    const cache = openGrant(row.sealed, this.key);
    return cache === null ? null : { userId, address: row.address, tenantId: row.tenantId, cache };
  }

  public async remove(userId: string): Promise<boolean> {
    return Boolean((await this.db.query("DELETE FROM ad_mail_senders WHERE user_id=$1", [userId])).rowCount);
  }

  public async status(userId: string): Promise<MailSenderStatus | null> {
    const row = (await this.db.query<{ address: string; updatedAt: Date | string; lastError: string | null }>(
      `SELECT address,updated_at AS "updatedAt",last_error AS "lastError" FROM ad_mail_senders WHERE user_id=$1`, [userId])).rows[0];
    return row ? { address: row.address, grantedAt: iso(row.updatedAt), lastError: row.lastError } : null;
  }

  public async markFailed(userId: string, code: string): Promise<void> {
    await this.db.query("UPDATE ad_mail_senders SET last_error=$2 WHERE user_id=$1", [userId, code.slice(0, 80)]);
  }
}
