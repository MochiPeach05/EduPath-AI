import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { TRANSCRIPT_POLICY_VERSION } from "./consent.js";
import { createStudentDataRouter } from "./router.js";
import {
  createTextLayerReader, gemmaOutcome, startTextLayerReader, textLayerOutcome, textLayerPython, type TextLayerJobs, type TextLayerOutcome, type TextLayerReader,
} from "./text-layer.js";
import { createTranscriptWorkerRouter } from "./transcript-jobs.js";

// The server's own text-layer reader (user 2026-11-07): a fake queue and a fake Python; synthetic jobs only.
const pdf = Buffer.from("%PDF-1.7\n%synthetic\n");

function queue(ids: string[]) {
  const waiting = [...ids];
  const completed: [string, string, unknown][] = [];
  const released: [string, string][] = [];
  const jobs: TextLayerJobs = {
    async claim(skip) {
      const index = waiting.findIndex((id) => !skip.includes(id));
      if (index < 0) return null;
      const [id] = waiting.splice(index, 1);
      return { id: id!, leaseToken: `lease-${id}`, pdf };
    },
    async release(id, leaseToken) { released.push([id, leaseToken]); waiting.push(id); },
    async complete(id, leaseToken, outcome) { completed.push([id, leaseToken, outcome]); },
  };
  return { jobs, completed, released, waiting };
}
const sequence = (outcomes: (TextLayerOutcome | Error)[]) => vi.fn(async () => {
  const next = outcomes.shift();
  if (next instanceof Error) throw next;
  return next ?? { kind: "fallback" as const };
});

describe("the text-layer reader's answers", () => {
  it("reads worker.py --text-only: a result, one of the worker's own refusals, a page that needs OCR, anything else", () => {
    expect(textLayerOutcome({ result: { course_count: 1 } })).toEqual({ kind: "result", result: { course_count: 1 } });
    expect(textLayerOutcome({ error: "curriculum_view" })).toEqual({ kind: "error", code: "curriculum_view" });
    expect(textLayerOutcome({ error: "encrypted_pdf" })).toEqual({ kind: "error", code: "encrypted_pdf" });
    // An error the PC worker might not give (it could OCR the page) hands the job back.
    expect(textLayerOutcome({ error: "ocr_failed" })).toEqual({ kind: "fallback" });
    expect(textLayerOutcome({ needs_ocr: true })).toEqual({ kind: "ocr" });
    for (const value of [{ fallback: true }, null, [], "x", { result: null }]) expect(textLayerOutcome(value)).toEqual({ kind: "fallback" });
  });

  it("ends every job Gemma reads (2026-11-08): a result, a refusal, else ocr_failed, never back to the PC queue", () => {
    expect(gemmaOutcome({ result: { course_count: 1 } })).toEqual({ kind: "result", result: { course_count: 1 } });
    expect(gemmaOutcome({ error: "curriculum_view" })).toEqual({ kind: "error", code: "curriculum_view" });
    for (const value of [{ error: "ocr_failed", reason: "daily_limit" }, { needs_ocr: true }, { fallback: true }, null]) {
      expect(gemmaOutcome(value)).toEqual({ kind: "error", code: "ocr_failed" });
    }
  });

  it("refuses the PC worker once Gemma reads the scans on the server, and only then", async () => {
    const key = "k".repeat(40);
    let moved = true;
    const app = express().use("/w", createTranscriptWorkerRouter({} as DatabasePool, key, { refuseWorker: () => moved }));
    const refused = await request(app).post("/w/claim").set("authorization", `Bearer ${key}`).send({});
    expect([refused.status, refused.body]).toEqual([403, { error: "worker_moved" }]);
    moved = false;
    const wrongKey = await request(app).post("/w/claim").set("authorization", "Bearer wrong").send({});
    expect(wrongKey.status).toBe(401);
  });

  it("runs only where a Python is set up: TEXT_LAYER_PYTHON, else python3 on Render", () => {
    expect(textLayerPython({ TEXT_LAYER_PYTHON: " D:/py/python.exe " })).toBe("D:/py/python.exe");
    expect(textLayerPython({ RENDER: "true" })).toBe("python3");
    expect(textLayerPython({})).toBeNull();
  });
});

describe("the text-layer reader", () => {
  it("finishes a PDF it reads or the worker refuses, and hands one that needs OCR back to the PC worker once", async () => {
    const { jobs, completed, released, waiting } = queue(["a", "b", "c"]);
    const runner = sequence([{ kind: "result", result: { course_count: 1 } }, { kind: "ocr" }, { kind: "error", code: "curriculum_view" }]);
    const reader = createTextLayerReader(jobs, runner, { warn: vi.fn() });
    expect(reader.covers("b")).toBe(true);
    reader.kick();
    await reader.idle();
    expect(completed).toEqual([["a", "lease-a", { result: { course_count: 1 } }], ["c", "lease-c", { error: "curriculum_view" }]]);
    expect(released).toEqual([["b", "lease-b"]]);
    // b waits for the PC worker: not read again here, and the page shows the PC worker's state for it.
    expect(waiting).toEqual(["b"]);
    expect(runner).toHaveBeenCalledTimes(3);
    expect(reader.covers("b")).toBe(false);
    expect(reader.covers("a")).toBe(true);
    reader.kick();
    await reader.idle();
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("hands the job back when the reader fails or the lease is lost, logging no data", async () => {
    const { jobs, released } = queue(["a", "b"]);
    const warn = vi.fn();
    jobs.complete = vi.fn(async () => { throw Object.assign(new Error("job_expired"), { name: "TranscriptError" }); });
    const reader = createTextLayerReader(jobs, sequence([new Error("spawn failed"), { kind: "result", result: {} }]), { warn });
    reader.kick();
    await reader.idle();
    expect(released).toEqual([["a", "lease-a"], ["b", "lease-b"]]);
    expect(warn).toHaveBeenCalledWith("[transcript] text-layer reader: TranscriptError");
    expect(reader.covers("a")).toBe(false);
    expect(reader.covers("b")).toBe(false);
  });

  it("looks again when an upload arrives while it reads, one PDF at a time", async () => {
    const { jobs, completed, waiting } = queue(["a"]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let most = 0;
    const runner = vi.fn(async () => {
      active += 1; most = Math.max(most, active);
      await gate;
      active -= 1;
      return { kind: "result" as const, result: {} };
    });
    const reader = createTextLayerReader(jobs, runner, { warn: vi.fn() });
    reader.kick();
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    waiting.push("b");
    reader.kick();
    release();
    await reader.idle();
    await reader.idle();
    expect(completed.map(([id]) => id)).toEqual(["a", "b"]);
    expect(most).toBe(1);
  });

  it("is off without a Python or when python lacks PyMuPDF, numpy or OpenCV, and reads what waits once ready", async () => {
    const off = startTextLayerReader(null, queue([]).jobs);
    expect(off.status()).toBe("off");
    expect(off.covers("a")).toBe(false);
    off.kick();

    const log = { warn: vi.fn(), info: vi.fn() };
    const missing = startTextLayerReader("python3", queue(["a"]).jobs, { probe: async () => false, log });
    expect(missing.status()).toBe("checking");
    await vi.waitFor(() => expect(missing.status()).toBe("off"));
    expect(missing.covers("a")).toBe(false);

    const { jobs, completed } = queue(["a"]);
    const ready = startTextLayerReader("python3", jobs, { probe: async () => true, runner: sequence([{ kind: "result", result: {} }]), log });
    ready.kick();
    await vi.waitFor(() => expect(ready.status()).toBe("ready"));
    await ready.idle();
    expect(completed.map(([id]) => id)).toEqual(["a"]);
  });
});

describe("the transcript page while the server reads the PDF", () => {
  const studentId = "11111111-1111-4111-8111-111111111111";
  const jobId = "44444444-4444-4444-8444-444444444444";
  const origin = "https://edupath.example";
  function app(textLayer: Pick<TextLayerReader, "kick" | "covers">, status = "queued") {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM transcript_jobs WHERE user_id=$1 ORDER BY")) return { rowCount: 1, rows: [{ id: jobId, filename: "bang-diem.pdf", status, errorCode: null }] };
      if (sql.includes("transcript_worker_status")) return { rowCount: 1, rows: [{ online: false }] };
      if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: studentId }] };
      if (sql.includes("INSERT INTO transcript_jobs")) return { rowCount: 1, rows: [{ id: jobId, status: "queued" }] };
      if (sql.includes("count(*)::int AS count FROM transcript_jobs")) return { rowCount: 1, rows: [{ count: 0 }] };
      return { rowCount: 0, rows: [] };
    });
    const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }), query } as unknown as DatabasePool;
    const server = express();
    server.use((req, _res, next) => { Object.assign(req, { session: { user: { userId: studentId, tenantId: "t", role: "student" } } }); next(); });
    server.use("/student", createStudentDataRouter(pool, origin, true, { textLayer }));
    return server;
  }

  it("says a reader is at work for a job the server reads, and shows the PC worker's state for one it handed back", async () => {
    const reading = await request(app({ kick: vi.fn(), covers: () => true })).get("/student/transcript").expect(200);
    expect(reading.body).toMatchObject({ job: { id: jobId, status: "queued" }, workerOnline: true });
    const handedBack = await request(app({ kick: vi.fn(), covers: () => false })).get("/student/transcript").expect(200);
    expect(handedBack.body.workerOnline).toBe(false);
    const finished = await request(app({ kick: vi.fn(), covers: () => true }, "completed")).get("/student/transcript").expect(200);
    expect(finished.body.workerOnline).toBe(false);
  });

  it("kicks the reader once the upload is queued", async () => {
    const kick = vi.fn();
    await request(app({ kick, covers: () => true })).post("/student/transcript").set("Origin", origin).set("Content-Type", "application/pdf")
      .set("X-File-Name", "bang-diem.pdf").set("X-Confirm-Own-Transcript", "true").set("X-Consent-Policy-Version", TRANSCRIPT_POLICY_VERSION)
      .send(pdf).expect(202);
    expect(kick).toHaveBeenCalledTimes(1);
  });
});
