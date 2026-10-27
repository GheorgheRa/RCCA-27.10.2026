/*
# Update is_admin to include power_admin

- `is_admin()` now returns true for both 'admin' and 'power_admin' roles.
- Promote the first existing admin to power_admin so there is at least one.
*/

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (select auth.uid()) AND role IN ('admin', 'power_admin')
  );
$$;

-- Promote the earliest admin to power_admin (only if no power_admin exists yet)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'power_admin') THEN
    UPDATE public.profiles
    SET role = 'power_admin', updated_date = now()
    WHERE id = (
      SELECT id FROM public.profiles
      WHERE role = 'admin'
      ORDER BY created_date ASC
      LIMIT 1
    );
  END IF;
END;
$$;
