export interface PlanItem {
  id: string;
  position: number;
  code: string;
  /**
   * The code the graduation standard gives a row the KHĐT file writes under another code (API plans/repository.ts detail,
   * curricula/real-codes.ts, user 2026-11-10: "dùng luôn mã thực tế"; CNTT K28 71ITMA10203 → 71MATL10053): the real code of the
   * plan's CTĐT, what students read on their KHĐT. Absent when the codes agree. The admin detail shows it with "Mã trong tệp
   * KHĐT: <code>" under it; the row is still edited by `code`, the file's code, and `realCode` is never sent back (the API's
   * item schema is strict).
   */
  realCode?: string;
  name: string;
  credits: number | null;
  type: string;
  termCode: string;
  semester: number;
  studyYear: number;
  sectionId: string;
  prerequisite: string;
  prior: string;
  notes: string;
  hours: {
    lecture: number | null;
    practice: number | null;
    project: number | null;
    internship: number | null;
  };
  sourceRow: number;
  sourceSheet: string;
  sourceCells: Record<string, string>;
}
export interface PlanData {
  schemaVersion: 1;
  name: string;
  major: string;
  cohortCode: string;
  admissionYear: number;
  totalCredits: number | null;
  notes: string;
  items: PlanItem[];
  terms: {
    code: string;
    semester: number;
    studyYear: number;
    sourceCredits: number | null;
  }[];
  sections: {
    id: string;
    termCode: string;
    label: string;
    kind: "choice" | "specialty" | "note";
    sourceRow: number;
  }[];
  warnings: { row: number | null; message: string }[];
  sourceWarnings: { row: number | null; message: string }[];
  curriculum: {
    id: string;
    revisionId: string;
    version: number;
    name: string;
  } | null;
}
export interface PlanDetail {
  id: string;
  isActive: boolean;
  token: string;
  updatedAt: string;
  revisionId: string;
  version: number;
  data: PlanData;
  sourceFilename: string;
  history: { id: string; version: number; note: string; createdAt: string }[];
  events: { action: string; createdAt: string }[];
}
export interface PlanList {
  items: {
    /** The row's number in the list's own order (newest cohort first), kept when the list is sorted by a column. */
    stt?: number;
    id: string;
    name: string;
    major: string;
    cohortCode: string;
    isActive: boolean;
    version: number;
    totalCredits: number | null;
    itemCount: number;
    warningCount: number;
  }[];
  total: number;
  cohorts: string[];
}
