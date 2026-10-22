// PostgreSQL checks for migrations 038 and 039 ("Cấu hình môn học", 2026-10-20): the shared courses, the
// merge of the configurations that several cohorts had for one course, the curriculum trigger, and
// only the newest CTĐT revisions counting (docs/competency-management.md).
// Every write stays in a disposable LOCAL schema that is dropped at the end. Migrations 007-037 build
// the schema as production had it before 038; the curricula, the skill catalog and the competency
// configuration are copied read-only from the local public schema (admin data only; no users or
// student data). Configurations of other cohorts are then added by hand, 038 and 039 are applied and checked.
// Run: node scripts/verify-competency-shared-courses.mjs
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import pg from "pg";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.DATABASE_URL).hostname), "Integration checks require a LOCAL database");
const schema = "comp_courses_audit_" + randomBytes(6).toString("hex");
assert(/^comp_courses_audit_[0-9a-f]{12}$/.test(schema));
const before038 = ["007_student_transcripts.sql", "010_transcript_jobs.sql", "011_curricula.sql", "012_training_plans.sql", "013_graduation_standards.sql",
  "014_career_positions.sql", "015_career_fields.sql", "016_career_requirements.sql", "027_remove_career_requirement_level.sql",
  "019_career_skill_management.sql", "020_career_field_numbers.sql", "021_career_position_codes.sql", "018_data_consents.sql",
  "026_competency_management.sql", "028_student_specialty.sql", "029_student_competency_assessments.sql", "030_competency_consent.sql",
  "031_career_ai_suggestions.sql", "032_graduation_ai_advice.sql", "033_competency_cloud_ai.sql", "034_competency_ai_suggestions.sql",
  "035_competency_ai_skills.sql", "036_cancel_competency_ai_skills.sql", "037_competency_field_groups.sql"];
const adminPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
// search_path is the audit schema ONLY, so a missing table can never fall through to public.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1, options: `-c search_path=${schema}` });
const checks = [];
let schemaCreated = false;

const inSchema = (sql) => sql.replaceAll("public.", `${schema}.`).replaceAll("SET search_path=public,pg_temp", `SET search_path=${schema},pg_temp`)
  .replaceAll("nspname='public'", `nspname='${schema}'`);
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const count = async (sql, params = []) => (await q(`SELECT count(*)::int AS count FROM ${sql}`, params))[0].count;

/** Copies the columns both schemas have, from public into the audit schema. */
async function copy(table, { where = "", exclude = [] } = {}) {
  const columns = (await adminPool.query(`SELECT a.column_name FROM information_schema.columns a JOIN information_schema.columns b
    ON b.table_schema=$2 AND b.table_name=a.table_name AND b.column_name=a.column_name
    WHERE a.table_schema='public' AND a.table_name=$1 ORDER BY a.ordinal_position`, [table, schema])).rows
    .map((row) => row.column_name).filter((name) => !exclude.includes(name)).map((name) => `"${name}"`).join(",");
  await adminPool.query(`INSERT INTO ${schema}.${table}(${columns}) SELECT ${columns} FROM public.${table} ${where}`);
}

try {
  await adminPool.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
  await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,entra_tenant_id UUID NOT NULL,entra_object_id UUID NOT NULL,
 entra_subject TEXT NOT NULL,display_name TEXT NOT NULL,email TEXT,username TEXT,role TEXT NOT NULL,role_override TEXT,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,auth_version INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE student_profiles(user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,student_code TEXT,full_name TEXT,cohort_code TEXT,
 class_name TEXT,career_goal TEXT,current_semester SMALLINT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  for (const file of before038) await pool.query(`BEGIN; ${inSchema(await readFile("apps/api/migrations/" + file, "utf8"))} COMMIT;`);
  // The configurations a revision had before 038 (new ones have no revision), with their links and history.
  await pool.query("TRUNCATE career_fields,career_positions,career_skills,career_requirements,ad_comp_groups CASCADE");
  await adminPool.query("BEGIN");
  for (const table of ["career_skills", "course_catalog"]) await copy(table);
  await copy("curricula", { exclude: ["current_revision"] });
  await copy("curriculum_revisions", { exclude: ["actor_id"] });
  await adminPool.query(`UPDATE ${schema}.curricula c SET current_revision=p.current_revision FROM public.curricula p WHERE p.id=c.id`);
  for (const table of ["curriculum_courses", "ad_comp_groups", "ad_comp_skills"]) await copy(table);
  await copy("ad_comp_course_configs", { where: "WHERE revision_id IS NOT NULL" });
  await copy("ad_comp_course_links", { where: "WHERE config_id IN (SELECT id FROM public.ad_comp_course_configs WHERE revision_id IS NOT NULL)" });
  await adminPool.query("COMMIT");
  const revision = async (cohort, version) => (await q(`SELECT r.id FROM curriculum_revisions r JOIN curricula c ON c.id=r.curriculum_id
    WHERE c.cohort_code=$1 AND r.version=$2`, [cohort, version]))[0]?.id;
  const [k29, k30, k31] = [await revision("K29", 1), await revision("K30", 2), await revision("K31", 1)];
  assert(k29 && k30 && k31, "the local curricula K29 v1, K30 v2 and K31 v1 exist");
  const configured = await count("ad_comp_course_configs WHERE revision_id=$1", [k29]);
  assert(configured >= 6, "K29 has configurations locally");
  // Five courses that K29, K30 and K31 share by code, name and credits.
  const codes = (await q(`SELECT a.code FROM curriculum_courses a
    JOIN curriculum_courses b ON b.revision_id=$2 AND b.code=a.code AND lower(b.name)=lower(a.name) AND b.credits=a.credits
    JOIN curriculum_courses c ON c.revision_id=$3 AND c.code=a.code AND lower(c.name)=lower(a.name) AND c.credits=a.credits
    JOIN ad_comp_course_configs x ON x.revision_id=a.revision_id AND x.course_code=a.code AND x.status='active'
    WHERE a.revision_id=$1 ORDER BY a.code LIMIT 5`, [k29, k31, k30])).map((row) => row.code);
  assert.equal(codes.length, 5);
  const links = async (code) => q(`SELECT l.skill_id,l.weight::float8 AS weight FROM ad_comp_course_links l JOIN ad_comp_course_configs c ON c.id=l.config_id
    WHERE c.revision_id=$1 AND c.course_code=$2 ORDER BY l.skill_id`, [k29, code]);
  const seed = async (rev, code, status, items) => {
    const id = randomUUID();
    await pool.query("BEGIN");
    await pool.query("INSERT INTO ad_comp_course_configs(id,revision_id,course_code,status) VALUES($1,$2,$3,$4)", [id, rev, code, status]);
    for (const item of items) await pool.query("INSERT INTO ad_comp_course_links(config_id,skill_id,weight) VALUES($1,$2,$3)", [id, item.skill_id, item.weight]);
    await pool.query("COMMIT");
  };
  const other = async (code) => { // the same skills with other weights, still 100%
    const rows = await links(code);
    if (rows.length === 1) return [{ skill_id: rows[0].skill_id, weight: 1 }, { skill_id: (await q(`SELECT l.skill_id FROM ad_comp_course_links l
      JOIN ad_comp_course_configs c ON c.id=l.config_id WHERE c.status='active' AND l.skill_id<>$1 ORDER BY l.skill_id LIMIT 1`, [rows[0].skill_id]))[0].skill_id, weight: 0 }];
    return rows.map((row, index) => ({ skill_id: row.skill_id, weight: index === 0 ? 1 - (rows.length - 1) * 0.01 : 0.01 }));
  };
  await seed(k31, codes[0], "active", await links(codes[0]));   // the same configuration
  await seed(k31, codes[1], "active", await other(codes[1]));   // other weights: K31 wins, K29 is noted
  await seed(k31, codes[2], "draft", await links(codes[2]));    // a newer draft: the applied K29 one wins
  await seed(k31, codes[3], "draft", []);                       // an empty draft: K29 wins
  await seed(k30, codes[4], "active", await other(codes[4]));   // three cohorts: K31 wins, K30 (different) is noted
  await seed(k31, codes[4], "active", await links(codes[4]));
  // A history entry saved before 038, keyed by "revision:code".
  await pool.query("INSERT INTO ad_comp_events(kind,entity_key,snapshot,note) VALUES('course',$1,$2,'Lưu trước khi dùng chung')",
    [`${k29}:${codes[1]}`, JSON.stringify({ revisionId: k29, courseCode: codes[1], status: "active", links: [] })]);
  const historyBefore = await count("ad_comp_events WHERE kind='course'");
  // Two pending proposals of one course in two revisions: only the newer one stays pending.
  const [older, newer] = [randomUUID(), randomUUID()];
  await pool.query(`INSERT INTO ad_comp_ai_suggestions(id,revision_id,course_code,mode,status,ai_input,prompt_version,created_at)
    VALUES($1,$2,$3,'full','queued','{}','x',now()-interval '2 minutes'),($4,$5,$3,'full','queued','{}','x',now()-interval '1 minute')`, [older, k29, codes[3], newer, k31]);
  const keys = await count(`(SELECT DISTINCT upper(btrim(code)),lower(regexp_replace(name,'[[:space:]]+','','g')),trim_scale(credits) FROM curriculum_courses) x`);
  const configsBefore = await count("ad_comp_course_configs");
  checks.push(`migrations 007-037 apply in a throwaway schema; ${configured} K29 configurations copied read-only, 6 configurations of K30/K31 added for ${codes.length} shared courses`);

  await pool.query(`BEGIN; ${inSchema(await readFile("apps/api/migrations/038_competency_shared_courses.sql", "utf8"))} COMMIT;`);
  assert.equal(await count("ad_comp_courses"), keys, "one shared course per (code, name, credits), case and spaces ignored");
  assert.equal(await count("curriculum_courses WHERE course_id IS NULL"), 0);
  const blockchain = await q("SELECT count(DISTINCT course_id)::int AS n, count(DISTINCT name)::int AS names FROM curriculum_courses WHERE code='71ITDS40503'");
  if (blockchain[0].names > 1) assert.equal(blockchain[0].n, 1, '"Block chain" and "Blockchain" are one course');
  checks.push(`038 builds ${keys} shared courses and links every curriculum row to one (names that differ only in case or spaces are one course)`);

  assert.equal(await count("ad_comp_course_configs"), configsBefore - 6, "one configuration per course");
  assert.equal(await count("(SELECT course_id FROM ad_comp_course_configs GROUP BY course_id HAVING count(*)>1) x"), 0);
  const kept = async (code) => (await q(`SELECT cu.cohort_code AS cohort,c.status,c.merged_from AS "mergedFrom",
    (SELECT json_agg(e.note ORDER BY e.created_at DESC,e.note) FROM ad_comp_events e WHERE e.kind='course' AND e.entity_key=c.course_id::text
      AND (e.note LIKE 'Dùng chung%' OR e.note LIKE 'Cấu hình riêng%')) AS notes
    FROM ad_comp_course_configs c JOIN curriculum_revisions r ON r.id=c.revision_id JOIN curricula cu ON cu.id=r.curriculum_id
    JOIN curriculum_courses cc ON cc.revision_id=$1 AND cc.code=$2 AND cc.course_id=c.course_id`, [k29, code]))[0];
  const same = await kept(codes[0]);
  assert.deepEqual([same.cohort, same.status, same.mergedFrom, same.notes.length], ["K31", "active", [], 2], "the same configuration: the newest cohort is kept, no note");
  const newer31 = await kept(codes[1]);
  assert.deepEqual([newer31.cohort, newer31.mergedFrom], ["K31", ["K29 · phiên bản 1"]]);
  assert.match(newer31.notes[0], /^Dùng chung cấu hình của K31 · phiên bản 1 cho mọi khóa có môn học này \(gộp 2 cấu hình theo khóa\)\.$/);
  assert.match(newer31.notes[1], /^Cấu hình riêng của K29 · phiên bản 1 trước khi dùng chung môn học; được thay bằng cấu hình của K31 · phiên bản 1\.$/);
  const draft = await kept(codes[2]);
  assert.deepEqual([draft.cohort, draft.status, draft.mergedFrom], ["K29", "active", ["K31 · phiên bản 1"]], "an applied configuration wins over a newer draft");
  const emptyDraft = await kept(codes[3]);
  assert.deepEqual([emptyDraft.cohort, emptyDraft.mergedFrom], ["K29", ["K31 · phiên bản 1"]], "an empty draft never replaces links");
  const three = await kept(codes[4]);
  // K31 has the very configuration of K29, so only K30's differs.
  assert.deepEqual([three.cohort, three.mergedFrom, three.notes.length], ["K31", ["K30 · phiên bản 2"], 3]);
  checks.push("the merge keeps the newest cohort's configuration (an applied one first, then one with links), notes the cohorts whose configuration differed and writes every merged one to the course's history");

  assert.equal(await count("ad_comp_events WHERE kind='course' AND position(':' IN entity_key)>0"), 0, "no history entry keeps the revision:code key");
  assert.equal(await count(`ad_comp_events e JOIN curriculum_courses cc ON cc.course_id::text=e.entity_key AND cc.revision_id=$1 AND cc.code=$2
    WHERE e.note='Lưu trước khi dùng chung'`, [k29, codes[1]]), 1, "an entry saved before 038 now belongs to the shared course");
  assert.equal(await count("ad_comp_events WHERE kind='course'"), historyBefore + 2 + 2 + 2 + 2 + 3, "one entry per merged configuration");
  assert.deepEqual((await q("SELECT id,status FROM ad_comp_ai_suggestions WHERE id=ANY($1::uuid[]) ORDER BY created_at", [[older, newer]])).map((row) => row.status),
    ["cancelled", "queued"], "one pending proposal per course and mode");
  assert.equal(await count("ad_comp_ai_suggestions WHERE mode<>'skills' AND course_id IS NULL"), 0);
  checks.push("history entries are keyed by the shared course; of two pending AI proposals of one course the older is cancelled");

  // The curriculum trigger: the same three (other case, spaces, trailing zeros) reuse the course; another name or credits add one.
  const k32 = await revision("K32", 3);
  const sample = (await q(`SELECT code,name,credits,course_id FROM curriculum_courses a WHERE revision_id=$1
    AND NOT EXISTS(SELECT 1 FROM curriculum_courses b WHERE b.revision_id=$2 AND b.code=a.code) ORDER BY code LIMIT 1`, [k29, k32]))[0];
  const courses = await count("ad_comp_courses");
  const added = (await q(`INSERT INTO curriculum_courses(revision_id,code,position,name,credits,course_type,block,specialty,data)
    VALUES($1,$2,999,$3,$4,'BB','x','','{}') RETURNING course_id`, [k32, sample.code, `  ${sample.name.toUpperCase().replace(/ /g, "   ")} `, Number(sample.credits).toFixed(2)]))[0];
  assert.equal(added.course_id, sample.course_id, "the same course is reused");
  assert.equal(await count("ad_comp_courses"), courses);
  assert.deepEqual((await q("SELECT name,credits::text FROM ad_comp_courses WHERE id=$1", [sample.course_id]))[0],
    { name: sample.name.toUpperCase().replace(/\s+/g, " "), credits: String(Number(sample.credits)) }, "the newest import gives the spelling, spaces collapsed");
  const renamed = (await q("UPDATE curriculum_courses SET name=name||' nâng cao' WHERE revision_id=$1 AND position=999 RETURNING course_id", [k32]))[0];
  assert.notEqual(renamed.course_id, sample.course_id, "another name is another course");
  const credits = (await q("UPDATE curriculum_courses SET name=$2,credits=credits+1 WHERE revision_id=$1 AND position=999 RETURNING course_id", [k32, sample.name]))[0];
  assert.notEqual(credits.course_id, sample.course_id, "other credits are another course");
  assert.equal(await count("ad_comp_courses"), courses + 2);
  await assert.rejects(pool.query("UPDATE ad_comp_course_configs SET course_id=$1 WHERE id=(SELECT id FROM ad_comp_course_configs ORDER BY id LIMIT 1)", [credits.course_id]),
    (error) => error.constraint === "competency_scope_immutable");
  checks.push("a curriculum row with the same code, name and credits (other case, spaces, trailing zeros) reuses the course; another name or credits add one; a configuration cannot move to another course");

  // 039: a course that only an older revision has loses its live configuration (archived, with history).
  const oldOnly = (await q(`SELECT x.id FROM ad_comp_courses x WHERE NOT EXISTS(SELECT 1 FROM curriculum_courses cc
    JOIN curricula cu ON cu.current_revision=cc.revision_id WHERE cc.course_id=x.id) ORDER BY x.code,x.id`)).map((row) => row.id);
  assert(oldOnly.length >= 2, "some courses exist only in older revisions locally");
  const liveSkill = (await q(`SELECT l.skill_id FROM ad_comp_course_links l JOIN ad_comp_course_configs c ON c.id=l.config_id
    WHERE c.status='active' ORDER BY l.skill_id LIMIT 1`))[0].skill_id;
  for (const [index, status] of ["active", "draft"].entries()) {
    const id = randomUUID();
    await pool.query("BEGIN");
    await pool.query("INSERT INTO ad_comp_course_configs(id,course_id,status) VALUES($1,$2,$3)", [id, oldOnly[index], status]);
    await pool.query("INSERT INTO ad_comp_course_links(config_id,skill_id,weight) VALUES($1,$2,1)", [id, liveSkill]);
    await pool.query("COMMIT");
  }
  const appliedBefore = await count("ad_comp_course_configs WHERE status='active'");
  await pool.query(`BEGIN; ${inSchema(await readFile("apps/api/migrations/039_competency_newest_revisions.sql", "utf8"))} COMMIT;`);
  const note = "Lưu trữ vì môn học không còn trong CTĐT mới nhất của khóa nào.";
  assert.deepEqual((await q("SELECT status FROM ad_comp_course_configs WHERE course_id=ANY($1::uuid[])", [oldOnly.slice(0, 2)])).map((row) => row.status), ["archived", "archived"]);
  assert.equal(await count("ad_comp_course_configs WHERE status='active'"), appliedBefore - 1, "only the hidden applied configuration is archived");
  assert.equal(await count("ad_comp_events WHERE note=$1 AND entity_key=ANY($2::text[])", [note, oldOnly.slice(0, 2)]), 2, "each archived configuration gets a history entry");
  checks.push(`039 archives the live configurations of courses that only older revisions have (${oldOnly.length} such courses locally), with a history entry each; applied configurations of the newest revisions stay`);

  // An import that makes a new revision current archives the courses it drops, unless another cohort's newest revision has them.
  const k29Curriculum = (await q("SELECT id,current_revision AS revision FROM curricula WHERE cohort_code='K29' ORDER BY id LIMIT 1"))[0];
  const applied = (others) => q(`SELECT cc.code,cc.course_id AS "courseId" FROM curriculum_courses cc
    JOIN ad_comp_course_configs cfg ON cfg.course_id=cc.course_id AND cfg.status='active' WHERE cc.revision_id=$1
    AND ${others ? "" : "NOT "}EXISTS(SELECT 1 FROM curriculum_courses o JOIN curricula cu ON cu.current_revision=o.revision_id
      WHERE o.course_id=cc.course_id AND cu.id<>$2) ORDER BY cc.code LIMIT 1`, [k29Curriculum.revision, k29Curriculum.id]);
  const [onlyK29] = await applied(false), [sharedK29] = await applied(true);
  assert(onlyK29 && sharedK29, "K29 has an applied course of its own and one that another cohort shares");
  const nextRevision = randomUUID();
  await pool.query(`INSERT INTO curriculum_revisions(id,curriculum_id,version,data,source_filename,source_data,source_sha256,change_note)
    SELECT $1,curriculum_id,version+1,data,'audit.xlsx',source_data,source_sha256,'audit' FROM curriculum_revisions WHERE id=$2`, [nextRevision, k29Curriculum.revision]);
  await pool.query(`INSERT INTO curriculum_courses(revision_id,code,position,name,credits,course_type,semester,study_year,block,specialty,data)
    SELECT $1,code,position,name,credits,course_type,semester,study_year,block,specialty,data FROM curriculum_courses
    WHERE revision_id=$2 AND code<>ALL($3::text[])`, [nextRevision, k29Curriculum.revision, [onlyK29.code, sharedK29.code]]);
  const appliedBeforeImport = await count("ad_comp_course_configs WHERE status='active'");
  await pool.query("UPDATE curricula SET current_revision=$2 WHERE id=$1", [k29Curriculum.id, nextRevision]);
  assert.equal((await q("SELECT status FROM ad_comp_course_configs WHERE course_id=$1", [onlyK29.courseId]))[0].status, "archived", "a course no newest revision has any more is archived");
  assert.equal((await q("SELECT status FROM ad_comp_course_configs WHERE course_id=$1", [sharedK29.courseId]))[0].status, "active", "a course another cohort's newest revision has stays applied");
  assert.equal(await count("ad_comp_course_configs WHERE status='active'"), appliedBeforeImport - 1);
  assert.equal(await count("ad_comp_events WHERE note=$1 AND entity_key=$2", [note, onlyK29.courseId]), 1);
  checks.push(`a new K29 revision without ${onlyK29.code} archives that course's configuration; ${sharedK29.code}, which another cohort's newest revision still has, stays applied`);

  // 041 (2026-10-23): a spelling of the same code ("Anh Văn 1" next to "Anh văn 1 (AV1)", "Giáo dục quốc phòng 1"
  // 0 TC next to "GDQP1: …" 3 TC) is merged into the configured course and joins it on a later import.
  for (const file of ["040_competency_skill_groups.sql", "041_competency_course_aliases.sql"])
    await pool.query(`BEGIN; ${inSchema(await readFile("apps/api/migrations/" + file, "utf8"))} COMMIT;`);
  const target = (await q(`SELECT x.id,x.code,x.name FROM ad_comp_courses x JOIN ad_comp_course_configs cfg ON cfg.course_id=x.id AND cfg.status='active'
    WHERE EXISTS(SELECT 1 FROM curriculum_courses cc JOIN curricula cu ON cu.current_revision=cc.revision_id WHERE cc.course_id=x.id) ORDER BY x.code LIMIT 1`))[0];
  // One throwaway K32 revision per row (a revision has a code once).
  const addRow = async (version) => {
    const revisionId = randomUUID();
    await pool.query(`INSERT INTO curriculum_revisions(id,curriculum_id,version,data,source_filename,source_data,source_sha256,change_note)
      SELECT $1,curriculum_id,$3,data,'audit.xlsx',source_data,source_sha256,'audit' FROM curriculum_revisions WHERE id=$2`, [revisionId, k32, version]);
    return (await q(`INSERT INTO curriculum_courses(revision_id,code,position,name,credits,course_type,block,specialty,data)
      VALUES($1,$2,1,$3,0,'BB','x','','{}') RETURNING course_id`, [revisionId, target.code, `${target.name} (biến thể)`]))[0].course_id;
  };
  const variant = await addRow(998);
  assert.notEqual(variant, target.id, "another spelling and other credits are another course before a merge");
  const proposal = randomUUID();
  await pool.query(`INSERT INTO ad_comp_ai_suggestions(id,course_id,revision_id,course_code,mode,status,ai_input,prompt_version)
    VALUES($1,$2,$3,$4,'links','queued','{}','x')`, [proposal, variant, k32, target.code]);
  const coursesBeforeMerge = await count("ad_comp_courses");
  await assert.rejects(pool.query("SELECT ad_comp_merge_course($1,$2,'x')", [target.id, variant]), (error) => error.constraint === "course_merge_source_configured");
  const otherCode = (await q("SELECT id FROM ad_comp_courses WHERE code<>$1 ORDER BY id LIMIT 1", [target.code]))[0].id;
  await assert.rejects(pool.query("SELECT ad_comp_merge_course($1,$2,'x')", [variant, otherCode]), (error) => error.constraint === "course_merge_other_code");
  await pool.query("SELECT ad_comp_merge_course($1,$2,$3)", [variant, target.id, "Gộp môn kiểm thử"]);
  assert.equal(await count("ad_comp_courses"), coursesBeforeMerge - 1, "the merged course is removed");
  assert.equal(await count("curriculum_courses cc JOIN curriculum_revisions r ON r.id=cc.revision_id WHERE r.version=998 AND cc.course_id=$1", [target.id]), 1,
    "its curriculum row joins the course");
  assert.deepEqual((await q("SELECT status,course_id AS \"courseId\" FROM ad_comp_ai_suggestions WHERE id=$1", [proposal]))[0],
    { status: "cancelled", courseId: target.id }, "its pending AI proposal is cancelled and kept with the course");
  assert.equal(await count(`ad_comp_events WHERE kind='course' AND entity_key=$1 AND note='Gộp môn kiểm thử'
    AND snapshot->'mergedCourse'->>'courseId'=$2 AND snapshot->'mergedCourse'->'cohorts'='["K32"]'`, [target.id, variant]), 1, "the course's history notes the merge");
  assert.equal(await addRow(997), target.id, "importing the merged spelling again joins the course");
  assert.equal((await q("SELECT name FROM ad_comp_courses WHERE id=$1", [target.id]))[0].name, target.name, "the course keeps its displayed spelling");
  assert.equal(await count("ad_comp_courses"), coursesBeforeMerge - 1);
  checks.push(`041 merges a spelling of ${target.code} with other credits into the configured course (not the other way round, never another code): rows and AI proposals follow, the history notes it, and a later import of that spelling joins the course`);
  console.log(checks.map((check) => `PASS ${check}`).join("\n"));
} finally {
  await pool.end();
  if (schemaCreated) await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  const leftover = await adminPool.query("SELECT nspname FROM pg_namespace WHERE nspname=$1", [schema]);
  await adminPool.end();
  assert.equal(leftover.rowCount, 0, "the audit schema must be dropped");
}
