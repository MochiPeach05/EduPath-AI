import { useLayoutEffect } from "react";
import { isAdminArea, resolveAppRoute, type AppRoute } from "./routing";

/**
 * The scale styles.css draws a page at from 1200px, as html[data-ep-scale] (user 2026-11-10: "trang chủ vẫn 100% trang
 * login 80% trang sau khi sinh viên đăng nhập 90% Chính sách & Điều khoản và Câu hỏi thường gặp là 80% nhưng header và
 * footer to bằng trang chủ luôn"; "Còn trang của quản trị viên giữ nguyên"):
 * - "admin": the admin portal (/quantri, its sign-in and its Không tìm thấy trang too), 80%;
 * - "login": Đăng nhập (and the notice that sends staff to the admin portal), 80%;
 * - "student": the student portal, also when staff open a student's page, 90%;
 * - "info": Chính sách & Điều khoản and Câu hỏi thường gặp, their content at 80% under a header and a footer as large as
 *   the landing page's;
 * - null: the landing page and Không tìm thấy trang, 100%.
 * Below 1200px every page keeps its natural size.
 */
export type PageScale = "admin" | "login" | "student" | "info";

/** The scale of the page an address opens (resolveAppRoute). */
export function scaleOfRoute(route: AppRoute, pathname: string): PageScale | null {
  if (route === "admin") return "admin";
  if (route === "login") return "login";
  if (route === "authenticated") return "student";
  if (route === "policy" || route === "faq") return "info";
  return route === "notFound" && isAdminArea(pathname) ? "admin" : null;
}

export function setPageScale(scale: PageScale | null, root: HTMLElement = document.documentElement): void {
  if (scale) root.dataset.epScale = scale;
  else delete root.dataset.epScale;
}

/** Marks the page by its address; main.tsx does it before the first render, so the first paint has its scale. */
export function syncPageScale(pathname = window.location.pathname, search = window.location.search, root: HTMLElement = document.documentElement): void {
  setPageScale(scaleOfRoute(resolveAppRoute(pathname, search), pathname), root);
}

/**
 * For a page that is not always the one its address opens (Đăng nhập when /dashboard finds no session, the student
 * portal after /login or /auth/callback): its own scale, set before it is painted.
 */
export function usePageScale(scale: PageScale | null): void {
  useLayoutEffect(() => setPageScale(scale), [scale]);
}

/**
 * The factor the page is painted at, as CSS `zoom` on the element's ancestors.
 *
 * Scaled pages are drawn with `zoom` on desktop widths, so measured geometry
 * (`getBoundingClientRect`) is smaller than the numbers the stylesheet works
 * in. Dividing a measurement by this factor hands layout code back a value it
 * can compare with — or feed back into — px written in CSS. It is 1 where the
 * page is drawn at 100%.
 */
export function layoutZoom(element: Element): number {
  const zoom = (element as Element & { currentCSSZoom?: number }).currentCSSZoom;
  return zoom && zoom > 0 ? zoom : 1;
}

/**
 * Height the element occupies in the coordinates its own stylesheet works in.
 *
 * getBoundingClientRect reports the painted size, so a measured header is
 * shorter than the value CSS calculates with when the page is zoomed.
 */
export function layoutHeight(element: Element): number {
  return element.getBoundingClientRect().height / layoutZoom(element);
}
