import { useEffect, useState } from "react";
import { getCurrentUser } from "./auth-api";
import EduPathBrand from "./EduPathBrand";
import { publicInformationLinks } from "./public-information";
import { canAccessAdmin } from "./types";
import { Icon } from "./ui-icon";

/** The way back for a signed-in visitor of the public pages. */
export const portalLabel = "Quay lại cổng quản lý học tập";

/**
 * The portal of the signed-in visitor ("/dashboard" or "/quantri"), or null when nobody is signed in. Checked again
 * when the page is shown or focused, so the public pages follow a sign-in or sign-out made in another tab.
 */
export function usePortalLink(): string | null {
  const [portal, setPortal] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { void getCurrentUser().then(auth => { if (active) setPortal(auth.authenticated ? canAccessAdmin(auth.user.role) ? "/quantri" : "/dashboard" : null); }).catch(() => { if (active) setPortal(null); }); };
    refresh(); window.addEventListener("pageshow", refresh); window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("pageshow", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  return portal;
}

export default function PublicFooter({ home = false, portal }: { home?: boolean; portal?: string | null }) {
  const homePrefix = home ? "" : "/";
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer-main">
          <div>
            <EduPathBrand href="/" light />
            <p>Hệ thống đánh giá năng lực và tư vấn lộ trình học tập bằng AI cho sinh viên Công nghệ Thông tin.</p>
          </div>
          <nav aria-label="Liên kết cuối trang">
            <h2>Khám phá</h2>
            <a href={`${homePrefix}#gioi-thieu`}>Về EduPath AI</a>
            <a href={`${homePrefix}#tinh-nang`}>Tính năng</a>
            <a href={`${homePrefix}#huong-dan`}>Cách hoạt động</a>
            {publicInformationLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>
          <div className="lp-footer-university">
            <h2>Trường Đại học Văn Lang · Khoa Công nghệ Thông tin</h2>
            <a href="https://www.vlu.edu.vn/" target="_blank" rel="noreferrer">
              Website trường <Icon name="arrowUpRight" />
              <span className="sr-only"> (mở trong tab mới)</span>
            </a>
            <a href={portal ?? "/login"}>
              {portal ? portalLabel : "Đăng nhập hệ thống"} <Icon name="arrow" />
            </a>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>© {new Date().getFullYear()} · Bản quyền thuộc Khoa Công nghệ Thông tin · Trường Đại học Văn Lang.</span>
          <span>AI đồng hành · Học tập bứt phá</span>
          <a href="#noi-dung">Về đầu trang <Icon name="arrowUp" /></a>
        </div>
      </div>
    </footer>
  );
}
