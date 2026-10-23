-- 2026-10-23 (STU-PLAN-01–07, "Lộ trình học tập"): one study plan per student. The document holds the courses the
-- student placed in each future term and, per course, the weekly sessions (LT/TH) placed on a day × 3-period block.
-- The API validates its shape (study-plan/model.ts); deleting the account deletes the plan.
CREATE TABLE public.stu_study_plans (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  version UUID NOT NULL,
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stu_study_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stu_study_plans FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.stu_study_plans FROM %I',r);
    END IF;
  END LOOP;
END $$;
