import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import { requireAuthentication } from "../middleware/authorization.js";
import {
  ACTING_ACTIONS, actingAction, actingAdvisor, advisorActing, advisorReadOnly, normalizeClassName, studentLabel, studentUser,
} from "./access.js";

const STUDENT_ID = "0b8c2f1e-4d3a-4f6b-8a1e-2c3d4e5f6a70";
const ADVISOR_ID = "9a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
const staffDomains = new Set(["vlu.edu.vn"]);

const student = {
  userId: STUDENT_ID, identityKey: "t:o", tenantId: "tenant", objectId: "o", name: "2374802010994 - Sinh viên Thử nghiệm - 71K29CNTT99",
  email: "e2e.k29@vanlanguni.vn", username: "e2e.k29@vanlanguni.vn", role: "student", signedInAt: "2026-11-03T00:00:00.000Z",
} as AuthenticatedUser;
const advisor = {
  userId: ADVISOR_ID, identityKey: "t:a", tenantId: "tenant", objectId: "a", name: "Nguyễn Văn Cố Vấn", email: "co.van@vlu.edu.vn",
  username: "co.van@vlu.edu.vn", role: "advisor", signedInAt: "2026-11-03T00:00:00.000Z",
} as AuthenticatedUser;
/** The row advisedStudent reads for a student of the advisor's class. */
const advisedRow = {
  id: STUDENT_ID, tenant: "tenant", object_id: "o", display_name: student.name, email: student.email, username: student.username,
  auth_version: 2, student_code: "2374802010994", full_name: "Sinh viên Thử nghiệm", class_name: "71K29CNTT99", advisor_name: "ThS. Nguyễn Văn Cố Vấn",
};

/** An app: fake session, the acting middleware on /api/student and a few student routes that answer who they act for. */
function setup(user: AuthenticatedUser | null, row: Record<string, unknown> | null = advisedRow, status = 200) {
  const writes: { table: "audit" | "notification"; values: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("INSERT INTO ad_audit_log")) { writes.push({ table: "audit", values }); return { rowCount: 1, rows: [] }; }
    if (sql.includes("INSERT INTO stu_notifications")) { writes.push({ table: "notification", values }); return { rowCount: 1, rows: [] }; }
    if (sql.includes("ad_advisor_classes")) return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    return { rowCount: 0, rows: [] };
  });
  const app = express();
  app.use(((req, _res, next) => { req.session = { user: user ?? undefined } as typeof req.session; next(); }) as RequestHandler);
  app.use("/api/student", advisorActing({ query } as never, staffDomains));
  const who: RequestHandler = (req, res) => {
    res.status(status).json({ student: studentUser(req).userId, advisor: actingAdvisor(req)?.userId ?? null, label: req.advisorActing ? studentLabel(req.advisorActing.student) : null });
  };
  app.use("/api/student", requireAuthentication);
  app.get("/api/student/overview", who);
  app.get("/api/student/notifications", who);
  app.post("/api/student/transcript", who);
  app.post("/api/student/competency-assessments/:id/ai", who);
  app.post("/api/student/graduation/advice/ensure", who);
  app.patch("/api/student/profile", who);
  app.put("/api/student/survey", who);
  app.delete("/api/student/transcript", who);
  app.delete("/api/student/assistant/threads/:id", who);
  app.put("/api/student/study-plan", who);
  return { app, query, writes };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("a cố vấn học tập in a student's page (advisorActing)", () => {
  it("lets a student through untouched, whatever the header says", async () => {
    const { app, query } = setup(student);
    const answer = await request(app).get("/api/student/overview").set("X-Advisor-Student", ADVISOR_ID).expect(200);
    expect(answer.body).toEqual({ student: STUDENT_ID, advisor: null, label: null });
    expect(query).not.toHaveBeenCalled();
  });

  it("leaves a request without a session to the routes (401)", async () => {
    const { app } = setup(null);
    expect((await request(app).get("/api/student/overview").expect(401)).body).toEqual({ error: "authentication_required" });
  });

  it("keeps an admin-portal account out without a student named", async () => {
    const { app, query } = setup(advisor);
    expect((await request(app).get("/api/student/overview").expect(403)).body).toEqual({ error: "student_portal_blocked" });
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a malformed id without reading, and a student of another class after reading", async () => {
    const bad = setup(advisor);
    expect((await request(bad.app).get("/api/student/overview").set("X-Advisor-Student", "not-a-uuid").expect(403)).body)
      .toEqual({ error: "advisor_student_forbidden" });
    expect(bad.query).not.toHaveBeenCalled();
    const other = setup(advisor, null);
    expect((await request(other.app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(403)).body)
      .toEqual({ error: "advisor_student_forbidden" });
    expect(other.query.mock.calls[0]?.[1]).toEqual([STUDENT_ID, ADVISOR_ID]);
  });

  it("reads the student's page as the student, and names the advisor", async () => {
    const { app, writes } = setup(advisor);
    const answer = await request(app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(200);
    expect(answer.body).toEqual({ student: STUDENT_ID, advisor: ADVISOR_ID, label: "2374802010994 – Sinh viên Thử nghiệm (lớp 71K29CNTT99)" });
    await settle();
    expect(writes).toEqual([]);
  });

  it("works for a staff account of another admin-portal role that advises the class", async () => {
    const { app } = setup({ ...advisor, role: "lecturer" });
    expect((await request(app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(200)).body.student).toBe(STUDENT_ID);
  });

  it("keeps the student's notifications closed", async () => {
    const { app } = setup(advisor);
    expect((await request(app).get("/api/student/notifications").set("X-Advisor-Student", STUDENT_ID).expect(403)).body)
      .toEqual({ error: "advisor_action_not_allowed" });
  });

  it.each([
    ["patch", "/api/student/profile"], ["put", "/api/student/survey"], ["delete", "/api/student/transcript"],
    ["delete", `/api/student/assistant/threads/${STUDENT_ID}`], ["put", "/api/student/study-plan"],
  ] as const)("refuses %s %s, which the policy leaves to the student", async (method, path) => {
    const { app, writes } = setup(advisor);
    expect((await request(app)[method](path).set("X-Advisor-Student", STUDENT_ID).expect(403)).body).toEqual({ error: "advisor_action_not_allowed" });
    await settle();
    expect(writes).toEqual([]);
  });

  it("logs an import done for the student and tells the student once a day", async () => {
    const { app, writes } = setup(advisor);
    const answer = await request(app).post("/api/student/transcript?x=1").set("X-Advisor-Student", STUDENT_ID).expect(200);
    expect(answer.body.advisor).toBe(ADVISOR_ID);
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    const audit = writes.find((write) => write.table === "audit")!.values;
    expect(audit.slice(1, 11)).toEqual([ADVISOR_ID, "Nguyễn Văn Cố Vấn", "advisor", "advisor", "Import bảng điểm thay sinh viên",
      "2374802010994 – Sinh viên Thử nghiệm (lớp 71K29CNTT99)", "student", STUDENT_ID, "POST", "/api/student/transcript"]);
    const notification = writes.find((write) => write.table === "notification")!.values;
    expect(notification[1]).toBe(STUDENT_ID);
    expect(notification.slice(2, 4)).toEqual(["khoa", "advisor_action"]);
    expect(notification[4]).toBe("Cố vấn học tập đã import bảng điểm thay bạn");
    expect(String(notification[5])).toContain("ThS. Nguyễn Văn Cố Vấn (cố vấn học tập của lớp bạn) đã import bảng điểm thay bạn");
    expect(notification[6]).toBe("#profile");
    expect(notification[8]).toMatch(new RegExp(`^advisor:transcript:${ADVISOR_ID}:\\d{4}-\\d{2}-\\d{2}$`));
  });

  it("writes nothing when the action fails", async () => {
    const { app, writes } = setup(advisor, advisedRow, 409);
    await request(app).post("/api/student/transcript").set("X-Advisor-Student", STUDENT_ID).expect(409);
    await settle();
    expect(writes).toEqual([]);
  });

  it("logs an action without a notification of its own, and leaves the automatic advice request out of the log", async () => {
    const ai = setup(advisor);
    await request(ai.app).post(`/api/student/competency-assessments/${STUDENT_ID}/ai`).set("X-Advisor-Student", STUDENT_ID).expect(200);
    await vi.waitFor(() => expect(ai.writes).toHaveLength(1));
    expect(ai.writes[0]!.table).toBe("audit");
    expect(ai.writes[0]!.values[5]).toBe("Tạo lại nhận xét năng lực thay sinh viên");
    const ensure = setup(advisor);
    await request(ensure.app).post("/api/student/graduation/advice/ensure").set("X-Advisor-Student", STUDENT_ID).expect(200);
    await settle();
    expect(ensure.writes).toEqual([]);
  });

  it("matches only the listed paths", () => {
    expect(actingAction("POST", "/transcript")?.key).toBe("transcript");
    expect(actingAction("POST", "/transcript/")).toBeNull();
    expect(actingAction("DELETE", "/transcript")).toBeNull();
    expect(actingAction("POST", "/assistant/threads")?.did).toBe("đã hỏi Trợ lý AI");
    expect(actingAction("POST", `/assistant/threads/${STUDENT_ID}/messages`)?.key).toBe("assistant");
    expect(actingAction("DELETE", `/assistant/threads/${STUDENT_ID}`)).toBeNull();
    expect(actingAction("PUT", "/study-plan")).toBeNull();
    // Every notified action opens a page of the student portal.
    for (const rule of ACTING_ACTIONS) if (rule.did) expect(rule.link).toMatch(/^#[a-z-]+$/);
  });

  it("stores class names in upper case without spaces", () => {
    expect(normalizeClassName(" 71k29 cntt01 ")).toBe("71K29CNTT01");
  });
});

describe("the role advisor in the admin portal (advisorReadOnly)", () => {
  function admin(user: AuthenticatedUser) {
    const app = express();
    app.use(((req, _res, next) => { req.session = { user } as typeof req.session; next(); }) as RequestHandler);
    app.use("/api/admin", advisorReadOnly);
    app.all(/^\/api\/admin\/.*/, (_req, res) => { res.json({ ok: true }); });
    return app;
  }

  it("reads the catalog pages and changes nothing", async () => {
    const app = admin(advisor);
    await request(app).get("/api/admin/careers").expect(200);
    await request(app).get("/api/admin/students").expect(200);
    expect((await request(app).post("/api/admin/careers").send({}).expect(403)).body).toEqual({ error: "read_only_role" });
    expect((await request(app).delete(`/api/admin/advisors/${ADVISOR_ID}`).expect(403)).body).toEqual({ error: "read_only_role" });
  });

  it("does not even read the reports, the log, the accounts and the announcements", async () => {
    const app = admin(advisor);
    for (const path of ["/api/admin/reports/overview", "/api/admin/audit-log", "/api/admin/accounts", "/api/admin/announcements"]) {
      expect((await request(app).get(path).expect(403)).body).toEqual({ error: "insufficient_role" });
    }
  });

  it("opens a student's page, the one write it has", async () => {
    await request(admin(advisor)).post(`/api/admin/advisor-portal/students/${STUDENT_ID}/open`).expect(200);
  });

  it("leaves the other roles alone", async () => {
    const app = admin({ ...advisor, role: "admin" });
    await request(app).post("/api/admin/careers").send({}).expect(200);
    await request(app).get("/api/admin/reports/overview").expect(200);
  });
});
