import { useLayoutEffect, useRef } from "react";
import { Icon } from "./student-icons";
import { CAREER_GUIDANCE_API, FIT_SCORE_LABEL, FIT_STEP, fitScoreText, hasFit, reassessedOf, type GuidanceCareer, type GuidanceResponse } from "./career-guidance-data";
import { meaningClass } from "./display-format";
import { fitMeaning } from "./student-competency-data";

// The target vị trí nghề nghiệp, shared by Định hướng nghề nghiệp and the "Đổi vị trí nghề nghiệp mục tiêu" popup of Khoảng trống kỹ năng
// (user 2026-11-17): reading the fits, saving the target, and the fit's score, badge and target tag as both draw them.

export async function readGuidance(): Promise<GuidanceResponse> {
  const response = await fetch(CAREER_GUIDANCE_API, { credentials: "include", cache: "no-store" });
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  if (!response.ok) throw new Error("Chưa tải được thông tin định hướng nghề nghiệp. Vui lòng thử lại.");
  return response.json() as Promise<GuidanceResponse>;
}

/** Saves the target; reassessed: the API stored a new assessment for it (plan "Một bước để bắt đầu"). */
export async function saveTarget(careerId: string): Promise<{ reassessed: boolean }> {
  const response = await fetch("/api/student/profile", {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ careerPositionId: careerId }),
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (response.ok) return { reassessed: reassessedOf(body) };
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  throw new Error(body.error === "career_unavailable" ? "Vị trí này vừa bị xóa khỏi danh mục. Hãy chọn vị trí nghề nghiệp khác."
    : "Chưa lưu được vị trí nghề nghiệp mục tiêu. Vui lòng thử lại.");
}

/** The fit in the colour of its word, as on Khoảng trống kỹ năng (fitMeaning: Ít phù hợp amber, never green). */
export function FitBadge({ career, compact = false }: { career: GuidanceCareer; compact?: boolean }) {
  if (!career.fit) return <span className="cg-fit cg-fit-0">Chưa tính</span>;
  const step = FIT_STEP[career.fit.code];
  const meaning = fitMeaning(career.fit.code);
  return <span className={`cg-fit cg-fit-${step}${compact ? " cg-fit-compact" : ""}${meaning !== "none" ? ` ${meaningClass(meaning)}` : ""}`}>
    <span className="cg-pips" aria-hidden="true">{[1, 2, 3, 4, 5].map((pip) => <i key={pip} className={pip <= step ? "is-on" : undefined} />)}</span>
    {career.fit.label}
  </span>;
}

/** The điểm phù hợp kỹ năng out of 100; `named` reads its name to screen readers where the name is shown only as a column title. */
export function FitScore({ career, named = false }: { career: GuidanceCareer; named?: boolean }) {
  const name = named && <span className="sr-only">{FIT_SCORE_LABEL} </span>;
  return hasFit(career)
    ? <strong className="cg-score">{name}{fitScoreText(career.fit!.score!)}<small>/100</small></strong>
    : <strong className="cg-score cg-score-none">{name}—</strong>;
}

/**
 * The student's target among the vị trí nghề nghiệp. `action` stands in for the "Chọn làm vị trí nghề nghiệp mục tiêu" button, so it takes the
 * buttons' height and corners and lines up with the button beside it (advisor 2026-10-31: the label "bị lệch").
 */
export const TargetTag = ({ action = false }: { action?: boolean }) =>
  <span className={`cg-target-tag${action ? " cg-target-tag-action" : ""}`}><Icon name="check" />Vị trí nghề nghiệp mục tiêu</span>;

/** A modal that opens over the page, gives focus back to what opened it, and closes with Esc through onClose. */
export function useModal() {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return dialog;
}
