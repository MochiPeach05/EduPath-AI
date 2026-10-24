-- 2026-10-24 (STU-AI-01, 02, 06, "Lộ trình học tập"): a 3-month study roadmap written by the local AI as an academic
-- advisor (courses to take, courses to improve, skills to study on one's own). A row is both the AI worker job (kind
-- "study_roadmap") and the stored roadmap. It is built from one competency assessment and goes with it (transcript
-- replaced or deleted, consent withdrawn, assessment pruned). ai_input is cleared once the job finishes.
CREATE TABLE public.stu_roadmaps (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL REFERENCES public.stu_comp_assessments(id) ON DELETE CASCADE,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  facts JSONB NOT NULL CHECK (jsonb_typeof(facts) = 'object'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  ai_input JSONB,
  ai_output JSONB,
  error_code TEXT,
  metrics JSONB,
  ai_model TEXT,
  ai_model_digest TEXT,
  ollama_version TEXT,
  prompt_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (window_end >= window_start)
);
CREATE UNIQUE INDEX stu_roadmaps_one_pending ON public.stu_roadmaps(user_id) WHERE status IN ('queued','processing');
CREATE INDEX stu_roadmaps_queue ON public.stu_roadmaps(status, created_at);
CREATE INDEX stu_roadmaps_recent ON public.stu_roadmaps(user_id, created_at DESC, id);
CREATE INDEX stu_roadmaps_assessment ON public.stu_roadmaps(assessment_id);
ALTER TABLE public.stu_roadmaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stu_roadmaps FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.stu_roadmaps FROM %I',r);
    END IF;
  END LOOP;
END $$;
