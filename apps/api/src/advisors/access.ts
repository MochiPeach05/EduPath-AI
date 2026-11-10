// Cố vấn học tập in the student portal (AD-AST-05…08; user 2026-11-03, policy 2026-11-03, migration 058). An advisor opens
// the page of a student of a class they advise in a tab of its own: that tab's web code sends X-Advisor-Student with every
// /api/student request (apps/web/src/advisor-view.ts), and advisorActing checks on each request that the signed-in
// admin-portal account still advises the student's class. The student routers read the student through studentUser().
// Only what the policy lets an advisor do for the student passes (ACTING_ACTIONS: import the transcript, the specialty and
// the target vị trí nghề nghiệp, Kế hoạch học kỳ and Khảo sát định hướng (policy 2026-11-10), the competency assessment and
// its AI comment, the AI roadmap, the graduation advice, Trợ lý AI), even without the student's consent
// (user: "Cho làm, báo sinh viên"); no consent is recorded in the student's name. Each such action is logged (kind
// 'advisor') and told to the student by a notification. Reads pass, except the student's own notifications. In the admin
// portal the role 'advisor' only reads what its rows of the function list show (advisorReadOnly). Since the user's
// "Quản lý sinh viên" (2026-11-03: AD-AST-01…09 are "QTV & CVHT"), admins and Ban chủ nhiệm khoa (canManageAdvisors) work
// the same way in the page of ANY student, not only of the classes they advise; the student is told who did it (actorKind).
import type { Request, RequestHandler } from "express";
import type { DatabasePool } from "../db/pool.js";
import { canManageAdvisors, type AuthenticatedUser } from "../auth/types.js";
import { canUseStudentPortal } from "../auth/security.js";
import { auditActorOf, recordAudit } from "../admin/audit/record.js";
import { advisorAction, notifySafely } from "../notifications/notify.js";
import { CLASS_OF } from "./class-code.js";

export const ADVISOR_STUDENT_HEADER = "x-advisor-student";

type Db = Pick<DatabasePool, "query">;

/**
 * A student an admin-portal account works for, as the student routers see them: a student of a class the account advises
 * (actorKind "advisor"), or, for admins and Ban chủ nhiệm khoa, any student (actorKind "admin").
 */
export type AdvisedStudent = {
  user: AuthenticatedUser;
  studentCode: string | null;
  /** student_profiles.full_name, else the account's display name. */
  name: string;
  /** The student's class as a canonical code (71K29CNTT08, class-code.ts); empty when the profile has none. */
  className: string;
  /** advisor: the cố vấn học tập of the student's class; admin: a quản trị viên of the Khoa working for any student. */
  actorKind: "advisor" | "admin";
  /** The name the student is told: ad_advisors.full_name of the advisor, the account's display name of an admin (both
   *  never blank in the database; empty otherwise, and the notification names only the role). */
  actorName: string;
  /** The same as actorName (the name used before admins could act). */
  advisorName: string;
};
export type AdvisorActing = { advisor: AuthenticatedUser; student: AdvisedStudent };

declare global {
  namespace Express {
    interface Request {
      /** Set by advisorActing when a cố vấn học tập works in a student's page (X-Advisor-Student). */
      advisorActing?: AdvisorActing;
    }
  }
}


/** The student a /api/student request is about: the signed-in student, or the student an advisor works for in this tab. */
export function studentUser(request: Request): AuthenticatedUser {
  return request.advisorActing?.student.user ?? request.session.user!;
}

/** The advisor doing this /api/student request for a student, or null when the student does it themself. */
export const actingAdvisor = (request: Request): AuthenticatedUser | null => request.advisorActing?.advisor ?? null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** "71k29cntt01 " → "71K29CNTT01" (class-code.ts holds the whole rule of a class code). */
export { normalizeClassName } from "./class-code.js";

/** The student accounts of the classes an account advises (canonical class codes, class-code.ts). */
export async function advisedStudentIds(db: Db, userId: string): Promise<Set<string>> {
  const result = await db.query<{ id: string }>(`SELECT u.id FROM users u JOIN student_profiles p ON p.user_id = u.id
    WHERE ${STUDENT_CLASS} IN (SELECT class_name FROM ad_advisor_classes WHERE advisor_user_id = $1)`, [userId]);
  return new Set(result.rows.map((row) => row.id));
}

/** The classes an account advises, in order (empty for an account that advises none). */
export async function advisorClassesOf(db: Db, userId: string): Promise<string[]> {
  const result = await db.query<{ class_name: string }>(
    "SELECT class_name FROM ad_advisor_classes WHERE advisor_user_id=$1 ORDER BY class_name", [userId]);
  return result.rows.map((row) => row.class_name);
}

type StudentRow = {
  id: string; tenant: string; object_id: string | null; display_name: string; email: string | null; username: string | null;
  auth_version: number | null; student_code: string | null; full_name: string | null; class_name: string | null; actor_name: string | null;
};
/** The student account's columns (u = users, p = student_profiles). */
const STUDENT_COLUMNS = `u.id, u.entra_tenant_id AS tenant, u.entra_object_id AS object_id, u.display_name, u.email, u.username, u.auth_version,
  p.student_code, p.full_name`;
/** An active student account (u = users). */
const ACTIVE_STUDENT = "u.is_active AND COALESCE(u.role_override, u.role)='student'";
/** The student's class as ad_advisor_classes stores it, the canonical code (p = student_profiles, u = users). */
const STUDENT_CLASS = CLASS_OF;

function toAdvised(row: StudentRow, actorKind: AdvisedStudent["actorKind"]): AdvisedStudent {
  const objectId = row.object_id ?? "";
  const actorName = row.actor_name?.trim() ?? "";
  return {
    user: {
      authVersion: row.auth_version ?? 0, userId: row.id, identityKey: `${row.tenant}:${objectId}`, tenantId: row.tenant, objectId,
      name: row.display_name, email: row.email, username: row.username, role: "student", signedInAt: new Date().toISOString(),
    },
    studentCode: row.student_code,
    name: row.full_name?.trim() || row.display_name,
    className: row.class_name ?? "",
    actorKind, actorName, advisorName: actorName,
  };
}

/**
 * The student behind studentId, for an admin-portal account: a student of a class the account advises (actorKind
 * "advisor"), else, for admins and Ban chủ nhiệm khoa (canManageAdvisors), any active student account (actorKind
 * "admin"); null otherwise (another class, a staff account, a locked account).
 */
export async function advisedStudent(db: Db, account: Pick<AuthenticatedUser, "userId" | "role">, studentId: string): Promise<AdvisedStudent | null> {
  if (!isUuid(studentId)) return null;
  const advised = (await db.query<StudentRow>(
    `SELECT ${STUDENT_COLUMNS}, c.class_name, a.full_name AS actor_name
       FROM users u
       JOIN student_profiles p ON p.user_id=u.id
       JOIN ad_advisor_classes c ON c.class_name=${STUDENT_CLASS}
       JOIN ad_advisors a ON a.user_id=c.advisor_user_id
      WHERE u.id=$1 AND c.advisor_user_id=$2 AND ${ACTIVE_STUDENT}`,
    [studentId, account.userId])).rows[0];
  if (advised) return toAdvised(advised, "advisor");
  if (!canManageAdvisors(account.role)) return null;
  const any = (await db.query<StudentRow>(
    `SELECT ${STUDENT_COLUMNS}, ${STUDENT_CLASS} AS class_name, (SELECT display_name FROM users WHERE id=$2) AS actor_name
       FROM users u
       LEFT JOIN student_profiles p ON p.user_id=u.id
      WHERE u.id=$1 AND ${ACTIVE_STUDENT}`,
    [studentId, account.userId])).rows[0];
  return any ? toAdvised(any, "admin") : null;
}

/**
 * What an advisor may do in a student's page (user, 2026-11-03: import bảng điểm, đánh giá năng lực, Lộ trình AI, Trợ lý
 * AI; 2026-11-10: the specialty and the target vị trí nghề nghiệp, then Kế hoạch học kỳ and Khảo sát định hướng too).
 * action names the row of the log; did, link and key make the student's notification ("Cố vấn học tập đã import bảng điểm
 * thay bạn"), at most one per advisor, key and day; after is its last sentence when the usual one does not fit. fields:
 * the request's JSON body must have exactly these fields (the other fields of the same route stay the student's).
 * logWindow: one log row per account, student and half hour (a page that saves after every change). Paths are under
 * /api/student.
 */
export type ActingAction = {
  method: "POST" | "PUT" | "PATCH" | "DELETE"; path: RegExp; action: string; did?: string; link?: string; key?: string; log?: false;
  fields?: readonly string[]; after?: string; logWindow?: true;
};
/** The last sentence of the notification of a changed specialty or target: the student changes it back as before. */
const GOALS_AFTER = "Bạn xem lại lựa chọn này; nếu chưa đúng ý, bạn vẫn tự đổi lại được như thường.";
/** The last sentence of the notification of a changed Kế hoạch học kỳ. */
const PLAN_AFTER = "Bạn xem lại kế hoạch ở tab Kế hoạch học kỳ; nếu chưa đúng ý, bạn vẫn tự sửa lại được như thường.";
/** The last sentence of the notification of a Khảo sát định hướng filled in for the student. */
const SURVEY_AFTER = "Bạn xem lại câu trả lời; nếu chưa đúng, bạn vẫn tự sửa hoặc xóa được như thường.";
export const ACTING_ACTIONS: readonly ActingAction[] = [
  { method: "POST", path: /^\/transcript$/, action: "Import bảng điểm thay sinh viên", did: "đã import bảng điểm", link: "#profile", key: "transcript" },
  // Mục tiêu học tập (user 2026-11-10: "có thể sửa chuyên ngành và nghề nghiệp của sinh viên luôn"): the specialty, the
  // target vị trí nghề nghiệp or both, as the student changes them (Hồ sơ và bảng điểm, Định hướng nghề nghiệp), with the
  // same checks of PATCH /profile; its other fields are refused.
  { method: "PATCH", path: /^\/profile$/, fields: ["specialty"], action: "Đổi chuyên ngành thay sinh viên", did: "đã đổi chuyên ngành",
    link: "#profile", key: "specialty", after: GOALS_AFTER },
  { method: "PATCH", path: /^\/profile$/, fields: ["careerPositionId"], action: "Đổi vị trí nghề nghiệp mục tiêu thay sinh viên",
    did: "đã đổi vị trí nghề nghiệp mục tiêu", link: "#career", key: "career", after: GOALS_AFTER },
  { method: "PATCH", path: /^\/profile$/, fields: ["careerPositionId", "specialty"], action: "Đổi chuyên ngành và vị trí nghề nghiệp mục tiêu thay sinh viên",
    did: "đã đổi chuyên ngành và vị trí nghề nghiệp mục tiêu", link: "#profile", key: "goals", after: GOALS_AFTER },
  // Kế hoạch học kỳ and Khảo sát định hướng (user 2026-11-10: "Kế hoạch học kỳ, Khảo sát định hướng … cố vấn học tập và
  // quản trị viên làm luôn nhé"), saved as the student saves them. The plan saves after every change, so its log keeps one
  // row per half hour; the survey records no consent in the student's name (student/router.ts). Deleting stays the student's.
  { method: "PUT", path: /^\/study-plan$/, action: "Cập nhật Kế hoạch học kỳ thay sinh viên", did: "đã cập nhật Kế hoạch học kỳ",
    link: "#roadmap", key: "plan", after: PLAN_AFTER, logWindow: true },
  { method: "PUT", path: /^\/survey$/, action: "Làm Khảo sát định hướng thay sinh viên", did: "đã làm Khảo sát định hướng",
    link: "#profile", key: "survey", after: SURVEY_AFTER },
  { method: "DELETE", path: /^\/transcript\/job$/, action: "Hủy lần import bảng điểm đang chạy" },
  { method: "POST", path: /^\/competency-assessments$/, action: "Đánh giá năng lực thay sinh viên", did: "đã chạy Đánh giá năng lực", link: "#competency", key: "assessment" },
  { method: "POST", path: /^\/competency-assessments\/[^/]+\/ai$/, action: "Tạo lại nhận xét năng lực thay sinh viên" },
  { method: "POST", path: /^\/roadmap$/, action: "Tạo Lộ trình AI thay sinh viên", did: "đã tạo Lộ trình AI", link: "#roadmap", key: "roadmap" },
  // The graduation page asks for its advice by itself when it opens: allowed, not logged.
  { method: "POST", path: /^\/graduation\/advice\/ensure$/, action: "Lời khuyên xét tốt nghiệp", log: false },
  { method: "POST", path: /^\/graduation\/advice\/retry$/, action: "Tạo lại lời khuyên xét tốt nghiệp thay sinh viên" },
  { method: "POST", path: /^\/assistant\/threads$/, action: "Hỏi Trợ lý AI thay sinh viên", did: "đã hỏi Trợ lý AI", link: "#assistant", key: "assistant" },
  { method: "POST", path: /^\/assistant\/threads\/[^/]+\/messages$/, action: "Hỏi Trợ lý AI thay sinh viên", did: "đã hỏi Trợ lý AI", link: "#assistant", key: "assistant" },
  { method: "POST", path: /^\/assistant\/messages\/[^/]+\/retry$/, action: "Hỏi lại Trợ lý AI thay sinh viên" },
  { method: "POST", path: /^\/assistant\/messages\/[^/]+\/feedback$/, action: "Đánh giá câu trả lời của Trợ lý AI", log: false },
];
/** Reads an advisor does not get: the student's own notifications (the bell). */
export const ACTING_CLOSED_READS: readonly RegExp[] = [/^\/notifications(\/|$)/];

/** The fields of a JSON object body; null for no body or anything else. */
const bodyFields = (body: unknown): string[] | null =>
  body !== null && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : null;

/** The rule that lets an advisor send this request for the student, or null. body: the parsed JSON body. */
export function actingAction(method: string, path: string, body?: unknown): ActingAction | null {
  const fields = bodyFields(body);
  return ACTING_ACTIONS.find((rule) => rule.method === method && rule.path.test(path) && (!rule.fields
    || (fields !== null && fields.length === rule.fields.length && rule.fields.every((field) => fields.includes(field))))) ?? null;
}

/** The day in Vietnam ("2026-11-03"), for the one-notification-a-day key. */
const vietnamDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(date);

/** "2374802010994 – Nguyễn Văn A (lớp 71K29CNTT01)": the log names the student, never the data. */
export const studentLabel = (student: Pick<AdvisedStudent, "studentCode" | "name" | "className">) =>
  `${[student.studentCode, student.name].filter(Boolean).join(" – ")}${student.className ? ` (lớp ${student.className})` : ""}`;

/** How long one "Mở trang sinh viên" in the log covers the further reads of the same account on the same student. */
export const STUDENT_VIEW_LOG_MS = 30 * 60 * 1000;
/**
 * When each account last had a student's page logged as opened (this server's memory: a restart logs anew). QA
 * 2026-11-07: opening /dashboard?sv=… straight, or reading the API, left no line in the Nhật ký; every read is now covered.
 */
export function createStudentViews(windowMs = STUDENT_VIEW_LOG_MS) {
  const last = new Map<string, number>();
  return {
    /** Records that the account's opening of the student's page was logged at `at`. */
    mark(actorId: string, studentId: string, at = Date.now()) {
      last.set(`${actorId}:${studentId}`, at);
      if (last.size > 10_000) for (const [key, time] of last) if (at - time >= windowMs) last.delete(key);
    },
    /** True when nothing was logged for that account and student within the window. */
    due(actorId: string, studentId: string, at = Date.now()) {
      const time = last.get(`${actorId}:${studentId}`);
      return time === undefined || at - time >= windowMs;
    },
  };
}
export type StudentViews = ReturnType<typeof createStudentViews>;
/** This server's record, shared by advisorActing and POST /advisor-portal/students/:id/open (repository.ts open). */
export const studentViews: StudentViews = createStudentViews();

/**
 * Mounted on /api/student before the student routers (app.ts). A student passes untouched; an admin-portal account or a
 * staff mailbox passes only for the student named by X-Advisor-Student that advisedStudent gives it (its own classes; any
 * student for admins and Ban chủ nhiệm khoa), and only for reads and ACTING_ACTIONS. A read logs "Mở trang sinh viên"
 * once per account, student and half hour (studentViews), however the page was opened; so does an action with logWindow,
 * under a key of its own.
 */
export function advisorActing(db: Db | undefined, staffEmailDomains: ReadonlySet<string>, views: StudentViews = studentViews): RequestHandler {
  return async (request, response, next) => {
    const user = request.session.user;
    if (!user || canUseStudentPortal(user, staffEmailDomains)) { next(); return; }
    const target = request.get(ADVISOR_STUDENT_HEADER);
    if (!target) { response.status(403).json({ error: "student_portal_blocked" }); return; }
    if (!db || !isUuid(target)) { response.status(403).json({ error: "advisor_student_forbidden" }); return; }
    try {
      const student = await advisedStudent(db, user, target);
      if (!student) { response.status(403).json({ error: "advisor_student_forbidden" }); return; }
      const read = request.method === "GET" || request.method === "HEAD";
      const action = read ? null : actingAction(request.method, request.path, request.body);
      if (read ? ACTING_CLOSED_READS.some((rule) => rule.test(request.path)) : !action) {
        response.status(403).json({ error: "advisor_action_not_allowed" }); return;
      }
      request.advisorActing = { advisor: user, student };
      if (read) {
        const path = request.originalUrl.split("?")[0] ?? "";
        response.once("finish", () => {
          if (response.statusCode >= 400 || !views.due(user.userId, student.user.userId)) return;
          views.mark(user.userId, student.user.userId);
          void recordAudit(db, auditActorOf(user), {
            kind: "advisor", action: "Mở trang sinh viên", summary: studentLabel(student), targetType: "student", targetId: student.user.userId,
            method: request.method, path,
          });
        });
      }
      if (action && action.log !== false) {
        const path = request.originalUrl.split("?")[0] ?? "";
        response.once("finish", () => {
          if (response.statusCode >= 400) return;
          const windowKey = `${user.userId}:${action.key ?? action.action}`;
          if (!action.logWindow || views.due(windowKey, student.user.userId)) {
            if (action.logWindow) views.mark(windowKey, student.user.userId);
            void recordAudit(db, auditActorOf(user), {
              kind: "advisor", action: action.action, summary: studentLabel(student), targetType: "student", targetId: student.user.userId,
              method: request.method, path,
            });
          }
          if (action.did && action.link && action.key) {
            void notifySafely(db, student.user.userId,
              advisorAction(student.actorName, action.did, action.link, vietnamDay(), `${action.key}:${user.userId}`, student.actorKind, action.after));
          }
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * The admin reads (paths under /api/admin) of the role 'advisor': the rows of the function list whose Tác nhân includes
 * CVHT, i.e. the views, searches and filters of the "QTV & CVHT" rows and the "Cố vấn học tập" rows (user, 2026-11-04:
 * only the functions whose actors include CVHT), and since 2026-11-07 (user: "cho CVHT xem nữa") Thống kê over the students
 * of their own classes and Nhật ký with their own actions (AD-REPORT). Every other admin read belongs to the Quản trị viên:
 * Tài khoản (AD-AUTH-03…10), Thông báo (AD-NOTI), the source workbooks (AD-PLAN-14), the import
 * template (AD-ADV-01), the AI runs and proposals (AD-CRS-06, 09, 10, AD-REQ-04) and the editors' own catalog. An admin
 * route added later stays closed to advisors until it is listed here. Matched as Express routes: without case, with or
 * without a trailing slash.
 */
export const ADVISOR_ADMIN_READS: readonly RegExp[] = [
  // AD-AUTH-01: the session of the admin portal.
  /^\/(me|summary)\/?$/i,
  // AD-PROF-01…04, AD-AST-06: Sinh viên, only the students of the advisor's classes (admin/student-profiles.ts).
  /^\/students(\/[^/]+(\/transcript)?)?\/?$/i,
  // AD-AST-01…04, 09: Quản lý sinh viên (advisors/portal-router.ts); opening a student's page is in ADVISOR_ADMIN_WRITES.
  /^\/advisor-portal\/(me|classes|students|permissions)\/?$/i,
  // AD-ADV-04, 05: the cố vấn học tập of the Khoa and one of them; not the import template (AD-ADV-01).
  /^\/advisors(\/(?!import\/?$)[^/]+)?\/?$/i,
  // AD-CURR-03…06 and AD-SUB-01, 02; AD-PLAN-03…09, 13; AD-GRAD-03…07, 12: the lists and one programme, plan or
  // standard with any of its versions (?revision=); not the source workbook of a version (/:id/source/:revision).
  /^\/(curricula|plans|graduation)(\/[^/]+)?\/?$/i,
  // AD-FIELD-01…03, AD-SKILL-01…03, AD-CAREER-01, 02, 06, 07: fields, skills, careers and one career.
  /^\/careers(\/[^/]+)?\/?$/i,
  // AD-REQ-07…10: the requirements of a career, the skills that filter them and the course weights; not the AI
  // proposals (ai-suggestions, AD-REQ-04).
  /^\/careers\/requirements(\/(?!ai-suggestions\/?$)[^/]+)?\/?$/i,
  // AD-COMP-01…04, AD-CMP-01…04, AD-CRS-01…04: groups, skill and course configurations, their cohorts and summary; not
  // the AI runs (/ai) or the catalog of the skill editor.
  /^\/competencies\/(groups|skills|courses)(\/[^/]+)?\/?$/i,
  /^\/competencies\/(cohorts|summary)\/?$/i,
  // AD-REPORT-01…10: Thống kê and its Excel files, over the students of the advisor's classes (admin/reports/router.ts).
  /^\/reports\/(options|dashboard|progress|risk|skills|careers|courses)(\.xlsx|\/students)?\/?$/i,
  // AD-REPORT-11: Nhật ký thao tác, the advisor's own actions (admin/audit/router.ts).
  /^\/audit-log\/?$/i,
];
/** The only admin write of the role 'advisor': opening the page of a student of their classes (AD-AST-05), logged. */
export const ADVISOR_ADMIN_WRITES: readonly RegExp[] = [/^\/advisor-portal\/students\/[^/]+\/open\/?$/i];

/**
 * Mounted on /api/admin before the admin routers: the role 'advisor' reads what ADVISOR_ADMIN_READS lists (else
 * admin_only) and changes nothing but ADVISOR_ADMIN_WRITES (else read_only_role).
 */
export const advisorReadOnly: RequestHandler = (request, response, next) => {
  if (request.session.user?.role !== "advisor") { next(); return; }
  const read = request.method === "GET" || request.method === "HEAD";
  if ((read ? ADVISOR_ADMIN_READS : ADVISOR_ADMIN_WRITES).some((rule) => rule.test(request.path))) { next(); return; }
  response.status(403).json({ error: read ? "admin_only" : "read_only_role" });
};
