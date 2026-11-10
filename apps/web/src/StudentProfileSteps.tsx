import { isAdvisorView } from "./advisor-view";
import { requiredProfileItems, revealProfileSection, type StudentProfile } from "./StudentOverview";
import { TRANSCRIPT_UPDATED_EVENT, profileSectionOf, type ProfileSection } from "./student-overview-data";
import { Icon } from "./student-icons";
import "./student-profile-steps.css";

// Hồ sơ và bảng điểm (2026-11-04): the page was long and plain, and students who filled in the cards at its top did not
// see where to import the transcript. These four steps open the page: the items of the Tổng quan gate, in its order and
// words (requiredProfileItems), each a button that scrolls to the section where it is filled in (revealProfileSection).
// A green check marks a step done; the first missing one is the next step, with a short action. Once all four are done
// the bar folds into one quiet line.

/**
 * Window event of StudentTranscript after an import finished (saved at once or read by the worker) and after the
 * transcript was deleted. The shell reads the profile again, so the steps follow profile.hasTranscript.
 */
export { TRANSCRIPT_UPDATED_EVENT };

/** Calls listener on every TRANSCRIPT_UPDATED_EVENT; returns the way to stop listening (the cleanup of a useEffect). */
export function onTranscriptUpdated(listener: () => void): () => void {
  window.addEventListener(TRANSCRIPT_UPDATED_EVENT, listener);
  return () => window.removeEventListener(TRANSCRIPT_UPDATED_EVENT, listener);
}

export type ProfileStepState = "done" | "next" | "todo";
export type ProfileStep = {
  id: string;
  label: string;
  /** The section of the page where the step is done. */
  section: ProfileSection | undefined;
  state: ProfileStepState;
  /** The line under the label: "Đã hoàn thành", the gate's hint, or (to an advisor) what the student has not done yet. */
  note: string;
  /** The short action of the next step ("Import bảng điểm"); null on every other step. */
  action: string | null;
};

/** What the next step asks the student to do. */
function actionOf(id: string, profile: StudentProfile): string | null {
  if (id === "transcript") return "Import bảng điểm";
  if (id === "specialty") return "Chọn chuyên ngành";
  if (id === "career") return "Chọn vị trí nghề nghiệp";
  if (id === "survey") return profile.surveyUpdatedAt ? "Cập nhật khảo sát" : "Làm khảo sát";
  return null;
}

/** The steps a cố vấn học tập or a Khoa admin may do for the student: all but the survey (policy 2026-11-10). */
const ACTING_STEPS: ReadonlySet<string> = new Set(["transcript", "specialty", "career"]);

/** A missing step as an advisor reads it: the transcript and the survey in the student's words, never "của bạn". */
function advisorNote(item: { id: string; hint: string }, profile: StudentProfile): string {
  if (item.id === "transcript") return "Chưa có bảng điểm";
  if (item.id === "survey") return profile.surveyUpdatedAt ? "Sinh viên chưa làm xong" : "Sinh viên chưa làm";
  return item.hint;
}

/**
 * The four steps of the profile. The next step is the first one missing, among those the reader may do: a cố vấn học
 * tập or a Khoa admin imports the transcript and chooses the specialty and the target for the student (policy
 * 2026-11-10) but never answers the survey, so in their view the survey is never the next step and only says what the
 * student lacks.
 */
export function profileSteps(profile: StudentProfile, advisorView = false): ProfileStep[] {
  const items = requiredProfileItems(profile, profile.hasTranscript === true);
  const next = items.find((item) => !item.done && (!advisorView || ACTING_STEPS.has(item.id)));
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    section: profileSectionOf(item.id),
    state: item.done ? "done" : item === next ? "next" : "todo",
    note: item.done ? "Đã hoàn thành" : advisorView ? advisorNote(item, profile) : item.hint,
    action: item === next ? actionOf(item.id, profile) : null,
  }));
}

export default function StudentProfileSteps({ profile, advisorView = isAdvisorView(), onOpen = revealProfileSection }: {
  profile: StudentProfile;
  /** A cố vấn học tập or a Khoa admin works in the student's page (advisor-view.ts). */
  advisorView?: boolean;
  /** Scrolls to a section of the page and focuses its heading. */
  onOpen?: (section: ProfileSection) => void;
}) {
  const steps = profileSteps(profile, advisorView);
  const done = steps.filter((step) => step.state === "done").length;
  const count = `${done}/${steps.length}`;
  const open = (step: ProfileStep) => { if (step.section) onOpen(step.section); };
  if (done === steps.length) {
    return <section className="sps sps-complete" aria-labelledby="sps-title">
      <h2 id="sps-title"><span className="sps-check" aria-hidden="true"><Icon name="check" /></span>Hồ sơ đã đủ {count}</h2>
      <ul className="sps-chips" aria-label="Các mục của hồ sơ">{steps.map((step) => <li key={step.id}>
        <button type="button" onClick={() => open(step)}><Icon name="check" />{step.label}</button>
      </li>)}</ul>
    </section>;
  }
  return <section className="sps" aria-labelledby="sps-title">
    <div className="sps-head">
      <h2 id="sps-title">{advisorView ? "Hồ sơ của sinh viên" : "Hoàn thành hồ sơ"}</h2>
      <span className="sps-count">Đã xong {count}</span>
      <p>{advisorView
        ? "Bạn import được bảng điểm, chọn chuyên ngành và vị trí nghề nghiệp mục tiêu thay sinh viên. Khảo sát định hướng do sinh viên tự làm."
        : `EduPath AI cần đủ ${steps.length} mục này để đánh giá năng lực và gợi ý lộ trình học tập cho bạn.`}</p>
    </div>
    <ol className="sps-steps">{steps.map((step, index) => <li key={step.id}>
      <button type="button" className={`sps-step sps-step-${step.state}`} aria-current={step.state === "next" ? "step" : undefined} onClick={() => open(step)}>
        <span className="sps-check" aria-hidden="true">{step.state === "done" ? <Icon name="check" /> : index + 1}</span>
        <span className="sps-text">
          <strong>{step.label}</strong>{" "}
          {step.state !== "done" && <span className="sr-only">(chưa hoàn thành) </span>}
          {step.action ? <span className="sps-action">{step.action}<Icon name="arrow" /></span> : <small>{step.note}</small>}
        </span>
      </button>
    </li>)}</ol>
  </section>;
}
