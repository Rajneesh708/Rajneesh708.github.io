/* ============================================================
   MECULS — api.js
   Shared utilities only. No page-specific logic.

   Who loads this file:
   - All 7 Tier 2 section pages (updateCounter, autoGrow)
   - Recruiter pages (apiPost, apiGet) — Phase 9B

   Who does NOT load this file:
   - Main 11 form pages (Steps 1–11) — each is self-contained
   ============================================================ */

/* ── apiPost — shared HTTP POST helper ──
   Used by: recruiter-search.js (Phase 9B)
   Requires: API_BASE from config.js (loaded before this file)
─────────────────────────────────────────────────────────── */
async function apiPost(path, payload) {
  const res = await fetch(API_BASE + path, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "API Error");
  return data;
}

/* ── apiGet — shared HTTP GET helper ──
   Used by: recruiter_snapshot.js (Phase 9B)
   Requires: API_BASE from config.js (loaded before this file)
─────────────────────────────────────────────────────────── */
async function apiGet(path) {
  const res = await fetch(API_BASE + path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "API Error");
  return data;
}

/* ── updateCounter — char counter for textarea fields ──
   Used by: all 7 Tier 2 section JS files
   Called as: oninput="updateCounter(this, 'counterId')"
─────────────────────────────────────────────────────────── */
function updateCounter(el, counterId) {
  const max     = el.getAttribute("maxlength");
  const counter = document.getElementById(counterId);
  if (counter && max) {
    counter.textContent = `${el.value.length} / ${Number(max).toLocaleString()}`;
  }
}

/* ── autoGrow — textarea auto-expands as user types ──
   Used by: Tier 2 section JS files that have long text fields
   The event listener on document catches all textareas globally
   when this file is loaded.
─────────────────────────────────────────────────────────── */
function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

document.addEventListener("input", e => {
  if (e.target.tagName === "TEXTAREA") {
    autoGrow(e.target);
  }
});
