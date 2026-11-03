// Cố vấn học tập (AD-ADV-01…05, AD-AST-01…04; 2026-11-03): the shapes the advisor endpoints answer. They are the contract of
// apps/web/src/advisor-types.ts, written again here so the API does not import from the web.

export type AdvisorAccountStatus = "pending" | "active" | "locked";

export type AdvisorRow = {
  stt: number;
  userId: string;
  name: string;
  email: string;
  staffCode: string | null;
  unit: string | null;
  classes: string[];
  students: number;
  account: AdvisorAccountStatus;
  role: string;
  lastLoginAt: string | null;
};

export type AdvisorClassDetail = { className: string; cohort: string | null; students: number; withTranscript: number; assessed: number };
export type AdvisorDetail = AdvisorRow & { createdAt: string; updatedAt: string; classDetails: AdvisorClassDetail[] };
export type AdvisorInput = { name: string; email: string; staffCode?: string | null; unit?: string | null; classes: string[] };

export type AdvisorImportItem = {
  rows: number[];
  name: string;
  email: string;
  staffCode: string | null;
  unit: string | null;
  classes: string[];
  status: "add" | "update" | "unchanged" | "error";
  changes: string[];
  problems: string[];
  emptyClasses: string[];
};
export type AdvisorImportPreview = {
  fileName: string;
  rows: number;
  items: AdvisorImportItem[];
  fileProblems: string[];
  summary: { add: number; update: number; unchanged: number; error: number; classes: number; moved: number };
};
export type AdvisorImportResult = { added: number; updated: number; unchanged: number; skipped: number; preview: AdvisorImportPreview };

export type AdvisorClass = AdvisorClassDetail & { surveyDone: number; roadmap: number };
export type AdvisedStudentRow = {
  stt: number;
  userId: string;
  studentCode: string | null;
  name: string;
  className: string;
  cohort: string | null;
  specialty: string | null;
  targetCareer: string | null;
  hasTranscript: boolean;
  assessed: boolean;
  surveyDone: boolean;
  roadmap: boolean;
  lastLoginAt: string | null;
};
export const ADVISED_STUDENT_STATUSES = ["all", "no_transcript", "no_assessment", "no_survey", "no_roadmap", "complete"] as const;
export type AdvisedStudentStatus = (typeof ADVISED_STUDENT_STATUSES)[number];
export type AdvisorMe = { classes: number; canManageAdvisors: boolean };

/** An error the advisor endpoints answer with (codes: apps/web/src/advisor-types.ts ADVISOR_ERRORS). */
export class AdvisorError extends Error {
  constructor(readonly code: string, readonly status: number, readonly details?: Record<string, unknown>) {
    super(code);
    this.name = "AdvisorError";
  }
}

/** A class as stored and compared (ad_advisor_classes, migration 058): upper case, no spaces, 2–40 characters. */
export const CLASS_PATTERN = /^[0-9A-Z][0-9A-Z._-]{1,39}$/;
/** A student's class (p = student_profiles) in that form, for SQL. */
export const CLASS_OF = "upper(regexp_replace(p.class_name, '\\s', '', 'g'))";
