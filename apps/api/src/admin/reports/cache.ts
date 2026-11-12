// Báo cáo của cổng quản trị: the student rows, cached in memory (the Render service is a single instance). A row is
// computed again only when its fingerprint changes: the student's profile, stored transcript, saved Kế hoạch học kỳ,
// latest assessment, latest roadmap and consents, and the catalog the engine reads (CTĐT, KHĐT, tiêu chuẩn xét tốt
// nghiệp, competency and career configuration); nothing in a row depends on the date. readOverview costs about 25 ms
// per student, up to 200 ms with a roadmap (the planner's facts; measured locally 2026-10-31), so a cold report for
// many students takes seconds and a warm one only the fingerprint query. Rows are computed a few at a time, each in its
// own REPEATABLE READ READ ONLY transaction; a row being computed is shared by concurrent requests.
import type { PoolClient } from "pg";
import { profileSpecialty, normalizeCohortCode } from "../../graduation/resolve.js";
import type { DatabasePool } from "../../db/pool.js";
import { fallbackRow, readReportRow, type ReportIdentity, type ReportRow } from "./rows.js";

export type ReportRows = { rows: ReportRow[]; generatedAt: string };
export type ReportRowSource = { rows(now?: Date): Promise<ReportRows> };

/** Tables the engine and readOverview read for every student; a change in any of them makes every row stale. */
const CATALOG_TABLES = [
  "curricula", "curriculum_revisions", "curriculum_courses", "curriculum_relations", "curriculum_events",
  "training_plans", "training_plan_revisions", "training_plan_items", "training_plan_events",
  "graduation_standards", "graduation_revisions", "graduation_courses", "graduation_events",
  // ad_comp_skill_majors and ad_comp_skill_field_groups left this list before migration 064 dropped them (2026-11-12): a
  // running server builds its stamp SQL once, so a dropped table still in it would fail the reports until a restart.
  "ad_comp_groups", "ad_comp_skills", "ad_comp_skill_groups",
  "ad_comp_courses", "ad_comp_course_configs", "ad_comp_course_links", "ad_comp_course_aliases", "ad_comp_events",
  "career_fields", "career_positions", "career_requirements", "career_skills",
  "competency_groups", "competency_skills", "competency_weights", "competency_course_links", "competency_criteria",
  "assessment_configurations", "career_gap_configurations",
] as const;
const STAMP_COLUMNS = ["created_at", "updated_at", "deleted_at"];

/**
 * One SQL that sums up the catalog: per table its row count, its newest timestamp and its versions; a table without
 * timestamps (course links, plan items, …) adds a hash of its rows, so an edit in place shows too. Built once from the
 * tables and columns that exist (whitelisted names only).
 */
export function catalogStampSql(columns: ReadonlyMap<string, ReadonlySet<string>>): string | null {
  const parts = CATALOG_TABLES.filter((table) => columns.has(table)).map((table) => {
    const own = columns.get(table)!;
    const stamps = STAMP_COLUMNS.filter((column) => own.has(column));
    const newest = stamps.length ? `COALESCE(max(GREATEST(${stamps.join(",")}))::text,'')` : `COALESCE(sum(hashtext(x::text))::text,'0')`;
    // version is a number in some tables and a uuid or text in others: compare its values, whatever the type.
    const version = own.has("version") ? ` || ':' || COALESCE(md5(string_agg(version::text, ',' ORDER BY version::text)),'')` : "";
    return `SELECT '${table}' AS t, count(*)::text || ':' || ${newest}${version} AS part FROM ${table} x`;
  });
  return parts.length ? `SELECT md5(string_agg(part, '|' ORDER BY t)) AS stamp FROM (${parts.join(" UNION ALL ")}) parts` : null;
}

/** Every student account with what its row depends on (one query for all; md5 of the inputs' versions). */
export const STUDENTS_SQL = `SELECT u.id AS "userId",
    COALESCE(NULLIF(btrim(p.full_name),''), NULLIF(btrim(u.display_name),''), u.email, u.username, '') AS name,
    p.student_code AS "studentCode", p.cohort_code AS "cohortCode", btrim(p.major_code) AS "majorCode", p.specialty,
    md5(concat_ws('|', u.display_name, p.full_name, p.student_code, p.cohort_code, p.major_code, p.specialty, p.career_position_id, p.updated_at,
      t.version, t.updated_at, s.updated_at,
      (SELECT a.id::text || '@' || a.created_at FROM stu_comp_assessments a WHERE a.user_id=u.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1),
      (SELECT r.id::text || '@' || r.status || '@' || r.updated_at FROM stu_roadmaps r WHERE r.user_id=u.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1),
      (SELECT r.id::text FROM stu_roadmaps r WHERE r.user_id=u.id AND r.status='completed' ORDER BY r.created_at DESC, r.id DESC LIMIT 1),
      (SELECT string_agg(c.purpose || ':' || COALESCE(c.end_reason,'active') || ':' || c.granted_at, ',' ORDER BY c.purpose, c.granted_at)
         FROM data_consents c WHERE c.user_id=u.id))) AS fingerprint
  FROM users u
  LEFT JOIN student_profiles p ON p.user_id=u.id
  LEFT JOIN student_transcripts t ON t.user_id=u.id
  LEFT JOIN stu_study_plans s ON s.user_id=u.id
  WHERE (COALESCE(u.role_override,u.role)='student' OR u.is_student)`;

type StudentRecord = { userId: string; name: string; studentCode: string | null; cohortCode: string | null; majorCode: string | null; specialty: string | null; fingerprint: string };

export const identityOf = (record: StudentRecord): ReportIdentity => ({
  userId: record.userId,
  name: record.name?.trim() || "(chưa có tên)",
  studentCode: record.studentCode?.trim() || null,
  cohort: normalizeCohortCode(record.cohortCode),
  majorCode: record.majorCode?.trim() || null,
  specialtyCode: profileSpecialty(record.specialty),
});

/** Runs `work` over `items`, at most `limit` at a time. */
export async function runLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await work(items[next++]!);
  });
  await Promise.all(lanes);
}

export type RowCacheDeps = {
  /** Every student with the fingerprint of the student's own inputs. */
  listStudents: () => Promise<StudentRecord[]>;
  /** The fingerprint of what every row depends on (catalog, …). */
  sharedStamp: (now: Date) => Promise<string>;
  /** One row, computed afresh. */
  computeRow: (identity: ReportIdentity, now: Date) => Promise<ReportRow>;
  concurrency?: number;
};

/** The cache itself, over injectable reads (tests use fakes; createReportRowSource wires the database). */
export function createRowCache(deps: RowCacheDeps): ReportRowSource & { size(): number } {
  const cache = new Map<string, { key: string; row: ReportRow }>();
  const inFlight = new Map<string, Promise<ReportRow>>();
  const concurrency = deps.concurrency ?? 3;

  const compute = (identity: ReportIdentity, key: string, now: Date): Promise<ReportRow> => {
    const flightKey = `${identity.userId}|${key}`;
    const running = inFlight.get(flightKey);
    if (running) return running;
    const promise = deps.computeRow(identity, now).then((row) => {
      cache.set(identity.userId, { key, row });
      return row;
    }, (error: unknown) => {
      // One student's failure must not fail the report: the student counts as "Chưa đủ dữ liệu" in this answer (not
      // cached), and the row is tried again next time.
      console.error(`[reports] row not computed (${error instanceof Error ? error.name : "error"})`);
      return fallbackRow(identity, now);
    }).finally(() => inFlight.delete(flightKey));
    inFlight.set(flightKey, promise);
    return promise;
  };

  return {
    size: () => cache.size,
    async rows(now = new Date()) {
      const [students, shared] = await Promise.all([deps.listStudents(), deps.sharedStamp(now)]);
      const keyOf = (student: StudentRecord) => `${student.fingerprint}|${shared}`;
      const fresh = new Map<string, ReportRow>();
      const stale = students.filter((student) => cache.get(student.userId)?.key !== keyOf(student));
      await runLimited(stale, concurrency, async (student) => { fresh.set(student.userId, await compute(identityOf(student), keyOf(student), now)); });
      const present = new Set(students.map((student) => student.userId));
      for (const userId of cache.keys()) if (!present.has(userId)) cache.delete(userId);
      const rows = students.flatMap((student) => {
        const entry = cache.get(student.userId);
        const row = entry && entry.key === keyOf(student) ? entry.row : fresh.get(student.userId);
        return row ? [row] : [];
      });
      const oldest = rows.reduce<string | null>((min, row) => (min === null || row.computedAt < min ? row.computedAt : min), null);
      return { rows, generatedAt: oldest ?? now.toISOString() };
    },
  };
}

/** The rows of every student, from the database. */
export function createReportRowSource(pool: DatabasePool, options: { concurrency?: number; stampTtlMs?: number } = {}): ReportRowSource & { warm(): Promise<void>; size(): number } {
  let stampSql: string | null | undefined;
  let stamp: { value: string; at: number } | null = null;
  const ttl = options.stampTtlMs ?? 30_000;

  const sharedStamp = async (now: Date) => {
    if (stamp && now.getTime() - stamp.at < ttl) return stamp.value;
    if (stampSql === undefined) {
      const found = await pool.query<{ table_name: string; columns: string[] }>(
        `SELECT table_name, array_agg(column_name::text) AS columns FROM information_schema.columns
          WHERE table_schema=current_schema() AND table_name=ANY($1::text[]) GROUP BY table_name`, [[...CATALOG_TABLES]]);
      stampSql = catalogStampSql(new Map(found.rows.map((row) => [row.table_name, new Set(row.columns)])));
    }
    const value = stampSql ? (await pool.query<{ stamp: string | null }>(stampSql)).rows[0]?.stamp ?? "" : "";
    stamp = { value, at: now.getTime() };
    return value;
  };

  const computeRow = async (identity: ReportIdentity, now: Date) => {
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const row = await readReportRow(client, identity, now);
      await client.query("COMMIT");
      return row;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const cache = createRowCache({
    listStudents: async () => (await pool.query<StudentRecord>(STUDENTS_SQL)).rows,
    sharedStamp,
    computeRow,
    concurrency: options.concurrency ?? 3,
  });
  return {
    ...cache,
    async warm() {
      try { await cache.rows(new Date()); }
      catch (error) { console.error(`[reports] warm-up failed (${error instanceof Error ? error.name : "error"})`); }
    },
  };
}
