import CareersManagement from "./CareersManagement";
import CareerFieldsManagement from "./CareerFieldsManagement";
import CareerSkillsManagement from "./CareerSkillsManagement";
import GraduationManagement from "./GraduationManagement";
import { useEffect, useRef, useState } from "react";
import EduPathBrand from "./EduPathBrand";
import { layoutHeight } from "./page-scale";
import { canManageAdmin, canManageAdvisors, type AuthenticatedUser } from "./types";
import { Icon, roleLabels } from "./admin-account-shared";
import AccountsManagement from "./AccountsManagement";
import StudentProfiles from "./StudentProfiles";
import CurriculaManagement from "./CurriculaManagement";
import PlansManagement from "./PlansManagement";
import CompetencyManagement from "./CompetencyManagement";
import AnnouncementsManagement from "./AnnouncementsManagement";
import AdminReports from "./AdminReports";
import AdvisorsManagement from "./AdvisorsManagement";
import AdvisorPortal from "./AdvisorPortal";
import { ADVISOR_PORTAL_API, type AdvisorMe } from "./advisor-types";
import { ADVISOR_STUDENTS_PATH, ADVISORS_PATH, adminGroupOf, adminPageTitle, adminSidebarFor, advisorRefusedText, isReportPath, refusedAdminPage, resolveAdminPage, toggleAdminGroup, type AdminAccess, type AdminPage } from "./admin-navigation";
import { nameInitials, personIdentity } from "./person-name";
import "./admin-workspace.css";

export default function AdminWorkspace({ user, busy, error, onLogout }: { user: AuthenticatedUser; busy: boolean; error: string | null; onLogout: () => void }) {
  // Cố vấn học tập only reads the admin portal (function list 2026-11-03: the "Quản trị viên" rows are the changes).
  const canManage = canManageAdmin(user.role);
  /** Whether the account advises classes (Quản lý sinh viên): always for the role advisor, else GET advisor-portal/me; null until then. */
  const [advisesClasses, setAdvisesClasses] = useState<boolean | null>(user.role === "advisor" ? true : null);
  /** Quản lý sinh viên shows every student to the admins and Ban chủ nhiệm khoa, the advisor's classes to anyone else (GET me). */
  const [studentScope, setStudentScope] = useState<AdvisorMe["scope"]>(canManageAdvisors(user.role) ? "all" : "own");
  const access: AdminAccess = { role: user.role, advisesClasses };
  const [menuOpen, setMenuOpen] = useState(false);
  const [path, setPath] = useState(() => window.location.pathname);
  // A page of the Quản trị viên whose address a cố vấn học tập opened (typed, bookmarked, an old link): the portal shows
  // Quản lý sinh viên and says why (user, 2026-11-04: only the functions of the CVHT rows), until the next page.
  const [refused, setRefused] = useState(() => refusedAdminPage(window.location.pathname, access));
  /** The one open group, or null when the admin closed it (user, 2026-10-28: opening one group closes the other). */
  const [openGroup, setOpenGroup] = useState(() => adminGroupOf(window.location.pathname, access));
  useEffect(() => {
    if (user.role === "advisor") return;
    const controller = new AbortController();
    fetch(`${ADVISOR_PORTAL_API}/me`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<AdvisorMe> : null))
      .then((me) => {
        if (controller.signal.aborted) return;
        setAdvisesClasses(Boolean(me && me.classes > 0));
        if (me?.scope === "all" || me?.scope === "own") setStudentScope(me.scope);
      },
        () => { if (!controller.signal.aborted) setAdvisesClasses(false); });
    return () => controller.abort();
  }, [user.role]);
  const heading = useRef<HTMLHeadingElement>(null);
  const header = useRef<HTMLElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!header.current) return;
    const syncHeight = () => shell.current?.style.setProperty("--am-header-height", `${header.current ? layoutHeight(header.current) : 80}px`);
    const observer = new ResizeObserver(syncHeight);
    observer.observe(header.current);
    syncHeight();
    return () => observer.disconnect();
  }, []);
  const current = resolveAdminPage(path, access);
  // The header names the person as the student portal does (QA 2026-11-04): "2374802010145 - Đào Văn Hòa - 71K29CNTT08"
  // shows "Đào Văn Hòa", the avatar "VH" and the MSSV beside the role; the advisor banner and Nhật ký use the same name.
  const identity = personIdentity(user.name);
  const initials = nameInitials(identity.name);
  const navigate = (nextPath: string) => {
    // The report pages share their filters through the address bar: going from one report to another keeps them.
    const target = isReportPath(nextPath) && isReportPath(window.location.pathname) && !nextPath.includes("?") ? `${nextPath}${window.location.search}` : nextPath;
    if (`${window.location.pathname}${window.location.search}` !== target) window.history.pushState({}, "", target);
    setPath(target.split("?")[0]!);
    setRefused(refusedAdminPage(target.split("?")[0]!, access));
    setMenuOpen(false);
  };
  useEffect(() => {
    const onPopState = () => {
      setPath(window.location.pathname);
      setRefused(refusedAdminPage(window.location.pathname, { role: user.role, advisesClasses: null }));
      setMenuOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [user.role]);
  useEffect(() => {
    // Showing a page (link, back button) opens its group and closes the other; a page outside the groups closes both.
    setOpenGroup(adminGroupOf(current.path));
  }, [current]);
  useEffect(() => {
    document.title = `${adminPageTitle(current)} · EduPath AI`;
    if (window.location.pathname !== current.path) window.history.replaceState({}, "", current.path);
    heading.current?.focus();
  }, [current]);
  // The eyebrow and the title of the page. The pages of the Tổng quan group draw them themselves (AdminReports), so their
  // filters and "Cách tính" sit on the title's row (2026-11-22); the title is still the element focused on a page change.
  const onReport = isReportPath(current.path);
  const pageHeading = <><p className="admin-eyebrow">{current.eyebrow}</p><h1 ref={heading} tabIndex={-1}>{adminPageTitle(current)}</h1></>;
  const pageLink = (page: AdminPage) => <a key={page.path} href={page.path} aria-current={current.path === page.path ? "page" : undefined} onClick={(event) => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(page.path); } }}><Icon name={page.icon} /><span>{page.label}</span></a>;
  return <div ref={shell} className="admin-shell am-shell">
    <aside className={`am-sidebar${menuOpen ? " am-sidebar-open" : ""}`}>
      <div className="am-sidebar-brand"><EduPathBrand /></div>
      <p className="am-nav-label">QUẢN TRỊ HỆ THỐNG</p>
      <nav id="admin-navigation" aria-label="Danh mục quản trị">{adminSidebarFor(access).map((entry) => {
        if (entry.kind === "page") return pageLink(entry.page);
        const holdsCurrent = entry.pages.some((page) => page.path === current.path);
        const open = openGroup === entry.id;
        return <div key={entry.id} className="am-nav-group">
          <button type="button" className={`am-nav-group-toggle${holdsCurrent ? " am-nav-group-current" : ""}`} aria-expanded={open} aria-controls={`admin-navigation-${entry.id}`}
            onClick={() => setOpenGroup((previous) => toggleAdminGroup(previous, entry.id))}><Icon name={entry.icon} /><span>{entry.label}</span><Icon name="chevronDown" className="am-nav-chevron" /></button>
          <div id={`admin-navigation-${entry.id}`} className="am-nav-sub" hidden={!open}>{entry.pages.map(pageLink)}</div>
        </div>;
      })}</nav>
      <div className="am-sidebar-footer"><span>VAN LANG UNIVERSITY</span><p>Khoa Công nghệ Thông tin</p><small>Học tập có định hướng.</small></div>
    </aside>
    <div className="am-main"><header ref={header} className="am-topbar"><div><button className="am-menu-toggle am-outline" aria-controls="admin-navigation" aria-expanded={menuOpen} aria-label="Đóng mở danh mục quản trị" onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu" /></button><span>Quản trị / <strong>{adminPageTitle(current)}</strong></span></div><div className="am-topbar-user"><span className="am-avatar" aria-hidden="true">{initials || <Icon name="user" />}</span><div><strong>{identity.name || user.email || user.username || "Tài khoản quản trị"}</strong><small>{roleLabels[user.role]}{identity.code ? ` · ${identity.code}` : ""}</small></div><button className="am-logout" disabled={busy} onClick={onLogout}><Icon name="exit" /><span>{busy ? "Đang đăng xuất…" : "Đăng xuất"}</span></button></div></header>
      <main className="am-content">{!onReport && <div className="am-page-heading"><div>{pageHeading}</div></div>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        {refused && <p className="admin-error am-refused" role="alert">{advisorRefusedText(refused)}</p>}
        {onReport ? <AdminReports path={current.path} navigate={navigate} heading={pageHeading} /> : current.path === "/quantri/gui-thong-bao" ? <AnnouncementsManagement key="compose" canManage={canManage} section="compose" navigate={navigate} /> : current.path === "/quantri/thong-bao-da-gui" ? <AnnouncementsManagement key="sent" canManage={canManage} section="sent" navigate={navigate} /> : current.path === "/quantri/cai-dat-thong-bao" ? <AnnouncementsManagement key="settings" canManage={canManage} section="settings" navigate={navigate} /> : current.path === "/quantri/nhom-nang-luc" ? <CompetencyManagement key="groups" canManage={canManage} section="groups" /> : current.path === "/quantri/cau-hinh-nang-luc" ? <CompetencyManagement key="profiles" canManage={canManage} section="profiles" /> : current.path === "/quantri/cau-hinh-mon-hoc" ? <CompetencyManagement key="courses" canManage={canManage} section="courses" /> : current.path === "/quantri/ky-nang" ? <CareerSkillsManagement canManage={canManage} /> : current.path === "/quantri/linh-vuc-nghe-nghiep" ? <CareerFieldsManagement canManage={canManage} /> : current.path === "/quantri/vi-tri-nghe-nghiep" ? <CareersManagement canManage={canManage} /> : current.path === "/quantri/tieu-chuan-tot-nghiep" ? <GraduationManagement canManage={canManage} /> : current.path === "/quantri/ke-hoach" ? <PlansManagement canManage={canManage} /> : current.path === "/quantri/chuong-trinh" ? <CurriculaManagement canManage={canManage} /> : current.path === "/quantri/sinh-vien" ? <StudentProfiles /> : current.path === ADVISORS_PATH ? <AdvisorsManagement canManage={canManageAdvisors(user.role)} /> : current.path === ADVISOR_STUDENTS_PATH ? <AdvisorPortal scope={studentScope} /> : <AccountsManagement actorId={user.userId} canManage={canManage} canAssignRoles={user.role === "admin"} />}
      </main><footer className="am-footer">© 2026 · Bản quyền thuộc Khoa Công nghệ Thông tin · Trường Đại học Văn Lang.</footer>
    </div>
  </div>;
}
