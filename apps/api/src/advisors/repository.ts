// Cố vấn học tập in the database (migration 058): the Khoa's list of advisors and their classes (AD-ADV-01…05) and an
// advisor's own classes and students (AD-AST-01…05); admins and Ban chủ nhiệm khoa get every class and every student
// there (user 2026-11-03: AD-AST "QTV & CVHT"). Changes take the lock of the account changes (accounts.ts), because
// adding an advisor may create a precreated account (bound to the Microsoft identity at the first sign-in) or turn a
// lecturer's account into an advisor's; a role change signs the account out, as an account change in accounts.ts does.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { adminRoles, canManageAdvisors, type AuthenticatedUser } from "../auth/types.js";
import { auditActorOf, recordAudit } from "../admin/audit/record.js";
import { SURVEY_COMPLETE_SQL } from "../admin/student-profiles.js";
import { byGivenName, byOrder, byText, orderBy, type OwnOrder, type SortDirection } from "../admin/table-sort.js";
import { SPECIALTIES, specialtyLabel } from "../competency-assessment/specialty.js";
import type { SpecialtyCode } from "../competency-assessment/types.js";
import { advisedStudent, studentLabel, studentViews } from "./access.js";
import { isAdvisorEmail, planImport, type AdvisorSheet, type ImportLookups, type PlannedAdvisor } from "./import.js";
import {
  AdvisorError, CLASS_OF, type AdvisedStudentRow, type AdvisedStudentStatus, type AdvisorClass, type AdvisorDetail, type AdvisorImportPreview,
  type AdvisorImportResult, type AdvisorInput, type AdvisorMe, type AdvisorRow,
} from "./model.js";

type Db = Pick<DatabasePool, "query"> | PoolClient;
/** An active student account (u = users). */
const ACTIVE_STUDENT = "u.is_active AND COALESCE(u.role_override, u.role) = 'student'";
const LOCK = "edupath:admin-account-management";

export type AdvisorListQuery = { q: string; sort?: string | undefined; dir?: SortDirection | undefined };
export type AdvisedStudentQuery = {
  className?: string | undefined; q: string; status: AdvisedStudentStatus; page: number; pageSize: number;
  sort?: string | undefined; dir?: SortDirection | undefined;
};

// The columns the advisor list sorts by (web AdvisorsManagement.tsx); Tài khoản goes from active to locked.
export const advisorSort = {
  name: byGivenName("name"), email: byText("email"), staffCode: byText('"staffCode"'), unit: byText("unit"),
  classes: byText("array_to_string(classes, ', ')"), students: ["students"],
  account: byOrder("account", ["active", "pending", "locked"]), lastLoginAt: ['"lastLoginAt"'],
};
const advisorOrder: OwnOrder = [["name", "ASC"], ['"userId"', "ASC"]];
/** The specialty's name for sorting (the list shows names, the table holds codes). */
const specialtyName = `CASE specialty ${SPECIALTIES.map((item) => `WHEN '${item.code}' THEN '${item.label.replaceAll("'", "''")}'`).join(" ")} END`;
// The columns of an advisor's student list (web AdvisorPortal.tsx, by the fields of AdvisedStudentRow); a done step comes
// first. A key the list does not know falls back to the list's own order (orderBy), as the web may send any field name.
export const studentSort = {
  studentCode: byText('"studentCode"'), name: byGivenName("name"), className: byText('"className"'), specialty: byText(specialtyName),
  targetCareer: byText('"targetCareer"'),
  hasTranscript: byOrder('"hasTranscript"', ["true", "false"]), assessed: byOrder("assessed", ["true", "false"]),
  surveyDone: byOrder('"surveyDone"', ["true", "false"]), roadmap: byOrder("roadmap", ["true", "false"]), lastLoginAt: ['"lastLoginAt"'],
};
const studentOrder: OwnOrder = [['"className"', "ASC"], ["name", "ASC"], ['"userId"', "ASC"]];

/**
 * The active students with their class as a canonical code (class-code.ts), each computed once: a WITH item of the
 * statements that count the students of many classes (advisorColumns, classStats). id is the student's account.
 */
const CLASS_MEMBERS = `class_members AS MATERIALIZED (SELECT u.id, p.cohort_code, ${CLASS_OF} AS class_name
    FROM student_profiles p JOIN users u ON u.id = p.user_id WHERE ${ACTIVE_STUDENT})`;

/** One advisor as the list shows them (a = ad_advisors, u = their account); the statement starts WITH CLASS_MEMBERS. */
const advisorColumns = `a.user_id AS "userId", a.full_name AS name, COALESCE(u.email, u.username) AS email, a.staff_code AS "staffCode", a.unit,
  COALESCE((SELECT array_agg(c.class_name ORDER BY c.class_name) FROM ad_advisor_classes c WHERE c.advisor_user_id = a.user_id), '{}') AS classes,
  (SELECT count(*)::int FROM ad_advisor_classes c JOIN class_members m ON m.class_name = c.class_name WHERE c.advisor_user_id = a.user_id) AS students,
  CASE WHEN NOT u.is_active THEN 'locked' WHEN u.entra_object_id IS NULL THEN 'pending' ELSE 'active' END AS account,
  COALESCE(u.role_override, u.role) AS role, u.last_login_at AS "lastLoginAt"`;

/**
 * Per class: its students, how many of them did each step and the advisor the Khoa assigned. classes: a SELECT of
 * class_name (OWN_CLASSES, EVERY_CLASS). u is a student of the class (class_members: u.id is the account, as
 * SURVEY_COMPLETE_SQL reads it).
 */
const classStats = (classes: string) => `WITH ${CLASS_MEMBERS}, k AS (${classes})
  SELECT k.class_name AS "className",
    COALESCE(max(u.cohort_code), substring(k.class_name FROM 'K[0-9]{2,3}')) AS cohort,
    count(u.id)::int AS students,
    count(u.id) FILTER (WHERE EXISTS (SELECT 1 FROM student_transcripts t WHERE t.user_id = u.id))::int AS "withTranscript",
    count(u.id) FILTER (WHERE EXISTS (SELECT 1 FROM stu_comp_assessments s WHERE s.user_id = u.id))::int AS assessed,
    count(u.id) FILTER (WHERE ${SURVEY_COMPLETE_SQL})::int AS "surveyDone",
    count(u.id) FILTER (WHERE EXISTS (SELECT 1 FROM stu_roadmaps r WHERE r.user_id = u.id AND r.status = 'completed'))::int AS roadmap,
    (SELECT a.full_name FROM ad_advisor_classes c JOIN ad_advisors a ON a.user_id = c.advisor_user_id WHERE c.class_name = k.class_name) AS "advisorName"
  FROM k
  LEFT JOIN class_members u ON u.class_name = k.class_name
  GROUP BY k.class_name ORDER BY k.class_name`;
/** The classes an account advises ($1). */
const OWN_CLASSES = "SELECT class_name FROM ad_advisor_classes WHERE advisor_user_id = $1";
/**
 * Every class: those of the active students' profiles and those the Khoa assigned before any student signed in, all as
 * canonical codes (class-code.ts), so CNTT08 of K27 and of K29 are two classes, 71K27CNTT08 and 71K29CNTT08.
 */
const EVERY_CLASS = `SELECT DISTINCT class_name FROM class_members WHERE class_name IS NOT NULL
  UNION SELECT class_name FROM ad_advisor_classes`;
/** Admins and Ban chủ nhiệm khoa work with every student (AD-AST "QTV & CVHT"); anyone else with their own classes. */
const seesEveryStudent = (actor: Pick<AuthenticatedUser, "role">) => canManageAdvisors(actor.role);

export class PostgresAdvisorRepository {
  constructor(private readonly pool: DatabasePool, private readonly staffEmailDomains: ReadonlySet<string>) {}

  /** The actor is still an active account of the admin portal (and, for a change, one that manages advisors). */
  async access(actor: AuthenticatedUser, write = false, client?: PoolClient): Promise<void> {
    const result = await (client ?? this.pool).query(
      `SELECT 1 FROM users WHERE id = $1 AND entra_tenant_id = $2 AND is_active AND COALESCE(role_override, role) = ANY($3::text[])${client ? " FOR SHARE" : ""}`,
      [actor.userId, actor.tenantId, write ? adminRoles.filter(canManageAdvisors) : adminRoles]);
    if (!result.rowCount) throw new AdvisorError("insufficient_role", 403);
  }

  // ------------------------------------------------------------------------------------------------- AD-ADV-04, 05

  async list(query: AdvisorListQuery): Promise<AdvisorRow[]> {
    const order = orderBy(advisorSort, advisorOrder, query.sort, query.dir);
    const result = await this.pool.query<{ items: AdvisorRow[] }>(`WITH ${CLASS_MEMBERS}, advisors AS (
        SELECT ${advisorColumns} FROM ad_advisors a JOIN users u ON u.id = a.user_id
      ), filtered AS (
        SELECT * FROM advisors
        WHERE ($1 = '' OR strpos(lower(concat_ws(' ', name, email, "staffCode", unit, array_to_string(classes, ' '))), lower($1)) > 0)
      ), numbered AS (SELECT filtered.*, row_number() OVER (ORDER BY ${orderBy(advisorSort, advisorOrder)})::int AS stt FROM filtered)
      SELECT COALESCE((SELECT json_agg(numbered ORDER BY ${order}) FROM numbered), '[]'::json) AS items`, [query.q]);
    return result.rows[0]?.items ?? [];
  }

  async detail(id: string, db: Db = this.pool): Promise<AdvisorDetail> {
    const row = await db.query<Omit<AdvisorDetail, "stt" | "classDetails">>(`WITH ${CLASS_MEMBERS} SELECT ${advisorColumns},
        a.created_at AS "createdAt", a.updated_at AS "updatedAt"
      FROM ad_advisors a JOIN users u ON u.id = a.user_id WHERE a.user_id = $1`, [id]);
    if (!row.rows[0]) throw new AdvisorError("advisor_not_found", 404);
    const classes = await db.query<AdvisorClass>(classStats(OWN_CLASSES), [id]);
    return {
      stt: 1, ...row.rows[0],
      classDetails: classes.rows.map(({ className, cohort, students, withTranscript, assessed }) => ({ className, cohort, students, withTranscript, assessed })),
    };
  }

  // ------------------------------------------------------------------------------------------------ AD-ADV-02, edits

  async create(actor: AuthenticatedUser, input: AdvisorInput): Promise<AdvisorDetail> {
    // A staff or a student mailbox of the school (import.ts advisorEmailDomains, user 2026-11-07).
    if (!isAdvisorEmail(input.email, this.staffEmailDomains)) throw new AdvisorError("email_not_staff", 400);
    return this.change(actor, async (client) => {
      const account = await this.account(client, input.email);
      if (account && await this.isAdvisor(client, account.id)) throw new AdvisorError("advisor_exists", 409);
      await this.classesFree(client, input.classes, account?.id ?? null);
      const userId = await this.ensureAccount(client, actor, input.email, input.name, account);
      await client.query(`INSERT INTO ad_advisors(user_id, full_name, staff_code, unit, created_by, updated_by) VALUES($1, $2, $3, $4, $5, $5)`,
        [userId, input.name, input.staffCode ?? null, input.unit ?? null, actor.userId]);
      await this.setClasses(client, actor, userId, input.classes);
      return userId;
    });
  }

  async update(actor: AuthenticatedUser, id: string, input: Omit<AdvisorInput, "email">): Promise<AdvisorDetail> {
    return this.change(actor, async (client) => {
      const known = await client.query("SELECT 1 FROM ad_advisors WHERE user_id = $1 FOR UPDATE", [id]);
      if (!known.rowCount) throw new AdvisorError("advisor_not_found", 404);
      await this.classesFree(client, input.classes, id);
      await client.query(`UPDATE ad_advisors SET full_name = $2, staff_code = $3, unit = $4, updated_at = now(), updated_by = $5 WHERE user_id = $1`,
        [id, input.name, input.staffCode ?? null, input.unit ?? null, actor.userId]);
      // A precreated account shows the advisor's name until its first sign-in brings the Microsoft one.
      await client.query("UPDATE users SET display_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND entra_object_id IS NULL", [id, input.name.slice(0, 200)]);
      await this.setClasses(client, actor, id, input.classes);
      return id;
    });
  }

  /** Removes the advisor and their classes; the account stays (Tài khoản manages it). Returns who it was. */
  async remove(actor: AuthenticatedUser, id: string): Promise<{ name: string; email: string | null }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK]);
      await this.access(actor, true, client);
      const removed = await client.query<{ name: string; email: string | null }>(`DELETE FROM ad_advisors a USING users u
        WHERE a.user_id = $1 AND u.id = a.user_id RETURNING a.full_name AS name, COALESCE(u.email, u.username) AS email`, [id]);
      if (!removed.rows[0]) throw new AdvisorError("advisor_not_found", 404);
      await client.query("COMMIT");
      return removed.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  // ------------------------------------------------------------------------------------------------- AD-ADV-01, 03

  async preview(actor: AuthenticatedUser, fileName: string, sheet: AdvisorSheet): Promise<AdvisorImportPreview> {
    await this.access(actor, true);
    return planImport(fileName, sheet, await this.lookups(this.pool, sheet)).preview;
  }

  /** Applies the advisors of the workbook that have no problem, in one transaction; the others are skipped. */
  async apply(actor: AuthenticatedUser, fileName: string, sheet: AdvisorSheet): Promise<AdvisorImportResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK]);
      await this.access(actor, true, client);
      const { preview, plan } = planImport(fileName, sheet, await this.lookups(client, sheet, true));
      for (const item of plan) {
        if (item.status !== "add" && item.status !== "update") continue;
        await this.applyItem(client, actor, item);
      }
      await client.query("COMMIT");
      const count = (status: PlannedAdvisor["status"]) => plan.filter((item) => item.status === status).length;
      return { added: count("add"), updated: count("update"), unchanged: count("unchanged"), skipped: count("error"), preview };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async applyItem(client: PoolClient, actor: AuthenticatedUser, item: PlannedAdvisor): Promise<void> {
    const account = item.userId ? { id: item.userId, role: item.roleChange ? "lecturer" : "advisor", isActive: true } : null;
    const userId = await this.ensureAccount(client, actor, item.email, item.name, account);
    await client.query(`INSERT INTO ad_advisors(user_id, full_name, staff_code, unit, created_by, updated_by) VALUES($1, $2, $3, $4, $5, $5)
      ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, staff_code = EXCLUDED.staff_code, unit = EXCLUDED.unit,
        updated_at = now(), updated_by = EXCLUDED.updated_by`, [userId, item.name, item.staffCode, item.unit, actor.userId]);
    await client.query("UPDATE users SET display_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND entra_object_id IS NULL", [userId, item.name.slice(0, 200)]);
    await this.setClasses(client, actor, userId, item.classes, true);
  }

  /** What planImport needs to know about the workbook's emails and classes; forUpdate locks the matched accounts. */
  private async lookups(db: Db, sheet: AdvisorSheet, forUpdate = false): Promise<ImportLookups> {
    const emails = [...new Set(sheet.items.map((item) => item.email).filter(Boolean))];
    const classes = [...new Set(sheet.items.flatMap((item) => item.classes))];
    const found = await db.query<{ key: string; id: string; role: string; isActive: boolean }>(`SELECT k.key, u.id,
        COALESCE(u.role_override, u.role) AS role, u.is_active AS "isActive"
      FROM unnest($1::text[]) AS k(key) JOIN users u ON lower(u.email) = k.key OR lower(u.username) = k.key
      ORDER BY k.key, u.id${forUpdate ? " FOR UPDATE OF u" : ""}`, [emails]);
    const accounts = new Map<string, { id: string; role: string; isActive: boolean }[]>();
    for (const row of found.rows) {
      const list = accounts.get(row.key) ?? [];
      if (!list.some((known) => known.id === row.id)) list.push({ id: row.id, role: row.role, isActive: row.isActive });
      accounts.set(row.key, list);
    }
    const ids = [...accounts.values()].flat().map((account) => account.id);
    const advisorRows = await db.query<{ userId: string; name: string; staffCode: string | null; unit: string | null; classes: string[] }>(`SELECT a.user_id AS "userId",
        a.full_name AS name, a.staff_code AS "staffCode", a.unit,
        COALESCE((SELECT array_agg(c.class_name ORDER BY c.class_name) FROM ad_advisor_classes c WHERE c.advisor_user_id = a.user_id), '{}') AS classes
      FROM ad_advisors a WHERE a.user_id = ANY($1::uuid[])`, [ids]);
    const owners = await db.query<{ className: string; userId: string; name: string }>(`SELECT c.class_name AS "className", c.advisor_user_id AS "userId",
        a.full_name AS name FROM ad_advisor_classes c JOIN ad_advisors a ON a.user_id = c.advisor_user_id WHERE c.class_name = ANY($1::text[])`, [classes]);
    const filled = await db.query<{ className: string }>(`WITH ${CLASS_MEMBERS}
      SELECT DISTINCT class_name AS "className" FROM class_members WHERE class_name = ANY($1::text[])`, [classes]);
    return {
      accounts,
      advisors: new Map(advisorRows.rows.map((row) => [row.userId, { name: row.name, staffCode: row.staffCode, unit: row.unit, classes: row.classes }])),
      classOwners: new Map(owners.rows.map((row) => [row.className, { userId: row.userId, name: row.name }])),
      classesWithStudents: new Set(filled.rows.map((row) => row.className)),
      staffDomains: this.staffEmailDomains,
    };
  }

  // ---------------------------------------------------------------------------------------------------- shared steps

  /** One change under the account lock, by an actor who manages advisors; answers the advisor's detail after it. */
  private async change(actor: AuthenticatedUser, work: (client: PoolClient) => Promise<string>): Promise<AdvisorDetail> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK]);
      await this.access(actor, true, client);
      const id = await work(client);
      const detail = await this.detail(id, client);
      await client.query("COMMIT");
      return detail;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  /** The one account of an email (lower-case email or username), locked; null when there is none. */
  private async account(client: PoolClient, email: string): Promise<{ id: string; role: string; isActive: boolean } | null> {
    const result = await client.query<{ id: string; role: string; isActive: boolean }>(`SELECT id, COALESCE(role_override, role) AS role,
      is_active AS "isActive" FROM users WHERE lower(email) = $1 OR lower(username) = $1 ORDER BY id LIMIT 2 FOR UPDATE`, [email]);
    if (result.rows.length > 1) throw new AdvisorError("ambiguous_account", 409);
    return result.rows[0] ?? null;
  }

  private async isAdvisor(client: PoolClient, userId: string): Promise<boolean> {
    return Boolean((await client.query("SELECT 1 FROM ad_advisors WHERE user_id = $1", [userId])).rowCount);
  }

  /**
   * The advisor's account: a new precreated one (role advisor, bound at the first Microsoft sign-in), or the existing one.
   * A student account cannot advise, a locked one is refused; a lecturer becomes an advisor (signed out: the role
   * changed), and the other admin-portal roles keep theirs.
   */
  private async ensureAccount(client: PoolClient, actor: AuthenticatedUser, email: string, name: string,
    account: { id: string; role: string; isActive: boolean } | null): Promise<string> {
    if (!account) {
      const created = await client.query<{ id: string }>(`INSERT INTO users (id, entra_tenant_id, entra_object_id, entra_subject,
          display_name, email, username, role, role_override, is_student, first_login_at, last_login_at)
        VALUES ($1, $2, NULL, NULL, $3, $4, $4, 'advisor', 'advisor', FALSE, NULL, NULL) RETURNING id`,
      [randomUUID(), actor.tenantId, name.slice(0, 200), email]);
      return created.rows[0]!.id;
    }
    if (account.role === "student") throw new AdvisorError("student_account", 409);
    if (!account.isActive) throw new AdvisorError("account_locked", 409);
    if (!["admin", "faculty_board", "department_head", "advisor"].includes(account.role)) {
      await client.query(`UPDATE users SET role = 'advisor', role_override = 'advisor', auth_version = auth_version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [account.id]);
      await client.query("DELETE FROM user_sessions WHERE sess->'user'->>'userId' = $1", [account.id]);
    }
    return account.id;
  }

  /** Refuses classes another advisor has (manual add and edit; an import moves them instead). */
  private async classesFree(client: PoolClient, classes: readonly string[], self: string | null): Promise<void> {
    const taken = await client.query<{ className: string; advisorName: string }>(`SELECT c.class_name AS "className", a.full_name AS "advisorName"
      FROM ad_advisor_classes c JOIN ad_advisors a ON a.user_id = c.advisor_user_id
      WHERE c.class_name = ANY($1::text[]) AND ($2::uuid IS NULL OR c.advisor_user_id <> $2) ORDER BY c.class_name`, [classes, self]);
    if (taken.rows.length) throw new AdvisorError("class_taken", 409, { classes: taken.rows });
  }

  /** The advisor's classes become exactly these; move takes a class from another advisor (import). */
  private async setClasses(client: PoolClient, actor: AuthenticatedUser, userId: string, classes: readonly string[], move = false): Promise<void> {
    await client.query("DELETE FROM ad_advisor_classes WHERE advisor_user_id = $1 AND NOT (class_name = ANY($2::text[]))", [userId, classes]);
    await client.query(`INSERT INTO ad_advisor_classes(class_name, advisor_user_id, assigned_by) SELECT x, $2, $3 FROM unnest($1::text[]) AS x
      ON CONFLICT (class_name) DO ${move ? `UPDATE SET advisor_user_id = EXCLUDED.advisor_user_id, assigned_at = now(), assigned_by = EXCLUDED.assigned_by
        WHERE ad_advisor_classes.advisor_user_id <> EXCLUDED.advisor_user_id` : "NOTHING"}`, [classes, userId, actor.userId]);
  }

  // ------------------------------------------- AD-AST-01…05: own classes, or every class for admins and Ban chủ nhiệm khoa

  async me(actor: AuthenticatedUser): Promise<AdvisorMe> {
    const result = await this.pool.query<{ classes: number }>("SELECT count(*)::int AS classes FROM ad_advisor_classes WHERE advisor_user_id = $1", [actor.userId]);
    return { classes: result.rows[0]?.classes ?? 0, canManageAdvisors: canManageAdvisors(actor.role), scope: seesEveryStudent(actor) ? "all" : "own" };
  }

  async classes(actor: AuthenticatedUser): Promise<AdvisorClass[]> {
    return seesEveryStudent(actor)
      ? (await this.pool.query<AdvisorClass>(classStats(EVERY_CLASS))).rows
      : (await this.pool.query<AdvisorClass>(classStats(OWN_CLASSES), [actor.userId])).rows;
  }

  /**
   * The students of the account's classes (any student for admins), filtered by class, text and step. "complete" (Đã đủ
   * các bước) is a transcript, an assessment and an AI roadmap: the profile survey is optional since 2026-11-14 (plan "Một
   * bước để bắt đầu"), so it is no step any more; "no_survey" still lists who has not done it.
   */
  async students(actor: AuthenticatedUser, query: AdvisedStudentQuery): Promise<{ items: AdvisedStudentRow[]; total: number }> {
    const order = orderBy(studentSort, studentOrder, query.sort, query.dir);
    const result = await this.pool.query<{ items: (Omit<AdvisedStudentRow, "specialty"> & { specialty: SpecialtyCode | null })[]; total: number }>(`WITH students AS (
        SELECT u.id AS "userId", p.student_code AS "studentCode", COALESCE(NULLIF(btrim(p.full_name), ''), u.display_name) AS name,
          COALESCE(${CLASS_OF}, '') AS "className", COALESCE(p.cohort_code, substring(${CLASS_OF} FROM 'K[0-9]{2,3}')) AS cohort,
          p.specialty, cp.name_vi AS "targetCareer",
          EXISTS (SELECT 1 FROM student_transcripts t WHERE t.user_id = u.id) AS "hasTranscript",
          EXISTS (SELECT 1 FROM stu_comp_assessments s WHERE s.user_id = u.id) AS assessed,
          ${SURVEY_COMPLETE_SQL} AS "surveyDone",
          EXISTS (SELECT 1 FROM stu_roadmaps r WHERE r.user_id = u.id AND r.status = 'completed') AS roadmap,
          u.last_login_at AS "lastLoginAt"
        FROM users u JOIN student_profiles p ON p.user_id = u.id
        LEFT JOIN career_positions cp ON cp.id = p.career_position_id AND cp.deleted_at IS NULL
        WHERE ${ACTIVE_STUDENT} AND ($1::uuid IS NULL OR ${CLASS_OF} IN (SELECT class_name FROM ad_advisor_classes WHERE advisor_user_id = $1))
      ), filtered AS (
        SELECT * FROM students
        WHERE ($2::text IS NULL OR "className" = $2)
          AND ($3 = '' OR strpos(lower(concat_ws(' ', "studentCode", name)), lower($3)) > 0)
          AND (CASE $4::text WHEN 'no_transcript' THEN NOT "hasTranscript" WHEN 'no_assessment' THEN NOT assessed
            WHEN 'no_survey' THEN NOT "surveyDone" WHEN 'no_roadmap' THEN NOT roadmap
            WHEN 'complete' THEN "hasTranscript" AND assessed AND roadmap ELSE TRUE END)
      ), numbered AS (SELECT filtered.*, row_number() OVER (ORDER BY ${orderBy(studentSort, studentOrder)})::int AS stt FROM filtered),
      paged AS (SELECT * FROM numbered ORDER BY ${order} LIMIT $5 OFFSET $6)
      SELECT COALESCE((SELECT json_agg(paged ORDER BY ${order}) FROM paged), '[]'::json) AS items, (SELECT count(*)::int FROM filtered) AS total`,
    [seesEveryStudent(actor) ? null : actor.userId, query.className ?? null, query.q, query.status, query.pageSize, (query.page - 1) * query.pageSize]);
    const page = result.rows[0] ?? { items: [], total: 0 };
    return { items: page.items.map((row) => ({ ...row, specialty: specialtyLabel(row.specialty) })), total: page.total };
  }

  /** AD-AST-05: the account opens a student's page (advisedStudent: own classes, any student for admins); logged, never data. */
  async open(actor: AuthenticatedUser, studentId: string, path: string): Promise<{ url: string }> {
    const student = await advisedStudent(this.pool, actor, studentId);
    if (!student) throw new AdvisorError("student_not_advised", 403);
    await recordAudit(this.pool, auditActorOf(actor), { kind: "advisor", action: "Mở trang sinh viên", summary: studentLabel(student),
      targetType: "student", targetId: studentId, method: "POST", path });
    // The page's own reads that follow are covered by this line (access.ts advisorActing).
    studentViews.mark(actor.userId, studentId);
    return { url: `/dashboard?sv=${encodeURIComponent(studentId)}#overview` };
  }
}

/** What the routers use, so their tests can stand a fake in. */
export type AdvisorRepository = Pick<PostgresAdvisorRepository,
  "access" | "list" | "detail" | "create" | "update" | "remove" | "preview" | "apply" | "me" | "classes" | "students" | "open">;
