-- 2026-11-10 (QA: "Hàng đợi AI đang đầy … bấm “Tạo lại nhận xét” để xếp hàng lại" never came back by itself): a study
-- roadmap or a graduation advice asked for while the AI queue is full is kept as a 'deferred' row, like the competency
-- comments' ai_status 'deferred', and the server queues it again by itself once the queue has room (oldest first, from
-- the AI worker's claims: competency-assessment/ai/worker-router.ts). A deferred row holds no AI input: it is built from
-- the student's data when the row is queued. Each student has at most one queued, processing or deferred row per table.
ALTER TABLE public.stu_roadmaps DROP CONSTRAINT IF EXISTS stu_roadmaps_status_check;
ALTER TABLE public.stu_roadmaps ADD CONSTRAINT stu_roadmaps_status_check
  CHECK (status IN ('deferred','queued','processing','completed','failed','cancelled'));
DROP INDEX IF EXISTS public.stu_roadmaps_one_pending;
CREATE UNIQUE INDEX stu_roadmaps_one_pending ON public.stu_roadmaps(user_id) WHERE status IN ('deferred','queued','processing');

ALTER TABLE public.stu_grad_advice DROP CONSTRAINT IF EXISTS stu_grad_advice_status_check;
ALTER TABLE public.stu_grad_advice ADD CONSTRAINT stu_grad_advice_status_check
  CHECK (status IN ('deferred','queued','processing','completed','failed','cancelled'));
DROP INDEX IF EXISTS public.stu_grad_advice_one_pending;
CREATE UNIQUE INDEX stu_grad_advice_one_pending ON public.stu_grad_advice(user_id) WHERE status IN ('deferred','queued','processing');

-- The deferred comments, oldest first, for the same housekeeping.
CREATE INDEX stu_comp_assessments_deferred ON public.stu_comp_assessments(created_at, id) WHERE ai_status = 'deferred';
