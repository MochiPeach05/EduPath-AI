-- AD-COMP 2026-10-27: "Ngành áp dụng" of a skill profile. After the HTTT and MMT&TTDL frameworks and their own skills were
-- added, the user asked that the AI of "Cấu hình môn học" give the courses of the two new majors the new skills and the
-- old ones, while CNTT keeps the old ones ("chứ nó gán tùm lum là mệt luôn"). A profile with no row here is for every
-- major (every profile before this migration); a profile with rows is offered to the AI only for the courses of those
-- majors. A course's majors are those of the newest CTĐT revisions that have it (curricula.identity_key "major:cohort").
-- major_code is the programme code of the MSSV, as in student_profiles.major_code (migration 052); the API accepts only
-- the Faculty's majors.
CREATE TABLE public.ad_comp_skill_majors (
  skill_id UUID NOT NULL REFERENCES public.ad_comp_skills(skill_id) ON DELETE CASCADE,
  major_code TEXT NOT NULL CHECK (major_code ~ '^[0-9]{7}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_id, major_code)
);
-- Same statement lock as the other AD-COMP catalog tables (026).
CREATE TRIGGER ad_comp_catalog_lock BEFORE INSERT OR UPDATE OR DELETE ON public.ad_comp_skill_majors
  FOR EACH STATEMENT EXECUTE FUNCTION public.ad_comp_lock_catalog_trigger();
ALTER TABLE public.ad_comp_skill_majors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_comp_skill_majors FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.ad_comp_skill_majors FROM %I',r);
    END IF;
  END LOOP;
END $$;
