/* ============================================================
   MECULS — register.js (v=23)
   Date: 2026-06-15 (add email to upsert row — NOT NULL fix)
   ============================================================
   Carried forward from v=21:
   - Soft Gmail hint feature kept removed
   - emailRedirectTo with ?confirmed=1
   - Google Identity Services (GIS) sign-up flow
   - Required-consent gate before Google button enabled
   - _writeConsentsForNewUser handles fresh signup AND orphan rows

   New in v=22 — change UPDATE to UPSERT in _writeConsentsForNewUser:
   ----------------------------------------------------------
   PROBLEM IT FIXES:
     If the handle_new_user trigger did not fire (e.g. the Google
     account already existed in auth.users from a prior failed
     attempt), no profile row exists yet. The v=21 UPDATE found
     0 rows and silently did nothing — the verify step then threw
     "Consents did not persist." Deleting the orphan auth.users
     entry was the manual workaround, but the permanent fix is to
     use UPSERT so the profile row is created if missing.

   THE FIX:
     - Replace .update(consentPayload).eq("user_id", user.id)
       with .upsert({ user_id: user.id, ...consentPayload },
       { onConflict: "user_id" })
     - If the row exists → updates consent columns (same as before)
     - If the row is missing → inserts it with user_id + consents
     - Eliminates the orphan-row failure mode permanently

   New in v=21 — fix silent UPDATE failure that left ALL Google
   sign-ups with terms_consent=false:
   ----------------------------------------------------------
   PROBLEM IT FIXES:
     v=20's consent payload included `user_type: "candidate"`,
     but the profiles table has NO column named user_type.
     PostgreSQL rejected the entire UPDATE with "column user_type
     of relation profiles does not exist". The error was caught
     as a console.warn — invisible in production. Result: every
     Google signup left terms_consent=false in the database,
     making the account non-functional once login.js v=27's
     consent-check landed.

     The user_type column was a relic from an earlier schema
     where profile category was a top-level column. It's now
     stored in data.profile_category (JSONB) instead, set by
     the profile_category page during onboarding.

   THE FIX:
     - Remove user_type from the UPDATE payload entirely.
     - Set timestamps (*_consent_at) for ALL consents that are
       set to true, not just marketing. Previously we only
       stamped marketing_consent_at, leaving the other four
       timestamps NULL even when consents were true. The
       handle_new_user trigger does this correctly when consent
       metadata is present in raw_user_meta_data, but on the
       Google path that metadata is empty, so we must set
       timestamps here.

   AUDIT-COMPLETENESS:
     For DPDP/GDPR compliance, recording the precise moment a
     user gave each consent matters. Setting all *_at columns
     means every consent has both a value AND a timestamp.
   ============================================================ */

"use strict";

/* ── Supabase client ── */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── DOM refs ── */
const registerForm     = document.getElementById("registerForm");
const regName          = document.getElementById("regName");
const regEmail         = document.getElementById("regEmail");
const regPassword      = document.getElementById("regPassword");
const registerBtn      = document.getElementById("registerBtn");
const registerError    = document.getElementById("registerError");
const captchaError     = document.getElementById("captchaError");
const googleBtnContainer = document.getElementById("googleSignInBtnContainer");
const gmailHint        = document.getElementById("gmailHint");
const toggleRegPwd     = document.getElementById("toggleRegPassword");
const strengthBar      = document.getElementById("strengthBar");
const strengthLabel    = document.getElementById("strengthLabel");
const regSuccessState  = document.getElementById("regSuccessState");
const regSuccessMsg    = document.getElementById("regSuccessMsg");

/* ── Consent checkbox refs (5 total) ── */
const consentTerms       = document.getElementById("consentTerms");
const consentAge         = document.getElementById("consentAge");
const consentEmailShare  = document.getElementById("consentEmailShare");
const consentNotif       = document.getElementById("consentNotif");
const consentMarketing   = document.getElementById("consentMarketing");

/* ── Turnstile token storage ── */
window.captchaToken = null;
let captchaReady = false;

window.onCaptchaSuccess = function (token) {
  window.captchaToken = token;
  captchaReady = true;
  if (captchaError) captchaError.classList.add("hidden");
  refreshSubmitState();
};

window.onCaptchaError = function () {
  window.captchaToken = null;
  if (captchaError) {
    captchaError.textContent = "Security check failed. Please try again.";
    captchaError.classList.remove("hidden");
  }
  refreshSubmitState();
};

window.onCaptchaExpired = function () {
  window.captchaToken = null;
  if (captchaError) {
    captchaError.textContent = "Security check expired. Please complete it again.";
    captchaError.classList.remove("hidden");
  }
  refreshSubmitState();
};

function resetCaptcha() {
  window.captchaToken = null;
  if (window.turnstile && window.turnstile.reset) {
    try { window.turnstile.reset(); } catch (e) { /* widget not yet ready */ }
  }
  refreshSubmitState();
}

/* ── Floating error toast ── */
let toastDismissTimer = null;

function showError(msg) {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }

  registerError.innerHTML = "";
  const text = document.createElement("span");
  text.textContent = msg;
  registerError.appendChild(text);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast__close";
  closeBtn.setAttribute("aria-label", "Dismiss error");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", hideError);
  registerError.appendChild(closeBtn);

  registerError.classList.remove("hidden");
  registerError.classList.add("toast--floating");
  registerError.style.display = "block";

  toastDismissTimer = setTimeout(hideError, 8000);
}

function hideError() {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  registerError.classList.add("hidden");
  registerError.classList.remove("toast--floating");
  registerError.style.display = "none";
  registerError.textContent = "";
}

/* ── Loading state for buttons ── */
function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn.classList.add("btn--loading");
    btn._orig = btn.textContent;
    btn.textContent = "Please wait\u2026";
  } else {
    btn.disabled = false;
    btn.classList.remove("btn--loading");
    btn.textContent = btn._orig || btn.textContent;
  }
}

function showSuccess(msg) {
  registerForm.classList.add("hidden");
  regSuccessMsg.textContent = msg;
  regSuccessState.classList.remove("hidden");
  regSuccessState.scrollIntoView({ behavior: "smooth", block: "center" });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ── Required-consents check ── */
function requiredConsentsTicked() {
  return consentTerms.checked === true && consentAge.checked === true;
}

/* ── Submit + Google button + Google-hint state ── */
function refreshSubmitState() {
  /* Email/password submit button — gated by captcha completion */
  const submitReady = window.captchaToken !== null && captchaReady;
  if (!registerBtn.classList.contains("btn--loading")) {
    registerBtn.disabled = !submitReady;
    registerBtn.classList.toggle("btn--disabled", !submitReady);
  }

  /* Note: Google button is ALWAYS visible — visibility no longer
     gated on consents. The .gis-click-gate wrapper intercepts clicks
     when consents aren't ticked (see _initialiseGoogleSignIn). */
}

consentTerms.addEventListener("change", refreshSubmitState);
consentAge.addEventListener("change", refreshSubmitState);

/* ── Gmail hint — show below email field when user types a gmail.com
   address. Gentle suggestion to use the visible Google button above. */
function _updateGmailHint() {
  if (!gmailHint || !regEmail) return;
  const v = (regEmail.value || "").trim().toLowerCase();
  const isGmail = /@gmail\.com$/.test(v);
  gmailHint.classList.toggle("hidden", !isGmail);
}
if (regEmail) {
  regEmail.addEventListener("input", _updateGmailHint);
  regEmail.addEventListener("blur", _updateGmailHint);
}

/* ── Build consent metadata payload ── */
function buildConsentMetadata(fullName) {
  return {
    full_name           : fullName,
    user_type           : "candidate",
    terms_consent       : !!consentTerms.checked,
    age_18_confirmed    : !!consentAge.checked,
    email_share_consent : !!consentEmailShare.checked,
    notif_consent       : !!consentNotif.checked,
    marketing_consent   : !!consentMarketing.checked
  };
}

/* ── Password strength ── */
function measureStrength(pwd) {
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return score;
}

function updateStrengthDisplay() {
  const pwd = regPassword.value;
  const score = measureStrength(pwd);

  const levels  = ["", "Weak", "Weak", "Fair", "Good", "Strong"];
  const colours = ["", "#ef4444", "#ef4444", "#f59e0b", "#3b82f6", "#22c55e"];
  const widths  = ["0%", "20%", "40%", "60%", "80%", "100%"];

  strengthBar.style.width      = pwd.length ? widths[score]  : "0%";
  strengthBar.style.background = pwd.length ? colours[score] : "transparent";
  strengthLabel.textContent    = pwd.length ? `Password strength: ${levels[score]}` : "";
}

regPassword.addEventListener("input",  updateStrengthDisplay);
regPassword.addEventListener("change", updateStrengthDisplay);

/* ── Password visibility toggle ── */
toggleRegPwd.addEventListener("click", () => {
  const show = regPassword.type === "password";
  regPassword.type = show ? "text" : "password";
  toggleRegPwd.setAttribute("aria-pressed", show ? "true" : "false");
  toggleRegPwd.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

/* ── Client-side rate limiter ── */
let lastSubmitAt = 0;
const MIN_SUBMIT_GAP_MS = 3000;

function isRateLimited() {
  const now = Date.now();
  if (now - lastSubmitAt < MIN_SUBMIT_GAP_MS) {
    return true;
  }
  lastSubmitAt = now;
  return false;
}

/* ── Google Sign Up ── */
/* ── Google Sign Up via Google Identity Services (GIS) ──
   Why: see login.js — we keep the entire OAuth flow on meculs.com so
   Google's consent screen shows our domain, not supabase.co.

   Special handling for register flow:
   - Required consents (terms + age 18+) must be ticked BEFORE we let
     the user sign up via Google. The GIS button is ALWAYS visible,
     but the .gis-click-gate wrapper intercepts clicks in capture
     phase when consents aren't ticked, showing an error toast
     instead of opening the Google popup.
   - Defence-in-depth: _handleGoogleCredentialResponse also checks
     consents before calling signInWithIdToken — so even if the click
     gate is bypassed somehow, we never create an unauthorised user.
   - Optional consents (email-share, notif, marketing) are collected
     in the existing checkboxes. AFTER GIS sign-in succeeds, we read
     these and write them to the user's profile row directly via
     supabase, since signInWithIdToken doesn't accept arbitrary
     metadata at signup time the way signInWithOAuth did.
   - For RETURNING Google users (already registered before), we don't
     overwrite their existing consents on each sign-in — we only set
     them once at first signup. We detect first-signup using the
     `created_at === updated_at` heuristic on the user object.
*/

let _gisNonce = null;       /* raw nonce we send to supabase     */
let _gisHashedNonce = null; /* sha256 hash sent to Google        */
let _gisInitialised = false;

async function _generateNoncePair() {
  /* Generate a 32-byte random nonce, return raw (hex) and SHA-256 (hex) */
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  const raw = Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
  const buf = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const hashed = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

async function _writeConsentsForNewUser(user) {
  /* For Google sign-ups via register.html, write consent flags to
     the profiles table. The handle_new_user trigger creates the
     profile row when auth.users got the new entry — we just need
     to populate the consent columns now.

     v=20 logic: "fresh signup OR orphan row".
     ----------------------------------------------
     We read terms_consent FIRST to decide whether to write:
       - terms_consent = true   → genuine returning user, leave alone
       - terms_consent = false  → either a fresh signup OR an orphan
                                  row from a blocked login.html
                                  attempt. Either way, this is the
                                  user's first proper consent
                                  collection, so we write the values.
       - terms_consent = null   → same as false (treat as not-yet-
                                  consented). Defensive against
                                  schema variations.

     This replaces the old created_at/updated_at heuristic, which
     incorrectly classified orphan-row second attempts as "returning
     users" and skipped writing consents.
  */
  if (!user || !user.id) return;

  /* Step 1 — Read current consent state */
  const { data: existingProfile, error: fetchErr } = await sb
    .from("profiles")
    .select("terms_consent")
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchErr) {
    console.warn("[register.js] Could not read existing consents (proceeding to write):", fetchErr.message);
    /* If we can't read, fall through to write — the alternative
       is leaving the user stuck without consents, which is worse. */
  }

  /* Returning user with consents already valid — leave alone */
  if (existingProfile && existingProfile.terms_consent === true) {
    return;
  }

  /* Build the consent payload from what the user just ticked.
     v=21: removed `user_type` (column doesn't exist on profiles
     table — caused entire UPDATE to fail silently). Profile
     category is now stored in data.profile_category JSONB,
     populated when the user fills the profile_category page.

     We also stamp timestamps for ALL consents that are true, not
     just marketing — required for DPDP audit completeness. Each
     consent value should have a paired timestamp recording when
     it was granted. */
  const nowIso = new Date().toISOString();
  const consentPayload = {
    terms_consent       : !!consentTerms.checked,
    age_18_confirmed    : !!consentAge.checked,
    email_share_consent : !!consentEmailShare.checked,
    notif_consent       : !!consentNotif.checked,
    marketing_consent   : !!consentMarketing.checked
  };

  /* Pair every TRUE consent with its timestamp. False consents
     leave the *_at column NULL (which is correct — there's no
     consent grant moment to record). */
  if (consentPayload.terms_consent)       consentPayload.terms_consent_at        = nowIso;
  if (consentPayload.age_18_confirmed)    consentPayload.age_18_confirmed_at     = nowIso;
  if (consentPayload.email_share_consent) consentPayload.email_share_consent_at  = nowIso;
  if (consentPayload.notif_consent)       consentPayload.notif_consent_at        = nowIso;
  if (consentPayload.marketing_consent)   consentPayload.marketing_consent_at    = nowIso;

  try {
    /* v=23: include email in the upsert row.
       ROOT CAUSE (June 2026): the handle_new_user trigger stopped
       firing reliably after a Supabase internal change around
       May 30, 2026. When no profile row exists, the UPSERT tries
       to INSERT rather than UPDATE. Without email the INSERT fails
       immediately — profiles.email is NOT NULL.
       Adding user.email here makes the INSERT succeed. On an
       existing row it simply re-writes the same email value —
       completely harmless. This makes the consent write robust
       regardless of whether the trigger fires or not. */
    const upsertRow = {
      user_id : user.id,
      email   : user.email,
      ...consentPayload
    };
    const { error: upsertErr } = await sb
      .from("profiles")
      .upsert(upsertRow, { onConflict: "user_id" });
    if (upsertErr) {
      console.error("[register.js] CRITICAL: consent UPSERT failed:", upsertErr.message, upsertErr);
      throw new Error("Consent write failed: " + (upsertErr.message || "unknown"));
    }

    /* Verify the write actually persisted. Defence-in-depth — if
       a future schema change causes the UPDATE to "succeed" with
       0 rows affected (e.g. RLS quietly filters), we catch it
       here instead of letting the user reach a broken state. */
    const { data: verifyData, error: verifyErr } = await sb
      .from("profiles")
      .select("terms_consent")
      .eq("user_id", user.id)
      .maybeSingle();
    if (verifyErr) {
      console.error("[register.js] Consent verification read failed:", verifyErr);
      /* Verification failed but write may have succeeded. Don't
         throw — the next login will reveal the truth. Just log. */
    } else if (!verifyData || verifyData.terms_consent !== true) {
      console.error("[register.js] CRITICAL: consents not persisted after UPDATE. Row state:", verifyData);
      throw new Error("Consents did not persist. Please contact support.");
    }
  } catch (e) {
    /* v=21: re-throw so the caller (_handleGoogleCredentialResponse)
       can show the error to the user rather than silently sending
       them to a broken dashboard. */
    console.error("[register.js] Exception writing consents:", e);
    throw e;
  }
}

async function _handleGoogleCredentialResponse(response) {
  /* Called by GIS when Google returns the ID token after user picks account */
  hideError();
  if (isRateLimited()) {
    showError("Please wait a moment before trying again.");
    return;
  }

  if (!requiredConsentsTicked()) {
    /* Defence-in-depth: even though we hide the button when consents
       aren't ticked, double-check before completing the auth. */
    showError("Please tick the two required consents (Terms and Age 18+) before signing up with Google.");
    return;
  }

  const idToken = response && response.credential;
  if (!idToken) {
    showError("Google sign-up did not complete. Please try again.");
    return;
  }

  const { data, error } = await sb.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    nonce: _gisNonce
  });

  if (error) {
    showError("Could not sign up with Google: " + (error.message || "unknown error"));
    return;
  }

  if (!data || !data.session || !data.user) {
    showError("Google sign-up succeeded but no session was created. Please try again.");
    return;
  }

  /* Write consent flags to profile row.
     v=21: if the consent write fails, we surface the error and
     sign the user out instead of pushing them into a broken
     dashboard state. The next sign-in attempt will be blocked by
     login.js v=27 until the underlying issue is resolved. */
  try {
    await _writeConsentsForNewUser(data.user);
  } catch (consentErr) {
    /* Sign out (local-scope = fast, no server roundtrip) so the
       user isn't left holding a session with no valid consents. */
    try { await sb.auth.signOut({ scope: "local" }); } catch (_e) {}
    showError(
      "We couldn't save your consent preferences. " +
      "Please try again, or contact support if the problem persists. " +
      "(Error: " + (consentErr.message || "unknown") + ")"
    );
    return;
  }

  /* Success — redirect to dashboard */
  window.location.href = window.location.origin + "/dashboard.html";
}

async function _initialiseGoogleSignIn() {
  /* Wait for GIS script to load before initialising */
  if (typeof google === "undefined" || !google.accounts || !google.accounts.id) {
    setTimeout(_initialiseGoogleSignIn, 100);
    return;
  }
  if (typeof GOOGLE_CLIENT_ID === "undefined" || !GOOGLE_CLIENT_ID) {
    console.error("[register.js] GOOGLE_CLIENT_ID not defined in config.js");
    return;
  }

  const pair = await _generateNoncePair();
  _gisNonce = pair.raw;
  _gisHashedNonce = pair.hashed;

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: _handleGoogleCredentialResponse,
    nonce: _gisHashedNonce,
    auto_select: false,
    cancel_on_tap_outside: true,
    /* use_fedcm_for_button: false  forces the GENERIC "Sign up with
       Google" button (with the multi-color G logo) instead of the
       personalised "Sign in as <Name>" button. See login.js for the
       same explanation. */
    use_fedcm_for_button: false,
    use_fedcm_for_prompt: false
  });

  _gisInitialised = true;
  /* Render the GIS button immediately — it's always visible now. */
  _renderGoogleButton();
  /* Install click-gate: intercepts clicks if consents not ticked. */
  _installClickGate();
}

function _installClickGate() {
  const gate = document.getElementById("gisClickGate");
  if (!gate || gate._gateInstalled) return;
  gate._gateInstalled = true;
  /* Capture-phase listener — fires BEFORE the GIS button click. If
     required consents aren't ticked, stop the click and show toast.
     If ticked, do nothing (let GIS handle it normally). */
  gate.addEventListener("click", function (e) {
    if (!requiredConsentsTicked()) {
      e.stopPropagation();
      e.preventDefault();
      showError("Please tick the two required consents (Terms and Age 18+) to continue.");
    }
  }, true /* useCapture */);
}

function _renderGoogleButton() {
  if (!_gisInitialised) return;
  const container = document.getElementById("googleSignInBtnContainer");
  if (!container) return;
  /* Clear any previous render to avoid duplicate buttons */
  container.innerHTML = "";
  google.accounts.id.renderButton(container, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "signup_with",
    shape: "rectangular",
    logo_alignment: "left",
    width: container.offsetWidth || 320
  });
}

/* Kick off GIS setup once DOM is ready */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initialiseGoogleSignIn);
} else {
  _initialiseGoogleSignIn();
}

/* ── Email + Password Registration ── */
registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  if (isRateLimited()) {
    showError("Please wait a moment before trying again.");
    return;
  }

  const name     = regName.value.trim().replace(/\s+/g, " ");
  const email    = regEmail.value.trim().toLowerCase();
  const password = regPassword.value;

  if (!name) {
    showError("Please enter your full name.");
    regName.focus();
    return;
  }
  if (name.length < 2) {
    showError("Please enter a valid full name (at least 2 characters).");
    regName.focus();
    return;
  }
  if (!email || !isValidEmail(email)) {
    showError("Please enter a valid email address.");
    regEmail.focus();
    return;
  }

  if (!password || password.length < 8) {
    showError("Password must be at least 8 characters long.");
    regPassword.focus();
    return;
  }
  if (!/[A-Z]/.test(password)) {
    showError("Password must contain at least one capital letter (A-Z).");
    regPassword.focus();
    return;
  }
  if (!/[0-9]/.test(password)) {
    showError("Password must contain at least one number (0-9).");
    regPassword.focus();
    return;
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    showError("Password must contain at least one special character (e.g. !@#$%).");
    regPassword.focus();
    return;
  }

  if (!consentTerms.checked) {
    showError("Please accept the Terms of Use and Privacy Policy to continue.");
    consentTerms.focus();
    consentTerms.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!consentAge.checked) {
    showError("Please confirm you are 18 years or older to continue.");
    consentAge.focus();
    consentAge.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (!window.captchaToken) {
    if (captchaError) {
      captchaError.textContent = "Please complete the security check above.";
      captchaError.classList.remove("hidden");
    }
    showError("Please complete the security check.");
    return;
  }

  setLoading(registerBtn, true);

  const metadata = buildConsentMetadata(name);

  /* IMPORTANT: emailRedirectTo includes "?confirmed=1" flag so that
     login.js can detect a user arriving from email-confirmation link
     and route them through "please sign in" flow rather than letting
     Supabase's auto-session take them straight to dashboard. */
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
      captchaToken: window.captchaToken,
      emailRedirectTo: window.location.origin + "/login.html?confirmed=1"
    }
  });

  setLoading(registerBtn, false);
  resetCaptcha();

  if (error) {
    if (error.message.toLowerCase().includes("already")) {
      showError("An account with this email already exists. Please sign in instead.");
    } else if (error.message.toLowerCase().includes("captcha")) {
      showError("Security check failed. Please try again.");
    } else if (error.message.toLowerCase().includes("rate limit")) {
      showError("Too many attempts. Please wait a few minutes and try again.");
    } else {
      showError("Registration failed: " + error.message);
    }
    return;
  }

  /* DETECT DUPLICATE EMAIL */
  const userObj = data && data.user;
  const isExistingEmail =
    !userObj ||
    !userObj.identities ||
    userObj.identities.length === 0;

  if (isExistingEmail) {
    showError("An account with this email already exists. Please sign in instead.");
    return;
  }

  /* Sign out cleanly so the next page (login) shows the form */
  await sb.auth.signOut();

  showSuccess(
    `Account created! We've sent a confirmation email to ${email}. ` +
    `Please check your inbox and click the link to verify your account, then sign in.`
  );
});

/* ── Init ── */
document.addEventListener("DOMContentLoaded", () => {
  refreshSubmitState();
});
