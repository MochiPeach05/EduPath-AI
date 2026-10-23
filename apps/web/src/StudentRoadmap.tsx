import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Icon } from "./student-icons";
import {
  BLOCKS, DAYS, MAX_SESSIONS, MAX_TERMS, OFFERING_LABELS, PERIODS, addToSlot, changeSessions, clashes, conditionIssues, creditProgress, dayLabel, defaultTerms, issuesIfIn,
  mergeSuggestion, moveCourse, nextTerm, offering, placeSession, poolSections, runningIn, termIndex, termLabel, termLoad, type Offering,
  type ConditionIssue, type StudyPlanContext, type StudyPlanCourse, type StudyPlanData, type StudyPlanProjection,
} from "./study-plan-checks";
import "./student-roadmap.css";

// "Lộ trình học tập" (STU-PLAN-01–07). Since 2026-10-24 the weekly timetable, laid out like the school's schedule page,
// is the main view (user): the student picks courses for a term and places their sessions in the same grid (Thứ 2 …
// Chủ nhật × periods 1–15, a session spans a block of 3). Below: every term at a glance and the progress to graduation.

type Saved = { version: string; data: StudyPlanData; updatedAt: string };
type Loaded = { context: StudyPlanContext; plan: Saved | null; projection: StudyPlanProjection | null };
/** What is being dragged, or picked to place by a tap (touch and keyboard). */
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

/** The saved plan, with the terms from today on (empty ones) the page always shows. */
function withTerms(context: StudyPlanContext, data: StudyPlanData | null): StudyPlanData {
  const terms = new Map((data?.terms ?? []).map((term) => [term.code, term]));
  for (const code of defaultTerms(context)) if (!terms.has(code) && terms.size < MAX_TERMS) terms.set(code, { code, courses: [] });
  return { schemaVersion: 1, terms: [...terms.values()].sort((a, b) => termIndex(a.code) - termIndex(b.code)) };
}

const PALETTE = 8;
const colorOf = (code: string) => [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE;
const kindLabel = (course: StudyPlanCourse) => (course.kind === "mandatory" ? "Bắt buộc" : course.group ? `Tự chọn ${course.group}` : "Tự chọn");
const sessionLabel = (kind: string) => (kind === "TH" ? "Thực hành" : "Lý thuyết");
const readGrab = (event: DragEvent): Grab | null => {
  try { return JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as Grab; } catch { return null; }
};
const startDrag = (grab: Grab) => (event: DragEvent) => {
  event.stopPropagation();
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(grab));
  event.dataTransfer.effectAllowed = "move";
};

function IssueText({ issue, names }: { issue: ConditionIssue; names: Map<string, string> }) {
  const list = (codes: string[]) => codes.map((code) => names.get(code) ?? code).join(", ");
  return <>{issue.prerequisites.length > 0 && <>Cần qua trước: {list(issue.prerequisites)}. </>}{issue.prior.length > 0 && <>Cần học trước: {list(issue.prior)}.</>}</>;
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
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<Grab | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"suggest" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyPlanned, setOnlyPlanned] = useState(false);
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
  // The term the timetable shows: the chosen one, else the first planned term from today, else the next term.
  const term = selected && terms.includes(selected) ? selected
    : (context && (plan.terms.find((item) => item.courses.length && termIndex(item.code) >= termIndex(context.currentTerm))?.code
      ?? terms.find((code) => termIndex(code) > termIndex(context.currentTerm)))) ?? terms[0] ?? null;
  const termData = plan.terms.find((item) => item.code === term);
  const clashing = useMemo(() => clashes(termData), [termData]);

  if (loadError) return <section className="sw-panel"><div className="sr-error" role="alert">{loadError}<button onClick={() => void load()}>Thử lại</button></div></section>;
  if (!loaded || !context) return <section className="sw-panel" aria-busy="true"><p role="status">Đang tải lộ trình học tập…</p></section>;
  if (!context.curriculum) return <section className="sw-panel sw-empty"><h2>Chưa xếp được lộ trình</h2><p>{context.cohortCode
    ? `Chưa có chương trình đào tạo của khóa ${context.cohortCode} trong hệ thống. Lộ trình sẽ mở khi khoa cập nhật chương trình đào tạo.`
    : "Hệ thống chưa biết khóa học của bạn. Hãy kiểm tra Hồ sơ và bảng điểm."}</p></section>;

  const move = (code: string, to: string | null) => { edit(moveCourse(plan, context, code, to)); setPicked(null); };
  const allowDrop = (key: string) => (event: DragEvent) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); setOver(key); } };
  /** A course or a session lands on a day × block of the shown term. */
  const putOnSlot = (grab: Grab | null, day: number, block: number) => {
    if (!grab || !term) return;
    if (grab.kind === "course") {
      const next = addToSlot(plan, context, term, grab.code, { day, block });
      if (!byCode.get(grab.code.toUpperCase())?.sessions.length && !next.terms.find((item) => item.code === term)?.courses.find((item) => item.code === grab.code.toUpperCase())?.sessions.length)
        setNotice(`${names.get(grab.code.toUpperCase()) ?? grab.code} không có buổi học trên lớp (đồ án, thực tập): đã thêm vào ${termLabel(term)} mà không xếp lịch.`);
      edit(next);
    } else if (grab.term === term) edit(placeSession(plan, term, grab.code, grab.index, { day, block }));
    setPicked(null);
  };
  const dropOnSlot = (day: number, block: number) => (event: DragEvent) => { event.preventDefault(); setOver(null); putOnSlot(readGrab(event), day, block); };
  const dropOnTerm = (to: string | null) => (event: DragEvent) => {
    event.preventDefault(); setOver(null);
    const grab = readGrab(event);
    if (grab?.kind === "course") move(grab.code, to);
    else if (grab?.kind === "session" && to === term) edit(placeSession(plan, grab.term, grab.code, grab.index, null));
  };
  const addTerm = () => { const last = terms.at(-1) ?? context.currentTerm; if (terms.length < MAX_TERMS) { const code = nextTerm(last); edit({ ...plan, terms: [...plan.terms, { code, courses: [] }] }); setSelected(code); } };
  const removeTerm = (code: string) => { edit({ ...plan, terms: plan.terms.filter((item) => item.code !== code) }); if (selected === code) setSelected(null); };

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
      dirty.current = false; setConfirm(null); setSelected(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Chưa xóa được lộ trình."); }
    finally { setBusy(false); }
  };

  const sections = poolSections(context, plan);
  const query = search.trim().toLocaleLowerCase("vi");
  const offerIn = (course: StudyPlanCourse, at: string | null) => (at ? offering(context, course, at) : "unknown");
  const opens = (kind: Offering) => kind === "plan" || kind === "likely";
  const matches = (course: StudyPlanCourse) => (!query || `${course.code} ${course.name}`.toLocaleLowerCase("vi").includes(query)) && (!onlyPlanned || opens(offerIn(course, term)));
  // Courses with classes in the shown term first (the school opens classes mostly by the training plans).
  const rank = (course: StudyPlanCourse) => ({ plan: 0, likely: 1, unknown: 2, outside: 3 })[offerIn(course, term)];
  const offerTag = (course: StudyPlanCourse, at: string) => { const kind = offerIn(course, at); const label = OFFERING_LABELS[kind];
    return label ? <span className={`rm-offer rm-offer-${kind}`} title={kind === "outside" ? "Trường mở lớp chủ yếu theo kế hoạch đào tạo; môn ngoài kế hoạch ít lớp, có thể không mở." : undefined}>{label}</span> : null; };
  const progress = creditProgress(context, plan);
  const loads = new Map(plan.terms.map((item) => [item.code, termLoad(context, plan, item.code)]));
  const load_ = term ? loads.get(term)! : null;
  const overTerms = [...loads.values()].filter((item) => item.status === "over").length;
  const hasCourses = plan.terms.some((item) => item.courses.length);
  const running = term ? runningIn(context, term).filter((course) => !termData?.courses.some((item) => item.code === course.code)) : [];
  const percent = (value: number) => (progress.total ? `${Math.min(100, (value / progress.total) * 100)}%` : "0%");
  const exportReady = Boolean(version.current) && (saveState === "saved" || saveState === "idle");
  const statusText = saveState === "saving" ? "Đang lưu…" : saveState === "dirty" ? "Chưa lưu…" : saveState === "error" ? "Chưa lưu được"
    : savedAt ? `Đã lưu lúc ${new Date(savedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : "Chưa lưu";
  const placedText = (day: number | null, block: number | null) => (day === null || block === null ? null : `${dayLabel(day)}, tiết ${BLOCKS[block - 1]!.periods}`);
  const pickedLabel = picked?.kind === "course" ? names.get(picked.code.toUpperCase()) ?? picked.code
    : picked?.kind === "session" ? `${names.get(picked.code.toUpperCase()) ?? picked.code} (${termData?.courses.find((item) => item.code === picked.code)?.sessions[picked.index]?.kind ?? ""})` : null;

  return <div className="rm-page">
    <section className="sw-panel rm-toolbar">
      <div><h2>Lộ trình của bạn</h2><p className="sw-muted">{context.curriculum.name}{context.specialtyLabel ? ` · ${context.specialtyLabel}` : ""}. Chọn học kỳ, kéo môn từ “Chọn môn” thả vào ô của lịch: môn được thêm vào học kỳ và xếp luôn buổi học.</p></div>
      <div className="rm-actions">
        <span className={`rm-save rm-save-${saveState}`} role="status" aria-live="polite">{statusText}</span>
        <button className="sw-outline" disabled={busy} onClick={() => (hasCourses ? setConfirm("suggest") : void suggest())}><Icon name="spark" />Xếp theo kế hoạch đào tạo</button>
        <a className={`sw-outline${exportReady ? "" : " is-disabled"}`} href="/api/student/study-plan/export" aria-disabled={!exportReady} onClick={(event) => { if (!exportReady) event.preventDefault(); }}><Icon name="download" />Xuất Excel</a>
        <button className="sr-secondary sr-danger" disabled={busy || !hasCourses} onClick={() => setConfirm("delete")}><Icon name="trash" />Xóa lộ trình</button>
      </div>
      {confirm === "suggest" && <Confirm title="Xếp lại theo kế hoạch đào tạo?" action="Xếp lại" busy={busy} onConfirm={() => void suggest()} onClose={() => setConfirm(null)}>
        Các môn còn thiếu sẽ được xếp lại theo học kỳ chuẩn của chương trình đào tạo, có tính môn tiên quyết và giới hạn tín chỉ. Môn đang ở đúng học kỳ được giữ nguyên lịch.</Confirm>}
      {confirm === "delete" && <Confirm title="Xóa lộ trình học tập?" action="Xóa lộ trình" busy={busy} onConfirm={() => void remove()} onClose={() => setConfirm(null)}>
        Mọi môn đã chọn và lịch học sẽ bị xóa. Bảng điểm và hồ sơ của bạn không thay đổi.</Confirm>}
      {error && <div className="sr-error" role="alert">{error}{saveState === "error" && <button onClick={() => void load()}>Tải lại</button>}</div>}
      {!context.hasTranscript && <p className="rm-note" role="note">Bạn chưa import bảng điểm nên hệ thống chưa biết môn nào đã học. <a href="#profile">Import bảng điểm</a> để chỉ còn các môn cần học.</p>}
      {!context.specialty && <p className="rm-note" role="note">Bạn chưa chọn chuyên ngành: môn của mọi chuyên ngành đều hiện, và nút xếp theo kế hoạch chỉ xếp môn chung. <a href="#profile">Chọn chuyên ngành</a> trong hồ sơ.</p>}
    </section>

    <section className="sw-panel rm-planner" aria-label="Chọn môn và xếp lịch học">
      <div className="rm-term-tabs" role="tablist" aria-label="Học kỳ">
        {plan.terms.map((item) => { const load = loads.get(item.code)!; return <button key={item.code} role="tab" aria-selected={item.code === term} className={`rm-term-tab rm-tab-${load.status}`}
          onClick={() => { setSelected(item.code); setPicked(null); }} onDragOver={allowDrop(`tab-${item.code}`)} onDragLeave={() => setOver(null)} onDrop={dropOnTerm(item.code)}>
          <strong>{termLabel(item.code)}</strong><span>{item.code === context.currentTerm ? "Hiện tại · " : termIndex(item.code) < termIndex(context.currentTerm) ? "Đã qua · " : ""}{load.credits}{context.limits ? `/${context.limits.max}` : ""} TC</span></button>; })}
        {terms.length < MAX_TERMS && <button className="rm-term-tab rm-term-add" onClick={addTerm}><Icon name="plus" />Thêm học kỳ</button>}
      </div>

      {term && termData && load_ && <div className="rm-planner-body">
        <aside className="rm-side" aria-label={`Môn của ${termLabel(term)}`}>
          <section className={`rm-selected${over === "selected" ? " is-over" : ""}`} onDragOver={allowDrop("selected")} onDragLeave={() => setOver(null)} onDrop={dropOnTerm(term)}>
            <h3>Môn đã chọn · {termLabel(term)}</h3>
            <p className={`rm-term-load rm-load-${load_.status}`}>{load_.credits}{context.limits ? ` / tối đa ${context.limits.max}` : ""} tín chỉ{load_.conditional ? ` (+${load_.conditional} TC GDTC/GDQP)` : ""}
              {load_.status === "over" && " · vượt giới hạn"}{load_.status === "under" && ` · dưới ${context.limits!.min} TC tối thiểu`}</p>
            {context.limits && <p className="sw-muted rm-limit-note">Mỗi học kỳ nên từ {context.limits.min} đến {context.limits.max} TC (2/3 đến 3/2 mức trung bình {context.limits.average.toLocaleString("vi-VN")} TC/học kỳ của chương trình, Thông tư 08/2021).</p>}
            {termIndex(term) < termIndex(context.currentTerm) && termData.courses.length > 0 && <p className="rm-term-warn">Học kỳ này đã qua: hãy chuyển các môn sang học kỳ sau.</p>}
            {running.map((course) => <div key={course.code} className="rm-sel is-running"><div className="rm-sel-head"><strong>{course.name}</strong><span>{course.credits} TC</span></div>
              <p className="rm-sel-meta">{course.code} · Đang học (theo bảng điểm)</p>
              <button className="rm-mini" onClick={() => move(course.code, term)}><Icon name="plus" />Xếp lịch cho môn này</button></div>)}
            {!termData.courses.length && !running.length && <p className="rm-drop-hint">Kéo môn từ “Chọn môn” vào lịch hoặc vào đây.</p>}
            {termData.courses.map((item) => { const course = byCode.get(item.code.toUpperCase()); const issue = issues.get(item.code.toUpperCase());
              return <div key={item.code} className={`rm-sel${issue ? " has-issue" : ""}`} draggable onDragStart={startDrag({ kind: "course", code: item.code })}>
                <div className="rm-sel-head"><strong>{course?.name ?? item.code}</strong><span>{course?.credits ?? "?"} TC</span>
                  <button className="rm-x" aria-label={`Bỏ ${course?.name ?? item.code} khỏi ${termLabel(term)}`} onClick={() => move(item.code, null)}><Icon name="close" /></button></div>
                <p className="rm-sel-meta">{item.code}{course ? ` · ${kindLabel(course)}` : " · không còn trong CTĐT"}{course?.state === "failed" ? " · Học lại" : ""}{course?.onlyInStandard ? " · Theo tiêu chuẩn TN" : ""}</p>
                {course && offerIn(course, term) === "outside" && offerTag(course, term)}
                {issue && <p className="rm-card-issue" role="note"><IssueText issue={issue} names={names} /></p>}
                <div className="rm-chips">
                  {item.sessions.map((session, index) => { const where = placedText(session.day, session.block); const grab = { kind: "session" as const, term, code: item.code, index };
                    const active = picked?.kind === "session" && picked.code === item.code && picked.index === index;
                    return <span key={index} className={`rm-chip rm-color-${colorOf(item.code)}${where ? " is-placed" : ""}${active ? " is-picked" : ""}${clashing.has(`${item.code}#${index}`) ? " is-clash" : ""}`} draggable onDragStart={startDrag(grab)}>
                      <button className="rm-chip-main" aria-pressed={active} title={where ? "Kéo sang ô khác để đổi lịch" : "Kéo vào lịch, hoặc chạm rồi chọn ô"} onClick={() => setPicked(active ? null : grab)}>{session.kind}{where ? ` · ${where}` : " · chưa xếp"}</button>
                      <button className="rm-chip-x" aria-label={`Bỏ buổi ${session.kind} của ${course?.name ?? item.code}`} onClick={() => edit(changeSessions(plan, term, item.code, { remove: index }))}><Icon name="close" /></button></span>; })}
                  {item.sessions.length < MAX_SESSIONS && <button className="rm-chip-add" aria-label={`Thêm buổi cho ${course?.name ?? item.code}`} onClick={() => edit(changeSessions(plan, term, item.code, { add: true }))}><Icon name="plus" />Buổi</button>}
                </div>
                {!item.sessions.length && <p className="sw-muted rm-sel-meta">Không có buổi học trên lớp.</p>}
              </div>; })}
          </section>

          <section className={`rm-pool${over === "pool" ? " is-over" : ""}`} aria-label="Chọn môn" onDragOver={allowDrop("pool")} onDragLeave={() => setOver(null)} onDrop={dropOnTerm(null)}>
            <h3>Chọn môn</h3>
            <label className="rm-search"><span className="rm-visually-hidden">Tìm môn</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã hoặc tên môn…" /></label>
            {context.offeringUntil && <label className="rm-only-plan"><input type="checkbox" checked={onlyPlanned} onChange={(event) => setOnlyPlanned(event.target.checked)} />Chỉ môn có lớp theo kế hoạch {termLabel(term).split(" · ")[0]}</label>}
            {sections.every((section) => !section.courses.length) && <p className="sw-muted">Bạn đã chọn hoặc đã học hết các môn của chương trình.</p>}
            {sections.map((section) => { const courses = section.courses.filter(matches).sort((a, b) => rank(a) - rank(b)); const folded = !query && (section.id === "other" || section.id === "other-ctdt" || Boolean(section.note?.startsWith("Đã đủ")));
              return courses.length ? <details key={`${section.id}-${folded}`} className={`rm-pool-group${section.id === "other" ? " is-other" : ""}`} open={!folded}>
                <summary><span>{section.title}</span>{section.note && <em>{section.note}</em>}<small>{courses.length} môn</small></summary>
                {courses.map((course) => { const hint = issuesIfIn(context, plan, course.code, term); const active = picked?.kind === "course" && picked.code === course.code;
                  return <div key={course.code} className={`rm-pick${hint ? " has-issue" : ""}${active ? " is-picked" : ""}`} draggable onDragStart={startDrag({ kind: "course", code: course.code })}>
                    <div className="rm-sel-head"><strong>{course.name}</strong><span>{course.credits} TC</span></div>
                    <p className="rm-sel-meta">{course.code} · {kindLabel(course)}{course.sessions.length ? ` · ${course.sessions.join(" + ")}` : " · không xếp lịch"}{course.state === "failed" ? " · Học lại" : ""}{course.onlyInStandard ? " · Theo tiêu chuẩn TN" : ""}</p>
                    {offerTag(course, term)}
                    {hint && <p className="rm-card-issue"><IssueText issue={hint} names={names} /></p>}
                    <div className="rm-pick-actions">
                      <button className="rm-mini" onClick={() => move(course.code, term)}><Icon name="plus" />Thêm vào {termLabel(term).split(" · ")[0]}</button>
                      {course.sessions.length > 0 && <button className="rm-mini" aria-pressed={active} onClick={() => setPicked(active ? null : { kind: "course", code: course.code })}>{active ? "Bỏ chọn" : "Chọn rồi chạm ô"}</button>}
                    </div>
                  </div>; })}
              </details> : null; })}
          </section>
        </aside>

        <div className="rm-main">
          <div className="rm-stats" aria-label="Tiến độ">
            <div className="rm-meter" aria-hidden="true"><span className="rm-meter-done" style={{ width: percent(progress.done) }} /><span className="rm-meter-running" style={{ width: percent(progress.running) }} /><span className="rm-meter-planned" style={{ width: percent(progress.planned) }} /></div>
            <p><i className="rm-dot rm-dot-done" />Đã đạt <strong>{progress.done}</strong> · <i className="rm-dot rm-dot-running" />Đang học <strong>{progress.running}</strong> · <i className="rm-dot rm-dot-planned" />Đã xếp <strong>{progress.planned}</strong>{progress.total !== null ? <> / {progress.total} TC chương trình</> : " TC"}
              {projection && <span className={`rm-stat-verdict${projection.withPlan === "pass" ? " is-pass" : ""}`}>{projection.withPlan === "pass" ? " · Học đạt hết lộ trình là đủ các nhóm học phần" : ` · Còn thiếu ${projection.openGroups.length} nhóm học phần`}</span>}</p>
          </div>
          {picked && <p className="rm-pick-hint" role="status">Chạm vào một ô trong lịch để đặt {pickedLabel}. <button className="rm-link" onClick={() => setPicked(null)}>Bỏ chọn</button></p>}
          {notice && <p className="rm-note" role="status">{notice} <button className="rm-link" onClick={() => setNotice("")}>Đóng</button></p>}
          <div className="rm-grid-scroll" tabIndex={0} role="region" aria-label={`Lịch học ${termLabel(term)}`}>
            <table className="rm-timetable">
              <caption>Lịch học dự kiến · {termLabel(term)} (lặp lại mỗi tuần của học kỳ)</caption>
              <thead><tr><th scope="col" className="rm-tt-period">Tiết</th>{DAYS.map((day) => <th key={day} scope="col">{dayLabel(day)}</th>)}<th scope="col" className="rm-tt-period rm-tt-right">Tiết</th></tr></thead>
              <tbody>{PERIODS.map((row) => <tr key={row.period} className={row.period % 3 === 0 ? "rm-tt-block-end" : undefined}>
                <th scope="row" className="rm-tt-period">{row.period}<small>{row.start}</small></th>
                {(row.period - 1) % 3 === 0 && DAYS.map((day) => { const block = row.block;
                  const here = termData.courses.flatMap((item) => item.sessions.map((session, index) => ({ item, session, index }))).filter(({ session }) => session.day === day && session.block === block);
                  const key = `${day}-${block}`; const clash = here.length > 1;
                  return <td key={day} rowSpan={3} className={`rm-tt-cell${over === key ? " is-over" : ""}${clash ? " is-clash" : ""}${picked ? " is-target" : ""}`}
                    onDragOver={allowDrop(key)} onDragLeave={() => setOver(null)} onDrop={dropOnSlot(day, block)} onClick={() => putOnSlot(picked, day, block)}
                    tabIndex={picked ? 0 : -1} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); putOnSlot(picked, day, block); } }}
                    aria-label={`${dayLabel(day)}, tiết ${BLOCKS[block - 1]!.periods}${here.length ? `: ${here.map(({ item, session }) => `${names.get(item.code.toUpperCase()) ?? item.code} ${session.kind}`).join(", ")}` : ", trống"}`}>
                    {here.map(({ item, session, index }) => { const issue = issues.get(item.code.toUpperCase());
                      return <div key={`${item.code}-${index}`} className={`rm-tt-session rm-tint-${colorOf(item.code)}${clashing.has(`${item.code}#${index}`) ? " is-clash" : ""}`}
                        draggable onDragStart={startDrag({ kind: "session", term, code: item.code, index })} onClick={(event) => event.stopPropagation()}>
                        <span>-Môn: {names.get(item.code.toUpperCase()) ?? item.code} ({item.code})</span>
                        <span>-Loại: {sessionLabel(session.kind)}</span>
                        <span>-Tiết: {BLOCKS[block - 1]!.periods}</span>
                        {issue && <span className="rm-tt-issue">⚠ <IssueText issue={issue} names={names} /></span>}
                        <button aria-label={`Bỏ ${session.kind} của ${names.get(item.code.toUpperCase()) ?? item.code} khỏi lịch`} onClick={() => edit(placeSession(plan, term, item.code, index, null))}><Icon name="close" /></button>
                      </div>; })}
                    {clash && <em className="rm-clash-note">Trùng lịch</em>}
                  </td>; })}
                <th scope="row" className="rm-tt-period rm-tt-right">{row.period}</th>
              </tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>}
    </section>

    <section className="sw-panel rm-overview" aria-labelledby="rm-overview-title">
      <div className="rm-overview-head"><h2 id="rm-overview-title">Tổng quan lộ trình</h2><p className="sw-muted">Mỗi học kỳ và các môn đã chọn. Kéo môn sang học kỳ khác để đổi, bấm tên học kỳ để mở lịch.</p></div>
      <div className="rm-overview-body">
        <div className="rm-terms" role="list" aria-label="Các học kỳ">
          {plan.terms.map((item, index) => { const load = loads.get(item.code)!; const runningHere = runningIn(context, item.code).filter((course) => !item.courses.some((entry) => entry.code === course.code));
            const removable = !item.courses.length && !runningHere.length && index === plan.terms.length - 1 && item.code !== context.currentTerm && plan.terms.length > 1;
            return <section key={item.code} role="listitem" className={`rm-term${over === item.code ? " is-over" : ""}${item.code === term ? " is-current" : ""}`} aria-label={termLabel(item.code)}
              onDragOver={allowDrop(item.code)} onDragLeave={() => setOver(null)} onDrop={dropOnTerm(item.code)}>
              <header><button className="rm-term-open" onClick={() => { setSelected(item.code); setPicked(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{termLabel(item.code)}</button>
                <span className={`rm-load rm-load-${load.status}`}>{load.credits}{context.limits ? `/${context.limits.max}` : ""} TC</span></header>
              {(() => { const outside = item.courses.filter((entry) => { const course = byCode.get(entry.code.toUpperCase()); return course && offerIn(course, item.code) === "outside"; }).length;
                return outside ? <p className="rm-term-warn rm-term-low">{outside} môn ngoài kế hoạch đào tạo của học kỳ này: ít lớp, có thể không mở.</p> : null; })()}
              <ul>
                {runningHere.map((course) => <li key={course.code} className="is-running">{course.name}<span>Đang học</span></li>)}
                {item.courses.map((entry) => { const course = byCode.get(entry.code.toUpperCase()); const placed = entry.sessions.filter((session) => session.day !== null).length;
                  return <li key={entry.code} draggable onDragStart={startDrag({ kind: "course", code: entry.code })} className={issues.has(entry.code.toUpperCase()) ? "has-issue" : undefined}>
                    {course?.name ?? entry.code}<span>{course?.credits ?? "?"} TC{entry.sessions.length ? ` · lịch ${placed}/${entry.sessions.length}` : ""}</span>
                    <label className="rm-visually-hidden" htmlFor={`move-${entry.code}`}>Học kỳ của {course?.name ?? entry.code}</label>
                    <select id={`move-${entry.code}`} value={item.code} onChange={(event) => move(entry.code, event.target.value || null)}>
                      <option value="">Bỏ khỏi lộ trình</option>{terms.map((code) => <option key={code} value={code}>{termLabel(code)}</option>)}</select></li>; })}
                {!item.courses.length && !runningHere.length && <li className="rm-empty-term">Chưa có môn</li>}
              </ul>
              {removable && <button className="rm-link" onClick={() => removeTerm(item.code)}>Bỏ học kỳ này</button>}
            </section>; })}
        </div>
        <aside className="rm-progress" aria-label="Tiến độ tốt nghiệp">
          <h3>Tiến độ</h3>
          <dl className="rm-figures">
            <div><dt><i className="rm-dot rm-dot-done" />Đã đạt</dt><dd>{progress.done} TC</dd></div>
            <div><dt><i className="rm-dot rm-dot-running" />Đang học</dt><dd>{progress.running} TC</dd></div>
            <div><dt><i className="rm-dot rm-dot-planned" />Đã xếp</dt><dd>{progress.planned} TC</dd></div>
            {progress.total !== null && <div className="rm-total"><dt>Chương trình</dt><dd>{progress.total} TC</dd></div>}
          </dl>
          {progress.total !== null && progress.done + progress.running + progress.planned < progress.total && <p className="rm-missing">Còn thiếu {progress.total - progress.done - progress.running - progress.planned} TC so với chương trình: hãy chọn thêm môn, nhất là môn tự chọn.</p>}
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
    </section>
  </div>;
}
