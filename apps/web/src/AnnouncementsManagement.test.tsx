import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnnouncementsManagement, {
  ALWAYS_ON_NOTIFICATIONS, AnnouncementPreview, AnnouncementRequestError, EmailChannel, EmailProblemList, FALLBACK_OPTIONS, MAIL_CONSENT_API, PORTAL_PAGES, SentTable,
  SettingsList, emailErrorText, emailMinutes, emailReachText, emailSummary, emailTestOutcome, majorText, openLabel, pageLabel, reachQuery, reachText, readShare,
  readText, sentTime, settingsSummary, targetText, toggleValue, withdrawEmailText, type MailSenderView,
} from "./AnnouncementsManagement";
import { useTableSort } from "./table-sort";
import type { Announcement, AnnouncementEmail, NotificationSetting } from "./notification-types";

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
    // Email waits for GET /mail-sender: its box is there, not ticked and not usable yet.
    expect(html).toContain('<input type="checkbox" disabled=""/> Email trường của sinh viên</label>');
    expect(html).toContain("Đang kiểm tra quyền gửi email…");
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
    for (const label of ["STT", "Tiêu đề", "Gửi đến", "Thời gian", "Đã đọc", "Email"]) expect(html).toContain(`<span>${label}</span>`);
    expect(html).toContain("<th scope=\"col\">Thao tác</th>");
    expect(html).toContain("K29 · Công nghệ thông tin");
    expect(html).toContain("08:30 28/10/2026");
    expect(html).toContain("204/312");
    expect(html).toContain('class="an-withdrawn"');
    expect(html).toContain('class="an-tag">Đã thu hồi</span>');
    // Sent without email (or by an older server).
    expect(html).toContain('<span class="an-muted">Không gửi</span>');
  });

  it("shows how the emails went, a failure in the accent colour", () => {
    const email: AnnouncementEmail = { from: "can.bo@example.edu", total: 312, sent: 298, pending: 0, failed: 2, cancelled: 0, noAddress: 12 };
    const html = renderToStaticMarkup(<Table canManage items={[sent({ email })]} />);
    expect(html).toContain("<span>298/300</span>");
    expect(html).toContain('<small class="an-email-note an-email-note-bad">2 lỗi · 12 chưa có email</small>');
  });
});

describe("announcement emails (AD-NOTI-04/05, 2026-11-23)", () => {
  const email = (extra: Partial<AnnouncementEmail> = {}): AnnouncementEmail => ({ from: "can.bo@example.edu", total: 300, sent: 0, pending: 0, failed: 0, cancelled: 0, noAddress: 0, ...extra });

  it("counts who also gets the email and how long the server takes", () => {
    expect(emailReachText(312, 300)).toBe("300 sinh viên nhận thêm email; 12 sinh viên chưa có địa chỉ email nên chỉ nhận ở chuông.");
    expect(emailReachText(312, 312)).toBe("312 sinh viên nhận thêm email.");
    expect(emailReachText(null, null)).toBeNull();
    expect(emailReachText(0, 0)).toBeNull();
    expect(emailMinutes(300)).toBe(13);
    expect(emailMinutes(5)).toBe(1);
  });

  it("sums up the emails of an announcement and what withdrawing does to them", () => {
    expect(emailSummary(email({ sent: 120, pending: 180 }))).toEqual({ sent: "120/300", share: 40, notes: ["Đang gửi 180"], trouble: false });
    expect(emailSummary(email({ total: 1200, sent: 1190, failed: 4, noAddress: 6 }))).toEqual({ sent: "1.190/1.194", share: 100, notes: ["4 lỗi", "6 chưa có email"], trouble: true });
    expect(emailSummary(email({ total: 0 })).share).toBe(0);
    expect(withdrawEmailText(email({ sent: 120, pending: 180 }))).toBe("180 email chưa gửi sẽ bị hủy; 120 email đã gửi không thu hồi được.");
    expect(withdrawEmailText(email({ sent: 300 }))).toBe("300 email đã gửi không thu hồi được.");
    expect(withdrawEmailText(email())).toBeNull();
    expect(withdrawEmailText(null)).toBeNull();
  });

  it("says why a message did not go out, in words, with Microsoft's code when there is no better text", () => {
    expect(emailErrorText("no_address", null)).toBe("Tài khoản chưa có địa chỉ email");
    expect(emailErrorText("failed", "grant_required")).toContain("đã hết hạn hoặc bị thu hồi");
    expect(emailErrorText("failed", "ErrorInvalidRecipients")).toBe("Địa chỉ email không nhận được thư");
    expect(emailErrorText("failed", "http_503")).toBe("Máy chủ Microsoft gặp lỗi; đã thử lại nhiều lần");
    expect(emailErrorText("failed", "ErrorAccessDenied")).toBe("Microsoft không gửi được thư (mã ErrorAccessDenied)");
    expect(emailErrorText("failed", "<b>")).toBe("Microsoft không gửi được thư");
    const html = renderToStaticMarkup(<EmailProblemList items={[
      { name: "Trần Minh An", studentCode: "2374802019001", address: "an@example.edu", status: "failed", error: "ErrorInvalidRecipients", at: "2026-11-23T03:00:00.000Z" },
      { name: "", studentCode: null, address: null, status: "no_address", error: null, at: "2026-11-23T03:00:00.000Z" },
    ]} />);
    expect(html).toContain("<td>Trần Minh An<small>an@example.edu</small></td>");
    expect(html).toContain("<td>Không rõ tên</td>");
    expect(html).toContain("<td>Tài khoản chưa có địa chỉ email</td>");
    expect(renderToStaticMarkup(<EmailProblemList items={[]} />)).toContain("Không có email lỗi.");
  });

  it("puts Microsoft's code after the page's own text of a failed request", () => {
    expect(new AnnouncementRequestError("send_failed", 502, "ErrorAccessDenied").message).toBe("Microsoft không gửi được thư. Vui lòng thử lại sau. Mã lỗi: ErrorAccessDenied.");
    expect(new AnnouncementRequestError("mail_grant_required", 409).message).toContain("cho phép EduPath AI gửi thư từ hộp thư trường của mình trước");
  });

  const view = (extra: Partial<MailSenderView> = {}): MailSenderView => ({ loading: false, failed: false, available: true, sender: null, reload: () => undefined, ...extra });
  const channel = (mail: MailSenderView, checked = false) => renderToStaticMarkup(<EmailChannel mail={mail} checked={checked} onCheck={() => undefined}
    draft={{ title: "T", body: "B", link: null }} reach="300 sinh viên nhận thêm email." />);

  it("asks the member to allow EduPath AI first, then offers email, a test to themself and taking the permission back", () => {
    const first = channel(view());
    expect(first).toContain('<input type="checkbox" disabled=""/> Email trường của sinh viên');
    expect(first).toContain("Microsoft sẽ hỏi bạn cho phép EduPath AI gửi thư");
    expect(first).toMatch(/<svg[^>]*>.*?<\/svg> Cho phép gửi từ hộp thư của tôi<\/button>/);
    expect(first).not.toContain("Gửi email thử cho chính tôi");

    const ready = channel(view({ sender: { address: "can.bo@example.edu", grantedAt: "2026-11-23T02:00:00.000Z", lastError: null } }), true);
    expect(ready).toContain('<input type="checkbox" checked=""/> Email trường của sinh viên');
    expect(ready).toContain("Gửi từ hộp thư <strong>can.bo@example.edu</strong>. Mỗi sinh viên nhận một email riêng, gửi dần khoảng 25 thư mỗi phút; email đã gửi không thu hồi được.");
    expect(ready).toContain('<p class="an-reach an-reach-ok">300 sinh viên nhận thêm email.</p>');
    expect(ready).toContain("Gửi email thử cho chính tôi");
    expect(ready).toContain("Thu hồi quyền");
    expect(ready).not.toContain("Cho phép gửi từ hộp thư của tôi");

    const again = channel(view({ sender: { address: "can.bo@example.edu", grantedAt: "2026-11-23T02:00:00.000Z", lastError: "grant_required" } }), true);
    expect(again).toContain('<input type="checkbox" disabled=""/>');
    expect(again).toContain('<p class="an-email-text an-email-warn">Microsoft cần bạn cho phép lại');
    expect(again).toContain("Cho phép lại</button>");
    expect(again).not.toContain("an-reach-ok");

    expect(channel(view({ available: false }))).toContain("Máy chủ chưa bật chức năng gửi email.");
    expect(channel(view({ available: false }))).not.toContain("<button");
    expect(channel(view({ available: false, failed: true }))).toContain("Thử lại</button>");
  });

  it("shows the student the email that goes with the announcement", () => {
    const html = renderToStaticMarkup(<AnnouncementPreview title="Lịch đăng ký" body="B" link={null} email />);
    expect(html).toContain("Email gửi kèm có tiêu đề “[EduPath AI] Lịch đăng ký”, cùng nội dung và nút mở EduPath AI.");
    expect(renderToStaticMarkup(<AnnouncementPreview title="Lịch đăng ký" body="B" link={null} />)).not.toContain("Email gửi kèm");
  });
});

describe("Cài đặt thông báo (AD-NOTI-06, 2026-11-23)", () => {
  const setting = (key: NotificationSetting["key"], enabled = true, extra: Partial<NotificationSetting> = {}): NotificationSetting =>
    ({ key, label: `Loại ${key}`, detail: `Mô tả ${key}`, enabled, updatedAt: null, updatedBy: null, ...extra });

  it("shows a switch per kind of automatic notification, and the kinds that are always on", () => {
    const items = [setting("transcript"), setting("roadmap", false, { updatedAt: "2026-11-23T05:00:00.000Z", updatedBy: "Quản trị viên mẫu" })];
    const html = renderToStaticMarkup(<SettingsList items={items} canManage saving={null} onToggle={() => undefined} />);
    expect(html).toContain('<button type="button" role="switch" class="an-switch" aria-checked="true" aria-labelledby="an-setting-transcript" aria-describedby="an-setting-transcript-detail">');
    expect(html).toContain('aria-checked="false" aria-labelledby="an-setting-roadmap"');
    expect(html).toContain("<small>Tắt lúc 12:00 23/11/2026 · Quản trị viên mẫu</small>");
    for (const item of ALWAYS_ON_NOTIFICATIONS) expect(html).toContain(`<strong>${item.label}</strong>`);
    expect(html.match(/Luôn bật/g)).toHaveLength(ALWAYS_ON_NOTIFICATIONS.length);
    expect(settingsSummary(items)).toBe("Đang tắt 1 trong 2 loại thông báo tự động.");
    expect(settingsSummary([setting("warning")])).toBe("Đang bật cả 1 loại thông báo tự động.");
    // A read-only account sees the switches without using them.
    expect(renderToStaticMarkup(<SettingsList items={items} canManage={false} saving={null} onToggle={() => undefined} />)).toContain('aria-describedby="an-setting-transcript-detail" disabled="">');
  });

  it("opens on the settings while they load", () => {
    const html = renderToStaticMarkup(<AnnouncementsManagement canManage section="settings" />);
    expect(html).toContain("Thông báo tự động gửi sinh viên");
    expect(html).toContain("Tắt một loại chỉ dừng thông báo mới");
    expect(html).toContain("Đang tải dữ liệu…");
  });
});

describe("the email test of AD-NOTI-04: Microsoft's Mail.Send from the member's own mailbox (2026-11-23)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const at = (search: string) => ({
    location: { search, href: `http://localhost:5173/quantri/gui-thong-bao${search}` },
    history: { state: null, replaceState: vi.fn() },
  });

  it("puts email under Kênh gửi, after the bell, inside the form an account without rights cannot use", () => {
    expect(MAIL_CONSENT_API).toBe("/api/auth/microsoft/mail-consent");
    const html = renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />);
    expect(html.indexOf("Trong EduPath AI (chuông thông báo của sinh viên)")).toBeLessThan(html.indexOf("Email trường của sinh viên"));
    const viewer = renderToStaticMarkup(<AnnouncementsManagement canManage={false} section="compose" />);
    expect(viewer.indexOf('<fieldset class="cm-fields" disabled="">')).toBeLessThan(viewer.indexOf("Email trường của sinh viên"));
  });

  it("says each outcome Microsoft's page can come back with, passing on only plain codes", () => {
    expect(emailTestOutcome("?emailTest=sent")).toMatchObject({ ok: true, text: expect.stringContaining("Đã cho phép EduPath AI gửi thư từ hộp thư trường của bạn và đã gửi một thư thử đến chính bạn.") });
    expect(emailTestOutcome("?emailTest=failed&code=grant_not_saved")!.text).toBe("Microsoft đã cấp quyền nhưng EduPath AI chưa lưu được quyền này. Hãy thử lại.");
    expect(emailTestOutcome("?emailTest=denied")!.text).not.toContain("Gmail");
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
    expect(renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />)).toMatch(/<div class="an-success" role="status"><svg[^>]*>.*?<\/svg><p>Đã cho phép EduPath AI/);
    vi.stubGlobal("window", at(""));
    expect(renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />)).not.toContain("Đã cho phép EduPath AI");
  });
});
