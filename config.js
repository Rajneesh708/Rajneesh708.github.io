/* ============================================================
   MECULS — config.js
   Single source of truth for all configuration.

   HOW TO USE:
   Add this line to every HTML page, BEFORE any other scripts:
   <script src="config.js"></script>

   ARCHITECTURE NOTE (post-2026-04-30):
   The portal previously used a FastAPI backend at API_BASE.
   That backend has been retired. All data now flows through
   Supabase (database + auth + storage). API_BASE has been
   removed accordingly.

   IF YOU SEE OLD CODE STILL REFERENCING `API_BASE`:
   that code is from before the Supabase migration and needs
   to be rewritten to use the supabase-js client. The candidate
   page JS files (goals_interests.js, experience.js, etc.) will
   be updated in backend Session 2.
   ============================================================ */

/* ── Supabase Configuration ──
   These are the LIVE production values for the Mumbai project.
   The anon key is PUBLIC by design — it goes in the browser.
   Security comes from Row-Level Security policies (which we set up
   in backend Session 1) and from Cloudflare Turnstile bot
   protection on auth.

   DO NOT put the service_role key here. Ever. That stays in
   Supabase Dashboard, secret, server-side only.
   ─────────────────────────────────────────────────────────── */
const SUPABASE_URL      = "https://fjxcphhhddfwrlkpshyw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqeGNwaGhoZGRmd3Jsa3BzaHl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MDgwOTYsImV4cCI6MjA5MzE4NDA5Nn0.83h3FhLbRP7sz4K5Aomek-Ns3L9IfVZ6kFNKJcc_6YM";

/* ── Cloudflare Turnstile (added 2026-05-05) ──
   Site key for the invisible bot-check on auth pages.
   This value is PUBLIC by design — it identifies the widget.
   The matching SECRET key is configured in Supabase Dashboard
   → Auth → Bot Protection (server-side, never in browser).

   Used by: register.html, login.html
   How it's used: HTML reads window.TURNSTILE_SITE_KEY at load
   time and writes it into the .cf-turnstile widget's data-sitekey
   attribute via a tiny inline script BEFORE Turnstile's script
   loads and renders.
   ─────────────────────────────────────────────────────────── */
const TURNSTILE_SITE_KEY = "0x4AAAAAADGth_-6hJl4Fyzu";
