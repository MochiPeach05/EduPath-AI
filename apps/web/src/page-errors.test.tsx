import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageErrorBoundary, PageErrorScreen, RELOAD_GUARD_MS, isChunkLoadError, pageLoader, reloadForNewVersion } from "./page-errors";

// A page that fails no longer blanks the site (user 2026-11-09: "đổi tab qua mục khác thì nó trắng màn hình").
const chrome = new TypeError("Failed to fetch dynamically imported module: https://edupath.example/assets/StudentCompetency-a1b2c3.js");
const firefox = new TypeError("error loading dynamically imported module: https://edupath.example/assets/StudentRoadmap-a1b2c3.js");
const safari = new TypeError("Importing a module script failed.");
const css = new Error("Unable to preload CSS for /assets/StudentCompetency-a1b2c3.css");
const bug = new TypeError("Cannot read properties of undefined (reading 'map')");

function memory() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } } as unknown as Storage;
}

describe("a page file gone after a deploy", () => {
  it("is told apart from other errors, as each browser words it", () => {
    for (const error of [chrome, firefox, safari, css]) expect(isChunkLoadError(error)).toBe(true);
    expect(isChunkLoadError(bug)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("reloads the site once, and not again within a minute, nor when the tab cannot remember it", () => {
    const storage = memory();
    const reload = vi.fn();
    expect(reloadForNewVersion(1_000_000, storage, reload)).toBe(true);
    expect(reloadForNewVersion(1_000_000 + RELOAD_GUARD_MS - 1, storage, reload)).toBe(false);
    expect(reloadForNewVersion(1_000_000 + RELOAD_GUARD_MS + 1, storage, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reloadForNewVersion(5_000_000, null, reload)).toBe(false);
    const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => undefined } as unknown as Storage;
    expect(reloadForNewVersion(5_000_000, blocked, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("keeps the page loading while the site reloads, and passes other failures on", async () => {
    const pending = Symbol("pending");
    const settle = (promise: Promise<unknown>) => Promise.race([promise.then(() => "done", () => "failed"), new Promise((resolve) => setTimeout(() => resolve(pending), 20))]);
    const page = { default: () => null };
    expect(await settle(pageLoader(async () => page, () => true)())).toBe("done");
    expect(await settle(pageLoader(() => Promise.reject(chrome), () => true)())).toBe(pending);
    await expect(pageLoader(() => Promise.reject(chrome), () => false)()).rejects.toBe(chrome);
    const reload = vi.fn(() => true);
    await expect(pageLoader(() => Promise.reject(bug), reload)()).rejects.toBe(bug);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("a page that fails to draw", () => {
  it("shows a plain message with Tải lại trang instead of a blank screen", () => {
    const update = renderToStaticMarkup(<PageErrorScreen error={chrome} />);
    expect(update).toContain('<section class="page-error" role="alert"><h2>Trang web vừa được cập nhật</h2><p>Bạn hãy tải lại trang để dùng phiên bản mới.</p>');
    expect(update).toContain('<button type="button" class="page-error-reload">Tải lại trang</button>');
    const other = renderToStaticMarkup(<PageErrorScreen error={bug} whole />);
    expect(other).toContain('<section class="page-error page-error-whole" role="alert"><h2>Trang này gặp lỗi khi hiển thị</h2>');
  });

  it("catches the error of its page and draws again when the student opens another page", () => {
    expect(PageErrorBoundary.getDerivedStateFromError(bug)).toEqual({ error: bug });
    expect(PageErrorBoundary.getDerivedStateFromProps({ resetKey: "competency" }, { error: bug, key: "competency" })).toBeNull();
    expect(PageErrorBoundary.getDerivedStateFromProps({ resetKey: "roadmap" }, { error: bug, key: "competency" })).toEqual({ error: null, key: "roadmap" });
    const boundary = new PageErrorBoundary({ children: <p>Trang</p>, resetKey: "competency" });
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe("<p>Trang</p>");
    boundary.state = { error: bug, key: "competency" };
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toContain("Trang này gặp lỗi khi hiển thị");
  });
});
