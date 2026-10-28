-- 2026-10-28 (STU-CHAT-01..05, "Trợ lý AI"): the student's conversations with the AI study assistant. The local Gemma
-- worker answers from the student's own computed results (newest competency assessment, roadmap, plan progress) and
-- from a shared knowledge index of the catalogs (courses, skills, careers, programs, training plans, graduation
-- standards, guides, curated self-study resources). An assistant message is also the AI worker job (kind
-- "assistant_chat"); its ai_input is cleared once the job ends. Conversations go with the account; the student deletes
-- them, and a conversation without a new message for 90 days is deleted.
CREATE TABLE public.stu_chat_threads (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stu_chat_threads_user ON public.stu_chat_threads(user_id, updated_at DESC, id);

CREATE TABLE public.stu_chat_messages (
  id UUID PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.stu_chat_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 20000),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  intents TEXT[] NOT NULL DEFAULT '{}',
  sources JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  warnings JSONB,
  feedback SMALLINT CHECK (feedback IN (-1, 1)),
  error_code TEXT,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  ai_input JSONB,
  metrics JSONB,
  ai_model TEXT,
  ai_model_digest TEXT,
  ollama_version TEXT,
  prompt_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX stu_chat_messages_thread ON public.stu_chat_messages(thread_id, created_at, id);
CREATE UNIQUE INDEX stu_chat_messages_one_pending ON public.stu_chat_messages(thread_id) WHERE status IN ('queued','processing');
CREATE INDEX stu_chat_messages_queue ON public.stu_chat_messages(created_at, id) WHERE status IN ('queued','processing');
CREATE INDEX stu_chat_messages_user ON public.stu_chat_messages(user_id, created_at DESC);

-- Shared knowledge only (catalogs, never student data): one row per source item, rebuilt from the catalog tables. A
-- changed text gets a new content_hash and loses its embedding until the worker embeds it again (kind
-- "knowledge_embedding", a batch of chunks per job).
CREATE TABLE public.ai_knowledge_chunks (
  id UUID PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 40),
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 300),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 8000),
  link TEXT,
  content_hash TEXT NOT NULL,
  embedding REAL[],
  embedding_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_key)
);

CREATE TABLE public.ai_knowledge_jobs (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  ai_input JSONB,
  error_code TEXT,
  metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX ai_knowledge_jobs_queue ON public.ai_knowledge_jobs(created_at, id) WHERE status IN ('queued','processing');

DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['stu_chat_threads','stu_chat_messages','ai_knowledge_chunks','ai_knowledge_jobs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
