import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { TRANSCRIPT_POLICY_VERSION } from "./consent.js";
import { createStudentDataRouter } from "./router.js";
import { ACHIEVEMENTS_MAX, parseSurveyInput, SURVEY_QUESTIONS, surveyFacts } from "./survey.js";

// Invented answers only.
const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const origin = "https://edupath.example";
const student = {
  userId: studentId, identityKey: `${tenantId}:${studentId}`, tenantId, objectId: studentId, name: "Student User",
  email: "student@example.edu", username: "student@example.edu", role: "student", signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;

const answers = { goal: "study", environment: "both", company: "large", partTime: "no", leadership: "few", projects: "many",
  internship: "done", selfStudy: "high", english: "working", field: "data" };
const savedRow = (extra: Record<string, unknown> = {}) => ({ version: "survey-v1", answers, has_achievements: false, achievements: null,
  updated_at: new Date("2026-10-24T10:00:00Z"), ...extra });

function setup(options: { consent?: string | null; survey?: boolean } = {}) {
  const consentRows = options.consent ? [{ policy_version: options.consent }] : [];
  const read = async (sql: string) => {
    if (sql.includes("FROM stu_profile_surveys WHERE user_id=$1")) return { rowCount: options.survey ? 1 : 0, rows: options.survey ? [savedRow()] : [] };
    if (sql.includes("FROM data_consents")) return { rowCount: consentRows.length, rows: consentRows };
    return null;
  };
  const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: studentId }] };
    if (sql.startsWith("INSERT INTO stu_profile_surveys")) {
      return { rowCount: 1, rows: [savedRow({ answers: JSON.parse(String(params?.[2])), has_achievements: params?.[3], achievements: params?.[4] })] };
    }
    if (sql.startsWith("DELETE FROM stu_profile_surveys")) return { rowCount: options.survey ? 1 : 0, rows: [] };
    return (await read(sql)) ?? { rowCount: 1, rows: [] };
  });
  const poolQuery = vi.fn(async (sql: string) => (await read(sql)) ?? { rowCount: 0, rows: [] });
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
  const pool = { connect, query: poolQuery } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: student } as typeof req.session; next(); });
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
  it("needs one listed answer per question and Có or Không for achievements, with the list after Có", () => {
    expect(parseSurveyInput({ answers, hasAchievements: false })).toEqual({ value: { answers, hasAchievements: false, achievements: null } });
    expect(parseSurveyInput({ answers, hasAchievements: false, achievements: "ignored" })).toEqual({ value: { answers, hasAchievements: false, achievements: null } });
    const { goal: _goal, ...missing } = answers;
    for (const body of [{ answers: missing, hasAchievements: false }, { answers: { ...answers, goal: "travel" }, hasAchievements: false },
      { answers: { ...answers, extra: "x" }, hasAchievements: false }, { answers }, { answers, hasAchievements: "yes" }]) {
      expect(parseSurveyInput(body)).toEqual({ error: "invalid_survey" });
    }
    expect(parseSurveyInput({ answers, hasAchievements: true, achievements: " \n  \n" })).toEqual({ error: "achievements_required" });
    expect(parseSurveyInput({ answers, hasAchievements: true, achievements: "x".repeat(ACHIEVEMENTS_MAX + 1) })).toEqual({ error: "achievements_too_long" });
    expect(parseSurveyInput({ answers, hasAchievements: true, achievements: "  Giải Nhì Hackathon khoa \r\n\r\n\u0007Học bổng HK1  " }))
      .toEqual({ value: { answers, hasAchievements: true, achievements: "Giải Nhì Hackathon khoa\nHọc bổng HK1" } });
  });

  it("gives the AI each question with the label of its answer", () => {
    expect(SURVEY_QUESTIONS).toHaveLength(10);
    const facts = surveyFacts({ answers, hasAchievements: true, achievements: "Giải Nhì Hackathon khoa" });
    expect(facts.answers[0]).toEqual({ question: "Mục tiêu sau tốt nghiệp", answer: "Học lên cao (thạc sĩ, nghiên cứu)" });
    expect(facts.answers.at(-1)).toEqual({ question: "Lĩnh vực quan tâm nhất", answer: "AI, dữ liệu" });
    expect(facts.achievements).toBe("Giải Nhì Hackathon khoa");
    expect(surveyFacts({ answers, hasAchievements: false, achievements: null }).achievements).toBeNull();
  });
});

describe("/student/survey", () => {
  it("sends the questions, the stored answers and the policy version agreed to", async () => {
    const empty = await request(setup().app).get("/student/survey").expect(200);
    expect(empty.body).toMatchObject({ achievementsMax: ACHIEVEMENTS_MAX, survey: null, consentVersion: null });
    expect(empty.body.questions).toHaveLength(10);
    const saved = await request(setup({ survey: true, consent: TRANSCRIPT_POLICY_VERSION }).app).get("/student/survey").expect(200);
    expect(saved.body).toMatchObject({ survey: { version: "survey-v1", answers, hasAchievements: false, complete: true }, consentVersion: TRANSCRIPT_POLICY_VERSION });
  });

  it("saves only with consent to the current policy, given now or still active", async () => {
    const body = { answers, hasAchievements: true, achievements: "Giải Nhì Hackathon khoa" };
    const none = setup();
    await put(none.app, body).expect(400, { error: "consent_required" });
    expect(none.sql()).not.toContain("COMMIT");
    await put(setup().app, body, "2000-01-01").expect(409, { error: "policy_outdated" });
    await put(setup().app, { answers }, TRANSCRIPT_POLICY_VERSION).expect(400, { error: "invalid_survey" });

    const agreed = setup();
    const response = await put(agreed.app, body, TRANSCRIPT_POLICY_VERSION).expect(200);
    expect(response.body).toMatchObject({ survey: { answers, hasAchievements: true, achievements: "Giải Nhì Hackathon khoa", complete: true }, consentVersion: TRANSCRIPT_POLICY_VERSION });
    const granted = agreed.clientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO data_consents"));
    expect(granted?.[1]).toEqual([expect.any(String), studentId, TRANSCRIPT_POLICY_VERSION, "profile_survey"]);
    expect(agreed.sql().at(-1)).toBe("COMMIT");

    // An edit under an active consent to the same policy needs no new one.
    const again = setup({ survey: true, consent: TRANSCRIPT_POLICY_VERSION });
    await put(again.app, body).expect(200);
    expect(again.sql().some((sql) => sql.includes("INSERT INTO data_consents"))).toBe(false);
    // An older consent does not cover the new policy.
    await put(setup({ survey: true, consent: "2026-10-11" }).app, body).expect(400, { error: "consent_required" });
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
