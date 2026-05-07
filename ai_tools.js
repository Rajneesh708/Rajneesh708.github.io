/* ============================================================
   MECULS — ai_tools.js
   AI Tools & Digital Literacy section logic.

   Final structure (post-streamline 2026-04-30):
     - Tool list (per-tool: name + category + proficiency only)
     - Role Identity dropdown (single value — required)
     - Overall AI Proficiency dropdown (single value — required)
     - No per-tool "use case" textarea
     - No "AI impact" free-text
     - No 4-card proficiency grid

   Phase 1 Step 3 changes (2026-05):
     - Storage moved from legacy `ai_tools` table to JSONB section
       at profiles.data.ai_tools (1-to-1 single object).
     - apiSave / apiLoadAITools rewritten to use MC.saveSection /
       MC.loadSection. No more candidate_id column reference.
     - addTool validation consolidated into a single bullet popup.
     - saveContinue required-field checks consolidated into a single
       bullet popup; mid-form tool entry auto-added before navigation
       (matches references.js / languages.js pattern — protects users
       who type fields but forget to click "+ Add Tool").
     - apiLoadAITools resets in-memory tools[] before push (defensive).
     - skipSection uses MC.showConfirm instead of window.confirm
       for visual consistency with the rest of the page.
     - Stale categories in saved data (e.g. legacy values not in
       CATEGORY_ORDER) preserve their original name as a customLabel
       so the data stays visible to the user.
     - Console version stamp window.AI_TOOLS_VERSION for cache verify.

   Architecture:
     - MC.* helpers (no local copies of $/trim/showPopup/showToast/setLoading)
     - SaveNow draft-restore engine (single-form scope)
     - Sidebar-consistent navigation labels
     - postMessage navigation to parent dashboard
   ============================================================ */

"use strict";

window.AI_TOOLS_VERSION = "phase1-step3";

/* ── Config ── */
const MAX_TOOLS = 30;   /* soft cap — same as Skills page */

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const $           = MC.$;
const trim        = MC.trim;
const showPopup   = MC.showPopup;
const showConfirm = MC.showConfirm;
const showToast   = MC.showToast;
const setLoading  = MC.setLoading;

/* ── In-memory tools state ──
   Each entry: { uid, name, category, customLabel?, proficiency }
   - uid         : stable unique id (incrementing) for safe remove
   - name        : the tool itself, e.g. "ChatGPT"
   - category    : one of ai/data/collab/design/other
   - customLabel : (optional) only present when category === "other"
                   and user typed a custom category name like "CRM"
   - proficiency : Beginner / Intermediate / Advanced / Expert
─────────────────────────────────────────────────────────── */
let tools   = [];
let toolUid = 0;

/* ── Category metadata (label + tag CSS class) ── */
const CAT_LABEL = {
  ai     : "AI / Generative AI",
  data   : "Data Analytics & BI",
  collab : "Collaboration & Productivity",
  design : "Design & Creativity",
  other  : "Other"
};

const CAT_BADGE_CLASS = {
  ai     : "type-badge--blue",
  data   : "type-badge--green",
  collab : "type-badge--purple",
  design : "type-badge--orange",
  other  : "type-badge--gray"
};

/* Render order — any tool with a category outside this list would
   otherwise be silently dropped from the grouped preview. */
const CATEGORY_ORDER = ["ai", "data", "collab", "design", "other"];

/* ============================================================
   ROLE IDENTITY — 13 curated options + Other (custom label).
   These descriptions are LinkedIn-ready: candidates can copy any
   of them straight to their LinkedIn headline / About section.
   ============================================================ */

const ROLE_IDENTITY_OPTIONS = [
  { value: "communicator", label: "AI-Augmented Communicator",
    desc: "I use AI to write, edit, and polish professional content faster and more clearly." },
  { value: "analyst",      label: "AI-Augmented Analyst",
    desc: "I use AI to interpret data, spot patterns, and surface insights I'd otherwise miss." },
  { value: "researcher",   label: "AI-Augmented Researcher",
    desc: "I use AI to scan, summarise, and synthesise large amounts of information quickly." },
  { value: "strategist",   label: "AI-Augmented Strategist",
    desc: "I use AI to stress-test ideas, explore options, and sharpen my thinking before decisions." },
  { value: "creator",      label: "AI-Augmented Creator",
    desc: "I use AI to ideate, prototype, and produce creative work — visuals, copy, content." },
  { value: "educator",     label: "AI-Augmented Educator / Coach",
    desc: "I use AI to explain concepts, generate examples, and help others learn faster." },
  { value: "operator",     label: "AI-Augmented Operator",
    desc: "I use AI to automate repetitive workflows and free up time for higher-value work." },
  { value: "field_learner",label: "AI-Augmented Field Learner",
    desc: "I use AI as a personal tutor to keep up with developments in my domain." },
  { value: "workflow_builder", label: "AI Workflow Builder",
    desc: "I design and build AI-powered processes for my team or organisation." },
  { value: "decision_partner", label: "AI Decision Partner",
    desc: "I use AI as a thinking partner for hard decisions, risk analysis, and 'what if' scenarios." },
  { value: "skeptic_verifier", label: "AI Skeptic & Verifier",
    desc: "I use AI but always verify outputs against sources and domain knowledge before acting." },
  { value: "ai_curious",   label: "AI-Curious / Still Learning",
    desc: "I'm exploring how AI can help in my role. Open to learning, not pretending to be expert." },
  { value: "ai_director",  label: "AI Director / Human-in-Command",
    desc: "I direct AI systems to deliver at human standard. I set vision, enforce quality, and stay accountable for outputs without writing code myself." },
  { value: "other",        label: "Other (describe in your own words)",
    desc: null }
];

/* ============================================================
   POPULATE ROLE IDENTITY DROPDOWN + DESCRIPTION HELPER
   ============================================================ */

function populateRoleIdentitySelect() {
  const sel = $("roleIdentity");
  if (!sel) return;

  /* Clear placeholder option first if any present from HTML */
  sel.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select the closest match…";
  sel.appendChild(placeholder);

  ROLE_IDENTITY_OPTIONS.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  });
}

function setupRoleIdentityChangeHandler() {
  const sel       = $("roleIdentity");
  const descEl    = $("roleIdentityDesc");
  const otherWrap = $("roleIdentityOtherWrap");
  if (!sel) return;

  sel.addEventListener("change", () => {
    const value = sel.value;
    const opt = ROLE_IDENTITY_OPTIONS.find(o => o.value === value);

    /* Description text below the dropdown */
    if (opt && opt.desc) {
      descEl.textContent = opt.desc;
      descEl.classList.remove("hidden");
    } else {
      descEl.textContent = "";
      descEl.classList.add("hidden");
    }

    /* Custom-text input for "Other" */
    if (value === "other") {
      otherWrap.classList.remove("hidden");
    } else {
      otherWrap.classList.add("hidden");
      $("roleIdentityOther").value = "";
      /* Reset counter back to "0 / 300" */
      MC.updateCounter($("roleIdentityOther"), "roleIdentityOtherCounter");
    }

    /* Heartbeat to SaveNow */
    if (window.SaveNow && SaveNow.silentSave) {
      SaveNow.silentSave();
      SaveNow.flashStatus();
    }
  });
}

/* ============================================================
   OVERALL PROFICIENCY DROPDOWN — change handler
   ============================================================ */

function setupOverallProfHandler() {
  const sel = $("overallProf");
  if (!sel) return;

  sel.addEventListener("change", () => {
    if (window.SaveNow && SaveNow.silentSave) {
      SaveNow.silentSave();
      SaveNow.flashStatus();
    }
  });
}

function getOverallProf() {
  const sel = $("overallProf");
  return sel ? sel.value : "";
}

function setOverallProf(value) {
  const sel = $("overallProf");
  if (!sel) return;
  sel.value = value || "";
}

/* ============================================================
   "OTHER" CATEGORY — custom-label input visibility
   ============================================================ */

function setupCategoryOtherToggle() {
  const sel = $("toolCategory");
  const other = $("toolCategoryOther");
  if (!sel || !other) return;
  sel.addEventListener("change", () => {
    if (sel.value === "other") {
      other.classList.remove("hidden");
    } else {
      other.classList.add("hidden");
      other.value = "";
    }
  });
}

/* ============================================================
   RENDER TOOLS LIST — grouped by category, XSS-safe
   (Built with createElement + textContent — no innerHTML.)
   ============================================================ */

function renderToolList() {
  const list = $("aiToolList");
  list.innerHTML = "";

  if (tools.length === 0) return;

  const heading = document.createElement("h3");
  heading.className = "list-heading";
  heading.textContent = "Your AI & Digital Tools (" + tools.length + ")";
  list.appendChild(heading);

  /* Group tools by category. Defensive: any tool whose category is NOT
     in CATEGORY_ORDER (e.g. legacy/stale values from older versions) is
     bucketed under "other" with its original category preserved as a
     customLabel — so the data stays visible to the user. */
  const grouped = {};
  tools.forEach(t => {
    const isKnown = CATEGORY_ORDER.includes(t.category);
    const key = isKnown ? t.category : "other";
    if (!grouped[key]) grouped[key] = [];
    if (!isKnown && !t.customLabel && t.category) {
      /* Heal in-memory state so save+reload preserves the display.
         Original category becomes the customLabel; bucket switches
         to "other". On next save, this propagates to JSONB. */
      t.customLabel = String(t.category);
      t.category = "other";
    }
    grouped[key].push(t);
  });

  /* Render in the defined category order */
  CATEGORY_ORDER.forEach(catKey => {
    if (!grouped[catKey] || grouped[catKey].length === 0) return;

    const catHeading = document.createElement("div");
    catHeading.className = "tool-list-category-heading";
    catHeading.textContent = CAT_LABEL[catKey] || "Other";
    list.appendChild(catHeading);

    grouped[catKey].forEach(tool => {
      const card = document.createElement("div");
      card.className = "tool-card";

      const body = document.createElement("div");
      body.className = "tool-card__body";

      /* Tool name */
      const nameEl = document.createElement("div");
      nameEl.className = "tool-card__name";
      nameEl.textContent = tool.name;
      body.appendChild(nameEl);

      /* Meta row: category badge + proficiency badge */
      const meta = document.createElement("div");
      meta.className = "tool-card__meta";

      const catBadge = document.createElement("span");
      catBadge.className = "type-badge " + (CAT_BADGE_CLASS[tool.category] || "type-badge--gray");
      catBadge.style.marginRight = "6px";
      /* If category was "other" with a customLabel, show the custom label */
      if (tool.category === "other" && tool.customLabel) {
        catBadge.textContent = tool.customLabel;
      } else {
        catBadge.textContent = CAT_LABEL[tool.category] || "Other";
      }
      meta.appendChild(catBadge);

      const profBadge = document.createElement("span");
      profBadge.className = "type-badge type-badge--gray";
      profBadge.textContent = tool.proficiency;
      meta.appendChild(profBadge);

      body.appendChild(meta);

      card.appendChild(body);

      /* Remove button — closure over uid, no string round-trip */
      const actions = document.createElement("div");
      actions.style.flexShrink = "0";
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn--danger-soft";
      removeBtn.textContent = "Remove";
      const uidToRemove = tool.uid;
      removeBtn.addEventListener("click", () => {
        tools = tools.filter(t => t.uid !== uidToRemove);
        renderToolList();
        if (window.SaveNow && SaveNow.silentSave) {
          SaveNow.silentSave();
          SaveNow.flashStatus();
        }
      });
      actions.appendChild(removeBtn);
      card.appendChild(actions);

      list.appendChild(card);
    });
  });
}

/* ============================================================
   ADD TOOL
   ============================================================ */

/* Normalise a tool name for duplicate detection: lowercase, strip
   non-alphanumeric. So "Chat GPT", "ChatGPT", "chat-gpt", and
   "chatgpt" all collapse to the same key. */
function normaliseToolName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/* Returns true if the tool was added, false otherwise.
   Returning a boolean lets saveContinue auto-add a mid-form entry
   before navigation and bail out cleanly if validation fails. */
function addTool() {
  const name        = trim($("toolName").value);
  const category    = $("toolCategory").value;
  const customLabel = trim($("toolCategoryOther").value);
  const proficiency = $("toolProficiency").value;

  /* ── Consolidated missing-field check ── */
  const missing = [];
  if (!name)                                  missing.push("Tool / Platform Name");
  if (!category)                              missing.push("Category");
  if (category === "other" && !customLabel)   missing.push("Specify the category (the box next to 'Other')");
  if (!proficiency)                           missing.push("Your Proficiency");

  if (missing.length > 0) {
    if (missing.length === 1) {
      showPopup("Please fill in: " + missing[0] + ".");
    } else {
      showPopup(
        "Please fill in the following before adding this tool:\n\n• " +
        missing.join("\n• ")
      );
    }
    /* Focus the first missing field for quick correction */
    if (!name)                                $("toolName").focus();
    else if (!category)                       $("toolCategory").focus();
    else if (category === "other" && !customLabel) $("toolCategoryOther").focus();
    else if (!proficiency)                    $("toolProficiency").focus();
    return false;
  }

  /* Soft cap */
  if (tools.length >= MAX_TOOLS) {
    showPopup(
      "You've added the maximum of " + MAX_TOOLS + " tools. " +
      "Remove a tool from your list before adding another."
    );
    return false;
  }

  /* Duplicate check (case-insensitive, normalised) */
  const normalised = normaliseToolName(name);
  const isDuplicate = tools.some(
    t => normaliseToolName(t.name) === normalised
  );
  if (isDuplicate) {
    showPopup("\"" + name + "\" looks like a tool already in your list. Please check your saved tools above.");
    return false;
  }

  const entry = {
    uid: ++toolUid,
    name,
    category,
    proficiency
  };
  if (category === "other" && customLabel) {
    entry.customLabel = customLabel;
  }
  tools.push(entry);

  /* Reset inputs */
  $("toolName").value             = "";
  $("toolCategory").value         = "";
  $("toolCategoryOther").value    = "";
  $("toolCategoryOther").classList.add("hidden");
  $("toolProficiency").value      = "";
  $("toolName").focus();

  renderToolList();
  showToast("\"" + name + "\" added to your tools list.", "success");

  /* Trigger auto-save heartbeat */
  if (window.SaveNow && SaveNow.silentSave) {
    SaveNow.silentSave();
    SaveNow.flashStatus();
  }

  return true;
}

/* ============================================================
   API — Phase 1 Step 3 (JSONB section pattern)
   ============================================================
   ai_tools is 1-to-1: a single object stored at
   profiles.data.ai_tools. The object bundles the tools array,
   role identity (+ optional Other-text), and overall proficiency.

   MC.saveSection writes the whole payload under one key via the
   server-side save_profile_section RPC (atomic JSONB merge,
   no two-tab race). MC.loadSection reads it back. RLS is
   enforced server-side via auth.uid().
   ============================================================ */

async function apiSave(payload) {
  return await MC.saveSection("ai_tools", {
    tools               : Array.isArray(payload.tools) ? payload.tools : [],
    role_identity       : payload.role_identity       || null,
    role_identity_other : payload.role_identity_other || null,
    overall_proficiency : payload.overall_proficiency || null
  });
}

function buildPayload() {
  const roleIdentity      = $("roleIdentity").value;
  const roleIdentityOther = trim($("roleIdentityOther").value);

  return {
    tools                 : tools.map(t => ({
      name        : t.name,
      category    : t.category,
      custom_label: t.customLabel || null,
      proficiency : t.proficiency
    })),
    role_identity         : roleIdentity || null,
    role_identity_other   : roleIdentity === "other" ? (roleIdentityOther || null) : null,
    overall_proficiency   : getOverallProf() || null
  };
}

/* ============================================================
   SAVE & CONTINUE
   ============================================================ */

/* Detect any typed-but-not-added tool fields. If the user filled
   any of name / category / customLabel / proficiency, treat that
   as a forgotten "+ Add Tool" click and try to add it before save.

   Returns true if either:
     - there was no mid-form input, OR
     - the auto-add succeeded (entry now in tools[])
   Returns false if there was input but addTool() rejected it
   (validation, duplicate, or cap) — saveContinue should bail out
   so the user fixes the form rather than losing data. */
function tryAutoAddPendingTool() {
  const name        = trim($("toolName").value);
  const category    = $("toolCategory").value;
  const customLabel = trim($("toolCategoryOther").value);
  const proficiency = $("toolProficiency").value;

  const hasInput = !!name || !!category || !!customLabel || !!proficiency;
  if (!hasInput) return true;   /* nothing to auto-add */

  /* addTool returns true on success, false on validation failure.
     On failure it has already shown its own popup explaining why. */
  return addTool();
}

async function saveContinue() {
  /* Auto-add pending mid-form entry first. If validation fails on
     that entry, addTool already popped a clear bullet message —
     we just bail so the user can fix the form. */
  if (!tryAutoAddPendingTool()) return;

  /* ── Consolidated required-field check ── */
  const roleIdentity      = $("roleIdentity").value;
  const roleIdentityOther = trim($("roleIdentityOther").value);
  const overallProf       = getOverallProf();

  const missing = [];
  if (!roleIdentity)                                      missing.push("How You Use AI Professionally");
  if (roleIdentity === "other" && !roleIdentityOther)     missing.push("Describe in your own words (the box under 'Other')");
  if (!overallProf)                                       missing.push("Your Overall AI / Digital Proficiency");

  if (missing.length > 0) {
    if (missing.length === 1) {
      showPopup("Please fill in: " + missing[0] + ".");
    } else {
      showPopup(
        "Please fill in the following before continuing:\n\n• " +
        missing.join("\n• ")
      );
    }
    /* Focus first missing field, scrolling into view */
    let focusEl;
    if (!roleIdentity)                                  focusEl = $("roleIdentity");
    else if (roleIdentity === "other" && !roleIdentityOther) focusEl = $("roleIdentityOther");
    else if (!overallProf)                              focusEl = $("overallProf");
    if (focusEl) {
      focusEl.scrollIntoView({ behavior: "smooth", block: "center" });
      focusEl.focus();
    }
    return;
  }

  /* Soft path: no tools added — confirm rather than block. Honest
     no-tool users (rare but real) shouldn't be trapped. */
  if (tools.length === 0) {
    showConfirm(
      "You haven't added any AI / digital tools.\n\n" +
      "Adding even one — including basic tools like Excel, Google Workspace, " +
      "or Outlook — strengthens your profile.\n\n" +
      "Are you sure you want to continue without adding any tools?",
      proceedSave,
      {
        confirmLabel: "Continue without tools",
        cancelLabel:  "Go back & add tools"
      }
    );
    return;
  }
  proceedSave();
}

/* ============================================================
   SKIP — section is optional, user can opt out without saving
   ============================================================ */

function skipSection() {
  /* If the user has typed/selected anything, warn before discarding. */
  const hasInput = !!($("roleIdentity").value)
                || !!trim($("roleIdentityOther") ? $("roleIdentityOther").value : "")
                || !!getOverallProf()
                || (tools && tools.length > 0);

  /* Detect typed-but-not-added pending tool too */
  const hasPendingTool = !!trim($("toolName").value)
                      || !!$("toolCategory").value
                      || !!trim($("toolCategoryOther").value)
                      || !!$("toolProficiency").value;

  const proceedSkip = () => {
    /* Don't save anything — clear any draft so it doesn't reappear */
    if (window.SaveNow) SaveNow.clearDraft();

    MC.safeSet("ai_tools_completed", "skipped");
    MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

    window.parent.postMessage(
      { type: "navigate", page: "consulting_availability.html", sidebarKey: "Consulting Availability" },
      "*"
    );
  };

  if (hasInput || hasPendingTool) {
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

async function proceedSave() {
  const btn = $("saveContinueBtn");
  setLoading(btn, true);

  try {
    await apiSave(buildPayload());
  } catch (err) {
    console.error("AI tools save failed:", err);
    showToast("Could not save to server. Your data is preserved — please try again.", "error");
    setLoading(btn, false);
    return;
  }

  /* Saved successfully — clear draft */
  if (window.SaveNow) SaveNow.clearDraft();

  MC.safeSet("ai_tools_completed", "yes");
  MC.safeSet("profile_last_updated", new Date().toLocaleDateString("en-US"));

  window.parent.postMessage(
    { type: "navigate", page: "consulting_availability.html", sidebarKey: "Consulting Availability" },
    "*"
  );

  setTimeout(() => setLoading(btn, false), 800);
}

/* ============================================================
   LOAD EXISTING DATA FROM BACKEND
   ============================================================ */

async function apiLoadAITools() {
  let data;
  try {
    data = await MC.loadSection("ai_tools");
  } catch (err) {
    /* Non-fatal — page still works for new users when network is offline */
    console.error("Could not load AI tools:", err);
    return;
  }

  if (!data) return;

  /* Defensive: reset in-memory state before push so re-running the
     loader (rare but possible via future re-init paths) cannot
     duplicate entries. */
  tools = [];
  toolUid = 0;

  /* Tools */
  const loaded = Array.isArray(data.tools) ? data.tools : [];
  loaded.forEach(t => {
    if (!t || !t.name) return;
    const entry = {
      uid        : ++toolUid,
      name       : t.name,
      category   : t.category,
      proficiency: t.proficiency
    };
    if (t.custom_label) entry.customLabel = t.custom_label;
    tools.push(entry);
  });
  renderToolList();

  /* Role Identity */
  if (data.role_identity) {
    const sel = $("roleIdentity");
    sel.value = data.role_identity;
    /* Trigger change to update description + Other visibility */
    sel.dispatchEvent(new Event("change"));

    if (data.role_identity === "other" && data.role_identity_other) {
      $("roleIdentityOther").value = data.role_identity_other;
      /* Sync the char-counter to the loaded value */
      MC.updateCounter($("roleIdentityOther"), "roleIdentityOtherCounter");
    }
  }

  /* Overall proficiency */
  if (data.overall_proficiency) {
    setOverallProf(data.overall_proficiency);
  }
}

/* ============================================================
   SAVENOW DRAFT — capture and restore
   ============================================================ */

function captureAIToolsDraft() {
  return {
    tools: tools.map(t => ({
      name        : t.name,
      category    : t.category,
      customLabel : t.customLabel || null,
      proficiency : t.proficiency
    })),
    roleIdentity      : $("roleIdentity").value,
    roleIdentityOther : trim($("roleIdentityOther").value),
    overallProf       : getOverallProf()
  };
}

function restoreAIToolsDraft(draft) {
  if (!draft) return false;

  /* Tools */
  if (Array.isArray(draft.tools)) {
    tools = [];
    toolUid = 0;
    draft.tools.forEach(d => {
      if (!d || !d.name || !d.category || !d.proficiency) return;
      const entry = {
        uid        : ++toolUid,
        name       : d.name,
        category   : d.category,
        proficiency: d.proficiency
      };
      if (d.customLabel) entry.customLabel = d.customLabel;
      tools.push(entry);
    });
    renderToolList();
  }

  /* Role Identity */
  if (draft.roleIdentity) {
    const sel = $("roleIdentity");
    sel.value = draft.roleIdentity;
    sel.dispatchEvent(new Event("change"));
    if (draft.roleIdentity === "other" && draft.roleIdentityOther) {
      $("roleIdentityOther").value = draft.roleIdentityOther;
      /* Sync the char-counter to the restored value */
      MC.updateCounter($("roleIdentityOther"), "roleIdentityOtherCounter");
    }
  }

  /* Overall proficiency */
  if (draft.overallProf) {
    setOverallProf(draft.overallProf);
  }

  return true;
}

/* ============================================================
   INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  populateRoleIdentitySelect();
  setupRoleIdentityChangeHandler();
  setupOverallProfHandler();
  setupCategoryOtherToggle();

  /* Enter key on tool name triggers add */
  $("toolName").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addTool(); }
  });

  $("addToolBtn").addEventListener("click", addTool);
  $("saveContinueBtn").addEventListener("click", saveContinue);

  /* Wire Skip button — section is optional */
  const skipBtn = $("skipBtn");
  if (skipBtn) skipBtn.addEventListener("click", skipSection);

  /* Wire character counter on the Role Identity "Other" textarea so it
     updates as the user types. MC.updateCounter reads the input's own
     maxLength so the format string (e.g. "0 / 300") follows whatever
     maxlength the HTML defines — no hard-coded numbers in JS. */
  $("roleIdentityOther").addEventListener("input", () => {
    MC.updateCounter($("roleIdentityOther"), "roleIdentityOtherCounter");
  });

  /* Load any existing backend data BEFORE SaveNow.init so the draft-restore
     check has the canonical state to compare against. */
  await apiLoadAITools();

  /* Wire SaveNow. No formIds because the inputs are not in a <form>;
     containerSelector listens on the whole form-container so any input
     event triggers the silent-backup debounce. The actual canonical
     state lives in the in-memory tools array + role identity + overall
     proficiency, captured by captureAIToolsDraft. */
  if (window.SaveNow) {
    SaveNow.init({
      pageName          : "ai_tools",
      containerSelector : ".form-container",
      capturePayload    : captureAIToolsDraft,
      restorePayload    : restoreAIToolsDraft,
      apiSave           : (p) => apiSave(p),
      isEmpty           : () => tools.length === 0
                              && !$("roleIdentity").value
                              && !getOverallProf()
    });
  }
});
