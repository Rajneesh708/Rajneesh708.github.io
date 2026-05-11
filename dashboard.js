/* ============================================================
   MECULS — dashboard.js  (phase1-step3)

   ┌─────────────────────────────────────────────────────────┐
   │  WHAT CHANGED FROM THE PREVIOUS VERSION                 │
   │                                                          │
   │  Completion ticks and the progress bar no longer read    │
   │  localStorage flags ("goals_completed", etc.).           │
   │                                                          │
   │  They now read profiles.data JSONB from Supabase — the   │
   │  same single source of truth every page page now writes  │
   │  to via MC.saveSection. localStorage flags from old      │
   │  versions of the portal are ignored.                     │
   │                                                          │
   │  Each section has a small completion rule (predicate)    │
   │  that decides what "done" means for that section. See    │
   │  COMPLETION_PREDICATES below.                            │
   └─────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────┐
   │  SEQUENTIAL LOCK — HOW TO ACTIVATE WHEN READY           │
   │                                                          │
   │  Find this line near the top:                            │
   │    const SEQUENTIAL_LOCK = false;                        │
   │                                                          │
   │  Change it to:                                           │
   │    const SEQUENTIAL_LOCK = true;                         │
   │                                                          │
   │  That single change enforces the rule:                   │
   │  "User cannot open a section until all previous          │
   │   sections are marked complete."                         │
   │  First section is always accessible. Each subsequent     │
   │  section requires the one before it to be complete.      │
   └─────────────────────────────────────────────────────────┘
   ============================================================ */

"use strict";

window.DASHBOARD_VERSION = "phase1-step3-tick-keys-fix";

/* ── SINGLE FLAG — set true when portal is finalised ── */
const SEQUENTIAL_LOCK = false;

/* ── Element refs ── */
const frame              = document.getElementById("contentFrame");
const topBarTitle        = document.getElementById("currentSectionTitle");
const lastUpdated        = document.getElementById("lastUpdated");
const sidebarLastUpdated = document.getElementById("sidebarLastUpdated");
const progressFill       = document.getElementById("progressFill");
const progressPct        = document.getElementById("progressPct");

/* ── Profile data cache ──
   Holds the latest snapshot of profiles.data + a few direct columns
   needed for completion checks (photo_path, cv_path were direct
   columns in the legacy schema; cv_path is no longer used but
   photo_path still might be — we read whichever the page wrote).
   Refreshed on load and every time a page postMessages "submitted". */
let PROFILE_CACHE = {
  data: {},          /* the profiles.data JSONB blob */
  photo_path: null,  /* direct column */
  cv_path: null,     /* direct column (legacy, kept for safety) */
  updated_at: null   /* direct column for "last updated" display */
};

/* ============================================================
   COMPLETION PREDICATES — one per sidebar section.

   Each predicate receives the full PROFILE_CACHE object and returns
   true if that section should show a green tick.

   Rules used (decided by Claude based on what each page saves):
   - Section must have actually-meaningful content, not just an
     empty object/array left behind by a "Save & Continue" with
     nothing typed.
   - 1-to-many sections (experience, education Phase B, certs,
     references, skills, languages, cv_links): tick only if at
     least one entry exists.
   - 1-to-1 sections (profile_category, introduction, preferences,
     goals_interests, languages object): tick only if the key
     "primary" field of that section is filled.
   - Bonus sections that haven't been converted yet (ai_tools,
     consulting, key_achievements, mentorship, portfolio,
     publications, volunteering): no tick until the page is
     converted in Phase 1 Step 3 and starts saving to JSONB.
     Old localStorage "skipped" flags are deliberately ignored.
   ============================================================ */

function _hasItems(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

function _hasText(s) {
  return typeof s === "string" && s.trim().length > 0;
}

const COMPLETION_PREDICATES = {

  /* Goals & Interests — at least one of the meaningful collections has
     something in it. Empty save (visited + clicked Save with nothing
     typed) does not count.

     Field-name note: goals_interests.js saves under these keys —
       how_we_help        : array of {value, description}
       how_help_others    : array of strings
       knowledge_fields   : array of strings (only when "Share knowledge" picked)
       gi_ri_entries      : array of researcher/innovator entries
       heard_about_us     : single string (always required at submit, but
                            useful here as a marker that the user clicked
                            Save & Continue at all)
     We tick if any of the four meaningful collections has content,
     OR if heard_about_us is set (proves user got past validation). */
  goals_completed: (p) => {
    const g = p.data?.goals_interests;
    if (!g) return false;
    return _hasItems(g.how_we_help)
        || _hasItems(g.how_help_others)
        || _hasItems(g.knowledge_fields)
        || _hasItems(g.gi_ri_entries)
        || _hasText(g.heard_about_us);
  },

  /* Photo & CV — both photo and at least one CV link required.
     Photo lives in the direct profiles.photo_path column.
     CV links live in profiles.data.cv_links (array). */
  photo_cv_completed: (p) => {
    return _hasText(p.photo_path) && _hasItems(p.data?.cv_links);
  },

  /* Profile Category — primary field must be picked.
     Field-name note: profile_category.js saves the picked category
     under the key `user_type` (NOT `category`). The shape is:
       { user_type, defense_family_role, abled_status, ... }
     We tick when user_type is set. */
  profile_category_completed: (p) => {
    return _hasText(p.data?.profile_category?.user_type);
  },

  /* Professional Introduction — headline OR summary present.
     (Either is enough — both are required at submit time but
     during build either one indicates real engagement.) */
  introduction_completed: (p) => {
    const i = p.data?.introduction;
    if (!i) return false;
    return _hasText(i.headline) || _hasText(i.summary);
  },

  /* Experience — at least one experience entry. */
  experience_completed: (p) => {
    return _hasItems(p.data?.experiences);
  },

  /* Education — Phase A (current education) filled OR at least
     one Phase B (past education) entry exists.
     Bug fix 2026-05-05: previously checked cur.degree and cur.institution,
     but Phase A actually saves to cur.education_level and cur.institution_name
     (snake_case keys matching the database column names). The mismatch
     meant the green tick never appeared even when Phase A was filled.
     Also added field_of_study as a third valid signal — covers cases
     where the user filled only field of study before saving. */
  education_completed: (p) => {
    const cur = p.data?.education_current;
    const past = p.data?.education;
    const curFilled = cur && (
      _hasText(cur.education_level) ||
      _hasText(cur.institution_name) ||
      _hasText(cur.field_of_study)
    );
    return curFilled || _hasItems(past);
  },

  /* Skills — at least one skill in the array. */
  skills_completed: (p) => {
    return _hasItems(p.data?.skills);
  },

  /* Certifications — at least one certification entry. */
  certifications_completed: (p) => {
    return _hasItems(p.data?.certifications);
  },

  /* References — at least one reference entry. */
  references_completed: (p) => {
    return _hasItems(p.data?.references);
  },

  /* Preferences — section saved (CTC is now optional, so the
     existence of a preferences object with any field set counts).

     Field-name note: preferences.js saves under these keys —
       employment_availability   : string
       preferred_work_mode       : string
       open_to_relocation        : string
       preferred_locations       : array
       expected_ctc_min / _max   : number (CTC is optional)
       expected_ctc_currency     : string
       preferred_roles           : array
       preferred_industries      : array
       preferred_employment_type : string

     We tick if any of the meaningful fields has content. The CTC
     fields are now optional so we shouldn't require them — any of
     availability / work mode / roles / locations counts. */
  preferences_completed: (p) => {
    const pr = p.data?.preferences;
    if (!pr) return false;
    return _hasItems(pr.preferred_roles)
        || _hasItems(pr.preferred_locations)
        || _hasItems(pr.preferred_industries)
        || _hasText(pr.employment_availability)
        || _hasText(pr.preferred_work_mode)
        || _hasText(pr.open_to_relocation)
        || _hasText(pr.preferred_employment_type)
        || pr.expected_ctc_min != null
        || pr.expected_ctc_max != null;
  },

  /* Languages — at least one language entry in the languages array
     inside the languages object. */
  languages_completed: (p) => {
    return _hasItems(p.data?.languages?.languages);
  },

  /* ---------- Bonus sections (not yet converted) ----------
     These return false until each page is converted to write to
     profiles.data JSONB. Old localStorage flags are ignored on
     purpose so stale "skipped" state doesn't show false ticks. */

  ai_tools_completed:         (p) => _hasSection(p, "ai_tools"),
  consulting_completed:       (p) => _hasSection(p, "consulting"),
  key_achievements_completed: (p) => _hasSection(p, "key_achievements"),
  mentorship_completed:       (p) => _hasSection(p, "mentorship"),
  portfolio_completed:        (p) => _hasSection(p, "portfolio"),
  publications_completed:     (p) => _hasSection(p, "publications"),
  volunteering_completed:     (p) => _hasSection(p, "volunteering")
};

/* Helper for bonus sections: tick only if the JSONB section exists
   AND has at least one non-empty field/entry. This is intentionally
   lenient — once the bonus pages are converted, whatever shape they
   save (object or array) will tick correctly without further changes
   here, as long as the section name matches. If you want a stricter
   rule per bonus section after conversion, replace the entry above
   with a custom predicate. */
function _hasSection(p, key) {
  const v = p.data?.[key];
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") {
    return Object.values(v).some(val => {
      if (val == null) return false;
      if (Array.isArray(val)) return val.length > 0;
      if (typeof val === "string") return val.trim().length > 0;
      return true;
    });
  }
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

/* ── isCompleted helper ──
   Looks up the predicate for the given completion key and runs it
   against the cached profile snapshot. Returns false if no
   predicate is registered (defensive — prevents accidental ticks). */
function isCompleted(key) {
  const fn = COMPLETION_PREDICATES[key];
  if (typeof fn !== "function") return false;
  try {
    return !!fn(PROFILE_CACHE);
  } catch (e) {
    /* If predicate throws (bad data shape), treat as not done. */
    return false;
  }
}

/* Completion keys — must match data-completion-key in HTML, in order.
   Includes the 11 main steps PLUS the 7 bonus pages, so the progress
   bar reflects the full profile. */
const COMPLETION_KEYS = [
  "goals_completed",
  "photo_cv_completed",
  "profile_category_completed",
  "introduction_completed",
  "experience_completed",
  "education_completed",
  "skills_completed",
  "certifications_completed",
  "references_completed",
  "preferences_completed",
  "languages_completed",
  "ai_tools_completed",
  "consulting_completed",
  "key_achievements_completed",
  "mentorship_completed",
  "portfolio_completed",
  "publications_completed",
  "volunteering_completed"
];

/* ============================================================
   LOGO — image or text fallback
   ============================================================ */
function setupLogo() {
  const img      = document.getElementById("brandImg");
  const textMark = document.getElementById("brandText");
  if (!img || !textMark) return;

  img.addEventListener("load",  () => {
    img.style.display      = "block";
    textMark.style.display = "none";
  });

  img.addEventListener("error", () => {
    img.style.display      = "none";
    textMark.style.display = "block";
  });
}

/* ============================================================
   LOAD PAGE
   ============================================================ */
function loadPage(page, sidebarKey) {
  if (!frame) return;
  frame.src = page + "?_=" + Date.now();
  if (topBarTitle) topBarTitle.textContent = sidebarKey || "My Profile";

  document.querySelectorAll(".sidebar__btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-page") === page);
  });

  refreshTicks();
  refreshProgress();
}

/* ============================================================
   SIDEBAR WIRING + SEQUENTIAL LOCK
   ============================================================ */
function wireSidebar() {
  const buttons = [...document.querySelectorAll(".sidebar__btn")];

  buttons.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      /* When lock is active: check if all previous sections are done */
      if (SEQUENTIAL_LOCK && index > 0) {
        const prevKey  = buttons[index - 1].getAttribute("data-completion-key");
        const prevDone = isCompleted(prevKey);

        if (!prevDone) {
          /* Silently ignore — button is visually locked via .locked class */
          return;
        }
      }

      const page = btn.getAttribute("data-page");
      const key  = btn.getAttribute("data-key");
      if (page) loadPage(page, key);
    });
  });
}

/* ============================================================
   LOCK STATE VISUAL REFRESH
   Applies .locked class to sections that can't be reached yet.
   Only active when SEQUENTIAL_LOCK = true.
   ============================================================ */
function refreshLockState() {
  if (!SEQUENTIAL_LOCK) {
    /* Lock off — ensure no buttons are locked */
    document.querySelectorAll(".sidebar__btn").forEach(btn => {
      btn.classList.remove("locked");
    });
    return;
  }

  const buttons = [...document.querySelectorAll(".sidebar__btn")];
  buttons.forEach((btn, index) => {
    if (index === 0) {
      btn.classList.remove("locked");
      return;
    }
    const prevKey  = buttons[index - 1].getAttribute("data-completion-key");
    const prevDone = isCompleted(prevKey);
    btn.classList.toggle("locked", !prevDone);
  });
}

/* ============================================================
   postMessage LISTENER
   ============================================================ */
function setupMessages() {
  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (!d || typeof d !== "object") return;

    if (d.type === "navigate" && d.page) {
      loadPage(d.page, d.sidebarKey || d.page);
      /* Re-fetch profile in case the user just saved on the page
         they're navigating away from. */
      await refreshProfileCache();
      refreshTicks();
      refreshProgress();
      refreshUpdated();
      refreshLockState();
    }

    if (d.type === "saved") {
      /* A page wrote to the database and wants the dashboard to
         re-pull and update its ticks/progress. Pages can post
         { type: "saved" } after a successful MC.saveSection. */
      await refreshProfileCache();
      refreshTicks();
      refreshProgress();
      refreshUpdated();
      refreshLockState();
    }

    if (d.type === "submitted") {
      await refreshProfileCache();
      refreshTicks();
      refreshProgress();
      refreshUpdated();
      refreshLockState();
      /* Load the post-submission page into the iframe */
      loadPage("submission_complete.html", "Profile Submitted");
    }
  });
}

/* ============================================================
   COMPLETION TICKS
   ============================================================ */
function refreshTicks() {
  document.querySelectorAll(".sidebar__btn").forEach(btn => {
    const key  = btn.getAttribute("data-completion-key");
    const tick = btn.querySelector(".sidebar__tick");
    if (!tick) return;
    tick.classList.toggle("visible", !!(key && isCompleted(key)));
  });
}

/* ============================================================
   PROGRESS BAR
   ============================================================ */
function refreshProgress() {
  const done  = COMPLETION_KEYS.filter(k => isCompleted(k)).length;
  const total = COMPLETION_KEYS.length;
  const pct   = Math.round((done / total) * 100);
  if (progressFill) progressFill.style.width = pct + "%";
  if (progressPct)  progressPct.textContent  = pct + "%";
}

/* ============================================================
   LAST UPDATED
   Reads from PROFILE_CACHE.updated_at (the profiles.updated_at
   timestamp set by the Postgres trigger). Falls back to the old
   localStorage value only if no DB value is available — this is
   purely cosmetic so a missing timestamp doesn't blank the UI.
   ============================================================ */
function refreshUpdated() {
  let text = "";
  if (PROFILE_CACHE.updated_at) {
    try {
      const d = new Date(PROFILE_CACHE.updated_at);
      text = "Last updated " + d.toLocaleDateString();
    } catch (e) {
      text = "";
    }
  } else {
    const ts = localStorage.getItem("profile_last_updated");
    if (ts) text = "Last updated " + ts;
  }
  if (lastUpdated)        lastUpdated.textContent        = text;
  if (sidebarLastUpdated) sidebarLastUpdated.textContent = text;
}

/* ============================================================
   AUTH — Supabase session check + user info display + sign out
   ============================================================
   Loaded BEFORE the rest of init. If not logged in, redirects
   to login.html and the rest of dashboard initialisation does
   not run. If logged in, fetches the user's name and shows it
   in the topbar with a Sign Out button. */

/* Supabase client — created lazily because the supabase global
   is loaded by a separate <script> tag in dashboard.html. */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const topbarUserEl     = document.getElementById("topbarUser");
const topbarUserNameEl = document.getElementById("topbarUserName");
const topbarSignOutBtn = document.getElementById("topbarSignOutBtn");

/* ── Re-entry guard for hardSignOutAndRedirect ──
   Without this, signOut() fires onAuthStateChange which calls
   hardSignOutAndRedirect() which calls signOut() again. Loop. */
let _dashSigningOut = false;

/* ── Hard sign-out helper ──
   Used by the Sign Out button AND auto-detection paths
   (server-rejected token, cross-tab signout, bfcache restore).
   Delegates wipe to MC_STORAGE.wipeAll() so the canonical key
   list lives in ONE place — fixes the cross-user data leak. */
async function hardSignOutAndRedirect() {
  if (_dashSigningOut) return;
  _dashSigningOut = true;

  /* Comprehensive wipe via MC_STORAGE. Falls back to inline
     cleanup of essentials if MC_STORAGE isn't loaded. */
  if (typeof MC_STORAGE !== "undefined" && MC_STORAGE.wipeAll) {
    MC_STORAGE.wipeAll();
  } else {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function (k) { localStorage.removeItem(k); });
      localStorage.removeItem("user_type");
      localStorage.removeItem("candidate_id");
      localStorage.removeItem("registration_complete");
    } catch (e) { /* non-fatal */ }
  }

  try { await sb.auth.signOut(); } catch (e) { /* ignore */ }

  window.location.replace("login.html");
}

async function ensureLoggedInAndShowUser() {
  /* Stage 1: local session must exist (catches "never logged in"). */
  const { data: { session }, error: sessionError } = await sb.auth.getSession();

  if (sessionError || !session) {
    window.location.replace("login.html");
    return false;
  }

  /* Stage 2: validate the token AGAINST THE SERVER with getUser().
     getSession() is cache-only and returns valid-looking session
     even if user was deleted server-side. getUser() actually hits
     the server. */
  const { data: userData, error: userError } = await sb.auth.getUser();

  if (userError || !userData || !userData.user) {
    console.warn("[dashboard] Session token rejected by server — signing out");
    await hardSignOutAndRedirect();
    return false;
  }

  /* Stage 3: render the topbar. Use server-confirmed userData.user
     as source of truth. */
  const meta     = userData.user.user_metadata || {};
  const fullName = meta.full_name || userData.user.email || "Account";
  if (topbarUserNameEl) topbarUserNameEl.textContent = "Welcome, " + fullName;
  if (topbarUserEl)     topbarUserEl.classList.add("is-visible");

  /* Set candidate_id in localStorage so MC.candidateId works for
     iframe pages (SaveNow drafts etc.). */
  try {
    localStorage.setItem("candidate_id", userData.user.id);
  } catch (e) { /* localStorage may be disabled in private mode */ }

  /* Record user activity. This:
       - bumps profiles.last_active_at to NOW() (prevents archive)
       - auto-restores the user if their account was archived
     Failure is non-fatal (function may not be deployed on older
     databases — page still works without it). Fire-and-forget; we
     don't await it because we don't need to block dashboard render. */
  sb.rpc("record_user_activity").then(({ data, error }) => {
    if (error) {
      console.warn("[dashboard] record_user_activity failed:", error.message);
      return;
    }
    if (data && data.restored) {
      console.log("[dashboard] Account auto-restored from archived state");
    }
  }).catch((e) => {
    console.warn("[dashboard] record_user_activity unavailable:", e);
  });

  /* Wire the Sign Out button */
  if (topbarSignOutBtn) {
    topbarSignOutBtn.addEventListener("click", async () => {
      topbarSignOutBtn.disabled    = true;
      topbarSignOutBtn.textContent = "Signing out\u2026";
      await hardSignOutAndRedirect();
    });
  }

  return true;
}

/* ── pageshow listener — defeat bfcache ── */
window.addEventListener("pageshow", async function (event) {
  if (!event.persisted) return;
  if (_dashSigningOut) return;

  const { data, error } = await sb.auth.getUser();
  if (error || !data || !data.user) {
    console.warn("[dashboard] pageshow: session invalid, signing out");
    await hardSignOutAndRedirect();
  }
});

/* ── onAuthStateChange — cross-tab signout ──
   ONLY responds to SIGNED_OUT, not TOKEN_REFRESHED. */
sb.auth.onAuthStateChange(function (event /*, session */) {
  if (_dashSigningOut) return;
  if (event === "SIGNED_OUT") {
    console.warn("[dashboard] auth state change: SIGNED_OUT");
    hardSignOutAndRedirect();
  }
});

/* ============================================================
   PROFILE CACHE LOADER
   Pulls profiles.data + a few direct columns from Supabase into
   PROFILE_CACHE. Called once on init, then again on every "saved"
   or "navigate" or "submitted" postMessage from the iframe.
   ============================================================ */
async function refreshProfileCache() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;

    const { data, error } = await sb
      .from("profiles")
      .select("data, photo_path, cv_path, updated_at")
      .eq("user_id", session.user.id)
      .single();

    if (error) {
      /* If the row doesn't exist yet (handle_new_user trigger should
         have created it, but be defensive), or any other read error,
         fall back to empty cache so nothing accidentally ticks. */
      PROFILE_CACHE = {
        data: {},
        photo_path: null,
        cv_path: null,
        updated_at: null
      };
      return;
    }

    PROFILE_CACHE = {
      data:       data?.data       || {},
      photo_path: data?.photo_path || null,
      cv_path:    data?.cv_path    || null,
      updated_at: data?.updated_at || null
    };
  } catch (e) {
    /* Network or unexpected error — keep last known cache. */
  }
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  /* Auth guard FIRST. If not logged in, this redirects and
     stops execution before the rest of dashboard renders. */
  const ok = await ensureLoggedInAndShowUser();
  if (!ok) return;

  setupLogo();
  wireSidebar();
  setupMessages();

  /* Pull the profile snapshot before painting ticks, so the very
     first render reflects real data, not an empty cache. */
  await refreshProfileCache();

  refreshTicks();
  refreshProgress();
  refreshUpdated();
  refreshLockState();

  /* Open first section by default */
  const first = document.querySelector(".sidebar__btn");
  if (first) loadPage(first.getAttribute("data-page"), first.getAttribute("data-key"));
});
