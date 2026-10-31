import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./student-icons";
import {
  CAREER_GUIDANCE_API, COMPARE_MAX, FIT_ORDER_TEXT, FIT_RULE_TEXT, FIT_SCORE_LABEL, FIT_STEP, bestFitsHeading, blockedAction, blockedText, careerPicks, compareRows, filterCareers, fitRuleText,
  fitScoreText, fitSummary, gapNote, hasFit, interestReason, matchesInterests, metSkills, missingSkills, nameList, orderedRequirements, requirementName,
  requirementScoreText, requirementSourcesText, requirementState, surveyInterests, toggleCompare, type CareerFilters, type GuidanceCareer, type GuidanceResponse,
  type GuidanceRequirement,
} from "./career-guidance-data";
import { meaningClass } from "./display-format";
import { fitMeaning } from "./student-competency-data";
import "./career-guidance.css";

// "Định hướng nghề nghiệp" (#career, user 2026-10-24: "làm theo ý bạn muốn nhưng vẫn phải phù hợp với đề tài"): the
// careers that suit the student's competencies and Khảo sát định hướng, every career with its fit, a side-by-side
// comparison of up to three careers, and choosing the target career. The system computes the fits; no AI.
// Read top-down since 2026-10-31 (user: "Giao diện đưa ra quá nhiều thông tin, sinh viên không biết nên đọc gì. Ưu tiên kết
// quả phù hợp nhất; phân cấp nội dung và giảm các phần phụ không cần thiết"; approved preview
// https://claude.ai/code/artifact/1207975d-ae6e-444f-97ba-b449810e7555): the best fit with why, then "Theo bảng xếp hạng"
// and "Theo Khảo sát định hướng" side by side, then every career folded.

/** link: the text asks to re-assess, so the notice links to Đánh giá năng lực. */
type Notice = { tone: "success" | "error"; text: string; link?: boolean } | null;

const reducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

async function readGuidance(): Promise<GuidanceResponse> {
  const response = await fetch(CAREER_GUIDANCE_API, { credentials: "include", cache: "no-store" });
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  if (!response.ok) throw new Error("Chưa tải được thông tin định hướng nghề nghiệp. Vui lòng thử lại.");
  return response.json() as Promise<GuidanceResponse>;
}

async function saveTarget(careerId: string): Promise<void> {
  const response = await fetch("/api/student/profile", {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ careerPositionId: careerId }),
  });
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  throw new Error(body.error === "career_unavailable" ? "Nghề này vừa bị xóa khỏi danh mục. Hãy chọn nghề khác." : "Chưa lưu được nghề mục tiêu. Vui lòng thử lại.");
}

/** The fit in the colour of its word, as on Khoảng trống kỹ năng (fitMeaning: Ít phù hợp amber, never green). */
function FitBadge({ career, compact = false }: { career: GuidanceCareer; compact?: boolean }) {
  if (!career.fit) return <span className="cg-fit cg-fit-0">Chưa tính</span>;
  const step = FIT_STEP[career.fit.code];
  const meaning = fitMeaning(career.fit.code);
  return <span className={`cg-fit cg-fit-${step}${compact ? " cg-fit-compact" : ""}${meaning !== "none" ? ` ${meaningClass(meaning)}` : ""}`}>
    <span className="cg-pips" aria-hidden="true">{[1, 2, 3, 4, 5].map((pip) => <i key={pip} className={pip <= step ? "is-on" : undefined} />)}</span>
    {career.fit.label}
  </span>;
}

/** The điểm phù hợp kỹ năng out of 100; `named` reads its name to screen readers where the name is shown only as a column title. */
function FitScore({ career, named = false }: { career: GuidanceCareer; named?: boolean }) {
  const name = named && <span className="sr-only">{FIT_SCORE_LABEL} </span>;
  return hasFit(career)
    ? <strong className="cg-score">{name}{fitScoreText(career.fit!.score!)}<small>/100</small></strong>
    : <strong className="cg-score cg-score-none">{name}—</strong>;
}

function InterestTags({ career }: { career: GuidanceCareer }) {
  if (!matchesInterests(career)) return null;
  return <p className="cg-interest">
    <Icon name="spark" />
    <span>{[career.interests.field && `Lĩnh vực bạn quan tâm: ${career.interests.field}`, career.interests.tech.length > 0 && `Thế mạnh: ${career.interests.tech.join(", ")}`]
      .filter(Boolean).join(" · ")}</span>
  </p>;
}

function StateChip({ requirement }: { requirement: GuidanceRequirement }) {
  const state = requirementState(requirement);
  return <span className={`cg-state cg-state-${state.tone}`}><span aria-hidden="true">{state.glyph}</span> {state.text}</span>;
}

const TargetTag = () => <span className="cg-target-tag"><Icon name="check" />Nghề mục tiêu của bạn</span>;

/** The compare checkbox of a career in "Tất cả nghề" (at most COMPARE_MAX careers). */
function CompareToggle({ career, compared, compareFull, onCompare }: { career: GuidanceCareer; compared: boolean; compareFull: boolean; onCompare: () => void }) {
  return <label className={`cg-compare-toggle${!compared && compareFull ? " is-disabled" : ""}`}>
    <input type="checkbox" checked={compared} disabled={!compared && compareFull} onChange={onCompare} aria-label={`So sánh ${career.nameVi}`} />
    <span>So sánh</span>
  </label>;
}

/** The fit as a half gauge in the colour of its word (fitMeaning), next to the score of the best fit. */
function FitGauge({ career }: { career: GuidanceCareer }) {
  const score = hasFit(career) ? Math.min(100, Math.max(0, career.fit!.score!)) : 0;
  const meaning = career.fit ? fitMeaning(career.fit.code) : "none";
  const length = Math.PI * 48;
  return <svg className="cg-gauge" viewBox="0 0 120 70" aria-hidden="true">
    <path d="M12 62 A48 48 0 0 1 108 62" className="cg-gauge-track" />
    <path d="M12 62 A48 48 0 0 1 108 62" className={`cg-gauge-value cg-gauge-${meaning}`} strokeDasharray={`${(length * score) / 100} ${length}`} />
  </svg>;
}

/** The first of "Vị trí nghề nghiệp phù hợp với năng lực hiện tại": the best fit, why it suits, what is still missing, and the way to choose it. */
function TopPick({ career, scored, saving, onDetail, onChoose }: { career: GuidanceCareer; scored: number; saving: boolean; onDetail: () => void; onChoose: () => void }) {
  const met = metSkills(career), missing = missingSkills(career);
  return <article className="sw-panel cg-top" aria-labelledby="cg-top-name">
    <div className="cg-top-main">
      <span className="cg-kicker">Hạng 1 / {scored} nghề</span>
      <h3 id="cg-top-name">{career.nameVi}</h3>
      <p className="cg-en">{career.nameEn} · {career.categoryName}</p>
      <ul className="cg-why">
        {career.fit && <li className="cg-why-ok"><i aria-hidden="true">✓</i><span><b>Đạt {career.fit.met}/{career.fit.total} kỹ năng yêu cầu</b>{met.length > 0 && `: ${nameList(met, 4)}`}</span></li>}
        {matchesInterests(career) && <li className="cg-why-like"><i aria-hidden="true">♥</i><span><b>Hợp Khảo sát định hướng của bạn:</b> {interestReason(career).replace(/^Khớp: /, "")}</span></li>}
        {missing.length > 0 && <li className="cg-why-gap"><i aria-hidden="true">!</i><span><b>Còn thiếu:</b> {nameList(missing)}</span></li>}
      </ul>
      <div className="cg-top-actions">
        {career.isTarget ? <TargetTag />
          : <button type="button" className="sw-primary" disabled={saving} onClick={onChoose}><Icon name="check" />{saving ? "Đang lưu…" : "Chọn làm nghề mục tiêu"}</button>}
        <button type="button" className="sr-secondary" onClick={onDetail} aria-label={`Xem chi tiết ${career.nameVi}`}><Icon name="eye" />Xem chi tiết</button>
      </div>
    </div>
    <div className="cg-top-score">
      <span className="cg-score-label">{FIT_SCORE_LABEL}</span>
      <FitGauge career={career} />
      <FitScore career={career} />
      <FitBadge career={career} />
    </div>
  </article>;
}

/** "Đạt 3/5 kỹ năng · thiếu Node.js, Docker": the line of a career in "Theo bảng xếp hạng". */
function rankLine(career: GuidanceCareer): string {
  const missing = missingSkills(career);
  return career.fit ? `Đạt ${career.fit.met}/${career.fit.total} kỹ năng${missing.length ? ` · thiếu ${nameList(missing, 2)}` : ""}` : "Chưa tính được mức phù hợp";
}

/** One row of "Theo bảng xếp hạng" (its rank) or "Theo Khảo sát định hướng" (a heart); the name opens the details. */
function PickRow({ career, marker, line, onDetail }: { career: GuidanceCareer; marker: string; line: string; onDetail: () => void }) {
  return <li>
    <span className="cg-pos" aria-hidden="true">{marker}</span>
    <button type="button" className="cg-pick-name" onClick={onDetail} aria-label={`Xem chi tiết ${career.nameVi}`}><b>{career.nameVi}</b><small>{line}</small></button>
    <span className="cg-pick-fit"><FitScore career={career} named /><FitBadge career={career} compact /></span>
  </li>;
}

/** The column titles above the rows of "Theo bảng xếp hạng" and "Theo Khảo sát định hướng" (screen readers get them from FitScore `named`). */
const PickHead = () => <div className="cg-pick-head" aria-hidden="true"><span /><span>Vị trí nghề nghiệp</span><span>{FIT_SCORE_LABEL}</span></div>;

function DetailDialog({ career, saving, onChoose, onClose }: { career: GuidanceCareer; saving: boolean; onChoose: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  const missing = missingSkills(career);
  return <dialog ref={dialog} className="cg-dialog" aria-labelledby="cg-detail-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header>
      <div><h2 id="cg-detail-title">{career.nameVi}</h2><p className="cg-en">{career.nameEn} · {career.categoryName}</p></div>
      <button type="button" className="sr-secondary" onClick={onClose} aria-label="Đóng chi tiết nghề"><Icon name="close" />Đóng</button>
    </header>
    <div className="cg-dialog-body">
      <div className="cg-detail-fit"><span className="cg-score-label">{FIT_SCORE_LABEL}</span><FitScore career={career} /><FitBadge career={career} />{career.fit && <span>{fitSummary(career)}</span>}</div>
      {career.fit && <p className="cg-fit-rule">{fitRuleText(career)}</p>}
      <InterestTags career={career} />
      <p className="cg-description">{career.description || "Khoa chưa bổ sung mô tả công việc cho nghề này."}</p>
      <h3>Yêu cầu kỹ năng và mức hiện tại của bạn</h3>
      {career.requirements.length ? <div className="cg-table-scroll" tabIndex={0} role="region" aria-label={`Yêu cầu của ${career.nameVi}`}>
        <table className="cg-table">
          <thead><tr><th scope="col">Kỹ năng</th><th scope="col" className="cg-nowrap">Tính chất</th><th scope="col" className="cg-num">Điểm</th><th scope="col">Mức hiện tại của bạn</th></tr></thead>
          <tbody>{orderedRequirements(career).map((row, index) => <tr key={`${row.title}-${index}`}>
            <td><strong>{requirementName(row)}</strong>{row.skillName && row.title !== row.skillName && <small>{row.title}</small>}
              {requirementSourcesText(row) && <small>{requirementSourcesText(row)}</small>}</td>
            <td className="cg-nowrap">{row.isRequired ? "Bắt buộc" : "Ưu tiên"}</td>
            <td className="cg-num">{requirementScoreText(row)}</td>
            <td><StateChip requirement={row} />{row.status === "no_data" && <small>{row.noDataReason === "other_specialty"
              ? `Chỉ có trong học phần của chuyên ngành khác${row.otherSpecialtyCourses.length ? `: ${row.otherSpecialtyCourses.join(", ")}` : ""}.`
              : row.noDataReason === "elective_not_chosen"
                ? "Chỉ có trong học phần tự chọn bạn không chọn (nhóm tự chọn đã đủ tín chỉ)."
                : "Chương trình đào tạo chưa có học phần đo kỹ năng này — không phải điểm yếu."}</small>}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p>Khoa chưa cập nhật yêu cầu kỹ năng cho nghề này.</p>}
      {missing.length > 0 && <p className="cg-note">Để phù hợp hơn với nghề này, bạn nên bổ sung các kỹ năng: {missing.join(", ")}. {career.isTarget
        ? "Các học phần nên học cho từng kỹ năng có ở trang Khoảng trống kỹ năng."
        : "Các học phần nên học cho từng kỹ năng sẽ hiện ở trang Khoảng trống kỹ năng sau khi bạn chọn nghề này làm mục tiêu và đánh giá lại."}</p>}
    </div>
    <footer className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" onClick={onClose}><Icon name="close" />Đóng</button>
      {career.isTarget ? <span className="cg-target-tag"><Icon name="check" />Nghề mục tiêu của bạn</span>
        : <button type="button" className="sw-primary" disabled={saving} onClick={onChoose}><Icon name="check" />{saving ? "Đang lưu…" : "Chọn nghề mục tiêu"}</button>}
    </footer>
  </dialog>;
}

function CompareSection({ careers, onRemove }: { careers: GuidanceCareer[]; onRemove: (id: string) => void }) {
  const rows = compareRows(careers);
  return <section className="sw-panel cg-compare" id="cg-compare" aria-labelledby="cg-compare-title" tabIndex={-1}>
    <div className="cg-section-head"><div><h3 id="cg-compare-title">So sánh nghề nghiệp</h3><p className="sw-muted">Mức phù hợp và từng kỹ năng của các nghề bạn chọn, tính từ năng lực hiện tại của bạn.</p></div></div>
    <div className="cg-table-scroll" tabIndex={0} role="region" aria-label="Bảng so sánh nghề nghiệp">
      <table className="cg-table cg-compare-table">
        <thead><tr><th scope="col">Tiêu chí</th>{careers.map((career) => <th key={career.id} scope="col">
          <span className="cg-compare-name">{career.nameVi}</span><small>{career.nameEn}</small>
          <button type="button" className="cg-remove" onClick={() => onRemove(career.id)} aria-label={`Bỏ ${career.nameVi} khỏi so sánh`}><Icon name="close" /></button>
        </th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">Lĩnh vực</th>{careers.map((career) => <td key={career.id}>{career.categoryName}</td>)}</tr>
          <tr><th scope="row">{FIT_SCORE_LABEL}</th>{careers.map((career) => <td key={career.id}><div className="cg-compare-fit"><FitScore career={career} /><FitBadge career={career} /></div></td>)}</tr>
          <tr><th scope="row">Kỹ năng đạt</th>{careers.map((career) => <td key={career.id}>{career.fit ? `${career.fit.met}/${career.fit.total}` : "—"}</td>)}</tr>
          <tr><th scope="row">Hợp với khảo sát của bạn</th>{careers.map((career) => <td key={career.id}>{matchesInterests(career) ? [career.interests.field, ...career.interests.tech].filter(Boolean).join(", ") : "—"}</td>)}</tr>
          {rows.map((row) => <tr key={row.name}><th scope="row">{row.name}</th>{row.cells.map((cell, index) => <td key={careers[index]!.id}>
            {cell ? <><StateChip requirement={cell} /><small className="cg-priority">{cell.isRequired ? "Bắt buộc" : "Ưu tiên"}</small></> : <span className="cg-not-needed">Không yêu cầu</span>}
          </td>)}</tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

export default function StudentCareerGuidance({ onProfileChanged }: { onProfileChanged: () => void }) {
  const [data, setData] = useState<GuidanceResponse | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState<CareerFilters>({ q: "", field: "" });
  const [allOpen, setAllOpen] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const toast = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setError("");
    readGuidance().then((value) => alive && setData(value), (failure: Error) => alive && setError(failure.message));
    return () => { alive = false; };
  }, [revision]);

  // Every career stays one click away; opened at once when no fit can be computed (nothing else to read then).
  const blocked = data?.blocked ?? null;
  useEffect(() => { if (blocked) setAllOpen(true); }, [blocked]);

  const choose = useCallback(async (career: GuidanceCareer) => {
    setSaving(career.id);
    setNotice(null);
    try {
      await saveTarget(career.id);
    } catch (failure) {
      setNotice({ tone: "error", text: (failure as Error).message });
      setSaving(null);
      return;
    }
    onProfileChanged();
    // The page reads again what the server says now, Khoảng trống kỹ năng's career included, rather than guessing it.
    const fresh = await readGuidance().catch(() => null);
    setData((value) => fresh ?? (value && {
      ...value, targetCareerId: career.id, deletedTargetName: null, gapCurrent: value.gapCareerId === career.id,
      careers: value.careers.map((item) => ({ ...item, isTarget: item.id === career.id })),
    }));
    setNotice(fresh?.gapCareerId === career.id
      ? { tone: "success", text: `Đã chọn ${career.nameVi} làm nghề mục tiêu. Khoảng trống kỹ năng cũng đang hiển thị nghề này.` }
      : { tone: "success", text: `Đã chọn ${career.nameVi} làm nghề mục tiêu. Bấm Đánh giá lại ở trang Đánh giá năng lực để cập nhật Khoảng trống kỹ năng và Lộ trình học tập theo nghề mới.`, link: true });
    setSaving(null);
  }, [onProfileChanged]);

  // The chosen row's button gives way to "Nghề mục tiêu của bạn": keyboard focus goes to the notice instead of the page top.
  useEffect(() => {
    if (notice?.tone !== "success") return;
    const active = document.activeElement;
    if ((!active || active === document.body) && !document.querySelector("dialog[open]")) toast.current?.focus({ preventScroll: true });
  }, [notice]);

  const showCompare = () => {
    const section = document.getElementById("cg-compare");
    if (!section) return;
    section.focus({ preventScroll: true });
    section.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  };

  const careers = data?.careers ?? [];
  const visible = useMemo(() => filterCareers(careers, filters), [careers, filters]);
  const compared = compare.map((id) => careers.find((career) => career.id === id)).filter((career): career is GuidanceCareer => Boolean(career));
  const detail = careers.find((career) => career.id === detailId) ?? null;
  const target = careers.find((career) => career.isTarget) ?? null;

  if (error) return <section className="sw-panel cg-problem" role="alert"><strong>Chưa tải được định hướng nghề nghiệp</strong><p>{error}</p>
    <button type="button" className="sw-outline" onClick={() => setRevision((value) => value + 1)}><Icon name="refresh" />Thử lại</button></section>;
  if (!data) return <section className="sw-panel" aria-busy="true"><p role="status">Đang tính mức phù hợp với từng nghề…</p></section>;

  const picks = careerPicks(careers);
  const shownPicks = [picks.top, ...picks.ranked].filter((career): career is GuidanceCareer => Boolean(career));
  // The order of the ranking; before any career reaches Trung bình, also why the scores are low.
  const heading = bestFitsHeading(shownPicks);
  const interests = surveyInterests(careers);
  // After "Xóa kết quả đánh giá" the note of the page says it all.
  const targetNote = target && data.blocked !== "assessment_withdrawn" ? gapNote(data, target) : null;
  const unblock = data.blocked ? blockedAction(data.blocked) : null;
  const openDetail = (career: GuidanceCareer) => () => setDetailId(career.id);

  return <div className="cg-page">
    <section className="cg-intro" aria-label="Về trang này">
      <p className="cg-lead">Nghề hợp với bạn nhất trong {careers.length} nghề của Khoa, tính từ điểm kỹ năng trong bảng điểm và Khảo sát định hướng. Kết quả chỉ để tham khảo.</p>
      <p className="cg-define"><b>{FIT_SCORE_LABEL}</b> (gọi tắt là điểm phù hợp, thang 100) là con số cạnh mỗi vị trí nghề nghiệp: cho biết kỹ năng
        hiện tại của bạn đáp ứng yêu cầu kỹ năng của vị trí đó đến đâu. Điểm càng cao, vị trí càng phù hợp với bạn.</p>
      <details className="cg-how"><summary>Cách tính điểm phù hợp kỹ năng</summary>
        <p>{FIT_RULE_TEXT} Mức phù hợp được tính giống trang Khoảng trống kỹ năng: Rất phù hợp từ 90, Phù hợp từ 80, Trung bình từ 62,5, Ít phù hợp từ 50.</p>
      </details>
    </section>

    <div className="cg-target-line">
      <span className="cg-target-label">Nghề mục tiêu hiện tại:</span>
      {target ? <><strong>{target.nameVi}</strong><span className="cg-target-score"><span className="cg-target-label">{FIT_SCORE_LABEL}:</span><FitScore career={target} /></span><FitBadge career={target} />
        <a className="sw-text-link" href="#skill-gap">Xem Khoảng trống kỹ năng <Icon name="arrow" /></a></>
        : data.deletedTargetName ? <span>{data.deletedTargetName}: nghề này không còn trong danh mục; bạn nên chọn nghề khác.</span>
          : <span>chưa chọn. Hãy chọn một nghề bên dưới.</span>}
      {targetNote && <p className="cg-note cg-note-warn">{targetNote}</p>}
    </div>

    {data.blocked && <div className="cg-note cg-note-warn" role="note"><p>{blockedText(data.blocked)} Bạn vẫn xem được danh mục nghề và yêu cầu của từng nghề.</p>
      {unblock && <a className="sw-outline" href={unblock.href}>{unblock.label}</a>}</div>}

    {!data.blocked && <>
      <div className="cg-level"><h3 id="cg-best-title">{heading.title}</h3><p>{heading.note}</p></div>
      {picks.top ? <TopPick career={picks.top} scored={picks.scored} saving={saving === picks.top.id} onDetail={openDetail(picks.top)} onChoose={() => void choose(picks.top!)} />
        : <p className="cg-empty">Chưa đủ dữ liệu để gợi ý: các kỹ năng của nghề chưa được đo bằng học phần bạn đã học.</p>}

      <div className="cg-level"><h3>Các lựa chọn khác</h3><p>Không lặp lại nghề đã hiện ở trên.</p></div>
      <div className="cg-pairs">
        <section className="sw-panel cg-pick" aria-labelledby="cg-rank-title">
          <header><h4 id="cg-rank-title">Theo bảng xếp hạng</h4><p>Các nghề tiếp theo, sắp xếp theo điểm phù hợp giảm dần.</p></header>
          {picks.ranked.length ? <><PickHead /><ol className="cg-pick-list">{picks.ranked.map((career, index) =>
            <PickRow key={career.id} career={career} marker={String(index + 2)} line={rankLine(career)} onDetail={openDetail(career)} />)}</ol></>
            : <p className="cg-empty">Chưa có nghề nào khác tính được mức phù hợp.</p>}
        </section>
        <section className="sw-panel cg-pick cg-pick-like" aria-labelledby="cg-liked-title">
          <header><h4 id="cg-liked-title">Theo Khảo sát định hướng</h4>
            <p>{data.surveyDone && (interests.field || interests.tech.length > 0)
              ? <>Khớp {interests.field && <>lĩnh vực <b>{interests.field}</b></>}{interests.field && interests.tech.length > 0 && " và "}{interests.tech.length > 0 && <>thế mạnh <b>{interests.tech.join(", ")}</b></>} bạn chọn.</>
              : "Theo lĩnh vực quan tâm và thế mạnh bạn chọn trong Khảo sát định hướng."}</p></header>
          {!data.surveyDone ? <div className="cg-empty"><p>Bạn chưa hoàn thành Khảo sát định hướng nên chưa có gợi ý theo sở thích và thế mạnh.</p><a className="sw-outline" href="#profile">Làm khảo sát ở Hồ sơ và bảng điểm</a></div>
            : picks.liked.length ? <><PickHead /><ol className="cg-pick-list">{picks.liked.map((career) =>
              <PickRow key={career.id} career={career} marker="♥" line={interestReason(career)} onDetail={openDetail(career)} />)}</ol></>
              : <p className="cg-empty">Không còn nghề nào khác khớp lĩnh vực và thế mạnh bạn chọn. Bạn có thể xem tất cả nghề bên dưới.</p>}
        </section>
      </div>
    </>}

    <details className="sw-panel cg-all" open={allOpen} onToggle={(event) => setAllOpen(event.currentTarget.open)}>
      <summary><span className="cg-all-title" id="cg-all-title">Tất cả {careers.length} nghề</span>
        <span className="cg-all-hint">{data.blocked ? "Sắp xếp theo tên" : FIT_ORDER_TEXT} · tìm theo tên, lọc theo lĩnh vực, chọn tối đa {COMPARE_MAX} nghề để so sánh</span></summary>
      <div className="cg-all-body">
        <div className="cg-filters">
          <label>Tìm nghề<input value={filters.q} maxLength={100} placeholder="Tên tiếng Việt hoặc tiếng Anh…" onChange={(event) => setFilters({ ...filters, q: event.target.value })} /></label>
          <label>Lĩnh vực<select value={filters.field} onChange={(event) => setFilters({ ...filters, field: event.target.value })}>
            <option value="">Tất cả lĩnh vực</option>{data.fields.map((field) => <option key={field.code} value={field.code}>{field.name}</option>)}
          </select></label>
        </div>
        <p className="sw-muted" role="status">{visible.length} nghề</p>
        <ul className="cg-list">{visible.map((career) => <li key={career.id} className={career.isTarget ? "is-target" : undefined}>
          <div className="cg-row-main">
            <h4>{career.nameVi}</h4><p className="cg-en">{career.nameEn} · {career.categoryName}</p>
            {(career.isTarget || matchesInterests(career)) && <div className="cg-row-tags">{career.isTarget && <TargetTag />}
              {matchesInterests(career) && <span className="cg-like-tag">♥ Hợp sở thích</span>}</div>}
          </div>
          <div className="cg-row-fit"><span className="cg-score-label">{FIT_SCORE_LABEL}</span><FitScore career={career} /><FitBadge career={career} /></div>
          <div className="cg-actions">
            <CompareToggle career={career} compared={compare.includes(career.id)} compareFull={compare.length >= COMPARE_MAX} onCompare={() => setCompare((value) => toggleCompare(value, career.id))} />
            <button type="button" className="sr-secondary" onClick={openDetail(career)} aria-label={`Xem chi tiết ${career.nameVi}`}><Icon name="eye" />Chi tiết</button>
          </div>
        </li>)}</ul>
        {!visible.length && <p className="cg-empty">Không có nghề phù hợp với bộ lọc.</p>}
      </div>
    </details>

    {compared.length >= 2 && <CompareSection careers={compared} onRemove={(id) => setCompare((value) => value.filter((item) => item !== id))} />}

    {/* Kept at the bottom of the screen: the notice of "Chọn nghề mục tiêu" (a row far down the list would put it out of view
        at the top of the page) and the comparison tray. */}
    {(notice || compared.length > 0) && <div className="cg-dock">
      {notice && <div ref={toast} tabIndex={-1} className={`cg-toast ${notice.tone === "success" ? "sr-success" : "sr-error"}`}
        role={notice.tone === "success" ? "status" : "alert"}>
        <p>{notice.text}{notice.link && <> <a href="#competency">Mở Đánh giá năng lực</a></>}</p>
        <button type="button" className="cg-toast-close" onClick={() => setNotice(null)} aria-label="Đóng thông báo"><Icon name="close" /></button>
      </div>}
      {compared.length > 0 && <div className="cg-tray" role="region" aria-label="Nghề đang chọn để so sánh">
        <span>Đã chọn {compared.length}/{COMPARE_MAX} nghề: {compared.map((career) => career.nameVi).join(", ")}</span>
        <div className="cg-tray-actions">
          {compared.length >= 2 && <a className="sw-primary" href="#career" onClick={(event) => { event.preventDefault(); showCompare(); }}>Xem so sánh</a>}
          {compared.length < 2 && <span className="cg-tray-hint">Chọn thêm ít nhất 1 nghề để so sánh</span>}
          <button type="button" className="sr-secondary" onClick={() => setCompare([])}>Bỏ chọn</button>
        </div>
      </div>}
    </div>}

    {detail && <DetailDialog career={detail} saving={saving === detail.id} onChoose={() => void choose(detail)} onClose={() => setDetailId(null)} />}
  </div>;
}
