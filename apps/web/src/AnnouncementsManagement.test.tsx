import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnnouncementsManagement, {
  ANNOUNCEMENT_ROW, AnnouncementPreview, SENDERS, AnnouncementRequestError, AutoMailPanel, EmailChannel, EmailPreview, EmailProblemList, FALLBACK_OPTIONS, MAIL_CONSENT_API,
  PORTAL_PAGES, RecipientList, STUDENT_RESULTS, SentTable, SettingsList, StudentPicker, autoSenderReady, emailErrorText, emailMinutes, emailReachText,
  emailStatsText, emailSummary, emailTestOutcome, majorText, nextSenderAddress, openLabel, ownGrantReady, pageLabel, pickedReachText, pickedSummary, reachQuery,
  reachText, reachedText, readShare, readText, searchStatus, sentTime, settingsSummary, studentLine, targetText, toggleValue, withdrawEmailText, type MailSenderView,
} from "./AnnouncementsManagement";
import { useTableSort } from "./table-sort";
import type { Announcement, AnnouncementEmail, AutoMailState, NotificationSetting, RecipientStudent } from "./notification-types";

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

describe("compose page (redesigned 2026-11-25)", () => {
  it("is three steps, recipients by group first, beside the summary with the send button and the student's view", () => {
    const html = renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />);
    const order = ["Người nhận", "Nội dung", "Kênh gửi", "Tóm tắt", "Sinh viên sẽ thấy"].map((text) => html.indexOf(`>${text}</h2>`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<span class="an-step-no" aria-hidden="true">1</span>');
    // The two ways of choosing recipients, the group one first.
    expect(html).toContain('<div class="an-seg" role="group" aria-label="Cách chọn người nhận">');
    expect(html).toMatch(/aria-pressed="true"><svg[^>]*>.*?<\/svg> Theo khóa, ngành<\/button>/);
    expect(html).toMatch(/aria-pressed="false"><svg[^>]*>.*?<\/svg> Chọn từng sinh viên<\/button>/);
    expect(html).toContain('aria-pressed="true">Tất cả sinh viên</button>');
    for (const cohort of FALLBACK_OPTIONS.cohorts) expect(html).toContain(`aria-pressed="false">${cohort}</button>`);
    expect(html).toContain("Công nghệ thông tin");
    expect(html).toContain("0/120 ký tự");
    expect(html).toContain("0/1.000 ký tự");
    expect(html).toContain("<strong>Trong EduPath AI</strong>");
    expect(html).toContain('<span class="an-always">Luôn bật</span>');
    // Email waits for GET /mail-sender: its switch is there, off and not usable yet.
    expect(html).toContain('<strong>Email trường của sinh viên</strong><small>Đang kiểm tra quyền gửi…</small>');
    expect(html).toContain('role="switch" class="an-switch" aria-checked="false" aria-label="Gửi kèm email trường của sinh viên" disabled=""');
    // The send button lives in the summary and sends the form by its id.
    expect(html).toContain('<form id="an-compose-form"');
    expect(html).toMatch(/<button type="submit" form="an-compose-form" class="am-primary"><svg[^>]*>.*?<\/svg> Gửi thông báo<\/button>/);
    expect(html).toContain("<dt>Người nhận</dt><dd>Tất cả sinh viên</dd>");
    expect(html).toContain('<dt>Tiêu đề</dt><dd class="an-muted">Chưa nhập</dd>');
    expect(html).not.toContain("Sắp có");
    expect(html).not.toContain("Bạn chỉ có quyền xem");
  });

  it("lets a read-only account look without sending", () => {
    const html = renderToStaticMarkup(<AnnouncementsManagement canManage={false} section="compose" />);
    expect(html).toContain("Bạn chỉ có quyền xem. Quản trị viên mới gửi được thông báo.");
    expect(html).toContain('<fieldset class="cm-fields an-steps" disabled="">');
    expect(html).toMatch(/<button type="submit" form="an-compose-form" class="am-primary" disabled="">/);
  });

  it("shows the student's view of what is written: the bell first, the email on its tab", () => {
    const html = renderToStaticMarkup(<AnnouncementPreview title="Lịch đăng ký học phần" body={"Dòng 1\nDòng 2"} link="#plans" />);
    expect(html).toContain("Lịch đăng ký học phần");
    expect(html).toContain("Từ Khoa · Vừa xong · chưa đọc");
    expect(html).toContain('<span class="an-preview-button">Mở Kế hoạch đào tạo</span>');
    expect(html).toMatch(/aria-pressed="true"><svg[^>]*>.*?<\/svg> Chuông<\/button>/);
    const blank = renderToStaticMarkup(<AnnouncementPreview title=" " body="" link={null} />);
    expect(blank).toContain("Tiêu đề thông báo");
    expect(blank).not.toContain("an-preview-button");
  });

  it("previews the email as the server writes it: subject, greeting, paragraphs, the page's button and the footer", () => {
    const html = renderToStaticMarkup(<EmailPreview title=" Lịch đăng ký " body={"Mở từ 01/12.\nHạn 05/12.\n\nXem kế hoạch."} link="#plans" from="can.bo@example.edu" on />);
    expect(html).toContain("<dd><strong>[EduPath AI] Lịch đăng ký</strong></dd>");
    expect(html).toContain("<dd>can.bo@example.edu</dd>");
    expect(html).toContain("<p>Chào [họ tên sinh viên],</p><p>Mở từ 01/12.\nHạn 05/12.</p><p>Xem kế hoạch.</p>");
    expect(html).toContain('<span class="an-mail-button">Mở Kế hoạch đào tạo trên EduPath AI</span>');
    expect(html).not.toContain("Chưa bật kênh email");
    const off = renderToStaticMarkup(<EmailPreview title="" body="" link={null} from={null} on={false} />);
    expect(off).toContain("Chưa bật kênh email: sinh viên chỉ nhận thông báo ở chuông.");
    expect(off).toContain('<span class="an-mail-button">Mở EduPath AI</span>');
    expect(off).toContain("<dd>Hộp thư trường của bạn</dd>");
  });
});

describe("Người gửi: Khoa or EduPath AI (2026-11-25)", () => {
  it("offers the Khoa first and EduPath AI beside it, and names the sender in the summary", () => {
    const html = renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />);
    expect(html).toContain('<span class="an-search-label" id="an-sender-label">Người gửi</span>');
    expect(html).toContain('<button type="button" aria-pressed="true">Khoa Công nghệ Thông tin</button><button type="button" aria-pressed="false">EduPath AI</button>');
    expect(html).toContain("<dt>Người gửi</dt><dd>Khoa Công nghệ Thông tin</dd>");
  });

  it("shows the student the bell and the email of EduPath AI, never the Khoa's", () => {
    const bell = renderToStaticMarkup(<AnnouncementPreview title="Nhắc đăng ký" body="B" link={null} sender="edupath" />);
    expect(bell).toContain('<span class="an-note-icon an-note-icon-edupath" aria-hidden="true">i</span>');
    expect(bell).toContain("<small>Hệ thống · Vừa xong · chưa đọc</small>");
    expect(bell).toContain("lọc được theo &quot;Hệ thống&quot;");
    expect(bell).not.toContain("Từ Khoa");
    const mail = renderToStaticMarkup(<EmailPreview title="Nhắc đăng ký" body="B" link={null} from={null} on sender="edupath" />);
    expect(mail).toContain(`<p class="an-mail-foot">${SENDERS.edupath.foot}</p>`);
    expect(mail).not.toContain("Khoa");
    expect(renderToStaticMarkup(<AnnouncementPreview title="T" body="B" link={null} />)).toContain("<small>Từ Khoa · Vừa xong · chưa đọc</small>");
  });

  it("tags an announcement sent under EduPath AI's name in the sent list", () => {
    function Table({ items }: { items: Announcement[] }) {
      const { sort, sortHeader } = useTableSort();
      return <SentTable items={items} canManage sort={sort} sortHeader={sortHeader} page={1} onDetail={() => undefined} onWithdraw={() => undefined} />;
    }
    const html = renderToStaticMarkup(<Table items={[sent({ sender: "edupath" }), sent({ id: "a2" })]} />);
    expect(html.match(/<span class="an-tag an-tag-edupath">EduPath AI<\/span>/g)).toHaveLength(1);
  });
});

describe("Chọn từng sinh viên (2026-11-25)", () => {
  const student = (id: string, extra: Partial<RecipientStudent> = {}): RecipientStudent =>
    ({ id, name: "Lương Khánh Vy", studentCode: "2374802019901", className: "71K29CNTT99", cohort: "K29", hasEmail: true, ...extra });

  it("tells students apart by MSSV and class, and names the picked ones in short", () => {
    expect(studentLine(student("a"))).toBe("MSSV 2374802019901 · 71K29CNTT99");
    expect(studentLine(student("a", { studentCode: null, className: null }))).toBe("Chưa cập nhật MSSV");
    const picked = [student("a"), student("b", { name: "Tạ Minh Đức" }), student("c", { name: "Hồ Quang Minh" })];
    expect(pickedSummary([])).toBe("Chưa chọn sinh viên nào");
    expect(pickedSummary(picked.slice(0, 1))).toBe("Lương Khánh Vy");
    expect(pickedSummary(picked.slice(0, 2))).toBe("Lương Khánh Vy và Tạ Minh Đức");
    expect(pickedSummary(picked)).toBe("Lương Khánh Vy, Tạ Minh Đức và 1 sinh viên khác");
    expect(pickedSummary(picked, 3)).toBe("Lương Khánh Vy, Tạ Minh Đức và Hồ Quang Minh");
    expect(pickedReachText(0)).toEqual({ text: "Chưa chọn sinh viên nào. Tìm và đánh dấu những sinh viên cần gửi.", tone: "warn" });
    expect(pickedReachText(1200)).toEqual({ text: "1.200 sinh viên được chọn nhận được thông báo này.", tone: "ok" });
  });

  it("says who an announcement reached once, whether its list of picked students is still kept or not", () => {
    expect(reachedText({ recipients: 3, target: { cohorts: [], majors: [], students: ["a", "b", "c"] }, targetLabel: "3 sinh viên được chọn" })).toBe("3 sinh viên được chọn");
    expect(reachedText({ recipients: 3, target: { cohorts: [], majors: [], picked: 3 }, targetLabel: "3 sinh viên được chọn" })).toBe("3 sinh viên được chọn");
    expect(reachedText({ recipients: 1200, target: { cohorts: ["K29"], majors: [] }, targetLabel: "K29" })).toBe("1.200 sinh viên (K29)");
  });

  it("says what the search found", () => {
    expect(searchStatus("", null, false)).toBe("Đang tìm sinh viên…");
    expect(searchStatus("", 20, false)).toBe("20 sinh viên đầu tiên theo tên. Gõ họ tên, MSSV hoặc lớp để tìm sinh viên khác.");
    expect(searchStatus("minh", 3, false)).toBe("3 sinh viên phù hợp.");
    expect(searchStatus("minh", STUDENT_RESULTS, false)).toBe("20 sinh viên phù hợp đầu tiên; gõ thêm để thu hẹp.");
    expect(searchStatus("zz", 0, false)).toBe("Không có sinh viên phù hợp. Thử từ khóa khác.");
    expect(searchStatus("", 0, false)).toBe("Chưa có sinh viên nào nhận được thông báo.");
    expect(searchStatus("minh", null, true)).toBe("Chưa tìm được sinh viên. Vui lòng thử lại.");
  });

  it("shows the search, the picked students each with a way to take them out, and nothing picked yet", () => {
    const html = renderToStaticMarkup(<StudentPicker picked={[student("a"), student("b", { name: "Tạ Minh Đức", hasEmail: false })]} onChange={() => undefined} disabled={false} />);
    expect(html).toContain('<label class="an-search-label" for="an-student-search">Tìm sinh viên</label>');
    expect(html).toContain('placeholder="Họ tên, MSSV hoặc lớp…"');
    expect(html).toContain('<p class="an-hint" role="status" aria-live="polite">Đang tìm sinh viên…</p>');
    expect(html).toContain("<strong>Đã chọn 2 sinh viên</strong>");
    expect(html).toContain('<span class="an-avatar an-avatar-sm" aria-hidden="true">KV</span>');
    expect(html).toContain("<small>MSSV 2374802019901 · 71K29CNTT99 · chưa có email</small>");
    expect(html).toContain('aria-label="Bỏ chọn Tạ Minh Đức"');
    expect(html).toContain("Bỏ chọn tất cả</button>");
    const none = renderToStaticMarkup(<StudentPicker picked={[]} onChange={() => undefined} disabled={false} />);
    expect(none).toContain("Chưa chọn sinh viên nào. Đánh dấu sinh viên trong danh sách kết quả để thêm vào đây.");
    expect(none).not.toContain("Bỏ chọn tất cả");
    const full = renderToStaticMarkup(<StudentPicker picked={Array.from({ length: 200 }, (_, index) => student(`s${index}`))} onChange={() => undefined} disabled={false} />);
    expect(full).toContain("Đã đủ 200 sinh viên, mức tối đa cho một thông báo.");
  });

  it("lists the students an announcement was sent to by picking them", () => {
    const html = renderToStaticMarkup(<RecipientList items={[student("a"), student("b", { name: "Tạ Minh Đức", studentCode: null, className: null, hasEmail: false })]} />);
    expect(html).toContain("<td>Lương Khánh Vy</td><td class=\"an-num\">2374802019901</td><td class=\"an-num\">71K29CNTT99</td>");
    expect(html).toContain("<td>Tạ Minh Đức<small>Chưa có email</small></td><td class=\"an-num\">—</td><td class=\"an-num\">—</td>");
    expect(renderToStaticMarkup(<RecipientList items={[]} />)).toContain("Không còn tài khoản sinh viên nào trong danh sách này.");
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
    const off = (html: string) => html.includes('aria-checked="false" aria-label="Gửi kèm email trường của sinh viên" disabled=""');
    const first = channel(view());
    expect(off(first)).toBe(true);
    expect(first).toContain("<small>Cần cho phép một lần</small>");
    expect(first).toContain("Microsoft sẽ hỏi bạn cho phép EduPath AI gửi thư");
    expect(first).toMatch(/<svg[^>]*>.*?<\/svg> Cho phép gửi từ hộp thư của tôi<\/button>/);
    expect(first).not.toContain("Gửi email thử cho chính tôi");

    const ready = channel(view({ sender: { address: "can.bo@example.edu", grantedAt: "2026-11-23T02:00:00.000Z", lastError: null } }), true);
    expect(ready).toContain('aria-checked="true" aria-label="Gửi kèm email trường của sinh viên">');
    expect(ready).toContain('class="an-channel an-email an-channel-on"');
    expect(ready).toContain("Gửi từ hộp thư <strong>can.bo@example.edu</strong>. Mỗi sinh viên nhận một email riêng, gửi dần khoảng 25 thư mỗi phút; email đã gửi không thu hồi được.");
    expect(ready).toContain('<p class="an-reach an-reach-ok">300 sinh viên nhận thêm email.</p>');
    expect(ready).toContain("Gửi email thử cho chính tôi");
    expect(ready).toContain("Thu hồi quyền");
    expect(ready).not.toContain("Cho phép gửi từ hộp thư của tôi");

    const again = channel(view({ sender: { address: "can.bo@example.edu", grantedAt: "2026-11-23T02:00:00.000Z", lastError: "grant_required" } }), true);
    expect(off(again)).toBe(true);
    expect(again).toContain("<small>Cần cho phép lại</small>");
    expect(again).toContain('<p class="an-email-text an-email-warn">Microsoft cần bạn cho phép lại');
    expect(again).toContain("Cho phép lại</button>");
    expect(again).not.toContain("an-reach-ok");

    expect(channel(view({ available: false }))).toContain("Máy chủ chưa bật chức năng gửi email.");
    expect(channel(view({ available: false }))).not.toContain("am-outline");
    expect(channel(view({ available: false, failed: true }))).toContain("Thử lại</button>");
  });

  it("offers the email on the preview's own tab", () => {
    const html = renderToStaticMarkup(<AnnouncementPreview title="Lịch đăng ký" body="B" link={null} email from="can.bo@example.edu" />);
    expect(html).toMatch(/aria-pressed="false"><svg[^>]*>.*?<\/svg> Email<\/button>/);
  });
});

describe("Cài đặt thông báo (AD-NOTI-06, 2026-11-23)", () => {
  const setting = (key: NotificationSetting["key"], enabled = true, extra: Partial<NotificationSetting> = {}): NotificationSetting => ({
    key, label: `Loại ${key}`, detail: `Mô tả ${key}`, bellLocked: false, enabled, email: false, updatedAt: null, updatedBy: null,
    emails: { sent: 0, pending: 0, failed: 0, noAddress: 0 }, ...extra,
  });
  const list = (items: NotificationSetting[], options: { canManage?: boolean; emailReady?: boolean; saving?: string | null } = {}) =>
    renderToStaticMarkup(<SettingsList items={items} canManage={options.canManage ?? true} saving={options.saving ?? null} emailReady={options.emailReady ?? true}
      onBell={() => undefined} onEmail={() => undefined} />);

  it("shows a bell switch and an email switch per kind, then the faculty's announcements", () => {
    const items = [
      setting("transcript"),
      setting("roadmap", false, { updatedAt: "2026-11-23T05:00:00.000Z", updatedBy: "Quản trị viên mẫu" }),
      setting("warning", true, { email: true, emails: { sent: 12, pending: 0, failed: 1, noAddress: 2 } }),
      setting("advisor_action", true, { bellLocked: true }),
    ];
    const html = list(items);
    expect(html).toContain('<button type="button" role="switch" class="an-switch" aria-checked="true" aria-label="Loại transcript: thông báo trong EduPath AI">');
    expect(html).toContain('aria-checked="false" aria-label="Loại roadmap: thông báo trong EduPath AI">');
    expect(html).toContain('aria-checked="true" aria-label="Loại warning: gửi kèm email">');
    expect(html).toContain("<small>Cập nhật lúc 12:00 23/11/2026 · Quản trị viên mẫu</small>");
    expect(html).toContain('<small class="an-setting-stats">Email 30 ngày qua: 12 đã gửi · 1 lỗi · 2 chưa có email</small>');
    // Việc làm thay sinh viên is always in the bell; its email has a switch.
    expect(html).toContain('<div class="an-setting-control" data-label="Trong EduPath AI"><span class="an-always">Luôn bật</span></div>');
    expect(html).toContain('aria-label="Loại advisor_action: gửi kèm email"');
    expect(html).not.toContain('aria-label="Loại advisor_action: thông báo trong EduPath AI"');
    expect(html).toContain(`<strong>${ANNOUNCEMENT_ROW.label}</strong>`);
    expect(html).toContain('<span class="an-always">Chọn khi gửi</span>');
    expect(settingsSummary(items)).toBe("Đang tắt 1 trong 4 loại thông báo tự động; 1 loại gửi kèm email.");
    expect(settingsSummary([setting("warning")])).toBe("Đang bật cả 1 loại thông báo tự động.");
    expect(emailStatsText({ sent: 0, pending: 0, failed: 0, noAddress: 0 })).toBeNull();
  });

  it("lets the email go on only with the bell on and a mailbox that can send, and off always", () => {
    const emailSwitch = (html: string, key: string) => new RegExp(`aria-label="Loại ${key}: gửi kèm email"( disabled="")?>`).exec(html)?.[1] === undefined;
    const items = [setting("transcript"), setting("roadmap", false), setting("warning", true, { email: true })];
    const ready = list(items);
    expect(emailSwitch(ready, "transcript")).toBe(true);
    expect(emailSwitch(ready, "roadmap")).toBe(false);
    const noMailbox = list(items, { emailReady: false });
    expect(emailSwitch(noMailbox, "transcript")).toBe(false);
    // An email already on can still be turned off.
    expect(emailSwitch(noMailbox, "warning")).toBe(true);
    // A read-only account sees the switches without using them; a save under way holds them all.
    const viewer = list(items, { canManage: false });
    for (const key of ["transcript", "warning"]) expect(emailSwitch(viewer, key)).toBe(false);
    expect(viewer).toContain('aria-label="Loại transcript: thông báo trong EduPath AI" disabled="">');
    expect(list(items, { saving: "warning:email" })).toContain('aria-label="Loại warning: gửi kèm email" disabled=""><span class="an-switch-track" aria-hidden="true"></span><span class="an-switch-label">Đang lưu…</span>');
  });

  const mail = (extra: Partial<AutoMailState> = {}): AutoMailState => ({ available: true, sender: null, me: null, ...extra });
  const me = { address: "can.bo@example.edu", grantedAt: "2026-11-23T02:00:00.000Z", lastError: null };
  const panel = (state: AutoMailState, failed = 0) => renderToStaticMarkup(<AutoMailPanel mail={state} stats={{ sent: 40, pending: 2, failed, noAddress: 0 }}
    canManage busy={null} onConsent={() => undefined} onUseMine={() => undefined} onRetry={() => undefined} />);

  it("says whose mailbox sends the automatic emails and what to do when there is none or it must be allowed again", () => {
    const none = panel(mail());
    expect(none).toContain("Hãy cho phép EduPath AI gửi thư từ hộp thư trường của bạn");
    expect(none).toContain("Cho phép gửi từ hộp thư của tôi</button>");
    expect(none).toContain("30 ngày qua: 40 đã gửi · 2 đang gửi.");
    const allowed = panel(mail({ me }));
    expect(allowed).toContain("email sẽ gửi từ hộp thư <strong>can.bo@example.edu</strong> của bạn");
    expect(allowed).toContain("Dùng hộp thư của tôi</button>");
    expect(allowed).not.toContain("Cho phép gửi từ hộp thư của tôi");

    const sender = { name: "Nguyễn Văn Cán Bộ", address: "khoa@example.edu", lastError: null, mine: false };
    const theirs = panel(mail({ sender, me }), 3);
    expect(theirs).toContain("Gửi từ hộp thư <strong>khoa@example.edu</strong> (Nguyễn Văn Cán Bộ).");
    expect(theirs).toContain("Dùng hộp thư của tôi</button>");
    expect(theirs).toContain("Gửi lại email lỗi (3)</button>");
    const own = panel(mail({ sender: { ...sender, address: "can.bo@example.edu", mine: true }, me }));
    expect(own).toContain("Gửi từ hộp thư <strong>can.bo@example.edu</strong> của bạn.");
    expect(own).not.toContain("<button");

    const broken = panel(mail({ sender: { ...sender, mine: true, lastError: "grant_required" }, me: { ...me, lastError: "grant_required" } }), 3);
    expect(broken).toContain('class="an-automail an-automail-warn"');
    expect(broken).toContain("Hộp thư khoa@example.edu của bạn cần được cho phép lại nên email tự động đang chưa gửi được.");
    expect(broken).toContain("Cho phép lại</button>");
    // Nothing goes again until the mailbox works.
    expect(broken).not.toContain("Gửi lại email lỗi");
    expect(panel(mail({ available: false }))).toContain("Máy chủ chưa bật chức năng gửi email.");

    expect(autoSenderReady(mail({ sender }))).toBe(true);
    expect(autoSenderReady(mail({ sender: { ...sender, address: null } }))).toBe(false);
    expect(ownGrantReady(mail({ me }))).toBe(true);
    expect(nextSenderAddress(mail({ sender, me }))).toBe("khoa@example.edu");
    expect(nextSenderAddress(mail({ sender: { ...sender, lastError: "grant_required" }, me }))).toBe("can.bo@example.edu");
    expect(nextSenderAddress(mail())).toBeNull();
  });

  it("opens on the settings while they load", () => {
    const html = renderToStaticMarkup(<AnnouncementsManagement canManage section="settings" />);
    expect(html).toContain("Thông báo tự động gửi sinh viên");
    expect(html).toContain("chọn loại nào gửi kèm email trường của sinh viên");
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
    expect(denied.indexOf("Microsoft chưa cấp quyền gửi thư")).toBeLessThan(denied.indexOf("Người nhận"));
    vi.stubGlobal("window", at("?emailTest=sent"));
    expect(renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />)).toMatch(/<div class="an-success" role="status"><svg[^>]*>.*?<\/svg><p>Đã cho phép EduPath AI/);
    vi.stubGlobal("window", at(""));
    expect(renderToStaticMarkup(<AnnouncementsManagement canManage section="compose" />)).not.toContain("Đã cho phép EduPath AI");
  });
});
