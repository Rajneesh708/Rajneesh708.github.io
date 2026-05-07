/* ============================================================
   MECULS — consulting_availability.js
   Consulting Availability section logic.

   Architecture (post-polish 2026-04-30):
     - MC.* shared helpers (no local copies)
     - SaveNow draft-restore engine (single-form scope)
     - candidateId read fresh from MC.candidateId at save time
     - apiLoadConsulting guarded on MC.candidateId
     - parseInt with explicit radix everywhere
     - postMessage navigation to parent dashboard

   Page structure (post-streamline):
     - Availability: 3 options (Available / Selective / Not Available)
       — combined the old Limited + On Request into "Selective"
     - Domains tag list (max 15)
     - Industries tag list (max 10) — NEW
     - Description (max 500 chars, was 600)
     - Engagement type (kept)
     - Company size preference (NEW)
     - Rate range — single-row layout + "Discuss privately" checkbox
       that hides the rate fields when a senior consultant prefers
       not to publish numbers
     - Past consulting work (max 400 chars, kept)
     - Show-on-profile visibility checkbox (NEW)
   Removed: Hours per Week (creates fake data), Working Mode
     (duplicates Preferences page).

   When availability = "Not Available", all detail fields are hidden
   and not validated. Section can still be saved as "Not Available"
   without further data.

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `consulting_availability` table is
     gone. The entire payload now lives at profiles.data.consulting
     as a single JSONB object (1-to-1 section). Save/load go through
     MC.saveSection / MC.loadSection. The JSONB key is "consulting"
     (NOT "consulting_availability") to match the dashboard predicate.
   - Validation popups consolidated into one bullet-list popup
     (matches the pattern from skills, profile_category, certifications,
     references, languages, preferences, ai_tools).
   - Mid-form auto-add for domain and industry inputs on Save & Continue.
     Without this, a user who typed "Talent Strategy" in the domain
     input but forgot to click "+ Add Domain" would lose that data.
     Mirrors references.js / languages.js / ai_tools.js pattern.
   - Defensive: apiLoadConsulting resets the in-memory domains and
     industries arrays before pushing, so re-running the loader
     cannot duplicate entries.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.CONSULTING_AVAILABILITY_VERSION === "phase1-step3" */
window.CONSULTING_AVAILABILITY_VERSION = "phase1-step3";

/* ── Config ── */
const MAX_DOMAINS    = 15;
const MAX_INDUSTRIES = 10;

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $          = MC.$;
const trim       = MC.trim;
const showPopup  = MC.showPopup;
const showToast  = MC.showToast;
const setLoading = MC.setLoading;

/* ── In-memory state ──
   Tag lists are built up locally and serialised on save.
   Each entry: { uid, name }
─────────────────────────────────────────────────────────── */
let domains      = [];
let domainUid    = 0;
let industries   = [];
let industryUid  = 0;

/* ============================================================
   AVAILABILITY CARD SELECTION + CONDITIONAL DETAILS
   ============================================================ */

function setupAvailOptions() {
  const opts    = document.querySelectorAll("#availGrid .avail-option");
  const details = $("consultDetailsSection");

  opts.forEach(opt => {
    opt.addEventListener("click", () => {
      opts.forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      const radio = opt.querySelector("input");
      if (radio) radio.checked = true;

      /* Hide consulting details if Not Available */
      if (opt.getAttribute("data-value") === "Not Available") {
        details.classList.add("hidden");
      } else {
        details.classList.remove("hidden");
      }

      /* Heartbeat to SaveNow */
      if (window.SaveNow && SaveNow.silentSave) {
        SaveNow.silentSave();
        SaveNow.flashStatus();
      }
    });
  });
}

function getSelectedAvail() {
  const checked = document.querySelector('input[name="consultAvail"]:checked');
  return checked ? checked.value : "";
}

function setSelectedAvail(value) {
  const opts = document.querySelectorAll("#availGrid .avail-option");
  opts.forEach(o => o.classList.remove("selected"));
  if (!value) return;
  const opt = document.querySelector(
    `#availGrid .avail-option[data-value="${value}"]`
  );
  if (opt) {
    opt.classList.add("selected");
    const radio = opt.querySelector("input");
    if (radio) radio.checked = true;
    if (value === "Not Available") {
      $("consultDetailsSection").classList.add("hidden");
    } else {
      $("consultDetailsSection").classList.remove("hidden");
    }
  }
}

/* ============================================================
   "DISCUSS RATES PRIVATELY" CHECKBOX
   When checked, hides the rate input row. Rate fields are still
   in the DOM (so SaveNow draft works), they're just visually hidden
   and treated as null on save.
   ============================================================ */

function setupRatePrivacyToggle() {
  const cb = $("rateDiscussPrivately");
  const row = $("rateInputRow");
  if (!cb || !row) return;
  cb.addEventListener("change", () => {
    if (cb.checked) {
      row.classList.add("hidden");
      /* Clear rate inputs so they don't appear in payload */
      $("rateMin").value = "";
      $("rateMax").value = "";
    } else {
      row.classList.remove("hidden");
    }
    if (window.SaveNow && SaveNow.silentSave) {
      SaveNow.silentSave();
      SaveNow.flashStatus();
    }
  });
}

/* ============================================================
   TAG-LIST ENGINE — generic for both domains and industries.
   Renders into a wrap, shows placeholder when empty, supports
   case-insensitive duplicate detection, soft cap, remove via
   closure-over-uid (no innerHTML, no parseInt round-trip).
   ============================================================ */

function makeTagList(opts) {
  /* opts: { wrapId, placeholderId, emptyText, getList, setList,
             nextUid, max, label } */
  function render() {
    const wrap = $(opts.wrapId);
    const placeholder = $(opts.placeholderId);
    wrap.innerHTML = "";

    const list = opts.getList();
    if (list.length === 0) {
      const ph = document.createElement("span");
      ph.id = opts.placeholderId;
      ph.className = "domain-tag domain-tag--placeholder";
      ph.textContent = opts.emptyText;
      wrap.appendChild(ph);
      return;
    }

    list.forEach(item => {
      const tag = document.createElement("span");
      tag.className = "domain-tag";

      const label = document.createElement("span");
      label.textContent = item.name;
      tag.appendChild(label);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "domain-tag__remove";
      remove.title = "Remove";
      remove.setAttribute("aria-label", "Remove " + item.name);
      remove.textContent = "✕";
      const uid = item.uid;
      remove.addEventListener("click", () => {
        opts.setList(opts.getList().filter(d => d.uid !== uid));
        render();
        if (window.SaveNow && SaveNow.silentSave) {
          SaveNow.silentSave();
          SaveNow.flashStatus();
        }
      });
      tag.appendChild(remove);

      wrap.appendChild(tag);
    });
  }

  function add() {
    const inputEl = $(opts.inputId);
    const name = trim(inputEl.value);
    if (!name) return true;   /* nothing typed = nothing to add (success no-op) */

    const list = opts.getList();
    if (list.some(d => d.name.toLowerCase() === name.toLowerCase())) {
      showPopup("\"" + name + "\" is already in your " + opts.label + " list.");
      return false;
    }
    if (list.length >= opts.max) {
      showPopup("You can add a maximum of " + opts.max + " " + opts.label + ".");
      return false;
    }

    list.push({ uid: opts.nextUid(), name });
    opts.setList(list);
    inputEl.value = "";
    inputEl.focus();
    render();

    if (window.SaveNow && SaveNow.silentSave) {
      SaveNow.silentSave();
      SaveNow.flashStatus();
    }
    return true;
  }

  return { render, add };
}

/* Two tag-list managers: one for domains, one for industries. */
const domainList = makeTagList({
  wrapId:        "domainTagWrap",
  placeholderId: "domainPlaceholder",
  inputId:       "domainInput",
  emptyText:     "No domains added yet",
  label:         "domains",
  max:           MAX_DOMAINS,
  getList:       () => domains,
  setList:       (l) => { domains = l; },
  nextUid:       () => ++domainUid
});

const industryList = makeTagList({
  wrapId:        "industryTagWrap",
  placeholderId: "industryPlaceholder",
  inputId:       "industryInput",
  emptyText:     "No industries added yet",
  label:         "industries",
  max:           MAX_INDUSTRIES,
  getList:       () => industries,
  setList:       (l) => { industries = l; },
  nextUid:       () => ++industryUid
});

/* ============================================================
   VALIDATE
   ============================================================ */

function validate() {
  const avail = getSelectedAvail();

  /* Always-required: pick a status. */
  if (!avail) {
    showPopup("Please select your consulting availability status.");
    return false;
  }

  /* Not Available: skip all detail validation. */
  if (avail === "Not Available") return true;

  /* Consolidated missing-field check for the detail section. */
  const missing = [];
  if (domains.length === 0)              missing.push("Consulting Domains (at least one)");
  if (!trim($("consultDesc").value))     missing.push("Consulting Profile Description");

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
    if (domains.length === 0) {
      $("domainInput").focus();
    } else if (!trim($("consultDesc").value)) {
      $("consultDesc").focus();
    }
    return false;
  }

  /* Rate validation — only if both min and max are entered AND user
     hasn't ticked "Discuss privately" */
  const discussPrivately = $("rateDiscussPrivately").checked;
  if (!discussPrivately) {
    const minRaw = $("rateMin").value;
    const maxRaw = $("rateMax").value;
    if (minRaw && maxRaw) {
      const minN = parseFloat(minRaw);
      const maxN = parseFloat(maxRaw);
      if (!isNaN(minN) && !isNaN(maxN) && maxN < minN) {
        showPopup("Maximum rate cannot be less than the minimum rate.");
        $("rateMax").focus();
        return false;
      }
    }
  }

  return true;
}

/* ============================================================
   BUILD PAYLOAD
   ============================================================ */

function buildPayload() {
  const avail = getSelectedAvail();
  const isUnavailable = avail === "Not Available";
  const discussPrivately = $("rateDiscussPrivately").checked;

  /* Parse rate values defensively. parseFloat returns NaN on empty
     strings; we coerce to null in that case. */
  const rateMinRaw = $("rateMin").value;
  const rateMaxRaw = $("rateMax").value;
  const rateMin = (!discussPrivately && rateMinRaw) ? parseFloat(rateMinRaw) : null;
  const rateMax = (!discussPrivately && rateMaxRaw) ? parseFloat(rateMaxRaw) : null;

  return {
    availability_status     : avail,
    show_on_profile         : isUnavailable ? false : $("showOnProfile").checked,
    consulting_domains      : isUnavailable ? [] : domains.map(d => d.name),
    consulting_industries   : isUnavailable ? [] : industries.map(i => i.name),
    profile_description     : isUnavailable ? null : (trim($("consultDesc").value) || null),
    engagement_type         : isUnavailable ? null : ($("engagementType").value || null),
    company_size_preference : isUnavailable ? null : ($("companySizePref").value || null),
    rate_discuss_privately  : isUnavailable ? false : discussPrivately,
    rate_min                : (rateMin != null && !isNaN(rateMin)) ? rateMin : null,
    rate_max                : (rateMax != null && !isNaN(rateMax)) ? rateMax : null,
    rate_currency           : isUnavailable ? null : ($("rateCurrency").value || null),
    rate_unit               : isUnavailable ? null : ($("rateUnit").value || null),
    past_work_highlight     : isUnavailable ? null : (trim($("pastConsultWork").value) || null)
  };
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `consulting_availability` table is gone. The entire
   payload now lives at profiles.data.consulting as a single JSONB
   object. Save/load go through MC.saveSection / MC.loadSection
   which handle auth and RLS server-side via the save_profile_section
   RPC.

   The JSONB section key is "consulting" (NOT "consulting_availability")
   to match the dashboard's completion predicate.

   This bundle is 1-to-1: one object per candidate. The shape we
   save matches the buildPayload() output so downstream loaders/
   public-profile renderers get a stable schema.
   ============================================================ */

async function apiSave(payload) {
  /* Coerce nullable numerics defensively. */
  const numOrNull = v =>
    (v === null || v === undefined || v === "") ? null :
    (isNaN(Number(v)) ? null : Number(v));

  /* Normalise the saved object once so both the immediate save and
     any future load see consistent types (especially the boolean
     and array defaults). */
  const obj = {
    availability_status     : payload.availability_status     || null,
    show_on_profile         : payload.show_on_profile === true,
    consulting_domains      : Array.isArray(payload.consulting_domains)
                              ? payload.consulting_domains : [],
    consulting_industries   : Array.isArray(payload.consulting_industries)
                              ? payload.consulting_industries : [],
    profile_description     : payload.profile_description     || null,
    engagement_type         : payload.engagement_type         || null,
    company_size_preference : payload.company_size_preference || null,
    rate_discuss_privately  : payload.rate_discuss_privately === true,
    rate_min                : numOrNull(payload.rate_min),
    rate_max                : numOrNull(payload.rate_max),
    rate_currency           : payload.rate_currency           || null,
    rate_unit               : payload.rate_unit               || null,
    past_work_highlight     : payload.past_work_highlight     || null
  };

  await MC.saveSection("consulting", obj);
  return obj;
}

/* ============================================================
   AUTO-ADD MID-FORM TAGS
   Detects typed-but-not-added domain or industry input and tries
   to add each before save proceeds. Without this, a user who typed
   "Talent Strategy" in the domain input but forgot to click
   "+ Add Domain" would lose that data on Save & Continue.

   Returns:
     - true if there was no mid-form input OR the auto-add succeeded
     - false if there was input but the add failed (duplicate, cap)
       — caller should bail out so the user fixes it. tagList.add()
       has already shown the popup explaining why.
   ============================================================ */
function tryAutoAddPendingTags() {
  /* Domain input */
  const domainTyped = trim($("domainInput").value);
  if (domainTyped) {
    if (!domainList.add()) return false;
  }

  /* Industry input */
  const industryTyped = trim($("industryInput").value);
  if (industryTyped) {
    if (!industryList.add()) return false;
  }

  return true;
}

/* ============================================================
   SAVE & CONTINUE
   ============================================================ */

async function saveContinue() {
  /* Auto-add typed-but-not-added domain/industry entries first.
     If add fails (duplicate / cap), the tag list has already shown
     a popup — we just bail so the user can fix it. */
  if (!tryAutoAddPendingTags()) return;

  if (!validate()) return;

  const btn = $("saveContinueBtn");
  setLoading(btn, true);

  try {
    await apiSave(buildPayload());
  } catch (err) {
    console.error("Consulting availability save failed:", err);
    showToast("Could not save to server. Your data is preserved — please try again.", "error");
    setLoading(btn, false);
    return;
  }

  /* Saved successfully — clear draft */
  if (window.SaveNow) SaveNow.clearDraft();

  MC.safeSet("consulting_completed", "yes");
  MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

  window.parent.postMessage(
    { type: "navigate", page: "key_achievements.html", sidebarKey: "Key Achievements" },
    "*"
  );

  setTimeout(() => setLoading(btn, false), 800);
}

/* ============================================================
   LOAD EXISTING DATA FROM BACKEND
   ============================================================ */

async function apiLoadConsulting() {
  if (!MC.candidateId) return;

  let data;
  try {
    data = await MC.loadSection("consulting");
  } catch (err) {
    /* Non-fatal — page still works for new users when network is offline */
    console.error("Could not load consulting availability:", err);
    return;
  }

  if (!data || !data.availability_status) return;

  /* Defensive: reset in-memory tag lists before pushing loaded entries.
     Without this, calling apiLoadConsulting twice (e.g. via a future
     re-init path) would duplicate every domain/industry. */
  domains = [];
  domainUid = 0;
  industries = [];
  industryUid = 0;

  setSelectedAvail(data.availability_status);

  /* Show-on-profile checkbox */
  if (typeof data.show_on_profile === "boolean") {
    $("showOnProfile").checked = data.show_on_profile;
  }

  /* Domains — JSONB array of strings */
  if (Array.isArray(data.consulting_domains)) {
    data.consulting_domains.forEach(name => {
      if (name) domains.push({ uid: ++domainUid, name });
    });
    domainList.render();
  }

  /* Industries — JSONB array of strings */
  if (Array.isArray(data.consulting_industries)) {
    data.consulting_industries.forEach(name => {
      if (name) industries.push({ uid: ++industryUid, name });
    });
    industryList.render();
  }

  /* Text fields */
  if (data.profile_description) {
    $("consultDesc").value = data.profile_description;
    MC.updateCounter($("consultDesc"), "consultDescCounter");
  }
  if (data.engagement_type)         $("engagementType").value  = data.engagement_type;
  if (data.company_size_preference) $("companySizePref").value = data.company_size_preference;

  /* Rate fields + privacy toggle */
  if (data.rate_discuss_privately) {
    $("rateDiscussPrivately").checked = true;
    $("rateInputRow").classList.add("hidden");
  } else {
    if (data.rate_min != null) $("rateMin").value = data.rate_min;
    if (data.rate_max != null) $("rateMax").value = data.rate_max;
  }
  if (data.rate_currency) $("rateCurrency").value = data.rate_currency;
  if (data.rate_unit)     $("rateUnit").value     = data.rate_unit;

  if (data.past_work_highlight) {
    $("pastConsultWork").value = data.past_work_highlight;
    MC.updateCounter($("pastConsultWork"), "pastConsultCounter");
  }
}

/* ============================================================
   SAVENOW DRAFT — capture and restore
   ============================================================ */

function captureConsultingDraft() {
  return {
    availability_status   : getSelectedAvail(),
    showOnProfile         : $("showOnProfile").checked,
    domains               : domains.map(d => ({ name: d.name })),
    industries            : industries.map(i => ({ name: i.name })),
    consultDesc           : trim($("consultDesc").value),
    engagementType        : $("engagementType").value,
    companySizePref       : $("companySizePref").value,
    rateDiscussPrivately  : $("rateDiscussPrivately").checked,
    rateMin               : $("rateMin").value,
    rateMax               : $("rateMax").value,
    rateCurrency          : $("rateCurrency").value,
    rateUnit              : $("rateUnit").value,
    pastConsultWork       : trim($("pastConsultWork").value)
  };
}

function restoreConsultingDraft(draft) {
  if (!draft) return false;

  if (draft.availability_status) {
    setSelectedAvail(draft.availability_status);
  }

  if (typeof draft.showOnProfile === "boolean") {
    $("showOnProfile").checked = draft.showOnProfile;
  }

  /* Domains */
  if (Array.isArray(draft.domains)) {
    domains = [];
    domainUid = 0;
    draft.domains.forEach(d => {
      if (d && d.name) domains.push({ uid: ++domainUid, name: d.name });
    });
    domainList.render();
  }

  /* Industries */
  if (Array.isArray(draft.industries)) {
    industries = [];
    industryUid = 0;
    draft.industries.forEach(i => {
      if (i && i.name) industries.push({ uid: ++industryUid, name: i.name });
    });
    industryList.render();
  }

  if (draft.consultDesc) {
    $("consultDesc").value = draft.consultDesc;
    MC.updateCounter($("consultDesc"), "consultDescCounter");
  }
  if (draft.engagementType)  $("engagementType").value  = draft.engagementType;
  if (draft.companySizePref) $("companySizePref").value = draft.companySizePref;

  /* Rate privacy toggle */
  if (typeof draft.rateDiscussPrivately === "boolean") {
    $("rateDiscussPrivately").checked = draft.rateDiscussPrivately;
    if (draft.rateDiscussPrivately) {
      $("rateInputRow").classList.add("hidden");
    } else {
      $("rateInputRow").classList.remove("hidden");
    }
  }
  if (draft.rateMin)      $("rateMin").value      = draft.rateMin;
  if (draft.rateMax)      $("rateMax").value      = draft.rateMax;
  if (draft.rateCurrency) $("rateCurrency").value = draft.rateCurrency;
  if (draft.rateUnit)     $("rateUnit").value     = draft.rateUnit;

  if (draft.pastConsultWork) {
    $("pastConsultWork").value = draft.pastConsultWork;
    MC.updateCounter($("pastConsultWork"), "pastConsultCounter");
  }

  return true;
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  setupAvailOptions();
  setupRatePrivacyToggle();
  domainList.render();
  industryList.render();

  /* Char counters */
  $("consultDesc").addEventListener("input", () => {
    MC.updateCounter($("consultDesc"), "consultDescCounter");
  });
  $("pastConsultWork").addEventListener("input", () => {
    MC.updateCounter($("pastConsultWork"), "pastConsultCounter");
  });

  /* Enter key on tag inputs triggers add */
  $("domainInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); domainList.add(); }
  });
  $("industryInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); industryList.add(); }
  });

  $("addDomainBtn").addEventListener("click", () => domainList.add());
  $("addIndustryBtn").addEventListener("click", () => industryList.add());
  $("saveContinueBtn").addEventListener("click", saveContinue);

  /* Load any existing backend data BEFORE SaveNow.init so the draft-restore
     check has the canonical state to compare against. */
  await apiLoadConsulting();

  if (window.SaveNow) {
    SaveNow.init({
      pageName          : "consulting_availability",
      containerSelector : ".form-container",
      capturePayload    : captureConsultingDraft,
      restorePayload    : restoreConsultingDraft,
      apiSave           : (p) => apiSave(p),
      isEmpty           : () => !getSelectedAvail()
                              && domains.length === 0
                              && industries.length === 0
                              && !trim($("consultDesc").value)
                              && !trim($("pastConsultWork").value)
    });
  }
});
