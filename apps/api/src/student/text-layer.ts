// Bảng điểm có lớp chữ được đọc ngay trên máy chủ (user 2026-11-07: "nếu như sinh viên up pdf lấy được chữ thì tự chạy
// PyMuPDF còn nếu còn lại máy chủ tôi mở thì thôi không thì chứ bảo máy chủ chưa mở như cũ"; the page does not change).
// Every queued import is first read here by the OCR worker's own code in text-only mode (services/ocr/worker.py --parse
// --text-only: PyMuPDF, numpy and OpenCV for the result marks; never OCR, never Paddle) and finished like a worker's job
// (completeTranscriptJob). A PDF that needs OCR, and any failure of the reader itself, goes back to the queue as it was,
// for the worker on the user's PC; while that worker is off the page says so, as before. One PDF at a time: a Render
// free instance has 512 MB and 0.1 CPU (about 95 MB and 1–2 CPU seconds per transcript, measured 2026-11-07).
// With Gemma OCR (AI_PROVIDER=cloudflare, user 2026-11-08: "chuyển ocr thành gemma luôn") a PDF that needs OCR is read here
// too, by worker.py --parse --gemma (services/ocr/gemma_ocr.py: Gemma 4 on Cloudflare Workers AI reads the scanned pages),
// and nothing goes back to the PC: a PDF Gemma cannot read ends with ocr_failed, which the student can try again.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabasePool } from "../db/pool.js";
import { completeTranscriptJob, type TranscriptImportOptions } from "./transcript-jobs.js";

/** services/ocr, from src/student and dist/student alike. */
export const OCR_DIR = fileURLToPath(new URL("../../../../services/ocr/", import.meta.url));
/** Where the Render build installs PyMuPDF, numpy and OpenCV (scripts/python-text-layer.mjs). */
export const PYDEPS_DIR = join(OCR_DIR, ".pydeps");
/** The worker's own refusals (worker.py PARSE_ERRORS): the PC worker would answer the same, so the job ends with them. */
const FINAL_ERRORS: ReadonlySet<string> = new Set(["invalid_pdf", "encrypted_pdf", "too_many_pages", "unsupported_layout", "curriculum_view"]);

export type TextLayerOutcome = { kind: "result"; result: unknown } | { kind: "error"; code: string } | { kind: "ocr" } | { kind: "fallback" };
/** The Cloudflare values Gemma OCR runs with; null: PDFs that need OCR stay with the PC worker. */
export type GemmaOcr = { accountId: string; apiToken: string };

/** worker.py's answer in text-only mode; anything unexpected hands the job back to the PC worker. */
export function textLayerOutcome(value: unknown): TextLayerOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "fallback" };
  const data = value as Record<string, unknown>;
  if (data.result !== undefined && data.result !== null) return { kind: "result", result: data.result };
  if (typeof data.error === "string" && FINAL_ERRORS.has(data.error)) return { kind: "error", code: data.error };
  if (data.needs_ocr === true) return { kind: "ocr" };
  return { kind: "fallback" };
}

/** worker.py --gemma's answer: a result, or an error that ends the job (never back to the PC queue). */
export function gemmaOutcome(value: unknown): TextLayerOutcome {
  const outcome = textLayerOutcome(value);
  if (outcome.kind === "result" || outcome.kind === "error") return outcome;
  return { kind: "error", code: "ocr_failed" };
}

/** The Python of the reader: TEXT_LAYER_PYTHON, else python3 on Render (RENDER is set there), else none. */
export function textLayerPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.TEXT_LAYER_PYTHON?.trim();
  if (configured) return configured;
  return env.RENDER ? "python3" : null;
}

/** Only what Python needs: never the server's secrets (the Cloudflare values go only to a Gemma OCR run). */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "LANG", "LC_ALL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, PYTHONPATH: [PYDEPS_DIR, OCR_DIR].join(delimiter), PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", ...extra };
}

/** Exit code of a child process, null when it could not start or ran past the time limit. */
function run(command: string, args: string[], timeoutMs: number, extraEnv: Record<string, string> = {}): Promise<number | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(command, args, { env: childEnv(extraEnv), stdio: "ignore", windowsHide: true }); } catch { resolve(null); return; }
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, timeoutMs);
    child.once("error", () => { clearTimeout(timer); resolve(null); });
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
}

/**
 * Reads one PDF: worker.py --parse --text-only in its own process, with a time limit. With Gemma OCR, a PDF that needs OCR
 * (or that the text-only pass failed on) is read again with --gemma; that pass always ends the job.
 */
export type TextLayerRunner = (pdf: Buffer) => Promise<TextLayerOutcome>;
export function pythonTextLayerRunner(python: string, timeoutMs = 120_000, gemma: GemmaOcr | null = null, gemmaTimeoutMs = 600_000): TextLayerRunner {
  return async (pdf) => {
    const dir = await mkdtemp(join(tmpdir(), "edupath-text-"));
    try {
      const input = join(dir, "in.pdf");
      const output = join(dir, "out.json");
      await writeFile(input, pdf);
      const parse = (flag: string, limit: number, env: Record<string, string> = {}) =>
        run(python, ["-s", "-B", join(OCR_DIR, "worker.py"), "--parse", input, output, flag], limit, env);
      let outcome: TextLayerOutcome = { kind: "fallback" };
      try {
        if ((await parse("--text-only", timeoutMs)) === 0) outcome = textLayerOutcome(JSON.parse(await readFile(output, "utf8")));
      } catch { outcome = { kind: "fallback" }; }
      if (!gemma || outcome.kind === "result" || outcome.kind === "error") return outcome;
      await rm(output, { force: true });
      const code = await parse("--gemma", gemmaTimeoutMs, { CLOUDFLARE_ACCOUNT_ID: gemma.accountId, CLOUDFLARE_API_TOKEN: gemma.apiToken });
      if (code === null) return { kind: "error", code: "parse_timeout" };
      if (code !== 0) return { kind: "error", code: "ocr_failed" };
      return gemmaOutcome(JSON.parse(await readFile(output, "utf8")));
    } catch {
      return gemma ? { kind: "error", code: "ocr_failed" } : { kind: "fallback" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** Whether python has what the reader needs (checked once at start). */
export async function probeTextLayer(python: string): Promise<boolean> {
  return (await run(python, ["-s", "-B", "-c", "import pymupdf, numpy, cv2"], 60_000)) === 0;
}

/** The queue as the reader uses it. */
export type TextLayerJobs = {
  /** Leases the oldest waiting job, other than `skip`, for this server; null when there is none. */
  claim(skip: readonly string[]): Promise<{ id: string; leaseToken: string; pdf: Buffer } | null>;
  /** Puts a leased job back in the queue as it was, for the PC worker. */
  release(id: string, leaseToken: string): Promise<void>;
  /** Finishes a leased job as the PC worker would (completeTranscriptJob). */
  complete(id: string, leaseToken: string, outcome: { result: unknown } | { error: string }): Promise<void>;
};

/**
 * transcript_jobs for the reader. Its lease leaves `attempts` alone (the PC worker's retries count only its own claims)
 * and runs out after 10 minutes like the worker's, so a job left by a restarted server is taken again by either.
 */
export function postgresTextLayerJobs(pool: DatabasePool, options: TranscriptImportOptions = {}): TextLayerJobs {
  return {
    async claim(skip) {
      const result = await pool.query<{ id: string; pdf: Buffer; leaseToken: string }>(`WITH candidate AS (
          SELECT id FROM transcript_jobs WHERE pdf_data IS NOT NULL AND NOT (id = ANY($2::uuid[]))
            AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts=0))
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE transcript_jobs j SET status='processing',lease_token=$1,lease_until=now()+interval '10 minutes',updated_at=now()
        FROM candidate c WHERE j.id=c.id RETURNING j.id,j.pdf_data AS pdf,j.lease_token AS "leaseToken"`, [randomUUID(), [...skip]]);
      return result.rows[0] ?? null;
    },
    async release(id, leaseToken) {
      await pool.query(`UPDATE transcript_jobs SET status='queued',lease_token=NULL,lease_until=NULL,updated_at=now()
        WHERE id=$1 AND lease_token=$2 AND status='processing'`, [id, leaseToken]);
    },
    complete: (id, leaseToken, outcome) => completeTranscriptJob(pool, id, { leaseToken, ...outcome }, options),
  };
}

export type TextLayerStatus = "off" | "checking" | "ready";
export type TextLayerReader = {
  /** Reads the waiting imports now (after an upload, and once ready); a kick during a run makes it look again after. */
  kick(): void;
  /** Whether this server reads, or will read, that job: the page then shows it being read, not the PC worker off. */
  covers(jobId: string): boolean;
  status(): TextLayerStatus;
  /** Resolves when the current run is over (tests). */
  idle(): Promise<void>;
};

/** The reader over a queue and a runner; jobs that need OCR are left to the PC worker for the life of this process. */
export function createTextLayerReader(jobs: TextLayerJobs, runner: TextLayerRunner, log: Pick<Console, "warn"> = console): TextLayerReader {
  const handedBack = new Set<string>();
  let running: Promise<void> | null = null;
  let again = false;
  const handBack = async (job: { id: string; leaseToken: string }) => {
    handedBack.add(job.id);
    await jobs.release(job.id, job.leaseToken);
  };
  const drain = async () => {
    do {
      again = false;
      for (let job = await jobs.claim([...handedBack]); job; job = await jobs.claim([...handedBack])) {
        let outcome: TextLayerOutcome;
        try { outcome = await runner(job.pdf); } catch { outcome = { kind: "fallback" }; }
        try {
          if (outcome.kind === "result") await jobs.complete(job.id, job.leaseToken, { result: outcome.result });
          else if (outcome.kind === "error") await jobs.complete(job.id, job.leaseToken, { error: outcome.code });
          else await handBack(job);
        } catch (error) {
          // The lease was lost (the student cancelled) or the database failed: the PC worker may still take the job.
          handedBack.add(job.id);
          await jobs.release(job.id, job.leaseToken).catch(() => undefined);
          log.warn(`[transcript] text-layer reader: ${error instanceof Error ? error.name : "error"}`);
        }
      }
    } while (again);
  };
  return {
    kick() {
      if (running) { again = true; return; }
      running = drain()
        .catch((error: unknown) => { log.warn(`[transcript] text-layer reader stopped: ${error instanceof Error ? error.name : "error"}`); })
        .finally(() => { running = null; });
    },
    covers: (jobId) => !handedBack.has(jobId),
    status: () => "ready",
    idle: () => running ?? Promise.resolve(),
  };
}

/**
 * The reader of this server: none without a Python (status off), else ready once python imports PyMuPDF, numpy and
 * OpenCV, and then it reads what is already waiting. Until then it covers nothing and a kick waits for the check.
 */
export function startTextLayerReader(python: string | null, jobs: TextLayerJobs | null, options: {
  runner?: TextLayerRunner; probe?: (python: string) => Promise<boolean>; log?: Pick<Console, "warn" | "info">;
  /** Gemma OCR (AI_PROVIDER=cloudflare): this server reads the PDFs that need OCR too. */
  gemma?: GemmaOcr | null;
} = {}): TextLayerReader {
  const log = options.log ?? console;
  let state: TextLayerStatus = python && jobs ? "checking" : "off";
  let reader: TextLayerReader | null = null;
  let kickWhenReady = false;
  if (python && jobs) {
    void (options.probe ?? probeTextLayer)(python).then((ok) => {
      if (!ok) { state = "off"; log.warn("[transcript] text-layer reader off: python, PyMuPDF, numpy or OpenCV missing"); return; }
      reader = createTextLayerReader(jobs, options.runner ?? pythonTextLayerRunner(python, 120_000, options.gemma ?? null), log);
      state = "ready";
      log.info("[transcript] text-layer reader ready");
      reader.kick();
      if (kickWhenReady) reader.kick();
    }, () => { state = "off"; });
  }
  return {
    kick() { if (reader) reader.kick(); else if (state === "checking") kickWhenReady = true; },
    covers: (jobId) => reader?.covers(jobId) ?? false,
    status: () => state,
    idle: () => reader?.idle() ?? Promise.resolve(),
  };
}
