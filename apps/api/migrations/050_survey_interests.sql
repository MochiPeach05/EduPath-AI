-- 2026-10-24 (user): "Công nghệ bạn thích" and "Sở thích khi rảnh" move from the profile (049) into the profile survey,
-- which the AI study roadmap reads (privacy policy 2026-10-25, the student agrees again when saving the survey). They
-- are not copied from student_profiles: the survey form starts from the profile's choices and saving it takes them in.
ALTER TABLE public.stu_profile_surveys
  ADD COLUMN interest_tech TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(interest_tech) <= 5),
  ADD COLUMN interest_hobbies TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(interest_hobbies) <= 5);
