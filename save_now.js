/* ============================================================
   MECULS — save_now.js
   The canonical Save Now / draft-restore engine.
   ONE file used by every long-form page.

   ARCHITECTURE (v1):
   ──────────────────────────────────────────────────────────
   Storage key format:
     meculs_draft_v1_<candidateId>_<pageName>
     meculs_draft_v1_<candidateId>_<pageName>_<n>      (repeatable)

   Why this format:
   - "meculs_draft_" prefix → clearly owned by this app
   - "v1_" → schema version; future migrations bump to v2_
   - <candidateId> → drafts scoped per user (handles family
     computers; falls back to "anon" if not logged in)
   - <pageName> → each page has its own draft
   - <n> for repeatable pages (Experience-1, Experience-2…)

   Behaviour:
   - Silent backup writes 8 seconds after last keystroke.
   - Manual Save Now click → tries backend first, falls back to
     localStorage cleanly.
   - On page load, if a draft exists, a banner asks the user to
     Restore or Start Fresh — never silent restore.
   - On successful Save & Continue, the draft is cleared.

   USAGE:
   At the bottom of each page's JS file's DOMContentLoaded:

     SaveNow.init({
       pageName       : "experience",
       formIds        : ["experienceForm"],
       capturePayload : () => buildPayload(),
       restorePayload : (draft) => { …assign fields from draft… },
       apiSave        : (payload) => apiSaveExperience(payload),
       entryNumber    : () => experienceNumber,    // optional
       restoreLabel   : (draft) => `Experience-${draft._meta.entry}`
     });

   Then call SaveNow.clearDraft() after a successful Save & Continue.

   DEPENDENCIES:
   - mc_helpers.js (MC.$ MC.candidateId MC.formatSavedAt MC.friendlyAge)
   - The page must contain the standard sticky-header HTML with
     #saveNowBtn, #draftStatus, #draftRestorePrompt etc. (See
     styles.css comment block "Sticky page header" for spec.)
   ============================================================ */

"use strict";

window.SaveNow = window.SaveNow || {};

(function () {

  /* ── Constants ───────────────────────────────────────────── */
  const SCHEMA_VERSION    = 1;
  const KEY_PREFIX        = "meculs_draft_v" + SCHEMA_VERSION + "_";
  const SILENT_BACKUP_MS  = 8000;
  const STATE_RESET_MS    = 4000;
  const FLASH_HINT_MS     = 2200;

  /* ── Module-private state (set per page by init) ────────── */
  let _config              = null;
  let _silentBackupTimer   = null;
  let _saveNowResetTimer   = null;
  let _resolveActivePhase  = null;  /* optional, for dual-form pages */

  /* ── Build the storage key for the active draft ────────── */
  function makeKey(suffix) {
    const cid = MC.candidateId || "anon";
    let key = KEY_PREFIX + cid + "_" + _config.pageName;
    if (suffix != null && suffix !== "") key += "_" + suffix;
    return key;
  }

  /* ── Active "scope" — for repeatable pages, this is the entry
     number; for dual-form pages, this is the phase string ── */
  function activeScope() {
    if (typeof _config.entryNumber === "function") {
      const n = _config.entryNumber();
      return (typeof n === "number" && n > 0) ? String(n) : "1";
    }
    if (typeof _config.activePhase === "function") {
      return _config.activePhase();
    }
    return "";  /* single-form page, no scope suffix */
  }

  function currentDraftKey()  { return makeKey(activeScope()); }
  function currentTsKey()     { return currentDraftKey() + "__ts"; }

  /* ── Build the localStorage envelope (payload + meta) ───── */
  function captureEnvelope() {
    let payload;
    try {
      payload = _config.capturePayload();
    } catch (err) {
      console.warn("[SaveNow] capturePayload threw:", err);
      payload = {};
    }
    return {
      _meta: {
        schemaVersion : SCHEMA_VERSION,
        savedAt       : new Date().toISOString(),
        pageName      : _config.pageName,
        scope         : activeScope() || null,
        candidateId   : MC.candidateId || null
      },
      payload: payload
    };
  }

  /* ── Silent localStorage write (no UI flash) ─────────────── */
  function silentSaveDraft() {
    if (typeof _config.isEmpty === "function" && _config.isEmpty()) {
      /* Form is essentially empty — don't pollute localStorage */
      return;
    }
    let envelope;
    try {
      envelope = captureEnvelope();
      localStorage.setItem(currentDraftKey(), JSON.stringify(envelope));
      localStorage.setItem(currentTsKey(),    envelope._meta.savedAt);
    } catch (err) {
      console.warn("[SaveNow] silent save failed:", err);
    }
  }

  /* ── Show "✓ Draft saved" hint briefly under sticky header ── */
  function flashDraftStatus(message) {
    const el = MC.$("draftStatus");
    if (!el) return;
    el.textContent = message || "\u2713 Draft saved";
    el.classList.remove("hidden");
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () {
      el.classList.add("hidden");
    }, FLASH_HINT_MS);
  }

  /* ── Set Save Now button visual state ─────────────────────
     state: "default" | "saving" | "saved" | "offline" | "local"
     "saved"   = green, backend confirmed
     "offline" = amber, kept on this device only (fallback)
     "local"   = green-on-purpose, page has no backend endpoint
                 (e.g. Education Phase A) — same look as "saved"
                 but different message
  */
  function setSaveNowState(state, label) {
    const btn = MC.$("saveNowBtn");
    if (!btn) return;
    btn.classList.remove(
      "btn--save-now--saving",
      "btn--save-now--saved",
      "btn--save-now--offline"
    );
    if (state === "saving") {
      btn.classList.add("btn--save-now--saving");
      btn.disabled = true;
      btn.textContent = label || "Saving\u2026";
    } else if (state === "saved" || state === "local") {
      btn.classList.add("btn--save-now--saved");
      btn.disabled = false;
      btn.textContent = label || "\u2713 Saved";
    } else if (state === "offline") {
      btn.classList.add("btn--save-now--offline");
      btn.disabled = false;
      btn.textContent = label || "\uD83D\uDCBB Saved to this device";
    } else {
      btn.disabled = false;
      btn.innerHTML = "&#128190; Save Now";
    }
  }

  function scheduleSaveNowReset() {
    clearTimeout(_saveNowResetTimer);
    _saveNowResetTimer = setTimeout(function () {
      setSaveNowState("default");
    }, STATE_RESET_MS);
  }

  /* ── Manual Save Now click handler ───────────────────────── */
  async function handleSaveNow() {
    /* Always update localStorage immediately, regardless of backend. */
    silentSaveDraft();

    /* Pages without a backend endpoint (e.g. Education Phase A)
       declare apiSave as null. They get a green "saved to this
       device" — informational, not an error. */
    if (!_config.apiSave) {
      setSaveNowState("offline", "\uD83D\uDCBB Saved to this device");
      scheduleSaveNowReset();
      return;
    }

    setSaveNowState("saving");

    let payload;
    try {
      payload = _config.capturePayload();
    } catch (err) {
      console.warn("[SaveNow] payload build failed:", err);
      setSaveNowState("offline");
      scheduleSaveNowReset();
      return;
    }

    if (!MC.candidateId) {
      /* No candidate_id → backend would reject anyway */
      setSaveNowState("offline");
      scheduleSaveNowReset();
      return;
    }

    try {
      await _config.apiSave(payload);
      setSaveNowState("saved", MC.formatSavedAt());
    } catch (err) {
      console.warn("[SaveNow] backend unreachable, kept local draft:", err);
      setSaveNowState("offline");
    }
    scheduleSaveNowReset();
  }

  /* ── Clear THIS scope's draft (called after Save & Continue) ── */
  function clearDraft(scope) {
    /* If a scope is provided explicitly, use it; otherwise the
       currently-active scope. */
    let key, tsKey;
    if (scope != null) {
      key   = makeKey(scope);
      tsKey = key + "__ts";
    } else {
      key   = currentDraftKey();
      tsKey = currentTsKey();
    }
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(tsKey);
    } catch (err) { /* ignore */ }
  }

  /* ── Find the most recent draft to offer for restore.

     SCOPE-AWARE BEHAVIOUR (v2):
     ───────────────────────────
     For repeatable pages (where entryNumber is provided, e.g. Experience,
     Certifications) and dual-form pages (where activePhase is provided,
     e.g. Education Phase A/B), the restore prompt MUST only consider
     the draft matching the CURRENT active scope. Without this guard,
     opening Experience-2's page would surface Experience-1's draft and
     — on Restore — copy Experience-1's data into Experience-2's form.

     For single-form pages (no scope), the original behaviour applies:
     scan every draft saved under this page's prefix and return the
     most recent. (In practice there's only ever one draft for a
     single-form page, so the scan returns the same thing as a direct
     lookup; the loop is kept for resilience.)

     Returns: { scope, envelope, ts, key } | null
  */
  function findMostRecentDraft() {
    const scope = activeScope();

    /* Scoped pages (repeatable / dual-form): direct lookup only.
       This guarantees a draft from Experience-1 can never appear when
       the user is filling Experience-2, and vice versa. */
    if (scope) {
      try {
        const key   = makeKey(scope);
        const tsKey = key + "__ts";
        const raw   = localStorage.getItem(key);
        if (!raw) return null;
        let envelope;
        try {
          envelope = JSON.parse(raw);
        } catch (e) { return null; }
        if (!envelope || !envelope.payload) return null;
        const tsRaw = localStorage.getItem(tsKey);
        const ts    = tsRaw ? new Date(tsRaw).getTime() : 0;
        return { scope: scope, envelope: envelope, ts: ts, key: key };
      } catch (err) {
        console.warn("[SaveNow] scoped draft lookup failed:", err);
        return null;
      }
    }

    /* Single-form pages (no scope): scan all keys under this page's
       prefix and return the most recent. */
    let best = null;
    try {
      const prefix = makeKey("");  /* trailing "_" included */
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        if (key.endsWith("__ts")) continue;
        const tsKey = key + "__ts";
        const tsRaw = localStorage.getItem(tsKey);
        const ts    = tsRaw ? new Date(tsRaw).getTime() : 0;
        if (best && ts <= best.ts) continue;
        let envelope;
        try {
          envelope = JSON.parse(localStorage.getItem(key));
        } catch (e) { continue; }
        if (!envelope || !envelope.payload) continue;
        const keyScope = key.length > prefix.length
                       ? key.slice(prefix.length)
                       : "";
        best = { scope: keyScope, envelope: envelope, ts: ts, key: key };
      }
    } catch (err) {
      console.warn("[SaveNow] findMostRecentDraft failed:", err);
    }
    return best;
  }

  /* ── Show draft-restore prompt on page load if applicable ─ */
  function maybeShowRestorePrompt() {
    const found = findMostRecentDraft();
    if (!found) return;

    const banner = MC.$("draftRestorePrompt");
    const text   = MC.$("draftRestoreText");
    if (!banner) return;

    const ageStr = MC.friendlyAge(found.envelope._meta.savedAt);

    let scopeLabel = "";
    if (found.scope) {
      if (typeof _config.restoreLabel === "function") {
        try {
          scopeLabel = _config.restoreLabel(found.envelope) || "";
        } catch (err) {
          scopeLabel = "";
        }
      } else {
        scopeLabel = " on " + _config.pageName + "-" + found.scope;
      }
      if (scopeLabel && !scopeLabel.startsWith(" ")) scopeLabel = " " + scopeLabel;
    }

    if (text) {
      text.textContent =
        "We found work you started " + ageStr + scopeLabel +
        ". Would you like to continue from there?";
    }

    banner.classList.add("active");

    const restoreBtn = MC.$("draftRestoreBtn");
    const discardBtn = MC.$("draftDiscardBtn");

    if (restoreBtn) {
      restoreBtn.onclick = function () {
        let ok = false;
        try {
          if (typeof _config.restorePayload === "function") {
            ok = _config.restorePayload(found.envelope.payload, found.envelope._meta);
            /* If restorePayload returns nothing, treat as success */
            if (ok === undefined) ok = true;
          }
        } catch (err) {
          console.warn("[SaveNow] restorePayload threw:", err);
          ok = false;
        }
        banner.classList.remove("active");
        if (ok) flashDraftStatus("\u2713 Your work was restored");
      };
    }

    if (discardBtn) {
      discardBtn.onclick = function () {
        try { localStorage.removeItem(found.key); } catch (e) {}
        try { localStorage.removeItem(found.key + "__ts"); } catch (e) {}
        banner.classList.remove("active");
      };
    }
  }

  /* ── Main entry point: page calls this once in DOMContentLoaded ── */
  function init(config) {
    _config = config || {};
    if (!_config.pageName) {
      console.error("[SaveNow.init] pageName is required");
      return;
    }

    /* Wire the Save Now click */
    const btn = MC.$("saveNowBtn");
    if (btn) btn.addEventListener("click", handleSaveNow);

    /* Wire the silent-backup timer to listen on each form's input event.
       Also listen for `change` so dropdown selections (which only emit
       'change' in older browsers) trigger backups too.

       Most pages use formIds: ["myFormId"]. Pages without a <form>
       element (e.g. Goals & Interests, where each card is a direct
       child of .form-container) can pass containerSelector instead. */
    const onFormInput = function () {
      clearTimeout(_silentBackupTimer);
      _silentBackupTimer = setTimeout(function () {
        silentSaveDraft();
        flashDraftStatus();
      }, SILENT_BACKUP_MS);
    };

    const formIds = _config.formIds || [];
    formIds.forEach(function (formId) {
      const formEl = MC.$(formId);
      if (!formEl) return;
      formEl.addEventListener("input",  onFormInput);
      formEl.addEventListener("change", onFormInput);
    });

    if (_config.containerSelector) {
      const containerEl = document.querySelector(_config.containerSelector);
      if (containerEl) {
        containerEl.addEventListener("input",  onFormInput);
        containerEl.addEventListener("change", onFormInput);
      }
    }

    /* Show the restore prompt if any draft exists */
    maybeShowRestorePrompt();
  }

  /* ── Public API ──────────────────────────────────────────── */
  SaveNow.init        = init;
  SaveNow.clearDraft  = clearDraft;
  SaveNow.flashStatus = flashDraftStatus;

  /* silentSave is exposed for pages whose meaningful state changes
     happen outside form input events — for example, Skills, where
     adding/removing a skill is a button click, not typing. The page
     can call SaveNow.silentSave() after each add/remove to persist
     the new in-memory state immediately, instead of waiting for the
     8-second input debounce. */
  SaveNow.silentSave  = silentSaveDraft;

})();
