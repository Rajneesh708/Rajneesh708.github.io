/* ============================================================
   MECULS — login.js (v=23)
   Date: 2026-05-05 (cross-user data leak fix session)
   ============================================================
   Carried forward from v=22:
   - Email confirmation flow (?confirmed=1)
   - Password recovery flow (#type=recovery)
   - Floating error toast
   - Captcha integration, password show/hide, rate limiting
   - Hedged forgot-password message ("If an account exists...")

   New in v=23:
   - On successful sign-in, clears any stale MECULS data left
     in localStorage from a previous user on the same browser
     BEFORE redirecting to dashboard. This is the critical fix
     for the cross-user photo-leak bug:
       Without this, User A signs out → photo data still in
       localStorage → User B signs in → User B's dashboard
       loads User A's photo as a "fast cache" hit.
     With this, MC_STORAGE.wipeMeculsAppDataOnly() runs after
     authentication succeeds but before the dashboard loads.
     Auth tokens are deliberately preserved — wiping them would
     log the user out immediately.
   ============================================================ */

"use strict";

/* ── Supabase client ── */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── DOM refs ── */
const loginForm           = document.getElementById("loginForm");
const loginEmail          = document.getElementById("loginEmail");
const loginPassword       = document.getElementById("loginPassword");
const loginBtn            = document.getElementById("loginBtn");
const loginError          = document.getElementById("loginError");
const captchaError        = document.getElementById("captchaError");
const googleBtnContainer  = document.getElementById("googleSignInBtnContainer");
const forgotLink          = document.getElementById("forgotPasswordLink");
const forgotState         = document.getElementById("forgotState");
const resetEmail          = document.getElementById("resetEmail");
const sendResetBtn        = document.getElementById("sendResetBtn");
const backToLoginBtn      = document.getElementById("backToLoginBtn");
const successState        = document.getElementById("successState");
const successMsg          = document.getElementById("successMsg");
const togglePassword      = document.getElementById("togglePassword");

/* Password-recovery DOM refs */
const recoveryState       = document.getElementById("recoveryState");
const recoveryNewPassword = document.getElementById("recoveryNewPassword");
const recoveryConfirmPwd  = document.getElementById("recoveryConfirmPassword");
const recoverySubmitBtn   = document.getElementById("recoverySubmitBtn");
const recoveryToggle1     = document.getElementById("toggleRecoveryPassword");
const recoveryToggle2     = document.getElementById("toggleRecoveryConfirmPassword");

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

function refreshSubmitState() {
  const ready = window.captchaToken !== null && captchaReady;
  if (loginBtn && !loginBtn.classList.contains("btn--loading")) {
    loginBtn.disabled = !ready;
    loginBtn.classList.toggle("btn--disabled", !ready);
  }
}

/* ── Floating error toast ── */
let toastDismissTimer = null;

function showError(msg) {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }

  loginError.innerHTML = "";
  const text = document.createElement("span");
  text.textContent = msg;
  loginError.appendChild(text);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast__close";
  closeBtn.setAttribute("aria-label", "Dismiss error");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", hideError);
  loginError.appendChild(closeBtn);

  loginError.classList.remove("hidden");
  loginError.classList.add("toast--floating");
  loginError.style.display = "block";

  toastDismissTimer = setTimeout(hideError, 8000);
}

function hideError() {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  loginError.classList.add("hidden");
  loginError.classList.remove("toast--floating");
  loginError.style.display = "none";
  loginError.textContent = "";
}

/* ── Inline confirmation banner ── */
function showInlineBanner(msg) {
  if (document.getElementById("inlineBanner")) return;

  const banner = document.createElement("div");
  banner.id = "inlineBanner";
  banner.className = "toast toast--success";
  banner.style.cssText =
    "display:block; margin-bottom:16px; padding:12px 16px; " +
    "background:#d1fae5; color:#065f46; border:1px solid #6ee7b7; " +
    "border-radius:6px; font-size:0.875rem;";
  banner.textContent = msg;

  if (loginForm && loginForm.parentNode) {
    loginForm.parentNode.insertBefore(banner, loginForm);
  }
}

function setLoading(btn, loading, originalText) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.classList.add("btn--loading");
    btn._orig = btn.textContent;
    btn.textContent = "Please wait\u2026";
  } else {
    btn.disabled = false;
    btn.classList.remove("btn--loading");
    btn.textContent = originalText || btn._orig || btn.textContent;
  }
}

function showSuccess(msg) {
  if (loginForm) loginForm.classList.add("hidden");
  if (forgotState) forgotState.classList.add("hidden");
  if (recoveryState) recoveryState.classList.add("hidden");
  successMsg.textContent = msg;
  successState.classList.remove("hidden");
}

/* ── Sign-in success handler ──
   Critical fix in v=23: clears stale MECULS data from a previous
   user on the same browser BEFORE redirecting to dashboard.

   The wipe must happen AFTER Supabase auth sets up its tokens
   (otherwise we'd log the user out we just authenticated) but
   BEFORE dashboard.html loads (otherwise the dashboard's iframe
   pages would see stale photos / PII). */
async function handleLoginSuccess(/* session */) {
  /* 1. Wipe stale MECULS application data — keeps auth tokens.
     Without this, the next user on this browser sees photos,
     disability/defense status, etc. left over from a previous
     user. Auth tokens are deliberately preserved. */
  if (typeof MC_STORAGE !== "undefined" && MC_STORAGE.wipeMeculsAppDataOnly) {
    MC_STORAGE.wipeMeculsAppDataOnly();
  }

  /* 2. Set fresh app state for the now-authenticated user */
  localStorage.setItem("registration_complete", "yes");
  localStorage.setItem("user_type", "candidate");

  /* 3. Redirect to dashboard */
  window.location.replace("dashboard.html");
}

/* ── Detect password-recovery link arrival ── */
function detectRecoveryFromHash() {
  const hash = window.location.hash || "";
  if (!hash || hash.length < 2) return false;
  const params = new URLSearchParams(hash.substring(1));
  return params.get("type") === "recovery";
}

function showRecoveryUI() {
  if (loginForm)     loginForm.classList.add("hidden");
  if (forgotState)   forgotState.classList.add("hidden");
  if (successState)  successState.classList.add("hidden");
  if (googleBtnContainer) googleBtnContainer.style.display = "none";
  const dividers = document.querySelectorAll(".auth-divider");
  dividers.forEach(function (d) { d.style.display = "none"; });
  if (recoveryState) recoveryState.classList.remove("hidden");
}

/* ── Session check on page load ── */
async function initLoginPage() {
  /* Case (a) — Password recovery */
  if (detectRecoveryFromHash()) {
    showRecoveryUI();
    return;
  }

  /* Case (b) — Email confirmation flow */
  const url = new URL(window.location.href);
  const justConfirmed = url.searchParams.get("confirmed") === "1";

  if (justConfirmed) {
    /* Wipe any stale data AND sign out. Both are needed: signOut
       clears the auth token, wipe clears the rest. */
    if (typeof MC_STORAGE !== "undefined" && MC_STORAGE.wipeAll) {
      MC_STORAGE.wipeAll();
    }
    try { await sb.auth.signOut(); } catch (e) { /* proceed */ }
    window.history.replaceState({}, "", "/login.html");
    showInlineBanner("Email confirmed! Please sign in below.");
    return;
  }

  /* Case (c) — Returning visitor with active session.
     Validate against server (deleted-user safety). */
  const { data: sessData } = await sb.auth.getSession();
  if (sessData && sessData.session) {
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData || !userData.user) {
      /* Session token rejected by server — wipe and stay on login page */
      if (typeof MC_STORAGE !== "undefined" && MC_STORAGE.wipeAll) {
        MC_STORAGE.wipeAll();
      }
      try { await sb.auth.signOut(); } catch (e) { /* proceed */ }
      return;
    }
    await handleLoginSuccess(sessData.session);
    return;
  }

  /* Case (d) — No session, normal login form is already visible */
}

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

/* ── Google Sign In via Google Identity Services (GIS) ──
   Why: we previously used sb.auth.signInWithOAuth({provider:'google'})
   which redirects the user through Supabase's callback URL. That made
   Google's consent screen show "to continue to fjxc...supabase.co" —
   alarming for visitors. The GIS approach below keeps the entire flow
   on meculs.com so Google's consent screen shows "to continue to
   meculs.com" instead.

   Flow:
     1. Generate a fresh nonce (random hex, hashed with SHA-256)
     2. GIS shows account chooser inside meculs.com (no redirect)
     3. GIS returns an ID token signed by Google with our nonce
     4. We pass that token + the raw nonce to supabase.auth.signInWithIdToken
     5. Supabase verifies signature + nonce match, creates session
     6. We redirect to dashboard

   The visual button is rendered by GIS (google.accounts.id.renderButton)
   into the #googleSignInBtnContainer div in the HTML. The original
   custom <button> is removed. */

let _gisNonce = null;       /* raw nonce we'll send to supabase   */
let _gisHashedNonce = null; /* sha256 hash sent to Google         */

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

async function _handleGoogleCredentialResponse(response) {
  /* Called by GIS when Google returns the ID token after user picks account */
  hideError();
  if (isRateLimited()) {
    showError("Please wait a moment before trying again.");
    return;
  }

  const idToken = response && response.credential;
  if (!idToken) {
    showError("Google sign-in did not complete. Please try again.");
    return;
  }

  const { data, error } = await sb.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    nonce: _gisNonce
  });

  if (error) {
    showError("Could not sign in with Google: " + (error.message || "unknown error"));
    return;
  }

  if (!data || !data.session) {
    showError("Google sign-in succeeded but no session was created. Please try again.");
    return;
  }

  /* Successful sign-in — redirect to dashboard */
  window.location.href = window.location.origin + "/dashboard.html";
}

async function _initialiseGoogleSignIn() {
  /* Wait for GIS script to load before initialising */
  if (typeof google === "undefined" || !google.accounts || !google.accounts.id) {
    /* GIS not ready yet — retry shortly */
    setTimeout(_initialiseGoogleSignIn, 100);
    return;
  }
  if (typeof GOOGLE_CLIENT_ID === "undefined" || !GOOGLE_CLIENT_ID) {
    console.error("[login.js] GOOGLE_CLIENT_ID not defined in config.js");
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

  const container = document.getElementById("googleSignInBtnContainer");
  if (container) {
    google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: container.offsetWidth || 320
    });
  }
}

/* Kick off GIS setup once DOM is ready */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initialiseGoogleSignIn);
} else {
  _initialiseGoogleSignIn();
}

/* ── Email + Password Sign In ── */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  if (isRateLimited()) {
    showError("Please wait a moment before trying again.");
    return;
  }

  const email    = loginEmail.value.trim().toLowerCase();
  const password = loginPassword.value;

  if (!email) {
    showError("Please enter your email address.");
    loginEmail.focus();
    return;
  }
  if (!password) {
    showError("Please enter your password.");
    loginPassword.focus();
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

  setLoading(loginBtn, true, "Sign In");

  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: window.captchaToken }
  });

  resetCaptcha();

  if (error) {
    setLoading(loginBtn, false, "Sign In");
    if (error.message.toLowerCase().includes("invalid")) {
      showError("Incorrect email or password. Please try again.");
    } else if (error.message.toLowerCase().includes("confirm")) {
      showError("Please verify your email address first. Check your inbox.");
    } else if (error.message.toLowerCase().includes("captcha")) {
      showError("Security check failed. Please try again.");
    } else if (error.message.toLowerCase().includes("rate limit")) {
      showError("Too many attempts. Please wait a few minutes and try again.");
    } else {
      showError("Sign in failed. Please try again.");
    }
    return;
  }

  await handleLoginSuccess(data.session);
});

/* ── Password visibility toggle ── */
togglePassword.addEventListener("click", () => {
  const isPassword = loginPassword.type === "password";
  loginPassword.type = isPassword ? "text" : "password";
  togglePassword.setAttribute("aria-pressed", isPassword ? "true" : "false");
  togglePassword.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
});

/* ── Forgot password — request reset email ── */
forgotLink.addEventListener("click", (e) => {
  e.preventDefault();
  loginForm.classList.add("hidden");
  hideError();
  forgotState.classList.remove("hidden");
  resetEmail.value = loginEmail.value;
  resetEmail.focus();
});

backToLoginBtn.addEventListener("click", () => {
  forgotState.classList.add("hidden");
  loginForm.classList.remove("hidden");
});

sendResetBtn.addEventListener("click", async () => {
  const email = resetEmail.value.trim().toLowerCase();
  if (!email) {
    resetEmail.focus();
    return;
  }
  if (!window.captchaToken) {
    showError("Please complete the security check on the sign-in form before requesting a reset.");
    forgotState.classList.add("hidden");
    loginForm.classList.remove("hidden");
    return;
  }

  setLoading(sendResetBtn, true, "Send Reset Link");

  /* Note: Supabase does NOT return an error for non-existent emails —
     this is intentional, to prevent email-enumeration attacks. */
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/login.html",
    captchaToken: window.captchaToken
  });

  resetCaptcha();
  setLoading(sendResetBtn, false, "Send Reset Link");

  if (error) {
    showError("Could not send reset email. Please try again.");
    return;
  }

  /* Hedged success message — does not reveal whether email is registered */
  showSuccess(
    "If an account exists for " + email + ", we've sent a password reset link. " +
    "Please check your inbox (and spam folder). " +
    "If you don't receive an email within 5 minutes, the account may not exist — " +
    "you can register a new account instead."
  );
});

/* ============================================================
   PASSWORD RECOVERY FLOW (set new password)
   ============================================================ */

function validateNewPassword(pwd) {
  if (!pwd || pwd.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Z]/.test(pwd)) {
    return "Password must contain at least one capital letter (A-Z).";
  }
  if (!/[0-9]/.test(pwd)) {
    return "Password must contain at least one number (0-9).";
  }
  if (!/[^A-Za-z0-9]/.test(pwd)) {
    return "Password must contain at least one special character (e.g. !@#$%).";
  }
  return null;
}

if (recoverySubmitBtn) {
  recoverySubmitBtn.addEventListener("click", async function () {
    hideError();

    const newPwd     = recoveryNewPassword.value;
    const confirmPwd = recoveryConfirmPwd.value;

    const err = validateNewPassword(newPwd);
    if (err) {
      showError(err);
      recoveryNewPassword.focus();
      return;
    }

    if (newPwd !== confirmPwd) {
      showError("Passwords do not match. Please re-type.");
      recoveryConfirmPwd.focus();
      return;
    }

    setLoading(recoverySubmitBtn, true, "Update Password");

    const { error: updateError } = await sb.auth.updateUser({
      password: newPwd
    });

    if (updateError) {
      setLoading(recoverySubmitBtn, false, "Update Password");
      if (updateError.message.toLowerCase().includes("expired") ||
          updateError.message.toLowerCase().includes("invalid")) {
        showError("This password reset link has expired. Please request a new one.");
      } else {
        showError("Could not update password: " + updateError.message);
      }
      return;
    }

    /* Wipe everything — auth tokens AND application data — so the
       next sign-in starts clean. */
    if (typeof MC_STORAGE !== "undefined" && MC_STORAGE.wipeAll) {
      MC_STORAGE.wipeAll();
    }
    try { await sb.auth.signOut(); } catch (e) { /* ignore */ }

    window.history.replaceState({}, "", "/login.html");

    showSuccess("Password updated successfully! Please sign in with your new password.");

    setTimeout(function () {
      successState.classList.add("hidden");
      if (recoveryState) recoveryState.classList.add("hidden");
      loginForm.classList.remove("hidden");
      if (googleBtnContainer) googleBtnContainer.style.display = "";
      const dividers = document.querySelectorAll(".auth-divider");
      dividers.forEach(function (d) { d.style.display = ""; });
    }, 3000);
  });
}

/* Password show/hide for recovery fields */
if (recoveryToggle1) {
  recoveryToggle1.addEventListener("click", function () {
    const show = recoveryNewPassword.type === "password";
    recoveryNewPassword.type = show ? "text" : "password";
    recoveryToggle1.setAttribute("aria-pressed", show ? "true" : "false");
    recoveryToggle1.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
}
if (recoveryToggle2) {
  recoveryToggle2.addEventListener("click", function () {
    const show = recoveryConfirmPwd.type === "password";
    recoveryConfirmPwd.type = show ? "text" : "password";
    recoveryToggle2.setAttribute("aria-pressed", show ? "true" : "false");
    recoveryToggle2.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
}

/* ── Init ── */
document.addEventListener("DOMContentLoaded", function () {
  initLoginPage();
  refreshSubmitState();
});
