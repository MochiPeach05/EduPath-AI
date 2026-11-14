-- 2026-11-14 (góp ý của GVHD, người dùng: "Quản lý sinh viên theo lớp của CVHT: Không được chỉ lấy sinh viên đã đăng nhập
-- hệ thống. Cố vấn có thể import trước danh sách sinh viên đầy đủ của lớp, kể cả sinh viên chưa tạo tài khoản hoặc chưa
-- đăng nhập."): the class lists (danh sách lớp) imported ahead of the students' first sign-in, by a cố vấn học tập for the
-- classes the Khoa assigned them (ad_advisor_classes) and by admins and Ban chủ nhiệm khoa for any class
-- (advisors/roster*.ts). One row per student holding only what the list needs: the MSSV, the name, the class and the
-- school email when the file has one; the other columns of the file (ngày sinh, điện thoại, địa chỉ…) are never stored.
-- A listed student who never signed in has no account and nothing else: no transcript, no AI, no notification. The
-- account their first Microsoft sign-in creates, as before, carries the MSSV in student_profiles.student_code (005, 044:
-- upper case, unique); the row is matched by it, so the student is listed once, and the class of the list is the
-- student's class in the admin portal (advisors/class-code.ts CLASS_OF).
CREATE TABLE public.ad_class_students (
  student_code TEXT PRIMARY KEY CHECK (student_code ~ '^([0-9]{8,32}|[0-9]{3}[A-Z]{2}[0-9]{5})$'),
  full_name TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 200),
  class_name TEXT NOT NULL CHECK (class_name = upper(btrim(class_name)) AND length(class_name) BETWEEN 2 AND 40),
  email TEXT CHECK (email IS NULL OR (email = lower(btrim(email)) AND length(email) BETWEEN 6 AND 320)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX ad_class_students_class ON public.ad_class_students(class_name, student_code);
-- One mailbox is one student.
CREATE UNIQUE INDEX ad_class_students_email ON public.ad_class_students(email) WHERE email IS NOT NULL;

DO $$ DECLARE r TEXT; BEGIN
  EXECUTE 'ALTER TABLE public.ad_class_students ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON public.ad_class_students FROM PUBLIC';
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ad_class_students FROM %I', r);
    END IF;
  END LOOP;
END $$;
