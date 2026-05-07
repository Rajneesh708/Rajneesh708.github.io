/* ============================================================
   MECULS — certifications.js
   Certifications / Courses section logic.
   Mirrors experience.js patterns onto the shared architecture:
     - sessionStorage for cert number across reloads
     - Checkbox hidden from Cert-2 onwards
     - End date mandatory from Cert-2 onwards
     - Saved list renders at top
     - MC.* helpers (no local copies)
     - SaveNow draft-restore engine with per-entry scoping
     - candidateId read fresh from MC.candidateId at save time
     - postMessage navigation to parent dashboard

   Bugs fixed in this polish pass:
   - XSS via cert.name and cert.credential_url interpolation in
     renderCertificationList: a malicious credential_url like
     "javascript:alert(1)" would execute on click. Fixed with
     safe DOM construction (textContent everywhere) + URL scheme
     validation that only permits http/https.
   - cert_number sessionStorage value can be NaN if storage gets
     into a weird state. Defensive fallback added.
   - handleSaveContinue empty-input shortcut bypassed SaveNow
     drafts, leaving stale drafts in localStorage. Now clears
     the draft before navigating.

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `certifications` table is gone.
     Certifications now live as an array at profiles.data.certifications
     (JSONB). All five API functions rewritten to use MC.saveSection /
     MC.loadSection with the standard 1-to-many helper pattern from
     experience.js (_loadCertsArray, _buildCertEntry, _newId).
   - Generic per-validation popup replaced with consolidated
     bullet-list popup (matches the pattern from skills.js,
     profile_category.js, professional_introduction.js).
   - Bug: `populateFormFromRow` did not dispatch the change event on
     `isCurrent` after restoring its checked state, so the end-date
     enable/disable logic didn't run on edit-load. Fixed.
   - Bug: edit mode showed the "currently pursuing" checkbox for
     Cert-2+ rows even though only Cert-1 is allowed to be in-progress.
     Now gated on EditState.editingNumber === 1.
   - Bug: validateForm checked `certificationNumber > 1` (the NEXT-create
     number) for the "end date mandatory" rule, which was wrong in edit
     mode. Now uses EditState.editingNumber when editing.
   - Year cap defensive: start year dropdown capped at the current year
     (you cannot have STARTED a cert in 2055). End year stays at 2055
     for "Expected Completion".
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.CERTIFICATIONS_VERSION === "phase1-step3" */
window.CERTIFICATIONS_VERSION = "phase1-step3";

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $          = MC.$;
const trim       = MC.trim;
const showPopup  = MC.showPopup;
const showToast  = MC.showToast;
const setLoading = MC.setLoading;

/* ── Certification number — survives reload within same session ──
   Mirrors exp_number pattern from experience.js exactly.
   Defensive fallback if sessionStorage value is missing/NaN.
─────────────────────────────────────────────────────────────────── */
let certificationNumber = parseInt(
  sessionStorage.getItem("cert_number") || "1",
  10
);
if (isNaN(certificationNumber) || certificationNumber < 1) {
  certificationNumber = 1;
}

/* ── In-memory state ── */
const CertState = {
  certifications: []  // saved entries for list rendering
};

/* ============================================================
   YEAR DROPDOWN POPULATION
   Mirrors experience.js / education.js populateYears.
   Optional opts.maxYear caps the upper bound (used for startYear
   so you cannot pick a future year as your start).
   ============================================================ */

function populateYears(selectId, opts) {
  const sel = $(selectId);
  /* innerHTML on a static template is safe — no user input here. */
  sel.innerHTML = '<option value="">Year</option>';
  const maxYear = (opts && opts.maxYear) || 2055;
  for (let y = maxYear; y >= 1930; y--) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
}

/* ── Future-month check ──
   Returns true if (month, year) is later than the current calendar month.
   The dropdown caps year at the current calendar year, but a user could
   still pick (e.g.) June 2026 in May 2026 — that's a future month within
   the current year. This catches that case at validation time.

   Used for start dates everywhere (you can't have started a cert in the
   future) and for end dates on COMPLETED certifications (you can't have
   completed a cert in the future either). Currently-pursuing certs have
   no end date, so the check doesn't apply to them. */
function _isFutureMonth(month, year) {
  if (!month || !year) return false;
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (isNaN(m) || isNaN(y)) return false;
  const now = new Date();
  const currentY = now.getFullYear();
  const currentM = now.getMonth() + 1;  // getMonth is 0-indexed
  if (y > currentY) return true;
  if (y === currentY && m > currentM) return true;
  return false;
}

/* ============================================================
   URL HELPERS
   ============================================================ */

/* Only http(s) URLs are safe to render as clickable links.
   "javascript:alert(1)" must not be allowed. */
function isSafeHttpUrl(raw) {
  if (!raw) return false;
  const s = trim(raw);
  if (!s) return false;
  /* Quick lowercase check for the common schemes */
  const lower = s.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

/* ── Credential URL auto-fix + validate ──
   Mirrors the auto-fix pattern from upload_photo_cv.js (CV link
   normaliser) but tailored to credential URLs:
   - No provider whitelist. Credentials come from anywhere
     (credly, coursera, university domains, employer portals, etc).
   - Both http:// and https:// are allowed. Do NOT auto-upgrade
     http to https — some legacy credential servers don't support
     https, and a silent upgrade would break their links. Respect
     what the user typed for the protocol.

   Returns:
   - the cleaned URL string if input was a fixable http(s) URL
   - null if input is empty or cannot be made into a valid http(s) URL

   Cleanups:
   - Trim whitespace
   - Strip wrapping straight & smart quotes
   - Strip trailing punctuation users sometimes leave from pasting
     out of the middle of a sentence (.,;:)>])
   - Fix common protocol typos: htps://, htp://, https//, http//,
     https:/, http:/
   - Prepend https:// when no protocol is present (default to secure)
   - Reject other schemes (javascript:, data:, ftp:, etc.) so an
     attacker can't sneak in a non-http link by handcrafting input.
*/
function normalizeAndValidateCredentialUrl(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  /* Strip wrapping quotes (straight + smart quotes) */
  s = s.replace(/^["'\u201C\u201D\u2018\u2019]+/, "")
       .replace(/["'\u201C\u201D\u2018\u2019]+$/, "");

  /* Strip trailing punctuation users sometimes leave on a pasted URL */
  s = s.replace(/[.,;:)\]>]+$/, "");

  if (!s) return null;

  /* Fix common protocol typos. Order matters — fix the longer typos
     first so a partial match doesn't shadow a full one. */
  if (/^htps:\/\//i.test(s))      s = s.replace(/^htps:\/\//i,   "https://");
  if (/^htp:\/\//i.test(s))       s = s.replace(/^htp:\/\//i,    "http://");
  if (/^https\/\//i.test(s))      s = s.replace(/^https\/\//i,   "https://");
  if (/^http\/\//i.test(s))       s = s.replace(/^http\/\//i,    "http://");
  if (/^https:\/(?!\/)/i.test(s)) s = s.replace(/^https:\//i,    "https://");
  if (/^http:\/(?!\/)/i.test(s))  s = s.replace(/^http:\//i,     "http://");

  /* Prepend https:// if no protocol present at all. */
  if (!/^https?:\/\//i.test(s)) {
    /* If the input looks like it has SOME other scheme (javascript:,
       data:, ftp:, mailto:, etc.) — refuse. We only accept http(s). */
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
   RENDER SAVED CERTIFICATIONS LIST — XSS-safe
   ============================================================ */

function renderCertificationList() {
  const list = $("certification-list");
  list.innerHTML = "";   /* static wipe — safe */

  /* Hide saved-list while in edit mode — focused on one entry. */
  if (EditState.mode === "edit") return;

  if (CertState.certifications.length === 0) return;

  const heading = document.createElement("h3");
  heading.className = "entry-title";
  heading.textContent = "Saved Certifications / Courses";
  list.appendChild(heading);

  CertState.certifications.forEach((cert, index) => {
    const card = document.createElement("div");
    card.className = "cert-list-card";

    const info = document.createElement("div");
    info.className = "cert-list-card__info";

    /* Title line: "Certification N — <name>" — textContent everywhere */
    const titleEl = document.createElement("strong");
    const certNum = cert.certification_number || (index + 1);
    titleEl.textContent =
      "Certification " + certNum + " \u2014 " + (cert.name || "\u2014");
    info.appendChild(titleEl);

    /* Subtitle: issuer + date range */
    const dateRange = [
      cert.start_month && cert.start_year
        ? cert.start_month + " / " + cert.start_year
        : "",
      cert.is_current
        ? "Present"
        : cert.end_month && cert.end_year
          ? cert.end_month + " / " + cert.end_year
          : ""
    ].filter(Boolean).join(" \u2013 ");

    const subtitleEl = document.createElement("span");
    subtitleEl.textContent =
      (cert.issuing_org || "") + (dateRange ? " \u00b7 " + dateRange : "");
    info.appendChild(subtitleEl);

    /* Credential URL — only render if it's a safe http(s) URL.
       Anything else (javascript:, data:, blank, etc.) is silently skipped.
       The link STOPS click propagation so clicking the link doesn't also
       enter edit mode. */
    if (isSafeHttpUrl(cert.credential_url)) {
      const linkEl = document.createElement("a");
      linkEl.href   = cert.credential_url;   /* href is fine — DOM API encodes */
      linkEl.target = "_blank";
      linkEl.rel    = "noopener";
      linkEl.textContent = "View Credential \u2197";
      linkEl.addEventListener("click", e => e.stopPropagation());
      info.appendChild(linkEl);
    }

    /* Whole info area is clickable to enter edit mode */
    info.style.cursor = "pointer";
    info.addEventListener("click", () => enterEditMode(cert));

    card.appendChild(info);

    /* Action buttons: Edit + Delete */
    const actions = document.createElement("div");
    actions.className = "cert-list-card__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "cert-list-card__btn cert-list-card__btn--edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => enterEditMode(cert));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "cert-list-card__btn cert-list-card__btn--delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => handleDeleteCertification(cert));
    actions.appendChild(deleteBtn);

    card.appendChild(actions);

    list.appendChild(card);
  });
}

/* ============================================================
   EDIT MODE
   ============================================================ */

async function enterEditMode(cert) {
  /* If we don't have the full row in memory (defensive), fetch it. */
  let row = cert;
  if (!row.id) {
    showToast("Could not find that certification.", "error");
    return;
  }
  if (row.name === undefined || row.start_month === undefined) {
    try {
      row = await apiLoadOneCertification(cert.id);
    } catch (err) {
      showToast("Could not load that certification. Please try again.", "error");
      return;
    }
  }
  if (!row) {
    showToast("Could not find that certification.", "error");
    return;
  }

  EditState.mode          = "edit";
  EditState.editingId     = row.id;
  EditState.editingNumber = row.certification_number;

  populateFormFromRow(row);
  applyEditModeUI();
  renderCertificationList();   /* hides during edit */
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitEditMode() {
  EditState.mode          = "create";
  EditState.editingId     = null;
  EditState.editingNumber = null;
  /* Full reload — cleanest reset for forms with conditional UI. */
  window.location.reload();
}

function applyEditModeUI() {
  const titleEl    = $("pageTitle");
  const saveBtn    = $("saveAnotherCertBtn");
  const cancelBtn  = $("cancelEditCertBtn");
  const continueBtn= $("saveContinueBtn");
  const currentCb  = $("currentCertCheckbox");

  if (EditState.mode === "edit") {
    if (titleEl)   titleEl.textContent = "Edit Certification " + EditState.editingNumber;
    if (saveBtn)   saveBtn.textContent = "Save Changes";
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    if (continueBtn) continueBtn.classList.add("hidden");
    /* The "currently pursuing" checkbox is meaningful ONLY for Cert-1
       (the data model says only the first certification can be in
       progress). When editing Cert-2+, hide it so the user cannot
       accidentally tick it and create an inconsistent state. */
    if (currentCb) {
      if (EditState.editingNumber === 1) {
        currentCb.classList.remove("hidden");
      } else {
        currentCb.classList.add("hidden");
      }
    }
  } else {
    if (titleEl)   titleEl.textContent = "Add Certification-" + certificationNumber;
    if (saveBtn)   saveBtn.textContent = "Save & Add Another Certification / Course";
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (continueBtn) continueBtn.classList.remove("hidden");
    /* applyPageRules manages the checkbox visibility for create mode. */
  }
}

function populateFormFromRow(r) {
  function setVal(id, val) {
    const el = $(id);
    if (!el) return;
    el.value = (val === null || val === undefined) ? "" : val;
  }
  function setCheck(id, val) {
    const el = $(id);
    if (!el) return;
    el.checked = !!val;
  }

  setVal("certName",        r.name);
  setVal("issuer",          r.issuing_org);
  setCheck("isCurrent",     r.is_current);
  setVal("startMonth",      r.start_month);
  setVal("startYear",       r.start_year);
  setVal("endMonth",        r.end_month);
  setVal("endYear",         r.end_year);
  setVal("credentialUrl",   r.credential_url);

  /* Trigger change event on isCurrent so the End Date label refreshes
     to "Expected Completion Date" when the saved row was in-progress.
     Setting .checked programmatically does NOT fire change events on
     its own, so we dispatch one manually. */
  const cb = $("isCurrent");
  if (cb) cb.dispatchEvent(new Event("change"));

  /* Trigger input event on credential URL so live URL hint refreshes */
  const urlEl = $("credentialUrl");
  if (urlEl) urlEl.dispatchEvent(new Event("input"));
}

function handleDeleteCertification(cert) {
  const certNum  = cert.certification_number || "?";
  const certName = trim(cert.name || "") || "this certification";
  const issuer   = cert.issuing_org ? " from " + trim(cert.issuing_org) : "";

  const message = "Delete Certification " + certNum +
                  " (" + certName + issuer + ")?\n\n" +
                  "This will permanently remove this certification from your " +
                  "profile. This cannot be undone.";

  if (!window.confirm(message)) return;

  (async () => {
    try {
      await apiDeleteCertification(cert.id);
    } catch (err) {
      showToast("Could not delete. Please try again.", "error");
      return;
    }
    showToast("Certification deleted.", "success");
    setTimeout(() => window.location.reload(), 800);
  })();
}

/* ============================================================
   BUILD PAYLOAD — for the current form state
   ============================================================ */

function buildPayload() {
  /* candidate_id is set by apiSaveCertification from the Supabase
     session (UUID). The form-side payload omits it. */
  return {
    certification_number: certificationNumber,
    name                : trim($("certName").value),
    issuing_org         : trim($("issuer").value),
    is_current          : $("isCurrent") ? !!$("isCurrent").checked : false,
    start_month         : $("startMonth").value,
    start_year          : $("startYear").value,
    end_month           : $("endMonth").value || null,
    end_year            : $("endYear").value  || null,
    credential_url      : trim($("credentialUrl").value) || null
  };
}

/* ============================================================
   VALIDATE
   ============================================================ */

function validateForm() {
  /* In edit mode, validation rules apply to the row being edited
     (use editingNumber). In create mode, they apply to the next-to-create
     entry (certificationNumber). */
  const effectiveNumber =
    (EditState.mode === "edit" && EditState.editingNumber)
      ? EditState.editingNumber
      : certificationNumber;

  const isCurrentChecked = $("isCurrent") && $("isCurrent").checked;

  /* Collect ALL missing required fields together so the user fixes
     everything in one pass — matches the consolidated-popup pattern
     used on skills, profile_category, professional_introduction. */
  const missing = [];
  if (!trim($("certName").value)) missing.push("Certification / Course Name");
  if (!trim($("issuer").value))   missing.push("Issuing Organisation");
  if (!$("startMonth").value)     missing.push("Start Month");
  if (!$("startYear").value)      missing.push("Start Year");

  /* End date mandatory ALWAYS now (2026-05-05 fix):
     Previously was only required when NOT currently pursuing. But every
     certification has either a known completion date OR an expected one,
     so we now require an end/expected date in both cases. The label
     swaps to "Expected Completion Date" when "currently pursuing" is
     ticked (handled by updateEndDateLabel) so users understand an
     estimate is fine. */
  if (!$("endMonth").value) missing.push(isCurrentChecked ? "Expected Completion Month" : "End Month");
  if (!$("endYear").value)  missing.push(isCurrentChecked ? "Expected Completion Year"  : "End Year");

  if (missing.length > 0) {
    showPopup(
      "Please fill the following before saving this certification:\n\n\u2022 " +
      missing.join("\n\u2022 ")
    );
    return false;
  }

  /* Date logic — three checks, in order:
     1. Start date cannot be in the future. The dropdown caps year at
        the current year, but a user could still pick (e.g.) June 2026
        in May 2026 — that's a future month within the current year.
     2. End date cannot be in the future for COMPLETED certifications.
        Skipped when "currently pursuing" is ticked (no end date set).
     3. End date must not be before start date (existing check). */

  /* (1) Future start date */
  if (_isFutureMonth($("startMonth").value, $("startYear").value)) {
    showPopup(
      "Start date cannot be in the future. " +
      "Please pick a month and year that is not later than the current month."
    );
    return false;
  }

  /* (2) Future end date — only for completed certs */
  if (!isCurrentChecked && _isFutureMonth($("endMonth").value, $("endYear").value)) {
    showPopup(
      "End date cannot be in the future for a completed certification. " +
      "If you are still pursuing this certification, tick \"I am currently pursuing this certification / course\" instead."
    );
    return false;
  }

  /* (3) End before start. Runs in BOTH cases — completed certs AND
     "currently pursuing" certs. Even an expected completion date
     should not be earlier than the start date. (Previously this
     check was skipped when isCurrentChecked because end date was
     disabled and empty; now end date is always filled, so the
     validation must always run.) */
  {
    const sm = parseInt($("startMonth").value, 10);
    const sy = parseInt($("startYear").value,  10);
    const em = parseInt($("endMonth").value,   10);
    const ey = parseInt($("endYear").value,    10);

    if (sy && ey) {
      if (ey < sy || (ey === sy && em < sm)) {
        showPopup("Your End Date / Completion Date is earlier than your Start Date. Please correct the dates.");
        return false;
      }
    }
  }

  /* Credential URL — optional. If user entered something, run it
     through normalizeAndValidateCredentialUrl which auto-fixes common
     typos (missing protocol, htps://, etc.). The cleaned value is
     written back to the input field so the user SEES the correction
     and so buildPayload picks up the cleaned version. We only reject
     if the input cannot be normalised at all (e.g. javascript: URL,
     unparseable host). */
  const credInput = $("credentialUrl");
  const credRaw   = trim(credInput.value);
  if (credRaw) {
    const cleaned = normalizeAndValidateCredentialUrl(credRaw);
    if (!cleaned) {
      showPopup(
        "The credential URL doesn't look right. Please paste the link to " +
        "your certificate or credential page. It should start with " +
        "https:// or http:// and contain a valid web address."
      );
      return false;
    }
    /* Write cleaned value back so user sees what we're saving and so
       buildPayload picks it up. */
    if (cleaned !== credInput.value) {
      credInput.value = cleaned;
    }
  }

  return true;
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `certifications` table is gone. Certifications now
   live as a JSONB array at profiles.data.certifications, mirroring
   the experiences pattern. Each entry has a client-generated `id`
   (UUID) replacing the old database BIGSERIAL.

   Internal helpers:
   - _loadCertsArray: fetch the section, default to []
   - _buildCertEntry: shape the payload into the canonical row form
   - _newId: generate a stable client-side id for a new entry

   Public API (apiSave/Load/Update/Delete) keeps the same names
   and signatures so the rest of the page doesn't change.
   ============================================================ */

/* ── Internal: load the certifications array, default to []. ── */
async function _loadCertsArray() {
  const arr = await MC.loadSection("certifications");
  return Array.isArray(arr) ? arr : [];
}

/* ── Internal: shape the payload into a canonical entry.
   Preserves existing id on update, generates a new one on insert. ── */
function _buildCertEntry(payload, existingId) {
  return {
    id                  : existingId || _newId(),
    certification_number: payload.certification_number || 1,
    name                : payload.name           || null,
    issuing_org         : payload.issuing_org    || null,
    is_current          : !!payload.is_current,
    start_month         : payload.start_month    || null,
    start_year          : payload.start_year     || null,
    end_month           : payload.end_month      || null,
    end_year            : payload.end_year       || null,
    credential_url      : payload.credential_url || null
  };
}

/* ── Internal: generate a unique id for a new entry.
   Replaces the old database BIGSERIAL. crypto.randomUUID() in modern
   browsers; timestamp+random hybrid fallback for ancient browsers. ── */
function _newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "cert-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

async function apiSaveCertification(payload) {
  const arr = await _loadCertsArray();
  const entry = _buildCertEntry(payload, null);
  arr.push(entry);
  await MC.saveSection("certifications", arr);
  return entry;
}

/* Load ALL certifications, ordered by certification_number. */
async function apiLoadAllCertifications() {
  const arr = await _loadCertsArray();
  arr.sort(function (a, b) {
    return (a.certification_number || 0) - (b.certification_number || 0);
  });
  return arr;
}

/* Load ONE certification by client-side id. */
async function apiLoadOneCertification(id) {
  const arr = await _loadCertsArray();
  return arr.find(function (e) { return e.id === id; }) || null;
}

/* Update an existing certification by id. The whole entry is rebuilt
   from the payload (preserving the original id). */
async function apiUpdateCertification(id, payload) {
  const arr = await _loadCertsArray();
  const idx = arr.findIndex(function (e) { return e.id === id; });
  if (idx < 0) {
    throw new Error("Could not save changes: certification not found");
  }
  arr[idx] = _buildCertEntry(payload, id);
  await MC.saveSection("certifications", arr);
  return arr[idx];
}

/* Delete a certification by id. */
async function apiDeleteCertification(id) {
  const arr = await _loadCertsArray();
  const filtered = arr.filter(function (e) { return e.id !== id; });
  await MC.saveSection("certifications", filtered);
  return true;
}

/* ── Edit-mode state ──
   Tracks whether we're creating a new certification or editing an
   existing one. Mirrors EditState pattern from experience.js and
   education.js. */
const EditState = {
  mode         : "create",   // "create" | "edit"
  editingId    : null,       // database row id being edited
  editingNumber: null        // certification_number of edited row
};

/* ============================================================
   SAVE & ADD ANOTHER CERTIFICATION
   Mirrors experience.js handleSaveAnother.
   ============================================================ */

async function handleSaveAnother() {
  if (!validateForm()) return;

  const btn = $("saveAnotherCertBtn");
  setLoading(btn, true);

  const payload = buildPayload();

  /* ─── EDIT MODE: UPDATE existing row ─── */
  if (EditState.mode === "edit" && EditState.editingId) {
    payload.certification_number = EditState.editingNumber;

    try {
      await apiUpdateCertification(EditState.editingId, payload);
    } catch (err) {
      console.error("Certification update failed:", err);
      showToast("Could not save changes. Please try again.", "error");
      setLoading(btn, false);
      return;
    }

    setLoading(btn, false);
    showToast("Changes saved!", "success");
    setTimeout(() => window.location.reload(), 800);
    return;
  }

  /* ─── CREATE MODE: INSERT new entry ─── */
  let savedEntry;
  try {
    savedEntry = await apiSaveCertification(payload);
  } catch (err) {
    console.error("Certification save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(btn, false);
    return;
  }

  /* Store in memory using the saved entry (which carries the assigned id).
     This keeps the in-memory list in sync with what's persisted, so a
     subsequent click on the saved-card edit button finds the right id. */
  CertState.certifications.push(savedEntry);

  /* Saved successfully — clear THIS certification's draft */
  if (window.SaveNow) SaveNow.clearDraft();

  /* Increment cert number and persist */
  certificationNumber++;
  sessionStorage.setItem("cert_number", certificationNumber);

  showToast(
    "Certification saved! Loading form for Certification-" + certificationNumber + "\u2026",
    "success"
  );

  /* Brief pause so user sees success message, then reload */
  setTimeout(() => window.location.reload(), 1200);
}

/* ============================================================
   SAVE & CONTINUE
   Mirrors experience.js handleSaveContinue.
   ============================================================ */

async function handleSaveContinue() {
  const btn = $("saveContinueBtn");

  /* If all cert fields are empty, user has no certification to add —
     navigate directly without saving or validating. This is the
     "skip section" path. We check ALL fields (not just the four
     required-on-create) so a user who typed only a credential URL
     or end date doesn't lose that input through this branch. */
  const hasAnyInput = trim($("certName").value)       ||
                      trim($("issuer").value)         ||
                      $("startMonth").value           ||
                      $("startYear").value            ||
                      $("endMonth").value             ||
                      $("endYear").value              ||
                      trim($("credentialUrl").value)  ||
                      ($("isCurrent") && $("isCurrent").checked);

  if (!hasAnyInput) {
    /* No certification entered — clean up and go directly to next section */
    sessionStorage.removeItem("cert_number");
    if (window.SaveNow) SaveNow.clearDraft();
    localStorage.setItem("certifications_completed", "yes");
    localStorage.setItem(
      "profile_last_updated",
      new Date().toLocaleDateString("en-US")
    );
    window.parent.postMessage(
      {
        type      : "navigate",
        page      : "references.html",
        sidebarKey: "Your References"
      },
      "*"
    );
    return;
  }

  /* User has started filling a certification — validate and save it */
  if (!validateForm()) return;

  setLoading(btn, true);

  const payload = buildPayload();

  try {
    await apiSaveCertification(payload);
  } catch (err) {
    console.error("Certification save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(btn, false);
    return;
  }

  /* Clear session counter and the active draft */
  sessionStorage.removeItem("cert_number");
  if (window.SaveNow) SaveNow.clearDraft();

  localStorage.setItem("certifications_completed", "yes");
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* Navigate parent dashboard to Your References */
  window.parent.postMessage(
    {
      type      : "navigate",
      page      : "references.html",
      sidebarKey: "Your References"
    },
    "*"
  );

  setTimeout(() => setLoading(btn, false), 800);
}

/* ============================================================
   PAGE-LEVEL SETUP — applies rules that depend on cert number
   ============================================================ */

function applyPageRules() {
  /* Update page title */
  $("pageTitle").textContent = "Add Certification-" + certificationNumber;

  if (certificationNumber > 1) {
    /* Hide "currently pursuing" checkbox — only Cert-1 can be in-progress */
    const cb = $("currentCertCheckbox");
    if (cb) cb.classList.add("hidden");

    /* End date becomes mandatory.
       Build the label safely (label text + a single nested span). */
    const labelEl = $("endDateLabel");
    if (labelEl) {
      labelEl.textContent = "End Date / Completion Date ";
      const star = document.createElement("span");
      star.className   = "required";
      star.textContent = "*";
      labelEl.appendChild(star);
    }

    $("endMonth").required = true;
    $("endYear").required  = true;

    /* Show the helper text explaining why the end date is required
       and why the "currently pursuing" checkbox is gone. Without this,
       the user just sees the rules change between Cert-1 and Cert-2
       with no explanation. */
    const hint = $("endDateRequiredHint");
    if (hint) hint.classList.remove("hidden");
  } else {
    /* Cert-1: end date is required regardless of "currently pursuing" state.
       The label text changes based on the checkbox, but the * mandatory
       marker is always present. */
    $("endMonth").required = true;
    $("endYear").required  = true;
    updateEndDateLabel();
  }
}

/* ── updateEndDateLabel ──
   Swaps the End Date label between "Completion Date" (for finished certs)
   and "Expected Completion Date" (for in-progress certs). Called whenever
   the "currently pursuing" checkbox changes, plus once at init.
   Only relevant for Cert-1 (where the checkbox is visible). For Cert-2+
   the label is set in applyPageRules and doesn't change. */
function updateEndDateLabel() {
  if (certificationNumber > 1) return;  /* Cert-2+ uses static label */

  const labelEl  = $("endDateLabel");
  const checkbox = $("isCurrent");
  if (!labelEl) return;

  const isCurrent = checkbox && checkbox.checked;
  labelEl.textContent = isCurrent
    ? "Expected Completion Date "
    : "End Date / Completion Date ";

  /* Re-append the * required marker (textContent assignment wiped it) */
  const star = document.createElement("span");
  star.className   = "required";
  star.textContent = "*";
  labelEl.appendChild(star);
}

/* ============================================================
   DEPENDENCY LOGIC
   ============================================================ */

function setupDependencies() {
  /* Currently pursuing checkbox → update label + helper text.
     Previously this disabled the end date fields, but users found that
     too restrictive — every certification has an expected completion
     date, and the user should still provide one even when "currently
     pursuing." So now:
     - End fields stay enabled
     - Label changes from "End Date / Completion Date" to "Expected Completion Date"
       to make it clear that an estimate is fine
     - Validation still requires the field to be filled (handled at save time) */
  const isCurrentCheckbox = $("isCurrent");
  if (isCurrentCheckbox) {
    isCurrentCheckbox.addEventListener("change", () => {
      updateEndDateLabel();
    });
  }

  /* Live credential URL feedback.
     - On input (while typing): only show the red hint if the URL
       cannot be normalised at all (e.g. user pasted a javascript:
       URL or just typed garbage). A user mid-typing "credly.co" is
       not yet a complete URL but it isn't broken either — be quiet.
     - On blur (user finished editing): apply the normaliser and
       write the cleaned value back, so the user SEES "https://"
       prepended, smart quotes stripped, etc. This also gives them
       a chance to correct truly bad input before save time.

     The hard validation still runs at save time inside validateForm. */
  const urlInput = $("credentialUrl");
  const urlHint  = $("credentialUrlHint");
  if (urlInput && urlHint) {
    const refresh = () => {
      const v = trim(urlInput.value);
      /* Empty -> no hint. Anything the normaliser accepts -> no hint.
         Only show the hint if the input is genuinely unfixable. */
      if (!v || normalizeAndValidateCredentialUrl(v)) {
        urlHint.classList.add("hidden");
      } else {
        urlHint.classList.remove("hidden");
      }
    };
    urlInput.addEventListener("input", refresh);
    urlInput.addEventListener("blur", () => {
      const v = trim(urlInput.value);
      if (v) {
        const cleaned = normalizeAndValidateCredentialUrl(v);
        if (cleaned && cleaned !== urlInput.value) {
          urlInput.value = cleaned;
        }
      }
      refresh();
    });
  }
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  applyPageRules();
  populateYears("startYear", { maxYear: new Date().getFullYear() });
  populateYears("endYear");
  setupDependencies();
  renderCertificationList();

  /* Wire up buttons */
  $("saveAnotherCertBtn").addEventListener("click", handleSaveAnother);
  $("saveContinueBtn").addEventListener("click", handleSaveContinue);

  /* Wire Cancel Edit button (hidden by default; shown only in edit mode) */
  const cancelBtn = $("cancelEditCertBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", exitEditMode);

  /* Load saved certifications from Supabase */
  loadAndRenderSavedCertifications();

  /* SaveNow integration — per-entry scope using certificationNumber.
     Each certification entry gets its own draft (Certification-1,
     Certification-2, etc.) so closing the tab mid-add of Cert-3
     doesn't lose your in-progress entry on reload. */
  SaveNow.init({
    pageName    : "certifications",
    formIds     : ["certificationForm"],
    entryNumber : () => certificationNumber,

    capturePayload: () => buildPayload(),

    /* Don't pollute localStorage with empty drafts. */
    isEmpty: () => !trim($("certName")?.value || "") &&
                   !trim($("issuer")?.value   || "") &&
                   !$("startMonth").value      &&
                   !$("startYear").value,

    apiSave: (payload) => apiSaveCertification(payload),

    /* Banner label includes the cert number for clarity */
    restoreLabel: (envelope) =>
      "on Certification-" +
      (envelope._meta && envelope._meta.scope || certificationNumber),

    restorePayload: (draft) => {
      const setVal = (id, v) => {
        const el = $(id);
        if (el && v != null) el.value = v;
      };
      setVal("certName",       draft.name);
      setVal("issuer",          draft.issuing_org);
      if ($("isCurrent") && draft.is_current === true) {
        $("isCurrent").checked = true;
      }
      setVal("startMonth",      draft.start_month);
      setVal("startYear",       draft.start_year);
      setVal("endMonth",        draft.end_month);
      setVal("endYear",         draft.end_year);
      setVal("credentialUrl",   draft.credential_url);

      /* Trigger conditional reveals */
      const cb = $("isCurrent");
      if (cb) cb.dispatchEvent(new Event("change"));
    }
  });
});

/* ============================================================
   LOAD SAVED CERTIFICATIONS FROM SUPABASE
   ============================================================
   Runs on page init. Fetches every certification row for this
   candidate, populates CertState.certifications for the saved-list,
   and advances certificationNumber so the form is for the NEXT entry.

   Errors are logged but don't show toasts on first page-load. */
async function loadAndRenderSavedCertifications() {
  if (!MC.candidateId) return;

  let rows;
  try {
    rows = await apiLoadAllCertifications();
  } catch (err) {
    console.error("[certifications] could not load saved certifications:", err);
    return;
  }

  if (!rows || rows.length === 0) return;

  /* Store FULL row objects — needed for edit mode (click → fill form). */
  CertState.certifications = rows;

  /* Advance certificationNumber to one PAST the highest saved entry. */
  let maxNum = 0;
  rows.forEach(r => {
    const n = parseInt(r.certification_number, 10) || 0;
    if (n > maxNum) maxNum = n;
  });
  certificationNumber = maxNum + 1;
  sessionStorage.setItem("cert_number", certificationNumber);

  /* Re-apply page rules now that certificationNumber may have changed
     (e.g. hides "currently pursuing" checkbox on Cert-2+). */
  applyPageRules();

  renderCertificationList();
}
