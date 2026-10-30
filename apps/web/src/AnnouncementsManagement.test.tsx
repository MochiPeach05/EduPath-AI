import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AnnouncementsManagement, {
  AnnouncementPreview, FALLBACK_OPTIONS, PORTAL_PAGES, SentTable, openLabel, pageLabel, reachQuery, reachText, readShare, readText, sentTime, targetText, toggleValue,
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
    expect(html).toContain('class="an-soon">Sắp có</span>');
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
