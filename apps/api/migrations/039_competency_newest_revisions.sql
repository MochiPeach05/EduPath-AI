-- AD-COMP 2026-10-20 (later), "Chỉ lấy ở phiên bản mới nhất thôi nhé, phiên bản cũ của từng khóa bỏ
-- đi" (user): "Cấu hình môn học" lists only the courses of the newest CTĐT revision of each curriculum
-- (curricula.current_revision: only an import sets it, always to the newest version). A course that
-- no newest revision has any more is left out of the page, and its configuration, if still a draft or
-- applied, is archived with a history entry; nothing is deleted. A hidden configuration therefore
-- never keeps a skill or a group "in use". The same happens whenever an import makes a new revision
-- current and drops courses.
SELECT pg_advisory_xact_lock(1946032027);

CREATE FUNCTION public.ad_comp_archive_dropped_courses() RETURNS INTEGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE archived INTEGER;
BEGIN
 -- The catalog lock first, like every competency write, so an import never deadlocks with one.
 PERFORM pg_advisory_xact_lock(1946032027);
 WITH dropped AS (
   UPDATE public.ad_comp_course_configs c SET status='archived', version=gen_random_uuid(), updated_at=now()
   WHERE c.status<>'archived' AND NOT EXISTS(SELECT 1 FROM public.curriculum_courses cc
     JOIN public.curricula cu ON cu.current_revision=cc.revision_id WHERE cc.course_id=c.course_id)
   RETURNING c.id, c.course_id, c.status, c.version, c.note, c.merged_from)
 INSERT INTO public.ad_comp_events(kind, entity_key, actor_id, snapshot, note)
 SELECT 'course', d.course_id::text, NULL,
   jsonb_build_object('courseId', d.course_id, 'courseCode', x.code, 'courseName', x.name, 'credits', x.credits, 'configId', d.id,
     'status', d.status, 'version', d.version, 'note', d.note, 'mergedFrom', to_jsonb(d.merged_from),
     'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('skillId', l.skill_id, 'skillName', s.name, 'groupId', cs.group_id,
         'groupName', g.name, 'isActive', (cs.is_active AND cs.deleted_at IS NULL AND g.is_active AND s.deleted_at IS NULL),
         'weight', l.weight::float8) ORDER BY g.name, s.name, s.id)
       FROM public.ad_comp_course_links l JOIN public.ad_comp_skills cs ON cs.skill_id=l.skill_id
       JOIN public.career_skills s ON s.id=cs.skill_id JOIN public.ad_comp_groups g ON g.id=cs.group_id
       WHERE l.config_id=d.id), '[]'::jsonb)),
   'Lưu trữ vì môn học không còn trong CTĐT mới nhất của khóa nào.'
 FROM dropped d JOIN public.ad_comp_courses x ON x.id=d.course_id;
 GET DIAGNOSTICS archived = ROW_COUNT;
 RETURN archived;
END $$;

CREATE FUNCTION public.ad_comp_curriculum_switched() RETURNS TRIGGER
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.ad_comp_archive_dropped_courses();
 RETURN NULL;
END $$;
CREATE TRIGGER ad_comp_archive_dropped_courses AFTER UPDATE OF current_revision ON public.curricula
 FOR EACH STATEMENT EXECUTE FUNCTION public.ad_comp_curriculum_switched();

SELECT public.ad_comp_archive_dropped_courses();
