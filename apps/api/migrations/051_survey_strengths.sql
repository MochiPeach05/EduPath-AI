-- 2026-10-24 (user): survey question 11 becomes "Thế mạnh của bạn" with, besides the technologies, a required
-- description of the technologies the student is proficient in ("kèm 1 chỗ nhập kêu nó mô tả công nghệ mà nó thành
-- thạo"); question 12 becomes "Sở trường". survey-v3; a survey without the description is incomplete until saved again.
ALTER TABLE public.stu_profile_surveys
  ADD COLUMN strengths TEXT CHECK (strengths IS NULL OR char_length(strengths) BETWEEN 1 AND 500);
