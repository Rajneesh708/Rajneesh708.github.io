
/* ─────────────────────────────────────────────────────────────
   cv-upgrade-submit.html

   THREE LAYERS OF SPAM PROTECTION:
     1. Honeypot field (hp_website)
     2. Timestamp check (hp_ts)
     3. Cloudflare Turnstile (server-verified)

   On valid submit, writes the row to public.paid_submissions table
   in Supabase. On success, redirects to cv-upgrade-ready.html.
   ───────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  /* Create Supabase client */
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const form = document.getElementById("cvForm");
  const submitBtn = document.getElementById("cvSubmit");
  const errorEl = document.getElementById("cvError");
  const hpTs = document.getElementById("hp_ts");

  /* Record the page-load timestamp for the timestamp check. */
  if (hpTs) hpTs.value = String(Date.now());

  /* Payment ID is no longer pre-filled from URL — it comes from
     the verified access token via meculs-gate.js, exposed as
     window.MECULS_PAYMENT_ID. */

  /* Auto-prepend https:// on the CV link field. */
  const cvLinkEl = document.getElementById("cvLink");
  function normalizeUrl(val) {
    var v = (val || "").trim();
    if (!v) return v;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
    if (/^[a-z0-9]/i.test(v)) return "https://" + v;
    return v;
  }
  cvLinkEl.addEventListener("blur", function () {
    cvLinkEl.value = normalizeUrl(cvLinkEl.value);
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    errorEl.classList.remove("is-visible");

    /* Normalize the URL one more time in case user never blurred */
    cvLinkEl.value = normalizeUrl(cvLinkEl.value);

    /* ──── LAYER 1: HONEYPOT ──── */
    const hpValue = (document.getElementById("hp_website").value || "").trim();
    if (hpValue) {
      console.warn("Honeypot triggered — silently rejecting");
      /* Neutral redirect so bots can't tell whether they succeeded.
         Do NOT send them to cv-upgrade-ready.html (which advertises
         the service as completed) — that confirms success to the bot. */
      window.location.href = "/";
      return;
    }

    /* ──── LAYER 2: TIMESTAMP ──── */
    const loadedAt = parseInt(hpTs.value, 10) || 0;
    const elapsed = Date.now() - loadedAt;
    if (elapsed < 3000) {
      console.warn("Timestamp check failed (" + elapsed + "ms) — rejecting");
      window.location.href = "/";
      return;
    }

    /* ──── LAYER 3: TURNSTILE ──── */
    let turnstileToken = "";
    try {
      if (typeof turnstile !== "undefined" && turnstile.getResponse) {
        turnstileToken = turnstile.getResponse();
      }
    } catch (e) {
      turnstileToken = "";
    }

    if (!turnstileToken) {
      errorEl.textContent = "Please complete the security check above before submitting.";
      errorEl.classList.add("is-visible");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit my CV →";
      return;
    }

    try {
      const verifyRes = await fetch(MECULS_API_BASE + "/api/verify-turnstile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstile_token: turnstileToken })
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.ok) {
        throw new Error(verifyData.reason || "verify_failed");
      }
    } catch (verifyErr) {
      console.error("Turnstile verification failed:", verifyErr);
      errorEl.textContent = "Security check failed. Please refresh the page and try again, " +
                            "or email Jain.Rajneesh@meculs.com with your CV link directly.";
      errorEl.classList.add("is-visible");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit my CV →";
      try { if (typeof turnstile !== "undefined") turnstile.reset(); } catch (e) {}
      return;
    }

    /* ──── ALL CHECKS PASSED — WRITE TO SUPABASE ──── */
    const email = document.getElementById("cvEmail").value.trim();
    const cvLink = document.getElementById("cvLink").value.trim();
    const notes = document.getElementById("cvNotes").value.trim();

    /* Payment ID comes ONLY from the verified gate. meculs-gate.js
       set window.MECULS_PAYMENT_ID after server-verifying the access
       token via /api/check-access. We do NOT trust the visible
       payment-ID field — a user could clear it. */
    const paymentId = (window.MECULS_PAYMENT_ID || "").trim();
    if (!paymentId) {
      /* Should never happen — gate would have shown locked panel.
         Defence in depth: refuse to write without a verified id. */
      errorEl.textContent = "Your session has expired. Please refresh and try again.";
      errorEl.classList.add("is-visible");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit my CV →";
      return;
    }

    try {
      const { error } = await sb
        .from("paid_submissions")
        .insert({
          form_type: "cv_upgrade",
          customer_email: email,
          razorpay_payment_id: paymentId,
          payload: {
            cv_link: cvLink,
            notes: notes
          }
        });

      if (error) throw error;

      window.location.href = "cv-upgrade-ready.html";
    } catch (err) {
      console.error("Submission failed:", err);
      errorEl.textContent = "Something went wrong. Please email Jain.Rajneesh@meculs.com with your CV link directly.";
      errorEl.classList.add("is-visible");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit my CV →";
    }
  });
})();
