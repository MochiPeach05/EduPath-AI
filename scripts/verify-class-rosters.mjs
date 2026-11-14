// Migration 065 (danh sách lớp, reviewer note 2026-11-14): applies every migration in a throwaway schema of the LOCAL
// database (apps/api/.env), then imports class lists with the real repositories and signs a listed student in for the
// first time. Checks: the advisor imports only their own classes (an admin any class); the list shows the students who
// never signed in as such; a first sign-in links the account to the list's row by the MSSV (one account, one row, the
// list's class); a student moved by a list belongs to the new class for the advisors' rights too; importing the same tệp
// again changes nothing and an edited tệp updates only what changed; "Xóa khỏi danh sách lớp" removes only a student who
// never signed in, of a class the account may import; the listed students are no accounts, so the pages built on accounts
// (Sinh viên, Thống kê, notifications, AI, acting) do not see them. Names and codes are made up.
// Usage (after npm run build -w @edupath/api): node scripts/verify-class-rosters.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import dotenv from "dotenv";
import pg from "pg";
import ExcelJS from "exceljs";
import { PostgresRosterRepository } from "../apps/api/dist/advisors/roster-repository.js";
import { readRosterWorkbook } from "../apps/api/dist/advisors/roster.js";
import { PostgresAdvisorRepository } from "../apps/api/dist/advisors/repository.js";
import { advisedStudent } from "../apps/api/dist/advisors/access.js";
import { PostgresStudentProfileRepository } from "../apps/api/dist/admin/student-profiles.js";
import { PostgresUserRepository } from "../apps/api/dist/users/postgres-user-repository.js";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
if (!["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname)) throw new Error("Local database required");
const schema = `verify_rosters_${Date.now()}`;
// search_path is the throwaway schema ONLY, so a missing table can never fall through to public.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4, options: `-c search_path=${schema}` });
const admin = new pg.Client({ connectionString: env.DATABASE_URL });
const inSchema = (sql) => sql.replaceAll("public.", `${schema}.`).replaceAll("'public'", `'${schema}'`)
  .replaceAll("SET search_path=public,pg_temp", `SET search_path=${schema},pg_temp`)
  .replaceAll("SET search_path = pg_catalog, public", `SET search_path = pg_catalog, ${schema}`);
const checks = [];
const check = (name, ok) => { checks.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
let created = false;

const tenant = randomUUID();
async function account(role, displayName, email, signedIn = true) {
  const id = randomUUID();
  await pool.query(`INSERT INTO users (id, entra_tenant_id, entra_object_id, entra_subject, display_name, email, username, role, role_override, is_student,
      first_login_at, last_login_at) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $10)`,
  [id, tenant, signedIn ? randomUUID() : null, signedIn ? `subject-${id}` : null, displayName, email, role, role === "student" ? null : role, role === "student",
    signedIn ? new Date() : null]);
  return { userId: id, tenantId: tenant, objectId: randomUUID(), identityKey: `${tenant}:x`, name: displayName, email, username: email, role, signedInAt: new Date().toISOString() };
}
async function advisor(user, name, classes) {
  await pool.query("INSERT INTO ad_advisors(user_id, full_name) VALUES ($1, $2)", [user.userId, name]);
  for (const className of classes) await pool.query("INSERT INTO ad_advisor_classes(class_name, advisor_user_id) VALUES ($1, $2)", [className, user.userId]);
}
async function workbook(rows) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Danh sách lớp");
  sheet.addRow(["TRƯỜNG ĐẠI HỌC VĂN LANG"]);
  sheet.addRow(["STT", "MSSV", "Họ và tên", "Ngày sinh", "Lớp", "Email"]);
  rows.forEach((row, index) => sheet.addRow([index + 1, row[0], row[1], "01/01/2005", row[2] ?? "", row[3] ?? ""]));
  return Buffer.from(await book.xlsx.writeBuffer());
}
const listQuery = { q: "", status: "all", page: 1, pageSize: 100 };

await admin.connect();
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  created = true;
  const files = (await readdir("apps/api/migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) await pool.query(`BEGIN; ${inSchema(await readFile(`apps/api/migrations/${file}`, "utf8"))} COMMIT;`);
  check(`all ${files.length} migrations apply, 065 last`, files.at(-1) === "065_class_students.sql");
  const table = await pool.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'ad_class_students'`, [schema]);
  check("ad_class_students holds only MSSV, name, class, email and who/when", table.rows[0].n === 8);
  const rls = await pool.query(`SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = 'ad_class_students'`, [schema]);
  check("row level security on", rls.rows[0]?.relrowsecurity === true);
  await assert.rejects(pool.query("INSERT INTO ad_class_students(student_code, full_name, class_name) VALUES ('SV-1', 'X', '71K29CNTT99')"));
  await assert.rejects(pool.query("INSERT INTO ad_class_students(student_code, full_name, class_name, email) VALUES ('2374802010001', 'X', '71k29cntt99', NULL)"));
  check("the table refuses an MSSV the sign-in never reads and a class not in its canonical form", true);

  const khoa = await account("admin", "Quản trị viên Thử", "qtv.thu@vlu.edu.vn");
  const one = await account("advisor", "Cố vấn Một", "covan.mot@vlu.edu.vn");
  const two = await account("advisor", "Cố vấn Hai", "covan.hai@vlu.edu.vn");
  const none = await account("lecturer", "Giảng viên Không Lớp", "gv.khonglop@vlu.edu.vn");
  await advisor(one, "Cố vấn Một", ["71K29CNTT99"]);
  await advisor(two, "Cố vấn Hai", ["71K29CNTT98"]);
  // A student who signed in before any list: class CNTT98 by the Microsoft display name.
  const early = await account("student", "2374802010994 - Sinh Viên Sớm - 71K29CNTT98", "som.2374802010994@vanlanguni.vn");
  const accountsBefore = (await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'student'")).rows[0].n;

  const roster = new PostgresRosterRepository(pool);
  const advisors = new PostgresAdvisorRepository(pool, new Set(["vlu.edu.vn"]));
  const file = await workbook([
    ["2374802010991", "Nguyễn Văn An", "71K29CNTT99", "an.2374802010991@vanlanguni.vn"],
    ["2374802010992", "TRẦN THỊ BÌNH", "", ""],
    ["2374802010994", "Sinh Viên Sớm", "71K29CNTT99", ""],
    ["2374802010995", "Lớp Người Khác", "71K29CNTT98", ""],
  ]);
  const sheet = await readRosterWorkbook(file, "71K29CNTT99");
  check("the reader never keeps the date of birth", !JSON.stringify(sheet).includes("01/01/2005"));
  const preview = await roster.preview(one, "ds.xlsx", sheet);
  check("preview by the advisor: 2 add, 1 move of a signed-in student, 1 refused (another advisor's class)",
    preview.summary.add === 2 && preview.summary.update === 1 && preview.summary.error === 1 && preview.summary.moved === 1 && preview.summary.signedIn === 1);
  check("the refused row names the class", preview.items.find((item) => item.studentCode === "2374802010995")?.problems[0]
    === "Lớp 71K29CNTT98 không thuộc các lớp bạn phụ trách nên không import được sinh viên này.");
  check("the move names the class and its advisor", preview.items.find((item) => item.studentCode === "2374802010994")?.changes[0]
    === "Chuyển từ lớp 71K29CNTT98 (cố vấn Cố vấn Hai) sang lớp 71K29CNTT99");
  check("a preview stores nothing", (await pool.query("SELECT count(*)::int AS n FROM ad_class_students")).rows[0].n === 0);
  const applied = await roster.apply(one, "ds.xlsx", sheet);
  check("import: added 2, updated 1, skipped 1", applied.added === 2 && applied.updated === 1 && applied.skipped === 1);
  const stored = (await pool.query("SELECT student_code, full_name, class_name, email FROM ad_class_students ORDER BY student_code")).rows;
  check("stored rows: the two new students and the moved one, nothing of another class", JSON.stringify(stored) === JSON.stringify([
    { student_code: "2374802010991", full_name: "Nguyễn Văn An", class_name: "71K29CNTT99", email: "an.2374802010991@vanlanguni.vn" },
    { student_code: "2374802010992", full_name: "Trần Thị Bình", class_name: "71K29CNTT99", email: null },
    { student_code: "2374802010994", full_name: "Sinh Viên Sớm", class_name: "71K29CNTT99", email: null },
  ]));

  const ownList = await advisors.students(one, listQuery);
  check("the advisor's list: 3 students, 2 of them Chưa đăng nhập without an account", ownList.total === 3
    && ownList.items.filter((row) => !row.signedIn && row.userId === null).length === 2
    && ownList.items.find((row) => row.studentCode === "2374802010994")?.userId === early.userId);
  check("Chưa đăng nhập filter", (await advisors.students(one, { ...listQuery, status: "not_signed_in" })).total === 2);
  check("Đã đủ các bước never lists a student who never signed in", (await advisors.students(one, { ...listQuery, status: "complete" })).total === 0);
  const otherList = await advisors.students(two, listQuery);
  check("the other advisor sees neither the listed students nor the moved one", otherList.total === 0);
  const classes = await advisors.classes(one);
  check("the class counts the whole list and who signed in", classes.length === 1 && classes[0].students === 3 && classes[0].signedIn === 1);
  check("the moved student is the new advisor's for acting, not the old one's",
    (await advisedStudent(pool, one, early.userId))?.className === "71K29CNTT99" && (await advisedStudent(pool, two, early.userId)) === null);
  const everyClass = await advisors.classes(khoa);
  check("admins see the class of the list among every class", everyClass.some((row) => row.className === "71K29CNTT99" && row.students === 3));
  const advisorRow = (await advisors.list({ q: "" })).find((row) => row.userId === one.userId);
  check("the advisor list counts the whole class too", advisorRow?.students === 3);

  // An account with classes of nobody imports nothing; an admin imports any class.
  check("an account that advises no class is refused every row", (await roster.preview(none, "ds.xlsx", sheet)).summary.error === 4);
  const byKhoa = await roster.apply(khoa, "ds.xlsx", await readRosterWorkbook(await workbook([["2374802010995", "Lớp Người Khác", "71K29CNTT98", ""]]), null));
  check("an admin imports a student of any class", byKhoa.added === 1);
  check("the other advisor now sees that student", (await advisors.students(two, listQuery)).total === 1);

  // The first Microsoft sign-in of a listed student: their display name even says another class.
  const users = new PostgresUserRepository(pool);
  const signedIn = await users.upsertMicrosoftUser({ tenantId: tenant, objectId: randomUUID(), subject: `subject-${randomUUID()}`,
    name: "2374802010991 - Nguyễn Văn An - 71K29CNTT05", email: "an.2374802010991@vanlanguni.vn", username: "an.2374802010991@vanlanguni.vn",
    loginHint: null, roles: [], nonce: "n", audience: "a", issuer: "i", expiresAt: 0 }, "student");
  const after = await advisors.students(one, listQuery);
  const linked = after.items.filter((row) => row.studentCode === "2374802010991");
  check("first sign-in: one row for the MSSV, the account, in the list's class", linked.length === 1 && linked[0].userId === signedIn.userId
    && linked[0].signedIn && linked[0].className === "71K29CNTT99" && after.total === 3);
  check("first sign-in: one account with the MSSV, the list's row kept", (await pool.query(
    "SELECT (SELECT count(*)::int FROM student_profiles WHERE student_code = '2374802010991') AS profiles, (SELECT count(*)::int FROM ad_class_students WHERE student_code = '2374802010991') AS rows"))
    .rows.every((row) => row.profiles === 1 && row.rows === 1));
  check("the class counts one more signed in", (await advisors.classes(one))[0].signedIn === 2);
  check("the advisor may now open and act for the student", (await advisedStudent(pool, one, signedIn.userId))?.studentCode === "2374802010991");

  // Importing again: the same tệp changes nothing; an edited one updates only what changed.
  const again = await roster.apply(one, "ds.xlsx", await readRosterWorkbook(file, "71K29CNTT99"));
  check("the same tệp again: nothing added or updated", again.added === 0 && again.updated === 0 && again.unchanged === 3 && again.skipped === 1);
  const edited = await roster.apply(one, "ds-sua.xlsx", await readRosterWorkbook(await workbook([
    ["2374802010991", "Nguyễn Văn An", "71K29CNTT99", "an.2374802010991@vanlanguni.vn"],
    ["2374802010992", "Trần Thị Bình", "", "binh.2374802010992@vanlanguni.vn"],
    ["2374802010994", "Sinh Viên Sớm", "71K29CNTT99", ""],
  ]), "71K29CNTT99"));
  check("an edited tệp: one update (an email added), the rest kept", edited.updated === 1 && edited.unchanged === 2 && edited.added === 0);

  // Xóa khỏi danh sách lớp: a student who never signed in, of a class the account may import; never one with an account.
  const refused = async (work, code) => { try { await work(); return false; } catch (error) { return error.code === code; } };
  check("an advisor cannot remove a student of another advisor's class", await refused(() => roster.remove(one, "2374802010995"), "class_not_advised"));
  check("nobody removes a student who signed in", await refused(() => roster.remove(khoa, "2374802010991"), "listed_student_signed_in"));
  check("a student who is not in a list is not found", await refused(() => roster.remove(one, "2374802010777"), "listed_student_not_found"));
  const gone = await roster.remove(one, "2374802010992");
  check("the advisor removes a student of their class who never signed in", gone.studentCode === "2374802010992" && gone.className === "71K29CNTT99"
    && (await advisors.students(one, listQuery)).total === 2 && (await advisors.classes(one))[0].students === 2);
  check("the other advisor removes theirs", (await roster.remove(two, "2374802010995")).className === "71K29CNTT98" && (await advisors.students(two, listQuery)).total === 0);

  // The listed students are no accounts: Sinh viên, Thống kê, notifications and AI read accounts only.
  const accountsAfter = (await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'student'")).rows[0].n;
  check("no account was created for a listed student (only the one who signed in)", accountsAfter === accountsBefore + 1);
  const profiles = await new PostgresStudentProfileRepository(pool).list(khoa, { q: "", page: 1, pageSize: 50 });
  check("Sinh viên lists the accounts only", profiles.total === accountsAfter);
  check("Sinh viên shows the moved student in the list's class", profiles.items.find((row) => row.id === early.userId)?.classCode === "71K29CNTT99");
} finally {
  await pool.end();
  if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length ? `${failed.length} FAILED` : `ALL ${checks.length} PASS`);
process.exitCode = failed.length ? 1 : 0;
