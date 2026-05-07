/* ============================================================
   MECULS — education.js
   Single file. Zero duplicate listeners. All logic here.
   education.html contains only structure.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.EDUCATION_VERSION
   "phase1-step3" means this file (with JSONB save) is loaded. */
window.EDUCATION_VERSION = "phase1-step3";

/* ── Config ──
   candidateId comes from MC.candidateId (mc_helpers.js). */
const candidateId  = MC.candidateId;

/* ── In-memory state (frontend authority) ── */
const State = {
  educations    : [],      // all saved education entries
  page1Data     : {},      // context gate answers (Phase A)
  editingIndex  : null,    // null = new entry, number = editing existing
  editingMode   : false,   // true when editing Phase A after forward nav
  educationCount        : 0,
  currentEducationNumber: 0,
  projectCounters: {}      // { containerId: number }
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

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function populateMonthYear(monthId, yearId, opts) {
  /* opts (optional): { maxYear, minYear }
     - maxYear: highest year in the dropdown (defaults to 2055 — far enough
       for "Expected Month/Year of Passing" forecasting up to 30 years ahead)
     - minYear: lowest year in the dropdown (defaults to 1930)
     For Start Date dropdowns, callers pass maxYear = current year so the
     user cannot select a future start date. (Education start can never
     be in the future — you can't have started studying tomorrow.) */
  opts = opts || {};
  const maxYear = (typeof opts.maxYear === "number") ? opts.maxYear : 2055;
  const minYear = (typeof opts.minYear === "number") ? opts.minYear : 1930;

  const ms = $(monthId), ys = $(yearId);
  ms.innerHTML = '<option value="">Month</option>';
  MONTHS.forEach((m, i) => {
    ms.innerHTML += `<option value="${String(i + 1).padStart(2,'0')}">${m}</option>`;
  });
  ys.innerHTML = '<option value="">Year</option>';
  for (let y = maxYear; y >= minYear; y--) {
    ys.innerHTML += `<option value="${y}">${y}</option>`;
  }
}

/* ============================================================
   API CALLS — Supabase
   ============================================================
   Uses the shared MC_SB helper (mc_supabase.js) which handles
   client creation and session rehydration from localStorage.

   Education has TWO data shapes:
     - Phase A (1-to-1):  education_current table   — upsert
     - Phase B (1-to-many): education table         — insert / update / delete
   ============================================================ */

/* ── Phase B project gathering ──
   Collect the 4 fields from each .project-card in the given container,
   in DOM order: Project Name, Ask, Role, Deliverable.
   Returns [] if container is empty or all boxes are wholly blank. */
function gatherProjects(containerId) {
  const container = $(containerId);
  if (!container) return [];
  const cards = container.querySelectorAll(".project-card");
  const out = [];
  cards.forEach(card => {
    const fields = card.querySelectorAll("input, textarea");
    if (fields.length < 4) return;
    const name        = trim(fields[0].value);
    const ask         = trim(fields[1].value);
    const role        = trim(fields[2].value);
    const deliverable = trim(fields[3].value);
    if (!name && !ask && !role && !deliverable) return;
    out.push({
      name        : name,
      ask         : ask,
      role        : role,
      deliverable : deliverable
    });
  });
  return out;
}

/* ── Date cross-validation helper ──
   Returns true if (endYear, endMonth) is strictly BEFORE (startYear, startMonth).
   All inputs are strings as they come from <select> elements:
     - month: "01".."12" (zero-padded, matches populateMonthYear output)
     - year:  "1930".."2055"
   Returns false when ANY of the four values is empty/missing — callers
   are expected to validate presence separately. This function only
   answers the cross-validation question.

   Used in BOTH Phase A (eduStartMonth/Year vs eduEndMonth/Year) and
   Phase B (startMonth/Year vs endMonth/Year). For Phase A, both dates
   are required so any missing input is a separate error. For Phase B,
   End is optional — caller should only invoke this when both End fields
   are filled. */
function _isEndBeforeStart(startMonth, startYear, endMonth, endYear) {
  if (!startMonth || !startYear || !endMonth || !endYear) return false;
  const sy = parseInt(startYear, 10);
  const ey = parseInt(endYear, 10);
  if (ey < sy) return true;
  if (ey > sy) return false;
  /* Same year — compare months */
  const sm = parseInt(startMonth, 10);
  const em = parseInt(endMonth, 10);
  return em < sm;
}

/* ── Future-month check ──
   Returns true if (month, year) is later than the current calendar month.
   The year dropdown caps START year at the current calendar year, but a
   user could still pick a future month within the current year (e.g.
   June 2026 in May 2026). This catches that at validation time.

   Education uses this for START dates ONLY. End dates can legitimately
   be in the future when the user is currently pursuing (Expected Passing
   is intentionally future). So the check applies to start, not end. */
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

/* ─── Phase A: Currently-pursuing context (1-to-1) ───
   Phase 1 Step 3: stores at profiles.data.education_current as a single
   object with snake_case keys (matches the shape the load consumer
   restorePhaseAFromDb expects). The camelCase→snake_case mapping is
   preserved here so the rest of the file's calling code is unchanged. */

async function apiSaveCurrentEducation(payload) {
  const row = {
    currently_pursuing  : payload.currentlyPursuing  || null,
    education_level     : payload.educationLevel     || null,
    field_of_study      : payload.fieldOfStudy       || null,
    institution_name    : payload.institutionName    || null,
    education_mode      : payload.educationMode      || null,
    edu_start_month     : payload.eduStartMonth      || null,
    edu_start_year      : payload.eduStartYear       || null,
    edu_end_month       : payload.eduEndMonth        || null,
    edu_end_year        : payload.eduEndYear         || null,
    has_academic_project: payload.hasAcademicProject || null,
    current_projects    : Array.isArray(payload.current_projects)
                          ? payload.current_projects : []
  };
  return await MC.saveSection("education_current", row);
}

async function apiLoadCurrentEducation() {
  const data = await MC.loadSection("education_current");
  /* Match the old contract: return null when nothing saved (so the
     consumer's `if (cur)` guard at line ~1294 still works). */
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
    return null;
  }
  return data;
}

/* ─── Phase B: Past education entries (1-to-many) ───
   Phase 1 Step 3: stores at profiles.data.education as an array. Each
   entry has all the same snake_case fields the old database row had
   plus a client-generated UUID `id` (replaces the old BIGSERIAL).
   The data shape per entry is identical to what consumer code expects.

   Race-condition note: same as experience.js — load-modify-save is
   atomic at the SECTION level (server-side jsonb_set) but not at the
   array level. Acceptable for single-user Phase 1. */

/* Internal helper: load the education array, default to []. */
async function _loadEducationArray() {
  const arr = await MC.loadSection("education");
  return Array.isArray(arr) ? arr : [];
}

/* Internal helper: build a clean education entry from a payload.
   Assigns a new client-side id if one is not provided. */
function _buildEducationEntry(payload, existingId) {
  return {
    id                   : existingId || _newEduId(),
    education_number     : payload.education_number     || 1,
    institution          : payload.institution          || null,
    degree               : payload.degree               || null,
    field_of_study       : payload.field_of_study       || null,
    start_month          : payload.start_month          || null,
    start_year           : payload.start_year           || null,
    end_month            : payload.end_month            || null,
    end_year             : payload.end_year             || null,
    grade                : payload.grade                || null,
    skills               : payload.skills               || null,
    activities           : payload.activities           || null,
    has_academic_project : payload.has_academic_project || null,
    projects             : Array.isArray(payload.projects) ? payload.projects : []
  };
}

/* Internal helper: generate a unique id (replaces old BIGSERIAL). */
function _newEduId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "edu-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

async function apiSaveEducation(payload) {
  const arr = await _loadEducationArray();
  const entry = _buildEducationEntry(payload, null);
  arr.push(entry);
  await MC.saveSection("education", arr);
  return entry;
}

async function apiLoadAllEducations() {
  const arr = await _loadEducationArray();
  arr.sort(function (a, b) {
    return (a.education_number || 0) - (b.education_number || 0);
  });
  return arr;
}

async function apiUpdateEducation(id, payload) {
  const arr = await _loadEducationArray();
  const idx = arr.findIndex(function (e) { return e.id === id; });
  if (idx < 0) {
    throw new Error("Could not save changes: education not found");
  }
  arr[idx] = _buildEducationEntry(payload, id);
  await MC.saveSection("education", arr);
  return arr[idx];
}

async function apiDeleteEducation(id) {
  const arr = await _loadEducationArray();
  const filtered = arr.filter(function (e) { return e.id !== id; });
  await MC.saveSection("education", filtered);
  return true;
}

/* ── Edit-mode state ──
   Whether we're creating a new past-education entry or updating
   an existing one. Mirrors the EditState pattern from experience.js. */
const EditState = {
  mode         : "create",   // "create" | "edit"
  editingId    : null,       // database id of row being edited
  editingNumber: null        // education_number of row being edited
};

/* ============================================================
   RENDER SAVED EDUCATION LIST
   ============================================================ */

function renderEducationList() {
  const list = $("education-list");
  list.innerHTML = "";

  /* Hide entirely while in edit mode — the user is focused on one
     entry; showing the full list is confusing UI. */
  if (EditState.mode === "edit") return;

  if (State.educations.length === 0) return;

  const heading = document.createElement("h3");
  heading.className = "entry-title";
  heading.textContent = "Saved Educations";
  list.appendChild(heading);

  State.educations.forEach((edu, index) => {
    const div = document.createElement("div");
    div.className = "edu-list-card";

    /* Info container — clickable area */
    const info = document.createElement("div");
    info.className = "edu-list-card__info";

    const titleEl = document.createElement("strong");
    const eduNum = edu.education_number || (index + 1);
    titleEl.textContent =
      "Education " + eduNum + " \u2014 " +
      (trim(edu.degree || "") || "\u2014");
    info.appendChild(titleEl);

    const subEl = document.createElement("span");
    let subText = trim(edu.institution || "") || "\u2014";
    if (edu.start_year) subText += " \u00b7 " + edu.start_year;
    if (edu.end_year)   subText += " \u2013 " + edu.end_year;
    subEl.textContent = subText;
    info.appendChild(subEl);

    info.style.cursor = "pointer";
    info.addEventListener("click", () => enterEditMode(edu));

    div.appendChild(info);

    /* Action buttons */
    const actions = document.createElement("div");
    actions.className = "edu-list-card__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edu-list-card__btn edu-list-card__btn--edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => enterEditMode(edu));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "edu-list-card__btn edu-list-card__btn--delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => handleDeleteEducation(edu));
    actions.appendChild(deleteBtn);

    div.appendChild(actions);

    list.appendChild(div);
  });
}

/* ============================================================
   EDIT MODE — Phase B (past education entries)
   ============================================================ */

function enterEditMode(edu) {
  EditState.mode          = "edit";
  EditState.editingId     = edu.id;
  EditState.editingNumber = edu.education_number;

  /* Switch from Phase A to Phase B form */
  $("educationStep1").classList.add("hidden");
  $("educationStep2").classList.remove("hidden");

  /* Populate form fields */
  populateFormFromRow(edu);

  /* Update UI for edit mode */
  applyEditModeUI();

  /* Hide saved-list during edit */
  renderEducationList();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitEditMode() {
  EditState.mode          = "create";
  EditState.editingId     = null;
  EditState.editingNumber = null;
  /* Full reload — cleanest reset for forms with dynamic project boxes,
     conditional blocks, etc. List reloads from Supabase on init. */
  window.location.reload();
}

function applyEditModeUI() {
  const titleEl    = $("eduNumberPage2");
  const submitBtn  = $("step2SubmitBtn");
  const continueBtn= $("step2ContinueBtn");
  const cancelBtn  = $("cancelEditEducationBtn");
  const editCtxBtn = $("editCurrentEducation");

  if (EditState.mode === "edit") {
    if (titleEl)   titleEl.textContent = "Edit Education " + EditState.editingNumber;
    if (submitBtn) submitBtn.textContent = "Save Changes";
    if (continueBtn) continueBtn.classList.add("hidden");
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    /* The "Edit Previously Answered Context" button doesn't make sense
       during edit — hide it. */
    if (editCtxBtn) editCtxBtn.classList.add("hidden");
  } else {
    if (titleEl) titleEl.textContent = "Education " + State.currentEducationNumber;
    if (submitBtn) submitBtn.textContent = "Save & Add Another Education";
    if (continueBtn) continueBtn.classList.remove("hidden");
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (editCtxBtn) editCtxBtn.classList.remove("hidden");
  }
}

function populateFormFromRow(r) {
  const setVal = (id, val) => {
    const el = $(id);
    if (!el) return;
    el.value = (val === null || val === undefined) ? "" : val;
  };

  setVal("institution",     r.institution);
  setVal("degree",          r.degree);
  setVal("field_of_study",  r.field_of_study);
  setVal("startMonth",      r.start_month);
  setVal("startYear",       r.start_year);
  setVal("endMonth",        r.end_month);
  setVal("endYear",         r.end_year);
  setVal("grade",           r.grade);
  setVal("skills",          r.skills);
  setVal("activities",      r.activities);
  setVal("hasAcademicProjectStep2", r.has_academic_project);

  /* Trigger change events so dependent UI (e.g. projects block visibility)
     refreshes. */
  const hasProjEl = $("hasAcademicProjectStep2");
  if (hasProjEl) hasProjEl.dispatchEvent(new Event("change"));

  /* Rebuild project cards from saved JSONB array */
  populateProjectsFromRow(r.projects || []);
}

function populateProjectsFromRow(projects) {
  const container = $("projectsContainerStep2");
  const projectBlock = $("projectBlockStep2");
  if (!container) return;

  /* Clear existing cards and reset counter */
  container.innerHTML = "";
  State.projectCounters["projectsContainerStep2"] = 0;

  if (!Array.isArray(projects) || projects.length === 0) {
    if (projectBlock) projectBlock.classList.add("hidden");
    return;
  }

  /* Show project block and add a card per saved project, filling all 4 fields */
  if (projectBlock) projectBlock.classList.remove("hidden");

  projects.forEach((proj, idx) => {
    addProject("projectsContainerStep2");
    const cards = container.querySelectorAll(".project-card");
    const card = cards[idx];
    if (!card) return;
    const fields = card.querySelectorAll("input, textarea");
    if (fields.length < 4) return;
    fields[0].value = proj.name        || "";
    fields[1].value = proj.ask         || "";
    fields[2].value = proj.role        || "";
    fields[3].value = proj.deliverable || "";
    /* Update char counters */
    fields.forEach(f => {
      if (f.tagName === "TEXTAREA") f.dispatchEvent(new Event("input"));
    });
  });
}

function handleDeleteEducation(edu) {
  const eduNum  = edu.education_number || "?";
  const eduDesc = (trim(edu.degree || "") || "this education") +
                  (edu.institution ? " at " + trim(edu.institution) : "");

  const message = "Delete Education " + eduNum + " (" + eduDesc + ")?\n\n" +
                  "This will permanently remove this education entry from " +
                  "your profile. This cannot be undone.";

  if (!window.confirm(message)) return;

  (async () => {
    try {
      await apiDeleteEducation(edu.id);
    } catch (err) {
      showToast("Could not delete. Please try again.", "error");
      return;
    }
    showToast("Education deleted.", "success");
    setTimeout(() => window.location.reload(), 800);
  })();
}

/* ============================================================
   PROJECT BLOCKS
   ============================================================ */

function addProject(containerId) {
  if (!State.projectCounters[containerId]) {
    State.projectCounters[containerId] = 0;
  }

  /* Validate previous project before adding next */
  const container = $(containerId);
  const existing  = container.querySelectorAll(".project-card");

  if (existing.length > 0) {
    const last   = existing[existing.length - 1];
    const fields = [...last.querySelectorAll("input, textarea")];
    const empty  = fields.some(f => !trim(f.value));
    if (empty) {
      const projTitle = last.querySelector("h4")?.textContent || "this project";
      showPopup(`Please complete all fields in "${projTitle}" before adding another.`);
      return;
    }
  }

  State.projectCounters[containerId]++;
  const projNum = State.projectCounters[containerId];

  /* Determine education label for the project header. The header was
     previously hardcoded to read $("eduNumberPage2"), which is Phase B's
     dynamic title — wrong for Phase A projects, and worse, if the user
     went to Phase B and then clicked "Edit Previously Answered Context"
     to return to Phase A, the Phase A title would inherit "Education 2"
     from Phase B's header. Fix: read the title that actually corresponds
     to this container.

     - projectsContainerStep1 → Phase A → eduNumberPage1
     - projectsContainerStep2 → Phase B → eduNumberPage2 */
  const titleElId = (containerId === "projectsContainerStep1")
                  ? "eduNumberPage1"
                  : "eduNumberPage2";
  /* The Phase A title H3 contains the static text "Education 1 — Currently
     Pursuing" but is hidden until pursuing=Yes. The textContent works either
     way. Fall back to a sensible default if the element is missing or empty. */
  const eduLabel = ($(titleElId)?.textContent || "").trim() || "Education 1";

  const card = document.createElement("div");
  card.className = "project-card";
  card.innerHTML = `
    <h4>${eduLabel} — Project ${projNum}</h4>

    <div class="field-group">
      <label class="field-label">Project Name <span class="required">*</span></label>
      <input type="text" class="field-input" required>
    </div>

    <div class="field-group">
      <label class="field-label">What was the project ask? (Max 300 characters) <span class="required">*</span></label>
      <textarea class="field-textarea" maxlength="300" required
        oninput="updateCharCount(this)"></textarea>
      <div class="char-counter"><span>0</span> / 300</div>
    </div>

    <div class="field-group">
      <label class="field-label">What was your role? (Max 1,000 characters) <span class="required">*</span></label>
      <textarea class="field-textarea" maxlength="1000" required
        oninput="updateCharCount(this)"></textarea>
      <div class="char-counter"><span>0</span> / 1,000</div>
    </div>

    <div class="field-group">
      <label class="field-label">What was the end deliverable you delivered? (Max 1,000 characters) <span class="required">*</span></label>
      <textarea class="field-textarea" maxlength="1000" required
        oninput="updateCharCount(this)"></textarea>
      <div class="char-counter"><span>0</span> / 1,000</div>
    </div>
  `;

  container.appendChild(card);
}

function updateCharCount(textarea) {
  const counter = textarea.nextElementSibling?.querySelector("span");
  if (counter) counter.textContent = textarea.value.length;
}

/* ============================================================
   DEPENDENCY LOGIC
   ============================================================ */

function setupDependencies() {

  /* Phase A: currently pursuing toggle */
  $("currentlyPursuing").addEventListener("change", e => {
    const isYes = e.target.value === "yes";
    $("eduNumberPage1").classList.toggle("hidden", !isYes);
    $("currentEducationBlock").classList.toggle("hidden", !isYes);

    if (!isYes) {
      /* Pursuing=No → there's no current education, so by definition
         no academic project for current pursuit. Disable the field
         and clear it. The Phase A submit validator skips this field
         when pursuing=No (treats it as implicit "no").

         Past education and any past academic projects are added later
         via the "Save & Add Education Details" button, which routes
         to Phase B (the repeatable past-education form). */
      $("hasAcademicProject").value    = "";
      $("hasAcademicProject").disabled = true;
      $("projectBlockStep1").classList.add("hidden");
      $("projectsContainerStep1").innerHTML = "";
      State.projectCounters["projectsContainerStep1"] = 0;
    } else {
      $("hasAcademicProject").disabled = false;
    }
  });

  /* Phase A: academic project toggle */
  $("hasAcademicProject").addEventListener("change", e => {
    if ($("currentlyPursuing").value !== "yes") {
      $("projectBlockStep1").classList.add("hidden");
      return;
    }
    const isYes = e.target.value === "yes";
    $("projectBlockStep1").classList.toggle("hidden", !isYes);
    if (isYes && $("projectsContainerStep1").children.length === 0) {
      addProject("projectsContainerStep1");
    }
  });

  /* Phase B: academic project toggle */
  $("hasAcademicProjectStep2").addEventListener("change", e => {
    const isYes = e.target.value === "yes";
    $("projectBlockStep2").classList.toggle("hidden", !isYes);
    if (isYes && $("projectsContainerStep2").children.length === 0) {
      addProject("projectsContainerStep2");
    }
  });

  /* Project buttons */
  $("addProjectStep1Btn").addEventListener("click", () =>
    addProject("projectsContainerStep1")
  );
  $("addProjectStep2Btn").addEventListener("click", () =>
    addProject("projectsContainerStep2")
  );

  /* Edit context (go back to Phase A) */
  $("editCurrentEducation").addEventListener("click", () => {
    State.editingMode = true;

    /* Restore Phase A values */
    $("currentlyPursuing").value  = State.page1Data.currentlyPursuing  || "";
    $("educationLevel").value     = State.page1Data.educationLevel     || "";
    $("fieldOfStudy").value       = State.page1Data.fieldOfStudy       || "";
    $("institutionName").value    = State.page1Data.institutionName    || "";
    $("educationMode").value      = State.page1Data.educationMode      || "";
    $("eduStartMonth").value      = State.page1Data.eduStartMonth      || "";
    $("eduStartYear").value       = State.page1Data.eduStartYear       || "";
    $("eduEndMonth").value        = State.page1Data.eduEndMonth        || "";
    $("eduEndYear").value         = State.page1Data.eduEndYear         || "";
    $("projectsContainerStep1").innerHTML = State.page1Data.projectsHTML || "";

    /* Re-trigger visibility */
    $("currentlyPursuing").dispatchEvent(new Event("change"));
    $("hasAcademicProject").dispatchEvent(new Event("change"));

    State.projectCounters["projectsContainerStep1"] =
      $("projectsContainerStep1").querySelectorAll(".project-card").length;

    $("educationStep2").classList.add("hidden");
    $("educationStep1").classList.remove("hidden");
  });
}

/* ============================================================
   SAVE NOW + DRAFT RESTORE
   All Save Now logic lives in save_now.js (shared module).
   This page calls SaveNow.init({...}) in DOMContentLoaded
   and SaveNow.clearDraft("A" | "B") after Save & Continue.

   Education has TWO forms (Phase A: context gate, Phase B:
   repeatable past education entries). The shared engine handles
   this via the activePhase() config callback — see DOMContentLoaded.
   ============================================================ */

/* ── Build Phase B server payload (factored out for re-use). ──
   Used by both Phase B form-submit AND the SaveNow.capturePayload
   when Phase B is active. */
function buildPhaseBPayload() {
  return {
    institution          : trim($("institution").value),
    degree               : trim($("degree").value),
    field_of_study       : trim($("field_of_study").value) || null,
    start_month          : $("startMonth").value || null,
    start_year           : $("startYear").value  || null,
    end_month            : $("endMonth").value   || null,
    end_year             : $("endYear").value    || null,
    grade                : trim($("grade").value)      || null,
    skills               : trim($("skills").value)     || null,
    activities           : trim($("activities").value) || null,
    has_academic_project : $("hasAcademicProjectStep2").value || null,
    projects             : gatherProjects("projectsContainerStep2")
  };
}

/* Build Phase A payload — used when calling apiSaveCurrentEducation. */
function buildPhaseAPayload() {
  return {
    currentlyPursuing  : $("currentlyPursuing")?.value     || null,
    educationLevel     : $("educationLevel")?.value        || null,
    fieldOfStudy       : trim($("fieldOfStudy")?.value     || "") || null,
    institutionName    : trim($("institutionName")?.value  || "") || null,
    educationMode      : $("educationMode")?.value         || null,
    eduStartMonth      : $("eduStartMonth")?.value         || null,
    eduStartYear       : $("eduStartYear")?.value          || null,
    eduEndMonth        : $("eduEndMonth")?.value           || null,
    eduEndYear         : $("eduEndYear")?.value            || null,
    hasAcademicProject : $("hasAcademicProject")?.value    || null,
    current_projects   : gatherProjects("projectsContainerStep1")
  };
}

/* ── Build Phase A draft payload (no backend endpoint;
     localStorage-only). Mirrors State.page1Data shape. */
function buildPhaseADraft() {
  return {
    currentlyPursuing: $("currentlyPursuing")?.value || "",
    educationLevel  : $("educationLevel")?.value     || "",
    fieldOfStudy    : trim($("fieldOfStudy")?.value  || ""),
    institutionName : trim($("institutionName")?.value || ""),
    educationMode   : $("educationMode")?.value      || "",
    eduStartMonth   : $("eduStartMonth")?.value      || "",
    eduStartYear    : $("eduStartYear")?.value       || "",
    eduEndMonth     : $("eduEndMonth")?.value        || "",
    eduEndYear      : $("eduEndYear")?.value         || "",
    hasAcademicProject : $("hasAcademicProject")?.value || "",
    projectsHTML    : $("projectsContainerStep1")?.innerHTML || ""
  };
}

/* ── Build Phase B draft payload (mirrors backend payload shape). */
function buildPhaseBDraft() {
  const p = buildPhaseBPayload();
  /* Add fields the backend payload doesn't have but the draft needs */
  p.hasAcademicProjectStep2 = $("hasAcademicProjectStep2")?.value || "";
  p.projectsHTML = $("projectsContainerStep2")?.innerHTML || "";
  return p;
}

/* ── Restore Phase A draft into the form ── */
function restorePhaseADraft(draft) {
  if (!draft) return false;
  const setVal = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  setVal("currentlyPursuing", draft.currentlyPursuing);
  setVal("educationLevel",    draft.educationLevel);
  setVal("fieldOfStudy",      draft.fieldOfStudy);
  setVal("institutionName",   draft.institutionName);
  setVal("educationMode",     draft.educationMode);
  setVal("eduStartMonth",     draft.eduStartMonth);
  setVal("eduStartYear",      draft.eduStartYear);
  setVal("eduEndMonth",       draft.eduEndMonth);
  setVal("eduEndYear",        draft.eduEndYear);
  setVal("hasAcademicProject", draft.hasAcademicProject);
  if (draft.projectsHTML) {
    $("projectsContainerStep1").innerHTML = draft.projectsHTML;
    State.projectCounters["projectsContainerStep1"] =
      $("projectsContainerStep1").querySelectorAll(".project-card").length;
  }
  $("currentlyPursuing").dispatchEvent(new Event("change"));
  $("hasAcademicProject").dispatchEvent(new Event("change"));
  return true;
}

/* ── Restore Phase B draft into the form ── */
function restorePhaseBDraft(draft) {
  if (!draft) return false;
  const setVal = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  setVal("institution",     draft.institution);
  setVal("degree",          draft.degree);
  setVal("field_of_study",  draft.field_of_study);
  /* New payload shape: month/year as separate fields. Also accept
     legacy ISO start_date/end_date drafts for backwards compatibility
     with anyone whose localStorage drafts were saved before this change. */
  if (draft.start_month && draft.start_year) {
    setVal("startMonth", draft.start_month);
    setVal("startYear",  draft.start_year);
  } else if (draft.start_date && /^\d{4}-\d{2}/.test(draft.start_date)) {
    setVal("startYear",  draft.start_date.slice(0,4));
    setVal("startMonth", draft.start_date.slice(5,7));
  }
  if (draft.end_month && draft.end_year) {
    setVal("endMonth", draft.end_month);
    setVal("endYear",  draft.end_year);
  } else if (draft.end_date && /^\d{4}-\d{2}/.test(draft.end_date)) {
    setVal("endYear",  draft.end_date.slice(0,4));
    setVal("endMonth", draft.end_date.slice(5,7));
  }
  setVal("grade",           draft.grade);
  /* Skills can be string (new) or array (legacy) */
  if (typeof draft.skills === "string") setVal("skills", draft.skills);
  else if (Array.isArray(draft.skills)) setVal("skills", draft.skills.join(", "));
  setVal("activities",      draft.activities);
  setVal("hasAcademicProjectStep2", draft.hasAcademicProjectStep2 || draft.has_academic_project);
  if (draft.projectsHTML) {
    $("projectsContainerStep2").innerHTML = draft.projectsHTML;
    State.projectCounters["projectsContainerStep2"] =
      $("projectsContainerStep2").querySelectorAll(".project-card").length;
  }
  $("hasAcademicProjectStep2").dispatchEvent(new Event("change"));
  $("educationStep1").classList.add("hidden");
  $("educationStep2").classList.remove("hidden");
  return true;
}


/* ============================================================
   PHASE A SUBMIT
   ============================================================ */

function setupStep1Submit() {
  $("educationStep1").addEventListener("submit", async e => {
    e.preventDefault();

    /* Manual validation for context block */
    const pursuing = $("currentlyPursuing").value;
    if (!pursuing) {
      showPopup("Please answer whether you are currently pursuing education.");
      return;
    }

    if (pursuing === "yes") {
      if (!$("educationLevel").value) {
        showPopup("Please select your education level."); return;
      }
      if (!trim($("fieldOfStudy").value)) {
        showPopup("Please enter your field of study."); return;
      }
      if (!trim($("institutionName").value)) {
        showPopup("Please enter the institution name."); return;
      }
      if (!$("educationMode").value) {
        showPopup("Please select the mode of education."); return;
      }
      if (!$("eduStartMonth").value || !$("eduStartYear").value) {
        showPopup("Please select your start date."); return;
      }
      if (!$("eduEndMonth").value || !$("eduEndYear").value) {
        showPopup("Please select your expected passing date."); return;
      }
      /* Start Date cannot be in the future — you cannot have STARTED
         studying tomorrow. (Expected Passing IS allowed to be future,
         that's the point of the field.) */
      if (_isFutureMonth($("eduStartMonth").value, $("eduStartYear").value)) {
        showPopup(
          "Start date cannot be in the future. " +
          "Please pick a month and year that is not later than the current month."
        );
        return;
      }
      /* Cross-validate: Expected Passing must not be before Start. */
      if (_isEndBeforeStart(
            $("eduStartMonth").value, $("eduStartYear").value,
            $("eduEndMonth").value,   $("eduEndYear").value)) {
        showPopup("Your Expected Month / Year of Passing is earlier than your Start Date. Please correct the dates.");
        return;
      }
    }

    /* hasAcademicProject is ONLY relevant when the user is currently
       pursuing education. If pursuing=No, the field is auto-disabled
       (set to "no" implicitly) — there's no current pursuit, so by
       definition no current academic project. Skip the validation. */
    if (pursuing === "yes") {
      const hasProject = $("hasAcademicProject").value;
      if (!hasProject) {
        showPopup("Please answer the academic project question."); return;
      }
    }

    /* Save Phase A state in memory */
    State.page1Data = {
      currentlyPursuing : pursuing,
      educationLevel    : $("educationLevel").value,
      fieldOfStudy      : trim($("fieldOfStudy").value),
      institutionName   : trim($("institutionName").value),
      educationMode     : $("educationMode").value,
      eduStartMonth     : $("eduStartMonth").value,
      eduStartYear      : $("eduStartYear").value,
      eduEndMonth       : $("eduEndMonth").value,
      eduEndYear        : $("eduEndYear").value,
      projectsHTML      : pursuing === "yes"
                          ? $("projectsContainerStep1").innerHTML
                          : ""
    };

    /* Persist Phase A to Supabase before advancing.
       Don't hard-block on failure — the user shouldn't be stuck on this
       screen because of a network blip; a toast is enough. localStorage
       draft remains as a safety net. */
    try {
      await apiSaveCurrentEducation(buildPhaseAPayload());
    } catch (err) {
      console.error("Phase A save failed:", err);
      showToast("Could not save your current education. Please try again.", "error");
      return;
    }

    if (pursuing === "yes") {
      State.educationCount = 1;
      State.currentEducationNumber = 2;
    } else {
      State.educationCount = 0;
      State.currentEducationNumber = 1;
    }

    /* If we already have past educations saved, advance the number
       past the highest one. */
    if (State.educations.length > 0) {
      let maxNum = 0;
      State.educations.forEach(e => {
        const n = parseInt(e.education_number, 10) || 0;
        if (n > maxNum) maxNum = n;
      });
      State.currentEducationNumber = Math.max(State.currentEducationNumber, maxNum + 1);
    }

    $("eduNumberPage2").textContent = "Education " + State.currentEducationNumber;

    /* Phase A complete — clear its draft so it doesn't reappear next visit */
    SaveNow.clearDraft("A");

    $("educationStep1").classList.add("hidden");
    $("educationStep2").classList.remove("hidden");
  });

  /* Save & Continue from Phase A.
     This button is the explicit "I'm done with all education" path.
     If the user clicks it without having added any past education
     entries (State.educations.length === 0), we don't hard-block —
     we show a confirmation popup so the user can either reconsider
     or proceed deliberately. The wording adapts based on whether
     they're currently pursuing education or not. */
  $("step1ContinueBtn").addEventListener("click", async () => {
    const pursuing = $("currentlyPursuing").value;

    /* Case 1: user left "Select" — they haven't answered the question at all */
    if (!pursuing) {
      showPopup("Please answer whether you are currently pursuing any education before continuing.");
      return;
    }

    /* Case 2: user selected "Yes" — validate the current education fields.
       Collect EVERY missing field, then show one popup listing them all so
       the user fixes everything in one pass instead of one error at a time. */
    if (pursuing === "yes") {
      const missing = [];
      if (!$("educationLevel").value)              missing.push("Education Level You Are Pursuing");
      if (!trim($("fieldOfStudy").value))          missing.push("Field / Stream of Study");
      if (!trim($("institutionName").value))       missing.push("Institution Name");
      if (!$("educationMode").value)               missing.push("Mode of Education");
      if (!$("eduStartMonth").value || !$("eduStartYear").value) missing.push("Start Date");
      if (!$("eduEndMonth").value   || !$("eduEndYear").value)   missing.push("Expected Month / Year of Passing");
      if (!$("hasAcademicProject").value)          missing.push("Any Academic Project / Research You Have Done as Part of Your Current Education?");

      if (missing.length === 1) {
        showPopup("Please fill in: " + missing[0] + ".");
        return;
      }
      if (missing.length > 1) {
        showPopup(
          "Please fill in the following required fields before continuing:\n\n\u2022 " +
          missing.join("\n\u2022 ")
        );
        return;
      }

      /* All required fields present — now cross-validate the dates.
         Done AFTER the missing-fields check so we don't pile a date error
         on top of "Start Date is missing". */
      if (_isFutureMonth($("eduStartMonth").value, $("eduStartYear").value)) {
        showPopup(
          "Start date cannot be in the future. " +
          "Please pick a month and year that is not later than the current month."
        );
        return;
      }
      if (_isEndBeforeStart(
            $("eduStartMonth").value, $("eduStartYear").value,
            $("eduEndMonth").value,   $("eduEndYear").value)) {
        showPopup("Your Expected Month / Year of Passing is earlier than your Start Date. Please correct the dates.");
        return;
      }
    }

    /* Persist Phase A to Supabase. If it fails we toast and stay put;
       the user's data is preserved in localStorage by SaveNow. */
    try {
      await apiSaveCurrentEducation(buildPhaseAPayload());
    } catch (err) {
      console.error("Phase A save failed:", err);
      showToast("Could not save your current education. Please try again.", "error");
      return;
    }

    /* Case 3: Phase A is valid + saved — now check whether the user has
       any past education entries. If they have, proceed cleanly. */
    const hasPastEducation = State.educations && State.educations.length > 0;

    if (hasPastEducation) {
      proceedToSkills();
      return;
    }

    /* Case 4: No past education entries yet. Show a soft confirmation
       popup. The wording adapts: pursuing=Yes vs pursuing=No should
       not get the same message because their situations are different. */
    let confirmMsg;
    if (pursuing === "yes") {
      confirmMsg =
        "You have not yet added any past education (degrees, diplomas, " +
        "or other academic qualifications you have completed before today).\n\n" +
        "Past education is optional, but it strengthens your profile.\n\n" +
        "Are you sure you want to continue to the next section without " +
        "adding any past education?";
    } else {
      /* pursuing === "no" */
      confirmMsg =
        "You have answered \"No\" to currently pursuing education, and " +
        "you have not added any past education either.\n\n" +
        "This will leave your education section empty. Past education is " +
        "optional, but your profile will be stronger if you add any " +
        "degrees, diplomas, or other academic qualifications you have " +
        "completed.\n\n" +
        "Are you sure you want to continue with an empty education section?";
    }

    MC.showConfirm(
      confirmMsg,
      proceedToSkills,
      {
        confirmLabel: "Yes, Continue",
        cancelLabel:  "Go Back & Add Education"
      }
    );
  });

  /* Inner helper: actually navigate to Skills.
     Phase A is now saved to Supabase before reaching here, so this is
     pure navigation logic (no save needed). */
  function proceedToSkills() {
    localStorage.setItem("education_completed", "yes");
    localStorage.setItem("profile_last_updated", new Date().toLocaleDateString("en-US"));

    /* Phase A draft can be cleared now that it's persisted server-side */
    if (window.SaveNow) SaveNow.clearDraft("A");

    window.parent.postMessage(
      { type: "navigate", page: "skills.html", sidebarKey: "Your Skills" },
      "*"
    );
  }
}

/* ============================================================
   PHASE B SUBMIT  ← SINGLE LISTENER ONLY (no duplicate)
   ============================================================ */

function setupStep2Submit() {

  $("educationStep2").addEventListener("submit", async e => {
    e.preventDefault();

    /* Validate required fields */
    if (!trim($("institution").value)) {
      showPopup("Please enter the institution name."); return;
    }
    if (!trim($("degree").value)) {
      showPopup("Please enter the degree."); return;
    }
    if (!$("startMonth").value || !$("startYear").value) {
      showPopup("Please select the start date."); return;
    }
    if (!$("hasAcademicProjectStep2").value) {
      showPopup("Please answer the academic project question."); return;
    }
    /* Start Date cannot be in the future — these are PAST education
       entries (Phase B). Phase A handles current/expected-passing. */
    if (_isFutureMonth($("startMonth").value, $("startYear").value)) {
      showPopup(
        "Start date cannot be in the future. " +
        "Please pick a month and year that is not later than the current month."
      );
      return;
    }
    /* End Date cannot be in the future for past education either. */
    if ($("endMonth").value && $("endYear").value &&
        _isFutureMonth($("endMonth").value, $("endYear").value)) {
      showPopup(
        "End date cannot be in the future for a past education entry. " +
        "If this is an education you are still pursuing, use the previous step instead."
      );
      return;
    }
    /* Cross-validate dates only if user filled BOTH end fields (End is
       optional in Phase B — partial entries are accepted). */
    if ($("endMonth").value && $("endYear").value) {
      if (_isEndBeforeStart(
            $("startMonth").value, $("startYear").value,
            $("endMonth").value,   $("endYear").value)) {
        showPopup("Your End Date is earlier than your Start Date. Please correct the dates.");
        return;
      }
    }

    const btn = $("step2SubmitBtn");
    setLoading(btn, true);

    /* Build payload */
    const payload = buildPhaseBPayload();

    /* ─── EDIT MODE: UPDATE existing row ─── */
    if (EditState.mode === "edit" && EditState.editingId) {
      payload.education_number = EditState.editingNumber;
      try {
        await apiUpdateEducation(EditState.editingId, payload);
      } catch (err) {
        console.error("Education update failed:", err);
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
    payload.education_number = State.currentEducationNumber;

    let savedEntry;
    try {
      /* apiSaveEducation returns the full saved entry INCLUDING the new
         UUID `id`. We must capture and store it — without the id in
         State.educations, clicking "Edit" on the just-saved entry (before
         a page reload) would set EditState.editingId to undefined and
         apiUpdateEducation(undefined, …) would fail with "education not
         found". This bug existed only on the no-reload Phase B path. */
      savedEntry = await apiSaveEducation(payload);
    } catch (err) {
      console.error("Education save failed:", err);
      showToast("Could not save to server. Your data is preserved — please try again.", "error");
      setLoading(btn, false);
      return; /* STOP — do not advance or duplicate state */
    }

    /* Backend save succeeded — clear THIS education's Phase B draft */
    SaveNow.clearDraft("B");

    /* Save to in-memory state. Use the entry returned by apiSaveEducation
       (which includes the new UUID `id`) so the saved-list edit/delete
       buttons work immediately, before any page reload. */
    State.educations.push(savedEntry);
    State.educationCount++;
    State.currentEducationNumber++;

    State.projectCounters = {};

    /* Update UI for the next entry */
    $("eduNumberPage2").textContent = "Education " + State.currentEducationNumber;
    $("educationStep2").reset();
    $("projectsContainerStep2").innerHTML = "";
    $("projectBlockStep2").classList.add("hidden");
    renderEducationList();
    setLoading(btn, false);
    showToast("Education saved successfully!", "success");
  });

  /* Save & Continue from Phase B
     If the form has any data, validate + save it to the backend before
     navigating, so the user's typed entry is not lost. If the form is
     empty, behaviour depends on whether they have already added entries:
       - has entries → mark complete, navigate
       - no entries  → show "please fill" popup */
  $("step2ContinueBtn").addEventListener("click", async () => {
    const btn = $("step2ContinueBtn");

    /* Detect whether the user has typed anything into the form. */
    const hasAnyInput = trim($("institution").value) ||
                        trim($("degree").value)      ||
                        $("startMonth").value        ||
                        $("startYear").value         ||
                        trim($("field_of_study").value) ||
                        trim($("grade").value)       ||
                        trim($("activities").value);

    if (!hasAnyInput) {
      if (State.educations.length === 0) {
        showPopup(
          "You haven't added any past education yet.\n\n" +
          "Either fill in this education entry (Institution Name, Degree, and Start Date are required) " +
          "and click Save & Continue, or click \"Edit Previously Answered Context\" above " +
          "to go back and continue without past education."
        );
        return;
      }
      /* User has entries already and the form is empty — mark complete
         and navigate. */
      localStorage.setItem("education_completed", "yes");
      localStorage.setItem("profile_last_updated", new Date().toLocaleDateString("en-US"));
      SaveNow.clearDraft("B");
      window.parent.postMessage(
        { type: "navigate", page: "skills.html", sidebarKey: "Your Skills" },
        "*"
      );
      return;
    }

    /* User has filled (some of) the form — validate and save it before
       navigating, so their data isn't lost. */
    if (!trim($("institution").value)) {
      showPopup("Please enter the institution name."); return;
    }
    if (!trim($("degree").value)) {
      showPopup("Please enter the degree."); return;
    }
    if (!$("startMonth").value || !$("startYear").value) {
      showPopup("Please select the start date."); return;
    }
    if (!$("hasAcademicProjectStep2").value) {
      showPopup("Please answer the academic project question."); return;
    }
    /* Start Date cannot be in the future (past education entry). */
    if (_isFutureMonth($("startMonth").value, $("startYear").value)) {
      showPopup(
        "Start date cannot be in the future. " +
        "Please pick a month and year that is not later than the current month."
      );
      return;
    }
    /* End Date cannot be in the future for past education either. */
    if ($("endMonth").value && $("endYear").value &&
        _isFutureMonth($("endMonth").value, $("endYear").value)) {
      showPopup(
        "End date cannot be in the future for a past education entry. " +
        "If this is an education you are still pursuing, use the previous step instead."
      );
      return;
    }
    /* Cross-validate dates only if user filled BOTH end fields (End is
       optional in Phase B). */
    if ($("endMonth").value && $("endYear").value) {
      if (_isEndBeforeStart(
            $("startMonth").value, $("startYear").value,
            $("endMonth").value,   $("endYear").value)) {
        showPopup("Your End Date is earlier than your Start Date. Please correct the dates.");
        return;
      }
    }

    setLoading(btn, true);

    const payload = buildPhaseBPayload();
    payload.education_number = State.currentEducationNumber;

    try {
      await apiSaveEducation(payload);
    } catch (err) {
      console.error("Education save failed:", err);
      showToast("Could not save to server. Your data is preserved — please try again.", "error");
      setLoading(btn, false);
      return;
    }

    /* Saved — push to in-memory state */
    State.educations.push({
      institution      : payload.institution,
      degree           : payload.degree,
      field_of_study   : payload.field_of_study,
      start_month      : payload.start_month,
      start_year       : payload.start_year,
      end_month        : payload.end_month,
      end_year         : payload.end_year,
      grade            : payload.grade,
      skills           : payload.skills,
      activities       : payload.activities,
      has_academic_project: payload.has_academic_project,
      projects         : payload.projects,
      education_number : payload.education_number
    });

    localStorage.setItem("education_completed", "yes");
    localStorage.setItem("profile_last_updated", new Date().toLocaleDateString("en-US"));

    /* Clear Phase B draft on successful continue */
    SaveNow.clearDraft("B");

    window.parent.postMessage(
      { type: "navigate", page: "skills.html", sidebarKey: "Your Skills" },
      "*"
    );

    setTimeout(() => setLoading(btn, false), 800);
  });
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  /* Populate all month/year dropdowns. Start Year dropdowns are capped
     at the current year — education start dates cannot be in the future.
     End Year dropdowns retain the default 2055 cap because "Expected
     Month/Year of Passing" can reach 5–10 years ahead for long programmes. */
  const thisYear = new Date().getFullYear();
  populateMonthYear("eduStartMonth", "eduStartYear", { maxYear: thisYear });
  populateMonthYear("eduEndMonth",   "eduEndYear");
  populateMonthYear("startMonth",    "startYear",    { maxYear: thisYear });
  populateMonthYear("endMonth",      "endYear");

  /* Initial state */
  $("educationStep1").classList.remove("hidden");
  $("educationStep2").classList.add("hidden");

  setupDependencies();
  setupStep1Submit();
  setupStep2Submit();

  /* Wire Cancel Edit button (Phase B edit mode) */
  const cancelBtn = $("cancelEditEducationBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", exitEditMode);

  /* ── Wire the shared Save Now / draft-restore engine ──
     Education has TWO forms (Phase A: context gate, Phase B:
     repeatable past education entries). The shared engine is
     told which phase is active via the activePhase() callback. */
  function getActivePhase() {
    const step2 = $("educationStep2");
    if (step2 && !step2.classList.contains("hidden")) return "B";
    return "A";
  }

  SaveNow.init({
    pageName    : "education",
    formIds     : ["educationStep1", "educationStep2"],
    activePhase : getActivePhase,

    capturePayload: () => {
      return getActivePhase() === "A" ? buildPhaseADraft() : buildPhaseBDraft();
    },

    isEmpty: () => {
      if (getActivePhase() === "A") {
        return !$("currentlyPursuing")?.value &&
               !trim($("fieldOfStudy")?.value || "") &&
               !trim($("institutionName")?.value || "");
      }
      return !trim($("institution")?.value || "") &&
             !trim($("degree")?.value || "");
    },

    /* Both phases now have a real backend. apiSave routes to the right one. */
    apiSave: (payload) => {
      if (getActivePhase() === "A") {
        return apiSaveCurrentEducation(buildPhaseAPayload());
      }
      return apiSaveEducation(buildPhaseBPayload());
    },

    restoreLabel: (envelope) => {
      const meta = envelope._meta || {};
      if (meta.scope === "A") return "on the current-education question";
      if (meta.scope) return "on Education-" + meta.scope;
      return "";
    },

    restorePayload: (draft, meta) => {
      if (meta && meta.scope === "A") {
        return restorePhaseADraft(draft);
      }
      restorePhaseBDraft(draft);
      if (meta && meta.scope) {
        const n = parseInt(meta.scope, 10);
        if (!isNaN(n)) {
          State.currentEducationNumber = n;
          const titleEl = $("eduNumberPage2");
          if (titleEl) titleEl.textContent = "Education " + n;
        }
      }
      return true;
    }
  });

  /* Load saved data from Supabase. Two parallel loads (Phase A + Phase B). */
  loadAllSavedEducationData();
});

/* Load Phase A (current education) and Phase B (past educations) from
   Supabase. Errors are logged but don't show toasts on page load — we
   don't want to scare the user before they've done anything. */
async function loadAllSavedEducationData() {
  if (!MC.candidateId) {
    console.warn("[education] No candidate_id — saves will be local-only until login.");
    return;
  }

  /* ── Phase B first (the more visible one) ── */
  try {
    const rows = await apiLoadAllEducations();
    if (rows && rows.length > 0) {
      State.educations = rows;
      let maxNum = 0;
      rows.forEach(r => {
        const n = parseInt(r.education_number, 10) || 0;
        if (n > maxNum) maxNum = n;
      });
      State.currentEducationNumber = maxNum + 1;
      State.educationCount = rows.length;
      renderEducationList();
    }
  } catch (err) {
    console.warn("[education] Could not load past educations:", err);
  }

  /* ── Phase A — fill the current-education form if user has saved data ── */
  try {
    const cur = await apiLoadCurrentEducation();
    if (cur) {
      State.page1Data = {
        currentlyPursuing: cur.currently_pursuing,
        educationLevel   : cur.education_level,
        fieldOfStudy     : cur.field_of_study,
        institutionName  : cur.institution_name,
        educationMode    : cur.education_mode,
        eduStartMonth    : cur.edu_start_month,
        eduStartYear     : cur.edu_start_year,
        eduEndMonth      : cur.edu_end_month,
        eduEndYear       : cur.edu_end_year,
        hasAcademicProject: cur.has_academic_project,
        current_projects : cur.current_projects || []
      };
      restorePhaseAFromDb(cur);
    }
  } catch (err) {
    console.warn("[education] Could not load current education:", err);
  }
}

/* Apply a Phase A row from DB into the form. Mirrors restorePhaseADraft
   but works with snake_case column names instead of camelCase draft keys. */
function restorePhaseAFromDb(cur) {
  const setVal = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  setVal("currentlyPursuing", cur.currently_pursuing);
  setVal("educationLevel",    cur.education_level);
  setVal("fieldOfStudy",      cur.field_of_study);
  setVal("institutionName",   cur.institution_name);
  setVal("educationMode",     cur.education_mode);
  setVal("eduStartMonth",     cur.edu_start_month);
  setVal("eduStartYear",      cur.edu_start_year);
  setVal("eduEndMonth",       cur.edu_end_month);
  setVal("eduEndYear",        cur.edu_end_year);
  setVal("hasAcademicProject", cur.has_academic_project);

  /* Trigger conditional-block visibility */
  $("currentlyPursuing").dispatchEvent(new Event("change"));
  $("hasAcademicProject").dispatchEvent(new Event("change"));

  /* Rebuild current-education project cards from JSONB array */
  const projects = Array.isArray(cur.current_projects) ? cur.current_projects : [];
  const container = $("projectsContainerStep1");
  if (!container) return;
  container.innerHTML = "";
  State.projectCounters["projectsContainerStep1"] = 0;
  if (projects.length === 0) return;
  /* Show project block + add a card per saved project */
  $("projectBlockStep1").classList.remove("hidden");
  projects.forEach((proj, idx) => {
    addProject("projectsContainerStep1");
    const cards = container.querySelectorAll(".project-card");
    const card = cards[idx];
    if (!card) return;
    const fields = card.querySelectorAll("input, textarea");
    if (fields.length < 4) return;
    fields[0].value = proj.name        || "";
    fields[1].value = proj.ask         || "";
    fields[2].value = proj.role        || "";
    fields[3].value = proj.deliverable || "";
    fields.forEach(f => {
      if (f.tagName === "TEXTAREA") f.dispatchEvent(new Event("input"));
    });
  });
}
