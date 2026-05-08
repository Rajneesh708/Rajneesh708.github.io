/* ============================================================
   MECULS — professional_introduction.js
   About You section logic.
   No api.js dependency. No alert(). No inline styles.
   postMessage navigation to parent dashboard.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.PROFESSIONAL_INTRODUCTION_VERSION
   "phase1-step3-v14" means this file (with localStorage-guard
   removed) is loaded. */
window.PROFESSIONAL_INTRODUCTION_VERSION = "phase1-step3-v14";

/* ── Config ──
   candidateId now comes from MC.candidateId (mc_helpers.js).
   Kept as a local const for backward-compatibility with the
   rest of this file's existing references. */
const candidateId  = MC.candidateId;
const userType     = localStorage.getItem("user_type");

/* ── DOM refs — main section ──
   $ aliased to MC.$ so existing code throughout this file
   continues to work unchanged. */
const $ = MC.$;

const profileForm    = $("profileForm");
const saveBtn        = $("saveBtn");

const headline       = $("headline");
const summary        = $("summary");
const resCountry     = $("resCountry");
const resCountryOther= $("resCountryOther");
const permCountry    = $("permCountry");
const permCountryOther=$("permCountryOther");
const sameAddress    = $("sameAddress");
const permAddressCard= $("permAddressCard");

const preferredCountries     = $("preferredCountries");
const preferredCountriesOther= $("preferredCountriesOther");
const preferredIndiaLocations= $("preferredIndiaLocations");
const foreignVisa            = $("foreignVisa");
const foreignVisaDetailsGroup= $("foreignVisaDetailsGroup");
const foreignVisaDetails     = $("foreignVisaDetails");
const skillsTop5             = $("skillsTop5");
/* ri entries managed below */

/* ============================================================
   HELPERS
   All shared helpers come from mc_helpers.js (MC.* namespace).
   Aliased to local names so the rest of this file is unchanged.
   ============================================================ */

const showPopup  = MC.showPopup;
const showToast  = MC.showToast;
const setLoading = MC.setLoading;
const trim       = MC.trim;

/* ============================================================
   CHAR COUNTERS
   ============================================================ */

function setupCharCounter(fieldId, counterId, max) {
  const field   = $(fieldId);
  const counter = $(counterId);
  if (!field || !counter) return;

  field.addEventListener("input", () => {
    counter.textContent = field.value.length + " / " + max;
  });
}

/* ============================================================
   CONDITIONAL SECTION VISIBILITY
   Show only the section relevant to the user's profile type.
   All special sections start hidden in HTML.
   ============================================================ */


/* ============================================================
   RESEARCHER / INNOVATOR / PATENT HOLDER — entry management
   Mirrors the skills/references add-to-list pattern exactly.
   ============================================================ */

/* In-memory state for RI entries */
let riEntries = [];
let riUid     = 0;

/* Label/option configs per type */
const RI_CONFIG = {
  Researcher: {
    heading    : "Add a Research Entry",
    domainLabel: "Research Domain",
    typeLabel  : "Research Type",
    skillsLabel: "Research Skills",
    aboutLabel : "About Your Research",
    subTypes   : ["Academic Research", "Industry Research", "Independent Research"],
    badgeClass : "ri-card__badge--Researcher"
  },
  Innovator: {
    heading    : "Add an Innovation Entry",
    domainLabel: "Innovation Domain",
    typeLabel  : "Innovation Type",
    skillsLabel: "Innovation Skills",
    aboutLabel : "About Your Innovation",
    subTypes   : ["Academic Innovation", "Industry Innovation"],
    badgeClass : "ri-card__badge--Innovator"
  },
  "Patent Holder": {
    heading    : "Add a Patent Entry",
    domainLabel: "Patent Domain",
    typeLabel  : "Patent Type",
    skillsLabel: "Patent Skills",
    aboutLabel : "About Your Patent",
    subTypes   : ["Academic Patent", "Industry Patent"],
    badgeClass : "ri-card__badge--Patent"
  }
};

function renderRIEntries() {
  const list = $("riEntriesList");
  if (!list) return;
  list.innerHTML = "";

  if (riEntries.length === 0) return;

  const heading = document.createElement("h3");
  heading.className = "ri-list-heading";
  heading.textContent = "Saved Entries (" + riEntries.length + ")";
  list.appendChild(heading);

  riEntries.forEach(entry => {
    const cfg = RI_CONFIG[entry.type] || {};
    const badgeClass = cfg.badgeClass || "ri-card__badge--Researcher";

    const card = document.createElement("div");
    card.className = "ri-card";

    /* Body — left side */
    const body = document.createElement("div");
    body.className = "ri-card__body";

    /* Type badge (Researcher / Innovator / Patent Holder).
       textContent for entry.type so it can never carry HTML. */
    const badge = document.createElement("span");
    badge.className = "ri-card__badge " + badgeClass;
    badge.textContent = entry.type;
    body.appendChild(badge);

    /* Domain (free text — must be textContent) */
    const domainEl = document.createElement("div");
    domainEl.className = "ri-card__domain";
    domainEl.textContent = entry.domain;
    body.appendChild(domainEl);

    /* Sub-type (free text in some cases — must be textContent) */
    const metaEl = document.createElement("div");
    metaEl.className = "ri-card__meta";
    metaEl.textContent = entry.subType;
    body.appendChild(metaEl);

    /* Skills line (free text — must be textContent) */
    const skillsEl = document.createElement("div");
    skillsEl.className = "ri-card__skills";
    skillsEl.textContent = "Skills: " + entry.skills;
    body.appendChild(skillsEl);

    /* About paragraph (long free text — must be textContent) */
    const aboutEl = document.createElement("div");
    aboutEl.className = "ri-card__about";
    aboutEl.textContent = entry.about;
    body.appendChild(aboutEl);

    card.appendChild(body);

    /* Actions — Remove button. Wire handler directly here so we don't
       need a separate querySelectorAll pass that risks loading uid from
       a string attribute. */
    const actions = document.createElement("div");
    actions.className = "ri-card__actions";
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn--danger-soft";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      riEntries = riEntries.filter(e => e.uid !== entry.uid);
      renderRIEntries();
    });
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    list.appendChild(card);
  });
}

function addRIEntry() {
  const type    = $("riType")    ? $("riType").value         : "";
  const domain  = $("riDomain")  ? $("riDomain").value.trim(): "";
  const subType = $("riSubType") ? $("riSubType").value      : "";
  const skills  = $("riSkills")  ? $("riSkills").value.trim(): "";
  const about   = $("riAbout")   ? $("riAbout").value.trim() : "";

  if (!type)    { showPopup("Please select whether you are a Researcher, Innovator, or Patent Holder."); return; }
  if (!domain)  { showPopup("Please fill this form first."); return; }
  if (!subType) { showPopup("Please fill this form first."); return; }
  if (!skills)  { showPopup("Please fill this form first."); return; }
  if (!about)   { showPopup("Please fill this form first."); return; }

  /* Max 3 skills */
  const skillList = skills.split(",").map(s => s.trim()).filter(Boolean);
  if (skillList.length > 3) {
    showPopup("You can enter up to 3 skills only. Please reduce the number of entries.");
    return;
  }

  riEntries.push({
    uid    : ++riUid,
    type,
    domain,
    subType,
    skills : skillList.join(", "),
    about
  });

  /* Clear form for next entry */
  $("riDomain").value  = "";
  $("riSubType").value = "";
  $("riSkills").value  = "";
  $("riAbout").value   = "";
  $("riAboutCounter").textContent = "0 / 1,500";

  renderRIEntries();
  $("riDomain").focus();
  showToast("Entry added to list.", "success");
}

function setupRITypeSelector() {
  const sel = $("riType");
  if (!sel) return;

  sel.addEventListener("change", () => {
    const type = sel.value;
    const formCard = $("riFormCard");
    if (!formCard) return;

    if (!type) {
      formCard.classList.add("hidden");
      return;
    }

    formCard.classList.remove("hidden");
    const cfg = RI_CONFIG[type];

    /* Update labels */
    $("riFormHeading").textContent  = cfg.heading;
    $("riDomainLabel").innerHTML    = cfg.domainLabel + ` <span class="required">*</span>`;
    $("riSubTypeLabel").innerHTML   = cfg.typeLabel   + ` <span class="required">*</span>`;
    $("riSkillsLabel").innerHTML    = cfg.skillsLabel + ` <span class="required">*</span>`;
    $("riAboutLabel").innerHTML     = cfg.aboutLabel  + ` <span class="required">*</span>`;

    /* Rebuild sub-type options */
    const subTypeSel = $("riSubType");
    subTypeSel.innerHTML = `<option value="">Select</option>`;
    cfg.subTypes.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt; o.textContent = opt;
      subTypeSel.appendChild(o);
    });

    /* Clear form values */
    $("riDomain").value  = "";
    $("riSubType").value = "";
    $("riSkills").value  = "";
    $("riAbout").value   = "";
    $("riAboutCounter").textContent = "0 / 1,500";
  });

  /* Char counter for riAbout */
  const riAbout = $("riAbout");
  const riCounter = $("riAboutCounter");
  if (riAbout && riCounter) {
    riAbout.addEventListener("input", () => {
      riCounter.textContent = riAbout.value.length + " / 1,500";
    });
  }

  /* Wire add button */
  const addBtn = $("riAddBtn");
  if (addBtn) addBtn.addEventListener("click", addRIEntry);
}

function applyUserTypeVisibility() {
  const map = {
    defense       : "defenseSection",
    defense_family: "defenseFamilySection",
    researcher    : "researcherSection"
  };

  const targetId = map[userType];
  if (targetId) {
    const section = $(targetId);
    if (section) section.classList.remove("hidden");
  }
}

/* ============================================================
   DEPENDENCY LOGIC
   ============================================================ */

function setupDependencies() {

  /* Residence country → Other field */
  resCountry.addEventListener("change", () => {
    resCountryOther.classList.toggle("hidden",
      !resCountry.value.includes("Other"));
  });

  /* Permanent country → Other field */
  permCountry.addEventListener("change", () => {
    permCountryOther.classList.toggle("hidden",
      !permCountry.value.includes("Other"));
  });

  /* Same address checkbox → hide/show permanent address card */
  sameAddress.addEventListener("change", () => {
    permAddressCard.classList.toggle("hidden", sameAddress.checked);

    if (sameAddress.checked) {
      /* Copy residence values to permanent fields */
      $("permAddress").value  = $("resAddress").value;
      $("permPinCode").value  = $("resPinCode").value;
      $("permState").value    = $("resState").value;
      permCountry.value       = resCountry.value;
      permCountryOther.value  = resCountryOther.value;

      /* Make permanent fields non-required when hidden */
      ["permAddress","permPinCode","permState","permCountry"].forEach(id => {
        const el = $(id);
        if (el) el.required = false;
      });
    } else {
      ["permAddress","permPinCode","permState","permCountry"].forEach(id => {
        const el = $(id);
        if (el) el.required = true;
      });
    }
  });

  /* Preferred countries → India locations + Other field */
  preferredCountries.addEventListener("change", () => {
    const selected = [...preferredCountries.selectedOptions].map(o => o.value);
    const hasIndia = selected.includes("India");
    const hasOther = selected.some(v => v.includes("Other"));

    preferredIndiaLocations.disabled = !hasIndia;
    if (!hasIndia) preferredIndiaLocations.value = "";

    preferredCountriesOther.classList.toggle("hidden", !hasOther);
  });

  /* Preferred India Locations cap — max 5 entries, popup with rising-edge guard.
     The textarea has maxlength="300" (character limit) but no enforcement on
     count of comma-separated entries. Without this, users could type 10 cities
     and they'd all be saved. The rising-edge guard prevents popup re-firing
     on every keystroke when count is already over 5. */
  let indiaLoc_warned = false;
  preferredIndiaLocations.addEventListener("input", () => {
    const locations = preferredIndiaLocations.value.split(",").map(s => trim(s)).filter(Boolean);
    if (locations.length > 5) {
      if (!indiaLoc_warned) {
        MC.showPopup("Maximum 5 locations allowed. Extra locations have been removed.");
        indiaLoc_warned = true;
      }
      preferredIndiaLocations.value = locations.slice(0, 5).join(", ");
    } else {
      indiaLoc_warned = false;
    }
  });

  /* Foreign visa → details field */
  foreignVisa.addEventListener("change", () => {
    const isYes = foreignVisa.value === "Yes";
    foreignVisaDetailsGroup.classList.toggle("hidden", !isYes);
    foreignVisaDetails.required = isYes;
    if (!isYes) foreignVisaDetails.value = "";
  });

  /* Skills top 5 limiter — popup, rising-edge guard.
     Previously used a small toast which users found easy to miss.
     Now uses MC.showPopup (modal with OK button) so the cap is
     visibly acknowledged. The _warned guard prevents the popup
     re-firing on every keystroke when count is already over 5 —
     it only fires when count CROSSES from ≤5 to >5. */
  let skillsTop5_warned = false;
  skillsTop5.addEventListener("input", () => {
    const skills = skillsTop5.value.split(",").map(s => trim(s)).filter(Boolean);
    if (skills.length > 5) {
      if (!skillsTop5_warned) {
        MC.showPopup("Maximum 5 skills allowed. Extra skills have been removed.");
        skillsTop5_warned = true;
      }
      skillsTop5.value = skills.slice(0, 5).join(", ");
    } else {
      skillsTop5_warned = false;
    }
  });
}

/* ============================================================
   API SAVE — Supabase
   ============================================================ */

async function apiSaveProfile(payload) {
  /* Phase 1 Step 3: writes to profiles.data.introduction JSONB section
     via MC.saveSection (the dropped introduction table is gone). The
     entire payload object — exactly what buildPayload() returns — is
     stored under the "introduction" key. No column mapping needed
     because there are no individual columns any more.

     The shape buildPayload() returns IS the shape restoreForm() reads,
     so save and load round-trip cleanly. */
  return await MC.saveSection("introduction", payload || {});
}

/* ============================================================
   BUILD PAYLOAD
   ============================================================ */

function buildPayload() {
  const base = {
    user_type          : userType,
    headline           : trim(headline.value),
    summary            : trim(summary.value),
    res_address        : trim($("resAddress").value),
    res_pin_code       : trim($("resPinCode").value),
    res_state          : trim($("resState").value),
    res_country        : resCountry.value,
    res_country_other  : trim(resCountryOther.value) || null,
    perm_address       : sameAddress.checked ? trim($("resAddress").value)   : trim($("permAddress").value),
    perm_pin_code      : sameAddress.checked ? trim($("resPinCode").value)   : trim($("permPinCode").value),
    perm_state         : sameAddress.checked ? trim($("resState").value)     : trim($("permState").value),
    perm_country       : sameAddress.checked ? resCountry.value              : permCountry.value,
    perm_country_other : sameAddress.checked ? trim(resCountryOther.value)   : trim(permCountryOther.value) || null,
    total_experience   : parseInt($("totalExperience").value) || 0,
    preferred_countries: [...preferredCountries.selectedOptions].map(o => o.value),
    preferred_countries_other: trim(preferredCountriesOther.value) || null,
    preferred_india_locations: trim(preferredIndiaLocations.value) || null,
    foreign_visa       : foreignVisa.value,
    foreign_visa_details: trim(foreignVisaDetails.value) || null,
    willing_to_relocate: $("willingToRelocate").value,
    industry           : $("industryType").value,
    current_position   : trim($("currentPosition").value),
    skills_top5        : skillsTop5.value.split(",").map(s => trim(s)).filter(Boolean)
  };

  /* Append section-specific fields */
  if (userType === "defense") {
    base.service_branch      = $("serviceBranch").value;
    base.years_of_service    = parseInt($("yearsOfService").value) || 0;
    base.rank_designation    = trim($("rankDesignation").value);
    base.defense_skills      = trim($("defenseSkills").value);
    base.career_transition   = $("careerTransition").value;
  }

  if (userType === "defense_family") {
    base.relationship        = $("relationship").value;
    base.employment_status   = $("employmentStatus").value;
    base.def_family_skills   = trim($("defFamilySkills").value);
    base.support_looking_for = $("supportLookingFor").value;
  }

  if (userType === "researcher") {
    base.ri_type    = $("riType") ? $("riType").value : null;
    base.ri_entries = riEntries.map(e => ({
      type    : e.type,
      domain  : e.domain,
      sub_type: e.subType,
      skills  : e.skills,
      about   : e.about
    }));
  }

  return base;
}

/* ============================================================
   VALIDATE
   ============================================================ */

function validate() {
  /* Each entry: [valueExpression, friendlyFieldName].
     We collect ALL missing fields and show them in one popup so the
     user sees everything at once. With 12+ required fields plus
     conditional defense/family sections, the old "stop at first" UX
     forced the user to click Save many times to discover everything. */
  const checks = [
    [trim(headline.value),               "Professional Headline"],
    [trim(summary.value),                "Professional Summary"],
    [trim($("resAddress").value),        "Residence Address"],
    [trim($("resPinCode").value),        "Residence PIN Code"],
    [trim($("resState").value),          "Residence State"],
    [resCountry.value,                   "Residence Country"],
    [parseInt($("totalExperience").value) >= 0 ? "ok" : "",
                                         "Total Years of Experience"],
    [[...preferredCountries.selectedOptions].length > 0 ? "ok" : "",
                                         "Preferred Countries (at least one)"],
    [foreignVisa.value,                  "Foreign Work Visa question"],
    [$("willingToRelocate").value,       "Willing to Relocate question"],
    [$("industryType").value,            "Current Industry"],
    [trim($("currentPosition").value),   "Current Position"],
    [skillsTop5.value.split(",").map(s => trim(s)).filter(Boolean).length > 0 ? "ok" : "",
                                         "Top Skills (at least one)"],
  ];

  if (!sameAddress.checked) {
    checks.push([trim($("permAddress").value),  "Permanent Address"]);
    checks.push([trim($("permPinCode").value),  "Permanent PIN Code"]);
    checks.push([trim($("permState").value),    "Permanent State"]);
    checks.push([permCountry.value,             "Permanent Country"]);
  }

  if (foreignVisa.value === "Yes") {
    checks.push([trim(foreignVisaDetails.value), "Foreign Work Visa Details"]);
  }

  /* Defense personnel: validate required fields when this section is visible. */
  if (userType === "defense") {
    checks.push([$("serviceBranch").value,            "Service Branch"]);
    checks.push([$("yearsOfService").value !== "" &&
                 parseInt($("yearsOfService").value) >= 0 ? "ok" : "",
                                                       "Years of Service"]);
    checks.push([trim($("rankDesignation").value),    "Rank or Designation"]);
    checks.push([trim($("defenseSkills").value),      "Skills and Expertise"]);
    checks.push([$("careerTransition").value,         "Career Transition Interest"]);
  }

  /* Family member of defense personnel: validate required fields when visible. */
  if (userType === "defense_family") {
    checks.push([$("relationship").value,             "Relationship to Defense Personnel"]);
    checks.push([$("employmentStatus").value,         "Current Employment Status"]);
    checks.push([trim($("defFamilySkills").value),    "Skills or Qualifications"]);
    checks.push([$("supportLookingFor").value,        "Support / Opportunity You Are Looking For"]);
  }

  /* Collect missing simple fields. */
  const missing = [];
  for (const [val, name] of checks) {
    if (!val) missing.push(name);
  }

  /* "Other (please specify)" reveal inputs — must be filled when "Other"
     is selected. These are conditional; previously they weren't validated
     at all, allowing null to be saved silently. */
  if (resCountry.value && resCountry.value.includes("Other") && !trim(resCountryOther.value)) {
    missing.push("Residence Country — please specify");
  }
  if (!sameAddress.checked && permCountry.value && permCountry.value.includes("Other") && !trim(permCountryOther.value)) {
    missing.push("Permanent Country — please specify");
  }
  /* Preferred countries is a multi-select; check if "Other" was chosen. */
  const prefVals = [...preferredCountries.selectedOptions].map(o => o.value);
  if (prefVals.some(v => v.includes("Other")) && !trim(preferredCountriesOther.value)) {
    missing.push("Preferred Countries — please specify");
  }

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

  /* Researcher section: must have at least one entry */
  if (userType === "researcher") {
    if (!$("riType") || !$("riType").value) {
      showPopup("Please select whether you are a Researcher, Innovator, or Patent Holder.");
      return false;
    }
    if (riEntries.length === 0) {
      showPopup("Please add at least one entry using the \"+ Add to List\" button.");
      return false;
    }
  }

  return true;
}

/* ============================================================
   SAVE NOW + DRAFT RESTORE
   All Save Now logic lives in save_now.js (shared module).
   This page just calls SaveNow.init({...}) in DOMContentLoaded
   and SaveNow.clearDraft() after successful Save & Continue.
   ============================================================ */


profileForm.addEventListener("submit", async e => {
  e.preventDefault();

  /* v=14 (2026-05-08): Removed the localStorage guard that
     blocked Save & Continue when "profile_category_completed"
     was missing from localStorage.

     WHY IT WAS BROKEN:
     localStorage is wiped on logout (cross-user data isolation
     fix from earlier). After logout/login, the key was gone, so
     this guard fired silently — Save & Continue did nothing,
     no toast visible, no error in console. Users had to navigate
     back to Profile Category and re-save to repopulate
     localStorage before Intro's Save would work.

     WHY REMOVING IT IS SAFE:
     The save itself doesn't depend on Profile Category being
     saved first — apiSaveProfile() writes to its own JSONB key
     (data.introduction). Dashboard.js already tracks completion
     from server data via COMPLETION_PREDICATES (which read from
     PROFILE_CACHE, not localStorage). The build flow's section
     ordering is enforced visually in the sidebar, not by per-page
     guards. */

  if (!validate()) return;

  setLoading(saveBtn, true);

  const payload = buildPayload();

  try {
    const data = await apiSaveProfile(payload);
    if (data?.candidate_id) {
      localStorage.setItem("candidate_id", data.candidate_id);
    }
  } catch (err) {
    console.error("Profile save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(saveBtn, false);
    return;
  }

  localStorage.setItem("introduction_completed", "yes");
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* Saved successfully to backend — clear any localStorage draft */
  SaveNow.clearDraft();

  /* Navigate parent dashboard to Add Your Experience */
  window.parent.postMessage(
    {
      type      : "navigate",
      page      : "experience.html",
      sidebarKey: "Your Experience"
    },
    "*"
  );

  setTimeout(() => setLoading(saveBtn, false), 800);
});

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  applyUserTypeVisibility();
  setupDependencies();

  setupCharCounter("headline",     "headlineCounter",  "250");
  setupCharCounter("summary",      "summaryCounter",   "3,000");
  setupRITypeSelector();

  /* Form-population logic, used both by SaveNow draft-restore and by
     the Supabase load below. The shape is the same as buildPayload(). */
  function restoreForm(draft) {
    const setVal = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
    setVal("headline",                draft.headline);
    setVal("summary",                 draft.summary);
    setVal("resAddress",              draft.res_address);
    setVal("resPinCode",              draft.res_pin_code);
    setVal("resState",                draft.res_state);
    if (resCountry      && draft.res_country)       resCountry.value      = draft.res_country;
    if (resCountryOther && draft.res_country_other) resCountryOther.value = draft.res_country_other;
    setVal("permAddress",             draft.perm_address);
    setVal("permPinCode",             draft.perm_pin_code);
    setVal("permState",               draft.perm_state);
    if (permCountry      && draft.perm_country)       permCountry.value      = draft.perm_country;
    if (permCountryOther && draft.perm_country_other) permCountryOther.value = draft.perm_country_other;
    setVal("totalExperience",         draft.total_experience);
    setVal("preferredIndiaLocations", draft.preferred_india_locations);
    if (foreignVisa && draft.foreign_visa) foreignVisa.value = draft.foreign_visa;
    setVal("foreignVisaDetails",      draft.foreign_visa_details);
    setVal("willingToRelocate",       draft.willing_to_relocate);
    setVal("industryType",            draft.industry);
    setVal("currentPosition",         draft.current_position);
    if (skillsTop5 && Array.isArray(draft.skills_top5)) {
      skillsTop5.value = draft.skills_top5.join(", ");
    }
    if (preferredCountries && Array.isArray(draft.preferred_countries)) {
      [...preferredCountries.options].forEach(opt => {
        opt.selected = draft.preferred_countries.includes(opt.value);
      });
    }
    setVal("preferredCountriesOther", draft.preferred_countries_other);

    /* Section-specific (defense / defense_family / researcher) */
    if (draft.service_branch)      setVal("serviceBranch",   draft.service_branch);
    if (draft.years_of_service)    setVal("yearsOfService",  draft.years_of_service);
    if (draft.rank_designation)    setVal("rankDesignation", draft.rank_designation);
    if (draft.defense_skills)      setVal("defenseSkills",   draft.defense_skills);
    if (draft.career_transition)   setVal("careerTransition", draft.career_transition);
    if (draft.relationship)        setVal("relationship",    draft.relationship);
    if (draft.employment_status)   setVal("employmentStatus", draft.employment_status);
    if (draft.def_family_skills)   setVal("defFamilySkills", draft.def_family_skills);
    if (draft.support_looking_for) setVal("supportLookingFor", draft.support_looking_for);

    /* PI-4: Restore researcher entries to in-memory array.
       Without this, riEntries stayed empty after page reload and the
       NEXT Save & Continue would overwrite the saved entries with [] —
       silently destroying the user's data. The save shape uses sub_type
       (snake_case) but the in-memory shape uses subType (camelCase). */
    if (userType === "researcher") {
      if (draft.ri_type && $("riType")) {
        $("riType").value = draft.ri_type;
        /* Trigger change so the form card / label config refreshes. */
        $("riType").dispatchEvent(new Event("change"));
      }
      if (Array.isArray(draft.ri_entries) && draft.ri_entries.length > 0) {
        riEntries = draft.ri_entries.map(function (e) {
          return {
            uid    : ++riUid,
            type   : e.type    || "",
            domain : e.domain  || "",
            subType: e.sub_type || e.subType || "",
            skills : e.skills  || "",
            about  : e.about   || ""
          };
        });
        renderRIEntries();
      }
    }

    /* Trigger conditional reveals dependent on dropdowns */
    if (resCountry)         resCountry.dispatchEvent(new Event("change"));
    if (permCountry)        permCountry.dispatchEvent(new Event("change"));
    if (foreignVisa)        foreignVisa.dispatchEvent(new Event("change"));
    if (preferredCountries) preferredCountries.dispatchEvent(new Event("change"));

    /* PI-3: Sync char counters for headline + summary. setVal sets the
       value programmatically, which doesn't fire 'input' — so the
       counters stayed at "0 / 250" and "0 / 3,000" even when the
       textareas had content. Dispatching input now refreshes them. */
    const headlineEl = $("headline");
    const summaryEl  = $("summary");
    if (headlineEl) headlineEl.dispatchEvent(new Event("input"));
    if (summaryEl)  summaryEl.dispatchEvent(new Event("input"));
  }

  /* ── Wire the shared Save Now / draft-restore engine ──
     Configures save_now.js for this page. */
  SaveNow.init({
    pageName: "about_you",
    formIds : ["profileForm"],

    /* Reuse buildPayload — gives drafts the same shape as the
       backend payload, so restore is symmetric. */
    capturePayload: () => buildPayload(),

    /* Skip silent saves when the form is essentially empty. */
    isEmpty: () => !trim(headline.value) && !trim(summary.value),

    /* Backend save endpoint (same one form-submit uses). */
    apiSave: (payload) => apiSaveProfile(payload),

    /* Restore previously-saved values back into the form. */
    restorePayload: restoreForm
  });

  /* ── Load existing data from Supabase ──
     Phase 1 Step 3: reads from profiles.data.introduction JSONB
     section via MC.loadSection (the dropped introduction table is
     gone). The hydration code (restoreForm) is unchanged because the
     payload shape is identical to what buildPayload() saves.
     localStorage drafts (if any) take precedence because they may be
     MORE recent than Supabase (user typed but didn't click Save). */
  (async () => {
    try {
      const data = await MC.loadSection("introduction");
      if (data && typeof data === "object" && Object.keys(data).length > 0) {
        restoreForm(data);
      }
    } catch (err) {
      console.error("[intro] load error:", err);
    }
  })();
});
