import { useCallback, useEffect, useRef, useState } from "react";
import StudentAiRoadmap from "./StudentAiRoadmap";
import { RoadmapTrack } from "./RoadmapProgress";
import { RoadmapPlanner, type SaveState } from "./RoadmapPlanner";
import {
  STUDY_PLAN_API, applyProposal, planErrorMessage, withTerms, type StudyPlanData, type StudyPlanProjection, type StudyPlanResponse,
} from "./study-plan-data";
import "./student-roadmap.css";

// #roadmap "Lộ trình học tập" (user 2026-10-24: "Gần như áp dụng theo trang này làm nè cả giao diện luôn", OU's Stellic
// student guide): Theo dõi tiến độ (with the symbols folded in), Lộ trình AI, then Kế hoạch học kỳ, which starts from the
// training plan and the AI's proposal for the student to adjust. Stellic's "Schedule term" (weekly timetable) and
// "Request to graduate" are left out at the user's request.

const TABS = [
  { id: "track", label: "Theo dõi tiến độ" },
  { id: "ai", label: "Lộ trình AI đề xuất" },
  { id: "manual", label: "Kế hoạch học kỳ" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const TAB_KEY = "edupath.roadmap.tab";
const SAVE_DELAY_MS = 700;

function storedTab(): Tab {
  try {
    const value = window.localStorage.getItem(TAB_KEY);
    return TABS.some((tab) => tab.id === value) ? value as Tab : "track";
  } catch { return "track"; }
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

/** Where the plan on screen came from, shown above the planner. */
export type PlanOrigin = { kind: "prefill" } | { kind: "ai"; added: number; completedAt: string; term: string } | null;

/**
 * The plan the page edits: loaded when the page opens and again when a planning tab opens (an AI roadmap may have been
 * written meanwhile), saved 0.7 s after the last change with the version it was loaded at. A student without a plan starts
 * from the training plan's mandatory courses; the newest AI roadmap's proposal is taken in and saved at once.
 */
function useStudyPlan() {
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
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => {
    // Never over unsaved edits.
    if (!saving.current && !latest.current) setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    call<StudyPlanResponse>().then((data) => {
      if (!alive) return;
      version.current = data.plan?.version ?? null;
      setLoaded({ data, error: null });
      let next = withTerms(data.context, data.plan?.data ?? data.suggested ?? null);
      if (data.aiProposal) {
        const applied = applyProposal(next, data.aiProposal);
        next = applied.plan;
        setOrigin({ kind: "ai", added: applied.added, completedAt: data.aiProposal.completedAt, term: data.aiProposal.term });
        // Saved at once, so the proposal is taken in only once.
        latest.current = next;
        timer.current = setTimeout(() => void save(), 0);
      } else {
        // The note of a proposal taken in earlier on this page stays.
        setOrigin((previous) => data.plan ? (previous?.kind === "ai" ? previous : null) : data.suggested?.terms.length ? { kind: "prefill" } : null);
      }
      setPlan(next);
      setProjection(data.projection);
    }, (error: Error) => alive && setLoaded({ data: null, error: error.message }));
    return () => { alive = false; clearTimeout(timer.current); };
    // save is stable (useCallback without dependencies).
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
    } catch (error) {
      setSaveError((error as Error).message);
      setSaveState("error");
      latest.current = null;
    } finally {
      saving.current = false;
      if (latest.current) timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    }
  }, []);

  const change = useCallback((next: StudyPlanData) => {
    setPlan(next);
    latest.current = next;
    setSaveState("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  return { context: loaded.data?.context ?? null, error: loaded.error, plan, projection, change, saveState, saveError, origin, reload };
}

export default function StudentRoadmap() {
  const [tab, setTab] = useState<Tab>(storedTab);
  const study = useStudyPlan();
  const choose = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    if (next !== "ai") study.reload();
    try { window.localStorage.setItem(TAB_KEY, next); } catch { /* the tab is only a convenience */ }
  };
  const needsPlan = tab === "track" || tab === "manual";
  return <div className="rm-page">
    <nav className="rm-tabs" role="tablist" aria-label="Lộ trình học tập">
      {TABS.map((item) => <button key={item.id} type="button" role="tab" id={`rm-tab-${item.id}`} aria-selected={tab === item.id}
        aria-controls="rm-tab-panel" className={tab === item.id ? "is-active" : undefined} onClick={() => choose(item.id)}>{item.label}</button>)}
    </nav>
    <div id="rm-tab-panel" role="tabpanel" aria-labelledby={`rm-tab-${tab}`} className="rm-tab-panel">
      {tab === "ai" ? <StudentAiRoadmap />
          : needsPlan && study.error ? <section className="sw-panel rm-problem" role="alert"><strong>Chưa tải được dữ liệu lộ trình</strong><p>{study.error}</p></section>
            : !study.context || !study.plan ? <section className="sw-panel" aria-busy="true"><p role="status">Đang tải lộ trình học tập…</p></section>
              : tab === "track" ? <RoadmapTrack context={study.context} plan={study.plan} projection={study.projection} />
                : <RoadmapPlanner context={study.context} plan={study.plan} onChange={study.change} saveState={study.saveState} saveError={study.saveError}
                  origin={study.origin} onOpenAi={() => choose("ai")} />}
    </div>
  </div>;
}
