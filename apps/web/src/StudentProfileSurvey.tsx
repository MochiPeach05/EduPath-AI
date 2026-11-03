import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { Icon } from "./student-icons";
import { isValidConsent, policyVersion, surveyPolicyHref } from "./public-information";
import {
  SURVEY_API, answerLabel, draftOf, problemSummary, surveyErrorMessage, surveyGaps, surveyProblems,
  type StudentSurvey, type SurveyAction, type SurveyDraft, type SurveyField, type SurveyResponse,
} from "./profile-survey";
import { InterestGroup } from "./InterestChoices";
import { interestLabels } from "./profile-interests";
import { PROFILE_SECTIONS, formatUpdatedAt } from "./student-overview-data";
import { isAdvisorView } from "./advisor-view";
import "./profile-survey.css";

// "Khảo sát định hướng" on Hồ sơ và bảng điểm (user 2026-10-24): radio answers so nothing is left empty or typed at
// random, the technologies and free-time interests (checkbox chips, 1 to 5), achievements Có/Không required with the
// list required after Có. The AI study roadmap needs it, agreed to under the current policy. Stored answers can be
// deleted (and the consent withdrawn) at any time, also while they wait for the newer questions or policy.
// A done survey is a short summary (user 2026-11-04: the open form, over a screen long, hid the transcript import below
// it): "Chỉnh sửa khảo sát" opens the form, Hủy and Lưu khảo sát close it. The form stays open while the survey is not done.

async function send<T>(action: SurveyAction, init: RequestInit & { consent?: boolean } = {}): Promise<T> {
  const { consent, ...request } = init;
  let response: Response;
  try {
    response = await fetch(SURVEY_API, { credentials: "include", cache: "no-store", ...request,
      headers: request.body ? { "Content-Type": "application/json", ...(consent ? { "X-Consent-Policy-Version": policyVersion } : {}) } : undefined });
  } catch {
    throw new Error(surveyErrorMessage(undefined, 0, action));
  }
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    throw new Error(surveyErrorMessage(body.error, response.status, action));
  }
  return body as T;
}

function DeleteSurveyDialog({ busy, error, onClose, onConfirm }: { busy: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="sr-confirm-dialog" aria-labelledby="delete-survey-title" aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="delete-survey-title">Xóa câu trả lời khảo sát</h2>
    <p>Xóa toàn bộ câu trả lời khảo sát định hướng và thành tích? Các lộ trình AI đã tạo cũng sẽ bị xóa, và bạn cần làm lại khảo sát trước khi tạo lộ trình mới.</p>
    {error && <p className="sr-error" role="alert">{error}</p>}
    <div className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" disabled={busy} onClick={onClose} autoFocus>Hủy</button>
      <button type="button" className="sw-primary sr-delete-confirm" disabled={busy} onClick={onConfirm}>{busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
    </div>
  </dialog>;
}

/** What the card shows besides the stored answers: the form or the summary, and the form's draft and messages. */
export type SurveyUi = {
  /** The form is open; else the summary. */
  editing: boolean;
  draft: SurveyDraft;
  consented: boolean;
  /** Lưu khảo sát was pressed: the problems show under their fields. */
  attempted: boolean;
  message: string;
  error: string;
};

/** Every required answer is saved, under a consent that still counts. */
export const surveyDone = (data: Pick<SurveyResponse, "survey" | "consentVersion">) =>
  data.survey?.complete === true && isValidConsent(data.consentVersion);

/**
 * Just loaded: the summary when the survey is done, else the form (answers missing, or waiting for consent to a newer
 * policy); never the form for a cố vấn học tập, who only reads the answers (policy 2026-11-03).
 */
export const loadedUi = (data: SurveyResponse, advisor = isAdvisorView()): SurveyUi => ({
  editing: !advisor && !surveyDone(data), draft: draftOf(data.survey, data.previous), consented: false, attempted: false, message: "", error: "",
});

/** "Chỉnh sửa khảo sát": the full form, from the stored answers. */
export const openedUi = (ui: SurveyUi): SurveyUi => ({ ...ui, editing: true, message: "" });

/** "Hủy": back to the summary with nothing changed; the next "Chỉnh sửa khảo sát" starts from the stored answers again. */
export const cancelledUi = (ui: SurveyUi, data: Pick<SurveyResponse, "survey" | "previous">): SurveyUi => ({
  ...ui, editing: false, draft: draftOf(data.survey, data.previous), consented: false, attempted: false, error: "",
});

/** "Lưu khảo sát" went through: back to the summary of the saved answers. */
export const savedUi = (survey: StudentSurvey | null): SurveyUi => ({
  editing: false, draft: draftOf(survey), consented: false, attempted: false, error: "",
  message: "Đã lưu khảo sát định hướng. EduPath AI sẽ dùng các câu trả lời này khi soạn lộ trình học tập cho bạn.",
});

const deletedUi = (): SurveyUi => ({
  editing: true, draft: draftOf(null), consented: false, attempted: false, error: "",
  message: "Đã xóa câu trả lời khảo sát và các lộ trình AI đã tạo.",
});

/** The stored answers in short: the questions as a grid of answers, then Thế mạnh and Sở trường as chips, then Thành tích. */
function SurveySummary({ data: { questions, interests }, survey }: { data: SurveyResponse; survey: StudentSurvey }) {
  const chips = (labels: string[], className: string) => labels.length
    ? <ul className={className}>{labels.map((label) => <li key={label}>{label}</li>)}</ul>
    : <span className="ps-none">Chưa chọn</span>;
  const achievements = survey.hasAchievements && survey.achievements ? survey.achievements.split("\n") : [];
  return <>
    <dl className="ps-brief">
      {questions.map((question) => {
        const answer = answerLabel(question, survey.answers);
        return <div key={question.id}><dt>{question.label}</dt><dd>{answer ?? <span className="ps-none">Chưa trả lời</span>}</dd></div>;
      })}
    </dl>
    <dl className="ps-lists">
      <div><dt>Thế mạnh</dt><dd>{chips(interestLabels(interests.tech, survey.interestTech), "ps-chips ps-chips-tech")}</dd></div>
      <div><dt>Sở trường</dt><dd>{chips(interestLabels(interests.hobbies, survey.interestHobbies), "ps-chips")}</dd></div>
      <div><dt>Thành tích</dt><dd>{achievements.length
        ? <ul className="ps-achievement-list">{achievements.map((line, index) => <li key={index}>{line}</li>)}</ul>
        : "Không có"}</dd></div>
    </dl>
  </>;
}

type SurveyCardActions = {
  edit: () => void; cancel: () => void; askDelete: () => void; save: (event: FormEvent) => void;
  draft: (draft: SurveyDraft) => void; consent: (value: boolean) => void;
};
const noop = () => {};
const NO_ACTIONS: SurveyCardActions = { edit: noop, cancel: noop, askDelete: noop, save: noop, draft: noop, consent: noop };

/** The card of the loaded survey: the summary, or the form while it is being filled in (never for a cố vấn học tập). */
export function SurveyCard({ data, ui, busy = false, actions = NO_ACTIONS, refs = {}, children }: {
  data: SurveyResponse; ui: SurveyUi; busy?: boolean; actions?: SurveyCardActions;
  refs?: { heading?: Ref<HTMLHeadingElement>; form?: Ref<HTMLFormElement>; editButton?: Ref<HTMLButtonElement> };
  /** The delete dialog while it is open. */
  children?: ReactNode;
}) {
  const { questions, survey, achievementsMax, interests } = data;
  const { draft, consented, attempted } = ui;
  const advisor = isAdvisorView();
  const needsConsent = !isValidConsent(data.consentVersion);
  const done = surveyDone(data);
  // With nothing stored the form is the only view; a cố vấn học tập reads a note instead.
  const formOpen = !advisor && (ui.editing || !survey);
  // Stored answers that no longer count: what to add before they do.
  const gaps = surveyGaps(questions, survey, data.consentVersion);
  const problems = surveyProblems(questions, draft, { needsConsent, consented, achievementsMax });
  const shown = new Map<SurveyField, string>(attempted ? problems : []);
  const errorId = (field: SurveyField) => `ps-error-${field.replace(":", "-")}`;
  const fieldError = (field: SurveyField) => shown.has(field) ? <p className="ps-field-error" id={errorId(field)}>{shown.get(field)}</p> : null;
  const setDraft = actions.draft;
  const updated = survey ? formatUpdatedAt(survey.updatedAt) : "—";

  return <section className={`sw-panel ps-survey${done ? "" : " ps-survey-todo"}`} id={PROFILE_SECTIONS.survey} aria-labelledby="ps-title">
    <div className="sw-section-heading ps-heading">
      <div>
        <div className="ps-title">
          <h2 id="ps-title" ref={refs.heading} tabIndex={-1}>Khảo sát định hướng</h2>
          <span className={`sw-tag ${done ? "sw-tag-green" : "ps-tag-required"}`}>{done ? "Đã hoàn thành" : "Bắt buộc"}</span>
        </div>
        {formOpen || !survey
          ? <p className="sw-muted ps-intro">Trả lời {questions.length} câu hỏi ngắn, cho biết thế mạnh, sở trường và thành tích của bạn. EduPath AI dùng các câu trả lời này để tư vấn lộ trình học tập sát với mục tiêu của bạn{done ? "." : ". Bạn cần hoàn thành khảo sát trước khi tạo Lộ trình AI."}</p>
          : updated !== "—" && <p className="sw-muted ps-updated">Cập nhật lúc {updated}</p>}
      </div>
      {/* Like "Chỉnh sửa thông tin" of Mục tiêu học tập; after saving, the message is read with the button that gets the focus. */}
      {!formOpen && survey && !advisor && <button ref={refs.editButton} type="button" className="sw-text-link" onClick={actions.edit}
        aria-describedby={ui.message ? "ps-message" : undefined}><Icon name="edit" />Chỉnh sửa khảo sát</button>}
    </div>
    {ui.message && <p className="sr-success" id="ps-message" role="status">{ui.message}</p>}
    {gaps.length > 0 && <div className="ps-gaps" role="note">
      <strong>Để hoàn thành khảo sát, bạn cần:</strong>
      <ul>{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
    </div>}
    {formOpen ? <form ref={refs.form} noValidate onSubmit={actions.save}>
      <fieldset disabled={busy} className="ps-fields">
        <ol className="ps-questions">
          {questions.map((question, index) => {
            const field: SurveyField = `q:${question.id}`;
            return <li key={question.id} data-field={field}>
              <fieldset className={`ps-question${shown.has(field) ? " ps-invalid" : ""}`} aria-describedby={shown.has(field) ? errorId(field) : undefined}>
                <legend><span className="ps-number" aria-hidden="true">{index + 1}</span><span>{question.label}<span className="ps-required" aria-hidden="true">*</span></span></legend>
                <div className="ps-options">{question.options.map((option) => <label key={option.id} className="ps-option">
                  <input type="radio" name={`ps-${question.id}`} value={option.id} checked={draft.answers[question.id] === option.id}
                    onChange={() => setDraft({ ...draft, answers: { ...draft.answers, [question.id]: option.id } })} />
                  <span>{option.label}</span>
                </label>)}</div>
                {fieldError(field)}
              </fieldset>
            </li>;
          })}
          {data.previous?.text && !survey?.interestTech.length && <li className="pi-legacy ps-wide">Trước đây bạn đã ghi sở thích: “{data.previous.text}”. Hãy chọn theo hai danh sách dưới đây.</li>}
          <li className="ps-wide">
            {/* Technologies only since survey-v4 (user 2026-10-31: "Bỏ cái câu tự luận ở thế mạnh của bạn đi"). */}
            <InterestGroup name="tech" number={questions.length + 1} legend="Thế mạnh của bạn" hint={`Chọn từ 1 đến ${interests.max} công nghệ bạn thành thạo.`}
              options={interests.tech} max={interests.max} value={draft.interestTech} error={shown.get("tech") ?? ""}
              onChange={(interestTech) => setDraft({ ...draft, interestTech })} />
          </li>
          <li className="ps-wide">
            <InterestGroup name="hobbies" number={questions.length + 2} legend="Sở trường" hint={`Chọn từ 1 đến ${interests.max} hoạt động bạn làm tốt hoặc hay làm.`}
              options={interests.hobbies} max={interests.max} value={draft.interestHobbies} error={shown.get("hobbies") ?? ""}
              onChange={(interestHobbies) => setDraft({ ...draft, interestHobbies })} />
          </li>
          <li data-field="hasAchievements">
            <fieldset className={`ps-question${shown.has("hasAchievements") || shown.has("achievements") ? " ps-invalid" : ""}`}
              aria-describedby={shown.has("hasAchievements") ? errorId("hasAchievements") : undefined}>
              <legend><span className="ps-number" aria-hidden="true">{questions.length + 3}</span><span>Thành tích (cuộc thi, giải thưởng, danh hiệu, học bổng)<span className="ps-required" aria-hidden="true">*</span></span></legend>
              <div className="ps-options">
                {([[true, "Có"], [false, "Không"]] as const).map(([value, label]) => <label key={label} className="ps-option">
                  <input type="radio" name="ps-achievements" checked={draft.hasAchievements === value} onChange={() => setDraft({ ...draft, hasAchievements: value })} />
                  <span>{label}</span>
                </label>)}
              </div>
              {fieldError("hasAchievements")}
              {draft.hasAchievements && <label className="ps-achievements" data-field="achievements">
                <span>Liệt kê thành tích của bạn, mỗi dòng một thành tích<span className="ps-required" aria-hidden="true">*</span></span>
                <textarea rows={4} value={draft.achievements} aria-invalid={shown.has("achievements") || undefined}
                  aria-describedby={`ps-achievements-hint${shown.has("achievements") ? ` ${errorId("achievements")}` : ""}`}
                  placeholder={"Ví dụ: Giải Ba Olympic Tin học sinh viên cấp trường 2025\nHọc bổng khuyến khích học tập HK1 2025–2026"}
                  onChange={(event) => setDraft({ ...draft, achievements: event.target.value })} />
                <small id="ps-achievements-hint">Không ghi họ tên, mã số sinh viên hay thông tin của người khác. {draft.achievements.trim().length.toLocaleString("vi-VN")}/{achievementsMax.toLocaleString("vi-VN")} ký tự.</small>
                {fieldError("achievements")}
              </label>}
            </fieldset>
          </li>
        </ol>
        {needsConsent && <div data-field="consent" className={`ps-consent${shown.has("consent") ? " ps-invalid" : ""}`}>
          <label>
            <input type="checkbox" checked={consented} onChange={(event) => actions.consent(event.target.checked)}
              aria-describedby={shown.has("consent") ? errorId("consent") : undefined} />
            <span>Tôi đồng ý để EduPath AI dùng câu trả lời khảo sát (kể cả thế mạnh, sở trường) và thành tích của tôi để tư vấn lộ trình học tập bằng AI, theo <a href={surveyPolicyHref} target="_blank" rel="noreferrer">Chính sách bảo mật</a>.{survey ? " (Chính sách vừa được cập nhật, vui lòng xác nhận lại.)" : ""}</span>
          </label>
          {fieldError("consent")}
        </div>}
      </fieldset>
      {ui.error && <p className="sr-error" role="alert">{ui.error}</p>}
      <p className="sr-only" role="alert">{attempted ? problemSummary(problems.length) : ""}</p>
      <div className="sr-actions sr-form-actions">
        {/* Stored answers can always go back to the summary or be deleted, even before they count again. */}
        {survey ? <button type="button" className="sr-secondary" disabled={busy} onClick={actions.cancel}><Icon name="close" /> Hủy</button> : <span />}
        {survey && <button type="button" className="sw-text-link ps-delete" disabled={busy} onClick={actions.askDelete}><Icon name="trash" /> Xóa câu trả lời</button>}
        {attempted && problems.length > 0 && <span className="ps-summary" aria-hidden="true">{problemSummary(problems.length)}</span>}
        <button className="sw-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu khảo sát"}</button>
      </div>
    </form> : survey && <SurveySummary data={data} survey={survey} />}
    {!formOpen && advisor && <p className="sw-advisor-note">{survey
      ? "Bạn chỉ xem câu trả lời; sinh viên tự sửa hoặc xóa khảo sát."
      : "Sinh viên chưa làm Khảo sát định hướng. Chỉ sinh viên tự làm được khảo sát."}</p>}
    {children}
  </section>;
}

export default function StudentProfileSurvey({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<SurveyResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [ui, setUi] = useState<SurveyUi>(() => ({ editing: false, draft: draftOf(null), consented: false, attempted: false, message: "", error: "" }));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  // Keyboard focus after the next render: the button that was used (or the dialog's opener) is gone by then.
  const focusNext = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    target?.()?.focus();
  });

  useEffect(() => {
    let alive = true;
    setLoadError("");
    send<SurveyResponse>("load").then((value) => {
      if (!alive) return;
      setData(value);
      setUi(loadedUi(value));
    }, (failure: Error) => alive && setLoadError(failure.message));
    return () => { alive = false; };
  }, [reload]);

  // The id stays on every state, so Tổng quan can open this section while it loads.
  if (loadError) return <section className="sw-panel ps-survey" id={PROFILE_SECTIONS.survey} aria-labelledby="ps-title">
    <div className="sw-section-heading"><h2 id="ps-title" tabIndex={-1}>Khảo sát định hướng</h2></div>
    <p className="sr-error" role="alert">{loadError}<button type="button" onClick={() => setReload((value) => value + 1)}>Thử lại</button></p>
  </section>;
  if (!data) return <section className="sw-panel ps-survey" id={PROFILE_SECTIONS.survey} aria-busy="true"><p role="status">Đang tải khảo sát định hướng…</p></section>;

  const { questions, survey, achievementsMax } = data;
  const needsConsent = !isValidConsent(data.consentVersion);
  const problems = surveyProblems(questions, ui.draft, { needsConsent, consented: ui.consented, achievementsMax });

  const edit = () => {
    setUi(openedUi);
    // The first question: its chosen answer, else its first option.
    focusNext.current = () => {
      const first = form.current?.querySelector("li[data-field]");
      return first?.querySelector<HTMLElement>("input:checked") ?? first?.querySelector<HTMLElement>("input");
    };
  };
  const cancel = () => {
    setUi((current) => cancelledUi(current, data));
    focusNext.current = () => editButton.current;
  };
  const askDelete = () => { setDeleting(true); setDeleteError(""); };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setUi((current) => ({ ...current, attempted: true, message: "" }));
    if (problems.length) {
      const [field] = problems[0]!;
      form.current?.querySelector<HTMLElement>(`[data-field="${field}"] input, [data-field="${field}"] textarea`)?.focus();
      return;
    }
    setBusy(true);
    setUi((current) => ({ ...current, error: "" }));
    const { draft } = ui;
    try {
      const body = {
        answers: draft.answers, interestTech: draft.interestTech, interestHobbies: draft.interestHobbies,
        hasAchievements: draft.hasAchievements, achievements: draft.hasAchievements ? draft.achievements : null,
      };
      const saved = await send<Pick<SurveyResponse, "survey" | "consentVersion">>("save", { method: "PUT", body: JSON.stringify(body), consent: needsConsent });
      setData({ ...data, survey: saved.survey, previous: null, consentVersion: saved.consentVersion });
      setUi(savedUi(saved.survey));
      // The form closes into the summary: back to "Chỉnh sửa khảo sát", else the heading.
      focusNext.current = () => editButton.current ?? heading.current;
      onSaved();
    } catch (failure) {
      setUi((current) => ({ ...current, error: (failure as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setDeleteError("");
    try {
      await send("delete", { method: "DELETE", body: JSON.stringify({ confirmed: true }) });
      setData({ ...data, survey: null, previous: null, consentVersion: null });
      setUi(deletedUi());
      setDeleting(false);
      focusNext.current = () => heading.current;
      onSaved();
    } catch (failure) {
      setDeleteError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <SurveyCard data={data} ui={ui} busy={busy} refs={{ heading, form, editButton }}
    actions={{
      edit, cancel, askDelete, save: (event) => void save(event),
      draft: (draft) => setUi((current) => ({ ...current, draft })),
      consent: (consented) => setUi((current) => ({ ...current, consented })),
    }}>
    {deleting && <DeleteSurveyDialog busy={busy} error={deleteError} onClose={() => setDeleting(false)} onConfirm={() => void remove()} />}
  </SurveyCard>;
}
