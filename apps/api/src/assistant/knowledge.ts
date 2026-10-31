// The shared knowledge index of Trợ lý AI (STU-CHAT-01..05, 2026-10-28): the catalogs a student may ask about, written as
// short Vietnamese texts a small model can quote. One chunk per course code of the current CTĐT revisions, skill, career,
// career field, CTĐT, KHĐT (and each of its terms), graduation standard, portal guide (guides.ts) and self-study resource
// list (learning-resources.json); a text longer than MAX_CHUNK_CHARS is split into numbered parts ("key", "key#2", …).
// Shared knowledge only: never a student's data, name or score; the student's own results come from facts.ts when an
// answer is prepared. refreshKnowledge rebuilds every chunk from the catalog tables and writes only what changed: a new
// text gets a new content_hash and loses its embedding until the worker embeds it again (knowledge-jobs.ts, kind
// "knowledge_embedding"); rows no longer produced are deleted.
// 2026-10-28: only what students can see is indexed: active CTĐT, KHĐT and graduation standards (is_active, current
// revision), applied course configurations (status 'active', links with a weight, skills and groups in use, as the
// competency assessment reads them), live careers, career fields and skills. Course descriptions are written only when
// the CTĐT has one (none does yet); nothing is invented.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CAREER_THRESHOLDS, LEVEL_THRESHOLDS } from "../competency-assessment/constants.js";
import { fold } from "../competency-assessment/specialty.js";
import { fullMajorName, majorKey, MAJORS } from "../curricula/majors.js";
import type { DatabasePool } from "../db/pool.js";
import { termName } from "../term-name.js";
import { portalGuides } from "./guides.js";

type Db = Pick<DatabasePool, "query">;

/** Source kinds of the index, in the order the chunks are built. */
export const KNOWLEDGE_SOURCE_KINDS = ["guide", "career", "field", "skill", "course", "curriculum", "plan", "graduation", "resource"] as const;
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];
/** One chunk as the builder makes it; `link` is a page of the student portal ("#curriculum") or null. */
export type KnowledgeChunkInput = { sourceKind: KnowledgeSourceKind; sourceKey: string; title: string; content: string; link: string | null };
export type KnowledgeRefreshResult = { inserted: number; updated: number; deleted: number; total: number };
export type KnowledgeOptions = {
  /** The curated self-study resources (another agent writes the file); a missing file means no resource chunks. */
  resourcesFile?: string | URL;
};

/** Longest content of a chunk (characters); longer texts are split at line boundaries. */
export const MAX_CHUNK_CHARS = 1500;
/** How often createKnowledgeRefresh rebuilds the index at most. */
export const KNOWLEDGE_REFRESH_INTERVAL_MS = 10 * 60_000;
/** apps/api/src/assistant/learning-resources.json, from src/assistant (tsx) and from dist/assistant (node) alike. */
export const LEARNING_RESOURCES_FILE = new URL("../../src/assistant/learning-resources.json", import.meta.url);
const TITLE_MAX = 260;

/* ------------------------------------------------------------------------ */
/* Text helpers */

const decimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const formatNumber = (value: number) => decimal.format(value);
/** One line of catalog text: control characters and runs of whitespace become one space; cut at `max` characters. */
function clean(value: unknown, max = 600): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
const toNumber = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
};
const toInteger = (value: unknown): number | null => {
  const number = toNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
};
const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const recordOf = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
/** A course code as the competency module compares them (course-state.ts courseKey, SQL upper(btrim(code))). */
const codeKey = (value: unknown) => (typeof value === "string" ? value.trim().toUpperCase() : "");
const credits = (value: number | null) => (value === null ? "chưa ghi số tín chỉ" : `${formatNumber(value)} tín chỉ`);
const percent = (weight: number) => `${formatNumber(Math.round(weight * 1000) / 10)}%`;
/** "K29" → 29; a code without a number sorts last. */
const cohortNumber = (cohort: string) => Number(/(\d+)/.exec(cohort)?.[1] ?? Number.POSITIVE_INFINITY);
/** "[71ITBS10203]Cơ sở lập trình" → "71ITBS10203 Cơ sở lập trình": a bracketed code reads as a code. */
const bracketCodes = (raw: string) => raw.replace(/\[([^[\]]+)\]\s*/g, "$1 ").trim();
/** GDTC/GDQP: condition-only (*) courses (apps/web student-curriculum-types.ts CONDITION_ONLY_CODE). */
const CONDITION_ONLY_CODE = /^(?:71NAD|71PE|DQP|DGT)/i;
const isConditionOnly = (code: string, type: string) => CONDITION_ONLY_CODE.test(code) || type.trim().toUpperCase() === "BBKTL";
/** A CTĐT "Chuyên ngành" value naming a specialty, not "Tự chọn Chuyên ngành" or "Học phần thay thế…" (web isSpecialtyName). */
const isSpecialtyName = (value: string) => {
  const text = fold(value);
  return /[a-z]/.test(text) && !/^(tu chon|hoc phan thay the)\b/.test(text);
};
/** Elective group code of a type ("TC309 (9TC)" → "TC309"), or null. */
const electiveCode = (type: string) => /^TC\d+/i.exec(type.trim())?.[0]?.toUpperCase() ?? null;

type MajorInfo = { label: string; short: string; order: number };
const MAJOR_SHORT: Record<string, string> = { "7480201": "CNTT", "7480104": "HTTT", "7480102": "MMT&TTDL" };
/** The major of a CTĐT or KHĐT, by the Faculty's names (curricula/majors.ts), else as written. */
function majorInfo(raw: unknown): MajorInfo {
  const text = clean(raw, 200);
  const key = majorKey(fullMajorName(text));
  const index = MAJORS.findIndex((major) => majorKey(major.name) === key);
  const major = MAJORS[index];
  if (major) return { label: major.label, short: MAJOR_SHORT[major.code] ?? major.label, order: index };
  const lower = text.toLocaleLowerCase("vi");
  const label = lower ? lower.charAt(0).toLocaleUpperCase("vi") + lower.slice(1) : "Chưa ghi ngành";
  return { label, short: label, order: MAJORS.length };
}

/* ------------------------------------------------------------------------ */
/* Chunks and parts */

/** Lines of a chunk under an optional heading; the heading is repeated ("… (tiếp theo):") when its lines go on in the next part. */
type Block = { heading?: string; lines: string[] };

/** A line longer than `max` cut at spaces. */
function wrap(line: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > max) {
    const space = rest.lastIndexOf(" ", max);
    const at = space > max / 2 ? space : max;
    pieces.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** The text of a chunk in parts of at most `max` characters, cut between lines; a heading stays with its first line. */
export function packParts(blocks: readonly Block[], max: number = MAX_CHUNK_CHARS): string[] {
  const parts: string[] = [];
  let lines: string[] = [];
  let size = 0;
  const flush = () => {
    if (lines.length) parts.push(lines.join("\n"));
    lines = [];
    size = 0;
  };
  const fits = (length: number) => size + (lines.length ? 1 : 0) + length <= max;
  const push = (line: string) => {
    size += (lines.length ? 1 : 0) + line.length;
    lines.push(line);
  };
  for (const block of blocks) {
    const heading = block.heading ? `${clean(block.heading, 300)}:` : null;
    const again = block.heading ? `${clean(block.heading, 300)} (tiếp theo):` : null;
    const body = block.lines.filter(Boolean).flatMap((line) => wrap(line, max - (again ? again.length + 1 : 0)));
    if (!body.length) continue;
    if (heading) {
      if (!fits(heading.length + 1 + body[0]!.length)) flush();
      push(heading);
    }
    for (const line of body) {
      if (!fits(line.length)) {
        flush();
        if (again) push(again);
      }
      push(line);
    }
  }
  flush();
  return parts;
}

/** The chunks of one item: one, or numbered parts "key", "key#2", … titled "… (phần 2/3)". */
function chunksOf(sourceKind: KnowledgeSourceKind, sourceKey: string, title: string, link: string | null, blocks: readonly Block[]): KnowledgeChunkInput[] {
  const parts = packParts(blocks);
  const base = clean(title, TITLE_MAX) || sourceKey;
  return parts.map((content, index) => ({
    sourceKind,
    sourceKey: index === 0 ? sourceKey : `${sourceKey}#${index + 1}`,
    title: parts.length > 1 ? `${base} (phần ${index + 1}/${parts.length})` : base,
    content,
    link,
  }));
}

/** "A (K29, K30); B (K31)", or just "A" when every program has the same value. */
function byPrograms(entries: readonly { label: string; value: string }[]): string {
  const values = new Map<string, string[]>();
  for (const { label, value } of entries) {
    const labels = values.get(value) ?? [];
    if (!labels.includes(label)) labels.push(label);
    values.set(value, labels);
  }
  if (values.size === 1) return [...values.keys()][0]!;
  return [...values].map(([value, labels]) => `${value} (${labels.join(", ")})`).join("; ");
}

/* ------------------------------------------------------------------------ */
/* Catalog rows (readKnowledgeCatalog) */

export type CurriculumRow = { id: string; revisionId: string; cohortCode: string; data: Record<string, unknown> };
/** The applied skills of the shared course (course_id) a code of a current CTĐT revision points to. */
export type CourseSkillRow = { revisionId: string; code: string; courseId: string; skills: { skillId: string; skillName: string; weight: number }[] };
export type SkillRow = { id: string; name: string; description: string; hasProfile: boolean; scope: string; groups: string[] };
export type CareerRow = {
  id: string; code: string; nameVi: string; nameEn: string; description: string; fieldCode: string; fieldName: string;
  requirements: { title: string; description: string; isRequired: boolean; skillId: string | null; skillName: string | null }[];
};
export type FieldRow = { code: string; name: string; description: string };
export type PlanRow = { id: string; cohortCode: string; data: Record<string, unknown> };
export type StandardRow = { id: string; cohortCode: string; data: Record<string, unknown> };
export type LearningResource = {
  title: string; url: string; provider: string | null; type: string | null; language: string | null; level: string | null; free: boolean | null; note: string | null;
};
export type LearningResources = { checkedAt: string | null; skills: { skill: string; resources: LearningResource[] }[] };
export type KnowledgeCatalog = {
  curricula: CurriculumRow[]; courseSkills: CourseSkillRow[]; skills: SkillRow[]; careers: CareerRow[]; fields: FieldRow[];
  plans: PlanRow[]; standards: StandardRow[]; resources: LearningResources | null;
};

/** The current revision of every active CTĐT, its courses without the workbook cells. */
const CURRICULA_SQL = `SELECT c.id,r.id AS "revisionId",c.cohort_code AS "cohortCode",
    jsonb_build_object('name',r.data->'name','major',r.data->'major','admissionYear',r.data->'admissionYear','totalCredits',r.data->'totalCredits',
      'groups',COALESCE(r.data->'groups','[]'::jsonb),'electives',COALESCE(r.data->'electives','[]'::jsonb),'relations',COALESCE(r.data->'relations','[]'::jsonb),
      'courses',COALESCE((SELECT jsonb_agg(x-'sourceCells'-'sourceRow'-'sourceSheet'-'hours' ORDER BY n)
        FROM jsonb_array_elements(r.data->'courses') WITH ORDINALITY AS e(x,n)),'[]'::jsonb)) AS data
  FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision
  WHERE c.is_active ORDER BY c.cohort_code,c.identity_key,c.id`;
/**
 * Per code of a current revision, the applied configuration of its shared course: curriculum_courses.course_id already
 * follows merged courses (ad_comp_course_aliases), and only links the assessment counts are kept (weight > 0, live active
 * skill whose first group is active).
 */
const COURSE_SKILLS_SQL = `SELECT cc.revision_id AS "revisionId",upper(btrim(cc.code)) AS code,cc.course_id AS "courseId",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('skillId',l.skill_id,'skillName',k.name,'weight',l.weight::float8) ORDER BY l.weight DESC,k.name,l.skill_id)
      FROM ad_comp_course_configs cfg JOIN ad_comp_course_links l ON l.config_id=cfg.id AND l.weight>0
      JOIN ad_comp_skills s ON s.skill_id=l.skill_id AND s.is_active AND s.deleted_at IS NULL
      JOIN career_skills k ON k.id=s.skill_id AND k.deleted_at IS NULL
      JOIN ad_comp_groups g ON g.id=s.group_id AND g.is_active
      WHERE cfg.course_id=cc.course_id AND cfg.status='active'),'[]'::jsonb) AS skills
  FROM curricula cu JOIN curriculum_courses cc ON cc.revision_id=cu.current_revision
  WHERE cu.is_active ORDER BY 2,1`;
/** Live catalog skills; the competency profile (scope, groups) only while the assessment uses it. */
const SKILLS_SQL = `SELECT k.id,k.name,k.description,(s.skill_id IS NOT NULL) AS "hasProfile",COALESCE(s.scope,'') AS scope,
    COALESCE((SELECT array_agg(x.name ORDER BY x.id<>s.group_id,x.name,x.id) FROM ad_comp_groups x
      WHERE x.is_active AND (x.id=s.group_id OR x.id IN (SELECT m.group_id FROM ad_comp_skill_groups m WHERE m.skill_id=s.skill_id))),'{}') AS groups
  FROM career_skills k LEFT JOIN ad_comp_skills s ON s.skill_id=k.id AND s.deleted_at IS NULL AND s.is_active
    AND EXISTS(SELECT 1 FROM ad_comp_groups g WHERE g.id=s.group_id AND g.is_active)
  WHERE k.deleted_at IS NULL ORDER BY k.name,k.id`;
const CAREERS_SQL = `SELECT c.id,c.code,c.name_vi AS "nameVi",c.name_en AS "nameEn",c.description,c.category AS "fieldCode",f.name AS "fieldName",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('title',r.title,'description',r.description,'isRequired',r.is_required,
        'skillId',CASE WHEN k.deleted_at IS NULL THEN r.skill_id END,'skillName',CASE WHEN k.deleted_at IS NULL THEN k.name END)
        ORDER BY r.is_required DESC,r.title,r.id)
      FROM career_requirements r LEFT JOIN career_skills k ON k.id=r.skill_id
      WHERE r.career_position_id=c.id AND r.deleted_at IS NULL),'[]'::jsonb) AS requirements
  FROM career_positions c JOIN career_fields f ON f.code=c.category
  WHERE c.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY c.code`;
const FIELDS_SQL = `SELECT f.code,f.name,f.description FROM career_fields f WHERE f.deleted_at IS NULL ORDER BY length(f.code),f.code`;
const PLANS_SQL = `SELECT p.id,p.cohort_code AS "cohortCode",
    jsonb_build_object('name',r.data->'name','major',r.data->'major','totalCredits',r.data->'totalCredits',
      'terms',COALESCE(r.data->'terms','[]'::jsonb),'sections',COALESCE(r.data->'sections','[]'::jsonb),
      'items',COALESCE((SELECT jsonb_agg(x-'sourceCells'-'sourceRow'-'sourceSheet'-'hours' ORDER BY n)
        FROM jsonb_array_elements(r.data->'items') WITH ORDINALITY AS e(x,n)),'[]'::jsonb)) AS data
  FROM training_plans p JOIN training_plan_revisions r ON r.id=p.current_revision
  WHERE p.is_active ORDER BY p.cohort_code,p.identity_key,p.id`;
/** Standards without the import's own notes (sourceNotes: which workbook columns were ignored). */
const STANDARDS_SQL = `SELECT g.id,g.cohort_code AS "cohortCode",r.data-'sourceNotes'-'sourceWorkbook'-'sourceSheet' AS data
  FROM graduation_standards g JOIN graduation_revisions r ON r.id=g.current_revision
  WHERE g.is_active ORDER BY g.cohort_code,g.identity_key,g.id`;

const optionalText = z.preprocess((value) => (typeof value === "string" && value.trim() ? value : undefined), z.string().optional());
const resourceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.string().trim().max(2000).regex(/^https:\/\/[^\s<>"'`]+$/),
  provider: optionalText, type: optionalText, language: optionalText, level: optionalText, note: optionalText,
  free: z.preprocess((value) => (typeof value === "boolean" ? value : undefined), z.boolean().optional()),
});
const resourceFileSchema = z.object({
  checkedAt: optionalText,
  skills: z.array(z.object({ skill: z.string(), resources: z.array(z.unknown()) })),
});

/**
 * learning-resources.json, or null when the file does not exist yet. A file that is not JSON or has no `skills` list
 * throws (the refresh then changes nothing); a resource without a title or an https address is left out.
 */
export async function readLearningResources(file: string | URL = LEARNING_RESOURCES_FILE): Promise<LearningResources | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
  const parsed = resourceFileSchema.parse(JSON.parse(text.replace(/^\uFEFF/, "")));
  return {
    checkedAt: parsed.checkedAt ?? null,
    skills: parsed.skills.map((entry) => ({
      skill: clean(entry.skill, 100),
      resources: entry.resources.flatMap((item) => {
        const resource = resourceSchema.safeParse(item);
        if (!resource.success) return [];
        const { title, url, provider, type, language, level, free, note } = resource.data;
        return [{ title, url, provider: provider ?? null, type: type ?? null, language: language ?? null, level: level ?? null, free: free ?? null, note: note ?? null }];
      }),
    })).filter((entry) => entry.skill && entry.resources.length),
  };
}

/** Every catalog the index is built from, read one query after another (a background job, gentle on the pool). */
export async function readKnowledgeCatalog(db: Db, options: KnowledgeOptions = {}): Promise<KnowledgeCatalog> {
  const curricula = (await db.query<CurriculumRow>(CURRICULA_SQL)).rows;
  const courseSkills = (await db.query<CourseSkillRow>(COURSE_SKILLS_SQL)).rows;
  const skills = (await db.query<SkillRow>(SKILLS_SQL)).rows;
  const careers = (await db.query<CareerRow>(CAREERS_SQL)).rows;
  const fields = (await db.query<FieldRow>(FIELDS_SQL)).rows;
  const plans = (await db.query<PlanRow>(PLANS_SQL)).rows;
  const standards = (await db.query<StandardRow>(STANDARDS_SQL)).rows;
  const resources = await readLearningResources(options.resourcesFile ?? LEARNING_RESOURCES_FILE);
  return { curricula, courseSkills, skills, careers, fields, plans, standards, resources };
}

/* ------------------------------------------------------------------------ */
/* Programs (CTĐT) */

type CourseData = {
  code: string; name: string; englishName: string; description: string; credits: number | null; type: string; block: string;
  specialty: string; semester: number | null; studyYear: number | null; groupId: string;
};
type RelationData = { courseCode: string; kind: "prerequisite" | "prior"; raw: string; targetCodes: string[]; reviewRequired: boolean };
type Program = {
  id: string; revisionId: string; cohort: string; major: MajorInfo; name: string; admissionYear: number | null; totalCredits: number | null;
  groups: { id: string; label: string; credits: number | null }[];
  electives: { code: string; requiredCredits: number | null; courseCodes: string[] }[];
  relations: RelationData[]; courses: CourseData[];
  /** Code → name of the first row with that code. */
  names: Map<string, string>;
  quotas: Map<string, number | null>;
};

function readProgram(row: CurriculumRow): Program {
  const data = recordOf(row.data);
  const courses = arrayOf(data.courses).map((value): CourseData => {
    const item = recordOf(value);
    return {
      code: codeKey(item.code), name: clean(item.name, 300), englishName: clean(item.englishName, 300), description: clean(item.description, 500),
      credits: toNumber(item.credits), type: clean(item.type, 60), block: clean(item.block, 300), specialty: clean(item.specialty, 200),
      semester: toInteger(item.semester), studyYear: toInteger(item.studyYear), groupId: clean(item.groupId, 100),
    };
  }).filter((course) => course.code && course.name);
  const names = new Map<string, string>();
  for (const course of courses) if (!names.has(course.code)) names.set(course.code, course.name);
  const electives = arrayOf(data.electives).map((value) => {
    const item = recordOf(value);
    return { code: codeKey(item.code), requiredCredits: toNumber(item.requiredCredits), courseCodes: arrayOf(item.courseCodes).map(codeKey).filter(Boolean) };
  }).filter((elective) => elective.code);
  return {
    id: row.id, revisionId: row.revisionId, cohort: clean(row.cohortCode, 20).toUpperCase(), major: majorInfo(data.major), name: clean(data.name, 300),
    admissionYear: toInteger(data.admissionYear), totalCredits: toNumber(data.totalCredits),
    groups: arrayOf(data.groups).map((value) => {
      const item = recordOf(value);
      return { id: clean(item.id, 100), label: clean(item.label, 300).replace(/^Khối kiến thức:\s*/i, ""), credits: toNumber(item.credits) };
    }).filter((group) => group.id && group.label),
    electives,
    relations: arrayOf(data.relations).map((value): RelationData => {
      const item = recordOf(value);
      return {
        courseCode: codeKey(item.courseCode), kind: item.kind === "prerequisite" ? "prerequisite" : "prior", raw: clean(item.raw, 300),
        targetCodes: arrayOf(item.targetCodes).map(codeKey).filter(Boolean), reviewRequired: item.reviewRequired === true,
      };
    }).filter((relation) => relation.courseCode),
    courses, names,
    quotas: new Map(electives.map((elective) => [elective.code, elective.requiredCredits])),
  };
}

/** Programs by major (the Faculty's order), then cohort. */
const programOrder = (a: Program, b: Program) =>
  a.major.order - b.major.order || a.major.label.localeCompare(b.major.label, "vi") || cohortNumber(a.cohort) - cohortNumber(b.cohort)
  || a.cohort.localeCompare(b.cohort) || a.id.localeCompare(b.id);
const programTitle = (program: Program) => `${program.major.label} ${program.cohort}`;

/** "bắt buộc", "tự chọn nhóm TC309 (chọn đủ 9 tín chỉ trong nhóm)", "môn điều kiện (*), …". */
function courseTypeText(course: Pick<CourseData, "code" | "type">, quotas: ReadonlyMap<string, number | null>): string {
  const group = electiveCode(course.type);
  const quota = group ? quotas.get(group) ?? null : null;
  const choice = group ? `tự chọn nhóm ${group}${quota !== null ? ` (chọn đủ ${formatNumber(quota)} tín chỉ trong nhóm)` : ""}`
    : /^TC/i.test(course.type) ? "tự chọn" : null;
  if (isConditionOnly(course.code, course.type)) return `môn điều kiện (*), ${choice ?? "bắt buộc"}, không tính vào tín chỉ tích lũy`;
  if (course.type.toUpperCase() === "BB") return "bắt buộc";
  return choice ?? (course.type || "chưa ghi loại học phần");
}
/** The short form of a list line: "bắt buộc", "tự chọn TC309", "môn điều kiện (*)". */
function shortTypeText(code: string, type: string): string {
  const group = electiveCode(type);
  if (isConditionOnly(code, type)) return group ? `môn điều kiện (*), tự chọn ${group}` : "môn điều kiện (*)";
  if (type.toUpperCase() === "BB") return "bắt buộc";
  if (group) return `tự chọn ${group}`;
  return /^TC/i.test(type) ? "tự chọn" : type || "chưa ghi loại";
}
const placementText = (course: Pick<CourseData, "studyYear" | "semester">) =>
  course.studyYear !== null && course.semester !== null ? `năm ${course.studyYear}, học kỳ ${course.semester}`
    : course.studyYear !== null ? `năm ${course.studyYear}` : course.semester !== null ? `học kỳ ${course.semester}` : "chưa xếp năm và học kỳ";
const specialtyText = (value: string) => (isSpecialtyName(value) ? value : value && value !== "0" ? value : "học phần chung");
/** A CTĐT group label without its numbering ("B1. Kiến thức cơ sở khối ngành" → "Kiến thức cơ sở khối ngành"). */
const plainLabel = (label: string) => label.replace(/^[A-Z]{1,4}[\d.-]*\.\s+/, "").trim();

/* ------------------------------------------------------------------------ */
/* Course chunks */

type Occurrence = { program: Program; course: CourseData };

function relationText(relation: RelationData, program: Program): string {
  if (relation.targetCodes.length && !relation.reviewRequired) {
    return relation.targetCodes.map((code) => (program.names.has(code) ? `${code} ${program.names.get(code)}` : code)).join(", ");
  }
  return bracketCodes(relation.raw) || "theo quy định của Khoa";
}

function courseChunks(code: string, occurrences: readonly Occurrence[], skillsOf: ReadonlyMap<string, CourseSkillRow>): KnowledgeChunkInput[] {
  const sorted = [...occurrences].sort((a, b) => programOrder(a.program, b.program));
  const newest = [...sorted].sort((a, b) => cohortNumber(b.program.cohort) - cohortNumber(a.program.cohort))[0]!;
  const programs = [...new Map(sorted.map(({ program }) => [program.id, program])).values()];
  const sameMajor = new Set(programs.map((program) => program.major.label)).size === 1;
  const label = (program: Program) => (sameMajor ? program.cohort : `${program.major.short} ${program.cohort}`);
  const each = (value: (occurrence: Occurrence) => string) => byPrograms(sorted.map((occurrence) => ({ label: label(occurrence.program), value: value(occurrence) })));

  const lines: string[] = [];
  const english = newest.course.englishName;
  lines.push(`Học phần ${code}: ${newest.course.name}${english ? ` (tên tiếng Anh: ${english})` : ""}.`);
  if (new Set(sorted.map(({ course }) => course.name)).size > 1) lines.push(`Tên học phần theo từng CTĐT: ${each(({ course }) => course.name)}.`);
  lines.push(`Số tín chỉ: ${each(({ course }) => (course.credits === null ? "chưa ghi" : formatNumber(course.credits)))}.`);
  const byMajor = new Map<string, string[]>();
  for (const program of programs) byMajor.set(program.major.label, [...(byMajor.get(program.major.label) ?? []), program.cohort]);
  lines.push(`Có trong chương trình đào tạo: ${[...byMajor].map(([major, cohorts]) => `${major} ${[...new Set(cohorts)].join(", ")}`).join("; ")}.`);
  lines.push(`Loại học phần: ${each(({ program, course }) => courseTypeText(course, program.quotas))}.`);
  const blockOf = ({ program, course }: Occurrence) => course.block || plainLabel(program.groups.find((group) => group.id === course.groupId)?.label ?? "");
  if (sorted.some((occurrence) => blockOf(occurrence))) lines.push(`Khối kiến thức: ${each((occurrence) => blockOf(occurrence) || "chưa ghi khối")}.`);
  if (sorted.some(({ course }) => specialtyText(course.specialty) !== "học phần chung")) {
    lines.push(`Chuyên ngành: ${each(({ course }) => specialtyText(course.specialty))}.`);
  }
  lines.push(`Vị trí trong CTĐT: ${each(({ course }) => placementText(course))}.`);
  const relationsOf = (program: Program, kind: RelationData["kind"]) => program.relations.filter((relation) => relation.courseCode === code && relation.kind === kind);
  let anyRelation = false;
  for (const [kind, name] of [["prerequisite", "Học phần tiên quyết"], ["prior", "Học phần học trước"]] as const) {
    if (!programs.some((program) => relationsOf(program, kind).length)) continue;
    anyRelation = true;
    lines.push(`${name}: ${byPrograms(programs.map((program) => ({
      label: label(program),
      value: [...new Set(relationsOf(program, kind).map((relation) => relationText(relation, program)))].join("; ") || "không có",
    })))}.`);
  }
  if (!anyRelation) lines.push("Không có học phần tiên quyết hay học trước.");

  // One line per applied configuration; codes of merged or same-key courses share one (migrations 038, 041).
  const configs = new Map<string, { labels: string[]; skills: CourseSkillRow["skills"] }>();
  for (const { program } of sorted) {
    const row = skillsOf.get(`${program.revisionId}|${code}`);
    if (!row?.skills.length) continue;
    const entry = configs.get(row.courseId) ?? { labels: [], skills: row.skills };
    if (!entry.labels.includes(label(program))) entry.labels.push(label(program));
    configs.set(row.courseId, entry);
  }
  const skillText = (skills: CourseSkillRow["skills"]) => skills.map((skill) => `${clean(skill.skillName, 100)} ${percent(Number(skill.weight))}`).join(", ");
  if (!configs.size) lines.push("Kỹ năng rèn luyện: Khoa chưa áp dụng cấu hình kỹ năng cho học phần này.");
  else if (configs.size === 1) lines.push(`Kỹ năng rèn luyện (trọng số do Khoa cấu hình): ${skillText([...configs.values()][0]!.skills)}.`);
  else for (const entry of configs.values()) lines.push(`Kỹ năng rèn luyện (${entry.labels.join(", ")}; trọng số do Khoa cấu hình): ${skillText(entry.skills)}.`);
  const description = [...sorted].sort((a, b) => cohortNumber(b.program.cohort) - cohortNumber(a.program.cohort))
    .map(({ course }) => course.description).find(Boolean);
  if (description) lines.push(`Mô tả: ${description}`);
  return chunksOf("course", code, `Học phần ${code} ${newest.course.name}`, "#curriculum", [{ lines }]);
}

/* ------------------------------------------------------------------------ */
/* CTĐT chunks */

function curriculumChunks(program: Program): KnowledgeChunkInput[] {
  const unique = [...new Map(program.courses.map((course) => [course.code, course])).values()];
  const required = unique.filter((course) => /^(BB|BBKTL)$/i.test(course.type)).length;
  const elective = unique.filter((course) => /^TC/i.test(course.type)).length;
  const other = unique.length - required - elective;
  const intro = [
    `Chương trình đào tạo (CTĐT) ngành ${program.major.label}, khóa ${program.cohort}${program.name ? `: ${program.name}` : ""}.`,
    program.admissionYear !== null ? `Năm tuyển sinh: ${program.admissionYear}.` : "",
    `Tổng số tín chỉ của chương trình: ${program.totalCredits !== null ? formatNumber(program.totalCredits) : "CTĐT chưa ghi"}.`,
    `Số học phần trong khung: ${unique.length} (${[required ? `${required} bắt buộc` : "", elective ? `${elective} tự chọn` : "",
      other ? `${other} chưa ghi loại` : ""].filter(Boolean).join(", ")}).`,
  ];
  const specialties = [...new Set(unique.map((course) => course.specialty).filter(isSpecialtyName))];
  if (specialties.length) intro.push(`Chuyên ngành: ${specialties.join(", ")}.`);
  if (unique.some((course) => isConditionOnly(course.code, course.type))) {
    intro.push("Giáo dục thể chất và Giáo dục quốc phòng là môn điều kiện (*): phải đạt nhưng không tính vào tín chỉ tích lũy và điểm trung bình.");
  }

  // Knowledge blocks: the CTĐT's groups with their credits, or the courses' "Khối" column when the workbook has none (K30).
  // A code listed in two groups (K27 71ITDS40503) is listed in both, once each.
  const rowsOf = (match: (course: CourseData) => boolean) => [...new Map(program.courses.filter(match).map((course) => [course.code, course])).values()];
  const blockOf = (course: CourseData) => course.block || "Chưa ghi khối";
  const sections = program.groups.length
    ? program.groups.map((group) => ({ label: group.label, credits: group.credits, courses: rowsOf((course) => course.groupId === group.id), fromGroup: true }))
    : [...new Set(program.courses.map(blockOf))]
      .map((block) => ({ label: block, credits: null, courses: rowsOf((course) => blockOf(course) === block), fromGroup: false }));
  const blockLines = sections.map((section) => {
    const bb = section.courses.filter((course) => /^(BB|BBKTL)$/i.test(course.type));
    const tc = section.courses.length - bb.length;
    const bbCredits = bb.reduce((total, course) => total + (course.credits ?? 0), 0);
    const kinds = [bb.length ? `${bb.length} bắt buộc, ${formatNumber(bbCredits)} tín chỉ bắt buộc` : "", tc ? `${tc} tự chọn` : ""].filter(Boolean).join("; ");
    const count = section.courses.length ? `${section.courses.length} học phần (${kinds})` : "";
    return section.fromGroup
      ? `- ${section.label}: ${credits(section.credits)}${count ? `; ${count}` : ""}.`
      : `- ${section.label}: ${count}.`;
  });
  const electiveLines = program.electives.map((group) =>
    `- ${group.code}: ${group.requiredCredits !== null ? `chọn đủ ${formatNumber(group.requiredCredits)} tín chỉ` : "CTĐT chưa ghi số tín chỉ phải chọn"} trong ${group.courseCodes.length} học phần.`);
  const listBlocks: Block[] = sections.filter((section) => section.courses.length).map((section) => ({
    heading: `Học phần khối ${section.label}`,
    lines: section.courses.map((course) => `- ${course.code} ${course.name}: ${credits(course.credits)}, ${shortTypeText(course.code, course.type)}`
      + `${isSpecialtyName(course.specialty) ? `, chuyên ngành ${course.specialty}` : ""}`),
  }));
  return chunksOf("curriculum", program.id, `Chương trình đào tạo ${programTitle(program)}`, "#curriculum", [
    { lines: intro },
    { heading: program.groups.length ? "Khối kiến thức (tín chỉ yêu cầu theo CTĐT)" : "Khối kiến thức (theo cột Khối của CTĐT)", lines: blockLines },
    { heading: "Nhóm tự chọn", lines: electiveLines },
    ...listBlocks,
  ]);
}

/* ------------------------------------------------------------------------ */
/* Skill, career and field chunks */

type CourseRef = { code: string; name: string; weight: number };

function skillChunks(skill: SkillRow, courses: readonly CourseRef[], careers: readonly { code: string; name: string; isRequired: boolean }[]): KnowledgeChunkInput[] {
  const name = clean(skill.name, 100);
  const description = clean(skill.description, 600);
  const scope = skill.hasProfile ? clean(skill.scope, 800) : "";
  const groups = skill.hasProfile ? arrayOf(skill.groups).map((group) => clean(group, 160)).filter(Boolean) : [];
  const intro = [
    `Kỹ năng: ${name}.`,
    groups.length ? `Nhóm năng lực: ${groups.join(", ")}.` : "",
    description ? `Mô tả: ${description}` : "",
    scope && scope !== description ? `Phạm vi kỹ năng trong chương trình đào tạo: ${scope}` : "",
    courses.length ? "" : "Chưa có học phần nào trong các chương trình đào tạo hiện hành rèn luyện kỹ năng này.",
  ];
  return chunksOf("skill", skill.id, `Kỹ năng ${name}`, "#skill-gap", [
    { lines: intro },
    { heading: "Học phần rèn luyện kỹ năng này (trọng số do Khoa cấu hình)", lines: courses.map((course) => `- ${course.code} ${course.name}: ${percent(course.weight)}`) },
    { heading: "Vị trí nghề nghiệp yêu cầu kỹ năng này", lines: careers.map((career) => `- ${career.code} ${career.name} (${career.isRequired ? "Bắt buộc" : "Ưu tiên"})`) },
  ]);
}

const thresholdLine = () => `Trên trang Khoảng trống kỹ năng, kỹ năng Bắt buộc đạt khi từ ${formatNumber(CAREER_THRESHOLDS.required)} điểm `
  + `(mức ${CAREER_THRESHOLDS.required === LEVEL_THRESHOLDS.proficient ? "Giỏi" : formatNumber(CAREER_THRESHOLDS.required)}), kỹ năng Ưu tiên khi từ `
  + `${formatNumber(CAREER_THRESHOLDS.preferred)} điểm (mức ${CAREER_THRESHOLDS.preferred === LEVEL_THRESHOLDS.good ? "Khá" : formatNumber(CAREER_THRESHOLDS.preferred)}).`;

function careerChunks(career: CareerRow): KnowledgeChunkInput[] {
  const code = clean(career.code, 40);
  const nameVi = clean(career.nameVi, 200);
  const nameEn = clean(career.nameEn, 200);
  const description = clean(career.description, 1000);
  const requirements = arrayOf(career.requirements).map((value) => {
    const item = recordOf(value);
    const title = clean(item.title, 160);
    const skill = clean(item.skillName, 100);
    const label = skill && fold(skill) !== fold(title) ? `${title || skill}${title ? ` (kỹ năng ${skill})` : ""}` : title || skill;
    const detail = clean(item.description, 300);
    return `- ${label} (${item.isRequired === true ? "Bắt buộc" : "Ưu tiên"})${detail ? `: ${detail}` : ""}`;
  });
  return chunksOf("career", code, `Vị trí nghề nghiệp ${code} ${nameVi}`, "#career", [
    { lines: [
      `Vị trí nghề nghiệp ${code}: ${nameVi}${nameEn && fold(nameEn) !== fold(nameVi) ? ` (tiếng Anh: ${nameEn})` : ""}.`,
      `Lĩnh vực: ${clean(career.fieldName, 160)}.`,
      description ? `Mô tả: ${description}` : "",
      requirements.length ? thresholdLine() : "Vị trí nghề nghiệp chưa có yêu cầu kỹ năng.",
    ] },
    { heading: "Yêu cầu kỹ năng của vị trí nghề nghiệp", lines: requirements },
  ]);
}

function fieldChunks(field: FieldRow, careers: readonly CareerRow[]): KnowledgeChunkInput[] {
  const name = clean(field.name, 160);
  const description = clean(field.description, 1000);
  return chunksOf("field", clean(field.code, 40), `Lĩnh vực nghề nghiệp ${name}`, "#career", [
    { lines: [`Lĩnh vực nghề nghiệp: ${name}.`, description ? `Mô tả: ${description}` : "", careers.length ? "" : "Lĩnh vực chưa có vị trí nghề nghiệp nào trong danh mục."] },
    { heading: `Các vị trí nghề nghiệp trong lĩnh vực (${careers.length})`, lines: careers.map((career) => {
      const nameEn = clean(career.nameEn, 200);
      return `- ${clean(career.code, 40)} ${clean(career.nameVi, 200)}${nameEn && fold(nameEn) !== fold(career.nameVi) ? ` (${nameEn})` : ""}`;
    }) },
  ]);
}

/* ------------------------------------------------------------------------ */
/* KHĐT chunks */

function planChunks(row: PlanRow): KnowledgeChunkInput[] {
  const data = recordOf(row.data);
  const major = majorInfo(data.major);
  const cohort = clean(row.cohortCode, 20).toUpperCase();
  const name = clean(data.name, 300);
  const total = toNumber(data.totalCredits);
  const terms = arrayOf(data.terms).map((value) => {
    const item = recordOf(value);
    return { code: clean(item.code, 20).toUpperCase(), semester: toInteger(item.semester), studyYear: toInteger(item.studyYear), credits: toNumber(item.sourceCredits) };
  }).filter((term) => term.code);
  const sections = new Map(arrayOf(data.sections).map((value) => {
    const item = recordOf(value);
    return [clean(item.id, 100), clean(item.label, 200).replace(/^Chọn(\d)/, "Chọn $1")] as const;
  }));
  const items = arrayOf(data.items).map((value) => {
    const item = recordOf(value);
    return {
      code: codeKey(item.code), name: clean(item.name, 300), credits: toNumber(item.credits), type: clean(item.type, 60),
      termCode: clean(item.termCode, 20).toUpperCase(), sectionId: clean(item.sectionId, 100),
    };
  }).filter((item) => item.name);
  const title = `Kế hoạch đào tạo ${major.label} ${cohort}`;
  // "HK1 2023–2024 (năm thứ 1, học kỳ 1)": the term as the pages write it (user review 2026-10-30), with the words a
  // question uses ("năm thứ 1", "học kỳ 1") for the search.
  const termTitle = (term: (typeof terms)[number]) => /^HK\d{2}[1-3]$/.test(term.code)
    ? `${termName(term.code)} (${term.studyYear !== null ? `năm thứ ${term.studyYear}, ` : ""}học kỳ ${term.code.slice(4)})`
    : `${term.code}${term.studyYear !== null ? ` (năm thứ ${term.studyYear})` : ""}`;
  const itemLine = (item: (typeof items)[number]) =>
    `- ${item.code ? `${item.code} ` : ""}${item.name}: ${credits(item.credits)}, ${shortTypeText(item.code, item.type)}`;

  const overview = chunksOf("plan", row.id, title, "#plans", [
    { lines: [
      `Kế hoạch đào tạo (KHĐT) ngành ${major.label}, khóa ${cohort}${name ? `: ${name}` : ""}.`,
      total !== null ? `Tổng số tín chỉ theo kế hoạch: ${formatNumber(total)}.` : "",
      "KHĐT là kế hoạch giảng dạy dự kiến của Khoa theo từng học kỳ, không phải đăng ký học phần của bạn.",
    ] },
    { heading: `Các học kỳ (${terms.length}) và số tín chỉ theo kế hoạch`, lines: terms.map((term) =>
      `- ${termTitle(term)}: ${credits(term.credits)}, ${items.filter((item) => item.termCode === term.code).length} học phần`) },
  ]);
  const perTerm = terms.flatMap((term) => {
    const planned = items.filter((item) => item.termCode === term.code);
    if (!planned.length) return [];
    const blocks: Block[] = [
      { lines: [
        `Kế hoạch đào tạo ngành ${major.label} khóa ${cohort}, ${termTitle(term)}.`,
        `Số tín chỉ theo kế hoạch: ${term.credits !== null ? formatNumber(term.credits) : "KHĐT chưa ghi"}.`,
      ] },
      { heading: "Học phần", lines: planned.filter((item) => !sections.has(item.sectionId)).map(itemLine) },
    ];
    for (const [id, label] of sections) {
      const lines = planned.filter((item) => item.sectionId === id).map(itemLine);
      if (lines.length) blocks.push({ heading: label || "Nhóm học phần", lines });
    }
    return chunksOf("plan", `${row.id}:${term.code}`, `${title} – ${term.code}`, "#plans", blocks);
  });
  return [...overview, ...perTerm];
}

/* ------------------------------------------------------------------------ */
/* Graduation chunks */

function graduationChunks(row: StandardRow): KnowledgeChunkInput[] {
  const data = recordOf(row.data);
  const cohort = clean(row.cohortCode, 20).toUpperCase();
  const name = clean(data.name, 300);
  const specialty = clean(data.specialty, 200);
  const scale = toNumber(data.gpaScale) ?? 4;
  const value = (key: string) => toNumber(data[key]);
  const groups = arrayOf(data.groups).map((item) => {
    const group = recordOf(item);
    return { id: clean(group.id, 100), name: clean(group.name, 200), kind: group.kind === "mandatory" ? "mandatory" : "elective", minimumCredits: toNumber(group.minimumCredits) };
  }).filter((group) => group.id);
  const courses = arrayOf(data.courses).map((item) => {
    const course = recordOf(item);
    return {
      groupId: clean(course.groupId, 100), code: codeKey(course.code), name: clean(course.name, 300), credits: toNumber(course.credits),
      conditionOnly: course.conditionOnly === true, alternativeCodes: arrayOf(course.alternativeCodes).map(codeKey).filter(Boolean),
    };
  }).filter((course) => course.code);
  const sameName = (group: (typeof groups)[number]) => groups.filter((other) => other.name === group.name).length > 1;
  // Repeated group names ("Nhóm tự chọn TC102" twice) are told apart by their size and first code, as on the student page.
  const groupName = (group: (typeof groups)[number]) => {
    const own = courses.filter((course) => course.groupId === group.id);
    return sameName(group) && own[0] ? `${group.name} (${own.length} môn, từ ${own[0].code})` : group.name || "Nhóm môn";
  };
  const minimum = value("minimumCredits");
  const kinds = ([["mandatoryCredits", "bắt buộc"], ["electiveCredits", "tự chọn"], ["freeElectiveCredits", "tự chọn tự do"]] as const)
    .flatMap(([key, label]) => { const amount = value(key); return amount === null ? [] : [`${label} ${formatNumber(amount)}`]; }).join(", ");
  const gpa = value("minimumGpa");
  const thresholds = [
    minimum !== null ? `tích lũy tối thiểu ${formatNumber(minimum)} tín chỉ${kinds ? ` (${kinds})` : ""}` : "",
    gpa !== null ? `điểm trung bình tích lũy tối thiểu ${formatNumber(gpa)} (thang ${formatNumber(scale)})` : "",
  ].filter(Boolean);
  // A mandatory group needs every course, an elective group its credits (competency-assessment/graduation.ts).
  const groupLines = groups.map((group) => {
    const count = courses.filter((course) => course.groupId === group.id).length;
    const named = fold(group.name).includes(group.kind === "mandatory" ? "bat buoc" : "tu chon");
    const kind = named ? "" : group.kind === "mandatory" ? "nhóm bắt buộc, " : "nhóm tự chọn, ";
    const listed = count ? ` trong ${count} môn` : " (tiêu chuẩn chưa liệt kê môn của nhóm)";
    return group.kind === "mandatory"
      ? `- ${groupName(group)}: ${kind}${count ? `cần đạt tất cả ${count} môn` : "cần đạt các môn của nhóm (tiêu chuẩn chưa liệt kê môn)"}`
        + `${group.minimumCredits !== null ? ` (yêu cầu ${formatNumber(group.minimumCredits)} tín chỉ)` : ""}.`
      : `- ${groupName(group)}: ${kind}cần đủ ${group.minimumCredits !== null ? `${formatNumber(group.minimumCredits)} tín chỉ` : "số tín chỉ chưa ghi"}${listed}.`;
  });
  const courseBlocks: Block[] = groups.map((group) => ({
    heading: `Môn của ${groupName(group)}`,
    lines: courses.filter((course) => course.groupId === group.id).map((course) => `- ${course.code} ${course.name}`
      + `${course.credits !== null ? `: ${credits(course.credits)}` : ""}${course.conditionOnly && !course.name.includes("(*)") ? ", môn điều kiện (*)" : ""}`
      + `${course.alternativeCodes.length ? `, mã khác: ${course.alternativeCodes.join(", ")}` : ""}`),
  }));
  const title = `Tiêu chuẩn xét tốt nghiệp ${cohort}${specialty ? ` ${specialty}` : " (chung của khóa)"}`;
  return chunksOf("graduation", row.id, title, "#graduation", [
    { lines: [
      `Tiêu chuẩn xét tốt nghiệp ${name || cohort}.`,
      `Khóa ${cohort}; ngành ${clean(data.major, 200) || "chưa ghi"}; ${specialty ? `chuyên ngành ${specialty}` : "tiêu chuẩn chung của khóa (không theo chuyên ngành)"}`
        + `${clean(data.classBlock, 100) ? `; khối lớp ${clean(data.classBlock, 100)}` : ""}.`,
      thresholds.length ? `Ngưỡng xét tốt nghiệp: ${thresholds.join("; ")}.` : "",
      clean(data.notes, 500),
      "Tiêu chuẩn của mỗi sinh viên được chọn theo khóa trong tài khoản và chuyên ngành trong hồ sơ; kết quả xét tốt nghiệp chính thức do nhà trường công bố.",
    ] },
    { heading: "Các nhóm điều kiện", lines: groupLines },
    ...courseBlocks,
  ]);
}

/* ------------------------------------------------------------------------ */
/* Guides and self-study resources */

const guideChunks = (): KnowledgeChunkInput[] =>
  portalGuides().flatMap((guide) => chunksOf("guide", guide.key, guide.title, guide.link, [{ lines: guide.content.split("\n") }]));

const RESOURCE_WORDS: Record<string, string> = {
  course: "khóa học", documentation: "tài liệu", docs: "tài liệu", tutorial: "hướng dẫn", video: "video", book: "sách", article: "bài viết",
  practice: "bài tập thực hành", exercise: "bài tập thực hành", interactive: "bài tập thực hành", certification: "chứng chỉ", project: "dự án mẫu",
  beginner: "cơ bản", intermediate: "trung cấp", advanced: "nâng cao", all: "mọi trình độ", vi: "tiếng Việt", en: "tiếng Anh",
  // The level codes of learning-resources.json.
  "co-ban": "cơ bản", "trung-cap": "trung cấp", "nang-cao": "nâng cao",
};
const resourceWord = (value: string | null) => (value ? RESOURCE_WORDS[value.trim().toLowerCase()] ?? clean(value, 60) : "");
/** The resource key of a skill: its name folded (no accents, lower case), so a lookup by name needs no catalog id. */
export const resourceKey = (skill: string) => {
  const key = fold(skill);
  return key.length <= 200 ? key : `${key.slice(0, 180)}~${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
};

function resourceChunks(resources: LearningResources): KnowledgeChunkInput[] {
  const checked = resources.checkedAt && /^\d{4}-\d{2}-\d{2}/.test(resources.checkedAt)
    ? resources.checkedAt.slice(0, 10).split("-").reverse().join("/") : clean(resources.checkedAt, 40);
  // Entries that name the same skill (whitespace, case or accents aside) become one list.
  const bySkill = new Map<string, { skill: string; resources: LearningResource[] }>();
  for (const entry of resources.skills) {
    const key = resourceKey(entry.skill);
    if (!key) continue;
    const known = bySkill.get(key) ?? { skill: entry.skill, resources: [] };
    for (const resource of entry.resources) if (!known.resources.some((item) => item.url === resource.url)) known.resources.push(resource);
    bySkill.set(key, known);
  }
  return [...bySkill].flatMap(([key, entry]) => chunksOf("resource", key, `Tài liệu tự học: ${entry.skill}`, null, [
    { lines: [`Tài liệu tự học cho kỹ năng ${entry.skill}${checked ? ` (danh sách EduPath AI tuyển chọn, kiểm tra ngày ${checked})` : " (danh sách EduPath AI tuyển chọn)"}.`] },
    { heading: "Tài liệu", lines: entry.resources.map((resource) => {
      const details = [resourceWord(resource.type), resourceWord(resource.language), resourceWord(resource.level),
        resource.free === true ? "miễn phí" : resource.free === false ? "có phí" : ""].filter(Boolean).join(", ");
      return `- ${clean(resource.title, 200)}${resource.provider ? ` – ${clean(resource.provider, 100)}` : ""}${details ? ` (${details})` : ""}: ${resource.url}`
        + `${resource.note ? ` – ${clean(resource.note, 300)}` : ""}`;
    }) },
  ]));
}

/* ------------------------------------------------------------------------ */
/* The index */

/** Every chunk of the catalogs (pure: readKnowledgeCatalog reads them), in KNOWLEDGE_SOURCE_KINDS order; a repeated key keeps its first chunk. */
export function knowledgeChunksFrom(catalog: KnowledgeCatalog): KnowledgeChunkInput[] {
  const programs = catalog.curricula.map(readProgram).sort(programOrder);
  const skillsOf = new Map(catalog.courseSkills.map((row) => [`${row.revisionId}|${codeKey(row.code)}`, { ...row, skills: arrayOf(row.skills) as CourseSkillRow["skills"] }]));

  // Courses: every code of the current revisions, with each row that lists it (a code can repeat in other groups).
  const occurrences = new Map<string, Occurrence[]>();
  for (const program of programs) for (const course of program.courses) occurrences.set(course.code, [...(occurrences.get(course.code) ?? []), { program, course }]);
  const newestName = new Map([...occurrences].map(([code, list]) => [code,
    [...list].sort((a, b) => cohortNumber(b.program.cohort) - cohortNumber(a.program.cohort))[0]!.course.name]));
  const courses = [...occurrences.keys()].sort().flatMap((code) => courseChunks(code, occurrences.get(code)!, skillsOf));

  // Skills: the courses that build them (applied links of the current revisions) and the careers that ask for them.
  const coursesOf = new Map<string, Map<string, CourseRef>>();
  for (const row of skillsOf.values()) {
    const code = codeKey(row.code);
    for (const skill of row.skills) {
      const refs = coursesOf.get(skill.skillId) ?? new Map<string, CourseRef>();
      const weight = Number(skill.weight);
      if ((refs.get(code)?.weight ?? -1) < weight) refs.set(code, { code, name: newestName.get(code) ?? code, weight });
      coursesOf.set(skill.skillId, refs);
    }
  }
  const careersOf = new Map<string, { code: string; name: string; isRequired: boolean }[]>();
  for (const career of catalog.careers) {
    for (const requirement of arrayOf(career.requirements).map(recordOf)) {
      if (typeof requirement.skillId !== "string") continue;
      const list = careersOf.get(requirement.skillId) ?? [];
      if (!list.some((item) => item.code === career.code)) list.push({ code: clean(career.code, 40), name: clean(career.nameVi, 200), isRequired: requirement.isRequired === true });
      careersOf.set(requirement.skillId, list);
    }
  }
  const skills = catalog.skills.filter((skill) => skill.hasProfile || careersOf.has(skill.id)).flatMap((skill) => skillChunks(skill,
    [...(coursesOf.get(skill.id)?.values() ?? [])].sort((a, b) => b.weight - a.weight || a.code.localeCompare(b.code)),
    (careersOf.get(skill.id) ?? []).sort((a, b) => Number(b.isRequired) - Number(a.isRequired) || a.code.localeCompare(b.code))));

  const chunks = [
    ...guideChunks(),
    ...catalog.careers.flatMap(careerChunks),
    ...catalog.fields.flatMap((field) => fieldChunks(field, catalog.careers.filter((career) => career.fieldCode === field.code))),
    ...skills,
    ...courses,
    ...programs.flatMap(curriculumChunks),
    ...catalog.plans.flatMap(planChunks),
    ...catalog.standards.flatMap(graduationChunks),
    ...(catalog.resources ? resourceChunks(catalog.resources) : []),
  ].filter((chunk) => chunk.sourceKey && chunk.content);
  const seen = new Set<string>();
  return chunks.filter((chunk) => {
    const key = `${chunk.sourceKind}\u0000${chunk.sourceKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every chunk of the shared knowledge index, from the catalog tables and the resources file. */
export async function buildKnowledgeChunks(db: Db, options: KnowledgeOptions = {}): Promise<KnowledgeChunkInput[]> {
  return knowledgeChunksFrom(await readKnowledgeCatalog(db, options));
}

/* ------------------------------------------------------------------------ */
/* Refresh */

type StoredChunk = { id: string; kind: string; key: string; hash: string };

/** sha256 (hex) of the chunk's title, content and link: what decides whether its embedding is still valid. */
export function chunkHash(chunk: Pick<KnowledgeChunkInput, "title" | "content" | "link">): string {
  return createHash("sha256").update(JSON.stringify([chunk.title, chunk.content, chunk.link])).digest("hex");
}

/** What a refresh writes: the chunks that are new or whose text changed, and the ids of stored rows no longer produced. */
export function planKnowledgeRefresh(chunks: readonly KnowledgeChunkInput[], stored: readonly StoredChunk[]):
  { writes: (KnowledgeChunkInput & { hash: string })[]; deletes: string[] } {
  const key = (kind: string, sourceKey: string) => `${kind}\u0000${sourceKey}`;
  const produced = new Map<string, KnowledgeChunkInput>();
  for (const chunk of chunks) if (!produced.has(key(chunk.sourceKind, chunk.sourceKey))) produced.set(key(chunk.sourceKind, chunk.sourceKey), chunk);
  const hashes = new Map(stored.map((row) => [key(row.kind, row.key), row.hash]));
  return {
    writes: [...produced.values()].map((chunk) => ({ ...chunk, hash: chunkHash(chunk) }))
      .filter((chunk) => hashes.get(key(chunk.sourceKind, chunk.sourceKey)) !== chunk.hash),
    deletes: stored.filter((row) => !produced.has(key(row.kind, row.key))).map((row) => row.id),
  };
}

/** New rows are inserted; a changed text replaces the row's and clears its embedding; an unchanged row is left as it is. */
const UPSERT_SQL = `INSERT INTO ai_knowledge_chunks(id,source_kind,source_key,title,content,link,content_hash)
  SELECT x.id,x.kind,x.key,x.title,x.content,x.link,x.hash
    FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,kind text,key text,title text,content text,link text,hash text)
  ON CONFLICT (source_kind,source_key) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,link=EXCLUDED.link,
    content_hash=EXCLUDED.content_hash,embedding=NULL,embedding_model=NULL,updated_at=now()
    WHERE ai_knowledge_chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash
  RETURNING (xmax=0) AS inserted`;

/**
 * Rebuilds the index from the catalogs: inserts new chunks, rewrites changed ones (their embedding is cleared, so the next
 * enqueueKnowledgeEmbeddings embeds them again) and deletes rows no longer produced. Counts come from the database.
 */
export async function refreshKnowledge(db: Db, options: KnowledgeOptions = {}): Promise<KnowledgeRefreshResult> {
  const chunks = await buildKnowledgeChunks(db, options);
  const stored = await db.query<StoredChunk>("SELECT id,source_kind AS kind,source_key AS key,content_hash AS hash FROM ai_knowledge_chunks");
  const { writes, deletes } = planKnowledgeRefresh(chunks, stored.rows);
  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  if (writes.length) {
    const rows = writes.map((chunk) => ({ id: randomUUID(), kind: chunk.sourceKind, key: chunk.sourceKey, title: chunk.title, content: chunk.content, link: chunk.link, hash: chunk.hash }));
    const result = await db.query<{ inserted: boolean }>(UPSERT_SQL, [JSON.stringify(rows)]);
    inserted = result.rows.filter((row) => row.inserted).length;
    updated = result.rows.length - inserted;
  }
  if (deletes.length) deleted = (await db.query("DELETE FROM ai_knowledge_chunks WHERE id=ANY($1::uuid[])", [deletes])).rowCount ?? 0;
  return { inserted, updated, deleted, total: chunks.length };
}

/** A database error by its SQLSTATE, any other error by its name: never its message, which can hold catalog text. */
function refreshErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Rate-limited refresh (at most once per interval per returned function, never two at once), for the worker router or a
 * timer. Never throws: an error is logged by its code and reads false, as does a call within the interval.
 */
export function createKnowledgeRefresh(intervalMs: number = KNOWLEDGE_REFRESH_INTERVAL_MS, options: KnowledgeOptions = {}) {
  let last = Number.NEGATIVE_INFINITY;
  let running = false;
  return async (db: Db): Promise<boolean> => {
    const now = Date.now();
    if (running || now - last < intervalMs) return false;
    last = now;
    running = true;
    try {
      const result = await refreshKnowledge(db, options);
      if (result.inserted || result.updated || result.deleted) {
        console.log(`[assistant] knowledge index: ${result.inserted} new, ${result.updated} changed, ${result.deleted} removed, ${result.total} chunks`);
      }
      return true;
    } catch (error) {
      console.error(`[assistant] knowledge refresh failed (${refreshErrorCode(error)})`);
      return false;
    } finally {
      running = false;
    }
  };
}
