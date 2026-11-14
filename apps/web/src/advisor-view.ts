// The student portal opened by a cố vấn học tập or a Khoa admin (AD-AST-05…08; user 2026-11-03, policy 2026-11-03).
// "Xem chi tiết" in Quản lý sinh viên opens "/dashboard?sv=<student>#overview" in a tab of its own; that tab keeps the
// student in sessionStorage (one tab, one student, so two students in two tabs never mix), and every /api/student request
// of the tab carries X-Advisor-Student, which the API checks on each request against the advisor's classes, or lets pass
// for an admin or Ban chủ nhiệm khoa (apps/api/src/advisors/access.ts). The pages read
// isAdvisorView() to hide what an advisor cannot do for the student (consent, deletions, the bell; since policy 2026-11-10
// the specialty, the target vị trí nghề nghiệp, Kế hoạch học kỳ and Khảo sát nhanh are done for the student after a
// confirmation); a refusal of the API all the same is announced with ADVISOR_BLOCKED_EVENT.
import { ADVISOR_ERRORS, ADVISOR_STUDENT_HEADER, ADVISOR_STUDENT_PARAM } from "./advisor-types";

/** sessionStorage key of the student this tab works for. */
export const ADVISOR_STUDENT_KEY = "edupath.advisorStudent";
/** Window event when the API refuses an advisor's request; detail is the error code. */
export const ADVISOR_BLOCKED_EVENT = "edupath-advisor-blocked";
/** The error codes of advisors/access.ts that ADVISOR_BLOCKED_EVENT announces. */
const BLOCKED_CODES = new Set(["advisor_action_not_allowed", "advisor_student_forbidden"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tabStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** The student this tab works for, or null (a student's own tab, or an advisor's tab of the admin portal). */
export function actingStudentId(): string | null {
  try {
    const value = tabStorage()?.getItem(ADVISOR_STUDENT_KEY) ?? null;
    return value && UUID.test(value) ? value : null;
  } catch { return null; }
}

/**
 * Reads "?sv=<student>" once: a valid id is kept for this tab, and the parameter leaves the address either way (the hash
 * stays), so a copied link or a bookmark never carries a student. Returns the student this tab works for.
 */
export function takeAdvisorStudentFromUrl(): string | null {
  try {
    const { pathname, search, hash } = window.location;
    const params = new URLSearchParams(search);
    if (!params.has(ADVISOR_STUDENT_PARAM)) return actingStudentId();
    const value = params.get(ADVISOR_STUDENT_PARAM) ?? "";
    params.delete(ADVISOR_STUDENT_PARAM);
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${pathname}${query ? `?${query}` : ""}${hash ?? ""}`);
    if (UUID.test(value)) {
      try { tabStorage()?.setItem(ADVISOR_STUDENT_KEY, value); } catch { /* without storage the tab works until it reloads */ }
      return value;
    }
  } catch { /* an address that cannot be read leaves the tab as it was */ }
  return actingStudentId();
}

const requestUrl = (input: RequestInfo | URL) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/** Whether a request goes to the student API of this site (the only requests that carry the student). */
export function isStudentApiRequest(input: RequestInfo | URL, origin = window.location.origin): boolean {
  try {
    const url = new URL(requestUrl(input), origin);
    return url.origin === origin && (url.pathname === "/api/student" || url.pathname.startsWith("/api/student/"));
  } catch { return false; }
}

/** The request with X-Advisor-Student added, keeping its other headers. */
export function withAdvisorHeader(input: RequestInfo | URL, init: RequestInit | undefined, studentId: string): [RequestInfo | URL, RequestInit | undefined] {
  if (input instanceof Request) {
    const headers = new Headers(init?.headers ?? input.headers);
    headers.set(ADVISOR_STUDENT_HEADER, studentId);
    return [new Request(input, { ...init, headers }), undefined];
  }
  const headers = new Headers(init?.headers);
  headers.set(ADVISOR_STUDENT_HEADER, studentId);
  return [input, { ...init, headers }];
}

let activeStudent: string | null = null;
let originalFetch: typeof fetch | null = null;

/** True while this tab works for a student of the advisor (the wrapper below is installed). */
export const isAdvisorView = () => activeStudent !== null;

async function announceRefusal(response: Response): Promise<void> {
  if (response.status !== 403) return;
  try {
    const body = await response.clone().json() as { error?: unknown };
    if (typeof body.error === "string" && BLOCKED_CODES.has(body.error)) {
      window.dispatchEvent(new CustomEvent<string>(ADVISOR_BLOCKED_EVENT, { detail: body.error }));
    }
  } catch { /* not JSON: the page's own error handling says what went wrong */ }
}

/**
 * Wraps fetch once for this tab: every same-origin /api/student request carries the student; other requests (the
 * session, the public pages) go as they are. Calling it again only changes the student.
 */
export function installAdvisorFetch(studentId: string): void {
  activeStudent = studentId;
  if (originalFetch) return;
  const original = globalThis.fetch.bind(globalThis);
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const student = activeStudent;
    if (!student || !isStudentApiRequest(input)) return original(input, init);
    const [request, options] = withAdvisorHeader(input, init, student);
    const response = await original(request, options);
    void announceRefusal(response);
    return response;
  }) as typeof fetch;
}

/** Leaves the student's page: forgets the student of this tab and puts fetch back. */
export function stopActing(): void {
  activeStudent = null;
  try { tabStorage()?.removeItem(ADVISOR_STUDENT_KEY); } catch { /* nothing kept */ }
  if (originalFetch) { globalThis.fetch = originalFetch; originalFetch = null; }
}

/** What to tell the advisor about a refusal of the API. */
export const advisorBlockedMessage = (code: string) => ADVISOR_ERRORS[code] ?? ADVISOR_ERRORS.advisor_action_not_allowed!;

/** Where "Đóng trang sinh viên" goes when the tab was not opened by Quản lý sinh viên (a script cannot close it). */
export const ADVISOR_HOME = "/quantri/quan-ly-sinh-vien";

/**
 * Who works in the student's page, as the banner says it ("với tư cách cố vấn học tập"): the Khoa's admins and Ban chủ
 * nhiệm khoa by their role (they open any student's page), anyone else as the advisor of the student's class.
 */
export function actingAsText(role: string): string {
  if (role === "admin") return "quản trị viên";
  if (role === "faculty_board") return "Ban chủ nhiệm khoa";
  return "cố vấn học tập";
}
