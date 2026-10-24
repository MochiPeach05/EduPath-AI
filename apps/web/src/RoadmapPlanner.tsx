import { useMemo, useState, type DragEvent } from "react";
import type { PlanOrigin } from "./StudentRoadmap";
import { Icon } from "./student-icons";
import { Mark } from "./RoadmapProgress";
import {
  MAX_TERMS, formatNumber, moveCourse, nextTerm, offeredSemesters, planIssues, plannedTerms, poolSections, runningIn, searchCourses,
  termLabel, termLoad, type PlanIssue, type StudyPlanContext, type StudyPlanCourse, type StudyPlanData,
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

function CourseFacts({ course, names }: { course: StudyPlanCourse; names: ReadonlyMap<string, string> }) {
  const facts = [`${formatNumber(course.credits)} TC`, course.offeredTerms.length ? `Thường mở: ${offeredSemesters(course)}` : null,
    course.prerequisites.length ? `Tiên quyết: ${course.prerequisites.map((code) => names.get(code) ?? code).join(", ")}` : null,
    course.state === "failed" ? `Chưa đạt${course.grade ? ` (${course.grade})` : ""}: học lại` : null].filter(Boolean);
  return <small className="rm-course-facts">{facts.join(" · ")}</small>;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });

export function RoadmapPlanner({ context, plan, onChange, saveState, saveError, origin, onOpenAi }: {
  context: StudyPlanContext; plan: StudyPlanData; onChange: (plan: StudyPlanData) => void; saveState: SaveState; saveError: string;
  origin: PlanOrigin; onOpenAi: () => void;
}) {
  const [side, setSide] = useState<"list" | "search">("list");
  const [query, setQuery] = useState("");
  const firstOpen = plan.terms.find((term) => term.code !== context.currentTerm)?.code ?? plan.terms[0]?.code ?? context.currentTerm;
  const [target, setTarget] = useState(firstOpen);
  const [over, setOver] = useState<string | null>(null);
  const names = useMemo(() => new Map(context.courses.map((course) => [course.code, course.name])), [context.courses]);
  const byCode = useMemo(() => new Map(context.courses.map((course) => [course.code, course])), [context.courses]);
  const issues = planIssues(context, plan);
  const placed = plannedTerms(plan);
  const sections = poolSections(context, plan);
  const found = searchCourses(context, query).filter((course) => !placed.has(course.code));
  const targetTerm = plan.terms.some((term) => term.code === target) ? target : firstOpen;

  const move = (code: string, to: string | null) => onChange(moveCourse(plan, code, to));
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
      <CourseFacts course={course} names={names} />
    </div>
    <button type="button" className="rm-add" onClick={() => move(course.code, targetTerm)} aria-label={`Thêm ${course.name} vào ${termLabel(targetTerm)}`}>
      <Icon name="plus" />Thêm
    </button>
  </li>;

  return <section className="sw-panel rm-planner-panel" aria-labelledby="rm-planner-title">
    <header className="rm-planner-head">
      <div>
        <h2 id="rm-planner-title">Kế hoạch học kỳ</h2>
        <p>Kế hoạch được điền sẵn các học phần bắt buộc theo kế hoạch đào tạo của khóa và các học phần lộ trình AI đề xuất. Bạn điều chỉnh bằng cách kéo học phần giữa các học kỳ, kéo từ Danh sách chờ vào, hoặc chọn học kỳ ở "Thêm vào" rồi bấm Thêm. Kế hoạch tự lưu và được tính ở chế độ Theo kế hoạch của mục Theo dõi tiến độ.</p>
      </div>
      <p className={`rm-save rm-save-${saveState}`} role="status">{saveState === "saving" ? "Đang lưu…" : saveState === "saved" ? "Đã lưu" : saveState === "dirty" ? "Có thay đổi chưa lưu" : saveState === "error" ? saveError || "Chưa lưu được" : ""}</p>
    </header>
    {!context.curriculum && <p className="rm-note">Chưa có chương trình đào tạo cho khóa của bạn nên chưa có danh sách học phần để lên kế hoạch.</p>}
    {origin?.kind === "ai" && <p className="rm-origin"><Mark kind="planned" /> {origin.added
      ? `Đã thêm ${origin.added} học phần do lộ trình AI đề xuất (lộ trình soạn lúc ${dateTime(origin.completedAt)}), từ ${termLabel(origin.term)} theo học kỳ kế hoạch đào tạo mở môn. Bạn điều chỉnh tiếp bên dưới.`
      : `Các học phần lộ trình AI đề xuất (soạn lúc ${dateTime(origin.completedAt)}) đã có sẵn trong kế hoạch.`}</p>}
    {origin?.kind === "prefill" && <p className="rm-origin"><Mark kind="planned" /> Kế hoạch được điền sẵn các học phần bắt buộc theo kế hoạch đào tạo của khóa. Khi bạn chỉnh sửa, kế hoạch sẽ được lưu.</p>}
    {!plan.terms.some((term) => term.courses.length) && !runningIn(context, context.currentTerm).length && context.curriculum && <div className="rm-origin rm-origin-empty">
      <p>Chưa có học phần nào được điền sẵn: các học phần còn lại của bạn đã trễ so với kế hoạch đào tạo, hoặc bạn chưa tạo lộ trình AI. Hãy tạo Lộ trình AI để được đề xuất, rồi điều chỉnh tại đây.</p>
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
              <span className={`rm-load rm-load-${load.status}`} title={load.conditional
                ? `Gồm ${formatNumber(load.conditional)} TC môn điều kiện (Giáo dục thể chất, Giáo dục quốc phòng), không tính vào tín chỉ tích lũy.` : undefined}>{formatNumber(load.credits)} TC{load.status === "over" && context.limits ? ` · vượt ${context.limits.max}` : load.status === "under" && context.limits ? ` · dưới ${context.limits.min}` : ""}</span>
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
                    {problems.map((text) => <small key={text} className="rm-issue"><Mark kind="not_counted" /> {text}</small>)}
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
            <button type="button" className="rm-link" onClick={() => { setTarget(term.code); setSide("list"); }}>+ Thêm vào học kỳ này</button>
          </section>;
        })}
        {plan.terms.length < MAX_TERMS && <button type="button" className="rm-add-term" onClick={addTerm}><Icon name="plus" />Thêm học kỳ</button>}
      </div>

      <aside className={`rm-side${over === "side" ? " is-over" : ""}`} aria-label="Học phần còn thiếu"
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
          {query.trim() && !found.length && <p className="rm-empty">Không có học phần phù hợp còn chưa học.</p>}
          <ul>{found.map(courseItem)}</ul>
        </div>}
        <p className="rm-side-hint">Thả học phần vào đây để bỏ khỏi kế hoạch.</p>
      </aside>
    </div>
  </section>;
}
