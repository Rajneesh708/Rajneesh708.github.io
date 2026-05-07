/* ============================================================
   MECULS — mc_supabase.js (v=23)
   Shared Supabase client helpers for page JS files running
   inside the dashboard iframe.
   ============================================================
   USAGE: include this AFTER the supabase-js library, AFTER
   config.js, and AFTER mc_storage.js, but BEFORE the
   page-specific JS file:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="config.js?v=N"></script>
     <script src="mc_storage.js?v=N"></script>
     <script src="mc_supabase.js?v=N"></script>
     <script src="mc_helpers.js?v=N"></script>
     <script src="goals_interests.js?v=N"></script>

   PROVIDES:
     MC_SB.getClient()           — singleton Supabase client
     MC_SB.ensureSession()       — rehydrates session in iframe
     MC_SB.getCandidateId()      — convenience: returns auth.uid()
     MC_SB.isUserValidOnServer() — server-validates the session

   AUTO-PROTECT (v=21 fixes carried forward):
   - Two-stage check: local session + server validation
   - _signingOut re-entry guard prevents infinite loops
   - onAuthStateChange listens ONLY for SIGNED_OUT
   - pageshow listener fires only on bfcache restore

   v=23 changes:
   - isUserValidOnServer() now distinguishes auth failures from
     transient network errors. Previously ANY error from getUser()
     caused immediate signout — including network blips during
     iframe navigation. Users reported being logged out when
     clicking from one sidebar page to another. Now only positive
     evidence of auth rejection (user_not_found, jwt_expired,
     401/403, etc) triggers signout. Transient errors give the
     user the benefit of the doubt — if their session is genuinely
     invalid, the next RLS-protected action will fail explicitly.

   Earlier carry-forward (was labeled v=22):
   - Sign-out cleanup delegates to MC_STORAGE.wipeAll() so the
     canonical key list lives in ONE place — fixes the cross-user
     data leak.
   ============================================================ */

"use strict";

window.MC_SB = window.MC_SB || (function () {

  let _client      = null;
  let _signingOut  = false;  /* re-entry guard */

  function getClient() {
    if (_client) return _client;
    if (typeof supabase === "undefined" || !supabase.createClient) {
      throw new Error("Supabase JS library not loaded — add the supabase-js <script> tag before this file.");
    }
    if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined") {
      throw new Error("config.js not loaded — add the config.js <script> tag before this file.");
    }
    _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _client;
  }

  /* This page runs INSIDE an iframe. We rehydrate the session from
     localStorage so RLS-aware queries work inside the iframe. */
  async function ensureSession() {
    const sb = getClient();

    const { data: { session: existing } } = await sb.auth.getSession();
    if (existing) return existing;

    let storedToken = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        storedToken = localStorage.getItem(key);
        break;
      }
    }

    if (!storedToken) {
      throw new Error("No Supabase session found. Please log in again.");
    }

    let parsed;
    try { parsed = JSON.parse(storedToken); }
    catch (e) { throw new Error("Stored session is corrupt. Please log in again."); }

    if (!parsed.access_token || !parsed.refresh_token) {
      throw new Error("Stored session is missing tokens. Please log in again.");
    }

    const { data, error } = await sb.auth.setSession({
      access_token : parsed.access_token,
      refresh_token: parsed.refresh_token
    });
    if (error) {
      throw new Error("Could not restore session: " + error.message);
    }
    return data.session;
  }

  async function getCandidateId() {
    const session = await ensureSession();
    return session.user.id;
  }

  /* ── Server-validated user check ──
     Returns false ONLY when we have positive evidence the auth was rejected
     (user deleted, token revoked, etc). Returns true on transient network
     errors, server timeouts, or unexpected exceptions.

     Why: previously any error from getUser() — including transient network
     blips during iframe navigation — caused immediate signout. Users
     reported being logged out when clicking from one sidebar page to
     another. The fix gives benefit of the doubt for non-auth errors.
     If the session is genuinely invalid, the next RLS-protected action
     (saving a form, etc.) will fail with a clear auth error and the
     user can log in fresh then. */
  async function isUserValidOnServer() {
    try {
      const sb = getClient();
      const { data, error } = await sb.auth.getUser();

      if (error) {
        const msg = (error.message || "").toLowerCase();
        const status = error.status || 0;

        /* Positive evidence of auth rejection */
        const isAuthFailure =
          msg.indexOf("user_not_found") !== -1 ||
          msg.indexOf("user not found") !== -1 ||
          msg.indexOf("invalid jwt") !== -1 ||
          msg.indexOf("jwt expired") !== -1 ||
          msg.indexOf("invalid token") !== -1 ||
          msg.indexOf("invalid_token") !== -1 ||
          msg.indexOf("invalid_grant") !== -1 ||
          msg.indexOf("session_not_found") !== -1 ||
          msg.indexOf("session not found") !== -1 ||
          status === 401 ||
          status === 403;

        if (isAuthFailure) {
          console.warn("[mc_supabase] getUser() returned auth failure:", error.message);
          return false;
        }

        /* Transient error — log but don't sign user out */
        console.warn("[mc_supabase] getUser() transient error (ignoring):", error.message, "status:", status);
        return true;
      }

      if (!data || !data.user) return false;
      return true;
    } catch (e) {
      /* Network exception, fetch failure, etc. — transient, don't sign out */
      console.warn("[mc_supabase] getUser() threw exception (ignoring):", e.message);
      return true;
    }
  }

  /* ── Hard sign-out helper ──
     Re-entry-guarded. Wipes ALL MECULS keys and Supabase tokens
     via MC_STORAGE.wipeAll(), then redirects parent window to
     login.html. */
  async function hardSignOutAndRedirect() {
    if (_signingOut) return;
    _signingOut = true;

    /* Comprehensive wipe — all MECULS keys + all sb-*-auth-tokens.
       Falls back to inline removal of just the auth tokens if
       MC_STORAGE isn't loaded for any reason. */
    if (typeof MC_STORAGE !== "undefined" && MC_STORAGE.wipeAll) {
      MC_STORAGE.wipeAll();
    } else {
      /* Defensive fallback. Should never happen in practice
         because every page that loads mc_supabase.js also loads
         mc_storage.js, but if the load order breaks we still
         clear the auth token. */
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) { /* non-fatal */ }
    }

    /* Best-effort signOut on the client. This WILL fire
       onAuthStateChange("SIGNED_OUT") but the re-entry guard
       prevents recursion. */
    try {
      const sb = getClient();
      await sb.auth.signOut();
    } catch (e) { /* ignore — we're redirecting anyway */ }

    /* Escape the iframe to land on login.html in the top window */
    try {
      if (window.parent && window.parent !== window) {
        window.parent.location.replace("login.html");
      } else {
        window.location.replace("login.html");
      }
    } catch (e) {
      window.location.replace("login.html");
    }
  }

  /* ── AUTO-PROTECT ──
     Runs on script load. Two-stage check:
       1. ensureSession() succeeds → user has a token
       2. isUserValidOnServer() → server confirms the user exists */
  (function autoProtect() {
    if (typeof supabase === "undefined" || !supabase.createClient) {
      return;
    }

    ensureSession()
      .then(async function () {
        const valid = await isUserValidOnServer();
        if (!valid) {
          console.warn("[mc_supabase] Session token rejected by server — signing out");
          hardSignOutAndRedirect();
        }
      })
      .catch(function (err) {
        console.warn("[mc_supabase] no local session, redirecting to login:", err.message);
        hardSignOutAndRedirect();
      });
  })();

  /* ── pageshow listener — defeat bfcache ── */
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    if (_signingOut) return;

    isUserValidOnServer().then(function (valid) {
      if (!valid) {
        console.warn("[mc_supabase] pageshow: session invalid, signing out");
        hardSignOutAndRedirect();
      }
    });
  });

  /* ── onAuthStateChange — cross-tab signout ──
     ONLY responds to SIGNED_OUT. NOT TOKEN_REFRESHED — that's a
     normal hourly event that occasionally fires with a momentarily
     null session, which would falsely trigger signout. */
  try {
    const sb = getClient();
    sb.auth.onAuthStateChange(function (event /*, session */) {
      if (_signingOut) return;
      if (event === "SIGNED_OUT") {
        console.warn("[mc_supabase] auth state change: SIGNED_OUT");
        hardSignOutAndRedirect();
      }
    });
  } catch (e) {
    /* If the client can't be created, autoProtect already handled it */
  }

  return {
    getClient,
    ensureSession,
    getCandidateId,
    isUserValidOnServer
  };
})();
