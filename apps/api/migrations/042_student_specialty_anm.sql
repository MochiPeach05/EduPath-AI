-- 2026-10-23 (user): "riêng sinh viên k27 thêm 1 chuyên ngành để chọn ở trang sinh viên là An ninh Mạng và IoTs".
-- ANM is the specialty of the K27 standard 71K27CNTT_7480201-01. The API decides which cohorts may choose it
-- (K27 only, competency-assessment/specialty.ts); the constraint only lists the codes, like 028.
ALTER TABLE public.student_profiles DROP CONSTRAINT student_profiles_specialty_check;
ALTER TABLE public.student_profiles ADD CONSTRAINT student_profiles_specialty_check
  CHECK (specialty IN ('CNPM','CNDL','TTNT','ANM'));
