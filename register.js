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
const googleRegBtn     = document.getElementById("googleRegisterBtn");
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
  const submitReady = window.captchaToken !== null && captchaReady;
  if (!registerBtn.classList.contains("btn--loading")) {
    registerBtn.disabled = !submitReady;
    registerBtn.classList.toggle("btn--disabled", !submitReady);
  }

  const googleReady = requiredConsentsTicked();
  if (!googleRegBtn.classList.contains("btn--loading")) {
    googleRegBtn.disabled = !googleReady;
    googleRegBtn.classList.toggle("btn--disabled", !googleReady);
    googleRegBtn.title = googleReady
      ? "Sign up with Google"
      : "Please tick the two required consents below first";
  }

  if (googleHint) {
    googleHint.classList.toggle("hidden", googleReady);
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
googleRegBtn.addEventListener("click", async () => {
  hideError();

  if (!requiredConsentsTicked()) {
    showError("Please tick the two required consents (Terms and Age 18+) before signing up with Google.");
    return;
  }

  if (isRateLimited()) {
    showError("Please wait a moment before trying again.");
    return;
  }

  setLoading(googleRegBtn, true);

  const consents = buildConsentMetadata("");
  delete consents.full_name;

  const queryParams = {
    access_type: "offline",
    prompt: "consent"
  };
  for (const [key, val] of Object.entries(consents)) {
    queryParams[key] = String(val);
  }

  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/dashboard.html",
      queryParams: queryParams
    }
  });

  if (error) {
    setLoading(googleRegBtn, false);
    showError("Could not connect to Google. Please try again.");
  }
});

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
