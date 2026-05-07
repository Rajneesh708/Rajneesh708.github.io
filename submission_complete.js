/* ============================================================
   MECULS — submission_complete.js  (phase1-step3)
   Post-submission welcome page logic.

   ┌─────────────────────────────────────────────────────────┐
   │  WHAT CHANGED FROM THE PREVIOUS VERSION                  │
   │                                                          │
   │  Completion state no longer reads localStorage flags     │
   │  ("goals_completed", "experience_completed", etc.).      │
   │                                                          │
   │  It now reads profiles.data JSONB from Supabase using    │
   │  the SAME predicates dashboard.js uses, so the count     │
   │  shown on this page can never disagree with the green    │
   │  ticks in the dashboard sidebar.                         │
   │                                                          │
   │  The COMPLETION_PREDICATES object below is intentionally │
   │  byte-identical to the one in dashboard.js — if you      │
   │  change a predicate, change it in both files together.   │
   │                                                          │
   │  The bonus grid keeps its three-state visual (Done /     │
   │  Skipped / Add). "Done" comes from the JSONB predicate   │
   │  (authoritative). "Skipped" is a soft visual hint read   │
   │  from a localStorage flag — only used for items NOT      │
   │  marked Done. If the user later filled in a section that │
   │  was previously skipped, JSONB will say Done and the     │
   │  stale skipped flag is ignored.                          │
   └─────────────────────────────────────────────────────────┘

   What this page does:
     - Loads the profile snapshot (data + photo_path + cv_path)
       once on init via MC.loadProfileFields
     - Counts completed sections using the predicates against
       that snapshot
     - Shows a count-based strength bar: "X of 18 sections completed"
       (no percentage, no fake "active matching" threshold)
     - Lists the 7 bonus sections with done / skipped / pending
       status, click-to-navigate for non-done ones
     - Provides a referral link (copy-to-clipboard)
     - Provides a "Review & Edit My Profile" button to navigate
       back to the start of the flow

   No write API call needed — all data was already saved by the
   individual sections during the flow. We only READ here.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.SUBMISSION_COMPLETE_VERSION === "phase1-step3" */
window.SUBMISSION_COMPLETE_VERSION = "phase1-step3";

/* ============================================================
   PROFILE CACHE
   Holds the latest snapshot of profiles.data + photo_path + cv_path,
   loaded once on init. Predicates run against this snapshot.
   ============================================================ */
let PROFILE_CACHE = {
  data: {},
  photo_path: null,
  cv_path: null
};

/* ============================================================
   COMPLETION PREDICATES — byte-identical to dashboard.js.

   Each predicate receives the full PROFILE_CACHE object and returns
   true if that section should count as completed.

   IMPORTANT: if you change a predicate, change it in both
   submission_complete.js AND dashboard.js — otherwise the sidebar
   tick count and the strength count on this page will disagree.
   ============================================================ */

function _hasItems(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

function _hasText(s) {
  return typeof s === "string" && s.trim().length > 0;
}

const COMPLETION_PREDICATES = {

  goals_completed: (p) => {
    const g = p.data?.goals_interests;
    if (!g) return false;
    return _hasItems(g.how_we_help)
        || _hasItems(g.how_help_others)
        || _hasItems(g.knowledge_fields)
        || _hasItems(g.gi_ri_entries)
        || _hasText(g.heard_about_us);
  },

  photo_cv_completed: (p) => {
    return _hasText(p.photo_path) && _hasItems(p.data?.cv_links);
  },

  profile_category_completed: (p) => {
    return _hasText(p.data?.profile_category?.user_type);
  },

  introduction_completed: (p) => {
    const i = p.data?.introduction;
    if (!i) return false;
    return _hasText(i.headline) || _hasText(i.summary);
  },

  experience_completed: (p) => {
    return _hasItems(p.data?.experiences);
  },

  education_completed: (p) => {
    const cur = p.data?.education_current;
    const past = p.data?.education;
    const curFilled = cur && (_hasText(cur.degree) || _hasText(cur.institution));
    return curFilled || _hasItems(past);
  },

  skills_completed: (p) => {
    return _hasItems(p.data?.skills);
  },

  certifications_completed: (p) => {
    return _hasItems(p.data?.certifications);
  },

  references_completed: (p) => {
    return _hasItems(p.data?.references);
  },

  preferences_completed: (p) => {
    const pr = p.data?.preferences;
    if (!pr) return false;
    return _hasItems(pr.preferred_roles)
        || _hasItems(pr.preferred_locations)
        || _hasItems(pr.preferred_industries)
        || _hasText(pr.employment_availability)
        || _hasText(pr.preferred_work_mode)
        || _hasText(pr.open_to_relocation)
        || _hasText(pr.preferred_employment_type)
        || pr.expected_ctc_min != null
        || pr.expected_ctc_max != null;
  },

  languages_completed: (p) => {
    return _hasItems(p.data?.languages?.languages);
  },

  /* ---------- Bonus sections ----------
     These now read JSONB the same way the converted bonus pages
     write it. _hasSection is lenient — any non-empty entry counts. */

  ai_tools_completed:         (p) => _hasSection(p, "ai_tools"),
  consulting_completed:       (p) => _hasSection(p, "consulting"),
  key_achievements_completed: (p) => _hasSection(p, "key_achievements"),
  mentorship_completed:       (p) => _hasSection(p, "mentorship"),
  portfolio_completed:        (p) => _hasSection(p, "portfolio"),
  publications_completed:     (p) => _hasSection(p, "publications"),
  volunteering_completed:     (p) => _hasSection(p, "volunteering")
};

function _hasSection(p, key) {
  const v = p.data?.[key];
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") {
    return Object.values(v).some(val => {
      if (val == null) return false;
      if (Array.isArray(val)) return val.length > 0;
      if (typeof val === "string") return val.trim().length > 0;
      return true;
    });
  }
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

/* ── isCompleted helper —
   Looks up the predicate for the given completion key and runs it
   against PROFILE_CACHE. Returns false if no predicate is registered
   (defensive — prevents accidental ticks). */
function isCompleted(key) {
  const fn = COMPLETION_PREDICATES[key];
  if (typeof fn !== "function") return false;
  try {
    return !!fn(PROFILE_CACHE);
  } catch (e) {
    return false;
  }
}

/* ============================================================
   COMPLETION KEYS — order matches dashboard.js / dashboard.html
   ============================================================ */
const MAIN_KEYS = [
  "goals_completed",
  "photo_cv_completed",
  "profile_category_completed",
  "introduction_completed",
  "experience_completed",
  "education_completed",
  "skills_completed",
  "certifications_completed",
  "references_completed",
  "preferences_completed",
  "languages_completed"
];

const BONUS_SECTIONS = [
  { key: "ai_tools_completed",         label: "AI Tools & Digital Literacy", page: "ai_tools.html",                sidebarKey: "AI Tools & Digital Literacy" },
  { key: "consulting_completed",       label: "Consulting Availability",     page: "consulting_availability.html", sidebarKey: "Consulting Availability"     },
  { key: "key_achievements_completed", label: "Key Achievements",            page: "key_achievements.html",        sidebarKey: "Key Achievements"            },
  { key: "mentorship_completed",       label: "Mentorship & Coaching",       page: "mentorship.html",              sidebarKey: "Mentorship & Coaching"       },
  { key: "portfolio_completed",        label: "Work Portfolio",              page: "portfolio.html",               sidebarKey: "Work Portfolio"              },
  { key: "publications_completed",     label: "Publications & Media",        page: "publications.html",            sidebarKey: "Publications & Media"        },
  { key: "volunteering_completed",     label: "Volunteering",                page: "volunteering.html",            sidebarKey: "Volunteering"                }
];

const TOTAL_SECTIONS = MAIN_KEYS.length + BONUS_SECTIONS.length; /* 18 */

/* ============================================================
   PROFILE CACHE LOADER
   One round-trip via MC.loadProfileFields, identical shape to
   dashboard.js's PROFILE_CACHE (minus updated_at, which this page
   doesn't display).
   ============================================================ */
async function loadProfileSnapshot() {
  try {
    const row = await MC.loadProfileFields(["data", "photo_path", "cv_path"]);
    PROFILE_CACHE = {
      data:       (row && row.data)       || {},
      photo_path: (row && row.photo_path) || null,
      cv_path:    (row && row.cv_path)    || null
    };
  } catch (err) {
    console.error("[submission_complete] failed to load profile:", err);
    /* Defensive empty cache — nothing accidentally ticks. */
    PROFILE_CACHE = { data: {}, photo_path: null, cv_path: null };
  }
}

/* ============================================================
   COUNT COMPLETIONS
   ============================================================ */
function countCompletions() {
  const mainDone     = MAIN_KEYS.filter(isCompleted).length;
  const bonusDone    = BONUS_SECTIONS.filter(s => isCompleted(s.key)).length;
  const bonusPending = BONUS_SECTIONS.length - bonusDone;
  const totalDone    = mainDone + bonusDone;
  return { mainDone, bonusDone, bonusPending, totalDone };
}

/* ============================================================
   RENDER STRENGTH BAR
   No percentage. No 80% threshold. Just a fill proportional to
   completion + a plain-English summary.
   ============================================================ */
function renderStrength() {
  const { totalDone, bonusPending } = countCompletions();
  const fillPct = (totalDone / TOTAL_SECTIONS) * 100;

  const fill       = document.getElementById("strengthFill");
  const summaryEl  = document.getElementById("strengthSummary");
  const noteEl     = document.getElementById("strengthNote");

  /* Animate bar on load */
  setTimeout(() => {
    if (fill) fill.style.width = fillPct + "%";
  }, 300);

  /* Summary line: "You've completed X of 18 sections." */
  if (summaryEl) {
    summaryEl.textContent =
      "You've completed " + totalDone + " of " + TOTAL_SECTIONS + " sections.";
  }

  /* Encouraging note ONLY if there are pending bonus sections.
     No fake matching promises. */
  if (noteEl) {
    if (bonusPending > 0) {
      noteEl.textContent =
        bonusPending === 1
          ? "1 optional section is still available — adding it gives a fuller picture of who you are."
          : bonusPending + " optional sections are still available — adding them gives a fuller picture of who you are.";
    } else {
      noteEl.textContent = "";  /* :empty selector hides the line */
    }
  }
}

/* ============================================================
   SOFT-SKIPPED HINT
   For the bonus grid only — to preserve the visual difference
   between "Skipped" (amber) and "Add" (blue) the user has seen
   before. JSONB cannot represent the "user clicked Skip"
   intent, so we read the optional localStorage flag for items
   NOT already marked Done.

   - Done state always wins. If JSONB says the section has data,
     "Done" is shown regardless of any stale skipped flag.
   - For items not Done: localStorage value "skipped" → Skipped pill.
   - Otherwise → Add pill.
   ============================================================ */
function _readLocalSkipped(localStorageKey) {
  try {
    if (typeof MC !== "undefined" && MC.safeGet) {
      return MC.safeGet(localStorageKey) === "skipped";
    }
    return localStorage.getItem(localStorageKey) === "skipped";
  } catch (e) {
    return false;
  }
}

/* ============================================================
   RENDER BONUS SECTIONS GRID
   Three states per item:
     done    → green tick, not clickable (JSONB authoritative)
     skipped → amber pill, clickable to revisit (soft-hint only)
     pending → blue "Add" pill, clickable to navigate
   ============================================================ */
function renderBonusGrid() {
  const grid = document.getElementById("bonusGrid");
  const card = document.getElementById("bonusCard");
  if (!grid) return;

  grid.innerHTML = "";

  /* Track for "all done" check (only true if every bonus is JSONB-done) */
  let allDone = true;

  BONUS_SECTIONS.forEach(section => {
    const isDone = isCompleted(section.key);
    if (!isDone) allDone = false;
    const isSkipped = !isDone && _readLocalSkipped(section.key);

    const item = document.createElement("div");
    let stateClass = "";
    if (isDone)          stateClass = " bonus-item--done";
    else if (isSkipped)  stateClass = " bonus-item--skipped";
    item.className = "bonus-item" + stateClass;

    const labelEl = document.createElement("span");
    labelEl.className = "bonus-item__label";
    labelEl.textContent = section.label;
    item.appendChild(labelEl);

    const statusEl = document.createElement("span");
    let statusClass, statusText;
    if (isDone)          { statusClass = "bonus-item__status--done";    statusText = "\u2713 Done"; }
    else if (isSkipped)  { statusClass = "bonus-item__status--skipped"; statusText = "Skipped"; }
    else                 { statusClass = "bonus-item__status--pending"; statusText = "Add"; }
    statusEl.className = "bonus-item__status " + statusClass;
    statusEl.textContent = statusText;
    item.appendChild(statusEl);

    /* Done items aren't clickable. Pending and skipped both navigate
       to the section so the user can fill it (or refill it). */
    if (!isDone) {
      const navTarget = { type: "navigate", page: section.page, sidebarKey: section.sidebarKey };
      item.addEventListener("click", () => {
        window.parent.postMessage(navTarget, "*");
      });
    }

    grid.appendChild(item);
  });

  /* If every bonus is Done, hide the entire card. */
  if (allDone && card) {
    card.classList.add("bonus-card--all-done");
  }
}

/* ============================================================
   REFERRAL LINK
   In production this will include the candidate's actual ID
   (or a tokenised referral code). For now we use the auth user
   id from MC_SB if available, falling back to the localStorage
   "candidate_id" hint for compatibility with the previous
   version.
   ============================================================ */
async function setupReferralLink() {
  let candidateId = null;

  /* Prefer the live auth-derived id when available */
  try {
    if (typeof MC_SB !== "undefined" && MC_SB.getCandidateId) {
      candidateId = await MC_SB.getCandidateId();
    }
  } catch (e) {
    /* fall through to localStorage fallback */
  }

  /* Legacy fallback */
  if (!candidateId) {
    try {
      candidateId = (typeof MC !== "undefined" && MC.safeGet)
        ? MC.safeGet("candidate_id")
        : localStorage.getItem("candidate_id");
    } catch (e) { /* ignore */ }
  }

  const linkEl = document.getElementById("referLink");
  if (linkEl) {
    linkEl.value = candidateId
      ? "https://meculs.com/join?ref=" + candidateId
      : "https://meculs.com/join";
  }

  const copyBtn = document.getElementById("copyLinkBtn");
  const confirm = document.getElementById("copyConfirm");
  if (!copyBtn) return;

  copyBtn.addEventListener("click", () => {
    const link = document.getElementById("referLink");
    if (!link) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link.value).then(() => {
        if (confirm) {
          confirm.textContent = "\u2713 Link copied to clipboard.";
          setTimeout(() => { confirm.textContent = ""; }, 3000);
        }
      }).catch(() => fallbackCopy(link, confirm));
    } else {
      fallbackCopy(link, confirm);
    }
  });
}

function fallbackCopy(link, confirm) {
  /* Older browsers without Clipboard API */
  link.select();
  try {
    document.execCommand("copy");
    if (confirm) {
      confirm.textContent = "\u2713 Link copied.";
      setTimeout(() => { confirm.textContent = ""; }, 3000);
    }
  } catch (e) {
    if (confirm) {
      confirm.textContent = "Copy failed \u2014 please copy manually.";
    }
  }
}

/* ============================================================
   REVIEW & EDIT
   Navigates parent dashboard back to Step 1.
   ============================================================ */
function setupReviewBtn() {
  const btn = document.getElementById("reviewProfileBtn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    window.parent.postMessage(
      { type: "navigate", page: "goals_interests.html", sidebarKey: "Your Goals & Interests" },
      "*"
    );
  });
}

/* ============================================================
   INIT
   Load the profile snapshot BEFORE rendering anything that
   depends on it. setupReferralLink and setupReviewBtn don't
   need the snapshot, but renderStrength and renderBonusGrid do.
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  /* Load profile snapshot first — predicates need it. */
  await loadProfileSnapshot();

  renderStrength();
  renderBonusGrid();
  setupReferralLink();
  setupReviewBtn();
});
