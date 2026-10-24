-- 2026-10-24 (user): "Khảo sát định hướng" in the student profile, ten single-choice questions (goal after graduation,
-- preferred environment, kind of company, part-time work, team leading, projects outside courses, internship, weekly
-- self-study time, English for IT, field of interest) and achievements (contests, awards, titles, scholarships): a
-- required yes/no, then a required list when yes. The AI study roadmap uses them (policy 2026-10-24), so saving them
-- needs the new consent purpose 'profile_survey'. One row per student; removed with the account.
CREATE TABLE public.stu_profile_surveys (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  survey_version TEXT NOT NULL CHECK (survey_version ~ '^survey-v[0-9]+$'),
  answers JSONB NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  has_achievements BOOLEAN NOT NULL,
  achievements TEXT CHECK (achievements IS NULL OR char_length(achievements) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (has_achievements = (achievements IS NOT NULL))
);
ALTER TABLE public.stu_profile_surveys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stu_profile_surveys FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.stu_profile_surveys FROM %I',r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.data_consents DROP CONSTRAINT data_consents_purpose_allowed;
ALTER TABLE public.data_consents ADD CONSTRAINT data_consents_purpose_allowed
  CHECK (purpose IN ('transcript_processing','competency_assessment','profile_survey'));
