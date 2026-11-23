// Cài đặt thông báo (AD-NOTI-06, 2026-11-23; function list: "bật/tắt từng loại thông báo được phép gửi bên trang sinh
// viên"): an admin may stop a kind of automatic notification. A row of ad_notification_settings (migration 066) with
// enabled=false turns it off; no row means on. Turning a kind off stops new notifications only: those already in a bell stay.
// The faculty's announcements and the notifications of a cố vấn học tập's actions are always written (the privacy policy
// promises the student is told whenever someone acts for them).
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";

type Db = Pick<DatabasePool, "query"> | Pick<PoolClient, "query">;

export const NOTIFICATION_SETTINGS = [
  { key: "transcript", label: "Đọc bảng điểm", detail: "Bảng điểm PDF sinh viên tải lên đã đọc xong, hoặc chưa đọc được." },
  { key: "assessment_comment", label: "Nhận xét năng lực của AI", detail: "AI viết xong nhận xét sau một lần Đánh giá năng lực." },
  { key: "roadmap", label: "Lộ trình AI", detail: "Lộ trình học tập AI gợi ý đã xong, hoặc chưa tạo được." },
  { key: "graduation_advice", label: "Nhận xét xét tốt nghiệp của AI", detail: "AI viết xong nhận xét ở trang Xét tốt nghiệp." },
  { key: "warning", label: "Cảnh báo chậm tiến độ", detail: "Một cảnh báo mới xuất hiện ở trang Tổng quan của sinh viên." },
  { key: "catalog_updated", label: "Khoa cập nhật dữ liệu học tập", detail: "Khoa thay đổi chương trình đào tạo, kế hoạch đào tạo hoặc tiêu chuẩn xét tốt nghiệp của sinh viên." },
] as const;
export type NotificationSettingKey = (typeof NOTIFICATION_SETTINGS)[number]["key"];
export const NOTIFICATION_SETTING_KEYS = NOTIFICATION_SETTINGS.map((item) => item.key) as [NotificationSettingKey, ...NotificationSettingKey[]];

/** SQL: the setting a notification kind (a text expression) belongs to; announcement and advisor_action belong to none. */
export const settingOfKind = (kind: string) =>
  `(CASE WHEN ${kind} IN ('transcript_ready','transcript_failed') THEN 'transcript' WHEN ${kind} IN ('roadmap_ready','roadmap_failed') THEN 'roadmap' ELSE ${kind} END)`;
/** SQL: true when an admin turned the kind off. */
export const kindTurnedOff = (kind: string) => `EXISTS (SELECT 1 FROM ad_notification_settings s WHERE NOT s.enabled AND s.setting=${settingOfKind(kind)})`;

export type NotificationSetting = { key: NotificationSettingKey; label: string; detail: string; enabled: boolean; updatedAt: string | null; updatedBy: string | null };

export async function listNotificationSettings(db: Db): Promise<NotificationSetting[]> {
  const rows = (await db.query<{ setting: NotificationSettingKey; enabled: boolean; updatedAt: Date | string; updatedBy: string | null }>(
    `SELECT s.setting,s.enabled,s.updated_at AS "updatedAt",u.display_name AS "updatedBy"
      FROM ad_notification_settings s LEFT JOIN users u ON u.id=s.updated_by`)).rows;
  return NOTIFICATION_SETTINGS.map((item) => {
    const row = rows.find((candidate) => candidate.setting === item.key);
    return { ...item, enabled: row?.enabled ?? true, updatedAt: row ? new Date(row.updatedAt).toISOString() : null, updatedBy: row?.updatedBy ?? null };
  });
}

export async function saveNotificationSetting(db: Db, key: NotificationSettingKey, enabled: boolean, actorId: string): Promise<NotificationSetting> {
  await db.query(
    `INSERT INTO ad_notification_settings(setting,enabled,updated_by) VALUES($1,$2,$3)
      ON CONFLICT (setting) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now(),updated_by=EXCLUDED.updated_by`, [key, enabled, actorId]);
  return (await listNotificationSettings(db)).find((item) => item.key === key)!;
}
