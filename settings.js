/* ════════════════════════════════════════════════════════════
   MECULS — settings.js (v=1)
   Date: 2026-05-09
   ════════════════════════════════════════════════════════════
   Drives the settings page. Reuses MC.* helpers for consistent
   auth + RLS + error handling with the rest of the portal.

   Sections:
     - Profile     (read-only display of name, email, slug, member-since)
     - Security    (password change, sign-out everywhere)
     - Consents    (toggle the 3 optional consents; required ones locked)
     - Visibility  (public/private toggle for is_public column)
     - Danger zone (delete-my-account flow with type-DELETE confirmation)

   Auth model: this page is for signed-in users only. If no session
   on load, redirect to login.html. If session expires mid-session,
   any save attempt will surface a clear error.
   ════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  // ── DOM refs ────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  // ── Small helpers ───────────────────────────────────────────
  function showMsg(id, text, kind /* 'ok' | 'err' | 'info' */) {
    const el = $(id);
    if (!el) return;
    el.className = "st-msg st-msg--" + (kind || "info");
    el.textContent = text;
  }
  function hideMsg(id) {
    const el = $(id);
    if (!el) return;
    el.className = "st-msg hidden";
    el.textContent = "";
  }

  function fmtDateLong(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric"
    });
  }
  function fmtDateShort(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric"
    });
  }

  function setBtnLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.dataset.originalText = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="st-spinner"></span>' +
        (btn.dataset.busyText || "Saving…");
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  }

  // ── Page load ───────────────────────────────────────────────
  let SB = null;
  let CURRENT_USER = null;
  let CURRENT_PROFILE = null;

  async function init() {
    if (typeof SUPABASE_URL === "undefined" ||
        typeof SUPABASE_ANON_KEY === "undefined") {
      console.error("[settings] config.js not loaded");
      window.location.href = "login.html";
      return;
    }

    SB = window.MC_SB && window.MC_SB.getClient
      ? window.MC_SB.getClient()
      : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Confirm session
    const { data: sessionData, error: sessionErr } = await SB.auth.getSession();
    if (sessionErr || !sessionData || !sessionData.session) {
      window.location.href = "login.html";
      return;
    }
    CURRENT_USER = sessionData.session.user;

    // Fetch the user's profile row
    const { data: prof, error: profErr } = await SB
      .from("profiles")
      .select("*")
      .eq("user_id", CURRENT_USER.id)
      .maybeSingle();

    if (profErr) {
      console.error("[settings] load profile error:", profErr);
      // Show page anyway with what we have from auth
    }
    CURRENT_PROFILE = prof || {};

    // Populate the page
    populateProfile();
    populateSecurity();
    populateConsents();
    populateVisibility();

    // Reveal page
    $("stLoading").hidden = true;
    $("stReady").hidden = false;

    // Wire up event handlers
    wireUpEvents();
    setupNavSpy();
  }

  // ── Populate sections ───────────────────────────────────────
  function populateProfile() {
    const p = CURRENT_PROFILE;
    $("stProfileName").textContent  = p.full_name || CURRENT_USER.user_metadata?.full_name || "—";
    $("stProfileEmail").textContent = p.email || CURRENT_USER.email || "—";

    const slug = p.slug || "";
    const linkEl = $("stPublicUrl");
    if (slug) {
      const url = "https://meculs.com/p/" + slug;
      linkEl.textContent = "meculs.com/p/" + slug;
      linkEl.href = url;
      linkEl.dataset.url = url;
    } else {
      linkEl.textContent = "Available once your profile is published";
      linkEl.removeAttribute("href");
      linkEl.style.color = "var(--text-muted)";
      linkEl.style.borderBottom = "none";
      $("stCopyUrlBtn").disabled = true;
    }

    const created = CURRENT_USER.created_at || p.created_at;
    $("stMemberSince").textContent = fmtDateLong(created);
  }

  function populateSecurity() {
    // Determine sign-in method from auth identities
    const identities = CURRENT_USER.identities || [];
    const hasGoogle = identities.some(i => i.provider === "google");
    const hasEmail  = identities.some(i => i.provider === "email");

    let methodText = "";
    if (hasGoogle && hasEmail)      methodText = "Google + email/password";
    else if (hasGoogle)             methodText = "Google";
    else if (hasEmail)              methodText = "Email and password";
    else                            methodText = "Email";  // fallback

    $("stSigninMethod").textContent = methodText;

    // Show password change row only if user has email/password identity
    if (hasEmail || !hasGoogle) {
      $("stPasswordRow").hidden = false;
    }
  }

  function populateConsents() {
    const p = CURRENT_PROFILE;

    // Required consents — display as locked-on
    $("stToggleTerms").checked = !!p.terms_consent;
    $("stToggleAge").checked   = !!p.age_18_confirmed;

    if (p.terms_consent_at) {
      $("stTermsAt").textContent = "Granted " + fmtDateShort(p.terms_consent_at);
    } else {
      $("stTermsAt").textContent = "Granted at sign-up";
    }
    if (p.age_18_confirmed_at) {
      $("stAgeAt").textContent = "Confirmed " + fmtDateShort(p.age_18_confirmed_at);
    } else {
      $("stAgeAt").textContent = "Confirmed at sign-up";
    }

    // Optional consents
    $("stToggleEmailShare").checked = !!p.email_share_consent;
    $("stToggleNotif").checked      = !!p.notif_consent;
    $("stToggleMarketing").checked  = !!p.marketing_consent;

    setConsentMeta("stEmailShareAt", p.email_share_consent, p.email_share_consent_at);
    setConsentMeta("stNotifAt",      p.notif_consent,       p.notif_consent_at);
    setConsentMeta("stMarketingAt",  p.marketing_consent,   p.marketing_consent_at);
  }

  function setConsentMeta(elId, isOn, at) {
    const el = $(elId);
    if (!el) return;
    if (isOn && at) {
      el.textContent = "Granted " + fmtDateShort(at);
    } else if (isOn) {
      el.textContent = "Granted";
    } else if (at) {
      el.textContent = "Last withdrawn " + fmtDateShort(at);
    } else {
      el.textContent = "Not granted";
    }
  }

  function populateVisibility() {
    const p = CURRENT_PROFILE;
    // is_public defaults to true if column exists; treat null/undefined as true
    const isPublic = p.is_public !== false;
    $("stToggleVisibility").checked = isPublic;
    $("stVisibilityState").textContent = isPublic
      ? "Currently public — anyone with your link can view it"
      : "Currently private — your link shows a private notice";
  }

  // ── Event wiring ────────────────────────────────────────────
  function wireUpEvents() {
    // Copy public profile link
    $("stCopyUrlBtn").addEventListener("click", onCopyUrl);

    // Smooth scroll for in-page nav
    document.querySelectorAll(".st-nav__link").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        const target = $(a.getAttribute("data-target"));
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    // Password change
    $("stChangePwBtn").addEventListener("click", onChangePassword);

    // Sign out everywhere
    $("stSignOutBtn").addEventListener("click", onSignOutEverywhere);

    // Consent toggles (only the 3 optional ones)
    ["stToggleEmailShare", "stToggleNotif", "stToggleMarketing"].forEach(id => {
      $(id).addEventListener("change", onConsentToggle);
    });

    // Visibility toggle
    $("stToggleVisibility").addEventListener("change", onVisibilityToggle);

    // Delete account flow
    $("stDeleteBtn").addEventListener("click", openDeleteModal);
    $("stDeleteCancel").addEventListener("click", closeDeleteModal);
    $("stDeleteConfirmInput").addEventListener("input", onDeleteInputChange);
    $("stDeleteConfirm").addEventListener("click", onDeleteConfirm);

    // Close modal on backdrop click
    $("stDeleteModal").addEventListener("click", e => {
      if (e.target === $("stDeleteModal")) closeDeleteModal();
    });
    // Esc to close modal
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && $("stDeleteModal").classList.contains("is-open")) {
        closeDeleteModal();
      }
    });
  }

  function setupNavSpy() {
    if (!("IntersectionObserver" in window)) return;
    const links = document.querySelectorAll(".st-nav__link");
    const linksByTarget = {};
    links.forEach(a => {
      linksByTarget[a.getAttribute("data-target")] = a;
    });

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          links.forEach(a => a.classList.remove("is-active"));
          const a = linksByTarget[entry.target.id];
          if (a) a.classList.add("is-active");
        }
      });
    }, { rootMargin: "-30% 0px -55% 0px", threshold: 0 });

    ["secProfile", "secSecurity", "secConsents", "secVisibility", "secDanger"].forEach(id => {
      const el = $(id);
      if (el) observer.observe(el);
    });
  }

  // ── Profile actions ─────────────────────────────────────────
  async function onCopyUrl(e) {
    const btn = e.currentTarget;
    const url = $("stPublicUrl").dataset.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch (err) {
      console.error("[settings] copy failed:", err);
      btn.textContent = "Copy failed";
    }
  }

  // ── Security actions ────────────────────────────────────────
  async function onChangePassword() {
    const btn = $("stChangePwBtn");
    const newPw  = $("stNewPassword").value;
    const confPw = $("stConfirmPassword").value;
    hideMsg("stPasswordMsg");

    if (!newPw || newPw.length < 8) {
      showMsg("stPasswordMsg", "Password must be at least 8 characters.", "err");
      return;
    }
    if (newPw !== confPw) {
      showMsg("stPasswordMsg", "The two passwords don't match.", "err");
      return;
    }
    if (!/[a-zA-Z]/.test(newPw) || !/[0-9]/.test(newPw)) {
      showMsg("stPasswordMsg", "Use a mix of letters and numbers for safety.", "err");
      return;
    }

    btn.dataset.busyText = "Updating…";
    setBtnLoading(btn, true);

    const { error } = await SB.auth.updateUser({ password: newPw });
    setBtnLoading(btn, false);

    if (error) {
      console.error("[settings] password update error:", error);
      showMsg("stPasswordMsg", error.message || "Could not update password.", "err");
      return;
    }
    $("stNewPassword").value = "";
    $("stConfirmPassword").value = "";
    showMsg("stPasswordMsg", "Password updated successfully.", "ok");
  }

  async function onSignOutEverywhere(e) {
    const btn = e.currentTarget;
    btn.dataset.busyText = "Signing out…";
    setBtnLoading(btn, true);

    // global scope = invalidate all refresh tokens for this user
    const { error } = await SB.auth.signOut({ scope: "global" });
    setBtnLoading(btn, false);

    if (error) {
      console.error("[settings] sign-out error:", error);
      // Even on error, try local cleanup + redirect
    }
    // Local storage cleanup (consistent with login.js behaviour)
    if (window.MC_STORAGE && typeof window.MC_STORAGE.wipeAll === "function") {
      window.MC_STORAGE.wipeAll();
    }
    window.location.href = "login.html";
  }

  // ── Consent toggle ──────────────────────────────────────────
  async function onConsentToggle(e) {
    const input = e.currentTarget;
    const column = input.getAttribute("data-consent");
    if (!column) return;

    const newValue = !!input.checked;
    const atColumn = column + "_at";

    // Optimistic UI: assume success, revert on error
    hideMsg("stConsentMsg");

    // Build payload — write timestamp on grant, leave existing _at on withdraw
    // (we want to know the LAST grant date even after withdrawal)
    const payload = {};
    payload[column] = newValue;
    if (newValue) {
      payload[atColumn] = new Date().toISOString();
    }
    // On withdraw, we DON'T null out the _at — that history is useful for audit

    const { error } = await SB
      .from("profiles")
      .update(payload)
      .eq("user_id", CURRENT_USER.id);

    if (error) {
      console.error("[settings] consent update error:", error);
      input.checked = !newValue;  // revert
      showMsg("stConsentMsg", "Could not save change. Please try again.", "err");
      return;
    }

    // Update local cached profile so meta lines re-render correctly
    CURRENT_PROFILE[column] = newValue;
    if (newValue) CURRENT_PROFILE[atColumn] = payload[atColumn];

    // Update meta line below the toggle
    const metaMap = {
      email_share_consent: "stEmailShareAt",
      notif_consent: "stNotifAt",
      marketing_consent: "stMarketingAt"
    };
    const metaId = metaMap[column];
    if (metaId) {
      setConsentMeta(metaId, newValue, CURRENT_PROFILE[atColumn]);
    }

    showMsg("stConsentMsg",
      newValue ? "Consent granted." : "Consent withdrawn.",
      "ok");

    // Auto-clear the success message after a moment
    setTimeout(() => hideMsg("stConsentMsg"), 2500);
  }

  // ── Visibility toggle ───────────────────────────────────────
  async function onVisibilityToggle(e) {
    const input = e.currentTarget;
    const newValue = !!input.checked;
    hideMsg("stVisibilityMsg");

    const { error } = await SB
      .from("profiles")
      .update({ is_public: newValue })
      .eq("user_id", CURRENT_USER.id);

    if (error) {
      console.error("[settings] visibility update error:", error);
      input.checked = !newValue;
      showMsg("stVisibilityMsg", "Could not save change. Please try again.", "err");
      return;
    }

    CURRENT_PROFILE.is_public = newValue;
    $("stVisibilityState").textContent = newValue
      ? "Currently public — anyone with your link can view it"
      : "Currently private — your link shows a private notice";

    showMsg("stVisibilityMsg",
      newValue ? "Profile is now public." : "Profile is now private.",
      "ok");
    setTimeout(() => hideMsg("stVisibilityMsg"), 2500);
  }

  // ── Account deletion flow ───────────────────────────────────
  function openDeleteModal() {
    hideMsg("stDeleteMsg");
    $("stDeleteConfirmInput").value = "";
    $("stDeleteConfirm").disabled = true;
    $("stDeleteModal").classList.add("is-open");
    setTimeout(() => $("stDeleteConfirmInput").focus(), 100);
  }

  function closeDeleteModal() {
    $("stDeleteModal").classList.remove("is-open");
  }

  function onDeleteInputChange(e) {
    const v = e.currentTarget.value.trim();
    $("stDeleteConfirm").disabled = v !== "DELETE";
  }

  async function onDeleteConfirm() {
    const btn = $("stDeleteConfirm");
    const cancelBtn = $("stDeleteCancel");

    if ($("stDeleteConfirmInput").value.trim() !== "DELETE") {
      showMsg("stDeleteMsg", "Type DELETE to confirm.", "err");
      return;
    }

    btn.dataset.busyText = "Deleting…";
    setBtnLoading(btn, true);
    cancelBtn.disabled = true;

    try {
      const { error } = await SB.rpc("delete_my_account");
      if (error) throw error;
    } catch (err) {
      console.error("[settings] delete error:", err);
      setBtnLoading(btn, false);
      cancelBtn.disabled = false;
      showMsg("stDeleteMsg",
        "Could not delete account. " + (err.message || "Please try again or contact support."),
        "err");
      return;
    }

    // Success — clean local state and redirect to goodbye page
    if (window.MC_STORAGE && typeof window.MC_STORAGE.wipeAll === "function") {
      window.MC_STORAGE.wipeAll();
    }
    try { await SB.auth.signOut({ scope: "local" }); } catch (e) {}

    window.location.href = "goodbye.html";
  }

  // ── Boot ────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
