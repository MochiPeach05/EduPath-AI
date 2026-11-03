import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./student-icons";
import { isValidConsent, policyVersion, surveyPolicyHref } from "./public-information";
import {
  SURVEY_API, answerLabel, draftOf, problemSummary, surveyErrorMessage, surveyGaps, surveyProblems,
  type SurveyAction, type SurveyDraft, type SurveyField, type SurveyResponse,
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

export default function StudentProfileSurvey({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<SurveyResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SurveyDraft>(draftOf(null));
  const [consented, setConsented] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
      setDraft(draftOf(value.survey, value.previous));
      // Open while incomplete, or while the answers wait for consent to a newer policy; never for a cố vấn học tập, who
      // only reads the answers (policy 2026-11-03).
      setEditing(!isAdvisorView() && (!value.survey?.complete || !isValidConsent(value.consentVersion)));
    }, (failure: Error) => alive && setLoadError(failure.message));
    return () => { alive = false; };
  }, [reload]);

  // The id stays on every state, so Tổng quan can open this section while it loads.
  if (loadError) return <section className="sw-panel ps-survey" id={PROFILE_SECTIONS.survey} aria-labelledby="ps-title">
    <div className="sw-section-heading"><h2 id="ps-title" tabIndex={-1}>Khảo sát định hướng</h2></div>
    <p className="sr-error" role="alert">{loadError}<button type="button" onClick={() => setReload((value) => value + 1)}>Thử lại</button></p>
  </section>;
  if (!data) return <section className="sw-panel ps-survey" id={PROFILE_SECTIONS.survey} aria-busy="true"><p role="status">Đang tải khảo sát định hướng…</p></section>;

  const { questions, survey, achievementsMax, interests } = data;
  const needsConsent = !isValidConsent(data.consentVersion);
  const done = survey?.complete === true && !needsConsent;
  // Stored answers that no longer count: what to add before they do.
  const gaps = surveyGaps(questions, survey, data.consentVersion);
  const problems = surveyProblems(questions, draft, { needsConsent, consented, achievementsMax });
  const shown = new Map<SurveyField, string>(attempted ? problems : []);
  const errorId = (field: SurveyField) => `ps-error-${field.replace(":", "-")}`;
  const fieldError = (field: SurveyField) => shown.has(field) ? <p className="ps-field-error" id={errorId(field)}>{shown.get(field)}</p> : null;

  const edit = () => {
    setEditing(true);
    setMessage("");
    // The first question: its chosen answer, else its first option.
    focusNext.current = () => {
      const first = form.current?.querySelector("li[data-field]");
      return first?.querySelector<HTMLElement>("input:checked") ?? first?.querySelector<HTMLElement>("input");
    };
  };
  const cancel = () => {
    setEditing(false);
    setDraft(draftOf(survey, data.previous));
    setAttempted(false);
    setConsented(false);
    setError("");
    focusNext.current = () => editButton.current;
  };
  const askDelete = () => { setDeleting(true); setDeleteError(""); };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setMessage("");
    if (problems.length) {
      const [field] = problems[0]!;
      form.current?.querySelector<HTMLElement>(`[data-field="${field}"] input, [data-field="${field}"] textarea`)?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        answers: draft.answers, interestTech: draft.interestTech, interestHobbies: draft.interestHobbies,
        hasAchievements: draft.hasAchievements, achievements: draft.hasAchievements ? draft.achievements : null,
      };
      const saved = await send<Pick<SurveyResponse, "survey" | "consentVersion">>("save", { method: "PUT", body: JSON.stringify(body), consent: needsConsent });
      setData({ ...data, survey: saved.survey, previous: null, consentVersion: saved.consentVersion });
      setDraft(draftOf(saved.survey));
      setEditing(false);
      setAttempted(false);
      setConsented(false);
      setMessage("Đã lưu khảo sát định hướng. EduPath AI sẽ dùng các câu trả lời này khi soạn lộ trình học tập cho bạn.");
      focusNext.current = () => heading.current;
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
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
      setDraft(draftOf(null));
      setDeleting(false);
      setEditing(true);
      setAttempted(false);
      setConsented(false);
      setError("");
      setMessage("Đã xóa câu trả lời khảo sát và các lộ trình AI đã tạo.");
      focusNext.current = () => heading.current;
      onSaved();
    } catch (failure) {
      setDeleteError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <section className={`sw-panel ps-survey${done ? "" : " ps-survey-todo"}`} id={PROFILE_SECTIONS.survey} aria-labelledby="ps-title">
    <div className="sw-section-heading">
      <div>
        <h2 id="ps-title" ref={heading} tabIndex={-1}>Khảo sát định hướng</h2>
        <p className="sw-muted ps-intro">Trả lời {questions.length} câu hỏi ngắn, cho biết thế mạnh, sở trường và thành tích của bạn. EduPath AI dùng các câu trả lời này để tư vấn lộ trình học tập sát với mục tiêu của bạn{done ? "." : ". Bạn cần hoàn thành khảo sát trước khi tạo Lộ trình AI."}</p>
      </div>
      <span className={`sw-tag ${done ? "sw-tag-green" : "ps-tag-required"}`}>{done ? "Đã hoàn thành" : "Bắt buộc"}</span>
    </div>
    {message && <p className="sr-success" role="status">{message}</p>}
    {gaps.length > 0 && <div className="ps-gaps" role="note">
      <strong>Để hoàn thành khảo sát, bạn cần:</strong>
      <ul>{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
    </div>}
    {editing ? <form ref={form} noValidate onSubmit={(event) => void save(event)}>
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
            <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)}
              aria-describedby={shown.has("consent") ? errorId("consent") : undefined} />
            <span>Tôi đồng ý để EduPath AI dùng câu trả lời khảo sát (kể cả thế mạnh, sở trường) và thành tích của tôi để tư vấn lộ trình học tập bằng AI, theo <a href={surveyPolicyHref} target="_blank" rel="noreferrer">Chính sách bảo mật</a>.{survey ? " (Chính sách vừa được cập nhật, vui lòng xác nhận lại.)" : ""}</span>
          </label>
          {fieldError("consent")}
        </div>}
      </fieldset>
      {error && <p className="sr-error" role="alert">{error}</p>}
      <p className="sr-only" role="alert">{attempted ? problemSummary(problems.length) : ""}</p>
      <div className="sr-actions sr-form-actions">
        {/* Stored answers can always go back to the view or be deleted, even before they count again. */}
        {survey ? <button type="button" className="sr-secondary" disabled={busy} onClick={cancel}><Icon name="close" /> Hủy</button> : <span />}
        {survey && <button type="button" className="sw-text-link ps-delete" disabled={busy} onClick={askDelete}><Icon name="trash" /> Xóa câu trả lời</button>}
        {attempted && problems.length > 0 && <span className="ps-summary" aria-hidden="true">{problemSummary(problems.length)}</span>}
        <button className="sw-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu khảo sát"}</button>
      </div>
    </form> : survey && <>
      <dl className="ps-answers">
        {questions.map((question) => <div key={question.id}><dt>{question.label}</dt><dd>{answerLabel(question, survey.answers) ?? "Chưa trả lời"}</dd></div>)}
        <div className="ps-answers-wide"><dt>Thế mạnh của bạn</dt><dd>{interestLabels(interests.tech, survey.interestTech).join(", ") || "Chưa chọn"}</dd></div>
        <div className="ps-answers-wide"><dt>Sở trường</dt><dd>{interestLabels(interests.hobbies, survey.interestHobbies).join(", ") || "Chưa chọn"}</dd></div>
        <div className="ps-answers-wide"><dt>Thành tích</dt><dd>{survey.hasAchievements && survey.achievements
          ? <ul>{survey.achievements.split("\n").map((line, index) => <li key={index}>{line}</li>)}</ul> : "Không có"}</dd></div>
      </dl>
      {isAdvisorView() ? <p className="sw-advisor-note">Cố vấn học tập chỉ xem câu trả lời; sinh viên tự sửa hoặc xóa khảo sát.</p> : <div className="sr-actions">
        <button ref={editButton} type="button" className="sr-secondary" onClick={edit}><Icon name="edit" /> Chỉnh sửa khảo sát</button>
        <button type="button" className="sw-text-link ps-delete" onClick={askDelete}><Icon name="trash" /> Xóa câu trả lời</button>
      </div>}
      <p className="sw-muted ps-updated">Cập nhật lúc {formatUpdatedAt(survey.updatedAt)}.</p>
    </>}
    {!editing && !survey && isAdvisorView() && <p className="sw-advisor-note">Sinh viên chưa làm Khảo sát định hướng. Cố vấn học tập không làm khảo sát thay sinh viên.</p>}
    {deleting && <DeleteSurveyDialog busy={busy} error={deleteError} onClose={() => setDeleting(false)} onConfirm={() => void remove()} />}
  </section>;
}
