// "Khoa cập nhật …" (kind catalog_updated, 2026-10-30): when an admin saves a new revision of a CTĐT, a training plan or a
// graduation standard, the students it applies to are told to run Đánh giá lại, since their results were computed from the
// old one. Called inside the admin's transaction, under a savepoint: a failure never undoes the import.
import type { PoolClient } from "pg";
import type { SpecialtyCode } from "../competency-assessment/types.js";
import { MAJORS, majorKey } from "../curricula/majors.js";
import { resolveCohortStandard } from "../graduation/resolve.js";
import { catalogUpdated, notifyMany } from "./notify.js";

export type CatalogChange = { kind: "curriculum" | "plan" | "graduation"; id: string; revisionId: string };

const TABLES = { curriculum: "curricula", plan: "training_plans", graduation: "graduation_standards" } as const;
const WHAT = { curriculum: "chương trình đào tạo", plan: "kế hoạch đào tạo", graduation: "tiêu chuẩn xét tốt nghiệp" } as const;
const students = `FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.is_active AND COALESCE(u.role_override,u.role)='student'`;

/** The active students a changed catalog applies to: its cohort and major (a CTĐT or plan), or whose standard it is. */
async function recipients(client: Pick<PoolClient, "query">, change: CatalogChange): Promise<{ cohort: string; userIds: string[] } | null> {
  const row = (await client.query<{ cohort: string; identity: string }>(
    `SELECT cohort_code AS cohort,identity_key AS identity FROM ${TABLES[change.kind]} WHERE id=$1`, [change.id])).rows[0];
  if (!row?.cohort) return null;
  if (change.kind !== "graduation") {
    // Identity "cong nghe thong tin:K29": its major's codes; a framework of no known major goes to the whole cohort.
    const codes = MAJORS.filter((major) => majorKey(major.name) === row.identity.split(":")[0]).map((major) => major.code);
    const ids = await client.query<{ id: string }>(
      `SELECT u.id ${students} AND p.cohort_code=$1 AND (cardinality($2::text[])=0 OR p.major_code IS NULL OR p.major_code::text=ANY($2::text[]))`,
      [row.cohort, codes]);
    return { cohort: row.cohort, userIds: ids.rows.map((item) => item.id) };
  }
  // A standard applies by cohort, specialty and major (graduation/resolve.ts): each pair of the cohort is resolved once.
  const pairs = (await client.query<{ specialty: string | null; major: string | null }>(
    `SELECT DISTINCT p.specialty,p.major_code::text AS major ${students} AND p.cohort_code=$1`, [row.cohort])).rows;
  const userIds: string[] = [];
  for (const pair of pairs) {
    const resolved = await resolveCohortStandard(client, row.cohort, (pair.specialty as SpecialtyCode | null) ?? null, pair.major);
    if (resolved.standard?.id !== change.id) continue;
    const ids = await client.query<{ id: string }>(
      `SELECT u.id ${students} AND p.cohort_code=$1 AND p.specialty IS NOT DISTINCT FROM $2 AND p.major_code::text IS NOT DISTINCT FROM $3`,
      [row.cohort, pair.specialty, pair.major]);
    userIds.push(...ids.rows.map((item) => item.id));
  }
  return { cohort: row.cohort, userIds };
}

export async function notifyCatalogUpdate(client: Pick<PoolClient, "query">, change: CatalogChange): Promise<void> {
  await client.query("SAVEPOINT edupath_catalog_notify");
  try {
    const found = await recipients(client, change);
    if (found?.userIds.length) {
      await notifyMany(client, found.userIds, { ...catalogUpdated(`${WHAT[change.kind]} khóa ${found.cohort}`), sourceKey: `catalog:${change.kind}:${change.revisionId}` });
    }
    await client.query("RELEASE SAVEPOINT edupath_catalog_notify");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT edupath_catalog_notify").catch(() => undefined);
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`[notifications] catalog_updated not written (${typeof code === "string" ? code : "error"})`);
  }
}
