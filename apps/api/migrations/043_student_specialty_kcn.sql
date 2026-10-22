-- 2026-10-23 (user): K28 and earlier get the choice "Không theo chuyên ngành" (KCN), because those cohorts have
-- their own graduation standard for students without a specialty (the general standard of the cohort). The API
-- decides which cohorts may choose it (competency-assessment/specialty.ts); the constraint only lists the codes.
ALTER TABLE public.student_profiles DROP CONSTRAINT student_profiles_specialty_check;
ALTER TABLE public.student_profiles ADD CONSTRAINT student_profiles_specialty_check
  CHECK (specialty IN ('CNPM','CNDL','TTNT','ANM','KCN'));
