-- 2026-11-25 (người dùng, gửi kèm thông báo đăng ký học phần HK252, HK253, HK261 của Phòng Đào tạo: "Hãy dựa vào cái lịch
-- này thêm 1 cái nút thông báo nhắc nhở đăng ký kế hoạch học tập khi đến thời gian"): Lịch đăng ký học tập. An admin enters
-- each window of the official notice (đăng ký kế hoạch học tập or đăng ký học phần, its đợt, cohorts and times); when a
-- window's time comes EduPath AI reminds its students in the bell (type sys, kind registration_reminder, under EduPath AI's
-- name), and by email when the kind's email is on in Cài đặt thông báo (setting 'registration').
-- ad_registration_windows.remind_at: when the reminder goes out (the opening, or one or two days before it); reminded_at and
--   outcome say what happened (sent, closed: the window ended first, turned_off: the kind is off, nobody: no student);
--   withdrawn_at: the reminder was taken out of the bells. The reminder's notifications carry source_key registration:<id>.
ALTER TABLE public.stu_notifications DROP CONSTRAINT IF EXISTS stu_notifications_kind_check;
ALTER TABLE public.stu_notifications ADD CONSTRAINT stu_notifications_kind_check CHECK (kind IN ('transcript_ready',
  'transcript_failed','assessment_comment','roadmap_ready','roadmap_failed','graduation_advice','warning','catalog_updated',
  'announcement','advisor_action','registration_reminder'));

ALTER TABLE public.ad_notification_settings DROP CONSTRAINT IF EXISTS ad_notification_settings_setting_check;
ALTER TABLE public.ad_notification_settings ADD CONSTRAINT ad_notification_settings_setting_check CHECK (setting IN (
  'transcript','assessment_comment','roadmap','graduation_advice','warning','catalog_updated','advisor_action','registration'));

CREATE TABLE public.ad_registration_windows (
  id UUID PRIMARY KEY,
  term_code TEXT NOT NULL CHECK (term_code ~ '^HK[0-9]{2}[1-3]$'),
  kind TEXT NOT NULL CHECK (kind IN ('study_plan', 'course')),
  round TEXT NOT NULL CHECK (length(btrim(round)) BETWEEN 1 AND 60),
  cohorts TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(cohorts) <= 30),
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  remind_before INTEGER NOT NULL DEFAULT 0 CHECK (remind_before IN (0, 1440, 2880)),
  remind_at TIMESTAMPTZ NOT NULL,
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  reminded_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('sent', 'closed', 'turned_off', 'nobody')),
  recipients INTEGER CHECK (recipients IS NULL OR recipients >= 0),
  withdrawn_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at),
  CHECK (remind_at <= opens_at)
);
CREATE INDEX ad_registration_windows_due ON public.ad_registration_windows(remind_at) WHERE reminded_at IS NULL;

ALTER TABLE public.ad_registration_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_registration_windows FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ad_registration_windows FROM %I', r);
    END IF;
  END LOOP;
END $$;
