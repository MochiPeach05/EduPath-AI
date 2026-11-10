import { isAdminArea } from "./routing";

/**
 * Marks the page with the scale styles.css draws it at: html[data-ep-scale="admin"] for the admin portal (/quantri), which
 * keeps its 80% desktop scale with CSS `zoom` from 1200px; no mark for every other page (the landing page, the public
 * pages, the student portal, also when staff open a student's page), drawn at 100% (user 2026-11-10). main.tsx calls it
 * before the first render and again when the history moves to another address.
 */
export function syncPageScale(pathname = window.location.pathname, root: HTMLElement = document.documentElement): void {
  if (isAdminArea(pathname)) root.dataset.epScale = "admin";
  else delete root.dataset.epScale;
}

/**
 * The factor the page is painted at, as CSS `zoom` on the element's ancestors.
 *
 * The admin portal is scaled down with `zoom` on desktop widths, so measured
 * geometry (`getBoundingClientRect`) is smaller than the numbers the stylesheet
 * works in. Dividing a measurement by this factor hands layout code back a value
 * it can compare with — or feed back into — px written in CSS. Elsewhere it is 1.
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
