import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { readCareerCatalog } from "../career-guidance/router.js";
import { readRealCourseRows } from "../curricula/real-codes.js";
import { resolveCohortStandard } from "../graduation/resolve.js";
import { copyOf, createReferenceCache, readsOnlyReference, snapshotReads } from "./reference-cache.js";
import { PROFILE_SQL, TRANSCRIPT_SQL } from "./student-rows.js";

/** The SQL a reader sends, each answered with no rows. */
async function sqlOf(read: (db: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> }) => Promise<unknown>) {
  const texts: string[] = [];
  await read({ query: async (text: string) => { texts.push(text); return { rows: [], rowCount: 0 }; } });
  return texts;
}

describe("readsOnlyReference", () => {
  it("accepts the reference reads of the student pages, from their own readers", async () => {
    const reads = [
      ...await sqlOf((db) => readCareerCatalog(db as never)),
      ...await sqlOf((db) => resolveCohortStandard(db as never, "K29", "CNPM", "7480201")),
      ...await sqlOf((db) => readRealCourseRows(db as never, ["00000000-0000-4000-8000-000000000001"])),
      "SELECT code,name FROM career_fields WHERE deleted_at IS NULL ORDER BY code::bigint,id",
      `SELECT COALESCE(rc.real_code,cc.code) AS course_code,l.skill_id,l.weight FROM curriculum_courses cc
        LEFT JOIN jsonb_to_recordset($2::jsonb) AS rc(revision_id uuid,code text,real_code text,course_id uuid)
          ON rc.revision_id=cc.revision_id AND rc.code=upper(btrim(cc.code))
       JOIN ad_comp_course_configs cfg ON cfg.course_id=COALESCE(rc.course_id,cc.course_id) AND cfg.status='active'
       JOIN ad_comp_course_links l ON l.config_id=cfg.id
       WHERE cc.revision_id=$1 AND l.weight>0 ORDER BY 1,l.skill_id`,
      `SELECT s.skill_id,k.name,k.description,left(s.scope,$1) AS scope,s.group_id,
         ARRAY(SELECT m.group_id FROM ad_comp_skill_groups m JOIN ad_comp_groups o ON o.id=m.group_id AND o.is_active
           WHERE m.skill_id=s.skill_id AND m.group_id<>s.group_id ORDER BY o.name,o.id) AS other_group_ids
       FROM ad_comp_skills s JOIN career_skills k ON k.id=s.skill_id JOIN ad_comp_groups g ON g.id=s.group_id
       WHERE s.is_active AND s.deleted_at IS NULL AND k.deleted_at IS NULL AND g.is_active ORDER BY k.name,s.skill_id`,
      `WITH sections AS (
         SELECT DISTINCT ON (r.id,s.value->>'id') r.id AS revision_id,s.value->>'id' AS id,s.value->>'label' AS label
         FROM training_plans tp JOIN training_plan_revisions r ON r.id=tp.current_revision
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.data->'sections')='array' THEN r.data->'sections' ELSE '[]'::jsonb END)
           WITH ORDINALITY AS s(value,position)
         WHERE tp.is_active ORDER BY r.id,s.value->>'id',s.position)
       SELECT tp.cohort_code,split_part(tp.identity_key, ':', 1) AS major_key,i.code,i.name,i.term_code,sections.label AS section_label
       FROM training_plans tp JOIN training_plan_items i ON i.revision_id=tp.current_revision
       LEFT JOIN sections ON sections.revision_id=tp.current_revision AND sections.id=i.section_id
       WHERE tp.is_active ORDER BY tp.cohort_code,i.position`,
      `SELECT c.cohort_code FROM curricula c WHERE c.is_active AND NOT EXISTS (SELECT 1 FROM training_plans tp WHERE tp.is_active
         AND tp.cohort_code=c.cohort_code) ORDER BY c.cohort_code`,
      "SELECT code,name FROM course_catalog WHERE upper(btrim(code))=ANY($1::text[]) ORDER BY code",
      "SELECT id FROM ONLY curricula",
      "SELECT x.code FROM public.\"curricula\" x -- a note naming student_profiles\nWHERE x.note <> 'FROM student_profiles'",
    ];
    expect(reads.length).toBeGreaterThanOrEqual(10);
    for (const sql of reads) expect({ sql, reference: readsOnlyReference(sql) }).toEqual({ sql, reference: true });
  });

  it("refuses every read that may touch a student's rows, lock, change or depend on the moment", () => {
    const refused = [
      PROFILE_SQL, TRANSCRIPT_SQL,
      "SELECT data FROM stu_study_plans WHERE user_id=$1",
      // A reference table joined to a student's table, in every way a relation can come in.
      `SELECT p.cohort_code,c.name_vi AS career FROM student_profiles p LEFT JOIN career_positions c ON c.id=p.career_position_id WHERE p.user_id=$1`,
      "SELECT c.name_vi FROM career_positions c, student_profiles p WHERE p.career_position_id=c.id",
      "SELECT c.name_vi FROM career_positions c JOIN career_fields f ON f.code=c.category, stu_comp_assessments a WHERE a.user_id=$1",
      "SELECT c.name_vi FROM career_positions c JOIN career_fields f USING (code), users u",
      "SELECT c.id FROM career_positions c WHERE c.id IN (SELECT career_position_id FROM student_profiles)",
      "SELECT (SELECT count(*) FROM stu_roadmaps) AS n FROM career_fields",
      "SELECT c.id FROM career_positions c WHERE EXISTS (SELECT 1 FROM data_consents d WHERE d.user_id=$1)",
      "SELECT x.id FROM career_positions x JOIN LATERAL (SELECT * FROM stu_notifications n) s ON true",
      "WITH mine AS (SELECT * FROM student_transcripts) SELECT * FROM mine JOIN curricula c ON true",
      "SELECT * FROM e2e.student_profiles", "SELECT * FROM \"student_profiles\"", "SELECT * FROM ONLY student_profiles", "TABLE curricula",
      // Locks, writes, several statements, the moment, and the app's own SQL functions.
      "SELECT id FROM curricula FOR UPDATE", "SELECT id FROM curricula FOR SHARE",
      "WITH moved AS (UPDATE curricula SET is_active=false RETURNING id) SELECT id FROM moved",
      "SELECT 1 FROM curricula; SELECT 1 FROM student_profiles",
      "SELECT id FROM curricula WHERE created_at > now() - interval '1 day'", "SELECT current_date FROM curricula",
      "SELECT random() FROM career_fields", "SELECT ad_comp_course_key(code) FROM curriculum_courses",
      "SELECT edupath_major_of(code) FROM curricula", "SELECT * FROM my_table_function($1)", "SELECT 1", "INSERT INTO curricula SELECT * FROM curricula",
      "SAVEPOINT x", "",
    ];
    for (const sql of refused) expect({ sql, reference: readsOnlyReference(sql) }).toEqual({ sql, reference: false });
  });
});

describe("createReferenceCache", () => {
  const rows = (value: unknown) => vi.fn(async () => ({ value, at: new Date("2026-11-10T00:00:00Z"), bytes: Buffer.from("ab") }));

  it("answers a key from memory until it expires, each reader with its own copy", async () => {
    let clock = 1_000;
    const cache = createReferenceCache({ maxAgeMs: 60_000, now: () => clock });
    const load = rows([1, 2]);
    const first = await cache.reader().read("k", load);
    first.value = "changed by the first caller";
    const second = await cache.reader().read("k", load);
    expect(load).toHaveBeenCalledOnce();
    expect(second).toEqual({ value: [1, 2], at: new Date("2026-11-10T00:00:00Z"), bytes: Buffer.from("ab") });
    expect(Buffer.isBuffer(second.bytes) && second.at instanceof Date).toBe(true);
    (second.value as number[]).push(3);
    expect((await cache.reader().read("k", load)).value).toEqual([1, 2]);
    // After maxAgeMs a change made outside the app shows.
    clock += 60_000;
    await cache.reader().read("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("forgets everything on invalidate, and keeps nothing a reader loaded before a write", async () => {
    const cache = createReferenceCache();
    const load = rows("old");
    await cache.reader().read("k", load);
    cache.invalidate();
    expect(cache.size()).toBe(0);
    await cache.reader().read("k", load);
    expect(load).toHaveBeenCalledTimes(2);
    // A reader created before a write may have read the rows before it (its snapshot): its value is not kept.
    const early = cache.reader();
    cache.invalidate();
    await early.read("late", rows("before the write"));
    expect(cache.size()).toBe(0);
    const fresh = rows("after the write");
    expect((await cache.reader().read("late", fresh)).value).toBe("after the write");
    expect(fresh).toHaveBeenCalledOnce();
  });

  it("keeps at most maxEntries keys, the oldest go first", async () => {
    const cache = createReferenceCache({ maxEntries: 2 });
    for (const key of ["a", "b", "c"]) await cache.reader().read(key, rows(key));
    expect(cache.size()).toBe(2);
    const again = rows("a");
    await cache.reader().read("a", again);
    expect(again).toHaveBeenCalledOnce();
  });

  it("is emptied by every write request to the admin API when it starts and when it ends, never by a read", async () => {
    const cache = createReferenceCache();
    const app = express();
    let duringWrite = -1;
    app.use("/api/admin", cache.invalidateOnWrite);
    app.get("/api/admin/careers", (_req, res) => { res.json({ ok: true }); });
    app.post("/api/admin/careers", async (_req, res) => {
      // A page reading meanwhile may see the rows before this write commits: what it keeps goes when the write ends.
      await cache.reader().read("during", rows("before commit"));
      duringWrite = cache.size();
      res.status(201).json({ ok: true });
    });
    const fill = async () => { await cache.reader().read("k", rows("v")); expect(cache.size()).toBeGreaterThan(0); };
    await fill();
    await request(app).get("/api/admin/careers").expect(200);
    expect(cache.size()).toBe(1);
    await request(app).post("/api/admin/careers").expect(201);
    expect(duringWrite).toBe(1);
    expect(cache.size()).toBe(0);
    await fill();
    await request(app).delete("/api/admin/careers/x").expect(404);
    expect(cache.size()).toBe(0);
  });
});

describe("snapshotReads", () => {
  function client() {
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes("fails")) throw new Error("query failed");
      return { rows: [{ text, values: values ?? null, data: { nested: [1] } }], rowCount: 1, command: "SELECT" };
    });
    return { query, sent: () => query.mock.calls.map(([text]) => text) };
  }

  it("reads reference tables through the cache, shared by the requests that come after", async () => {
    const cache = createReferenceCache();
    const first = client();
    const catalog = "SELECT code,name FROM career_fields WHERE deleted_at IS NULL ORDER BY code::bigint,id";
    const a = await snapshotReads(first, cache.reader()).query(catalog);
    const second = client();
    const b = await snapshotReads(second, cache.reader()).query(catalog);
    expect(b.rows).toEqual(a.rows);
    expect(second.query).not.toHaveBeenCalled();
    // Without a cache, or for another student's parameters, it asks the database.
    await snapshotReads(second).query(catalog);
    await snapshotReads(second, cache.reader()).query("SELECT code,name FROM course_catalog WHERE upper(btrim(code))=ANY($1::text[]) ORDER BY code", [["X"]]);
    expect(second.query).toHaveBeenCalledTimes(2);
  });

  it("asks a student's read once per snapshot, each caller with its own copy; a failed one is asked again", async () => {
    const db = client();
    const reads = snapshotReads(db, createReferenceCache().reader());
    const first = await reads.query(TRANSCRIPT_SQL, ["u1"]);
    (first.rows[0] as { data: { nested: number[] } }).data.nested.push(2);
    const again = await reads.query(TRANSCRIPT_SQL, ["u1"]);
    expect(again.rows[0]).toMatchObject({ data: { nested: [1] } });
    await reads.query(TRANSCRIPT_SQL, ["u2"]);
    await reads.query(PROFILE_SQL, ["u1"]);
    expect(db.sent()).toEqual([TRANSCRIPT_SQL, TRANSCRIPT_SQL, PROFILE_SQL]);
    await expect(reads.query("SELECT fails FROM stu_x")).rejects.toThrow("query failed");
    await expect(reads.query("SELECT fails FROM stu_x")).rejects.toThrow("query failed");
    expect(db.query).toHaveBeenCalledTimes(5);
    // Nothing is shared between two snapshots.
    await snapshotReads(db).query(TRANSCRIPT_SQL, ["u1"]);
    expect(db.query).toHaveBeenCalledTimes(6);
  });

  it("asks the reads again after any other statement, never after a savepoint", async () => {
    const db = client();
    const reads = snapshotReads(db);
    await reads.query(PROFILE_SQL, ["u1"]);
    await reads.query("SAVEPOINT s1");
    await reads.query(PROFILE_SQL, ["u1"]);
    await reads.query("RELEASE SAVEPOINT s1");
    await reads.query(PROFILE_SQL, ["u1"]);
    expect(db.sent()).toEqual([PROFILE_SQL]);
    await reads.query("SET LOCAL statement_timeout = 1000");
    await reads.query(PROFILE_SQL, ["u1"]);
    expect(db.sent()).toEqual([PROFILE_SQL, "SET LOCAL statement_timeout = 1000", PROFILE_SQL]);
  });

  it("sends a savepoint only before a statement that reaches the database, in order", async () => {
    const db = client();
    const reads = snapshotReads(db);
    await reads.query(PROFILE_SQL, ["u1"]);
    // Nothing reached the database inside: neither the savepoint nor its release is sent.
    await reads.query("SAVEPOINT overview_planner");
    await reads.query(PROFILE_SQL, ["u1"]);
    await reads.query("RELEASE SAVEPOINT overview_planner");
    // Rolled back to before anything ran: nothing to send either.
    await reads.query("SAVEPOINT a");
    await reads.query("ROLLBACK TO SAVEPOINT a");
    await reads.query("RELEASE SAVEPOINT a");
    expect(db.sent()).toEqual([PROFILE_SQL]);
    // A read that goes to the database inside sends the savepoint first; a failure inside is rolled back on the database.
    await reads.query("SAVEPOINT b");
    await expect(reads.query("SELECT fails FROM stu_x")).rejects.toThrow();
    await reads.query("ROLLBACK TO SAVEPOINT b");
    await reads.query("RELEASE SAVEPOINT b");
    expect(db.sent()).toEqual([PROFILE_SQL, "SAVEPOINT b", "SELECT fails FROM stu_x", "ROLLBACK TO SAVEPOINT b", "RELEASE SAVEPOINT b"]);
  });

  it("copies rows deeply, buffers and dates included", () => {
    const value = { at: new Date(5), bytes: Buffer.from([1, 2]), list: [{ a: 1 }], none: null };
    const copy = copyOf(value);
    expect(copy).toEqual(value);
    expect(copy.list[0]).not.toBe(value.list[0]);
    expect(Buffer.isBuffer(copy.bytes) && copy.bytes !== value.bytes && copy.at !== value.at).toBe(true);
  });
});
