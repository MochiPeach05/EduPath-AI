import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./student-icons";
import {
  CAREER_GUIDANCE_API, COMPARE_MAX, FIT_STEP, bestFits, blockedInProfile, blockedText, compareRows, filterCareers, fitScoreText, hasFit,
  interestPicks, matchesInterests, missingSkills, requirementName, requirementState, toggleCompare,
  type CareerFilters, type GuidanceCareer, type GuidanceResponse, type GuidanceRequirement,
} from "./career-guidance-data";
import "./career-guidance.css";

// "Định hướng nghề nghiệp" (#career, user 2026-10-24: "làm theo ý bạn muốn nhưng vẫn phải phù hợp với đề tài"): the
// careers that suit the student's competencies and Khảo sát định hướng, every career with its fit, a side-by-side
// comparison of up to three careers, and choosing the target career. The system computes the fits; no AI.

type Notice = { tone: "success" | "error"; text: string } | null;

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

function FitBadge({ career }: { career: GuidanceCareer }) {
  if (!career.fit) return <span className="cg-fit cg-fit-0">Chưa tính</span>;
  const step = FIT_STEP[career.fit.code];
  return <span className={`cg-fit cg-fit-${step}`}>
    <span className="cg-pips" aria-hidden="true">{[1, 2, 3, 4, 5].map((pip) => <i key={pip} className={pip <= step ? "is-on" : undefined} />)}</span>
    {career.fit.label}
  </span>;
}

function FitScore({ career }: { career: GuidanceCareer }) {
  return hasFit(career)
    ? <strong className="cg-score">{fitScoreText(career.fit!.score!)}<small>/100</small></strong>
    : <strong className="cg-score cg-score-none">—</strong>;
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
  return <span className={`cg-state cg-state-${state.tone}`}>{state.text}</span>;
}

function CareerActions({ career, compared, compareFull, saving, onDetail, onCompare, onChoose }: {
  career: GuidanceCareer; compared: boolean; compareFull: boolean; saving: boolean;
  onDetail: () => void; onCompare: () => void; onChoose: () => void;
}) {
  return <div className="cg-actions">
    <button type="button" className="sr-secondary" onClick={onDetail} aria-label={`Xem chi tiết ${career.nameVi}`}><Icon name="eye" />Xem chi tiết</button>
    <label className={`cg-compare-toggle${!compared && compareFull ? " is-disabled" : ""}`}>
      <input type="checkbox" checked={compared} disabled={!compared && compareFull} onChange={onCompare} aria-label={`So sánh ${career.nameVi}`} />
      <span>So sánh</span>
    </label>
    {career.isTarget
      ? <span className="cg-target-tag"><Icon name="check" />Nghề mục tiêu của bạn</span>
      : <button type="button" className="sw-outline cg-choose" disabled={saving} onClick={onChoose}>{saving ? "Đang lưu…" : "Chọn nghề mục tiêu"}</button>}
  </div>;
}

function SuggestionCard(props: Parameters<typeof CareerActions>[0]) {
  const { career } = props;
  return <article className="cg-card">
    <div className="cg-card-head">
      <div><h4>{career.nameVi}</h4><p className="cg-en">{career.nameEn} · {career.categoryName}</p></div>
      <FitScore career={career} />
    </div>
    <div className="cg-card-meta"><FitBadge career={career} />{career.fit && <span>Đạt {career.fit.met}/{career.fit.total} kỹ năng</span>}</div>
    <InterestTags career={career} />
    <CareerActions {...props} />
  </article>;
}

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
      <div className="cg-detail-fit"><FitScore career={career} /><FitBadge career={career} />{career.fit && <span>Đạt {career.fit.met}/{career.fit.total} kỹ năng{career.fit.upcoming ? ` · ${career.fit.upcoming} sắp học` : ""}</span>}</div>
      <InterestTags career={career} />
      <p className="cg-description">{career.description || "Khoa chưa bổ sung mô tả công việc cho nghề này."}</p>
      <h3>Yêu cầu kỹ năng và mức hiện tại của bạn</h3>
      {career.requirements.length ? <div className="cg-table-scroll" tabIndex={0} role="region" aria-label={`Yêu cầu của ${career.nameVi}`}>
        <table className="cg-table">
          <thead><tr><th scope="col">Kỹ năng</th><th scope="col">Tính chất</th><th scope="col">Mức hiện tại của bạn</th></tr></thead>
          <tbody>{career.requirements.map((row, index) => <tr key={`${row.title}-${index}`}>
            <td><strong>{requirementName(row)}</strong>{row.skillName && row.title !== row.skillName && <small>{row.title}</small>}</td>
            <td>{row.isRequired ? "Bắt buộc" : "Ưu tiên"}</td>
            <td><StateChip requirement={row} /></td>
          </tr>)}</tbody>
        </table>
      </div> : <p>Khoa chưa cập nhật yêu cầu kỹ năng cho nghề này.</p>}
      {missing.length > 0 && <p className="cg-note">Để phù hợp hơn với nghề này, bạn nên bổ sung các kỹ năng: {missing.join(", ")}. Các học phần nên học cho từng kỹ năng sẽ hiện ở trang Khoảng trống kỹ năng sau khi bạn chọn nghề này làm mục tiêu và đánh giá lại.</p>}
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
          <tr><th scope="row">Mức phù hợp</th>{careers.map((career) => <td key={career.id}><div className="cg-compare-fit"><FitScore career={career} /><FitBadge career={career} /></div></td>)}</tr>
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
  const [filters, setFilters] = useState<CareerFilters>({ q: "", field: "", sort: "fit", interestOnly: false });
  const [compare, setCompare] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let alive = true;
    setError("");
    readGuidance().then((value) => alive && setData(value), (failure: Error) => alive && setError(failure.message));
    return () => { alive = false; };
  }, [revision]);

  const choose = useCallback(async (career: GuidanceCareer) => {
    setSaving(career.id);
    setNotice(null);
    try {
      await saveTarget(career.id);
      setData((value) => value && { ...value, targetCareerId: career.id, careers: value.careers.map((item) => ({ ...item, isTarget: item.id === career.id })) });
      setNotice({ tone: "success", text: `Đã chọn ${career.nameVi} làm nghề mục tiêu. Bấm Đánh giá lại ở trang Đánh giá năng lực để cập nhật Khoảng trống kỹ năng và Lộ trình học tập theo nghề mới.` });
      onProfileChanged();
    } catch (failure) {
      setNotice({ tone: "error", text: (failure as Error).message });
    } finally {
      setSaving(null);
    }
  }, [onProfileChanged]);

  const careers = data?.careers ?? [];
  const visible = useMemo(() => filterCareers(careers, filters), [careers, filters]);
  const compared = compare.map((id) => careers.find((career) => career.id === id)).filter((career): career is GuidanceCareer => Boolean(career));
  const detail = careers.find((career) => career.id === detailId) ?? null;
  const target = careers.find((career) => career.isTarget) ?? null;

  if (error) return <section className="sw-panel cg-problem" role="alert"><strong>Chưa tải được định hướng nghề nghiệp</strong><p>{error}</p>
    <button type="button" className="sw-outline" onClick={() => setRevision((value) => value + 1)}><Icon name="refresh" />Thử lại</button></section>;
  if (!data) return <section className="sw-panel" aria-busy="true"><p role="status">Đang tính mức phù hợp với từng nghề…</p></section>;

  const actionProps = (career: GuidanceCareer) => ({
    career, compared: compare.includes(career.id), compareFull: compare.length >= COMPARE_MAX, saving: saving === career.id,
    onDetail: () => setDetailId(career.id), onCompare: () => setCompare((value) => toggleCompare(value, career.id)), onChoose: () => void choose(career),
  });
  const best = bestFits(careers);
  const liked = interestPicks(careers);

  return <div className="cg-page">
    <section className="sw-panel cg-header" aria-labelledby="cg-title">
      <div>
        <h2 id="cg-title">Định hướng nghề nghiệp của bạn</h2>
        <p className="cg-lead">EduPath AI so sánh năng lực hiện tại của bạn, tính từ bảng điểm, với yêu cầu kỹ năng của {careers.length} nghề trong danh mục của Khoa, và đối chiếu với Khảo sát định hướng của bạn. Mức phù hợp được tính giống như ở trang Khoảng trống kỹ năng; kết quả chỉ để tham khảo.</p>
      </div>
      <div className="cg-current">
        <span className="cg-kicker">Nghề mục tiêu hiện tại</span>
        {target ? <div className="cg-current-body">
          <strong>{target.nameVi}</strong><span className="cg-en">{target.nameEn}</span>
          <div className="cg-card-meta"><FitScore career={target} /><FitBadge career={target} /></div>
          <a className="sw-text-link" href="#skill-gap">Xem Khoảng trống kỹ năng <Icon name="arrow" /></a>
        </div> : <p className="cg-current-empty">Bạn chưa chọn nghề mục tiêu. Hãy xem các gợi ý bên dưới rồi bấm Chọn nghề mục tiêu.</p>}
      </div>
      {data.blocked && <div className="cg-note cg-note-warn" role="note"><p>{blockedText(data.blocked)} Bạn vẫn xem được danh mục nghề và yêu cầu của từng nghề.</p>
        {blockedInProfile(data.blocked) && <a className="sw-outline" href="#profile">Mở Hồ sơ và bảng điểm</a>}</div>}
      {notice && <p className={notice.tone === "success" ? "sr-success" : "sr-error"} role={notice.tone === "success" ? "status" : "alert"}>{notice.text}
        {notice.tone === "success" && <> <a href="#competency">Mở Đánh giá năng lực</a></>}</p>}
    </section>

    {!data.blocked && <div className="cg-suggest">
      <section className="sw-panel cg-suggest-col" aria-labelledby="cg-best-title">
        <div className="cg-section-head"><div><h3 id="cg-best-title">Phù hợp nhất với năng lực hiện tại</h3><p className="sw-muted">Các nghề có mức phù hợp cao nhất với điểm kỹ năng của bạn.</p></div></div>
        {best.length ? best.map((career) => <SuggestionCard key={career.id} {...actionProps(career)} />)
          : <p className="cg-empty">Chưa đủ dữ liệu để gợi ý: các kỹ năng của nghề chưa được đo bằng học phần bạn đã học.</p>}
      </section>
      <section className="sw-panel cg-suggest-col" aria-labelledby="cg-liked-title">
        <div className="cg-section-head"><div><h3 id="cg-liked-title">Hợp với sở thích và thế mạnh của bạn</h3><p className="sw-muted">Theo lĩnh vực quan tâm và thế mạnh (công nghệ bạn thành thạo) trong Khảo sát định hướng.</p></div></div>
        {!data.surveyDone ? <div className="cg-empty"><p>Bạn chưa trả lời Khảo sát định hướng nên chưa có gợi ý theo sở thích và thế mạnh.</p><a className="sw-outline" href="#profile">Làm khảo sát ở Hồ sơ và bảng điểm</a></div>
          : liked.length ? liked.map((career) => <SuggestionCard key={career.id} {...actionProps(career)} />)
            : <p className="cg-empty">Chưa có nghề trong danh mục khớp với lĩnh vực quan tâm và thế mạnh bạn chọn. Bạn có thể xem tất cả nghề bên dưới.</p>}
      </section>
    </div>}

    <section className="sw-panel cg-all" aria-labelledby="cg-all-title">
      <div className="cg-section-head">
        <div><h3 id="cg-all-title">Tất cả nghề nghiệp</h3><p className="sw-muted">Chọn tối đa {COMPARE_MAX} nghề để so sánh, hoặc xem chi tiết yêu cầu và mức hiện tại của bạn.</p></div>
      </div>
      <div className="cg-filters">
        <label>Tìm nghề<input value={filters.q} maxLength={100} placeholder="Tên tiếng Việt hoặc tiếng Anh…" onChange={(event) => setFilters({ ...filters, q: event.target.value })} /></label>
        <label>Lĩnh vực<select value={filters.field} onChange={(event) => setFilters({ ...filters, field: event.target.value })}>
          <option value="">Tất cả lĩnh vực</option>{data.fields.map((field) => <option key={field.code} value={field.code}>{field.name}</option>)}
        </select></label>
        <label>Sắp xếp<select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value as CareerFilters["sort"] })}>
          <option value="fit">Phù hợp nhất trước</option><option value="name">Tên A–Z</option>
        </select></label>
        {data.surveyDone && <label className="cg-check"><input type="checkbox" checked={filters.interestOnly} onChange={(event) => setFilters({ ...filters, interestOnly: event.target.checked })} />Chỉ nghề hợp sở thích, thế mạnh</label>}
      </div>
      <p className="sw-muted" role="status">{visible.length} nghề</p>
      <ul className="cg-list">{visible.map((career) => <li key={career.id} className={career.isTarget ? "is-target" : undefined}>
        <div className="cg-row-main">
          <h4>{career.nameVi}</h4><p className="cg-en">{career.nameEn} · {career.categoryName}</p>
          <InterestTags career={career} />
        </div>
        <div className="cg-row-fit">
          <FitScore career={career} /><FitBadge career={career} />
          {career.fit && <small>Đạt {career.fit.met}/{career.fit.total} kỹ năng</small>}
          {hasFit(career) && <span className="cg-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, career.fit!.score!)}%` }} /></span>}
        </div>
        <CareerActions {...actionProps(career)} />
      </li>)}</ul>
      {!visible.length && <p className="cg-empty">Không có nghề phù hợp với bộ lọc.</p>}
    </section>

    {compared.length >= 2 && <CompareSection careers={compared} onRemove={(id) => setCompare((value) => value.filter((item) => item !== id))} />}

    {compared.length > 0 && <div className="cg-tray" role="region" aria-label="Nghề đang chọn để so sánh">
      <span>Đã chọn {compared.length}/{COMPARE_MAX} nghề: {compared.map((career) => career.nameVi).join(", ")}</span>
      <div className="cg-tray-actions">
        {compared.length >= 2 && <a className="sw-primary" href="#career" onClick={(event) => { event.preventDefault(); document.getElementById("cg-compare")?.focus(); document.getElementById("cg-compare")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Xem so sánh</a>}
        {compared.length < 2 && <span className="cg-tray-hint">Chọn thêm ít nhất 1 nghề để so sánh</span>}
        <button type="button" className="sr-secondary" onClick={() => setCompare([])}>Bỏ chọn</button>
      </div>
    </div>}

    {detail && <DetailDialog career={detail} saving={saving === detail.id} onChoose={() => void choose(detail)} onClose={() => setDetailId(null)} />}
  </div>;
}
