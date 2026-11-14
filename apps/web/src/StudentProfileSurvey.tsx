import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { Icon } from "./student-icons";
import { isValidConsent, policyVersion, surveyPolicyHref } from "./public-information";
import {
  SURVEY_API, SURVEY_SECTION_ID, answerLabel, draftOf, problemSummary, surveyBody, surveyErrorMessage, surveyGaps, surveyItems, surveyProblems,
  type StudentSurvey, type SurveyAction, type SurveyDraft, type SurveyField, type SurveyResponse,
} from "./profile-survey";
import { InterestGroup } from "./InterestChoices";
import { interestLabels } from "./profile-interests";
import { formatUpdatedAt } from "./student-overview-data";
import { isAdvisorView } from "./advisor-view";
import { ActingConfirmDialog, surveyConfirm } from "./acting-confirm";
import "./profile-survey.css";

// "Khảo sát nhanh" on Định hướng nghề nghiệp (2026-11-14, plan "Một bước để bắt đầu"; the advisor: the old survey was too
// long and students were made to take it before using EduPath AI). Five items, all choices so nothing is left empty or
// typed at random (user 2026-10-24): Lĩnh vực quan tâm nhất, Thế mạnh của bạn (1 to 5 technologies), Mục tiêu sau tốt
// nghiệp, Thời gian tự học mỗi tuần, Tiếng Anh chuyên ngành. Not required: with it, Định hướng nghề nghiệp suggests the
// positions that match it and the AI writes a closer roadmap. Stored answers can be deleted (and the consent withdrawn) at
// any time. A done survey is a short summary: "Chỉnh sửa khảo sát" opens the form, Hủy and Lưu khảo sát close it.
// A cố vấn học tập or the Khoa working in the student's page fills it in the same way (user 2026-11-10, policy 2026-11-10):
// no consent box (no consent in the student's name), a confirmation before saving, never Xóa câu trả lời; the API logs it
// and tells the student.

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
    <p>Xóa toàn bộ câu trả lời Khảo sát nhanh? Các lộ trình AI đã tạo cũng sẽ bị xóa. Bạn vẫn dùng được mọi trang và vẫn tạo được lộ trình mới khi không có khảo sát.</p>
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

/**
 * Every answer is saved, under a consent that still counts, or filled in for the student by a cố vấn học tập or the Khoa
 * (savedBy, policy 2026-11-10; the API's surveyUsable also checks the consent was not withdrawn).
 */
export const surveyDone = (data: Pick<SurveyResponse, "survey" | "consentVersion">) =>
  data.survey?.complete === true && (isValidConsent(data.consentVersion) || Boolean(data.survey.savedBy));

/**
 * Just loaded: the summary when the survey is done, else the form (nothing stored, answers missing, or waiting for consent
 * to a newer policy). A cố vấn học tập or the Khoa starts on the summary, or a note when nothing is stored, and opens the
 * form with Chỉnh sửa khảo sát or Làm khảo sát thay sinh viên (policy 2026-11-10).
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

/** "Lưu khảo sát" went through: back to the summary of the saved answers. advisor: saved for the student. */
export const savedUi = (survey: StudentSurvey | null, advisor = false): SurveyUi => ({
  editing: false, draft: draftOf(survey), consented: false, attempted: false, error: "",
  message: advisor ? "Đã lưu Khảo sát nhanh của sinh viên. EduPath AI dùng các câu trả lời này để gợi ý vị trí nghề nghiệp và soạn lộ trình học tập cho sinh viên."
    : "Đã lưu Khảo sát nhanh. EduPath AI dùng các câu trả lời này để gợi ý vị trí nghề nghiệp và soạn lộ trình học tập cho bạn.",
});

/** ", do cố vấn học tập làm thay bạn" after the date of answers filled in for the student (to the student, or to staff). */
const savedByText = (savedBy: StudentSurvey["savedBy"], advisor: boolean) => savedBy
  ? `, do ${savedBy === "admin" ? "cán bộ Khoa" : "cố vấn học tập"} làm thay ${advisor ? "sinh viên" : "bạn"}` : "";

const deletedUi = (): SurveyUi => ({
  editing: true, draft: draftOf(null), consented: false, attempted: false, error: "",
  message: "Đã xóa câu trả lời khảo sát và các lộ trình AI đã tạo.",
});

/** The stored answers in short, in the order of the form: each question's answer, Thế mạnh as chips. */
function SurveySummary({ data: { questions, interests }, survey }: { data: SurveyResponse; survey: StudentSurvey }) {
  const tech = interestLabels(interests.tech, survey.interestTech);
  return <dl className="ps-brief">{surveyItems(questions).map((item) => item.kind === "tech"
    ? <div key="tech" className="ps-brief-wide"><dt>Thế mạnh</dt><dd>{tech.length
      ? <ul className="ps-chips ps-chips-tech">{tech.map((label) => <li key={label}>{label}</li>)}</ul>
      : <span className="ps-none">Chưa chọn</span>}</dd></div>
    : <div key={item.question.id}><dt>{item.question.label}</dt><dd>{answerLabel(item.question, survey.answers) ?? <span className="ps-none">Chưa trả lời</span>}</dd></div>)}
  </dl>;
}

type SurveyCardActions = {
  edit: () => void; cancel: () => void; askDelete: () => void; save: (event: FormEvent) => void;
  draft: (draft: SurveyDraft) => void; consent: (value: boolean) => void;
};
const noop = () => {};
const NO_ACTIONS: SurveyCardActions = { edit: noop, cancel: noop, askDelete: noop, save: noop, draft: noop, consent: noop };
/** Technologies shown before "+ N công nghệ khác" (the chosen ones always show). */
const TECH_SHOWN = 6;

/** The card of the loaded survey: the summary, or the form while it is being filled in (by the student or for them). */
export function SurveyCard({ data, ui, busy = false, actions = NO_ACTIONS, refs = {}, children }: {
  data: SurveyResponse; ui: SurveyUi; busy?: boolean; actions?: SurveyCardActions;
  refs?: { heading?: Ref<HTMLHeadingElement>; form?: Ref<HTMLFormElement>; editButton?: Ref<HTMLButtonElement> };
  /** The delete dialog while it is open. */
  children?: ReactNode;
}) {
  const { questions, survey, interests } = data;
  const { draft, consented, attempted } = ui;
  const advisor = isAdvisorView();
  // The student agrees when saving; a cố vấn học tập or the Khoa never agrees in the student's name (a note instead).
  const needsConsent = !advisor && !isValidConsent(data.consentVersion);
  const done = surveyDone(data);
  const items = surveyItems(questions);
  // With nothing stored the student's only view is the form; a cố vấn học tập reads a note and opens the form by its button.
  const formOpen = ui.editing || (!advisor && !survey);
  // Stored answers that no longer count: what to add before they do (no consent to give when working for the student).
  const gaps = surveyGaps(questions, survey, data.consentVersion, !advisor);
  // Nothing may be filled in for a student who deleted the answers and withdrew the consent (API: survey_withdrawn).
  const canAct = !advisor || Boolean(survey) || !data.withdrawn;
  const problems = surveyProblems(questions, draft, { needsConsent, consented });
  const shown = new Map<SurveyField, string>(attempted ? problems : []);
  const errorId = (field: SurveyField) => `ps-error-${field.replace(":", "-")}`;
  const fieldError = (field: SurveyField) => shown.has(field) ? <p className="ps-field-error" id={errorId(field)}>{shown.get(field)}</p> : null;
  const setDraft = actions.draft;
  const updated = survey ? formatUpdatedAt(survey.updatedAt) : "—";

  return <section className="sw-panel ps-survey ps-quick" id={SURVEY_SECTION_ID} aria-labelledby="ps-title">
    <div className="sw-section-heading ps-heading">
      <div>
        <div className="ps-title">
          <h2 id="ps-title" ref={refs.heading} tabIndex={-1}>Khảo sát nhanh</h2>
          <span className={`sw-tag ${done ? "sw-tag-green" : "ps-tag-optional"}`}>{done ? "Đã hoàn thành" : "Không bắt buộc · 1 phút"}</span>
        </div>
        {formOpen || !survey
          ? <p className="sw-muted ps-intro">Trả lời {items.length} câu để EduPath AI gợi ý thêm vị trí hợp với sở thích, thế mạnh và soạn lộ trình sát hơn.</p>
          : updated !== "—" && <p className="sw-muted ps-updated">Cập nhật lúc {updated}{savedByText(survey.savedBy, advisor)}</p>}
      </div>
      {/* After saving, the message is read with the button that gets the focus. */}
      {!formOpen && (survey || advisor) && canAct && <button ref={refs.editButton} type="button" className="sw-text-link" onClick={actions.edit}
        aria-describedby={ui.message ? "ps-message" : undefined}><Icon name="edit" />{survey ? "Chỉnh sửa khảo sát" : "Làm khảo sát thay sinh viên"}</button>}
    </div>
    {ui.message && <p className="sr-success" id="ps-message" role="status">{ui.message}</p>}
    {gaps.length > 0 && <div className="ps-gaps" role="note">
      <strong>Để hoàn thành khảo sát, bạn cần:</strong>
      <ul>{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
    </div>}
    {formOpen ? <form ref={refs.form} noValidate onSubmit={actions.save}>
      <fieldset disabled={busy} className="ps-fields">
        <ol className="ps-questions">
          {items.map((item) => {
            if (item.kind === "tech") {
              return <li key="tech" className="ps-wide">
                {data.previous?.text && !survey?.interestTech.length && <p className="pi-legacy">Trước đây bạn đã ghi sở thích: “{data.previous.text}”. Hãy chọn thế mạnh của bạn ở danh sách dưới đây.</p>}
                <InterestGroup name="tech" number={item.number} legend="Thế mạnh của bạn" hint={`Chọn từ 1 đến ${interests.max} công nghệ bạn thành thạo.`}
                  options={interests.tech} max={interests.max} value={draft.interestTech} error={shown.get("tech") ?? ""} shown={TECH_SHOWN}
                  onChange={(interestTech) => setDraft({ ...draft, interestTech })} />
              </li>;
            }
            const { question } = item;
            const field: SurveyField = `q:${question.id}`;
            return <li key={question.id} data-field={field}>
              <fieldset className={`ps-question${shown.has(field) ? " ps-invalid" : ""}`} aria-describedby={shown.has(field) ? errorId(field) : undefined}>
                <legend><span className="ps-number" aria-hidden="true">{item.number}</span><span>{question.label}<span className="ps-required" aria-hidden="true">*</span></span></legend>
                <div className="ps-options">{question.options.map((option) => <label key={option.id} className="ps-option">
                  <input type="radio" name={`ps-${question.id}`} value={option.id} checked={draft.answers[question.id] === option.id}
                    onChange={() => setDraft({ ...draft, answers: { ...draft.answers, [question.id]: option.id } })} />
                  <span>{option.label}</span>
                </label>)}</div>
                {fieldError(field)}
              </fieldset>
            </li>;
          })}
        </ol>
        {needsConsent && <div data-field="consent" className={`ps-consent${shown.has("consent") ? " ps-invalid" : ""}`}>
          <label>
            <input type="checkbox" checked={consented} onChange={(event) => actions.consent(event.target.checked)}
              aria-describedby={shown.has("consent") ? errorId("consent") : undefined} />
            <span>Tôi đồng ý để EduPath AI dùng câu trả lời Khảo sát nhanh để gợi ý vị trí nghề nghiệp và tư vấn lộ trình học tập bằng AI, theo <a href={surveyPolicyHref} target="_blank" rel="noreferrer">Chính sách bảo mật</a>.{data.consentVersion ? " (Chính sách vừa được cập nhật, vui lòng xác nhận lại.)" : ""}</span>
          </label>
          {fieldError("consent")}
        </div>}
        {advisor && <p className="sw-advisor-note">Bạn làm khảo sát thay sinh viên; sinh viên sẽ nhận thông báo và có thể sửa lại.</p>}
      </fieldset>
      {ui.error && <p className="sr-error" role="alert">{ui.error}</p>}
      <p className="sr-only" role="alert">{attempted ? problemSummary(problems.length) : ""}</p>
      <div className="sr-actions sr-form-actions">
        {/* Stored answers can always go back to the summary or be deleted, even before they count again. */}
        {survey || advisor ? <button type="button" className="sr-secondary" disabled={busy} onClick={actions.cancel}><Icon name="close" /> Hủy</button> : <span />}
        {survey && !advisor && <button type="button" className="sw-text-link ps-delete" disabled={busy} onClick={actions.askDelete}><Icon name="trash" /> Xóa câu trả lời</button>}
        {attempted && problems.length > 0 && <span className="ps-summary" aria-hidden="true">{problemSummary(problems.length)}</span>}
        <button className="sw-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu khảo sát"}</button>
      </div>
    </form> : survey && <SurveySummary data={data} survey={survey} />}
    {!formOpen && advisor && !survey && <p className="sw-advisor-note">{canAct ? "Sinh viên chưa làm Khảo sát nhanh."
      : "Sinh viên đã xóa câu trả lời khảo sát và rút lại sự đồng ý, nên bạn không làm khảo sát thay được."}</p>}
    {children}
  </section>;
}

/**
 * onSaved: after a save or a delete (Định hướng nghề nghiệp reads its survey matches again). openRequest: a number that
 * grows each time another part of the page asks for the form ("Chỉnh sửa khảo sát" beside the matches).
 */
export default function StudentProfileSurvey({ onSaved, openRequest = 0 }: { onSaved: () => void; openRequest?: number }) {
  const [data, setData] = useState<SurveyResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [ui, setUi] = useState<SurveyUi>(() => ({ editing: false, draft: draftOf(null), consented: false, attempted: false, message: "", error: "" }));
  const [busy, setBusy] = useState(false);
  // Saving for the student waits for Lưu khảo sát in the confirmation (acting-confirm.tsx).
  const [confirming, setConfirming] = useState(false);
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
  // The first question: its chosen answer, else its first option.
  const firstField = () => {
    const first = form.current?.querySelector("li[data-field], li.ps-wide");
    return first?.querySelector<HTMLElement>("input:checked") ?? first?.querySelector<HTMLElement>("input");
  };

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

  // Another part of the page asked for the form: open it (when it may be filled in) and go to its first question.
  const seenRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === seenRequest.current || !data) return;
    seenRequest.current = openRequest;
    if (isAdvisorView() && !data.survey && data.withdrawn) return;
    setUi(openedUi);
    focusNext.current = firstField;
  }, [openRequest, data]);

  // The id stays on every state, so other pages and buttons can open this section while it loads.
  if (loadError) return <section className="sw-panel ps-survey ps-quick" id={SURVEY_SECTION_ID} aria-labelledby="ps-title">
    <div className="sw-section-heading"><h2 id="ps-title" tabIndex={-1}>Khảo sát nhanh</h2></div>
    <p className="sr-error" role="alert">{loadError}<button type="button" onClick={() => setReload((value) => value + 1)}>Thử lại</button></p>
  </section>;
  if (!data) return <section className="sw-panel ps-survey ps-quick" id={SURVEY_SECTION_ID} aria-busy="true"><p role="status">Đang tải Khảo sát nhanh…</p></section>;

  const { questions, survey } = data;
  const advisor = isAdvisorView();
  const needsConsent = !advisor && !isValidConsent(data.consentVersion);
  const problems = surveyProblems(questions, ui.draft, { needsConsent, consented: ui.consented });

  const edit = () => {
    setUi(openedUi);
    focusNext.current = firstField;
  };
  const cancel = () => {
    setUi((current) => cancelledUi(current, data));
    focusNext.current = () => editButton.current;
  };
  const askDelete = () => { setDeleting(true); setDeleteError(""); };

  const save = (event: FormEvent) => {
    event.preventDefault();
    setUi((current) => ({ ...current, attempted: true, message: "" }));
    if (problems.length) {
      const [field] = problems[0]!;
      form.current?.querySelector<HTMLElement>(`[data-field="${field}"] input`)?.focus();
      return;
    }
    if (advisor) setConfirming(true);
    else void submit();
  };

  const submit = async () => {
    setBusy(true);
    setUi((current) => ({ ...current, error: "" }));
    try {
      const saved = await send<Pick<SurveyResponse, "survey" | "consentVersion">>("save",
        { method: "PUT", body: JSON.stringify(surveyBody(questions, ui.draft)), consent: needsConsent });
      setData({ ...data, survey: saved.survey, previous: null, consentVersion: saved.consentVersion });
      setUi(savedUi(saved.survey, advisor));
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
      edit, cancel, askDelete, save,
      draft: (draft) => setUi((current) => ({ ...current, draft })),
      consent: (consented) => setUi((current) => ({ ...current, consented })),
    }}>
    {deleting && <DeleteSurveyDialog busy={busy} error={deleteError} onClose={() => setDeleting(false)} onConfirm={() => void remove()} />}
    {confirming && <ActingConfirmDialog {...surveyConfirm(Boolean(survey))} onClose={() => setConfirming(false)}
      onConfirm={() => { setConfirming(false); void submit(); }} />}
  </SurveyCard>;
}
