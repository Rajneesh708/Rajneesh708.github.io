/* =========================================================
   MECULS — guard.js
   Universal authentication and onboarding guard.

   Uses Supabase Auth for real session management.

   HOW IT WORKS:
   - requireAuth()      → redirects to login.html if no session
   - requireCandidate() → requireAuth + checks user_type = candidate
   - requireRecruiter() → requireAuth + checks user_type = recruiter
   - signOut()          → signs out and redirects to login.html

   DEVELOPMENT MODE:
   Set DEV_MODE = true below to bypass all guards while building.
   Set DEV_MODE = false before going live.

   DEPENDENCIES:
   config.js must be loaded BEFORE guard.js on every page.
   The Supabase JS library must be loaded BEFORE guard.js.
   ========================================================= */

/* ╔══════════════════════════════════════════════════════════╗
   ║  [LAUNCH FLAG]                                           ║
   ║                                                          ║
   ║  DEV_MODE controls whether auth checks are bypassed.     ║
   ║                                                          ║
   ║  - DEV_MODE = true  → all guards bypassed (dev only)     ║
   ║  - DEV_MODE = false → real auth required (launch state)  ║
   ║                                                          ║
   ║  Flipped 2026-05-02 in preparation for launch.           ║
   ║  If you need to bypass auth for local development,       ║
   ║  flip this back to true LOCALLY ONLY — do not commit     ║
   ║  the change to the live branch.                          ║
   ╚══════════════════════════════════════════════════════════╝ */
const DEV_MODE = false;

/* v=3 — DEV_MODE safety check.
   If DEV_MODE is ever accidentally set to true and pushed to production,
   this fires a loud red console error on every page load so it cannot
   be missed. It does NOT override DEV_MODE — only a code change can do that.
   This is purely an early-warning system. */
if (DEV_MODE) {
  const _host = window.location.hostname;
  if (_host !== "localhost" && _host !== "127.0.0.1" && _host !== "") {
    console.error(
      "%c[guard.js] SECURITY WARNING: DEV_MODE is TRUE on a live host (" +
      _host + "). Every authentication check is bypassed. " +
      "Set DEV_MODE = false immediately and redeploy.",
      "color:#fff;background:#c0392b;font-size:15px;padding:4px 8px;border-radius:3px;"
    );
  }
}

/* ── Supabase client (initialised from config.js values) ── */
let _supabase = null;

function getSupabase() {
  if (_supabase) return _supabase;
  if (typeof supabase === "undefined") {
    console.error("Guard: Supabase library not loaded. Add the Supabase CDN script before guard.js.");
    return null;
  }
  _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

/* ── Get current session (async) ── */
async function getSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

/* ── Get current user metadata from localStorage (set at login) ── */
function getUserType() {
  return localStorage.getItem("user_type");
}

function getCandidateId() {
  return localStorage.getItem("candidate_id");
}

/* ── Require login — redirect to login.html if no session.
   v=2: now server-validates via getUser() — catches deleted users
   whose local cache still says "valid session". */
async function requireAuth() {
  if (DEV_MODE) return null;

  const sb = getSupabase();
  if (!sb) {
    window.location.replace("login.html");
    return null;
  }

  /* Stage 1: local session must exist */
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.replace("login.html");
    return null;
  }

  /* Stage 2: server must confirm the user */
  const { data, error } = await sb.auth.getUser();
  if (error || !data || !data.user) {
    await signOut();   /* clears state and redirects */
    return null;
  }

  /* v=3: sync user_type from server-verified metadata to localStorage.
     This overwrites any value a user may have written via DevTools,
     making requireCandidate() / requireRecruiter() tamper-resistant.
     Email/password users have user_type set in user_metadata at signup.
     Google OAuth users don't (GIS doesn't accept arbitrary metadata),
     so for them we leave whatever login.js set — which is always
     "candidate" as of v=29. */
  try {
    const serverType = data.user.user_metadata && data.user.user_metadata.user_type;
    if (serverType) {
      localStorage.setItem("user_type", serverType);
    }
  } catch (_e) { /* localStorage may be blocked in private mode */ }

  return session;
}

/* ── Require candidate session ── */
async function requireCandidate() {
  if (DEV_MODE) return null;

  const session = await requireAuth();
  if (!session) return null;

  if (getUserType() !== "candidate") {
    window.location.replace("login.html");
    return null;
  }
  return session;
}

/* ── Require recruiter session ── */
async function requireRecruiter() {
  if (DEV_MODE) return null;

  const session = await requireAuth();
  if (!session) return null;

  if (getUserType() !== "recruiter") {
    window.location.replace("login.html");
    return null;
  }
  return session;
}

/* ── Sign out ──
   v=2: delegates wipe to MC_STORAGE.wipeAll() so all MECULS keys
   AND Supabase auth tokens are cleared from one source of truth.
   Falls back to inline cleanup if MC_STORAGE isn't loaded. */
async function signOut() {
  const sb = getSupabase();
  if (sb) {
    try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
  }

  if (typeof MC_STORAGE !== "undefined" && MC_STORAGE.wipeAll) {
    MC_STORAGE.wipeAll();
  } else {
    /* Fallback if mc_storage.js wasn't loaded */
    try {
      localStorage.removeItem("user_type");
      localStorage.removeItem("candidate_id");
      localStorage.removeItem("registration_complete");
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

  window.location.replace("login.html");
}

/* ── Legacy helpers (kept for compatibility with dashboard.js) ── */
function isRegistered() {
  return localStorage.getItem("registration_complete") === "yes";
}

function isProfileCompleteForCurrentUser() {
  const userType = getUserType();
  if (!userType) return false;
  return localStorage.getItem("profile_completed_" + userType) === "yes";
}

function isAccountActive() {
  return isRegistered() && !!getUserType() && isProfileCompleteForCurrentUser();
}

/* ── Resume later banner ── */
function showResumeBanner() {
  if (
    !DEV_MODE &&
    isRegistered() &&
    getUserType() &&
    !isProfileCompleteForCurrentUser()
  ) {
    const banner = document.createElement("div");
    banner.className = "resume-banner";
    banner.innerHTML = `
      <strong>Profile incomplete.</strong>
      Please complete your profile to activate your account.
    `;
    document.body.prepend(banner);
  }
}
