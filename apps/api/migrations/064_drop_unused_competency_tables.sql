-- 2026-11-12 (user: "Kiểm tra lại tổng quan thật kỹ … nếu không ảnh hưởng tới thì xóa luôn"): drops four tables that no
-- code reads or writes any more, so the database holds 55 tables instead of 59.
-- - ad_comp_imports, ad_comp_import_aliases (026): the Excel import of the competency configuration, removed.
-- - ad_comp_skill_field_groups (037): "nhóm năng lực theo lĩnh vực", reverted on 2026-10-20.
-- - ad_comp_skill_majors (054): "ngành áp dụng" of a skill, reverted on 2026-10-27.
-- Checked on production first: no foreign key, view, function, policy or publication points at them (they only point at
-- other tables). Their own indexes, constraints and the catalog-lock trigger of 054 go with them; the shared trigger
-- function stays. The report cache stopped reading two of them in eb15837, deployed before this migration, so the
-- server still running during the deploy never asks for a dropped table. Without CASCADE: anything unexpected that
-- depended on them makes this migration fail instead of being dropped with them.
-- The locks are waited for at most 10 s: past that the migration fails and the deploy stops, the running server stays.
SET LOCAL lock_timeout = '10s';
DROP TABLE IF EXISTS public.ad_comp_import_aliases;
DROP TABLE IF EXISTS public.ad_comp_imports;
DROP TABLE IF EXISTS public.ad_comp_skill_field_groups;
DROP TABLE IF EXISTS public.ad_comp_skill_majors;
