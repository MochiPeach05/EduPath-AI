// Danh sách lớp in the database (ad_class_students, migration 065; roster.ts reads and plans the workbook). The account's
// right is checked here, on the server, for every import: it must still be an active account of the admin portal, and the
// classes it may import are read again from the database (every class for admins and Ban chủ nhiệm khoa, the classes the
// Khoa assigned it for anyone else). An import is applied in one transaction under its own lock, planned again inside it,
// so what is stored is what the database held at that moment; the rows with problems are skipped. "Xóa khỏi danh sách lớp"
// (user 2026-11-14: "Có, làm luôn") removes the row of a student who never signed in, under the same lock and right; a
// student with an account is never removed this way (their account is the class's member, CLASS_OF).
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { adminRoles, canManageAdvisors, type AppRole, type AuthenticatedUser } from "../auth/types.js";
import { CLASS_OF } from "./class-code.js";
import { AdvisorError } from "./model.js";
import { STUDENT_CODE, planRoster, type PlannedStudent, type RosterImportPreview, type RosterImportResult, type RosterLookups, type RosterSheet } from "./roster.js";

type Db = Pick<DatabasePool, "query"> | PoolClient;
const LOCK = "edupath:class-students";
const unique = <T>(values: readonly T[]) => [...new Set(values)];

export class PostgresRosterRepository {
  constructor(private readonly pool: DatabasePool) {}

  /** The account's role now, if it is still an active account of the admin portal (locked for the transaction when asked). */
  private async role(db: Db, actor: AuthenticatedUser, lock = false): Promise<AppRole> {
    const result = await db.query<{ role: AppRole }>(`SELECT COALESCE(role_override, role) AS role FROM users
      WHERE id = $1 AND entra_tenant_id = $2 AND is_active${lock ? " FOR SHARE" : ""}`, [actor.userId, actor.tenantId]);
    const role = result.rows[0]?.role;
    if (!role || !adminRoles.includes(role)) throw new AdvisorError("insufficient_role", 403);
    return role;
  }

  /** The classes the account may import: null for every class (admins, Ban chủ nhiệm khoa), else the classes it advises. */
  private async allowedClasses(db: Db, actor: AuthenticatedUser, role: AppRole): Promise<Set<string> | null> {
    if (canManageAdvisors(role)) return null;
    const result = await db.query<{ className: string }>(`SELECT class_name AS "className" FROM ad_advisor_classes WHERE advisor_user_id = $1`, [actor.userId]);
    return new Set(result.rows.map((row) => row.className));
  }

  /** What planRoster needs to know about the workbook's students. */
  private async lookups(db: Db, actor: AuthenticatedUser, role: AppRole, sheet: RosterSheet): Promise<RosterLookups> {
    const codes = unique(sheet.items.map((item) => item.studentCode).filter((code) => STUDENT_CODE.test(code)));
    const emails = unique(sheet.items.flatMap((item) => (item.email ? [item.email] : [])));
    const listed = await db.query<{ code: string; name: string; className: string; email: string | null }>(`SELECT student_code AS code,
        full_name AS name, class_name AS "className", email FROM ad_class_students WHERE student_code = ANY($1::text[])`, [codes]);
    // Any account with the MSSV has signed in (a student's account is made at the first sign-in); its class as the admin
    // portal shows it now (CLASS_OF: its class list row first, else its profile).
    const accounts = await db.query<{ code: string; className: string }>(`SELECT p.student_code AS code, COALESCE(${CLASS_OF}, '') AS "className"
      FROM student_profiles p JOIN users u ON u.id = p.user_id WHERE p.student_code = ANY($1::text[])`, [codes]);
    const owners = await db.query<{ email: string; code: string }>(`SELECT email, student_code AS code FROM ad_class_students WHERE email = ANY($1::text[])
      UNION ALL
      SELECT k.email, p.student_code FROM unnest($1::text[]) AS k(email)
        JOIN users u ON lower(u.email) = k.email OR lower(u.username) = k.email
        JOIN student_profiles p ON p.user_id = u.id WHERE p.student_code IS NOT NULL`, [emails]);
    const classes = unique([...sheet.items.map((item) => item.className), ...listed.rows.map((row) => row.className),
      ...accounts.rows.map((row) => row.className)].filter(Boolean));
    const advisors = await db.query<{ className: string; name: string }>(`SELECT c.class_name AS "className", a.full_name AS name
      FROM ad_advisor_classes c JOIN ad_advisors a ON a.user_id = c.advisor_user_id WHERE c.class_name = ANY($1::text[])`, [classes]);
    const emailOwners = new Map<string, string>();
    for (const row of owners.rows) if (!emailOwners.has(row.email)) emailOwners.set(row.email, row.code);
    return {
      allowedClasses: await this.allowedClasses(db, actor, role),
      listed: new Map(listed.rows.map((row) => [row.code, { name: row.name, className: row.className, email: row.email }])),
      accounts: new Map(accounts.rows.map((row) => [row.code, { className: row.className }])),
      emailOwners,
      advisors: new Map(advisors.rows.map((row) => [row.className, row.name])),
    };
  }

  /** What importing the workbook would do (AD-AST, Import danh sách sinh viên: step 2, Xem trước và rà soát). Stores nothing. */
  async preview(actor: AuthenticatedUser, fileName: string, sheet: RosterSheet): Promise<RosterImportPreview> {
    const role = await this.role(this.pool, actor);
    return planRoster(fileName, sheet, await this.lookups(this.pool, actor, role, sheet)).preview;
  }

  /**
   * Removes a student who never signed in from their class list (the class must be one the account may import); answers
   * the MSSV and the class for the log. Refused for a student with an account (signed in at least once).
   */
  async remove(actor: AuthenticatedUser, studentCode: string): Promise<{ studentCode: string; className: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK]);
      const role = await this.role(client, actor, true);
      const row = (await client.query<{ className: string }>(`SELECT class_name AS "className" FROM ad_class_students WHERE student_code = $1 FOR UPDATE`,
        [studentCode])).rows[0];
      if (!row) throw new AdvisorError("listed_student_not_found", 404);
      const allowed = await this.allowedClasses(client, actor, role);
      if (allowed && !allowed.has(row.className)) throw new AdvisorError("class_not_advised", 403);
      const signedIn = await client.query("SELECT 1 FROM student_profiles WHERE student_code = $1", [studentCode]);
      if (signedIn.rowCount) throw new AdvisorError("listed_student_signed_in", 409);
      await client.query("DELETE FROM ad_class_students WHERE student_code = $1", [studentCode]);
      await client.query("COMMIT");
      return { studentCode, className: row.className };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  /** Imports the students of the workbook that have no problem, in one transaction; the others are skipped. */
  async apply(actor: AuthenticatedUser, fileName: string, sheet: RosterSheet): Promise<RosterImportResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK]);
      const role = await this.role(client, actor, true);
      const { preview, plan } = planRoster(fileName, sheet, await this.lookups(client, actor, role, sheet));
      const writes = plan.flatMap((item) => (item.write ? [item.write] : []));
      if (writes.length) {
        await client.query(`INSERT INTO ad_class_students(student_code, full_name, class_name, email, created_by, updated_by)
          SELECT code, name, class_name, email, $5, $5 FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS w(code, name, class_name, email)
          ON CONFLICT (student_code) DO UPDATE SET full_name = EXCLUDED.full_name, class_name = EXCLUDED.class_name, email = EXCLUDED.email,
            updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [writes.map((row) => row.studentCode), writes.map((row) => row.name), writes.map((row) => row.className), writes.map((row) => row.email), actor.userId]);
      }
      await client.query("COMMIT");
      const count = (status: PlannedStudent["status"]) => plan.filter((item) => item.status === status).length;
      return { added: count("add"), updated: count("update"), unchanged: count("unchanged"), skipped: count("error"), preview };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}

/** What the router uses, so its tests can stand a fake in. */
export type RosterRepository = Pick<PostgresRosterRepository, "preview" | "apply" | "remove">;
