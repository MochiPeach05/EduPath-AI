-- 2026-11-23 (AD-NOTI-04, 05, 06; người dùng chọn gửi qua Microsoft Graph từ hộp thư trường của người gửi, thử thành công,
-- rồi duyệt: "Làm cả 04, 05, 06", "Chỉ sinh viên đã có tài khoản", "Cập nhật, không hỏi lại", "Dùng mặc định"): a faculty
-- announcement may also go to the school mailbox of each student with an EduPath AI account.
-- ad_mail_senders: a staff member's permission to send from their own mailbox (Microsoft's delegated Mail.Send), kept as
--   the MSAL token cache encrypted with a key derived from SESSION_SECRET (mail/grant-crypto.ts), with the mailbox's
--   address and tenant. Deleting the row (Thu hồi quyền gửi thư, or the account deleted) ends it at once.
-- ad_announcement_emails: one message per student of an announcement sent with email: queued with the announcement
--   (no_address when the account has no mailbox), sent by the mail worker (mail/worker.ts) from the sender's mailbox at
--   most 25 a minute, retried after a temporary error, cancelled when the announcement is withdrawn first. Only the
--   address, the outcome and an error code are kept, for 90 days like the notifications.
-- ad_notification_settings: AD-NOTI-06, the automatic notifications an admin turned off (no row: on). The faculty's
--   announcements and the notifications of a cố vấn học tập's actions are always written.
ALTER TABLE public.ad_announcements
  ADD COLUMN email_requested BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN email_sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN email_from TEXT CHECK (email_from IS NULL OR length(email_from) BETWEEN 3 AND 320);

CREATE TABLE public.ad_mail_senders (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  address TEXT NOT NULL CHECK (length(btrim(address)) BETWEEN 3 AND 320),
  tenant_id TEXT NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 100),
  token_cache TEXT NOT NULL CHECK (length(token_cache) BETWEEN 1 AND 200000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 80)
);

CREATE TABLE public.ad_announcement_emails (
  id UUID PRIMARY KEY,
  announcement_id UUID NOT NULL REFERENCES public.ad_announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  address TEXT CHECK (address IS NULL OR length(address) BETWEEN 3 AND 320),
  status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','failed','cancelled','no_address')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error TEXT CHECK (error IS NULL OR length(error) <= 80),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);
CREATE INDEX ad_announcement_emails_due ON public.ad_announcement_emails(next_attempt_at, created_at) WHERE status = 'pending';
CREATE INDEX ad_announcement_emails_announcement ON public.ad_announcement_emails(announcement_id, status);
CREATE INDEX ad_announcement_emails_created ON public.ad_announcement_emails(created_at);

CREATE TABLE public.ad_notification_settings (
  setting TEXT PRIMARY KEY CHECK (setting IN ('transcript','assessment_comment','roadmap','graduation_advice','warning','catalog_updated')),
  enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ad_mail_senders','ad_announcement_emails','ad_notification_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
