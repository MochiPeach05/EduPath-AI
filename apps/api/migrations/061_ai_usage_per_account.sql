-- The Workers AI budget per Cloudflare account (user 2026-11-09: "Tôi đã đổi key rồi nhưng sao nó k chạy nhỉ"): after
-- the keys on Render were changed to a new account, the one-hour stop the old account's 4006 answer had written kept the
-- new account waiting too, and the old account's neurons would have counted against the new one's 10,000. Both tables
-- now carry the account (the first 16 hex characters of the SHA-256 of its id, never the id itself), so a new account
-- starts with no stop and an empty count. Replaces the tables of 060 (nothing in them is needed: hours of usage and one
-- stop that ends within the hour).
DROP TABLE IF EXISTS public.ai_usage_hours;
DROP TABLE IF EXISTS public.ai_quota_block;
CREATE TABLE public.ai_usage_hours (
  account text NOT NULL CHECK (account ~ '^[0-9a-f]{16}$' OR account = 'none'),
  hour timestamptz NOT NULL,
  neurons double precision NOT NULL DEFAULT 0 CHECK (neurons >= 0),
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account, hour)
);
CREATE TABLE public.ai_quota_block (
  account text PRIMARY KEY CHECK (account ~ '^[0-9a-f]{16}$' OR account = 'none'),
  blocked_until timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 60),
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
