import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnnouncementsManagement, {
  AnnouncementPreview, FALLBACK_OPTIONS, MAIL_CONSENT_API, PORTAL_PAGES, SentTable, emailTestOutcome, majorText, openLabel, pageLabel, reachQuery, reachText, readShare, readText, sentTime, targetText, toggleValue,
} from "./AnnouncementsManagement";
import { useTableSort } from "./table-sort";
import type { Announcement } from "./notification-types";

// Synthetic announcements only.
const sent = (extra: Partial<Announcement> = {}): Announcement => ({
  id: "a1", title: "Khoa cập nhật Kế hoạch đào tạo K29", body: "Bạn bấm Đánh giá lại để cập nhật lộ trình.", link: "#competency",
  target: { cohorts: ["K29"], majors: ["7480201"] }, targetLabel: "K29 · Công nghệ thông tin", recipients: 312, read: 204,
  createdAt: "2026-10-28T01:30:00.000Z", createdBy: "Quản trị viên", withdrawnAt: null, ...extra,
});

describe("announcement texts", () => {
  it("asks the server how many students a choice reaches", () => {
    expect(reachQuery({ cohorts: [], majors: [] })).toBe("");
    expect(reachQuery({ cohorts: ["K29", "K30"], majors: ["7480201"] })).toBe("cohorts=K29%2CK30&majors=7480201");
    expect(toggleValue(["K29"], "K30")).toEqual(["K29", "K30"]);
    expect(toggleValue(["K29", "K30"], "K29")).toEqual(["K30"]);
  });

  it("names the recipients, the reads and the time as the pages print them", () => {
    expect(targetText({ cohorts: [], majors: [] }, FALLBACK_OPTIONS)).toBe("Tất cả sinh viên");
    expect(targetText({ cohorts: ["K29", "K30"], majors: [] }, FALLBACK_OPTIONS)).toBe("K29, K30");
    expect(targetText({ cohorts: ["K29"], majors: ["7480201"] }, FALLBACK_OPTIONS)).toBe("K29 · Công nghệ thông tin");
    expect(readText(sent())).toBe("204/312");
    expect(readShare(sent())).toBe(65);
    expect(readShare(sent({ recipients: 0, read: 0 }))).toBe(0);
    expect(sentTime("2026-10-28T01:30:00.000Z")).toBe("08:30 28/10/2026");
    expect(openLabel("#roadmap")).toBe("Mở Lộ trình học tập");
    expect(openLabel(null)).toBeNull();
    expect(pageLabel("#roadmap")).toBe("Lộ trình học tập");
    expect(pageLabel("#khong-co")).toBeNull();
    expect(PORTAL_PAGES).toHaveLength(10);
  });

  it("names a programme outside the faculty's catalog readably, never by the bare code", () => {
    const options = { cohorts: ["K29"], majors: [{ code: "7480201", name: "Công nghệ thông tin" }, { code: "7340201", name: "Ngành khác (mã 7340201)" }] };
    expect(majorText("7340201", options)).toBe("Ngành khác (mã 7340201)");
    expect(majorText("7340201", FALLBACK_OPTIONS)).toBe("Ngành khác (mã 7340201)");
    expect(majorText("7480104", options)).toBe("Hệ thống thông tin");
    expect(majorText("7340201", { cohorts: [], majors: [{ code: "7340201", name: " " }] })).toBe("Ngành khác (mã 7340201)");
    expect(targetText({ cohorts: ["K29"], majors: ["7480201", "7340201"] }, FALLBACK_OPTIONS)).toBe("K29 · Công nghệ thông tin, Ngành khác (mã 7340201)");
  });

  it("says what the count means, refusing a choice that reaches nobody", () => {
    expect(reachText(null, false)).toEqual({ text: "Đang đếm số sinh viên nhận…", tone: "muted" });
    expect(reachText(312, false)).toEqual({ text: "Khoảng 312 sinh viên nhận được thông báo này.", tone: "ok" });
    expect(reachText(0, false).tone).toBe("warn");
    expect(reachText(null, true).text).toContain("Chưa tính được");
  });
});

describe("compose page", () => {
  it("offers every student first, the cohorts and the majors, the counters and the channels", () => {
    const html = renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />);
    expect(html).toContain('aria-pressed="true">Tất cả sinh viên</button>');
    for (const cohort of FALLBACK_OPTIONS.cohorts) expect(html).toContain(`aria-pressed="false">${cohort}</button>`);
    expect(html).toContain("Công nghệ thông tin");
    expect(html).toContain("0/120 ký tự");
    expect(html).toContain("0/1.000 ký tự");
    expect(html).toContain("Trong EduPath AI (chuông thông báo của sinh viên)");
    expect(html).not.toContain("Sắp có");
    expect(html).not.toContain("Email sinh viên");
    expect(html).toContain("Gửi thông báo");
    expect(html).toContain("Sinh viên sẽ thấy");
    expect(html).not.toContain("Bạn chỉ có quyền xem");
  });

  it("lets a read-only account look without sending", () => {
    const html = renderToStaticMarkup(<AnnouncementsManagement canManage={false} section="compose" />);
    expect(html).toContain("Bạn chỉ có quyền xem. Quản trị viên mới gửi được thông báo.");
    expect(html).toContain("<fieldset class=\"cm-fields\" disabled=\"\">");
  });

  it("shows the student's view of what is written", () => {
    const html = renderToStaticMarkup(<AnnouncementPreview title="Lịch đăng ký học phần" body={"Dòng 1\nDòng 2"} link="#plans" />);
    expect(html).toContain("Lịch đăng ký học phần");
    expect(html).toContain("Từ Khoa · Vừa xong · chưa đọc");
    expect(html).toContain("Mở Kế hoạch đào tạo");
    const blank = renderToStaticMarkup(<AnnouncementPreview title=" " body="" link={null} />);
    expect(blank).toContain("Tiêu đề thông báo");
    expect(blank).not.toContain("an-preview-button");
  });
});

describe("sent list", () => {
  function Table({ items, canManage }: { items: Announcement[]; canManage: boolean }) {
    const { sort, sortHeader } = useTableSort();
    return <SentTable items={items} canManage={canManage} sort={sort} sortHeader={sortHeader} page={1} onDetail={() => undefined} onWithdraw={() => undefined} />;
  }

  it("lists each announcement with its recipients, time, reads and a sortable header per column", () => {
    const html = renderToStaticMarkup(<Table canManage items={[sent(), sent({ id: "a2", title: "Thông báo cũ", withdrawnAt: "2026-10-29T02:00:00.000Z" })]} />);
    for (const label of ["STT", "Tiêu đề", "Gửi đến", "Thời gian", "Đã đọc"]) expect(html).toContain(`<span>${label}</span>`);
    expect(html).toContain("<th scope=\"col\">Thao tác</th>");
    expect(html).toContain("K29 · Công nghệ thông tin");
    expect(html).toContain("08:30 28/10/2026");
    expect(html).toContain("204/312");
    expect(html).toContain('class="an-withdrawn"');
    expect(html).toContain('class="an-tag">Đã thu hồi</span>');
  });
});

describe("the email test of AD-NOTI-04: Microsoft's Mail.Send from the member's own mailbox (2026-11-23)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const at = (search: string) => ({
    location: { search, href: `http://localhost:5173/quantri/gui-thong-bao${search}` },
    history: { state: null, replaceState: vi.fn() },
  });

  it("offers a test under Kênh gửi, after the bell, inside the form an account without rights cannot use", () => {
    expect(MAIL_CONSENT_API).toBe("/api/auth/microsoft/mail-consent");
    const html = renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />);
    expect(html).toContain("<strong>Email trường của sinh viên</strong>");
    expect(html).toMatch(/<button type="button" class="am-outline"><svg[^>]*>.*?<\/svg> Gửi email thử cho chính tôi<\/button>/);
    expect(html.indexOf("Trong EduPath AI (chuông thông báo của sinh viên)")).toBeLessThan(html.indexOf("Gửi email thử cho chính tôi"));
    const viewer = renderToStaticMarkup(<AnnouncementsManagement canManage={false} section="compose" />);
    expect(viewer.indexOf('<fieldset class="cm-fields" disabled="">')).toBeLessThan(viewer.indexOf("Gửi email thử cho chính tôi"));
  });

  it("says each outcome Microsoft's page can come back with, passing on only plain codes", () => {
    expect(emailTestOutcome("?emailTest=sent")).toMatchObject({ ok: true, text: expect.stringContaining("Đã gửi thư thử đến hộp thư trường của bạn.") });
    expect(emailTestOutcome("?emailTest=denied&code=AADSTS65004")).toEqual({
      ok: false, text: expect.stringContaining("Microsoft chưa cấp quyền gửi thư (mã AADSTS65004). Nếu trang Microsoft báo cần quản trị viên phê duyệt"),
    });
    expect(emailTestOutcome("?emailTest=send_failed&code=MailboxNotEnabledForRESTAPI")!.text).toContain("(mã MailboxNotEnabledForRESTAPI)");
    for (const outcome of ["other_account", "expired", "signed_out", "failed"]) expect(emailTestOutcome(`?emailTest=${outcome}`)).toMatchObject({ ok: false });
    expect(emailTestOutcome("?emailTest=failed&code=%3Cb%3E")!.text).toBe("Chưa xin được quyền gửi thư của Microsoft. Hãy thử lại.");
    expect(emailTestOutcome("?emailTest=other")).toBeNull();
    expect(emailTestOutcome("")).toBeNull();
  });

  it("shows the outcome above the form when the member comes back", () => {
    vi.stubGlobal("window", at("?emailTest=denied&code=AADSTS65004"));
    const denied = renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />);
    expect(denied).toContain('<p class="admin-error" role="alert">Microsoft chưa cấp quyền gửi thư (mã AADSTS65004).');
    expect(denied.indexOf("Microsoft chưa cấp quyền gửi thư")).toBeLessThan(denied.indexOf("Soạn thông báo"));
    vi.stubGlobal("window", at("?emailTest=sent"));
    expect(renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />)).toMatch(/<div class="an-success" role="status"><svg[^>]*>.*?<\/svg><p>Đã gửi thư thử/);
    vi.stubGlobal("window", at(""));
    expect(renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />)).not.toContain("thư thử đến hộp thư");
  });
});
