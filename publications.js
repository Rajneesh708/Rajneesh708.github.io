/* ============================================================
   MECULS — publications.js
   Publications & Media section logic.

   Page structure:
     - Saved items list ABOVE form (visible progress, Edit/Delete
       per saved entry)
     - 6 fields per item: Type, Title, Outlet, Year (optional),
       URL (optional), Description (optional)
     - Soft cap: 12 items
     - Empty state placeholder when no items saved

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `publications` table is gone.
     Publications now live as a JSONB array at
     profiles.data.publications (1-to-many). All five API functions
     rewritten to use MC.saveSection / MC.loadSection with the
     standard 1-to-many helper pattern from key_achievements.js
     (_loadPubsArray, _buildPubEntry, _newId).
   - Each entry has a client-generated `id` (UUID) instead of a
     server-assigned BIGSERIAL. The id is opaque to the page —
     enterEditMode / Delete / Update key off it the same way.
   - The internal entry shape uses `pub_type` (snake_case, matching
     prior server convention) so populateFormFromPub and
     addOrUpdatePub continue to work without callsite changes.
   - Validation popups consolidated into a single bullet popup
     (matches the pattern from skills, certifications, references,
     languages, preferences, ai_tools, consulting, key_achievements,
     mentorship, portfolio).
   - URL auto-fix on the optional URL field (mirrors the credential
     URL normaliser in certifications.js): trims, strips quotes,
     fixes protocol typos, prepends https:// when missing, rejects
     javascript:/data:. Cleaned URL is written back to the input.
   - window.confirm() replaced with MC.showConfirm in three places:
     mid-edit form-overwrite warning, delete confirmation, and
     skip-with-input warning. Visual styling now consistent.
   - apiLoadPublications resets the in-memory list before pushing,
     so re-running the loader cannot duplicate entries.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.PUBLICATIONS_VERSION === "phase1-step3" */
window.PUBLICATIONS_VERSION = "phase1-step3";

/* ── Config ── */
const MAX_ITEMS = 12;

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $           = MC.$;
const trim        = MC.trim;
const showPopup   = MC.showPopup;
const showToast   = MC.showToast;
const setLoading  = MC.setLoading;
const showConfirm = MC.showConfirm;

/* ── In-memory state — saved entries (already persisted to backend
   via + Add to List). Form holds the entry being added or edited. */
let publications = [];
let pubUid       = 0;

/* ============================================================
   EDIT STATE — tracks whether form is in "add" or "edit" mode
   ============================================================ */

const EditState = {
  mode      : "add",   // "add" | "edit"
  editingId : null,    // database id of row being edited (UUID)
  editingUid: null     // in-memory uid of the entry being edited
};

/* ============================================================
   TYPE → BADGE COLOR MAPPING
   ============================================================ */

const TYPE_BADGE_CLASS = {
  "Article / Blog"            : "type-badge--blue",
  "Book / Whitepaper"         : "type-badge--purple",
  "Podcast / Audio"           : "type-badge--orange",
  "Video / Webinar"           : "type-badge--red",
  "Media Interview"           : "type-badge--green",
  "Conference Talk / Keynote" : "type-badge--teal",
  "Research / Academic Paper" : "type-badge--gray"
};

/* ============================================================
   POPULATE YEARS DROPDOWN
   ============================================================ */

function populateYears() {
  const sel = $("pubYear");
  const current = new Date().getFullYear();
  for (let y = current; y >= 1980; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  }
}

/* ============================================================
   URL VALIDATION + AUTO-FIX
   Mirrors normalizeAndValidateCredentialUrl in certifications.js,
   normalizeAndValidateUrl in key_achievements.js / portfolio.js.

   Cleanups:
   - Trim whitespace, strip wrapping straight + smart quotes
   - Strip trailing punctuation users sometimes leave from pasting
   - Fix protocol typos: htps://, htp://, https//, http//, https:/, http:/
   - Prepend https:// if no protocol present
   - Reject other schemes (javascript:, data:, ftp:, etc.)
   - Final URL parse to confirm a non-empty host

   Returns the cleaned URL string or null if unfixable / empty.
   The publications URL field is OPTIONAL, so the calling validator
   only invokes this when the user actually typed something.
   Does NOT auto-upgrade http:// to https://.
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
   QUOTA UPDATE
   ============================================================ */

function updateQuota() {
  const el = $("pubCount");
  if (el) el.textContent = publications.length;
}

/* ============================================================
   RENDER SAVED LIST
   ============================================================ */

function renderList() {
  const list = $("pubList");
  list.innerHTML = "";

  if (publications.length === 0) {
    const empty = document.createElement("div");
    empty.className = "saved-list-empty";
    empty.textContent = "No publications added yet. Use the form below to add your first one.";
    list.appendChild(empty);
    return;
  }

  const heading = document.createElement("h3");
  heading.className = "list-heading";
  heading.textContent = "Your Publications & Media (" + publications.length + ")";
  list.appendChild(heading);

  publications.forEach(pub => {
    const card = document.createElement("div");
    card.className = "item-card item-card--accent-purple";

    const body = document.createElement("div");
    body.className = "item-card__body";

    /* Badge row: type + year */
    const badgeRow = document.createElement("div");
    badgeRow.className = "item-card__badge-row";

    const typeBadge = document.createElement("span");
    typeBadge.className = "type-badge " + (TYPE_BADGE_CLASS[pub.type] || "type-badge--gray");
    typeBadge.textContent = pub.type || "—";
    badgeRow.appendChild(typeBadge);

    if (pub.year) {
      const yearBadge = document.createElement("span");
      yearBadge.className = "type-badge type-badge--gray";
      yearBadge.style.marginLeft = "4px";
      yearBadge.textContent = pub.year;
      badgeRow.appendChild(yearBadge);
    }
    body.appendChild(badgeRow);

    /* Title */
    const titleEl = document.createElement("div");
    titleEl.className = "item-card__title";
    titleEl.textContent = pub.title;
    body.appendChild(titleEl);

    /* Outlet */
    if (pub.outlet) {
      const outletEl = document.createElement("div");
      outletEl.className = "item-card__sub";
      outletEl.textContent = pub.outlet;
      body.appendChild(outletEl);
    }

    /* Description (truncated) */
    if (pub.description) {
      const descEl = document.createElement("div");
      descEl.className = "item-card__body-text";
      const shortDesc = pub.description.length > 100
                      ? pub.description.substring(0, 100) + "…"
                      : pub.description;
      descEl.textContent = shortDesc;
      body.appendChild(descEl);
    }

    /* Link */
    if (pub.url) {
      const linkEl = document.createElement("a");
      linkEl.className = "item-card__link";
      linkEl.href = pub.url;
      linkEl.target = "_blank";
      linkEl.rel = "noopener";
      linkEl.textContent = "🔗 View publication";
      body.appendChild(linkEl);
    }

    card.appendChild(body);

    /* Actions: Edit + Delete */
    const actions = document.createElement("div");
    actions.className = "item-card__actions pub-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "pub-card__btn pub-card__btn--edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => enterEditMode(pub));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "pub-card__btn pub-card__btn--delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => handleDeletePublication(pub));
    actions.appendChild(deleteBtn);

    card.appendChild(actions);

    list.appendChild(card);
  });
}

/* ============================================================
   EDIT — enter edit mode for an existing publication
   ============================================================ */

async function enterEditMode(pub) {
  /* Block double-edit */
  if (EditState.mode === "edit") {
    showPopup("You're already editing another publication. Save or cancel that edit first.");
    return;
  }

  /* If user has typed something in the form (different from the
     row they're trying to edit), warn before clobbering. */
  const formHasInput = $("pubType").value
                    || trim($("pubTitle").value)
                    || trim($("pubOutlet").value)
                    || $("pubYear").value
                    || trim($("pubUrl").value)
                    || trim($("pubDesc").value);

  /* The actual entry-into-edit-mode work is wrapped in a callback so
     the MC.showConfirm flow can gate it cleanly. The callback is the
     same body used when there's no input to clobber — just runs
     immediately. */
  const proceed = async () => {
    /* Defensive — if the in-memory row has no id, fetch fresh */
    let row = pub;
    if (!row.id) {
      try {
        row = await apiLoadOnePublication(pub.id);
      } catch (err) {
        console.error("[publications] could not load row for edit:", err);
        showPopup("Could not load this publication for editing. Please refresh the page and try again.");
        return;
      }
      if (!row) {
        showPopup("This publication is no longer available. It may have been removed.");
        return;
      }
    }

    EditState.mode       = "edit";
    EditState.editingId  = row.id;
    EditState.editingUid = pub.uid;

    populateFormFromPub(row);
    applyEditModeUI();

    /* Scroll to form so user sees it's in edit mode */
    const formCard = document.querySelector(".form-card");
    if (formCard) formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (formHasInput) {
    showConfirm(
      "You have unsaved input in the form.\n\n" +
      "Discard it and edit the saved item instead?",
      proceed,
      {
        confirmLabel: "Discard and edit",
        cancelLabel:  "Keep my input"
      }
    );
    return;
  }

  await proceed();
}

function exitEditMode() {
  EditState.mode       = "add";
  EditState.editingId  = null;
  EditState.editingUid = null;
  resetForm();
  applyEditModeUI();
}

function applyEditModeUI() {
  const addBtn    = $("addPubBtn");
  const cancelBtn = $("cancelEditBtn");
  const cardHeading = document.querySelector(".form-card .card-heading");

  if (EditState.mode === "edit") {
    addBtn.textContent = "Save Changes";
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    if (cardHeading) cardHeading.textContent = "Edit Publication";
  } else {
    addBtn.textContent = "+ Add to List";
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (cardHeading) cardHeading.textContent = "Add a Publication or Media Appearance";
  }
}

function populateFormFromPub(pub) {
  $("pubType").value   = pub.pub_type || pub.type || "";
  $("pubTitle").value  = pub.title || "";
  $("pubOutlet").value = pub.outlet || "";
  $("pubYear").value   = pub.year ? String(pub.year) : "";
  $("pubUrl").value    = pub.url || "";
  $("pubDesc").value   = pub.description || "";
  MC.updateCounter($("pubTitle"), "pubTitleCounter");
  MC.updateCounter($("pubDesc"),  "pubDescCounter");
}

/* ============================================================
   DELETE — confirm and delete a publication
   ============================================================ */

async function handleDeletePublication(pub) {
  const label = pub.title ? `"${pub.title}"` : "this publication";
  const message = `Delete ${label}? This cannot be undone.`;

  /* MC.showConfirm uses a callback API — the deletion happens inside
     the onConfirm callback. Same pattern used on key_achievements,
     portfolio, mentorship skip, etc. */
  showConfirm(
    message,
    async function () {
      try {
        await apiDeletePublication(pub.id);
      } catch (err) {
        console.error("[publications] delete failed:", err);
        showPopup("Could not delete this publication. Please check your connection and try again.");
        return;
      }

      publications = publications.filter(p => p.uid !== pub.uid);

      /* If we were editing this one, exit edit mode */
      if (EditState.mode === "edit" && EditState.editingUid === pub.uid) {
        exitEditMode();
      }

      renderList();
      updateQuota();
      showToast("Publication deleted.", "success");
    },
    {
      confirmLabel: "Yes, delete",
      cancelLabel:  "Cancel"
    }
  );
}

/* ============================================================
   VALIDATE FORM
   ============================================================ */

function validateForm() {
  /* Cap check — only in add mode. Editing an existing entry at the
     cap shouldn't be blocked since the count stays the same. */
  if (EditState.mode === "add" && publications.length >= MAX_ITEMS) {
    showPopup("You have reached the maximum of " + MAX_ITEMS +
              " publications. Remove one to add another.");
    return false;
  }

  const pubType = $("pubType").value;
  const title   = trim($("pubTitle").value);

  /* Consolidated missing-field check. Only Type and Title are
     required — outlet, year, url, description are all optional. */
  const missing = [];
  if (!pubType) missing.push("Type");
  if (!title)   missing.push("Title");

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
    if (!pubType)    $("pubType").focus();
    else if (!title) $("pubTitle").focus();
    return false;
  }

  /* URL — optional, but if typed, must normalize cleanly. The
     cleaned URL is written back so buildItem and the save call
     use it. */
  const urlRaw = trim($("pubUrl").value);
  if (urlRaw) {
    const cleaned = normalizeAndValidateUrl(urlRaw);
    if (!cleaned) {
      showPopup("The URL doesn't look like a valid web address. " +
                "Please correct it or leave the field empty.");
      $("pubUrl").focus();
      return false;
    }
    if (cleaned !== $("pubUrl").value) {
      $("pubUrl").value = cleaned;
    }
  }

  return true;
}

/* ============================================================
   BUILD ITEM (for save / update)
   ============================================================ */

function buildItem() {
  return {
    type       : $("pubType").value,
    title      : trim($("pubTitle").value),
    outlet     : trim($("pubOutlet").value) || null,
    year       : $("pubYear").value || null,
    url        : trim($("pubUrl").value) || null,
    description: trim($("pubDesc").value) || null
  };
}

/* ============================================================
   RESET FORM
   ============================================================ */

function resetForm() {
  $("pubType").value   = "";
  $("pubTitle").value  = "";
  $("pubOutlet").value = "";
  $("pubYear").value   = "";
  $("pubUrl").value    = "";
  $("pubDesc").value   = "";
  MC.updateCounter($("pubTitle"), "pubTitleCounter");
  MC.updateCounter($("pubDesc"),  "pubDescCounter");
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `publications` table is gone. Publications now live
   as a JSONB array at profiles.data.publications (1-to-many).
   Save/load go through MC.saveSection / MC.loadSection which
   handle auth and RLS server-side via the save_profile_section
   RPC.

   Internal helpers:
   - _loadPubsArray: fetch the section, default to []
   - _buildPubEntry: shape the payload into the canonical row form
   - _newId: generate a stable client-side id for a new entry

   The entry shape preserves the prior server convention (`pub_type`
   instead of `type`) so the rest of the page works without
   callsite changes.
   ============================================================ */

/* ── Internal: load the publications array, default to []. ── */
async function _loadPubsArray() {
  const arr = await MC.loadSection("publications");
  return Array.isArray(arr) ? arr : [];
}

/* ── Internal: shape the payload into a canonical entry.
   Preserves existing id on update, generates a new one on insert. ── */
function _buildPubEntry(payload, existingId) {
  return {
    id          : existingId || _newId(),
    pub_type    : payload.type    || null,
    title       : payload.title   || null,
    outlet      : payload.outlet  || null,
    year        : payload.year ? Number(payload.year) : null,
    url         : payload.url         || null,
    description : payload.description || null
  };
}

/* ── Internal: generate a unique id for a new entry.
   Replaces the old database BIGSERIAL. crypto.randomUUID() in modern
   browsers; timestamp+random hybrid fallback for ancient browsers. ── */
function _newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "pub-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

async function apiSavePublication(item) {
  const arr = await _loadPubsArray();
  const entry = _buildPubEntry(item, null);
  arr.push(entry);
  await MC.saveSection("publications", arr);
  return entry;
}

async function apiUpdatePublication(id, item) {
  const arr = await _loadPubsArray();
  const idx = arr.findIndex(function (e) { return e.id === id; });
  if (idx < 0) {
    throw new Error("Could not save changes: publication not found");
  }
  arr[idx] = _buildPubEntry(item, id);
  await MC.saveSection("publications", arr);
  return arr[idx];
}

async function apiDeletePublication(id) {
  const arr = await _loadPubsArray();
  const filtered = arr.filter(function (e) { return e.id !== id; });
  await MC.saveSection("publications", filtered);
  return true;
}

async function apiLoadOnePublication(id) {
  const arr = await _loadPubsArray();
  return arr.find(function (e) { return e.id === id; }) || null;
}

async function apiLoadPublications() {
  if (!MC.candidateId) return;

  let rows;
  try {
    rows = await _loadPubsArray();
  } catch (err) {
    console.error("Could not load publications:", err);
    return;
  }

  if (!rows || rows.length === 0) return;

  /* Defensive: reset in-memory state before pushing loaded entries.
     Without this, calling apiLoadPublications twice (e.g. via a
     future re-init path) would duplicate every publication. */
  publications = [];
  pubUid = 0;

  rows.forEach(r => {
    publications.push({
      uid        : ++pubUid,
      id         : r.id,                  /* client-generated UUID, used by edit/delete */
      type       : r.pub_type,
      title      : r.title,
      outlet     : r.outlet || null,
      year       : r.year ? String(r.year) : null,
      url        : r.url || null,
      description: r.description || null
    });
  });
  renderList();
  updateQuota();
}

/* ============================================================
   ADD or UPDATE — depending on EditState.mode
   ============================================================ */

async function addOrUpdatePub() {
  if (!validateForm()) return;

  const btn = $("addPubBtn");
  setLoading(btn, true);

  const item = buildItem();

  try {
    if (EditState.mode === "edit") {
      /* UPDATE */
      const updated = await apiUpdatePublication(EditState.editingId, item);

      /* Update in-memory list — preserve uid for stable references */
      const targetUid = EditState.editingUid;
      publications = publications.map(p => {
        if (p.uid !== targetUid) return p;
        return {
          uid        : p.uid,
          id         : updated.id,
          type       : updated.pub_type,
          title      : updated.title,
          outlet     : updated.outlet || null,
          year       : updated.year ? String(updated.year) : null,
          url        : updated.url || null,
          description: updated.description || null
        };
      });

      renderList();
      updateQuota();
      exitEditMode();
      if (window.SaveNow) SaveNow.clearDraft();
      setLoading(btn, false);
      showToast("Publication updated.", "success");

    } else {
      /* INSERT */
      const saved = await apiSavePublication(item);

      publications.push({
        uid        : ++pubUid,
        id         : saved.id,
        type       : saved.pub_type,
        title      : saved.title,
        outlet     : saved.outlet || null,
        year       : saved.year ? String(saved.year) : null,
        url        : saved.url || null,
        description: saved.description || null
      });

      renderList();
      updateQuota();
      resetForm();
      if (window.SaveNow) SaveNow.clearDraft();
      setLoading(btn, false);
      showToast("Publication added.", "success");
      $("pubType").focus();
    }
  } catch (err) {
    console.error("[publications] add/update failed:", err);
    showToast("Could not save. Your data is preserved — please try again.", "error");
    setLoading(btn, false);
  }
}

/* ============================================================
   SAVE & CONTINUE — navigate to next page (Volunteering)
   ============================================================ */

async function saveContinue() {
  /* Detect form input — ask user to add it or clear it */
  const hasFormInput = $("pubType").value
                    || trim($("pubTitle").value)
                    || trim($("pubOutlet").value)
                    || $("pubYear").value
                    || trim($("pubUrl").value)
                    || trim($("pubDesc").value);

  if (hasFormInput) {
    showPopup("You have unsaved publication details in the form. Please click \""
              + (EditState.mode === "edit" ? "Save Changes" : "+ Add to List")
              + "\" before continuing — or clear the form.");
    return;
  }

  /* If user got here with zero saved publications, offer Skip path
     instead of blocking. */
  if (publications.length === 0) {
    showPopup("You haven't added any publications. Please add at least one — or use the \"Skip section →\" button at the top if this section doesn't apply.");
    return;
  }

  if (window.SaveNow) SaveNow.clearDraft();

  MC.safeSet("publications_completed", "yes");
  MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

  window.parent.postMessage(
    { type: "navigate", page: "volunteering.html", sidebarKey: "Volunteering" },
    "*"
  );
}

/* ============================================================
   SKIP — section is optional, user opts out without saving
   ============================================================ */

function skipSection() {
  /* If form has input, warn before discarding */
  const hasFormInput = $("pubType").value
                    || trim($("pubTitle").value)
                    || trim($("pubOutlet").value)
                    || $("pubYear").value
                    || trim($("pubUrl").value)
                    || trim($("pubDesc").value);

  const proceedSkip = () => {
    if (window.SaveNow) SaveNow.clearDraft();

    MC.safeSet("publications_completed", "skipped");
    MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

    window.parent.postMessage(
      { type: "navigate", page: "volunteering.html", sidebarKey: "Volunteering" },
      "*"
    );
  };

  if (hasFormInput) {
    showConfirm(
      "You have unsaved input on this page.\n\n" +
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
   SAVENOW DRAFT — capture and restore (form only).
   Saved publications come from the backend; the draft only
   captures what's currently in the form.
   ============================================================ */

function capturePubDraft() {
  return {
    mode       : EditState.mode,
    editingId  : EditState.editingId,
    editingUid : EditState.editingUid,
    type       : $("pubType").value,
    title      : trim($("pubTitle").value),
    outlet     : trim($("pubOutlet").value),
    year       : $("pubYear").value,
    url        : trim($("pubUrl").value),
    description: trim($("pubDesc").value)
  };
}

function restorePubDraft(draft) {
  if (!draft) return false;

  /* Restore edit mode if the draft was mid-edit */
  if (draft.mode === "edit" && draft.editingId) {
    EditState.mode       = "edit";
    EditState.editingId  = draft.editingId;
    EditState.editingUid = draft.editingUid;
    applyEditModeUI();
  }

  if (draft.type)        $("pubType").value   = draft.type;
  if (draft.title)       $("pubTitle").value  = draft.title;
  if (draft.outlet)      $("pubOutlet").value = draft.outlet;
  if (draft.year)        $("pubYear").value   = draft.year;
  if (draft.url)         $("pubUrl").value    = draft.url;
  if (draft.description) $("pubDesc").value   = draft.description;
  MC.updateCounter($("pubTitle"), "pubTitleCounter");
  MC.updateCounter($("pubDesc"),  "pubDescCounter");
  return true;
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  populateYears();

  /* Char counters */
  $("pubTitle").addEventListener("input", () => {
    MC.updateCounter($("pubTitle"), "pubTitleCounter");
  });
  $("pubDesc").addEventListener("input", () => {
    MC.updateCounter($("pubDesc"), "pubDescCounter");
  });

  $("addPubBtn").addEventListener("click", addOrUpdatePub);
  $("saveContinueBtn").addEventListener("click", saveContinue);

  /* Cancel Edit button (hidden by default; shown in edit mode) */
  const cancelBtn = $("cancelEditBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => exitEditMode());

  /* Skip pill in header */
  const skipBtn = $("skipBtn");
  if (skipBtn) skipBtn.addEventListener("click", skipSection);

  /* Load existing data BEFORE SaveNow.init so the draft-restore
     check has the canonical state to compare against. */
  await apiLoadPublications();

  if (window.SaveNow) {
    SaveNow.init({
      pageName          : "publications",
      containerSelector : ".form-container",
      capturePayload    : capturePubDraft,
      restorePayload    : restorePubDraft,
      apiSave           : (p) => {
        /* Form draft only — saved publications persist independently
           through addOrUpdatePub(). Return resolved promise to satisfy
           SaveNow's contract without hitting the network. */
        return Promise.resolve({ ok: true });
      },
      isEmpty           : () => !$("pubType").value
                              && !trim($("pubTitle").value)
                              && !trim($("pubOutlet").value)
                              && !$("pubYear").value
                              && !trim($("pubUrl").value)
                              && !trim($("pubDesc").value)
    });
  }
});
