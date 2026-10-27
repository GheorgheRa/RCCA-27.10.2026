/*
# Add power_admin role and admin user-management RPC

1. Changes to existing tables
- `profiles.role` check constraint expanded from ('admin','user') to ('power_admin','admin','user').

2. New functions (SECURITY DEFINER)
- `admin_create_user(email, password, full_name, role)` — lets an authenticated
  admin/power_admin create a new auth user with a password and set their profile
  role in one atomic operation. Uses the service-role client internally via
  `auth.users` insert + `profiles` upsert. Returns the new user id.
- `admin_set_user_role(target_user_id, new_role)` — lets an admin/power_admin
  change another user's role. Bypasses the protect_profile_role trigger by
  running as the definer (service_role-like context via SECURITY DEFINER).
- `admin_delete_user(target_user_id)` — lets an admin/power_admin delete a
  user's auth account and profile.

3. Security
- All three functions REVOKE EXECUTE from PUBLIC/anon and GRANT only to authenticated.
- Each function verifies the caller is admin or power_admin before acting.
- power_admin can manage admins; admin can only manage users (not other admins/power_admins).
- A user cannot change their own role or delete themselves via these functions.
*/

-- Expand role check constraint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('power_admin', 'admin', 'user'));

-- Helper: is caller a power_admin or admin?
CREATE OR REPLACE FUNCTION public.is_admin_or_higher()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('power_admin', 'admin')
  );
$$;

-- Helper: is caller a power_admin?
CREATE OR REPLACE FUNCTION public.is_power_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'power_admin'
  );
$$;

-- Create a new auth user + profile with a password and role
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text DEFAULT '',
  p_role text DEFAULT 'user'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_email text;
  v_name text;
BEGIN
  -- Validate caller is admin or higher
  IF NOT public.is_admin_or_higher() THEN
    RAISE EXCEPTION 'Only administrators can create users';
  END IF;

  -- Validate role
  v_role := CASE WHEN p_role = 'power_admin' THEN 'power_admin'
                 WHEN p_role = 'admin' THEN 'admin'
                 ELSE 'user' END;

  -- Only power_admin can create power_admin or admin
  IF v_role IN ('power_admin', 'admin') AND NOT public.is_power_admin() THEN
    RAISE EXCEPTION 'Only power admins can create admin accounts';
  END IF;

  v_email := lower(trim(p_email));
  IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;

  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  v_name := trim(coalesce(p_full_name, ''));

  -- Insert into auth.users (encrypted password via crypt + gen_salt)
  INSERT INTO auth.users (
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    CASE WHEN v_name <> '' THEN jsonb_build_object('full_name', v_name, 'display_name', v_name)
         ELSE jsonb_build_object('full_name', v_email) END,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  ON CONFLICT (email) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = now(),
    updated_at = now()
  RETURNING id INTO v_user_id;

  -- Upsert profile with the desired role
  INSERT INTO public.profiles (id, email, full_name, display_name, role)
  VALUES (v_user_id, v_email, CASE WHEN v_name <> '' THEN v_name ELSE v_email END, CASE WHEN v_name <> '' THEN v_name ELSE NULL END, v_role)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    updated_date = now();

  RETURN v_user_id;
END;
$$;

-- Change another user's role
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_target_user_id uuid,
  p_new_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_target_role text;
  v_new_role text;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('power_admin', 'admin') THEN
    RAISE EXCEPTION 'Only administrators can change user roles';
  END IF;

  -- Can't change your own role
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;

  v_new_role := CASE WHEN p_new_role = 'power_admin' THEN 'power_admin'
                     WHEN p_new_role = 'admin' THEN 'admin'
                     ELSE 'user' END;

  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_target_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Only power_admin can set power_admin or admin roles, or demote admins
  IF (v_new_role IN ('power_admin', 'admin') OR v_target_role IN ('power_admin', 'admin'))
     AND v_caller_role <> 'power_admin' THEN
    RAISE EXCEPTION 'Only power admins can assign or change admin-level roles';
  END IF;

  UPDATE public.profiles
  SET role = v_new_role, updated_date = now()
  WHERE id = p_target_user_id;
END;
$$;

-- Delete a user account
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role text;
  v_target_role text;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('power_admin', 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete users';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete your own account here';
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_target_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Only power_admin can delete admins
  IF v_target_role IN ('power_admin', 'admin') AND v_caller_role <> 'power_admin' THEN
    RAISE EXCEPTION 'Only power admins can delete admin accounts';
  END IF;

  DELETE FROM auth.users WHERE id = p_target_user_id;
END;
$$;

-- Revoke public execute and grant only to authenticated
REVOKE EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_higher() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_power_admin() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_higher() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_power_admin() TO authenticated;
