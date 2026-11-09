import { Component, lazy, type ComponentType, type ErrorInfo, type ReactNode } from "react";

/**
 * A page that fails no longer blanks the whole site (user 2026-11-09: "lâu lâu đổi tab qua mục khác thì nó trắng màn hình
 * phải tải lại").
 *
 * The pages loaded on demand (StudentWorkspace: Đánh giá năng lực, Khoảng trống kỹ năng, Lộ trình học tập, Định hướng
 * nghề nghiệp, Trợ lý AI) live in hashed files that each deploy replaces. A tab opened before a deploy then asks for a
 * file that is gone (404), and with no error boundary React unmounted everything. Now such a page reloads the site once
 * (index.html is served no-cache, so the reload brings the new file names) and keeps its "Đang tải…" line meanwhile; a
 * second failure within RELOAD_GUARD_MS, or any other error while drawing a page, shows PageErrorScreen with "Tải lại
 * trang" instead of a blank screen.
 */
const RELOAD_KEY = "edupath.page-reload-at";
/** No second automatic reload within this time: a file still missing after one reload is shown as an error. */
export const RELOAD_GUARD_MS = 60_000;

/** A page file that could not be loaded (Chrome, Firefox and Safari word it differently; Vite for CSS). */
export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading (?:CSS )?chunk .* failed|Expected a JavaScript[- ]module script/i.test(text);
}

function sessionStore(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/**
 * Reloads the site once for a page file that failed to load. False, and no reload, when it already did so within
 * RELOAD_GUARD_MS, or when the tab cannot remember that it did (storage blocked), so a page that keeps failing never
 * reloads again and again.
 */
export function reloadForNewVersion(now: number = Date.now(), storage: Storage | null = sessionStore(), reload: () => void = () => window.location.reload()): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
    if (now - last < RELOAD_GUARD_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/** The loader of lazyPage: the page file, or, when it is gone after a deploy and the site reloads, a wait that never ends. */
export function pageLoader<T>(load: () => Promise<T>, reload: () => boolean = () => reloadForNewVersion()): () => Promise<T> {
  return () => load().catch((error: unknown) => {
    // The site reloads: the page keeps its "Đang tải…" line until it does.
    if (isChunkLoadError(error) && reload()) return new Promise<T>(() => undefined);
    throw error;
  });
}

/** React.lazy for a page file, reloading the site once when the file is gone after a deploy (reloadForNewVersion). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same bound as React.lazy
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, reload?: () => boolean) {
  return lazy(pageLoader(load, reload));
}

/** What shows in place of a page that failed: a plain sentence and "Tải lại trang". */
export function PageErrorScreen({ error, whole = false }: { error: unknown; whole?: boolean }) {
  const update = isChunkLoadError(error);
  return <section className={`page-error${whole ? " page-error-whole" : ""}`} role="alert">
    <h2>{update ? "Trang web vừa được cập nhật" : "Trang này gặp lỗi khi hiển thị"}</h2>
    <p>{update ? "Bạn hãy tải lại trang để dùng phiên bản mới."
      : "Bạn hãy tải lại trang. Nếu vẫn gặp lỗi, hãy báo cho Khoa qua email hỗ trợ ở cuối trang."}</p>
    <button type="button" className="page-error-reload" onClick={() => window.location.reload()}>Tải lại trang</button>
  </section>;
}

/**
 * Catches an error while drawing its children and shows PageErrorScreen there: around a page of a portal (resetKey: the
 * page, so another page in the menu draws again), and around the whole site (whole).
 */
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; whole?: boolean }, { error: unknown; key: string | undefined }> {
  state: { error: unknown; key: string | undefined } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: unknown; key: string | undefined }) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[EduPath] a page failed to draw", error, info.componentStack);
  }

  render() {
    return this.state.error === null ? this.props.children : <PageErrorScreen error={this.state.error} whole={this.props.whole === true} />;
  }
}
