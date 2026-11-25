-- 2026-11-25 (người dùng, khi nhờ gửi nhắc đăng ký học phần HK262: "hãy biến tấu lại nhưng không có xưng là khoa nha là
-- EduPath AI được rồi"): an announcement is sent under the name of the Khoa (as before) or of EduPath AI. One sent as
-- EduPath AI reaches the students' bell as a notification of type sys ("Hệ thống") instead of khoa ("Từ Khoa"), and its
-- email ends with EduPath AI's own line instead of the Khoa's.
ALTER TABLE public.ad_announcements
  ADD COLUMN sender TEXT NOT NULL DEFAULT 'khoa' CHECK (sender IN ('khoa', 'edupath'));
