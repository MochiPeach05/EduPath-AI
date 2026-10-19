-- AD-COMP 2026-10-20: a skill can belong to another competency group in one career field ("kỹ năng
-- mềm của lĩnh vực này nhưng là kỹ năng chuyên môn của lĩnh vực kia": reading documents is a soft
-- skill for most students but a professional one in testing). ad_comp_skills.group_id stays the
-- default group; a row here gives the skill another group for the students whose target career is
-- in that field (career_positions.category = career_fields.code). At most one group per skill and
-- field. Rows of a soft-deleted profile, field or group are kept for the history; the scoring
-- ignores them and uses the default group.
CREATE TABLE public.ad_comp_skill_field_groups (
  skill_id UUID NOT NULL REFERENCES public.ad_comp_skills(skill_id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.career_fields(id),
  group_id UUID NOT NULL REFERENCES public.ad_comp_groups(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_id, field_id)
);
CREATE INDEX ad_comp_skill_field_groups_field ON public.ad_comp_skill_field_groups(field_id);
CREATE INDEX ad_comp_skill_field_groups_group ON public.ad_comp_skill_field_groups(group_id);
ALTER TABLE public.ad_comp_skill_field_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_comp_skill_field_groups FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ad_comp_skill_field_groups FROM %I',r);
    END IF;
  END LOOP;
END $$;
