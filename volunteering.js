/* ============================================================
   MECULS — volunteering.js
   Volunteering & Social Contribution section logic.

   THIS IS THE FINAL PAGE in the profile-creation flow.
   - Submit Profile here sends {type:"submitted"} to the parent
     dashboard, which navigates to submission_complete.html.
   - Skip pill in header also fires {type:"submitted"} (skipping
     just means no volunteering data; the profile itself is
     still complete).

   Page structure:
     - Saved items list ABOVE form (visible progress, Edit/Delete
       per saved entry)
     - 6 fields per item: Role, Org, Cause, From, To/Ongoing,
       Description
     - Soft cap: 6 items

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `volunteering` table is gone.
     Volunteering entries now live as a JSONB array at
     profiles.data.volunteering (1-to-many). All five API functions
     rewritten to use MC.saveSection / MC.loadSection with the
     standard 1-to-many helper pattern from publications.js
     (_loadVolArray, _buildVolEntry, _newId).
   - Each entry has a client-generated `id` (UUID) instead of a
     server-assigned BIGSERIAL. The id is opaque to the page —
     enterEditMode / Delete / Update key off it the same way.
   - The internal entry shape preserves the prior server-column
     names (`organisation`, `from_year`, `to_year`, `is_ongoing`)
     so populateFormFromVol and addOrUpdateVol continue to work
     without callsite changes.
   - Validation popups consolidated into a single bullet popup
     (matches the pattern from skills, certifications, references,
     languages, preferences, ai_tools, consulting, key_achievements,
     mentorship, portfolio, publications).
   - window.confirm() replaced with MC.showConfirm in three places:
     mid-edit form-overwrite warning, delete confirmation, and
     skip-with-input warning. Visual styling now consistent.
   - apiLoadVolunteering resets the in-memory list before pushing,
     so re-running the loader cannot duplicate entries.
   - submitProfile() and skipSection() flow preserved — both still
     set localStorage flags and post {type:"submitted"} to parent
     dashboard so it navigates to submission_complete.html.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.VOLUNTEERING_VERSION === "phase1-step3" */
window.VOLUNTEERING_VERSION = "phase1-step3";

/* ── Config ── */
const MAX_ITEMS = 6;

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $           = MC.$;
const trim        = MC.trim;
const showPopup   = MC.showPopup;
const showToast   = MC.showToast;
const setLoading  = MC.setLoading;
const showConfirm = MC.showConfirm;

/* ── In-memory state — saved entries (already persisted to backend
   via + Add to List). Form holds the entry being added or edited. */
let volEntries = [];
let volUid     = 0;

/* ============================================================
   EDIT STATE — tracks whether form is in "add" or "edit" mode
   ============================================================ */

const EditState = {
  mode      : "add",   // "add" | "edit"
  editingId : null,    // database id of row being edited
  editingUid: null     // in-memory uid of the entry being edited
};

/* ============================================================
   POPULATE YEAR DROPDOWNS
   ============================================================ */

function populateYears() {
  const fromSel = $("volFrom");
  const toSel   = $("volTo");
  const current = new Date().getFullYear();

  for (let y = current; y >= 1970; y--) {
    const optFrom = document.createElement("option");
    optFrom.value = String(y);
    optFrom.textContent = String(y);
    fromSel.appendChild(optFrom);

    const optTo = document.createElement("option");
    optTo.value = String(y);
    optTo.textContent = String(y);
    toSel.appendChild(optTo);
  }
}

/* ============================================================
   QUOTA UPDATE
   ============================================================ */

function updateQuota() {
  const el = $("volCount");
  if (el) el.textContent = volEntries.length;
}

/* ============================================================
   RENDER SAVED LIST
   ============================================================ */

function renderList() {
  const list = $("volList");
  list.innerHTML = "";

  if (volEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "saved-list-empty";
    empty.textContent = "No volunteering added yet. Use the form below to add your first entry.";
    list.appendChild(empty);
    return;
  }

  const heading = document.createElement("h3");
  heading.className = "list-heading";
  heading.textContent = "Your Volunteering (" + volEntries.length + ")";
  list.appendChild(heading);

  volEntries.forEach(vol => {
    const card = document.createElement("div");
    card.className = "item-card item-card--accent-green";

    const body = document.createElement("div");
    body.className = "item-card__body";

    /* Badge row: cause + duration */
    const badgeRow = document.createElement("div");
    badgeRow.className = "item-card__badge-row";

    const causeBadge = document.createElement("span");
    causeBadge.className = "type-badge type-badge--green";
    causeBadge.textContent = vol.cause;
    badgeRow.appendChild(causeBadge);

    const duration = vol.to === "Ongoing" ? `${vol.from} – Ongoing`
                   : vol.from === vol.to  ? vol.from
                   : `${vol.from} – ${vol.to}`;
    const durationBadge = document.createElement("span");
    durationBadge.className = "type-badge type-badge--gray";
    durationBadge.style.marginLeft = "4px";
    durationBadge.textContent = duration;
    badgeRow.appendChild(durationBadge);

    body.appendChild(badgeRow);

    /* Role */
    const titleEl = document.createElement("div");
    titleEl.className = "item-card__title";
    titleEl.textContent = vol.role;
    body.appendChild(titleEl);

    /* Organisation */
    const orgEl = document.createElement("div");
    orgEl.className = "item-card__sub";
    orgEl.textContent = vol.org;
    body.appendChild(orgEl);

    /* Description */
    if (vol.description) {
      const descEl = document.createElement("div");
      descEl.className = "item-card__body-text";
      descEl.textContent = vol.description;
      body.appendChild(descEl);
    }

    card.appendChild(body);

    /* Actions: Edit + Delete (vertically stacked via .vol-actions) */
    const actions = document.createElement("div");
    actions.className = "item-card__actions vol-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "vol-card__btn vol-card__btn--edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => enterEditMode(vol));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "vol-card__btn vol-card__btn--delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => handleDeleteVolunteering(vol));
    actions.appendChild(deleteBtn);

    card.appendChild(actions);

    list.appendChild(card);
  });
}

/* ============================================================
   EDIT — enter edit mode for an existing entry
   ============================================================ */

async function enterEditMode(vol) {
  /* Block double-edit */
  if (EditState.mode === "edit") {
    showPopup("You're already editing another volunteering entry. Save or cancel that edit first.");
    return;
  }

  /* Warn if form has unsaved input */
  const formHasInput = trim($("volRole").value)
                    || trim($("volOrg").value)
                    || $("volCause").value
                    || $("volFrom").value
                    || $("volTo").value
                    || trim($("volDesc").value);

  /* Wrap the actual entry-into-edit-mode work in a callback so the
     MC.showConfirm flow can gate it cleanly (callback API can't be
     awaited inline). */
  const proceed = async () => {
    /* Defensive — if in-memory row has no id, fetch fresh */
    let row = vol;
    if (!row.id) {
      try {
        row = await apiLoadOneVolunteering(vol.id);
      } catch (err) {
        console.error("[volunteering] could not load row for edit:", err);
        showPopup("Could not load this entry for editing. Please refresh the page and try again.");
        return;
      }
      if (!row) {
        showPopup("This entry is no longer available. It may have been removed.");
        return;
      }
    }

    EditState.mode       = "edit";
    EditState.editingId  = row.id;
    EditState.editingUid = vol.uid;

    populateFormFromVol(row);
    applyEditModeUI();

    /* Scroll to form */
    const formCard = document.querySelector(".form-card");
    if (formCard) formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (formHasInput) {
    showConfirm(
      "You have unsaved input in the form.\n\n" +
      "Discard it and edit the saved entry instead?",
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
  const addBtn      = $("addVolBtn");
  const cancelBtn   = $("cancelEditBtn");
  const cardHeading = document.querySelector(".form-card .card-heading");

  if (EditState.mode === "edit") {
    addBtn.textContent = "Save Changes";
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    if (cardHeading) cardHeading.textContent = "Edit Volunteering Entry";
  } else {
    addBtn.textContent = "+ Add to List";
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (cardHeading) cardHeading.textContent = "Add Volunteering / Social Contribution";
  }
}

function populateFormFromVol(vol) {
  /* When loading from DB, fields are: role, organisation, cause,
     from_year, to_year, is_ongoing, description.
     When loading from in-memory, fields are: role, org, cause,
     from, to, description. Handle both. */
  $("volRole").value = vol.role || "";
  $("volOrg").value  = vol.organisation || vol.org || "";
  $("volCause").value = vol.cause || "";

  if (vol.from_year != null) {
    $("volFrom").value = String(vol.from_year);
    $("volTo").value   = vol.is_ongoing ? "Ongoing"
                       : (vol.to_year != null ? String(vol.to_year) : "");
  } else {
    $("volFrom").value = vol.from || "";
    $("volTo").value   = vol.to || "";
  }

  $("volDesc").value = vol.description || "";

  MC.updateCounter($("volRole"), "volRoleCounter");
  MC.updateCounter($("volOrg"),  "volOrgCounter");
  MC.updateCounter($("volDesc"), "volDescCounter");
}

/* ============================================================
   DELETE — confirm and delete a volunteering entry
   ============================================================ */

async function handleDeleteVolunteering(vol) {
  const label = vol.role && vol.org ? `"${vol.role} at ${vol.org}"` : "this volunteering entry";
  const message = `Delete ${label}? This cannot be undone.`;

  /* MC.showConfirm uses a callback API — the deletion happens inside
     the onConfirm callback. Same pattern used on key_achievements,
     portfolio, publications, mentorship, etc. */
  showConfirm(
    message,
    async function () {
      try {
        await apiDeleteVolunteering(vol.id);
      } catch (err) {
        console.error("[volunteering] delete failed:", err);
        showPopup("Could not delete this entry. Please check your connection and try again.");
        return;
      }

      volEntries = volEntries.filter(v => v.uid !== vol.uid);

      /* If we were editing this one, exit edit mode */
      if (EditState.mode === "edit" && EditState.editingUid === vol.uid) {
        exitEditMode();
      }

      renderList();
      updateQuota();
      showToast("Volunteering entry deleted.", "success");
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
  if (EditState.mode === "add" && volEntries.length >= MAX_ITEMS) {
    showPopup("You have reached the maximum of " + MAX_ITEMS +
              " volunteering entries. Remove one to add another.");
    return false;
  }

  const role  = trim($("volRole").value);
  const org   = trim($("volOrg").value);
  const cause = $("volCause").value;
  const from  = $("volFrom").value;
  const desc  = trim($("volDesc").value);

  /* Consolidated missing-field check. To/Ongoing is optional.
     Required fields: Role, Org, Cause, From, Description. */
  const missing = [];
  if (!role)  missing.push("Your Role / Title");
  if (!org)   missing.push("Organisation / Initiative Name");
  if (!cause) missing.push("Cause / Area");
  if (!from)  missing.push("From (start year)");
  if (!desc)  missing.push("What did you do?");

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
    if (!role)       $("volRole").focus();
    else if (!org)   $("volOrg").focus();
    else if (!cause) $("volCause").focus();
    else if (!from)  $("volFrom").focus();
    else if (!desc)  $("volDesc").focus();
    return false;
  }

  return true;
}

/* ============================================================
   BUILD ITEM (for save / update)
   ============================================================ */

function buildItem() {
  return {
    role       : trim($("volRole").value),
    org        : trim($("volOrg").value),
    cause      : $("volCause").value,
    from       : $("volFrom").value,
    to         : $("volTo").value || "Ongoing",
    description: trim($("volDesc").value)
  };
}

/* ============================================================
   RESET FORM
   ============================================================ */

function resetForm() {
  $("volRole").value  = "";
  $("volOrg").value   = "";
  $("volCause").value = "";
  $("volFrom").value  = "";
  $("volTo").value    = "";
  $("volDesc").value  = "";
  MC.updateCounter($("volRole"), "volRoleCounter");
  MC.updateCounter($("volOrg"),  "volOrgCounter");
  MC.updateCounter($("volDesc"), "volDescCounter");
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `volunteering` table is gone. Volunteering entries
   now live as a JSONB array at profiles.data.volunteering
   (1-to-many). Save/load go through MC.saveSection /
   MC.loadSection which handle auth and RLS server-side via the
   save_profile_section RPC.

   Internal helpers:
   - _loadVolArray: fetch the section, default to []
   - _buildVolEntry: shape the payload into the canonical row form
   - _newId: generate a stable client-side id for a new entry

   The entry shape preserves the prior server convention
   (`organisation`, `from_year`, `to_year`, `is_ongoing`) so the
   rest of the page works without callsite changes.
   ============================================================ */

/* ── Internal: load the volunteering array, default to []. ── */
async function _loadVolArray() {
  const arr = await MC.loadSection("volunteering");
  return Array.isArray(arr) ? arr : [];
}

/* ── Internal: shape the payload into a canonical entry.
   Preserves existing id on update, generates a new one on insert. ── */
function _buildVolEntry(payload, existingId) {
  return {
    id           : existingId || _newId(),
    role         : payload.role || null,
    organisation : payload.org  || null,
    cause        : payload.cause || null,
    from_year    : payload.from ? Number(payload.from) : null,
    to_year      : payload.to === "Ongoing" ? null
                 : (payload.to ? Number(payload.to) : null),
    is_ongoing   : payload.to === "Ongoing",
    description  : payload.description || null
  };
}

/* ── Internal: generate a unique id for a new entry.
   Replaces the old database BIGSERIAL. crypto.randomUUID() in modern
   browsers; timestamp+random hybrid fallback for ancient browsers. ── */
function _newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "vol-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

async function apiSaveVolunteering(item) {
  const arr = await _loadVolArray();
  const entry = _buildVolEntry(item, null);
  arr.push(entry);
  await MC.saveSection("volunteering", arr);
  return entry;
}

async function apiUpdateVolunteering(id, item) {
  const arr = await _loadVolArray();
  const idx = arr.findIndex(function (e) { return e.id === id; });
  if (idx < 0) {
    throw new Error("Could not save changes: volunteering entry not found");
  }
  arr[idx] = _buildVolEntry(item, id);
  await MC.saveSection("volunteering", arr);
  return arr[idx];
}

async function apiDeleteVolunteering(id) {
  const arr = await _loadVolArray();
  const filtered = arr.filter(function (e) { return e.id !== id; });
  await MC.saveSection("volunteering", filtered);
  return true;
}

async function apiLoadOneVolunteering(id) {
  const arr = await _loadVolArray();
  return arr.find(function (e) { return e.id === id; }) || null;
}

async function apiLoadVolunteering() {
  if (!MC.candidateId) return;

  let rows;
  try {
    rows = await _loadVolArray();
  } catch (err) {
    console.error("Could not load volunteering:", err);
    return;
  }

  if (!rows || rows.length === 0) return;

  /* Defensive: reset in-memory state before pushing loaded entries.
     Without this, calling apiLoadVolunteering twice (e.g. via a
     future re-init path) would duplicate every entry. */
  volEntries = [];
  volUid = 0;

  rows.forEach(r => {
    volEntries.push({
      uid        : ++volUid,
      id         : r.id,                  /* client-generated UUID, used by edit/delete */
      role       : r.role,
      org        : r.organisation,
      cause      : r.cause,
      from       : r.from_year != null ? String(r.from_year) : "",
      to         : r.is_ongoing ? "Ongoing"
                   : (r.to_year != null ? String(r.to_year) : ""),
      description: r.description
    });
  });
  renderList();
  updateQuota();
}

/* ============================================================
   ADD or UPDATE — depending on EditState.mode
   ============================================================ */

async function addOrUpdateVol() {
  if (!validateForm()) return;

  const btn = $("addVolBtn");
  setLoading(btn, true);

  const item = buildItem();

  try {
    if (EditState.mode === "edit") {
      /* UPDATE */
      const updated = await apiUpdateVolunteering(EditState.editingId, item);

      const targetUid = EditState.editingUid;
      volEntries = volEntries.map(v => {
        if (v.uid !== targetUid) return v;
        return {
          uid        : v.uid,
          id         : updated.id,
          role       : updated.role,
          org        : updated.organisation,
          cause      : updated.cause,
          from       : String(updated.from_year),
          to         : updated.is_ongoing ? "Ongoing"
                       : (updated.to_year != null ? String(updated.to_year) : ""),
          description: updated.description
        };
      });

      renderList();
      updateQuota();
      exitEditMode();
      if (window.SaveNow) SaveNow.clearDraft();
      setLoading(btn, false);
      showToast("Volunteering entry updated.", "success");

    } else {
      /* INSERT */
      const saved = await apiSaveVolunteering(item);

      volEntries.push({
        uid        : ++volUid,
        id         : saved.id,
        role       : saved.role,
        org        : saved.organisation,
        cause      : saved.cause,
        from       : String(saved.from_year),
        to         : saved.is_ongoing ? "Ongoing"
                     : (saved.to_year != null ? String(saved.to_year) : ""),
        description: saved.description
      });

      renderList();
      updateQuota();
      resetForm();
      if (window.SaveNow) SaveNow.clearDraft();
      setLoading(btn, false);
      showToast("Volunteering entry added.", "success");
      $("volRole").focus();
    }
  } catch (err) {
    console.error("[volunteering] add/update failed:", err);
    showToast("Could not save. Your data is preserved — please try again.", "error");
    setLoading(btn, false);
  }
}

/* ============================================================
   SUBMIT PROFILE — final action of the entire profile flow.
   Sends {type:"submitted"} to the parent dashboard, which then
   loads submission_complete.html.
   ============================================================ */

async function submitProfile() {
  /* Detect form input — ask user to add it or clear it */
  const hasFormInput = trim($("volRole").value)
                    || trim($("volOrg").value)
                    || $("volCause").value
                    || $("volFrom").value
                    || trim($("volDesc").value);

  if (hasFormInput) {
    showPopup("You have unsaved volunteering details in the form. Please click \""
              + (EditState.mode === "edit" ? "Save Changes" : "+ Add to List")
              + "\" before submitting — or clear the form. You can also use \"Skip section →\" at the top to submit without volunteering.");
    return;
  }

  /* Submit is allowed with zero entries — Skip pill does the same thing */
  const btn = $("saveContinueBtn");
  setLoading(btn, true);
  btn.textContent = "Submitting…";

  if (window.SaveNow) SaveNow.clearDraft();

  /* Mark volunteering completed (or skipped if no entries) and
     mark the profile as submitted */
  MC.safeSet("volunteering_completed", volEntries.length > 0 ? "yes" : "skipped");
  MC.safeSet("profile_submitted", "yes");
  MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

  /* Tell parent dashboard the profile has been fully submitted */
  window.parent.postMessage({ type: "submitted" }, "*");

  setTimeout(() => { setLoading(btn, false); btn.textContent = "Submit Profile"; }, 800);
}

/* ============================================================
   SKIP — also submits the profile (no volunteering added)
   ============================================================ */

function skipSection() {
  /* If form has input, warn before discarding */
  const hasFormInput = trim($("volRole").value)
                    || trim($("volOrg").value)
                    || $("volCause").value
                    || $("volFrom").value
                    || trim($("volDesc").value);

  /* The post-confirm work is wrapped in a callback so MC.showConfirm
     can gate it. This is the FINAL navigation in the build flow —
     posts {type:"submitted"} which the parent dashboard listens for
     to load submission_complete.html. */
  const proceedSkip = () => {
    if (window.SaveNow) SaveNow.clearDraft();

    MC.safeSet("volunteering_completed", "skipped");
    MC.safeSet("profile_submitted", "yes");
    MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

    window.parent.postMessage({ type: "submitted" }, "*");
  };

  if (hasFormInput) {
    showConfirm(
      "You have unsaved input in the form.\n\n" +
      "If you skip and submit, your typed data will be discarded.\n\n" +
      "Are you sure you want to skip and submit your profile?",
      proceedSkip,
      {
        confirmLabel: "Yes, skip and submit",
        cancelLabel:  "Go back"
      }
    );
    return;
  }

  proceedSkip();
}

/* ============================================================
   SAVENOW DRAFT — capture and restore (form only).
   Saved entries come from the backend; the draft only captures
   what's currently in the form.
   ============================================================ */

function captureVolDraft() {
  return {
    mode       : EditState.mode,
    editingId  : EditState.editingId,
    editingUid : EditState.editingUid,
    role       : trim($("volRole").value),
    org        : trim($("volOrg").value),
    cause      : $("volCause").value,
    from       : $("volFrom").value,
    to         : $("volTo").value,
    description: trim($("volDesc").value)
  };
}

function restoreVolDraft(draft) {
  if (!draft) return false;

  /* Restore edit mode if the draft was mid-edit */
  if (draft.mode === "edit" && draft.editingId) {
    EditState.mode       = "edit";
    EditState.editingId  = draft.editingId;
    EditState.editingUid = draft.editingUid;
    applyEditModeUI();
  }

  if (draft.role)        $("volRole").value  = draft.role;
  if (draft.org)         $("volOrg").value   = draft.org;
  if (draft.cause)       $("volCause").value = draft.cause;
  if (draft.from)        $("volFrom").value  = draft.from;
  if (draft.to)          $("volTo").value    = draft.to;
  if (draft.description) $("volDesc").value  = draft.description;
  MC.updateCounter($("volRole"), "volRoleCounter");
  MC.updateCounter($("volOrg"),  "volOrgCounter");
  MC.updateCounter($("volDesc"), "volDescCounter");
  return true;
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  populateYears();

  /* Char counters */
  $("volRole").addEventListener("input", () => {
    MC.updateCounter($("volRole"), "volRoleCounter");
  });
  $("volOrg").addEventListener("input", () => {
    MC.updateCounter($("volOrg"), "volOrgCounter");
  });
  $("volDesc").addEventListener("input", () => {
    MC.updateCounter($("volDesc"), "volDescCounter");
  });

  $("addVolBtn").addEventListener("click", addOrUpdateVol);
  $("saveContinueBtn").addEventListener("click", submitProfile);

  /* Cancel Edit button (hidden by default; shown in edit mode) */
  const cancelBtn = $("cancelEditBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => exitEditMode());

  /* Skip pill in header */
  const skipBtn = $("skipBtn");
  if (skipBtn) skipBtn.addEventListener("click", skipSection);

  /* Load existing data BEFORE SaveNow.init */
  await apiLoadVolunteering();

  if (window.SaveNow) {
    SaveNow.init({
      pageName          : "volunteering",
      containerSelector : ".form-container",
      capturePayload    : captureVolDraft,
      restorePayload    : restoreVolDraft,
      apiSave           : (p) => {
        /* Form draft only — saved entries persist independently
           through addOrUpdateVol(). Resolved promise satisfies
           SaveNow's contract without hitting the network. */
        return Promise.resolve({ ok: true });
      },
      isEmpty           : () => !trim($("volRole").value)
                              && !trim($("volOrg").value)
                              && !$("volCause").value
                              && !$("volFrom").value
                              && !trim($("volDesc").value)
    });
  }
});
