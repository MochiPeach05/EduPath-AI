// Báo cáo của cổng quản trị (AD-REPORT-01…11, 2026-10-31): the responses of /api/admin/reports/* and
// /api/admin/audit-log. Mirror of apps/api/src/admin/reports/types.ts; keep both in step.
//
// User decisions (2026-10-31): every admin sees and exports everything, students by name included ("hiện đầy đủ",
// "mọi quản trị viên"); every section can be read for all cohorts together and for each cohort ("mọi phần đều có xem
// trung bình toàn khóa với từng khóa"), so each aggregate comes as CohortSplit. Progress and risk are computed exactly
// like the student's own Tổng quan (readOverview), never by AI.

/** "HK261" and "HK1 2026–2027" (term-name.ts). */
export type ReportTerm = { code: string; label: string };

/** One aggregate for the whole scope and the same aggregate for each cohort present in it, oldest cohort first. */
export type CohortSplit<T> = { all: T; byCohort: ({ cohort: string } & T)[] };

/** Query of every report: the shared filter bar (AD-REPORT-10: search and filters, one row since the function-list merge of 2026-10-31). */
export type ReportFilters = { cohort?: string; major?: string; specialty?: string; q?: string };

/** GET /api/admin/reports/options: the choices of the filter bar. */
export type ReportOptions = {
  cohorts: string[];
  majors: { code: string; name: string }[];
  specialties: { code: string; name: string; majorCode: string | null }[];
  studyTerm: ReportTerm | null;
};

/**
 * Who the numbers cover: students with an account; with a stored transcript ("đã tải bảng điểm"); with a transcript that
 * has data ("bảng điểm có dữ liệu": its printed cumulative GPA was read), the base of every GPA, credit and học lực figure;
 * with a stored assessment, the base of every competency and fit figure (QA 2026-11-04: one rule, every figure says its base).
 */
export type ReportScope = { students: number; withTranscript: number; withData: number; assessed: number };

/** Common head of every report response. generatedAt: when the oldest student row used was computed. */
export type ReportHead = { generatedAt: string; studyTerm: ReportTerm | null; scope: ReportScope };

// ----------------------------------------------------------------- AD-REPORT-01 Tổng quan

export type DashboardKpis = ReportScope & {
  /** Mean of the printed cumulative GPA (hệ 4) of the transcripts with data (withData). */
  gpa: number | null;
  /** gpa minus the same mean one term earlier (each student's latest cumulative GPA up to that term). */
  gpaChange: number | null;
  gpaChangeFrom: ReportTerm | null;
  /** Mean Năng lực chung (0–100) of the latest stored assessments, with its level word (Xuất sắc…Yếu). */
  competency: number | null;
  competencyLevel: string | null;
  /** Mean fit score (0–100) with the target career, with its fit word (Rất phù hợp…Không phù hợp). */
  fit: number | null;
  fitLabel: string | null;
  /** Students whose "Cần chú ý" has a risk item / only warn items. */
  risk: number;
  warn: number;
};

/** Means over the transcripts with data; termStudents: those with a printed GPA for that term. */
export type GpaPoint = { term: ReportTerm; termGpa: number | null; termStudents: number; cumulativeGpa: number | null };

export type GpaBandLabel = "Xuất sắc" | "Giỏi" | "Khá" | "Trung bình" | "Yếu";
/**
 * Học lực by the printed cumulative GPA: Xuất sắc ≥ 3,60, Giỏi ≥ 3,20, Khá ≥ 2,50, Trung bình ≥ 2,00, Yếu below. The bands
 * add up to withData (every transcript with data, no other); withTranscript is the uploads they are taken from.
 */
export type GpaBands = { bands: { label: GpaBandLabel; range: string; students: number }[]; withTranscript: number; withData: number };

/** One row of "Bảng điểm trung bình": every figure says its base, and figures of one kind share it. */
export type AverageRow = {
  key: string;
  label: string;
  /** Students of the group with a stored transcript, and those whose transcript has data. */
  withTranscript: number;
  withData: number;
  /** Means over the withData transcripts only: printed cumulative GPA, latest printed term GPA, passed credits. */
  gpa: number | null;
  lastTermGpa: number | null;
  credits: number | null;
  /** withData transcripts whose cumulative GPA is under 2,00. */
  below2: number;
  /** Students of the group with a stored assessment: the base of competency and fit. */
  assessed: number;
  competency: number | null;
  competencyLevel: string | null;
  fit: number | null;
  fitLabel: string | null;
};
export type AverageTable = { by: "cohort" | "major" | "specialty"; rows: AverageRow[]; all: AverageRow };

export type SkillAverage = { name: string; group: string | null; score: number; students: number };
export type CompetencyGroups = {
  groups: { name: string; score: number | null; level: string | null; students: number }[];
  lowest: SkillAverage[];
  highest: SkillAverage[];
};

export type FitSummary = {
  average: number | null;
  label: string | null;
  levels: { label: string; students: number }[];
  careers: { name: string; students: number; average: number | null }[];
};

export type ProgressCounts = { total: number; onTrack: number; late: number; unknown: number; noTranscript: number };

export type DashboardReport = ReportHead & {
  kpis: CohortSplit<DashboardKpis>;
  gpaByTerm: CohortSplit<{ points: GpaPoint[] }>;
  gpaBands: CohortSplit<GpaBands>;
  averages: AverageTable[];
  competencyGroups: CohortSplit<CompetencyGroups>;
  fit: CohortSplit<FitSummary>;
  progress: CohortSplit<ProgressCounts>;
};

// ------------------------------------------------------- AD-REPORT-02/03 Tiến độ, 04/05 Nguy cơ

/** on_track / late as on the student's Tổng quan; unknown = no plan or specialty to compare with; no_transcript. */
export type ProgressStatus = "on_track" | "late" | "unknown" | "no_transcript";

export type ReportPage<T> = { items: T[]; total: number; page: number; pageSize: number };

export type ReportStudentBase = {
  userId: string;
  studentCode: string | null;
  name: string;
  cohort: string | null;
  majorName: string | null;
  specialtyName: string | null;
};

export type ProgressStudent = ReportStudentBase & {
  status: ProgressStatus;
  passedCredits: number | null;
  totalCredits: number | null;
  /** Credits the KHĐT plans up to the term before the one being studied. */
  expectedCredits: number | null;
  gpa: number | null;
  risk: "risk" | "warn" | null;
};

export type ProgressReport = ReportHead & {
  counts: CohortSplit<ProgressCounts>;
  page: ReportPage<ProgressStudent>;
};

export type RiskKind = "failed_course" | "pace" | "gpa_below" | "late_course" | "elective_short";
export type RiskItem = { kind: RiskKind; level: "risk" | "warn"; text: string };
export type RiskStudent = ReportStudentBase & { level: "risk" | "warn"; reasons: RiskItem[]; gpa: number | null };

export type RiskReport = ReportHead & {
  counts: CohortSplit<{ total: number; risk: number; warn: number }>;
  reasons: CohortSplit<{ items: { kind: RiskKind; label: string; students: number }[] }>;
  page: ReportPage<RiskStudent>;
};

// ------------------------------------------------------------- AD-REPORT-06/07 Kỹ năng còn thiếu

/** below = Dưới ngưỡng; not_studied = Chưa học or Sắp học; self_study = Cần tự học ngoài chương trình; no_data = Chưa có điểm. */
export type SkillGapStatus = "below" | "not_studied" | "self_study" | "no_data";
export type SkillGapRow = { name: string; below: number; notStudied: number; selfStudy: number; noData: number; total: number };

export type SkillsReport = ReportHead & {
  /** Target careers of the assessed students in scope, for the career selector. */
  careers: string[];
  /** Up to 12 skills missed most in the whole scope (fewer when fewer are missed); byCohort lists the same skills (same order) for each cohort. */
  skills: CohortSplit<{ items: SkillGapRow[] }>;
};

export type SkillStudent = ReportStudentBase & { careerName: string | null; status: SkillGapStatus; fitScore: number | null; fitLabel: string | null };
export type SkillStudents = { skill: string; items: SkillStudent[] };

// ------------------------------------------------------------- AD-REPORT-08 Vị trí nghề nghiệp mục tiêu

export type CareerRow = {
  name: string;
  students: number;
  average: number | null;
  /** Students per fit word, in the order Rất phù hợp, Phù hợp, Trung bình, Ít phù hợp, Không phù hợp. */
  levels: { label: string; students: number }[];
  topGaps: { name: string; students: number }[];
};
export type CareersReport = ReportHead & {
  /** Students with a transcript but no stored assessment (so no target career yet). */
  withoutCareer: number;
  careers: CohortSplit<{ items: CareerRow[] }>;
};

// ------------------------------------------------------------- AD-REPORT-09 Môn học được đề xuất

/** How Lộ trình AI proposed the course: study list = new; improve list = retake (not passed yet) or improve (passed). */
export type CourseHow = "new" | "retake" | "improve";
export type CourseRow = { code: string; name: string; newStudents: number; retake: number; improve: number; total: number };
export type CoursesReport = ReportHead & {
  /** Students in scope with a completed Lộ trình AI. */
  withRoadmap: number;
  courses: CohortSplit<{ items: CourseRow[] }>;
};
export type CourseStudent = ReportStudentBase & { how: CourseHow; gpa: number | null };
export type CourseStudents = { code: string; name: string; items: CourseStudent[] };

// ------------------------------------------------------------- AD-REPORT-11 Nhật ký thao tác

export type AuditKind = "account" | "training" | "career" | "competency" | "notify" | "report" | "access" | "advisor" | "other";
export type AuditEntry = { id: string; at: string; actorName: string; actorRole: string | null; kind: AuditKind; action: string; summary: string };
/** GET /api/admin/audit-log?q&kind&actor&page&pageSize (newest first, kept 1 year). */
export type AuditPage = ReportPage<AuditEntry> & { actors: string[] };
