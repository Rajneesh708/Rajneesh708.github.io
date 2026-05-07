/* ============================================================
   MECULS — languages.js
   Languages & Additional Information section logic. Polished onto
   the shared architecture:
     - MC.* helpers (no local copies of $/trim/showPopup/showToast/
       setLoading/showConfirm)
     - SaveNow draft-restore for the form (single-form scope)
     - candidateId read fresh from MC.candidateId at save/load time
   Languages rendered as colour-coded tags (proficiency-based).
   Stable uid used for removal — not array index.

   Bugs fixed in this polish pass:
   - XSS via lang.name interpolated into innerHTML in renderLanguages.
     Fixed with safe DOM construction using textContent.
   - parseInt without radix on data-uid read.
   - URL fields (LinkedIn / GitHub / Portfolio / Other) accepted any
     string — including non-URLs like "not-a-url". Now validated
     against http(s):// scheme at submit time, with a live red hint
     as user types.
   - apiLoadLanguages ran without checking candidateId.

   Submission flow (significant change):
   - Old: clicking "Save & Submit Your Profile" navigated to
     ai_tools.html (a bonus section). The button label promised
     submission but the user just got bumped into bonus territory.
     Meanwhile dashboard.js listened for { type: "submitted" } that
     nothing ever fired — meaning there was no way to actually
     submit the profile.
   - New: clicking the button now POSTs { type: "submitted" } to
     the dashboard, which switches to submission_complete.html and
     fires the congratulations overlay. Bonus sections remain
     accessible via the dedicated sidebar group, available before
     OR after submission.
   - A confirm dialog precedes submission so users don't accidentally
     finalize a profile they meant to keep editing.

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `additional_info` table is gone.
     The languages-bundle (languages array + public_links + awards)
     now lives at profiles.data.languages as a single JSONB object.
     Save/load go through MC.saveSection / MC.loadSection.
   - URL auto-fix on blur for all 4 link fields. Mirrors the
     certifications.js credential-URL normaliser: trims, strips
     wrapping/smart quotes + trailing punctuation, fixes typos
     (htps://, htp://, https//, http//, https:/, http:/), and
     prepends https:// when no protocol is present. Does NOT
     auto-upgrade http:// → https:// (some legacy sites are
     http-only). Rejects javascript:/data:/etc. for safety.
   - Generic per-error validation popups consolidated into bullet
     popups (matches skills, profile_category, professional_intro,
     certifications, references, preferences).
   - Save & Submit / Save & Continue now auto-add a mid-form
     language entry if the user filled the name + proficiency but
     forgot to click "Add Language to List". Without this, that
     typed data is lost on submit/navigate. Mirrors references.js.
   - Defensive: loadLanguages clears the in-memory list before
     repopulating, so re-entry into the page can't duplicate rows.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.LANGUAGES_VERSION === "phase1-step3" */
window.LANGUAGES_VERSION = "phase1-step3";

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $           = MC.$;
const trim        = MC.trim;
const showPopup   = MC.showPopup;
const showToast   = MC.showToast;
const setLoading  = MC.setLoading;
const showConfirm = MC.showConfirm;

/* ── In-memory state ── */
let languages = [];
let langUid   = 0;

/* Soft cap on number of languages — typical bilingual/trilingual
   senior professionals add 2-5; 15 is well past any realistic case
   and stops pathological data without forcing users to think about it. */
const MAX_LANGUAGES = 15;

/* ── URL safety check — must start with http(s)://. Same pattern
   as certifications.js. Local helper because mc_helpers.js doesn't
   yet expose this; consider promoting to MC.isSafeHttpUrl in a
   future shared-module pass. */
function isSafeHttpUrl(raw) {
  if (!raw) return false;
  const s = trim(raw);
  if (!s) return false;
  const lower = s.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

/* ── Profile URL auto-fix + validate ──
   Mirrors normalizeAndValidateCredentialUrl in certifications.js.
   Used for all four link fields (LinkedIn, GitHub, Portfolio, Other).

   Cleanups:
   - Trim whitespace, strip wrapping straight + smart quotes
   - Strip trailing punctuation users sometimes leave from pasting
   - Fix protocol typos: htps://, htp://, https//, http//, https:/, http:/
   - Prepend https:// if no protocol present
   - Reject other schemes (javascript:, data:, ftp:, etc.)
   - Final URL parse to confirm a non-empty host

   Returns the cleaned URL string or null if unfixable.
   Does NOT auto-upgrade http:// to https://. */
function normalizeAndValidateProfileUrl(raw) {
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
   RENDER LANGUAGE TAGS — XSS-safe DOM construction
   Colour-coded by proficiency. Stable uid removal.
   ============================================================ */

function renderLanguages() {
  const area = $("languageTagsArea");
  const countBadge = $("langCount");
  const addBtn = $("addLanguageBtn");

  /* Count badge shows current vs cap so user knows where they stand. */
  countBadge.textContent = languages.length + " / " + MAX_LANGUAGES + " added";

  /* Disable Add button visually + functionally when at cap. */
  if (addBtn) {
    addBtn.disabled = (languages.length >= MAX_LANGUAGES);
  }

  /* Static wipe — safe (no user input). */
  area.innerHTML = "";

  if (languages.length === 0) {
    area.className = "lang-tags-area lang-tags-area--empty";
    area.textContent = "No languages added yet.";
    return;
  }

  area.className = "lang-tags-area";

  languages.forEach(lang => {
    const tag = document.createElement("span");
    tag.className = "lang-tag lang-tag--" + lang.proficiency;

    /* Language name — textContent so user input cannot carry HTML. */
    tag.appendChild(document.createTextNode(lang.name + " "));

    /* Proficiency level — small muted text after the name. */
    const levelEl = document.createElement("span");
    levelEl.className = "lang-tag__level";
    levelEl.textContent = "\u00b7 " + lang.proficiency;
    tag.appendChild(levelEl);

    /* Remove button — closure over lang.uid (no string-attribute round-trip). */
    const removeBtn = document.createElement("button");
    removeBtn.className = "lang-tag__remove";
    removeBtn.title = "Remove " + lang.name;
    removeBtn.textContent = "\u2715";
    removeBtn.addEventListener("click", () => removeLanguage(lang.uid));
    tag.appendChild(removeBtn);

    area.appendChild(tag);
  });
}

/* ============================================================
   REMOVE LANGUAGE — uid-based, not index-based
   ============================================================ */

function removeLanguage(uid) {
  languages = languages.filter(l => l.uid !== uid);
  renderLanguages();
}

/* ============================================================
   ADD LANGUAGE TO LIST
   ============================================================ */

function addLanguage() {
  /* Soft cap check — block before any other validation so users
     understand the reason immediately. */
  if (languages.length >= MAX_LANGUAGES) {
    showPopup(
      "You have reached the maximum of " + MAX_LANGUAGES + " languages. " +
      "Remove one to add another."
    );
    return;
  }

  const name        = trim($("languageName").value);
  const proficiency = $("languageLevel").value;

  /* Collect missing fields. Same consolidated-popup pattern used
     across skills, references, certifications. */
  const missing = [];
  if (!name)        missing.push("Language");
  if (!proficiency) missing.push("Proficiency");

  if (missing.length > 0) {
    showPopup(
      "Please fill the following before adding this language:\n\n\u2022 " +
      missing.join("\n\u2022 ")
    );
    /* Focus the first missing field. */
    const firstId = missing[0] === "Language" ? "languageName" : "languageLevel";
    if ($(firstId)) $(firstId).focus();
    return;
  }

  /* Duplicate check — same name already in list */
  const isDuplicate = languages.some(
    l => l.name.toLowerCase() === name.toLowerCase()
  );
  if (isDuplicate) {
    showPopup("\u201C" + name + "\u201D is already in your languages list.");
    return;
  }

  languages.push({ uid: ++langUid, name, proficiency });

  /* Clear inputs and focus for next entry */
  $("languageName").value  = "";
  $("languageLevel").value = "";
  renderLanguages();
  $("languageName").focus();
}

/* ============================================================
   CHAR COUNTER — awards textarea
   ============================================================ */

function setupCharCounter() {
  const textarea = $("awards");
  const counter  = $("awardsCounter");
  if (!textarea || !counter) return;

  const refresh = () => {
    const len = textarea.value.length;
    const max = parseInt(textarea.getAttribute("maxlength"), 10) || 1000;
    counter.textContent = len + " / " + max;
    counter.className = "char-counter" +
      (len >= max ? " at-limit" :
       len >= max * 0.85 ? " near-limit" : "");
  };

  textarea.addEventListener("input", refresh);
  refresh(); /* prime initial state in case loaded with content */
}

/* ============================================================
   URL FIELD LIVE VALIDATION — soft red hint as user types when a
   URL doesn't start with http(s)://. Hidden when empty or valid.
   Plus a softer amber-ish hint when the URL is structurally valid
   but doesn't appear to point at the expected platform (e.g. a
   github.com URL pasted into the LinkedIn field).
   ============================================================ */

/* Map field id → expected substring + display label.
   "Other" has no expected domain — anything goes. */
const URL_PLATFORMS = {
  linkLinkedIn : { expected: "linkedin.com", label: "LinkedIn" },
  linkGitHub   : { expected: "github.com",   label: "GitHub" },
  linkPortfolio: { expected: null,           label: "Portfolio" }
};

function setupUrlValidation() {
  ["linkLinkedIn","linkGitHub","linkPortfolio","linkOther"].forEach(id => {
    const el = $(id);
    if (!el) return;
    const refresh = () => {
      const v = trim(el.value);
      const openIcon = $(id + "Open");

      if (!v) {
        el.classList.remove("field-input--invalid");
        hidePlatformHint(id);
        if (openIcon) openIcon.classList.add("hidden");
        return;
      }
      /* Be lenient during typing — only flag if the normaliser
         can't make sense of it. A user typing "linkedin.co" mid-stream
         isn't "wrong" — it's an in-progress URL. We hide the icon
         until the URL is fully valid (so the open arrow doesn't
         flicker on every keystroke). */
      const cleaned = normalizeAndValidateProfileUrl(v);
      if (!cleaned) {
        el.classList.add("field-input--invalid");
        hidePlatformHint(id);   /* hard error wins over soft hint */
        if (openIcon) openIcon.classList.add("hidden");
        return;
      }
      /* Structurally valid (or fixable to valid). */
      el.classList.remove("field-input--invalid");
      if (openIcon) {
        openIcon.href = cleaned;
        openIcon.classList.remove("hidden");
      }
      checkPlatformMatch(id, cleaned);
    };
    el.addEventListener("input", refresh);
    /* On blur, ALSO write the cleaned value back to the input so
       the user sees the protocol get prepended, smart quotes
       stripped, etc. — and so the saved payload contains the
       cleaned URL, not whatever was raw-pasted. */
    el.addEventListener("blur", () => {
      const v = trim(el.value);
      if (v) {
        const cleaned = normalizeAndValidateProfileUrl(v);
        if (cleaned && cleaned !== el.value) {
          el.value = cleaned;
        }
      }
      refresh();
    });
  });
}

function checkPlatformMatch(fieldId, url) {
  const meta = URL_PLATFORMS[fieldId];
  if (!meta || !meta.expected) {
    hidePlatformHint(fieldId);
    return;
  }
  const lower = url.toLowerCase();
  if (lower.includes(meta.expected)) {
    hidePlatformHint(fieldId);
  } else {
    showPlatformHint(fieldId,
      "This doesn\u2019t look like a " + meta.label + " URL. " +
      "Expected a " + meta.expected + " link. You can still save it as-is.");
  }
}

function showPlatformHint(fieldId, msg) {
  let hint = $(fieldId + "Hint");
  if (!hint) {
    hint = document.createElement("p");
    hint.id = fieldId + "Hint";
    hint.className = "helper-text helper-text--soft-warn";
    hint.setAttribute("aria-live", "polite");
    /* Insert hint after the parent .link-row (so it spans full width
       below the row, not inside the 2-column grid). */
    const input = $(fieldId);
    const linkRow = input ? input.closest(".link-row") : null;
    if (linkRow && linkRow.parentElement) {
      linkRow.insertAdjacentElement("afterend", hint);
    }
  }
  hint.textContent = msg;
  hint.classList.remove("hidden");
}

function hidePlatformHint(fieldId) {
  const hint = $(fieldId + "Hint");
  if (hint) hint.classList.add("hidden");
}

/* ============================================================
   VALIDATE BEFORE SUBMIT
   ============================================================ */

function validate() {
  if (languages.length === 0) {
    showPopup("Please add at least one language before submitting.");
    return false;
  }

  /* URL fields — non-empty values must normalise to a valid http(s)
     URL. Collect all bad URLs and surface them in one popup so the
     user fixes everything in one pass. For valid URLs, write the
     cleaned value back to the input so what the user SEES matches
     what gets saved (handles the case where user clicks Submit
     without blurring out of the URL field, so the on-blur cleanup
     never ran). */
  const linkChecks = [
    { id: "linkLinkedIn",  label: "LinkedIn"  },
    { id: "linkGitHub",    label: "GitHub"    },
    { id: "linkPortfolio", label: "Portfolio" },
    { id: "linkOther",     label: "Other"     }
  ];
  const badLinks = [];
  for (const { id, label } of linkChecks) {
    const el = $(id);
    const v = trim(el.value);
    if (!v) continue;
    const cleaned = normalizeAndValidateProfileUrl(v);
    if (!cleaned) {
      badLinks.push(label);
    } else if (cleaned !== el.value) {
      /* Auto-fix passed — apply the cleanup so save and display match. */
      el.value = cleaned;
    }
  }
  if (badLinks.length > 0) {
    showPopup(
      "The following profile links don't look like valid web addresses:\n\n\u2022 " +
      badLinks.join("\n\u2022 ") +
      "\n\nPlease correct them or leave the field empty."
    );
    /* Focus the first bad field. */
    const firstId = linkChecks.find(c => c.label === badLinks[0]).id;
    if ($(firstId)) $(firstId).focus();
    return false;
  }

  return true;
}

/* ============================================================
   BUILD PAYLOAD
   ============================================================ */

function buildPayload() {
  /* Collect profile links — only include non-empty */
  const links = [];
  const linkFields = [
    { id: "linkLinkedIn",  label: "LinkedIn"  },
    { id: "linkGitHub",    label: "GitHub"    },
    { id: "linkPortfolio", label: "Portfolio" },
    { id: "linkOther",     label: "Other"     }
  ];
  linkFields.forEach(({ id, label }) => {
    const val = trim($(id).value);
    if (val) links.push({ platform: label, url: val });
  });

  return {
    languages    : languages.map(l => ({ name: l.name, proficiency: l.proficiency })),
    public_links : links.length ? links : null,
    awards       : trim($("awards").value) || null
  };
}

/* ============================================================
   API
   ============================================================ */

/* ============================================================
   API — Supabase
   ============================================================
   Uses the shared MC_SB helper (mc_supabase.js).

   The "Languages" page bundles three logical sections:
   languages (required), public_links (optional), and awards
   (optional free-text). All three live in the
   `additional_info` table — one row per candidate, upserted
   on save.
   ============================================================ */

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `additional_info` table is gone. The languages-bundle
   (languages array + public_links + awards) now lives at
   profiles.data.languages as a single JSONB object. Save/load go
   through MC.saveSection / MC.loadSection which handle auth and
   RLS server-side via the save_profile_section RPC.

   This bundle is 1-to-1: one object per candidate. The shape we
   save matches the legacy column names so the loadLanguages()
   consumer code below doesn't need to change.
   ============================================================ */

async function apiSaveLanguages(payload) {
  /* Sanitise payload one more time before save — defensive in case
     caller passed mixed types. */
  const obj = {
    languages    : Array.isArray(payload.languages)    ? payload.languages    : [],
    public_links : Array.isArray(payload.public_links) ? payload.public_links : null,
    awards       : payload.awards || null
  };

  await MC.saveSection("languages", obj);
  return obj;
}

async function apiLoadLanguages() {
  const obj = await MC.loadSection("languages");
  return obj && typeof obj === "object" ? obj : null;
}

/* ============================================================
   AUTO-ADD MID-FORM LANGUAGE
   Detects a typed-but-not-added language entry and tries to add
   it to the list. Used by Submit / Continue-to-Bonus so a user who
   typed "French / Fluent" but forgot to click Add doesn't lose
   that data when they click Submit.
   Returns:
     - true if there was no mid-form input OR the auto-add succeeded
     - false if there was mid-form input but the add failed (missing
       field, duplicate, at cap) — caller should bail out to let the
       user fix it.
   ============================================================ */
function tryAutoAddPendingLanguage() {
  const name        = trim($("languageName").value);
  const proficiency = $("languageLevel").value;

  /* Nothing typed → nothing to do. */
  if (!name && !proficiency) return true;

  /* Both fields filled → try to add. addLanguage shows a popup
     itself if anything is wrong (missing field, duplicate, at cap). */
  addLanguage();

  /* If addLanguage succeeded, both inputs are now empty (it clears
     them on success). If they're still populated, it didn't go in
     and the user needs to fix something. */
  const stillTyped =
    trim($("languageName").value) || $("languageLevel").value;
  return !stillTyped;
}

/* ============================================================
   SAVE & SUBMIT YOUR PROFILE
   This is the FINAL step. Confirm with the user before submitting,
   then POST { type: "submitted" } to the parent dashboard so the
   submission_complete page is shown and the congratulations overlay
   appears.
   ============================================================ */

function submitProfile() {
  /* Auto-add any typed-but-not-added language entry first. If the
     auto-add failed, addLanguage already showed the user why — we
     just bail out so they can fix it. */
  if (!tryAutoAddPendingLanguage()) return;

  if (!validate()) return;

  showConfirm(
    "Ready to submit your profile? You can still edit any section later, " +
    "and you can add Bonus Profile sections (Portfolio, Publications, etc.) " +
    "from the sidebar before or after submitting.",
    () => doSubmit(),
    {
      confirmLabel : "Yes, submit my profile",
      cancelLabel  : "Not yet"
    }
  );
}

async function doSubmit() {
  const btn = $("submitProfileBtn");
  setLoading(btn, true);

  const payload = buildPayload();

  try {
    await apiSaveLanguages(payload);
  } catch (err) {
    console.error("Languages save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(btn, false);
    return;
  }

  localStorage.setItem("languages_completed", "yes");
  localStorage.setItem("profile_submitted", "yes");
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* Submitted — drop any in-progress draft. */
  if (window.SaveNow) SaveNow.clearDraft();

  /* Tell dashboard the profile is submitted. dashboard.js listens
     for this and switches to submission_complete.html with the
     congratulations overlay. */
  window.parent.postMessage({ type: "submitted" }, "*");

  setTimeout(() => setLoading(btn, false), 800);
}

/* ============================================================
   SAVE & CONTINUE TO BONUS PROFILE
   Alternative path from the final main step. Same validation as
   submit (at least 1 language, valid URLs), saves the data, but
   does NOT submit the profile — instead navigates the dashboard
   iframe to AI Tools & Digital Literacy (the first bonus section).

   The user can still submit later from this page (just come back)
   or from wherever a global submit lands in future.
   ============================================================ */

async function continueToBonus() {
  /* Auto-add any typed-but-not-added language entry first. */
  if (!tryAutoAddPendingLanguage()) return;

  if (!validate()) return;

  const btn = $("continueToBonusBtn");
  setLoading(btn, true);

  const payload = buildPayload();

  try {
    await apiSaveLanguages(payload);
  } catch (err) {
    console.error("Languages save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(btn, false);
    return;
  }

  /* Mark this section complete, but do NOT set profile_submitted —
     that flag is reserved for actual submission. */
  localStorage.setItem("languages_completed", "yes");
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* Drop any in-progress draft for this page. */
  if (window.SaveNow) SaveNow.clearDraft();

  /* Navigate dashboard to the first bonus section. */
  window.parent.postMessage(
    {
      type      : "navigate",
      page      : "ai_tools.html",
      sidebarKey: "AI Tools & Digital Literacy"
    },
    "*"
  );

  setTimeout(() => setLoading(btn, false), 800);
}

/* ============================================================
   DRAFT CAPTURE / RESTORE
   ============================================================ */

function captureFormDraft() {
  return {
    languages    : languages.map(l => ({
                     name: l.name, proficiency: l.proficiency
                   })),
    language_in_progress_name : trim($("languageName").value),
    language_in_progress_level: $("languageLevel").value,
    link_linkedin : trim($("linkLinkedIn").value),
    link_github   : trim($("linkGitHub").value),
    link_portfolio: trim($("linkPortfolio").value),
    link_other    : trim($("linkOther").value),
    awards        : trim($("awards").value)
  };
}

function restoreFormDraft(draft) {
  if (!draft) return false;

  /* Restore the saved-tags list */
  if (Array.isArray(draft.languages)) {
    languages = [];
    langUid = 0;
    draft.languages.forEach(l => {
      languages.push({ uid: ++langUid, name: l.name, proficiency: l.proficiency });
    });
    renderLanguages();
  }

  /* Restore the in-progress entry (if user was mid-typing) */
  const setVal = (id, v) => {
    const el = $(id);
    if (el && v != null) el.value = v;
  };
  setVal("languageName",  draft.language_in_progress_name);
  setVal("languageLevel", draft.language_in_progress_level);
  setVal("linkLinkedIn",  draft.link_linkedin);
  setVal("linkGitHub",    draft.link_github);
  setVal("linkPortfolio", draft.link_portfolio);
  setVal("linkOther",     draft.link_other);
  setVal("awards",        draft.awards);

  /* Refresh char counter for awards + URL icons/hints for links. */
  ["awards","linkLinkedIn","linkGitHub","linkPortfolio","linkOther"].forEach(id => {
    const el = $(id);
    if (el) el.dispatchEvent(new Event("input"));
  });

  return true;
}

/* ============================================================
   LOAD EXISTING DATA ON PAGE OPEN
   Silently ignores errors — fresh form is fine.
   ============================================================ */

async function loadLanguages() {
  if (!MC.candidateId) return;

  try {
    const data = await apiLoadLanguages();
    if (!data) return;

    /* Defensive reset: if loadLanguages is called more than once
       (e.g. via SaveNow restore + page init in some future flow),
       we want to replace the in-memory list, not append to it. */
    languages = [];
    langUid = 0;

    /* Languages */
    if (data.languages && data.languages.length) {
      data.languages.forEach(l => {
        languages.push({
          uid        : ++langUid,
          name       : l.name,
          proficiency: l.proficiency
        });
      });
      renderLanguages();
    }

    /* Public links — structured array */
    if (data.public_links && data.public_links.length) {
      const linkMap = { LinkedIn: "linkLinkedIn", GitHub: "linkGitHub",
                        Portfolio: "linkPortfolio", Other: "linkOther" };
      data.public_links.forEach(link => {
        const fieldId = linkMap[link.platform];
        if (fieldId && $(fieldId)) {
          $(fieldId).value = link.url || "";
          /* Trigger the input handler so the open-link icon and any
             platform hint reflect the loaded value. */
          $(fieldId).dispatchEvent(new Event("input"));
        }
      });
    }

    /* Awards */
    if (data.awards) {
      $("awards").value = data.awards;
      $("awards").dispatchEvent(new Event("input"));
    }

  } catch (err) {
    console.error("Could not load existing languages/info:", err);
  }
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  setupCharCounter();
  setupUrlValidation();

  /* Enter key on language name → add */
  $("languageName").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addLanguage(); }
  });

  $("addLanguageBtn").addEventListener("click", addLanguage);
  $("submitProfileBtn").addEventListener("click", submitProfile);
  $("continueToBonusBtn").addEventListener("click", continueToBonus);

  /* Load existing data first, then init SaveNow for draft handling. */
  await loadLanguages();

  SaveNow.init({
    pageName          : "languages",
    containerSelector : ".form-container",
    capturePayload    : captureFormDraft,
    restorePayload    : restoreFormDraft,
    apiSave           : null,   /* No batch endpoint — submit happens on final button */
    isEmpty: () => languages.length === 0 &&
                   !trim($("languageName")?.value || "") &&
                   !$("languageLevel").value &&
                   !trim($("linkLinkedIn")?.value || "") &&
                   !trim($("linkGitHub")?.value || "") &&
                   !trim($("linkPortfolio")?.value || "") &&
                   !trim($("linkOther")?.value || "") &&
                   !trim($("awards")?.value || "")
  });
});
