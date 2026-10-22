// Migrations 044–045: student identity from the Microsoft display name, K26 format included ("207CT12345 - Họ Tên -
// K26T-IT11" → cohort K26, class IT11). Applies every migration in a throwaway schema of the LOCAL database
// (apps/api/.env), inserts synthetic accounts and checks the filled profiles.
// Names and codes are made up. Usage: node scripts/verify-student-identity.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import dotenv from "dotenv";
import pg from "pg";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
if (!["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname)) throw new Error("Local database required");
const schema = `verify_identity_${Date.now()}`;
// search_path is the audit schema ONLY, so a missing table can never fall through to public.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
const admin = new pg.Client({ connectionString: env.DATABASE_URL });
const inSchema = (sql) => sql.replaceAll("public.", `${schema}.`).replaceAll("'public'", `'${schema}'`)
  .replaceAll("SET search_path=public,pg_temp", `SET search_path=${schema},pg_temp`)
  .replaceAll("SET search_path = pg_catalog, public", `SET search_path = pg_catalog, ${schema}`);
const checks = [];
let created = false;
await admin.connect();
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  created = true;
  const files = (await readdir("apps/api/migrations")).filter((name) => name.endsWith(".sql")).sort();
  const apply = async (file) => pool.query(`BEGIN; ${inSchema(await readFile(`apps/api/migrations/${file}`, "utf8"))} COMMIT;`);
  for (const file of files.filter((name) => name < "045")) await apply(file);

  const tenant = randomUUID();
  const addUser = async (name) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,role,is_student,is_active,first_login_at,last_login_at)
      VALUES($1,$2,$3,$4,$5,$6,$6,'student',true,true,now(),now())`, [id, tenant, randomUUID(), `verify:${id}`, name, `${id}@vanlanguni.vn`]);
    return id;
  };
  const profile = async (id) => (await pool.query(`SELECT student_code AS code,full_name AS name,cohort_code AS cohort,class_name AS class,cohort_year AS year
    FROM student_profiles WHERE user_id=$1`, [id])).rows[0] ?? null;

  // 044 stored the class with the cohort letters ("T-IT11"); 045 keeps only what follows the hyphen.
  const before045 = await addUser("207CT99900 - Sinh Viên Thử Trước - K26T-IT10");
  assert.equal((await profile(before045)).class, "T-IT10");
  for (const file of files.filter((name) => name >= "045")) await apply(file);
  assert.deepEqual(await profile(before045), { code: "207CT99900", name: "Sinh Viên Thử Trước", cohort: "K26", class: "IT10", year: 2020 });
  checks.push("045 turns a class 044 stored as T-IT10 into IT10");

  assert.deepEqual(await profile(await addUser("2374802019999 - Sinh Viên Thử - 71K29CNTT08")),
    { code: "2374802019999", name: "Sinh Viên Thử", cohort: "K29", class: "CNTT08", year: 2023 });
  checks.push("the K27+ format still gives code, name, cohort, class and intake");

  for (const [name, expected] of [
    ["207CT99901 - Sinh Viên Thử Một - K26T-IT11", { code: "207CT99901", name: "Sinh Viên Thử Một", cohort: "K26", class: "IT11", year: 2020 }],
    ["207LH99902 - Sinh Viên Thử Hai - K26D-LH07", { code: "207LH99902", name: "Sinh Viên Thử Hai", cohort: "K26", class: "LH07", year: 2020 }],
    ["207CT99903 - Sinh Viên Thử Ba - K26DB-IT1", { code: "207CT99903", name: "Sinh Viên Thử Ba", cohort: "K26", class: "IT1", year: 2020 }],
  ]) assert.deepEqual(await profile(await addUser(name)), expected, name);
  checks.push("K26 names (207CT…/207LH…, K26T-IT11, K26D-LH07, K26DB-IT1) give cohort K26, the class after the hyphen and intake 2020");

  for (const name of ["207CT999 - Sinh Viên Lỗi - K26T-IT11", "207CT99904 - Sinh Viên Lỗi - IT11", "Sinh Viên Không Mã"])
    assert.equal((await profile(await addUser(name)))?.cohort ?? null, null, name);
  checks.push("names that match neither format fill nothing");

  const kept = await addUser("Tài khoản chưa đổi tên");
  await pool.query("INSERT INTO student_profiles(user_id,class_name) VALUES($1,'LOP-RIENG') ON CONFLICT (user_id) DO UPDATE SET class_name='LOP-RIENG'", [kept]);
  await pool.query("UPDATE users SET display_name=$2 WHERE id=$1", [kept, "207CT99905 - Sinh Viên Thử Năm - K26T-IT05"]);
  assert.deepEqual(await profile(kept), { code: "207CT99905", name: "Sinh Viên Thử Năm", cohort: "K26", class: "LOP-RIENG", year: 2020 });
  const twin = await addUser("207CT99901 - Sinh Viên Trùng Mã - K26T-IT11");
  assert.equal((await profile(twin)).code, null);
  checks.push("a renamed account keeps the fields it already has; a student code another account owns is not reassigned");
  console.log(checks.map((check) => `PASS ${check}`).join("\n"));
} finally {
  await pool.end();
  if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
