-- 2026-11-10 (user: "Kế hoạch học kỳ, Khảo sát định hướng … cái này cố vấn học tập và quản trị viên làm luôn nhé"): the
-- cố vấn học tập of the student's class, a Khoa admin or Ban chủ nhiệm khoa may fill in the student's Khảo sát định hướng
-- in the student's page (advisors/access.ts, policy 2026-11-10). No consent is recorded in the student's name: a survey
-- saved this way counts for the AI features like one the student saved under their consent, unless the student has
-- withdrawn that consent, until the student saves it again themselves (which asks for the consent as before).
-- saved_by: the account that saved it last for the student (NULL when the student saved it, or the account is gone);
-- saved_by_role: 'advisor' (the class's cố vấn học tập) or 'admin' (the Khoa), NULL when the student saved it.
ALTER TABLE public.stu_profile_surveys
  ADD COLUMN saved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN saved_by_role TEXT CHECK (saved_by_role IN ('advisor', 'admin'));
