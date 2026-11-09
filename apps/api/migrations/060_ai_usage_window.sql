-- Workers AI counts a free account's 10,000 neurons over the last 24 hours, not from 00:00 UTC (user test 2026-11-09: the
-- test account answered 4006 at 05:45 UTC after about 4,300 neurons that UTC day, with about 5,000 more spent the evening
-- before; the main account stayed blocked long after 00:00 UTC while its dashboard said 0/10k). So the neurons are counted
-- per hour and the budget is the sum of the last 24 hours (ai-worker/budget.ts), and a 4006 answer all the same stops
-- every Workers AI call of this server for an hour (ai_quota_block) instead of asking again and again. Replaces
-- ai_daily_usage (059).
CREATE TABLE public.ai_usage_hours (
  hour timestamptz PRIMARY KEY,
  neurons double precision NOT NULL DEFAULT 0 CHECK (neurons >= 0),
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ai_quota_block (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  blocked_until timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 60),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TABLE IF EXISTS public.ai_daily_usage;

DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_usage_hours','ai_quota_block'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
