/* ============================================================
   MECULS — references.js
   References section logic. Polished onto the shared architecture:
     - MC.* helpers (no local copies of showPopup/showToast/setLoading
       /isValidEmail/isValidMobile/isValidCountryCode)
     - SaveNow draft-restore for the in-progress form (NOT the saved
       references list — that lives on the backend after each Add)
     - candidateId read fresh from MC.candidateId at save/load time
   All fields mandatory. Mobile = country code + number.
   Email validated for @ and format.
   Max 2 per type enforced with live quota tracker.
   postMessage navigation to parent dashboard.

   Bugs fixed in this polish pass:
   - XSS via ref.name/organization/title/email/mobile interpolated into
     innerHTML in renderReferenceList. Fixed with safe DOM construction
     using textContent everywhere.
   - Silent failure: clicking "Add Reference to List" with the Name
     field empty returned null with no popup, leaving the user
     wondering why nothing happened. Now shows a clear popup.
   - apiLoadReferences ran without checking MC.candidateId, fetching
     /candidate/references/null when not logged in. Now guarded.
   - parseInt without radix on data-uid attribute reads.

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `candidate_references` table is gone.
     References now live as a JSONB array at profiles.data.references.
     All five API functions rewritten to use MC.saveSection /
     MC.loadSection with the standard 1-to-many helper pattern
     (_loadReferencesArray, _buildReferenceEntry, _newId).
   - Generic per-validation popup replaced with consolidated
     bullet-list popup (matches skills, profile_category,
     professional_introduction, certifications).
   - Save & Continue now auto-adds a mid-form entry if the user
     filled the fields but forgot to click "Add Reference to List".
     Mirrors the certifications.js pattern. Without this, typed-but-
     not-added data is lost on navigate-away.
   - Defensive: loadReferences clears the in-memory list before
     repopulating, so a re-entry into the page can't duplicate rows.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.REFERENCES_VERSION === "phase1-step3" */
window.REFERENCES_VERSION = "phase1-step3";

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $                  = MC.$;
const trim               = MC.trim;
const showPopup          = MC.showPopup;
const showToast          = MC.showToast;
const setLoading         = MC.setLoading;
const isValidEmail       = MC.isValidEmail;
const isValidMobile      = MC.isValidMobile;
const isValidCountryCode = MC.isValidCountryCode;

/* ── In-memory state ──
   Each entry: { uid, reference_type, name, organization,
                 title, country_code, mobile, email, reference_id }
   uid is stable — not the array index — so remove is safe.
─────────────────────────────────────────────────────────────── */
let references = [];
let refUid     = 0;

/* ── Quota limits ── */
const MAX_PER_TYPE = 2;

/* ============================================================
   QUOTA TRACKER — updates the Academic / Industry counters
   ============================================================ */

function updateQuotaBadges() {
  const academicCount = references.filter(r => r.reference_type === "Academic").length;
  const industryCount = references.filter(r => r.reference_type === "Industry").length;

  $("academicCount").textContent = academicCount;
  $("industryCount").textContent = industryCount;
}

/* ============================================================
   RENDER SAVED REFERENCES LIST — XSS-safe DOM construction
   ============================================================ */

function renderReferenceList() {
  const list = $("reference-list");
  list.innerHTML = "";  /* static wipe — safe */

  /* Hide saved-list while editing — focused on one entry. */
  if (EditState.mode === "edit") {
    updateQuotaBadges();
    return;
  }

  if (references.length === 0) {
    updateQuotaBadges();
    return;
  }

  const heading = document.createElement("h3");
  heading.className = "ref-list-heading";
  heading.textContent = "Saved References";
  list.appendChild(heading);

  references.forEach(ref => {
    const card = document.createElement("div");
    card.className = "ref-card";

    /* Body (left side) — clickable area for Edit */
    const body = document.createElement("div");
    body.className = "ref-card__body";
    body.style.cursor = "pointer";
    body.addEventListener("click", () => enterEditMode(ref));

    /* Type badge (Academic | Industry) */
    const typeBadge = document.createElement("span");
    typeBadge.className =
      "ref-card__type ref-card__type--" + ref.reference_type;
    typeBadge.textContent = ref.reference_type;
    body.appendChild(typeBadge);

    /* Name */
    const nameDiv = document.createElement("div");
    nameDiv.className = "ref-card__name";
    nameDiv.textContent = ref.name;
    body.appendChild(nameDiv);

    /* Organisation */
    const orgDiv = document.createElement("div");
    orgDiv.className = "ref-card__org";
    orgDiv.textContent = ref.organization;
    body.appendChild(orgDiv);

    /* Title / Designation */
    const titleDiv = document.createElement("div");
    titleDiv.className = "ref-card__title";
    titleDiv.textContent = ref.title;
    body.appendChild(titleDiv);

    /* Contact (mobile + email side by side) */
    const contactDiv = document.createElement("div");
    contactDiv.className = "ref-card__contact";

    const mobileSpan = document.createElement("span");
    mobileSpan.textContent = "\u260E " + ref.country_code + " " + ref.mobile;
    contactDiv.appendChild(mobileSpan);

    const emailSpan = document.createElement("span");
    emailSpan.textContent = "\u2709 " + ref.email;
    contactDiv.appendChild(emailSpan);

    body.appendChild(contactDiv);
    card.appendChild(body);

    /* Actions (right side) — Edit + Delete */
    const actions = document.createElement("div");
    actions.className = "ref-card__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "ref-card__btn ref-card__btn--edit";
    editBtn.textContent = "Edit";
    editBtn.setAttribute("data-uid", String(ref.uid));
    editBtn.addEventListener("click", e => {
      e.stopPropagation();
      enterEditMode(ref);
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ref-card__btn ref-card__btn--delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.setAttribute("data-uid", String(ref.uid));
    deleteBtn.addEventListener("click", e => {
      e.stopPropagation();
      removeReference(ref.uid);
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    list.appendChild(card);
  });

  updateQuotaBadges();
}

/* ============================================================
   REMOVE REFERENCE — now actually deletes from Supabase
   ============================================================
   Confirms with user, calls apiDeleteReference, then removes from
   in-memory list. Previously this only mutated the in-memory list
   and the deleted reference came back on next page load — that bug
   is fixed here. */

async function removeReference(uid) {
  const ref = references.find(r => r.uid === uid);
  if (!ref) return;

  /* If somehow we have a row without an id (legacy draft etc.),
     fall back to in-memory removal only. */
  if (!ref.id) {
    references = references.filter(r => r.uid !== uid);
    renderReferenceList();
    return;
  }

  const refDesc = (trim(ref.name || "") || "this reference") +
                  (ref.organization ? " from " + trim(ref.organization) : "");
  const message = "Remove " + refDesc + "?\n\n" +
                  "This will permanently remove this reference from your " +
                  "profile. This cannot be undone.";

  if (!window.confirm(message)) return;

  try {
    await apiDeleteReference(ref.id);
  } catch (err) {
    showToast("Could not remove reference. Please try again.", "error");
    return;
  }

  /* Backend confirmed — remove from in-memory list and re-render */
  references = references.filter(r => r.uid !== uid);
  renderReferenceList();
  showToast("Reference removed.", "success");
}

/* ============================================================
   EDIT MODE
   ============================================================ */

async function enterEditMode(ref) {
  /* If we don't have full row data (defensive — shouldn't happen
     since loadReferences fetches everything), fetch it. */
  let row = ref;
  if (!row.id) {
    showToast("Could not find that reference.", "error");
    return;
  }
  if (row.name === undefined || row.organization === undefined) {
    try {
      row = await apiLoadOneReference(ref.id);
    } catch (err) {
      showToast("Could not load that reference. Please try again.", "error");
      return;
    }
  }

  EditState.mode      = "edit";
  EditState.editingId = row.id;

  populateFormFromRow(row);
  applyEditModeUI();
  renderReferenceList();   /* hides during edit */

  /* Scroll the form into view so user sees the populated fields */
  const formCard = $("addReferenceBtn").closest(".form-card");
  if (formCard) {
    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function exitEditMode(opts) {
  EditState.mode      = "create";
  EditState.editingId = null;
  applyEditModeUI();
  clearFormFields();
  renderReferenceList();   /* re-shows saved list */
  if (!opts || !opts.silent) {
    /* If user clicked Cancel (not Save Changes), don't show a toast. */
  }
}

function applyEditModeUI() {
  const addBtn    = $("addReferenceBtn");
  const cancelBtn = $("cancelEditRefBtn");
  const heading   = document.querySelector(".form-card .card-heading");

  if (EditState.mode === "edit") {
    if (addBtn)    addBtn.textContent = "Save Changes";
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    if (heading)   heading.textContent = "Edit Reference";
  } else {
    if (addBtn)    addBtn.textContent = "+ Add Reference to List";
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (heading)   heading.textContent = "Add a Reference";
  }
}

function populateFormFromRow(r) {
  const setVal = (id, val) => {
    const el = $(id);
    if (!el) return;
    el.value = (val === null || val === undefined) ? "" : val;
  };
  setVal("referenceType",  r.reference_type);
  setVal("refName",        r.name);
  setVal("refOrg",         r.organization);
  setVal("refTitle",       r.title);
  setVal("refCountryCode", r.country_code || "+91");
  setVal("refMobile",      r.mobile);
  setVal("refEmail",       r.email);
}

/* ============================================================
   VALIDATE ADD REFERENCE FORM
   Returns { fields } or null. On null, a popup has already been shown.
   ============================================================ */

function validateAddForm() {
  const refType    = $("referenceType").value;
  const name       = trim($("refName").value);
  const org        = trim($("refOrg").value);
  const title      = trim($("refTitle").value);
  const countryCode= trim($("refCountryCode").value);
  const mobile     = trim($("refMobile").value);
  const email      = trim($("refEmail").value);

  /* (1) Collect ALL missing required fields and surface them
     together so the user fixes everything in one pass — matches
     the consolidated-popup pattern used on skills, profile_category,
     professional_introduction, certifications. */
  const missing = [];
  if (!refType)     missing.push("Reference Type");
  if (!name)        missing.push("Full Name");
  if (!org)         missing.push("Organisation / Institution");
  if (!title)       missing.push("Designation / Title");
  if (!countryCode) missing.push("Country Code");
  if (!mobile)      missing.push("Mobile Number");
  if (!email)       missing.push("Email Address");

  if (missing.length > 0) {
    showPopup(
      "Please fill the following before adding this reference:\n\n\u2022 " +
      missing.join("\n\u2022 ")
    );
    /* Focus the first missing field so the user can start fixing
       immediately. Map the friendly label back to the input id. */
    const focusMap = {
      "Reference Type"             : "referenceType",
      "Full Name"                  : "refName",
      "Organisation / Institution" : "refOrg",
      "Designation / Title"        : "refTitle",
      "Country Code"               : "refCountryCode",
      "Mobile Number"              : "refMobile",
      "Email Address"              : "refEmail"
    };
    const firstId = focusMap[missing[0]];
    if (firstId && $(firstId)) $(firstId).focus();
    return null;
  }

  /* (2) Quota check — only after all fields are present, so the user
     doesn't hit "quota full" before they realise the form is incomplete.
     In edit mode, exclude the row being edited from the count so
     editing an existing reference at the cap doesn't get blocked. */
  const countByType = references.filter(r => {
    if (EditState.mode === "edit" && r.id === EditState.editingId) return false;
    return r.reference_type === refType;
  }).length;
  if (countByType >= MAX_PER_TYPE) {
    showPopup(
      "You can only add " + MAX_PER_TYPE + " " + refType +
      " references. Remove an existing one to add a different person."
    );
    return null;
  }

  /* (3) Format checks — these need specific messages so they stay
     as separate popups (one rule per popup). */
  if (!isValidCountryCode(countryCode)) {
    showPopup("Country code must start with + followed by digits (e.g. +91, +1, +44).");
    $("refCountryCode").focus();
    return null;
  }

  if (!isValidMobile(mobile)) {
    showPopup("Please enter a valid mobile number (6\u201315 digits).");
    $("refMobile").focus();
    return null;
  }

  if (!email.includes("@")) {
    showPopup("Email address must contain the @ symbol.");
    $("refEmail").focus();
    return null;
  }

  if (!isValidEmail(email)) {
    showPopup("Please enter a valid email address (e.g. name@organisation.com).");
    $("refEmail").focus();
    return null;
  }

  /* (4) Duplicate check — same name + org + type, case-insensitive.
     In edit mode, exclude the row being edited so saving the same
     reference unchanged isn't flagged as a duplicate. */
  const isDuplicate = references.some(r => {
    if (EditState.mode === "edit" && r.id === EditState.editingId) return false;
    return r.name.toLowerCase() === name.toLowerCase() &&
           r.organization.toLowerCase() === org.toLowerCase() &&
           r.reference_type === refType;
  });
  if (isDuplicate) {
    showPopup(name + " from " + org +
              " is already in your " + refType + " references list.");
    return null;
  }

  return { refType, name, org, title, countryCode, mobile, email };
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `candidate_references` table is gone. References now
   live as a JSONB array at profiles.data.references, mirroring the
   experiences / certifications pattern. Each entry has a
   client-generated `id` (UUID) replacing the old database BIGSERIAL.

   Internal helpers:
   - _loadReferencesArray: fetch the section, default to []
   - _buildReferenceEntry: shape the payload into the canonical row form
   - _newId: generate a stable client-side id

   Public API (apiSave/Load/Update/Delete) keeps the same names
   and signatures so the rest of the page doesn't change.

   Note: 'references' is a reserved word in PostgreSQL but that's
   irrelevant here — we're storing under JSONB key, not as a table
   name. The legacy table was named candidate_references for that
   reason; the JSONB section can simply be "references".
   ============================================================ */

/* ── Internal: load the references array, default to []. ── */
async function _loadReferencesArray() {
  const arr = await MC.loadSection("references");
  return Array.isArray(arr) ? arr : [];
}

/* ── Internal: shape the payload into a canonical entry.
   Preserves existing id on update, generates a new one on insert. ── */
function _buildReferenceEntry(payload, existingId) {
  return {
    id            : existingId || _newId(),
    reference_type: payload.reference_type || null,
    name          : payload.name           || null,
    organization  : payload.organization   || null,
    title         : payload.title          || null,
    country_code  : payload.country_code   || null,
    mobile        : payload.mobile         || null,
    email         : payload.email          || null
  };
}

/* ── Internal: generate a unique id for a new entry. ── */
function _newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "ref-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

async function apiSaveReference(payload) {
  const arr = await _loadReferencesArray();
  const entry = _buildReferenceEntry(payload, null);
  arr.push(entry);
  await MC.saveSection("references", arr);
  return entry;
}

/* Load ALL references for the current candidate. Order is preserved
   from the JSONB array (insertion order). */
async function apiLoadReferences() {
  return await _loadReferencesArray();
}

/* Load ONE reference by client-side id. */
async function apiLoadOneReference(id) {
  const arr = await _loadReferencesArray();
  return arr.find(function (e) { return e.id === id; }) || null;
}

/* Update an existing reference by id. The whole entry is rebuilt
   from the payload (preserving the original id). */
async function apiUpdateReference(id, payload) {
  const arr = await _loadReferencesArray();
  const idx = arr.findIndex(function (e) { return e.id === id; });
  if (idx < 0) {
    throw new Error("Could not save changes: reference not found");
  }
  arr[idx] = _buildReferenceEntry(payload, id);
  await MC.saveSection("references", arr);
  return arr[idx];
}

/* Delete a reference by id. */
async function apiDeleteReference(id) {
  const arr = await _loadReferencesArray();
  const filtered = arr.filter(function (e) { return e.id !== id; });
  await MC.saveSection("references", filtered);
  return true;
}

/* ── Edit-mode state ──
   Tracks whether we're creating a new reference or editing an
   existing one. Mirrors EditState pattern from experience.js,
   education.js, certifications.js. */
const EditState = {
  mode      : "create",   // "create" | "edit"
  editingId : null        // database row id being edited
};

/* ============================================================
   ADD REFERENCE
   ============================================================ */

async function addReference() {
  const validated = validateAddForm();
  if (!validated) return;

  const { refType, name, org, title, countryCode, mobile, email } = validated;

  const addBtn = $("addReferenceBtn");
  setLoading(addBtn, true);

  const payload = {
    reference_type: refType,
    name,
    organization  : org,
    title,
    country_code  : countryCode,
    mobile,
    email
  };

  /* ─── EDIT MODE: UPDATE existing row ─── */
  if (EditState.mode === "edit" && EditState.editingId) {
    try {
      await apiUpdateReference(EditState.editingId, payload);
    } catch (err) {
      console.error("Reference update failed:", err);
      showToast("Could not save changes. Please try again.", "error");
      setLoading(addBtn, false);
      return;
    }

    /* Update the in-memory row in place */
    const idx = references.findIndex(r => r.id === EditState.editingId);
    if (idx !== -1) {
      references[idx] = Object.assign({}, references[idx], payload);
    }

    /* Exit edit mode and re-render */
    exitEditMode({ silent: true });
    setLoading(addBtn, false);
    showToast("Reference updated.", "success");
    return;
  }

  /* ─── CREATE MODE: INSERT new row ─── */
  let savedRow;
  try {
    savedRow = await apiSaveReference(payload);
  } catch (err) {
    console.error("Reference save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(addBtn, false);
    return;
  }

  /* Add to in-memory list — store the server-assigned id so later
     edit/delete can target this exact row. */
  references.push({
    uid           : ++refUid,
    id            : savedRow.id,
    reference_type: refType,
    name,
    organization  : org,
    title,
    country_code  : countryCode,
    mobile,
    email
  });

  /* Clear form inputs */
  clearFormFields();

  renderReferenceList();
  setLoading(addBtn, false);

  /* The form was cleared — drop any in-progress draft. */
  if (window.SaveNow) SaveNow.clearDraft();

  /* Scroll the blank form into view so user sees it's ready for the next entry */
  const formCard = addBtn.closest(".form-card");
  if (formCard) {
    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  /* Focus first field so user can type immediately */
  setTimeout(() => $("referenceType").focus(), 350);

  showToast("Reference added successfully.", "success");
}

/* Helper — clear all fields in the form (used on add and after edit). */
function clearFormFields() {
  $("referenceType").value  = "";
  $("refName").value        = "";
  $("refOrg").value         = "";
  $("refTitle").value       = "";
  $("refCountryCode").value = "+91";
  $("refMobile").value      = "";
  $("refEmail").value       = "";
}

/* ============================================================
   SAVE & CONTINUE
   References are saved one-at-a-time in addReference. This button:
     - Auto-adds mid-form data if the user filled the fields but
       forgot to click "Add Reference to List". Without this, that
       typed data would be lost on navigate-away.
     - Requires at least one saved reference before continuing.
     - Sets the completion flag and navigates to Preferences.
   Mirrors the certifications.js handleSaveContinue pattern.
   ============================================================ */

async function saveContinue() {
  const saveBtn = $("saveContinueBtn");

  /* If the user is in edit mode, the form holds an existing entry —
     don't try to "add" it. Tell them to commit the edit first. */
  if (EditState.mode === "edit") {
    showPopup(
      "You are currently editing a reference. Please click \"Save Changes\" " +
      "or \"Cancel Edit\" before continuing."
    );
    return;
  }

  /* Detect mid-form input. If any field has content, treat it as a
     forgotten Add and try to validate + save it before continuing. */
  const hasAnyInput =
    $("referenceType").value                              ||
    trim($("refName").value)                              ||
    trim($("refOrg").value)                               ||
    trim($("refTitle").value)                             ||
    /* Country code defaults to "+91" — only counts as input if
       the user typed something OTHER than the default, OR there's
       data in mobile/email which makes country code relevant. */
    trim($("refMobile").value)                            ||
    trim($("refEmail").value);

  if (hasAnyInput) {
    /* Run the same validation/save flow as the Add button. If
       validation fails, addReference shows the popup and returns
       — we stay on this page so the user can fix it. */
    setLoading(saveBtn, true);
    try {
      await addReference();
    } finally {
      setLoading(saveBtn, false);
    }
    /* If addReference failed validation OR the API call, the form is
       NOT cleared (clearFormFields only runs on success). Detect this
       and stay on the page so the user can correct things. */
    const stillHasInput =
      $("referenceType").value                ||
      trim($("refName").value)                ||
      trim($("refOrg").value)                 ||
      trim($("refTitle").value)               ||
      trim($("refMobile").value)              ||
      trim($("refEmail").value);
    if (stillHasInput) return;
  }

  /* At least one reference required before continuing. */
  if (references.length === 0) {
    showPopup("Please add at least one reference before continuing.");
    return;
  }

  setLoading(saveBtn, true);

  localStorage.setItem("references_completed", "yes");
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* Drop any leftover in-progress form draft. */
  if (window.SaveNow) SaveNow.clearDraft();

  /* Navigate parent dashboard to Your Preferences */
  window.parent.postMessage(
    {
      type      : "navigate",
      page      : "preferences.html",
      sidebarKey: "Your Preferences"
    },
    "*"
  );

  setTimeout(() => setLoading(saveBtn, false), 800);
}

/* ============================================================
   DRAFT CAPTURE / RESTORE — only the in-progress form, not the
   saved references list (which lives on the backend).
   ============================================================ */

function captureFormDraft() {
  return {
    reference_type: $("referenceType").value,
    name          : trim($("refName").value),
    organization  : trim($("refOrg").value),
    title         : trim($("refTitle").value),
    country_code  : trim($("refCountryCode").value),
    mobile        : trim($("refMobile").value),
    email         : trim($("refEmail").value)
  };
}

function restoreFormDraft(draft) {
  if (!draft) return false;
  const setVal = (id, v) => {
    const el = $(id);
    if (el && v != null) el.value = v;
  };
  setVal("referenceType",  draft.reference_type);
  setVal("refName",        draft.name);
  setVal("refOrg",         draft.organization);
  setVal("refTitle",       draft.title);
  setVal("refCountryCode", draft.country_code);
  setVal("refMobile",      draft.mobile);
  setVal("refEmail",       draft.email);
  return true;
}

/* ============================================================
   LOAD EXISTING REFERENCES ON PAGE OPEN
   ============================================================ */

async function loadReferences() {
  if (!MC.candidateId) return;

  try {
    const rows = await apiLoadReferences();

    /* Defensive reset: if loadReferences is called more than once
       (e.g. via a SaveNow restore path or future re-init), we want
       to replace the in-memory list, not append to it. */
    references = [];
    refUid = 0;

    rows.forEach(row => {
      references.push({
        uid           : ++refUid,
        id            : row.id,                       /* JSONB-array id, used by edit/delete */
        reference_type: row.reference_type,
        name          : row.name,
        organization  : row.organization,
        title         : row.title || "",
        country_code  : row.country_code || "+91",
        mobile        : row.mobile || "",
        email         : row.email
      });
    });

    renderReferenceList();
  } catch (err) {
    /* Silently ignore on first load — user can still add new references. */
    console.error("Could not load existing references:", err);
  }
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  /* Pre-fill country code with +91 as default */
  $("refCountryCode").value = "+91";

  /* Wire up buttons */
  $("addReferenceBtn").addEventListener("click", addReference);
  $("saveContinueBtn").addEventListener("click", saveContinue);

  /* Wire Cancel Edit button (hidden by default; shown in edit mode) */
  const cancelBtn = $("cancelEditRefBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => exitEditMode());

  /* Initial empty render so quota badges show 0/2 immediately */
  updateQuotaBadges();

  /* Load any previously saved references from backend */
  loadReferences();

  /* SaveNow integration — single-form scope (no entryNumber) since
     the page never reloads between entries. The "form" is the
     in-progress reference fields only; saved references live on the
     backend after each Add, not in the draft. No formIds because
     the inputs are not wrapped in a <form>; containerSelector
     listens on the whole form-container. */
  SaveNow.init({
    pageName          : "references",
    containerSelector : ".form-container",
    capturePayload    : captureFormDraft,
    restorePayload    : restoreFormDraft,
    apiSave           : null,   /* No batch endpoint — each Add hits backend directly */
    isEmpty: () => !$("referenceType").value &&
                   !trim($("refName")?.value || "") &&
                   !trim($("refOrg")?.value  || "") &&
                   !trim($("refTitle")?.value || "")
  });
});
