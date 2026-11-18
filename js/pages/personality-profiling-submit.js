
/* ─────────────────────────────────────────────────────────────
   personality-profiling-submit.html

   THREE LAYERS OF SPAM PROTECTION:
     1. Honeypot field (hp_website)
     2. Timestamp check (hp_ts)
     3. Cloudflare Turnstile (server-verified)

   On valid submit, writes the row to public.paid_submissions table
   in Supabase. On success, shows the in-page success state.
   ───────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  /* Create Supabase client */
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const form = document.getElementById("ppForm");
  const submitBtn = document.getElementById("ppSubmit");
  const errorEl = document.getElementById("ppError");
  const formState = document.getElementById("ppFormState");
  const successState = document.getElementById("ppSuccessState");
  const hpTs = document.getElementById("hp_ts");

  /* Record the page-load timestamp for the timestamp check. */
  if (hpTs) hpTs.value = String(Date.now());

  /* Payment ID is no longer pre-filled from URL — it comes from
     the verified access token via meculs-gate.js, exposed as
     window.MECULS_PAYMENT_ID. */

  /* Auto-prepend https:// on the Subject URL field. */
  const subjectUrlEl = document.getElementById("ppSubjectUrl");
  function normalizeUrl(val) {
    var v = (val || "").trim();
    if (!v) return v;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
    if (/^[a-z0-9]/i.test(v)) return "https://" + v;
    return v;
  }
  subjectUrlEl.addEventListener("blur", function () {
    subjectUrlEl.value = normalizeUrl(subjectUrlEl.value);
  });

  function showSuccess() {
    formState.style.display = "none";
    successState.classList.add("is-visible");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    errorEl.classList.remove("is-visible");

    /* Normalize URL one more time in case user never blurred */
    subjectUrlEl.value = normalizeUrl(subjectUrlEl.value);

    /* ──── LAYER 1: HONEYPOT ──── */
    const hpValue = (document.getElementById("hp_website").value || "").trim();
    if (hpValue) {
      console.warn("Honeypot triggered — silently rejecting");
      /* Neutral redirect so bots can't confirm success.
         Do NOT showSuccess() — that advertises the service was bought. */
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
      submitBtn.textContent = "Submit profile details →";
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
      errorEl.textContent = "Security check failed. Please refresh and try again, " +
                            "or email Jain.Rajneesh@meculs.com with the details directly.";
      errorEl.classList.add("is-visible");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit profile details →";
      try { if (typeof turnstile !== "undefined") turnstile.reset(); } catch (e) {}
      return;
    }

    /* ──── ALL CHECKS PASSED — WRITE TO SUPABASE ──── */
    const email = document.getElementById("ppEmail").value.trim();
    const subjectName = document.getElementById("ppSubjectName").value.trim();
    const subjectUrl = document.getElementById("ppSubjectUrl").value.trim();
    const questions = document.getElementById("ppQuestions").value.trim();
    const phone = document.getElementById("ppPhone").value.trim();

    /* Payment ID comes ONLY from the verified gate. meculs-gate.js
       set window.MECULS_PAYMENT_ID after server-verifying the access
       token via /api/check-access. We do NOT trust the visible field. */
    const paymentId = (window.MECULS_PAYMENT_ID || "").trim();
    if (!paymentId) {
      errorEl.textContent = "Your session has expired. Please refresh and try again.";
      errorEl.classList.add("is-visible");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit profile details →";
      return;
    }

    try {
      const { error } = await sb
        .from("paid_submissions")
        .insert({
          form_type: "personality_profiling",
          customer_email: email,
          razorpay_payment_id: paymentId,
          payload: {
            subject_name: subjectName,
            subject_url: subjectUrl,
            questions: questions,
            phone: phone
          }
        });

      if (error) throw error;
      showSuccess();
    } catch (err) {
      console.error("Submission failed:", err);
      errorEl.textContent = "Something went wrong. Please email Jain.Rajneesh@meculs.com with the details directly.";
      errorEl.classList.add("is-visible");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit profile details →";
    }
  });
})();
