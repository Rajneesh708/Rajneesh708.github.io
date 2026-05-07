/* ============================================================
   MECULS — key_achievements.js
   Key Achievements section logic.

   Architecture (post-polish 2026-04-30):
     - MC.* shared helpers (no local copies)
     - SaveNow draft-restore engine (per-entry scope: the form data
       being typed; saved entries persist independently in the
       backend via Save & Add Another)
     - candidateId read fresh from MC.candidateId at save time
     - apiLoadAchievements guarded on MC.candidateId
     - parseInt with explicit radix everywhere
     - postMessage navigation to parent dashboard

   Page structure (post-streamline):
     - Saved achievements list rendered ABOVE the add-form (visual
       progress indicator, easier to keep adding without scrolling
       past your work)
     - Per-achievement fields reduced from 7 to 4:
         Title, Category, Impact (merged action+result), Verify URL
     - Removed: Context, Action (merged into Impact), Year,
       Organisation (Year/Org duplicated Experience section data)
     - Soft cap reduced from 10 → 7 (forces curation)
     - Metric chips kept (one-click insertion of common phrases
       into the Impact textarea)
     - Verifiable URL field added (LinkedIn post / press release /
       award page — links to evidence; validated as URL)

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `key_achievements` table is gone.
     Achievements now live as a JSONB array at
     profiles.data.key_achievements (1-to-many). All five API
     functions rewritten to use MC.saveSection / MC.loadSection
     with the standard pattern from certifications.js
     (_loadAchArray, _buildAchEntry, _newId).
   - Each entry has a client-generated `id` (UUID) instead of a
     server-assigned BIGSERIAL. The id is opaque to the page —
     enterEditMode / Delete / Update key off it the same way.
   - Validation popups consolidated into a single bullet popup
     (matches the pattern from skills, certifications, references,
     languages, preferences, ai_tools, consulting).
   - URL auto-fix on the verification link field (mirrors the
     credential-URL normaliser in certifications.js): trims, strips
     wrapping/smart quotes + trailing punctuation, fixes typos
     (htps://, htp://, https//, http//, https:/, http:/), prepends
     https:// when no protocol is present. Rejects javascript:/data:.
     Does NOT auto-upgrade http://→https:// (some legacy sites are
     http-only). Helper text updated accordingly.
   - window.confirm() replaced with MC.showConfirm (callback API)
     for visual consistency with the rest of the page.
   - validateForm: the cap check now only runs in create mode —
     editing an existing achievement at the cap shouldn't be blocked.
   - apiLoadAchievements resets the in-memory list before pushing,
     so re-running the loader cannot duplicate entries.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.KEY_ACHIEVEMENTS_VERSION === "phase1-step3" */
window.KEY_ACHIEVEMENTS_VERSION = "phase1-step3";

/* ── Config ── */
const MAX_ACHIEVEMENTS = 7;

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $           = MC.$;
const trim        = MC.trim;
const showPopup   = MC.showPopup;
const showToast   = MC.showToast;
const setLoading  = MC.setLoading;
const showConfirm = MC.showConfirm;

/* ── In-memory state — saved entries (those already persisted to the
   backend via Save & Add Another). The form fields hold the entry
   currently being edited (not yet saved). ─────────────────────── */
let achievements = [];
let achUid       = 0;

/* ============================================================
   METRIC CHIP HELPERS
   Tapping a chip inserts its text into the Impact textarea at
   the cursor position. Saves typing; helps non-native speakers
   and people who freeze on blank textareas.
   ============================================================ */

function setupMetricChips() {
  const chips = document.querySelectorAll(".metric-chip");
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      const insertText = chip.getAttribute("data-insert");
      const ta = $("achImpact");
      if (!ta) return;

      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const before = ta.value.substring(0, start);
      const after  = ta.value.substring(end);
      const newVal = before + insertText + after;

      const max = parseInt(ta.getAttribute("maxlength"), 10);
      if (max && newVal.length > max) {
        showPopup("That phrase doesn't fit within the character limit. Edit your text first.");
        return;
      }

      ta.value = newVal;
      ta.selectionStart = ta.selectionEnd = start + insertText.length;
      ta.focus();
      MC.updateCounter(ta, "achImpactCounter");

      /* Heartbeat to SaveNow */
      if (window.SaveNow && SaveNow.silentSave) {
        SaveNow.silentSave();
      }
    });
  });
}

/* ============================================================
   URL VALIDATION + AUTO-FIX
   Mirrors normalizeAndValidateCredentialUrl in certifications.js
   and normalizeAndValidateProfileUrl in languages.js.

   Cleanups:
   - Trim whitespace, strip wrapping straight + smart quotes
   - Strip trailing punctuation users sometimes leave from pasting
   - Fix protocol typos: htps://, htp://, https//, http//, https:/, http:/
   - Prepend https:// if no protocol present
   - Reject other schemes (javascript:, data:, ftp:, etc.)
   - Final URL parse to confirm a non-empty host

   Returns the cleaned URL string or null if unfixable.
   Does NOT auto-upgrade http:// to https:// (some legacy sites are
   http-only).
   ============================================================ */

function normalizeAndValidateUrl(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  /* Strip wrapping quotes (straight + smart) */
  s = s.replace(/^["'\u201C\u201D\u2018\u2019]+/, "")
       .replace(/["'\u201C\u201D\u2018\u2019]+$/, "");

  /* Strip trailing punctuation */
  s = s.replace(/[.,;:)\]>]+$/, "");

  if (!s) return null;

  /* Fix common protocol typos. Order matters — fix longer typos
     first so a partial match doesn't shadow a full one. */
  if (/^htps:\/\//i.test(s))      s = s.replace(/^htps:\/\//i,   "https://");
  if (/^htp:\/\//i.test(s))       s = s.replace(/^htp:\/\//i,    "http://");
  if (/^https\/\//i.test(s))      s = s.replace(/^https\/\//i,   "https://");
  if (/^http\/\//i.test(s))       s = s.replace(/^http\/\//i,    "http://");
  if (/^https:\/(?!\/)/i.test(s)) s = s.replace(/^https:\//i,    "https://");
  if (/^http:\/(?!\/)/i.test(s))  s = s.replace(/^http:\//i,     "http://");

  /* Prepend https:// if no protocol present at all. */
  if (!/^https?:\/\//i.test(s)) {
    /* If the input looks like a different scheme, refuse. */
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      return null;
    }
    s = "https://" + s;
  }

  /* Final sanity: must parse as a URL with a non-empty host. */
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    return u.href;
  } catch (e) {
    return null;
  }
}

/* ============================================================
   RENDER SAVED LIST
   Re-uses the shared `.item-card--accent-yellow` pattern from
   tier_shared.css (no page-specific .ach-card needed).
   XSS-safe: built with createElement + textContent.
   ============================================================ */

function renderList() {
  const list = $("achList");
  list.innerHTML = "";

  /* Hide saved-list while editing — focused on one entry. */
  if (EditState.mode === "edit") return;

  if (achievements.length === 0) {
    /* Empty state — gentle prompt, not an error */
    const empty = document.createElement("div");
    empty.className = "saved-list-empty";
    empty.textContent = "No achievements added yet. Use the form below to add your first one.";
    list.appendChild(empty);
    return;
  }

  const heading = document.createElement("h3");
  heading.className = "list-heading";
  heading.textContent = "Your Achievements (" + achievements.length + ")";
  list.appendChild(heading);

  achievements.forEach(ach => {
    const card = document.createElement("div");
    card.className = "item-card item-card--accent-yellow";

    const body = document.createElement("div");
    body.className = "item-card__body";
    body.style.cursor = "pointer";
    body.addEventListener("click", () => enterEditMode(ach));

    /* Category badge */
    const badgeRow = document.createElement("div");
    badgeRow.className = "item-card__badge-row";
    const catBadge = document.createElement("span");
    catBadge.className = "type-badge type-badge--yellow";
    catBadge.textContent = ach.category || "—";
    badgeRow.appendChild(catBadge);
    body.appendChild(badgeRow);

    /* Title */
    const titleEl = document.createElement("div");
    titleEl.className = "item-card__title";
    titleEl.textContent = ach.title;
    body.appendChild(titleEl);

    /* Impact (with pin emoji prefix to draw the eye) */
    const impactEl = document.createElement("div");
    impactEl.className = "item-card__body-text";
    impactEl.textContent = "📌 " + ach.impact;
    body.appendChild(impactEl);

    /* Verification link — only if present.
       Stop click propagation so the link click doesn't trigger edit mode. */
    if (ach.verifyUrl) {
      const linkEl = document.createElement("a");
      linkEl.className = "item-card__link";
      linkEl.href = ach.verifyUrl;
      linkEl.target = "_blank";
      linkEl.rel = "noopener";
      linkEl.textContent = "🔗 Verify";
      linkEl.addEventListener("click", e => e.stopPropagation());
      body.appendChild(linkEl);
    }

    card.appendChild(body);

    /* Actions — Edit + Delete */
    const actions = document.createElement("div");
    actions.className = "item-card__actions ach-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "ach-card__btn ach-card__btn--edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", e => {
      e.stopPropagation();
      enterEditMode(ach);
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ach-card__btn ach-card__btn--delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", e => {
      e.stopPropagation();
      handleDeleteAchievement(ach);
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    list.appendChild(card);
  });
}

/* ============================================================
   EDIT MODE
   ============================================================ */

async function enterEditMode(ach) {
  if (!ach.id) {
    showToast("Could not find that achievement.", "error");
    return;
  }

  /* In the JSONB pattern, all entries are already in memory after
     apiLoadAchievements. The defensive re-fetch is kept for the
     rare case where the in-memory entry is stale (e.g. a future
     refresh path) — it's a cheap array lookup, not a network call. */
  let row = ach;
  if (row.title === undefined || row.impact === undefined) {
    try {
      const fetched = await apiLoadOneAchievement(ach.id);
      if (!fetched) {
        showToast("Could not load that achievement. Please try again.", "error");
        return;
      }
      row = {
        id: fetched.id,
        title: fetched.title,
        category: fetched.category,
        impact: fetched.impact,
        verifyUrl: fetched.verify_url || ""
      };
    } catch (err) {
      showToast("Could not load that achievement. Please try again.", "error");
      return;
    }
  }

  EditState.mode      = "edit";
  EditState.editingId = row.id;

  populateFormFromAch(row);
  applyEditModeUI();
  renderList();   /* hides during edit */

  /* Scroll the form into view */
  const formCard = $("achTitle").closest(".form-card");
  if (formCard) formCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function exitEditMode() {
  EditState.mode      = "create";
  EditState.editingId = null;
  applyEditModeUI();
  resetForm();
  renderList();   /* re-shows saved-list */
}

function applyEditModeUI() {
  const saveAnotherBtn = $("saveAnotherBtn");
  const saveContinueBtn = $("saveContinueBtn");
  const cancelBtn = $("cancelEditAchBtn");
  const heading = document.querySelector(".form-card .card-heading");

  if (EditState.mode === "edit") {
    if (saveAnotherBtn) saveAnotherBtn.textContent = "Save Changes";
    if (saveContinueBtn) saveContinueBtn.classList.add("hidden");
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    if (heading) heading.textContent = "Edit Achievement";
  } else {
    if (saveAnotherBtn) saveAnotherBtn.textContent = "Save & Add Another Achievement";
    if (saveContinueBtn) saveContinueBtn.classList.remove("hidden");
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (heading) heading.textContent = "Add an Achievement";
  }
}

function populateFormFromAch(ach) {
  $("achTitle").value     = ach.title    || "";
  $("achCategory").value  = ach.category || "";
  $("achImpact").value    = ach.impact   || "";
  $("achVerifyUrl").value = ach.verifyUrl || "";

  /* Refresh char counters */
  MC.updateCounter($("achTitle"),  "achTitleCounter");
  MC.updateCounter($("achImpact"), "achImpactCounter");
}

async function handleDeleteAchievement(ach) {
  if (!ach.id) {
    /* Defensive: shouldn't happen post-Supabase. */
    achievements = achievements.filter(a => a.uid !== ach.uid);
    renderList();
    updateQuota();
    return;
  }

  const title = trim(ach.title || "") || "this achievement";
  const message = "Delete \"" + title + "\"?\n\n" +
                  "This will permanently remove this achievement from your " +
                  "profile. This cannot be undone.";

  /* MC.showConfirm uses a callback API — the deletion happens inside
     the onConfirm callback. This matches the pattern used by skip
     confirmations on other pages, and keeps visual styling
     consistent across the portal. */
  showConfirm(
    message,
    async function () {
      try {
        await apiDeleteAchievement(ach.id);
      } catch (err) {
        showToast("Could not delete. Please try again.", "error");
        return;
      }
      achievements = achievements.filter(a => a.uid !== ach.uid);
      renderList();
      updateQuota();
      showToast("Achievement deleted.", "success");
    },
    {
      confirmLabel: "Yes, delete",
      cancelLabel:  "Cancel"
    }
  );
}

function updateQuota() {
  const countEl = $("achCount");
  if (countEl) countEl.textContent = achievements.length;
}

/* ============================================================
   VALIDATE FORM (the entry being typed in)
   ============================================================ */

function validateForm() {
  /* Cap check — ONLY in create mode. Editing an existing entry
     when at the cap shouldn't be blocked, otherwise the user is
     stuck unable to save changes once they hit the limit. */
  if (EditState.mode !== "edit" && achievements.length >= MAX_ACHIEVEMENTS) {
    showPopup("You have reached the maximum of " + MAX_ACHIEVEMENTS +
              " key achievements. Remove one to add another.");
    return false;
  }

  const title    = trim($("achTitle").value);
  const category = $("achCategory").value;
  const impact   = trim($("achImpact").value);

  /* Consolidated missing-field check. */
  const missing = [];
  if (!title)    missing.push("Achievement Title");
  if (!category) missing.push("Category");
  if (!impact)   missing.push("What You Did and the Impact");

  if (missing.length > 0) {
    if (missing.length === 1) {
      showPopup("Please fill in: " + missing[0] + ".");
    } else {
      showPopup(
        "Please fill in the following before continuing:\n\n\u2022 " +
        missing.join("\n\u2022 ")
      );
    }
    /* Focus the first missing field. */
    if (!title)         $("achTitle").focus();
    else if (!category) $("achCategory").focus();
    else if (!impact)   $("achImpact").focus();
    return false;
  }

  /* Verification URL — auto-fix and write cleaned value back so
     buildItem and the save call use the cleaned URL. Only validate
     if the user entered something (field is optional). */
  const verifyUrlRaw = trim($("achVerifyUrl").value);
  if (verifyUrlRaw) {
    const cleaned = normalizeAndValidateUrl(verifyUrlRaw);
    if (!cleaned) {
      showPopup("The verification link doesn't look like a valid web address. " +
                "Please correct it or leave the field empty.");
      $("achVerifyUrl").focus();
      return false;
    }
    if (cleaned !== $("achVerifyUrl").value) {
      $("achVerifyUrl").value = cleaned;
    }
  }

  return true;
}

/* ============================================================
   BUILD ITEM (from form)
   ============================================================ */

function buildItem() {
  return {
    uid       : ++achUid,
    title     : trim($("achTitle").value),
    category  : $("achCategory").value,
    impact    : trim($("achImpact").value),
    verifyUrl : trim($("achVerifyUrl").value)
  };
}

/* ============================================================
   RESET FORM
   ============================================================ */

function resetForm() {
  $("achTitle").value     = "";
  $("achCategory").value  = "";
  $("achImpact").value    = "";
  $("achVerifyUrl").value = "";

  /* Reset all counters to "0 / max" by calling MC.updateCounter
     with the current empty values. */
  MC.updateCounter($("achTitle"),  "achTitleCounter");
  MC.updateCounter($("achImpact"), "achImpactCounter");
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `key_achievements` table is gone. Achievements now
   live as a JSONB array at profiles.data.key_achievements
   (1-to-many). Save/load go through MC.saveSection /
   MC.loadSection which handle auth and RLS server-side via the
   save_profile_section RPC.

   Internal helpers:
   - _loadAchArray: fetch the section, default to []
   - _buildAchEntry: shape the payload into the canonical row form
   - _newId: generate a stable client-side id for a new entry

   Public API (apiSaveAchievement / apiUpdateAchievement /
   apiDeleteAchievement / apiLoadOneAchievement /
   apiLoadAchievements) keeps the same names and signatures so
   the rest of the page doesn't change.
   ============================================================ */

/* ── Internal: load the achievements array, default to []. ── */
async function _loadAchArray() {
  const arr = await MC.loadSection("key_achievements");
  return Array.isArray(arr) ? arr : [];
}

/* ── Internal: shape the payload into a canonical entry.
   Preserves existing id on update, generates a new one on insert. ── */
function _buildAchEntry(payload, existingId) {
  return {
    id         : existingId || _newId(),
    title      : payload.title    || null,
    category   : payload.category || null,
    impact     : payload.impact   || null,
    verify_url : payload.verifyUrl || null
  };
}

/* ── Internal: generate a unique id for a new entry.
   Replaces the old database BIGSERIAL. crypto.randomUUID() in modern
   browsers; timestamp+random hybrid fallback for ancient browsers. ── */
function _newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "ach-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

async function apiSaveAchievement(item) {
  const arr = await _loadAchArray();
  const entry = _buildAchEntry(item, null);
  arr.push(entry);
  await MC.saveSection("key_achievements", arr);
  return entry;
}

async function apiUpdateAchievement(id, item) {
  const arr = await _loadAchArray();
  const idx = arr.findIndex(function (e) { return e.id === id; });
  if (idx < 0) {
    throw new Error("Could not save changes: achievement not found");
  }
  arr[idx] = _buildAchEntry(item, id);
  await MC.saveSection("key_achievements", arr);
  return arr[idx];
}

async function apiDeleteAchievement(id) {
  const arr = await _loadAchArray();
  const filtered = arr.filter(function (e) { return e.id !== id; });
  await MC.saveSection("key_achievements", filtered);
  return true;
}

async function apiLoadOneAchievement(id) {
  const arr = await _loadAchArray();
  return arr.find(function (e) { return e.id === id; }) || null;
}

async function apiLoadAchievements() {
  if (!MC.candidateId) return;
  let rows;
  try {
    rows = await _loadAchArray();
  } catch (err) {
    console.error("Could not load achievements:", err);
    return;
  }

  if (!Array.isArray(rows)) return;

  /* Defensive: reset in-memory state before pushing loaded entries.
     Without this, calling apiLoadAchievements twice (e.g. via a
     future re-init path) would duplicate every achievement. */
  achievements = [];
  achUid = 0;

  rows.forEach(it => {
    achievements.push({
      uid       : ++achUid,
      id        : it.id,                  /* client-generated UUID, used by edit/delete */
      title     : it.title,
      category  : it.category,
      impact    : it.impact,
      verifyUrl : it.verify_url || ""
    });
  });
  renderList();
  updateQuota();
}

/* ── Edit-mode state ──
   Tracks whether we're creating a new achievement or editing an
   existing one. Mirrors EditState pattern from experience.js,
   education.js, certifications.js, references.js. */
const EditState = {
  mode      : "create",   // "create" | "edit"
  editingId : null        // database row id being edited
};

/* ============================================================
   SAVE & ADD ANOTHER
   ============================================================ */

async function saveAnother() {
  if (!validateForm()) return;

  const btn  = $("saveAnotherBtn");
  const btn2 = $("saveContinueBtn");
  setLoading(btn, true);
  if (btn2) btn2.disabled = true;

  const item = buildItem();

  /* ─── EDIT MODE: UPDATE existing row ─── */
  if (EditState.mode === "edit" && EditState.editingId) {
    try {
      await apiUpdateAchievement(EditState.editingId, item);
    } catch (err) {
      console.error("Achievement update failed:", err);
      showToast("Could not save changes. Please try again.", "error");
      setLoading(btn, false);
      if (btn2) btn2.disabled = false;
      return;
    }

    /* Update the in-memory row in place */
    const idx = achievements.findIndex(a => a.id === EditState.editingId);
    if (idx !== -1) {
      achievements[idx] = Object.assign({}, achievements[idx], {
        title: item.title,
        category: item.category,
        impact: item.impact,
        verifyUrl: item.verifyUrl
      });
    }

    setLoading(btn, false);
    if (btn2) btn2.disabled = false;
    showToast("Changes saved.", "success");
    exitEditMode();
    return;
  }

  /* ─── CREATE MODE: INSERT new row ─── */
  let savedRow;
  try {
    savedRow = await apiSaveAchievement(item);
  } catch (err) {
    console.error("Achievement save failed:", err);
    showToast("Could not save to server. Your data is preserved — please try again.", "error");
    setLoading(btn, false);
    if (btn2) btn2.disabled = false;
    return;
  }

  /* Carry the server-assigned id into the in-memory entry — needed
     so subsequent Edit/Delete on this freshly-added row work without
     a page reload. */
  achievements.push(Object.assign({}, item, { id: savedRow.id }));
  renderList();
  updateQuota();
  resetForm();

  /* Saved successfully — clear the active form draft */
  if (window.SaveNow) SaveNow.clearDraft();

  setLoading(btn, false);
  if (btn2) btn2.disabled = false;
  showToast("Achievement saved.", "success");

  /* Scroll the saved list back into view so the user sees their
     new entry, then the empty form is ready below. */
  setTimeout(() => {
    $("achList").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 200);
}

/* ============================================================
   SAVE & CONTINUE
   ============================================================ */

async function saveContinue() {
  /* Detect whether the user has typed anything into the form. */
  const hasFormInput = trim($("achTitle").value) ||
                       $("achCategory").value     ||
                       trim($("achImpact").value);

  if (!hasFormInput) {
    /* Empty form */
    if (achievements.length === 0) {
      showPopup("You haven't added any key achievements. Please add an achievement to save, or use \"Skip — Not relevant to me\" if this section doesn't apply.");
      return;
    }
    /* User already has saved entries — just navigate */
    proceedToNext();
    return;
  }

  /* Form has data — validate and save it before navigating */
  if (!validateForm()) return;

  const btn  = $("saveContinueBtn");
  const btn2 = $("saveAnotherBtn");
  setLoading(btn, true);
  btn2.disabled = true;

  const item = buildItem();
  let savedRow;
  try {
    savedRow = await apiSaveAchievement(item);
  } catch (err) {
    console.error("Achievement save failed:", err);
    showToast("Could not save to server. Your data is preserved — please try again.", "error");
    setLoading(btn, false);
    btn2.disabled = false;
    return;
  }

  achievements.push(Object.assign({}, item, { id: savedRow.id }));

  if (window.SaveNow) SaveNow.clearDraft();

  proceedToNext();
}

function proceedToNext() {
  MC.safeSet("key_achievements_completed", "yes");
  MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

  window.parent.postMessage(
    { type: "navigate", page: "mentorship.html", sidebarKey: "Mentorship & Coaching" },
    "*"
  );
}

/* ============================================================
   SKIP — section is optional, user can opt out without saving
   ============================================================ */

function skipSection() {
  /* If the user has typed something into the form, warn before discarding. */
  const hasFormInput = trim($("achTitle").value) ||
                       $("achCategory").value     ||
                       trim($("achImpact").value);

  const proceedSkip = () => {
    /* Don't save anything — clear any draft so it doesn't reappear */
    if (window.SaveNow) SaveNow.clearDraft();

    MC.safeSet("key_achievements_completed", "skipped");
    MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

    window.parent.postMessage(
      { type: "navigate", page: "mentorship.html", sidebarKey: "Mentorship & Coaching" },
      "*"
    );
  };

  if (hasFormInput) {
    showConfirm(
      "You have unsaved input in the form.\n\n" +
      "If you skip, your typed data will be discarded and not saved to your profile.\n\n" +
      "Are you sure you want to skip this section?",
      proceedSkip,
      {
        confirmLabel: "Yes, skip and discard",
        cancelLabel:  "Go back"
      }
    );
    return;
  }

  proceedSkip();
}

/* ============================================================
   SAVENOW DRAFT — capture and restore (form only)
   The saved entries in `achievements[]` come from the backend, so
   the draft only needs to capture what's currently in the form.
   ============================================================ */

function captureAchDraft() {
  return {
    title     : trim($("achTitle").value),
    category  : $("achCategory").value,
    impact    : trim($("achImpact").value),
    verifyUrl : trim($("achVerifyUrl").value)
  };
}

function restoreAchDraft(draft) {
  if (!draft) return false;
  if (draft.title)     $("achTitle").value     = draft.title;
  if (draft.category)  $("achCategory").value  = draft.category;
  if (draft.impact)    $("achImpact").value    = draft.impact;
  if (draft.verifyUrl) $("achVerifyUrl").value = draft.verifyUrl;
  MC.updateCounter($("achTitle"),  "achTitleCounter");
  MC.updateCounter($("achImpact"), "achImpactCounter");
  return true;
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  setupMetricChips();

  /* Char counters on the two limited fields */
  $("achTitle").addEventListener("input", () => {
    MC.updateCounter($("achTitle"), "achTitleCounter");
  });
  $("achImpact").addEventListener("input", () => {
    MC.updateCounter($("achImpact"), "achImpactCounter");
  });

  $("saveAnotherBtn").addEventListener("click", saveAnother);
  $("saveContinueBtn").addEventListener("click", saveContinue);

  /* Wire Skip button — section is optional */
  const skipBtn = $("skipBtn");
  if (skipBtn) skipBtn.addEventListener("click", skipSection);

  /* Wire Cancel Edit button (hidden by default; shown in edit mode) */
  const cancelBtn = $("cancelEditAchBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => exitEditMode());

  /* Load any existing backend data BEFORE SaveNow.init so the draft-restore
     check has the canonical state to compare against. */
  await apiLoadAchievements();

  if (window.SaveNow) {
    SaveNow.init({
      pageName          : "key_achievements",
      containerSelector : ".form-container",
      capturePayload    : captureAchDraft,
      restorePayload    : restoreAchDraft,
      apiSave           : (p) => {
        /* SaveNow's auto-save fires periodically. We don't push every
           keystroke to the achievements API — only when the user
           explicitly clicks Save & Add Another. So return a resolved
           Promise to satisfy SaveNow's contract without firing a
           network request. */
        return Promise.resolve({ ok: true });
      },
      isEmpty           : () => !trim($("achTitle").value)
                              && !$("achCategory").value
                              && !trim($("achImpact").value)
                              && !trim($("achVerifyUrl").value)
        /* Note: doesn't consider achievements[] because those are
           backend-persisted, not draft state. */
    });
  }
});
