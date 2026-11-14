import { useEffect, useState, type MouseEvent } from "react";
import { Icon } from "./ui-icon";
import { fileNameFrom } from "./admin-report-api";
import { SESSION_EXPIRED_EVENT, adminErrorText, adminFailureText, errorCodeOf } from "./admin-errors";

// "Tải xuống Excel CTĐT / KHĐT / tiêu chuẩn" (user 2026-11-14: "Không ghi là tải xuống excel nguồn phải ghi là tải xuống excel
// CTĐT") of the CTĐT, KHĐT and Tiêu chuẩn xét tốt nghiệp pages: GET /api/admin/{curricula|plans|
// graduation}/:id/source/:revision, the workbook stored with that revision in PostgreSQL. QA 2026-11-04: one click answered
// 503 and the next one worked. On these routes the API answers 503 only without a database (database_required), which a
// retry does not change: a 503 that goes away is the answer of the host in front of the API while it starts (Render's free
// plan wakes the server after 15 idle minutes, and restarts it on a deploy), as 502/504 are a proxy's answer while the API
// restarts. So the link fetches the file instead of opening it as a page: such an answer is tried once more after a
// moment, and what still fails is said next to the button instead of replacing the admin page with an error page.

/** Answers of a server or proxy that is starting or busy: worth one more try. */
const TRANSIENT = new Set([502, 503, 504]);
/** The pause before the one retry. */
export const RETRY_DELAY_MS = 1500;

/** This link's own texts; any other failure is worded as on every admin screen (admin-errors.ts). */
const SOURCE_TEXTS: Readonly<Record<string, string>> = {
  not_found: "Không tìm thấy tệp nguồn của phiên bản này. Vui lòng tải lại trang.",
};
/** A server or proxy still starting or busy after the one retry (its own page, no API code). */
export const SOURCE_BUSY_TEXT = "Máy chủ đang khởi động hoặc đang bận nên chưa tải được tệp. Vui lòng thử lại sau ít phút.";

/** The Vietnamese message of a failed download: status 0 when no answer came at all, body the answer's JSON if any. */
export function sourceDownloadError(status: number, body: unknown = {}): string {
  if (TRANSIENT.has(status) && !errorCodeOf(body)) return SOURCE_BUSY_TEXT;
  return adminErrorText(status, body, SOURCE_TEXTS);
}

/** Saves a downloaded file under its name, as the report exports do. */
function saveFile(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href; link.download = name; link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

export type SourceDownloadDeps = {
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  save?: (blob: Blob, name: string) => void;
};

/**
 * Downloads a source workbook with the session cookie and saves it under the server's file name; returns that name.
 * A 502/503/504 answer or a network failure is tried once more after RETRY_DELAY_MS. Throws a Vietnamese message.
 */
export async function downloadSource(url: string, fallbackName: string, deps: SourceDownloadDeps = {}): Promise<string> {
  const get = deps.fetch ?? fetch;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await wait(RETRY_DELAY_MS);
    try {
      response = await get(url, { credentials: "include", cache: "no-store" });
    } catch {
      response = null;
      continue;
    }
    if (!TRANSIENT.has(response.status)) break;
  }
  if (!response) throw new Error(sourceDownloadError(0));
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  if (!response.ok) throw new Error(sourceDownloadError(response.status, await response.json().catch(() => ({}))));
  const name = fileNameFrom(response.headers.get("Content-Disposition"), fallbackName);
  (deps.save ?? saveFile)(await response.blob(), name);
  return name;
}

/**
 * The download link of a revision's workbook, named after what it holds (`label`: "Tải xuống Excel CTĐT", …). A plain
 * click downloads through downloadSource and shows a failure under the actions; a middle or modified click still opens
 * the link the browser's way.
 */
export function SourceDownloadLink({ href, fallbackName, label, title }: { href: string; fallbackName: string; label: string; title?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setError(""), [href]);
  const click = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await downloadSource(href, fallbackName);
    } catch (failure) {
      setError(adminFailureText(failure));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <a className="am-outline" href={href} title={title} aria-busy={busy || undefined} onClick={(event) => void click(event)}>
      <Icon name="download" /> {busy ? "Đang tải xuống…" : label}
    </a>
    {error && <p className="admin-error cm-download-error" role="alert">{error}</p>}
  </>;
}
