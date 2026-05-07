/* ============================================================
   MECULS — portfolio.js
   Work Portfolio & Proof of Work section logic.

   Architecture (post-polish 2026-04-30):
     - MC.* shared helpers (no local copies)
     - SaveNow draft-restore engine (form-only scope; saved
       portfolio items persist independently in the backend)
     - candidateId read fresh from MC.candidateId at save time
     - apiLoadPortfolio guarded on MC.candidateId
     - parseInt with explicit radix; closure-over-uid in remove
       handlers (no parseInt round-trip)
     - postMessage navigation to parent dashboard

   Page structure (post-streamline):
     - Saved items list ABOVE form (visible progress)
     - 4 fields per item: Work Type, Title, Description, Attachment
       (file or URL) + Visibility
     - Soft cap reduced 15 → 8 (forces curation)
     - Work Type chips reduced 9 → 6 (cleaner taxonomy)
     - Removed: Year (most pieces span years), Linked Role/Org
       (duplicates Experience section), separate Impact field
       (merged into Description)
     - Single quota badge (was 3) — file/link split was info dump
     - Empty state placeholder when no items saved

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `portfolio` table is gone.
     Portfolio items now live as a JSONB array at
     profiles.data.portfolio (1-to-many). All five API functions
     rewritten to use MC.saveSection / MC.loadSection with the
     standard 1-to-many helper pattern from key_achievements.js
     (_loadPortfolioArray, _buildPortfolioEntry, _newId).
   - Each entry has a client-generated `id` (UUID) instead of a
     server-assigned BIGSERIAL. The id is opaque to the page —
     enterEditMode / Delete / Update key off it the same way.
   - Validation popups consolidated into a single bullet popup
     (matches the pattern from skills, certifications, references,
     languages, preferences, ai_tools, consulting, key_achievements,
     mentorship).
   - URL auto-fix on the required portfolio link field (mirrors the
     credential-URL normaliser in certifications.js): trims, strips
     wrapping/smart quotes + trailing punctuation, fixes typos
     (htps://, htp://, https//, http//, https:/, http:/), prepends
     https:// when no protocol is present. Rejects javascript:/data:.
     Cleaned URL is written back to the input on save.
   - window.confirm() replaced with MC.showConfirm (callback API)
     for visual consistency with the rest of the page.
   - apiLoadPortfolio resets the in-memory list before pushing,
     so re-running the loader cannot duplicate entries.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.PORTFOLIO_VERSION === "phase1-step3" */
window.PORTFOLIO_VERSION = "phase1-step3";

/* ── Config ── */
const MAX_ITEMS = 8;

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $           = MC.$;
const trim        = MC.trim;
const showPopup   = MC.showPopup;
const showToast   = MC.showToast;
const setLoading  = MC.setLoading;
const showConfirm = MC.showConfirm;

/* ── In-memory state — saved entries (already persisted to backend
   via Save & Add Another). Form holds the entry being edited. */
let pfItems = [];
let pfUid   = 0;

/* ============================================================
   TYPE CHIP SELECTION
   ============================================================ */

function getSelectedType() {
  const checked = document.querySelector('input[name="workType"]:checked');
  return checked ? checked.value : "";
}

function setSelectedType(value) {
  const chips = document.querySelectorAll("#typeChipGrid .type-chip");
  chips.forEach(c => c.classList.remove("selected"));
  if (!value) return;
  const chip = document.querySelector(`#typeChipGrid .type-chip[data-value="${value}"]`);
  if (chip) {
    chip.classList.add("selected");
    const r = chip.querySelector("input");
    if (r) r.checked = true;
  }
}

function setupTypeChips() {
  const chips = document.querySelectorAll("#typeChipGrid .type-chip");
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      chips.forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      chip.querySelector("input").checked = true;
      if (window.SaveNow && SaveNow.silentSave) {
        SaveNow.silentSave();
        SaveNow.flashStatus();
      }
    });
  });
}

/* ============================================================
   "SHOW ON PROFILE" toggle handling
   ============================================================ */

function setupShowOnProfileHandler() {
  const cb = $("pfShowOnProfile");
  if (!cb) return;
  cb.addEventListener("change", () => {
    if (window.SaveNow && SaveNow.silentSave) {
      SaveNow.silentSave();
      SaveNow.flashStatus();
    }
  });
}

/* ============================================================
   URL VALIDATION + AUTO-FIX
   Mirrors normalizeAndValidateCredentialUrl in certifications.js
   and normalizeAndValidateUrl in key_achievements.js.

   Cleanups:
   - Trim whitespace, strip wrapping straight + smart quotes
   - Strip trailing punctuation users sometimes leave from pasting
   - Fix protocol typos: htps://, htp://, https//, http//, https:/, http:/
   - Prepend https:// if no protocol present
   - Reject other schemes (javascript:, data:, ftp:, etc.)
   - Final URL parse to confirm a non-empty host

   Returns the cleaned URL string or null if unfixable / empty.
   The portfolio URL field is REQUIRED, so empty input returns null
   and the calling validator surfaces a "please paste a URL" message.
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
   QUOTA UPDATE (single badge — was 3)
   ============================================================ */

function updateQuota() {
  const el = $("pfCount");
  if (el) el.textContent = pfItems.length;
}

/* ============================================================
   RENDER SAVED PORTFOLIO LIST
   Uses shared .item-card + .item-card--accent-blue.
   XSS-safe: built with createElement + textContent.
   ============================================================ */

function renderList() {
  const list = $("portfolioList");
  list.innerHTML = "";

  /* Hide saved-list while editing — focused on one entry. */
  if (EditState.mode === "edit") return;

  if (pfItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "saved-list-empty";
    empty.textContent = "No portfolio items added yet. Use the form below to add your first one.";
    list.appendChild(empty);
    return;
  }

  const heading = document.createElement("h3");
  heading.className = "list-heading";
  heading.textContent = "Your Portfolio (" + pfItems.length + ")";
  list.appendChild(heading);

  pfItems.forEach(item => {
    const card = document.createElement("div");
    card.className = "item-card item-card--accent-blue";

    const body = document.createElement("div");
    body.className = "item-card__body";
    body.style.cursor = "pointer";
    body.addEventListener("click", () => enterEditMode(item));

    /* Badge row */
    const badgeRow = document.createElement("div");
    badgeRow.className = "item-card__badge-row";

    const typeBadge = document.createElement("span");
    typeBadge.className = "type-badge type-badge--blue";
    typeBadge.textContent = item.workType || "—";
    badgeRow.appendChild(typeBadge);

    /* Visibility indicator — only shown when the item is HIDDEN
       (i.e. show_on_profile=false). Visible items get no badge,
       since "shown on profile" is the default state and doesn't
       need calling out. */
    if (item.showOnProfile === false) {
      const hiddenBadge = document.createElement("span");
      hiddenBadge.className = "type-badge type-badge--gray";
      hiddenBadge.style.marginLeft = "4px";
      hiddenBadge.textContent = "👁 Hidden from profile";
      badgeRow.appendChild(hiddenBadge);
    }

    body.appendChild(badgeRow);

    /* Title */
    const titleEl = document.createElement("div");
    titleEl.className = "item-card__title";
    titleEl.textContent = item.title;
    body.appendChild(titleEl);

    /* Description */
    const descEl = document.createElement("div");
    descEl.className = "item-card__body-text";
    descEl.textContent = item.description;
    body.appendChild(descEl);

    /* External URL link */
    if (item.url) {
      const linkEl = document.createElement("a");
      linkEl.className = "item-card__link";
      linkEl.href = item.url;
      linkEl.target = "_blank";
      linkEl.rel = "noopener";
      linkEl.textContent = "🔗 View link";
      linkEl.addEventListener("click", e => e.stopPropagation());
      body.appendChild(linkEl);
    }

    card.appendChild(body);

    /* Actions — Edit + Delete */
    const actions = document.createElement("div");
    actions.className = "item-card__actions pf-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "pf-card__btn pf-card__btn--edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", e => {
      e.stopPropagation();
      enterEditMode(item);
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "pf-card__btn pf-card__btn--delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", e => {
      e.stopPropagation();
      handleDeletePortfolio(item);
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    list.appendChild(card);
  });
}

/* ============================================================
   EDIT MODE
   ============================================================ */

async function enterEditMode(item) {
  if (!item.id) {
    showToast("Could not find that item.", "error");
    return;
  }

  let row = item;
  if (row.title === undefined || row.workType === undefined) {
    try {
      const fetched = await apiLoadOnePortfolio(item.id);
      if (!fetched) {
        showToast("Could not load that item. Please try again.", "error");
        return;
      }
      row = {
        id: fetched.id,
        workType: fetched.work_type,
        title: fetched.title,
        description: fetched.description,
        url: fetched.url,
        showOnProfile: fetched.show_on_profile !== false
      };
    } catch (err) {
      showToast("Could not load that item. Please try again.", "error");
      return;
    }
  }

  EditState.mode      = "edit";
  EditState.editingId = row.id;

  populateFormFromItem(row);
  applyEditModeUI();
  renderList();   /* hides during edit */

  /* Scroll the work-type form-card into view */
  const firstFormCard = document.querySelector(".form-card");
  if (firstFormCard) firstFormCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function exitEditMode() {
  EditState.mode      = "create";
  EditState.editingId = null;
  applyEditModeUI();
  resetForm();
  renderList();
}

function applyEditModeUI() {
  const saveAnotherBtn  = $("saveAnotherBtn");
  const saveContinueBtn = $("saveContinueBtn");
  const cancelBtn       = $("cancelEditPfBtn");

  if (EditState.mode === "edit") {
    if (saveAnotherBtn) saveAnotherBtn.textContent = "Save Changes";
    if (saveContinueBtn) saveContinueBtn.classList.add("hidden");
    if (cancelBtn) cancelBtn.classList.remove("hidden");
  } else {
    if (saveAnotherBtn) saveAnotherBtn.textContent = "Save & Add Another Item";
    if (saveContinueBtn) saveContinueBtn.classList.remove("hidden");
    if (cancelBtn) cancelBtn.classList.add("hidden");
  }
}

function populateFormFromItem(item) {
  /* Work type chip */
  if (item.workType) setSelectedType(item.workType);

  /* Title + description */
  $("pfTitle").value = item.title || "";
  $("pfDesc").value  = item.description || "";

  /* URL */
  $("pfUrl").value = item.url || "";

  /* Show on profile — default true if undefined */
  const cb = $("pfShowOnProfile");
  if (cb) cb.checked = item.showOnProfile !== false;

  /* Refresh char counters */
  MC.updateCounter($("pfTitle"), "pfTitleCounter");
  MC.updateCounter($("pfDesc"),  "pfDescCounter");
}

async function handleDeletePortfolio(item) {
  if (!item.id) {
    pfItems = pfItems.filter(i => i.uid !== item.uid);
    renderList();
    updateQuota();
    return;
  }

  const title = trim(item.title || "") || "this item";
  const message = "Delete \"" + title + "\"?\n\n" +
                  "This will permanently remove this item from your " +
                  "portfolio. This cannot be undone.";

  /* MC.showConfirm uses a callback API — the deletion happens inside
     the onConfirm callback. Same pattern used on key_achievements,
     mentorship skip, ai_tools skip etc. */
  showConfirm(
    message,
    async function () {
      try {
        await apiDeletePortfolio(item.id);
      } catch (err) {
        showToast("Could not delete. Please try again.", "error");
        return;
      }
      pfItems = pfItems.filter(i => i.uid !== item.uid);
      renderList();
      updateQuota();
      showToast("Portfolio item deleted.", "success");
    },
    {
      confirmLabel: "Yes, delete",
      cancelLabel:  "Cancel"
    }
  );
}

/* ============================================================
   VALIDATE FORM (the entry being typed)
   ============================================================ */

function validate() {
  /* Cap check — only in create mode. Editing an existing entry at
     the cap shouldn't be blocked. */
  if (pfItems.length >= MAX_ITEMS && EditState.mode !== "edit") {
    showPopup("You have reached the maximum of " + MAX_ITEMS +
              " portfolio items. Remove one to add another.");
    return false;
  }

  const workType = getSelectedType();
  const title    = trim($("pfTitle").value);
  const desc     = trim($("pfDesc").value);
  const urlRaw   = trim($("pfUrl").value);

  /* Consolidated missing-field check. */
  const missing = [];
  if (!workType) missing.push("Work type (pick a chip above)");
  if (!title)    missing.push("Title");
  if (!desc)     missing.push("Description");
  if (!urlRaw)   missing.push("Link to Your Work (URL)");

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
    if (!workType) {
      /* Scroll the type-chip card into view so the user sees the chips. */
      const firstFormCard = document.querySelector(".form-card");
      if (firstFormCard) firstFormCard.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (!title) $("pfTitle").focus();
    else if (!desc)    $("pfDesc").focus();
    else if (!urlRaw)  $("pfUrl").focus();
    return false;
  }

  /* URL is required and present — auto-fix and write cleaned value
     back so buildItem and the save call use the cleaned URL. */
  const cleaned = normalizeAndValidateUrl(urlRaw);
  if (!cleaned) {
    showPopup("The URL doesn't look like a valid web address. " +
              "It should look like https://docs.google.com/... or similar.");
    $("pfUrl").focus();
    return false;
  }
  if (cleaned !== $("pfUrl").value) {
    $("pfUrl").value = cleaned;
  }

  return true;
}

/* ============================================================
   BUILD ITEM (from form)
   ============================================================ */

function buildItem() {
  const cb = $("pfShowOnProfile");
  return {
    uid           : ++pfUid,
    workType      : getSelectedType(),
    title         : trim($("pfTitle").value),
    description   : trim($("pfDesc").value),
    url           : trim($("pfUrl").value) || null,
    showOnProfile : cb ? cb.checked : true
  };
}

/* ============================================================
   RESET FORM
   ============================================================ */

function resetForm() {
  setSelectedType("");
  $("pfTitle").value = "";
  $("pfDesc").value  = "";
  $("pfUrl").value   = "";
  const cb = $("pfShowOnProfile");
  if (cb) cb.checked = true;
  MC.updateCounter($("pfTitle"), "pfTitleCounter");
  MC.updateCounter($("pfDesc"),  "pfDescCounter");
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `portfolio` table is gone. Portfolio items now live
   as a JSONB array at profiles.data.portfolio (1-to-many).
   Save/load go through MC.saveSection / MC.loadSection which
   handle auth and RLS server-side via the save_profile_section
   RPC.

   Internal helpers:
   - _loadPortfolioArray: fetch the section, default to []
   - _buildPortfolioEntry: shape the payload into the canonical row form
   - _newId: generate a stable client-side id for a new entry

   Public API (apiSavePortfolio / apiUpdatePortfolio /
   apiDeletePortfolio / apiLoadOnePortfolio / apiLoadPortfolio)
   keeps the same names and signatures so the rest of the page
   doesn't change.
   ============================================================ */

/* ── Internal: load the portfolio array, default to []. ── */
async function _loadPortfolioArray() {
  const arr = await MC.loadSection("portfolio");
  return Array.isArray(arr) ? arr : [];
}

/* ── Internal: shape the payload into a canonical entry.
   Preserves existing id on update, generates a new one on insert. ── */
function _buildPortfolioEntry(payload, existingId) {
  return {
    id              : existingId || _newId(),
    work_type       : payload.workType    || null,
    title           : payload.title       || null,
    description     : payload.description || null,
    url             : payload.url         || null,
    show_on_profile : payload.showOnProfile !== false
  };
}

/* ── Internal: generate a unique id for a new entry.
   Replaces the old database BIGSERIAL. crypto.randomUUID() in modern
   browsers; timestamp+random hybrid fallback for ancient browsers. ── */
function _newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "pf-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

async function apiSavePortfolio(item) {
  const arr = await _loadPortfolioArray();
  const entry = _buildPortfolioEntry(item, null);
  arr.push(entry);
  await MC.saveSection("portfolio", arr);
  return entry;
}

async function apiUpdatePortfolio(id, item) {
  const arr = await _loadPortfolioArray();
  const idx = arr.findIndex(function (e) { return e.id === id; });
  if (idx < 0) {
    throw new Error("Could not save changes: portfolio item not found");
  }
  arr[idx] = _buildPortfolioEntry(item, id);
  await MC.saveSection("portfolio", arr);
  return arr[idx];
}

async function apiDeletePortfolio(id) {
  const arr = await _loadPortfolioArray();
  const filtered = arr.filter(function (e) { return e.id !== id; });
  await MC.saveSection("portfolio", filtered);
  return true;
}

async function apiLoadOnePortfolio(id) {
  const arr = await _loadPortfolioArray();
  return arr.find(function (e) { return e.id === id; }) || null;
}

async function apiLoadPortfolio() {
  if (!MC.candidateId) return;

  let rows;
  try {
    rows = await _loadPortfolioArray();
  } catch (err) {
    console.error("Could not load portfolio:", err);
    return;
  }

  if (!Array.isArray(rows)) return;

  /* Defensive: reset in-memory state before pushing loaded entries.
     Without this, calling apiLoadPortfolio twice (e.g. via a future
     re-init path) would duplicate every portfolio item. */
  pfItems = [];
  pfUid = 0;

  rows.forEach(it => {
    pfItems.push({
      uid           : ++pfUid,
      id            : it.id,                  /* client-generated UUID, used by edit/delete */
      workType      : it.work_type,
      title         : it.title,
      description   : it.description,
      url           : it.url || null,
      showOnProfile : it.show_on_profile !== false
    });
  });
  renderList();
  updateQuota();
}

/* ── Edit-mode state ──
   Tracks whether we're creating a new portfolio item or editing an
   existing one. Mirrors EditState pattern from experience.js,
   education.js, certifications.js, references.js, key_achievements.js. */
const EditState = {
  mode      : "create",   // "create" | "edit"
  editingId : null        // database row id being edited
};

/* ============================================================
   SAVE & ADD ANOTHER
   ============================================================ */

async function saveAnother() {
  if (!validate()) return;

  const btn  = $("saveAnotherBtn");
  const btn2 = $("saveContinueBtn");
  setLoading(btn, true);
  if (btn2) btn2.disabled = true;

  const item = buildItem();

  /* ─── EDIT MODE: UPDATE existing row ─── */
  if (EditState.mode === "edit" && EditState.editingId) {
    let updatedRow;
    try {
      updatedRow = await apiUpdatePortfolio(EditState.editingId, item);
    } catch (err) {
      console.error("Portfolio update failed:", err);
      showToast("Could not save changes. Please try again.", "error");
      setLoading(btn, false);
      if (btn2) btn2.disabled = false;
      return;
    }

    /* Update the in-memory row with the latest values from server */
    const idx = pfItems.findIndex(i => i.id === EditState.editingId);
    if (idx !== -1) {
      pfItems[idx] = Object.assign({}, pfItems[idx], {
        workType      : updatedRow.work_type,
        title         : updatedRow.title,
        description   : updatedRow.description,
        url           : updatedRow.url,
        showOnProfile : updatedRow.show_on_profile !== false
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
    savedRow = await apiSavePortfolio(item);
  } catch (err) {
    console.error("Portfolio save failed:", err);
    showToast(err.message || "Could not save to server. Please try again.", "error");
    setLoading(btn, false);
    if (btn2) btn2.disabled = false;
    return;
  }

  /* Carry server-assigned id into in-memory state.
     The uid was assigned by buildItem() — reuse it (don't increment again). */
  pfItems.push({
    uid           : item.uid,
    id            : savedRow.id,
    workType      : savedRow.work_type,
    title         : savedRow.title,
    description   : savedRow.description,
    url           : savedRow.url,
    showOnProfile : savedRow.show_on_profile !== false
  });

  renderList();
  updateQuota();
  resetForm();

  if (window.SaveNow) SaveNow.clearDraft();

  setLoading(btn, false);
  if (btn2) btn2.disabled = false;
  showToast("Portfolio item saved.", "success");

  setTimeout(() => {
    $("portfolioList").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 200);
}

/* ============================================================
   SAVE & CONTINUE
   ============================================================ */

async function saveContinue() {
  /* Detect form input */
  const hasFormInput = getSelectedType()
                    || trim($("pfTitle").value)
                    || trim($("pfDesc").value)
                    || trim($("pfUrl").value);

  if (!hasFormInput) {
    if (pfItems.length === 0) {
      showPopup("You haven't added any portfolio items. Please add an item to save, or use \"Skip — Not relevant to me\" if this section doesn't apply.");
      return;
    }
    proceedToNext();
    return;
  }

  if (!validate()) return;

  const btn  = $("saveContinueBtn");
  const btn2 = $("saveAnotherBtn");
  setLoading(btn, true);
  btn2.disabled = true;

  const item = buildItem();

  let savedRow;
  try {
    savedRow = await apiSavePortfolio(item);
  } catch (err) {
    console.error("Portfolio save failed:", err);
    showToast(err.message || "Could not save to server. Please try again.", "error");
    setLoading(btn, false);
    btn2.disabled = false;
    return;
  }

  pfItems.push({
    uid           : item.uid,
    id            : savedRow.id,
    workType      : savedRow.work_type,
    title         : savedRow.title,
    description   : savedRow.description,
    url           : savedRow.url,
    showOnProfile : savedRow.show_on_profile !== false
  });

  if (window.SaveNow) SaveNow.clearDraft();

  proceedToNext();
}

function proceedToNext() {
  MC.safeSet("portfolio_completed", "yes");
  MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

  window.parent.postMessage(
    { type: "navigate", page: "publications.html", sidebarKey: "Publications & Media" },
    "*"
  );
}

/* ============================================================
   SKIP — section is optional, user can opt out without saving
   ============================================================ */

function skipSection() {
  /* If the user typed something into the form, warn before discarding. */
  const hasFormInput = getSelectedType()
                    || trim($("pfTitle").value)
                    || trim($("pfDesc").value)
                    || trim($("pfUrl").value);

  const proceedSkip = () => {
    /* Don't save anything — clear any draft so it doesn't reappear */
    if (window.SaveNow) SaveNow.clearDraft();

    MC.safeSet("portfolio_completed", "skipped");
    MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

    window.parent.postMessage(
      { type: "navigate", page: "publications.html", sidebarKey: "Publications & Media" },
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
   SAVENOW DRAFT — capture and restore (form only).
   Saved items in pfItems[] come from the backend; the draft only
   captures what's currently in the form.
   ============================================================ */

function capturePortfolioDraft() {
  const cb = $("pfShowOnProfile");
  return {
    workType      : getSelectedType(),
    title         : trim($("pfTitle").value),
    description   : trim($("pfDesc").value),
    url           : trim($("pfUrl").value),
    showOnProfile : cb ? cb.checked : true
  };
}

function restorePortfolioDraft(draft) {
  if (!draft) return false;
  if (draft.workType)    setSelectedType(draft.workType);
  if (draft.title)       $("pfTitle").value = draft.title;
  if (draft.description) $("pfDesc").value  = draft.description;
  if (draft.url)         $("pfUrl").value   = draft.url;
  if (typeof draft.showOnProfile === "boolean") {
    const cb = $("pfShowOnProfile");
    if (cb) cb.checked = draft.showOnProfile;
  }
  MC.updateCounter($("pfTitle"), "pfTitleCounter");
  MC.updateCounter($("pfDesc"),  "pfDescCounter");
  return true;
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  setupTypeChips();
  setupShowOnProfileHandler();

  /* Char counters */
  $("pfTitle").addEventListener("input", () => {
    MC.updateCounter($("pfTitle"), "pfTitleCounter");
  });
  $("pfDesc").addEventListener("input", () => {
    MC.updateCounter($("pfDesc"), "pfDescCounter");
  });

  $("saveAnotherBtn").addEventListener("click", saveAnother);
  $("saveContinueBtn").addEventListener("click", saveContinue);

  /* Wire Skip button — section is optional */
  const skipBtn = $("skipBtn");
  if (skipBtn) skipBtn.addEventListener("click", skipSection);

  /* Wire Cancel Edit button (hidden by default; shown in edit mode) */
  const cancelBtn = $("cancelEditPfBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => exitEditMode());

  /* Load existing data BEFORE SaveNow.init */
  await apiLoadPortfolio();

  if (window.SaveNow) {
    SaveNow.init({
      pageName          : "portfolio",
      containerSelector : ".form-container",
      capturePayload    : capturePortfolioDraft,
      restorePayload    : restorePortfolioDraft,
      apiSave           : (p) => {
        /* Auto-save fires periodically. We don't push every keystroke
           to the portfolio API; explicit Save & Add is the trigger.
           Return resolved promise so SaveNow's contract is satisfied
           without hitting the network. */
        return Promise.resolve({ ok: true });
      },
      isEmpty           : () => !getSelectedType()
                              && !trim($("pfTitle").value)
                              && !trim($("pfDesc").value)
                              && !trim($("pfUrl").value)
    });
  }
});
