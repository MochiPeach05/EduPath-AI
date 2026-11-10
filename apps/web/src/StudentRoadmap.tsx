import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import StudentAiRoadmap, { type ShownRoadmap } from "./StudentAiRoadmap";
import { RoadmapTrack } from "./RoadmapProgress";
import { RoadmapPlanner, type SaveState } from "./RoadmapPlanner";
import {
  STUDY_PLAN_API, declineProposal, planErrorMessage, planProposal, withTerms, type PlanOrigin, type StudyPlanData, type StudyPlanProjection,
  type StudyPlanResponse,
} from "./study-plan-data";
import { isAdvisorView } from "./advisor-view";
import { ActingConfirmDialog, planConfirm } from "./acting-confirm";
import "./student-roadmap.css";

// #roadmap "Lộ trình học tập" (user 2026-10-24: "Gần như áp dụng theo trang này làm nè cả giao diện luôn", OU's Stellic
// student guide): Theo dõi tiến độ (with the symbols folded in), Lộ trình AI, then Kế hoạch học kỳ, which starts from the
// training plan and the AI's proposal for the student to adjust. Stellic's "Schedule term" (weekly timetable) and
// "Request to graduate" are left out at the user's request. A cố vấn học tập or the Khoa working in the student's page
// edits Kế hoạch học kỳ as the student does after Sửa kế hoạch and one confirmation per visit (user 2026-11-10: "Kế hoạch
// học kỳ … cố vấn học tập và quản trị viên làm luôn nhé", policy 2026-11-10); the API logs it and tells the student.

/** The tabs and their addresses ("#roadmap/ke-hoach-hoc-ky"): a reload or a shared link opens the same tab. */
const TABS = [
  { id: "track", slug: "tien-do", label: "Theo dõi tiến độ" },
  { id: "ai", slug: "lo-trinh-ai", label: "Lộ trình AI đề xuất" },
  { id: "manual", slug: "ke-hoach-hoc-ky", label: "Kế hoạch học kỳ" },
] as const;
export type RoadmapTab = (typeof TABS)[number]["id"];
const TAB_KEY = "edupath.roadmap.tab";
const SAVE_DELAY_MS = 700;
/** An address of this page: "#roadmap" or "#roadmap/<tab>". */
const PAGE_HASH = /^#roadmap(\/|$)/;

/** The tab an address names ("#roadmap/lo-trinh-ai"), else null: a bare "#roadmap" or an unknown tab. */
export function tabFromHash(hash: string): RoadmapTab | null {
  const slug = /^#?roadmap\/([a-z0-9-]+)$/.exec(hash)?.[1];
  return TABS.find((tab) => tab.slug === slug)?.id ?? null;
}
/** The address of a tab: "#roadmap/tien-do", "#roadmap/lo-trinh-ai" or "#roadmap/ke-hoach-hoc-ky". */
export const tabHash = (tab: RoadmapTab) => `#roadmap/${TABS.find((item) => item.id === tab)!.slug}`;

function storedTab(): RoadmapTab {
  try {
    const value = window.localStorage.getItem(TAB_KEY);
    return TABS.some((tab) => tab.id === value) ? value as RoadmapTab : "track";
  } catch { return "track"; }
}
/**
 * The tab the page opens with: the one the address names, else (a bare "#roadmap": the header's link, a notification)
 * the one used last on this device, as before the tabs had addresses.
 */
function initialTab(): RoadmapTab {
  try { return tabFromHash(window.location.hash) ?? storedTab(); } catch { return "track"; }
}
/** Keeps the tab for a bare "#roadmap" and writes its address, while the address is still this page's. */
function rememberTab(tab: RoadmapTab) {
  try { window.localStorage.setItem(TAB_KEY, tab); } catch { /* the tab is only a convenience */ }
  try {
    const { hash } = window.location;
    if (PAGE_HASH.test(hash) && hash !== tabHash(tab)) window.history.replaceState(window.history.state, "", tabHash(tab));
  } catch { /* the address is only a convenience */ }
}

class PlanRequestError extends Error {
  constructor(readonly code: string | undefined) { super(planErrorMessage(code)); }
}
async function call<T>(init: RequestInit = {}): Promise<T> {
  const response = await fetch(STUDY_PLAN_API, { credentials: "include", cache: "no-store", ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    throw new PlanRequestError(body.error);
  }
  return body as T;
}

/**
 * The plan the page edits: loaded once when the page opens, saved 0.7 s after the last change with the version it was
 * loaded at (a plan changed meanwhile in another tab or device answers plan_changed). Opening the page changes and saves
 * nothing (user 2026-11-04: "Hỏi trước, bấm mới lưu"): a student without a plan sees the training plan's mandatory courses,
 * saved at the first edit; what the page would change (the newest AI roadmap's courses, what an AI roadmap of before
 * 2026-11-03 added and the plan must not hold, what an AI roadmap added of the thesis group off the way the plan follows:
 * the student's choice, else the recommendation; never a course the student placed, user 2026-11-10) is proposed
 * (planProposal), applied and saved by Áp dụng or declined by Bỏ qua, which saves only what keeps the proposal from coming
 * back (declineProposal). editable: false while a cố vấn học tập or the Khoa only looks at the plan, which proposes
 * nothing then. The plan is read again only when Lộ trình AI đề xuất shows a completed roadmap the loaded data does not know
 * (roadmapShown).
 */
function useStudyPlan(editable: boolean) {
  const [loaded, setLoaded] = useState<{ data: StudyPlanResponse | null; error: string | null }>({ data: null, error: null });
  const [plan, setPlan] = useState<StudyPlanData | null>(null);
  const [projection, setProjection] = useState<StudyPlanProjection | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const version = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<StudyPlanData | null>(null);
  const saving = useRef(false);
  const [origin, setOrigin] = useState<PlanOrigin>(null);
  // What the student applied (Áp dụng) or declined (Bỏ qua) on this visit, named in Kế hoạch học kỳ.
  const [cleaned, setCleaned] = useState<string[]>([]);
  const [thesisCleaned, setThesisCleaned] = useState<string[]>([]);
  const [declined, setDeclined] = useState(false);
  const [revision, setRevision] = useState(0);
  // The newest completed AI roadmap the loaded data knows (undefined until loaded), and whether a newer one was seen.
  const known = useRef<string | null | undefined>(undefined);
  const stale = useRef(false);
  const reload = useCallback(() => {
    // Never over unsaved edits: the next tab change tries again.
    if (!saving.current && !latest.current) setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    call<StudyPlanResponse>().then((data) => {
      if (!alive) return;
      version.current = data.plan?.version ?? null;
      known.current = data.aiRoadmapId !== undefined ? data.aiRoadmapId : data.aiProposal?.roadmapId ?? data.plan?.data.roadmapId ?? null;
      stale.current = false;
      setLoaded({ data, error: null });
      setPlan(withTerms(data.context, data.plan?.data ?? data.suggested ?? null));
      // The note of a proposal applied earlier on this page stays.
      setOrigin((previous) => data.plan ? (previous?.kind === "ai" ? previous : null) : data.suggested?.terms.length ? { kind: "prefill" } : null);
      setProjection(data.projection);
    }, (error: Error) => alive && setLoaded({ data: null, error: error.message }));
    return () => { alive = false; };
  }, [revision]);

  const save = useCallback(async () => {
    if (saving.current || !latest.current) return;
    saving.current = true;
    const data = latest.current;
    latest.current = null;
    setSaveState("saving");
    try {
      // Empty terms are not stored: the page adds the usual terms back when it loads.
      const body = { version: version.current, data: { ...data, terms: data.terms.filter((term) => term.courses.length) } };
      const result = await call<{ plan: { version: string }; projection: StudyPlanProjection | null }>({ method: "PUT", body: JSON.stringify(body) });
      version.current = result.plan.version;
      setProjection(result.projection);
      setSaveState(latest.current ? "dirty" : "saved");
      // A prefilled plan is saved now: its note ("sẽ được lưu khi bạn chỉnh sửa") no longer applies.
      setOrigin((value) => (value?.kind === "prefill" ? null : value));
    } catch (error) {
      setSaveError((error as Error).message);
      setSaveState("error");
      latest.current = null;
    } finally {
      saving.current = false;
      if (latest.current) timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    }
  }, []);
  // Leaving the page within 0.7 s of an edit still saves it.
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (latest.current) void save();
  }, [save]);

  /** An edit of the student: saved 0.7 s after the last one. */
  const change = useCallback((next: StudyPlanData) => {
    setPlan(next);
    latest.current = next;
    setSaveState("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);
  /** A button's decision (Áp dụng, Bỏ qua): saved at once. */
  const commit = useCallback((next: StudyPlanData) => {
    setPlan(next);
    latest.current = next;
    setSaveState("dirty");
    clearTimeout(timer.current);
    void save();
  }, [save]);

  const context = loaded.data?.context ?? null;
  const aiProposal = loaded.data?.aiProposal ?? null;
  const proposal = useMemo(() => (editable && context && plan ? planProposal(context, plan, aiProposal) : null), [editable, context, plan, aiProposal]);
  const apply = useCallback(() => {
    if (!context || !plan) return;
    // Taken again now, so what the AI added says when (aiAdded.addedAt).
    const current = planProposal(context, plan, aiProposal, new Date());
    if (!current) return;
    if (current.aiRemoved.length) setCleaned(current.aiRemoved);
    if (current.thesisRemoved.length) setThesisCleaned(current.thesisRemoved);
    if (current.roadmap) setOrigin({ kind: "ai", added: current.added.length });
    setDeclined(false);
    commit(current.plan);
  }, [context, plan, aiProposal, commit]);
  const decline = useCallback(() => {
    if (!plan || !proposal) return;
    setDeclined(true);
    commit(declineProposal(plan, proposal));
  }, [plan, proposal, commit]);

  /** Lộ trình AI đề xuất shows a roadmap: a completed one the loaded data does not know is read now (its proposal). */
  const roadmapShown = useCallback((roadmap: ShownRoadmap) => {
    if (known.current === undefined || roadmap?.status !== "completed" || roadmap.id === known.current) return;
    stale.current = true;
    reload();
  }, [reload]);
  /** On a tab change: read the plan again only when a newer roadmap was seen and could not be read then. */
  const refreshIfStale = useCallback(() => { if (stale.current) reload(); }, [reload]);

  return { context, suggestions: loaded.data?.aiSuggestions ?? [], cleaned, thesisCleaned, declined, error: loaded.error, plan, projection, change,
    saveState, saveError, origin, proposal, apply, decline, roadmapShown, refreshIfStale };
}

/** notice: shown under the tabs (the workspace's "Hồ sơ của bạn chưa đầy đủ"). */
export default function StudentRoadmap({ notice }: { notice?: ReactNode }) {
  const [tab, setTab] = useState<RoadmapTab>(initialTab);
  const shown = useRef(tab);
  // Working for the student: the plan as it is until Sửa kế hoạch is confirmed, then every edit as the student makes it.
  const acting = isAdvisorView();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const readOnly = acting && !editing;
  const study = useStudyPlan(!readOnly);
  const { refreshIfStale } = study;
  const choose = useCallback((next: RoadmapTab) => {
    shown.current = next;
    setTab(next);
    rememberTab(next);
    if (next !== "ai") refreshIfStale();
  }, [refreshIfStale]);
  // The address names the tab on screen; another address of this page opens its tab (a bare "#roadmap" keeps the tab).
  useEffect(() => rememberTab(shown.current), []);
  useEffect(() => {
    const follow = () => {
      if (PAGE_HASH.test(window.location.hash)) choose(tabFromHash(window.location.hash) ?? shown.current);
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [choose]);
  const needsPlan = tab === "track" || tab === "manual";
  return <div className="rm-page">
    <nav className="rm-tabs" role="tablist" aria-label="Lộ trình học tập">
      {TABS.map((item) => <button key={item.id} type="button" role="tab" id={`rm-tab-${item.id}`} aria-selected={tab === item.id}
        aria-controls="rm-tab-panel" className={tab === item.id ? "is-active" : undefined} onClick={() => choose(item.id)}>{item.label}</button>)}
    </nav>
    {notice}
    <div id="rm-tab-panel" role="tabpanel" aria-labelledby={`rm-tab-${tab}`} className="rm-tab-panel">
      {tab === "ai" ? <StudentAiRoadmap planContext={study.context} onRoadmap={study.roadmapShown} />
          : needsPlan && study.error ? <section className="sw-panel rm-problem" role="alert"><strong>Chưa tải được dữ liệu lộ trình</strong><p>{study.error}</p></section>
            : !study.context || !study.plan ? <section className="sw-panel" aria-busy="true"><p role="status">Đang tải lộ trình học tập…</p></section>
              : tab === "track" ? <RoadmapTrack context={study.context} plan={study.plan} projection={study.projection} origin={study.origin}
                proposal={study.proposal} onOpenPlanner={() => choose("manual")} />
                : <RoadmapPlanner context={study.context} plan={study.plan} onChange={study.change} saveState={study.saveState} saveError={study.saveError}
                  origin={study.origin} onOpenAi={() => choose("ai")} readOnly={readOnly} onEdit={readOnly ? () => setConfirming(true) : undefined}
                  suggestions={study.suggestions} cleaned={study.cleaned} thesisCleaned={study.thesisCleaned} proposal={study.proposal} onApply={study.apply}
                  onDecline={study.decline} declined={study.declined} />}
    </div>
    {confirming && <ActingConfirmDialog {...planConfirm} onClose={() => setConfirming(false)}
      onConfirm={() => { setConfirming(false); setEditing(true); }} />}
  </div>;
}
