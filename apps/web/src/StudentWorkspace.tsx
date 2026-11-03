import StudentPlans from "./StudentPlans";
import StudentGraduation from "./StudentGraduation";
import { Suspense, lazy, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import EduPathBrand from "./EduPathBrand";
import { layoutHeight } from "./page-scale";
import StudentProfileEditor from "./StudentProfileEditor";
import StudentProfileSurvey from "./StudentProfileSurvey";
import StudentTranscript from "./StudentTranscript";
import StudentCurriculum from "./StudentCurriculum";
import StudentOverview, { requiredProfileItems, revealProfileSection, type StudentProfile } from "./StudentOverview";
import { profileSectionOf } from "./student-overview-data";
import { majorLabel } from "./majors";
import { logout } from "./auth-api";
import { publicInformationLinks, supportEmail } from "./public-information";
import { Icon } from "./student-icons";
import { NotificationsDrawer, NotificationsPanel, NOTIFICATION_RECOUNT_MS, badgeText, bellLabel, useUnreadNotifications, type NotificationFilter } from "./StudentNotifications";
import type { StudentNotification } from "./notification-types";
import type { AuthenticatedUser } from "./types";
import { ADVISOR_BLOCKED_EVENT, ADVISOR_HOME, actingAsText, advisorBlockedMessage, stopActing } from "./advisor-view";
import { ADVISOR_ERRORS } from "./advisor-types";
import "./student-workspace.css";
import "./student-header.css";
import "./student-layout.css";
import "./advisor-view.css";

// The competency module is large and only needed on #competency and #skill-gap, so it loads on demand.
const StudentCompetency = lazy(() => import("./StudentCompetency"));
const StudentRoadmap = lazy(() => import("./StudentRoadmap"));
const StudentCareerGuidance = lazy(() => import("./StudentCareerGuidance"));
const StudentAssistant = lazy(() => import("./StudentAssistant"));

const pages = [
  { id: "overview", label: "Tổng quan", icon: "home" },
  { id: "profile", label: "Hồ sơ và bảng điểm", icon: "user" },
  { id: "competency", label: "Đánh giá năng lực", icon: "chart" },
  { id: "skill-gap", label: "Khoảng trống kỹ năng", icon: "target" },
  { id: "career", label: "Định hướng nghề nghiệp", icon: "compass" },
  { id: "roadmap", label: "Lộ trình học tập", icon: "route" },
  { id: "curriculum", label: "Chương trình đào tạo", icon: "book" },
  { id: "plans", label: "Kế hoạch đào tạo", icon: "clock" },
  { id: "graduation", label: "Xét tốt nghiệp", icon: "shield" },
  { id: "assistant", label: "Trợ lý AI", icon: "spark" }
] as const;
export type StudentPage = typeof pages[number]["id"];
type Page = StudentPage;
// The main nav carries the core journey, Điều kiện xét tốt nghiệp just before Trợ lý AI (user, 2026-10-25: moved out of
// the account menu, then ahead of Trợ lý AI); profile, curriculum and plans live in the account menu.
const navPageIds = new Set<Page>(["overview", "competency", "skill-gap", "career", "roadmap", "assistant", "graduation"]);
const navPages = pages.filter(p => navPageIds.has(p.id));
const accountPages = pages.filter(p => !navPageIds.has(p.id));
// Below 1520px (pages at 100%, styles.css) the header nav does not fit: the drawer is the menu and overlays the page.
const overlayDrawerQuery = "(max-width: 1519.98px)";
type Profile = StudentProfile;
type Panel = "notifications" | "help" | "account";
type ShellError = { kind: "session" | "profile" | "logout"; message: string };
const sessionExpired: ShellError = { kind: "session", message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." };
const profileFailed: ShellError = { kind: "profile", message: "Chưa tải được hồ sơ của bạn." };
const advisorForbidden: ShellError = { kind: "profile", message: ADVISOR_ERRORS.advisor_student_forbidden! };

/** The page a URL hash opens: the overview for an empty hash, null for a hash that names no page. */
export function pageFromHash(hash: string): Page | null {
  const id = hash.replace(/^#/, "");
  return id ? pages.find(p => p.id === id)?.id ?? null : "overview";
}

/**
 * The name to show. Microsoft gives students the display name "MSSV - Họ tên - Lớp"
 * (e.g. "2174802010992 - Nguyễn Văn An - 71K27CNTT01"); only the name part is shown.
 */
export function studentDisplayName(raw: string): string {
  const name = raw.trim();
  const parts = name.split(/\s+[-–]\s+/).filter(Boolean);
  if (parts.length >= 3) return parts.slice(1, -1).join(" - ");
  if (parts.length === 2) return /^\d+$/.test(parts[0]) ? parts[1] : /^\d{2}K\d{2}/i.test(parts[1]) ? parts[0] : name;
  return name;
}

/**
 * Up to two initials, from the last two words that start with a capital letter (any letter when none does), so a
 * student code, a class code or a stray "-" never shows up: "Sinh viên Thử nghiệm K27" gives "TK".
 */
export function nameInitials(name: string): string {
  const words = name.normalize("NFC").split(/\s+/).filter(word => /^\p{L}/u.test(word));
  const capitalised = words.filter(word => /^\p{Lu}/u.test(word));
  return (capitalised.length > 0 ? capitalised : words).slice(-2).map(word => word[0]).join("").toLocaleUpperCase("vi");
}

// "?" help: one short step per page, in the order a new student needs them.
const helpSteps: [string, string][] = [
  ["Hồ sơ và bảng điểm", "Import bảng điểm, chọn chuyên ngành và làm Khảo sát định hướng."],
  ["Định hướng nghề nghiệp", "xem các vị trí nghề nghiệp hợp với bạn và chọn vị trí nghề nghiệp mục tiêu."],
  ["Đánh giá năng lực", "bấm Đánh giá năng lực để xem điểm theo nhóm năng lực và mức thành thạo từng kỹ năng."],
  ["Khoảng trống kỹ năng", "xem kỹ năng còn thiếu so với vị trí nghề nghiệp mục tiêu và học phần nên học."],
  ["Lộ trình học tập", "theo dõi tiến độ, nhờ EduPath AI soạn lộ trình cho học kỳ tới và lên kế hoạch các học kỳ."],
  ["Xét tốt nghiệp", "đối chiếu kết quả học tập của bạn với các điều kiện xét tốt nghiệp và đọc lời khuyên của EduPath AI."],
  ["Trợ lý AI", "hỏi về kỹ năng còn thiếu, lộ trình học tập, nghề nghiệp và tài liệu tự học."],
  ["Chương trình đào tạo và Kế hoạch đào tạo", "tra cứu học phần và kế hoạch từng học kỳ (trong menu tài khoản)."]
];

/**
 * The strip a cố vấn học tập or a Khoa admin sees under the header in a student's page (AD-AST-05…08, policy 2026-11-03):
 * whose page it is, as whom (role: the signed-in account's, actingAsText), what may be done there, the way out, and why
 * the API refused something.
 */
export function AdvisorViewBanner({ advisorName, role = "advisor", studentName, studentCode, className, blocked, onClose }: {
  advisorName: string; role?: string; studentName: string; studentCode?: string | null; className?: string | null; blocked: string; onClose: () => void;
}) {
  const who = [studentName, studentCode, className ? `lớp ${className}` : null].filter(Boolean).join(" · ");
  return <div className="sw-advisor-banner" role="region" aria-label="Chế độ làm việc với trang sinh viên">
    <div className="sw-advisor-banner-inner">
      <span className="sw-advisor-icon" aria-hidden="true"><Icon name="shield" /></span>
      <p className="sw-advisor-text">
        <strong>Bạn đang xem trang của {who} với tư cách {actingAsText(role)}{advisorName ? ` (${advisorName})` : ""}.</strong>{" "}
        Bạn làm thay được: import bảng điểm, Đánh giá năng lực, Lộ trình AI, lời khuyên xét tốt nghiệp và Trợ lý AI. Mỗi việc làm thay được ghi lại và báo cho sinh viên.
      </p>
      <button type="button" className="sw-outline sw-advisor-close" onClick={onClose}><Icon name="close" />Đóng trang sinh viên</button>
    </div>
    {blocked && <p className="sw-advisor-blocked" role="alert">{blocked}</p>}
  </div>;
}

/**
 * advisor: set when a cố vấn học tập or a Khoa admin opened this student's page from Quản lý sinh viên (App.tsx,
 * advisor-view.ts); user is then that account and the page shows the student of GET /api/student/profile.
 */
export default function StudentWorkspace({ user, advisor = null }: { user: AuthenticatedUser; advisor?: { name: string; role?: string } | null }) {
  const [page, setPage] = useState<Page>(() => pageFromHash(window.location.hash) ?? "overview");
  // The page on screen, for the hashchange listener (which outlives renders).
  const pageRef = useRef(page);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const resize = new ResizeObserver(() => {
      header.closest<HTMLElement>(".sw-shell")?.style.setProperty("--sw-header-height", `${layoutHeight(header)}px`);
    });
    resize.observe(header);
    return () => resize.disconnect();
  }, []);
  const navigationButton = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  // What opened the current panel: focus goes back there when the panel is closed with Esc or Đóng.
  const panelOpener = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openPanel = (next: Panel, opener: HTMLElement | null) => { panelOpener.current = opener; setPanel(next); };
  const closePanel = (restoreFocus: boolean) => { setPanel(null); if (restoreFocus) panelOpener.current?.focus(); };
  // Thông báo (2026-10-30): the bell's unread count, and the drawer of every notification (opened from the popover).
  // The bell belongs to the student: an advisor's tab does not read it.
  const notifications = useUnreadNotifications(!advisor);
  const bellRef = useRef<HTMLButtonElement>(null);
  const [notificationDrawer, setNotificationDrawer] = useState<{ initial: StudentNotification | null; filter?: NotificationFilter } | null>(null);
  const openNotifications = (initial: StudentNotification | null, filter?: NotificationFilter) => { setPanel(null); setNotificationDrawer({ initial, filter }); };
  const closeNotifications = () => { setNotificationDrawer(null); bellRef.current?.focus(); };
  // Opening a page can write notifications (Tổng quan notifies its new warnings once read): count again shortly after.
  const refreshNotifications = notifications.refresh;
  useEffect(() => {
    const timer = setTimeout(refreshNotifications, NOTIFICATION_RECOUNT_MS);
    return () => clearTimeout(timer);
  }, [page, refreshNotifications]);
  useEffect(() => {
    if (!panel && !menu) return;
    // A click outside closes the open panel; a click on its own trigger is left to the trigger, which toggles it.
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      const outside = panel === "account" ? !accountRef.current?.contains(target)
        : panel !== null && !popoverRef.current?.contains(target) && !panelOpener.current?.contains(target);
      if (outside) setPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel) closePanel(true);
      else if (menu) { setMenu(false); navigationButton.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [panel, menu]);
  // The help and notification panels take focus when they open, so screen readers read them.
  useEffect(() => {
    if (panel === "help" || panel === "notifications") popoverRef.current?.focus({ preventScroll: true });
  }, [panel]);
  // The drawer overlays the page below the desktop width: opening it moves focus to its first link.
  useEffect(() => {
    if (menu && window.matchMedia(overlayDrawerQuery).matches) drawerRef.current?.querySelector<HTMLElement>("nav a")?.focus();
  }, [menu]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ShellError | null>(null);
  const [reload, setReload] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  // The last refusal of the API in an advisor's tab (advisor-view.ts), shown in the banner.
  const [advisorBlocked, setAdvisorBlocked] = useState("");
  useEffect(() => {
    if (!advisor) return;
    const refused = (event: Event) => setAdvisorBlocked(advisorBlockedMessage(String((event as CustomEvent<string>).detail ?? "")));
    window.addEventListener(ADVISOR_BLOCKED_EVENT, refused);
    return () => window.removeEventListener(ADVISOR_BLOCKED_EVENT, refused);
  }, [advisor]);
  // A refusal is about the page it happened on.
  useEffect(() => setAdvisorBlocked(""), [page]);
  // Every page change starts at the top of the new page. The scroll happens right away, inside the click or the
  // hashchange, so a page that scrolls somewhere on purpose afterwards (e.g. to the transcript) wins.
  const showNewPage = (id: Page) => {
    pageRef.current = id;
    setPage(id);
    setPanel(null);
    if (window.matchMedia(overlayDrawerQuery).matches) setMenu(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    setFocusRequest(n => n + 1);
  };
  useEffect(() => {
    // A reload with a hash that names no page opens the overview, and the address says so.
    if (pageFromHash(window.location.hash) === null) window.history.replaceState(window.history.state, "", "#overview");
    // Back and forward open a page like any other page change, at its top: the browser would otherwise put back the old
    // scroll position after the page has been shown.
    const restoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const update = () => {
      setPanel(null);
      const next = pageFromHash(window.location.hash);
      // Not a page (e.g. an in-page anchor): keep the page shown and put its hash back, so a reload opens it again.
      if (next === null) { window.history.replaceState(window.history.state, "", `#${pageRef.current}`); return; }
      // navigate() has already shown the page whose hash it set.
      if (next !== pageRef.current) showNewPage(next);
    };
    window.addEventListener("hashchange", update);
    return () => { window.removeEventListener("hashchange", update); window.history.scrollRestoration = restoration; };
  }, []);
  // After a page change, focus moves to the new heading for screen readers, unless the new page has already put focus
  // inside its own content on purpose.
  useEffect(() => {
    if (!focusRequest) return;
    const active = document.activeElement;
    if (active && active !== mainRef.current && mainRef.current?.contains(active)) return;
    headingRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch("/api/student/profile", { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok) { if (!controller.signal.aborted) setError(response.status === 401 ? sessionExpired : response.status === 403 && advisor ? advisorForbidden : profileFailed); return; }
        const data = await response.json() as { student: Profile };
        if (!controller.signal.aborted) setProfile(data.student);
      })
      .catch(() => { if (!controller.signal.aborted) setError(profileFailed); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  // Quietly read the profile again on every page change, so the reminder below follows a transcript or survey just saved.
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) { firstPage.current = false; return; }
    const controller = new AbortController();
    fetch("/api/student/profile", { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (controller.signal.aborted) return;
        if (response.status === 401) { setError(sessionExpired); return; }
        if (!response.ok) return;
        const data = await response.json() as { student: Profile };
        if (!controller.signal.aborted) setProfile(data.student);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [page]);
  // The student pages announce a 401 with this event (the admin portal listens for it too).
  useEffect(() => {
    const expired = () => setError(sessionExpired);
    window.addEventListener("edupath-session-expired", expired);
    return () => window.removeEventListener("edupath-session-expired", expired);
  }, []);
  const selected = pages.find(p => p.id === page)!;
  // In an advisor's tab the account is the advisor's: the student's name comes from the profile only.
  const name = studentDisplayName(profile?.name ?? (advisor ? "" : user.name)) || "Sinh viên";
  useEffect(() => { document.title = advisor ? `${selected.label} · ${name} · EduPath AI` : `${selected.label} · EduPath AI`; }, [selected.label, advisor, name]);
  // A neutral avatar until the profile answers, then initials (from the account name if the profile cannot be read).
  const initials = loading && !profile ? "" : nameInitials(name);
  const avatar = initials || <Icon name="user" />;
  const email = profile?.email ?? (advisor ? null : user.email);
  const navigate = (id: Page) => {
    // The hashchange that follows finds the page already shown and leaves it alone.
    window.location.hash = id;
    showNewPage(id);
  };
  // Page links navigate in place; a modified click still opens a new tab or window.
  const followLink = (id: Page) => (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(id);
  };
  // "Đóng trang sinh viên": the tab Quản lý sinh viên opened closes; one opened by hand goes back to Quản lý sinh viên.
  const closeAdvisorView = () => {
    stopActing();
    window.close();
    window.setTimeout(() => window.location.assign(ADVISOR_HOME), 300);
  };
  const exit = async () => {
    setLoggingOut(true);
    setError(current => current?.kind === "logout" ? null : current);
    try { await logout(); }
    catch { setError({ kind: "logout", message: "Đăng xuất chưa thành công. Vui lòng thử lại." }); setLoggingOut(false); }
  };
  // "Hồ sơ của bạn chưa đầy đủ" (user 2026-10-24: not at the top of the page, "để trên xấu quá"): under the result panel
  // of Đánh giá năng lực / Khoảng trống kỹ năng, under the tabs of Lộ trình học tập, under the heading elsewhere.
  // Wording by the user (2026-10-24), followed by the items still missing.
  const missingItems = profile ? requiredProfileItems(profile, profile.hasTranscript === true).filter((item) => !item.done) : [];
  const reminder = profile && profile.profileStatus !== "complete" ? <div className="sw-profile-reminder" role="note">
    <Icon name="shield" />
    <div className="sw-profile-reminder-body">
      <p>Bạn vui lòng cung cấp đầy đủ các mục thông tin dưới đây để kết quả đánh giá được chính xác. Nếu có sự thay đổi, bạn có thể điều chỉnh lại các thông tin này trong tương lai.</p>
      {missingItems.length > 0 && <ul className="sw-profile-missing" aria-label="Mục còn thiếu">{missingItems.map((item) => <li key={item.id}>{item.label}</li>)}</ul>}
    </div>
    <button className="sw-outline" onClick={() => {
      const section = missingItems[0] && profileSectionOf(missingItems[0].id);
      navigate("profile");
      if (section) revealProfileSection(section);
    }}>Hoàn thành hồ sơ</button>
  </div> : null;
  const fields = { "Mã sinh viên": profile?.studentCode, "Ngành": majorLabel(profile?.majorCode), "Khóa học": profile?.cohortCode, "Lớp học": profile?.className, "Năm nhập học": profile?.cohortYear, "Email": email };
  const profileCard = <section className="sw-panel sw-profile"><div className="sw-section-heading"><h2>Thông tin học tập</h2><span className="sw-tag">Hồ sơ của bạn</span></div><div className="sw-profile-intro"><span className="sw-avatar sw-avatar-large">{avatar}</span><div><h3>{name}</h3><p>{email ?? "Chưa cập nhật email"}</p></div></div><dl className="sw-fields">{Object.entries(fields).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{loading ? "Đang tải…" : value ?? "Chưa cập nhật"}</dd></div>)}</dl></section>;
  const popoverOpen = panel === "help" || panel === "notifications";
  return <div className="sw-shell">
    <a className="sw-skip" href="#student-main" onClick={event => { event.preventDefault(); mainRef.current?.focus(); }}>Chuyển đến nội dung chính</a>
    <div className="sw-workspace">
      <header ref={headerRef} className="sw-topbar">
        <button ref={navigationButton} type="button" className="sw-icon-button sw-menu-button" aria-label={menu ? "Ẩn menu bên trái" : "Hiện menu bên trái"} aria-controls={menu ? "student-sidebar" : undefined} aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="menu" /></button>
        <div className="sw-header-brand"><EduPathBrand href="/dashboard" /></div>
        <nav id="student-navigation" className="sw-header-nav" aria-label="Điều hướng sinh viên">{navPages.map(p => <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined} onClick={followLink(p.id)}><span>{p.label}</span></a>)}</nav>
        <div className="sw-tools">
          <button type="button" className="sw-icon-button" aria-label="Hướng dẫn" aria-haspopup="dialog" aria-expanded={panel === "help"} aria-controls={panel === "help" ? "student-help-panel" : undefined} onClick={event => panel === "help" ? closePanel(true) : openPanel("help", event.currentTarget)}><Icon name="help" /></button>
          {!advisor && <button ref={bellRef} type="button" className="sw-icon-button sw-bell" aria-label={bellLabel(notifications.unread)} aria-haspopup="dialog" aria-expanded={panel === "notifications"} aria-controls={panel === "notifications" ? "student-notifications-panel" : undefined} onClick={event => panel === "notifications" ? closePanel(true) : openPanel("notifications", event.currentTarget)}><Icon name="bell" />{notifications.unread > 0 && <span className="sw-bell-badge" aria-hidden="true">{badgeText(notifications.unread)}</span>}</button>}
          <div className="sw-account" ref={accountRef} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPanel(p => p === "account" ? null : p); }}>
            {/* The ring marks the avatar while the page on screen is one of its menu items. */}
            <button ref={accountButton} type="button" className={`sw-avatar${accountPages.some(p => p.id === page) ? " sw-avatar-here" : ""}`} aria-label={`Tài khoản ${name}`} aria-expanded={panel === "account"} aria-controls={panel === "account" ? "student-account-menu" : undefined} onClick={event => panel === "account" ? setPanel(null) : openPanel("account", event.currentTarget)}>{avatar}</button>
            {panel === "account" && <div id="student-account-menu" className="sw-account-dropdown">
              <strong>{name}</strong><span>{email}</span>
              {accountPages.map(p => <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined} onClick={followLink(p.id)}><Icon name={p.icon} />{p.label}</a>)}
              {/* Phones hide the "?" button in the header, so the help is offered here instead. */}
              <button type="button" className="sw-account-help" onClick={() => openPanel("help", accountButton.current)}><Icon name="help" />Hướng dẫn</button>
              {advisor
                ? <button type="button" onClick={closeAdvisorView}><Icon name="close" />Đóng trang sinh viên</button>
                : <button type="button" disabled={loggingOut} onClick={() => void exit()}><Icon name="logout" />{loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}</button>}
            </div>}
          </div>
        </div>
        {popoverOpen && <section ref={popoverRef} id={panel === "help" ? "student-help-panel" : "student-notifications-panel"} className="sw-popover" role="dialog" aria-labelledby={panel === "help" ? "student-help-title" : "student-notifications-title"} tabIndex={-1}>
          <button type="button" className="sw-icon-button sw-popover-close" onClick={() => closePanel(true)} aria-label="Đóng" title="Đóng"><Icon name="close" /></button>
          {panel === "help" ? <>
            <h3 id="student-help-title">Bắt đầu với EduPath AI</h3>
            <ol className="sw-help-steps">{helpSteps.map(([where, what]) => <li key={where}><strong>{where}</strong>: {what}</li>)}</ol>
          </> : <NotificationsPanel onOpen={openNotifications} onOpenAll={filter => openNotifications(null, filter)} onUnread={notifications.setUnread} />}
        </section>}
      </header>
      {advisor && <AdvisorViewBanner advisorName={advisor.name} role={advisor.role ?? "advisor"} studentName={name} studentCode={profile?.studentCode} className={profile?.className}
        blocked={advisorBlocked} onClose={closeAdvisorView} />}
      <div className={`sw-body ${menu ? "sw-body-menu-open" : ""}`}>
        {menu && <button className="sw-drawer-backdrop" aria-label="Đóng menu bên trái" tabIndex={-1} onClick={() => { setMenu(false); navigationButton.current?.focus(); }} />}
        {menu && <aside ref={drawerRef} id="student-sidebar" className="sw-drawer" aria-label="Menu bên trái"><div className="sw-drawer-heading"><strong>Danh mục học tập</strong></div><nav aria-label="Danh mục bên trái">{pages.map(p => <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined} onClick={followLink(p.id)}>{p.label}</a>)}<a href="/">Về trang giới thiệu</a></nav><p>Hiểu năng lực.<br /><strong>Chủ động tương lai.</strong></p></aside>}
        <div className="sw-body-content"><main ref={mainRef} className="sw-main" id="student-main" tabIndex={-1}>
          {error && <div className="sw-error" role="alert">
            <span>{error.message}</span>
            {error.kind === "session"
              ? advisor ? <a href="/quantri">Mở trang quản trị</a> : <a href={`/login?returnTo=/dashboard%23${page}`}>Đăng nhập lại</a>
              : <button type="button" onClick={error.kind === "logout" ? () => void exit() : () => setReload(n => n + 1)}>Thử lại</button>}
          </div>}
          <div className="sw-page-heading">
            <div><p className="sw-eyebrow">CỔNG QUẢN LÝ HỌC TẬP</p><h1 ref={headingRef} tabIndex={-1}>{selected.label}</h1><p>{page === "overview" ? `Xin chào, ${name}. Cùng tiếp tục hành trình của bạn nhé.` : page === "profile" ? "Thông tin cá nhân và kết quả học tập của bạn, tại một nơi." : page === "plans" ? "Xem các học phần dự kiến theo năm học và học kỳ." : page === "roadmap" ? "Theo dõi tiến độ theo yêu cầu của chương trình, rồi tự lên kế hoạch các học kỳ tới hoặc để EduPath AI soạn lộ trình cho học kỳ tới." : page === "graduation" ? "Đối chiếu bảng điểm với tiêu chuẩn xét tốt nghiệp của khóa và chuyên ngành của bạn." : page === "curriculum" ? "Tra cứu học phần, tín chỉ và điều kiện học theo chương trình đào tạo." : page === "competency" ? "Điểm theo nhóm năng lực, mức thành thạo từng kỹ năng, tiến độ học tập và xét tốt nghiệp, tính từ bảng điểm của bạn." : page === "skill-gap" ? "So sánh năng lực của bạn với yêu cầu của vị trí nghề nghiệp mục tiêu: kỹ năng còn thiếu, mức thiếu hụt, học phần nên học và kỹ năng cần tự học." : page === "career" ? "Gợi ý vị trí nghề nghiệp phù hợp với năng lực và sở thích của bạn, so sánh các vị trí nghề nghiệp và chọn vị trí nghề nghiệp mục tiêu." : page === "assistant" ? "Hỏi EduPath AI về kỹ năng còn thiếu, lộ trình học tập, nghề nghiệp và tài liệu tự học, dựa trên hồ sơ của bạn." : "Khám phá bước tiếp theo trên hành trình học tập của bạn."}</p></div>
            {page === "overview" && <button className="sw-outline" onClick={() => navigate("profile")}>Xem Hồ sơ và bảng điểm <Icon name="arrow" /></button>}
          </div>
          {/* Not on Trợ lý AI either: the chat fills the window under the heading. */}
          {!["overview", "profile", "competency", "skill-gap", "roadmap", "assistant"].includes(page) && reminder}
          {page === "overview" ? <StudentOverview profile={profile} loading={loading} navigate={navigate} identity={
            <section className="so-student-strip" aria-label="Thông tin sinh viên">
              <div className="so-student-identity"><span className="sw-avatar sw-avatar-large">{avatar}</span><div><strong>{name}</strong><span>{email ?? "Chưa cập nhật email"}</span></div></div>
              <dl><div><dt>Mã sinh viên</dt><dd>{loading ? "Đang tải…" : profile?.studentCode ?? "Chưa cập nhật"}</dd></div><div><dt>Ngành</dt><dd>{loading ? "Đang tải…" : majorLabel(profile?.majorCode) ?? "Chưa cập nhật"}</dd></div><div><dt>Khóa · Lớp</dt><dd>{loading ? "Đang tải…" : [profile?.cohortCode, profile?.className].filter(Boolean).join(" · ") || "Chưa cập nhật"}</dd></div><div><dt>Năm nhập học</dt><dd>{loading ? "Đang tải…" : profile?.cohortYear ?? "Chưa cập nhật"}</dd></div></dl>
            </section>} />
          : page === "profile" ? <div className="sr-profile-layout">{profileCard}{profile && <StudentProfileEditor profile={profile} onSaved={() => setReload(n => n + 1)} />}{profile && <StudentProfileSurvey onSaved={() => setReload(n => n + 1)} />}<StudentTranscript /></div> : page === "curriculum" ? <StudentCurriculum /> : page === "plans" ? <StudentPlans /> : page === "graduation" ? <StudentGraduation /> : page === "roadmap" ? <Suspense fallback={<section className="sw-panel" aria-busy="true"><p role="status">Đang tải lộ trình học tập…</p></section>}><StudentRoadmap notice={reminder} /></Suspense> : page === "career" ? <Suspense fallback={<section className="sw-panel" aria-busy="true"><p role="status">Đang tải định hướng nghề nghiệp…</p></section>}><StudentCareerGuidance onProfileChanged={() => setReload(n => n + 1)} /></Suspense> : page === "competency" || page === "skill-gap" ? <Suspense fallback={<section className="sw-panel" aria-busy="true"><p role="status">{page === "skill-gap" ? "Đang tải trang khoảng trống kỹ năng…" : "Đang tải trang đánh giá năng lực…"}</p></section>}><StudentCompetency key={page} profile={profile} view={page === "skill-gap" ? "gap" : "competency"} notice={reminder} /></Suspense> : page === "assistant" ? <Suspense fallback={<section className="sw-panel" aria-busy="true"><p role="status">Đang tải Trợ lý AI…</p></section>}><StudentAssistant /></Suspense> : null}
          <footer className="sw-footer">
            <nav className="sw-footer-links" aria-label="Liên kết cuối trang">
              {publicInformationLinks.map(link => <a key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}<span className="sr-only"> (mở trong tab mới)</span></a>)}
              <a href={`mailto:${supportEmail}`}>Hỗ trợ: {supportEmail}</a>
            </nav>
            <span>© 2026 · Bản quyền thuộc Khoa Công nghệ Thông tin · Trường Đại học Văn Lang.</span>
          </footer>
        </main></div>
      </div>
    </div>
    {!advisor && notificationDrawer && <NotificationsDrawer initial={notificationDrawer.initial} initialFilter={notificationDrawer.filter} onClose={closeNotifications} onUnread={notifications.setUnread}
      onNavigate={link => { setNotificationDrawer(null); const target = pageFromHash(link); if (target) navigate(target); }} />}
  </div>;
}
