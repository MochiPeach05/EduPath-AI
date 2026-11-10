import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { advisorAction } from "../notifications/notify.js";
import {
  ACTING_ACTIONS, actingAction, actingAdvisor, advisorActing, advisorReadOnly, advisedStudent, normalizeClassName, studentLabel, studentUser, createStudentViews, STUDENT_VIEW_LOG_MS,
} from "./access.js";
import { CLASS_OF } from "./class-code.js";

const STUDENT_ID = "0b8c2f1e-4d3a-4f6b-8a1e-2c3d4e5f6a70";
const ADVISOR_ID = "9a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
const ADMIN_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const staffDomains = new Set(["vlu.edu.vn"]);

const student = {
  userId: STUDENT_ID, identityKey: "t:o", tenantId: "tenant", objectId: "o", name: "2374802010994 - Sinh viên Thử nghiệm - 71K29CNTT99",
  email: "e2e.k29@vanlanguni.vn", username: "e2e.k29@vanlanguni.vn", role: "student", signedInAt: "2026-11-03T00:00:00.000Z",
} as AuthenticatedUser;
const advisor = {
  userId: ADVISOR_ID, identityKey: "t:a", tenantId: "tenant", objectId: "a", name: "Nguyễn Văn Cố Vấn", email: "co.van@vlu.edu.vn",
  username: "co.van@vlu.edu.vn", role: "advisor", signedInAt: "2026-11-03T00:00:00.000Z",
} as AuthenticatedUser;
/** A quản trị viên of the Khoa (canManageAdvisors), who works for any student (user 2026-11-03: AD-AST "QTV & CVHT"). */
const qtv = {
  ...advisor, userId: ADMIN_ID, identityKey: "t:q", objectId: "q", name: "Trần Thị Quản Trị", email: "quan.tri@vlu.edu.vn",
  username: "quan.tri@vlu.edu.vn", role: "admin",
} as AuthenticatedUser;
/** The row advisedStudent reads for a student of the advisor's class. */
const advisedRow = {
  id: STUDENT_ID, tenant: "tenant", object_id: "o", display_name: student.name, email: student.email, username: student.username,
  auth_version: 2, student_code: "2374802010994", full_name: "Sinh viên Thử nghiệm", class_name: "71K29CNTT99", actor_name: "ThS. Nguyễn Văn Cố Vấn",
};
/** The row advisedStudent reads for any student when the account is an admin and advises none of the student's class. */
const anyRow = { ...advisedRow, class_name: "71K29CNTT05", actor_name: "Trần Thị Quản Trị" };

/**
 * An app: fake session, the acting middleware on /api/student and a few student routes that answer who they act for.
 * row: what the class query (own classes) finds; any: what the second query (any student, admins only) finds.
 */
function setup(user: AuthenticatedUser | null, row: Record<string, unknown> | null = advisedRow, status = 200, any: Record<string, unknown> | null = null) {
  const writes: { table: "audit" | "notification"; values: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("INSERT INTO ad_audit_log")) { writes.push({ table: "audit", values }); return { rowCount: 1, rows: [] }; }
    if (sql.includes("INSERT INTO stu_notifications")) { writes.push({ table: "notification", values }); return { rowCount: 1, rows: [] }; }
    if (sql.includes("ad_advisor_classes")) return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    if (sql.includes("LEFT JOIN student_profiles")) return { rowCount: any ? 1 : 0, rows: any ? [any] : [] };
    return { rowCount: 0, rows: [] };
  });
  const app = express();
  // As in app.ts, the JSON body is read before advisorActing (the profile rules look at its fields).
  app.use(express.json());
  app.use(((req, _res, next) => { req.session = { user: user ?? undefined } as typeof req.session; next(); }) as RequestHandler);
  app.use("/api/student", advisorActing({ query } as never, staffDomains, createStudentViews()));
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

  it("reads the student's page as the student, names the advisor, and logs the opening once (QA 2026-11-07)", async () => {
    const { app, writes } = setup(advisor);
    const answer = await request(app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(200);
    expect(answer.body).toEqual({ student: STUDENT_ID, advisor: ADVISOR_ID, label: "2374802010994 – Sinh viên Thử nghiệm (lớp 71K29CNTT99)" });
    await settle();
    // Opened straight from /dashboard?sv=… or read through the API: one "Mở trang sinh viên", however many reads follow.
    expect(writes.map((write) => write.table)).toEqual(["audit"]);
    expect(writes[0]!.values.slice(1, 11)).toEqual([ADVISOR_ID, "Nguyễn Văn Cố Vấn", "advisor", "advisor", "Mở trang sinh viên",
      "2374802010994 – Sinh viên Thử nghiệm (lớp 71K29CNTT99)", "student", STUDENT_ID, "GET", "/api/student/overview"]);
    await request(app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(200);
    await settle();
    expect(writes).toHaveLength(1);
  });

  it("logs a refused read of the student's data nowhere, and logs again after half an hour", async () => {
    const { app, writes } = setup(advisor, advisedRow, 500);
    await request(app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(500);
    await settle();
    expect(writes).toEqual([]);
    const views = createStudentViews();
    views.mark("a", "s", 1_000);
    expect(views.due("a", "s", 1_000 + STUDENT_VIEW_LOG_MS - 1)).toBe(false);
    expect(views.due("a", "s", 1_000 + STUDENT_VIEW_LOG_MS)).toBe(true);
    expect(views.due("a", "other", 1_000)).toBe(true);
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

  it("changes the specialty and the target vị trí nghề nghiệp for the student, logged and told (user 2026-11-10)", async () => {
    const CAREER = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";
    const cases = [
      [{ specialty: "CNPM" }, "Đổi chuyên ngành thay sinh viên", "Cố vấn học tập đã đổi chuyên ngành thay bạn", "#profile", "specialty"],
      [{ careerPositionId: CAREER }, "Đổi vị trí nghề nghiệp mục tiêu thay sinh viên", "Cố vấn học tập đã đổi vị trí nghề nghiệp mục tiêu thay bạn", "#career", "career"],
      [{ careerPositionId: null, specialty: null }, "Đổi chuyên ngành và vị trí nghề nghiệp mục tiêu thay sinh viên",
        "Cố vấn học tập đã đổi chuyên ngành và vị trí nghề nghiệp mục tiêu thay bạn", "#profile", "goals"],
    ] as const;
    for (const [body, action, title, link, key] of cases) {
      const { app, writes } = setup(advisor);
      const answer = await request(app).patch("/api/student/profile").set("X-Advisor-Student", STUDENT_ID).send(body).expect(200);
      expect(answer.body).toMatchObject({ student: STUDENT_ID, advisor: ADVISOR_ID });
      await vi.waitFor(() => expect(writes).toHaveLength(2));
      expect(writes.find((write) => write.table === "audit")!.values.slice(5, 11)).toEqual([action,
        "2374802010994 – Sinh viên Thử nghiệm (lớp 71K29CNTT99)", "student", STUDENT_ID, "PATCH", "/api/student/profile"]);
      const notification = writes.find((write) => write.table === "notification")!.values;
      expect(notification.slice(1, 5)).toEqual([STUDENT_ID, "khoa", "advisor_action", title]);
      expect(notification[5]).toBe(`ThS. Nguyễn Văn Cố Vấn (cố vấn học tập của lớp bạn) ${title.replace("Cố vấn học tập ", "")} trên EduPath AI. `
        + "Bạn xem lại lựa chọn này; nếu chưa đúng ý, bạn vẫn tự đổi lại được như thường.");
      expect(notification[6]).toBe(link);
      expect(notification[8]).toMatch(new RegExp(`^advisor:${key}:${ADVISOR_ID}:\\d{4}-\\d{2}-\\d{2}$`));
    }
  });

  it.each([
    ["no field", {}], ["the survey's old interests", { interests: "Lập trình" }], ["the term", { currentSemester: 2 }],
    ["the specialty with the class", { specialty: "CNPM", className: "71K29CNTT01" }], ["the interest lists", { careerPositionId: null, interestTech: [], interestHobbies: [] }],
  ])("keeps the rest of the profile the student's: %s", async (_what, body) => {
    const { app, writes } = setup(advisor);
    expect((await request(app).patch("/api/student/profile").set("X-Advisor-Student", STUDENT_ID).send(body).expect(403)).body)
      .toEqual({ error: "advisor_action_not_allowed" });
    await settle();
    expect(writes).toEqual([]);
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
    expect(actingAction("PATCH", "/profile")).toBeNull();
    expect(actingAction("PATCH", "/profile", { specialty: "CNPM" })?.key).toBe("specialty");
    expect(actingAction("PATCH", "/profile", { specialty: null, careerPositionId: null })?.key).toBe("goals");
    expect(actingAction("PATCH", "/profile", ["specialty"])).toBeNull();
    expect(actingAction("PATCH", "/profile", { specialty: "CNPM", interests: null })).toBeNull();
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

  it("matches the student's class as a canonical code: CNTT08 of K29 is the advisor's 71K29CNTT08 (QA 2026-11-04)", async () => {
    const { app, query } = setup(advisor);
    await request(app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(200);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain(`JOIN ad_advisor_classes c ON c.class_name=${CLASS_OF}`);
    // The class and the cohort of the profile, and the account's display name for the prefix (72K29CNTT01).
    expect(sql).toContain("p.class_name");
    expect(sql).toContain("p.cohort_code");
    expect(sql).toContain("u.display_name");
  });

  it("names a student without a class by code and name only", () => {
    expect(studentLabel({ studentCode: "2374802010994", name: "Sinh viên Thử nghiệm", className: "" })).toBe("2374802010994 – Sinh viên Thử nghiệm");
    expect(studentLabel({ studentCode: null, name: "Sinh viên Thử nghiệm", className: "71K29CNTT99" })).toBe("Sinh viên Thử nghiệm (lớp 71K29CNTT99)");
  });
});

describe("a quản trị viên or Ban chủ nhiệm khoa in a student's page (QTV & CVHT)", () => {
  it.each(["admin", "faculty_board"] as const)("lets a %s work in the page of any student", async (role) => {
    const { app, query } = setup({ ...qtv, role }, null, 200, anyRow);
    const answer = await request(app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(200);
    expect(answer.body).toEqual({ student: STUDENT_ID, advisor: ADMIN_ID, label: "2374802010994 – Sinh viên Thử nghiệm (lớp 71K29CNTT05)" });
    // The own classes first, then any active student account (the log of the opening comes after, QA 2026-11-07).
    const lookups = query.mock.calls.filter(([sql]) => !String(sql).includes("INSERT INTO ad_audit_log"));
    expect(lookups.map((call) => call[1])).toEqual([[STUDENT_ID, ADMIN_ID], [STUDENT_ID, ADMIN_ID]]);
    expect(String(lookups[1]?.[0])).toMatch(/u\.is_active AND COALESCE\(u\.role_override, u\.role\)='student'/);
    expect(String(lookups[1]?.[0])).toContain(`${CLASS_OF} AS class_name`);
  });

  it("keeps the other admin-portal roles to their own classes", async () => {
    for (const role of ["lecturer", "department_head", "advisor"] as const) {
      const { app, query } = setup({ ...qtv, role }, null, 200, anyRow);
      expect((await request(app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(403)).body).toEqual({ error: "advisor_student_forbidden" });
      expect(query).toHaveBeenCalledOnce();
    }
  });

  it("refuses an id that is no active student account, even for an admin", async () => {
    const { app, query } = setup(qtv, null, 200, null);
    expect((await request(app).get("/api/student/overview").set("X-Advisor-Student", STUDENT_ID).expect(403)).body).toEqual({ error: "advisor_student_forbidden" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("holds an admin to the same actions as an advisor", async () => {
    const { app, writes } = setup(qtv, null, 200, anyRow);
    expect((await request(app).get("/api/student/notifications").set("X-Advisor-Student", STUDENT_ID).expect(403)).body).toEqual({ error: "advisor_action_not_allowed" });
    expect((await request(app).patch("/api/student/profile").set("X-Advisor-Student", STUDENT_ID).send({ currentSemester: 2 }).expect(403)).body).toEqual({ error: "advisor_action_not_allowed" });
    expect((await request(app).delete("/api/student/transcript").set("X-Advisor-Student", STUDENT_ID).expect(403)).body).toEqual({ error: "advisor_action_not_allowed" });
    await settle();
    expect(writes).toEqual([]);
  });

  it("logs an admin's import as kind advisor and tells the student a quản trị viên of the Khoa did it", async () => {
    const { app, writes } = setup(qtv, null, 200, anyRow);
    await request(app).post("/api/student/transcript").set("X-Advisor-Student", STUDENT_ID).expect(200);
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    const audit = writes.find((write) => write.table === "audit")!.values;
    expect(audit.slice(1, 11)).toEqual([ADMIN_ID, "Trần Thị Quản Trị", "admin", "advisor", "Import bảng điểm thay sinh viên",
      "2374802010994 – Sinh viên Thử nghiệm (lớp 71K29CNTT05)", "student", STUDENT_ID, "POST", "/api/student/transcript"]);
    const notification = writes.find((write) => write.table === "notification")!.values;
    expect(notification[4]).toBe("Quản trị viên của Khoa đã import bảng điểm thay bạn");
    expect(String(notification[5])).toContain("Trần Thị Quản Trị (quản trị viên của Khoa) đã import bảng điểm thay bạn trên EduPath AI.");
    expect(notification[8]).toMatch(new RegExp(`^advisor:transcript:${ADMIN_ID}:\\d{4}-\\d{2}-\\d{2}$`));
  });

  it("lets an admin change the target vị trí nghề nghiệp and tells the student a quản trị viên of the Khoa did it", async () => {
    const { app, writes } = setup(qtv, null, 200, anyRow);
    await request(app).patch("/api/student/profile").set("X-Advisor-Student", STUDENT_ID).send({ careerPositionId: STUDENT_ID }).expect(200);
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.find((write) => write.table === "audit")!.values.slice(1, 6)).toEqual([ADMIN_ID, "Trần Thị Quản Trị", "admin", "advisor",
      "Đổi vị trí nghề nghiệp mục tiêu thay sinh viên"]);
    const notification = writes.find((write) => write.table === "notification")!.values;
    expect(notification[4]).toBe("Quản trị viên của Khoa đã đổi vị trí nghề nghiệp mục tiêu thay bạn");
    expect(String(notification[5])).toMatch(/^Trần Thị Quản Trị \(quản trị viên của Khoa\) đã đổi vị trí nghề nghiệp mục tiêu thay bạn trên EduPath AI\./);
  });

  it("names an admin who advises the student's class as the class's cố vấn học tập", async () => {
    const { app, query, writes } = setup(qtv, advisedRow, 200, anyRow);
    await request(app).post("/api/student/transcript").set("X-Advisor-Student", STUDENT_ID).expect(200);
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.find((write) => write.table === "notification")!.values[4]).toBe("Cố vấn học tập đã import bảng điểm thay bạn");
    expect(query.mock.calls.filter((call) => String(call[0]).includes("LEFT JOIN student_profiles"))).toEqual([]);
  });

  it("gives the kind and the name the student is told", async () => {
    const db = (classRow: unknown, any: unknown) => ({ query: vi.fn(async (sql: string) =>
      ({ rows: sql.includes("ad_advisor_classes") ? (classRow ? [classRow] : []) : any ? [any] : [] })) });
    expect(await advisedStudent(db(advisedRow, null) as never, advisor, STUDENT_ID))
      .toMatchObject({ actorKind: "advisor", actorName: "ThS. Nguyễn Văn Cố Vấn", advisorName: "ThS. Nguyễn Văn Cố Vấn", className: "71K29CNTT99" });
    expect(await advisedStudent(db(null, { ...anyRow, class_name: null }) as never, qtv, STUDENT_ID))
      .toMatchObject({ actorKind: "admin", actorName: "Trần Thị Quản Trị", className: "", user: { userId: STUDENT_ID, role: "student" } });
    expect(await advisedStudent(db(null, anyRow) as never, advisor, STUDENT_ID)).toBeNull();
    expect(await advisedStudent(db(null, anyRow) as never, qtv, "not-a-uuid")).toBeNull();
  });
});

describe("the student's notification of an action done for them (advisorAction)", () => {
  it("says who did it: the class's cố vấn học tập or a quản trị viên of the Khoa", () => {
    expect(advisorAction("ThS. Nguyễn Văn Cố Vấn", "đã tạo Lộ trình AI", "#roadmap", "2026-11-03", `roadmap:${ADVISOR_ID}`)).toEqual({
      type: "khoa", kind: "advisor_action", title: "Cố vấn học tập đã tạo Lộ trình AI thay bạn",
      body: "ThS. Nguyễn Văn Cố Vấn (cố vấn học tập của lớp bạn) đã tạo Lộ trình AI thay bạn trên EduPath AI. Bạn xem lại kết quả; nếu không muốn giữ, bạn vẫn xóa được như thường.",
      link: "#roadmap", sourceKey: `advisor:roadmap:${ADVISOR_ID}:2026-11-03`,
    });
    const byAdmin = advisorAction("Trần Thị Quản Trị", "đã hỏi Trợ lý AI", "#assistant", "2026-11-03", `assistant:${ADMIN_ID}`, "admin");
    expect(byAdmin.title).toBe("Quản trị viên của Khoa đã hỏi Trợ lý AI thay bạn");
    expect(byAdmin.body).toMatch(/^Trần Thị Quản Trị \(quản trị viên của Khoa\) đã hỏi Trợ lý AI thay bạn trên EduPath AI\./);
    expect(byAdmin.sourceKey).toBe(`advisor:assistant:${ADMIN_ID}:2026-11-03`);
  });

  it("names only the role when there is no name", () => {
    expect(advisorAction(" ", "đã chạy Đánh giá năng lực", "#competency", "2026-11-03", "k", "admin").body)
      .toMatch(/^Quản trị viên của Khoa đã chạy Đánh giá năng lực thay bạn/);
    expect(advisorAction("", "đã chạy Đánh giá năng lực", "#competency", "2026-11-03", "k").body)
      .toMatch(/^Cố vấn học tập của lớp bạn đã chạy Đánh giá năng lực thay bạn/);
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

  it("reads Thống kê and its Excel files and Nhật ký (user 2026-11-07), not the accounts and the announcements", async () => {
    const app = admin(advisor);
    for (const path of ["/api/admin/reports/options", "/api/admin/reports/dashboard", "/api/admin/reports/progress", "/api/admin/reports/progress.xlsx",
      "/api/admin/reports/risk.xlsx", "/api/admin/reports/skills/students", "/api/admin/reports/courses/students", "/api/admin/reports/careers",
      "/api/admin/audit-log"]) {
      expect((await request(app).get(path).expect(200)).body).toEqual({ ok: true });
    }
    for (const path of ["/api/admin/reports/overview", "/api/admin/accounts", "/api/admin/accounts/history", "/api/admin/announcements"]) {
      expect((await request(app).get(path).expect(403)).body).toEqual({ error: "admin_only" });
    }
  });

  // Function list ver0.3 (user 2026-11-04): CVHT gets the views, searches and filters of its "QTV & CVHT" and "Cố vấn học
  // tập" rows, nothing else.
  const ID = "6f1c2a9e-0b7d-4c1e-9a3f-2d4e5f607182";
  const REVISION = "7a2d3b0f-1c8e-4d2f-8b4a-3e5f60718293";
  it.each([
    ["AD-AUTH-01", "/api/admin/me"],
    ["AD-PROF-01…04", "/api/admin/students"], ["AD-PROF-02", `/api/admin/students/${ID}`], ["AD-AST-06", `/api/admin/students/${ID}/transcript`],
    ["AD-AST-01", "/api/admin/advisor-portal/classes"], ["AD-AST-02…04", "/api/admin/advisor-portal/students"],
    ["AD-AST-09", "/api/admin/advisor-portal/permissions"], ["AD-AST", "/api/admin/advisor-portal/me"],
    ["AD-ADV-04", "/api/admin/advisors"], ["AD-ADV-05", `/api/admin/advisors/${ID}`],
    ["AD-CURR-03…05", "/api/admin/curricula"], ["AD-CURR-06", `/api/admin/curricula/${ID}`],
    ["AD-PLAN-03…05", "/api/admin/plans"], ["AD-PLAN-06…09, 13", `/api/admin/plans/${ID}`],
    ["AD-GRAD-03…05", "/api/admin/graduation"], ["AD-GRAD-06, 07, 12", `/api/admin/graduation/${ID}`],
    ["AD-FIELD-01…03", "/api/admin/careers/fields"], ["AD-SKILL-01…03", "/api/admin/careers/skills"],
    ["AD-CAREER-01, 06, 07", "/api/admin/careers"], ["AD-CAREER-02", `/api/admin/careers/${ID}`],
    ["AD-REQ-07, 09, 10", "/api/admin/careers/requirements"], ["AD-REQ-07", `/api/admin/careers/requirements/${ID}`],
    ["AD-REQ-10", "/api/admin/careers/requirements/skills"], ["AD-REQ-08", "/api/admin/careers/requirements/course-weights"],
    ["AD-COMP-01…04", "/api/admin/competencies/groups"], ["AD-COMP-02", `/api/admin/competencies/groups/${ID}`],
    ["AD-CMP-01…04", "/api/admin/competencies/skills"], ["AD-CMP-02", `/api/admin/competencies/skills/${ID}`],
    ["AD-CRS-01…04", "/api/admin/competencies/courses"], ["AD-CRS-02", `/api/admin/competencies/courses/${ID}`],
    ["AD-CRS-04", "/api/admin/competencies/cohorts"], ["AD-CRS-01", "/api/admin/competencies/summary"],
  ])("reads %s (%s)", async (_code, path) => {
    await request(admin(advisor)).get(path).expect(200);
  });

  it.each([
    ["the source workbook of a programme", `/api/admin/curricula/${ID}/source/${REVISION}`],
    ["the source workbook of a plan (AD-PLAN-14)", `/api/admin/plans/${ID}/source/${REVISION}`],
    ["the source workbook of a standard", `/api/admin/graduation/${ID}/source/${REVISION}`],
    ["the advisor import template (AD-ADV-01)", "/api/admin/advisors/import/template"],
    ["the AI state of the course links (AD-CRS-06, 09)", "/api/admin/competencies/ai/status"],
    ["the latest AI run of the courses (AD-CRS-09, 10)", "/api/admin/competencies/ai/batches/latest"],
    ["an AI proposal of a course (AD-CRS-06)", `/api/admin/competencies/ai/latest?courseId=${ID}&mode=links`],
    ["one AI proposal of a course", `/api/admin/competencies/ai/${ID}`],
    ["the skill editor's catalog (AD-CMP-05, 06)", "/api/admin/competencies/catalog"],
    ["the AI state of the career links (AD-REQ-04)", "/api/admin/careers/requirements/ai-suggestions/status"],
    ["an AI proposal of a career (AD-REQ-04)", `/api/admin/careers/requirements/ai-suggestions/latest?careerPositionId=${ID}`],
    ["the AI proposals, whatever the case or a trailing slash", "/api/admin/Careers/Requirements/AI-Suggestions/"],
    ["a source workbook, whatever the case", `/api/admin/PLANS/${ID}/Source/${REVISION}`],
    ["an admin route it does not know", "/api/admin/something-new"],
  ])("does not read %s", async (_what, path) => {
    expect((await request(admin(advisor)).get(path).expect(403)).body).toEqual({ error: "admin_only" });
  });

  it("reads its pages with or without a trailing slash and in any case, as Express routes them", async () => {
    const app = admin(advisor);
    await request(app).get("/api/admin/curricula/").expect(200);
    await request(app).get(`/api/admin/Plans/${ID}`).expect(200);
    await request(app).head("/api/admin/careers/skills").expect(200);
  });

  it("changes nothing: every other write answers read only", async () => {
    const app = admin(advisor);
    for (const [method, path] of [["post", "/api/admin/curricula/preview"], ["patch", `/api/admin/plans/${ID}/status`], ["put", `/api/admin/competencies/courses/${ID}`],
      ["post", "/api/admin/careers/fields"], ["delete", `/api/admin/careers/requirements/${ID}`], ["post", "/api/admin/competencies/ai/batches"],
      ["post", "/api/admin/careers/requirements/ai-suggestions"], ["post", "/api/admin/advisors/import/preview"], ["patch", `/api/admin/accounts/${ID}`],
      ["post", "/api/admin/announcements"], ["post", `/api/admin/advisor-portal/students/${STUDENT_ID}/open/again`]] as const) {
      expect((await request(app)[method](path).send({}).expect(403)).body).toEqual({ error: "read_only_role" });
    }
  });

  it("opens a student's page, the one write it has", async () => {
    await request(admin(advisor)).post(`/api/admin/advisor-portal/students/${STUDENT_ID}/open`).expect(200);
  });

  it("leaves the other roles alone", async () => {
    for (const role of ["admin", "faculty_board", "department_head", "lecturer"] as const) {
      const app = admin({ ...advisor, role });
      await request(app).post("/api/admin/careers").send({}).expect(200);
      await request(app).get("/api/admin/reports/overview").expect(200);
      await request(app).get(`/api/admin/plans/${ID}/source/${REVISION}`).expect(200);
      await request(app).get("/api/admin/competencies/ai/batches/latest").expect(200);
      await request(app).get("/api/admin/careers/requirements/ai-suggestions/status").expect(200);
      await request(app).get("/api/admin/advisors/import/template").expect(200);
    }
  });
});
