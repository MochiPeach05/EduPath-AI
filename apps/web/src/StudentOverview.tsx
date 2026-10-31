import type { CareerSelection } from "./career-types";
import { useEffect, useState, type ReactNode } from "react";
import { queueAssistantQuestion } from "./assistant-handoff";
import { decimalText, meaningClass, meaningOf, scoreText, type Meaning } from "./display-format";
import { OVERVIEW_API, type OverviewResponse, type OverviewWarning } from "./overview-types";
import { PROFILE_SECTIONS, profileSectionOf, type ProfileSection } from "./student-overview-data";
import { SURVEY_API, gapSentence, surveyGaps, type SurveyResponse } from "./profile-survey";
import { Icon } from "./student-icons";
import "./student-overview.css";

// Tổng quan (STU-PROG-01…03, 2026-10-30; user: "Ok triển khai đi" on the approved preview
// https://claude.ai/code/artifact/e8499fd2-b393-45c5-a261-1fead4e09652): the student's dashboard from one request,
// GET /api/student/overview. Key figures first, then progress beside the graduation check, competency beside the GPA by
// term, this term beside the next one, a quick question to Trợ lý AI and "Cần chú ý" last. Notifications live only in
// the bell of the header (user: "thông báo xóa đi vì mình có cái icon chuông cái đó là thông báo rồi mà").

export type StudentProfile = {
  careerPositionId?: string | null; careerPosition?: CareerSelection | null;
  /** Ngành: the programme code of the MSSV (7480201 CNTT, 7480104 HTTT, 7480102 MMT&TTDL); absent on older APIs. */
  majorCode?: string | null;
  /** Chuyên ngành (CNPM/CNDL/TTNT; K27 còn có ANM); null = chưa xác định, absent on older APIs. */
  specialty?: string | null;
  name: string; studentCode: string | null; cohortCode: string | null;
  className: string | null; cohortYear: number | null; currentSemester: number | null;
  email: string | null; careerGoal: string | null; interests: string | null; profileStatus: string;
  /** When the profile survey ("Khảo sát định hướng") was saved; null when not yet. */
  surveyUpdatedAt?: string | null;
  /** The survey is complete (interests included) and agreed to under the current policy. */
  surveyComplete?: boolean;
  /** A transcript is stored. */
  hasTranscript?: boolean;
};

/**
 * What the profile needs before EduPath AI can help (user 2026-10-24: "mày muốn xài cái này là mày bắt buộc phải hoàn
 * thành phần này trước"): the same fields as the API's profileStatus "complete". surveyHint says what saved answers
 * still lack (surveyGaps), when known.
 */
export function requiredProfileItems(profile: StudentProfile | null, hasTranscript: boolean, surveyHint = "") {
  return [
    { id: "transcript", label: "Bảng điểm học tập", hint: "Tải lên bảng điểm PDF của bạn", done: hasTranscript },
    { id: "specialty", label: "Chuyên ngành", hint: "Chọn trong Mục tiêu học tập", done: Boolean(profile?.specialty) },
    { id: "career", label: "Nghề mục tiêu", hint: "Chọn trong Mục tiêu học tập hoặc Định hướng nghề nghiệp", done: Boolean(profile?.careerPositionId) },
    { id: "survey", label: "Khảo sát định hướng", hint: profile?.surveyUpdatedAt ? surveyHint || "Cập nhật các mục còn thiếu" : "Câu hỏi, thế mạnh, sở trường và thành tích", done: profile?.surveyComplete === true },
  ];
}

/**
 * After navigate("profile"): scrolls to a section of Hồ sơ và bảng điểm and moves focus to its heading. The survey and
 * the transcript load their own data and change the height of the page, so this waits until no section is busy (at
 * most 5 seconds), and gives up when the reader scrolls, taps or presses a key first.
 */
export function revealProfileSection(id: ProfileSection) {
  const deadline = performance.now() + 5000;
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of events) window.removeEventListener(type, stop, true);
  };
  const step = () => {
    const section = document.getElementById(id);
    const late = performance.now() > deadline;
    if (section && (late || !document.querySelector("main [aria-busy='true']"))) {
      stop();
      section.scrollIntoView({ block: "start" });
      section.querySelector<HTMLElement>("h2[tabindex]")?.focus({ preventScroll: true });
    } else if (late) stop();
    else frame = requestAnimationFrame(step);
  };
  for (const type of events) window.addEventListener(type, stop, { capture: true, passive: true });
  frame = requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ helpers (exported for the tests) */

/** The portal pages this page opens. */
export type OverviewPage = "profile" | "career" | "roadmap" | "competency" | "skill-gap" | "graduation" | "assistant" | "plans" | "curriculum";
const PAGES: readonly OverviewPage[] = ["profile", "career", "roadmap", "competency", "skill-gap", "graduation", "assistant", "plans", "curriculum"];
/** "#roadmap" → "roadmap"; anything that is not a page of the portal → null. */
export const pageOfLink = (link: string | null | undefined): OverviewPage | null => {
  const id = (link ?? "").replace(/^#/, "");
  return (PAGES as readonly string[]).includes(id) ? (id as OverviewPage) : null;
};

/** 2.85 → "2,85" (digits after the comma fixed). 0–100 scores use scoreText, as on the competency pages (59,86 → "59,8"). */
export const formatDecimal = (value: number, digits = 2) => decimalText(value, digits);

/** The cumulative GPA against the term before: "+0,03 so với học kỳ trước"; null without both values. */
export function gpaChangeText(change: number | null): string | null {
  if (change === null || !Number.isFinite(change)) return null;
  if (Math.abs(change) < 0.005) return "Không đổi so với học kỳ trước";
  return `${change > 0 ? "+" : "−"}${formatDecimal(Math.abs(change))} so với học kỳ trước`;
}

const vietnamDay = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
/** dd/MM/yyyy in Vietnam time. */
export const shortDate = (iso: string) => {
  const [year, month, day] = vietnamDay(new Date(iso)).split("-");
  return `${day}/${month}/${year}`;
};

type ProgressTerm = NonNullable<OverviewResponse["progress"]>["terms"][number];
/** "HK261" → school year "2026–2027", term 1. */
export const termYear = (code: string) => { const yy = Number(code.slice(2, 4)); return `${2000 + yy}–${2001 + yy}`; };
export const termNumber = (code: string) => Number(code.slice(4)) || 1;
/** The plan's terms grouped by school year, in order. */
export function termGroups(terms: readonly ProgressTerm[]): { year: string; terms: ProgressTerm[] }[] {
  const groups: { year: string; terms: ProgressTerm[] }[] = [];
  for (const term of terms) {
    const year = termYear(term.term.code);
    const last = groups.at(-1);
    if (last?.year === year) last.terms.push(term);
    else groups.push({ year, terms: [term] });
  }
  return groups;
}
/** The term opened first: the first late one, else the running one, else the last done, else the first. */
export function defaultTermCode(terms: readonly ProgressTerm[]): string | null {
  return (terms.find((term) => term.state === "late") ?? terms.find((term) => term.state === "running")
    ?? [...terms].reverse().find((term) => term.state === "done") ?? terms[0])?.term.code ?? null;
}
/** What a term chip says under the credits. */
export function termChip(term: ProgressTerm): { main: string; sub: string } {
  if (term.state === "running") return { main: `${term.plannedCredits} TC`, sub: "đang học" };
  if (term.state === "planned") return term.plannedCredits ? { main: `${term.plannedCredits} TC`, sub: "dự kiến" } : { main: "—", sub: "không có" };
  return { main: `${term.passedCredits}/${term.plannedCredits}`, sub: term.state === "late" ? "còn nợ" : "đủ" };
}

/** A warning's text with its strong parts marked (each first occurrence, left to right, never overlapping). */
export function emphasize(text: string, strong: readonly string[]): { text: string; strong: boolean }[] {
  const marks: [number, number][] = [];
  for (const part of strong) {
    if (!part) continue;
    const at = text.indexOf(part);
    if (at >= 0 && !marks.some(([start, end]) => at < end && at + part.length > start)) marks.push([at, at + part.length]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out: { text: string; strong: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of marks) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), strong: false });
    out.push({ text: text.slice(start, end), strong: true });
    cursor = end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), strong: false });
  return out;
}

/** The GPA chart's scale: from 1,5 (lower when a value is), to 4,0, a tick every 0,5. */
export function gpaScale(values: readonly (number | null)[]): { lo: number; hi: number; ticks: number[] } {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const lo = Math.max(0, Math.min(1.5, known.length ? Math.floor(Math.min(...known) * 2) / 2 : 1.5));
  const ticks: number[] = [];
  for (let tick = lo; tick <= 4 + 1e-9; tick += 0.5) ticks.push(Math.round(tick * 10) / 10);
  return { lo, hi: 4, ticks };
}

const BLOCKED: Record<string, string> = {
  transcript_required: "Bạn cần import bảng điểm để EduPath AI so tiến độ với kế hoạch đào tạo của khóa.",
  specialty_required: "Bạn cần chọn chuyên ngành để EduPath AI biết các môn của bạn trong kế hoạch đào tạo.",
  cohort_unknown: "Hồ sơ của bạn chưa có khóa học nên chưa so được tiến độ. Hãy liên hệ Khoa để cập nhật.",
  curriculum_unavailable: "Khoa chưa có chương trình đào tạo cho khóa của bạn nên chưa so được tiến độ.",
  curriculum_ambiguous: "Khóa của bạn đang có nhiều chương trình đào tạo nên chưa so được tiến độ. Hãy liên hệ Khoa.",
  plan_unavailable: "Khoa chưa có kế hoạch đào tạo cho khóa của bạn nên chưa so được tiến độ từng học kỳ.",
  competency_weights_unavailable: "Khoa chưa cấu hình học phần cho khóa của bạn nên chưa so được tiến độ.",
};
export const blockedText = (code: string) => BLOCKED[code] ?? "Chưa so được tiến độ với kế hoạch đào tạo. Vui lòng thử lại sau.";

type Tone = "" | "ok" | "warn" | "risk" | "ai";
/** A missing career skill: amber below the threshold; grey while it has no score yet (Sắp học, Chưa học, Cần tự học…). */
const gapMeaning = (status: string): Meaning => (status === "below" ? "warn" : "none");
/** The tone of a roadmap course's reason label. */
export const reasonTone = (reason: string): Tone =>
  /học lại/i.test(reason) ? "risk" : /trễ/i.test(reason) ? "warn" : /tự chọn/i.test(reason) ? "ai" : "";

type RoadmapInfo = NonNullable<OverviewResponse["roadmap"]>;
/**
 * The saved Kế hoạch học kỳ of the roadmap's term in the planner's words (study-plan-data.ts termLoadText): "20 TC · vượt
 * mức tối đa 18 TC" in amber, "6 TC · dưới mức tối thiểu 9 TC", else just the credits.
 */
export function planLoadText(plan: NonNullable<RoadmapInfo["plan"]>, limits: RoadmapInfo["limits"]): { text: string; meaning: Meaning } {
  const credits = `${plan.credits} TC`;
  if (plan.status === "over" && limits) return { text: `${credits} · vượt mức tối đa ${limits.max} TC`, meaning: "warn" };
  if (plan.status === "under" && limits) return { text: `${credits} · dưới mức tối thiểu ${limits.min} TC`, meaning: "warn" };
  return { text: credits, meaning: "none" };
}
/** "Lập trình ứng dụng Web (B), Thiết kế giao diện (B+) và 1 môn khác": the courses a score comes from. */
export function evidenceText(courses: readonly { name: string; letter: string | null }[], shown = 2): string {
  const named = courses.slice(0, shown).map((course) => (course.letter ? `${course.name} (${course.letter})` : course.name)).join(", ");
  return courses.length > shown ? `${named} và ${courses.length - shown} môn khác` : named;
}
const LEVEL: Record<OverviewResponse["warnings"]["level"], [string, string]> = {
  risk: ["risk", "▲ Nguy cơ chậm tiến độ"], warn: ["warn", "● Cần chú ý"], ok: ["ok", "✓ Đúng tiến độ"], none: ["none", "Chưa đủ dữ liệu"],
};

/* ------------------------------------------------------------------ view */

type Navigate = (page: OverviewPage) => void;
/** A chip in a tone of this page, or in the colour of a meaning shared by every student page (one colour per word). */
const Chip = ({ tone = "", meaning, children }: { tone?: Tone; meaning?: Meaning; children: ReactNode }) =>
  <span className={`ov-chip${meaning ? ` ${meaningClass(meaning)}` : tone ? ` ov-chip-${tone}` : ""}`}>{children}</span>;
const Empty = ({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) =>
  <div className="ov-empty"><p>{text}</p>{action && onAction && <button type="button" className="sw-text-link" onClick={onAction}>{action} <Icon name="arrow" /></button>}</div>;
const Head = ({ id, title, sub, children }: { id: string; title: string; sub?: ReactNode; children?: ReactNode }) =>
  <div className="ov-head"><div><h2 id={id}>{title}</h2>{sub && <p className="ov-sub">{sub}</p>}</div>{children}</div>;
/** Conditions not met yet are amber, never red: red is only for something not passed (user 2026-10-30). */
const GraduationChip = ({ graduation }: { graduation: NonNullable<OverviewResponse["graduation"]> }) =>
  graduation.eligible ? <Chip meaning="good">Đạt mọi điều kiện</Chip> : <Chip meaning="warn">Còn {graduation.missing} điều kiện</Chip>;

function Kpis({ data, navigate, openTranscript }: { data: OverviewResponse; navigate: Navigate; openTranscript: () => void }) {
  const { transcript, progress, competency, graduation, roadmap } = data;
  const tile = (key: string, label: string, value: ReactNode, foot: ReactNode, onClick: () => void) =>
    <button key={key} type="button" className="ov-kpi" onClick={onClick}><span className="ov-kpi-label">{label}</span><span className="ov-kpi-value">{value}</span><span className="ov-kpi-foot">{foot}</span></button>;
  const total = progress?.totalCredits ?? null;
  const passed = progress && !progress.blocked ? progress.passedCredits : transcript?.credits ?? null;
  const change = gpaChangeText(transcript?.gpaChange ?? null);
  const roadmapValue = !roadmap ? "Chưa có" : roadmap.status === "completed" ? "Đã có" : roadmap.status === "pending" ? "Đang soạn" : "Chưa soạn được";
  return <div className="ov-kpis">
    {tile("gpa", "GPA tích lũy", transcript?.gpa4 != null ? <>{formatDecimal(transcript.gpa4)}<small>/ 4</small></> : "—",
      transcript?.gpa4 != null ? <>{transcript.rank && <Chip meaning={meaningOf(transcript.rank)}>{transcript.rank}</Chip>}{change}
        {transcript.studyGpa4 != null && Math.abs(transcript.studyGpa4 - transcript.gpa4) >= 0.005 && <span title="Tính cả môn chưa đạt, như dòng in trên bảng điểm">Điểm TB học tập {formatDecimal(transcript.studyGpa4)}</span>}</> : "Cần bảng điểm", openTranscript)}
    {tile("credits", "Tín chỉ đã đạt", passed !== null ? <>{passed}{total !== null && <small>/ {total}</small>}</> : "—",
      passed !== null ? <>{total ? `${Math.round((passed / total) * 100)}% chương trình` : "Chưa rõ tổng tín chỉ"}{progress && !progress.blocked && progress.runningCredits > 0 ? ` · ${progress.runningCredits} TC đang học` : ""}</> : "Cần bảng điểm",
      () => navigate("roadmap"))}
    {tile("competency", "Năng lực chung", competency?.overallScore != null ? <>{scoreText(competency.overallScore)}<small>/ 100</small></> : "—",
      competency ? <>{competency.overallLevel && <Chip meaning={meaningOf(competency.overallLevel)}>{competency.overallLevel}</Chip>}</> : "Chưa đánh giá năng lực",
      () => navigate("competency"))}
    {tile("fit", "Mức phù hợp nghề", competency?.career?.fitScore != null ? <>{scoreText(competency.career.fitScore)}<small>/ 100</small></> : "—",
      competency?.career ? <><Chip meaning={meaningOf(competency.career.fitLabel)}>{competency.career.fitLabel}</Chip>{competency.career.met}/{competency.career.total} kỹ năng đạt ngưỡng</>
        : data.readiness.career ? "Chưa đánh giá năng lực" : "Chưa chọn nghề mục tiêu",
      () => navigate(competency?.career ? "skill-gap" : "career"))}
    {tile("graduation", "Xét tốt nghiệp", graduation ? graduation.eligible ? "Đủ điều kiện" : "Chưa đủ" : "—",
      graduation ? <GraduationChip graduation={graduation} /> : "Chưa đối chiếu được",
      () => navigate("graduation"))}
    {tile("roadmap", "Lộ trình AI", roadmapValue,
      roadmap ? <>{roadmap.term && <Chip tone="ai">{roadmap.term.label}</Chip>}</> : "Tạo ở Lộ trình học tập",
      () => navigate("roadmap"))}
  </div>;
}

function ProgressCard({ data, navigate, openTranscript }: { data: OverviewResponse; navigate: Navigate; openTranscript: () => void }) {
  const progress = data.progress;
  const [open, setOpen] = useState<string | null>(() => (progress && !progress.blocked ? defaultTermCode(progress.terms) : null));
  const head = <Head id="ov-progress-title" title="Tiến độ học tập" sub={data.profile.cohortCode && data.profile.specialtyName
    ? `So với kế hoạch đào tạo ${data.profile.cohortCode} ${data.profile.specialtyName}${progress?.totalCredits ? ` (${progress.totalCredits} tín chỉ)` : ""}`
    : "So với kế hoạch đào tạo của khóa bạn"}><button type="button" className="sw-text-link" onClick={() => navigate("roadmap")}>Xem chi tiết tiến độ <Icon name="arrow" /></button></Head>;
  if (!progress) return <section className="sw-panel ov-card" aria-labelledby="ov-progress-title">{head}<Empty text="Chưa có bảng điểm nên chưa tính được tiến độ." action="Import bảng điểm" onAction={openTranscript} /></section>;
  if (progress.blocked) return <section className="sw-panel ov-card" aria-labelledby="ov-progress-title">{head}<Empty text={blockedText(progress.blocked)} action={progress.blocked === "specialty_required" ? "Chọn chuyên ngành" : undefined} onAction={() => navigate("profile")} /></section>;
  const total = progress.totalCredits;
  const scale = Math.max(total ?? 0, progress.passedCredits + progress.runningCredits + progress.lateCredits, 1);
  const remaining = progress.remainingCredits;
  const rest = remaining === null ? null : Math.max(0, remaining - progress.lateCredits);
  const opened = progress.terms.find((term) => term.term.code === open) ?? null;
  return <section className="sw-panel ov-card" aria-labelledby="ov-progress-title">
    {head}
    <dl className="ov-metrics">
      <div><dt>Đã đạt</dt><dd>{progress.passedCredits}<small>TC</small></dd><span>{total ? `${Math.round((progress.passedCredits / total) * 100)}% chương trình` : "—"}</span></div>
      <div><dt>Đang học</dt><dd>{progress.runningCredits}<small>TC</small></dd><span>{data.running.length} môn học kỳ này</span></div>
      <div><dt>Trễ kế hoạch</dt><dd>{progress.lateCredits}<small>TC</small></dd><span>{progress.lateCredits ? "cần học bù" : "không có"}</span></div>
      <div><dt>Còn lại sau kỳ này</dt><dd>{remaining ?? "—"}<small>TC</small></dd><span>{progress.termsLeft !== null ? `${progress.termsLeft} kỳ${progress.creditsPerTerm !== null ? ` · ~${progress.creditsPerTerm} TC/kỳ` : ""}` : "—"}</span></div>
    </dl>
    <div className="ov-credits">
      <div className="ov-bar" role="img" aria-label={`${progress.passedCredits} tín chỉ đã đạt, ${progress.runningCredits} đang học, ${progress.lateCredits} trễ kế hoạch${rest !== null ? `, còn lại ${rest}` : ""}`}>
        <i className="ov-bar-done" style={{ width: `${(progress.passedCredits / scale) * 100}%` }} />
        <i className="ov-bar-run" style={{ width: `${(progress.runningCredits / scale) * 100}%` }} />
        {progress.lateCredits > 0 && <i className="ov-bar-late" style={{ width: `${(progress.lateCredits / scale) * 100}%` }} />}
      </div>
      <ul className="ov-legend">
        <li className="ov-legend-done">Đã đạt {progress.passedCredits} TC</li><li className="ov-legend-run">Đang học {progress.runningCredits} TC</li>
        {progress.lateCredits > 0 && <li className="ov-legend-late">Trễ kế hoạch {progress.lateCredits} TC</li>}
        {rest !== null && <li className="ov-legend-rest">Còn lại {rest} TC</li>}
      </ul>
    </div>
    {progress.terms.length > 0 && <div className="ov-terms-wrap">
      <p className="ov-sub">Theo từng học kỳ của kế hoạch đào tạo. Bấm một học kỳ để xem môn.</p>
      <div className="ov-years">{termGroups(progress.terms).map((group) => <div key={group.year} className="ov-year">
        <b>{group.year}</b>
        <div className="ov-year-terms">{group.terms.map((term) => {
          const chip = termChip(term);
          return <button key={term.term.code} type="button" className={`ov-term ov-term-${term.state}`} aria-pressed={open === term.term.code}
            aria-label={`${term.term.label}: ${chip.main} ${chip.sub}`} onClick={() => setOpen(term.term.code)}>
            <strong>HK{termNumber(term.term.code)}</strong>{chip.main}<em>{chip.sub}</em>
          </button>;
        })}</div>
      </div>)}</div>
      {opened && <div className="ov-term-detail" aria-live="polite"><b>{opened.term.label}</b>
        {opened.courses.length ? <ul className="ov-rows">{opened.courses.map((course) => <li key={course.code}>
          <span>{course.name} · {course.credits} TC</span>
          <span className={`ov-state ov-state-${course.state}`}>{course.state === "passed" ? "✓ " : ""}{course.detail}</span>
        </li>)}</ul> : <p className="ov-sub">Học kỳ này không có môn nào của chuyên ngành bạn.</p>}
      </div>}
    </div>}
  </section>;
}

function GraduationCard({ data, navigate }: { data: OverviewResponse; navigate: Navigate }) {
  const graduation = data.graduation;
  return <section className="sw-panel ov-card" aria-labelledby="ov-grad-title">
    <Head id="ov-grad-title" title="Xét tốt nghiệp" sub={graduation?.standardName ?? "Tiêu chuẩn của khóa và chuyên ngành"}>
      {graduation && <GraduationChip graduation={graduation} />}
    </Head>
    {!graduation ? <Empty text={data.readiness.transcript ? "Chưa đối chiếu được với tiêu chuẩn xét tốt nghiệp của khóa và chuyên ngành bạn. Lý do có ở trang Điều kiện xét tốt nghiệp." : "Cần bảng điểm và chuyên ngành để đối chiếu với tiêu chuẩn xét tốt nghiệp."} />
      : <ul className="ov-conds">{graduation.conditions.map((condition) => <li key={condition.label} className="ov-cond">
        <div className="ov-cond-top"><span>{condition.label}</span>{condition.need === null
          ? <span className={`ov-state ${condition.met ? "ov-state-passed" : "ov-state-failed"}`}>{condition.met ? "✓ " : "✗ "}{condition.done}</span>
          : <b>{condition.done}/{condition.need} {condition.unit}</b>}</div>
        {condition.need !== null && typeof condition.done === "number" && <div className={`ov-mini${condition.met ? "" : " ov-mini-warn"}`} role="img" aria-label={`${condition.done} trên ${condition.need} ${condition.unit}`}>
          <i style={{ width: `${Math.min(100, (condition.done / Math.max(condition.need, 1)) * 100)}%` }} />
        </div>}
        {condition.note && <small>{condition.note}</small>}
      </li>)}</ul>}
    <button type="button" className="sw-text-link ov-foot-link" onClick={() => navigate("graduation")}>Mở Điều kiện xét tốt nghiệp <Icon name="arrow" /></button>
  </section>;
}

function SkillsCard({ data, navigate }: { data: OverviewResponse; navigate: Navigate }) {
  const competency = data.competency;
  return <section className="sw-panel ov-card" aria-labelledby="ov-skill-title">
    <Head id="ov-skill-title" title="Năng lực và nghề mục tiêu" sub={competency && data.profile.careerName ? `Nghề mục tiêu: ${data.profile.careerName}` : "Từ lần Đánh giá năng lực mới nhất"}>
      <button type="button" className="sw-text-link" onClick={() => navigate("skill-gap")}>Khoảng trống kỹ năng <Icon name="arrow" /></button>
    </Head>
    {!competency ? <Empty text="Bạn chưa có kết quả Đánh giá năng lực." action="Đánh giá năng lực" onAction={() => navigate("competency")} /> : <>
      {competency.stale && <p className="ov-stale">Kết quả này có trước lần bạn đổi bảng điểm hoặc hồ sơ. <button type="button" className="sw-text-link" onClick={() => navigate("competency")}>Đánh giá lại</button></p>}
      <div className="ov-skill-cols">
        <div className="ov-meters"><b>Kỹ năng mạnh nhất</b>
          {competency.strengths.length ? competency.strengths.map((skill) => <div key={skill.name} className="ov-meter">
            <div className="ov-meter-top"><span>{skill.name}</span><b>{scoreText(skill.score)}</b></div>
            <div className="ov-track" role="img" aria-label={`${skill.name}: ${scoreText(skill.score)} điểm, ngưỡng Khá 62,5`}><i style={{ width: `${Math.min(100, skill.score)}%` }} /><u style={{ left: "62.5%" }} /></div>
            {skill.courses?.length > 0 && <small className="ov-evidence">Minh chứng: {evidenceText(skill.courses)}</small>}
          </div>) : <p className="ov-sub">Chưa có kỹ năng nào có điểm.</p>}
          {competency.strengths.length > 0 && <small className="ov-sub">Vạch đen: ngưỡng Khá (62,5)</small>}
        </div>
        <div className="ov-gaps"><b>Còn thiếu cho nghề mục tiêu</b>
          {!competency.career ? <p className="ov-sub">Bạn chưa chọn nghề mục tiêu.</p>
            : competency.career.gaps.length ? <ul className="ov-rows">{competency.career.gaps.map((gap) => <li key={gap.name}><span>{gap.name}</span><Chip meaning={gapMeaning(gap.status)}>{gap.label}</Chip></li>)}</ul>
              : <p className="ov-sub">Bạn đã đạt mọi kỹ năng của nghề này.</p>}
        </div>
      </div>
      {competency.career && <div className="ov-fit"><span>Mức phù hợp với <b>{competency.career.name}</b>:</span>
        <span className="ov-fit-score">{competency.career.fitScore !== null ? scoreText(competency.career.fitScore) : "—"}</span><Chip meaning={meaningOf(competency.career.fitLabel)}>{competency.career.fitLabel}</Chip>
        <span className="ov-sub">{competency.career.met}/{competency.career.total} kỹ năng đạt ngưỡng</span></div>}
    </>}
  </section>;
}

const CHART = { width: 560, height: 230, left: 36, right: 82, top: 14, bottom: 44 };
/**
 * The width a chart frame has on screen (ResizeObserver), so the SVG is drawn at that width and its text keeps the
 * page's sizes: scaled from a fixed 560-wide drawing, the axis read about 7 px in a narrow column (user 2026-10-30:
 * "chú thích tối thiểu 12px"). null before the first measure and where nothing can measure (server rendering, tests).
 */
function useFrameWidth(): [(element: HTMLDivElement | null) => void, number | null] {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);
  return [setFrame, width];
}

function GpaChart({ data, openTranscript }: { data: OverviewResponse; openTranscript: () => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [frameRef, frameWidth] = useFrameWidth();
  const series = data.transcript?.series ?? [];
  // The three averages every term of the transcript prints, as printed (user 2026-10-31: "hãy xem cách tính của bảng điểm
  // thật và học theo"): Điểm TB học kỳ counts that term with its failed courses, Điểm TB học tập every registered credit
  // so far with the failed courses, Điểm TB tích lũy only the courses passed, so it barely moves when courses are failed.
  const hasStudy = series.some((point) => point.studyGpa4 !== null);
  const head = <Head id="ov-gpa-title" title="Điểm trung bình theo học kỳ" sub="Hệ 4, chép đúng các dòng tổng kết in trên bảng điểm" />;
  if (series.length < 2) {
    return <section className="sw-panel ov-card" aria-labelledby="ov-gpa-title">{head}
      <Empty text={data.transcript ? "Cần ít nhất 2 học kỳ có điểm để vẽ biểu đồ." : "Chưa có bảng điểm nên chưa vẽ được điểm theo học kỳ."} action={data.transcript ? undefined : "Import bảng điểm"} onAction={openTranscript} />
    </section>;
  }
  const { height: H, left: L, right: R, top: T, bottom: B } = CHART;
  const W = frameWidth ?? CHART.width;
  const { lo, hi, ticks } = gpaScale(series.flatMap((point) => [point.termGpa4, point.studyGpa4, point.cumulativeGpa4]));
  const last = series.length - 1;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(last, 1);
  const y = (value: number) => T + ((hi - value) * (H - T - B)) / (hi - lo);
  const path = (pick: (point: typeof series[number]) => number | null) => {
    let d = "", pen = false;
    series.forEach((point, i) => {
      const value = pick(point);
      if (value === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(value).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  const cumulative = (point: typeof series[number]) => point.cumulativeGpa4;
  const study = (point: typeof series[number]) => point.studyGpa4;
  const term = (point: typeof series[number]) => point.termGpa4;
  const lastCum = series[last]!.cumulativeGpa4, lastTerm = series[last]!.termGpa4;
  // End labels of the last term, top to bottom, at least 14px apart so they never overlap.
  const endLabels = ([["cum", series[last]!.cumulativeGpa4, "tích lũy"], ["study", series[last]!.studyGpa4, "học tập"], ["term", lastTerm, "học kỳ"]] as const)
    .flatMap(([key, value, word]) => value === null ? [] : [{ key, value, word, at: y(value) }])
    .sort((a, b) => a.at - b.at);
  endLabels.forEach((label, i) => { if (i > 0) label.at = Math.max(label.at, endLabels[i - 1]!.at + 14); });
  const step = (W - L - R) / Math.max(last, 1);
  const groups = termGroups(series.map((point) => ({ term: point.term, state: "done" as const, passedCredits: 0, plannedCredits: 0, courses: [] })));
  let index = 0;
  const yearLabels = groups.map((group) => {
    const middle = index + (group.terms.length - 1) / 2;
    index += group.terms.length;
    return { year: group.year, x: L + (middle * (W - L - R)) / Math.max(last, 1) };
  });
  const point = hover === null ? null : series[hover] ?? null;
  return <section className="sw-panel ov-card" aria-labelledby="ov-gpa-title">
    {head}
    <ul className="ov-chart-legend">
      <li><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" className="ov-line-cum" /></svg>Điểm TB tích lũy (chỉ tính môn đã đạt)</li>
      {hasStudy && <li><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" className="ov-line-study" /></svg>Điểm TB học tập (tính cả môn chưa đạt)</li>}
      <li><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" className="ov-line-term" /></svg>Điểm TB học kỳ (riêng từng học kỳ)</li>
      {lo <= 2 && <li><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" className="ov-line-limit" /></svg>Ngưỡng tốt nghiệp 2,00</li>}
    </ul>
    <div className="ov-chart" ref={frameRef} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: `${W} / ${H}` }} role="img" aria-label={`Điểm trung bình hệ 4 qua ${series.length} học kỳ có điểm.${lastCum !== null ? ` Điểm TB tích lũy hiện tại ${formatDecimal(lastCum)}.` : ""}${series[last]!.studyGpa4 !== null ? ` Điểm TB học tập ${formatDecimal(series[last]!.studyGpa4!)}.` : ""}${lastTerm !== null ? ` Học kỳ gần nhất ${formatDecimal(lastTerm)}.` : ""}`}>
        {ticks.map((tick) => <g key={tick}><line x1={L} x2={W - R} y1={y(tick)} y2={y(tick)} className="ov-gridline" />
          <text x={L - 8} y={y(tick) + 4} textAnchor="end" className="ov-axis">{formatDecimal(tick, 1)}</text></g>)}
        {lo <= 2 && <line x1={L} x2={W - R} y1={y(2)} y2={y(2)} className="ov-line-limit" />}
        <path d={path(term)} className="ov-line-term" fill="none" />
        {hasStudy && <path d={path(study)} className="ov-line-study" fill="none" />}
        <path d={path(cumulative)} className="ov-line-cum" fill="none" />
        {series.map((item, i) => item.termGpa4 !== null && <circle key={`t${i}`} cx={x(i)} cy={y(item.termGpa4)} r={4} className="ov-dot-term" />)}
        {series.map((item, i) => item.studyGpa4 !== null && <circle key={`s${i}`} cx={x(i)} cy={y(item.studyGpa4)} r={4} className="ov-dot-study" />)}
        {series.map((item, i) => item.cumulativeGpa4 !== null && <circle key={`c${i}`} cx={x(i)} cy={y(item.cumulativeGpa4)} r={4} className="ov-dot-cum" />)}
        {endLabels.map((label) => <text key={label.key} x={x(last) + 10} y={label.at + 4} className={`ov-end-label${label.key === "cum" ? " ov-end-strong" : ""}`}>{formatDecimal(label.value)} {label.word}</text>)}
        {series.map((item, i) => <text key={`x${i}`} x={x(i)} y={H - B + 18} textAnchor="middle" className="ov-axis">HK{termNumber(item.term.code)}</text>)}
        {yearLabels.map((label) => <text key={label.year} x={label.x} y={H - B + 34} textAnchor="middle" className="ov-axis ov-axis-year">{label.year}</text>)}
        {point && <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={H - B} className="ov-cross" />}
        {series.map((_, i) => <rect key={`h${i}`} x={x(i) - step / 2} y={T} width={step} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />)}
      </svg>
      {point && hover !== null && <div className="ov-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(Math.min(...[point.cumulativeGpa4, point.studyGpa4, point.termGpa4].filter((v): v is number => v !== null).map(y), H - B) / H) * 100}%` }}>
        <b>{point.term.label}</b><br />Điểm TB học kỳ {point.termGpa4 !== null ? formatDecimal(point.termGpa4) : "—"}
        {hasStudy && <><br />Điểm TB học tập {point.studyGpa4 !== null ? formatDecimal(point.studyGpa4) : "—"}</>}
        <br />Điểm TB tích lũy {point.cumulativeGpa4 !== null ? formatDecimal(point.cumulativeGpa4) : "—"}
      </div>}
    </div>
    <details className="ov-data"><summary>Xem bảng số liệu</summary>
      <p className="ov-note">Chép đúng các dòng "Hệ 4" in cuối mỗi học kỳ trên bảng điểm. Điểm TB học kỳ: riêng học kỳ đó, kể cả môn chưa đạt. Điểm TB học tập: mọi tín chỉ đã đăng ký đến học kỳ đó, kể cả môn chưa đạt. Điểm TB tích lũy: chỉ các môn đã đạt, nên ít thay đổi khi có môn rớt.</p>
      <div className="ov-table-wrap"><table><thead><tr><th scope="col">Học kỳ</th><th scope="col">Điểm TB học kỳ</th>{hasStudy && <th scope="col">Điểm TB học tập</th>}<th scope="col">Điểm TB tích lũy</th></tr></thead>
        <tbody>{series.map((item) => <tr key={item.term.code}><td>{item.term.label}</td><td className="ov-num">{item.termGpa4 !== null ? formatDecimal(item.termGpa4) : "—"}</td>{hasStudy && <td className="ov-num">{item.studyGpa4 !== null ? formatDecimal(item.studyGpa4) : "—"}</td>}<td className="ov-num">{item.cumulativeGpa4 !== null ? formatDecimal(item.cumulativeGpa4) : "—"}</td></tr>)}</tbody>
      </table></div>
    </details>
  </section>;
}

function NowCard({ data, openTranscript }: { data: OverviewResponse; openTranscript: () => void }) {
  const running = data.running;
  const credits = running.reduce((sum, course) => sum + course.credits, 0);
  return <div className="ov-half" role="group" aria-labelledby="ov-now-title">
    <Head id="ov-now-title" title="Học kỳ này" sub={data.terms.studying?.label ?? "Theo bảng điểm bạn đã import"}>{running.length > 0 && <Chip tone="ai">{running.length} môn · {credits} TC</Chip>}</Head>
    {!data.readiness.transcript ? <Empty text="Import bảng điểm để xem các môn bạn đang học." action="Import bảng điểm" onAction={openTranscript} />
      : !running.length ? <Empty text="Bảng điểm của bạn chưa có môn nào đang học." />
        : <>{running.map((course) => <div key={course.code} className="ov-course">
          <div className="ov-course-top"><span>{course.name}</span><span className="ov-state ov-state-running">{course.retake ? "đang học lại" : "đang học"} · {course.credits} TC</span></div>
          {course.skills.length > 0 && <small>Rèn luyện: {course.skills.join(", ")}</small>}
        </div>)}<p className="ov-note">Học xong các môn này, kỹ năng "Sắp học" sẽ có điểm ở lần Đánh giá lại.</p></>}
  </div>;
}

/**
 * "Học kỳ tới · theo Lộ trình AI": the AI roadmap's courses for the next term, named by their source because Đánh giá
 * năng lực lists the next term of the training plan (user 2026-10-30: "Nên đặt tên phân biệt hai cái"). The saved Kế
 * hoạch học kỳ of that term is checked against the planner's limits in the planner's words; the green "20/16 TC" bar is
 * gone ("Tổng quan ghi 20/16 TC … planner báo vượt tối đa 18 TC").
 */
function NextCard({ data, navigate }: { data: OverviewResponse; navigate: Navigate }) {
  const roadmap = data.roadmap;
  const next = data.terms.next;
  const sub = roadmap?.term?.label ?? (next ? `${next.label} · ${shortDate(next.start)} – ${shortDate(next.end)}` : "Học kỳ tới");
  const credits = roadmap?.courses.reduce((sum, course) => sum + course.credits, 0) ?? 0;
  const limits = roadmap?.limits ?? null;
  const aiOver = limits !== null && credits > limits.max;
  const chip = !roadmap ? null : roadmap.status === "completed" ? (roadmap.courses.length ? <Chip tone="ai">{roadmap.courses.length} môn · {credits} TC</Chip> : null)
    : roadmap.status === "pending" ? <Chip tone="ai">Đang soạn</Chip> : <Chip meaning="warn">Chưa soạn được</Chip>;
  const plan = roadmap?.plan && roadmap.plan.status !== "empty" ? roadmap.plan : null;
  const load = plan ? planLoadText(plan, limits) : null;
  let body: ReactNode;
  if (!roadmap || roadmap.status !== "completed") {
    const text = roadmap?.status === "pending" ? "EduPath AI đang soạn lộ trình cho học kỳ tới, bạn quay lại sau ít phút nhé."
      : roadmap?.status === "failed" ? "Lần soạn lộ trình gần nhất chưa xong. Bạn bấm Tạo lại ở Lộ trình học tập."
        : !data.readiness.assessment ? "Lộ trình AI cần kết quả Đánh giá năng lực và Khảo sát định hướng."
          : !data.readiness.survey ? "Bạn hoàn thành Khảo sát định hướng để tạo Lộ trình AI cho học kỳ tới."
            : "Bạn chưa tạo Lộ trình AI cho học kỳ tới.";
    body = <Empty text={text} action={!data.readiness.assessment ? "Đánh giá năng lực" : !data.readiness.survey ? "Làm khảo sát" : "Mở Lộ trình học tập"}
      onAction={() => navigate(!data.readiness.assessment ? "competency" : !data.readiness.survey ? "profile" : "roadmap")} />;
  } else {
    body = <>
      {roadmap.courses.length ? <ul className="ov-rows ov-next-courses">{roadmap.courses.map((course) => <li key={course.code}><span>{course.name} · {course.credits} TC</span><Chip tone={reasonTone(course.reason)}>{course.reason}</Chip></li>)}</ul>
        : <p className="ov-sub">Lộ trình không đề xuất thêm môn nào.</p>}
      {/* The roadmap's own picks to practise; "Kỹ năng cần tự học" of Khoảng trống kỹ năng are the skills the program
          does not teach, so the two never read as a contradiction (user 2026-10-30). */}
      {roadmap.skills.length > 0 && <div className="ov-tags"><span className="ov-sub">Lộ trình AI gợi ý luyện thêm:</span>{roadmap.skills.map((skill) => <Chip key={skill}>{skill}</Chip>)}</div>}
      {roadmap.firstMonth && <div className="ov-month"><b>{roadmap.firstMonth.label}:</b> {roadmap.firstMonth.text}</div>}
      {plan && load ? <div className="ov-load">
        <div className="ov-load-top"><span>Kế hoạch học kỳ của bạn</span><Chip meaning={load.meaning}>{load.text}</Chip></div>
        {limits && <small>Mức cho phép: {limits.min}–{limits.max} TC mỗi học kỳ, như trong Kế hoạch học kỳ.</small>}
      </div>
        : credits > 0 && <p className={`ov-note${aiOver ? " ov-note-warn" : ""}`}>{aiOver
          ? `Lộ trình đề xuất ${credits} TC, vượt mức tối đa ${limits!.max} TC mỗi học kỳ. Khi xếp vào Kế hoạch học kỳ, bạn giữ lại các môn cần nhất.`
          : "Bạn chưa xếp các môn này vào Kế hoạch học kỳ."}</p>}
      <button type="button" className="sw-text-link ov-foot-link" onClick={() => navigate("roadmap")}>Mở Lộ trình AI đề xuất <Icon name="arrow" /></button>
    </>;
  }
  return <div className="ov-half" role="group" aria-labelledby="ov-next-title">
    <Head id="ov-next-title" title="Học kỳ tới · theo Lộ trình AI" sub={sub}>{chip}</Head>
    {body}
  </div>;
}

/** "Học kỳ này" beside "Học kỳ tới" in one card, so the two never leave a gap beside each other. */
function TermsCard({ data, navigate, openTranscript }: { data: OverviewResponse; navigate: Navigate; openTranscript: () => void }) {
  return <section className="sw-panel ov-card" aria-label="Học kỳ này và học kỳ tới">
    <div className="ov-halves"><NowCard data={data} openTranscript={openTranscript} /><NextCard data={data} navigate={navigate} /></div>
  </section>;
}

function AskCard({ suggestions, navigate }: { suggestions: readonly string[]; navigate: Navigate }) {
  const [question, setQuestion] = useState("");
  const ask = (text: string) => {
    if (!text.trim()) return;
    queueAssistantQuestion(text);
    navigate("assistant");
  };
  return <section className="sw-panel ov-card" aria-labelledby="ov-ask-title">
    <Head id="ov-ask-title" title="Hỏi nhanh Trợ lý AI" sub="Trợ lý trả lời từ bảng điểm, kết quả đánh giá và lộ trình của bạn." />
    <form className="ov-ask" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
      <label htmlFor="ov-ask-input" className="sr-only">Câu hỏi cho Trợ lý AI</label>
      <input id="ov-ask-input" value={question} maxLength={1000} placeholder="Ví dụ: Học kỳ tới mình nên đăng ký những môn nào?" onChange={(event) => setQuestion(event.target.value)} />
      <button type="submit" className="sw-primary" disabled={!question.trim()}>Hỏi</button>
    </form>
    {suggestions.length > 0 && <div className="ov-sugs" role="group" aria-label="Câu hỏi gợi ý">{suggestions.map((text) => <button key={text} type="button" onClick={() => ask(text)}>{text}</button>)}</div>}
  </section>;
}

function WarningsCard({ warnings, navigate }: { warnings: OverviewResponse["warnings"]; navigate: Navigate }) {
  const [tone, label] = LEVEL[warnings.level];
  const icon = (item: OverviewWarning) => (item.level === "ok" ? "✓" : item.level === "risk" ? "!" : "i");
  return <section className="sw-panel ov-card" aria-labelledby="ov-warn-title">
    <Head id="ov-warn-title" title="Cần chú ý"><span className={`ov-level ov-level-${tone}`}>{label}</span></Head>
    {warnings.items.length ? <ul className="ov-warnings">{warnings.items.map((item) => {
      const page = pageOfLink(item.action?.link);
      return <li key={`${item.kind}:${item.key}`} className={`ov-warning ov-warning-${item.level}`}>
        <span className="ov-warning-icon" aria-hidden="true">{icon(item)}</span>
        <div><p>{emphasize(item.text, item.strong).map((part, index) => part.strong ? <b key={index}>{part.text}</b> : <span key={index}>{part.text}</span>)}</p>
          {item.action && page && <button type="button" className="sw-text-link" onClick={() => navigate(page)}>{item.action.label} <Icon name="arrow" /></button>}</div>
      </li>;
    })}</ul> : <Empty text="Chưa đủ dữ liệu để kiểm tra tiến độ." />}
    <p className="ov-note">Tính từ bảng điểm và kế hoạch đào tạo của khóa bạn. Chỉ để tham khảo, không thay cho cảnh báo học vụ của trường.</p>
  </section>;
}

/** The dashboard once GET /api/student/overview answered (exported for the tests). */
export function OverviewDashboard({ data, navigate, openTranscript }: { data: OverviewResponse; navigate: Navigate; openTranscript: () => void }) {
  return <>
    <Kpis data={data} navigate={navigate} openTranscript={openTranscript} />
    {/* Two columns that stack on their own (user 2026-10-30: "cách bố cục cứ xấu xấu"): cards of one row no longer leave
        a gap beside a shorter neighbour. Full-width sections end the page, "Cần chú ý" last. */}
    <div className="ov-columns">
      <div className="ov-col">
        <ProgressCard data={data} navigate={navigate} openTranscript={openTranscript} />
        <TermsCard data={data} navigate={navigate} openTranscript={openTranscript} />
      </div>
      <div className="ov-col">
        <GraduationCard data={data} navigate={navigate} />
        <SkillsCard data={data} navigate={navigate} />
        <GpaChart data={data} openTranscript={openTranscript} />
      </div>
    </div>
    <AskCard suggestions={data.suggestions} navigate={navigate} />
    <WarningsCard warnings={data.warnings} navigate={navigate} />
  </>;
}

async function readOverview(signal: AbortSignal): Promise<OverviewResponse> {
  const response = await fetch(OVERVIEW_API, { credentials: "include", cache: "no-store", signal });
  if (response.status === 401) {
    window.dispatchEvent(new Event("edupath-session-expired"));
    throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  }
  if (!response.ok) throw new Error("Chưa tải được trang Tổng quan. Vui lòng thử lại.");
  return response.json() as Promise<OverviewResponse>;
}

export default function StudentOverview({ profile, loading: profileLoading, navigate, identity }: {
  profile: StudentProfile | null; loading: boolean;
  navigate: (page: OverviewPage) => void;
  /** The student's identity strip, shown above the required-profile notice (user 2026-10-24: under the account name). */
  identity: ReactNode;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    readOverview(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Chưa tải được trang Tổng quan."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  // Saved answers that no longer count (a newer question set or policy): the gate says what is missing.
  const surveyOutdated = Boolean(profile?.surveyUpdatedAt) && profile?.surveyComplete === false;
  const [surveyHint, setSurveyHint] = useState("");
  useEffect(() => {
    setSurveyHint("");
    if (!surveyOutdated) return;
    const controller = new AbortController();
    fetch(SURVEY_API, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<SurveyResponse> : null)
      .then(data => { if (data && !controller.signal.aborted) setSurveyHint(gapSentence(surveyGaps(data.questions, data.survey, data.consentVersion))); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [surveyOutdated]);
  const hasTranscript = data ? data.readiness.transcript : profile?.hasTranscript === true;
  const checklist = requiredProfileItems(profile, hasTranscript, surveyHint);
  const ready = checklist.filter(item => item.done).length;
  const readyKnown = !profileLoading && profile !== null && (data !== null || profile.hasTranscript !== undefined);
  const missing = checklist.length - ready;
  const openProfile = (section?: ProfileSection) => {
    navigate("profile");
    if (section) revealProfileSection(section);
  };
  // "Hoàn thành hồ sơ" opens the first missing item; "Import bảng điểm" the transcript.
  const firstMissing = readyKnown ? checklist.find(item => !item.done) : undefined;
  const completeProfile = () => openProfile(firstMissing && profileSectionOf(firstMissing.id));
  const openTranscript = () => openProfile(PROFILE_SECTIONS.transcript);
  return <div className="so-overview ov-page">
    {identity}
    {readyKnown && missing > 0 && <section className="so-gate" aria-labelledby="so-gate-title">
      <span className="so-gate-icon" aria-hidden="true"><Icon name="shield" /></span>
      <div className="so-gate-body">
        <p className="so-gate-kicker">BẮT BUỘC TRƯỚC KHI SỬ DỤNG</p>
        <h2 id="so-gate-title">Hoàn thành Hồ sơ và bảng điểm để EduPath AI hỗ trợ bạn</h2>
        <p>Bạn vui lòng cung cấp đầy đủ các mục thông tin dưới đây để kết quả đánh giá được chính xác. Nếu có sự thay đổi, bạn có thể điều chỉnh lại các thông tin này trong tương lai.</p>
        <ol className="so-gate-steps">{checklist.map((item, index) => <li key={item.id} className={item.done ? "is-done" : undefined}>
          <span className="so-gate-check" aria-hidden="true">{item.done ? <Icon name="check" /> : index + 1}</span>
          <span><strong>{item.label}</strong><small>{item.done ? "Đã hoàn thành" : item.hint}</small></span>
          <span className="sr-only">{item.done ? "Đã hoàn thành" : "Chưa hoàn thành"}</span>
        </li>)}</ol>
      </div>
      <div className="so-gate-actions">
        <span className="so-gate-count" aria-hidden="true">{ready}/{checklist.length}</span>
        <button className="sw-primary so-gate-button" onClick={completeProfile}>Hoàn thành hồ sơ ngay <Icon name="arrow" /></button>
      </div>
    </section>}
    {loading && !data ? <div className="ov-loading" role="status" aria-busy="true"><span className="sr-only">Đang tải trang Tổng quan…</span><div className="ov-skel ov-skel-kpis" /><div className="ov-skel" /><div className="ov-skel" /></div>
      : error && !data ? <section className="sw-panel ov-error" role="alert"><h2>{error}</h2><p className="ov-sub">Bạn có thể thử lại để xem tiến độ học tập.</p>
        <button type="button" className="sw-outline" onClick={() => setReload(value => value + 1)}><Icon name="refresh" />Thử lại</button></section>
        : data ? <OverviewDashboard data={data} navigate={navigate} openTranscript={openTranscript} /> : null}
  </div>;
}
