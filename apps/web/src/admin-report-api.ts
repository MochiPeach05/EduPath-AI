import { useEffect, useRef, useState } from "react";
import type { ReportFilters } from "./admin-report-types";

// Requests of the admin reports (AD-REPORT-01…11, 2026-10-31). Contract: admin-report-types.ts. Every report takes the
// shared filters (cohort, major, specialty, q); the student lists add status/level, sort, dir, page and pageSize, the
// Excel exports take the same query as the page they export.

export const REPORTS_API = "/api/admin/reports";
export const AUDIT_API = "/api/admin/audit-log";

/** The filter bar as the inputs hold it (empty = every value). Kept in the page's URL so it survives page changes. */
export type ReportFilterState = { q: string; cohort: string; major: string; specialty: string };
export const EMPTY_FILTERS: ReportFilterState = { q: "", cohort: "", major: "", specialty: "" };
const FILTER_KEYS = ["q", "cohort", "major", "specialty"] as const;

/** The filters of a URL query ("?cohort=K29&q=an"); unknown keys are ignored. */
export function filtersFromSearch(search: string): ReportFilterState {
  const params = new URLSearchParams(search);
  const read = (key: (typeof FILTER_KEYS)[number]) => (params.get(key) ?? "").trim().slice(0, 120);
  return { q: read("q"), cohort: read("cohort"), major: read("major"), specialty: read("specialty") };
}

/** "?cohort=K29&q=an", or "" without any filter: the query the report pages keep in the address bar. */
export function filtersToSearch(filters: ReportFilterState): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) if (filters[key].trim()) params.set(key, filters[key].trim());
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The filters as the API reads them (empty values left out). */
export function apiFilters(filters: ReportFilterState): ReportFilters {
  const result: ReportFilters = {};
  for (const key of FILTER_KEYS) if (filters[key].trim()) result[key] = filters[key].trim();
  return result;
}

type QueryValue = string | number | null | undefined;
/** `${REPORTS_API}/progress?cohort=K29&status=late&page=2`: the filters first, then the page's own parameters. */
export function reportUrl(path: string, filters: ReportFilterState, extra: Record<string, QueryValue> = {}, base = REPORTS_API): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(apiFilters(filters))) params.set(key, value);
  for (const [key, value] of Object.entries(extra)) if (value !== null && value !== undefined && String(value) !== "") params.set(key, String(value));
  const text = params.toString();
  return `${base}${path}${text ? `?${text}` : ""}`;
}

const failures: Record<string, string> = {
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  insufficient_role: "Bạn không có quyền xem thống kê này.",
  forbidden: "Bạn không có quyền xem thống kê này.",
  invalid_query: "Bộ lọc chưa hợp lệ. Vui lòng chọn lại.",
  invalid_input: "Bộ lọc chưa hợp lệ. Vui lòng chọn lại.",
  not_found: "Không tìm thấy dữ liệu của mục này.",
  database_required: "Thống kê cần kết nối cơ sở dữ liệu. Vui lòng thử lại sau.",
};
/** The Vietnamese message of a failed report request. */
export function reportErrorText(status: number, code: string | undefined): string {
  if (code && failures[code]) return failures[code]!;
  if (status === 401) return failures.authentication_required!;
  if (status === 403) return failures.forbidden!;
  if (status === 404) return "Thống kê chưa sẵn sàng trên máy chủ. Vui lòng thử lại sau.";
  return "Không tải được thống kê. Vui lòng thử lại.";
}

async function readReport<T>(response: Response): Promise<T> {
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(reportErrorText(response.status, body.error));
  }
  return await response.json() as T;
}

export type ReportState<T> = { data: T | null; error: string | null; loading: boolean; retry: () => void };
/**
 * Loads a report once per URL (reports are computed on the server, so no background polling). While a new filter
 * loads, the previous numbers stay on screen; a failed load shows its message with "Thử lại". A null URL loads nothing.
 */
export function useReport<T>(url: string | null): ReportState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: url !== null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (url === null) { setState({ data: null, error: null, loading: false }); return; }
    const controller = new AbortController();
    setState((previous) => ({ data: previous.data, error: null, loading: true }));
    void fetch(url, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then((response) => readReport<T>(response))
      .then((data) => { if (!controller.signal.aborted) setState({ data, error: null, loading: false }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ data: null, error: error instanceof Error && error.message ? error.message : "Không tải được thống kê. Vui lòng thử lại.", loading: false });
      });
    return () => controller.abort();
  }, [url, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

/**
 * The file name a download is saved under: RFC 5987 filename* first (UTF-8, percent-encoded), then filename, then the
 * fallback. Path separators are dropped so the name cannot point anywhere else.
 */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  let name: string | null = null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star) { try { name = decodeURIComponent(star[1]!.trim().replace(/^"|"$/g, "")); } catch { name = null; } }
  if (!name) { const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(disposition); name = (plain?.[1] ?? plain?.[2] ?? "").trim() || null; }
  const safe = name?.replace(/[\\/]/g, "-").trim();
  return safe || fallback;
}

/** Downloads an Excel export with the session cookie and saves it under the server's file name. Throws a Vietnamese message. */
export async function downloadExcel(url: string, fallbackName: string): Promise<string> {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(response.status === 404 && !body.error ? "Chưa xuất được file: chức năng xuất Excel chưa sẵn sàng trên máy chủ." : reportErrorText(response.status, body.error));
  }
  const name = fileNameFrom(response.headers.get("Content-Disposition"), fallbackName);
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href; link.download = name; link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  return name;
}

/** The latest value of a text input, applied after the person stops typing (300 ms), as the other admin lists do. */
export function useDebounced(value: string, delay = 300): string {
  const [settled, setSettled] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer.current);
  }, [value, delay]);
  return settled;
}
