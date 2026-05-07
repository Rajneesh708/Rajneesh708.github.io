/* ============================================================
   MECULS — register.js (v=16)
   Date: 2026-05-05 (final rev)
   ============================================================
   Changes vs v=15:
   - Removed the soft Gmail hint feature. The Google sign-up
     button is already prominent at the top of the page; users
     who want it will use it. A nudge that says "no password
     needed" is misleading for users who aren't already signed
     into Gmail (they DO need their Google password in that
     case). Cleaner to omit.

   Carried forward from v=15:
   - emailRedirectTo appends "?confirmed=1" so login.js can
     detect a user arriving from the email-confirmation link
     and route them through proper "please sign in" flow
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
const googleHint       = document.getElementById("googleHint");
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

  /* Google button visibility — gated by required-consents state.
     Delegated to refreshGoogleVisibility() defined below in the
     GIS section so consent-change listeners can call either path. */
  if (typeof refreshGoogleVisibility === "function") {
    refreshGoogleVisibility();
  }
}

consentTerms.addEventListener("change", refreshSubmitState);
consentAge.addEventListener("change", refreshSubmitState);

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
     the user sign up via Google. We hide the GIS button when consents
     aren't ticked (instead of disabling — GIS controls its own enabled
     state). The googleHint banner explains why.
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
  /* For first-time Google sign-ups, write consent flags to the
     profiles table. The handle_new_user trigger will have already
     created the profile row when auth.users got the new entry —
     we just need to populate the consent columns now. We DON'T
     overwrite existing rows for returning users. */
  if (!user || !user.id) return;

  /* Heuristic: if created_at and updated_at are within 5 seconds of
     each other, this is a fresh signup. Otherwise it's a returning
     user we shouldn't overwrite consents for. */
  const created = new Date(user.created_at).getTime();
  const updated = new Date(user.updated_at || user.created_at).getTime();
  const isFreshSignup = Math.abs(updated - created) < 5000;

  if (!isFreshSignup) {
    /* Returning user — leave their existing consents alone */
    return;
  }

  /* Build the consent payload — same shape as buildConsentMetadata
     but with the values direct (no full_name, no user_type — those
     are set elsewhere, full_name comes from Google's id_token). */
  const consentPayload = {
    terms_consent       : !!consentTerms.checked,
    age_18_confirmed    : !!consentAge.checked,
    email_share_consent : !!consentEmailShare.checked,
    notif_consent       : !!consentNotif.checked,
    marketing_consent   : !!consentMarketing.checked,
    user_type           : "candidate"
  };

  /* If marketing consent ticked, also stamp marketing_consent_at */
  if (consentPayload.marketing_consent) {
    consentPayload.marketing_consent_at = new Date().toISOString();
  }

  try {
    const { error } = await sb
      .from("profiles")
      .update(consentPayload)
      .eq("user_id", user.id);
    if (error) {
      console.warn("[register.js] Could not write consents to profile:", error.message);
      /* Not catastrophic — user is signed in, can update consents
         later via Settings page. */
    }
  } catch (e) {
    console.warn("[register.js] Exception writing consents:", e.message);
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

  /* Write consent flags to profile row (only for first-time signups) */
  await _writeConsentsForNewUser(data.user);

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
    use_fedcm_for_prompt: true
  });

  _gisInitialised = true;
  /* Render the button if consents already ticked (e.g. on form re-show);
     otherwise refreshGoogleVisibility() will render later. */
  refreshGoogleVisibility();
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

function refreshGoogleVisibility() {
  /* Show or hide the GIS button container based on required-consents
     state. When hidden, the googleHint banner explains why. */
  const ready = requiredConsentsTicked();
  const container = document.getElementById("googleSignInBtnContainer");
  if (container) {
    if (ready) {
      container.style.display = "";
      _renderGoogleButton();
    } else {
      container.style.display = "none";
    }
  }
  if (googleHint) {
    googleHint.classList.toggle("hidden", ready);
  }
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
