/* ============================================================
   MECULS — meculs-gate.js
   ------------------------------------------------------------
   THE DOOR on cv-upgrade-submit.html and
   personality-profiling-submit.html.

   On page load this script:
     1. Looks for an access token (from sessionStorage, set by
        meculs-checkout.js after a verified payment; or from the
        URL as a fallback).
     2. Sends it to /api/check-access on Vercel, which confirms
        the token is genuine, unexpired, and for THIS product.
     3. If valid  → reveals the form, and exposes the verified
                    payment id as window.MECULS_PAYMENT_ID so the
                    form can save it with the submission.
     4. If invalid → hides the form, shows a polite "please
                     complete payment first" panel instead.

   How a page uses it — set the product on the body or a wrapper:
     <body data-gate-product="cv-upgrade">
   and wrap the real content so it starts hidden:
     <div id="meculs-gated" hidden> ... the form ... </div>
   and add the locked panel:
     <div id="meculs-locked" hidden> ... pay-first message ... </div>

   Requires, loaded BEFORE this file:
     <script src="config.js"></script>
   ============================================================ */

(function () {
  "use strict";

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  document.addEventListener("DOMContentLoaded", async function () {
    var gated  = document.getElementById("meculs-gated");
    var locked = document.getElementById("meculs-locked");
    var product = document.body.getAttribute("data-gate-product") || "";

    /* Start safe: form hidden, locked panel hidden, until we decide. */
    hide(gated);
    hide(locked);

    if (typeof MECULS_API_BASE === "undefined" || !MECULS_API_BASE) {
      console.error("meculs-gate: MECULS_API_BASE not set in config.js");
      /* Fail safe — show the locked panel, not the form. */
      show(locked);
      return;
    }

    /* ---- find the token: sessionStorage first, URL as fallback ---- */
    var token = "";
    try { token = sessionStorage.getItem("meculs_access_token") || ""; } catch (e) {}
    if (!token) {
      var params = new URLSearchParams(window.location.search);
      token = params.get("access_token") || "";
    }

    if (!token) {
      /* No token at all — someone opened the page directly. */
      show(locked);
      return;
    }

    /* ---- ask the server if the token is good ---- */
    try {
      var res = await fetch(MECULS_API_BASE + "/api/check-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token, product: product })
      });
      var data = await res.json();

      if (res.ok && data.ok) {
        /* Verified. Reveal the form, hand the payment id to the page. */
        window.MECULS_PAYMENT_ID = data.payment_id || null;
        window.MECULS_ORDER_ID   = data.order_id || null;
        window.MECULS_PRODUCT    = data.product || product;
        show(gated);
        hide(locked);

        /* v=2: strip Razorpay and access-token params from the URL now
           that they have been consumed and stored in window globals.
           Leaving them in the URL means they persist in browser history
           and leak via Referer headers to any third-party resource on
           this page. sessionStorage retains the values for form submission. */
        try {
          if (window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (_e) { /* non-fatal — params stay in URL but functionality is unaffected */ }
      } else {
        /* Token missing/forged/expired/wrong product → no form. */
        console.warn("meculs-gate: access denied —", data && data.reason);
        hide(gated);
        show(locked);
      }
    } catch (err) {
      console.error("meculs-gate: check-access failed", err);
      /* If the check itself errors, fail safe — show locked. */
      hide(gated);
      show(locked);
    }
  });
})();
