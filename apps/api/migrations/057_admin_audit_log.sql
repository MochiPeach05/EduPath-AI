-- 2026-10-31 (AD-REPORT-12, Nhật ký thao tác; user: "Triển khai đi"): who did what in the admin portal. One row per admin
-- change (accounts and roles, CTĐT, KHĐT, graduation standards, careers, skills, competency configuration, AI runs and
-- their saved results, announcements), per export of a report with students' names and per view of a student's
-- transcript. A row names the action and its object, never the data itself: no grades, no file contents. Rows are kept
-- one year; reading the log deletes older ones (at most once an hour). actor_name and actor_role are kept as they were,
-- so the log still reads right after an account is renamed or loses its role. search_text is the folded (lower case,
-- no diacritics) actor, action and summary for accent-insensitive search.
CREATE TABLE public.ad_audit_log (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL CHECK (length(btrim(actor_name)) BETWEEN 1 AND 200),
  actor_role TEXT CHECK (actor_role IS NULL OR length(actor_role) BETWEEN 1 AND 40),
  kind TEXT NOT NULL CHECK (kind IN ('account','training','career','competency','notify','report','access','other')),
  action TEXT NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 120),
  summary TEXT NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 500),
  target_type TEXT CHECK (target_type IS NULL OR length(target_type) BETWEEN 1 AND 60),
  target_id TEXT CHECK (target_id IS NULL OR length(target_id) BETWEEN 1 AND 200),
  method TEXT CHECK (method IS NULL OR method IN ('GET','POST','PUT','PATCH','DELETE')),
  path TEXT CHECK (path IS NULL OR length(path) BETWEEN 1 AND 300),
  search_text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ad_audit_log_created ON public.ad_audit_log(created_at DESC, id DESC);
CREATE INDEX ad_audit_log_kind ON public.ad_audit_log(kind, created_at DESC);
CREATE INDEX ad_audit_log_actor ON public.ad_audit_log(actor_name, created_at DESC);

DO $$ DECLARE r TEXT; BEGIN
  ALTER TABLE public.ad_audit_log ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.ad_audit_log FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ad_audit_log FROM %I', r);
    END IF;
  END LOOP;
END $$;
