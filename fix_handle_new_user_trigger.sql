-- ============================================================
-- MECULS — Fix handle_new_user trigger (June 2026)
-- ============================================================
-- WHY THIS IS NEEDED
-- ------------------
-- Around May 30, 2026, Supabase changed how SECURITY DEFINER
-- functions with SET search_path = '' behave internally.
-- The handle_new_user trigger function stopped reliably creating
-- rows in public.profiles after Google OAuth sign-ins. Result:
-- the consent upsert in register.js tried to INSERT with no
-- email → "null value in column email" NOT NULL violation.
--
-- This script:
--   1. Shows you the current trigger state (diagnostic only)
--   2. Recreates the trigger function with the correct,
--      fully-qualified search path so it works under all
--      Supabase versions going forward
--   3. Ensures the trigger is attached to auth.users
--   4. Grants the anon + authenticated roles explicit access
--      to the profiles table (future-proofs against Oct 2026
--      Supabase Data API change)
--
-- HOW TO RUN
-- ----------
-- 1. Open Supabase Dashboard → SQL Editor → New query
-- 2. Paste the ENTIRE file content
-- 3. Click Run
-- 4. Check the output for any errors
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- STEP 1 — Diagnostic: check current trigger state
-- ─────────────────────────────────────────────────────────────

SELECT
  t.trigger_name,
  t.event_manipulation,
  t.event_object_schema,
  t.event_object_table,
  t.action_timing,
  t.action_orientation,
  p.prosecdef AS is_security_definer,
  p.proconfig  AS config
FROM information_schema.triggers t
JOIN pg_proc p ON p.proname = 'handle_new_user'
WHERE t.event_object_schema = 'auth'
  AND t.event_object_table  = 'users'
  AND t.trigger_name        = 'on_auth_user_created';

-- EXPECTED: 1 row confirming the trigger exists.
-- If 0 rows → trigger was dropped. The CREATE TRIGGER below
-- will recreate it.


-- ─────────────────────────────────────────────────────────────
-- STEP 2 — Recreate handle_new_user with robust search_path
-- ─────────────────────────────────────────────────────────────
-- KEY CHANGE: SET search_path = 'public' instead of empty string.
-- An empty search_path caused the function to fail when Supabase
-- changed how schema resolution works for SECURITY DEFINER funcs.
-- Using 'public' explicitly means table names resolve correctly.
--
-- IMPORTANT: This script only sets email, user_id, and full_name
-- on the new profile row. If your profiles table has other NOT NULL
-- columns without defaults, add them here before running.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    email,
    full_name
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      ''
    )
  )
  ON CONFLICT (user_id) DO NOTHING;
  -- ON CONFLICT DO NOTHING: if a profile row already exists
  -- (e.g. from an orphan retry), leave it alone.
  RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- STEP 3 — Recreate the trigger (safe to run even if it exists)
-- ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();


-- ─────────────────────────────────────────────────────────────
-- STEP 4 — Explicit GRANTs on profiles table
-- (Future-proofs against the October 2026 Supabase Data API
-- change described in their May 2026 announcement)
-- ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Note: DELETE is intentionally excluded. Users do not need to
-- delete profile rows via the Data API — that goes through
-- auth.users deletion which cascades at the database level.


-- ─────────────────────────────────────────────────────────────
-- STEP 5 — Verification
-- ─────────────────────────────────────────────────────────────

-- Confirm trigger is attached
SELECT trigger_name, event_object_table, action_timing
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Confirm GRANTs on profiles
SELECT
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'profiles'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- EXPECTED:
--   Triggers: 1 row (on_auth_user_created on auth.users AFTER)
--   Grants:   6 rows (anon + authenticated × SELECT, INSERT, UPDATE)
