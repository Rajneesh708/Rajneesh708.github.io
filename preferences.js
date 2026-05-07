/* ============================================================
   MECULS — preferences.js
   Preferences & Availability section logic. Polished onto the shared
   architecture:
     - MC.* helpers (no local copies of $/trim/showPopup/showToast/
       setLoading)
     - SaveNow draft-restore for the form (single-form scope, no
       per-entry; one save at the end)
     - candidateId read fresh from MC.candidateId at save/load time
   CTC Min currency auto-syncs to Max currency.
   postMessage navigation to parent dashboard.

   Bug fixed in this polish pass:
   - Currency sync handler was inappropriately toggling Max's
     "Other" input visibility based on Min's value. Each currency
     dropdown now manages its own Other-input visibility independently.
     Only the Max VALUE auto-syncs to Min on Min change.

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `preferences` table is gone. The
     entire preferences object now lives at profiles.data.preferences
     (JSONB, single object — 1-to-1 section). Save/load go through
     MC.saveSection / MC.loadSection.
   - Generic per-error validation popup replaced with a consolidated
     bullet-list popup (matches the pattern from skills,
     profile_category, professional_introduction, certifications,
     references). Format checks (CTC range, Max Other-currency text)
     stay as separate popups since they need specific messages.
   - Bug: Max currency was not validated. A user could pick Min=USD,
     then click the Max currency to "" (placeholder) and save — Max
     currency stored as null. Now caught in validation.
   - Bug: Max "Other" currency text was not validated when Max
     currency = Other. Now caught in validation.
   - Bug: roles field accepted "," (or punctuation only) and saved
     as an empty array. Now validated after csv-split for at least
     one non-empty entry.
   - Expected Compensation made OPTIONAL. Users can now leave the
     CTC section blank entirely. If they fill ANY of the four CTC
     fields (Min number, Min currency, Max number, Max currency,
     or Other-currency text), the section becomes "opted in" and
     all four are required so the saved range is meaningful.
     Asterisks removed from labels; required attributes removed
     from inputs.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.PREFERENCES_VERSION === "phase1-step3" */
window.PREFERENCES_VERSION = "phase1-step3";

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $           = MC.$;
const trim        = MC.trim;
const showPopup   = MC.showPopup;
const showToast   = MC.showToast;
const setLoading  = MC.setLoading;
const showConfirm = MC.showConfirm;

/* ============================================================
   CURRENCY DEPENDENCY LOGIC
   Mirrors experience.js ctcFixedCurrency pattern.
   - Changing Min currency auto-selects same currency for Max
     (because ranges are nearly always in one currency).
   - Each dropdown manages its own "Other" input visibility
     independently — fixed from previous version where Min's handler
     was incorrectly hiding Max's Other input.
   ============================================================ */

/* ============================================================
   CTC LABEL & PLACEHOLDER UPDATER
   ============================================================
   "Lacs" is meaningful for INR (where ₹12 = ₹12 lakh = 1,200,000)
   but wrong for every other currency. A user picking USD would
   see "Expected CTC (Min – in Lacs)" and reasonably wonder if
   they should type "1.5" or "150000". Same problem for EUR/GBP/etc.

   This function adapts the visible label and placeholder based
   on the chosen currency. INR keeps Lacs; everything else shows
   "Annual" with the currency code; "Other" shows just "Annual".
   No currency selected yet → generic label, no unit hint.

   Called on:
     - every change to ctcMinCurrency / ctcMaxCurrency
     - once on page load
     - after data is loaded from Supabase
*/

function updateCtcLabels() {
  const minCur = $("ctcMinCurrency") ? $("ctcMinCurrency").value : "";
  const maxCur = $("ctcMaxCurrency") ? $("ctcMaxCurrency").value : "";

  function labelFor(side, currency) {
    /* side = "Min" or "Max"; currency is whatever was picked.
       Returns text like "Expected CTC (Min – in Lacs)". */
    let unit;
    if (!currency) {
      unit = "";                        /* no currency yet — keep label simple */
    } else if (currency === "INR") {
      unit = " \u2013 in Lacs";         /* en-dash + Lacs */
    } else if (currency.includes("Other")) {
      unit = " \u2013 Annual";          /* user-typed currency, generic unit */
    } else {
      unit = " \u2013 Annual, in " + currency;
    }
    return "Expected CTC (" + side + unit + ")";
  }

  function placeholderFor(currency) {
    if (currency === "INR")           return "e.g. 12.00";
    if (!currency)                    return "e.g. 12.00";
    if (currency.includes("Other"))   return "e.g. 150000";
    if (currency === "JPY")           return "e.g. 8000000";   /* yen has no decimal subunit in salary terms */
    return "e.g. 150000";
  }

  function hintFor(side, currency) {
    if (!currency) return "Pick a currency to see the expected unit.";
    if (currency === "INR") {
      return side === "Min"
        ? "Enter the figure in Lacs (e.g. 12.50 means \u20B912,50,000)."
        : "Max must be greater than or equal to Min, in Lacs.";
    }
    if (currency.includes("Other")) {
      return side === "Min"
        ? "Enter the annual figure in your specified currency."
        : "Max must be greater than or equal to Min.";
    }
    return side === "Min"
      ? "Enter the annual figure in " + currency + " (e.g. 150000 means " + currency + " 150,000/year)."
      : "Max must be greater than or equal to Min.";
  }

  /* Apply Min */
  const minLabelEl = $("ctcMinLabel");
  if (minLabelEl) {
    /* CTC is now optional — no required asterisk. textContent is
       safe (and avoids the innerHTML markup we previously needed
       to preserve the * span). */
    minLabelEl.textContent = labelFor("Min", minCur);
  }
  const minInput = $("ctcMin");
  if (minInput) minInput.placeholder = placeholderFor(minCur);
  const minHintEl = $("ctcMinHint");
  if (minHintEl) minHintEl.textContent = hintFor("Min", minCur);

  /* Apply Max */
  const maxLabelEl = $("ctcMaxLabel");
  if (maxLabelEl) {
    maxLabelEl.textContent = labelFor("Max", maxCur);
  }
  const maxInput = $("ctcMax");
  if (maxInput) maxInput.placeholder = placeholderFor(maxCur);
  const maxHintEl = $("ctcMaxHint");
  if (maxHintEl) maxHintEl.textContent = hintFor("Max", maxCur);
}

function setupCurrencySync() {
  const minSel  = $("ctcMinCurrency");
  const maxSel  = $("ctcMaxCurrency");
  const minOth  = $("ctcMinCurrencyOther");
  const maxOth  = $("ctcMaxCurrencyOther");
  const minVal  = $("ctcMin");
  const maxVal  = $("ctcMax");

  /* Track the previous currency values so we can revert on cancel
     when the user backs out of a confirm prompt. */
  let prevMinCurrency = minSel.value;
  let prevMaxCurrency = maxSel.value;

  /* Helper: does the user have CTC numbers already entered? Determines
     whether changing currency is significant enough to warn about
     (e.g. "12" means very different things in INR vs USD vs JPY). */
  function ctcAlreadyEntered() {
    return !!(trim(minVal.value) || trim(maxVal.value));
  }

  /* Apply Min change: show/hide its Other input + sync Max VALUE +
     refresh Max's Other-input visibility based on its NEW value. */
  function applyMinChange() {
    const val = minSel.value;
    minOth.classList.toggle("hidden", !val.includes("Other"));

    /* Auto-select same currency on Max */
    [...maxSel.options].forEach((opt, i) => {
      if (opt.value === val) maxSel.selectedIndex = i;
    });
    maxOth.classList.toggle("hidden", !maxSel.value.includes("Other"));

    /* Update tracking */
    prevMinCurrency = minSel.value;
    prevMaxCurrency = maxSel.value;

    /* Update labels + placeholders + hints to reflect new currency. */
    updateCtcLabels();
  }

  /* Min currency: if user has CTC values entered and is switching FROM
     a non-empty currency to a different non-empty currency, warn first.
     Picking a currency for the first time (from blank) is fine. */
  minSel.addEventListener("change", () => {
    const newVal = minSel.value;
    const isSwitch = prevMinCurrency && newVal && prevMinCurrency !== newVal;

    if (isSwitch && ctcAlreadyEntered()) {
      const previousValue = prevMinCurrency;
      showConfirm(
        "Changing currency will not convert your CTC numbers \u2014 the same " +
        "values will now be interpreted in " + newVal + ". Continue?",
        () => { applyMinChange(); },
        {
          confirmLabel : "Yes, change currency",
          cancelLabel  : "Keep " + previousValue
        }
      );
      /* If user cancels, revert select to prev value (showConfirm itself
         doesn't run any "on cancel" action — overlay just closes). */
      const cancelBtn = $("errorPopupCancel");
      if (cancelBtn) {
        const orig = cancelBtn.onclick;
        cancelBtn.onclick = function () {
          minSel.value = previousValue;
          if (typeof orig === "function") orig();
        };
      }
      return;
    }

    applyMinChange();
  });

  /* Max currency: same warning pattern when switching after CTC entered. */
  maxSel.addEventListener("change", () => {
    const newVal = maxSel.value;
    const isSwitch = prevMaxCurrency && newVal && prevMaxCurrency !== newVal;

    if (isSwitch && ctcAlreadyEntered()) {
      const previousValue = prevMaxCurrency;
      showConfirm(
        "Changing currency will not convert your CTC numbers \u2014 the same " +
        "values will now be interpreted in " + newVal + ". Continue?",
        () => {
          maxOth.classList.toggle("hidden", !maxSel.value.includes("Other"));
          prevMaxCurrency = maxSel.value;
          updateCtcLabels();
        },
        {
          confirmLabel : "Yes, change currency",
          cancelLabel  : "Keep " + previousValue
        }
      );
      const cancelBtn = $("errorPopupCancel");
      if (cancelBtn) {
        const orig = cancelBtn.onclick;
        cancelBtn.onclick = function () {
          maxSel.value = previousValue;
          if (typeof orig === "function") orig();
        };
      }
      return;
    }

    /* No warning needed — apply directly. */
    maxOth.classList.toggle("hidden", !maxSel.value.includes("Other"));
    prevMaxCurrency = maxSel.value;
    updateCtcLabels();
  });
}

/* ============================================================
   VALIDATE
   ============================================================ */

function validate() {
  /* (1) Always-required fields: availability, work mode, relocation, roles.
     CTC section is OPTIONAL — handled separately below. */
  const missing = [];
  if (!$("availability").value) missing.push("Employment Availability");
  if (!$("workMode").value)     missing.push("Preferred Work Mode");
  if (!$("relocation").value)   missing.push("Open to Relocation");
  if (!trim($("roles").value))  missing.push("Preferred Roles");

  /* (2) CTC section — all-or-nothing. Either the user fills BOTH
     Min and Max with currencies, or they leave the whole section
     empty. A partial entry (e.g. only Min, or Min number without
     currency) is not actionable, so we ask the user to either
     complete it or clear it. */
  const ctcMinRaw  = $("ctcMin").value;
  const ctcMaxRaw  = $("ctcMax").value;
  const minCurrency = $("ctcMinCurrency").value;
  const maxCurrency = $("ctcMaxCurrency").value;

  /* "Has any CTC input" — including the Other-text fields, in case the
     user only typed an Other currency name. */
  const ctcMinOther = trim($("ctcMinCurrencyOther").value);
  const ctcMaxOther = trim($("ctcMaxCurrencyOther").value);
  const ctcAny = !!(ctcMinRaw || ctcMaxRaw || minCurrency || maxCurrency ||
                    ctcMinOther || ctcMaxOther);

  /* CTC values parsed once for use across checks. parseFloat returns
     NaN on empty string, which trips the !ctcMinRaw guard cleanly. */
  const ctcMin = parseFloat(ctcMinRaw);
  const ctcMax = parseFloat(ctcMaxRaw);

  if (ctcAny) {
    /* User opted into the CTC section — require all 4 fields. */
    if (!ctcMinRaw || isNaN(ctcMin) || ctcMin < 0) missing.push("Expected CTC (Min)");
    if (!minCurrency)                              missing.push("Expected CTC (Min) Currency");
    if (!ctcMaxRaw || isNaN(ctcMax) || ctcMax < 0) missing.push("Expected CTC (Max)");
    if (!maxCurrency)                              missing.push("Expected CTC (Max) Currency");
  }

  if (missing.length > 0) {
    /* If CTC fields are in the missing list, prepend a clarifying
       line so the user knows the section itself is optional but
       once started must be completed. */
    const ctcInMissing = missing.some(m => m.startsWith("Expected CTC"));
    let prefix = "Please fill the following before continuing:";
    if (ctcInMissing) {
      prefix = "Please fill the following before continuing:\n\n" +
               "(Compensation is optional, but if you start filling it, " +
               "please complete both Min and Max with currencies — or " +
               "clear those fields to skip this section.)";
    }
    showPopup(prefix + "\n\n\u2022 " + missing.join("\n\u2022 "));
    const focusMap = {
      "Employment Availability"        : "availability",
      "Preferred Work Mode"            : "workMode",
      "Open to Relocation"             : "relocation",
      "Expected CTC (Min)"             : "ctcMin",
      "Expected CTC (Min) Currency"    : "ctcMinCurrency",
      "Expected CTC (Max)"             : "ctcMax",
      "Expected CTC (Max) Currency"    : "ctcMaxCurrency",
      "Preferred Roles"                : "roles"
    };
    const firstId = focusMap[missing[0]];
    if (firstId && $(firstId)) $(firstId).focus();
    return false;
  }

  /* (3) CTC format checks — only run if the user opted into CTC.
     If ctcAny is false, all four CTC fields are empty and there's
     nothing to check. */
  if (ctcAny) {
    /* Other-currency text checks for Min and Max */
    if (minCurrency.includes("Other") && !ctcMinOther) {
      showPopup("Please specify the currency for your expected minimum CTC.");
      $("ctcMinCurrencyOther").focus();
      return false;
    }
    if (maxCurrency.includes("Other") && !ctcMaxOther) {
      showPopup("Please specify the currency for your expected maximum CTC.");
      $("ctcMaxCurrencyOther").focus();
      return false;
    }
    /* Range: Max must be >= Min */
    if (ctcMax < ctcMin) {
      showPopup("Expected maximum CTC cannot be less than the minimum CTC.");
      $("ctcMax").focus();
      return false;
    }
  }

  /* (4) Roles must contain at least one non-empty entry after
     csv-split + trim. Catches edge cases like "," or " , , ". */
  const rolesList = trim($("roles").value)
    .split(",").map(s => trim(s)).filter(Boolean);
  if (rolesList.length === 0) {
    showPopup("Please enter at least one preferred role (separate multiple roles with commas).");
    $("roles").focus();
    return false;
  }

  return true;
}

/* ============================================================
   BUILD PAYLOAD
   ============================================================ */

function buildPayload() {
  const minCurrency = $("ctcMinCurrency").value;
  const maxCurrency = $("ctcMaxCurrency").value;

  /* Helper: parse a number field, allowing 0 as a valid value
     (don't fall through to null on legitimate zero). */
  const parseNum = (v) => {
    if (v === "" || v == null) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  /* Helper: comma-split, trim each, drop empties. */
  const csv = (v) => {
    const t = trim(v);
    return t ? t.split(",").map(s => trim(s)).filter(Boolean) : [];
  };

  return {
    employment_availability : $("availability").value,
    preferred_work_mode     : $("workMode").value,
    open_to_relocation      : $("relocation").value,
    preferred_locations     : csv($("preferredLocations").value),
    expected_ctc_min        : parseNum($("ctcMin").value),
    expected_ctc_max        : parseNum($("ctcMax").value),
    expected_ctc_currency   : minCurrency.includes("Other")
                              ? trim($("ctcMinCurrencyOther").value)
                              : minCurrency,
    expected_ctc_max_currency: maxCurrency.includes("Other")
                               ? trim($("ctcMaxCurrencyOther").value)
                               : maxCurrency,
    preferred_roles         : csv($("roles").value),
    preferred_industries    : csv($("industries").value),
    preferred_employment_type: $("employmentType").value || null
  };
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `preferences` table is gone. Preferences now live as
   a single JSONB object at profiles.data.preferences. Save/load go
   through MC.saveSection / MC.loadSection which handle auth and
   RLS server-side via the save_profile_section RPC.

   Preferences is 1-to-1: one object per candidate. We pass the
   entire payload object to saveSection (no array wrapping). Same
   shape as profile_category and introduction.

   The shape we save matches the legacy column names so the
   loadPreferences() consumer code below doesn't need to change.
   ============================================================ */

async function apiSavePreferences(payload) {
  /* Sanitise / canonicalise the payload one more time before save
     — defensive in case caller passed mixed types. */
  const obj = {
    employment_availability   : payload.employment_availability   || null,
    preferred_work_mode       : payload.preferred_work_mode       || null,
    open_to_relocation        : payload.open_to_relocation        || null,
    preferred_locations       : Array.isArray(payload.preferred_locations)
                                ? payload.preferred_locations : [],
    expected_ctc_min          : (payload.expected_ctc_min === null || payload.expected_ctc_min === undefined)
                                ? null : Number(payload.expected_ctc_min),
    expected_ctc_max          : (payload.expected_ctc_max === null || payload.expected_ctc_max === undefined)
                                ? null : Number(payload.expected_ctc_max),
    expected_ctc_currency     : payload.expected_ctc_currency     || null,
    expected_ctc_max_currency : payload.expected_ctc_max_currency || null,
    preferred_roles           : Array.isArray(payload.preferred_roles)
                                ? payload.preferred_roles : [],
    preferred_industries      : Array.isArray(payload.preferred_industries)
                                ? payload.preferred_industries : [],
    preferred_employment_type : payload.preferred_employment_type || null
  };

  await MC.saveSection("preferences", obj);
  return obj;
}

async function apiLoadPreferences() {
  const obj = await MC.loadSection("preferences");
  /* loadSection returns null if no section exists yet. Otherwise it
     returns the stored object directly. */
  return obj && typeof obj === "object" ? obj : null;
}

/* ============================================================
   SAVE & CONTINUE
   ============================================================ */

async function saveContinue() {
  if (!validate()) return;

  const btn = $("saveContinueBtn");
  setLoading(btn, true);

  const payload = buildPayload();

  try {
    await apiSavePreferences(payload);
  } catch (err) {
    console.error("Preferences save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(btn, false);
    return;
  }

  localStorage.setItem("preferences_completed", "yes");
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* Save succeeded — drop any in-progress draft. */
  if (window.SaveNow) SaveNow.clearDraft();

  /* Navigate parent dashboard to Your Languages */
  window.parent.postMessage(
    {
      type      : "navigate",
      page      : "languages.html",
      sidebarKey: "Your Languages"
    },
    "*"
  );

  setTimeout(() => setLoading(btn, false), 800);
}

/* ============================================================
   DRAFT CAPTURE / RESTORE — captures every preference field so a
   half-filled form survives a tab close or browser crash.
   ============================================================ */

function captureFormDraft() {
  return {
    availability             : $("availability").value,
    work_mode                : $("workMode").value,
    relocation               : $("relocation").value,
    preferred_locations      : trim($("preferredLocations").value),
    ctc_min                  : $("ctcMin").value,
    ctc_min_currency         : $("ctcMinCurrency").value,
    ctc_min_currency_other   : trim($("ctcMinCurrencyOther").value),
    ctc_max                  : $("ctcMax").value,
    ctc_max_currency         : $("ctcMaxCurrency").value,
    ctc_max_currency_other   : trim($("ctcMaxCurrencyOther").value),
    roles                    : trim($("roles").value),
    industries               : trim($("industries").value),
    employment_type          : $("employmentType").value
  };
}

function restoreFormDraft(draft) {
  if (!draft) return false;
  const setVal = (id, v) => {
    const el = $(id);
    if (el && v != null) el.value = v;
  };
  setVal("availability",            draft.availability);
  setVal("workMode",                draft.work_mode);
  setVal("relocation",              draft.relocation);
  setVal("preferredLocations",      draft.preferred_locations);
  setVal("ctcMin",                  draft.ctc_min);
  setVal("ctcMinCurrency",          draft.ctc_min_currency);
  setVal("ctcMinCurrencyOther",     draft.ctc_min_currency_other);
  setVal("ctcMax",                  draft.ctc_max);
  setVal("ctcMaxCurrency",          draft.ctc_max_currency);
  setVal("ctcMaxCurrencyOther",     draft.ctc_max_currency_other);
  setVal("roles",                   draft.roles);
  setVal("industries",              draft.industries);
  setVal("employmentType",          draft.employment_type);

  /* Reflect Other-input visibility for both currency dropdowns
     based on the restored values. */
  const minCur = $("ctcMinCurrency").value;
  const maxCur = $("ctcMaxCurrency").value;
  $("ctcMinCurrencyOther").classList.toggle("hidden", !minCur.includes("Other"));
  $("ctcMaxCurrencyOther").classList.toggle("hidden", !maxCur.includes("Other"));

  /* Update labels + placeholders + hints to match restored currencies. */
  updateCtcLabels();
  return true;
}

/* ============================================================
   LOAD EXISTING PREFERENCES ON PAGE OPEN
   Silently ignores errors — user can still fill fresh.
   ============================================================ */

async function loadPreferences() {
  if (!MC.candidateId) return;

  let data;
  try {
    data = await apiLoadPreferences();
  } catch (err) {
    /* Silently ignore — fresh form is fine */
    console.error("Could not load existing preferences:", err);
    return;
  }
  if (!data) return;

  if (data.employment_availability)
    $("availability").value = data.employment_availability;

  if (data.preferred_work_mode)
    $("workMode").value = data.preferred_work_mode;

  if (data.open_to_relocation)
    $("relocation").value = data.open_to_relocation;

  if (Array.isArray(data.preferred_locations) && data.preferred_locations.length)
    $("preferredLocations").value = data.preferred_locations.join(", ");

  /* CTC values — preserve 0 vs null distinction. */
  if (data.expected_ctc_min !== null && data.expected_ctc_min !== undefined)
    $("ctcMin").value = data.expected_ctc_min;

  if (data.expected_ctc_max !== null && data.expected_ctc_max !== undefined)
    $("ctcMax").value = data.expected_ctc_max;

  /* Restore Min and Max currencies INDEPENDENTLY.
     Old code used the Min currency for both fields — bug fix here. */
  const knownCurrencies = ["INR","USD","EUR","GBP","AED","SGD","AUD","CAD","JPY"];

  if (data.expected_ctc_currency) {
    if (knownCurrencies.includes(data.expected_ctc_currency)) {
      $("ctcMinCurrency").value = data.expected_ctc_currency;
    } else {
      $("ctcMinCurrency").value = "Other (please specify)";
      $("ctcMinCurrencyOther").value = data.expected_ctc_currency;
      $("ctcMinCurrencyOther").classList.remove("hidden");
    }
  }

  if (data.expected_ctc_max_currency) {
    if (knownCurrencies.includes(data.expected_ctc_max_currency)) {
      $("ctcMaxCurrency").value = data.expected_ctc_max_currency;
    } else {
      $("ctcMaxCurrency").value = "Other (please specify)";
      $("ctcMaxCurrencyOther").value = data.expected_ctc_max_currency;
      $("ctcMaxCurrencyOther").classList.remove("hidden");
    }
  }

  if (Array.isArray(data.preferred_roles) && data.preferred_roles.length)
    $("roles").value = data.preferred_roles.join(", ");

  if (Array.isArray(data.preferred_industries) && data.preferred_industries.length)
    $("industries").value = data.preferred_industries.join(", ");

  if (data.preferred_employment_type)
    $("employmentType").value = data.preferred_employment_type;
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  setupCurrencySync();
  $("saveContinueBtn").addEventListener("click", saveContinue);

  /* Initial label state — no currency picked yet, so generic label. */
  updateCtcLabels();

  /* Load any existing preferences first, then init SaveNow.
     SaveNow's restore prompt only fires when a draft exists; loading
     existing data is independent of draft restoration. */
  await loadPreferences();

  /* After load, update labels to match the loaded currencies. */
  updateCtcLabels();

  /* SaveNow integration — single-form scope. No per-entry, no
     entryNumber. The "form" is the whole preferences sheet; one
     final save happens at "Save & Continue" time. */
  SaveNow.init({
    pageName          : "preferences",
    containerSelector : ".form-container",
    capturePayload    : captureFormDraft,
    restorePayload    : restoreFormDraft,
    apiSave           : null,   /* No batch endpoint mid-form — Save Now persists locally */
    isEmpty: () => !$("availability").value &&
                   !$("workMode").value &&
                   !$("relocation").value &&
                   !trim($("ctcMin")?.value || "") &&
                   !trim($("roles")?.value || "")
  });
});
