import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { createStudentDataRouter } from "./router.js";
import type { AssessmentRunner } from "../competency-assessment/router.js";
import { AssessmentError } from "../competency-assessment/inputs.js";
import type { AdvisorActing } from "../advisors/access.js";

const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const careerId = "33333333-3333-4333-8333-333333333333";
const otherCareerId = "44444444-4444-4444-8444-444444444444";
const origin = "https://edupath.example";
const student = {
  userId: studentId,
  identityKey: `${tenantId}:${studentId}`,
  tenantId,
  objectId: studentId,
  name: "Student User",
  email: "student@example.edu",
  username: "student@example.edu",
  role: "student",
  signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;

type SetupOptions = {
  careerRow?: { deleted_at: string | null } | null;
  previousCareer?: string | null;
  /** The re-assessment after a new target (2026-11-14): the runner, whether a result is stored, the consent, the cooldown. */
  reassess?: AssessmentRunner;
  stored?: boolean;
  consent?: string | null;
  withdrawn?: boolean;
  recent?: boolean;
  acting?: AdvisorActing;
};

function setup(options: SetupOptions = {}) {
  const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: studentId }] };
    if (sql.includes("SELECT deleted_at FROM career_positions")) {
      return options.careerRow === null
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [options.careerRow ?? { deleted_at: null }] };
    }
    if (sql.includes("SELECT career_position_id FROM student_profiles")) {
      return { rowCount: 1, rows: [{ career_position_id: options.previousCareer ?? null }] };
    }
    return { rowCount: 1, rows: [] };
  });
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
  // The pool's own reads: the re-assessment's checks, and the log row and the notification of acting staff.
  const poolQuery = vi.fn(async (sql: string) => {
    if (sql.includes("AS recent")) return { rowCount: 1, rows: [{ recent: options.recent === true }] };
    if (sql.includes("SELECT 1 FROM stu_comp_assessments")) return { rowCount: options.stored ? 1 : 0, rows: options.stored ? [{}] : [] };
    if (sql.includes("AS withdrawn")) return { rowCount: 1, rows: [{ withdrawn: options.withdrawn === true }] };
    if (sql.includes("SELECT policy_version FROM data_consents")) return { rowCount: options.consent ? 1 : 0, rows: options.consent ? [{ policy_version: options.consent }] : [] };
    return { rowCount: 1, rows: [] };
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: options.acting?.advisor ?? student } as typeof req.session;
    if (options.acting) req.advisorActing = options.acting;
    next();
  });
  app.use("/student", createStudentDataRouter({ connect, query: poolQuery } as unknown as DatabasePool, origin, false,
    options.reassess ? { reassess: options.reassess } : {}));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, clientQuery, connect, poolQuery };
}

const profile = {
  className: "CNTT08",
  interests: "AI và dữ liệu",
  careerGoal: "Tôi muốn xây dựng sản phẩm dữ liệu hữu ích.",
  currentSemester: 2,
};

describe("student career selection", () => {
  it("saves an immediate career-only selection without replacing stored interests", async () => {
    const { app, clientQuery } = setup({ previousCareer: null });
    await request(app)
      .patch("/student/profile")
      .set("Origin", origin)
      .send({ careerPositionId: careerId })
      .expect(200, { saved: true, reassessed: false });

    const insertCall = clientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO student_profiles"));
    expect(insertCall?.[0]).toContain("interests=student_profiles.interests");
    expect(insertCall?.[1]).toEqual([studentId, null, null, null, null]);
    expect(clientQuery).toHaveBeenCalledWith(
      "UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1",
      [studentId, careerId],
    );
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(clientQuery).not.toHaveBeenCalledWith("ROLLBACK");
  });

  it("saves a catalog selection while preserving stored class and free-text goal", async () => {
    const { app, clientQuery } = setup({ previousCareer: null });
    await request(app)
      .patch("/student/profile")
      .set("Origin", origin)
      .send({ ...profile, careerPositionId: careerId })
      .expect(200, { saved: true, reassessed: false });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO student_profiles"),
      [studentId, null, profile.interests, null, profile.currentSemester],
    );
    const insertSql = clientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO student_profiles"))?.[0] as string;
    expect(insertSql).toContain("interests=EXCLUDED.interests");
    expect(insertSql).not.toContain("class_name=EXCLUDED");
    expect(insertSql).not.toContain("career_goal=EXCLUDED");
    expect(clientQuery).toHaveBeenCalledWith(
      "UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1",
      [studentId, careerId],
    );
  });

  it("rejects missing or newly deleted positions and rolls back the transaction", async () => {
    for (const options of [{ careerRow: null }, { careerRow: { deleted_at: "2026-09-22T00:00:00Z" }, previousCareer: otherCareerId }]) {
      const { app, clientQuery } = setup(options);
      await request(app)
        .patch("/student/profile")
        .set("Origin", origin)
        .send({ careerPositionId: careerId })
        .expect(409, { error: "career_unavailable" });
      const insertCall = clientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO student_profiles"));
      expect(insertCall?.[0]).toContain("interests=student_profiles.interests");
      expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
      expect(clientQuery).not.toHaveBeenCalledWith("COMMIT");
      expect(clientQuery).not.toHaveBeenCalledWith(
        "UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1",
        [studentId, careerId],
      );
    }
  });

  it("rejects a malformed career ID before opening a transaction", async () => {
    const { app, connect } = setup();
    await request(app)
      .patch("/student/profile")
      .set("Origin", origin)
      .send({ careerPositionId: "not-a-uuid" })
      .expect(400, { error: "invalid_profile" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("allows the previously selected deleted position and clears a selection explicitly", async () => {
    const retained = setup({ careerRow: { deleted_at: "2026-09-22T00:00:00Z" }, previousCareer: careerId });
    await request(retained.app)
      .patch("/student/profile")
      .set("Origin", origin)
      .send({ ...profile, careerPositionId: careerId })
      .expect(200);
    const cleared = setup({ previousCareer: careerId });
    await request(cleared.app)
      .patch("/student/profile")
      .set("Origin", origin)
      .send({ ...profile, careerPositionId: null })
      .expect(200);
    expect(cleared.clientQuery).toHaveBeenCalledWith(
      "UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1",
      [studentId, null],
    );
  });
});

describe("a new target career re-assesses (2026-11-14, plan \"Một bước để bắt đầu\")", () => {
  const runner = () => vi.fn(async () => null) as unknown as AssessmentRunner & ReturnType<typeof vi.fn>;
  const send = (app: express.Express, body: object) => request(app).patch("/student/profile").set("Origin", origin).send(body);

  it("stores a new assessment for a student who has a result and an active consent, after the profile is saved", async () => {
    const reassess = runner();
    const { app, clientQuery } = setup({ previousCareer: otherCareerId, reassess, stored: true, consent: "2026-11-10" });
    await send(app, { careerPositionId: careerId }).expect(200, { saved: true, reassessed: true });
    expect(reassess).toHaveBeenCalledTimes(1);
    expect(reassess).toHaveBeenCalledWith(expect.objectContaining({ userId: studentId }), { acting: false });
    // The profile was committed first: the new assessment reads the new target.
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
  });

  it("does not re-assess without a stored result, without a consent that counts, within the cooldown or when the run fails", async () => {
    for (const options of [{ stored: false, consent: "2026-11-10" }, { stored: true, consent: null }, { stored: true, consent: "2026-10-24" },
      { stored: true, consent: "2026-11-10", recent: true }]) {
      const reassess = runner();
      await send(setup({ previousCareer: null, reassess, ...options }).app, { careerPositionId: careerId }).expect(200, { saved: true, reassessed: false });
      expect(reassess).not.toHaveBeenCalled();
    }
    const failing = vi.fn(async () => { throw new AssessmentError("curriculum_unavailable", 409); }) as unknown as AssessmentRunner;
    await send(setup({ previousCareer: null, reassess: failing, stored: true, consent: "2026-11-10" }).app, { careerPositionId: careerId })
      .expect(200, { saved: true, reassessed: false });
  });

  it("never re-assesses for the same target, a cleared one or a specialty change", async () => {
    for (const [options, body] of [
      [{ previousCareer: careerId }, { careerPositionId: careerId }],
      [{ previousCareer: careerId }, { careerPositionId: null }],
      [{ previousCareer: null }, { specialty: null }],
    ] as const) {
      const reassess = runner();
      await send(setup({ ...options, reassess, stored: true, consent: "2026-11-10" }).app, body).expect(200, { saved: true, reassessed: false });
      expect(reassess).not.toHaveBeenCalled();
    }
  });

  it("re-assesses for a cố vấn học tập without the student's consent unless withdrawn, logged and told like their Đánh giá năng lực", async () => {
    const advisor = { ...student, userId: "55555555-5555-4555-8555-555555555555", name: "Cố vấn", role: "advisor" } satisfies AuthenticatedUser;
    const acting: AdvisorActing = { advisor, student: { user: student, studentCode: "2374802019999", name: "Sinh viên", className: "71K29CNTT99",
      actorKind: "advisor", actorName: "Cố vấn Thử", advisorName: "Cố vấn Thử" } };
    const reassess = runner();
    const { app, poolQuery } = setup({ previousCareer: null, reassess, stored: true, consent: null, acting });
    await send(app, { careerPositionId: careerId }).expect(200, { saved: true, reassessed: true });
    expect(reassess).toHaveBeenCalledWith(expect.objectContaining({ userId: studentId }), { acting: true });
    await vi.waitFor(() => expect(poolQuery.mock.calls.some(([sql, params]) => String(sql).includes("INSERT INTO ad_audit_log")
      && (params as unknown[]).includes("Đánh giá năng lực thay sinh viên"))).toBe(true));
    const withdrawn = runner();
    await send(setup({ previousCareer: null, reassess: withdrawn, stored: true, consent: null, withdrawn: true, acting }).app, { careerPositionId: careerId })
      .expect(200, { saved: true, reassessed: false });
    expect(withdrawn).not.toHaveBeenCalled();
  });
});
