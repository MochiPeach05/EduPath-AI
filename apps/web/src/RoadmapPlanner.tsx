import { useMemo, useRef, useState, type DragEvent } from "react";
import { Icon } from "./student-icons";
import { Mark } from "./RoadmapProgress";
import {
  MAX_TERMS, aiAddedText, formatNumber, moveCourse, nextTerm, offeredSemesters, ownRelations, planIssues, plannedTerms, poolSections, runningIn,
  searchCourses, termLabel, termLoad, termLoadText, type PlanIssue, type PlanOrigin, type StudyPlanContext, type StudyPlanCourse, type StudyPlanData,
} from "./study-plan-data";

// "Kế hoạch học kỳ" of #roadmap (user 2026-10-24, after Stellic's planner; it starts from the training plan and the AI
// roadmap's proposal, study-plan/prefill.ts): the terms ahead,
// the courses still needed on the right ("Danh sách chờ") or found by search, placed by drag and drop or "Thêm vào";
// missing prerequisites and courses no training plan opens in that term are flagged. No weekly schedule.

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

function CourseFacts({ course, names, byCode }: { course: StudyPlanCourse; names: ReadonlyMap<string, string>; byCode: ReadonlyMap<string, StudyPlanCourse> }) {
  const prerequisites = ownRelations(course, course.prerequisites, byCode);
  const facts = [`${formatNumber(course.credits)} TC`, course.offeredTerms.length ? `Thường mở: ${offeredSemesters(course)}` : null,
    prerequisites.length ? `Tiên quyết: ${prerequisites.map((code) => names.get(code) ?? code).join(", ")}` : null,
    course.state === "failed" ? `Chưa đạt${course.grade ? ` (${course.grade})` : ""}: học lại` : null].filter(Boolean);
  return <small className="rm-course-facts">{facts.join(" · ")}</small>;
}

/** The width below which student-roadmap.css stacks Danh sách chờ under the terms. */
const STACKED_QUERY = "(max-width: 1100px)";

export function RoadmapPlanner({ context, plan, onChange, saveState, saveError, origin, onOpenAi }: {
  context: StudyPlanContext; plan: StudyPlanData; onChange: (plan: StudyPlanData) => void; saveState: SaveState; saveError: string;
  origin: PlanOrigin; onOpenAi: () => void;
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
  const sections = poolSections(context, plan);
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

  const courseItem = (course: StudyPlanCourse) => <li key={course.code} className="rm-side-course" draggable onDragStart={(event) => dragStart(event, course.code)}>
    <div>
      <strong>{course.name}</strong>
      <span className="rm-course-code">{course.code}</span>
      <CourseFacts course={course} names={names} byCode={byCode} />
    </div>
    <button type="button" className="rm-add" onClick={() => move(course.code, targetTerm)} aria-label={`Thêm ${course.name} vào ${termLabel(targetTerm)}`}>
      <Icon name="plus" />Thêm
    </button>
  </li>;

  return <section className="sw-panel rm-planner-panel" aria-labelledby="rm-planner-title">
    <header className="rm-planner-head">
      <div>
        <h2 id="rm-planner-title">Kế hoạch học kỳ</h2>
        <p>{plannedCount
          ? <>Bạn điều chỉnh kế hoạch bằng cách kéo học phần giữa các học kỳ, kéo từ Danh sách chờ vào, hoặc chọn học kỳ ở "Thêm vào" rồi bấm Thêm.</>
          : <>Xếp các học phần còn thiếu vào từng học kỳ: kéo từ Danh sách chờ vào một học kỳ, hoặc chọn học kỳ ở "Thêm vào" rồi bấm Thêm.</>} Kế hoạch tự lưu và được tính ở chế độ Theo kế hoạch của mục Theo dõi tiến độ.</p>
      </div>
      <p className={`rm-save rm-save-${saveState}`} role="status">{saveState === "saving" ? "Đang lưu…" : saveState === "saved" ? "Đã lưu" : saveState === "dirty" ? "Có thay đổi chưa lưu" : saveState === "error" ? saveError || "Chưa lưu được" : ""}</p>
    </header>
    {!context.curriculum && <p className="rm-note">Chưa có chương trình đào tạo cho khóa của bạn nên chưa có danh sách học phần để lên kế hoạch.</p>}
    {origin?.kind === "prefill" && plannedCount > 0 && <p className="rm-origin"><Mark kind="planned" /> Kế hoạch được điền sẵn {plannedCount} học phần bắt buộc còn lại theo kế hoạch đào tạo của khóa; kế hoạch sẽ được lưu khi bạn chỉnh sửa.</p>}
    {plan.aiAdded && <div className="rm-origin rm-origin-ai">
      <Mark kind="planned" />
      <p>{aiAddedText(context, plan.aiAdded)}</p>
      <button type="button" className="rm-link" onClick={() => onChange({ ...plan, aiAdded: null })}>Ẩn thông báo</button>
    </div>}
    {!plannedCount && context.curriculum && <div className="rm-origin rm-origin-empty">
      <p>Kế hoạch chưa có học phần nào. Học phần bắt buộc chỉ được điền sẵn khi còn ở phía trước theo kế hoạch đào tạo (học phần đã trễ không được điền), và học phần lộ trình AI đề xuất được thêm khi bạn có lộ trình AI. Hãy tạo lộ trình ở mục Lộ trình AI đề xuất, hoặc tự thêm học phần từ Danh sách chờ.</p>
      <button type="button" className="sw-outline" onClick={onOpenAi}>Mở Lộ trình AI đề xuất</button>
    </div>}
    <div className="rm-planner">
      <div className="rm-terms">
        {plan.terms.map((term) => {
          const load = termLoad(context, plan, term.code);
          const running = runningIn(context, term.code).filter((course) => !placed.has(course.code));
          const current = term.code === context.currentTerm;
          return <section key={term.code} className={`rm-term${over === term.code ? " is-over" : ""}`} aria-label={termLabel(term.code)}
            onDragOver={(event) => allowDrop(event, term.code)} onDragLeave={() => setOver(null)} onDrop={(event) => drop(event, term.code)}>
            <header className="rm-term-head">
              <h3>{termLabel(term.code)}{current && <span className="rm-tag rm-tag-running">Học kỳ hiện tại</span>}</h3>
              <div className="rm-load-box">
                <span className={`rm-load rm-load-${load.status}`}>{termLoadText(load, context.limits)}</span>
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
                const problems = course ? issueTexts(issues.get(course.code), course, term.code, names) : ["Học phần không còn trong chương trình đào tạo"];
                return <li key={item.code} className={`rm-term-course${problems.length ? " has-issue" : ""}`} draggable onDragStart={(event) => dragStart(event, item.code)}>
                  <Mark kind="planned" />
                  <div>
                    <strong>{course?.name ?? item.code}</strong><span className="rm-course-code">{item.code}</span>
                    {course && <small className="rm-course-facts">{formatNumber(course.credits)} TC{course.state === "failed" ? " · học lại" : ""}{course.conditional ? " · môn điều kiện" : ""}</small>}
                    {problems.map((text) => <small key={text} className="rm-issue"><Mark kind="warning" /> {text}</small>)}
                  </div>
                  <div className="rm-term-actions">
                    <select aria-label={`Chuyển ${course?.name ?? item.code} sang học kỳ khác`} value={term.code} onChange={(event) => move(item.code, event.target.value || null)}>
                      {plan.terms.map((option) => <option key={option.code} value={option.code}>{termLabel(option.code)}</option>)}
                      <option value="">Bỏ khỏi kế hoạch</option>
                    </select>
                    <button type="button" className="rm-remove" onClick={() => move(item.code, null)} aria-label={`Bỏ ${course?.name ?? item.code} khỏi kế hoạch`} title="Bỏ khỏi kế hoạch">×</button>
                  </div>
                </li>;
              })}
            </ul>
            {!running.length && !term.courses.length && <p className="rm-drop-hint">Kéo học phần vào đây hoặc bấm Thêm vào học kỳ này.</p>}
            <button type="button" className="rm-link" onClick={() => addHere(term.code)}>+ Thêm vào học kỳ này</button>
          </section>;
        })}
        {plan.terms.length < MAX_TERMS && <button type="button" className="rm-add-term" onClick={addTerm}><Icon name="plus" />Thêm học kỳ</button>}
      </div>

      <aside ref={sidePanel} tabIndex={-1} className={`rm-side${over === "side" ? " is-over" : ""}`} aria-label="Học phần còn thiếu"
        onDragOver={(event) => allowDrop(event, "side")} onDragLeave={() => setOver(null)} onDrop={(event) => drop(event, null)}>
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
          {sections.map((section) => <details key={section.id} className="rm-side-group" open={section.id === "mandatory" || section.id.startsWith("group-")}>
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
      </aside>
    </div>
  </section>;
}
