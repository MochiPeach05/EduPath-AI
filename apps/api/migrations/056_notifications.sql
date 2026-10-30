-- 2026-10-30 (STU-PROG-04…09, AD-NOTI-01/02; user: "Ok triển khai đi"): the notifications of the student portal's bell
-- and the faculty's announcements. The system writes a notification when an AI job finishes (transcript read, competency
-- comment, AI roadmap, graduation advice), when a "Cần chú ý" warning of the overview appears and when the faculty
-- changes a student's catalog; the faculty sends announcements to cohorts and majors. Delivery is in EduPath AI only
-- (email later). A notification is deleted 90 days after it was created; the student's own deletion is soft for a moment
-- so it can be undone. source_key makes every producer idempotent: one row per (student, event).
CREATE TABLE public.ad_announcements (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  link TEXT CHECK (link IS NULL OR link ~ '^#[a-z][a-z-]*$'),
  target JSONB NOT NULL DEFAULT '{"cohorts": [], "majors": []}'::jsonb CHECK (jsonb_typeof(target) = 'object'),
  recipients INTEGER NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ
);
CREATE INDEX ad_announcements_created ON public.ad_announcements(created_at DESC, id);

CREATE TABLE public.stu_notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('ai','warn','khoa','sys')),
  kind TEXT NOT NULL CHECK (kind IN ('transcript_ready','transcript_failed','assessment_comment','roadmap_ready','roadmap_failed',
    'graduation_advice','warning','catalog_updated','announcement')),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  link TEXT CHECK (link IS NULL OR link ~ '^#[a-z][a-z-]*$'),
  link_label TEXT CHECK (link_label IS NULL OR length(link_label) BETWEEN 1 AND 80),
  source_key TEXT CHECK (source_key IS NULL OR length(source_key) BETWEEN 1 AND 300),
  announcement_id UUID REFERENCES public.ad_announcements(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stu_notifications_source ON public.stu_notifications(user_id, source_key) WHERE source_key IS NOT NULL;
CREATE INDEX stu_notifications_user ON public.stu_notifications(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX stu_notifications_unread ON public.stu_notifications(user_id) WHERE deleted_at IS NULL AND read_at IS NULL;
CREATE INDEX stu_notifications_announcement ON public.stu_notifications(announcement_id) WHERE announcement_id IS NOT NULL;
CREATE INDEX stu_notifications_created ON public.stu_notifications(created_at);

DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ad_announcements','stu_notifications'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
