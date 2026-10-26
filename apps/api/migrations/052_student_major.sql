-- 2026-10-27 (user): the Faculty's majors are separate programmes, not specialties of CNTT ("CNTT, HTTT và MMT & TTDT là
-- 3 ngành khác nhau"), and a student's major is the programme code inside the MSSV ("Điền ngành đúng nè"):
-- 2374802010145 → 7480201 Công nghệ thông tin; 7480104 Hệ thống thông tin; 7480102 Mạng máy tính và truyền thông dữ liệu.
-- K26 codes ("207CT12345") are Công nghệ thông tin. The CTĐT, KHĐT and graduation standard of a student are those of the
-- cohort and the major.
ALTER TABLE public.student_profiles ADD COLUMN major_code CHAR(7)
  CONSTRAINT student_profiles_major_code_check CHECK (major_code IS NULL OR major_code ~ '^[0-9]{7}$');

CREATE FUNCTION public.edupath_major_of(code TEXT)
RETURNS CHAR(7) LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN btrim(code) ~ '^[0-9]{12,14}$' THEN substr(btrim(code), 3, 7)
    WHEN upper(btrim(code)) ~ '^[0-9]{3}CT[0-9]{5}$' THEN '7480201'
  END
$$;

UPDATE public.student_profiles SET major_code = public.edupath_major_of(student_code)
WHERE major_code IS NULL AND student_code IS NOT NULL;

-- A profile takes the major of its MSSV when it has none, or when the MSSV changes.
CREATE FUNCTION public.edupath_student_major_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.major_code IS NULL OR (TG_OP = 'UPDATE' AND NEW.student_code IS DISTINCT FROM OLD.student_code) THEN
    NEW.major_code := public.edupath_major_of(NEW.student_code);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER student_profiles_fill_major
BEFORE INSERT OR UPDATE OF student_code, major_code ON public.student_profiles
FOR EACH ROW EXECUTE FUNCTION public.edupath_student_major_trigger();

REVOKE ALL ON FUNCTION public.edupath_major_of(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edupath_student_major_trigger() FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.edupath_major_of(TEXT) FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.edupath_student_major_trigger() FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;
