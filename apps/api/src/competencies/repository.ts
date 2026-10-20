import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { access, fold, lockSkillCatalog } from "../careers/shared.js";
import { refreshCareerSkills } from "../careers/requirements.js";
import { CompetencyError, validateWeights, WEIGHT_TOLERANCE } from "./model.js";

type Database = DatabasePool | PoolClient;
type GroupChange = { name: string; description: string; isActive: boolean };
type SkillChange = { name: string; description: string; scope: string; groupId: string; isActive: boolean };
type ConfigurationChange = { status: "draft" | "active"; links: { skillId: string; weight: number }[]; note?: string };
type Group = { id: string; name: string; description: string; isActive: boolean; version: string; skillCount: number };
type Skill = { id: string; name: string; description: string; scope: string; legacySkillId: string | null; groupId: string; groupName: string; isActive: boolean; groupActive: boolean; version: string; careerCount: number; courseCount: number };
type CourseLink = { skillId: string; skillName: string; groupId: string; groupName: string; isActive: boolean; weight: number };
type CourseStatus = "draft" | "active" | "archived" | "missing";
/** One shared course ("môn học") with its configuration; `cohorts` have it in their newest CTĐT revision. */
type CourseRow = { id: string; code: string; name: string; credits: number; type: string; block: string; specialty: string;
  cohorts: string[]; configId: string | null; status: CourseStatus; version: string | null; note: string;
  mergedFrom: string[]; skillCount: number; totalWeight: number };
type Warning = { code: string; message: string; courseCode?: string };

const groupColumns = `g.id,g.name,g.description,g.is_active AS "isActive",g.version,
 (SELECT count(*)::int FROM ad_comp_skills cs WHERE cs.group_id=g.id AND cs.deleted_at IS NULL) AS "skillCount"`;
const skillColumns = `s.id,s.name,s.description,cs.scope,cs.legacy_skill_id AS "legacySkillId",cs.group_id AS "groupId",g.name AS "groupName",
 cs.is_active AS "isActive",g.is_active AS "groupActive",cs.version,
 (SELECT count(DISTINCT r.career_position_id)::int FROM career_requirements r
  JOIN career_positions p ON p.id=r.career_position_id
  WHERE r.skill_id=s.id AND r.deleted_at IS NULL AND p.deleted_at IS NULL) AS "careerCount",
 (SELECT count(*)::int FROM ad_comp_course_links l JOIN ad_comp_course_configs c ON c.id=l.config_id
  WHERE l.skill_id=s.id AND c.status='active' AND l.weight>0) AS "courseCount"`;
const skillTables = `FROM ad_comp_skills cs JOIN career_skills s ON s.id=cs.skill_id
 JOIN ad_comp_groups g ON g.id=cs.group_id`;
/** Newest cohort first ("K32" before "K29"). */
const cohortOrder = (column: string) => `NULLIF(regexp_replace(${column},'\\D','','g'),'')::int DESC NULLS LAST,${column} DESC`;
/** What the admin types to clear the links of every course (no cohort filter). */
export const ALL_COURSES_CONFIRMATION = "TẤT CẢ";

export class CompetencyRepository {
  constructor(readonly pool: DatabasePool) {}

  async access(actor: AuthenticatedUser) {
    await access(this.pool, actor, false);
  }

  /** A write transaction with the role re-checked and the skill catalog lock held (used by the AI apply too). */
  transaction<T>(actor: AuthenticatedUser, action: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.write(actor, action);
  }

  private async write<T>(actor: AuthenticatedUser, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await access(client, actor, true, false, true);
      // The same lock is held by career skill renames/deletions and requirement writes.
      await lockSkillCatalog(client);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async event(db: Database, kind: "group" | "skill" | "course", key: string, actor: AuthenticatedUser, snapshot: unknown, note: string) {
    await db.query(`INSERT INTO ad_comp_events(kind,entity_key,actor_id,snapshot,note)
 VALUES($1,$2,$3,$4::jsonb,$5)`, [kind, key, actor.userId, JSON.stringify(snapshot), note]);
  }

  private async history(db: Database, kinds: string[], key: string) {
    const result = await db.query(`SELECT e.id,e.note,e.created_at AS "createdAt",
 u.display_name AS "actorName",e.snapshot FROM ad_comp_events e LEFT JOIN users u ON u.id=e.actor_id
 WHERE e.kind=ANY($1::text[]) AND e.entity_key=$2 ORDER BY e.created_at DESC,e.id DESC`, [kinds, key]);
    return result.rows;
  }

  async groups() {
    return (await this.pool.query<Group>(`SELECT ${groupColumns} FROM ad_comp_groups g WHERE g.deleted_at IS NULL ORDER BY g.name,g.id`)).rows;
  }

  private async groupRecord(db: Database, id: string) {
    const result = await db.query<Group>(`SELECT ${groupColumns} FROM ad_comp_groups g WHERE g.id=$1 AND g.deleted_at IS NULL`, [id]);
    if (!result.rowCount) throw new CompetencyError("group_not_found", 404);
    return result.rows[0]!;
  }

  private async groupSnapshot(db: Database, id: string) {
    const group = await this.groupRecord(db, id);
    const skills = await db.query<Skill>(`SELECT ${skillColumns} ${skillTables}
 WHERE cs.group_id=$1 AND cs.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.name,s.id`, [id]);
    return { ...group, skills: skills.rows };
  }

  async group(id: string) {
    return { ...await this.groupSnapshot(this.pool, id), history: await this.history(this.pool, ["group"], id) };
  }

  async createGroup(data: GroupChange, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const result = await client.query<{ id: string }>(`INSERT INTO ad_comp_groups(name,description,is_active)
 VALUES($1,$2,$3) RETURNING id`, [data.name, data.description, data.isActive]);
      const snapshot = await this.groupSnapshot(client, result.rows[0]!.id);
      await this.event(client, "group", snapshot.id, actor, snapshot, "Thêm nhóm năng lực");
      return snapshot;
    });
  }

  async updateGroup(id: string, version: string, data: GroupChange, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const current = await client.query<{ version: string }>("SELECT version FROM ad_comp_groups WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id]);
      if (!current.rowCount) throw new CompetencyError("group_not_found", 404);
      if (current.rows[0]!.version !== version) throw new CompetencyError("group_changed", 409);
      if (!data.isActive) {
        const used = await client.query(`SELECT 1 FROM ad_comp_course_links l
 JOIN ad_comp_course_configs c ON c.id=l.config_id JOIN ad_comp_skills cs ON cs.skill_id=l.skill_id
 WHERE cs.group_id=$1 AND c.status='active' LIMIT 1`, [id]);
        if (used.rowCount) throw new CompetencyError("group_in_use", 409);
      }
      await client.query(`UPDATE ad_comp_groups SET name=$2,description=$3,is_active=$4,version=$5,updated_at=now()
 WHERE id=$1`, [id, data.name, data.description, data.isActive, randomUUID()]);
      const snapshot = await this.groupSnapshot(client, id);
      await this.event(client, "group", id, actor, snapshot, "Cập nhật nhóm năng lực");
      return snapshot;
    });
  }

  /**
   * "Xóa nhóm năng lực": soft delete once no live skill profile uses the group (soft-deleted profiles
   * keep pointing to it). The group also becomes inactive, so scoring and the career pages, which
   * read is_active, never see it again.
   */
  async deleteGroup(id: string, version: string, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const current = await client.query<{ version: string }>("SELECT version FROM ad_comp_groups WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id]);
      if (!current.rowCount) throw new CompetencyError("group_not_found", 404);
      if (current.rows[0]!.version !== version) throw new CompetencyError("group_changed", 409);
      const skills = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM ad_comp_skills WHERE group_id=$1 AND deleted_at IS NULL", [id]);
      const count = skills.rows[0]?.count ?? 0;
      if (count) throw new CompetencyError("group_not_empty", 409, [`Nhóm còn ${count} kỹ năng.`]);
      const previous = await this.groupSnapshot(client, id);
      const nextVersion = randomUUID();
      const removed = await client.query<{ deletedAt: string }>(`UPDATE ad_comp_groups SET deleted_at=now(),is_active=false,version=$2,updated_at=now()
 WHERE id=$1 RETURNING deleted_at AS "deletedAt"`, [id, nextVersion]);
      await this.event(client, "group", id, actor, { ...previous, isActive: false, version: nextVersion, deletedAt: removed.rows[0]!.deletedAt }, "Xóa nhóm năng lực");
      return { deleted: true };
    });
  }

  async catalog() {
    return (await this.pool.query(`SELECT id,name,description,version FROM career_skills
 WHERE deleted_at IS NULL ORDER BY name,id`)).rows;
  }

  async skills(query: { q: string; groupId: string; active: "" | "true" | "false" }) {
    const result = await this.pool.query<Skill>(`SELECT ${skillColumns} ${skillTables}
 WHERE cs.deleted_at IS NULL AND s.deleted_at IS NULL AND ($1='' OR cs.group_id=NULLIF($1,'')::uuid)
 AND ($2='' OR cs.is_active=($2='true')) ORDER BY s.name,s.id`, [query.groupId, query.active]);
    const term = fold(query.q);
    return result.rows.filter(row => fold(`${row.name} ${row.description} ${row.scope} ${row.groupName}`).includes(term));
  }

  private async skillRecord(db: Database, id: string) {
    const result = await db.query<Skill>(`SELECT ${skillColumns} ${skillTables}
 WHERE s.id=$1 AND cs.deleted_at IS NULL AND s.deleted_at IS NULL`, [id]);
    if (!result.rowCount) throw new CompetencyError("skill_not_found", 404);
    return result.rows[0]!;
  }

  /** The courses of the newest CTĐT revisions that link the skill (the scope of "Cấu hình môn học"). */
  private async contributions(db: Database, id: string) {
    const result = await db.query(`SELECT * FROM (SELECT c.id AS "courseId",c.code AS "courseCode",c.name AS "courseName",
 (SELECT array_agg(DISTINCT cu.cohort_code ORDER BY cu.cohort_code) FROM curriculum_courses cc
 JOIN curricula cu ON cu.current_revision=cc.revision_id WHERE cc.course_id=c.id) AS cohorts,l.weight::float8 AS weight,cfg.status
 FROM ad_comp_course_links l JOIN ad_comp_course_configs cfg ON cfg.id=l.config_id JOIN ad_comp_courses c ON c.id=cfg.course_id
 WHERE l.skill_id=$1) x WHERE cohorts IS NOT NULL ORDER BY "courseCode","courseName","courseId"`, [id]);
    return result.rows;
  }

  private async skillSnapshot(db: Database, id: string) {
    return { ...await this.skillRecord(db, id), contributions: await this.contributions(db, id) };
  }

  async skill(id: string) {
    return { ...await this.skillSnapshot(this.pool, id), history: await this.history(this.pool, ["skill", "shared_skill"], id) };
  }

  private async groupFor(db: Database, id: string) {
    const result = await db.query<{ is_active: boolean }>("SELECT is_active FROM ad_comp_groups WHERE id=$1 AND deleted_at IS NULL FOR SHARE", [id]);
    if (!result.rowCount) throw new CompetencyError("group_not_found", 404);
    return result.rows[0]!;
  }

  private async activeSkillUsage(db: Database, id: string) {
    const result = await db.query(`SELECT 1 FROM ad_comp_course_links l JOIN ad_comp_course_configs c ON c.id=l.config_id
 WHERE l.skill_id=$1 AND c.status='active' LIMIT 1`, [id]);
    return Boolean(result.rowCount);
  }

  /**
   * "Thêm cấu hình năng lực". A name already in the shared Kỹ năng catalog (whitespace, case and
   * accents ignored) reuses that skill with its name and description (an empty description takes the
   * one typed here); any other name adds a catalog skill. A skill that already has a profile is
   * skill_profile_exists: that profile is edited, not added twice. The catalog lock of write() keeps
   * two admins from adding the same name at once.
   */
  async createSkill(data: SkillChange, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      await this.groupFor(client, data.groupId);
      let id: string;
      let restored = false;
      const match = await this.findCatalogSkill(client, data.name);
      if (match) {
        const canonical = await client.query<{ description: string }>("SELECT description FROM career_skills WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [match.id]);
        if (!canonical.rowCount) throw new CompetencyError("skill_unavailable", 409);
        id = match.id;
        if (!canonical.rows[0]!.description && data.description)
          await client.query("UPDATE career_skills SET description=$2,version=$3,updated_at=now() WHERE id=$1", [id, data.description, randomUUID()]);
        const profile = await client.query<{ deleted_at: string | null }>("SELECT deleted_at FROM ad_comp_skills WHERE skill_id=$1 FOR UPDATE", [id]);
        if (profile.rowCount) {
          if (!profile.rows[0]!.deleted_at) throw new CompetencyError("skill_profile_exists", 409);
          if (await this.activeSkillUsage(client, id)) throw new CompetencyError("skill_in_use", 409);
          await client.query(`UPDATE ad_comp_skills SET group_id=$2,scope=$3,is_active=$4,deleted_at=NULL,
 version=$5,updated_at=now() WHERE skill_id=$1`, [id, data.groupId, data.scope, data.isActive, randomUUID()]);
          restored = true;
        }
      } else {
        id = randomUUID();
        await client.query("INSERT INTO career_skills(id,name,description) VALUES($1,$2,$3)", [id, data.name, data.description]);
      }
      if (!restored) {
        await client.query("INSERT INTO ad_comp_skills(skill_id,group_id,scope,is_active) VALUES($1,$2,$3,$4)",
          [id, data.groupId, data.scope, data.isActive]);
      }
      const snapshot = await this.skillSnapshot(client, id);
      await this.event(client, "skill", id, actor, snapshot, restored ? "Khôi phục cấu hình năng lực"
        : match ? "Thêm cấu hình năng lực cho kỹ năng có sẵn trong danh mục" : "Thêm cấu hình năng lực");
      return snapshot;
    });
  }

  async updateSkill(id: string, version: string, data: SkillChange, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const current = await client.query<{ name: string; description: string; version: string }>(`SELECT s.name,s.description,cs.version
 ${skillTables} WHERE s.id=$1 AND cs.deleted_at IS NULL AND s.deleted_at IS NULL FOR UPDATE OF s,cs`, [id]);
      if (!current.rowCount) throw new CompetencyError("skill_not_found", 404);
      const previous = current.rows[0]!;
      if (previous.version !== version) throw new CompetencyError("skill_changed", 409);
      const group = await this.groupFor(client, data.groupId);
      if ((!data.isActive || !group.is_active) && await this.activeSkillUsage(client, id))
        throw new CompetencyError("skill_in_use", 409);
      if (previous.name !== data.name || previous.description !== data.description) {
        const careers = await client.query<{ id: string }>(`SELECT p.id FROM career_positions p
 WHERE p.deleted_at IS NULL AND EXISTS(SELECT 1 FROM career_requirements r
 WHERE r.career_position_id=p.id AND r.skill_id=$1 AND r.deleted_at IS NULL) ORDER BY p.id FOR UPDATE`, [id]);
        await client.query("UPDATE career_skills SET name=$2,description=$3,version=$4,updated_at=now() WHERE id=$1",
          [id, data.name, data.description, randomUUID()]);
        if (previous.name !== data.name) {
          await client.query(`UPDATE career_requirements SET title=CASE WHEN title=$2 THEN $3 ELSE title END,
 version=$4,updated_at=now() WHERE skill_id=$1 AND deleted_at IS NULL`, [id, previous.name, data.name, randomUUID()]);
          for (const career of careers.rows) await refreshCareerSkills(client, career.id);
        }
      }
      await client.query(`UPDATE ad_comp_skills SET group_id=$2,scope=$3,is_active=$4,version=$5,updated_at=now()
 WHERE skill_id=$1`, [id, data.groupId, data.scope, data.isActive, randomUUID()]);
      const snapshot = await this.skillSnapshot(client, id);
      await this.event(client, "skill", id, actor, snapshot, "Cập nhật cấu hình năng lực");
      return snapshot;
    });
  }

  async deleteSkill(id: string, version: string, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const current = await client.query<{ version: string }>("SELECT version FROM ad_comp_skills WHERE skill_id=$1 AND deleted_at IS NULL FOR UPDATE", [id]);
      if (!current.rowCount) throw new CompetencyError("skill_not_found", 404);
      if (current.rows[0]!.version !== version) throw new CompetencyError("skill_changed", 409);
      if (await this.activeSkillUsage(client, id)) throw new CompetencyError("skill_in_use", 409);
      const previous = await this.skillSnapshot(client, id);
      const nextVersion = randomUUID();
      const removed = await client.query<{ deletedAt: string }>(`UPDATE ad_comp_skills SET deleted_at=now(),is_active=false,
 version=$2,updated_at=now() WHERE skill_id=$1 RETURNING deleted_at AS "deletedAt"`, [id, nextVersion]);
      await this.event(client, "skill", id, actor,
        { ...previous, isActive: false, version: nextVersion, deletedAt: removed.rows[0]!.deletedAt }, "Xóa cấu hình năng lực");
      return { deleted: true };
    });
  }

  /** Cohorts of the filter, newest first, with the number of courses of their current curricula. */
  async cohorts() {
    return (await this.pool.query<{ cohortCode: string; courseCount: number }>(`SELECT cu.cohort_code AS "cohortCode",
 count(DISTINCT cc.course_id)::int AS "courseCount" FROM curricula cu JOIN curriculum_courses cc ON cc.revision_id=cu.current_revision
 GROUP BY cu.cohort_code ORDER BY ${cohortOrder("cu.cohort_code")}`)).rows;
  }

  /**
   * The shared courses of the filter, or one course by id. Only the newest CTĐT revision of each
   * curriculum counts (user, 2026-10-20: "chỉ lấy ở phiên bản mới nhất"): "" = every course of the
   * newest revisions, a cohort = the courses of its newest revisions. A course that only an older
   * revision has is not listed (migration 039 archives its configuration). Type, block and specialty
   * come from the filtered cohort, otherwise from the newest cohort that has the course.
   */
  private async courseRows(db: Database, cohort: string, id: string | null = null): Promise<CourseRow[]> {
    const result = await db.query<CourseRow>(`WITH occ AS (SELECT cc.course_id,cc.position,cc.course_type,cc.block,cc.specialty,
 cu.cohort_code,cu.id AS curriculum_id FROM curriculum_courses cc JOIN curricula cu ON cu.current_revision=cc.revision_id),
 shown AS (SELECT DISTINCT ON (course_id) course_id,position,course_type,block,specialty FROM occ
 WHERE ($1='' OR cohort_code=$1) AND ($2::uuid IS NULL OR course_id=$2)
 ORDER BY course_id,${cohortOrder("cohort_code")},curriculum_id)
 SELECT c.id,c.code,c.name,c.credits::float8 AS credits,s.course_type AS type,s.block,s.specialty,
 (SELECT array_agg(DISTINCT o.cohort_code ORDER BY o.cohort_code) FROM occ o WHERE o.course_id=c.id) AS cohorts,
 cfg.id AS "configId",COALESCE(cfg.status,'missing') AS status,cfg.version,COALESCE(cfg.note,'') AS note,
 COALESCE(cfg.merged_from,'{}') AS "mergedFrom",
 (SELECT count(*)::int FROM ad_comp_course_links l WHERE l.config_id=cfg.id) AS "skillCount",
 COALESCE((SELECT sum(l.weight)::float8 FROM ad_comp_course_links l WHERE l.config_id=cfg.id),0) AS "totalWeight"
 FROM ad_comp_courses c JOIN shown s ON s.course_id=c.id LEFT JOIN ad_comp_course_configs cfg ON cfg.course_id=c.id
 ORDER BY ${cohort ? "s.position," : ""}c.code,c.name,c.id`, [cohort, id]);
    return result.rows;
  }

  /** Ids of the courses of the filter (see courseRows), for the AI run over the filter. */
  async scopeCourseIds(db: Database, cohort: string) {
    return (await this.courseRows(db, cohort)).map(row => row.id);
  }

  async courses(query: { cohort: string; q: string; status: "" | CourseStatus }) {
    const term = fold(query.q);
    return (await this.courseRows(this.pool, query.cohort)).map(({ note: _note, ...row }) => row)
      .filter(row => (!query.status || row.status === query.status) && fold(`${row.code} ${row.name} ${row.block} ${row.specialty}`).includes(term));
  }

  private async courseRecord(db: Database, id: string) {
    const [course] = await this.courseRows(db, "", id);
    if (!course) throw new CompetencyError("course_not_found", 404);
    return course;
  }

  private async courseSnapshot(db: Database, id: string) {
    const course = await this.courseRecord(db, id);
    const links = course.configId ? (await db.query<CourseLink>(`SELECT l.skill_id AS "skillId",s.name AS "skillName",
 cs.group_id AS "groupId",g.name AS "groupName",
 (cs.is_active AND cs.deleted_at IS NULL AND g.is_active AND s.deleted_at IS NULL) AS "isActive",l.weight::float8 AS weight
 FROM ad_comp_course_links l JOIN ad_comp_skills cs ON cs.skill_id=l.skill_id
 JOIN career_skills s ON s.id=cs.skill_id JOIN ad_comp_groups g ON g.id=cs.group_id
 WHERE l.config_id=$1 ORDER BY g.name,s.name,s.id`, [course.configId])).rows : [];
    return { courseId: course.id, courseCode: course.code, courseName: course.name, credits: course.credits, cohorts: course.cohorts,
      configId: course.configId, status: course.status, version: course.version, note: course.note, mergedFrom: course.mergedFrom, links };
  }

  /**
   * The course and its history. Entries saved per CTĐT revision before the courses were shared, and
   * the merge entries of migration 038, name that revision's cohort and version in `scope`.
   */
  async course(id: string) {
    const history = await this.pool.query(`SELECT e.id,e.note,e.created_at AS "createdAt",u.display_name AS "actorName",e.snapshot,
 CASE WHEN r.id IS NOT NULL THEN cu.cohort_code||' · phiên bản '||r.version END AS scope
 FROM ad_comp_events e LEFT JOIN users u ON u.id=e.actor_id
 LEFT JOIN curriculum_revisions r ON r.id::text=e.snapshot->>'revisionId' LEFT JOIN curricula cu ON cu.id=r.curriculum_id
 WHERE e.kind='course' AND e.entity_key=$1 ORDER BY e.created_at DESC,e.id DESC`, [id]);
    return { ...await this.courseSnapshot(this.pool, id), history: history.rows };
  }

  private async validateCourseLinks(db: Database, links: ConfigurationChange["links"], status: ConfigurationChange["status"]) {
    validateWeights(links, status);
    if (!links.length) return;
    const result = await db.query<{ id: string; isActive: boolean; groupActive: boolean; name: string }>(`SELECT s.id,s.name,
 cs.is_active AS "isActive",g.is_active AS "groupActive" ${skillTables}
 WHERE s.id=ANY($1::uuid[]) AND cs.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.id FOR SHARE OF cs,s,g`,
      [links.map(link => link.skillId).sort()]);
    if (result.rowCount !== links.length) throw new CompetencyError("skill_unavailable", 409);
    if (status === "active") {
      const inactive = result.rows.filter(row => !row.isActive || !row.groupActive);
      if (inactive.length) throw new CompetencyError(inactive.some(row => !row.groupActive) ? "group_unavailable" : "skill_unavailable",
        409, inactive.map(row => row.name));
    }
  }

  /** Locks the course's configuration for a write and reads its links (by skill id); course_not_found (404). */
  async lockCourse(client: PoolClient, id: string) {
    await this.courseRecord(client, id);
    const existing = await client.query<{ id: string; version: string; status: "draft" | "active" | "archived"; note: string }>(`SELECT id,version,status,note
 FROM ad_comp_course_configs WHERE course_id=$1 FOR UPDATE`, [id]);
    const config = existing.rows[0] ?? null;
    const links = config ? (await client.query<{ skillId: string; weight: number }>(`SELECT skill_id AS "skillId",weight::float8 AS weight
 FROM ad_comp_course_links WHERE config_id=$1 ORDER BY skill_id`, [config.id])).rows : [];
    return { config, links };
  }

  /**
   * Writes a whole configuration (its links are replaced) and the history event. The caller holds
   * the row lock from lockCourse inside this repository's write transaction. `reviewed` (a save from
   * the course's own dialog) also clears the note of a configuration merged by migration 038.
   */
  async writeCourse(client: PoolClient, courseId: string, config: { id: string } | null, data: ConfigurationChange,
    actor: AuthenticatedUser, note: string, reviewed = false) {
    validateWeights(data.links, data.status);
    await this.validateCourseLinks(client, data.links, data.status);
    const id = config?.id ?? randomUUID();
    if (config) {
      await client.query(`UPDATE ad_comp_course_configs SET status=$2,note=$3,version=$4,updated_at=now()${reviewed ? ",merged_from='{}'" : ""} WHERE id=$1`,
        [id, data.status, data.note ?? "", randomUUID()]);
      await client.query("DELETE FROM ad_comp_course_links WHERE config_id=$1", [id]);
    } else {
      await client.query(`INSERT INTO ad_comp_course_configs(id,course_id,status,note)
 VALUES($1,$2,$3,$4)`, [id, courseId, data.status, data.note ?? ""]);
    }
    for (const link of [...data.links].sort((a, b) => a.skillId.localeCompare(b.skillId))) {
      await client.query("INSERT INTO ad_comp_course_links(config_id,skill_id,weight) VALUES($1,$2,$3)",
        [id, link.skillId, link.weight]);
    }
    const snapshot = await this.courseSnapshot(client, courseId);
    await this.event(client, "course", courseId, actor, snapshot, note);
    return snapshot;
  }

  async saveCourse(id: string, version: string, data: ConfigurationChange, actor: AuthenticatedUser) {
    // Reject malformed weights before connecting, including duplicate skill IDs.
    validateWeights(data.links, data.status);
    return this.write(actor, async client => {
      const { config } = await this.lockCourse(client, id);
      if ((config && config.version !== version) || (!config && version !== "new"))
        throw new CompetencyError("configuration_changed", 409);
      return this.writeCourse(client, id, config, data, actor,
        data.note?.trim() || (config ? "Cập nhật phân bổ năng lực môn học" : "Thêm phân bổ năng lực môn học"), true);
    });
  }

  /**
   * Makes sure a live catalog skill has a live profile, for an AI proposal: an existing live profile
   * is kept as it is, a soft-deleted one is restored into the group, otherwise one is created there
   * (empty scope, active). The group must be live and active. True when a profile was added.
   */
  async ensureProfile(client: PoolClient, skillId: string, groupId: string, actor: AuthenticatedUser, note: string): Promise<boolean> {
    const skill = await client.query("SELECT 1 FROM career_skills WHERE id=$1 AND deleted_at IS NULL FOR SHARE", [skillId]);
    if (!skill.rowCount) throw new CompetencyError("skill_not_found", 404);
    const profile = await client.query<{ deleted_at: string | null }>("SELECT deleted_at FROM ad_comp_skills WHERE skill_id=$1 FOR UPDATE", [skillId]);
    const row = profile.rows[0];
    if (row && !row.deleted_at) return false;
    const group = await this.groupFor(client, groupId);
    if (!group.is_active) throw new CompetencyError("group_unavailable", 409);
    if (row) {
      await client.query(`UPDATE ad_comp_skills SET group_id=$2,is_active=true,deleted_at=NULL,version=$3,updated_at=now()
 WHERE skill_id=$1`, [skillId, groupId, randomUUID()]);
    } else {
      await client.query("INSERT INTO ad_comp_skills(skill_id,group_id,scope,is_active) VALUES($1,$2,'',true)", [skillId, groupId]);
    }
    await this.event(client, "skill", skillId, actor, await this.skillSnapshot(client, skillId), note);
    return true;
  }

  /** The live catalog skill whose name matches (whitespace, case and accents ignored), if any. */
  async findCatalogSkill(client: PoolClient, name: string): Promise<{ id: string; name: string } | null> {
    const clean = fold(name.replace(/\s+/g, " ").trim());
    const catalog = await client.query<{ id: string; name: string }>("SELECT id,name FROM career_skills WHERE deleted_at IS NULL ORDER BY id");
    return catalog.rows.find(row => fold(row.name.replace(/\s+/g, " ").trim()) === clean) ?? null;
  }

  /**
   * The live catalog skill whose name matches (whitespace, case and accents ignored), or a new one.
   * New skills land in the shared catalog, so the Nghề nghiệp pages can use them at once.
   */
  async catalogSkillByName(client: PoolClient, name: string): Promise<{ id: string; name: string; created: boolean }> {
    const clean = name.replace(/\s+/g, " ").trim();
    const match = await this.findCatalogSkill(client, clean);
    if (match) return { ...match, created: false };
    const id = randomUUID();
    await client.query("INSERT INTO career_skills(id,name,description) VALUES($1,$2,'')", [id, clean]);
    return { id, name: clean, created: true };
  }

  /**
   * "Xóa liên kết của N môn": every course of the filter that has links loses its links and weights
   * and becomes an empty draft, so an AI run can propose them again. The courses are shared, so every
   * cohort that has them loses them too. The admin repeats the cohort code, or ALL_COURSES_CONFIRMATION
   * without a filter (confirmation_mismatch otherwise). Each course keeps its history.
   */
  async clearCourses(cohort: string, confirmation: string, actor: AuthenticatedUser) {
    const same = (text: string) => fold(text.replace(/\s+/g, " ").trim());
    if (same(confirmation) !== same(cohort || ALL_COURSES_CONFIRMATION)) throw new CompetencyError("confirmation_mismatch", 400);
    return this.write(actor, async client => {
      const rows = await this.courseRows(client, cohort);
      const configs = await client.query<{ id: string; courseId: string; note: string }>(`SELECT c.id,c.course_id AS "courseId",c.note
 FROM ad_comp_course_configs c WHERE c.course_id=ANY($1::uuid[]) AND EXISTS(SELECT 1 FROM ad_comp_course_links l WHERE l.config_id=c.id)
 ORDER BY c.id FOR UPDATE`, [rows.map(row => row.id)]);
      for (const config of configs.rows) {
        await this.writeCourse(client, config.courseId, config, { status: "draft", links: [], note: config.note }, actor,
          cohort ? `Xóa liên kết và trọng số của các môn học ${cohort}` : "Xóa liên kết và trọng số của mọi môn học");
      }
      return { cleared: configs.rows.length };
    });
  }

  /**
   * "Áp dụng bản nháp": every draft of the filter becomes active, one course at a time (a savepoint
   * each). A draft that cannot be applied (no link, a total other than 100%, a skill or group no
   * longer in use) is skipped with its reason and the others go on.
   */
  async activateDrafts(cohort: string, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const rows = await this.courseRows(client, cohort);
      const locked = await client.query<{ id: string; courseId: string; note: string }>(`SELECT id,course_id AS "courseId",note
 FROM ad_comp_course_configs WHERE course_id=ANY($1::uuid[]) AND status='draft' ORDER BY id FOR UPDATE`, [rows.map(row => row.id)]);
      const drafts = new Map(locked.rows.map(draft => [draft.courseId, draft]));
      let activated = 0;
      const skipped: { courseCode: string; courseName: string; reason: string }[] = [];
      for (const course of rows) {
        const draft = drafts.get(course.id);
        if (!draft) continue;
        await client.query("SAVEPOINT activate_draft");
        try {
          const links = (await client.query<{ skillId: string; weight: number }>(`SELECT skill_id AS "skillId",weight::float8 AS weight
 FROM ad_comp_course_links WHERE config_id=$1 ORDER BY skill_id`, [draft.id])).rows;
          if (!links.length) throw new CompetencyError("course_has_no_links", 409);
          await this.writeCourse(client, course.id, draft, { status: "active", links, note: draft.note }, actor, "Áp dụng bản nháp của nhiều môn học");
          // Deferred weight checks run now, so one bad course never fails the others at commit.
          await client.query("SET CONSTRAINTS ALL IMMEDIATE");
          await client.query("SET CONSTRAINTS ALL DEFERRED");
          await client.query("RELEASE SAVEPOINT activate_draft");
          activated += 1;
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT activate_draft");
          const database = error as { code?: string; constraint?: string };
          skipped.push({ courseCode: course.code, courseName: course.name, reason: error instanceof CompetencyError ? error.code
            : database.code === "23514" ? (database.constraint === "competency_active_total" ? "weight_total_invalid" : "skill_unavailable")
              : "invalid_competency_reference" });
        }
      }
      return { activated, skipped };
    });
  }

  async archiveCourse(id: string, version: string, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const current = await client.query<{ id: string; version: string }>(`SELECT id,version FROM ad_comp_course_configs
 WHERE course_id=$1 FOR UPDATE`, [id]);
      if (!current.rowCount) throw new CompetencyError("course_not_found", 404);
      if (current.rows[0]!.version !== version) throw new CompetencyError("configuration_changed", 409);
      await client.query("UPDATE ad_comp_course_configs SET status='archived',version=$2,updated_at=now() WHERE id=$1",
        [current.rows[0]!.id, randomUUID()]);
      const snapshot = await this.courseSnapshot(client, id);
      await this.event(client, "course", id, actor, snapshot, "Ngừng áp dụng phân bổ năng lực môn học");
      return snapshot;
    });
  }

  async summary(cohort: string) {
    const rows = await this.courseRows(this.pool, cohort);
    const links = await this.pool.query<{ courseId: string; skillId: string; skillName: string; weight: number; isActive: boolean }>(`SELECT c.course_id AS "courseId",
 l.skill_id AS "skillId",s.name AS "skillName",l.weight::float8 AS weight,
 (cs.is_active AND cs.deleted_at IS NULL AND g.is_active AND s.deleted_at IS NULL) AS "isActive"
 FROM ad_comp_course_configs c JOIN ad_comp_course_links l ON l.config_id=c.id
 JOIN ad_comp_skills cs ON cs.skill_id=l.skill_id JOIN career_skills s ON s.id=cs.skill_id
 JOIN ad_comp_groups g ON g.id=cs.group_id WHERE c.course_id=ANY($1::uuid[]) ORDER BY s.name,s.id`, [rows.map(row => row.id)]);
    const eligible = await this.pool.query<{ id: string }>(`SELECT s.id ${skillTables}
 WHERE cs.deleted_at IS NULL AND cs.is_active AND s.deleted_at IS NULL AND g.is_active`);
    const linksByCourse = new Map<string, typeof links.rows>();
    for (const link of links.rows) {
      const bucket = linksByCourse.get(link.courseId) ?? [];
      bucket.push(link);
      linksByCourse.set(link.courseId, bucket);
    }
    const status = new Map(rows.map(row => [row.id, row.status]));
    const linked = new Set(links.rows.filter(link => link.weight > 0 && link.isActive && status.get(link.courseId) === "active").map(link => link.skillId));
    const warnings: Warning[] = [];
    let activeCount = 0, draftCount = 0, archivedCount = 0, missingCount = 0;
    for (const course of rows) {
      // Two courses can share a code (another name or credits), so a warning names the course.
      const name = course.name;
      if (course.mergedFrom.length) warnings.push({ code: "merged_configuration", courseCode: course.code,
        message: `${name}: đã gộp cấu hình khác của ${course.mergedFrom.join(", ")}; xem Lịch sử cấu hình để đối chiếu.` });
      if (course.status === "missing") {
        missingCount++;
        warnings.push({ code: "missing_configuration", courseCode: course.code, message: `${name} chưa có phân bổ năng lực.` });
        continue;
      }
      if (course.status === "active") activeCount++;
      else if (course.status === "draft") draftCount++;
      else archivedCount++;
      const courseLinks = linksByCourse.get(course.id) ?? [];
      if (course.status === "draft" && (!courseLinks.length || Math.abs(course.totalWeight - 1) > WEIGHT_TOLERANCE || courseLinks.some(link => !link.isActive)))
        warnings.push({ code: "incomplete_draft", courseCode: course.code,
          message: `${name} là bản nháp chưa đủ phân bổ 100% hoặc có năng lực chưa khả dụng.` });
      if (course.status !== "archived") for (const link of courseLinks.filter(link => link.weight === 0))
        warnings.push({ code: "zero_contribution", courseCode: course.code, message: `${link.skillName} có trọng số 0% trong ${name}; liên kết này không đóng góp vào năng lực.` });
    }
    if (rows.length && missingCount === rows.length) warnings.unshift({ code: "no_configurations",
      message: cohort ? `Các môn học của ${cohort} chưa có cấu hình năng lực.` : "Chưa có môn học nào có cấu hình năng lực." });
    const unlinkedSkillCount = eligible.rows.filter(skill => !linked.has(skill.id)).length;
    if (unlinkedSkillCount) warnings.push({ code: "unlinked_skills",
      message: `${unlinkedSkillCount} năng lực khả dụng chưa có môn học đóng góp${cohort ? ` trong các môn của ${cohort}` : ""}.` });
    return { cohort, courseCount: rows.length, activeCount, draftCount, archivedCount, missingCount,
      skillCount: eligible.rows.length, unlinkedSkillCount, warnings };
  }
}
