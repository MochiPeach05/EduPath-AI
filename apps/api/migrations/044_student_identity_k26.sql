-- 2026-10-23 (user): "Sửa lại cái cách tách tên từ tên sinh viên lấy khóa với lớp của riêng k26 nó đang dùng cách khác".
-- 005 reads "2374802010078 - Họ Tên - 71K29CNTT08" (K27 on). K26 accounts are named "207CT12345 - Họ Tên - K26T-IT11"
-- (also "207LH12345 …", classes like "K26D-LH07" and "K26DB-IT1"): letters in the student code, and a class that starts
-- with the cohort and holds a hyphen. Such a name now gives student code 207CT12345, cohort K26, class T-IT11 and
-- intake 2020 (cohort + 1994, as before). The fill rules of 005 stay: only missing fields are filled, a student
-- code another identity owns is never reassigned. Cohorts from K20 are read (005 stopped below K27).
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
    -- K26: "207CT12345 - Họ Tên - K26T-IT11".
    parts := regexp_match(raw_name,
      '^[[:space:]]*([0-9]{3}[A-Za-z]{2}[0-9]{5})[[:space:]]+[-–—][[:space:]]+(.+)[[:space:]]+[-–—][[:space:]]+[Kk]([0-9]{2})([A-Za-z]{1,3}-[A-Za-z]{1,4}[0-9]{1,3})[[:space:]]*$');
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

-- K26 accounts that signed in before get their profile fields now (only missing ones, as in 005).
DO $$
DECLARE account RECORD;
BEGIN
  FOR account IN SELECT id, display_name FROM public.users ORDER BY created_at, id LOOP
    PERFORM public.edupath_fill_student_identity(account.id, account.display_name);
  END LOOP;
END;
$$;
