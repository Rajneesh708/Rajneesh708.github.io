"use strict";

/* ============================================================
   MECULS — register.js (v=21)
   Date: 2026-05-07
   ============================================================
   Changes from v=20:
   - Switched from google.accounts.id.prompt() to renderButton()
     in popup mode. Google's button rendered into a hidden div
     overlaid on top of our custom MECULS button. Works for
     BOTH logged-in and logged-out users (popup with sign-in
     page if not logged in). No supabase.co text in either case.
   - Consent gating: when required consents not ticked, GIS
     overlay is hidden (display:none) — clicks fall through to
     visible button which shows error toast. When consents ticked,
     overlay catches clicks and opens Google's popup.
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
     Wire up consent change listeners — refresh submit button
     state and Google overlay visibility when any consent is toggled.
     ============================================================ */
  [consentTerms, consentAge, consentEmailShare, consentNotif, consentMarketing].forEach(cb => {
    if (cb) {
      cb.addEventListener("change", () => {
        refreshSubmitState();
        refreshGoogleOverlay();
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
  /* ============================================================
     Google Identity Services — invisible overlay button approach
     ============================================================
     We use google.accounts.id.renderButton() with ux_mode: 'popup'
     to render Google's official sign-up button. Works for BOTH
     logged-in users (one-tap) AND logged-out users (popup with
     Google sign-in page).

     The rendered button is placed in #gisHiddenBtn — invisible
     overlay over our custom MECULS button. User sees our pretty
     button; click hits Google's button.

     Consent gating: when required consents are NOT ticked, we
     hide the GIS overlay (display: none) so clicks fall through
     to the visible button which shows an error toast. When
     consents ARE ticked, overlay is active and clicks go to GIS.
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

      const hiddenContainer = document.getElementById("gisHiddenBtn");
      if (hiddenContainer) {
        try {
          window.google.accounts.id.renderButton(hiddenContainer, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "signup_with",
            shape: "rectangular",
            logo_alignment: "center",
            width: hiddenContainer.offsetWidth || 320
          });
        } catch (e) {
          console.warn("[register] renderButton failed:", e);
        }
      }

      _gisInitialized = true;
      /* Apply current consent state to overlay visibility */
      refreshGoogleOverlay();
    }).catch((err) => {
      console.warn("[register] GIS init failed:", err);
    });
  }

  /* Show/hide the GIS overlay based on required consent state.
     - Consents ticked → overlay visible (catches clicks for popup),
       visible button decorative (tabindex=-1, aria-hidden)
     - Consents not ticked → overlay hidden, visible button takes
       over keyboard/screen-reader focus and shows error on click */
  function refreshGoogleOverlay() {
    const overlay = document.getElementById("gisHiddenBtn");
    if (!overlay || !googleBtn) return;
    if (requiredConsentsTicked()) {
      overlay.style.display = "";
      googleBtn.setAttribute("tabindex", "-1");
      googleBtn.setAttribute("aria-hidden", "true");
    } else {
      overlay.style.display = "none";
      googleBtn.setAttribute("tabindex", "0");
      googleBtn.removeAttribute("aria-hidden");
    }
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

  /* ── Visible button click handler — only fires when overlay is
     hidden (consents not ticked). Shows error toast. ── */
  if (googleBtn) {
    googleBtn.addEventListener("click", () => {
      if (!requiredConsentsTicked()) {
        showError("Please tick the two required consents to continue.");
      }
      /* If consents ARE ticked, the GIS overlay handles the click.
         This handler still fires (event bubbles), but does nothing. */
    });
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
  refreshGoogleOverlay();
  updateGmailHint();

})();
