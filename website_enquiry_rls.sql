-- ============================================================
-- MECULS — Website Enquiry RLS Policy Update
-- Date: 2026-05-28
-- ============================================================
-- PURPOSE
-- Updates the INSERT policy on public.paid_submissions to allow
-- web_enquiry form submissions with a null razorpay_payment_id.
--
-- BACKGROUND
-- The paid_submissions table is shared across all MECULS forms:
--   corporate_enquiry   → payment_id IS NULL  (already allowed)
--   cv_upgrade          → payment_id required  (Razorpay, pay_*)
--   personality_profiling → payment_id required
--   web_enquiry         → payment_id IS NULL  (NEW — this migration)
--
-- HOW TO RUN
--   1. Open Supabase Dashboard → SQL Editor
--   2. Paste this entire file into a new query
--   3. Click "Run"
--   4. Verify the SELECT at the bottom shows the updated policy
--
-- ROLLBACK
-- To revert, re-run the OLD policy definition below (labelled ROLLBACK).
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- Drop and recreate the INSERT policy
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "submissions_insert_validated" ON public.paid_submissions;

CREATE POLICY "submissions_insert_validated" ON public.paid_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    -- Enquiry-type forms: no payment required
    (
      form_type IN ('corporate_enquiry', 'web_enquiry')
      AND razorpay_payment_id IS NULL
    )
    OR
    -- Paid service forms: Razorpay payment_id required and validated
    (
      form_type IN ('cv_upgrade', 'personality_profiling')
      AND razorpay_payment_id IS NOT NULL
      AND razorpay_payment_id LIKE 'pay_%'
      AND length(razorpay_payment_id) BETWEEN 10 AND 60
    )
  );


-- ─────────────────────────────────────────────────────────────
-- Verification query
-- ─────────────────────────────────────────────────────────────

SELECT
  policyname,
  cmd,
  roles,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'paid_submissions'
  AND policyname = 'submissions_insert_validated';

-- EXPECTED: 1 row showing the updated policy with web_enquiry included.


-- ─────────────────────────────────────────────────────────────
-- ROLLBACK (commented out — restores the pre-web-enquiry policy)
-- ─────────────────────────────────────────────────────────────
--
-- DROP POLICY IF EXISTS "submissions_insert_validated" ON public.paid_submissions;
--
-- CREATE POLICY "submissions_insert_validated" ON public.paid_submissions
--   FOR INSERT
--   TO anon, authenticated
--   WITH CHECK (
--     (
--       form_type = 'corporate_enquiry'
--       AND razorpay_payment_id IS NULL
--     )
--     OR
--     (
--       form_type IN ('cv_upgrade', 'personality_profiling')
--       AND razorpay_payment_id IS NOT NULL
--       AND razorpay_payment_id LIKE 'pay_%'
--       AND length(razorpay_payment_id) BETWEEN 10 AND 60
--     )
--   );
