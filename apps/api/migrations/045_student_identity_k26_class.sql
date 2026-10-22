-- 2026-10-23 (user, on the K26 profile card "Lớp học T-IT99"): "trước dấu - là chữ T như K26T thì nó vẫn là khóa học chỉ
-- sau dấu - mới là lớp học". In "207CT12345 - Họ Tên - K26T-IT11" the letters before the hyphen (T, D, DB) belong to the
-- cohort (K26T); the class is only what follows the hyphen: IT11 (044 stored T-IT11). The cohort stays K26, the key the
-- CTĐT, plans and graduation standards use, as 71K29CNTT08 gives K29.
CREATE OR REPLACE FUNCTION public.edupath_fill_student_identity(target_user_id UUID, raw_name TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  parts TEXT[];
  parsed_code TEXT;
  intake SMALLINT;
BEGIN
  parts := regexp_match(raw_name,
    '^[[:space:]]*([0-9]{8,32})[[:space:]]+[-–—][[:space:]]+(.+)[[:space:]]+[-–—][[:space:]]+[0-9]*[Kk]([0-9]{2})(([A-Za-z]+)[0-9]+)[[:space:]]*$');
  IF parts IS NULL THEN
    -- K26: "207CT12345 - Họ Tên - K26T-IT11" → cohort K26, class IT11.
    parts := regexp_match(raw_name,
      '^[[:space:]]*([0-9]{3}[A-Za-z]{2}[0-9]{5})[[:space:]]+[-–—][[:space:]]+(.+)[[:space:]]+[-–—][[:space:]]+[Kk]([0-9]{2})[A-Za-z]{1,3}-([A-Za-z]{1,4}[0-9]{1,3})[[:space:]]*$');
  END IF;
  IF parts IS NULL OR btrim(parts[2]) = '' OR parts[3]::INTEGER < 20 THEN
    RETURN;
  END IF;
  intake := parts[3]::INTEGER + 1994;
  -- The student code is globally unique. Keep other parsed fields even if
  -- another Microsoft identity already owns this code; never merge identities.
  PERFORM pg_advisory_xact_lock(hashtext('edupath:student-identity'));
  parsed_code := upper(parts[1]);
  IF EXISTS (SELECT 1 FROM public.student_profiles
             WHERE student_code = parsed_code AND user_id <> target_user_id) THEN
    parsed_code := NULL;
  END IF;

  INSERT INTO public.student_profiles AS profile
    (user_id, student_code, full_name, cohort_code, class_name, cohort_year)
  VALUES (target_user_id, parsed_code, btrim(parts[2]), 'K' || parts[3], upper(parts[4]), intake)
  ON CONFLICT (user_id) DO UPDATE SET
    student_code = COALESCE(profile.student_code, EXCLUDED.student_code),
    full_name = COALESCE(profile.full_name, EXCLUDED.full_name),
    cohort_code = COALESCE(profile.cohort_code, EXCLUDED.cohort_code),
    class_name = COALESCE(profile.class_name, EXCLUDED.class_name),
    cohort_year = COALESCE(profile.cohort_year, EXCLUDED.cohort_year),
    updated_at = CURRENT_TIMESTAMP
  WHERE profile.student_code IS NULL OR profile.full_name IS NULL
     OR profile.cohort_code IS NULL OR profile.class_name IS NULL OR profile.cohort_year IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.edupath_fill_student_identity(UUID, TEXT) FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.edupath_fill_student_identity(UUID, TEXT) FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;

-- Classes 044 wrote as "T-IT11": keep the part after the hyphen, only where the account name is the K26 form with
-- that very class.
UPDATE public.student_profiles profile
SET class_name = upper(split_part(profile.class_name, '-', 2)), updated_at = CURRENT_TIMESTAMP
FROM public.users account
WHERE account.id = profile.user_id
  AND profile.class_name ~ '^[A-Z]{1,3}-[A-Z]{1,4}[0-9]{1,3}$'
  AND upper(account.display_name) ~ ('[-–—][[:space:]]+K[0-9]{2}' || profile.class_name || '[[:space:]]*$');
