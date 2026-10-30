/**
 * Tổng quan (STU-PROG-01…03, 2026-10-30): the API of GET /api/student/overview as the student page reads it. One request
 * builds the whole dashboard on the server (apps/api/src/overview): the printed transcript figures, the progress against
 * the cohort's training plan (kế hoạch đào tạo) term by term, the graduation check, the latest competency assessment, the
 * latest AI roadmap, the courses being studied, the "Cần chú ý" warnings and the suggested questions of Trợ lý AI.
 * Approved preview: https://claude.ai/code/artifact/e8499fd2-b393-45c5-a261-1fead4e09652 (user 2026-10-30: "Ok triển khai
 * đi"; notifications live only in the bell, "Cần chú ý" at the bottom).
 *
 * Every section is null when its data is missing; the page then shows that section's empty state. Numbers are numbers
 * (the page formats them, "2,85"); terms are HKyyS codes with a label. Errors: 401, 403 account_unavailable,
 * 503 database_required.
 */
export const OVERVIEW_API = "/api/student/overview";

/** A term: code "HK261" and label "HK1 2026–2027", the one way student pages write a term (display-format.ts termName). */
export type OverviewTerm = { code: string; label: string };

export type OverviewResponse = {
  generatedAt: string;
  profile: {
    cohortCode: string | null;
    /** "Công nghệ thông tin" (the major from the student code), null when unknown. */
    majorName: string | null;
    /** "Công nghệ phần mềm", null when not chosen. */
    specialtyName: string | null;
    /** The target career's Vietnamese name, null when not chosen. */
    careerName: string | null;
  };
  /** What the student has done (assistant/readiness.ts readReadiness): drives the empty states. */
  readiness: { transcript: boolean; specialty: boolean; career: boolean; survey: boolean; assessment: boolean; roadmap: boolean };
  terms: {
    /** The term being studied (studyTermCode of the transcript), null without a transcript. */
    studying: OverviewTerm | null;
    /** The next term of the term calendar (roadmap/window.ts TERM_CALENDAR) after today, with its dates. */
    next: (OverviewTerm & { start: string; end: string; daysUntil: number }) | null;
  };
  /** The transcript's printed figures (never recomputed), null without a transcript. */
  transcript: null | {
    updatedAt: string;
    /** Printed cumulative values of the latest graded term: "Điểm TB tích lũy (Hệ 4)" … "Xếp loại học tập tích lũy". */
    gpa4: number | null;
    gpa10: number | null;
    rank: string | null;
    credits: number | null;
    /** gpa4 minus the printed cumulative GPA of the graded term before it; null when either is missing. */
    gpaChange: number | null;
    /** Graded terms in order (no transfer section): printed term GPA and cumulative GPA on the 4-point scale. */
    series: { term: OverviewTerm; termGpa4: number | null; cumulativeGpa4: number | null }[];
  };
  /**
   * Progress against the cohort's training plan for the student's specialty (the engine's course states and planned
   * terms, computed live from the current transcript; no competency score is used). null without a transcript; blocked
   * when the plan cannot be read (the engine's AssessmentError code: specialty_required, curriculum_unavailable…).
   */
  progress: null | {
    blocked: string | null;
    /** Credits the programme requires (the graduation standard, else the CTĐT), null when unknown. */
    totalCredits: number | null;
    /** Credits of passed or exempt courses that count (condition-only courses excluded). */
    passedCredits: number;
    runningCredits: number;
    /** Credits of planned courses of terms before the studying one that are not passed (the engine's late entries). */
    lateCredits: number;
    /** totalCredits − passed − running, null without totalCredits. */
    remainingCredits: number | null;
    /** Terms of the training plan after the studying one, and remainingCredits spread over them (rounded up). */
    termsLeft: number | null;
    creditsPerTerm: number | null;
    /** The highest credits the plan itself puts in one of the remaining terms (for "nhiều hơn mức kế hoạch thường có"). */
    planMaxPerTerm: number | null;
    /** Every term of the training plan, in order, with its courses for the student's specialty. */
    terms: {
      term: OverviewTerm;
      /** done: every course passed; late: a term before the studying one with a course not passed; running: the studying term; planned: later. */
      state: "done" | "late" | "running" | "planned";
      passedCredits: number;
      plannedCredits: number;
      courses: {
        code: string; name: string; credits: number;
        state: "passed" | "failed" | "running" | "late" | "planned";
        /** What the page prints after the course: "B+", "cần học lại", "đang học lại", "dự kiến". */
        detail: string;
      }[];
    }[];
  };
  /** The graduation check of the student's own standard (as Điều kiện xét tốt nghiệp), null when it cannot be resolved. */
  graduation: null | {
    standardName: string;
    eligible: boolean;
    /** Conditions not met yet. */
    missing: number;
    conditions: {
      label: string;
      /** done/need for countable ones (unit "TC" or "môn"); met-only conditions have need null and done as printed text. */
      done: number | string;
      need: number | null;
      unit: "TC" | "môn" | "";
      met: boolean;
      /** "Còn: Phát triển ứng dụng di động, …" or null. */
      note: string | null;
    }[];
  };
  /**
   * The latest stored competency assessment (never computed here: an assessment needs the student's consent), null when
   * there is none or the consent was withdrawn.
   */
  competency: null | {
    assessedAt: string;
    overallScore: number | null;
    overallLevel: string | null;
    /**
     * The 3 best scored skills (condition-only groups excluded), each with the courses its score comes from (largest share
     * first, the CTĐT name and the letter that counts), shown beside the score.
     */
    strengths: { name: string; score: number; courses: { name: string; letter: string | null }[] }[];
    career: null | {
      name: string;
      fitScore: number | null;
      /** "Rất phù hợp", "Phù hợp", "Trung bình", "Ít phù hợp", "Không phù hợp" or "Chưa đủ dữ liệu". */
      fitLabel: string;
      met: number;
      total: number;
      /** Skills still missing for the career, as Khoảng trống kỹ năng labels them, worst first, at most 4. */
      gaps: { name: string; status: "below" | "upcoming" | "not_studied" | "self_study" | "no_data"; label: string }[];
    };
    /** The assessment predates the current transcript, specialty or target career: the page suggests Đánh giá lại. */
    stale: boolean;
  };
  /** The latest AI roadmap (completed, or the state of the one being written), null when none. */
  roadmap: null | {
    status: "completed" | "pending" | "failed";
    createdAt: string;
    /** The term the roadmap covers. */
    term: OverviewTerm | null;
    /** The courses it recommends, with the reason as a short label ("Học lại", "Trễ kế hoạch", "Theo kế hoạch", "Tự chọn TC309"). */
    courses: { code: string; name: string; credits: number; reason: string }[];
    /** Skills the roadmap suggests practising (its picks), not the program's "Kỹ năng cần tự học" of Khoảng trống kỹ năng. */
    skills: string[];
    /** The first month of its monthly plan: "Tháng 12/2026" and its text. */
    firstMonth: { label: string; text: string } | null;
    /**
     * The student's saved Kế hoạch học kỳ for that term, checked exactly as the planner checks it (credits of its courses
     * and of the courses being studied that term, against the limits): over / under the limits, ok, or empty. null when
     * the saved plan has no such term.
     */
    plan: { credits: number; status: "over" | "under" | "ok" | "empty" } | null;
    /** The planner's credits per term (min, max), null when the CTĐT is unknown. */
    limits: { min: number; max: number } | null;
  };
  /** Courses being studied in the studying term, with the skills they train (the faculty's course–skill links). */
  running: { code: string; name: string; credits: number; retake: boolean; skills: string[] }[];
  /**
   * "Cần chú ý" (STU-PROG-03), computed by the system (no AI) from the progress, the transcript and the graduation check.
   * level: the worst item, "ok" when nothing is wrong, "none" without enough data.
   */
  warnings: {
    level: "risk" | "warn" | "ok" | "none";
    items: OverviewWarning[];
  };
  /** Trợ lý AI's suggested questions for this student (assistant/readiness.ts suggestedQuestions), at most 6. */
  suggestions: string[];
};

/**
 * One warning. kind:
 * - failed_course: a mandatory course failed (F/VT/CT) with no passing attempt and not being retaken (risk);
 * - pace: the credits left need more per term than the plan's heaviest remaining term (risk);
 * - late_course: a planned course of an earlier term not taken yet (warn);
 * - elective_short: an elective group of the plan short of credits (warn);
 * - gpa_below: the cumulative GPA under the graduation minimum (risk);
 * - on_track: nothing wrong (ok);
 * - missing_data: progress cannot be computed (warn).
 * key: stable identity (course code, group code…), used to notify each warning once.
 * text: plain text, the names already in it; strong: the parts the page bolds (substrings of text).
 */
export type OverviewWarning = {
  level: "risk" | "warn" | "ok";
  kind: "failed_course" | "pace" | "late_course" | "elective_short" | "gpa_below" | "on_track" | "missing_data";
  key: string;
  text: string;
  strong: string[];
  /** A portal page to act on it ("#roadmap", "#profile"…) with its label, or null. */
  action: { label: string; link: string } | null;
};
