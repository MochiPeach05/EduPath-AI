-- Neurons spent on Cloudflare Workers AI per UTC day (user 2026-11-09: "Hết limit rồi mà ta"). A free account that goes
-- over its 10,000 daily neurons stays blocked (error 4006) long after the 00:00 UTC reset, so the server counts what it
-- spends here and stops sending work before the day's allocation runs out (ai-worker/budget.ts).
CREATE TABLE public.ai_daily_usage (
  day date PRIMARY KEY,
  neurons double precision NOT NULL DEFAULT 0 CHECK (neurons >= 0),
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
