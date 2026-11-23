-- 2026-11-23 (người dùng: "Phần cài đặt thông báo thêm 1 chức năng nữa ngoài có thể cập nhật thông báo cho thông báo ở
-- trang sinh viên thì có thể gửi tới email những thông báo này nữa"): in Cài đặt thông báo an admin may also send each
-- kind of automatic notification to the students' school mailbox (AD-NOTI-06 with AD-NOTI-04, 05; off by default).
-- ad_notification_settings.email_enabled: the kind also goes by email. The setting advisor_action (Việc làm thay sinh
--   viên) exists only for its email: its bell notification is always written.
-- ad_notification_mail: one row naming whose school mailbox sends these emails (the permission is in ad_mail_senders).
-- stu_notification_emails: one message per notification written while its kind's email was on, queued with the
--   notification and sent by the mail worker (mail/worker.ts) like the announcement emails, from the mailbox named when it
--   was queued. Only the address, the outcome and an error code are kept, for 90 days like the notifications; a message
--   whose notification is gone before it is sent is cancelled.
ALTER TABLE public.ad_notification_settings ADD COLUMN email_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.ad_notification_settings DROP CONSTRAINT IF EXISTS ad_notification_settings_setting_check;
ALTER TABLE public.ad_notification_settings ADD CONSTRAINT ad_notification_settings_setting_check CHECK (setting IN (
  'transcript','assessment_comment','roadmap','graduation_advice','warning','catalog_updated','advisor_action'));
ALTER TABLE public.ad_notification_settings ADD CONSTRAINT ad_notification_settings_advisor_bell CHECK (setting <> 'advisor_action' OR enabled);

CREATE TABLE public.ad_notification_mail (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE public.stu_notification_emails (
  id UUID PRIMARY KEY,
  notification_id UUID UNIQUE REFERENCES public.stu_notifications(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  address TEXT CHECK (address IS NULL OR length(address) BETWEEN 3 AND 320),
  status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','failed','cancelled','no_address')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error TEXT CHECK (error IS NULL OR length(error) <= 80),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stu_notification_emails_due ON public.stu_notification_emails(sender_id, next_attempt_at, created_at) WHERE status = 'pending';
CREATE INDEX stu_notification_emails_created ON public.stu_notification_emails(created_at);

DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ad_notification_mail','stu_notification_emails'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
