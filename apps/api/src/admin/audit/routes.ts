// Nhật ký thao tác (AD-REPORT-11): what each admin change is called in the log. Every POST/PUT/PATCH/DELETE of the admin
// routers (app.ts, /api/admin/...) has a rule here, specific paths before general ones; a route without a rule is still
// logged with a generic line (unknownRoute). Summaries name the object from the route, the request's JSON fields or the
// JSON answer, or a small lookup by id; never grades or file contents.
import type { AuditKind } from "../reports/types.js";
import { personName } from "../../users/person-name.js";

/** One row of a small read by id (null when there is none or the lookup failed). */
export type Lookup = (text: string, values: unknown[]) => Promise<Record<string, unknown> | null>;

export type RouteContext = {
  params: Record<string, string>;
  /** The request's JSON fields; an empty object for files and other bodies. */
  body: Record<string, unknown>;
  /** The JSON the handler answered with, when it answered JSON. */
  result: unknown;
  lookup: Lookup;
};

export type Described = { summary: string; action?: string; targetType?: string | null; targetId?: string | null };

export type AuditRoute = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path under /api/admin with :params, e.g. "/careers/fields/:id". */
  path: string;
  kind: AuditKind;
  action: string;
  describe?: (context: RouteContext) => Described | string | Promise<Described | string>;
  /** Not logged, with the reason (a read that only uses POST, such as previewing a workbook before importing it). */
  skip?: string;
};

// ------------------------------------------------------------------------------------------------ wording helpers

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const str = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : typeof value === "number" ? String(value) : "");
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const join = (...parts: unknown[]) => parts.map(str).filter(Boolean).join(" ");

const VOWEL = /[aăâeêioôơuưyàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;
/** "CÔNG NGHỆ THÔNG TIN" → "Công nghệ thông tin" (names typed in capitals in the workbooks); acronyms (CNTT) stay. */
export function sentenceCase(text: string): string {
  const line = str(text);
  if (!line || line !== line.toLocaleUpperCase("vi-VN") || line === line.toLocaleLowerCase("vi-VN")) return line;
  const words = line.split(" ").map((word) => (VOWEL.test(word) ? word.toLocaleLowerCase("vi-VN") : word));
  const first = words[0]!;
  words[0] = first.charAt(0).toLocaleUpperCase("vi-VN") + first.slice(1);
  return words.join(" ");
}
/** "K29" → "khóa 29". */
const cohortWords = (code: unknown) => { const text = str(code); const match = /^K(\d+)$/i.exec(text); return match ? `khóa ${match[1]}` : text; };
/** The cohort filter of a bulk action: "khóa 29", or every cohort when it is empty. */
const cohortScope = (code: unknown) => (str(code) ? cohortWords(code) : "mọi khóa");
const ROLE_LABELS: Record<string, string> = {
  admin: "Quản trị viên", faculty_board: "Ban chủ nhiệm khoa", department_head: "Trưởng/phó bộ môn", lecturer: "Giảng viên",
  advisor: "Cố vấn học tập", student: "Sinh viên",
};
export const roleLabel = (role: unknown) => ROLE_LABELS[str(role)] ?? (str(role) || "Không rõ");

/** "Công nghệ thông tin khóa 29" from a CTĐT, KHĐT or graduation standard answer ({ data: { major, cohortCode } }). */
const programOf = (result: unknown) => { const data = obj(obj(result).data); return join(sentenceCase(str(data.major)), cohortWords(data.cohortCode)) || "(không rõ chương trình)"; };
const countOf = (value: unknown, unit: string) => (Array.isArray(value) ? ` (${value.length} ${unit})` : "");
const courseIn = (result: unknown, code: string) => {
  const found = list(obj(obj(result).data).courses).map(obj).find((course) => str(course.code) === code);
  return found ? join(code, found.name) : code;
};
/** "Kỹ thuật phần mềm (khóa 29, Công nghệ thông tin)" from a graduation standard answer. */
const standardOf = (result: unknown) => {
  const data = obj(obj(result).data);
  const where = [cohortWords(data.cohortCode), sentenceCase(str(data.major))].filter(Boolean).join(", ");
  return `${str(data.name) || "(không tên)"}${where ? ` (${where})` : ""}`;
};
/** "Nguyễn Văn A (nva@vlu.edu.vn), lớp 71K29CNTT01, 71K29CNTT02" from an advisor answer, else the form's fields. */
const advisorOf = (advisor: Json, body: Json) => {
  const name = str(advisor.name) || str(body.name), email = str(advisor.email) || str(body.email);
  const classes = list(advisor.classes).map(str).filter(Boolean);
  return `${join(name, email ? `(${email})` : "") || "(không rõ)"}${classes.length ? `, lớp ${classes.join(", ")}` : ""}`;
};
const statusWord = (status: unknown) => (str(status) === "active" ? "áp dụng ngay" : str(status) === "draft" ? "lưu bản nháp" : "");
const careerName = (row: Json | null) => (row ? join(row.code, row.name) : "");
const target = (type: string, id: unknown) => ({ targetType: type, targetId: str(id) || null });

// ---------------------------------------------------------------------------------------------------------- rules

export const AUDIT_ROUTES: readonly AuditRoute[] = [
  // Tài khoản (admin/accounts.ts)
  { method: "POST", path: "/accounts", kind: "account", action: "Tạo tài khoản quản trị",
    describe: ({ body, result }) => { const user = obj(obj(result).user); return { summary: `Tạo tài khoản quản trị ${str(user.email) || str(body.email)}`, ...target("account", user.id) }; } },
  { method: "PATCH", path: "/accounts/:id", kind: "account", action: "Sửa tài khoản",
    describe: ({ params, body, result }) => {
      // The account by name only, as the admin portal names people ("MSSV - Họ tên - Lớp" → "Họ tên"), with its email.
      const user = obj(obj(result).user), who = join(personName(str(user.name)), str(user.email) || str(user.username) ? `(${str(user.email) || str(user.username)})` : "") || params.id!;
      if (body.role !== undefined) return { action: "Đổi vai trò", summary: `Đổi vai trò của ${who} thành ${roleLabel(body.role)}`, ...target("account", params.id) };
      const locked = body.isActive === false;
      return { action: locked ? "Khóa tài khoản" : "Mở khóa tài khoản", summary: `${locked ? "Khóa" : "Mở khóa"} tài khoản ${who}`, ...target("account", params.id) };
    } },

  // Cố vấn học tập (advisors/router.ts, portal-router.ts; 2026-11-03). Opening a student's page is logged by the portal
  // router itself, with the student's name and the kind 'advisor'.
  { method: "POST", path: "/advisors/import/preview", kind: "account", action: "Xem trước danh sách cố vấn học tập", skip: "chỉ đọc tệp để xem trước, chưa lưu gì" },
  { method: "POST", path: "/advisors/import", kind: "account", action: "Import danh sách cố vấn học tập",
    describe: ({ result }) => {
      const done = obj(result), file = str(obj(done.preview).fileName);
      return { summary: `Import danh sách cố vấn học tập${file ? ` từ tệp ${file}` : ""}: thêm ${num(done.added) ?? 0}, cập nhật ${num(done.updated) ?? 0}, `
        + `không đổi ${num(done.unchanged) ?? 0}, bỏ qua ${num(done.skipped) ?? 0} cố vấn có lỗi` };
    } },
  { method: "POST", path: "/advisors", kind: "account", action: "Thêm cố vấn học tập",
    describe: ({ body, result }) => { const advisor = obj(obj(result).advisor); return { summary: `Thêm cố vấn học tập ${advisorOf(advisor, body)}`, ...target("advisor", advisor.userId) }; } },
  { method: "PUT", path: "/advisors/:id", kind: "account", action: "Chỉnh sửa cố vấn học tập",
    describe: ({ params, body, result }) => ({ summary: `Chỉnh sửa cố vấn học tập ${advisorOf(obj(obj(result).advisor), body)}`, ...target("advisor", params.id) }) },
  { method: "DELETE", path: "/advisors/:id", kind: "account", action: "Xóa cố vấn học tập",
    describe: async ({ params, lookup }) => {
      const account = await lookup("SELECT display_name AS name, COALESCE(email, username) AS email FROM users WHERE id = $1", [params.id]);
      return { summary: `Xóa cố vấn học tập ${join(account?.name, account?.email ? `(${str(account.email)})` : "") || params.id}`, ...target("advisor", params.id) };
    } },
  { method: "POST", path: "/advisor-portal/students/:id/open", kind: "advisor", action: "Mở trang sinh viên", skip: "ghi riêng ở advisors/portal-router.ts, loại Cố vấn học tập" },

  // Chương trình đào tạo (curricula/router.ts)
  { method: "POST", path: "/curricula/preview", kind: "training", action: "Xem trước CTĐT", skip: "chỉ đọc tệp để xem trước, chưa lưu gì" },
  { method: "PUT", path: "/curricula/:id/import", kind: "training", action: "Cập nhật CTĐT từ Excel",
    describe: ({ params, result }) => ({ summary: `Cập nhật CTĐT ${programOf(result)} từ Excel${countOf(obj(obj(result).data).courses, "học phần")}`, ...target("curriculum", params.id) }) },
  { method: "PATCH", path: "/curricula/:id/courses/:code", kind: "training", action: "Sửa học phần trong CTĐT",
    describe: ({ params, result }) => ({ summary: `Sửa học phần ${courseIn(result, params.code!)} trong CTĐT ${programOf(result)}`, ...target("curriculum", params.id) }) },
  { method: "DELETE", path: "/curricula/:id/courses/:code", kind: "training", action: "Xóa học phần khỏi CTĐT",
    describe: ({ params, result }) => ({ summary: `Xóa học phần ${params.code} khỏi CTĐT ${programOf(result)}`, ...target("curriculum", params.id) }) },
  { method: "POST", path: "/curricula/:id/courses", kind: "training", action: "Thêm học phần vào CTĐT",
    describe: ({ params, body, result }) => ({ summary: `Thêm học phần ${join(body.code, body.name)} vào CTĐT ${programOf(result)}`, ...target("curriculum", params.id) }) },
  { method: "PATCH", path: "/curricula/:id/status", kind: "training", action: "Đổi trạng thái CTĐT",
    describe: ({ params, body, result }) => { const action = body.isActive === false ? "Ngừng áp dụng CTĐT" : "Áp dụng CTĐT"; return { action, summary: `${action} ${programOf(result)}`, ...target("curriculum", params.id) }; } },
  { method: "PATCH", path: "/curricula/:id", kind: "training", action: "Sửa thông tin CTĐT",
    describe: ({ params, result }) => ({ summary: `Sửa thông tin CTĐT ${programOf(result)}`, ...target("curriculum", params.id) }) },
  { method: "POST", path: "/curricula", kind: "training", action: "Import CTĐT",
    describe: ({ result }) => ({ summary: `Import CTĐT ${programOf(result)}${countOf(obj(obj(result).data).courses, "học phần")}`, ...target("curriculum", obj(result).id) }) },

  // Kế hoạch đào tạo (plans/router.ts)
  { method: "POST", path: "/plans/preview", kind: "training", action: "Xem trước KHĐT", skip: "chỉ đọc tệp để xem trước, chưa lưu gì" },
  { method: "PUT", path: "/plans/:id/import", kind: "training", action: "Cập nhật KHĐT từ Excel",
    describe: ({ params, result }) => ({ summary: `Cập nhật KHĐT ${programOf(result)} từ Excel${countOf(obj(obj(result).data).items, "học phần")}`, ...target("plan", params.id) }) },
  { method: "PATCH", path: "/plans/:id/items/:itemId", kind: "training", action: "Sửa phân bổ học phần trong KHĐT",
    describe: ({ params, result }) => {
      const item = list(obj(obj(result).data).items).map(obj).find((row) => str(row.id) === params.itemId);
      return { summary: `Sửa phân bổ học phần ${item ? join(item.code, item.name) : params.itemId} trong KHĐT ${programOf(result)}`, ...target("plan", params.id) };
    } },
  { method: "PATCH", path: "/plans/:id/status", kind: "training", action: "Đổi trạng thái KHĐT",
    describe: ({ params, body, result }) => { const action = body.isActive === false ? "Ngừng áp dụng KHĐT" : "Áp dụng KHĐT"; return { action, summary: `${action} ${programOf(result)}`, ...target("plan", params.id) }; } },
  { method: "PATCH", path: "/plans/:id", kind: "training", action: "Sửa thông tin KHĐT",
    describe: ({ params, result }) => ({ summary: `Sửa thông tin KHĐT ${programOf(result)}`, ...target("plan", params.id) }) },
  { method: "POST", path: "/plans", kind: "training", action: "Import KHĐT",
    describe: ({ result }) => ({ summary: `Import KHĐT ${programOf(result)}${countOf(obj(obj(result).data).items, "học phần")}`, ...target("plan", obj(result).id) }) },

  // Tiêu chuẩn xét tốt nghiệp (graduation/router.ts)
  { method: "POST", path: "/graduation/preview", kind: "training", action: "Xem trước tiêu chuẩn xét tốt nghiệp", skip: "chỉ đọc tệp để xem trước, chưa lưu gì" },
  { method: "POST", path: "/graduation/import", kind: "training", action: "Import tiêu chuẩn xét tốt nghiệp",
    describe: async ({ result, lookup }) => {
      const ids = list(obj(result).ids).map(str).filter(Boolean);
      const names = ids.length ? await lookup(`SELECT string_agg(concat_ws(' ', r.data->>'name', '(' || c.cohort_code || ')'), ', ' ORDER BY c.cohort_code, r.data->>'name') AS names
        FROM graduation_standards c JOIN graduation_revisions r ON r.id=c.current_revision WHERE c.id::text = ANY($1::text[])`, [ids]) : null;
      return { summary: `Import ${ids.length} tiêu chuẩn xét tốt nghiệp${str(names?.names) ? `: ${str(names?.names)}` : ""}`, ...target("graduation_standard", ids.length === 1 ? ids[0] : null) };
    } },
  { method: "PATCH", path: "/graduation/:id/status", kind: "training", action: "Đổi trạng thái tiêu chuẩn xét tốt nghiệp",
    describe: ({ params, body, result }) => {
      const action = body.isActive === false ? "Ngừng áp dụng tiêu chuẩn xét tốt nghiệp" : "Áp dụng tiêu chuẩn xét tốt nghiệp";
      return { action, summary: `${action} ${standardOf(result)}`, ...target("graduation_standard", params.id) };
    } },
  { method: "POST", path: "/graduation/:id/replace", kind: "training", action: "Thay tiêu chuẩn xét tốt nghiệp từ Excel",
    describe: ({ params, result }) => ({ summary: `Thay tiêu chuẩn xét tốt nghiệp ${standardOf(result)} từ Excel`, ...target("graduation_standard", params.id) }) },
  { method: "PATCH", path: "/graduation/:id", kind: "training", action: "Sửa tiêu chuẩn xét tốt nghiệp",
    describe: ({ params, result }) => ({ summary: `Sửa tiêu chuẩn xét tốt nghiệp ${standardOf(result)}`, ...target("graduation_standard", params.id) }) },

  // Lĩnh vực và nghề nghiệp (careers/router.ts, careers/ai-suggestions/router.ts)
  { method: "POST", path: "/careers/fields", kind: "career", action: "Thêm lĩnh vực nghề nghiệp",
    describe: ({ body, result }) => ({ summary: `Thêm lĩnh vực nghề nghiệp ${join(obj(result).code, str(obj(result).name) || str(body.name))}`, ...target("career_field", obj(result).id) }) },
  { method: "PATCH", path: "/careers/fields/:id", kind: "career", action: "Sửa lĩnh vực nghề nghiệp",
    describe: ({ params, body, result }) => ({ summary: `Sửa lĩnh vực nghề nghiệp ${join(obj(result).code, str(obj(result).name) || str(body.name))}`, ...target("career_field", params.id) }) },
  { method: "DELETE", path: "/careers/fields/:id", kind: "career", action: "Xóa lĩnh vực nghề nghiệp",
    describe: async ({ params, lookup }) => {
      const field = await lookup("SELECT code, name FROM career_fields WHERE id::text=$1", [params.id]);
      return { summary: `Xóa lĩnh vực nghề nghiệp ${careerName(field) || params.id}`, ...target("career_field", params.id) };
    } },
  { method: "POST", path: "/careers/requirements/ai-suggestions/:id/cancel", kind: "career", action: "Hủy AI gợi ý kỹ năng",
    describe: async ({ params, lookup }) => {
      const career = await lookup(`SELECT p.code, p.name_vi AS name FROM career_ai_suggestions s JOIN career_positions p ON p.id=s.career_position_id WHERE s.id::text=$1`, [params.id]);
      return { summary: `Hủy lượt AI gợi ý kỹ năng cho vị trí nghề nghiệp ${careerName(career) || "(không rõ)"}`, ...target("career_ai_suggestion", params.id) };
    } },
  { method: "POST", path: "/careers/requirements/ai-suggestions/:id/apply", kind: "career", action: "Lưu kỹ năng AI gợi ý",
    describe: async ({ params, body, lookup }) => {
      const career = await lookup(`SELECT p.code, p.name_vi AS name FROM career_ai_suggestions s JOIN career_positions p ON p.id=s.career_position_id WHERE s.id::text=$1`, [params.id]);
      return { summary: `Lưu ${list(body.items).length} kỹ năng AI gợi ý cho vị trí nghề nghiệp ${careerName(career) || "(không rõ)"}`, ...target("career_ai_suggestion", params.id) };
    } },
  { method: "POST", path: "/careers/requirements/ai-suggestions", kind: "career", action: "Chạy AI gợi ý kỹ năng",
    describe: async ({ body, lookup }) => {
      const career = await lookup("SELECT code, name_vi AS name FROM career_positions WHERE id::text=$1", [str(body.careerPositionId)]);
      return { summary: `Chạy AI gợi ý kỹ năng cho vị trí nghề nghiệp ${careerName(career) || "(không rõ)"}`, ...target("career", body.careerPositionId) };
    } },
  { method: "POST", path: "/careers", kind: "career", action: "Thêm vị trí nghề nghiệp",
    describe: ({ result }) => { const row = obj(result); return { summary: `Thêm vị trí nghề nghiệp ${join(row.code, row.nameVi)}${countOf(row.skills, "kỹ năng yêu cầu")}`, ...target("career", row.id) }; } },
  { method: "PATCH", path: "/careers/:id", kind: "career", action: "Sửa vị trí nghề nghiệp",
    describe: ({ params, result }) => { const row = obj(result); return { summary: `Sửa vị trí nghề nghiệp ${join(row.code, row.nameVi) || params.id}${countOf(row.skills, "kỹ năng yêu cầu")}`, ...target("career", params.id) }; } },
  { method: "DELETE", path: "/careers/:id", kind: "career", action: "Xóa vị trí nghề nghiệp",
    describe: async ({ params, lookup }) => {
      const career = await lookup("SELECT code, name_vi AS name FROM career_positions WHERE id::text=$1", [params.id]);
      return { summary: `Xóa vị trí nghề nghiệp ${careerName(career) || params.id}`, ...target("career", params.id) };
    } },

  // Năng lực (competencies/router.ts, competencies/ai/router.ts)
  { method: "POST", path: "/competencies/groups", kind: "competency", action: "Thêm nhóm năng lực",
    describe: ({ body, result }) => ({ summary: `Thêm nhóm năng lực ${str(obj(result).name) || str(body.name)}`, ...target("competency_group", obj(result).id) }) },
  { method: "PATCH", path: "/competencies/groups/:id", kind: "competency", action: "Sửa nhóm năng lực",
    describe: ({ params, body, result }) => ({ summary: `Sửa nhóm năng lực ${str(obj(result).name) || str(body.name)}`, ...target("competency_group", params.id) }) },
  { method: "DELETE", path: "/competencies/groups/:id", kind: "competency", action: "Xóa nhóm năng lực",
    describe: async ({ params, lookup }) => {
      const group = await lookup("SELECT name FROM ad_comp_groups WHERE id::text=$1", [params.id]);
      return { summary: `Xóa nhóm năng lực ${str(group?.name) || params.id}`, ...target("competency_group", params.id) };
    } },
  { method: "POST", path: "/competencies/skills", kind: "competency", action: "Thêm cấu hình năng lực",
    describe: ({ body, result }) => ({ summary: `Thêm cấu hình năng lực cho kỹ năng ${str(obj(result).name) || str(body.name)}`, ...target("competency_skill", obj(result).id) }) },
  { method: "PATCH", path: "/competencies/skills/:id", kind: "competency", action: "Sửa cấu hình năng lực",
    describe: ({ params, body, result }) => ({ summary: `Sửa cấu hình năng lực của kỹ năng ${str(obj(result).name) || str(body.name)}`, ...target("competency_skill", params.id) }) },
  { method: "DELETE", path: "/competencies/skills/:id", kind: "competency", action: "Xóa cấu hình năng lực",
    describe: async ({ params, lookup }) => {
      const skill = await lookup("SELECT name FROM career_skills WHERE id::text=$1", [params.id]);
      return { summary: `Xóa cấu hình năng lực của kỹ năng ${str(skill?.name) || params.id}`, ...target("competency_skill", params.id) };
    } },
  { method: "POST", path: "/competencies/courses/clear", kind: "competency", action: "Xóa cấu hình môn học hàng loạt",
    describe: ({ body, result }) => ({ summary: `Xóa ${num(obj(result).cleared) ?? 0} cấu hình môn học (${cohortScope(body.cohort)})` }) },
  { method: "POST", path: "/competencies/courses/activate", kind: "competency", action: "Áp dụng bản nháp cấu hình môn học",
    describe: ({ body, result }) => {
      const row = obj(result), skipped = num(row.skipped) ?? list(row.skipped).length;
      return { summary: `Áp dụng ${num(row.activated) ?? 0} bản nháp liên kết kỹ năng${skipped ? `, bỏ qua ${skipped}` : ""} (${cohortScope(body.cohort)})` };
    } },
  { method: "PUT", path: "/competencies/courses/:id", kind: "competency", action: "Lưu cấu hình môn học",
    describe: ({ params, result }) => {
      const course = obj(result), how = str(course.status) === "active" ? "đang áp dụng" : str(course.status) === "draft" ? "bản nháp" : "";
      const detail = [Array.isArray(course.links) ? `${course.links.length} kỹ năng` : "", how].filter(Boolean).join(", ");
      return { summary: `Lưu liên kết kỹ năng của môn ${join(course.courseCode, course.courseName) || params.id}${detail ? ` (${detail})` : ""}`, ...target("course", params.id) };
    } },
  { method: "DELETE", path: "/competencies/courses/:id", kind: "competency", action: "Ngừng áp dụng cấu hình môn học",
    describe: ({ params, result }) => ({ summary: `Ngừng áp dụng liên kết kỹ năng của môn ${join(obj(result).courseCode, obj(result).courseName) || params.id}`, ...target("course", params.id) }) },
  { method: "POST", path: "/competencies/ai/batches/:batchId/cancel", kind: "competency", action: "Hủy lượt chạy Năng lực AI",
    describe: ({ params }) => ({ summary: "Hủy lượt chạy Năng lực AI cho nhiều môn", ...target("competency_ai_batch", params.batchId) }) },
  { method: "POST", path: "/competencies/ai/batches/:batchId/apply", kind: "competency", action: "Lưu kết quả Năng lực AI",
    describe: ({ params, body, result }) => {
      const row = obj(result), parts = [`${num(row.activated) ?? 0} môn áp dụng`, `${num(row.drafted) ?? 0} môn bản nháp`];
      if (num(row.empty)) parts.push(`${num(row.empty)} môn không có kỹ năng phù hợp`);
      if (list(row.skipped).length) parts.push(`bỏ qua ${list(row.skipped).length} môn`);
      const how = statusWord(body.status);
      return { summary: `Lưu kết quả Năng lực AI${how ? ` (${how})` : ""}: ${parts.join(", ")}`, ...target("competency_ai_batch", params.batchId) };
    } },
  { method: "POST", path: "/competencies/ai/batches", kind: "competency", action: "Chạy Năng lực AI cho nhiều môn",
    describe: ({ body, result }) => {
      const row = obj(result), skipped = list(row.skipped).length;
      return { summary: `Chạy Năng lực AI cho ${num(row.queued) ?? 0} môn (${cohortScope(body.cohort)})${skipped ? `, bỏ qua ${skipped} môn` : ""}`, ...target("competency_ai_batch", row.batchId) };
    } },
  { method: "POST", path: "/competencies/ai/:id/cancel", kind: "competency", action: "Hủy Năng lực AI cho môn học",
    describe: async ({ params, lookup }) => {
      const course = await lookup(`SELECT COALESCE(c.code, s.course_code) AS code, c.name FROM ad_comp_ai_suggestions s LEFT JOIN ad_comp_courses c ON c.id=s.course_id WHERE s.id::text=$1`, [params.id]);
      return { summary: `Hủy Năng lực AI cho môn ${join(course?.code, course?.name) || "(không rõ)"}`, ...target("competency_ai_suggestion", params.id) };
    } },
  { method: "POST", path: "/competencies/ai/:id/apply", kind: "competency", action: "Lưu kết quả Năng lực AI cho môn học",
    describe: ({ params, body, result }) => {
      const course = obj(obj(result).course), how = statusWord(body.status);
      return { summary: `Lưu kết quả Năng lực AI cho môn ${join(course.courseCode, course.courseName) || "(không rõ)"}${how ? ` (${how})` : ""}`, ...target("competency_ai_suggestion", params.id) };
    } },
  { method: "POST", path: "/competencies/ai", kind: "competency", action: "Chạy Năng lực AI cho môn học",
    describe: async ({ body, lookup }) => {
      const course = await lookup("SELECT code, name FROM ad_comp_courses WHERE id::text=$1", [str(body.courseId)]);
      const what = str(body.mode) === "weights" ? "trọng số" : "liên kết kỹ năng";
      return { summary: `Chạy Năng lực AI (${what}) cho môn ${join(course?.code, course?.name) || "(không rõ)"}`, ...target("course", body.courseId) };
    } },

  // Thông báo của Khoa (notifications/admin-router.ts)
  { method: "POST", path: "/announcements/:id/withdraw", kind: "notify", action: "Thu hồi thông báo",
    describe: ({ params, result }) => ({ summary: `Thu hồi thông báo "${str(obj(obj(result).announcement).title) || params.id}"`, ...target("announcement", params.id) }) },
  { method: "POST", path: "/announcements", kind: "notify", action: "Gửi thông báo",
    describe: ({ body, result }) => {
      const sent = obj(obj(result).announcement), recipients = num(sent.recipients);
      return { summary: `Gửi thông báo "${str(sent.title) || str(body.title)}"${recipients === null ? "" : ` cho ${recipients} sinh viên`}`, ...target("announcement", sent.id) };
    } },
];

// --------------------------------------------------------------------------------------------------------- matching

type Compiled = { route: AuditRoute; pattern: RegExp; names: string[] };
const compiled: Compiled[] = AUDIT_ROUTES.map((route) => {
  const names: string[] = [];
  const source = route.path.split("/").map((part) => {
    if (!part.startsWith(":")) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    names.push(part.slice(1));
    return "([^/]+)";
  }).join("/");
  return { route, pattern: new RegExp(`^${source}/?$`), names };
});

/** The rule of a request under /api/admin (path without /api/admin and the query), with its decoded params; null when none. */
export function matchAuditRoute(method: string, path: string): { route: AuditRoute; params: Record<string, string> } | null {
  const verb = method.toUpperCase();
  for (const { route, pattern, names } of compiled) {
    if (route.method !== verb) continue;
    const match = pattern.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    names.forEach((name, index) => {
      const raw = match[index + 1]!;
      try { params[name] = decodeURIComponent(raw); } catch { params[name] = raw; }
    });
    return { route, params };
  }
  return null;
}

/** The line of a change no rule names yet (a new admin route): still logged, by its request. */
export function unknownRoute(method: string, path: string): Described & { action: string } {
  return { action: "Thay đổi dữ liệu", summary: `Yêu cầu ${method.toUpperCase()} /api/admin${path}` };
}
