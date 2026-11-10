import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { requireAdminAccess } from "../middleware/authorization.js";
import { AccountError, type AdminAccountRepository } from "./accounts.js";
import type { SpecialtyCode } from "../competency-assessment/types.js";
import { CONSENT_VALID_SINCE } from "../student/consent.js";
import { withoutSettledReviews, type TranscriptData } from "../student/transcript-parser.js";
import { byGivenName, byOrder, byText, orderBy, sortSchema, type OwnOrder, type SortDirection } from "./table-sort.js";
import { auditActorOf, recordAudit } from "./audit/record.js";
import { CLASS_OF } from "../advisors/model.js";

export interface StudentProfileQuery {
  q: string; page: number; pageSize: number;
  cohortYear?: number | undefined;
  cohortCode?: string | undefined;
  active?: "true" | "false" | undefined;
  profileStatus?: "missing" | "incomplete" | "complete" | undefined;
  /** A column of the list (studentSort) or "stt", the list's own order; table-sort.ts. */
  sort?: string | undefined; dir?: SortDirection | undefined;
}
interface StudentProfileSummary {
  /** The row's number in the list's own order (by name), kept when the list is sorted by a column. */
  stt?: number;
  id: string; name: string; email: string | null; isActive: boolean;
  studentCode: string | null; cohortYear: number | null;
  cohortCode: string | null; className: string | null;
  /** The class as a canonical code (CNTT08 of K29 → 71K29CNTT08, advisors/class-code.ts), as the admin portal shows and
   *  matches it; className stays the profile's own text, which the student page shows. Null without a class. */
  classCode: string | null;
  profileStatus: "missing" | "incomplete" | "complete";
}
export interface StudentProfileDetail extends StudentProfileSummary {
  /** student_profiles.major_code: the programme code of the MSSV (7480201 CNTT, 7480104 HTTT, 7480102 MMT&TTDL; 052). */
  majorCode?: string | null;
  /** student_profiles.specialty; null = "Chưa xác định". */
  specialty?: SpecialtyCode | null;
  careerPositionId?: string | null;
  careerPosition?: { id: string; nameVi: string; nameEn: string; deletedAt: string | null } | null;
  interests: string | null;
  /** When the profile survey was last saved (stu_profile_surveys); the answers stay with the student. */
  surveyUpdatedAt?: string | null;
  /** The survey has the interest lists (survey-v2) and the student agreed to the current policy for it, or a cố vấn học tập
   *  or the Khoa filled it in for the student (SURVEY_COMPLETE_SQL). */
  surveyComplete?: boolean;
  /** The student withdrew the consent for the survey (Xóa câu trả lời) and has not given it again: no one fills it in for them. */
  surveyWithdrawn?: boolean;
  /** A transcript is stored (the student pages list what the profile still lacks). */
  hasTranscript?: boolean;
  username: string | null; careerGoal: string | null;
  accountCreatedAt: string; firstLoginAt: string; lastLoginAt: string;
  profileCreatedAt: string | null; profileUpdatedAt: string | null;
}
export interface StudentProfilePage { items: StudentProfileSummary[]; total: number; cohortYears: number[]; cohortCodes: string[] }
/**
 * A student's transcript for the admin portal (user, 2026-10-25): the scores as the student page shows them, never the PDF;
 * null when none is stored. Every stored transcript counts, those imported before policy 2026-10-26 included (user,
 * 2026-10-26: "Những bảng điểm trước đó auto duyệt hết đi"); a new import agrees to that policy.
 */
export interface AdminTranscriptView { transcript: { updatedAt: string; data: TranscriptData } | null }
export interface StudentProfileRepository {
  list(actor: AuthenticatedUser, query: StudentProfileQuery): Promise<StudentProfilePage>;
  detail(actor: AuthenticatedUser, id: string): Promise<StudentProfileDetail>;
  transcript(actor: AuthenticatedUser, id: string): Promise<AdminTranscriptView>;
}
// The survey counts when it holds the interest lists (survey-v3 or later; v4 dropped the written strengths, 050, 051) and the student's consent for it
// still counts (consent.ts isValidConsent; the constant is code, not input), or a cố vấn học tập or the Khoa filled it in
// for the student (062 saved_by_role, policy 2026-11-10) and the student has not withdrawn that consent: the rule of
// student/survey.ts surveyUsable.
export const SURVEY_COMPLETE_SQL = `EXISTS (SELECT 1 FROM stu_profile_surveys s WHERE s.user_id = u.id
    AND s.survey_version NOT IN ('survey-v1', 'survey-v2') AND cardinality(s.interest_tech) > 0 AND cardinality(s.interest_hobbies) > 0
    AND (EXISTS (SELECT 1 FROM data_consents c WHERE c.user_id = s.user_id AND c.purpose = 'profile_survey' AND c.ended_at IS NULL
      AND c.policy_version >= '${CONSENT_VALID_SINCE}')
      OR (s.saved_by_role IS NOT NULL
        AND (EXISTS (SELECT 1 FROM data_consents c WHERE c.user_id = s.user_id AND c.purpose = 'profile_survey' AND c.ended_at IS NULL)
          OR NOT EXISTS (SELECT 1 FROM data_consents c WHERE c.user_id = s.user_id AND c.purpose = 'profile_survey' AND c.end_reason = 'withdrawn')))))`;
const surveyComplete = SURVEY_COMPLETE_SQL;
// Derive completion from saved data so profile edits and transcript deletion stay in sync. Since 2026-10-24 the
// specialty and the profile survey count too (the student portal asks for both before its AI features); the interests
// (technologies and free-time interests) are part of the survey.
const profileStatus = `CASE WHEN p.user_id IS NULL THEN 'missing'
  WHEN p.career_position_id IS NOT NULL
    AND p.specialty IS NOT NULL
    AND EXISTS (SELECT 1 FROM student_transcripts t WHERE t.user_id = p.user_id)
    AND ${surveyComplete}
  THEN 'complete' ELSE 'incomplete' END`;
const summaryColumns = `u.id, COALESCE(p.full_name, u.display_name) AS name, u.email, u.is_active AS "isActive",
  p.cohort_code AS "cohortCode", p.class_name AS "className", ${CLASS_OF} AS "classCode",
  p.student_code AS "studentCode", p.cohort_year AS "cohortYear",
  ${profileStatus} AS "profileStatus"`;
const studentScope = `(COALESCE(u.role_override, u.role) = 'student' OR u.is_student)`;
/**
 * A cố vấn học tập (role advisor, 2026-11-03) sees only the students of the classes the Khoa gave them; the parameter is
 * the advisor's id, NULL for every other role. Classes compare as canonical codes (advisors/class-code.ts: CNTT08 of K29
 * is 71K29CNTT08), as ad_advisor_classes stores them.
 */
const advisedScope = (parameter: string) => `(${parameter}::uuid IS NULL OR ${CLASS_OF}
  IN (SELECT class_name FROM ad_advisor_classes WHERE advisor_user_id = ${parameter}::uuid))`;
const advisorOf = (actor: AuthenticatedUser) => (actor.role === "advisor" ? actor.userId : null);
// The columns the list sorts by (web StudentProfiles.tsx); Hồ sơ goes from complete to missing, Tài khoản from active to locked.
const studentSort = {
  name: byGivenName("name"), studentCode: byText('"studentCode"'), cohortCode: byText('"cohortCode"'), className: byText('"classCode"'),
  cohortYear: ['"cohortYear"'], profileStatus: byOrder('"profileStatus"', ["complete", "incomplete", "missing"]), isActive: byOrder('"isActive"', ["true", "false"])
};
const studentOrder: OwnOrder = [["name", "ASC"], ["id", "ASC"]];

export class PostgresStudentProfileRepository implements StudentProfileRepository {
  constructor(private readonly pool: DatabasePool) {}
  async list(actor: AuthenticatedUser, query: StudentProfileQuery): Promise<StudentProfilePage> {
    const order = orderBy(studentSort, studentOrder, query.sort, query.dir);
    const result = await this.pool.query<StudentProfilePage>(`WITH students AS (
      SELECT ${summaryColumns}, concat_ws(' ', u.display_name, p.full_name, u.email, u.username, p.student_code, p.cohort_code, p.class_name, ${CLASS_OF}, p.career_goal) AS search_text
      FROM users u LEFT JOIN student_profiles p ON p.user_id = u.id WHERE ${studentScope} AND ${advisedScope("$8")}
    ), filtered AS (
      SELECT id, name, email, "isActive", "studentCode", "cohortCode", "className", "classCode", "cohortYear", "profileStatus" FROM students
      WHERE ($1 = '' OR strpos(lower(search_text), lower($1)) > 0)
        AND ($2::int IS NULL OR "cohortYear" = $2)
        AND ($3::text IS NULL OR "cohortCode" = $3)
        AND ($4::boolean IS NULL OR "isActive" = $4)
        AND ($5::text IS NULL OR "profileStatus" = $5)
    ), numbered AS (SELECT filtered.*, row_number() OVER (ORDER BY ${orderBy(studentSort, studentOrder)})::int AS stt FROM filtered),
    paged AS (SELECT * FROM numbered ORDER BY ${order} LIMIT $6 OFFSET $7)
    SELECT COALESCE((SELECT json_agg(paged ORDER BY ${order}) FROM paged), '[]'::json) AS items,
      (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT json_agg(year ORDER BY year DESC) FROM (SELECT DISTINCT "cohortYear" AS year FROM students WHERE "cohortYear" IS NOT NULL) years), '[]'::json) AS "cohortYears",
      COALESCE((SELECT json_agg(code ORDER BY code DESC) FROM (SELECT DISTINCT "cohortCode" AS code FROM students WHERE "cohortCode" IS NOT NULL) codes), '[]'::json) AS "cohortCodes"`,
    [query.q, query.cohortYear ?? null, query.cohortCode ?? null, query.active ?? null, query.profileStatus ?? null, query.pageSize, (query.page - 1) * query.pageSize,
      advisorOf(actor)]);
    return result.rows[0] ?? { items: [], total: 0, cohortYears: [], cohortCodes: [] };
  }
  async detail(_actor: AuthenticatedUser, id: string): Promise<StudentProfileDetail> {
    const result = await this.pool.query<StudentProfileDetail>(`SELECT ${summaryColumns}, u.username,
      p.career_goal AS "careerGoal", p.career_position_id AS "careerPositionId", p.specialty, p.major_code AS "majorCode",
      (SELECT json_build_object('id',c.id,'nameVi',c.name_vi,'nameEn',c.name_en,'deletedAt',c.deleted_at) FROM career_positions c WHERE c.id=p.career_position_id) AS "careerPosition", p.interests,
      (SELECT s.updated_at FROM stu_profile_surveys s WHERE s.user_id=u.id) AS "surveyUpdatedAt", ${surveyComplete} AS "surveyComplete",
      (NOT EXISTS (SELECT 1 FROM data_consents c WHERE c.user_id=u.id AND c.purpose='profile_survey' AND c.ended_at IS NULL)
        AND EXISTS (SELECT 1 FROM data_consents c WHERE c.user_id=u.id AND c.purpose='profile_survey' AND c.end_reason='withdrawn')) AS "surveyWithdrawn",
      EXISTS (SELECT 1 FROM student_transcripts t WHERE t.user_id = u.id) AS "hasTranscript", u.created_at AS "accountCreatedAt", u.first_login_at AS "firstLoginAt",
      u.last_login_at AS "lastLoginAt", p.created_at AS "profileCreatedAt", p.updated_at AS "profileUpdatedAt"
      FROM users u LEFT JOIN student_profiles p ON p.user_id = u.id
      WHERE (${studentScope} OR u.id = $2::uuid) AND u.id = $1 AND ${advisedScope("$3")}`, [id, _actor.userId === id ? id : null, advisorOf(_actor)]);
    if (!result.rows[0]) throw new AccountError("student_not_found", 404);
    return result.rows[0];
  }
  async transcript(actor: AuthenticatedUser, id: string): Promise<AdminTranscriptView> {
    const result = await this.pool.query<{ updatedAt: string | null; data: TranscriptData | null; studentCode: string | null; name: string | null }>(`SELECT
      t.updated_at AS "updatedAt", t.parsed_data AS data, p.student_code AS "studentCode", COALESCE(p.full_name, u.display_name) AS name
      FROM users u LEFT JOIN student_transcripts t ON t.user_id = u.id LEFT JOIN student_profiles p ON p.user_id = u.id
      WHERE u.id = $1 AND ${studentScope} AND ${advisedScope("$2")}`, [id, advisorOf(actor)]);
    const row = result.rows[0];
    if (!row) throw new AccountError("student_not_found", 404);
    if (!row.updatedAt || !row.data) return { transcript: null };
    // Nhật ký thao tác (AD-REPORT-11, 2026-10-31): every look at a student's grades is logged, who looked at whose
    // transcript, never the grades. The write never fails the read.
    const student = [row.studentCode, row.name].filter(Boolean).join(" ") || id;
    await recordAudit(this.pool, auditActorOf(actor), { kind: "access", action: "Xem bảng điểm", summary: `Xem bảng điểm của sinh viên ${student}`,
      targetType: "student", targetId: id, method: "GET", path: `/api/admin/students/${id}/transcript` });
    // Marks that are not errors are left out, as on the student page (withoutSettledReviews).
    return { transcript: { updatedAt: row.updatedAt, data: withoutSettledReviews(row.data) } };
  }
}

export function createStudentProfilesRouter(repository: StudentProfileRepository | undefined, authorization: Pick<AdminAccountRepository, "canAccessAdmin"> | undefined) {
  const router = Router();
  router.use(requireAdminAccess);
  router.use(async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!repository || !authorization) { response.status(503).json({ error: "database_required" }); return; }
    if (!await authorization.canAccessAdmin(request.session.user!)) { response.status(403).json({ error: "insufficient_role" }); return; }
    next();
  });
  router.get("/", async (request, response) => {
    const input = z.object({
      q: z.string().trim().max(120).default(""),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
      cohortYear: z.coerce.number().int().min(2000).max(2100).optional(),
      cohortCode: z.string().trim().toUpperCase().regex(/^K[0-9]{2,3}$/).optional(),
      active: z.enum(["true", "false"]).optional(),
      profileStatus: z.enum(["missing", "incomplete", "complete"]).optional(),
      ...sortSchema(studentSort)
    }).strict().safeParse(request.query);
    if (!input.success) { response.status(400).json({ error: "invalid_query" }); return; }
    response.json({ ...await repository!.list(request.session.user!, input.data), page: input.data.page, pageSize: input.data.pageSize });
  });
  router.get("/:id", async (request, response) => {
    // PostgreSQL UUID keys may come from imports as well as RFC UUID generators.
    const id = z.guid().safeParse(request.params.id);
    if (!id.success) { response.status(400).json({ error: "invalid_student_id" }); return; }
    response.json({ student: await repository!.detail(request.session.user!, id.data) });
  });
  router.get("/:id/transcript", async (request, response) => {
    const id = z.guid().safeParse(request.params.id);
    if (!id.success) { response.status(400).json({ error: "invalid_student_id" }); return; }
    response.json(await repository!.transcript(request.session.user!, id.data));
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AccountError) { res.status(error.status).json({ error: error.code }); return; }
    next(error);
  };
  router.use(errorHandler);
  return router;
}
