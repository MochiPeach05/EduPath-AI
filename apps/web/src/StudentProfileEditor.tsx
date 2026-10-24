import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./student-icons";
import { type CareerSelection } from "./career-types";
import StudentCareerExplorer from "./StudentCareerExplorer";
import { specialtiesFor, specialtyLabel } from "./competency-assessment-types";
import "./student-records.css";
// "Sở thích" (technologies and free-time interests) moved into Khảo sát định hướng on 2026-10-24 (StudentProfileSurvey).
type EditableStudentProfile = {
  className: string | null;
  careerGoal: string | null;
  careerPositionId?: string | null;
  careerPosition?: CareerSelection | null;
  /** Absent until the API returns it; the field is hidden then so saving keeps working. */
  specialty?: string | null;
  /** Decides which specialties are offered (An ninh Mạng và IoTs: K27 only). */
  cohortCode?: string | null;
};
async function updateProfile(input: { careerPositionId: string | null; specialty?: string | null }) {
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
        ? "Vị trí nghề nghiệp này vừa bị xóa khỏi danh mục. Hãy chọn vị trí khác hoặc bỏ chọn."
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
  const [draftCareer, setDraftCareer] = useState<CareerSelection | null>(profile.careerPosition ?? null);
  const [explorer, setExplorer] = useState<{ initialCareerId?: string } | null>(null);
  const supportsSpecialty = profile.specialty !== undefined;
  useEffect(() => {
    if (!editing) {
      setDraft({
        careerPositionId: profile.careerPositionId ?? "",
        specialty: profile.specialty ?? "",
      });
      setDraftCareer(profile.careerPosition ?? null);
    }
  }, [profile, editing]);
  const chooseCareer = async (career: Pick<CareerSelection, "id" | "nameVi" | "nameEn">) => {
    setBusy(true);
    try {
      await updateProfile({ careerPositionId: career.id });
      setDraft(value => ({ ...value, careerPositionId: career.id }));
      setDraftCareer({ id: career.id, nameVi: career.nameVi, nameEn: career.nameEn, deletedAt: null });
      setExplorer(null);
      setError("");
      setMessage(`Đã lưu mục tiêu nghề nghiệp: ${career.nameVi}.`);
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { specialty } = draft;
      await updateProfile({
        careerPositionId: draft.careerPositionId || null,
        // Sent only when changed: "absent" keeps the stored value.
        ...(supportsSpecialty && specialty !== (profile.specialty ?? "") ? { specialty: specialty || null } : {}),
      });
      setMessage("Đã cập nhật thông tin cá nhân.");
      setEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sw-panel sr-editor">
      <div className="sw-section-heading">
        <h2>Thông tin cá nhân</h2>
        {!editing && (
          <button
            className="sw-text-link"
            onClick={() => {
              setEditing(true);
              setMessage("");
              setError("");
            }}
          >
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
        <form onSubmit={(e) => void save(e)}>
          <fieldset disabled={busy} className="sr-form-fields">
            <label>Lớp học<input value={profile.className ?? "Chưa cập nhật"} readOnly /></label>
            <div className="sr-wide sr-career-target">
              <strong>Vị trí nghề nghiệp mong muốn</strong>
              <div className="sr-career-selection">
                <span>{draftCareer ? `${draftCareer.nameVi} — ${draftCareer.nameEn}${draftCareer.deletedAt ? " (đã ngừng sử dụng)" : ""}` : "Chưa chọn vị trí nghề nghiệp."}</span>
                {draft.careerPositionId && <>
                  {!draftCareer?.deletedAt && <button type="button" className="sr-career-icon" aria-label="Xem yêu cầu nghề nghiệp" title="Xem yêu cầu" onClick={() => setExplorer({ initialCareerId: draft.careerPositionId })}><Icon name="eye" /></button>}
                  <button type="button" className="sr-career-icon sr-career-clear" aria-label="Bỏ chọn nghề mục tiêu" title="Bỏ chọn" onClick={() => { setDraft({ ...draft, careerPositionId: "" }); setDraftCareer(null); }}><Icon name="close" /></button>
                </>}
              </div>
              <div className="sr-actions">
                <button type="button" className="sr-secondary sr-career-choose" onClick={() => setExplorer({})}>Chọn nghề mục tiêu</button>
              </div>
            </div>
            {supportsSpecialty && <label>
              Chuyên ngành
              <select value={draft.specialty} onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}>
                {specialtiesFor(profile.cohortCode).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                <option value="">Chưa xác định</option>
              </select>
              <small>Cùng với khóa, dùng để chọn tiêu chuẩn xét tốt nghiệp của bạn và học phần chuyên ngành khi đánh giá năng lực.</small>
            </label>}
          </fieldset>
          <div className="sr-actions sr-form-actions">
            <button
              className="sr-secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
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
            <dt>Vị trí nghề nghiệp mong muốn</dt>
            <dd className="sr-career-selection">
              <span>{profile.careerPosition ? (
                <>
                  {profile.careerPosition.nameVi} —{" "}
                  {profile.careerPosition.nameEn}
                  {profile.careerPosition.deletedAt && (
                    <small>
                      {" "}
                      (đã ngừng sử dụng; bạn có thể chọn vị trí khác)
                    </small>
                  )}
                </>
              ) : (
                "Chưa chọn vị trí nghề nghiệp."
              )}</span>
              {profile.careerPositionId && !profile.careerPosition?.deletedAt && <button type="button" className="sr-career-icon" aria-label="Xem yêu cầu nghề nghiệp" title="Xem yêu cầu" onClick={() => setExplorer({ initialCareerId: profile.careerPositionId! })}><Icon name="eye" /></button>}
            </dd>
            <div className="sr-actions">
              <button type="button" className="sr-secondary sr-career-choose" onClick={() => setExplorer({})}>Chọn nghề mục tiêu</button>
            </div>
          </div>
          {supportsSpecialty && <div>
            <dt>Chuyên ngành</dt>
            <dd>{specialtyLabel(profile.specialty)}</dd>
          </div>}
        </dl>
      )}
      {explorer && <StudentCareerExplorer selectedId={profile.careerPositionId ?? ""} initialCareerId={explorer.initialCareerId} onSelect={chooseCareer} onClose={() => setExplorer(null)} />}
    </section>
  );
}
