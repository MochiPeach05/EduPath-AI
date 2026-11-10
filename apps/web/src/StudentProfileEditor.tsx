import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./student-icons";
import { type CareerSelection } from "./career-types";
import StudentCareerExplorer from "./StudentCareerExplorer";
import { specialtiesFor, specialtyLabel } from "./competency-assessment-types";
import { PROFILE_SECTIONS } from "./student-overview-data";
import { isAdvisorView } from "./advisor-view";
import { ActingConfirmDialog, goalsConfirm } from "./acting-confirm";
import "./student-records.css";
// "Sở thích" (technologies and free-time interests) moved into Khảo sát định hướng on 2026-10-24 (StudentProfileSurvey).
// "Mục tiêu học tập" (was "Thông tin cá nhân"): the career and the specialty, changed in one place (user 2026-11-03: "chỉ có
// ấn vào chỉnh sửa mới cho sửa Chọn vị trí nghề nghiệp mục tiêu luôn đi chia ra 2 lối quá"): "Chỉnh sửa thông tin" opens the
// form, where Khám phá vị trí nghề nghiệp picks the career into the draft; "Lưu thay đổi" saves the career and the specialty
// together and Hủy drops both. Outside the form the eye icon only shows the chosen career's requirements.
// A cố vấn học tập or a Khoa admin working in the student's page changes them the same way (user 2026-11-10: "có thể sửa
// chuyên ngành và nghề nghiệp của sinh viên luôn", policy 2026-11-10), after a confirmation (acting-confirm.tsx); the API
// logs it and tells the student (advisors/access.ts).
type EditableStudentProfile = {
  /** The programme of the MSSV (052): the specialties offered are those of this major. */
  majorCode?: string | null;
  careerPositionId?: string | null;
  careerPosition?: CareerSelection | null;
  /** Absent until the API returns it; the field is hidden then so saving keeps working. */
  specialty?: string | null;
  /** Decides which specialties are offered (An ninh Mạng và IoTs: K27 only). */
  cohortCode?: string | null;
};
type ProfileChanges = { careerPositionId?: string | null; specialty?: string | null };
/** advisorView: the words of a refusal speak of the student, not of the reader. */
async function updateProfile(input: ProfileChanges, advisorView = false) {
  const res = await fetch("/api/student/profile", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    throw new Error(
      body.error === "career_unavailable"
        ? "Vị trí nghề nghiệp này vừa bị xóa khỏi danh mục. Hãy chọn vị trí nghề nghiệp khác."
        : body.error === "specialty_unavailable"
          ? `Chuyên ngành này không áp dụng cho khóa của ${advisorView ? "sinh viên" : "bạn"}. Hãy chọn chuyên ngành khác.`
        : res.status === 401
          ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
          : res.status === 400
            ? "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại các lựa chọn."
            : "Không lưu được hồ sơ. Vui lòng thử lại.",
    );
  }
}
export default function StudentProfileEditor({
  profile,
  onSaved,
}: {
  profile: EditableStudentProfile;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState({
      careerPositionId: "",
      specialty: "",
    });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [draftCareer, setDraftCareer] = useState<CareerSelection | null>(null);
  // pick: from the form, the career goes into the draft; view: from the eye icon, requirements only.
  const [explorer, setExplorer] = useState<{ mode: "pick" | "view"; initialCareerId?: string } | null>(null);
  // What was just saved, shown until the reloaded profile arrives (onSaved reloads it).
  const [saved, setSaved] = useState<Partial<EditableStudentProfile> | null>(null);
  useEffect(() => setSaved(null), [profile]);
  const shown: EditableStudentProfile = saved ? { ...profile, ...saved } : profile;
  const supportsSpecialty = profile.specialty !== undefined;
  // A cố vấn học tập or a Khoa admin in the student's page: confirms before saving (policy 2026-11-10).
  const advisorView = isAdvisorView();
  const [confirming, setConfirming] = useState<ProfileChanges | null>(null);
  // Keyboard focus after the next render, since the button that was used is gone by then (Chỉnh sửa, Hủy, Lưu).
  const editButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const specialtyField = useRef<HTMLSelectElement>(null);
  const focusNext = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    target?.()?.focus();
  });
  const startEditing = () => {
    setDraft({ careerPositionId: shown.careerPositionId ?? "", specialty: shown.specialty ?? "" });
    setDraftCareer(shown.careerPosition ?? null);
    setEditing(true);
    setMessage("");
    setError("");
    focusNext.current = () => specialtyField.current ?? form.current?.querySelector<HTMLElement>("button");
  };
  const stopEditing = () => {
    setEditing(false);
    focusNext.current = () => editButton.current;
  };
  /** The career picked in Khám phá vị trí nghề nghiệp, into the draft: "Lưu thay đổi" saves it. */
  const pickCareer = async (career: Pick<CareerSelection, "id" | "nameVi" | "nameEn">) => {
    setDraft((current) => ({ ...current, careerPositionId: career.id }));
    setDraftCareer({ id: career.id, nameVi: career.nameVi, nameEn: career.nameEn, deletedAt: null });
    setExplorer(null);
    setError("");
  };
  const send = async (changes: ProfileChanges) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await updateProfile(changes, advisorView);
      setSaved((current) => ({ ...current, ...changes, ...("careerPositionId" in changes ? { careerPosition: draftCareer } : {}) }));
      setMessage(advisorView ? "Đã cập nhật mục tiêu học tập của sinh viên." : "Đã cập nhật mục tiêu học tập.");
      stopEditing();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    // Sent only when changed: "absent" keeps the stored value.
    const changes: ProfileChanges = {};
    if (draft.careerPositionId !== (shown.careerPositionId ?? "")) changes.careerPositionId = draft.careerPositionId || null;
    if (supportsSpecialty && draft.specialty !== (shown.specialty ?? "")) changes.specialty = draft.specialty || null;
    if (!advisorView) { void send(changes); return; }
    // Working for the student: what changes is confirmed first; with nothing changed nothing is sent (the API takes only
    // the specialty and the career, advisors/access.ts).
    if (Object.keys(changes).length) setConfirming(changes);
    else { setError(""); stopEditing(); }
  };
  const confirmText = confirming && goalsConfirm({
    ...("specialty" in confirming ? { specialty: confirming.specialty ? specialtyLabel(confirming.specialty) : null } : {}),
    ...("careerPositionId" in confirming ? { career: confirming.careerPositionId ? draftCareer?.nameVi ?? "vị trí đã chọn" : null } : {}),
  });
  return (
    <section className="sw-panel sr-editor" id={PROFILE_SECTIONS.goals} aria-labelledby="sr-goals-title">
      <div className="sw-section-heading">
        <h2 id="sr-goals-title" tabIndex={-1}>Mục tiêu học tập</h2>
        {!editing && (
          <button ref={editButton} type="button" className="sw-text-link" onClick={startEditing}>
            <Icon name="edit" />
            Chỉnh sửa thông tin
          </button>
        )}
      </div>
      {message && (
        <p className="sr-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      {editing ? (
        <form ref={form} onSubmit={save}>
          <fieldset disabled={busy} className="sr-form-fields">
            <div className="sr-wide sr-career-target">
              <strong>Vị trí nghề nghiệp mục tiêu</strong>
              <div className="sr-career-selection">
                <span>{draftCareer ? `${draftCareer.nameVi} — ${draftCareer.nameEn}${draftCareer.deletedAt ? " (đã ngừng sử dụng)" : ""}` : "Chưa chọn vị trí nghề nghiệp mục tiêu."}</span>
                {draft.careerPositionId && <button type="button" className="sr-career-icon sr-career-clear" aria-label="Bỏ chọn vị trí nghề nghiệp mục tiêu" title="Bỏ chọn" onClick={() => { setDraft({ ...draft, careerPositionId: "" }); setDraftCareer(null); }}><Icon name="close" /></button>}
              </div>
              <div className="sr-actions">
                <button type="button" className="sr-secondary sr-career-choose" onClick={() => setExplorer({ mode: "pick" })}>Chọn vị trí nghề nghiệp mục tiêu</button>
              </div>
            </div>
            {supportsSpecialty && <label className="sr-wide">
              <span><span id="sr-specialty-label">Chuyên ngành</span><span className="sr-required" aria-hidden="true"> *</span></span>
              <select ref={specialtyField} value={draft.specialty} aria-required="true" aria-labelledby="sr-specialty-label"
                aria-describedby={`sr-specialty-hint${draft.specialty ? "" : " sr-specialty-warning"}`}
                onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}>
                {specialtiesFor(profile.cohortCode, profile.majorCode).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                <option value="">Chưa xác định</option>
              </select>
              <small id="sr-specialty-hint">Cùng với khóa, dùng để chọn tiêu chuẩn xét tốt nghiệp của {advisorView ? "sinh viên" : "bạn"} và học phần chuyên ngành khi đánh giá năng lực.</small>
              {!draft.specialty && <small id="sr-specialty-warning" className="sr-field-warning">Cần chọn chuyên ngành để dùng Đánh giá năng lực.</small>}
            </label>}
          </fieldset>
          <div className="sr-actions sr-form-actions">
            <button
              className="sr-secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                stopEditing();
                setError("");
              }}
            >
              <Icon name="close" /> Hủy
            </button>
            <button className="sw-primary" disabled={busy}>
              <Icon name="save" /> {busy ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      ) : (
        <dl className="sr-personal">
          <div>
            <dt>Vị trí nghề nghiệp mục tiêu</dt>
            <dd className="sr-career-selection">
              <span>{shown.careerPosition ? (
                <>
                  {shown.careerPosition.nameVi} —{" "}
                  {shown.careerPosition.nameEn}
                  {shown.careerPosition.deletedAt && (
                    <small>
                      {" "}
                      (đã ngừng sử dụng; bạn có thể chọn vị trí nghề nghiệp khác)
                    </small>
                  )}
                </>
              ) : (
                "Chưa chọn vị trí nghề nghiệp mục tiêu."
              )}</span>
              {shown.careerPositionId && !shown.careerPosition?.deletedAt && <button type="button" className="sr-career-icon" aria-label="Xem yêu cầu của vị trí nghề nghiệp" title="Xem yêu cầu" onClick={() => setExplorer({ mode: "view", initialCareerId: shown.careerPositionId! })}><Icon name="eye" /></button>}
            </dd>
          </div>
          {supportsSpecialty && <div>
            <dt>Chuyên ngành</dt>
            <dd>{specialtyLabel(shown.specialty)}</dd>
          </div>}
        </dl>
      )}
      {explorer && <StudentCareerExplorer mode={explorer.mode} selectedId={shown.careerPositionId ?? ""} initialCareerId={explorer.initialCareerId} onSelect={pickCareer} onClose={() => setExplorer(null)} />}
      {confirming && confirmText && <ActingConfirmDialog {...confirmText} onClose={() => setConfirming(null)}
        onConfirm={() => { setConfirming(null); void send(confirming); }} />}
    </section>
  );
}
