import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./student-icons";
import {
  CAREER_GUIDANCE_API, COMPARE_MAX, FIT_ORDER_TEXT, FIT_RULE_TEXT, FIT_SCORE_LABEL, FIT_STEP, bestFitsHeading, blockedAction, blockedText, careerPicks, compareRows, filterCareers, fitRuleText,
  fitScoreText, fitSummary, gapNote, hasFit, interestReason, matchesInterests, metSkills, missingSkills, nameList, orderedRequirements, requirementName,
  reassessedOf, requirementScoreText, requirementSourcesText, requirementState, surveyInterests, targetSavedNotice, toggleCompare, type CareerFilters, type GuidanceCareer,
  type GuidanceResponse, type GuidanceRequirement,
} from "./career-guidance-data";
import StudentProfileSurvey from "./StudentProfileSurvey";
import { SURVEY_SECTION_ID } from "./profile-survey";
import { meaningClass } from "./display-format";
import { fitMeaning } from "./student-competency-data";
import { isAdvisorView } from "./advisor-view";
import { ActingConfirmDialog, goalsConfirm } from "./acting-confirm";
import "./career-guidance.css";

// "Định hướng nghề nghiệp" (#career, user 2026-10-24: "làm theo ý bạn muốn nhưng vẫn phải phù hợp với đề tài"): the
// careers that suit the student's competencies and Khảo sát nhanh, every career with its fit, a side-by-side
// comparison of up to three careers, and choosing the target career. The system computes the fits; no AI.
// Since the plan "Một bước để bắt đầu" (2026-11-14, approved preview https://claude.ai/code/artifact/1d5dbbec-1c0b-4aa2-acb0-839de3ae86b6;
// the advisor: "vị trí nghề nghiệp để bên chỗ định hướng, khi nào người ta muốn định hướng thì người ta mới chọn"), this
// is the one place the target is chosen, and it is optional; Khảo sát nhanh (5 items, optional) lives here beside the best
// fit. Choosing the target makes the API assess again when it can (PATCH answer `reassessed`).
// Read top-down since 2026-10-31 (user: "Giao diện đưa ra quá nhiều thông tin, sinh viên không biết nên đọc gì. Ưu tiên kết
// quả phù hợp nhất; phân cấp nội dung và giảm các phần phụ không cần thiết"; approved preview
// https://claude.ai/code/artifact/1207975d-ae6e-444f-97ba-b449810e7555): the best fit with why, then "Theo bảng xếp hạng"
// and the survey matches side by side, then every career folded.
// One term for a career of the catalog, "vị trí nghề nghiệp" ("vị trí" once named in the same place), since 2026-10-31 (advisor:
// "Thống nhất thuật ngữ 'Vị trí nghề nghiệp' trên toàn hệ thống").
// A cố vấn học tập or a Khoa admin working in the student's page chooses the target too, after a confirmation (user
// 2026-11-10, policy 2026-11-10; acting-confirm.tsx); the API logs it and tells the student (advisors/access.ts).

/** link: the page the notice links to (Đánh giá năng lực to assess again, Khoảng trống kỹ năng once it is up to date). */
type Notice = { tone: "success" | "error"; text: string; link?: "competency" | "skill-gap" | null } | null;
const NOTICE_LINKS = { competency: { href: "#competency", label: "Mở Đánh giá năng lực" }, "skill-gap": { href: "#skill-gap", label: "Xem Khoảng trống kỹ năng" } } as const;

async function readGuidance(): Promise<GuidanceResponse> {
  const response = await fetch(CAREER_GUIDANCE_API, { credentials: "include", cache: "no-store" });
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  if (!response.ok) throw new Error("Chưa tải được thông tin định hướng nghề nghiệp. Vui lòng thử lại.");
  return response.json() as Promise<GuidanceResponse>;
}

/** Saves the target; reassessed: the API stored a new assessment for it (plan "Một bước để bắt đầu"). */
async function saveTarget(careerId: string): Promise<{ reassessed: boolean }> {
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

/**
 * The student's target among the vị trí nghề nghiệp. `action` stands in for the "Chọn làm vị trí nghề nghiệp mục tiêu" button, so it takes the
 * buttons' height and corners and lines up with the button beside it (advisor 2026-10-31: the label "bị lệch").
 */
const TargetTag = ({ action = false }: { action?: boolean }) =>
  <span className={`cg-target-tag${action ? " cg-target-tag-action" : ""}`}><Icon name="check" />Vị trí nghề nghiệp mục tiêu</span>;

/**
 * "+ So sánh" (advisor 2026-10-31: "Luồng chọn tối đa 3 vị trí để so sánh khó hiểu; người dùng không biết cần bấm ở đâu"): adds
 * the vị trí to the comparison bar or takes it out; disabled, with why, once COMPARE_MAX are chosen. `long` words it for the
 * details, where the button stands alone.
 */
function CompareButton({ career, compared, full, long = false, onToggle }: { career: GuidanceCareer; compared: boolean; full: boolean; long?: boolean; onToggle: () => void }) {
  const blocked = !compared && full;
  return <button type="button" className={`cg-compare-btn${compared ? " is-on" : ""}`} disabled={blocked} onClick={onToggle}
    aria-pressed={long ? undefined : compared} aria-label={long ? undefined : `So sánh ${career.nameVi}`}
    title={blocked ? `Đã chọn đủ ${COMPARE_MAX} vị trí. Bỏ bớt một vị trí trên thanh So sánh để chọn vị trí khác.` : undefined}>
    <Icon name={compared ? "check" : "plus"} />{long ? (compared ? "Bỏ khỏi so sánh" : "Thêm vào so sánh") : (compared ? "Đã chọn" : "So sánh")}
  </button>;
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
      <span className="cg-kicker">Hạng 1 / {scored} vị trí</span>
      <h3 id="cg-top-name">{career.nameVi}</h3>
      <p className="cg-en">{career.nameEn} · {career.categoryName}</p>
      <ul className="cg-why">
        {career.fit && <li className="cg-why-ok"><i aria-hidden="true">✓</i><span><b>Đạt {career.fit.met}/{career.fit.total} kỹ năng yêu cầu</b>{met.length > 0 && `: ${nameList(met, 4)}`}</span></li>}
        {matchesInterests(career) && <li className="cg-why-like"><i aria-hidden="true">♥</i><span><b>Hợp sở thích và thế mạnh của bạn:</b> {interestReason(career).replace(/^Khớp: /, "")}</span></li>}
        {missing.length > 0 && <li className="cg-why-gap"><i aria-hidden="true">!</i><span><b>Còn thiếu:</b> {nameList(missing)}</span></li>}
      </ul>
      <div className="cg-top-actions">
        {career.isTarget ? <TargetTag action />
          : <button type="button" className="sw-primary" disabled={saving} onClick={onChoose}><Icon name="check" />{saving ? "Đang lưu…" : "Chọn làm vị trí nghề nghiệp mục tiêu"}</button>}
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

/** "Đạt 3/5 kỹ năng · thiếu Node.js, Docker": the line of a vị trí in "Theo bảng xếp hạng". */
function rankLine(career: GuidanceCareer): string {
  const missing = missingSkills(career);
  return career.fit ? `Đạt ${career.fit.met}/${career.fit.total} kỹ năng${missing.length ? ` · thiếu ${nameList(missing, 2)}` : ""}` : "Chưa tính được điểm phù hợp";
}

/** One row of "Theo bảng xếp hạng" (its rank) or of the survey matches (a heart); the name opens the details. */
function PickRow({ career, marker, line, onDetail }: { career: GuidanceCareer; marker: string; line: string; onDetail: () => void }) {
  return <li>
    <span className="cg-pos" aria-hidden="true">{marker}</span>
    <button type="button" className="cg-pick-name" onClick={onDetail} aria-label={`Xem chi tiết ${career.nameVi}`}><b>{career.nameVi}</b><small>{line}</small></button>
    <span className="cg-pick-fit"><FitScore career={career} named /><FitBadge career={career} compact /></span>
  </li>;
}

/** The column titles above the rows of the two short lists (screen readers get them from FitScore `named`). */
const PickHead = () => <div className="cg-pick-head" aria-hidden="true"><span /><span>Vị trí nghề nghiệp</span><span>{FIT_SCORE_LABEL}</span></div>;

/** "Căn cứ" and "Thứ tự" under the title of a short list (advisor 2026-10-31: "bổ sung mô tả căn cứ đánh giá và thứ tự sắp xếp"). */
const PickBasis = ({ basis, order }: { basis: ReactNode; order: ReactNode }) =>
  <dl className="cg-basis"><div><dt>Căn cứ:</dt><dd>{basis}</dd></div><div><dt>Thứ tự:</dt><dd>{order}</dd></div></dl>;

/** A modal that opens over the page, gives focus back to what opened it, and closes with Esc through onClose. */
function useModal() {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return dialog;
}

function DetailDialog({ career, saving, compared, compareFull, onCompare, onChoose, onClose }: {
  career: GuidanceCareer; saving: boolean; compared: boolean; compareFull: boolean; onCompare: () => void; onChoose: () => void; onClose: () => void;
}) {
  const dialog = useModal();
  const missing = missingSkills(career);
  return <dialog ref={dialog} className="cg-dialog" aria-labelledby="cg-detail-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header>
      <div><h2 id="cg-detail-title">{career.nameVi}</h2><p className="cg-en">{career.nameEn} · {career.categoryName}</p></div>
      <button type="button" className="sr-secondary" onClick={onClose} aria-label="Đóng chi tiết vị trí nghề nghiệp"><Icon name="close" />Đóng</button>
    </header>
    <div className="cg-dialog-body">
      <div className="cg-detail-fit"><span className="cg-score-label">{FIT_SCORE_LABEL}</span><FitScore career={career} /><FitBadge career={career} />{career.fit && <span>{fitSummary(career)}</span>}</div>
      {career.fit && <p className="cg-fit-rule">{fitRuleText(career)}</p>}
      <InterestTags career={career} />
      <p className="cg-description">{career.description || "Khoa chưa bổ sung mô tả công việc cho vị trí nghề nghiệp này."}</p>
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
      </div> : <p>Khoa chưa cập nhật yêu cầu kỹ năng cho vị trí nghề nghiệp này.</p>}
      {missing.length > 0 && <p className="cg-note">Để phù hợp hơn với vị trí này, bạn nên bổ sung các kỹ năng: {missing.join(", ")}. {career.isTarget
        ? "Các học phần nên học cho từng kỹ năng có ở trang Khoảng trống kỹ năng."
        : "Các học phần nên học cho từng kỹ năng sẽ hiện ở trang Khoảng trống kỹ năng sau khi bạn chọn vị trí này làm mục tiêu và đánh giá lại."}</p>}
    </div>
    <footer className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" onClick={onClose}><Icon name="close" />Đóng</button>
      <div className="cg-dialog-actions">
        <CompareButton career={career} compared={compared} full={compareFull} long onToggle={onCompare} />
        {career.isTarget ? <TargetTag action />
          : <button type="button" className="sw-primary" disabled={saving} onClick={onChoose}><Icon name="check" />{saving ? "Đang lưu…" : "Chọn làm vị trí nghề nghiệp mục tiêu"}</button>}
      </div>
    </footer>
  </dialog>;
}

/**
 * The comparison bar at the bottom of the screen (advisor 2026-10-31: "người dùng không biết cần bấm ở đâu, nút 'Xem so sánh' xuất
 * hiện thế nào. Thiết kế lại hướng dẫn, nút thao tác và điểm đến sau khi nhấn"). It shows while the full list is open or a vị trí is
 * chosen: what to do, one slot per vị trí (up to COMPARE_MAX), and "Xem so sánh", always in view and enabled from the second vị trí.
 */
function CompareBar({ chosen, onRemove, onClear, onOpen }: { chosen: GuidanceCareer[]; onRemove: (id: string) => void; onClear: () => void; onOpen: () => void }) {
  const lacking = Math.max(0, 2 - chosen.length);
  return <div className="cg-tray" role="region" aria-label="So sánh vị trí nghề nghiệp">
    <div className="cg-tray-text">
      <strong>So sánh vị trí nghề nghiệp</strong>
      <span role="status">{!chosen.length ? <>Bấm <b>+ So sánh</b> ở 2 hoặc 3 vị trí, rồi bấm <b>Xem so sánh</b>.</>
        : lacking ? `Đã chọn ${chosen.length}/${COMPARE_MAX}. Chọn thêm ít nhất ${lacking} vị trí để so sánh.`
          : `Đã chọn ${chosen.length}/${COMPARE_MAX}. Bấm Xem so sánh để mở bảng so sánh.`}</span>
    </div>
    <ol className="cg-slots" aria-label="Vị trí đã chọn">{Array.from({ length: COMPARE_MAX }, (_, index) => {
      const career = chosen[index];
      return career
        ? <li key={career.id} className="is-filled"><span title={career.nameVi}>{career.nameVi}</span>
          <button type="button" onClick={() => onRemove(career.id)} aria-label={`Bỏ ${career.nameVi} khỏi so sánh`}><Icon name="close" /></button></li>
        : <li key={`empty-${index}`} className="is-empty" aria-hidden="true">Chưa chọn</li>;
    })}</ol>
    <div className="cg-tray-actions">
      {chosen.length > 0 && <button type="button" className="sr-secondary" onClick={onClear}>Bỏ chọn</button>}
      <button type="button" className="sw-primary" disabled={chosen.length < 2} onClick={onOpen}>Xem so sánh{chosen.length >= 2 ? ` (${chosen.length})` : ""}</button>
    </div>
  </div>;
}

/** Where "Xem so sánh" leads: the comparison over the page; closing it comes back to the list as it was. */
function CompareDialog({ careers, onRemove, onClear, onClose }: { careers: GuidanceCareer[]; onRemove: (id: string) => void; onClear: () => void; onClose: () => void }) {
  const dialog = useModal();
  const rows = compareRows(careers);
  return <dialog ref={dialog} className="cg-dialog cg-compare-dialog" aria-labelledby="cg-compare-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header>
      <div><h2 id="cg-compare-title">So sánh {careers.length} vị trí nghề nghiệp</h2>
        <p className="cg-en">{FIT_SCORE_LABEL} và từng kỹ năng của các vị trí bạn chọn, tính từ năng lực hiện tại của bạn.</p></div>
      <button type="button" className="sr-secondary" onClick={onClose} aria-label="Đóng bảng so sánh"><Icon name="close" />Đóng</button>
    </header>
    <div className="cg-dialog-body">
      {careers.length < 2 ? <p className="cg-empty">Cần ít nhất 2 vị trí để so sánh. Đóng bảng này rồi bấm + So sánh ở vị trí khác.</p>
        : <div className="cg-table-scroll" tabIndex={0} role="region" aria-label="Bảng so sánh vị trí nghề nghiệp">
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
        </div>}
    </div>
    <footer className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" onClick={onClear}>Bỏ chọn tất cả</button>
      <button type="button" className="sw-primary" onClick={onClose}>Đóng</button>
    </footer>
  </dialog>;
}

/** initial: the guidance already read (a server render in the tests); the page reads it again once mounted. */
export default function StudentCareerGuidance({ onProfileChanged, initial = null }: { onProfileChanged: () => void; initial?: GuidanceResponse | null }) {
  const [data, setData] = useState<GuidanceResponse | null>(initial);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState<CareerFilters>({ q: "", field: "" });
  const [allOpen, setAllOpen] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // Grows each time a button of this page asks Khảo sát nhanh for its form (StudentProfileSurvey openRequest).
  const [surveyRequest, setSurveyRequest] = useState(0);
  const toast = useRef<HTMLDivElement>(null);
  // "Đổi vị trí nghề nghiệp" / "Chọn vị trí nghề nghiệp" beside the target (user 2026-11-14: "Chỗ đổi vị trí nghề nghiệp ở đây đâu nếu chưa
  // có bảng điểm và có cả bảng điểm luôn?"): the list of every vị trí opens, comes into view and takes the typing, with or without a transcript.
  const allPanel = useRef<HTMLDetailsElement>(null);
  const allSearch = useRef<HTMLInputElement>(null);
  const [listRequest, setListRequest] = useState(0);
  useEffect(() => {
    if (!listRequest) return;
    allPanel.current?.scrollIntoView({ block: "start" });
    allSearch.current?.focus({ preventScroll: true });
  }, [listRequest]);
  const openList = () => { setAllOpen(true); setListRequest((value) => value + 1); };

  useEffect(() => {
    let alive = true;
    setError("");
    readGuidance().then((value) => alive && setData(value), (failure: Error) => alive && setError(failure.message));
    return () => { alive = false; };
  }, [revision]);

  // Every vị trí stays one click away; opened at once when no fit can be computed (nothing else to read then).
  const blocked = data?.blocked ?? null;
  useEffect(() => { if (blocked) setAllOpen(true); }, [blocked]);

  const choose = useCallback(async (career: GuidanceCareer) => {
    setSaving(career.id);
    setNotice(null);
    let reassessed = false;
    try {
      ({ reassessed } = await saveTarget(career.id));
    } catch (failure) {
      setNotice({ tone: "error", text: (failure as Error).message });
      setSaving(null);
      return;
    }
    onProfileChanged();
    // The page reads again what the server says now, Khoảng trống kỹ năng's career included, rather than guessing it.
    const fresh = await readGuidance().catch(() => null);
    setData((value) => fresh ?? (value && {
      ...value, targetCareerId: career.id, deletedTargetName: null, gapCurrent: reassessed || value.gapCareerId === career.id,
      careers: value.careers.map((item) => ({ ...item, isTarget: item.id === career.id })),
    }));
    setNotice({ tone: "success", ...targetSavedNotice(career, reassessed, fresh?.gapCareerId) });
    setSaving(null);
  }, [onProfileChanged]);
  // Working for the student, the choice is confirmed first; the student chooses at once.
  const [confirming, setConfirming] = useState<GuidanceCareer | null>(null);
  const pick = useCallback((career: GuidanceCareer) => { if (isAdvisorView()) setConfirming(career); else void choose(career); }, [choose]);
  // Khảo sát nhanh saved or deleted: the survey matches are read again, and the profile (the workspace's copy).
  const surveySaved = useCallback(() => { setRevision((value) => value + 1); onProfileChanged(); }, [onProfileChanged]);
  // "Làm Khảo sát nhanh", "Chỉnh sửa khảo sát": to the survey beside the best fit, its form open.
  const openSurvey = () => {
    document.getElementById(SURVEY_SECTION_ID)?.scrollIntoView({ block: "start" });
    setSurveyRequest((value) => value + 1);
  };

  // The chosen row's button gives way to "Vị trí nghề nghiệp mục tiêu": keyboard focus goes to the notice instead of the page top.
  useEffect(() => {
    if (notice?.tone !== "success") return;
    const active = document.activeElement;
    if ((!active || active === document.body) && !document.querySelector("dialog[open]")) toast.current?.focus({ preventScroll: true });
  }, [notice]);

  const careers = data?.careers ?? [];
  const visible = useMemo(() => filterCareers(careers, filters), [careers, filters]);
  const compared = compare.map((id) => careers.find((career) => career.id === id)).filter((career): career is GuidanceCareer => Boolean(career));
  const detail = careers.find((career) => career.id === detailId) ?? null;
  const target = careers.find((career) => career.isTarget) ?? null;

  if (error) return <section className="sw-panel cg-problem" role="alert"><strong>Chưa tải được định hướng nghề nghiệp</strong><p>{error}</p>
    <button type="button" className="sw-outline" onClick={() => setRevision((value) => value + 1)}><Icon name="refresh" />Thử lại</button></section>;
  if (!data) return <section className="sw-panel" aria-busy="true"><p role="status">Đang tính điểm phù hợp với từng vị trí nghề nghiệp…</p></section>;

  const picks = careerPicks(careers);
  const shownPicks = [picks.top, ...picks.ranked].filter((career): career is GuidanceCareer => Boolean(career));
  // The order of the ranking; before any career reaches Trung bình, also why the scores are low.
  const heading = bestFitsHeading(shownPicks);
  const interests = surveyInterests(careers);
  const surveyed = data.surveyDone && (interests.field !== null || interests.tech.length > 0);
  // While no fit can be computed (no transcript or specialty, results deleted), the page's own note says what to do instead.
  const targetNote = target && !data.blocked ? gapNote(data, target) : null;
  const unblock = data.blocked ? blockedAction(data.blocked) : null;
  const openDetail = (career: GuidanceCareer) => () => setDetailId(career.id);
  const toggle = (career: GuidanceCareer) => () => setCompare((value) => toggleCompare(value, career.id));
  const removeCompared = (id: string) => setCompare((value) => value.filter((item) => item !== id));
  const compareFull = compare.length >= COMPARE_MAX;
  const showBar = allOpen || compared.length > 0;

  return <div className="cg-page">
    <section className="cg-intro" aria-label="Về trang này">
      <p className="cg-lead">Trang này đánh giá mức phù hợp của bạn với {careers.length} vị trí nghề nghiệp của Khoa, từ điểm kỹ năng trong bảng điểm và Khảo sát
        nhanh (nếu bạn làm). Kết quả chỉ để tham khảo.</p>
      <p className="cg-define"><b>{FIT_SCORE_LABEL}</b> (gọi tắt là điểm phù hợp, thang 100) là con số cạnh mỗi vị trí nghề nghiệp: cho biết kỹ năng
        hiện tại của bạn đáp ứng yêu cầu kỹ năng của vị trí đó đến đâu. Điểm càng cao, vị trí càng phù hợp với bạn.</p>
      <details className="cg-how"><summary>Cách tính điểm phù hợp kỹ năng</summary>
        <p>{FIT_RULE_TEXT} Mức phù hợp được tính giống trang Khoảng trống kỹ năng: Rất phù hợp từ 90, Phù hợp từ 80, Trung bình từ 62,5, Ít phù hợp từ 50.</p>
      </details>
    </section>

    <div className="cg-target-line">
      <div className="cg-target-main">
        <span className="cg-target-label">Vị trí nghề nghiệp mục tiêu:</span>
        {target ? <><strong>{target.nameVi}</strong>
          <span className="cg-target-score"><span className="cg-target-label">{FIT_SCORE_LABEL}:</span><span className="cg-keep"><FitScore career={target} /><FitBadge career={target} /></span></span></>
          : data.deletedTargetName ? <span>{data.deletedTargetName}: vị trí này không còn trong danh mục; bạn nên chọn vị trí nghề nghiệp khác.</span>
            : <><strong>Chưa chọn</strong><span className="cg-target-hint">Chọn một vị trí bên dưới khi bạn muốn. Không bắt buộc.</span></>}
      </div>
      <div className="cg-target-actions">
        <button type="button" className="sw-outline" onClick={openList} aria-controls="cg-all">
          <Icon name={target ? "edit" : "target"} />{target ? "Đổi vị trí nghề nghiệp" : "Chọn vị trí nghề nghiệp"}</button>
        {target && <a className="sw-text-link" href="#skill-gap">Xem Khoảng trống kỹ năng <Icon name="arrow" /></a>}
      </div>
      {targetNote && <div className="cg-note cg-note-warn"><p>{targetNote}</p><a className="sw-outline" href={NOTICE_LINKS.competency.href}>{NOTICE_LINKS.competency.label}</a></div>}
    </div>

    {data.blocked && <div className="cg-note cg-note-warn" role="note"><p>{blockedText(data.blocked)} Bạn vẫn xem được danh mục vị trí nghề nghiệp và yêu cầu của từng vị trí.</p>
      {unblock && <a className="sw-outline" href={unblock.href}>{unblock.label}</a>}</div>}

    {!data.blocked && <div className="cg-level"><h3 id="cg-best-title">{heading.title}</h3><p>{heading.note}</p></div>}
    {/* The best fit with Khảo sát nhanh beside it (plan "Một bước để bắt đầu", mockup E); the survey alone while no fit is computed. */}
    <div className="cg-top-row">
      {!data.blocked && (picks.top ? <TopPick career={picks.top} scored={picks.scored} saving={saving === picks.top.id} onDetail={openDetail(picks.top)} onChoose={() => pick(picks.top!)} />
        : <p className="cg-empty">Chưa đủ dữ liệu để gợi ý: các kỹ năng của các vị trí nghề nghiệp chưa được đo bằng học phần bạn đã học.</p>)}
      <StudentProfileSurvey onSaved={surveySaved} openRequest={surveyRequest} />
    </div>

    {!data.blocked && <>
      <div className="cg-level"><h3>Các lựa chọn khác</h3><p>Không lặp lại vị trí đã hiện ở trên.</p></div>
      <div className="cg-pairs">
        <section className="sw-panel cg-pick" aria-labelledby="cg-rank-title">
          <header><h4 id="cg-rank-title">Theo bảng xếp hạng</h4>
            <PickBasis basis={<>{FIT_SCORE_LABEL.toLowerCase()} của bạn với từng vị trí nghề nghiệp.</>} order="điểm phù hợp giảm dần, tiếp sau vị trí đứng đầu ở trên." /></header>
          {picks.ranked.length ? <><PickHead /><ol className="cg-pick-list">{picks.ranked.map((career, index) =>
            <PickRow key={career.id} career={career} marker={String(index + 2)} line={rankLine(career)} onDetail={openDetail(career)} />)}</ol></>
            : <p className="cg-empty">Chưa có vị trí nghề nghiệp nào khác tính được điểm phù hợp.</p>}
        </section>
        <section className="sw-panel cg-pick cg-pick-like" aria-labelledby="cg-liked-title">
          <header><div className="cg-pick-title"><h4 id="cg-liked-title">Vị trí nghề nghiệp phù hợp với sở thích và thế mạnh</h4>
            {data.surveyDone && <button type="button" className="cg-link" onClick={openSurvey}>Chỉnh sửa khảo sát</button>}</div>
            <PickBasis
              basis={surveyed ? <>{interests.field && <>lĩnh vực quan tâm nhất <b>{interests.field}</b></>}{interests.field && interests.tech.length > 0 && " và "}
                {interests.tech.length > 0 && <>thế mạnh <b>{interests.tech.join(", ")}</b></>} bạn chọn trong Khảo sát nhanh.</>
                : "lĩnh vực quan tâm nhất và thế mạnh (công nghệ thành thạo) bạn chọn trong Khảo sát nhanh."}
              order="vị trí khớp lĩnh vực quan tâm xếp trước, rồi vị trí khớp nhiều thế mạnh hơn, rồi điểm phù hợp cao hơn." /></header>
          {!data.surveyDone ? <div className="cg-empty"><p>Làm Khảo sát nhanh (5 câu, khoảng 1 phút, không bắt buộc) để xem các vị trí nghề nghiệp hợp với sở thích và thế mạnh của bạn.</p>
            <button type="button" className="sw-outline" onClick={openSurvey}>Làm Khảo sát nhanh</button></div>
            : picks.liked.length ? <><PickHead /><ol className="cg-pick-list">{picks.liked.map((career) =>
              <PickRow key={career.id} career={career} marker="♥" line={interestReason(career)} onDetail={openDetail(career)} />)}</ol></>
              : <p className="cg-empty">Không còn vị trí nghề nghiệp nào khác khớp lĩnh vực và thế mạnh bạn chọn. Bạn có thể xem tất cả vị trí bên dưới.</p>}
        </section>
      </div>
    </>}

    {/* "Tất cả nghề nghiệp" named by what it does (advisor 2026-10-31: "đánh giá/tính điểm phù hợp đối với tất cả vị trí nghề nghiệp"). */}
    <details ref={allPanel} id="cg-all" className="sw-panel cg-all" open={allOpen} onToggle={(event) => setAllOpen(event.currentTarget.open)}>
      <summary><span className="cg-all-title" id="cg-all-title">Đánh giá điểm phù hợp kỹ năng với tất cả {careers.length} vị trí nghề nghiệp</span>
        <span className="cg-all-hint">{data.blocked ? "Sắp xếp theo tên" : FIT_ORDER_TEXT} · tìm theo tên, lọc theo lĩnh vực, bấm + So sánh ở 2–3 vị trí để so sánh</span></summary>
      <div className="cg-all-body">
        <div className="cg-filters">
          <label>Tìm vị trí nghề nghiệp<input ref={allSearch} value={filters.q} maxLength={100} placeholder="Tên tiếng Việt hoặc tiếng Anh…" onChange={(event) => setFilters({ ...filters, q: event.target.value })} /></label>
          <label>Lĩnh vực<select value={filters.field} onChange={(event) => setFilters({ ...filters, field: event.target.value })}>
            <option value="">Tất cả lĩnh vực</option>{data.fields.map((field) => <option key={field.code} value={field.code}>{field.name}</option>)}
          </select></label>
        </div>
        <p className="sw-muted" role="status">{visible.length} vị trí nghề nghiệp</p>
        <ul className="cg-list">{visible.map((career) => <li key={career.id} className={career.isTarget ? "is-target" : undefined}>
          <div className="cg-row-main">
            <h4>{career.nameVi}</h4><p className="cg-en">{career.nameEn} · {career.categoryName}</p>
            {(career.isTarget || matchesInterests(career)) && <div className="cg-row-tags">{career.isTarget && <TargetTag />}
              {matchesInterests(career) && <span className="cg-like-tag">♥ Hợp sở thích</span>}</div>}
          </div>
          <div className="cg-row-fit"><span className="cg-score-label">{FIT_SCORE_LABEL}</span><FitScore career={career} /><FitBadge career={career} /></div>
          <div className="cg-actions">
            <CompareButton career={career} compared={compare.includes(career.id)} full={compareFull} onToggle={toggle(career)} />
            <button type="button" className="sr-secondary" onClick={openDetail(career)} aria-label={`Xem chi tiết ${career.nameVi}`}><Icon name="eye" />Chi tiết</button>
            {/* Chosen from the list itself, without opening the details first (user 2026-11-14). */}
            {!career.isTarget && <button type="button" className="sw-outline" disabled={saving !== null} onClick={() => pick(career)}
              aria-label={`Chọn làm mục tiêu: ${career.nameVi}`}><Icon name="check" />{saving === career.id ? "Đang lưu…" : "Chọn làm mục tiêu"}</button>}
          </div>
        </li>)}</ul>
        {!visible.length && <p className="cg-empty">Không có vị trí nghề nghiệp nào khớp bộ lọc.</p>}
      </div>
    </details>

    {/* Kept at the bottom of the screen: the notice of "Chọn làm vị trí nghề nghiệp mục tiêu" (a row far down the list would put it out of view
        at the top of the page) and the comparison bar. */}
    {(notice || showBar) && <div className="cg-dock">
      {notice && <div ref={toast} tabIndex={-1} className={`cg-toast ${notice.tone === "success" ? "sr-success" : "sr-error"}`}
        role={notice.tone === "success" ? "status" : "alert"}>
        <p>{notice.text}{notice.link && <> <a href={NOTICE_LINKS[notice.link].href}>{NOTICE_LINKS[notice.link].label}</a></>}</p>
        <button type="button" className="cg-toast-close" onClick={() => setNotice(null)} aria-label="Đóng thông báo"><Icon name="close" /></button>
      </div>}
      {showBar && <CompareBar chosen={compared} onRemove={removeCompared} onClear={() => setCompare([])} onOpen={() => setCompareOpen(true)} />}
    </div>}

    {detail && <DetailDialog career={detail} saving={saving === detail.id} compared={compare.includes(detail.id)} compareFull={compareFull}
      onCompare={toggle(detail)} onChoose={() => pick(detail)} onClose={() => setDetailId(null)} />}
    {compareOpen && <CompareDialog careers={compared} onRemove={removeCompared}
      onClear={() => { setCompare([]); setCompareOpen(false); }} onClose={() => setCompareOpen(false)} />}
    {confirming && <ActingConfirmDialog {...goalsConfirm({ career: confirming.nameVi }, "Chọn làm mục tiêu")} onClose={() => setConfirming(null)}
      onConfirm={() => { setConfirming(null); void choose(confirming); }} />}
  </div>;
}
