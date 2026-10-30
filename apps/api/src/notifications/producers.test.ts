import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";

// The jobs that tell the student through the bell when they end (STU-PROG-04): the OCR transcript import, the AI roadmap
// and the graduation advice. The AI output checks are stubbed; only the notification is under test. Synthetic ids only.
vi.mock("../roadmap/validate.js", async (original) => ({
  ...await original<typeof import("../roadmap/validate.js")>(),
  roadmapContextFromAiInput: vi.fn(() => ({})),
  validateRoadmapOutput: vi.fn(() => ({ ok: true, output: { advice: [], study: [], improve: [], skills: [], months: [] } })),
}));
vi.mock("../graduation/advice/validate.js", async (original) => ({
  ...await original<typeof import("../graduation/advice/validate.js")>(),
  graduationAdviceContextFromAiInput: vi.fn(() => ({})),
  validateGraduationAdviceOutput: vi.fn(() => ({ ok: true, output: { summary: "Tóm tắt" } })),
}));
vi.mock("../competency-assessment/ai/validate.js", async (original) => ({
  ...await original<typeof import("../competency-assessment/ai/validate.js")>(),
  validationContextFromAiInput: vi.fn(() => ({})),
  validateAiOutput: vi.fn(() => ({ ok: true, output: { summary: "Tóm tắt", groupInsights: [], strengths: [], improvements: [], careerFit: { comment: "" }, gaps: [], progress: "", nextSteps: [] } })),
}));
const { createCompetencyWorkerRouter } = await import("../competency-assessment/ai/worker-router.js");
const { completeRoadmap } = await import("../roadmap/jobs.js");
const { completeGraduationAdvice } = await import("../graduation/advice/jobs.js");
const { createTranscriptWorkerRouter, expireJobs } = await import("../student/transcript-jobs.js");

const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "44444444-4444-4444-8444-444444444444";
const LEASE = "55555555-5555-4555-8555-555555555555";
const version = "33333333-3333-4333-8333-333333333333";
const pdf = Buffer.from("%PDF-1.7\n%test\n");
const success = { leaseToken: LEASE, model: "gemma4:e4b", digest: "d", ollamaVersion: "0.40.2", metrics: {}, output: {} };

type Call = readonly [string, unknown[]];
const notificationOf = (calls: readonly Call[]) => {
  const insert = calls.find(([sql]) => sql.startsWith("INSERT INTO stu_notifications"));
  return insert ? { user: insert[1][1], type: insert[1][2], kind: insert[1][3], title: insert[1][4], body: insert[1][5], link: insert[1][6], key: insert[1][8] } : null;
};

function client(rows: (sql: string) => unknown[] | undefined) {
  const query = vi.fn(async (sql: string) => {
    const found = rows(sql);
    return { rowCount: found?.length ?? 1, rows: found ?? [] };
  });
  return { query, calls: () => query.mock.calls.map(([sql, params]) => [String(sql), (params ?? []) as unknown[]] as const) };
}

afterEach(() => vi.clearAllMocks());

describe("transcript import (OCR)", () => {
  async function complete(body: Record<string, unknown>) {
    const db = client((sql) => (sql.startsWith("SELECT user_id FROM transcript_jobs") ? [{ user_id: USER }]
      : sql.startsWith("SELECT is_active") ? [{ is_active: true }]
      : sql.startsWith("SELECT *,lease_until") ? [{ status: "processing", lease_token: LEASE, valid: true, filename: "bang-diem.pdf", pdf_data: pdf, expected_version: version }]
      : sql.startsWith("SELECT version FROM student_transcripts") ? [{ version }] : undefined));
    const pool = { connect: vi.fn().mockResolvedValue({ query: db.query, release: vi.fn() }), query: vi.fn() } as unknown as DatabasePool;
    const app = express();
    app.use("/worker", createTranscriptWorkerRouter(pool, "k".repeat(40)));
    await request(app).post(`/worker/${JOB}/complete`).set("Authorization", `Bearer ${"k".repeat(40)}`).send(body).expect(200, { ok: true });
    return db.calls();
  }

  it("tells the student the transcript was read, in the import's transaction", async () => {
    const result = {
      schema_version: "1.1", adapter: "vlu_8_columns", course_count: 1, needs_review: false, pages: [{ page: 1, method: "ppocr", warnings: [] }],
      courses: [{ ordinal: 1, course_code: "71ITBS10103", course_name: "Nhập môn Công nghệ thông tin", credits: 3, score_10: 8, score_4: 3.5, letter_grade: "B+",
        result: "passed", source_page: 1, academic_year: "2023-2024", semester: "HK01", section: "semester", needs_review: false, issues: [] }],
      summaries: [], semesters: [], unparsed_rows: [],
    };
    const calls = await complete({ leaseToken: LEASE, result });
    expect(notificationOf(calls)).toMatchObject({ user: USER, type: "ai", kind: "transcript_ready", title: "Bảng điểm đã đọc xong", link: "#profile", key: `transcript:${JOB}` });
    expect(notificationOf(calls)!.body).toContain("đọc xong 1 học phần trong 1 học kỳ");
    const order = calls.map(([sql]) => sql);
    expect(order.indexOf("SAVEPOINT edupath_notify")).toBeGreaterThan(order.findIndex((sql) => sql.startsWith("UPDATE transcript_jobs SET status=$2")));
    expect(order.at(-1)).toBe("COMMIT");
  });

  it("tells the student why a transcript could not be read", async () => {
    const calls = await complete({ leaseToken: LEASE, error: "encrypted_pdf" });
    expect(notificationOf(calls)).toMatchObject({ kind: "transcript_failed", title: "Chưa đọc được bảng điểm", key: `transcript:${JOB}` });
    expect(notificationOf(calls)!.body).toContain("PDF đang khóa bằng mật khẩu.");
  });

  it("tells each student whose import timed out", async () => {
    const query = vi.fn(async (sql: string) => (sql.startsWith("UPDATE transcript_jobs SET status='failed'")
      ? { rowCount: 1, rows: [{ id: JOB, user_id: USER }] } : { rowCount: 1, rows: [] }));
    await expireJobs({ query } as unknown as DatabasePool);
    const insert = query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO stu_notifications"));
    expect(insert?.[1]).toEqual(expect.arrayContaining([USER, "transcript_failed", `transcript:${JOB}`]));
  });
});

describe("competency comment", () => {
  it("tells the student the AI comment of an assessment is ready, in the completion's transaction", async () => {
    const ASSESSMENT = "22222222-2222-4222-8222-222222222222";
    const db = client((sql) => (sql.includes("FROM stu_comp_ai_jobs WHERE id=$1 FOR UPDATE")
      ? [{ status: "processing", lease_token: LEASE, valid: true, assessment_id: ASSESSMENT, user_id: USER, ai_input: { schema: {}, user: "", promptVersion: "comp-v12" } }]
      : undefined));
    const pool = { query: db.query, connect: vi.fn(async () => ({ query: db.query, release: vi.fn() })) } as unknown as DatabasePool;
    const app = express();
    app.use("/w", createCompetencyWorkerRouter(pool, "k".repeat(40)));
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", `Bearer ${"k".repeat(40)}`).send(success).expect(200, { ok: true });
    expect(notificationOf(db.calls())).toMatchObject({ user: USER, type: "ai", kind: "assessment_comment", link: "#competency", key: `assessment:${ASSESSMENT}` });
    const order = db.calls().map(([sql]) => sql);
    expect(order.indexOf("SAVEPOINT edupath_notify")).toBeGreaterThan(order.findIndex((sql) => sql.startsWith("UPDATE stu_comp_assessments SET ai_status='completed'")));
    expect(order.at(-1)).toBe("COMMIT");
  });
});

describe("AI roadmap and graduation advice", () => {
  const locked = [{ status: "processing", lease_token: LEASE, valid: true, ai_input: { promptVersion: "v" } }];

  it("tells the student the roadmap is ready, or that it failed", async () => {
    const ready = client((sql) => (sql.startsWith("SELECT status,lease_token") ? locked : sql.startsWith("UPDATE stu_roadmaps SET status=$2") ? [{ user_id: USER }] : undefined));
    expect(await completeRoadmap(ready as never, JOB, success)).toBe("ok");
    expect(notificationOf(ready.calls())).toMatchObject({ user: USER, kind: "roadmap_ready", link: "#roadmap", key: `roadmap:${JOB}` });

    const failed = client((sql) => (sql.startsWith("SELECT status,lease_token") ? locked : sql.startsWith("UPDATE stu_roadmaps SET status=$2") ? [{ user_id: USER }] : undefined));
    expect(await completeRoadmap(failed as never, JOB, { leaseToken: LEASE, error: "ai_timeout" })).toBe("ok");
    expect(notificationOf(failed.calls())).toMatchObject({ kind: "roadmap_failed", key: `roadmap:${JOB}` });
  });

  it("tells the student a graduation advice is ready, never a failed one", async () => {
    const ready = client((sql) => (sql.startsWith("SELECT status,lease_token") ? locked : sql.startsWith("UPDATE stu_grad_advice SET status=$2") ? [{ user_id: USER }] : undefined));
    expect(await completeGraduationAdvice(ready as never, JOB, success)).toBe("ok");
    expect(notificationOf(ready.calls())).toMatchObject({ kind: "graduation_advice", link: "#graduation", key: `graduation-advice:${JOB}` });

    const failed = client((sql) => (sql.startsWith("SELECT status,lease_token") ? locked : sql.startsWith("UPDATE stu_grad_advice SET status=$2") ? [{ user_id: USER }] : undefined));
    expect(await completeGraduationAdvice(failed as never, JOB, { leaseToken: LEASE, error: "ai_failed" })).toBe("ok");
    expect(notificationOf(failed.calls())).toBeNull();
  });
});
