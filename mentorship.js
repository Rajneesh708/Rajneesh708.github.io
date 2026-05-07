/* ============================================================
   MECULS — mentorship.js
   Mentorship & Coaching section logic.

   Architecture (post-polish 2026-04-30):
     - MC.* shared helpers (no local copies)
     - SaveNow draft-restore engine (single-form scope)
     - candidateId read fresh from MC.candidateId at save time
     - apiLoad guarded on MC.candidateId
     - parseInt with explicit radix everywhere
     - postMessage navigation to parent dashboard

   Page structure (post-streamline):
     - Role selection (4 checkboxes: Mentor / Mentee / Coach / Coachee)
     - Mentor/Coach profile section (shown when Mentor or Coach checked)
       Fields: Speciality, Years Exp, Target Audience, Bio,
       Fee, Certification, Contact URL, Show-on-profile
     - Mentee/Coachee section (shown when Mentee or Coachee checked)
       Fields: Goal, Ideal Mentor description
     - One mentor/coach profile per candidate (not multi-entry)
     - Skip button preserved per product spec
     - Save & Continue navigates to portfolio.html

   Removed from old version:
     - Multi-entry list pattern (one profile per candidate now)
     - Hours per Month dropdown (creates fake data)
     - Format dropdown (duplicates Preferences page)
     - Past Highlight field (duplicates Key Achievements page)
     - Custom .ment-card class (uses shared .item-card--accent-blue)
     - Custom .ment-list-heading class (uses shared .list-heading)
     - Local helpers (replaced with MC.*)

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `mentorship` table is gone. The
     entire payload now lives at profiles.data.mentorship as a
     single JSONB object (1-to-1 section). Save/load go through
     MC.saveSection / MC.loadSection.
   - Validation popups consolidated into one bullet popup (the
     role-gate stays a separate popup since it's the precondition
     for the rest of the form).
   - URL auto-fix on the contact URL field. Mirrors the credential
     URL normaliser in certifications.js: trims, strips quotes,
     fixes protocol typos, prepends https:// when missing, rejects
     javascript:/data:. Helper text updated accordingly.
   - Skip button now warns via MC.showConfirm if the user has typed
     anything (was silent discard before — easy data-loss vector).
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.MENTORSHIP_VERSION === "phase1-step3" */
window.MENTORSHIP_VERSION = "phase1-step3";

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $           = MC.$;
const trim        = MC.trim;
const showPopup   = MC.showPopup;
const showToast   = MC.showToast;
const setLoading  = MC.setLoading;
const showConfirm = MC.showConfirm;

/* ============================================================
   ROLE SELECTION — checkbox grid with conditional sections
   ============================================================ */

function getSelectedRoles() {
  return [...document.querySelectorAll('input[name="mentorRole"]:checked')]
    .map(cb => cb.value);
}

function updateConditionalSections() {
  const roles = getSelectedRoles();
  const isMentor   = roles.includes("Mentor");
  const isCoach    = roles.includes("Coach");
  const isMentee   = roles.includes("Mentee");
  const isCoachee  = roles.includes("Coachee");
  const isMentorCoach   = isMentor || isCoach;
  const isMenteeCoachee = isMentee || isCoachee;

  $("mentorCoachSection").classList.toggle("hidden", !isMentorCoach);
  $("menteeSection").classList.toggle("hidden", !isMenteeCoachee);

  /* Update the section headings adaptively so a user who selected
     multiple roles can see clearly which form serves which role.
     If only Mentor → "Your Profile as Mentor".
     If only Coach  → "Your Profile as Coach".
     If both        → "Your Profile as Mentor & Coach".
     Same pattern for the seeker section (Mentee / Coachee).

     The little connector line below uses the role names again so
     people who scroll past the heading still see the link. */

  const mentorCoachHeading = $("mentorCoachHeading");
  const mentorCoachLink    = $("mentorCoachLink");
  if (mentorCoachHeading && isMentorCoach) {
    const labels = [];
    if (isMentor) labels.push("Mentor");
    if (isCoach)  labels.push("Coach");
    const joined = labels.join(" & ");
    mentorCoachHeading.textContent = "Your Profile as " + joined;
    if (mentorCoachLink) {
      mentorCoachLink.textContent =
        "These details apply when you are matched as a " + joined + ".";
    }
  }

  const seekerHeading = $("seekerHeading");
  const seekerLink    = $("seekerLink");
  if (seekerHeading && isMenteeCoachee) {
    const labels = [];
    if (isMentee)  labels.push("Mentee");
    if (isCoachee) labels.push("Seeker of Coaching");
    const joined = labels.join(" & ");
    seekerHeading.textContent = "What You Are Looking For as " + joined;
    if (seekerLink) {
      seekerLink.textContent =
        "These details apply when you are matched as a " + joined + ".";
    }
  }
}

function setupRoleCheckboxes() {
  const opts = document.querySelectorAll("#roleGrid .role-option");
  opts.forEach(opt => {
    const cb = opt.querySelector("input[type='checkbox']");

    /* Why no manual click handler:
       The .role-option element is a <label> that wraps the checkbox,
       so the browser ALREADY toggles the checkbox natively whenever
       the user clicks anywhere on the card (including the icon, title,
       and description). Our previous code added a manual toggle on top
       of that, which cancelled out the native toggle when the user
       clicked anywhere except directly on the checkbox — so clicking
       the card body did nothing. Now we let the browser do the toggling
       and just react to the resulting `change` event. */

    cb.addEventListener("change", () => {
      opt.classList.toggle("selected", cb.checked);
      updateConditionalSections();
      if (window.SaveNow && SaveNow.silentSave) {
        SaveNow.silentSave();
        SaveNow.flashStatus();
      }
    });
  });
}

function setSelectedRoles(rolesArr) {
  const opts = document.querySelectorAll("#roleGrid .role-option");
  opts.forEach(opt => {
    const value = opt.getAttribute("data-value");
    const cb = opt.querySelector("input[type='checkbox']");
    const isSelected = rolesArr.includes(value);
    cb.checked = isSelected;
    opt.classList.toggle("selected", isSelected);
  });
  updateConditionalSections();
}

/* ============================================================
   "SHOW ON PROFILE" toggle handling
   ============================================================ */

function setupShowOnProfileHandler() {
  const cb = $("showOnProfile");
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
   and normalizeAndValidateProfileUrl in languages.js.

   Cleanups:
   - Trim whitespace, strip wrapping straight + smart quotes
   - Strip trailing punctuation users sometimes leave from pasting
   - Fix protocol typos: htps://, htp://, https//, http//, https:/, http:/
   - Prepend https:// if no protocol present
   - Reject other schemes (javascript:, data:, ftp:, etc.)
   - Final URL parse to confirm a non-empty host

   Returns the cleaned URL string or null if unfixable.
   Does NOT auto-upgrade http:// to https:// (some legacy sites are
   http-only; e.g. self-hosted Calendly clones, internal LMS).
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
   VALIDATE
   ============================================================ */

function validate() {
  const roles = getSelectedRoles();

  /* Role-gate stays a separate popup — it's the precondition for
     the rest of the form. Without a role picked, none of the other
     fields are even visible. */
  if (roles.length === 0) {
    showPopup("Please select at least one role (Mentor, Mentee, Coach, or Seeking Coaching) — or use Skip if this section doesn't apply to you.");
    return false;
  }

  const isMentorCoach   = roles.includes("Mentor")  || roles.includes("Coach");
  const isMenteeCoachee = roles.includes("Mentee")  || roles.includes("Coachee");

  /* Consolidated missing-field check across both branches. We collect
     every required field that's empty, then surface them all in one
     bullet popup. Same pattern as references / certifications /
     languages / preferences / consulting / key_achievements. */
  const missing = [];

  if (isMentorCoach) {
    if (!trim($("mentSpeciality").value)) missing.push("Speciality / Focus Area");
    if (!$("mentYearsExp").value)         missing.push("Years of Relevant Experience");
    if (!trim($("mentBio").value))        missing.push("Mentor / Coach Bio");
  }

  if (isMenteeCoachee) {
    if (!trim($("menteeGoal").value)) missing.push("Your Development Goal");
  }

  if (missing.length > 0) {
    if (missing.length === 1) {
      showPopup("Please fill in: " + missing[0] + ".");
    } else {
      showPopup(
        "Please fill in the following before continuing:\n\n\u2022 " +
        missing.join("\n\u2022 ")
      );
    }
    /* Focus the first missing field. Order matches the order we
       collected them above. */
    if (isMentorCoach && !trim($("mentSpeciality").value))    $("mentSpeciality").focus();
    else if (isMentorCoach && !$("mentYearsExp").value)        $("mentYearsExp").focus();
    else if (isMentorCoach && !trim($("mentBio").value))       $("mentBio").focus();
    else if (isMenteeCoachee && !trim($("menteeGoal").value))  $("menteeGoal").focus();
    return false;
  }

  /* Contact URL — auto-fix + validate. Field is optional, so we
     only check it when the user typed something. The cleaned URL
     is written back to the input so save and display match. */
  if (isMentorCoach) {
    const contactUrlRaw = trim($("mentContactUrl").value);
    if (contactUrlRaw) {
      const cleaned = normalizeAndValidateUrl(contactUrlRaw);
      if (!cleaned) {
        showPopup("The contact link doesn't look like a valid web address. " +
                  "Please correct it or leave the field empty.");
        $("mentContactUrl").focus();
        return false;
      }
      if (cleaned !== $("mentContactUrl").value) {
        $("mentContactUrl").value = cleaned;
      }
    }
  }

  return true;
}

/* ============================================================
   BUILD PAYLOAD
   ============================================================ */

function buildPayload() {
  const roles = getSelectedRoles();
  const isMentorCoach   = roles.includes("Mentor")  || roles.includes("Coach");
  const isMenteeCoachee = roles.includes("Mentee")  || roles.includes("Coachee");

  return {
    roles        : roles,

    /* Mentor/Coach fields — null if not applicable */
    mentor_profile : isMentorCoach ? {
      speciality       : trim($("mentSpeciality").value),
      years_experience : $("mentYearsExp").value,
      target_audience  : $("mentTargetAudience").value || null,
      bio              : trim($("mentBio").value),
      fee              : $("mentFee").value || null,
      certification    : trim($("mentCertification").value) || null,
      contact_url      : trim($("mentContactUrl").value) || null,
      show_on_profile  : $("showOnProfile").checked
    } : null,

    /* Mentee/Coachee fields — null if not applicable */
    seeker_profile : isMenteeCoachee ? {
      goal           : trim($("menteeGoal").value),
      ideal_mentor   : trim($("menteeIdealMentor").value) || null
    } : null
  };
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `mentorship` table is gone. The entire payload now
   lives at profiles.data.mentorship as a single JSONB object
   (1-to-1 section). Save/load go through MC.saveSection /
   MC.loadSection which handle auth and RLS server-side via the
   save_profile_section RPC.

   The JSONB section key is "mentorship" (matches the dashboard
   completion predicate).

   This bundle is 1-to-1: one object per candidate. The shape we
   save matches the buildPayload() output so downstream loaders
   and public-profile renderers get a stable schema.
   ============================================================ */

async function apiSave(payload) {
  const obj = {
    roles          : Array.isArray(payload.roles) ? payload.roles : [],
    mentor_profile : payload.mentor_profile || null,
    seeker_profile : payload.seeker_profile || null
  };

  await MC.saveSection("mentorship", obj);
  return obj;
}

async function apiLoadMentorship() {
  if (!MC.candidateId) return;

  let data;
  try {
    data = await MC.loadSection("mentorship");
  } catch (err) {
    /* Non-fatal — page still works for new users when network is offline */
    console.error("Could not load mentorship:", err);
    return;
  }

  if (!data || !Array.isArray(data.roles) || data.roles.length === 0) return;

  /* Restore role checkboxes */
  setSelectedRoles(data.roles);

  /* Mentor/Coach fields */
  const mp = data.mentor_profile;
  if (mp) {
    if (mp.speciality)       $("mentSpeciality").value     = mp.speciality;
    if (mp.years_experience) $("mentYearsExp").value       = mp.years_experience;
    if (mp.target_audience)  $("mentTargetAudience").value = mp.target_audience;
    if (mp.bio)              $("mentBio").value            = mp.bio;
    if (mp.fee)              $("mentFee").value            = mp.fee;
    if (mp.certification)    $("mentCertification").value  = mp.certification;
    if (mp.contact_url)      $("mentContactUrl").value     = mp.contact_url;
    if (typeof mp.show_on_profile === "boolean") {
      $("showOnProfile").checked = mp.show_on_profile;
    }
    MC.updateCounter($("mentSpeciality"), "mentSpecialityCounter");
    MC.updateCounter($("mentBio"),        "mentBioCounter");
  }

  /* Mentee/Coachee fields */
  const sp = data.seeker_profile;
  if (sp) {
    if (sp.goal)         $("menteeGoal").value         = sp.goal;
    if (sp.ideal_mentor) $("menteeIdealMentor").value  = sp.ideal_mentor;
    MC.updateCounter($("menteeGoal"),        "menteeGoalCounter");
    MC.updateCounter($("menteeIdealMentor"), "menteeIdealCounter");
  }
}

/* ============================================================
   SAVE & CONTINUE
   ============================================================ */

async function saveContinue() {
  if (!validate()) return;

  const btn  = $("saveContinueBtn");
  const btn2 = $("skipBtn");
  setLoading(btn, true);
  btn2.disabled = true;

  try {
    await apiSave(buildPayload());
  } catch (err) {
    console.error("Mentorship save failed:", err);
    showToast("Could not save to server. Your data is preserved — please try again.", "error");
    setLoading(btn, false);
    btn2.disabled = false;
    return;
  }

  /* Saved successfully — clear draft */
  if (window.SaveNow) SaveNow.clearDraft();

  MC.safeSet("mentorship_completed", "yes");
  MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

  window.parent.postMessage(
    { type: "navigate", page: "portfolio.html", sidebarKey: "Work Portfolio" },
    "*"
  );

  setTimeout(() => { setLoading(btn, false); btn2.disabled = false; }, 800);
}

/* ============================================================
   SKIP
   ============================================================ */

function skipSection() {
  /* Detect any user input that would be lost on skip:
     - any role checkbox checked
     - any text typed into the form fields
     - the show-on-profile toggle changed (it defaults to checked,
       so we only treat *unchecking* as user input) */
  const hasInput = getSelectedRoles().length > 0
                || !!trim($("mentSpeciality").value)
                || !!$("mentYearsExp").value
                || !!$("mentTargetAudience").value
                || !!trim($("mentBio").value)
                || !!$("mentFee").value
                || !!trim($("mentCertification").value)
                || !!trim($("mentContactUrl").value)
                || !!trim($("menteeGoal").value)
                || !!trim($("menteeIdealMentor").value);

  const proceedSkip = () => {
    /* Don't save anything — clear any draft so it doesn't reappear */
    if (window.SaveNow) SaveNow.clearDraft();

    MC.safeSet("mentorship_completed", "skipped");
    MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

    window.parent.postMessage(
      { type: "navigate", page: "portfolio.html", sidebarKey: "Work Portfolio" },
      "*"
    );
  };

  if (hasInput) {
    showConfirm(
      "You have unsaved input on this page.\n\n" +
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
   SAVENOW DRAFT — capture and restore
   ============================================================ */

function captureMentorshipDraft() {
  return {
    roles           : getSelectedRoles(),
    showOnProfile   : $("showOnProfile").checked,
    mentSpeciality  : trim($("mentSpeciality").value),
    mentYearsExp    : $("mentYearsExp").value,
    mentTargetAudience: $("mentTargetAudience").value,
    mentBio         : trim($("mentBio").value),
    mentFee         : $("mentFee").value,
    mentCertification: trim($("mentCertification").value),
    mentContactUrl  : trim($("mentContactUrl").value),
    menteeGoal      : trim($("menteeGoal").value),
    menteeIdealMentor: trim($("menteeIdealMentor").value)
  };
}

function restoreMentorshipDraft(draft) {
  if (!draft) return false;

  if (Array.isArray(draft.roles)) setSelectedRoles(draft.roles);
  if (typeof draft.showOnProfile === "boolean") $("showOnProfile").checked = draft.showOnProfile;
  if (draft.mentSpeciality)     $("mentSpeciality").value     = draft.mentSpeciality;
  if (draft.mentYearsExp)       $("mentYearsExp").value       = draft.mentYearsExp;
  if (draft.mentTargetAudience) $("mentTargetAudience").value = draft.mentTargetAudience;
  if (draft.mentBio)            $("mentBio").value            = draft.mentBio;
  if (draft.mentFee)             $("mentFee").value            = draft.mentFee;
  if (draft.mentCertification)  $("mentCertification").value  = draft.mentCertification;
  if (draft.mentContactUrl)     $("mentContactUrl").value     = draft.mentContactUrl;
  if (draft.menteeGoal)         $("menteeGoal").value         = draft.menteeGoal;
  if (draft.menteeIdealMentor)  $("menteeIdealMentor").value  = draft.menteeIdealMentor;

  /* Update counters for restored fields */
  MC.updateCounter($("mentSpeciality"),    "mentSpecialityCounter");
  MC.updateCounter($("mentBio"),           "mentBioCounter");
  MC.updateCounter($("menteeGoal"),        "menteeGoalCounter");
  MC.updateCounter($("menteeIdealMentor"), "menteeIdealCounter");

  return true;
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  setupRoleCheckboxes();
  setupShowOnProfileHandler();

  /* Char counters on the limited fields */
  $("mentSpeciality").addEventListener("input", () => {
    MC.updateCounter($("mentSpeciality"), "mentSpecialityCounter");
  });
  $("mentBio").addEventListener("input", () => {
    MC.updateCounter($("mentBio"), "mentBioCounter");
  });
  $("menteeGoal").addEventListener("input", () => {
    MC.updateCounter($("menteeGoal"), "menteeGoalCounter");
  });
  $("menteeIdealMentor").addEventListener("input", () => {
    MC.updateCounter($("menteeIdealMentor"), "menteeIdealCounter");
  });

  $("saveContinueBtn").addEventListener("click", saveContinue);
  $("skipBtn").addEventListener("click", skipSection);

  /* Load any existing backend data BEFORE SaveNow.init so the draft-restore
     check has the canonical state to compare against. */
  await apiLoadMentorship();

  if (window.SaveNow) {
    SaveNow.init({
      pageName          : "mentorship",
      containerSelector : ".form-container",
      capturePayload    : captureMentorshipDraft,
      restorePayload    : restoreMentorshipDraft,
      apiSave           : (p) => apiSave(p),
      isEmpty           : () => getSelectedRoles().length === 0
                              && !trim($("mentSpeciality").value)
                              && !trim($("mentBio").value)
                              && !trim($("menteeGoal").value)
    });
  }
});
