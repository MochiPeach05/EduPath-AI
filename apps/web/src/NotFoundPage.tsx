import { useEffect } from "react";
import PublicFooter, { portalLabel, usePortalLink } from "./PublicFooter";
import { PublicHeader } from "./PublicInformationPage";
import { Icon } from "./ui-icon";
import "./not-found.css";

/** The address as people typed it (Vietnamese letters decoded), shortened when it is very long. */
export function shownAddress(pathname: string): string {
  let path = pathname;
  try { path = decodeURIComponent(pathname); } catch { /* a malformed escape stays as typed */ }
  return path.length > 60 ? `${path.slice(0, 59)}…` : path;
}

/**
 * Không tìm thấy trang (2026-11-04): an address the app does not know (routing.ts), in the look of the public pages,
 * instead of the student portal under a wrong address. Two ways on: the home page, and the portal of the signed-in
 * visitor or Đăng nhập; under /quantri (admin) the admin portal.
 */
export default function NotFoundPage({ admin = false }: { admin?: boolean }) {
  const portal = usePortalLink();
  useEffect(() => { document.title = "Không tìm thấy trang · EduPath AI"; }, []);
  const onward = admin ? { href: "/quantri", label: "Mở trang quản trị" }
    : portal ? { href: portal, label: portalLabel } : { href: "/login", label: "Đăng nhập" };
  return (
    <div className="lp-page pi-page nf-page">
      <a className="lp-skip-link" href="#noi-dung">Chuyển đến nội dung chính</a>
      <PublicHeader portal={portal} />
      <main id="noi-dung" className="nf-main">
        <section className="nf-card" aria-labelledby="not-found-title">
          <p className="nf-code" aria-hidden="true">404</p>
          <h1 id="not-found-title">Không tìm thấy trang</h1>
          <p className="nf-text">
            Địa chỉ <span className="nf-address">{shownAddress(window.location.pathname)}</span> không có trong EduPath{" "}AI.
            Đường dẫn có thể đã cũ hoặc bị gõ nhầm.
          </p>
          <div className="nf-actions">
            <a className="lp-button" href="/">Về trang chủ <Icon name="arrow" /></a>
            <a className="lp-button lp-button-white" href={onward.href}>{onward.label}</a>
          </div>
        </section>
      </main>
      <PublicFooter portal={portal} />
    </div>
  );
}
