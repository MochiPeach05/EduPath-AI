-- 2026-11-28 (người dùng, xem trang Lịch đăng ký học tập: "Xóa cái lịch đăng ký này đi nó không liên quan gì hết á"):
-- Lịch đăng ký học tập (069, commit e5fab1c) is removed. This drops its table and takes the notification kind
-- registration_reminder and the setting 'registration' out again, with the checks of 058 and 067. Reminders that went
-- out (none on 28/11) leave the bells; their email rows keep the outcome without the notification (ON DELETE SET NULL).
DELETE FROM public.stu_notification_emails WHERE kind = 'registration_reminder' AND status IN ('pending', 'sending');
DELETE FROM public.stu_notifications WHERE kind = 'registration_reminder';
DELETE FROM public.ad_notification_settings WHERE setting = 'registration';
DROP TABLE IF EXISTS public.ad_registration_windows;

ALTER TABLE public.stu_notifications DROP CONSTRAINT IF EXISTS stu_notifications_kind_check;
ALTER TABLE public.stu_notifications ADD CONSTRAINT stu_notifications_kind_check CHECK (kind IN ('transcript_ready',
  'transcript_failed','assessment_comment','roadmap_ready','roadmap_failed','graduation_advice','warning','catalog_updated',
  'announcement','advisor_action'));

ALTER TABLE public.ad_notification_settings DROP CONSTRAINT IF EXISTS ad_notification_settings_setting_check;
ALTER TABLE public.ad_notification_settings ADD CONSTRAINT ad_notification_settings_setting_check CHECK (setting IN (
  'transcript','assessment_comment','roadmap','graduation_advice','warning','catalog_updated','advisor_action'));
