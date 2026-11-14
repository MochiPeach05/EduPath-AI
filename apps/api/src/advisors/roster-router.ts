// Import danh sách sinh viên (reviewer note 2026-11-14, migration 065; contract: apps/web/src/advisor-roster-types.ts),
// mounted on /api/admin/advisor-portal/roster after the portal router's own checks (an active admin-portal account, the
// web app's exact Origin for a change). GET /template is the sample tệp ("Tải tệp mẫu"); POST /import/preview reads a tệp
// and says what importing it would do, POST /import imports it. Both take the raw .xlsx with its name in x-filename and
// ?class=, the class the import was opened for (the rows without a class go there). DELETE /students/:code removes a
// student who never signed in from their class list ("Xóa khỏi danh sách lớp"). Which classes the account may import or
// change is checked on the server (roster-repository.ts); the role 'advisor' may send these requests at all because
// access.ts lists them (ADVISOR_ADMIN_READS, ADVISOR_ADMIN_WRITES). Both changes are logged by the admin log
// (audit/routes.ts).
import { Router, raw, type ErrorRequestHandler } from "express";
import { classCode, needsCohort } from "./class-code.js";
import { AdvisorError, CLASS_PATTERN } from "./model.js";
import { STUDENT_CODE, cleanStudentCode, readRosterWorkbook, rosterTemplate } from "./roster.js";
import type { RosterRepository } from "./roster-repository.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** ?class= as a canonical class code (class-code.ts), null when absent; a class without its cohort (CNTT01) is refused. */
export function classParameter(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 60) throw new AdvisorError("invalid_class", 400);
  const name = classCode(value);
  if (!name) return null;
  if (!CLASS_PATTERN.test(name) || needsCohort(name)) throw new AdvisorError("invalid_class", 400);
  return name;
}

export function createRosterRouter(repository: RosterRepository) {
  const router = Router();
  const upload = raw({ type: XLSX, limit: "5mb" });
  const workbook = (body: unknown) => {
    if (!Buffer.isBuffer(body) || !body.length) throw new AdvisorError("invalid_workbook", 400);
    return body;
  };
  const fileName = (header: string | undefined) => {
    let name = "danh-sach-lop.xlsx";
    try { name = decodeURIComponent(header ?? name); } catch { throw new AdvisorError("invalid_filename", 400); }
    if (!/\.xlsx$/i.test(name) || name.length > 240 || /[\x00-\x1f/\\]/.test(name)) throw new AdvisorError("invalid_filename", 400);
    return name;
  };

  router.get("/template", async (req, res) => {
    const className = classParameter(req.query.class);
    res.type(XLSX).attachment(`mau-danh-sach-sinh-vien${className ? `-${className}` : ""}.xlsx`).send(await rosterTemplate(className));
  });
  router.post("/import/preview", upload, async (req, res) => {
    const name = fileName(req.get("x-filename"));
    const className = classParameter(req.query.class);
    res.json(await repository.preview(req.session.user!, name, await readRosterWorkbook(workbook(req.body), className)));
  });
  router.post("/import", upload, async (req, res) => {
    const name = fileName(req.get("x-filename"));
    const className = classParameter(req.query.class);
    res.json(await repository.apply(req.session.user!, name, await readRosterWorkbook(workbook(req.body), className)));
  });

  router.delete("/students/:code", async (req, res) => {
    const code = cleanStudentCode(String(req.params.code ?? ""));
    if (!STUDENT_CODE.test(code)) throw new AdvisorError("listed_student_not_found", 404);
    res.json({ removed: await repository.remove(req.session.user!, code) });
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AdvisorError) { res.status(error.status).json({ error: error.code, ...error.details }); return; }
    if (error?.type === "entity.too.large") { res.status(413).json({ error: "workbook_too_large" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
