/* ============================================================
   MECULS — profile_category.js
   Handles profile category selection, helper messages,
   dynamic button labels, and navigation routing via
   postMessage to the parent dashboard.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.PROFILE_CATEGORY_VERSION
   "phase1-step3" means this file (with JSONB save) is loaded. */
window.PROFILE_CATEGORY_VERSION = "phase1-step3";

/* ── Routing map ──
   Defines for each profile value:
   - nextPage   : the HTML file to load in the dashboard iframe
   - nextLabel  : human-readable section name for button + message
   - skipLabel  : sections being skipped (null if none)
   - sidebarKey : matches the sidebar button text in dashboard.html
                  so dashboard.js can highlight the correct button
─────────────────────────────────────────────────────────────── */
const ROUTING = {
  student_0xp: {
    nextPage  : "education.html",
    nextLabel : "Your Education",
    skipLabel : '"About You" and "Add Your Experience"',
    sidebarKey: "Your Education"
  },
  fresher: {
    nextPage  : "education.html",
    nextLabel : "Your Education",
    skipLabel : '"About You" and "Add Your Experience"',
    sidebarKey: "Your Education"
  },
  student_intern: {
    nextPage  : "experience.html",
    nextLabel : "Your Experience",
    skipLabel : '"About You"',
    sidebarKey: "Your Experience"
  },
  student_xp: {
    nextPage  : "professional_introduction.html",
    nextLabel : "About You",
    skipLabel : null,
    sidebarKey: "About You"
  },
  working_professional: {
    nextPage  : "professional_introduction.html",
    nextLabel : "About You",
    skipLabel : null,
    sidebarKey: "About You"
  },
  researcher: {
    nextPage  : "professional_introduction.html",
    nextLabel : "About You",
    skipLabel : null,
    sidebarKey: "About You"
  },
  defense: {
    nextPage  : "professional_introduction.html",
    nextLabel : "About You",
    skipLabel : null,
    sidebarKey: "About You"
  },
  defense_family: {
    nextPage  : "professional_introduction.html",
    nextLabel : "About You",
    skipLabel : null,
    sidebarKey: "About You"
  }
};

/* ── DOM refs ── */
const profileSelect  = document.getElementById("profileCategory");
const defenseFamilyBlock  = document.getElementById("defenseFamilyBlock");
const defenseFamilyRole   = document.getElementById("defenseFamilyRole");
const autoMessage    = document.getElementById("autoMessage");
const msgNext        = document.getElementById("msgNext");
const msgSkip        = document.getElementById("msgSkip");
const saveBtn        = document.getElementById("saveContinueBtn");
const abledSelect    = document.getElementById("abledStatus");
const abledBlock     = document.getElementById("especiallyAbledBlock");
const abledDetails   = document.getElementById("especiallyAbledDetails");
const abledCounter   = document.getElementById("abledCounter");
const accommodationSelect = document.getElementById("needsAccommodation");
const supportDescBlock    = document.getElementById("supportDescriptionBlock");
const supportDesc         = document.getElementById("supportDescription");
const supportDescCounter  = document.getElementById("supportDescriptionCounter");

/* ── Especially-abled toggle ── */
if (abledSelect) {
  abledSelect.addEventListener("change", () => {
    const isEspeciallyAbled = abledSelect.value === "especially_abled";
    abledBlock.classList.toggle("hidden", !isEspeciallyAbled);
    if (!isEspeciallyAbled) {
      /* Clear ALL state inside the abled block — condition description,
         accommodation dropdown, disclaimer visibility, and support description.
         Without this, stale values would survive a switch to fully_abled. */
      if (abledDetails)        abledDetails.value = "";
      if (abledCounter)        abledCounter.textContent = "0 / 500";
      if (accommodationSelect) accommodationSelect.value = "";
      if (supportDesc)         supportDesc.value = "";
      if (supportDescCounter)  supportDescCounter.textContent = "0 / 300";
      const discBlock = document.getElementById("supportDisclaimerBlock");
      if (discBlock)        discBlock.classList.add("hidden");
      if (supportDescBlock) supportDescBlock.classList.add("hidden");
    }
  });
}

if (abledDetails && abledCounter) {
  abledDetails.addEventListener("input", () => {
    abledCounter.textContent = abledDetails.value.length + " / 500";
  });
}

/* ── Helper to check if abled section is fully filled ── */
function abledSectionValid() {
  if (!abledSelect || !abledSelect.value) return false;
  if (abledSelect.value === "especially_abled") {
    if (!abledDetails || !abledDetails.value.trim()) return false;
    if (!accommodationSelect || !accommodationSelect.value) return false;
  }
  return true;
}

/* ── Effective category for routing.
   For "Family Member of Defense Personnel" we use the secondary
   "Are You?" dropdown value; for every other selection the primary
   value IS the effective category. Returns "" when the user hasn't
   yet supplied the required follow-up. ── */
function getEffectiveCategory() {
  const primary = profileSelect ? profileSelect.value : "";
  if (primary === "defense_family") {
    return defenseFamilyRole ? defenseFamilyRole.value : "";
  }
  return primary;
}

/* ── Show / hide the support disclaimer + description textarea based on
   the user's answer to "Do you require any kind of support?". The
   disclaimer sets honest expectations (MECULS connects, doesn't deliver
   services); the textarea collects what kind of support the user needs.
   When the user switches back to No, the textarea is cleared so stale
   text isn't accidentally saved. ── */
function refreshSupportBlocks() {
  const discBlock = document.getElementById("supportDisclaimerBlock");
  if (!accommodationSelect) return;
  const isYes = accommodationSelect.value === "yes";

  if (discBlock)        discBlock.classList.toggle("hidden", !isYes);
  if (supportDescBlock) supportDescBlock.classList.toggle("hidden", !isYes);

  if (!isYes) {
    /* Cleared on switch to No so stale text isn't accidentally persisted */
    if (supportDesc)        supportDesc.value = "";
    if (supportDescCounter) supportDescCounter.textContent = "0 / 300";
  }
}
if (accommodationSelect) {
  accommodationSelect.addEventListener("change", refreshSupportBlocks);
  refreshSupportBlocks();   /* set initial visibility on page load */
}

/* Live char counter for support description */
if (supportDesc && supportDescCounter) {
  supportDesc.addEventListener("input", () => {
    supportDescCounter.textContent = supportDesc.value.length + " / 300";
  });
}

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ──
   showPopup / showToast / setLoading all come from the global
   MC.* helpers loaded via <script src="mc_helpers.js"> in
   profile_category.html. Aliased here so existing code below
   (showPopup(...), setLoading(saveBtn, true), etc.) works unchanged. */
const showToast  = MC.showToast;
const showPopup  = MC.showPopup;
const setLoading = MC.setLoading;

/* ── Rebuild helper message + button label from current selection ── */
function refreshMessageAndLabel() {
  const eff   = getEffectiveCategory();
  const route = ROUTING[eff];

  if (!eff || !route) {
    autoMessage.classList.add("hidden");
    saveBtn.textContent = "Save & Continue";
    return;
  }

  /* Update helper message */
  msgNext.innerHTML = `Your next section will be <strong>"${route.nextLabel}"</strong>.`;

  if (route.skipLabel) {
    msgSkip.innerHTML = `Sections skipped for your profile: ${route.skipLabel}.`;
    msgSkip.classList.remove("hidden");
  } else {
    msgSkip.classList.add("hidden");
    msgSkip.innerHTML = "";
  }

  autoMessage.classList.remove("hidden");

  /* Update button label */
  saveBtn.textContent = `Save & Continue to "${route.nextLabel}"`;
}

/* ── On primary selection change: reveal/hide defense-family block,
   clear the secondary dropdown when hiding, then refresh message ── */
profileSelect.addEventListener("change", () => {
  const val = profileSelect.value;

  if (val === "defense_family") {
    if (defenseFamilyBlock) defenseFamilyBlock.classList.remove("hidden");
  } else {
    if (defenseFamilyBlock) defenseFamilyBlock.classList.add("hidden");
    if (defenseFamilyRole)  defenseFamilyRole.value = "";
  }

  refreshMessageAndLabel();
});

/* ── On secondary "Are You?" selection change: refresh message ── */
if (defenseFamilyRole) {
  defenseFamilyRole.addEventListener("change", refreshMessageAndLabel);
}

/* ── Save & Continue ── */
saveBtn.addEventListener("click", async () => {
  const primary = profileSelect.value;

  /* Collect every missing required field so the user gets ONE popup
     listing them all instead of being walked through them one click
     at a time. With 5 possible required fields the old "stop at first"
     UX wasted up to 5 clicks. */
  const missing = [];

  if (!primary) {
    missing.push("Your Profile Category");
  } else if (primary === "defense_family" && (!defenseFamilyRole || !defenseFamilyRole.value)) {
    missing.push("Are You? (Family member's own status)");
  }

  if (!abledSelect || !abledSelect.value) {
    missing.push("Are you fully abled or especially-abled?");
  } else if (abledSelect.value === "especially_abled") {
    if (!abledDetails || !abledDetails.value.trim()) {
      missing.push("Please describe your condition or disability");
    }
    if (!accommodationSelect || !accommodationSelect.value) {
      missing.push("Do you require any kind of support?");
    } else if (accommodationSelect.value === "yes") {
      if (!supportDesc || !supportDesc.value.trim()) {
        missing.push("Briefly describe the support you need");
      }
    }
  }

  if (missing.length === 1) {
    showPopup("Please fill in: " + missing[0] + ".");
    /* Best-effort focus on the field that's missing — only useful when
       there's just one. */
    if (!primary) profileSelect.focus();
    else if (primary === "defense_family" && defenseFamilyRole && !defenseFamilyRole.value) defenseFamilyRole.focus();
    else if (!abledSelect.value) abledSelect.focus();
    else if (!abledDetails.value.trim()) abledDetails.focus();
    else if (!accommodationSelect.value) accommodationSelect.focus();
    else if (supportDesc && !supportDesc.value.trim()) supportDesc.focus();
    return;
  }
  if (missing.length > 1) {
    showPopup(
      "Please fill in the following required fields before continuing:\n\n\u2022 " +
      missing.join("\n\u2022 ")
    );
    return;
  }

  /* All required fields present — derive routing now. */
  const effective = getEffectiveCategory();
  const route     = ROUTING[effective];
  if (!effective || !route) {
    /* Defensive: should not happen because primary + defense_family role
       were both checked above. */
    showPopup("Please select your profile category before continuing.");
    return;
  }

  setLoading(saveBtn, true);

  /* Persist to localStorage. user_type records the PRIMARY selection so
     "Family Member of Defense Personnel" status is not lost when they
     also answer "Are You?". The effective category is used only for
     routing and recorded separately. */
  localStorage.setItem("user_type", primary);
  if (primary === "defense_family") {
    localStorage.setItem("defense_family_role", defenseFamilyRole.value);
  } else {
    localStorage.removeItem("defense_family_role");
  }
  localStorage.setItem("profile_category_completed", "yes");  /* matches dashboard completion key */
  localStorage.setItem("abled_status", abledSelect.value);
  if (abledSelect.value === "especially_abled") {
    localStorage.setItem("especially_abled_details", abledDetails ? abledDetails.value.trim() : "");
    localStorage.setItem("needs_accommodation", accommodationSelect ? accommodationSelect.value : "");
    /* Only persist support_description when user said Yes; otherwise clear any prior value */
    if (accommodationSelect && accommodationSelect.value === "yes") {
      localStorage.setItem("support_description", supportDesc ? supportDesc.value.trim() : "");
    } else {
      localStorage.removeItem("support_description");
    }
  } else {
    /* User changed away from especially-abled — clear any prior support data */
    localStorage.removeItem("support_description");
  }
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* ── Persist to Supabase ──
     localStorage above is kept as a fast-read cache (other pages
     read user_type, abled_status etc. for routing). Supabase is
     the source of truth — clearing browser doesn't lose data.

     Phase 1 Step 3: writes to profiles.data.profile_category JSONB
     section via MC.saveSection (the dropped profile_category table
     is gone). The candidate_id field is no longer needed because
     MC.saveSection scopes the save by auth.uid() server-side. */
  try {
    const isEsp = abledSelect.value === "especially_abled";
    const payload = {
      user_type                 : primary || null,
      defense_family_role       : (primary === "defense_family" && defenseFamilyRole) ? defenseFamilyRole.value : null,
      abled_status              : abledSelect.value || null,
      especially_abled_details  : isEsp && abledDetails ? abledDetails.value.trim() : null,
      needs_accommodation       : isEsp && accommodationSelect ? accommodationSelect.value : null,
      support_description       : (isEsp && accommodationSelect && accommodationSelect.value === "yes" && supportDesc)
                                  ? supportDesc.value.trim() : null
    };

    await MC.saveSection("profile_category", payload);

    /* ── Public Profile Slug Backfill ──
       This is the FIRST build page after signup, so it's the
       earliest reliable point to ensure every user has a slug.
       MC.ensureSlug is idempotent — if the user already has a
       slug, this is a fast no-op. If not (e.g. legacy users from
       before this feature, or any race condition where signup
       didn't generate one), we generate it now from the user's
       full name in auth metadata.
       Failure here is non-fatal: the user can still proceed with
       their profile build. We just log and continue. */
    try {
      const sb = window.MC_SB && window.MC_SB.getClient && window.MC_SB.getClient();
      if (sb) {
        const { data: u } = await sb.auth.getUser();
        const name = (u && u.user && u.user.user_metadata && u.user.user_metadata.full_name) || "";
        if (name) await MC.ensureSlug(name);
      }
    } catch (slugErr) {
      console.warn("[profile_category] slug backfill skipped:", slugErr);
    }
  } catch (err) {
    console.error("[profile_category] save error:", err);
    showPopup("Could not save to server. Please try again.\n\n" + (err.message || err));
    setLoading(saveBtn, false);
    return;
  }

  window.parent.postMessage(
    {
      type      : "navigate",
      page      : route.nextPage,
      sidebarKey: route.sidebarKey
    },
    "*"
  );

  /* Small delay so user sees the success state before navigation */
  setTimeout(() => {
    setLoading(saveBtn, false);
  }, 800);
});

/* ============================================================
   LOAD EXISTING DATA from Supabase
   ============================================================
   On revisit, populate the form so the user can see and edit
   their previous answers. localStorage is checked first as a
   fast-read; Supabase fills in any gaps and is the source of
   truth for cross-device.

   Phase 1 Step 3: reads from profiles.data.profile_category JSONB
   section via MC.loadSection (the dropped profile_category table
   is gone). The hydration code below is unchanged because the
   payload object shape is identical to the old row shape. */
async function loadProfileCategory() {
  let row = null;

  /* Try Supabase first. If session is missing or section empty, just
     skip — localStorage may still hydrate the form via existing logic. */
  try {
    row = await MC.loadSection("profile_category");
  } catch (err) {
    console.error("[profile_category] load error:", err);
    return;
  }

  if (!row || typeof row !== "object" || Object.keys(row).length === 0) return;
  /* From here on, row.user_type, row.abled_status, etc. — same shape
     as before, just sourced from JSONB. The hydration code below is
     unchanged. */

  /* Hydrate form fields. Use localStorage as a side-effect cache
     so other pages (like professional_introduction) can read user_type
     synchronously without an async Supabase call. */
  if (row.user_type) {
    if (profileSelect) {
      profileSelect.value = row.user_type;
      profileSelect.dispatchEvent(new Event("change"));
    }
    localStorage.setItem("user_type", row.user_type);
  }
  if (row.defense_family_role && defenseFamilyRole) {
    defenseFamilyRole.value = row.defense_family_role;
    localStorage.setItem("defense_family_role", row.defense_family_role);
  }
  if (row.abled_status && abledSelect) {
    abledSelect.value = row.abled_status;
    abledSelect.dispatchEvent(new Event("change"));
    localStorage.setItem("abled_status", row.abled_status);
  }
  if (row.especially_abled_details && abledDetails) {
    abledDetails.value = row.especially_abled_details;
    /* Trigger 'input' so the char counter updates from "0 / 500" to the
       actual length. Without this, the user sees a stale 0 even though
       the field has text. */
    abledDetails.dispatchEvent(new Event("input"));
    localStorage.setItem("especially_abled_details", row.especially_abled_details);
  }
  if (row.needs_accommodation && accommodationSelect) {
    accommodationSelect.value = row.needs_accommodation;
    accommodationSelect.dispatchEvent(new Event("change"));
    localStorage.setItem("needs_accommodation", row.needs_accommodation);
  }
  if (row.support_description && supportDesc) {
    supportDesc.value = row.support_description;
    /* Same reason as above — sync the "0 / 300" char counter. */
    supportDesc.dispatchEvent(new Event("input"));
    localStorage.setItem("support_description", row.support_description);
  }
}

/* Run load on page ready. */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadProfileCategory);
} else {
  loadProfileCategory();
}
