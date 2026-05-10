/* ════════════════════════════════════════════════════════════
   MECULS — admin.js (v=1)
   Date: 2026-05-09
   ════════════════════════════════════════════════════════════
   Drives the admin dashboard. Three jobs:
     1. Verify caller is an admin (RPC: is_admin)
     2. Load stats + profiles (RPCs: get_admin_stats,
        get_all_profiles_for_admin)
     3. Render table with search, sort, expand-row detail, CSV
        export

   Security model: page UI shows "access denied" if is_admin
   returns false, but the real protection is server-side — the
   data RPCs themselves refuse non-admin callers. So even a
   malicious user editing the HTML can't get data.
   ════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // State
  let SB = null;
  let CURRENT_USER = null;
  let ALL_PROFILES = [];
  let SORT_COL = "created_at";
  let SORT_DIR = "desc"; // 'asc' | 'desc'
  let EXPANDED_USER_ID = null;

  // ── Boot ────────────────────────────────────────────────────
  async function init() {
    if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined") {
      console.error("[admin] config.js missing");
      window.location.href = "login.html";
      return;
    }

    SB = window.MC_SB && window.MC_SB.getClient
      ? window.MC_SB.getClient()
      : window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Confirm signed in
    const { data: sessionData } = await SB.auth.getSession();
    if (!sessionData || !sessionData.session) {
      window.location.href = "login.html";
      return;
    }
    CURRENT_USER = sessionData.session.user;

    // Verify admin status
    let isAdmin = false;
    try {
      const { data, error } = await SB.rpc("is_admin");
      if (error) throw error;
      isAdmin = !!data;
    } catch (err) {
      console.error("[admin] is_admin failed:", err);
      showState("adError");
      $("adErrorMsg").textContent =
        "Couldn't verify admin access. " + (err.message || "Please try again.");
      return;
    }

    if (!isAdmin) {
      showState("adDenied");
      return;
    }

    // Admin confirmed — load data
    await loadAll();

    // Reveal page
    showState("adReady");

    // Wire events
    wireEvents();
  }

  function showState(stateId) {
    ["adLoading", "adDenied", "adError", "adReady"].forEach(id => {
      const el = $(id);
      if (el) el.hidden = (id !== stateId);
    });
  }

  // ── Load data ───────────────────────────────────────────────
  async function loadAll() {
    try {
      const [stats, profs] = await Promise.all([
        SB.rpc("get_admin_stats"),
        SB.rpc("get_all_profiles_for_admin")
      ]);

      if (stats.error) throw stats.error;
      if (profs.error) throw profs.error;

      renderStats(stats.data || {});
      ALL_PROFILES = profs.data || [];
      renderTable();
    } catch (err) {
      console.error("[admin] loadAll failed:", err);
      showState("adError");
      $("adErrorMsg").textContent = err.message || "Failed to load data.";
    }
  }

  function renderStats(s) {
    $("stTotal").textContent    = s.total ?? "—";
    $("stActive").textContent   = s.active ?? "—";
    $("stArchived").textContent = s.archived ?? "—";
    $("stPublic").textContent   = s.public ?? "—";
    $("stPhoto").textContent    = s.with_photo ?? "—";
    $("stNew7").textContent     = s.new_7d ?? "—";
    $("stNew30").textContent    = s.new_30d ?? "—";
  }

  // ── Render table ────────────────────────────────────────────
  function renderTable() {
    const tbody = $("adTbody");
    const search = ($("adSearch").value || "").trim().toLowerCase();

    // Filter
    let rows = ALL_PROFILES;
    if (search) {
      rows = rows.filter(r => {
        const haystack = [r.full_name, r.email, r.slug]
          .filter(Boolean).join(" ").toLowerCase();
        return haystack.indexOf(search) !== -1;
      });
    }

    // Sort
    rows = rows.slice().sort((a, b) => {
      const av = a[SORT_COL];
      const bv = b[SORT_COL];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return SORT_DIR === "asc" ? cmp : -cmp;
    });

    // Update sort arrow
    document.querySelectorAll(".ad-table thead th").forEach(th => {
      th.classList.toggle("is-sorted", th.getAttribute("data-col") === SORT_COL);
      const arrow = th.querySelector(".sort-arrow");
      if (arrow) {
        if (th.getAttribute("data-col") === SORT_COL) {
          arrow.textContent = SORT_DIR === "asc" ? "↑" : "↓";
        } else {
          arrow.textContent = "↕";
        }
      }
    });

    // Update count
    $("adRowCount").textContent =
      rows.length === ALL_PROFILES.length
        ? `${rows.length} user${rows.length === 1 ? "" : "s"}`
        : `${rows.length} of ${ALL_PROFILES.length} shown`;

    // Render
    tbody.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="6" style="text-align:center; padding:40px; color:var(--text-soft);">No matching users.</td>';
      tbody.appendChild(tr);
      return;
    }

    rows.forEach(row => {
      const tr = document.createElement("tr");
      tr.dataset.userId = row.user_id;
      tr.innerHTML = `
        <td class="col-name">${escapeHtml(row.full_name || "—")}</td>
        <td class="col-email">${escapeHtml(row.email || "—")}</td>
        <td>${escapeHtml(row.slug || "—")}</td>
        <td class="col-date">${fmtDate(row.created_at)}</td>
        <td class="col-date">${fmtDateRel(row.last_active_at)}</td>
        <td>${statusPill(row)}</td>
      `;
      tr.addEventListener("click", () => toggleDetail(row.user_id));
      tbody.appendChild(tr);

      // If this row is currently expanded, render its detail panel
      if (EXPANDED_USER_ID === row.user_id) {
        const detailTr = renderDetailRow(row);
        tbody.appendChild(detailTr);
      }
    });
  }

  function statusPill(row) {
    if (row.account_status === "archived") {
      return '<span class="ad-pill ad-pill--gold">Archived</span>';
    }
    if (row.is_public === false) {
      return '<span class="ad-pill ad-pill--gray">Private</span>';
    }
    return '<span class="ad-pill ad-pill--green">Active</span>';
  }

  function toggleDetail(userId) {
    EXPANDED_USER_ID = (EXPANDED_USER_ID === userId) ? null : userId;
    renderTable();
  }

  function renderDetailRow(row) {
    const tr = document.createElement("tr");
    tr.className = "ad-detail-row";
    const td = document.createElement("td");
    td.colSpan = 6;
    td.innerHTML = `
      <div class="ad-detail">
        <div class="ad-detail__heading">${escapeHtml(row.full_name || "(no name)")} — full record</div>
        <div class="ad-detail__grid">
          ${detailField("User ID",       row.user_id, true)}
          ${detailField("Email",         row.email)}
          ${detailField("Full name",     row.full_name)}
          ${detailField("Slug",          row.slug)}
          ${detailField("Public URL",    row.slug ? `meculs.com/p/${row.slug}` : null)}
          ${detailField("Status",        row.account_status)}
          ${detailField("Public",        row.is_public === false ? "false" : "true")}
          ${detailField("Created at",    fmtDate(row.created_at))}
          ${detailField("Updated at",    fmtDate(row.updated_at))}
          ${detailField("Last active",   row.last_active_at ? fmtDate(row.last_active_at) + " (" + fmtDateRel(row.last_active_at) + ")" : null)}
          ${detailField("Archived at",   row.archived_at ? fmtDate(row.archived_at) : null)}
          ${detailField("Photo path",    row.photo_path, true)}
          ${detailField("CV path",       row.cv_path, true)}
          ${detailField("CV uploaded",   fmtDate(row.cv_uploaded_at))}
          ${detailField("Terms consent", consentText(row.terms_consent, row.terms_consent_at))}
          ${detailField("Age confirmed", consentText(row.age_18_confirmed, row.age_18_confirmed_at))}
          ${detailField("Email-share",   consentText(row.email_share_consent, row.email_share_consent_at))}
          ${detailField("Notifications", consentText(row.notif_consent, row.notif_consent_at))}
          ${detailField("Marketing",     consentText(row.marketing_consent, row.marketing_consent_at))}
        </div>
        <div class="ad-detail__actions">
          ${row.slug ? `<a href="https://meculs.com/p/${escapeHtml(row.slug)}" target="_blank" rel="noopener" class="ad-btn ad-btn--ghost" style="text-decoration:none;">View profile →</a>` : ""}
          <button class="ad-btn ad-btn--ghost" data-copy-uid="${escapeHtml(row.user_id)}">Copy User ID</button>
        </div>
      </div>
    `;
    tr.appendChild(td);

    // Wire copy-uid buttons inside this detail row
    setTimeout(() => {
      td.querySelectorAll("[data-copy-uid]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const uid = btn.getAttribute("data-copy-uid");
          try {
            await navigator.clipboard.writeText(uid);
            const orig = btn.textContent;
            btn.textContent = "Copied!";
            setTimeout(() => { btn.textContent = orig; }, 1500);
          } catch (err) {
            console.error("[admin] copy failed:", err);
          }
        });
      });
    }, 0);

    // Stop click propagation so clicking inside detail doesn't collapse
    tr.addEventListener("click", e => e.stopPropagation());
    return tr;
  }

  function detailField(label, value, mono) {
    if (value === null || value === undefined || value === "") {
      return `
        <div class="ad-detail__field">
          <div class="ad-detail__label">${escapeHtml(label)}</div>
          <div class="ad-detail__value ad-detail__value--null">—</div>
        </div>`;
    }
    const cls = mono ? "ad-detail__value ad-detail__value--mono" : "ad-detail__value";
    return `
      <div class="ad-detail__field">
        <div class="ad-detail__label">${escapeHtml(label)}</div>
        <div class="${cls}">${escapeHtml(String(value))}</div>
      </div>`;
  }

  function consentText(granted, at) {
    if (granted === true) {
      return at ? "Granted (" + fmtDate(at) + ")" : "Granted";
    }
    if (granted === false) return "Withdrawn";
    return "—";
  }

  // ── Wire events ─────────────────────────────────────────────
  function wireEvents() {
    $("adSearch").addEventListener("input", debounce(renderTable, 150));
    $("adRefresh").addEventListener("click", async () => {
      const btn = $("adRefresh");
      btn.disabled = true;
      btn.textContent = "Refreshing…";
      await loadAll();
      btn.disabled = false;
      btn.textContent = "Refresh";
    });
    $("adExportCsv").addEventListener("click", exportCsv);

    // Sortable headers
    document.querySelectorAll(".ad-table thead th").forEach(th => {
      th.addEventListener("click", () => {
        const col = th.getAttribute("data-col");
        if (!col) return;
        if (SORT_COL === col) {
          SORT_DIR = (SORT_DIR === "asc") ? "desc" : "asc";
        } else {
          SORT_COL = col;
          SORT_DIR = "asc";
        }
        renderTable();
      });
    });
  }

  // ── CSV export ──────────────────────────────────────────────
  function exportCsv() {
    if (!ALL_PROFILES.length) {
      alert("No data to export.");
      return;
    }

    /* Use a fixed column order so the file is predictable in
       Excel. We exclude the big 'data' JSON blob — it's not
       useful in a flat CSV. If you need it, view in admin
       detail panel or query Supabase directly. */
    const cols = [
      "user_id", "email", "full_name", "slug",
      "account_status", "is_public",
      "created_at", "updated_at", "last_active_at", "archived_at",
      "photo_path", "cv_path", "cv_uploaded_at",
      "terms_consent", "terms_consent_at",
      "age_18_confirmed", "age_18_confirmed_at",
      "email_share_consent", "email_share_consent_at",
      "notif_consent", "notif_consent_at",
      "marketing_consent", "marketing_consent_at"
    ];

    const lines = [cols.join(",")];
    ALL_PROFILES.forEach(row => {
      const cells = cols.map(c => csvCell(row[c]));
      lines.push(cells.join(","));
    });
    const csv = lines.join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `meculs-users-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvCell(v) {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (s.indexOf(",") !== -1 || s.indexOf("\"") !== -1 ||
        s.indexOf("\n") !== -1 || s.indexOf("\r") !== -1) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // ── Helpers ─────────────────────────────────────────────────
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }
  function fmtDateRel(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return "future";
    const days = Math.floor(diffMs / 86400000);
    if (days === 0)   return "today";
    if (days === 1)   return "yesterday";
    if (days < 30)    return days + "d ago";
    if (days < 365)   {
      const m = Math.floor(days / 30);
      return m + "mo ago";
    }
    return Math.floor(days / 365) + "y ago";
  }
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  // ── Boot ────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
