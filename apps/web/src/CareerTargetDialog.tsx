import { useEffect, useRef, useState } from "react";
import { Icon } from "./student-icons";
import { FIT_ORDER_TEXT, FIT_SCORE_LABEL, blockedText, filterCareers, gapTargetSavedText, type GuidanceCareer, type GuidanceResponse } from "./career-guidance-data";
import { FitBadge, FitScore, TargetTag, readGuidance, saveTarget, useModal } from "./career-target";
import { isAdvisorView } from "./advisor-view";
import { ActingConfirmDialog, goalsConfirm } from "./acting-confirm";
import "./career-guidance.css";

// "Đổi vị trí nghề nghiệp mục tiêu" without leaving Khoảng trống kỹ năng (user 2026-11-17: "có thể hiện 1 popup đổi ở trang này luôn được
// không, không cần phải qua trang định hướng nghề nghiệp"): every vị trí nghề nghiệp with its điểm phù hợp kỹ năng, best first, found by
// name and chosen in one click. It saves like Định hướng nghề nghiệp (PATCH /api/student/profile, the API assesses again when it can); a cố
// vấn học tập or Khoa admin working in the student's page confirms first. Details and comparisons stay on Định hướng nghề nghiệp.

/** The list of the popup, best fit first (by name while no fit can be computed), the target marked in place of its button. */
export function CareerTargetList({ data, query, saving, onPick }: {
  data: GuidanceResponse; query: string; saving: string | null; onPick: (career: GuidanceCareer) => void;
}) {
  const visible = filterCareers(data.careers, { q: query, field: "" });
  return <>
    <p className="sw-muted" role="status">{visible.length} vị trí nghề nghiệp · {data.blocked ? "Sắp xếp theo tên" : FIT_ORDER_TEXT}</p>
    {visible.length ? <ul className="cg-list ctd-list">{visible.map((career) => <li key={career.id} className={career.isTarget ? "is-target" : undefined}>
      <div className="cg-row-main"><h4>{career.nameVi}</h4><p className="cg-en">{career.nameEn} · {career.categoryName}</p></div>
      <div className="cg-row-fit"><span className="cg-score-label">{FIT_SCORE_LABEL}</span><FitScore career={career} /><FitBadge career={career} /></div>
      <div className="cg-actions">{career.isTarget ? <TargetTag action />
        : <button type="button" className="sw-outline" disabled={saving !== null} onClick={() => onPick(career)} aria-label={`Chọn làm mục tiêu: ${career.nameVi}`}>
          <Icon name="check" />{saving === career.id ? "Đang lưu…" : "Chọn làm mục tiêu"}</button>}</div>
    </li>)}</ul> : <p className="cg-empty">Không có vị trí nghề nghiệp nào khớp từ khóa.</p>}
  </>;
}

/** onSaved: the sentence the page shows, and whether the API stored a new assessment for the new target. */
export default function CareerTargetDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (text: string, reassessed: boolean) => void }) {
  const dialog = useModal();
  const search = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<GuidanceResponse | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [confirming, setConfirming] = useState<GuidanceCareer | null>(null);

  useEffect(() => {
    let alive = true;
    setError("");
    readGuidance().then((value) => { if (alive) setData(value); }, (failure: Error) => { if (alive) setError(failure.message); });
    return () => { alive = false; };
  }, [attempt]);
  // The search takes the typing once the list is there.
  const loaded = data !== null;
  useEffect(() => { if (loaded) search.current?.focus(); }, [loaded]);

  const choose = async (career: GuidanceCareer) => {
    setSaving(career.id);
    setSaveError("");
    try {
      const { reassessed } = await saveTarget(career.id);
      onSaved(gapTargetSavedText(career.nameVi, reassessed), reassessed);
    } catch (failure) {
      setSaveError((failure as Error).message);
      setSaving(null);
    }
  };
  // Working for the student, the choice is confirmed first; the student chooses at once.
  const pick = (career: GuidanceCareer) => { if (isAdvisorView()) setConfirming(career); else void choose(career); };
  const close = () => { if (saving === null) onClose(); };

  return <>
    <dialog ref={dialog} className="cg-dialog ctd-dialog" aria-labelledby="ctd-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <header>
        <div><h2 id="ctd-title">Đổi vị trí nghề nghiệp mục tiêu</h2>
          <p className="cg-en">Khoảng trống kỹ năng so kỹ năng của bạn với yêu cầu của vị trí bạn chọn.</p></div>
        <button type="button" className="sr-secondary" onClick={close} disabled={saving !== null} aria-label="Đóng hộp chọn vị trí nghề nghiệp"><Icon name="close" />Đóng</button>
      </header>
      <div className="cg-dialog-body">
        {error ? <div className="sr-error" role="alert">{error} <button type="button" className="sw-text-link" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></div>
          : !data ? <p role="status">Đang tính điểm phù hợp với từng vị trí nghề nghiệp…</p>
            : <>
              {data.blocked && <p className="cg-note cg-note-warn">{blockedText(data.blocked)} Bạn vẫn chọn được vị trí nghề nghiệp mục tiêu.</p>}
              <div className="cg-filters ctd-search"><label>Tìm vị trí nghề nghiệp<input ref={search} value={query} maxLength={100}
                placeholder="Tên tiếng Việt hoặc tiếng Anh…" onChange={(event) => setQuery(event.target.value)} /></label></div>
              {saveError && <div className="sr-error" role="alert">{saveError}</div>}
              <CareerTargetList data={data} query={query} saving={saving} onPick={pick} />
            </>}
      </div>
      <footer className="ctd-footer"><p>Muốn xem yêu cầu kỹ năng của từng vị trí hoặc so sánh các vị trí? <a className="sw-text-link" href="#career">Mở Định hướng nghề nghiệp</a></p></footer>
    </dialog>
    {confirming && <ActingConfirmDialog {...goalsConfirm({ career: confirming.nameVi }, "Chọn làm mục tiêu")} onClose={() => setConfirming(null)}
      onConfirm={() => { const career = confirming; setConfirming(null); void choose(career); }} />}
  </>;
}
