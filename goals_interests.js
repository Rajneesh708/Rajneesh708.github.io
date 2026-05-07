/* ============================================================
   MECULS — goals_interests.js
   Your Goals & Interests section logic.

   Tag-picker fields:
   - howWeHelp     : "What are you primarily looking for?"
   - howHelpOthers : "How would you like to help others?"

   Both work identically:
   - User picks from a <select> dropdown
   - Selection appears as a removable coloured tag
   - "Other (please specify)" reveals a text input + Add button
   - Duplicate entries are silently ignored
   - Tags are stored in an array with stable uid for safe removal
   - Knowledge sub-block fires when "Share knowledge in any field"
     is among howHelpOthers tags

   No api.js. No alert(). No candidateId guard crash.
   All validation errors as centred scroll-independent popups.
   postMessage navigate to upload_photo_cv.html on save.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.GOALS_INTERESTS_VERSION
   If the value is "phase1-step3-render-fix" your browser has the new
   file loaded. If it's undefined, browser is still using the old file. */
window.GOALS_INTERESTS_VERSION = "phase1-step3-render-fix";

/* ── Config ──
   candidateId comes from MC.candidateId (mc_helpers.js). */
const candidateId    = MC.candidateId;

/* ── Helpers ──
   Most shared helpers come from mc_helpers.js (MC.* namespace).
   showConfirm is kept here because it's unique to this page
   (two-button popup, not used elsewhere). */
const $          = MC.$;
const trim       = MC.trim;
const showToast  = MC.showToast;
const setLoading = MC.setLoading;

/* showPopup is wrapped here because Goals & Interests uses a
   "secondary" button slot in its popup HTML that other pages
   don't have. We extend MC.showPopup with the reset behaviour. */
function showPopup(message) {
  const overlay   = $("errorPopupOverlay");
  const msg       = $("errorPopupMessage");
  const closeBtn  = $("errorPopupClose");
  const secondary = $("errorPopupSecondary");
  if (!overlay || !msg) return;
  msg.textContent = message;
  /* Reset to single-OK mode (in case a previous showConfirm left it in 2-btn state) */
  if (closeBtn) {
    closeBtn.textContent = "OK";
    closeBtn.classList.remove("hidden");
  }
  if (secondary) secondary.classList.add("hidden");
  overlay.classList.add("active");
  if (closeBtn) closeBtn.onclick = () => overlay.classList.remove("active");
  overlay.onclick = e => { if (e.target === overlay) overlay.classList.remove("active"); };
}

/* showConfirm — popup with two buttons.
   Primary (blue) is the "safe / go back" action.
   Secondary (grey) is the "continue anyway" action.
   Both close the popup before invoking their callbacks. */
function showConfirm(message, opts) {
  const overlay   = $("errorPopupOverlay");
  const msg       = $("errorPopupMessage");
  const primary   = $("errorPopupClose");
  const secondary = $("errorPopupSecondary");
  if (!overlay || !msg || !primary || !secondary) return;
  msg.textContent = message;
  primary.textContent   = (opts && opts.primaryLabel)   || "Go Back & Add";
  secondary.textContent = (opts && opts.secondaryLabel) || "Continue Anyway";
  primary.classList.remove("hidden");
  secondary.classList.remove("hidden");
  overlay.classList.add("active");
  primary.onclick = () => {
    overlay.classList.remove("active");
    if (opts && typeof opts.onPrimary === "function") opts.onPrimary();
  };
  secondary.onclick = () => {
    overlay.classList.remove("active");
    if (opts && typeof opts.onSecondary === "function") opts.onSecondary();
  };
  /* Click outside cancels (treats as primary / "go back") */
  overlay.onclick = e => {
    if (e.target === overlay) {
      overlay.classList.remove("active");
      if (opts && typeof opts.onPrimary === "function") opts.onPrimary();
    }
  };
}

/* Validators come from mc_helpers.js too. */
const isValidEmail        = MC.isValidEmail;
const isValidCountryCode  = MC.isValidCountryCode;
const isValidMobile       = MC.isValidMobile;

function parseKnowledgeFields(raw) { return raw.split(",").map(s=>trim(s)).filter(Boolean); }

/* ============================================================
   TAG PICKER WITH PER-TAG DESCRIPTION ACCORDION
   Used exclusively for howWeHelp field.

   Each selected option renders as a full-width .tag-row card:
   - Header: coloured pill + "Describe ▼" toggle + ✕ remove
   - Body:   textarea (max 300 chars) + char counter
   Toggle is RED when description is empty, GREEN when filled.
   Description is mandatory — validate() uses getMissingDescriptions().
   ============================================================ */

/* ── Contextual placeholder hints per goal option ── */
const TAG_PLACEHOLDERS = {
  "Seeking Full-time Employment":
    "e.g. Looking for a full-time product management role in fintech, ideally in Mumbai or remotely.",
  "Seeking Part-time / Consulting Work":
    "e.g. Available for 2–3 days/week consulting in supply chain strategy for mid-size manufacturers.",
  "Seeking Internship":
    "e.g. Final-year CS student looking for a 3-month internship in AI/ML research or product.",
  "Want to be a Freelancer":
    "e.g. Looking for freelance UI/UX design projects — branding, product design, or mobile apps.",
  "Seeking Professional Network":
    "e.g. Expanding my network in the renewable energy and cleantech space in India.",
  "Looking for a Mentor in My Field(s)":
    "e.g. Seeking a mentor with experience scaling D2C brands who can guide me 1–2 hours/month.",
  "Looking for Knowledge in Particular Field(s)":
    "e.g. Want to learn more about financial modelling and early-stage startup valuation.",
  "Wish to be an Entrepreneur":
    "e.g. Working on an idea in agri-tech and looking to connect with others on a similar journey.",
  "Looking for Co-founders / Business Partners":
    "e.g. Looking for a technical co-founder with backend experience for a B2B SaaS idea in HR tech.",
  "Looking for Investors for My Startup":
    "e.g. Seeking seed-stage investors for my healthtech startup — currently at prototype stage.",
  "Want to Collaborate on a Social / NGO Project":
    "e.g. Looking for collaborators to build a vocational training platform for rural youth.",
  "Seeking Mentorship":
    "e.g. Early-stage researcher looking for a mentor in climate science or environmental policy.",
  "Want to Pitch My Research / Innovation to Industry":
    "e.g. Have a validated water purification innovation — looking to connect with manufacturers.",
  "Want to Pitch My Research / Innovation to Government":
    "e.g. Developed a low-cost crop disease detection system and want to pitch to agricultural ministries.",
  "Seeking Agricultural Land on Lease (Organic Farming)":
    "e.g. Looking for 2–5 acres of farmable land near Pune for organic vegetable cultivation.",
  "Looking for Help in Plantation":
    "e.g. Organising a community plantation drive in Gurugram — need volunteers and saplings.",
  "Looking for Help in Protecting Trees & Nature":
    "e.g. Coordinating efforts to protect the Aravalli forest belt — need legal and volunteer support.",
  "Looking for Help in Reviving Water Bodies":
    "e.g. Working on reviving a seasonal lake in our village — need technical and community support.",
  "Looking for Help to Pursue My Hobbies & Passions":
    "e.g. Passionate about documentary filmmaking but don't know how to find collaborators or funding.",
  "Looking for Help in Managing Stress / Healthy Mental Health":
    "e.g. High-pressure career — looking for peer support, mindfulness guidance, or a community."
};

function getTagPlaceholder(value) {
  return TAG_PLACEHOLDERS[value] ||
    "Briefly describe what you are looking for here — be specific, it helps us match you better.";
}

function setupTagPickerWithDesc(config) {
  const sel        = $(config.selectId);
  const otherGroup = $(config.otherGroupId);
  const otherInput = $(config.otherInputId);
  const otherAdd   = $(config.otherAddId);
  const tagArea    = $(config.tagAreaId);
  if (!sel || !tagArea) return null;

  let entries = [];   /* { uid, value, isCustom, description } */
  let uid     = 0;

  /* ── Build one tag-row element ── */
  function buildRow(entry) {
    const row = document.createElement("div");
    row.className = "tag-row" + (entry.description ? " tag-row--filled" : "");
    row.dataset.uid = entry.uid;

    const pillClass = "tag-row__pill" + (entry.isCustom ? " tag-row__pill--custom" : "");
    const toggleClass = "tag-row__toggle" +
      (entry.description ? " tag-row__toggle--filled" : " tag-row__toggle--empty");
    const toggleLabel = entry.description ? "Edit details \u25BC" : "Add details \u25BC (required)";

    /* Header row: pill + toggle button + remove button.
       textContent on entry.value so user-typed pill names cannot
       carry HTML/JS. */
    const header = document.createElement("div");
    header.className = "tag-row__header";

    const pill = document.createElement("span");
    pill.className = pillClass;
    pill.textContent = entry.value;
    header.appendChild(pill);

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "tag-row__actions";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = toggleClass + " tag-row__toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = toggleLabel;
    actionsWrap.appendChild(toggle);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "tag-row__remove";
    removeBtn.title = "Remove this option";
    removeBtn.setAttribute("aria-label", "Remove " + entry.value);
    removeBtn.textContent = "\u2715";
    actionsWrap.appendChild(removeBtn);

    header.appendChild(actionsWrap);
    row.appendChild(header);

    /* Body — accordion with hint, textarea, counter. */
    const body = document.createElement("div");
    body.className = "tag-row__body" + (entry.description ? " open" : "");

    const hint = document.createElement("p");
    hint.className = "tag-row__desc-hint";
    hint.textContent =
      "Describe what you're looking for \u2014 the more specific you are, " +
      "the better your matches. (Required, max 300 characters.)";
    body.appendChild(hint);

    /* Textarea — user content goes in via .value (safe), not innerHTML. */
    const ta = document.createElement("textarea");
    ta.maxLength = 300;
    ta.placeholder = getTagPlaceholder(entry.value);
    ta.value = entry.description || "";
    body.appendChild(ta);

    const counter = document.createElement("div");
    counter.className = "char-counter-out";
    counter.textContent = (entry.description || "").length + " / 300";
    body.appendChild(counter);

    row.appendChild(body);

    /* ── Wire event handlers ── */
    function updateToggleLabel() {
      const open   = body.classList.contains("open");
      const filled = !!entry.description;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.className = "tag-row__toggle" + (filled ? " tag-row__toggle--filled" : " tag-row__toggle--empty");
      if (filled) {
        toggle.textContent = open ? "Edit details \u25B2" : "Edit details \u25BC";
      } else {
        toggle.textContent = open ? "Add details \u25B2 (required)" : "Add details \u25BC (required)";
      }
    }

    toggle.addEventListener("click", () => {
      body.classList.toggle("open");
      updateToggleLabel();
    });

    /* Textarea input — update entry + toggle colour + filled class */
    ta.addEventListener("input", () => {
      entry.description = ta.value.trim();
      counter.textContent = ta.value.length + " / 300";
      row.classList.toggle("tag-row--filled", !!entry.description);
      updateToggleLabel();
    });

    /* Remove button */
    removeBtn.addEventListener("click", () => {
      entries = entries.filter(e => e.uid !== entry.uid);
      render();
      if (config.onchange) config.onchange(entries.map(e => e.value));
    });

    return row;
  }

  /* ── Render all rows ── */
  function render() {
    /* Wipe ONLY tag rows; preserve external tagsEmpty span if it lives
       inside tagArea (its visibility is controlled by show/hide). */
    [...tagArea.querySelectorAll(".tag-row")].forEach(n => n.remove());

    if (entries.length === 0) {
      /* Show empty-state UNLESS Other-input is currently open. */
      const otherOpen = otherGroup && !otherGroup.classList.contains("hidden");
      if (tagsEmpty) {
        if (otherOpen) tagsEmpty.classList.add("hidden");
        else           tagsEmpty.classList.remove("hidden");
      } else if (!tagArea.querySelector(".tag-area__empty")) {
        /* Legacy fallback: no external empty-state span — create one. */
        const empty = document.createElement("span");
        empty.className = "tag-area__empty";
        empty.textContent = "No options selected yet.";
        tagArea.appendChild(empty);
      }
    } else {
      /* Have tags — hide external empty-state if present. */
      if (tagsEmpty) tagsEmpty.classList.add("hidden");
      /* Remove any auto-created legacy empty-state span. */
      const legacyEmpty = tagArea.querySelector(".tag-area__empty:not([id])");
      if (legacyEmpty) legacyEmpty.remove();
    }

    entries.forEach(entry => tagArea.appendChild(buildRow(entry)));
    if (config.onchange) config.onchange(entries.map(e => e.value));
  }

  /* ── Add a value ── */
  function addValue(value, isCustom) {
    value = (value || "").trim();
    if (!value) return false;
    if (entries.some(e => e.value.toLowerCase() === value.toLowerCase())) return false;
    const entry = { uid: ++uid, value, isCustom: !!isCustom, description: "" };
    entries.push(entry);
    /* Auto-open the description accordion on the new row */
    render();
    /* Find the new row and open its body */
    const newRow = tagArea.querySelector(`[data-uid="${entry.uid}"]`);
    if (newRow) {
      const body   = newRow.querySelector(".tag-row__body");
      const toggle = newRow.querySelector(".tag-row__toggle");
      if (body)   body.classList.add("open");
      if (toggle) {
        toggle.textContent = "Add details ▲ (required)";
        toggle.setAttribute("aria-expanded", "true");
      }
      const ta = newRow.querySelector("textarea");
      if (ta) setTimeout(() => ta.focus(), 80);
    }
    if (config.onchange) config.onchange(entries.map(e => e.value));
    return true;
  }

  /* ── Other-input config: extra elements (Cancel button, empty-state span,
       counter, hint) are looked up here. They're optional — older callers
       that don't pass these IDs still work. ── */
  const otherCancel = config.otherCancelId  ? $(config.otherCancelId)  : null;
  const otherCounter= config.otherCounterId ? $(config.otherCounterId) : null;
  const tagsEmpty   = config.tagsEmptyId    ? $(config.tagsEmptyId)    : null;

  /* Show Other-input row, hide empty-state line, focus input */
  function openOtherInput() {
    if (otherGroup) otherGroup.classList.remove("hidden");
    if (tagsEmpty)  tagsEmpty.classList.add("hidden");
    if (otherInput) {
      otherInput.value = "";
      updateOtherCounter();
      setTimeout(() => otherInput.focus(), 50);
    }
  }

  /* Hide Other-input row, restore empty-state if no tags */
  function closeOtherInput() {
    if (otherGroup) otherGroup.classList.add("hidden");
    if (otherInput) otherInput.value = "";
    updateOtherCounter();
    /* Empty-state visibility: show only when entries are empty */
    if (tagsEmpty) {
      if (entries.length === 0) tagsEmpty.classList.remove("hidden");
      else                      tagsEmpty.classList.add("hidden");
    }
    /* Reset the dropdown so the user can pick again */
    if (sel) sel.value = "";
  }

  /* Live update the (n / 100) counter as user types */
  function updateOtherCounter() {
    if (!otherInput || !otherCounter) return;
    const len = otherInput.value.length;
    const max = otherInput.maxLength > 0 ? otherInput.maxLength : 100;
    otherCounter.textContent = len + " / " + max;
    otherCounter.classList.toggle("char-counter-out--warn",  len >= max * 0.8 && len < max);
    otherCounter.classList.toggle("char-counter-out--limit", len >= max);
  }

  /* ── Dropdown ── */
  sel.addEventListener("change", () => {
    const val = sel.value;
    if (!val) return;
    if (val === "__other__") {
      /* Keep dropdown displaying "Other (please specify)" — do NOT reset */
      openOtherInput();
      return;
    }
    /* If user picks a regular option while Other-input is open, cancel Other first */
    if (otherGroup && !otherGroup.classList.contains("hidden")) {
      closeOtherInput();
    }
    addValue(val, false);
    sel.value = "";
  });

  /* ── Other add ── */
  function addOtherValue() {
    const val = otherInput ? (otherInput.value || "").trim() : "";
    if (!val) {
      if (otherInput) otherInput.focus();
      return;
    }
    const added = addValue(val, true);
    /* Whether we added a new tag or it was a duplicate, close the input
       row — the user clearly tried to commit. closeOtherInput() resets
       the dropdown, hides the input, and restores empty-state if needed. */
    closeOtherInput();
    if (!added && otherInput) {
      /* If duplicate, surface a brief hint via toast; calling code may
         show it, otherwise we silently no-op. */
    }
  }
  if (otherAdd)    otherAdd.addEventListener("click", addOtherValue);
  if (otherCancel) otherCancel.addEventListener("click", closeOtherInput);
  if (otherInput) {
    otherInput.addEventListener("keydown", e => {
      if (e.key === "Enter")    { e.preventDefault(); addOtherValue();    }
      if (e.key === "Escape")   { e.preventDefault(); closeOtherInput();  }
    });
    otherInput.addEventListener("input", updateOtherCounter);
  }

  /* ── Public API ── */
  return {
    getValues()  { return entries.map(e => e.value); },
    getEntriesWithDesc() {
      return entries.map(e => ({ value: e.value, description: e.description }));
    },
    getMissingDescriptions() {
      return entries.filter(e => !e.description).map(e => e.value);
    },
    openFirstEmpty() {
      const first = entries.find(e => !e.description);
      if (!first) return;
      const row = tagArea.querySelector(`[data-uid="${first.uid}"]`);
      if (!row) return;
      const body   = row.querySelector(".tag-row__body");
      const toggle = row.querySelector(".tag-row__toggle");
      if (body)   body.classList.add("open");
      if (toggle) {
        toggle.textContent = "Add details ▲ (required)";
        toggle.setAttribute("aria-expanded", "true");
      }
      const ta = row.querySelector("textarea");
      if (ta) { row.scrollIntoView({ behavior:"smooth", block:"center" }); setTimeout(() => ta.focus(), 300); }
    },
    reset() {
      entries = [];
      if (otherGroup) otherGroup.classList.add("hidden");
      if (otherInput) otherInput.value = "";
      if (sel) sel.value = "";
      updateOtherCounter();
      render();
    },
    setValues(vals) {
      if (!vals || !vals.length) return;
      const presetOptions = [...sel.options].map(o => o.value).filter(v => v && v !== "__other__");
      vals.forEach(item => {
        /* item may be string or {value, description} */
        const val  = typeof item === "string" ? item : item.value;
        const desc = typeof item === "object"  ? (item.description || "") : "";
        const isCustom = !presetOptions.includes(val);
        if (!val) return;
        if (entries.some(e => e.value.toLowerCase() === val.toLowerCase())) return;
        entries.push({ uid: ++uid, value: val, isCustom, description: desc });
      });
      if (otherGroup && entries.some(e => e.isCustom)) otherGroup.classList.remove("hidden");
      render();
    }
  };
}

/* ============================================================
   GENERIC TAG PICKER CONTROLLER
   ============================================================

   config = {
     selectId     : id of the <select> dropdown
     otherGroupId : id of the Other input wrapper div
     otherInputId : id of the Other text input
     otherAddId   : id of the Other "Add" button
     tagAreaId    : id of the tags display div
     tagClass     : CSS class for tags (e.g. "goal-tag")
     onchange     : optional callback(values[]) after any change
   }
*/

function setupTagPicker(config) {
  const sel        = $(config.selectId);
  const otherGroup = $(config.otherGroupId);
  const otherInput = $(config.otherInputId);
  const otherAdd   = $(config.otherAddId);
  const tagArea    = $(config.tagAreaId);
  if (!sel || !tagArea) return null;

  let entries = [];   /* { uid, value, isCustom } */
  let uid     = 0;

  /* ── Optional Other-input extras (Cancel/counter/empty-state span) ── */
  const otherCancel  = config.otherCancelId  ? $(config.otherCancelId)  : null;
  const otherCounter = config.otherCounterId ? $(config.otherCounterId) : null;
  const tagsEmpty    = config.tagsEmptyId    ? $(config.tagsEmptyId)    : null;

  /* Show Other-input row, hide empty-state line, focus input */
  function openOtherInput() {
    if (otherGroup) otherGroup.classList.remove("hidden");
    if (tagsEmpty)  tagsEmpty.classList.add("hidden");
    if (otherInput) {
      otherInput.value = "";
      updateOtherCounter();
      setTimeout(() => otherInput.focus(), 50);
    }
  }

  /* Hide Other-input row, restore empty-state if no tags, reset dropdown */
  function closeOtherInput() {
    if (otherGroup) otherGroup.classList.add("hidden");
    if (otherInput) otherInput.value = "";
    updateOtherCounter();
    if (tagsEmpty) {
      if (entries.length === 0) tagsEmpty.classList.remove("hidden");
      else                      tagsEmpty.classList.add("hidden");
    }
    if (sel) sel.value = "";
  }

  /* Live counter update */
  function updateOtherCounter() {
    if (!otherInput || !otherCounter) return;
    const len = otherInput.value.length;
    const max = otherInput.maxLength > 0 ? otherInput.maxLength : 100;
    otherCounter.textContent = len + " / " + max;
    otherCounter.classList.toggle("char-counter-out--warn",  len >= max * 0.8 && len < max);
    otherCounter.classList.toggle("char-counter-out--limit", len >= max);
  }

  /* ── Render all tags ── */
  function render() {
    /* Wipe ONLY tag elements. config.tagClass may be a multi-class
       string like "goal-tag goal-tag--help". Concatenating ".+that"
       builds a CSS DESCENDANT selector that matches nothing, leaving
       stale tag DOM behind on every render. Take only the first class
       token to get a correct simple selector. (Phase 1 Step 3 fix.) */
    var firstClass = (config.tagClass || "goal-tag").split(/\s+/)[0];
    [...tagArea.querySelectorAll("." + firstClass)].forEach(n => n.remove());

    if (entries.length === 0) {
      const otherOpen = otherGroup && !otherGroup.classList.contains("hidden");
      if (tagsEmpty) {
        if (otherOpen) tagsEmpty.classList.add("hidden");
        else           tagsEmpty.classList.remove("hidden");
      } else if (!tagArea.querySelector(".tag-area__empty")) {
        const empty = document.createElement("span");
        empty.className = "tag-area__empty";
        empty.textContent = "No options selected yet.";
        tagArea.appendChild(empty);
      }
      if (config.onchange) config.onchange([]);
      return;
    }

    /* Have tags — hide external empty-state if any, remove legacy auto-created one */
    if (tagsEmpty) tagsEmpty.classList.add("hidden");
    const legacyEmpty = tagArea.querySelector(".tag-area__empty:not([id])");
    if (legacyEmpty) legacyEmpty.remove();

    entries.forEach(entry => {
      const tag = document.createElement("span");
      const customClass = entry.isCustom ? " goal-tag--custom" : "";
      tag.className = (config.tagClass || "goal-tag") + customClass;

      /* Tag label — textContent on entry.value (user-supplied for
         custom tags; even predefined tags should not bypass escaping). */
      const labelEl = document.createElement("span");
      labelEl.textContent = entry.value;
      tag.appendChild(labelEl);

      /* Remove button — uses closure over entry.uid, no string-attribute
         round-trip. */
      const removeBtn = document.createElement("button");
      removeBtn.className = "goal-tag__remove";
      removeBtn.title = "Remove";
      removeBtn.textContent = "\u2715";
      removeBtn.addEventListener("click", () => {
        entries = entries.filter(e => e.uid !== entry.uid);
        render();
      });
      tag.appendChild(removeBtn);

      tagArea.appendChild(tag);
    });

    if (config.onchange) config.onchange(entries.map(e => e.value));
  }

  /* ── Add a value (checks duplicates) ── */
  function addValue(value, isCustom) {
    value = trim(value);
    if (!value) return false;
    if (entries.some(e => e.value.toLowerCase() === value.toLowerCase())) return false; /* duplicate */
    entries.push({ uid: ++uid, value, isCustom: !!isCustom });
    render();
    return true;
  }

  /* ── Dropdown change ── */
  sel.addEventListener("change", () => {
    const val = sel.value;
    if (!val) return;

    if (val === "__other__") {
      /* Keep dropdown displaying "Other (please specify)" — do NOT reset */
      openOtherInput();
      return;
    }

    /* Picking a regular option while Other-input is open cancels Other first */
    if (otherGroup && !otherGroup.classList.contains("hidden")) {
      closeOtherInput();
    }

    addValue(val, false);
    sel.value = ""; /* reset dropdown so same option can be viewed again */
  });

  /* ── Other: Add button ── */
  function addOtherValue() {
    const val = trim(otherInput.value);
    if (!val) {
      otherInput.focus();
      return;
    }
    addValue(val, true);
    closeOtherInput();
  }

  if (otherAdd)    otherAdd.addEventListener("click", addOtherValue);
  if (otherCancel) otherCancel.addEventListener("click", closeOtherInput);
  if (otherInput) {
    otherInput.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); addOtherValue();    }
      if (e.key === "Escape") { e.preventDefault(); closeOtherInput();  }
    });
    otherInput.addEventListener("input", updateOtherCounter);
  }

  /* ── Public API ── */
  return {
    getValues()  { return entries.map(e => e.value); },
    hasKnowledge(){ return entries.some(e => e.value === "Share knowledge in any field"); },
    reset() {
      entries = [];
      if (otherGroup) otherGroup.classList.add("hidden");
      if (otherInput) otherInput.value = "";
      if (sel) sel.value = "";
      updateOtherCounter();
      render();
    },
    setValues(vals) {
      if (!vals || !vals.length) return;
      /* Known preset options vs custom */
      const presetOptions = [...sel.options].map(o => o.value)
        .filter(v => v && v !== "__other__");
      vals.forEach(val => {
        const isCustom = !presetOptions.includes(val);
        addValue(val, isCustom);
      });
      /* Show Other group if any custom entries */
      if (otherGroup && vals.some(v => !presetOptions.includes(v))) {
        otherGroup.classList.remove("hidden");
      }
    }
  };
}

/* ============================================================
   DRAFT CAPTURE / RESTORE / MIGRATION
   The actual auto-save engine lives in save_now.js.
   This block provides:
     - capturePayload()   — gathers form state into a draft object
     - restorePayload()   — restores a draft back into form fields
     - migrateLegacyDraft() — one-shot migration from the old
       gi_draft_<candidateId> key to the new schema, so existing
       testing data isn't lost.
   ============================================================ */

/* Capture current form state — used by SaveNow.capturePayload */
function captureGoalsDraft() {
  return {
    heardAboutUs       : $("heardAboutUs")     ? $("heardAboutUs").value     : "",
    isReferred         : $("isReferred")        ? $("isReferred").value        : "",
    connectionConsent  : $("connectionConsent") ? $("connectionConsent").value : "",
    wouldHelpOthers    : $("wouldHelpOthers")   ? $("wouldHelpOthers").value   : "",
    referrerName       : $("referrerName")       ? $("referrerName").value      : "",
    referrerEmail      : $("referrerEmail")      ? $("referrerEmail").value     : "",
    referrerCountryCode: $("referrerCountryCode") ? $("referrerCountryCode").value : "",
    referrerMobile     : $("referrerMobile")     ? $("referrerMobile").value    : "",
    knowledgeFields    : $("knowledgeFields")    ? $("knowledgeFields").value   : "",
    knowledgeFree      : $("knowledgeFree")      ? $("knowledgeFree").value     : "",
    howWeHelp          : howWeHelpCtrl     ? howWeHelpCtrl.getEntriesWithDesc()  : [],
    howHelpOthers      : howHelpOthersCtrl ? howHelpOthersCtrl.getValues()       : []
  };
}

/* Restore form state from a draft — used by SaveNow.restorePayload */
function restoreGoalsDraft(d) {
  if (!d) return false;
  if (d.heardAboutUs       && $("heardAboutUs"))      $("heardAboutUs").value      = d.heardAboutUs;
  if (d.isReferred         && $("isReferred"))         $("isReferred").value         = d.isReferred;
  if (d.connectionConsent  && $("connectionConsent"))  $("connectionConsent").value  = d.connectionConsent;
  if (d.wouldHelpOthers    && $("wouldHelpOthers"))    $("wouldHelpOthers").value    = d.wouldHelpOthers;

  if ($("isReferred"))         $("isReferred").dispatchEvent(new Event("change"));
  if ($("wouldHelpOthers"))    $("wouldHelpOthers").dispatchEvent(new Event("change"));
  if ($("connectionConsent"))  $("connectionConsent").dispatchEvent(new Event("change"));

  if (d.referrerName        && $("referrerName"))        $("referrerName").value        = d.referrerName;
  if (d.referrerEmail       && $("referrerEmail"))       $("referrerEmail").value       = d.referrerEmail;
  if (d.referrerCountryCode && $("referrerCountryCode")) $("referrerCountryCode").value = d.referrerCountryCode;
  if (d.referrerMobile      && $("referrerMobile"))      $("referrerMobile").value      = d.referrerMobile;
  if (d.knowledgeFields     && $("knowledgeFields"))     $("knowledgeFields").value     = d.knowledgeFields;
  if (d.knowledgeFree       && $("knowledgeFree"))       $("knowledgeFree").value       = d.knowledgeFree;

  if (d.howWeHelp     && Array.isArray(d.howWeHelp)     && howWeHelpCtrl)
    howWeHelpCtrl.setValues(d.howWeHelp);
  if (d.howHelpOthers && Array.isArray(d.howHelpOthers) && howHelpOthersCtrl)
    howHelpOthersCtrl.setValues(d.howHelpOthers);

  return true;
}

/* ── One-shot migration from the legacy gi_draft_<candidateId> key
     to the new meculs_draft_v1_<candidateId>_goals_interests key.
     Runs once at page load. Removes the old key after migrating. */
function migrateLegacyDraft() {
  if (!candidateId) return;
  const legacyKey = "gi_draft_" + candidateId;
  let legacyRaw;
  try {
    legacyRaw = localStorage.getItem(legacyKey);
  } catch (err) { return; }
  if (!legacyRaw) return;

  let legacyData;
  try {
    legacyData = JSON.parse(legacyRaw);
  } catch (err) {
    /* Legacy data is corrupt — just delete the old key */
    try { localStorage.removeItem(legacyKey); } catch (e) {}
    return;
  }

  /* Build a v1 envelope and write it under the new key.
     Only do this if the new key doesn't already exist (the new
     key wins if both are present). */
  const newKey   = "meculs_draft_v1_" + candidateId + "_goals_interests";
  const newTsKey = newKey + "__ts";
  let alreadyExists = false;
  try {
    alreadyExists = localStorage.getItem(newKey) != null;
  } catch (err) { /* ignore */ }

  if (!alreadyExists) {
    const envelope = {
      _meta: {
        schemaVersion : 1,
        savedAt       : new Date().toISOString(),
        pageName      : "goals_interests",
        scope         : null,
        candidateId   : candidateId,
        migratedFrom  : "gi_draft_v0"
      },
      payload: legacyData
    };
    try {
      localStorage.setItem(newKey,   JSON.stringify(envelope));
      localStorage.setItem(newTsKey, envelope._meta.savedAt);
    } catch (err) {
      console.warn("[goals_interests] migration write failed:", err);
      return;
    }
  }

  /* Migration complete — remove the old key */
  try { localStorage.removeItem(legacyKey); } catch (e) {}
}

/* ============================================================
   MATCHING PREVIEW NOTE
   Updates a bottom-of-form note as the user fills in their goals,
   giving them a sense of what kind of matches they'll receive.
   ============================================================ */

function updateMatchingPreview(selectedValues) {
  const el = $("matchingPreviewNote");
  if (!el) return;
  const textEl = el.querySelector(".matching-preview-note__text");
  if (!textEl) return;

  if (!selectedValues || selectedValues.length === 0) {
    textEl.textContent = "Complete this section and we'll start finding the right people for you.";
    return;
  }

  const count = selectedValues.length;
  const first = selectedValues[0];

  /* Build a conversational summary */
  let msg = "";
  if (count === 1) {
    msg = `Based on your selection, we'll look for people in our network who can help with: ${first}.`;
  } else if (count === 2) {
    msg = `Based on your ${count} selections, we'll match you with people who can help with ${first} and ${selectedValues[1]}.`;
  } else {
    msg = `Great — based on your ${count} selections, we'll match you across multiple areas. The more specific your descriptions below, the better your matches.`;
  }
  textEl.textContent = msg;
}

/* ============================================================
   MODULE-LEVEL CONTROLLERS
   ============================================================ */

let howWeHelpCtrl     = null;
let howHelpOthersCtrl = null;

/* ── Show/hide the consent reassurance note based on the selected
   value. Hidden when user picks "No, I do not give my consent at
   this time"; shown otherwise (default-empty state or "Yes"). ── */
function refreshConsentNote() {
  const sel  = $("connectionConsent");
  const note = $("consentHelperNote");
  if (!sel || !note) return;
  if (sel.value === "No") note.classList.add("hidden");
  else                    note.classList.remove("hidden");
}

/* ============================================================
   DEPENDENCIES
   ============================================================ */

function setupDependencies() {

  /* isReferred */
  $("isReferred").addEventListener("change", () => {
    const isYes = $("isReferred").value === "Yes";
    $("referralBlock").classList.toggle("hidden", !isYes);
    if (!isYes) {
      $("referrerName").value        = "";
      $("referrerEmail").value       = "";
      $("referrerCountryCode").value = "+91";
      $("referrerMobile").value      = "";
    } else {
      if (!trim($("referrerCountryCode").value))
        $("referrerCountryCode").value = "+91";
    }
  });

  /* wouldHelpOthers */
  $("wouldHelpOthers").addEventListener("change", () => {
    const isYes = $("wouldHelpOthers").value === "Yes";
    $("helpOthersBlock").classList.toggle("hidden", !isYes);
    if (!isYes) {
      if (howHelpOthersCtrl) howHelpOthersCtrl.reset();
      $("knowledgeBlock").classList.add("hidden");
      $("knowledgeFields").value = "";
      $("knowledgeFree").value   = "";
    }
  });

  /* connectionConsent — hide reassurance helper text when user
     selects "No". Note stays visible in default (empty) state and
     when "Yes" is selected, since it helps the user decide. */
  $("connectionConsent").addEventListener("change", () => {
    refreshConsentNote();
  });
  /* Set initial visibility on page load. */
  refreshConsentNote();

  /* Auto-save on any top-level field change */
  ["heardAboutUs", "referrerName", "referrerEmail",
   "referrerCountryCode", "referrerMobile", "knowledgeFields", "knowledgeFree"].forEach(id => {
    const el = $(id);
  });

  /* howWeHelp tag picker — with per-tag description accordion */
  howWeHelpCtrl = setupTagPickerWithDesc({
    selectId      : "howWeHelpSelect",
    otherGroupId  : "howWeHelpOtherGroup",
    otherInputId  : "howWeHelpOther",
    otherAddId    : "howWeHelpOtherAdd",
    otherCancelId : "howWeHelpOtherCancel",
    otherCounterId: "howWeHelpOtherCounter",
    tagAreaId     : "howWeHelpTags",
    tagsEmptyId   : "howWeHelpTagsEmpty",
    onchange(values) {
      updateMatchingPreview(values);
    }
  });

  /* howHelpOthers tag picker + knowledge block trigger */
  howHelpOthersCtrl = setupTagPicker({
    selectId      : "howHelpOthersSelect",
    otherGroupId  : "howHelpOthersOtherGroup",
    otherInputId  : "howHelpOthersOther",
    otherAddId    : "howHelpOthersOtherAdd",
    otherCancelId : "howHelpOthersOtherCancel",
    otherCounterId: "howHelpOthersOtherCounter",
    tagAreaId     : "howHelpOthersTags",
    tagsEmptyId   : "howHelpOthersTagsEmpty",
    tagClass      : "goal-tag goal-tag--help",
    onchange(values) {
      const hasKnowledge = values.includes("Share knowledge in any field");
      $("knowledgeBlock").classList.toggle("hidden", !hasKnowledge);
      if (!hasKnowledge) {
        $("knowledgeFields").value = "";
        $("knowledgeFree").value   = "";
      }
    }
  });
}

/* ============================================================
   VALIDATE
   ============================================================ */

function validate() {
  const referred   = $("isReferred").value;
  const helpOthers = $("wouldHelpOthers").value;

  /* Collect ALL missing fields (with field-specific names) so the user
     gets one popup listing everything instead of "Please fill this section
     first." (the old generic message that gave no clue WHICH field). */
  const missing = [];
  if (!$("heardAboutUs").value)      missing.push("How did you hear about us?");
  if (!referred)                     missing.push("Were you referred to us?");
  if (!$("connectionConsent").value) missing.push("Do you consent to be connected with others?");

  /* Referral fields — only required when user said "Yes" they were referred. */
  if (referred === "Yes") {
    if (!trim($("referrerName").value))  missing.push("Referrer's Name");
    const email = trim($("referrerEmail").value);
    if (!email) missing.push("Referrer's Email");
    /* If user has typed an email but it's invalid, flag THAT specifically
       (not as "missing"). We separate format errors from missing errors. */
    const code = trim($("referrerCountryCode").value);
    if (!code) missing.push("Referrer's Country Code");
    const mobile = trim($("referrerMobile").value);
    if (!mobile) missing.push("Referrer's Mobile Number");
  }

  if (!helpOthers) missing.push("Would you help others?");

  /* Help-others "Share knowledge" sub-fields are required only when that
     specific tag is selected. */
  let needKnowledgeFields = false;
  if (helpOthers === "Yes") {
    const hhVals = howHelpOthersCtrl ? howHelpOthersCtrl.getValues() : [];
    if (hhVals.includes("Share knowledge in any field")) {
      needKnowledgeFields = true;
      const fields = parseKnowledgeFields($("knowledgeFields").value);
      if (fields.length === 0)         missing.push("Knowledge Fields (at least one)");
      if (!$("knowledgeFree").value)   missing.push("Are you willing to share knowledge for free?");
    }
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

  /* "What are you primarily looking for?" tag descriptions: each selected
     tag still needs a description. Even though the picker itself is
     non-mandatory, ANY selected tag must have its description filled. */
  if (howWeHelpCtrl) {
    const missingDesc = howWeHelpCtrl.getMissingDescriptions();
    if (missingDesc.length > 0) {
      showPopup(
        "Please describe what you are looking for in: \"" + missingDesc[0] + "\"." +
        (missingDesc.length > 1 ? " (and " + (missingDesc.length-1) + " more)" : "")
      );
      howWeHelpCtrl.openFirstEmpty();
      return false;
    }
  }

  /* Format-specific errors for referral fields — checked AFTER the
     missing-list is empty so they only fire on real format problems. */
  if (referred === "Yes") {
    const email = trim($("referrerEmail").value);
    if (email && !isValidEmail(email)) {
      showPopup("Please enter a valid email address for the referrer.");
      $("referrerEmail").focus();
      return false;
    }
    const code = trim($("referrerCountryCode").value);
    if (code && !isValidCountryCode(code)) {
      showPopup("Please enter a valid country code (e.g. +91, +1).");
      $("referrerCountryCode").focus();
      return false;
    }
    const mobile = trim($("referrerMobile").value);
    if (mobile && !isValidMobile(mobile)) {
      showPopup("Please enter a valid mobile number for the referrer.");
      $("referrerMobile").focus();
      return false;
    }
  }

  /* Knowledge fields format check — only when relevant. */
  if (needKnowledgeFields) {
    const fields = parseKnowledgeFields($("knowledgeFields").value);
    if (fields.length > 5) {
      showPopup("You can mention up to 5 knowledge fields. Please reduce the number of entries.");
      $("knowledgeFields").focus();
      return false;
    }
  }

  return true;
}

/* ============================================================
   BUILD PAYLOAD
   ============================================================ */

function buildPayload() {
  const referred   = $("isReferred").value;
  const helpOthers = $("wouldHelpOthers").value;
  const hwVals     = howWeHelpCtrl     ? howWeHelpCtrl.getValues()     : [];
  const hhVals     = howHelpOthersCtrl ? howHelpOthersCtrl.getValues() : [];
  const hasKnow    = hhVals.includes("Share knowledge in any field");

  return {
    heard_about_us      : $("heardAboutUs").value,
    is_referred         : referred,
    connection_consent  : $("connectionConsent").value,
    referrer          : referred === "Yes" ? {
      name        : trim($("referrerName").value),
      email       : trim($("referrerEmail").value),
      country_code: trim($("referrerCountryCode").value),
      mobile      : trim($("referrerMobile").value)
    } : null,
    how_we_help       : howWeHelpCtrl ? howWeHelpCtrl.getEntriesWithDesc() : [],
    would_help_others : helpOthers,
    how_help_others   : helpOthers === "Yes" ? hhVals : [],
    knowledge_fields  : (helpOthers === "Yes" && hasKnow)
                        ? parseKnowledgeFields($("knowledgeFields").value) : null,
    knowledge_for_free: (helpOthers === "Yes" && hasKnow)
                        ? $("knowledgeFree").value : null
  };
}

/* ============================================================
   API — Supabase
   ============================================================
   Phase 1 Step 3: writes to profiles.data JSONB via MC.saveSection
   (not the dropped goals_interests table). */

async function apiSaveGoals(payload) {
  return await MC.saveSection("goals_interests", payload || {});
}

async function apiLoadGoals() {
  const data = await MC.loadSection("goals_interests");
  return data || {};
}

/* ============================================================
   SAVE & CONTINUE
   ============================================================ */

async function saveContinue() {
  if (!validate()) return;
  const btn = $("saveContinueBtn");
  setLoading(btn, true);
  try {
    await apiSaveGoals(buildPayload());
  } catch (err) {
    console.error("Goals save failed:", err);
    showToast("Could not save to server. Please try again.", "error");
    setLoading(btn, false);
    return;
  }
  localStorage.setItem("goals_completed", "yes");
  localStorage.setItem("profile_last_updated", new Date().toLocaleDateString("en-US"));
  SaveNow.clearDraft();
  window.parent.postMessage(
    { type:"navigate", page:"upload_photo_cv.html", sidebarKey:"Upload Photo & CV" }, "*"
  );
  setTimeout(() => setLoading(btn, false), 800);
}

/* ============================================================
   LOAD EXISTING DATA
   ============================================================ */

async function loadGoals() {
  if (!MC.candidateId) return false;
  try {
    const data = await apiLoadGoals();
    /* New shape: data is the JSONB section payload itself, not a row
       with candidate_id. An empty profile returns {}. */
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) return false;

    if (data.heard_about_us)      $("heardAboutUs").value      = data.heard_about_us;
    if (data.is_referred)         $("isReferred").value         = data.is_referred;
    if (data.connection_consent)  $("connectionConsent").value  = data.connection_consent;
    if (data.would_help_others)   $("wouldHelpOthers").value    = data.would_help_others;

    $("isReferred").dispatchEvent(new Event("change"));
    $("wouldHelpOthers").dispatchEvent(new Event("change"));
    $("connectionConsent").dispatchEvent(new Event("change"));

    if (data.how_we_help && Array.isArray(data.how_we_help) && howWeHelpCtrl)
      howWeHelpCtrl.setValues(data.how_we_help);

    if (data.referrer) {
      $("referrerName").value        = data.referrer.name         || "";
      $("referrerEmail").value       = data.referrer.email        || "";
      $("referrerCountryCode").value = data.referrer.country_code || "+91";
      $("referrerMobile").value      = data.referrer.mobile       || "";
    }

    if (data.how_help_others && Array.isArray(data.how_help_others) && howHelpOthersCtrl)
      howHelpOthersCtrl.setValues(data.how_help_others);

    if (data.knowledge_fields && data.knowledge_fields.length)
      $("knowledgeFields").value = data.knowledge_fields.join(", ");
    if (data.knowledge_for_free)
      $("knowledgeFree").value = data.knowledge_for_free;

    /* GI-2: Restore Researcher / Innovator block (gi_ri_type + gi_ri_entries).
       Without this, the in-memory giRiEntries array stayed empty after a
       page reload, and the NEXT Save & Continue would call buildPayloadWithGIRI()
       which writes giRiEntries.map(...) — i.e. an empty array — silently
       OVERWRITING the user's saved entries. Critical data-loss fix.

       The save-shape uses sub_type (snake_case), in-memory uses subType. */
    if (data.gi_ri_type && $("gi_riType")) {
      $("gi_riType").value = data.gi_ri_type;
      /* Trigger change so the form card / labels reveal correctly. */
      $("gi_riType").dispatchEvent(new Event("change"));
    }
    if (Array.isArray(data.gi_ri_entries) && data.gi_ri_entries.length > 0) {
      giRiEntries = data.gi_ri_entries.map(function (e) {
        return {
          uid    : ++giRiUid,
          type   : e.type    || "",
          domain : e.domain  || "",
          subType: e.sub_type || e.subType || "",
          skills : e.skills  || "",
          about  : e.about   || ""
        };
      });
      renderGIRIEntries();
    }

    return true;
  } catch (err) {
    console.error("Could not load goals & interests:", err);
    return false;
  }
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  setupDependencies();

  /* Initialise the Researcher / Innovator block (GI_RI) and bind the
     save-and-continue handler in ONE place. The GI/RI-aware handler
     below supersedes the plain saveContinue() by calling the extended
     validators/builders when the RI card is active, and falls through
     to the same behaviour (save → navigate to upload_photo_cv) when
     it isn't. */
  setupGIRITypeSelector();
  hookGIRIIntoTagPicker();
  bindSaveContinue();

  /* One-shot migration: read the legacy gi_draft_<candidateId> key
     (pre-Save-Now era) and rewrite it under the new schema so the
     restore banner can pick it up. */
  migrateLegacyDraft();

  /* ── Wire the shared Save Now / draft-restore engine ──
     Goals & Interests has no <form> element (cards are direct
     children of .form-container), so we use containerSelector. */
  SaveNow.init({
    pageName         : "goals_interests",
    containerSelector: ".form-container",

    capturePayload : () => captureGoalsDraft(),

    isEmpty: () => {
      const d = captureGoalsDraft();
      return !d.heardAboutUs && !d.isReferred && !d.wouldHelpOthers &&
             (!d.howWeHelp || d.howWeHelp.length === 0) &&
             (!d.howHelpOthers || d.howHelpOthers.length === 0);
    },

    /* Save Now click → Goals & Interests doesn't currently expose a
       "save partial state" backend endpoint. apiSaveGoals expects
       fully-validated payload. So we treat backend save as
       optional: try it if the form is reasonably complete, else
       the localStorage backup is the entire save. */
    apiSave: null,

    restorePayload: (draft) => restoreGoalsDraft(draft)
  });

  /* Load server data. Local-draft fallback is handled by save_now.js
     via the draft-restore banner — no need to silently restore here. */
  loadGoals();
});

/* ============================================================
   RESEARCHER / INNOVATOR BLOCK — Goals & Interests page
   Prefix: gi_ri  (avoids ID clash with professional_introduction.js)

   Triggered when howWeHelp tags include either:
   - "Want to Pitch My Research / Innovation to Industry"
   - "Want to Pitch My Research / Innovation to Government"

   Identical multi-entry logic to professional_introduction.js
   but entirely self-contained with gi_ri* IDs.
   ============================================================ */

const GI_RI_PITCH_TAGS = [
  "Want to Pitch My Research / Innovation to Industry",
  "Want to Pitch My Research / Innovation to Government"
];

const GI_RI_CONFIG = {
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

let giRiEntries = [];
let giRiUid     = 0;

/* ── Render saved RI entries ── */
function renderGIRIEntries() {
  const list = $("gi_riEntriesList");
  if (!list) return;
  list.innerHTML = "";

  if (giRiEntries.length === 0) return;

  const heading = document.createElement("h3");
  heading.className = "ri-list-heading";
  heading.textContent = "Saved Entries (" + giRiEntries.length + ")";
  list.appendChild(heading);

  giRiEntries.forEach(entry => {
    const cfg = GI_RI_CONFIG[entry.type] || {};
    const card = document.createElement("div");
    card.className = "ri-card";

    /* Body — left side */
    const body = document.createElement("div");
    body.className = "ri-card__body";

    /* Type badge — textContent on entry.type */
    const badge = document.createElement("span");
    badge.className = "ri-card__badge " + (cfg.badgeClass || "");
    badge.textContent = entry.type;
    body.appendChild(badge);

    /* Domain (free text) */
    const domainEl = document.createElement("div");
    domainEl.className = "ri-card__domain";
    domainEl.textContent = entry.domain;
    body.appendChild(domainEl);

    /* Sub-type */
    const metaEl = document.createElement("div");
    metaEl.className = "ri-card__meta";
    metaEl.textContent = entry.subType;
    body.appendChild(metaEl);

    /* Skills line (free text) */
    const skillsEl = document.createElement("div");
    skillsEl.className = "ri-card__skills";
    skillsEl.textContent = "Skills: " + entry.skills;
    body.appendChild(skillsEl);

    /* About paragraph (free text) */
    const aboutEl = document.createElement("div");
    aboutEl.className = "ri-card__about";
    aboutEl.textContent = entry.about;
    body.appendChild(aboutEl);

    card.appendChild(body);

    /* Actions — Remove button wired with closure over entry.uid */
    const actions = document.createElement("div");
    actions.className = "ri-card__actions";
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn--danger-soft";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      giRiEntries = giRiEntries.filter(e => e.uid !== entry.uid);
      renderGIRIEntries();
    });
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    list.appendChild(card);
  });
}

/* ── Add one RI entry ── */
function addGIRIEntry() {
  const type    = $("gi_riType")    ? trim($("gi_riType").value)    : "";
  const domain  = $("gi_riDomain")  ? trim($("gi_riDomain").value)  : "";
  const subType = $("gi_riSubType") ? $("gi_riSubType").value       : "";
  const skills  = $("gi_riSkills")  ? trim($("gi_riSkills").value)  : "";
  const about   = $("gi_riAbout")   ? trim($("gi_riAbout").value)   : "";

  if (!type)    { showPopup("Please select whether you are a Researcher, Innovator, or Patent Holder."); return; }
  if (!domain)  { showPopup("Please fill this form first."); return; }
  if (!subType) { showPopup("Please fill this form first."); return; }
  if (!skills)  { showPopup("Please fill this form first."); return; }
  if (!about)   { showPopup("Please fill this form first."); return; }

  const skillList = skills.split(",").map(s => trim(s)).filter(Boolean);
  if (skillList.length > 3) {
    showPopup("You can enter up to 3 skills only. Please reduce the number of entries.");
    return;
  }

  giRiEntries.push({
    uid: ++giRiUid, type, domain, subType,
    skills: skillList.join(", "), about
  });

  /* Clear form for next entry */
  $("gi_riDomain").value  = "";
  $("gi_riSubType").value = "";
  $("gi_riSkills").value  = "";
  $("gi_riAbout").value   = "";
  $("gi_riAboutCounter").textContent = "0 / 1,500";

  renderGIRIEntries();
  $("gi_riDomain").focus();
  showToast("Entry added to list.", "success");
}

/* ── Setup gi_riType selector — labels, sub-types, char counter, add button ── */
function setupGIRITypeSelector() {
  const sel = $("gi_riType");
  if (!sel) return;

  sel.addEventListener("change", () => {
    const type     = sel.value;
    const formCard = $("gi_riFormCard");
    if (!formCard) return;

    if (!type) { formCard.classList.add("hidden"); return; }

    formCard.classList.remove("hidden");
    const cfg = GI_RI_CONFIG[type];

    $("gi_riFormHeading").textContent = cfg.heading;
    $("gi_riDomainLabel").innerHTML   = cfg.domainLabel  + ' <span class="required">*</span>';
    $("gi_riSubTypeLabel").innerHTML  = cfg.typeLabel    + ' <span class="required">*</span>';
    $("gi_riSkillsLabel").innerHTML   = cfg.skillsLabel  + ' <span class="required">*</span>';
    $("gi_riAboutLabel").innerHTML    = cfg.aboutLabel   + ' <span class="required">*</span>';

    /* Rebuild sub-type options */
    const sub = $("gi_riSubType");
    sub.innerHTML = '<option value="">Select</option>';
    cfg.subTypes.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt; o.textContent = opt;
      sub.appendChild(o);
    });

    /* Clear form */
    $("gi_riDomain").value  = "";
    $("gi_riSubType").value = "";
    $("gi_riSkills").value  = "";
    $("gi_riAbout").value   = "";
    $("gi_riAboutCounter").textContent = "0 / 1,500";
  });

  /* Char counter */
  const aboutEl  = $("gi_riAbout");
  const counterEl = $("gi_riAboutCounter");
  if (aboutEl && counterEl) {
    aboutEl.addEventListener("input", () => {
      counterEl.textContent = aboutEl.value.length + " / 1,500";
    });
  }

  /* Add button */
  const addBtn = $("gi_riAddBtn");
  if (addBtn) addBtn.addEventListener("click", addGIRIEntry);
}

/* ── Show/hide giResearcherCard based on howWeHelp tags ── */
function refreshGIResearcherCard(selectedValues) {
  const needsRI = GI_RI_PITCH_TAGS.some(tag => selectedValues.includes(tag));
  const card    = $("giResearcherCard");
  if (!card) return;
  card.classList.toggle("hidden", !needsRI);

  /* When hidden — reset entries and form so stale data doesn't validate */
  if (!needsRI) {
    giRiEntries = [];
    renderGIRIEntries();
    const formCard = $("gi_riFormCard");
    if (formCard) formCard.classList.add("hidden");
    if ($("gi_riType")) $("gi_riType").value = "";
  }
}

/* ── Add giRI validation into the main validate() chain ── */
/* Extend validate to also check giRi entries when card is visible */
const _originalValidate = validate;
function validateWithGIRI() {
  if (!_originalValidate()) return false;

  const card = $("giResearcherCard");
  if (card && !card.classList.contains("hidden")) {
    if (!$("gi_riType") || !$("gi_riType").value) {
      showPopup("Please select whether you are a Researcher, Innovator, or Patent Holder in the Research / Innovation Details section.");
      return false;
    }
    if (giRiEntries.length === 0) {
      showPopup('Please add at least one entry using the "+ Add to List" button in the Research / Innovation Details section.');
      return false;
    }
  }
  return true;
}

/* ── Extend buildPayload to include giRi entries ── */
const _originalBuildPayload = buildPayload;
function buildPayloadWithGIRI() {
  const base = _originalBuildPayload();
  const card = $("giResearcherCard");
  if (card && !card.classList.contains("hidden")) {
    base.gi_ri_type    = $("gi_riType") ? $("gi_riType").value : null;
    base.gi_ri_entries = giRiEntries.map(e => ({
      type: e.type, domain: e.domain, sub_type: e.subType,
      skills: e.skills, about: e.about
    }));
  }
  return base;
}

/* ── Bind Save & Continue with GI/RI-aware validation + payload.
   This is the single source of truth for the button click. When
   the Researcher / Innovator card is visible, validateWithGIRI()
   + buildPayloadWithGIRI() perform the extended checks; when it
   is hidden they delegate to the plain validate() + buildPayload().
   Either way the post-save flow is identical: mark completed and
   navigate parent dashboard to upload_photo_cv.html. ── */
function bindSaveContinue() {
  const btn = $("saveContinueBtn");
  if (!btn) return;

  /* Inner function: actually save and navigate.
     Called either directly (when nothing's empty) or from
     the soft-confirm Continue Anyway callback. */
  async function performSave() {
    setLoading(btn, true);
    try {
      await apiSaveGoals(buildPayloadWithGIRI());
    } catch (err) {
      console.error("Goals save failed:", err);
      showToast("Could not save to server. Please try again.", "error");
      setLoading(btn, false);
      return;
    }
    localStorage.setItem("goals_completed", "yes");
    localStorage.setItem("profile_last_updated", new Date().toLocaleDateString("en-US"));
    SaveNow.clearDraft();
    window.parent.postMessage(
      { type:"navigate", page:"upload_photo_cv.html", sidebarKey:"Upload Photo & CV" }, "*"
    );
    setTimeout(() => setLoading(btn, false), 800);
  }

  btn.addEventListener("click", () => {
    if (!validateWithGIRI()) return;

    /* Soft confirmation for the two newly-non-mandatory questions.
       Build a context-aware message based on what's empty. */
    const hwEmpty = howWeHelpCtrl && howWeHelpCtrl.getValues().length === 0;
    const helpYes = $("wouldHelpOthers").value === "Yes";
    const hhEmpty = helpYes && howHelpOthersCtrl && howHelpOthersCtrl.getValues().length === 0;

    if (hwEmpty || hhEmpty) {
      let message;
      if (hwEmpty && hhEmpty) {
        message = "You haven't told us what you're looking for or how you'd like to contribute. " +
                  "MECULS works best when we know how to match you. " +
                  "Are you sure you want to continue without this?";
      } else if (hwEmpty) {
        message = "You haven't told us what you're looking for. " +
                  "MECULS works best when we know how to match you. " +
                  "Are you sure you want to continue without this?";
      } else {
        message = "You haven't told us how you'd like to contribute. " +
                  "MECULS works best when we know how to match you. " +
                  "Are you sure you want to continue without this?";
      }
      showConfirm(message, {
        primaryLabel  : "Go Back & Add",
        secondaryLabel: "Continue Anyway",
        onPrimary     : () => { /* user stays on page; nothing to do */ },
        onSecondary   : () => { performSave(); }
      });
      return;
    }

    performSave();
  });
}

/* ── Hook into howWeHelp tag picker onchange ── */
function hookGIRIIntoTagPicker() {
  if (!howWeHelpCtrl) return;

  /* Directly watch the tag area for mutations — fires whenever a tag
     is added or removed so the Researcher / Innovator card can be
     shown or hidden in response. */
  const tagArea = $("howWeHelpTags");
  if (!tagArea) return;

  const obs = new MutationObserver(() => {
    const vals = howWeHelpCtrl ? howWeHelpCtrl.getValues() : [];
    refreshGIResearcherCard(vals);
  });
  obs.observe(tagArea, { childList: true, subtree: true });
}
