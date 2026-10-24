import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./student-icons";
import { type CareerSelection } from "./career-types";
import StudentCareerExplorer from "./StudentCareerExplorer";
import { specialtiesFor, specialtyLabel } from "./competency-assessment-types";
import { PROFILE_SECTIONS } from "./student-overview-data";
import "./student-records.css";
// "Sở thích" (technologies and free-time interests) moved into Khảo sát định hướng on 2026-10-24 (StudentProfileSurvey).
// "Mục tiêu học tập" (was "Thông tin cá nhân"): the career and the specialty. A career is chosen in Khám phá nghề nghiệp
// and saved at once, so the form opened by "Chỉnh sửa thông tin" holds only what Hủy can undo: the specialty and
// clearing the career.
type EditableStudentProfile = {
  careerPositionId?: string | null;
  careerPosition?: CareerSelection | null;
  /** Absent until the API returns it; the field is hidden then so saving keeps working. */
  specialty?: string | null;
  /** Decides which specialties are offered (An ninh Mạng và IoTs: K27 only). */
  cohortCode?: string | null;
};
type ProfileChanges = { careerPositionId?: string | null; specialty?: string | null };
async function updateProfile(input: ProfileChanges) {
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
        ? "Nghề này vừa bị xóa khỏi danh mục. Hãy chọn nghề khác."
        : body.error === "specialty_unavailable"
          ? "Chuyên ngành này không áp dụng cho khóa của bạn. Hãy chọn chuyên ngành khác."
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
  const [explorer, setExplorer] = useState<{ initialCareerId?: string } | null>(null);
  // What was just saved, shown until the reloaded profile arrives (onSaved reloads it).
  const [saved, setSaved] = useState<Partial<EditableStudentProfile> | null>(null);
  useEffect(() => setSaved(null), [profile]);
  const shown: EditableStudentProfile = saved ? { ...profile, ...saved } : profile;
  const supportsSpecialty = profile.specialty !== undefined;
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
  const chooseCareer = async (career: Pick<CareerSelection, "id" | "nameVi" | "nameEn">) => {
    await updateProfile({ careerPositionId: career.id });
    setSaved((current) => ({ ...current, careerPositionId: career.id, careerPosition: { id: career.id, nameVi: career.nameVi, nameEn: career.nameEn, deletedAt: null } }));
    setExplorer(null);
    setError("");
    setMessage(`Đã lưu nghề mục tiêu: ${career.nameVi}.`);
    onSaved();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      // Sent only when changed: "absent" keeps the stored value.
      const changes: ProfileChanges = {};
      if (draft.careerPositionId !== (shown.careerPositionId ?? "")) changes.careerPositionId = draft.careerPositionId || null;
      if (supportsSpecialty && draft.specialty !== (shown.specialty ?? "")) changes.specialty = draft.specialty || null;
      await updateProfile(changes);
      setSaved((current) => ({ ...current, ...changes, ...("careerPositionId" in changes ? { careerPosition: draftCareer } : {}) }));
      setMessage("Đã cập nhật mục tiêu học tập.");
      stopEditing();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
        <form ref={form} onSubmit={(e) => void save(e)}>
          <fieldset disabled={busy} className="sr-form-fields">
            <div className="sr-wide sr-career-target">
              <strong>Nghề mục tiêu</strong>
              <div className="sr-career-selection">
                <span>{draftCareer ? `${draftCareer.nameVi} — ${draftCareer.nameEn}${draftCareer.deletedAt ? " (đã ngừng sử dụng)" : ""}` : "Chưa chọn nghề mục tiêu."}</span>
                {draft.careerPositionId && <button type="button" className="sr-career-icon sr-career-clear" aria-label="Bỏ chọn nghề mục tiêu" title="Bỏ chọn" onClick={() => { setDraft({ ...draft, careerPositionId: "" }); setDraftCareer(null); }}><Icon name="close" /></button>}
              </div>
              <small className="sr-field-note">Để đổi nghề mục tiêu, hãy lưu hoặc hủy chỉnh sửa rồi bấm Chọn nghề mục tiêu.</small>
            </div>
            {supportsSpecialty && <label className="sr-wide">
              <span><span id="sr-specialty-label">Chuyên ngành</span><span className="sr-required" aria-hidden="true"> *</span></span>
              <select ref={specialtyField} value={draft.specialty} aria-required="true" aria-labelledby="sr-specialty-label"
                aria-describedby={`sr-specialty-hint${draft.specialty ? "" : " sr-specialty-warning"}`}
                onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}>
                {specialtiesFor(profile.cohortCode).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                <option value="">Chưa xác định</option>
              </select>
              <small id="sr-specialty-hint">Cùng với khóa, dùng để chọn tiêu chuẩn xét tốt nghiệp của bạn và học phần chuyên ngành khi đánh giá năng lực.</small>
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
            <dt>Nghề mục tiêu</dt>
            <dd className="sr-career-selection">
              <span>{shown.careerPosition ? (
                <>
                  {shown.careerPosition.nameVi} —{" "}
                  {shown.careerPosition.nameEn}
                  {shown.careerPosition.deletedAt && (
                    <small>
                      {" "}
                      (đã ngừng sử dụng; bạn có thể chọn nghề khác)
                    </small>
                  )}
                </>
              ) : (
                "Chưa chọn nghề mục tiêu."
              )}</span>
              {shown.careerPositionId && !shown.careerPosition?.deletedAt && <button type="button" className="sr-career-icon" aria-label="Xem yêu cầu nghề nghiệp" title="Xem yêu cầu" onClick={() => setExplorer({ initialCareerId: shown.careerPositionId! })}><Icon name="eye" /></button>}
            </dd>
            <div className="sr-actions">
              <button type="button" className="sr-secondary sr-career-choose" onClick={() => setExplorer({})}>Chọn nghề mục tiêu</button>
            </div>
          </div>
          {supportsSpecialty && <div>
            <dt>Chuyên ngành</dt>
            <dd>{specialtyLabel(shown.specialty)}</dd>
          </div>}
        </dl>
      )}
      {explorer && <StudentCareerExplorer selectedId={shown.careerPositionId ?? ""} initialCareerId={explorer.initialCareerId} onSelect={chooseCareer} onClose={() => setExplorer(null)} />}
    </section>
  );
}
