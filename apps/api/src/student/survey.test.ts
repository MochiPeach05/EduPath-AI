import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { TRANSCRIPT_POLICY_VERSION } from "./consent.js";
import { createStudentDataRouter } from "./router.js";
import { ACHIEVEMENTS_MAX, parseSurveyInput, SURVEY_QUESTIONS, surveyFacts, surveyUsable, type StudentSurvey } from "./survey.js";
import { SURVEY_COMPLETE_SQL } from "../admin/student-profiles.js";

// Invented answers only.
const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const origin = "https://edupath.example";
const student = {
  userId: studentId, identityKey: `${tenantId}:${studentId}`, tenantId, objectId: studentId, name: "Student User",
  email: "student@example.edu", username: "student@example.edu", role: "student", signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;
/** A cố vấn học tập or a Khoa admin working in the student's page (advisors/access.ts sets advisorActing). */
const staffId = "88888888-8888-4888-8888-888888888888";
const staff = { ...student, userId: staffId, name: "Cố vấn", email: "co.van@vlu.edu.vn", role: "advisor" } satisfies AuthenticatedUser;

const answers = { goal: "study", environment: "both", company: "large", partTime: "no", leadership: "few", projects: "many",
  internship: "done", selfStudy: "high", english: "working", field: "data" };
const interests = { interestTech: ["ai_ml", "python_data"], interestHobbies: ["reading"] };
// survey-v3 rows still count (only the written description of the strengths is gone, survey-v4).
const savedRow = (extra: Record<string, unknown> = {}) => ({ version: "survey-v3", answers, interest_tech: interests.interestTech,
  interest_hobbies: interests.interestHobbies, has_achievements: false, achievements: null, updated_at: new Date("2026-10-24T10:00:00Z"), ...extra });

/** acting: the survey is saved by a cố vấn học tập ("advisor") or the Khoa ("admin"); withdrawn: the student withdrew the consent. */
function setup(options: { consent?: string | null; survey?: boolean; row?: Record<string, unknown>; previous?: Record<string, unknown>;
  acting?: "advisor" | "admin"; withdrawn?: boolean } = {}) {
  const consentRows = options.consent ? [{ policy_version: options.consent }] : [];
  const read = async (sql: string) => {
    if (sql.includes("FROM stu_profile_surveys WHERE user_id=$1")) return { rowCount: options.survey ? 1 : 0, rows: options.survey ? [savedRow(options.row)] : [] };
    if (sql.includes("AS withdrawn")) return { rowCount: 1, rows: [{ withdrawn: options.withdrawn === true }] };
    if (sql.includes("FROM data_consents")) return { rowCount: consentRows.length, rows: consentRows };
    if (sql.includes("FROM student_profiles WHERE user_id=$1")) return { rowCount: options.previous ? 1 : 0, rows: options.previous ? [options.previous] : [] };
    return null;
  };
  const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: studentId }] };
    if (sql.startsWith("INSERT INTO stu_profile_surveys")) {
      return { rowCount: 1, rows: [savedRow({ answers: JSON.parse(String(params?.[2])), interest_tech: params?.[3], interest_hobbies: params?.[4],
        has_achievements: params?.[5], achievements: params?.[6], saved_by_role: params?.[9] })] };
    }
    if (sql.startsWith("DELETE FROM stu_profile_surveys")) return { rowCount: options.survey ? 1 : 0, rows: [] };
    return (await read(sql)) ?? { rowCount: 1, rows: [] };
  });
  const poolQuery = vi.fn(async (sql: string) => (await read(sql)) ?? { rowCount: 0, rows: [] });
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
  const pool = { connect, query: poolQuery } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: options.acting ? staff : student } as typeof req.session;
    if (options.acting) {
      req.advisorActing = { advisor: staff, student: { user: student, studentCode: null, name: "Student", className: "71K29CNTT99",
        actorKind: options.acting, actorName: "Cố vấn", advisorName: "Cố vấn" } };
    }
    next();
  });
  app.use("/student", createStudentDataRouter(pool, origin, true));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, clientQuery, connect, sql: () => clientQuery.mock.calls.map(([sql]) => String(sql)) };
}
const put = (app: express.Express, body: unknown, consent?: string) => {
  const call = request(app).put("/student/survey").set("Origin", origin);
  return (consent ? call.set("X-Consent-Policy-Version", consent) : call).send(body as object);
};

describe("survey answers", () => {
  it("needs one listed answer per question, 1 to 5 of each interest list and Có or Không for achievements, with the list after Có", () => {
    expect(parseSurveyInput({ answers, ...interests, hasAchievements: false })).toEqual({ value: { answers, ...interests, hasAchievements: false, achievements: null } });
    expect(parseSurveyInput({ answers, ...interests, hasAchievements: false, achievements: "ignored" })).toEqual({ value: { answers, ...interests, hasAchievements: false, achievements: null } });
    const { goal: _goal, ...missing } = answers;
    for (const body of [{ answers: missing, ...interests, hasAchievements: false }, { answers: { ...answers, goal: "travel" }, ...interests, hasAchievements: false },
      { answers: { ...answers, extra: "x" }, ...interests, hasAchievements: false }, { answers, ...interests }, { answers, ...interests, hasAchievements: "yes" },
      { answers, hasAchievements: false }, { answers, ...interests, interestTech: [], hasAchievements: false },
      { answers, ...interests, interestHobbies: ["reading", "reading"], hasAchievements: false },
      { answers, ...interests, interestTech: ["ai_ml", "game", "uiux", "testing", "security", "mobile"], hasAchievements: false },
      { answers, ...interests, interestTech: ["cooking"], hasAchievements: false }]) {
      expect(parseSurveyInput(body)).toEqual({ error: "invalid_survey" });
    }
    // A page loaded before survey-v4 may still send the description: accepted and dropped.
    expect(parseSurveyInput({ answers, ...interests, strengths: "Thành thạo React", hasAchievements: false }))
      .toEqual({ value: { answers, ...interests, hasAchievements: false, achievements: null } });
    // survey-v4: no written description of the strengths is needed any more.
    expect(parseSurveyInput({ answers, interestTech: ["ai_ml"], interestHobbies: ["reading"], hasAchievements: false }))
      .toEqual({ value: { answers, interestTech: ["ai_ml"], interestHobbies: ["reading"], hasAchievements: false, achievements: null } });
    expect(parseSurveyInput({ answers, ...interests, hasAchievements: true, achievements: " \n  \n" })).toEqual({ error: "achievements_required" });
    expect(parseSurveyInput({ answers, ...interests, hasAchievements: true, achievements: "x".repeat(ACHIEVEMENTS_MAX + 1) })).toEqual({ error: "achievements_too_long" });
    expect(parseSurveyInput({ answers, ...interests, hasAchievements: true, achievements: "  Giải Nhì Hackathon khoa \r\n\r\n\u0007Học bổng HK1  " }))
      .toEqual({ value: { answers, ...interests, hasAchievements: true, achievements: "Giải Nhì Hackathon khoa\nHọc bổng HK1" } });
  });

  it("gives the AI each question with the label of its answer, the interests by label and the achievements", () => {
    expect(SURVEY_QUESTIONS).toHaveLength(10);
    const facts = surveyFacts({ answers, ...interests, hasAchievements: true, achievements: "Giải Nhì Hackathon khoa" });
    expect(facts.answers[0]).toEqual({ question: "Mục tiêu sau tốt nghiệp", answer: "Học lên cao (thạc sĩ, nghiên cứu)" });
    expect(facts.answers.at(-1)).toEqual({ question: "Lĩnh vực quan tâm nhất", answer: "AI, dữ liệu" });
    expect(facts.tech).toEqual(["Python, phân tích dữ liệu", "Trí tuệ nhân tạo, học máy"]);
    expect(facts.hobbies).toEqual(["Đọc sách, tài liệu"]);
    expect(facts).not.toHaveProperty("strengths");
    expect(facts.achievements).toBe("Giải Nhì Hackathon khoa");
    expect(surveyFacts({ answers, ...interests, hasAchievements: false, achievements: null }).achievements).toBeNull();
  });
});

describe("/student/survey", () => {
  it("sends the questions, the interest lists, the stored answers, what the profile held before and the policy version agreed to", async () => {
    const empty = await request(setup({ previous: { tech: ["game"], hobbies: [], text: "Thích làm game" } }).app).get("/student/survey").expect(200);
    expect(empty.body).toMatchObject({ achievementsMax: ACHIEVEMENTS_MAX, survey: null, consentVersion: null, previous: { tech: ["game"], hobbies: [], text: "Thích làm game" } });
    expect(empty.body.questions).toHaveLength(10);
    expect([empty.body.interests.tech.length, empty.body.interests.hobbies.length, empty.body.interests.max]).toEqual([14, 12, 5]);
    const saved = await request(setup({ survey: true, consent: TRANSCRIPT_POLICY_VERSION }).app).get("/student/survey").expect(200);
    expect(saved.body).toMatchObject({ survey: { version: "survey-v3", answers, ...interests, hasAchievements: false, complete: true }, previous: null, consentVersion: TRANSCRIPT_POLICY_VERSION });
    expect(saved.body.survey).not.toHaveProperty("strengths");
    expect(saved.body).not.toHaveProperty("strengthsMax");
    // A survey saved before survey-v3 (its lists meant other things then) is incomplete.
    const v2 = await request(setup({ survey: true, row: { version: "survey-v2" } }).app).get("/student/survey").expect(200);
    expect(v2.body.survey).toMatchObject({ version: "survey-v2", complete: false });
    // A survey saved before the interests joined it is incomplete.
    const older = await request(setup({ survey: true, row: { version: "survey-v1", interest_tech: [], interest_hobbies: [] } }).app).get("/student/survey").expect(200);
    expect(older.body.survey).toMatchObject({ version: "survey-v1", complete: false });
  });

  it("saves only with consent to the current policy given now, or an active one that still counts", async () => {
    const body = { answers, ...interests, hasAchievements: true, achievements: "Giải Nhì Hackathon khoa" };
    const none = setup();
    await put(none.app, body).expect(400, { error: "consent_required" });
    expect(none.sql()).not.toContain("COMMIT");
    await put(setup().app, body, "2000-01-01").expect(409, { error: "policy_outdated" });
    await put(setup().app, { answers }, TRANSCRIPT_POLICY_VERSION).expect(400, { error: "invalid_survey" });

    const agreed = setup();
    const response = await put(agreed.app, body, TRANSCRIPT_POLICY_VERSION).expect(200);
    expect(response.body).toMatchObject({ survey: { answers, ...interests, hasAchievements: true, achievements: "Giải Nhì Hackathon khoa", complete: true }, consentVersion: TRANSCRIPT_POLICY_VERSION });
    // The interests the profile held before the move are cleared.
    expect(agreed.sql()).toContain("UPDATE student_profiles SET interest_tech='{}',interest_hobbies='{}',interests=NULL WHERE user_id=$1");
    const granted = agreed.clientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO data_consents"));
    expect(granted?.[1]).toEqual([expect.any(String), studentId, TRANSCRIPT_POLICY_VERSION, "profile_survey"]);
    expect(agreed.sql().at(-1)).toBe("COMMIT");

    // An edit under an active consent to the same policy needs no new one.
    const again = setup({ survey: true, consent: TRANSCRIPT_POLICY_VERSION });
    await put(again.app, body).expect(200);
    expect(again.sql().some((sql) => sql.includes("INSERT INTO data_consents"))).toBe(false);
    // An older consent does not cover the new policy.
    await put(setup({ survey: true, consent: "2026-10-24" }).app, body).expect(400, { error: "consent_required" });
    // A consent to 2026-10-25 still counts (CONSENT_VALID_SINCE): saved without asking again, the record kept.
    const kept = setup({ survey: true, consent: "2026-10-25" });
    expect((await put(kept.app, body).expect(200)).body.consentVersion).toBe("2026-10-25");
    expect(kept.sql().some((sql) => sql.includes("INSERT INTO data_consents"))).toBe(false);
  });

  it("deletes the answers with every AI roadmap and withdraws the consent", async () => {
    await request(setup().app).delete("/student/survey").set("Origin", origin).send({}).expect(400, { error: "invalid_input" });
    const { app, clientQuery, sql } = setup({ survey: true });
    await request(app).delete("/student/survey").set("Origin", origin).send({ confirmed: true }).expect(200, { deleted: true });
    expect(sql()).toEqual(expect.arrayContaining(["DELETE FROM stu_profile_surveys WHERE user_id=$1", "DELETE FROM stu_roadmaps WHERE user_id=$1"]));
    const withdrawn = clientQuery.mock.calls.find(([text]) => String(text).includes("end_reason='withdrawn'"));
    expect(withdrawn?.[1]).toEqual([studentId, "profile_survey"]);
    expect(sql().at(-1)).toBe("COMMIT");
  });

  it("refuses writes from another origin", async () => {
    await request(setup().app).put("/student/survey").set("Origin", "https://evil.example").send({}).expect(403, { error: "invalid_origin" });
  });
});

describe("Khảo sát định hướng filled in by a cố vấn học tập or the Khoa (policy 2026-11-10)", () => {
  const body = { answers, ...interests, hasAchievements: false };
  const surveyInsert = (query: ReturnType<typeof setup>["clientQuery"]) =>
    query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO stu_profile_surveys"))?.[1];

  it("saves without the student's consent, records none even when a consent header comes, and keeps who saved it", async () => {
    const acting = setup({ acting: "advisor" });
    const response = await put(acting.app, body, TRANSCRIPT_POLICY_VERSION).expect(200);
    expect(response.body).toMatchObject({ survey: { answers, ...interests, complete: true, savedBy: "advisor" }, consentVersion: null });
    expect(acting.sql().some((sql) => sql.includes("data_consents") && /INSERT|UPDATE/.test(sql))).toBe(false);
    expect(surveyInsert(acting.clientQuery)?.slice(8)).toEqual([staffId, "advisor"]);
    expect(acting.sql().at(-1)).toBe("COMMIT");
    // The Khoa over an older consent of the student: saved, the consent left as it was.
    const admin = setup({ acting: "admin", survey: true, consent: "2026-10-24" });
    expect((await put(admin.app, body).expect(200)).body).toMatchObject({ survey: { savedBy: "admin" }, consentVersion: "2026-10-24" });
    expect(admin.sql().some((sql) => sql.includes("data_consents") && /INSERT|UPDATE/.test(sql))).toBe(false);
  });

  it("refuses once the student withdrew the consent (Xóa câu trả lời), writing nothing", async () => {
    const refused = setup({ acting: "advisor", withdrawn: true });
    await put(refused.app, body).expect(409, { error: "survey_withdrawn" });
    expect(surveyInsert(refused.clientQuery)).toBeUndefined();
    expect(refused.sql().at(-1)).toBe("ROLLBACK");
  });

  it("becomes the student's own when the student saves it, under the consent as before", async () => {
    await put(setup({ survey: true, row: { saved_by_role: "advisor" } }).app, body).expect(400, { error: "consent_required" });
    const own = setup({ survey: true, row: { saved_by_role: "advisor" } });
    const response = await put(own.app, body, TRANSCRIPT_POLICY_VERSION).expect(200);
    expect(response.body).toMatchObject({ survey: { savedBy: null }, consentVersion: TRANSCRIPT_POLICY_VERSION });
    expect(surveyInsert(own.clientQuery)?.slice(8)).toEqual([null, null]);
    expect(own.sql().some((sql) => sql.includes("INSERT INTO data_consents"))).toBe(true);
  });

  it("sends who saved the survey with it, and whether the student withdrew the consent", async () => {
    expect((await request(setup({ survey: true, row: { saved_by_role: "admin" } }).app).get("/student/survey").expect(200)).body)
      .toMatchObject({ survey: { savedBy: "admin" }, withdrawn: false });
    expect((await request(setup({ survey: true, consent: TRANSCRIPT_POLICY_VERSION }).app).get("/student/survey").expect(200)).body.survey.savedBy).toBeNull();
    expect((await request(setup({ withdrawn: true }).app).get("/student/survey").expect(200)).body).toMatchObject({ survey: null, withdrawn: true });
  });
});

describe("when the AI features may use the survey (surveyUsable)", () => {
  const own: StudentSurvey = { version: "survey-v4", answers, ...interests, hasAchievements: false, achievements: null, updatedAt: "2026-11-10T03:00:00.000Z",
    complete: true, savedBy: null };
  const filled: StudentSurvey = { ...own, savedBy: "advisor" };
  const db = (consent: string | null, withdrawn = false) => ({
    query: vi.fn(async (sql: string) => (sql.includes("AS withdrawn") ? { rows: [{ withdrawn }] } : { rows: consent ? [{ policy_version: consent }] : [] })),
  }) as unknown as DatabasePool;

  it("needs the student's consent for their own answers, and none for answers a cố vấn học tập or the Khoa filled in until the student withdraws it", async () => {
    expect(await surveyUsable(db(TRANSCRIPT_POLICY_VERSION), studentId, own)).toBe(true);
    expect(await surveyUsable(db(null), studentId, own)).toBe(false);
    expect(await surveyUsable(db("2026-10-24"), studentId, own)).toBe(false);
    expect(await surveyUsable(db(null), studentId, filled)).toBe(true);
    expect(await surveyUsable(db("2026-10-24"), studentId, { ...filled, savedBy: "admin" })).toBe(true);
    expect(await surveyUsable(db(null, true), studentId, filled)).toBe(false);
    expect(await surveyUsable(db(TRANSCRIPT_POLICY_VERSION), studentId, { ...filled, complete: false })).toBe(false);
    expect(await surveyUsable(db(TRANSCRIPT_POLICY_VERSION), studentId, null)).toBe(false);
  });

  it("is the rule the profile steps and the Tổng quan gate read in SQL (SURVEY_COMPLETE_SQL)", () => {
    expect(SURVEY_COMPLETE_SQL).toContain("s.saved_by_role IS NOT NULL");
    expect(SURVEY_COMPLETE_SQL).toContain("c.end_reason = 'withdrawn'");
    expect(SURVEY_COMPLETE_SQL).toContain("c.policy_version >= '2026-10-25'");
  });
});
