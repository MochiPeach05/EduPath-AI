// Writing notifications (2026-10-30). Every producer passes a source_key, so a repeated event (a worker retry, the overview
// computing the same warning again) never writes a second row while the first exists. A notification never breaks the
// job it reports: inside a transaction it is written under a savepoint, elsewhere its error is only logged (a code, never
// data).
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { BODY_MAX, isPortalPage, openLabel, TITLE_MAX, type NotificationKind, type NotificationType } from "./model.js";

type Db = Pick<DatabasePool, "query"> | Pick<PoolClient, "query">;

export type NotificationInput = {
  type: NotificationType;
  kind: NotificationKind;
  title: string;
  body: string;
  /** A portal page ("#roadmap"); anything else is dropped. */
  link?: string | null;
  /** The button's label; "Mở <trang>" when omitted. */
  linkLabel?: string | null;
  sourceKey?: string | null;
  announcementId?: string | null;
};

const clip = (text: string, max: number) => {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  return Array.from(clean).length > max ? `${Array.from(clean).slice(0, max - 1).join("").trimEnd()}…` : clean;
};

/** The row a notification is stored as (exported for the announcement fan-out, which writes many at once). */
export function notificationValues(userId: string, input: NotificationInput) {
  const link = isPortalPage(input.link) ? input.link : null;
  const label = link ? clip(input.linkLabel?.trim() || openLabel(link), 80) : null;
  return [randomUUID(), userId, input.type, input.kind, clip(input.title, TITLE_MAX) || "Thông báo", clip(input.body, BODY_MAX), link, label,
    input.sourceKey ? clip(input.sourceKey, 300) : null, input.announcementId ?? null];
}

/** Writes one notification; false when its source_key already has one for this student. */
export async function notify(db: Db, userId: string, input: NotificationInput): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO stu_notifications(id,user_id,type,kind,title,body,link,link_label,source_key,announcement_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (user_id,source_key) WHERE source_key IS NOT NULL DO NOTHING`,
    notificationValues(userId, input));
  return Boolean(result.rowCount);
}

/** The same notification for many students in one statement (an announcement, a catalog update); returns rows written. */
export async function notifyMany(db: Db, userIds: readonly string[], input: NotificationInput): Promise<number> {
  if (!userIds.length) return 0;
  const rows = userIds.map((userId) => notificationValues(userId, input));
  const column = (index: number) => rows.map((row) => row[index]);
  const result = await db.query(
    `INSERT INTO stu_notifications(id,user_id,type,kind,title,body,link,link_label,source_key,announcement_id)
      SELECT x.id,x.user_id,x.type,x.kind,x.title,x.body,x.link,x.link_label,x.source_key,x.announcement_id
      FROM unnest($1::uuid[],$2::uuid[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[],$9::text[],$10::uuid[])
        AS x(id,user_id,type,kind,title,body,link,link_label,source_key,announcement_id)
      ON CONFLICT (user_id,source_key) WHERE source_key IS NOT NULL DO NOTHING`,
    [column(0), column(1), column(2), column(3), column(4), column(5), column(6), column(7), column(8), column(9)]);
  return result.rowCount ?? 0;
}

const errorCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[\w-]{1,40}$/.test(code) ? code : "error";
};

/** Inside the caller's transaction: a failure rolls back only the notification, never the job's own writes. */
export async function notifyInTransaction(client: Pick<PoolClient, "query">, userId: string, input: NotificationInput): Promise<void> {
  try {
    // Inside the try: even the savepoint failing never breaks the job that is completing.
    await client.query("SAVEPOINT edupath_notify");
    await notify(client, userId, input);
    await client.query("RELEASE SAVEPOINT edupath_notify");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT edupath_notify").catch(() => undefined);
    console.error(`[notifications] ${input.kind} not written (${errorCode(error)})`);
  }
}

/** Outside a transaction (after a commit): a failure is logged and ignored. */
export async function notifySafely(db: Db, userId: string, input: NotificationInput): Promise<void> {
  try {
    await notify(db, userId, input);
  } catch (error) {
    console.error(`[notifications] ${input.kind} not written (${errorCode(error)})`);
  }
}

/* ------------------------------------------------------------------------ */
/* What the producers write (the portal's voice: "mình" never appears, the student is "bạn") */

const TRANSCRIPT_FAILURES: Record<string, string> = {
  invalid_pdf: "Tệp tải lên không phải PDF hợp lệ.",
  encrypted_pdf: "PDF đang khóa bằng mật khẩu.",
  too_many_pages: "PDF dài quá 20 trang.",
  unsupported_layout: "Bố cục bảng điểm này chưa được hỗ trợ.",
  unreadable_rows: "Một số dòng môn học không đọc được.",
  parse_timeout: "Đọc bảng điểm quá lâu nên đã dừng.",
  ocr_failed: "Không nhận dạng được chữ trong PDF.",
  worker_timeout: "Máy đọc bảng điểm không phản hồi kịp.",
  transcript_changed: "Bảng điểm của bạn vừa thay đổi trong lúc đọc nên bản này không được lưu.",
};

export function transcriptReady(courses: number | null, terms: number | null): NotificationInput {
  const counted = courses && terms ? ` ${courses} học phần trong ${terms} học kỳ` : "";
  return {
    type: "ai", kind: "transcript_ready", title: "Bảng điểm đã đọc xong",
    body: `EduPath AI đã đọc xong${counted} từ bảng điểm PDF của bạn. Bạn đối chiếu lại mã môn, điểm và kết quả với bản PDF gốc nhé.`,
    link: "#profile",
  };
}

export function transcriptFailed(code: string): NotificationInput {
  const reason = TRANSCRIPT_FAILURES[code] ?? "Có lỗi khi đọc bảng điểm.";
  return {
    type: "ai", kind: "transcript_failed", title: "Chưa đọc được bảng điểm",
    body: `${reason} Bạn kiểm tra lại tệp PDF tải từ cổng đào tạo của trường rồi import lại ở Hồ sơ và bảng điểm nhé.`,
    link: "#profile",
  };
}

export const assessmentComment = (): NotificationInput => ({
  type: "ai", kind: "assessment_comment", title: "Nhận xét năng lực đã sẵn sàng",
  body: "EduPath AI đã viết xong nhận xét cho lần Đánh giá năng lực mới nhất của bạn. Bạn xem điểm từng nhóm năng lực và lời khuyên để biết nên ưu tiên kỹ năng nào.",
  link: "#competency",
});

export const roadmapReady = (): NotificationInput => ({
  type: "ai", kind: "roadmap_ready", title: "Lộ trình AI cho học kỳ tới đã soạn xong",
  body: "Lộ trình AI đề xuất của bạn đã sẵn sàng, gồm môn nên học, môn cần học lại hoặc học cải thiện, kỹ năng nên bổ sung và kế hoạch theo từng tháng.",
  link: "#roadmap", linkLabel: "Mở Lộ trình AI đề xuất",
});

export const roadmapFailed = (): NotificationInput => ({
  type: "ai", kind: "roadmap_failed", title: "Chưa soạn được Lộ trình AI",
  body: "Lần soạn Lộ trình AI vừa rồi chưa thành công. Bạn bấm Tạo lại ở tab Lộ trình AI đề xuất để thử lại nhé.",
  link: "#roadmap", linkLabel: "Mở Lộ trình AI đề xuất",
});

export const graduationAdvice = (): NotificationInput => ({
  type: "ai", kind: "graduation_advice", title: "Đã có lời khuyên xét tốt nghiệp",
  body: "Lời khuyên mới nêu các điều kiện còn thiếu và học phần nên đăng ký để kịp xét tốt nghiệp.",
  link: "#graduation",
});

/** what: "chương trình đào tạo K29", "kế hoạch đào tạo K29", "tiêu chuẩn xét tốt nghiệp K29 Công nghệ phần mềm". */
export const catalogUpdated = (what: string): NotificationInput => ({
  type: "sys", kind: "catalog_updated", title: `Khoa cập nhật ${what}`,
  body: `Khoa Công nghệ Thông tin vừa cập nhật ${what}. Bạn bấm Đánh giá lại ở trang Đánh giá năng lực để kết quả, Khoảng trống kỹ năng và Lộ trình học tập theo bản mới.`,
  link: "#competency",
});

/**
 * What a cố vấn học tập did in the student's page (AD-AST-07, 08; policy 2026-11-03): one notification per advisor, action
 * and day (source key), so a busy afternoon of the advisor does not fill the bell.
 */
export function advisorAction(advisorName: string, did: string, link: string, day: string, key: string): NotificationInput {
  const name = advisorName.trim() || "Cố vấn học tập của lớp bạn";
  return {
    type: "khoa", kind: "advisor_action", title: `Cố vấn học tập ${did} thay bạn`,
    body: `${name} (cố vấn học tập của lớp bạn) ${did} thay bạn trên EduPath AI. Bạn xem lại kết quả; nếu không muốn giữ, bạn vẫn xóa được như thường.`,
    link, sourceKey: `advisor:${key}:${day}`,
  };
}

/* ------------------------------------------------------------------------ */
/* Warnings of the overview (STU-PROG-03) */

export type WarningItem = {
  kind: string;
  key: string;
  level: "risk" | "warn" | "ok";
  text: string;
  /** The words the overview bolds; the first names what the warning is about (a course, "3 môn khác", a group). */
  strong?: readonly string[];
  action?: { label: string; link: string } | null;
};

const WARNING_TITLES: Record<string, string> = {
  failed_course: "Có môn bắt buộc chưa đạt",
  pace: "Nguy cơ chậm tiến độ tốt nghiệp",
  late_course: "Có môn trễ so với kế hoạch đào tạo",
  elective_short: "Nhóm tự chọn còn thiếu tín chỉ",
  gpa_below: "Điểm trung bình dưới ngưỡng xét tốt nghiệp",
};

/**
 * The title of a warning's notification names what it is about, so two warnings of one kind never look alike in the bell
 * (user review 2026-10-30: "có 2 cặp trùng nhau" — two failed courses were both "Có môn bắt buộc chưa đạt"). null for a
 * kind that is not notified.
 */
export function warningTitle(item: Pick<WarningItem, "kind" | "key" | "text" | "strong">): string | null {
  const generic = WARNING_TITLES[item.kind];
  if (!generic) return null;
  const subject = item.strong?.[0]?.trim();
  if (!subject) return generic;
  if (item.kind === "failed_course") return `Môn bắt buộc chưa đạt: ${subject}`;
  if (item.kind === "late_course") return item.key === "late:others" ? `Còn ${subject} trễ so với kế hoạch` : `Môn trễ so với kế hoạch: ${subject}`;
  if (item.kind === "elective_short") {
    const missing = /còn thiếu (\d+(?:,\d+)? (?:TC|môn))/.exec(item.text)?.[1];
    return missing ? `${subject} còn thiếu ${missing}` : `${subject} còn thiếu tín chỉ`;
  }
  return generic;
}

/**
 * One notification per new warning (risk or warn) of the overview, keyed `warning:<kind>:<key>`: a warning already
 * notified is never sent again while its row exists (a deleted one stays hidden until the 90-day purge). Returns how many
 * were written.
 */
export async function notifyWarnings(db: Db, userId: string, items: readonly WarningItem[]): Promise<number> {
  let written = 0;
  for (const item of items) {
    const title = warningTitle(item);
    if (!title || item.level === "ok" || !item.key.trim() || !item.text.trim()) continue;
    const link = item.action && isPortalPage(item.action.link) ? item.action.link : null;
    if (await notify(db, userId, {
      type: "warn", kind: "warning", title, body: item.text, link, linkLabel: link ? item.action!.label : null,
      sourceKey: `warning:${item.kind}:${item.key}`,
    })) written += 1;
  }
  return written;
}
