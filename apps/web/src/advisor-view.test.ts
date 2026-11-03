import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADVISOR_BLOCKED_EVENT, ADVISOR_HOME, ADVISOR_STUDENT_KEY, actingAsText, actingStudentId, advisorBlockedMessage, installAdvisorFetch, isAdvisorView,
  isStudentApiRequest, stopActing, takeAdvisorStudentFromUrl, withAdvisorHeader,
} from "./advisor-view";
import { ADVISOR_ERRORS, ADVISOR_STUDENT_HEADER } from "./advisor-types";

// A synthetic student id of the local test schema; no real account.
const STUDENT = "00000000-0000-4000-8000-0000000e2e05";
const ORIGIN = "https://edupath.test";

/** A tab's window: its address, history, sessionStorage and the events it dispatches. */
function fakeTab(path: string, stored: Record<string, string> = {}) {
  const store = new Map(Object.entries(stored));
  const events: Event[] = [];
  const tab = {
    location: new URL(path, ORIGIN),
    history: {
      state: null,
      replaceState: vi.fn((_state: unknown, _title: string, url: string) => { tab.location = new URL(url, ORIGIN); }),
    },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    },
    dispatchEvent: (event: Event) => { events.push(event); return true; },
  };
  vi.stubGlobal("window", tab);
  return { tab, store, events };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  stopActing();
  vi.unstubAllGlobals();
});

describe("the student of an advisor's tab", () => {
  it("keeps ?sv=<student> for this tab and takes it out of the address, hash kept", () => {
    const { tab, store } = fakeTab(`/dashboard?sv=${STUDENT}#overview`);
    expect(takeAdvisorStudentFromUrl()).toBe(STUDENT);
    expect(store.get(ADVISOR_STUDENT_KEY)).toBe(STUDENT);
    expect(tab.history.replaceState).toHaveBeenCalledWith(null, "", "/dashboard#overview");
    expect(tab.location.search).toBe("");
  });

  it("drops a parameter that is not a student id without keeping it", () => {
    const { store, tab } = fakeTab("/dashboard?sv=1;DROP&x=1#career");
    expect(takeAdvisorStudentFromUrl()).toBeNull();
    expect(store.has(ADVISOR_STUDENT_KEY)).toBe(false);
    expect(`${tab.location.pathname}${tab.location.search}${tab.location.hash}`).toBe("/dashboard?x=1#career");
  });

  it("finds the tab's student again after a reload", () => {
    fakeTab("/dashboard#roadmap", { [ADVISOR_STUDENT_KEY]: STUDENT });
    expect(takeAdvisorStudentFromUrl()).toBe(STUDENT);
    expect(actingStudentId()).toBe(STUDENT);
  });

  it("ignores a stored value that is not a student id", () => {
    fakeTab("/dashboard", { [ADVISOR_STUDENT_KEY]: "not-an-id" });
    expect(actingStudentId()).toBeNull();
  });
});

describe("requests of an advisor's tab", () => {
  it("adds the student only to this site's student API", () => {
    fakeTab("/dashboard");
    expect(isStudentApiRequest("/api/student/profile")).toBe(true);
    expect(isStudentApiRequest(`${ORIGIN}/api/student`)).toBe(true);
    expect(isStudentApiRequest(new URL("/api/student/assistant/threads", ORIGIN))).toBe(true);
    expect(isStudentApiRequest("/api/auth/me")).toBe(false);
    expect(isStudentApiRequest("/api/students")).toBe(false);
    expect(isStudentApiRequest("https://other.test/api/student/profile")).toBe(false);
  });

  it("keeps the request's own headers", () => {
    const [, init] = withAdvisorHeader("/api/student/roadmap", { method: "POST", headers: { "Content-Type": "application/json" } }, STUDENT);
    const headers = new Headers(init?.headers);
    expect(headers.get(ADVISOR_STUDENT_HEADER)).toBe(STUDENT);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init?.method).toBe("POST");
    const [request] = withAdvisorHeader(new Request(`${ORIGIN}/api/student/transcript`, { headers: { "X-File-Name": "bang-diem.pdf" } }), undefined, STUDENT);
    expect((request as Request).headers.get(ADVISOR_STUDENT_HEADER)).toBe(STUDENT);
    expect((request as Request).headers.get("X-File-Name")).toBe("bang-diem.pdf");
  });

  it("wraps fetch once, announces the API's refusals and puts fetch back on leaving", async () => {
    const { events, store } = fakeTab("/dashboard", { [ADVISOR_STUDENT_KEY]: STUDENT });
    const server = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => (String(input).includes("/survey") ? json(403, { error: "advisor_action_not_allowed" }) : json(200, {})));
    vi.stubGlobal("fetch", server);
    expect(isAdvisorView()).toBe(false);
    installAdvisorFetch(STUDENT);
    installAdvisorFetch(STUDENT);
    expect(isAdvisorView()).toBe(true);

    await fetch("/api/student/profile", { credentials: "include" });
    await fetch("/api/auth/me");
    expect(new Headers(server.mock.calls[0]![1]?.headers).get(ADVISOR_STUDENT_HEADER)).toBe(STUDENT);
    expect(new Headers(server.mock.calls[1]![1]?.headers).has(ADVISOR_STUDENT_HEADER)).toBe(false);

    const refused = await fetch("/api/student/survey", { method: "PUT" });
    expect(await refused.json()).toEqual({ error: "advisor_action_not_allowed" });
    await settle();
    expect(events.map((event) => [event.type, (event as CustomEvent<string>).detail])).toEqual([[ADVISOR_BLOCKED_EVENT, "advisor_action_not_allowed"]]);

    stopActing();
    expect(isAdvisorView()).toBe(false);
    expect(globalThis.fetch).toBe(server);
    expect(store.has(ADVISOR_STUDENT_KEY)).toBe(false);
  });

  it("does not announce other refusals", async () => {
    const { events } = fakeTab("/dashboard");
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { error: "insufficient_role" })));
    installAdvisorFetch(STUDENT);
    await fetch("/api/student/transcript");
    await settle();
    expect(events).toEqual([]);
  });

  it("names the refusals in the advisor's words", () => {
    expect(advisorBlockedMessage("advisor_student_forbidden")).toBe(ADVISOR_ERRORS.advisor_student_forbidden);
    expect(advisorBlockedMessage("something_else")).toBe(ADVISOR_ERRORS.advisor_action_not_allowed);
  });
});

describe("who works in the student's tab (Quản lý sinh viên, 2026-11-03)", () => {
  it("names the role the page was opened with", () => {
    expect(actingAsText("advisor")).toBe("cố vấn học tập");
    expect(actingAsText("admin")).toBe("quản trị viên");
    expect(actingAsText("faculty_board")).toBe("Ban chủ nhiệm khoa");
    // Another admin-portal account opens a student's page only for the classes it advises.
    expect(actingAsText("lecturer")).toBe("cố vấn học tập");
  });

  it("goes back to Quản lý sinh viên when the tab is closed", () => {
    expect(ADVISOR_HOME).toBe("/quantri/quan-ly-sinh-vien");
  });
});
