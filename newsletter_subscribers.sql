-- ============================================================
-- MECULS — Newsletter Subscribers Table
-- Date: 2026-05-18
-- ============================================================
-- PURPOSE
-- Creates the newsletter_subscribers table and its RLS policies.
-- Anyone (anon or authenticated) can subscribe with just an email.
-- Only service_role (admin) can read, update, or delete records.
--
-- HOW TO RUN
--   1. Open Supabase Dashboard → SQL Editor
--   2. Paste this entire file into a new query
--   3. Click "Run"
--   4. Verify the SELECT at the bottom prints the expected rows
--
-- ROLLBACK
-- The commented-out ROLLBACK section at the bottom drops the table.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- Create the table
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email             text        NOT NULL,
  subscribed_at     timestamptz DEFAULT now() NOT NULL,
  source_page       text,       -- which page the subscriber came from
  ip_country        text,       -- optional, populated by edge function if used
  is_active         boolean     DEFAULT true NOT NULL,
  unsubscribed_at   timestamptz,

  CONSTRAINT newsletter_subscribers_email_key UNIQUE (email),
  CONSTRAINT newsletter_subscribers_email_check
    CHECK (email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')
);

-- Index on email for fast deduplication lookups
CREATE INDEX IF NOT EXISTS newsletter_subscribers_email_idx
  ON public.newsletter_subscribers (email);

-- Index on subscribed_at for sorted admin queries
CREATE INDEX IF NOT EXISTS newsletter_subscribers_subscribed_at_idx
  ON public.newsletter_subscribers (subscribed_at DESC);

COMMENT ON TABLE public.newsletter_subscribers IS
  'MECULS monthly newsletter subscribers. Collected from website CTA forms.';

COMMENT ON COLUMN public.newsletter_subscribers.source_page IS
  'The page slug or URL where the subscription was initiated (e.g. index, footer).';

COMMENT ON COLUMN public.newsletter_subscribers.is_active IS
  'true = active subscriber; false = unsubscribed or suppressed.';


-- ─────────────────────────────────────────────────────────────
-- Enable Row-Level Security
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- RLS Policies
-- ─────────────────────────────────────────────────────────────

-- INSERT: any anonymous or authenticated user may subscribe
DROP POLICY IF EXISTS "newsletter_insert_open" ON public.newsletter_subscribers;

CREATE POLICY "newsletter_insert_open" ON public.newsletter_subscribers
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL
    AND length(trim(email)) > 5
    AND email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
  );

-- SELECT: only service_role (admin tools) can read subscriber list
DROP POLICY IF EXISTS "newsletter_select_admin_only" ON public.newsletter_subscribers;

CREATE POLICY "newsletter_select_admin_only" ON public.newsletter_subscribers
  FOR SELECT
  TO service_role
  USING (true);

-- UPDATE: only service_role can update (e.g. mark is_active = false)
DROP POLICY IF EXISTS "newsletter_update_admin_only" ON public.newsletter_subscribers;

CREATE POLICY "newsletter_update_admin_only" ON public.newsletter_subscribers
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- DELETE: only service_role can delete (GDPR removal requests)
DROP POLICY IF EXISTS "newsletter_delete_admin_only" ON public.newsletter_subscribers;

CREATE POLICY "newsletter_delete_admin_only" ON public.newsletter_subscribers
  FOR DELETE
  TO service_role
  USING (true);


-- ─────────────────────────────────────────────────────────────
-- Explicit GRANTs (required for Supabase Data API access)
-- Future-proofs against the October 2026 Supabase enforcement
-- ─────────────────────────────────────────────────────────────

GRANT INSERT                    ON public.newsletter_subscribers TO anon;
GRANT INSERT, SELECT, UPDATE    ON public.newsletter_subscribers TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Verification query
-- ─────────────────────────────────────────────────────────────

SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'newsletter_subscribers'
ORDER BY cmd, policyname;

-- EXPECTED OUTPUT (4 rows):
--
--   newsletter_subscribers  newsletter_delete_admin_only  DELETE  {service_role}
--   newsletter_subscribers  newsletter_insert_open        INSERT  {anon,authenticated}
--   newsletter_subscribers  newsletter_select_admin_only  SELECT  {service_role}
--   newsletter_subscribers  newsletter_update_admin_only  UPDATE  {service_role}


-- ─────────────────────────────────────────────────────────────
-- ROLLBACK (commented out — only use to fully remove the feature)
-- ─────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.newsletter_subscribers CASCADE;
