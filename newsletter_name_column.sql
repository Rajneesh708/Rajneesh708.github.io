-- ============================================================
-- MECULS - Newsletter: add "name" column
-- Date: 2026-11-18
-- ============================================================
-- PURPOSE
-- The blog "Subscribe" box asks for Name + Email. The table from
-- newsletter_subscribers.sql had no name column, so this adds it.
-- Safe: only ADDS an empty optional column. No data is changed.
-- Row-Level Security stays exactly as before (browser can only
-- insert; only admin can read the list).
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> paste -> Run
--
-- ROLLBACK (only if the subscribe feature is removed):
--   ALTER TABLE public.newsletter_subscribers DROP COLUMN IF EXISTS name;
-- ============================================================

ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.newsletter_subscribers
  DROP CONSTRAINT IF EXISTS newsletter_subscribers_name_length;

ALTER TABLE public.newsletter_subscribers
  ADD CONSTRAINT newsletter_subscribers_name_length
  CHECK (name IS NULL OR length(name) <= 100);

COMMENT ON COLUMN public.newsletter_subscribers.name IS
  'Name typed in the blog Subscribe box (added 2026-11-18).';

-- Tell the website API about the new column straight away
NOTIFY pgrst, 'reload schema';

-- Check: should list the columns including "name"
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'newsletter_subscribers'
ORDER BY ordinal_position;
