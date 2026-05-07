/* ============================================================
   MECULS — mc_storage.js (v=1)
   Single source of truth for all MECULS localStorage keys.
   ============================================================
   PURPOSE:
   Earlier the portal had localStorage cleanup logic scattered
   across four files (login.js, register.js, mc_supabase.js,
   dashboard.js, guard.js). Each file knew about a DIFFERENT
   subset of keys to clear on sign-out. Result: when User A
   signed out (or was deleted) and User B signed in on the
   same browser, leftover keys from User A leaked through to
   User B's session — most visibly the profile photo.

   This file fixes that by:
   1. Listing every MECULS-owned localStorage key in ONE place
   2. Providing a wipeAll() helper that clears them ALL
   3. Providing wipeAllExcept() for sign-in flows that need to
      preserve fresh tokens while clearing stale data

   USAGE:
     <script src="mc_storage.js"></script>
     // Then anywhere:
     MC_STORAGE.wipeAll();

   WHEN TO CALL wipeAll():
   - Sign-out (any path): user explicitly signs out, or session
     becomes invalid, or user is deleted server-side
   - Sign-in success: just before promoting the new session,
     to clear stale data from a previous user on the same browser
   - Registration success: same reason

   KEY CATEGORIES:
   - SUPABASE_AUTH_PREFIX: any sb-*-auth-token key managed by
     Supabase JS itself. Patterns, not exact names.
   - MECULS_FIXED_KEYS: exact key names this portal uses
   - MECULS_PREFIXES: prefixes for variable-suffix keys

   AUDIT TRAIL:
   The list below was assembled by grepping every JS file in
   the portal for localStorage.setItem calls on 2026-05-05.
   If a new localStorage key is introduced anywhere in the
   codebase, ADD IT TO THIS LIST. Otherwise the cross-user
   leak bug returns silently.
   ============================================================ */

"use strict";

window.MC_STORAGE = window.MC_STORAGE || (function () {

  /* ── Fixed key names ──
     Exact match. Add new keys here when introduced. */
  const MECULS_FIXED_KEYS = [
    /* Auth + session ----------------------------------------- */
    "user_type",
    "candidate_id",
    "registration_complete",
    "pending_user_type",

    /* Profile category — disability / defense status (PII) --- */
    "defense_family_role",
    "abled_status",
    "especially_abled_details",
    "needs_accommodation",
    "support_description",

    /* Photo + CV (PII — actual photo data lives here) -------- */
    "profile_photo",
    "profile_photo_original_size",
    "profile_photo_final_size",

    /* Section completion flags (cosmetic — drive dashboard ticks) */
    "profile_category_completed",
    "introduction_completed",
    "education_completed",
    "experience_completed",
    "skills_completed",
    "languages_completed",
    "certifications_completed",
    "references_completed",
    "preferences_completed",
    "goals_completed",
    "photo_cv_completed",
    "photo_cv_partial",

    /* Submission state */
    "profile_submitted",
    "profile_last_updated"
  ];

  /* ── Prefix patterns ──
     Any localStorage key that STARTS WITH one of these prefixes
     is also wiped. Used for variable-suffix keys. */
  const MECULS_PREFIXES = [
    "profile_completed_"   /* dashboard reads "profile_completed_<userType>" */
  ];

  /* ── Supabase-owned auth tokens ──
     Supabase JS stores its session under keys like
     sb-fjxcphhhddfwrlkpshyw-auth-token. The slug between sb-
     and -auth-token is project-specific and may rotate, so we
     match by pattern. */
  function isSupabaseAuthKey(key) {
    return typeof key === "string" &&
           key.indexOf("sb-") === 0 &&
           key.indexOf("-auth-token") !== -1;
  }

  /* ── wipeAll ──
     Removes every MECULS-owned key AND every Supabase auth token.
     Safe to call from any sign-out or pre-sign-in path. */
  function wipeAll() {
    return wipeAllExcept([]);
  }

  /* ── wipeAllExcept ──
     Same as wipeAll() but preserves keys named in keepKeys.
     Used by sign-in flow which needs to clear stale-user state
     WITHOUT clearing the auth token Supabase just set up. */
  function wipeAllExcept(keepKeys) {
    if (!Array.isArray(keepKeys)) keepKeys = [];
    const keep = {};
    keepKeys.forEach(function (k) { keep[k] = true; });

    /* Collect keys to remove first, then remove them. Removing
       during iteration would skip entries because indices shift. */
    const toRemove = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (keep[key]) continue;

        /* MECULS exact-match keys */
        if (MECULS_FIXED_KEYS.indexOf(key) !== -1) {
          toRemove.push(key);
          continue;
        }

        /* MECULS prefix-match keys */
        let matchedPrefix = false;
        for (let j = 0; j < MECULS_PREFIXES.length; j++) {
          if (key.indexOf(MECULS_PREFIXES[j]) === 0) {
            matchedPrefix = true;
            break;
          }
        }
        if (matchedPrefix) {
          toRemove.push(key);
          continue;
        }

        /* Supabase auth tokens */
        if (isSupabaseAuthKey(key)) {
          toRemove.push(key);
        }
      }

      toRemove.forEach(function (k) {
        try { localStorage.removeItem(k); }
        catch (e) { /* non-fatal */ }
      });
    } catch (err) {
      /* localStorage may be disabled in private mode — non-fatal */
      console.warn("[mc_storage] wipeAllExcept error:", err);
    }

    return toRemove.length;  /* count of keys removed */
  }

  /* ── isOwnSession ──
     Convenience: returns true if the candidate_id stored in
     localStorage matches the given user UUID. Used at sign-in to
     decide whether stale data needs wiping. */
  function isOwnSession(userId) {
    try {
      const stored = localStorage.getItem("candidate_id");
      return !!(stored && userId && stored === userId);
    } catch (e) {
      return false;
    }
  }

  /* ── wipeMeculsAppDataOnly ──
     Clears MECULS application data (photo, PII, completion flags,
     etc.) but PRESERVES Supabase auth tokens. Use this from the
     sign-in flow: after Supabase has just authenticated the user
     and set up its tokens, we need to clear any stale data from
     a previous user without invalidating the fresh authentication.

     This is the function that closes the cross-user data leak
     (User A's photo persisting to User B on the same browser). */
  function wipeMeculsAppDataOnly() {
    const toRemove = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        if (MECULS_FIXED_KEYS.indexOf(key) !== -1) {
          toRemove.push(key);
          continue;
        }
        for (let j = 0; j < MECULS_PREFIXES.length; j++) {
          if (key.indexOf(MECULS_PREFIXES[j]) === 0) {
            toRemove.push(key);
            break;
          }
        }
        /* NOTE: deliberately does NOT touch sb-*-auth-token keys */
      }
      toRemove.forEach(function (k) {
        try { localStorage.removeItem(k); }
        catch (e) { /* non-fatal */ }
      });
    } catch (err) {
      console.warn("[mc_storage] wipeMeculsAppDataOnly error:", err);
    }
    return toRemove.length;
  }

  return {
    wipeAll               : wipeAll,
    wipeAllExcept         : wipeAllExcept,
    wipeMeculsAppDataOnly : wipeMeculsAppDataOnly,
    isOwnSession          : isOwnSession,
    /* Exposed for debugging / future audit; do not mutate */
    MECULS_FIXED_KEYS : MECULS_FIXED_KEYS,
    MECULS_PREFIXES   : MECULS_PREFIXES
  };
})();
