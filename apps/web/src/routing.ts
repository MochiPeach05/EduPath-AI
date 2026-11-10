import { isAdminPortalPath } from "./admin-navigation";

export type AppRoute = "landing" | "policy" | "faq" | "login" | "authenticated" | "admin" | "notFound";

/**
 * The page an address opens. Every address the app answers is listed here (the API answers the others with 404,
 * apps/api/src/app.ts); anything else is Không tìm thấy trang (NotFoundPage), not the student portal under a wrong
 * address. Pages inside /dashboard are hashes (StudentWorkspace), and an unknown hash opens Tổng quan there.
 */
export function resolveAppRoute(pathname: string, search: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (["/chinh-sach-va-dieu-khoan", "/chinh-sach-bao-mat", "/dieu-khoan-su-dung"].includes(path)) return "policy";
  if (path === "/cau-hoi-thuong-gap") return "faq";
  if (path === "/quantri" || path.startsWith("/quantri/")) return isAdminPortalPath(path) ? "admin" : "notFound";
  if (path === "/" || path === "/index.html") {
    // Older deployments sent authentication failures to the home page.
    return new URLSearchParams(search).has("authError") ? "login" : "landing";
  }
  if (path === "/login") return "login";
  // The student portal, and the address Microsoft sign-in returns to (it leaves for the return address).
  return path === "/dashboard" || path === "/auth/callback" ? "authenticated" : "notFound";
}

/** Whether Không tìm thấy trang is about an address under /quantri, so it offers the admin portal. */
export const isAdminArea = (pathname: string) => pathname === "/quantri" || pathname.startsWith("/quantri/");

export function safeReturnTo(search: string): string {
  const fallback = "/dashboard";
  const value = new URLSearchParams(search).get("returnTo");
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const base = "https://edupath.local";
    const target = new URL(value, base);
    // Only known application destinations are allowed.
    // Returning to /login or /auth/callback would create a redirect loop.
    if (target.origin !== base || !["/dashboard", "/quantri"].includes(target.pathname)) {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
