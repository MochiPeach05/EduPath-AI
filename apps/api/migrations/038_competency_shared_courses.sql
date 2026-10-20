-- AD-COMP 2026-10-20, "Cấu hình môn học" (user): a course is configured once for every cohort instead
-- of once per CTĐT revision. A shared course ("môn học") is one (code, name, credits): the code
-- trimmed and in capitals, the name without letter case or whitespace ("Block chain" and "Blockchain"
-- are one course), the credits without trailing zeros. A curriculum row with the same three is the
-- same course; a row that differs in one of them is another course. Cohorts only filter the list.
--  1. ad_comp_courses holds the shared courses and curriculum_courses.course_id points to one. A
--     trigger fills it for every new curriculum row, so an import adds a course only when its code,
--     name or credits are new (the newest import gives the displayed spelling).
--  2. ad_comp_course_configs gets course_id: one configuration per course. Where several cohorts had
--     their own configuration of the same course, the newest cohort's one is kept (an applied one
--     first, then one with links); the others are written to the course's history and removed, and
--     merged_from names the cohorts whose configuration was different. revision_id and course_code
--     stay as the origin of a kept configuration; new configurations leave them NULL.
--  3. History events of a course are keyed by the course id instead of "revision:code".
--  4. AI proposals get course_id (revision_id and course_code stay the source of the course data
--     sent to the model): one pending proposal per course and mode.
SELECT pg_advisory_xact_lock(1946032027);

CREATE FUNCTION public.ad_comp_course_key(code TEXT, name TEXT, credits NUMERIC) RETURNS TEXT
 LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT upper(btrim(code)) || '|'
   || lower(regexp_replace(normalize(name, NFC), '[[:space:]  -​  　﻿]+', '', 'g'))
   || '|' || trim_scale(credits)::text
$$;

CREATE TABLE public.ad_comp_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_key TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  credits NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The displayed spelling of an existing course is the newest cohort's.
INSERT INTO public.ad_comp_courses(course_key, code, name, credits)
SELECT DISTINCT ON (k.course_key) k.course_key, upper(btrim(k.code)), regexp_replace(btrim(k.name), '\s+', ' ', 'g'), trim_scale(k.credits)
FROM (SELECT public.ad_comp_course_key(cc.code, cc.name, cc.credits) AS course_key, cc.code, cc.name, cc.credits,
        cu.cohort_code, r.version
      FROM public.curriculum_courses cc JOIN public.curriculum_revisions r ON r.id=cc.revision_id
      JOIN public.curricula cu ON cu.id=r.curriculum_id) k
ORDER BY k.course_key, NULLIF(regexp_replace(k.cohort_code, '\D', '', 'g'), '')::int DESC NULLS LAST, k.cohort_code DESC, k.version DESC;

ALTER TABLE public.curriculum_courses ADD COLUMN course_id UUID REFERENCES public.ad_comp_courses(id);
UPDATE public.curriculum_courses cc SET course_id=c.id FROM public.ad_comp_courses c
 WHERE c.course_key=public.ad_comp_course_key(cc.code, cc.name, cc.credits);
ALTER TABLE public.curriculum_courses ALTER COLUMN course_id SET NOT NULL;
CREATE INDEX curriculum_courses_course ON public.curriculum_courses(course_id);

CREATE FUNCTION public.ad_comp_curriculum_course() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.ad_comp_courses(course_key, code, name, credits)
   VALUES (public.ad_comp_course_key(NEW.code, NEW.name, NEW.credits), upper(btrim(NEW.code)), regexp_replace(btrim(NEW.name), '\s+', ' ', 'g'),
     trim_scale(NEW.credits))
   ON CONFLICT (course_key) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name, credits=EXCLUDED.credits, updated_at=now()
   RETURNING id INTO NEW.course_id;
 RETURN NEW;
END $$;
CREATE TRIGGER ad_comp_course_of_curriculum BEFORE INSERT OR UPDATE OF code, name, credits ON public.curriculum_courses
 FOR EACH ROW EXECUTE FUNCTION public.ad_comp_curriculum_course();

-- 2. One configuration per course.
ALTER TABLE public.ad_comp_course_configs
  ADD COLUMN course_id UUID REFERENCES public.ad_comp_courses(id),
  ADD COLUMN merged_from TEXT[] NOT NULL DEFAULT '{}',
  ALTER COLUMN revision_id DROP NOT NULL,
  ALTER COLUMN course_code DROP NOT NULL;
UPDATE public.ad_comp_course_configs c SET course_id=cc.course_id FROM public.curriculum_courses cc
 WHERE cc.revision_id=c.revision_id AND cc.code=c.course_code;

-- 3. Events of a course are keyed by its id (before the merge events below are written).
UPDATE public.ad_comp_events e SET entity_key=cc.course_id::text
FROM public.curriculum_courses cc
WHERE e.kind='course' AND position(':' IN e.entity_key)=37
  AND cc.revision_id::text=left(e.entity_key, 36) AND cc.code=substr(e.entity_key, 38);

CREATE TEMP TABLE ad_comp_merge ON COMMIT DROP AS
SELECT c.id, c.course_id, c.revision_id, c.course_code, c.status, c.note, c.version,
  format('%s · phiên bản %s', cu.cohort_code, r.version) AS label,
  row_number() OVER (PARTITION BY c.course_id ORDER BY
    CASE WHEN c.status='active' THEN 0 WHEN EXISTS(SELECT 1 FROM public.ad_comp_course_links l WHERE l.config_id=c.id) THEN 1 ELSE 2 END,
    NULLIF(regexp_replace(cu.cohort_code, '\D', '', 'g'), '')::int DESC NULLS LAST, cu.cohort_code DESC, r.version DESC,
    c.updated_at DESC, c.id) AS rank,
  count(*) OVER (PARTITION BY c.course_id) AS total,
  false AS differs
FROM public.ad_comp_course_configs c
JOIN public.curriculum_revisions r ON r.id=c.revision_id JOIN public.curricula cu ON cu.id=r.curriculum_id;
DELETE FROM ad_comp_merge WHERE total=1;
-- A configuration differs from the kept one by its status or by any link or weight.
UPDATE ad_comp_merge m SET differs = m.status IS DISTINCT FROM w.status OR EXISTS(
    (SELECT l.skill_id, l.weight FROM public.ad_comp_course_links l WHERE l.config_id=m.id
     EXCEPT SELECT l.skill_id, l.weight FROM public.ad_comp_course_links l WHERE l.config_id=w.id)
    UNION ALL
    (SELECT l.skill_id, l.weight FROM public.ad_comp_course_links l WHERE l.config_id=w.id
     EXCEPT SELECT l.skill_id, l.weight FROM public.ad_comp_course_links l WHERE l.config_id=m.id))
FROM ad_comp_merge w WHERE w.course_id=m.course_id AND w.rank=1 AND m.rank>1;

-- Every merged configuration stays in the course's history: the kept one as the newest entry, each
-- removed one just before it, with the links and weights it had.
INSERT INTO public.ad_comp_events(kind, entity_key, actor_id, snapshot, note, created_at)
SELECT 'course', m.course_id::text, NULL,
  jsonb_build_object('revisionId', m.revision_id, 'courseCode', m.course_code, 'courseName', cc.name, 'configId', m.id,
    'status', m.status, 'version', m.version, 'note', m.note,
    'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('skillId', l.skill_id, 'skillName', s.name, 'groupId', cs.group_id,
        'groupName', g.name, 'isActive', (cs.is_active AND cs.deleted_at IS NULL AND g.is_active AND s.deleted_at IS NULL),
        'weight', l.weight::float8) ORDER BY g.name, s.name, s.id)
      FROM public.ad_comp_course_links l JOIN public.ad_comp_skills cs ON cs.skill_id=l.skill_id
      JOIN public.career_skills s ON s.id=cs.skill_id JOIN public.ad_comp_groups g ON g.id=cs.group_id
      WHERE l.config_id=m.id), '[]'::jsonb)),
  CASE WHEN m.rank=1
    THEN format('Dùng chung cấu hình của %s cho mọi khóa có môn học này (gộp %s cấu hình theo khóa).', m.label, m.total)
    ELSE format('Cấu hình riêng của %s trước khi dùng chung môn học; được thay bằng cấu hình của %s.', m.label, w.label) END,
  CASE WHEN m.rank=1 THEN now() ELSE now() - interval '1 millisecond' END
FROM ad_comp_merge m JOIN ad_comp_merge w ON w.course_id=m.course_id AND w.rank=1
JOIN public.curriculum_courses cc ON cc.revision_id=m.revision_id AND cc.code=m.course_code;

UPDATE public.ad_comp_course_configs c SET merged_from=x.labels
FROM (SELECT course_id, array_agg(label ORDER BY rank) AS labels FROM ad_comp_merge WHERE rank>1 AND differs GROUP BY course_id) x
WHERE c.course_id=x.course_id AND c.id IN (SELECT id FROM ad_comp_merge WHERE rank=1);
DELETE FROM public.ad_comp_course_links WHERE config_id IN (SELECT id FROM ad_comp_merge WHERE rank>1);
DELETE FROM public.ad_comp_course_configs WHERE id IN (SELECT id FROM ad_comp_merge WHERE rank>1);

-- The deferred weight checks run now: a table with pending trigger events cannot be altered.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.ad_comp_course_configs ALTER COLUMN course_id SET NOT NULL,
  ADD CONSTRAINT ad_comp_course_configs_course_id_key UNIQUE (course_id);
CREATE OR REPLACE FUNCTION public.ad_comp_pin_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revision_id IS DISTINCT FROM OLD.revision_id OR NEW.course_code IS DISTINCT FROM OLD.course_code
   OR NEW.course_id IS DISTINCT FROM OLD.course_id THEN
   RAISE EXCEPTION 'competency_scope_immutable' USING ERRCODE='23514',CONSTRAINT='competency_scope_immutable';
 END IF;
 RETURN NEW;
END $$;

-- 4. AI proposals of a course; of several pending ones per course and mode the newest is kept.
ALTER TABLE public.ad_comp_ai_suggestions ADD COLUMN course_id UUID REFERENCES public.ad_comp_courses(id);
UPDATE public.ad_comp_ai_suggestions s SET course_id=cc.course_id FROM public.curriculum_courses cc
 WHERE cc.revision_id=s.revision_id AND cc.code=s.course_code;
UPDATE public.ad_comp_ai_suggestions s SET status='cancelled', ai_input=NULL, lease_token=NULL, lease_until=NULL, updated_at=now()
 WHERE s.status IN ('queued','processing') AND EXISTS(SELECT 1 FROM public.ad_comp_ai_suggestions o
   WHERE o.course_id=s.course_id AND o.mode=s.mode AND o.status IN ('queued','processing') AND (o.created_at, o.id) > (s.created_at, s.id));
ALTER TABLE public.ad_comp_ai_suggestions ADD CONSTRAINT ad_comp_ai_suggestions_course CHECK ((mode='skills') = (course_id IS NULL));
DROP INDEX IF EXISTS public.ad_comp_ai_one_pending;
DROP INDEX IF EXISTS public.ad_comp_ai_recent;
CREATE UNIQUE INDEX ad_comp_ai_one_pending ON public.ad_comp_ai_suggestions(course_id, mode) WHERE status IN ('queued','processing');
CREATE INDEX ad_comp_ai_recent ON public.ad_comp_ai_suggestions(course_id, mode, created_at DESC);

ALTER TABLE public.ad_comp_courses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_comp_courses FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ad_comp_courses FROM %I',r);
    END IF;
  END LOOP;
END $$;
