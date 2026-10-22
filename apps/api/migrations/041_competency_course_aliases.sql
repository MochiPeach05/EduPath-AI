-- AD-COMP 2026-10-23 (user): "nhiều môn nó không thật sự là một môn mới nhưng nó chỉ thay đổi các ký tự
-- rất nhỏ". Since the K27/K28 imports one course can appear twice with the same code: "Anh Văn 1" and
-- "Anh văn 1 (AV1)", "Triết học Mác Lênin" and "Triết học Mác-Lênin", "Giáo dục quốc phòng 1" (0 TC) and
-- "GDQP1: Đường lối QP và AN của ĐCSVN" (3 TC). Such a course can now be merged into the other one:
--  1. ad_comp_course_aliases maps the key (code, name, credits) of a merged course to the course it was
--     merged into. The curriculum trigger looks there first, so importing that spelling again joins the
--     course instead of adding it again, and the course keeps its displayed spelling.
--  2. ad_comp_merge_course(source, target, note) moves the curriculum rows and AI proposals of the source
--     to the target (a pending proposal of the source is cancelled first), records the source's key as an
--     alias, writes a history entry on the target and deletes the source. Only courses of the same code
--     are merged (user: K26 keeps its own codes and courses), and only a source without a live
--     configuration: a configuration cannot move to another course (ad_comp_pin_scope), so the target is
--     the configured course. An archived configuration of the source, already in its history, is removed.
-- Which courses are merged is decided by the Faculty (output/course-merge-2026-10-23), not by this file.
SELECT pg_advisory_xact_lock(1946032027);

CREATE TABLE public.ad_comp_course_aliases (
  course_key TEXT PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.ad_comp_courses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ad_comp_course_aliases_course ON public.ad_comp_course_aliases(course_id);
CREATE TRIGGER ad_comp_catalog_lock BEFORE INSERT OR UPDATE OR DELETE ON public.ad_comp_course_aliases
  FOR EACH STATEMENT EXECUTE FUNCTION public.ad_comp_lock_catalog_trigger();
ALTER TABLE public.ad_comp_course_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_comp_course_aliases FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ad_comp_course_aliases FROM %I',r);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.ad_comp_curriculum_course() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE merged UUID;
BEGIN
 -- A spelling merged into another course joins that course, which keeps its displayed spelling.
 SELECT a.course_id INTO merged FROM public.ad_comp_course_aliases a
   WHERE a.course_key=public.ad_comp_course_key(NEW.code, NEW.name, NEW.credits);
 IF merged IS NOT NULL THEN
   NEW.course_id := merged;
   RETURN NEW;
 END IF;
 INSERT INTO public.ad_comp_courses(course_key, code, name, credits)
   VALUES (public.ad_comp_course_key(NEW.code, NEW.name, NEW.credits), upper(btrim(NEW.code)), regexp_replace(btrim(NEW.name), '\s+', ' ', 'g'),
     trim_scale(NEW.credits))
   ON CONFLICT (course_key) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name, credits=EXCLUDED.credits, updated_at=now()
   RETURNING id INTO NEW.course_id;
 RETURN NEW;
END $$;

CREATE FUNCTION public.ad_comp_merge_course(source UUID, target UUID, note TEXT) RETURNS VOID
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s public.ad_comp_courses; t public.ad_comp_courses; cohorts TEXT[];
BEGIN
 -- The catalog lock first, like every competency write.
 PERFORM pg_advisory_xact_lock(1946032027);
 SELECT * INTO s FROM public.ad_comp_courses WHERE id=source FOR UPDATE;
 SELECT * INTO t FROM public.ad_comp_courses WHERE id=target FOR UPDATE;
 IF s.id IS NULL OR t.id IS NULL OR s.id=t.id THEN
   RAISE EXCEPTION 'course_merge_not_found' USING ERRCODE='23514', CONSTRAINT='course_merge_not_found';
 END IF;
 IF s.code<>t.code THEN
   RAISE EXCEPTION 'course_merge_other_code' USING ERRCODE='23514', CONSTRAINT='course_merge_other_code';
 END IF;
 IF EXISTS(SELECT 1 FROM public.ad_comp_course_configs WHERE course_id=source AND status<>'archived') THEN
   RAISE EXCEPTION 'course_merge_source_configured' USING ERRCODE='23514', CONSTRAINT='course_merge_source_configured';
 END IF;
 SELECT array_agg(DISTINCT cu.cohort_code ORDER BY cu.cohort_code) INTO cohorts
   FROM public.curriculum_courses cc JOIN public.curriculum_revisions r ON r.id=cc.revision_id
   JOIN public.curricula cu ON cu.id=r.curriculum_id WHERE cc.course_id=source;
 DELETE FROM public.ad_comp_course_links WHERE config_id IN (SELECT id FROM public.ad_comp_course_configs WHERE course_id=source);
 DELETE FROM public.ad_comp_course_configs WHERE course_id=source;
 UPDATE public.curriculum_courses SET course_id=target WHERE course_id=source;
 UPDATE public.ad_comp_ai_suggestions SET status='cancelled', ai_input=NULL, lease_token=NULL, lease_until=NULL, updated_at=now()
   WHERE course_id=source AND status IN ('queued','processing');
 UPDATE public.ad_comp_ai_suggestions SET course_id=target WHERE course_id=source;
 UPDATE public.ad_comp_course_aliases SET course_id=target WHERE course_id=source;
 INSERT INTO public.ad_comp_course_aliases(course_key, course_id) VALUES (s.course_key, target)
   ON CONFLICT (course_key) DO UPDATE SET course_id=EXCLUDED.course_id;
 INSERT INTO public.ad_comp_events(kind, entity_key, actor_id, snapshot, note)
   VALUES ('course', target::text, NULL, jsonb_build_object('mergedCourse', jsonb_build_object('courseId', s.id, 'courseCode', s.code,
     'courseName', s.name, 'credits', s.credits, 'courseKey', s.course_key, 'cohorts', to_jsonb(COALESCE(cohorts, '{}'::TEXT[])))), note);
 DELETE FROM public.ad_comp_courses WHERE id=source;
END $$;
REVOKE ALL ON FUNCTION public.ad_comp_merge_course(UUID, UUID, TEXT) FROM PUBLIC;
