-- 2026-10-24 (user): "Sở thích" of the profile becomes choices instead of free text ("làm dạng các công nghệ, sở thích khi
-- rảnh ... để tránh việc sv bỏ trống hoặc nhập bừa"): the technologies the student likes and what they do in free time,
-- 1 to 5 of each. The API checks the option ids (apps/api/src/student/interests.ts). The old free-text interests column
-- stays for rows not yet updated; saving the choices clears it.
ALTER TABLE public.student_profiles
  ADD COLUMN interest_tech TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(interest_tech) <= 5),
  ADD COLUMN interest_hobbies TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(interest_hobbies) <= 5);
