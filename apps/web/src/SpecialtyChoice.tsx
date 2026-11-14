import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { specialtiesFor, specialtyLabel } from "./competency-assessment-types";
import { isAdvisorView } from "./advisor-view";
import { ActingConfirmDialog, goalsConfirm } from "./acting-confirm";
import "./specialty-choice.css";

// Chuyên ngành is chosen where the transcript is imported (GVHD 2026-11-13: "chọn chuyên ngành trong giao diện import bảng
// điểm luôn, bên ngoài em thiết kế giao diện rất rối để chọn chuyên ngành"; plan "Một bước để bắt đầu", user 2026-11-14:
// "Triển khai theo kế hoạch này đi"). The choices are the specialties of the student's major and cohort, and "Chưa có
// chuyên ngành" for a student of year 1–2 not yet placed in one: the profile then keeps none (null), as "Chưa xác định"
// did. Since policy 2026-11-10 a cố vấn học tập or a Khoa admin may change it for the student, after a confirmation.

/** The choice "Chưa có chuyên ngành": no specialty in the profile (null). */
export const NO_SPECIALTY = "none";
/** "" = nothing chosen yet, NO_SPECIALTY, or a specialty code. */
export type SpecialtyPick = string;
/** What the choice needs from the profile: its specialty (absent on an older API), the cohort and the major of the MSSV. */
export type SpecialtyProfile = { specialty?: string | null; cohortCode?: string | null; majorCode?: string | null };

/** The choices of the student's major and cohort, then "Chưa có chuyên ngành" (withNone). */
export function specialtyOptions(profile: SpecialtyProfile | null, withNone = true): { value: string; label: string }[] {
  const options = specialtiesFor(profile?.cohortCode, profile?.majorCode).map((item) => ({ value: item.code, label: item.label }));
  return withNone ? [...options, { value: NO_SPECIALTY, label: "Chưa có chuyên ngành" }] : options;
}
/** What the choice starts from: the profile's specialty, else nothing (no specialty may also mean "not chosen yet"). */
export const initialPick = (specialty: string | null | undefined): SpecialtyPick => specialty || "";
/** The profile's value of a choice: null for "Chưa có chuyên ngành" and for no choice. */
export const pickedSpecialty = (pick: SpecialtyPick): string | null => (pick && pick !== NO_SPECIALTY ? pick : null);
/** Whether saving the choice changes the profile. */
export const pickChanges = (pick: SpecialtyPick, specialty: string | null | undefined) => pick !== "" && pickedSpecialty(pick) !== (specialty || null);
/** The specialty as the student reads it: its name, or "Chưa có chuyên ngành". */
export const specialtyText = (specialty: string | null | undefined) => (specialty ? specialtyLabel(specialty) : "Chưa có chuyên ngành");
/** The line under the choice. */
export const specialtyHint = (cohortCode: string | null | undefined) =>
  `Cùng với khóa ${cohortCode || "của bạn"}, dùng để chọn tiêu chuẩn xét tốt nghiệp và học phần chuyên ngành khi đánh giá năng lực. Đổi lại được bất cứ lúc nào.`;

/** A refused save, with the words to show. */
export class SpecialtySaveError extends Error {}
/** What a refused PATCH says; advisorView: the words speak of the student. */
export function specialtyErrorMessage(code: string | undefined, status: number, advisorView = false): string {
  if (code === "specialty_unavailable") return `Chuyên ngành này không áp dụng cho khóa của ${advisorView ? "sinh viên" : "bạn"}. Hãy chọn chuyên ngành khác.`;
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 400) return "Chuyên ngành chưa hợp lệ. Vui lòng chọn lại.";
  return "Chưa lưu được chuyên ngành. Vui lòng thử lại.";
}
/** PATCH /api/student/profile { specialty }: only the specialty changes. Throws SpecialtySaveError with the words to show. */
export async function saveSpecialty(specialty: string | null, advisorView = isAdvisorView()): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/student/profile", {
      method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ specialty }),
    });
  } catch {
    throw new SpecialtySaveError("Chưa lưu được chuyên ngành. Vui lòng kiểm tra kết nối và thử lại.");
  }
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  throw new SpecialtySaveError(specialtyErrorMessage(body.error, response.status, advisorView));
}
/** The confirmation a cố vấn học tập or a Khoa admin sees before the specialty changes for the student. */
export const specialtyConfirm = (pick: SpecialtyPick, confirm: string) =>
  goalsConfirm({ specialty: pickedSpecialty(pick) ? specialtyLabel(pickedSpecialty(pick)) : null }, confirm);

/**
 * The choice of the specialty: radio cards (Hồ sơ và bảng điểm) or a select (the short import of Tổng quan and Xét tốt
 * nghiệp). value is a SpecialtyPick; "" shows no choice and a select its "Chọn chuyên ngành…" line.
 */
export default function SpecialtyChoice({ profile, value, onChange, variant = "cards", withNone = true, disabled = false, label = "Chuyên ngành của bạn", hint = true, error = "", id }: {
  profile: SpecialtyProfile | null;
  value: SpecialtyPick;
  onChange: (value: SpecialtyPick) => void;
  variant?: "cards" | "select";
  /** Offer "Chưa có chuyên ngành". */
  withNone?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: boolean;
  error?: string;
  id?: string;
}) {
  const generated = useId();
  const base = id ?? generated;
  const options = specialtyOptions(profile, withNone);
  const hintId = `${base}-hint`, errorId = `${base}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  const required = <span className="spc-required" aria-hidden="true"> *</span>;
  const notes = <>
    {hint && <small id={hintId} className="spc-hint">{specialtyHint(profile?.cohortCode)}</small>}
    {error && <p id={errorId} className="spc-error" role="alert">{error}</p>}
  </>;
  if (variant === "select") {
    return <div className="spc spc-select">
      <label className="spc-label" htmlFor={`${base}-select`}>{label}{required}</label>
      <select id={`${base}-select`} value={value} disabled={disabled} required aria-describedby={describedBy} aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}>
        {value === "" && <option value="" disabled>Chọn chuyên ngành…</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {notes}
    </div>;
  }
  return <fieldset className="spc spc-cards" disabled={disabled} aria-describedby={describedBy}>
    <legend className="spc-label">{label}{required}</legend>
    <div className="spc-options">{options.map((option) =>
      <label key={option.value} className={`spc-option${value === option.value ? " is-on" : ""}${option.value === NO_SPECIALTY ? " spc-none" : ""}`}>
        <input type="radio" name={`${base}-specialty`} value={option.value} checked={value === option.value} required onChange={() => onChange(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>
    {notes}
  </fieldset>;
}

/**
 * The specialty alone, saved at once ("Đổi" on the transcript bar, Tổng quan and Xét tốt nghiệp when a transcript has no
 * specialty). initial: the choice to start from (Xét tốt nghiệp's suggestion), else the profile's. onSaved gets the stored value.
 */
export function SpecialtyForm({ profile, initial, variant = "cards", withNone = true, label, saveLabel = "Lưu chuyên ngành", focusOnMount = false, onSaved, onCancel }: {
  profile: SpecialtyProfile | null;
  initial?: SpecialtyPick;
  variant?: "cards" | "select";
  withNone?: boolean;
  label?: string;
  saveLabel?: string;
  /** Opened by a button that is gone now (Đổi): the keyboard focus goes to the choice. */
  focusOnMount?: boolean;
  onSaved: (specialty: string | null) => void;
  onCancel?: () => void;
}) {
  const [pick, setPick] = useState<SpecialtyPick>(() => initial ?? initialPick(profile?.specialty));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const advisorView = isAdvisorView();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!focusOnMount) return;
    form.current?.querySelector<HTMLElement>("input:checked, select, input")?.focus();
  }, [focusOnMount]);
  const send = async () => {
    setBusy(true); setError("");
    try {
      await saveSpecialty(pickedSpecialty(pick), advisorView);
      onSaved(pickedSpecialty(pick));
    } catch (failure) {
      setError(failure instanceof SpecialtySaveError ? failure.message : "Chưa lưu được chuyên ngành. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pick) { setError("Hãy chọn chuyên ngành."); return; }
    // Nothing changes: nothing is sent.
    if (!pickChanges(pick, profile?.specialty)) { if (onCancel) onCancel(); else onSaved(pickedSpecialty(pick)); return; }
    if (advisorView) { setConfirming(true); return; }
    void send();
  };
  return <form ref={form} className={`spc-form spc-form-${variant}`} onSubmit={submit} aria-busy={busy}>
    <SpecialtyChoice profile={profile} value={pick} onChange={(value) => { setPick(value); setError(""); }} variant={variant} withNone={withNone}
      disabled={busy} label={label} error={error} />
    <div className="spc-actions">
      {onCancel && <button type="button" className="sr-secondary" disabled={busy} onClick={onCancel}>Hủy</button>}
      <button type="submit" className="sw-primary" disabled={busy || !pick}>{busy ? "Đang lưu…" : saveLabel}</button>
    </div>
    {confirming && <ActingConfirmDialog {...specialtyConfirm(pick, saveLabel)} onClose={() => setConfirming(false)}
      onConfirm={() => { setConfirming(false); void send(); }} />}
  </form>;
}
