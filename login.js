"use strict";

/* ============================================================
   MECULS — login.js (v=27)
   Date: 2026-05-07
   ============================================================
   Changes from v=26:
   - Replaced google.accounts.id.prompt() with renderButton()
     in popup mode. Google's button is rendered into a hidden
     div positioned over our custom MECULS-styled button.
     User sees our button; click handled by Google's button
     underneath. Works for BOTH logged-in and logged-out users
     (popup opens to Google sign-in page if not logged in).
     No supabase.co text in either case.
   ============================================================ */

(function () {

  /* ── Globals from config.js ── */
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* ── DOM refs ── */
  const loginForm     = document.getElementById("loginForm");
  const loginEmail    = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const loginBtn      = document.getElementById("loginBtn");
  const loginError    = document.getElementById("loginError");
  const togglePwd     = document.getElementById("togglePassword");
  const captchaError  = document.getElementById("captchaError");
  const successState  = document.getElementById("successState");
  const successMsg    = document.getElementById("successMsg");
  const forgotLink    = document.getElementById("forgotPasswordLink");
  const forgotState   = document.getElementById("forgotState");
  const resetEmail    = document.getElementById("resetEmail");
  const sendResetBtn  = document.getElementById("sendResetBtn");
  const backToLogin   = document.getElementById("backToLoginBtn");
  const recoveryState = document.getElementById("recoveryState");
  const recoveryNew   = document.getElementById("recoveryNewPassword");
  const recoveryConf  = document.getElementById("recoveryConfirmPassword");
  const recoverySubmit= document.getElementById("recoverySubmitBtn");
  const toggleRecPwd  = document.getElementById("toggleRecoveryPassword");
  const toggleRecConf = document.getElementById("toggleRecoveryConfirmPassword");
  const googleBtn     = document.getElementById("googleCustomBtn");
  const gmailHint     = document.getElementById("gmailHint");

  /* ── State ── */
  let captchaToken = null;
  let lastSubmitTime = 0;
  let _signingOut = false;
  let _gisInitialized = false;
  let _currentNonce = null;

  /* ============================================================
     Captcha callbacks (called by Cloudflare Turnstile)
     ============================================================ */
  window.onCaptchaSuccess = function (token) {
    captchaToken = token;
    if (captchaError) captchaError.classList.add("hidden");
    refreshSubmitState();
  };
  window.onCaptchaError = function () {
    captchaToken = null;
    refreshSubmitState();
  };
  window.onCaptchaExpired = function () {
    captchaToken = null;
    refreshSubmitState();
  };

  /* ============================================================
     Submit-button enable/disable based on captcha state
     ============================================================ */
  function refreshSubmitState() {
    if (!loginBtn) return;
    if (captchaToken) {
      loginBtn.disabled = false;
      loginBtn.classList.remove("btn--disabled");
    } else {
      loginBtn.disabled = true;
      loginBtn.classList.add("btn--disabled");
    }
  }

  /* ============================================================
     Error/success display helpers
     ============================================================ */
  function showError(msg) {
    if (!loginError) return;
    loginError.textContent = msg;
    loginError.classList.remove("hidden");
    loginError.classList.add("toast--floating");
    setTimeout(() => {
      loginError.classList.add("hidden");
      loginError.classList.remove("toast--floating");
    }, 8000);
  }

  function showSuccess(msg) {
    if (loginForm) loginForm.classList.add("hidden");
    if (forgotState) forgotState.classList.add("hidden");
    if (recoveryState) recoveryState.classList.add("hidden");
    if (successState) successState.classList.remove("hidden");
    if (successMsg) successMsg.textContent = msg;
  }

  /* ============================================================
     Gmail hint — show when user types a gmail.com email
     Gentle suggestion, not pushy. Disappears for non-gmail.
     ============================================================ */
  function updateGmailHint() {
    if (!gmailHint || !loginEmail) return;
    const v = (loginEmail.value || "").trim().toLowerCase();
    const isGmail = /@gmail\.com$/.test(v);
    if (isGmail) {
      gmailHint.classList.remove("hidden");
    } else {
      gmailHint.classList.add("hidden");
    }
  }

  if (loginEmail) {
    loginEmail.addEventListener("input", updateGmailHint);
    loginEmail.addEventListener("blur", updateGmailHint);
  }

  /* ============================================================
     Password toggle (eye/eye-off SVG icons)
     ============================================================ */
  function setupPasswordToggle(toggleBtn, inputEl) {
    if (!toggleBtn || !inputEl) return;
    toggleBtn.addEventListener("click", () => {
      const isPwd = inputEl.type === "password";
      inputEl.type = isPwd ? "text" : "password";
      toggleBtn.setAttribute("aria-pressed", isPwd ? "true" : "false");
      toggleBtn.setAttribute("aria-label", isPwd ? "Hide password" : "Show password");
      toggleBtn.classList.toggle("is-shown", isPwd);
    });
  }
  setupPasswordToggle(togglePwd, loginPassword);
  setupPasswordToggle(toggleRecPwd, recoveryNew);
  setupPasswordToggle(toggleRecConf, recoveryConf);

  /* ============================================================
     Hard sign-out — wipes ALL MECULS data + Supabase tokens
     Used when redirecting away from a session that should end.
     ============================================================ */
  async function hardSignOutAndRedirect(targetUrl) {
    if (_signingOut) return;
    _signingOut = true;
    try {
      await sb.auth.signOut();
    } catch (e) { /* ignore */ }
    try {
      if (window.MC_STORAGE && typeof MC_STORAGE.wipeAll === "function") {
        MC_STORAGE.wipeAll();
      }
    } catch (e) { /* ignore */ }
    if (targetUrl) window.location.href = targetUrl;
  }

  /* ============================================================
     Email/password login submit
     ============================================================ */
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!loginBtn) return;

      const now = Date.now();
      if (now - lastSubmitTime < 3000) return;
      lastSubmitTime = now;

      if (!captchaToken) {
        if (captchaError) captchaError.classList.remove("hidden");
        return;
      }

      const email = (loginEmail.value || "").trim().toLowerCase();
      const password = loginPassword.value || "";

      if (!email || !password) {
        showError("Please enter your email and password.");
        return;
      }

      loginBtn.disabled = true;
      loginBtn.classList.add("btn--loading");

      try {
        const { data, error } = await sb.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken }
        });

        if (error) {
          loginBtn.disabled = false;
          loginBtn.classList.remove("btn--loading");
          captchaToken = null;
          if (window.turnstile && typeof window.turnstile.reset === "function") {
            try { window.turnstile.reset(); } catch (e) {}
          }
          refreshSubmitState();
          showError(error.message || "Sign-in failed. Please try again.");
          return;
        }

        await handleLoginSuccess(data.session);
      } catch (err) {
        loginBtn.disabled = false;
        loginBtn.classList.remove("btn--loading");
        showError("Network error. Please try again.");
      }
    });
  }

  /* ============================================================
     Successful login → wipe stale data, redirect to dashboard
     ============================================================ */
  async function handleLoginSuccess(session) {
    if (window.MC_STORAGE && typeof MC_STORAGE.wipeMeculsAppDataOnly === "function") {
      try { MC_STORAGE.wipeMeculsAppDataOnly(); } catch (e) {}
    }
    localStorage.setItem("registration_complete", "yes");
    localStorage.setItem("user_type", "candidate");
    window.location.href = "dashboard.html";
  }

  /* ============================================================
     Forgot password flow (hedged message — doesn't reveal whether
     account exists)
     ============================================================ */
  if (forgotLink) {
    forgotLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (loginForm) loginForm.classList.add("hidden");
      if (forgotState) forgotState.classList.remove("hidden");
    });
  }

  if (backToLogin) {
    backToLogin.addEventListener("click", () => {
      if (forgotState) forgotState.classList.add("hidden");
      if (loginForm) loginForm.classList.remove("hidden");
    });
  }

  if (sendResetBtn) {
    sendResetBtn.addEventListener("click", async () => {
      const email = (resetEmail.value || "").trim().toLowerCase();
      if (!email) {
        showError("Please enter your email address.");
        return;
      }
      sendResetBtn.disabled = true;
      sendResetBtn.classList.add("btn--loading");

      try {
        await sb.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/login.html"
        });
      } catch (e) { /* hedged: same message regardless */ }

      showSuccess(
        "If an account exists for " + email + ", we've sent a password reset link. " +
        "Please check your inbox (and spam folder). " +
        "If you don't receive an email within 5 minutes, the account may not exist — " +
        "you can register a new account instead."
      );
    });
  }

  /* ============================================================
     Recovery flow — when user lands here via reset-password link
     ============================================================ */
  function detectRecoveryFromHash() {
    const hash = window.location.hash || "";
    if (!hash) return false;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    return params.get("type") === "recovery";
  }

  if (detectRecoveryFromHash()) {
    if (loginForm) loginForm.classList.add("hidden");
    if (recoveryState) recoveryState.classList.remove("hidden");
  }

  if (recoverySubmit) {
    recoverySubmit.addEventListener("click", async () => {
      const newPwd = recoveryNew.value || "";
      const confPwd = recoveryConf.value || "";

      if (newPwd.length < 8) {
        showError("Password must be at least 8 characters.");
        return;
      }
      if (newPwd !== confPwd) {
        showError("Passwords do not match.");
        return;
      }

      recoverySubmit.disabled = true;
      recoverySubmit.classList.add("btn--loading");

      try {
        const { error } = await sb.auth.updateUser({ password: newPwd });
        if (error) {
          recoverySubmit.disabled = false;
          recoverySubmit.classList.remove("btn--loading");
          showError(error.message || "Password update failed.");
          return;
        }
        await sb.auth.signOut();
        showSuccess("Password updated successfully! Please sign in with your new password.");
        setTimeout(() => {
          window.history.replaceState({}, "", "/login.html");
          window.location.reload();
        }, 3000);
      } catch (err) {
        recoverySubmit.disabled = false;
        recoverySubmit.classList.remove("btn--loading");
        showError("Network error. Please try again.");
      }
    });
  }

  /* ============================================================
     Email-confirmed flow — when user lands here from confirm link
     ============================================================ */
  async function checkEmailConfirmedFlow() {
    const url = new URL(window.location.href);
    const justConfirmed = url.searchParams.get("confirmed") === "1";

    if (justConfirmed) {
      await sb.auth.signOut();
      if (window.MC_STORAGE && typeof MC_STORAGE.wipeAll === "function") {
        try { MC_STORAGE.wipeAll(); } catch (e) {}
      }
      const banner = document.createElement("div");
      banner.className = "toast toast--success";
      banner.textContent = "Email confirmed! Please sign in below.";
      banner.style.position = "fixed";
      banner.style.top = "20px";
      banner.style.left = "50%";
      banner.style.transform = "translateX(-50%)";
      banner.style.zIndex = "9999";
      document.body.appendChild(banner);
      window.history.replaceState({}, "", "/login.html");
      return true;
    }
    return false;
  }

  /* ============================================================
     Existing-session check — if already logged in, redirect
     ============================================================ */
  async function checkExistingSession() {
    const justConfirmed = await checkEmailConfirmedFlow();
    if (justConfirmed) return;

    if (detectRecoveryFromHash()) return;

    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) {
        const { data: userData, error } = await sb.auth.getUser();
        if (!error && userData && userData.user) {
          window.location.href = "dashboard.html";
        }
      }
    } catch (e) { /* not logged in — stay on page */ }
  }

  /* ============================================================
     Google Identity Services — invisible overlay button approach
     ============================================================
     We use google.accounts.id.renderButton() with ux_mode: 'popup'
     to render Google's official sign-in button. This button works
     for BOTH logged-in users (one-tap account chooser) AND
     logged-out users (popup with Google sign-in page).

     The rendered button is placed inside #gisHiddenBtn, which is
     positioned absolutely OVER our custom MECULS-styled button
     (#googleCustomBtn) with opacity: 0. The user sees our pretty
     button but actually clicks Google's button underneath.

     Result:
       - User sees branded MECULS button
       - Click is handled by GIS (works for logged-in AND logged-out)
       - Popup hosted by Google at accounts.google.com (no supabase.co)
       - signInWithIdToken exchanges the credential for Supabase session
     ============================================================ */
  function initGoogleSignIn() {
    if (_gisInitialized) return;
    if (!window.google || !window.google.accounts || !window.google.accounts.id) return;
    if (typeof GOOGLE_CLIENT_ID === "undefined" || !GOOGLE_CLIENT_ID) return;

    const nonce = generateNonce();
    _currentNonce = nonce;

    hashNonce(nonce).then((hashedNonce) => {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        nonce: hashedNonce,
        auto_select: false,
        cancel_on_tap_outside: true,
        ux_mode: "popup",
        use_fedcm_for_prompt: false
      });

      /* Render Google's actual button into the hidden container.
         This button handles its own clicks — it knows how to open
         the popup whether user is signed in to Google or not. */
      const hiddenContainer = document.getElementById("gisHiddenBtn");
      if (hiddenContainer) {
        try {
          window.google.accounts.id.renderButton(hiddenContainer, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "signin_with",
            shape: "rectangular",
            logo_alignment: "center",
            width: hiddenContainer.offsetWidth || 320
          });
        } catch (e) {
          console.warn("[login] renderButton failed:", e);
        }
      }

      _gisInitialized = true;
    }).catch((err) => {
      console.warn("[login] GIS init failed:", err);
    });
  }

  function generateNonce() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashNonce(nonce) {
    const enc = new TextEncoder();
    const data = enc.encode(nonce);
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function handleGoogleCredential(response) {
    if (!response || !response.credential) return;

    try {
      const { data, error } = await sb.auth.signInWithIdToken({
        provider: "google",
        token: response.credential,
        nonce: _currentNonce
      });

      if (error) {
        showError("Google sign-in failed: " + (error.message || "unknown error"));
        return;
      }

      await handleLoginSuccess(data.session);
    } catch (err) {
      showError("Google sign-in error: " + (err.message || "network issue"));
    }
  }

  /* ── Wait for GIS library to load, then init ── */
  function waitForGIS() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      initGoogleSignIn();
    } else {
      setTimeout(waitForGIS, 200);
    }
  }
  waitForGIS();

  /* ============================================================
     Run session checks on page load
     ============================================================ */
  checkExistingSession();
  updateGmailHint();

  /* ============================================================
     Expose hardSignOut for cross-tab signout listener
     ============================================================ */
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && !_signingOut) {
      // Another tab signed out — but on login page, we just stay here
    }
  });

})();
