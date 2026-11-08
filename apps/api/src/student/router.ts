import express, { Router, type ErrorRequestHandler } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { actingAdvisor, studentUser } from "../advisors/access.js";
import { parseTranscript, TranscriptError, withoutSettledReviews, type TranscriptData } from "./transcript-parser.js";
import { enqueueTranscript, expireJobs, jobColumns, runAfterTranscriptImport, type TranscriptImportOptions } from "./transcript-jobs.js";
import { activeConsentVersion, isValidConsent, recordConsent, recordTranscriptConsent, TRANSCRIPT_POLICY_VERSION, withdrawConsent, withdrawTranscriptConsent } from "./consent.js";
import { ACHIEVEMENTS_MAX, deleteSurvey, parseSurveyInput, readPreviousInterests, readSurvey, saveSurvey, SURVEY_QUESTIONS } from "./survey.js";
import { bothOrNeither, INTEREST_HOBBIES, INTEREST_MAX, INTEREST_TECH, interestFields } from "./interests.js";
import { deleteCompetencyData } from "../competency-assessment/repository.js";
import { specialtyOffered } from "../competency-assessment/specialty.js";
import { deleteGraduationAdvice } from "../graduation/advice/jobs.js";
import { convertibleCourses } from "../graduation/convertible.js";
import { normalizeCohortCode, profileSpecialty } from "../graduation/resolve.js";
import { readCohortCurriculumCourses } from "../graduation/student-graduation.js";

const transcriptColumns = `version, filename, file_size AS "fileSize", parsed_data AS data,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
type TranscriptRow = { version: string; filename: string; fileSize: number; data: TranscriptData; createdAt: string; updatedAt: string };
async function lockStudent(client: PoolClient, user: AuthenticatedUser) {
  const active = await client.query(`SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2
    AND is_active FOR UPDATE`, [user.userId, user.tenantId]);
  if (!active.rowCount) throw new TranscriptError("insufficient_role", 403);
}

export function createStudentDataRouter(pool: DatabasePool | undefined, webOrigin: string, ocrEnabled = false, options: TranscriptImportOptions = {}) {
  const router = Router();
  router.use(requireAuthentication);
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    next();
  });

  router.patch("/profile", async (req, res) => {
    const input = z.object({
      className: z.string().trim().max(32).regex(/^[\p{L}\p{N} _.-]*$/u).nullable().optional(),
      interests: z.string().trim().max(2000).nullable().optional(),
      careerGoal: z.string().trim().max(2000).nullable().optional(),
      careerPositionId: z.uuid().nullable().optional(),
      currentSemester: z.number().int().min(1).max(3).nullable().optional(),
      specialty: z.enum(["CNPM", "CNDL", "TTNT", "ANM", "KCN", "HTTT_CDS", "HTTT_GIS", "MMT_IOT", "MMT_ANM"]).nullable().optional(),
      // Older pages: the free text above and these choices only prefill the survey now (interests.ts).
      ...interestFields,
    }).strict().refine(bothOrNeither).safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid_profile" }); return; }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await lockStudent(client, studentUser(req));
      await client.query(`INSERT INTO student_profiles (user_id,class_name,interests,career_goal,current_semester)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET
        ${input.data.interests === undefined ? "interests=student_profiles.interests" : "interests=EXCLUDED.interests"},current_semester=COALESCE(EXCLUDED.current_semester,student_profiles.current_semester),updated_at=CURRENT_TIMESTAMP`,
        [studentUser(req).userId, null, input.data.interests || null, null, input.data.currentSemester ?? null]);
      if (input.data.careerPositionId !== undefined) {
        const selected = input.data.careerPositionId;
        if (selected) {
          const career = await client.query("SELECT deleted_at FROM career_positions WHERE id=$1 FOR SHARE", [selected]);
          const previous = await client.query("SELECT career_position_id FROM student_profiles WHERE user_id=$1", [studentUser(req).userId]);
          if (!career.rowCount || (career.rows[0].deleted_at && previous.rows[0]?.career_position_id !== selected))
            throw new TranscriptError("career_unavailable", 409);
        }
        await client.query("UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1", [studentUser(req).userId, selected]);
      }
      // Absent keeps the specialty, null clears it ("Chưa xác định"). An ninh Mạng và IoTs is offered to K27 only,
      // "Không theo chuyên ngành" to K28 and earlier, and each major has its own specialties (specialtyOffered, 052).
      if (input.data.specialty !== undefined) {
        if (input.data.specialty) {
          const profile = await client.query<{ cohort_code: string | null; major_code: string | null }>(
            "SELECT cohort_code,major_code FROM student_profiles WHERE user_id=$1", [studentUser(req).userId]);
          if (!specialtyOffered(input.data.specialty, profile.rows[0]?.cohort_code, profile.rows[0]?.major_code ?? null))
            throw new TranscriptError("specialty_unavailable", 409);
        }
        await client.query("UPDATE student_profiles SET specialty=$2 WHERE user_id=$1", [studentUser(req).userId, input.data.specialty]);
      }
      // The choices replace the free text, which is cleared; the survey takes them in when saved.
      if (input.data.interestTech && input.data.interestHobbies) {
        await client.query("UPDATE student_profiles SET interest_tech=$2,interest_hobbies=$3,interests=NULL WHERE user_id=$1",
          [studentUser(req).userId, input.data.interestTech, input.data.interestHobbies]);
      }
      await client.query("COMMIT");
      res.json({ saved: true });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  // "Khảo sát định hướng": the questions and interest lists, the stored answers, what the profile held before the
  // interests moved into the survey (to start from), and the policy version the student agreed to.
  router.get("/survey", async (req, res) => {
    const userId = studentUser(req).userId;
    const survey = await readSurvey(pool!, userId);
    res.json({
      questions: SURVEY_QUESTIONS, interests: { tech: INTEREST_TECH, hobbies: INTEREST_HOBBIES, max: INTEREST_MAX }, achievementsMax: ACHIEVEMENTS_MAX,
      survey, previous: survey?.interestTech.length ? null : await readPreviousInterests(pool!, userId),
      consentVersion: await activeConsentVersion(pool!, userId, "profile_survey"),
    });
  });
  // Saving needs consent: to the current policy with this request (X-Consent-Policy-Version), or an active one that still
  // counts (isValidConsent).
  router.put("/survey", async (req, res) => {
    const input = parseSurveyInput(req.body);
    if ("error" in input) { res.status(400).json({ error: input.error }); return; }
    const consentVersion = req.get("x-consent-policy-version");
    if (consentVersion && consentVersion !== TRANSCRIPT_POLICY_VERSION) { res.status(409).json({ error: "policy_outdated" }); return; }
    const userId = studentUser(req).userId;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await lockStudent(client, studentUser(req));
      if (consentVersion) await recordConsent(client, userId, "profile_survey");
      const agreed = consentVersion ?? await activeConsentVersion(client, userId, "profile_survey");
      if (!isValidConsent(agreed)) throw new TranscriptError("consent_required", 400);
      const survey = await saveSurvey(client, userId, input.value);
      await client.query("COMMIT");
      res.json({ survey, consentVersion: agreed });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  // "Xóa câu trả lời": withdraws the consent; the AI roadmaps go too (deleteSurvey).
  router.delete("/survey", async (req, res) => {
    if (!z.object({ confirmed: z.literal(true) }).strict().safeParse(req.body).success) { res.status(400).json({ error: "invalid_input" }); return; }
    const userId = studentUser(req).userId;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await lockStudent(client, studentUser(req));
      const deleted = await deleteSurvey(client, userId);
      await withdrawConsent(client, userId, "profile_survey");
      await client.query("COMMIT");
      res.json({ deleted });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  router.get("/transcript", async (req, res) => {
    await expireJobs(pool!);
    const result = await pool!.query<TranscriptRow>(`SELECT ${transcriptColumns} FROM student_transcripts WHERE user_id=$1`, [studentUser(req).userId]);
    const jobs = await pool!.query(`SELECT ${jobColumns} FROM transcript_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [studentUser(req).userId]);
    const worker = await pool!.query<{ online: boolean }>("SELECT seen_at>now()-interval '60 seconds' AS online FROM transcript_worker_status WHERE id=1");
    const row = result.rows[0];
    // A pending job the server reads itself (text-layer.ts) has a reader too: the page must not say the PC worker is off.
    const job = jobs.rows[0] as { id: string; status: string } | undefined;
    const serverReads = Boolean(job && (job.status === "queued" || job.status === "processing") && options.textLayer?.covers(job.id));
    // Passed mandatory courses of another specialty: counted nowhere, the page says the school can convert them
    // (graduation/convertible.ts, user 2026-11-08).
    let convertible = null;
    if (row) {
      const profile = (await pool!.query<{ cohort_code: string | null; specialty: string | null; major_code: string | null }>(
        "SELECT cohort_code,specialty,major_code FROM student_profiles WHERE user_id=$1", [studentUser(req).userId])).rows[0];
      const cohort = normalizeCohortCode(profile?.cohort_code), specialty = profileSpecialty(profile?.specialty);
      if (cohort && specialty) {
        convertible = convertibleCourses(await readCohortCurriculumCourses(pool!, cohort, profile?.major_code?.trim() || null), row.data, cohort, specialty);
      }
    }
    // Marks of a stored transcript that are not errors (withoutSettledReviews) are left out, as a new upload does.
    res.json({ transcript: row ? { ...row, data: withoutSettledReviews(row.data) } : null, job: jobs.rows[0] ?? null,
      workerOnline: (worker.rows[0]?.online ?? false) || serverReads, ocrEnabled, convertible });
  });
  router.delete("/transcript/job", async (req, res) => {
    const input = z.object({ id: z.uuid() }).safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid_input" }); return; }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN"); await lockStudent(client, studentUser(req));
      await client.query("UPDATE transcript_jobs SET status='cancelled',pdf_data=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('queued','processing')", [input.data.id, studentUser(req).userId]);
      await client.query("COMMIT"); res.json({ cancelled: true });
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  });
  router.get("/transcript/file", async (req, res) => {
    const result = await pool!.query<{ filename: string; pdf: Buffer }>(`SELECT filename,pdf_data AS pdf FROM student_transcripts WHERE user_id=$1`, [studentUser(req).userId]);
    const file = result.rows[0];
    if (!file) { res.status(404).json({ error: "transcript_not_found" }); return; }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="bang-diem.pdf"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.pdf);
  });
  router.post("/transcript", express.raw({ type: "application/pdf", limit: "5mb" }), async (req, res) => {
    // The student confirms the transcript is their own and agrees to the policy. A cố vấn học tập importing it for a
    // student of their class does neither in the student's name (policy 2026-11-03): no consent is recorded below.
    const advisor = actingAdvisor(req);
    if (!advisor) {
      if (req.get("x-confirm-own-transcript") !== "true") { res.status(400).json({ error: "ownership_confirmation_required" }); return; }
      const consentVersion = req.get("x-consent-policy-version");
      if (!consentVersion) { res.status(400).json({ error: "consent_required" }); return; }
      if (consentVersion !== TRANSCRIPT_POLICY_VERSION) { res.status(409).json({ error: "policy_outdated" }); return; }
    }
    if (!Buffer.isBuffer(req.body) || req.body.length < 8 || req.body.subarray(0, 5).toString("ascii") !== "%PDF-") { res.status(400).json({ error: "invalid_pdf" }); return; }
    const rawVersion = req.get("x-transcript-version");
    if (rawVersion && !z.uuid().safeParse(rawVersion).success) { res.status(400).json({ error: "invalid_version" }); return; }
    let filename: string;
    try { filename = decodeURIComponent(req.get("x-file-name") ?? "bang-diem.pdf").normalize("NFC").replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 200); }
    catch { res.status(400).json({ error: "invalid_filename" }); return; }
    if (!filename.toLowerCase().endsWith(".pdf")) { res.status(400).json({ error: "invalid_pdf" }); return; }
    if (ocrEnabled) await expireJobs(pool!);
    const data = ocrEnabled ? undefined : await parseTranscript(req.body);
    const client = await pool!.connect();
    let imported = false;
    try {
      await client.query("BEGIN");
      await lockStudent(client, studentUser(req));
      const existing = await client.query<{ version: string }>("SELECT version FROM student_transcripts WHERE user_id=$1 FOR UPDATE", [studentUser(req).userId]);
      if ((existing.rows[0]?.version ?? undefined) !== rawVersion) throw new TranscriptError("transcript_changed", 409);
      if (!advisor) await recordTranscriptConsent(client, studentUser(req).userId);
      if (ocrEnabled) {
        const job = await enqueueTranscript(client, studentUser(req).userId, filename, req.body, rawVersion);
        await client.query("COMMIT"); res.status(202).json({ job });
        // The server reads a PDF with a text layer at once; one that needs OCR waits for the PC worker (text-layer.ts).
        options.textLayer?.kick();
        return;
      }
      const result = await client.query<TranscriptRow>(`INSERT INTO student_transcripts
        (user_id,version,filename,pdf_data,file_size,sha256,parsed_data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
        ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,filename=EXCLUDED.filename,
        pdf_data=EXCLUDED.pdf_data,file_size=EXCLUDED.file_size,sha256=EXCLUDED.sha256,parsed_data=EXCLUDED.parsed_data,updated_at=CURRENT_TIMESTAMP
        RETURNING ${transcriptColumns}`, [studentUser(req).userId, randomUUID(), filename, req.body, req.body.length, createHash("sha256").update(req.body).digest("hex"), JSON.stringify(data)]);
      // Results computed from the previous transcript no longer apply.
      await deleteCompetencyData(client, studentUser(req).userId);
      await deleteGraduationAdvice(client, studentUser(req).userId);
      await client.query("COMMIT");
      imported = true;
      res.status(existing.rowCount ? 200 : 201).json({ transcript: result.rows[0] });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    // Committed: queue graduation advice for the new transcript (best-effort, after the response).
    if (imported) runAfterTranscriptImport(options.afterTranscriptImport, studentUser(req).userId);
  });
  router.delete("/transcript", async (req, res) => {
    const input = z.object({ version: z.uuid(), confirmed: z.literal(true) }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid_input" }); return; }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await lockStudent(client, studentUser(req));
      await client.query("UPDATE transcript_jobs SET status='cancelled',pdf_data=NULL,lease_token=NULL,updated_at=now() WHERE user_id=$1 AND status IN ('queued','processing')", [studentUser(req).userId]);
      const deleted = await client.query("DELETE FROM student_transcripts WHERE user_id=$1 AND version=$2", [studentUser(req).userId, input.data.version]);
      if (!deleted.rowCount) throw new TranscriptError("transcript_changed", 409);
      await deleteCompetencyData(client, studentUser(req).userId);
      await deleteGraduationAdvice(client, studentUser(req).userId);
      await withdrawTranscriptConsent(client, studentUser(req).userId);
      await client.query("COMMIT"); res.json({ deleted: true });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof TranscriptError) { res.status(error.status).json({ error: error.code }); return; }
    if (error?.type === "entity.too.large") { res.status(413).json({ error: "pdf_too_large" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
