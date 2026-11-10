import { useMemo, useRef, useState, type DragEvent } from "react";
import { Icon } from "./student-icons";
import { Mark } from "./RoadmapProgress";
import {
  MAX_TERMS, aiAddedText, aiCleanedText, classesText, formatNumber, moveCourse, nextTerm, nextTermOffer, offeredSemesters, ownRelations, planIssues,
  plannedTerms, poolSections, proposalAddedText, runningIn, searchCourses, termLabel, termLoad, termLoadText, thesisCleanedText, thesisHint, type AiSuggestion,
  type PlanIssue, type PlanOrigin, type PlanProposal, type StudyPlanContext, type StudyPlanCourse, type StudyPlanData,
} from "./study-plan-data";

// "Kế hoạch học kỳ" of #roadmap (user 2026-10-24, after Stellic's planner; it starts from the training plan, and the AI
// roadmap's proposal once the student applies it, study-plan/prefill.ts): the terms ahead,
// the courses still needed on the right ("Danh sách chờ") or found by search, placed by drag and drop or "Thêm vào";
// missing prerequisites and courses no training plan opens in that term are flagged. No weekly schedule. Each term says
// its credits only, no minimum or maximum (user 2026-11-10: "chỉ cần ghi số tín chỉ đăng ký ở kì đó thôi là được"). Every course says
// whether the training plans open it next term and in which semester they usually do (user 2026-11-03); the AI's
// improvements are only suggested, and another specialty's course is never listed, only found by search and marked.
// Opening the page changes and saves nothing (user 2026-11-04: "Hỏi trước, bấm mới lưu"): what it would change is
// proposed, with Áp dụng and Bỏ qua.

const DRAG_TYPE = "application/x-edupath-course";
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function issueTexts(issue: PlanIssue | undefined, course: StudyPlanCourse, term: string, names: ReadonlyMap<string, string>): string[] {
  if (!issue) return [];
  const name = (code: string) => names.get(code) ?? code;
  return [
    ...(issue.prerequisites.length ? [`Chưa đạt môn tiên quyết: ${issue.prerequisites.map(name).join(", ")}`] : []),
    ...(issue.prior.length ? [`Chưa học trước: ${issue.prior.map(name).join(", ")}`] : []),
    ...(issue.notOffered === "semester" ? [`Kế hoạch đào tạo thường mở môn này vào ${offeredSemesters(course)}, không vào HK${term.slice(4)}`]
      : issue.notOffered === "term" ? [`Chưa có kế hoạch đào tạo nào mở môn này trong ${termLabel(term)}`] : []),
  ];
}

/**
 * "Kỳ sau (HK2 2026–2027): có mở, học cùng lớp khóa K30 (theo kế hoạch đào tạo) · thường mở HK2" (nextTermOffer); in a
 * term, the class of that term is its own line (ClassLine) and the next term's line leaves it out.
 */
function OfferLine({ course, context, classes = true }: { course: StudyPlanCourse; context: StudyPlanContext; classes?: boolean }) {
  const offer = nextTermOffer(course, context, { classes });
  return <small className={`rm-offer rm-offer-${offer.tone}`}>{offer.text}</small>;
}

/** "Học cùng lớp khóa K30, K31 (theo kế hoạch đào tạo)": the class of a planned course in its term (user 2026-11-08). */
function ClassLine({ course, term, context }: { course: StudyPlanCourse; term: string; context: StudyPlanContext }) {
  const text = classesText(course, term, context.cohortCode);
  return text ? <small className="rm-class">Học cùng {text}</small> : null;
}

function CourseFacts({ course, names, byCode, context }: { course: StudyPlanCourse; names: ReadonlyMap<string, string>; byCode: ReadonlyMap<string, StudyPlanCourse>; context: StudyPlanContext }) {
  const prerequisites = ownRelations(course, course.prerequisites, byCode);
  const facts = [`${formatNumber(course.credits)} TC`,
    prerequisites.length ? `Tiên quyết: ${prerequisites.map((code) => names.get(code) ?? code).join(", ")}` : null,
    course.state === "failed" ? `Chưa đạt${course.grade ? ` (${course.grade})` : ""}: học lại` : null,
    course.state === "passed" ? `Đã đạt${course.grade ? ` (${course.grade})` : ""}: học cải thiện nếu muốn nâng điểm` : null,
    course.applicable ? null : "Môn khác chuyên ngành: không tính cho chuyên ngành của bạn"].filter(Boolean);
  const hint = thesisHint(context, course.code);
  return <><small className="rm-course-facts">{facts.join(" · ")}</small><OfferLine course={course} context={context} />
    {hint && <small className="rm-issue"><Mark kind="warning" /> {hint}</small>}</>;
}

/** The width below which student-roadmap.css stacks Danh sách chờ under the terms. */
const STACKED_QUERY = "(max-width: 1100px)";

/** What the page proposes to change (planProposal), with Áp dụng and Bỏ qua; the plan stays as it is until one is pressed. */
function ProposalBox({ context, proposal, names, onApply, onDecline }: {
  context: StudyPlanContext; proposal: PlanProposal; names: ReadonlyMap<string, string>; onApply: () => void; onDecline: () => void;
}) {
  return <section className="rm-proposal" aria-labelledby="rm-proposal-title">
    <div>
      <h3 id="rm-proposal-title">Đề xuất thay đổi kế hoạch</h3>
      <p className="rm-proposal-lead">Kế hoạch của bạn chưa thay đổi. Bấm Áp dụng để cập nhật kế hoạch theo đề xuất dưới đây, hoặc Bỏ qua để giữ nguyên kế hoạch.</p>
    </div>
    {proposal.added.length > 0 && <div>
      <p>{proposalAddedText(proposal)}</p>
      <ul>{proposal.added.map((item) => <li key={item.code}><strong>{names.get(item.code) ?? item.code}</strong> ({item.code}): {termLabel(item.term)}</li>)}</ul>
    </div>}
    {proposal.moved.length > 0 && <div>
      <p>Chuyển {proposal.moved.length} học phần do lộ trình AI đề xuất ra sau môn tiên quyết của nó, vì chỉ đăng ký được khi đã đạt môn tiên quyết:</p>
      <ul>{proposal.moved.map((move) => <li key={move.code}><strong>{names.get(move.code) ?? move.code}</strong> ({move.code}): {termLabel(move.from)} → {termLabel(move.to)}</li>)}</ul>
    </div>}
    {proposal.aiRemoved.length > 0 && <p>{aiCleanedText(context, proposal.aiRemoved, true)}</p>}
    {proposal.thesisRemoved.length > 0 && <p>{thesisCleanedText(context, proposal.thesisRemoved, true)}</p>}
    <div className="rm-actions">
      <button type="button" className="sw-primary" onClick={onApply}>Áp dụng</button>
      <button type="button" className="sw-outline" onClick={onDecline}>Bỏ qua</button>
    </div>
  </section>;
}

/**
 * readOnly: a cố vấn học tập's or the Khoa's view of the student's plan (advisor-view.ts) until they choose Sửa kế hoạch
 * (onEdit, user 2026-11-10): the terms as they are, nothing to move, add or apply. suggestions: the AI roadmap's improvements (Danh sách chờ, never added); proposal: what the page proposes to
 * change (onApply: Áp dụng; onDecline: Bỏ qua; declined: the student declined one on this visit); cleaned: what an older AI
 * roadmap had added and the student took out on this visit (cleanAiAdded); thesisCleaned: the thesis group's other way
 * taken out on this visit (cleanThesisWay, user 2026-11-03).
 */
export function RoadmapPlanner({ context, plan, onChange, saveState, saveError, origin, onOpenAi, readOnly = false, onEdit, suggestions = [], cleaned = [], thesisCleaned = [],
  proposal = null, onApply, onDecline, declined = false }: {
  context: StudyPlanContext; plan: StudyPlanData; onChange: (plan: StudyPlanData) => void; saveState: SaveState; saveError: string;
  origin: PlanOrigin; onOpenAi: () => void; readOnly?: boolean; onEdit?: () => void; suggestions?: readonly AiSuggestion[]; cleaned?: readonly string[]; thesisCleaned?: readonly string[];
  proposal?: PlanProposal | null; onApply?: () => void; onDecline?: () => void; declined?: boolean;
}) {
  const [side, setSide] = useState<"list" | "search">("list");
  const [query, setQuery] = useState("");
  const firstOpen = plan.terms.find((term) => term.code !== context.currentTerm)?.code ?? plan.terms[0]?.code ?? context.currentTerm;
  const [target, setTarget] = useState(firstOpen);
  const [over, setOver] = useState<string | null>(null);
  const sidePanel = useRef<HTMLElement>(null);
  const names = useMemo(() => new Map(context.courses.map((course) => [course.code, course.name])), [context.courses]);
  const byCode = useMemo(() => new Map(context.courses.map((course) => [course.code, course])), [context.courses]);
  const issues = planIssues(context, plan);
  const placed = plannedTerms(plan);
  const sections = poolSections(context, plan, suggestions);
  const found = searchCourses(context, query).filter((course) => !placed.has(course.code));
  const targetTerm = plan.terms.some((term) => term.code === target) ? target : firstOpen;
  const plannedCount = plan.terms.reduce((sum, term) => sum + term.courses.length, 0);

  const move = (code: string, to: string | null) => onChange(moveCourse(plan, code, to));
  /** "+ Thêm vào học kỳ này": that term in "Thêm vào"; on a narrow screen the list sits under every term, so it scrolls into view. */
  const addHere = (term: string) => {
    setTarget(term);
    setSide("list");
    const panel = sidePanel.current;
    if (!panel || !window.matchMedia?.(STACKED_QUERY).matches) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    panel.focus({ preventScroll: true });
  };
  const addTerm = () => {
    const last = plan.terms.at(-1)?.code ?? context.currentTerm;
    if (plan.terms.length < MAX_TERMS) onChange({ ...plan, terms: [...plan.terms, { code: nextTerm(last), courses: [] }] });
  };
  const dragStart = (event: DragEvent, code: string) => { event.dataTransfer.setData(DRAG_TYPE, code); event.dataTransfer.effectAllowed = "move"; };
  const drop = (event: DragEvent, term: string | null) => {
    const code = event.dataTransfer.getData(DRAG_TYPE);
    setOver(null);
    if (code) { event.preventDefault(); move(code, term); }
  };
  const allowDrop = (event: DragEvent, id: string) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    if (over !== id) setOver(id);
  };

  // Drag and drop only where the plan can change.
  const dragProps = (code: string) => (readOnly ? {} : { draggable: true, onDragStart: (event: DragEvent) => dragStart(event, code) });
  const dropProps = (id: string, term: string | null) => (readOnly ? {} : {
    onDragOver: (event: DragEvent) => allowDrop(event, id), onDragLeave: () => setOver(null), onDrop: (event: DragEvent) => drop(event, term),
  });

  const courseItem = (course: StudyPlanCourse) => <li key={course.code} className="rm-side-course" {...dragProps(course.code)}>
    <div>
      <strong>{course.name}</strong>
      <span className="rm-course-code">{course.code}</span>
      <CourseFacts course={course} names={names} byCode={byCode} context={context} />
    </div>
    <button type="button" className="rm-add" onClick={() => move(course.code, targetTerm)} aria-label={`Thêm ${course.name} vào ${termLabel(targetTerm)}`}>
      <Icon name="plus" />Thêm
    </button>
  </li>;

  return <section className={`sw-panel rm-planner-panel${readOnly ? " rm-planner-readonly" : ""}`} aria-labelledby="rm-planner-title">
    <header className="rm-planner-head">
      <div>
        <h2 id="rm-planner-title">Kế hoạch học kỳ</h2>
        {readOnly ? <p>Kế hoạch các học kỳ tới của sinh viên.{onEdit ? " Bấm Sửa kế hoạch để sắp xếp, điều chỉnh kế hoạch thay sinh viên." : ""}</p> : <p>{plannedCount
          ? <>Bạn điều chỉnh kế hoạch bằng cách kéo học phần giữa các học kỳ, kéo từ Danh sách chờ vào, hoặc chọn học kỳ ở "Thêm vào" rồi bấm Thêm.</>
          : <>Xếp các học phần còn thiếu vào từng học kỳ: kéo từ Danh sách chờ vào một học kỳ, hoặc chọn học kỳ ở "Thêm vào" rồi bấm Thêm.</>} Kế hoạch tự lưu và được tính ở chế độ Theo kế hoạch của mục Theo dõi tiến độ.</p>}
      </div>
      {readOnly && onEdit && <button type="button" className="sw-outline" onClick={onEdit}><Icon name="edit" />Sửa kế hoạch</button>}
      {!readOnly && <p className={`rm-save rm-save-${saveState}`} role="status">{saveState === "saving" ? "Đang lưu…" : saveState === "saved" ? "Đã lưu" : saveState === "dirty" ? "Có thay đổi chưa lưu" : saveState === "error" ? saveError || "Chưa lưu được" : ""}</p>}
    </header>
    {!context.curriculum && <p className="rm-note">Chưa có chương trình đào tạo cho khóa của bạn nên chưa có danh sách học phần để lên kế hoạch.</p>}
    {!readOnly && proposal && onApply && onDecline && <ProposalBox context={context} proposal={proposal} names={names} onApply={onApply} onDecline={onDecline} />}
    {!readOnly && declined && !proposal && <p className="rm-origin" role="status"><Mark kind="planned" /> Đã bỏ qua đề xuất: kế hoạch giữ nguyên và đề xuất này sẽ không hiện lại.</p>}
    {!readOnly && origin?.kind === "prefill" && plannedCount > 0 && <p className="rm-origin"><Mark kind="planned" /> Kế hoạch được điền sẵn {plannedCount} học phần bắt buộc còn lại theo kế hoạch đào tạo của khóa; kế hoạch sẽ được lưu khi bạn chỉnh sửa.</p>}
    {plan.aiAdded && <div className="rm-origin rm-origin-ai">
      <Mark kind="planned" />
      <p>{aiAddedText(context, plan.aiAdded)}</p>
      {!readOnly && <button type="button" className="rm-link" onClick={() => onChange({ ...plan, aiAdded: null })}>Ẩn thông báo</button>}
    </div>}
    {cleaned.length > 0 && <div className="rm-origin rm-origin-ai" role="status">
      <Mark kind="warning" />
      <p>{aiCleanedText(context, cleaned)}</p>
    </div>}
    {thesisCleaned.length > 0 && <div className="rm-origin rm-origin-ai" role="status">
      <Mark kind="warning" />
      <p>{thesisCleanedText(context, thesisCleaned)}</p>
    </div>}
    {!plannedCount && context.curriculum && <div className="rm-origin rm-origin-empty">
      <p>Kế hoạch chưa có học phần nào.{readOnly ? "" : <> Học phần bắt buộc chỉ được điền sẵn khi còn ở phía trước theo kế hoạch đào tạo (học phần đã trễ không được điền), và học phần lộ trình AI đề xuất được đưa ra để bạn bấm Áp dụng khi bạn có lộ trình AI. Hãy tạo lộ trình ở mục Lộ trình AI đề xuất, hoặc tự thêm học phần từ Danh sách chờ.</>}</p>
      <button type="button" className="sw-outline" onClick={onOpenAi}>Mở Lộ trình AI đề xuất</button>
    </div>}
    <div className="rm-planner">
      <div className="rm-terms">
        {plan.terms.map((term) => {
          const load = termLoad(context, plan, term.code);
          const running = runningIn(context, term.code).filter((course) => !placed.has(course.code));
          const current = term.code === context.currentTerm;
          return <section key={term.code} className={`rm-term${over === term.code ? " is-over" : ""}`} aria-label={termLabel(term.code)}
            {...dropProps(term.code, term.code)}>
            <header className="rm-term-head">
              <h3>{termLabel(term.code)}{current && <span className="rm-tag rm-tag-running">Học kỳ hiện tại</span>}</h3>
              <div className="rm-load-box">
                <span className={`rm-load${load.credits > 0 ? " rm-load-ok" : ""}`}>{termLoadText(load)}</span>
                {load.conditional > 0 && <small className="rm-load-note" title="Môn điều kiện: Giáo dục thể chất, Giáo dục quốc phòng; không tính vào tín chỉ tích lũy.">
                  gồm {formatNumber(load.conditional)} TC môn điều kiện</small>}
              </div>
            </header>
            <ul className="rm-term-courses">
              {running.map((course) => <li key={course.code} className="rm-term-course is-locked">
                <Mark kind="running" />
                <div><strong>{course.name}</strong><span className="rm-course-code">{course.code}</span><small className="rm-course-facts">{formatNumber(course.credits)} TC · Đang học</small></div>
              </li>)}
              {term.courses.map((item) => {
                const course = byCode.get(item.code.toUpperCase());
                const problems = course ? [...issueTexts(issues.get(course.code), course, term.code, names),
                  ...(course.applicable ? [] : ["Môn khác chuyên ngành: không tính cho chuyên ngành của bạn"]),
                  ...[thesisHint(context, course.code)].filter((text): text is string => Boolean(text))] : ["Học phần không còn trong chương trình đào tạo"];
                return <li key={item.code} className={`rm-term-course${problems.length ? " has-issue" : ""}`} {...dragProps(item.code)}>
                  <Mark kind="planned" />
                  <div>
                    <strong>{course?.name ?? item.code}</strong><span className="rm-course-code">{item.code}</span>
                    {course && <small className="rm-course-facts">{formatNumber(course.credits)} TC{course.state === "failed" ? " · học lại" : ""}{course.state === "passed" ? ` · học cải thiện${course.grade ? ` (đã đạt ${course.grade})` : ""}` : ""}{course.conditional ? " · môn điều kiện" : ""}</small>}
                    {course && <ClassLine course={course} term={term.code} context={context} />}
                    {course && <OfferLine course={course} context={context} classes={false} />}
                    {problems.map((text) => <small key={text} className="rm-issue"><Mark kind="warning" /> {text}</small>)}
                  </div>
                  {!readOnly && <div className="rm-term-actions">
                    <select aria-label={`Chuyển ${course?.name ?? item.code} sang học kỳ khác`} value={term.code} onChange={(event) => move(item.code, event.target.value || null)}>
                      {plan.terms.map((option) => <option key={option.code} value={option.code}>{termLabel(option.code)}</option>)}
                      <option value="">Bỏ khỏi kế hoạch</option>
                    </select>
                    <button type="button" className="rm-remove" onClick={() => move(item.code, null)} aria-label={`Bỏ ${course?.name ?? item.code} khỏi kế hoạch`} title="Bỏ khỏi kế hoạch">×</button>
                  </div>}
                </li>;
              })}
            </ul>
            {!running.length && !term.courses.length && <p className="rm-drop-hint">{readOnly ? "Chưa có học phần nào." : "Kéo học phần vào đây hoặc bấm Thêm vào học kỳ này."}</p>}
            {!readOnly && <button type="button" className="rm-link" onClick={() => addHere(term.code)}>+ Thêm vào học kỳ này</button>}
          </section>;
        })}
        {!readOnly && plan.terms.length < MAX_TERMS && <button type="button" className="rm-add-term" onClick={addTerm}><Icon name="plus" />Thêm học kỳ</button>}
      </div>

      {!readOnly && <aside ref={sidePanel} tabIndex={-1} className={`rm-side${over === "side" ? " is-over" : ""}`} aria-label="Học phần còn thiếu"
        {...dropProps("side", null)}>
        <label className="rm-target">Thêm vào
          <select value={targetTerm} onChange={(event) => setTarget(event.target.value)}>
            {plan.terms.map((term) => <option key={term.code} value={term.code}>{termLabel(term.code)}</option>)}
          </select>
        </label>
        <div className="rm-side-tabs" role="tablist" aria-label="Nguồn học phần">
          <button type="button" role="tab" aria-selected={side === "list"} onClick={() => setSide("list")}>Danh sách chờ</button>
          <button type="button" role="tab" aria-selected={side === "search"} onClick={() => setSide("search")}>Tìm học phần</button>
        </div>
        {side === "list" ? <div role="tabpanel" aria-label="Danh sách chờ">
          {!sections.length && <p className="rm-empty">Mọi học phần còn thiếu đã có trong kế hoạch.</p>}
          {sections.map((section) => <details key={section.id} className="rm-side-group" open={section.id === "mandatory" || section.id.startsWith("group-") || section.id === "improve"}>
            <summary><span>{section.title}</span>{section.note && <em>{section.note}</em>}<small>{section.courses.length}</small></summary>
            <ul>{section.courses.map(courseItem)}</ul>
          </details>)}
        </div> : <div role="tabpanel" aria-label="Tìm học phần">
          <label className="rm-search"><span className="sr-only">Tìm theo tên hoặc mã học phần</span>
            <input type="search" value={query} placeholder="Tên hoặc mã học phần" onChange={(event) => setQuery(event.target.value)} />
          </label>
          {query.trim() && !found.length && <p className="rm-empty">Không tìm thấy học phần phù hợp mà bạn chưa học và chưa có trong kế hoạch.</p>}
          <ul>{found.map(courseItem)}</ul>
        </div>}
        <p className="rm-side-hint">Thả học phần vào đây để bỏ khỏi kế hoạch.</p>
      </aside>}
    </div>
  </section>;
}
