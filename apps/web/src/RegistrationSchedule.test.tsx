import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RegistrationSchedule, {
  ReminderPreview, ScheduleTable, cohortsLabel, remindLabel, termChoices, termLabel, toVietnamIso, toVietnamLocal, windowBody, windowState,
} from "./RegistrationSchedule";
import { useTableSort } from "./table-sort";
import type { RegistrationWindow } from "./notification-types";

// Lịch đăng ký học tập (2026-11-25): made-up windows only.
const item = (extra: Partial<RegistrationWindow> = {}): RegistrationWindow => ({
  id: "w1", termCode: "HK262", termLabel: "HK2 2026–2027", kind: "course", kindLabel: "Đăng ký học phần", round: "Đợt 1", cohorts: ["K29"],
  opensAt: "2099-11-26T15:00:00.000Z", closesAt: "2099-11-27T07:00:00.000Z", remindBefore: 0, remindAt: "2099-11-26T15:00:00.000Z", note: null,
  remindedAt: null, outcome: null, recipients: null, read: 0, withdrawnAt: null, createdBy: "Quản trị viên mẫu",
  reminder: { title: "Nhắc đăng ký học phần HK2 2026–2027: Đợt 1", body: "Đợt 1 đăng ký học phần … EduPath AI" }, ...extra,
});

describe("terms and times of the schedule", () => {
  it("writes a term as every page does and offers the next registration first", () => {
    expect(termLabel("HK262")).toBe("HK2 2026–2027");
    expect(termLabel("HK253")).toBe("HK3 2025–2026");
    // While HK1 2026–2027 runs, the registration that comes is HK2's.
    expect(termChoices(new Date("2026-11-25T15:00:00Z"))).toEqual({
      codes: ["HK251", "HK252", "HK253", "HK261", "HK262", "HK263", "HK271", "HK272", "HK273"], next: "HK262",
    });
    expect(termChoices(new Date("2027-03-14T03:00:00Z")).next).toBe("HK263");
    expect(termChoices(new Date("2026-07-07T03:00:00Z")).next).toBe("HK261");
  });

  it("reads and writes the datetime fields in Vietnam time", () => {
    expect(toVietnamIso("2026-11-26T22:00")).toBe("2026-11-26T22:00:00+07:00");
    expect(toVietnamIso("")).toBe("");
    expect(toVietnamLocal("2026-11-26T15:00:00.000Z")).toBe("2026-11-26T22:00");
    expect(toVietnamLocal("2026-11-26T22:00:00+07:00")).toBe("2026-11-26T22:00");
  });

  it("sends a draft only when its đợt and times are filled and in order", () => {
    const draft = { termCode: "HK262", kind: "course" as const, round: " Đợt 1 ", cohorts: ["K29"], opens: "2026-11-26T22:00", closes: "2026-11-27T14:00", remindBefore: 1440 as const, note: "  " };
    expect(windowBody(draft)).toEqual({ termCode: "HK262", kind: "course", round: "Đợt 1", cohorts: ["K29"], opensAt: "2026-11-26T22:00:00+07:00",
      closesAt: "2026-11-27T14:00:00+07:00", remindBefore: 1440, note: null });
    expect(windowBody({ ...draft, closes: "2026-11-26T21:00" })).toBeNull();
    expect(windowBody({ ...draft, round: " " })).toBeNull();
    expect(windowBody({ ...draft, opens: "" })).toBeNull();
    expect(cohortsLabel([])).toBe("Tất cả sinh viên");
    expect(remindLabel(2880)).toBe("Trước 2 ngày");
  });
});

describe("where a reminder stands", () => {
  const now = new Date("2099-11-26T00:00:00Z").getTime();
  it("waits, is due, was sent and read, was withdrawn, or was not sent and why", () => {
    expect(windowState(item(), now)).toMatchObject({ tone: "wait", label: "Chờ nhắc", detail: "Nhắc lúc 22:00 26/11/2099" });
    expect(windowState(item({ remindAt: "2099-11-25T15:00:00.000Z" }), now)).toMatchObject({ tone: "due", label: "Sắp gửi" });
    expect(windowState(item({ outcome: "sent", remindedAt: "2099-11-26T15:00:30.000Z", recipients: 1200, read: 45 }), now))
      .toEqual({ tone: "sent", label: "Đã nhắc", detail: "22:00 26/11/2099 · 1.200 sinh viên · đã đọc 45" });
    expect(windowState(item({ outcome: "sent", remindedAt: "2099-11-26T15:00:30.000Z", withdrawnAt: "2099-11-26T16:00:00.000Z" }), now))
      .toMatchObject({ tone: "off", label: "Đã thu hồi" });
    expect(windowState(item({ outcome: "closed", remindedAt: "2099-11-26T15:00:30.000Z" }), now).detail).toBe("Đợt đã kết thúc trước giờ nhắc");
    expect(windowState(item({ outcome: "turned_off", remindedAt: "2099-11-26T15:00:30.000Z" }), now).detail).toBe("Nhắc đăng ký học tập đang tắt ở Cài đặt thông báo");
    expect(windowState(item({ outcome: "nobody", remindedAt: "2099-11-26T15:00:30.000Z" }), now).detail).toBe("Không có sinh viên nào thuộc khóa đã chọn");
  });
});

describe("the schedule page", () => {
  function Table({ items, canManage = true }: { items: RegistrationWindow[]; canManage?: boolean }) {
    const { sort, sortHeader } = useTableSort();
    return <ScheduleTable items={items} canManage={canManage} sort={sort} sortHeader={sortHeader} page={1} onAction={() => undefined} />;
  }

  it("lists each đợt with its term, cohorts, times, reminder and state under sortable headers", () => {
    const html = renderToStaticMarkup(<Table items={[item(), item({ id: "w2", round: "Đợt 2 (bổ sung)", kind: "study_plan", kindLabel: "Đăng ký kế hoạch học tập", cohorts: [],
      outcome: "sent", remindedAt: "2099-11-20T15:00:00.000Z", recipients: 81, read: 3 })]} />);
    for (const label of ["STT", "Đợt", "Học kỳ", "Khóa", "Thời gian", "Nhắc", "Trạng thái"]) expect(html).toContain(`<span>${label}</span>`);
    expect(html).toContain("<td><strong>Đợt 1</strong><small>Đăng ký học phần</small></td>");
    expect(html).toContain("<td>K29</td>");
    expect(html).toContain("<td>Tất cả sinh viên</td>");
    expect(html).toContain('<span class="rg-times"><span>22:00 26/11/2099</span><span>đến 14:00 27/11/2099</span></span>');
    expect(html).toContain('<span class="rg-state rg-state-wait">Chờ nhắc</span>');
    expect(html).toContain('<span class="rg-state rg-state-sent">Đã nhắc</span><small class="rg-state-detail">22:00 20/11/2099 · 81 sinh viên · đã đọc 3</small>');
  });

  it("shows the reminder as the bell does, under EduPath AI's name", () => {
    const html = renderToStaticMarkup(<ReminderPreview reminder={{ title: "Nhắc đăng ký học phần HK2 2026–2027: Đợt 1", body: "Dòng 1\nEduPath AI" }} />);
    expect(html).toContain('<span class="an-note-icon an-note-icon-edupath" aria-hidden="true">i</span>');
    expect(html).toContain("<small>Hệ thống · lời nhắc của EduPath AI</small>");
    expect(html).toContain('<span class="an-preview-button">Mở Lộ trình học tập</span>');
    expect(renderToStaticMarkup(<ReminderPreview reminder={null} />)).toContain("Điền đủ học kỳ, đợt và thời gian");
  });

  it("opens with the heading and the red add button while the schedule loads; a read-only account gets no button", () => {
    const html = renderToStaticMarkup(<RegistrationSchedule canManage />);
    expect(html).toContain("Lịch đăng ký học tập");
    expect(html).toMatch(/<button class="am-primary"><svg[^>]*>.*?<\/svg> Thêm đợt đăng ký<\/button>/);
    expect(html).toContain("Đang tải dữ liệu…");
    expect(renderToStaticMarkup(<RegistrationSchedule canManage={false} />)).not.toContain("Thêm đợt đăng ký</button>");
  });
});
