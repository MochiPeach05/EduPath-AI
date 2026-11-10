// Tổng quan (STU-PROG-01…03, 2026-10-30): the response of GET /api/student/overview. Mirror of the page's contract,
// apps/web/src/overview-types.ts, which documents every field; keep both in step.

/** A term: code "HK261" and label "HK1 2026–2027" (the one way student pages write a term, term-name.ts). */
export type OverviewTerm = { code: string; label: string };

export type OverviewWarningKind = "failed_course" | "pace" | "late_course" | "elective_short" | "gpa_below" | "on_track" | "missing_data";

export type OverviewWarning = {
  level: "risk" | "warn" | "ok";
  kind: OverviewWarningKind;
  key: string;
  text: string;
  strong: string[];
  action: { label: string; link: string } | null;
};

export type OverviewWarnings = { level: "risk" | "warn" | "ok" | "none"; items: OverviewWarning[] };

export type OverviewCourseState = "passed" | "failed" | "running" | "late" | "planned";
export type OverviewTermCourse = { code: string; name: string; credits: number; state: OverviewCourseState; detail: string };
export type OverviewProgressTerm = {
  term: OverviewTerm;
  state: "done" | "late" | "running" | "planned";
  passedCredits: number;
  /** "Tín chỉ học kỳ theo kế hoạch" of Kế hoạch đào tạo (planTermCredits), else the student's own courses of the term. */
  plannedCredits: number;
  /** Credits of the term late or failed ("còn nợ"); 0 from the term being studied on. */
  lateCredits: number;
  /** Credits of the term being studied ("đang học"): every course registered in the term being studied. */
  runningCredits: number;
  courses: OverviewTermCourse[];
};

/** passed + running + late + rest = total (the bar and its legend); remaining = late + rest, everything after this term. */
export type OverviewProgress = {
  blocked: string | null;
  totalCredits: number | null;
  passedCredits: number;
  runningCredits: number;
  lateCredits: number;
  restCredits: number | null;
  remainingCredits: number | null;
  termsLeft: number | null;
  creditsPerTerm: number | null;
  planMaxPerTerm: number | null;
  terms: OverviewProgressTerm[];
};

export type OverviewTranscript = {
  updatedAt: string;
  gpa4: number | null;
  studyGpa4: number | null;
  gpa10: number | null;
  rank: string | null;
  credits: number | null;
  gpaChange: number | null;
  series: { term: OverviewTerm; termGpa4: number | null; studyGpa4: number | null; cumulativeGpa4: number | null }[];
};

export type OverviewGraduation = {
  standardName: string;
  eligible: boolean;
  missing: number;
  conditions: { label: string; done: number | string; need: number | null; unit: "TC" | "môn" | ""; met: boolean; note: string | null }[];
};

export type OverviewGapStatus = "below" | "upcoming" | "not_studied" | "self_study" | "no_data";
export type OverviewCompetency = {
  assessedAt: string;
  overallScore: number | null;
  overallLevel: string | null;
  strengths: { name: string; score: number; courses: { name: string; letter: string | null }[] }[];
  career: null | {
    name: string;
    fitScore: number | null;
    fitLabel: string;
    met: number;
    total: number;
    gaps: { name: string; status: OverviewGapStatus; label: string }[];
  };
  stale: boolean;
};

export type OverviewRoadmap = {
  status: "completed" | "pending" | "failed";
  /** Why a failed roadmap failed (roadmap error_code); null otherwise, and from an older API. */
  errorCode?: string | null;
  createdAt: string;
  term: OverviewTerm | null;
  courses: { code: string; name: string; credits: number; reason: string }[];
  skills: string[];
  firstMonth: { label: string; text: string } | null;
  plan: OverviewTermLoad | null;
  limits: { min: number; max: number } | null;
  /** The Lộ trình AI tab's notes: made from an assessment other than the newest one; its window is over. */
  stale: boolean;
  ended: boolean;
  /**
   * While this roadmap is being written or failed: the newest completed one before it, shown dimmed until it is replaced
   * (2026-11-07, as the Lộ trình AI tab does); null otherwise.
   */
  previous?: PreviousRoadmapCard | null;
};
/** What the card shows of an earlier roadmap. */
export type PreviousRoadmapCard = Pick<OverviewRoadmap, "createdAt" | "term" | "courses" | "skills" | "firstMonth">;

/** A term of the saved Kế hoạch học kỳ as the planner checks it (credits against the limits per term). */
export type OverviewTermLoad = { credits: number; status: "over" | "under" | "ok" | "empty" };

/** conditionOnly: a GDTC/GDQP course, listed but counted in no credit total (comp-calc-v19). */
export type OverviewRunningCourse = { code: string; name: string; credits: number; retake: boolean; conditionOnly: boolean; skills: string[] };

export type OverviewReadiness = { transcript: boolean; specialty: boolean; career: boolean; survey: boolean; assessment: boolean; roadmap: boolean };

export type OverviewResponse = {
  generatedAt: string;
  profile: { cohortCode: string | null; majorName: string | null; specialtyName: string | null; careerName: string | null };
  readiness: OverviewReadiness;
  terms: {
    studying: OverviewTerm | null;
    next: (OverviewTerm & { start: string; end: string; daysUntil: number }) | null;
  };
  transcript: OverviewTranscript | null;
  progress: OverviewProgress | null;
  graduation: OverviewGraduation | null;
  competency: OverviewCompetency | null;
  roadmap: OverviewRoadmap | null;
  running: OverviewRunningCourse[];
  warnings: OverviewWarnings;
  suggestions: string[];
};
