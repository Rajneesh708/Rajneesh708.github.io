/* ============================================================
   MECULS — mc_helpers.js
   Shared helpers used by every form page. Single source of truth.

   HOW TO USE:
   Add this line to every HTML page, AFTER config.js, BEFORE the
   page-specific JS file:
     <script src="config.js"></script>
     <script src="mc_helpers.js"></script>     ← here
     <script src="save_now.js"></script>
     <script src="<page>.js"></script>

   All helpers live under the MC.* namespace so they don't
   collide with anything a page might define. Each page can
   alias them at the top of its JS file if it prefers, e.g.:
     const $ = MC.$;
     const showPopup = MC.showPopup;
     const trim = MC.trim;

   This file deliberately has NO dependencies. It can be loaded
   on any page without breaking anything.
   ============================================================ */

"use strict";

/* Create the global namespace exactly once. */
window.MC = window.MC || {};

/* ── DOM lookup shortcut ─────────────────────────────────── */
MC.$ = function (id) {
  return document.getElementById(id);
};

/* ── Trim that survives null/undefined ────────────────────── */
MC.trim = function (val) {
  return (val == null ? "" : String(val)).trim();
};

/* ── candidateId — always reads from localStorage so it stays
   fresh across the registration flow (where a candidate_id may
   appear mid-session). Defined as a getter property. */
Object.defineProperty(MC, "candidateId", {
  get: function () {
    try {
      return localStorage.getItem("candidate_id");
    } catch (err) {
      return null;
    }
  },
  configurable: true
});

/* ── HTML escape ─────────────────────────────────────────────
   Use this whenever user-typed content goes into innerHTML.
   Without it, a candidate could type:
     <img src=x onerror=alert(1)>
   into a Title or Description field, and the browser would run
   the code instead of just showing it as text. Escaping converts
   the dangerous characters (< > & " ') into safe HTML entities so
   the browser only displays them.

   Use as:
     element.innerHTML = `<div>${MC.escape(userTitle)}</div>`;
   instead of:
     element.innerHTML = `<div>${userTitle}</div>`;

   The safer pattern is to build DOM with createElement + textContent,
   but when innerHTML is convenient (e.g. for nested templates),
   MC.escape on every interpolation is the next-best safety net.
*/
MC.escape = function (str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

/* ── Safe localStorage wrappers ──────────────────────────────
   localStorage CAN throw in:
     - Safari Private Browsing mode
     - When quota is exceeded
     - When site data is disabled by user/browser settings
   Without these wrappers, every save flow that calls localStorage
   directly will silently die mid-execution in those situations,
   leaving the user with a stuck "Saving…" button and no error.

   Use as:
     MC.safeSet("xxx_completed", "yes")     // returns true on success
     MC.safeGet("xxx_completed")            // returns null if unavailable
     MC.safeRemove("xxx_completed")         // returns true on success

   These wrappers fail silently (no exceptions thrown) and log to
   console for debugging. Save flows can check the boolean return
   if they need to react to storage failure (e.g. show a toast).
*/
MC.safeGet = function (key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn("[MC.safeGet] localStorage unavailable:", err);
    return null;
  }
};

MC.safeSet = function (key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn("[MC.safeSet] localStorage write failed:", err);
    return false;
  }
};

MC.safeRemove = function (key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (err) {
    console.warn("[MC.safeRemove] localStorage remove failed:", err);
    return false;
  }
};

/* ── Centred error popup (overlay + dialog) ────────────────
   Requires the standard popup HTML to exist on the page:
     <div class="error-popup-overlay" id="errorPopupOverlay">
       <div class="error-popup">
         <div class="error-popup__icon">&#9888;</div>
         <div class="error-popup__message" id="errorPopupMessage"></div>
         <button class="error-popup__close" id="errorPopupClose">OK</button>
       </div>
     </div>
   If the page doesn't have it, falls back to alert(). */
MC.showPopup = function (message) {
  const overlay  = MC.$("errorPopupOverlay");
  const msg      = MC.$("errorPopupMessage");
  const closeBtn = MC.$("errorPopupClose");
  const cancelBtn = MC.$("errorPopupCancel");
  if (!overlay || !msg) {
    /* Defensive fallback — page is missing the popup HTML. */
    alert(message);
    return;
  }
  msg.textContent = message;
  /* Hide the cancel button if it exists (showPopup is single-button) */
  if (cancelBtn) cancelBtn.classList.add("hidden");
  if (closeBtn) closeBtn.textContent = "OK";
  overlay.classList.add("active");
  if (closeBtn) {
    closeBtn.onclick = function () { overlay.classList.remove("active"); };
  }
  overlay.onclick = function (e) {
    if (e.target === overlay) overlay.classList.remove("active");
  };
};

/* ── Confirmation popup — Yes/Cancel variant of showPopup ──
   Same DOM as showPopup; just exposes a secondary "Cancel" button.
   Returns nothing — instead, calls onConfirm() if user proceeds.
   Pages must include both #errorPopupClose and #errorPopupCancel
   buttons in the popup HTML. */
MC.showConfirm = function (message, onConfirm, opts) {
  opts = opts || {};
  const overlay   = MC.$("errorPopupOverlay");
  const msg       = MC.$("errorPopupMessage");
  const okBtn     = MC.$("errorPopupClose");
  const cancelBtn = MC.$("errorPopupCancel");
  if (!overlay || !msg || !okBtn || !cancelBtn) {
    /* Fallback: native confirm */
    if (confirm(message) && typeof onConfirm === "function") onConfirm();
    return;
  }
  msg.textContent = message;
  okBtn.textContent     = opts.confirmLabel || "Yes, Continue";
  cancelBtn.textContent = opts.cancelLabel  || "Cancel";
  cancelBtn.classList.remove("hidden");
  overlay.classList.add("active");
  okBtn.onclick = function () {
    overlay.classList.remove("active");
    if (typeof onConfirm === "function") onConfirm();
  };
  cancelBtn.onclick = function () {
    overlay.classList.remove("active");
  };
  overlay.onclick = function (e) {
    if (e.target === overlay) overlay.classList.remove("active");
  };
};

/* ── Toast — small inline banner at top of form-container ──
   Auto-hides after 5s. Type can be "error" (default) | "success" | "info".
   Reuses an existing element if one already has id="globalToast",
   otherwise creates one. */
MC.showToast = function (message, type) {
  type = type || "error";
  let toast = MC.$("globalToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "globalToast";
    toast.className = "toast";
    const container = document.querySelector(".form-container");
    if (container) {
      container.prepend(toast);
    } else {
      document.body.prepend(toast);
    }
  }
  toast.className = "toast toast--" + type;
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(function () {
    toast.style.display = "none";
  }, 5000);
};

/* ── setLoading — toggles a button into a "Saving…" state ──
   Stores the original text so it can be restored. Idempotent —
   calling setLoading(btn, true) twice is safe. */
MC.setLoading = function (btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.classList.add("btn--loading");
    if (btn._originalText == null) btn._originalText = btn.textContent;
    btn.textContent = "Saving\u2026";
  } else {
    btn.disabled = false;
    btn.classList.remove("btn--loading");
    if (btn._originalText != null) {
      btn.textContent = btn._originalText;
      btn._originalText = null;
    }
  }
};

/* ── autoGrow — textarea expands to fit its content ────────
   Use either by attaching to a single textarea:
     myTextarea.addEventListener("input", () => MC.autoGrow(myTextarea));
   …or by enabling page-wide auto-grow once at page load:
     MC.enableGlobalAutoGrow();
   The global mode catches every <textarea> on the page. */
MC.autoGrow = function (el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
};

MC._autoGrowEnabled = false;
MC.enableGlobalAutoGrow = function () {
  if (MC._autoGrowEnabled) return;
  MC._autoGrowEnabled = true;
  document.addEventListener("input", function (e) {
    if (e.target && e.target.tagName === "TEXTAREA") {
      MC.autoGrow(e.target);
    }
  });
};

/* ── updateCounter — character counter helper ─────────────
   Use as: <textarea oninput="MC.updateCounter(this, 'counterId')">
   The counter element should be next to the textarea:
     <div class="char-counter-out" id="counterId">0 / 300</div>
   Reads the textarea's maxlength attribute for the cap. */
MC.updateCounter = function (el, counterId) {
  if (!el) return;
  const counter = MC.$(counterId);
  if (!counter) return;
  const max = el.getAttribute("maxlength");
  if (max) {
    counter.textContent = el.value.length.toLocaleString() +
                          " / " + Number(max).toLocaleString();
  } else {
    counter.textContent = el.value.length.toLocaleString();
  }
};

/* ── formatSavedAt — "✓ Saved at 3:42 PM" formatter ───────
   Used by the Save Now button after a successful backend save. */
MC.formatSavedAt = function () {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return "\u2713 Saved at " + h + ":" + (m < 10 ? "0" + m : m) + " " + ampm;
};

/* ── friendlyAge — "earlier today" / "yesterday" / "on 12 Mar" ──
   Used by the draft-restore banner to humanise the timestamp. */
MC.friendlyAge = function (isoTimestamp) {
  if (!isoTimestamp) return "earlier";
  let when;
  try {
    const draftDate = new Date(isoTimestamp);
    const today     = new Date();
    const sameDay   = draftDate.toDateString() === today.toDateString();
    const yest      = new Date(today.getTime() - 86400000);
    const isYest    = draftDate.toDateString() === yest.toDateString();
    if (sameDay)      when = "earlier today";
    else if (isYest)  when = "yesterday";
    else              when = "on " + draftDate.toLocaleDateString();
  } catch (err) {
    when = "earlier";
  }
  return when;
};

/* ── isValidEmail / isValidCountryCode / isValidMobile ─────
   Common validation patterns used by multiple pages. */
MC.isValidEmail = function (e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");
};
MC.isValidCountryCode = function (c) {
  return /^\+\d{1,4}$/.test(MC.trim(c));
};
MC.isValidMobile = function (n) {
  const d = (n || "").replace(/\D/g, "");
  return d.length >= 6 && d.length <= 15;
};

/* ── saveSection / loadSection ─────────────────────────────
   Phase 1 Step 3 — single-JSONB-profile save/load pattern.
   Replaces the previous 18-table per-section save logic.

   All form pages now use these to persist their section data:
       await MC.saveSection("experiences", buildPayload());
       const data = await MC.loadSection("experiences");

   - saveSection writes the payload under one top-level key in
     profiles.data, atomically merging via the save_profile_section
     RPC (server-side jsonb_set, no two-tab race condition).
   - loadSection reads the same key back from profiles.data.
     Returns null if the section was never saved, so pages can
     show a fresh form on first visit.

   These helpers depend on mc_supabase.js loading first
   (window.MC_SB.getClient must be available). The auto-protect
   in mc_supabase.js means by the time page code runs, there is
   always an authenticated session, so the RPC's auth.uid() check
   never fails for legitimate callers. */

MC.saveSection = async function (sectionKey, sectionData) {
  if (typeof window.MC_SB === "undefined" || !window.MC_SB.getClient) {
    throw new Error("MC.saveSection: mc_supabase.js not loaded");
  }
  if (sectionKey == null || typeof sectionKey !== "string" || !sectionKey.trim()) {
    throw new Error("MC.saveSection: sectionKey is required");
  }
  const sb = window.MC_SB.getClient();
  /* Pass an empty object instead of null/undefined so the SQL function
     always receives a valid JSONB. The function itself handles the
     "merge into profiles.data" atomically. */
  const { data, error } = await sb.rpc("save_profile_section", {
    p_section_key : sectionKey,
    p_section_data: (sectionData == null) ? {} : sectionData
  });
  if (error) {
    console.error("[MC.saveSection]", sectionKey, error);
    throw error;
  }
  return data;
};

MC.loadSection = async function (sectionKey) {
  if (typeof window.MC_SB === "undefined" || !window.MC_SB.getClient) {
    throw new Error("MC.loadSection: mc_supabase.js not loaded");
  }
  if (sectionKey == null || typeof sectionKey !== "string" || !sectionKey.trim()) {
    throw new Error("MC.loadSection: sectionKey is required");
  }
  const sb  = window.MC_SB.getClient();
  const uid = await window.MC_SB.getCandidateId();
  const { data, error } = await sb
    .from("profiles")
    .select("data")
    .eq("user_id", uid)
    .single();
  if (error) {
    console.error("[MC.loadSection]", sectionKey, error);
    throw error;
  }
  /* data.data is the JSONB column; data.data[sectionKey] is the
     section-specific payload. Either may be missing on a brand-new
     profile, in which case we return null. */
  if (!data || !data.data) return null;
  const section = data.data[sectionKey];
  return (section == null) ? null : section;
};

/* ── saveProfileFields / loadProfileFields ─────────────────
   Phase 1 Step 3 — for the upload_photo_cv page only.

   The Goals & Interests / Experience / etc. pages save into the
   profiles.data JSONB column via saveSection. But photo_path and
   cv_path are first-class columns on profiles (so the public profile
   page and the admin CV-download page can query them directly via
   SELECT), not buried inside JSONB. These helpers update those
   direct columns.

   USAGE:
       await MC.saveProfileFields({
         photo_path: "abc123/photo.webp",
         cv_path:    "abc123/resume.pdf",
         cv_uploaded_at: new Date().toISOString()
       });
       const row = await MC.loadProfileFields(["photo_path", "cv_path"]);

   RLS guards against cross-user writes via own_update policy.
   These helpers do NOT update profiles.data — use saveSection for
   anything that lives inside the JSONB. */

MC.saveProfileFields = async function (fields) {
  if (typeof window.MC_SB === "undefined" || !window.MC_SB.getClient) {
    throw new Error("MC.saveProfileFields: mc_supabase.js not loaded");
  }
  if (!fields || typeof fields !== "object") {
    throw new Error("MC.saveProfileFields: fields object required");
  }
  /* Filter out keys that should never be set from the client. The
     primary key, created_at and consent timestamps are server-managed.
     We let the caller pass anything they want for forward compatibility,
     but we strip these specifically. */
  const safe = {};
  const blocked = { user_id:1, created_at:1, marketing_consent_at:1 };
  Object.keys(fields).forEach(function (k) {
    if (!blocked[k]) safe[k] = fields[k];
  });
  if (Object.keys(safe).length === 0) {
    throw new Error("MC.saveProfileFields: no writable fields supplied");
  }
  const sb  = window.MC_SB.getClient();
  const uid = await window.MC_SB.getCandidateId();
  const { data, error } = await sb
    .from("profiles")
    .update(safe)
    .eq("user_id", uid)
    .select()
    .single();
  if (error) {
    console.error("[MC.saveProfileFields]", Object.keys(safe), error);
    throw error;
  }
  return data;
};

MC.loadProfileFields = async function (fieldNames) {
  if (typeof window.MC_SB === "undefined" || !window.MC_SB.getClient) {
    throw new Error("MC.loadProfileFields: mc_supabase.js not loaded");
  }
  if (!Array.isArray(fieldNames) || fieldNames.length === 0) {
    throw new Error("MC.loadProfileFields: fieldNames array required");
  }
  const sb  = window.MC_SB.getClient();
  const uid = await window.MC_SB.getCandidateId();
  const { data, error } = await sb
    .from("profiles")
    .select(fieldNames.join(","))
    .eq("user_id", uid)
    .single();
  if (error) {
    console.error("[MC.loadProfileFields]", fieldNames, error);
    throw error;
  }
  return data || {};
};
