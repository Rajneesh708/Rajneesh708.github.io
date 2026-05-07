/* ============================================================
   MECULS — experience.js
   Single file. Zero duplicate listeners. All logic here.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.EXPERIENCE_VERSION
   "phase1-step3" means this file (with JSONB array save) is loaded. */
window.EXPERIENCE_VERSION = "phase1-step3";

/* ── Config ──
   candidateId comes from MC.candidateId (mc_helpers.js). */
const candidateId  = MC.candidateId;

/* ── Experience number — survives reload within same session ── */
let experienceNumber = parseInt(sessionStorage.getItem("exp_number") || "1");

/* ── In-memory state ── */
const ExpState = {
  experiences : [],   // all saved experience entries (for list rendering) — full rows from Supabase
  projectCount: 0     // project counter for current experience
};

/* ── Edit mode state ──
   When the user clicks an existing saved experience to edit it,
   we switch the page from "create new" mode to "edit existing" mode.
   This affects: page title, button labels, save behaviour
   (UPDATE vs INSERT), and what happens after save. */
const EditState = {
  mode      : "create",   // "create" | "edit"
  editingId : null,       // the database row id when editing
  editingNumber: null     // the experience_number when editing
};

/* ============================================================
   HELPERS
   All shared helpers come from mc_helpers.js (MC.* namespace).
   Aliased to local names so existing code is unchanged.
   ============================================================ */

const $          = MC.$;
const trim       = MC.trim;
const showPopup  = MC.showPopup;
const showToast  = MC.showToast;
const setLoading = MC.setLoading;

function populateYears(selectId) {
  /* Experience dates cannot be in the future:
     - Start year: latest is current year (you can't have started a job tomorrow)
     - End year: latest is also current year (you can't have ended one in 2055)
     We cap both at the current year. Min year stays at 1930 (deep past). */
  const sel = $(selectId);
  sel.innerHTML = '<option value="">Year</option>';
  const maxYear = new Date().getFullYear();
  for (let y = maxYear; y >= 1930; y--) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
}

/* ── Future-month check ──
   Returns true if (month, year) is later than the current calendar month.
   The year dropdown caps at the current calendar year, but a user could
   still pick a future MONTH in the current year (e.g. June 2026 in May
   2026). This catches that at validation time.

   Used for both start and end dates: you cannot have started a job in
   the future, and you cannot have ENDED one in the future either —
   currently-pursuing roles use isCurrent instead of an end date. */
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
   API — Supabase
   ============================================================
   Phase 1 Step 3: converted from the dropped 'experiences' table
   to an array stored at profiles.data.experiences (JSONB).

   The data shape is now an array of experience-objects. Each entry
   has its own client-generated `id` (UUID) plus all the same fields
   the old database row had — including experience_number for ordering.

   How to think about it:
   - apiLoadAllExperiences: returns the array, sorted by experience_number
   - apiSaveExperience: load array, append new entry, save back
   - apiUpdateExperience: load, find-by-id, replace fields, save back
   - apiDeleteExperience: load, filter-out-by-id, save back
   - apiLoadOneExperience: load, find-by-id

   Race-condition note: if the same user opens this page in two tabs
   and edits experiences in BOTH simultaneously, one tab's changes
   may overwrite the other's. Acceptable for Phase 1 (single founder
   user). The server-side jsonb_set in save_profile_section is
   atomic at the SECTION level — it doesn't help with within-array
   races. Documenting here so a future Claude doesn't get surprised.

   The variable name 'candidate_id' from the old code is no longer
   passed in payloads — auth.uid() is enforced server-side by the
   save_profile_section RPC. */

/* ── Internal helper: load the experiences array, default to []. ── */
async function _loadExperiencesArray() {
  const arr = await MC.loadSection("experiences");
  return Array.isArray(arr) ? arr : [];
}

/* ── Internal helper: build a clean experience entry from a payload.
   Assigns a new client-side id if one is not provided. ── */
function _buildExperienceEntry(payload, existingId) {
  return {
    id                      : existingId || _newId(),
    experience_number       : payload.experience_number || 1,
    company_name            : payload.company_name            || null,
    designation             : payload.designation             || null,
    is_current              : !!payload.is_current,
    role_headline           : payload.role_headline           || null,
    role_description        : payload.role_description        || null,
    employment_type         : payload.employment_type         || null,
    sector                  : payload.sector                  || null,
    industry                : payload.industry                || null,
    industry_other          : payload.industry_other          || null,
    industry_function       : payload.industry_function       || null,
    department              : payload.department              || null,
    department_other        : payload.department_other        || null,
    domain_specialization   : payload.domain_specialization   || null,
    ctc_fixed               : (payload.ctc_fixed === null || payload.ctc_fixed === undefined)
                              ? null : Number(payload.ctc_fixed),
    ctc_fixed_currency      : payload.ctc_fixed_currency      || null,
    ctc_fixed_currency_other: payload.ctc_fixed_currency_other|| null,
    ctc_variable            : (payload.ctc_variable === null || payload.ctc_variable === undefined)
                              ? null : Number(payload.ctc_variable),
    ctc_var_currency        : payload.ctc_var_currency        || null,
    ctc_var_currency_other  : payload.ctc_var_currency_other  || null,
    country                 : payload.country                 || null,
    country_other           : payload.country_other           || null,
    state                   : payload.state                   || null,
    city                    : payload.city                    || null,
    location_type           : payload.location_type           || null,
    domain_skills           : payload.domain_skills           || null,
    tech_skills             : payload.tech_skills             || null,
    soft_skills             : payload.soft_skills             || null,
    start_month             : payload.start_month             || null,
    start_year              : payload.start_year              || null,
    end_month               : payload.end_month               || null,
    end_year                : payload.end_year                || null,
    projects                : Array.isArray(payload.projects) ? payload.projects : []
  };
}

/* ── Internal helper: generate a unique id for a new entry.
   Replaces the old database BIGSERIAL. Uses crypto.randomUUID()
   (modern browsers); falls back to a timestamp+random hybrid for
   ancient browsers that lack the API. ── */
function _newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "exp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

async function apiSaveExperience(payload) {
  const arr = await _loadExperiencesArray();
  const entry = _buildExperienceEntry(payload, null);
  arr.push(entry);
  await MC.saveSection("experiences", arr);
  return entry;
}

/* Load ALL experience entries for the current candidate, ordered by
   experience_number. Used on page load to (a) re-render the saved
   list at top and (b) determine the next experience_number. */
async function apiLoadAllExperiences() {
  const arr = await _loadExperiencesArray();
  arr.sort(function (a, b) {
    return (a.experience_number || 0) - (b.experience_number || 0);
  });
  return arr;
}

/* Load ONE experience entry by its id. Used when the user clicks an
   existing saved experience to edit it. */
async function apiLoadOneExperience(id) {
  const arr = await _loadExperiencesArray();
  return arr.find(function (e) { return e.id === id; }) || null;
}

/* Update an existing experience entry by id. The whole entry is
   rebuilt from the payload (preserving the original id) and replaces
   the matching slot in the array. */
async function apiUpdateExperience(id, payload) {
  const arr = await _loadExperiencesArray();
  const idx = arr.findIndex(function (e) { return e.id === id; });
  if (idx < 0) {
    throw new Error("Could not save changes: experience not found");
  }
  arr[idx] = _buildExperienceEntry(payload, id);
  await MC.saveSection("experiences", arr);
  return arr[idx];
}

/* Delete an experience entry by id. */
async function apiDeleteExperience(id) {
  const arr = await _loadExperiencesArray();
  const filtered = arr.filter(function (e) { return e.id !== id; });
  await MC.saveSection("experiences", filtered);
  return true;
}

/* ============================================================
   RENDER SAVED EXPERIENCE LIST
   ============================================================ */

function renderExperienceList() {
  const list = $("experience-list");
  list.innerHTML = "";

  /* If we're in edit mode, hide the saved-list entirely.
     The user is currently editing one entry; showing the list of
     all entries during edit creates a confusing UI. They'll see it
     again after they save changes or cancel. */
  if (EditState.mode === "edit") return;

  if (ExpState.experiences.length === 0) return;

  const heading = document.createElement("h3");
  heading.className = "entry-title";
  heading.textContent = "Saved Experiences";
  list.appendChild(heading);

  ExpState.experiences.forEach((exp, index) => {
    const div = document.createElement("div");
    div.className = "exp-list-card";

    /* Info container — shows summary of the saved experience */
    const info = document.createElement("div");
    info.className = "exp-list-card__info";

    /* "Experience N — Designation" line.
       textContent on each piece — no innerHTML interpolation of
       user-supplied designation/company_name. */
    const titleEl = document.createElement("strong");
    const expNum = exp.experience_number || (index + 1);
    titleEl.textContent =
      "Experience " + expNum + " \u2014 " +
      (trim(exp.designation || "") || "\u2014");
    info.appendChild(titleEl);

    const companyEl = document.createElement("span");
    companyEl.textContent = trim(exp.company_name || "") || "\u2014";
    info.appendChild(companyEl);

    div.appendChild(info);

    /* Action buttons: Edit + Delete */
    const actions = document.createElement("div");
    actions.className = "exp-list-card__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "exp-list-card__btn exp-list-card__btn--edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", function () {
      enterEditMode(exp);
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "exp-list-card__btn exp-list-card__btn--delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", function () {
      handleDeleteExperience(exp);
    });
    actions.appendChild(deleteBtn);

    div.appendChild(actions);

    /* Make the whole info area clickable too — click anywhere except
       the buttons enters edit mode. */
    info.style.cursor = "pointer";
    info.addEventListener("click", function () {
      enterEditMode(exp);
    });

    list.appendChild(div);
  });
}

/* ============================================================
   BUILD SUBMIT PAYLOAD
   ============================================================ */

/* Gather project sub-section data from the DOM into a clean array.
   Each .project-box has 6 inputs in a known order:
     1. Project Name    (textarea, max 300)
     2. Duration        (number input, months)
     3. Team Size       (number input)
     4. Ask             (textarea, max 300)
     5. Role            (textarea, max 1000)
     6. Deliverable     (textarea, max 1000)
   If user said "no projects" or all fields empty, returns []. */
function gatherProjects() {
  if ($("hasProjects") && $("hasProjects").value !== "yes") return [];
  const boxes = document.querySelectorAll(".project-box");
  const out = [];
  boxes.forEach(box => {
    const fields = box.querySelectorAll("input, textarea");
    if (fields.length < 6) return;
    const name        = trim(fields[0].value);
    const duration    = trim(fields[1].value);
    const teamSize    = trim(fields[2].value);
    const ask         = trim(fields[3].value);
    const role        = trim(fields[4].value);
    const deliverable = trim(fields[5].value);
    /* Skip wholly-empty boxes (e.g. one auto-added but never filled) */
    if (!name && !duration && !teamSize && !ask && !role && !deliverable) return;
    out.push({
      name            : name,
      duration_months : duration ? parseInt(duration, 10) : null,
      team_size       : teamSize ? parseInt(teamSize, 10) : null,
      ask             : ask,
      role            : role,
      deliverable     : deliverable
    });
  });
  return out;
}

function buildPayload() {
  return {
    candidate_id      : MC.candidateId,
    experience_number : experienceNumber,
    company_name      : trim($("company").value),
    is_current        : $("isCurrent")?.checked || false,
    designation       : trim($("designation").value),
    role_headline     : trim($("roleHeadline").value),
    role_description  : trim($("roleDescription").value),
    employment_type   : $("employmentType").value,
    sector            : $("sector").value,
    industry          : $("industry").value,
    industry_other    : trim($("industry_other").value) || null,
    industry_function : trim($("industryFunction").value),
    department        : $("department").value,
    department_other  : trim($("department_other").value) || null,
    domain_specialization: trim($("domainSpecialization").value),
    ctc_fixed         : parseFloat($("ctcFixed").value) || null,
    ctc_fixed_currency: $("ctcFixedCurrency").value,
    ctc_fixed_currency_other: trim($("ctcFixedCurrencyOther").value) || null,
    ctc_variable      : parseFloat($("ctcVariable").value) || null,
    ctc_var_currency  : $("ctcVarCurrency").value,
    ctc_var_currency_other: trim($("ctcVarCurrencyOther").value) || null,
    country           : $("country").value,
    country_other     : trim($("country_other").value) || null,
    state             : trim($("state").value),
    city              : trim($("city").value),
    location_type     : $("locationType").value,
    domain_skills     : trim($("domainSkills").value),
    tech_skills       : trim($("techSkills").value),
    soft_skills       : trim($("softSkills").value),
    start_month       : $("startMonth").value,
    start_year        : $("startYear").value,
    end_month         : $("endMonth").value || null,
    end_year          : $("endYear").value  || null,
    projects          : gatherProjects()
  };
}

/* ============================================================
   PROJECTS
   ============================================================ */

function projectComplete(box) {
  const fields = [...box.querySelectorAll("input, textarea")];
  const hasAny = fields.some(f => trim(f.value));
  if (!hasAny) return false;
  return fields.every(f => trim(f.value));
}

function addProject() {
  if (ExpState.projectCount > 0) {
    const boxes = document.querySelectorAll(".project-box");
    const last  = boxes[boxes.length - 1];
    if (!projectComplete(last)) {
      const label = last.querySelector("h4")?.textContent || "this project";
      showPopup(`Please complete all fields in "${label}" before adding another.`);
      return;
    }
  }

  ExpState.projectCount++;
  /* Project header label needs the experience number this project belongs to.
     - In CREATE mode: use the global experienceNumber (the experience being added)
     - In EDIT mode: use EditState.editingNumber (the experience being edited)
     Without this, editing Experience-1 while experienceNumber=3 would label
     newly-added projects as "Experience-3" instead of "Experience-1". */
  const expNumForLabel = (EditState.mode === "edit" && EditState.editingNumber)
                       ? EditState.editingNumber
                       : experienceNumber;
  const expLabel  = "Experience-" + expNumForLabel;
  const projLabel = "Project-" + ExpState.projectCount + " (" + expLabel + ")";

  const div = document.createElement("div");
  div.className = "project-box";
  div.innerHTML = `
    <h4>${projLabel}</h4>

    <div class="field-group">
      <label class="field-label">Project Name (Max. 300 characters) <span class="required">*</span></label>
      <textarea class="field-textarea" maxlength="300" required
        oninput="updateExpCounter(this,'pname_${ExpState.projectCount}')"></textarea>
      <div class="char-counter-out" id="pname_${ExpState.projectCount}">0 / 300</div>
    </div>

    <div class="field-group">
      <label class="field-label">Project Duration (In Months) <span class="required">*</span></label>
      <input type="number" class="field-input" min="1" required>
    </div>

    <div class="field-group">
      <label class="field-label">Project Team Size <span class="required">*</span></label>
      <input type="number" class="field-input" min="1" required>
    </div>

    <div class="field-group">
      <label class="field-label">What was the ask? (Max. 300 characters) <span class="required">*</span></label>
      <textarea class="field-textarea" maxlength="300" required
        oninput="updateExpCounter(this,'ask_${ExpState.projectCount}')"></textarea>
      <div class="char-counter-out" id="ask_${ExpState.projectCount}">0 / 300</div>
    </div>

    <div class="field-group">
      <label class="field-label">What was your role? (Max. 1,000 characters) <span class="required">*</span></label>
      <textarea class="field-textarea" maxlength="1000" required
        oninput="updateExpCounter(this,'role_${ExpState.projectCount}')"></textarea>
      <div class="char-counter-out" id="role_${ExpState.projectCount}">0 / 1,000</div>
    </div>

    <div class="field-group">
      <label class="field-label">What was the end deliverable? (Max. 1,000 characters) <span class="required">*</span></label>
      <textarea class="field-textarea" maxlength="1000" required
        oninput="updateExpCounter(this,'deliv_${ExpState.projectCount}')"></textarea>
      <div class="char-counter-out" id="deliv_${ExpState.projectCount}">0 / 1,000</div>
    </div>
  `;

  $("projects").appendChild(div);
  autoGrowAll();
}

function updateExpCounter(el, id) {
  const counter = $(id);
  if (counter) {
    const max = el.getAttribute("maxlength");
    counter.textContent = el.value.length + " / " + (max.length > 3
      ? max.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : max);
  }
}

/* ============================================================
   AUTO-GROW TEXTAREAS
   autoGrow comes from mc_helpers.js (MC.autoGrow).
   ============================================================ */

const autoGrow = MC.autoGrow;

function autoGrowAll() {
  document.querySelectorAll("textarea").forEach(ta => {
    autoGrow(ta);
    /* Avoid adding duplicate listeners */
    if (!ta._autoGrowBound) {
      ta.addEventListener("input", () => autoGrow(ta));
      ta._autoGrowBound = true;
    }
  });
}

/* ============================================================
   CHAR COUNTERS (role headline + description)
   ============================================================ */

function setupCharCounters() {
  [["roleHeadline","rh"],["roleDescription","rd"]].forEach(([fieldId, counterId]) => {
    $(fieldId).addEventListener("input", () => {
      const el  = $(fieldId);
      const max = el.getAttribute("maxlength");
      $(counterId).textContent = el.value.length + " / " + max;
    });
  });
}

/* ============================================================
   SKILL LIMITERS
   ============================================================ */

function limitSkills(fieldId, max, msg) {
  const field   = $(fieldId);
  const counter = $(fieldId + "Count");
  if (!field) return;

  /* Rising-edge guard prevents the popup from re-firing on every keystroke
     when count is already over the cap. It only fires when count CROSSES
     from ≤max to >max. Resets when user gets back to ≤max. */
  let warned = false;

  function update() {
    const items = field.value.split(",").map(s => trim(s)).filter(Boolean);
    if (items.length > max) {
      if (!warned) {
        showPopup(msg);
        warned = true;
      }
      field.value = items.slice(0, max).join(", ");
    } else {
      warned = false;
    }
    if (counter) {
      const count = field.value.split(",").map(s => trim(s)).filter(Boolean).length;
      counter.textContent = count + " / " + max + " skills";
      counter.classList.toggle("char-counter-out--warn",  count === max);
      counter.classList.toggle("char-counter-out--limit", count > max);
    }
  }

  field.addEventListener("input", update);
  /* Set initial count on page load (in case form was prefilled by JS) */
  update();
}

/* ============================================================
   DOMAIN SPECIALIZATION LIMITER
   ============================================================ */

function setupDomainLimit() {
  $("domainSpecialization").addEventListener("input", () => {
    const field = $("domainSpecialization");
    const items = field.value.split(",").map(s => trim(s)).filter(Boolean);
    if (items.length > 5) {
      showPopup("Maximum 5 domain specializations allowed.");
      field.value = items.slice(0, 5).join(", ");
    }
  });
}

/* ============================================================
   DEPENDENCY LOGIC
   ============================================================ */

function setupDependencies() {

  /* Industry other */
  $("industry").addEventListener("change", () => {
    $("industry_other").classList.toggle("hidden", !$("industry").value.includes("Other"));
  });

  /* Department other */
  $("department").addEventListener("change", () => {
    $("department_other").classList.toggle("hidden", !$("department").value.includes("Other"));
  });

  /* Country other */
  $("country").addEventListener("change", () => {
    $("country_other").classList.toggle("hidden", !$("country").value.includes("Other"));
  });

  /* ── Dynamic CTC label + helper updater.
     Indian users think in Lacs (₹4.25 = ₹4,25,000). Foreign currency
     users think in actual amounts (USD 150,000). The label and helper
     adjust based on the currency selected so the user knows exactly
     what to type. The label prefix also adjusts for Experience-2+
     ("Last Drawn" vs "Current / Last Drawn"). ── */
  function updateCtcLabel(selectId, labelId, helperId, kind) {
    const sel    = $(selectId);
    const label  = $(labelId);
    const helper = $(helperId);
    if (!sel || !label || !helper) return;

    /* Decide the label prefix based on whether THIS experience is current.
       - CREATE mode + Experience-1 → "Current / Last Drawn" (might be current job)
       - CREATE mode + Experience-2+ → "Last Drawn" (always past, checkbox is hidden)
       - EDIT mode → look at the actual is_current value of the experience
         being edited (read from the checkbox state). This matters when
         editing Experience-1 (originally a current job): experienceNumber is
         now 3 (next one to be added), but the experience being edited is
         still current, so the label should say "Current / Last Drawn". */
    let isThisOneCurrent;
    if (EditState.mode === "edit") {
      isThisOneCurrent = !!($("isCurrent") && $("isCurrent").checked);
    } else {
      isThisOneCurrent = (experienceNumber === 1);
    }
    const titlePrefix = isThisOneCurrent ? "Current / Last Drawn" : "Last Drawn";
    const baseLabel = titlePrefix + ' CTC ' + ((kind === "fixed") ? '(Fixed)' : '(Variable)');
    const requiredMark = (kind === "fixed") ? ' <span class="required">*</span>' : '';
    const optionalNote = (kind === "fixed") ? '' : 'Optional. ';

    const val = sel.value;

    if (!val) {
      label.innerHTML  = baseLabel + requiredMark;
      helper.textContent = optionalNote + "Pick a currency below first; we'll show how to enter the amount.";
      return;
    }

    if (val === "INR") {
      label.innerHTML  = baseLabel + ' &mdash; Amount in Lacs' + requiredMark;
      helper.textContent = optionalNote + "Enter in lacs. e.g., for \u20B94,25,000 type 4.25 \u2014 for \u20B915,00,000 type 15.";
    } else if (val.includes("Other")) {
      label.innerHTML  = baseLabel + ' &mdash; Amount in your specified currency' + requiredMark;
      helper.textContent = optionalNote + "Enter the full amount in the currency you specify on the right.";
    } else {
      label.innerHTML  = baseLabel + ' &mdash; Amount in ' + val + requiredMark;
      helper.textContent = optionalNote + "Enter the full amount. e.g., for " + val + " 150,000 type 150000.";
    }
  }

  /* CTC fixed currency → show/hide Other field, auto-sync variable, update label */
  $("ctcFixedCurrency").addEventListener("change", () => {
    const val = $("ctcFixedCurrency").value;
    $("ctcFixedCurrencyOther").classList.toggle("hidden", !val.includes("Other"));

    /* Auto-select same currency for variable */
    const varSel = $("ctcVarCurrency");
    [...varSel.options].forEach((opt, i) => {
      if (opt.value === val) varSel.selectedIndex = i;
    });
    $("ctcVarCurrencyOther").classList.toggle("hidden", !val.includes("Other"));

    /* Update both labels (variable mirrors fixed when synced) */
    updateCtcLabel("ctcFixedCurrency", "ctcFixedLabel", "ctcFixedHelper", "fixed");
    updateCtcLabel("ctcVarCurrency",   "ctcVarLabel",   "ctcVarHelper",   "variable");
  });

  $("ctcVarCurrency").addEventListener("change", () => {
    $("ctcVarCurrencyOther").classList.toggle("hidden",
      !$("ctcVarCurrency").value.includes("Other"));
    updateCtcLabel("ctcVarCurrency", "ctcVarLabel", "ctcVarHelper", "variable");
  });

  /* Set initial labels on page load (in case JS-driven defaults applied before user clicks) */
  updateCtcLabel("ctcFixedCurrency", "ctcFixedLabel", "ctcFixedHelper", "fixed");
  updateCtcLabel("ctcVarCurrency",   "ctcVarLabel",   "ctcVarHelper",   "variable");

  /* Currently working → hide End Date row entirely (clearer than disabling) */
  if ($("isCurrent")) {
    $("isCurrent").addEventListener("change", () => {
      const checked = $("isCurrent").checked;
      const endGroup = $("endDateGroup");
      if (endGroup) endGroup.classList.toggle("hidden", checked);
      if (checked) {
        $("endMonth").value = "";
        $("endYear").value  = "";
      }
      /* Re-enable in case they toggle back (was previously disabled in some flows) */
      $("endMonth").disabled = false;
      $("endYear").disabled  = false;
      /* CTC label depends on whether THIS experience is current — refresh
         both labels when the checkbox toggles so the "Current/Last Drawn"
         vs "Last Drawn" prefix stays accurate. */
      updateCtcLabel("ctcFixedCurrency", "ctcFixedLabel", "ctcFixedHelper", "fixed");
      updateCtcLabel("ctcVarCurrency",   "ctcVarLabel",   "ctcVarHelper",   "variable");
    });
  }

  /* Projects toggle */
  $("hasProjects").addEventListener("change", () => {
    $("projectSection").classList.toggle("hidden", $("hasProjects").value !== "yes");
  });

  /* Add project button */
  $("addProjectBtn").addEventListener("click", addProject);
}

/* ============================================================
   VALIDATE BEFORE SAVE
   ============================================================ */

function validateForm() {
  /* Each entry: [valueExpression, friendlyFieldName].
     We collect ALL missing fields and show them in one popup so the
     user sees everything at once, not one error at a time. With 20+
     required fields, the original "stop at first" UX would force the
     user to click Save 20 times to discover everything. */
  const checks = [
    [trim($("company").value),         "Company Name"],
    [trim($("designation").value),     "Designation"],
    [trim($("roleHeadline").value),    "Role Headline"],
    [trim($("roleDescription").value), "Role Description"],
    [$("employmentType").value,        "Employment Type"],
    [$("sector").value,                "Sector"],
    [$("industry").value,              "Industry"],
    [trim($("industryFunction").value),"Industry Function"],
    [$("department").value,            "Department"],
    [trim($("domainSpecialization").value), "Domain Specialization"],
    [$("ctcFixed").value,              "Fixed CTC Amount"],
    [$("ctcFixedCurrency").value,      "Fixed CTC Currency"],
    [$("country").value,               "Country"],
    [trim($("state").value),           "State"],
    [trim($("city").value),            "City"],
    [$("locationType").value,          "Location Type"],
    [trim($("domainSkills").value),    "Domain Specific Skills"],
    [trim($("techSkills").value),      "Technical Skills"],
    [trim($("softSkills").value),      "Soft Skills"],
    [$("startMonth").value,            "Start Month"],
    [$("startYear").value,             "Start Year"],
  ];

  /* End Date: required if not currently working here.
     Experience-2+ has the "currently working" checkbox hidden, so isCurrent
     is always false, so End Date is always required for past experiences. */
  const isCurrent = $("isCurrent") && $("isCurrent").checked;
  if (!isCurrent) {
    checks.push([$("endMonth").value, "End Month"]);
    checks.push([$("endYear").value,  "End Year"]);
  }

  /* Collect every missing required field. */
  const missing = [];
  for (const [val, name] of checks) {
    if (!val) missing.push(name);
  }

  /* "Other (please specify)" reveal inputs — must be filled when "Other" is selected.
     These are conditional, so they're checked separately and added to the
     missing list so the user gets one consolidated popup. */
  if ($("industry").value.includes("Other") && !trim($("industry_other").value)) {
    missing.push("Industry — please specify");
  }
  if ($("department").value.includes("Other") && !trim($("department_other").value)) {
    missing.push("Department — please specify");
  }
  if ($("country").value.includes("Other") && !trim($("country_other").value)) {
    missing.push("Country — please specify");
  }
  if ($("ctcFixedCurrency").value.includes("Other") && !trim($("ctcFixedCurrencyOther").value)) {
    missing.push("Fixed CTC Currency — please specify");
  }
  if ($("ctcVarCurrency").value && $("ctcVarCurrency").value.includes("Other") && !trim($("ctcVarCurrencyOther").value)) {
    missing.push("Variable CTC Currency — please specify");
  }

  /* Show all missing fields in one popup. */
  if (missing.length === 1) {
    showPopup("Please fill in: " + missing[0] + ".");
    return false;
  }
  if (missing.length > 1) {
    showPopup(
      "Please fill in the following required fields before continuing:\n\n\u2022 " +
      missing.join("\n\u2022 ")
    );
    return false;
  }

  /* Date logic — three checks, in order:
     1. Start date cannot be in the future. The year dropdown caps at
        the current year, but a user could still pick (e.g.) June 2026
        in May 2026 — that's a future month within the current year.
     2. End date cannot be in the future for COMPLETED roles. Skipped
        when "currently working here" is ticked (no end date set).
     3. End date must not be before start date (existing check). */

  /* (1) Future start date */
  if (_isFutureMonth($("startMonth").value, $("startYear").value)) {
    showPopup(
      "Start date cannot be in the future. " +
      "Please pick a month and year that is not later than the current month."
    );
    return false;
  }

  /* (2) Future end date — only for completed roles */
  if (!isCurrent && _isFutureMonth($("endMonth").value, $("endYear").value)) {
    showPopup(
      "End date cannot be in the future for a past role. " +
      "If you are still working here, tick \"I am currently working here\" instead."
    );
    return false;
  }

  /* (3) End Date ≥ Start Date validation (only when end date is provided) */
  if (!isCurrent && $("endYear").value && $("endMonth").value) {
    const startYM = parseInt($("startYear").value, 10) * 12 + parseInt($("startMonth").value, 10);
    const endYM   = parseInt($("endYear").value,   10) * 12 + parseInt($("endMonth").value,   10);
    if (endYM < startYM) {
      showPopup("End date cannot be earlier than start date. Please correct the dates.");
      return false;
    }
  }

  /* Skills count caps — although limitSkills already truncates on input,
     verify here in case someone bypassed the input event (e.g. paste-then-submit
     in some edge browsers). */
  const skillCheck = (fieldId, max, label) => {
    const items = $(fieldId).value.split(",").map(s => trim(s)).filter(Boolean);
    if (items.length > max) {
      showPopup("Maximum " + max + " " + label + " allowed. You have entered " + items.length + ".");
      $(fieldId).focus();
      return false;
    }
    return true;
  };
  if (!skillCheck("domainSkills", 3, "Domain Specific Skills")) return false;
  if (!skillCheck("techSkills",   3, "Technical Skills"))      return false;
  if (!skillCheck("softSkills",   3, "Soft Skills"))           return false;

  return true;
}

/* ============================================================
   SAVE NOW + DRAFT RESTORE
   All Save Now logic lives in save_now.js (shared module).
   This page calls SaveNow.init({...}) in DOMContentLoaded
   and SaveNow.clearDraft() after successful Save & Continue.
   ============================================================ */

/* ============================================================
   SAVE & ADD ANOTHER EXPERIENCE
   ============================================================ */

async function handleSaveAnother() {
  /* Disable required on hidden/empty project fields first */
  if ($("hasProjects").value === "no") {
    $("projectSection").querySelectorAll("input, textarea").forEach(f => {
      f.required = false;
    });
  }

  if (!validateForm()) return;

  const btn = $("saveAnotherExperienceBtn");
  setLoading(btn, true);

  const payload = buildPayload();

  /* ─── EDIT MODE: UPDATE the existing row instead of creating new ─── */
  if (EditState.mode === "edit" && EditState.editingId) {
    /* Preserve the original experience_number on update */
    payload.experience_number = EditState.editingNumber;

    try {
      await apiUpdateExperience(EditState.editingId, payload);
    } catch (err) {
      console.error("Experience update failed:", err);
      showToast("Could not save changes. Please try again.", "error");
      setLoading(btn, false);
      return;
    }

    setLoading(btn, false);
    showToast("Changes saved!", "success");

    /* Exit edit mode and reload to show updated saved-list */
    setTimeout(() => window.location.reload(), 800);
    return;
  }

  /* ─── CREATE MODE: INSERT new entry ─── */
  let savedEntry;
  try {
    /* apiSaveExperience returns the full saved entry INCLUDING the new
       UUID `id`. Capture it. The window.location.reload() below will
       refresh the in-memory list anyway, but if a future change ever
       removes that reload (e.g. for smoother UX), the saved entry must
       carry its id so edit/delete buttons work without a hard refresh. */
    savedEntry = await apiSaveExperience(payload);
  } catch (err) {
    console.error("Experience save failed:", err);
    showToast("Could not save to server. Please try again.");
    setLoading(btn, false);
    return;
  }

  /* Store the full saved entry (with id) in memory for list rendering. */
  ExpState.experiences.push(savedEntry);

  /* Saved successfully — clear THIS experience's draft */
  SaveNow.clearDraft();

  /* Increment counter and persist */
  experienceNumber++;
  sessionStorage.setItem("exp_number", experienceNumber);

  setLoading(btn, false);
  showToast("Experience saved! Loading form for Experience-" + experienceNumber + "…", "success");

  /* Brief pause so user sees the success message, then reload */
  setTimeout(() => window.location.reload(), 1200);
}

/* ============================================================
   SAVE & CONTINUE
   If the form has any data, validate + save it to the backend before
   navigating. If the form is completely empty (because the user has
   already added experiences via "Save & Add Another" and now wants to
   continue), navigate directly. Mirrors certifications.js pattern.
   ============================================================ */

async function handleSaveContinue() {
  const btn = $("saveContinueBtn");

  /* Detect whether the user has typed anything into the form. If everything
     is empty AND they have already added at least one experience, this is
     the "I'm done adding experiences, continue" path — no save needed. */
  const hasAnyInput = trim($("company").value)     ||
                      trim($("designation").value) ||
                      trim($("roleHeadline").value);

  if (!hasAnyInput) {
    if (ExpState.experiences.length === 0) {
      showPopup("Please add at least one experience before continuing.");
      return;
    }
    /* User has added experiences earlier and the form is empty —
       just mark complete and navigate. */
    sessionStorage.removeItem("exp_number");
    if (window.SaveNow) SaveNow.clearDraft();
    localStorage.setItem("experience_completed", "yes");
    localStorage.setItem(
      "profile_last_updated",
      new Date().toLocaleDateString("en-US")
    );
    window.parent.postMessage(
      {
        type      : "navigate",
        page      : "education.html",
        sidebarKey: "Your Education"
      },
      "*"
    );
    return;
  }

  /* User has filled (some of) the form — validate and save it before
     navigating, so their data isn't lost. */
  if ($("hasProjects").value === "no") {
    $("projectSection").querySelectorAll("input, textarea").forEach(f => {
      f.required = false;
    });
  }
  if (!validateForm()) return;

  setLoading(btn, true);

  const payload = buildPayload();

  try {
    await apiSaveExperience(payload);
  } catch (err) {
    console.error("Experience save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(btn, false);
    return;
  }

  /* Store in memory for list rendering / state consistency */
  ExpState.experiences.push({
    company_name : payload.company_name,
    designation  : payload.designation
  });

  /* Saved successfully — clear session counter and the active draft */
  sessionStorage.removeItem("exp_number");
  if (window.SaveNow) SaveNow.clearDraft();

  localStorage.setItem("experience_completed", "yes");
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* Navigate parent dashboard to Your Education */
  window.parent.postMessage(
    {
      type      : "navigate",
      page      : "education.html",
      sidebarKey: "Your Education"
    },
    "*"
  );

  setTimeout(() => setLoading(btn, false), 800);
}

/* ============================================================
   LOAD SAVED EXPERIENCES FROM SUPABASE
   ============================================================
   Runs on page init. Fetches every experience row for this candidate,
   populates ExpState.experiences for the saved-list rendering, and
   advances experienceNumber so the form is for the NEXT entry.

   If the load fails (e.g. network drops), we fall back gracefully:
   the form still works, the user can still add new entries; only the
   saved-list at top will be empty until next visit. We surface the
   error to the console only — no toast — so first-page-load is quiet. */
async function loadAndRenderSavedExperiences() {
  if (!MC.candidateId) return;

  let rows;
  try {
    rows = await apiLoadAllExperiences();
  } catch (err) {
    console.error("[experience] could not load saved experiences:", err);
    return;
  }

  if (!rows || rows.length === 0) return;

  /* Store FULL row objects — needed for edit mode (click → fill form). */
  ExpState.experiences = rows;

  /* Advance experienceNumber to one PAST the highest saved entry. */
  let maxNum = 0;
  rows.forEach(r => {
    const n = parseInt(r.experience_number, 10) || 0;
    if (n > maxNum) maxNum = n;
  });
  experienceNumber = maxNum + 1;
  sessionStorage.setItem("exp_number", experienceNumber);

  /* Re-apply page rules now that experienceNumber may have changed
     (e.g. "Last Drawn" instead of "Current / Last Drawn"). */
  applyPageRules();

  renderExperienceList();
}

/* ============================================================
   EDIT MODE
   ============================================================
   Click an existing saved experience → load its data into the form,
   change buttons to "Save Changes" / "Cancel", let the user update
   and save. UPDATEs the row instead of INSERTing a new one. */

async function enterEditMode(exp) {
  /* If we don't have the full row in memory (defensive), fetch it.
     Normally ExpState.experiences holds full rows from
     loadAndRenderSavedExperiences. */
  let row = exp;
  if (!row.id || row.company_name === undefined) {
    try {
      row = await apiLoadOneExperience(exp.id);
    } catch (err) {
      showToast("Could not load that experience. Please try again.", "error");
      return;
    }
  }
  if (!row) {
    showToast("Could not find that experience.", "error");
    return;
  }

  /* Switch state */
  EditState.mode          = "edit";
  EditState.editingId     = row.id;
  EditState.editingNumber = row.experience_number;

  /* Update UI */
  applyEditModeUI();

  /* Fill the form with the row's data */
  populateFormFromRow(row);

  /* Hide the saved-list (renderExperienceList honours edit mode) */
  renderExperienceList();

  /* Scroll to top of form so user sees they're editing */
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitEditMode() {
  EditState.mode          = "create";
  EditState.editingId     = null;
  EditState.editingNumber = null;

  /* Restore "create new" UI: page title, button labels, hide cancel */
  applyEditModeUI();

  /* Clear all form fields by reloading the page. This is the cleanest
     way to reset everything (including dynamically-added project boxes,
     conditional blocks, and auto-grown textarea heights). The saved
     experiences will reload from Supabase. */
  window.location.reload();
}

/* Update page title + button labels based on EditState.mode.
   Also shows/hides the "Cancel Edit" button. */
function applyEditModeUI() {
  const titleEl    = $("pageTitle");
  const saveBtn    = $("saveAnotherExperienceBtn");
  const cancelBtn  = $("cancelEditBtn");
  const continueBtn= $("saveContinueBtn");
  /* The "Currently working here" checkbox container. Hidden by
     applyPageRules() whenever experienceNumber > 1 (because new
     experiences after the first cannot be the user's current job).
     But when EDITING a past experience that was originally Experience-1
     (a current job), the user must be able to see/toggle this checkbox
     while editing — so we re-show it during edit mode and let
     exitEditMode's reload restore the hidden state for fresh adds. */
  const cwCheckbox = $("currentWorkCheckbox");

  if (EditState.mode === "edit") {
    if (titleEl) titleEl.textContent = "Edit Experience-" + EditState.editingNumber;
    if (saveBtn) saveBtn.textContent = "Save Changes";
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    /* Hide "Save & Continue to Education" — user is editing, not progressing */
    if (continueBtn) continueBtn.classList.add("hidden");
    /* Make the currently-working checkbox visible during edit, regardless
       of experienceNumber. The user owns this experience and should be
       able to change is_current. */
    if (cwCheckbox) cwCheckbox.classList.remove("hidden");
  } else {
    if (titleEl) titleEl.textContent = "Add Experience-" + experienceNumber;
    if (saveBtn) saveBtn.innerHTML = '<span class="btn-icon">&#10133;</span> Save &amp; Add Another Experience';
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (continueBtn) continueBtn.classList.remove("hidden");
    /* Don't toggle cwCheckbox visibility here — applyPageRules already
       set it correctly for create mode at page load, and edit→cancel
       does a full reload which re-runs applyPageRules. */
  }
}

/* Fill every form field from a full database row. Mirror of buildPayload's
   shape. Safe to call with partial data — missing fields just leave the
   form field empty. */
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

  setVal("company",                 r.company_name);
  setCheck("isCurrent",             r.is_current);
  setVal("designation",             r.designation);
  setVal("roleHeadline",            r.role_headline);
  setVal("roleDescription",         r.role_description);
  setVal("employmentType",          r.employment_type);
  setVal("sector",                  r.sector);
  setVal("industry",                r.industry);
  setVal("industry_other",          r.industry_other);
  setVal("industryFunction",        r.industry_function);
  setVal("department",              r.department);
  setVal("department_other",        r.department_other);
  setVal("domainSpecialization",    r.domain_specialization);
  setVal("ctcFixed",                r.ctc_fixed);
  setVal("ctcFixedCurrency",        r.ctc_fixed_currency);
  setVal("ctcFixedCurrencyOther",   r.ctc_fixed_currency_other);
  setVal("ctcVariable",             r.ctc_variable);
  setVal("ctcVarCurrency",          r.ctc_var_currency);
  setVal("ctcVarCurrencyOther",     r.ctc_var_currency_other);
  setVal("country",                 r.country);
  setVal("country_other",           r.country_other);
  setVal("state",                   r.state);
  setVal("city",                    r.city);
  setVal("locationType",            r.location_type);
  setVal("domainSkills",            r.domain_skills);
  setVal("techSkills",              r.tech_skills);
  setVal("softSkills",              r.soft_skills);
  setVal("startMonth",              r.start_month);
  setVal("startYear",               r.start_year);
  setVal("endMonth",                r.end_month);
  setVal("endYear",                 r.end_year);

  /* Trigger change events so dependency-based UI (e.g. "Other" reveals,
     CTC label updates, End Date visibility) refreshes. isCurrent must
     fire so endDateGroup hides/shows correctly to match the populated
     checkbox state. */
  ["industry", "department", "country",
   "ctcFixedCurrency", "ctcVarCurrency", "isCurrent"].forEach(id => {
    const el = $(id);
    if (el) el.dispatchEvent(new Event("change"));
  });

  /* Update char counters */
  ["roleHeadline", "roleDescription"].forEach(id => {
    const el = $(id);
    if (el) el.dispatchEvent(new Event("input"));
  });

  /* Skill counts */
  ["domainSkills", "techSkills", "softSkills"].forEach(id => {
    const el = $(id);
    if (el) el.dispatchEvent(new Event("input"));
  });

  /* Projects: rebuild project boxes from saved data */
  populateProjectsFromRow(r.projects || []);

  /* Auto-grow all textareas now that they have content */
  if (typeof autoGrowAll === "function") autoGrowAll();
}

/* Rebuild project sub-section from saved JSONB array.
   Removes any existing project boxes, then either:
   - shows "no" if array is empty (no projects)
   - shows "yes" + creates one project-box per saved project, filling fields */
function populateProjectsFromRow(projects) {
  const hasProjectsSel = $("hasProjects");
  const projectsContainer = $("projects");
  const projectSection = $("projectSection");

  if (!hasProjectsSel || !projectsContainer) return;

  /* Clear existing boxes and reset counter */
  projectsContainer.innerHTML = "";
  ExpState.projectCount = 0;

  if (!Array.isArray(projects) || projects.length === 0) {
    hasProjectsSel.value = "no";
    /* Hide the project section */
    if (projectSection) projectSection.classList.add("hidden");
    /* But still add one (hidden) project box for consistency with default state */
    addProject();
    return;
  }

  /* Show project section, set dropdown to "yes" */
  hasProjectsSel.value = "yes";
  if (projectSection) projectSection.classList.remove("hidden");

  /* Add a project-box per saved project and fill its 6 fields */
  projects.forEach((proj, idx) => {
    addProject();
    const boxes = projectsContainer.querySelectorAll(".project-box");
    const box = boxes[idx];
    if (!box) return;
    const fields = box.querySelectorAll("input, textarea");
    if (fields.length < 6) return;
    fields[0].value = proj.name            || "";
    fields[1].value = proj.duration_months || "";
    fields[2].value = proj.team_size       || "";
    fields[3].value = proj.ask             || "";
    fields[4].value = proj.role            || "";
    fields[5].value = proj.deliverable     || "";
    /* Trigger input on textareas so char counters update */
    fields.forEach(f => {
      if (f.tagName === "TEXTAREA") f.dispatchEvent(new Event("input"));
    });
  });
}

/* Delete an experience after confirmation. */
function handleDeleteExperience(exp) {
  const expNum = exp.experience_number || "?";
  const expDesc = (trim(exp.designation || "") || "this experience") +
                  (exp.company_name ? " at " + trim(exp.company_name) : "");

  const message = "Delete Experience " + expNum + " (" + expDesc + ")?\n\n" +
                  "This will permanently remove this experience from your profile. " +
                  "This action cannot be undone.";

  /* Use native confirm — simpler than wiring a custom 2-button popup
     for one feature. The other deletes (e.g. references) can mirror this. */
  if (!window.confirm(message)) return;

  (async () => {
    try {
      await apiDeleteExperience(exp.id);
    } catch (err) {
      showToast("Could not delete. Please try again.", "error");
      return;
    }
    showToast("Experience deleted.", "success");
    /* Reload page so list, experienceNumber, and form all reset cleanly. */
    setTimeout(() => window.location.reload(), 800);
  })();
}

/* ============================================================
   PAGE-LEVEL SETUP (Experience-2+ adjustments)
   ============================================================ */

function applyPageRules() {
  $("pageTitle").textContent = "Add Experience-" + experienceNumber;

  if (experienceNumber > 1) {
    /* Hide currently-working checkbox — past experiences can't be current */
    const cb = $("currentWorkCheckbox");
    if (cb) cb.classList.add("hidden");

    /* Rename CTC label prefix from "Current / Last" to just "Last".
       The "in Lacs" / "in [Currency]" suffix is handled dynamically by
       updateCtcLabel() based on the chosen currency — do NOT hardcode here. */
    const fLabel = $("ctcFixedLabel");
    const vLabel = $("ctcVarLabel");
    if (fLabel) fLabel.innerHTML = 'Last Drawn CTC (Fixed) <span class="required">*</span>';
    if (vLabel) vLabel.innerHTML = 'Last Drawn CTC (Variable)';

    /* End date is mandatory for past experience */
    $("endMonth").required = true;
    $("endYear").required  = true;
  }
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  applyPageRules();
  populateYears("startYear");
  populateYears("endYear");
  setupCharCounters();
  setupDomainLimit();
  setupDependencies();
  autoGrowAll();

  limitSkills("domainSkills", 3, "Maximum 3 domain specific skills allowed.");
  limitSkills("techSkills",   3, "Maximum 3 technical skills allowed.");
  limitSkills("softSkills",   3, "Maximum 3 soft skills allowed.");

  /* Add first project block (hidden until user selects Yes) */
  addProject();

  /* Wire up main buttons — SINGLE listeners each */
  $("saveAnotherExperienceBtn").addEventListener("click", handleSaveAnother);
  $("saveContinueBtn").addEventListener("click", handleSaveContinue);

  /* Wire the Cancel Edit button (hidden by default; shown only in edit mode) */
  const cancelBtn = $("cancelEditBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", exitEditMode);

  /* Load any previously saved experiences from Supabase, populate the
     in-memory list, and adjust experienceNumber so the form is for the
     NEXT entry (not a re-edit of an existing one). */
  loadAndRenderSavedExperiences();

  /* ── Wire the shared Save Now / draft-restore engine ──
     Each experience number gets its own draft scope, so
     Experience-1's draft never collides with Experience-2's. */
  SaveNow.init({
    pageName    : "experience",
    formIds     : ["experienceForm"],
    entryNumber : () => experienceNumber,

    capturePayload: () => buildPayload(),

    isEmpty: () => !trim($("company")?.value || "") &&
                   !trim($("designation")?.value || "") &&
                   !trim($("roleHeadline")?.value || ""),

    apiSave: (payload) => apiSaveExperience(payload),

    /* Banner label includes the experience number for clarity */
    restoreLabel: (envelope) =>
      "on Experience-" + (envelope._meta && envelope._meta.scope || experienceNumber),

    restorePayload: (draft) => {
      const setVal = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
      setVal("company",                draft.company_name);
      setVal("designation",            draft.designation);
      if ($("isCurrent") && draft.is_current === true) $("isCurrent").checked = true;
      setVal("roleHeadline",           draft.role_headline);
      setVal("roleDescription",        draft.role_description);
      setVal("employmentType",         draft.employment_type);
      setVal("sector",                 draft.sector);
      setVal("industry",               draft.industry);
      setVal("industry_other",         draft.industry_other);
      setVal("industryFunction",       draft.industry_function);
      setVal("department",             draft.department);
      setVal("department_other",       draft.department_other);
      setVal("domainSpecialization",   draft.domain_specialization);
      setVal("ctcFixed",               draft.ctc_fixed);
      setVal("ctcFixedCurrency",       draft.ctc_fixed_currency);
      setVal("ctcFixedCurrencyOther",  draft.ctc_fixed_currency_other);
      setVal("ctcVariable",            draft.ctc_variable);
      setVal("ctcVarCurrency",         draft.ctc_var_currency);
      setVal("ctcVarCurrencyOther",    draft.ctc_var_currency_other);
      setVal("country",                draft.country);
      setVal("country_other",          draft.country_other);
      setVal("state",                  draft.state);
      setVal("city",                   draft.city);
      setVal("locationType",           draft.location_type);
      setVal("domainSkills",           draft.domain_skills);
      setVal("techSkills",             draft.tech_skills);
      setVal("softSkills",             draft.soft_skills);
      setVal("startMonth",             draft.start_month);
      setVal("startYear",              draft.start_year);
      setVal("endMonth",               draft.end_month);
      setVal("endYear",                draft.end_year);

      /* Trigger conditional reveals (industry-other, isCurrent end-date toggle, etc.) */
      ["industry","department","country","ctcFixedCurrency","ctcVarCurrency","isCurrent"].forEach(id => {
        const el = $(id);
        if (el) el.dispatchEvent(new Event("change"));
      });
    }
  });
});
