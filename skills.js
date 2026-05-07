/* ============================================================
   MECULS — skills.js
   Skills section logic. Polished onto the shared architecture:
     - MC.* helpers (no local copies of showPopup/showToast/setLoading)
     - SaveNow draft-restore engine
     - Sidebar-consistent navigation labels
     - candidateId read fresh from MC.candidateId at save time
   Category-based skill grouping with live preview.
   postMessage navigation to parent dashboard.

   Bugs fixed in this pass:
   - XSS via skill name (innerHTML interpolation) → DOM construction now
     uses textContent everywhere user-supplied strings appear.
   - Custom "Other" category label was lost because the category bucket
     ended up as the typed string ("Cooking") which had no CSS class
     and wasn't in the categoryOrder render list → custom-category
     skills became invisible. Now stored as { category:"Other",
     customLabel:"Cooking" } and rendered under the Other bucket with
     the custom label shown inside the tag.
   - No upper bound on skill count → soft cap of MAX_SKILLS with a
     friendly popup once reached.

   Phase 1 Step 3 changes:
   - Schema migration: the legacy `skills` table is gone. The skills
     array now lives at profiles.data.skills (JSONB). Save/load go
     through MC.saveSection / MC.loadSection.
   - Generic "Please fill the skill form first" replaced with a
     consolidated, named-field validation popup (says exactly which
     of Name / Category / Proficiency are missing).
   - Defensive render: any saved skill with a stale category string
     (legacy data) falls back to the Other bucket so it stays visible.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.SKILLS_VERSION === "phase1-step3" */
window.SKILLS_VERSION = "phase1-step3";

/* ── Config ── */
const MIN_SKILLS = 3;
const MAX_SKILLS = 30;   /* soft cap — reasonable upper bound for a profile */

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $          = MC.$;
const trim       = MC.trim;
const showPopup  = MC.showPopup;
const showToast  = MC.showToast;
const setLoading = MC.setLoading;

/* ── In-memory skills state ──
   Each entry: { id, name, category, customLabel?, proficiency }
   - id          : stable unique id (incrementing) for safe remove
   - name        : the skill itself, e.g. "Python"
   - category    : one of Technical/Domain/Soft/Tools/Language/Other
   - customLabel : (optional) only present when category === "Other"
                   and user typed a custom category name like "Cooking"
   - proficiency : Beginner / Intermediate / Advanced / Expert
─────────────────────────────────────────────────────────── */
let skills   = [];
let skillUid = 0;

/* ── Category display labels (for the grouped preview headings) ── */
const CATEGORY_LABELS = {
  Technical : "Technical Skills",
  Domain    : "Domain / Industry Skills",
  Soft      : "Soft Skills",
  Tools     : "Tools & Software",
  Language  : "Languages",
  Other     : "Other"
};

/* Defined render order — any skill with a category outside this list
   would otherwise be silently dropped from the preview. */
const CATEGORY_ORDER = ["Technical","Domain","Soft","Tools","Language","Other"];

/* ── DOM refs (cached) ── */
const skillNameInput     = $("skillName");
const skillCategory      = $("skillCategory");
const skillCategoryOther = $("skillCategoryOther");
const skillLevel         = $("skillLevel");
const addSkillBtn        = $("addSkillBtn");
const saveSkillsBtn      = $("saveSkillsBtn");
const skillsGrouped      = $("skillsGroupedList");
const skillsEmpty        = $("skillsEmptyState");
const skillCountBadge    = $("skillCount");
const skillsMinHint      = $("skillsMinHint");

/* ============================================================
   RENDER — grouped by category, coloured tags, XSS-safe
   ============================================================ */

function renderSkills() {
  /* Update count badge — always shows current/max so the user sees
     progress against the cap at a glance. */
  skillCountBadge.textContent = skills.length + " of " + MAX_SKILLS;

  /* Update min-skills hint with three distinct states:
     - Below MIN: tell user how many more they need (and the max)
     - At/above MIN, below MAX: confirm they're good, show remaining capacity
     - At MAX: tell them they've hit the cap (Add button is also disabled in addSkill) */
  if (skills.length >= MAX_SKILLS) {
    skillsMinHint.textContent =
      "\u2713 You've reached the maximum of " + MAX_SKILLS + " skills.";
    skillsMinHint.classList.add("helper-text--success");
    skillsMinHint.classList.remove("helper-text--neutral");
  } else if (skills.length >= MIN_SKILLS) {
    const headroom = MAX_SKILLS - skills.length;
    skillsMinHint.textContent =
      "\u2713 " + skills.length + " skill" +
      (skills.length > 1 ? "s" : "") + " added \u2014 you can add up to " +
      headroom + " more (" + MAX_SKILLS + " total).";
    skillsMinHint.classList.add("helper-text--success");
    skillsMinHint.classList.remove("helper-text--neutral");
  } else {
    const remaining = MIN_SKILLS - skills.length;
    skillsMinHint.textContent =
      "Add at least " + remaining + " more skill" +
      (remaining > 1 ? "s" : "") + " before saving (minimum " + MIN_SKILLS +
      ", maximum " + MAX_SKILLS + ").";
    skillsMinHint.classList.add("helper-text--neutral");
    skillsMinHint.classList.remove("helper-text--success");
  }

  /* Show empty state if no skills */
  if (skills.length === 0) {
    skillsGrouped.innerHTML = "";
    skillsEmpty.classList.remove("hidden");
    return;
  }
  skillsEmpty.classList.add("hidden");

  /* Group skills by category — preserve insertion order within each group.
     DEFENSIVE: if a saved skill has a category string that's not in our
     CATEGORY_ORDER (legacy data from before the Other+customLabel pattern,
     or just unexpected JSON), bucket it under "Other" with the original
     string preserved as a customLabel so it stays visible. */
  const groups = {};
  skills.forEach(skill => {
    let cat = skill.category;
    if (!CATEGORY_LABELS[cat]) {
      /* Unknown category — preserve user-typed value, render under Other */
      if (!skill.customLabel) skill.customLabel = cat;
      cat = "Other";
    }
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(skill);
  });

  /* Wipe and re-render */
  skillsGrouped.innerHTML = "";

  CATEGORY_ORDER.forEach(cat => {
    if (!groups[cat]) return;

    const groupDiv = document.createElement("div");
    groupDiv.className = "skill-category-group";

    const labelDiv = document.createElement("div");
    labelDiv.className = "skill-category-label";
    labelDiv.textContent = CATEGORY_LABELS[cat] || cat;
    groupDiv.appendChild(labelDiv);

    const tagsRow = document.createElement("div");
    tagsRow.className = "skill-tags-row";

    groups[cat].forEach(skill => {
      const tag = document.createElement("div");
      /* Use the bucket category (cat) for the CSS class, NOT skill.category.
         If a legacy skill had category="Cooking", we bucketed it under Other
         above; using skill.category here would emit skill-tag--Cooking which
         has no styling. */
      tag.className = "skill-tag skill-tag--" + cat;

      /* Skill name — textContent guarantees no HTML injection. */
      const nameSpan = document.createElement("span");
      nameSpan.textContent = skill.name;
      tag.appendChild(nameSpan);

      /* Custom category label rendering — show whenever we bucketed
         under Other AND a customLabel is present. This covers both the
         new pattern (category="Other", customLabel="Cooking") AND the
         legacy fallback path above (where we just promoted skill.category
         to customLabel). Either way, render it as a sub-label. */
      if (cat === "Other" && skill.customLabel) {
        const customSpan = document.createElement("span");
        customSpan.className = "skill-tag__custom-cat";
        customSpan.textContent = "(" + skill.customLabel + ")";
        tag.appendChild(customSpan);
      }

      /* Proficiency dot */
      const profSpan = document.createElement("span");
      profSpan.className = "skill-tag__proficiency";
      profSpan.textContent = "\u00b7 " + skill.proficiency;
      tag.appendChild(profSpan);

      /* Remove button — keep textContent on title attr to neutralise
         any embedded quotes etc. in the skill name. */
      const removeBtn = document.createElement("button");
      removeBtn.className = "skill-tag__remove";
      removeBtn.title = "Remove " + skill.name;
      removeBtn.setAttribute("data-id", String(skill.id));
      removeBtn.textContent = "\u2715";
      tag.appendChild(removeBtn);

      tagsRow.appendChild(tag);
    });

    groupDiv.appendChild(tagsRow);
    skillsGrouped.appendChild(groupDiv);
  });

  /* Wire up remove buttons — direct binding (we just created them) */
  skillsGrouped.querySelectorAll(".skill-tag__remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.getAttribute("data-id"), 10);
      removeSkill(id);
    });
  });
}

/* ============================================================
   ADD SKILL
   ============================================================ */

function addSkill() {
  /* Soft cap before any further input — once at MAX, refuse politely */
  if (skills.length >= MAX_SKILLS) {
    showPopup(
      "You have reached the maximum of " + MAX_SKILLS + " skills. " +
      "Please remove one of your existing skills before adding another."
    );
    return;
  }

  const name        = trim(skillNameInput.value);
  const rawCategory = skillCategory.value;
  const customTyped = trim(skillCategoryOther ? skillCategoryOther.value : "");
  const proficiency = skillLevel.value;

  /* Validate — collect ALL missing required fields and surface them
     together so the user fixes everything in one pass. */
  const missing = [];
  if (!name)        missing.push("Skill Name");
  if (!rawCategory) missing.push("Category");
  if (rawCategory === "Other" && !customTyped) missing.push("Category (please specify)");
  if (!proficiency) missing.push("Proficiency");

  if (missing.length > 0) {
    showPopup(
      "Please fill the following before adding this skill:\n\n\u2022 " +
      missing.join("\n\u2022 ")
    );
    return;
  }

  /* Duplicate check — same name, case-insensitive */
  const isDuplicate = skills.some(
    s => s.name.toLowerCase() === name.toLowerCase()
  );
  if (isDuplicate) {
    showPopup("\"" + name + "\" is already in your skills list.");
    return;
  }

  /* Add to state.
     If "Other" was selected, keep category="Other" so it renders under
     the Other bucket with proper styling, and stash the user-typed
     label as customLabel (shown inline in the tag). */
  const entry = {
    id          : ++skillUid,
    name        : name,
    category    : rawCategory,
    proficiency : proficiency
  };
  if (rawCategory === "Other") entry.customLabel = customTyped;
  skills.push(entry);

  /* Reset inputs */
  skillNameInput.value = "";
  skillCategory.value  = "";
  skillLevel.value     = "";
  if (skillCategoryOther) {
    skillCategoryOther.value = "";
    skillCategoryOther.classList.add("hidden");
  }
  skillNameInput.focus();

  renderSkills();

  /* Persist immediately — input event won't fire on a button click,
     so we explicitly back up to localStorage and flash the heartbeat. */
  if (window.SaveNow && SaveNow.silentSave) {
    SaveNow.silentSave();
    SaveNow.flashStatus();
  }
}

/* ============================================================
   REMOVE SKILL
   ============================================================ */

function removeSkill(id) {
  skills = skills.filter(s => s.id !== id);
  renderSkills();

  /* Same as addSkill — persist removal immediately. */
  if (window.SaveNow && SaveNow.silentSave) {
    SaveNow.silentSave();
    SaveNow.flashStatus();
  }
}

/* ============================================================
   DRAFT CAPTURE / RESTORE
   ============================================================ */

function captureSkillsDraft() {
  /* Save the entire skills list. UID is excluded — we regenerate
     fresh ids on restore so they remain unique and stable. */
  return {
    skills: skills.map(s => ({
      name        : s.name,
      category    : s.category,
      customLabel : s.customLabel || null,
      proficiency : s.proficiency
    }))
  };
}

function restoreSkillsDraft(draft) {
  if (!draft || !Array.isArray(draft.skills)) return false;
  /* Reset state and rebuild. Assign fresh UIDs as we go. */
  skills = [];
  skillUid = 0;
  draft.skills.forEach(d => {
    if (!d || !d.name || !d.category || !d.proficiency) return;
    const entry = {
      id          : ++skillUid,
      name        : d.name,
      category    : d.category,
      proficiency : d.proficiency
    };
    if (d.customLabel) entry.customLabel = d.customLabel;
    skills.push(entry);
  });
  renderSkills();
  return true;
}

/* ============================================================
   API — Supabase JSONB section (Phase 1 Step 3)
   ============================================================
   The legacy `skills` table was wiped in Phase 1 Step 1 — the
   skills array now lives at profiles.data.skills as a JSONB
   blob. Save/load go through MC.saveSection / MC.loadSection
   which handle auth, RLS, and JSONB merging server-side via
   the save_profile_section() RPC.

   Skills is 1-to-1: one section, one array. We send the array
   directly (not wrapped in an object) because the section IS
   the array.
   ============================================================ */

async function apiSaveSkills(payload) {
  /* payload is the object { skills: [...] } returned by buildPayload().
     We unwrap and save just the array under the "skills" key. */
  const arr = Array.isArray(payload.skills) ? payload.skills : [];
  await MC.saveSection("skills", arr);
  return { skills_list: arr };  /* return shape matches old contract for callers */
}

async function apiLoadSkills() {
  /* loadSection returns the array as it was saved, or null if no
     section exists yet. Wrap in the legacy shape so the caller
     code (loadSavedSkills) doesn't need to change. */
  const arr = await MC.loadSection("skills");
  if (!Array.isArray(arr)) return null;
  return { skills_list: arr };
}

function buildPayload() {
  /* Phase 1 Step 3: the candidate is identified by auth.uid() server-side
     via the save_profile_section RPC — no candidate_id sent from the
     client. We just return the skills array (sanitized to canonical keys)
     and apiSaveSkills writes it to profiles.data.skills. */
  return {
    skills: skills.map(s => {
      const out = {
        name       : s.name,
        category   : s.category,
        proficiency: s.proficiency
      };
      if (s.customLabel) out.customLabel = s.customLabel;
      return out;
    })
  };
}

/* ============================================================
   SAVE & CONTINUE
   ============================================================ */

async function saveSkills() {
  if (skills.length < MIN_SKILLS) {
    showPopup(
      "Please add at least " + MIN_SKILLS +
      " skills before continuing to the next section."
    );
    return;
  }

  setLoading(saveSkillsBtn, true);

  try {
    await apiSaveSkills(buildPayload());
  } catch (err) {
    console.error("Skills save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(saveSkillsBtn, false);
    return;
  }

  localStorage.setItem("skills_completed", "yes");
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* Clear the Skills draft now that the server has the canonical copy. */
  if (window.SaveNow) SaveNow.clearDraft();

  /* Navigate parent dashboard to Your Certifications */
  window.parent.postMessage(
    {
      type      : "navigate",
      page      : "certifications.html",
      sidebarKey: "Your Certifications"
    },
    "*"
  );

  setTimeout(() => setLoading(saveSkillsBtn, false), 800);
}

/* ============================================================
   INIT — wire up on DOMContentLoaded
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  /* Allow Enter key in the skill-name field to trigger Add */
  skillNameInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSkill();
    }
  });

  /* Other category: show/hide the custom text input */
  skillCategory.addEventListener("change", () => {
    if (skillCategory.value === "Other") {
      skillCategoryOther.classList.remove("hidden");
      skillCategoryOther.focus();
    } else {
      skillCategoryOther.classList.add("hidden");
      skillCategoryOther.value = "";
    }
  });

  addSkillBtn.addEventListener("click", addSkill);
  saveSkillsBtn.addEventListener("click", saveSkills);

  /* Initial render — empty state */
  renderSkills();

  /* Load any previously saved skills from Supabase. Silent on first
     load — no toasts unless the user actively does something. */
  loadSavedSkills();

  /* Wire SaveNow. No formIds because the inputs are not in a <form>;
     containerSelector listens on the whole form-container so any input
     event triggers the silent-backup debounce. The actual canonical
     state lives in the in-memory skills array, which is captured by
     captureSkillsDraft. */
  SaveNow.init({
    pageName          : "skills",
    containerSelector : ".form-container",
    capturePayload    : captureSkillsDraft,
    restorePayload    : restoreSkillsDraft,
    apiSave           : (p) => apiSaveSkills(buildPayload()),
    isEmpty           : () => skills.length === 0
  });
});

/* ============================================================
   LOAD SAVED SKILLS FROM SUPABASE
   ============================================================
   Runs on page init. If the candidate has a saved row, populate
   the in-memory skills array and re-render. Errors are logged
   only — no scary toast on first page-load. */
async function loadSavedSkills() {
  if (!MC.candidateId) return;

  let row;
  try {
    row = await apiLoadSkills();
  } catch (err) {
    console.error("[skills] could not load saved skills:", err);
    return;
  }

  if (!row || !Array.isArray(row.skills_list) || row.skills_list.length === 0) {
    return;
  }

  /* Reset in-memory skills + assign fresh UIDs as we go. */
  skills = [];
  skillUid = 0;
  row.skills_list.forEach(s => {
    if (!s || !s.name || !s.category || !s.proficiency) return;
    const entry = {
      id          : ++skillUid,
      name        : s.name,
      category    : s.category,
      proficiency : s.proficiency
    };
    if (s.customLabel) entry.customLabel = s.customLabel;
    skills.push(entry);
  });
  renderSkills();
}
