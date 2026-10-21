-- AD-COMP 2026-10-22: a skill can belong to one or more competency groups (user: "mỗi kỹ năng trong
-- đây có thể làm một hoặc nhiều nhóm năng lực khác nhau không ràng buộc một như hiện tại"; "Viết tài
-- liệu" is Kỹ năng mềm for most careers but Chuyên môn for testers). ad_comp_skills.group_id stays the
-- skill's first group, the one the course-configuration checks use; a row here adds another group.
-- Every group of a skill counts for every student: the skill score enters each group's score. How much
-- a skill weighs for one career stays with that career's requirement (Bắt buộc/Ưu tiên). The writer
-- (the competency API) never stores the first group here; readers ignore such a row anyway.
-- Migration 037 (groups by career field) stays unused.
CREATE TABLE public.ad_comp_skill_groups (
  skill_id UUID NOT NULL REFERENCES public.ad_comp_skills(skill_id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.ad_comp_groups(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_id, group_id)
);
CREATE INDEX ad_comp_skill_groups_group ON public.ad_comp_skill_groups(group_id);
-- Same statement lock as the other AD-COMP catalog tables (026).
CREATE TRIGGER ad_comp_catalog_lock BEFORE INSERT OR UPDATE OR DELETE ON public.ad_comp_skill_groups
  FOR EACH STATEMENT EXECUTE FUNCTION public.ad_comp_lock_catalog_trigger();
ALTER TABLE public.ad_comp_skill_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_comp_skill_groups FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ad_comp_skill_groups FROM %I',r);
    END IF;
  END LOOP;
END $$;
