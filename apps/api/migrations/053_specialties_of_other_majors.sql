-- 2026-10-27: the specialties of the other majors (052), as their CTĐT name them: Hệ thống thông tin (HTTT Chuyển đổi số,
-- HTTT Địa lý) and Mạng máy tính và truyền thông dữ liệu (IoT, An ninh mạng). The API decides which major and cohort may
-- choose each one (competency-assessment/specialty.ts); the constraint only lists the codes, like 042 and 043.
ALTER TABLE public.student_profiles DROP CONSTRAINT student_profiles_specialty_check;
ALTER TABLE public.student_profiles ADD CONSTRAINT student_profiles_specialty_check
  CHECK (specialty IN ('CNPM','CNDL','TTNT','ANM','KCN','HTTT_CDS','HTTT_GIS','MMT_IOT','MMT_ANM'));
