"use strict";

/* ============================================================
   MECULS — register.js (v=19)
   Date: 2026-05-07
   ============================================================
   Changes from v=18:
   - Replaced GIS rendered button with custom-styled button.
     Custom MECULS-styled button (in HTML) calls
     google.accounts.id.prompt() programmatically. User stays
     on meculs.com — no supabase.co text in OAuth flow.
   - Added gmail-typing hint: when user types a gmail.com
     email, a small note appears below the field gently
     suggesting they can use "Sign up with Google" above.
   - Custom button hidden until both required consents ticked.
     googleHint banner shown when button is hidden.
   ============================================================ */

(function () {

  /* ── Globals from config.js ── */
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* ── DOM refs ── */
  const registerForm     = document.getElementById("registerForm");
  const regName          = document.getElementById("regName");
  const regEmail         = document.getElementById("regEmail");
  const regPassword      = document.getElementById("regPassword");
  const registerBtn      = document.getElementById("registerBtn");
  const registerError    = document.getElementById("registerError");
  const togglePwd        = document.getElementById("toggleRegPassword");
  const captchaError     = document.getElementById("captchaError");
  const successState     = document.getElementById("regSuccessState");
  const successMsg       = document.getElementById("regSuccessMsg");
  const strengthBar      = document.getElementById("strengthBar");
  const strengthLabel    = document.getElementById("strengthLabel");
  const consentTerms     = document.getElementById("consentTerms");
  const consentAge       = document.getElementById("consentAge");
  const consentEmailShare= document.getElementById("consentEmailShare");
  const consentNotif     = document.getElementById("consentNotif");
  const consentMarketing = document.getElementById("consentMarketing");
  const googleBtn        = document.getElementById("googleCustomBtn");
  const googleHint       = document.getElementById("googleHint");
  const gmailHint        = document.getElementById("gmailHint");

  /* ── State ── */
  let captchaToken = null;
  let lastSubmitTime = 0;
  let _gisInitialized = false;
  let _currentNonce = null;

  /* ============================================================
     Captcha callbacks
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
     Consent state checks
     ============================================================ */
  function requiredConsentsTicked() {
    return !!(consentTerms && consentTerms.checked &&
              consentAge && consentAge.checked);
  }

  function getConsentState() {
    return {
      terms_consent: !!(consentTerms && consentTerms.checked),
      age_18_confirmed: !!(consentAge && consentAge.checked),
      email_share_consent: !!(consentEmailShare && consentEmailShare.checked),
      notif_consent: !!(consentNotif && consentNotif.checked),
      marketing_consent: !!(consentMarketing && consentMarketing.checked)
    };
  }

  /* ============================================================
     Submit-button enable/disable based on captcha + consents
     ============================================================ */
  function refreshSubmitState() {
    if (!registerBtn) return;
    const ready = captchaToken && requiredConsentsTicked();
    if (ready) {
      registerBtn.disabled = false;
      registerBtn.classList.remove("btn--disabled");
    } else {
      registerBtn.disabled = true;
      registerBtn.classList.add("btn--disabled");
    }
  }

  /* ============================================================
     Google button visibility — only shown when required consents
     are ticked. When hidden, googleHint banner appears.
     ============================================================ */
  function refreshGoogleVisibility() {
    if (!googleBtn) return;
    const ready = requiredConsentsTicked();
    if (ready) {
      googleBtn.style.display = "";
      if (googleHint) googleHint.classList.add("hidden");
    } else {
      googleBtn.style.display = "none";
      if (googleHint) googleHint.classList.remove("hidden");
    }
  }

  /* ── Wire up consent change listeners ── */
  [consentTerms, consentAge, consentEmailShare, consentNotif, consentMarketing].forEach(cb => {
    if (cb) {
      cb.addEventListener("change", () => {
        refreshSubmitState();
        refreshGoogleVisibility();
      });
    }
  });

  /* ============================================================
     Error/success display helpers
     ============================================================ */
  function showError(msg) {
    if (!registerError) return;
    registerError.textContent = msg;
    registerError.classList.remove("hidden");
    registerError.classList.add("toast--floating");
    setTimeout(() => {
      registerError.classList.add("hidden");
      registerError.classList.remove("toast--floating");
    }, 8000);
  }

  function showSuccess(msg) {
    if (registerForm) registerForm.classList.add("hidden");
    if (successState) successState.classList.remove("hidden");
    if (successMsg) successMsg.textContent = msg;
  }

  /* ============================================================
     Gmail hint — show when user types a gmail.com email
     ============================================================ */
  function updateGmailHint() {
    if (!gmailHint || !regEmail) return;
    const v = (regEmail.value || "").trim().toLowerCase();
    const isGmail = /@gmail\.com$/.test(v);
    if (isGmail) {
      gmailHint.classList.remove("hidden");
    } else {
      gmailHint.classList.add("hidden");
    }
  }

  if (regEmail) {
    regEmail.addEventListener("input", updateGmailHint);
    regEmail.addEventListener("blur", updateGmailHint);
  }

  /* ============================================================
     Password toggle (eye/eye-off)
     ============================================================ */
  if (togglePwd && regPassword) {
    togglePwd.addEventListener("click", () => {
      const isPwd = regPassword.type === "password";
      regPassword.type = isPwd ? "text" : "password";
      togglePwd.setAttribute("aria-pressed", isPwd ? "true" : "false");
      togglePwd.setAttribute("aria-label", isPwd ? "Hide password" : "Show password");
      togglePwd.classList.toggle("is-shown", isPwd);
    });
  }

  /* ============================================================
     Password strength meter
     ============================================================ */
  function rateStrength(pwd) {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;
    if (pwd.length >= 12) score++;
    return score;
  }

  function updateStrength() {
    if (!regPassword || !strengthBar || !strengthLabel) return;
    const pwd = regPassword.value;
    if (!pwd) {
      strengthBar.style.width = "0%";
      strengthBar.style.background = "#d1d5db";
      strengthLabel.textContent = "";
      return;
    }
    const s = rateStrength(pwd);
    const pct = Math.min(100, s * 20);
    strengthBar.style.width = pct + "%";
    if (s <= 1) {
      strengthBar.style.background = "#dc2626";
      strengthLabel.textContent = "Weak";
    } else if (s <= 3) {
      strengthBar.style.background = "#f59e0b";
      strengthLabel.textContent = "Fair";
    } else {
      strengthBar.style.background = "#10b981";
      strengthLabel.textContent = "Strong";
    }
  }

  if (regPassword) {
    regPassword.addEventListener("input", updateStrength);
    regPassword.addEventListener("change", updateStrength);
  }

  /* ============================================================
     Email/password registration submit
     ============================================================ */
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!registerBtn) return;

      const now = Date.now();
      if (now - lastSubmitTime < 3000) return;
      lastSubmitTime = now;

      if (!captchaToken) {
        if (captchaError) captchaError.classList.remove("hidden");
        return;
      }

      if (!requiredConsentsTicked()) {
        showError("Please tick the two required consents to continue.");
        return;
      }

      const name = (regName.value || "").trim().replace(/\s+/g, " ");
      const email = (regEmail.value || "").trim().toLowerCase();
      const password = regPassword.value || "";

      if (!name || !email || !password) {
        showError("Please fill in all fields.");
        return;
      }

      if (rateStrength(password) < 3) {
        showError("Password is too weak. Use 8+ characters with capital, number, and special character.");
        return;
      }

      registerBtn.disabled = true;
      registerBtn.classList.add("btn--loading");

      const consents = getConsentState();

      try {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            captchaToken,
            emailRedirectTo: window.location.origin + "/login.html?confirmed=1",
            data: {
              full_name: name,
              user_type: "candidate",
              terms_consent: consents.terms_consent,
              age_18_confirmed: consents.age_18_confirmed,
              email_share_consent: consents.email_share_consent,
              notif_consent: consents.notif_consent,
              marketing_consent: consents.marketing_consent
            }
          }
        });

        if (error) {
          registerBtn.disabled = false;
          registerBtn.classList.remove("btn--loading");
          captchaToken = null;
          if (window.turnstile && typeof window.turnstile.reset === "function") {
            try { window.turnstile.reset(); } catch (e) {}
          }
          refreshSubmitState();
          showError(error.message || "Registration failed. Please try again.");
          return;
        }

        showSuccess("Check your inbox at " + email + " for a confirmation link.");
      } catch (err) {
        registerBtn.disabled = false;
        registerBtn.classList.remove("btn--loading");
        showError("Network error. Please try again.");
      }
    });
  }

  /* ============================================================
     Google Identity Services — custom button approach
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
        use_fedcm_for_prompt: true
      });
      _gisInitialized = true;
    }).catch((err) => {
      console.warn("[register] GIS init failed:", err);
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

    /* Capture consents NOW (before signin), so we can write them
       to the profile row immediately after the new user is created. */
    const consents = getConsentState();

    if (!consents.terms_consent || !consents.age_18_confirmed) {
      showError("Please tick the two required consents to continue.");
      return;
    }

    try {
      const { data, error } = await sb.auth.signInWithIdToken({
        provider: "google",
        token: response.credential,
        nonce: _currentNonce
      });

      if (error) {
        showError("Google sign-up failed: " + (error.message || "unknown error"));
        return;
      }

      if (!data || !data.user) {
        showError("Google sign-up failed: no user returned.");
        return;
      }

      /* Detect new vs returning user — if created_at and updated_at
         are within 5 seconds, this is a fresh signup. */
      const createdAt = new Date(data.user.created_at).getTime();
      const updatedAt = new Date(data.user.updated_at).getTime();
      const isNewUser = Math.abs(updatedAt - createdAt) < 5000;

      if (isNewUser) {
        await _writeConsentsForNewUser(data.user.id, consents);
      }

      await handleAuthSuccess(data.session);
    } catch (err) {
      showError("Google sign-up error: " + (err.message || "network issue"));
    }
  }

  async function _writeConsentsForNewUser(userId, consents) {
    const now = new Date().toISOString();
    const updatePayload = {
      terms_consent: consents.terms_consent,
      terms_consent_at: consents.terms_consent ? now : null,
      age_18_confirmed: consents.age_18_confirmed,
      age_18_confirmed_at: consents.age_18_confirmed ? now : null,
      email_share_consent: consents.email_share_consent,
      email_share_consent_at: consents.email_share_consent ? now : null,
      notif_consent: consents.notif_consent,
      notif_consent_at: consents.notif_consent ? now : null,
      marketing_consent: consents.marketing_consent,
      marketing_consent_at: consents.marketing_consent ? now : null
    };

    try {
      const { error } = await sb.from("profiles")
        .update(updatePayload)
        .eq("user_id", userId);
      if (error) {
        console.warn("[register] Failed to write consents to profile:", error);
      }
    } catch (e) {
      console.warn("[register] Exception writing consents:", e);
    }
  }

  async function handleAuthSuccess(session) {
    if (window.MC_STORAGE && typeof MC_STORAGE.wipeMeculsAppDataOnly === "function") {
      try { MC_STORAGE.wipeMeculsAppDataOnly(); } catch (e) {}
    }
    localStorage.setItem("registration_complete", "yes");
    localStorage.setItem("user_type", "candidate");
    window.location.href = "dashboard.html";
  }

  /* ── Custom button click handler ── */
  if (googleBtn) {
    googleBtn.addEventListener("click", () => {
      if (!requiredConsentsTicked()) {
        showError("Please tick the two required consents to continue.");
        return;
      }
      if (!_gisInitialized) {
        initGoogleSignIn();
        setTimeout(triggerGooglePrompt, 200);
      } else {
        triggerGooglePrompt();
      }
    });
  }

  function triggerGooglePrompt() {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      showError("Google sign-in is not ready yet. Please try again in a moment.");
      return;
    }
    try {
      window.google.accounts.id.prompt();
    } catch (e) {
      showError("Could not open Google sign-in. Please try again.");
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
     Initial state
     ============================================================ */
  refreshSubmitState();
  refreshGoogleVisibility();
  updateGmailHint();

})();
