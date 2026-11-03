-- 2026-11-03 (AD-ADV-01…05, AD-AST-01…09; user: "Giờ làm phần nhóm chức năng quản lý cố vấn học tập này đi"): cố vấn
-- học tập (CVHT). The Khoa (admins, Ban chủ nhiệm khoa) imports or adds the advisors with the classes each one advises;
-- an advisor's account is created ahead of the first Microsoft sign-in, under the new role 'advisor' (read-only in the
-- admin portal). An advisor opens the student portal of a student of their classes and may do for them what the policy
-- of 2026-11-03 allows (import the transcript, run the competency assessment, the AI roadmap and the graduation advice,
-- ask Trợ lý AI); each such action is logged (kind 'advisor') and told to the student by a notification (kind
-- 'advisor_action'). A Trợ lý AI conversation records who started it: an advisor sees only the conversations they
-- started in the student's account, the student sees all of them.
ALTER TABLE public.users DROP CONSTRAINT users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('student', 'admin', 'faculty_board', 'department_head', 'lecturer', 'advisor'));
ALTER TABLE public.users DROP CONSTRAINT users_role_override_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_override_check
  CHECK (role_override IN ('student', 'admin', 'faculty_board', 'department_head', 'lecturer', 'advisor'));

-- The advisor's details as the Khoa's list gives them; the name and email of the account stay in users.
CREATE TABLE public.ad_advisors (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 200),
  staff_code TEXT CHECK (staff_code IS NULL OR length(btrim(staff_code)) BETWEEN 1 AND 50),
  unit TEXT CHECK (unit IS NULL OR length(btrim(unit)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- One advisor per class. class_name is the class of student_profiles.class_name, upper case without spaces around
-- ("71K29CNTT01"); a class may be listed before any of its students signs in.
CREATE TABLE public.ad_advisor_classes (
  class_name TEXT PRIMARY KEY CHECK (class_name = upper(btrim(class_name)) AND length(class_name) BETWEEN 2 AND 40),
  advisor_user_id UUID NOT NULL REFERENCES public.ad_advisors(user_id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX ad_advisor_classes_advisor ON public.ad_advisor_classes(advisor_user_id, class_name);

-- Who started a Trợ lý AI conversation: NULL for the student, an advisor's user id otherwise.
ALTER TABLE public.stu_chat_threads ADD COLUMN created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.stu_notifications DROP CONSTRAINT IF EXISTS stu_notifications_kind_check;
ALTER TABLE public.stu_notifications ADD CONSTRAINT stu_notifications_kind_check CHECK (kind IN ('transcript_ready',
  'transcript_failed','assessment_comment','roadmap_ready','roadmap_failed','graduation_advice','warning','catalog_updated',
  'announcement','advisor_action'));

ALTER TABLE public.ad_audit_log DROP CONSTRAINT IF EXISTS ad_audit_log_kind_check;
ALTER TABLE public.ad_audit_log ADD CONSTRAINT ad_audit_log_kind_check
  CHECK (kind IN ('account','training','career','competency','notify','report','access','advisor','other'));

DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ad_advisors','ad_advisor_classes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
