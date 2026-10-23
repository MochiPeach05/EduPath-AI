import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Icon } from "./student-icons";
import {
  BLOCKS, DAYS, MAX_SESSIONS, MAX_TERMS, changeSessions, clashes, conditionIssues, creditProgress, dayLabel, defaultTerms, mergeSuggestion, moveCourse,
  nextTerm, placeSession, poolSections, runningIn, termIndex, termLabel, termLoad,
  type ConditionIssue, type StudyPlanContext, type StudyPlanCourse, type StudyPlanData, type StudyPlanProjection,
} from "./study-plan-checks";
import "./student-roadmap.css";

// "Lộ trình học tập" (STU-PLAN-01–07, user 2026-10-23): a board of the remaining terms (drag courses from "Môn còn phải
// học"), a weekly timetable per term (Thứ 2 … Chủ nhật × blocks of 3 periods) and the progress toward graduation.

type Saved = { version: string; data: StudyPlanData; updatedAt: string };
type Loaded = { context: StudyPlanContext; plan: Saved | null; projection: StudyPlanProjection | null };
/** What is being dragged, or picked to place by a click (touch and keyboard). */
type Grab = { kind: "course"; code: string } | { kind: "session"; term: string; code: string; index: number };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const DRAG_TYPE = "application/x-edupath-plan";
const messages: Record<string, string> = {
  plan_changed: "Lộ trình vừa được sửa ở một phiên khác. Hãy tải lại trang để xem bản mới nhất.",
  invalid_plan: "Lộ trình chưa hợp lệ nên chưa được lưu. Hãy tải lại trang.",
  plan_too_large: "Lộ trình quá lớn để lưu.",
  curriculum_unavailable: "Chưa có chương trình đào tạo cho khóa của bạn nên chưa xếp được lộ trình.",
  plan_not_found: "Chưa có lộ trình đã lưu để xuất.",
  account_unavailable: "Tài khoản hiện không dùng được chức năng này.",
  authentication_required: "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.",
  database_required: "Chưa kết nối được nơi lưu lộ trình. Vui lòng thử lại sau.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
};
class RoadmapError extends Error {}
async function call<T>(input: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(input, { credentials: "include", ...init, headers: init.body ? { "Content-Type": "application/json" } : undefined });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new RoadmapError(messages[body.error ?? ""] ?? "Không xử lý được yêu cầu. Vui lòng thử lại.");
  return body as T;
}

/** The saved plan, with the terms from today on (empty ones) the board always shows. */
function withTerms(context: StudyPlanContext, data: StudyPlanData | null): StudyPlanData {
  const terms = new Map((data?.terms ?? []).map((term) => [term.code, term]));
  for (const code of defaultTerms(context)) if (!terms.has(code) && terms.size < MAX_TERMS) terms.set(code, { code, courses: [] });
  return { schemaVersion: 1, terms: [...terms.values()].sort((a, b) => termIndex(a.code) - termIndex(b.code)) };
}

const PALETTE = 8;
const colorOf = (code: string) => [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE;
const shortName = (name: string) => (name.length > 34 ? `${name.slice(0, 32)}…` : name);
const readGrab = (event: DragEvent): Grab | null => {
  try { return JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as Grab; } catch { return null; }
};

function CourseCard({ course, issue, names, terms, term, locked, onMove, onGrab }: {
  course: StudyPlanCourse; issue?: ConditionIssue; names: Map<string, string>; terms: string[]; term: string | null; locked?: boolean;
  onMove?: (to: string | null) => void; onGrab?: (event: DragEvent) => void;
}) {
  const kind = course.kind === "mandatory" ? "Bắt buộc" : course.group ? `Tự chọn ${course.group}` : "Tự chọn";
  const list = (codes: string[]) => codes.map((code) => names.get(code) ?? code).join(", ");
  return <article className={`rm-card${locked ? " is-locked" : ""}${issue ? " has-issue" : ""}`} draggable={!locked} onDragStart={onGrab}
    aria-label={`${course.name}, ${course.credits} tín chỉ${locked ? ", đang học" : ""}`}>
    <div className="rm-card-head"><strong>{course.name}</strong><span className="rm-credits">{course.credits} TC</span></div>
    <p className="rm-card-meta">{course.code} · {kind}{course.conditional ? " · (*) điều kiện" : ""}{course.sessions.length ? ` · ${course.sessions.join(" + ")}` : ""}</p>
    {(course.state === "failed" || course.state === "graded_unknown" || locked || course.onlyInStandard) && <p className="rm-card-tags">
      {locked && <span className="rm-tag rm-tag-running">Đang học</span>}
      {course.onlyInStandard && <span className="rm-tag" title="Môn có trong tiêu chuẩn xét tốt nghiệp nhưng không có trong chương trình đào tạo">Theo tiêu chuẩn TN</span>}
      {course.state === "failed" && <span className="rm-tag rm-tag-retake">Học lại</span>}
      {course.state === "graded_unknown" && <span className="rm-tag">Chưa rõ kết quả</span>}</p>}
    {issue && <p className="rm-card-issue" role="note">
      {issue.prerequisites.length > 0 && <>Cần qua trước: {list(issue.prerequisites)}. </>}
      {issue.prior.length > 0 && <>Cần học trước: {list(issue.prior)}.</>}</p>}
    {!locked && onMove && <label className="rm-card-move"><span className="rm-visually-hidden">Học kỳ của {course.name}</span>
      <select value={term ?? ""} onChange={(event) => onMove(event.target.value || null)}>
        <option value="">{term ? "Bỏ khỏi lộ trình" : "Thêm vào học kỳ…"}</option>
        {terms.map((code) => <option key={code} value={code}>{termLabel(code)}</option>)}
      </select></label>}
  </article>;
}

function Confirm({ title, children, action, busy, onConfirm, onClose }: { title: string; children: ReactNode; action: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return <div className="rm-confirm" role="alertdialog" aria-labelledby="rm-confirm-title"><div><strong id="rm-confirm-title">{title}</strong><p>{children}</p></div>
    <div className="rm-confirm-actions"><button className="sr-secondary" disabled={busy} onClick={onClose}>Hủy</button><button className="sw-primary" disabled={busy} onClick={onConfirm}>{action}</button></div></div>;
}

export default function StudentRoadmap() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [plan, setPlan] = useState<StudyPlanData>({ schemaVersion: 1, terms: [] });
  const [projection, setProjection] = useState<StudyPlanProjection | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [week, setWeek] = useState<string | null>(null);
  const [picked, setPicked] = useState<Grab | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"suggest" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const version = useRef<string | null>(null);
  const latest = useRef(plan);
  const saving = useRef(false);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await call<Loaded>("/api/student/study-plan");
      setLoaded(data);
      const next = withTerms(data.context, data.plan?.data ?? null);
      setPlan(next); latest.current = next;
      version.current = data.plan?.version ?? null;
      setSavedAt(data.plan?.updatedAt ?? null);
      setProjection(data.projection);
      setSaveState("idle"); setError("");
    } catch (e) { setLoadError(e instanceof Error ? e.message : "Không tải được lộ trình."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (saving.current) return;
    saving.current = true; dirty.current = false; setSaveState("saving");
    try {
      const result = await call<{ plan: Saved; projection: StudyPlanProjection | null }>("/api/student/study-plan", { method: "PUT", body: JSON.stringify({ version: version.current, data: latest.current }) });
      version.current = result.plan.version;
      setSavedAt(result.plan.updatedAt); setProjection(result.projection);
      setSaveState(dirty.current ? "dirty" : "saved");
    } catch (e) {
      setSaveState("error"); setError(e instanceof Error ? e.message : "Chưa lưu được lộ trình.");
    } finally { saving.current = false; }
  }, []);
  // Saves 0,7 s after the last change; a change during a save saves again afterwards.
  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = setTimeout(() => void save(), 700);
    return () => clearTimeout(timer);
  }, [plan, saveState, save]);
  const edit = (next: StudyPlanData) => {
    setPlan(next); latest.current = next; dirty.current = true;
    if (saveState !== "error") setSaveState("dirty");
  };

  const context = loaded?.context;
  const names = useMemo(() => new Map(context?.courses.map((course) => [course.code, course.name]) ?? []), [context]);
  const byCode = useMemo(() => new Map(context?.courses.map((course) => [course.code, course]) ?? []), [context]);
  const issues = useMemo(() => (context ? conditionIssues(context, plan) : new Map<string, ConditionIssue>()), [context, plan]);
  const terms = plan.terms.map((term) => term.code);
  const planned = plan.terms.filter((term) => term.courses.length);
  const shownWeek = week && planned.some((term) => term.code === week) ? week
    : planned.find((term) => context && termIndex(term.code) >= termIndex(context.currentTerm))?.code ?? planned[0]?.code ?? null;
  const weekTerm = plan.terms.find((term) => term.code === shownWeek);
  const clashing = useMemo(() => clashes(weekTerm), [weekTerm]);

  if (loadError) return <section className="sw-panel"><div className="sr-error" role="alert">{loadError}<button onClick={() => void load()}>Thử lại</button></div></section>;
  if (!loaded || !context) return <section className="sw-panel" aria-busy="true"><p role="status">Đang tải lộ trình học tập…</p></section>;
  if (!context.curriculum) return <section className="sw-panel sw-empty"><h2>Chưa xếp được lộ trình</h2><p>{context.cohortCode
    ? `Chưa có chương trình đào tạo của khóa ${context.cohortCode} trong hệ thống. Lộ trình sẽ mở khi khoa cập nhật chương trình đào tạo.`
    : "Hệ thống chưa biết khóa học của bạn. Hãy kiểm tra Hồ sơ và bảng điểm."}</p></section>;

  const move = (code: string, to: string | null) => { edit(moveCourse(plan, context, code, to)); setPicked(null); };
  const grabCourse = (code: string) => (event: DragEvent) => { event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: "course", code } satisfies Grab)); event.dataTransfer.effectAllowed = "move"; };
  const grabSession = (grab: Extract<Grab, { kind: "session" }>) => (event: DragEvent) => { event.stopPropagation(); event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(grab)); event.dataTransfer.effectAllowed = "move"; };
  const allowDrop = (key: string) => (event: DragEvent) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); setOver(key); } };
  const dropOnTerm = (to: string | null) => (event: DragEvent) => {
    event.preventDefault(); setOver(null);
    const grab = readGrab(event);
    if (grab?.kind === "course") move(grab.code, to);
  };
  const dropOnSlot = (day: number, block: number) => (event: DragEvent) => {
    event.preventDefault(); setOver(null);
    const grab = readGrab(event);
    if (grab?.kind === "session" && shownWeek && grab.term === shownWeek) edit(placeSession(plan, shownWeek, grab.code, grab.index, { day, block }));
  };
  const clickSlot = (day: number, block: number) => {
    if (picked?.kind === "session" && shownWeek && picked.term === shownWeek) { edit(placeSession(plan, shownWeek, picked.code, picked.index, { day, block })); setPicked(null); }
  };
  const addTerm = () => { const last = terms.at(-1) ?? context.currentTerm; if (terms.length < MAX_TERMS) edit({ ...plan, terms: [...plan.terms, { code: nextTerm(last), courses: [] }] }); };
  const removeTerm = (code: string) => edit({ ...plan, terms: plan.terms.filter((term) => term.code !== code) });

  const suggest = async () => {
    setBusy(true); setError("");
    try {
      const result = await call<{ data: StudyPlanData; projection: StudyPlanProjection | null }>("/api/student/study-plan/suggest", { method: "POST" });
      edit(withTerms(context, mergeSuggestion(plan, result.data)));
      setConfirm(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Chưa xếp được lộ trình."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError("");
    try {
      if (version.current) await call("/api/student/study-plan", { method: "DELETE", body: JSON.stringify({ version: version.current }) });
      dirty.current = false; setConfirm(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Chưa xóa được lộ trình."); }
    finally { setBusy(false); }
  };

  const sections = poolSections(context, plan);
  const query = search.trim().toLocaleLowerCase("vi");
  const matches = (course: StudyPlanCourse) => !query || `${course.code} ${course.name}`.toLocaleLowerCase("vi").includes(query);
  const progress = creditProgress(context, plan);
  const loads = new Map(plan.terms.map((term) => [term.code, termLoad(context, plan, term.code)]));
  const overTerms = [...loads.values()].filter((load) => load.status === "over").length;
  const hasCourses = planned.length > 0;
  const percent = (value: number) => (progress.total ? `${Math.min(100, (value / progress.total) * 100)}%` : "0%");
  const statusText = saveState === "saving" ? "Đang lưu…" : saveState === "dirty" ? "Chưa lưu…" : saveState === "error" ? "Chưa lưu được"
    : savedAt ? `Đã lưu lúc ${new Date(savedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : "Chưa lưu";

  return <div className="rm-page">
    <section className="sw-panel rm-toolbar">
      <div><h2>Lộ trình của bạn</h2><p className="sw-muted">{context.curriculum.name}{context.specialtyLabel ? ` · ${context.specialtyLabel}` : ""}. Kéo môn từ “Môn còn phải học” vào từng học kỳ, rồi xếp buổi học vào lịch tuần.</p></div>
      <div className="rm-actions">
        <span className={`rm-save rm-save-${saveState}`} role="status" aria-live="polite">{statusText}</span>
        <button className="sw-outline" disabled={busy} onClick={() => (hasCourses ? setConfirm("suggest") : void suggest())}><Icon name="spark" />Xếp theo kế hoạch đào tạo</button>
        <a className={`sw-outline${!version.current || saveState !== "saved" && saveState !== "idle" ? " is-disabled" : ""}`} href="/api/student/study-plan/export"
          aria-disabled={!version.current || (saveState !== "saved" && saveState !== "idle")} onClick={(event) => { if (!version.current || (saveState !== "saved" && saveState !== "idle")) event.preventDefault(); }}>
          <Icon name="download" />Xuất Excel</a>
        <button className="sr-secondary sr-danger" disabled={busy || !hasCourses} onClick={() => setConfirm("delete")}><Icon name="trash" />Xóa lộ trình</button>
      </div>
      {confirm === "suggest" && <Confirm title="Xếp lại theo kế hoạch đào tạo?" action="Xếp lại" busy={busy} onConfirm={() => void suggest()} onClose={() => setConfirm(null)}>
        Các môn còn thiếu sẽ được xếp lại theo học kỳ chuẩn của chương trình đào tạo, có tính môn tiên quyết và giới hạn tín chỉ. Môn đang ở đúng học kỳ được giữ nguyên lịch tuần.</Confirm>}
      {confirm === "delete" && <Confirm title="Xóa lộ trình học tập?" action="Xóa lộ trình" busy={busy} onConfirm={() => void remove()} onClose={() => setConfirm(null)}>
        Mọi môn đã xếp và lịch tuần sẽ bị xóa. Bảng điểm và hồ sơ của bạn không thay đổi.</Confirm>}
      {error && <div className="sr-error" role="alert">{error}{saveState === "error" && <button onClick={() => void load()}>Tải lại</button>}</div>}
      {!context.hasTranscript && <p className="rm-note" role="note">Bạn chưa import bảng điểm nên hệ thống chưa biết môn nào đã học. <a href="#profile">Import bảng điểm</a> để lộ trình chỉ còn các môn cần học.</p>}
      {!context.specialty && <p className="rm-note" role="note">Bạn chưa chọn chuyên ngành: môn của mọi chuyên ngành đều hiện, và nút xếp theo kế hoạch chỉ xếp môn chung. <a href="#profile">Chọn chuyên ngành</a> trong hồ sơ.</p>}
      {context.limits && <p className="sw-muted rm-limit-note">Mỗi học kỳ nên từ {context.limits.min} đến {context.limits.max} tín chỉ: 2/3 đến 3/2 mức trung bình {context.limits.average.toLocaleString("vi-VN")} TC/học kỳ của chương trình (Thông tư 08/2021). GDTC, GDQP không tính.</p>}
    </section>

    <div className="rm-board">
      <aside className={`sw-panel rm-pool${over === "pool" ? " is-over" : ""}`} aria-label="Môn còn phải học" onDragOver={allowDrop("pool")} onDragLeave={() => setOver(null)} onDrop={dropOnTerm(null)}>
        <h3>Môn còn phải học</h3>
        <label className="rm-search"><span className="rm-visually-hidden">Tìm môn</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã hoặc tên môn…" /></label>
        {sections.every((section) => !section.courses.length) && <p className="sw-muted">Bạn đã xếp hoặc đã học hết các môn của chương trình.</p>}
        {sections.map((section) => { const courses = section.courses.filter(matches); const folded = !query && (section.id === "other" || section.id === "other-ctdt" || Boolean(section.note?.startsWith("Đã đủ")));
          return courses.length ? <details key={`${section.id}-${folded}`} className={`rm-pool-group${section.id === "other" ? " is-other" : ""}`} open={!folded}>
            <summary><span>{section.title}</span>{section.note && <em>{section.note}</em>}<small>{courses.length} môn</small></summary>
            {courses.map((course) => <CourseCard key={course.code} course={course} names={names} terms={terms} term={null} onMove={(to) => move(course.code, to)} onGrab={grabCourse(course.code)} />)}
          </details> : null; })}
      </aside>

      <div className="rm-terms" role="list" aria-label="Các học kỳ">
        {plan.terms.map((term, index) => {
          const load = loads.get(term.code)!;
          const running = runningIn(context, term.code).filter((course) => !term.courses.some((item) => item.code === course.code));
          const past = termIndex(term.code) < termIndex(context.currentTerm);
          const removable = !term.courses.length && !running.length && index === plan.terms.length - 1 && term.code !== context.currentTerm && plan.terms.length > 1;
          return <section key={term.code} role="listitem" className={`rm-term${over === term.code ? " is-over" : ""}${past ? " is-past" : ""}`} aria-label={termLabel(term.code)}
            onDragOver={allowDrop(term.code)} onDragLeave={() => setOver(null)} onDrop={dropOnTerm(term.code)}>
            <header><div><h3>{termLabel(term.code)}</h3>{term.code === context.currentTerm && <span className="sw-tag">Học kỳ hiện tại</span>}{past && <span className="sw-tag">Đã qua</span>}</div>
              <span className={`rm-load rm-load-${load.status}`}>{load.credits}{context.limits ? `/${context.limits.max}` : ""} TC</span></header>
            {load.status === "over" && <p className="rm-term-warn">Vượt {context.limits!.max} TC tối đa của một học kỳ.</p>}
            {load.status === "under" && <p className="rm-term-warn rm-term-low">Dưới {context.limits!.min} TC tối thiểu của học kỳ chính.</p>}
            {past && term.courses.length > 0 && <p className="rm-term-warn">Học kỳ này đã qua: hãy chuyển các môn sang học kỳ sau.</p>}
            {running.map((course) => <CourseCard key={course.code} course={course} names={names} terms={terms} term={term.code} locked />)}
            {term.courses.map((item) => { const course = byCode.get(item.code.toUpperCase()); return course
              ? <CourseCard key={item.code} course={course} issue={issues.get(course.code)} names={names} terms={terms} term={term.code} onMove={(to) => move(course.code, to)} onGrab={grabCourse(course.code)} />
              : <article key={item.code} className="rm-card has-issue"><strong>{item.code}</strong><p className="rm-card-issue">Môn không còn trong chương trình đào tạo.</p>
                <button className="sr-secondary" onClick={() => move(item.code, null)}>Bỏ khỏi lộ trình</button></article>; })}
            {!term.courses.length && !running.length && <p className="rm-drop-hint">Kéo môn vào đây</p>}
            {load.conditional > 0 && <p className="sw-muted rm-term-extra">+ {load.conditional} TC GDTC/GDQP</p>}
            {removable && <button className="rm-link" onClick={() => removeTerm(term.code)}>Bỏ học kỳ này</button>}
          </section>;
        })}
        {terms.length < MAX_TERMS && <div role="listitem" className="rm-add-term-item"><button className="rm-add-term" onClick={addTerm}><Icon name="plus" />Thêm học kỳ</button></div>}
      </div>

      <aside className="sw-panel rm-progress" aria-label="Tiến độ tốt nghiệp">
        <h3>Tiến độ</h3>
        <div className="rm-meter" aria-hidden="true"><span className="rm-meter-done" style={{ width: percent(progress.done) }} /><span className="rm-meter-running" style={{ width: percent(progress.running) }} /><span className="rm-meter-planned" style={{ width: percent(progress.planned) }} /></div>
        <dl className="rm-figures">
          <div><dt><i className="rm-dot rm-dot-done" />Đã đạt</dt><dd>{progress.done} TC</dd></div>
          <div><dt><i className="rm-dot rm-dot-running" />Đang học</dt><dd>{progress.running} TC</dd></div>
          <div><dt><i className="rm-dot rm-dot-planned" />Đã xếp</dt><dd>{progress.planned} TC</dd></div>
          {progress.total !== null && <div className="rm-total"><dt>Chương trình</dt><dd>{progress.total} TC</dd></div>}
        </dl>
        {progress.total !== null && progress.done + progress.running + progress.planned < progress.total && <p className="rm-missing">Còn thiếu {progress.total - progress.done - progress.running - progress.planned} TC so với chương trình: hãy xếp thêm môn, nhất là môn tự chọn.</p>}
        {projection ? <div className="rm-graduation">
          <h4>Xét tốt nghiệp</h4>
          <p className="sw-muted">{projection.standardName}</p>
          {projection.withPlan === "pass"
            ? <p className="rm-verdict rm-verdict-pass"><Icon name="check" />Học đạt hết lộ trình này là đủ các nhóm học phần để tốt nghiệp.</p>
            : <><p className="rm-verdict">Học hết lộ trình này vẫn còn thiếu:</p><ul>{projection.openGroups.map((group) => <li key={group.label}>{group.label}: {group.withPlan ?? 0}/{group.required ?? "?"} {group.unit}</li>)}</ul></>}
          <p className="sw-muted">Chưa tính điểm trung bình tích lũy và chứng chỉ. Cập nhật sau mỗi lần lưu.</p>
        </div> : <p className="sw-muted">{context.hasTranscript ? "Chưa có tiêu chuẩn xét tốt nghiệp cho khóa và chuyên ngành của bạn, nên chỉ hiện số tín chỉ." : "Import bảng điểm để xem tiến độ xét tốt nghiệp."}</p>}
        {(issues.size > 0 || overTerms > 0) && <div className="rm-warnings"><h4>Cần xem lại</h4><ul>
          {issues.size > 0 && <li>{issues.size} môn chưa đủ điều kiện tiên quyết hoặc học trước.</li>}
          {overTerms > 0 && <li>{overTerms} học kỳ vượt giới hạn tín chỉ.</li>}</ul></div>}
      </aside>
    </div>

    <section className="sw-panel rm-week" aria-labelledby="rm-week-title">
      <div className="sw-section-heading"><div><h2 id="rm-week-title">Lịch tuần</h2><p className="sw-muted">Kéo từng buổi (LT: lý thuyết, TH: thực hành) vào ô. Trên điện thoại, chạm vào buổi rồi chạm vào ô.</p></div></div>
      {!planned.length ? <p className="sw-muted">Hãy xếp môn vào học kỳ trước, rồi xếp lịch tuần ở đây.</p> : <>
        <div className="rm-week-tabs" role="tablist" aria-label="Học kỳ">{planned.map((term) => <button key={term.code} role="tab" aria-selected={term.code === shownWeek} onClick={() => { setWeek(term.code); setPicked(null); }}>{termLabel(term.code)}</button>)}</div>
        {weekTerm && <div className="rm-week-layout">
          <div className="rm-unplaced" onDragOver={allowDrop("unplaced")} onDragLeave={() => setOver(null)}
            onDrop={(event) => { event.preventDefault(); setOver(null); const grab = readGrab(event); if (grab?.kind === "session" && grab.term === weekTerm.code) edit(placeSession(plan, weekTerm.code, grab.code, grab.index, null)); }}>
            <h3>Chưa xếp lịch</h3>
            {weekTerm.courses.map((item) => { const course = byCode.get(item.code.toUpperCase()); const open = item.sessions.map((session, index) => ({ session, index })).filter(({ session }) => session.day === null);
              return <div key={item.code} className="rm-unplaced-course"><p><strong>{course?.name ?? item.code}</strong><span>{item.sessions.length ? `${item.sessions.length - open.length}/${item.sessions.length} buổi đã xếp` : "Không có buổi học trên lớp"}</span></p>
                <div className="rm-chips">{open.map(({ session, index }) => { const grab = { kind: "session" as const, term: weekTerm.code, code: item.code, index };
                  const active = picked?.kind === "session" && picked.code === item.code && picked.index === index && picked.term === weekTerm.code;
                  return <span key={index} className={`rm-chip rm-color-${colorOf(item.code)}${active ? " is-picked" : ""}`} draggable onDragStart={grabSession(grab)}>
                    <button className="rm-chip-main" aria-pressed={active} onClick={() => setPicked(active ? null : grab)}>{session.kind}</button>
                    <button className="rm-chip-x" aria-label={`Bỏ buổi ${session.kind} của ${course?.name ?? item.code}`} onClick={() => edit(changeSessions(plan, weekTerm.code, item.code, { remove: index }))}><Icon name="close" /></button></span>; })}
                  {item.sessions.length < MAX_SESSIONS && <button className="rm-chip-add" aria-label={`Thêm buổi cho ${course?.name ?? item.code}`} onClick={() => edit(changeSessions(plan, weekTerm.code, item.code, { add: true }))}><Icon name="plus" />Buổi</button>}</div></div>; })}
            {picked?.kind === "session" && <p className="rm-pick-hint" role="status">Chọn một ô trong lịch để đặt buổi này.</p>}
          </div>
          <div className="rm-grid-scroll" tabIndex={0} role="region" aria-label={`Lịch tuần ${termLabel(weekTerm.code)}`}>
            <table className="rm-grid"><thead><tr><th scope="col">Ca</th>{DAYS.map((day) => <th key={day} scope="col">{dayLabel(day)}</th>)}</tr></thead>
              <tbody>{BLOCKS.map((block) => <tr key={block.block}><th scope="row"><strong>Ca {block.block}</strong><span>Tiết {block.periods}</span><span>{block.time}</span></th>
                {DAYS.map((day) => { const here = weekTerm.courses.flatMap((item) => item.sessions.map((session, index) => ({ item, session, index })))
                  .filter(({ session }) => session.day === day && session.block === block.block);
                  const key = `${day}-${block.block}`; const clash = here.length > 1;
                  return <td key={day} className={`${over === key ? "is-over" : ""}${clash ? " is-clash" : ""}${picked?.kind === "session" ? " is-target" : ""}`}
                    onDragOver={allowDrop(key)} onDragLeave={() => setOver(null)} onDrop={dropOnSlot(day, block.block)} onClick={() => clickSlot(day, block.block)}
                    tabIndex={picked?.kind === "session" ? 0 : -1} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); clickSlot(day, block.block); } }}
                    aria-label={`${dayLabel(day)}, ca ${block.block}${here.length ? `: ${here.map(({ item, session }) => `${names.get(item.code.toUpperCase()) ?? item.code} ${session.kind}`).join(", ")}` : ""}`}>
                    {here.map(({ item, session, index }) => <span key={`${item.code}-${index}`} className={`rm-slot rm-color-${colorOf(item.code)}${clashing.has(`${item.code}#${index}`) ? " is-clash" : ""}`}
                      draggable onDragStart={grabSession({ kind: "session", term: weekTerm.code, code: item.code, index })} onClick={(event) => event.stopPropagation()}>
                      <strong>{shortName(names.get(item.code.toUpperCase()) ?? item.code)}</strong><span>{session.kind} · {item.code}</span>
                      <button aria-label={`Bỏ ${session.kind} của ${names.get(item.code.toUpperCase()) ?? item.code} khỏi ô`} onClick={() => edit(placeSession(plan, weekTerm.code, item.code, index, null))}><Icon name="close" /></button></span>)}
                    {clash && <em className="rm-clash-note">Trùng lịch</em>}
                  </td>; })}</tr>)}</tbody></table></div>
        </div>}
      </>}
    </section>
  </div>;
}
